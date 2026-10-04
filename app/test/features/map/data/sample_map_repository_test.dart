import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';

Map<String, dynamic> _fixture(String name) => jsonDecode(
  File('../specs/002-map-data-presentation/contracts/examples/$name')
      .readAsStringSync(),
) as Map<String, dynamic>;

Object? _normalize(Object? value) {
  if (value is String && RegExp(r'^\d{4}-\d{2}-\d{2}T.*Z$').hasMatch(value)) {
    return DateTime.parse(value).toUtc().toIso8601String();
  }
  if (value is List) return value.map(_normalize).toList();
  if (value is Map<String, dynamic>) {
    return value.map((key, child) => MapEntry(key, _normalize(child)));
  }
  return value;
}

ViewportQuery _query({
  String requestId = 'test-request',
  MapQueryMode mode = MapQueryMode.current,
}) {
  final json = _fixture('viewport-query.sample.json');
  json['requestId'] = requestId;
  json['mode'] = mode.name;
  if (mode == MapQueryMode.historical) {
    json['window'] = {
      'from': '2026-09-30T00:59:00Z',
      'to': '2026-09-30T01:00:00Z',
    };
  }
  return ViewportQuery.fromJson(json);
}

UnlocatedQuery _unlocatedQuery({
  String scope = 'Sample Melbourne source jurisdiction',
}) => UnlocatedQuery(
  requestId: 'unlocated-request',
  layers: const [MapLayerId.pedestrian],
  mode: MapQueryMode.current,
  window: TimeWindow(
    from: DateTime.utc(2026, 10, 1, 0, 59),
    to: DateTime.utc(2026, 10, 1, 1),
  ),
  scope: UnlocatedScope.sourceJurisdiction(scope),
);

