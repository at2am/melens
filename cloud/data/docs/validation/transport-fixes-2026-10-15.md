# Transport corrections after main synchronization, 2026-10-15

This verification uses main `3ce880444d23094cd86af2635a444cd253f0a902`. The earlier checkout's transport changes were reviewed against this main before migration. Main had no intervening changes in the affected transport connectors, runtime helper, or views 002 and 007. The changes below use the current files and preserve the new shared query architecture and live-parking implementation.

## Existing correct behavior

Main already versions alert facts with their upstream feed timestamps and hashes both mode snapshots into `sourceRevision`. It already supports mode-specific disappearance, empty snapshots, failed refreshes, and older backfills. Planned-road local clocks use Australia/Melbourne and retain ambiguous DST clocks as null. Unplanned-road offsetless clocks remain unverified. These behaviors did not need replacement.

## Migrated corrections

- Generic and official nested static ZIP readers reject duplicate GTFS table names instead of silently selecting a table.
- A `stop_times` row with an unknown trip rejects the complete snapshot instead of disappearing during normalization.
- Realtime enrichment verifies the parent timestamp against its ID and verifies each alert's exact mode-parent membership before loading static references.
- The GTFS current-view block excludes a mode when its latest provider timestamp has conflicting FULL_DATASET parent versions. Identical repeated parent versions remain valid. A non-correlated `STRUCT IN` membership query supports the snapshot window functions without changing the other sources' membership rules. The earlier broad current-view rewrite was not migrated.
- Planned and unplanned roads reject verified absolute report/update timestamps more than five minutes after the fetched snapshot time. This is the existing private probe's Melens clock-skew rule. Planned start/end values and unplanned estimated end/update values may remain in the future.
- Unplanned roads retain raw `lastClosed` and explicit Inactive status, keep `valid_to` null, and identify the conflicting provider field definitions in the missing-time reason. Policy `explicit-offset-closure-unverified-road-v3` avoids reuse of an earlier immutable content version.
- View 007 preserves provider-derived `record_status`. Its separate `time_state` reports a future schedule.
- Synthetic SQL tests now replace parking memberships with an empty typed fixture and reject any remaining production table references. Before that correction, they attempted to scan an unrelated live table and exceeded the unchanged 100 MB query ceiling.

## Verification on synchronized main

Node.js 24.18.0 compiled TypeScript into an isolated temporary output directory. The production `dist` directory was not used by this pass.

- 105 focused GTFS connector, runtime, matcher, and road connector tests passed.
- 22 offline P0, US1, and US4 integration tests passed. The separate US4 acceptance test that creates cloud resources was not enabled.
- Four read-only BigQuery tests executed the actual production SQL using only synthetic tables. GTFS membership/conflicts, road snapshot behavior, development snapshot behavior, and provider status preservation all passed. Each query retained its 100 MB billed-byte ceiling and disabled the result cache.
- `git diff --check` passed.

No source was admitted. No source batch or view was deployed. No schedule or cloud permission was changed.

### Later development view deployment

The root release subsequently updated four non-parking view definitions after syncing to `2f0374a`. This includes the reviewed Geo GTFS ambiguity rule and transport status projection. [The migration readback](nonparking-sql-migration-readback-2026-10-15.json) records the applied definitions and unchanged authorization tuples. This later step did not deploy the connector changes, admit transport sources, collect source batches or enable their schedules. The earlier local and fixture results remain separate from real source acceptance.

## Remaining provider evidence

GTFS location enrichment still requires evidence connecting each mode archive to its publisher `feed_info.feed_version`. An HTTP archive validator cannot supply that relationship. Missing evidence leaves mappings `version_unverified`. See the [official GTFS protocol](https://github.com/google/transit/blob/master/gtfs-realtime/proto/gtfs-realtime.proto).

Unplanned-road offsetless timestamps still need a provider timezone statement. The [unplanned dictionary](https://opendata.transport.vic.gov.au/dataset/unplanned-disruptions-road/resource/1b185c7f-d4b2-404d-a65c-b5a80da7582d) also gives conflicting descriptions for `lastClosed` and `lastActive`, so absolute closure times remain unavailable pending clarification. The [planned dictionary](https://opendata.transport.vic.gov.au/dataset/planned-disruptions-road/resource/337dcdcd-defd-427f-b3f7-e06954b853d8) defines Pending and Active. Additional defensive fixture states do not establish provider semantics.

Real source publication, source admission, shared KeyID quota coordination, deployed views, and client end-to-end coverage remain separate acceptance work.
