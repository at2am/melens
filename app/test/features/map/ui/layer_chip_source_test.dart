import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/layer_controller.dart';

import '../../../support/app_harness.dart';

/// The sample data, with a catalog that lists the pedestrian layer without
/// any published source, as the live catalog did on 2026-10-17.
final class _NoPedestrianSourceRepository implements MapRepository {
  final _inner = SampleMapRepository();

  @override
  Future<MapLayerCatalog> getLayers({
    MapRequestCancellation? cancellation,
  }) async {
    final json = jsonDecode(
      jsonEncode((await _inner.getLayers()).toJson()),
    ) as Map<String, dynamic>;
    for (final layer in json['layers'] as List<dynamic>) {
      final descriptor = layer as Map<String, dynamic>;
      if (descriptor['id'] == 'pedestrian') descriptor['sourceIds'] = <String>[];
    }
    return MapLayerCatalog.fromJson(json);
  }

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) => _inner.queryViewport(query, cancellation: cancellation);

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) => _inner.getItem(id, context, cancellation: cancellation);

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) => _inner.getUnlocated(query, cancellation: cancellation);

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) => _inner.getAggregateMembers(id, query, cancellation: cancellation);
}

void main() {
  testWidgets('a layer with no published source is shown off and disabled', (
    tester,
  ) async {
    final container = appContainer(
      mapRepository: _NoPedestrianSourceRepository(),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(1440, 900));
    await tester.tap(find.byKey(const ValueKey('tab-discover')));
    await tester.pumpAndSettle();

    final pedestrian = tester.widget<FilterChip>(
      find.byKey(const ValueKey('map-chip-pedestrian')),
    );
    expect(pedestrian.selected, isFalse);
    expect(pedestrian.onSelected, isNull);
    expect(find.text('Pedestrian counts · no data yet'), findsOneWidget);

    final anomaly = tester.widget<FilterChip>(
      find.byKey(const ValueKey('map-chip-anomaly')),
    );
    expect(anomaly.onSelected, isNotNull);
    expect(
      container
          .read(layerControllerProvider)
          .isLayerEnabled(MapLayerId.anomaly),
      isTrue,
    );
  });
}
