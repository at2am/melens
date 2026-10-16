import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:melens/features/map/ui/renderers/parking_bays.dart';

const _lat = -37.8136;
const _lng = 144.9631;
const _metersPerLat = 6378137 * math.pi / 180;
final _metersPerLng = _metersPerLat * math.cos(_lat * math.pi / 180);

/// A point [east] and [north] metres from the reference sensor.
LatLng _at(double east, double north) =>
    LatLng(_lat + north / _metersPerLat, _lng + east / _metersPerLng);

/// The rectangle's side lengths in metres and its long side's direction, in
/// degrees anticlockwise from east, folded into [0, 180).
({double length, double width, double angle}) _measure(List<LatLng> corners) {
  (double, double) meters(LatLng p) => (
    (p.longitude - _lng) * _metersPerLng,
    (p.latitude - _lat) * _metersPerLat,
  );
  final [a, b, c, _] = corners.map(meters).toList();
  double side((double, double) p, (double, double) q) =>
      math.sqrt(math.pow(p.$1 - q.$1, 2) + math.pow(p.$2 - q.$2, 2));
  final ab = side(a, b), bc = side(b, c);
  final (p, q) = ab >= bc ? (a, b) : (b, c);
  final angle = math.atan2(q.$2 - p.$2, q.$1 - p.$1) * 180 / math.pi % 180;
  return (length: math.max(ab, bc), width: math.min(ab, bc), angle: angle);
}

void main() {
  test('a bay is a standard parallel bay centred on its sensor', () {
    final [bay] = parkingBayOutlines([_at(0, 0)]);
    final size = _measure(bay);
    expect(size.length, closeTo(parallelBayLengthMeters, 0.01));
    expect(size.width, closeTo(parallelBayWidthMeters, 0.01));
    final centerLat = bay.map((p) => p.latitude).reduce((a, b) => a + b) / 4;
    final centerLng = bay.map((p) => p.longitude).reduce((a, b) => a + b) / 4;
    expect(centerLat, closeTo(_lat, 1e-9));
    expect(centerLng, closeTo(_lng, 1e-9));
  });

  test('a lone sensor follows the Hoddle Grid', () {
    final [bay] = parkingBayOutlines([_at(0, 0)]);
    expect(_measure(bay).angle, closeTo(20.5, 0.1));
  });

  test('parallel bays line up along the kerb their neighbours form', () {
    // A kerb running north–south, bays nose to tail 7 m apart.
    final bays = parkingBayOutlines([_at(0, -7), _at(0, 0), _at(0, 7)]);
    for (final bay in bays) {
      final size = _measure(bay);
      expect(size.angle, closeTo(90, 0.5));
      expect(size.length, closeTo(parallelBayLengthMeters, 0.01));
      expect(size.width, closeTo(parallelBayWidthMeters, 0.01));
    }
  });

  test('bays closer than the standard size keep a gap between them', () {
    final bays = parkingBayOutlines([_at(0, 0), _at(5.5, 0)]);
    for (final bay in bays) {
      expect(_measure(bay).length, closeTo(5.0, 0.01));
    }
  });

  test('sensors on the same spot do not set the kerb', () {
    // Two sensors 0.3 m apart on a north–south kerb of 7 m bays.
    final bays = parkingBayOutlines([_at(0, 0), _at(0.3, 0), _at(0, 7)]);
    expect(_measure(bays.first).angle, closeTo(90, 1));
    expect(_measure(bays.first).length, closeTo(parallelBayLengthMeters, 0.01));
  });

  test('closely spaced sensors are 90° bays across the kerb', () {
    // A kerb running east–west, bays side by side 3 m apart.
    final bays = parkingBayOutlines([_at(-3, 0), _at(0, 0), _at(3, 0)]);
    for (final bay in bays) {
      final size = _measure(bay);
      expect(size.angle, closeTo(90, 0.5));
      expect(size.length, closeTo(rightAngleBayLengthMeters, 0.01));
      expect(size.width, closeTo(rightAngleBayWidthMeters, 0.01));
    }
  });

  test('the far kerb does not turn a bay', () {
    // Bays along a diagonal kerb; another row 12 m across the street.
    final along = math.cos(math.pi / 4) * 7, across = 12.0;
    final bays = parkingBayOutlines([
      for (var i = -1; i <= 1; i++) _at(i * along, i * along),
      for (var i = -1; i <= 1; i++) _at(i * along + across, i * along),
    ]);
    for (final bay in bays) {
      expect(_measure(bay).angle, closeTo(45, 0.5));
    }
  });
}
