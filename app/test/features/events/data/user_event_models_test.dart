import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/user_event_models.dart';

const eventJson = <String, dynamic>{
  'id': 'ue_1',
  'title': 'Sunset run along the Yarra',
  'description': 'Easy 5 km, all paces welcome.',
  'point': {'lat': -37.8206, 'lng': 144.9775},
  'placeName': 'Boathouse Drive steps',
  'startAt': '2026-10-12T07:00:00.000Z',
  'endAt': '2026-10-12T08:00:00.000Z',
  'timezone': 'Australia/Melbourne',
  'anonymousAttendance': true,
  'capacity': 20,
  'status': 'published',
  'attendeeCount': 3,
  'createdAt': '2026-10-10T02:15:00.000Z',
  'updatedAt': '2026-10-10T02:15:00.000Z',
  'version': 1,
  'viewer': {'isOwner': false, 'joined': true},
};

void main() {
  test('an event decodes with UTC instants and encodes back the same', () {
    final event = UserEvent.fromJson(eventJson);
    expect(event.startAt, DateTime.utc(2026, 10, 12, 7));
    expect(event.startAt.isUtc, isTrue);
    expect(event.endAt, DateTime.utc(2026, 10, 12, 8));
    expect(event.status, UserEventStatus.published);
    expect(event.viewer.joined, isTrue);
    expect(event.toJson(), eventJson);
  });

  test('an event with no end, capacity or place decodes', () {
    final event = UserEvent.fromJson({
      ...eventJson,
      'endAt': null,
      'capacity': null,
      'placeName': null,
      'status': 'cancelled',
    });
    expect(event.endAt, isNull);
    expect(event.capacity, isNull);
    expect(event.isCancelled, isTrue);
    expect(event.isFull, isFalse);
    expect(event.hasEndedAt(DateTime.utc(2026, 10, 12, 9, 59)), isFalse);
    expect(event.hasEndedAt(DateTime.utc(2026, 10, 12, 10, 1)), isTrue);
  });

  test('a required field that is missing is a decode error', () {
    final json = Map<String, dynamic>.of(eventJson)..remove('viewer');
    expect(() => UserEvent.fromJson(json), throwsA(isA<Object>()));
  });

  test('canJoinAt follows the service rules', () {
    final now = DateTime.utc(2026, 10, 10, 8);
    final open = UserEvent.fromJson({
      ...eventJson,
      'viewer': {'isOwner': false, 'joined': false},
    });
    expect(open.canJoinAt(now), isTrue);
    expect(
      UserEvent.fromJson({
        ...eventJson,
        'viewer': {'isOwner': true, 'joined': false},
      }).canJoinAt(now),
      isFalse,
      reason: 'the owner cannot join',
    );
    expect(
      UserEvent.fromJson({
        ...eventJson,
        'attendeeCount': 20,
        'viewer': {'isOwner': false, 'joined': false},
      }).canJoinAt(now),
      isFalse,
      reason: 'full',
    );
    expect(
      open.canJoinAt(DateTime.utc(2026, 10, 12, 9)),
      isFalse,
      reason: 'ended',
    );
  });

  test('a draft sends every field, nullable ones as null', () {
    final draft = UserEventDraft(
      title: 'Walk',
      description: '',
      point: const AgentLatLng(lat: -37.81, lng: 144.96),
      startAt: DateTime.utc(2026, 10, 12, 7),
    );
    expect(draft.toJson(), {
      'title': 'Walk',
      'description': '',
      'point': {'lat': -37.81, 'lng': 144.96},
      'placeName': null,
      'startAt': '2026-10-12T07:00:00.000Z',
      'endAt': null,
      'anonymousAttendance': false,
      'capacity': null,
    });
  });

  test('a patch carries only the changed fields and nulls cleared ones', () {
    final event = UserEvent.fromJson(eventJson);
    final previous = event.toDraft();
    final edited = UserEventDraft(
      title: 'Sunset run',
      description: previous.description,
      point: previous.point,
      startAt: previous.startAt,
      anonymousAttendance: previous.anonymousAttendance,
      capacity: 25,
    );
    final patch = edited.diff(previous);
    expect(patch.isEmpty, isFalse);
    expect(patch.toJson(), {
      'title': 'Sunset run',
      'placeName': null,
      'endAt': null,
      'capacity': 25,
    });
    expect(previous.diff(previous).isEmpty, isTrue);
    expect(previous.diff(previous).toJson(), isEmpty);
  });

  test('the members page allows a null list for an anonymous event', () {
    final page = UserEventMembers.fromJson({'count': 4, 'members': null});
    expect(page.count, 4);
    expect(page.members, isNull);
    final named = UserEventMembers.fromJson({
      'count': 1,
      'members': [
        {
          'memberId': 'm_1',
          'displayName': null,
          'joinedAt': '2026-10-10T02:15:00.000Z',
        },
      ],
    });
    expect(named.members!.single.displayName, isNull);
    expect(named.members!.single.joinedAt, DateTime.utc(2026, 10, 10, 2, 15));
  });
}
