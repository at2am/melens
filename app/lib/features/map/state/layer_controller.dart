import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../data/layer_memory.dart';
import '../data/map_models.dart';

part 'layer_controller.g.dart';

/// Topic metadata is independent of publication and product delivery gates.
final class LayerTopicPreset {
  const LayerTopicPreset({
    required this.topic,
    required this.layers,
    required this.defaultLayers,
  });

  final MapTopic topic;
  final List<MapLayerId> layers;
  final Set<MapLayerId> defaultLayers;
}

const layerTopicPresets = [
  LayerTopicPreset(
    topic: MapTopic.cityActivity,
    layers: [
      MapLayerId.pedestrian,
      MapLayerId.anomaly,
      MapLayerId.disruption,
      MapLayerId.event,
      MapLayerId.planning,
      // UC-15, opt-in: shows live bay sensors for the area being viewed.
      MapLayerId.parking,
      MapLayerId.boundary,
    ],
    defaultLayers: {
      MapLayerId.pedestrian,
      MapLayerId.anomaly,
      MapLayerId.disruption,
    },
  ),
  LayerTopicPreset(
    topic: MapTopic.nearbyNews,
    layers: [MapLayerId.news, MapLayerId.boundary],
    defaultLayers: {MapLayerId.news},
  ),
  LayerTopicPreset(
    topic: MapTopic.areaComparison,
    layers: [
      MapLayerId.rent,
      MapLayerId.census,
      MapLayerId.boundary,
      MapLayerId.pedestrian,
      MapLayerId.anomaly,
      MapLayerId.disruption,
      MapLayerId.event,
      MapLayerId.planning,
    ],
    defaultLayers: {MapLayerId.rent},
  ),
];

LayerTopicPreset layerPresetFor(MapTopic topic) => switch (topic) {
  MapTopic.cityActivity => layerTopicPresets[0],
  MapTopic.nearbyNews => layerTopicPresets[1],
  MapTopic.areaComparison => layerTopicPresets[2],
  MapTopic.context => throw ArgumentError.value(
    topic,
    'topic',
    'Context layers do not define a selectable topic.',
  ),
};

/// A topic stores user intent even when its selected sources are unavailable.
/// Camera, time/filter context and request results belong to other controllers.
final class LayerSelectionState {
  LayerSelectionState._({
    required this.topic,
    required Map<MapTopic, Set<MapLayerId>> sessions,
  }) : _sessions = Map.unmodifiable({
         for (final entry in sessions.entries)
           entry.key: Set<MapLayerId>.unmodifiable(entry.value),
       });

  factory LayerSelectionState.initial() => LayerSelectionState._(
    topic: MapTopic.cityActivity,
    sessions: {
      for (final preset in layerTopicPresets)
        preset.topic: preset.defaultLayers,
    },
  );

  /// [saved] trimmed to what each topic offers, so a build that drops or
  /// moves a layer still opens cleanly. Topics [saved] does not mention keep
  /// their defaults.
  factory LayerSelectionState.restored(RememberedLayers saved) {
    final initial = LayerSelectionState.initial();
    final sessions = {...initial._sessions};
    for (final MapEntry(key: topic, value: layers) in saved.layers.entries) {
      if (topic == MapTopic.context) continue;
      final kept = layers.where(layerPresetFor(topic).layers.contains).toSet();
      // Rent and census share the filled areas; only one can be on.
      if (kept.contains(MapLayerId.rent)) kept.remove(MapLayerId.census);
      sessions[topic] = kept;
    }
    return LayerSelectionState._(
      topic: saved.topic == MapTopic.context ? initial.topic : saved.topic,
      sessions: sessions,
    );
  }

  final MapTopic topic;
  final Map<MapTopic, Set<MapLayerId>> _sessions;

  RememberedLayers get remembered => (topic: topic, layers: _sessions);

  List<MapLayerId> get availableLayers => layerPresetFor(topic).layers;

  Set<MapLayerId> get enabledLayers => layersForTopic(topic);

  /// Stable preset order is suitable for request keys and agent context.
  List<MapLayerId> get enabledLayerIds =>
      List.unmodifiable(availableLayers.where(enabledLayers.contains));

  MapLayerId? get filledAreaMetric {
    if (enabledLayers.contains(MapLayerId.rent)) return MapLayerId.rent;
    if (enabledLayers.contains(MapLayerId.census)) return MapLayerId.census;
    return null;
  }

  Set<MapLayerId> layersForTopic(MapTopic target) {
    layerPresetFor(target);
    return _sessions[target]!;
  }

  bool isLayerEnabled(MapLayerId layer) => enabledLayers.contains(layer);
}

/// Saves the layers on this device (UC-01).
/// Tests override this with an in-memory [LayerMemory].
@Riverpod(keepAlive: true)
LayerMemory layerMemory(Ref ref) => PreferencesLayerMemory();

/// Keep topic adjustments across panel closure and, through [LayerMemory],
/// across launches: the map opens on the layers the user last had on.
/// This controller never reads data or activates a source.
@Riverpod(keepAlive: true)
class LayerController extends _$LayerController {
  /// Set by the first change, so a remembered selection that arrives late
  /// never replaces what the user or the agent has already chosen.
  bool _changed = false;

  @override
  LayerSelectionState build() {
    unawaited(_restore());
    return LayerSelectionState.initial();
  }

  Future<void> _restore() async {
    final saved = await ref.read(layerMemoryProvider).readLayers();
    if (saved == null || _changed || !ref.mounted) return;
    state = LayerSelectionState.restored(saved);
  }

  void _commit(LayerSelectionState next) {
    _changed = true;
    state = next;
    unawaited(ref.read(layerMemoryProvider).writeLayers(next.remembered));
  }

  void selectTopic(MapTopic topic) {
    layerPresetFor(topic);
    if (topic == state.topic) return;
    _commit(LayerSelectionState._(topic: topic, sessions: state._sessions));
  }

  void toggleLayer(MapLayerId layer) =>
      setLayerEnabled(layer, !state.isLayerEnabled(layer));

  void setLayerEnabled(MapLayerId layer, bool enabled) {
    if (!state.availableLayers.contains(layer)) {
      throw ArgumentError.value(layer, 'layer', 'Layer is outside this topic.');
    }
    if (state.isLayerEnabled(layer) == enabled) return;
    final next = {...state.enabledLayers};
    if (enabled) {
      if (layer == MapLayerId.rent || layer == MapLayerId.census) {
        next.removeAll({MapLayerId.rent, MapLayerId.census});
      }
      next.add(layer);
    } else {
      next.remove(layer);
    }
    _commit(
      LayerSelectionState._(
        topic: state.topic,
        sessions: {...state._sessions, state.topic: next},
      ),
    );
  }
}
