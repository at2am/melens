import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../map/ui/renderers/core_renderers.dart';
import '../../map/ui/renderers/marker_icons.dart';
import '../data/user_event_models.dart';

/// Marker ids of user events on the map surface start with this.
const userEventMarkerPrefix = 'user-event:';

/// Violet community pins for the user events near the viewport, drawn over
/// the layers. A cancelled event is faded; tapping a pin opens the event in
/// the panel. The icon comes from the shared [MapMarkerIcons]: the Maps
/// plugin compares icons by identity, so a new one per build would blank the
/// pins while the map moved or loaded.
CoreRenderPlan userEventMarkers({
  required List<UserEvent> events,
  required String Function(UserEvent event) snippetOf,
  required void Function(UserEvent event) onTap,
  MapMarkerIcons? icons,
}) {
  final icon = (icons ?? MapMarkerIcons.fallback).community;
  return CoreRenderPlan(
    markers: {
      for (final event in events)
        Marker(
          markerId: MarkerId('$userEventMarkerPrefix${event.id}'),
          position: LatLng(event.point.lat, event.point.lng),
          icon: icon,
          infoWindow: InfoWindow(title: event.title, snippet: snippetOf(event)),
          alpha: event.isCancelled ? 0.5 : 1,
          zIndexInt: 3,
          onTap: () => onTap(event),
        ),
    },
  );
}
