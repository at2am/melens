import '../../map/data/map_models.dart';

/// What a user can subscribe to. Each topic is one source of feed items:
/// a map layer, or the community events users publish themselves (UC-09).
enum FeedTopic {
  community(null),
  events(MapLayerId.event),
  disruptions(MapLayerId.disruption),
  news(MapLayerId.news),
  anomalies(MapLayerId.anomaly),
  planning(MapLayerId.planning);

  const FeedTopic(this.layer);

  /// The map layer behind the topic; null for community events, which the
  /// app holds itself.
  final MapLayerId? layer;

  static FeedTopic? forLayer(MapLayerId id) {
    for (final topic in values) {
      if (topic.layer == id) return topic;
    }
    return null;
  }
}

/// A topic that new users follow before they choose.
const defaultFeedTopics = {
  FeedTopic.community,
  FeedTopic.events,
  FeedTopic.disruptions,
};

/// One card in the feed.
final class FeedItem {
  const FeedItem({
    required this.id,
    required this.topic,
    required this.title,
    this.summary,
    this.when,
    this.place,
    this.sourceLabel,
    this.userEventId,
    this.mapFeatureId,
    this.isSample = false,
  });

  final String id;
  final FeedTopic topic;
  final String title;
  final String? summary;

  /// The start of an event or the time of a report, in UTC.
  final DateTime? when;
  final String? place;
  final String? sourceLabel;

  /// Set for community events: tapping opens the event page.
  final String? userEventId;

  /// Set for map items: tapping selects the item on the map.
  final String? mapFeatureId;
  final bool isSample;
}

/// The feed's items, with the topics whose source failed, so one failing
/// source never hides the others.
final class FeedResult {
  const FeedResult({
    required this.items,
    this.failedTopics = const {},
    this.loadingTopics = const {},
  });

  final List<FeedItem> items;
  final Set<FeedTopic> failedTopics;

  /// Topics whose source has not answered yet; the feed shows the others
  /// meanwhile and fills these in when they arrive.
  final Set<FeedTopic> loadingTopics;
}
