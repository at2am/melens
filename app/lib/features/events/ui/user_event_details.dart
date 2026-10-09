import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:logging/logging.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../data/user_event_models.dart';
import '../state/user_events_providers.dart';
import 'user_event_text.dart';

/// One event: what it is, when and where, who is going, and the actions the
/// viewer has. A visitor joins or leaves; the organiser edits, cancels or
/// removes it and manages its members (UC-09).
class UserEventDetails extends ConsumerStatefulWidget {
  const UserEventDetails({
    required this.eventId,
    required this.onBack,
    required this.onEdit,
    required this.onShowOnMap,
    super.key,
  });

  final String eventId;
  final VoidCallback onBack;
  final ValueChanged<UserEvent> onEdit;
  final ValueChanged<AgentLatLng> onShowOnMap;

  @override
  ConsumerState<UserEventDetails> createState() => _UserEventDetailsState();
}

class _UserEventDetailsState extends ConsumerState<UserEventDetails> {
  static final _log = Logger('UserEventDetails');

  final _displayName = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _displayName.text = ref.read(userEventDisplayNameProvider) ?? '';
  }

  @override
  void dispose() {
    _displayName.dispose();
    super.dispose();
  }

  UserEventDetailController get _controller =>
      ref.read(userEventDetailControllerProvider(widget.eventId).notifier);

  Future<void> _run(Future<void> Function() action) async {
    final strings = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on Object catch (error, stack) {
      _log.warning('Event action failed', error, stack);
      if (mounted) setState(() => _error = userEventErrorText(strings, error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _join() => _run(() async {
    final name = _displayName.text.trim();
    ref.read(userEventDisplayNameProvider.notifier).remember(name);
    await _controller.join(displayName: name.isEmpty ? null : name);
  });

  Future<void> _leave() => _run(_controller.leave);

  Future<bool> _confirm(String title, String body, String action) async {
    final strings = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(strings.eventsConfirmKeep),
          ),
          FilledButton(
            key: const ValueKey('event-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(action),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  Future<void> _cancelEvent() async {
    final strings = AppLocalizations.of(context);
    if (!await _confirm(
      strings.eventsCancelConfirmTitle,
      strings.eventsCancelConfirmBody,
      strings.eventsCancelEvent,
    )) {
      return;
    }
    await _run(_controller.cancel);
  }

  Future<void> _removeEvent() async {
    final strings = AppLocalizations.of(context);
    if (!await _confirm(
      strings.eventsRemoveConfirmTitle,
      strings.eventsRemoveConfirmBody,
      strings.eventsRemoveEvent,
    )) {
      return;
    }
    var removed = false;
    await _run(() async {
      await _controller.remove();
      removed = true;
    });
    if (removed && mounted) widget.onBack();
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final clock = ref.watch(melbourneClockProvider);
    final detail = ref.watch(userEventDetailControllerProvider(widget.eventId));
    final event = detail.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            IconButton(
              key: const ValueKey('event-details-back'),
              tooltip: strings.eventsBack,
              onPressed: widget.onBack,
              icon: const Icon(Icons.arrow_back),
            ),
            Expanded(
              child: Text(
                event?.title ?? '',
                style: theme.textTheme.titleMedium,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        Expanded(
          child: event == null
              ? detail.when(
                  data: (_) => const SizedBox.shrink(),
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (error, stack) => Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          strings.eventsLoadFailed(
                            userEventErrorText(strings, error),
                          ),
                          style: TextStyle(color: colors.error),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: () => unawaited(_controller.refresh()),
                          child: Text(strings.eventsRetry),
                        ),
                      ],
                    ),
                  ),
                )
              : _body(strings, theme, clock, event),
        ),
      ],
    );
  }

  Widget _body(
    AppLocalizations strings,
    ThemeData theme,
    MelbourneClock clock,
    UserEvent event,
  ) {
    final colors = theme.colorScheme;
    final now = clock.now().toUtc();
    final ended = event.hasEndedAt(now);
    final badges = <Widget>[
      if (event.viewer.isOwner) Chip(label: Text(strings.eventsYours)),
      if (event.viewer.joined)
        Chip(
          key: const ValueKey('event-details-going'),
          avatar: const Icon(Icons.check, size: 18),
          label: Text(strings.eventsYouAreGoing),
        ),
      if (event.isCancelled)
        Chip(
          key: const ValueKey('event-details-cancelled'),
          label: Text(strings.eventsCancelled),
          backgroundColor: colors.errorContainer,
        ),
      if (!event.isCancelled && ended) Chip(label: Text(strings.eventsEnded)),
      if (!event.isCancelled && !ended && event.isFull)
        Chip(label: Text(strings.eventsFull)),
      if (event.anonymousAttendance)
        Chip(
          avatar: const Icon(Icons.visibility_off_outlined, size: 18),
          label: Text(strings.eventsAnonymousBadge),
        ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        if (badges.isNotEmpty)
          Wrap(spacing: 8, runSpacing: 4, children: badges),
        const SizedBox(height: 8),
        Text(strings.eventsWhen, style: theme.textTheme.labelLarge),
        Text(
          formatEventWhen(strings, clock, event),
          key: const ValueKey('event-details-when'),
        ),
        const SizedBox(height: 8),
        Text(strings.eventsWhere, style: theme.textTheme.labelLarge),
        if (event.placeName != null) Text(event.placeName!),
        Text(
          formatEventPin(strings, event.point),
          style: theme.textTheme.bodySmall,
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: const ValueKey('event-details-show-on-map'),
            onPressed: () => widget.onShowOnMap(event.point),
            icon: const Icon(Icons.place_outlined),
            label: Text(strings.eventsShowOnMap),
          ),
        ),
        if (event.description.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(event.description),
        ],
        const SizedBox(height: 12),
        Row(
          children: [
            const Icon(Icons.group_outlined, size: 18),
            const SizedBox(width: 6),
            Text(
              formatEventGoing(strings, event),
              key: const ValueKey('event-details-going-count'),
            ),
          ],
        ),
        if (event.anonymousAttendance)
          Text(
            strings.eventsAnonymousExplainer,
            style: theme.textTheme.bodySmall,
          ),
        const SizedBox(height: 12),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              _error!,
              key: const ValueKey('event-details-error'),
              style: theme.textTheme.bodyMedium?.copyWith(color: colors.error),
            ),
          ),
        if (event.viewer.isOwner)
          _ownerActions(strings, event)
        else
          _visitorActions(strings, event, now),
        if (event.viewer.isOwner) ...[
          const SizedBox(height: 16),
          _MembersSection(event: event),
        ],
      ],
    );
  }

  Widget _visitorActions(
    AppLocalizations strings,
    UserEvent event,
    DateTime now,
  ) {
    if (event.viewer.joined) {
      return Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          key: const ValueKey('event-details-leave'),
          onPressed: _busy ? null : () => unawaited(_leave()),
          icon: const Icon(Icons.logout),
          label: Text(strings.eventsLeave),
        ),
      );
    }
    final canJoin = event.canJoinAt(now);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (canJoin)
          TextField(
            key: const ValueKey('event-details-name'),
            controller: _displayName,
            enabled: !_busy,
            maxLength: UserEventLimits.displayNameMaxLength,
            decoration: InputDecoration(
              labelText: strings.eventsJoinNameLabel,
              helperText: strings.eventsJoinNameHint,
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            key: const ValueKey('event-details-join'),
            onPressed: canJoin && !_busy ? () => unawaited(_join()) : null,
            icon: const Icon(Icons.person_add_alt_1_outlined),
            label: Text(strings.eventsJoin),
          ),
        ),
      ],
    );
  }

  Widget _ownerActions(AppLocalizations strings, UserEvent event) => Wrap(
    spacing: 8,
    runSpacing: 4,
    children: [
      if (!event.isCancelled)
        OutlinedButton.icon(
          key: const ValueKey('event-details-edit'),
          onPressed: _busy ? null : () => widget.onEdit(event),
          icon: const Icon(Icons.edit_outlined),
          label: Text(strings.eventsEdit),
        ),
      if (!event.isCancelled)
        OutlinedButton.icon(
          key: const ValueKey('event-details-cancel'),
          onPressed: _busy ? null : () => unawaited(_cancelEvent()),
          icon: const Icon(Icons.event_busy_outlined),
          label: Text(strings.eventsCancelEvent),
        ),
      OutlinedButton.icon(
        key: const ValueKey('event-details-remove'),
        onPressed: _busy ? null : () => unawaited(_removeEvent()),
        icon: const Icon(Icons.delete_outline),
        label: Text(strings.eventsRemoveEvent),
      ),
    ],
  );
}

