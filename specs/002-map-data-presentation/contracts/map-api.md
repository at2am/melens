# Map API contract v1

**Status**: Frozen implementation boundary on 2026-10-01 (T001). Routes and adapters are not implemented by this document.
**Transport**: HTTPS UTF-8 camelCase JSON; GeoJSON geometry uses WGS84 [longitude, latitude]. Flutter receives no Parquet, SQL, provider credentials or BigQuery credentials.
**Source of shapes**: [map-contract.schema.json](map-contract.schema.json), using its named `$defs`. Cross-field, ordering, time, snapshot and publication rules below are mandatory in addition to shape validation.

## Registered layers and topics

V1 registers exactly pedestrian, anomaly, disruption, event, planning, boundary, news, rent, census and parking. Parking (UC-15) was added additively on 2026-10-15 by the project owner: live on-street bay sensors, current mode only. Catalog registration does not imply source admission or coverage. City activity defaults to pedestrian/anomaly/disruption; event/planning/parking are optional. Nearby news uses news. Area comparison chooses rent or census as its only filled metric. Boundary is context, at one level/vintage.

Catalog topic values are cityActivity, nearbyNews, areaComparison and context. Employment/crime require an additive catalog/contract decision plus admitted data; they are not accepted v1 request ids. Parking had that decision on 2026-10-15 and is accepted.

## Routes and envelope names

| Method/path | Request | Response `$defs` |
| --- | --- | --- |
| GET /v1/map/layers | No arguments | MapLayerCatalog |
| POST /v1/map/viewport | JSON ViewportQuery | ViewportResponse |
| GET /v1/map/items/{id} | URL-encoded item id; requestId and snapshotId query parameters | MapItemResponse |
| GET /v1/map/unlocated | One `query` parameter containing URL-encoded JSON UnlocatedQuery | MapItemPage with scope.kind=unlocated |
| GET /v1/map/aggregates/{id}/members | URL-encoded aggregate id; requestId, snapshotId, optional cursor/pageSize parameters | MapItemPage with scope.kind=aggregateMembers |

Details and members inherit mode/window/filter context from the snapshot; callers cannot override it through extra GET parameters. Every successful envelope has schemaVersion=1, generatedAt (known UTC) and dataMode=live|sample. Request-bound responses echo requestId, snapshotId and mode. Catalog has no requestId or snapshotId.

Sample replies exist only in the explicitly selected development sample repository/local sample server. The production service always returns live and rejects request-side sample switches. Live failure never falls back to samples.

## Request normalization and bounds

- requestId is an opaque, non-whitespace string, 1–256 characters. It is never SQL or a log message.
- The operational service envelope is [144, -39, 146.5, -37] in [west, south, east, north] order. Each coordinate must be finite and inside it; west < east and south < north. This request envelope is not evidence of coverage, a statistical boundary or a source jurisdiction. No antimeridian requests.
- zoom is finite, 0–22. layers contains 1–9 distinct registered ids. mode is current|historical.
- window is known UTC in `YYYY-MM-DDTHH:mm:ss[.fraction]Z` form, with seconds required and an optional fraction of 1–6 digits. Calendar dates and clock values must be valid at runtime. The window is half-open [from,to), from < to and at most 31 days for every ViewportQuery/UnlocatedQuery, regardless of selected layers. It selects dynamic facts; statistical periods are selected separately, never assigned invented timestamps.
- Selecting rent/census requires areaFilter: indicatorId, periodId, periodStart/periodEnd source date-only YYYY-MM-DD, nullable propertyType and boundaryVintage. Statistical bounds are half-open and ordered; they may exceed 31 days. The area adapter validates the periodId/date/definition relationship against published metadata before querying. Unsupported property encoding is explicit, never guessed.
- Selecting boundary requires boundaryFilter: level (GCCSA|LGA|SA2|STE|CLUE_BLOCK|MUNICIPAL) and vintage. Exactly one level/vintage is returned; source adapters map these public names to admitted schema codes. Multiple recorded vintages are not drawn together as duplicate areas.
- Optional filters normalize to null, pageSize to 1,000. pageSize must be 1–1,000. Unused supplied filters remain in snapshot context; caller changes invalidate continuation.
- Unknown request fields are rejected. Responses may gain additive optional fields; clients may ignore such additions without discarding known states or variants.

