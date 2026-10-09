import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../data/user_event_models.dart';
import '../state/user_events_providers.dart';
import 'user_event_details.dart';
import 'user_event_form.dart';
import 'user_event_text.dart';

enum _Segment { nearby, mine }

enum _View { list, details, form }

/// The user events panel (UC-09): the events near the map's viewport and the
/// user's own, each opening to its details, and the form that publishes a
/// new one. The map screen hosts it beside the map or in a sheet.
class UserEventsPanel extends ConsumerStatefulWidget {
  const UserEventsPanel({
    required this.onShowOnMap,
    this.onClose,
    this.onPickOnMap,
    this.initialEventId,
    super.key,
  });

  final VoidCallback? onClose;

  /// Moves the map to a point; the host closes a covering sheet first.
  final ValueChanged<AgentLatLng> onShowOnMap;

  /// The form started picking its pin on the map; a host whose sheet covers
  /// the map closes it and reopens the panel after the tap.
  final VoidCallback? onPickOnMap;

  /// An event to open at once, from a tapped marker.
  final String? initialEventId;

  @override
  ConsumerState<UserEventsPanel> createState() => _UserEventsPanelState();
}

class _UserEventsPanelState extends ConsumerState<UserEventsPanel> {
  _Segment _segment = _Segment.nearby;
  _View _view = _View.list;
  String? _eventId;
  UserEvent? _editing;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialEventId ?? ref.read(openUserEventProvider);
    // A form that closed to pick a pin on the map comes back first.
    final draft = ref.read(userEventFormDraftProvider);
    if (draft != null) {
      _view = _View.form;
      _editing = draft.editing;
      _eventId = draft.editing?.id;
    } else if (initial != null) {
      _view = _View.details;
      _eventId = initial;
    }
    ref.listenManual(openUserEventProvider, (previous, next) {
      if (next == null) return;
      setState(() {
        _view = _View.details;
        _eventId = next;
        _editing = null;
      });
      ref.read(openUserEventProvider.notifier).clear();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(openUserEventProvider.notifier).clear();
      ref.read(nearbyUserEventsControllerProvider.notifier).setActive(true);
    });
  }

  @override
  void dispose() {
    ref.read(nearbyUserEventsControllerProvider.notifier).setActive(false);
    super.dispose();
  }

  void _open(UserEvent event) => setState(() {
    _view = _View.details;
    _eventId = event.id;
  });

  void _backToList() => setState(() {
    _view = _View.list;
    _eventId = null;
    _editing = null;
  });

  void _publish() => setState(() {
    _view = _View.form;
    _editing = null;
  });

  void _edit(UserEvent event) => setState(() {
    _view = _View.form;
    _editing = event;
  });

  void _saved(UserEvent event) => setState(() {
    _view = _View.details;
    _eventId = event.id;
    _editing = null;
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final Widget body = switch (_view) {
      _View.details => UserEventDetails(
        key: ValueKey('event-details-$_eventId'),
        eventId: _eventId!,
        onBack: _backToList,
        onEdit: _edit,
        onShowOnMap: widget.onShowOnMap,
      ),
      _View.form => UserEventForm(
        key: ValueKey('event-form-${_editing?.id ?? 'new'}'),
        initial: _editing,
        onSaved: _saved,
        onCancel: _editing == null
            ? _backToList
            : () => setState(() => _view = _View.details),
        onPickOnMap: widget.onPickOnMap,
      ),
      _View.list => _list(strings),
    };
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 4, 0),
            child: Row(
              children: [
                Icon(Icons.event_outlined, color: colors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    strings.eventsPanelTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                if (widget.onClose != null)
                  IconButton(
                    key: const ValueKey('events-panel-close'),
                    tooltip: strings.eventsClose,
                    onPressed: widget.onClose,
                    icon: const Icon(Icons.close),
                  ),
              ],
            ),
          ),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _list(AppLocalizations strings) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: Row(
          children: [
            Expanded(
              child: SegmentedButton<_Segment>(
                segments: [
                  ButtonSegment(
                    value: _Segment.nearby,
                    label: Text(strings.eventsTabNearby),
                    icon: const Icon(Icons.near_me_outlined),
                  ),
                  ButtonSegment(
                    value: _Segment.mine,
                    label: Text(strings.eventsTabMine),
                    icon: const Icon(Icons.person_outline),
                  ),
                ],
                selected: {_segment},
                onSelectionChanged: (selection) =>
                    setState(() => _segment = selection.first),
              ),
            ),
            IconButton(
              key: const ValueKey('events-refresh'),
              tooltip: strings.eventsRefresh,
              onPressed: () {
                unawaited(
                  ref
                      .read(nearbyUserEventsControllerProvider.notifier)
                      .refresh(),
                );
                unawaited(
                  ref.read(myUserEventsControllerProvider.notifier).refresh(),
                );
              },
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: FilledButton.icon(
          key: const ValueKey('events-publish'),
          onPressed: _publish,
          icon: const Icon(Icons.add),
          label: Text(strings.eventsPublish),
        ),
      ),
      Expanded(
        child: switch (_segment) {
          _Segment.nearby => _NearbyList(onOpen: _open),
          _Segment.mine => _MineList(onOpen: _open),
        },
      ),
    ],
  );
}

