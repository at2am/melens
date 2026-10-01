# Event release validation, 2026-10-01

## Delivered connector and policy

- `ticketmaster.events` supports scheduled snapshots of the next 30 days, calculated at collection start. Explicit windows are supported for probes. Snapshot runs do not advance a past-time checkpoint.
- Stable native event IDs survive cancellation and rescheduling. URL, venue identity/name/coordinates and schedule changes produce a new version. A missing or invalid event end is null; it is not copied from the start. Multiple venues and blank coordinates stay unlocated.
- Every zero-based page must agree on total, size and page count. Each page must contain the expected number of events. Empty responses count as one fetched page for publisher completeness. Searches over 1,000 events and duplicate event IDs fail without partial publication.
- Key-bearing requests use `redirect: error`, one attempt and a 350 ms page gap. Only safe failure codes reach telemetry. The raw response is not retained.
- Metadata is `restricted`. The coordinator activated the manifest with `coverage_from=2026-10-01T11:48:53.540Z` after the successful private probe. All derived display fields are in the restricted-source allowlist. Attribution and the direct event URL are present. Deployment and warehouse evidence are recorded separately below.
- `connectors/ticketmaster/policy.ts` supplies the application's 24-hour visibility cap, 12-hour refresh, 6-hour cleanup, 18-hour cleanup age and 30-day search constants. It also supplies stable native-ID mapping. The API terms' 24-hour requirement is for owner-requested removal. The cache duration is an application choice.

## Executed checks

`npm run build` and `node --test dist/test/connectors/ticketmaster.test.js` ran with Node 24 on 2026-10-01. All 27 targeted tests passed. The tests cover multi-page completeness, empty snapshots, strict inconsistent-page failure, 30-day snapshot requests, cancellation/reschedule ID/version semantics, missing end times, missing/ambiguous coordinates, minimum retained metadata and cache expiry/suppression boundaries. Dedicated probe tests reject the wrong job/project/source and empty credentials, and verify that summaries omit event content, original URLs, failure evidence and secret values. HTTP-client fixtures verify eligible-event/provider-venue counts, whole-second request parameters, fixed HTTP status counts and white-listed schema issue path/code counts. Postponed events are excluded from eligible coverage.

`node --test dist/test/integration/us4-changes.test.js` passed seven local suites. The Ticketmaster suite uses the real publisher with local storage/warehouse doubles and actual restricted normalized rows, leaving provider update times and ordinals null. It covers complete cancellation/rescheduling snapshots, failed/incomplete refreshes, empty snapshot disappearance, older collection published later, source/batch admission and 24-hour visibility. The separate opt-in GCP suite was subsequently executed successfully as recorded below.

The new `src/jobs/ticketmaster-probe.ts` runs only for the dedicated cloud configuration. `infra/ticketmaster-probe.py` installs the corresponding job and service account, using enabled Secret version 1. The installer dry run, Python compilation and a mocked complete metadata/readback run passed. The mocked run verifies exact Ticketmaster ledger/lock grants and pinned cloud injection, and performs no secret-version access or BigQuery operations.

Private probe logs include the number of eligible future events and distinct provider venue IDs. IDs are held in memory as sets for counts and are never logged. Only fixed status labels, counts, completeness and collection timestamps are emitted. Cloud deployment and execution remain root-owned.

These local tests use synthetic API fixtures. The cloud probe below establishes current API availability and coverage. The coordinator's formal batch and warehouse readback establish publication; recurring refresh and cleanup execution require their own evidence.

## Real private cloud probe

The coordinator ran the dedicated job with pinned Secret Manager version 1 injected by Cloud Run. No local tool accessed the credential value. Logs contained fixed codes/counts and collection timestamps, without event names, provider venue IDs, key-bearing URLs, response values or exception messages.

| Observation | First probe | Successful probe |
| --- | --- | --- |
| Execution | `melens-dev-ticketmaster-probe-2l97p` | `melens-dev-ticketmaster-probe-cxv79` |
| Checked/fetched time (UTC) | `2026-10-01T11:40:50Z` | `2026-10-01T11:48:53.540Z` |
| Result | `validation_failed` | `success` |
| Request attempts / fetched pages | 1 / 0 | 5 / 5 |
| Expected/fetched records | not established | 421 / 421 |
| Rejected records | no published records | 0 |
| HTTP status counts | not instrumented | 200: 5 |
| Schema issue counts | not instrumented | empty |
| Records with source points / direct URLs | not established | 421 / 421 |
| Records with known date | not established | 374 |
| Eligible future events / distinct provider venues | not established | 372 / 38 |
| Planned / cancelled normalized records | not established | 419 / 2 |
| Raw retained / published by probe | false / false | false / false |

