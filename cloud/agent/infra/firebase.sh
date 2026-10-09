#!/usr/bin/env bash
set -euo pipefail
umask 077

# Plan by default. Registers the project with Firebase for the app's sign-in: Anonymous Auth
# as the only provider, the Web, Android and iOS apps, and Firestore rules that deny every
# client. It grants no IAM role and prints resource names, never API keys; --app-config
# writes the apps' client configuration into an ignored app config file instead.
readonly APIS=(
  firebase.googleapis.com identitytoolkit.googleapis.com securetoken.googleapis.com
  firebaserules.googleapis.com apikeys.googleapis.com
)
readonly APP_ID=com.at2am.melens
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/../../.." && pwd)
gcloud_bin=${GCLOUD_BIN:-gcloud}

usage() {
  cat <<'USAGE'
Usage: firebase.sh --project melens-510012 [--verify | --apply --confirm-project melens-510012] [--app-config FILE]

Without --apply, prints the plan only. --verify reads the Firebase registration, the Auth
providers, the registered apps and the Firestore rules release without changing anything;
--apply creates what is missing and then verifies. --app-config FILE (an ignored file under
app/config) receives the FIREBASE_* keys after a passing verify; keys are never printed.
USAGE
}
fail() { printf '%s\n' "$*" >&2; exit 1; }

project=""
apply=false
verify=false
confirmation=""
app_config=""
while (($# > 0)); do
  case "$1" in
    --project|--confirm-project|--app-config)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --project) project="$2" ;;
        --confirm-project) confirmation="$2" ;;
        --app-config) app_config="$2" ;;
      esac
      shift 2
      ;;
    --verify) verify=true; shift ;;
    --apply) apply=true; verify=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ $project == melens-510012 ]] || fail 'Only the reviewed development project is allowed'
if $apply; then
  [[ $confirmation == "$project" ]] || fail '--apply requires matching --confirm-project'
elif [[ -n $confirmation ]]; then
  fail '--confirm-project requires --apply'
fi
if [[ -n $app_config ]]; then
  $verify || fail '--app-config requires --verify or --apply'
  config_dir=$(cd -- "$(dirname -- "$app_config")" && pwd) || fail 'The app config directory does not exist'
  app_config="$config_dir/$(basename -- "$app_config")"
  [[ $config_dir == "$repo_root/app/config" && $app_config == *.json && $app_config != */example.json ]] \
    || fail 'The app config must be a JSON file under app/config other than example.json'
  git -C "$repo_root" check-ignore -q "$app_config" || fail 'The app config file must be ignored by git'
fi

cat <<PLAN
Project: ${project}
APIs: ${APIS[*]}
Firebase: add Firebase to the project
Auth: Anonymous sign-in on; email, phone and every identity provider stay off
Apps: Web "Melens Web", Android ${APP_ID}, iOS ${APP_ID}
Firestore: rules release cloud.firestore from cloud/agent/infra/firestore.rules (deny every client)
PLAN

if ! $verify; then
  echo 'Plan only. No cloud resources changed.'
  exit 0
fi
if $apply; then
  "$gcloud_bin" services enable "${APIS[@]}" --project="$project" --quiet
fi

python3 - "$gcloud_bin" "$project" "$APP_ID" "$script_dir/firestore.rules" "$apply" "$app_config" "${APIS[@]}" <<'PY'
import base64, json, plistlib, subprocess, sys, time, urllib.error, urllib.request
gcloud, project, app_id, rules_path, apply, app_config, *apis = sys.argv[1:]
apply = apply == 'true'
token = subprocess.run([gcloud, 'auth', 'print-access-token'], capture_output=True, text=True).stdout.strip()
if not token:
    raise SystemExit('No gcloud access token; run gcloud auth login')
FIREBASE = 'https://firebase.googleapis.com/v1beta1/'
AUTH = 'https://identitytoolkit.googleapis.com/'
RULES = 'https://firebaserules.googleapis.com/v1/'

def call(method, url, body=None, missing_ok=False):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token, 'x-goog-user-project': project, 'Content-Type': 'application/json'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            # Creating apps shares a small per-minute provisioning quota.
            if error.code == 429 and attempt < 5:
                time.sleep(20)
                continue
            if missing_ok and error.code in (403, 404):
                return None
            detail = json.loads(error.read() or b'{}').get('error', {})
            raise SystemExit(f'{method} {url.split("?")[0]} failed: {error.code} {detail.get("status", "")} {detail.get("message", "")[:200]}')

def wait(operation):
    for _ in range(60):
        if operation.get('done'):
            if 'error' in operation:
                raise SystemExit(f'Operation {operation.get("name")} failed: {operation["error"].get("message", "")[:200]}')
            return operation.get('response', {})
        time.sleep(5)
        operation = call('GET', FIREBASE + operation['name'])
    raise SystemExit(f'Operation {operation.get("name")} did not finish in 5 minutes')

problems = []
def report(line): print('  ' + line)
def problem(line):
    problems.append(line)
    print('  PROBLEM: ' + line)

with open(rules_path) as handle:
    rules_source = handle.read()

