import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/network/public_source_opener.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/state/viewport_controller.dart';
import 'package:melens/features/map/ui/map_screen.dart';
import 'package:melens/features/map/ui/map_surface.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../t017_test_support.dart';

Future<ProviderContainer> showScreen(
  WidgetTester tester,
  T017Repository repository, {
  MapSurfaceReadiness readiness = MapSurfaceReadiness.ready,
  MapSurfaceBuilder? builder,
  MapVisibleRegionReader? reader,
  UnlocatedScope? scope,
  Object? catalogError,
}) async {
  final container = ProviderContainer(
    overrides: [
      mapRepositoryProvider.overrideWithValue(repository),
      if (catalogError != null)
        mapLayerCatalogProvider.overrideWith((ref) async => throw catalogError),
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
      mapSurfaceReadinessProvider.overrideWith((ref) async => readiness),
    ],
  );
  addTearDown(container.dispose);
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
          mapBuilder:
              builder ??
              (context, configuration) =>
                  const SizedBox(key: ValueKey('fake-map')),
          visibleRegionReader: reader,
          approvedUnlocatedScope: scope,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump();
  return container;
}

/// Opens the results sheet: the legend, the text list of results and, folded
/// away, the layer statuses.
Future<void> openLayers(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('map-layers-button')));
  await tester.pumpAndSettle();
}

