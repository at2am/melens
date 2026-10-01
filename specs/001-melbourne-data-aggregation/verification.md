# Data aggregation verification log

Last checked: 2026-10-01 (Australia/Melbourne). T077 remains open.

## Current result: four-category release

Twelve independent sources now have real published development BigQuery batches.
Five of eight category sample thresholds are met: general news, local crime news
with separate CSA statistics, activities, administrative boundaries, and regional
statistics. Parking occupancy/location is queryable, but its legal three-table
sample gate is open; pedestrian and traffic gates are open. Four category workers
completed independent delivery; root owns deployment and readback.

- General news: ten distinct reviewed logical events, three original publisher
  dates, official area mentions and zero precise Points.
- Local crime news: six reviewed reports across six publication dates, zero
  precise Points; new conservative candidates remain marked unverified.
- CSA: 1,620 count/rate indicators, 81 original area labels and ten statistical
  periods; missing boundary codes/vintages stay null.
- Activities: 421 complete provider records, 419 current noncancelled, 372 future
  dated and 38 provider venues; 80 km search circle is not an official boundary.
- Parking: 29,053 bay points, 6,324 sensors and 8,035 reference rules; no current
  authoritative crosswalk/rule period, so legal permission remains unknown.
- Actual positive GCP checks: parking views 2/2, parking retention 4/4,
  news retention 7/7 and event publisher/lifecycle 1/1. Ordinary tests are
  separate from these opt-in executions.
- Eight source schedules are ENABLED, plus two cleanup schedules. New sensor
  natural 13:04 execution and GDELT natural 12:30/12:45/13:00 succeeded.
  Authenticated Scheduler dispatch also succeeded for bays/rules/CSA/events.
  Sensor final run uses 512MiB, zero load jobs and 220MiB billed queries;
  snapshot readback retains stale/unknown upstream device clocks.
- Warehouse: 13 ingestion tables, 25 query views, 13 authorized direct-raw
  view grants; twelve dedicated admitted source identities.
- Local ADC was revoked after an auxiliary SDK diagnostic exposed a short-lived
  OAuth request header in tool output. CLI and cloud runtime identities continue
  to work. Local SDK development requires `gcloud auth application-default login`.

[Four-category release evidence](../../cloud/data/docs/validation/four-category-release-2026-10-01.md)
and [copyable SQL](../../cloud/data/docs/validation/four-category-readback.sql)
record the actual image, batches, counts, automatic refresh and cost checks.
The original task table is 63/77. SC-002 continuous 24-hour denominators, SC-004
two independent human reviewers, and deployed SC-003/SC-005/SC-006 acceptance
remain unfinished. The dated sections and tables below retain previous evidence;
their 6-source/1-category totals and ADC status are superseded by this section.


