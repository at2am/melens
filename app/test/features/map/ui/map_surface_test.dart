import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/ui/map_surface.dart';
import 'package:melens/features/map/ui/renderers/core_renderers.dart';
import 'package:melens/l10n/app_localizations.dart';

Map<String, dynamic> _fixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;

final _sample = ViewportResponse.fromJson(_fixture('viewport'));

List<MapItem> _itemVariants() =>
    (jsonDecode(
          File(
            '../specs/002-map-data-presentation/contracts/examples/'
            'item-variants.sample.json',
          ).readAsStringSync(),
        ) as List<dynamic>)
        .map((item) => MapItem.fromJson(item as Map<String, dynamic>))
        .toList();

LayerResult _layerWithItems(List<MapItem> items) {
  final layer = _sample.layers.single;
  return LayerResult(
    layerId: items.isEmpty ? layer.layerId : items.first.layerId,
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
    totalMatching: null,
  );
}

Future<void> _show(
  WidgetTester tester,
  Widget surface, {
  Future<MapSurfaceReadiness> Function(Ref)? readiness,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        envProvider.overrideWithValue(
          Env(
            environment: AppEnvironment.dev,
            agentBaseUrl: Uri.parse('http://localhost:8080'),
            mapBaseUrl: Uri.parse('http://localhost:8081'),
            mapDataMode: MapDataMode.sample,
          ),
        ),
        mapSurfaceReadinessProvider.overrideWith(
          readiness ?? (ref) async => MapSurfaceReadiness.ready,
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(body: surface),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('fake map exposes exact count semantics and original selection', (
    tester,
  ) async {
    MapSurfaceConfiguration? configuration;
    MapItem? selected;
    await _show(
      tester,
      MapSurface(
        layers: _sample.layers,
        enabledLayers: const {MapLayerId.pedestrian},
        dataMode: MapDataMode.sample,
        onItemSelected: (item) => selected = item,
        mapBuilder: (context, value) {
          configuration = value;
          return const SizedBox(key: ValueKey('fake-map'));
        },
      ),
    );
    expect(find.text('Sample data — illustrative only'), findsOneWidget);
    expect(find.textContaining('16 m² per passage'), findsOneWidget);
    expect(find.textContaining('Sensor passages: 0'), findsOneWidget);
    expect(configuration!.mapId, isNull);
    expect(configuration!.renderPlan.circles, hasLength(2));
    await tester.tap(find.text('Sample sensor A'));
    expect(selected, same(_sample.layers.single.items.first));
    expect(tester.takeException(), isNull);
  });

  testWidgets('keyboard Enter selects an object without pointer map input', (
    tester,
  ) async {
    MapItem? selected;
    await _show(
      tester,
      MapSurface(
        layers: [
          _layerWithItems([_sample.layers.single.items.first]),
        ],
        enabledLayers: const {MapLayerId.pedestrian},
        dataMode: MapDataMode.sample,
        onItemSelected: (item) => selected = item,
        mapBuilder: (context, value) => const SizedBox(),
      ),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(selected, same(_sample.layers.single.items.first));
  });

  testWidgets(
    'anomalies and planned/current disruptions have explicit text labels',
    (tester) async {
      final variants = _itemVariants();
      final anomaly = variants.whereType<AnomalyMapItem>().first;
      final disruption = variants.whereType<DisruptionMapItem>().first;
      final planned = disruption.copyWith(
        id: 'sample.planned-disruption',
        lifecycle: MapLifecycle.planned,
        assertionKind: MapAssertionKind.plan,
      );
      final active = disruption.copyWith(lifecycle: MapLifecycle.active);
      MapSurfaceConfiguration? configuration;
      await _show(
        tester,
        MapSurface(
          layers: [
            _layerWithItems([anomaly]),
            _layerWithItems([planned, active]),
          ],
          enabledLayers: const {MapLayerId.anomaly, MapLayerId.disruption},
          dataMode: MapDataMode.sample,
          mapBuilder: (context, value) {
            configuration = value;
            return const SizedBox();
          },
        ),
      );
      expect(find.textContaining('Pedestrian anomalies'), findsOneWidget);
      expect(find.textContaining('Status: planned'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.textContaining('Status: active'),
        80,
        scrollable: find.descendant(
          of: find.byKey(const ValueKey('map-surface-objects')),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Status: active'), findsOneWidget);
      expect(
        configuration!.renderPlan.markers.single.infoWindow.snippet,
        contains('Pedestrian anomalies'),
      );
    },
  );

  testWidgets(
    'missing key keeps sample label and count list without platform map',
    (tester) async {
      var mapBuilt = false;
      await _show(
        tester,
        MapSurface(
          layers: _sample.layers,
          enabledLayers: const {MapLayerId.pedestrian},
          dataMode: MapDataMode.sample,
          mapBuilder: (context, value) {
            mapBuilt = true;
            return const SizedBox();
          },
        ),
        readiness: (ref) async => MapSurfaceReadiness.missingKey,
      );
      expect(find.textContaining('configure an authorized'), findsOneWidget);
      expect(find.text('Sample data — illustrative only'), findsOneWidget);
      expect(find.textContaining('Sensor passages: 0'), findsOneWidget);
      expect(mapBuilt, isFalse);
    },
  );

  testWidgets(
    'unknown location and missing observation stay list-only and unknown',
    (tester) async {
      final unlocated = MapItemPage.fromJson(_fixture('unlocated'))
          .items
          .single;
      MapSurfaceConfiguration? configuration;
      await _show(
        tester,
        MapSurface(
          layers: [
            _layerWithItems([unlocated]),
          ],
          enabledLayers: const {MapLayerId.pedestrian},
          dataMode: MapDataMode.sample,
          mapBuilder: (context, value) {
            configuration = value;
            return const SizedBox();
          },
        ),
      );
      expect(configuration!.renderPlan.markers, isEmpty);
      expect(configuration!.renderPlan.circles, isEmpty);
      expect(find.textContaining('Location unavailable'), findsOneWidget);
      expect(find.textContaining('Passage count unknown'), findsOneWidget);
      expect(find.textContaining('Sensor passages: 0'), findsNothing);
    },
  );

  testWidgets('layer changes update overlays while mounted camera survives', (
    tester,
  ) async {
    final fakeKey = GlobalKey<_FakeCameraMapState>();
    final surfaceKey = GlobalKey();
    final enabled = ValueNotifier(<MapLayerId>{MapLayerId.pedestrian});
    addTearDown(enabled.dispose);
    CameraPosition? reportedCamera;
    await _show(
      tester,
      ValueListenableBuilder<Set<MapLayerId>>(
        valueListenable: enabled,
        builder: (context, layers, child) => MapSurface(
          key: surfaceKey,
          layers: _sample.layers,
          enabledLayers: layers,
          dataMode: MapDataMode.sample,
          onCameraChanged: (value) => reportedCamera = value,
          mapBuilder: (context, value) =>
              _FakeCameraMap(key: fakeKey, configuration: value),
        ),
      ),
    );
    final original = fakeKey.currentState!;
    const moved = CameraPosition(target: LatLng(-37.8, 145), zoom: 16);
    original.pan(moved);
    expect(reportedCamera, moved);
    enabled.value = {};
    await tester.pump();
    expect(fakeKey.currentState, same(original));
    expect(original.camera, moved);
    expect(original.widget.configuration.renderPlan.markers, isEmpty);
    expect(original.widget.configuration.renderPlan.circles, isEmpty);
    enabled.value = {MapLayerId.pedestrian};
    await tester.pump();
    expect(original.camera, moved);
    expect(original.widget.configuration.renderPlan.markers, hasLength(2));
  });

  testWidgets(
    'short narrow surface keeps legend scrollable and objects selectable',
    (tester) async {
      MapItem? selected;
      final height = ValueNotifier(400.0);
      final fakeKey = GlobalKey<_FakeCameraMapState>();
      addTearDown(height.dispose);
      await _show(
        tester,
        Center(
          child: ValueListenableBuilder<double>(
            valueListenable: height,
            builder: (context, height, child) => SizedBox(
              width: 390,
              height: height,
              child: MapSurface(
                layers: _sample.layers,
                enabledLayers: const {MapLayerId.pedestrian},
                dataMode: MapDataMode.sample,
                onItemSelected: (item) => selected = item,
                mapBuilder: (context, value) =>
                    _FakeCameraMap(key: fakeKey, configuration: value),
              ),
            ),
          ),
        ),
      );
      final original = fakeKey.currentState!;
      const moved = CameraPosition(target: LatLng(-37.8, 145), zoom: 16);
      original.pan(moved);
      height.value = 241;
      await tester.pump();
      expect(fakeKey.currentState, same(original));
      expect(original.camera, moved);
      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byKey(fakeKey)).height, greaterThan(70));
      await tester.drag(
        find.byKey(const ValueKey('map-surface-legend')),
        const Offset(0, -120),
      );
      await tester.pump();
      expect(
        find.text('Sample data — illustrative only').hitTestable(),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.text('Sample sensor B'),
        48,
        scrollable: find.descendant(
          of: find.byKey(const ValueKey('map-surface-objects')),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sample sensor B'));
      expect(selected, same(_sample.layers.single.items.last));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'very short missing-key state scrolls without overflowing map rectangle',
    (tester) async {
      await _show(
        tester,
        Center(
          child: SizedBox(
            width: 390,
            height: 120,
            child: MapSurface(
              layers: _sample.layers,
              enabledLayers: const {MapLayerId.pedestrian},
              dataMode: MapDataMode.sample,
              mapBuilder: (context, value) => const SizedBox(),
            ),
          ),
        ),
        readiness: (ref) async => MapSurfaceReadiness.missingKey,
      );
      expect(find.textContaining('configure an authorized'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('short failed readiness keeps retry reachable by scrolling', (
    tester,
  ) async {
    var attempts = 0;
    await _show(
      tester,
      Center(
        child: SizedBox(
          width: 390,
          height: 241,
          child: MapSurface(
            layers: _sample.layers,
            enabledLayers: const {MapLayerId.pedestrian},
            dataMode: MapDataMode.sample,
            mapBuilder: (context, value) => const SizedBox(),
          ),
        ),
      ),
      readiness: (ref) async {
        attempts++;
        throw StateError('Readiness failed');
      },
    );
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Retry base map'));
    await tester.tap(find.text('Retry base map'));
    await tester.pump();
    await tester.pump();
    expect(attempts, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'readiness errors retry explicitly and do not silently create map',
    (tester) async {
      final waiting = Completer<MapSurfaceReadiness>();
      var attempts = 0;
      var mapBuilt = false;
      await _show(
        tester,
        MapSurface(
          layers: _sample.layers,
          enabledLayers: const {MapLayerId.pedestrian},
          dataMode: MapDataMode.sample,
          mapBuilder: (context, configuration) {
            mapBuilt = true;
            return const SizedBox();
          },
        ),
        readiness: (ref) {
          attempts++;
          return attempts == 1
              ? waiting.future
              : Future.value(MapSurfaceReadiness.ready);
        },
      );
      expect(find.text('Loading base map…'), findsOneWidget);
      waiting.completeError(StateError('Network readiness failed'));
      await tester.pump();
      await tester.pump();
      expect(find.textContaining('Base map could not load'), findsOneWidget);
      expect(attempts, 1);
      expect(mapBuilt, isFalse);
      await tester.tap(find.text('Retry base map'));
      await tester.pump();
      await tester.pump();
      expect(attempts, 2);
      expect(mapBuilt, isTrue);
    },
  );

  testWidgets('aggregate hook receives original DTO and routes its selection', (
    tester,
  ) async {
    final aggregate = _itemVariants().whereType<AggregateMapItem>().first;
    AggregateMapItem? selected;
    await _show(
      tester,
      MapSurface(
        layers: [
          _layerWithItems([aggregate]),
        ],
        enabledLayers: const {MapLayerId.pedestrian},
        dataMode: MapDataMode.sample,
        selectedItemId: aggregate.id,
        onAggregateSelected: (item) => selected = item,
        aggregateRenderer: (context, items, selectedId, onSelected) {
          expect(items.single, same(aggregate));
          expect(selectedId, aggregate.id);
          return CoreRenderPlan(
            markers: {
              Marker(
                markerId: MarkerId(aggregate.id),
                onTap: () => onSelected!(aggregate),
              ),
            },
          );
        },
        mapBuilder: (context, value) {
          value.renderPlan.markers.single.onTap!();
          return const SizedBox();
        },
      ),
    );
    expect(selected, same(aggregate));
  });
}

class _FakeCameraMap extends StatefulWidget {
  const _FakeCameraMap({required this.configuration, super.key});

  final MapSurfaceConfiguration configuration;

  @override
  State<_FakeCameraMap> createState() => _FakeCameraMapState();
}

class _FakeCameraMapState extends State<_FakeCameraMap> {
  late CameraPosition camera;

  @override
  void initState() {
    super.initState();
    camera = widget.configuration.initialCameraPosition;
  }

  void pan(CameraPosition position) {
    camera = position;
    widget.configuration.onCameraChanged?.call(position);
  }

  @override
  Widget build(BuildContext context) => const SizedBox();
}
