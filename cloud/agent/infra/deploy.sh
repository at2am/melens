#!/usr/bin/env bash
set -euo pipefail
umask 077

# Plan by default. Deploys the agent service in production mode: Firestore sessions and
# Firebase ID tokens, never the development store or token. The integrator serializes
# validation, builds and cloud changes.
project=melens-510012
region=australia-southeast2
service=melens-dev-agent
identity=melens-dev-agent@melens-510012.iam.gserviceaccount.com
image=''
dynamic_scan_bytes=100000000
min_instances=0
apply=false
verify=false
confirm_project=''
origins=()
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
gcloud_bin=${GCLOUD_BIN:-gcloud}

usage() {
  cat <<'EOF'
Usage: deploy.sh --image IMAGE@sha256:DIGEST --allowed-origin ORIGIN [options]
  --project melens-510012          Development project only
  --allowed-origin ORIGIN         Repeat for each reviewed exact origin
  --dynamic-scan-bytes BYTES       100000000 default; 400000000 or 1000000000 reviewed dev ceilings
  --min-instances 0|1              0 default; 1 while judging, to avoid cold starts
  --verify                        Read-only identity and Firestore audit (bootstrap.sh --verify)
  --apply --confirm-project ID     Verify, deploy and read back; public agent service
No project/dataset/bucket/secret IAM grants, API enabling or Firebase setup.
EOF
}
fail() { printf '%s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --project|--image|--allowed-origin|--dynamic-scan-bytes|--min-instances|--confirm-project)
      (($# >= 2)) || fail "Missing value for $1"
      case "$1" in
        --project) project=$2 ;;
        --image) image=$2 ;;
        --allowed-origin) origins+=("$2") ;;
        --dynamic-scan-bytes) dynamic_scan_bytes=$2 ;;
        --min-instances) min_instances=$2 ;;
        --confirm-project) confirm_project=$2 ;;
      esac
      shift 2 ;;
    --verify) verify=true; shift ;;
    --apply) apply=true; verify=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
[[ $project == melens-510012 ]] || fail 'Only the reviewed development project is allowed'
# The same reviewed ceilings as cloud/map/infra/deploy.sh: the data tools read the same views.
[[ $dynamic_scan_bytes == 100000000 || $dynamic_scan_bytes == 400000000 || $dynamic_scan_bytes == 1000000000 ]] \
  || fail 'Unreviewed dynamic scan ceiling'
