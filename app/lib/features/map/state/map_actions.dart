import 'dart:math' as math;

import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/geo/polyline.dart';
import '../../agent/data/agent_models.dart';
import '../data/map_models.dart';
import 'layer_controller.dart';
import 'viewport_controller.dart';

part 'map_actions.g.dart';

/// What happened to a `ui_action` in the app. The chat panel shows it next to
/// the action, which is the visible trace for testing the agent.
enum MapActionOutcome {
  applied,

  /// Some of the requested layers or ids could not be used.
  partial,

  /// Nothing in the arguments could be applied.
  ignored,

  /// Read back from a stored turn; never re-applied.
  restored,
}

final class MapActionReport {
  const MapActionReport(this.outcome, {this.skipped = const []});

  final MapActionOutcome outcome;

  /// Layer names or feature ids the app could not use.
  final List<String> skipped;
}

/// A camera move the map screen applies once; `sequence` makes repeats of
/// the same target distinct.
final class MapFocusRequest {
  const MapFocusRequest({
    required this.sequence,
    this.point,
    this.bounds,
    this.featureId,
    this.zoom,
  });

  final int sequence;
  final AgentLatLng? point;
  final AgentViewport? bounds;
  final String? featureId;
  final int? zoom;
}

/// A route the agent drew with `draw_route`, decoded and ready to render.
final class AgentRoute {
  const AgentRoute({
    required this.sequence,
    required this.points,
    required this.waypoints,
    required this.mode,
    this.distanceMetres,
    this.durationMinutes,
  });

  final int sequence;

  /// The decoded path, at least two points.
  final List<AgentLatLng> points;

  /// The stops the route passes through, first to last; may be empty.
  final List<RouteWaypoint> waypoints;

  /// `walk` or `transit`.
  final String mode;
  final int? distanceMetres;
  final int? durationMinutes;
}

final class RouteWaypoint {
  const RouteWaypoint({required this.point, this.label});

  final AgentLatLng point;
  final String? label;
}

final class MapActionsState {
  const MapActionsState({
    this.highlightedIds = const [],
    this.highlightTitles = const {},
    this.missingIds = const [],
    this.focus,
    this.route,
  });

  /// Feature ids the agent asked to highlight, in request order.
  final List<String> highlightedIds;

  /// The agent's title for each highlighted id, for one the map has not
  /// loaded (an event later tonight while the map shows what is on now).
  final Map<String, String> highlightTitles;

  /// Ids the server could not find in the turn; shown, never drawn.
  final List<String> missingIds;

  final MapFocusRequest? focus;

  /// The route on the map, or null.
  final AgentRoute? route;

  MapActionsState _with({
    List<String>? highlightedIds,
    Map<String, String>? highlightTitles,
    List<String>? missingIds,
    MapFocusRequest? focus,
    AgentRoute? route,
    bool clearRoute = false,
  }) => MapActionsState(
    highlightedIds: highlightedIds ?? this.highlightedIds,
    highlightTitles: highlightTitles ?? this.highlightTitles,
    missingIds: missingIds ?? this.missingIds,
    focus: focus ?? this.focus,
    route: clearRoute ? null : route ?? this.route,
  );
}

/// The map as a turn found it before its first UI action: the layers, what
/// was highlighted, the route and the camera. Undoing the turn's map changes
/// puts these back.
final class MapSnapshot {
  const MapSnapshot({
    required this.topic,
    required this.layers,
    required this.actions,
    this.viewport,
  });

  final MapTopic topic;
  final Set<MapLayerId> layers;
  final MapActionsState actions;

  /// The visible region, once the map has reported one.
  final AgentViewport? viewport;
}

/// Applies the agent's one-way UI actions to the map (agent-protocol.md,
/// Rules). The server never waits for a result; the next request context
/// reports the real state.
@Riverpod(keepAlive: true)
class MapActionsController extends _$MapActionsController {
  static final _log = Logger('MapActions');
  int _focusSequence = 0;
  int _routeSequence = 0;

  @override
  MapActionsState build() => const MapActionsState();

  MapActionReport apply(UiAction action) {
    final report = switch (action.action) {
      UiActionName.showLayers => _showLayers(action.args),
      UiActionName.focusMap => _focusMap(action.args),
      UiActionName.highlightFeatures => _highlight(action.args),
      UiActionName.drawRoute => _drawRoute(action.args),
    };
    _log.fine('${action.action.name}: ${report.outcome.name}');
    return report;
  }

  /// Moves the camera to a point for the app itself, for example from an
  /// event page. The agent's `focus_map` takes the same path.
  void focusPoint(double lat, double lng, {int zoom = 16}) {
    state = state._with(
      focus: MapFocusRequest(
        sequence: ++_focusSequence,
        point: AgentLatLng(lat: lat, lng: lng),
        zoom: zoom,
      ),
    );
  }

