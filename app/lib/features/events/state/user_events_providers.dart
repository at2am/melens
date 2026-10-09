import 'dart:async';
import 'dart:math' as math;

import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/network/http_client.dart';
import '../../../core/time/melbourne_time.dart';
import '../../agent/data/agent_models.dart';
import '../../agent/state/agent_providers.dart';
import '../../map/data/map_models.dart';
import '../../map/state/viewport_controller.dart';
import '../data/place_search.dart';
import '../data/user_event_models.dart';
import '../data/user_events_client.dart';

part 'user_events_providers.g.dart';

/// Tests override this with a scripted [UserEventsClient].
@Riverpod(keepAlive: true)
UserEventsClient userEventsClient(Ref ref) => HttpUserEventsClient(
  client: ref.watch(httpClientProvider),
  baseUrl: ref.watch(envProvider).agentBaseUrl,
  tokenSource: ref.watch(agentTokenSourceProvider),
);

/// How far ahead "nearby" looks (agent-protocol.md, User events: the
/// service's own default).
const nearbyUserEventsHorizon = Duration(days: 14);

/// The longest side the discover route accepts is 10 km; a wider map view is
/// cut down around its centre so the request stays valid.
const _maxSideKm = 9.5;
const _kmPerDegreeLat = 111.32;

/// The box the nearby list searches: the map's bounded viewport, shrunk to
/// the discover route's limit around its centre. Null until the map has a
/// viewport. Tests override it.
@riverpod
MapBounds? userEventSearchBounds(Ref ref) {
  final bbox = ref.watch(viewportControllerProvider).bbox;
  return bbox == null ? null : clampSearchBounds(bbox);
}

bool sameBounds(MapBounds? a, MapBounds? b) => a == null || b == null
    ? a == b
    : a.west == b.west &&
          a.south == b.south &&
          a.east == b.east &&
          a.north == b.north;

MapBounds clampSearchBounds(MapBounds bbox) {
  final centreLat = (bbox.north + bbox.south) / 2;
  final centreLng = (bbox.east + bbox.west) / 2;
  final maxLat = _maxSideKm / _kmPerDegreeLat;
  final maxLng =
      _maxSideKm / (_kmPerDegreeLat * math.cos(centreLat * math.pi / 180));
  final halfLat = math.min(bbox.north - bbox.south, maxLat) / 2;
  final halfLng = math.min(bbox.east - bbox.west, maxLng) / 2;
  return MapBounds(
    west: centreLng - halfLng,
    south: centreLat - halfLat,
    east: centreLng + halfLng,
    north: centreLat + halfLat,
  );
}

final class NearbyUserEventsState {
  const NearbyUserEventsState({
    this.events = const [],
    this.isLoading = false,
    this.error,
    this.bounds,
    this.hasLoaded = false,
  });

  /// Soonest first, as the service orders them.
  final List<UserEvent> events;
  final bool isLoading;
  final Object? error;

  /// The box the events were loaded for.
  final MapBounds? bounds;
  final bool hasLoaded;

  NearbyUserEventsState _with({
    List<UserEvent>? events,
    bool? isLoading,
    Object? error,
    bool clearError = false,
    MapBounds? bounds,
    bool? hasLoaded,
  }) => NearbyUserEventsState(
    events: events ?? this.events,
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : error ?? this.error,
    bounds: bounds ?? this.bounds,
    hasLoaded: hasLoaded ?? this.hasLoaded,
  );
}

/// The user events near the map's viewport. It loads while the events panel
/// is open, following the viewport with a debounce, and keeps the last list
/// when the panel closes so the markers stay.
@Riverpod(keepAlive: true)
class NearbyUserEventsController extends _$NearbyUserEventsController {
  static final _log = Logger('NearbyUserEvents');
  static const _debounce = Duration(milliseconds: 600);

  Timer? _pending;
  int _generation = 0;
  bool _active = false;

  @override
  NearbyUserEventsState build() {
    ref.listen(userEventSearchBoundsProvider, (previous, next) {
      if (!_active || next == null || sameBounds(previous, next)) return;
      _pending?.cancel();
      _pending = Timer(_debounce, () => unawaited(refresh()));
    });
    ref.onDispose(() => _pending?.cancel());
    return const NearbyUserEventsState();
  }

  /// The panel is open: load now and follow the viewport until [setActive]
  /// is called with false.
  void setActive(bool active) {
    _active = active;
    if (active) {
      unawaited(refresh());
    } else {
      _pending?.cancel();
    }
  }

