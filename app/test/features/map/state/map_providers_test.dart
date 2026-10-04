import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/network/http_client.dart';
import 'package:melens/features/map/data/http_map_repository.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';

Env _env(MapDataMode mode) => Env(
  environment: AppEnvironment.dev,
  agentBaseUrl: Uri.parse('http://localhost:8080'),
  mapBaseUrl: Uri.parse('http://localhost:8081'),
  mapDataMode: mode,
);

ViewportQuery _query(String id) => ViewportQuery(
  requestId: id,
  bbox: const MapBounds(
    west: 144.95,
    south: -37.83,
    east: 144.98,
    north: -37.8,
  ),
  zoom: 14,
  layers: const [MapLayerId.pedestrian],
  mode: MapQueryMode.current,
  window: TimeWindow(
    from: DateTime.utc(2026, 10, 1, 0, 59),
    to: DateTime.utc(2026, 10, 1, 1),
  ),
);

void main() {
  test(
    'explicit development sample config does not create an HTTP client',
    () async {
      final container = ProviderContainer.test(
        overrides: [
          envProvider.overrideWithValue(_env(MapDataMode.sample)),
          httpClientProvider.overrideWith((ref) {
            throw StateError('Sample mode must not create a network client.');
          }),
        ],
      );

      expect(container.read(mapRepositoryProvider), isA<SampleMapRepository>());
      final query = _query('explicit-sample');
      final subscription = container.listen(
        mapViewportProvider(query),
        (previous, next) {},
      );
      addTearDown(subscription.close);
      final response = await container.read(mapViewportProvider(query).future);
      expect(response.dataMode, MapDataMode.sample);
      expect(response.requestId, 'explicit-sample');
    },
  );

  test(
    'live failure stays a failure and never substitutes sample data',
    () async {
      var requests = 0;
      final client = MockClient((request) async {
        requests++;
        expect(request.url.toString(), 'http://localhost:8081/v1/map/layers');
        return http.Response(
          '{"error":{"code":"serviceUnavailable","retryable":true}}',
          503,
        );
      });
      addTearDown(client.close);
      final container = ProviderContainer.test(
        overrides: [
          envProvider.overrideWithValue(_env(MapDataMode.live)),
          httpClientProvider.overrideWithValue(client),
        ],
      );
      expect(container.read(mapRepositoryProvider), isA<HttpMapRepository>());
      final subscription = container.listen(
        mapLayerCatalogProvider,
        (previous, next) {},
      );
      addTearDown(subscription.close);

      await expectLater(
        container.read(mapLayerCatalogProvider.future),
        throwsA(isA<MapHttpException>()),
      );
      await Future<void>.delayed(const Duration(milliseconds: 250));
      expect(
        requests,
        1,
        reason: 'A failed request requires an explicit retry.',
      );
      expect(container.read(mapLayerCatalogProvider).hasError, isTrue);
      expect(container.read(mapLayerCatalogProvider).hasValue, isFalse);
    },
  );

  test('disposing viewport provider cancels its own request', () async {
    final repository = _PendingRepository();
    final container = ProviderContainer(
      overrides: [mapRepositoryProvider.overrideWithValue(repository)],
    );
    final query = _query('cancel-me');
    container.listen(mapViewportProvider(query), (previous, next) {});
    await container.pump();
    expect(repository.cancellations, hasLength(1));
    expect(repository.cancellations.single.isCancelled, isFalse);

    container.dispose();
    expect(repository.cancellations.single.isCancelled, isTrue);
  });

  test(
    'separate viewport requests have separate cancellation ownership',
    () async {
      final repository = _PendingRepository();
      final container = ProviderContainer.test(
        overrides: [mapRepositoryProvider.overrideWithValue(repository)],
      );
      final first = _query('first');
      final second = _query('second');
      final firstSubscription = container.listen(
        mapViewportProvider(first),
        (previous, next) {},
      );
      final secondSubscription = container.listen(
        mapViewportProvider(second),
        (previous, next) {},
      );
      addTearDown(secondSubscription.close);
      await container.pump();
      expect(repository.cancellations, hasLength(2));

      firstSubscription.close();
      await container.pump();
      expect(repository.cancellations.first.isCancelled, isTrue);
      expect(repository.cancellations.last.isCancelled, isFalse);
    },
  );
}

final class _PendingRepository implements MapRepository {
  final List<MapRequestCancellation> cancellations = [];

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    cancellations.add(cancellation!);
    return Completer<ViewportResponse>().future;
  }

  @override
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation}) =>
      throw UnimplementedError();

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();
}
