import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/ui/map_details.dart';
import 'package:melens/l10n/app_localizations.dart';

import '../t016_test_support.dart';

Future<void> _show(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
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

MapSelectionState _state(
  MapItem item, {
  MapSelectionDisposition disposition = MapSelectionDisposition.matching,
  Object? error,
}) => MapSelectionState(
  selectedItemId: item.id,
  item: item,
  disposition: disposition,
  dataMode: MapDataMode.sample,
  detailError: error,
);

void main() {
  testWidgets('desktop side and narrow bottom layouts stay bounded', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    tester.view.physicalSize = const Size(1100, 720);
    final item = t016Item();
    final child = MapDetailsLayout(
      map: const SizedBox.expand(key: ValueKey('map-content')),
      details: MapDetails(state: _state(item), onClose: () {}),
    );
    await _show(tester, child);
    expect(
      find.byKey(const ValueKey('map-details-side-layout')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    tester.view.physicalSize = const Size(390, 844);
    await tester.pump();
    expect(
      find.byKey(const ValueKey('map-details-bottom-layout')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('map-content')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('null counts are unknown and zero remains a measured zero', (
    tester,
  ) async {
    final json = t016Item().toJson();
    (json['details'] as Map<String, dynamic>)['totalCount'] = null;
    final unknown = MapItem.fromJson(json);
    await _show(tester, MapDetails(state: _state(unknown), onClose: () {}));
    expect(find.text('Passage count unknown'), findsOneWidget);
    expect(find.text('Direction A passages: Unknown'), findsOneWidget);
    expect(find.text('Sensor passages: 0'), findsNothing);
    (json['details'] as Map<String, dynamic>)['totalCount'] = 0;
    final zero = MapItem.fromJson(json);
    await _show(tester, MapDetails(state: _state(zero), onClose: () {}));
    expect(find.text('Sensor passages: 0'), findsOneWidget);
    expect(find.text('Sample data — illustrative only'), findsOneWidget);
    expect(find.textContaining('1 Oct 2026, 10:59 AEST'), findsWidgets);
  });

  testWidgets('unknown clock, prediction and source callback are explicit', (
    tester,
  ) async {
    final json = t016Item().toJson();
    json['assertionKind'] = 'prediction';
    final time = json['time'] as Map<String, dynamic>;
    time['observedAt'] = null;
    time['sourceTimeText'] = '01/10/2026 09:30';
    time['sourceTimezone'] = null;
    final source =
        (json['sources'] as List<dynamic>).first as Map<String, dynamic>;
    source['url'] = 'https://example.org/record';
    Uri? opened;
    await _show(
      tester,
      MapDetails(
        state: _state(MapItem.fromJson(json)),
        onClose: () {},
        onOpenSource: (uri) => opened = uri,
      ),
    );
    expect(find.text('Prediction'), findsOneWidget);
    expect(find.text('Observation or report time unknown'), findsOneWidget);
    expect(
      find.text('Source time: 01/10/2026 09:30 (timezone unknown)'),
      findsOneWidget,
    );
    final sourceButton = find.text('Open source: Illustrative sample data');
    await tester.ensureVisible(sourceButton);
    await tester.tap(sourceButton);
    expect(opened, Uri.parse('https://example.org/record'));
  });

  testWidgets('public URL remains selectable when opener is not supplied', (
    tester,
  ) async {
    final json = t016Item().toJson();
    ((json['sources'] as List<dynamic>).first as Map<String, dynamic>)['url'] =
        'https://example.org/public-source';
    await _show(
      tester,
      MapDetails(state: _state(MapItem.fromJson(json)), onClose: () {}),
    );
    expect(
      find.widgetWithText(SelectableText, 'https://example.org/public-source'),
      findsOneWidget,
    );
  });

  testWidgets('offscreen and filter messages retain original title', (
    tester,
  ) async {
    final item = t016Item();
    await _show(
      tester,
      MapDetails(
        state: _state(item, disposition: MapSelectionDisposition.offscreen),
        onClose: () {},
      ),
    );
    expect(find.text(item.title), findsOneWidget);
    expect(find.textContaining('outside the current view'), findsOneWidget);
    await _show(
      tester,
      MapDetails(
        state: _state(
          item,
          disposition: MapSelectionDisposition.filterExcluded,
        ),
        onClose: () {},
      ),
    );
    expect(find.textContaining('map highlight is cleared'), findsOneWidget);
    expect(find.text(item.title), findsOneWidget);
  });

  testWidgets('withdrawn panel has explanation and no old public content', (
    tester,
  ) async {
    final item = t016Item();
    await _show(
      tester,
      MapDetails(
        state: MapSelectionState(
          selectedItemId: item.id,
          disposition: MapSelectionDisposition.withdrawn,
        ),
        onClose: () {},
      ),
    );
    expect(find.textContaining('has been withdrawn'), findsOneWidget);
    expect(find.text(item.title), findsNothing);
    expect(find.textContaining('Illustrative sample data'), findsNothing);
  });

  testWidgets('Escape and named close button close selected details', (
    tester,
  ) async {
    var closes = 0;
    await _show(
      tester,
      MapDetails(state: _state(t016Item()), onClose: () => closes++),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    expect(closes, 1);
    await tester.tap(find.byTooltip('Close selected record details'));
    expect(closes, 2);
  });

  testWidgets('expiry explains original retained snapshot without retry', (
    tester,
  ) async {
    await _show(
      tester,
      MapDetails(
        state: _state(
          t016Item(),
          error: const MapHttpException(
            statusCode: 410,
            retryable: false,
            code: MapServiceErrorCode.snapshotExpired,
          ),
        ),
        onClose: () {},
        onRetry: () {},
      ),
    );
    expect(
      find.textContaining('selected data snapshot has expired'),
      findsOneWidget,
    );
    expect(
      find.text('Showing the previous result with its original time'),
      findsOneWidget,
    );
    expect(find.text('Retry map data'), findsNothing);
  });

  testWidgets('typed replacement hook renders once with shared provenance', (
    tester,
  ) async {
    await _show(
      tester,
      MapDetails(
        state: _state(t016Item()),
        onClose: () {},
        typedDetailsBuilder: (item) =>
            const Text('Verified typed detail extension'),
      ),
    );
    expect(find.text('Verified typed detail extension'), findsOneWidget);
    expect(find.text('Sensor passages: 12'), findsNothing);
    expect(find.text('Sample data — illustrative only'), findsOneWidget);
  });

  testWidgets(
    'transport details retain impact, services and non-current status',
    (tester) async {
      final json = t016Item().toJson();
      json['kind'] = 'disruption';
      json['layerId'] = 'disruption';
      json['lifecycle'] = 'resolved';
      json['assertionKind'] = 'report';
      json['location'] = {
        'precision': 'point',
        'role': 'affectedExtent',
        'evidence': 'Published stop location',
      };
      json['details'] = {
        'summary': 'Stop temporarily closed',
        'impact': 'Use the adjacent stop',
        'serviceNames': ['Route 19'],
        'status': 'resolved',
        'extentKind': 'stop',
      };
      await _show(
        tester,
        MapDetails(state: _state(MapItem.fromJson(json)), onClose: () {}),
      );
      expect(find.text('Impact: Use the adjacent stop'), findsOneWidget);
      expect(find.text('Affected services: Route 19'), findsOneWidget);
      expect(find.text('Affected extent: stop'), findsOneWidget);
      expect(find.text('Status: resolved'), findsWidgets);
      expect(find.text('Location role: affected extent'), findsOneWidget);
    },
  );

  testWidgets('event details keep unknown time and planned venue status', (
    tester,
  ) async {
    final json = t016Item().toJson();
    json['kind'] = 'event';
    json['layerId'] = 'event';
    json['lifecycle'] = 'planned';
    json['assertionKind'] = 'plan';
    json['location'] = {
      'precision': 'point',
      'role': 'eventSite',
      'evidence': 'Source venue location',
    };
    json['details'] = {
      'summary': 'Published event',
      'venueName': 'Fixture venue',
      'category': 'Music',
      'startAt': null,
      'endAt': null,
      'status': 'planned',
    };
    await _show(
      tester,
      MapDetails(state: _state(MapItem.fromJson(json)), onClose: () {}),
    );
    expect(find.text('Venue: Fixture venue'), findsOneWidget);
    expect(find.text('Starts: Unknown'), findsOneWidget);
    expect(find.text('Ends: Unknown'), findsOneWidget);
    expect(find.text('Plan'), findsOneWidget);
    expect(find.text('Status: planned'), findsWidgets);
  });

  testWidgets(
    'planning and boundary facts preserve permit and geographic vintage',
    (tester) async {
      final json = t016Item().toJson();
      json['kind'] = 'planning';
      json['layerId'] = 'planning';
      json['details'] = {
        'summary': 'Published development record',
        'projectStatus': 'Proposed',
        'permitId': null,
      };
      await _show(
        tester,
        MapDetails(state: _state(MapItem.fromJson(json)), onClose: () {}),
      );
      expect(find.text('Project status: Proposed'), findsOneWidget);
      expect(find.text('Permit id: Unknown'), findsOneWidget);
      json['kind'] = 'boundary';
      json['layerId'] = 'boundary';
      json['geometry'] = {
        'type': 'Polygon',
        'coordinates': [
          [
            [144.96, -37.82],
            [144.97, -37.82],
            [144.97, -37.81],
            [144.96, -37.82],
          ],
        ],
      };
      json['location'] = {
        'precision': 'area',
        'role': 'statisticalArea',
        'evidence': 'Published statistical area',
      };
      json['details'] = {
        'boundaryId': 'SA2.fixture',
        'boundaryLevel': 'SA2',
        'vintage': '2021',
        'name': 'Fixture area',
      };
      await _show(
        tester,
        MapDetails(state: _state(MapItem.fromJson(json)), onClose: () {}),
      );
      expect(find.text('Boundary vintage: 2021'), findsOneWidget);
      expect(find.text('Boundary level: SA2'), findsOneWidget);
      expect(find.text('Location precision: area'), findsOneWidget);
      expect(find.text('Location role: statistical area'), findsOneWidget);
    },
  );
}
