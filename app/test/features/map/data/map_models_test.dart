import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/map/data/map_models.dart';

Object? readSharedMapFixture(String name) => jsonDecode(
  File('../specs/002-map-data-presentation/contracts/examples/$name')
      .readAsStringSync(),
);

Map<String, dynamic> fixture(String name) =>
    readSharedMapFixture(name) as Map<String, dynamic>;

Object? normalizeInstants(Object? value) {
  if (value is String && RegExp(r'^\d{4}-\d{2}-\d{2}T.*Z$').hasMatch(value)) {
    return DateTime.parse(value).toUtc().toIso8601String();
  }
  if (value is List) return value.map(normalizeInstants).toList();
  if (value is Map<String, dynamic>) {
    return value.map((key, child) => MapEntry(key, normalizeInstants(child)));
  }
  return value;
}

void main() {
  final viewportFixtures = [
    'viewport.sample.json',
    'no-matching.sample.json',
    'not-covered.sample.json',
    'unavailable.sample.json',
    'unknown.sample.json',
    'historical.sample.json',
    'partial.sample.json',
  ];

  for (final name in viewportFixtures) {
    test('$name preserves recognized wire evidence through a round trip', () {
      final json = fixture(name);
      final response = ViewportResponse.fromJson(json);
      expect(response.dataMode, MapDataMode.sample);
      expect(normalizeInstants(response.toJson()), normalizeInstants(json));
    });
  }

  test(
    'all nine item kinds select typed details without a nested discriminator',
    () {
      final examples = (readSharedMapFixture(
        'item-variants.sample.json',
      ) as List<dynamic>).cast<Map<String, dynamic>>();
      final items = examples.map(MapItem.fromJson).toList();
      expect(
        items.map((item) => item.kind).toSet(),
        MapItemKind.values.toSet(),
      );
      for (var index = 0; index < items.length; index++) {
        final serialized = items[index].toJson();
        expect(serialized['kind'], examples[index]['kind']);
        expect(serialized.containsKey('runtimeType'), isFalse);
        expect(
          (serialized['details'] as Map<String, dynamic>).containsKey(
            'runtimeType',
          ),
          isFalse,
        );
        expect(
          normalizeInstants(serialized),
          normalizeInstants(examples[index]),
        );
      }
      expect(items.first, isA<PedestrianMapItem>());
      expect(
        items.whereType<AreaIndicatorMapItem>().single.details.value,
        isNull,
      );
      expect(
        items.whereType<NewsMapItem>().single.location.role,
        MapLocationRole.areaAssociation,
      );
    },
  );

  test(
    'zero, missing passages and null geometry retain different meanings',
    () {
      final response = ViewportResponse.fromJson(
        fixture('viewport.sample.json'),
      );
      final measuredZero = response.layers.single.items
          .whereType<PedestrianMapItem>()
          .last;
      expect(measuredZero.details.totalCount, 0);
      expect(measuredZero.details.directionACount, isNull);
      expect((measuredZero.geometry as GeoJsonPoint).coordinates, [
        144.965,
        -37.817,
      ]);

      final unlocated =
          MapItemPage.fromJson(fixture('unlocated.sample.json')).items.single
              as PedestrianMapItem;
      expect(unlocated.details.totalCount, isNull);
      expect(unlocated.geometry, isNull);
      expect(unlocated.location.precision, MapLocationPrecision.unlocated);
    },
  );

  test('catalog, detail and bounded pages retain sources, time and scope', () {
    final catalog = fixture('catalog.sample.json');
    expect(
      normalizeInstants(MapLayerCatalog.fromJson(catalog).toJson()),
      normalizeInstants(catalog),
    );
    final detail = fixture('item.sample.json');
    expect(
      normalizeInstants(MapItemResponse.fromJson(detail).toJson()),
      normalizeInstants(detail),
    );
    for (final name in ['unlocated.sample.json', 'members.sample.json']) {
      final page = fixture(name);
      expect(
        normalizeInstants(MapItemPage.fromJson(page).toJson()),
        normalizeInstants(page),
      );
    }
  });

  test('v1 optional response additions are tolerated', () {
    final json = fixture('viewport.sample.json')
      ..['futureOptionalMetadata'] = {'safe': true};
    final response = ViewportResponse.fromJson(json);
    expect(response.layers.single.items, hasLength(2));
  });

  test(
    'verified spatial catalog coverage preserves an unknown time window',
    () {
      final json = fixture('catalog.sample.json');
      for (final layer
          in (json['layers'] as List<dynamic>).cast<Map<String, dynamic>>()) {
        layer['coverage'] = {
          'state': 'verified',
          'areaRefs': ['sample:area'],
          'window': null,
          'evidenceSourceIds': ['sample:source'],
        };
      }
      final catalog = MapLayerCatalog.fromJson(json);
      expect(
        catalog.layers.every((layer) => layer.coverage.window == null),
        isTrue,
      );
      expect(
        catalog.layers.every(
          (layer) => layer.coverage.state == MapCoverageState.verified,
        ),
        isTrue,
      );
    },
  );

  test(
    'noMatching needs complete verified coverage and zero unresolved results',
    () {
      for (final mutation in <void Function(Map<String, dynamic>)>[
        (layer) => layer['coverage'] = {
          'state': 'unknown',
          'areaRefs': <String>[],
          'window': null,
          'evidenceSourceIds': <String>[],
        },
        (layer) => layer['completeness'] = 'partial',
        (layer) => (layer['coverage'] as Map<String, dynamic>)['window'] = null,
        (layer) => layer['unresolvedCount'] = null,
        (layer) => layer['unresolvedCount'] = 1,
      ]) {
        final json = fixture('no-matching.sample.json');
        mutation(
          (json['layers'] as List<dynamic>).single as Map<String, dynamic>,
        );
        expect(() => ViewportResponse.fromJson(json), throwsA(anything));
      }
    },
  );

  test('paginated results preserve a service-proven exact total', () {
    final json = fixture('partial.sample.json');
    final unknown = ViewportResponse.fromJson(json).layers.single;
    expect(unknown.totalMatching, isNull);
    ((json['layers'] as List<dynamic>).single
            as Map<String, dynamic>)['totalMatching'] =
        2;
    final layer = ViewportResponse.fromJson(json).layers.single;
    expect(layer.completeness, MapCompleteness.partial);
    expect(layer.totalMatching, 2);
  });

  test('member pagination preserves an exact full-snapshot total', () {
    final json = fixture('members.sample.json');
    json['items'] = (json['items'] as List<dynamic>).take(1).toList();
    json['completeness'] = 'partial';
    json['nextCursor'] = 'next-members';
    final page = MapItemPage.fromJson(json);
    expect(page.items, hasLength(1));
    expect(page.totalMatching, 2);
    expect(page.completeness, MapCompleteness.partial);
    expect(page.nextCursor, 'next-members');
  });

  test(
    'malformed counts and missing required nullable fields are rejected',
    () {
      for (final value in [-1, 1.5, '12']) {
        final json = fixture('item.sample.json');
        final item = json['item'] as Map<String, dynamic>;
        (item['details'] as Map<String, dynamic>)['totalCount'] = value;
        expect(() => MapItemResponse.fromJson(json), throwsA(anything));
      }
      final json = fixture('item.sample.json');
      final item = json['item'] as Map<String, dynamic>;
      (item['details'] as Map<String, dynamic>).remove('directionACount');
      expect(() => MapItemResponse.fromJson(json), throwsA(anything));
    },
  );

  test('unknown enum values cannot silently become an observation', () {
    final json = fixture('item.sample.json');
    (json['item'] as Map<String, dynamic>)['assertionKind'] = 'confirmedLive';
    expect(() => MapItemResponse.fromJson(json), throwsA(anything));
  });

  test('UTC is explicit and invalid calendar dates are rejected', () {
    for (final time in [
      '2026-10-01T01:00:00',
      '2026-10-01T11:00:00+10:00',
      '2026-02-30T01:00:00Z',
      '2026-10-01T01:00:00.1234567Z',
    ]) {
      final json = fixture('viewport.sample.json')..['generatedAt'] = time;
      expect(() => ViewportResponse.fromJson(json), throwsA(anything));
    }
  });

  test(
    'UTC microseconds survive and request duration limits use exact precision',
    () {
      final window = TimeWindow.fromJson({
        'from': '2026-10-01T00:59:00.000001Z',
        'to': '2026-10-01T00:59:00.000002Z',
      });
      expect(
        window.to.difference(window.from),
        const Duration(microseconds: 1),
      );
      expect(TimeWindow.fromJson(window.toJson()).from.microsecond, 1);

      final json = fixture('viewport-query.sample.json');
      json['window'] = {
        'from': '2026-10-01T00:00:00Z',
        'to': '2026-11-01T00:00:00Z',
      };
      expect(
        ViewportQuery.fromJson(json).window.to
            .difference(ViewportQuery.fromJson(json).window.from),
        const Duration(days: 31),
      );
      json['window'] = {
        'from': '2026-10-01T00:00:00Z',
        'to': '2026-11-01T00:00:00.000001Z',
      };
      expect(() => ViewportQuery.fromJson(json), throwsA(anything));
    },
  );

  test('a historical statistical period is independent of the short request window', () {
    final json = fixture('viewport-query.sample.json');
    json['layers'] = ['rent'];
    json['areaFilter'] = {
      'indicatorId': 'sample.weeklyRent',
      'periodId': '2025-Q3',
      'periodStart': '2025-07-01',
      'periodEnd': '2025-10-01',
      'propertyType': 'all',
      'boundaryVintage': 'sample-2021',
    };
    final query = ViewportQuery.fromJson(json);
    expect(query.areaFilter!.periodStart, '2025-07-01');
    expect(query.areaFilter!.periodEnd, '2025-10-01');
    json['window'] = {
      'from': '2026-10-01T00:00:00Z',
      'to': '2026-11-01T00:00:00.000001Z',
    };
    expect(() => ViewportQuery.fromJson(json), throwsA(anything));
  });

  test(
    'unknown source clock text is retained independently of UTC instants',
    () {
      final json = fixture('item.sample.json');
      final time =
          (json['item'] as Map<String, dynamic>)['time']
              as Map<String, dynamic>;
      time['observedAt'] = null;
      time['sourceTimeText'] = '01 Oct 2026 10:59';
      time['sourceTimezone'] = 'unknown';
      final item = MapItemResponse.fromJson(json).item;
      expect(item.time.observedAt, isNull);
      expect(item.time.sourceTimeText, '01 Oct 2026 10:59');
      expect(item.time.sourceTimezone, 'unknown');
    },
  );

  test('GeoJSON rejects reversed Melbourne coordinates and unclosed rings', () {
    expect(
      () => GeoJsonGeometry.fromJson({
        'type': 'Point',
        'coordinates': [-37.818, 144.967],
      }),
      throwsA(anything),
    );
    expect(
      () => GeoJsonGeometry.fromJson({
        'type': 'Polygon',
        'coordinates': [
          [
            [144.96, -37.82],
            [144.97, -37.82],
            [144.97, -37.81],
            [144.96, -37.81],
          ],
        ],
      }),
      throwsA(anything),
    );
    expect(
      () => GeoJsonGeometry.fromJson({
        'type': 'Point',
        'coordinates': [144.96, -37.82, 4],
      }),
      throwsA(anything),
    );
  });

  test('sensor location must cover the observation, and news mentions remain unlocated', () {
    final json = fixture('item.sample.json');
    final item = json['item'] as Map<String, dynamic>;
    (item['details'] as Map<String, dynamic>)['locationValidFrom'] =
        '2026-10-01T01:00:00Z';
    expect(() => MapItemResponse.fromJson(json), throwsA(anything));

    final examples =
        readSharedMapFixture('item-variants.sample.json') as List<dynamic>;
    final news = examples.cast<Map<String, dynamic>>().firstWhere(
      (item) => item['kind'] == 'news',
    );
    news['geometry'] = {
      'type': 'Point',
      'coordinates': [144.967, -37.818],
    };
    (news['location'] as Map<String, dynamic>)['precision'] = 'point';
    (news['location'] as Map<String, dynamic>)['role'] = 'mention';
    expect(() => MapItem.fromJson(news), throwsA(anything));
  });

  test(
    'grid anomaly ratio uses classified sensors and has no zero denominator',
    () {
      final grid = <String, dynamic>{
        'cellId': 'sample.cell',
        'resolution': 9,
        'validSensorCount': 3,
        'observedSensorCount': 2,
        'classifiedSensorCount': 1,
        'unclassifiedSensorCount': 1,
        'anomalousSensorCount': 1,
        'baselineDefinitionId': 'sample.baseline',
        'anomalyRatio': 1.0,
      };
      expect(GridDetails.fromJson(grid).anomalyRatio, 1);
      expect(
        () => GridDetails.fromJson({...grid, 'anomalyRatio': 0.5}),
        throwsA(anything),
      );
      expect(
        () => GridDetails.fromJson({
          ...grid,
          'classifiedSensorCount': 0,
          'unclassifiedSensorCount': 2,
          'anomalousSensorCount': 0,
          'anomalyRatio': 0,
        }),
        throwsA(anything),
      );
    },
  );

  test('request continuation and declared geographic filters are explicit', () {
    final query = ViewportQuery.fromJson(fixture('viewport-query.sample.json'));
    expect(query.bbox.west, 144.95);
    expect(query.zoom, 14);
    expect(
      () => ViewportQuery.fromJson({
        ...query.toJson(),
        'cursor': 'sample-cursor',
      }),
      throwsA(anything),
    );
    expect(
      () => ViewportQuery.fromJson({
        ...query.toJson(),
        'layers': ['boundary'],
      }),
      throwsA(anything),
    );
    expect(
      () => ViewportQuery.fromJson({
        ...query.toJson(),
        'layers': ['rent'],
      }),
      throwsA(anything),
    );
  });
}