  Future<void> refresh() async {
    _pending?.cancel();
    final bounds = ref.read(userEventSearchBoundsProvider);
    final generation = ++_generation;
    if (bounds == null) {
      state = const NearbyUserEventsState(hasLoaded: true);
      return;
    }
    state = state._with(isLoading: true, clearError: true);
    final now = ref.read(melbourneClockProvider).now().toUtc();
    try {
      final events = await ref
          .read(userEventsClientProvider)
          .discover(bounds, from: now, to: now.add(nearbyUserEventsHorizon));
      if (generation != _generation) return;
      state = NearbyUserEventsState(
        events: events,
        bounds: bounds,
        hasLoaded: true,
      );
    } on Object catch (error, stack) {
      if (generation != _generation) return;
      _log.warning('Nearby user events failed', error, stack);
      state = state._with(isLoading: false, error: error, hasLoaded: true);
    }
  }

  /// A changed event replaces its copy in the list, or joins it when the
  /// list's box contains it.
  void upsert(UserEvent event) {
    final events = List.of(state.events);
    final index = events.indexWhere((e) => e.id == event.id);
    if (index >= 0) {
      events[index] = event;
    } else if (state.bounds?.contains(event.point.lng, event.point.lat) ??
        false) {
      events.add(event);
      events.sort((a, b) => a.startAt.compareTo(b.startAt));
    } else {
      return;
    }
    state = state._with(events: List.unmodifiable(events));
  }

  void forget(String eventId) {
    if (!state.events.any((e) => e.id == eventId)) return;
    state = state._with(
      events: List.unmodifiable(state.events.where((e) => e.id != eventId)),
    );
  }

  UserEvent? find(String eventId) {
    for (final event in state.events) {
      if (event.id == eventId) return event;
    }
    return null;
  }
}

/// The caller's own and joined events.
@Riverpod(keepAlive: true)
class MyUserEventsController extends _$MyUserEventsController {
  @override
  Future<MyUserEvents> build() => ref.read(userEventsClientProvider).mine();

  Future<void> refresh() async {
    // Assigning a loading state keeps the previous data behind it.
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(userEventsClientProvider).mine(),
    );
  }

  /// Publishes a new event and lists it at once, here and nearby.
  Future<UserEvent> publish(UserEventDraft draft) async {
    final event = await ref.read(userEventsClientProvider).publish(draft);
    upsert(event);
    ref.read(nearbyUserEventsControllerProvider.notifier).upsert(event);
    return event;
  }

  /// A changed event moves to the list its viewer flags put it in.
  void upsert(UserEvent event) {
    final current = state.value;
    if (current == null) return;
    List<UserEvent> place(List<UserEvent> list, bool belongs) {
      final kept = list.where((e) => e.id != event.id).toList();
      if (belongs) {
        kept
          ..add(event)
          ..sort((a, b) => a.startAt.compareTo(b.startAt));
      }
      return List.unmodifiable(kept);
    }

    state = AsyncData(
      MyUserEvents(
        owned: place(current.owned, event.viewer.isOwner),
        joined: place(current.joined, event.viewer.joined),
      ),
    );
  }

  void forget(String eventId) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(
      MyUserEvents(
        owned: List.unmodifiable(current.owned.where((e) => e.id != eventId)),
        joined: List.unmodifiable(current.joined.where((e) => e.id != eventId)),
      ),
    );
  }

  UserEvent? find(String eventId) {
    for (final event in [...?state.value?.owned, ...?state.value?.joined]) {
      if (event.id == eventId) return event;
    }
    return null;
  }
}

/// One event's details and the actions on it. Every successful action
/// updates this state and the lists, so the panel never shows a stale copy.
@riverpod
class UserEventDetailController extends _$UserEventDetailController {
  @override
  Future<UserEvent> build(String eventId) async {
    final cached =
        ref.read(nearbyUserEventsControllerProvider.notifier).find(eventId) ??
        ref.read(myUserEventsControllerProvider.notifier).find(eventId);
    if (cached != null) {
      // Show the copy at hand and fetch the live one behind it.
      unawaited(_refetch());
      return cached;
    }
    return ref.read(userEventsClientProvider).get(eventId);
  }

  Future<void> _refetch() async {
    try {
      _apply(await ref.read(userEventsClientProvider).get(eventId));
    } on Object {
      // The cached copy stands; the next action reports its own error.
    }
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(userEventsClientProvider).get(eventId),
    );
    final event = state.value;
    if (event != null) _share(event);
  }

  Future<UserEvent> join({String? displayName}) =>
      _act((client) => client.join(eventId, displayName: displayName));

  Future<UserEvent> leave() => _act((client) => client.leave(eventId));

  Future<UserEvent> cancel() => _act((client) => client.cancel(eventId));

  /// Owner only: saves the changed fields.
  Future<UserEvent> edit(UserEventPatch patch) =>
      _act((client) => client.update(eventId, patch));

  /// The event is gone afterwards; the caller leaves its details.
  Future<void> remove() async {
    await ref.read(userEventsClientProvider).remove(eventId);
    ref.read(nearbyUserEventsControllerProvider.notifier).forget(eventId);
    ref.read(myUserEventsControllerProvider.notifier).forget(eventId);
  }

  /// Runs one action; a failure propagates to the caller while the shown
  /// event stays.
  Future<UserEvent> _act(
    Future<UserEvent> Function(UserEventsClient) action,
  ) async {
    // The first load must finish before the state can be replaced.
    try {
      await future;
    } on Object {
      // A failed load does not stop the action; it reports for itself.
    }
    final event = await action(ref.read(userEventsClientProvider));
    _apply(event);
    return event;
  }

  void _apply(UserEvent event) {
    state = AsyncData(event);
    _share(event);
  }

  void _share(UserEvent event) {
    ref.read(nearbyUserEventsControllerProvider.notifier).upsert(event);
    ref.read(myUserEventsControllerProvider.notifier).upsert(event);
  }
}

