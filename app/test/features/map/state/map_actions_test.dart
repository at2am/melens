import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/state/map_actions.dart';

void main() {
  late ProviderContainer container;
  late MapActionsController actions;

  setUp(() {
    container = ProviderContainer.test();
    actions = container.read(mapActionsControllerProvider.notifier);
  });

  Set<MapLayerId> enabled() =>
      container.read(layerControllerProvider).enabledLayers;

  test('show_layers only, add and remove respect the current topic', () {
    final only = actions.apply(
      const UiAction(
        action: UiActionName.showLayers,
        args: <String, dynamic>{
          'layers': ['event', 'news'],
          'mode': 'only',
        },
      ),
    );
    expect(enabled(), {MapLayerId.event});
    // news belongs to another topic and is reported, not switched to.
    expect(only.outcome, MapActionOutcome.partial);
    expect(only.skipped, ['news']);

    final add = actions.apply(
      const UiAction(
        action: UiActionName.showLayers,
        args: <String, dynamic>{
          'layers': ['pedestrian'],
        },
      ),
    );
    expect(add.outcome, MapActionOutcome.applied);
    expect(enabled(), {MapLayerId.pedestrian, MapLayerId.event});

    final remove = actions.apply(
      const UiAction(
        action: UiActionName.showLayers,
        args: <String, dynamic>{
          'layers': ['event'],
          'mode': 'remove',
        },
      ),
    );
    expect(remove.outcome, MapActionOutcome.applied);
    expect(enabled(), {MapLayerId.pedestrian});

    final unknown = actions.apply(
      const UiAction(
        action: UiActionName.showLayers,
        args: <String, dynamic>{
          'layers': ['telepathy'],
        },
      ),
    );
    expect(unknown.outcome, MapActionOutcome.ignored);
    expect(unknown.skipped, ['telepathy']);
    expect(enabled(), {MapLayerId.pedestrian});

    // `parking` (UC-15) is a v1 layer of the city activity topic; an earlier
    // revision of this test used it as the unknown layer.
    final parking = actions.apply(
      const UiAction(
        action: UiActionName.showLayers,
        args: <String, dynamic>{
          'layers': ['parking'],
        },
      ),
    );
    expect(parking.outcome, MapActionOutcome.applied);
    expect(enabled(), {MapLayerId.pedestrian, MapLayerId.parking});
  });

  test('focus_map records a numbered request for a point or a box', () {
    final point = actions.apply(
      const UiAction(
        action: UiActionName.focusMap,
        args: <String, dynamic>{
          'target': {
            'feature_id': 'event:1',
            'point': {'lat': -37.81, 'lng': 144.96},
          },
          'zoom': 17,
        },
      ),
    );
    expect(point.outcome, MapActionOutcome.applied);
    var focus = container.read(mapActionsControllerProvider).focus!;
    expect(focus.sequence, 1);
    expect(focus.point?.lat, -37.81);
    expect(focus.featureId, 'event:1');
    expect(focus.zoom, 17);

    actions.apply(
      const UiAction(
        action: UiActionName.focusMap,
        args: <String, dynamic>{
          'target': {
            'bbox': {
              'north': -37.80,
              'south': -37.82,
              'east': 144.98,
              'west': 144.95,
            },
          },
        },
      ),
    );
    focus = container.read(mapActionsControllerProvider).focus!;
    expect(focus.sequence, 2);
    expect(focus.bounds?.west, 144.95);
    expect(focus.point, isNull);

    final invalid = actions.apply(
      const UiAction(
        action: UiActionName.focusMap,
        args: <String, dynamic>{
          'target': {
            'bbox': {
              'north': -37.82,
              'south': -37.80,
              'east': 144.98,
              'west': 144.95,
            },
          },
        },
      ),
    );
    expect(invalid.outcome, MapActionOutcome.ignored);
    expect(container.read(mapActionsControllerProvider).focus!.sequence, 2);
  });

  test('highlight_features replaces or extends the highlighted ids', () {
    final first = actions.apply(
      const UiAction(
        action: UiActionName.highlightFeatures,
        args: <String, dynamic>{
          'ids': ['event:1', 'event:2'],
          'clear_previous': true,
          'missing': ['event:9'],
        },
      ),
    );
    expect(first.outcome, MapActionOutcome.partial);
    expect(first.skipped, ['event:9']);
    var state = container.read(mapActionsControllerProvider);
    expect(state.highlightedIds, ['event:1', 'event:2']);
    expect(state.missingIds, ['event:9']);

    actions.apply(
      const UiAction(
        action: UiActionName.highlightFeatures,
        args: <String, dynamic>{
          'ids': ['event:2', 'news:1'],
          'clear_previous': false,
          'missing': <String>[],
        },
      ),
    );
    state = container.read(mapActionsControllerProvider);
    expect(state.highlightedIds, ['event:1', 'event:2', 'news:1']);

    actions.clearHighlights();
    state = container.read(mapActionsControllerProvider);
    expect(state.highlightedIds, isEmpty);
    expect(state.missingIds, isEmpty);
  });

  // Google's documented example: three points of a path.
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  test(
    'draw_route decodes the polyline, keeps the stops and fits the camera',
    () {
      final report = actions.apply(
        const UiAction(
          action: UiActionName.drawRoute,
          args: <String, dynamic>{
            'polyline': encoded,
            'mode': 'walk',
            'distance_m': 3400,
            'duration_min': 46,
            'waypoints': [
              {'lat': 38.5, 'lng': -120.2, 'label': 'Start'},
              {'lat': 43.252, 'lng': -126.453},
              {'lat': 'x', 'lng': 1},
            ],
          },
        ),
      );

      expect(report.outcome, MapActionOutcome.applied);
      final state = container.read(mapActionsControllerProvider);
      final route = state.route!;
      expect(route.points, hasLength(3));
      expect(route.points.first.lat, closeTo(38.5, 1e-9));
      expect(route.points.last.lng, closeTo(-126.453, 1e-9));
      expect(route.waypoints, hasLength(2));
      expect(route.waypoints.first.label, 'Start');
      expect(route.mode, 'walk');
      expect(route.distanceMetres, 3400);
      expect(route.durationMinutes, 46);
      final bounds = state.focus!.bounds!;
      expect(bounds.north, greaterThan(43.252));
      expect(bounds.south, lessThan(38.5));
      expect(bounds.east, greaterThan(-120.2));
      expect(bounds.west, lessThan(-126.453));
    },
  );

  test('a new draw_route replaces the old one and clearRoute removes it', () {
    const action = UiAction(
      action: UiActionName.drawRoute,
      args: <String, dynamic>{'polyline': encoded, 'mode': 'transit'},
    );
    actions.apply(action);
    final first = container.read(mapActionsControllerProvider).route!;
    actions.apply(action);
    final second = container.read(mapActionsControllerProvider).route!;
    expect(second.sequence, greaterThan(first.sequence));
    expect(second.mode, 'transit');

    actions.clearRoute();
    expect(container.read(mapActionsControllerProvider).route, isNull);
  });

  test('draw_route without a usable polyline is ignored', () {
    for (final args in <Map<String, dynamic>>[
      {'distance_m': 100},
      {'polyline': ''},
      {'polyline': '!!!'},
      {'polyline': '_p~iF'},
    ]) {
      final report = actions.apply(
        UiAction(action: UiActionName.drawRoute, args: args),
      );
      expect(report.outcome, MapActionOutcome.ignored, reason: '$args');
    }
    expect(container.read(mapActionsControllerProvider).route, isNull);
  });
}
