import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/map/state/map_actions.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/ui/map_screen.dart';
import 'package:melens/features/map/ui/map_surface.dart';
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
  testWidgets('the toolbar opens the chat beside the map on wide screens', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = FakeAgentClient();
    final focused = <MapFocusRequest>[];
    final container = await showScreen(tester, client, focused: focused);
    expect(find.byKey(const ValueKey('map-chat-panel')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('map-chat-toggle')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const ValueKey('map-chat-panel')), findsOneWidget);
    expect(find.byKey(const ValueKey('fake-map')), findsOneWidget);
    expect(client.calls, ['list']);

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

    await tester.tap(find.byKey(const ValueKey('chat-close')));
    await tester.pump();
    expect(find.byKey(const ValueKey('map-chat-panel')), findsNothing);
  });

  testWidgets('the toolbar opens the chat as a sheet on narrow screens', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await showScreen(tester, FakeAgentClient(), focused: []);

    await tester.tap(find.byKey(const ValueKey('map-chat-toggle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('map-chat-panel')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('map-chat-panel')), findsNothing);
  });
}
