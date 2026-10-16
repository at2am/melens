# Map query service

This Node.js 24 service returns bounded JSON/GeoJSON from admitted published BigQuery views. `src/server.ts` implements the catalog, viewport, detail, unlocated and aggregate-member routes. The separate credential-free `npm run dev` process remains a health-only toolchain smoke server.

## Local commands

Use Node.js `>=24 <25`. `cloud/` is an npm workspace: the shared query library (`cloud/shared`, [README](../shared/README.md)) and this service install from one `cloud/package-lock.json`. Dependencies match the ingestion package: TypeScript 5.9.3, Node types 24.19.0, BigQuery 9.1.0 and Zod 4.6.5.

```sh
cd cloud
node --version
npm ci
npm run typecheck --workspace map
npm run build --workspace map
npm run test --workspace map
npm run dev --workspace map
```

`build` and `typecheck` compile `cloud/shared` first (`prebuild`), because the compiler resolves `@melens/shared/…` to that package's `dist`. `dev` uses Node 24's native TypeScript support and watches the health-only entrypoint; it does not rebuild `dist`. The compiler writes source and test output into `dist`; `test` builds once and runs compiled tests with Node's test runner. Parallel workers coordinate build/test runs because they share that directory.

The development server binds to `127.0.0.1:8081`, matching the app's local map URL. The agent service keeps port 8080. Set `PORT` to choose another port. `PORT=0` requests an ephemeral port, which the structured startup log reports. It accepts no map data, loads no query configuration and requires no Google credentials. Stop it with Ctrl-C.

```sh
curl http://127.0.0.1:8081/healthz
```

The result is a development-process health signal. It does not establish BigQuery access, source readiness, map API availability or deployment acceptance. This entrypoint is for local development, not Cloud Run deployment.

## Implemented map routes

[Map contract v1](../../specs/002-map-data-presentation/contracts/map-api.md) defines the wire boundary. The service returns UTF-8 JSON with GeoJSON geometry using WGS84 `[longitude, latitude]`. The live `dist/src/server.js` entrypoint implements these routes; the health-only `dev` entrypoint does not:

| Route | Responsibility |
| --- | --- |
| `GET /v1/map/layers` | Registered layers and public coverage/freshness |
| `POST /v1/map/viewport` | Bounded viewport/time queries |
| `GET /v1/map/items/{id}` | Item details, recomputed from the `snapshotId` read token |
| `GET /v1/map/unlocated` | Bounded, explicitly unlocated lists |
| `GET /v1/map/aggregates/{id}/members` | Aggregate members, recomputed from the `snapshotId` read token |

Only an explicitly selected development sample repository may return sample data. A live query failure never switches to fixtures. Public field selection, source admission and retention remain required even when a source can be queried privately.

## Code layout

The contract, the query families, the query runner, the layer adapters, source coverage and the layer loaders live in `@melens/shared` ([cloud/shared/README.md](../shared/README.md)), because the agent service reads the same views under the same rules. This service keeps what only a map needs:

| Module | Responsibility |
| --- | --- |
| `src/server.ts` | HTTP transport: route matching, CORS preflight, bounded bodies, concurrency, timeouts, error envelopes |
| `src/map-service.ts` | Composition root that wires the shared query modules and the services below together |
| `src/services/viewport.ts`, `details.ts`, `unlocated.ts`, `page-budget.ts` | Stateless page services and the byte-budget page fitting they share |
| `src/services/read-token.ts` | `snapshotId` read tokens that carry the request context, and offset cursors bound to them |
| `src/services/aggregation.ts`, `layer-catalog.ts` | Zoom-band grouping; layer registrations and the catalog |

## Query configuration

T007 implemented `src/config.ts` and the fixed query runner. The validated settings are below; the parser is authoritative. None is needed for the health-only server.

| Setting | Default / requirement |
| --- | --- |
| `MAP_PROJECT_ID` | Required target GCP project |
| `MAP_BQ_LOCATION` | `australia-southeast2` |
| `MAP_QUERY_DATASET` | Only `melens_query` |
| `MAP_DYNAMIC_SCAN_BYTES` | `100000000` bytes |
| `MAP_HISTORICAL_SCAN_BYTES` | `500000000` bytes |
| `MAP_QUERY_TIMEOUT_MS` | `10000` |
| `MAP_DRY_RUN_TIMEOUT_MS` | `5000` |
| `MAP_DRY_RUN_PREFLIGHT` | `false`: each job's `maximumBytesBilled` bounds its scan; `true` adds a dry-run estimate before every query |
| `MAP_CANCEL_TIMEOUT_MS` | `1000` |
| `MAP_MAX_PAGE_ITEMS` | At most `1000` |
| `MAP_MAX_RESPONSE_BYTES` | At most `2097152` uncompressed bytes |
| `MAP_RESPONSE_ENVELOPE_RESERVE_BYTES` | `65536` bytes |

The runner allows fixed parameterized queries over approved views and implements dry runs, billed-byte ceilings, timeouts, cancellation, row lookahead and result-byte limits. Caller SQL, arbitrary table names, raw/staging datasets, provider URLs and client credentials stay outside it. Public-field adapters, coverage evidence, stateless read tokens, final envelope budgeting and HTTP integration are implemented. T025 applies default zoom grouping only after validating the global 1,000-original-row allocation; each aggregate retains exact original member ids and versions.

