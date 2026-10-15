import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../map/ui/renderers/core_renderers.dart';
import '../data/user_event_models.dart';

/// Marker ids of user events on the map surface start with this.
const userEventMarkerPrefix = 'user-event:';

/// One icon for every pin. The Maps plugin compares icons by identity, so a
/// new one per build made every pin "changed" on each rebuild and the plugin
/// re-applied them all, which blanked the pins while the map moved or loaded.
final userEventMarkerIcon = BitmapDescriptor.defaultMarkerWithHue(
  BitmapDescriptor.hueViolet,
);

/// Pins for the user events near the viewport, drawn over the layers. A
/// cancelled event is faded; tapping a pin opens the event in the panel.
CoreRenderPlan userEventMarkers({
  required List<UserEvent> events,
  required String Function(UserEvent event) snippetOf,
  required void Function(UserEvent event) onTap,
}) => CoreRenderPlan(
  markers: {
    for (final event in events)
      Marker(
        markerId: MarkerId('$userEventMarkerPrefix${event.id}'),
        position: LatLng(event.point.lat, event.point.lng),
        icon: userEventMarkerIcon,
        infoWindow: InfoWindow(title: event.title, snippet: snippetOf(event)),
        alpha: event.isCancelled ? 0.5 : 1,
        zIndexInt: 3,
        onTap: () => onTap(event),
      ),
  },
);
