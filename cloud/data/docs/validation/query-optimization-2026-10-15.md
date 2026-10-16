# Query optimization review, 2026-10-15

This document records the historical assessment and release based on `2f0374a`. It does not verify the later main integration. Commit `22b5101`, now included in main `c396bad`, adds the physical Geo current copy, cross-request layer cache and parallel map layer reads. The unimplemented architecture statements below describe the earlier assessment only. GCS delivery and a latest-record-rights index remain separate work.

At that baseline, general Geo reads derived current rows from retained history. This was the main measured scan cost. This pass implemented smaller key-matching work, narrower detail rechecks, request reuse within an agent turn, and Feed request cancellation with a 250 ms delay.

The sections below separate implemented code, read-only measurements and proposed architecture. Measurements and local checks do not establish cloud release acceptance. The later development release evidence is recorded at the end of this document. Parking is outside this task and belongs to a separate session. Its earlier measurements remain only as baseline context.

## Measured baseline

At `2026-10-15T15:02:44Z` (`23:02:44` Shanghai), the current compiled fixed queries were dry-run against the currently deployed BigQuery views. The fixture used a CBD box `[144.95, -37.825, 144.98, -37.8]`, a current 15-minute window and a 1,000-row limit. No business query was executed for these estimates. The audit used a 1 GB dry-run ceiling and left runtime configuration unchanged. The shared library default is 100 MB. The existing local development supervisor supplies a 1 GB override; the default column below is not the active local runtime limit.

| Fixed query | Estimated processed bytes | Library default ceiling |
| --- | ---: | ---: |
| Planning, disruption, event or news viewport, each | 574,914,998 | 100,000,000 |
| Planning or news public-record recheck, each | 475,414,460 | 100,000,000 |
| Parking viewport | 3,193,050 | 100,000,000 |
| Parking public-record recheck | 3,193,050 | 100,000,000 |
| Source coverage | 1,218,884 | 100,000,000 |

The public-record dry runs used a synthetic nonexistent key. These numbers are scan estimates, not returned-row counts or billed-byte measurements. Clustering can make actual work differ. Smaller pages and a narrow box did not remove the Geo estimate. A nonempty Geo layer can therefore require about 1.05 GB of estimated work for its first read and recheck together.

A separate actual 324-key Geo public-record job processed 574,913,253 bytes, used 194,403 slot-ms and took 3,540 ms. Its metadata is in `nonparking-query-benchmark-2026-10-15.json`. This actual-key sample and the synthetic-key dry runs are different measurements.

The pedestrian dry run failed because the deployed view lacks `source_record_id`. This is a deployment-contract mismatch. It gives no pedestrian cost measurement. Validate the corrected view contract before measuring that path.

A separate bounded `INFORMATION_SCHEMA.JOBS_BY_PROJECT` read measured successful SELECT jobs in the preceding two hours. This includes development tests and audits. It is not a production traffic forecast.

| Query family | Jobs | Processed bytes | Billed bytes | Mean query duration |
| --- | ---: | ---: | ---: | ---: |
| Geo current | 136 | 76,212,871,794 | 76,296,486,912 | 3,427 ms |
| Publisher validation | 340 | 63,025,741,453 | 63,399,002,112 | 1,263 ms |
| Parking history recovery | 61 | 16,651,104,220 | 16,678,649,856 | 1,932 ms |
| Parking current | 62 | 196,509,782 | 1,950,351,360 | 2,645 ms |
| Source coverage | 109 | 130,223,623 | 2,285,895,680 | 427 ms |

Parking recovery averaged about 273 MB per job. Parking current averaged about 3.17 MB processed, but 30 MiB billed. Further reducing its few MB will not by itself remove the observed small-query billing overhead. The local publisher improvements have not been deployed, so these job totals do not measure their effect.

## Implemented changes

### Distinct typed keys for non-parking rights rechecks

