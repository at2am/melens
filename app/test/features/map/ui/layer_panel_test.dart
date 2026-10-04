import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:melens/features/map/data/map_models.dart';
import 'package:melens/features/map/state/layer_controller.dart';
import 'package:melens/features/map/ui/layer_panel.dart';
import 'package:melens/l10n/app_localizations.dart';

Future<ProviderContainer> _show(
  WidgetTester tester, {
  MapLayerCatalog? catalog,
  Set<MapTopic> selectableTopics = const {MapTopic.cityActivity},
}) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        locale: const Locale('en', 'AU'),
        supportedLocales: const [Locale('en', 'AU')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          ...GlobalMaterialLocalizations.delegates,
        ],
        home: Scaffold(
          body: SingleChildScrollView(
            child: LayerPanel(
              catalog: catalog,
              selectableTopics: selectableTopics,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  return ProviderScope.containerOf(tester.element(find.byType(LayerPanel)));
}

Finder _layer(MapLayerId layer) => find.byKey(ValueKey('layer-${layer.name}'));
Finder _topic(MapTopic topic) => find.byKey(ValueKey('topic-${topic.name}'));

SwitchListTile _toggle(WidgetTester tester, MapLayerId layer) =>
    tester.widget<SwitchListTile>(_layer(layer));

void main() {
  testWidgets('P0 defaults are adjustable and later topics stay gated', (
    tester,
  ) async {
    final container = await _show(tester);
    expect(find.text('Topics and layers'), findsOneWidget);
    expect(find.text('City activity'), findsOneWidget);
    expect(find.text('Nearby news'), findsOneWidget);
    expect(find.text('Area comparison'), findsOneWidget);
    expect(_toggle(tester, MapLayerId.pedestrian).value, isTrue);
    expect(_toggle(tester, MapLayerId.anomaly).value, isTrue);
    expect(_toggle(tester, MapLayerId.disruption).value, isTrue);
    expect(_toggle(tester, MapLayerId.event).value, isFalse);
    expect(
      tester.widget<ChoiceChip>(_topic(MapTopic.nearbyNews)).onSelected,
      isNull,
    );
    expect(
      tester.widget<ChoiceChip>(_topic(MapTopic.areaComparison)).onSelected,
      isNull,
    );
    expect(find.textContaining('after the core map features'), findsOneWidget);

    await tester.tap(_layer(MapLayerId.disruption));
    await tester.pump();
    expect(_toggle(tester, MapLayerId.disruption).value, isFalse);
    expect(_toggle(tester, MapLayerId.pedestrian).value, isTrue);
    expect(
      container.read(layerControllerProvider).topic,
      MapTopic.cityActivity,
    );
  });

  testWidgets('available topic switching restores each topic adjustment', (
    tester,
  ) async {
    await _show(
      tester,
      selectableTopics: const {
        MapTopic.cityActivity,
        MapTopic.nearbyNews,
        MapTopic.areaComparison,
      },
    );
    await tester.tap(_layer(MapLayerId.event));
    await tester.pump();
    await tester.tap(_topic(MapTopic.nearbyNews));
    await tester.pump();
    expect(_toggle(tester, MapLayerId.news).value, isTrue);
    await tester.tap(_layer(MapLayerId.news));
    await tester.pump();
    await tester.tap(_topic(MapTopic.cityActivity));
    await tester.pump();
    expect(_toggle(tester, MapLayerId.event).value, isTrue);
    await tester.tap(_topic(MapTopic.nearbyNews));
    await tester.pump();
    expect(_toggle(tester, MapLayerId.news).value, isFalse);
  });

  testWidgets('area metric controls replace the old fill and keep helpers', (
    tester,
  ) async {
    final container = await _show(
      tester,
      selectableTopics: const {MapTopic.cityActivity, MapTopic.areaComparison},
    );
    await tester.tap(_topic(MapTopic.areaComparison));
    await tester.pump();
    expect(_toggle(tester, MapLayerId.rent).value, isTrue);
    expect(_toggle(tester, MapLayerId.census).value, isFalse);
    expect(find.textContaining('One filled area metric'), findsOneWidget);
    await tester.tap(_layer(MapLayerId.disruption));
    await tester.pump();
    await tester.tap(_layer(MapLayerId.census));
    await tester.pump();
    expect(_toggle(tester, MapLayerId.rent).value, isFalse);
    expect(_toggle(tester, MapLayerId.census).value, isTrue);
    expect(_toggle(tester, MapLayerId.disruption).value, isTrue);
    expect(
      container.read(layerControllerProvider).filledAreaMetric,
      MapLayerId.census,
    );
  });

  testWidgets('catalog availability is explicit and does not disable intent', (
    tester,
  ) async {
    final json = jsonDecode(
      File(
        '../specs/002-map-data-presentation/contracts/examples/catalog.sample.json',
      ).readAsStringSync(),
    ) as Map<String, dynamic>;
    final catalog = MapLayerCatalog.fromJson(json);
    await _show(tester, catalog: catalog);
    expect(find.text('Sample data — illustrative only'), findsOneWidget);
    expect(
      find.descendant(
        of: _layer(MapLayerId.pedestrian),
        matching: find.text('Data available'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: _layer(MapLayerId.event),
        matching: find.text('Coverage or result unknown'),
      ),
      findsOneWidget,
    );
    await tester.tap(_layer(MapLayerId.event));
    await tester.pump();
    expect(_toggle(tester, MapLayerId.event).value, isTrue);
    expect(find.textContaining('No matching data'), findsNothing);
  });

  testWidgets('all layers off is a selection state without a coverage claim', (
    tester,
  ) async {
    await _show(tester);
    for (final layer in [
      MapLayerId.pedestrian,
      MapLayerId.anomaly,
      MapLayerId.disruption,
    ]) {
      await tester.tap(_layer(layer));
      await tester.pump();
    }
    expect(
      find.text('No layers selected. Turn on a layer to show map data.'),
      findsOneWidget,
    );
    expect(find.textContaining('No matching data'), findsNothing);
    expect(find.text('This area or time is not covered'), findsNothing);
  });
}
