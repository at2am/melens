# Map implementation validation

**Date**: 2026-10-01 | **Scope**: T001–T026 | **Result**: G0 and P0 engineering validated; bounded live preview deployed, source/performance acceptance remains open.

The preparation wave delivered T001–T009. The P0 wave assigned each of T010–T026 to a dedicated subagent, with up to eight concurrent workers and a root integrator. Shared source ownership, localization, generation and deployment were serialized. No commit or source admission was performed. The reviewer-owned delivery checklist retains its 32 unchecked items.

## Preparation evidence (before the P0 wave)

| Task | Owner | Accepted result | Evidence |
| --- | --- | --- | --- |
| T001 | prep_t001_contract | Frozen JSON/GeoJSON v1, nine item/layer kinds, fourteen fixtures, transport documentation and microsecond agreement | [Handoff](task-handoffs/t001.md) |
| T002 | prep_t002_runtime | Exact Flutter 3.47.5 / Dart 3.13.4, FVM 4.3.1; recorded desktop and narrow Chrome environments | [Handoff](task-handoffs/t002.md), [environment](quickstart.md) |
| T003 | prep_t003_maps | Locked Maps Flutter/Web dependencies, build configuration, explicit development samples, tested Web SDK loader | [Handoff](task-handoffs/t003.md) |
| T004 | prep_t004_service | Node 24 / strict TypeScript package, lockfile, scripts and local health-only development server | [Handoff](task-handoffs/t004.md) |
| T005 | prep_t005_models | Typed DTOs, generated serializers/unions and explicit sample repository preserving missing/zero/location/time semantics | [Handoff](task-handoffs/t005.md), 38 targeted tests |
| T006 | prep_t006_validation | Bounded v1 validation and opaque snapshot/cursor binding through injected resolvers | [Handoff](task-handoffs/t006.md), 14 targeted tests |
| T007 | prep_t007_queries | Fixed read-only queries, parameter binding, dry-run/scan/time/row/byte limits and bounded cancellation | [Handoff](task-handoffs/t007.md), 22 config/query tests |
| T008 | prep_t008_http | Five repository operations, validated HTTP transport, safe errors, cancellation and timeout without sample fallback | [Handoff](task-handoffs/t008.md), 26 targeted tests |
| T009 | prep_t009_status | Annotated providers, evidence states, retained results, Melbourne time, provenance and English localization | [Handoff](task-handoffs/t009.md), 25 targeted tests |

The shared boundary accepts strict UTC instants with required seconds and optional one to six fractional digits. Both runtimes preserve microseconds and reject excess precision. Query windows are half-open and at most 31 days; statistical date-only periods remain independent. Seven viewport fixtures cover available, noMatching, notCovered, sourceUnavailable, unknown, historical and partial results. Additional fixtures exercise all nine variants, catalog, detail, lists and errors.

## Preparation joint checks

| Check | Exact command / mechanism | Result |
| --- | --- | --- |
| Shared generation | `fvm dart run build_runner build` | Passed; Freezed/JSON, provider and config generated files included |
| English localization | `fvm flutter gen-l10n` | Passed; generated localization files included |
| Whole app analysis | `fvm flutter analyze` | Passed, no issues |
| Whole app tests | `fvm flutter test --reporter expanded` | 111 passed, no failures |
| Web compilation | `fvm flutter build web --dart-define-from-file=config/example.json` | Passed, build/web produced; Wasm dry run also succeeded |
| Backend typecheck | Node 24.18.0, `npm run typecheck` in cloud/map | Passed |
| Backend build/tests | Node 24.18.0, `npm test` in cloud/map | 36 passed, no failures or skips; includes TypeScript build |
| Delivery integrity | Scoped `git diff --check`; task/checklist/handoff/generated-file audit | Passed; exactly nine tasks completed, 46 later tasks and 32 reviewer checklist items untouched |
| Maps loader | T003 VM/Chrome tests plus deterministic HTML-loader checks | Passed; no real Maps key used |
| Local service | T004 health HTTP smoke | Passed; loopback port 8081; mapApiImplemented=false; future map routes return 404 |
| Real published SQL | Production BigQuery adapter `dryRun(prepareViewQuery(...))`, project melens-510012, australia-southeast2 | All 13 combinations valid; metadata/parameters verified; no data query executed |

The initial shared generation revealed Freezed union serialization inference issues; explicit generation options resolved them. Calendar, microsecond ordering, snapshot identity, requested vintage and current unknown-time semantics were aligned across the server/client before final tests. The combined suite exercises meaningful contract/error/cancellation/state behavior; unit success does not certify later rendering, pagination stores or production source coverage.

## Real dry-run estimates and the live-query gate

| Fixed query | Mode | Estimated bytes processed | Default ceiling outcome |
| --- | --- | ---: | --- |
| planning, disruption, event, news (each) | current | 383847461 | Exceeds 100000000; runner rejects before execution |
| pedestrian | current | 0 | Within ceiling |
| boundary | current | 147094939 | Within historical/static 500000000 ceiling |
| rent, census (each) | current | 0 | Within historical/static ceiling |
| sourceCoverage | current | 8378 | Within ceiling |
| planning, disruption, event, news (each) | historical | 0 | Within historical ceiling |