  /// Moves the camera to a record the app opened, such as a Home feed item:
  /// one point is centred, a line or area is fitted.
  void focusPoints(List<AgentLatLng> points) {
    if (points.isEmpty) return;
    final first = points.first;
    if (points.every((p) => p.lat == first.lat && p.lng == first.lng)) {
      focusPoint(first.lat, first.lng);
      return;
    }
    state = state._with(
      focus: MapFocusRequest(
        sequence: ++_focusSequence,
        bounds: _boundsOf(points),
      ),
    );
  }

  /// What the map shows now, so a turn's changes can be undone.
  MapSnapshot capture() {
    final layers = ref.read(layerControllerProvider);
    final bbox = ref.read(viewportControllerProvider).bbox;
    return MapSnapshot(
      topic: layers.topic,
      layers: Set.unmodifiable(layers.enabledLayers),
      actions: state,
      viewport: bbox == null
          ? null
          : AgentViewport(
              north: bbox.north,
              south: bbox.south,
              east: bbox.east,
              west: bbox.west,
            ),
    );
  }

  /// Puts the layers, highlights, route and camera of [snapshot] back.
  void restore(MapSnapshot snapshot) {
    final controller = ref.read(layerControllerProvider.notifier);
    controller.selectTopic(snapshot.topic);
    for (final layer in ref.read(layerControllerProvider).availableLayers) {
      controller.setLayerEnabled(layer, snapshot.layers.contains(layer));
    }
    final before = snapshot.actions;
    state = MapActionsState(
      highlightedIds: before.highlightedIds,
      highlightTitles: before.highlightTitles,
      missingIds: before.missingIds,
      route: before.route,
      focus: snapshot.viewport == null
          ? state.focus
          : MapFocusRequest(
              sequence: ++_focusSequence,
              bounds: snapshot.viewport,
            ),
    );
    _log.fine('Restored the map of an earlier turn');
  }

  /// Draws the conversation's last route and highlights again when the user
  /// reopens it from the session list. The layers and camera moves of old
  /// turns are not replayed: the map has moved on since.
  void restoreConversation(List<UiAction> actions) {
    clearRoute();
    clearHighlights();
    UiAction? last(UiActionName name) =>
        actions.reversed.where((action) => action.action == name).firstOrNull;
    final route = last(UiActionName.drawRoute);
    final highlight = last(UiActionName.highlightFeatures);
    if (highlight != null) apply(highlight);
    if (route != null) apply(route);
  }

  /// Removes the drawn route, for the dismiss chip and a new conversation.
  void clearRoute() {
    if (state.route != null) state = state._with(clearRoute: true);
  }

  void clearHighlights() {
    state = state._with(
      highlightedIds: const [],
      highlightTitles: const {},
      missingIds: const [],
    );
  }

  MapActionReport _showLayers(Map<String, dynamic> args) {
    final names = _strings(args['layers']);
    final requested = <MapLayerId>[];
    final skipped = <String>[];
    for (final name in names) {
      final layer = _layerByName(name);
      if (layer == null) {
        skipped.add(name);
      } else {
        requested.add(layer);
      }
    }
    final controller = ref.read(layerControllerProvider.notifier);
    final available = ref.read(layerControllerProvider).availableLayers;
    final applicable = requested.where(available.contains).toList();
    skipped.addAll(
      requested.where((layer) => !available.contains(layer)).map((l) => l.name),
    );
    final mode = args['mode'] is String ? args['mode'] as String : 'add';
    switch (mode) {
      case 'only':
        for (final layer in available) {
          controller.setLayerEnabled(layer, applicable.contains(layer));
        }
      case 'remove':
        for (final layer in applicable) {
          controller.setLayerEnabled(layer, false);
        }
      default:
        for (final layer in applicable) {
          controller.setLayerEnabled(layer, true);
        }
    }
    if (applicable.isEmpty && mode != 'only') {
      return MapActionReport(MapActionOutcome.ignored, skipped: skipped);
    }
    return MapActionReport(
      skipped.isEmpty ? MapActionOutcome.applied : MapActionOutcome.partial,
      skipped: skipped,
    );
  }

  MapActionReport _focusMap(Map<String, dynamic> args) {
    final Object? target = args['target'];
    if (target is! Map<String, dynamic>) {
      return const MapActionReport(MapActionOutcome.ignored);
    }
    final point = _latLng(target['point']);
    final bounds = _viewport(target['bbox']);
    final Object? featureId = target['feature_id'];
    final Object? zoom = args['zoom'];
    if (point == null && bounds == null) {
      return const MapActionReport(MapActionOutcome.ignored);
    }
    state = state._with(
      focus: MapFocusRequest(
        sequence: ++_focusSequence,
        point: point,
        bounds: bounds,
        featureId: featureId is String ? featureId : null,
        zoom: zoom is num ? zoom.round().clamp(0, 22) : null,
      ),
    );
    return const MapActionReport(MapActionOutcome.applied);
  }

