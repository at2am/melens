import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:logging/logging.dart';
import 'package:material_ui/material_ui.dart';
import 'package:timezone/timezone.dart' as tz;

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../map/data/map_models.dart';
import '../../map/state/selection_controller.dart';
import '../../map/state/viewport_controller.dart';
import '../data/place_search.dart';
import '../data/user_event_models.dart';
import '../state/user_events_providers.dart';
import 'user_event_text.dart';

/// The centre of the map's current viewport, or the CBD before the map has
/// one: where a new event is pinned.
AgentLatLng mapCentreOf(ViewportState viewport) {
  final bbox = viewport.bbox;
  if (bbox == null) return const AgentLatLng(lat: -37.8136, lng: 144.9631);
  return AgentLatLng(
    lat: (bbox.north + bbox.south) / 2,
    lng: (bbox.east + bbox.west) / 2,
  );
}

/// Publishes a new event or edits one the user owns (UC-09). Every limit of
/// agent-protocol.md (User events, Rules 1) is checked here before the
/// request, and a refusal by the service is shown under the form.
class UserEventForm extends ConsumerStatefulWidget {
  const UserEventForm({
    required this.onSaved,
    required this.onCancel,
    this.initial,
    this.initialPoint,
    this.onPickOnMap,
    super.key,
  });

  /// The event to edit; null publishes a new one.
  final UserEvent? initial;

  /// Where a new event is pinned when the form opens.
  final AgentLatLng? initialPoint;

  final ValueChanged<UserEvent> onSaved;
  final VoidCallback onCancel;

  /// Picking a pin on the map started: a host whose sheet covers the map
  /// closes it; the form has kept its fields in [UserEventFormDraft].
  final VoidCallback? onPickOnMap;

  @override
  ConsumerState<UserEventForm> createState() => _UserEventFormState();
}

class _UserEventFormState extends ConsumerState<UserEventForm> {
  static final _log = Logger('UserEventForm');

  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _placeName = TextEditingController();
  final _capacity = TextEditingController();
  late tz.TZDateTime _start;
  tz.TZDateTime? _end;
  bool _anonymous = false;
  late AgentLatLng _point;
  bool _submitting = false;
  String? _timeError;
  String? _locationError;
  String? _serverError;

  /// Address search: the typed query, its suggestions and the chosen address.
  final _search = TextEditingController();
  Timer? _debounce;
  List<PlaceSuggestion> _suggestions = const [];
  bool _searching = false;
  bool _searched = false;
  String? _searchError;
  String? _address;

