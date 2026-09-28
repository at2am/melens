import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/app/app.dart';
import 'package:melens/app/router.dart';

void main() {
  testWidgets('opens on the map screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: MelensApp()));
    await tester.pumpAndSettle();

    expect(find.text('The map goes here (UC-01).'), findsOneWidget);
  });

  testWidgets('unknown paths show the not-found screen', (tester) async {
    final container = ProviderContainer.test();
    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const MelensApp()),
    );
    container.read(routerProvider).go('/no-such-page');
    await tester.pumpAndSettle();

    expect(find.text('Page not found'), findsOneWidget);

    await tester.tap(find.text('Back to the map'));
    await tester.pumpAndSettle();
    expect(find.text('The map goes here (UC-01).'), findsOneWidget);
  });
}
