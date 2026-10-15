import 'package:material_ui/material_ui.dart';

import '../data/map_models.dart';

/// The glyph and colour that stand for one kind of map object: on its map
/// pins, its lines and areas, its layer chip and the legend. White glyphs
/// stay legible on every colour here.
final class MapMarkerStyle {
  const MapMarkerStyle(this.icon, this.color);

  final IconData icon;
  final Color color;
}

/// One style per layer, fixed rather than taken from the theme so a layer
/// looks the same in light and dark mode. Disruptions are red (UC-05) and
/// anomalies are the "?" marker (UC-04).
MapMarkerStyle layerStyle(MapLayerId layer) => switch (layer) {
  MapLayerId.pedestrian => const MapMarkerStyle(
    Icons.directions_walk,
    Color(0xFF1E88E5),
  ),
  MapLayerId.anomaly => const MapMarkerStyle(
    Icons.question_mark,
    Color(0xFFEF6C00),
  ),
  MapLayerId.disruption => const MapMarkerStyle(
    Icons.warning_rounded,
    Color(0xFFD32F2F),
  ),
  MapLayerId.event => const MapMarkerStyle(
    Icons.celebration,
    Color(0xFFD81B60),
  ),
  MapLayerId.planning => const MapMarkerStyle(
    Icons.apartment,
    Color(0xFF6D4C41),
  ),
  MapLayerId.boundary => const MapMarkerStyle(
    Icons.crop_free,
    Color(0xFF546E7A),
  ),
  MapLayerId.news => const MapMarkerStyle(Icons.newspaper, Color(0xFF3949AB)),
  MapLayerId.rent => const MapMarkerStyle(Icons.house, Color(0xFF00897B)),
  MapLayerId.census => const MapMarkerStyle(Icons.groups, Color(0xFF558B2F)),
  MapLayerId.parking => const MapMarkerStyle(
    Icons.local_parking,
    Color(0xFF0277BD),
  ),
};

/// Community events published in the app (UC-09): violet pins.
const communityEventStyle = MapMarkerStyle(Icons.campaign, Color(0xFF7B1FA2));

/// The agent's route: where it starts, where it ends and the stops between.
const routeStartStyle = MapMarkerStyle(Icons.trip_origin, Color(0xFF2E7D32));
const routeEndStyle = MapMarkerStyle(Icons.sports_score, Color(0xFFC62828));
const routeStopStyle = MapMarkerStyle(Icons.place, Color(0xFF1E88E5));

/// The user's own position: a blue dot, not a pin.
const userLocationColor = Color(0xFF1A73E8);

/// A layer's glyph in a filled circle of its colour, for chips and legends.
class MapLayerBadge extends StatelessWidget {
  const MapLayerBadge({required this.style, this.size = 20, super.key});

  final MapMarkerStyle style;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: style.color, shape: BoxShape.circle),
    alignment: Alignment.center,
    child: Icon(style.icon, size: size * 0.62, color: Colors.white),
  );
}
