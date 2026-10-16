import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/feed/data/feed_models.dart';
import 'package:melens/features/feed/data/melbourne_areas.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/state/viewport_controller.dart';

import '../../support/app_harness.dart';
import '../map/t017_test_support.dart';
import 'fake_feeds_client.dart';

Finder _key(String value) => find.byKey(ValueKey(value));
const _planningFeed = FeedSubscription(
  id: 'planning-feed',
  name: 'Planning',
  topics: {FeedTopic.planning},
  scope: AreaFeedScope(cbdAreaId),
);

void main() {
  const topic = FeedTopic.planning;
  testWidgets(
    '${topic.name} opens its Feed snapshot even when Discover has a newer record',
    (tester) async {
      final repository = _FeedRecordRepository(topic);
      final container = appContainer(
        mapRepository: repository,
        feeds: FakeFeedsClient([_planningFeed]),
      );
      await pumpApp(tester, container, size: const Size(1440, 900));

      // Discover has its own snapshot, with this layer switched off.
      await tester.tap(_key('tab-discover'));
      await tester.pumpAndSettle();
      expect(
        container.read(viewportControllerProvider).response!.snapshotId,
        'discover-snapshot',
      );
      expect(
        container.read(layerControllerProvider).enabledLayers,
        isNot(contains(topic.layer)),
      );
      await tester.tap(_key('tab-feed'));
      await tester.pumpAndSettle();

      await tester.tap(_key('feed-item-${repository.original.id}'));
      await tester.pumpAndSettle();

      final selected = container.read(selectionControllerProvider);
      expect(repository.reads, hasLength(1));
      expect(repository.reads.single.id, repository.original.id);
      expect(repository.reads.single.context.snapshotId, 'feed-snapshot');
      expect(selected.context!.snapshotId, 'feed-snapshot');
      expect(selected.item!.versionId, 'sample-v1');
      expect(selected.mode, MapQueryMode.current);
      expect(selected.dataMode, MapDataMode.sample);
      expect(selected.detailError, isNull);
      expect(selected.isLoading, isFalse);
      expect(
        container.read(layerControllerProvider).enabledLayers,
        contains(topic.layer),
      );
      final details = _key('map-details-scroll');
      expect(
        find.descendant(
          of: details,
          matching: find.text(repository.original.title),
        ),
        findsOneWidget,
      );
      expect(
        container
            .read(viewportControllerProvider)
            .response!
            .layers
            .expand((layer) => layer.items)
            .singleWhere((item) => item.id == repository.original.id)
            .versionId,
        'discover-newer-version',
      );
    },
  );
  testWidgets('an expired Feed snapshot reports expiry without a newer read', (
    tester,
  ) async {
    final repository = _FeedRecordRepository(FeedTopic.planning);
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_planningFeed]),
    );
    await pumpApp(tester, container, size: const Size(1440, 900));
    final card = _key('feed-item-${repository.original.id}');
    await tester.tap(card);
    await tester.pumpAndSettle();
    expect(repository.reads, hasLength(1));

    await tester.tap(_key('tab-feed'));
    await tester.pumpAndSettle();
    repository.expired = true;
    await tester.tap(card);
    await tester.pumpAndSettle();

    final selected = container.read(selectionControllerProvider);
    expect(repository.reads, hasLength(2));
    expect(
      repository.reads.map((read) => read.context.snapshotId),
      everyElement('feed-snapshot'),
    );
    expect(selected.item!.versionId, 'sample-v1');
    expect(selected.context!.snapshotId, 'feed-snapshot');
    expect(selected.detailError, isA<MapHttpException>());
    expect(
      (selected.detailError! as MapHttpException).code,
      MapServiceErrorCode.snapshotExpired,
    );
    expect(selected.canRetry, isFalse);
    expect(
      find.textContaining('The selected data snapshot has expired.'),
      findsOneWidget,
    );
    expect(
      repository.queries.where((q) => q.requestId.startsWith('feed-')),
      hasLength(1),
    );
  });

  testWidgets('a newer detail version replaces the one on the Feed card', (
    tester,
  ) async {
    final repository = _FeedRecordRepository(FeedTopic.planning)
      ..wrongDetailVersion = true;
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_planningFeed]),
    );
    await pumpApp(tester, container, size: const Size(1440, 900));
    await tester.tap(_key('feed-item-${repository.original.id}'));
    await tester.pumpAndSettle();

    final selected = container.read(selectionControllerProvider);
    expect(selected.item!.versionId, 'unexpected-new-version');
    expect(selected.detailError, isNull);
    expect(repository.reads.single.context.snapshotId, 'feed-snapshot');
  });

  testWidgets('a record without a location retains its own list snapshot', (
    tester,
  ) async {
    final repository = _FeedRecordRepository(FeedTopic.planning)
      ..unlocated = true;
    final container = appContainer(
      mapRepository: repository,
      feeds: FakeFeedsClient([_planningFeed.copyWith(includeUnlocated: true)]),
    );
    await pumpApp(tester, container, size: const Size(1440, 900));
    await tester.tap(_key('feed-item-${repository.original.id}'));
    await tester.pumpAndSettle();

    final selection = container.read(selectionControllerProvider);
    expect(
      repository.reads.single.context.snapshotId,
      'feed-unlocated-snapshot',
    );
    expect(selection.context!.snapshotId, 'feed-unlocated-snapshot');
    expect(selection.item!.geometry, isNull);
    expect(selection.item!.versionId, 'sample-v1');
    expect(selection.detailError, isNull);
  });
}

