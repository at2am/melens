import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../state/layer_controller.dart';
import 'map_status.dart';

String _topicTitle(AppLocalizations strings, MapTopic topic) => switch (topic) {
  MapTopic.cityActivity => strings.mapTopicCityActivity,
  MapTopic.nearbyNews => strings.mapTopicNearbyNews,
  MapTopic.areaComparison => strings.mapTopicAreaComparison,
  MapTopic.context => throw ArgumentError.value(topic, 'topic'),
};

String _layerTitle(AppLocalizations strings, MapLayerId layer) =>
    switch (layer) {
      MapLayerId.pedestrian => strings.mapLayerPedestrian,
      MapLayerId.anomaly => strings.mapLayerAnomaly,
      MapLayerId.disruption => strings.mapLayerDisruption,
      MapLayerId.event => strings.mapLayerEvent,
      MapLayerId.planning => strings.mapLayerPlanning,
      MapLayerId.boundary => strings.mapLayerBoundary,
      MapLayerId.news => strings.mapLayerNews,
      MapLayerId.rent => strings.mapLayerRent,
      MapLayerId.census => strings.mapLayerCensus,
    };

String _availabilityText(
  AppLocalizations strings,
  MapAvailability availability,
) => switch (availability) {
  MapAvailability.available => strings.mapStatusAvailable,
  MapAvailability.notCovered => strings.mapStatusNotCovered,
  MapAvailability.unavailable => strings.mapStatusUnavailable,
  MapAvailability.unknown => strings.mapStatusUnknown,
};

/// Topic and layer intent only. Integration supplies catalog evidence and gates.
/// A selected toggle never claims source admission, coverage or a nonempty query.
class LayerPanel extends ConsumerWidget {
  const LayerPanel({
    this.catalog,
    this.selectableTopics = const {MapTopic.cityActivity},
    super.key,
  });

  final MapLayerCatalog? catalog;

  /// The P0 shell exposes later topic metadata without starting later workflows.
  final Set<MapTopic> selectableTopics;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final selection = ref.watch(layerControllerProvider);
    final controller = ref.read(layerControllerProvider.notifier);
    final descriptors = {
      for (final layer in catalog?.layers ?? <LayerDescriptor>[])
        layer.id: layer,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          strings.mapLayerPanelTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        if (catalog != null) MapDataModeLabel(dataMode: catalog!.dataMode),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final preset in layerTopicPresets)
              ChoiceChip(
                key: ValueKey('topic-${preset.topic.name}'),
                label: Text(_topicTitle(strings, preset.topic)),
                selected: selection.topic == preset.topic,
                onSelected: selectableTopics.contains(preset.topic)
                    ? (selected) {
                        if (selected) controller.selectTopic(preset.topic);
                      }
                    : null,
              ),
          ],
        ),
        if (layerTopicPresets.any(
          (preset) => !selectableTopics.contains(preset.topic),
        )) ...[
          const SizedBox(height: 8),
          Text(strings.mapLaterTopicsUnavailable),
        ],
        if (selection.topic == MapTopic.areaComparison) ...[
          const SizedBox(height: 8),
          Text(strings.mapOneAreaMetric),
        ],
        for (final layer in selection.availableLayers)
          SwitchListTile.adaptive(
            key: ValueKey('layer-${layer.name}'),
            contentPadding: EdgeInsets.zero,
            title: Text(_layerTitle(strings, layer)),
            subtitle: Text(
              _availabilityText(
                strings,
                descriptors[layer]?.availability ?? MapAvailability.unknown,
              ),
            ),
            value: selection.isLayerEnabled(layer),
            onChanged: (enabled) => controller.setLayerEnabled(layer, enabled),
          ),
        if (selection.enabledLayers.isEmpty) Text(strings.mapNoLayersSelected),
      ],
    );
  }
}
