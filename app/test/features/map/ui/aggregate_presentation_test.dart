import 'dart:async';
import 'dart:convert';
import 'dart:io';

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

Object? _jsonFixture(String name) => jsonDecode(
  File(
    '../specs/002-map-data-presentation/contracts/examples/$name.sample.json',
  ).readAsStringSync(),
);

AggregateMapItem _aggregate({int? total = 2, GeoJsonGeometry? geometry}) {
  final raw = _jsonFixture('item-variants');
  if (raw is! List<dynamic>) throw StateError('Expected variant fixtures');
  for (final value in raw.whereType<Map<String, dynamic>>()) {
    if (value['kind'] != 'aggregate') continue;
    final parsed = MapItem.fromJson(value);
    if (parsed is! AggregateMapItem) throw StateError('Expected aggregate');
    final details = parsed.details;
    return parsed.copyWith(
      geometry: geometry ?? parsed.geometry,
      details: AggregateDetails(
        representation: details.representation,
        memberIds: details.memberIds,
        memberCursor: details.memberCursor,
        resultRange: ResultRange(
          scope: details.resultRange.scope,
          returnedCount: details.resultRange.returnedCount,
          totalMatching: total,
        ),
        metric: details.metric,
        window: details.window,
        coverage: details.coverage,
        bounds: details.bounds,
        grid: details.grid,
      ),
    );
  }
  throw StateError('Aggregate fixture absent');
}

List<MapItem> _members() {
  final raw = _jsonFixture('members');
  if (raw is! Map<String, dynamic>) throw StateError('Expected member page');
  return MapItemPage.fromJson(raw).items;
}

MapItemPage _page(
  AggregateMembersQuery query, {
  List<MapItem>? items,
  MapCompleteness completeness = MapCompleteness.complete,
  String? cursor,
  int? total = 2,
  String? snapshotId,
  String aggregateId = 'sample.aggregate',
}) {
  final aggregate = _aggregate();
  return MapItemPage(
    schemaVersion: 1,
    requestId: query.requestId,
    snapshotId: snapshotId ?? query.snapshotId,
    generatedAt: DateTime.utc(2026, 10, 1, 1),
    mode: MapQueryMode.current,
    dataMode: MapDataMode.sample,
    items: items ?? _members(),
    completeness: completeness,
    nextCursor: cursor,
    totalMatching: total,
    scope: PageScope.aggregateMembers(
      aggregateId: aggregateId,
      bounds: aggregate.details.bounds,
      window: aggregate.details.window,
      unit: 'sensor passages',
    ),
  );
}

final class _Repository implements MapRepository {
  _Repository(this.respond);
  final Future<MapItemPage> Function(AggregateMembersQuery) respond;
  final List<AggregateMembersQuery> calls = [];
  final List<MapRequestCancellation?> cancellations = [];

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    calls.add(query);
    cancellations.add(cancellation);
    return respond(query);
  }

  @override
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation}) =>
      throw UnimplementedError();
  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();
  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();
  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) => throw UnimplementedError();
}

const _context = MapReadContext(
  requestId: 'test-group',
  snapshotId: 'sample-snapshot',
);

