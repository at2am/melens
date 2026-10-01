"""Behavior checks for source runtime IAM planning and cloud readback."""

import contextlib
import copy
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PATH = Path(__file__).with_name("source-identities.py")
SPEC = importlib.util.spec_from_file_location("source_identities", PATH)
source_identities = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source_identities)
PROJECT = "melens-510012"
BUCKET = "melens-510012-dev-ingest"
SOURCE = "melbourne.municipal_boundary"


class FakeCloud:
    """Persist mutations and return a fresh cloud-shaped readback for each call."""

    def __init__(self, planned):
        self.planned = planned
        self.calls = []
        self.state = {
            "project": {"bindings": []}, "bucket": {"version": 3, "bindings": []},
            "datasets": {
                "melens_ingest": {"datasetReference": {"projectId": PROJECT, "datasetId": "melens_ingest"},
                                  "location": "australia-southeast2", "access": [{"view": {
                                      "projectId": PROJECT, "datasetId": "melens_query", "tableId": "v_boundaries"}}]},
                "melens_query": {"datasetReference": {"projectId": PROJECT, "datasetId": "melens_query"},
                                 "location": "australia-southeast2", "access": []},
            },
            "secrets": {f"projects/{PROJECT}/secrets/transport_victoria_key_id": {"bindings": []}},
            "accounts": {}, "keys": {}, "ancestors": [],
        }
        self.roles = {}
        self.job_email = None
        self.job_policy = {"bindings": []}

    def __call__(self, *args):
        self.calls.append(args)
        result = self.dispatch(args)
        return copy.deepcopy(result)

    @staticmethod
    def option(args, prefix):
        return next(arg[len(prefix):] for arg in args if arg.startswith(prefix))

    @staticmethod
    def add_binding(policy, args):
        member = FakeCloud.option(args, "--member=")
        role = FakeCloud.option(args, "--role=")
        condition = FakeCloud.option(args, "--condition=")
        binding = {"role": role, "members": [member]}
        if condition != "None":
            title, expression = condition.split(",expression=", 1)
            binding["condition"] = {"title": title.removeprefix("title="), "expression": expression}
        for existing in policy["bindings"]:
            if existing["role"] == role and existing.get("condition") == binding.get("condition"):
                existing["members"] = sorted(set(existing["members"] + [member]))
                return policy
        policy["bindings"].append(binding)
        return policy

    def dispatch(self, args):
        if args[0] == "bq":
            if "ls" in args:
                return [{"datasetReference": value["datasetReference"]} for value in self.state["datasets"].values()]
            if "show" in args:
                return self.state["datasets"][args[-1].split(":")[1]]
            if "update" in args:
                value = json.loads(Path(self.option(args, "--source=")).read_text())
                self.state["datasets"][args[-1].split(":")[1]] = value
                return value
        command = args[1:]
        if command[:2] == ("projects", "get-iam-policy"):
            return self.state["project"]
        if command[:2] == ("projects", "get-ancestors"):
            return [{"id": PROJECT, "type": "project"}] + [
                {"id": name, "type": kind} for kind, name, _ in self.state["ancestors"]]
        if command[:2] == ("projects", "add-iam-policy-binding"):
            return self.add_binding(self.state["project"], args)
        if command[:3] == ("storage", "buckets", "get-iam-policy"):
            return self.state["bucket"]
        if command[:3] == ("storage", "buckets", "add-iam-policy-binding"):
            return self.add_binding(self.state["bucket"], args)
        if command[:2] == ("secrets", "list"):
            return [{"name": name} for name in self.state["secrets"]]
        if command[:2] == ("secrets", "get-iam-policy"):
            return self.state["secrets"][command[2]]
        if command[:3] == ("iam", "service-accounts", "list"):
            return list(self.state["accounts"].values())
        if command[:3] == ("iam", "service-accounts", "create"):
            email = f"{command[3]}@{PROJECT}.iam.gserviceaccount.com"
            self.state["accounts"][email] = {"email": email}
            return self.state["accounts"][email]
        if command[:4] == ("iam", "service-accounts", "keys", "list"):
            self.assert_user_key_filter(args)
            return self.state["keys"].get(self.option(args, "--iam-account="), [])
        if command[:3] == ("iam", "roles", "list"):
            return list(self.roles.values())
        if command[:3] == ("iam", "roles", "describe"):
            return self.roles[command[3]]
        if command[:3] == ("iam", "roles", "create"):
            name = command[3]
            self.roles[name] = {"name": f"projects/{PROJECT}/roles/{name}", "stage": "GA",
                                "includedPermissions": self.option(args, "--permissions=").split(",")}
            return self.roles[name]
        if command[:3] == ("resource-manager", "folders", "get-iam-policy"):
            return next(policy for kind, name, policy in self.state["ancestors"]
                        if kind == "folder" and name == command[3])
        if command[:2] == ("organizations", "get-iam-policy"):
            return next(policy for kind, name, policy in self.state["ancestors"]
                        if kind == "organization" and name == command[2])
        if command[:3] == ("run", "jobs", "describe"):
            return {"spec": {"template": {"spec": {"template": {"spec": {
                "serviceAccountName": self.job_email}}}}}}
        if command[:3] == ("run", "jobs", "get-iam-policy"):
            return self.job_policy
        raise AssertionError(f"Unexpected cloud call: {args}")

    @staticmethod
    def assert_user_key_filter(args):
        if "--managed-by=user" not in args:
            raise AssertionError("Key inventory must inspect user-managed keys only")


