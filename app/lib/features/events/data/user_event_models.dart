import 'package:json_annotation/json_annotation.dart';

import '../../agent/data/agent_models.dart';

part 'user_event_models.g.dart';

/// The wire models of user-published events (agent-protocol.md, User
/// events). JSON keys are camelCase, exactly as the service sends them.

/// Limits the service enforces (agent-protocol.md, User events, Rules 1);
/// the form checks them before sending.
abstract final class UserEventLimits {
  static const int titleMaxLength = 120;
  static const int descriptionMaxLength = 2000;
  static const int placeNameMaxLength = 120;
  static const int displayNameMaxLength = 40;
  static const int capacityMin = 2;
  static const int capacityMax = 1000;
  static const Duration startPastTolerance = Duration(hours: 1);
  static const Duration startMaxAhead = Duration(days: 365);
  static const Duration maxDuration = Duration(days: 7);
}

enum UserEventStatus {
  @JsonValue('published')
  published,
  @JsonValue('cancelled')
  cancelled,
}

/// What the event looks like to the caller.
@JsonSerializable()
final class UserEventViewer {
  const UserEventViewer({required this.isOwner, required this.joined});

  @JsonKey(required: true)
  final bool isOwner;

  @JsonKey(required: true)
  final bool joined;

  factory UserEventViewer.fromJson(Map<String, dynamic> json) =>
      _$UserEventViewerFromJson(json);

  Map<String, dynamic> toJson() => _$UserEventViewerToJson(this);
}

DateTime _utc(String value) => DateTime.parse(value).toUtc();

DateTime? _utcOrNull(String? value) => value == null ? null : _utc(value);

String _iso(DateTime value) => value.toUtc().toIso8601String();

String? _isoOrNull(DateTime? value) => value == null ? null : _iso(value);

/// A user-published event as every route returns it.
@JsonSerializable(explicitToJson: true)
final class UserEvent {
  const UserEvent({
    required this.id,
    required this.title,
    required this.description,
    required this.point,
    required this.placeName,
    required this.startAt,
    required this.endAt,
    required this.timezone,
    required this.anonymousAttendance,
    required this.capacity,
    required this.status,
    required this.attendeeCount,
    required this.createdAt,
    required this.updatedAt,
    required this.version,
    required this.viewer,
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true)
  final String title;

  @JsonKey(required: true)
  final String description;

  @JsonKey(required: true)
  final AgentLatLng point;

  @JsonKey(required: true)
  final String? placeName;

  /// UTC.
  @JsonKey(required: true, fromJson: _utc, toJson: _iso)
  final DateTime startAt;

  /// UTC, or null for an open end.
  @JsonKey(required: true, fromJson: _utcOrNull, toJson: _isoOrNull)
  final DateTime? endAt;

  /// Always `Australia/Melbourne`.
  @JsonKey(required: true)
  final String timezone;

  /// Only the number of people going is shown, never who.
  @JsonKey(required: true)
  final bool anonymousAttendance;

  /// Null for no limit.
  @JsonKey(required: true)
  final int? capacity;

  @JsonKey(required: true)
  final UserEventStatus status;

  @JsonKey(required: true)
  final int attendeeCount;

  @JsonKey(required: true, fromJson: _utc, toJson: _iso)
  final DateTime createdAt;

  @JsonKey(required: true, fromJson: _utc, toJson: _iso)
  final DateTime updatedAt;

  @JsonKey(required: true)
  final int version;

  @JsonKey(required: true)
  final UserEventViewer viewer;

  bool get isCancelled => status == UserEventStatus.cancelled;

  bool get isFull => capacity != null && attendeeCount >= capacity!;

  /// The event has ended: its end, or its start plus three hours, has passed.
  bool hasEndedAt(DateTime now) =>
      (endAt ?? startAt.add(const Duration(hours: 3))).isBefore(now);

  /// Whether the viewer may join now (agent-protocol.md, Rules 3).
  bool canJoinAt(DateTime now) =>
      !isCancelled &&
      !viewer.isOwner &&
      !viewer.joined &&
      !isFull &&
      !hasEndedAt(now);

  factory UserEvent.fromJson(Map<String, dynamic> json) =>
      _$UserEventFromJson(json);

  Map<String, dynamic> toJson() => _$UserEventToJson(this);

  /// What the form edits, taken from a published event.
  UserEventDraft toDraft() => UserEventDraft(
    title: title,
    description: description,
    point: point,
    placeName: placeName,
    startAt: startAt,
    endAt: endAt,
    anonymousAttendance: anonymousAttendance,
    capacity: capacity,
  );
}

/// The body of `POST /v1/events`: every field, nullable ones sent as null.
@JsonSerializable(explicitToJson: true, createFactory: false)
final class UserEventDraft {
  const UserEventDraft({
    required this.title,
    required this.description,
    required this.point,
    required this.startAt,
    this.placeName,
    this.endAt,
    this.anonymousAttendance = false,
    this.capacity,
  });

