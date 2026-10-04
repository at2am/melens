import 'dart:convert';

import 'map_models.dart';
import 'map_repository.dart';

enum SampleMapScenario {
  available,
  noMatching,
  notCovered,
  unavailable,
  unknown,
  historical,
  partial,
}

/// Explicit, deterministic development data. This repository makes no requests.
final class SampleMapRepository implements MapRepository {
  const SampleMapRepository({this.scenario = SampleMapScenario.available});

  final SampleMapScenario scenario;

  ViewportResponse get scenarioResponse =>
      ViewportResponse.fromJson(_fixture(_scenarioFile(scenario)));

  @override
  Future<MapLayerCatalog> getLayers({
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    final json = _fixture('catalog.sample.json');
    final result = scenarioResponse.layers.single;
    final descriptors = (json['layers'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    final pedestrian = descriptors.firstWhere(
      (layer) => layer['id'] == 'pedestrian',
    );
    pedestrian['availability'] = switch (result.state) {
      MapLayerState.available || MapLayerState.noMatching => 'available',
      MapLayerState.notCovered => 'notCovered',
      MapLayerState.unavailable => 'unavailable',
      MapLayerState.unknown => 'unknown',
    };
    pedestrian['freshness'] = result.freshness.name;
    pedestrian['coverage'] = result.coverage.toJson();
    pedestrian['updatedAt'] = result.updatedAt?.toIso8601String();
    return MapLayerCatalog.fromJson(json);
  }

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    try {
      validateViewportQuery(query);
    } on FormatException {
      throw const MapRequestException();
    }
    final template = _responseForMode(query.mode);
    _requireSnapshot(query.snapshotId, template.snapshotId);
    if (query.cursor != null) _unsupportedContinuation();
    final json = template.toJson();
    json['requestId'] = query.requestId;
    final fixtureLayer = template.layers.single;
    final layers = <Map<String, dynamic>>[];
    for (final layerId in query.layers) {
      if (layerId != fixtureLayer.layerId) {
        layers.add(_unknownLayer(layerId));
        continue;
      }
      final layer = fixtureLayer.toJson();
      final coverage = fixtureLayer.coverage.window;
      final coveredWindow =
          coverage != null &&
          !query.window.from.isBefore(coverage.from) &&
          !query.window.to.isAfter(coverage.to);
      if (!coveredWindow &&
          fixtureLayer.state != MapLayerState.notCovered &&
          fixtureLayer.state != MapLayerState.unavailable &&
          fixtureLayer.state != MapLayerState.unknown) {
        layers.add(_unknownLayer(layerId));
        continue;
      }
      final items = fixtureLayer.items.where((item) {
        final geometry = item.geometry;
        if (geometry is! GeoJsonPoint) return false;
        if (!query.bbox.contains(
          geometry.coordinates[0],
          geometry.coordinates[1],
        )) {
          return false;
        }
        final observedAt = item.time.observedAt;
        return observedAt == null ||
            (!observedAt.isBefore(query.window.from) &&
                observedAt.isBefore(query.window.to));
      }).toList();
      // A narrow sample request cannot establish new coverage or full totals.
      if (items.length != fixtureLayer.items.length) {
        layer['items'] = items.map((item) => item.toJson()).toList();
        layer['state'] = items.isEmpty ? 'unknown' : 'available';
        layer['coverage'] = _unknownCoverage;
        layer['completeness'] = 'partial';
        layer['totalMatching'] = null;
        layer['unresolvedCount'] = null;
        layer['nextCursor'] = null;
      }
      if (query.pageSize != null && items.length > query.pageSize!) {
        layer['items'] = items
            .take(query.pageSize!)
            .map((item) => item.toJson())
            .toList();
        layer['completeness'] = 'partial';
        layer['totalMatching'] = null;
        layer['nextCursor'] = null;
      }
      layers.add(layer);
    }
    json['layers'] = layers;
    cancellation?.throwIfCancelled();
    return ViewportResponse.fromJson(json);
  }

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    _validateDetailRequest(id, context);
    final response = scenarioResponse;
    _requireSnapshot(context.snapshotId, response.snapshotId);
    if (response.layers.single.state == MapLayerState.unavailable ||
        response.layers.single.state == MapLayerState.notCovered ||
        response.layers.single.state == MapLayerState.unknown) {
      throw const MapHttpException(
        statusCode: 410,
        retryable: false,
        code: MapServiceErrorCode.notAvailable,
      );
    }
    final page = MapItemPage.fromJson(_fixture('unlocated.sample.json'));
    final candidates = [
      ...response.layers.single.items,
      if (scenario != SampleMapScenario.noMatching &&
          scenario != SampleMapScenario.historical)
        ...page.items,
    ];
    final matches = candidates.where((item) => item.id == id);
    if (matches.isEmpty) {
      throw const MapHttpException(
        statusCode: 404,
        retryable: false,
        code: MapServiceErrorCode.notFound,
      );
    }
    final json = _fixture('item.sample.json');
    json['requestId'] = context.requestId;
    json['mode'] = response.mode.name;
    json['item'] = matches.first.toJson();
    return MapItemResponse.fromJson(json);
  }

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    try {
      validateUnlocatedQuery(query);
    } on FormatException {
      throw const MapRequestException();
    }
    final response = _responseForMode(query.mode);
    _requireSnapshot(query.snapshotId, response.snapshotId);
    if (query.cursor != null) _unsupportedContinuation();
    final json = _fixture('unlocated.sample.json');
    json['requestId'] = query.requestId;
    json['mode'] = query.mode.name;
    final originalScope =
        MapItemPage.fromJson(json).scope as UnlocatedPageScope;
    final knownScope =
        query.scope is SourceJurisdictionScope &&
        (query.scope as SourceJurisdictionScope).sourceJurisdiction ==
            originalScope.sourceJurisdiction;
    json['scope'] = switch (query.scope) {
      AreaRefsScope(:final areaRefs) => {
        'kind': 'unlocated',
        'areaRefs': areaRefs,
        'sourceJurisdiction': null,
      },
      SourceJurisdictionScope(:final sourceJurisdiction) => {
        'kind': 'unlocated',
        'areaRefs': <String>[],
        'sourceJurisdiction': sourceJurisdiction,
      },
    };
    final containsSampleData =
        query.layers.contains(MapLayerId.pedestrian) &&
        knownScope &&
        response.mode == MapQueryMode.current &&
        response.layers.single.state == MapLayerState.available &&
        (json['items'] as List<dynamic>).every((value) {
          final item = MapItem.fromJson(value as Map<String, dynamic>);
          final observedAt = item.time.observedAt;
          return observedAt != null &&
              !observedAt.isBefore(query.window.from) &&
              observedAt.isBefore(query.window.to);
        });
    if (!containsSampleData) {
      json['items'] = <Object?>[];
      json['completeness'] = 'partial';
      json['totalMatching'] = null;
    }
    return MapItemPage.fromJson(json);
  }

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    try {
      AggregateMembersQuery.fromJson(query.toJson());
      _validateDetailRequest(
        id,
        MapReadContext(
          requestId: query.requestId,
          snapshotId: query.snapshotId,
        ),
      );
    } catch (_) {
      throw const MapRequestException();
    }
    _requireSnapshot(query.snapshotId, scenarioResponse.snapshotId);
    if (query.cursor != null) _unsupportedContinuation();
    if (scenario != SampleMapScenario.available &&
        scenario != SampleMapScenario.partial) {
      throw const MapHttpException(
        statusCode: 410,
        retryable: false,
        code: MapServiceErrorCode.notAvailable,
      );
    }
    final json = _fixture('members.sample.json');
    final scope = json['scope'] as Map<String, dynamic>;
    if (id != scope['aggregateId']) {
      throw const MapHttpException(
        statusCode: 404,
        retryable: false,
        code: MapServiceErrorCode.notFound,
      );
    }
    json['requestId'] = query.requestId;
    if (query.pageSize != null &&
        (json['items'] as List<dynamic>).length > query.pageSize!) {
      json['items'] = (json['items'] as List<dynamic>)
          .take(query.pageSize!)
          .toList();
      json['completeness'] = 'partial';
      json['totalMatching'] = null;
    }
    return MapItemPage.fromJson(json);
  }

  ViewportResponse _responseForMode(MapQueryMode mode) {
    final response = scenarioResponse;
    if (mode != response.mode) throw const MapRequestException();
    return response;
  }

  static void _validateDetailRequest(String id, MapReadContext context) {
    if (id.isEmpty || id.length > 256 || RegExp(r'\s').hasMatch(id)) {
      throw const MapRequestException();
    }
    try {
      MapReadContext.fromJson(context.toJson());
    } catch (_) {
      throw const MapRequestException();
    }
  }

  static void _requireSnapshot(String? requested, String expected) {
    if (requested != null && requested != expected) {
      throw const MapHttpException(
        statusCode: 409,
        retryable: true,
        code: MapServiceErrorCode.snapshotExpired,
      );
    }
  }

  static Never _unsupportedContinuation() => throw const MapHttpException(
    statusCode: 410,
    retryable: false,
    code: MapServiceErrorCode.notAvailable,
  );
}

