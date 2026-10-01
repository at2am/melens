# Parking release preparation, 2026-10-01

## Reviewed sources

The three official metadata responses declare `CC BY` and link to [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode). This permits field conversion, storage and display with City of Melbourne attribution, the dataset/licence links and an indication of conversion. The source manifests now contain the actual field names, coverage references, full-export completeness rules, review times and raw/staging retention settings. Their access remains `candidate` until the integrator verifies cloud retention and cost controls and activates the source.

| Source | Full connector fetch UTC | Source inputs | Normalized result | Source revision |
| --- | --- | ---: | --- | --- |
| [On-street parking bays](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bays) | 2026-10-01T11:02:18.698Z | 29,053 | 29,053 source records and surveyed points | No verified per-row UTC update |
| [On-street parking bay sensors](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors) | 2026-10-01T11:02:24.068Z | 6,324 | 6,324 source facts, independent point records, provenance links and occupancy observations | Latest individual refresh 2026-10-01T11:00:52Z |
| [On-street car park bay restrictions](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-car-park-bay-restrictions) | 2026-10-01T11:02:25.926Z | 4,263 | 4,263 source records and 8,035 separate rule slots | Official metadata `data_processed = 2022-11-13T10:30:19Z` |

All three new connector reads matched independent `total_count`, rejected zero records and retained no raw records. They were public local reads, with `published=false`; cloud publication is owned by the integrator. Each manifest's `coverage_from` is this first verified full snapshot, not historical completeness or rule validity.

## Collection and budget configuration

The live public count and export responses advertised `X-RateLimit-Limit: 10000`, with a next-day UTC reset. Two sequential requests each reduced the remaining value by one. This is the observed portal/IP allowance. It is shared with other City dataset requests and is not a dedicated guaranteed quota for every source.

The sensor connector's default production transport now fetches an independent count and the official complete JSON export. At 6,324 records, the former 100-row pagination required 64 requests per snapshot. A two-minute schedule would have required 46,080 requests daily before retries. The new transport uses two requests per snapshot, or 1,440 requests daily. Count drift, duplicate identities or malformed records fail the whole collection. Production count/export/metadata calls disable redirects and use one attempt. Injected OpenDataSoft clients remain supported for existing callers and tests; the production default uses the bounded export.

| Source | Proposed schedule | Requests per execution | Proposed operational daily cap | Raw retention | Staging retention |
| --- | --- | ---: | ---: | ---: | ---: |
| Bays | Daily | 2 | 20 | 0 | At most 1 day |
| Sensors | Every 2 minutes | 2 | 2,160 | 0 | At most 1 day |
| Restrictions | Daily | 3 | 30 | 0 | At most 1 day |

Restriction collection also reads official dataset metadata and preserves its old revision. HTTP representation timestamps cannot turn a 2022 rule dataset into current legal evidence. The root integrator must enforce the reviewed shared City allowance across enabled sources, runtime caps, scheduler frequency and BigQuery scan limits.

The live normalized NDJSON sizes below include source and batch references, so they approximate staged bytes rather than BigQuery logical or billed bytes.

| Source | Source facts | Geography | Provenance links | Bay/observation/rule facts | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bays | 22,107,801 | 0 | 0 | 17,596,566 | 39,704,367 |
| Sensors | 4,635,183 | 6,429,857 | 3,749,514 | 2,664,908 | 17,479,462 |
| Restrictions | 3,175,752 | 7,355,826 | 4,844,171 | 5,738,114 | 21,113,863 |

A two-minute full sensor write would create about 12.59 GB of the original normalized bytes daily. The runtime now writes full snapshot membership with individual refresh clocks and appends business facts only when their content changes. The root integrator owns 24-hour membership and 48-hour business-history cleanup, preserving the latest complete snapshot and every exact business reference it still needs. That preservation also applies while collection has stopped longer than 24 hours. The integrator must verify retention cleanup, clustered query limits and actual dry-run bytes before continuous activation. The AUD 100 monthly project budget remains the shared limit.

## Changed facts and complete membership

`normalization/parking-runtime.ts` exposes `withPublishedParkingState(result, config, bigquery)` for the common ingest runner. It restores at most 50,000 exact published business references from the latest complete snapshot. The October 1 cost revision first discovers its published batch ID, then supplies that constant as `@batchId` when reading the clustered membership table. It validates the exact snapshot proof, exact business source/version and business batch publication. It can recover while public source status hides the sensor view. A complete empty snapshot returns empty history rather than reviving an earlier snapshot.

`assembleParkingRuntime({result, history, licenseStatus})` separates two facts:

- The content hash includes sensor identity, reported status, status-change time, coordinates, marker/bay keys and zone. An unchanged upstream `lastupdated` heartbeat does not create a new business version. A changed location or zone does create one. The immutable generation hash also records the first real upstream `lastupdated` and preceding version for that business change. A location returning from A to B to A gets a new generation with the same content hash, rather than rewriting the first A version.
- Every complete source read appends one source snapshot proof and all `parking_sensor_memberships`. Membership stores the actual individual `lastupdated` and exact business batch/source/version references. Changed source/geometry/observation/provenance facts use the same generation version. Unchanged business facts retain the original published batch reference.

All source facts derive rights from their own reviewed manifest. The snapshot proof takes an explicit effective `licenseStatus`; an empty snapshot does not obtain permission from a nonexistent first business record. Source `observed_at` remains the actual status-change timestamp. The business version's `source_updated_at` is the first real upstream refresh seen when that version changed; subsequent refreshes live only in membership. No collection timestamp replaces either upstream clock.

