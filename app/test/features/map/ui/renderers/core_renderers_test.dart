import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/ui/renderers/core_renderers.dart';

List<MapItem> _items() =>
    (jsonDecode(
          File(
            '../specs/002-map-data-presentation/contracts/examples/'
            'item-variants.sample.json',
          ).readAsStringSync(),
        ) as List<dynamic>)
        .map((item) => MapItem.fromJson(item as Map<String, dynamic>))
        .toList();

PedestrianMapItem _count(PedestrianMapItem sensor, int? count) {
  final detail = sensor.details;
  return sensor.copyWith(
    details: PedestrianDetails(
      sensorId: detail.sensorId,
      totalCount: count,
      directionACount: null,
      directionBCount: null,
      granularity: detail.granularity,
      window: detail.window,
      locationValidFrom: detail.locationValidFrom,
      locationValidTo: detail.locationValidTo,
      locationStatus: detail.locationStatus,
    ),
  );
}

PedestrianMapItem _locationValidity(
  PedestrianMapItem sensor, {
  required DateTime? from,
  DateTime? to,
}) {
  final detail = sensor.details;
  return sensor.copyWith(
    details: PedestrianDetails(
      sensorId: detail.sensorId,
      totalCount: detail.totalCount,
      directionACount: detail.directionACount,
      directionBCount: detail.directionBCount,
      granularity: detail.granularity,
      window: detail.window,
      locationValidFrom: from,
      locationValidTo: to,
      locationStatus: detail.locationStatus,
    ),
  );
}

