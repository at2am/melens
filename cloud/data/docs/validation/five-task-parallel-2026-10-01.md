# Five parallel task deliveries, 2026-10-01

T031, T061, T035, T037 and T039 each had a separate subagent. The integrator owned shared SQL, request settings, image deployment and cloud checks. All five delivered implementation changes; their full acceptance remains open for the evidence below.

## Delivered changes

| Task | Implemented and verified | Remaining acceptance |
| --- | --- | --- |
| T031 | Complete/empty snapshot proofs and exact membership links; incident/impact lifecycle; inconsistent parent and unknown-status rejection; stable business versions; redirect and retry controls. New private cloud read succeeded. | This endpoint's offsetless timestamp timezone is undocumented. Source admission, shared KeyID minute limits, cost parameters and real repeated publication still need verification. |
| T061 | Its own official HTML dictionary establishes Victorian local time. Conversion handles daylight time and keeps ambiguous/nonexistent clocks null. Complete snapshots, recurrence evidence, pagination and credential handling have behavior tests and a new live read. | Source admission, shared KeyID minute limits, cost parameters and real repeated publication remain unverified. |
| T035 | Parking evaluation rejects malformed/uncertain rule evidence, ambiguous joins and stale readings; interprets public-holiday applicability correctly; prevents reuse of a sensor's old marker after movement. | Current official three-table mapping, current rule validity, public access and obstruction evidence are unavailable. Alternative polygon/zone exports are candidates, not admitted crosswalks. |
| T037 | Published facts require their exact source versions. Rights withdrawal cannot revive older permission. Duplicate markers, conflicting versions and future times cannot support a positive conclusion. Added batch/source/version references. Production SQL passed in BigQuery and deployed successfully. | The view has no admitted rule crosswalk. Rule columns stay null; a vacant reading cannot produce `may_park_now=yes`. |
| T039 | Actual connector and normalizer tests cover parking uncertainty, source outages, sensor moves/disappearance/reappearance and complete empty road snapshots. Removed a test-only SC-002 calculator that could not prove real timing. | SC-005 needs 30 real complete bays plus 10 anomalies. SC-002 needs continuous 24-hour published-query evidence with at least 20 unique changes per monitored source. Synthetic fixtures do not meet these gates. |

Source-specific records: [unplanned roads](../source-policies/transport-unplanned-roads.md), [planned roads](../source-policies/tv-road-planned.md), [parking evidence](../source-policies/parking-join.md), [parking SQL](parking-current-view-2026-10-01.md), and [US1 integration](us1-integration-2026-10-01.md).

## Private cloud reads

Immutable probe image:

`australia-southeast2-docker.pkg.dev/melens-510012/melens-data/data@sha256:4dfa1dad4f8da80e1b7c7ce8722511fb938c74f2e9d1532e7b5d97049c0fa176`

| Source | Execution | Response UTC | Complete input | Source facts | Located geography | Snapshot links |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Unplanned roads | `melens-dev-transport-probe-qzbp7` | 2026-10-01T08:20:38.070Z | 305 | 593 | 305 | 305 |
| Planned roads | `melens-dev-transport-probe-rzjvg` | 2026-10-01T08:24:17.017Z | 9,603 | 9,604 | 9,618 | 9,618 |

Both had zero rejected records, one complete snapshot fact, zero apparent future update timestamps, `published=false` and `raw_retained=false`. The unplanned read had no verified absolute update times; zero future times therefore does not certify its clock. Planned roads had 9,603 absolute update times, with a latest update of 2026-10-01T06:56:45Z, using the independent official dictionary evidence.

The unplanned response used four pages; the planned token chain used twenty, exactly the probe execution ceiling. Larger planned responses will require an explicitly reviewed bound. October 1 UTC ledgers read back four and twenty charged requests respectively, and both execution locks were absent. Reads were sequential, preserving the probe's local spacing; the per-source daily ledger does not enforce a provider-wide per-minute limit across independent jobs. Neither probe published batches or started source schedules. Secret values stayed in Cloud Run injection; only structured summaries and metadata were inspected locally.

## Warehouse verification

- Final Node.js 24.21.0 suite: **671 tests, 659 passed, twelve opt-in checks skipped, zero failed**. Python infrastructure tests: **20/20**. The final parking cases include invalid calendar dates, date-only and unzoned clocks, keeping uncertain competing rules from allowing parking.
- Actual BigQuery production SQL checks passed: road, GTFS and development snapshot membership **3/3**, parking provenance and ambiguity **1/1**. These use synthetic facts with the shipped SQL, not real-source publication samples.
- Road current membership follows the newest complete published fetch per source, including empty snapshots. Old backfills and failed refreshes cannot replace it; competing proofs at the same fetch instant fail closed. Disappearance changes membership without inventing resolution or event time.
- SQL refresh applied twelve tables, twenty-two views and eleven authorized-view grants. Readback verified road membership and the parking view's twenty-six columns, including the new provenance fields.
- The dataset retained six dedicated source writer accounts and the pre-existing shared ingestion writer account: seven writer entries in total. The count of six refers to dedicated source identities, not the entire dataset ACL.

## Parking source metadata correction

The [official sensor metadata](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors) specifies a two-minute publication frequency. The candidate manifest and disabled schedule now use 120 seconds and a two-minute check. Metadata also says sensors do not operate on public holidays and can report construction-blocked bays as vacant. Those limitations remain visible in the parking policy and decision behavior; no construction/access permission is inferred from vacancy.

## Completion count

No original task checkbox was advanced solely for a code delivery, a private read or a synthetic test. The original checklist remains **62/77**, with **15** open tasks, six admitted real published sources and two enabled daily source schedules. This wave resolves engineering defects and planned-road timezone evidence; it does not certify first-release coverage or continuous operation.