class _NearbyList extends ConsumerWidget {
  const _NearbyList({required this.onOpen});

  final ValueChanged<UserEvent> onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final nearby = ref.watch(nearbyUserEventsControllerProvider);
    final bounds = ref.watch(userEventSearchBoundsProvider);
    final error = nearby.error;
    if (bounds == null && nearby.events.isEmpty) {
      return _Message(strings.eventsNearbyNoViewport);
    }
    if (!nearby.hasLoaded || (nearby.isLoading && nearby.events.isEmpty)) {
      return const Center(child: CircularProgressIndicator());
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (nearby.isLoading) const LinearProgressIndicator(),
        if (error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(
              strings.eventsLoadFailed(userEventErrorText(strings, error)),
              key: const ValueKey('events-nearby-error'),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ),
        Expanded(
          child: nearby.events.isEmpty
              ? _Message(strings.eventsNearbyEmpty)
              : ListView(
                  key: const ValueKey('events-nearby-list'),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    for (final event in nearby.events)
                      _EventTile(event: event, onTap: () => onOpen(event)),
                  ],
                ),
        ),
      ],
    );
  }
}

class _MineList extends ConsumerWidget {
  const _MineList({required this.onOpen});

  final ValueChanged<UserEvent> onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final mine = ref.watch(myUserEventsControllerProvider);
    return mine.when(
      skipLoadingOnReload: true,
      data: (events) => events.owned.isEmpty && events.joined.isEmpty
          ? _Message(strings.eventsMineEmpty)
          : ListView(
              key: const ValueKey('events-mine-list'),
              padding: const EdgeInsets.symmetric(vertical: 8),
              children: [
                if (events.owned.isNotEmpty)
                  _Heading(strings.eventsMineOwnedHeading),
                for (final event in events.owned)
                  _EventTile(event: event, onTap: () => onOpen(event)),
                if (events.joined.isNotEmpty)
                  _Heading(strings.eventsMineJoinedHeading),
                for (final event in events.joined)
                  _EventTile(event: event, onTap: () => onOpen(event)),
              ],
            ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              strings.eventsLoadFailed(userEventErrorText(strings, error)),
              key: const ValueKey('events-mine-error'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => unawaited(
                ref.read(myUserEventsControllerProvider.notifier).refresh(),
              ),
              child: Text(strings.eventsRetry),
            ),
          ],
        ),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
    child: Text(text, style: Theme.of(context).textTheme.titleSmall),
  );
}

class _Message extends StatelessWidget {
  const _Message(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(16),
    child: Text(text, key: const ValueKey('events-message')),
  );
}

/// One event in a list: title, Melbourne start time, place, how many are
/// going, and its state.
class _EventTile extends ConsumerWidget {
  const _EventTile({required this.event, required this.onTap});

  final UserEvent event;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final clock = ref.watch(melbourneClockProvider);
    final place = event.placeName;
    final chips = <Widget>[
      if (event.isCancelled)
        _SmallChip(strings.eventsCancelled, color: colors.errorContainer),
      if (event.viewer.joined) _SmallChip(strings.eventsYouAreGoing),
      if (event.viewer.isOwner) _SmallChip(strings.eventsYours),
      if (!event.isCancelled && event.isFull) _SmallChip(strings.eventsFull),
    ];
    return ListTile(
      key: ValueKey('event-tile-${event.id}'),
      onTap: onTap,
      title: Text(event.title, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            place == null
                ? formatEventTime(clock, event.startAt)
                : '${formatEventTime(clock, event.startAt)} · $place',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          Text(
            formatEventGoing(strings, event),
            style: theme.textTheme.bodySmall,
          ),
          if (chips.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Wrap(spacing: 4, runSpacing: 4, children: chips),
            ),
        ],
      ),
      isThreeLine: true,
      trailing: const Icon(Icons.chevron_right),
    );
  }
}

class _SmallChip extends StatelessWidget {
  const _SmallChip(this.text, {this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) => Chip(
    label: Text(text),
    backgroundColor: color,
    visualDensity: VisualDensity.compact,
    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    labelStyle: Theme.of(context).textTheme.labelSmall,
  );
}
