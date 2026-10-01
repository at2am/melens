# Development cloud guard verification

On 2026-09-30 the opt-in `test/integration/gcp-scheduled-guards.test.ts` passed on Node.js 24.21.0 against project `melens-510012` and bucket `melens-510012-dev-ingest`. It calls the production `GcsScheduledRequestStore` and `withScheduledRequestGuard`, uses actual GCS generation preconditions, and sends real HTTP requests to a disposable local HTTP server. The server is a controlled network endpoint, not a public-data source or evidence of source availability.

## Observed behavior

- Two independent GCS store instances contended for the same source lease. The second failed before its callback ran. Releasing the first allowed the second to acquire the lease, and the lease object was removed.
- Six simultaneous attempts to charge a daily limit of two produced exactly two successes and four `RequestCapReached` failures. The persisted GCS ledger contained two requests.
- A second guarded execution after a daily limit of one failed before sending another HTTP request. The server and ledger both counted only one request.
- An execution limit of one stopped the second HTTP request while the daily cap was ten. The stored ledger remained one.
- A BigQuery dry run of `COUNT(DISTINCT source_record_id)` confirmed a nonzero source-table scan. Running the query with `maximumBytesBilled = 1` and query cache disabled was rejected for the billed-byte limit. `COUNT(*)` was deliberately avoided because BigQuery can answer it from table metadata with zero scanned bytes. Dry-run metadata was read directly from the SDK response because dry runs do not create persistent jobs.

All disposable ledger and lease objects were removed after the check. The test does not publish data, enable Scheduler, create secrets, or change IAM.

## Repeat

Use the reviewed Node.js 24.21.0 runtime, build `cloud/data`, then explicitly opt in:

```sh
MELENS_GUARD_TEST_PROJECT=melens-510012 \
MELENS_GUARD_TEST_CONFIRM=melens-510012 \
node --test dist/test/integration/gcp-scheduled-guards.test.js
```

The test runs with the local Application Default Credentials identity. It proves the GCS concurrency/request controls and BigQuery service rejection used by the implementation. It does not verify any source-specific Cloud Run identity, deployed image, provider quota, or continuously scheduled source. Those deployment checks remain separate. `request_count_verified`, `same_source_overlap_verified`, and `maximum_bytes_billed_verified` now reflect these successful cloud checks; source identity fields and enabled flags remain unverified/disabled. The separate [budget response verification](budget-response.md) includes an ordinary Billing notification, a threshold-triggered Scheduler pause, duplicate handling and cleanup; its global gate is now verified too.
