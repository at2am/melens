# US1 integration verification, 2026-10-01

T039 now checks the implemented connector and normalization behavior in `test/integration/us1-street.test.ts`. The targeted run used Node 24.21.0 and passed 12 tests. Compilation used a separate output directory so the parallel workers did not write to the shared `dist` directory.

## Local behavior verified

| Area | Evidence checked |
| --- | --- |
| Parking contract | Thirty synthetic weekday/weekend cases distinguish occupancy from permission. Eighteen produce `yes`; twelve produce `no`. Ten synthetic missing/conflicting/expired cases produce zero `yes` decisions. |
| Current API shape | The three repository parking fixtures pass through the actual connectors. Missing publisher join identifiers and rule validity prevent permission and preserve unknown occupancy where the bay-to-sensor association cannot be verified. These fixtures include artificial rows and are not live acceptance samples. |
| Incomplete rules | Thirteen uncertain rule variants remain `unknown` alone and beside an otherwise valid allow rule. Cases include malformed or reversed validity, missing time/day, unknown restriction or vehicle class, permit exemption, overnight schedules without documented day ownership, and equal clock endpoints. Five proven irrelevant rules do not prevent an otherwise valid decision. |
| Holidays and freshness | `applies` remains applicable on an ordinary day as well as a holiday. Missing holiday evidence keeps an `all_days` permission unknown. The canonical City parking sensor source also keeps occupancy freshness and permission unknown on a holiday or when holiday status is unavailable; it retains the reported reading. A 600-second observation meets the two-cycle budget for a synthetic 300-second source; 601 seconds does not. The City source's 120-second cadence is checked separately with a current ordinary-day reading. A newer reading after the same device moves prevents reuse of its old marker reading. |
| Pedestrian history | Five independent connector instances restore a synthetic published interval store through the real history loader. An unchanged confirmation, move, complete-snapshot disappearance, and reappearance retain the confirmed intervals. Installation time does not become a coordinate start time. Unobserved gaps have no inferred point, null counts remain null, genuine zero remains zero, and missing minutes remain absent. Every produced interval has its exact same-batch source fact. The BigQuery boundary is mocked; this test does not claim a live warehouse run. |
| Road lifecycle | Actual normalization retains independent impact clearance plus parent incident and complete-snapshot membership links. Every link resolves to its exact source record version. The real connector creates a source fact for a complete empty snapshot. An HTTP outage instead returns failure with no publishable disappearance or invented clearance time. |
| Source health | The real health and coverage functions preserve `unknown` or `source_unavailable` for failures and delays. A healthy source cannot hide another source's outage, known gap, or missing admission, even when some records match. A successful unchanged response can confirm source health while retaining its older upstream update time. |

The test no longer emulates the production road SQL filter. Actual warehouse view verification belongs to the separate SQL integration tests. The earlier test-only SC-002 calculator was removed because it did not validate its observation window, deduplicate source changes, or establish query visibility.

## Acceptance still outstanding

| Gate | Required evidence | Status |
| --- | --- | --- |
| SC-005 | Thirty real, current, uniquely associated parking bays plus ten required anomaly samples. The complete bays need current rule validity, public access, vehicle class, and authoritative holiday evidence. | Not demonstrated by this run. The synthetic 30 + 10 scenarios cannot replace the real sample. See `docs/source-policies/parking-join.md` for the current mapping and validity limitations. |
| SC-002 | A continuous 24-hour observation window for each admitted dynamic source, at least twenty unique new or changed records, measured first accessibility and published-query visibility, at least 95% within two update cycles, and separate outage/no-change reporting. | Not demonstrated by this run. Local fixtures, source-health assertions, and a complete empty snapshot do not establish the timing gate. |
| T039 completion | Local integration behavior plus the required SC-002 and SC-005 evidence. | Local checks pass; the task remains open until the real acceptance evidence exists. |

This worker made no cloud deployment, read no secret values, and did not change task or checklist status.
