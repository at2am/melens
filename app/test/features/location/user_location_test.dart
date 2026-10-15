import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/chat/state/request_context.dart';
import 'package:melens/features/location/data/device_location.dart';
import 'package:melens/features/location/state/user_location.dart';

void main() {
  const here = AgentLatLng(lat: -37.8136, lng: 144.9631);

  ProviderContainer containerWith(DeviceLocationReader reader) {
    final container = ProviderContainer.test(
      overrides: [deviceLocationReaderProvider.overrideWithValue(reader)],
    );
    // Keep the auto-dispose-free provider alive for the test.
    container.listen(userLocationProvider, (_, _) {});
    return container;
  }

  test('nothing is read or sent until the user switches it on', () async {
    var reads = 0;
    final container = containerWith(() async {
      reads++;
      return here;
    });

    expect(container.read(userLocationProvider).status, UserLocationStatus.off);
    expect(
      container.read(requestContextBuilderProvider)().userLocation,
      isNull,
    );
    expect(reads, 0);
  });

  test(
    'enable reads once, shares the point with the agent, and disable drops it',
    () async {
      var reads = 0;
      final container = containerWith(() async {
        reads++;
        return here;
      });
      final controller = container.read(userLocationProvider.notifier);

      await controller.enable();
      final on = container.read(userLocationProvider);
      expect(on.status, UserLocationStatus.on);
      expect(on.point, here);
      expect(on.sequence, 1);
      expect(reads, 1);
      expect(
        container.read(requestContextBuilderProvider)().userLocation?.lat,
        here.lat,
      );

      controller.disable();
      expect(container.read(userLocationProvider).point, isNull);
      expect(
        container.read(requestContextBuilderProvider)().userLocation,
        isNull,
      );
    },
  );

  test('a refusal is reported and sends no location', () async {
    final container = containerWith(
      () => Future.error(
        const DeviceLocationException(DeviceLocationFailure.denied),
      ),
    );

    await container.read(userLocationProvider.notifier).enable();

    final state = container.read(userLocationProvider);
    expect(state.status, UserLocationStatus.failed);
    expect(state.failure, DeviceLocationFailure.denied);
    expect(state.point, isNull);
    expect(
      container.read(requestContextBuilderProvider)().userLocation,
      isNull,
    );
  });

  test('switching off while locating discards the late answer', () async {
    final answer = Completer<AgentLatLng>();
    final container = containerWith(() => answer.future);
    final controller = container.read(userLocationProvider.notifier);

    final pending = controller.enable();
    expect(
      container.read(userLocationProvider).status,
      UserLocationStatus.locating,
    );
    controller.disable();
    answer.complete(here);
    await pending;

    expect(container.read(userLocationProvider).status, UserLocationStatus.off);
    expect(container.read(userLocationProvider).point, isNull);
  });
}
