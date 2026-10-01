# Transport Victoria private cloud validation

The owner added enabled Secret Manager version 1 for `transport_victoria_key_id` and `ticketmaster_discovery_api_key`. Only secret metadata was read locally. The Transport probe uses a pinned Secret reference injected by Cloud Run; no secret values were downloaded, written to source files, printed, or included in HTTP diagnostic output. Ticketmaster has not been probed and remains subject to its existing terms and retention gate.

## Cloud setup

`infra/private-probe.py` creates `melens-dev-transport-probe` in `australia-southeast2`. Its dedicated account has no project-wide bindings or BigQuery grants. A custom bucket role permits get/create/update/delete only for the three Transport source request-ledger prefixes and exact execution-lock objects. Only `transport_victoria_key_id` grants this account Secret Accessor. The job has one task, one CPU, 1 GiB memory, a ten-minute deadline and zero automatic retries. It has no Scheduler trigger and does not publish batches or retain raw responses.

The probe charges the production GCS ledger before each outbound attempt, allows at most 20 requests per execution and 100 per source per UTC day, and spaces calls. The planned connector also retains its conservative 6.1-second inter-page delay because its linked OpenAPI and landing-page rate descriptions differ. These are bounded investigation limits, not approved production cadence or quota evidence.

Initial immutable image: `sha256:53953afb101acd5be5d20b08c20a09c77637fbcac96ff2aac93e6a596d35d8e4`. Revised image: `sha256:261fd972659c9e19334ec313ee0bb3aa2a4d46e024c9c809fc23a0200d2dc9cb`. The revised private client rejects redirects, limits attempts to one and applies a deadline across the complete response read. Shared HTTP behavior tests passed against real local servers, including no redirected KeyID, retry accounting and stream completion/cancellation.

## Observed complete reads

All counts below describe Victoria-wide candidate source reads, not Melbourne-only published coverage.

| Source | Execution | UTC response time | Complete input | Output facts | Geographic rows | HTTP evidence |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Non-planned roads | `melens-dev-transport-probe-8fm6m` | 2026-09-30T23:39:03.781Z | 291 incident-impact features | 569 | 291 located | Three pages, all 200, consistent totals |
| Metro Train and Yarra Trams alerts | `melens-dev-transport-probe-mlqp7` | 2026-09-30T23:39:45.797Z | 19 alerts | 21 including two feed facts | 19 unlocated | Both FULL_DATASET protobuf feeds, all 200 |
| Planned roads | `melens-dev-transport-probe-kgrmx` | 2026-09-30T23:43:46.735Z | 9,450 events | 9,450 | 9,465 located geometry rows | 19 token pages, all 200, chain ended with no more records |
| Non-planned roads, revised image | `melens-dev-transport-probe-q2dqw` | 2026-09-30T23:53:48.526Z | 290 incident-impact features | 568 | 290 located | Three pages, all 200, consistent totals |
| Metro Train and Yarra Trams, revised image | `melens-dev-transport-probe-lzf7h` | 2026-09-30T23:55:06.830Z | 19 alerts | 21 | 19 unlocated | Both feeds 200, no apparent future source timestamp |
| Planned roads, revised image | `melens-dev-transport-probe-ztjdk` | 2026-09-30T23:58:19.597Z | 9,452 events | 9,452 | 9,467 located | 19 token pages, all 200, no apparent future source timestamp |

Each read had zero rejected records, `published=false` and `raw_retained=false`. The changing unplanned count is a second current upstream snapshot, not a data loss conclusion. Source-record counts include parent incidents as well as impacts; alert counts do not imply bus coverage. The probe logs only summary counts, timestamps and types/format counts of known schema fields.

After all six executions, no source execution lock remained. The September 30 UTC ledgers held six unplanned requests, 38 planned requests and four realtime requests, agreeing with the observed HTTP attempts. These ledgers remain to enforce the daily limit. All reads stayed below the 20-call execution and 100-call daily ceilings.

## Blocking unplanned-road time evidence for GM-14 / T031

The revised-image diagnostics observed 290 `lastUpdated` strings without a timezone suffix. Of the 568 normalized source facts, 16 had `source_updated_at` more than five minutes later than the response time. The latest normalized update was `2026-10-01T09:49:04.000Z` although the response arrived at `2026-09-30T23:53:48.526Z`. The previous read had the same approximate ten-hour discrepancy.

This is consistent with Victorian local time being interpreted as UTC, but that timezone is an inference rather than confirmed provider metadata. The [official v3 OpenAPI](https://opendata.transport.vic.gov.au/dataset/af595015-e191-45e5-ab89-6ebca7257e54/resource/1b185c7f-d4b2-404d-a65c-b5a80da7582d/download/unplanned_road_disruptions_v3.openapi.json) marks these fields `date-time` without supplying a local-time rule. The source owner must establish that rule or fail closed on offsetless timestamps. Reusing `new Date(value).toISOString()` in a UTC Cloud Run process is insufficient. Never use these apparent future updates to certify freshness, version ordering or SC-002 latency. DST repeated/nonexistent local times require explicit handling if a Victorian conversion is approved. Estimated `endTime`/`nextUpdateDue` must still remain distinct from actual resolution evidence.

The second planned-road read also had 9,452 offsetless `lastUpdated` strings. Its existing Victorian conversion returned a latest update of `2026-09-30T13:55:20.000Z`, about ten hours before the response. Zero future rows does not prove that conversion is correct. The [official planned OpenAPI](https://opendata.transport.vic.gov.au/dataset/1a3d931e-12f9-49b8-ab7a-7ae8c9a299eb/resource/337dcdcd-defd-427f-b3f7-e06954b853d8/download/planned_road_disruptions.openapi.json) declares this field as a string without a timezone rule. Its linked technical PDF returned HTTP 409 during this review. GM-15 must verify the time convention for the planned endpoint separately; the two endpoints must not automatically share a timezone rule.

## Blocking realtime-alert integration for GM-16 / T063

The key can read both advertised feeds and decode their complete snapshots. The shared review separately reproduced immutable-row version conflicts between successive feed timestamps, source revisions that ignore an advancing lagging mode, and missing per-mode current-snapshot membership. See [GTFS integration review](gtfs-integration-review-2026-10-01.md) for the scoped connector corrections and root-owned enrichment/current-view gates. Source access success does not certify these publication behaviors or static/realtime version matching.

## Repeat without reading secrets

Inspect the plan, then apply an immutable image with the reviewed project confirmation:

```sh
python3 cloud/data/infra/private-probe.py
python3 cloud/data/infra/private-probe.py --image IMAGE@sha256:DIGEST \
  --apply --confirm-project melens-510012
gcloud run jobs execute melens-dev-transport-probe --project=melens-510012 \
  --region=australia-southeast2 \
  --update-env-vars=MELENS_SOURCE_ID=victoria.transport.road_unplanned --wait
```

Execute the three source overrides sequentially. Read only the probe's structured summaries and ledger counts. Source manifests and their Schedule enabled flags remain unchanged; T031/T061/T063/T066/T069/T070/T077 are not completed by these reads.