The successful probe used an immutable image with digest prefix `26a44222b048`. It exceeds the acceptance minimum of five eligible future events at two provider venues and completes every page within the application quota. The coordinates are supplied venue points, not invented locations.

Between these executions, request dates were changed from millisecond ISO strings to whole-second UTC parameters. The start rounds up to the next supported second and the inclusive API end rounds down from the internal half-open end, preserving the internal window for evidence. Fixed HTTP/schema diagnostics were added. The successful second execution is consistent with the date-format diagnosis; the first probe did not record HTTP status or retain an error response, so its exact upstream rejection cannot be established retrospectively.

## Real isolated BigQuery lifecycle acceptance

The coordinator authorized the targeted opt-in GCP suite in project `melens-510012`. It passed one test with zero failures or skips in 216 seconds, using the production `001_tables.sql`, `002_core_views.sql`, `007_changes_views.sql`, registry parsing, GCS store and BigQuery publisher. Every test query was capped at 100 MB billed. Only random isolated datasets and a test bucket were created; no formal source data was changed.

The actual GoogleSQL queries verified initial membership, cancellation removal and retained unexpired history, null provider update time/ordinal, rescheduled current membership, failed/incomplete refresh preservation, complete empty snapshot removal, and an older collection published later being unable to supersede that empty snapshot. A newer complete snapshot restored the event. The batch ordering evidence is the collection timestamp in `started_at`, including the empty batch, rather than a fabricated provider modification clock.

The first isolated run failed loading source metadata because its test helper cast the raw manifest instead of using `parseSourceManifest`, leaving fields outside the warehouse schema. The helper was corrected to use the production registry parser; the succeeding run used isolated ID `be9cd320f4074235`. Its `finally` cleanup checked every deletion result. A subsequent safe metadata inventory confirmed zero remaining `changes_test_*`/`changes_views_*` datasets and zero `melens-changes-test-*` buckets.

This verifies the shipped SQL against real BigQuery and synthetic event fixtures. The real provider probe verifies current coverage. Formal warehouse publication and recurring refresh have separate evidence below.

## Formal warehouse publication

The coordinator reported the following completed source release on 2026-10-01. This agent recorded the supplied evidence locally and made no further ADC, SDK or GCP calls.

| Evidence | Verified result |
| --- | --- |
| Source | `ticketmaster.events` |
| Cloud execution suffix | `29j8r` |
| Published batch | `batch_77e407d3dc317380ca8c849c862cca2c4e929dfe` |
| Input / output / rejected records | 421 / 421 / 0 |
| BigQuery current non-cancelled events | 419 |
| BigQuery current future events with a known date | 372 |
| Current records with source venue points / direct event URLs | 419 / 419 |
| Distinct provider venues from the successful coverage probe | 38 |
| Real isolated first lifecycle integration | 1 passed / 0 failed / 0 skipped |

The source is published and its current event data is queryable in BigQuery. Cancelled events are excluded from current results. Provider venue IDs established the 38-venue coverage count; a point count is not used as a substitute for distinct venue identity. The 47 current rows outside the confirmed future-dated count must not be presented as confirmed upcoming timed events.

The application's policy remains 24-hour query visibility, cleanup of content older than 18 hours every six hours, and a complete future-30-day snapshot every 12 hours. The coordinator verified the enabled schedule and authenticated dispatch as recorded below.

## Scheduler dispatch and natural cleanup execution

The coordinator reported the following additional real cloud evidence. This agent made no cloud calls to obtain it.

| Operational evidence | Result |
| --- | --- |
| Ticketmaster Scheduler state | `ENABLED` |
| Authenticated scheduler dispatch | `gcloud scheduler jobs run` succeeded |
| Second real event job execution | `melens-dev-ticketmaster-events-9zds6` |
| Second execution start / finish (UTC) | `2026-10-01T12:49:35.246552Z` / `2026-10-01T12:50:14.562737Z` |
| Second execution state | `SUCCESS` |
| Natural retention execution | `melens-dev-source-retention-9d922` at the 12:11 scheduled run |
| Natural retention execution state | `SUCCESS` |

This verifies an authenticated Scheduler-to-job dispatch and a second real event collection/execution. The second execution used the coordinator's release candidate image; the coordinator is preparing the final unified optimized image. Its batch ID and warehouse counts were not supplied in this evidence, so the formal batch/readback numbers above refer to the verified `29j8r` publication.

The configured event schedule runs at 00:40 and 12:40 UTC. A subsequent natural Ticketmaster invocation has not yet been observed; the dispatch proof is explicitly a manual Scheduler invocation. The natural retention job did execute successfully, proving that scheduled cleanup invocation and execution work. The provided evidence contains no Ticketmaster expired-row deletion totals, so it does not establish removal of a particular expired-content fixture. Deployment does not wait 12 hours for the next natural event invocation; continuity observation remains a follow-up.

