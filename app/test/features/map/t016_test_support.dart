import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';

Map<String, dynamic> t016Fixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;

MapItem t016Item() => MapItemResponse.fromJson(t016Fixture('item')).item;
MapItemPage t016Page() => MapItemPage.fromJson(t016Fixture('unlocated'));

MapItemResponse t016Details(MapItem item, MapReadContext context) =>
    MapItemResponse(
      schemaVersion: 1,
      requestId: context.requestId,
      snapshotId: context.snapshotId,
      generatedAt: DateTime.utc(2026, 10, 1, 1),
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
      item: item,
    );

MapItemPage t016PageFor(
  UnlocatedQuery query, {
  String snapshotId = 'list-snapshot',
  List<MapItem>? items,
  MapCompleteness completeness = MapCompleteness.complete,
  String? nextCursor,
  int? totalMatching,
}) => MapItemPage(
  schemaVersion: 1,
  requestId: query.requestId,
  snapshotId: snapshotId,
  generatedAt: DateTime.utc(2026, 10, 1, 1),
  mode: query.mode,
  dataMode: MapDataMode.sample,
  items: items ?? t016Page().items,
  completeness: completeness,
  nextCursor: nextCursor,
  totalMatching: totalMatching,
  scope: switch (query.scope) {
    AreaRefsScope(:final areaRefs) => PageScope.unlocated(
      areaRefs: areaRefs,
      sourceJurisdiction: null,
    ),
    SourceJurisdictionScope(:final sourceJurisdiction) => PageScope.unlocated(
      areaRefs: const [],
      sourceJurisdiction: sourceJurisdiction,
    ),
  },
);

final class T016DetailCall {
  T016DetailCall(this.id, this.context, this.cancellation);
  final String id;
  final MapReadContext context;
  final MapRequestCancellation? cancellation;
  final result = Completer<MapItemResponse>();
}

final class T016ListCall {
  T016ListCall(this.query, this.cancellation);
  final UnlocatedQuery query;
  final MapRequestCancellation? cancellation;
  final result = Completer<MapItemPage>();
}

final class T016Repository implements MapRepository {
  final details = <T016DetailCall>[];
  final lists = <T016ListCall>[];

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) {
    final call = T016DetailCall(id, context, cancellation);
    details.add(call);
    return call.result.future;
  }

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    final call = T016ListCall(query, cancellation);
    lists.add(call);
    return call.result.future;
  }

  @override
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation}) =>
      throw UnimplementedError();

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();
}