/// Picks a result from the text list in the layers sheet; the sheet closes.
Future<void> pickFromList(WidgetTester tester, String title) async {
  await openLayers(tester);
  await tester.ensureVisible(find.text(title));
  await tester.tap(find.text(title));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('loading and failure keep the actual map rectangle stable', (
    tester,
  ) async {
    final repository = T017Repository();
    final container = await showScreen(
      tester,
      repository,
      reader: () async => t017Region,
    );
    final map = find.byKey(const ValueKey('fake-map'));
    final pendingSize = tester.getSize(map);
    final pendingPosition = tester.getTopLeft(map);
    final first = repository.queries.last;
    first.result.complete(t017Response(first.query));
    await tester.pump();
    await tester.pump();
    expect(container.read(viewportControllerProvider).isLoading, isFalse);
    expect(tester.getSize(map), pendingSize);
    expect(tester.getTopLeft(map), pendingPosition);

    final refresh = container
        .read(viewportControllerProvider.notifier)
        .refresh();
    await tester.pump();
    expect(tester.getSize(map), pendingSize);
    repository.queries.last.result.completeError(const MapNetworkException());
    await refresh;
    await tester.pump();
    expect(container.read(viewportControllerProvider).error, isNotNull);
    expect(tester.getSize(map), pendingSize);
    expect(tester.getTopLeft(map), pendingPosition);
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed catalog without query bounds does not claim loading', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = T017Repository(autoComplete: true);
    await showScreen(
      tester,
      repository,
      readiness: MapSurfaceReadiness.missingKey,
      catalogError: const MapRequestException(),
    );
    expect(find.text('Layer catalog could not load.'), findsOneWidget);
    expect(find.text('Loading map data'), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(repository.queries, isEmpty);
    expect(find.text('Retry layer catalog'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('desktop joins defaults, typed list and gated topics', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = T017Repository(autoComplete: true);
    final container = await showScreen(
      tester,
      repository,
      reader: () async => t017Region,
    );
    expect(find.byKey(const ValueKey('map-layer-chips')), findsOneWidget);
    expect(find.text('The map goes here (UC-01).'), findsNothing);
    await openLayers(tester);
    expect(find.text('Sample sensor A'), findsOneWidget);
    expect(find.text('Sample data — illustrative only'), findsWidgets);
    expect(find.byKey(const ValueKey('fake-map')), findsOneWidget);
    expect(repository.queries.last.query.layers, [
      MapLayerId.pedestrian,
      MapLayerId.anomaly,
      MapLayerId.disruption,
    ]);
    expect(
      container.read(viewportControllerProvider).bbox!.toJson(),
      t017Region.toJson(),
    );
    // One control per thing: layers are chips and the map has no switches.
    expect(find.byType(Switch), findsNothing);
    expect(find.text('Now'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing key keeps explicit service scope and readable details', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    final container = await showScreen(
      tester,
      repository,
      readiness: MapSurfaceReadiness.missingKey,
    );
    expect(find.textContaining('configure an authorized'), findsOneWidget);
    expect(
      find.textContaining('Results use the query service area'),
      findsOneWidget,
    );
    await openLayers(tester);
    expect(find.text('Sample sensor A'), findsOneWidget);
    await tester.ensureVisible(find.text('Sample sensor A'));
    await tester.tap(find.text('Sample sensor A'));
    await tester.pumpAndSettle();
    expect(
      container.read(selectionControllerProvider).selectedItemId,
      'sample.sensor.A',
    );
    expect(repository.detailContexts.single.snapshotId, 'sample-snapshot');
    expect(
      find.byKey(const ValueKey('map-details-side-layout')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('narrow layout has bottom details and keyboard close', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final repository = T017Repository(autoComplete: true);
    final container = await showScreen(tester, repository);
    await pickFromList(tester, 'Sample sensor A');
    expect(
      find.byKey(const ValueKey('map-details-bottom-layout')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(container.read(selectionControllerProvider).hasSelection, isFalse);
    expect(
      find.byKey(const ValueKey('map-details-bottom-layout')),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('zero layers clear results and skip extra network', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    MapSurfaceConfiguration? map;
    final container = await showScreen(
      tester,
      repository,
      reader: () async => t017Region,
      builder: (context, configuration) {
        map = configuration;
        return const SizedBox();
      },
    );
    await pickFromList(tester, 'Sample sensor A');
    map!.onCameraChanged!(
      const CameraPosition(target: LatLng(-37.82, 144.97), zoom: 16),
    );
    final before = repository.queries.length;
    final layers = container.read(layerControllerProvider.notifier);
    for (final id in container.read(layerControllerProvider).enabledLayers) {
      layers.setLayerEnabled(id, false);
    }
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(repository.queries, hasLength(before));
    expect(container.read(viewportControllerProvider).response, isNull);
    expect(
      container.read(selectionControllerProvider).disposition,
      MapSelectionDisposition.filterExcluded,
    );
    // Community events are the app's own layer, with their own switch.
    expect(
      map!.renderPlan.markers.where(
        (marker) => !marker.markerId.value.startsWith('user-event:'),
      ),
      isEmpty,
    );
    expect(find.textContaining('No layers selected'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('idle reads real camera region and bounds request', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    MapSurfaceConfiguration? map;
    var region = t017Region;
    var reads = 0;
    final container = await showScreen(
      tester,
      repository,
      reader: () async {
        reads++;
        return region;
      },
      builder: (context, configuration) {
        map = configuration;
        return const SizedBox();
      },
    );
    region = const MapBounds(west: 143, south: -40, east: 145, north: -37.7);
    map!.onCameraChanged!(
      const CameraPosition(target: LatLng(-37.8, 144.5), zoom: 17),
    );
    map!.onCameraIdle!();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(reads, 2);
    expect(repository.queries.last.query.bbox.toJson(), [144, -39, 145, -37.7]);
    expect(container.read(viewportControllerProvider).zoom, 17);
    expect(map!.initialCameraPosition.zoom, 14);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'history failure retains original time and exclusion after retry',
    (tester) async {
      final repository = T017Repository(autoComplete: true);
      final container = await showScreen(tester, repository);
      await pickFromList(tester, 'Sample sensor A');
      repository.nextViewportError = const MapNetworkException();
      await tester.tap(find.byKey(const ValueKey('map-time-menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Past hour'));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      await tester.pumpAndSettle();
      expect(
        container.read(viewportControllerProvider).response!.mode,
        MapQueryMode.current,
      );
      expect(
        find.text('Displayed records keep their previous query window.'),
        findsOneWidget,
      );
      expect(
        container.read(selectionControllerProvider).disposition,
        MapSelectionDisposition.filterExcluded,
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('map-viewport-retry')),
      );
      await tester.tap(find.byKey(const ValueKey('map-viewport-retry')));
      await tester.pump();
      await tester.pump();
      expect(
        container.read(viewportControllerProvider).response!.mode,
        MapQueryMode.historical,
      );
      expect(
        container.read(selectionControllerProvider).disposition,
        MapSelectionDisposition.filterExcluded,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('unlocated uses admitted scope and independent detail context', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    final container = await showScreen(
      tester,
      repository,
      scope: const UnlocatedScope.sourceJurisdiction(
        'Sample Melbourne source jurisdiction',
      ),
    );
    await openLayers(tester);
    await tester.ensureVisible(
      find.byKey(const ValueKey('map-show-unlocated')),
    );
    await tester.tap(find.byKey(const ValueKey('map-show-unlocated')));
    await tester.pumpAndSettle();
    expect(repository.unlocatedQueries, hasLength(1));
    expect(repository.unlocatedQueries.single.snapshotId, isNull);
    await tester.tap(
      find.byKey(const ValueKey('unlocated-item-sample.sensor.C')),
    );
    await tester.pump();
    await tester.pump();
    expect(
      container.read(selectionControllerProvider).selectedItemId,
      'sample.sensor.C',
    );
    expect(container.read(selectionControllerProvider).item!.geometry, isNull);
    expect(repository.detailContexts.last.requestId, startsWith('unlocated-'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('late visible-region reads cannot replace a newer idle view', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    MapSurfaceConfiguration? map;
    final old = Completer<MapBounds>();
    final newest = Completer<MapBounds>();
    var calls = 0;
    final container = await showScreen(
      tester,
      repository,
      reader: () {
        calls++;
        return calls == 1
            ? Future.value(t017Region)
            : calls == 2
            ? old.future
            : newest.future;
      },
      builder: (context, configuration) {
        map = configuration;
        return const SizedBox();
      },
    );
    map!.onCameraChanged!(
      const CameraPosition(target: LatLng(-37.8, 145), zoom: 15),
    );
    map!.onCameraIdle!();
    map!.onCameraChanged!(
      const CameraPosition(target: LatLng(-37.9, 145.1), zoom: 16),
    );
    map!.onCameraIdle!();
    const target = MapBounds(west: 145, south: -38, east: 145.2, north: -37.8);
    newest.complete(target);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    old.complete(t017Region);
    await tester.pump();
    expect(
      container.read(viewportControllerProvider).bbox!.toJson(),
      target.toJson(),
    );
    expect(repository.queries.last.query.zoom, 15);
    expect(container.read(viewportControllerProvider).zoom, 16);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'status sheet preserves partial records and safe refresh failure',
    (tester) async {
      final repository = T017Repository(autoComplete: true)..partial = true;
      final container = await showScreen(tester, repository);
      final original = container.read(viewportControllerProvider).response;
      repository.nextViewportError = const MapNetworkException();
      await container.read(viewportControllerProvider.notifier).refresh();
      await tester.pump();
      await openLayers(tester);
      await tester.tap(find.byKey(const ValueKey('map-data-status')));
      await tester.pumpAndSettle();
      expect(
        container.read(viewportControllerProvider).response,
        same(original),
      );
      expect(find.text('Data available'), findsWidgets);
      expect(find.text('Partial result — more data may exist'), findsWidgets);
      expect(find.text('Full matching total unknown'), findsWidgets);
      expect(
        find.text('Showing the previous result with its original time'),
        findsWidgets,
      );
      expect(find.textContaining('MapNetworkException'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  test('source opener accepts HTTP(S) URLs without credentials', () {
    expect(isPublicSourceUri(Uri.parse('https://example.org/data')), isTrue);
    expect(isPublicSourceUri(Uri.parse('http://example.org/data')), isTrue);
    expect(isPublicSourceUri(Uri.parse('javascript:alert(1)')), isFalse);
    expect(isPublicSourceUri(Uri.parse('file:///private/data')), isFalse);
    expect(
      isPublicSourceUri(Uri.parse('https://user:password@example.org')),
      isFalse,
    );
    expect(supportsPublicSourceOpening, isFalse);
  });
}
