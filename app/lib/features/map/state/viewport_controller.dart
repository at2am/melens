import 'dart:async';
import 'dart:math' as math;

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/time/melbourne_time.dart';
import '../data/map_models.dart';
import '../data/map_repository.dart';
import 'map_providers.dart';
import 'zoom_presentation.dart';

part 'viewport_controller.g.dart';

/// The contract's operational envelope is a request limit, never coverage.
const mapRequestEnvelope = MapBounds(
  west: 144,
  south: -39,
  east: 146.5,
  north: -37,
);

/// Intersect the real visible region with the bounded service envelope.
/// A completely outside view has no query, rather than invented coverage.
MapBounds? boundedViewportRegion(MapBounds visible) {
  if (!visible.toJson().every((value) => value.isFinite) ||
      visible.west >= visible.east ||
      visible.south >= visible.north) {
    return null;
  }
  final west = math.max(visible.west, mapRequestEnvelope.west);
  final south = math.max(visible.south, mapRequestEnvelope.south);
  final east = math.min(visible.east, mapRequestEnvelope.east);
  final north = math.min(visible.north, mapRequestEnvelope.north);
  if (west >= east || south >= north) return null;
  return MapBounds(west: west, south: south, east: east, north: north);
}

TimeWindow currentViewportWindow(MelbourneClock clock) {
  final now = clock.now().toUtc();
  final end = DateTime.utc(now.year, now.month, now.day, now.hour, now.minute);
  return TimeWindow(from: end.subtract(const Duration(minutes: 15)), to: end);
}

/// Whether the map searches again by itself after the user pans or zooms.
/// Off by default: a moved map offers "Search this area" instead. Kept for
/// the application session, like the theme choice.
@Riverpod(keepAlive: true)
class MapAutoSearch extends _$MapAutoSearch {
  @override
  bool build() => false;

  void set({required bool enabled}) => state = enabled;
}

/// A camera region the user moved to and has not searched yet.
typedef PendingMapRegion = ({MapBounds visible, double zoom});

/// Desired controls and the last successful response deliberately stay separate.
final class ViewportState {
  const ViewportState({
    required this.window,
    required this.dataMode,
    this.mode = MapQueryMode.current,
    this.bbox,
    this.zoom = 14,
    this.zoomPresentation,
    this.layers = const [],
    this.areaFilter,
    this.boundaryFilter,
    this.response,
    this.responseQuery,
    this.responsePresentation,
    this.isLoading = false,
    this.isOutsideService = false,
    this.isCameraMoving = false,
    this.pendingRegion,
    this.error,
  });

  final TimeWindow window;
  final MapDataMode dataMode;
  final MapQueryMode mode;
  final MapBounds? bbox;
  final double zoom;
  final ZoomPresentation? zoomPresentation;
  final List<MapLayerId> layers;
  final AreaFilter? areaFilter;
  final BoundaryFilter? boundaryFilter;
  final ViewportResponse? response;
  final ViewportQuery? responseQuery;

  /// Captures real camera zoom and stable request band for the retained response.
  final ZoomPresentation? responsePresentation;
  final bool isLoading;
  final bool isOutsideService;
  final bool isCameraMoving;

  /// Set while auto-search is off and the camera has left the searched area.
  final PendingMapRegion? pendingRegion;
  final MapRepositoryException? error;

  bool get hasPendingRegion => pendingRegion != null;

  List<MapLayerId> get queryableLayers => List.unmodifiable(
    layers.where((layer) => !blockedLayers.contains(layer)),
  );

  Set<MapLayerId> get blockedLayers => {
    if (boundaryFilter == null && layers.contains(MapLayerId.boundary))
      MapLayerId.boundary,
    if (areaFilter == null)
      ...layers.where(
        (layer) => layer == MapLayerId.rent || layer == MapLayerId.census,
      ),
  };

  bool get canQuery =>
      !isCameraMoving && bbox != null && queryableLayers.isNotEmpty;
  bool get canRetry => canQuery && !isLoading && error?.retryable == true;
  bool get retainsPreviousResponse => response != null && error != null;
  bool get hasPartialResults =>
      response?.layers.any(
        (layer) => layer.completeness == MapCompleteness.partial,
      ) ??
      false;

  bool get matchesResponseWindow =>
      responseQuery != null &&
      responseQuery!.mode == mode &&
      responseQuery!.window.from == window.from &&
      responseQuery!.window.to == window.to;

