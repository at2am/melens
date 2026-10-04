# Implementation Plan: Map data presentation

**Feature**: 002-map-data-presentation | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)
**Status**: G0 and P0 map/zoom engineering implemented and jointly validated on 2026-10-01. Development deployment and real browser/source acceptance remain distinct gates. See [validation.md](validation.md) and [parallel status](p0-parallel-work-status.md).
**Git**: The setup script reports the feature identifier as its logical branch. The current checkout stays on main; this workflow creates no branch.

## Summary

Build a usable 2D map first: topic layers, truthful time and coverage states, selection/details, and four zoom bands. A bounded Cloud Run query service reads the published BigQuery views and returns JSON containing GeoJSON geometry. Flutter and the service develop against the same contract and labelled fixtures while the existing data team completes P0 publication.

Delivery order is foundation → P0 map browsing/zoom and real pedestrian/transport integration → later news and area comparison → optional H3 and a single-block 3D pilot. A map milestone does not certify the other P0 use cases, source acceptance, or project release.

## Technical Context

**Language/Version**: Existing Flutter pin 3.47.5 / Dart SDK constraint ^3.13.4; backend Node.js 24 / TypeScript 5.9.3, matching cloud/data.
**Primary Dependencies**: Existing Riverpod annotations, Freezed/json_serializable, http, material_ui, timezone; Google Maps Flutter for 2D. Backend uses @google-cloud/bigquery and request validation. H3 and Three.js are later, isolated dependencies.
**Storage**: Existing Melbourne BigQuery published query views. No additional database or client BigQuery credentials. Source ingestion remains in cloud/data.
**Testing**: Existing Flutter analyze/test and backend typecheck/test; targeted contract/state tests are required by the spec's acceptance scenarios. Human comprehension and measured performance are separate acceptance evidence.
**Target Platform**: Proposed first delivery is Flutter Web, with desktop and narrow mobile-browser layouts. Android/iOS retain shared data/state and are a separate platform acceptance gate. This default follows app/README.md's Web submission target and can change in response to the platform question.
**Project Type**: Flutter application plus a small read-only Cloud Run map service.
**Performance Goals**: SC-002: p95 300 ms existing-data toggles and p95 2 s completed viewport updates. SC-009: later 3D pilot, 95% one-second samples ≥30 fps over two minutes. Loading alone does not satisfy update latency.
**Constraints**: Google Cloud; English product text; Melbourne time; source provenance; no fabricated geometry, missing values, anomaly results, or individual trajectories.
**Scale/Scope**: Initial City of Melbourne dynamics, Greater Melbourne statistical boundaries. Six currently published sources provide integration samples; pedestrian, transport and events have independent publication gates.

## Constitution Check

The constitution file is an unfilled template, so no ratified constitution clauses can be inferred. Apply [project instructions](../../system-design/AGENTS.md).

| Gate | Design decision | Result |
| --- | --- | --- |
| Google Cloud only | Cloud Run, Firebase Hosting, existing BigQuery | Satisfied by design |
| Product AI on Google; Flutter does not call models | No model calls in map service or Flutter | Satisfied by design |
| No committed secrets | Config names and examples only; restricted Maps credentials supplied at build time | Satisfied by design |
| Public facts traceable; predictions labelled | Contract carries sources, assertion and time semantics | Satisfied by design |
| P0 before P1/P2 | US1/US2 support UC-01/04/05; deferred waves wait for project P0 acceptance | Satisfied by sequencing |
| Existing Flutter conventions | material_ui, annotated providers, ARB, pinned SDK, generated artifacts | Required during implementation |
| Deployed prototype | Cloud Run service + Web deployment tasks, with measured integration evidence | Planned; not yet achieved |

Re-evaluated after design: no waiver required. These results assess the design, not implementation compliance.

## Phase 0: Research Decisions

See [research.md](research.md). Important decisions: JSON/GeoJSON at the client boundary; BigQuery accessed through fixed, parameterized server queries; platform-neutral map data/state; 2D circles before H3/3D; permission and geography failures remain explicit.

The Firestore listener approach in earlier architecture and UC drafts is not implemented. Feature 001 explicitly deferred that choice. T001 synchronized architecture, app conventions and UC-01 around the bounded query service and published store. The JSON/GeoJSON contract is the implementation baseline; revise it before changing that transport.

## Phase 1: Design

