import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/app/router.dart';

import 'support/app_harness.dart';

void main() {
  testWidgets('opens on the feed', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(find.text('Melbourne'), findsOneWidget);
    expect(find.byKey(const ValueKey('app-navigation')), findsOneWidget);
  });

  testWidgets('unknown paths show the not-found screen', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);
    container.read(routerProvider).go('/no-such-page');
    await tester.pumpAndSettle();

    expect(find.text('Page not found'), findsOneWidget);

    await tester.tap(find.text('Back to Home'));
    await tester.pumpAndSettle();
    expect(find.text('Melbourne'), findsOneWidget);
  });
}
