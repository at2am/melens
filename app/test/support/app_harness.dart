import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/app/app.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/ui/map_surface.dart';

import '../features/agent/fake_agent_client.dart';

/// 18 Oct 2026, 11:00 Melbourne time, a Sunday.
final harnessNow = DateTime.utc(2026, 10, 18);

/// The whole app on sample data, a fake agent and a fixed clock.
ProviderContainer appContainer({
  FakeAgentClient? agent,
  MapSurfaceReadiness readiness = MapSurfaceReadiness.missingKey,
  bool sampleData = true,
  MapRepository? mapRepository,
}) => ProviderContainer.test(
  overrides: [
    mapRepositoryProvider.overrideWithValue(
      mapRepository ?? SampleMapRepository(),
    ),
    mapSurfaceReadinessProvider.overrideWith((ref) async => readiness),
    agentClientProvider.overrideWithValue(agent ?? FakeAgentClient()),
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
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    UncontrolledProviderScope(container: container, child: const MelensApp()),
  );
  await tester.pumpAndSettle();
}
