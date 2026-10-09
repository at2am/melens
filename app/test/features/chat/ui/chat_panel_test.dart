import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/chat/state/request_context.dart';
import 'package:melens/features/chat/ui/chat_panel.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../../agent/fake_agent_client.dart';

Future<ProviderContainer> showPanel(
  WidgetTester tester,
  FakeAgentClient client, {
  List<CardItem> tapped = const [],
}) async {
  final container = ProviderContainer(
    overrides: [
      agentClientProvider.overrideWithValue(client),
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
        home: Scaffold(
          body: SizedBox(
            width: 400,
            child: ChatPanel(onCardItemTap: tapped.add),
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
  testWidgets('sending a message streams the answer, cards and usage', (
    tester,
  ) async {
    final client = FakeAgentClient();
    final tapped = <CardItem>[];
    await showPanel(tester, client, tapped: tapped);
    expect(find.textContaining('Ask about what is on the map'), findsOneWidget);
    expect(client.calls, ['list']);

    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'What is here?',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    expect(
      client.lastTurn.request.input,
      const TurnInput.text(text: 'What is here?'),
    );
    expect(find.text('What is here?'), findsOneWidget);
    expect(find.text('Thinking…'), findsOneWidget);
    expect(find.byKey(const ValueKey('chat-stop')), findsOneWidget);

    final turn = client.lastTurn;
    turn.emit(
      const AgentEvent.status(turnId: 't_1', seq: 0, text: 'Searching the map'),
    );
    turn.emit(
      const AgentEvent.text(turnId: 't_1', seq: 1, delta: 'Two things nearby.'),
    );
    turn.emit(const AgentEvent.card(turnId: 't_1', seq: 2, card: fakeCard));
    turn.emit(
      const AgentEvent.uiAction(
        turnId: 't_1',
        seq: 3,
        action: UiActionName.highlightFeatures,
        args: <String, dynamic>{
          'ids': ['event:1'],
          'clear_previous': true,
          'missing': <String>[],
        },
      ),
    );
    turn.emit(
      const AgentEvent.done(
        turnId: 't_1',
        seq: 4,
        stop: StopReason.end,
        usage: fakeFinalUsage,
      ),
    );
    await turn.close();
    await tester.pump();
    await tester.pump();

    expect(find.text('Searching the map'), findsOneWidget);
    expect(find.text('Two things nearby.'), findsOneWidget);
    expect(find.text('Tonight near Flinders Street'), findsOneWidget);
    expect(find.text('Market night'), findsOneWidget);
    expect(find.text('Place details from Google Maps'), findsOneWidget);
    expect(find.text('Highlight features · applied'), findsOneWidget);
    expect(
      find.textContaining('2 calls · 1,200 in (400 cached)'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('chat-send')), findsOneWidget);

    await tester.tap(find.text('Market night'));
    expect(tapped.single.title, 'Market night');
  });

  testWidgets('a question shows options and tapping one answers it', (
    tester,
  ) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'Take me to the gardens',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();

    final turn = client.lastTurn;
    turn.emit(
      const AgentEvent.question(
        turnId: 't_1',
        seq: 0,
        question: AgentQuestion(
          id: 'q_1',
          text: 'Which gardens?',
          options: ['Fitzroy Gardens', 'Carlton Gardens'],
          allowFreeText: true,
        ),
      ),
    );
    turn.emit(
      const AgentEvent.done(
        turnId: 't_1',
        seq: 1,
        stop: StopReason.asked,
        usage: fakeFinalUsage,
      ),
    );
    await turn.close();
    await tester.pump();
    await tester.pump();
    expect(find.text('Which gardens?'), findsOneWidget);
    expect(find.text('Or type your own answer below.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-option-Carlton Gardens')));
    await tester.pump();
    await tester.pump();

    expect(
      client.lastTurn.request.input,
      const TurnInput.answer(questionId: 'q_1', value: 'Carlton Gardens'),
    );
    expect(find.text('Answer: Carlton Gardens'), findsOneWidget);
    // The options are gone once answered.
    expect(
      find.byKey(const ValueKey('chat-option-Carlton Gardens')),
      findsNothing,
    );
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('stop cancels the turn and retry sends it again', (tester) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    await tester.enterText(find.byKey(const ValueKey('chat-input')), 'Hi');
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();

    await tester.tap(find.byKey(const ValueKey('chat-stop')));
    await tester.pump();
    await tester.pump();
    expect(client.lastTurn.aborted, isTrue);
    expect(find.text('Stopped.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-retry')));
    await tester.pump();
    await tester.pump();
    expect(client.turns.length, 2);
    expect(client.lastTurn.request.input, const TurnInput.text(text: 'Hi'));
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('a missing token is explained in the panel', (tester) async {
    final client = FakeAgentClient()..listError = const AgentSignInException();
    await showPanel(tester, client);

    expect(find.byKey(const ValueKey('chat-error')), findsOneWidget);
    expect(find.textContaining('AGENT_DEV_TOKEN'), findsOneWidget);
  });
}
