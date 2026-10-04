import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/state/zoom_policy.dart';
import 'package:melens/features/map/state/zoom_presentation.dart';
import 'package:melens/features/map/ui/aggregate_details.dart';
import 'package:melens/features/map/ui/renderers/aggregate_renderer.dart';
import 'package:melens/features/map/ui/renderers/core_renderers.dart';
import 'package:melens/l10n/app_localizations.dart';

// Node acceptance regenerates and checks these exact production outputs. The
// sample is synthetic; it proves interoperability, not live-map performance.
final _sample = jsonDecode(
  File(
    '../specs/002-map-data-presentation/task-handoffs/performance/'
    't026-fixed-sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;
final _originals = (_sample['originals'] as List<dynamic>)
    .map((value) => MapItem.fromJson(value as Map<String, dynamic>))
    .toList(growable: false);
final _selected = _originals.whereType<PedestrianMapItem>().singleWhere(
  (item) => item.details.sensorId == 'A',
);
const _context = MapReadContext(
  requestId: 't026-fixed-acceptance',
  snapshotId: 't026-synthetic-v1',
);

List<MapItem> _presented(ZoomPresentation presentation) {
  final band = (_sample['bands'] as List<dynamic>)
      .cast<Map<String, dynamic>>()
      .singleWhere((band) => band['zoom'] == presentation.requestZoom);
  return (band['layers'] as List<dynamic>)
      .cast<Map<String, dynamic>>()
      .expand((layer) => layer['items'] as List<dynamic>)
      .map((value) => MapItem.fromJson(value as Map<String, dynamic>))
      .toList(growable: false);
}

Future<void> _select(SelectionController controller, MapItem item) =>
    controller.selectItem(
      item,
      context: _context,
      mode: MapQueryMode.historical,
      dataMode: MapDataMode.sample,
    );

void _reconcile(SelectionController controller, List<MapItem> items) =>
    controller.reconcile(
      enabledLayers: _originals.map((item) => item.layerId).toSet(),
      visibleItems: items,
    );

ProviderContainer _container(_Repository repository) => ProviderContainer.test(
  overrides: [
    mapRepositoryProvider.overrideWithValue(repository),
    melbourneClockProvider.overrideWithValue(
      MelbourneClock(now: () => DateTime.utc(2026, 10, 1, 1, 2)),
    ),
  ],
);

Future<void> _show(
  WidgetTester tester,
  ProviderContainer container,
  Widget child,
) async {
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
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'T026 real wire groups across four bands retain original selection and geometry',
    (tester) async {
      final repository = _Repository();
      final container = _container(repository);
      final controller = container.read(selectionControllerProvider.notifier);
      await _select(controller, _selected);
      var presentation = ZoomPresentation.initial(10);
      for (final zoom in [10.0, 12.0, 15.0, 18.0]) {
        presentation = presentation.at(zoom);
        final items = _presented(presentation);
        _reconcile(controller, items);
        final state = container.read(selectionControllerProvider);
        expect(state.item, same(_selected));
        expect(state.context, same(_context));
        expect(state.item!.geometry, same(_selected.geometry));
        expect(state.disposition, MapSelectionDisposition.matching);
        final selectedGroup = items.whereType<AggregateMapItem>().singleWhere(
          (item) => item.details.memberIds.contains(_selected.id),
        );
        expect(state.highlightedAggregateId, selectedGroup.id);
        expect(selectedGroup.details.metric.unit, 'sensors');
        expect(selectedGroup.details.resultRange.totalMatching, isNull);
        late CoreRenderPlan plan;
        MapBounds? navigatedBounds;
        await _show(
          tester,
          container,
          Builder(
            builder: (context) {
              plan =
                  buildCoreRenderPlan(
                    items: items,
                    colors: Theme.of(context).colorScheme,
                    selectedItemId: state.highlightedItemId,
                  ).merge(
                    buildAggregateRenderPlan(
                      context,
                      items.whereType<AggregateMapItem>().toList(),
                      state.highlightedItemId,
                      null,
                      onZoomToBounds: (bounds) => navigatedBounds = bounds,
                    ),
                  );
              return const SizedBox.shrink();
            },
          ),
        );
        final marker = plan.markers.singleWhere(
          (marker) => marker.markerId.value == '${selectedGroup.id}:aggregate',
        );
        final geometry = selectedGroup.geometry! as GeoJsonMultiPoint;
        expect(
          marker.position,
          LatLng(geometry.coordinates.first[1], geometry.coordinates.first[0]),
        );
        expect(marker.zIndexInt, 4);
        expect(marker.infoWindow.snippet, contains('sensors'));
        expect(marker.infoWindow.snippet, contains('Loaded scope only'));
        marker.onTap!();
        expect(navigatedBounds, same(selectedGroup.details.bounds));

        // Both news association and rent remain full source polygons at close
        // range; traffic remains its original affected line with every vertex.
        for (final original in _originals.where(
          (item) => item.geometry is GeoJsonPolygon,
        )) {
          final presented = items.singleWhere((item) => item.id == original.id);
          expect(presented.geometry, original.geometry);
          expect(presented.location.precision, MapLocationPrecision.area);
          expect(presented.location.role, original.location.role);
          final polygon = plan.polygons.singleWhere(
            (polygon) => polygon.polygonId.value == '${original.id}:polygon:0',
          );
          final shape = original.geometry! as GeoJsonPolygon;
          expect(
            polygon.points,
            shape.coordinates.first
                .map((point) => LatLng(point[1], point[0]))
                .toList(),
          );
        }
        final road = _originals.whereType<DisruptionMapItem>().single;
        final line = road.geometry! as GeoJsonLineString;
        expect(
          plan.polylines.single.points,
          line.coordinates.map((point) => LatLng(point[1], point[0])).toList(),
        );
        expect(items.any((item) => item.id == 'sample.news.unknown'), isFalse);
        expect(tester.takeException(), isNull);
      }
      expect(repository.detailIds, [_selected.id]);
    },
  );

  for (final boundary in [11.0, 14.0, 17.0]) {
    for (final initialZoom in [boundary - 0.3, boundary + 0.3]) {
      test(
        'T026 five ±0.1 cycles preserve wire membership/selection at $boundary from $initialZoom',
        () async {
          final container = _container(_Repository());
          final controller = container.read(
            selectionControllerProvider.notifier,
          );
          await _select(controller, _selected);
          var presentation = ZoomPresentation.initial(initialZoom);
          final originalBand = presentation.band;
          final wireZoom = presentation.requestZoom;
          final originalItems = _presented(presentation);
          _reconcile(controller, originalItems);
          final groupId = container
              .read(selectionControllerProvider)
              .aggregateId;
          for (var cycle = 0; cycle < 5; cycle++) {
            for (final cameraZoom in [boundary + 0.1, boundary - 0.1]) {
              presentation = presentation.at(cameraZoom);
              expect(presentation.cameraZoom, cameraZoom);
              expect(presentation.band, originalBand);
              expect(presentation.requestZoom, wireZoom);
              final items = _presented(presentation);
              expect(
                items.map((item) => item.toJson()).toList(),
                originalItems.map((item) => item.toJson()).toList(),
              );
              _reconcile(controller, items);
              final state = container.read(selectionControllerProvider);
              expect(state.selectedItemId, _selected.id);
              expect(state.highlightedAggregateId, groupId);
              expect(state.item, same(_selected));
              expect(state.disposition, MapSelectionDisposition.matching);
            }
          }
        },
      );
    }
  }

  testWidgets(
    'T026 close same-location list returns actual original sensor with zero intact',
    (tester) async {
      final repository = _Repository();
      final container = _container(repository);
      final controller = container.read(selectionControllerProvider.notifier);
      final presentation = ZoomPresentation.initial(18);
      expect(presentation.band, ZoomBand.closeUp);
      final items = _presented(presentation);
      final aggregate = items.whereType<AggregateMapItem>().singleWhere(
        (item) => item.details.memberIds.contains(_selected.id),
      );
      await _show(
        tester,
        container,
        AggregateDetailsPanel(
          aggregate: aggregate,
          repository: repository,
          readContext: _context,
          mode: MapQueryMode.historical,
          dataMode: MapDataMode.sample,
          onItemSelected: (item) async {
            await _select(controller, item);
            _reconcile(controller, items);
          },
        ),
      );
      await tester.pump();
      expect(aggregate.details.memberIds, hasLength(2));
      expect(
        find.textContaining('Several records share this location'),
        findsOneWidget,
      );
      expect(find.text('Effective sensors: 2 sensors'), findsOneWidget);
      expect(find.text('Sensor passages: 0'), findsOneWidget);
      expect(
        find.textContaining('Observation window: 1 Oct 2026, 10:59 AEST'),
        findsOneWidget,
      );
      expect(find.text('Sample data — illustrative only'), findsOneWidget);
      final member = find.byKey(ValueKey('aggregate-member:${_selected.id}'));
      await tester.ensureVisible(member);
      await tester.tap(member);
      await tester.pump();
      final state = container.read(selectionControllerProvider);
      expect(state.selectedItemId, _selected.id);
      expect(state.item, same(_selected));
      expect(state.highlightedAggregateId, aggregate.id);
      expect(repository.memberSnapshotIds, [_context.snapshotId]);
      expect(tester.takeException(), isNull);
    },
  );
}

final class _Repository implements MapRepository {
  final List<String> detailIds = [];
  final List<String> memberSnapshotIds = [];

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
      generatedAt: DateTime.utc(2026, 10, 1, 1, 2),
      mode: MapQueryMode.historical,
      dataMode: MapDataMode.sample,
      item: _originals.singleWhere((item) => item.id == id),
    );
  }

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    memberSnapshotIds.add(query.snapshotId);
    final group = _presented(ZoomPresentation.initial(18))
        .whereType<AggregateMapItem>()
        .singleWhere((item) => item.id == id);
    return MapItemPage(
      schemaVersion: 1,
      requestId: query.requestId,
      snapshotId: query.snapshotId,
      generatedAt: DateTime.utc(2026, 10, 1, 1, 2),
      mode: MapQueryMode.historical,
      dataMode: MapDataMode.sample,
      items: _originals
          .where((item) => group.details.memberIds.contains(item.id))
          .toList(),
      completeness: MapCompleteness.partial,
      nextCursor: null,
      totalMatching: null,
      scope: PageScope.aggregateMembers(
        aggregateId: id,
        bounds: group.details.bounds,
        window: group.details.window,
        unit: group.details.metric.unit,
      ),
    );
  }

  @override
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation}) =>
      throw UnimplementedError();

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();
}
