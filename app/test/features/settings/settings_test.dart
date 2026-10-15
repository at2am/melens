import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/events/state/event_providers.dart';
import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/state/feed_providers.dart';
import 'package:melens/features/shell/state/shell_providers.dart';

import '../../support/app_harness.dart';

Finder key(String name) => find.byKey(ValueKey(name));

Future<void> openSettings(WidgetTester tester) async {
  await tester.tap(key('tab-settings'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('settings shows the profile, topics and data source', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    expect(find.text('You'), findsOneWidget);
    expect(key('feed-topic-community'), findsOneWidget);
    expect(find.text('Sample data for development'), findsOneWidget);
  });

  testWidgets('renaming yourself changes who hosts your events', (
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

    expect(container.read(currentProfileProvider).displayName, 'Hana');
    expect(find.text('Hana'), findsOneWidget);
  });

  testWidgets('a blank name is ignored', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    container.read(currentProfileProvider.notifier).rename('   ');
    expect(container.read(currentProfileProvider).displayName, 'You');
  });

  testWidgets('topic switches follow and unfollow', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1600));
    await openSettings(tester);

    await tester.tap(key('feed-topic-news'));
    await tester.pump();
    expect(container.read(feedSubscriptionsProvider), contains(FeedTopic.news));
    await tester.tap(key('feed-topic-community'));
    await tester.pump();
    expect(
      container.read(feedSubscriptionsProvider),
      isNot(contains(FeedTopic.community)),
    );
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
