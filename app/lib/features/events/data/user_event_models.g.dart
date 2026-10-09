// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'user_event_models.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UserEventViewer _$UserEventViewerFromJson(Map<String, dynamic> json) =>
    $checkedCreate('UserEventViewer', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['isOwner', 'joined']);
      final val = UserEventViewer(
        isOwner: $checkedConvert('isOwner', (v) => v as bool),
        joined: $checkedConvert('joined', (v) => v as bool),
      );
      return val;
    });

Map<String, dynamic> _$UserEventViewerToJson(UserEventViewer instance) =>
    <String, dynamic>{'isOwner': instance.isOwner, 'joined': instance.joined};

UserEvent _$UserEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('UserEvent', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'title',
          'description',
          'point',
          'placeName',
          'startAt',
          'endAt',
          'timezone',
          'anonymousAttendance',
          'capacity',
          'status',
          'attendeeCount',
          'createdAt',
          'updatedAt',
          'version',
          'viewer',
        ],
      );
      final val = UserEvent(
        id: $checkedConvert('id', (v) => v as String),
        title: $checkedConvert('title', (v) => v as String),
        description: $checkedConvert('description', (v) => v as String),
        point: $checkedConvert(
          'point',
          (v) => AgentLatLng.fromJson(v as Map<String, dynamic>),
        ),
        placeName: $checkedConvert('placeName', (v) => v as String?),
        startAt: $checkedConvert('startAt', (v) => _utc(v as String)),
        endAt: $checkedConvert('endAt', (v) => _utcOrNull(v as String?)),
        timezone: $checkedConvert('timezone', (v) => v as String),
        anonymousAttendance: $checkedConvert(
          'anonymousAttendance',
          (v) => v as bool,
        ),
        capacity: $checkedConvert('capacity', (v) => (v as num?)?.toInt()),
        status: $checkedConvert(
          'status',
          (v) => $enumDecode(_$UserEventStatusEnumMap, v),
        ),
        attendeeCount: $checkedConvert(
          'attendeeCount',
          (v) => (v as num).toInt(),
        ),
        createdAt: $checkedConvert('createdAt', (v) => _utc(v as String)),
        updatedAt: $checkedConvert('updatedAt', (v) => _utc(v as String)),
        version: $checkedConvert('version', (v) => (v as num).toInt()),
        viewer: $checkedConvert(
          'viewer',
          (v) => UserEventViewer.fromJson(v as Map<String, dynamic>),
        ),
      );
      return val;
    });

Map<String, dynamic> _$UserEventToJson(UserEvent instance) => <String, dynamic>{
  'id': instance.id,
  'title': instance.title,
  'description': instance.description,
  'point': instance.point.toJson(),
  'placeName': instance.placeName,
  'startAt': _iso(instance.startAt),
  'endAt': _isoOrNull(instance.endAt),
  'timezone': instance.timezone,
  'anonymousAttendance': instance.anonymousAttendance,
  'capacity': instance.capacity,
  'status': _$UserEventStatusEnumMap[instance.status]!,
  'attendeeCount': instance.attendeeCount,
  'createdAt': _iso(instance.createdAt),
  'updatedAt': _iso(instance.updatedAt),
  'version': instance.version,
  'viewer': instance.viewer.toJson(),
};

const _$UserEventStatusEnumMap = {
  UserEventStatus.published: 'published',
  UserEventStatus.cancelled: 'cancelled',
};

Map<String, dynamic> _$UserEventDraftToJson(UserEventDraft instance) =>
    <String, dynamic>{
      'title': instance.title,
      'description': instance.description,
      'point': instance.point.toJson(),
      'placeName': instance.placeName,
      'startAt': _iso(instance.startAt),
      'endAt': _isoOrNull(instance.endAt),
      'anonymousAttendance': instance.anonymousAttendance,
      'capacity': instance.capacity,
    };

UserEventMember _$UserEventMemberFromJson(Map<String, dynamic> json) =>
    $checkedCreate('UserEventMember', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['memberId', 'displayName', 'joinedAt'],
      );
      final val = UserEventMember(
        memberId: $checkedConvert('memberId', (v) => v as String),
        displayName: $checkedConvert('displayName', (v) => v as String?),
        joinedAt: $checkedConvert('joinedAt', (v) => _utc(v as String)),
      );
      return val;
    });

Map<String, dynamic> _$UserEventMemberToJson(UserEventMember instance) =>
    <String, dynamic>{
      'memberId': instance.memberId,
      'displayName': instance.displayName,
      'joinedAt': _iso(instance.joinedAt),
    };

UserEventMembers _$UserEventMembersFromJson(Map<String, dynamic> json) =>
    $checkedCreate('UserEventMembers', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['count', 'members']);
      final val = UserEventMembers(
        count: $checkedConvert('count', (v) => (v as num).toInt()),
        members: $checkedConvert(
          'members',
          (v) => (v as List<dynamic>?)
              ?.map((e) => UserEventMember.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
      );
      return val;
    });

Map<String, dynamic> _$UserEventMembersToJson(UserEventMembers instance) =>
    <String, dynamic>{
      'count': instance.count,
      'members': instance.members?.map((e) => e.toJson()).toList(),
    };

MyUserEvents _$MyUserEventsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('MyUserEvents', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['owned', 'joined']);
      final val = MyUserEvents(
        owned: $checkedConvert(
          'owned',
          (v) => (v as List<dynamic>)
              .map((e) => UserEvent.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        joined: $checkedConvert(
          'joined',
          (v) => (v as List<dynamic>)
              .map((e) => UserEvent.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
      );
      return val;
    });

Map<String, dynamic> _$MyUserEventsToJson(MyUserEvents instance) =>
    <String, dynamic>{
      'owned': instance.owned.map((e) => e.toJson()).toList(),
      'joined': instance.joined.map((e) => e.toJson()).toList(),
    };
