# Publisher validation migration, 2026-10-15

Baseline: `3ce880444d23094cd86af2635a444cd253f0a902`. The previous workspace was 49 commits behind this baseline. Its test counts and live query estimates do not establish acceptance of this revision.

## Existing UC-15 implementation retained

The baseline already has the parking repair. `parking_sensor_current` holds a complete physical snapshot. The sensor job replaces it atomically after publication. Its JSON parser uses `wide_number_mode => 'round'`, including the coordinate that caused the earlier production failure. `v_parking_sensor_current` reads the current table, not parking history. Membership cleanup keeps one hour, retention runs each table separately and clears old partitions one day at a time, and ingest leases expire after the task timeout.

None of those paths was replaced. The previous patch's three-query parking history recovery, parking fetch-time invariant, additional date predicates and history-based integration fixture were not migrated. The previous validation report was also not restored.

## Changes migrated

- Batch-state lookup now specifies both source ID and batch ID.
- Cross-version validation receives a constant list of logical IDs for its current request chunk. It still checks all eligible published historical versions of those IDs. It does not replace current-snapshot storage or change public reads.
- The 7 MB validation-chunk budget includes both row content and repeated logical-ID parameters, with outer JSON escaping. A single oversized row fails explicitly. Whole-batch IDs are never repeated in each chunk.
- Regression tests check the source filter, chunk-local ID equality, complete input coverage and request sizes below 8 MB. The large-ID fixture includes quotes and backslashes.
- The warehouse-quality test now uses the publisher's owned fact-table list. `anomaly_results` belongs to `scripts/anomaly_replay.py`, not a generic connector publication. A table-ownership regression requires the publisher list and separately written tables to cover the whole DDL exactly. Every publisher-owned empty table still has an injected-failure test.

Node.js 24.18.0 passed an isolated TypeScript build and the publisher test file: 55 passed, zero failed, one resource-creating cloud acceptance test skipped, 56 total. The log is `/tmp/melens-main-publisher-focused-20261015.log`. Shared build output was not changed.

No parking runtime, current-table, view, retention, job, schema, IAM or scan-budget configuration was changed. No cloud deployment or data mutation was performed. Final full-workspace test execution belongs to the integrator's current cloud workspace; the old-baseline 775-test result must not be reused for this migration.
