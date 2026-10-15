import 'package:intl/intl.dart';

import '../../../core/time/melbourne_time.dart';
import 'user_event.dart';

/// The link a guest opens to see and join [event], or null without an origin.
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
  final buffer = StringBuffer()
    ..writeln('Join me: ${event.title}')
    ..writeln('$when at ${event.place.name}');
  if (link != null) {
    buffer.write(link);
  } else {
    buffer.write('Find it in Melens under Community events.');
  }
  return buffer.toString();
}
