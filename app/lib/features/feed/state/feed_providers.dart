import 'dart:async';
import 'dart:convert';

import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/network/http_client.dart';
import '../../../core/time/melbourne_time.dart';
import '../../agent/state/agent_providers.dart';
import '../../events/data/user_event_models.dart';
import '../../events/state/event_view_providers.dart';
import '../../events/state/user_events_providers.dart';
import '../../map/data/map_models.dart';
import '../../map/data/map_repository.dart';
import '../../map/state/map_providers.dart';
import '../../map/state/viewport_controller.dart';
import '../data/feed_models.dart';
import '../data/feeds_cache.dart';
import '../data/feeds_client.dart';

part 'feed_providers.g.dart';

final _log = Logger('feed');

// A pull to refresh reissues the request; failures never loop.
Duration? _manualRetry(int retryCount, Object error) => null;

/// Tests override this with a scripted [FeedsClient].
@Riverpod(keepAlive: true)
FeedsClient feedsClient(Ref ref) => HttpFeedsClient(
  client: ref.watch(httpClientProvider),
  baseUrl: ref.watch(envProvider).agentBaseUrl,
  tokenSource: ref.watch(agentTokenSourceProvider),
);

/// Tests override this with an in-memory [FeedsCache].
@Riverpod(keepAlive: true)
FeedsCache feedsCache(Ref ref) => PreferencesFeedsCache();

/// The user's feeds, in their order, as the agent service stores them. A
/// user who never saved one sees [defaultFeedSubscriptions].
///
/// The feeds this device cached show at once, so their sources start loading
/// while the service is asked again; its answer then replaces them. With
/// nothing cached the feed waits for the service.
///
/// A change shows at once and then saves the whole list. Saves run one after
/// another, so an older list never lands after a newer one; a failed save
/// puts the list back and rethrows for the caller to report.
@Riverpod(keepAlive: true, retry: _manualRetry)
class FeedSubscriptions extends _$FeedSubscriptions {
  Future<void> _saving = Future.value();

  @override
  Future<List<FeedSubscription>> build() async {
    final client = ref.watch(feedsClientProvider);
    final cache = ref.watch(feedsCacheProvider);
    final cached = await cache.read();
    if (cached == null) {
      final feeds = await client.load() ?? defaultFeedSubscriptions;
      await cache.write(feeds);
      return feeds;
    }
    unawaited(_sync(client, cache, cached));
    return cached;
  }

  /// Replaces the [cached] feeds with what the service stores, unless the
  /// user changed them meanwhile: that change's save decides instead. A
  /// failure keeps the cached feeds; pulling to refresh does not retry it.
  Future<void> _sync(
    FeedsClient client,
    FeedsCache cache,
    List<FeedSubscription> cached,
  ) async {
    final List<FeedSubscription> feeds;
    try {
      feeds = await client.load() ?? defaultFeedSubscriptions;
    } on Object catch (error, stack) {
      _log.warning('Refreshing the cached feeds failed', error, stack);
      return;
    }
    if (!ref.mounted) return;
    // The cached list shows first, so the service's answer cannot be
    // overwritten by it.
    await future;
    if (!ref.mounted || !identical(state.value, cached)) return;
    if (!_sameFeeds(feeds, cached)) state = AsyncData(feeds);
    await cache.write(feeds);
  }

  Future<void> add(FeedSubscription feed) =>
      _change((feeds) => [...feeds, feed]);

  Future<void> replace(FeedSubscription feed) => _change(
    (feeds) => [for (final old in feeds) old.id == feed.id ? feed : old],
  );

  Future<void> remove(String id) => _change(
    (feeds) => [
      for (final feed in feeds)
        if (feed.id != id) feed,
    ],
  );

  Future<void> setEnabled(String id, {required bool enabled}) => _change(
    (feeds) => [
      for (final feed in feeds)
        feed.id == id ? feed.copyWith(enabled: enabled) : feed,
    ],
  );

  Future<void> _change(
    List<FeedSubscription> Function(List<FeedSubscription> feeds) edit,
  ) async {
    final previous = state.value;
    if (previous == null) throw StateError('The feeds have not loaded');
    final next = List<FeedSubscription>.unmodifiable(edit(previous));
    state = AsyncData(next);
    final client = ref.read(feedsClientProvider);
    final save = _saving.then((_) => client.save(next));
    _saving = save.then<void>((_) {}, onError: (Object _) {});
    try {
      final stored = await save;
      if (identical(state.value, next)) {
        state = AsyncData(stored);
        await ref.read(feedsCacheProvider).write(stored);
      }
    } on Object catch (error, stack) {
      _log.warning('Saving the feeds failed', error, stack);
      if (identical(state.value, next)) state = AsyncData(previous);
      rethrow;
    }
  }
}

bool _sameFeeds(List<FeedSubscription> a, List<FeedSubscription> b) =>
    jsonEncode([for (final feed in a) feed.toJson()]) ==
    jsonEncode([for (final feed in b) feed.toJson()]);

/// Reads the area picker's visible map region.
typedef VisibleRegionReader = Future<MapBounds> Function();

