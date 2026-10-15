import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
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

Future<ProviderContainer> showScreen(
  WidgetTester tester,
  FakeAgentClient client, {
  required List<MapFocusRequest> focused,
}) async {
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
        home: MapScreen(
          mapBuilder: (context, configuration) =>
              const SizedBox(key: ValueKey('fake-map')),
          visibleRegionReader: () async => t017Region,
          onFocusRequest: focused.add,
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
        },
      ),
    );
    await tester.pump();
    expect(find.text('Highlighted by the agent'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('map-highlight-event:unknown')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('map-highlight-missing-event:gone')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('map-highlights-clear')));
    await tester.pump();
    expect(find.text('Highlighted by the agent'), findsNothing);
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

    await tester.tap(find.byKey(const ValueKey('card-item-details-close')));
    await tester.pump();
    expect(find.byKey(const ValueKey('card-item-details')), findsNothing);
  });
}