final class _RecordRead {
  const _RecordRead(this.id, this.context);
  final String id;
  final MapReadContext context;
}

final class _FeedRecordRepository implements MapRepository {
  _FeedRecordRepository(this.topic);

  final FeedTopic topic;
  final queries = <ViewportQuery>[];
  final reads = <_RecordRead>[];
  bool expired = false;
  bool wrongDetailVersion = false;
  bool unlocated = false;
  final samples = const SampleMapRepository();

  late final MapItem original = () {
    final variants = jsonDecode(
      File(
        '../specs/002-map-data-presentation/contracts/examples/'
        'item-variants.sample.json',
      ).readAsStringSync(),
    ) as List<dynamic>;
    final item = variants.cast<Map<String, dynamic>>().singleWhere(
      (item) => item['layerId'] == topic.layer!.name,
    );
    if (unlocated) {
      item['geometry'] = null;
      item['location'] = {
        'precision': 'unlocated',
        'role': 'unknown',
        'evidence': 'Synthetic development fixture',
      };
    }
    return MapItem.fromJson(item);
  }();

  @override
  Future<MapLayerCatalog> getLayers({
    MapRequestCancellation? cancellation,
  }) async {
    final catalog = await samples.getLayers(cancellation: cancellation);
    if (!unlocated) return catalog;
    final json = catalog.toJson();
    for (final descriptor
        in (json['layers'] as List<dynamic>).cast<Map<String, dynamic>>()) {
      if (descriptor['id'] == topic.layer!.name) {
        descriptor['coverage'] = {
          'state': 'verified',
          'areaRefs': ['sample.melbourne'],
          'window': null,
          'evidenceSourceIds': descriptor['sourceIds'],
        };
      }
    }
    return MapLayerCatalog.fromJson(json);
  }

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    queries.add(query);
    final feed = query.requestId.startsWith('feed-');
    final json = t017Response(query).toJson();
    json['snapshotId'] = feed ? 'feed-snapshot' : 'discover-snapshot';
    for (final layer
        in (json['layers'] as List<dynamic>).cast<Map<String, dynamic>>()) {
      if (layer['layerId'] == topic.layer!.name) {
        layer['state'] = unlocated ? 'unknown' : 'available';
        layer['items'] = [
          if (!unlocated)
            original
                .copyWith(
                  versionId: feed ? 'sample-v1' : 'discover-newer-version',
                )
                .toJson(),
        ];
      }
    }
    return ViewportResponse.fromJson(json);
  }

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    reads.add(_RecordRead(id, context));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    cancellation?.throwIfCancelled();
    if (expired) {
      throw const MapHttpException(
        statusCode: 410,
        retryable: false,
        code: MapServiceErrorCode.snapshotExpired,
      );
    }
    if (context.snapshotId !=
        (unlocated ? 'feed-unlocated-snapshot' : 'feed-snapshot')) {
      throw const MapHttpException(
        statusCode: 404,
        retryable: false,
        code: MapServiceErrorCode.notFound,
      );
    }
    return MapItemResponse(
      schemaVersion: 1,
      requestId: context.requestId,
      snapshotId: context.snapshotId,
      generatedAt: t017Instant,
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
      item: wrongDetailVersion
          ? original.copyWith(versionId: 'unexpected-new-version')
          : original,
    );
  }

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    if (!unlocated) {
      return samples.getUnlocated(query, cancellation: cancellation);
    }
    cancellation?.throwIfCancelled();
    return MapItemPage(
      schemaVersion: 1,
      requestId: query.requestId,
      snapshotId: 'feed-unlocated-snapshot',
      generatedAt: t017Instant,
      mode: query.mode,
      dataMode: MapDataMode.sample,
      items: [original],
      completeness: MapCompleteness.complete,
      nextCursor: null,
      totalMatching: 1,
      scope: PageScope.unlocated(
        areaRefs: const ['sample.melbourne'],
        sourceJurisdiction: null,
      ),
    );
  }

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) => samples.getAggregateMembers(id, query, cancellation: cancellation);
}
