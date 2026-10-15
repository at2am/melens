import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/state/feed_providers.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';

import '../../support/app_harness.dart';
import '../events/fake_user_events_client.dart';
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

    final sketch = tester.getTopLeft(
      find.text('Sunset sketching on the river'),
    );
    final laneway = tester.getTopLeft(find.text('Laneway acoustic night'));
    expect(sketch.dy, lessThan(laneway.dy));
    expect(find.text('Birrarung Marr'), findsNothing); // inside the meta line
    expect(find.textContaining('Birrarung Marr'), findsOneWidget);
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
    expect(container.read(feedSubscriptionsProvider), {FeedTopic.news});
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
    final feedQuery = queried.firstWhere(
      (q) => q.requestId.startsWith('feed-'),
    );
    expect(
      feedQuery.layers,
      containsAll(
        ['event', 'disruption'].map(
          (name) =>
              FeedTopic.values.firstWhere((t) => t.layer?.name == name).layer,
        ),
      ),
    );
    expect(feedQuery.layers.length, 2);
  });

  testWidgets('community events show before the map layers answer', (
    tester,
  ) async {
    final repository = T017Repository();
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container, settle: false);

    final feedQuery = repository.queries.firstWhere(
      (pending) => pending.query.requestId.startsWith('feed-'),
    );
    expect(feedQuery.result.isCompleted, isFalse);
    expect(find.text('Laneway acoustic night'), findsOneWidget);
    expect(key('feed-source-loading'), findsOneWidget);

    feedQuery.result.complete(t017Response(feedQuery.query));
    await tester.pumpAndSettle();
    expect(key('feed-source-loading'), findsNothing);
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('a failing map service is reported without hiding other topics', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true)
      ..nextViewportError = const MapNetworkException();
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(key('feed-source-failed'), findsOneWidget);
    expect(find.textContaining('Events, Disruptions'), findsOneWidget);
    // The community events still show.
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('a failing events service is reported by topic', (tester) async {
    final events = FakeUserEventsClient(harnessEvents())
      ..failure = StateError('down')
      ..failOn = 'discover';
    final container = appContainer(events: events);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(key('feed-source-failed'), findsOneWidget);
    expect(find.textContaining('Community events'), findsWidgets);
    expect(find.text('Laneway acoustic night'), findsNothing);
  });

  testWidgets('pulling to refresh retries a failed events service', (
    tester,
  ) async {
    final events = FakeUserEventsClient(harnessEvents())
      ..failure = StateError('down')
      ..failOn = 'discover';
    final container = appContainer(events: events);
    addTearDown(container.dispose);
    await pumpApp(tester, container);
    expect(key('feed-source-failed'), findsOneWidget);

    events.failure = null;
    await tester.fling(key('feed-scroll'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();

    expect(key('feed-source-failed'), findsNothing);
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('community events are searched around the city centre', (
    tester,
  ) async {
    final events = FakeUserEventsClient(harnessEvents());
    final container = appContainer(events: events);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    final bounds = events.lastBounds!;
    expect(bounds.contains(144.9631, -37.8136), isTrue);
    // The discover route's 10 km limit.
    expect((bounds.north - bounds.south) * 111.32, lessThan(10));
    expect(
      events.lastTo!.difference(events.lastFrom!),
      const Duration(days: 14),
    );
  });

  testWidgets('tapping a community event opens its details on the map tab', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    await tester.tap(find.text('Laneway acoustic night'));
    await tester.pumpAndSettle();
    expect(key('map-layer-chips'), findsOneWidget);
    expect(key('event-details-when'), findsOneWidget);
    expect(find.text('Federation Square'), findsOneWidget);
    expect(container.read(selectionControllerProvider).hasSelection, isFalse);
    expect(container.read(mapRepositoryProvider), isNotNull);
  });

  testWidgets('the add button opens the new-event form on the map tab', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    await tester.tap(key('feed-host-event'));
    await tester.pumpAndSettle();
    expect(key('map-layer-chips'), findsOneWidget);
    expect(key('event-form-new'), findsOneWidget);
  });
}
