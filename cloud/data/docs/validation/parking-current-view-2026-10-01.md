# Parking view implementation review, 2026-10-01

T037 updates the production SQL in `sql/003_parking_views.sql`. It retains the original output columns and adds the bay and occupancy batch, source record, version and fetch references.

The view requires a published batch, an active admitted source and an exact `SourceRecord` match by source, batch, native record ID and version. Version selection happens before record permission and lifecycle filtering. A withdrawn or unreviewed latest record cannot revive an older approved observation.

Bay versions are selected within each source, bay and effective interval. A future interval does not hide a current interval; a newer closure of an existing interval removes it. Overlapping current intervals and conflicting versions suppress occupancy and geometry. Marker counts use distinct source and bay identities, and occupancy requires exactly one bay and one sensor. Equal sensor IDs from different sources remain separate.

Observation ordering uses the observed time, source update time and source version ordinal. Content hashes only settle otherwise identical physical duplicates for presentation; conflicting equally current values are ambiguous and cannot supply occupancy. Future observations, future successful source checks and nonpositive cadence cannot produce `current` occupancy.

The unmatched observation view applies the same published provenance and version rules. It reports conflicts without choosing an occupied value, keeps missing-marker observations available and does not add bay geometry.

## Verification

- TypeScript typecheck passed.
- The opt-in BigQuery test is `test/integration/parking-current-view.test.ts`. It executes the production SQL bodies against query-local fixtures. It does not create or modify cloud tables.
- The test covers published provenance, orphan rows, permission revocation, failed batches, marker ambiguity in both directions, timestamp conflicts and corrections, future and stale timestamps, source ID collisions, interval closure and overlap. The integration owner executed this synthetic fixture in BigQuery on 2026-10-01. The production SQL test passed, 1/1, with a 100 MB query ceiling and no persistent table mutation. The safe test log is `/tmp/melens-parking-sql-20261001.log`.

## Remaining acceptance requirements

The current City exports do not provide an admitted three-table crosswalk or current rule validity evidence. Rule columns therefore remain null and `may_park_now = yes` remains unavailable. A fresh matched occupied observation or a verified nonpublic bay can yield `no` using that specific evidence.

The SQL does not infer a public holiday calendar, vehicle class or sign validity. The sensor source's public holiday and operational limitations require a separate source admission decision. The successful synthetic SQL fixture does not satisfy SC-005. That gate still requires 30 complete real-source parking samples and 10 exceptional samples. T035, T037 and T039 acceptance remain open until those source and sample requirements pass.
