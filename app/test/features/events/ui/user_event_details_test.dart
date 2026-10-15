import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/user_event_models.dart';
import 'package:melens/features/events/state/user_events_providers.dart';
import 'package:melens/features/events/ui/user_event_details.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../fake_user_events_client.dart';

Future<ProviderContainer> showDetails(
  WidgetTester tester,
  FakeUserEventsClient client,
  String eventId, {
  List<AgentLatLng>? shown,
  List<UserEvent>? edited,
  VoidCallback? onBack,
}) async {
  // Tall enough for the organiser's actions and the members list.
  tester.view.physicalSize = const Size(800, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final container = ProviderContainer(
    // No automatic retry: a failed load stays failed, with no pending timer.
    retry: (retryCount, error) => null,
    overrides: [
      userEventsClientProvider.overrideWithValue(client),
      userEventSearchBoundsProvider.overrideWith((ref) => null),
      melbourneClockProvider.overrideWithValue(
        MelbourneClock(now: () => fakeNow),
      ),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(
          body: SizedBox(
            width: 400,
            child: UserEventDetails(
              eventId: eventId,
              onBack: onBack ?? () {},
              onEdit: (event) => edited?.add(event),
              onShowOnMap: (point) => shown?.add(point),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
  return container;
}

void main() {
  testWidgets('a visitor sees the event and joins with a name', (tester) async {
    final client = FakeUserEventsClient([
      fakeEvent(
        'ue_1',
        capacity: 20,
        attendeeCount: 3,
        endAt: DateTime.utc(2026, 10, 12, 8),
      ),
    ]);
    final shown = <AgentLatLng>[];
    final container = await showDetails(tester, client, 'ue_1', shown: shown);
    expect(find.text('Sunset run along the Yarra'), findsOneWidget);
    expect(find.text('Mon 12 Oct, 6:00 PM to 7:00 PM'), findsOneWidget);
    expect(find.text('Boathouse Drive steps'), findsOneWidget);
    expect(find.text('3 of 20 going'), findsOneWidget);
    expect(find.byKey(const ValueKey('event-details-edit')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('event-details-show-on-map')));
    expect(shown.single.lat, -37.8136);

    await tester.enterText(
      find.byKey(const ValueKey('event-details-name')),
      'Sam',
    );
    await tester.tap(find.byKey(const ValueKey('event-details-join')));
    await tester.pump();
    await tester.pump();
    expect(client.lastDisplayName, 'Sam');
    expect(find.byKey(const ValueKey('event-details-going')), findsOneWidget);
    expect(find.text('4 of 20 going'), findsOneWidget);
    expect(find.byKey(const ValueKey('event-details-leave')), findsOneWidget);
    expect(container.read(userEventDisplayNameProvider), 'Sam');

    await tester.tap(find.byKey(const ValueKey('event-details-leave')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const ValueKey('event-details-join')), findsOneWidget);
    expect(find.text('3 of 20 going'), findsOneWidget);
  });

  testWidgets('a refused join explains why and keeps the event', (
    tester,
  ) async {
    final client = FakeUserEventsClient([fakeEvent('ue_1')]);
    await showDetails(tester, client, 'ue_1');
    client
      ..failOn = 'join'
      ..failure = conflict('eventFull');
    await tester.tap(find.byKey(const ValueKey('event-details-join')));
    await tester.pump();
    await tester.pump();
    expect(find.text('This event is full.'), findsOneWidget);
    expect(find.text('Sunset run along the Yarra'), findsOneWidget);
  });

  testWidgets('a cancelled event cannot be joined', (tester) async {
    final client = FakeUserEventsClient([
      fakeEvent('ue_c', status: UserEventStatus.cancelled),
    ]);
    await showDetails(tester, client, 'ue_c');
    expect(
      find.byKey(const ValueKey('event-details-cancelled')),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('event-details-join')),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('a full event cannot be joined', (tester) async {
    final client = FakeUserEventsClient([
      fakeEvent('ue_f', capacity: 2, attendeeCount: 2),
    ]);
    await showDetails(tester, client, 'ue_f');
    expect(find.text('Full'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('event-details-join')),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('the owner manages the event and its named members', (
    tester,
  ) async {
    final client = FakeUserEventsClient([
      fakeEvent('ue_1', isOwner: true, attendeeCount: 2),
    ]);
    client.memberLists['ue_1'] = [
      UserEventMember(memberId: 'm_1', displayName: 'Sam', joinedAt: fakeNow),
      UserEventMember(memberId: 'm_2', displayName: null, joinedAt: fakeNow),
    ];
    final edited = <UserEvent>[];
    var backs = 0;
    await showDetails(
      tester,
      client,
      'ue_1',
      edited: edited,
      onBack: () => backs++,
    );
    expect(find.byKey(const ValueKey('event-details-join')), findsNothing);
    expect(find.text('Yours'), findsOneWidget);
    expect(find.text('2 members'), findsOneWidget);
    expect(find.text('Sam'), findsOneWidget);
    expect(find.text('Guest'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('event-member-remove-m_1')));
    await tester.pump();
    await tester.pump();
    expect(find.text('Sam'), findsNothing);
    expect(find.text('1 member'), findsOneWidget);
    expect(client.calls, contains('removeMember ue_1 m_1'));

    await tester.tap(find.byKey(const ValueKey('event-details-edit')));
    expect(edited.single.id, 'ue_1');

    await tester.tap(find.byKey(const ValueKey('event-details-cancel')));
    await tester.pumpAndSettle();
    expect(find.text('Cancel this event?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('event-confirm')));
    await tester.pumpAndSettle();
    expect(client.calls, contains('cancel ue_1'));
    expect(
      find.byKey(const ValueKey('event-details-cancelled')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('event-details-edit')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('event-details-remove')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('event-confirm')));
    await tester.pumpAndSettle();
    expect(client.calls, contains('remove ue_1'));
    expect(backs, 1);
  });

  testWidgets('an anonymous event shows the owner only the count', (
    tester,
  ) async {
    final client = FakeUserEventsClient([
      fakeEvent(
        'ue_1',
        isOwner: true,
        anonymousAttendance: true,
        attendeeCount: 5,
      ),
    ]);
    await showDetails(tester, client, 'ue_1');
    expect(find.text('Anonymous attendance'), findsOneWidget);
    expect(find.text('5 members'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('event-members-anonymous')),
      findsOneWidget,
    );
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('a missing event reports it and offers a retry', (tester) async {
    final client = FakeUserEventsClient();
    await showDetails(tester, client, 'ue_missing');
    expect(
      find.text('Could not load events. This event no longer exists.'),
      findsOneWidget,
    );
    expect(find.text('Try again'), findsOneWidget);
  });
}
