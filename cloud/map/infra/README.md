# Development map preview

T019 deploys the read-only query service in `melens-510012`, Melbourne
(`australia-southeast2`). The Flutter Web preview runs locally at
`http://localhost:8000`. Firebase Hosting release is T054; this script does not
enable Firebase APIs or create a Hosting site.

The integrator runs final server/client checks before building and applying the
deployment. Use Node.js 24; the Docker image pins 24.21.0 and runs the T014
`map/dist/src/server.js` entrypoint as an unprivileged user. Build from the `cloud/`
directory as the container context, through `cloud/map/cloudbuild.yaml`, so the image
includes the shared query library (`cloud/shared`). It contains only the reviewed
public registry; credentials come from the dedicated Cloud Run runtime identity.

`cloud/.gcloudignore` uploads only the Docker ignore rules, the locked workspace
package files, TypeScript configuration, source and public registry of `cloud/shared`
and `cloud/map`. Tests, dependencies, compiled output, `cloud/data` and
credential/config files are excluded.

```sh
gcloud builds submit cloud --project=melens-510012 \
  --region=australia-southeast2 --timeout=600s \
  --gcs-source-staging-dir=gs://melens-510012_cloudbuild/map-preview/source \
  --gcs-log-dir=gs://melens-510012_cloudbuild/map-preview/logs \
  --config=cloud/map/cloudbuild.yaml \
  --substitutions=_IMAGE=australia-southeast2-docker.pkg.dev/melens-510012/melens-data/map:dev-preview-20261001
gcloud artifacts docker images describe \
  australia-southeast2-docker.pkg.dev/melens-510012/melens-data/map:dev-preview-20261001 \
  --project=melens-510012 --format='value(image_summary.digest)'
```

Record the returned digest; use the immutable image for the plan and apply.

```sh
cloud/map/infra/deploy.sh \
  --image australia-southeast2-docker.pkg.dev/melens-510012/melens-data/map@sha256:DIGEST \
  --allowed-origin http://localhost:8000 --dynamic-scan-bytes 1000000000 --verify
```

The script plans by default. `--verify` reads identity, project/dataset/bucket/
secret policies, query view metadata and the two public source publications. It
does not read secret values. The publication query uses the existing CLI user;
it does not prove execution under the query identity. A real deployed request is
required for that acceptance. Current user impersonation of `melens-dev-query`
is denied, so no local impersonation proof is claimed and no extra IAM role is
granted to obtain one.

After the integrator's validated handoff, rerun that exact command with
`--apply --confirm-project melens-510012`. The apply creates or updates only
`melens-dev-map` and its service-level public invocation binding. It changes no
project/data/secret IAM permissions. The service uses
`melens-dev-query@melens-510012.iam.gserviceaccount.com`, project
`bigquery.jobUser` and `READER` access to the reviewed query-view dataset. The
audit aborts on other query-identity project roles, ingestion dataset access,
secret/bucket grants or an unreviewed query-dataset resource.

Runtime bounds are one instance at both service and revision levels, concurrency
8, one CPU, 512 MiB, a 30-second HTTP
deadline, 10-second queries, 5-second dry runs, 1-second cancellation, 1,000 items
and a 2 MiB response. Scale-to-zero is enabled. The in-memory snapshot store
requires one instance; restarts/revisions can expire existing snapshots. This is
a development deployment, not a durable pagination store or a global monetary
cap. Public invocation makes these approved reads reachable; CORS allows only
the explicitly listed app origins and does not authenticate nonbrowser callers.

Two dynamic ceilings are reviewed. 400,000,000 bytes accommodated the
383,847,461-byte current-geo estimate observed on 2026-10-01. 1,000,000,000 bytes was
reviewed on 2026-10-09 after that estimate grew to 481,467,396 bytes: every geo topic
shares `v_geo_records_current`, so each new source raises every current query's scan.
A 1 GB scan costs about USD 0.006 and is bounded by concurrency 8 on one instance.
Fresh dry runs must still confirm the estimate before apply. The library's dynamic
default remains 100,000,000 bytes; static/historical queries remain at 500,000,000 bytes.

