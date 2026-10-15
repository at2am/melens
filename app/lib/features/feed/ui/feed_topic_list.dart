import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../data/feed_models.dart';
import '../state/feed_providers.dart';
import 'feed_labels.dart';

/// One chip per topic: filled means the topic's items appear in the feed.
/// The same chips sit under the feed's title; this list is for the empty
/// feed's topic sheet.
class FeedTopicList extends ConsumerWidget {
  const FeedTopicList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final subscribed = ref.watch(feedSubscriptionsProvider);
    final controller = ref.read(feedSubscriptionsProvider.notifier);
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final topic in FeedTopic.values)
          FilterChip(
            key: ValueKey('feed-topic-${topic.name}'),
            avatar: Icon(feedTopicIcon(topic), size: 18),
            label: Text(feedTopicTitle(strings, topic)),
            selected: subscribed.contains(topic),
            onSelected: (on) => controller.setSubscribed(topic, on),
          ),
      ],
    );
  }
}
