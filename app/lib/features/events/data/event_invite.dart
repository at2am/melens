import 'package:intl/intl.dart';

import '../../../core/time/melbourne_time.dart';
import 'user_event_models.dart';

/// The link a guest opens to see [event], or null without an origin. The app
/// opens it on the Discover tab with the event's details (`/events/:id`).
Uri? eventInviteLink(Uri? origin, UserEvent event) =>
    origin?.replace(path: '/events/${Uri.encodeComponent(event.id)}');

/// A message the host can paste into any chat app. It carries the link when
/// there is one, and otherwise says how to find the event.
String eventInviteMessage({
  required UserEvent event,
  required MelbourneClock clock,
  Uri? link,
}) {
  final start = clock.toMelbourne(event.startAt);
  final when =
      '${DateFormat('EEE d MMM', 'en_AU').format(start)}, '
      '${DateFormat('h:mm a', 'en_AU').format(start)}';
  final buffer = StringBuffer()..writeln('Join me: ${event.title}');
  final place = event.placeName;
  buffer.writeln(place == null ? when : '$when at $place');
  if (link != null) {
    buffer.write(link);
  } else {
    buffer.write('Find it in Melens, on the Discover tab under Events.');
  }
  return buffer.toString();
}
