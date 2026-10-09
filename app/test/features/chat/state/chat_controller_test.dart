import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/chat/state/chat_controller.dart';
import 'package:melens/features/chat/state/chat_models.dart';
import 'package:melens/features/chat/state/request_context.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/state/map_actions.dart';

import '../../agent/fake_agent_client.dart';

const fixedViewport = AgentViewport(
  north: -37.80,
  south: -37.82,
  east: 144.98,
  west: 144.95,
);

ProviderContainer makeContainer(FakeAgentClient client) =>
    ProviderContainer.test(
      overrides: [
        agentClientProvider.overrideWithValue(client),
        requestContextBuilderProvider.overrideWithValue(
          ({String? openCardId}) => RequestContext(
            viewport: fixedViewport,
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

ChatState stateOf(ProviderContainer container) =>
    container.read(chatControllerProvider);

void main() {
  test('a text turn creates a session, streams into the turn and applies '
      'UI actions', () async {
    final client = FakeAgentClient();
    final container = makeContainer(client);
    final chat = container.read(chatControllerProvider.notifier);

    final sending = chat.send(const TurnInput.text(text: '  What is here?  '));
    await pumpEventQueue();
    expect(stateOf(container).sessionId, 's_1');
    expect(stateOf(container).isRunning, isTrue);
    final turn = client.lastTurn;
    expect(turn.sessionId, 's_1');
    expect(turn.request.input, const TurnInput.text(text: 'What is here?'));
    expect(turn.request.context.openCardId, isNull);
    expect(turn.request.context.viewport.north, -37.80);

    turn.emit(
      const AgentEvent.status(turnId: 't_1', seq: 0, text: 'Searching the map'),
    );
    turn.emit(const AgentEvent.text(turnId: 't_1', seq: 1, delta: 'Near you '));
    turn.emit(
      const AgentEvent.text(turnId: 't_1', seq: 2, delta: 'there is a market.'),
    );
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
      const AgentEvent.uiAction(
        turnId: 't_1',
        seq: 4,
        action: UiActionName.showLayers,
        args: <String, dynamic>{
          'layers': ['event'],
          'mode': 'only',
        },
      ),
    );
    turn.emit(const AgentEvent.card(turnId: 't_1', seq: 5, card: fakeCard));
    turn.emit(
      const AgentEvent.usage(
        turnId: 't_1',
        seq: 6,
        call: fakeCall,
        turn: fakeUsage,
      ),
    );
    await pumpEventQueue();
    expect(stateOf(container).turns.single.usage?.complete, isNull);
    expect(stateOf(container).turns.single.text, 'Near you there is a market.');

    turn.emit(
      const AgentEvent.done(
        turnId: 't_1',
        seq: 7,
        stop: StopReason.end,
        usage: fakeFinalUsage,
      ),
    );
    await turn.close();
    await sending;
    await pumpEventQueue();

    final state = stateOf(container);
    final finished = state.turns.single;
    expect(finished.phase, ChatTurnPhase.done);
    expect(finished.turnId, 't_1');
    expect(finished.statuses, ['Searching the map']);
    expect(finished.cards.single.id, 'c_1');
    expect(finished.stop, StopReason.end);
    expect(finished.usage?.complete, isTrue);
    expect(finished.usage?.total, 1310);
    expect(finished.actions.map((record) => record.report.outcome), [
      MapActionOutcome.applied,
      MapActionOutcome.applied,
    ]);
    expect(container.read(mapActionsControllerProvider).highlightedIds, [
      'event:1',
    ]);
    expect(container.read(layerControllerProvider).enabledLayers, {
      MapLayerId.event,
    });
    expect(state.isRunning, isFalse);
    expect(client.calls, ['create', 'turn:s_1', 'list']);

    // The next turn reports the open card and reuses the session.
    final next = chat.send(const TurnInput.text(text: 'And then?'));
    await pumpEventQueue();
    expect(client.turns.length, 2);
    expect(client.lastTurn.sessionId, 's_1');
    expect(client.lastTurn.request.context.openCardId, 'c_1');
    await client.lastTurn.close();
    await next;
  });

  test(
    'a question ends the turn and tapping an option sends an answer',
    () async {
      final client = FakeAgentClient();
      final container = makeContainer(client);
      final chat = container.read(chatControllerProvider.notifier);
      const question = AgentQuestion(
        id: 'q_1',
        text: 'Which gardens?',
        options: ['Fitzroy Gardens', 'Carlton Gardens'],
        allowFreeText: true,
      );

      final sending = chat.send(
        const TurnInput.text(text: 'Take me to the gardens'),
      );
      await pumpEventQueue();
      client.lastTurn.emit(
        const AgentEvent.question(turnId: 't_1', seq: 0, question: question),
      );
      client.lastTurn.emit(
        const AgentEvent.done(
          turnId: 't_1',
          seq: 1,
          stop: StopReason.asked,
          usage: fakeFinalUsage,
        ),
      );
      await client.lastTurn.close();
      await sending;
      expect(stateOf(container).pendingQuestion?.id, 'q_1');
      expect(stateOf(container).turns.single.question?.text, 'Which gardens?');

      final answering = chat.answer(question, 'Fitzroy Gardens');
      await pumpEventQueue();
      expect(
        client.lastTurn.request.input,
        const TurnInput.answer(questionId: 'q_1', value: 'Fitzroy Gardens'),
      );
      expect(stateOf(container).pendingQuestion, isNull);
      await client.lastTurn.close();
      await answering;
    },
  );

  test(
    'events of another turn and stale sequence numbers are ignored',
    () async {
      final client = FakeAgentClient();
      final container = makeContainer(client);
      final chat = container.read(chatControllerProvider.notifier);

      final sending = chat.send(const TurnInput.text(text: 'Hi'));
      await pumpEventQueue();
      final turn = client.lastTurn;
      turn.emit(const AgentEvent.text(turnId: 't_1', seq: 0, delta: 'a'));
      turn.emit(const AgentEvent.text(turnId: 't_1', seq: 0, delta: 'dup'));
      turn.emit(const AgentEvent.text(turnId: 't_other', seq: 1, delta: 'x'));
      turn.emit(const AgentEvent.text(turnId: 't_1', seq: 1, delta: 'b'));
      await turn.close();
      await sending;

      final finished = stateOf(container).turns.single;
      expect(finished.text, 'ab');
      // No done event: the turn is reported as cut short.
      expect(finished.phase, ChatTurnPhase.failed);
      expect(finished.error?.kind, ChatErrorKind.streamEnded);
      expect(finished.error?.retryable, isTrue);
    },
  );

  test(
    'a server error fails the turn and retry sends the input again',
    () async {
      final client = FakeAgentClient();
      final container = makeContainer(client);
      final chat = container.read(chatControllerProvider.notifier);

      final sending = chat.send(const TurnInput.text(text: 'Hi'));
      await pumpEventQueue();
      client.lastTurn.emit(
        const AgentEvent.error(
          turnId: 't_1',
          seq: 0,
          message: 'The agent could not finish this turn',
          retryable: true,
          usage: TurnUsage(
            calls: 1,
            input: 5,
            cachedInput: 0,
            output: 0,
            thoughts: 0,
            toolUseInput: 0,
            total: 5,
            complete: false,
          ),
        ),
      );
      await client.lastTurn.close();
      await sending;
      var failed = stateOf(container).turns.single;
      expect(failed.phase, ChatTurnPhase.failed);
      expect(failed.error?.kind, ChatErrorKind.server);
      expect(
        failed.error?.serverMessage,
        'The agent could not finish this turn',
      );
      expect(failed.usage?.complete, isFalse);

      final retrying = chat.retryLast();
      await pumpEventQueue();
      expect(client.turns.length, 2);
      expect(client.lastTurn.request.input, const TurnInput.text(text: 'Hi'));
      expect(stateOf(container).turns.length, 1);
      expect(stateOf(container).isRunning, isTrue);
      await client.lastTurn.close();
      await retrying;
      failed = stateOf(container).turns.single;
      expect(failed.phase, ChatTurnPhase.failed);
    },
  );

  test('a transport failure maps to its error kind', () async {
    final client = FakeAgentClient()
      ..turnError = const AgentHttpException(
        statusCode: 409,
        retryable: true,
        code: AgentErrorCode.turnInProgress,
      );
    final container = makeContainer(client);

    await container
        .read(chatControllerProvider.notifier)
        .send(const TurnInput.text(text: 'Hi'));

    final failed = stateOf(container).turns.single;
    expect(failed.phase, ChatTurnPhase.failed);
    expect(failed.error?.kind, ChatErrorKind.http);
    expect(failed.error?.code, AgentErrorCode.turnInProgress);
    expect(failed.error?.retryable, isTrue);
  });

  test('cancel aborts the request and marks the turn cancelled', () async {
    final client = FakeAgentClient();
    final container = makeContainer(client);
    final chat = container.read(chatControllerProvider.notifier);

    final sending = chat.send(const TurnInput.text(text: 'Hi'));
    await pumpEventQueue();
    client.lastTurn.emit(
      const AgentEvent.text(turnId: 't_1', seq: 0, delta: 'Partial'),
    );
    await pumpEventQueue();
    chat.cancel();
    await pumpEventQueue();
    await sending;

    final cancelled = stateOf(container).turns.single;
    expect(cancelled.phase, ChatTurnPhase.cancelled);
    expect(cancelled.stop, StopReason.cancelled);
    expect(cancelled.text, 'Partial');
    expect(client.lastTurn.aborted, isTrue);
    expect(stateOf(container).canSend, isTrue);
  });

  test(
    'start restores the newest session with its turns and question',
    () async {
      final client = FakeAgentClient();
      client.sessions.addAll([
        fakeSession(
          's_2',
          title: 'Newer',
          turnCount: 1,
          updatedAt: '2026-10-10T08:00:00.000Z',
        ),
        fakeSession('s_1', title: 'Older', turnCount: 3),
      ]);
      const pending = AgentQuestion(
        id: 'q_9',
        text: 'Which one?',
        options: ['A', 'B'],
        allowFreeText: false,
      );
      client.details['s_2'] = SessionDetail(
        session: client.sessions.first,
        pendingQuestion: pending,
        turns: const [
          StoredTurn(
            id: 't_1',
            seq: 1,
            createdAt: fakeStamp,
            input: TurnInput.text(text: 'Newer'),
            text: 'Here is what I found.',
            cards: [fakeCard],
            uiActions: [
              UiAction(
                action: UiActionName.focusMap,
                args: <String, dynamic>{
                  'target': {
                    'point': {'lat': -37.81, 'lng': 144.96},
                  },
                },
              ),
            ],
            question: pending,
            stop: StopReason.asked,
            trace: [
              TraceEntry(
                tool: 'search_features',
                args: <String, dynamic>{},
                status: 'Searching the map',
                rows: 3,
                error: null,
                durationMs: 10,
              ),
              TraceEntry(
                tool: 'show_card',
                args: <String, dynamic>{},
                status: null,
                rows: null,
                error: null,
                durationMs: 1,
              ),
            ],
            usage: fakeFinalUsage,
          ),
        ],
      );
      final container = makeContainer(client);
      final chat = container.read(chatControllerProvider.notifier);

      await chat.start();
      await chat.start();

      final state = stateOf(container);
      expect(state.sessionId, 's_2');
      expect(state.sessionTitle, 'Newer');
      expect(state.sessions.map((session) => session.id), ['s_2', 's_1']);
      expect(state.pendingQuestion?.id, 'q_9');
      final restored = state.turns.single;
      expect(restored.phase, ChatTurnPhase.done);
      expect(restored.text, 'Here is what I found.');
      expect(restored.statuses, ['Searching the map']);
      expect(restored.cards.single.id, 'c_1');
      expect(restored.actions.single.report.outcome, MapActionOutcome.restored);
      expect(restored.usage?.complete, isTrue);
      // Stored actions are history: nothing was applied to the map.
      expect(container.read(mapActionsControllerProvider).focus, isNull);
      expect(client.calls, ['list', 'get:s_2']);
    },
  );

  test('new and delete manage the session list', () async {
    final client = FakeAgentClient();
    final container = makeContainer(client);
    final chat = container.read(chatControllerProvider.notifier);

    await chat.newSession();
    expect(stateOf(container).sessionId, 's_1');
    await chat.newSession();
    expect(stateOf(container).sessionId, 's_2');
    expect(stateOf(container).sessions.map((session) => session.id), [
      's_2',
      's_1',
    ]);

    await chat.deleteSession('s_1');
    expect(stateOf(container).sessionId, 's_2');
    expect(stateOf(container).sessions.map((session) => session.id), ['s_2']);

    await chat.deleteSession('s_2');
    expect(stateOf(container).sessionId, isNull);
    expect(stateOf(container).turns, isEmpty);
    expect(stateOf(container).sessions, isEmpty);
  });

  test('a missing token is reported without creating a turn', () async {
    final client = FakeAgentClient()
      ..createError = const AgentSignInException();
    final container = makeContainer(client);

    await container
        .read(chatControllerProvider.notifier)
        .send(const TurnInput.text(text: 'Hi'));

    expect(stateOf(container).error?.kind, ChatErrorKind.signIn);
    expect(stateOf(container).turns, isEmpty);
    expect(client.turns, isEmpty);
  });

  test(
    'a failed session list is shown once and cleared by reconnect',
    () async {
      final client = FakeAgentClient()
        ..listError = const AgentNetworkException();
      final container = makeContainer(client);
      final chat = container.read(chatControllerProvider.notifier);

      await chat.start();
      expect(stateOf(container).error?.kind, ChatErrorKind.network);

      client.listError = null;
      await chat.reconnect();
      expect(stateOf(container).error, isNull);
    },
  );
}
