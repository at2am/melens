import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/data/melbourne_areas.dart';
import 'package:melens/features/feed/state/feed_providers.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/state/viewport_controller.dart';

import '../../support/app_harness.dart';
import '../events/fake_user_events_client.dart';
import '../map/t017_test_support.dart';
import 'fake_feeds_client.dart';

Finder key(String name) => find.byKey(ValueKey(name));

final _cbd = melbourneAreaById(cbdAreaId)!.bounds;

FeedSubscription feedOf(
  String id, {
  String? name,
  Set<FeedTopic> topics = const {FeedTopic.community},
  FeedScope scope = const AreaFeedScope(cbdAreaId),
  bool includeUnlocated = false,
  CommunityHorizon horizon = CommunityHorizon.fortnight,
  bool enabled = true,
}) => FeedSubscription(
  id: id,
  name: name ?? id,
  topics: topics,
  scope: scope,
  includeUnlocated: includeUnlocated,
  communityHorizon: horizon,
  enabled: enabled,
);

List<ViewportQuery> feedQueries(T017Repository repository) => [
  for (final pending in repository.queries)
    if (pending.query.requestId.startsWith('feed-')) pending.query,
];

/// The sample catalog, with the event layer's sources covering an area, so
/// that its records without a location can be listed.
final class _UnlocatedEventsRepository implements MapRepository {
  final _inner = T017Repository(autoComplete: true);

  List<UnlocatedQuery> get unlocatedQueries => _inner.unlocatedQueries;

  @override
  Future<MapLayerCatalog> getLayers({
    MapRequestCancellation? cancellation,
  }) async {
    final json = jsonDecode(
      jsonEncode((await const SampleMapRepository().getLayers()).toJson()),
    ) as Map<String, dynamic>;
    for (final layer in json['layers'] as List<dynamic>) {
      final descriptor = layer as Map<String, dynamic>;
      if (descriptor['id'] != 'event') continue;
      final coverage = descriptor['coverage'] as Map<String, dynamic>;
      coverage['state'] = 'verified';
      coverage['areaRefs'] = ['sample.melbourne'];
      coverage['evidenceSourceIds'] = descriptor['sourceIds'];
    }
    return MapLayerCatalog.fromJson(json);
  }

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) => _inner.queryViewport(query, cancellation: cancellation);

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) => _inner.getItem(id, context, cancellation: cancellation);

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) => _inner.getUnlocated(query, cancellation: cancellation);

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) => _inner.getAggregateMembers(id, query, cancellation: cancellation);
}

