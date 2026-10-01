# Source runtime identities

`infra/source-identities.py` provisions one runtime service account for each of
the six admitted sources: municipal boundary, CLUE blocks, ASGS boundaries,
development monitor, Homes Victoria rents and ABS Census. Plan mode reads local
manifests and prints JSON. It calls no cloud service.

The account ID combines the environment, a readable source prefix and ten
hexadecimal characters from the source ID hash. IDs are deterministic and at
most 30 characters. Development and production have different account IDs.

## Grants

| Resource | Runtime grant | Scope |
| --- | --- | --- |
| Project | `roles/bigquery.jobUser` | Create BigQuery jobs in this project |
| `melens_ingest` dataset | `WRITER`, equivalent to `roles/bigquery.dataEditor` | Read and write ingestion tables |
| Ingest bucket objects | Custom role with get, create, update and delete | Only the source's raw, staging, checkpoint, request ledger and two lease paths |
| Ingest bucket metadata | Custom role with `storage.buckets.get` | Exact ingest bucket |
| Secret Manager | None | These six sources have empty secret allowlists |

The publication lease path is `locks/source_<sha256(source_id)>.json`. The
scheduled execution lease is `locks/scheduled/<source_id>.json`. Both paths are
included explicitly in the object's IAM condition. Raw and staging conditions
end in `/` after the complete source ID, so similarly named sources do not match.

The jobs use an exact staging object URI for BigQuery loading. Google requires
bucket metadata access and object read access for that operation. Object listing
is needed only for wildcard URIs. The runtime identities receive no object list
permission. [Google's batch load permissions](https://docs.cloud.google.com/bigquery/docs/batch-loading-data)
describe these requirements. [Cloud Storage IAM conditions](https://docs.cloud.google.com/storage/docs/access-control/iam)
support object-name conditions and explain that object listing cannot be
restricted by the object-name prefix.

The shared `melens_ingest` dataset gives each runtime identity access to every
source's ingestion rows. Source checks, immutable versions and publication
leases still run in the application, but dataset IAM does not isolate rows by
source. Strict warehouse isolation would require separate datasets or a separate
publication identity and a redesigned publication interface.

## Plan, apply and readback

Inspect all six identities locally:

```sh
python3 cloud/data/infra/source-identities.py \
  --project melens-510012 --environment dev --bucket melens-510012-dev-ingest
```

The project integrator applies explicitly selected sources. Repeat `--source`
for each reviewed source in the same batch:

```sh
python3 cloud/data/infra/source-identities.py \
  --project melens-510012 --environment dev --bucket melens-510012-dev-ingest \
  --source melbourne.municipal_boundary --apply --confirm-project melens-510012
```

Apply first checks existing grants and custom role permissions. It rejects
unexpected existing grants rather than removing them. It preserves unrelated
dataset ACL entries, including authorized query views. It then reads the actual
cloud policies back before reporting `dedicated_identity_permissions_verified`.

Readback can also run without changing resources:

```sh
python3 cloud/data/infra/source-identities.py \
  --project melens-510012 --environment dev --bucket melens-510012-dev-ingest \
  --source melbourne.municipal_boundary --verify-only
```

Add `--verify-jobs` after source deployment. This checks the job's runtime
identity and the Scheduler service account's unconditional `roles/run.invoker`
binding on that exact job. The deployment script owns creation of this binding.
An existing project owner's deployment rights are not changed by this script.

## Verification scope

Readback checks the selected service accounts' direct grants on the project,
ancestor folders and organization, ingest bucket, every dataset in the project
and every Secret Manager secret. It rejects unexpected grants, public grants,
disabled accounts, user-managed service account keys, missing required bindings
and custom roles with changed permissions. An incomplete inventory or unreadable
ancestor policy fails verification. Secret values are never accessed.

The report describes its scope. It does not resolve group memberships or inspect
grants in other projects. Real execution under the deployed identity is needed
to prove the runtime can complete ingestion with these grants. A readback report
alone is not evidence of a successful source ingestion run.

This version accepts only the six named sources. Adding a source requires review
of its admission evidence, runtime paths and any secret references. A source
that needs a secret also needs per-secret provisioning and verification of its
exact approved secret allowlist. Expanding the source list alone would not
support secret-bearing transport or Ticketmaster jobs.

## Offline checks

```sh
python3 -m unittest discover -s cloud/data/infra -p 'test_source_identities.py'
```

The mocked cloud retains IAM changes between calls. The tests cover local plan
behavior, deterministic identity names, admitted-source restrictions, idempotent
provisioning, authorized-view preservation, mutation-free readback, forbidden
grants, role drift, inherited grants, user-managed keys and optional job checks.
These tests do not make cloud changes or claim deployment verification.

## Development apply on 2026-10-01

Root provisioned and read back all six source identities in `melens-510012`.
The two custom roles and the source-specific bucket conditions were checked
against the actual policies; every runtime has only project `jobUser`, the
ingestion dataset writer grant, its reviewed object paths and bucket metadata.
No selected identity has a Secret Manager grant or user-managed key.
The corresponding six schedule entries now record the verified identity.
Deployed-job execution results are recorded separately in the source deployment log.