void main() {
  const fixtureNames = {
    SampleMapScenario.available: 'viewport.sample.json',
    SampleMapScenario.noMatching: 'no-matching.sample.json',
    SampleMapScenario.notCovered: 'not-covered.sample.json',
    SampleMapScenario.unavailable: 'unavailable.sample.json',
    SampleMapScenario.unknown: 'unknown.sample.json',
    SampleMapScenario.historical: 'historical.sample.json',
    SampleMapScenario.partial: 'partial.sample.json',
  };

  for (final entry in fixtureNames.entries) {
    test(
      '${entry.key.name} mirrors the shared envelope and stays visibly sample',
      () async {
        final repository = SampleMapRepository(scenario: entry.key);
        expect(
          _normalize(repository.scenarioResponse.toJson()),
          _normalize(_fixture(entry.value)),
        );
        final response = await repository.queryViewport(
          _query(
            mode: entry.key == SampleMapScenario.historical
                ? MapQueryMode.historical
                : MapQueryMode.current,
          ),
        );
        expect(response.dataMode, MapDataMode.sample);
        expect(response.requestId, 'test-request');
        expect(response.generatedAt, DateTime.utc(2026, 10, 1, 1));
      },
    );
  }

  test(
    'catalog, detail and scoped pages use the canonical sample evidence',
    () async {
      const repository = SampleMapRepository();
      final catalog = await repository.getLayers();
      expect(catalog.dataMode, MapDataMode.sample);
      expect(
        _normalize(catalog.toJson()),
        _normalize(_fixture('catalog.sample.json')),
      );
      final detail = await repository.getItem(
        'sample.sensor.A',
        const MapReadContext(
          requestId: 'sample-request',
          snapshotId: 'sample-snapshot',
        ),
      );
      expect(
        _normalize(detail.toJson()),
        _normalize(_fixture('item.sample.json')),
      );
      final unlocated = await repository.getUnlocated(_unlocatedQuery());
      final missing = unlocated.items.single as PedestrianMapItem;
      expect(missing.geometry, isNull);
      expect(missing.details.totalCount, isNull);
      expect(unlocated.dataMode, MapDataMode.sample);
      expect(unlocated.totalMatching, 1);
      final members = await repository.getAggregateMembers(
        'sample.aggregate',
        const AggregateMembersQuery(
          requestId: 'sample-request',
          snapshotId: 'sample-snapshot',
        ),
      );
      expect(
        _normalize(members.toJson()),
        _normalize(_fixture('members.sample.json')),
      );
    },
  );

  test(
    'a missing layer or out-of-sample time does not invent live coverage',
    () async {
      const repository = SampleMapRepository();
      final queryJson = _query().toJson()
        ..['layers'] = ['pedestrian', 'disruption'];
      final response = await repository.queryViewport(
        ViewportQuery.fromJson(queryJson),
      );
      final traffic = response.layers.last;
      expect(traffic.state, MapLayerState.unknown);
      expect(traffic.totalMatching, isNull);
      expect(traffic.coverage.state, MapCoverageState.unknown);

      queryJson['window'] = {
        'from': '2026-10-02T00:59:00Z',
        'to': '2026-10-02T01:00:00Z',
      };
      final future = await repository.queryViewport(
        ViewportQuery.fromJson(queryJson),
      );
      expect(
        future.layers.every((layer) => layer.state == MapLayerState.unknown),
        isTrue,
      );
    },
  );

  test(
    'a narrow viewport or bounded page cannot claim an exact whole-query total',
    () async {
      const repository = SampleMapRepository();
      final queryJson = _query().toJson()
        ..['bbox'] = [144.9675, -37.82, 144.97, -37.815];
      final response = await repository.queryViewport(
        ViewportQuery.fromJson(queryJson),
      );
      expect(response.layers.single.items, isEmpty);
      expect(response.layers.single.state, MapLayerState.unknown);
      expect(response.layers.single.totalMatching, isNull);

      final bounded = await repository.queryViewport(
        ViewportQuery.fromJson(_query().toJson()..['pageSize'] = 1),
      );
      expect(bounded.layers.single.items, hasLength(1));
      expect(bounded.layers.single.completeness, MapCompleteness.partial);
      expect(bounded.layers.single.totalMatching, isNull);
    },
  );

  test('historical mode uses fixed historical observations without changing the clock', () async {
    const repository = SampleMapRepository(
      scenario: SampleMapScenario.historical,
    );
    final response = await repository.queryViewport(
      _query(mode: MapQueryMode.historical),
    );
    expect(response.mode, MapQueryMode.historical);
    expect(response.layers.single.freshness, MapFreshness.versioned);
    expect(
      response.layers.single.items.first.time.observedAt,
      DateTime.utc(2026, 9, 30, 0, 59),
    );
    expect(response.dataMode, MapDataMode.sample);
    final detail = await repository.getItem(
      'sample.sensor.A',
      const MapReadContext(
        requestId: 'historical-detail',
        snapshotId: 'sample-snapshot',
      ),
    );
    expect(detail.mode, MapQueryMode.historical);
    expect(
      detail.item.time.observedAt,
      response.layers.single.items.first.time.observedAt,
    );
  });

  test(
    'unknown unlocated scope stays partial instead of claiming zero passages',
    () async {
      final response = await const SampleMapRepository().getUnlocated(
        _unlocatedQuery(scope: 'Unknown jurisdiction'),
      );
      expect(response.items, isEmpty);
      expect(response.totalMatching, isNull);
      expect(response.completeness, MapCompleteness.partial);
    },
  );

  test('snapshot mismatch, unavailable detail and unknown ids stay explicit errors', () async {
    const repository = SampleMapRepository();
    await expectLater(
      repository.getItem(
        'sample.sensor.A',
        const MapReadContext(
          requestId: 'detail-request',
          snapshotId: 'expired-snapshot',
        ),
      ),
      throwsA(
        isA<MapHttpException>().having(
          (error) => error.code,
          'code',
          MapServiceErrorCode.snapshotExpired,
        ),
      ),
    );
    await expectLater(
      repository.getItem(
        'missing-id',
        const MapReadContext(
          requestId: 'detail-request',
          snapshotId: 'sample-snapshot',
        ),
      ),
      throwsA(
        isA<MapHttpException>().having(
          (error) => error.code,
          'code',
          MapServiceErrorCode.notFound,
        ),
      ),
    );
    await expectLater(
      const SampleMapRepository(scenario: SampleMapScenario.unavailable)
          .getItem(
            'sample.sensor.A',
            const MapReadContext(
              requestId: 'detail-request',
              snapshotId: 'sample-snapshot',
            ),
          ),
      throwsA(
        isA<MapHttpException>().having(
          (error) => error.code,
          'code',
          MapServiceErrorCode.notAvailable,
        ),
      ),
    );
  });

  test('cancelled sample requests cannot publish results', () async {
    final cancellation = MapRequestCancellation()..cancel();
    const repository = SampleMapRepository();
    await expectLater(
      repository.getLayers(cancellation: cancellation),
      throwsA(isA<MapRequestCancelled>()),
    );
    await expectLater(
      repository.queryViewport(_query(), cancellation: cancellation),
      throwsA(isA<MapRequestCancelled>()),
    );
    await expectLater(
      repository.getUnlocated(_unlocatedQuery(), cancellation: cancellation),
      throwsA(isA<MapRequestCancelled>()),
    );
  });

  test('invalid direct constructors still meet the request boundary', () async {
    final query = _query();
    final invalid = ViewportQuery(
      requestId: query.requestId,
      bbox: query.bbox,
      zoom: double.nan,
      layers: query.layers,
      mode: query.mode,
      window: query.window,
    );
    await expectLater(
      const SampleMapRepository().queryViewport(invalid),
      throwsA(isA<MapRequestException>()),
    );
  });
}