String _scenarioFile(SampleMapScenario scenario) => switch (scenario) {
  SampleMapScenario.available => 'viewport.sample.json',
  SampleMapScenario.noMatching => 'no-matching.sample.json',
  SampleMapScenario.notCovered => 'not-covered.sample.json',
  SampleMapScenario.unavailable => 'unavailable.sample.json',
  SampleMapScenario.unknown => 'unknown.sample.json',
  SampleMapScenario.historical => 'historical.sample.json',
  SampleMapScenario.partial => 'partial.sample.json',
};

Map<String, dynamic> _fixture(String name) =>
    jsonDecode(_sampleEnvelopes[name]!) as Map<String, dynamic>;

const _unknownCoverage = <String, Object?>{
  'state': 'unknown',
  'areaRefs': <String>[],
  'window': null,
  'evidenceSourceIds': <String>[],
};

Map<String, dynamic> _unknownLayer(MapLayerId layerId) => {
  'layerId': layerId.name,
  'state': 'unknown',
  'freshness': 'unknown',
  'completeness': 'partial',
  'sourceIds': <String>[],
  'coverage': _unknownCoverage,
  'observedWindow': null,
  'updatedAt': null,
  'items': <Object?>[],
  'unresolvedCount': null,
  'nextCursor': null,
  'totalMatching': null,
};

