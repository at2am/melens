# Agent service

The chat agent behind the map: one Node.js 24 Cloud Run service that verifies the Firebase ID token, keeps chat sessions per user, runs the `map_agent` loop on ADK for TypeScript with Gemini through Vertex AI, and streams the [agent protocol](../../system-design/agent-protocol.md) events back to the app. Design: [agent-design.md](../../system-design/agent-design.md); tools: [tools.md](../../system-design/tools.md).

## What the first version covers

| Area | State |
| --- | --- |
| Protocol | Every route of the protocol: session create/list/read/delete, the SSE turn route, the cancel route and stored photos; `status`, `text`, `ui_action`, `card`, `question`, `usage`, `done` and `error` events with `turnId` and `seq`. Every tool call is a step: a `running` status with the tool's status line and an argument summary, then a `done` or `failed` one with rows, duration and error; `ui_action`, `card` and `question` carry the step's `stepId` |
| Loop | `map_agent` as an ADK `LlmAgent` per turn: streaming, at most 16 model calls with the wrap-up note on the second-to-last call and no tools on the last, two invalid calls in a row disable tools, identical read-only calls answered from a memo, `ask_user` ends the turn. Non-parking feature searches also share identical pending reads within the turn, using one default query time. Failed or partial reads are not retained; another turn reads the published views again |
| Interruption | A new turn interrupts the session's running turn: the server sets `activeTurn.cancelRequested`, which the running turn watches (a Firestore listener, so any instance hears it), waits up to 5 s (`SUPERSEDE_WAIT_MS`) for it to stop and store itself, then takes the lease. `POST …/cancel` (the stop button), the client disconnect and the turn deadline stop a turn the same way. Model calls, BigQuery queries and grounding calls in flight are aborted; the stopped turn is stored as `cancelled` with what it produced |
| Photos | Up to 4 per `text` turn, 1 MB each (JPEG, PNG, WebP, HEIC, HEIF), checked against their leading bytes and passed to Gemini as inline data; stored one per document in the session's `attachments` subcollection, written and deleted with their turn; the photos of the last 3 turns go back to the model |
| Token usage | One `usage` event per model call (one request, however many complete responses ADK's streaming aggregator yields for it), copied from the `usageMetadata` Gemini attaches to the trailing response; totals in `done` and stored with the turn; one structured log line per call |
| Tools | `search_features`, `get_feature`, `get_anomaly`, `nearby_context` over `@melens/shared` (the map's query runner, loaders and admission); `show_layers`, `focus_map`, `draw_route`, `highlight_features`, `show_card` (source validation; a plan with `travel_mode` `drive` gets each stop's live parking in a `plan_parking` step), `ask_user` (one question, or up to three about a plan just shown, each naming the card); `maps_grounding` and `search_grounding` as one-shot grounded Gemini calls; the `area_brief`, `analyse_anomaly` and `find_parking` workflows. `get_feature`, `get_anomaly`, `focus_map`, `highlight_features` and `draw_route` resolve a feature id the turn has not searched by one search over the request's viewport, so the Analyse button's bare `featureId` works |
| Workflows | `area_brief` (UC-02) and `analyse_anomaly` (UC-04), `src/workflows/workflows.ts`: parallel fetch (layer features, a Search-grounded answer), one structured Gemini generation with a JSON schema, then code keeps only items whose numbered source reference was fetched in this turn. A map tap (`area`) or Analyse (`analyse`) runs the workflow directly with no chat-model call; a workflow that yields no card falls through to the loop with the explicit prompt. Cards are cached across users (`area_brief` by 0.004° cell, radius and Melbourne date for 3 h; `analyse_anomaly` by feature id and version for 24 h), but never when Search grounding failed while they were written. `find_parking` (UC-15) reads the parking layer around the destination (400 m, then 800 m), sends `show_layers`, `focus_map` on the nearest vacant bay and `highlight_features` before its card, and fills each bay's `parking` card fields; its area-rules lookup is cached by question and date, its card never |
| Routes | `draw_route` calls the Routes API `computeRoutes` with the service identity's OAuth token (no Maps Platform key, no extra IAM role: the call is billed to the identity's own project). Walking takes up to 13 waypoints, transit exactly two. The encoded polyline goes to the app in the `ui_action`; the model only gets distance, duration and legs |
| Sessions | Firestore `users/{uid}/sessions/{id}` with `turns` and `attachments` subcollections, 50 sessions per user, 200 turns per session, 30-day TTL (`expiresAtTs`), one-turn-at-a-time lease that a new turn takes over. The ADK session is rebuilt in memory per turn from the last 20 stored turns |
| User events (UC-09) | The `/v1/events` routes of the protocol's [User events](../../system-design/agent-protocol.md#user-events) section: publish, discover by box and window, mine, read, edit, cancel, remove, join, leave, members and remove member. Firestore `userEvents/{id}` with an `attendees` subcollection, 90-day TTL after the event; every rule (limits, owner checks, anonymous attendance, join conflicts with their `messageKey` reason, 60 writes per uid per hour) lives in `src/events/service.ts` and is tested against the in-memory store. The `user_events` connector in `cloud/data` exports the events to BigQuery |
| Feed subscriptions (UC-14) | `GET` and `PUT /v1/feeds` of the protocol's [Feed subscriptions](../../system-design/agent-protocol.md#feed-subscriptions) section: the caller's whole list, null until first saved, replaced on every save. Firestore `userFeeds/{uid}`; the shape, the 20-feed and 120-saves-per-hour limits live in `src/feeds/` and are tested against the in-memory store |
| Saved plans (UC-03) | `GET`, `POST /v1/plans`, `PATCH` and `DELETE /v1/plans/{id}` and `POST /v1/plans/{id}/stops/{index}/refresh` of the protocol's [Saved plans](../../system-design/agent-protocol.md#saved-plans) section: a copy of a stored plan card with its route, per uid in Firestore `userPlans/{uid}/plans`; a save may replace the plan its card revises, in the same batch; an edit renames the plan or keeps some stops in a new order and computes the route again through the Routes API; a `refine` turn with `planId` changes a saved plan's card from any session; a stop refresh reads that stop's parking sensors again (`refreshStopParking` in `src/workflows/workflows.ts`, no model call) and keeps the reading with the plan. Rules and limits live in `src/plans/` |
| Cache | Grounded answers (by tool, normalised question, place cell and Melbourne date; 6 h Search, 12 h Maps) and workflow cards share Firestore `agentCache/{sha256(key)}` (`key`, `value` as JSON text, `expiresAtTs` under a TTL policy that `infra/bootstrap.sh` creates); any cache failure is a miss. Development mode keeps the cache in memory |
| Not yet | `heritage_lookup` (the Victorian Heritage Database's `/v1/places` endpoint exists, but its spatial filter is not documented; UC-08 answers through Search grounding meanwhile), `pedestrian_pattern` (the pedestrian history table is empty until its ingestion runs; the anomaly layer is served from the replay of a historical day until the live detector exists, see UC-04), Firestore-backed rate-limit counters (in memory per instance), result compaction |

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
| `AGENT_ROUTES_QUOTA_PROJECT` | Unset on Cloud Run. Local runs with user credentials need it (`npm run dev` sets it to the project): the Routes API refuses user ADC without a quota project, and a service identity needs none. Not yet verified on the deployed service |
| `AGENT_TURNS_PER_HOUR` | `120` per uid, in memory per instance |
| `AGENT_CONTEXT_CACHE` | `true`. Serves the chat instruction and tool declarations from a Gemini explicit context cache, renewed hourly; a creation that fails (quota, too few tokens) falls back to sending them in full for 10 minutes. `false` turns it off |
| `MAP_*` | The shared query configuration ([cloud/map/README.md](../map/README.md#query-configuration)); `MAP_PROJECT_ID` defaults to the agent project |
| `PORT` | `8080` |

## Code layout

| Module | Responsibility |
| --- | --- |
| `src/server.ts` | HTTP transport: routes, CORS with `Authorization`, Firebase token check, rate limit, turn lease and its takeover by a newer turn, SSE stream, cancellation on disconnect, stop request, newer turn or timeout |
| `src/protocol/` | Zod schemas of requests, events, cards, usage and stored turns; the SSE writer; photo decoding (`attachments.ts`) |
| `src/sessions/` | The `SessionStore` interface, the in-memory store and the Firestore store |
| `src/events/` | User events (UC-09): the wire schemas and limits (`schemas.ts`), the `UserEventStore` interface with its in-memory and Firestore stores, and `UserEventService`, which holds every rule the routes apply |
| `src/feeds/` | Feed subscriptions (UC-14): the wire schemas and limits (`schemas.ts`), the `FeedStore` interface with its in-memory and Firestore stores, and `FeedService` |
| `src/plans/` | Saved plans (UC-03): the wire schemas and limits (`schemas.ts`), the `PlanStore` interface with its in-memory and Firestore stores, and `PlanService`, which copies cards from stored turns, replaces and edits plans, and refreshes a stop's parking |
| `src/auth/verifier.ts` | Firebase ID token verification and the static development verifier |
| `src/agent/map-agent.ts` | The turn runner: the ADK agent, its callbacks (budget, usage, `ask_user` stop), history seeding and event translation |
| `src/agent/prompts.ts` | The instruction, the playbooks, the map context block and the history format |
| `src/agent/usage.ts`, `grounding.ts`, `structured.ts`, `time.ts` | Token ledger; one-shot grounded calls and one-shot JSON-schema generations through the Vertex AI SDK; Melbourne time |
| `src/workflows/workflows.ts` | The `area_brief`, `analyse_anomaly` and `find_parking` workflows |
| `src/routes/routes-client.ts` | The Routes API client behind `draw_route` |
| `src/cache.ts` | The shared cache: in-memory and Firestore |
| `scripts/eval.mts` | Runs the seed evaluation queries through the real agent and prints the report (`node scripts/eval.mts [--only N] [--out file]`) |
| `src/tools/define.ts`, `catalog.ts`, `schema.ts` | The per-turn registry (sources, features, memo, trace), the tool specs and the Zod-to-Gemini declaration |
| `src/features/` | The feature reader over `@melens/shared`, the per-turn search memo, and the compact feature mapping |
| `src/main.ts` | Production entry point |

The feature reader answers current planning, disruption, event, news, parking and anomaly searches from the same in-memory layer copy as the map service (`current-layer-cache.ts`, [map-serving-stateless.md](../../system-design/map-serving-stateless.md) phase 2), with the source registry cached for 30 seconds. A copy is served only when its state table reflects every source's latest published batch, and it reloads on a new publication or after two minutes, so a withdrawal reaches the agent as it reaches the map. Until 2026-10-17 it read the authoritative current view per search, which rebuilt "current" from the whole history; that read outgrew the 1 GB scan ceiling, and every such search came back `unavailable`. Pedestrian, boundary and historical searches stay live BigQuery reads. The server selects this policy; tool input cannot change it. Matching complete searches still share one read within a turn.

## Runtime identity and deployment

[`infra/bootstrap.sh`](infra/README.md) (plan by default, `--verify` for a read-only audit, `--apply --confirm-project` to create) prepares the service identity `melens-ENV-agent` with `melens_query` READER and project `bigquery.jobUser` (data tools), `aiplatform.user` (Gemini and grounding through Vertex AI) and `datastore.user` (the agent Firestore database), and the Firestore database `(default)` in `australia-southeast2` with TTL policies on `expiresAtTs` for the `sessions`, `turns`, `attachments` and `userEvents` collection groups (`userEvents` added 2026-10-10 for UC-09; rerun the bootstrap to create it). `secretAccessor` on the Maps Platform key only is granted once the Routes API tool reads it; no current code reads a secret ([architecture.md](../../system-design/architecture.md#deployment-constraints)). Cloud Run allows unauthenticated invocation at the platform level because a browser cannot obtain an IAM token; the service rejects every request without a valid Firebase ID token before any model or tool call. Request timeout 300 seconds with a 270-second turn timeout; one instance stays warm by default (`--min-instances 1`) to avoid cold starts.

Build from the `cloud/` directory as the container context so the image includes `cloud/shared`:

```sh
gcloud builds submit cloud --project=PROJECT_ID --region=australia-southeast2 \
  --config=cloud/agent/cloudbuild.yaml \
  --substitutions=_IMAGE=australia-southeast2-docker.pkg.dev/PROJECT_ID/melens-data/agent:TAG
```

[`infra/deploy.sh`](infra/README.md#deployment) deploys the image (plan by default, immutable digest, identity audit, following `cloud/map/infra/deploy.sh`); the development service runs at `https://melens-dev-agent-saepk4k6hq-km.a.run.app` since 2026-10-09. [`infra/firebase.sh`](infra/README.md#firebase) registered the project with Firebase on 2026-10-09: anonymous sign-in only, the Web, Android and iOS apps, and Firestore rules that deny every client. [infra/README.md](infra/README.md) records the 2026-10-09 development bootstrap, the Vertex AI location probe, the first deployment and the Firebase setup.
