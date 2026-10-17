import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/events/state/event_view_providers.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/memory/data/memory_client.dart';
import 'package:melens/features/memory/data/memory_models.dart';
import 'package:melens/features/memory/state/memory_providers.dart';

import '../../support/app_harness.dart';
import 'fake_memory_client.dart';

Finder key(String name) => find.byKey(ValueKey(name));

const _memory = UserMemory(
  enabled: true,
  facts: [
    MemoryFact(
      id: 'm_drive',
      kind: MemoryKind.travel,
      text: 'Drives into the city',
      updatedAt: '2026-10-17T07:00:00.000Z',
    ),
    MemoryFact(
      id: 'm_jazz',
      kind: MemoryKind.interest,
      text: 'Enjoys live jazz',
      updatedAt: '2026-10-17T07:00:00.000Z',
    ),
  ],
  browsing: BrowsingSummary(
    layers: [
      BrowsedLayer(layer: 'parking', share: 0.6),
      BrowsedLayer(layer: 'community', share: 0.3),
    ],
    categories: ['music'],
  ),
  updatedAt: '2026-10-17T07:00:00.000Z',
);

MapItem _event({String? category}) => MapItem.event(
  id: 'event:1',
  versionId: 'v1',
  layerId: MapLayerId.event,
  title: 'Jazz on the lane',
  geometry: null,
  location: const MapLocation(
    precision: MapLocationPrecision.unlocated,
    role: MapLocationRole.eventSite,
    evidence: null,
  ),
  assertionKind: MapAssertionKind.plan,
  lifecycle: MapLifecycle.planned,
  time: const MapItemTime(
    observedAt: null,
    reportedAt: null,
    validFrom: null,
    validTo: null,
    periodLabel: null,
    fetchedAt: null,
    sourceTimeText: null,
    sourceTimezone: null,
  ),
  sources: const [],
  details: EventDetails(
    summary: null,
    venueName: null,
    category: category,
    startAt: null,
    endAt: null,
    status: MapEventStatus.planned,
  ),
);

void main() {
  test('the client decodes the memory and sends the routes it names', () async {
    final sent = <String>[];
    final client = HttpMemoryClient(
      client: MockClient((request) async {
        sent.add('${request.method} ${request.url.path} ${request.body}');
        if (request.method == 'GET') {
          return http.Response(
            jsonEncode({'memory': _memory.toJson()}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.url.path.endsWith('m_gone')) {
          return http.Response(
            jsonEncode({
              'schemaVersion': 1,
              'error': {
                'code': 'notFound',
                'messageKey': 'agent.error.notFound',
                'retryable': false,
              },
            }),
            404,
          );
        }
        return http.Response('', 204);
      }),
      baseUrl: Uri.parse('http://localhost:8080'),
      tokenSource: () async => 'dev',
    );

    final memory = await client.load();
    expect(memory.facts.map((fact) => fact.text), [
      'Drives into the city',
      'Enjoys live jazz',
    ]);
    expect(memory.facts.first.kind, MemoryKind.travel);
    expect(memory.browsing.layers.first.layer, 'parking');

    await client.report(const [
      BrowsingSignal(
        kind: BrowsingAction.open,
        layer: 'event',
        category: 'music',
      ),
      BrowsingSignal(kind: BrowsingAction.show, layer: 'parking'),
    ]);
    await client.forget('m_jazz');
    await client.clear();
    expect(sent.skip(1), [
      'POST /v1/memory/signals {"signals":[{"kind":"open","layer":"event",'
          '"category":"music"},{"kind":"show","layer":"parking"}]}',
      'DELETE /v1/memory/facts/m_jazz ',
      'DELETE /v1/memory ',
    ]);
    await expectLater(
      client.forget('m_gone'),
      throwsA(isA<AgentHttpException>()),
    );
  });

  test('browsing waits for a batch, goes with the event category and is '
      'never kept while memory is off', () async {
    final memory = FakeMemoryClient();
    final container = appContainer(memory: memory);
    addTearDown(container.dispose);
    final tracker = container.read(browsingTrackerProvider.notifier);

    tracker
      ..layerShown('parking')
      ..opened(_event(category: ' Music '))
      ..opened(_event());
    expect(memory.reported, isEmpty);
    expect(
      container.read(browsingTrackerProvider).map((signal) => signal.toJson()),
      [
        {'kind': 'show', 'layer': 'parking'},
        {'kind': 'open', 'layer': 'event', 'category': 'Music'},
        {'kind': 'open', 'layer': 'event'},
      ],
    );
    await tracker.flush();
    expect(memory.reported.single, hasLength(3));
    expect(container.read(browsingTrackerProvider), isEmpty);

    for (var i = 0; i < browsingBatchSize; i++) {
      tracker.layerShown('news');
    }
    await tracker.flush();
    expect(memory.reported.map((batch) => batch.length), [3, 10]);

    memory.failure = Exception('offline');
    tracker.layerShown('news');
    await tracker.flush();
    expect(container.read(browsingTrackerProvider), isEmpty, reason: 'dropped');

    memory.failure = null;
    await container.read(assistantMemoryProvider.future);
    await container
        .read(assistantMemoryProvider.notifier)
        .setEnabled(enabled: false);
    tracker.layerShown('parking');
    expect(container.read(browsingTrackerProvider), isEmpty);
  });

  testWidgets('settings shows what the assistant remembers; one fact or all '
      'of it can be forgotten, and memory switched off', (tester) async {
    final memory = FakeMemoryClient(memory: _memory);
    final container = appContainer(memory: memory);
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(390, 2400));
    await tester.tap(key('tab-settings'));
    await tester.pumpAndSettle();

    expect(find.text('Drives into the city'), findsOneWidget);
    expect(find.text('Enjoys live jazz'), findsOneWidget);
    expect(
      find.text('Parking sensors · Community events · music'),
      findsOneWidget,
    );

    await tester.tap(key('settings-memory-forget-m_jazz'));
    await tester.pumpAndSettle();
    expect(find.text('Enjoys live jazz'), findsNothing);
    expect(memory.calls, contains('forget:m_jazz'));

    await tester.tap(key('settings-memory'));
    await tester.pumpAndSettle();
    expect(memory.calls, contains('setEnabled:false'));
    expect(
      find.text('It neither uses nor adds to what it remembers.'),
      findsOneWidget,
    );

    await tester.tap(key('settings-memory-clear'));
    await tester.pumpAndSettle();
    await tester.tap(key('settings-memory-clear-confirm'));
    await tester.pumpAndSettle();
    expect(memory.calls, contains('clear'));
    expect(find.text('Drives into the city'), findsNothing);
    expect(key('settings-memory-empty'), findsOneWidget);
  });

  testWidgets('turning a layer on from the map counts as browsing; '
      'turning it off does not', (tester) async {
    final container = appContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container, size: const Size(1440, 900));
    await tester.tap(key('tab-discover'));
    await tester.pumpAndSettle();

    // The chip row builds lazily; the community chip comes last.
    await tester.dragUntilVisible(
      key('map-chip-community'),
      key('map-layer-chips'),
      const Offset(-300, 0),
    );
    FilterChip chip() => tester.widget<FilterChip>(
      find.byKey(const ValueKey('map-chip-community'), skipOffstage: false),
    );
    chip().onSelected!(false);
    await tester.pumpAndSettle();
    expect(container.read(browsingTrackerProvider), isEmpty);
    chip().onSelected!(true);
    await tester.pumpAndSettle();
    expect(container.read(communityLayerEnabledProvider), isTrue);
    expect(
      container.read(browsingTrackerProvider).map((signal) => signal.layer),
      ['community'],
    );
  });
}
