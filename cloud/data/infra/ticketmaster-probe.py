#!/usr/bin/env python3
"""Install a bounded Ticketmaster probe with cloud-only secret injection."""
import argparse
import json
import re
import subprocess

PROJECT = "melens-510012"
REGION = "australia-southeast2"
BUCKET = "melens-510012-dev-ingest"
JOB = "melens-dev-ticketmaster-probe"
ACCOUNT = "melens-dev-ticketmaster-probe"
ROLE = "melensTicketmasterProbeLedger"
SECRET = "ticketmaster_discovery_api_key"
SOURCE = "ticketmaster.events"
PERMISSIONS = {"storage.objects.get", "storage.objects.create",
               "storage.objects.update", "storage.objects.delete"}
IMAGE = re.compile(r"australia-southeast2-docker\.pkg\.dev/melens-510012/melens-data/"
                   r"[a-z0-9-]+@sha256:[0-9a-f]{64}")


def cloud(*args: str):
    result = subprocess.run(["gcloud", *args, "--format=json", "--quiet"],
                            capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f"Cloud operation failed: {' '.join(args[:3])}")
    try:
        return json.loads(result.stdout) if result.stdout.strip() else None
    except json.JSONDecodeError:
        raise SystemExit("Cloud operation returned invalid metadata") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-project")
    args = parser.parse_args()
    print("Private Ticketmaster future-30-day probe; no publication or content storage")
    print("Limits: 10 requests per execution, 40 per UTC day; no retries or redirects")
    print("Secret: ticketmaster_discovery_api_key, enabled version 1, cloud injection only")
    print("Storage: Ticketmaster request ledger and lock only; no BigQuery grants")
    if not args.apply:
        return
    if args.confirm_project != PROJECT or not args.image or not IMAGE.fullmatch(args.image):
        raise SystemExit("Apply requires the reviewed project and immutable image")
    versions = cloud("secrets", "versions", "list", SECRET, f"--project={PROJECT}")
    if not any(item.get("name", "").endswith("/versions/1")
               and item.get("state") == "ENABLED" for item in versions):
        raise SystemExit("Pinned Ticketmaster secret version 1 is not enabled")
    email = f"{ACCOUNT}@{PROJECT}.iam.gserviceaccount.com"
    accounts = cloud("iam", "service-accounts", "list", f"--project={PROJECT}")
    if not any(item.get("email") == email for item in accounts):
        cloud("iam", "service-accounts", "create", ACCOUNT, f"--project={PROJECT}",
              "--display-name=Melens bounded Ticketmaster probe")
    role_name = f"projects/{PROJECT}/roles/{ROLE}"
    roles = cloud("iam", "roles", "list", f"--project={PROJECT}")
    if not any(item.get("name") == role_name for item in roles):
        cloud("iam", "roles", "create", ROLE, f"--project={PROJECT}",
              "--title=Melens Ticketmaster probe ledger", "--stage=GA",
              f"--permissions={','.join(sorted(PERMISSIONS))}")
    role = cloud("iam", "roles", "describe", ROLE, f"--project={PROJECT}")
    if set(role.get("includedPermissions", [])) != PERMISSIONS or role.get("stage") != "GA":
        raise SystemExit("Ticketmaster probe role has unexpected permissions")
    member = f"serviceAccount:{email}"
    project_policy = cloud("projects", "get-iam-policy", PROJECT)
    if any(member in binding.get("members", [])
           for binding in project_policy.get("bindings", [])):
        raise SystemExit("Ticketmaster probe identity has unexpected project-wide grants")
    base = f"projects/_/buckets/{BUCKET}/objects/"
    expression = (f"resource.name == '{base}locks/scheduled/{SOURCE}.json' || "
                  f"resource.name.startsWith('{base}request-limits/{SOURCE}/')")
    cloud("storage", "buckets", "add-iam-policy-binding", f"gs://{BUCKET}",
          f"--member={member}", f"--role={role_name}",
          f"--condition=title=melens-ticketmaster-probe-ledgers,expression={expression}")
    policy = cloud("storage", "buckets", "get-iam-policy", f"gs://{BUCKET}")
    grants = [binding for binding in policy.get("bindings", [])
              if member in binding.get("members", [])]
    if (len(grants) != 1 or grants[0].get("role") != role_name
            or grants[0].get("condition", {}).get("expression") != expression):
        raise SystemExit("Probe bucket grants differ from the reviewed Ticketmaster paths")
    cloud("secrets", "add-iam-policy-binding", SECRET, f"--project={PROJECT}",
          f"--member={member}", "--role=roles/secretmanager.secretAccessor")
    secret_policy = cloud("secrets", "get-iam-policy", SECRET, f"--project={PROJECT}")
    secret_grants = [binding for binding in secret_policy.get("bindings", [])
                     if member in binding.get("members", [])]
    if (len(secret_grants) != 1
            or secret_grants[0].get("role") != "roles/secretmanager.secretAccessor"):
        raise SystemExit("Probe secret grants differ from the reviewed accessor scope")
    jobs = cloud("run", "jobs", "list", f"--project={PROJECT}", f"--region={REGION}")
    operation = "update" if any(item.get("metadata", {}).get("name") == JOB
                                for item in jobs) else "create"
    cloud("run", "jobs", operation, JOB, f"--project={PROJECT}", f"--region={REGION}",
          f"--image={args.image}", f"--service-account={email}", "--command=node",
          "--args=dist/src/jobs/ticketmaster-probe.js", "--tasks=1", "--parallelism=1",
          "--max-retries=0", "--task-timeout=300s", "--memory=1Gi", "--cpu=1",
          f"--set-env-vars=GOOGLE_CLOUD_PROJECT={PROJECT},GCS_BUCKET={BUCKET},"
          f"MELENS_SOURCE_ID={SOURCE}",
          f"--set-secrets=TICKETMASTER_DISCOVERY_API_KEY={SECRET}:1")
    job = cloud("run", "jobs", "describe", JOB, f"--project={PROJECT}", f"--region={REGION}")
    task = job["spec"]["template"]["spec"]["template"]["spec"]
    container = task["containers"][0]
    reference = next(item for item in container["env"]
                     if item["name"] == "TICKETMASTER_DISCOVERY_API_KEY")["valueFrom"]["secretKeyRef"]
    if (task["serviceAccountName"] != email or task["maxRetries"] != 0
            or container["image"] != args.image or reference["name"] != SECRET
            or reference["key"] != "1" or container.get("command") != ["node"]
            or container.get("args") != ["dist/src/jobs/ticketmaster-probe.js"]):
        raise SystemExit("Ticketmaster private probe did not read back as configured")
    print("Ticketmaster private probe installed and metadata verified")


if __name__ == "__main__":
    main()
