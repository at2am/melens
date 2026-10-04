import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/state/viewport_controller.dart';
import 'package:melens/features/map/state/zoom_policy.dart';
import 'package:melens/features/map/ui/map_screen.dart';
import 'package:melens/features/map/ui/map_surface.dart';
import 'package:melens/l10n/app_localizations.dart';

import 't017_test_support.dart';

final _sample = ViewportResponse.fromJson(t017Fixture('viewport'));
final _members = _sample.layers.single.items
    .map(
      (item) =>
          item.copyWith(geometry: _sample.layers.single.items.first.geometry),
    )
    .toList();
final _variant =
    (jsonDecode(
      File(
        '../specs/002-map-data-presentation/contracts/examples/item-variants.sample.json',
      ).readAsStringSync(),
    ) as List<dynamic>).cast<Map<String, dynamic>>().singleWhere(
      (item) => item['kind'] == 'aggregate',
    );
final _group = MapItem.fromJson({
  ..._variant,
  'geometry': {
    'type': 'MultiPoint',
    'coordinates': [
      for (final item in _members) (item.geometry! as GeoJsonPoint).coordinates,
    ],
  },
}) as AggregateMapItem;

final class _ZoomRepository implements MapRepository {
  _ZoomRepository({this.autoComplete = true});
  final bool autoComplete;
  final queries = <T017PendingViewport>[];
  final memberQueries = <AggregateMembersQuery>[];
  final detailIds = <String>[];
  bool grouped = true;
  bool partial = false;
  bool membersExpired = false;
  String snapshotId = 'sample-snapshot';
  MapRepositoryException? nextViewportError;

  AggregateMapItem get aggregate => _group.copyWith(
    details: AggregateDetails.fromJson({
      ..._group.details.toJson(),
      'resultRange': {
        ..._group.details.resultRange.toJson(),
        'totalMatching': partial ? null : 2,
      },
    }),
  );

  ViewportResponse response(ViewportQuery query) {
    final original = t017Response(query, partial: partial);
    final groupJson = aggregate.toJson();
    return ViewportResponse.fromJson({
      ...original.toJson(),
      'snapshotId': snapshotId,
      'layers': [
        for (final layer in original.layers)
          {
            ...layer.toJson(),
            if (layer.layerId == MapLayerId.pedestrian)
              'items': grouped
                  ? [groupJson]
                  : _members.map((item) => item.toJson()).toList(),
          },
      ],
    });
  }

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    final pending = T017PendingViewport(query, cancellation);
    queries.add(pending);
    if (autoComplete) {
      final error = nextViewportError;
      nextViewportError = null;
      if (error == null) {
        pending.result.complete(response(query));
      } else {
        pending.result.completeError(error);
      }
    }
    return pending.result.future;
  }

  @override
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation}) =>
      const SampleMapRepository().getLayers();

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) async {
    detailIds.add(id);
    return MapItemResponse(
      schemaVersion: 1,
      requestId: context.requestId,
      snapshotId: context.snapshotId,
      generatedAt: t017Instant,
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
      item: id == _group.id
          ? aggregate
          : _members.singleWhere((item) => item.id == id),
    );
  }

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    memberQueries.add(query);
    if (membersExpired) {
      throw const MapHttpException(
        statusCode: 409,
        retryable: true,
        code: MapServiceErrorCode.snapshotExpired,
      );
    }
    return MapItemPage(
      schemaVersion: 1,
      requestId: query.requestId,
      snapshotId: query.snapshotId,
      generatedAt: t017Instant,
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
      items: _members,
      completeness: partial
          ? MapCompleteness.partial
          : MapCompleteness.complete,
      totalMatching: partial ? null : _members.length,
      nextCursor: null,
      scope: PageScope.aggregateMembers(
        aggregateId: id,
        bounds: _group.details.bounds,
        window: _group.details.window,
        unit: _group.details.metric.unit,
      ),
    );
  }

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) => const SampleMapRepository().getUnlocated(query);
}

ProviderContainer _container(_ZoomRepository repository) =>
    ProviderContainer.test(
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
        mapSurfaceReadinessProvider.overrideWith(
          (ref) async => MapSurfaceReadiness.ready,
        ),
      ],
    );

