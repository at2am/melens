#!/usr/bin/env bash
set -euo pipefail
umask 077

# Plan by default. Prepares what .github/workflows/release.yml needs in melens-510012:
# Workload Identity Federation for this repository (no service account key), the release
# identity and its roles, and the Secret Manager secret that holds the Web build's browser keys.
# It deploys nothing and prints resource names, never key values.
readonly PROJECT="melens-510012"
readonly PROJECT_NUMBER="401001961508"
readonly REPOSITORY="at2am/melens"
readonly REPOSITORY_ID="1391679155"
readonly POOL="github"
readonly PROVIDER="melens"
readonly ACCOUNT="melens-github-release"
readonly EMAIL="${ACCOUNT}@${PROJECT}.iam.gserviceaccount.com"
readonly SECRET="melens-web-release-config"
readonly SECRET_LOCATION="australia-southeast2"
readonly BUILD_BUCKET="${PROJECT}_cloudbuild"
readonly QUERY_DATASET="melens_query"
# Only release jobs (GitHub environment "production") on a v* tag or main may obtain a token.
readonly CONDITION="assertion.repository_id == '${REPOSITORY_ID}' && assertion.environment == 'production' && (assertion.ref.startsWith('refs/tags/v') || assertion.ref == 'refs/heads/main')"
readonly PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository_id/${REPOSITORY_ID}"
# Deploy: run.admin (deploy.sh sets the public invoker binding), Cloud Build and Hosting.
# Audit: viewer and securityReviewer read the metadata and IAM policies the deploy scripts check;
# bigquery.jobUser runs the publication query of cloud/map/infra/deploy.sh.
readonly PROJECT_ROLES=(
  roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.reader
  roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer
  roles/viewer roles/iam.securityReviewer roles/bigquery.jobUser
)
# The identities the release acts as: the two Cloud Run runtimes and the Cloud Build worker.
readonly ACT_AS=(
  "melens-dev-query@${PROJECT}.iam.gserviceaccount.com"
  "melens-dev-agent@${PROJECT}.iam.gserviceaccount.com"
  "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
)
readonly APIS=(sts.googleapis.com iamcredentials.googleapis.com iam.googleapis.com secretmanager.googleapis.com)
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
gcloud_bin=${GCLOUD_BIN:-gcloud}
bq_bin=${BQ_BIN:-bq}

