#!/usr/bin/env bash
set -euo pipefail

# A plan is the default. Applying requires explicit project confirmation and
# reviewed source, quota, BigQuery, overlap and billing controls.
readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CONFIG="${ROOT}/infra/schedules.json"
readonly RUN_REGION="australia-southeast2"
readonly SCHEDULER_LOCATION="australia-southeast1"
project=""
environment=""
bucket=""
image=""
confirmation=""
apply=false
start_schedules=false
sources=()

usage() {
  cat <<'EOF'
Usage: deploy.sh --project PROJECT_ID --environment dev|prod --bucket BUCKET
                 [--source SOURCE_ID ...] [--image IMAGE@sha256:DIGEST]
                 [--apply --confirm-project PROJECT_ID] [--start-schedules]

Default: print a deployment plan without calling GCP. --apply is blocked until
the selected manifests are admitted and every budget, quota and runtime guard
in schedules.json is reviewed. Only project integrators should apply changes.
Schedulers are created paused unless --start-schedules is explicitly supplied.
Refresh the budget response allowlist before starting new schedules.
EOF
}

while (($# > 0)); do
  case "$1" in
    --project|--environment|--bucket|--image|--confirm-project|--source)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --project) project="$2" ;;
        --environment) environment="$2" ;;
        --bucket) bucket="$2" ;;
        --image) image="$2" ;;
        --confirm-project) confirmation="$2" ;;
        --source) sources+=("$2") ;;
      esac
      shift 2 ;;
    --apply) apply=true; shift ;;
    --start-schedules) start_schedules=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo 'Invalid project ID' >&2; exit 2; }
