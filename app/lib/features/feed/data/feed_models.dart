import '../../map/data/map_models.dart';
import 'melbourne_areas.dart';

/// What a feed can follow. Each topic is one source of feed items: a map
/// layer, or the community events users publish themselves (UC-09). The
/// names are the wire values of `/v1/feeds` (agent-protocol.md).
enum FeedTopic {
  community(null),
  events(MapLayerId.event),
  disruptions(MapLayerId.disruption),
  news(MapLayerId.news),
  anomalies(MapLayerId.anomaly),
  planning(MapLayerId.planning);

  const FeedTopic(this.layer);

  /// The map layer behind the topic; null for community events, which the
  /// agent service holds.
  final MapLayerId? layer;

  static FeedTopic? forLayer(MapLayerId id) {
    for (final topic in values) {
      if (topic.layer == id) return topic;
    }
    return null;
  }
}

/// Where a feed reads its items. A feed never reads more of the city than
/// its scope, so a small area loads quickly.
sealed class FeedScope {
  const FeedScope();

  factory FeedScope.fromJson(Map<String, dynamic> json) =>
      switch (json['kind']) {
        'city' => const CityFeedScope(),
        'area' => AreaFeedScope(json['areaId'] as String),
        'bbox' => BoxFeedScope(
          const MapBoundsConverter().fromJson(json['bbox'] as List<dynamic>),
        ),
        _ => throw const FormatException('Unknown feed scope'),
      };

  Map<String, dynamic> toJson();
}

/// The whole service area: everything the map service holds. The slowest
/// scope; community events stay limited to central Melbourne, the widest box
/// their route accepts.
final class CityFeedScope extends FeedScope {
  const CityFeedScope();

  @override
  Map<String, dynamic> toJson() => {'kind': 'city'};

  @override
  bool operator ==(Object other) => other is CityFeedScope;

  @override
  int get hashCode => (CityFeedScope).hashCode;
}

/// A named City of Melbourne area from [melbourneAreas].
final class AreaFeedScope extends FeedScope {
  const AreaFeedScope(this.areaId);

  final String areaId;

  /// Null when the app no longer knows the id; the feed then reads nothing.
  MelbourneArea? get area => melbourneAreaById(areaId);

  @override
  Map<String, dynamic> toJson() => {'kind': 'area', 'areaId': areaId};

  @override
  bool operator ==(Object other) =>
      other is AreaFeedScope && other.areaId == areaId;

  @override
  int get hashCode => Object.hash(AreaFeedScope, areaId);
}

/// A box the user framed on the map.
final class BoxFeedScope extends FeedScope {
  const BoxFeedScope(this.bounds);

  final MapBounds bounds;

  @override
  Map<String, dynamic> toJson() => {'kind': 'bbox', 'bbox': bounds.toJson()};

  @override
  bool operator ==(Object other) =>
      other is BoxFeedScope &&
      other.bounds.west == bounds.west &&
      other.bounds.south == bounds.south &&
      other.bounds.east == bounds.east &&
      other.bounds.north == bounds.north;

  @override
  int get hashCode => Object.hash(
    BoxFeedScope,
    bounds.west,
    bounds.south,
    bounds.east,
    bounds.north,
  );
}

/// How far ahead a feed lists community events.
enum CommunityHorizon {
  today(1),
  week(7),
  fortnight(14);

  const CommunityHorizon(this.days);

  final int days;

  static CommunityHorizon fromDays(int days) =>
      values.firstWhere((horizon) => horizon.days == days);
}

/// One feed the user created: some topics, read inside one scope. Stored per
/// user by the agent service (`/v1/feeds`), so feeds follow the account.
final class FeedSubscription {
  const FeedSubscription({
    required this.id,
    required this.name,
    required this.topics,
    required this.scope,
    this.includeUnlocated = false,
    this.communityHorizon = CommunityHorizon.fortnight,
    this.enabled = true,
  });

