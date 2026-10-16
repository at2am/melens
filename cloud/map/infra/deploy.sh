#!/usr/bin/env bash
set -euo pipefail
umask 077

# Plan by default. The integrator serializes validation, builds and cloud changes.
project=melens-510012
region=australia-southeast2
service=melens-dev-map
identity=melens-dev-query@melens-510012.iam.gserviceaccount.com
image=''
dynamic_scan_bytes=100000000
min_instances=1
apply=false
verify=false
confirm_project=''
origins=()
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
gcloud_bin=${GCLOUD_BIN:-gcloud}
bq_bin=${BQ_BIN:-bq}

usage() {
  cat <<'EOF'
Usage: deploy.sh --image IMAGE@sha256:DIGEST --allowed-origin ORIGIN [options]
  --project melens-510012          Development project only
  --allowed-origin ORIGIN         Repeat for each reviewed exact origin
  --dynamic-scan-bytes BYTES       100000000 default; 400000000 or 1000000000 reviewed dev ceilings
  --min-instances 0|1              1 default, so the map and feed avoid cold starts and keep the layer cache warm; 0 to idle for free
  --verify                        Read-only cloud identity/publication audit
  --apply --confirm-project ID     Verify, deploy and read back; public map service
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
# 1000000000 was reviewed on 2026-10-09: the current geo view dry run had grown past 400000000
# as more topics share the view. Partitioning that view is the lasting fix; see infra/README.md.
[[ $dynamic_scan_bytes == 100000000 || $dynamic_scan_bytes == 400000000 || $dynamic_scan_bytes == 1000000000 ]] \
  || fail 'Unreviewed dynamic scan ceiling'
[[ $min_instances == 0 || $min_instances == 1 ]] || fail 'Minimum instances must be 0 or 1'
[[ $image =~ ^australia-southeast2-docker\.pkg\.dev/melens-510012/melens-data/map@sha256:[a-f0-9]{64}$ ]] || fail 'An immutable development map image digest is required'
((${#origins[@]} > 0)) || fail 'At least one reviewed app origin is required'
if $apply; then
  [[ $confirm_project == "$project" ]] || fail '--apply requires matching --confirm-project'
elif [[ -n $confirm_project ]]; then
  fail '--confirm-project requires --apply'
fi
task_tmp_dir=$(mktemp -d)
trap 'rm -rf -- "$task_tmp_dir"' EXIT
python3 - "$task_tmp_dir/env.json" "$task_tmp_dir/expected-sources.json" "$script_dir/dev-public-sources.json" "$dynamic_scan_bytes" "${origins[@]}" <<'PY'
import json, sys, urllib.parse
env_path, expected_path, registry_path, ceiling, *origins = sys.argv[1:]
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
with open(registry_path) as handle:
    registry = json.load(handle)
# The reviewed development sources (infra/README.md, 2026-10-09 admission): the licence status
# v_source_coverage must report and the official host of the reference URL. A null URL is
# reviewed only where every published record carries its own original link, or where the
# records are published in the app itself (user.events, UC-09) and have no external publisher.
reviewed = {
    'melbourne.municipal_boundary': ('verified_open', 'data.melbourne.vic.gov.au'),
    'melbourne.development_monitor': ('verified_open', 'data.melbourne.vic.gov.au'),
    'victoria.council.engagement': ('restricted', None),
    'ticketmaster.events': ('restricted', 'developer.ticketmaster.com'),
    'gdelt.news': ('verified_open', 'www.gdeltproject.org'),
    'victoria.council.engagement_news': ('restricted', None),
    # 'user.events' (UC-09) returns here once the user_events export publishes into v_source_coverage; until then the
    # audit below cannot pass with it listed, and the app reads community events from the agent service instead.
    # The labelled replay of a historical day (UC-04): derived from City of Melbourne CC BY counts, registered
    # 2026-10-15 without the live-source admission gates; the team has yet to review it.
    'melens.anomaly.replay': ('verified_open', 'data.melbourne.vic.gov.au'),
    # The live parking layer (UC-15), added 2026-10-15: City of Melbourne on-street sensors, CC BY 4.0. Only the
    # sensor feed is public; the static bay points and restriction rules stay unpublished references.
    'melbourne.parking.sensors': ('verified_open', 'data.melbourne.vic.gov.au'),
    # ABS ASGS 2021/2026 boundaries (CC BY 4.0), added 2026-10-16 so UC-06 can draw the areas news articles
    # name; it also serves the boundary layer, whose items needed this reference.
    'abs.asgs.boundaries': ('verified_open', 'www.abs.gov.au'),
}
expected = set(reviewed)
if not isinstance(registry, list) or len(registry) != len(expected) or {item.get('sourceId') for item in registry} != expected:
    raise SystemExit('Public registry differs from the reviewed development sources')
for item in registry:
    if set(item) != {'sourceId', 'url', 'attribution', 'versionRef'} or not isinstance(item['attribution'], str) or not item['attribution'].strip() or item['versionRef'] is not None:
        raise SystemExit('Invalid public source reference')
    host = reviewed[item['sourceId']][1]
    if host is None:
        if item['url'] is not None:
            raise SystemExit('Public registry carries an unreviewed reference URL')
        continue
    parsed = urllib.parse.urlsplit(item['url'] or '')
    if parsed.scheme != 'https' or parsed.netloc != host or parsed.query or parsed.fragment:
        raise SystemExit('Public registry requires the reviewed official dataset pages')
with open(expected_path, 'w') as handle:
    json.dump({source: status for source, (status, _host) in reviewed.items()}, handle)
env = {
    'MAP_PROJECT_ID': 'melens-510012', 'MAP_BQ_LOCATION': 'australia-southeast2',
    'MAP_QUERY_DATASET': 'melens_query', 'MAP_DYNAMIC_SCAN_BYTES': ceiling,
    'MAP_HISTORICAL_SCAN_BYTES': '500000000', 'MAP_QUERY_TIMEOUT_MS': '10000',
    'MAP_DRY_RUN_TIMEOUT_MS': '5000', 'MAP_CANCEL_TIMEOUT_MS': '1000',
    'MAP_MAX_PAGE_ITEMS': '1000', 'MAP_MAX_RESPONSE_BYTES': '2097152',
    'MAP_RESPONSE_ENVELOPE_RESERVE_BYTES': '65536',
    'MAP_ALLOWED_ORIGINS': ','.join(origins),
    'MAP_PUBLIC_SOURCES_FILE': '/app/map/infra/dev-public-sources.json',
}
with open(env_path, 'w') as handle:
    json.dump(env, handle, indent=2)
print(json.dumps({'publicSources': sorted(expected), 'environment': env}, indent=2))
PY

if $verify; then
  python3 - "$gcloud_bin" "$bq_bin" "$project" "$identity" "$task_tmp_dir/expected-sources.json" <<'PY'
import json, subprocess, sys
gcloud, bq, project, identity, expected_path = sys.argv[1:]
member = 'serviceAccount:' + identity
def read(command):
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit('Cloud metadata read failed; inspect CLI authorization before deployment')
    return json.loads(result.stdout)
def gc(*args):
    return read([gcloud, *args, '--project=' + project, '--format=json'])
account = gc('iam', 'service-accounts', 'describe', identity)
if account.get('disabled') or account.get('email') != identity:
    raise SystemExit('Dedicated query identity is missing or disabled')
policy = gc('projects', 'get-iam-policy', project)
roles = {binding['role'] for binding in policy.get('bindings', []) if member in binding.get('members', [])}
if roles != {'roles/bigquery.jobUser'}:
    raise SystemExit('Query identity project roles differ from the reviewed read-only role')
query = read([bq, 'show', '--format=prettyjson', project + ':melens_query'])
ingest = read([bq, 'show', '--format=prettyjson', project + ':melens_ingest'])
if query.get('location') != 'australia-southeast2' or ingest.get('location') != 'australia-southeast2':
    raise SystemExit('Dataset location differs from the reviewed region')
grants = [entry.get('role') for entry in query.get('access', []) if entry.get('userByEmail') == identity]
if grants != ['READER'] or any(entry.get('userByEmail') == identity for entry in ingest.get('access', [])):
    raise SystemExit('Query identity dataset access differs from the reviewed view boundary')
# Every view cloud/data/sql publishes into melens_query; the query identity reads the dataset.
approved = {
    'v_area_indicators', 'v_boundaries', 'v_change_timeline', 'v_crime_area_statistics',
    'v_crime_news_current', 'v_events_current', 'v_geo_records_current', 'v_geo_records_history',
    'v_melbourne_news_current', 'v_news_current', 'v_news_history', 'v_news_sources', 'v_parking_current',
    'v_parking_rule_reference', 'v_parking_sensor_current', 'v_parking_unmatched_observations',
    'v_pedestrian_observations', 'v_planning_changes_current', 'v_road_disruptions_current',
    'v_road_disruptions_history', 'v_source_abnormal_delay', 'v_source_coverage', 'v_source_health',
    'v_street_observations', 'v_transport_changes_current',
    'v_anomaly_current',  # 009: anomaly results of published batches, the detector's or the labelled replay (UC-04)
    'v_geo_records_current_served', 'v_geo_records_current_state',  # 010: the refreshed current geo copy the map reads
}
views = read([bq, 'ls', '--max_results=1000', '--format=prettyjson', project + ':melens_query'])
if any(table.get('type') != 'VIEW' or table['tableReference']['tableId'] not in approved for table in views):
    raise SystemExit('Query dataset contains an unreviewed resource')
required = {'v_source_coverage', 'v_boundaries', 'v_geo_records_current_served', 'v_geo_records_current_state',
    'v_geo_records_history', 'v_pedestrian_observations'}
if not required.issubset({table['tableReference']['tableId'] for table in views}):
    raise SystemExit('Required public query views are missing')
for secret in gc('secrets', 'list'):
    name = secret['name'].rsplit('/', 1)[-1]
    secret_policy = gc('secrets', 'get-iam-policy', name)
    if any(member in binding.get('members', []) for binding in secret_policy.get('bindings', [])):
        raise SystemExit('Query identity has an unexpected Secret Manager grant')
for bucket in gc('storage', 'buckets', 'list'):
    name = bucket['name']
    bucket_policy = read([gcloud, 'storage', 'buckets', 'get-iam-policy', 'gs://' + name, '--format=json'])
    if any(member in binding.get('members', []) for binding in bucket_policy.get('bindings', [])):
        raise SystemExit('Query identity has an unexpected bucket grant')
with open(expected_path) as handle:
    expected_status = json.load(handle)
row_limit = len(expected_status) + 1
statement = '''SELECT source_id, license_status, access_status, latest_published_batch_id,
latest_published_at, latest_published_output_count
FROM `melens-510012.melens_query.v_source_coverage`
WHERE source_id IN (%s)
ORDER BY source_id LIMIT %d''' % (', '.join("'%s'" % source for source in sorted(expected_status)), row_limit)
publications = read([bq, 'query', '--project_id=' + project, '--location=australia-southeast2',
    '--use_legacy_sql=false', '--maximum_bytes_billed=100000000', '--max_rows=' + str(row_limit),
    '--format=prettyjson', statement])
if len(publications) != len(expected_status) or {row['source_id'] for row in publications} != set(expected_status) or any(
    row['license_status'] != expected_status[row['source_id']] or row['access_status'] != 'active'
    or not row['latest_published_batch_id'] or not row['latest_published_at']
    for row in publications
):
    raise SystemExit('Public references require every reviewed source to be admitted, active and published')
print(json.dumps({'identity': identity, 'projectRoles': sorted(roles), 'queryAccess': 'READER on approved views only', 'ingestSecretBucketGrants': False, 'reviewedViews': len(views), 'publications': publications, 'publicationReadIdentity': 'existing CLI user; runtime query identity verified after deployment'}))
PY
fi

deploy=("$gcloud_bin" run deploy "$service" "--project=$project" "--region=$region"
  "--image=$image" "--service-account=$identity" "--env-vars-file=$task_tmp_dir/env.json"
  --port=8080 --cpu=1 --memory=512Mi --concurrency=8 --timeout=30s
  "--min=$min_instances" --max=1 "--min-instances=$min_instances" --max-instances=1 --no-cpu-boost --ingress=all
  --allow-unauthenticated --quiet)
printf 'Reviewed Cloud Run command:'
printf ' %q' "${deploy[@]}"
printf '\n'
if ! $apply; then
  printf '%s\n' 'Plan only. No cloud resources changed; the temporary env file is removed on exit.'
  exit 0
fi
"$gcloud_bin" artifacts docker images describe "$image" "--project=$project" --format='value(image_summary.digest)'
"${deploy[@]}"
"$gcloud_bin" run services describe "$service" "--project=$project" "--region=$region" \
  --format='yaml(metadata.name,status.url,status.latestReadyRevisionName,spec.template.spec.serviceAccountName,spec.template.metadata.annotations,spec.template.spec.containers)'
"$gcloud_bin" run services get-iam-policy "$service" "--project=$project" "--region=$region" --format=json
