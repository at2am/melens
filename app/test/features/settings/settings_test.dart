import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/state/user_events_providers.dart';
import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/state/feed_providers.dart';
import 'package:melens/features/location/state/user_location.dart';
import 'package:melens/features/map/state/viewport_controller.dart';
import 'package:melens/features/shell/state/shell_providers.dart';

import '../../support/app_harness.dart';
import '../feed/fake_feeds_client.dart';

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

  testWidgets('location sharing and map search are the app switches', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    expect(find.byType(SwitchListTile), findsNWidgets(2));
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

  group('feeds', () {
    final feeds = [
      const FeedSubscription(
        id: 'work',
        name: 'Work',
        topics: {FeedTopic.events, FeedTopic.disruptions},
        scope: AreaFeedScope('docklands'),
      ),
      const FeedSubscription(
        id: 'city',
        name: 'Whole city',
        topics: {FeedTopic.planning},
        scope: CityFeedScope(),
      ),
    ];

    testWidgets('settings lists the feeds with their topics and area', (
      tester,
    ) async {
      final container = appContainer(feeds: FakeFeedsClient(feeds));
      addTearDown(container.dispose);
      await pumpApp(tester, container, size: const Size(390, 1600));
      await openSettings(tester);

      expect(find.text('Work'), findsOneWidget);
      expect(find.text('Events, Disruptions · Docklands'), findsOneWidget);
      expect(find.text('Planning · All of Melbourne'), findsOneWidget);
      expect(key('settings-feed-new'), findsOneWidget);
    });

    testWidgets('pausing a feed saves it and takes it off the feed', (
      tester,
    ) async {
      final client = FakeFeedsClient(feeds);
      final container = appContainer(feeds: client);
      addTearDown(container.dispose);
      await pumpApp(tester, container, size: const Size(390, 1600));
      expect(key('feed-chip-work'), findsOneWidget);
      await openSettings(tester);

      await tester.tap(key('settings-feed-switch-work'));
      await tester.pumpAndSettle();
      expect(client.saves.single.first.enabled, isFalse);
      expect(find.textContaining('Paused · '), findsOneWidget);

      await tester.tap(key('tab-feed'));
      await tester.pumpAndSettle();
      expect(key('feed-chip-work'), findsNothing);
      expect(key('feed-chip-city'), findsOneWidget);
    });

    testWidgets('a feed opens in the editor and can be deleted', (
      tester,
    ) async {
      final client = FakeFeedsClient(feeds);
      final container = appContainer(feeds: client);
      addTearDown(container.dispose);
      await pumpApp(tester, container, size: const Size(390, 1600));
      await openSettings(tester);

      await tester.tap(find.text('Work'));
      await tester.pumpAndSettle();
      expect(find.text('Edit feed'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Work'), findsOneWidget);

      await tester.tap(key('feed-delete'));
      await tester.pumpAndSettle();
      expect(find.text('Delete Work?'), findsOneWidget);
      await tester.tap(key('feed-delete-confirm'));
      await tester.pumpAndSettle();

      expect(key('settings-list'), findsOneWidget);
      expect(find.text('Work'), findsNothing);
      expect(client.saves.single.map((feed) => feed.id), ['city']);
      expect(
        container.read(feedSubscriptionsProvider).value!.single.id,
        'city',
      );
    });

    testWidgets('editing a feed keeps its id and saves the change', (
      tester,
    ) async {
      final client = FakeFeedsClient(feeds);
      final container = appContainer(feeds: client);
      addTearDown(container.dispose);
      await pumpApp(tester, container, size: const Size(390, 1600));
      await openSettings(tester);

      await tester.tap(find.text('Whole city'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Everywhere');
      await tester.tap(key('feed-save'));
      await tester.pumpAndSettle();

      final saved = client.saves.single;
      expect(saved.map((feed) => feed.id), ['work', 'city']);
      expect(saved.last.name, 'Everywhere');
      expect(saved.last.scope, const CityFeedScope());
      expect(find.text('Everywhere'), findsOneWidget);
    });
  });
}
