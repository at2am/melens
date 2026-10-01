# Data ingestion infrastructure

`bootstrap.sh` prepares one **dedicated GCP project** for the Melens data service. It defaults to a read-only plan. Only the project integrator should run it with `--apply`; it does not deploy jobs, create secrets, or read secret values.

## Access model

Google Cloud CLI login (`gcloud auth login`) authenticates CLI commands. Node.js client libraries use **Application Default Credentials (ADC)**, a separate credential source. A working CLI login alone does not prove that local Node code can access the project. For local development, the project owner should configure ADC with service account impersonation and grant only the development ingestion identity to that developer. Do not download a long-lived service account JSON key or put tokens in this repository.

The project owner adds third-party Transport Victoria and Ticketmaster keys directly in **Secret Manager** using the Cloud Console. Only secret **names** may appear in source manifests or `SECRET_NAMES`; grant `roles/secretmanager.secretAccessor` on each individual secret to the Cloud Run Job identity that needs it. The bootstrap script deliberately grants no project-wide secret access. Revoking a key requires disabling its schedule, removing that identity's secret access, rotating the key, and checking logs and retries for accidental disclosure.

Keep development and production in **different GCP projects and buckets**. Resource names within each project are `melens_ingest` and `melens_query` BigQuery datasets, plus `melens-ENV-ingest`, `melens-ENV-query`, and `melens-ENV-scheduler` service accounts. The runtime configuration names are:

Cloud Run Jobs, BigQuery and the bucket use Melbourne (`australia-southeast2`). Cloud Scheduler uses Sydney (`australia-southeast1`), the available Australian Scheduler location. `schedules.json` records these separately. Scheduler sends an authenticated request to the Melbourne Cloud Run Jobs API; it does not move the ingestion data.

| Variable | Value |
| --- | --- |
| `GOOGLE_CLOUD_PROJECT` | Target project ID |
| `GCP_REGION` | `australia-southeast2` |
| `GCS_BUCKET` | Bucket name, without `gs://` |
| `BQ_INGEST_DATASET` | `melens_ingest` |
| `BQ_QUERY_DATASET` | `melens_query` |
| `SECRET_NAMES` | Optional allowlist of Secret Manager names, never values |

The budget response service uses `MELENS_SCHEDULER_LOCATION=australia-southeast1` to validate the Scheduler jobs it may pause. Its Cloud Run service region is configured separately at deployment.

## Bootstrap

Review the plan first:

```sh
./cloud/data/infra/bootstrap.sh \
  --project PROJECT_ID \
  --bucket GLOBALLY_UNIQUE_DEV_BUCKET \
  --environment dev
```

The project integrator can then execute the reviewed plan locally:

```sh
./cloud/data/infra/bootstrap.sh \
  --project PROJECT_ID \
  --bucket GLOBALLY_UNIQUE_DEV_BUCKET \
  --environment dev \
  --apply --confirm-project PROJECT_ID
```

The script explicitly enables Cloud Run, Cloud Scheduler, Cloud Storage, BigQuery, BigQuery Storage Write API, Secret Manager, Artifact Registry, IAM Credentials and IAM APIs. It creates a private bucket and Melbourne-region datasets if absent, checks existing locations, creates dedicated identities if absent, and reapplies only the necessary bindings. Repeated runs preserve unrelated dataset ACL entries and authorized view grants. The account running the script needs permission to enable APIs, create the listed resources, and manage their IAM policies. The script prints resource names, not credential material.

| Identity | Granted during bootstrap | Granted later, at deployment |
| --- | --- | --- |
| Ingest Job | Bucket `storage.objectAdmin`; `melens_ingest` dataset `WRITER`; project `bigquery.jobUser` | Per-secret `secretAccessor` only if needed; Cloud Run Job service identity |
| Query service | `melens_query` dataset `READER`; project `bigquery.jobUser` | Cloud Run service identity; read only approved views |
| Scheduler | No data or secret access | `run.invoker` on each specific Cloud Run Job |
| Staging cleanup Job | Not created by bootstrap | Dedicated identity with only `storage.objects.list`, `storage.objects.get`, and `storage.objects.delete` on the ingest bucket; reads/deletes are limited to `staging/` by an IAM condition |

