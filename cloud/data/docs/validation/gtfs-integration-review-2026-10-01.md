# GTFS integration review, 2026-10-01

Update: the later [GTFS runtime integration](gtfs-runtime-2026-10-01.md) adds a production caller and verifies per-mode complete-snapshot membership with real GoogleSQL. The engineering findings below describe the earlier review. Actual provider version evidence, source admission and live joint acceptance remain separate gates.

This review covers the root-owned alert matcher and the remaining T066/T069 integration gates. Transport Victoria connector files and fixtures are assigned to Gemini and were read without edits. No credentials, live response bodies, or cloud resources were accessed or changed by this review.

## Verified behavior and correction

The matcher accepts a realtime `header.feed_version` only when it agrees with the publisher's static `feed_info.feed_version`. This follows the [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/#message-feedheader). The HTTP archive validator is a different kind of version and cannot establish this agreement. The official static reader currently returns an `archive-sha256:` revision; its mode archives lack `feed_info`, so live alert locations remain `version_unverified`.

The matcher previously ignored `TripDescriptor.start_date` and `start_time`. A fixture with an impossible time and an unrelated service date still produced `located`. GTFS requires all supplied selector fields to match, and trip instances can require a service date and start time. See the [EntitySelector and TripDescriptor definitions](https://gtfs.org/documentation/realtime/reference/#message-entityselector).

The root-owned correction in `src/normalization/gtfs-alerts.ts` now validates date/time syntax at the summary boundary. Invalid dates or times produce `invalid_alert`. Syntactically valid instance constraints produce `trip_instance_unverified` because the current static snapshot does not preserve calendar and frequency evidence. The original alert and its source links remain available without coordinates. Unconstrained matching stop/route/trip IDs retain their existing behavior. A matched stop alongside an unverified instance also remains unlocated.

Verification used Node.js 24.21.0, compiled the current TypeScript project into an isolated temporary directory, and ran `test/normalization/gtfs-alerts.test.ts`. All 11 tests passed. Root subsequently aligned the P0 and GM-26 positive stop-selector fixtures by clearing their two trip-instance constraints. The full suite passed 457 tests with six opt-in cloud tests skipped and zero failures. Instance constraints remain covered by the matcher tests and never generate a point without supporting evidence.

## Remaining connector corrections for Gemini GM16

These findings refer to the source as read on 2026-10-01. Line numbers can move when Gemini edits the connector.

### Repeated alert content changes an immutable row

At `src/connectors/tv_gtfs_realtime/index.ts:317`, the alert version is computed as `sourceVersionId(null, alert)`. The same alert in a later feed therefore keeps the same version. However, its `SourceRecord.source_updated_at` at line 326 and its `GeoRecord.summary.feed_timestamp` at line 331 change with the feed. Those fields are part of published immutable content. `src/core/publisher.ts:48` only excludes audit fields, and its cross-batch conflict check at line 434 rejects two different contents for the same key.

A read-only reproduction normalized the same synthetic alert twice with increasing feed timestamps. It produced:

| Check | Result |
| --- | --- |
| Same alert `version_id` | true |
| Changed summary | true |
| Changed upstream timestamp | true |

The connector owner should include every persisted source fact in the version. A scoped change is `sourceVersionId(update, { mode: feed.mode, feedVersion: feed.parsed.feedVersion, alert })`. Audit fetch times must remain outside this content identity. Add a repeated-feed test that publishes the first and later timestamp, then replays the latter without creating conflicts or additional logical versions.

### Source revision does not identify both mode snapshots

At `src/connectors/tv_gtfs_realtime/index.ts:388`, `sourceRevision` is only the maximum timestamp across Metro Train and Yarra Trams. The lagging mode can advance while remaining below the other mode's timestamp. Batch content then changes without a new source revision.

The connector owner should derive the revision from a canonical combination of both mode identities, timestamps, publisher versions, and alert contents. `sourceLatestUpdateAt` can still report the maximum source timestamp. Repeating the same two feeds must retain the same revision; advancing either mode must change it. Parent feed versions at lines 302–304 should also account for payload revisions rather than only alert IDs.

## Remaining shared integration gates

- `joinGtfsAlertLocations` and `compareFullGtfsSnapshots` currently have no production caller. A runtime enrichment step must load an admitted static snapshot and preserve the exact static source-record versions used by the matcher. If publisher version evidence is absent, it must preserve the alert with `version_unverified` and no point.
- The current view in `sql/002_core_views.sql:104` applies complete-snapshot membership only to `melbourne.development_monitor`. A GTFS alert omitted from a newer FULL_DATASET can remain current indefinitely when its impact end is unknown. Current GTFS membership must use the latest successful upstream snapshot for each mode, including an empty mode snapshot. Failed or older backfill snapshots must not replace it. Disappearance must preserve history without creating a cancellation fact.
- Version evidence must remain per mode. The current static reader flattens train/tram records, and duplicate matching `feed_info` rows do not prove that each mode supplied that version. Any future versioned reader must preserve the archive member and publisher metadata relationship. Current absence of this evidence cannot be repaired by reusing the archive validator string.
- A live access probe can prove that both protobuf endpoints are readable and parse completely. It does not prove repeated BigQuery publication, source admission, current-snapshot disappearance, or versioned location enrichment. T069 still requires those separate data/query checks for its chosen P0 sources.
- Bus Service Alerts are not among the two advertised alert endpoints. The absence of bus records must remain an explicit coverage gap.

T066 and T069 remain incomplete. This correction closes a matcher correctness gap without claiming a provider version or a live point join that has not been established.