/// Null in the app, which asks the platform map; tests, which have none,
/// override it.
@Riverpod(keepAlive: true)
VisibleRegionReader? areaPickerRegionReader(Ref ref) => null;

/// The feed chip the user picked: one feed's id, or null for all of them.
@Riverpod(keepAlive: true)
class SelectedFeed extends _$SelectedFeed {
  @override
  String? build() => null;

  void select(String? feedId) => state = feedId;
}

/// Topics whose map layer has records without a location, which a feed can
/// add with [FeedSubscription.includeUnlocated].
const unlocatedFeedTopics = {
  FeedTopic.events,
  FeedTopic.disruptions,
  FeedTopic.planning,
};

/// One map layer read inside one scope: the unit the feed requests. Feeds
/// that ask the same share one request.
final class FeedLayerQuery {
  const FeedLayerQuery({
    required this.layer,
    required this.scope,
    this.includeUnlocated = false,
  });

  final MapLayerId layer;
  final FeedScope scope;
  final bool includeUnlocated;

  @override
  bool operator ==(Object other) =>
      other is FeedLayerQuery &&
      other.layer == layer &&
      other.scope == scope &&
      other.includeUnlocated == includeUnlocated;

  @override
  int get hashCode => Object.hash(layer, scope, includeUnlocated);
}

/// The community events of one scope and horizon.
final class FeedCommunityQuery {
  const FeedCommunityQuery({required this.scope, required this.horizon});

  final FeedScope scope;
  final CommunityHorizon horizon;

  @override
  bool operator ==(Object other) =>
      other is FeedCommunityQuery &&
      other.scope == scope &&
      other.horizon == horizon;

  @override
  int get hashCode => Object.hash(scope, horizon);
}

/// Close up, the service returns single items rather than groups, which a
/// feed cannot list.
const _feedZoom = 18.0;

/// What one layer holds now inside one scope. Each layer is its own request,
/// so the layers load in parallel and a slow one delays only its own items.
/// Failures surface as the exception, for [feed] to report per source.
@Riverpod(retry: _manualRetry)
Future<List<FeedItem>> mapFeedItems(Ref ref, FeedLayerQuery query) async {
  final topic = FeedTopic.forLayer(query.layer);
  if (topic == null) return const [];
  final cancellation = MapRequestCancellation();
  ref.onDispose(cancellation.cancel);
  final clock = ref.watch(melbourneClockProvider);
  final repository = ref.watch(mapRepositoryProvider);
  final catalog = query.scope is CityFeedScope || query.includeUnlocated
      ? await ref.watch(mapLayerCatalogProvider.future)
      : null;
  cancellation.throwIfCancelled();
  final bbox = switch (query.scope) {
    CityFeedScope() => boundedViewportRegion(catalog!.serviceBounds),
    AreaFeedScope(:final area) => area?.bounds,
    BoxFeedScope(:final bounds) => boundedViewportRegion(bounds),
  };
  // A named area this build no longer knows reads nothing.
  if (bbox == null) return const [];
  // A changed subscription disposes this instance before its queries start.
  await Future<void>.delayed(const Duration(milliseconds: 250));
  cancellation.throwIfCancelled();
  final window = currentViewportWindow(clock);
  final requestId =
      'feed-${query.layer.name}-${clock.now().millisecondsSinceEpoch}';
  Future<List<FeedItem>> locatedItems() async {
    final response = await repository.queryViewport(
      ViewportQuery(
        requestId: requestId,
        bbox: bbox,
        zoom: _feedZoom,
        layers: [query.layer],
        mode: MapQueryMode.current,
        window: window,
        pageSize: 200,
      ),
      cancellation: cancellation,
    );
    cancellation.throwIfCancelled();
    return [
      for (final layer in response.layers)
        if (layer.layerId == query.layer)
          for (final item in layer.items)
            if (item is! AggregateMapItem)
              _fromMapItem(
                MapItemResponse(
                  schemaVersion: response.schemaVersion,
                  requestId: response.requestId,
                  snapshotId: response.snapshotId,
                  generatedAt: response.generatedAt,
                  mode: response.mode,
                  dataMode: response.dataMode,
                  item: item,
                ),
                topic,
              ),
    ];
  }

  final results = await Future.wait([
    locatedItems(),
    if (query.includeUnlocated)
      _unlocatedItems(
        repository,
        query.layer,
        topic,
        window,
        requestId,
        catalog!,
        cancellation,
      ),
  ]);
  cancellation.throwIfCancelled();
  return [for (final items in results) ...items];
}