Follow-up (owner: data, [issue #9](https://github.com/at2am/melens/issues/9)): on
2026-10-09 `v_geo_records_current` estimated about 460,000,000 bytes with or without a topic
filter, while `melens_ingest.geo_records` itself held 259,970,843 bytes. The view's window
functions do not include `topic`, so the filter is not pushed down, and its GTFS/road
membership CTEs read `source_records` and `geo_record_sources` in full on every query. The
guard compares the dry-run estimate, which ignores cluster pruning, so clustering alone
cannot lower it and BigQuery cannot partition on a string topic. The recommended fix is a
publisher-maintained current table that the view and its dependants read; then lower the
ceiling again. Until then the estimate keeps climbing with every 15-minute news batch.

`dev-public-sources.json` is the reviewed public reference registry. A source
reaches the map only while it is admitted and published in `v_source_coverage`
*and* carries a reference here; runtime coverage checks recheck admission and
publication on each request, and an absent reference stays `unavailable`. Each
item adapter supplies its actual version reference rather than using a guessed
dataset version.

Until 2026-10-09 the registry held only the municipal boundary and development
monitor references, so the planning layer showed only Development Activity Monitor
records and the event and news layers answered `unavailable` even though their
sources were admitted and published. The 2026-10-09 review added, from the
connectors' `source.json` manifests and source-policy records:

| Source | Licence | Reference URL | Attribution shown with records |
| --- | --- | --- | --- |
| `victoria.council.engagement` (planning) | `restricted`, facts and links only ([policy](../../data/docs/source-policies/council-engagement-admission.md)) | none; every record carries its council project link | Greater Melbourne councils — community engagement projects |
| `ticketmaster.events` (event) | `restricted` ([release record](../../data/docs/validation/events-release-2026-10-01.md)); 24-hour visibility, direct event link required | Discovery API page | Event information provided by Ticketmaster |
| `gdelt.news` (news) | `verified_open` with attribution to The GDELT Project | gdeltproject.org | News metadata from The GDELT Project |
| `victoria.council.engagement_news` (news) | `restricted`, facts and links only | none; every record carries its council news link | Greater Melbourne councils — community engagement news |
| `user.events` (event) | `restricted`: content users publish in the app under its terms ([policy](../../data/docs/source-policies/user-events.md)), added 2026-10-10 for UC-09 | none; the records are published in Melens itself | Published by a Melens user |
| `melens.anomaly.replay` (anomaly) | `verified_open`: a derived replay of City of Melbourne pedestrian counts (CC BY 4.0), added 2026-10-15 for UC-04 and registered by `cloud/data/scripts/anomaly_replay.py` without the live-source admission gates, **awaiting team review** | the City of Melbourne counts dataset page | Melens replay of City of Melbourne pedestrian counts (CC BY 4.0), then the replayed day |

`deploy.sh` checks the registry against this reviewed table (source set, licence
status reported by `v_source_coverage`, reference host) before any plan or apply.
Still absent: pedestrian, road and transit disruption sources are not published
in `v_source_coverage` at all (`notCovered`), anomalies need a wired producer
(`unavailable`), and parking, crime statistics, rent and census references wait
for their own review.

The current boundary/pedestrian views do not prove latest record rights after
withdrawal, so production composition rejects those record families without a
trusted supplemental checker. A published source reference does not unlock
them. Planning is the positive live preview; the view owner must fix the record
rights boundary before boundary/pedestrian acceptance.

After deployment, record the Cloud Run URL, revision, immutable digest, service
identity, runtime limits, allowed origin and actual JSON/CORS checks. The
integrator writes an ignored `app/config/dev-preview.json` with `MELENS_ENV=dev`,
`MAP_DATA_MODE=live` and that `MAP_BASE_URL`. A missing Maps key remains empty and
the app must surface unavailable base-map setup. Only the integrator handles an
explicitly authorized Maps key delivery in the ignored, permission-restricted
configuration. Never print or commit keys, read other secret values or download
a service account key. Run the built app at the exact allowed origin and record real API behavior
separately from labelled sample behavior and real map rendering.

The 2026-10-01 preview is deployed at
`https://melens-dev-map-saepk4k6hq-km.a.run.app`, revision
`melens-dev-map-00001-kq4`, image digest
`sha256:31d7dd01f7d84d1ac15eae48c1d97fb05694bf1f1a51c30454d9ce9db123ded9`.
Real catalog, planning viewport, aggregate members, original detail and CORS
checks passed under the query identity. Boundary records remain unavailable.
`/healthz` returns Google frontend HTML 404 while `/v1` routes work and container
startup is verified; treat that as a separate health-path limitation. The exact
platform cause is unconfirmed. Do not infer application or BigQuery health from
this intercepted path, or change working IAM/ingress to repair it.

The 2026-10-09 deployments moved the service to image digest
`sha256:fd88fdb18b285b33312e258e7f6021d207ed02e6ddf14a475970c15cf73c017f` (the first
`cloud/` workspace build carrying `@melens/shared`) with the same identity, runtime
limits and `http://localhost:8000` origin. The audit's approved list grew to the 25 views
`cloud/data/sql` publishes (26 with `v_anomaly_current`, added 2026-10-15 for the UC-04 replay). Revision `melens-dev-map-00002-g2p` kept the 400,000,000-byte
ceiling and denied current-mode planning, because that dry run had grown to 481,467,396
bytes (383,847,461 on 2026-10-01; council engagement rows joined the geo view on
2026-10-07). Revision `melens-dev-map-00003-nlr` raised the ceiling to 1,000,000,000
bytes; the CBD planning viewport then returned 118 drawable items of 218 matching with
`completeness: complete`, and catalog and CORS checks passed under the query identity.
Historical mode (105,077,139 bytes) was unaffected. `/healthz` still returns the frontend
404. Rollback target: `melens-dev-map-00001-kq4` (400 MB ceiling, pre-workspace image).

Revision `melens-dev-map-00004-w49` (image digest
`sha256:9a3ecd9d64731f0e7c72f6bc9aa4e0fa9fc5581fd8bbf25f556c31b30d8d1b38`, same identity,
limits, ceiling and origin) carries the six-source registry above and the shared
BigQuery adapter fix: the client had been sending every TIMESTAMP and DATE parameter as
NULL, so a current-mode event query matched only the three undated Ticketmaster rows
instead of the 79 events in greater Melbourne that week (`clientQueryParameters` in
`cloud/shared/src/query/bigquery-adapter.ts`, with a regression test). After the deploy
the CBD viewport for 2026-10-09 to 2026-10-16 returned 65 matching events and 326
planning records from both planning sources; `verify` read all six publications. News
still answers `unavailable` because no news row adapter exists yet. Rollback target:
`melens-dev-map-00003-nlr`.

Rollback uses the previously recorded Cloud Run revision and
`gcloud run services update-traffic melens-dev-map --project=melens-510012
--region=australia-southeast2 --to-revisions=PREVIOUS_REVISION=100`. For the first
development deployment, remove `melens-dev-map` only when the integrator approves
that cleanup; the data resources remain separately owned.