These are optimizer estimates observed at validation time, not returned records, coverage proofs or source publication counts. No scan default was increased. T011–T014 must resolve current geo-query cost by inspecting the expanded view/query path or recording an explicitly configured, measured deployment budget before a live preview. Source/view changes by the independently running data team can change these estimates.

## Preparation boundaries and P0 follow-up

- T015–T017 have since replaced the map placeholder with the responsive surface, topic/layer controls, typed details, real visible-region requests, historical controls and a keyboard-accessible list.
- The user-provided demo Maps Web key now loads the awaited SDK and the documented legacy-plugin MaterialUiCompatibilityBridge. Local configuration and compiled key-bearing output are ignored; committed example configuration keeps the key empty.
- T011–T014 have since implemented the live server entrypoint and five routes, public-field adapters, coverage evidence and bounded immutable snapshot pagination. The separate health-only development entrypoint remains available without cloud credentials.
- Indicator query execution requires a trusted selection/period/property registry; an absent registry returns unavailable. Unmatched or suppressed values are never invented. Census/rent story integration remains T033 onward.
- The HTTP adapter bounds request JSON to 256 KiB. Deployment/proxy limits for encoded GET URLs must be recorded before enabling large unlocated/member requests. Final multi-layer responses must allocate and verify the 2 MiB envelope budget.
- Real pedestrian/roads/transit/events, anomalies and later news/rent-map prerequisites stay with their external owners. Existing data-team changes in cloud/data and feature001 were preserved and were not included in this map-package validation.
- Desktop/narrow Web environment preparation and compilation do not certify measured map performance, native support, H3 or 3D. Android/Xcode/CocoaPods preparation and later device acceptance remain separate.
- G1 preview, G2 live map and G3 full-project P0 acceptance remain open. The custom delivery checklist retains its 32 unchecked reviewer-owned items.

## P0 joint checks

All source handoffs were frozen before final shared generation and checks.

| Check | Result |
| --- | --- |
| Pinned Flutter 3.47.5 / Dart 3.13.4 `build_runner build` | Passed; annotated controller/renderer hashes and generated outputs updated |
| English `gen-l10n` | Passed; queued task strings and generated localizations included |
| Whole-app `flutter analyze` | Passed, no issues |
| Whole-app `flutter test --reporter expanded` | **296 passed**, no failures |
| Node 24.18.0 whole map package typecheck/build/test | **163 passed**, no failures or skips |
| Scoped `git diff --check` | Passed |
| Web compilation | Passed with ignored live configuration; Wasm dry run also succeeded |
| Deployed API / Google Maps | Real catalog, planning viewport/member/detail and denied boundary response verified; Google Maps tiles/attribution/controls rendered in the in-app browser |

The shared suite tests the actual production composition, including aggregation,
exact original member/detail versions, 1,000 original-row and uncompressed 2 MiB
limits, immutable pagination, independent rights revalidation and retraction.
Flutter checks include desktop/narrow details, short-surface scrolling, retained
camera/selection, newest requests, camera-motion cancellation, historical filter
exclusion, manual expiry refresh, unknown/zero/clock semantics and source links.
T026 consumes exact production-emitted synthetic outputs in both languages;
its fixture checks do not certify live browser latency.

The initial full backend run found stale flat-output and pedestrian-rights test
fixtures after final integration. T020 explicitly opted out of grouping for its
flat semantics cases and supplied an independent synthetic rights ledger. Added
regressions verify default denied boundary/pedestrian paths and unchanged-source
watermark rights withdrawal. The final full suite passed without weakening the
production gate. The app's original router smoke tests now assert the actual
map screen and visibly labelled samples instead of the removed placeholder.

Actual live client checks found three integration issues after fixture tests:
static verified catalog coverage legitimately has no time window; paginated
pages can retain an exact full-snapshot total when the service proved it; and
loading/status height changes can trigger Google Maps resize/camera events
that cancel the query repeatedly. The client now follows the frozen contract,
keeps unknown totals null, and reserves stable status/progress space. Regression
tests cover these cases, including the actual map rectangle during loading,
completion and failed refresh. Catalog failure without query bounds no longer
claims that layers are loading.

## Accepted P0 engineering

T010–T019 and T021–T025 are complete: layers/catalog/adapters, five HTTP routes,
2D geometry/count renderers, persistent typed details, viewport/time controls,
external anomaly consumption, nominal four bands with 0.2 hysteresis, bounded
server aggregation, member navigation, integrated selection continuity and the
bounded deployed live planning preview.
Every task has a [handoff](task-handoffs/) and an exclusive worker recorded in
[parallel status](p0-parallel-work-status.md).

T019 development deployment/preview is complete. T020 full live integration and
T026 rendered performance acceptance stay open until their evidence is complete.
Later news/area stories, H3 and 3D were not started. G1/G2/G3 and UC-04/UC-05 owner
acceptance were not inferred from local tests.

