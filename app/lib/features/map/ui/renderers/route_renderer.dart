import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';

import '../../state/map_actions.dart';
import 'core_renderers.dart';

const routePolylineId = 'agent-route';
const routeMarkerPrefix = 'agent-route-stop:';

// Shared icons: the Maps plugin compares icons by identity, so a new one per
// build re-applies every stop marker on each rebuild.
final _startIcon = BitmapDescriptor.defaultMarkerWithHue(
  BitmapDescriptor.hueGreen,
);
final _endIcon = BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed);
final _stopIcon = BitmapDescriptor.defaultMarkerWithHue(
  BitmapDescriptor.hueAzure,
);

/// The route the agent drew: the path in the accent colour and one marker
/// per stop. The first stop is green, the last red and the ones between blue;
/// each marker's info window names the stop, or numbers it.
CoreRenderPlan routeRenderPlan(
  AgentRoute route, {
  required Color color,
  required String Function(int number) stopLabel,
}) {
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
              ? _startIcon
              : index == stops.length - 1
              ? _endIcon
              : _stopIcon,
          infoWindow: InfoWindow(
            title: stop.label ?? stopLabel(index + 1),
            snippet: stop.label == null ? null : stopLabel(index + 1),
          ),
          zIndexInt: 4,
        ),
    },
  );
}
