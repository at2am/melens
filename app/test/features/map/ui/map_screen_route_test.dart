import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/location/data/device_location.dart';
import 'package:melens/features/location/state/user_location.dart';
import 'package:melens/features/map/state/map_actions.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/ui/map_screen.dart';
import 'package:melens/features/map/ui/map_surface.dart';
import 'package:melens/features/map/ui/renderers/route_renderer.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../../agent/fake_agent_client.dart';
import '../t017_test_support.dart';

const _encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

Future<(ProviderContainer, List<MapSurfaceConfiguration>)> showScreen(
  WidgetTester tester, {
  required DeviceLocationReader location,
}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final configurations = <MapSurfaceConfiguration>[];
  final container = ProviderContainer(
    overrides: [
      mapRepositoryProvider.overrideWithValue(
        T017Repository(autoComplete: true),
      ),
      agentClientProvider.overrideWithValue(FakeAgentClient()),
      deviceLocationReaderProvider.overrideWithValue(location),
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
          mapBuilder: (context, configuration) {
            configurations.add(configuration);
            return const SizedBox(key: ValueKey('fake-map'));
          },
          visibleRegionReader: () async => t017Region,
          onFocusRequest: (_) {},
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump();
  return (container, configurations);
}

Finder key(String name) => find.byKey(ValueKey(name));

void main() {
  testWidgets('a drawn route shows on the map with a chip that removes it', (
    tester,
  ) async {
    final (container, configurations) = await showScreen(
      tester,
      location: () async => const AgentLatLng(lat: -37.81, lng: 144.96),
    );
    expect(key('map-route-chip'), findsNothing);

    container
        .read(mapActionsControllerProvider.notifier)
        .apply(
          const UiAction(
            action: UiActionName.drawRoute,
            args: <String, dynamic>{
              'polyline': _encoded,
              'mode': 'walk',
              'distance_m': 3400,
              'duration_min': 46,
              'waypoints': [
                {'lat': 38.5, 'lng': -120.2, 'label': 'Start'},
                {'lat': 43.252, 'lng': -126.453},
              ],
            },
          ),
        );
    await tester.pump();

    expect(find.text('46 min · 3.4 km, walk'), findsOneWidget);
    final plan = configurations.last.renderPlan;
    final line = plan.polylines.singleWhere(
      (p) => p.polylineId.value == routePolylineId,
    );
    expect(line.points, hasLength(3));
    expect(
      plan.markers.map((m) => m.markerId.value),
      containsAll(['${routeMarkerPrefix}0', '${routeMarkerPrefix}1']),
    );
    expect(
      plan.markers
          .firstWhere((m) => m.markerId.value == '${routeMarkerPrefix}0')
          .infoWindow
          .title,
      'Start',
    );
    expect(
      plan.markers
          .firstWhere((m) => m.markerId.value == '${routeMarkerPrefix}1')
          .infoWindow
          .title,
      'Stop 2',
    );

    await tester.tap(
      find.descendant(
        of: key('map-route-chip'),
        matching: find.byIcon(Icons.close),
      ),
    );
    await tester.pump();
    expect(key('map-route-chip'), findsNothing);
    expect(container.read(mapActionsControllerProvider).route, isNull);
    expect(configurations.last.renderPlan.polylines, isEmpty);
  });

  testWidgets('My location asks once, marks the user and tells the agent', (
    tester,
  ) async {
    var reads = 0;
    final (container, configurations) = await showScreen(
      tester,
      location: () async {
        reads++;
        return const AgentLatLng(lat: -37.81, lng: 144.96);
      },
    );
    expect(reads, 0);

    await tester.tap(key('map-chip-my-location'));
    await tester.pump();
    await tester.pump();

    expect(reads, 1);
    expect(container.read(userLocationProvider).status, UserLocationStatus.on);
    expect(
      configurations.last.renderPlan.markers.map((m) => m.markerId.value),
      contains(userLocationMarkerId),
    );

    await tester.tap(key('map-chip-my-location'));
    await tester.pump();
    expect(container.read(userLocationProvider).point, isNull);
    expect(
      configurations.last.renderPlan.markers.map((m) => m.markerId.value),
      isNot(contains(userLocationMarkerId)),
    );
  });

  testWidgets('a refused permission is explained on the map', (tester) async {
    final (container, _) = await showScreen(
      tester,
      location: () => Future.error(
        const DeviceLocationException(DeviceLocationFailure.denied),
      ),
    );

    await tester.tap(key('map-chip-my-location'));
    await tester.pump();
    await tester.pump();

    expect(key('map-location-error'), findsOneWidget);
    expect(find.textContaining('permission was refused'), findsOneWidget);
    expect(container.read(userLocationProvider).point, isNull);
  });
}
