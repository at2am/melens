import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/state/user_events_providers.dart';
import 'package:melens/features/location/state/user_location.dart';
import 'package:melens/features/map/state/viewport_controller.dart';
import 'package:melens/features/shell/state/shell_providers.dart';

import '../../support/app_harness.dart';

Finder key(String name) => find.byKey(ValueKey(name));

Future<void> openSettings(WidgetTester tester) async {
  await tester.tap(key('tab-settings'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('settings shows the profile and data source', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    expect(find.text('Add your name'), findsOneWidget);
    expect(find.text('Sample data for development'), findsOneWidget);
  });

  testWidgets('the name you set is the one events show when you join', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    await tester.tap(key('settings-profile'));
    await tester.pumpAndSettle();
    await tester.enterText(key('settings-name-field'), 'Hana');
    await tester.tap(key('settings-name-save'));
    await tester.pumpAndSettle();

    expect(container.read(userEventDisplayNameProvider), 'Hana');
    expect(find.text('Hana'), findsOneWidget);
  });

  testWidgets('a blank name clears it', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    container.read(userEventDisplayNameProvider.notifier).remember('Hana');
    container.read(userEventDisplayNameProvider.notifier).remember('   ');
    expect(container.read(userEventDisplayNameProvider), isNull);
  });

  testWidgets('location sharing and map search are the only switches', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    expect(find.byType(Switch), findsNWidgets(2));
    expect(key('feed-topic-news'), findsNothing);
  });

  testWidgets('the map waits for Search this area unless auto-search is on', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    expect(container.read(mapAutoSearchProvider), isFalse);
    expect(
      find.text('Off. After moving the map, tap Search this area.'),
      findsOneWidget,
    );
    await tester.tap(key('settings-map-auto-search'));
    await tester.pumpAndSettle();
    expect(container.read(mapAutoSearchProvider), isTrue);
    expect(
      find.text('On. The map searches again after every pan or zoom.'),
      findsOneWidget,
    );
  });

  testWidgets('the location switch shares the position only while on', (
    tester,
  ) async {
    final container = appContainer(
      deviceLocation: () async => const AgentLatLng(lat: -37.81, lng: 144.96),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    expect(container.read(userLocationProvider).point, isNull);
    await tester.scrollUntilVisible(
      key('settings-location'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(key('settings-location'));
    await tester.pumpAndSettle();
    expect(container.read(userLocationProvider).point?.lat, -37.81);
    expect(find.textContaining('never stored'), findsOneWidget);

    await tester.tap(key('settings-location'));
    await tester.pumpAndSettle();
    expect(container.read(userLocationProvider).point, isNull);
  });

  testWidgets('the theme choice restyles the app', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();
    expect(container.read(appThemeSettingProvider), AppThemeChoice.dark);
    final context = tester.element(key('settings-list'));
    expect(Theme.of(context).brightness, Brightness.dark);

    await tester.tap(find.text('Light'));
    await tester.pumpAndSettle();
    expect(
      Theme.of(tester.element(key('settings-list'))).brightness,
      Brightness.light,
    );
  });
}
