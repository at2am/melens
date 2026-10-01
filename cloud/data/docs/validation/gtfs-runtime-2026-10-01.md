# GTFS runtime integration, 2026-10-01

## Changes

`src/core/gtfs-runtime.ts` supplies the production enrichment step after a successful realtime collection and before publication. It requires both complete mode snapshots and an upstream timestamp on each mode's parent source fact. It reads static references only from published batches belonging to an admitted, active source, under an explicit BigQuery billed-byte ceiling and a 50,000-reference bound. Static route links must resolve to the exact source-record versions in the same published batch. The matcher receives those original versions; the loader does not regenerate provenance hashes.

Static stop summaries now retain structured references using approved stop, route and feed fields. The current official reader supplies no proven relationship between a mode archive and its publisher `feed_info`. Its references therefore explicitly carry null publisher mode/version evidence. They remain unlocated when used by the runtime. No source admission or retention permission was changed. Agency selectors, trip selectors and trip-instance constraints still need evidence not present in this retained reference; they are never silently dropped.

`sql/002_core_views.sql` now uses the latest published parent snapshot separately for Metro Train and Yarra Trams. A parent fact is present even when that mode's successful feed contains zero alerts. Membership requires the exact parent source-record version and derived geographic-record version. Failed refreshes and older upstream snapshots cannot replace a newer mode snapshot. A disappearance removes current membership while all published historical alert facts remain available with their original status.

This follows the [official GTFS Realtime protocol](https://github.com/google/transit/blob/master/gtfs-realtime/proto/gtfs-realtime.proto): realtime `feed_version` identifies the corresponding publisher's static `feed_info.feed_version`; the archive validator is a separate value. A FULL_DATASET feed describes its current entities, while `is_deleted` belongs to incremental updates. Disappearance does not supply a cancellation fact.

## Verification

- Node.js 24.21.0 isolated TypeScript compilation succeeded.
- 29 focused runtime, static connector and matcher tests passed. The positive location example uses explicitly synthetic per-mode publisher evidence, not a claim about the official archive.
- Two read-only tests executed the actual production current-view SQL in BigQuery, without creating datasets or changing stored data. They covered mode-specific disappearance, an empty successful feed, a newer failed refresh, older backfill, continued Tram membership while Metro becomes empty, complete disappearance, and the existing development-snapshot behavior. Each query had a 100 MB ceiling and disabled query caching.
- The production static-reference query executed successfully against the development datasets with a 100 MB ceiling. It returned zero eligible versions, consistent with the static GTFS source remaining a candidate.
- BigQuery errors at these new query boundaries are converted to fresh message-only errors. SDK client, request and response objects are not forwarded or retained.

## Remaining acceptance

The ingestion job now calls `withPublishedGtfsLocations(result, config, bigquery)` after successful collection and before `publisher.publish`. Image deployment and SQL application remain root-owned operations. This document verifies the helper and SQL behavior, not deployment or activation of a realtime source.

T063 still needs realtime source admission and repeated actual source publication. T066's engineering now supports published static references and explicit unresolved mappings, but a real positive location association still requires per-mode publisher metadata from the provider. Current official mode archives do not supply that proof. Sparse route/stop associations do not prove trip/stop membership; retained fields do not establish agency or trip-instance matches. Bus Service Alerts remain an advertised coverage gap. T069 and T077 require separate real-source and release acceptance; these synthetic SQL checks do not satisfy them.
