import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/agent/state/agent_providers.dart';
import 'package:melens/features/chat/data/chat_photos.dart';
import 'package:melens/features/chat/state/chat_photo_providers.dart';
import 'package:melens/features/chat/state/request_context.dart';
import 'package:melens/features/chat/ui/chat_panel.dart';
import 'package:melens/features/chat/ui/chat_photo_view.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../../agent/fake_agent_client.dart';

/// A one-pixel PNG.
final onePixelPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA'
  '60e6kgAAAABJRU5ErkJggg==',
);

final class FakePhotoPicker implements PhotoPicker {
  FakePhotoPicker(this.result);

  final PhotoPick result;
  final sources = <PhotoSource>[];

  @override
  Future<PhotoPick> pick(PhotoSource source, {required int limit}) async {
    sources.add(source);
    return (
      photos: result.photos.take(limit).toList(),
      rejected: result.rejected,
    );
  }
}

Future<ProviderContainer> showPanel(
  WidgetTester tester,
  FakeAgentClient client, {
  List<CardItem> tapped = const [],
  PhotoPicker? picker,
  DateTime Function()? now,
}) async {
  final container = ProviderContainer(
    overrides: [
      agentClientProvider.overrideWithValue(client),
      if (picker != null) photoPickerProvider.overrideWithValue(picker),
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
        MelbourneClock(now: now ?? () => DateTime.utc(2026, 10, 10, 7, 40)),
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
    // A running step replaces the Thinking line with its own spinner.
    turn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 0,
        stepId: 's_1',
        state: AgentStepState.running,
        tool: 'search_features',
        text: 'Searching the map',
        detail: 'events · within 500 m',
      ),
    );
    await tester.pump();
    expect(find.text('Thinking…'), findsNothing);
    expect(
      find.text('Searching the map · events · within 500 m'),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('chat-step-1-s_1')),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsOneWidget,
    );
    turn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 1,
        stepId: 's_1',
        state: AgentStepState.done,
        tool: 'search_features',
        text: 'Searching the map',
        detail: 'events · within 500 m',
        rows: 2,
        durationMs: 1800,
      ),
    );
    await tester.pump();
    // Between steps the Thinking line is back; the finished step shows its
    // rows and duration.
    expect(find.text('Thinking…'), findsOneWidget);
    expect(find.text('2 results · 1.8 s'), findsOneWidget);
    turn.emit(
      const AgentEvent.text(turnId: 't_1', seq: 2, delta: 'Two things nearby.'),
    );
    await tester.pump();
    expect(find.text('Writing…'), findsOneWidget);
    turn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 3,
        stepId: 's_2',
        state: AgentStepState.running,
        tool: 'show_card',
        text: 'Preparing a card',
      ),
    );
    turn.emit(
      const AgentEvent.card(
        turnId: 't_1',
        seq: 4,
        stepId: 's_2',
        card: fakeCard,
      ),
    );
    turn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 5,
        stepId: 's_2',
        state: AgentStepState.done,
        tool: 'show_card',
        text: 'Preparing a card',
        durationMs: 3,
      ),
    );
    turn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 6,
        stepId: 's_3',
        state: AgentStepState.running,
        tool: 'highlight_features',
        text: 'Highlighting features',
      ),
    );
    turn.emit(
      const AgentEvent.uiAction(
        turnId: 't_1',
        seq: 7,
        stepId: 's_3',
        action: UiActionName.highlightFeatures,
        args: <String, dynamic>{
          'ids': ['event:1'],
          'clear_previous': true,
          'missing': <String>[],
        },
      ),
    );
    turn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 8,
        stepId: 's_3',
        state: AgentStepState.done,
        tool: 'highlight_features',
        text: 'Highlighting features',
      ),
    );
    turn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 9,
        stepId: 's_4',
        state: AgentStepState.failed,
        tool: 'get_feature',
        text: 'Reading the details',
        error: 'not_found',
        durationMs: 0,
      ),
    );
    turn.emit(
      const AgentEvent.done(
        turnId: 't_1',
        seq: 10,
        stop: StopReason.end,
        usage: fakeFinalUsage,
      ),
    );
    await turn.close();
    await tester.pump();
    await tester.pump();

    expect(find.text('Thinking…'), findsNothing);
    expect(find.text('Writing…'), findsNothing);
    expect(
      find.text('Searching the map · events · within 500 m'),
      findsOneWidget,
    );
    expect(find.text('Two things nearby.'), findsOneWidget);
    expect(find.text('Preparing a card'), findsOneWidget);
    expect(find.text('3 ms'), findsOneWidget);
    expect(find.text('Tonight near Flinders Street'), findsOneWidget);
    expect(find.text('Market night'), findsOneWidget);
    expect(find.text('Place details from Google Maps'), findsOneWidget);
    // The UI action's outcome sits on its step; no separate chip.
    expect(find.text('Highlighting features'), findsOneWidget);
    expect(find.text('applied'), findsOneWidget);
    expect(find.byType(Chip), findsNothing);
    expect(find.text('Reading the details'), findsOneWidget);
    expect(find.text('not found · 0 ms'), findsOneWidget);
    expect(
      find.textContaining('2 calls · ↑ 1,200 (400 cached) · ↓ 80'),
      findsOneWidget,
    );
    for (final index in [0, 1]) {
      final item = find.byKey(ValueKey('agent-card-item-c_1-$index'));
      final tile = tester.widget<Material>(
        find.descendant(of: item, matching: find.byType(Material)).first,
      );
      expect(
        (tile.shape! as RoundedRectangleBorder).side.style,
        BorderStyle.solid,
        reason: 'each item is an outlined tile of its own',
      );
      expect(
        find.descendant(of: item, matching: find.byIcon(Icons.chevron_right)),
        findsOneWidget,
      );
    }
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
        stepId: 's_1',
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
    expect(client.calls, contains('cancel:s_1'));
    expect(find.text('Stopped.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-retry')));
    await tester.pump();
    await tester.pump();
    expect(client.turns.length, 2);
    expect(client.lastTurn.request.input, const TurnInput.text(text: 'Hi'));
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('a message sent while a turn runs interrupts it', (tester) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'Live music tonight?',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    final first = client.lastTurn;
    expect(find.byKey(const ValueKey('chat-stop')), findsOneWidget);
    expect(find.text('Type to interrupt with a new message…'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'Cafés instead',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    expect(first.aborted, isTrue);
    expect(client.turns.length, 2);
    expect(
      client.lastTurn.request.input,
      const TurnInput.text(text: 'Cafés instead'),
    );
    expect(find.text('Stopped.'), findsOneWidget);
    expect(find.text('Cafés instead'), findsOneWidget);
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('photos are attached, can be removed, and go with the message', (
    tester,
  ) async {
    final client = FakeAgentClient();
    final picker = FakePhotoPicker((
      photos: [ChatPhoto(mimeType: 'image/png', bytes: onePixelPng)],
      rejected: 1,
    ));
    await showPanel(tester, client, picker: picker);

    Future<void> attach() async {
      await tester.tap(find.byKey(const ValueKey('chat-attach')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose photos'));
      await tester.pumpAndSettle();
    }

    await attach();
    expect(picker.sources, [PhotoSource.gallery]);
    expect(find.byKey(const ValueKey('chat-pending-photos')), findsOneWidget);
    expect(
      find.text('One photo could not be used: it is unreadable or too large.'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('chat-photo-remove-0')));
    await tester.pump();
    expect(find.byKey(const ValueKey('chat-pending-photos')), findsNothing);

    await attach();
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    final request = client.lastTurn.request;
    expect(request.input, const TurnInput.text(text: ''));
    expect(request.attachments!.single.mimeType, 'image/png');
    expect(request.attachments!.single.data, base64Encode(onePixelPng));
    expect(find.byKey(const ValueKey('chat-pending-photos')), findsNothing);
    expect(find.byType(ChatPhotoView), findsOneWidget, reason: 'in the turn');
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('a missing token is explained in the panel', (tester) async {
    final client = FakeAgentClient()..listError = const AgentSignInException();
    await showPanel(tester, client);

    expect(find.byKey(const ValueKey('chat-error')), findsOneWidget);
    expect(find.textContaining('AGENT_DEV_TOKEN'), findsOneWidget);
  });

  testWidgets('recreating the panel keeps draft text and unsent photos', (
    tester,
  ) async {
    final client = FakeAgentClient();
    final picker = FakePhotoPicker((
      photos: [ChatPhoto(mimeType: 'image/png', bytes: onePixelPng)],
      rejected: 0,
    ));
    await showPanel(tester, client, picker: picker);
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'What is in this photo?',
    );
    await tester.tap(find.byKey(const ValueKey('chat-attach')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose photos'));
    await tester.pumpAndSettle();
    final app = tester.widget<UncontrolledProviderScope>(
      find.byType(UncontrolledProviderScope),
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(app);
    await tester.pumpAndSettle();
    expect(find.text('What is in this photo?'), findsOneWidget);
    expect(find.byKey(const ValueKey('chat-pending-photos')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    expect(
      client.lastTurn.request.input,
      const TurnInput.text(text: 'What is in this photo?'),
    );
    expect(
      client.lastTurn.request.attachments!.single.data,
      base64Encode(onePixelPng),
    );
    expect(find.byKey(const ValueKey('chat-pending-photos')), findsNothing);
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('a failed sign-in is explained in the panel', (tester) async {
    final client = FakeAgentClient()
      ..listError = const AgentSignInFailedException();
    await showPanel(tester, client);

    expect(find.byKey(const ValueKey('chat-error')), findsOneWidget);
    expect(find.textContaining('Could not sign in'), findsOneWidget);
  });

  testWidgets('an empty conversation offers first messages for the time of '
      'day, and one sends at a tap', (tester) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    expect(find.text('Try asking'), findsOneWidget);
    // 18:40 in Melbourne: the evening.
    expect(find.text('Plan my evening'), findsOneWidget);
    expect(find.text('Find parking nearby'), findsOneWidget);

    await tester.tap(find.text('Plan my evening'));
    await tester.pump();
    await tester.pump();
    expect(
      client.lastTurn.request.input,
      const TurnInput.text(text: 'Plan my evening'),
    );
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('an answer in Markdown shows bold text and a list, without the '
      'marks', (tester) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    await tester.enterText(find.byKey(const ValueKey('chat-input')), 'Trams?');
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    client.lastTurn
      ..emit(
        const AgentEvent.text(
          turnId: 't_1',
          seq: 0,
          delta: 'The **Free Tram Zone** runs:\n- every day\n- until late',
        ),
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

    final rich = tester
        .widgetList<SelectableText>(find.byType(SelectableText))
        .map((text) => text.textSpan?.toPlainText() ?? text.data)
        .toList();
    expect(rich, contains('The Free Tram Zone runs:'));
    expect(rich, containsAll(['every day', 'until late']));
    expect(rich.any((text) => text?.contains('**') ?? false), isFalse);
    expect(find.text('•'), findsNWidgets(2));
  });

  testWidgets('a question that takes free text can be answered in the '
      "user's own words; skipped ones go as no preference", (tester) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'Plan my evening',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    AgentQuestion question(int index, String text) => AgentQuestion(
      id: 'q_$index',
      text: text,
      options: const ['Now', 'Later'],
      allowFreeText: true,
      forPlan: true,
    );
    client.lastTurn
      ..emit(
        AgentEvent.question(
          turnId: 't_1',
          seq: 0,
          stepId: 's_1',
          question: question(1, 'When will you leave?'),
        ),
      )
      ..emit(
        AgentEvent.question(
          turnId: 't_1',
          seq: 1,
          stepId: 's_2',
          question: question(2, 'How long do you have?'),
        ),
      )
      ..emit(
        const AgentEvent.done(
          turnId: 't_1',
          seq: 2,
          stop: StopReason.asked,
          usage: fakeFinalUsage,
        ),
      );
    await client.lastTurn.close();
    await tester.pumpAndSettle();

    final other = find.byKey(const ValueKey('chat-question-q_1-other'));
    await Scrollable.ensureVisible(tester.element(other), alignment: 0.5);
    await tester.pump();
    await tester.tap(other);
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey('chat-question-q_1-text')),
      'After 9 pm',
    );
    await tester.pump();
    final send = find.byKey(const ValueKey('chat-questions-send'));
    await Scrollable.ensureVisible(tester.element(send), alignment: 0.5);
    await tester.pump();
    await tester.tap(send);
    await tester.pump();
    await tester.pump();

    expect(client.lastTurn.request.input.toJson(), {
      'kind': 'answers',
      'answers': [
        {'questionId': 'q_1', 'value': 'After 9 pm'},
        {'questionId': 'q_2', 'value': 'No preference'},
      ],
    });
    await client.lastTurn.close();
    await tester.pump();
  });

  testWidgets('a slow step shows how long it has run and that its source can '
      'take a while', (tester) async {
    var now = DateTime.utc(2026, 10, 10, 7, 40);
    final client = FakeAgentClient();
    await showPanel(tester, client, now: () => now);
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'Is the library worth it?',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    client.lastTurn.emit(
      const AgentEvent.status(
        turnId: 't_1',
        seq: 0,
        stepId: 's_1',
        state: AgentStepState.running,
        tool: 'search_grounding',
        text: 'Searching Google',
      ),
    );
    await tester.pump();
    expect(find.text('This source can take up to a minute.'), findsNothing);

    now = now.add(const Duration(seconds: 20));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('20 s'), findsOneWidget);
    expect(find.text('This source can take up to a minute.'), findsOneWidget);
    await client.lastTurn.close();
    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets('the map changes of the last answer can be undone', (
    tester,
  ) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'Highlight the market',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    client.lastTurn
      ..emit(
        const AgentEvent.uiAction(
          turnId: 't_1',
          seq: 0,
          stepId: 's_1',
          action: UiActionName.highlightFeatures,
          args: <String, dynamic>{
            'ids': ['event:1'],
          },
        ),
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

    final undo = find.text('Undo map changes');
    expect(undo, findsOneWidget);
    await tester.tap(undo);
    await tester.pump();
    expect(find.text('Map changes undone'), findsOneWidget);
    expect(undo, findsNothing);
  });

  testWidgets('a long answer that arrives at once is revealed over a moment', (
    tester,
  ) async {
    final client = FakeAgentClient();
    await showPanel(tester, client);
    await tester.enterText(find.byKey(const ValueKey('chat-input')), 'Tell me');
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    final long = List.filled(40, 'word').join(' ');
    client.lastTurn.emit(AgentEvent.text(turnId: 't_1', seq: 0, delta: long));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    String shown() =>
        tester.widget<SelectableText>(find.byType(SelectableText).last).data!;
    expect(shown().length, inExclusiveRange(0, long.length));

    await tester.pump(const Duration(seconds: 1));
    expect(shown(), long);
    client.lastTurn.emit(
      const AgentEvent.done(
        turnId: 't_1',
        seq: 1,
        stop: StopReason.end,
        usage: fakeFinalUsage,
      ),
    );
    await client.lastTurn.close();
    await tester.pump();
  });
}
