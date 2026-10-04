import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';

final t017Instant = DateTime.utc(2026, 10, 1, 1);
const t017Region = MapBounds(
  west: 144.95,
  south: -37.83,
  east: 144.98,
  north: -37.8,
);

Map<String, dynamic> t017Fixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;

ViewportResponse t017Response(
  ViewportQuery query, {
  String? requestId,
  MapDataMode dataMode = MapDataMode.sample,
  bool partial = false,
}) {
  final json = t017Fixture(partial ? 'partial' : 'viewport');
  json['requestId'] = requestId ?? query.requestId;
  json['mode'] = query.mode.name;
  json['dataMode'] = dataMode.name;
  final original =
      (json['layers'] as List<dynamic>).single as Map<String, dynamic>;
  json['layers'] = [
    for (final layer in query.layers)
      if (layer == MapLayerId.pedestrian)
        original
      else
        <String, dynamic>{
          'layerId': layer.name,
          'state': 'unknown',
          'freshness': 'unknown',
          'completeness': 'complete',
          'sourceIds': <String>[],
          'coverage': {
            'state': 'unknown',
            'areaRefs': <String>[],
            'window': null,
            'evidenceSourceIds': <String>[],
          },
          'observedWindow': null,
          'updatedAt': null,
          'items': <Object?>[],
          'unresolvedCount': null,
          'nextCursor': null,
          'totalMatching': null,
        },
  ];
  return ViewportResponse.fromJson(json);
}

final class T017PendingViewport {
  T017PendingViewport(this.query, this.cancellation);
  final ViewportQuery query;
  final MapRequestCancellation? cancellation;
  final result = Completer<ViewportResponse>();
}

final class T017Repository implements MapRepository {
  T017Repository({this.autoComplete = false});
  final bool autoComplete;
  final queries = <T017PendingViewport>[];
  final unlocatedQueries = <UnlocatedQuery>[];
  final detailContexts = <MapReadContext>[];
  MapRepositoryException? nextViewportError;
  bool partial = false;
  final _samples = const SampleMapRepository();

  @override
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation}) =>
      _samples.getLayers(cancellation: cancellation);

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    final pending = T017PendingViewport(query, cancellation);
    queries.add(pending);
    if (autoComplete) {
      final error = nextViewportError;
      nextViewportError = null;
      if (error != null) {
        pending.result.completeError(error);
      } else {
        pending.result.complete(t017Response(query, partial: partial));
      }
    }
    return pending.result.future;
  }

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) {
    detailContexts.add(context);
    return _samples.getItem(id, context, cancellation: cancellation);
  }

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    unlocatedQueries.add(query);
    return _samples.getUnlocated(query, cancellation: cancellation);
  }

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) => _samples.getAggregateMembers(id, query, cancellation: cancellation);
}