## Auxiliary diagnostic credential incident

A local auxiliary metadata check raced the isolated test cleanup and returned HTTP 404. Its uncaught SDK error included a request object, causing a short-lived OAuth Authorization header to enter tool output. This document contains no credential value. No refresh token, API key or password was printed by that diagnostic, and no Secret Manager credential value was requested locally. The auxiliary commands ran through stdin; this agent created no file containing the raw error or token.

All isolated test resources were subsequently confirmed deleted. Further local ADC calls and auxiliary cloud diagnostics were stopped. The coordinator confirmed local ADC was revoked; the independent CLI session and cloud identities remain operational. The opt-in GCP test now replaces SDK response errors with a fixed numeric failure code, preventing request headers from reaching future test output.

## Root-owned cloud release procedure

1. Install source cache expiry in all generic/current/history/event query paths. Current results must belong to the latest complete published Ticketmaster snapshot. An empty later snapshot removes previous current membership. Failed snapshots do not replace it.
2. Install six-hour deletion of older than 18-hour Ticketmaster source/geo/evidence rows and staging objects, keeping normal content storage within 24 hours. Record only non-content audit totals and remove deleted object references. Supply the source-level withdrawal and deletion command. Publication must honor persisted paused permission. Withdrawing all source content also handles an owner request for one event.
3. Give the source-specific Cloud Run service account only its source quota/lock/storage prefixes, warehouse writer scope and enabled Secret Manager version. No public endpoint or secret reads in developer tools are needed.
4. Run a private cloud snapshot using the injected secret. Require complete pagination, zero rejected rows, no retained raw response and no logged key-bearing URLs. If the actual 30-day search exceeds 1,000 events, split the requested date window completely with bounded calls and verify every subwindow. Never publish a partial search.
5. Verify at least five distinct future scheduled events in the next 30 days, at least two provider venues, known date/status and direct links. Geo coordinates must remain source venue coordinates. Preserve postponed/cancelled status without treating it as an upcoming valid event.
6. Fill the manifest `coverage_from` with the first successful observation time and activate after enforcement evidence exists. Publish the complete batch; query source health plus event rows from BigQuery.
7. Enable `mode=snapshot`, interval 43,200 seconds, at most 40 network requests per UTC day initially. Confirm repeated natural runs and the cleanup schedule. Capture cleanup and removal verification evidence in this file.

## Extra community-calendar investigation

The official City Activities API returned HTTP 404 on 2026-10-01. Current City catalog searches found historical event permits/conversations and venue-booking locations, which do not satisfy future-event coverage. What's On Melbourne has a current public calendar, but its copyright notice does not establish the required reuse grant and a supported ingestion API remains unverified. No extra current-calendar source is selected. Ticketmaster platform results are useful event coverage but do not prove complete everyday/free/community activity coverage.

## Coverage and operational limits

- The approximately 80 km Melbourne CBD search circle is neither a municipal boundary nor a verified Greater Melbourne polygon. The source covers participating Ticketmaster platforms and does not establish complete free/community/daily activity coverage.
- Missing dates or end times remain unknown. A cached event with a past start and no known end must not be described as currently ongoing merely because the current view still contains it.
- The released complete search has 421 records. If it grows beyond the 1,000-result boundary, the connector fails and the last complete snapshot can remain visible only within its 24-hour cap. A later window-splitting implementation must aggregate all complete subwindows into one snapshot, within the 10-request execution and 40-request daily limits; publishing separate child snapshots would omit other windows from current membership.
- A failed refresh or cleanup must not extend query visibility. Managed BigQuery recovery copies are outside immediate application erasure; the source-policy document records this limitation. Historical Ticketmaster content is a short cache and cannot support unrestricted longitudinal queries.

## Pending operational evidence

- A subsequent natural complete Ticketmaster refresh at the configured 00:40/12:40 UTC schedule; enabled scheduling and authenticated manual dispatch have already been verified.
- Ticketmaster expired-content deletion totals demonstrating the 18-hour cleanup age; the natural 12:11 retention execution has already succeeded.
- Controlled source withdrawal proving immediate query revocation, content deletion and persisted paused permission blocking subsequent publication.
- A continuous observation period for cadence/availability; the first successful publication alone does not establish ongoing service reliability.

The coordinator owns these remaining shared cloud checks. Initial publication, provider coverage, real BigQuery lifecycle execution, enabled scheduling, authenticated dispatch and a successful natural retention execution are verified. Natural event-refresh continuity, expired-content deletion counts and controlled removal evidence remain observational follow-ups.
