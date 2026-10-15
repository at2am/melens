import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/events/data/event_invite.dart';
import 'package:melens/features/events/data/user_event.dart';
import 'package:melens/features/events/data/user_event_repository.dart';

final _now = DateTime.utc(2026, 10, 18);
const _host = UserProfile(id: 'host', displayName: 'Hana');
const _guest = UserProfile(id: 'guest', displayName: 'Gus');

UserEventDraft draft({int? capacity, Duration startsIn = const Duration(days: 1)}) =>
    UserEventDraft(
      title: 'Picnic',
      description: 'Bring food',
      category: EventCategory.food,
      startAt: _now.add(startsIn),
      endAt: _now.add(startsIn + const Duration(hours: 2)),
      place: melbournePlaces.first,
      visibility: EventVisibility.public,
      capacity: capacity,
    );

void main() {
  late InMemoryUserEventRepository repository;
  var now = _now;

  setUp(() {
    now = _now;
    repository = InMemoryUserEventRepository(now: () => now);
  });

  test('publishing makes the host the first guest', () async {
    final event = await repository.publish(draft(), _host);
    expect(event.hostId, 'host');
    expect(event.hostName, 'Hana');
    expect(event.attendees, {'host'});
    expect(await repository.list(), [event]);
  });

  test('guests join and leave', () async {
    final event = await repository.publish(draft(), _host);
    final joined = await repository.setGoing(event.id, _guest, true);
    expect(joined.goingCount, 2);
    expect(joined.isGoing('guest'), isTrue);
    final left = await repository.setGoing(event.id, _guest, false);
    expect(left.goingCount, 1);
  });

  test('a full event refuses new guests but keeps the ones it has', () async {
    final event = await repository.publish(draft(capacity: 2), _host);
    await repository.setGoing(event.id, _guest, true);
    await expectLater(
      repository.setGoing(
        event.id,
        const UserProfile(id: 'late', displayName: 'Lee'),
        true,
      ),
      throwsA(isA<EventFullException>()),
    );
    // Joining again is not a new guest.
    expect((await repository.setGoing(event.id, _guest, true)).goingCount, 2);
  });

  test('the host cannot leave; they cancel instead', () async {
    final event = await repository.publish(draft(), _host);
    await expectLater(
      repository.setGoing(event.id, _host, false),
      throwsA(isA<EventNotAllowedException>()),
    );
    await expectLater(
      repository.cancel(event.id, _guest),
      throwsA(isA<EventNotAllowedException>()),
    );
    final cancelled = await repository.cancel(event.id, _host);
    expect(cancelled.cancelled, isTrue);
    await expectLater(
      repository.setGoing(event.id, _guest, true),
      throwsA(isA<EventUnavailableException>()),
    );
  });

  test('a finished event is closed', () async {
    final event = await repository.publish(draft(), _host);
    now = _now.add(const Duration(days: 3));
    await expectLater(
      repository.setGoing(event.id, _guest, true),
      throwsA(isA<EventUnavailableException>()),
    );
  });

  test('an unknown event is reported', () async {
    await expectLater(
      repository.setGoing('nope', _guest, true),
      throwsA(isA<EventNotFoundException>()),
    );
  });

  test('sample events are labelled and in the future', () {
    final samples = sampleUserEvents(_now);
    expect(samples, isNotEmpty);
    expect(samples.every((event) => event.isSample), isTrue);
    expect(samples.every((event) => event.startAt.isAfter(_now)), isTrue);
  });

  group('invites', () {
    test('the link points at the event page on the app origin', () async {
      final event = await repository.publish(draft(), _host);
      expect(
        eventInviteLink(Uri.parse('https://melens.example'), event),
        Uri.parse('https://melens.example/events/${event.id}'),
      );
      expect(eventInviteLink(null, event), isNull);
    });
  });
}
