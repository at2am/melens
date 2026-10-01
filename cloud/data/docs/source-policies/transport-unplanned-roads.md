# Unplanned road disruptions

Reviewed on 2026-10-01 for T031. The source remains `candidate` and `review_required` until the shared admission and cloud publication checks pass.

## Official evidence

| Requirement | Evidence and interpretation |
| --- | --- |
| Coverage and licence | The [Transport Victoria collection](https://opendata.transport.vic.gov.au/dataset/unplanned-disruptions-road) describes Victorian DTP and council roads, including tow allocations in the Melbourne Controlled Area, and states CC BY 4.0. This is Victoria-wide coverage, not complete Melbourne street coverage. |
| Parent and child | The collection identifies an incident as the parent and each impacted location as a child. The [v3 dictionary](https://opendata.transport.vic.gov.au/dataset/unplanned-disruptions-road/resource/1b185c7f-d4b2-404d-a65c-b5a80da7582d) defines `id` as incident ID and `impactId` as child impact ID. |
| Authentication and request limit | The collection states a `KeyID` header and 20 calls per 60 seconds. Values stay in the Cloud Run environment after Secret Manager injection. The connector rejects redirects, spaces pages by 3.1 seconds, and permits one HTTP attempt per page. HTTP 429 returns `Retry-After`, with 60 seconds as the absent-header fallback. The shared provider quota still applies across jobs. |
| Refresh and pagination | The collection states a 60-second refresh and `page`/`limit` parameters. The connector requests 100 features per page and verifies page numbers, counts, unchanged totals, and unique incident-impact keys. Stable totals do not prove the provider supplied an atomic snapshot. |
| Status | The [v3 OpenAPI](https://opendata.transport.vic.gov.au/dataset/af595015-e191-45e5-ab89-6ebca7257e54/resource/1b185c7f-d4b2-404d-a65c-b5a80da7582d/download/unplanned_road_disruptions_v3.openapi.json) lists child status `Pending`, `Active`, `Reopened`, and `Inactive`. The dictionary also describes these incident states. Unknown or missing incident status and unknown child status reject the batch. `Inactive` resolves an impact; `Pending` stays planned; `Active` and `Reopened` are active. Parent inactive or pending status constrains each child. |
| Event time | This source's dictionary calls `created`, `lastUpdated`, `lastClosed`, `endTime`, and `nextUpdateDue` timestamps, without specifying a timezone. Its OpenAPI supplies `date-time`, also without a local timezone rule. Offsetless values stay null in absolute time fields. The planned-road source's separate timezone statement does not establish a rule for this endpoint. |
| Estimated end | The v3 dictionary describes `endTime` as an expected end or next update, currently matching `nextUpdateDue`. Neither can resolve an active incident. Resolution requires explicit inactive status. Absent `lastClosed` keeps `valid_to` null. |
| Geometry | The dictionary states WGS84, longitude then latitude, with Point or LineString representing a road point or length. Invalid geometry stays unlocated. The retained JSON summary includes incident and impact IDs, statuses, original timestamps, reference roads, impact information, and all source properties. |

## Publication contract

Each complete read adds one source record with native ID `snapshot:${fetchedAt}`. Its version hashes `{ policy: 'complete-road-snapshot-v1', canonicalMembership }`, where membership is the sorted list of `[geo_record_id, version_id]`. Every geography links to this record through `evidence_role = road_snapshot_membership`, with exact batch and versions.

The snapshot has null source observation and update timestamps. Its `first_accessible_at` equals the fetch time and its missing-time reason identifies it as a fetched snapshot, not an incident observation. The source revision includes the snapshot proof so a repeated fetch records new membership evidence while unchanged incident and impact versions remain stable. An empty response still emits a snapshot with no members.

The shared current view must select membership from the newest complete published snapshot and exclude disappeared impacts. Disappearance does not manufacture a resolved record or an incident end time. Failed or incomplete reads emit no facts or new membership. The previous published snapshot remains available with its actual freshness state. Conflicting contents at the same snapshot fetch instant must fail closed.

One incident can have multiple impacts and one consistent parent evidence version. Conflicting incident fields across those impacts reject the batch. The fixture models a consistent active parent with one active and one resolved child; the former fixture's two contradictory parent versions were not a valid current snapshot. If real provider rows vary fields defined as incident fields, preserve the failure and investigate their scope before changing this rule.

## Verification and remaining gates

The 31 connector tests cover parent-child links, independent child resolution, unknown states, parent conflicts, empty membership, stable business replay, changed snapshot observation, field and geometry revisions, source timestamp uncertainty, pagination failures, outage, and secret-safe request options.

Private cloud reads before this change accepted 291 and then 290 features with zero rejects. Those reads did not publish or retain raw bodies, and their source-update strings had omitted offsets. A new immutable image must rerun the private probe after the stricter status and parent-consistency checks. Expected normalized source fact count gains one snapshot record. Cloud source admission, current-view membership, repeated publication, quotas and cost parameters, and first-release operation evidence remain integration gates. Neither local tests nor private probe counts establish the SC-002 24-hour freshness acceptance.

The revised private cloud probe subsequently returned 305 complete incident-impact rows and 593 source facts with zero rejected, including one snapshot proof. All 305 membership links were present, and offsetless update times stayed null. The production current-view SQL also passed in BigQuery with synthetic snapshot fixtures and was applied to the development dataset. See [integrator evidence](../validation/five-task-parallel-2026-10-01.md) for exact image/execution references and the remaining admission and real publication gates.
