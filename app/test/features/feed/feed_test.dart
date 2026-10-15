import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/state/feed_providers.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';

import '../../support/app_harness.dart';
import '../map/t017_test_support.dart';

Finder key(String name) => find.byKey(ValueKey(name));

void main() {
  test('new users follow community events, events and disruptions', () {
    final container = appContainer();
    addTearDown(container.dispose);
    expect(container.read(feedSubscriptionsProvider), defaultFeedTopics);
  });

  test('topics map to the layers behind them', () {
    expect(FeedTopic.community.layer, isNull);
    expect(FeedTopic.forLayer(FeedTopic.news.layer!), FeedTopic.news);
  });

  testWidgets('the feed shows community events, soonest first', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(find.text('Sunset sketching on the river'), findsOneWidget);
    expect(find.text('Laneway acoustic night'), findsOneWidget);
    // Sample content says so.
    expect(find.text('Sample'), findsWidgets);
  });

  testWidgets('unfollowing a topic removes its items', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);
    expect(find.text('Laneway acoustic night'), findsOneWidget);

    await tester.tap(key('feed-chip-community'));
    await tester.pumpAndSettle();
    expect(find.text('Laneway acoustic night'), findsNothing);
    expect(
      container.read(feedSubscriptionsProvider),
      isNot(contains(FeedTopic.community)),
    );

    await tester.tap(key('feed-chip-community'));
    await tester.pumpAndSettle();
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('following nothing explains how to fill the feed', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);
    for (final topic in defaultFeedTopics) {
      container
          .read(feedSubscriptionsProvider.notifier)
          .setSubscribed(topic, false);
    }
    await tester.pumpAndSettle();

    expect(find.text('You are not following anything'), findsOneWidget);
    await tester.tap(find.text('Choose topics'));
    await tester.pumpAndSettle();
    expect(find.text('What do you follow?'), findsOneWidget);
    await tester.tap(key('feed-topic-news'));
    await tester.pumpAndSettle();
    expect(
      container.read(feedSubscriptionsProvider),
      {FeedTopic.news},
    );
  });

  testWidgets('map layers feed from the map service', (tester) async {
    final repository = T017Repository(autoComplete: true);
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    final queried = repository.queries.map((q) => q.query);
    final feedQuery = queried.firstWhere((q) => q.requestId.startsWith('feed-'));
    expect(feedQuery.layers, containsAll(['event', 'disruption'].map(
      (name) => FeedTopic.values.firstWhere((t) => t.layer?.name == name).layer,
    )));
    expect(feedQuery.layers.length, 2);
  });

  testWidgets('a failing map service is reported without hiding other topics', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true)
      ..nextViewportError = const MapNetworkException();
    final container = appContainer(mapRepository: repository);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(key('feed-source-failed'), findsOneWidget);
    expect(find.textContaining('Events, Disruptions'), findsOneWidget);
    // The community events still show.
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('tapping a community event opens its page', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    await tester.tap(find.text('Laneway acoustic night'));
    await tester.pumpAndSettle();
    expect(find.text('Hosted by Jordan'), findsOneWidget);
    expect(container.read(selectionControllerProvider).hasSelection, isFalse);
    expect(container.read(mapRepositoryProvider), isNotNull);
  });
}
