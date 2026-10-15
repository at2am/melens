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
import '../../location/data/device_location.dart';
import '../../location/state/user_location.dart';
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
import 'map_layer_style.dart';
import 'map_status.dart';
import 'map_surface.dart';
import 'renderers/aggregate_renderer.dart';
import 'renderers/core_renderers.dart';
import 'renderers/marker_icons.dart';
import 'renderers/route_renderer.dart';
import 'unlocated_list.dart';

/// The marker id of the user's own position.
const userLocationMarkerId = 'user-location';

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

  /// What the map draws: the last results that were all ready together.
  ViewportResponse? _shownResponse;
  List<UserEvent> _shownEvents = const [];

  /// The next settled camera region came from a move the app asked for (a
  /// focus request or a zoom to an aggregate), so it is searched even with
  /// auto-search off.
  bool _searchNextRegion = false;

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
    ref.listenManual(userLocationProvider, (previous, next) {
      // Each new fix moves the camera to the user once.
      if (next.status == UserLocationStatus.on &&
          next.sequence != previous?.sequence &&
          next.point != null) {
        ref
            .read(mapActionsControllerProvider.notifier)
            .focusPoint(next.point!.lat, next.point!.lng, zoom: 15);
      }
    });
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
      final search = _searchNextRegion;
      _searchNextRegion = false;
      ref
          .read(viewportControllerProvider.notifier)
          .setRegion(bounds, _zoom.clamp(0, 22).toDouble(), search: search);
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
      _searchNextRegion = true;
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
    _searchNextRegion = true;
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

  /// Why My location did not work; nothing is shown otherwise.
  Widget? _locationMessage() {
    final failure = ref.watch(userLocationProvider.select((s) => s.failure));
    final status = ref.watch(userLocationProvider.select((s) => s.status));
    if (status != UserLocationStatus.failed || failure == null) return null;
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Align(
        alignment: Alignment.centerLeft,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: theme.colorScheme.errorContainer,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Semantics(
              liveRegion: true,
              child: Text(
                key: const ValueKey('map-location-error'),
                switch (failure) {
                  DeviceLocationFailure.denied => strings.mapMyLocationDenied,
                  DeviceLocationFailure.unavailable =>
                    strings.mapMyLocationUnavailable,
                  DeviceLocationFailure.timeout => strings.mapMyLocationTimeout,
                  DeviceLocationFailure.unsupported =>
                    strings.mapMyLocationUnsupported,
                },
                style: TextStyle(color: theme.colorScheme.onErrorContainer),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// The route the agent drew, with a way to take it off the map.
  Widget _routeChip(AgentRoute route) {
    final strings = AppLocalizations.of(context);
    final minutes = route.durationMinutes;
    final metres = route.distanceMetres;
    final label = minutes == null || metres == null
        ? strings.mapRouteSummaryBare(route.mode)
        : strings.mapRouteSummary(
            NumberFormat.decimalPattern('en_AU').format(minutes),
            NumberFormat('0.0', 'en_AU').format(metres / 1000),
            route.mode,
          );
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Align(
        alignment: Alignment.centerLeft,
        child: InputChip(
          key: const ValueKey('map-route-chip'),
          avatar: Icon(
            route.mode == 'transit'
                ? Icons.directions_transit_outlined
                : Icons.directions_walk,
            size: 18,
          ),
          label: Text(label),
          backgroundColor: Theme.of(context).colorScheme.surface,
          deleteIcon: const Icon(Icons.close, size: 18),
          deleteButtonTooltipMessage: strings.mapRouteRemove,
          onPressed: () => _zoomToBounds(
            MapBounds(
              west: route.points.map((p) => p.lng).reduce(math.min),
              south: route.points.map((p) => p.lat).reduce(math.min),
              east: route.points.map((p) => p.lng).reduce(math.max),
              north: route.points.map((p) => p.lat).reduce(math.max),
            ),
          ),
          onDeleted: () =>
              ref.read(mapActionsControllerProvider.notifier).clearRoute(),
        ),
      ),
    );
  }

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
    final nearbyEvents = ref.watch(
      nearbyUserEventsControllerProvider.select((state) => state.events),
    );
    final nearbyLoading =
        communityOn &&
        ref.watch(
          nearbyUserEventsControllerProvider.select((state) => state.isLoading),
        );
    // The map draws the previous results until every new one is in, so a
    // search replaces layers and pins in one step instead of blanking them.
    if (!viewport.isLoading && !nearbyLoading) {
      _shownResponse = viewport.response;
      _shownEvents = nearbyEvents;
    }
    final userEvents = communityOn ? _shownEvents : const <UserEvent>[];
    final pickingPin = ref.watch(
      userEventPinPickerProvider.select((state) => state.active),
    );
    final clock = ref.watch(melbourneClockProvider);
    final unlocated = _unlocatedQuery(catalog.value, viewport);
    final response = _shownResponse;
    final items =
        response?.layers
            .expand((layer) => layer.items)
            .where((item) => layers.enabledLayers.contains(item.layerId))
            .toList() ??
        const <MapItem>[];
    final route = actions.route;
    final userPoint = ref.watch(userLocationProvider.select((s) => s.point));
    final scheme = Theme.of(context).colorScheme;
    final strings = AppLocalizations.of(context);
    final pins =
        ref.watch(mapMarkerIconsProvider(markerPixelRatio(context))).value ??
        MapMarkerIcons.fallback;
    var overlayPlan = const CoreRenderPlan.empty();
    if (userEvents.isNotEmpty) {
      overlayPlan = overlayPlan.merge(
        userEventMarkers(
          events: userEvents,
          snippetOf: (event) => formatEventTime(clock, event.startAt),
          onTap: _openUserEvent,
          icons: pins,
        ),
      );
    }
    if (route != null) {
      overlayPlan = overlayPlan.merge(
        routeRenderPlan(
          route,
          color: scheme.primary,
          stopLabel: (number) => strings.mapRouteStop(number.toString()),
          icons: pins,
        ),
      );
    }
    if (userPoint != null) {
      overlayPlan = overlayPlan.merge(
        CoreRenderPlan(
          markers: {
            Marker(
              markerId: const MarkerId(userLocationMarkerId),
              position: LatLng(userPoint.lat, userPoint.lng),
              icon: pins.userLocation,
              anchor: pins.userLocationAnchor,
              infoWindow: InfoWindow(title: strings.mapMyLocationHere),
              zIndexInt: 5,
            ),
          },
        ),
      );
    }
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
        overlay: overlayPlan,
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
                _layerChips(layers, communityOn),
                _timePill(viewport),
                if (viewport.hasPendingRegion)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Center(
                      child: FilledButton.tonalIcon(
                        key: const ValueKey('map-search-area'),
                        onPressed: () => ref
                            .read(viewportControllerProvider.notifier)
                            .searchPendingRegion(),
                        icon: const Icon(Icons.search, size: 18),
                        label: Text(strings.mapSearchThisArea),
                      ),
                    ),
                  ),
                if (viewport.isLoading)
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
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
                if (route != null) _routeChip(route),
                ?_locationMessage(),
                if (pickingPin) _pinPickingBanner(),
              ],
            ),
          ),
        );
        final stage = Stack(
          children: [
            Positioned.fill(child: map),
            Positioned(left: 0, right: 0, top: 0, child: overlay),
            // Above the chat button, which the app frame floats at the
            // bottom right.
            Positioned(
              right: 16,
              bottom: 88,
              child: PointerInterceptor(
                child: _mapButtons(
                  wide: wide,
                  catalog: catalog,
                  viewport: viewport,
                  enabledLayers: layers.enabledLayers,
                  items: items,
                  selectedItemId: selection.highlightedItemId,
                  hasUnlocated: unlocated != null,
                ),
              ),
            ),
          ],
        );
        return Scaffold(
          body: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: MapDetailsLayout(map: stage, details: details),
              ),
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
  void _showEventOnMap(AgentLatLng point) => ref
      .read(mapActionsControllerProvider.notifier)
      .focusPoint(point.lat, point.lng);

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

  /// One chip per layer, community events included: filled when on, plain
  /// when off, each led by the badge its pins carry on the map. Tapping a
  /// chip is the only way to turn a layer on or off.
  Widget _layerChips(LayerSelectionState layers, bool communityOn) {
    final strings = AppLocalizations.of(context);
    final controller = ref.read(layerControllerProvider.notifier);
    final scheme = Theme.of(context).colorScheme;
    Widget chip({
      required Key key,
      required String label,
      required MapMarkerStyle style,
      required bool on,
      required ValueChanged<bool> onChanged,
    }) => Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        key: key,
        avatar: MapLayerBadge(style: style),
        label: Text(label),
        selected: on,
        showCheckmark: false,
        elevation: 2,
        shadowColor: Colors.black54,
        backgroundColor: scheme.surface,
        selectedColor: scheme.primary,
        labelStyle: TextStyle(
          color: on ? scheme.onPrimary : scheme.onSurface,
          fontWeight: on ? FontWeight.w600 : FontWeight.w500,
        ),
        side: BorderSide.none,
        onSelected: onChanged,
      ),
    );
    return SizedBox(
      height: 56,
      child: ListView(
        key: const ValueKey('map-layer-chips'),
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        children: [
          for (final layer in layers.availableLayers)
            chip(
              key: ValueKey('map-chip-${layer.name}'),
              label: layerTitle(strings, layer),
              style: layerStyle(layer),
              on: layers.isLayerEnabled(layer),
              onChanged: (on) => controller.setLayerEnabled(layer, on),
            ),
          chip(
            key: const ValueKey('map-chip-community'),
            label: strings.mapCommunityLayer,
            style: communityEventStyle,
            on: communityOn,
            onChanged: _setCommunity,
          ),
        ],
      ),
    );
  }

  /// My location, events and the results list: the three things the map
  /// offers beyond its layers, as round buttons in one column.
  Widget _mapButtons({
    required bool wide,
    required AsyncValue<MapLayerCatalog> catalog,
    required ViewportState viewport,
    required Set<MapLayerId> enabledLayers,
    required List<MapItem> items,
    required String? selectedItemId,
    required bool hasUnlocated,
  }) {
    final strings = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final location = ref.watch(userLocationProvider);
    final on = location.status == UserLocationStatus.on;
    final locating = location.status == UserLocationStatus.locating;
    Widget button({
      required Key key,
      required String tooltip,
      required Widget icon,
      required VoidCallback? onPressed,
      bool active = false,
    }) => Padding(
      padding: const EdgeInsets.only(top: 12),
      child: FloatingActionButton.small(
        key: key,
        heroTag: null,
        tooltip: tooltip,
        elevation: 2,
        backgroundColor: active ? scheme.primary : scheme.surface,
        foregroundColor: active ? scheme.onPrimary : scheme.onSurface,
        onPressed: onPressed,
        child: icon,
      ),
    );
    final eventsOpen = wide && _showEvents;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        button(
          key: const ValueKey('map-events-toggle'),
          tooltip: eventsOpen ? strings.eventsClose : strings.eventsOpen,
          active: eventsOpen,
          onPressed: () => wide
              ? setState(() => _showEvents = !_showEvents)
              : _showEventsSheet(),
          icon: const Icon(Icons.event_outlined),
        ),
        button(
          key: const ValueKey('map-layers-button'),
          tooltip: strings.mapResultsButton,
          onPressed: () => _showResultsSheet(wide: wide),
          icon: const Icon(Icons.format_list_bulleted),
        ),
        button(
          key: const ValueKey('map-chip-my-location'),
          tooltip: locating
              ? strings.mapMyLocationLocating
              : strings.mapMyLocation,
          active: on,
          onPressed: locating
              ? null
              : () {
                  final controller = ref.read(userLocationProvider.notifier);
                  if (on) {
                    controller.disable();
                  } else {
                    unawaited(controller.enable());
                  }
                },
          icon: locating
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Icon(on ? Icons.my_location : Icons.location_searching),
        ),
      ],
    );
  }

  /// What the map shows right now, as a list: the legend, the records, the
  /// ones without a place and, folded away, how fresh each layer's data is.
  Widget _resultsContent(
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
        ExpansionTile(
          key: const ValueKey('map-data-status'),
          title: Text(strings.mapDataStatus),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: _layerStatuses(viewport),
        ),
      ],
    );
  }

  void _showResultsSheet({required bool wide}) {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        constraints: const BoxConstraints(maxWidth: 560),
        builder: (sheetContext) => PointerInterceptor(
          child: SizedBox(
            height: math.min(
              720,
              MediaQuery.sizeOf(sheetContext).height * 0.88,
            ),
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
                  child: _resultsContent(
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
      if (state.blockedLayers.isNotEmpty) Text(strings.mapScreenFilterRequired),
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
      if (catalog.hasError) ...[
        Text(strings.mapScreenCatalogError),
        TextButton(
          onPressed: () => ref.invalidate(mapLayerCatalogProvider),
          child: Text(strings.mapScreenRetryCatalog),
        ),
      ],
    ];
  }

  /// The time the map shows, as one pill with a menu: now, or a past range
  /// ending now, plus a refresh.
  Widget _timePill(ViewportState state) {
    final strings = AppLocalizations.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final controller = ref.read(viewportControllerProvider.notifier);
    final scheme = Theme.of(context).colorScheme;
    final ranges = {
      const Duration(hours: 1): strings.mapTimePastHour,
      const Duration(days: 1): strings.mapTimePastDay,
      const Duration(days: 7): strings.mapTimePastWeek,
      const Duration(days: 31): strings.mapTimePastMonth,
    };
    final span = state.window.to.difference(state.window.from);
    final label = state.mode == MapQueryMode.current
        ? strings.mapTimeNow
        : ranges[span] ?? strings.mapScreenHistorical;

    void now() => controller.setWindow(
      MapQueryMode.current,
      currentViewportWindow(clock),
    );

    void past(Duration duration) {
      final end = currentViewportWindow(clock).to;
      controller.setWindow(
        MapQueryMode.historical,
        TimeWindow(from: end.subtract(duration), to: end),
      );
    }

    void refresh() {
      if (state.mode == MapQueryMode.current) {
        final window = currentViewportWindow(clock);
        if (window.from != state.window.from || window.to != state.window.to) {
          controller.setWindow(MapQueryMode.current, window, debounce: false);
          return;
        }
      }
      unawaited(controller.refresh());
    }

    return Padding(
      padding: const EdgeInsets.only(left: 16),
      child: Align(
        alignment: Alignment.centerLeft,
        child: PopupMenuButton<Duration>(
          key: const ValueKey('map-time-menu'),
          tooltip: strings.mapScreenHistoryRange,
          position: PopupMenuPosition.under,
          // Zero stands for "now": a menu entry needs a non-null value.
          onSelected: (value) => value == Duration.zero ? now() : past(value),
          itemBuilder: (context) => [
            CheckedPopupMenuItem<Duration>(
              key: const ValueKey('map-time-current'),
              value: Duration.zero,
              checked: state.mode == MapQueryMode.current,
              child: Text(strings.mapTimeNow),
            ),
            for (final entry in ranges.entries)
              CheckedPopupMenuItem<Duration>(
                value: entry.key,
                checked:
                    state.mode == MapQueryMode.historical && span == entry.key,
                child: Text(entry.value),
              ),
          ],
          child: Material(
            color: scheme.surface,
            elevation: 2,
            shape: const StadiumBorder(),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.schedule, size: 18, color: scheme.primary),
                  const SizedBox(width: 6),
                  Text(label, style: Theme.of(context).textTheme.labelLarge),
                  const Icon(Icons.arrow_drop_down),
                  IconButton(
                    key: const ValueKey('map-refresh'),
                    tooltip: strings.mapScreenRefresh,
                    visualDensity: VisualDensity.compact,
                    iconSize: 18,
                    onPressed: state.canQuery && !state.isLoading
                        ? refresh
                        : null,
                    icon: const Icon(Icons.refresh),
                  ),
                ],
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