usage() {
  cat <<'EOF'
Usage: bootstrap.sh [--verify | --apply --confirm-project melens-510012] [--web-config FILE]
  --verify                       Read-only audit of everything below
  --apply --confirm-project ID   Create what is missing, then verify
  --web-config FILE              With --apply: store the browser keys of FILE (an app/config/*.json)
                                 as a new version of the Web release secret
Without --verify or --apply, prints the plan only.
EOF
}
fail() { printf '%s\n' "$*" >&2; exit 1; }

apply=false
verify=false
confirm_project=''
web_config=''
while (($#)); do
  case "$1" in
    --confirm-project|--web-config)
      (($# >= 2)) || fail "Missing value for $1"
      case "$1" in
        --confirm-project) confirm_project=$2 ;;
        --web-config) web_config=$2 ;;
      esac
      shift 2 ;;
    --verify) verify=true; shift ;;
    --apply) apply=true; verify=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
if $apply; then
  [[ $confirm_project == "$PROJECT" ]] || fail "--apply requires --confirm-project $PROJECT"
elif [[ -n $confirm_project || -n $web_config ]]; then
  fail '--confirm-project and --web-config require --apply'
fi
[[ -z $web_config || -f $web_config ]] || fail "No such file: $web_config"

cat <<EOF
Plan for ${PROJECT}:
  APIs: ${APIS[*]}
  identity: ${EMAIL}
  workload identity pool ${POOL}, OIDC provider ${PROVIDER} (https://token.actions.githubusercontent.com)
    condition: ${CONDITION}
  ${EMAIL} roles/iam.workloadIdentityUser for ${PRINCIPAL}
  project roles: ${PROJECT_ROLES[*]}
  roles/iam.serviceAccountUser on: ${ACT_AS[*]}
  gs://${BUILD_BUCKET}: roles/storage.objectAdmin, roles/storage.legacyBucketReader
  ${QUERY_DATASET} dataset: READER
  secret ${SECRET} (${SECRET_LOCATION}): roles/secretmanager.secretAccessor${web_config:+, new version from $web_config}
EOF
if ! $verify; then
  echo "Plan only. No cloud resources were changed."
  exit 0
fi
for command_name in "$gcloud_bin" "$bq_bin" python3; do
  command -v "$command_name" >/dev/null || fail "Missing command: $command_name"
done

provider_name="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
member="serviceAccount:${EMAIL}"

grant_dataset_reader() {
  local source_file updated_file changed
  source_file=$(mktemp)
  updated_file=$(mktemp)
  "$bq_bin" --project_id="$PROJECT" show --format=prettyjson "${PROJECT}:${QUERY_DATASET}" >"$source_file"
  changed=$(python3 - "$source_file" "$updated_file" "$EMAIL" <<'PY'
import json, sys
source_path, target_path, email = sys.argv[1:]
with open(source_path) as handle:
    dataset = json.load(handle)
access = dataset.get("access", [])
if any(entry.get("userByEmail") == email and entry.get("role") == "READER" for entry in access):
    print("no")
else:
    dataset["access"] = access + [{"role": "READER", "userByEmail": email}]
    with open(target_path, "w") as handle:
        json.dump(dataset, handle)
    print("yes")
PY
)
  if [[ $changed == yes ]]; then
    "$bq_bin" --project_id="$PROJECT" update --source="$updated_file" "${PROJECT}:${QUERY_DATASET}" >/dev/null
  fi
  rm -f "$source_file" "$updated_file"
}

if $apply; then
  "$gcloud_bin" services enable "${APIS[@]}" --project="$PROJECT" --quiet
  if ! "$gcloud_bin" iam service-accounts describe "$EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
    "$gcloud_bin" iam service-accounts create "$ACCOUNT" --project="$PROJECT" \
      --display-name="GitHub Actions release" \
      --description="Releases the Cloud Run services and the Web app from .github/workflows/release.yml"
  fi
  if ! "$gcloud_bin" iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT" >/dev/null 2>&1; then
    "$gcloud_bin" iam workload-identity-pools create "$POOL" --location=global --project="$PROJECT" \
      --display-name="GitHub Actions"
  fi
  provider_args=(--location=global --project="$PROJECT" --workload-identity-pool="$POOL"
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment"
    --attribute-condition="$CONDITION")
  if "$gcloud_bin" iam workload-identity-pools providers describe "$PROVIDER" --location=global \
      --project="$PROJECT" --workload-identity-pool="$POOL" >/dev/null 2>&1; then
    "$gcloud_bin" iam workload-identity-pools providers update-oidc "$PROVIDER" "${provider_args[@]}" >/dev/null
  else
    "$gcloud_bin" iam workload-identity-pools providers create-oidc "$PROVIDER" "${provider_args[@]}" \
      --display-name="${REPOSITORY}" --issuer-uri="https://token.actions.githubusercontent.com"
  fi
  "$gcloud_bin" iam service-accounts add-iam-policy-binding "$EMAIL" --project="$PROJECT" \
    --role=roles/iam.workloadIdentityUser --member="$PRINCIPAL" --condition=None >/dev/null
  for role in "${PROJECT_ROLES[@]}"; do
    "$gcloud_bin" projects add-iam-policy-binding "$PROJECT" --member="$member" --role="$role" \
      --condition=None >/dev/null
  done
  for account in "${ACT_AS[@]}"; do
    "$gcloud_bin" iam service-accounts add-iam-policy-binding "$account" --project="$PROJECT" \
      --role=roles/iam.serviceAccountUser --member="$member" --condition=None >/dev/null
  done
  for role in roles/storage.objectAdmin roles/storage.legacyBucketReader; do
    "$gcloud_bin" storage buckets add-iam-policy-binding "gs://${BUILD_BUCKET}" --member="$member" \
      --role="$role" >/dev/null
  done
  grant_dataset_reader
  if ! "$gcloud_bin" secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
    "$gcloud_bin" secrets create "$SECRET" --project="$PROJECT" \
      --replication-policy=user-managed --locations="$SECRET_LOCATION"
  fi
  "$gcloud_bin" secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" \
    --role=roles/secretmanager.secretAccessor --member="$member" --condition=None >/dev/null
  if [[ -n $web_config ]]; then
    keys_file=$(mktemp)
    trap 'rm -f -- "$keys_file"' EXIT
    python3 "$script_dir/web_config.py" --keys-only --output "$keys_file" <"$web_config"
    "$gcloud_bin" secrets versions add "$SECRET" --project="$PROJECT" --data-file="$keys_file" >/dev/null
    rm -f -- "$keys_file"
    echo "Stored a new version of ${SECRET} from ${web_config}."
  fi
fi

problems=0
report() { printf '  %s\n' "$*"; }
problem() { problems=$((problems + 1)); printf '  PROBLEM: %s\n' "$*"; }
echo "Audit of ${PROJECT}:"

for api in "${APIS[@]}"; do
  "$gcloud_bin" services list --enabled --project="$PROJECT" --filter="config.name:${api}" \
    --format='value(config.name)' | grep -qx "$api" || problem "API ${api} is not enabled"
done
if "$gcloud_bin" iam service-accounts describe "$EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  report "identity ${EMAIL} exists"
else
  problem "identity ${EMAIL} is missing"
fi
provider_state=$("$gcloud_bin" iam workload-identity-pools providers describe "$PROVIDER" --location=global \
  --project="$PROJECT" --workload-identity-pool="$POOL" --format='value(state,attributeCondition)' 2>/dev/null || true)
if [[ $provider_state == "ACTIVE"$'\t'"$CONDITION" ]]; then
  report "provider ${provider_name}: ACTIVE, reviewed condition"
else
  problem "provider ${provider_name} is missing, inactive or has another condition"
fi
if "$gcloud_bin" iam service-accounts get-iam-policy "$EMAIL" --project="$PROJECT" --format=json 2>/dev/null \
  | python3 -c '
import json, sys
principal = sys.argv[1]
policy = json.load(sys.stdin)
sys.exit(0 if any(b.get("role") == "roles/iam.workloadIdentityUser" and principal in b.get("members", [])
                  for b in policy.get("bindings", [])) else 1)' "$PRINCIPAL"; then
  report "repository ${REPOSITORY} may impersonate ${EMAIL}"
else
  problem "repository ${REPOSITORY} cannot impersonate ${EMAIL}"
fi

actual_roles=$("$gcloud_bin" projects get-iam-policy "$PROJECT" --flatten='bindings[].members' \
  --filter="bindings.members:${member}" --format='value(bindings.role)' | sort -u)
for role in "${PROJECT_ROLES[@]}"; do
  grep -qx "$role" <<<"$actual_roles" || problem "project role ${role} is missing"
done
while IFS= read -r role; do
  [[ -z $role ]] && continue
  printf '%s\n' "${PROJECT_ROLES[@]}" | grep -qx "$role" || problem "unreviewed project role ${role}"
done <<<"$actual_roles"
report "project roles: $(tr '\n' ' ' <<<"$actual_roles")"
for account in "${ACT_AS[@]}"; do
  "$gcloud_bin" iam service-accounts get-iam-policy "$account" --project="$PROJECT" --flatten='bindings[].members' \
    --filter="bindings.members:${member}" --format='value(bindings.role)' 2>/dev/null \
    | grep -qx roles/iam.serviceAccountUser || problem "cannot act as ${account}"
done
report "acts as: ${ACT_AS[*]}"
# gcloud storage has no --filter; read the policy and pick the member's roles.
bucket_roles=$("$gcloud_bin" storage buckets get-iam-policy "gs://${BUILD_BUCKET}" --format=json 2>/dev/null | python3 -c '
import json, sys
print(" ".join(sorted(b["role"] for b in json.load(sys.stdin).get("bindings", []) if sys.argv[1] in b.get("members", []))) + " ")' \
  "$member" || true)
[[ $bucket_roles == "roles/storage.legacyBucketReader roles/storage.objectAdmin " ]] \
  || problem "gs://${BUILD_BUCKET} access is '${bucket_roles}'"
report "gs://${BUILD_BUCKET}: ${bucket_roles:-none}"
dataset_roles=$("$bq_bin" --project_id="$PROJECT" show --format=prettyjson "${PROJECT}:${QUERY_DATASET}" | python3 -c '
import json, sys
print(" ".join(sorted(e.get("role") for e in json.load(sys.stdin).get("access", []) if e.get("userByEmail") == sys.argv[1])))' "$EMAIL")
[[ $dataset_roles == READER ]] || problem "${QUERY_DATASET} access is '${dataset_roles}', expected READER"
report "${QUERY_DATASET} dataset: ${dataset_roles:-none}"
secret_versions=$("$gcloud_bin" secrets versions list "$SECRET" --project="$PROJECT" --filter='state=ENABLED' \
  --format='value(name)' 2>/dev/null | wc -l | tr -d ' ' || true)
"$gcloud_bin" secrets get-iam-policy "$SECRET" --project="$PROJECT" --flatten='bindings[].members' \
  --filter="bindings.members:${member}" --format='value(bindings.role)' 2>/dev/null \
  | grep -qx roles/secretmanager.secretAccessor || problem "cannot read secret ${SECRET}"
((secret_versions > 0)) || problem "secret ${SECRET} has no enabled version; rerun --apply with --web-config"
report "secret ${SECRET}: ${secret_versions} enabled version(s)"

if ((problems > 0)); then
  fail "${problems} problem(s) found."
fi
echo "Ready: push a v* tag to release."
