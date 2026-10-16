import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/app/app.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/events/data/user_event_models.dart';
import 'package:melens/features/events/state/user_events_providers.dart';
import 'package:melens/features/feed/state/feed_providers.dart';
import 'package:melens/features/location/data/device_location.dart';
import 'package:melens/features/location/state/user_location.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/ui/map_surface.dart';

import '../features/agent/fake_agent_client.dart';
import '../features/events/fake_user_events_client.dart';
import '../features/feed/fake_feeds_cache.dart';
import '../features/feed/fake_feeds_client.dart';
import '../features/map/fake_layer_memory.dart';

/// 18 Oct 2026, 11:00 Melbourne time, a Sunday.
final harnessNow = DateTime.utc(2026, 10, 18);

/// Events the harness's fake service holds: near the city centre, after
/// [harnessNow].
List<UserEvent> harnessEvents() => [
  fakeEvent(
    'ue_sketch',
    title: 'Sunset sketching on the river',
    description: 'Bring a notebook and a pencil.',
    placeName: 'Birrarung Marr',
    startAt: DateTime.utc(2026, 10, 19, 7),
    capacity: 12,
    attendeeCount: 3,
  ),
  fakeEvent(
    'ue_laneway',
    title: 'Laneway acoustic night',
    description: 'Three local players, no stage, one lane.',
    placeName: 'Federation Square',
    startAt: DateTime.utc(2026, 10, 20, 8),
    attendeeCount: 8,
  ),
  fakeEvent(
    'ue_mine',
    title: 'Rooftop jam',
    placeName: 'Carlton Gardens',
    startAt: DateTime.utc(2026, 10, 21, 8),
    isOwner: true,
    joined: true,
    attendeeCount: 1,
  ),
];

/// The whole app on sample data, a fake agent, fake events and feeds
/// services and a fixed clock.
ProviderContainer appContainer({
  FakeAgentClient? agent,
  FakeUserEventsClient? events,
  FakeFeedsClient? feeds,
  FakeFeedsCache? feedsCache,
  FakeLayerMemory? layerMemory,
  MapSurfaceReadiness readiness = MapSurfaceReadiness.missingKey,
  bool sampleData = true,
  MapRepository? mapRepository,
  DeviceLocationReader? deviceLocation,
  List<Override> overrides = const [],
}) => ProviderContainer.test(
  overrides: [
    ...overrides,
    if (deviceLocation != null)
      deviceLocationReaderProvider.overrideWithValue(deviceLocation),
    mapRepositoryProvider.overrideWithValue(
      mapRepository ?? SampleMapRepository(),
    ),
    mapSurfaceReadinessProvider.overrideWith((ref) async => readiness),
    agentClientProvider.overrideWithValue(agent ?? FakeAgentClient()),
    userEventsClientProvider.overrideWithValue(
      events ?? FakeUserEventsClient(harnessEvents()),
    ),
    feedsClientProvider.overrideWithValue(feeds ?? FakeFeedsClient()),
    feedsCacheProvider.overrideWithValue(feedsCache ?? FakeFeedsCache()),
    layerMemoryProvider.overrideWithValue(layerMemory ?? FakeLayerMemory()),
    melbourneClockProvider.overrideWithValue(
      MelbourneClock(now: () => harnessNow),
    ),
    envProvider.overrideWithValue(
      Env(
        environment: AppEnvironment.dev,
        agentBaseUrl: Uri.parse('http://localhost:8080'),
        mapBaseUrl: Uri.parse('http://localhost:8081'),
        mapDataMode: sampleData ? MapDataMode.sample : MapDataMode.live,
      ),
    ),
  ],
);

Future<void> pumpApp(
  WidgetTester tester,
  ProviderContainer container, {
  Size size = const Size(390, 844),

  /// False while a request is held open: a progress indicator never settles.
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    UncontrolledProviderScope(container: container, child: const MelensApp()),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }
}
