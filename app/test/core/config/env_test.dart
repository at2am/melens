import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/config/env.dart';

void main() {
  Env createEnv({
    AppEnvironment environment = AppEnvironment.dev,
    MapDataMode mode = MapDataMode.live,
    String mapUrl = 'http://localhost:8081',
    String key = '',
  }) {
    return Env(
      environment: environment,
      agentBaseUrl: Uri.parse('http://localhost:8080'),
      mapBaseUrl: Uri.parse(mapUrl),
      mapDataMode: mode,
      googleMapsWebApiKey: key,
    );
  }

  test('live is the default and does not require a key at app startup', () {
    final env = createEnv();
    expect(env.mapDataMode, MapDataMode.live);
    expect(env.usesSampleMapData, isFalse);
    expect(env.hasGoogleMapsWebApiKey, isFalse);
  });

  test('sample data must be explicit and cannot be selected in production', () {
    expect(createEnv(mode: MapDataMode.sample).usesSampleMapData, isTrue);
    expect(
      () =>
          createEnv(environment: AppEnvironment.prod, mode: MapDataMode.sample),
      throwsArgumentError,
    );
  });

  test('map service URLs exclude invalid schemes and embedded credentials', () {
    for (final url in [
      '/map',
      'file:///map',
      'https://user:password@example.invalid',
      'https://example.invalid?key=anything',
      'https://example.invalid#map',
    ]) {
      expect(() => createEnv(mapUrl: url), throwsArgumentError);
    }
  });

  test('the agent development token is trimmed and development-only', () {
    expect(createEnv().hasAgentDevToken, isFalse);
    final env = Env(
      environment: AppEnvironment.dev,
      agentBaseUrl: Uri.parse('http://localhost:8080'),
      mapBaseUrl: Uri.parse('http://localhost:8081'),
      agentDevToken: ' dev ',
    );
    expect(env.agentDevToken, 'dev');
    expect(env.hasAgentDevToken, isTrue);
    expect(
      () => Env(
        environment: AppEnvironment.prod,
        agentBaseUrl: Uri.parse('https://agent.example'),
        mapBaseUrl: Uri.parse('https://map.example'),
        agentDevToken: 'dev',
      ),
      throwsArgumentError,
    );
  });

  test('a platform has a Firebase configuration only with every key', () {
    final env = Env(
      environment: AppEnvironment.prod,
      agentBaseUrl: Uri.parse('https://agent.example'),
      mapBaseUrl: Uri.parse('https://map.example'),
      firebaseProjectId: ' melens-test ',
      firebaseMessagingSenderId: '1234',
      firebaseWebApiKey: 'web-key',
      firebaseWebAppId: '1:1234:web:abc',
      firebaseAndroidApiKey: 'android-key',
      firebaseAndroidAppId: '  ',
    );
    expect(env.firebase.keys, [FirebasePlatform.web]);
    final web = env.firebase[FirebasePlatform.web]!;
    expect(web.projectId, 'melens-test');
    expect(web.apiKey, 'web-key');
    expect(createEnv().firebase, isEmpty);
  });

  test('key readiness ignores whitespace without exposing key contents', () {
    expect(createEnv(key: '   ').hasGoogleMapsWebApiKey, isFalse);
    expect(
      createEnv(key: 'configured-test-key').hasGoogleMapsWebApiKey,
      isTrue,
    );
  });
}
