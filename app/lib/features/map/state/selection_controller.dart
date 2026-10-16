import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../data/map_models.dart';
import '../data/map_repository.dart';
import 'map_providers.dart';

part 'selection_controller.g.dart';

enum MapSelectionDisposition {
  matching,
  offscreen,
  filterExcluded,
  removed,
  withdrawn,
}

/// The selected snapshot is independent of the latest viewport request.
final class MapSelectionState {
  const MapSelectionState({
    this.selectedItemId,
    this.item,
    this.context,
    this.mode = MapQueryMode.current,
    this.dataMode = MapDataMode.live,
    this.disposition = MapSelectionDisposition.matching,
    this.aggregateId,
    this.isLoading = false,
    this.detailError,
  });

  final String? selectedItemId;
  final MapItem? item;
  final MapReadContext? context;
  final MapQueryMode mode;
  final MapDataMode dataMode;
  final MapSelectionDisposition disposition;
  final String? aggregateId;
  final bool isLoading;
  final Object? detailError;

  bool get hasSelection => selectedItemId != null;

  String? get highlightedItemId => item?.geometry == null
      ? null
      : switch (disposition) {
          MapSelectionDisposition.matching ||
          MapSelectionDisposition.offscreen => selectedItemId,
          _ => null,
        };

  String? get highlightedAggregateId =>
      highlightedItemId == null ? null : aggregateId;

  bool get canRetry =>
      selectedItemId != null &&
      detailError is MapRepositoryException &&
      (detailError! as MapRepositoryException).retryable;

  MapSelectionState _with({
    MapItem? item,
    MapSelectionDisposition? disposition,
    String? aggregateId,
    bool clearAggregate = false,
    bool? isLoading,
    Object? detailError,
    bool clearError = false,
    bool removeContent = false,
  }) => MapSelectionState(
    selectedItemId: selectedItemId,
    item: removeContent ? null : item ?? this.item,
    context: context,
    mode: mode,
    dataMode: dataMode,
    disposition: disposition ?? this.disposition,
    aggregateId: clearAggregate ? null : aggregateId ?? this.aggregateId,
    isLoading: isLoading ?? this.isLoading,
    detailError: clearError ? null : detailError ?? this.detailError,
  );
}

@Riverpod(keepAlive: true)
class SelectionController extends _$SelectionController {
  MapRequestCancellation? _request;
  int _generation = 0;

  @override
  MapSelectionState build() {
    ref.onDispose(() => _request?.cancel());
    return const MapSelectionState();
  }

  Future<void> selectItem(
    MapItem item, {
    required MapReadContext context,
    required MapQueryMode mode,
    required MapDataMode dataMode,
  }) async {
    _cancelRequest();
    final withdrawn = item.lifecycle == MapLifecycle.withdrawn;
    state = MapSelectionState(
      selectedItemId: item.id,
      item: withdrawn ? null : item,
      context: context,
      mode: mode,
      dataMode: dataMode,
      disposition: withdrawn
          ? MapSelectionDisposition.withdrawn
          : MapSelectionDisposition.matching,
    );
    if (!withdrawn) await _loadDetails();
  }

  /// Selects a record the map has not loaded, for example one an agent card
  /// cites, and fetches its details from the snapshot the map is showing.
  /// Until the fetch returns the details show only the loading state.
  Future<void> selectById(
    String id, {
    required MapReadContext context,
    required MapQueryMode mode,
    required MapDataMode dataMode,
  }) async {
    _cancelRequest();
    state = MapSelectionState(
      selectedItemId: id,
      context: context,
      mode: mode,
      dataMode: dataMode,
    );
    await _loadDetails();
  }

  void clear() {
    _cancelRequest();
    state = const MapSelectionState();
  }