  /// A route the agent computed with `draw: false` carries no polyline and is
  /// not drawn. A polyline that does not decode is ignored, never half drawn.
  MapActionReport _drawRoute(Map<String, dynamic> args) {
    final Object? encoded = args['polyline'];
    if (encoded is! String || encoded.isEmpty) {
      return const MapActionReport(MapActionOutcome.ignored);
    }
    final List<({double lat, double lng})> decoded;
    try {
      decoded = decodePolyline(encoded);
    } on FormatException {
      return const MapActionReport(MapActionOutcome.ignored);
    }
    if (decoded.length < 2) {
      return const MapActionReport(MapActionOutcome.ignored);
    }
    final points = [
      for (final p in decoded) AgentLatLng(lat: p.lat, lng: p.lng),
    ];
    final waypoints = <RouteWaypoint>[];
    final Object? rawWaypoints = args['waypoints'];
    if (rawWaypoints is List<dynamic>) {
      for (final raw in rawWaypoints) {
        final point = _latLng(raw);
        if (point == null) continue;
        final Object? label = (raw as Map<String, dynamic>)['label'];
        waypoints.add(
          RouteWaypoint(point: point, label: label is String ? label : null),
        );
      }
    }
    final Object? distance = args['distance_m'];
    final Object? duration = args['duration_min'];
    state = state._with(
      route: AgentRoute(
        sequence: ++_routeSequence,
        points: List.unmodifiable(points),
        waypoints: List.unmodifiable(waypoints),
        mode: args['mode'] == 'transit' ? 'transit' : 'walk',
        distanceMetres: distance is num && distance.isFinite
            ? distance.round()
            : null,
        durationMinutes: duration is num && duration.isFinite
            ? duration.round()
            : null,
      ),
      focus: MapFocusRequest(
        sequence: ++_focusSequence,
        bounds: _boundsOf(points),
      ),
    );
    return const MapActionReport(MapActionOutcome.applied);
  }

  /// A box around the points, padded so a straight north-south or east-west
  /// route still has area.
  static AgentViewport _boundsOf(List<AgentLatLng> points) {
    var north = points.first.lat;
    var south = north;
    var east = points.first.lng;
    var west = east;
    for (final p in points) {
      north = math.max(north, p.lat);
      south = math.min(south, p.lat);
      east = math.max(east, p.lng);
      west = math.min(west, p.lng);
    }
    const pad = 0.0005;
    return AgentViewport(
      north: north + pad,
      south: south - pad,
      east: east + pad,
      west: west - pad,
    );
  }

  MapActionReport _highlight(Map<String, dynamic> args) {
    final ids = _strings(args['ids']);
    final missing = _strings(args['missing']);
    final titles = switch (args['titles']) {
      final Map<String, dynamic> map => {
        for (final MapEntry(:key, :value) in map.entries)
          if (value is String && value.isNotEmpty) key: value,
      },
      _ => const <String, String>{},
    };
    final clear = args['clear_previous'] != false;
    final highlighted = clear
        ? ids
        : [
            ...state.highlightedIds,
            ...ids.where((id) => !state.highlightedIds.contains(id)),
          ];
    state = state._with(
      highlightedIds: List.unmodifiable(highlighted),
      highlightTitles: Map.unmodifiable({
        if (!clear) ...state.highlightTitles,
        ...titles,
      }),
      missingIds: List.unmodifiable(
        clear ? missing : [...state.missingIds, ...missing],
      ),
    );
    if (ids.isEmpty) {
      return MapActionReport(MapActionOutcome.ignored, skipped: missing);
    }
    return MapActionReport(
      missing.isEmpty ? MapActionOutcome.applied : MapActionOutcome.partial,
      skipped: missing,
    );
  }

  static MapLayerId? _layerByName(String name) {
    for (final layer in MapLayerId.values) {
      if (layer.name == name) return layer;
    }
    return null;
  }

  static List<String> _strings(Object? value) => value is List<dynamic>
      ? value.whereType<String>().toList(growable: false)
      : const [];

  static double? _double(Object? value) =>
      value is num && value.isFinite ? value.toDouble() : null;

  static AgentLatLng? _latLng(Object? value) {
    if (value is! Map<String, dynamic>) return null;
    final lat = _double(value['lat']);
    final lng = _double(value['lng']);
    if (lat == null || lng == null || lat.abs() > 90 || lng.abs() > 180) {
      return null;
    }
    return AgentLatLng(lat: lat, lng: lng);
  }

  static AgentViewport? _viewport(Object? value) {
    if (value is! Map<String, dynamic>) return null;
    final north = _double(value['north']);
    final south = _double(value['south']);
    final east = _double(value['east']);
    final west = _double(value['west']);
    if (north == null ||
        south == null ||
        east == null ||
        west == null ||
        north <= south ||
        east <= west) {
      return null;
    }
    return AgentViewport(north: north, south: south, east: east, west: west);
  }
}
