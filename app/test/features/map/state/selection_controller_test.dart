import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/state/selection_controller.dart';

import '../t016_test_support.dart';

void main() {
  late T016Repository repository;
  late ProviderContainer container;
  late SelectionController controller;
  const context = MapReadContext(
    requestId: 'detail-request',
    snapshotId: 'original-snapshot',
  );
  Future<void> select(MapItem item) => controller.selectItem(
    item,
    context: context,
    mode: MapQueryMode.current,
    dataMode: MapDataMode.sample,
  );

  setUp(() {
    repository = T016Repository();
    container = ProviderContainer(
      overrides: [mapRepositoryProvider.overrideWithValue(repository)],
    );
    controller = container.read(selectionControllerProvider.notifier);
  });
  tearDown(() => container.dispose());

  test(
    'camera and version changes preserve original selection and snapshot',
    () async {
      final item = t016Item();
      final loading = select(item);
      final call = repository.details.single;
      call.result.complete(t016Details(item, context));
      await loading;
      controller.reconcile(
        enabledLayers: {item.layerId},
        visibleItems: const [],
      );
      var state = container.read(selectionControllerProvider);
      expect(state.disposition, MapSelectionDisposition.offscreen);
      expect(state.item, same(item));
      expect(state.context!.snapshotId, 'original-snapshot');
      expect(state.highlightedItemId, item.id);
      controller.reconcile(
        enabledLayers: {item.layerId},
        visibleItems: [item.copyWith(versionId: 'new-viewport-version')],
      );
      state = container.read(selectionControllerProvider);
      expect(state.disposition, MapSelectionDisposition.matching);
      expect(state.item!.versionId, item.versionId);
      expect(repository.details, hasLength(1));
      controller.setAggregateMembership('aggregate-proven-by-membership');
      state = container.read(selectionControllerProvider);
      expect(state.highlightedAggregateId, 'aggregate-proven-by-membership');
      expect(state.item, same(item));
    },
  );

  test(
    'filter exclusion clears highlight and cancels an in-flight detail',
    () async {
      final item = t016Item();
      final loading = select(item);
      final call = repository.details.single;
      controller.reconcile(enabledLayers: const {}, visibleItems: const []);
      expect(call.cancellation!.isCancelled, isTrue);
      call.result.completeError(const MapNetworkException());
      await loading;
      var state = container.read(selectionControllerProvider);
      expect(state.disposition, MapSelectionDisposition.filterExcluded);
      expect(state.item, same(item));
      expect(state.highlightedItemId, isNull);
      expect(state.detailError, isNull);
      controller.reconcile(enabledLayers: {item.layerId}, visibleItems: [item]);
      state = container.read(selectionControllerProvider);
      expect(state.highlightedItemId, item.id);
    },
  );

  test('selecting by id fetches a record the map has not loaded', () async {
    final item = t016Item();
    final loading = controller.selectById(
      item.id,
      context: context,
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
    );
    var state = container.read(selectionControllerProvider);
    expect(state.selectedItemId, item.id);
    expect(state.item, isNull);
    expect(state.isLoading, isTrue);
    expect(state.highlightedItemId, isNull);
    final call = repository.details.single;
    expect(call.id, item.id);
    expect(call.context.snapshotId, 'original-snapshot');
    call.result.complete(t016Details(item, context));
    await loading;
    state = container.read(selectionControllerProvider);
    expect(state.isLoading, isFalse);
    expect(state.item, same(item));
    expect(state.disposition, MapSelectionDisposition.matching);
    expect(state.highlightedItemId, item.id);
  });

  test('selecting by id reports a record the service does not have', () async {
    final loading = controller.selectById(
      'event:gone',
      context: context,
      mode: MapQueryMode.current,
      dataMode: MapDataMode.sample,
    );
    repository.details.single.result.completeError(
      const MapHttpException(
        statusCode: 404,
        retryable: false,
        code: MapServiceErrorCode.notFound,
      ),
    );
    await loading;
    final state = container.read(selectionControllerProvider);
    expect(state.selectedItemId, 'event:gone');
    expect(state.item, isNull);
    expect(state.isLoading, isFalse);
    expect(state.disposition, MapSelectionDisposition.removed);
    expect(state.canRetry, isFalse);
  });

  test('rapid selection ignores cancelled success and errors', () async {
    final first = t016Item();
    final second = first.copyWith(id: 'second-record');
    final firstLoading = select(first);
    final secondLoading = select(second);
    expect(repository.details.first.cancellation!.isCancelled, isTrue);
    repository.details[1].result.complete(t016Details(second, context));
    await secondLoading;
    repository.details.first.result.completeError(const MapNetworkException());
    await firstLoading;
    final state = container.read(selectionControllerProvider);
    expect(state.selectedItemId, second.id);
    expect(state.item, same(second));
    expect(state.detailError, isNull);
  });

  test('closing prevents a late success from reopening details', () async {
    final item = t016Item();
    final loading = select(item);
    controller.clear();
    repository.details.single.result.complete(t016Details(item, context));
    await loading;
    expect(container.read(selectionControllerProvider).hasSelection, isFalse);
  });

  test('explicit removal and withdrawal clear all public content', () async {
    final item = t016Item();
    var loading = select(item);
    repository.details.last.result.complete(t016Details(item, context));
    await loading;
    controller.reconcile(
      enabledLayers: {item.layerId},
      visibleItems: const [],
      withdrawnIds: {item.id},
    );
    var state = container.read(selectionControllerProvider);
    expect(state.disposition, MapSelectionDisposition.withdrawn);
    expect(state.item, isNull);
    expect(state.highlightedItemId, isNull);
    loading = select(item);
    repository.details.last.result.complete(t016Details(item, context));
    await loading;
    controller.reconcile(
      enabledLayers: {item.layerId},
      visibleItems: const [],
      removedIds: {item.id},
    );
    state = container.read(selectionControllerProvider);
    expect(state.disposition, MapSelectionDisposition.removed);
    expect(state.item, isNull);
  });

  test(
    'withdrawn selected DTO does not request or display withdrawn content',
    () async {
      await select(t016Item().copyWith(lifecycle: MapLifecycle.withdrawn));
      expect(repository.details, isEmpty);
      expect(container.read(selectionControllerProvider).item, isNull);
      expect(
        container.read(selectionControllerProvider).highlightedItemId,
        isNull,
      );
    },
  );

  test(
    'notFound removes public content while expiry retains original facts',
    () async {
      final item = t016Item();
      var loading = select(item);
      repository.details.last.result.completeError(
        const MapHttpException(
          statusCode: 404,
          retryable: false,
          code: MapServiceErrorCode.notFound,
        ),
      );
      await loading;
      expect(container.read(selectionControllerProvider).item, isNull);
      loading = select(item);
      repository.details.last.result.completeError(
        const MapHttpException(
          statusCode: 410,
          retryable: false,
          code: MapServiceErrorCode.snapshotExpired,
        ),
      );
      await loading;
      final state = container.read(selectionControllerProvider);
      expect(state.item, same(item));
      expect(state.context!.snapshotId, context.snapshotId);
      expect(state.canRetry, isFalse);
      await controller.retryDetails();
      expect(repository.details, hasLength(2));
    },
  );

  test('manual retry uses the selected original snapshot', () async {
    final item = t016Item();
    final loading = select(item);
    repository.details.single.result.completeError(const MapNetworkException());
    await loading;
    expect(container.read(selectionControllerProvider).canRetry, isTrue);
    final retry = controller.retryDetails();
    expect(repository.details.last.context, same(context));
    repository.details.last.result.complete(t016Details(item, context));
    await retry;
    expect(container.read(selectionControllerProvider).detailError, isNull);
    expect(container.read(selectionControllerProvider).item, same(item));
  });

  test(
    'a newer version of the selected record replaces the shown details',
    () async {
      final item = t016Item();
      final loading = select(item);
      final newer = item.copyWith(versionId: 'newer-version');
      repository.details.single.result.complete(t016Details(newer, context));
      await loading;
      final state = container.read(selectionControllerProvider);
      expect(state.item!.versionId, 'newer-version');
      expect(state.detailError, isNull);
    },
  );

  test('disposal cancels selected detail work', () async {
    final item = t016Item();
    final loading = select(item);
    container.dispose();
    expect(repository.details.single.cancellation!.isCancelled, isTrue);
    repository.details.single.result.complete(t016Details(item, context));
    await loading;
    container = ProviderContainer();
  });

  test(
    'unlocated selection remains truthful without geographic highlight',
    () async {
      final item = t016Page().items.single;
      final loading = select(item);
      repository.details.single.result.complete(t016Details(item, context));
      await loading;
      controller.reconcile(
        enabledLayers: {item.layerId},
        visibleItems: const [],
      );
      final state = container.read(selectionControllerProvider);
      expect(state.item!.geometry, isNull);
      expect(state.disposition, MapSelectionDisposition.matching);
      expect(state.highlightedItemId, isNull);
      expect(state.hasSelection, isTrue);
    },
  );
}
