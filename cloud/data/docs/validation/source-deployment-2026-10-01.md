# Development source deployment — 2026-10-01

## Scope

Six admitted sources have dedicated Cloud Run Jobs in Melbourne, using the
immutable image `australia-southeast2-docker.pkg.dev/melens-510012/melens-data/data@sha256:60b0b53198c1b1782c03053644b7c9a807efe41f5480427f589e95bb7a4e8591`.
The application uses Node.js 24.21.0. This image contains the location/GTFS runtime
helpers and the source lease covering history reads, collection and publication.
Only provider collection consumes the upstream request quota.

| Source | Job | Check | Query ceiling |
| --- | --- | --- | --- |
| Municipal boundary | `melens-dev-melbourne-municipal-boundary` | Manual versioned snapshot | 500 MB |
| CLUE blocks | `melens-dev-melbourne-clue-blocks` | Manual versioned snapshot | 500 MB |
| ABS ASGS | `melens-dev-abs-asgs-boundaries` | Manual 2026 snapshot | 500 MB |
| Development monitor | `melens-dev-melbourne-development-monitor` | Daily, 01:20 UTC | 500 MB |
| Homes Victoria rents | `melens-dev-homes-victoria-rents` | Daily, 01:20 UTC | 500 MB |
| ABS Census | `melens-dev-abs-census` | Manual published release | 500 MB |

Four versioned sources have no declared monitoring interval and receive manual
jobs. Two monitored snapshot sources receive Scheduler jobs in Sydney. The
installer creates schedules paused before activation. Source manifests and the
scheduler configuration keep their declared cadence separate from the daily
release checks. P0 transport/pedestrian sources remain candidates and are not
activated by this wave.

## Permissions and budget

Actual IAM readback passed for all six runtime identities and exact Job Scheduler
invoker bindings. [Identity scope](source-runtime-identities.md) includes source
object conditions and no Secret Manager grants. The shared ingest dataset still
permits ingestion writers to access all ingestion rows; it is not row isolation.

The AUD 100 monthly budget and 50/80/100 alerts were read back. The private budget
response was refreshed to include the two deployed non-P0 schedules before
activation. Its authenticated Pub/Sub delivery/pause behavior was previously
verified; notifications remain delayed and do not cap all project charges.

## Real execution results

First executions succeeded for municipal boundary, CLUE blocks, development
monitor and Census. Census replay returned its original published batch with
32,176 inputs and 144,792 indicators; it did not create a new source or Census
reference period.

ASGS and rents first failed because BigQuery required 108,003,328 billed bytes
for a validation query, above their 100 MB ceiling. Both ceilings were changed to
150 MB in the configuration and deployed Jobs. ASGS retry
`melens-dev-abs-asgs-boundaries-dftts` succeeded and returned the existing 2026 batch
with 482 inputs, 480 spatial outputs and two retained nonspatial source facts.
The 150 MB rents retry also failed: another validation query required
150,994,944 billed bytes. A development Scheduler execution hit the 100 MB ceiling.
At that stage ASGS, development and rents were raised to 200 MB in both
configuration and Jobs; the final shared-warehouse limits are recorded below. These are per-query ceilings; repeated validation queries can
still increase total monthly usage.

The development Scheduler-triggered retry
`melens-dev-melbourne-development-monitor-6sdzh` succeeded at
2026-10-01T05:12:21.589772Z. Its daily schedule is enabled. Rents execution
`melens-dev-homes-victoria-rents-5hjlj` reached the 600-second task limit. The daily
cloud snapshot includes the full historical workbook, whereas the earlier
one-shot published only the two most recent quarters. Its new full-history batch
is `batch_b94e360540845cc13e8f564a96fa51b2d1cf95df`; it was still `running`, not
published, after the terminated task.

Actual request-ledger readback showed six of ten requests used, leaving enough
for one further execution with the three-request ceiling. The task limit was
changed to 1,800 seconds, matching the other bulk statistics job. Before retrying,
the integrator verified the schedule was paused and all five listed executions
were finished. The terminated execution's source and publication locks were read
back with their exact timestamps, then removed with generation preconditions;
live leases were not cleared. Job
`melens-dev-homes-victoria-rents-7ctq9` failed at 2026-10-01T05:36:01.589788Z:
a validation query required 212,860,928 bytes, above 200 MB. Rents now uses the
same 500 MB ceiling as Census. The ledger contained eight requests, with exactly
two remaining for the normal catalog and workbook calls. Final bounded retry
`melens-dev-homes-victoria-rents-qvz6x` started at
2026-10-01T05:47:15.059998Z; the daily ten-request enforcement remains unchanged
and will reject any extra retry. The rents schedule was enabled after successful execution readback. These locks deliberately require operator recovery after a process is
killed; they do not expire automatically.

A replay-validation failure preserves the original published batch. The current
publisher does not append a failed source-check row on that replay path; Cloud
Run failure metadata is the evidence for these rejected attempts. This remains
an operational follow-up before claiming complete source-health coverage.

The production SQL refresh succeeded: 12 tables, 22 views and 11 authorized raw
view grants, preserving runtime dataset ACL entries. Real synthetic GoogleSQL
checks passed for GTFS snapshot membership and pedestrian closure gaps, inactive
and conflicting locations. They are implementation checks, not source admission,
a real P0 positive location join, or a continuous 24-hour release sample.

## Completed selected deployment

Final rents execution `melens-dev-homes-victoria-rents-qvz6x` completed successfully
at 2026-10-01T06:01:37.589196Z, after approximately 14 minutes. Its batch
`batch_b94e360540845cc13e8f564a96fa51b2d1cf95df` published 58,618 inputs,
58,618 indicators and zero rejected records. This is the full historical
workbook, preserving suppressed medians as null. It supersedes the two-quarter
one-shot as the source's complete cloud snapshot; it remains one data source.

Both daily schedules were read back as ENABLED, with `20 1 * * *` in Etc/UTC,
the exact Melbourne Job API targets, and the dedicated Scheduler OAuth identity.
Development has a successful forced Scheduler execution. Rents was resumed
after the full-history execution; its first natural Scheduler execution remains
to be observed after the next 01:20 UTC trigger, 2026-10-02. No additional
provider collection was forced after the final two calls available in its ledger.

Full-history ingestion enlarged the shared validation tables. All six selected
Jobs now have explicit 500 MB per-query ceilings, matching the successfully
tested bulk statistics ceiling, rather than retaining earlier limits that were
already below shared-table scan estimates. This does not cap total query charges
or establish the cost of future minute-level P0 sources; T071 remains open.

T070 is complete for these six selected admitted sources: Jobs, dedicated runtime
identities, guarded ingestion, immutable image, four manual versioned snapshots
and two enabled daily checks are deployed. P0 candidate deployment and the
first-release coverage/quality/continuous-run gates remain outstanding.

Final configuration readback passed for all six Jobs: exact runtime identity, 500 MB query ceiling, unchanged daily request ceiling and declared task timeout.
