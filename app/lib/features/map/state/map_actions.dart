import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../agent/data/agent_models.dart';
import '../data/map_models.dart';
import 'layer_controller.dart';

part 'map_actions.g.dart';

/// What happened to a `ui_action` in the app. The chat panel shows it next to
/// the action, which is the visible trace for testing the agent.
enum MapActionOutcome {
  applied,

  /// Some of the requested layers or ids could not be used.
  partial,

  /// Nothing in the arguments could be applied.
  ignored,

  /// The app does not implement this action yet.
  unsupported,

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

final class MapActionsState {
  const MapActionsState({
    this.highlightedIds = const [],
    this.missingIds = const [],
    this.focus,
  });

  /// Feature ids the agent asked to highlight, in request order.
  final List<String> highlightedIds;

  /// Ids the server could not find in the turn; shown, never drawn.
  final List<String> missingIds;

  final MapFocusRequest? focus;

  MapActionsState _with({
    List<String>? highlightedIds,
    List<String>? missingIds,
    MapFocusRequest? focus,
  }) => MapActionsState(
    highlightedIds: highlightedIds ?? this.highlightedIds,
    missingIds: missingIds ?? this.missingIds,
    focus: focus ?? this.focus,
  );
}

/// Applies the agent's one-way UI actions to the map (agent-protocol.md,
/// Rules). The server never waits for a result; the next request context
/// reports the real state.
@Riverpod(keepAlive: true)
class MapActionsController extends _$MapActionsController {
  static final _log = Logger('MapActions');
  int _focusSequence = 0;

  @override
  MapActionsState build() => const MapActionsState();

  MapActionReport apply(UiAction action) {
    final report = switch (action.action) {
      UiActionName.showLayers => _showLayers(action.args),
      UiActionName.focusMap => _focusMap(action.args),
      UiActionName.highlightFeatures => _highlight(action.args),
      UiActionName.drawRoute => const MapActionReport(
        MapActionOutcome.unsupported,
      ),
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

  void clearHighlights() {
    state = state._with(highlightedIds: const [], missingIds: const []);
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

  MapActionReport _highlight(Map<String, dynamic> args) {
    final ids = _strings(args['ids']);
    final missing = _strings(args['missing']);
    final clear = args['clear_previous'] != false;
    final highlighted = clear
        ? ids
        : [
            ...state.highlightedIds,
            ...ids.where((id) => !state.highlightedIds.contains(id)),
          ];
    state = state._with(
      highlightedIds: List.unmodifiable(highlighted),
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
