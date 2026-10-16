import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/data/melbourne_areas.dart';
import 'package:melens/features/feed/state/feed_providers.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';

import '../../support/app_harness.dart';
import '../map/t017_test_support.dart';
import 'fake_feeds_client.dart';

FeedSubscription _feed({
  Set<FeedTopic> topics = const {FeedTopic.events, FeedTopic.community},
  FeedScope scope = const AreaFeedScope(cbdAreaId),
}) => FeedSubscription(
  id: 'test-feed',
  name: 'Test feed',
  topics: topics,
  scope: scope,
);

void main() {
  testWidgets('rapid feed scope changes issue only the final query', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_feed()]),
    );
    container.listen(feedProvider, (previous, next) {});
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 100));
    await container
        .read(feedSubscriptionsProvider.notifier)
        .replace(_feed(scope: const AreaFeedScope('carlton')));
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 100));
    await container
        .read(feedSubscriptionsProvider.notifier)
        .replace(_feed(scope: const AreaFeedScope('docklands')));
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 249));
    expect(repository.queries, isEmpty);
    await tester.pump(const Duration(milliseconds: 1));
    expect(repository.queries, hasLength(1));
    final query = repository.queries.single.query;
    expect(query.layers, [MapLayerId.event]);
    expect(
      query.bbox.toJson(),
      melbourneAreaById('docklands')!.bounds.toJson(),
    );
    expect(query.window.to, harnessNow);
    expect(query.mode, MapQueryMode.current);
  });

  testWidgets('a superseded in-flight area query is cancelled', (tester) async {
    final repository = T017Repository();
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_feed()]),
    );
    container.listen(feedProvider, (previous, next) {});
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    final old = repository.queries.single;
    expect(old.cancellation!.isCancelled, isFalse);
    await container
        .read(feedSubscriptionsProvider.notifier)
        .replace(_feed(scope: const AreaFeedScope('carlton')));
    await _flush(tester);
    expect(old.cancellation!.isCancelled, isTrue);
    await tester.pump(const Duration(milliseconds: 250));
    final current = repository.queries.last;
    expect(repository.queries, hasLength(2));
    expect(current.cancellation!.isCancelled, isFalse);
    current.result.complete(_eventResponse(current.query, MapDataMode.sample));
    await _flush(tester);
    old.result.completeError(const MapNetworkException());
    await _flush(tester);
    final feed = container.read(feedProvider).requireValue;
    expect(feed.failedSources, isEmpty);
    expect(feed.loadingSources, isEmpty);
    expect(feed.items.map((item) => item.id), contains('sample.event'));
  });

  testWidgets('disposing the feed cancels its active map request', (
    tester,
  ) async {
    final repository = T017Repository();
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_feed()]),
    );
    final subscription = container.listen(feedProvider, (previous, next) {});
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    final cancellation = repository.queries.single.cancellation!;
    subscription.close();
    await _flush(tester);
    expect(cancellation.isCancelled, isTrue);
  });

  testWidgets('community-only and no saved feeds issue no map query', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([
        _feed(topics: {FeedTopic.community}),
      ]),
    );
    container.listen(feedProvider, (previous, next) {});
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    expect(repository.queries, isEmpty);
    expect(container.read(feedProvider).requireValue.items, isNotEmpty);
    await container
        .read(feedSubscriptionsProvider.notifier)
        .remove('test-feed');
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    expect(repository.queries, isEmpty);
    expect(container.read(feedProvider).requireValue.items, isEmpty);
    expect(
      await container.read(
        mapFeedItemsProvider(
          const FeedLayerQuery(
            layer: MapLayerId.boundary,
            scope: CityFeedScope(),
          ),
        ).future,
      ),
      isEmpty,
    );
    expect(repository.queries, isEmpty);
    await _flush(tester);
  });

  testWidgets('community changes do not repeat an unchanged layer and area', (
    tester,
  ) async {
    final repository = T017Repository(autoComplete: true);
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_feed()]),
    );
    container.listen(feedProvider, (previous, next) {});
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    expect(repository.queries, hasLength(1));
    await container
        .read(feedSubscriptionsProvider.notifier)
        .replace(_feed(topics: {FeedTopic.events}));
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    expect(repository.queries, hasLength(1));
    expect(container.read(feedProvider).requireValue.items, isEmpty);
  });

  testWidgets('refresh cancels the pending query and can recover an error', (
    tester,
  ) async {
    final repository = T017Repository();
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_feed()]),
    );
    container.listen(feedProvider, (previous, next) {});
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    final old = repository.queries.single;
    container.invalidate(mapFeedItemsProvider);
    await _flush(tester);
    expect(old.cancellation!.isCancelled, isTrue);
    await tester.pump(const Duration(milliseconds: 250));
    final failed = repository.queries.last;
    failed.result.completeError(const MapNetworkException());
    await _flush(tester);
    final result = container.read(feedProvider).requireValue;
    expect(result.failedSources, {
      (feedId: 'test-feed', topic: FeedTopic.events),
    });
    expect(result.loadingSources, isEmpty);
    expect(result.items.map((item) => item.id), contains('ue_laneway'));
    container.invalidate(mapFeedItemsProvider);
    await _flush(tester);
    expect(container.read(feedProvider).requireValue.failedSources, isEmpty);
    expect(container.read(feedProvider).requireValue.loadingSources, {
      (feedId: 'test-feed', topic: FeedTopic.events),
    });
    await tester.pump(const Duration(milliseconds: 250));
    final retry = repository.queries.last;
    retry.result.complete(t017Response(retry.query));
    await _flush(tester);
    expect(container.read(feedProvider).requireValue.failedSources, isEmpty);
    expect(container.read(feedProvider).requireValue.loadingSources, isEmpty);
  });

  for (final mode in MapDataMode.values) {
    testWidgets(
      'map items retain the ${mode.name} source mode and snapshot after feed attribution',
      (tester) async {
        final repository = T017Repository();
        final container = appContainer(
          mapRepository: repository,
          feeds: FakeFeedsClient([_feed()]),
        );
        container.listen(feedProvider, (previous, next) {});
        await _flush(tester);
        await tester.pump(const Duration(milliseconds: 250));
        final pending = repository.queries.single;
        final response = _eventResponse(pending.query, mode);
        pending.result.complete(response);
        await _flush(tester);
        final item = container
            .read(feedProvider)
            .requireValue
            .items
            .singleWhere((item) => item.mapFeatureId == 'sample.event');
        expect(item.isSample, mode == MapDataMode.sample);
        expect(item.title, 'Sample event');
        expect(item.topic, FeedTopic.events);
        expect(item.summary, 'Illustrative event');
        expect(item.feedIds, {'test-feed'});
        expect(item.mapRecord!.snapshotId, response.snapshotId);
        expect(item.mapRecord!.item.versionId, 'sample-v1');
      },
    );
  }
}

ViewportResponse _eventResponse(ViewportQuery query, MapDataMode mode) {
  final variants = jsonDecode(
    File(
      '../specs/002-map-data-presentation/contracts/examples/item-variants.sample.json',
    ).readAsStringSync(),
  ) as List<dynamic>;
  final event = variants.cast<Map<String, dynamic>>().singleWhere(
    (item) => item['id'] == 'sample.event',
  );
  final json = t017Response(query, dataMode: mode).toJson();
  final layer = (json['layers'] as List<dynamic>)
      .cast<Map<String, dynamic>>()
      .singleWhere((layer) => layer['layerId'] == 'event');
  layer['state'] = 'available';
  layer['items'] = [event];
  return ViewportResponse.fromJson(json);
}

Future<void> _flush(WidgetTester tester) async {
  await tester.pump(Duration.zero);
  await tester.pump(Duration.zero);
}
