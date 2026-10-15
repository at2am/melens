import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/ui/map_layer_style.dart';
import 'package:melens/features/map/ui/renderers/core_renderers.dart';
import 'package:melens/features/map/ui/renderers/marker_icons.dart';

List<MapItem> _items() =>
    (jsonDecode(
          File(
            '../specs/002-map-data-presentation/contracts/examples/'
            'item-variants.sample.json',
          ).readAsStringSync(),
        ) as List<dynamic>)
        .map((item) => MapItem.fromJson(item as Map<String, dynamic>))
        .toList();

void main() {
  final colors = ThemeData().colorScheme;

  test('every layer has its own glyph and colour', () {
    final styles = MapLayerId.values.map(layerStyle).toList();
    expect(styles.map((s) => s.icon).toSet(), hasLength(styles.length));
    expect(styles.map((s) => s.color).toSet(), hasLength(styles.length));
    expect(layerStyle(MapLayerId.anomaly).icon, Icons.question_mark);
  });

  test('a point carries its own layer pin, and the selected one its '
      'selected pin', () {
    final points = _items()
        .where((item) => item.geometry is GeoJsonPoint)
        .where((item) => item is! AggregateMapItem && item is! ParkingMapItem)
        .where(isDrawableMapItem)
        .toList();
    final layers = points.map((item) => item.layerId).toSet();
    expect(layers.length, greaterThan(1));
    final fallback = MapMarkerIcons.fallback;
    // Without a drawn set the plan uses the tinted fallback pins.
    final plan = buildCoreRenderPlan(
      items: points,
      colors: colors,
      selectedItemId: points.first.id,
    );
    for (final item in points) {
      final marker = plan.markers.singleWhere(
        (m) => m.markerId.value.startsWith('${item.id}:point:'),
      );
      expect(
        marker.icon,
        same(fallback.layer(item.layerId, selected: item == points.first)),
      );
    }
    expect(plan.markers.map((m) => m.icon).toSet(), hasLength(layers.length));
  });

  testWidgets('the drawn icon set is one bitmap per kind of pin', (
    tester,
  ) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final icons = (await tester.runAsync(
      () => container.read(mapMarkerIconsProvider(2).future),
    ))!;
    final pins = [
      for (final layer in MapLayerId.values) ...[
        icons.layer(layer),
        icons.layer(layer, selected: true),
      ],
      icons.community,
      icons.routeStart,
      icons.routeEnd,
      icons.routeStop,
      icons.userLocation,
    ];
    expect(pins, everyElement(isA<BytesMapBitmap>()));
    expect(pins.toSet(), hasLength(pins.length));
    // Reading the set again returns the same objects, so markers stay equal.
    expect(
      container.read(mapMarkerIconsProvider(2)).value!.layer(MapLayerId.event),
      same(icons.layer(MapLayerId.event)),
    );
  });
}
