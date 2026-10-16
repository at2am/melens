# P0 source readiness handoff

Observed on 2026-10-01 through the production map query adapter and the approved
`melens_query` views. This is an integration handoff to the data/producer owners;
no ingestion SQL, publication settings or IAM was changed by the map work.

## Current public catalog

The bounded real catalog read at `2026-10-01T10:17:26.332Z` found planning,
boundary, rent and Census sources available. Pedestrian, disruption, event and
news had no published admitted coverage; anomaly remains unavailable without
its verified producer. Source availability is metadata, not a successful map
result, an exact total or full geographic/time coverage.

## Record-level public access gates

The fixes below were first validated on 2026-10-15 with the actual view SQL and
read-only BigQuery fixture tables. That fixture-only check deployed no views and changed no IAM.
The later authorized deployment and SQL readback are recorded in
[the historical migration evidence](../../cloud/data/docs/validation/nonparking-sql-migration-readback-2026-10-15.json).
The map adapters require `rights_evidence = 'latest_published_record_v1'` from
the repaired boundary/pedestrian views. Existing deployed definitions without
that column remain unavailable. Source-record contracts use `rights_status`
and `record_status`; they do not have a `public_query_allowed` field.

| View / owning path | Evidence | Required owner acceptance |
| --- | --- | --- |
| `v_boundaries`, `cloud/data/sql/006_area_views.sql` | The repaired SQL selects the latest complete record permission before rights filtering. Exact and latest source-record rights plus current source admission gate every boundary. Unordered conflicting permissions deny access. | Read-only production SQL fixtures passed for withdrawal, rights/source revocation, equal-clock permission conflict and failed successor batches. Deploy and verify the served view separately. |
| `v_pedestrian_observations`, `cloud/data/sql/004_street_views.sql` | Exact/latest observation and location source-record rights now gate each row. Native record/version identifiers bind snapshots. Location joins inspect every overlapping interval and require a complete count-window location without conflicting coordinates/status. | Read-only production SQL fixtures passed for count/location withdrawal, source revocation, equal-clock conflict, incomplete hourly windows, half-open endpoints and mid-window coordinate/status changes. Deploy and verify the served view separately. |
| `v_geo_records_history`, `cloud/data/sql/002_core_views.sql:48` | An independent latest-record access check gates old public versions; the map also rechecks exact adapted id/version/content. | Preserve this protection in planning, event and disruption publication changes. |

Production map viewport and unlocated routes require the repaired view evidence
for boundary/pedestrian. A supplemental independent verifier remains available.
Source-level catalog availability alone does not bypass the gate. Stored detail,
continuation and member reads recheck source publication and exact public originals; retraction returns `notAvailable`.

Planning is the positive real preview path. It uses the existing query identity
and approved geo views, never raw/staging tables. The measured 383,847,461-byte
current query requires the explicitly reviewed development ceiling of
400,000,000 bytes; the library default stays 100,000,000.

## Other remaining owners

- D01: admitted pedestrian observations/history and observation-effective sensor
  locations with explicit missing/zero, conflict/inactive and time-window proof.
- D02/D03: admitted road and transit results, documented clock semantics and
  positive located joins; unknown route-only alerts stay in the unlocated list.
- D04: verified anomaly producer with independent public-record proof, exact
  baseline/window, eligibility/classification and replay acceptance.
- D07: admitted event fields, retention/deletion and published coverage.
- Maps setup: the user supplied a demo Web key. The integrator applied it only
  through ignored local build configuration and verified Google Maps tiles,
  attribution and controls in the in-app browser. No key was added to source
  control; key restriction settings were not inspected.

These gates keep T020/T026 live acceptance and G1/G2/G3 open. Local fixture tests
and successful compilation do not replace owner evidence or real rendered-map
performance measurements.
