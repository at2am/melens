import 'package:riverpod_annotation/riverpod_annotation.dart';

import 'map_data_mode.dart';

export 'map_data_mode.dart';

part 'env.g.dart';

enum AppEnvironment { dev, prod }

enum FirebasePlatform { web, android, ios }

/// One platform's Firebase client configuration, which
/// `cloud/agent/infra/firebase.sh --app-config` writes into the ignored
/// config file. It is not a secret, but its API key stays out of the repo
/// with the rest of the build configuration. Never log the key.
final class FirebaseClientConfig {
  const FirebaseClientConfig._({
    required this.projectId,
    required this.messagingSenderId,
    required this.apiKey,
    required this.appId,
  });

  /// Null unless every value is present.
  static FirebaseClientConfig? from({
    String? projectId,
    String? messagingSenderId,
    String? apiKey,
    String? appId,
  }) {
    final values = [
      projectId,
      messagingSenderId,
      apiKey,
      appId,
    ].map((value) => (value ?? '').trim()).toList(growable: false);
    if (values.any((value) => value.isEmpty)) return null;
    return FirebaseClientConfig._(
      projectId: values[0],
      messagingSenderId: values[1],
      apiKey: values[2],
      appId: values[3],
    );
  }

  final String projectId;
  final String messagingSenderId;
  final String apiKey;
  final String appId;
}

/// Build-time configuration.
///
/// Values come from `--dart-define-from-file=config/<env>.json`; see
/// `config/example.json` for the keys. The files are gitignored because they
/// may hold keys (AGENTS.md, hard rule 5). Add a key here, to
/// `config/example.json` and to the app README in the same commit.
final class Env {
  factory Env({
    required AppEnvironment environment,
    required Uri agentBaseUrl,
    required Uri mapBaseUrl,
    MapDataMode mapDataMode = MapDataMode.live,
    String? googleMapsWebApiKey,
    String? googleMapsMapId,
    String? agentDevToken,
    String? firebaseProjectId,
    String? firebaseMessagingSenderId,
    String? firebaseWebApiKey,
    String? firebaseWebAppId,
    String? firebaseAndroidApiKey,
    String? firebaseAndroidAppId,
    String? firebaseIosApiKey,
    String? firebaseIosAppId,
  }) {
    _requireServiceUrl(agentBaseUrl, 'AGENT_BASE_URL');
    _requireServiceUrl(mapBaseUrl, 'MAP_BASE_URL');
    if (environment == AppEnvironment.prod &&
        mapDataMode == MapDataMode.sample) {
      throw ArgumentError('MAP_DATA_MODE=sample is development-only.');
    }
    final devToken = (agentDevToken ?? '').trim();
    if (environment == AppEnvironment.prod && devToken.isNotEmpty) {
      throw ArgumentError('AGENT_DEV_TOKEN is development-only.');
    }
    final firebase = {
      for (final (platform, apiKey, appId) in [
        (FirebasePlatform.web, firebaseWebApiKey, firebaseWebAppId),
        (FirebasePlatform.android, firebaseAndroidApiKey, firebaseAndroidAppId),
        (FirebasePlatform.ios, firebaseIosApiKey, firebaseIosAppId),
      ])
        platform: ?FirebaseClientConfig.from(
          projectId: firebaseProjectId,
          messagingSenderId: firebaseMessagingSenderId,
          apiKey: apiKey,
          appId: appId,
        ),
    };
    return Env._(
      environment: environment,
      agentBaseUrl: agentBaseUrl,
      mapBaseUrl: mapBaseUrl,
      mapDataMode: mapDataMode,
      googleMapsWebApiKey: (googleMapsWebApiKey ?? '').trim(),
      googleMapsMapId: (googleMapsMapId ?? '').trim(),
      agentDevToken: devToken,
      firebase: firebase,
    );
  }

  const Env._({
    required this.environment,
    required this.agentBaseUrl,
    required this.mapBaseUrl,
    required this.mapDataMode,
    required this.googleMapsWebApiKey,
    required this.googleMapsMapId,
    required this.agentDevToken,
    required this.firebase,
  });