// Mirrors specs/002-map-data-presentation/contracts/examples. The parity test
// keeps these browser-safe embedded samples aligned with the shared contract.
const _sampleEnvelopes = <String, String>{
  'viewport.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "sample-request",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "layers": [
    {
      "layerId": "pedestrian",
      "state": "available",
      "freshness": "current",
      "completeness": "complete",
      "sourceIds": [
        "sample.pedestrian"
      ],
      "coverage": {
        "state": "verified",
        "areaRefs": [
          "sample.melbourne"
        ],
        "window": {
          "from": "2026-10-01T00:45:00Z",
          "to": "2026-10-01T01:00:00Z"
        },
        "evidenceSourceIds": [
          "sample.pedestrian"
        ]
      },
      "observedWindow": {
        "from": "2026-10-01T00:59:00Z",
        "to": "2026-10-01T01:00:00Z"
      },
      "updatedAt": "2026-10-01T01:00:00Z",
      "items": [
        {
          "id": "sample.sensor.A",
          "versionId": "sample-v1",
          "layerId": "pedestrian",
          "kind": "pedestrian",
          "title": "Sample sensor A",
          "geometry": {
            "type": "Point",
            "coordinates": [
              144.967,
              -37.818
            ]
          },
          "location": {
            "precision": "point",
            "role": "sensor",
            "evidence": "Synthetic development fixture"
          },
          "assertionKind": "observation",
          "lifecycle": "active",
          "time": {
            "observedAt": "2026-10-01T00:59:00Z",
            "reportedAt": null,
            "validFrom": null,
            "validTo": null,
            "periodLabel": null,
            "fetchedAt": "2026-10-01T01:00:00Z",
            "sourceTimeText": null,
            "sourceTimezone": null
          },
          "sources": [
            {
              "sourceId": "sample.pedestrian",
              "url": null,
              "attribution": "Illustrative sample data",
              "versionRef": "sample-v1"
            }
          ],
          "details": {
            "sensorId": "sample.A",
            "totalCount": 12,
            "directionACount": null,
            "directionBCount": null,
            "granularity": "minute",
            "window": {
              "from": "2026-10-01T00:59:00Z",
              "to": "2026-10-01T01:00:00Z"
            },
            "locationValidFrom": "2026-09-30T00:00:00Z",
            "locationValidTo": null,
            "locationStatus": "located"
          }
        },
        {
          "id": "sample.sensor.B",
          "versionId": "sample-v1",
          "layerId": "pedestrian",
          "kind": "pedestrian",
          "title": "Sample sensor B",
          "geometry": {
            "type": "Point",
            "coordinates": [
              144.965,
              -37.817
            ]
          },
          "location": {
            "precision": "point",
            "role": "sensor",
            "evidence": "Synthetic development fixture"
          },
          "assertionKind": "observation",
          "lifecycle": "active",
          "time": {
            "observedAt": "2026-10-01T00:59:00Z",
            "reportedAt": null,
            "validFrom": null,
            "validTo": null,
            "periodLabel": null,
            "fetchedAt": "2026-10-01T01:00:00Z",
            "sourceTimeText": null,
            "sourceTimezone": null
          },
          "sources": [
            {
              "sourceId": "sample.pedestrian",
              "url": null,
              "attribution": "Illustrative sample data",
              "versionRef": "sample-v1"
            }
          ],
          "details": {
            "sensorId": "sample.B",
            "totalCount": 0,
            "directionACount": null,
            "directionBCount": null,
            "granularity": "minute",
            "window": {
              "from": "2026-10-01T00:59:00Z",
              "to": "2026-10-01T01:00:00Z"
            },
            "locationValidFrom": "2026-09-30T00:00:00Z",
            "locationValidTo": null,
            "locationStatus": "located"
          }
        }
      ],
      "unresolvedCount": 1,
      "nextCursor": null,
      "totalMatching": 2
    }
  ]
}
''',
  'no-matching.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "no-matching.sample.json",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "layers": [
    {
      "layerId": "pedestrian",
      "state": "noMatching",
      "freshness": "current",
      "completeness": "complete",
      "sourceIds": [
        "sample.pedestrian"
      ],
      "coverage": {
        "state": "verified",
        "areaRefs": [
          "sample.melbourne"
        ],
        "window": {
          "from": "2026-10-01T00:45:00Z",
          "to": "2026-10-01T01:00:00Z"
        },
        "evidenceSourceIds": [
          "sample.pedestrian"
        ]
      },
      "observedWindow": null,
      "updatedAt": "2026-10-01T01:00:00Z",
      "items": [],
      "unresolvedCount": 0,
      "nextCursor": null,
      "totalMatching": 0
    }
  ]
}
''',
  'not-covered.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "not-covered.sample.json",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "layers": [
    {
      "layerId": "pedestrian",
      "state": "notCovered",
      "freshness": "unknown",
      "completeness": "complete",
      "sourceIds": [
        "sample.pedestrian"
      ],
      "coverage": {
        "state": "notCovered",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "observedWindow": null,
      "updatedAt": null,
      "items": [],
      "unresolvedCount": 0,
      "nextCursor": null,
      "totalMatching": null
    }
  ]
}
''',
  'unavailable.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "unavailable.sample.json",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "layers": [
    {
      "layerId": "pedestrian",
      "state": "unavailable",
      "freshness": "unknown",
      "completeness": "partial",
      "sourceIds": [
        "sample.pedestrian"
      ],
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "observedWindow": null,
      "updatedAt": null,
      "items": [],
      "unresolvedCount": 0,
      "nextCursor": null,
      "totalMatching": null
    }
  ]
}
''',
  'unknown.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "unknown.sample.json",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "layers": [
    {
      "layerId": "pedestrian",
      "state": "unknown",
      "freshness": "unknown",
      "completeness": "partial",
      "sourceIds": [
        "sample.pedestrian"
      ],
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "observedWindow": null,
      "updatedAt": null,
      "items": [],
      "unresolvedCount": 0,
      "nextCursor": null,
      "totalMatching": null
    }
  ]
}
''',
  'historical.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "sample-historical",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "historical",
  "dataMode": "sample",
  "layers": [
    {
      "layerId": "pedestrian",
      "state": "available",
      "freshness": "versioned",
      "completeness": "complete",
      "sourceIds": [
        "sample.pedestrian"
      ],
      "coverage": {
        "state": "verified",
        "areaRefs": [
          "sample.melbourne"
        ],
        "window": {
          "from": "2026-09-30T00:45:00Z",
          "to": "2026-09-30T01:00:00Z"
        },
        "evidenceSourceIds": [
          "sample.pedestrian"
        ]
      },
      "observedWindow": {
        "from": "2026-09-30T00:59:00Z",
        "to": "2026-09-30T01:00:00Z"
      },
      "updatedAt": "2026-10-01T01:00:00Z",
      "items": [
        {
          "id": "sample.sensor.A",
          "versionId": "sample-v1",
          "layerId": "pedestrian",
          "kind": "pedestrian",
          "title": "Sample sensor A",
          "geometry": {
            "type": "Point",
            "coordinates": [
              144.967,
              -37.818
            ]
          },
          "location": {
            "precision": "point",
            "role": "sensor",
            "evidence": "Synthetic development fixture"
          },
          "assertionKind": "observation",
          "lifecycle": "active",
          "time": {
            "observedAt": "2026-09-30T00:59:00Z",
            "reportedAt": null,
            "validFrom": null,
            "validTo": null,
            "periodLabel": null,
            "fetchedAt": "2026-10-01T01:00:00Z",
            "sourceTimeText": null,
            "sourceTimezone": null
          },
          "sources": [
            {
              "sourceId": "sample.pedestrian",
              "url": null,
              "attribution": "Illustrative sample data",
              "versionRef": "sample-v1"
            }
          ],
          "details": {
            "sensorId": "sample.A",
            "totalCount": 12,
            "directionACount": null,
            "directionBCount": null,
            "granularity": "minute",
            "window": {
              "from": "2026-09-30T00:59:00Z",
              "to": "2026-09-30T01:00:00Z"
            },
            "locationValidFrom": "2026-09-30T00:00:00Z",
            "locationValidTo": null,
            "locationStatus": "located"
          }
        },
        {
          "id": "sample.sensor.B",
          "versionId": "sample-v1",
          "layerId": "pedestrian",
          "kind": "pedestrian",
          "title": "Sample sensor B",
          "geometry": {
            "type": "Point",
            "coordinates": [
              144.965,
              -37.817
            ]
          },
          "location": {
            "precision": "point",
            "role": "sensor",
            "evidence": "Synthetic development fixture"
          },
          "assertionKind": "observation",
          "lifecycle": "active",
          "time": {
            "observedAt": "2026-09-30T00:59:00Z",
            "reportedAt": null,
            "validFrom": null,
            "validTo": null,
            "periodLabel": null,
            "fetchedAt": "2026-10-01T01:00:00Z",
            "sourceTimeText": null,
            "sourceTimezone": null
          },
          "sources": [
            {
              "sourceId": "sample.pedestrian",
              "url": null,
              "attribution": "Illustrative sample data",
              "versionRef": "sample-v1"
            }
          ],
          "details": {
            "sensorId": "sample.B",
            "totalCount": 0,
            "directionACount": null,
            "directionBCount": null,
            "granularity": "minute",
            "window": {
              "from": "2026-09-30T00:59:00Z",
              "to": "2026-09-30T01:00:00Z"
            },
            "locationValidFrom": "2026-09-30T00:00:00Z",
            "locationValidTo": null,
            "locationStatus": "located"
          }
        }
      ],
      "unresolvedCount": 1,
      "nextCursor": null,
      "totalMatching": 2
    }
  ]
}
''',
  'partial.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "sample-partial",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "layers": [
    {
      "layerId": "pedestrian",
      "state": "available",
      "freshness": "current",
      "completeness": "partial",
      "sourceIds": [
        "sample.pedestrian"
      ],
      "coverage": {
        "state": "verified",
        "areaRefs": [
          "sample.melbourne"
        ],
        "window": {
          "from": "2026-10-01T00:45:00Z",
          "to": "2026-10-01T01:00:00Z"
        },
        "evidenceSourceIds": [
          "sample.pedestrian"
        ]
      },
      "observedWindow": {
        "from": "2026-10-01T00:59:00Z",
        "to": "2026-10-01T01:00:00Z"
      },
      "updatedAt": "2026-10-01T01:00:00Z",
      "items": [
        {
          "id": "sample.sensor.A",
          "versionId": "sample-v1",
          "layerId": "pedestrian",
          "kind": "pedestrian",
          "title": "Sample sensor A",
          "geometry": {
            "type": "Point",
            "coordinates": [
              144.967,
              -37.818
            ]
          },
          "location": {
            "precision": "point",
            "role": "sensor",
            "evidence": "Synthetic development fixture"
          },
          "assertionKind": "observation",
          "lifecycle": "active",
          "time": {
            "observedAt": "2026-10-01T00:59:00Z",
            "reportedAt": null,
            "validFrom": null,
            "validTo": null,
            "periodLabel": null,
            "fetchedAt": "2026-10-01T01:00:00Z",
            "sourceTimeText": null,
            "sourceTimezone": null
          },
          "sources": [
            {
              "sourceId": "sample.pedestrian",
              "url": null,
              "attribution": "Illustrative sample data",
              "versionRef": "sample-v1"
            }
          ],
          "details": {
            "sensorId": "sample.A",
            "totalCount": 12,
            "directionACount": null,
            "directionBCount": null,
            "granularity": "minute",
            "window": {
              "from": "2026-10-01T00:59:00Z",
              "to": "2026-10-01T01:00:00Z"
            },
            "locationValidFrom": "2026-09-30T00:00:00Z",
            "locationValidTo": null,
            "locationStatus": "located"
          }
        },
        {
          "id": "sample.sensor.B",
          "versionId": "sample-v1",
          "layerId": "pedestrian",
          "kind": "pedestrian",
          "title": "Sample sensor B",
          "geometry": {
            "type": "Point",
            "coordinates": [
              144.965,
              -37.817
            ]
          },
          "location": {
            "precision": "point",
            "role": "sensor",
            "evidence": "Synthetic development fixture"
          },
          "assertionKind": "observation",
          "lifecycle": "active",
          "time": {
            "observedAt": "2026-10-01T00:59:00Z",
            "reportedAt": null,
            "validFrom": null,
            "validTo": null,
            "periodLabel": null,
            "fetchedAt": "2026-10-01T01:00:00Z",
            "sourceTimeText": null,
            "sourceTimezone": null
          },
          "sources": [
            {
              "sourceId": "sample.pedestrian",
              "url": null,
              "attribution": "Illustrative sample data",
              "versionRef": "sample-v1"
            }
          ],
          "details": {
            "sensorId": "sample.B",
            "totalCount": 0,
            "directionACount": null,
            "directionBCount": null,
            "granularity": "minute",
            "window": {
              "from": "2026-10-01T00:59:00Z",
              "to": "2026-10-01T01:00:00Z"
            },
            "locationValidFrom": "2026-09-30T00:00:00Z",
            "locationValidTo": null,
            "locationStatus": "located"
          }
        }
      ],
      "unresolvedCount": 1,
      "nextCursor": "sample-continuation",
      "totalMatching": null
    }
  ]
}
''',
  'catalog.sample.json': r'''
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-01T01:00:00Z",
  "dataMode": "sample",
  "serviceBounds": [
    144,
    -39,
    146.5,
    -37
  ],
  "layers": [
    {
      "id": "pedestrian",
      "titleKey": "mapLayerPedestrian",
      "topic": "cityActivity",
      "defaultEnabled": true,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.pedestrian"
      ],
      "availability": "available",
      "freshness": "current",
      "coverage": {
        "state": "verified",
        "areaRefs": [
          "sample.melbourne"
        ],
        "window": {
          "from": "2026-10-01T00:45:00Z",
          "to": "2026-10-01T01:00:00Z"
        },
        "evidenceSourceIds": [
          "sample.pedestrian"
        ]
      },
      "timeSemantics": "observationWindow",
      "updatedAt": "2026-10-01T01:00:00Z"
    },
    {
      "id": "anomaly",
      "titleKey": "mapLayerAnomaly",
      "topic": "cityActivity",
      "defaultEnabled": true,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.anomaly"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "observationWindow",
      "updatedAt": null
    },
    {
      "id": "disruption",
      "titleKey": "mapLayerDisruption",
      "topic": "cityActivity",
      "defaultEnabled": true,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.disruption"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "effectiveInterval",
      "updatedAt": null
    },
    {
      "id": "event",
      "titleKey": "mapLayerEvent",
      "topic": "cityActivity",
      "defaultEnabled": false,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.event"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "effectiveInterval",
      "updatedAt": null
    },
    {
      "id": "planning",
      "titleKey": "mapLayerPlanning",
      "topic": "cityActivity",
      "defaultEnabled": false,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.planning"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "effectiveInterval",
      "updatedAt": null
    },
    {
      "id": "boundary",
      "titleKey": "mapLayerBoundary",
      "topic": "context",
      "defaultEnabled": false,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.boundary"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "boundaryVintage",
      "updatedAt": null
    },
    {
      "id": "news",
      "titleKey": "mapLayerNews",
      "topic": "nearbyNews",
      "defaultEnabled": false,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.news"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "reportedAt",
      "updatedAt": null
    },
    {
      "id": "rent",
      "titleKey": "mapLayerRent",
      "topic": "areaComparison",
      "defaultEnabled": false,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.rent"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "statisticalPeriod",
      "updatedAt": null
    },
    {
      "id": "census",
      "titleKey": "mapLayerCensus",
      "topic": "areaComparison",
      "defaultEnabled": false,
      "supportedModes": [
        "current",
        "historical"
      ],
      "sourceIds": [
        "sample.census"
      ],
      "availability": "unknown",
      "freshness": "unknown",
      "coverage": {
        "state": "unknown",
        "areaRefs": [],
        "window": null,
        "evidenceSourceIds": []
      },
      "timeSemantics": "statisticalPeriod",
      "updatedAt": null
    }
  ]
}
''',
  'item.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "sample-request",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "item": {
    "id": "sample.sensor.A",
    "versionId": "sample-v1",
    "layerId": "pedestrian",
    "kind": "pedestrian",
    "title": "Sample sensor A",
    "geometry": {
      "type": "Point",
      "coordinates": [
        144.967,
        -37.818
      ]
    },
    "location": {
      "precision": "point",
      "role": "sensor",
      "evidence": "Synthetic development fixture"
    },
    "assertionKind": "observation",
    "lifecycle": "active",
    "time": {
      "observedAt": "2026-10-01T00:59:00Z",
      "reportedAt": null,
      "validFrom": null,
      "validTo": null,
      "periodLabel": null,
      "fetchedAt": "2026-10-01T01:00:00Z",
      "sourceTimeText": null,
      "sourceTimezone": null
    },
    "sources": [
      {
        "sourceId": "sample.pedestrian",
        "url": null,
        "attribution": "Illustrative sample data",
        "versionRef": "sample-v1"
      }
    ],
    "details": {
      "sensorId": "sample.A",
      "totalCount": 12,
      "directionACount": null,
      "directionBCount": null,
      "granularity": "minute",
      "window": {
        "from": "2026-10-01T00:59:00Z",
        "to": "2026-10-01T01:00:00Z"
      },
      "locationValidFrom": "2026-09-30T00:00:00Z",
      "locationValidTo": null,
      "locationStatus": "located"
    }
  }
}
''',
  'unlocated.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "sample-request",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "items": [
    {
      "id": "sample.sensor.C",
      "versionId": "sample-v1",
      "layerId": "pedestrian",
      "kind": "pedestrian",
      "title": "Sample unlocated sensor",
      "geometry": null,
      "location": {
        "precision": "unlocated",
        "role": "unknown",
        "evidence": "Synthetic development fixture"
      },
      "assertionKind": "observation",
      "lifecycle": "active",
      "time": {
        "observedAt": "2026-10-01T00:59:00Z",
        "reportedAt": null,
        "validFrom": null,
        "validTo": null,
        "periodLabel": null,
        "fetchedAt": "2026-10-01T01:00:00Z",
        "sourceTimeText": null,
        "sourceTimezone": null
      },
      "sources": [
        {
          "sourceId": "sample.pedestrian",
          "url": null,
          "attribution": "Illustrative sample data",
          "versionRef": "sample-v1"
        }
      ],
      "details": {
        "sensorId": "sample.C",
        "totalCount": null,
        "directionACount": null,
        "directionBCount": null,
        "granularity": "minute",
        "window": {
          "from": "2026-10-01T00:59:00Z",
          "to": "2026-10-01T01:00:00Z"
        },
        "locationValidFrom": null,
        "locationValidTo": null,
        "locationStatus": "unlocated"
      }
    }
  ],
  "completeness": "complete",
  "nextCursor": null,
  "totalMatching": 1,
  "scope": {
    "kind": "unlocated",
    "areaRefs": [],
    "sourceJurisdiction": "Sample Melbourne source jurisdiction"
  }
}
''',
  'members.sample.json': r'''
{
  "schemaVersion": 1,
  "requestId": "sample-request",
  "snapshotId": "sample-snapshot",
  "generatedAt": "2026-10-01T01:00:00Z",
  "mode": "current",
  "dataMode": "sample",
  "items": [
    {
      "id": "sample.sensor.A",
      "versionId": "sample-v1",
      "layerId": "pedestrian",
      "kind": "pedestrian",
      "title": "Sample sensor A",
      "geometry": {
        "type": "Point",
        "coordinates": [
          144.967,
          -37.818
        ]
      },
      "location": {
        "precision": "point",
        "role": "sensor",
        "evidence": "Synthetic development fixture"
      },
      "assertionKind": "observation",
      "lifecycle": "active",
      "time": {
        "observedAt": "2026-10-01T00:59:00Z",
        "reportedAt": null,
        "validFrom": null,
        "validTo": null,
        "periodLabel": null,
        "fetchedAt": "2026-10-01T01:00:00Z",
        "sourceTimeText": null,
        "sourceTimezone": null
      },
      "sources": [
        {
          "sourceId": "sample.pedestrian",
          "url": null,
          "attribution": "Illustrative sample data",
          "versionRef": "sample-v1"
        }
      ],
      "details": {
        "sensorId": "sample.A",
        "totalCount": 12,
        "directionACount": null,
        "directionBCount": null,
        "granularity": "minute",
        "window": {
          "from": "2026-10-01T00:59:00Z",
          "to": "2026-10-01T01:00:00Z"
        },
        "locationValidFrom": "2026-09-30T00:00:00Z",
        "locationValidTo": null,
        "locationStatus": "located"
      }
    },
    {
      "id": "sample.sensor.B",
      "versionId": "sample-v1",
      "layerId": "pedestrian",
      "kind": "pedestrian",
      "title": "Sample sensor B",
      "geometry": {
        "type": "Point",
        "coordinates": [
          144.965,
          -37.817
        ]
      },
      "location": {
        "precision": "point",
        "role": "sensor",
        "evidence": "Synthetic development fixture"
      },
      "assertionKind": "observation",
      "lifecycle": "active",
      "time": {
        "observedAt": "2026-10-01T00:59:00Z",
        "reportedAt": null,
        "validFrom": null,
        "validTo": null,
        "periodLabel": null,
        "fetchedAt": "2026-10-01T01:00:00Z",
        "sourceTimeText": null,
        "sourceTimezone": null
      },
      "sources": [
        {
          "sourceId": "sample.pedestrian",
          "url": null,
          "attribution": "Illustrative sample data",
          "versionRef": "sample-v1"
        }
      ],
      "details": {
        "sensorId": "sample.B",
        "totalCount": 0,
        "directionACount": null,
        "directionBCount": null,
        "granularity": "minute",
        "window": {
          "from": "2026-10-01T00:59:00Z",
          "to": "2026-10-01T01:00:00Z"
        },
        "locationValidFrom": "2026-09-30T00:00:00Z",
        "locationValidTo": null,
        "locationStatus": "located"
      }
    }
  ],
  "completeness": "complete",
  "nextCursor": null,
  "totalMatching": 2,
  "scope": {
    "kind": "aggregateMembers",
    "aggregateId": "sample.aggregate",
    "bounds": [
      144.965,
      -37.819,
      144.968,
      -37.817
    ],
    "window": {
      "from": "2026-10-01T00:59:00Z",
      "to": "2026-10-01T01:00:00Z"
    },
    "unit": "sensor passages"
  }
}
''',
};