  factory FeedSubscription.fromJson(Map<String, dynamic> json) =>
      FeedSubscription(
        id: json['id'] as String,
        name: json['name'] as String,
        topics: {
          for (final name in json['topics'] as List<dynamic>)
            FeedTopic.values.byName(name as String),
        },
        scope: FeedScope.fromJson(json['scope'] as Map<String, dynamic>),
        includeUnlocated: json['includeUnlocated'] as bool,
        communityHorizon: CommunityHorizon.fromDays(
          json['communityHorizonDays'] as int,
        ),
        enabled: json['enabled'] as bool,
      );

  /// `^[A-Za-z0-9_-]{1,64}$`, made by the app.
  final String id;
  final String name;
  final Set<FeedTopic> topics;
  final FeedScope scope;

  /// Also read the records of the scope's sources that have no location,
  /// such as a disruption to the whole tram network. Those are not limited
  /// to the scope's area.
  final bool includeUnlocated;
  final CommunityHorizon communityHorizon;

  /// A paused feed stays saved and is not loaded.
  final bool enabled;

  FeedSubscription copyWith({
    String? name,
    Set<FeedTopic>? topics,
    FeedScope? scope,
    bool? includeUnlocated,
    CommunityHorizon? communityHorizon,
    bool? enabled,
  }) => FeedSubscription(
    id: id,
    name: name ?? this.name,
    topics: topics ?? this.topics,
    scope: scope ?? this.scope,
    includeUnlocated: includeUnlocated ?? this.includeUnlocated,
    communityHorizon: communityHorizon ?? this.communityHorizon,
    enabled: enabled ?? this.enabled,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    // In the enum's order, so the stored list does not depend on taps.
    'topics': [
      for (final topic in FeedTopic.values)
        if (topics.contains(topic)) topic.name,
    ],
    'scope': scope.toJson(),
    'includeUnlocated': includeUnlocated,
    'communityHorizonDays': communityHorizon.days,
    'enabled': enabled,
  };
}

/// The most feeds one user keeps (agent-protocol.md, Feed subscriptions).
const maxFeedSubscriptions = 20;

/// The longest feed name the service accepts.
const maxFeedNameLength = 60;

/// What a user who never saved a feed sees: what is on in the city centre.
/// It is not stored until the user changes something.
final defaultFeedSubscriptions = [
  const FeedSubscription(
    id: 'default-cbd',
    name: 'Melbourne CBD',
    topics: {FeedTopic.community, FeedTopic.events, FeedTopic.disruptions},
    scope: AreaFeedScope(cbdAreaId),
  ),
];

/// One source of a feed: one topic of one feed. Failures and loading are
/// reported per source, so one slow or failing source never hides the rest.
typedef FeedSource = ({String feedId, FeedTopic topic});

/// One card in the feed.
final class FeedItem {
  const FeedItem({
    required this.id,
    required this.topic,
    required this.title,
    this.feedIds = const {},
    this.summary,
    this.when,
    this.place,
    this.sourceLabel,
    this.userEventId,
    this.mapRecord,
    this.isSample = false,
  });

  final String id;
  final FeedTopic topic;
  final String title;

  /// The feeds the item came from; an item two feeds share shows once.
  final Set<String> feedIds;
  final String? summary;

  /// The start of an event or the time of a report, in UTC.
  final DateTime? when;
  final String? place;
  final String? sourceLabel;

  /// Set for community events: tapping opens the event page.
  final String? userEventId;

  /// The original record and its read snapshot survive navigation to the map.
  final MapItemResponse? mapRecord;
  String? get mapFeatureId => mapRecord?.item.id;
  final bool isSample;

  FeedItem inFeeds(Set<String> feedIds) => FeedItem(
    id: id,
    topic: topic,
    title: title,
    feedIds: feedIds,
    summary: summary,
    when: when,
    place: place,
    sourceLabel: sourceLabel,
    userEventId: userEventId,
    mapRecord: mapRecord,
    isSample: isSample,
  );
}

/// The feed's items, with the sources that failed or have not answered yet.
final class FeedResult {
  const FeedResult({
    required this.items,
    this.failedSources = const {},
    this.loadingSources = const {},
  });

  final List<FeedItem> items;
  final Set<FeedSource> failedSources;

  /// The feed shows the other sources meanwhile and fills these in when they
  /// arrive.
  final Set<FeedSource> loadingSources;
}