if apply:
    if call('GET', FIREBASE + f'projects/{project}', missing_ok=True) is None:
        wait(call('POST', FIREBASE + f'projects/{project}:addFirebase', {}))
    if call('GET', AUTH + f'admin/v2/projects/{project}/config', missing_ok=True) is None:
        call('POST', AUTH + f'v2/projects/{project}/identityPlatform:initializeAuth', {})
    config = call('GET', AUTH + f'admin/v2/projects/{project}/config')
    if not config.get('signIn', {}).get('anonymous', {}).get('enabled'):
        call('PATCH', AUTH + f'admin/v2/projects/{project}/config?updateMask=signIn.anonymous.enabled',
             {'signIn': {'anonymous': {'enabled': True}}})
    wanted = {'webApps': {'displayName': 'Melens Web'},
              'androidApps': {'displayName': 'Melens Android', 'packageName': app_id},
              'iosApps': {'displayName': 'Melens iOS', 'bundleId': app_id}}
    for kind, body in wanted.items():
        apps = call('GET', FIREBASE + f'projects/{project}/{kind}').get('apps', [])
        if not apps:
            wait(call('POST', FIREBASE + f'projects/{project}/{kind}', body))
    release = call('GET', RULES + f'projects/{project}/releases/cloud.firestore', missing_ok=True)
    current = None
    if release is not None:
        current = call('GET', RULES + release['rulesetName'])['source']['files'][0]['content']
    if current != rules_source:
        ruleset = call('POST', RULES + f'projects/{project}/rulesets',
                       {'source': {'files': [{'name': 'firestore.rules', 'content': rules_source}]}})
        name = f'projects/{project}/releases/cloud.firestore'
        if release is None:
            call('POST', RULES + f'projects/{project}/releases', {'name': name, 'rulesetName': ruleset['name']})
        else:
            call('PATCH', RULES + name, {'release': {'name': name, 'rulesetName': ruleset['name']}})

print(f'Audit of {project}:')
enabled = set(subprocess.run([gcloud, 'services', 'list', '--enabled', '--project=' + project, '--format=value(config.name)'],
                             capture_output=True, text=True).stdout.split())
missing_apis = [api for api in apis if api not in enabled]
problem('APIs not enabled: ' + ' '.join(missing_apis)) if missing_apis else report('APIs enabled')

firebase = call('GET', FIREBASE + f'projects/{project}', missing_ok=True)
if firebase is None or firebase.get('state') != 'ACTIVE':
    problem('the project is not registered with Firebase')
else:
    report(f'Firebase project {firebase["projectId"]} ({firebase["state"]})')

config = call('GET', AUTH + f'admin/v2/projects/{project}/config', missing_ok=True) if firebase else None
if config is None:
    problem('Auth is not initialized')
else:
    sign_in = config.get('signIn', {})
    report('Auth authorized domains: ' + ' '.join(config.get('authorizedDomains', [])))
    if sign_in.get('anonymous', {}).get('enabled'):
        report('Auth anonymous sign-in: on')
    else:
        problem('Auth anonymous sign-in is off')
    others = [name for name in ('email', 'phoneNumber') if sign_in.get(name, {}).get('enabled')]
    idps = call('GET', AUTH + f'admin/v2/projects/{project}/defaultSupportedIdpConfigs').get('defaultSupportedIdpConfigs', [])
    others += [idp['name'].rsplit('/', 1)[-1] for idp in idps if idp.get('enabled')]
    problem('other sign-in providers are on: ' + ' '.join(others)) if others else report('Auth other providers: off')

apps = {}
if firebase:
    for kind, key in (('webApps', None), ('androidApps', 'packageName'), ('iosApps', 'bundleId')):
        found = call('GET', FIREBASE + f'projects/{project}/{kind}').get('apps', [])
        if len(found) != 1 or (key and found[0].get(key) != app_id) or found[0].get('state') != 'ACTIVE':
            problem(f'{kind}: expected one active app' + (f' for {app_id}' if key else '') + f', found {len(found)}')
        else:
            apps[kind] = found[0]['appId']
            report(f'{kind}: {found[0]["appId"]} ({found[0].get("displayName")})')

release = call('GET', RULES + f'projects/{project}/releases/cloud.firestore', missing_ok=True)
if release is None:
    problem('no Firestore rules release')
elif call('GET', RULES + release['rulesetName'])['source']['files'][0]['content'] != rules_source:
    problem('the Firestore rules release differs from firestore.rules')
else:
    report(f'Firestore rules: {release["rulesetName"].rsplit("/", 1)[-1]} matches firestore.rules (deny every client)')

if problems:
    raise SystemExit(f'{len(problems)} problem(s) found; nothing else was changed.')
print(f'{"Firebase setup" if apply else "Verify"} complete for {project}.')

if app_config:
    web = call('GET', FIREBASE + f'projects/{project}/webApps/{apps["webApps"]}/config')
    android = json.loads(base64.b64decode(call('GET', FIREBASE + f'projects/{project}/androidApps/{apps["androidApps"]}/config')['configFileContents']))
    client = next(item for item in android['client'] if item['client_info']['android_client_info']['package_name'] == app_id)
    ios = plistlib.loads(base64.b64decode(call('GET', FIREBASE + f'projects/{project}/iosApps/{apps["iosApps"]}/config')['configFileContents']))
    values = {
        'FIREBASE_PROJECT_ID': web['projectId'], 'FIREBASE_MESSAGING_SENDER_ID': web['messagingSenderId'],
        'FIREBASE_WEB_API_KEY': web['apiKey'], 'FIREBASE_WEB_APP_ID': web['appId'],
        'FIREBASE_ANDROID_API_KEY': client['api_key'][0]['current_key'],
        'FIREBASE_ANDROID_APP_ID': client['client_info']['mobilesdk_app_id'],
        'FIREBASE_IOS_API_KEY': ios['API_KEY'], 'FIREBASE_IOS_APP_ID': ios['GOOGLE_APP_ID'],
    }
    try:
        with open(app_config) as handle:
            existing = json.load(handle)
    except FileNotFoundError:
        existing = {}
    existing.update(values)
    with open(app_config, 'w') as handle:
        json.dump(existing, handle, indent=2)
        handle.write('\n')
    print(f'Wrote {" ".join(sorted(values))} to {app_config}; the values were not printed.')
PY
