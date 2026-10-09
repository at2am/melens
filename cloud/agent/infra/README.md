# Agent service infrastructure

`bootstrap.sh` prepares the agent service identity and its Firestore database in a
project that [`cloud/data/infra/bootstrap.sh`](../../data/infra/README.md) already
prepared. It plans by default, `--verify` is a read-only audit, and `--apply
--confirm-project` creates what is missing and then audits. It deploys nothing, grants
no secret or bucket access and prints resource names, never credential material. Run it
as the project integrator.

```sh
cloud/agent/infra/bootstrap.sh --project PROJECT_ID --environment dev
cloud/agent/infra/bootstrap.sh --project PROJECT_ID --environment dev --verify
cloud/agent/infra/bootstrap.sh --project PROJECT_ID --environment dev --apply --confirm-project PROJECT_ID
```

| Resource | Bootstrap | Later, at deployment |
| --- | --- | --- |
| `melens-ENV-agent` | `melens_query` dataset `READER`; project `aiplatform.user`, `bigquery.jobUser`, `datastore.user` | `secretAccessor` on the Maps Platform key only; Cloud Run service identity |
| Firestore `(default)` | `australia-southeast2`, Native mode, delete protection; TTL policies on `expiresAtTs` for the `sessions` and `turns` collection groups | Nothing |
| APIs | Firestore, Vertex AI, Cloud Run, BigQuery, BigQuery Storage, Artifact Registry, Cloud Build, Secret Manager, IAM Credentials, IAM | Nothing |

The audit fails on any other project role of the agent identity, on any `melens_ingest`
access (it would bypass the view boundary), on a Firestore database outside
`australia-southeast2`, not in Native mode or without delete protection, and on a
missing TTL policy. It reports the identity's secret access without failing, because the
Maps key grant is expected after deployment. Enabling a TTL policy is a long-running
operation; the apply waits for it, and a `CREATING` state in `--verify` only means that
wait is still in progress.

The script does not manage Firestore security rules. The project is not registered with
Firebase, so no client SDK can reach the database and no Firebase ID token exists; only
the agent identity and project owners reach it through IAM. Registering the project with
Firebase, enabling Anonymous Auth and deploying client rules that deny all access is
the app's Firebase setup, and must happen before the deployed agent service can serve
the app.

The Vertex AI location is not a bootstrap resource. It is recorded in the deployment
configuration as `AGENT_VERTEX_LOCATION` ([../README.md](../README.md#configuration)).

## 2026-10-09 development bootstrap

Applied to `melens-510012` (`dev`) by the integrator, who was granted project owner the
same day. Before it, the project had no Firestore or Vertex AI API, no agent identity and
no Firestore database. The apply enabled the APIs, created
`melens-dev-agent@melens-510012.iam.gserviceaccount.com` with `melens_query` `READER`
and the three project roles, created the `(default)` Firestore database in
`australia-southeast2` (Native mode, delete protection, created `2026-10-09T06:34:04Z`)
and enabled the `expiresAtTs` TTL policy on the `sessions` and `turns` collection groups;
both policies reached `ACTIVE`. `--verify` passes with no `melens_ingest` or secret access
for the identity.

The same day, the Vertex AI location was probed with the CLI user's token (not the
agent identity) through `generateContent` on `gemini-3.8-flash`:

| Location | Plain prompt | `googleSearch` | `googleMaps` with `retrievalConfig.latLng` |
| --- | --- | --- | --- |
| `global` | 200, `modelVersion: gemini-3.8-flash` | 200 with `webSearchQueries` and `searchEntryPoint` | 200 with `retrievalMetadata` |
| `australia-southeast1` | 404, publisher model not found | 404 | 404 |

The deployment configuration therefore sets `AGENT_VERTEX_LOCATION=global`. A real turn
under `melens-dev-agent` is still required for acceptance; it happens with the first
deployment, because the current user cannot impersonate the identity and no extra role is
granted to obtain a local proof.
