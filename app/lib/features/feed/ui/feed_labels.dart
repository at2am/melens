import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
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
