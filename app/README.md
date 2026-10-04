# Melens app

**Status:** Draft. Package choices and layout proposed on 2026-09-28; the team has not reviewed them yet.

The Flutter app for Android, iOS and Web. The Web build on Firebase Hosting is the submission URL. The Android application id and iOS bundle id are `com.at2am.melens` (team id `at2am`). Read [AGENTS.md](../system-design/AGENTS.md) and [agent-protocol.md](../system-design/agent-protocol.md) before changing the app.

## Quick start

```sh
cd app
fvm install                            # Flutter 3.47.5, pinned in .fvmrc
cp config/example.json config/dev.json
fvm flutter run -d chrome --dart-define-from-file=config/dev.json
```

Without [fvm](https://fvm.app), install Flutter 3.47.5 stable and drop the `fvm` prefix.

| Task | Command |
| --- | --- |
| Run | `fvm flutter run -d chrome --dart-define-from-file=config/dev.json` |
| Generate code after changing a `@riverpod`, `@freezed` or `@JsonSerializable` file | `fvm dart run build_runner build` (or `watch`) |
| Generate strings after editing `lib/l10n/app_en.arb` | `fvm flutter gen-l10n` (`run` and `pub get` also do it) |
| Analyze | `fvm flutter analyze` |
| Test | `fvm flutter test` |
| Format | `fvm dart format lib test` |
| Build the Web app | `fvm flutter build web --dart-define-from-file=config/prod.json` |

## Package choices

| Concern | Choice | Why | Not chosen |
| --- | --- | --- | --- |
| Navigation | `go_router` | The Flutter team's router. URL-based, which the Web build needs, with redirects for auth later (UC-07, UC-09) | `auto_route` (third-party, codegen) |
| State | `flutter_riverpod` 3 with `riverpod_generator` | Async map queries and streamed agent turns. Auto-dispose cancels work when nothing listens. `riverpod_lint` runs in `flutter analyze` | `bloc` (more boilerplate per feature), `provider` (superseded by Riverpod) |
| Dependency injection | Riverpod providers | One mechanism for state and services. Any provider can be overridden in tests, and `ref.onDispose` handles lifecycles | `get_it` / `injectable` (a second container, with no lifecycle or test scoping) |
| Localization | gen-l10n: `flutter_localizations`, `intl`, ARB files | Official and type-safe. English only (Maps grounding supports only English), `en_AU` formats | `easy_localization`, `slang` |
| Agent framework | None. A thin client on `http` plus `SseDecoder` | The app never calls a model (AGENTS.md); it speaks our own SSE protocol | `firebase_ai` (calls models from the app, which the rules forbid); `flutter_ai_toolkit` (built for app-side model providers and plain chat); `genui` / A2UI (the agent composes the UI, which conflicts with fixed card types and server-side source checks; could be revisited for cards) |
| Models and JSON | `freezed`, `json_serializable` | Sealed unions for event and card types, so a `switch` must handle every type | `dart_mappable` |
| HTTP | `http` | Streams response bodies on every platform, including the Web, and supports `AbortableRequest` (see [Web](#web)) | `dio` (its Web adapter uses XHR and cannot stream); `fetch_client` (no longer needed) |
| Widgets | `material_ui` | Material has moved out of the Flutter SDK, and `go_router` 18 builds its pages with it | `package:flutter/material.dart` (the legacy copy; mixing both gives two `Theme` types) |
| 2D map | `google_maps_flutter` | Google Maps with shared camera/point/circle/line/polygon types across Web, Android and iOS. Web is the first acceptance target | Built-in heatmap and 3D are outside the P0 map setup |
| Web overlay input | `pointer_interceptor` | Captures pointer events on Flutter controls above the Maps HTML platform view | Controls that allow clicks to pass through to the map |
| Time | `timezone` | Melbourne local time on any device (tools.md, Conventions) | Device local time |
| Logging | `logging` | Official, with named loggers | `logger`, `talker` |
| Lints | `flutter_lints`, strict analyzer modes, `riverpod_lint` | | `very_good_analysis` (too strict for a three-week build) |

## Layout

```
lib/
  main.dart             calls bootstrap()
  app/                  bootstrap, MaterialApp, router, theme
  core/                 cross-cutting code that knows no feature
    config/             Env, from --dart-define-from-file
    logging/            console logging, provider failure logging
    network/            the HTTP client provider, SseDecoder
    time/               MelbourneClock, protocol time format
  features/<feature>/   one folder per feature
    data/               clients, repositories, freezed models
    state/              providers and notifiers
    ui/                 screens and widgets
  l10n/                 app_en.arb and the generated AppLocalizations
test/                   mirrors lib/
config/                 build config; only example.json is committed
```

Where the parts in [agent-protocol.md](../system-design/agent-protocol.md#flutter-implementation) go:

| Part | Location |
| --- | --- |
| `AgentClient` and the protocol models | `lib/features/agent/data/` |
| `ChatController` | `lib/features/chat/state/` |
| `MapActions` | `lib/features/map/state/` |
| Card registry, one widget per card type | `lib/features/cards/ui/` |

## Conventions

- Import `package:material_ui/material_ui.dart`, never `package:flutter/material.dart`. Wrap a third-party widget that still uses the old library in `MaterialUiCompatibilityBridge`.
- Every user-visible string goes in `lib/l10n/app_en.arb` with a description, and is read with `AppLocalizations.of(context)`.
- State and services are providers declared with `@riverpod`. No globals, singletons or service locators. App-lifetime services use `@Riverpod(keepAlive: true)`.
- Read the time from `melbourneClockProvider`, not `DateTime.now()`, and send times with `toProtocolString()`.
- Navigate with `AppRoutes` constants, not string literals.
- Log with a named `Logger`, never `print`.
- Colours come from `Theme.of(context).colorScheme`, never hard-coded values.
- Generated files (`*.g.dart`, `*.freezed.dart`, `lib/l10n/app_localizations*.dart`) are committed, so the repo builds right after a clone. Regenerate them in the same commit as the source change.
- JSON keys: the agent protocol uses camelCase, which matches Dart field names. Card item fields in [tools.md](../system-design/tools.md#show_card) are snake_case; until F3 settles one style, map those with `@JsonKey(name: ...)`.
- Map data uses the frozen [map contract v1](../specs/002-map-data-presentation/contracts/map-api.md): camelCase JSON with GeoJSON geometry in longitude/latitude order. A dedicated read-only Cloud Run service queries admitted, published BigQuery views. Flutter never receives SQL or BigQuery credentials. The explicit sample repository is development-only, visibly labelled, and never substitutes for a live failure.

## Configuration

Build-time values come from `--dart-define-from-file=config/<env>.json`. The files are gitignored because they may hold keys (AGENTS.md, hard rule 5); `config/example.json` lists every key. Add a key to `lib/core/config/env.dart`, `config/example.json` and this table in the same commit.

| Key | Meaning | Default |
| --- | --- | --- |
| `MELENS_ENV` | `dev` or `prod` | `dev` |
| `AGENT_BASE_URL` | The agent service on Cloud Run, called directly and not through Firebase Hosting | `http://localhost:8080` |
| `MAP_BASE_URL` | The separate read-only map query service, serving bounded v1 JSON/GeoJSON | `http://localhost:8081` |
| `MAP_DATA_MODE` | `live` or explicit development-only `sample`; live failures retain their error/coverage state | `live` |
| `GOOGLE_MAPS_WEB_API_KEY` | Browser-restricted key for the Maps JavaScript API; read by the Web loader | Empty, map setup unavailable |
| `GOOGLE_MAPS_MAP_ID` | Optional 2D map ID passed to `GoogleMap(mapId: ...)`; advanced markers and the later vector 3D pilot require an appropriate ID | Empty |

`config/example.json` explicitly selects `sample` for development. Samples must carry the persistent Sample data label. Production uses `MELENS_ENV=prod` and `MAP_DATA_MODE=live`; the app rejects production sample mode at startup. The service URL must be HTTP(S), without credentials, query or fragment. The map repository never changes data mode after a failed live request.

On the Android emulator, the host machine is `10.0.2.2`, not `localhost`. Cloud Build should write ignored `config/prod.json` from Secret Manager before `flutter build web`. Browser Maps keys are visible in the built app and network requests; restrict the key to the intended Web origins and Maps JavaScript API. Do not print keys or commit populated configuration files.

## Web

- URLs have no `#` (`usePathUrlStrategy`), so Firebase Hosting needs a rewrite from `**` to `/index.html`.
- Streaming was checked on 2026-09-28 in Chrome with `http` 1.6.0 against a local SSE server. Events arrived as the server sent them, 400 ms apart. Completing an `AbortableRequest`'s trigger closed the connection, and the server saw it. The `Authorization` header passed the CORS preflight. The agent service must allow CORS from the Web origin, including that header.

## Maps Web setup

The dependency and loader are configured; the current map screen is still a placeholder. A real browser-restricted key has not been supplied or validated by this setup. Both live and sample overlays need a configured base map key.

1. Enable Maps JavaScript API in the Google Cloud project and configure its billing and Web-origin restrictions. Put the key in ignored `config/dev.json` under `GOOGLE_MAPS_WEB_API_KEY`.
2. Create a `GoogleMapsWebApiLoader` in a provider and await `load(env)` before constructing the Web `GoogleMap`. The helper calls the loader in `web/index.html` through supported Dart JS interop. It uses the compile-time key from `Env`, so no key substitution or second Maps script is needed in HTML.
3. Pass a nonempty `env.googleMapsMapId` to `GoogleMap(mapId: ...)` when configured; use `null` for the basic 2D map without an ID. The loader requests the `marker` library. Base circles, polylines and polygons use Maps core APIs. Deprecated drawing and visualization libraries are not requested.
4. Use a bounded map widget and `PointerInterceptor` around Flutter controls placed above its Web platform view. Keep app imports on `material_ui`. The locked Maps plugin and Web implementation still import legacy `flutter/material.dart`; wrap the `GoogleMap` subtree in `MaterialUiCompatibilityBridge` when integrating T015.

The loader shares an in-flight request, waits for the SDK callback and surfaces missing-key, network, initial authorization and 15-second readiness errors. A failed request can be retried explicitly. Its successful callback proves SDK readiness; actual map rendering and any later provider authorization error need the T015 browser acceptance with a real key. Native calls to the Web helper fail explicitly; Android/iOS SDK keys and native acceptance remain separate work.

The locked plugin version targets Flutter 3.47+ and Dart 3.13+, matching the existing pins. Google Maps Flutter documents Android SDK 24+, iOS 15+ and Web support, with feature differences by platform. Native SDK implementation choice and minimum target versions are reviewed when native acceptance is scheduled.

Setup validation commands after dependency resolution:

```sh
fvm flutter test --no-pub test/core/config
node --test test/core/config/maps_web_script_test.cjs
```

Sources: [Maps Flutter plugin](https://pub.dev/packages/google_maps_flutter), [endorsed Web setup](https://pub.dev/packages/google_maps_flutter_web), [JavaScript API loader](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [Material compatibility bridge](https://pub.dev/packages/material_ui).

## Not set up yet

| Item | Why it waits | Already decided |
| --- | --- | --- |
| Firebase: `firebase_core`, `firebase_auth` | Needs the Firebase project and its registered apps (`flutterfire configure`) | Anonymous Auth supplies the agent ID token ([agent-protocol.md](../system-design/agent-protocol.md#authentication)). Firestore map listeners are superseded by the read-only map query service. Any future user-data store is a separate decision. Still open: whether to commit `firebase_options.dart`. Firebase client config is not a secret, but hard rule 5 bans committed API keys |
| Live Maps acceptance | Needs a configured and authorized Maps key on each scheduled platform | Dependency and Web loader are prepared; 2D surface integration is T015, native setup is separate |
