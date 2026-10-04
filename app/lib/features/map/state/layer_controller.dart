import 'package:riverpod_annotation/riverpod_annotation.dart';

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

  final MapTopic topic;
  final Map<MapTopic, Set<MapLayerId>> _sessions;

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

/// Keep topic adjustments for the application session, including panel closure.
/// This controller never reads data or activates a source.
@Riverpod(keepAlive: true)
class LayerController extends _$LayerController {
  @override
  LayerSelectionState build() => LayerSelectionState.initial();

  void selectTopic(MapTopic topic) {
    layerPresetFor(topic);
    if (topic == state.topic) return;
    state = LayerSelectionState._(topic: topic, sessions: state._sessions);
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
    state = LayerSelectionState._(
      topic: state.topic,
      sessions: {...state._sessions, state.topic: next},
    );
  }
}
