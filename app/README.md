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
| Run | `fvm flutter run -d chrome --web-port 8000 --dart-define-from-file=config/dev.json` (a fixed port so the agent service can allow the origin, see [Testing the agent](#testing-the-agent-locally)) |
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
| Agent sign-in | `firebase_core`, `firebase_auth` | Anonymous Auth gives every user a uid without a sign-in screen ([agent-protocol.md](../system-design/agent-protocol.md#authentication)). `AnonymousSignIn` (`features/agent/data/agent_sign_in.dart`) starts Firebase lazily when the chat first needs a token, waits for the SDK to restore the persisted user and signs in anonymously only when there is none, so a reload or restart keeps the uid and with it the saved sessions. `FirebaseOptions` come from the build configuration rather than a committed `firebase_options.dart`, because hard rule 5 bans committed API keys; no `google-services.json` or `GoogleService-Info.plist` either. Added 2026-10-09 at releases at least two weeks old | `flutterfire configure` (commits the keys); a custom token service (a second auth system) |
| Photos | `image_picker` | The Flutter team's plugin for the gallery and camera on Web, Android and iOS; it downsizes before the bytes reach the app. Pinned in `pubspec.lock` to releases at least two weeks old when added (2026-10-09). iOS needs `NSPhotoLibraryUsageDescription` and `NSCameraUsageDescription` in `Info.plist` | `file_picker` (no camera, no resizing) |
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
  features/agent/       the agent protocol: models and the SSE client
  features/chat/        the chat panel: controller, session list, turn views
  features/cards/       the card registry, one widget per card type
  features/map/         the map screen, its state and MapActions
  features/events/      user events (UC-09): the client, state, panel, form and details
  l10n/                 app_en.arb and the generated AppLocalizations
test/                   mirrors lib/
config/                 build config; only example.json is committed
```

Where the parts in [agent-protocol.md](../system-design/agent-protocol.md#flutter-implementation) go:

| Part | Location |
| --- | --- |
| `AgentClient` and the protocol models | `lib/features/agent/data/` (`HttpAgentClient`, `agent_models.dart`) |
| `ChatController` | `lib/features/chat/state/chat_controller.dart`; the request context comes from `request_context.dart` |
| `SessionList` | `lib/features/chat/ui/session_list.dart`, backed by the same controller |
| `MapActions` | `lib/features/map/state/map_actions.dart` (`MapActionsController`); the map screen applies `focus_map` and shows highlights |
| Card registry, one widget per card type | `lib/features/cards/ui/card_registry.dart` |

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
| `AGENT_DEV_TOKEN` | A fixed bearer token for an agent service running locally in development mode (its `AGENT_DEVELOPMENT_TOKEN`), which accepts no Firebase ID token. When set, it is sent instead of the Firebase token. Development-only: a production build rejects it at startup | Empty: the app signs in to Firebase |
| `FIREBASE_PROJECT_ID`, `FIREBASE_MESSAGING_SENDER_ID` | The Firebase project of the agent's ID tokens | Empty |
| `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID`, and the `ANDROID` and `IOS` pairs | Each platform's Firebase client configuration. `cloud/agent/infra/firebase.sh --app-config config/dev.json` writes all eight keys without printing them. A platform without its pair, and a build with neither these nor `AGENT_DEV_TOKEN`, reports in the chat panel that sign-in is not configured | Empty |
| `MAP_BASE_URL` | The separate read-only map query service, serving bounded v1 JSON/GeoJSON | `http://localhost:8081` |
| `MAP_DATA_MODE` | `live` or explicit development-only `sample`; live failures retain their error/coverage state | `live` |
| `GOOGLE_MAPS_WEB_API_KEY` | Browser-restricted key for the Maps JavaScript API; read by the Web loader | Empty, map setup unavailable |
| `GOOGLE_MAPS_MAP_ID` | Optional 2D map ID passed to `GoogleMap(mapId: ...)`; advanced markers and the later vector 3D pilot require an appropriate ID | Empty |

`config/example.json` explicitly selects `sample` for development. Samples must carry the persistent Sample data label. Production uses `MELENS_ENV=prod` and `MAP_DATA_MODE=live`; the app rejects production sample mode at startup. The service URL must be HTTP(S), without credentials, query or fragment. The map repository never changes data mode after a failed live request.

On the Android emulator, the host machine is `10.0.2.2`, not `localhost`. Cloud Build should write ignored `config/prod.json` from Secret Manager before `flutter build web`. Browser Maps keys are visible in the built app and network requests; restrict the key to the intended Web origins and Maps JavaScript API. Do not print keys or commit populated configuration files.

## Testing the agent locally

The chat panel (toolbar speech-bubble button on the map screen) talks to the agent service through the [agent protocol](../system-design/agent-protocol.md). To test the agent from the app against a service running on your machine:

1. Start the map and agent services with `npm run dev` in `cloud/` ([agent README](../cloud/agent/README.md#local-commands)): it builds both and runs the map service on 8081 and the agent service in development mode on 8080 with `AGENT_ALLOWED_ORIGINS=http://localhost:8000` and `AGENT_DEVELOPMENT_TOKEN=dev`. Development mode keeps sessions in memory and accepts that fixed token for the uid `dev-user`. The service still needs a real Google Cloud project id (lowercase, for example `melens-510012`) and Application Default Credentials (`gcloud auth application-default login`) to reach Gemini; without credentials every turn fails with a retryable error, and the service log line `modelLoopFailed` carries the reason.
2. In `config/dev.json` set `AGENT_BASE_URL` to `http://localhost:8080` and `AGENT_DEV_TOKEN` to `dev`.
3. Run the app with `--web-port 8000`, so the browser origin matches the allowed origin and the `Authorization` header passes the CORS preflight.

What the panel shows, so the agent's behaviour can be judged turn by turn: every tool call as a step, live while it runs (a spinner, then its row count and duration, or its error), with the arguments it was called with and, for a UI action, whether the map applied it (`show_layers` toggles layers of the current topic, `focus_map` moves the camera, `highlight_features` lists chips above the map, `draw_route` is not drawn yet); a Thinking or Writing indicator between steps, so the user always sees that the turn is moving; the streamed answer in the order it arrived around the steps; every card with its sources and Google Maps attribution; the agent's question with its options; and the turn's token usage from Gemini's own counts (↑ input, ↓ output). Each card item is a tile of its own. A message sent while a turn runs interrupts it: the panel stops the turn, the server stores what it had, and the agent answers the new message with the stopped turn in its history; the stop button stops a turn without a new message. The photo button attaches up to four photos (gallery, or camera on phones) to a message, with or without text; photos larger than 1 MB after the picker's resizing, or of a type the service does not take, are re-encoded as a smaller PNG. Tapping a card item opens its details beside the map: a map record is selected (fetched by id when the map has not loaded it), and a Google Maps or web item shows what the card knows about it with its source link. The session list (history button) switches, creates and deletes conversations; the newest one is reopened when the panel first opens. Selecting a map record offers "Brief this area" (`area` input) and, for an anomaly, "Analyse this anomaly" (`analyse` input).

Against the deployed service, set `AGENT_BASE_URL` to its Cloud Run URL (`https://melens-dev-agent-saepk4k6hq-km.a.run.app` in development), leave `AGENT_DEV_TOKEN` empty and add the Firebase keys with `cloud/agent/infra/firebase.sh --project melens-510012 --verify --app-config app/config/dev.json` (from the repository root). Opening the chat signs in anonymously; the browser keeps the user in IndexedDB, so a reload restores the same sessions. The agent service allows only `http://localhost:8000` for CORS, so run the app with `--web-port 8000`. Clearing site data or switching browsers or devices starts a new anonymous user without the old sessions.

## User events

The events panel (toolbar calendar button on the map screen; a side panel when the window is at least 1050 px wide, a sheet otherwise) is UC-09: it talks to the agent service's `/v1/events` routes ([agent-protocol.md](../system-design/agent-protocol.md#user-events)) with the same bearer token as the chat. "Nearby" lists the published and cancelled events inside the map's viewport (cut down to the route's 10 km limit around its centre) for the next two weeks, reloading with a short debounce while the panel is open and the map moves, and the same events are drawn as violet pins on the map; "Mine" lists the events the user published and joined. An event opens to its details: anyone can show it on the map, join (optionally with a name shown to the organiser only, remembered for the session) or leave; the organiser can edit, cancel, remove and see the members, with a remove action per member, unless the event has anonymous attendance, in which case everyone, the organiser included, sees only how many are going. "Publish event" opens the form: title, description, place name, Melbourne start and optional end, the anonymous switch, an optional capacity, and the location, which is the map's centre when the form opens (move the map first, or press "Use map centre"). The form checks the protocol's limits before sending and shows the service's refusal (full, cancelled, ended, rate limited) under the action. Times are shown in Melbourne time through `melbourneClockProvider`.

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
| Live Maps acceptance | Needs a configured and authorized Maps key on each scheduled platform | Dependency and Web loader are prepared; 2D surface integration is T015, native setup is separate |
