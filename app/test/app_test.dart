import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/app/app.dart';
import 'package:melens/app/router.dart';
import 'package:melens/core/config/env.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/sample_map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/ui/map_surface.dart';

ProviderContainer appContainer() => ProviderContainer.test(
  overrides: [
    mapRepositoryProvider.overrideWithValue(SampleMapRepository()),
    mapSurfaceReadinessProvider.overrideWith(
      (ref) async => MapSurfaceReadiness.missingKey,
    ),
    melbourneClockProvider.overrideWithValue(
      MelbourneClock(now: () => DateTime.utc(2026, 9, 30, 1)),
    ),
    envProvider.overrideWithValue(
      Env(
        environment: AppEnvironment.dev,
        agentBaseUrl: Uri.parse('http://localhost:8080'),
        mapBaseUrl: Uri.parse('http://localhost:8081'),
        mapDataMode: MapDataMode.sample,
      ),
    ),
  ],
);

void main() {
  testWidgets('opens on the map screen', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const MelensApp()),
    );
    await tester.pumpAndSettle();

    expect(find.text('Melens map'), findsOneWidget);
    expect(find.text('Sample data — illustrative only'), findsWidgets);
  });

  testWidgets('unknown paths show the not-found screen', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const MelensApp()),
    );
    container.read(routerProvider).go('/no-such-page');
    await tester.pumpAndSettle();

    expect(find.text('Page not found'), findsOneWidget);

    await tester.tap(find.text('Back to the map'));
    await tester.pumpAndSettle();
    expect(find.text('Melens map'), findsOneWidget);
  });
}