class SourceIdentityTest(unittest.TestCase):
    def setUp(self):
        self.plan = source_identities.plan(PROJECT, "dev", BUCKET, [SOURCE])
        self.cloud = FakeCloud(self.plan)
        self.email = self.plan["sources"][0]["service_account_email"]
        self.member = "serviceAccount:" + self.email

    def installed(self):
        result = source_identities.provision(self.cloud, self.plan)
        self.assertTrue(result["sources"][0]["dedicated_identity_permissions_verified"])
        return result

    def test_plan_has_six_unique_short_identities_and_per_source_lease(self):
        planned = source_identities.plan(PROJECT, "dev", BUCKET, [])
        names = [source["account_id"] for source in planned["sources"]]
        self.assertEqual(len(names), 6)
        self.assertEqual(len(set(names)), 6)
        for source in planned["sources"]:
            self.assertLessEqual(len(source["account_id"]), 30)
            self.assertEqual(source["account_id"], source_identities.account_id(source["source_id"], "dev"))
            self.assertNotEqual(source["account_id"], source_identities.account_id(source["source_id"], "prod"))
            expression = source["object_condition"]
            self.assertIn(f"raw/{source['source_id']}/", expression)
            self.assertIn(f"staging/{source['source_id']}/", expression)
            self.assertIn(f"locks/scheduled/{source['source_id']}.json", expression)
            self.assertIn("locks/source_", expression)
            self.assertNotIn("storage.objects.list", planned["storage_role_permissions"][source_identities.OBJECT_ROLE])
        self.assertTrue(planned["shared_ingest_dataset_access"])

    def test_default_cli_plan_calls_no_cloud_and_unknown_source_rejected(self):
        with patch.object(source_identities, "run_json", side_effect=AssertionError("Cloud called")):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(source_identities.main([
                    "--project", PROJECT, "--environment", "dev", "--bucket", BUCKET]), 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["mode"], "plan")
            self.assertFalse(result["sources"][0]["dedicated_identity_permissions_verified"])
        with self.assertRaisesRegex(ValueError, "unreviewed"):
            source_identities.plan(PROJECT, "dev", BUCKET, ["victoria.transport.gtfs_realtime"])

    def test_apply_requires_explicit_sources_and_exact_confirmation(self):
        base = ["--project", PROJECT, "--environment", "dev", "--bucket", BUCKET, "--apply"]
        with patch.object(source_identities, "run_json", side_effect=AssertionError("Cloud called")):
            for extra in (["--confirm-project", PROJECT], ["--source", SOURCE, "--confirm-project", "different-project"]):
                with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as raised:
                        source_identities.main(base + extra)
                    self.assertEqual(raised.exception.code, 2)

    def test_bq_update_success_sentence_is_ignored_and_read_json_is_strict(self):
        result = subprocess.CompletedProcess(["bq"], 0, "Dataset successfully updated.\n", "")
        with patch.object(source_identities.subprocess, "run", return_value=result):
            self.assertIsNone(source_identities.run_json("bq", "--format=prettyjson", "update", "project:dataset"))
            with self.assertRaises(json.JSONDecodeError):
                source_identities.run_json("bq", "show", "--format=prettyjson", "project:dataset")

    def test_plan_rejects_admission_secret_drift_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "municipal"
            path.mkdir()
            (path / "source.json").write_text(json.dumps({"source_id": SOURCE,
                "access_status": "active", "license_status": "verified_open",
                "admission_evidence": {"secret_names": ["unexpected_key"]}}))
            with self.assertRaisesRegex(ValueError, "admission"):
                source_identities.plan(PROJECT, "dev", BUCKET, [SOURCE], root)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            source_identities.plan(PROJECT, "dev", BUCKET, [SOURCE, SOURCE])

    def test_provision_is_idempotent_and_preserves_authorized_views(self):
        first = self.installed()
        state = copy.deepcopy(self.cloud.state)
        second = self.installed()
        self.assertEqual(first, second)
        self.assertEqual(state, self.cloud.state)
        self.assertEqual(sum(call[1:4] == ("iam", "service-accounts", "create") for call in self.cloud.calls), 1)
        self.assertEqual(sum(call[1:4] == ("iam", "roles", "create") for call in self.cloud.calls), 2)
        self.assertEqual(len(self.cloud.state["datasets"]["melens_ingest"]["access"]), 2)

    def test_verify_only_has_no_mutations_and_reads_secret_iam_never_values(self):
        self.installed()
        self.cloud.calls.clear()
        with patch.object(source_identities, "run_json", self.cloud):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(source_identities.main(["--project", PROJECT,
                    "--environment", "dev", "--bucket", BUCKET,
                    "--source", SOURCE, "--verify-only"]), 0)
        mutations = {"create", "update", "add-iam-policy-binding", "set-iam-policy", "access"}
        self.assertFalse(any(mutations.intersection(call) for call in self.cloud.calls))
        self.assertTrue(any(call[1:3] == ("secrets", "get-iam-policy") for call in self.cloud.calls))
        self.assertFalse(any("versions" in call for call in self.cloud.calls))

    def test_secret_inventory_accepts_project_number_resource_names(self):
        self.plan['sources'][0]['secret_names'] = ['transport_victoria_key_id']
        actual = source_identities.snapshot(self.cloud, self.plan)
        actual['secrets'] = {'projects/401001961508/secrets/transport_victoria_key_id': {'bindings': []}}
        source_identities.audit(self.plan, actual, False)
        actual['secrets'] = {'projects/401001961508/secrets/other_key': {'bindings': []}}
        with self.assertRaisesRegex(ValueError, 'Required secret is missing'):
            source_identities.audit(self.plan, actual, False)

    def test_unconditional_bucket_access_fails_before_any_cloud_write(self):
        self.cloud.state["bucket"]["bindings"].append({"role": "roles/storage.objectAdmin", "members": [self.member]})
        with self.assertRaisesRegex(ValueError, "Unexpected bucket"):
            source_identities.provision(self.cloud, self.plan)
        self.assertFalse(any("create" in call or "add-iam-policy-binding" in call or "update" in call
                             for call in self.cloud.calls))

    def test_verification_rejects_project_secret_dataset_and_key_drift(self):
        self.installed()
        original = copy.deepcopy(self.cloud.state)
        mutations = [
            (lambda: self.cloud.state["project"]["bindings"].append({"role": "roles/secretmanager.secretAccessor", "members": [self.member]}), "project grant"),
            (lambda: next(iter(self.cloud.state["secrets"].values()))["bindings"].append({"role": "roles/secretmanager.secretAccessor", "members": [self.member]}), "Secret Manager"),
            (lambda: self.cloud.state["datasets"]["melens_query"]["access"].append({"role": "READER", "userByEmail": self.email}), "dataset grant"),
            (lambda: self.cloud.state["keys"].update({self.email: [{"name": "unexpected-key"}]}), "user-managed keys"),
        ]
        for mutate, message in mutations:
            with self.subTest(message=message):
                self.cloud.state = copy.deepcopy(original)
                mutate()
                with self.assertRaisesRegex(ValueError, message):
                    source_identities.verify(self.cloud, self.plan)

    def test_verification_rejects_role_permission_drift_and_missing_grants(self):
        self.installed()
        self.cloud.roles[source_identities.OBJECT_ROLE]["includedPermissions"].append("storage.objects.list")
        with self.assertRaisesRegex(ValueError, "permission drift"):
            source_identities.verify(self.cloud, self.plan)
        self.cloud.roles[source_identities.OBJECT_ROLE]["includedPermissions"].remove("storage.objects.list")
        self.cloud.state["bucket"]["bindings"].clear()
        with self.assertRaisesRegex(ValueError, "Bucket grants missing"):
            source_identities.verify(self.cloud, self.plan)

    def test_verification_checks_ancestor_grants(self):
        self.installed()
        self.cloud.state["ancestors"] = [("folder", "123", {"bindings": [
            {"role": "roles/editor", "members": [self.member]}]})]
        with self.assertRaisesRegex(ValueError, "ancestor grant"):
            source_identities.verify(self.cloud, self.plan)

    def test_optional_job_verification_requires_expected_runtime_and_exact_invoker(self):
        self.installed()
        self.cloud.job_email = self.email
        scheduler = f"serviceAccount:melens-dev-scheduler@{PROJECT}.iam.gserviceaccount.com"
        self.cloud.job_policy = {"bindings": [{"role": "roles/run.invoker", "members": [scheduler]}]}
        result = source_identities.verify(self.cloud, self.plan, verify_jobs=True)
        self.assertTrue(result["jobs_verified"])
        self.cloud.job_email = f"melens-dev-ingest@{PROJECT}.iam.gserviceaccount.com"
        with self.assertRaisesRegex(ValueError, "runtime identity mismatch"):
            source_identities.verify(self.cloud, self.plan, verify_jobs=True)
        self.cloud.job_email = self.email
        self.cloud.job_policy["bindings"][0]["members"] = ["allUsers"]
        with self.assertRaisesRegex(ValueError, "Public IAM"):
            source_identities.verify(self.cloud, self.plan, verify_jobs=True)


if __name__ == "__main__":
    unittest.main()