Two final public full reads at `2026-10-01T11:32:51.275Z` and `11:32:52.663Z` each covered all 6,324 sensors. The first used empty local history and produced 6,324 business versions, one proof and 6,324 memberships, totaling 21,979,432 staged NDJSON bytes. The second reused exact references from that local read and appended one verified proof plus 6,324 memberships, totaling 4,831,716 bytes. It appended zero business source, geometry, observation or provenance rows. This demonstrates the local delta behavior; the history in this experiment was not a real published BigQuery batch. The second read represents about 3.48 GB of membership NDJSON daily before actual business changes, rather than the original full-row write rate. BigQuery logical and billed bytes still require cloud readback and dry runs.

## Queryable baseline

- `v_parking_current` returns surveyed bay points and exact source references. The official survey warns about unmapped bays and removed bays still appearing. A point does not establish current public accessibility.
- The new `v_parking_sensor_current` follows the latest complete published membership and dereferences exact business facts across published batches. A missing sensor in a new complete snapshot disappears from this view. A failed refresh leaves the last published membership, and a published empty snapshot clears it. Conflicting readings and coordinate versions return unknown values. Observations require their exact published source record version, and a withdrawn source cannot revive an older reading. The view retains old confirmed facts with stale labels during an outage and exposes business references for a fresh runtime process.
- `status_changed_at` retains the publisher's `status_timestamp`. `source_updated_at` retains `lastupdated`, which is the individual sensor refresh time. A stable occupancy state can have an old status-change timestamp and a current refresh. The independent sensor view computes source freshness using the individual refresh and latest successful source check. It preserves the status-change time separately.
- The new `v_parking_rule_reference` exposes exact source-linked normalized rule slots, including original URL, old dataset revision and missing validity. It labels current applicability and sensor joins as unverified.

The sensor view includes City attribution, licence and holiday evidence links, operating caveats, reported occupancy and separate freshness. It uses the [official Business Victoria 2026 calendar](https://business.vic.gov.au/business-information/public-holidays/victorian-public-holidays-2026), reviewed on 2026-10-01. It covers only 2026 within City of Melbourne; other years remain unknown until the calendar is reviewed and updated. The publisher says sensors do not operate on public holidays and can report construction-blocked bays as vacant. Holiday or unverified holiday operation makes occupancy freshness unknown. Construction obstruction remains possible on every day.

No current source exports the documented `marker_id` / `bay_id` crosswalk. The location and independent sensor queries can be published without inventing that mapping. No new view returns `may_park_now=yes`; restrictions remain reference evidence with unverified current applicability. The 30 complete-bay legal samples required by SC-005 still depend on current authoritative mapping, rule validity and public-access evidence.

## Verification and integrator handoff

- Node.js 24.21.0 passed all 84 targeted parking connector and normalization tests, including export request bounds, count-drift rejection, official metadata revision preservation, cold-process delta/history restoration, private recovery, version generations, uncertainty and parking rule behavior.
- Actual BigQuery read-only tests passed 2/2, with no skipped checks: existing parking SQL provenance and the new independent sensor SQL. Six fixture queries verified omission, empty snapshots, sensor movement, exact source provenance, withdrawn rights, old status changes with fresh individual updates, conflicts, future clocks, stale updates, Melbourne calendar dates and unknown future calendar coverage.
- New SQL views require authorized-view grants and deployment alongside existing parking SQL. They have not been deployed by this subagent. Source runtime identities, cloud image, initial publication, scheduler activation, retention enforcement and live-query readback belong to the root integrator.
- The whole-project type check passed after the shared membership seam and generation/state-hash fields were present. The integrator must rerun the final check after all shared code is complete. This report does not certify SC-002 continuous operation or SC-005 current legal parking acceptance.

The local public-read aggregate evidence is `/tmp/melens-parking-release-probe-summary-20261001.json` and `/tmp/melens-parking-delta-final-probe-summary-20261001.json`. They contain counts, dates and byte totals; no raw source rows or credentials.

## History query cost revision

The root integrator's third sensor run measured history query billing of 62,914,560 bytes for 15,843 processed bytes. The public sensor view touched six tables, so table minimum billing dominated. This measurement appears in `/tmp/melens-sensor-third-breakdown-20261001.json`.

The revised history reader submits two bounded queries:

1. Read `sync_batches`, collapse state transitions and select the latest published batch. Failed newer batches cannot replace it. No recent-date filter discards recovery state during an outage.
2. Read only `parking_sensor_memberships` for the constant source and batch, `source_records` for its proof and exact referenced business batches, and `sync_batches` for those business publication states. No public-view, geography, occupancy or registry table participates in this recovery query.

The expected minimum is 40 MiB across both queries, saving 20 MiB per two-minute run versus the measured 60 MiB history query. This is a table-minimum estimate; the root integrator must verify actual bytes and runtime with the final image. The 120-second collection frequency remains unchanged.

Before reusing any reference, the reader requires equal batch input/output counts, exact membership count and complete valid history count. It requires one active permitted snapshot proof with the batch's `source_revision`, and active/corrected permitted business references in published batches. Conflicting status or rights for an identical source/version are rejected; identical source-record retries are collapsed. Missing proof, missing business facts, duplicate sensor identities, malformed references and oversized history fail the run instead of becoming empty history. A real complete empty snapshot still requires its permitted proof.

The final local type check and 14 runtime unit tests passed. Those tests use a narrow fake query reader without a GCP SDK instance or ADC access. They cover constant query scope, capped bytes, unchanged generation reuse, cold storage, hidden and old published state, empty snapshots, omitted members, rejected missing/withdrawn proof or business references, ambiguous persisted membership and secret-free query errors. The earlier real retention fixture passed 4/4 and cleaned its uniquely owned resources, but it predates this query revision; it does not certify the revised SQL's cloud billing or execution.
