import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/data/map_repository.dart';
import 'package:melens/features/map/ui/aggregate_details.dart';
import 'package:melens/features/map/ui/renderers/aggregate_renderer.dart';
import 'package:melens/features/map/ui/renderers/core_renderers.dart';
import 'package:melens/l10n/app_localizations.dart';

List<List<List<double>>> _square(double west, double south, double size) => [
  [
    [west, south],
    [west + size, south],
    [west + size, south + size],
    [west, south + size],
    [west, south],
  ],
];

/// A UC-06 news area as the map service sends it.
Map<String, dynamic> _areaJson(
  String boundaryId, {
  required int total,
  required double west,
  required double south,
  required double size,
  List<String> memberIds = const ['news:a'],
}) => {
  'id': 'aggregate.news.area.$boundaryId',
  'versionId': 'areaMentions-v1.$boundaryId',
  'layerId': 'news',
  'kind': 'aggregate',
  'title': '$boundaryId: $total news articles',
  'geometry': {'type': 'Polygon', 'coordinates': _square(west, south, size)},
  'location': {
    'precision': 'area',
    'role': 'areaAssociation',
    'evidence': 'Official boundary of an area these articles name.',
  },
  'geometryPresentation': {
    'simplified': true,
    'originalPrecision': 'area',
    'toleranceMeters': 100,
  },
  'assertionKind': 'report',
  'lifecycle': 'active',
  'time': {
    'observedAt': null,
    'reportedAt': null,
    'validFrom': null,
    'validTo': null,
    'periodLabel': null,
    'fetchedAt': null,
    'sourceTimeText': null,
    'sourceTimezone': null,
  },
  'sources': [
    {
      'sourceId': 'abs.asgs.boundaries',
      'url': 'https://www.abs.gov.au/',
      'attribution': 'Australian Bureau of Statistics',
      'versionRef': 'b1',
    },
  ],
  'details': {
    'representation': 'areaMentions',
    'memberIds': memberIds,
    'memberCursor': null,
    'resultRange': {
      'scope': 'areaAssociation',
      'returnedCount': memberIds.length,
      'totalMatching': total,
    },
    'metric': {
      'id': 'newsAreaArticleCount',
      'label': 'News articles naming this area',
      'unit': 'articles',
      'value': total,
      'definition': 'Articles from the last 7 days that name this area.',
    },
    'window': null,
    'coverage': {
      'state': 'unknown',
      'areaRefs': <String>[],
      'window': null,
      'evidenceSourceIds': <String>[],
    },
    'bounds': [west, south, west + size, south + size],
    'grid': null,
  },
};

AggregateMapItem _area(
  String boundaryId, {
  int total = 3,
  double west = 144.9,
  double south = -37.9,
  double size = 0.1,
  List<String> memberIds = const ['news:a'],
}) => MapItem.fromJson(
  _areaJson(
    boundaryId,
    total: total,
    west: west,
    south: south,
    size: size,
    memberIds: memberIds,
  ),
) as AggregateMapItem;

final _article = MapItem.fromJson({
  'id': 'news:a',
  'versionId': 'news:a-v1',
  'layerId': 'news',
  'kind': 'news',
  'title': 'Council approves new tram stop',
  'geometry': null,
  'location': {'precision': 'unlocated', 'role': 'mention', 'evidence': null},
  'assertionKind': 'report',
  'lifecycle': 'active',
  'time': {
    'observedAt': null,
    'reportedAt': null,
    'validFrom': null,
    'validTo': null,
    'periodLabel': null,
    'fetchedAt': '2026-10-16T00:00:00Z',
    'sourceTimeText': null,
    'sourceTimezone': null,
  },
  'sources': [
    {
      'sourceId': 'gdelt.news',
      'url': 'https://example.org/tram-stop',
      'attribution': 'The GDELT Project (https://www.gdeltproject.org/)',
      'versionRef': 'news:a-v1',
    },
  ],
  'details': {
    'eventId': 'news:a',
    'summary': null,
    'articleRefs': [
      {
        'articleId': 'news:a',
        'url': 'https://example.org/tram-stop',
        'title': 'Council approves new tram stop',
        'reportedAt': null,
      },
    ],
    'localizationEvidence':
        'Mentioned area only; event location is unverified.',
    'dedupStatus': 'unconfirmed',
  },
});

