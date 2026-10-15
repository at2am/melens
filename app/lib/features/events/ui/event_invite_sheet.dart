import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/event_invite.dart';
import '../data/user_event_models.dart';
import '../state/event_view_providers.dart';

/// How a host brings people: a link that opens the event, and a ready
/// message to paste into any chat. The app does not message people itself.
class EventInviteSheet extends ConsumerWidget {
  const EventInviteSheet({required this.event, super.key});

  final UserEvent event;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final link = eventInviteLink(ref.watch(inviteOriginProvider), event);
    final message = eventInviteMessage(event: event, clock: clock, link: link);

    Future<void> copy(String text) async {
      await Clipboard.setData(ClipboardData(text: text));
      if (!context.mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(strings.eventInviteCopied)));
    }

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              strings.eventInvite,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              link == null
                  ? strings.eventInviteNoLink
                  : strings.eventInviteHint,
            ),
            const SizedBox(height: 16),
            DecoratedBox(
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(message, key: const ValueKey('invite-message')),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              key: const ValueKey('invite-copy-message'),
              onPressed: () => copy(message),
              icon: const Icon(Icons.copy),
              label: Text(strings.eventInviteCopyMessage),
            ),
            if (link != null) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: const ValueKey('invite-copy-link'),
                onPressed: () => copy(link.toString()),
                icon: const Icon(Icons.link),
                label: Text(strings.eventInviteCopyLink),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
