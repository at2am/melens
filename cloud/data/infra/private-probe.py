#!/usr/bin/env python3
"""Create a bounded Transport Victoria probe with cloud-only secret injection."""
import argparse
import json
import re
import subprocess

PROJECT = "melens-510012"
REGION = "australia-southeast2"
BUCKET = "melens-510012-dev-ingest"
JOB = "melens-dev-transport-probe"
ACCOUNT = "melens-dev-transport-probe"
ROLE = "melensTransportProbeLedger"
SECRET = "transport_victoria_key_id"
SOURCES = ("victoria.transport.road_unplanned", "victoria.transport.road_planned",
           "victoria.transport.gtfs_realtime")
PERMISSIONS = {"storage.objects.get", "storage.objects.create",
               "storage.objects.update", "storage.objects.delete"}
IMAGE = re.compile(r"australia-southeast2-docker\.pkg\.dev/melens-510012/melens-data/"
                   r"[a-z0-9-]+@sha256:[0-9a-f]{64}")


def cloud(*args: str):
    result = subprocess.run(["gcloud", *args, "--format=json", "--quiet"],
                            capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f"Cloud operation failed: {' '.join(args[:3])}\n{result.stderr.strip()}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-project")
    args = parser.parse_args()
    print("Private cloud probe: three Transport Victoria candidate sources; no publication")
    print("Limits: 20 requests per execution, 100 per source per UTC day; no automatic retries")
    print("Secret access: transport_victoria_key_id only, pinned enabled version 1")
    print("Storage access: source request ledgers and execution locks only; no BigQuery grants")
    if not args.apply:
        return
    if args.confirm_project != PROJECT or not args.image or not IMAGE.fullmatch(args.image):
        raise SystemExit("Apply requires the reviewed project confirmation and immutable image")
    versions = cloud("secrets", "versions", "list", SECRET, f"--project={PROJECT}")
    if not any(item["name"].endswith("/versions/1") and item["state"] == "ENABLED"
               for item in versions):
        raise SystemExit("The pinned secret version is not enabled")
    email = f"{ACCOUNT}@{PROJECT}.iam.gserviceaccount.com"
    accounts = cloud("iam", "service-accounts", "list", f"--project={PROJECT}")
    if not any(item["email"] == email for item in accounts):
        cloud("iam", "service-accounts", "create", ACCOUNT, f"--project={PROJECT}",
              "--display-name=Melens bounded Transport probe")
    roles = cloud("iam", "roles", "list", f"--project={PROJECT}")
    role_name = f"projects/{PROJECT}/roles/{ROLE}"
    if not any(item["name"] == role_name for item in roles):
        cloud("iam", "roles", "create", ROLE, f"--project={PROJECT}",
              "--title=Melens Transport probe ledger", "--stage=GA",
              f"--permissions={','.join(sorted(PERMISSIONS))}")
    role = cloud("iam", "roles", "describe", ROLE, f"--project={PROJECT}")
    if set(role["includedPermissions"]) != PERMISSIONS or role["stage"] != "GA":
        raise SystemExit("Probe role has unexpected permissions")
    member = f"serviceAccount:{email}"
    project_policy = cloud("projects", "get-iam-policy", PROJECT)
    if any(member in item.get("members", []) for item in project_policy.get("bindings", [])):
        raise SystemExit("Probe identity has unexpected project-wide grants")
    base = f"projects/_/buckets/{BUCKET}/objects/"
    expression = " || ".join(
        f"resource.name == '{base}locks/scheduled/{source}.json' || "
        f"resource.name.startsWith('{base}request-limits/{source}/')"
        for source in SOURCES)
    cloud("storage", "buckets", "add-iam-policy-binding", f"gs://{BUCKET}",
          f"--member={member}", f"--role={role_name}",
          f"--condition=title=melens-transport-probe-ledgers,expression={expression}")
    policy = cloud("storage", "buckets", "get-iam-policy", f"gs://{BUCKET}")
    grants = [item for item in policy.get("bindings", []) if member in item.get("members", [])]
    if (len(grants) != 1 or grants[0]["role"] != role_name
            or grants[0].get("condition", {}).get("expression") != expression):
        raise SystemExit("Probe bucket grants differ from reviewed source paths")
    cloud("secrets", "add-iam-policy-binding", SECRET, f"--project={PROJECT}",
          f"--member={member}", "--role=roles/secretmanager.secretAccessor")
    jobs = cloud("run", "jobs", "list", f"--project={PROJECT}", f"--region={REGION}")
    operation = "update" if any(item["metadata"]["name"] == JOB for item in jobs) else "create"
    cloud("run", "jobs", operation, JOB, f"--project={PROJECT}", f"--region={REGION}",
          f"--image={args.image}", f"--service-account={email}", "--command=node",
          "--args=dist/src/jobs/private-probe.js", "--tasks=1", "--parallelism=1",
          "--max-retries=0", "--task-timeout=600s", "--memory=1Gi", "--cpu=1",
          f"--set-env-vars=GOOGLE_CLOUD_PROJECT={PROJECT},GCS_BUCKET={BUCKET},"
          f"MELENS_SOURCE_ID={SOURCES[0]}",
          f"--set-secrets=TRANSPORT_VICTORIA_KEY_ID={SECRET}:1")
    job = cloud("run", "jobs", "describe", JOB, f"--project={PROJECT}", f"--region={REGION}")
    task = job["spec"]["template"]["spec"]["template"]["spec"]
    container = task["containers"][0]
    reference = next(item for item in container["env"]
                     if item["name"] == "TRANSPORT_VICTORIA_KEY_ID")["valueFrom"]["secretKeyRef"]
    if (task["serviceAccountName"] != email or task["maxRetries"] != 0
            or container["image"] != args.image or reference["name"] != SECRET
            or reference["key"] != "1"):
        raise SystemExit("Private probe deployment did not read back as configured")
    print("Private probe installed and read back. Execute each source sequentially.")


if __name__ == "__main__":
    main()
