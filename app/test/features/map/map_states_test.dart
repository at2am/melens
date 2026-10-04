import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/network/http_client.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/viewport_controller.dart';
import 'package:melens/features/map/ui/map_status.dart';

Map<String, dynamic> _fixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;

final _window = TimeWindow(
  from: DateTime.utc(2026, 10, 1, 0, 45),
  to: DateTime.utc(2026, 10, 1, 1),
);
const _bounds = MapBounds(
  west: 144.95,
  south: -37.83,
  east: 144.98,
  north: -37.8,
);

Env _env(MapDataMode mode) => Env(
  environment: AppEnvironment.dev,
  agentBaseUrl: Uri.parse('http://localhost:8080'),
  mapBaseUrl: Uri.parse('http://localhost:8081'),
  mapDataMode: mode,
);

Map<String, dynamic> _liveReply(http.Request request, String fixture) {
  final query = jsonDecode(request.body) as Map<String, dynamic>;
  return _fixture(fixture)
    ..['dataMode'] = 'live'
    ..['requestId'] = query['requestId']
    ..['mode'] = query['mode'];
}

ProviderContainer _container(http.Client client) {
  addTearDown(client.close);
  final container = ProviderContainer.test(
    overrides: [
      envProvider.overrideWithValue(_env(MapDataMode.live)),
      httpClientProvider.overrideWithValue(client),
    ],
  );
  _start(container);
  return container;
}

void _start(
  ProviderContainer container, {
  List<MapLayerId> layers = const [MapLayerId.pedestrian],
}) {
  final controller = container.read(viewportControllerProvider.notifier);
  controller.setWindow(MapQueryMode.current, _window, debounce: false);
  controller.setRegion(_bounds, 14, debounce: false);
  controller.setLayers(layers, debounce: false);
}

Future<ViewportState> _settle(ProviderContainer container) async {
  for (var i = 0; i < 30; i++) {
    await container.pump();
    await Future<void>.delayed(Duration.zero);
    final state = container.read(viewportControllerProvider);
    if (!state.isLoading) return state;
  }
  fail('Viewport request did not settle.');
}