AggregateDetailsPanel _panel(
  _Repository repository, {
  AggregateMapItem? aggregate,
  MapReadContext readContext = _context,
  ValueChanged<MapBounds>? onZoom,
  ValueChanged<MapItem>? onSelected,
  VoidCallback? onRefresh,
  int pageSize = 25,
  int maxMembers = 100,
}) => AggregateDetailsPanel(
  aggregate: aggregate ?? _aggregate(),
  repository: repository,
  readContext: readContext,
  mode: MapQueryMode.current,
  dataMode: MapDataMode.sample,
  onZoomToBounds: onZoom,
  onItemSelected: onSelected,
  onRefreshSnapshot: onRefresh,
  pageSize: pageSize,
  maxDisplayedMembers: maxMembers,
);

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
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'cluster uses an original point, truthful count/measure and original navigation bounds',
    (tester) async {
      final aggregate = _aggregate(
        total: null,
        geometry: const GeoJsonGeometry.multiPoint(
          coordinates: [
            [144.967, -37.818],
            [144.965, -37.817],
          ],
        ),
      );
      late CoreRenderPlan plan;
      AggregateMapItem? selected;
      MapBounds? bounds;
      await _show(
        tester,
        Builder(
          builder: (context) {
            plan = buildAggregateRenderPlan(
              context,
              [aggregate],
              'sample.sensor.A',
              (item) => selected = item,
              onZoomToBounds: (value) => bounds = value,
            );
            return const SizedBox.shrink();
          },
        ),
      );
      final marker = plan.markers.single;
      expect(marker.position, const LatLng(-37.818, 144.967));
      expect(marker.infoWindow.title, 'Group: 2 loaded records');
      expect(
        marker.infoWindow.snippet,
        contains('Sensor passage counts: 12 sensor passages'),
      );
      expect(marker.infoWindow.snippet, contains('Loaded scope only'));
      expect(marker.zIndexInt, 4);
      expect(plan.polygons, isEmpty);
      marker.onTap!();
      expect(selected, same(aggregate));
      expect(bounds, same(aggregate.details.bounds));
    },
  );

  testWidgets(
    'null geometry never becomes a point at navigation-bounds centre',
    (tester) async {
      final aggregate = _aggregate().copyWith(geometry: null);
      late CoreRenderPlan plan;
      await _show(
        tester,
        Builder(
          builder: (context) {
            plan = buildAggregateRenderPlan(context, [aggregate], null, null);
            return const SizedBox.shrink();
          },
        ),
      );
      expect(plan.markers, isEmpty);
      expect(plan.polygons, isEmpty);
    },
  );

  test('selection membership follows actual stable IDs only', () {
    final aggregate = _aggregate();
    expect(aggregateRepresentsSelection(aggregate, 'sample.sensor.A'), isTrue);
    expect(aggregateRepresentsSelection(aggregate, aggregate.id), isTrue);
    expect(aggregateRepresentsSelection(aggregate, 'unrelated'), isFalse);
    expect(aggregateRepresentsSelection(aggregate, null), isFalse);
  });

  testWidgets(
    'count symbol raster host produces public bitmap markers without a platform map',
    (tester) async {
      late CoreRenderPlan plan;
      final aggregate = _aggregate(total: null);
      await _show(
        tester,
        AggregateRenderLayer(
          items: [aggregate],
          builder: (context, render) {
            plan = render(context, [aggregate], null, null);
            return const SizedBox.shrink();
          },
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
      expect(plan.markers.single.icon, isA<BytesMapBitmap>());
      expect(plan.markers.single.infoWindow.title, 'Group: 2 loaded records');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'same-location list preserves exact zero, source and Melbourne window',
    (tester) async {
      final repo = _Repository((query) async => _page(query));
      final aggregate = _aggregate(
        total: null,
        geometry: const GeoJsonGeometry.multiPoint(
          coordinates: [
            [144.967, -37.818],
            [144.967, -37.818],
          ],
        ),
      );
      MapItem? selected;
      MapBounds? bounds;
      await _show(
        tester,
        _panel(
          repo,
          aggregate: aggregate,
          onSelected: (item) => selected = item,
          onZoom: (value) => bounds = value,
        ),
      );
      await tester.pump();
      expect(find.text('Sample data — illustrative only'), findsOneWidget);
      expect(
        find.text('Sensor passage counts: 12 sensor passages'),
        findsOneWidget,
      );
      expect(find.text('Group: 2 loaded records'), findsOneWidget);
      expect(
        find.textContaining('Observation window: 1 Oct 2026, 10:59 AEST'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Several records share this location'),
        findsOneWidget,
      );
      expect(find.text('Sensor passages: 0'), findsOneWidget);
      expect(repo.calls.single.snapshotId, 'sample-snapshot');
      expect(repo.calls.single.pageSize, 25);
      await tester.tap(find.text('Zoom to group bounds'));
      expect(bounds, same(aggregate.details.bounds));
      await tester.ensureVisible(find.text('Sample sensor B'));
      await tester.tap(find.text('Sample sensor B'));
      expect(selected?.id, 'sample.sensor.B');
    },
  );

  testWidgets(
    'manual paging stops at its display cap and never substitutes retrieved rows for total',
    (tester) async {
      final members = _members();
      final repo = _Repository(
        (query) async => _page(
          query,
          items: [query.cursor == null ? members[0] : members[1]],
          total: null,
          completeness: MapCompleteness.partial,
          cursor: query.cursor == null ? 'page-2' : 'page-3',
        ),
      );
      await _show(
        tester,
        _panel(
          repo,
          aggregate: _aggregate(total: null),
          pageSize: 1,
          maxMembers: 2,
        ),
      );
      await tester.pump();
      expect(repo.calls, hasLength(1));
      expect(find.text('Member records retrieved: 1'), findsOneWidget);
      await tester.ensureVisible(find.text('Retrieve more group members'));
      await tester.tap(find.text('Retrieve more group members'));
      await tester.pump();
      expect(repo.calls, hasLength(2));
      expect(repo.calls.last.cursor, 'page-2');
      expect(find.text('Member records retrieved: 2'), findsOneWidget);
      expect(
        find.textContaining('This list has reached its display limit'),
        findsOneWidget,
      );
      expect(find.text('Retrieve more group members'), findsNothing);
      expect(
        find.textContaining('Exact matching records in this group'),
        findsNothing,
      );
    },
  );

  testWidgets('exact group total survives partial member pagination', (
    tester,
  ) async {
    final members = _members();
    final repo = _Repository(
      (query) async => _page(
        query,
        items: [query.cursor == null ? members[0] : members[1]],
        completeness: query.cursor == null
            ? MapCompleteness.partial
            : MapCompleteness.complete,
        cursor: query.cursor == null ? 'page-2' : null,
      ),
    );
    await _show(tester, _panel(repo, pageSize: 1));
    await tester.pump();
    expect(find.text('Member records retrieved: 1'), findsOneWidget);
    expect(find.text('Could not retrieve map data'), findsNothing);
    await tester.ensureVisible(find.text('Retrieve more group members'));
    await tester.tap(find.text('Retrieve more group members'));
    await tester.pump();
    expect(find.text('Member records retrieved: 2'), findsOneWidget);
    expect(find.text('Retrieve more group members'), findsNothing);
    expect(find.text('Could not retrieve map data'), findsNothing);
  });

  testWidgets(
    'retry retains earlier members and never exposes the transport exception',
    (tester) async {
      var attempts = 0;
      final member = _members().first;
      final repo = _Repository((query) async {
        attempts++;
        if (attempts == 2) throw const MapNetworkException();
        return _page(
          query,
          items: [member],
          total: null,
          completeness: MapCompleteness.partial,
          cursor: 'page-$attempts',
        );
      });
      await _show(tester, _panel(repo));
      await tester.pump();
      await tester.ensureVisible(find.text('Retrieve more group members'));
      await tester.tap(find.text('Retrieve more group members'));
      await tester.pump();
      expect(find.text('Could not retrieve map data'), findsOneWidget);
      expect(find.text('Sample sensor A'), findsOneWidget);
      expect(find.text('Member records retrieved: 1'), findsOneWidget);
      expect(find.textContaining('MapNetworkException'), findsNothing);
      await tester.ensureVisible(find.text('Retry group members'));
      await tester.tap(find.text('Retry group members'));
      await tester.pump();
      expect(repo.calls.last.cursor, 'page-1');
      expect(find.text('Member records retrieved: 1'), findsOneWidget);
    },
  );

  testWidgets(
    'expired snapshots request a new viewport rather than retrying an old cursor',
    (tester) async {
      final repo = _Repository(
        (query) async => throw const MapHttpException(
          statusCode: 409,
          retryable: true,
          code: MapServiceErrorCode.snapshotExpired,
        ),
      );
      var refreshes = 0;
      await _show(tester, _panel(repo, onRefresh: () => refreshes++));
      await tester.pump();
      expect(
        find.textContaining('This group snapshot has expired'),
        findsOneWidget,
      );
      expect(find.text('Retry group members'), findsNothing);
      await tester.ensureVisible(find.text('Refresh map snapshot'));
      await tester.tap(find.text('Refresh map snapshot'));
      expect(refreshes, 1);
      expect(repo.calls, hasLength(1));
    },
  );

  testWidgets(
    'wrong snapshot and aggregate scope cannot mix into the selected group',
    (tester) async {
      for (final wrongSnapshot in [true, false]) {
        final repo = _Repository(
          (query) async => _page(
            query,
            snapshotId: wrongSnapshot ? 'another-snapshot' : null,
            aggregateId: wrongSnapshot ? 'sample.aggregate' : 'other-aggregate',
          ),
        );
        await _show(tester, _panel(repo));
        await tester.pump();
        expect(find.text('Could not retrieve map data'), findsOneWidget);
        expect(find.text('Sample sensor A'), findsNothing);
        expect(find.text('Retry group members'), findsNothing);
      }
    },
  );

  testWidgets(
    'changing snapshots cancels old requests and ignores late member pages',
    (tester) async {
      final oldPage = Completer<MapItemPage>();
      final oldRepo = _Repository((query) => oldPage.future);
      final newRepo = _Repository(
        (query) async => _page(query, items: [_members().last], total: 1),
      );
      await _show(tester, _panel(oldRepo));
      final oldQuery = oldRepo.calls.single;
      await _show(
        tester,
        _panel(
          newRepo,
          readContext: const MapReadContext(
            requestId: 'new-request',
            snapshotId: 'new-snapshot',
          ),
        ),
      );
      await tester.pump();
      expect(oldRepo.cancellations.single?.isCancelled, isTrue);
      oldPage.complete(_page(oldQuery, items: [_members().first], total: 1));
      await tester.pump();
      expect(find.text('Sample sensor A'), findsNothing);
      expect(find.text('Sample sensor B'), findsOneWidget);
    },
  );

  testWidgets(
    'repeating a cursor is rejected and cannot drive unbounded empty requests',
    (tester) async {
      final repo = _Repository(
        (query) async => _page(
          query,
          items: [],
          total: null,
          completeness: MapCompleteness.partial,
          cursor: 'repeat',
        ),
      );
      await _show(tester, _panel(repo));
      await tester.pump();
      await tester.ensureVisible(find.text('Retrieve more group members'));
      await tester.tap(find.text('Retrieve more group members'));
      await tester.pump();
      expect(repo.calls, hasLength(2));
      expect(find.text('Could not retrieve map data'), findsOneWidget);
      expect(find.text('Retrieve more group members'), findsNothing);
    },
  );
}