void main() {
  final colors = ThemeData().colorScheme;
  final items = _items();
  final sensor = items.whereType<PedestrianMapItem>().first;

  test(
    'circle ground area is proportional and uses a fixed viewport scale',
    () {
      final low = _count(sensor, 25);
      final high = _count(sensor, 100).copyWith(id: 'sample.high');
      final alone = buildCoreRenderPlan(items: [low], colors: colors);
      final together = buildCoreRenderPlan(items: [low, high], colors: colors);
      final lowRadius = alone.circles.single.radius;
      final highRadius = together.circles
          .firstWhere(
            (circle) => circle.circleId.value == 'sample.high:passages',
          )
          .radius;
      expect(math.pi * lowRadius * lowRadius, closeTo(25 * 16, 0.00001));
      expect(highRadius / lowRadius, closeTo(2, 0.00001));
      expect(
        together.circles
            .firstWhere(
              (circle) => circle.circleId == alone.circles.single.circleId,
            )
            .radius,
        lowRadius,
      );
    },
  );

  test('missing count, measured zero and invalid negative remain distinct', () {
    final unknown = buildCoreRenderPlan(
      items: [_count(sensor, null)],
      colors: colors,
    );
    final zero = buildCoreRenderPlan(
      items: [_count(sensor, 0)],
      colors: colors,
    );
    final negative = buildCoreRenderPlan(
      items: [_count(sensor, -1)],
      colors: colors,
    );
    expect(unknown.markers, hasLength(1));
    expect(unknown.circles, isEmpty);
    expect(zero.markers, hasLength(1));
    expect(zero.circles.single.radius, 0);
    expect(negative.circles, isEmpty);
  });

  test('missing or inconsistent location never creates a synthetic point', () {
    final unlocated = sensor.copyWith(
      geometry: null,
      location: const MapLocation(
        precision: MapLocationPrecision.unlocated,
        role: MapLocationRole.unknown,
        evidence: null,
      ),
    );
    final mismatched = sensor.copyWith(
      location: const MapLocation(
        precision: MapLocationPrecision.area,
        role: MapLocationRole.sensor,
        evidence: null,
      ),
    );
    final invalid = sensor.copyWith(
      geometry: const GeoJsonGeometry.point(coordinates: [181, -37.8]),
    );
    for (final item in [unlocated, mismatched, invalid]) {
      final plan = buildCoreRenderPlan(items: [item], colors: colors);
      expect(plan.markers, isEmpty);
      expect(plan.circles, isEmpty);
    }
  });

  test(
    'sensor position must be effective throughout the observation window',
    () {
      final window = sensor.details.window;
      final bounded = _locationValidity(
        sensor,
        from: window.from,
        to: window.to,
      );
      final openEnd = _locationValidity(sensor, from: window.from);
      for (final item in [bounded, openEnd]) {
        expect(
          buildCoreRenderPlan(items: [item], colors: colors).markers,
          hasLength(1),
        );
      }
      for (final item in [
        _locationValidity(sensor, from: null),
        _locationValidity(
          sensor,
          from: window.from.add(const Duration(seconds: 1)),
        ),
        _locationValidity(
          sensor,
          from: window.from,
          to: window.to.subtract(const Duration(seconds: 1)),
        ),
      ]) {
        final plan = buildCoreRenderPlan(items: [item], colors: colors);
        expect(plan.markers, isEmpty);
        expect(plan.circles, isEmpty);
      }
    },
  );

  test(
    'GeoJSON order and multipart lines keep original geographic precision',
    () {
      final plan = buildGeometryRenderPlan(
        id: 'sample.roads',
        geometry: const GeoJsonGeometry.multiLineString(
          coordinates: [
            [
              [144.96, -37.81],
              [144.97, -37.82],
            ],
            [
              [144.98, -37.83],
              [144.99, -37.84],
            ],
          ],
        ),
        title: 'Sample roads',
        color: colors.primary,
      );
      expect(plan.markers, isEmpty);
      expect(plan.polylines, hasLength(2));
      expect(plan.polylines.first.points.first, const LatLng(-37.81, 144.96));
      expect(plan.polylines.last.points.last, const LatLng(-37.84, 144.99));
    },
  );

  test('polygons preserve exterior, holes and separate multipart areas', () {
    final plan = buildGeometryRenderPlan(
      id: 'sample.areas',
      geometry: const GeoJsonGeometry.multiPolygon(
        coordinates: [
          [
            [
              [144.9, -37.8],
              [145.0, -37.8],
              [145.0, -37.9],
              [144.9, -37.8],
            ],
            [
              [144.95, -37.82],
              [144.97, -37.82],
              [144.97, -37.84],
              [144.95, -37.82],
            ],
          ],
          [
            [
              [145.1, -37.8],
              [145.2, -37.8],
              [145.2, -37.9],
              [145.1, -37.8],
            ],
          ],
        ],
      ),
      title: 'Sample areas',
      color: colors.primary,
    );
    expect(plan.markers, isEmpty);
    expect(plan.polygons, hasLength(2));
    expect(plan.polygons.first.holes, hasLength(1));
    expect(
      plan.polygons.first.holes.single.first,
      const LatLng(-37.82, 144.95),
    );
    expect(plan.polygons.last.holes, isEmpty);
  });

  test(
    'selection uses the original DTO and highlights without changing scale',
    () {
      MapItem? selected;
      final plan = buildCoreRenderPlan(
        items: [sensor],
        colors: colors,
        selectedItemId: sensor.id,
        onSelected: (item) => selected = item,
      );
      plan.circles.single.onTap!();
      expect(selected, same(sensor));
      expect(plan.circles.single.strokeWidth, 3);
      expect(plan.markers.single.zIndexInt, 2);
      expect(
        plan.circles.single.radius,
        passageCircleRadiusMeters(sensor.details.totalCount),
      );
    },
  );

  test(
    'core does not style aggregates without their unit and partial renderer',
    () {
      final plan = buildCoreRenderPlan(
        items: items.whereType<AggregateMapItem>(),
        colors: colors,
      );
      expect(plan.markers, isEmpty);
      expect(plan.circles, isEmpty);
      expect(plan.polygons, isEmpty);
      expect(plan.polylines, isEmpty);
    },
  );
}
