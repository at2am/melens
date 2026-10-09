#!/usr/bin/env bash
set -euo pipefail
umask 077

# Plan by default. Prepares the agent service identity and its Firestore database in a
# project that cloud/data/infra/bootstrap.sh already prepared. It deploys nothing, grants
# no secret or bucket access and prints resource names, never credential material.
readonly REGION="australia-southeast2"
readonly FIRESTORE_LOCATION="australia-southeast2"
readonly FIRESTORE_DATABASE="(default)"
readonly QUERY_DATASET="melens_query"
readonly INGEST_DATASET="melens_ingest"
readonly TTL_FIELD="expiresAtTs"
readonly TTL_COLLECTION_GROUPS=(sessions turns attachments userEvents)
# The reviewed project roles of the agent identity; any other project role fails the audit.
readonly PROJECT_ROLES=(roles/aiplatform.user roles/bigquery.jobUser roles/datastore.user)
readonly APIS=(
  firestore.googleapis.com aiplatform.googleapis.com run.googleapis.com
  bigquery.googleapis.com bigquerystorage.googleapis.com artifactregistry.googleapis.com
  cloudbuild.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com
  iam.googleapis.com
)
gcloud_bin=${GCLOUD_BIN:-gcloud}
bq_bin=${BQ_BIN:-bq}

usage() {
  cat <<'USAGE'
Usage: bootstrap.sh --project PROJECT_ID --environment dev|prod [--verify | --apply --confirm-project PROJECT_ID]

Without --apply, prints the resource plan only. --verify reads the identity, its
project and dataset access, the Firestore database and its TTL policies without
changing anything; --apply creates what is missing and then verifies. Run as the
project integrator after cloud/data/infra/bootstrap.sh prepared the datasets.
USAGE
}
fail() { printf '%s\n' "$*" >&2; exit 1; }

project=""
environment=""
apply=false
verify=false
confirmation=""
while (($# > 0)); do
  case "$1" in
    --project|--environment|--confirm-project)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --project) project="$2" ;;
        --environment) environment="$2" ;;
        --confirm-project) confirmation="$2" ;;
      esac
      shift 2
      ;;
    --verify) verify=true; shift ;;
    --apply) apply=true; verify=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "Invalid GCP project ID" >&2; exit 2; }
[[ "$environment" == "dev" || "$environment" == "prod" ]] || { echo "Environment must be dev or prod" >&2; exit 2; }
if $apply; then
  [[ "$confirmation" == "$project" ]] || fail "--confirm-project must exactly match --project"
elif [[ -n "$confirmation" ]]; then
  fail "--confirm-project requires --apply"
fi

agent_account="melens-${environment}-agent"
agent_email="${agent_account}@${project}.iam.gserviceaccount.com"
lower() { tr '[:upper:]' '[:lower:]'; }

cat <<PLAN
Project: ${project} (${environment})
Region: ${REGION}
Service identity: ${agent_email}
  ${QUERY_DATASET} dataset READER; project roles ${PROJECT_ROLES[*]}
  No ${INGEST_DATASET}, bucket or secret access; the Maps Platform key is granted when the Routes API tool reads it
Firestore: ${FIRESTORE_DATABASE} in ${FIRESTORE_LOCATION}, Native mode, delete protection on
  TTL policy on ${TTL_FIELD} for the collection groups: ${TTL_COLLECTION_GROUPS[*]}
  Client security rules are not managed here; only the agent identity reaches the database
APIs: ${APIS[*]}
Vertex AI location: recorded in the deployment configuration (AGENT_VERTEX_LOCATION), not here
PLAN

if ! $verify; then
  echo "Plan only. No cloud resources were changed."
  exit 0
fi
for command_name in "$gcloud_bin" "$bq_bin" python3; do
  command -v "$command_name" >/dev/null || fail "Missing command: $command_name"
done
"$gcloud_bin" projects describe "$project" --format='value(projectId)' >/dev/null

dataset_json() { "$bq_bin" --project_id="$project" show --format=prettyjson "${project}:$1"; }

