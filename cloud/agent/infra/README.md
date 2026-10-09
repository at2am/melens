# Agent service infrastructure

`bootstrap.sh` prepares the agent service identity and its Firestore database in a
project that [`cloud/data/infra/bootstrap.sh`](../../data/infra/README.md) already
prepared. `deploy.sh` then deploys the service to Cloud Run ([Deployment](#deployment)).
Both plan by default, `--verify` is a read-only audit, and `--apply --confirm-project`
changes the project and then audits. Neither grants secret or bucket access, and both
print resource names, never credential material. Run them as the project integrator.

```sh
cloud/agent/infra/bootstrap.sh --project PROJECT_ID --environment dev
cloud/agent/infra/bootstrap.sh --project PROJECT_ID --environment dev --verify
cloud/agent/infra/bootstrap.sh --project PROJECT_ID --environment dev --apply --confirm-project PROJECT_ID
```

| Resource | Bootstrap | Later, at deployment |
| --- | --- | --- |
| `melens-ENV-agent` | `melens_query` dataset `READER`; project `aiplatform.user`, `bigquery.jobUser`, `datastore.user` | Cloud Run service identity. `secretAccessor` on the Maps Platform key only once the Routes API tool (`draw_route`) reads it; no current code reads a secret |
| Firestore `(default)` | `australia-southeast2`, Native mode, delete protection; TTL policies on `expiresAtTs` for the `sessions`, `turns` and `attachments` collection groups | Nothing |
| APIs | Firestore, Vertex AI, Cloud Run, BigQuery, BigQuery Storage, Artifact Registry, Cloud Build, Secret Manager, IAM Credentials, IAM | Nothing |

The audit fails on any other project role of the agent identity, on any `melens_ingest`
access (it would bypass the view boundary), on a Firestore database outside
`australia-southeast2`, not in Native mode or without delete protection, and on a
missing TTL policy. It reports the identity's secret access without failing, because the
Maps key grant is expected after deployment. Enabling a TTL policy is a long-running
operation; the apply waits for it, and a `CREATING` state in `--verify` only means that
wait is still in progress.

The script does not manage Firestore security rules; `firebase.sh` does
([Firebase](#firebase)). Only the agent identity and project owners reach the database
through IAM, and the rules deny every client.

The Vertex AI location is not a bootstrap resource. It is recorded in the deployment
configuration as `AGENT_VERTEX_LOCATION` ([../README.md](../README.md#configuration)).

## 2026-10-09 development bootstrap

Applied to `melens-510012` (`dev`) by the integrator, who was granted project owner the
same day. Before it, the project had no Firestore or Vertex AI API, no agent identity and
no Firestore database. The apply enabled the APIs, created
`melens-dev-agent@melens-510012.iam.gserviceaccount.com` with `melens_query` `READER`
and the three project roles, created the `(default)` Firestore database in
`australia-southeast2` (Native mode, delete protection, created `2026-10-09T06:34:04Z`)
and enabled the `expiresAtTs` TTL policy on the `sessions` and `turns` collection groups;
both policies reached `ACTIVE`. `--verify` passes with no `melens_ingest` or secret access
for the identity.

Chat photos (2026-10-09) added the `attachments` collection group to the script's TTL
policies. The integrator reran `--apply --confirm-project melens-510012` the same day; the
policy reached `ACTIVE` and `--verify` passes with all three policies `ACTIVE`.

The same day, the Vertex AI location was probed with the CLI user's token (not the
agent identity) through `generateContent` on `gemini-3.8-flash`:

| Location | Plain prompt | `googleSearch` | `googleMaps` with `retrievalConfig.latLng` |
| --- | --- | --- | --- |
| `global` | 200, `modelVersion: gemini-3.8-flash` | 200 with `webSearchQueries` and `searchEntryPoint` | 200 with `retrievalMetadata` |
| `australia-southeast1` | 404, publisher model not found | 404 | 404 |

The deployment configuration therefore sets `AGENT_VERTEX_LOCATION=global`. A real turn
under `melens-dev-agent` is still required for acceptance; it happens with the first
deployment, because the current user cannot impersonate the identity and no extra role is
granted to obtain a local proof.

The same day, with the CLI user's Application Default Credentials, the Firestore session
store ran against the new database (create, lease, a rejected concurrent lease, a stored
turn with `expiresAtTs`, list, delete; nothing left behind) and the service ran two real
turns in development mode on this machine against Vertex AI `global` and the published
views: a planning search around Flinders Street Station (`search_features`,
`nearby_context`, `get_feature`, `highlight_features`, a `show_card` list of development
monitor records) and a follow-up that used the stored history and Maps grounding. That
run showed ADK reporting two complete responses per streamed tool call, which doubled the
usage records and spent the call budget twice as fast; the loop now counts one call per
request.

## Deployment

`deploy.sh` deploys `melens-dev-agent` in `melens-510012` only. Build the image from
the `cloud/` directory as the container context, so it includes `cloud/shared`, and
record its digest. `cloud/.gcloudignore` uploads only the package files, TypeScript
configuration and sources of `cloud/shared` and `cloud/agent`, plus the public source
registry. `agent/infra` is not uploaded.

```sh
gcloud builds submit cloud --project=melens-510012 \
  --region=australia-southeast2 --timeout=900s \
  --gcs-source-staging-dir=gs://melens-510012_cloudbuild/agent/source \
  --gcs-log-dir=gs://melens-510012_cloudbuild/agent/logs \
  --config=cloud/agent/cloudbuild.yaml \
  --substitutions=_IMAGE=australia-southeast2-docker.pkg.dev/melens-510012/melens-data/agent:TAG
cloud/agent/infra/deploy.sh \
  --image australia-southeast2-docker.pkg.dev/melens-510012/melens-data/agent@sha256:DIGEST \
  --allowed-origin http://localhost:8000 --dynamic-scan-bytes 1000000000 --verify
```

Rerun the same command with `--apply --confirm-project melens-510012` to deploy.

- **Checks.**
  - The script accepts only an immutable `agent@sha256` digest from the development registry, and exact HTTPS or loopback origins in canonical form.
  - It accepts the reviewed dynamic scan ceilings of `cloud/map/infra/deploy.sh`, and 0 or 1 minimum instances.
  - `--verify` runs the `bootstrap.sh` audit and checks that the digest exists.
- **Settings.**
  - The script writes every setting explicitly to a temporary env file: Vertex AI `global`, `gemini-3.8-flash`, 16 model calls, a 270 s turn timeout, 40 s grounding timeout, 120 turns per hour, and the map query ceilings.
  - It never sets `AGENT_DEVELOPMENT_MODE` or `AGENT_DEVELOPMENT_TOKEN`. The service therefore keeps sessions in Firestore and accepts only Firebase ID tokens.
- **Read-back.** After the apply, the script fails if the deployed environment, identity or image differ from the reviewed ones.
- **Scope.** The apply creates or updates only `melens-dev-agent` and its service-level public invocation binding. It grants no project, data or secret permission.

**Runtime bounds**

| Setting | Value | Why |
| --- | --- | --- |
| CPU and memory | 1 CPU, 1 GiB | A photo turn holds up to 4 MB of new photos and 12 MB of history photos |
| Concurrency | 20 | Turns are long SSE streams that mostly wait on Gemini |
| Instances | 0 to 2 | `--min-instances 1` while judging. Rate limits are in memory, so each instance counts on its own |
| Request timeout | 300 s | The 270 s turn timeout ends and stores a turn before Cloud Run cuts the stream. The 330 s turn lease outlives both, so a crashed turn still frees its session |

Cloud Run allows unauthenticated invocation because a browser cannot obtain an IAM token,
and the service rejects every request without a valid Firebase ID token. `/healthz` is
answered by the Google front end with a 404, as for the map service, so check the service
on a `/v1` route.

## 2026-10-09 development deployment

- **Image.** Cloud Build `7aac0ab4-ed2a-450c-b0c3-e7ac7635d897` built
  `agent:dev-20261009-60c982a` from `main` at `60c982a`, digest
  `sha256:891ff17d0006d1ff8b312187c2778027d6009d775d123faaf57ab8612ad1ddf6`.
- **Service.** `https://melens-dev-agent-saepk4k6hq-km.a.run.app`, revision
  `melens-dev-agent-00002-4sb`, identity
  `melens-dev-agent@melens-510012.iam.gserviceaccount.com`, allowed origin
  `http://localhost:8000`, dynamic scan ceiling 1,000,000,000 bytes, 0 to 2 instances.
- **Revisions.** The first revision, `00001`, used a 330 s request timeout. Revision
  `00002` moved to 300 s with a 270 s turn timeout, so that the turn lease outlives the
  request.

Checks on the deployed service:

| Check | Result |
| --- | --- |
| Startup log | `agentServerListening` with `development: false`, `global` and `gemini-3.8-flash` |
| `GET /v1/sessions` without a token | 401 `unauthorized` |
| A malformed bearer token | 401 `unauthorized` |
| A Google ID token from the CLI user (not a Firebase token) | 401 `unauthorized` |
| Preflight from `http://localhost:8000` | 204, with that origin, `Authorization` allowed |
| Preflight from another origin | 400 |

A real turn under `melens-dev-agent` was still required for acceptance; it ran the same day
with an anonymous Firebase user ([Firebase](#firebase)).

## Firebase

`firebase.sh` registers the project with Firebase for the app's sign-in. It plans by
default, `--verify` is a read-only audit and `--apply --confirm-project` creates what is
missing and then audits. It accepts `melens-510012` only, calls the Firebase Management,
Identity Toolkit and Firebase Rules APIs with the CLI user's gcloud token, grants no IAM
role and never prints an API key.

```sh
cloud/agent/infra/firebase.sh --project melens-510012
cloud/agent/infra/firebase.sh --project melens-510012 --verify --app-config app/config/dev.json
cloud/agent/infra/firebase.sh --project melens-510012 --apply --confirm-project melens-510012
```

| Resource | State the audit requires |
| --- | --- |
| APIs | Firebase Management, Identity Toolkit, Secure Token, Firebase Rules, API Keys |
| Firebase | The project is an active Firebase project |
| Auth | Anonymous sign-in on. Email, phone and every identity provider off |
| Apps | One Web app, one Android app and one iOS app, the mobile ones for `com.at2am.melens` |
| Firestore rules | The `cloud.firestore` release serves [`firestore.rules`](firestore.rules), which denies every client read and write |

`--app-config FILE` writes the eight `FIREBASE_*` keys of the three apps into that file
after a passing audit, keeping its other keys. The file must be an ignored JSON file under
`app/config`; the script prints only the key names. Firebase created one API key per
platform, restricted to Firebase APIs but not to an app or a referrer. They are client
configuration, not secrets, and stay out of the repo with the rest of the build
configuration (hard rule 5).

Anyone can create anonymous users, so the per-uid rate limit does not cap total use;
Identity Toolkit limits sign-ups per IP address. App Check would tie tokens to the real
app and is not set up.

### 2026-10-09 setup

Applied to `melens-510012`. The apply enabled the five APIs, added Firebase, initialized
Auth (`identityPlatform:initializeAuth`), turned on anonymous sign-in, registered `Melens
Web`, `Melens Android` and `Melens iOS` and released the deny-all rules. Creating the
third app hit the per-minute provisioning quota once; the script now retries on 429.
`--verify` passes. The authorized domains are `melens-510012.firebaseapp.com` and
`melens-510012.web.app`; anonymous sign-in does not check them, and a Hosting domain or
`localhost` is added only when a popup or redirect sign-in needs it.

Checks the same day:

| Check | Result |
| --- | --- |
| Anonymous sign-up through the Identity Toolkit REST API, then a turn on the deployed `melens-dev-agent` | 200; the token was accepted; the turn ran under the service identity in 107 s (4 model calls, a card) and was stored in Firestore; the session list and the session read it back |
| A second anonymous user reads the first user's session | 404 `notFound` |
| The built Web app in headless Chrome at `http://localhost:8000` against the deployed service | Opening the chat signed up once and listed sessions with the ID token; no console errors |
| A session saved for that user, then a page reload | No new sign-up, the same uid from IndexedDB, and the saved session listed and reopened |

The test sessions and users were deleted afterwards; the project had no Auth users left.
