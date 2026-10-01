"""Offline checks for the BigQuery schema deployment boundary."""

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("apply-sql.py")
SPEC = importlib.util.spec_from_file_location("melens_apply_sql", SCRIPT)
assert SPEC and SPEC.loader
apply_sql = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(apply_sql)


class ApplySqlTest(unittest.TestCase):
    def test_reviewed_sql_has_expected_objects_and_raw_view_allowlist(self):
        planned = apply_sql.plan_sql()
        self.assertEqual(sum(kind == "table" for _, kind, _, _ in planned), 13)
        self.assertEqual(sum(kind == "view" for _, kind, _, _ in planned), 25)
        self.assertEqual(len(apply_sql.AUTHORIZED_RAW_VIEWS), 13)

    def test_sql_split_ignores_semicolons_inside_comments_and_literals(self):
        statements = apply_sql.split_sql(
            "-- comment; ignored\nCREATE VIEW `x` AS SELECT ';' AS value;"
            "/* another; comment */ CREATE VIEW `y` AS SELECT 1;"
        )
        self.assertEqual(len(statements), 2)
        self.assertIn("SELECT ';' AS value", statements[0])

    def test_authorization_preserves_unrelated_acl_and_is_idempotent(self):
        project = "melens-510012"
        ingest_writer = {
            "role": "WRITER",
            "userByEmail": f"melens-dev-ingest@{project}.iam.gserviceaccount.com",
        }
        dataset = {"access": [ingest_writer]}
        first = apply_sql.authorize_views(dataset, project)
        second = apply_sql.authorize_views(first, project)
        self.assertEqual(first, second)
        self.assertIn(ingest_writer, second["access"])
        self.assertEqual(
            {entry["view"]["tableId"] for entry in second["access"] if "view" in entry},
            apply_sql.AUTHORIZED_RAW_VIEWS,
        )

    def test_authorization_rejects_direct_query_access_and_unreviewed_view(self):
        project = "melens-510012"
        with self.assertRaisesRegex(ValueError, "direct ingest"):
            apply_sql.authorize_views({"access": [{
                "role": "READER",
                "userByEmail": f"melens-dev-query@{project}.iam.gserviceaccount.com",
            }]}, project)
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            apply_sql.authorize_views({"access": [{"view": {
                "projectId": project,
                "datasetId": "melens_query",
                "tableId": "v_unreviewed",
            }}]}, project)


if __name__ == "__main__":
    unittest.main()
