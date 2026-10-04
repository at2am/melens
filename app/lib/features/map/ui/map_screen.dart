import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../../core/network/public_source_opener.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../state/layer_controller.dart';
import '../state/map_providers.dart';
import '../state/selection_controller.dart';
import '../state/viewport_controller.dart';
import 'aggregate_details.dart';
import 'anomaly_details.dart';
import 'layer_panel.dart';
import 'map_details.dart';
import 'map_status.dart';
import 'map_surface.dart';
import 'renderers/aggregate_renderer.dart';
import 'unlocated_list.dart';

typedef MapVisibleRegionReader = Future<MapBounds> Function();

class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({
    this.mapBuilder,
    this.visibleRegionReader,
    this.onZoomToBounds,
    this.approvedUnlocatedScope,
    super.key,
  });

  final MapSurfaceBuilder? mapBuilder;
  final MapVisibleRegionReader? visibleRegionReader;
  final ValueChanged<MapBounds>? onZoomToBounds;

  /// Optional admitted association. Otherwise use only verified catalog refs.
  final UnlocatedScope? approvedUnlocatedScope;

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  GoogleMapController? _map;
  double _zoom = 14;
  int _regionGeneration = 0;
  bool _usesVisibleRegion = false;
  bool _regionReadFailed = false;
  bool _showUnlocated = false;
  int _detailSequence = 0;
  TimeWindow? _selectedWindow;
  String? _selectedFilters;

  ValueChanged<Uri>? get _sourceOpener =>
      supportsPublicSourceOpening ? openPublicSource : null;

  @override
  void initState() {
    super.initState();
    ref.listenManual(layerControllerProvider, (previous, next) {
      ref
          .read(viewportControllerProvider.notifier)
          .setLayers(next.enabledLayerIds);
      _reconcileSelection();
    });
    ref.listenManual(mapLayerCatalogProvider, (previous, next) {
      final catalog = next.value;
      if (!_usesVisibleRegion && catalog != null) {
        ref
            .read(viewportControllerProvider.notifier)
            .useServiceBounds(catalog.serviceBounds);
      }
    });
    ref.listenManual(viewportControllerProvider, (previous, next) {
      _reconcileSelection();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final viewport = ref.read(viewportControllerProvider.notifier);
      viewport.setLayers(ref.read(layerControllerProvider).enabledLayerIds);
      final catalog = ref.read(mapLayerCatalogProvider).value;
      if (!_usesVisibleRegion && catalog != null) {
        viewport.useServiceBounds(catalog.serviceBounds);
      }
      if (widget.visibleRegionReader != null) unawaited(_readVisibleRegion());
    });
  }

  void _reconcileSelection() {
    final viewport = ref.read(viewportControllerProvider);
    final selected = ref.read(selectionControllerProvider);
    final window = _selectedWindow;
    final matches =
        !selected.hasSelection ||
        window == null ||
        selected.mode == viewport.mode &&
            window.from == viewport.window.from &&
            window.to == viewport.window.to &&
            _selectedFilters ==
                _filters(viewport.areaFilter, viewport.boundaryFilter);
    final items =
        viewport.response?.layers.expand((layer) => layer.items) ??
        const <MapItem>[];
    final controller = ref.read(selectionControllerProvider.notifier);
    controller.reconcile(
      enabledLayers: ref.read(layerControllerProvider).enabledLayers,
      visibleItems: items,
      matchesFilters: matches,
    );
  }

  Future<void> _readVisibleRegion() async {
    final reader = widget.visibleRegionReader;
    final controller = _map;
    if (reader == null && controller == null) return;
    final generation = ++_regionGeneration;
    try {
      final MapBounds bounds;
      if (reader != null) {
        bounds = await reader();
      } else {
        final region = await controller!.getVisibleRegion();
        bounds = MapBounds(
          west: region.southwest.longitude,
          south: region.southwest.latitude,
          east: region.northeast.longitude,
          north: region.northeast.latitude,
        );
      }
      if (!mounted || generation != _regionGeneration) return;
      setState(() {
        _usesVisibleRegion = true;
        _regionReadFailed = false;
      });
      ref
          .read(viewportControllerProvider.notifier)
          .setRegion(bounds, _zoom.clamp(0, 22).toDouble());
    } catch (_) {
      if (mounted && generation == _regionGeneration) {
        setState(() => _regionReadFailed = true);
      }
    }
  }

  void _selectItem(MapItem item) {
    final viewport = ref.read(viewportControllerProvider);
    final response = viewport.response;
    if (response == null) return;
    _selectedWindow = viewport.responseQuery?.window;
    _selectedFilters = _filters(
      viewport.responseQuery?.areaFilter,
      viewport.responseQuery?.boundaryFilter,
    );
    setState(() => _showUnlocated = false);
    unawaited(
      ref
          .read(selectionControllerProvider.notifier)
          .selectItem(
            item,
            context: MapReadContext(
              requestId: 'map-detail-${++_detailSequence}',
              snapshotId: response.snapshotId,
            ),
            mode: response.mode,
            dataMode: response.dataMode,
          ),
    );
  }

  void _selectUnlocated(UnlocatedSelection selected, UnlocatedQuery query) {
    _selectedWindow = query.window;
    _selectedFilters = _filters(query.areaFilter, query.boundaryFilter);
    setState(() => _showUnlocated = false);
    unawaited(
      ref
          .read(selectionControllerProvider.notifier)
          .selectItem(
            selected.item,
            context: selected.context,
            mode: selected.mode,
            dataMode: selected.dataMode,
          ),
    );
  }

  void _selectAggregateMember(MapItem item) {
    final selected = ref.read(selectionControllerProvider);
    final context = selected.context;
    if (context == null) return;
    final read = ref
        .read(selectionControllerProvider.notifier)
        .selectItem(
          item,
          context: context,
          mode: selected.mode,
          dataMode: selected.dataMode,
        );
    _reconcileSelection();
    unawaited(read);
  }

  Future<void> _refreshAggregateSnapshot() async {
    final selected = ref.read(selectionControllerProvider);
    final originalContext = selected.context;
    if (selected.item is! AggregateMapItem || originalContext == null) return;
    await ref.read(viewportControllerProvider.notifier).refresh();
    if (!mounted) return;
    final current = ref.read(selectionControllerProvider);
    final viewport = ref.read(viewportControllerProvider);
    final response = viewport.response;
    final query = viewport.responseQuery;
    final selectedWindow = _selectedWindow;
    if (current.selectedItemId != selected.selectedItemId ||
        !identical(current.context, originalContext) ||
        current.disposition != MapSelectionDisposition.matching ||
        viewport.error != null ||
        viewport.isLoading ||
        viewport.isCameraMoving ||
        response == null ||
        query == null ||
        response.snapshotId == originalContext.snapshotId ||
        !viewport.matchesResponseWindow ||
        _filters(query.areaFilter, query.boundaryFilter) !=
            _filters(viewport.areaFilter, viewport.boundaryFilter) ||
        selected.mode != viewport.mode ||
        selectedWindow != null &&
            (selectedWindow.from != viewport.window.from ||
                selectedWindow.to != viewport.window.to)) {
      return;
    }
    final groups = response.layers
        .expand((layer) => layer.items)
        .whereType<AggregateMapItem>()
        .where((item) => item.id == selected.selectedItemId);
    if (groups.isNotEmpty) _selectItem(groups.first);
  }

  void _zoomToBounds(MapBounds bounds) {
    if (widget.onZoomToBounds != null) {
      widget.onZoomToBounds!(bounds);
    } else if (_map != null) {
      unawaited(
        _map!
            .animateCamera(
              CameraUpdate.newLatLngBounds(
                LatLngBounds(
                  southwest: LatLng(bounds.south, bounds.west),
                  northeast: LatLng(bounds.north, bounds.east),
                ),
                32,
              ),
            )
            .catchError((Object _) {}),
      );
    }
  }

  UnlocatedQuery? _unlocatedQuery(
    MapLayerCatalog? catalog,
    ViewportState state,
  ) {
    if (state.queryableLayers.isEmpty) return null;
    final scope = widget.approvedUnlocatedScope;
    final evidence =
        catalog?.layers
            .where(
              (layer) =>
                  state.queryableLayers.contains(layer.id) &&
                  layer.coverage.state == MapCoverageState.verified &&
                  layer.coverage.evidenceSourceIds.isNotEmpty &&
                  layer.coverage.areaRefs.isNotEmpty,
            )
            .toList() ??
        <LayerDescriptor>[];
    final refs =
        evidence.expand((layer) => layer.coverage.areaRefs).toSet().toList()
          ..sort();
    if (scope == null && refs.isEmpty) return null;
    return UnlocatedQuery(
      requestId:
          'unlocated-${state.mode.name}-${state.window.from.microsecondsSinceEpoch}'
          '-${state.window.to.microsecondsSinceEpoch}-${state.queryableLayers.map((layer) => layer.name).join('-')}',
      layers: scope == null
          ? evidence.map((layer) => layer.id).toList()
          : state.queryableLayers,
      mode: state.mode,
      window: state.window,
      scope: scope ?? UnlocatedScope.areaRefs(refs),
      areaFilter: state.areaFilter,
      boundaryFilter: state.boundaryFilter,
      pageSize: 100,
    );
  }

  @override
  void dispose() {
    _regionGeneration++;
    _map = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final viewport = ref.watch(viewportControllerProvider);
    final layers = ref.watch(layerControllerProvider);
    final selection = ref.watch(selectionControllerProvider);
    final catalog = ref.watch(mapLayerCatalogProvider);
    final unlocated = _unlocatedQuery(catalog.value, viewport);
    final response = viewport.response;
    final items =
        response?.layers
            .expand((layer) => layer.items)
            .where((item) => layers.enabledLayers.contains(item.layerId))
            .toList() ??
        const <MapItem>[];
    final aggregate = selection.item is AggregateMapItem
        ? selection.item! as AggregateMapItem
        : null;
    final map = AggregateRenderLayer(
      items: items.whereType<AggregateMapItem>().toList(growable: false),
      selectedItemId: selection.highlightedItemId,
      onZoomToBounds: _zoomToBounds,
      builder: (context, renderer) => MapSurface(
        key: const ValueKey('map-screen-surface'),
        layers: response?.layers ?? const [],
        enabledLayers: layers.enabledLayers,
        dataMode: response?.dataMode ?? viewport.dataMode,
        selectedItemId: selection.highlightedItemId,
        onItemSelected: _selectItem,
        onAggregateSelected: _selectItem,
        onCameraChanged: (camera) {
          _zoom = camera.zoom;
          _regionGeneration++;
          ref.read(viewportControllerProvider.notifier).cameraMoving();
        },
        onCameraIdle: () => unawaited(_readVisibleRegion()),
        onMapCreated: (controller) {
          _map = controller;
          unawaited(_readVisibleRegion());
        },
        mapBuilder: widget.mapBuilder,
        aggregateRenderer: renderer,
      ),
    );
    final Widget? details;
    if (_showUnlocated && unlocated != null) {
      details = UnlocatedList(
        query: unlocated,
        selectedItemId: selection.selectedItemId,
        onItemSelected: (selected) => _selectUnlocated(selected, unlocated),
        onClose: () => setState(() => _showUnlocated = false),
        onOpenSource: _sourceOpener,
      );
    } else if (selection.hasSelection) {
      details = MapDetails(
        state: selection,
        onClose: () => ref.read(selectionControllerProvider.notifier).clear(),
        onRetry: () => unawaited(
          ref.read(selectionControllerProvider.notifier).retryDetails(),
        ),
        onOpenSource: _sourceOpener,
        typedDetailsBuilder: (item) =>
            item is AnomalyMapItem ? AnomalyDetailsSection(item: item) : null,
        additionalContent: aggregate == null || selection.context == null
            ? null
            : AggregateDetailsPanel(
                key: ValueKey(
                  'aggregate-details-${selection.context!.snapshotId}',
                ),
                aggregate: aggregate,
                repository: ref.watch(mapRepositoryProvider),
                readContext: selection.context!,
                mode: selection.mode,
                dataMode: selection.dataMode,
                onZoomToBounds: _zoomToBounds,
                onItemSelected: _selectAggregateMember,
                onOpenSource: _sourceOpener,
                onRefreshSnapshot: () => unawaited(_refreshAggregateSnapshot()),
              ),
      );
    } else {
      details = null;
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 1050;
        final panel = _controls(catalog, viewport);
        return Scaffold(
          appBar: AppBar(
            title: Text(strings.mapScreenTitle),
            actions: [
              IconButton(
                key: const ValueKey('map-layer-statuses'),
                tooltip: strings.mapScreenStatuses,
                onPressed: () => _showStatuses(context),
                icon: const Icon(Icons.info_outline),
              ),
              IconButton(
                key: const ValueKey('map-show-unlocated'),
                tooltip: strings.mapScreenUnlocated,
                onPressed: unlocated == null
                    ? null
                    : () => setState(() => _showUnlocated = !_showUnlocated),
                icon: const Icon(Icons.list_alt),
              ),
            ],
          ),
          drawer: wide
              ? null
              : Drawer(
                  child: PointerInterceptor(child: SafeArea(child: panel)),
                ),
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _timeControls(viewport),
              SizedBox(
                height: 72,
                child: SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 4,
                    ),
                    child: _queryStatus(catalog, viewport),
                  ),
                ),
              ),
              SizedBox(
                height: 4,
                child: viewport.isLoading
                    ? const LinearProgressIndicator()
                    : null,
              ),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (wide) SizedBox(width: 290, child: panel),
                    Expanded(
                      child: MapDetailsLayout(map: map, details: details),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _controls(
    AsyncValue<MapLayerCatalog> catalog,
    ViewportState viewport,
  ) {
    final strings = AppLocalizations.of(context);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LayerPanel(catalog: catalog.value),
          if (catalog.isLoading) Text(strings.mapScreenCatalogLoading),
          if (catalog.hasError) ...[
            Text(strings.mapScreenCatalogError),
            TextButton(
              onPressed: () => ref.invalidate(mapLayerCatalogProvider),
              child: Text(strings.mapRetry),
            ),
          ],
          const SizedBox(height: 16),
          ..._layerStatuses(viewport),
        ],
      ),
    );
  }

  List<Widget> _layerStatuses(ViewportState viewport) {
    final strings = AppLocalizations.of(context);
    final response = viewport.response;
    final results = {
      for (final layer in response?.layers ?? <LayerResult>[])
        layer.layerId: layer,
    };
    return [
      for (final layerId in viewport.queryableLayers.where(
        (id) =>
            results.containsKey(id) ||
            viewport.isLoading ||
            viewport.error != null,
      ))
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (results.containsKey(layerId) && viewport.isLoading)
                Text(strings.mapStatusRefreshing),
              if (results.containsKey(layerId) && viewport.error != null) ...[
                Text(strings.mapStatusClientError),
                Text(strings.mapRetainedData),
                if (viewport.canRetry)
                  TextButton(
                    onPressed: () => unawaited(
                      ref.read(viewportControllerProvider.notifier).retry(),
                    ),
                    child: Text(strings.mapRetry),
                  ),
              ],
              MapLayerStatus(
                layerId: layerId,
                result: _layerAsync(results[layerId], viewport),
                mode: results.containsKey(layerId)
                    ? response!.mode
                    : viewport.mode,
                dataMode: response?.dataMode ?? viewport.dataMode,
                onRetry: viewport.canRetry
                    ? () => unawaited(
                        ref.read(viewportControllerProvider.notifier).retry(),
                      )
                    : null,
              ),
            ],
          ),
        ),
    ];
  }

  AsyncValue<LayerResult> _layerAsync(
    LayerResult? layer,
    ViewportState viewport,
  ) {
    if (layer != null) return AsyncData<LayerResult>(layer);
    if (viewport.error case final error?) {
      return AsyncError<LayerResult>(error, StackTrace.empty);
    }
    return const AsyncLoading<LayerResult>();
  }

  Widget _queryStatus(
    AsyncValue<MapLayerCatalog> catalog,
    ViewportState state,
  ) {
    final strings = AppLocalizations.of(context);
    return Semantics(
      liveRegion: true,
      child: Wrap(
        spacing: 12,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (state.layers.isEmpty)
            Text(strings.mapNoLayersSelected)
          else if (state.isOutsideService)
            Text(strings.mapScreenOutsideService)
          else if (state.isCameraMoving)
            Text(strings.mapScreenWaitingArea)
          else if (state.bbox == null)
            Text(strings.mapScreenWaitingArea)
          else if (!_usesVisibleRegion)
            Text(strings.mapScreenServiceArea),
          if (state.blockedLayers.isNotEmpty)
            Text(strings.mapScreenFilterRequired),
          if (_regionReadFailed) ...[
            Text(strings.mapScreenRegionError),
            TextButton(
              onPressed: () => unawaited(_readVisibleRegion()),
              child: Text(strings.mapRetry),
            ),
          ],
          if (state.isLoading)
            Text(
              state.response == null
                  ? strings.mapStatusLoading
                  : strings.mapStatusRefreshing,
            ),
          if (state.error != null) ...[
            Text(strings.mapStatusClientError),
            if (state.response != null) Text(strings.mapRetainedData),
            if (state.canRetry)
              TextButton(
                key: const ValueKey('map-viewport-retry'),
                onPressed: () => unawaited(
                  ref.read(viewportControllerProvider.notifier).retry(),
                ),
                child: Text(strings.mapRetry),
              ),
          ],
          if (state.hasPartialResults) Text(strings.mapPartialScope),
          if (state.response != null && !state.matchesResponseWindow)
            Text(strings.mapScreenPreviousWindow),
          if (catalog.hasError && state.bbox == null)
            TextButton(
              onPressed: () => ref.invalidate(mapLayerCatalogProvider),
              child: Text(strings.mapScreenRetryCatalog),
            ),
        ],
      ),
    );
  }

  Widget _timeControls(ViewportState state) {
    final strings = AppLocalizations.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final controller = ref.read(viewportControllerProvider.notifier);
    String local(DateTime value) {
      final time = clock.toMelbourne(value);
      return '${DateFormat.yMMMd('en_AU').format(time)}, ${DateFormat.Hm('en_AU').format(time)} ${time.timeZoneName}';
    }

    void historical(Duration duration) {
      final end = currentViewportWindow(clock).to;
      controller.setWindow(
        MapQueryMode.historical,
        TimeWindow(from: end.subtract(duration), to: end),
      );
    }

    void shift(int direction) {
      final duration = state.window.to.difference(state.window.from);
      controller.setWindow(
        MapQueryMode.historical,
        TimeWindow(
          from: state.window.from.add(duration * direction),
          to: state.window.to.add(duration * direction),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              ChoiceChip(
                key: const ValueKey('map-time-current'),
                label: Text(strings.mapScreenCurrent),
                selected: state.mode == MapQueryMode.current,
                onSelected: (_) => controller.setWindow(
                  MapQueryMode.current,
                  currentViewportWindow(clock),
                ),
              ),
              ChoiceChip(
                key: const ValueKey('map-time-historical'),
                label: Text(strings.mapScreenHistorical),
                selected: state.mode == MapQueryMode.historical,
                onSelected: (_) => historical(const Duration(hours: 1)),
              ),
              if (state.mode == MapQueryMode.historical) ...[
                PopupMenuButton<Duration>(
                  key: const ValueKey('map-history-duration'),
                  tooltip: strings.mapScreenHistoryRange,
                  onSelected: historical,
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      value: const Duration(hours: 1),
                      child: Text(strings.mapScreenOneHour),
                    ),
                    PopupMenuItem(
                      value: const Duration(days: 1),
                      child: Text(strings.mapScreenOneDay),
                    ),
                    PopupMenuItem(
                      value: const Duration(days: 7),
                      child: Text(strings.mapScreenSevenDays),
                    ),
                    PopupMenuItem(
                      value: const Duration(days: 31),
                      child: Text(strings.mapScreenThirtyOneDays),
                    ),
                  ],
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(strings.mapScreenHistoryRange),
                  ),
                ),
                IconButton(
                  key: const ValueKey('map-time-previous'),
                  tooltip: strings.mapScreenPrevious,
                  onPressed: () => shift(-1),
                  icon: const Icon(Icons.chevron_left),
                ),
                IconButton(
                  key: const ValueKey('map-time-next'),
                  tooltip: strings.mapScreenNext,
                  onPressed:
                      state.window.to
                          .add(state.window.to.difference(state.window.from))
                          .isAfter(clock.now().toUtc())
                      ? null
                      : () => shift(1),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
              TextButton.icon(
                key: const ValueKey('map-refresh'),
                onPressed: state.canQuery && !state.isLoading
                    ? () {
                        if (state.mode == MapQueryMode.current) {
                          final window = currentViewportWindow(clock);
                          if (window.from != state.window.from ||
                              window.to != state.window.to) {
                            controller.setWindow(
                              MapQueryMode.current,
                              window,
                              debounce: false,
                            );
                            return;
                          }
                        }
                        unawaited(controller.refresh());
                      }
                    : null,
                icon: const Icon(Icons.refresh),
                label: Text(strings.mapScreenRefresh),
              ),
            ],
          ),
          Text(
            strings.mapScreenWindow(
              local(state.window.from),
              local(state.window.to),
            ),
          ),
        ],
      ),
    );
  }

  void _showStatuses(BuildContext context) {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (context) => PointerInterceptor(
          child: SafeArea(
            child: SizedBox(
              height: math.min(640, MediaQuery.sizeOf(context).height * 0.85),
              child: Consumer(
                builder: (context, ref, child) => SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        AppLocalizations.of(context).mapScreenStatuses,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 12),
                      ..._layerStatuses(ref.watch(viewportControllerProvider)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _filters(AreaFilter? area, BoundaryFilter? boundary) =>
    jsonEncode({'area': area?.toJson(), 'boundary': boundary?.toJson()});
