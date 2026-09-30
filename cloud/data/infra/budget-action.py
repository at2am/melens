#!/usr/bin/env python3
"""Plan or install the development budget response without storing credentials."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "infra" / "schedules.json"
RUN_REGION = "australia-southeast2"
SCHEDULER_LOCATION = "australia-southeast1"
SERVICE = "melens-dev-budget-action"
TOPIC = "melens-dev-budget-alerts"
SUBSCRIPTION = "melens-dev-budget-action-push"
ROLE = "melensBudgetJobPause"
SMOKE_JOB = "melens-dev-budget-smoke-schedule"
SMOKE_URI = "https://example.invalid/melens-budget-smoke"
SMOKE_DESCRIPTION = "Melens disposable budget response smoke test; never run"
ROLE_PERMISSIONS = {"cloudscheduler.jobs.get", "cloudscheduler.jobs.pause"}
IMAGE_PATTERN = re.compile(r"[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}\Z")
PROJECT_PATTERN = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
BUDGET_PATTERN = re.compile(r"billingAccounts/([A-Za-z0-9-]+)/budgets/([A-Za-z0-9-]+)\Z")


def fail(message: str) -> None:
    raise SystemExit(message)


def command(*args: str, allow_missing: bool = False) -> str | None:
    result = subprocess.run(("gcloud", *args), capture_output=True, text=True, check=False)
    if result.returncode == 0:
        return result.stdout.strip()
    if allow_missing and ("NOT_FOUND" in result.stderr or "not found" in result.stderr.lower()):
        return None
    fail(f"gcloud {' '.join(args[:3])} failed: {result.stderr.strip()}")


def cloud_json(*args: str, allow_missing: bool = False) -> dict | list | None:
    output = command(*args, "--format=json", allow_missing=allow_missing)
    return json.loads(output) if output is not None else None


def config_plan(config: dict, project: str) -> tuple[str, set[str]]:
    budget = config.get("budget", {})
    name = budget.get("budget_resource_name", "")
    if (config.get("schema_version") != 1 or config.get("region") != RUN_REGION
            or config.get("scheduler_location") != SCHEDULER_LOCATION
            or budget.get("monthly_amount_aud") != 100
            or budget.get("alert_threshold_percent") != [50, 80, 100]
            or budget.get("alerts_verified") is not True
            or not BUDGET_PATTERN.fullmatch(name)):
        fail("The reviewed monthly AUD 100 budget configuration is missing or changed")
    known: set[str] = set()
    scheduled: set[str] = set()
    for entry in config.get("sources", []):
        source = entry.get("source_id")
        if not isinstance(source, str) or not re.fullmatch(r"[a-z][a-z0-9]*(?:[._][a-z0-9]+)*", source):
            fail("Invalid schedule source ID")
        job = f"melens-dev-{source.replace('.', '-').replace('_', '-')}-schedule"
        if len(job) > 63 or job in known:
            fail("Duplicate or oversized Scheduler job name")
        known.add(job)
        if entry.get("priority") not in ("P0", "A", "B"):
            fail(f"Unknown source priority: {source}")
        if entry.get("cron_utc") is not None and entry["priority"] != "P0":
            scheduled.add(f"projects/{project}/locations/{SCHEDULER_LOCATION}/jobs/{job}")
    if len(known) != len(config.get("sources", [])):
        fail("Duplicate source in schedule")
    return name, scheduled


def checked_budget(project: str, project_number: str, name: str, topic: str) -> dict:
    actual = cloud_json("billing", "budgets", "describe", name, f"--project={project}")
    assert isinstance(actual, dict)
    amount = actual.get("amount", {}).get("specifiedAmount", {})
    value = Decimal(str(amount.get("units", "0"))) + Decimal(str(amount.get("nanos", 0))) / 10**9
    rules = sorted((Decimal(str(rule.get("thresholdPercent"))), rule.get("spendBasis"))
                   for rule in actual.get("thresholdRules", []))
    current_topic = actual.get("notificationsRule", {}).get("pubsubTopic", "")
    if (actual.get("name") != name or amount.get("currencyCode") != "AUD"
            or value != 100 or actual.get("budgetFilter", {}).get("calendarPeriod") != "MONTH"
            or actual.get("budgetFilter", {}).get("projects") != [f"projects/{project_number}"]
            or rules != [(Decimal("0.5"), "CURRENT_SPEND"),
                         (Decimal("0.8"), "CURRENT_SPEND"), (Decimal("1"), "CURRENT_SPEND")]
            or actual.get("notificationsRule", {}).get("disableDefaultIamRecipients") is True
            or current_topic not in ("", topic)):
        fail("Live budget differs from the reviewed project, amount, thresholds or topic")
    return actual


def ensure_account(project: str, account: str, title: str) -> str:
    email = f"{account}@{project}.iam.gserviceaccount.com"
    if cloud_json("iam", "service-accounts", "describe", email,
                  f"--project={project}", allow_missing=True) is None:
        command("iam", "service-accounts", "create", account, f"--project={project}",
                f"--display-name={title}", "--quiet")
    return email


def ensure_role(project: str) -> None:
    current = cloud_json("iam", "roles", "describe", ROLE,
                         f"--project={project}", allow_missing=True)
    if current is None:
        command("iam", "roles", "create", ROLE, f"--project={project}",
                "--title=Melens budget job pause", 
                "--description=Read and pause Scheduler jobs for the budget response",
                f"--permissions={','.join(sorted(ROLE_PERMISSIONS))}", "--stage=GA", "--quiet")
    elif set(current.get("includedPermissions", [])) != ROLE_PERMISSIONS or current.get("stage") != "GA":
        fail("Existing custom Scheduler role has unexpected permissions or stage")


def ensure_smoke_job(project: str) -> None:
    actual = cloud_json("scheduler", "jobs", "describe", SMOKE_JOB,
                        f"--project={project}", f"--location={SCHEDULER_LOCATION}",
                        allow_missing=True)
    if actual is None:
        command("scheduler", "jobs", "create", "http", SMOKE_JOB, f"--project={project}",
                f"--location={SCHEDULER_LOCATION}", "--schedule=0 0 29 2 *",
                "--time-zone=Etc/UTC", f"--uri={SMOKE_URI}", "--http-method=GET",
                "--max-retry-attempts=0", f"--description={SMOKE_DESCRIPTION}", "--quiet")
        command("scheduler", "jobs", "pause", SMOKE_JOB, f"--project={project}",
                f"--location={SCHEDULER_LOCATION}", "--quiet")
    else:
        if (actual.get("httpTarget", {}).get("uri") != SMOKE_URI
                or actual.get("description") != SMOKE_DESCRIPTION
                or actual.get("schedule") != "0 0 29 2 *"):
            fail("Existing smoke job differs from the disposable test definition")
        if actual.get("state") == "ENABLED":
            fail("Smoke job is enabled. Pause it after observing the delivery test, then rerun")


def deployed_jobs(project: str, allowed: set[str], include_smoke: bool) -> list[str]:
    jobs = cloud_json("scheduler", "jobs", "list", f"--project={project}",
                      f"--location={SCHEDULER_LOCATION}")
    assert isinstance(jobs, list)
    names = {job["name"] for job in jobs}
    selected = sorted(names & allowed)
    if include_smoke:
        active = [job["name"] for job in jobs
                  if job["name"] in allowed and job.get("state") == "ENABLED"]
        if active:
            fail("Smoke delivery would pause active non-P0 source jobs; pause them before testing")
        smoke = f"projects/{project}/locations/{SCHEDULER_LOCATION}/jobs/{SMOKE_JOB}"
        if smoke not in names:
            fail("Smoke Scheduler job is missing")
        selected.append(smoke)
    return selected


def ensure_private_service(project: str, image: str, runtime: str, jobs: list[str], budget: str) -> str:
    env = {
        "GOOGLE_CLOUD_PROJECT": project,
        "MELENS_BUDGET_RESOURCE_NAME": budget,
        "MELENS_SCHEDULER_LOCATION": SCHEDULER_LOCATION,
        "MELENS_BUDGET_AMOUNT_AUD": "100",
        "MELENS_PAUSABLE_SCHEDULER_JOBS": ",".join(jobs),
    }
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=True) as stream:
        json.dump(env, stream)
        stream.flush()
        command("run", "deploy", SERVICE, f"--project={project}", f"--region={RUN_REGION}",
                f"--image={image}", f"--service-account={runtime}", "--command=node",
                "--args=dist/src/jobs/budget-action.js", f"--env-vars-file={stream.name}",
                "--no-allow-unauthenticated", "--invoker-iam-check", "--max-instances=1",
                "--concurrency=1", "--quiet")
    service = cloud_json("run", "services", "describe", SERVICE,
                         f"--project={project}", f"--region={RUN_REGION}")
    assert isinstance(service, dict)
    url = service.get("status", {}).get("url") or service.get("uri")
    if not isinstance(url, str) or not url.startswith("https://"):
        fail("Cloud Run service URL was not returned")
    policy = cloud_json("run", "services", "get-iam-policy", SERVICE,
                        f"--project={project}", f"--region={RUN_REGION}")
    assert isinstance(policy, dict)
    if any(set(binding.get("members", [])) & {"allUsers", "allAuthenticatedUsers"}
           for binding in policy.get("bindings", [])):
        fail("Budget action Cloud Run service has a public IAM binding")
    return url


def ensure_topic(project: str) -> None:
    if cloud_json("pubsub", "topics", "describe", TOPIC,
                  f"--project={project}", allow_missing=True) is None:
        command("pubsub", "topics", "create", TOPIC, f"--project={project}", "--quiet")


def check_runtime_project_grants(project: str, runtime: str) -> None:
    policy = cloud_json("projects", "get-iam-policy", project)
    assert isinstance(policy, dict)
    member = f"serviceAccount:{runtime}"
    expected = f"projects/{project}/roles/{ROLE}"
    grants = {binding.get("role") for binding in policy.get("bindings", [])
              if member in binding.get("members", [])}
    if grants != {expected}:
        fail("Budget action identity has unexpected direct project IAM grants")
    if any(set(binding.get("members", [])) & {"allUsers", "allAuthenticatedUsers"}
           and binding.get("role") in {"roles/run.invoker", "roles/run.servicesInvoker"}
           for binding in policy.get("bindings", [])):
        fail("Project has a public Cloud Run invoker grant")


def check_service_invokers(project: str, push: str) -> None:
    policy = cloud_json("run", "services", "get-iam-policy", SERVICE,
                        f"--project={project}", f"--region={RUN_REGION}")
    assert isinstance(policy, dict)
    invokers = {member for binding in policy.get("bindings", [])
                if binding.get("role") in {"roles/run.invoker", "roles/run.servicesInvoker"}
                for member in binding.get("members", [])}
    if invokers != {f"serviceAccount:{push}"}:
        fail("Budget action service has unexpected Cloud Run invokers")


def ensure_subscription(project: str, url: str, push_email: str) -> None:
    actual = cloud_json("pubsub", "subscriptions", "describe", SUBSCRIPTION,
                        f"--project={project}", allow_missing=True)
    if actual is None:
        command("pubsub", "subscriptions", "create", SUBSCRIPTION,
                f"--project={project}", f"--topic={TOPIC}", "--ack-deadline=60",
                f"--push-endpoint={url}/", f"--push-auth-service-account={push_email}",
                f"--push-auth-token-audience={url}", "--quiet")
    else:
        if actual.get("topic") != f"projects/{project}/topics/{TOPIC}":
            fail("Existing budget push subscription points to another topic")
        command("pubsub", "subscriptions", "modify-push-config", SUBSCRIPTION,
                f"--project={project}", f"--push-endpoint={url}/",
                f"--push-auth-service-account={push_email}",
                f"--push-auth-token-audience={url}", "--quiet")
    actual = cloud_json("pubsub", "subscriptions", "describe", SUBSCRIPTION,
                        f"--project={project}")
    assert isinstance(actual, dict)
    push = actual.get("pushConfig", {})
    if (push.get("pushEndpoint") != f"{url}/"
            or push.get("oidcToken", {}).get("serviceAccountEmail") != push_email
            or push.get("oidcToken", {}).get("audience") != url):
        fail("Authenticated push subscription did not read back as expected")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--image", help="Immutable image containing budget-action.js")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-project")
    parser.add_argument("--smoke-job", action="store_true",
                        help="Create and allowlist a disposable Scheduler test job")
    args = parser.parse_args()
    if not PROJECT_PATTERN.fullmatch(args.project):
        fail("Invalid project ID")
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    budget, allowed = config_plan(config, args.project)
    print(f"Project: {args.project} (dev)")
    print(f"Budget: {budget} (AUD 100 per month)")
    print(f"Cloud Run: {SERVICE} in {RUN_REGION}; private authenticated Pub/Sub push")
    print(f"Pub/Sub: {TOPIC} -> {SUBSCRIPTION}")
    print(f"Eligible non-P0 Scheduler names: {len(allowed)} in {SCHEDULER_LOCATION}")
    print(f"Disposable smoke job: {'included' if args.smoke_job else 'excluded'}")
    if not args.apply:
        print("Plan only. No cloud resources were changed.")
        return
    if args.confirm_project != args.project or not args.image or not IMAGE_PATTERN.fullmatch(args.image):
        fail("Apply requires --confirm-project and an immutable --image digest")
    project_data = cloud_json("projects", "describe", args.project)
    assert isinstance(project_data, dict)
    number = str(project_data.get("projectNumber", ""))
    if not number.isdigit():
        fail("Could not read project number")
    topic_name = f"projects/{args.project}/topics/{TOPIC}"
    live_budget = checked_budget(args.project, number, budget, topic_name)
    command("services", "enable", "pubsub.googleapis.com", f"--project={args.project}", "--quiet")
    if args.smoke_job:
        ensure_smoke_job(args.project)
    jobs = deployed_jobs(args.project, allowed, args.smoke_job)
    ensure_role(args.project)
    runtime = ensure_account(args.project, "melens-dev-budget-action", "Melens budget response")
    push = ensure_account(args.project, "melens-dev-budget-push", "Melens budget Pub/Sub push")
    command("projects", "add-iam-policy-binding", args.project,
            f"--member=serviceAccount:{runtime}", f"--role=projects/{args.project}/roles/{ROLE}",
            "--quiet")
    check_runtime_project_grants(args.project, runtime)
    url = ensure_private_service(args.project, args.image, runtime, jobs, budget)
    command("run", "services", "add-iam-policy-binding", SERVICE, f"--project={args.project}",
            f"--region={RUN_REGION}", f"--member=serviceAccount:{push}",
            "--role=roles/run.invoker", "--quiet")
    check_service_invokers(args.project, push)
    agent = f"service-{number}@gcp-sa-pubsub.iam.gserviceaccount.com"
    command("iam", "service-accounts", "add-iam-policy-binding", push,
            f"--project={args.project}", f"--member=serviceAccount:{agent}",
            "--role=roles/iam.serviceAccountTokenCreator", "--quiet")
    ensure_topic(args.project)
    publisher = "serviceAccount:billing-budget-alert@system.gserviceaccount.com"
    command("pubsub", "topics", "add-iam-policy-binding", TOPIC,
            f"--project={args.project}", f"--member={publisher}",
            "--role=roles/pubsub.publisher", "--quiet")
    ensure_subscription(args.project, url, push)
    if live_budget.get("notificationsRule", {}).get("pubsubTopic") != topic_name:
        command("billing", "budgets", "update", budget, f"--project={args.project}",
                f"--notifications-rule-pubsub-topic={topic_name}", "--quiet")
    checked_budget(args.project, number, budget, topic_name)
    policy = cloud_json("pubsub", "topics", "get-iam-policy", TOPIC,
                        f"--project={args.project}")
    assert isinstance(policy, dict)
    if not any(binding.get("role") == "roles/pubsub.publisher"
               and publisher in binding.get("members", []) for binding in policy.get("bindings", [])):
        fail("Cloud Billing publisher is missing from the budget topic IAM policy")
    print(f"Budget response installed. Allowlisted deployed Scheduler jobs: {len(jobs)}")
    print("A live push and Scheduler pause test is still required before setting budget_action_verified.")


if __name__ == "__main__":
    main()
