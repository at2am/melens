import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/app/router.dart';
import 'package:melens/features/events/state/event_providers.dart';

import '../../support/app_harness.dart';

Finder key(String name) => find.byKey(ValueKey(name));

/// Taps a control that may sit below the fold of the editor's list.
Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(
    finder,
    200,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pump();
  await tester.tap(finder);
  await tester.pump();
}

/// Publishes "Rooftop jam" as the local user and returns to the event page.
Future<void> publishRooftopJam(WidgetTester tester) async {
  await tester.tap(key('feed-host-event'));
  await tester.pumpAndSettle();
  await tester.enterText(key('event-title'), 'Rooftop jam');
  await tester.enterText(key('event-description'), 'Bring an instrument');
  await tapVisible(tester, key('event-category-music'));
  await tapVisible(tester, key('event-place-Carlton Gardens'));
  await tester.tap(key('event-publish'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('publishing an event opens it, hosted by you', (tester) async {
    final container = appContainer(sampleData: false);
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1500));

    await publishRooftopJam(tester);

    expect(find.text('Rooftop jam'), findsOneWidget);
    expect(find.text('Bring an instrument'), findsOneWidget);
    expect(find.text('Carlton Gardens'), findsOneWidget);
    expect(find.text('You are hosting'), findsOneWidget);
    expect(find.text('1 person going'), findsOneWidget);
    // The host does not join their own event.
    expect(key('event-join'), findsNothing);

    final events = container.read(userEventsProvider).value!;
    expect(events.single.title, 'Rooftop jam');
    // Tomorrow at 6 PM Melbourne time, stored in UTC.
    expect(events.single.startAt, DateTime.utc(2026, 10, 19, 7));
  });

  testWidgets('the editor asks for a title before publishing', (tester) async {
    final container = appContainer(sampleData: false);
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1500));

    await tester.tap(key('feed-host-event'));
    await tester.pumpAndSettle();
    await tester.tap(key('event-publish'));
    await tester.pumpAndSettle();

    expect(find.text('Give your event a title'), findsOneWidget);
    expect(container.read(userEventsProvider).value, isEmpty);
  });

  testWidgets('a published event appears in the feed and on the map', (
    tester,
  ) async {
    final container = appContainer(sampleData: false);
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1500));
    await publishRooftopJam(tester);

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Rooftop jam'), findsOneWidget);
    expect(find.text('Community events'), findsWidgets);

    await tester.tap(find.text('Rooftop jam'));
    await tester.pumpAndSettle();
    expect(find.text('You are hosting'), findsOneWidget);
  });

  testWidgets('a link-only event stays out of the feed', (tester) async {
    final container = appContainer(sampleData: false);
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1500));

    await tester.tap(key('feed-host-event'));
    await tester.pumpAndSettle();
    await tester.enterText(key('event-title'), 'Secret supper');
    // The second segment of the visibility control.
    final control = tester.getRect(key('event-visibility'));
    await tester.tapAt(Offset(control.right - 40, control.center.dy));
    await tester.pump();
    await tester.tap(key('event-publish'));
    await tester.pumpAndSettle();
    expect(find.text('Link only: not on the map or in the feed'), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Secret supper'), findsNothing);
  });

  testWidgets('a guest joins and leaves a sample event', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1500));

    await tester.tap(find.text('Sunset sketching on the river'));
    await tester.pumpAndSettle();
    expect(find.text('3 of 12 going'), findsOneWidget);
    expect(find.text('Hosted by Mia'), findsOneWidget);

    await tester.tap(key('event-join'));
    await tester.pumpAndSettle();
    expect(find.text('4 of 12 going'), findsOneWidget);
    expect(find.text('Leave'), findsOneWidget);

    await tester.tap(key('event-join'));
    await tester.pumpAndSettle();
    expect(find.text('3 of 12 going'), findsOneWidget);
  });

  testWidgets('the host invites with a message to paste and can cancel', (
    tester,
  ) async {
    final container = appContainer(sampleData: false);
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 1500));
    await publishRooftopJam(tester);

    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );

    await tester.tap(key('event-invite'));
    await tester.pumpAndSettle();
    final message = tester.widget<Text>(key('invite-message')).data!;
    expect(message, contains('Join me: Rooftop jam'));
    expect(message, contains('Carlton Gardens'));
    expect(message, contains('Mon 19 Oct, 6:00 pm'));

    await tester.tap(key('invite-copy-message'));
    await tester.pumpAndSettle();
    expect(copied, message);

    await tester.tap(key('event-cancel'));
    await tester.pumpAndSettle();
    await tester.tap(key('event-cancel-confirm'));
    await tester.pumpAndSettle();
    expect(find.text('Cancelled'), findsOneWidget);
    expect(key('event-invite'), findsNothing);
    expect(container.read(routerProvider), isNotNull);
  });
}
