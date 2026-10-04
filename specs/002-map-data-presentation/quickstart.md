# Map implementation validation guide

**Status**: T001–T009 preparation completed. The map-service package, typed repositories, providers and shared status widgets exist and pass [joint validation](validation.md). Public map routes and the rendered map surface are still future work.

## Prerequisites

- Complete G0 in [plan.md](plan.md), including contract review, fixture states, SDK/package resolution and file owners.
- Use the pinned app SDK and ignored config; never paste or commit keys.
- For real queries, use a view-only service identity and existing authorized development query views.
- Sample mode must be labelled and selected explicitly. No production fallback to samples.
- Record actual desktop/narrow browser hardware, browser version and network profile for SC-002. Record supported GPU/browser for later SC-009.

## Resolved SDK and browser environments (T002)

Recorded on 2026-10-01 in Australia/Melbourne. The committed pins remain Flutter `3.47.5` and Dart `^3.13.4`; no pin change was necessary. The [official release manifest](https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json) lists the stable macOS arm64 release with Dart `3.13.4`, and the installed framework revision matches its release hash. The earlier manifest URL with an extra `/flutter/` path returns 404 and must not be used. See the [official SDK archive](https://docs.flutter.dev/install/archive) and [FVM installation guide](https://fvm.app/documentation/getting-started/installation).

| Tool | Resolved version / executable |
| --- | --- |
| FVM | `4.3.1`, `/opt/homebrew/bin/fvm` (Homebrew installation) |
| Flutter | `3.47.5` stable, `/Users/alexgao/fvm/versions/3.47.5/bin/flutter` |
| Dart | `3.13.4`, `/Users/alexgao/fvm/versions/3.47.5/bin/cache/dart-sdk/bin/dart` |
| Framework | `6a19cca56475dbfba1478ee68d7bd0c2ef891da1` |
| Engine | `af7e796e161ae0bb1ff0758c71a7105418bd9ded` |
| DevTools | `2.60.0` |

These absolute executable paths are this workstation's values. FVM is on the existing Homebrew PATH; the unprefixed `flutter` and `dart` commands are not added globally. Use `fvm flutter` / `fvm dart` from the app, or the absolute executables above. The owner of T003 creates any ignored `app/.fvm/flutter_sdk` link and runs app dependency resolution; T002 did neither.

SDK preparation completed with `fvm install 3.47.5 --skip-pub-get` outside the repository and `flutter precache --web`. `flutter --version --machine` reports the versions above. `flutter doctor --verbose` recognizes Chrome and passes its network-resource check. Android SDK, full Xcode and CocoaPods are absent/incomplete; native Android, iOS and macOS acceptance remains separate from this Web preparation. The doctor warning about direct SDK executables not being on PATH is expected when using FVM.

| Environment | Actual host/browser | Measured CSS viewport | Browser settings |
| --- | --- | --- | --- |
| Desktop Web reference | Apple M5 (10 GPU cores), 32 GiB RAM, macOS `26.5.2` (`25F84`), Chrome `154.0.8037.59` | `1440 × 900`, DPR `1` | Desktop user agent, screen media, reduced motion off |
| Narrow Web reference | Same host and Chrome; narrow desktop-browser viewport | `390 × 844`, DPR `1` | Desktop user agent, screen media, reduced motion off |

The viewport values were observed through Chrome's debugging protocol after explicit device-metrics configuration; they are not inferred from outer window size. A plain `--window-size=390,844` launch was insufficient on this Chrome build: it produced a 500-pixel-wide content viewport. Reproduce the references by setting the CSS viewport explicitly, then record `innerWidth`, `innerHeight` and `devicePixelRatio` before collecting acceptance evidence. The narrow reference is a responsive Web environment, not a physical handset or native-platform acceptance.

Both isolated headless probes created a WebGL context and reported `ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)`. Chrome emitted display-link diagnostics during headless probing. These observations establish environment availability only; they do not establish map rendering correctness, animation smoothness or SC-009. Safari `26.5.2` is installed but was not exercised and is not an accepted reference yet.

**Network profile:** No artificial network or CPU throttling was applied. The probe loaded a local diagnostic document, so it measured no map-service or Maps-network latency. For SC-002, record the actual origin, connection profile and completed-response latency during the real integration run; for sample-mode UI measurements, record that no map-service network request was involved. Do not substitute the browser's nominal connection estimate for measured throughput/RTT.

**Acceptance status:** SDK installation, Web artifact preparation, browser probes, T003 dependency resolution, joint app analysis/tests and a Web build completed. Feature interaction/performance, human comprehension, real-source integration, deployed acceptance and the later 3D reference run remain outstanding.

## 1. Independent frontend development

```sh
cd app
fvm flutter pub get
fvm dart run build_runner build
fvm flutter gen-l10n
fvm flutter analyze
fvm flutter test
fvm flutter run -d chrome --dart-define-from-file=config/dev.json
```

Create ignored config/dev.json from config/example.json, which explicitly selects development sample mode and leaves Maps credentials empty. T005/T008/T009 provide the repositories, providers and labelled status/provenance widgets; the existing map screen is still a placeholder. T015–T017 connect these components to the map. Zoom, selection and same-location interaction scenarios belong to the later tasks. Foundation tests already cover state, historical labels, missing values and failed refreshes without live publication.

## 2. Independent map service development

T004 supplies these commands; use Node 24:

```sh
cd cloud/map
npm ci
npm run typecheck
npm test
npm run dev
```

The local server serves only GET /healthz and reports mapApiImplemented=false. Map routes return 404 until T011–T014. The fixed query runner can be tested through its injected adapter or local ADC, with dry-run/scan/row/size limits. Thirteen real dry runs validated SQL and parameters; current geo queries exceeded the default dynamic scan ceiling, as recorded in validation.md. Resolve that cost before live integration. An empty pedestrian layer requires coverage evidence; it is not a measured zero.

## 3. Real P0 integration

Replace the sample repository explicitly with HTTP. Check source publication and coverage from authorized views at the time of integration. Exercise real pedestrian counts with observation-effective locations, roads with valid time semantics, and tram/train references where publisher-version evidence permits.

Record count/location eligibility, unknown locations/times, retrieved source revisions, source links and timestamps. Test current and selected historical context. A roads preview or counts-only preview is not full UC-05/UC-04 acceptance.

## 4. Acceptance evidence

Record outcomes in validation.md, including:

- FR-010/024: noMatching versus no coverage, partial source failure, retained stale data, rapid viewport/time changes.
- FR-005/007: four bands, 0.2 hysteresis, selection retained or explicitly excluded.
- SC-001/002/003/004/010: measured interactions, truthful status and source/time precision. A spinner alone does not pass latency.
- Later stories: news priority/dedup/precision; same-vintage area comparison; H3 denominator/coverage; illustrative 3D/pause/fallback/cap.

Run required analyze/test/build steps after changed annotated/localization code and before commits. Regenerate and include generated files. No additional broad testing is needed when no related behavior changed.

## 5. Deployment

The integrator deploys the map service on Cloud Run and the Web app on Firebase Hosting using the proposed cloud/map/infra/deploy.sh and the existing project deployment conventions. Record URL, CORS origin, public-view permissions, key restrictions, scan ceilings and active release version. Deployment is followed by real browser acceptance; local fixture success alone is insufficient.

## Delivery scope

G1 is a development preview; G2 is the live map slice; G3 is full project P0 accepted by its owners. Later feature acceptance requires its data prerequisites and the project priority gate. Do not claim native or 3D acceptance from a desktop Web run.
