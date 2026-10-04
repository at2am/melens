import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/ui/map_status.dart';
import 'package:melens/l10n/app_localizations.dart';

Map<String, dynamic> _fixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
) as Map<String, dynamic>;

ViewportResponse _response(String name) =>
    ViewportResponse.fromJson(_fixture(name));

LayerResult _layer({
  MapLayerState state = MapLayerState.available,
  MapFreshness freshness = MapFreshness.current,
  MapCompleteness completeness = MapCompleteness.complete,
  MapCoverageState coverage = MapCoverageState.unknown,
}) => LayerResult(
  layerId: MapLayerId.pedestrian,
  state: state,
  freshness: freshness,
  completeness: completeness,
  sourceIds: const [],
  coverage: MapCoverage(
    state: coverage,
    areaRefs: const [],
    window: null,
    evidenceSourceIds: const [],
  ),
  observedWindow: null,
  updatedAt: null,
  items: const [],
  unresolvedCount: null,
  nextCursor: null,
  totalMatching: null,
);

Future<void> _show(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        melbourneClockProvider.overrideWithValue(
          MelbourneClock(now: () => DateTime.utc(2026, 10, 10, 8, 30)),
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
  await tester.pump();
}

MapLayerStatus _status(
  AsyncValue<LayerResult> result, {
  MapQueryMode mode = MapQueryMode.current,
  MapDataMode dataMode = MapDataMode.sample,
  VoidCallback? onRetry,
}) => MapLayerStatus(
  layerId: MapLayerId.pedestrian,
  result: result,
  mode: mode,
  dataMode: dataMode,
  onRetry: onRetry,
);

Future<AsyncValue<LayerResult>> _retainedState(
  WidgetTester tester,
  LayerResult previous, {
  Object? error,
}) async {
  var request = Completer<LayerResult>()..complete(previous);
  final provider = FutureProvider<LayerResult>((ref) => request.future);
  final container = ProviderContainer(retry: (count, failure) => null);
  final subscription = container.listen(provider, (previous, next) {});
  late final AsyncValue<LayerResult> result;
  try {
    await container.read(provider.future);
    request = Completer<LayerResult>();
    container.invalidate(provider);
    if (error != null) {
      final refreshed = container.read(provider.future);
      request.completeError(error, StackTrace.current);
      await expectLater(refreshed, throwsA(same(error)));
    }
    result = container.read(provider);
  } finally {
    subscription.close();
    container.dispose();
    await tester.pump(const Duration(milliseconds: 1));
  }
  return result;
}

void main() {
  const fixtures = {
    'viewport': 'Data available',
    'no-matching': 'No matching data in the covered area and time',
    'not-covered': 'This area or time is not covered',
    'unavailable': 'Source data unavailable',
    'unknown': 'Coverage or result unknown',
  };
  for (final entry in fixtures.entries) {
    testWidgets('${entry.key} retains its distinct evidence state', (
      tester,
    ) async {
      final response = _response(entry.key);
      await _show(tester, _status(AsyncData(response.layers.single)));
      expect(find.text(entry.value), findsOneWidget);
      expect(find.text('Sample data — illustrative only'), findsOneWidget);
      expect(find.text('Pedestrian counts'), findsOneWidget);
    });
  }

  test('an empty available list does not become a no-matching claim', () {
    expect(layerStateForPresentation(_layer()), MapLayerState.available);
  });

  test('noMatching without complete verified coverage is unknown', () {
    expect(
      layerStateForPresentation(_layer(state: MapLayerState.noMatching)),
      MapLayerState.unknown,
    );
    final valid = _response('no-matching').layers.single;
    expect(layerStateForPresentation(valid), MapLayerState.noMatching);
  });

  testWidgets('loading has a readable status without an empty-data claim', (
    tester,
  ) async {
    await _show(tester, _status(const AsyncLoading()));
    expect(find.text('Loading map data'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(
      find.text('No matching data in the covered area and time'),
      findsNothing,
    );
  });

  testWidgets('refresh keeps original time and distinguishes retained data', (
    tester,
  ) async {
    final previous = _response('viewport').layers.single;
    await _show(tester, _status(await _retainedState(tester, previous)));
    expect(find.text('Refreshing map data'), findsOneWidget);
    expect(find.text('Updated: 1 Oct 2026, 11:00 AEST'), findsOneWidget);
    expect(find.textContaining('10 Oct'), findsNothing);
  });

  testWidgets(
    'refresh errors preserve result time and offer an accessible retry',
    (tester) async {
      var retries = 0;
      final previous = _response('viewport').layers.single;
      final semantics = tester.ensureSemantics();
      try {
        await _show(
          tester,
          _status(
            await _retainedState(
              tester,
              previous,
              error: const MapNetworkException(),
            ),
            onRetry: () => retries++,
          ),
        );
        expect(find.text('Could not retrieve map data'), findsOneWidget);
        expect(
          find.text('Showing the previous result with its original time'),
          findsOneWidget,
        );
        expect(find.text('Updated: 1 Oct 2026, 11:00 AEST'), findsOneWidget);
        expect(find.bySemanticsLabel('Retry map data'), findsOneWidget);
        await tester.tap(find.text('Retry map data'));
        expect(retries, 1);
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets(
    'non-retryable failures do not expose raw errors or retry action',
    (tester) async {
      await _show(
        tester,
        _status(
          AsyncError<LayerResult>(
            const MapContractException(MapContractFailure.invalidJson),
            StackTrace.current,
          ),
          dataMode: MapDataMode.live,
          onRetry: () {},
        ),
      );
      expect(find.text('Could not retrieve map data'), findsOneWidget);
      expect(find.text('Retry map data'), findsNothing);
      expect(find.textContaining('invalidJson'), findsNothing);
      expect(find.text('Sample data — illustrative only'), findsNothing);
    },
  );

  testWidgets(
    'partial results never replace an unknown total with page length',
    (tester) async {
      await _show(
        tester,
        _status(AsyncData(_response('partial').layers.single)),
      );
      expect(find.text('Partial result — more data may exist'), findsOneWidget);
      expect(find.text('Full matching total unknown'), findsOneWidget);
      expect(find.textContaining('Exact matching total:'), findsNothing);
    },
  );

  const freshness = {
    MapFreshness.late: 'Source update is late',
    MapFreshness.stale: 'Source data is stale',
    MapFreshness.versioned: 'Published data version',
    MapFreshness.unknown: 'Source freshness unknown',
  };
  for (final entry in freshness.entries) {
    testWidgets('${entry.key.name} freshness is readable without colour', (
      tester,
    ) async {
      await _show(tester, _status(AsyncData(_layer(freshness: entry.key))));
      expect(find.text(entry.value), findsOneWidget);
      expect(find.text('Update time unknown'), findsOneWidget);
      expect(find.text('Observation window unknown'), findsOneWidget);
    });
  }

  testWidgets('zero passages and missing passages remain distinct', (
    tester,
  ) async {
    await _show(
      tester,
      const Column(
        children: [
          MapMeasuredCount(count: 0),
          MapMeasuredCount(count: null),
          MapMeasuredCount(count: 1234),
        ],
      ),
    );
    expect(find.text('Sensor passages: 0'), findsOneWidget);
    expect(find.text('Passage count unknown'), findsOneWidget);
    expect(find.text('Sensor passages: 1,234'), findsOneWidget);
  });

  testWidgets(
    'provenance retains historical context and Melbourne observation time',
    (tester) async {
      final response = _response('historical');
      final item = response.layers.single.items.first;
      await _show(
        tester,
        MapItemProvenance(
          time: item.time,
          sources: item.sources,
          assertionKind: item.assertionKind,
          mode: MapQueryMode.historical,
          dataMode: MapDataMode.sample,
        ),
      );
      expect(find.text('Historical data'), findsOneWidget);
      expect(find.textContaining('Observed: 30 Sep'), findsOneWidget);
      expect(find.textContaining('10:59 AEST'), findsOneWidget);
      expect(find.text('Source: Illustrative sample data'), findsOneWidget);
      expect(find.text('Source version: sample-v1'), findsOneWidget);
      expect(find.text('Public source link unavailable'), findsOneWidget);
    },
  );

  testWidgets(
    'unknown source clock text stays unconverted and predictions labelled',
    (tester) async {
      await _show(
        tester,
        const MapItemProvenance(
          time: MapItemTime(
            observedAt: null,
            reportedAt: null,
            validFrom: null,
            validTo: null,
            periodLabel: null,
            fetchedAt: null,
            sourceTimeText: '2026-10-01 07:00',
            sourceTimezone: null,
          ),
          sources: [],
          assertionKind: MapAssertionKind.prediction,
          mode: MapQueryMode.current,
          dataMode: MapDataMode.live,
        ),
      );
      expect(find.text('Prediction'), findsOneWidget);
      expect(
        find.text('Source time: 2026-10-01 07:00 (timezone unknown)'),
        findsOneWidget,
      );
      expect(find.text('Observation or report time unknown'), findsOneWidget);
      expect(find.text('Retrieved time unknown'), findsOneWidget);
      expect(find.text('Source unknown'), findsOneWidget);
    },
  );

  testWidgets('statistical periods remain periods in a current view', (
    tester,
  ) async {
    await _show(
      tester,
      const MapItemProvenance(
        time: MapItemTime(
          observedAt: null,
          reportedAt: null,
          validFrom: null,
          validTo: null,
          periodLabel: '2021 Census',
          fetchedAt: null,
          sourceTimeText: null,
          sourceTimezone: null,
        ),
        sources: [],
        assertionKind: MapAssertionKind.observation,
        mode: MapQueryMode.current,
        dataMode: MapDataMode.live,
      ),
    );
    expect(find.text('Statistical period: 2021 Census'), findsOneWidget);
    expect(find.textContaining('Observed:'), findsNothing);
    expect(find.textContaining('2026'), findsNothing);
  });

  testWidgets('source actions carry the public source name and URL', (
    tester,
  ) async {
    Uri? opened;
    await _show(
      tester,
      MapItemProvenance(
        time: MapItemResponse.fromJson(_fixture('item')).item.time,
        sources: const [
          MapSource(
            sourceId: 'official-source',
            url: 'https://example.org/source',
            attribution: 'Official source',
            versionRef: null,
          ),
        ],
        assertionKind: MapAssertionKind.observation,
        mode: MapQueryMode.current,
        dataMode: MapDataMode.live,
        onOpenSource: (uri) => opened = uri,
      ),
    );
    await tester.tap(find.text('Open source: Official source'));
    expect(opened, Uri.parse('https://example.org/source'));
  });
}
