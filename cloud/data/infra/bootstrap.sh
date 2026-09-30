#!/usr/bin/env bash
set -euo pipefail

# This script is intentionally inert unless --apply and --confirm-project are supplied.
readonly REGION="australia-southeast2"
readonly INGEST_DATASET="melens_ingest"
readonly QUERY_DATASET="melens_query"

usage() {
  cat <<'EOF'
Usage: bootstrap.sh --project PROJECT_ID --bucket GLOBALLY_UNIQUE_BUCKET --environment dev|prod [--apply --confirm-project PROJECT_ID]

Without --apply, prints the resource plan only. Use a separate GCP project and
bucket for each environment. Run as the project integrator, not from a job.
EOF
}

project=""
bucket=""
environment=""
apply=false
confirmation=""
while (($# > 0)); do
  case "$1" in
    --project|--bucket|--environment|--confirm-project)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --project) project="$2" ;;
        --bucket) bucket="$2" ;;
        --environment) environment="$2" ;;
        --confirm-project) confirmation="$2" ;;
      esac
      shift 2
      ;;
    --apply) apply=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "Invalid GCP project ID" >&2; exit 2; }
[[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || { echo "Invalid bucket name" >&2; exit 2; }
[[ "$environment" == "dev" || "$environment" == "prod" ]] || { echo "Environment must be dev or prod" >&2; exit 2; }

ingest_account="melens-${environment}-ingest"
query_account="melens-${environment}-query"
scheduler_account="melens-${environment}-scheduler"
ingest_email="${ingest_account}@${project}.iam.gserviceaccount.com"
query_email="${query_account}@${project}.iam.gserviceaccount.com"
scheduler_email="${scheduler_account}@${project}.iam.gserviceaccount.com"

cat <<EOF
Project: ${project} (${environment})
Region: ${REGION}
Bucket: gs://${bucket} (uniform access, public access prevented)
Datasets: ${INGEST_DATASET}, ${QUERY_DATASET}
Service identities: ${ingest_email}, ${query_email}, ${scheduler_email}
EOF

if [[ "$apply" != true ]]; then
  echo "Plan only. No cloud resources were changed."
  exit 0
fi
[[ "$confirmation" == "$project" ]] || { echo "--confirm-project must exactly match --project" >&2; exit 2; }
for command_name in gcloud bq python3; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 2; }
done

gcloud projects describe "$project" --format='value(projectId)' >/dev/null
gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  storage.googleapis.com \
  bigquery.googleapis.com \
  bigquerystorage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  --project="$project" --quiet

if gcloud storage buckets describe "gs://${bucket}" --format='value(location)' >/dev/null 2>&1; then
  actual_location="$(gcloud storage buckets describe "gs://${bucket}" --format='value(location)')"
  [[ "${actual_location,,}" == "$REGION" ]] || {
    echo "Existing bucket is in ${actual_location}, expected ${REGION}" >&2
    exit 1
  }
  gcloud storage buckets update "gs://${bucket}" \
    --uniform-bucket-level-access --public-access-prevention --quiet
else
  gcloud storage buckets create "gs://${bucket}" --project="$project" \
    --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention --quiet
fi

ensure_dataset() {
  local dataset="$1" description="$2" actual_location
  if bq --project_id="$project" show --format=prettyjson "${project}:${dataset}" >/dev/null 2>&1; then
    actual_location="$(bq --project_id="$project" show --format=prettyjson "${project}:${dataset}" |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["location"])')"
    [[ "${actual_location,,}" == "$REGION" ]] || {
      echo "Existing dataset ${dataset} is in ${actual_location}, expected ${REGION}" >&2
      exit 1
    }
  else
    bq --project_id="$project" --location="$REGION" mk --dataset \
      --description="$description" "${project}:${dataset}"
  fi
}

ensure_dataset "$INGEST_DATASET" "Melens normalized ingestion and batch state"
ensure_dataset "$QUERY_DATASET" "Melens approved query views"

ensure_service_account() {
  local name="$1" email="$2" description="$3"
  if ! gcloud iam service-accounts describe "$email" --project="$project" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$name" --project="$project" \
      --display-name="$description" --quiet
  fi
}

ensure_service_account "$ingest_account" "$ingest_email" "Melens ${environment} data ingestion"
ensure_service_account "$query_account" "$query_email" "Melens ${environment} query service"
ensure_service_account "$scheduler_account" "$scheduler_email" "Melens ${environment} scheduler trigger"

gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
  --member="serviceAccount:${ingest_email}" --role=roles/storage.objectAdmin --quiet >/dev/null

# BigQuery dataset ACLs are updated from the current policy, preserving unrelated
# entries and authorized-view grants. bq add-iam-policy-binding excludes datasets.
grant_dataset_role() {
  local dataset="$1" email="$2" role="$3" source_file updated_file changed
  source_file="$(mktemp)"
  updated_file="$(mktemp)"
  bq --project_id="$project" show --format=prettyjson "${project}:${dataset}" >"$source_file"
  changed="$(python3 - "$source_file" "$updated_file" "$email" "$role" <<'PY'
import json
import sys

source_path, target_path, email, role = sys.argv[1:]
with open(source_path, encoding="utf-8") as stream:
    dataset = json.load(stream)
before = dataset.get("access", [])
# Dedicated datasets must not retain default broad readers/writers.
access = [entry for entry in before if entry.get("specialGroup") not in
          ("projectReaders", "projectWriters", "allAuthenticatedUsers")]
entry = {"role": role, "userByEmail": email}
if not any(item.get("userByEmail") == email and item.get("role") == role
           for item in access):
    access.append(entry)
dataset["access"] = access
with open(target_path, "w", encoding="utf-8") as stream:
    json.dump(dataset, stream)
print("yes" if access != before else "no")
PY
)"
  if [[ "$changed" == "yes" ]]; then
    bq --project_id="$project" update --source="$updated_file" "${project}:${dataset}" >/dev/null
  fi
  rm -f "$source_file" "$updated_file"
}

grant_dataset_role "$INGEST_DATASET" "$ingest_email" WRITER
grant_dataset_role "$QUERY_DATASET" "$query_email" READER

# Job User is project-scoped; dataset data access remains dataset-scoped.
for principal in "$ingest_email" "$query_email"; do
  gcloud projects add-iam-policy-binding "$project" \
    --member="serviceAccount:${principal}" \
    --role=roles/bigquery.jobUser --quiet >/dev/null
done

cat <<EOF
Bootstrap complete for ${project}.
No third-party secret access or Cloud Run Job permissions were granted.
Authorize query views after creating them; bind the scheduler identity to each
specific Cloud Run Job only when that job is deployed.
EOF
