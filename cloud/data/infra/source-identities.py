#!/usr/bin/env python3
"""Plan, provision or verify dedicated runtime identities for admitted sources.

Plan mode reads only local manifests. Cloud changes require --apply, explicit
--source selection and --confirm-project. --verify-only performs cloud reads.
The shared ingestion dataset permits access to every source's ingestion rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parent.parent
REGION = "australia-southeast2"
INGEST = "melens_ingest"
PROJECT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]\Z")
DEFAULT_SOURCES = frozenset({
    "melbourne.municipal_boundary", "melbourne.clue.blocks",
    "abs.asgs.boundaries", "melbourne.development_monitor",
    "homes_victoria.rents", "abs.census",
})
SOURCES = DEFAULT_SOURCES | frozenset({
    "melbourne.parking.bays", "melbourne.parking.sensors",
    "melbourne.parking.restrictions", "gdelt.news",
    "victoria.csa.recorded_offences", "ticketmaster.events",
    "user.events", "victoria.transport.road_planned", "victoria.transport.road_unplanned",
})
SOURCE_SECRETS = {
    "ticketmaster.events": ["ticketmaster_discovery_api_key"],
    "victoria.transport.road_planned": ["transport_victoria_key_id"],
    "victoria.transport.road_unplanned": ["transport_victoria_key_id"],
}
# Content under a provider or user licence rather than an open-data licence.
RESTRICTED_SOURCES = frozenset({"ticketmaster.events", "user.events"})
QUERY_READ_SOURCES = frozenset({"gdelt.news", "melbourne.parking.sensors"})
OBJECT_ROLE = "melensSourceObjects"
BUCKET_ROLE = "melensSourceBucketMetadata"
PERMISSIONS = {
    OBJECT_ROLE: frozenset({"storage.objects.get", "storage.objects.create",
                            "storage.objects.update", "storage.objects.delete"}),
    BUCKET_ROLE: frozenset({"storage.buckets.get"}),
}
PUBLIC_MEMBERS = frozenset({"allUsers", "allAuthenticatedUsers"})
Runner = Callable[..., object]


def run_json(*args: str) -> object:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    # bq update prints a success sentence even with --format=prettyjson.
    # Its outcome is checked by the subsequent fresh dataset readback.
    if args[0] == "bq" and "update" in args:
        return None
    return json.loads(result.stdout) if result.stdout.strip() else None


def cloud(run: Runner, *args: str) -> object:
    return run("gcloud", *args, "--format=json", "--quiet")


def account_id(source: str, environment: str) -> str:
    if source not in SOURCES or environment not in {"dev", "prod"}:
        raise ValueError("Unknown reviewed source or environment")
    prefix = f"melens-{environment}-"
    suffix = "-" + hashlib.sha256(source.encode()).hexdigest()[:10]
    slug = re.sub(r"[._]", "-", source)[:30 - len(prefix) - len(suffix)]
    return prefix + slug.rstrip("-") + suffix


def object_condition(source: str, bucket: str) -> str:
    base = f"projects/_/buckets/{bucket}/objects/"
    lease = hashlib.sha256(source.encode()).hexdigest()
    exact = [f"checkpoints/{source}.json", f"locks/scheduled/{source}.json",
             f"locks/source_{lease}.json"]
    prefixes = [f"raw/{source}/", f"staging/{source}/", f"request-limits/{source}/"]
    return " || ".join(
        [f"resource.name == '{base}{name}'" for name in exact]
        + [f"resource.name.startsWith('{base}{name}')" for name in prefixes])


def plan(project: str, environment: str, bucket: str,
         selected: list[str], connector_root: Path | None = None) -> dict:
    if not PROJECT.fullmatch(project) or not BUCKET.fullmatch(bucket):
        raise ValueError("Invalid project ID or bucket name")
    if environment not in {"dev", "prod"}:
        raise ValueError("Environment must be dev or prod")
    if len(set(selected)) != len(selected) or any(source not in SOURCES for source in selected):
        raise ValueError("Duplicate or unreviewed selected source")
    manifests = {}
    for path in (connector_root or ROOT / "src/connectors").glob("*/source.json"):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        source = manifest.get("source_id")
        if source in manifests:
            raise ValueError(f"Duplicate source manifest: {source}")
        manifests[source] = manifest
    sources = []
    for source in sorted(selected or DEFAULT_SOURCES):
        manifest = manifests.get(source, {})
        evidence = manifest.get("admission_evidence") or {}
        if (manifest.get("access_status") != "active"
                or manifest.get("license_status") != ("restricted" if source in RESTRICTED_SOURCES else "verified_open")
                or evidence.get("secret_names", []) != SOURCE_SECRETS.get(source, [])):
            raise ValueError(f"Source admission or secret allowlist drift: {source}")
        identity = account_id(source, environment)
        sources.append({
            "source_id": source,
            "account_id": identity,
            "service_account_email": f"{identity}@{project}.iam.gserviceaccount.com",
            "object_condition": object_condition(source, bucket),
            "condition_title": identity + "-objects",
            "secret_names": SOURCE_SECRETS.get(source, []),
            "job_name": f"melens-{environment}-{source.replace('.', '-').replace('_', '-')}",
            "dedicated_identity_permissions_verified": False,
        })
    return {
        "project": project, "environment": environment, "bucket": bucket,
        "region": REGION, "ingest_dataset": INGEST,
        "sources": sources,
        "project_roles": ["roles/bigquery.jobUser"],
        "ingest_dataset_role": "WRITER",
        "storage_role_permissions": {name: sorted(values) for name, values in PERMISSIONS.items()},
        "bucket_condition": f"resource.name == 'projects/_/buckets/{bucket}'",
        "shared_ingest_dataset_access": True,
        "verification_scope": "Direct identity and public grants on project, ancestors, bucket, all project datasets and secrets; user-managed keys. Group memberships and other projects are not inspected.",
        "jobs_verified": False,
    }


def member_bindings(policy: dict, member: str) -> list[dict]:
    return [binding for binding in policy.get("bindings", [])
            if member in binding.get("members", [])]


def require_no_public(policy: dict, scope: str) -> None:
    if any(PUBLIC_MEMBERS.intersection(binding.get("members", []))
           for binding in policy.get("bindings", [])):
        raise ValueError(f"Public IAM grant found on {scope}")


def read_dataset(run: Runner, project: str, name: str) -> dict:
    value = run("bq", f"--project_id={project}", "show", "--format=prettyjson", f"{project}:{name}")
    if not isinstance(value, dict):
        raise ValueError(f"Dataset could not be read: {name}")
    reference = value.get("datasetReference", {})
    if reference.get("projectId") != project or reference.get("datasetId") != name:
        raise ValueError(f"Dataset identity mismatch: {name}")
    return value


def snapshot(run: Runner, planned: dict) -> dict:
    project = planned["project"]
    project_policy = cloud(run, "projects", "get-iam-policy", project)
    bucket_policy = cloud(run, "storage", "buckets", "get-iam-policy", f"gs://{planned['bucket']}")
    datasets_list = run("bq", f"--project_id={project}", "ls", "--format=prettyjson", "--max_results=10000")
    secrets_list = cloud(run, "secrets", "list", f"--project={project}", "--limit=10000")
    if (not isinstance(datasets_list, list) or not isinstance(secrets_list, list)
            or len(datasets_list) >= 10000 or len(secrets_list) >= 10000):
        raise ValueError("Dataset or secret inventory is incomplete")
    datasets = {item["datasetReference"]["datasetId"]:
                read_dataset(run, project, item["datasetReference"]["datasetId"])
                for item in datasets_list}
    if INGEST not in datasets or datasets[INGEST].get("location", "").lower() != REGION:
        raise ValueError("Ingestion dataset missing or outside reviewed region")
    secrets = {item["name"]: cloud(run, "secrets", "get-iam-policy", item["name"], f"--project={project}")
               for item in secrets_list}
    accounts = cloud(run, "iam", "service-accounts", "list", f"--project={project}", "--limit=10000")
    if not isinstance(accounts, list) or len(accounts) >= 10000:
        raise ValueError("Service account inventory is incomplete")
    by_email = {item["email"]: item for item in accounts}
    keys = {source["service_account_email"]:
            cloud(run, "iam", "service-accounts", "keys", "list", f"--project={project}",
                  f"--iam-account={source['service_account_email']}", "--managed-by=user")
            for source in planned["sources"] if source["service_account_email"] in by_email}
    ancestors = cloud(run, "projects", "get-ancestors", project)
    ancestor_policies = []
    for ancestor in ancestors or []:
        kind = ancestor.get("type")
        if kind == "folder":
            policy = cloud(run, "resource-manager", "folders", "get-iam-policy", str(ancestor["id"]))
        elif kind == "organization":
            policy = cloud(run, "organizations", "get-iam-policy", str(ancestor["id"]))
        else:
            continue
        ancestor_policies.append((kind, policy))
    return {"project": project_policy, "bucket": bucket_policy,
            "datasets": datasets, "secrets": secrets, "accounts": by_email,
            "keys": keys, "ancestors": ancestor_policies}


def audit(planned: dict, actual: dict, require_complete: bool) -> None:
    project = planned["project"]
    require_no_public(actual["project"], "project")
    require_no_public(actual["bucket"], "bucket")
    for kind, policy in actual["ancestors"]:
        require_no_public(policy, kind)
    for name, policy in actual["secrets"].items():
        require_no_public(policy, f"secret {name}")
    for name, dataset in actual["datasets"].items():
        if any(entry.get("specialGroup") == "allAuthenticatedUsers"
               or entry.get("iamMember") in PUBLIC_MEMBERS for entry in dataset.get("access", [])):
            raise ValueError(f"Public dataset grant found: {name}")
    for source in planned["sources"]:
        email = source["service_account_email"]
        member = f"serviceAccount:{email}"
        account = actual["accounts"].get(email)
        if account and account.get("disabled"):
            raise ValueError(f"Runtime account is disabled: {source['source_id']}")
        if require_complete and not account:
            raise ValueError(f"Runtime account is missing: {source['source_id']}")
        if actual["keys"].get(email):
            raise ValueError(f"Runtime account has user-managed keys: {source['source_id']}")
        project_grants = member_bindings(actual["project"], member)
        if any(grant.get("role") != "roles/bigquery.jobUser" or grant.get("condition")
               for grant in project_grants):
            raise ValueError(f"Unexpected project grant: {source['source_id']}")
        if require_complete and len(project_grants) != 1:
            raise ValueError(f"Project jobUser grant is missing: {source['source_id']}")
        if any(member_bindings(policy, member) for _, policy in actual["ancestors"]):
            raise ValueError(f"Unexpected ancestor grant: {source['source_id']}")
        expected = {
            f"projects/{project}/roles/{OBJECT_ROLE}":
                (source["condition_title"], source["object_condition"]),
            f"projects/{project}/roles/{BUCKET_ROLE}":
                ("melens-source-bucket-metadata", planned["bucket_condition"]),
        }
        bucket_grants = member_bindings(actual["bucket"], member)
        roles = []
        for grant in bucket_grants:
            role = grant.get("role")
            condition = grant.get("condition", {})
            if role not in expected or (condition.get("title"), condition.get("expression")) != expected[role]:
                raise ValueError(f"Unexpected bucket grant: {source['source_id']}")
            roles.append(role)
        if len(roles) != len(set(roles)) or (require_complete and set(roles) != set(expected)):
            raise ValueError(f"Bucket grants missing or duplicated: {source['source_id']}")
        for name, dataset in actual["datasets"].items():
            entries = [entry for entry in dataset.get("access", [])
                       if entry.get("userByEmail") == email or entry.get("iamMember") == member]
            allowed_roles = ({"WRITER", "roles/bigquery.dataEditor"} if name == INGEST
                             else {"READER", "roles/bigquery.dataViewer"}
                             if name == "melens_query" and source["source_id"] in QUERY_READ_SOURCES else set())
            if entries and (not allowed_roles or len(entries) != 1
                            or entries[0].get("role") not in allowed_roles
                            or entries[0].get("condition")):
                raise ValueError(f"Unexpected dataset grant: {source['source_id']}/{name}")
            if require_complete and name == INGEST and len(entries) != 1:
                raise ValueError(f"Ingestion dataset writer grant missing: {source['source_id']}")
            if require_complete and name == "melens_query" and source["source_id"] in QUERY_READ_SOURCES and len(entries) != 1:
                raise ValueError(f"Query dataset reader grant missing: {source['source_id']}")
        expected_secrets = set(source["secret_names"])
        actual_secret_names = {name.rsplit("/", 1)[-1] for name in actual["secrets"]}
        for name, policy in actual["secrets"].items():
            grants = member_bindings(policy, member)
            secret_id = name.rsplit("/", 1)[-1]
            if grants and (secret_id not in expected_secrets or len(grants) != 1
                           or grants[0].get("role") != "roles/secretmanager.secretAccessor"
                           or grants[0].get("condition")):
                raise ValueError(f"Unexpected Secret Manager grant: {source['source_id']}")
            if require_complete and secret_id in expected_secrets and len(grants) != 1:
                raise ValueError(f"Secret accessor grant missing: {source['source_id']}")
        if expected_secrets - actual_secret_names:
            raise ValueError(f"Required secret is missing: {source['source_id']}")


def verify_roles(run: Runner, project: str, require_complete: bool) -> None:
    roles = cloud(run, "iam", "roles", "list", f"--project={project}", "--limit=10000")
    if not isinstance(roles, list) or len(roles) >= 10000:
        raise ValueError("Custom role inventory is incomplete")
    existing = {role["name"] for role in roles}
    for name, permissions in PERMISSIONS.items():
        if f"projects/{project}/roles/{name}" not in existing:
            if require_complete:
                raise ValueError(f"Custom role is missing: {name}")
            continue
        role = cloud(run, "iam", "roles", "describe", name, f"--project={project}")
        if (set(role.get("includedPermissions", [])) != permissions
                or role.get("stage") != "GA" or role.get("deleted")):
            raise ValueError(f"Custom role permission drift: {name}")


def authorize_dataset(dataset: dict, sources: list[dict], role: str = "WRITER") -> dict:
    access = dataset.get("access")
    if not isinstance(access, list):
        raise ValueError("Dataset access list is unavailable")
    selected = {source["service_account_email"] for source in sources}
    retained = [entry for entry in access if entry.get("userByEmail") not in selected
                and entry.get("iamMember") not in {f"serviceAccount:{email}" for email in selected}]
    retained.extend({"role": role, "userByEmail": email} for email in sorted(selected))
    return {**dataset, "access": retained}


def provision(run: Runner, planned: dict) -> dict:
    project = planned["project"]
    before = snapshot(run, planned)
    audit(planned, before, require_complete=False)
    verify_roles(run, project, require_complete=False)
    roles = cloud(run, "iam", "roles", "list", f"--project={project}", "--limit=10000")
    existing_roles = {role["name"] for role in roles}
    for name, permissions in PERMISSIONS.items():
        if f"projects/{project}/roles/{name}" not in existing_roles:
            cloud(run, "iam", "roles", "create", name, f"--project={project}",
                  f"--title=Melens {name}", "--stage=GA",
                  f"--permissions={','.join(sorted(permissions))}")
    for source in planned["sources"]:
        email = source["service_account_email"]
        member = f"serviceAccount:{email}"
        if email not in before["accounts"]:
            cloud(run, "iam", "service-accounts", "create", source["account_id"],
                  f"--project={project}", f"--display-name=Melens {source['source_id']}")
        cloud(run, "projects", "add-iam-policy-binding", project,
              f"--member={member}", "--role=roles/bigquery.jobUser", "--condition=None")
        for secret in source["secret_names"]:
            cloud(run, "secrets", "add-iam-policy-binding", secret, f"--project={project}",
                  f"--member={member}", "--role=roles/secretmanager.secretAccessor", "--condition=None")
        for role, title, expression in (
                (OBJECT_ROLE, source["condition_title"], source["object_condition"]),
                (BUCKET_ROLE, "melens-source-bucket-metadata", planned["bucket_condition"])):
            cloud(run, "storage", "buckets", "add-iam-policy-binding", f"gs://{planned['bucket']}",
                  f"--member={member}", f"--role=projects/{project}/roles/{role}",
                  f"--condition=title={title},expression={expression}")
    # Read immediately before updating to retain unrelated ACLs and authorized views.
    updated = authorize_dataset(read_dataset(run, project, INGEST), planned["sources"])
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json") as source:
        json.dump(updated, source)
        source.flush()
        run("bq", f"--project_id={project}", "--format=prettyjson", "update", f"--source={source.name}", f"{project}:{INGEST}")
    readers = [source for source in planned["sources"] if source["source_id"] in QUERY_READ_SOURCES]
    if readers:
        updated_query = authorize_dataset(read_dataset(run, project, "melens_query"), readers, "READER")
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json") as config_file:
            json.dump(updated_query, config_file)
            config_file.flush()
            run("bq", f"--project_id={project}", "--format=prettyjson", "update", f"--source={config_file.name}", f"{project}:melens_query")
    return verify(run, planned)


def verify(run: Runner, planned: dict, verify_jobs: bool = False) -> dict:
    verify_roles(run, planned["project"], require_complete=True)
    audit(planned, snapshot(run, planned), require_complete=True)
    if verify_jobs:
        for source in planned["sources"]:
            job = cloud(run, "run", "jobs", "describe", source["job_name"],
                        f"--project={planned['project']}", f"--region={REGION}")
            task = job["spec"]["template"]["spec"]["template"]["spec"]
            if task.get("serviceAccountName") != source["service_account_email"]:
                raise ValueError(f"Job runtime identity mismatch: {source['source_id']}")
            policy = cloud(run, "run", "jobs", "get-iam-policy", source["job_name"],
                           f"--project={planned['project']}", f"--region={REGION}")
            require_no_public(policy, source["job_name"])
            scheduler = f"serviceAccount:melens-{planned['environment']}-scheduler@{planned['project']}.iam.gserviceaccount.com"
            grants = member_bindings(policy, scheduler)
            if len(grants) != 1 or grants[0].get("role") != "roles/run.invoker" or grants[0].get("condition"):
                raise ValueError(f"Job Scheduler invoker grant mismatch: {source['source_id']}")
    return {**planned, "mode": "verified", "jobs_verified": verify_jobs,
            "sources": [{**source, "dedicated_identity_permissions_verified": True}
                        for source in planned["sources"]]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--environment", required=True, choices=("dev", "prod"))
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--source", action="append", default=[])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify-only", action="store_true")
    parser.add_argument("--verify-jobs", action="store_true")
    parser.add_argument("--confirm-project")
    args = parser.parse_args(argv)
    if args.apply and (args.confirm_project != args.project or not args.source):
        parser.error("Apply requires explicit --source selection and matching --confirm-project")
    if args.verify_jobs and not args.verify_only:
        parser.error("--verify-jobs requires --verify-only")
    try:
        planned = plan(args.project, args.environment, args.bucket, args.source)
        if args.apply:
            result = {**provision(run_json, planned), "mode": "applied_and_verified"}
        elif args.verify_only:
            result = verify(run_json, planned, args.verify_jobs)
        else:
            result = {**planned, "mode": "plan"}
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            # Never print captured cloud output, which may contain unexpected data.
            operation = " ".join(str(part) for part in error.cmd[:4])
            print(f"Cloud IAM operation failed ({operation}); exit {error.returncode}", file=sys.stderr)
        else:
            print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
