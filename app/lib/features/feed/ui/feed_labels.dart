import 'dart:math' as math;

import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../map/data/map_models.dart';
import '../data/feed_models.dart';

String feedTopicTitle(AppLocalizations strings, FeedTopic topic) =>
    switch (topic) {
      FeedTopic.community => strings.feedTopicCommunity,
      FeedTopic.events => strings.feedTopicEvents,
      FeedTopic.disruptions => strings.feedTopicDisruptions,
      FeedTopic.news => strings.feedTopicNews,
      FeedTopic.anomalies => strings.feedTopicAnomalies,
      FeedTopic.planning => strings.feedTopicPlanning,
    };

String feedTopicDescription(AppLocalizations strings, FeedTopic topic) =>
    switch (topic) {
      FeedTopic.community => strings.feedTopicCommunityHint,
      FeedTopic.events => strings.feedTopicEventsHint,
      FeedTopic.disruptions => strings.feedTopicDisruptionsHint,
      FeedTopic.news => strings.feedTopicNewsHint,
      FeedTopic.anomalies => strings.feedTopicAnomaliesHint,
      FeedTopic.planning => strings.feedTopicPlanningHint,
    };

IconData feedTopicIcon(FeedTopic topic) => switch (topic) {
  FeedTopic.community => Icons.groups_outlined,
  FeedTopic.events => Icons.theater_comedy_outlined,
  FeedTopic.disruptions => Icons.alt_route,
  FeedTopic.news => Icons.newspaper,
  FeedTopic.anomalies => Icons.query_stats,
  FeedTopic.planning => Icons.apartment,
};

IconData feedScopeIcon(FeedScope scope) => switch (scope) {
  CityFeedScope() => Icons.location_city,
  AreaFeedScope() => Icons.place_outlined,
  BoxFeedScope() => Icons.crop_free,
};

/// Where a feed reads, in a few words: the area's name, the framed box's
/// size, or the whole city.
String feedScopeSummary(AppLocalizations strings, FeedScope scope) =>
    switch (scope) {
      CityFeedScope() => strings.feedScopeCity,
      AreaFeedScope(:final area) => area?.name ?? strings.feedScopeAreaUnknown,
      BoxFeedScope(:final bounds) => strings.feedScopeMapSummary(
        boundsSizeLabel(bounds),
      ),
    };

/// A feed's topics and scope, for its row in Settings.
String feedSubtitle(AppLocalizations strings, FeedSubscription feed) {
  final topics = [
    for (final topic in FeedTopic.values)
      if (feed.topics.contains(topic)) feedTopicTitle(strings, topic),
  ];
  return '${topics.join(', ')} · ${feedScopeSummary(strings, feed.scope)}';
}

/// "1.2 × 0.9 km": the box's width and height near its centre.
String boundsSizeLabel(MapBounds bounds) {
  const kmPerDegreeLat = 111.32;
  final centreLat = (bounds.north + bounds.south) / 2;
  final width =
      (bounds.east - bounds.west) *
      kmPerDegreeLat *
      math.cos(centreLat * math.pi / 180);
  final height = (bounds.north - bounds.south) * kmPerDegreeLat;
  final format = NumberFormat('0.0', 'en_AU');
  return '${format.format(width)} × ${format.format(height)} km';
}