  bool get _editing => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final clock = ref.read(melbourneClockProvider);
    final initial = widget.initial;
    // A form that closed to pick a pin on the map comes back with its fields.
    final snapshot = ref.read(userEventFormDraftProvider);
    final restored = snapshot != null && snapshot.editing?.id == initial?.id;
    if (restored) {
      _title.text = snapshot.title;
      _description.text = snapshot.description;
      _placeName.text = snapshot.placeName;
      _capacity.text = snapshot.capacity;
      _start = clock.toMelbourne(snapshot.start);
      _end = snapshot.end == null ? null : clock.toMelbourne(snapshot.end!);
      _anonymous = snapshot.anonymous;
      _point = snapshot.point;
    } else if (initial != null) {
      _title.text = initial.title;
      _description.text = initial.description;
      _placeName.text = initial.placeName ?? '';
      _capacity.text = initial.capacity?.toString() ?? '';
      _start = clock.toMelbourne(initial.startAt);
      _end = initial.endAt == null ? null : clock.toMelbourne(initial.endAt!);
      _anonymous = initial.anonymousAttendance;
      _point = initial.point;
    } else {
      final now = clock.now();
      _start = tz.TZDateTime(
        MelbourneClock.location,
        now.year,
        now.month,
        now.day,
        now.hour + 1,
      );
      _point =
          widget.initialPoint ??
          mapCentreOf(ref.read(viewportControllerProvider));
    }
    final picked = ref.read(userEventPinPickerProvider).picked;
    if (picked != null) _point = picked;
    // The providers are cleared once the tree is built; a build must not
    // modify them.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(userEventFormDraftProvider.notifier).take();
      ref.read(userEventPinPickerProvider.notifier).take();
    });
    // Beside the map the form stays open while the user taps the map.
    ref.listenManual(userEventPinPickerProvider, (previous, next) {
      final point = next.picked;
      if (point == null) return;
      setState(() {
        _point = point;
        _locationError = null;
        _address = null;
      });
      ref.read(userEventPinPickerProvider.notifier).take();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _title.dispose();
    _description.dispose();
    _placeName.dispose();
    _capacity.dispose();
    _search.dispose();
    super.dispose();
  }

  String? _lengthValidator(
    AppLocalizations strings,
    String? value, {
    required int max,
    bool required = false,
  }) {
    final text = (value ?? '').trim();
    if (required && text.isEmpty) return strings.eventsFormTitleRequired;
    if (text.length > max) return strings.eventsFormTooLong(max);
    return null;
  }

  String? _capacityValidator(AppLocalizations strings, String? value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final number = int.tryParse(text);
    if (number == null ||
        number < UserEventLimits.capacityMin ||
        number > UserEventLimits.capacityMax) {
      return strings.eventsFormCapacityRange;
    }
    return null;
  }

  /// The time and location checks the field validators cannot express.
  bool _validateRest(AppLocalizations strings) {
    final now = ref.read(melbourneClockProvider).now();
    String? timeError;
    final startChanged =
        widget.initial == null ||
        !_start.isAtSameMomentAs(widget.initial!.startAt);
    if (startChanged &&
        _start.isBefore(now.subtract(UserEventLimits.startPastTolerance))) {
      timeError = strings.eventsFormStartTooEarly;
    } else if (_start.isAfter(now.add(UserEventLimits.startMaxAhead))) {
      timeError = strings.eventsFormStartTooLate;
    } else if (_end != null && !_end!.isAfter(_start)) {
      timeError = strings.eventsFormEndBeforeStart;
    } else if (_end != null &&
        _end!.difference(_start) > UserEventLimits.maxDuration) {
      timeError = strings.eventsFormDurationTooLong;
    }
    final locationError = mapRequestEnvelope.contains(_point.lng, _point.lat)
        ? null
        : strings.eventsFormLocationOutside;
    setState(() {
      _timeError = timeError;
      _locationError = locationError;
    });
    return timeError == null && locationError == null;
  }

  /// A plain UTC instant: a `TZDateTime` never equals a `DateTime`, and the
  /// draft compares instants.
  static DateTime _instant(tz.TZDateTime time) =>
      DateTime.fromMillisecondsSinceEpoch(
        time.millisecondsSinceEpoch,
        isUtc: true,
      );

  UserEventDraft _draft() {
    final placeName = _placeName.text.trim();
    final capacity = _capacity.text.trim();
    return UserEventDraft(
      title: _title.text.trim(),
      description: _description.text.trim(),
      point: _point,
      placeName: placeName.isEmpty ? null : placeName,
      startAt: _instant(_start),
      endAt: _end == null ? null : _instant(_end!),
      anonymousAttendance: _anonymous,
      capacity: capacity.isEmpty ? null : int.parse(capacity),
    );
  }

  Future<void> _submit() async {
    final strings = AppLocalizations.of(context);
    final fieldsOk = _form.currentState?.validate() ?? false;
    final restOk = _validateRest(strings);
    if (!fieldsOk || !restOk) return;
    final draft = _draft();
    setState(() {
      _submitting = true;
      _serverError = null;
    });
    try {
      final UserEvent saved;
      final initial = widget.initial;
      if (initial == null) {
        saved = await ref
            .read(myUserEventsControllerProvider.notifier)
            .publish(draft);
      } else {
        final patch = draft.diff(initial.toDraft());
        if (patch.isEmpty) {
          setState(() {
            _submitting = false;
            _serverError = strings.eventsFormNoChanges;
          });
          return;
        }
        saved = await ref
            .read(userEventDetailControllerProvider(initial.id).notifier)
            .edit(patch);
      }
      if (!mounted) return;
      widget.onSaved(saved);
    } on Object catch (error, stack) {
      _log.warning('Saving the event failed', error, stack);
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _serverError = userEventErrorText(strings, error);
      });
    }
  }

  Future<void> _pickDate({required bool end}) async {
    final current = end ? (_end ?? _start) : _start;
    final now = ref.read(melbourneClockProvider).now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(current.year, current.month, current.day),
      firstDate: DateTime(now.year, now.month, now.day - 1),
      lastDate: DateTime(now.year + 1, now.month, now.day + 7),
    );
    if (picked == null || !mounted) return;
    setState(() {
      final replaced = tz.TZDateTime(
        MelbourneClock.location,
        picked.year,
        picked.month,
        picked.day,
        current.hour,
        current.minute,
      );
      if (end) {
        _end = replaced;
      } else {
        _start = replaced;
      }
      _timeError = null;
    });
  }

  Future<void> _pickTime({required bool end}) async {
    final current = end ? (_end ?? _start) : _start;
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: current.hour, minute: current.minute),
    );
    if (picked == null || !mounted) return;
    setState(() {
      final replaced = tz.TZDateTime(
        MelbourneClock.location,
        current.year,
        current.month,
        current.day,
        picked.hour,
        picked.minute,
      );
      if (end) {
        _end = replaced;
      } else {
        _start = replaced;
      }
      _timeError = null;
    });
  }

  void _useMapCentre() {
    setState(() {
      _point = mapCentreOf(ref.read(viewportControllerProvider));
      _locationError = null;
      _address = null;
    });
  }

  UserEventFormSnapshot _snapshot() => UserEventFormSnapshot(
    editing: widget.initial,
    title: _title.text,
    description: _description.text,
    placeName: _placeName.text,
    start: _start,
    end: _end,
    anonymous: _anonymous,
    capacity: _capacity.text,
    point: _point,
  );

  /// The next tap on the map becomes the pin. The fields are kept first, so
  /// a host that closes its sheet to show the map can reopen the form.
  void _pickOnMap() {
    ref.read(userEventFormDraftProvider.notifier).keep(_snapshot());
    ref.read(userEventPinPickerProvider.notifier).start();
    widget.onPickOnMap?.call();
  }

  /// The map record the user selected becomes the pin and, unless a place
  /// name was typed, the place.
  void _useSelected(MapItem item) {
    final geometry = item.geometry;
    if (geometry is! GeoJsonPoint) return;
    setState(() {
      _point = AgentLatLng(
        lat: geometry.coordinates[1],
        lng: geometry.coordinates[0],
      );
      if (_placeName.text.trim().isEmpty) _placeName.text = item.title;
      _locationError = null;
      _address = null;
    });
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    final query = value.trim();
    setState(() {
      _searchError = null;
      if (query.length < 3) {
        _suggestions = const [];
        _searched = false;
      }
    });
    if (query.length < 3) return;
    _debounce = Timer(
      const Duration(milliseconds: 400),
      () => unawaited(_runSearch(query)),
    );
  }

  Future<void> _runSearch(String query) async {
    final search = ref.read(placeSearchProvider);
    setState(() => _searching = true);
    try {
      final results = await search.suggest(query, near: _point);
      // A newer query is on its way; its own results follow.
      if (!mounted || _search.text.trim() != query) return;
      setState(() {
        _suggestions = results.take(5).toList(growable: false);
        _searching = false;
        _searched = true;
      });
    } on PlaceSearchUnavailableException catch (error) {
      _log.warning('Place search failed: ${error.message}');
      if (!mounted) return;
      setState(() {
        _suggestions = const [];
        _searching = false;
        _searched = true;
        _searchError = error.message;
      });
    }
  }

  Future<void> _choose(PlaceSuggestion suggestion) async {
    final search = ref.read(placeSearchProvider);
    _debounce?.cancel();
    setState(() {
      _searching = true;
      _searchError = null;
    });
    try {
      final location = await search.resolve(suggestion.placeId);
      if (!mounted) return;
      setState(() {
        _point = location.point;
        _address = location.address.isEmpty
            ? suggestion.secondaryText
            : location.address;
        if (_placeName.text.trim().isEmpty) {
          _placeName.text = location.name.isEmpty
              ? suggestion.mainText
              : location.name;
        }
        _search.text = suggestion.mainText;
        _suggestions = const [];
        _searching = false;
        _locationError = null;
      });
    } on PlaceSearchUnavailableException catch (error) {
      _log.warning('Resolving a place failed: ${error.message}');
      if (!mounted) return;
      setState(() {
        _searching = false;
        _searchError = error.message;
      });
    }
  }

  Widget _locationSection(AppLocalizations strings, ThemeData theme) {
    final colors = theme.colorScheme;
    final search = ref.watch(placeSearchProvider);
    final selected = ref.watch(
      selectionControllerProvider.select((state) => state.item),
    );
    final selectable = selected != null && selected.geometry is GeoJsonPoint;
    final query = _search.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(strings.eventsFormLocation, style: theme.textTheme.labelLarge),
        Text(
          formatEventPin(strings, _point),
          key: const ValueKey('event-form-location'),
        ),
        if (_address != null)
          Text(
            _address!,
            key: const ValueKey('event-form-address'),
            style: theme.textTheme.bodySmall,
          ),
        Text(strings.eventsFormLocationHint, style: theme.textTheme.bodySmall),
        Wrap(
          spacing: 8,
          children: [
            TextButton.icon(
              key: const ValueKey('event-form-pick-on-map'),
              onPressed: _submitting ? null : _pickOnMap,
              icon: const Icon(Icons.add_location_alt_outlined),
              label: Text(strings.eventsFormPickOnMap),
            ),
            TextButton.icon(
              key: const ValueKey('event-form-use-centre'),
              onPressed: _submitting ? null : _useMapCentre,
              icon: const Icon(Icons.center_focus_strong_outlined),
              label: Text(strings.eventsFormUseMapCentre),
            ),
            if (selectable)
              TextButton.icon(
                key: const ValueKey('event-form-use-selected'),
                onPressed: _submitting ? null : () => _useSelected(selected),
                icon: const Icon(Icons.place_outlined),
                label: Text(strings.eventsFormUseSelected(selected.title)),
              ),
          ],
        ),
        if (search.isAvailable) ...[
          TextField(
            key: const ValueKey('event-form-search'),
            controller: _search,
            enabled: !_submitting,
            decoration: InputDecoration(
              labelText: strings.eventsFormSearchPlace,
              helperText: strings.eventsFormSearchHint,
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searching
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : query.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _search.clear();
                        _onSearchChanged('');
                      },
                    ),
            ),
            textInputAction: TextInputAction.search,
            onChanged: _onSearchChanged,
          ),
          for (final suggestion in _suggestions)
            ListTile(
              key: ValueKey('event-form-suggestion-${suggestion.placeId}'),
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.place_outlined),
              title: Text(suggestion.mainText),
              subtitle: suggestion.secondaryText.isEmpty
                  ? null
                  : Text(suggestion.secondaryText),
              onTap: _submitting ? null : () => unawaited(_choose(suggestion)),
            ),
          if (_searchError != null)
            Text(
              strings.eventsFormSearchUnavailable(_searchError!),
              key: const ValueKey('event-form-search-error'),
              style: theme.textTheme.bodySmall?.copyWith(color: colors.error),
            )
          else if (_searched && !_searching && _suggestions.isEmpty)
            Text(
              strings.eventsFormSearchNoResults,
              key: const ValueKey('event-form-search-empty'),
              style: theme.textTheme.bodySmall,
            ),
        ],
        if (_locationError != null)
          Text(
            _locationError!,
            key: const ValueKey('event-form-location-error'),
            style: theme.textTheme.bodySmall?.copyWith(color: colors.error),
          ),
      ],
    );
  }

  Widget _timeRow(
    AppLocalizations strings,
    String label,
    tz.TZDateTime? value, {
    required bool end,
  }) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: theme.textTheme.labelLarge),
              Text(
                value == null
                    ? strings.eventsFormNoEnd
                    : formatEventTime(ref.read(melbourneClockProvider), value),
                key: ValueKey(end ? 'event-form-end' : 'event-form-start'),
              ),
            ],
          ),
        ),
        IconButton(
          tooltip: strings.eventsFormPickDate,
          onPressed: _submitting ? null : () => unawaited(_pickDate(end: end)),
          icon: const Icon(Icons.calendar_today_outlined),
        ),
        IconButton(
          tooltip: strings.eventsFormPickTime,
          onPressed: _submitting ? null : () => unawaited(_pickTime(end: end)),
          icon: const Icon(Icons.schedule_outlined),
        ),
        if (end && value != null)
          IconButton(
            tooltip: strings.eventsFormNoEnd,
            onPressed: _submitting
                ? null
                : () => setState(() {
                    _end = null;
                    _timeError = null;
                  }),
            icon: const Icon(Icons.clear),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    // Editing acts through the event's controller; watching it keeps the
    // auto-disposed provider alive for as long as the form is open.
    final editing = widget.initial;
    if (editing != null) {
      ref.watch(userEventDetailControllerProvider(editing.id));
    }
    return Form(
      key: _form,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                IconButton(
                  key: const ValueKey('event-form-cancel'),
                  tooltip: strings.eventsFormCancel,
                  onPressed: _submitting ? null : widget.onCancel,
                  icon: const Icon(Icons.arrow_back),
                ),
                Expanded(
                  child: Text(
                    _editing
                        ? strings.eventsFormEditTitle
                        : strings.eventsFormPublishTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextFormField(
              key: const ValueKey('event-form-title'),
              controller: _title,
              decoration: InputDecoration(labelText: strings.eventsFormTitle),
              maxLength: UserEventLimits.titleMaxLength,
              textInputAction: TextInputAction.next,
              validator: (value) => _lengthValidator(
                strings,
                value,
                max: UserEventLimits.titleMaxLength,
                required: true,
              ),
            ),
            TextFormField(
              key: const ValueKey('event-form-description'),
              controller: _description,
              decoration: InputDecoration(
                labelText: strings.eventsFormDescription,
              ),
              maxLength: UserEventLimits.descriptionMaxLength,
              maxLines: 4,
              validator: (value) => _lengthValidator(
                strings,
                value,
                max: UserEventLimits.descriptionMaxLength,
              ),
            ),
            TextFormField(
              key: const ValueKey('event-form-place'),
              controller: _placeName,
              decoration: InputDecoration(
                labelText: strings.eventsFormPlaceName,
              ),
              maxLength: UserEventLimits.placeNameMaxLength,
              textInputAction: TextInputAction.next,
              validator: (value) => _lengthValidator(
                strings,
                value,
                max: UserEventLimits.placeNameMaxLength,
              ),
            ),
            const SizedBox(height: 8),
            _timeRow(strings, strings.eventsFormStart, _start, end: false),
            _timeRow(strings, strings.eventsFormEnd, _end, end: true),
            if (_timeError != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  _timeError!,
                  key: const ValueKey('event-form-time-error'),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colors.error,
                  ),
                ),
              ),
            const SizedBox(height: 12),
            _locationSection(strings, theme),
            const SizedBox(height: 8),
            SwitchListTile(
              key: const ValueKey('event-form-anonymous'),
              contentPadding: EdgeInsets.zero,
              title: Text(strings.eventsFormAnonymous),
              subtitle: Text(strings.eventsAnonymousExplainer),
              value: _anonymous,
              onChanged: _submitting
                  ? null
                  : (value) => setState(() => _anonymous = value),
            ),
            TextFormField(
              key: const ValueKey('event-form-capacity'),
              controller: _capacity,
              decoration: InputDecoration(
                labelText: strings.eventsFormCapacity,
                helperText: strings.eventsFormCapacityHint,
              ),
              keyboardType: TextInputType.number,
              validator: (value) => _capacityValidator(strings, value),
            ),
            if (_serverError != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  _serverError!,
                  key: const ValueKey('event-form-server-error'),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colors.error,
                  ),
                ),
              ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: _submitting ? null : widget.onCancel,
                  child: Text(strings.eventsFormCancel),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const ValueKey('event-form-submit'),
                  onPressed: _submitting ? null : () => unawaited(_submit()),
                  child: _submitting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          _editing
                              ? strings.eventsFormSubmitSave
                              : strings.eventsFormSubmitPublish,
                        ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
