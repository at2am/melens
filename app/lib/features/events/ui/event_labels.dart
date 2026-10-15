import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/user_event.dart';

String eventCategoryTitle(AppLocalizations strings, EventCategory category) =>
    switch (category) {
      EventCategory.music => strings.eventCategoryMusic,
      EventCategory.arts => strings.eventCategoryArts,
      EventCategory.food => strings.eventCategoryFood,
      EventCategory.sport => strings.eventCategorySport,
      EventCategory.outdoors => strings.eventCategoryOutdoors,
      EventCategory.community => strings.eventCategoryCommunity,
      EventCategory.other => strings.eventCategoryOther,
    };

IconData eventCategoryIcon(EventCategory category) => switch (category) {
  EventCategory.music => Icons.music_note,
  EventCategory.arts => Icons.palette_outlined,
  EventCategory.food => Icons.restaurant,
  EventCategory.sport => Icons.directions_run,
  EventCategory.outdoors => Icons.park_outlined,
  EventCategory.community => Icons.groups_outlined,
  EventCategory.other => Icons.event,
};

/// "Sat 18 Oct, 6:30 PM – 8:30 PM" in Melbourne time.
String eventWhen(MelbourneClock clock, UserEvent event) {
  final start = clock.toMelbourne(event.startAt);
  final end = clock.toMelbourne(event.endAt);
  final sameDay =
      start.year == end.year &&
      start.month == end.month &&
      start.day == end.day;
  final day = DateFormat('EEE d MMM', 'en_AU');
  final time = DateFormat('h:mm a', 'en_AU');
  return sameDay
      ? '${day.format(start)}, ${time.format(start)} – ${time.format(end)}'
      : '${day.format(start)}, ${time.format(start)} – '
            '${day.format(end)}, ${time.format(end)}';
}