Future<void> _showMap(
  WidgetTester tester,
  ProviderContainer container, {
  required ValueChanged<MapSurfaceConfiguration> onSurface,
  ValueChanged<MapBounds>? onZoomToBounds,
}) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: MapScreen(
          visibleRegionReader: () async => t017Region,
          onZoomToBounds: onZoomToBounds,
          mapBuilder: (context, configuration) {
            onSurface(configuration);
            return const ColoredBox(color: Color(0xffeeeeee));
          },
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pumpAndSettle();
}

void main() {
  Future<void> settle() => Future<void>.delayed(Duration.zero);

  test('service fallback does not classify the first real camera through hysteresis', () {
    final repository = _ZoomRepository(autoComplete: false);
    final container = _container(repository);
    addTearDown(container.dispose);
    final controller = container.read(viewportControllerProvider.notifier);
    controller.setLayers([MapLayerId.pedestrian], debounce: false);
    controller.useServiceBounds(t017Region);
    controller.setRegion(t017Region, 13.9, debounce: false);
    final state = container.read(viewportControllerProvider);
    expect(state.zoom, 13.9);
    expect(state.zoomPresentation!.band, ZoomBand.district);
    expect(repository.queries.last.query.zoom, 12);
  });

  test(
    'camera oscillation keeps server band and partial snapshot context stable',
    () async {
      final repository = _ZoomRepository()..partial = true;
      final container = _container(repository);
      addTearDown(container.dispose);
      final controller = container.read(viewportControllerProvider.notifier);
      controller.setLayers([MapLayerId.pedestrian], debounce: false);
      controller.setRegion(t017Region, 10.7, debounce: false);
      for (var cycle = 0; cycle < 5; cycle++) {
        for (final zoom in [11.1, 10.9]) {
          controller.setRegion(t017Region, zoom, debounce: false);
          await settle();
          final state = container.read(viewportControllerProvider);
          expect(state.zoom, zoom);
          expect(state.bbox!.toJson(), t017Region.toJson());
          expect(state.zoomPresentation!.band, ZoomBand.overview);
          expect(state.responseQuery!.zoom, 10);
          expect(state.responsePresentation!.cameraZoom, zoom);
          expect(state.response!.layers.single.items.single.id, _group.id);
          expect(state.hasPartialResults, isTrue);
          expect(state.response!.layers.single.totalMatching, isNull);
        }
      }
      expect(repository.queries.every((call) => call.query.zoom == 10), isTrue);
    },
  );

  test('newest response captures its band; late response and later failure retain it', () async {
    final repository = _ZoomRepository(autoComplete: false);
    final container = _container(repository);
    addTearDown(container.dispose);
    final controller = container.read(viewportControllerProvider.notifier);
    controller.setLayers([MapLayerId.pedestrian], debounce: false);
    controller.setRegion(t017Region, 13.7, debounce: false);
    final older = repository.queries.last;
    controller.setRegion(t017Region, 14.21, debounce: false);
    final newest = repository.queries.last;
    expect(older.cancellation!.isCancelled, isTrue);
    newest.result.complete(repository.response(newest.query));
    await settle();
    final context = container
        .read(viewportControllerProvider)
        .responsePresentation;
    expect(context!.band, ZoomBand.neighbourhood);
    expect(context.cameraZoom, 14.21);
    older.result.complete(repository.response(older.query));
    await settle();
    expect(
      container.read(viewportControllerProvider).responsePresentation,
      same(context),
    );
    controller.setRegion(t017Region, 18, debounce: false);
    repository.queries.last.result.completeError(const MapNetworkException());
    await settle();
    final state = container.read(viewportControllerProvider);
    expect(state.zoomPresentation!.band, ZoomBand.closeUp);
    expect(state.responsePresentation, same(context));
    expect(state.responseQuery, same(newest.query));
    expect(state.retainsPreviousResponse, isTrue);
  });

  testWidgets(
    'aggregate click fits true bounds; dense close member list preserves original highlight and details',
    (tester) async {
      final repository = _ZoomRepository()..partial = true;
      final container = _container(repository);
      addTearDown(container.dispose);
      MapSurfaceConfiguration? surface;
      final zoomedBounds = <MapBounds>[];
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            locale: const Locale('en', 'AU'),
            supportedLocales: const [Locale('en', 'AU')],
            localizationsDelegates: const [
              AppLocalizations.delegate,
              ...GlobalMaterialLocalizations.delegates,
            ],
            home: MapScreen(
              visibleRegionReader: () async => t017Region,
              onZoomToBounds: zoomedBounds.add,
              mapBuilder: (context, configuration) {
                surface = configuration;
                return const ColoredBox(color: Color(0xffeeeeee));
              },
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      surface!.onCameraChanged!(
        const CameraPosition(target: LatLng(-37.818, 144.967), zoom: 18),
      );
      surface!.onCameraIdle!();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(repository.queries.last.query.zoom, 18);
      surface!.renderPlan.markers
          .singleWhere((marker) => marker.markerId.value.endsWith(':aggregate'))
          .onTap!();
      await tester.pumpAndSettle();
      expect(zoomedBounds.map((bounds) => bounds.toJson()), [
        _group.details.bounds.toJson(),
      ]);
      expect(find.text('Group members'), findsOneWidget);
      expect(
        find.text(
          'Several records share this location. Open a member below to view its own details.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Loaded scope only'), findsWidgets);
      expect(find.textContaining('not a city-wide total'), findsOneWidget);
      expect(find.textContaining('Illustrative sample data'), findsWidgets);
      final member = find.byKey(
        ValueKey('aggregate-member:${_members.first.id}'),
      );
      await tester.ensureVisible(member);
      await tester.tap(member);
      await tester.pumpAndSettle();
      var selection = container.read(selectionControllerProvider);
      expect(selection.selectedItemId, _members.first.id);
      expect(selection.item!.versionId, _members.first.versionId);
      expect(selection.item!.kind, MapItemKind.pedestrian);
      expect(selection.highlightedAggregateId, _group.id);
      expect(selection.disposition, MapSelectionDisposition.matching);
      final originalContext = selection.context;
      final controller = container.read(viewportControllerProvider.notifier);
      for (final zoom in [10.0, 12.0, 15.0, 18.0]) {
        controller.setRegion(t017Region, zoom, debounce: false);
        await tester.pumpAndSettle();
        selection = container.read(selectionControllerProvider);
        expect(selection.item!.id, _members.first.id);
        expect(selection.item!.geometry, _members.first.geometry);
        expect(selection.context, same(originalContext));
        expect(selection.highlightedAggregateId, _group.id);
      }
      expect(
        repository.memberQueries.single.snapshotId,
        originalContext!.snapshotId,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final refreshSucceeds in [true, false]) {
    testWidgets(
      'explicit expired member refresh ${refreshSucceeds ? 'rebinds only a new snapshot' : 'retains the expired original on failure'}',
      (tester) async {
        final repository = _ZoomRepository()..membersExpired = true;
        final container = _container(repository);
        addTearDown(container.dispose);
        MapSurfaceConfiguration? surface;
        await _showMap(
          tester,
          container,
          onSurface: (value) => surface = value,
        );
        surface!.renderPlan.markers
            .singleWhere(
              (marker) => marker.markerId.value.endsWith(':aggregate'),
            )
            .onTap!();
        await tester.pumpAndSettle();
        final originalContext = container
            .read(selectionControllerProvider)
            .context!;
        expect(repository.memberQueries, hasLength(1));
        expect(
          find.textContaining('This group snapshot has expired.'),
          findsOneWidget,
        );
        repository.membersExpired = false;
        repository.snapshotId = 'fresh-snapshot';
        if (!refreshSucceeds) {
          repository.nextViewportError = const MapNetworkException();
        }
        final refresh = find.text('Refresh map snapshot');
        await tester.ensureVisible(refresh);
        await tester.tap(refresh);
        await tester.pumpAndSettle();
        final selection = container.read(selectionControllerProvider);
        if (refreshSucceeds) {
          expect(selection.context!.snapshotId, 'fresh-snapshot');
          expect(repository.memberQueries.map((query) => query.snapshotId), [
            originalContext.snapshotId,
            'fresh-snapshot',
          ]);
          expect(
            find.byKey(ValueKey('aggregate-member:${_members.first.id}')),
            findsOneWidget,
          );
        } else {
          expect(selection.context, same(originalContext));
          expect(repository.memberQueries, hasLength(1));
          expect(
            container.read(viewportControllerProvider).retainsPreviousResponse,
            isTrue,
          );
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
}
