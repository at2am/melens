import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/user_event.dart';
import 'event_labels.dart';

/// A community event previewed beside the map, with the way into its page.
class EventPreviewCard extends ConsumerWidget {
  const EventPreviewCard({
    required this.event,
    required this.onOpen,
    required this.onClose,
    super.key,
  });

  final UserEvent event;
  final VoidCallback onOpen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final clock = ref.watch(melbourneClockProvider);
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Card(
        key: const ValueKey('event-preview'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    eventCategoryIcon(event.category),
                    size: 18,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      strings.feedTopicCommunity,
                      style: theme.textTheme.labelLarge?.copyWith(
                        color: theme.colorScheme.primary,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const ValueKey('event-preview-close'),
                    tooltip: strings.chatClose,
                    onPressed: onClose,
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              Text(event.title, style: theme.textTheme.titleLarge),
              const SizedBox(height: 4),
              Text('${eventWhen(clock, event)} · ${event.place.name}'),
              const SizedBox(height: 12),
              FilledButton(
                key: const ValueKey('event-preview-open'),
                onPressed: onOpen,
                child: Text(strings.eventOpen),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
