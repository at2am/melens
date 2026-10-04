import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/viewport_controller.dart';

import '../t017_test_support.dart';

void main() {
  late T017Repository repository;
  late ProviderContainer container;
  late ViewportController controller;
  Future<void> settle() => Future<void>.delayed(Duration.zero);
  void configure() {
    controller.setLayers([MapLayerId.pedestrian], debounce: false);
    controller.setRegion(t017Region, 14, debounce: false);
  }

  setUp(() {
    repository = T017Repository();
    container = ProviderContainer(
      overrides: [
        mapRepositoryProvider.overrideWithValue(repository),
        melbourneClockProvider.overrideWithValue(
          MelbourneClock(now: () => t017Instant),
        ),
        envProvider.overrideWithValue(
          Env(
            environment: AppEnvironment.dev,
            agentBaseUrl: Uri.parse('http://localhost:8080'),
            mapBaseUrl: Uri.parse('http://localhost:8081'),
            mapDataMode: MapDataMode.sample,
          ),
        ),
      ],
    );
    controller = container.read(viewportControllerProvider.notifier);
  });
  tearDown(() => container.dispose());

  test('empty and unconfigured boundary layers skip network', () {
    controller.setRegion(t017Region, 14, debounce: false);
    expect(repository.queries, isEmpty);
    controller.setLayers([MapLayerId.boundary], debounce: false);
    expect(repository.queries, isEmpty);
    expect(container.read(viewportControllerProvider).blockedLayers, {
      MapLayerId.boundary,
    });
    controller.setLayers([
      MapLayerId.pedestrian,
      MapLayerId.boundary,
    ], debounce: false);
    expect(repository.queries.single.query.layers, [MapLayerId.pedestrian]);
    expect(repository.queries.single.query.boundaryFilter, isNull);
    controller.setLayers([], debounce: false);
    expect(repository.queries.single.cancellation!.isCancelled, isTrue);
    expect(container.read(viewportControllerProvider).response, isNull);
  });

  test(
    'visible bounds intersect contract envelope without invented coverage',
    () {
      controller.setLayers([MapLayerId.pedestrian], debounce: false);
      controller.setRegion(
        const MapBounds(west: 143, south: -40, east: 147, north: -36),
        0,
        debounce: false,
      );
      final query = repository.queries.single.query;
      expect(query.bbox.toJson(), [144, -39, 146.5, -37]);
      expect(query.zoom, 10);
      expect(container.read(viewportControllerProvider).zoom, 0);
      expect(query.pageSize, 1000);
      controller.setRegion(
        const MapBounds(west: 150, south: -35, east: 151, north: -34),
        22,
        debounce: false,
      );
      expect(repository.queries, hasLength(1));
      expect(
        container.read(viewportControllerProvider).isOutsideService,
        isTrue,
      );
      expect(container.read(viewportControllerProvider).bbox, isNull);
      expect(
        () => controller.setRegion(t017Region, double.nan),
        throwsArgumentError,
      );
    },
  );

  test('rapid control updates debounce to one newest request', () async {
    controller.setLayers([MapLayerId.pedestrian]);
    controller.setRegion(t017Region, 14);
    controller.setRegion(t017Region, 15);
    controller.setRegion(t017Region, 16);
    expect(repository.queries, isEmpty);
    await Future<void>.delayed(const Duration(milliseconds: 280));
    expect(repository.queries, hasLength(1));
    expect(repository.queries.single.query.zoom, 15);
    expect(container.read(viewportControllerProvider).zoom, 16);
  });

  test(
    'superseded operation is cancelled immediately and late success ignored',
    () async {
      configure();
      final old = repository.queries.single;
      controller.setRegion(t017Region, 16, debounce: false);
      final newest = repository.queries.last;
      expect(old.cancellation!.isCancelled, isTrue);
      newest.result.complete(t017Response(newest.query));
      await settle();
      final response = container.read(viewportControllerProvider).response;
      old.result.complete(t017Response(old.query));
      await settle();
      expect(
        container.read(viewportControllerProvider).response,
        same(response),
      );
      expect(response!.requestId, newest.query.requestId);
    },
  );

  test(
    'failed refresh retains original window and requires manual retry',
    () async {
      configure();
      final first = repository.queries.single;
      first.result.complete(t017Response(first.query));
      await settle();
      final original = container.read(viewportControllerProvider).response;
      final window = TimeWindow(
        from: t017Instant.subtract(const Duration(days: 1)),
        to: t017Instant,
      );
      controller.setWindow(MapQueryMode.historical, window, debounce: false);
      repository.queries.last.result.completeError(const MapNetworkException());
      await settle();
      var state = container.read(viewportControllerProvider);
      expect(state.response, same(original));
      expect(state.responseQuery, same(first.query));
      expect(state.matchesResponseWindow, isFalse);
      expect(state.response!.mode, MapQueryMode.current);
      expect(state.canRetry, isTrue);
      await Future<void>.delayed(const Duration(milliseconds: 280));
      expect(repository.queries, hasLength(2));
      final retry = controller.retry();
      expect(repository.queries, hasLength(3));
      final third = repository.queries.last;
      expect(third.query.mode, MapQueryMode.historical);
      expect(third.query.requestId, isNot(first.query.requestId));
      third.result.complete(t017Response(third.query));
      await retry;
      state = container.read(viewportControllerProvider);
      expect(state.matchesResponseWindow, isTrue);
      expect(state.error, isNull);
    },
  );

  test('response ID and data-mode mismatches are safe failures', () async {
    configure();
    var call = repository.queries.last;
    call.result.complete(t017Response(call.query, requestId: 'wrong-request'));
    await settle();
    expect(
      container.read(viewportControllerProvider).error,
      isA<MapContractException>(),
    );
    expect(container.read(viewportControllerProvider).response, isNull);
    final refresh = controller.refresh();
    call = repository.queries.last;
    call.result.complete(t017Response(call.query, dataMode: MapDataMode.live));
    await refresh;
    expect(container.read(viewportControllerProvider).response, isNull);
    expect(repository.queries, hasLength(2));
  });

  test(
    'camera motion cancels work before the newest region is known',
    () async {
      configure();
      final old = repository.queries.single;
      controller.cameraMoving();
      expect(old.cancellation!.isCancelled, isTrue);
      expect(container.read(viewportControllerProvider).isCameraMoving, isTrue);
      controller.setLayers([
        MapLayerId.pedestrian,
        MapLayerId.event,
      ], debounce: false);
      expect(repository.queries, hasLength(1));
      old.result.complete(t017Response(old.query));
      await settle();
      expect(container.read(viewportControllerProvider).response, isNull);
      controller.setRegion(t017Region, 14, debounce: false);
      expect(repository.queries, hasLength(2));
      expect(
        container.read(viewportControllerProvider).isCameraMoving,
        isFalse,
      );
    },
  );

  test(
    'live failure never changes data mode or accepts sample output',
    () async {
      final live = ProviderContainer(
        overrides: [
          mapRepositoryProvider.overrideWithValue(repository),
          envProvider.overrideWithValue(
            Env(
              environment: AppEnvironment.dev,
              agentBaseUrl: Uri.parse('http://localhost:8080'),
              mapBaseUrl: Uri.parse('http://localhost:8081'),
            ),
          ),
        ],
      );
      addTearDown(live.dispose);
      final active = live.read(viewportControllerProvider.notifier);
      active.setLayers([MapLayerId.pedestrian], debounce: false);
      active.setRegion(t017Region, 14, debounce: false);
      repository.queries.single.result.completeError(
        const MapNetworkException(),
      );
      await settle();
      expect(live.read(viewportControllerProvider).dataMode, MapDataMode.live);
      expect(live.read(viewportControllerProvider).response, isNull);
      final retry = active.retry();
      final call = repository.queries.last;
      call.result.complete(t017Response(call.query));
      await retry;
      expect(live.read(viewportControllerProvider).dataMode, MapDataMode.live);
      expect(live.read(viewportControllerProvider).response, isNull);
      expect(
        live.read(viewportControllerProvider).error,
        isA<MapContractException>(),
      );
    },
  );

  test(
    'partial results preserve unknown totals and original observation time',
    () async {
      configure();
      final call = repository.queries.single;
      call.result.complete(t017Response(call.query, partial: true));
      await settle();
      final state = container.read(viewportControllerProvider);
      expect(state.hasPartialResults, isTrue);
      expect(state.response!.layers.single.totalMatching, isNull);
      expect(
        state.response!.layers.single.items.first.time.observedAt,
        DateTime.utc(2026, 10, 1, 0, 59),
      );
    },
  );

  test('dynamic windows require UTC and cannot exceed 31 days', () {
    expect(
      () => controller.setWindow(
        MapQueryMode.historical,
        TimeWindow(
          from: t017Instant.subtract(const Duration(days: 32)),
          to: t017Instant,
        ),
      ),
      throwsArgumentError,
    );
    expect(
      () => controller.setWindow(
        MapQueryMode.historical,
        TimeWindow(from: t017Instant, to: t017Instant),
      ),
      throwsArgumentError,
    );
    controller.setWindow(
      MapQueryMode.historical,
      TimeWindow(
        from: t017Instant.subtract(const Duration(days: 31)),
        to: t017Instant,
      ),
    );
    expect(
      container
          .read(viewportControllerProvider)
          .window
          .to
          .difference(container.read(viewportControllerProvider).window.from),
      const Duration(days: 31),
    );
  });

  test(
    'disposal cancels in-flight work and late errors do not mutate state',
    () async {
      configure();
      final call = repository.queries.single;
      container.dispose();
      expect(call.cancellation!.isCancelled, isTrue);
      call.result.completeError(const MapTimeoutException());
      await settle();
    },
  );
}