  ViewportState _with({
    TimeWindow? window,
    MapQueryMode? mode,
    MapBounds? bbox,
    bool clearBounds = false,
    double? zoom,
    ZoomPresentation? zoomPresentation,
    List<MapLayerId>? layers,
    AreaFilter? areaFilter,
    bool clearAreaFilter = false,
    BoundaryFilter? boundaryFilter,
    bool clearBoundaryFilter = false,
    ViewportResponse? response,
    ViewportQuery? responseQuery,
    ZoomPresentation? responsePresentation,
    bool clearResponse = false,
    bool? isLoading,
    bool? isOutsideService,
    bool? isCameraMoving,
    PendingMapRegion? pendingRegion,
    bool clearPendingRegion = false,
    MapRepositoryException? error,
    bool clearError = false,
  }) => ViewportState(
    window: window ?? this.window,
    dataMode: dataMode,
    mode: mode ?? this.mode,
    bbox: clearBounds ? null : bbox ?? this.bbox,
    zoom: zoom ?? this.zoom,
    zoomPresentation: zoomPresentation ?? this.zoomPresentation,
    layers: layers ?? this.layers,
    areaFilter: clearAreaFilter ? null : areaFilter ?? this.areaFilter,
    boundaryFilter: clearBoundaryFilter
        ? null
        : boundaryFilter ?? this.boundaryFilter,
    response: clearResponse ? null : response ?? this.response,
    responseQuery: clearResponse ? null : responseQuery ?? this.responseQuery,
    responsePresentation: clearResponse
        ? null
        : responsePresentation ?? this.responsePresentation,
    isLoading: isLoading ?? this.isLoading,
    isOutsideService: isOutsideService ?? this.isOutsideService,
    isCameraMoving: isCameraMoving ?? this.isCameraMoving,
    pendingRegion: clearPendingRegion
        ? null
        : pendingRegion ?? this.pendingRegion,
    error: clearError ? null : error ?? this.error,
  );
}

/// Cancels superseded operations before the debounce, and guards every result.
@Riverpod(keepAlive: true)
class ViewportController extends _$ViewportController {
  static const debounceDuration = Duration(milliseconds: 250);
  MapRequestCancellation? _request;
  Timer? _debounce;
  int _generation = 0;
  int _sequence = 0;
  bool _awaitingRegion = false;

  @override
  ViewportState build() {
    ref.onDispose(_cancelPending);
    // Turning auto-search on searches the area the user has moved to.
    ref.listen(mapAutoSearchProvider, (previous, next) {
      if (next) searchPendingRegion();
    });
    return ViewportState(
      window: currentViewportWindow(ref.watch(melbourneClockProvider)),
      dataMode: ref.watch(envProvider).mapDataMode,
    );
  }

  void setLayers(Iterable<MapLayerId> layers, {bool debounce = true}) {
    final ordered = MapLayerId.values.where(layers.contains).toList();
    if (_sameLayers(ordered, state.layers)) return;
    state = state._with(layers: List.unmodifiable(ordered));
    _schedule(debounce: debounce);
  }

  /// The camera's visible region. The first real region is always searched;
  /// after that a user's move is only searched when auto-search is on, or
  /// [search] says the move was asked for (a focus request, a zoom to an
  /// aggregate). Otherwise it waits as [ViewportState.pendingRegion].
  void setRegion(
    MapBounds visible,
    double zoom, {
    bool debounce = true,
    bool search = false,
  }) {
    if (!zoom.isFinite || zoom < 0 || zoom > 22) {
      throw ArgumentError.value(zoom, 'zoom');
    }
    final bounded = boundedViewportRegion(visible);
    if (!search &&
        !ref.read(mapAutoSearchProvider) &&
        state.zoomPresentation != null) {
      _awaitingRegion = false;
      final searched =
          state.isOutsideService == (bounded == null) &&
          _sameBounds(state.bbox, bounded) &&
          state.zoom == zoom;
      if (searched) {
        if (state.hasPendingRegion) {
          state = state._with(clearPendingRegion: true);
        }
      } else {
        state = state._with(pendingRegion: (visible: visible, zoom: zoom));
      }
      return;
    }
    if (!_awaitingRegion &&
        state.zoomPresentation != null &&
        _sameBounds(state.bbox, bounded) &&
        state.zoom == zoom) {
      if (state.hasPendingRegion) {
        state = state._with(clearPendingRegion: true);
      }
      return;
    }
    _awaitingRegion = false;
    state = state._with(
      bbox: bounded,
      clearBounds: bounded == null,
      zoom: zoom,
      zoomPresentation:
          state.zoomPresentation?.at(zoom) ?? ZoomPresentation.initial(zoom),
      isOutsideService: bounded == null,
      isCameraMoving: false,
      clearPendingRegion: true,
    );
    _schedule(debounce: debounce);
  }

  /// "Search this area": searches the region the camera moved to.
  void searchPendingRegion() {
    final pending = state.pendingRegion;
    if (pending == null) return;
    setRegion(pending.visible, pending.zoom, debounce: false, search: true);
  }

  /// With auto-search on, an in-flight response cannot become current after
  /// camera motion starts; the idle callback supplies a new public visible
  /// region before requesting. With it off, the shown results stay and keep
  /// loading until the user searches the new area.
  void cameraMoving() {
    _awaitingRegion = true;
    if (!ref.read(mapAutoSearchProvider)) return;
    _cancelPending();
    if (!state.isCameraMoving || state.isLoading) {
      state = state._with(isLoading: false, isCameraMoving: true);
    }
  }

