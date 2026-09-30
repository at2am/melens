#!/usr/bin/env bash
set -euo pipefail

# Cleanup is independent of source admission and source Scheduler jobs.
readonly RUN_REGION="australia-southeast2"
readonly SCHEDULER_LOCATION="australia-southeast1"
readonly CLEANUP_CRON="17 * * * *"
project=""
environment=""
bucket=""
image=""
confirmation=""
apply=false

usage() {
  cat <<'EOF'
Usage: deploy-staging-cleanup.sh --project PROJECT_ID --environment dev|prod
       --bucket BUCKET [--image IMAGE@sha256:DIGEST]
       [--apply --confirm-project PROJECT_ID]

Default: print a plan without calling GCP. Apply creates a dedicated cleanup
identity, bucket-scoped custom role and IAM conditions, Cloud Run Job, and
hourly Cloud Scheduler trigger. It does not deploy source ingestion schedules.
EOF
}

while (($# > 0)); do
  case "$1" in
    --project|--environment|--bucket|--image|--confirm-project)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --project) project="$2" ;;
        --environment) environment="$2" ;;
        --bucket) bucket="$2" ;;
        --image) image="$2" ;;
        --confirm-project) confirmation="$2" ;;
      esac
      shift 2 ;;
    --apply) apply=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo 'Invalid project ID' >&2; exit 2; }
[[ "$environment" == dev || "$environment" == prod ]] || { echo 'Environment must be dev or prod' >&2; exit 2; }
[[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || { echo 'Invalid bucket name' >&2; exit 2; }

readonly JOB="melens-${environment}-staging-cleanup"
readonly SCHEDULE="${JOB}-schedule"
readonly CLEANUP_ACCOUNT="${JOB}@${project}.iam.gserviceaccount.com"
readonly SCHEDULER_ACCOUNT="melens-${environment}-scheduler@${project}.iam.gserviceaccount.com"
readonly ROLE_ID="melens_${environment}_staging_cleanup"
readonly ROLE="projects/${project}/roles/${ROLE_ID}"

cat <<EOF
Project: ${project} (${environment})
Bucket: gs://${bucket}
Run Job: ${JOB} in ${RUN_REGION}; one task, no retries, 10 minute timeout
Schedule: ${SCHEDULE} at ${CLEANUP_CRON} UTC in ${SCHEDULER_LOCATION}
Scan ceiling: 1000 staging objects per run; overflow fails visibly
Cleanup identity: ${CLEANUP_ACCOUNT}
Storage role: ${ROLE} (list, get, delete only; object get/delete limited to staging/)
Image: ${image:-not selected}
EOF

if [[ "$apply" != true ]]; then
  echo 'Plan only. No cloud resources were changed.'
  exit 0
fi

[[ "$confirmation" == "$project" ]] || { echo '--confirm-project must match --project' >&2; exit 2; }
[[ "$image" =~ ^[a-zA-Z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || {
  echo 'Apply requires an immutable image digest' >&2; exit 2;
}
for command_name in gcloud python3; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 2; }
done

gcloud projects describe "$project" --format='value(projectId)' >/dev/null
actual_location="$(gcloud storage buckets describe "gs://${bucket}" --project="$project" --format='value(location)')"
actual_location_lc="$(printf '%s' "$actual_location" | tr '[:upper:]' '[:lower:]')"
[[ "$actual_location_lc" == "$RUN_REGION" ]] || { echo 'Bucket must be in Melbourne region' >&2; exit 1; }
gcloud iam service-accounts describe "$SCHEDULER_ACCOUNT" --project="$project" >/dev/null

if ! gcloud iam service-accounts describe "$CLEANUP_ACCOUNT" --project="$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$JOB" --project="$project" \
    --display-name="Melens ${environment} staging cleanup" --quiet
fi

if ! gcloud iam roles describe "$ROLE_ID" --project="$project" >/dev/null 2>&1; then
  gcloud iam roles create "$ROLE_ID" --project="$project" \
    --title="Melens ${environment} staging cleanup" \
    --permissions=storage.objects.list,storage.objects.get,storage.objects.delete \
    --stage=GA --quiet
fi
gcloud iam roles describe "$ROLE_ID" --project="$project" --format=json |
  python3 -c 'import json,sys; role=json.load(sys.stdin); expected={"storage.objects.list","storage.objects.get","storage.objects.delete"}; assert set(role.get("includedPermissions", [])) == expected and role.get("stage") == "GA", "Cleanup role permissions drifted"'

# Listing is checked on the bucket resource, so it cannot be restricted by
# object prefix with a bucket IAM condition. Object reads/deletes can be.
gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
  --member="serviceAccount:${CLEANUP_ACCOUNT}" --role="$ROLE" \
  --condition="expression=resource.name == 'projects/_/buckets/${bucket}',title=StagingCleanupList" \
  --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
  --member="serviceAccount:${CLEANUP_ACCOUNT}" --role="$ROLE" \
  --condition="expression=resource.name.startsWith('projects/_/buckets/${bucket}/objects/staging/'),title=StagingCleanupObjects" \
  --quiet >/dev/null

gcloud run jobs deploy "$JOB" --project="$project" --region="$RUN_REGION" \
  --image="$image" --service-account="$CLEANUP_ACCOUNT" \
  --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=600s --memory=512Mi \
  --command=node --args=dist/src/jobs/cleanup-staging.js \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${project},GCS_BUCKET=${bucket}" \
  --clear-secrets --quiet
gcloud run jobs add-iam-policy-binding "$JOB" --project="$project" --region="$RUN_REGION" \
  --member="serviceAccount:${SCHEDULER_ACCOUNT}" --role=roles/run.invoker --quiet >/dev/null

uri="https://run.googleapis.com/v2/projects/${project}/locations/${RUN_REGION}/jobs/${JOB}:run"
action=create
if gcloud scheduler jobs describe "$SCHEDULE" --project="$project" \
  --location="$SCHEDULER_LOCATION" >/dev/null 2>&1; then action=update; fi
gcloud scheduler jobs "$action" http "$SCHEDULE" --project="$project" \
  --location="$SCHEDULER_LOCATION" --schedule="$CLEANUP_CRON" --time-zone=Etc/UTC \
  --uri="$uri" --http-method=POST \
  --oauth-service-account-email="$SCHEDULER_ACCOUNT" \
  --max-retry-attempts=0 --quiet