`cloud/shared/src/query/public-record-queries.ts` now parses the requested keys into a distinct relation and uses an equijoin. Geo and boundary match source, record ID and exact version. Pedestrian matches source, sensor and observation time. Pedestrian converts observation times to `TIMESTAMP` before `DISTINCT`, so equivalent UTC spellings cannot duplicate a returned row.

The queries still read the same approved views. Their latest-record permission gates, lifecycle predicates, projections, ordering, deadlines, byte ceilings and row limits remain in place. No successful permission check is reused across map requests. The parking branch was not changed by this task.

The actual 324-key planning comparison used `melbourne.development_monitor`, disabled the query cache, and returned the same 324 rows. Both result hashes were `370ad67376004e0c68fed7abdcf0f1042596826e9e15128f8ddd80f606ab78db`. Raw metadata is in [the live comparison](nonparking-public-record-key-join-live-ab-2026-10-15.json).

| Measurement | Correlated EXISTS | Distinct typed JOIN |
| --- | ---: | ---: |
| Processed bytes | 497,046,859 | 497,047,025 |
| BigQuery job duration | 3,651 ms | 3,280 ms |
| Slot time | 213,680 slot-ms | 168,086 slot-ms |
| Client wall time, including setup and metadata requests | 8,458 ms | 11,743 ms |
| Returned rows | 324 | 324 |
| `cacheHit` | false | false |

The original JSON stage processed 92,713 rows and used 31,010 slot-ms. The revised JSON stage read one parameter row and used 33 slot-ms. A later hash join used 6,926 slot-ms. This pair shows less compute work. It shows no scan reduction or client wall-time improvement. The scans differed by 166 bytes. The live source state was not frozen between the two jobs. It is one A/B pair, not a p95 or load measurement.

The earlier zero-table-scan fixture used 4,000 rows and 1,000 keys. Both forms returned the same 989 rows. EXISTS used 3,149 ms and 7,902 slot-ms; JOIN used 253 ms and 95 slot-ms. This isolates key-matching work. It does not measure retained-history scans. See [the earlier audit](nonparking-query-benchmark-2026-10-15.json).

`cloud/shared/test/public-record-key-joins.test.ts` executes the generated SQL against BigQuery CTE fixtures. It checks mismatched sources and versions, absent revoked rows, duplicate keys, equivalent UTC spellings, invalid timestamps, and current versus historical lifecycle filtering. The focused run passed all 7 tests with the opt-in BigQuery test enabled. No cloud table was created or updated.

### Details recheck only the non-parking records used by their response

`cloud/map/src/services/details.ts` now sends an ordinary non-parking detail's target record to `assertSnapshotRecordsPublic`. An aggregate detail or member page sends every original member in that group, including members outside the displayed page. Unrelated groups do not add record queries.

`cloud/map/src/services/viewport.ts` still checks every source watermark in the stored snapshot. It still rejects source withdrawal and changed publication. Viewport and unlocated continuation pages retain their full snapshot recheck. Parking detail and member reads retain their prior full snapshot path.

The Node 24.18.0 isolated check passed 66 related tests. Cases include requested-record withdrawal, unrelated-record withdrawal, source withdrawal, changed publication and a withdrawn aggregate member outside the current page. No real BigQuery latency or scan reduction was measured for this detail change.

### One complete feature read can serve matching requests within one agent turn

`cloud/agent/src/features/turn-search.ts` shares the same pending or completed read for one `TurnRegistry` and reader instance. Its key includes exact bounds, sorted layers, mode and UTC-normalized time bounds. Microsecond differences remain distinct. Default non-parking query windows use one pinned turn instant. Each tool caller still applies its own keyword and result limit.

The new reader cache removes rejected, unavailable and partial results. A new turn or reader makes a new read. Abort cancels the shared underlying request. Requests containing parking keep their direct path. This is not a shared cache across users or turns.