## Local implementation checks

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript build and local tests | 626 passed, 10 opt-in GCP/live-source tests skipped, 0 failed; Python infrastructure 20/20 passed | `cd cloud/data && npm test` on Node.js 24.21.0, 2026-10-01; actual GTFS/development and pedestrian production SQL checks also passed separately in BigQuery |
| Transport Victoria static GTFS archive | Official ZIP fetched with bounded byte ranges; 60 routes, 4,485 stops, 96,483 trips, 3,062 route/stop associations | T062 connector live read on 2026-09-29; HTTP `Last-Modified` 2026-09-25T14:02:09Z |
| Static GTFS version | Archive validator-derived SHA-256, not a GTFS `feed_version`; timetable validity dates absent from selected mode ZIPs | `cloud/data/src/connectors/tv_gtfs_static/archive.ts` |
| Parking three-table join | No verified current mapping or current legal rule period; `mayParkNow` stays `unknown` | `cloud/data/docs/source-policies/parking-join.md` |
| Parking query safety | `v_parking_current` no longer joins restrictions to bays on coincidentally equal `bay_id`; without an admitted crosswalk it cannot return `may_park_now = yes`. The 2026-09-30 official API sample still lacks `marker_id`/sensor `bay_id`. | `cloud/data/sql/003_parking_views.sql`; official API `limit=1` read-only recheck |
| Homes Victoria rents | Official DataVic catalog selected the Sep 2025 XLSX; seven property sheets yielded 58,618 historical LGA/quarter records and 9,308 suppressed values kept null. File `Last-Modified` now orders corrections; Jun/Sep 2025 produced 1,106 published facts, with 182 null suppressed values. | [Admission record](../../cloud/data/docs/source-policies/homes-victoria-rents-admission.md); development BigQuery one-shot on 2026-09-30 |
| ABS Census safety | Default connector reads official DataPacks; production ignores environment fixture and URL overrides. Explicit offline constructor options remain available for tests. The reference period is Census day, not five years of implied validity. | Eight connector tests passed on 2026-09-30 |
| ABS Census official archives | Ranged reads extracted G01/G02 from Victoria SA1, SA2 and LGA ZIPs; 32,176 region-table records and 144,792 indicators across nine selected metrics; 2021 Melbourne LGA population 149,615. The same batch was published and replayed. | [Admission record](../../cloud/data/docs/source-policies/abs-census-admission.md); 3,969 indicators match 2021 LGA/SA2 boundaries |
| US2 location and deduplication | Geelong and Ballarat fixtures use Victoria regional scope; cross-source native IDs alone do not trigger a merge | 18 targeted tests passed on 2026-09-29 |
| P0 data prerequisite checks | Offline integration covers pedestrian minute/hour plus location versions, unplanned road parent/child evidence, and static GTFS to alert cases; Transport cloud reads now succeed with a Secret reference, but source-time/version correctness and BigQuery publication remain unverified | `cloud/data/test/integration/p0-pedestrian-transport.test.ts` (3 passed) |
| Scheduled ingestion controls | Actual GCS generation preconditions reject overlapping leases and concurrent request charges. Daily and execution limits stop the next network request. Actual BigQuery rejects a nonzero scan with a one-byte ceiling and cache disabled. | [Cloud evidence](../../cloud/data/docs/validation/cloud-guards.md); verified with local ADC, source runtime identities remain a separate gate |
| BigQuery SQL deployment script | Offline SQL and ACL tests 4/4 passed; 12 tables, 22 views, and eleven reviewed direct-raw view grants applied | `python3 -m unittest cloud/data/infra/test_apply_sql.py`; `apply-sql.py` refreshed on 2026-09-30 for complete development snapshot membership |
| Budget stop response | Seven local tests passed, including Pacific billing month boundaries in summer and winter, current actual-spend threshold, stale/foreign/forecast-only rejection, P0 protection, duplicate delivery and Scheduler failures. Infrastructure script tests 4/4 passed. | `cloud/data/test/jobs/budget-action.test.ts`; `python3 -m unittest cloud/data/infra/test_budget_action.py` on 2026-09-30 |
| Municipal boundary upstream evidence | Official metadata reports CC BY 4.0; the live records endpoint and connector probe each returned exactly one City of Melbourne boundary with `mccid_gis = 1`, `xdate = 2008-07-01`. Response headers advertised a 10,000 request daily ceiling. | [Official dataset metadata](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/municipal-boundary); [source policy](../../cloud/data/docs/source-policies/municipal-boundary.md) |
| Development projects | Official metadata reports CC BY 4.0, monthly updates, `data_processed = 2026-09-24T05:11:36Z` and 1,450 records. Connector verifies that timestamp before and after 15-page collection, then preserves 1,450 project points, four source statuses, null per-row observation time and year-only completion. | [Admission record](../../cloud/data/docs/source-policies/development-monitor-admission.md); live connector and development BigQuery one-shot on 2026-09-30 |

## Cloud admission and deployment

