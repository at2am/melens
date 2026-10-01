#!/usr/bin/env python3
"""Deploy the private source-content retention job; default is a local plan."""
import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import tempfile
from pathlib import Path

PROJECT = "melens-510012"
BUCKET = "melens-510012-dev-ingest"
REGION = "australia-southeast2"
LOCATION = "australia-southeast1"
JOB = "melens-dev-source-retention"
SOURCES = ("ticketmaster.events", "melbourne.parking.sensors", "gdelt.news")
ROLE = "melensRetentionBucketMetadata"
PERMISSIONS = {"storage.buckets.get", "storage.objects.list"}
IMAGE = re.compile(r"australia-southeast2-docker\.pkg\.dev/melens-510012/melens-data/[a-z0-9-]+@sha256:[a-f0-9]{64}\Z")


def cloud(*args):
    result = subprocess.run(["gcloud", *args, "--format=json", "--quiet"],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-project")
    args = parser.parse_args()
    print(json.dumps({"job": JOB, "sources": SOURCES, "cron_utc": "11 */6 * * *",
                      "ticketmaster_visibility_hours": 24, "ticketmaster_cleanup_age_hours": 18,
                      "mode": "apply" if args.apply else "plan"}))
    if not args.apply:
        return
    if args.confirm_project != PROJECT or not IMAGE.fullmatch(args.image or ""):
        raise ValueError("Apply requires the reviewed project and immutable image")
    module_path = Path(__file__).with_name("source-identities.py")
    spec = importlib.util.spec_from_file_location("source_identities", module_path)
    identity = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(identity)
    email = f"{JOB}@{PROJECT}.iam.gserviceaccount.com"
    member = f"serviceAccount:{email}"
    accounts = cloud("iam", "service-accounts", "list", f"--project={PROJECT}")
    if not any(account["email"] == email for account in accounts):
        cloud("iam", "service-accounts", "create", JOB, f"--project={PROJECT}",
              "--display-name=Melens source retention")
    policy = cloud("projects", "get-iam-policy", PROJECT)
    grants = identity.member_bindings(policy, member)
    if any(binding.get("role") != "roles/bigquery.jobUser" or binding.get("condition") for binding in grants):
        raise ValueError("Retention identity has unexpected project grants")
    cloud("projects", "add-iam-policy-binding", PROJECT, f"--member={member}",
          "--role=roles/bigquery.jobUser", "--condition=None")
    roles = cloud("iam", "roles", "list", f"--project={PROJECT}")
    if not any(role["name"] == f"projects/{PROJECT}/roles/{ROLE}" for role in roles):
        cloud("iam", "roles", "create", ROLE, f"--project={PROJECT}", "--stage=GA",
              "--title=Melens retention bucket metadata", f"--permissions={','.join(sorted(PERMISSIONS))}")
    role = cloud("iam", "roles", "describe", ROLE, f"--project={PROJECT}")
    if set(role["includedPermissions"]) != PERMISSIONS or role["stage"] != "GA":
        raise ValueError("Retention bucket role drift")
    base = f"projects/_/buckets/{BUCKET}/objects/"
    object_expression = " || ".join(
        [f"resource.name.startsWith('{base}{kind}/{source}/')"
         for source in SOURCES for kind in ("raw", "staging")]
        + [f"resource.name == '{base}locks/source_{hashlib.sha256(source.encode()).hexdigest()}.json'"
           for source in SOURCES])
    conditions = (("melensSourceObjects", "melens-retention-content", object_expression),
                  (ROLE, "melens-retention-bucket", f"resource.name == 'projects/_/buckets/{BUCKET}'"))
    for role_name, title, expression in conditions:
        cloud("storage", "buckets", "add-iam-policy-binding", f"gs://{BUCKET}",
              f"--member={member}", f"--role=projects/{PROJECT}/roles/{role_name}",
              f"--condition=title={title},expression={expression}")
    actual = identity.member_bindings(cloud("storage", "buckets", "get-iam-policy", f"gs://{BUCKET}"), member)
    expected = {(f"projects/{PROJECT}/roles/{role}", title, expression) for role, title, expression in conditions}
    if len(actual) != 2 or {(b["role"], b.get("condition", {}).get("title"),
                            b.get("condition", {}).get("expression")) for b in actual} != expected:
        raise ValueError("Retention bucket grants drift")
    for dataset in ("melens_ingest", "melens_query"):
        current = identity.read_dataset(identity.run_json, PROJECT, dataset)
        entries = [entry for entry in current.get("access", [])
                   if entry.get("userByEmail") == email or entry.get("iamMember") == member]
        if entries and (dataset != "melens_ingest" or len(entries) != 1 or entries[0].get("role") != "WRITER"):
            raise ValueError("Retention dataset grants drift")
        if dataset == "melens_ingest":
            updated = identity.authorize_dataset(current, [{"service_account_email": email}])
            with tempfile.NamedTemporaryFile("w", suffix=".json") as file:
                json.dump(updated, file); file.flush()
                identity.run_json("bq", f"--project_id={PROJECT}", "--format=prettyjson", "update",
                                  f"--source={file.name}", f"{PROJECT}:{dataset}")
    secrets = cloud("secrets", "list", f"--project={PROJECT}")
    for secret in secrets:
        if identity.member_bindings(cloud("secrets", "get-iam-policy", secret["name"], f"--project={PROJECT}"), member):
            raise ValueError("Retention identity must have no secret grants")
    env = (f"GOOGLE_CLOUD_PROJECT={PROJECT},GCP_REGION={REGION},GCS_BUCKET={BUCKET},"
           "BQ_INGEST_DATASET=melens_ingest,BQ_QUERY_DATASET=melens_query,BQ_MAXIMUM_BYTES_BILLED=500000000")
    cloud("run", "jobs", "deploy", JOB, f"--project={PROJECT}", f"--region={REGION}",
          f"--image={args.image}", f"--service-account={email}", "--tasks=1", "--parallelism=1",
          "--max-retries=0", "--task-timeout=600s", "--memory=512Mi", "--cpu=1",
          "--command=node", "--args=dist/src/jobs/source-retention.js", f"--set-env-vars={env}", "--clear-secrets")
    scheduler = f"melens-dev-scheduler@{PROJECT}.iam.gserviceaccount.com"
    cloud("run", "jobs", "add-iam-policy-binding", JOB, f"--project={PROJECT}", f"--region={REGION}",
          f"--member=serviceAccount:{scheduler}", "--role=roles/run.invoker")
    jobs = cloud("scheduler", "jobs", "list", f"--project={PROJECT}", f"--location={LOCATION}")
    name = JOB + "-schedule"
    action = "update" if any(job["name"].endswith("/" + name) for job in jobs) else "create"
    cloud("scheduler", "jobs", action, "http", name, f"--project={PROJECT}", f"--location={LOCATION}",
          "--schedule=11 */6 * * *", "--time-zone=Etc/UTC", "--http-method=POST",
          f"--uri=https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/jobs/{JOB}:run",
          f"--oauth-service-account-email={scheduler}", "--max-retry-attempts=0")
    job = cloud("run", "jobs", "describe", JOB, f"--project={PROJECT}", f"--region={REGION}")
    task = job["spec"]["template"]["spec"]["template"]["spec"]
    if task["serviceAccountName"] != email or task["containers"][0]["image"] != args.image:
        raise ValueError("Retention runtime readback mismatch")
    print("Private retention job and six-hour schedule deployed and read back")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError):
        raise SystemExit("Source retention deployment failed; inspect resource metadata")
