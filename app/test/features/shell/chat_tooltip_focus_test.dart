import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../../support/app_harness.dart';

Finder _key(String value) => find.byKey(ValueKey(value));

List<int> _ancestry(SemanticsNode node) {
  final result = <int>[];
  SemanticsNode? current = node;
  while (current != null) {
    result.add(current.id);
    current = current.parent;
  }
  return result;
}

Future<void> _checkTooltip(
  WidgetTester tester, {
  required Finder input,
  required Finder button,
  required String message,
}) async {
  await tester.tap(input);
  await tester.enterText(input, 'A draft before the tooltip');
  await tester.pumpAndSettle();
  final editable = find.descendant(
    of: input,
    matching: find.byType(EditableText),
  );
  final field = tester.widget<EditableText>(editable);
  expect(field.focusNode.hasFocus, isTrue);
  expect(tester.getSemantics(button).getSemanticsData().tooltip, message);
  final ancestry = _ancestry(tester.getSemantics(input));
  final tooltip = find
      .descendant(of: button, matching: find.byType(Tooltip))
      .first;
  expect(tester.widget<Tooltip>(tooltip).message, message);
  tester.state<TooltipState>(tooltip).ensureTooltipVisible();
  await tester.pumpAndSettle();
  expect(find.text(message), findsOneWidget);
  expect(_ancestry(tester.getSemantics(input)), ancestry);
  expect(field.focusNode.hasFocus, isTrue);
  expect(field.controller.text, 'A draft before the tooltip');
  expect(tester.getSemantics(button).getSemanticsData().tooltip, message);
  Tooltip.dismissAllToolTips();
  await tester.pumpAndSettle();
  expect(find.text(message), findsNothing);
  expect(_ancestry(tester.getSemantics(input)), ancestry);
  expect(field.focusNode.hasFocus, isTrue);
  expect(field.controller.text, 'A draft before the tooltip');
  expect(tester.getSemantics(button).getSemanticsData().tooltip, message);
  await tester.enterText(input, 'A draft before the tooltip and after it');
  expect(field.controller.text, 'A draft before the tooltip and after it');
}

void main() {
  testWidgets(
    'chat input keeps its semantics ancestry while tooltips appear and hide',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        final container = appContainer();
        await pumpApp(tester, container, size: const Size(1440, 1000));
        await tester.tap(_key('chat-fab'));
        await tester.pumpAndSettle();
        await _checkTooltip(
          tester,
          input: _key('chat-input'),
          button: _key('chat-new-session'),
          message: 'New conversation',
        );
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets(
    'Feed name keeps its semantics ancestry while editor tooltips appear and hide',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        final container = appContainer();
        await pumpApp(tester, container, size: const Size(1440, 1000));
        await tester.tap(_key('tab-settings'));
        await tester.pumpAndSettle();
        await tester.tap(_key('settings-feed-default-cbd'));
        await tester.pumpAndSettle();
        await _checkTooltip(
          tester,
          input: _key('feed-name'),
          button: _key('feed-delete'),
          message: 'Delete feed',
        );
      } finally {
        semantics.dispose();
      }
    },
  );
}
