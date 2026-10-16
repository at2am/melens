import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/chat/state/chat_controller.dart';
import 'package:melens/features/chat/state/request_context.dart';
import 'package:melens/features/chat/ui/chat_panel.dart';
import 'package:melens/features/map/state/map_actions.dart';
import 'package:melens/features/plans/data/saved_plan.dart';
import 'package:melens/features/plans/state/plans_providers.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../../support/app_harness.dart';
import '../agent/fake_agent_client.dart';
import 'fake_plans_client.dart';

const _plan = AgentCard(
  id: 'c_t_1_1',
  type: CardType.plan,
  title: 'A quiet evening walk',
  items: [
    CardItem(
      title: 'Fitzroy Gardens',
      source: FeatureCardSource(featureId: 'event:1'),
      time: AgentTimeWindow(from: '2026-10-19T07:00:00Z'),
      gettingThere: 'Start here',
    ),
    CardItem(
      title: 'Treasury Gardens',
      source: LinkCardSource(url: 'https://example.org/treasury'),
      time: AgentTimeWindow(
        from: '2026-10-19T07:30:00Z',
        to: '2026-10-19T08:00:00Z',
      ),
      gettingThere: '10 min walk',
    ),
  ],
);

/// Google's polyline example: three points.
const _route = {
  'polyline': '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  'mode': 'walk',
  'distance_m': 1200,
  'duration_min': 16,
  'waypoints': <Object>[],
};

SavedPlan _saved(
  AgentCard card, {
  String savedAt = '2026-10-17T07:00:00.000Z',
  Map<String, dynamic>? route,
}) => SavedPlan(
  id: card.id,
  sessionId: 's_old',
  turnId: 't_old',
  savedAt: savedAt,
  card: card,
  route: route,
);

