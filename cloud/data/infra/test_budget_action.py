import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


PATH = Path(__file__).with_name("budget-action.py")
SPEC = importlib.util.spec_from_file_location("budget_action", PATH)
budget_action = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(budget_action)
PROJECT = "melens-510012"
JOB = f"projects/{PROJECT}/locations/australia-southeast1/jobs/melens-dev-homes-victoria-rents-schedule"


class BudgetActionInfrastructureTest(unittest.TestCase):
    def setUp(self):
        self.config = json.loads(budget_action.CONFIG.read_text(encoding="utf-8"))

    def test_plan_derives_only_scheduled_non_p0_jobs(self):
        name, jobs = budget_action.config_plan(self.config, PROJECT)
        self.assertTrue(name.startswith("billingAccounts/"))
        self.assertIn(JOB, jobs)
        self.assertNotIn(
            f"projects/{PROJECT}/locations/australia-southeast1/jobs/melens-dev-melbourne-pedestrian-minute-schedule",
            jobs,
        )
        self.assertTrue(all(job.startswith(f"projects/{PROJECT}/locations/australia-southeast1/jobs/melens-dev-")
                            for job in jobs))

    def test_plan_rejects_budget_and_priority_drift(self):
        self.config["budget"]["monthly_amount_aud"] = 200
        with self.assertRaisesRegex(SystemExit, "AUD 100"):
            budget_action.config_plan(self.config, PROJECT)
        self.config["budget"]["monthly_amount_aud"] = 100
        self.config["sources"][0]["priority"] = "unknown"
        with self.assertRaisesRegex(SystemExit, "Unknown source priority"):
            budget_action.config_plan(self.config, PROJECT)

    def test_smoke_refuses_to_pause_an_active_source(self):
        jobs = [{"name": JOB, "state": "ENABLED"},
                {"name": f"projects/{PROJECT}/locations/australia-southeast1/jobs/{budget_action.SMOKE_JOB}",
                 "state": "PAUSED"}]
        with patch.object(budget_action, "cloud_json", return_value=jobs):
            with self.assertRaisesRegex(SystemExit, "active non-P0"):
                budget_action.deployed_jobs(PROJECT, {JOB}, include_smoke=True)

    def test_live_budget_must_match_project_and_actual_thresholds(self):
        name = self.config["budget"]["budget_resource_name"]
        topic = f"projects/{PROJECT}/topics/{budget_action.TOPIC}"
        live = {
            "name": name,
            "amount": {"specifiedAmount": {"currencyCode": "AUD", "units": "100"}},
            "budgetFilter": {"calendarPeriod": "MONTH", "projects": ["projects/12345"]},
            "thresholdRules": [
                {"thresholdPercent": value, "spendBasis": "CURRENT_SPEND"}
                for value in (0.5, 0.8, 1)
            ],
            "notificationsRule": {"disableDefaultIamRecipients": False},
        }
        with patch.object(budget_action, "cloud_json", return_value=live):
            self.assertEqual(budget_action.checked_budget(PROJECT, "12345", name, topic), live)
        live["thresholdRules"][2]["spendBasis"] = "FORECASTED_SPEND"
        with patch.object(budget_action, "cloud_json", return_value=live):
            with self.assertRaisesRegex(SystemExit, "Live budget differs"):
                budget_action.checked_budget(PROJECT, "12345", name, topic)


if __name__ == "__main__":
    unittest.main()
