import 'dart:async';

import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/user_event_models.dart';
import 'package:melens/features/events/data/user_events_client.dart';
import 'package:melens/features/map/data/map_models.dart';

final fakeNow = DateTime.utc(2026, 10, 10, 7, 40);

UserEvent fakeEvent(
  String id, {
  String title = 'Sunset run along the Yarra',
  String description = 'Easy 5 km, all paces welcome.',
  AgentLatLng point = const AgentLatLng(lat: -37.8136, lng: 144.9631),
  String? placeName = 'Boathouse Drive steps',
  DateTime? startAt,
  DateTime? endAt,
  bool anonymousAttendance = false,
  int? capacity,
  UserEventStatus status = UserEventStatus.published,
  int attendeeCount = 0,
  bool isOwner = false,
  bool joined = false,
  int version = 1,
}) => UserEvent(
  id: id,
  title: title,
  description: description,
  point: point,
  placeName: placeName,
  startAt: startAt ?? DateTime.utc(2026, 10, 12, 7),
  endAt: endAt,
  timezone: 'Australia/Melbourne',
  anonymousAttendance: anonymousAttendance,
  capacity: capacity,
  status: status,
  attendeeCount: attendeeCount,
  createdAt: fakeNow,
  updatedAt: fakeNow,
  version: version,
  viewer: UserEventViewer(isOwner: isOwner, joined: joined),
);

AgentHttpException conflict(String reason) => AgentHttpException(
  statusCode: 409,
  retryable: false,
  code: AgentErrorCode.conflict,
  reason: reason,
);

/// An in-memory service: events keyed by id, with the viewer's uid fixed to
/// `me`. Every call is recorded; [failure] makes the next call throw.
final class FakeUserEventsClient implements UserEventsClient {
  FakeUserEventsClient([Iterable<UserEvent> events = const []]) {
    for (final event in events) {
      this.events[event.id] = event;
    }
  }

  final events = <String, UserEvent>{};
  final memberLists = <String, List<UserEventMember>>{};
  final calls = <String>[];

  /// Thrown by the next call, or by the next call whose name starts with
  /// [failOn] when set.
  Object? failure;
  String? failOn;
  MapBounds? lastBounds;
  DateTime? lastFrom;
  DateTime? lastTo;
  String? lastDisplayName;
  Map<String, dynamic>? lastPatch;
  UserEventDraft? lastDraft;

  void _record(String call) {
    calls.add(call);
    final error = failure;
    if (error != null && (failOn == null || call.startsWith(failOn!))) {
      failure = null;
      failOn = null;
      throw error;
    }
  }

  UserEvent _require(String id) {
    final event = events[id];
    if (event == null) {
      throw const AgentHttpException(
        statusCode: 404,
        retryable: false,
        code: AgentErrorCode.notFound,
      );
    }
    return event;
  }

  UserEvent _store(UserEvent event) => events[event.id] = event;

  @override
  Future<UserEvent> publish(UserEventDraft draft) async {
    _record('publish');
    lastDraft = draft;
    return _store(
      fakeEvent(
        'ue_${events.length + 1}',
        title: draft.title,
        description: draft.description,
        point: draft.point,
        placeName: draft.placeName,
        startAt: draft.startAt,
        endAt: draft.endAt,
        anonymousAttendance: draft.anonymousAttendance,
        capacity: draft.capacity,
        isOwner: true,
      ),
    );
  }

  @override
  Future<List<UserEvent>> discover(
    MapBounds bounds, {
    required DateTime from,
    required DateTime to,
  }) async {
    _record('discover');
    lastBounds = bounds;
    lastFrom = from;
    lastTo = to;
    return events.values
        .where((event) => bounds.contains(event.point.lng, event.point.lat))
        .toList()
      ..sort((a, b) => a.startAt.compareTo(b.startAt));
  }

  @override
  Future<MyUserEvents> mine() async {
    _record('mine');
    return MyUserEvents(
      owned: events.values.where((e) => e.viewer.isOwner).toList(),
      joined: events.values.where((e) => e.viewer.joined).toList(),
    );
  }

  @override
  Future<UserEvent> get(String eventId) async {
    _record('get $eventId');
    return _require(eventId);
  }

  @override
  Future<UserEvent> update(String eventId, UserEventPatch patch) async {
    _record('update $eventId');
    lastPatch = patch.toJson();
    final event = _require(eventId);
    return _store(
      fakeEvent(
        event.id,
        title: patch.title ?? event.title,
        description: patch.description ?? event.description,
        point: patch.point ?? event.point,
        placeName: patch.clearPlaceName
            ? null
            : patch.placeName ?? event.placeName,
        startAt: patch.startAt ?? event.startAt,
        endAt: patch.clearEndAt ? null : patch.endAt ?? event.endAt,
        anonymousAttendance:
            patch.anonymousAttendance ?? event.anonymousAttendance,
        capacity: patch.clearCapacity ? null : patch.capacity ?? event.capacity,
        status: event.status,
        attendeeCount: event.attendeeCount,
        isOwner: true,
        version: event.version + 1,
      ),
    );
  }

  @override
  Future<UserEvent> cancel(String eventId) async {
    _record('cancel $eventId');
    final event = _require(eventId);
    return _store(
      fakeEvent(
        event.id,
        title: event.title,
        attendeeCount: event.attendeeCount,
        status: UserEventStatus.cancelled,
        isOwner: true,
        version: event.version + 1,
      ),
    );
  }

  @override
  Future<void> remove(String eventId) async {
    _record('remove $eventId');
    _require(eventId);
    events.remove(eventId);
  }

  @override
  Future<UserEvent> join(String eventId, {String? displayName}) async {
    _record('join $eventId');
    lastDisplayName = displayName;
    final event = _require(eventId);
    if (event.viewer.joined) throw conflict('alreadyJoined');
    if (event.isCancelled) throw conflict('eventCancelled');
    if (event.isFull) throw conflict('eventFull');
    return _store(
      fakeEvent(
        event.id,
        title: event.title,
        anonymousAttendance: event.anonymousAttendance,
        capacity: event.capacity,
        attendeeCount: event.attendeeCount + 1,
        joined: true,
      ),
    );
  }

  @override
  Future<UserEvent> leave(String eventId) async {
    _record('leave $eventId');
    final event = _require(eventId);
    if (!event.viewer.joined) throw conflict('notJoined');
    return _store(
      fakeEvent(
        event.id,
        title: event.title,
        anonymousAttendance: event.anonymousAttendance,
        capacity: event.capacity,
        attendeeCount: event.attendeeCount - 1,
      ),
    );
  }

  @override
  Future<UserEventMembers> members(String eventId) async {
    _record('members $eventId');
    final event = _require(eventId);
    return UserEventMembers(
      count: event.attendeeCount,
      members: event.anonymousAttendance
          ? null
          : memberLists[eventId] ?? const [],
    );
  }

  @override
  Future<void> removeMember(String eventId, String memberId) async {
    _record('removeMember $eventId $memberId');
    final event = _require(eventId);
    memberLists[eventId]?.removeWhere((m) => m.memberId == memberId);
    _store(
      fakeEvent(
        event.id,
        title: event.title,
        attendeeCount: event.attendeeCount - 1,
        isOwner: true,
      ),
    );
  }
}