| Gate | Current result |
| --- | --- |
| GCP target | `melens-510012` is the local CLI project with billing enabled. On 2026-09-30 Cloud Run, Cloud Scheduler, Secret Manager, Artifact Registry and Billing Budgets APIs were enabled for development setup. |
| Bootstrap | `cloud/data/infra/bootstrap.sh --apply` completed for development: private Melbourne-region bucket `melens-510012-dev-ingest`, Melbourne-region `melens_ingest` and `melens_query` datasets, and dedicated ingest/query/scheduler service identities. Read-back confirmed public access prevention and separate dataset ACLs; query identity has no raw ingest dataset grant. |
| BigQuery schema | On 2026-09-30 `cloud/data/infra/apply-sql.py --apply` created and later refreshed 12 ingestion tables and 22 query views in `melens-510012`, including the corrected boundary history view. All 22 views passed BigQuery dry-run `SELECT * … LIMIT 0`; the refreshed `v_boundaries` returned 1,527 non-null polygons and `v_area_indicators` compiled. The ingest dataset has exactly eleven authorized-view grants; the query identity has zero direct ingest grants and one query-dataset grant. |
| Budget | On 2026-09-30 a recurring AUD 100 monthly budget was created and read back for project `melens-510012`, with current-spend email thresholds at 50%, 80% and 100%; default Billing IAM recipients remain enabled. Its Pub/Sub topic, authenticated push subscription and private Cloud Run response are deployed. An unauthenticated POST returned 403; a synthetic current-month AUD 100 notification paused the disposable Scheduler job (`checked`, `paused_jobs: 1`), and duplicate delivery returned `paused_jobs: 0`. The smoke job was deleted; the initially empty allowlist now covers the two deployed non-P0 source schedules. An ordinary Cloud Billing notification was captured at 2026-09-30T12:58:23.901Z with matching private service response. The Pacific month-boundary fix was deployed and a new synthetic threshold/duplicate test passed; cleanup and the initial zero allowlist were read back. The 2026-10-01 service refresh read back the two new source schedules. `budget_action_verified=true`. See [budget verification](../../cloud/data/docs/validation/budget-response.md). Alerts can be delayed and do not cap spending. |
| Scheduling | Six admitted sources now have deployed Jobs, verified dedicated identities and runtime limits. Four versioned sources run manually; development and rents have daily 01:20 UTC schedules. Development Scheduler execution and the rents full-history Job succeeded; both daily schedules are ENABLED. Rents first natural dispatch awaits the next 01:20 UTC trigger. Other 18 candidate sources remain disabled. Scheduler runs in Sydney `australia-southeast1`, separate from Melbourne data/Run `australia-southeast2`. The independent hourly orphan cleanup continues. T070 is complete for these six selected sources; T071 remains open; see [deployment evidence](../../cloud/data/docs/validation/source-deployment-2026-10-01.md). |
| Staging cleanup | Private Melbourne Cloud Run Job `melens-dev-staging-cleanup` and hourly Sydney Scheduler trigger `melens-dev-staging-cleanup-schedule` are deployed with a dedicated account and conditional bucket permissions. A manual execution deleted one expired `staging/` smoke object and retained one unexpired control; the control was removed after the test. Seven subsequent Scheduler-created executions at 05:17–11:17 UTC each completed with one successful task. |
| Active sources | 6: `melbourne.municipal_boundary`, `melbourne.clue.blocks`, `abs.asgs.boundaries`, `melbourne.development_monitor`, `homes_victoria.rents`, and `abs.census` are `verified_open` / `active`. The other 18 implemented connectors remain candidates. |
| Third-party key slots | The owner added both keys. Metadata-only checks on 2026-09-30 confirmed enabled version 1 for `transport_victoria_key_id` and `ticketmaster_discovery_api_key`. Values were not accessed locally. Private Transport cloud validation succeeded for unplanned roads, planned roads and Metro Train/Yarra Trams alerts; source admission and publication remain pending; Ticketmaster admission still requires retention and terms review. |
| First release source count | 6 of ≥10 independent, compliant sources have been verified as actually published in BigQuery: City municipal boundary, City CLUE blocks, ABS ASGS boundaries, City development monitor, Homes Victoria rents, and ABS Census. This source count does not meet the first-release gate. |
| Eight required categories | 1/8 passed: administrative boundaries. `v_boundaries` contains the City boundary, Greater Melbourne GCCSA 2021, and 80 LGA 2021 boundaries; Melbourne, Port Phillip and Yarra LGA geometries had positive area. The City and ABS schemes retain their distinct source vintages. Seven other categories remain unverified. |
| SC-002 continuous 24-hour sample | Not started for the required first-release dynamic sources. Two non-P0 daily source monitors are enabled; neither their deployment nor the static replays prove a 24-hour P0 sample or supply the required denominators. |
| BigQuery publisher/cloud test | Local ADC works. The opt-in real GCP publisher suite passed both BigQuery Load and Storage Write paths (including replay, overlapping writes and revocation). Ten opt-in tests remain skipped in ordinary `npm test` by design; the cloud guard, publisher/history and new production SQL checks passed separately in GCP. Real one-shot published batches: municipal `batch_36504f107a03dd7e69919f81b27113f0e29dceea` (1/1/0 input/output/rejected), CLUE `batch_f0a0eb72161ea86f7a9923c6b1ba32d02706b3f8` (603/603/0), ABS 2021 `batch_bed0cb0da68f15795a738b119307a6a35b15032d` (445/443/2), and ABS 2026 `batch_bb51151fd33d4ead60fd72492bbe9baa203b9c7a` (482/480/2). The two rejected ABS items in each batch are official non-spatial LGA facts retained as source records. Municipal and CLUE same-snapshot reruns returned their original batch IDs. `v_boundaries` exposed 1 + 603 + 443 + 480 = 1,527 distinct non-null geographies; 2026 ABS includes 2025-vintage LGA. All three `v_source_coverage` rows were `verified` / `healthy_versioned`; the ingest bucket had no remaining objects. This does not prove source scheduling or a 24-hour run. |
| Development monitor publication | Batch `batch_5fc8b7acca64218b77325f09d32be6739db3d21f` published 1,450/1,450/0 input/output/rejected; replay returned the same ID. `v_change_timeline` returned 59 active, 267 planned and 1,124 resolved project points, all with geometry and source version. `v_planning_changes_current` intentionally returned only 326 active/planned points, with zero unversioned CLUE block references. Source facts were all `verified_open`; coverage reported `active` / `current`. |
| Homes Victoria rent publication | Batch `batch_360b670cb9cd9d7b770da2c09e4c6fc6f57a56cd` published 1,106/1,106/0 and replayed without extra rows. Jun/Sep 2025 each had 553 records; 182 suppressed medians stayed null. All 1,106 area indicators had `boundary_mapping_status = missing`, and geo facts had null geometry; no LGA polygon was inferred. Coverage reported `active` / `current`. |
| ABS Census publication | Batch `batch_f090301c8942cbb474b9ee3dc9447eb2fbd8d400` published 32,176 inputs / 144,792 indicators / zero rejected; replay returned the same batch and counts. 720 LGA indicators and 3,249 SA2 indicators match ASGS 2021; 140,823 indicators keep missing mappings. All source facts have verified rights and the 2021-08-10 reference day. Only one Census period is published, so this does not satisfy the two-period regional-statistics gate. |
| SC-003 to SC-006 | Local edge-case tests exist, but required deployed stratified samples, double review, timings and scores remain pending. |

