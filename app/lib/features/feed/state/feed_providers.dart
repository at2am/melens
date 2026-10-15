import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/time/melbourne_time.dart';
import '../../events/state/event_view_providers.dart';
import '../../map/data/map_models.dart';
import '../../map/data/map_repository.dart';
import '../../map/state/map_providers.dart';
import '../../map/state/viewport_controller.dart';
import '../data/feed_models.dart';

part 'feed_providers.g.dart';

final _log = Logger('feed');

/// The topics the user follows. Kept for the app run; persisting them needs
/// the account work in UC-09.
@Riverpod(keepAlive: true)
class FeedSubscriptions extends _$FeedSubscriptions {
  @override
  Set<FeedTopic> build() => defaultFeedTopics;

  void setSubscribed(FeedTopic topic, bool subscribed) {
    state = subscribed ? {...state, topic} : ({...state}..remove(topic));
  }

  void toggle(FeedTopic topic) => setSubscribed(topic, !state.contains(topic));
}

// A pull to refresh reissues the request; failures never loop.
Duration? _manualRetry(int retryCount, Object error) => null;

/// Zoom at which the service returns single items for a city-wide box.
const _feedZoom = 12.0;

/// The subscribed map layers as one sorted, comma-separated key. A string
/// compares by value, so the feed's map request is not repeated when the
/// subscriptions change in a way that leaves the layers alone.
@riverpod
String subscribedLayerKey(Ref ref) {
  final topics = ref.watch(feedSubscriptionsProvider);
  return ([for (final topic in topics) ?topic.layer?.name]..sort()).join(',');
}

/// What is on now in the given map layers, as one comma-separated key of
/// layer names so that the request is made once per set of layers and not
/// again when community events change. Failures surface as the exception, for
/// [feed] to report per topic.
@Riverpod(retry: _manualRetry)
Future<List<FeedItem>> mapFeedItems(Ref ref, String layerKey) async {
  final layers = [
    for (final name in layerKey.split(','))
      MapLayerId.values.firstWhere((layer) => layer.name == name),
  ];
  final clock = ref.watch(melbourneClockProvider);
  final repository = ref.watch(mapRepositoryProvider);
  final catalog = await ref.watch(mapLayerCatalogProvider.future);
  final bbox = boundedViewportRegion(catalog.serviceBounds);
  if (bbox == null) throw const MapRequestException();
  final response = await repository.queryViewport(
    ViewportQuery(
      requestId: 'feed-${clock.now().millisecondsSinceEpoch}',
      bbox: bbox,
      zoom: _feedZoom,
      layers: layers,
      mode: MapQueryMode.current,
      window: currentViewportWindow(clock),
      pageSize: 200,
    ),
  );
  final sample = response.dataMode == MapDataMode.sample;
  return [
    for (final layer in response.layers)
      if (FeedTopic.forLayer(layer.layerId) case final topic?)
        for (final item in layer.items)
          if (item is! AggregateMapItem) _fromMapItem(item, topic, sample),
  ];
}

/// The feed: the community events and what is on now in each subscribed map
/// layer, upcoming first. A source that fails is reported in
/// [FeedResult.failedTopics] instead of failing the feed. The map layers are
/// slower than the events, so the feed does not wait for them: it lists them
/// in [FeedResult.loadingTopics] and is rebuilt when they arrive.
@Riverpod(retry: _manualRetry)
Future<FeedResult> feed(Ref ref) async {
  final topics = ref.watch(feedSubscriptionsProvider);
  final items = <FeedItem>[];
  final failed = <FeedTopic>{};
  final loading = <FeedTopic>{};

  // Watched before the events are awaited, so both requests start together.
  final layerNames = ref.watch(subscribedLayerKeyProvider);
  final mapItems = layerNames.isEmpty
      ? null
      : ref.watch(mapFeedItemsProvider(layerNames));

  if (topics.contains(FeedTopic.community)) {
    try {
      for (final event in await ref.watch(communityEventsProvider.future)) {
        items.add(
          FeedItem(
            id: event.id,
            topic: FeedTopic.community,
            title: event.title,
            summary: event.description.isEmpty ? null : event.description,
            when: event.startAt,
            place: event.placeName,
            userEventId: event.id,
          ),
        );
      }
    } on Object catch (error, stack) {
      _log.warning('Community events failed', error, stack);
      failed.add(FeedTopic.community);
    }
  }

  if (mapItems != null) {
    final layerTopics = topics.where((topic) => topic.layer != null);
    if (mapItems.hasError && !mapItems.isLoading) {
      _log.warning('Map feed failed', mapItems.error, mapItems.stackTrace);
      failed.addAll(layerTopics);
    } else if (mapItems.hasValue) {
      items.addAll(mapItems.requireValue);
    } else {
      loading.addAll(layerTopics);
    }
  }

  // What is coming up first, soonest first; then what has happened, latest
  // first; items with no time last.
  final now = ref.watch(melbourneClockProvider).now().toUtc();
  int rank(FeedItem item) {
    final when = item.when;
    if (when == null) return 2;
    return when.isAfter(now) ? 0 : 1;
  }

  items.sort((a, b) {
    final byRank = rank(a).compareTo(rank(b));
    if (byRank != 0) return byRank;
    final left = a.when;
    final right = b.when;
    if (left == null || right == null) return 0;
    return rank(a) == 0 ? left.compareTo(right) : right.compareTo(left);
  });
  return FeedResult(items: items, failedTopics: failed, loadingTopics: loading);
}

FeedItem _fromMapItem(MapItem item, FeedTopic topic, bool sample) {
  final time = item.time;
  return FeedItem(
    id: item.id,
    topic: topic,
    title: item.title,
    summary: switch (item.details) {
      EventDetails(:final summary) => summary,
      DisruptionDetails(:final summary) => summary,
      NewsDetails(:final summary) => summary,
      PlanningDetails(:final summary) => summary,
      _ => null,
    },
    when: switch (item.details) {
      EventDetails(:final startAt) when startAt != null => startAt,
      _ => time.reportedAt ?? time.validFrom ?? time.observedAt,
    },
    place: switch (item.details) {
      EventDetails(:final venueName) => venueName,
      _ => null,
    },
    sourceLabel: item.sources.isEmpty ? null : item.sources.first.attribution,
    mapFeatureId: item.id,
    isSample: sample,
  );
}
