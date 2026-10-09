# Agent service

The chat agent behind the map: one Node.js 24 Cloud Run service that verifies the Firebase ID token, keeps chat sessions per user, runs the `map_agent` loop on ADK for TypeScript with Gemini through Vertex AI, and streams the [agent protocol](../../system-design/agent-protocol.md) events back to the app. Design: [agent-design.md](../../system-design/agent-design.md); tools: [tools.md](../../system-design/tools.md).

## What the first version covers

| Area | State |
| --- | --- |
| Protocol | Every route of the protocol: session create/list/read/delete, the SSE turn route, the cancel route and stored photos; `status`, `text`, `ui_action`, `card`, `question`, `usage`, `done` and `error` events with `turnId` and `seq`. Every tool call is a step: a `running` status with the tool's status line and an argument summary, then a `done` or `failed` one with rows, duration and error; `ui_action`, `card` and `question` carry the step's `stepId` |
| Loop | `map_agent` as an ADK `LlmAgent` per turn: streaming, at most 16 model calls with the wrap-up note on the second-to-last call and no tools on the last, two invalid calls in a row disable tools, identical read-only calls answered from a memo, `ask_user` ends the turn |
| Interruption | A new turn interrupts the session's running turn: the server sets `activeTurn.cancelRequested`, which the running turn watches (a Firestore listener, so any instance hears it), waits up to 5 s (`SUPERSEDE_WAIT_MS`) for it to stop and store itself, then takes the lease. `POST …/cancel` (the stop button), the client disconnect and the turn deadline stop a turn the same way. Model calls, BigQuery queries and grounding calls in flight are aborted; the stopped turn is stored as `cancelled` with what it produced |
| Photos | Up to 4 per `text` turn, 1 MB each (JPEG, PNG, WebP, HEIC, HEIF), checked against their leading bytes and passed to Gemini as inline data; stored one per document in the session's `attachments` subcollection, written and deleted with their turn; the photos of the last 3 turns go back to the model |
| Token usage | One `usage` event per model call (one request, however many complete responses ADK's streaming aggregator yields for it), copied from the `usageMetadata` Gemini attaches to the trailing response; totals in `done` and stored with the turn; one structured log line per call |
| Tools | `search_features`, `get_feature`, `nearby_context` over `@melens/shared` (the map's query runner, loaders and admission); `show_layers`, `focus_map`, `highlight_features`, `show_card` (source validation), `ask_user`; `maps_grounding` and `search_grounding` as one-shot grounded Gemini calls |
| Sessions | Firestore `users/{uid}/sessions/{id}` with `turns` and `attachments` subcollections, 50 sessions per user, 200 turns per session, 30-day TTL (`expiresAtTs`), one-turn-at-a-time lease that a new turn takes over. The ADK session is rebuilt in memory per turn from the last 20 stored turns |
| Not yet | `heritage_lookup`, `get_anomaly`, `pedestrian_pattern`, `draw_route`, the `area_brief` and `analyse_anomaly` workflows (an `area` or `analyse` input currently runs through the loop with an explicit prompt), Firestore-backed rate-limit counters and grounding cache (both are in-memory per instance), result compaction, `get_feature` by id for features not searched in the same turn |

## Local commands

The package is an npm workspace member of `cloud/`; see [cloud/shared/README.md](../shared/README.md).

```sh
cd cloud
npm ci
npm run test --workspace agent
```

Tests inject a scripted `BaseLlm`, a fake feature reader and an in-memory session store, so they need no Google credentials. Running the service locally against Vertex AI needs Application Default Credentials with access to the project (`gcloud auth application-default login`) and the lowercase project id; without credentials every turn fails with a retryable `error` event and a `modelLoopFailed` log line naming the cause.

The whole local stack, built and started with the settings below, is one command from `cloud/` (`cloud/scripts/dev.mts`): the map service on 8081 and this service on 8080, both allowing the app origin `http://localhost:8000`. `MAP_PORT` and `AGENT_PORT` move a service, `--no-build` reuses the last build, and any service variable set in the environment overrides the script's default. It refuses to start while a port is taken and stops both services on Ctrl-C.

```sh
cd cloud
npm run dev
```

To run this service by hand instead:

```sh
cd cloud/agent
AGENT_PROJECT_ID=melens-510012 AGENT_VERTEX_LOCATION=global AGENT_ALLOWED_ORIGINS=http://localhost:8000 \
AGENT_PUBLIC_SOURCES_FILE=../map/infra/dev-public-sources.json MAP_DYNAMIC_SCAN_BYTES=1000000000 \
AGENT_DEVELOPMENT_MODE=true AGENT_DEVELOPMENT_TOKEN=dev node dist/src/main.js
```

`MAP_DYNAMIC_SCAN_BYTES` must match the reviewed map ceiling ([cloud/map/infra/README.md](../map/infra/README.md)): every current-mode geo query scans the whole `v_geo_records_current` view (about 630 MB on 2026-10-09), so the library default of 100 MB makes `search_features` and `nearby_context` answer `unavailable` for every layer.

Development mode keeps sessions in memory and accepts `Authorization: Bearer dev` for the uid `dev-user`. Cloud Run never runs in development mode: it verifies Firebase ID tokens and stores sessions in Firestore.

## Configuration

| Variable | Default / requirement |
| --- | --- |
| `AGENT_PROJECT_ID` | Required (falls back to `MAP_PROJECT_ID`) |
| `AGENT_VERTEX_LOCATION` | Required. `global` is the only location that served `gemini-3.8-flash`, Search grounding and Maps grounding for the project on 2026-10-09; `australia-southeast1` returned 404 ([infra/README.md](infra/README.md)) |
| `AGENT_MODEL` | `gemini-3.8-flash` |
| `AGENT_FIRESTORE_DATABASE` | `(default)` |
| `AGENT_ALLOWED_ORIGINS` | Comma-separated exact Web origins; the service also allows the `Authorization` header |
| `AGENT_PUBLIC_SOURCES_FILE` | The reviewed public source registry (the map's `infra/dev-public-sources.json`); falls back to `MAP_PUBLIC_SOURCES_FILE` |
| `AGENT_MAX_MODEL_CALLS` | `16` |
| `AGENT_TURN_TIMEOUT_MS` | `300000` |
| `AGENT_GROUNDING_TIMEOUT_MS` | `40000`. A `maps_grounding` or `search_grounding` call that takes longer returns `upstream_unavailable` to the model, which answers from the map data and says what is missing. Measured on 2026-10-09: Maps grounding took 48 to 110 s per call, Search grounding about 10 s |
| `AGENT_TURNS_PER_HOUR` | `120` per uid, in memory per instance |
| `MAP_*` | The shared query configuration ([cloud/map/README.md](../map/README.md#query-configuration)); `MAP_PROJECT_ID` defaults to the agent project |
| `PORT` | `8080` |

## Code layout

| Module | Responsibility |
| --- | --- |
| `src/server.ts` | HTTP transport: routes, CORS with `Authorization`, Firebase token check, rate limit, turn lease and its takeover by a newer turn, SSE stream, cancellation on disconnect, stop request, newer turn or timeout |
| `src/protocol/` | Zod schemas of requests, events, cards, usage and stored turns; the SSE writer; photo decoding (`attachments.ts`) |
| `src/sessions/` | The `SessionStore` interface, the in-memory store and the Firestore store |
| `src/auth/verifier.ts` | Firebase ID token verification and the static development verifier |
| `src/agent/map-agent.ts` | The turn runner: the ADK agent, its callbacks (budget, usage, `ask_user` stop), history seeding and event translation |
| `src/agent/prompts.ts` | The instruction, the playbooks, the map context block and the history format |
| `src/agent/usage.ts`, `grounding.ts`, `time.ts` | Token ledger; one-shot grounded calls through the Vertex AI SDK; Melbourne time |
| `src/tools/define.ts`, `catalog.ts`, `schema.ts` | The per-turn registry (sources, features, memo, trace), the tool specs and the Zod-to-Gemini declaration |
| `src/features/` | The feature reader over `@melens/shared` and the compact feature mapping |
| `src/main.ts` | Production entry point |

## Runtime identity and deployment

[`infra/bootstrap.sh`](infra/README.md) (plan by default, `--verify` for a read-only audit, `--apply --confirm-project` to create) prepares the service identity `melens-ENV-agent` with `melens_query` READER and project `bigquery.jobUser` (data tools), `aiplatform.user` (Gemini and grounding through Vertex AI) and `datastore.user` (the agent Firestore database), and the Firestore database `(default)` in `australia-southeast2` with TTL policies on `expiresAtTs` for the `sessions`, `turns` and `attachments` collection groups. `secretAccessor` on the Maps Platform key only is granted once the Routes API tool reads it; no current code reads a secret ([architecture.md](../../system-design/architecture.md#deployment-constraints)). Cloud Run allows unauthenticated invocation at the platform level because a browser cannot obtain an IAM token; the service rejects every request without a valid Firebase ID token before any model or tool call. Request timeout 300 seconds with a 270-second turn timeout; set min-instances=1 while judging.

Build from the `cloud/` directory as the container context so the image includes `cloud/shared`:

```sh
gcloud builds submit cloud --project=PROJECT_ID --region=australia-southeast2 \
  --config=cloud/agent/cloudbuild.yaml \
  --substitutions=_IMAGE=australia-southeast2-docker.pkg.dev/PROJECT_ID/melens-data/agent:TAG
```

[`infra/deploy.sh`](infra/README.md#deployment) deploys the image (plan by default, immutable digest, identity audit, following `cloud/map/infra/deploy.sh`); the development service runs at `https://melens-dev-agent-saepk4k6hq-km.a.run.app` since 2026-10-09. The project is not registered with Firebase yet, so no client SDK reaches Firestore and no Firebase ID token exists; registering it and enabling Anonymous Auth, with client security rules that deny all access, is the app's Firebase setup. [infra/README.md](infra/README.md) records the 2026-10-09 development bootstrap, the Vertex AI location probe and the first deployment.