`cloud/agent/test/feature-search.test.ts` has 8 focused cases. Its fake-query adapter shows that 30 unknown event IDs use one coverage query and one layer query, with two dry runs. This is a deterministic query-count result, not a live BigQuery cost measurement. Existing `runTool` memoization is separate and can retain an unavailable tool result. Therefore the retry claim applies only to the new reader cache, not every tool invocation.

### Feed cancels obsolete requests and waits 250 ms before starting map work

`app/lib/features/feed/state/feed_providers.dart` now creates a `MapRequestCancellation`, cancels it on provider disposal, and passes it to `queryViewport`. It checks cancellation after catalog loading, after the 250 ms delay and after the response. An empty layer key returns without a map query. Subscription changes during the delay prevent the obsolete query from starting. Disposal also cancels a request that already started.

The final focused Feed, card and shell run passed 47 tests after the scoped, persisted Feed update on main. It includes debounce/cancellation cases, 3 original-record navigation regressions, and an independent unlocated-list snapshot check. The delay adds 250 ms before a normal Feed map request. It avoids obsolete requests; it does not make the surviving BigQuery query cheaper. No production request-count or latency reduction was measured.

## Architecture proposals before 22b5101

### Order of work for the proposed query redesign

First prototype the non-parking current table and latest-rights index. Compare the same source publication, viewport and exact record keys. Measure scan bytes, billed bytes, job duration and HTTP p50/p95 separately. The current measurements do not establish a universal 0.5–1 second minimum for a BigQuery job, or prove that the replacement will respond below one second.