[[ $min_instances == 0 || $min_instances == 1 ]] || fail 'Minimum instances must be 0 or 1'
[[ $image =~ ^australia-southeast2-docker\.pkg\.dev/melens-510012/melens-data/agent@sha256:[a-f0-9]{64}$ ]] || fail 'An immutable development agent image digest is required'
((${#origins[@]} > 0)) || fail 'At least one reviewed app origin is required'
if $apply; then
  [[ $confirm_project == "$project" ]] || fail '--apply requires matching --confirm-project'
elif [[ -n $confirm_project ]]; then
  fail '--confirm-project requires --apply'
fi
task_tmp_dir=$(mktemp -d)
trap 'rm -rf -- "$task_tmp_dir"' EXIT
python3 - "$task_tmp_dir/env.json" "$project" "$dynamic_scan_bytes" "${origins[@]}" <<'PY'
import json, sys, urllib.parse
env_path, project, ceiling, *origins = sys.argv[1:]
if len(origins) != len(set(origins)):
    raise SystemExit('Duplicate app origin')
for origin in origins:
    parsed = urllib.parse.urlsplit(origin)
    loopback = parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')
    if not parsed.hostname or (parsed.scheme != 'https' and not loopback) or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or origin.endswith('/') or ',' in origin:
        raise SystemExit('An exact HTTPS or local development origin is required')
    try:
        port = parsed.port
    except ValueError:
        raise SystemExit('Invalid origin port')
    canonical = parsed.scheme + '://' + parsed.hostname
    if port is not None and port != (443 if parsed.scheme == 'https' else 80):
        canonical += ':' + str(port)
    if origin != canonical:
        raise SystemExit('App origin must use its canonical browser form')
# Every setting is explicit so the reviewed values, not code defaults, reach Cloud Run.
# AGENT_DEVELOPMENT_MODE and AGENT_DEVELOPMENT_TOKEN are never set: the service keeps
# sessions in Firestore and accepts only Firebase ID tokens.
env = {
    'AGENT_PROJECT_ID': project, 'AGENT_VERTEX_LOCATION': 'global', 'AGENT_MODEL': 'gemini-3.8-flash',
    'AGENT_FIRESTORE_DATABASE': '(default)', 'AGENT_ALLOWED_ORIGINS': ','.join(origins),
    'AGENT_PUBLIC_SOURCES_FILE': '/app/map/infra/dev-public-sources.json',
    'AGENT_MAX_MODEL_CALLS': '16', 'AGENT_TURN_TIMEOUT_MS': '270000',
    'AGENT_GROUNDING_TIMEOUT_MS': '40000', 'AGENT_TURNS_PER_HOUR': '120',
    'MAP_PROJECT_ID': project, 'MAP_BQ_LOCATION': 'australia-southeast2',
    'MAP_QUERY_DATASET': 'melens_query', 'MAP_DYNAMIC_SCAN_BYTES': ceiling,
    'MAP_HISTORICAL_SCAN_BYTES': '500000000', 'MAP_QUERY_TIMEOUT_MS': '10000',
    'MAP_DRY_RUN_TIMEOUT_MS': '5000', 'MAP_CANCEL_TIMEOUT_MS': '1000',
    'MAP_MAX_PAGE_ITEMS': '1000', 'MAP_MAX_RESPONSE_BYTES': '2097152',
    'MAP_RESPONSE_ENVELOPE_RESERVE_BYTES': '65536',
}
with open(env_path, 'w') as handle:
    json.dump(env, handle, indent=2)
print(json.dumps({'environment': env}, indent=2))
PY

if $verify; then
  "$script_dir/bootstrap.sh" --project "$project" --environment dev --verify | sed -n '/^Audit of/,$p'
  "$gcloud_bin" artifacts docker images describe "$image" "--project=$project" --format='value(image_summary.digest)' >/dev/null \
    || fail 'The agent image digest is not in Artifact Registry'
fi

# The 270 s turn timeout ends and stores a turn before the 300 s request timeout cuts its
# stream, and the 330 s turn lease (src/sessions/store.ts) outlives both.
deploy=("$gcloud_bin" run deploy "$service" "--project=$project" "--region=$region"
  "--image=$image" "--service-account=$identity" "--env-vars-file=$task_tmp_dir/env.json"
  --port=8080 --cpu=1 --memory=1Gi --concurrency=20 --timeout=300s
  "--min=$min_instances" --max=2 "--min-instances=$min_instances" --max-instances=2
  --no-cpu-boost --ingress=all --allow-unauthenticated --quiet)
printf 'Reviewed Cloud Run command:'
printf ' %q' "${deploy[@]}"
printf '\n'
if ! $apply; then
  printf '%s\n' 'Plan only. No cloud resources changed; the temporary env file is removed on exit.'
  exit 0
fi
"${deploy[@]}"
"$gcloud_bin" run services describe "$service" "--project=$project" "--region=$region" --format=json \
  > "$task_tmp_dir/service.json"
python3 - "$task_tmp_dir/service.json" "$task_tmp_dir/env.json" "$identity" "$image" <<'PY'
import json, sys
service_path, env_path, identity, image = sys.argv[1:]
with open(service_path) as handle:
    service = json.load(handle)
with open(env_path) as handle:
    expected = json.load(handle)
spec = service['spec']['template']['spec']
container = spec['containers'][0]
actual = {item['name']: item.get('value') for item in container.get('env', [])}
if actual != expected:
    raise SystemExit('The deployed environment differs from the reviewed settings')
if spec.get('serviceAccountName') != identity or container.get('image') != image:
    raise SystemExit('The deployed identity or image differs from the reviewed ones')
print(json.dumps({'url': service['status'].get('url'), 'revision': service['status'].get('latestReadyRevisionName'),
    'image': container['image'], 'identity': spec['serviceAccountName'], 'timeoutSeconds': spec.get('timeoutSeconds'),
    'concurrency': spec.get('containerConcurrency'), 'resources': container.get('resources'),
    'scaling': {key: value for key, value in service['spec']['template']['metadata'].get('annotations', {}).items() if 'Scale' in key}}, indent=2))
PY
"$gcloud_bin" run services get-iam-policy "$service" "--project=$project" "--region=$region" --format=json
