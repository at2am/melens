import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';

import '../../state/map_actions.dart';
import 'core_renderers.dart';
import 'marker_icons.dart';

const routePolylineId = 'agent-route';
const routeMarkerPrefix = 'agent-route-stop:';

/// The route the agent drew: the path in the accent colour and one marker
/// per stop. The first stop is a green start pin, the last a red finish flag
/// and the ones between blue; each marker's info window names the stop, or
/// numbers it.
CoreRenderPlan routeRenderPlan(
  AgentRoute route, {
  required Color color,
  required String Function(int number) stopLabel,
  MapMarkerIcons? icons,
}) {
  final pins = icons ?? MapMarkerIcons.fallback;
  final stops = route.waypoints;
  return CoreRenderPlan(
    polylines: {
      Polyline(
        polylineId: const PolylineId(routePolylineId),
        points: [for (final p in route.points) LatLng(p.lat, p.lng)],
        color: color,
        width: 6,
        zIndex: 2,
        // Transit legs are not continuous on foot, so the line is dashed.
        patterns: route.mode == 'transit'
            ? [PatternItem.dash(20), PatternItem.gap(10)]
            : const [],
        jointType: JointType.round,
        startCap: Cap.roundCap,
        endCap: Cap.roundCap,
      ),
    },
    markers: {
      for (final (index, stop) in stops.indexed)
        Marker(
          markerId: MarkerId('$routeMarkerPrefix$index'),
          position: LatLng(stop.point.lat, stop.point.lng),
          icon: index == 0
              ? pins.routeStart
              : index == stops.length - 1
              ? pins.routeEnd
              : pins.routeStop,
          infoWindow: InfoWindow(
            title: stop.label ?? stopLabel(index + 1),
            snippet: stop.label == null ? null : stopLabel(index + 1),
          ),
          zIndexInt: 4,
        ),
    },
  );
}
