# Research: Map presentation and parallel development

**Date**: 2026-10-01 | **Status**: Draft choices for implementation preparation.

## 1. Client format and transport

**Decision**: JSON envelopes with GeoJSON geometry, bounded by viewport/layer/time, from a read-only Cloud Run service.
**Rationale**: Current normalization and query views are BigQuery; Flutter has an HTTP client and JSON conventions. Parquet is a batch/analytics format, and adds no value to an interactive first map.
**Alternatives considered**: Whole-city JSON dumps exceed the intended query boundary; Parquet does not supply incremental layer states; Firestore requires a publication path and listener architecture not currently built.
**Evidence**: [Feature 001 query boundary](../001-melbourne-data-aggregation/plan.md#query-engine-boundary); [Flutter JSON guide](https://docs.flutter.dev/data-and-backend/serialization/json); [GeoJSON RFC](https://www.rfc-editor.org/rfc/rfc7946).

## 2. 2D rendering

**Decision**: Google Maps Flutter with typed points, circles, lines and polygons. Read counts as circle area, not circle radius; preserve original statistical geography.
**Rationale**: Existing app design already chooses Google Maps and its package supports Web/Android/iOS. Data and state can be shared while platform acceptance remains explicit.
**Alternatives considered**: A custom WebGL renderer from day one adds an integration boundary before the basic map exists. The former built-in heatmap is not a dependency for this plan.
**Evidence**: [Google Maps Flutter](https://pub.dev/packages/google_maps_flutter) documents platform support and platform differences. Exact package resolution and material_ui compatibility are T003 setup work.

## 3. Published data versus upstream engineering

**Decision**: Freeze live integration eligibility from published authorized views, not connector test results.
**Rationale**: The Oct1 read-only audit found six published sources: boundaries, development, rents and Census. Pedestrian observations were empty; rents had no drawable matched boundary. Code fixes do not imply candidate sources are public.
**Alternatives considered**: Showing private-probe results as product data would bypass the admission and publication requirements.
**Evidence**: [Feature 001 verification](../001-melbourne-data-aggregation/verification.md), [parallel work status](../001-melbourne-data-aggregation/parallel-work-status-2026-10-01.md), [source deployment](../../cloud/data/docs/validation/source-deployment-2026-10-01.md). Counts in these records are snapshots, not a guarantee of present availability; re-query when integrating.

## 4. Parallel work boundary

**Decision**: Frontend uses shared labelled fixtures; backend queries available published data; ingestion team works in its existing scope. One integrator owns contracts, config, localization, generated shared files and deployment.
**Rationale**: Data publication delays should not prevent the UI from implementing correct missing/stale/unknown states. Concurrent writes to ingestion entry points, shared SDK config or one ARB file would create avoidable conflicts.
**Alternatives considered**: One developer per source with each editing the map screen creates conflicts and inconsistent semantics; waiting for every source before UI work wastes independent work.

## 5. H3

**Decision**: A later server-produced hex coverage view, with anomaly colouring only when verified classifications exist. Grid ids, resolution and metric/window definitions are explicit.
**Rationale**: H3 provides hierarchical spatial grouping. It does not produce evidence of density, unique people or anomalies.
**Alternatives considered**: A smooth interpolated city heatmap misrepresents sparse point observations; native rents geography cannot be made more precise by hexagons.
**Evidence**: [H3 aggregation](https://h3geo.org/docs/highlights/aggregation/). Choose resolutions in the H3 task against actual measurement coverage; no initial P0 dependency on this decision.

## 6. 3D walkers

**Decision**: One Web pilot after core acceptance. Count-driven illustrative movement, explicit enable/pause, cap/scale labels, reduced-motion and static fallback.
**Rationale**: Source readings provide counts, not individual positions, speeds or calibrated geographic directions.
**Alternatives considered**: Whole-city walkers and native parity would enlarge the scope before one block demonstrates value.
**Evidence**: [Google WebGLOverlayView](https://developers.google.com/maps/documentation/javascript/webgl/webgl-overlay-view) supports shared WebGL context and Three.js, requiring a vector-enabled map ID.
**Integration boundary**: Do not assume the Flutter plugin exposes its JavaScript map as a supported API. The pilot feasibility task evaluates a controlled Web map surface through documented JS interop; 2D state is transferred in/out, and unsupported native platforms keep the 2D view. No dependence on private plugin internals. A failed feasibility/performance gate leaves the 3D option unavailable and records the limitation.

## 7. Priority interpretation

**Decision**: Distinguish spec story priority from project priority and delivery wave.
**Rationale**: US1/US2 are feature P1 but support project P0; US3 is feature P2 and UC-06 project P1. The first map preview is not project P0 completion.
**Alternatives considered**: Starting all six stories simultaneously would consume time on news/3D before the primary demo data and integrations work.

All design unknowns have a bounded decision or an explicit deferred validation gate. The platform default remains a stated assumption while user feedback is pending; it is not an approval claim.