Future<ProviderContainer> _showChat(
  WidgetTester tester,
  FakeAgentClient client,
  FakePlansClient plans,
) async {
  final container = ProviderContainer(
    overrides: [
      agentClientProvider.overrideWithValue(client),
      plansClientProvider.overrideWithValue(plans),
      requestContextBuilderProvider.overrideWithValue(
        ({String? openCardId}) => RequestContext(
          viewport: const AgentViewport(
            north: -37.80,
            south: -37.82,
            east: 144.98,
            west: 144.95,
          ),
          zoom: 15,
          layers: const ['event'],
          localTime: '2026-10-10T18:40:00+11:00',
          openCardId: openCardId,
        ),
      ),
      melbourneClockProvider.overrideWithValue(
        MelbourneClock(now: () => DateTime.utc(2026, 10, 10, 7, 40)),
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
        home: const Scaffold(body: SizedBox(width: 400, child: ChatPanel())),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
  return container;
}

/// Sends [text] and answers it with the plan card.
Future<void> _askForPlan(WidgetTester tester, FakeAgentClient client) async {
  await tester.enterText(find.byKey(const ValueKey('chat-input')), 'A walk');
  await tester.tap(find.byKey(const ValueKey('chat-send')));
  await tester.pump();
  await tester.pump();
  client.lastTurn
    ..emit(
      const AgentEvent.card(turnId: 't_1', seq: 0, stepId: 's_1', card: _plan),
    )
    ..emit(
      const AgentEvent.done(
        turnId: 't_1',
        seq: 1,
        stop: StopReason.end,
        usage: fakeFinalUsage,
      ),
    );
  await client.lastTurn.close();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a finished plan card offers Change plan; the next message '
      'asks to change that plan', (tester) async {
    final client = FakeAgentClient();
    final plans = FakePlansClient(cards: {_plan.id: _plan});
    final container = await _showChat(tester, client, plans);
    await _askForPlan(tester, client);

    await tester.ensureVisible(find.byKey(ValueKey('plan-refine-${_plan.id}')));
    await tester.tap(find.byKey(ValueKey('plan-refine-${_plan.id}')));
    await tester.pump();
    expect(find.byKey(const ValueKey('chat-refining')), findsOneWidget);
    expect(find.text('Changing “A quiet evening walk”'), findsOneWidget);
    expect(find.text('What should change?'), findsOneWidget);
    expect(find.text('Stop changing'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      ' Add a café ',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    final request = client.lastTurn.request;
    expect(
      request.input,
      TurnInput.refine(cardId: _plan.id, text: 'Add a café'),
    );
    expect(request.context.openCardId, _plan.id);
    expect(container.read(chatControllerProvider).refining, isNull);
    expect(find.byKey(const ValueKey('chat-refining')), findsNothing);
    expect(find.text('Change to “A quiet evening walk”'), findsOneWidget);
    expect(find.text('Add a café'), findsOneWidget);
    // The running turn's own cards get no buttons until it finishes; the
    // earlier plan keeps its buttons.
    expect(find.text('Change plan'), findsOneWidget);
  });

  testWidgets('a suggested change is sent at once; Stop changing leaves the '
      'mode without sending', (tester) async {
    final client = FakeAgentClient();
    final plans = FakePlansClient(cards: {_plan.id: _plan});
    await _showChat(tester, client, plans);
    await _askForPlan(tester, client);

    await tester.ensureVisible(find.byKey(ValueKey('plan-refine-${_plan.id}')));
    await tester.tap(find.byKey(ValueKey('plan-refine-${_plan.id}')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('chat-refining-cancel')));
    await tester.pump();
    expect(find.byKey(const ValueKey('chat-refining')), findsNothing);
    expect(find.text('Ask about the map…'), findsOneWidget);
    expect(client.turns, hasLength(1));

    await tester.ensureVisible(find.byKey(ValueKey('plan-refine-${_plan.id}')));
    await tester.tap(find.byKey(ValueKey('plan-refine-${_plan.id}')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('chat-refine-suggestion-0')));
    await tester.pump();
    await tester.pump();
    expect(client.turns, hasLength(2));
    expect(
      client.lastTurn.request.input,
      TurnInput.refine(cardId: _plan.id, text: 'Make it shorter'),
    );
  });

  testWidgets('Save plan keeps the card through the service and then says '
      'Saved; the limit is explained', (tester) async {
    final client = FakeAgentClient();
    final plans = FakePlansClient(cards: {_plan.id: _plan});
    final container = await _showChat(tester, client, plans);
    await _askForPlan(tester, client);

    await tester.ensureVisible(find.byKey(ValueKey('plan-save-${_plan.id}')));
    await tester.tap(find.byKey(ValueKey('plan-save-${_plan.id}')));
    await tester.pumpAndSettle();
    expect(plans.calls, contains('save:s_1/${_plan.id}'));
    expect(find.byKey(ValueKey('plan-saved-${_plan.id}')), findsOneWidget);
    expect(container.read(savedPlansProvider).value?.map((plan) => plan.id), [
      _plan.id,
    ]);

    // Removed elsewhere, then the service refuses: thirty plans already.
    await container.read(savedPlansProvider.notifier).remove(_plan.id);
    plans.failure = const AgentHttpException(
      statusCode: 409,
      retryable: false,
      code: AgentErrorCode.conflict,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(ValueKey('plan-save-${_plan.id}')));
    await tester.tap(find.byKey(ValueKey('plan-save-${_plan.id}')));
    await tester.pumpAndSettle();
    expect(
      find.text('You have 30 saved plans. Remove one on the Home tab first.'),
      findsOneWidget,
    );
  });

  testWidgets('saved plans head the feed, coming up first; a plan opens with '
      'its route and can be removed', (tester) async {
    const past = AgentCard(
      id: 'c_t_0_1',
      type: CardType.plan,
      title: 'Last week by the river',
      items: [
        CardItem(
          title: 'Birrarung Marr',
          source: FeatureCardSource(featureId: 'event:2'),
          time: AgentTimeWindow(from: '2026-10-11T07:00:00Z'),
        ),
      ],
    );
    final plans = FakePlansClient(
      stored: [
        // Newest first: the past plan was saved last.
        _saved(past, savedAt: '2026-10-17T09:00:00.000Z'),
        _saved(_plan, route: _route),
      ],
    );
    final container = appContainer(plans: plans);
    await pumpApp(tester, container);

    expect(find.text('Saved plans'), findsOneWidget);
    final upcoming = tester.getTopLeft(
      find.byKey(ValueKey('saved-plan-${_plan.id}')),
    );
    final older = tester.getTopLeft(
      find.byKey(ValueKey('saved-plan-${past.id}')),
    );
    expect(upcoming.dy, lessThan(older.dy));
    expect(find.text('2 stops · Mon 19 Oct, 6:00 pm'), findsOneWidget);
    expect(find.text('Past'), findsOneWidget);

    await tester.tap(find.byKey(ValueKey('saved-plan-${_plan.id}')));
    await tester.pumpAndSettle();
    expect(find.text('Saved plan'), findsOneWidget);
    expect(find.text('Treasury Gardens'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('plan-show-route')));
    await tester.pumpAndSettle();
    expect(container.read(mapActionsControllerProvider).route, isNotNull);

    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ValueKey('saved-plan-${past.id}')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('plan-show-route')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('plan-remove')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('plan-remove-confirm')));
    await tester.pumpAndSettle();
    expect(plans.calls, contains('remove:${past.id}'));
    expect(find.byKey(ValueKey('saved-plan-${past.id}')), findsNothing);
    expect(find.byKey(ValueKey('saved-plan-${_plan.id}')), findsOneWidget);
  });

  testWidgets('without saved plans the feed shows no plans heading', (
    tester,
  ) async {
    final container = appContainer(plans: FakePlansClient());
    await pumpApp(tester, container);
    expect(find.text('Saved plans'), findsNothing);
  });

  test('a saved plan reads back from JSON and is past only once every '
      'timed stop is over', () {
    final plan = SavedPlan.fromJson(_saved(_plan, route: _route).toJson());
    expect(plan.card.items, hasLength(2));
    expect(plan.route?['mode'], 'walk');
    expect(plan.isPastAt(DateTime.utc(2026, 10, 19, 7, 59)), isFalse);
    expect(plan.isPastAt(DateTime.utc(2026, 10, 19, 8, 1)), isTrue);
    const untimed = AgentCard(
      id: 'c_t_2_1',
      type: CardType.plan,
      title: 'Whenever',
      items: [
        CardItem(
          title: 'A',
          source: FeatureCardSource(featureId: 'x:1'),
        ),
      ],
    );
    expect(_saved(untimed).isPastAt(DateTime.utc(2030)), isFalse);
  });

  testWidgets('questions about a plan are answered together and go back as '
      'one answers turn about that plan', (tester) async {
    final client = FakeAgentClient();
    await _showChat(tester, client, FakePlansClient());
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'Plan something fun tonight',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    AgentQuestion question(int n, String text, List<String> options) =>
        AgentQuestion(
          id: 'q_t_1_$n',
          text: text,
          options: options,
          allowFreeText: true,
          planCardId: _plan.id,
        );
    client.lastTurn
      ..emit(
        const AgentEvent.card(
          turnId: 't_1',
          seq: 0,
          stepId: 's_1',
          card: _plan,
        ),
      )
      ..emit(
        AgentEvent.question(
          turnId: 't_1',
          seq: 1,
          stepId: 's_2',
          question: question(1, 'When will you leave?', ['Now', 'In an hour']),
        ),
      )
      ..emit(
        AgentEvent.question(
          turnId: 't_1',
          seq: 2,
          stepId: 's_3',
          question: question(2, 'How long do you have?', [
            '1 hour',
            'All evening',
          ]),
        ),
      )
      ..emit(
        AgentEvent.question(
          turnId: 't_1',
          seq: 3,
          stepId: 's_4',
          question: question(3, 'How will you get there?', ['Walk', 'Drive']),
        ),
      )
      ..emit(
        const AgentEvent.done(
          turnId: 't_1',
          seq: 4,
          stop: StopReason.asked,
          usage: fakeFinalUsage,
        ),
      );
    await client.lastTurn.close();
    await tester.pumpAndSettle();

    expect(
      find.text('A few questions to fit the plan to you. Answer any of them.'),
      findsOneWidget,
    );
    expect(find.text('How will you get there?'), findsOneWidget);
    final send = find.byKey(const ValueKey('chat-questions-send'));
    await tester.ensureVisible(send);
    expect(tester.widget<FilledButton>(send).onPressed, isNull);

    await tester.tap(
      find.byKey(const ValueKey('chat-question-q_t_1_1-In an hour')),
    );
    await tester.tap(find.byKey(const ValueKey('chat-question-q_t_1_3-Walk')));
    // A second pick for the same question replaces the first.
    await tester.tap(find.byKey(const ValueKey('chat-question-q_t_1_3-Drive')));
    await tester.pump();
    await tester.tap(send);
    await tester.pump();
    await tester.pump();

    final request = client.lastTurn.request;
    expect(request.input.toJson(), {
      'kind': 'answers',
      'answers': [
        {'questionId': 'q_t_1_1', 'value': 'In an hour'},
        {'questionId': 'q_t_1_3', 'value': 'Drive'},
      ],
    });
    expect(request.context.openCardId, _plan.id);
    expect(find.text('Answers: In an hour, Drive'), findsOneWidget);
    expect(find.byKey(const ValueKey('chat-questions-send')), findsNothing);
  });

  const parkingAt640 = StopParking(
    checkedAt: '2026-10-10T18:40:00+11:00',
    radiusMetres: 400,
    vacant: 3,
    occupied: 5,
    noData: 0,
    bays: [
      StopParkingBay(
        featureId: 'parking:kerbside:a',
        location: AgentLatLng(lat: -37.8097, lng: 144.9628),
        distanceMetres: 60,
        walkMinutes: 1,
      ),
    ],
    fee: r'$7.10 an hour',
    policyScope: CardParkingPolicyScope.area,
    policyUrl: 'https://www.melbourne.vic.gov.au/parking-fees',
  );
  const driven = AgentCard(
    id: 'c_t_5_1',
    type: CardType.plan,
    title: 'Gallery and jazz by car',
    travelMode: TravelMode.drive,
    items: [
      CardItem(
        title: 'Gallery late opening',
        source: FeatureCardSource(featureId: 'event:1'),
        location: AgentLatLng(lat: -37.8102, lng: 144.9628),
        stopParking: parkingAt640,
      ),
      CardItem(
        title: 'Dessert somewhere',
        source: LinkCardSource(url: 'https://example.org/dessert'),
      ),
      CardItem(
        title: 'Jazz on the lane',
        source: FeatureCardSource(featureId: 'event:2'),
        location: AgentLatLng(lat: -37.8110, lng: 144.9640),
      ),
    ],
  );

  testWidgets('a driven plan shows each stop\'s parking; a saved one reads '
      'a stop\'s parking again on request', (tester) async {
    final plans = FakePlansClient(stored: [_saved(driven)])
      ..parking = const StopParking(
        checkedAt: '2026-10-10T19:15:00+11:00',
        radiusMetres: 800,
        vacant: 1,
        occupied: 9,
        noData: 1,
        bays: [
          StopParkingBay(
            featureId: 'parking:kerbside:b',
            location: AgentLatLng(lat: -37.8091, lng: 144.9628),
            distanceMetres: 120,
            walkMinutes: 2,
          ),
        ],
        fee: r'$7.10 an hour',
        policyScope: CardParkingPolicyScope.area,
      );
    final container = appContainer(plans: plans);
    await pumpApp(tester, container);
    await tester.tap(find.byKey(ValueKey('saved-plan-${driven.id}')));
    await tester.pumpAndSettle();

    expect(find.text('By car'), findsOneWidget);
    expect(find.text('Parking near this stop'), findsOneWidget);
    expect(
      find.text('Nearest free bay 60 m away, about 1 min walk'),
      findsOneWidget,
    );
    expect(find.text('3 free, 5 taken within 400 m'), findsOneWidget);
    expect(find.text('Checked 6:40 pm'), findsOneWidget);
    expect(find.text(r'Fee: $7.10 an hour'), findsOneWidget);
    expect(
      find.text(
        'A free sensor shows no car on the bay, not that parking is allowed '
        'now.',
      ),
      findsOneWidget,
    );
    // A stop with no place cannot read parking; a placed one without a
    // reading yet can.
    expect(find.byKey(const ValueKey('plan-stop-refresh-1')), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('plan-stop-refresh-2')),
        matching: find.text('Find parking here'),
      ),
      findsOneWidget,
    );

    final refresh = find.descendant(
      of: find.byKey(const ValueKey('plan-stop-refresh-0')),
      matching: find.text('Refresh parking'),
    );
    await tester.ensureVisible(refresh);
    await tester.tap(refresh);
    await tester.pumpAndSettle();
    expect(plans.calls, contains('refresh:${driven.id}/0'));
    expect(find.text('Checked 7:15 pm'), findsOneWidget);
    expect(
      find.text('Nearest free bay 120 m away, about 2 min walk'),
      findsOneWidget,
    );
    expect(
      container
          .read(savedPlansProvider)
          .value!
          .single
          .card
          .items
          .first
          .stopParking
          ?.checkedAt,
      '2026-10-10T19:15:00+11:00',
    );

    plans.failure = const AgentNetworkException();
    await tester.tap(refresh);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('plan-stop-refresh-failed-0')),
      findsOneWidget,
    );
    expect(find.text('Checked 7:15 pm'), findsOneWidget, reason: 'kept');
  });
}
