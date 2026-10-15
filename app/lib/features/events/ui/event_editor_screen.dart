import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../app/router.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/user_event.dart';
import '../state/event_providers.dart';
import 'event_labels.dart';

/// Publishes an event (UC-09): title, time, place and description. Times are
/// Melbourne time, whatever the device's zone.
class EventEditorScreen extends ConsumerStatefulWidget {
  const EventEditorScreen({super.key});

  @override
  ConsumerState<EventEditorScreen> createState() => _EventEditorScreenState();
}

class _EventEditorScreenState extends ConsumerState<EventEditorScreen> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _capacity = TextEditingController();
  EventCategory _category = EventCategory.community;
  EventPlace _place = melbournePlaces.first;
  EventVisibility _visibility = EventVisibility.public;
  late tz.TZDateTime _start;
  late tz.TZDateTime _end;
  String? _timeError;
  bool _publishing = false;

  @override
  void initState() {
    super.initState();
    // Tomorrow, 6 PM to 8 PM Melbourne time, a sensible blank.
    final tomorrow = ref
        .read(melbourneClockProvider)
        .now()
        .add(const Duration(days: 1));
    _start = tz.TZDateTime(
      MelbourneClock.location,
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      18,
    );
    _end = _start.add(const Duration(hours: 2));
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _capacity.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = ref.read(melbourneClockProvider).now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _start,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 1, now.month, now.day),
    );
    if (picked == null) return;
    setState(() {
      final length = _end.difference(_start);
      _start = _withDate(_start, picked);
      _end = _start.add(length);
      _timeError = null;
    });
  }

  Future<void> _pickTime({required bool start}) async {
    final current = start ? _start : _end;
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: current.hour, minute: current.minute),
    );
    if (picked == null) return;
    setState(() {
      final base = start ? _start : _end;
      final next = tz.TZDateTime(
        MelbourneClock.location,
        base.year,
        base.month,
        base.day,
        picked.hour,
        picked.minute,
      );
      if (start) {
        final length = _end.difference(_start);
        _start = next;
        if (!_end.isAfter(_start)) _end = _start.add(length);
      } else {
        _end = next;
      }
      _timeError = null;
    });
  }

  tz.TZDateTime _withDate(tz.TZDateTime time, DateTime date) => tz.TZDateTime(
    MelbourneClock.location,
    date.year,
    date.month,
    date.day,
    time.hour,
    time.minute,
  );

  Future<void> _publish() async {
    final strings = AppLocalizations.of(context);
    final now = ref.read(melbourneClockProvider).now();
    String? timeError;
    if (!_start.isAfter(now)) {
      timeError = strings.eventStartPast;
    } else if (!_end.isAfter(_start)) {
      timeError = strings.eventEndBeforeStart;
    }
    final valid = _form.currentState!.validate();
    setState(() => _timeError = timeError);
    if (!valid || timeError != null) return;

    final capacity = int.tryParse(_capacity.text.trim());
    setState(() => _publishing = true);
    try {
      final event = await ref
          .read(userEventsProvider.notifier)
          .publish(
            UserEventDraft(
              title: _title.text.trim(),
              description: _description.text.trim(),
              category: _category,
              startAt: _start.toUtc(),
              endAt: _end.toUtc(),
              place: _place,
              visibility: _visibility,
              capacity: capacity,
            ),
          );
      if (!mounted) return;
      // Replace the editor with the new event, so back returns to the feed.
      context.pushReplacement(AppRoutes.event(event.id));
    } on Exception {
      if (!mounted) return;
      setState(() => _publishing = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(strings.eventActionFailed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final day = DateFormat('EEE d MMM', 'en_AU');
    final time = DateFormat('h:mm a', 'en_AU');

    return Scaffold(
      appBar: AppBar(
        title: Text(strings.eventNewTitle),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: FilledButton(
              key: const ValueKey('event-publish'),
              onPressed: _publishing ? null : () => unawaited(_publish()),
              child: Text(strings.eventPublish),
            ),
          ),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 112),
          children: [
            TextFormField(
              key: const ValueKey('event-title'),
              controller: _title,
              maxLength: 80,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(labelText: strings.eventFieldTitle),
              validator: (value) => (value ?? '').trim().isEmpty
                  ? strings.eventTitleRequired
                  : null,
            ),
            const SizedBox(height: 8),
            TextFormField(
              key: const ValueKey('event-description'),
              controller: _description,
              maxLength: 500,
              minLines: 3,
              maxLines: 6,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                labelText: strings.eventFieldDescription,
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 16),
            _Label(strings.eventFieldCategory),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final category in EventCategory.values)
                  ChoiceChip(
                    key: ValueKey('event-category-${category.name}'),
                    avatar: Icon(eventCategoryIcon(category), size: 18),
                    label: Text(eventCategoryTitle(strings, category)),
                    selected: _category == category,
                    onSelected: (_) => setState(() => _category = category),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            _Label(strings.eventFieldWhen),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ActionChip(
                  key: const ValueKey('event-date'),
                  avatar: const Icon(Icons.calendar_today, size: 18),
                  label: Text(day.format(_start)),
                  onPressed: _pickDate,
                ),
                ActionChip(
                  key: const ValueKey('event-start'),
                  avatar: const Icon(Icons.schedule, size: 18),
                  label: Text(time.format(_start)),
                  onPressed: () => _pickTime(start: true),
                ),
                ActionChip(
                  key: const ValueKey('event-end'),
                  avatar: const Icon(Icons.schedule, size: 18),
                  label: Text('${strings.eventFieldEnds} ${time.format(_end)}'),
                  onPressed: () => _pickTime(start: false),
                ),
              ],
            ),
            if (_timeError != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _timeError!,
                  key: const ValueKey('event-time-error'),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
              ),
            const SizedBox(height: 20),
            _Label(strings.eventFieldPlace),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final place in melbournePlaces)
                  ChoiceChip(
                    key: ValueKey('event-place-${place.name}'),
                    label: Text(place.name),
                    selected: _place == place,
                    onSelected: (_) => setState(() => _place = place),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            TextFormField(
              key: const ValueKey('event-capacity'),
              controller: _capacity,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: strings.eventFieldCapacity,
              ),
              validator: (value) {
                final text = (value ?? '').trim();
                if (text.isEmpty) return null;
                final number = int.tryParse(text);
                return number == null || number < 2 || number > 500
                    ? strings.eventCapacityInvalid
                    : null;
              },
            ),
            const SizedBox(height: 20),
            _Label(strings.eventFieldVisibility),
            SegmentedButton<EventVisibility>(
              key: const ValueKey('event-visibility'),
              showSelectedIcon: false,
              segments: [
                ButtonSegment(
                  value: EventVisibility.public,
                  icon: const Icon(Icons.public),
                  label: Text(strings.eventVisibilityPublic),
                ),
                ButtonSegment(
                  value: EventVisibility.linkOnly,
                  icon: const Icon(Icons.link),
                  label: Text(strings.eventVisibilityLinkOnly),
                ),
              ],
              selected: {_visibility},
              onSelectionChanged: (value) =>
                  setState(() => _visibility = value.first),
            ),
            const SizedBox(height: 8),
            Text(
              _visibility == EventVisibility.public
                  ? strings.eventVisibilityPublicHint
                  : strings.eventVisibilityLinkOnlyHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: Theme.of(context).textTheme.labelLarge
          ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
    ),
  );
}
