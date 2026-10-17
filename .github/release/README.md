# Releasing the cloud services, the Web app and the mobile apps

[`.github/workflows/release.yml`](../workflows/release.yml) releases on a `v*` tag:

1. Tests: `cloud` typecheck and tests; `app` analyze, tests and the release script tests.
2. `map` and `agent`, in parallel: Cloud Build builds the image from `cloud/` (`cloud/<service>/cloudbuild.yaml`, tagged with the version), then `cloud/<service>/infra/deploy.sh --apply` deploys its digest with the audit it always runs.
3. Web: the job reads the revisions, image digests and URLs Cloud Run now serves, writes the ignored `app/config/cloud-release.json` (browser keys from Secret Manager), builds with `app/e2e/build_release.py` and publishes with `app/e2e/hosting_release.py --apply`. It then checks that `https://melens-510012.web.app/release-provenance.json` names the released commit.

4. Mobile, on the [release Mac](#mobile-apps), the platforms in the repository variable `MOBILE_PLATFORMS` (default iOS only): the job writes the ignored `app/config/mobile-release.json` (Firebase and Maps keys from Secret Manager, the Cloud Run URLs serving now), builds with `app/e2e/build_mobile_release.py` and uploads: the App Bundle to the Google Play internal testing track (`play_upload.py`), the iOS archive to App Store Connect, where it appears in TestFlight.

The Web and mobile jobs run only after both services deployed. Data ingestion jobs (`cloud/data/infra/deploy.sh`) are not released here: each source is admitted and applied on its own.

[`app-ci.yml`](../workflows/app-ci.yml) checks every pull request and push to `main` that touches `app/` on the same Mac: analyze, tests, and an unsigned release compile for Android and iOS. It uses no keys or cloud credentials.

## Release

```sh
git tag v1.2.0 origin/main
git push origin v1.2.0
```

Progress, the deployed revisions and the mobile build numbers are on the run's summary page. The Hosting evidence (`plan.json`, `before.json`, `backend-*.json`, `result.json`) and `release-provenance.json` are kept as the run artifact `hosting-release-evidence`.

To release one part only, run the workflow by hand (Actions, Release, Run workflow) on a tag or `main` and pick `cloud`, `web` or `mobile`. A `web` or `mobile` release binds to the services as they run now.

Mobile versions: tag `v1.2.0` builds version `1.2.0`; a run on `main` keeps the `pubspec.yaml` version name. The build number (Android `versionCode`, iOS `CFBundleVersion`) is the workflow run number, which only grows. Rerunning a failed mobile job keeps its number, so retry only the platform that failed; a store refuses a number it already has.

Rollback: push a new tag on the older commit, or, for the Web app only, roll back the release in the Firebase console (Hosting, Release history). A mobile build is not live for anyone outside the testers until it is promoted in the Play Console or submitted for review in App Store Connect, which stays manual.

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
.github/release/bootstrap.sh --apply --confirm-project melens-510012 --web-config app/config/dev.json \
  --mobile-config app/config/dev.json
.github/release/bootstrap.sh --verify              # read-only audit
```

It creates, without a service account key:

| Resource | Purpose |
| --- | --- |
| Workload identity pool `github`, provider `melens` | GitHub's OIDC token for this repository (by repository id) becomes Google credentials, only in jobs of the GitHub environment `production` on a `v*` tag or `main` |
| Service account `melens-github-release` | The release identity. Roles: `run.admin`, `cloudbuild.builds.editor`, `artifactregistry.reader`, `firebasehosting.admin`, `serviceusage.serviceUsageConsumer` to deploy; `viewer`, `iam.securityReviewer`, `bigquery.jobUser` and `READER` on `melens_query` for the audits in the deploy scripts; `iam.serviceAccountUser` on `melens-dev-query`, `melens-dev-agent` and the Cloud Build worker; object access to `gs://melens-510012_cloudbuild` |
| Secret `melens-web-release-config` | The Web build's browser keys (`FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `GOOGLE_MAPS_WEB_API_KEY`, `GOOGLE_MAPS_MAP_ID`). `--web-config` copies only these keys from the given app config. Everything else in the release configuration is fixed or read from Cloud Run |
| Secret `melens-mobile-release-config` | The mobile builds' keys (`FIREBASE_MESSAGING_SENDER_ID`, the `FIREBASE_ANDROID_*` and `FIREBASE_IOS_*` pairs, `GOOGLE_MAPS_IOS_API_KEY`, `GOOGLE_MAPS_MAP_ID`), copied the same way by `--mobile-config` |
| API `androidpublisher.googleapis.com` | The Android upload calls the Google Play Developer API with the release identity's token, so there is no Play service account key |

To rotate a key, rerun `--apply` with `--web-config` or `--mobile-config` pointing at a config holding the new key, then release.

In GitHub, the `production` environment is created on the first run. Adding required reviewers or limiting it to `v*` tags (Settings, Environments) adds a manual gate; the token condition above already limits which refs can deploy.

## Mobile apps

The mobile jobs and `app-ci.yml` run on a self-hosted runner on the release Mac (an Apple silicon Mac mini, labels `self-hosted`, `macOS`, `ARM64`), because iOS needs Xcode and both signing keys stay on that Mac instead of in GitHub. One release job runs at a time; the iOS and Android jobs queue behind each other.

### Release Mac

| What | Where |
| --- | --- |
| Runner | `~/actions-runners/melens-1`, a LaunchAgent (`actions.runner.at2am-melens.*`). It runs only while the user is logged in, which iOS signing needs for the login keychain |
| Toolchain | Xcode, CocoaPods, fvm (installs the SDK in `app/.fvmrc` on first use), JDK 17 and the Android SDK (`JAVA_HOME`, `ANDROID_HOME` in the runner's `.env`), `gcloud`, Python 3 |
| Android upload key | `~/.melens-release/android/upload-keystore.jks` and `key.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`), mode 600. Created 2026-10-17, alias `upload`, SHA-256 `84:3D:97:C4:F9:C5:6B:42:99:B0:96:41:1C:95:EC:8B:05:E3:04:85:C7:A6:15:B9:4B:9B:02:23:A4:DD:80:13`. Keep a copy in a password manager: Play App Signing holds the app signing key, but replacing a lost upload key needs a Play support request |
| App Store Connect API key | `~/.melens-release/ios/AuthKey_<KEY ID>.p8` and `~/.melens-release/ios/app-store-connect.env` with `ASC_KEY_ID=` and `ASC_ISSUER_ID=` lines. Xcode uses it to create the distribution certificate and profiles (cloud-managed, team `ZF5UMMPVX9`) and to upload |
| iOS signing keychain | `~/Library/Keychains/melens-signing.keychain-db`, first on the user keychain search list, its password in `~/.melens-release/ios/keychain-password`. It holds the Apple Development certificate the archive signs with (created 2026-10-17 through the API, id in `signing-certificate.json`, expires 2027-10-17). The runner's LaunchAgent creates its own security session, where the login keychain stays locked and codesign fails with `errSecInternalComponent`; the release job unlocks this keychain instead. Recreate it with `ios_signing_keychain.py --apply` after deleting it, and revoke the old certificate in App Store Connect |

gcloud in the release job uses a configuration under the job's temporary folder and the Workload Identity credentials, so it never changes the Mac user's own gcloud account or project.

### One-time setup

1. **Runner.** In the repository settings (Actions, Runners, New self-hosted runner) take a registration token, then in `~/actions-runners/melens-1` run `./config.sh --url https://github.com/at2am/melens --token <token> --unattended`, write `JAVA_HOME` and `ANDROID_HOME` to `.env`, and `./svc.sh install && ./svc.sh start`.
2. **Public repository.** The repository becomes public at submission. Jobs on this runner skip pull requests from forks, and in Settings, Actions, General, "Require approval for all external contributors" keeps their workflows from starting at all. Never remove the fork check in `app-ci.yml`: a fork's code would run on the release Mac next to the signing keys.
3. **iOS.** In App Store Connect create the app (bundle id `com.at2am.melens`, team `ZF5UMMPVX9`; the App ID needs no capabilities). In Users and Access, Integrations, App Store Connect API, create a team key with the Admin role (cloud-managed distribution certificates need it), and save it and its ids as in the table above. Then run `python3 .github/release/ios_signing_keychain.py --apply` for the signing keychain.
4. **Android (later).** Releases are iOS only until this step is done; then set the repository variable `MOBILE_PLATFORMS` to `["android", "ios"]`. In the Play Console create the app (`com.at2am.melens`) and enrol in Play App Signing. The API cannot create the first release: build once by hand and upload it to Internal testing in the console:
   ```sh
   cd app
   MELENS_ANDROID_KEY_PROPERTIES=$HOME/.melens-release/android/key.properties \
     python3 e2e/build_mobile_release.py --platform android --build-name 0.1.0 --build-number 1
   ```
   (with `config/mobile-release.json` written as the release job does). Then, in Users and permissions, invite `melens-github-release@melens-510012.iam.gserviceaccount.com` with Release to testing tracks on this app.
5. **Secrets.** Run `bootstrap.sh --apply` with `--mobile-config` (above).

Until the app's first internal release is rolled out, Play accepts only draft releases from the API: set the repository variable `PLAY_RELEASE_STATUS` to `draft`, then delete it.
