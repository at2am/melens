import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/ui/renderers/core_renderers.dart';

/// The frozen parking example, with optional detail overrides.
Map<String, dynamic> _json({Map<String, Object?> details = const {}}) {
  final items =
      jsonDecode(
            File(
              '../specs/002-map-data-presentation/contracts/examples/'
              'item-variants.sample.json',
            ).readAsStringSync(),
          )
          as List<dynamic>;
  final json = Map<String, dynamic>.from(
    items.cast<Map<String, dynamic>>().singleWhere(
      (item) => item['kind'] == 'parking',
    ),
  );
  json['details'] = {...json['details'] as Map<String, dynamic>, ...details};
  return json;
}

ParkingMapItem _item({
  String id = 'parking:kerbside:1',
  Map<String, Object?> details = const {},
}) {
  final json = _json(details: details)..['id'] = id;
  return MapItem.fromJson(json) as ParkingMapItem;
}

void main() {
  test('parking is a registered layer and item kind', () {
    expect(MapLayerId.values, contains(MapLayerId.parking));
    expect(MapItemKind.values, contains(MapItemKind.parking));
    final item = _item();
    expect(item.kind, MapItemKind.parking);
    expect(item.layerId, MapLayerId.parking);
    expect(item.details.state, ParkingState.vacant);
    expect(item.details.reading, ParkingReading.current);
    expect(item.details.legalParking, 'unknown');
    expect(item.details.mayBeObstructed, isTrue);
    expect(item.details.zoneNumber, 7);
  });

  test('a sensor that stopped reporting decodes as noData with its reason', () {
    final silent = _item(
      details: {
        'state': 'noData',
        'noDataReason': 'notReporting',
        'reading': 'stale',
      },
    );
    expect(silent.details.state, ParkingState.noData);
    expect(silent.details.noDataReason, ParkingNoDataReason.notReporting);
  });

  test(
    'the boundary refuses legal-parking claims and readings it cannot trust',
    () {
      void refuses(Map<String, Object?> details, String why) => expect(
        () => MapItem.fromJson(_json(details: details)),
        throwsA(anything),
        reason: why,
      );
      refuses({
        'legalParking': 'yes',
      }, 'A sensor never establishes legal parking');
      refuses({
        'state': 'noData',
        'noDataReason': null,
      }, 'noData needs its reason');
      refuses({'noDataReason': 'notReporting'}, 'Only noData carries a reason');
      refuses({
        'reading': 'stale',
      }, 'A stale reading cannot be drawn as vacant');
      refuses({
        'state': 'occupied',
        'reading': 'unknown',
      }, 'An unknown reading cannot be occupied');
    },
  );

  test('a parking sensor is not drawable without its own point', () {
    final json = _json()
      ..['geometry'] = null
      ..['location'] = {
        'precision': 'unlocated',
        'role': 'unknown',
        'evidence': null,
      };
    expect(() => MapItem.fromJson(json), throwsA(anything));
  });

  test(
    'each bay is a footprint coloured by its own reading, and noData is never the vacant colour',
    () {
      const colors = ColorScheme.light();
      final vacant = _item();
      final occupied = _item(
        id: 'parking:kerbside:2',
        details: {'state': 'occupied'},
      );
      final silent = _item(
        id: 'parking:kerbside:3',
        details: {
          'state': 'noData',
          'noDataReason': 'notReporting',
          'reading': 'stale',
        },
      );
      final plan = buildCoreRenderPlan(
        items: [vacant, occupied, silent],
        colors: colors,
      );
      expect(plan.markers, isEmpty, reason: 'Bays are footprints, not pins');
      expect(plan.circles, isEmpty);
      Polygon bay(String id) => plan.polygons.singleWhere(
        (polygon) => polygon.polygonId.value == '$id:bay',
      );
      expect(
        bay('parking:kerbside:1').fillColor,
        parkingStateColor(ParkingState.vacant, colors),
      );
      expect(bay('parking:kerbside:2').fillColor, colors.error);
      expect(bay('parking:kerbside:3').fillColor, colors.outline);
      expect(
        bay('parking:kerbside:3').fillColor,
        isNot(parkingStateColor(ParkingState.vacant, colors)),
      );
      expect(bay('parking:kerbside:1').points, hasLength(4));
    },
  );

  test('a selected bay keeps its size, is outlined, and a tap selects it', () {
    const colors = ColorScheme.light();
    MapItem? tapped;
    final item = _item();
    final plain = buildCoreRenderPlan(items: [item], colors: colors);
    final plan = buildCoreRenderPlan(
      items: [item],
      colors: colors,
      selectedItemId: item.id,
      onSelected: (value) => tapped = value,
    );
    final bay = plan.polygons.single;
    expect(bay.points, plain.polygons.single.points);
    expect(bay.strokeColor, colors.secondary);
    expect(bay.zIndex, greaterThan(plain.polygons.single.zIndex));
    expect(bay.consumeTapEvents, isTrue);
    bay.onTap!();
    expect(tapped, item);
  });
}
