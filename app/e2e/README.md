# Local browser verification

These tests cover the current Feed, Discover and Settings shell. The live target reads real published map records through the local service. The sample target uses the explicit sample repository. Neither target substitutes sample data after a live failure.

Use Node 24 and the Flutter version pinned in `app/.fvmrc`. Fetch and inspect `origin/main` before choosing the tested revision. Preserve any local changes before updating the checkout.

Start the local services from `cloud/`:

```sh
AGENT_ALLOWED_ORIGINS=http://localhost:8000,http://localhost:8001 \
MAP_ALLOWED_ORIGINS=http://localhost:8000,http://localhost:8001 npm run dev
```

Create ignored `app/config/local-e2e-live.json` and `local-e2e-sample.json` from the local development configuration. Set `MELENS_ENV=dev`, the matching `MAP_DATA_MODE`, `MAP_BASE_URL=http://localhost:8081`, `AGENT_BASE_URL=http://localhost:8080` and the local development token. Use the existing project browser Maps key with Web-origin and Maps JavaScript API restrictions. A Google demo key is not an acceptance configuration: its shared daily quota can expire during a run. The camera test must show real map objects and complete a real pan and area query. Do not commit populated configurations.

Build both variants from this directory:

```sh
npm ci
python3 build.py --mode live
python3 build.py --mode sample
```

For acceptance, use a new output directory for each suite. Capture the served build before and after the generated report:

```sh
suite_id="$(date -u +%Y%m%dT%H%M%SZ)"
E2E_TELEMETRY_DISABLED=1 node tests/run-with-receipt.mjs \
  --config e2e.nonparking.config.ts --exclude-tag parking --output ".e2e/${suite_id}-ui"
E2E_TELEMETRY_DISABLED=1 node tests/run-with-receipt.mjs \
  --config e2e.agent.config.ts --output ".e2e/${suite_id}-agent"
E2E_TELEMETRY_DISABLED=1 node tests/run-with-receipt.mjs \
  --config e2e.events.config.ts --output ".e2e/${suite_id}-events"
```

The selected scope is 22 UI cases across the live and sample targets, 3 real agent cases and 1 local event case. Parking is excluded. `E2E_TELEMETRY_DISABLED=1 npm run test:all` provides the same sequential developer checks without the before/after receipts. Use the receipt commands above for release acceptance.

Run these suites in sequence. The local agent uses one development user. The agent suite calls real Gemini through Vertex AI and creates temporary in-memory conversations. The event suite creates, cancels and removes only its own temporary local event. These suites do not write production Firestore data.

The build and server check the commit, app source hash, bundle and required assets. Each browser test checks the served provenance before it opens the app. A reused server cannot pass with an older source revision. The server disables caching and supports client routes.

Reports, screenshots and served build receipts are generated under `.e2e/`. Do not edit the generated reports. Each receipt binds the exact run ID and start/finish times to byte-identical before/after HTTP manifests and the actual JavaScript hashes. Run `tests/run-with-receipt.mjs --help` for the supported configurations.

A passing local suite does not prove deployment, source admission, a natural scheduler execution or all product use cases. Cloud source gaps and replay data must be reported separately. Generated run artifacts and diagnostic probes stay outside the source commit. The dated release summary and input note are retained unchanged as archived evidence. They do not certify the current main.

## Separate local ports

The defaults are live `8000`, sample `8001`, agent `8080` and map `8081`. Override them with `E2E_LIVE_URL`, `E2E_SAMPLE_URL`, `E2E_AGENT_URL` and `E2E_MAP_URL`. Each value must be an HTTP loopback origin without credentials, a path or a query. The application manifest must identify the same agent and map endpoints before any local writes. Live or sample behavior comes from the manifest's `dataMode`, not the port number.

When another session owns the default ports, keep its services running. For example, use agent `8090`, map `8091` and the allowed Maps origin `8001`:

```sh
export E2E_LIVE_URL=http://localhost:8001
export E2E_SAMPLE_URL=http://localhost:8001
export E2E_AGENT_URL=http://localhost:8090
export E2E_MAP_URL=http://localhost:8091
```

Set the same backend URLs in the ignored build configurations. Serve the live build on `8001`, run the UI receipt command with `--target live`, then run agent and events in sequence. Switch only the test-owned static server on `8001` to the sample build, then run the UI receipt command with `--target sample` and a new output directory. This selects 11 live UI, 3 agent, 1 event and 11 sample UI cases. The receipt captures only the selected UI target. Do not run both UI targets together when they share an origin. The two separate UI reports remain separate generated reports.

## Verification after a main update

Historical acceptance used main `2f0374a52a0ff56bb460b5257dabc2f46f32e63c` with dirty app source `32c674bc8576984a1ab847a06960b4ab2be4fbe7b5fade49e0de16117975485e`. Its 26 local and 6 cloud passes describe that build only. They do not certify a later merge or commit. Preserve those reports and create fresh evidence after the integrated candidate is frozen and rebuilt.

Current main includes the physical `geo_records_current` and `geo_records_current_state` tables, publication refresh logic and map-serving views. The earlier release summary's claim that physical current tables were unimplemented is historical. Source implementation does not establish which schema or image is deployed. A new deployment requires its own runtime evidence. GCS delivery, source admission, recollection and anomaly production also need their own evidence; these browser suites do not certify them.

Functional Feed and agent input tests synchronize the Flutter semantics focus handoff. After a real tap, the driver waits for two animation frames with a timeout, confirms that the same editable element is still focused, sends the text once and checks the full value. This does not repair the separate SDK instant-input race. The retained local negative probes record that boundary. The cold Tooltip test keeps continuous input across Tooltip appearance and removal without adding a map-ready wait.

## Cloud Hosting release

Create ignored `app/config/cloud-release.json` with `MELENS_ENV=prod`, `MAP_DATA_MODE=live`, the cloud service URLs and no development token. Build from the repository root. Supply the exact Cloud Run revision names and immutable image digests from the approved backend release:

```sh
python3 app/e2e/build_release.py \
  --map-revision "$MAP_REVISION" --agent-revision "$AGENT_REVISION" \
  --map-image-digest "$MAP_IMAGE_DIGEST" --agent-image-digest "$AGENT_IMAGE_DIGEST"
python3 app/e2e/hosting_release.py
```

The first command creates `app/build/web-cloud-release` and checks all assets, including fonts. The second command creates a local upload plan. It does not obtain a token or call a cloud API. Both commands reject changed source, configuration or bundle files.

Run the explicit publish command only after release approval:

```sh
python3 app/e2e/hosting_release.py --apply --confirm-project melens-510012
```

The tool only publishes to `melens-510012`. Before the first cloud write, it saves the previous live release and version metadata under `/tmp/melens-hosting-release-*`. This directory also contains the file hashes and release progress. The access token stays in memory. A finalized version remains unpublished if the workspace or live release changes during upload.

Cloud acceptance requires the deployed release to match the current commit and app source hash, the served JavaScript hash, and the exact Cloud Run revisions and immutable image digests. Run the 3 `cloud-ui` cases before the 3 `cloud-model` cases with separate fresh receipt directories. Firebase anonymous authentication must use a real ID token. The tests remove only the feeds and sessions they create. A historical Hosting release cannot pass the current-source gate.
