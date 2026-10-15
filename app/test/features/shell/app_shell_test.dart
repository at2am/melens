import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/app/router.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/map/state/map_actions.dart';
import 'package:melens/features/map/state/selection_controller.dart';

import '../../support/app_harness.dart';
import '../agent/fake_agent_client.dart';
import '../map/t017_test_support.dart';

/// Ends the turn the fake agent is running, so no spinner keeps animating.
Future<void> finishTurn(FakeAgentClient agent) async {
  final turn = agent.lastTurn;
  turn.emit(
    const AgentEvent.done(
      turnId: 't_1',
      seq: 9,
      stop: StopReason.end,
      usage: fakeFinalUsage,
    ),
  );
  await turn.close();
}

Finder tab(String name) => find.byKey(ValueKey('tab-$name'));

void main() {
  testWidgets('three tabs switch between feed, discover and settings', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    expect(find.text('Melbourne'), findsOneWidget);
    await tester.tap(tab('discover'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('map-layer-chips')), findsOneWidget);

    await tester.tap(tab('settings'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('settings-list')), findsOneWidget);

    await tester.tap(tab('feed'));
    await tester.pumpAndSettle();
    expect(find.text('Melbourne'), findsOneWidget);
  });

  testWidgets('the chat button is on every tab', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    for (final name in ['feed', 'discover', 'settings']) {
      await tester.tap(tab(name));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-fab')), findsOneWidget, reason: name);
    }
  });

  testWidgets('on a phone the chat opens as a sheet and keeps its turns', (
    tester,
  ) async {
    final agent = FakeAgentClient();
    final container = appContainer(agent: agent);
    addTearDown(container.dispose);
    await pumpApp(tester, container);

    await tester.tap(find.byKey(const ValueKey('chat-fab')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('app-chat-panel')), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('chat-input')),
      'What is on tonight?',
    );
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    expect(find.text('What is on tonight?'), findsOneWidget);
    await finishTurn(agent);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('chat-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('app-chat-panel')), findsNothing);

    // Another tab, then back to the chat: the same conversation.
    await tester.tap(tab('settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('chat-fab')));
    await tester.pumpAndSettle();
    expect(find.text('What is on tonight?'), findsOneWidget);
  });

  testWidgets('on a wide screen the chat docks beside the page', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(1440, 900));

    expect(find.byKey(const ValueKey('app-chat-panel')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('chat-fab')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('app-chat-panel')), findsOneWidget);
    // The page stays on screen beside it.
    expect(find.text('Melbourne'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-fab')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('app-chat-panel')), findsNothing);
  });

  testWidgets('a card item tapped in the chat opens on the map', (
    tester,
  ) async {
    final agent = FakeAgentClient();
    final container = appContainer(
      agent: agent,
      mapRepository: T017Repository(autoComplete: true),
    );
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(1440, 900));

    await tester.tap(find.byKey(const ValueKey('chat-fab')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('chat-input')), 'Hi');
    await tester.tap(find.byKey(const ValueKey('chat-send')));
    await tester.pump();
    await tester.pump();
    final turn = agent.lastTurn;
    turn.emit(
      const AgentEvent.card(
        turnId: 't_1',
        seq: 0,
        stepId: 's_1',
        card: AgentCard(
          id: 'c_1',
          type: CardType.list,
          title: 'Around here',
          items: [
            CardItem(
              title: 'Unlocated sensor',
              source: FeatureCardSource(featureId: 'sample.sensor.C'),
            ),
          ],
        ),
      ),
    );
    turn.emit(
      const AgentEvent.done(
        turnId: 't_1',
        seq: 1,
        stop: StopReason.end,
        usage: fakeFinalUsage,
      ),
    );
    await turn.close();
    await tester.pump();
    await tester.pump();

    // The feed is showing; tapping the item moves to the map and selects it.
    expect(find.byKey(const ValueKey('map-layer-chips')), findsNothing);
    await tester.tap(find.text('Unlocated sensor'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('map-layer-chips')), findsOneWidget);
    expect(
      container.read(selectionControllerProvider).selectedItemId,
      'sample.sensor.C',
    );
  });

  testWidgets('an agent that moves the map brings the map forward', (
    tester,
  ) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container);
    expect(find.byKey(const ValueKey('map-layer-chips')), findsNothing);

    container
        .read(mapActionsControllerProvider.notifier)
        .focusPoint(-37.8179, 144.9691);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('map-layer-chips')), findsOneWidget);
    expect(container.read(routerProvider), isNotNull);
  });
}