`melens_query` views must be authorized against `melens_ingest` when created; granting the query identity raw-table access would bypass the view boundary. The view authorization and job-specific Scheduler binding happen with the SQL view and deployment tasks. The query service must also enforce read-only SQL, table allowlists, dry runs, result limits, timeouts, and `maximumBytesBilled`.

## Staging orphan cleanup

The source deployment gates in `deploy.sh` do not block the independent retention cleanup. Build and push the same image used for ingestion, record its immutable digest, then inspect the cleanup plan:

```sh
./cloud/data/infra/deploy-staging-cleanup.sh \
  --project PROJECT_ID --environment dev --bucket DEV_BUCKET \
  --image IMAGE@sha256:DIGEST
```

The project integrator applies the reviewed plan with `--apply --confirm-project PROJECT_ID`. This creates a dedicated Cloud Run Job in Melbourne and an hourly Scheduler trigger in Sydney (`17 * * * *` UTC). The job runs with one task, no retries, a ten minute timeout and a maximum scan of 1,000 staging objects per invocation. It reads `expiresAt` metadata, deletes expired generations, and uses object creation time plus 24 hours when metadata is missing or malformed. A scan that exceeds the limit fails in Cloud Run logs after processing the first 1,000 objects; investigate and increase scheduling capacity or manually drain the backlog before treating retention as healthy. Source ingestion schedules remain separate.

The cleanup identity receives a project custom role containing only list, get and delete permissions. The bucket listing grant must cover the bucket because Cloud Storage checks `storage.objects.list` at bucket level; a second conditional grant limits object get/delete to `staging/`. The identity has no BigQuery or Secret Manager access. Verify the resulting bucket IAM policy has **no unconditional grant** for this identity. The Scheduler identity gets `run.invoker` on this one Job.

After deployment, execute once and inspect the execution and the Scheduler job:

```sh
gcloud run jobs execute melens-dev-staging-cleanup --project=PROJECT_ID \
  --region=australia-southeast2 --wait
gcloud run jobs executions list --job=melens-dev-staging-cleanup \
  --project=PROJECT_ID --region=australia-southeast2
gcloud scheduler jobs describe melens-dev-staging-cleanup-schedule \
  --project=PROJECT_ID --location=australia-southeast1
```

For an end-to-end check, create a disposable `staging/` object in the development bucket with an expired `expiresAt` and a separate unexpired control object. Execute the Job, confirm only the expired object is deleted, then remove the control object. Check a subsequent scheduled execution after the next `:17` UTC trigger. The hourly cadence means an object normally remains for up to about one hour beyond its metadata deadline; execution failures or an over-limit scan require operator action.

## BigQuery schema and query views

After bootstrap, inspect the SQL deployment plan:

```sh
python3 cloud/data/infra/apply-sql.py --project PROJECT_ID
python3 -m unittest cloud/data/infra/test_apply_sql.py
```

Apply the reviewed SQL to the same development project:

```sh
python3 cloud/data/infra/apply-sql.py \
  --project PROJECT_ID --apply --confirm-project PROJECT_ID
```

The script creates the 12 append-only ingestion tables and 22 query views in numeric SQL-file order. It rejects unexpected DDL or changes to the reviewed list of eleven views that directly read ingestion tables. After the views exist, it grants only those eleven views access to the ingestion dataset; the query service identity receives no direct ingestion dataset access. The current geo view reads published snapshot membership so removed development projects remain historical. Re-running the script refreshes the reviewed grants while retaining unrelated dataset ACL entries. `CREATE TABLE IF NOT EXISTS` does not migrate an existing schema, so inspect table changes before using this command for upgrades.

## Before production

The integrator records each source's request ceiling, Scheduler frequency, maximum BigQuery query cost, retention period, and monthly budget in the runbook before deployment. Configure 50%, 80%, and 100% budget alerts; an alert does not automatically cap all GCP charges. Validate source licenses and storage retention before raw or staging data is retained. [Data quality rules](../../../specs/001-melbourne-data-aggregation/quality-rules.md) define the release gate.

### Automatic budget response

`budget-action.py` plans the development project's response to the reviewed monthly AUD 100 budget. The default is a local plan. Applying it needs a project confirmation and an immutable container image that includes `dist/src/jobs/budget-action.js`:

