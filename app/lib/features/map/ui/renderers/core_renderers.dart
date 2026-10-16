import 'dart:math' as math;

import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';

import '../../data/map_models.dart';
import '../map_layer_style.dart';
import 'marker_icons.dart';
import 'parking_bays.dart';

/// Fixed ground area per sensor passage; never renormalized to the viewport.
/// This is a display scale, not the sensor's catchment or a population density.
const double passageCircleAreaSquareMeters = 16;

double? passageCircleRadiusMeters(int? count) => count == null || count < 0
    ? null
    : math.sqrt(count * passageCircleAreaSquareMeters / math.pi);

/// Public Google Maps objects, also inspectable by tests without a platform map.
final class CoreRenderPlan {
  const CoreRenderPlan({
    this.markers = const {},
    this.circles = const {},
    this.polylines = const {},
    this.polygons = const {},
  });

  const CoreRenderPlan.empty() : this();

  final Set<Marker> markers;
  final Set<Circle> circles;
  final Set<Polyline> polylines;
  final Set<Polygon> polygons;

  CoreRenderPlan merge(CoreRenderPlan other) => CoreRenderPlan(
    markers: {...markers, ...other.markers},
    circles: {...circles, ...other.circles},
    polylines: {...polylines, ...other.polylines},
    polygons: {...polygons, ...other.polygons},
  );
}

/// Missing locations and contradictory direct DTOs are never mapped to points.
bool isDrawableMapItem(MapItem item) {
  final geometry = item.geometry;
  if (geometry == null ||
      item.location.precision != geometry.precision ||
      item.location.role == MapLocationRole.mention ||
      !_validGeometry(geometry)) {
    return false;
  }
  if (item case PedestrianMapItem(:final details)) {
    return details.locationStatus == PedestrianLocationStatus.located &&
        geometry is GeoJsonPoint &&
        item.location.role == MapLocationRole.sensor &&
        details.window.from.isBefore(details.window.to) &&
        details.locationValidFrom != null &&
        !details.window.from.isBefore(details.locationValidFrom!) &&
        (details.locationValidTo == null ||
            !details.window.to.isAfter(details.locationValidTo!));
  }
  return true;
}

bool _validGeometry(GeoJsonGeometry geometry) {
  try {
    // Reuse the frozen boundary's validation for direct, non-decoded DTOs.
    GeoJsonGeometry.fromJson(geometry.toJson());
    return true;
  } on FormatException {
    return false;
  }
}

LatLng _position(List<double> point) => LatLng(point[1], point[0]);

/// Draws the supplied geometry intact, including multipart extents and holes.
/// No area centroid or inferred event site is introduced.
CoreRenderPlan buildGeometryRenderPlan({
  required String id,
  required GeoJsonGeometry geometry,
  required String title,
  required Color color,
  String? description,
  bool selected = false,
  VoidCallback? onTap,
  BitmapDescriptor icon = BitmapDescriptor.defaultMarker,
}) {
  if (!_validGeometry(geometry)) return const CoreRenderPlan.empty();
  final markers = <Marker>{};
  final polylines = <Polyline>{};
  final polygons = <Polygon>{};
  var pointIndex = 0;
  var lineIndex = 0;
  var polygonIndex = 0;

  void addPoint(List<double> point) {
    markers.add(
      Marker(
        markerId: MarkerId('$id:point:${pointIndex++}'),
        position: _position(point),
        icon: icon,
        infoWindow: InfoWindow(title: title, snippet: description),
        onTap: onTap,
        zIndexInt: selected ? 2 : 1,
        alpha: selected ? 1 : 0.8,
      ),
    );
  }

  void addLine(List<List<double>> line) {
    polylines.add(
      Polyline(
        polylineId: PolylineId('$id:line:${lineIndex++}'),
        points: line.map(_position).toList(growable: false),
        color: color,
        width: selected ? 6 : 3,
        consumeTapEvents: onTap != null,
        onTap: onTap,
        zIndex: selected ? 2 : 1,
      ),
    );
  }

  void addPolygon(List<List<List<double>>> polygon) {
    polygons.add(
      Polygon(
        polygonId: PolygonId('$id:polygon:${polygonIndex++}'),
        points: polygon.first.map(_position).toList(growable: false),
        holes: polygon
            .skip(1)
            .map((ring) => ring.map(_position).toList(growable: false))
            .toList(growable: false),
        strokeColor: color,
        strokeWidth: selected ? 4 : 2,
        fillColor: color.withValues(alpha: selected ? 0.2 : 0.1),
        consumeTapEvents: onTap != null,
        onTap: onTap,
        zIndex: selected ? 2 : 1,
      ),
    );
  }

  switch (geometry) {
    case GeoJsonPoint(:final coordinates):
      addPoint(coordinates);
    case GeoJsonMultiPoint(:final coordinates):
      coordinates.forEach(addPoint);
    case GeoJsonLineString(:final coordinates):
      addLine(coordinates);
    case GeoJsonMultiLineString(:final coordinates):
      coordinates.forEach(addLine);
    case GeoJsonPolygon(:final coordinates):
      addPolygon(coordinates);
    case GeoJsonMultiPolygon(:final coordinates):
      coordinates.forEach(addPolygon);
  }
  return CoreRenderPlan(
    markers: markers,
    polylines: polylines,
    polygons: polygons,
  );
}

