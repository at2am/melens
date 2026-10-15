import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../data/feed_models.dart';
import 'feed_labels.dart';

/// One chip per topic: filled means the feed follows it.
class FeedTopicChips extends StatelessWidget {
  const FeedTopicChips({
    required this.selected,
    required this.onChanged,
    super.key,
  });

  final Set<FeedTopic> selected;
  final ValueChanged<Set<FeedTopic>> onChanged;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final topic in FeedTopic.values)
          Tooltip(
            message: feedTopicDescription(strings, topic),
            child: FilterChip(
              key: ValueKey('feed-topic-${topic.name}'),
              avatar: Icon(feedTopicIcon(topic), size: 18),
              label: Text(feedTopicTitle(strings, topic)),
              selected: selected.contains(topic),
              onSelected: (on) => onChanged(
                on ? {...selected, topic} : ({...selected}..remove(topic)),
              ),
            ),
          ),
      ],
    );
  }
}
