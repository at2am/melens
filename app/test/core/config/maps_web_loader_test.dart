import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/config/maps_web_loader.dart';

void main() {
  Env createEnv({String key = 'configured-test-key'}) => Env(
    environment: AppEnvironment.dev,
    agentBaseUrl: Uri.parse('http://localhost:8080'),
    mapBaseUrl: Uri.parse('http://localhost:8081'),
    mapDataMode: MapDataMode.sample,
    googleMapsWebApiKey: key,
    googleMapsMapId: 'configured-test-map-id',
  );

  test(
    'missing key fails before a network request even with sample data',
    () async {
      var calls = 0;
      final loader = GoogleMapsWebApiLoader(
        loadScript: (_, _) async {
          calls++;
        },
      );
      await expectLater(loader.load(createEnv(key: '')), throwsStateError);
      expect(calls, 0);
    },
  );

  test(
    'concurrent map setup shares one request and waits for readiness',
    () async {
      var calls = 0;
      final ready = Completer<void>();
      final loader = GoogleMapsWebApiLoader(
        loadScript: (key, mapId) {
          expect(key, 'configured-test-key');
          expect(mapId, 'configured-test-map-id');
          calls++;
          return ready.future;
        },
      );
      final first = loader.load(createEnv());
      final second = loader.load(createEnv());
      expect(identical(first, second), isTrue);
      expect(calls, 1);
      ready.complete();
      await Future.wait([first, second]);
      await loader.load(createEnv());
      expect(calls, 1);
    },
  );

  test(
    'a failed script request can be retried without changing data mode',
    () async {
      var calls = 0;
      final loader = GoogleMapsWebApiLoader(
        loadScript: (_, _) async {
          calls++;
          if (calls == 1) throw StateError('Controlled network failure');
        },
      );
      final env = createEnv();
      await expectLater(loader.load(env), throwsStateError);
      await loader.load(env);
      expect(calls, 2);
      expect(env.mapDataMode, MapDataMode.sample);
    },
  );

  test('a synchronous script error does not cache a failed request', () async {
    var calls = 0;
    final loader = GoogleMapsWebApiLoader(
      loadScript: (_, _) {
        calls++;
        if (calls == 1) throw StateError('Controlled loader failure');
        return Future<void>.value();
      },
    );
    await expectLater(loader.load(createEnv()), throwsStateError);
    await loader.load(createEnv());
    expect(calls, 2);
  });
}
