# Transport Victoria planned roads: T061 review

Reviewed on 2026-10-01 at 08:10 UTC. This review keeps the source `candidate` / `review_required`; it does not enable publication or scheduling.

## Official time and status evidence

The [official resource Data Dictionary](https://opendata.transport.vic.gov.au/dataset/planned-disruptions-road/resource/337dcdcd-defd-427f-b3f7-e06954b853d8) was retrieved through the web reader on 2026-10-01. Its definitions for `properties.lastUpdated`, `properties.duration.start`, and `properties.duration.end` each describe offsetless timestamps as Victorian local time. The short source wording is: “ISO 8601 time string, Victorian local time.” Recurrence `startTime` uses the same local clock.

The connector therefore interprets these offsetless fields in `Australia/Melbourne`. Explicit offsets take precedence. Both standard and daylight time candidates must round-trip through the IANA zone; repeated or skipped local clocks produce null absolute times and an explanation. Original strings and recurrences remain in the source summary. [Business Victoria](https://business.vic.gov.au/business-information/daylight-saving) confirms Victoria's October and April clock changes; dates are resolved with Node's timezone database rather than a fixed UTC offset.

The same dictionary distinguishes `Pending` (not currently active) and `Active` (traffic management may apply). Pending maps to `planned`. An Active status is preserved even when its overall schedule is future or expired; it remains `freshness_state=unknown` for query review. The connector never changes a business version merely because collection time crosses its scheduled start. Cancellation/resolution fixtures exercise defensive lifecycle support, but those additional status strings have not been demonstrated by this provider dictionary or a live response.

## Pagination, cadence and quota

The [current dataset page](https://opendata.transport.vic.gov.au/dataset/planned-disruptions-road) specifies KeyID headers, a 20-call/minute endpoint limit, page/limit parameters and 30-minute refreshes. Its [linked OpenAPI](https://opendata.transport.vic.gov.au/dataset/1a3d931e-12f9-49b8-ab7a-7ae8c9a299eb/resource/337dcdcd-defd-427f-b3f7-e06954b853d8/download/planned_road_disruptions.openapi.json) instead describes 10 calls/minute, 10-minute caching and header token pagination with at most 1,000 records per response. The connector accepts either complete schema, rejects switching formats, and uses a conservative 6.1-second inter-page delay. Each request gets one attempt; failures return Retry-After information for later whole-snapshot scheduling. Credentials cannot follow HTTP redirects. The daily request ledger counts each outbound attempt; it does not enforce a shared KeyID per-minute ceiling across different jobs. That coordination remains a production admission requirement.

Numbered totals/counts must agree and event IDs must be unique. Token chains must terminate explicitly; loops, blank tokens and empty continuations fail the whole run. An empty terminal first page is a successful empty observation. These checks establish retrieval completion, not atomic snapshot isolation: neither official document guarantees that all pages share an immutable provider revision. A bounded, consistent repeat probe is still required before admission. The manifest's daily request ceiling is an operational cap; the reviewed public documents provide no provider daily-quota commitment.

## Complete observation membership

Each successful complete collection produces a SourceRecord with native ID `snapshot:<fetchedAt>` and no event/update timestamp. Its version hashes sorted `[geo_record_id, version_id]` membership. Every geometry links to that fact with `road_snapshot_membership`; empty observations still publish one proof fact. A later omission changes current membership without inventing a cancellation or resolution. Failures produce no proof. Snapshot identity participates in `sourceRevision`; event and geometry versions remain stable across unchanged responses. Root owns the current-view SQL and cloud publication integration.

## Verification and remaining admission work

The connector behavior tests cover both pagination forms, whole-run failures, original recurrence schedules, timezone conversions/DST ambiguity, explicit offsets, business replay stability, complete and empty membership, and a real local HTTP redirect. No source KeyID was read by this agent.

Before checking T061 complete: review permission/retention/coverage and production daily caps, coordinate the shared KeyID per-minute request budget across jobs, publish complete batches, and verify the current view against those real published memberships. The earlier 9,450/9,452-event reads used a previous normalization policy.

The revised private cloud probe and synthetic production SQL execution subsequently passed; see [integrator evidence](../validation/five-task-parallel-2026-10-01.md). The new response contained 9,603 events over twenty pages, with zero rejected and zero apparent future updates. Admission and real publication remain open; this is a private source read, not a published source batch.
