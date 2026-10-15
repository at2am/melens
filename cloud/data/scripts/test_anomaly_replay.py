"""Offline checks for the replay anomaly computation."""

import importlib.util
import unittest
from datetime import date, timedelta
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("anomaly_replay", Path(__file__).with_name("anomaly_replay.py"))
assert SPEC and SPEC.loader
replay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replay)

DAY = date(2025, 9, 27)


def history(sensor: str, hour: int, value: int, days: int = 7) -> dict:
    return {(sensor, DAY - timedelta(days=offset), hour): value for offset in range(1, days + 1)}


class ClassifyTest(unittest.TestCase):
    def test_a_surge_against_the_mean_of_seven_days_is_anomalous(self):
        counts = {**history("1", 14, 600), ("1", DAY, 14): 8_000}
        [row] = replay.classify(counts, DAY)
        self.assertEqual((row["observed"], row["baseline"], row["direction"]), (8_000, 600.0, "higher"))
        self.assertEqual(row["delta"], 7_400.0)

    def test_a_drop_is_lower(self):
        counts = {**history("1", 9, 2_000), ("1", DAY, 9): 400}
        self.assertEqual(replay.classify(counts, DAY)[0]["direction"], "lower")

    def test_small_changes_and_quiet_hours_do_not_qualify(self):
        counts = {**history("1", 3, 2), ("1", DAY, 3): 40,  # large share, tiny count
                  **history("2", 12, 5_000), ("2", DAY, 12): 5_400}  # large count, small share
        self.assertEqual(replay.classify(counts, DAY), [])

    def test_a_missing_baseline_day_leaves_the_hour_unclassified(self):
        counts = {**history("1", 14, 600, days=6), ("1", DAY, 14): 8_000}
        self.assertEqual(replay.classify(counts, DAY), [])

    def test_only_the_strongest_hours_per_sensor_are_kept(self):
        counts = {}
        for hour, observed in ((10, 3_000), (11, 4_000), (12, 5_000), (13, 6_000)):
            counts.update(history("1", hour, 500))
            counts[("1", DAY, hour)] = observed
        hours = [row["hour"] for row in replay.classify(counts, DAY)]
        self.assertEqual(hours, [13, 12, 11])

    def test_the_hour_window_follows_melbourne_daylight_saving(self):
        start, end = replay.hour_window(date(2025, 9, 27), 12)  # AEST, UTC+10
        self.assertEqual(start.isoformat(), "2025-09-27T02:00:00+00:00")
        self.assertEqual((end - start).total_seconds(), 3_600)
        start, _ = replay.hour_window(date(2025, 10, 15), 12)  # AEDT, UTC+11
        self.assertEqual(start.isoformat(), "2025-10-15T01:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