  /// The values this build was compiled with, with local-dev defaults.
  ///
  /// Invalid service URLs, unknown modes and production sample mode fail at
  /// startup. A missing Maps key leaves map setup unavailable until configured.
  static final fromDefines = Env(
    environment: AppEnvironment.values.byName(
      const String.fromEnvironment('MELENS_ENV', defaultValue: 'dev'),
    ),
    agentBaseUrl: Uri.parse(
      const String.fromEnvironment(
        'AGENT_BASE_URL',
        defaultValue: 'http://localhost:8080',
      ),
    ),
    mapBaseUrl: Uri.parse(
      const String.fromEnvironment(
        'MAP_BASE_URL',
        defaultValue: 'http://localhost:8081',
      ),
    ),
    mapDataMode: MapDataMode.values.byName(
      const String.fromEnvironment('MAP_DATA_MODE', defaultValue: 'live'),
    ),
    googleMapsWebApiKey: const String.fromEnvironment(
      'GOOGLE_MAPS_WEB_API_KEY',
    ),
    googleMapsMapId: const String.fromEnvironment('GOOGLE_MAPS_MAP_ID'),
    agentDevToken: const String.fromEnvironment('AGENT_DEV_TOKEN'),
    firebaseProjectId: const String.fromEnvironment('FIREBASE_PROJECT_ID'),
    firebaseMessagingSenderId: const String.fromEnvironment(
      'FIREBASE_MESSAGING_SENDER_ID',
    ),
    firebaseWebApiKey: const String.fromEnvironment('FIREBASE_WEB_API_KEY'),
    firebaseWebAppId: const String.fromEnvironment('FIREBASE_WEB_APP_ID'),
    firebaseAndroidApiKey: const String.fromEnvironment(
      'FIREBASE_ANDROID_API_KEY',
    ),
    firebaseAndroidAppId: const String.fromEnvironment(
      'FIREBASE_ANDROID_APP_ID',
    ),
    firebaseIosApiKey: const String.fromEnvironment('FIREBASE_IOS_API_KEY'),
    firebaseIosAppId: const String.fromEnvironment('FIREBASE_IOS_APP_ID'),
  );

  final AppEnvironment environment;

  /// The agent service on Cloud Run. Call its URL directly, never through
  /// Firebase Hosting, which cuts streams after 60 seconds
  /// (architecture.md, Deployment constraints).
  final Uri agentBaseUrl;

  /// Read-only map query service. Live failures never select sample data.
  final Uri mapBaseUrl;

  /// Sample data is selected explicitly and is permitted only in development.
  final MapDataMode mapDataMode;

  /// A browser-restricted Maps JavaScript API key. Never log this value.
  final String googleMapsWebApiKey;

  /// Optional for the base 2D map. Required for advanced markers and 3D.
  final String googleMapsMapId;

  /// A fixed bearer token for an agent service running locally in
  /// development mode (its `AGENT_DEVELOPMENT_TOKEN`), which accepts no
  /// Firebase ID token. Empty in production, where the constructor rejects
  /// it. Never log this value.
  final String agentDevToken;

  /// The Firebase client configuration of each platform this build has one
  /// for; the agent's ID tokens come from anonymous sign-in to that project
  /// (agent-protocol.md, Authentication).
  final Map<FirebasePlatform, FirebaseClientConfig> firebase;

  bool get isDev => environment == AppEnvironment.dev;

  bool get hasAgentDevToken => agentDevToken.isNotEmpty;

  bool get usesSampleMapData => mapDataMode == MapDataMode.sample;

  bool get hasGoogleMapsWebApiKey => googleMapsWebApiKey.isNotEmpty;

  String get name => environment.name;

  static void _requireServiceUrl(Uri uri, String key) {
    if (!uri.hasAuthority ||
        uri.host.isEmpty ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw ArgumentError(
        '$key must be an HTTP(S) URL without credentials, '
        'a query or a fragment.',
      );
    }
  }
}

/// The build's [Env]. Tests override it with `envProvider.overrideWithValue`.
@Riverpod(keepAlive: true)
Env env(Ref ref) => Env.fromDefines;