```sh
python3 cloud/data/infra/budget-action.py --project melens-510012 --smoke-job
python3 cloud/data/infra/budget-action.py --project melens-510012 \
  --image IMAGE@sha256:DIGEST --smoke-job \
  --apply --confirm-project melens-510012
```

The first apply creates a disposable, paused Scheduler job for the delivery test. Its next scheduled date is February 29 and its target is the inert `example.invalid` address. The script checks the live budget's project, monthly period, currency, amount, current-spend thresholds and email recipients before changing infrastructure. It creates a private Cloud Run service, a dedicated Pub/Sub topic and authenticated push subscription, and connects that topic to the existing budget. Cloud Billing must have `roles/pubsub.publisher` on the topic. The script reads that binding back and fails if it is missing. Repeated applies reuse the same resources and refresh the service allowlist.

The runtime account receives a custom project role with only `cloudscheduler.jobs.get` and `cloudscheduler.jobs.pause`. The Pub/Sub service agent can mint an OIDC token only for the dedicated push identity. Only that identity gets `roles/run.invoker` on the budget service. Cloud Scheduler does not support job-name resource conditions in IAM, so the custom role itself can pause any job in the project. The handler checks each requested job against the explicit `schedules.json` non-P0 list and the same project and Sydney location. Keep this service account dedicated to the handler and audit its project grants.

Run the live test while no real non-P0 Scheduler job is enabled. The setup command refuses the smoke test if it finds one. The service's unauthenticated endpoint should return 401 or 403:

```sh
URL="$(gcloud run services describe melens-dev-budget-action \
  --project=melens-510012 --region=australia-southeast2 \
  --format='value(status.url)')"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "${URL}/"
gcloud scheduler jobs resume melens-dev-budget-smoke-schedule \
  --project=melens-510012 --location=australia-southeast1
```

Publish one synthetic current-month alert through the real Pub/Sub topic. Pub/Sub wraps `--message` as base64 in the push envelope, which the handler checks against the budget identity. This does not alter Billing cost data:

```sh
PAYLOAD="$(python3 - <<'PY'
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
start = datetime.now(ZoneInfo('America/Los_Angeles')).replace(
    day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
print(json.dumps({'costAmount': 100, 'costIntervalStart': start.isoformat().replace('+00:00', 'Z'),
                  'budgetAmount': 100, 'budgetAmountType': 'SPECIFIED_AMOUNT',
                  'alertThresholdExceeded': 1, 'currencyCode': 'AUD'}))
PY
)"
gcloud pubsub topics publish melens-dev-budget-alerts \
  --project=melens-510012 --message="$PAYLOAD" \
  --attribute=billingAccountId=0140DD-73B885-08505F,budgetId=f98ae7d1-5f8f-4f92-a493-738ba9cc2c8f,schemaVersion=1.0
gcloud scheduler jobs describe melens-dev-budget-smoke-schedule \
  --project=melens-510012 --location=australia-southeast1 --format='value(state)'
gcloud run services logs read melens-dev-budget-action \
  --project=melens-510012 --region=australia-southeast2 --limit=20
```

Wait for `PAUSED` and a service log with `"action":"checked","paused_jobs":1`. Publish the same message again and confirm a `checked` log with `paused_jobs:0`; the job stays paused. A 503 response or a Pub/Sub delivery backlog means the delivery test failed and Pub/Sub will retry. Check the subscription's push endpoint, OIDC audience, Cloud Run invoker binding and runtime role before retrying. Cloud Billing's first real notification can take several hours; observe one ordinary notification after the topic is connected before declaring Billing delivery proven. A below-budget notification should log `ignored`.

After the smoke test, delete the disposable job and refresh the allowlist:

```sh
gcloud scheduler jobs delete melens-dev-budget-smoke-schedule \
  --project=melens-510012 --location=australia-southeast1 --quiet
python3 cloud/data/infra/budget-action.py --project melens-510012 \
  --image IMAGE@sha256:DIGEST --apply --confirm-project melens-510012
```

The setup includes only non-P0 Scheduler jobs that already exist. Run it again after each source deployment and compare the printed allowlist count with the deployed non-P0 schedules. Keep `budget_action_verified=false` until the authenticated push, actual pause, duplicate delivery, cleanup and ordinary Billing notification checks pass. Budget notifications can arrive hours late and do not cap project spending. [Google documents the notification format and delivery limits](https://docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications).
