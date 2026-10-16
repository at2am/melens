# Releasing the cloud services and the Web app

[`.github/workflows/release.yml`](../workflows/release.yml) releases on a `v*` tag:

1. Tests: `cloud` typecheck and tests; `app` analyze, tests and the release script tests.
2. `map` and `agent`, in parallel: Cloud Build builds the image from `cloud/` (`cloud/<service>/cloudbuild.yaml`, tagged with the version), then `cloud/<service>/infra/deploy.sh --apply` deploys its digest with the audit it always runs.
3. Web: the job reads the revisions, image digests and URLs Cloud Run now serves, writes the ignored `app/config/cloud-release.json` (browser keys from Secret Manager), builds with `app/e2e/build_release.py` and publishes with `app/e2e/hosting_release.py --apply`. It then checks that `https://melens-510012.web.app/release-provenance.json` names the released commit.

The Web job runs only after both services deployed. The Android and iOS apps are not released here. Data ingestion jobs (`cloud/data/infra/deploy.sh`) are not either: each source is admitted and applied on its own.

## Release

```sh
git tag v1.2.0 origin/main
git push origin v1.2.0
```

Progress and the deployed revisions are on the run's summary page. The Hosting evidence (`plan.json`, `before.json`, `backend-*.json`, `result.json`) and `release-provenance.json` are kept as the run artifact `hosting-release-evidence`.

To release one part only, run the workflow by hand (Actions, Release, Run workflow) on a tag or `main` and pick `cloud` or `web`. A `web` release binds to the services as they run now.

Rollback: push a new tag on the older commit, or, for the Web app only, roll back the release in the Firebase console (Hosting, Release history).

## Fixed release settings

`release.yml` sets the values the services run with today; change them there, in one commit, when the team reviews new ones:

| Setting | Value |
| --- | --- |
| `ALLOWED_ORIGINS` | `http://localhost:8000 https://melens-510012.web.app` |
| `DYNAMIC_SCAN_BYTES` | `1000000000` (see `cloud/map/infra/README.md`) |
| `MIN_INSTANCES` | `1` |

## One-time setup

Run as the project owner from the repository root. The script plans by default:

```sh
.github/release/bootstrap.sh                       # the plan
.github/release/bootstrap.sh --apply --confirm-project melens-510012 --web-config app/config/dev.json
.github/release/bootstrap.sh --verify              # read-only audit
```

It creates, without a service account key:

| Resource | Purpose |
| --- | --- |
| Workload identity pool `github`, provider `melens` | GitHub's OIDC token for this repository (by repository id) becomes Google credentials, only in jobs of the GitHub environment `production` on a `v*` tag or `main` |
| Service account `melens-github-release` | The release identity. Roles: `run.admin`, `cloudbuild.builds.editor`, `artifactregistry.reader`, `firebasehosting.admin`, `serviceusage.serviceUsageConsumer` to deploy; `viewer`, `iam.securityReviewer`, `bigquery.jobUser` and `READER` on `melens_query` for the audits in the deploy scripts; `iam.serviceAccountUser` on `melens-dev-query`, `melens-dev-agent` and the Cloud Build worker; object access to `gs://melens-510012_cloudbuild` |
| Secret `melens-web-release-config` | The Web build's browser keys (`FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `GOOGLE_MAPS_WEB_API_KEY`, `GOOGLE_MAPS_MAP_ID`). `--web-config` copies only these keys from the given app config. Everything else in the release configuration is fixed or read from Cloud Run |

To rotate a browser key, rerun `--apply` with `--web-config` pointing at a config holding the new key, then release.

In GitHub, the `production` environment is created on the first run. Adding required reviewers or limiting it to `v*` tags (Settings, Environments) adds a manual gate; the token condition above already limits which refs can deploy.
