import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:melens/app/router.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/events/data/event_invite.dart';
import 'package:melens/features/events/data/user_event_models.dart';
import 'package:melens/features/events/state/event_view_providers.dart';

import '../../support/app_harness.dart';
import 'fake_user_events_client.dart';

Finder key(String name) => find.byKey(ValueKey(name));

void main() {
  group('invites', () {
    setUpAll(() => initializeDateFormatting('en_AU'));

    final clock = MelbourneClock(now: () => harnessNow);

    test('the link points at the event on the app origin', () {
      final event = fakeEvent('ue_1');
      expect(
        eventInviteLink(Uri.parse('https://melens.example'), event),
        Uri.parse('https://melens.example/events/ue_1'),
      );
      expect(eventInviteLink(null, event), isNull);
    });

    test('the message has what, when, where and the link', () {
      final event = fakeEvent(
        'ue_1',
        title: 'Picnic',
        placeName: 'Carlton Gardens',
      );
      final message = eventInviteMessage(
        event: event,
        clock: clock,
        link: Uri.parse('https://melens.example/events/ue_1'),
      );
      expect(message, contains('Join me: Picnic'));
      expect(message, contains('Carlton Gardens'));
      expect(message, endsWith('https://melens.example/events/ue_1'));
    });

    test('without a link the message says where to find the event', () {
      final message = eventInviteMessage(
        event: fakeEvent('ue_1'),
        clock: clock,
      );
      expect(message, contains('Discover tab'));
    });
  });

  testWidgets('an event link opens the event on the Discover tab', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    container.read(routerProvider).go('/events/ue_laneway');
    await tester.pumpAndSettle();

    expect(key('map-layer-chips'), findsOneWidget);
    expect(find.text('Laneway acoustic night'), findsOneWidget);
    expect(key('event-details-when'), findsOneWidget);
    expect(container.read(eventsPanelRequestsProvider), isNull);
  });

  testWidgets('the organiser invites with a message to paste', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

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

    container.read(routerProvider).go('/events/ue_mine');
    await tester.pumpAndSettle();
    await tester.tap(key('event-details-invite'));
    await tester.pumpAndSettle();

    final message = tester.widget<Text>(key('invite-message')).data!;
    expect(message, contains('Join me: Rooftop jam'));
    expect(message, contains('Carlton Gardens'));

    await tester.tap(key('invite-copy-message'));
    await tester.pumpAndSettle();
    expect(copied, message);
  });

  testWidgets('a cancelled event cannot be invited to', (tester) async {
    final events = FakeUserEventsClient([
      fakeEvent(
        'ue_gone',
        title: 'Called off',
        isOwner: true,
        status: UserEventStatus.cancelled,
      ),
    ]);
    final container = appContainer(events: events);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    container.read(routerProvider).go('/events/ue_gone');
    await tester.pumpAndSettle();
    expect(find.text('Called off'), findsWidgets);
    expect(key('event-details-cancelled'), findsOneWidget);
    expect(key('event-details-invite'), findsNothing);
  });
}