/// The layer's records with no location retain their own list snapshot.
Future<List<FeedItem>> _unlocatedItems(
  MapRepository repository,
  MapLayerId layer,
  FeedTopic topic,
  TimeWindow window,
  String requestId,
  MapLayerCatalog catalog,
  MapRequestCancellation cancellation,
) async {
  final coverage = [
    for (final descriptor in catalog.layers)
      if (descriptor.id == layer) descriptor.coverage,
  ].firstOrNull;
  if (coverage == null ||
      coverage.state != MapCoverageState.verified ||
      coverage.evidenceSourceIds.isEmpty ||
      coverage.areaRefs.isEmpty) {
    return const [];
  }
  try {
    cancellation.throwIfCancelled();
    final page = await repository.getUnlocated(
      UnlocatedQuery(
        requestId: '$requestId-unlocated',
        layers: [layer],
        mode: MapQueryMode.current,
        window: window,
        scope: UnlocatedScope.areaRefs([...coverage.areaRefs]..sort()),
        pageSize: 100,
      ),
      cancellation: cancellation,
    );
    cancellation.throwIfCancelled();
    return [
      for (final item in page.items)
        _fromMapItem(
          MapItemResponse(
            schemaVersion: page.schemaVersion,
            requestId: page.requestId,
            snapshotId: page.snapshotId,
            generatedAt: page.generatedAt,
            mode: page.mode,
            dataMode: page.dataMode,
            item: item,
          ),
          topic,
        ),
    ];
  } on MapHttpException catch (error) {
    if (error.code == MapServiceErrorCode.notAvailable) return const [];
    rethrow;
  }
}

/// The published, upcoming community events of one scope. The discover
/// route takes boxes up to 10 km a side, so a wider scope is cut down around
/// its centre; the whole city reads central Melbourne.
@Riverpod(retry: _manualRetry)
Future<List<FeedItem>> feedCommunityEvents(
  Ref ref,
  FeedCommunityQuery query,
) async {
  final bounds = switch (query.scope) {
    CityFeedScope() => centralMelbourneEventBounds,
    AreaFeedScope(:final area) =>
      area == null ? null : clampSearchBounds(area.bounds),
    BoxFeedScope(:final bounds) => clampSearchBounds(bounds),
  };
  if (bounds == null) return const [];
  final now = ref.watch(melbourneClockProvider).now().toUtc();
  final events = await ref
      .watch(userEventsClientProvider)
      .discover(
        bounds,
        from: now,
        to: now.add(Duration(days: query.horizon.days)),
      );
  return [
    for (final event in events)
      if (!event.isCancelled && !event.hasEndedAt(now)) _fromUserEvent(event),
  ];
}

/// The feed: the items of every enabled feed, an item two feeds share shown
/// once, upcoming first. Each source (one topic of one feed) loads on its
/// own: one that fails is reported in [FeedResult.failedSources], one that
/// has not answered yet in [FeedResult.loadingSources], and neither holds up
/// the others.
@Riverpod(retry: _manualRetry)
Future<FeedResult> feed(Ref ref) async {
  final feeds = await ref.watch(feedSubscriptionsProvider.future);
  final items = <String, FeedItem>{};
  final itemFeeds = <String, Set<String>>{};
  final failed = <FeedSource>{};
  final loading = <FeedSource>{};

  for (final feed in feeds) {
    if (!feed.enabled) continue;
    for (final topic in FeedTopic.values) {
      if (!feed.topics.contains(topic)) continue;
      final layer = topic.layer;
      final source = (feedId: feed.id, topic: topic);
      final result = layer == null
          ? ref.watch(
              feedCommunityEventsProvider(
                FeedCommunityQuery(
                  scope: feed.scope,
                  horizon: feed.communityHorizon,
                ),
              ),
            )
          : ref.watch(
              mapFeedItemsProvider(
                FeedLayerQuery(
                  layer: layer,
                  scope: feed.scope,
                  includeUnlocated:
                      feed.includeUnlocated &&
                      unlocatedFeedTopics.contains(topic),
                ),
              ),
            );
      if (result.hasError && !result.isLoading) {
        _log.warning(
          'Feed source ${feed.id}/${topic.name} failed',
          result.error,
          result.stackTrace,
        );
        failed.add(source);
      } else if (result.hasValue) {
        for (final item in result.requireValue) {
          final key = '${item.topic.name}:${item.id}';
          items.putIfAbsent(key, () => item);
          (itemFeeds[key] ??= {}).add(feed.id);
        }
      } else {
        loading.add(source);
      }
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

  final sorted = [
    for (final MapEntry(:key, :value) in items.entries)
      value.inFeeds(itemFeeds[key]!),
  ];
  sorted.sort((a, b) {
    final byRank = rank(a).compareTo(rank(b));
    if (byRank != 0) return byRank;
    final left = a.when;
    final right = b.when;
    if (left == null || right == null) return 0;
    return rank(a) == 0 ? left.compareTo(right) : right.compareTo(left);
  });
  return FeedResult(
    items: sorted,
    failedSources: failed,
    loadingSources: loading,
  );
}

FeedItem _fromUserEvent(UserEvent event) => FeedItem(
  id: event.id,
  topic: FeedTopic.community,
  title: event.title,
  summary: event.description.isEmpty ? null : event.description,
  when: event.startAt,
  place: event.placeName,
  userEventId: event.id,
);

FeedItem _fromMapItem(MapItemResponse record, FeedTopic topic) {
  final item = record.item;
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
    mapRecord: record,
    isSample: record.dataMode == MapDataMode.sample,
  );
}
