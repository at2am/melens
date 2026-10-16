import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/state/map_providers.dart';

void main() {
  test('each topic opens with its own typed default combination', () {
    final container = ProviderContainer.test();
    final controller = container.read(layerControllerProvider.notifier);
    var selection = container.read(layerControllerProvider);
    expect(selection.topic, MapTopic.cityActivity);
    expect(selection.enabledLayerIds, [
      MapLayerId.pedestrian,
      MapLayerId.anomaly,
      MapLayerId.disruption,
    ]);
    expect(selection.filledAreaMetric, isNull);
    // UC-06: the map has no topic switch, so news is an opt-in chip here.
    expect(selection.availableLayers, contains(MapLayerId.news));

    controller.selectTopic(MapTopic.nearbyNews);
    selection = container.read(layerControllerProvider);
    expect(selection.enabledLayerIds, [MapLayerId.news]);

    controller.selectTopic(MapTopic.areaComparison);
    selection = container.read(layerControllerProvider);
    expect(selection.enabledLayerIds, [MapLayerId.rent]);
    expect(selection.filledAreaMetric, MapLayerId.rent);
  });

  test(
    'topic changes restore adjustments without leaking to another topic',
    () {
      final container = ProviderContainer.test();
      final controller = container.read(layerControllerProvider.notifier);
      controller.setLayerEnabled(MapLayerId.disruption, false);
      controller.setLayerEnabled(MapLayerId.event, true);
      controller.setLayerEnabled(MapLayerId.boundary, true);

      controller.selectTopic(MapTopic.nearbyNews);
      expect(container.read(layerControllerProvider).enabledLayerIds, [
        MapLayerId.news,
      ]);
      controller.setLayerEnabled(MapLayerId.news, false);
      controller.setLayerEnabled(MapLayerId.boundary, true);

      controller.selectTopic(MapTopic.cityActivity);
      expect(container.read(layerControllerProvider).enabledLayerIds, [
        MapLayerId.pedestrian,
        MapLayerId.anomaly,
        MapLayerId.event,
        MapLayerId.boundary,
      ]);
      controller.selectTopic(MapTopic.nearbyNews);
      expect(container.read(layerControllerProvider).enabledLayerIds, [
        MapLayerId.boundary,
      ]);
    },
  );

  test('area metrics replace each other atomically and preserve helpers', () {
    final container = ProviderContainer.test();
    final observed = <LayerSelectionState>[];
    container.listen(layerControllerProvider, (previous, next) {
      observed.add(next);
    });
    final controller = container.read(layerControllerProvider.notifier);
    controller.selectTopic(MapTopic.areaComparison);
    controller.setLayerEnabled(MapLayerId.pedestrian, true);
    controller.setLayerEnabled(MapLayerId.disruption, true);
    controller.setLayerEnabled(MapLayerId.boundary, true);
    controller.setLayerEnabled(MapLayerId.census, true);

    var selection = container.read(layerControllerProvider);
    expect(selection.filledAreaMetric, MapLayerId.census);
    expect(selection.enabledLayers, {
      MapLayerId.census,
      MapLayerId.pedestrian,
      MapLayerId.disruption,
      MapLayerId.boundary,
    });
    controller.setLayerEnabled(MapLayerId.rent, true);
    selection = container.read(layerControllerProvider);
    expect(selection.filledAreaMetric, MapLayerId.rent);
    expect(selection.isLayerEnabled(MapLayerId.census), isFalse);
    expect(selection.isLayerEnabled(MapLayerId.pedestrian), isTrue);
    expect(selection.isLayerEnabled(MapLayerId.disruption), isTrue);
    expect(selection.isLayerEnabled(MapLayerId.boundary), isTrue);
    expect(
      observed.every(
        (value) =>
            value.enabledLayers.intersection({
              MapLayerId.rent,
              MapLayerId.census,
            }).length <=
            1,
      ),
      isTrue,
    );
    controller.setLayerEnabled(MapLayerId.rent, false);
    expect(container.read(layerControllerProvider).filledAreaMetric, isNull);
  });

  test('users can select an empty topic without inventing an empty result', () {
    final container = ProviderContainer.test();
    final controller = container.read(layerControllerProvider.notifier);
    for (final layer
        in container.read(layerControllerProvider).enabledLayerIds) {
      controller.setLayerEnabled(layer, false);
    }
    expect(container.read(layerControllerProvider).enabledLayerIds, isEmpty);
    controller.selectTopic(MapTopic.nearbyNews);
    controller.selectTopic(MapTopic.cityActivity);
    expect(container.read(layerControllerProvider).enabledLayers, isEmpty);
  });

  test(
    'context is not a topic and unrelated layers cannot leak into requests',
    () {
      final container = ProviderContainer.test();
      final controller = container.read(layerControllerProvider.notifier);
      final before = container.read(layerControllerProvider);
      expect(
        () => controller.selectTopic(MapTopic.context),
        throwsArgumentError,
      );
      expect(
        () => controller.setLayerEnabled(MapLayerId.rent, true),
        throwsArgumentError,
      );
      expect(
        () => controller.setLayerEnabled(MapLayerId.census, true),
        throwsArgumentError,
      );
      expect(container.read(layerControllerProvider), same(before));
    },
  );

  test(
    'published selections are immutable and earlier snapshots stay intact',
    () {
      final container = ProviderContainer.test();
      final before = container.read(layerControllerProvider);
      expect(
        () => before.enabledLayers.add(MapLayerId.event),
        throwsUnsupportedError,
      );
      expect(() => before.enabledLayerIds.clear(), throwsUnsupportedError);
      expect(
        () => before.layersForTopic(MapTopic.nearbyNews).clear(),
        throwsUnsupportedError,
      );
      container
          .read(layerControllerProvider.notifier)
          .toggleLayer(MapLayerId.event);
      expect(before.isLayerEnabled(MapLayerId.event), isFalse);
      expect(
        container
            .read(layerControllerProvider)
            .isLayerEnabled(MapLayerId.event),
        isTrue,
      );
    },
  );

  test(
    'closing the panel preserves session while a new scope starts fresh',
    () async {
      final container = ProviderContainer.test();
      final subscription = container.listen(
        layerControllerProvider,
        (previous, next) {},
      );
      container
          .read(layerControllerProvider.notifier)
          .toggleLayer(MapLayerId.event);
      subscription.close();
      await container.pump();
      expect(
        container
            .read(layerControllerProvider)
            .isLayerEnabled(MapLayerId.event),
        isTrue,
      );

      final newSession = ProviderContainer.test();
      expect(
        newSession
            .read(layerControllerProvider)
            .isLayerEnabled(MapLayerId.event),
        isFalse,
      );
    },
  );

  test('layer intent and topic metadata never initiate repository reads', () {
    final container = ProviderContainer.test(
      overrides: [
        mapRepositoryProvider.overrideWith((ref) {
          throw StateError('Layer metadata must not activate a data source.');
        }),
      ],
    );
    final controller = container.read(layerControllerProvider.notifier);
    controller.toggleLayer(MapLayerId.event);
    controller.selectTopic(MapTopic.nearbyNews);
    controller.toggleLayer(MapLayerId.news);
    controller.selectTopic(MapTopic.areaComparison);
    controller.toggleLayer(MapLayerId.census);
    expect(
      container.read(layerControllerProvider).filledAreaMetric,
      MapLayerId.census,
    );
  });
}