### Shared boundary

[Map API contract](contracts/map-api.md) and [data model](data-model.md) are the shared baseline. A contract freeze precedes independent frontend/backend work. Keep fixtures available to both implementations, labelled as samples. Backend responses never silently switch to fixtures.

The initial dynamic query uses selected layers, viewport and a half-open time window. Area comparison adds explicit indicator, period, property type and boundary vintage. Stable ids and snapshot-bound cursors prevent duplicate or mixed-page results. Unlocated facts remain in a list or separate unresolved count; they do not receive invented points.

### Truthful status

Publication and admission are prerequisites for every production record. Distinguish coverage, result completeness, source freshness and lifecycle; an empty result is not itself evidence of no coverage. Preserve unknown timestamps and time-zone semantics. Failed refreshes may retain old results only with a failure/freshness notice.

An anomaly layer is available only when a verified producer supplies a baseline, definition, result and provenance. This feature consumes that result; it does not claim to implement UC-04 detection or AI explanation. Coverage-only H3 does not need anomaly results; H3 anomaly colouring does.

### Delivery gates

| Gate | Scope | Completion condition |
| --- | --- | --- |
| G0 | Parallel development boundary | Contract/fixtures, paths and shared-file ownership recorded; setup and foundation tasks complete |
| G1 | Map development preview | US1/US2 work with labelled samples; published boundaries/development can validate the real service path |
| G2 | Live P0 map integration | US1 and US2 accepted (T020/T026); admitted pedestrian counts with effective locations; published roads; locatable transit where evidence permits; unavailable data labelled; current/historical modes truthful |
| G3 | Full project P0 | Owner records acceptance of all P0 use cases, including anomaly producer/analysis, discovery/planning/chat and events requirements; outside this map spec |
| G4 | Later features | G3 before news/area feature development; optional H3/3D wait for the selected P1 work and do not block P0 |

A roads-only traffic preview can pass G1 while missing transit is explicit. It cannot satisfy UC-05's tram/train criteria or G2's full transport acceptance. Similarly, counts without anomalies do not satisfy UC-04.

### Initial defaults

Use spec zoom bands <11, 11–14, 14–17 and ≥17 with 0.2 hysteresis; City activity opens near zoom 14. One filled area metric at a time. Supported core geometry is Point/MultiPoint, LineString/MultiLineString and Polygon/MultiPolygon; null means no drawable geometry.

First viewport budget: 1,000 objects/page and 2 MiB uncompressed response; large geometry must be truthfully simplified or reported partial. Requests are bounded and queries use allowlisted views, timeouts, dry-run ceilings and maximumBytesBilled. No unrestricted SQL endpoint. Start without a persistent response cache; add caching only after measured need and define admission/retraction invalidation first.

Performance reference environments are recorded by T002: desktop Chrome at 1440×900 and narrow Chrome at 390×844, with actual hardware/browser/network conditions. These are Web acceptance contexts; native-device acceptance is separate.

## Project Structure

### Documentation

```text
specs/002-map-data-presentation/
  spec.md, discussion-notes.md, plan.md, research.md
  data-model.md, quickstart.md, tasks.md, parallel-development.md
  contracts/map-api.md
  contracts/examples/viewport.sample.json
  checklists/requirements.md, delivery.md
```

### Source code (planned paths)

```text
app/lib/features/map/
  data/                 DTOs, repository, HTTP and explicit sample repository
  state/                layer/selection/viewport/zoom controllers
  ui/                   map surface, panel, legend, details, renderers
app/lib/features/map_3d/ Web-only pilot bridge and static fallback
app/web/map_3d/          controlled JavaScript map/Three.js surface
cloud/map/
  src/contracts/        request/response validation
  src/query/            fixed queries and view adapters
  src/services/         catalog, viewport, detail, aggregation
  src/server.ts         bounded HTTP/CORS routes
  infra/                Cloud Run deployment
cloud/data/             existing ingestion; separately owned dependencies
```

**Structure Decision**: Isolate the read service from ingestion so frontend/backend work does not compete with current publication changes. Client data/state is independent of the renderer. No generic provider framework, second query store or automatic SQL generation is needed.

## Complexity Tracking

No constitution violations. A separate Cloud Run map boundary is needed to keep credentials, SQL limits and publication filtering off clients. H3 and 3D remain optional scoped additions.