## Pagination and snapshots

The first request creates an opaque server-owned snapshot. The injectable server snapshot resolver owns normalized context, original selectedLayers, approved source-version watermarks and expiry (five minutes). This is an interface requirement, not a claim that a store or publication adapter already exists. Tokens expose no credentials or raw admission evidence; an opaque token store is sufficient for v1, with no mandatory signing-key infrastructure.

Normalized viewport context is bbox, zoom, mode, window, areaFilter, boundaryFilter and pageSize; it excludes requestId, layers, cursor and snapshotId. Selected layers are stored separately. Stable row ordering is layerId, id, versionId. Source-version selection is held for the snapshot so pages cannot silently mix publications.

Each LayerResult.nextCursor is a layer-bound continuation token. A continuation requires both cursor and snapshotId, the original normalized context, and layers=[the cursor's bound layer]. That layer must belong to the snapshot's original selectedLayers. A bare snapshotId on a new viewport request is rejected; a bare cursor is rejected. No client-side token construction or unvalidated token decoding.

Unlocated snapshots have a separate normalized context (mode/window/scope/filters/pageSize) and query family. A cursor cannot cross viewport/unlocated/member routes. Member cursors bind aggregate id as well as the snapshot. Detail/member reads use the same effective snapshot filters and source version; admission and retraction are rechecked on every successful request. Older snapshots never bypass withdrawn public access.

Expired snapshots yield snapshotExpired; changed context, unknown tokens, wrong layers/query family or invalid membership yield cursorMismatch. The client reissues the original request after expiry rather than combining old and new pages.

## Result and geographic semantics

Coverage, freshness and completeness are separate dimensions. See the schema enums and [data model](../data-model.md).

- noMatching requires a successful complete query, query-specific verified area/time coverage, items=[], unresolvedCount=0, totalMatching=0 and nextCursor=null. Empty rows alone never prove noMatching.
- notCovered requires coverage.state=notCovered. unknown/unavailable are not measured zero and have no invented coverage proof.
- available means at least one returned item; it does not imply complete coverage or a known total. A layer failure can be returned as unavailable while other layers succeed.
- Viewport items contain only drawable geometry with evidenced membership. Null geometry is excluded from geographic totals. unresolvedCount counts relevant unlocated records only when an approved area/jurisdiction association supplies evidence; otherwise it is null, never guessed from a broad source query.
- totalMatching is null unless an exact full-query total is available. It counts that query family's matching records; viewport totals exclude unlocated records. completeness=partial never implies all source data has been returned. Partial results without safe continuation may have nextCursor=null.
- UnlocatedQuery requires scope with either nonempty areaRefs or sourceJurisdiction (one, not both). These must be approved identifiers/evidence, not arbitrary locations. The response scope preserves the association and never claims viewport membership. No-geometry does not become a centroid.
- Core geometry types: Point/MultiPoint, LineString/MultiLineString, Polygon/MultiPolygon; coordinates are finite two-dimensional longitude/latitude. Polygon rings have at least four points and are closed. GeometryCollection and guessed geometry are not v1.
- If geometry is simplified, geometryPresentation records originalPrecision and toleranceMeters without enlarging affected scope. Stable ids survive zoom representation changes. Aggregates carry actual members, metric/unit/window, bounds and result range; zero classified sensors yields a null anomalyRatio.

## Time and details

All known instants are UTC and displayed in Australia/Melbourne. Every instant uses the schema pattern `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$`: seconds required, optional 1–6 fractional digits, and a literal `Z`; valid calendar/clock values are separately enforced at runtime. Values finer than microseconds are rejected rather than silently truncated. Comparison and snapshot normalization retain microseconds; equivalent trailing-zero spellings denote the same instant. ItemTime fields are required and nullable, including sourceTimeText/sourceTimezone. Unknown-clock original text is retained in sourceTimeText, and no inferred UTC value is supplied. Source date-only/statistical labels stay periods. Source freshness cannot turn historical readings into current facts.

MapItem.kind discriminates details; there is no details.runtimeType. V1 has ten kinds: pedestrian, anomaly, disruption, event, planning, parking, boundary, news, areaIndicator and aggregate. layerId=rent|census uses kind=areaIndicator; aggregates retain the represented layer. Other ordinary kinds match their same-named layer.

A parking item is one sensor at its own point (location.role sensor). details.state is what may be drawn: occupied or vacant only while details.reading is current or late, otherwise noData with noDataReason (notReporting, publicHoliday, holidayUnknown, noStatus). details.legalParking is always unknown and details.mayBeObstructed is true: a sensor shows whether a car is on the bay, never that parking there is allowed. There is no historical parking read and no unlocated parking list. Parking aggregates count vacant sensors (metric vacantSensorCount) and are not formed close up (zoom 17 and above), where each bay is drawn. Every item includes sources and public attribution; no private provider response or untrusted HTML.

Missing counts/values remain null; measured zero remains zero. Area values with missing/suppressed valueState have value=null. Only matched same-vintage area boundaries are drawable. Pedestrian location must be effective over the observation window; ambiguous/inactive/unlocated locations have null geometry. A/B directions have no geographic heading. Anomaly results require producer-owned baseline/result evidence; this contract supplies no detector. News mention/area association is never promoted to an event-site point.

## Limits and errors

Response maximum: 1,000 items across a viewport envelope (not per selected layer), 1,000 list/member items, and 2 MiB uncompressed. Request maximum: 256 KiB. Server budgets are enforced before/while querying. Fixed parameterized view allowlist only; no raw/staging tables, arbitrary SQL or provider URLs.

Default scan ceilings are 100 MB dynamic and 500 MB statistical/historical; only the integrator changes these after recorded dry-run evidence. Queries also have time, row and concurrency limits. Excess rows/geometry produce truthful partial results or a bounded error. No persistent response cache initially.

ErrorResponse contains schemaVersion=1 and error={code,messageKey,requestId,retryable}; requestId may be null when no valid id could be parsed. Localized message keys or safe English fallback only.

| Code | HTTP |
| --- | --- |
| invalidRequest / cursorMismatch | 400 |
| notFound | 404 |
| notAvailable | 410 |
| snapshotExpired | 409 |
| rateLimited | 429 |
| budgetExceeded / serviceUnavailable | 503 |
| queryTimeout | 504 |

A client retries manually or with a bounded refresh policy, preserves context/selection and protects against stale requestId responses. Loading/refreshing are client states, never unfinished server success claims.

## Ownership, configuration and delivery

Shared contract/fixtures and task statuses belong to the root integrator after this freeze. T005 owns Dart models/sample repository, T006 server validation, T007 fixed query execution, T008 repository/HTTP, and T009 shared presentation/provider/localization integration. T003 owns app configuration and README after T001 handoff. No concurrent edits to the same generated/shared files.

G0 requires all nine preparation tasks and real runtime/generation checks; contract freeze alone is not G0. G1 can use labelled samples and admitted boundaries/development; G2 needs real P0 map sources and separate anomaly/transport evidence; G3 is full project P0 owner acceptance. Later news/area and optional H3/3D retain the plan's priority gates. Nothing here activates a source or changes a use-case status.

Build keys: MAP_BASE_URL, MAP_DATA_MODE, GOOGLE_MAPS_WEB_API_KEY, GOOGLE_MAPS_MAP_ID. Explicit sample is development-only; production uses live. No committed real keys. Cloud Run identity has only approved-view read/query rights; no ingestion writes. Public replies include only admitted public fields. CORS permits configured development/deployed origins and rejects unknown origins. Maps keys have platform restrictions and enter ignored build configuration through Secret Manager.

## Examples and compatibility

The seven original state envelopes remain viewport.sample.json, no-matching.sample.json, not-covered.sample.json, unavailable.sample.json, unknown.sample.json, historical.sample.json and partial.sample.json. Additional query/catalog/item/list/member/error and item-variants fixtures document every shape; all are synthetic and clearly sample-labelled. Unlocated sample sensor C is in unlocated.sample.json, outside viewport totals.

schemaVersion=1 is mandatory. Additive optional fields may remain v1; breaking names/types/semantics require coordinated schema/fixture/client/server updates before either side merges. BigQuery snake_case remains behind adapters. The old MapFeature draft is conceptual, not this wire schema.
