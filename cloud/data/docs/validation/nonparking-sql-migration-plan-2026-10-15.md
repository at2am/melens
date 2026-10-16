# Non-parking view migration plan and readback

This plan updates four existing views in `melens-510012`, `australia-southeast2`.
Preparation used metadata reads and SELECT dry runs. It executed no DDL, PATCH, permission update, or data write.
Root then applied all four view-query changes with the reviewed PATCH helper between 15:45:50 and 15:46:20 UTC.
Independent read-only metadata checks passed at 15:48 UTC. The [readback receipt](nonparking-sql-migration-readback-2026-10-15.json) records the results.
The source HEAD is `2f0374a`. The four SQL inputs did not change after the earlier `99912d2` metadata comparison.

## Exact scope

The `apply-sql.py` parser identified four changed statements among the twelve views in files 002, 004, 006, and 007.
All four live definitions match their original HEAD definitions after comments, identifier qualification, and external whitespace are normalized.

| Order | Existing view | Change |
| --- | --- | --- |
| 1 | `v_geo_records_current` | Reject conflicting GTFS parent snapshots with the same mode and provider timestamp. Retain original record and version membership. |
| 2 | `v_pedestrian_observations` | Check current observation and location permissions. Require a location to cover the complete observation window. Add native record, version, location-evidence, and rights fields. |
| 3 | `v_boundaries` | Select the latest boundary before applying current rights. Prevent fallback to a withdrawn older boundary. Add `rights_evidence`. |
| 4 | `v_transport_changes_current` | Preserve provider `record_status`. Keep future timing in `time_state`. |

The only required ordering is `v_geo_records_current` before `v_transport_changes_current`.
No unchanged view needs replacement.

`v_geo_records_current` is a shared view. Its existing parking snapshot CTEs and parking membership predicate remain identical to the live definition.
No parking table, dedicated parking view, job, scheduler, source metadata, or admission policy is an update target.

The three direct raw readers already have authorized-view tuples on `melens_ingest`.
`v_transport_changes_current` is an indirect reader and needs no tuple.
The plan introduces no raw dataset or table dependency.

## Backup and execution helper

The private local package is:

```text
/tmp/melens-nonparking-sql-plan-20261015-4r6cigwa
```

The directory mode is 0700. Files use mode 0600.
The package contains these materials:

- `manifest.json`, the four parser-selected statements, hashes, and original view etags.
- Four `*.cloud-backup.json` files for the update targets, including definitions and schemas.
- Four `*.iam-backup.json` files for target-view IAM.
- Both `*.dataset-backup.json` files, including the original dataset ACLs and etags.
- Nine additional non-parking dependency-view metadata backups.
- Per-view `*.live-to-desired.diff`, `*.head-to-live.diff`, `*.apply.sql`, and `*.rollback.sql` files.
- `select-dry-runs.json` and `input-validation.json`.
- `reviewed-view-migration.mjs`, the guarded helper.

The ingest dataset ACL has 30 entries. The query dataset ACL has six entries.
The four target views have no table-level IAM bindings.
ACL values and record identifiers are omitted from this document.

The helper defaults to an offline plan. `--preflight` reads cloud metadata without changing it.
The preflight already passed for all four view etags, both dataset ACLs, and all four view IAM policies.

The apply mode uses `tables.patch` with only `view.query` and the existing standard-SQL setting.
Each PATCH has an `If-Match` header. The helper rejects stale etags before applying a change.
Google recommends PATCH for view-query updates and states that an updated view retains its authorization. [Manage logical views](https://docs.cloud.google.com/bigquery/docs/managing-views)
PATCH changes the submitted fields rather than replacing the whole table resource. [Tables.patch](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tables/patch)
The official Go client also sends `If-Match` when it updates table or view metadata with an etag. [Official client source](https://github.com/googleapis/google-cloud-go/blob/main/bigquery/table.go#L1001-L1031)

Before and after each PATCH, the helper compares both complete dataset ACLs and all four view IAM policies with their backups.
It stops on drift. It has no ACL or IAM write operation and performs no authorization refresh.
The helper also checks the view definition, required new columns, and unchanged non-query metadata after each update.

The following command is read-only:

```sh
	/Users/alexgao/.nvm/versions/node/v24.18.0/bin/node /tmp/melens-nonparking-sql-plan-20261015-4r6cigwa/reviewed-view-migration.mjs --preflight
```

Root used this command after reviewing the four-view scope:

```sh
	/Users/alexgao/.nvm/versions/node/v24.18.0/bin/node /tmp/melens-nonparking-sql-plan-20261015-4r6cigwa/reviewed-view-migration.mjs --apply --confirm-project melens-510012
```

Do not run the general `apply-sql.py --apply` command for this migration.
That command processes files 001 through 009 and rewrites the full authorized-view list, including parking entries.

## Rollback

Each successful PATCH records its returned etag and definition in the private package.
The rollback mode restores only views recorded as applied, in reverse order.
It uses the saved original query, requires the recorded current etag, and makes the same ACL comparisons.
It does not delete views or restore dataset ACL files.

```sh
	/Users/alexgao/.nvm/versions/node/v24.18.0/bin/node /tmp/melens-nonparking-sql-plan-20261015-4r6cigwa/reviewed-view-migration.mjs --rollback --confirm-project melens-510012
```

An API timeout can leave the PATCH result uncertain.
In that case, inspect `pending-operation.json`, the journal, and current metadata before retrying.
The helper does not overwrite a newer etag or repair permissions automatically.

## Validation boundary

The four proposed SELECT bodies passed real BigQuery dry runs:

| View | Estimated bytes |
| --- | ---: |
| `v_geo_records_current` | 487,575,241 |
| `v_pedestrian_observations` | 94,301,317 |
| `v_boundaries` | 170,921,222 |
| `v_transport_changes_current` | 484,336,433 |

These dry runs validate query compilation against current schemas. They do not prove runtime output or query-identity access.
The SQL retains the existing active-source and admitted-licence gates. It adds record-rights checks without activating any source.
Candidate, paused, and `review_required` sources must remain unavailable after the update.
Source-health inputs and ingestion schedules are outside this migration.

Post-apply acceptance must verify native rights fields, source and record withdrawal, unchanged attribution, and real API responses.
The downstream checks include street and road views, event and planning views, news views and their crime/Melbourne subsets, and `v_area_indicators`.
Those definitions stay unchanged. Their results can change through the updated parent views.
An unavailable boundary leaves the indicator visible with missing boundary mapping through the existing LEFT JOIN.
Map API success alone does not prove that `v_transport_changes_current` was updated, because ordinary geo queries read the core views directly.

## Applied metadata readback

All four live definitions match the reviewed query bodies and the apply journal etags.
View descriptions, labels, expiration settings, encryption settings, resource tags, and table references remain unchanged.
Both dataset ACLs and all four view IAM policies remain equivalent to their backups.
The same three direct-reader authorization tuples remain present. The indirect transport view still has no tuple.
No ACL repair or grant update was necessary.

The pedestrian schema now exposes `source_record_id`, `version_id`, `location_source_record_id`, `location_version_id`, and `rights_evidence` as STRING fields.
The boundary schema now exposes `rights_evidence` as STRING.
The GTFS ambiguity guard is present, and the transport view preserves provider `record_status`.
The shared current view's parking snapshot CTEs and parking predicate remain unchanged from the cloud backup.

This readback used local user ADC. It confirms view metadata and authorization tuples.
It does not prove requests under the deployed Cloud Run runtime identity.
That acceptance remains with the new Cloud Run revision and root's real API/E2E checks.
