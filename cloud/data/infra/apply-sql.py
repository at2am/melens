#!/usr/bin/env python3
"""Apply the reviewed Melens BigQuery schema and authorized views.

The default mode only parses local SQL and prints a plan. Cloud writes require
both --apply and an exact --confirm-project. Run after bootstrap.sh.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


REGION = "australia-southeast2"
INGEST = "melens_ingest"
QUERY = "melens_query"
SQL_DIR = Path(__file__).resolve().parent.parent / "sql"
FILES = tuple(SQL_DIR / f"{number:03d}_{name}.sql" for number, name in (
    (1, "tables"), (2, "core_views"), (3, "parking_views"),
    (4, "street_views"), (5, "news_views"), (6, "area_views"),
    (7, "changes_views"), (8, "health_views"), (9, "anomaly_views"),
))
PROJECT_ID = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
TABLE_DDL = re.compile(
    r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`melens_ingest\.([A-Za-z_][A-Za-z0-9_]*)`(?=\s|\()",
    re.IGNORECASE,
)
VIEW_DDL = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+VIEW\s+`melens_query\.([A-Za-z_][A-Za-z0-9_]*)`(?=\s|\()",
    re.IGNORECASE,
)
RAW_REFERENCE = re.compile(r"`melens_ingest\.[A-Za-z_][A-Za-z0-9_]*`", re.IGNORECASE)

# Only these reviewed views read ingest tables directly. Other query views
# depend on these views and need no raw-dataset authorization of their own.
AUTHORIZED_RAW_VIEWS = frozenset({
    "v_geo_records_history",
    "v_geo_records_current",
    "v_parking_current",
    "v_parking_unmatched_observations",
    "v_parking_sensor_current",
    "v_parking_rule_reference",
    "v_pedestrian_observations",
    "v_news_sources",
    "v_crime_area_statistics",
    "v_boundaries",
    "v_area_indicators",
    "v_source_health",
    "v_source_coverage",
    "v_anomaly_current",
})


def split_sql(source: str) -> list[str]:
    """Split SQL at statement semicolons, ignoring comments and quoted text."""
    statements: list[str] = []
    current: list[str] = []
    quote: str | None = None
    line_comment = False
    block_comment = False
    index = 0
    while index < len(source):
        char = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
                current.append("\n")
            index += 1
            continue
        if block_comment:
            if char == "*" and following == "/":
                block_comment = False
                index += 2
                continue
            index += 1
            continue
        if quote:
            current.append(char)
            if char == "\\" and following:
                current.append(following)
                index += 2
                continue
            if char == quote:
                if following == quote and quote != "`":
                    current.append(following)
                    index += 2
                    continue
                quote = None
            index += 1
            continue
        if char == "-" and following == "-":
            line_comment = True
            index += 2
            continue
        if char == "/" and following == "*":
            block_comment = True
            index += 2
            continue
        if char in "'\"`":
            quote = char
            current.append(char)
            index += 1
            continue
        if char == ";":
            statement = "".join(current).strip()
            if statement:
                statements.append(statement + ";")
            current.clear()
            index += 1
            continue
        current.append(char)
        index += 1
    if quote or block_comment:
        raise ValueError("Unterminated SQL quote or block comment")
    if "".join(current).strip():
        raise ValueError("SQL statement missing final semicolon")
    return statements


def plan_sql() -> list[tuple[Path, str, str, str]]:
    planned: list[tuple[Path, str, str, str]] = []
    seen: set[tuple[str, str]] = set()
    directly_raw: set[str] = set()
    for file_index, path in enumerate(FILES):
        statements = split_sql(path.read_text(encoding="utf-8"))
        if not statements:
            raise ValueError(f"No DDL in {path.name}")
        for statement in statements:
            match = (TABLE_DDL if file_index == 0 else VIEW_DDL).match(statement)
            if match is None:
                raise ValueError(f"Unexpected DDL in {path.name}: {statement[:80]}")
            kind = "table" if file_index == 0 else "view"
            name = match.group(1)
            if (kind, name) in seen:
                raise ValueError(f"Duplicate {kind}: {name}")
            seen.add((kind, name))
            if kind == "view" and RAW_REFERENCE.search(statement[match.end():]):
                directly_raw.add(name)
            planned.append((path, kind, name, statement))
    if directly_raw != AUTHORIZED_RAW_VIEWS:
        raise ValueError(
            "Raw-table view authorization list drifted; review SQL and allowlist: "
            f"detected={sorted(directly_raw)}, approved={sorted(AUTHORIZED_RAW_VIEWS)}"
        )
    return planned


def run(*args: str, input_text: str | None = None) -> str:
    completed = subprocess.run(
        args, input=input_text, text=True, check=True, capture_output=True
    )
    return completed.stdout


def read_dataset(project: str, dataset: str) -> dict:
    result = json.loads(run(
        "bq", f"--project_id={project}", "show", "--format=prettyjson",
        f"{project}:{dataset}",
    ))
    reference = result.get("datasetReference", {})
    if (reference.get("projectId") != project
            or reference.get("datasetId") != dataset
            or result.get("location", "").lower() != REGION):
        raise ValueError(f"{dataset} must exist in {project}/{REGION}")
    return result


def authorize_views(dataset: dict, project: str) -> dict:
    """Return the current dataset with only reviewed direct-view grants refreshed."""
    access = dataset.get("access")
    if not isinstance(access, list):
        raise ValueError("Ingest dataset has no readable access list")
    query_identity = f"melens-dev-query@{project}.iam.gserviceaccount.com"
    retained = []
    for entry in access:
        if entry.get("userByEmail") == query_identity:
            raise ValueError("Query service identity has direct ingest dataset access")
        if entry.get("specialGroup") in {"projectReaders", "allAuthenticatedUsers"}:
            raise ValueError("Ingest dataset has a broad reader grant")
        if "dataset" in entry:
            dataset_ref = entry["dataset"].get("dataset", {})
            if (dataset_ref.get("projectId") == project
                    and dataset_ref.get("datasetId") == QUERY):
                raise ValueError("Query dataset has broad ingest authorization")
        view = entry.get("view", {})
        if (view.get("projectId") == project
                and view.get("datasetId") == QUERY):
            if view.get("tableId") not in AUTHORIZED_RAW_VIEWS:
                raise ValueError(f"Unreviewed query view authorization: {view.get('tableId')}")
            continue  # Regrant after CREATE OR REPLACE VIEW, even on repeated runs.
        retained.append(entry)
    for name in sorted(AUTHORIZED_RAW_VIEWS):
        retained.append({"view": {
            "projectId": project, "datasetId": QUERY, "tableId": name,
        }})
    updated = dict(dataset)
    updated["access"] = retained
    return updated


def apply(project: str, planned: list[tuple[Path, str, str, str]]) -> None:
    # Verify both datasets and current ACL before any DDL is executed.
    ingest = read_dataset(project, INGEST)
    query = read_dataset(project, QUERY)
    authorize_views(ingest, project)
    if any(entry.get("specialGroup") in {"projectReaders", "allAuthenticatedUsers"}
           for entry in query.get("access", [])):
        raise ValueError("Query dataset has a broad reader grant")
    for path, kind, name, statement in planned:
        run(
            "bq", f"--project_id={project}", f"--location={REGION}",
            "query", "--use_legacy_sql=false", "--maximum_bytes_billed=1000000",
            statement,
        )
        print(f"Applied {path.name}: {kind} {name}")
    # Read the latest ACL so unrelated grants added during DDL remain present.
    updated = authorize_views(read_dataset(project, INGEST), project)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json") as source:
        json.dump(updated, source)
        source.flush()
        run(
            "bq", f"--project_id={project}", "update", f"--source={source.name}",
            f"{project}:{INGEST}",
        )
    print(f"Refreshed {len(AUTHORIZED_RAW_VIEWS)} authorized views on {INGEST}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-project")
    args = parser.parse_args()
    if not PROJECT_ID.fullmatch(args.project):
        parser.error("Invalid GCP project ID")
    if args.apply and args.confirm_project != args.project:
        parser.error("--apply requires --confirm-project to exactly match --project")
    try:
        planned = plan_sql()
        print(f"Project: {args.project}\nRegion: {REGION}")
        print(f"Datasets: {INGEST}, {QUERY}")
        for path in FILES:
            objects = [name for file_path, _, name, _ in planned if file_path == path]
            print(f"{path.name}: {len(objects)} object(s): {', '.join(objects)}")
        print(f"Direct raw-view grants ({len(AUTHORIZED_RAW_VIEWS)}): "
              + ", ".join(sorted(AUTHORIZED_RAW_VIEWS)))
        if not args.apply:
            print("Plan only. No cloud resources were changed.")
            return 0
        apply(args.project, planned)
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stderr.strip() or "GCP command failed", file=sys.stderr)
        else:
            print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
