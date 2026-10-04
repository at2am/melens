import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/state/zoom_policy.dart';
import 'package:melens/features/map/ui/aggregate_details.dart';
import 'package:melens/features/map/ui/map_details.dart';
import 'package:melens/features/map/ui/map_surface.dart';
import 'package:melens/features/map/ui/renderers/aggregate_renderer.dart';
import 'package:melens/l10n/app_localizations.dart';

Map<String, dynamic> _fixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;

final _viewport = ViewportResponse.fromJson(_fixture('viewport'));
final _sensor = _viewport.layers.single.items.first;
final _variants = jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/'
    'item-variants.sample.json',
  ).readAsStringSync(),
) as List<dynamic>;
final _aggregate = _variants
    .map((json) => MapItem.fromJson(json as Map<String, dynamic>))
    .whereType<AggregateMapItem>()
    .single;
final _context = MapReadContext(
  requestId: _viewport.requestId,
  snapshotId: _viewport.snapshotId,
);
const _enabledLayers = {MapLayerId.pedestrian};

LayerResult _layerWithItems(List<MapItem> items) {
  final layer = _viewport.layers.single;
  return LayerResult(
    layerId: layer.layerId,
    state: layer.state,
    freshness: layer.freshness,
    completeness: layer.completeness,
    sourceIds: layer.sourceIds,
    coverage: layer.coverage,
    observedWindow: layer.observedWindow,
    updatedAt: layer.updatedAt,
    items: items,
    unresolvedCount: layer.unresolvedCount,
    nextCursor: layer.nextCursor,
    totalMatching: layer.totalMatching,
  );
}

AggregateMapItem _group({
  String? id,
  List<String>? memberIds,
  MapLayerId? layerId,
  MapLifecycle? lifecycle,
}) => _aggregate.copyWith(
  id: id ?? _aggregate.id,
  layerId: layerId ?? _aggregate.layerId,
  lifecycle: lifecycle ?? _aggregate.lifecycle,
  details: AggregateDetails.fromJson({
    ..._aggregate.details.toJson(),
    'memberIds': ?memberIds,
  }),
);

