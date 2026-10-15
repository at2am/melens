import 'user_event.dart';

/// Reads and writes user events. Today only [InMemoryUserEventRepository]
/// implements it. The production store is Firestore behind the agent service
/// (AGENTS.md: the app never reaches Firestore directly), which needs a
/// publish/join endpoint that does not exist yet; this interface is the seam.
abstract interface class UserEventRepository {
  Future<List<UserEvent>> list();

  Future<UserEvent> publish(UserEventDraft draft, UserProfile host);

  /// Joins or leaves. Throws [EventFullException] when joining a full event
  /// and [EventUnavailableException] for a cancelled or finished one.
  Future<UserEvent> setGoing(String eventId, UserProfile user, bool going);

  Future<UserEvent> cancel(String eventId, UserProfile host);
}

class EventFullException implements Exception {
  const EventFullException();
}

class EventUnavailableException implements Exception {
  const EventUnavailableException();
}

class EventNotAllowedException implements Exception {
  const EventNotAllowedException();
}

class EventNotFoundException implements Exception {
  const EventNotFoundException();
}

/// Keeps events for the life of the app run. Nothing is persisted.
final class InMemoryUserEventRepository implements UserEventRepository {
  InMemoryUserEventRepository({
    List<UserEvent> seed = const [],
    this._now = DateTime.now,
  }) : _events = [...seed];

  final List<UserEvent> _events;
  final DateTime Function() _now;
  int _sequence = 0;

  @override
  Future<List<UserEvent>> list() async => List.unmodifiable(_events);

  @override
  Future<UserEvent> publish(UserEventDraft draft, UserProfile host) async {
    final event = UserEvent(
      id: 'user-event-${++_sequence}',
      title: draft.title,
      description: draft.description,
      category: draft.category,
      startAt: draft.startAt,
      endAt: draft.endAt,
      place: draft.place,
      visibility: draft.visibility,
      hostId: host.id,
      hostName: host.displayName,
      createdAt: _now().toUtc(),
      capacity: draft.capacity,
      attendees: {host.id},
    );
    _events.add(event);
    return event;
  }

  @override
  Future<UserEvent> setGoing(
    String eventId,
    UserProfile user,
    bool going,
  ) async {
    final index = _indexOf(eventId);
    final event = _events[index];
    if (event.cancelled || event.hasEnded(_now())) {
      throw const EventUnavailableException();
    }
    final attendees = {...event.attendees};
    if (going) {
      if (!attendees.contains(user.id) && event.isFull) {
        throw const EventFullException();
      }
      attendees.add(user.id);
    } else {
      // The host stays on their own event; they cancel it instead.
      if (event.isHostedBy(user.id)) throw const EventNotAllowedException();
      attendees.remove(user.id);
    }
    return _events[index] = event.copyWith(attendees: attendees);
  }

  @override
  Future<UserEvent> cancel(String eventId, UserProfile host) async {
    final index = _indexOf(eventId);
    if (!_events[index].isHostedBy(host.id)) {
      throw const EventNotAllowedException();
    }
    return _events[index] = _events[index].copyWith(cancelled: true);
  }

  int _indexOf(String id) {
    final index = _events.indexWhere((event) => event.id == id);
    if (index < 0) throw const EventNotFoundException();
    return index;
  }
}

/// Demo events for development builds, labelled as samples in the UI.
List<UserEvent> sampleUserEvents(DateTime now) {
  DateTime at(int days, int hour) {
    final day = now.toUtc().add(Duration(days: days));
    return DateTime.utc(day.year, day.month, day.day, hour);
  }

  UserEvent make(
    String id,
    String title,
    String description,
    EventCategory category,
    DateTime start,
    EventPlace place,
    String host, {
    int? capacity,
    int going = 3,
  }) => UserEvent(
    id: id,
    title: title,
    description: description,
    category: category,
    startAt: start,
    endAt: start.add(const Duration(hours: 2)),
    place: place,
    visibility: EventVisibility.public,
    hostId: 'sample-$id',
    hostName: host,
    createdAt: now.toUtc(),
    capacity: capacity,
    attendees: {for (var i = 0; i < going; i++) 'sample-$id-$i'},
    isSample: true,
  );

  return [
    make(
      'sample-1',
      'Sunset sketching on the river',
      'Bring a notebook and a pencil. We sketch the skyline as the light '
          'changes, then compare drawings over a drink.',
      EventCategory.arts,
      at(1, 7),
      melbournePlaces[6],
      'Mia',
      capacity: 12,
    ),
    make(
      'sample-2',
      'Laneway acoustic night',
      'Three local players, no stage, one lane. Free, donations welcome.',
      EventCategory.music,
      at(2, 8),
      melbournePlaces[0],
      'Jordan',
      going: 8,
    ),
    make(
      'sample-3',
      'Market breakfast walk',
      'A slow loop through the market stalls, ending with the best jam '
          'doughnut we can find.',
      EventCategory.food,
      at(3, 22),
      melbournePlaces[2],
      'Priya',
      capacity: 8,
      going: 5,
    ),
  ];
}