  /// A catalog fallback is labelled service scope by the screen. It is never
  /// treated as a map-visible region or a source's coverage boundary.
  void useServiceBounds(MapBounds bounds) {
    if (state.bbox == null &&
        !state.isOutsideService &&
        !state.isCameraMoving) {
      final bounded = boundedViewportRegion(bounds);
      state = state._with(
        bbox: bounded,
        clearBounds: bounded == null,
        isOutsideService: bounded == null,
      );
      // Service-scope fallback must not establish hysteresis before the first
      // real camera is classified by its nominal band.
      _schedule(debounce: false);
    }
  }

  void setWindow(MapQueryMode mode, TimeWindow window, {bool debounce = true}) {
    if (!window.from.isUtc ||
        !window.to.isUtc ||
        !window.from.isBefore(window.to) ||
        window.to.difference(window.from) > const Duration(days: 31)) {
      throw ArgumentError.value(window, 'window');
    }
    if (state.mode == mode &&
        state.window.from == window.from &&
        state.window.to == window.to) {
      return;
    }
    state = state._with(mode: mode, window: window);
    _schedule(debounce: debounce);
  }

  void setBoundaryFilter(BoundaryFilter? filter) {
    state = state._with(
      boundaryFilter: filter,
      clearBoundaryFilter: filter == null,
    );
    _schedule();
  }

  void setAreaFilter(AreaFilter? filter) {
    state = state._with(areaFilter: filter, clearAreaFilter: filter == null);
    _schedule();
  }

  Future<void> refresh() async {
    _cancelPending();
    if (!state.canQuery) return;
    state = state._with(isLoading: true, clearError: true);
    await _load(_generation);
  }

  Future<void> retry() async {
    if (state.canRetry) await refresh();
  }

  void _cancelPending() {
    _generation++;
    _debounce?.cancel();
    _debounce = null;
    _request?.cancel();
    _request = null;
  }

  void _schedule({bool debounce = true}) {
    _cancelPending();
    if (!state.canQuery) {
      state = state._with(
        isLoading: false,
        clearResponse: state.bbox == null || state.queryableLayers.isEmpty,
        clearError: true,
      );
      return;
    }
    state = state._with(isLoading: true, clearError: true);
    final generation = _generation;
    if (debounce) {
      _debounce = Timer(debounceDuration, () {
        _debounce = null;
        unawaited(_load(generation));
      });
    } else {
      unawaited(_load(generation));
    }
  }

  Future<void> _load(int generation) async {
    if (generation != _generation || !state.canQuery) return;
    final cancellation = MapRequestCancellation();
    _request = cancellation;
    final presentation =
        state.zoomPresentation ?? ZoomPresentation.initial(state.zoom);
    final query = ViewportQuery(
      requestId: 'viewport-${++_sequence}',
      bbox: state.bbox!,
      zoom: presentation.requestZoom,
      layers: state.queryableLayers,
      mode: state.mode,
      window: state.window,
      boundaryFilter: state.boundaryFilter,
      areaFilter: state.areaFilter,
      pageSize: 1000,
    );
    try {
      validateViewportQuery(query);
      final response = await ref
          .read(mapRepositoryProvider)
          .queryViewport(query, cancellation: cancellation);
      if (generation != _generation || cancellation.isCancelled) return;
      final ids = response.layers.map((layer) => layer.layerId).toSet();
      if (response.requestId != query.requestId ||
          response.mode != query.mode ||
          response.dataMode != state.dataMode ||
          response.schemaVersion != 1 ||
          response.snapshotId.isEmpty ||
          ids.length != query.layers.length ||
          !query.layers.every(ids.contains)) {
        throw const MapContractException(MapContractFailure.requestMismatch);
      }
      state = state._with(
        response: response,
        responseQuery: query,
        responsePresentation: presentation,
        isLoading: false,
        clearError: true,
      );
    } on MapRequestCancelled {
      if (generation == _generation) state = state._with(isLoading: false);
    } catch (error) {
      if (generation != _generation || cancellation.isCancelled) return;
      state = state._with(
        isLoading: false,
        error: error is MapRepositoryException
            ? error
            : const MapContractException(MapContractFailure.invalidEnvelope),
      );
    } finally {
      if (generation == _generation) _request = null;
    }
  }
}

bool _sameLayers(List<MapLayerId> a, List<MapLayerId> b) =>
    a.length == b.length &&
    Iterable<int>.generate(a.length).every((index) => a[index] == b[index]);

bool _sameBounds(MapBounds? a, MapBounds? b) =>
    identical(a, b) ||
    a != null &&
        b != null &&
        a.west == b.west &&
        a.south == b.south &&
        a.east == b.east &&
        a.north == b.north;
