# Map presentation data model

**Status**: Frozen v1 implementation boundary, 2026-10-01. JSON is camelCase; source snake_case stays in server adapters. [Wire contract](contracts/map-api.md) defines semantic rules; [JSON Schema](contracts/map-contract.schema.json) defines exact known shapes.

## Shared types

| Shape | Fields |
| --- | --- |
| ViewportQuery | requestId, bbox, zoom, layers, mode, window, areaFilter, boundaryFilter, pageSize, cursor, snapshotId |
| AreaFilter | indicatorId, periodId, propertyType, boundaryVintage, periodStart, periodEnd |
| BoundaryFilter | level, vintage |
| Coverage | state, areaRefs, window, evidenceSourceIds |
| LayerDescriptor | id, titleKey, topic, defaultEnabled, supportedModes, sourceIds, availability, freshness, coverage, timeSemantics, updatedAt |
| LayerResult | layerId, state, freshness, completeness, sourceIds, coverage, observedWindow, updatedAt, items, unresolvedCount, nextCursor, totalMatching |
| MapLayerCatalog | schemaVersion, generatedAt, dataMode, serviceBounds, layers |
| ViewportResponse | schemaVersion, requestId, snapshotId, generatedAt, mode, dataMode, layers |
| MapItemResponse | schemaVersion, requestId, snapshotId, generatedAt, mode, dataMode, item |
| UnlocatedQuery | requestId, layers, mode, window, scope, areaFilter, boundaryFilter, pageSize, cursor, snapshotId |
| MapItemPage | schemaVersion, requestId, snapshotId, generatedAt, mode, dataMode, items, completeness, nextCursor, totalMatching, scope |
| MapReadContext | requestId, snapshotId, cursor, pageSize |
| ItemTime | observedAt, reportedAt, validFrom, validTo, periodLabel, fetchedAt, sourceTimeText, sourceTimezone |
| SourceReference | sourceId, url, attribution, versionRef |
| Location | precision, role, evidence |

Optional request fields: areaFilter/boundaryFilter, pageSize, cursor, snapshotId; MapReadContext cursor/pageSize are optional. Required nullable fields remain present as null, never silently zero or made-up time. Catalog has exactly nine unique registered descriptors. Viewport has one result per requested layer; the maximum object count is global to the response.

## Item variants

MapItem has id, versionId, layerId, kind, title, geometry, location, assertionKind, lifecycle, time, sources, details, and optional geometryPresentation. kind selects the detail shape directly; no runtimeType field is sent.

| kind | Details fields |
| --- | --- |
| Pedestrian | sensorId, totalCount, directionACount, directionBCount, granularity, window, locationValidFrom, locationValidTo, locationStatus |
| Anomaly | resultId, sensorId, observationId, window, baselineDefinitionId, baselineValue, observedValue, delta, direction, eligibility, classification |
| Disruption | summary, impact, serviceNames, status, extentKind |
| Event | summary, venueName, category, startAt, endAt, status |
| Planning | summary, projectStatus, permitId |
| Boundary | boundaryId, boundaryLevel, vintage, name |
| News | eventId, summary, articleRefs, localizationEvidence, dedupStatus |
| AreaIndicator | indicatorId, value, valueState, unit, periodId, periodLabel, propertyType, boundaryId, boundaryVintage, mappingState, definition |
| Aggregate | representation, memberIds, memberCursor, resultRange, metric, window, coverage, bounds, grid |

All exact enums/nullability are in the schema. Additional nested shapes are ArticleReference, AggregateMetric, ResultRange and GridDetails. AreaIndicator belongs to rent/census; Aggregate retains its represented layer. Other ordinary kinds match their layer.

## Truth and geometry invariants

- **GeoJSON coordinates are [longitude, latitude], never [latitude, longitude].** Six core two-dimensional types; polygon rings closed. Null geometry is excluded from viewport membership/totals and remains accessible only with an approved area/jurisdiction association.
- **Missing counts remain null; zero is a measured zero.** Pedestrian counts are sensor passages, not unique people, calibrated headings, measured speeds or individual trajectories. Observation-effective location is required.
- **Null geometry is never replaced by a guessed point.** News mentions/area associations never become event sites. Only matched same-vintage area geometry is drawable.
- **totalMatching is null unless an exact full-query total is available.** unresolvedCount is also nullable when association evidence cannot establish a relevant count.
- **A noMatching state requires verified area/time coverage and a successful complete query.** It additionally requires zero items/unresolved/total, no continuation. Coverage, freshness and completeness remain independent.
- Public admission/retraction filtering applies equally to catalog, viewport, detail and member reads; older snapshots cannot retain withdrawn public access.
- Anomaly classification consumes producer-owned proof. Same-window/same-baseline grid denominator zero yields null ratio; unclassified sensors do not silently count as normal.

## Time and normalization

Known instants use strict `YYYY-MM-DDTHH:mm:ss[.fraction]Z`, with required seconds and optional 1–6 fractional digits. The exact schema pattern is `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$`; valid calendar and clock values are runtime-validated. Microseconds are preserved for comparison and snapshot normalization; finer values are rejected, never truncated. Every request UTC window is limited to 31 days regardless of layers; source statistical period bounds are independently unrestricted by that duration. sourceTimeText/sourceTimezone retain unknown-clock semantics without inferred instants. Melbourne display time is explicit. Date-only statistical periodStart/periodEnd retain source definitions and are distinct from dynamic UTC window. periodId/date/indicator agreement is adapter-validated.

Viewport snapshot context binds bbox/zoom/mode/window/filters/pageSize. Original selectedLayers are separate; continuation has one cursor-bound layer and snapshotId. Tokens are opaque server-resolved, expire in five minutes and never bypass current public access. See the wire contract for query-family isolation and GET encoding.

## Client transitions

- Topic session: defaults → adjusted layers → preserved session; another topic restores its own session/default. The topic and every topic's layers are remembered on the device and restored at the next launch (UC-01 notes).
- Aggregate: tapping a count badge selects the group and fits the camera to its member bounds after the details open; opening details never recreates the map.
- Request: idle → loading/refreshing → result/failure. Only the newest requestId replaces results. Retained data keeps original source timestamps and a refresh-failure notice.
- Selection: stable id survives zoom; offscreen detail remains; filter exclusion/deletion explains and clears highlight.
- Zoom: nominal first band; closer entry at threshold+0.2, return at threshold−0.2.
- 3D: off → starting → running/paused → off or unavailable. Reduced motion defaults paused; exact count/time/source remain readable.

## Later 3D input

Selected sensor id, effective observation/window, explicit scale/cap, supported pilot block and synthetic paths; no individual trajectory or measured speed. H3 is not required. Live/sample distinction remains visible. This is deferred from the preparation implementation.
