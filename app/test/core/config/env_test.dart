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

  test('key readiness ignores whitespace without exposing key contents', () {
    expect(createEnv(key: '   ').hasGoogleMapsWebApiKey, isFalse);
    expect(
      createEnv(key: 'configured-test-key').hasGoogleMapsWebApiKey,
      isTrue,
    );
  });
}