The 2026-10-01 real BigQuery dry runs validated all thirteen current/historical query combinations. Current planning/disruption/event/news each estimated 383847461 bytes, exceeding the default 100000000-byte dynamic ceiling. The reviewed development preview configured 400000000 bytes, and 1000000000 bytes from 2026-10-09; library defaults were not relaxed. Since 2026-10-15 current geo reads use `v_geo_records_current_served`, a copy refreshed per publication (see `cloud/data/docs/operations.md`).

**Stateless serving (since 2026-10-16, [design](../../system-design/map-serving-stateless.md)).** The service stores nothing per request, so it can run on several instances:

- Current planning, disruption, event, news, parking and anomaly layers are held in memory per publication (`@melens/shared/query/current-layer-cache`). Every request filters them by bbox and time in memory. While a layer reloads, requests keep reading the previous rows for up to five minutes, still filtered by the current registry's public sources, so no request waits on a reload. Instances load every cached layer at start.
- The source registry is cached for 30 seconds; an expired read is still served for 90 seconds while one background read replaces it.
- There is no public-rights recheck: the published views already filter by source licence, access and record rights, and a withdrawn record leaves the map within one layer reload (about two minutes).
- A `snapshotId` is a read token that carries the request's normalized context. Details, aggregate members and continuations recompute what they need from it; cursors are offsets bound to the token. Aggregate ids are grid-cell ids (`aggregate.<layer>.<band>.<x>.<y>.<key>`), so a cell keeps its id across reloads.
- Pedestrian, boundary, unlocated lists and historical mode still run a live BigQuery query per request.

Measured on 2026-10-16 against the live views (in process, one laptop core): warm viewport reads p50 5.5 ms, p99 37 ms; detail p50 4.2 ms; members p50 3.2 ms; no BigQuery job across 550 warm reads; a burst of 128 simultaneous viewports finished in 0.66 s; resident memory about 460 MB. The previous design measured p50 1.3 s, p90 9.8 s in production. `node map/scripts/profile-requests.mjs <layers> <bbox> <zoom>` (after `npm run build --workspace map`) times each BigQuery job of a live request. The layers of one request load together. See [joint validation](../../specs/002-map-data-presentation/validation.md) for estimates and acceptance limits.

## Read-only identity requirements

The Google Cloud client library uses Application Default Credentials. A successful `gcloud` CLI login does not establish Node client access. Use approved local ADC or the deployed dedicated runtime identity. Current local-user query-identity impersonation is denied; no TokenCreator role was added to bypass it. Do not download service-account JSON keys or commit credentials. The local commands above and injected-adapter unit tests require no cloud credentials.

Cloud Run must use a dedicated query identity, such as the existing `melens-ENV-query@PROJECT_ID.iam.gserviceaccount.com`, with:

- Project-level `roles/bigquery.jobUser` to create query jobs in the selected project.
- Read access restricted to approved, authorized `melens_query` views. Existing dataset-level READER access is suitable only while that dataset contains solely the approved public query views; review each added view.
- No access to `melens_ingest`, staging or raw data, ingestion writes, source secrets or unrelated buckets.

The authorized views carry their reviewed access to ingestion tables. The query identity does not need direct ingestion-table permission. Fixed query registration remains necessary alongside IAM. The integrator audits the existing identity and authorized views. The reviewed development deploy script changes only the bounded map service and its service-level invocation binding, without project/data/secret IAM grants.

## Run the live entrypoint

`npm run dev` in `cloud/` builds and runs this service on 8081 together with the agent service on 8080, with the reviewed development settings ([agent README](../agent/README.md#local-commands)). By hand: after building, run `node dist/src/server.js` with validated `MAP_PROJECT_ID`,
`MAP_ALLOWED_ORIGINS` (comma-separated exact origins) and
`MAP_PUBLIC_SOURCES_FILE` (reviewed public URL/attribution registry).
`PORT` defaults to8080; set8081 for the app's local map-service URL. Cloud Run supplies8080. Startup binds
`0.0.0.0`; `/healthz` performs no BigQuery reads. Missing public references remain
unavailable. Never send BigQuery credentials or SQL to Flutter.

The [development deployment workflow](infra/README.md) records the dedicated
query identity, immutable image, scale-to-zero one-instance limits, CORS origin
and explicit measured scan ceiling. Keep real app configuration in ignored
local files; keys use the configured Secret Manager delivery path.

Snapshots and cursors expire after five minutes and are process-local. Detail,
continuation and member reads recheck publication plus exact original record
access; source or record withdrawal returns `notAvailable`. Boundary and
pedestrian rows require the repaired views' latest published record permission
evidence. Older deployed views without that evidence remain
unavailable. The repaired SQL checks exact and latest source-record rights plus
current source admission, and exposes native observation/location revisions. See the
[source-readiness handoff](../../specs/002-map-data-presentation/p0-source-readiness.md).
Planning is the eligible positive preview path. Anomaly requires independently
verified external producer output; this package introduces no detector.

The app's explicit sample mode is visibly labelled and does not replace live
failures. The shared news adapter serves permitted metadata through viewport,
scoped unlocated and detail reads; a missing geometry stays unlocated. Original
article and council project links are preserved, as are Ticketmaster event links.
GDELT includes a separate clickable dataset attribution reference. UC-06 top-three
ranking and map movement behavior remain separate acceptance work. Area comparison,
H3 and 3D are later stories. Full source/runtime
and rendered browser acceptance remain recorded in
[validation](../../specs/002-map-data-presentation/validation.md).