/// The colour of a parking bay. A sensor with no current reading is
/// neutral, never the vacant colour; the details panel always says why.
Color parkingStateColor(ParkingState state, ColorScheme colors) =>
    switch (state) {
      ParkingState.vacant => const Color(0xFF2E7D32),
      ParkingState.occupied => colors.error,
      ParkingState.noData => colors.outline,
    };

/// Point identities remain visible when a measured count is zero or unknown.
/// Count circles contain no inferred readings; exact counts live in the list.
/// Aggregate styling belongs to the separate aggregate renderer.
/// Each layer draws in its own colour and its points carry its own pin
/// ([layerStyle]); the selected object switches to the theme's accent.
CoreRenderPlan buildCoreRenderPlan({
  required Iterable<MapItem> items,
  required ColorScheme colors,
  String? selectedItemId,
  ValueChanged<MapItem>? onSelected,
  String Function(MapItem)? describeItem,
  MapMarkerIcons? icons,
}) {
  final pins = icons ?? MapMarkerIcons.fallback;
  var plan = const CoreRenderPlan.empty();
  // Hundreds of bays fit a street view, so each sensor is its bay drawn to
  // scale and coloured by its own reading rather than a pin. Bays are laid out
  // together because each one's kerb direction comes from its neighbours.
  final bays = [
    for (final item in items)
      if (item case ParkingMapItem(
        geometry: GeoJsonPoint(:final coordinates),
      ) when isDrawableMapItem(item))
        (item: item, center: _position(coordinates)),
  ];
  final outlines = parkingBayOutlines([for (final bay in bays) bay.center]);
  final bayPolygons = <Polygon>{};
  for (final (index, (:item, center: _)) in bays.indexed) {
    final selected = item.id == selectedItemId;
    final fill = parkingStateColor(item.details.state, colors);
    bayPolygons.add(
      Polygon(
        polygonId: PolygonId('${item.id}:bay'),
        points: outlines[index],
        fillColor: fill,
        // No outline, so the line's gap between neighbouring bays stays
        // clear; the selected bay keeps its size and gains one.
        strokeColor: selected ? colors.secondary : fill,
        strokeWidth: selected ? 3 : 0,
        consumeTapEvents: onSelected != null,
        onTap: onSelected == null ? null : () => onSelected(item),
        zIndex: selected ? 2 : 1,
      ),
    );
  }
  for (final item in items) {
    if (item is AggregateMapItem || !isDrawableMapItem(item)) continue;
    if (item is ParkingMapItem && item.geometry is GeoJsonPoint) continue;
    final selected = item.id == selectedItemId;
    final color = selected ? colors.secondary : layerStyle(item.layerId).color;
    final onTap = onSelected == null ? null : () => onSelected(item);
    plan = plan.merge(
      buildGeometryRenderPlan(
        id: item.id,
        geometry: item.geometry!,
        title: item.title,
        description: describeItem?.call(item),
        color: color,
        selected: selected,
        onTap: onTap,
        icon: pins.layer(item.layerId, selected: selected),
      ),
    );
    if (item case PedestrianMapItem(
      geometry: GeoJsonPoint(:final coordinates),
      :final details,
    )) {
      final radius = passageCircleRadiusMeters(details.totalCount);
      if (radius == null) continue;
      plan = plan.merge(
        CoreRenderPlan(
          circles: {
            Circle(
              circleId: CircleId('${item.id}:passages'),
              center: _position(coordinates),
              radius: radius,
              fillColor: color.withValues(alpha: 0.22),
              strokeColor: color,
              strokeWidth: selected ? 3 : 1,
              consumeTapEvents: onTap != null,
              onTap: onTap,
              zIndex: selected ? 2 : 1,
            ),
          },
        ),
      );
    }
  }
  return plan.merge(CoreRenderPlan(polygons: bayPolygons));
}
