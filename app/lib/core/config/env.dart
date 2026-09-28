import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'env.g.dart';

enum AppEnvironment { dev, prod }

/// Build-time configuration.
///
/// Values come from `--dart-define-from-file=config/<env>.json`; see
/// `config/example.json` for the keys. The files are gitignored because they
/// may hold keys (AGENTS.md, hard rule 5). Add a key here, to
/// `config/example.json` and to the app README in the same commit.
final class Env {
  const Env({required this.environment, required this.agentBaseUrl});

  /// The values this build was compiled with, with local-dev defaults.
  ///
  /// Throws at startup if `MELENS_ENV` is not a known environment.
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
  );

  final AppEnvironment environment;

  /// The agent service on Cloud Run. Call its URL directly, never through
  /// Firebase Hosting, which cuts streams after 60 seconds
  /// (architecture.md, Deployment constraints).
  final Uri agentBaseUrl;

  bool get isDev => environment == AppEnvironment.dev;

  String get name => environment.name;
}

/// The build's [Env]. Tests override it with `envProvider.overrideWithValue`.
@Riverpod(keepAlive: true)
Env env(Ref ref) => Env.fromDefines;
