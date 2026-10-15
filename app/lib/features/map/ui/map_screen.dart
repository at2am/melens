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
import '../../agent/data/agent_models.dart';
import '../../cards/ui/card_item_details.dart';
import '../../events/data/user_event_models.dart';
import '../../events/state/event_view_providers.dart';
import '../../events/state/user_events_providers.dart';
import '../../events/ui/user_event_markers.dart';
import '../../events/ui/user_event_text.dart';
import '../../events/ui/user_events_panel.dart';
import '../../shell/state/shell_providers.dart';
import '../data/map_models.dart';
import '../state/layer_controller.dart';
import '../state/map_actions.dart';
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
    this.onFocusRequest,
    this.approvedUnlocatedScope,
    super.key,
  });

  final MapSurfaceBuilder? mapBuilder;
  final MapVisibleRegionReader? visibleRegionReader;
  final ValueChanged<MapBounds>? onZoomToBounds;

  /// Receives the agent's `focus_map` requests instead of the platform map.
  final ValueChanged<MapFocusRequest>? onFocusRequest;

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
  bool _showEvents = false;
  int _eventsPanelNonce = 0;
  String? _panelEventId;
  bool _panelNewEvent = false;
  bool _holdingNearby = false;

  /// Kept for [dispose], where `ref` is no longer safe to use.
  late final NearbyUserEventsController _nearby;
  MapFocusRequest? _pendingFocus;
  CardItem? _awaitingItem;

  /// A tapped card item with no map record, shown in the details pane.
  CardItem? _cardItem;
  int _detailSequence = 0;
  TimeWindow? _selectedWindow;
  String? _selectedFilters;

  ValueChanged<Uri>? get _sourceOpener =>
      supportsPublicSourceOpening ? openPublicSource : null;

  @override
  void initState() {
    super.initState();
    _nearby = ref.read(nearbyUserEventsControllerProvider.notifier);
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
      // A card item asked for before the first results arrived.
      final waiting = _awaitingItem;
      if (waiting != null && next.response != null) {
        _awaitingItem = null;
        _onCardItemTap(waiting);
      }
    });
    ref.listenManual(
      mapActionsControllerProvider.select((state) => state.focus),
      (previous, next) {
        if (next != null && next.sequence != previous?.sequence) {
          _applyFocus(next);
        }
      },
    );
    ref.listenManual(cardItemRequestsProvider, (previous, next) {
      if (next != null) _takeCardItemRequest(next);
    });
    ref.listenManual(eventsPanelRequestsProvider, (previous, next) {
      if (next != null) _takeEventsPanelRequest(next);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      // The agent or an event page may have asked for the map before it was
      // built: take what is waiting.
      final waiting = ref.read(cardItemRequestsProvider);
      if (waiting != null) _takeCardItemRequest(waiting);
      final panel = ref.read(eventsPanelRequestsProvider);
      if (panel != null) _takeEventsPanelRequest(panel);
      _syncNearbyLoading(ref.read(communityLayerEnabledProvider));
      _pendingFocus = ref.read(mapActionsControllerProvider).focus;
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
    setState(() {
      _showUnlocated = false;
      _cardItem = null;
    });
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

  /// Selects a record the map has not loaded by its id, against the
  /// snapshot the map is showing, and reconciles it with the view once its
  /// details arrive. Without a loaded snapshot there is nothing to read from.
  Future<bool> _selectFeatureById(String id) async {
    final viewport = ref.read(viewportControllerProvider);
    final response = viewport.response;
    if (response == null) return false;
    _selectedWindow = viewport.responseQuery?.window;
    _selectedFilters = _filters(
      viewport.responseQuery?.areaFilter,
      viewport.responseQuery?.boundaryFilter,
    );
    setState(() {
      _showUnlocated = false;
      _cardItem = null;
    });
    await ref
        .read(selectionControllerProvider.notifier)
        .selectById(
          id,
          context: MapReadContext(
            requestId: 'map-detail-${++_detailSequence}',
            snapshotId: response.snapshotId,
          ),
          mode: response.mode,
          dataMode: response.dataMode,
        );
    if (mounted) _reconcileSelection();
    return true;
  }

  void _selectUnlocated(UnlocatedSelection selected, UnlocatedQuery query) {
    _selectedWindow = query.window;
    _selectedFilters = _filters(query.areaFilter, query.boundaryFilter);
    setState(() {
      _showUnlocated = false;
      _cardItem = null;
    });
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

  /// Applies a `focus_map` action from the agent (agent-protocol.md,
  /// Rules): a bounds target fits the box, a point target centres on it.
  void _applyFocus(MapFocusRequest request) {
    if (_map == null && widget.onFocusRequest == null) {
      _pendingFocus = request;
      return;
    }
    if (widget.onFocusRequest != null) {
      widget.onFocusRequest!(request);
      return;
    }
    final bounds = request.bounds;
    final point = request.point;
    if (bounds != null) {
      _zoomToBounds(
        MapBounds(
          west: bounds.west,
          south: bounds.south,
          east: bounds.east,
          north: bounds.north,
        ),
      );
    } else if (point != null) {
      _focusPoint(point, zoom: request.zoom);
    }
  }

  void _focusPoint(AgentLatLng point, {int? zoom}) {
    final controller = _map;
    if (controller == null) return;
    unawaited(
      controller
          .animateCamera(
            CameraUpdate.newLatLngZoom(
              LatLng(point.lat, point.lng),
              (zoom ?? 16).toDouble(),
            ),
          )
          .catchError((Object _) {}),
    );
  }

  /// A tapped card item opens its details beside the map. A map record is
  /// selected as if tapped on the map, fetched by id when the map has not
  /// loaded it; any other item shows what the card knows about it. The
  /// camera moves to the item's location when the map does not show it.
  void _onCardItemTap(CardItem item) {
    final source = item.source;
    if (source is FeatureCardSource) {
      final loaded = _loadedItem(source.featureId);
      if (loaded != null) {
        _selectItem(loaded);
        return;
      }
      if (item.location case final location?) _focusPoint(location);
      unawaited(
        _selectFeatureById(source.featureId).then((selected) {
          if (!selected && mounted) _showCardItem(item);
        }),
      );
      return;
    }
    if (item.location case final location?) _focusPoint(location);
    _showCardItem(item);
  }

  void _showCardItem(CardItem item) {
    ref.read(selectionControllerProvider.notifier).clear();
    setState(() {
      _showUnlocated = false;
      _cardItem = item;
    });
  }

  MapItem? _loadedItem(String id) {
    final response = ref.read(viewportControllerProvider).response;
    if (response == null) return null;
    for (final layer in response.layers) {
      for (final item in layer.items) {
        if (item.id == id) return item;
      }
    }
    return null;
  }

  void _takeCardItemRequest(CardItemRequest request) {
    ref.read(cardItemRequestsProvider.notifier).consume(request.sequence);
    final item = request.item;
    final loaded = ref.read(viewportControllerProvider).response != null;
    if (item.source is FeatureCardSource && !loaded) {
      // Selecting a record needs the snapshot the map shows; wait for it.
      _awaitingItem = item;
      return;
    }
    _onCardItemTap(item);
  }

  /// The features the agent highlighted, as chips above the map. The surface
  /// highlights one selected item at a time, so a chip selects its feature.
  Widget? _highlightBar(List<MapItem> items, MapActionsState actions) {
    if (actions.highlightedIds.isEmpty && actions.missingIds.isEmpty) {
      return null;
    }
    final strings = AppLocalizations.of(context);
    final byId = {for (final item in items) item.id: item};
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Wrap(
        spacing: 8,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            strings.mapAgentHighlights,
            style: Theme.of(context).textTheme.labelMedium,
          ),
          for (final id in actions.highlightedIds)
            ActionChip(
              key: ValueKey('map-highlight-$id'),
              avatar: const Icon(Icons.place_outlined, size: 16),
              label: Text(byId[id]?.title ?? id),
              onPressed: byId[id] == null ? null : () => _selectItem(byId[id]!),
            ),
          for (final id in actions.missingIds)
            Chip(
              key: ValueKey('map-highlight-missing-$id'),
              avatar: const Icon(Icons.help_outline, size: 16),
              label: Text(id),
            ),
          TextButton(
            key: const ValueKey('map-highlights-clear'),
            onPressed: () => ref
                .read(mapActionsControllerProvider.notifier)
                .clearHighlights(),
            child: Text(strings.mapAgentHighlightsClear),
          ),
        ],
      ),
    );
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
    if (_holdingNearby) _nearby.setActive(false);
    _regionGeneration++;
    _map = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final viewport = ref.watch(viewportControllerProvider);
    final layers = ref.watch(layerControllerProvider);
    final selection = ref.watch(selectionControllerProvider);
    final catalog = ref.watch(mapLayerCatalogProvider);
    final actions = ref.watch(mapActionsControllerProvider);
    final communityOn = ref.watch(communityLayerEnabledProvider);
    final userEvents = communityOn
        ? ref.watch(
            nearbyUserEventsControllerProvider.select((state) => state.events),
          )
        : const <UserEvent>[];
    final pickingPin = ref.watch(
      userEventPinPickerProvider.select((state) => state.active),
    );
    final clock = ref.watch(melbourneClockProvider);
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
        compact: true,
        layers: response?.layers ?? const [],
        enabledLayers: layers.enabledLayers,
        dataMode: response?.dataMode ?? viewport.dataMode,
        selectedItemId: selection.highlightedItemId,
        onItemSelected: _selectItem,
        onAggregateSelected: _selectItem,
        onMapTap: pickingPin
            ? (position) => _placeEventPin(context, position)
            : null,
        overlay: userEvents.isEmpty
            ? null
            : userEventMarkers(
                events: userEvents,
                snippetOf: (event) => formatEventTime(clock, event.startAt),
                onTap: _openUserEvent,
              ),
        onCameraChanged: (camera) {
          _zoom = camera.zoom;
          _regionGeneration++;
          ref.read(viewportControllerProvider.notifier).cameraMoving();
        },
        onCameraIdle: () => unawaited(_readVisibleRegion()),
        onMapCreated: (controller) {
          _map = controller;
          unawaited(_readVisibleRegion());
          if (_pendingFocus case final pending?) {
            _pendingFocus = null;
            _applyFocus(pending);
          }
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
    } else if (_cardItem case final cardItem?) {
      details = CardItemDetails(
        item: cardItem,
        onClose: () => setState(() => _cardItem = null),
        onOpenSource: _sourceOpener,
      );
    } else {
      details = null;
    }
    final highlights = _highlightBar(items, actions);
    final status = _queryStatus(catalog, viewport);
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 1050;
        final theme = Theme.of(context);
        final overlay = PointerInterceptor(
          child: SafeArea(
            bottom: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                _layerChips(layers, communityOn, wide: wide),
                if (viewport.isLoading)
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: LinearProgressIndicator(
                      minHeight: 3,
                      borderRadius: BorderRadius.all(Radius.circular(2)),
                    ),
                  ),
                if (status.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surface.withValues(
                            alpha: 0.94,
                          ),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                          child: Semantics(
                            liveRegion: true,
                            child: Wrap(
                              spacing: 12,
                              runSpacing: 4,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: status,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ?highlights,
                if (pickingPin) _pinPickingBanner(),
              ],
            ),
          ),
        );
        final stage = Stack(
          children: [
            Positioned.fill(child: map),
            Positioned(left: 0, right: 0, top: 0, child: overlay),
          ],
        );
        return Scaffold(
          body: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (wide)
                SizedBox(
                  width: 320,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border(
                        right: BorderSide(color: theme.colorScheme.outlineVariant),
                      ),
                    ),
                    child: SafeArea(
                      bottom: false,
                      child: SingleChildScrollView(
                        child: _sheetContent(
                          catalog,
                          viewport,
                          enabledLayers: layers.enabledLayers,
                          items: items,
                          selectedItemId: selection.highlightedItemId,
                          hasUnlocated: unlocated != null,
                        ),
                      ),
                    ),
                  ),
                ),
              Expanded(child: MapDetailsLayout(map: stage, details: details)),
              if (wide && _showEvents)
                SizedBox(
                  width: 380,
                  child: _eventsPanel(
                    onClose: () => setState(() => _showEvents = false),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  // ---- User events (UC-09) ----

  /// The community layer switch also decides whether the nearby events load
  /// while the panel is closed, so their pins stay on the map.
  void _setCommunity(bool on) {
    ref.read(communityLayerEnabledProvider.notifier).set(enabled: on);
    _syncNearbyLoading(on);
  }

  void _syncNearbyLoading(bool on) {
    if (on == _holdingNearby) return;
    _holdingNearby = on;
    _nearby.setActive(on);
  }

  /// Moves the camera to a user event's pin, through the same focus request
  /// the agent's `focus_map` uses.
  void _showEventOnMap(AgentLatLng point) =>
      ref.read(mapActionsControllerProvider.notifier).focusPoint(
        point.lat,
        point.lng,
      );

  Widget _eventsPanel({
    VoidCallback? onClose,
    ValueChanged<AgentLatLng>? onShowOnMap,
    VoidCallback? onPickOnMap,
  }) => UserEventsPanel(
    key: ValueKey('map-events-panel-$_eventsPanelNonce'),
    initialEventId: _panelEventId,
    startWithForm: _panelNewEvent,
    onClose: onClose,
    onShowOnMap: onShowOnMap ?? _showEventOnMap,
    onPickOnMap: onPickOnMap,
  );

  void _showEventsSheet() {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (sheetContext) => PointerInterceptor(
          child: SizedBox(
            height: math.min(760, MediaQuery.sizeOf(sheetContext).height * 0.9),
            child: _eventsPanel(
              onClose: () => Navigator.of(sheetContext).pop(),
              // The sheet covers the map, so showing a place closes it.
              onShowOnMap: (point) {
                Navigator.of(sheetContext).pop();
                _showEventOnMap(point);
              },
              // Picking a pin needs the map; the tap reopens the sheet.
              onPickOnMap: () => Navigator.of(sheetContext).pop(),
            ),
          ),
        ),
      ),
    );
  }

  /// Opens the panel on an event or on the new-event form, once.
  void _openEventsPanel({String? eventId, bool newEvent = false}) {
    _panelEventId = eventId;
    _panelNewEvent = newEvent;
    _eventsPanelNonce++;
    if (MediaQuery.sizeOf(context).width >= 1050) {
      setState(() => _showEvents = true);
    } else {
      _showEventsSheet();
    }
  }

  void _takeEventsPanelRequest(EventsPanelRequest request) {
    ref.read(eventsPanelRequestsProvider.notifier).consume(request.sequence);
    _openEventsPanel(eventId: request.eventId, newEvent: request.newEvent);
  }

  /// The tap that places the event pin while the form is picking one; the
  /// panel comes back so the form shows the point.
  void _placeEventPin(BuildContext context, LatLng position) {
    ref
        .read(userEventPinPickerProvider.notifier)
        .place(AgentLatLng(lat: position.latitude, lng: position.longitude));
    _returnToEventForm();
  }

  void _returnToEventForm() {
    // The form's draft is kept; the panel reads it when it comes back.
    _panelEventId = null;
    _panelNewEvent = false;
    if (MediaQuery.sizeOf(context).width >= 1050) {
      if (!_showEvents) setState(() => _showEvents = true);
    } else {
      _showEventsSheet();
    }
  }

  /// Shown above the map while the event form waits for a tap.
  Widget _pinPickingBanner() {
    final strings = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Material(
        key: const ValueKey('map-pin-picking-banner'),
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            children: [
              Icon(
                Icons.add_location_alt_outlined,
                color: colors.onTertiaryContainer,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  strings.eventsFormPickBanner,
                  style: TextStyle(color: colors.onTertiaryContainer),
                ),
              ),
              TextButton(
                key: const ValueKey('map-pin-picking-stop'),
                onPressed: () {
                  ref.read(userEventPinPickerProvider.notifier).cancel();
                  _returnToEventForm();
                },
                child: Text(strings.eventsFormPickStop),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// A tapped user event pin opens the event in the panel.
  void _openUserEvent(UserEvent event) {
    ref.read(openUserEventProvider.notifier).open(event.id);
    _openEventsPanel(eventId: event.id);
  }

  /// The layers as chips: filled and ticked when on, outlined when off, so
  /// what the map shows is readable at a glance. The community layer sits
  /// beside the contract layers; the tune button opens the full panel.
  Widget _layerChips(
    LayerSelectionState layers,
    bool communityOn, {
    required bool wide,
  }) {
    final strings = AppLocalizations.of(context);
    final controller = ref.read(layerControllerProvider.notifier);
    final scheme = Theme.of(context).colorScheme;
    Widget chip({
      required Key key,
      required String label,
      required bool on,
      required ValueChanged<bool> onChanged,
    }) => Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        key: key,
        avatar: Icon(
          on ? Icons.check_circle : Icons.circle_outlined,
          size: 18,
          color: on ? scheme.primary : scheme.outline,
        ),
        label: Text(label),
        selected: on,
        backgroundColor: scheme.surface,
        onSelected: onChanged,
      ),
    );
    return SizedBox(
      height: 56,
      child: Row(
        children: [
          Expanded(
            child: ListView(
              key: const ValueKey('map-layer-chips'),
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
              children: [
                for (final layer in layers.availableLayers)
                  chip(
                    key: ValueKey('map-chip-${layer.name}'),
                    label: layerTitle(strings, layer),
                    on: layers.isLayerEnabled(layer),
                    onChanged: (on) => controller.setLayerEnabled(layer, on),
                  ),
                chip(
                  key: const ValueKey('map-chip-community'),
                  label: strings.mapCommunityLayer,
                  on: communityOn,
                  onChanged: _setCommunity,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: IconButton.filledTonal(
              key: const ValueKey('map-events-toggle'),
              tooltip: wide && _showEvents
                  ? strings.eventsClose
                  : strings.eventsOpen,
              isSelected: wide && _showEvents,
              onPressed: () => wide
                  ? setState(() => _showEvents = !_showEvents)
                  : _showEventsSheet(),
              icon: const Icon(Icons.event_outlined),
              selectedIcon: const Icon(Icons.event),
            ),
          ),
          if (!wide)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: IconButton.filled(
                key: const ValueKey('map-layers-button'),
                tooltip: strings.mapLayersButton,
                onPressed: _showLayersSheet,
                icon: const Icon(Icons.layers_outlined),
              ),
            ),
        ],
      ),
    );
  }

  /// The full panel: topics, every layer with its availability, the time
  /// window, layer statuses, the legend and the text list of results.
  Widget _sheetContent(
    AsyncValue<MapLayerCatalog> catalog,
    ViewportState viewport, {
    required Set<MapLayerId> enabledLayers,
    required List<MapItem> items,
    required String? selectedItemId,
    required bool hasUnlocated,
    VoidCallback? afterAction,
  }) {
    final strings = AppLocalizations.of(context);
    void select(MapItem item) {
      afterAction?.call();
      _selectItem(item);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _timeControls(viewport),
        _controls(catalog, viewport),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: MapLegend(enabledLayers: enabledLayers),
        ),
        ListTile(
          key: const ValueKey('map-show-unlocated'),
          enabled: hasUnlocated,
          leading: const Icon(Icons.list_alt),
          title: Text(strings.mapUnlocatedAction),
          onTap: hasUnlocated
              ? () {
                  afterAction?.call();
                  setState(() {
                    _showUnlocated = true;
                  });
                }
              : null,
        ),
        SizedBox(
          height: 240,
          child: MapObjectList(
            items: items,
            selectedItemId: selectedItemId,
            onSelected: select,
          ),
        ),
      ],
    );
  }

  void _showLayersSheet() {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (sheetContext) => PointerInterceptor(
          child: SizedBox(
            height: math.min(720, MediaQuery.sizeOf(sheetContext).height * 0.88),
            child: Consumer(
              builder: (context, ref, child) {
                final viewport = ref.watch(viewportControllerProvider);
                final layers = ref.watch(layerControllerProvider);
                final catalog = ref.watch(mapLayerCatalogProvider);
                final selection = ref.watch(selectionControllerProvider);
                final items =
                    viewport.response?.layers
                        .expand((layer) => layer.items)
                        .where(
                          (item) => layers.enabledLayers.contains(item.layerId),
                        )
                        .toList() ??
                    const <MapItem>[];
                return SingleChildScrollView(
                  child: _sheetContent(
                    catalog,
                    viewport,
                    enabledLayers: layers.enabledLayers,
                    items: items,
                    selectedItemId: selection.highlightedItemId,
                    hasUnlocated:
                        _unlocatedQuery(catalog.value, viewport) != null,
                    afterAction: () => Navigator.of(sheetContext).pop(),
                  ),
                );
              },
            ),
          ),
        ),
      ),
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

  /// What the map is doing or lacking, as short lines; empty when all is well.
  List<Widget> _queryStatus(
    AsyncValue<MapLayerCatalog> catalog,
    ViewportState state,
  ) {
    final strings = AppLocalizations.of(context);
    return [
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
    ];
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
}

String _filters(AreaFilter? area, BoundaryFilter? boundary) =>
    jsonEncode({'area': area?.toJson(), 'boundary': boundary?.toJson()});