ProviderContainer _container(_Repository repository) => ProviderContainer.test(
  overrides: [
    mapRepositoryProvider.overrideWithValue(repository),
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

Future<void> _select(SelectionController controller, MapItem item) =>
    controller.selectItem(
      item,
      context: _context,
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
    );

void main() {
  test(
    'selected original survives all four bands and a dense close-up',
    () async {
      final repository = _Repository();
      final container = _container(repository);
      final controller = container.read(selectionControllerProvider.notifier);
      await _select(controller, _sensor);
      var band = ZoomPolicy.nominalBand(10);
      for (final zoom in [10.0, 12.0, 15.0, 18.0, 12.0, 10.0, 18.0]) {
        band = ZoomPolicy.bandFor(zoom, previousBand: band);
        final grouped = band != ZoomBand.neighbourhood;
        controller.reconcile(
          enabledLayers: _enabledLayers,
          visibleItems: grouped ? [_aggregate] : [_sensor],
        );
        final state = container.read(selectionControllerProvider);
        expect(state.selectedItemId, _sensor.id);
        expect(state.item, same(_sensor));
        expect(state.item!.geometry, same(_sensor.geometry));
        expect(state.context, same(_context));
        expect(state.disposition, MapSelectionDisposition.matching);
        expect(state.highlightedItemId, _sensor.id);
        expect(state.highlightedAggregateId, grouped ? _aggregate.id : null);
      }
      expect(repository.detailIds, [_sensor.id]);
    },
  );

  test(
    'direct object wins; current member evidence moves between groups',
    () async {
      final container = _container(_Repository());
      final controller = container.read(selectionControllerProvider.notifier);
      await _select(controller, _sensor);
      controller.reconcile(
        enabledLayers: _enabledLayers,
        visibleItems: [_aggregate],
      );
      expect(
        container.read(selectionControllerProvider).aggregateId,
        _aggregate.id,
      );

      final nextGroup = _group(id: 'next.group');
      controller.reconcile(
        enabledLayers: _enabledLayers,
        visibleItems: [nextGroup],
      );
      expect(
        container.read(selectionControllerProvider).aggregateId,
        nextGroup.id,
      );
      controller.reconcile(
        enabledLayers: _enabledLayers,
        visibleItems: [_aggregate, _sensor],
      );
      final state = container.read(selectionControllerProvider);
      expect(state.aggregateId, isNull);
      expect(state.disposition, MapSelectionDisposition.matching);
      expect(state.item, same(_sensor));
    },
  );

  test(
    'bounds, withdrawn groups and other layers do not infer membership',
    () async {
      final container = _container(_Repository());
      final controller = container.read(selectionControllerProvider.notifier);
      await _select(controller, _sensor);
      for (final group in [
        _group(memberIds: []),
        _group(memberIds: ['other.member']),
        _group(lifecycle: MapLifecycle.withdrawn),
        _group(layerId: MapLayerId.event),
      ]) {
        controller.reconcile(
          enabledLayers: _enabledLayers,
          visibleItems: [group],
        );
        final state = container.read(selectionControllerProvider);
        expect(state.disposition, MapSelectionDisposition.offscreen);
        expect(state.aggregateId, isNull);
        expect(state.item!.geometry, same(_sensor.geometry));
      }
    },
  );

  test(
    'filter exclusion clears group highlight and reentry restores it',
    () async {
      final container = _container(_Repository());
      final controller = container.read(selectionControllerProvider.notifier);
      await _select(controller, _sensor);
      controller.reconcile(
        enabledLayers: _enabledLayers,
        visibleItems: [_aggregate],
      );
      for (final (enabled, matchesFilters) in [
        (_enabledLayers, false),
        (<MapLayerId>{}, true),
      ]) {
        controller.reconcile(
          enabledLayers: enabled,
          visibleItems: [_aggregate],
          matchesFilters: matchesFilters,
        );
        final excluded = container.read(selectionControllerProvider);
        expect(excluded.disposition, MapSelectionDisposition.filterExcluded);
        expect(excluded.highlightedItemId, isNull);
        expect(excluded.highlightedAggregateId, isNull);
        expect(excluded.item, same(_sensor));
        controller.setAggregateMembership(_aggregate.id);
        expect(container.read(selectionControllerProvider).aggregateId, isNull);
      }
      controller.reconcile(
        enabledLayers: _enabledLayers,
        visibleItems: [_aggregate],
      );
      final restored = container.read(selectionControllerProvider);
      expect(restored.disposition, MapSelectionDisposition.matching);
      expect(restored.highlightedAggregateId, _aggregate.id);
      expect(restored.item, same(_sensor));
    },
  );

  test('visible withdrawal wins over stale aggregate membership', () async {
    final container = _container(_Repository());
    final controller = container.read(selectionControllerProvider.notifier);
    await _select(controller, _sensor);
    controller.reconcile(
      enabledLayers: _enabledLayers,
      visibleItems: [
        _aggregate,
        _sensor.copyWith(lifecycle: MapLifecycle.withdrawn),
      ],
    );
    final state = container.read(selectionControllerProvider);
    expect(state.disposition, MapSelectionDisposition.withdrawn);
    expect(state.item, isNull);
    expect(state.highlightedItemId, isNull);
    expect(state.aggregateId, isNull);
  });

  for (final withdrawn in [false, true]) {
    test(
      '${withdrawn ? 'withdrawn' : 'removed'} original cannot be revived by a group',
      () async {
        final container = _container(_Repository());
        final controller = container.read(selectionControllerProvider.notifier);
        await _select(controller, _sensor);
        controller.reconcile(
          enabledLayers: _enabledLayers,
          visibleItems: [_aggregate],
          removedIds: withdrawn ? {} : {_sensor.id},
          withdrawnIds: withdrawn ? {_sensor.id} : {},
        );
        controller.reconcile(
          enabledLayers: _enabledLayers,
          visibleItems: [_aggregate, _sensor],
        );
        controller.setAggregateMembership(_aggregate.id);
        final state = container.read(selectionControllerProvider);
        expect(state.selectedItemId, _sensor.id);
        expect(
          state.disposition,
          withdrawn
              ? MapSelectionDisposition.withdrawn
              : MapSelectionDisposition.removed,
        );
        expect(state.item, isNull);
        expect(state.highlightedItemId, isNull);
        expect(state.highlightedAggregateId, isNull);
      },
    );
  }

  testWidgets(
    'original details and group symbol stay linked across bands; Escape closes',
    (tester) async {
      final container = _container(_Repository());
      final controller = container.read(selectionControllerProvider.notifier);
      final visible = ValueNotifier<List<MapItem>>([_sensor]);
      addTearDown(visible.dispose);
      await _select(controller, _sensor);
      MapSurfaceConfiguration? configuration;
      await _show(
        tester,
        container,
        visible,
        onConfiguration: (value) => configuration = value,
      );
      for (final items in <List<MapItem>>[
        [_aggregate],
        [_sensor],
        [_aggregate],
        [_sensor],
        [_aggregate],
      ]) {
        controller.reconcile(
          enabledLayers: _enabledLayers,
          visibleItems: items,
        );
        visible.value = items;
        await tester.pumpAndSettle();
        final state = container.read(selectionControllerProvider);
        expect(find.text(_sensor.title), findsWidgets);
        expect(
          find.descendant(
            of: find.byType(MapDetails),
            matching: find.text(_aggregate.title),
          ),
          findsNothing,
        );
        if (items.single is AggregateMapItem) {
          expect(
            find.textContaining('belongs to the highlighted aggregate'),
            findsOneWidget,
          );
          expect(configuration!.renderPlan.markers.single.zIndexInt, 4);
          expect(state.highlightedAggregateId, _aggregate.id);
        } else {
          expect(
            find.textContaining('belongs to the highlighted aggregate'),
            findsNothing,
          );
          expect(state.aggregateId, isNull);
        }
      }
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(container.read(selectionControllerProvider).hasSelection, isFalse);
      expect(find.byType(MapDetails), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'offscreen and excluded details explain the retained source location',
    (tester) async {
      final container = _container(_Repository());
      final controller = container.read(selectionControllerProvider.notifier);
      final visible = ValueNotifier<List<MapItem>>([]);
      addTearDown(visible.dispose);
      await _select(controller, _sensor);
      controller.reconcile(enabledLayers: _enabledLayers, visibleItems: []);
      await _show(tester, container, visible);
      expect(find.textContaining('outside the current view'), findsOneWidget);
      expect(find.text(_sensor.title), findsOneWidget);
      expect(
        container.read(selectionControllerProvider).item!.geometry,
        same(_sensor.geometry),
      );
      controller.reconcile(
        enabledLayers: _enabledLayers,
        visibleItems: [_aggregate],
        matchesFilters: false,
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('no longer matches'), findsOneWidget);
      expect(find.text(_sensor.title), findsOneWidget);
      expect(
        find.textContaining('belongs to the highlighted aggregate'),
        findsNothing,
      );
      expect(
        container.read(selectionControllerProvider).highlightedItemId,
        isNull,
      );
    },
  );

  testWidgets(
    'keyboard opens dense group, selects original member and closes retained details',
    (tester) async {
      final repository = _Repository();
      final container = _container(repository);
      final controller = container.read(selectionControllerProvider.notifier);
      final visible = ValueNotifier<List<MapItem>>([_aggregate]);
      addTearDown(visible.dispose);
      await _show(tester, container, visible);
      await _tabTo(tester, find.byKey(ValueKey('map-object:${_aggregate.id}')));
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(
        container.read(selectionControllerProvider).selectedItemId,
        _aggregate.id,
      );
      final member = find.byKey(ValueKey('aggregate-member:${_sensor.id}'));
      expect(member, findsOneWidget);
      await tester.ensureVisible(member);
      await _tabTo(tester, member);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      final state = container.read(selectionControllerProvider);
      expect(state.selectedItemId, _sensor.id);
      expect(state.item, same(_sensor));
      expect(state.highlightedAggregateId, _aggregate.id);
      expect(find.byType(AggregateDetailsPanel), findsNothing);
      expect(
        find.textContaining('belongs to the highlighted aggregate'),
        findsOneWidget,
      );
      visible.value = [_sensor];
      controller.reconcile(
        enabledLayers: _enabledLayers,
        visibleItems: visible.value,
      );
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byType(MapDetails), findsNothing);
      expect(container.read(selectionControllerProvider).hasSelection, isFalse);
      expect(tester.takeException(), isNull);
    },
  );
}

Future<void> _show(
  WidgetTester tester,
  ProviderContainer container,
  ValueNotifier<List<MapItem>> visible, {
  ValueChanged<MapSurfaceConfiguration>? onConfiguration,
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
        home: Scaffold(
          body: ValueListenableBuilder<List<MapItem>>(
            valueListenable: visible,
            builder: (context, items, child) => Consumer(
              builder: (context, ref, child) {
                final state = ref.watch(selectionControllerProvider);
                final controller = ref.read(
                  selectionControllerProvider.notifier,
                );
                void select(MapItem item) {
                  unawaited(
                    _select(controller, item).then((_) {
                      controller.reconcile(
                        enabledLayers: _enabledLayers,
                        visibleItems: visible.value,
                      );
                    }),
                  );
                }

                return MapDetailsLayout(
                  map: MapSurface(
                    layers: [_layerWithItems(items)],
                    enabledLayers: _enabledLayers,
                    dataMode: MapDataMode.sample,
                    selectedItemId: state.highlightedItemId,
                    onItemSelected: select,
                    onAggregateSelected: select,
                    aggregateRenderer: buildAggregateRenderPlan,
                    mapBuilder: (context, configuration) {
                      onConfiguration?.call(configuration);
                      return const SizedBox(
                        key: ValueKey('selection-fake-map'),
                      );
                    },
                  ),
                  details: state.hasSelection
                      ? MapDetails(
                          state: state,
                          onClose: controller.clear,
                          additionalContent: state.item is AggregateMapItem
                              ? AggregateDetailsPanel(
                                  aggregate: state.item! as AggregateMapItem,
                                  repository: ref.read(mapRepositoryProvider),
                                  readContext: state.context!,
                                  mode: state.mode,
                                  dataMode: state.dataMode,
                                  onItemSelected: select,
                                )
                              : null,
                        )
                      : null,
                );
              },
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tabTo(WidgetTester tester, Finder target) async {
  final targetElement = tester.element(target);
  for (var attempt = 0; attempt < 20; attempt++) {
    final focusedContext = FocusManager.instance.primaryFocus?.context;
    var containsFocus = focusedContext == targetElement;
    if (focusedContext is Element) {
      focusedContext.visitAncestorElements((ancestor) {
        if (ancestor == targetElement) containsFocus = true;
        return !containsFocus;
      });
    }
    if (containsFocus) return;
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
  }
  fail('Keyboard traversal did not reach $target.');
}

final class _Repository implements MapRepository {
  final List<String> detailIds = [];

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) async {
    detailIds.add(id);
    final item = id == _aggregate.id ? _aggregate : _sensor;
    return MapItemResponse(
      schemaVersion: 1,
      requestId: context.requestId,
      snapshotId: context.snapshotId,
      generatedAt: _viewport.generatedAt,
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
      item: item,
    );
  }

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) async => MapItemPage(
    schemaVersion: 1,
    requestId: query.requestId,
    snapshotId: query.snapshotId,
    generatedAt: _viewport.generatedAt,
    mode: MapQueryMode.current,
    dataMode: MapDataMode.sample,
    items: _viewport.layers.single.items,
    completeness: MapCompleteness.complete,
    nextCursor: null,
    totalMatching: _viewport.layers.single.items.length,
    scope: PageScope.aggregateMembers(
      aggregateId: id,
      bounds: _aggregate.details.bounds,
      window: _aggregate.details.window,
      unit: _aggregate.details.metric.unit,
    ),
  );

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
