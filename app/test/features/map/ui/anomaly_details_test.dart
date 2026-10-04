import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/ui/anomaly_details.dart';
import 'package:melens/features/map/ui/map_details.dart';
import 'package:melens/features/map/ui/map_status.dart';
import 'package:melens/l10n/app_localizations.dart';

Map<String, dynamic> _fixture() {
  final items = jsonDecode(
    File(
      '../specs/002-map-data-presentation/contracts/examples/'
      'item-variants.sample.json',
    ).readAsStringSync(),
  ) as List<dynamic>;
  return items.cast<Map<String, dynamic>>().singleWhere(
    (item) => item['kind'] == 'anomaly',
  );
}

AnomalyMapItem _item({Map<String, Object?> details = const {}}) {
  final json = _fixture();
  (json['details'] as Map<String, dynamic>).addAll(details);
  return MapItem.fromJson(json) as AnomalyMapItem;
}

Future<void> _show(
  WidgetTester tester,
  AnomalyMapItem item, {
  bool provenance = false,
  Widget? content,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [melbourneClockProvider.overrideWithValue(MelbourneClock())],
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(
          body:
              content ??
              SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AnomalyDetailsSection(item: item),
                    if (provenance)
                      MapItemProvenance(
                        time: item.time,
                        sources: item.sources,
                        assertionKind: item.assertionKind,
                        mode: MapQueryMode.historical,
                        dataMode: MapDataMode.sample,
                      ),
                  ],
                ),
              ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'supplied baseline, delta, direction and identifiers stay exact',
    (tester) async {
      await _show(
        tester,
        _item(
          details: {
            'baselineValue': 6.123456789,
            'observedValue': 12.000000001,
            'delta': 3.7654321,
            'direction': 'lower',
          },
        ),
      );
      expect(find.text('Result id: sample.anomaly.A'), findsOneWidget);
      expect(find.text('Observation id: sample.sensor.A'), findsOneWidget);
      expect(
        find.text('Baseline definition id: sample.baseline'),
        findsOneWidget,
      );
      expect(find.text('Baseline value: 6.123456789'), findsOneWidget);
      expect(find.text('Observed value: 12.000000001'), findsOneWidget);
      expect(find.text('Difference from baseline: 3.7654321'), findsOneWidget);
      expect(find.text('Direction: lower than the baseline'), findsOneWidget);
      expect(find.text('Eligibility: eligible'), findsOneWidget);
      expect(find.text('Classification: anomalous'), findsOneWidget);
      expect(
        find.text('A difference from the baseline does not establish a cause.'),
        findsOneWidget,
      );
    },
  );

  testWidgets('source window preserves seconds and microseconds in Melbourne', (
    tester,
  ) async {
    await _show(
      tester,
      _item(
        details: {
          'window': {
            'from': '2026-10-01T00:59:00.123456Z',
            'to': '2026-10-01T01:00:00.000001Z',
          },
        },
      ),
    );
    expect(find.textContaining('10:59:00.123456 AEST'), findsOneWidget);
    expect(find.textContaining('11:00:00.000001 AEST'), findsOneWidget);
    expect(find.textContaining('1 Oct 2026'), findsOneWidget);
  });

  testWidgets(
    'missing baseline and observation remain unknown and unclassified',
    (tester) async {
      await _show(
        tester,
        _item(
          details: {
            'observationId': null,
            'baselineDefinitionId': null,
            'baselineValue': null,
            'observedValue': null,
            'delta': null,
            'direction': 'unknown',
            'eligibility': 'ineligible',
            'classification': 'unclassified',
          },
        ),
      );
      for (final label in [
        'Observation id',
        'Baseline definition id',
        'Baseline value',
        'Observed value',
        'Difference from baseline',
      ]) {
        expect(find.text('$label: Unknown'), findsOneWidget);
      }
      expect(find.text('Direction: unknown'), findsOneWidget);
      expect(find.text('Eligibility: ineligible'), findsOneWidget);
      expect(find.text('Classification: unclassified'), findsOneWidget);
      expect(find.text('Classification: not anomalous'), findsNothing);
    },
  );

  testWidgets(
    'known zero and producer no-change do not become unknown values',
    (tester) async {
      await _show(
        tester,
        _item(
          details: {
            'baselineValue': 0,
            'observedValue': 0,
            'delta': 0,
            'direction': 'none',
            'classification': 'notAnomalous',
          },
        ),
      );
      expect(find.text('Baseline value: 0.0'), findsOneWidget);
      expect(find.text('Observed value: 0.0'), findsOneWidget);
      expect(find.text('Difference from baseline: 0.0'), findsOneWidget);
      expect(
        find.text('Direction: no change from the baseline'),
        findsOneWidget,
      );
      expect(find.text('Classification: not anomalous'), findsOneWidget);
    },
  );

  testWidgets(
    'unknown eligibility is visible independently of classification',
    (tester) async {
      await _show(
        tester,
        _item(
          details: {
            'eligibility': 'unknown',
            'classification': 'unclassified',
            'direction': 'higher',
          },
        ),
      );
      expect(find.text('Eligibility: unknown'), findsOneWidget);
      expect(find.text('Classification: unclassified'), findsOneWidget);
      expect(find.text('Direction: higher than the baseline'), findsOneWidget);
    },
  );

  testWidgets(
    'enclosing provenance preserves sample, replay and source labels',
    (tester) async {
      await _show(tester, _item(), provenance: true);
      expect(find.text('Sample data — illustrative only'), findsOneWidget);
      expect(find.text('Historical data'), findsOneWidget);
      expect(find.text('Source: Illustrative sample data'), findsOneWidget);
      expect(find.text('Source version: sample-v1'), findsOneWidget);
      expect(find.text('Public source link unavailable'), findsOneWidget);
    },
  );

  testWidgets(
    'a directly supplied withdrawn item does not expose result facts',
    (tester) async {
      final json = _fixture()..['lifecycle'] = 'withdrawn';
      await _show(tester, MapItem.fromJson(json) as AnomalyMapItem);
      expect(find.textContaining('has been withdrawn'), findsOneWidget);
      expect(find.byKey(const ValueKey('map-anomaly-details')), findsNothing);
      expect(find.textContaining('sample.anomaly.A'), findsNothing);
      expect(find.textContaining('Classification:'), findsNothing);
    },
  );

  testWidgets(
    'T016 replacement shows one anomaly section with shared provenance',
    (tester) async {
      final item = _item();
      await _show(
        tester,
        item,
        content: MapDetails(
          state: MapSelectionState(
            selectedItemId: item.id,
            item: item,
            mode: MapQueryMode.historical,
            dataMode: MapDataMode.sample,
          ),
          onClose: () {},
          typedDetailsBuilder: (item) => switch (item) {
            AnomalyMapItem() => AnomalyDetailsSection(item: item),
            _ => null,
          },
        ),
      );
      expect(find.byKey(const ValueKey('map-anomaly-details')), findsOneWidget);
      expect(find.text('Baseline value: 6.0'), findsOneWidget);
      expect(find.text('Difference from baseline: 6.0'), findsOneWidget);
      expect(find.text('Sample data — illustrative only'), findsOneWidget);
      expect(find.text('Historical data'), findsOneWidget);
      expect(find.text('Source: Illustrative sample data'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