void main() {
  test(
    'explicit sample mode reaches the viewport without a network client',
    () async {
      final container = ProviderContainer.test(
        overrides: [
          envProvider.overrideWithValue(_env(MapDataMode.sample)),
          httpClientProvider.overrideWith(
            (ref) =>
                throw StateError('Sample mode must not request live data.'),
          ),
        ],
      );
      _start(container);
      final state = await _settle(container);
      expect(state.error, isNull);
      expect(state.dataMode, MapDataMode.sample);
      expect(state.response!.dataMode, MapDataMode.sample);
      final items = state.response!.layers.single.items
          .cast<PedestrianMapItem>();
      expect(items.map((item) => item.details.totalCount), [12, 0]);
    },
  );

  test(
    'a sample envelope on the live path fails without a fallback result',
    () async {
      var calls = 0;
      final container = _container(
        MockClient((request) async {
          calls++;
          final reply = _liveReply(request, 'viewport')
            ..['dataMode'] = 'sample';
          return http.Response(jsonEncode(reply), 200);
        }),
      );
      final state = await _settle(container);
      expect(state.error, isA<MapContractException>());
      expect(state.response, isNull);
      expect(state.dataMode, MapDataMode.live);
      expect(calls, 1);
    },
  );

  test('failed time change retains original data and query time until manual retry', () async {
    var calls = 0;
    final container = _container(
      MockClient((request) async {
        calls++;
        if (calls == 2) {
          return http.Response(
            '{"error":{"code":"serviceUnavailable","retryable":true}}',
            503,
          );
        }
        return http.Response(jsonEncode(_liveReply(request, 'viewport')), 200);
      }),
    );
    final initial = await _settle(container);
    final original = initial.response!;
    final historical = TimeWindow(
      from: DateTime.utc(2026, 9),
      to: DateTime.utc(2026, 9, 1, 1),
    );
    container
        .read(viewportControllerProvider.notifier)
        .setWindow(MapQueryMode.historical, historical, debounce: false);
    final failed = await _settle(container);
    expect(failed.retainsPreviousResponse, isTrue);
    expect(failed.matchesResponseWindow, isFalse);
    expect(failed.response, same(original));
    expect(failed.response!.generatedAt, DateTime.utc(2026, 10, 1, 1));
    expect(
      failed.response!.layers.single.updatedAt,
      DateTime.utc(2026, 10, 1, 1),
    );
    expect(failed.responseQuery!.mode, MapQueryMode.current);
    expect(failed.responseQuery!.window, same(_window));
    expect(failed.mode, MapQueryMode.historical);
    expect(failed.canRetry, isTrue);
    await container.pump();
    expect(calls, 2, reason: 'No implicit retry follows a failed request.');

    await container.read(viewportControllerProvider.notifier).retry();
    final retried = await _settle(container);
    expect(calls, 3);
    expect(retried.error, isNull);
    expect(retried.response!.mode, MapQueryMode.historical);
    expect(retried.matchesResponseWindow, isTrue);
  });

  test('partial and failed layers preserve their independent states and unknown totals', () async {
    final client = MockClient((request) async {
      final reply = _liveReply(request, 'partial');
      final failed =
          (_fixture('unavailable')['layers'] as List).single
              as Map<String, dynamic>;
      failed['layerId'] = 'disruption';
      (reply['layers'] as List).add(failed);
      return http.Response(jsonEncode(reply), 200);
    });
    addTearDown(client.close);
    final container = ProviderContainer.test(
      overrides: [
        envProvider.overrideWithValue(_env(MapDataMode.live)),
        httpClientProvider.overrideWithValue(client),
      ],
    );
    _start(container, layers: [MapLayerId.pedestrian, MapLayerId.disruption]);
    final state = await _settle(container);
    expect(state.error, isNull);
    expect(state.hasPartialResults, isTrue);
    final layers = state.response!.layers;
    expect(layers.first.state, MapLayerState.available);
    expect(layers.first.totalMatching, isNull);
    expect(layers.first.items, hasLength(2));
    expect(layers.last.state, MapLayerState.unavailable);
    expect(layers.last.totalMatching, isNull);
    expect(layers.last.items, isEmpty);
  });

  test('noMatching survives transport only with complete verified exact-zero evidence', () async {
    var completeProof = true;
    final container = _container(
      MockClient((request) async {
        final reply = _liveReply(request, 'no-matching');
        final layer = (reply['layers'] as List).single as Map<String, dynamic>;
        if (!completeProof) layer['unresolvedCount'] = null;
        return http.Response(jsonEncode(reply), 200);
      }),
    );
    final verified = await _settle(container);
    expect(verified.error, isNull);
    expect(
      layerStateForPresentation(verified.response!.layers.single),
      MapLayerState.noMatching,
    );
    completeProof = false;
    await container.read(viewportControllerProvider.notifier).refresh();
    final invalid = await _settle(container);
    expect(invalid.error, isA<MapContractException>());
    expect(invalid.retainsPreviousResponse, isTrue);
  });

  test('live unlocated transport preserves null geometry and missing count alongside measured zero', () async {
    final client = MockClient((request) async {
      final query = jsonDecode(
        request.url.queryParameters['query']!,
      ) as Map<String, dynamic>;
      final reply = _fixture('unlocated')
        ..['dataMode'] = 'live'
        ..['requestId'] = query['requestId'];
      final items = reply['items'] as List;
      final zero = jsonDecode(jsonEncode(items.single)) as Map<String, dynamic>;
      zero['id'] = 'sample.sensor.zero-unlocated';
      (zero['details'] as Map<String, dynamic>)['totalCount'] = 0;
      items.add(zero);
      reply['totalMatching'] = 2;
      return http.Response(jsonEncode(reply), 200);
    });
    addTearDown(client.close);
    final container = ProviderContainer.test(
      overrides: [
        envProvider.overrideWithValue(_env(MapDataMode.live)),
        httpClientProvider.overrideWithValue(client),
      ],
    );
    final repository = container.read(mapRepositoryProvider);
    final page = await repository.getUnlocated(
      UnlocatedQuery(
        requestId: 'unlocated-real-transport',
        scope: const UnlocatedScope.sourceJurisdiction(
          'Sample Melbourne source jurisdiction',
        ),
        layers: const [MapLayerId.pedestrian],
        mode: MapQueryMode.current,
        window: _window,
      ),
    );
    expect(page.dataMode, MapDataMode.live);
    expect(page.items.every((item) => item.geometry == null), isTrue);
    expect(
      page.items.cast<PedestrianMapItem>().map(
        (item) => item.details.totalCount,
      ),
      [null, 0],
    );
    expect(page.totalMatching, 2);
  });
}