/// The members of one event, for its owner. Null `members` means the event
/// is anonymous and only the count is known.
@riverpod
class UserEventMembersController extends _$UserEventMembersController {
  @override
  Future<UserEventMembers> build(String eventId) =>
      ref.read(userEventsClientProvider).members(eventId);

  Future<void> removeMember(String memberId) async {
    await ref.read(userEventsClientProvider).removeMember(eventId, memberId);
    final current = state.value;
    if (current != null) {
      state = AsyncData(
        UserEventMembers(
          count: math.max(0, current.count - 1),
          members: current.members == null
              ? null
              : List.unmodifiable(
                  current.members!.where((m) => m.memberId != memberId),
                ),
        ),
      );
    }
    await ref
        .read(userEventDetailControllerProvider(eventId).notifier)
        .refresh();
  }
}

/// The name the user last joined with, kept for the session so the next
/// join offers it again.
@Riverpod(keepAlive: true)
class UserEventDisplayName extends _$UserEventDisplayName {
  @override
  String? build() => null;

  void remember(String? name) {
    final trimmed = name?.trim();
    state = trimmed == null || trimmed.isEmpty ? null : trimmed;
  }
}

/// The event the panel should show, set when a marker on the map is tapped;
/// null once the panel took it.
@Riverpod(keepAlive: true)
class OpenUserEvent extends _$OpenUserEvent {
  @override
  String? build() => null;

  void open(String eventId) => state = eventId;

  void clear() => state = null;
}

/// Address and place search for the form: Google Places on the Web when the
/// build has a browser Maps key, unavailable otherwise. Tests override it.
@Riverpod(keepAlive: true)
PlaceSearch placeSearch(Ref ref) {
  final search = const GooglePlaceSearch();
  return ref.watch(envProvider).hasGoogleMapsWebApiKey && search.isAvailable
      ? search
      : const UnavailablePlaceSearch();
}

/// Picking the event's pin on the map: the form starts it, the map screen
/// shows a banner and hands the next tap back, the form takes the point.
final class UserEventPinPickerState {
  const UserEventPinPickerState({this.active = false, this.picked});

  final bool active;

  /// The tapped point, until the form takes it.
  final AgentLatLng? picked;
}

@Riverpod(keepAlive: true)
class UserEventPinPicker extends _$UserEventPinPicker {
  @override
  UserEventPinPickerState build() => const UserEventPinPickerState();

  void start() => state = const UserEventPinPickerState(active: true);

  void cancel() => state = const UserEventPinPickerState();

  void place(AgentLatLng point) =>
      state = UserEventPinPickerState(picked: point);

  /// The picked point, cleared; null when none was picked.
  AgentLatLng? take() {
    final picked = state.picked;
    if (picked != null) state = const UserEventPinPickerState();
    return picked;
  }
}

/// What the form holds while the sheet that hosts it is closed to pick a pin
/// on the map (a narrow window covers the map with the sheet). The panel
/// reopens on the form and the form restores these fields.
final class UserEventFormSnapshot {
  const UserEventFormSnapshot({
    required this.editing,
    required this.title,
    required this.description,
    required this.placeName,
    required this.start,
    required this.end,
    required this.anonymous,
    required this.capacity,
    required this.point,
  });

  /// The event being edited, or null for a new one.
  final UserEvent? editing;
  final String title;
  final String description;
  final String placeName;
  final DateTime start;
  final DateTime? end;
  final bool anonymous;
  final String capacity;
  final AgentLatLng point;
}

@Riverpod(keepAlive: true)
class UserEventFormDraft extends _$UserEventFormDraft {
  @override
  UserEventFormSnapshot? build() => null;

  void keep(UserEventFormSnapshot snapshot) => state = snapshot;

  /// The snapshot, cleared.
  UserEventFormSnapshot? take() {
    final snapshot = state;
    if (snapshot != null) state = null;
    return snapshot;
  }
}
