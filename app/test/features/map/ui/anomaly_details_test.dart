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

/// The whole selected-record panel, so the technical ids are present too.
Widget _panel(AnomalyMapItem item) => MapDetails(
  state: MapSelectionState(
    selectedItemId: item.id,
    item: item,
    mode: MapQueryMode.historical,
    dataMode: MapDataMode.sample,
  ),
  onClose: () {},
);

Future<void> _expandTechnical(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Technical details'));
  await tester.tap(find.text('Technical details'));
  await tester.pumpAndSettle();
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
      final item = _item(
        details: {
          'baselineValue': 6.123456789,
          'observedValue': 12.000000001,
          'delta': 3.7654321,
          'direction': 'lower',
        },
      );
      await _show(tester, item, content: _panel(item));
      expect(find.text('Usual level'), findsOneWidget);
      expect(find.text('6.123456789'), findsOneWidget);
      expect(find.text('12.000000001'), findsOneWidget);
      expect(find.text('3.7654321'), findsOneWidget);
      expect(find.text('Unusual'), findsOneWidget);
      expect(
        find.text('A difference from the baseline does not establish a cause.'),
        findsOneWidget,
      );
      expect(find.text('Result id: sample.anomaly.A'), findsNothing);
      await _expandTechnical(tester);
      expect(find.text('Result id: sample.anomaly.A'), findsOneWidget);
      expect(find.text('Observation id: sample.sensor.A'), findsOneWidget);
      expect(
        find.text('Baseline definition id: sample.baseline'),
        findsOneWidget,
      );
      expect(find.text('Direction: lower than the baseline'), findsOneWidget);
      expect(find.text('Eligibility: eligible'), findsOneWidget);
      expect(find.text('Classification: anomalous'), findsOneWidget);
    },
  );

  testWidgets('headline compares observed with usual in plain words', (
    tester,
  ) async {
    await _show(
      tester,
      _item(
        details: {
          'baselineValue': 1361.57,
          'observedValue': 154,
          'delta': -1207.57,
          'direction': 'lower',
          'baselineDefinitionId': 'same-hour-prev-7d-mean-v1',
        },
      ),
    );
    expect(find.text('89% below usual'), findsOneWidget);
    expect(find.text('1,361.57'), findsOneWidget);
    expect(find.text('-1,207.57'), findsOneWidget);
    expect(
      find.text('Average for the same hour over the previous 7 days'),
      findsOneWidget,
    );
  });

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
      final item = _item(
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
      );
      await _show(tester, item, content: _panel(item));
      expect(find.text('Unknown'), findsNWidgets(3));
      expect(find.textContaining('below usual'), findsNothing);
      expect(find.textContaining('above usual'), findsNothing);
      expect(find.text('Not classified'), findsOneWidget);
      expect(
        find.text(
          'This sensor was not eligible for anomaly checks in this window.',
        ),
        findsOneWidget,
      );
      await _expandTechnical(tester);
      expect(find.text('Observation id: Unknown'), findsOneWidget);
      expect(find.text('Baseline definition id: Unknown'), findsOneWidget);
      expect(find.text('Direction: unknown'), findsOneWidget);
      expect(find.text('Eligibility: ineligible'), findsOneWidget);
      expect(find.text('Classification: unclassified'), findsOneWidget);
      expect(find.text('Classification: not anomalous'), findsNothing);
    },
  );

  testWidgets(
    'known zero and producer no-change do not become unknown values',
    (tester) async {
      final item = _item(
        details: {
          'baselineValue': 0,
          'observedValue': 0,
          'delta': 0,
          'direction': 'none',
          'classification': 'notAnomalous',
        },
      );
      await _show(tester, item, content: _panel(item));
      expect(find.text('0'), findsNWidgets(3));
      expect(find.text('Unknown'), findsNothing);
      expect(find.text('In line with usual'), findsOneWidget);
      expect(find.text('Within the usual range'), findsOneWidget);
      await _expandTechnical(tester);
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
      expect(
        find.text(
          'Whether this sensor was eligible for anomaly checks is not known.',
        ),
        findsOneWidget,
      );
      expect(find.text('100% above usual'), findsOneWidget);
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
      expect(find.text('Usual level'), findsNothing);
    },
  );

  testWidgets('the panel shows one anomaly section with shared provenance', (
    tester,
  ) async {
    final item = _item();
    await _show(tester, item, content: _panel(item));
    expect(find.byKey(const ValueKey('map-anomaly-details')), findsOneWidget);
    expect(find.text('Usual level'), findsOneWidget);
    expect(find.text('6'), findsNWidgets(2));
    expect(find.text('Sample data — illustrative only'), findsOneWidget);
    expect(find.text('Historical data'), findsOneWidget);
    expect(find.text('Source: Illustrative sample data'), findsOneWidget);
    expect(find.text('Source version: sample-v1'), findsNothing);
    await _expandTechnical(tester);
    expect(find.text('Source version: sample-v1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