Do not label T077 passed until the required queries, sampled records, numerator/denominator calculations, unavailable windows, source admission records, and reviewer decisions are saved here without credentials or restricted raw content.

## 2026-10-01 parallel review

Three subagents corrected HTTP secret redirects and whole-response deadlines, GTFS trip-instance evidence, and news benchmark certification. Full Node.js 24.21.0 suite: 463 tests, 457 passed, six opt-in GCP tests skipped, zero failed. Python SQL/budget infrastructure tests: 8/8 passed. T048 is reopened because independent dual-review SC-004 adjudication and model scoring have not occurred. T066 remains open for the [documented live integration gaps](../../cloud/data/docs/validation/gtfs-integration-review-2026-10-01.md). The GM-26 positive stop-selector fixture was aligned by clearing its two unsupported trip-instance constraints; its other cases and the handed-off source implementations were preserved.

| Additional transport check | Result |
| --- | --- |
| Private cloud access | [Complete source-read evidence](../../cloud/data/docs/validation/transport-private-probe-2026-10-01.md): unplanned roads 291 then 290 features, planned roads 9,450 events, Metro Train/Yarra Trams 19 alerts. All zero rejected, no raw retained or batches published. Dedicated probe identity has only reviewed ledger/lock paths and the Transport Secret. |
| Transport publication blockers | Offsetless unplanned timestamps produced 16 future source facts in the second probe. Planned timestamps are offsetless too; their current Victorian conversion requires separate provider evidence. GTFS repeated-feed keys, two-mode revisions, snapshot disappearance and exact static-version evidence remain incomplete. Keys are no longer the blocker; source admission and P0 BigQuery acceptance remain open. |


## 2026-10-01 Gemini integration

All 26 Gemini handoffs, including their rework commits, are integrated with the existing root changes. The snapshot covers 41 commits and 74 files before review fixes. [Acceptance record](../../cloud/data/docs/validation/gemini-merge-review-2026-10-01.md) lists each handoff and the remaining gates. Node.js 24.21.0 ordinary suite: 619 tests, 611 passed, eight opt-in cloud/live-source tests skipped, zero failed; Python infrastructure tests: 8/8 passed.

Root connected bounded published hourly correction history to the default ingestion path and added source-lock publication checks across sensor-hour versions even when upstream native IDs change. The pedestrian view now orders by source revision evidence. Candidate road connectors preserve offsetless wall clocks without assigning UTC; immutable lifecycle facts no longer change with fetch time. The news benchmark has separate blind-review material, with no completed human adjudication or score.

