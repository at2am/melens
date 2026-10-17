import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/map/state/map_actions.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/ui/map_screen.dart';
import 'package:melens/features/map/ui/map_surface.dart';
import 'package:melens/features/shell/state/shell_providers.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../../agent/fake_agent_client.dart';
import '../t017_test_support.dart';

/// What the map was last asked to draw.
MapSurfaceConfiguration? _drawn;

/// The markers the map was last asked to draw, by id.
Map<String, Marker> _markers() => {
  for (final marker in _drawn!.renderPlan.markers)
    marker.markerId.value: marker,
};

/// [visible] stands for the map's tab being on screen; without it, it is.
Future<ProviderContainer> showScreen(
  WidgetTester tester,
  FakeAgentClient client, {
  required List<MapFocusRequest> focused,
  ValueListenable<bool>? visible,
}) async {
  final screen = MapScreen(
    mapBuilder: (context, configuration) {
      _drawn = configuration;
      return const SizedBox(key: ValueKey('fake-map'));
    },
    visibleRegionReader: () async => t017Region,
    onFocusRequest: focused.add,
  );
  final container = ProviderContainer(
    overrides: [
      mapRepositoryProvider.overrideWithValue(
        T017Repository(autoComplete: true),
      ),
      agentClientProvider.overrideWithValue(client),
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
        home: visible == null
            ? screen
            : ValueListenableBuilder<bool>(
                valueListenable: visible,
                builder: (context, on, child) =>
                    TickerMode(enabled: on, child: child!),
                child: screen,
              ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump();
  return container;
}

void main() {
  testWidgets('the agent moves the camera and highlights features', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final focused = <MapFocusRequest>[];
    final container = await showScreen(
      tester,
      FakeAgentClient(),
      focused: focused,
    );

    // A focus_map action reaches the screen's camera hook once per request.
    final actions = container.read(mapActionsControllerProvider.notifier);
    actions.apply(
      const UiAction(
        action: UiActionName.focusMap,
        args: <String, dynamic>{
          'target': {
            'point': {'lat': -37.81, 'lng': 144.96},
          },
          'zoom': 16,
        },
      ),
    );
    await tester.pump();
    expect(focused.single.point?.lng, 144.96);
    expect(focused.single.zoom, 16);

    // An app-side focus, such as "Show on map" on an event, takes the same path.
    actions.focusPoint(-37.8179, 144.9691);
    await tester.pump();
    expect(focused.last.point?.lat, -37.8179);

    // Highlights appear as chips above the map and can be cleared.
    actions.apply(
      const UiAction(
        action: UiActionName.highlightFeatures,
        args: <String, dynamic>{
          'ids': ['event:unknown'],
          'clear_previous': true,
          'missing': ['event:gone'],
          'titles': {'event:unknown': 'Late show at the Forum'},
        },
      ),
    );
    await tester.pump();
    expect(find.text('Highlighted by the agent'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('map-highlight-event:unknown')),
      findsOneWidget,
    );
    // An id the map has not loaded is labelled with the agent's title.
    expect(find.text('Late show at the Forum'), findsOneWidget);
    expect(find.text('event:unknown'), findsNothing);
    expect(
      find.byKey(const ValueKey('map-highlight-missing-event:gone')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('map-highlights-clear')));
    await tester.pump();
    expect(find.text('Highlighted by the agent'), findsNothing);
  });

  testWidgets('a route drawn while the map is hidden is fitted once it shows', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final focused = <MapFocusRequest>[];
    final visible = ValueNotifier(true);
    addTearDown(visible.dispose);
    final container = await showScreen(
      tester,
      FakeAgentClient(),
      focused: focused,
      visible: visible,
    );
    // The user leaves the map for Home and opens a saved plan.
    visible.value = false;
    await tester.pump();

    // Show route on the plan draws it while the plan page covers the map:
    // a fit to a hidden map has no size to fit to, so it waits.
    container
        .read(mapActionsControllerProvider.notifier)
        .apply(
          const UiAction(
            action: UiActionName.drawRoute,
            args: <String, dynamic>{
              'polyline': '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
              'mode': 'walk',
              'distance_m': 3400,
              'duration_min': 46,
            },
          ),
        );
    await tester.pump();
    expect(focused, isEmpty);
    expect(container.read(mapActionsControllerProvider).route, isNotNull);

    visible.value = true;
    await tester.pump();
    expect(focused.single.bounds?.north, closeTo(43.2525, 0.001));

    // Hiding and showing the map again does not fit the route again.
    visible.value = false;
    await tester.pump();
    visible.value = true;
    await tester.pump();
    expect(focused, hasLength(1));
  });

  testWidgets('a requested card item opens its details beside the map', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final container = await showScreen(
      tester,
      FakeAgentClient(),
      focused: <MapFocusRequest>[],
    );
    final requests = container.read(cardItemRequestsProvider.notifier);

    // The unloaded record is fetched by id against the shown snapshot and its
    // details open in the side pane.
    requests.request(
      const CardItem(
        title: 'Unlocated sensor',
        source: FeatureCardSource(featureId: 'sample.sensor.C'),
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.pump();
    expect(container.read(cardItemRequestsProvider), isNull);
    expect(find.byKey(const ValueKey('map-details-close')), findsOneWidget);
    expect(find.text('Sample unlocated sensor'), findsOneWidget);
    final selection = container.read(selectionControllerProvider);
    expect(selection.selectedItemId, 'sample.sensor.C');
    expect(selection.context?.snapshotId, 'sample-snapshot');
    expect(selection.isLoading, isFalse);

    // A place with no map record shows what the card knows about it.
    requests.request(
      const CardItem(
        title: 'State Library',
        summary: 'Open until 6 pm.',
        source: LinkCardSource(
          url: 'https://maps.google.com/?cid=1',
          title: 'Google Maps',
        ),
        placeId: 'place-1',
        location: AgentLatLng(lat: -37.8098, lng: 144.9652),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const ValueKey('map-details-close')), findsNothing);
    final pane = find.byKey(const ValueKey('card-item-details'));
    expect(pane, findsOneWidget);
    expect(
      find.descendant(of: pane, matching: find.text('Open until 6 pm.')),
      findsOneWidget,
    );
    expect(container.read(selectionControllerProvider).hasSelection, isFalse);
    // A pin of its own, named, marks where the place is.
    final pin = _markers()[cardItemMarkerId];
    expect(pin?.position, const LatLng(-37.8098, 144.9652));
    expect(pin?.infoWindow.title, 'State Library');

    await tester.tap(find.byKey(const ValueKey('card-item-details-close')));
    await tester.pump();
    expect(find.byKey(const ValueKey('card-item-details')), findsNothing);
    expect(_markers(), isNot(contains(cardItemMarkerId)));

    // A located record is pinned too, also when its layer is not drawn,
    // until another record is opened.
    requests.request(
      const CardItem(
        title: 'Unlocated sensor',
        source: FeatureCardSource(featureId: 'sample.sensor.C'),
        location: AgentLatLng(lat: -37.81, lng: 144.96),
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.pump();
    expect(
      container.read(selectionControllerProvider).selectedItemId,
      'sample.sensor.C',
    );
    expect(
      _markers()[cardItemMarkerId]?.position,
      const LatLng(-37.81, 144.96),
    );
    await tester.tap(find.byKey(const ValueKey('map-details-close')));
    await tester.pump();
    expect(_markers(), isNot(contains(cardItemMarkerId)));
    await tester.pump(const Duration(seconds: 1));
  });
}
