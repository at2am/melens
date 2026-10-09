import 'package:riverpod_annotation/riverpod_annotation.dart';

import 'map_data_mode.dart';

export 'map_data_mode.dart';

part 'env.g.dart';

enum AppEnvironment { dev, prod }

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
    return Env._(
      environment: environment,
      agentBaseUrl: agentBaseUrl,
      mapBaseUrl: mapBaseUrl,
      mapDataMode: mapDataMode,
      googleMapsWebApiKey: (googleMapsWebApiKey ?? '').trim(),
      googleMapsMapId: (googleMapsMapId ?? '').trim(),
      agentDevToken: devToken,
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

  /// A fixed bearer token for an agent service running in development mode
  /// (its `AGENT_DEVELOPMENT_TOKEN`), until Firebase Anonymous Auth supplies
  /// ID tokens (agent-protocol.md, Authentication). Empty in production, where
  /// the constructor rejects it. Never log this value.
  final String agentDevToken;

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