[[ "$environment" == dev || "$environment" == prod ]] || { echo 'Environment must be dev or prod' >&2; exit 2; }
[[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || { echo 'Invalid bucket name' >&2; exit 2; }
for source in "${sources[@]}"; do
  [[ "$source" =~ ^[a-z][a-z0-9]*([._][a-z0-9]+)*$ ]] || { echo 'Invalid source ID' >&2; exit 2; }
done
command -v python3 >/dev/null || { echo 'Missing python3' >&2; exit 2; }
[[ "$start_schedules" == false || "$apply" == true ]] || {
  echo '--start-schedules requires --apply' >&2; exit 2;
}

if [[ "$apply" == true ]]; then
  [[ "$confirmation" == "$project" ]] || { echo '--confirm-project must match --project' >&2; exit 2; }
  [[ ${#sources[@]} -gt 0 ]] || { echo '--apply requires at least one explicit --source' >&2; exit 2; }
  [[ "$image" =~ ^[a-zA-Z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || {
    echo 'Apply requires an immutable image digest' >&2; exit 2;
  }
fi

rows="$(mktemp)"
trap 'rm -f "$rows"' EXIT
python3 - "$CONFIG" "$ROOT/src/connectors" "$apply" "$project" "$environment" "${sources[@]}" >"$rows" <<'PY'
import glob
import json
import math
import os
import re
import sys

config_path, connector_root, apply_flag, project, environment, *selected = sys.argv[1:]
config = json.load(open(config_path, encoding='utf-8'))
if (config.get('schema_version') != 1 or config.get('region') != 'australia-southeast2'
        or config.get('scheduler_location') != 'australia-southeast1'
        or config.get('time_zone') != 'Etc/UTC'):
    raise SystemExit('Invalid Run region, Scheduler location, time zone or schedule schema')
budget = config.get('budget', {})
guards = config.get('enforcement', {})
if budget.get('alert_threshold_percent') != [50, 80, 100]:
    raise SystemExit('Budget alert thresholds must be 50/80/100')
manifests = {}
for path in glob.glob(os.path.join(connector_root, '*', 'source.json')):
    manifest = json.load(open(path, encoding='utf-8'))
    manifests[manifest['source_id']] = manifest
entries = config.get('sources')
if not isinstance(entries, list):
    raise SystemExit('Schedule sources must be an array')
by_id = {}
for entry in entries:
    source_id = entry.get('source_id')
    if not isinstance(source_id, str) or not re.fullmatch(r'[a-z][a-z0-9]*(?:[._][a-z0-9]+)*', source_id):
        raise SystemExit('Invalid schedule source ID')
    if source_id in by_id or source_id not in manifests:
        raise SystemExit(f'Duplicate or unknown schedule source: {source_id}')
    by_id[source_id] = entry
if set(by_id) != set(manifests):
    raise SystemExit('Every source manifest must have exactly one schedule entry')
if len(selected) != len(set(selected)) or any(source_id not in by_id for source_id in selected):
    raise SystemExit('Duplicate or unknown selected source')
if not selected:
    selected = sorted(by_id)

for source_id in selected:
    entry = by_id[source_id]
    manifest = manifests[source_id]
    cadence = manifest.get('cadence_seconds')
    check = manifest.get('check_interval_seconds')
    if entry.get('cadence_seconds') != cadence or entry.get('check_interval_seconds') != check:
        raise SystemExit(f'Schedule cadence drift: {source_id}')
    if entry.get('secret_names') != (manifest.get('admission_evidence') or {}).get('secret_names', []):
        raise SystemExit(f'Schedule secret reference drift: {source_id}')
    mode = entry.get('mode')
    cron = entry.get('cron_utc')
    interval = entry.get('interval_seconds')
    overlap = entry.get('overlap_seconds')
    revision = entry.get('snapshot_revision')
    if mode not in ('time', 'snapshot') or (cron is not None and not re.fullmatch(r'[\d*/ ,\-]+', cron)):
        raise SystemExit(f'Invalid schedule mode or cron: {source_id}')
    if mode == 'time':
        if not isinstance(interval, int) or interval <= 0 or interval != check or not isinstance(overlap, int) or overlap < 0 or revision is not None:
            raise SystemExit(f'Invalid time window: {source_id}')
    elif interval is not None or overlap is not None or not isinstance(revision, str) or not revision:
        raise SystemExit(f'Invalid snapshot revision: {source_id}')
    if check is not None and cron is None:
        raise SystemExit(f'Missing schedule for monitored source: {source_id}')
    if check is None and cron is not None:
        raise SystemExit(f'Unreviewed schedule for unmonitored source: {source_id}')
    if (not isinstance(entry.get('enabled'), bool) or not isinstance(entry.get('task_timeout_seconds'), int)
            or entry['task_timeout_seconds'] <= 0 or not isinstance(entry.get('memory_mib'), int)
            or not 512 <= entry['memory_mib'] <= 8192):
        raise SystemExit(f'Invalid deployment settings: {source_id}')
    secrets = entry.get('secret_names')
    if (not isinstance(secrets, list) or len(secrets) > 1
            or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,255}', name) for name in secrets)):
        raise SystemExit(f'Invalid Secret Manager reference: {source_id}')

    if apply_flag == 'true':
        if not entry['enabled']:
            raise SystemExit(f'Source not enabled for deployment: {source_id}')
        if (not isinstance(budget.get('monthly_amount_aud'), (int, float))
                or budget['monthly_amount_aud'] <= 0 or not budget.get('alerts_verified')
                or not isinstance(budget.get('budget_resource_name'), str)
                or not budget['budget_resource_name'].startswith('billingAccounts/')):
            raise SystemExit('Monthly budget and 50/80/100 alerts must be verified')
        if not all(guards.get(key) is True for key in (
            'request_count_verified', 'maximum_bytes_billed_verified',
            'same_source_overlap_verified', 'budget_action_verified')):
            raise SystemExit('Runtime request, billed-byte, overlap and budget guards are not verified')
        cap = entry.get('request_cap_per_day')
        bytes_limit = entry.get('maximum_bytes_billed')
        requests_per_run = entry.get('max_requests_per_execution')
        if not all(isinstance(value, int) and value > 0 for value in (cap, bytes_limit, requests_per_run)):
            raise SystemExit(f'Request and BigQuery ceilings are missing: {source_id}')
        declared = (manifest.get('admission_evidence') or {}).get('quota_requests_per_day')
        if declared is None or cap > declared:
            raise SystemExit(f'Request ceiling exceeds reviewed manifest quota: {source_id}')
        if cron is not None and math.ceil(86400 / check) * requests_per_run > cap:
            raise SystemExit(f'Schedule can exceed daily request ceiling: {source_id}')
        evidence = manifest.get('admission_evidence') or {}
        required = ('dataset_url', 'native_record_key', 'completeness_rule',
                    'quota_requests_per_day', 'allowed_fields', 'raw_retention_days',
                    'staging_retention_days', 'license_evidence_url', 'reviewed_at')
        if (manifest.get('access_status') != 'active'
                or manifest.get('license_status') not in ('verified_open', 'restricted')
                or not manifest.get('coverage_area_refs') or not manifest.get('coverage_from')
                or not manifest.get('connector_owner')
                or any(evidence.get(field) is None for field in required)
                or not evidence.get('allowed_fields')):
            raise SystemExit(f'Source admission is incomplete: {source_id}')
        account = entry.get('service_account_email')
        if (not isinstance(account, str)
                or not re.fullmatch(r'[a-z][a-z0-9-]+@' + re.escape(project) + r'\.iam\.gserviceaccount\.com', account)
                or account == f'melens-{environment}-ingest@{project}.iam.gserviceaccount.com'
                or entry.get('dedicated_identity_permissions_verified') is not True):
            raise SystemExit(f'Verified dedicated service identity required: {source_id}')

    safe = [source_id, cron or 'manual', mode, str(interval or 0), str(overlap or 0),
            revision or '-', str(entry.get('request_cap_per_day') or 0),
            str(entry.get('maximum_bytes_billed') or 0),
            str(entry.get('max_requests_per_execution') or 0),
            str(entry['task_timeout_seconds']),
            str(entry['memory_mib']),
            ','.join(secrets) or '-', entry.get('service_account_email') or '-',
            'enabled' if entry['enabled'] else 'candidate']
    print('\t'.join(safe))
PY

printf 'Project: %s (%s)\nRun/data region: %s\nScheduler location: %s\nBucket: gs://%s\n' \
  "$project" "$environment" "$RUN_REGION" "$SCHEDULER_LOCATION" "$bucket"
printf 'Image: %s\n' "${image:-not selected}"
python3 - "$CONFIG" <<'PY'
import json
import sys
config = json.load(open(sys.argv[1], encoding='utf-8'))
budget = config['budget']
print('Monthly budget (AUD):', budget['monthly_amount_aud'] if budget['monthly_amount_aud'] is not None else 'unset')
print('Budget alerts verified:', budget['alerts_verified'])
print('Runtime guards verified:', ', '.join(k for k, v in config['enforcement'].items() if v is True) or 'none')
PY
printf 'Source | Schedule (UTC) | Mode | State | Daily request cap | BigQuery max bytes\n'
while IFS=$'\t' read -r source cron mode interval overlap revision cap max_bytes max_requests timeout memory secrets service_account state; do
  if [[ "$cap" == 0 ]]; then cap=unset; fi
  if [[ "$max_bytes" == 0 ]]; then max_bytes=unset; fi
  printf '%s | %s | %s | %s | %s | %s\n' "$source" "$cron" "$mode" "$state" "$cap" "$max_bytes"
done <"$rows"

if [[ "$apply" != true ]]; then
  echo 'Plan only. No cloud resources were changed.'
  exit 0
fi

for command_name in gcloud bq; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 2; }
done
gcloud projects describe "$project" --format='value(projectId)' >/dev/null
python3 - "$CONFIG" "$project" <<'PY'
import json
import re
import subprocess
import sys
from decimal import Decimal

config = json.load(open(sys.argv[1], encoding='utf-8'))
project = sys.argv[2]
expected = config['budget']
name = expected.get('budget_resource_name')
match = re.fullmatch(r'billingAccounts/([A-Za-z0-9-]+)/budgets/([A-Za-z0-9-]+)', name or '')
if not match or expected.get('alerts_verified') is not True:
    raise SystemExit('Reviewed budget identity and alerts are required')
try:
    project_number = subprocess.run(['gcloud', 'projects', 'describe', project,
        '--format=value(projectNumber)'], check=True, capture_output=True, text=True).stdout.strip()
    result = subprocess.run(['gcloud', 'billing', 'budgets', 'describe', match.group(2),
        f'--billing-account={match.group(1)}', f'--project={project}', '--format=json'],
        check=True, capture_output=True, text=True)
    actual = json.loads(result.stdout)
except (subprocess.CalledProcessError, ValueError) as error:
    raise SystemExit('Reviewed budget could not be read from GCP') from error
amount = actual.get('amount', {}).get('specifiedAmount', {})
actual_amount = Decimal(str(amount.get('units', '0'))) + Decimal(str(amount.get('nanos', 0))) / Decimal(10**9)
thresholds = sorted((Decimal(str(rule.get('thresholdPercent'))), rule.get('spendBasis'))
    for rule in actual.get('thresholdRules', []))
expected_thresholds = [(Decimal('0.5'), 'CURRENT_SPEND'),
    (Decimal('0.8'), 'CURRENT_SPEND'), (Decimal('1'), 'CURRENT_SPEND')]
if (actual.get('name') != name or amount.get('currencyCode') != 'AUD'
    or actual_amount != Decimal(str(expected['monthly_amount_aud']))
    or actual.get('budgetFilter', {}).get('calendarPeriod') != 'MONTH'
    or actual.get('budgetFilter', {}).get('projects') != [f'projects/{project_number}']
    or thresholds != expected_thresholds
    or actual.get('notificationsRule', {}).get('disableDefaultIamRecipients') is True):
    raise SystemExit('GCP budget does not match reviewed monthly amount, project and 50/80/100 alerts')
PY
bq --project_id="$project" show "${project}:melens_ingest" >/dev/null
gcloud storage buckets describe "gs://${bucket}" --project="$project" >/dev/null

identity_args=(--project "$project" --environment "$environment" --bucket "$bucket" --verify-only)
for source in "${sources[@]}"; do identity_args+=(--source "$source"); done
python3 "${ROOT}/infra/source-identities.py" "${identity_args[@]}"

readonly INGEST_ACCOUNT="melens-${environment}-ingest@${project}.iam.gserviceaccount.com"
readonly SCHEDULER_ACCOUNT="melens-${environment}-scheduler@${project}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SCHEDULER_ACCOUNT" --project="$project" >/dev/null

while IFS=$'\t' read -r source cron mode interval overlap revision cap max_bytes max_requests timeout memory secrets service_account state; do
  job="melens-${environment}-${source//[._]/-}"
  scheduler="${job}-schedule"
  [[ ${#job} -le 63 && ${#scheduler} -le 63 ]] || { echo 'Cloud resource name too long' >&2; exit 2; }
  runtime_account="$INGEST_ACCOUNT"
  if [[ "$service_account" != '-' ]]; then runtime_account="$service_account"; fi
  gcloud iam service-accounts describe "$runtime_account" --project="$project" >/dev/null
  secret_names=""
  if [[ "$secrets" != '-' ]]; then secret_names="$secrets"; fi
  env_vars="GOOGLE_CLOUD_PROJECT=${project},GCP_REGION=${RUN_REGION},GCS_BUCKET=${bucket},BQ_INGEST_DATASET=melens_ingest,BQ_QUERY_DATASET=melens_query,MELENS_SOURCE_ID=${source},MELENS_SCHEDULE_MODE=${mode},SECRET_NAMES=${secret_names},MELENS_REQUEST_CAP_PER_DAY=${cap},MELENS_MAX_REQUESTS_PER_EXECUTION=${max_requests},BQ_MAXIMUM_BYTES_BILLED=${max_bytes}"
  if [[ "$mode" == time ]]; then
    env_vars+=",MELENS_INTERVAL_SECONDS=${interval},MELENS_OVERLAP_SECONDS=${overlap}"
  else
    env_vars+=",MELENS_SNAPSHOT_REVISION=${revision}"
  fi
  secret_flags=(--clear-secrets)
  if [[ "$secrets" != '-' ]]; then
    refs=()
    IFS=',' read -r -a names <<<"$secrets"
    for name in "${names[@]}"; do
      gcloud secrets describe "$name" --project="$project" >/dev/null
      secret_state="$(gcloud secrets versions describe 1 --secret="$name" --project="$project" --format='value(state)')"
      [[ "$secret_state" == ENABLED ]] || { echo 'Pinned secret version 1 is not enabled' >&2; exit 2; }
      case "$name" in
        transport_victoria_key_id) refs+=("TRANSPORT_VICTORIA_KEY_ID=${name}:1") ;;
        ticketmaster_discovery_api_key) refs+=("TICKETMASTER_DISCOVERY_API_KEY=${name}:1") ;;
        *) echo 'Secret lacks an approved environment mapping' >&2; exit 2 ;;
      esac
    done
    joined_refs="$(IFS=,; echo "${refs[*]}")"
    secret_flags=("--set-secrets=${joined_refs}")
  fi
  if [[ "$secrets" != '-' ]]; then
    for name in "${names[@]}"; do
      gcloud secrets add-iam-policy-binding "$name" --project="$project" \
        --member="serviceAccount:${runtime_account}" \
        --role=roles/secretmanager.secretAccessor --quiet >/dev/null
    done
  fi
  gcloud run jobs deploy "$job" --project="$project" --region="$RUN_REGION" \
    --image="$image" --service-account="$runtime_account" \
    --tasks=1 --parallelism=1 --max-retries=0 --task-timeout="${timeout}s" --memory="${memory}Mi" \
    --command=node --args=dist/src/jobs/scheduled.js \
    --set-env-vars="$env_vars" "${secret_flags[@]}" --quiet
  gcloud run jobs add-iam-policy-binding "$job" --project="$project" \
    --region="$RUN_REGION" --member="serviceAccount:${SCHEDULER_ACCOUNT}" \
    --role=roles/run.invoker --quiet >/dev/null
  if [[ "$cron" != manual ]]; then
    uri="https://run.googleapis.com/v2/projects/${project}/locations/${RUN_REGION}/jobs/${job}:run"
    action=create
    if gcloud scheduler jobs describe "$scheduler" --project="$project" \
      --location="$SCHEDULER_LOCATION" >/dev/null 2>&1; then action=update; fi
    gcloud scheduler jobs "$action" http "$scheduler" --project="$project" \
      --location="$SCHEDULER_LOCATION" --schedule="$cron" --time-zone=Etc/UTC \
      --uri="$uri" --http-method=POST \
      --oauth-service-account-email="$SCHEDULER_ACCOUNT" \
      --max-retry-attempts=0 --quiet
    scheduler_state="$(gcloud scheduler jobs describe "$scheduler" --project="$project" \
      --location="$SCHEDULER_LOCATION" --format='value(state)')"
    if [[ "$start_schedules" == true && "$scheduler_state" == PAUSED ]]; then
      gcloud scheduler jobs resume "$scheduler" --project="$project" \
        --location="$SCHEDULER_LOCATION" --quiet
    elif [[ "$start_schedules" != true && "$scheduler_state" == ENABLED ]]; then
      gcloud scheduler jobs pause "$scheduler" --project="$project" \
        --location="$SCHEDULER_LOCATION" --quiet
    elif [[ "$scheduler_state" != ENABLED && "$scheduler_state" != PAUSED ]]; then
      echo 'Scheduler is not in an activatable state' >&2; exit 1
    fi
  fi
done <"$rows"
