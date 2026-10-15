import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../map/state/map_actions.dart';
import '../data/event_invite.dart';
import '../data/user_event.dart';
import '../data/user_event_repository.dart';
import '../state/event_providers.dart';
import 'event_labels.dart';

/// An event's page: what, when, where, who is going, and the two things a
/// guest or host does next: join, and bring people along.
class EventDetailScreen extends ConsumerWidget {
  const EventDetailScreen({required this.eventId, super.key});

  final String eventId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final events = ref.watch(userEventsProvider);
    final event = ref.watch(userEventByIdProvider(eventId));
    final profile = ref.watch(currentProfileProvider);
    final clock = ref.watch(melbourneClockProvider);
    final theme = Theme.of(context);
    final messenger = ScaffoldMessenger.of(context);

    if (event == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: events.isLoading
              ? const CircularProgressIndicator()
              : Text(strings.eventNotFound),
        ),
      );
    }

    final ended = event.hasEnded(clock.now().toUtc());
    final going = event.isGoing(profile.id);
    final hosting = event.isHostedBy(profile.id);
    final open = !event.cancelled && !ended;

    Future<void> run(Future<void> Function() action) async {
      try {
        await action();
      } on EventFullException {
        _toast(messenger, strings.eventFullNotice);
      } on EventUnavailableException {
        _toast(messenger, strings.eventUnavailableNotice);
      } on Exception {
        _toast(messenger, strings.eventActionFailed);
      }
    }

    return Scaffold(
      appBar: AppBar(),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 112),
        children: [
          Row(
            children: [
              Icon(
                eventCategoryIcon(event.category),
                size: 18,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: 6),
              Text(
                eventCategoryTitle(strings, event.category),
                style: theme.textTheme.labelLarge?.copyWith(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (event.isSample) ...[
                const Spacer(),
                Text(strings.sampleBadge, style: theme.textTheme.labelSmall),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Text(
            event.title,
            style: theme.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            ),
          ),
          if (event.cancelled || ended) ...[
            const SizedBox(height: 8),
            Text(
              event.cancelled ? strings.eventCancelled : strings.eventEnded,
              key: const ValueKey('event-state'),
              style: theme.textTheme.titleSmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: 20),
          _Fact(icon: Icons.schedule, text: eventWhen(clock, event)),
          _Fact(icon: Icons.place_outlined, text: event.place.name),
          _Fact(
            icon: Icons.person_outline,
            text: hosting
                ? strings.eventYouHost
                : strings.eventHostedBy(event.hostName),
          ),
          _Fact(
            icon: Icons.groups_outlined,
            text: event.capacity == null
                ? strings.eventGoing(event.goingCount)
                : strings.eventGoingOf(event.goingCount, event.capacity!),
            key: const ValueKey('event-going'),
          ),
          if (event.visibility == EventVisibility.linkOnly)
            _Fact(icon: Icons.link, text: strings.eventLinkOnlyNote),
          if (event.description.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(event.description, style: theme.textTheme.bodyLarge),
          ],
          if (event.isSample) ...[
            const SizedBox(height: 16),
            Text(
              strings.eventSampleNote,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.outline,
              ),
            ),
          ],
          const SizedBox(height: 24),
          if (open && !hosting)
            FilledButton(
              key: const ValueKey('event-join'),
              onPressed: going || !event.isFull
                  ? () => run(
                      () => ref
                          .read(userEventsProvider.notifier)
                          .setGoing(event.id, !going),
                    )
                  : null,
              child: Text(
                going
                    ? strings.eventLeave
                    : (event.isFull ? strings.eventFull : strings.eventJoin),
              ),
            ),
          if (open) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              key: const ValueKey('event-invite'),
              onPressed: () => _showInvite(context, ref, event),
              icon: const Icon(Icons.person_add_alt),
              label: Text(strings.eventInvite),
            ),
          ],
          const SizedBox(height: 12),
          OutlinedButton.icon(
            key: const ValueKey('event-show-on-map'),
            onPressed: () {
              ref
                  .read(mapActionsControllerProvider.notifier)
                  .focusPoint(event.place.latitude, event.place.longitude);
              context.go(AppRoutes.discover);
            },
            icon: const Icon(Icons.map_outlined),
            label: Text(strings.eventShowOnMap),
          ),
          if (hosting && open) ...[
            const SizedBox(height: 12),
            TextButton(
              key: const ValueKey('event-cancel'),
              style: TextButton.styleFrom(
                foregroundColor: theme.colorScheme.error,
              ),
              onPressed: () async {
                final confirmed = await _confirmCancel(context);
                if (confirmed && context.mounted) {
                  await run(
                    () =>
                        ref.read(userEventsProvider.notifier).cancel(event.id),
                  );
                }
              },
              child: Text(strings.eventCancelAction),
            ),
          ],
        ],
      ),
    );
  }

  Future<bool> _confirmCancel(BuildContext context) async {
    final strings = AppLocalizations.of(context);
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(strings.eventCancelConfirmTitle),
        content: Text(strings.eventCancelConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(strings.eventKeep),
          ),
          FilledButton(
            key: const ValueKey('event-cancel-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(strings.eventCancelAction),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  void _showInvite(BuildContext context, WidgetRef ref, UserEvent event) {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        builder: (sheetContext) => _InviteSheet(event: event),
      ),
    );
  }

  static void _toast(ScaffoldMessengerState messenger, String message) =>
      messenger.showSnackBar(SnackBar(content: Text(message)));
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.text, super.key});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: Theme.of(context).colorScheme.outline),
        const SizedBox(width: 12),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

/// How a host brings people: a link that opens the event page, and a ready
/// message to paste into any chat. The app does not message people itself.
class _InviteSheet extends ConsumerWidget {
  const _InviteSheet({required this.event});

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
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(strings.eventInviteCopied)));
    }

    return SafeArea(
      child: Padding(
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
