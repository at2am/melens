import 'package:flutter_test/flutter_test.dart';
import 'package:melens/core/time/melbourne_time.dart';
import 'package:melens/features/chat/state/request_context.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/state/selection_controller.dart';
import 'package:melens/features/map/state/viewport_controller.dart';

void main() {
  final clock = MelbourneClock(now: () => DateTime.utc(2026, 10, 10, 7, 40));

  test('the context reports the bounded viewport, layers and local time', () {
    final context = buildRequestContext(
      viewport: ViewportState(
        window: currentViewportWindow(clock),
        dataMode: MapDataMode.sample,
        bbox: const MapBounds(
          west: 144.95,
          south: -37.83,
          east: 144.98,
          north: -37.80,
        ),
        zoom: 15.5,
      ),
      layers: LayerSelectionState.initial(),
      selection: const MapSelectionState(),
      clock: clock,
      openCardId: 'c_1',
    );

    expect(context.toJson(), {
      'viewport': {
        'north': -37.80,
        'south': -37.83,
        'east': 144.98,
        'west': 144.95,
      },
      'zoom': 15.5,
      'layers': ['pedestrian', 'anomaly', 'disruption'],
      'openCardId': 'c_1',
      'localTime': '2026-10-10T18:40:00+11:00',
    });
  });

  test('without a map region the CBD default stands in', () {
    final context = buildRequestContext(
      viewport: ViewportState(
        window: currentViewportWindow(clock),
        dataMode: MapDataMode.sample,
      ),
      layers: LayerSelectionState.initial(),
      selection: const MapSelectionState(),
      clock: clock,
    );

    expect(context.viewport.north, defaultRequestViewport.north);
    expect(context.viewport.north, greaterThan(context.viewport.south));
    expect(context.viewport.east, greaterThan(context.viewport.west));
    expect(context.zoom, 14);
    expect(context.toJson().containsKey('openCardId'), isFalse);
  });

  test('a selection is sent with its id and a point only for points', () {
    final context = buildRequestContext(
      viewport: ViewportState(
        window: currentViewportWindow(clock),
        dataMode: MapDataMode.sample,
      ),
      layers: LayerSelectionState.initial(),
      selection: const MapSelectionState(selectedItemId: 'event:1'),
      clock: clock,
    );

    expect(context.toJson()['selected'], {
      'featureId': 'event:1',
      'point': null,
    });
    expect(
      pointOfGeometry(
        const GeoJsonGeometry.point(coordinates: [144.96, -37.81]),
      )?.toJson(),
      {'lat': -37.81, 'lng': 144.96},
    );
    expect(
      pointOfGeometry(
        const GeoJsonGeometry.lineString(
          coordinates: [
            [144.96, -37.81],
            [144.97, -37.82],
          ],
        ),
      ),
      isNull,
    );
  });
}
