#!/usr/bin/env python3
"""Replay a historical busy day through the anomaly pipeline (UC-04, replay mode).

Real City of Melbourne hourly pedestrian counts for the replay day and the seven
days before it are compared per sensor and hour (observed against the mean of
the same hour on the previous seven days). Sensor-hours beyond the threshold are
written to `melens_ingest.anomaly_results` as one published batch of the source
`melens.anomaly.replay`, which the `melens_query.v_anomaly_current` view serves
to the map and the agent. Nothing is invented: every value is a real count or a
mean of real counts, and every row is labelled as a replay.

Default: fetch (cached under --cache), compute and print the plan. Cloud writes
need --apply and an exact --confirm-project. Run `apply-sql.py` for 009 first.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE_ID = "melens.anomaly.replay"
BASELINE_ID = "same-hour-prev-7d-mean-v1"
API = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets"
COUNTS = "pedestrian-counting-system-monthly-counts-per-hour"
LOCATIONS = "pedestrian-counting-system-sensor-locations"
MELBOURNE = ZoneInfo("Australia/Melbourne")
PROJECT_ID = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")

# A sensor-hour is anomalous when it differs from its baseline by at least this
# share and by at least this many people. Small hours (a quiet street at 3 am)
# never qualify on percentage alone.
MIN_RELATIVE_CHANGE = 0.5
MIN_ABSOLUTE_CHANGE = 300
BASELINE_DAYS = 7
MAX_PER_SENSOR = 3


def classify(counts: dict[tuple[str, date, int], int], replay_day: date) -> list[dict]:
    """Anomalous sensor-hours of `replay_day`: counts maps (sensor_id, date, hour) to the people counted.

    Hours without an observation, or without all seven baseline days, are not
    classified and do not appear (a missing value stays unknown, never zero).
    """
    days = [replay_day - timedelta(days=offset) for offset in range(1, BASELINE_DAYS + 1)]
    results: list[dict] = []
    for (sensor_id, day, hour), observed in counts.items():
        if day != replay_day:
            continue
        history = [counts.get((sensor_id, earlier, hour)) for earlier in days]
        if any(value is None for value in history):
            continue
        baseline = sum(history) / BASELINE_DAYS
        if baseline <= 0:
            continue
        delta = observed - baseline
        if abs(delta) / baseline < MIN_RELATIVE_CHANGE or abs(delta) < MIN_ABSOLUTE_CHANGE:
            continue
        results.append({"sensor_id": sensor_id, "hour": hour, "observed": observed, "baseline": round(baseline, 2),
                        "delta": round(delta, 2), "direction": "higher" if delta > 0 else "lower"})
    per_sensor: dict[str, list[dict]] = defaultdict(list)
    for row in sorted(results, key=lambda item: -abs(item["delta"])):
        if len(per_sensor[row["sensor_id"]]) < MAX_PER_SENSOR:
            per_sensor[row["sensor_id"]].append(row)
    return sorted((row for rows in per_sensor.values() for row in rows), key=lambda item: -abs(item["delta"]))


def hour_window(day: date, hour: int) -> tuple[datetime, datetime]:
    """The UTC instants of the Melbourne local hour [hour, hour + 1)."""
    start = datetime(day.year, day.month, day.day, hour, tzinfo=MELBOURNE)
    return start.astimezone(timezone.utc), (start + timedelta(hours=1)).astimezone(timezone.utc)


def fetch(dataset: str, params: dict[str, str], cache: Path) -> list[dict]:
    key = hashlib.sha256(f"{dataset}?{sorted(params.items())}".encode()).hexdigest()[:16]
    cached = cache / f"replay-{dataset}-{key}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    url = f"{API}/{dataset}/exports/json?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=120) as response:
        rows = json.loads(response.read())
    cache.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(rows))
    return rows


def load_counts(replay_day: date, cache: Path) -> dict[tuple[str, date, int], int]:
    first = replay_day - timedelta(days=BASELINE_DAYS)
    rows = fetch(COUNTS, {"where": f"sensing_date >= date'{first}' and sensing_date <= date'{replay_day}'",
                          "select": "location_id,sensing_date,hourday,pedestriancount"}, cache)
    counts: dict[tuple[str, date, int], int] = {}
    for row in rows:
        if row.get("pedestriancount") is None:
            continue
        counts[(str(row["location_id"]), date.fromisoformat(row["sensing_date"]), int(row["hourday"]))] = int(row["pedestriancount"])
    return counts


def sql_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def build_rows(replay_day: date, label: str, cache: Path, batch_id: str, now: datetime) -> list[dict]:
    locations = {str(row["location_id"]): row for row in fetch(LOCATIONS, {"select": "location_id,sensor_description,sensor_name,latitude,longitude,status"}, cache)}
    rows = []
    for item in classify(load_counts(replay_day, cache), replay_day):
        place = locations.get(item["sensor_id"])
        if place is None or place.get("latitude") is None or place.get("longitude") is None:
            continue  # a sensor with no known location is not drawn
        start, end = hour_window(replay_day, item["hour"])
        stamp = start.strftime("%Y%m%d%H")
        rows.append({
            "result_id": f"replay-{item['sensor_id']}-{stamp}", "source_id": SOURCE_ID, "batch_id": batch_id,
            "sensor_id": item["sensor_id"], "sensor_name": place.get("sensor_description") or place["sensor_name"],
            "lat": place["latitude"], "lon": place["longitude"],
            "window_from": start.isoformat().replace("+00:00", "Z"), "window_to": end.isoformat().replace("+00:00", "Z"),
            "observation_id": f"replay-obs-{item['sensor_id']}-{stamp}", "baseline_definition_id": BASELINE_ID,
            "baseline_value": item["baseline"], "observed_value": item["observed"], "delta": item["delta"],
            "direction": item["direction"], "classification": "anomalous", "is_replay": True, "replay_label": label,
            "location_evidence": f"City of Melbourne pedestrian counting system sensor locations (dataset {LOCATIONS}), location_id {item['sensor_id']}",
            "fetched_at": now.isoformat().replace("+00:00", "Z"),
        })
    return rows


def registration_sql(project: str, replay_day: date, batch_id: str, output_count: int, now: datetime) -> list[str]:
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    day_start = hour_window(replay_day, 0)[0].strftime("%Y-%m-%d %H:%M:%S")
    day_end = hour_window(replay_day + timedelta(days=1), 0)[0].strftime("%Y-%m-%d %H:%M:%S")
    evidence = json.dumps({
        "kind": "replay", "replay_day": replay_day.isoformat(), "baseline": BASELINE_ID,
        "threshold": {"min_relative_change": MIN_RELATIVE_CHANGE, "min_absolute_change": MIN_ABSOLUTE_CHANGE},
        "input_datasets": [COUNTS, LOCATIONS], "license": "CC BY 4.0, City of Melbourne",
        "review": "Internal derived replay of openly licensed data, registered without the live-source admission gates; awaiting team review",
    }, sort_keys=True)
    return [
        f"INSERT INTO `{project}.melens_ingest.data_sources` (source_id, provider, dataset_title, landing_url, topic, scope, coverage_area_refs, "
        "coverage_from, coverage_to, cadence_seconds, check_interval_seconds, record_granularity, admission_evidence, connector_owner, "
        "license_status, access_status, last_checked_at, last_success_at, last_source_update_at, updated_at) VALUES ("
        f"{sql_string(SOURCE_ID)}, 'Melens (derived from City of Melbourne pedestrian counts, CC BY 4.0)', 'Pedestrian anomaly replay', "
        f"'https://data.melbourne.vic.gov.au/explore/dataset/{COUNTS}/', 'anomaly', 'city', ['com_municipal:1:2008-07-01'], "
        f"TIMESTAMP '{day_start}', NULL, NULL, NULL, 'anomaly_result_hourly', PARSE_JSON({sql_string(evidence)}), 'melens integration', "
        f"'verified_open', 'active', TIMESTAMP '{stamp}', TIMESTAMP '{stamp}', TIMESTAMP '{stamp}', TIMESTAMP '{stamp}')",
        f"INSERT INTO `{project}.melens_ingest.sync_batches` (batch_id, source_id, window_from, window_to, source_revision, started_at, finished_at, "
        "state, state_updated_at, published_at, input_count, output_count, rejected_count, checkpoint_before, checkpoint_after, error_code, schema_version) "
        f"VALUES ({sql_string(batch_id)}, {sql_string(SOURCE_ID)}, TIMESTAMP '{day_start}', TIMESTAMP '{day_end}', {sql_string(BASELINE_ID)}, "
        f"TIMESTAMP '{stamp}', TIMESTAMP '{stamp}', 'published', TIMESTAMP '{stamp}', TIMESTAMP '{stamp}', {output_count}, {output_count}, 0, NULL, "
        f"{sql_string(replay_day.isoformat())}, NULL, 1)",
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", default="melens-510012")
    parser.add_argument("--day", default="2025-09-27", help="Replay day (Melbourne date)")
    parser.add_argument("--label", default="Replay of 27 Sep 2025 (AFL Grand Final day)")
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "melens-anomaly-replay")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-project", default="")
    args = parser.parse_args()
    if not PROJECT_ID.match(args.project):
        print("Invalid project ID", file=sys.stderr)
        return 2
    if args.apply and args.confirm_project != args.project:
        print("--apply requires --confirm-project equal to --project", file=sys.stderr)
        return 2
    replay_day = date.fromisoformat(args.day)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    batch_id = "batch_replay_" + hashlib.sha256(f"{replay_day}{now.isoformat()}".encode()).hexdigest()[:20]
    rows = build_rows(replay_day, args.label, args.cache, batch_id, now)
    print(f"Replay day {replay_day}: {len(rows)} anomalous sensor-hours across {len({row['sensor_id'] for row in rows})} sensors")
    for row in rows[:10]:
        print(f"  {row['sensor_name']:<34} {row['window_from']}  observed {row['observed_value']:>6}  baseline {row['baseline_value']:>8}  {row['direction']}")
    if not args.apply:
        print("Plan only. Nothing was written. Re-run with --apply --confirm-project", args.project)
        return 0
    if not rows:
        print("Nothing to publish", file=sys.stderr)
        return 1
    with tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False) as handle:
        handle.write("\n".join(json.dumps(row) for row in rows))
        path = handle.name
    subprocess.run(["bq", f"--project_id={args.project}", "load", "--source_format=NEWLINE_DELIMITED_JSON",
                    f"{args.project}:melens_ingest.anomaly_results", path], check=True)
    for statement in registration_sql(args.project, replay_day, batch_id, len(rows), now):
        subprocess.run(["bq", f"--project_id={args.project}", "query", "--use_legacy_sql=false", "--nouse_cache", statement], check=True)
    print(f"Published batch {batch_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