# BigQuery dataset ACLs are updated from the current policy, preserving unrelated
# entries and authorized-view grants. bq add-iam-policy-binding excludes datasets.
grant_dataset_role() {
  local dataset="$1" email="$2" role="$3" source_file updated_file changed
  source_file="$(mktemp)"
  updated_file="$(mktemp)"
  dataset_json "$dataset" >"$source_file"
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
    "$bq_bin" --project_id="$project" update --source="$updated_file" "${project}:${dataset}" >/dev/null
  fi
  rm -f "$source_file" "$updated_file"
}

# Prints "ROLE" lines for the identity's entries in a dataset ACL.
dataset_roles_of() {
  dataset_json "$1" | python3 -c '
import json, sys
email = sys.argv[1]
for entry in json.load(sys.stdin).get("access", []):
    if entry.get("userByEmail") == email:
        print(entry.get("role"))
' "$agent_email"
}

firestore_state() {
  "$gcloud_bin" firestore databases describe --database="$FIRESTORE_DATABASE" --project="$project" \
    --format='value(locationId,type,deleteProtectionState)' 2>/dev/null || true
}

# Prints "GROUP STATE" lines for the TTL field of each collection group.
ttl_states() {
  "$gcloud_bin" firestore fields ttls list --database="$FIRESTORE_DATABASE" --project="$project" \
    --format='value(name,ttlConfig.state)' 2>/dev/null | python3 -c '
import sys
field = sys.argv[1]
for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 2 or not parts[0].endswith("/fields/" + field):
        continue
    group = parts[0].split("/collectionGroups/")[1].split("/")[0]
    print(group, parts[1] or "NONE")
' "$TTL_FIELD"
}

if $apply; then
  "$gcloud_bin" services enable "${APIS[@]}" --project="$project" --quiet

  if ! "$gcloud_bin" iam service-accounts describe "$agent_email" --project="$project" >/dev/null 2>&1; then
    "$gcloud_bin" iam service-accounts create "$agent_account" --project="$project" \
      --display-name="Melens ${environment} agent service" --quiet
  fi

  grant_dataset_role "$QUERY_DATASET" "$agent_email" READER
  # Job User, Vertex AI and Firestore access are project-scoped; dataset data access stays dataset-scoped.
  for role in "${PROJECT_ROLES[@]}"; do
    "$gcloud_bin" projects add-iam-policy-binding "$project" \
      --member="serviceAccount:${agent_email}" --role="$role" --quiet >/dev/null
  done

  existing_db="$(firestore_state)"
  if [[ -z "$existing_db" ]]; then
    "$gcloud_bin" firestore locations list --project="$project" --format='value(locationId)' \
      | grep -qx "$FIRESTORE_LOCATION" || fail "Firestore location ${FIRESTORE_LOCATION} is not offered to ${project}"
    "$gcloud_bin" firestore databases create --database="$FIRESTORE_DATABASE" --project="$project" \
      --location="$FIRESTORE_LOCATION" --type=firestore-native --delete-protection --quiet >/dev/null
  fi

  for group in "${TTL_COLLECTION_GROUPS[@]}"; do
    state="$(ttl_states | awk -v g="$group" '$1 == g { print $2 }')"
    if [[ "$state" != "ACTIVE" && "$state" != "CREATING" ]]; then
      "$gcloud_bin" firestore fields ttls update "$TTL_FIELD" --collection-group="$group" \
        --database="$FIRESTORE_DATABASE" --project="$project" --enable-ttl --quiet >/dev/null
    fi
  done
fi

# Read-only audit; it reports every finding before failing.
problems=0
report() { printf '  %s\n' "$*"; }
problem() { problems=$((problems + 1)); printf '  PROBLEM: %s\n' "$*"; }
echo "Audit of ${project}:"

for api in "${APIS[@]}"; do
  "$gcloud_bin" services list --enabled --project="$project" --filter="config.name:${api}" \
    --format='value(config.name)' | grep -qx "$api" || problem "API ${api} is not enabled"
done

