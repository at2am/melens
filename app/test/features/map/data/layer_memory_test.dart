import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/events/state/event_view_providers.dart';
import 'package:melens/features/map/data/layer_memory.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

import '../fake_layer_memory.dart';

void main() {
  setUp(() {
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.empty();
  });

  test(
    'preferences keep the topic, each topic\'s layers and community',
    () async {
      final memory = PreferencesLayerMemory();
      expect(await memory.readLayers(), isNull);
      expect(await memory.readCommunity(), isNull);

      await memory.writeLayers((
        topic: MapTopic.nearbyNews,
        layers: {
          MapTopic.cityActivity: {MapLayerId.event, MapLayerId.parking},
          MapTopic.nearbyNews: const {},
        },
      ));
      await memory.writeCommunity(enabled: false);

      final read = await PreferencesLayerMemory().readLayers();
      expect(read!.topic, MapTopic.nearbyNews);
      expect(read.layers, {
        MapTopic.cityActivity: {MapLayerId.event, MapLayerId.parking},
        MapTopic.nearbyNews: <MapLayerId>{},
      });
      expect(await PreferencesLayerMemory().readCommunity(), isFalse);
    },
  );

  test('names a newer or older build wrote are dropped, not fatal', () async {
    await SharedPreferencesAsync().setString(
      'map.layers.v1',
      '{"topic":"cityActivity","layers":{"cityActivity":["event","gone"],'
          '"retiredTopic":["news"]}}',
    );
    final read = await PreferencesLayerMemory().readLayers();
    expect(read!.layers, {
      MapTopic.cityActivity: {MapLayerId.event},
    });

    await SharedPreferencesAsync().setString('map.layers.v1', 'not json');
    expect(await PreferencesLayerMemory().readLayers(), isNull);
  });

  test('the community switch opens as remembered and saves changes', () async {
    final memory = FakeLayerMemory(community: false);
    final container = ProviderContainer.test(
      overrides: [layerMemoryProvider.overrideWithValue(memory)],
    );
    expect(container.read(communityLayerEnabledProvider), isTrue);
    await container.pump();
    expect(container.read(communityLayerEnabledProvider), isFalse);

    container.read(communityLayerEnabledProvider.notifier).set(enabled: true);
    expect(memory.communityWrites, [true]);
  });
}
