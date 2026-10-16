import 'dart:math' as math;

import 'package:google_maps_flutter/google_maps_flutter.dart';

/// A parallel bay on a street of 50 km/h or less: 6.0 m along the kerb and
/// 2.3 m deep (AS 2890.5:2020, intermediate space).
const double parallelBayLengthMeters = 6.0;
const double parallelBayWidthMeters = 2.3;

/// A 90° bay: 5.4 m deep and 2.5 m wide (AS 2890.1, user class 2).
const double rightAngleBayLengthMeters = 5.4;
const double rightAngleBayWidthMeters = 2.5;

/// Kerb neighbours closer than this sit side by side (90° bays, about 2.5 m
/// apart) rather than nose to tail (parallel bays, about 6 m apart).
const double _sideBySideSpacingMeters = 4;

/// About 500 sensors share a spot with another, within half a metre; those
/// are drawn over each other rather than taken for a kerb.
const double _sameSpotMeters = 1;

/// The painted line between two bays, kept clear so neighbours stay apart.
const double _bayLineGapMeters = 0.5;

/// Only sensors this close count as neighbours along the same kerb. The
/// opposite kerb of even a laneway is usually further away.
const double _kerbNeighbourMeters = 10;

/// Two neighbours on opposite sides of a bay are on its kerb only when they
/// line up with it to within 30°.
final double _kerbLineCos = math.cos(30 * math.pi / 180);

/// A sensor with no neighbour follows the Hoddle Grid, where most sensors are:
/// its east–west streets run about 20.5° north of east.
const double _hoddleGridKerbAngle = 20.5 * math.pi / 180;

const double _earthRadiusMeters = 6378137;

/// The outline of each sensor's bay, drawn to scale and centred on the
/// sensor, in the order of [sensors]. The feed has no kerb direction, so it is
/// taken from the nearest sensors along the same kerb; their spacing also
/// tells parallel bays from 90° ones. This is a display footprint at the
/// standard size, shortened only where sensors are closer than that; it is
/// not the surveyed bay.
List<List<LatLng>> parkingBayOutlines(List<LatLng> sensors) {
  if (sensors.isEmpty) return const [];
  final originLat =
      sensors.map((s) => s.latitude).reduce((a, b) => a + b) / sensors.length;
  final metersPerLat = _earthRadiusMeters * math.pi / 180;
  final metersPerLng = metersPerLat * math.cos(originLat * math.pi / 180);
  final points = [
    for (final s in sensors)
      (x: s.longitude * metersPerLng, y: s.latitude * metersPerLat),
  ];

  (int, int) cellOf(({double x, double y}) p) => (
    (p.x / _kerbNeighbourMeters).floor(),
    (p.y / _kerbNeighbourMeters).floor(),
  );
  final grid = <(int, int), List<int>>{};
  for (final (i, p) in points.indexed) {
    (grid[cellOf(p)] ??= []).add(i);
  }

  final outlines = <List<LatLng>>[];
  for (final (i, p) in points.indexed) {
    final (cx, cy) = cellOf(p);
    final neighbours = <({double x, double y, double d})>[];
    for (var gx = cx - 1; gx <= cx + 1; gx++) {
      for (var gy = cy - 1; gy <= cy + 1; gy++) {
        for (final j in grid[(gx, gy)] ?? const <int>[]) {
          final x = points[j].x - p.x, y = points[j].y - p.y;
          final d = math.sqrt(x * x + y * y);
          // A sensor at nearly the same point says nothing about the kerb.
          if (d >= _sameSpotMeters && d <= _kerbNeighbourMeters) {
            neighbours.add((x: x, y: y, d: d));
          }
        }
      }
    }
    neighbours.sort((a, b) => a.d.compareTo(b.d));
    // The nearest sensor, and the nearest one that continues its line on the
    // other side of the bay: at the end of a row that is none, rather than a
    // sensor on the far kerb.
    final kerb = [
      ...neighbours.take(1),
      ...neighbours
          .where((n) {
            final first = neighbours.first;
            final cos = (n.x * first.x + n.y * first.y) / (n.d * first.d);
            return cos < -_kerbLineCos;
          })
          .take(1),
    ];

    var angle = _hoddleGridKerbAngle;
    var length = parallelBayLengthMeters;
    var width = parallelBayWidthMeters;
    if (kerb.isNotEmpty) {
      angle = _principalAxis([
        (x: 0.0, y: 0.0),
        for (final n in kerb) (x: n.x, y: n.y),
      ]);
      // Sensors closer than a standard bay keep a line's gap between them,
      // so a bay never covers its neighbour's reading.
      final room = math.max(kerb.first.d - _bayLineGapMeters, _sameSpotMeters);
      if (kerb.first.d < _sideBySideSpacingMeters) {
        angle += math.pi / 2;
        length = rightAngleBayLengthMeters;
        width = math.min(rightAngleBayWidthMeters, room);
      } else {
        length = math.min(parallelBayLengthMeters, room);
      }
    }
    outlines.add(_rectangle(sensors[i], angle, length, width));
  }
  return outlines;
}

/// The direction, in radians anticlockwise from east, of the line that best
/// fits [points].
double _principalAxis(List<({double x, double y})> points) {
  final mx = points.map((p) => p.x).reduce((a, b) => a + b) / points.length;
  final my = points.map((p) => p.y).reduce((a, b) => a + b) / points.length;
  var sxx = 0.0, syy = 0.0, sxy = 0.0;
  for (final p in points) {
    sxx += (p.x - mx) * (p.x - mx);
    syy += (p.y - my) * (p.y - my);
    sxy += (p.x - mx) * (p.y - my);
  }
  return 0.5 * math.atan2(2 * sxy, sxx - syy);
}

/// A [length] × [width] metre rectangle centred on [center], its long side
/// at [angle] radians anticlockwise from east.
List<LatLng> _rectangle(
  LatLng center,
  double angle,
  double length,
  double width,
) {
  final metersPerLat = _earthRadiusMeters * math.pi / 180;
  final metersPerLng = metersPerLat * math.cos(center.latitude * math.pi / 180);
  final (ux, uy) = (math.cos(angle) * length / 2, math.sin(angle) * length / 2);
  final (vx, vy) = (-math.sin(angle) * width / 2, math.cos(angle) * width / 2);
  LatLng corner(double x, double y) => LatLng(
    center.latitude + y / metersPerLat,
    center.longitude + x / metersPerLng,
  );
  return [
    corner(ux + vx, uy + vy),
    corner(-ux + vx, -uy + vy),
    corner(-ux - vx, -uy - vy),
    corner(ux - vx, uy - vy),
  ];
}