  /// Refreshing the viewport never silently replaces the selected version.
  /// Missing from this viewport means offscreen, not deleted or filter-excluded.
  /// Supplied aggregate membership keeps the original selection represented.
  void reconcile({
    required Set<MapLayerId> enabledLayers,
    required Iterable<MapItem> visibleItems,
    bool matchesFilters = true,
    Set<String> removedIds = const {},
    Set<String> withdrawnIds = const {},
  }) {
    final id = state.selectedItemId;
    if (id == null) return;
    if (withdrawnIds.contains(id)) {
      _remove(MapSelectionDisposition.withdrawn);
      return;
    }
    if (removedIds.contains(id)) {
      _remove(MapSelectionDisposition.removed);
      return;
    }
    final item = state.item;
    if (item == null) return;
    if (!matchesFilters || !enabledLayers.contains(item.layerId)) {
      _cancelRequest();
      state = state._with(
        disposition: MapSelectionDisposition.filterExcluded,
        clearAggregate: true,
        isLoading: false,
      );
      return;
    }
    final visible = visibleItems.toList(growable: false);
    if (visible.any(
      (candidate) =>
          candidate.id == id && candidate.lifecycle == MapLifecycle.withdrawn,
    )) {
      _remove(MapSelectionDisposition.withdrawn);
      return;
    }
    final onMap =
        item.geometry == null || visible.any((candidate) => candidate.id == id);
    String? aggregateId;
    if (!onMap) {
      for (final candidate in visible.whereType<AggregateMapItem>()) {
        if (candidate.layerId == item.layerId &&
            candidate.lifecycle != MapLifecycle.withdrawn &&
            candidate.details.memberIds.contains(id)) {
          aggregateId = candidate.id;
          break;
        }
      }
    }
    state = state._with(
      disposition: onMap || aggregateId != null
          ? MapSelectionDisposition.matching
          : MapSelectionDisposition.offscreen,
      aggregateId: aggregateId,
      clearAggregate: aggregateId == null,
    );
  }

  /// Call only with membership evidence from the current aggregate response.
  /// This links a highlight without replacing the original selected details.
  void setAggregateMembership(String? aggregateId) {
    if (state.highlightedItemId == null) return;
    state = state._with(
      aggregateId: aggregateId,
      clearAggregate: aggregateId == null,
      disposition: aggregateId == null
          ? state.disposition
          : MapSelectionDisposition.matching,
    );
  }

  Future<void> retryDetails() async {
    if (state.canRetry) await _loadDetails();
  }

  void _cancelRequest() {
    _generation++;
    _request?.cancel();
    _request = null;
  }

  void _remove(MapSelectionDisposition disposition) {
    _cancelRequest();
    state = state._with(
      disposition: disposition,
      removeContent: true,
      clearAggregate: true,
      isLoading: false,
      clearError: true,
    );
  }

  /// Fetches the selected record. The map service recomputes details from
  /// the current published data (system-design/map-serving-stateless.md), so
  /// a record that changed since the map loaded comes back in its newer
  /// version, which replaces the shown one.
  Future<void> _loadDetails() async {
    final id = state.selectedItemId;
    final original = state.item;
    final context = state.context;
    if (id == null || context == null) return;
    _cancelRequest();
    final generation = _generation;
    final cancellation = MapRequestCancellation();
    _request = cancellation;
    state = state._with(isLoading: true, clearError: true);
    try {
      final response = await ref
          .read(mapRepositoryProvider)
          .getItem(id, context, cancellation: cancellation);
      if (generation != _generation || cancellation.isCancelled) return;
      if (response.requestId != context.requestId ||
          response.snapshotId != context.snapshotId ||
          response.item.id != id ||
          (original != null && response.item.layerId != original.layerId) ||
          response.mode != state.mode ||
          response.dataMode != state.dataMode) {
        throw const MapContractException(MapContractFailure.requestMismatch);
      }
      if (response.item.lifecycle == MapLifecycle.withdrawn) {
        _remove(MapSelectionDisposition.withdrawn);
      } else {
        state = state._with(item: response.item, isLoading: false);
      }
    } on MapRequestCancelled {
      if (generation == _generation) {
        state = state._with(isLoading: false);
      }
    } catch (error) {
      if (generation != _generation || cancellation.isCancelled) return;
      if (error is MapHttpException &&
          (error.code == MapServiceErrorCode.notFound ||
              error.code == MapServiceErrorCode.notAvailable)) {
        _remove(MapSelectionDisposition.removed);
      } else {
        state = state._with(isLoading: false, detailError: error);
      }
    } finally {
      if (generation == _generation) _request = null;
    }
  }
}