if "$gcloud_bin" iam service-accounts describe "$agent_email" --project="$project" >/dev/null 2>&1; then
  report "identity ${agent_email} exists"
else
  problem "identity ${agent_email} is missing"
fi

actual_roles="$("$gcloud_bin" projects get-iam-policy "$project" --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:${agent_email}" --format='value(bindings.role)' | sort -u)"
for role in "${PROJECT_ROLES[@]}"; do
  grep -qx "$role" <<<"$actual_roles" || problem "project role ${role} is missing"
done
while IFS= read -r role; do
  [[ -z "$role" ]] && continue
  printf '%s\n' "${PROJECT_ROLES[@]}" | grep -qx "$role" || problem "unreviewed project role ${role}"
done <<<"$actual_roles"
report "project roles: $(tr '\n' ' ' <<<"$actual_roles")"

query_roles="$(dataset_roles_of "$QUERY_DATASET" | sort -u | tr '\n' ' ')"
[[ "$query_roles" == "READER " ]] || problem "${QUERY_DATASET} access is '${query_roles}', expected READER only"
report "${QUERY_DATASET} dataset: ${query_roles:-none}"
ingest_roles="$(dataset_roles_of "$INGEST_DATASET" | sort -u | tr '\n' ' ')"
[[ -z "$ingest_roles" ]] || problem "${INGEST_DATASET} access '${ingest_roles}' bypasses the view boundary"
report "${INGEST_DATASET} dataset: ${ingest_roles:-none}"

secret_names=()
while IFS= read -r name; do [[ -n "$name" ]] && secret_names+=("$name"); done \
  < <("$gcloud_bin" secrets list --project="$project" --format='value(name)' 2>/dev/null || true)
accessible_secrets=()
for name in ${secret_names[@]+"${secret_names[@]}"}; do
  if "$gcloud_bin" secrets get-iam-policy "$name" --project="$project" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:${agent_email}" --format='value(bindings.role)' 2>/dev/null | grep -q .; then
    accessible_secrets+=("$name")
  fi
done
report "secret access: ${accessible_secrets[*]:-none} (the Maps Platform key is granted when the Routes API tool reads it)"

db_state="$(firestore_state)"
if [[ -z "$db_state" ]]; then
  problem "Firestore database ${FIRESTORE_DATABASE} is missing"
else
  read -r db_location db_type db_protection <<<"$db_state"
  [[ "$(lower <<<"$db_location")" == "$FIRESTORE_LOCATION" ]] || problem "Firestore database is in ${db_location}, expected ${FIRESTORE_LOCATION}"
  [[ "$db_type" == "FIRESTORE_NATIVE" ]] || problem "Firestore database type is ${db_type}, expected FIRESTORE_NATIVE"
  [[ "$db_protection" == "DELETE_PROTECTION_ENABLED" ]] || problem "Firestore delete protection is ${db_protection:-unset}"
  report "Firestore ${FIRESTORE_DATABASE}: ${db_location} ${db_type} ${db_protection}"
  ttl_output="$(ttl_states)"
  for group in "${TTL_COLLECTION_GROUPS[@]}"; do
    state="$(awk -v g="$group" '$1 == g { print $2 }' <<<"$ttl_output")"
    case "$state" in
      ACTIVE) report "TTL ${group}.${TTL_FIELD}: ACTIVE" ;;
      CREATING) report "TTL ${group}.${TTL_FIELD}: CREATING (rerun --verify until ACTIVE)" ;;
      *) problem "TTL ${group}.${TTL_FIELD} is ${state:-missing}" ;;
    esac
  done
fi

if ((problems > 0)); then
  fail "${problems} problem(s) found; nothing else was changed."
fi
if $apply; then
  cat <<DONE
Bootstrap complete for ${project}.
No secret, bucket or Cloud Run permissions were granted. Deploy the service with
infra/deploy.sh; register the project with Firebase and enable Anonymous Auth before
the app can obtain ID tokens.
DONE
else
  echo "Verify complete for ${project}. No cloud resources were changed."
fi