Source activation, source schedules, first-release category acceptance and continuous monitoring remain unchanged: six published sources, 1/8 categories, zero enabled source schedules. The task checklist remains 61/77; the Gemini handoffs refine already checked connector tasks and open integration/acceptance tasks rather than adding 26 completed original tasks. No new production source was deployed by this merge.


The merged publisher/history code also passed the actual GCP suite, 4/4: Load and Storage Write replay/late/cancellation/revocation, plus persisted hourly history and rejection when an unorderable correction changes its upstream native ID. The random datasets and bucket were removed by successful finally cleanup. This uses synthetic fixtures and does not count as publishing an additional real source or T069/T077 acceptance.


The final focused GCP run also passed, 2/2. It compiled the updated street/changes SQL in an isolated dataset, restored published correction history, rejected unorderable native-ID changes, and queried the pedestrian view after publishing reverse-hash `zz-old` / `aa-new` revisions. The production SQL selected count 21 from the newer source timestamp. Cleanup succeeded. These tests validate implementation with synthetic facts; six real published sources and the open P0/category/24-hour gates remain unchanged.


## 2026-10-01 parallel implementation and cloud deployment

Three parallel assignments implemented persisted pedestrian location history,
published static GTFS references and per-mode full-feed membership, and six
dedicated runtime identities. Root connected both runtime helpers to ingestion,
held the source lease across history reads through publication, and limited
request charging to provider collection. Sensor moves now create immutable
closure facts, preserve uncertain gaps, and reject regressed evidence. Production
SQL retains counts while nulling inactive, unknown or conflicting coordinates.
GTFS alert disappearance follows complete mode snapshots without inventing
cancellation, and unmatched official versions remain unlocated.

Node.js 24.21.0: 636 tests, 626 passed, ten opt-in tests skipped, zero failed.
Python infrastructure: 20/20 passed. Actual BigQuery checks passed for the
GTFS/development snapshot views and pedestrian gap/inactive/conflict cases.
The actual static-reference loader ran successfully and returned zero admitted
versions. The production SQL refresh applied 12 tables, 22 views and eleven
authorized-view grants while preserving six writer ACL entries. These synthetic
checks do not admit P0 sources or prove a real positive version join.

All six Jobs use the Node.js 24.21.0 image recorded in
[deployment evidence](../../cloud/data/docs/validation/source-deployment-2026-10-01.md).
Municipal, CLUE, ASGS, development and Census executions succeeded; Census
replayed its original 32,176-input/144,792-output batch. A development
Scheduler-triggered execution also succeeded. Query ceilings correctly rejected
several replay validations; deployed limits were adjusted with explicit bounds.
Rents full-history execution succeeded: 58,618 inputs and indicators, zero rejected; both daily schedules are enabled. All six selected Jobs now use bounded 500 MB validation queries to accommodate shared-table growth. The task checklist is now 62/77, with T070 completed for the selected six. The source count remains six,
category acceptance remains 1/8, and T069/T077 remain open.

## 2026-10-01 five-task parallel delivery

T031, T061, T035, T037 and T039 each had an independent implementation worker. Their engineering changes, new real Transport reads and production SQL verification are recorded in [five-task evidence](../../cloud/data/docs/validation/five-task-parallel-2026-10-01.md). Unplanned roads returned 305 incident-impact features and planned roads returned 9,603 events, both complete with zero rejects and no raw retention or publication. Planned source time now uses that endpoint's official Victorian-local dictionary evidence; unplanned offsetless times remain null.

Real BigQuery checks passed road/GTFS/development snapshot SQL 3/3 and parking SQL 1/1. The refreshed development views retain exact source proofs, permission withdrawal and conservative parking conclusions. Twelve tables, twenty-two views and eleven view grants were applied. Readback preserved six dedicated source writer accounts plus the existing shared ingestion writer account (seven dataset writer entries total). The earlier reference to six writer ACL entries described the dedicated identities only.

Parking sensor metadata specifies 120-second updates, public-holiday non-operation and construction-blocked false vacancies. The candidate settings and parking behavior now retain those limitations. Required real parking crosswalk/rule samples and SC-002 continuous observation remain outstanding; no checkbox, admitted source count or source schedule was advanced by this wave.

Final Node.js 24.21.0 verification: 671 tests, 659 passed, twelve opt-in checks skipped, zero failed. Python infrastructure tests: 20/20. The skipped cloud SQL cases were executed separately as described above. The final parking regression tests reject invalid calendar dates, date-only and unzoned clocks as permission evidence.
