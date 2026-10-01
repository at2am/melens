# Pedestrian location persistence review — 2026-10-01

## Implemented behavior

- A fresh ingestion process restores published sensor intervals through
  `withPublishedPedestrianLocationHistory`. The source-specific BigQuery read
  requires a billed-byte ceiling, admits only published batches and exact
  source facts from the same batch, and rejects more than 50,000 intervals.
- Connector inputs validate the restored rows, point coordinates, source and
  sensor identities, interval ordering, duplicate intervals, and multiple open
  intervals. Malformed JSON history fails before an upstream request.
- Each collection uses only its supplied published state or explicitly injected
  fixture state. A preceding collection in the same process supplies no history.
- Movement or status changes produce a new closure location version and matching
  source fact. Previously returned objects remain unchanged. A documented
  `valid_from` closes the old interval at that date; otherwise the old interval
  ends at its last confirmed snapshot and the transition gap stays unknown.
- Disappearance from a complete snapshot closes the old interval at its last
  confirmation. It does not invent a removal date or change its original status.
- An unproven current coordinate interval starts at its first observed snapshot.
  Device installation dates, natural-language notes, and hardcoded baseline
  coordinates do not establish historical coordinate validity. The hardcoded
  baseline logic has been removed.
- Repeated unchanged facts retain their interval and row version. Source-fact and
  geographical business content remain identical across replays. Effective dates
  are distinct from unavailable source publication/observation timestamps.
- `sourceRevision` is explicitly an `observation-snapshot` acquisition identity:
  complete payload digest plus the snapshot fetch timestamp. It does not claim
  that fetch time is an upstream revision or movement time. An unchanged later
  check publishes a new confirmation batch with identical business fact versions;
  replaying the same acquisition is idempotent. `sourceLatestUpdateAt` remains the
  actual provider revision timestamp, or null when absent.
- Regressed observation or provider revision evidence is rejected. A provider
  revision disappearing after a non-null published revision is also rejected;
  otherwise source-first query ordering could hide the new closure behind an old
  open interval. A changed geometry/status with a retroactive or equal interval
  start requires explicit correction review.

## Shared integration

The ingestion entry point restores location history before collection. The
pedestrian query view joins matching location source facts and ranks a repeated
interval by provider revision, snapshot confirmation, and a closed-interval tie
preference. Those shared entry-point and SQL changes are maintained by the root
agent.

The helper accepts an opaque snapshot cursor inside a temporary, strict JSON
checkpoint. The connector returns the ordinary snapshot cursor. No growing
history is persisted as a coverage cursor.

## Verification

An isolated Node 24 run passed 35 tests: 26 location connector tests, six new
location persistence tests, and three existing P0 pedestrian/transport tests.
The connector suite included one bounded read-only check of the official
location endpoint. Persistence tests use simulated BigQuery responses and
exercise cold restart, unchanged replay, exact closure provenance, transition
gaps, disappearance, unpublished process-state isolation, malformed/oversized
state, and unsafe source revision rejection.

These tests do not establish successful production publication, source admission,
P0 joint cloud acceptance, or 24-hour freshness. The location source remains a
candidate until those separate checks pass. A genuine movement timestamp still
requires explicit upstream evidence.