  final String title;
  final String description;
  final AgentLatLng point;
  final String? placeName;

  @JsonKey(toJson: _iso)
  final DateTime startAt;

  @JsonKey(toJson: _isoOrNull)
  final DateTime? endAt;

  final bool anonymousAttendance;
  final int? capacity;

  Map<String, dynamic> toJson() => _$UserEventDraftToJson(this);

  /// The fields that differ from [previous], as a `PATCH` body; empty when
  /// nothing changed.
  UserEventPatch diff(UserEventDraft previous) => UserEventPatch(
    title: title == previous.title ? null : title,
    description: description == previous.description ? null : description,
    point: point.lat == previous.point.lat && point.lng == previous.point.lng
        ? null
        : point,
    placeName: placeName == previous.placeName ? null : placeName,
    clearPlaceName: placeName == null && previous.placeName != null,
    startAt: startAt.isAtSameMomentAs(previous.startAt) ? null : startAt,
    endAt: _sameInstant(endAt, previous.endAt) ? null : endAt,
    clearEndAt: endAt == null && previous.endAt != null,
    anonymousAttendance: anonymousAttendance == previous.anonymousAttendance
        ? null
        : anonymousAttendance,
    capacity: capacity == previous.capacity ? null : capacity,
    clearCapacity: capacity == null && previous.capacity != null,
  );
}

bool _sameInstant(DateTime? a, DateTime? b) =>
    a == null || b == null ? a == b : a.isAtSameMomentAs(b);

/// The body of `PATCH /v1/events/{eventId}`: only the fields given, with
/// `placeName`, `endAt` and `capacity` set to null when cleared.
final class UserEventPatch {
  const UserEventPatch({
    this.title,
    this.description,
    this.point,
    this.placeName,
    this.clearPlaceName = false,
    this.startAt,
    this.endAt,
    this.clearEndAt = false,
    this.anonymousAttendance,
    this.capacity,
    this.clearCapacity = false,
  });

  final String? title;
  final String? description;
  final AgentLatLng? point;
  final String? placeName;
  final bool clearPlaceName;
  final DateTime? startAt;
  final DateTime? endAt;
  final bool clearEndAt;
  final bool? anonymousAttendance;
  final int? capacity;
  final bool clearCapacity;

  bool get isEmpty => toJson().isEmpty;

  Map<String, dynamic> toJson() => {
    if (title != null) 'title': title,
    if (description != null) 'description': description,
    if (point != null) 'point': point!.toJson(),
    if (placeName != null || clearPlaceName) 'placeName': placeName,
    if (startAt != null) 'startAt': _iso(startAt!),
    if (endAt != null || clearEndAt) 'endAt': _isoOrNull(endAt),
    if (anonymousAttendance != null) 'anonymousAttendance': anonymousAttendance,
    if (capacity != null || clearCapacity) 'capacity': capacity,
  };
}

/// One member, as the owner sees it: never a uid.
@JsonSerializable()
final class UserEventMember {
  const UserEventMember({
    required this.memberId,
    required this.displayName,
    required this.joinedAt,
  });

  @JsonKey(required: true)
  final String memberId;

  /// Null for a member who gave no name (shown as a guest).
  @JsonKey(required: true)
  final String? displayName;

  @JsonKey(required: true, fromJson: _utc, toJson: _iso)
  final DateTime joinedAt;

  factory UserEventMember.fromJson(Map<String, dynamic> json) =>
      _$UserEventMemberFromJson(json);

  Map<String, dynamic> toJson() => _$UserEventMemberToJson(this);
}

/// `GET /v1/events/{eventId}/members`: `members` is null for an anonymous
/// event.
@JsonSerializable(explicitToJson: true)
final class UserEventMembers {
  const UserEventMembers({required this.count, required this.members});

  @JsonKey(required: true)
  final int count;

  @JsonKey(required: true)
  final List<UserEventMember>? members;

  factory UserEventMembers.fromJson(Map<String, dynamic> json) =>
      _$UserEventMembersFromJson(json);

  Map<String, dynamic> toJson() => _$UserEventMembersToJson(this);
}

/// `GET /v1/events/mine`.
@JsonSerializable(explicitToJson: true)
final class MyUserEvents {
  const MyUserEvents({required this.owned, required this.joined});

  const MyUserEvents.empty() : this(owned: const [], joined: const []);

  @JsonKey(required: true)
  final List<UserEvent> owned;

  @JsonKey(required: true)
  final List<UserEvent> joined;

  factory MyUserEvents.fromJson(Map<String, dynamic> json) =>
      _$MyUserEventsFromJson(json);

  Map<String, dynamic> toJson() => _$MyUserEventsToJson(this);
}
