/// A user-published event (UC-09): what it is, when, where and who is going.
///
/// Times are UTC instants; the UI shows them in Melbourne time through
/// `MelbourneClock`. The model is plain Dart so that the same shape can later
/// be stored by the agent service's Firestore access without the app knowing.
library;

enum EventCategory { music, arts, food, sport, outdoors, community, other }

/// Who can find the event.
enum EventVisibility {
  /// On the map and in the feed for everyone who subscribes to community events.
  public,

  /// Only people who were sent the link.
  linkOnly,
}

/// A place a user can pick for an event. Coordinates are WGS84.
final class EventPlace {
  const EventPlace({
    required this.name,
    required this.latitude,
    required this.longitude,
  });

  final String name;
  final double latitude;
  final double longitude;

  @override
  bool operator ==(Object other) =>
      other is EventPlace &&
      other.name == name &&
      other.latitude == latitude &&
      other.longitude == longitude;

  @override
  int get hashCode => Object.hash(name, latitude, longitude);
}

/// Places offered by the editor until it has a map picker.
const melbournePlaces = [
  EventPlace(
    name: 'Federation Square',
    latitude: -37.8179,
    longitude: 144.9691,
  ),
  EventPlace(
    name: 'Southbank Promenade',
    latitude: -37.8200,
    longitude: 144.9650,
  ),
  EventPlace(
    name: 'Queen Victoria Market',
    latitude: -37.8076,
    longitude: 144.9568,
  ),
  EventPlace(name: 'Carlton Gardens', latitude: -37.8049, longitude: 144.9717),
  EventPlace(
    name: 'Docklands Waterfront',
    latitude: -37.8140,
    longitude: 144.9460,
  ),
  EventPlace(
    name: 'State Library Victoria',
    latitude: -37.8098,
    longitude: 144.9652,
  ),
  EventPlace(name: 'Birrarung Marr', latitude: -37.8187, longitude: 144.9754),
];

final class UserProfile {
  const UserProfile({required this.id, required this.displayName});

  final String id;
  final String displayName;

  UserProfile copyWith({String? displayName}) =>
      UserProfile(id: id, displayName: displayName ?? this.displayName);
}

/// What the editor collects. The repository turns it into a [UserEvent].
final class UserEventDraft {
  const UserEventDraft({
    required this.title,
    required this.description,
    required this.category,
    required this.startAt,
    required this.endAt,
    required this.place,
    required this.visibility,
    this.capacity,
  });

  final String title;
  final String description;
  final EventCategory category;
  final DateTime startAt;
  final DateTime endAt;
  final EventPlace place;
  final EventVisibility visibility;

  /// Null means no limit.
  final int? capacity;
}

final class UserEvent {
  const UserEvent({
    required this.id,
    required this.title,
    required this.description,
    required this.category,
    required this.startAt,
    required this.endAt,
    required this.place,
    required this.visibility,
    required this.hostId,
    required this.hostName,
    required this.createdAt,
    this.capacity,
    this.attendees = const {},
    this.cancelled = false,
    this.isSample = false,
  });

  final String id;
  final String title;
  final String description;
  final EventCategory category;
  final DateTime startAt;
  final DateTime endAt;
  final EventPlace place;
  final EventVisibility visibility;
  final String hostId;
  final String hostName;
  final DateTime createdAt;
  final int? capacity;

  /// Ids of the people who joined, the host included.
  final Set<String> attendees;
  final bool cancelled;

  /// Seeded demo content; the UI labels it so it is never read as real.
  final bool isSample;

  int get goingCount => attendees.length;

  bool get isFull => capacity != null && goingCount >= capacity!;

  bool isHostedBy(String userId) => hostId == userId;

  bool isGoing(String userId) => attendees.contains(userId);

  bool hasEnded(DateTime now) => !endAt.isAfter(now);

  UserEvent copyWith({Set<String>? attendees, bool? cancelled}) => UserEvent(
    id: id,
    title: title,
    description: description,
    category: category,
    startAt: startAt,
    endAt: endAt,
    place: place,
    visibility: visibility,
    hostId: hostId,
    hostName: hostName,
    createdAt: createdAt,
    capacity: capacity,
    attendees: attendees ?? this.attendees,
    cancelled: cancelled ?? this.cancelled,
    isSample: isSample,
  );
}
