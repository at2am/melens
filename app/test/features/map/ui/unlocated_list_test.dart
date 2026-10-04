import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/map_providers.dart';
import 'package:melens/features/map/ui/unlocated_list.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../t016_test_support.dart';

UnlocatedQuery _query({
  String requestId = 'list-request',
  UnlocatedScope? scope,
}) => UnlocatedQuery(
  requestId: requestId,
  layers: const [MapLayerId.pedestrian],
  mode: MapQueryMode.current,
  window: TimeWindow(
    from: DateTime.utc(2026, 10, 1, 0, 59),
    to: DateTime.utc(2026, 10, 1, 1),
  ),
  scope:
      scope ??
      const UnlocatedScope.sourceJurisdiction('Approved fixture jurisdiction'),
  pageSize: 1,
);

Future<void> _show(
  WidgetTester tester,
  T016Repository repository,
  Widget child,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        mapRepositoryProvider.overrideWithValue(repository),
        melbourneClockProvider.overrideWithValue(
          MelbourneClock(now: () => DateTime.utc(2026, 10, 1, 1)),
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(body: child),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('explicit scope, unknown total and returned snapshot selection', (
    tester,
  ) async {
    final repository = T016Repository();
    final query = _query();
    UnlocatedSelection? selected;
    await _show(
      tester,
      repository,
      UnlocatedList(query: query, onItemSelected: (value) => selected = value),
    );
    repository.lists.single.result.complete(t016PageFor(query));
    await tester.pump();
    expect(
      find.text('Source jurisdiction: Approved fixture jurisdiction'),
      findsOneWidget,
    );
    expect(
      find.textContaining('does not establish membership'),
      findsOneWidget,
    );
    expect(find.text('Full matching total unknown'), findsOneWidget);
    expect(find.text('Exact matching total: 1'), findsNothing);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(selected!.item.geometry, isNull);
    expect(selected!.context.snapshotId, 'list-snapshot');
    expect(selected!.dataMode, MapDataMode.sample);
    selected = null;
    await tester.tap(find.text('Sample unlocated sensor'));
    expect(selected, isNotNull);
  });

  testWidgets(
    'bounded pagination replaces page and carries cursor and snapshot',
    (tester) async {
      final repository = T016Repository();
      final query = _query();
      await _show(
        tester,
        repository,
        UnlocatedList(query: query, onItemSelected: (_) {}),
      );
      repository.lists.single.result.complete(
        t016PageFor(
          query,
          completeness: MapCompleteness.partial,
          nextCursor: 'opaque-next-cursor',
        ),
      );
      await tester.pump();
      expect(find.text('Partial result — more data may exist'), findsOneWidget);
      await tester.tap(find.text('Show next page'));
      await tester.pump();
      final next = repository.lists.last.query;
      expect(next.cursor, 'opaque-next-cursor');
      expect(next.snapshotId, 'list-snapshot');
      expect(next.scope, same(query.scope));
      final second = t016Page().items.single.copyWith(
        id: 'second-unlocated',
        title: 'Second unlocated record',
      );
      repository.lists.last.result.complete(
        t016PageFor(next, items: [second], totalMatching: 2),
      );
      await tester.pump();
      expect(find.text('Second unlocated record'), findsOneWidget);
      expect(find.text('Sample unlocated sensor'), findsNothing);
      expect(find.text('Exact matching total: 2'), findsOneWidget);
      expect(find.text('Show next page'), findsNothing);
    },
  );

  testWidgets(
    'expiry keeps old page until explicit restart and never combines pages',
    (tester) async {
      final repository = T016Repository();
      final query = _query();
      await _show(
        tester,
        repository,
        UnlocatedList(query: query, onItemSelected: (_) {}),
      );
      repository.lists.single.result.complete(
        t016PageFor(
          query,
          completeness: MapCompleteness.partial,
          nextCursor: 'next',
        ),
      );
      await tester.pump();
      await tester.tap(find.text('Show next page'));
      await tester.pump();
      repository.lists.last.result.completeError(
        const MapHttpException(
          statusCode: 410,
          retryable: false,
          code: MapServiceErrorCode.snapshotExpired,
        ),
      );
      await tester.pump();
      expect(repository.lists, hasLength(2));
      expect(find.text('Sample unlocated sensor'), findsOneWidget);
      expect(find.textContaining('list snapshot has expired'), findsOneWidget);
      await tester.ensureVisible(find.text('Restart scoped list'));
      await tester.tap(find.text('Restart scoped list'));
      await tester.pump();
      final restarted = repository.lists.last.query;
      expect(restarted.cursor, isNull);
      expect(restarted.snapshotId, isNull);
      expect(find.text('Sample unlocated sensor'), findsNothing);
      repository.lists.last.result.complete(
        t016PageFor(restarted, snapshotId: 'new-snapshot'),
      );
      await tester.pump();
      expect(find.text('Sample unlocated sensor'), findsOneWidget);
    },
  );

  testWidgets('scope changes cancel old page and ignore its late failure', (
    tester,
  ) async {
    final repository = T016Repository();
    var query = _query();
    await _show(
      tester,
      repository,
      UnlocatedList(query: query, onItemSelected: (_) {}),
    );
    final old = repository.lists.single;
    query = _query(
      requestId: 'changed',
      scope: const UnlocatedScope.areaRefs(['area.real']),
    );
    await _show(
      tester,
      repository,
      UnlocatedList(query: query, onItemSelected: (_) {}),
    );
    expect(old.cancellation!.isCancelled, isTrue);
    old.result.completeError(const MapNetworkException());
    repository.lists.last.result.complete(t016PageFor(query));
    await tester.pump();
    expect(find.text('Associated area references: area.real'), findsOneWidget);
    expect(find.text('Could not retrieve map data'), findsNothing);
  });

  testWidgets('empty page never asserts verified absence or guessed total', (
    tester,
  ) async {
    final repository = T016Repository();
    final query = _query();
    await _show(
      tester,
      repository,
      UnlocatedList(query: query, onItemSelected: (_) {}),
    );
    repository.lists.single.result.complete(
      t016PageFor(
        query,
        items: const [],
        completeness: MapCompleteness.partial,
      ),
    );
    await tester.pump();
    expect(find.text('No records returned on this page'), findsOneWidget);
    expect(find.text('Full matching total unknown'), findsOneWidget);
    expect(
      find.text('No matching data in the covered area and time'),
      findsNothing,
    );
  });

  testWidgets('wrong response scope is rejected without displaying records', (
    tester,
  ) async {
    final repository = T016Repository();
    final query = _query();
    await _show(
      tester,
      repository,
      UnlocatedList(query: query, onItemSelected: (_) {}),
    );
    repository.lists.single.result.complete(
      t016PageFor(
        _query(
          scope: const UnlocatedScope.sourceJurisdiction('Other jurisdiction'),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Could not retrieve map data'), findsOneWidget);
    expect(find.text('Sample unlocated sensor'), findsNothing);
  });

  testWidgets(
    'narrow short list keeps scope and errors scrollable without overflow',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 360);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      final repository = T016Repository();
      final query = _query();
      await _show(
        tester,
        repository,
        UnlocatedList(query: query, onItemSelected: (_) {}),
      );
      repository.lists.single.result.completeError(const MapNetworkException());
      await tester.pump();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Retry map data'));
      await tester.tap(find.text('Retry map data'));
      await tester.pump();
      expect(repository.lists, hasLength(2));
      repository.lists.last.result.complete(t016PageFor(query));
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );
}