void main() {
  test('feeds keep their shape through the wire format', () {
    final feed = feedOf(
      'f1',
      topics: {FeedTopic.planning, FeedTopic.events},
      scope: BoxFeedScope(_cbd),
      includeUnlocated: true,
      horizon: CommunityHorizon.week,
      enabled: false,
    );
    final json = feed.toJson();
    expect(json['topics'], ['events', 'planning']);
    expect(json['scope'], {'kind': 'bbox', 'bbox': _cbd.toJson()});
    expect(json['communityHorizonDays'], 7);
    final back = FeedSubscription.fromJson(
      jsonDecode(jsonEncode(json)) as Map<String, dynamic>,
    );
    expect(back.scope, BoxFeedScope(_cbd));
    expect(back.topics, feed.topics);
    expect(back.includeUnlocated, isTrue);
    expect(back.communityHorizon, CommunityHorizon.week);
    expect(back.enabled, isFalse);
  });

  test('topics map to the layers behind them', () {
    expect(FeedTopic.community.layer, isNull);
    expect(FeedTopic.forLayer(FeedTopic.news.layer!), FeedTopic.news);
  });

  test('every named area lies inside the service area', () {
    for (final area in melbourneAreas) {
      expect(
        mapRequestEnvelope.contains(area.bounds.west, area.bounds.south) &&
            mapRequestEnvelope.contains(area.bounds.east, area.bounds.north),
        isTrue,
        reason: area.id,
      );
      expect(area.bounds.west, lessThan(area.bounds.east));
      expect(area.bounds.south, lessThan(area.bounds.north));
    }
    expect(
      melbourneAreas.map((area) => area.id).toSet().length,
      melbourneAreas.length,
    );
  });

  testWidgets('a new user sees the city centre feed, not yet saved', (
    tester,
  ) async {
    final feeds = FakeFeedsClient();
    final container = appContainer(feeds: feeds);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(
      container.read(feedSubscriptionsProvider).value,
      defaultFeedSubscriptions,
    );
    expect(feeds.saves, isEmpty);
    // Community events, soonest first.
    final sketch = tester.getTopLeft(
      find.text('Sunset sketching on the river'),
    );
    final laneway = tester.getTopLeft(find.text('Laneway acoustic night'));
    expect(sketch.dy, lessThan(laneway.dy));
    expect(find.textContaining('Birrarung Marr'), findsOneWidget);
  });

  testWidgets('each layer of a feed is its own request inside its area', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
      feeds: FakeFeedsClient([
        feedOf(
          'carlton',
          topics: {FeedTopic.events, FeedTopic.disruptions},
          scope: const AreaFeedScope('carlton'),
        ),
      ]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    final queries = feedQueries(repository);
    expect(queries, hasLength(2));
    expect(
      queries.map((query) => query.layers.single),
      unorderedEquals([MapLayerId.event, MapLayerId.disruption]),
    );
    final carlton = melbourneAreaById('carlton')!.bounds;
    for (final query in queries) {
      expect(query.bbox.toJson(), carlton.toJson());
      // Close up: single items, never groups the feed would drop.
      expect(query.zoom, greaterThanOrEqualTo(17));
    }
  });

  testWidgets('feeds that ask for the same layer and area share a request', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
      feeds: FakeFeedsClient([
        feedOf('a', topics: {FeedTopic.events}),
        feedOf('b', topics: {FeedTopic.events, FeedTopic.planning}),
      ]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    final layers = feedQueries(repository).map((q) => q.layers.single);
    expect(layers.where((layer) => layer == MapLayerId.event), hasLength(1));
    expect(layers, hasLength(2));
  });

  testWidgets('a paused feed is not loaded', (tester) async {
    final repository = T017Repository(autoComplete: true);
    final events = FakeUserEventsClient(harnessEvents());
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
      events: events,
      feeds: FakeFeedsClient([
        feedOf(
          'paused',
          topics: {FeedTopic.community, FeedTopic.events},
          enabled: false,
        ),
      ]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(feedQueries(repository), isEmpty);
    expect(events.calls.where((call) => call == 'discover'), isEmpty);
    expect(find.text('All your feeds are paused'), findsOneWidget);
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

    final pending = repository.queries
        .where((p) => p.query.requestId.startsWith('feed-'))
        .toList();
    expect(pending, hasLength(2));
    expect(find.text('Laneway acoustic night'), findsOneWidget);
    expect(key('feed-source-loading'), findsOneWidget);

    for (final query in pending) {
      query.result.complete(t017Response(query.query));
    }
    await tester.pumpAndSettle();
    expect(key('feed-source-loading'), findsNothing);
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('a failing layer is reported by feed and topic', (tester) async {
    final repository = T017Repository(autoComplete: true)
      ..nextViewportError = const MapNetworkException();
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
      feeds: FakeFeedsClient([
        feedOf(
          'cbd',
          name: 'Work',
          topics: {FeedTopic.community, FeedTopic.events},
        ),
      ]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(key('feed-source-failed'), findsOneWidget);
    expect(find.textContaining('Work: Events'), findsOneWidget);
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

  testWidgets('community events are searched in the feed area and horizon', (
    tester,
  ) async {
    final events = FakeUserEventsClient(harnessEvents());
    final container = appContainer(
      events: events,
      feeds: FakeFeedsClient([feedOf('cbd', horizon: CommunityHorizon.week)]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    final searched = events.lastBounds!.toJson();
    for (final (index, value) in _cbd.toJson().indexed) {
      expect(searched[index], closeTo(value, 1e-9));
    }
    expect(
      events.lastTo!.difference(events.lastFrom!),
      const Duration(days: 7),
    );
  });

  testWidgets('the whole city reads community events around the centre', (
    tester,
  ) async {
    final events = FakeUserEventsClient(harnessEvents());
    final container = appContainer(
      events: events,
      feeds: FakeFeedsClient([feedOf('city', scope: const CityFeedScope())]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    final bounds = events.lastBounds!;
    expect(bounds.contains(144.9631, -37.8136), isTrue);
    // The discover route's 10 km limit.
    expect((bounds.north - bounds.south) * 111.32, lessThan(10));
  });

  testWidgets('records without a location are added when the feed asks', (
    tester,
  ) async {
    final repository = _UnlocatedEventsRepository();
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
      feeds: FakeFeedsClient([
        feedOf(
          'with',
          topics: {FeedTopic.events, FeedTopic.disruptions},
          includeUnlocated: true,
        ),
      ]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    // Only the event layer has the area evidence an unlocated read needs.
    expect(repository.unlocatedQueries, hasLength(1));
    final query = repository.unlocatedQueries.single;
    expect(query.layers, [MapLayerId.event]);
    expect(query.scope, isA<AreaRefsScope>());
    expect(key('feed-source-failed'), findsNothing);
  });

  testWidgets('records without a location stay out unless asked for', (
    tester,
  ) async {
    final repository = _UnlocatedEventsRepository();
    final container = appContainer(
      mapRepository: repository,
      sampleData: false,
      feeds: FakeFeedsClient([
        feedOf('without', topics: {FeedTopic.events}),
      ]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(repository.unlocatedQueries, isEmpty);
  });

  testWidgets('a feed chip narrows the list to that feed', (tester) async {
    final events = FakeUserEventsClient([
      ...harnessEvents(),
      fakeEvent(
        'ue_docklands',
        title: 'Harbour swim',
        point: const AgentLatLng(lat: -37.8180, lng: 144.9400),
        startAt: DateTime.utc(2026, 10, 19, 1),
      ),
    ]);
    final container = appContainer(
      events: events,
      feeds: FakeFeedsClient([
        feedOf('cbd', name: 'Centre'),
        feedOf('docks', name: 'Docks', scope: const AreaFeedScope('docklands')),
      ]),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);
    expect(find.text('Harbour swim'), findsOneWidget);
    expect(find.text('Laneway acoustic night'), findsOneWidget);

    // The chips scroll sideways; the last ones start past the edge.
    await tester.drag(key('feed-chips'), const Offset(-300, 0));
    await tester.pumpAndSettle();
    await tester.tap(key('feed-chip-docks'));
    await tester.pumpAndSettle();
    expect(find.text('Harbour swim'), findsOneWidget);
    expect(find.text('Laneway acoustic night'), findsNothing);

    await tester.drag(key('feed-chips'), const Offset(300, 0));
    await tester.pumpAndSettle();
    await tester.tap(key('feed-chip-all'));
    await tester.pumpAndSettle();
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('a user with no feeds is asked to create one', (tester) async {
    final container = appContainer(feeds: FakeFeedsClient([]));
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(find.text('You have no feeds yet'), findsOneWidget);
    await tester.tap(find.text('Create a feed'));
    await tester.pumpAndSettle();
    expect(key('feed-editor'), findsOneWidget);
  });

  testWidgets('feeds that cannot load offer a retry', (tester) async {
    final feeds = FakeFeedsClient()..failure = StateError('down');
    final container = appContainer(feeds: feeds);
    addTearDown(container.dispose);
    await pumpApp(tester, container);
    expect(find.text('The feed could not load'), findsOneWidget);

    feeds.failure = null;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Laneway acoustic night'), findsOneWidget);
  });

  testWidgets('creating a feed for a named area saves it for the account', (
    tester,
  ) async {
    final feeds = FakeFeedsClient();
    final container = appContainer(feeds: feeds);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    await tester.tap(key('feed-new'));
    await tester.pumpAndSettle();
    await tester.tap(key('feed-topic-disruptions')); // off
    await tester.pump();
    await tester.tap(key('feed-topic-planning'));
    await tester.ensureVisible(key('feed-area-carlton'));
    await tester.tap(key('feed-area-carlton'));
    await tester.pumpAndSettle();
    await tester.tap(key('feed-save'));
    await tester.pumpAndSettle();

    final saved = feeds.saves.single;
    expect(saved, hasLength(2)); // the default feed and the new one
    final created = saved.last;
    expect(created.name, 'Carlton');
    expect(created.topics, {FeedTopic.events, FeedTopic.planning});
    expect(created.scope, const AreaFeedScope('carlton'));
    await tester.dragUntilVisible(
      key('feed-chip-${created.id}'),
      key('feed-chips'),
      const Offset(-80, 0),
    );
    expect(key('feed-chip-${created.id}'), findsOneWidget);
  });

  testWidgets('a map area is framed on the map', (tester) async {
    final feeds = FakeFeedsClient([]);
    // What the platform map would report around Federation Square.
    const visible = MapBounds(
      west: 144.960,
      south: -37.822,
      east: 144.976,
      north: -37.810,
    );
    final container = appContainer(
      feeds: feeds,
      overrides: [
        areaPickerRegionReaderProvider.overrideWithValue(() async => visible),
      ],
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    await tester.tap(find.text('Create a feed'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Map area'));
    await tester.pumpAndSettle();
    expect(find.text('No area framed yet'), findsOneWidget);
    expect(key('feed-save'), findsOneWidget);
    await tester.tap(key('feed-scope-map-pick'));
    await tester.pumpAndSettle();
    expect(find.text('Frame the area'), findsOneWidget);
    expect(key('feed-area-frame'), findsOneWidget);
    await tester.tap(key('feed-area-use'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Map area, '), findsWidgets);
    await tester.tap(key('feed-save'));
    await tester.pumpAndSettle();
    final scope = feeds.saves.single.single.scope as BoxFeedScope;
    // The frame sits inside the visible region.
    expect(scope.bounds.west, greaterThan(visible.west));
    expect(scope.bounds.east, lessThan(visible.east));
    expect(scope.bounds.south, greaterThan(visible.south));
    expect(scope.bounds.north, lessThan(visible.north));
  });

  testWidgets('a framed area outside Melbourne is refused', (tester) async {
    final container = appContainer(
      feeds: FakeFeedsClient([]),
      overrides: [
        areaPickerRegionReaderProvider.overrideWithValue(
          () async => const MapBounds(
            west: 151.1,
            south: -33.9,
            east: 151.3,
            north: -33.8,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    await tester.tap(find.text('Create a feed'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Map area'));
    await tester.pumpAndSettle();
    await tester.tap(key('feed-scope-map-pick'));
    await tester.pumpAndSettle();
    await tester.tap(key('feed-area-use'));
    await tester.pumpAndSettle();
    expect(
      find.text('That area is outside Melbourne. Move the map back.'),
      findsOneWidget,
    );
    expect(find.text('Frame the area'), findsOneWidget);
  });

  testWidgets('a save that fails puts the feeds back and says so', (
    tester,
  ) async {
    final feeds = FakeFeedsClient([feedOf('cbd', name: 'Centre')]);
    final container = appContainer(feeds: feeds);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    feeds.failure = StateError('down');
    await tester.tap(key('feed-new'));
    await tester.pumpAndSettle();
    await tester.tap(key('feed-save'));
    await tester.pumpAndSettle();

    expect(
      find.text('Your feeds could not be saved. Try again.'),
      findsOneWidget,
    );
    expect(container.read(feedSubscriptionsProvider).value, hasLength(1));
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

  testWidgets('the host button opens the new-event form on the map tab', (
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

  test('saves run in order and the last one wins', () async {
    final feeds = FakeFeedsClient([feedOf('a')]);
    final container = appContainer(feeds: feeds);
    addTearDown(container.dispose);
    await container.read(feedSubscriptionsProvider.future);
    final controller = container.read(feedSubscriptionsProvider.notifier);
    await Future.wait([
      controller.add(feedOf('b')),
      controller.setEnabled('a', enabled: false),
    ]);
    expect(feeds.saves, hasLength(2));
    expect(feeds.saves.last.map((feed) => feed.id), ['a', 'b']);
    expect(feeds.saves.last.first.enabled, isFalse);
    expect(
      container.read(feedSubscriptionsProvider).value!.first.enabled,
      isFalse,
    );
  });
}