## Real publication and record-access evidence

The production map catalog read at `2026-10-01T10:17:26.332Z` succeeded against
approved views. Planning, boundary, rent and Census have available published
source metadata. Pedestrian, disruption, event and news have no admitted public
coverage. Anomaly is unavailable without an independent verified producer.

Boundary and pedestrian views lack complete latest-record rights proof. Those
production outputs remain denied until an independent verifier or data-owner
repair is supplied. Planning is the positive eligible live-preview path.
[Source readiness](p0-source-readiness.md) identifies exact SQL evidence and
owner acceptance cases without changing cloud/data or its task status.

The fresh exact current planning query with a public development-source filter
still dry-runs at **383,847,461 bytes**. Development preview explicitly sets
400,000,000 bytes per dynamic query, with one scale-to-zero instance and bounded
request/query/row/byte limits; the library's 100,000,000-byte default is unchanged.
Local user impersonation remains denied. The deployed service's successful
BigQuery jobs independently prove runtime execution as the existing dedicated
query identity. No new project/data/secret IAM roles were granted.

## Deployed live preview evidence

Service: [melens-dev-map](https://melens-dev-map-saepk4k6hq-km.a.run.app),
revision `melens-dev-map-00001-kq4`, Melbourne, 100% traffic. Cloud Build
`fb240801-0ea3-4df2-968b-eb8eb47ac903` completed successfully; the deployment uses
the immutable image recorded in [T019](task-handoffs/t019.md). Runtime identity:
`melens-dev-query@melens-510012.iam.gserviceaccount.com`. Successful query audit
at `2026-10-01T10:51:20Z` confirms execution as that identity. Runtime limits:
zero minimum/one maximum instance, concurrency 8, one CPU/512 MiB, 30-second
request deadline and 10-second query deadline.

| Real check | Observed result |
| --- | --- |
| Catalog | HTTP 200, live, nine layer entries; 3,699 bytes, 2.28 s |
| Allowed preflight | HTTP 204, exact `http://localhost:8000` origin, `Cache-Control: no-store` |
| Disallowed origin | HTTP 400, no allow-origin header |
| Planning viewport | HTTP 200; bbox `[144.94,-37.835,144.985,-37.80]`, zoom 12, current Oct 1–2 UTC window; 212 originals represented by 15 groups, complete exact total 212, coverage unknown; 92,852 bytes, 9.464 s |
| Aggregate members | HTTP 200, first 10 of exact 23 members, partial with continuation; 11,729 bytes, 4.998 s |
| Original detail | HTTP 200, same snapshot/version, original Point and official source; 1,310 bytes, 5.191 s |
| Boundary viewport | HTTP 200, unavailable, no items, partial, total null; record-rights denial retained; 590 bytes, 3.88 s |
| Flutter live repository | Decodes all nine live catalog entries; no synthetic fallback |

After the final client fixes, an additional bounded real `HttpMapRepository`
probe decoded a one-object viewport page (`partial`, exact full-query total
212, continuation), a one-original member page (`partial`, exact group total
23, continuation), and the same original/version as a Point detail. This
verifies the deployed paginated envelopes through the actual Dart transport
and validators, independently of fixture and UI checks.

`/healthz` currently returns a Google frontend HTML 404; `/healthz/` and
unknown paths reach the application JSON 404. Actual `/v1/map` routes are
verified above. This path-specific observation is not classified as a failed
runtime identity or repaired through broader IAM/ingress changes.

The local Flutter Web app is served at `http://localhost:8000`, explicitly live
and connected to this service. Google Maps renders with the user-provided demo
key. These single API timings are observations, not p95 measurements; the
9.464-second viewport observation exceeds the 2-second target. SC-002 remains
open and is not certified by a successful HTTP response.

Interactive `cua_repl` verification in the in-app browser at 1440×900 completed
a real visible-region planning query with exact total 237, Google Maps markers
and count symbols, no loading indicator and no sample label. Selecting a group
loaded four actual planning members; opening `melbourne.development_monitor:X0004803`
retained its exact original version and source. At 390×844 the same original
remained in the bottom details panel, then correctly became offscreen after
the resized view's query completed. Escape closed the details. Temporary
viewport overrides were reset and the live preview tab was kept for the user.
Evidence: [desktop](task-handoffs/performance/p0-live-desktop.jpg) and
[narrow](task-handoffs/performance/p0-live-narrow.jpg). This proves the rendered
planning preview and selection retention, not repeated four-source/p95 acceptance.

## Next delivery gates

- Supply independently verified boundary/record rights for positive boundary
  rendering in full G1 evidence. T019 planning preview, runtime identity, CORS
  and Maps setup are now verified.
- Data/producer owners deliver D01–D04/D07; then complete T020/G2 live acceptance.
- Measure SC-002 on the recorded desktop/narrow browsers after actual Maps and
  live results render; preserve T026 SC-003 fixture evidence separately.
- G3 needs the other P0 product owners' acceptance before later map stories start.