final class _Repository implements MapRepository {
  _Repository(this.aggregate);
  final AggregateMapItem aggregate;

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) async => MapItemPage(
    schemaVersion: 1,
    requestId: query.requestId,
    snapshotId: query.snapshotId,
    generatedAt: DateTime.utc(2026, 10, 16),
    mode: MapQueryMode.current,
    dataMode: MapDataMode.live,
    items: [_article],
    completeness: MapCompleteness.complete,
    nextCursor: null,
    totalMatching: aggregate.details.resultRange.totalMatching,
    scope: PageScope.aggregateMembers(
      aggregateId: id,
      bounds: aggregate.details.bounds,
      window: null,
      unit: 'articles',
    ),
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Future<void> _show(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        melbourneClockProvider.overrideWithValue(
          MelbourneClock(now: () => DateTime.utc(2026, 10, 16)),
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

void main() {
  test('news areas are polygon area associations on the news layer only', () {
    expect(
      _area('ASGS_LGA:24600:2025').details.representation,
      AggregateRepresentation.areaMentions,
    );
    final json = _areaJson(
      'ASGS_LGA:24600:2025',
      total: 3,
      west: 144.9,
      south: -37.9,
      size: 0.1,
    );
    expect(
      () => MapItem.fromJson({...json, 'layerId': 'event'}),
      throwsFormatException,
    );
    expect(
      () => MapItem.fromJson({
        ...json,
        'location': {
          'precision': 'area',
          'role': 'eventSite',
          'evidence': 'Not an event site',
        },
      }),
      throwsFormatException,
    );
  });

  testWidgets(
    'areas are shaded by article count, smaller ones drawn above, and a tap selects without zooming',
    (tester) async {
      final council = _area('ASGS_LGA:24600:2025', total: 40);
      final suburb = _area(
        'ASGS_SA2:206071143:2026',
        total: 2,
        west: 144.99,
        south: -37.83,
        size: 0.02,
      );
      late CoreRenderPlan plan;
      AggregateMapItem? selected;
      MapBounds? zoomed;
      await _show(
        tester,
        Builder(
          builder: (context) {
            plan = buildAggregateRenderPlan(
              context,
              [council, suburb],
              null,
              (item) => selected = item,
              onZoomToBounds: (bounds) => zoomed = bounds,
            );
            return const SizedBox.shrink();
          },
        ),
      );
      expect(plan.markers, isEmpty, reason: 'no invented centre point');
      expect(plan.polygons, hasLength(2));
      Polygon polygonOf(AggregateMapItem item) => plan.polygons.singleWhere(
        (polygon) => polygon.polygonId.value.startsWith(item.id),
      );
      final councilShape = polygonOf(council);
      final suburbShape = polygonOf(suburb);
      expect(suburbShape.zIndex, greaterThan(councilShape.zIndex));
      expect(councilShape.fillColor.a, greaterThan(suburbShape.fillColor.a));
      suburbShape.onTap!();
      expect(selected, same(suburb));
      expect(zoomed, isNull);
    },
  );

  testWidgets('an area lists its latest articles with their original links', (
    tester,
  ) async {
    final area = _area('ASGS_LGA:24600:2025', total: 12);
    Uri? opened;
    MapItem? chosen;
    await _show(
      tester,
      AggregateDetailsPanel(
        aggregate: area,
        repository: _Repository(area),
        readContext: const MapReadContext(
          requestId: 'news-area',
          snapshotId: 'snapshot',
        ),
        mode: MapQueryMode.current,
        dataMode: MapDataMode.live,
        onOpenSource: (uri) => opened = uri,
        onItemSelected: (item) => chosen = item,
      ),
    );
    await tester.pump();
    expect(find.text('Latest articles'), findsOneWidget);
    expect(find.text('Showing 1 of 12'), findsOneWidget);
    expect(find.text('Council approves new tram stop'), findsOneWidget);
    expect(find.text('example.org'), findsOneWidget);
    expect(
      find.textContaining('not where a reported event happened'),
      findsOneWidget,
    );
    expect(find.text('Group members'), findsNothing);
    await tester.tap(
      find.byKey(const ValueKey('aggregate-member-open:news:a')),
    );
    expect(opened, Uri.parse('https://example.org/tram-stop'));
    await tester.tap(find.text('Council approves new tram stop'));
    expect(chosen?.id, 'news:a');
  });
}
