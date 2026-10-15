import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/config/native_maps_key.dart';
import 'package:melens/features/map/ui/map_surface.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Env createEnv({String iosKey = ''}) => Env(
    environment: AppEnvironment.dev,
    agentBaseUrl: Uri.parse('http://localhost:8080'),
    mapBaseUrl: Uri.parse('http://localhost:8081'),
    googleMapsIosApiKey: iosKey,
  );

  test('the iOS key is trimmed and optional', () {
    expect(createEnv().hasGoogleMapsIosApiKey, isFalse);
    expect(createEnv(iosKey: '   ').hasGoogleMapsIosApiKey, isFalse);
    expect(createEnv(iosKey: ' k ').googleMapsIosApiKey, 'k');
  });

  test('provide sends the key on the melens/maps channel', () async {
    const channel = MethodChannel('melens/maps');
    MethodCall? received;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          received = call;
          return null;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null),
    );

    await const NativeMapsKey().provide('ios-key');

    expect(received?.method, 'provideApiKey');
    expect(received?.arguments, 'ios-key');
  });

  group('readiness on iOS', () {
    setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.iOS);
    tearDown(() => debugDefaultTargetPlatformOverride = null);

    test('is missingKey without a key and never calls the SDK', () async {
      final container = ProviderContainer(
        overrides: [envProvider.overrideWithValue(createEnv())],
      );
      addTearDown(container.dispose);
      expect(
        await container.read(mapSurfaceReadinessProvider.future),
        MapSurfaceReadiness.missingKey,
      );
    });

    test('is ready once the native SDK has the key', () async {
      final container = ProviderContainer(
        overrides: [
          envProvider.overrideWithValue(createEnv(iosKey: 'ios-key')),
          nativeMapsKeyProvider.overrideWithValue(const _NoopNativeKey()),
        ],
      );
      addTearDown(container.dispose);
      expect(
        await container.read(mapSurfaceReadinessProvider.future),
        MapSurfaceReadiness.ready,
      );
    });
  });

  test('other native platforms stay unsupported', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final container = ProviderContainer(
      overrides: [envProvider.overrideWithValue(createEnv(iosKey: 'k'))],
    );
    addTearDown(container.dispose);
    expect(
      await container.read(mapSurfaceReadinessProvider.future),
      MapSurfaceReadiness.unsupportedPlatform,
    );
  });
}

final class _NoopNativeKey implements NativeMapsKey {
  const _NoopNativeKey();

  @override
  Future<void> provide(String apiKey) async {}
}