Skipping a hot-path dry run is a separate option for trusted fixed templates. A dry run validates SQL and estimates bytes without executing a second full scan, charging query fees or using query slots. Keep `maximumBytesBilled` on the actual job, as well as deadlines, parameter validation and result limits. The current agent uses fixed parameterized queries; this pass did not add a free-SQL execution interface. No dry-run removal was implemented. See [dry runs](https://docs.cloud.google.com/bigquery/docs/running-queries#dry_run) and [cost controls](https://docs.cloud.google.com/bigquery/docs/best-practices-costs).

Bounded parallel layer reads can reduce sequential waiting. They do not reduce the total scans by themselves. A reusable layer cache also needs the source publication and rights generation, mode, time window, filters and schema version in its identity. Cache a complete spatial cell, then apply the exact requested viewport. Do not reuse a partial response as a complete cell. This pass did not add cross-request layer caching or parallelize the layer loop.

Evaluate GCS delivery after the current-table prototype supplies measured scan and latency results. Treat sub-second and tens-of-milliseconds values as targets until cold starts, concurrent readers, publication changes, expiry and withdrawals pass real acceptance. The parking history proposal is excluded from this task.

The agent feature reader also creates a BigQuery adapter directly in `cloud/agent/src/features/reader.ts`. A GCS cache confined to `cloud/map` would leave those agent reads unchanged. A later delivery design must cover both consumers. A current-state snapshot also cannot replace historical queries; retain an explicit history path and keep account-owned event reads behind their existing authorization.

### Entity current table and latest-rights index

A general Geo current table remains the highest scan-reduction candidate. `cloud/data/sql/002_core_views.sql` still derives current rows from `v_geo_records_history`. Typed key joins do not remove that scan. No new general entity current table or latest-rights index was implemented in this pass.

A later design can maintain source-scoped current rows and a small latest-record-access index during publication. Readers must continue to use approved public views. Promotion must occur only after batch validation and publication. Failed batches leave the prior current state. A complete empty snapshot removes its members. Older backfills cannot replace a newer source snapshot. Equal provider-clock conflicts must fail closed. Retain withdrawal tombstones, exact versions and source-specific membership. Apply Ticketmaster's 24-hour and GDELT's 30-day visibility limits at read time. Keep history for historical queries.

A scan below 100 MB is a target, not an observed result. The current roughly 500–575 MB samples show the opportunity. A prototype must prove its own scan reduction and permission behavior.

### GCS query snapshots need an explicit publication and rights protocol

Serving prepared public results from GCS is a separate, unimplemented architecture option. It can reduce repeated BigQuery reads only after the producer creates and validates the required result sets. It introduces object publication, invalidation and storage costs that were not measured here.

The design needs immutable result objects, exact record/version references, schema and source publication versions, coverage bounds, retention limits and a rights generation. Readers must reject objects whose current source or record rights cannot be proved. A cached public object or long-lived public URL must not continue serving a withdrawn record. A TTL alone does not establish timely revocation.

Publish the complete object set first. Then replace one manifest pointer using the prior pointer's `ifGenerationMatch` condition. The manifest must bind object names and generations, so a reader cannot combine old metadata with replacement bytes. A failed or conflicting promotion leaves the old pointer unchanged. Cloud Storage provides atomicity for individual objects, not a multi-object batch transaction. Generation preconditions reject a stale update with HTTP 412. See [request preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions) and [consistency and atomic operations](https://docs.cloud.google.com/storage/docs/consistency).

No GCS serving path, rights-generation store or manifest publisher was added by this task.

### Spatial layout must use supported clustering types

Raw latitude and longitude stored as `FLOAT64` cannot be BigQuery clustering columns. The supported list includes `GEOGRAPHY` and `INT64`, but excludes `FLOAT64`. A later table can cluster by `GEOGRAPHY`, or use an integer cell key for candidate selection and retain an exact spatial predicate. The cell scheme, precision and source/type ordering require measurements. Clustering does not promise a useful reduction for a small table. See [cluster column types and ordering](https://docs.cloud.google.com/bigquery/docs/clustered-tables#cluster_column_types_and_ordering).

### Bound publisher and pedestrian history without losing corrections

The publisher change supplies chunk-local logical IDs and accounts for repeated IDs in the request-size budget. Further partition pruning needs a separate measurement. Keep checks for unexpected current-batch rows in other partitions and historical conflicts for the affected logical IDs. Do not weaken replay, publication or withdrawal checks to obtain smaller scans.

Pedestrian filters `observed_at`, while its fact table is partitioned by `fetched_at`. An observation-date query table is another later option. It must retain late arrivals, corrections, exact location versions and full-window coverage. Latest permission checks must also see withdrawals after the requested window. Adding `fetched_at >= @from` is not safe.

Parking recovery and current-table work are excluded. They belong to the separate parking session.

## Cache counters and measurement limits

Queries that use `CURRENT_TIMESTAMP()` or `CURRENT_DATE`, including through their logical view definitions, cannot rely on ordinary BigQuery result-cache reuse. Changed referenced tables also invalidate cached results. This is why current permission checks must not depend on an assumed cache hit. The benchmark explicitly sets `useQueryCache=false`. See [BigQuery cache exceptions](https://docs.cloud.google.com/bigquery/docs/cached-results#exceptions_to_query_caching).

The app's model-usage `cached` counter is different. `cloud/agent/src/agent/usage.ts` maps Gemini `cachedContentTokenCount` to `cachedInput`; the chat displays that number. `cached=0` means this counter contains zero cached prompt tokens. A missing upstream count also maps to zero. It says nothing about BigQuery's `statistics.query.cacheHit`, the source-coverage cache or turn-level feature reuse. See [Gemini usage metadata](https://ai.google.dev/api/generate-content#UsageMetadata).

The map service already caches source coverage for 30 seconds and merges concurrent coverage requests. It already stores bounded snapshot pages. Neither feature was introduced by this optimization pass. Live public-record checks remain separate.

The earlier 39.882 ms local CPU result used host Node 26.7.0, 1,000 synthetic parking rows and fake I/O through the real runner. It is not Node 24 profiling, real BigQuery latency or evidence for this non-parking release. Parking observations in the baseline are not new acceptance work.

## Local verification and release boundary

The root agent reported these complete local runs after syncing main to `2f0374a` and integrating the fixes:

| Check | Result |
| --- | --- |
| Shared tests | 127 passed; 1 opt-in BigQuery test skipped by the default run |
| Map tests | 100 passed |
| Agent tests | 62 passed |
| Flutter tests | 503 passed after the tooltip semantics correction |
| Flutter analysis | No issues |
| Focused Feed, card and shell tests | 47 passed |
| Focused detail tests on Node 24.18.0 | 66 passed |
| Focused non-parking key tests with BigQuery enabled | 7 passed; no skips |

The default shared skip does not represent a failed fixture. The separate guarded run executed that BigQuery test successfully. These test counts describe local code verification. They do not identify a deployed image, served SQL definition or completed cloud acceptance.

Release acceptance must record the actual image/revision and view definitions. It must compare the same source state, viewport, keys and time window with query caching disabled. Record processed and billed bytes, job count, slot-ms, BigQuery job duration and HTTP latency separately. Check exact rows, source and record withdrawal, snapshot consistency, empty snapshots, failed refreshes, older backfills, late corrections and aggregate membership. Keep dry runs, byte ceilings, deadlines and result limits. Raising a ceiling alone does not fix query growth.

Google recommends examining execution stages and reducing repeated transformations. A CTE alone does not guarantee reuse. See [query computation guidance](https://docs.cloud.google.com/bigquery/docs/best-practices-performance-compute). Cancellation remains best effort and can still incur costs; avoid redundant submission before relying on cancellation. See [job management](https://docs.cloud.google.com/bigquery/docs/managing-jobs#cancel_a_job).

## Historical development release acceptance, 2026-10-16

The final release uses main `2f0374a52a0ff56bb460b5257dabc2f46f32e63c` and dirty app source `32c674bc8576984a1ab847a06960b4ab2be4fbe7b5fade49e0de16117975485e`. A fresh remote fetch still matched this main after the tests. Hosting version `1aab647267b914fb` serves bundle `1956e0ea7779e6368cbba4229f5f41322e7068726223d87e96c1f51e943344bd`. The verified backends are map `melens-dev-map-00009-4xs` and agent `melens-dev-agent-00009-vzf`, each with 100 percent traffic and the tested immutable image. Full image identities are in [the release summary](../../../../app/e2e/verification-release-2026-10-16.json).

The selected functional browser scope passed 26 local cases and 6 cloud cases. Four additional input cases passed and are not added to those totals. The five main suites each bind the generated run ID and time window to raw before/after HTTP manifests and actual JavaScript hashes. The cloud suites use real Firebase authentication, published planning/news records, BigQuery reads and Gemini calls. The test-created session IDs, Feed IDs and local event IDs were removed. The Feed API cannot restore a fresh account's original null list; its default CBD list remains. These results do not establish all-source admission, ingestion, a live anomaly producer, load performance or p95 latency.

Four reviewed non-parking view definitions were applied and read back. See [the SQL migration evidence](nonparking-sql-migration-readback-2026-10-15.json). A separate bounded metadata query found 43 successful SELECT jobs under the map runtime service account and 4 under the agent account during `2026-10-15T17:03:25.525Z` to `17:09:40.446Z`. All 47 had `cache_hit=false`. See [runtime job evidence](nonparking-runtime-jobs-2026-10-16.json). These are acceptance-traffic measurements, not a production forecast. Metadata alone does not bind an individual job to an HTTP request or image revision.

The app correction stabilizes route semantics when a Tooltip appears. A separate first-input race in the pinned Flutter SDK remains unresolved. Functional input tests wait for two animation frames after tap, verify the same input still has focus, type once and compare the complete value. This is driver synchronization, not an SDK repair. [The input verification note](../../../../app/e2e/flutter-input-verification-2026-10-16.md) preserves the negative evidence and the limits of that synchronization.

At this historical release, the general physical current table, latest-rights index, GCS serving path, cross-request layer cache, layer-loop parallelism and dry-run removal were unimplemented. The current-table, memory-cache and parallel-read status changed in `22b5101`. Fresh main-integration tests must verify that implementation together with these fixes.
