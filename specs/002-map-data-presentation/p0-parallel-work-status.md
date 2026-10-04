# P0 parallel implementation

**Started**: 2026-10-01 | **Scope**: Feature 002 T010–T026, first 2D map and zoom. G0 is complete. One subagent owns each dispatched task; at most eight workers run alongside the integrator.

The user authorized P0 implementation after the preparation delivery. The reviewer-owned delivery checklist retains 32 unchecked items; its markers are not implementation status. No extension hooks are registered. P1 news/area comparison and optional H3/3D are outside this run.

## Assignment and dependency queue

| Task | Dedicated worker | Current state | Dependency / handoff |
| --- | --- | --- | --- |
| T010 layers | p0_t010_layers | Complete; 13 targeted tests | Generated/localized by root |
| T011 catalog/coverage | p0_t011_catalog | Complete; 16 targeted tests and real catalog read | Public metadata evidence |
| T012 planning/boundaries | p0_t012_planning | Complete; 15 targeted tests | Boundary live rights gate remains open |
| T013 dynamic adapters | p0_t013_dynamic | Complete; 20 targeted tests | D01/D02/D03/D07 live publication remains open |
| T014 routes/snapshots | p0_t014_routes | Complete; 40 targeted tests | Shared backend transferred to T025 |
| T015 map surface | p0_t015_surface | Complete; 19 targeted tests and responsive regression | Camera retained; count/window/precision guards |
| T016 selection/details | p0_t016_details | Complete; 30 targeted tests | Shared ownership released to T024 then root |
| T017 viewport/screen | p0_t017_viewport | Complete; 21 targeted tests | Shared UI transferred to T025 |
| T018 anomaly consumer | p0_t018_anomalies | Component validation complete; 19 TS + 8 Dart tests | T025 joins screen; D04 remains open |
| T019 preview | p0_t019_preview | Complete; bounded service deployed and real Google Maps/planning/member/original-detail path verified | Boundary rights and full G1/G2/G3 owner acceptance remain separate |
| T020 states/live acceptance | p0_t020_states | Local validation complete; 6 Dart + 9 TS tests | Full live source/rights acceptance remains open |
| T021 zoom | p0_t021_zoom | Complete; 38 targeted tests | Nominal bands and hysteresis |
| T022 server aggregation | p0_t022_aggregation | Complete; 16 targeted tests | Immutable true members, unknown partial totals |
| T023 aggregate UI | prep_t007_queries (reused idle worker) | Complete; 11 targeted tests | Bounded manual members and actual bounds |
| T024 selection continuity | p0_t024_selection | Complete; 10 targeted tests, 51 joint regressions | Original item/version/context retained |
| T025 zoom integration | p0_t025_zoom_integration | Final UI integration validation | Backend default aggregation frozen; 6 targeted tests |
| T026 zoom acceptance | p0_t026_zoom_acceptance | Local validation complete; 4 TS + 8 Dart tests | Google Maps now renders; repeatable browser performance acceptance remains open |

Workers with unfinished prerequisites prepare fixtures, tests and interfaces first. Their implementation is accepted only after the prerequisite handoff and validation. Completed workers release capacity and the next dependency-ready task gets a dedicated worker.

## Exclusive file ranges

Each worker owns its task's files and matching targeted tests plus task-handoffs/tNNN.md and optional tNNN.l10n.json. T012 owns adapter-common.ts, shared by row converters. T014 owns the server, viewport/detail/unlocated/snapshot store, composition and fixed-query extensions. T022 owns aggregation.ts. T015 owns core renderers and map_surface; T023 owns aggregate renderers/details. T016 owns selection/map details/unlocated list until a serialized T024/T018 handoff. T017 released the current map screen and viewport controller exclusively to T025.

The integrator alone merges ARB additions, runs shared generation/localization, coordinates dist build windows, updates task/checklist-independent status and controls package/config/deployment integration. Existing cloud/data, feature001 and unrelated temp.sh are preserved. No worker edits secrets or commits. Work reuses the current checkout with disjoint ownership; no new worktree was necessary.

## Integration gates

- The user supplied a demo Maps Web key. Root used ignored local build configuration and verified Google Maps tiles/attribution/controls in the in-app browser. Committed example configuration retains an empty key.
- Measured current geo queries estimate 383847461 bytes. Source filtering did not reduce this estimate. The integrator reviewed an explicit 400000000-byte ceiling for the bounded development preview; the library default remains 100000000. The final default backend build/typecheck/test passed 163 tests with no failures or skips.
- Record-level rights gaps in the current boundary/pedestrian views block those live outputs until independently verified; see [source readiness](p0-source-readiness.md). Published/admitted sources are read through approved views. Candidate/private probes never enter the app; unavailable layers remain labelled. Live P0 acceptance additionally needs D01–D04/D07 and real device/performance evidence.
- Unit and sample results do not close G1–G3 or source acceptance. The final joint checks and each incomplete gate will be recorded in validation.md.