/// The organiser's view of who joined: a list with a remove action, or the
/// count alone for an anonymous event (agent-protocol.md, User events,
/// Rules 2).
class _MembersSection extends ConsumerStatefulWidget {
  const _MembersSection({required this.event});

  final UserEvent event;

  @override
  ConsumerState<_MembersSection> createState() => _MembersSectionState();
}

class _MembersSectionState extends ConsumerState<_MembersSection> {
  static final _log = Logger('UserEventMembers');
  String? _error;
  String? _removing;

  Future<void> _remove(String memberId) async {
    final strings = AppLocalizations.of(context);
    setState(() {
      _removing = memberId;
      _error = null;
    });
    try {
      await ref
          .read(userEventMembersControllerProvider(widget.event.id).notifier)
          .removeMember(memberId);
    } on Object catch (error, stack) {
      _log.warning('Removing a member failed', error, stack);
      if (mounted) setState(() => _error = userEventErrorText(strings, error));
    } finally {
      if (mounted) setState(() => _removing = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final members = ref.watch(
      userEventMembersControllerProvider(widget.event.id),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(strings.eventsMembers, style: theme.textTheme.titleSmall),
        if (_error != null)
          Text(
            _error!,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
            ),
          ),
        members.when(
          data: (page) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                strings.eventsMembersCount(page.count),
                key: const ValueKey('event-members-count'),
              ),
              if (page.members == null)
                Text(
                  strings.eventsMembersAnonymous,
                  key: const ValueKey('event-members-anonymous'),
                  style: theme.textTheme.bodySmall,
                )
              else
                for (final member in page.members!)
                  ListTile(
                    key: ValueKey('event-member-${member.memberId}'),
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.person_outline),
                    title: Text(
                      member.displayName ?? strings.eventsMemberGuest,
                    ),
                    subtitle: Text(
                      strings.eventsMemberJoinedAt(
                        formatEventTime(clock, member.joinedAt),
                      ),
                    ),
                    trailing: IconButton(
                      key: ValueKey('event-member-remove-${member.memberId}'),
                      tooltip: strings.eventsMemberRemove,
                      onPressed: _removing != null
                          ? null
                          : () => unawaited(_remove(member.memberId)),
                      icon: const Icon(Icons.person_remove_outlined),
                    ),
                  ),
            ],
          ),
          loading: () => const Padding(
            padding: EdgeInsets.all(8),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (error, stack) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                strings.eventsLoadFailed(userEventErrorText(strings, error)),
                style: TextStyle(color: theme.colorScheme.error),
              ),
              OutlinedButton(
                onPressed: () => ref.invalidate(
                  userEventMembersControllerProvider(widget.event.id),
                ),
                child: Text(strings.eventsRetry),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
