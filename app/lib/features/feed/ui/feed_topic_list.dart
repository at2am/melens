import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../data/feed_models.dart';
import '../state/feed_providers.dart';
import 'feed_labels.dart';

/// One switch per topic: on means the topic's items appear in the feed.
/// Shared by the feed's topic sheet and Settings.
class FeedTopicList extends ConsumerWidget {
  const FeedTopicList({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final subscribed = ref.watch(feedSubscriptionsProvider);
    final controller = ref.read(feedSubscriptionsProvider.notifier);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final topic in FeedTopic.values)
          SwitchListTile(
            key: ValueKey('feed-topic-${topic.name}'),
            secondary: Icon(feedTopicIcon(topic)),
            title: Text(feedTopicTitle(strings, topic)),
            subtitle: Text(feedTopicDescription(strings, topic)),
            value: subscribed.contains(topic),
            onChanged: (on) => controller.setSubscribed(topic, on),
          ),
      ],
    );
  }
}
