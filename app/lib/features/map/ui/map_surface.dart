import 'dart:math' as math;

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/config/maps_web_loader.dart';
import '../../../core/config/native_maps_key.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import 'layer_panel.dart';
import 'map_layer_style.dart';
import 'map_status.dart';
import 'renderers/core_renderers.dart';
import 'renderers/marker_icons.dart';

part 'map_surface.g.dart';

enum MapSurfaceReadiness { ready, missingKey, unsupportedPlatform }

Duration? _manualMapRetry(int retryCount, Object error) => null;

@Riverpod(keepAlive: true)
GoogleMapsWebApiLoader mapSurfaceApiLoader(Ref ref) => GoogleMapsWebApiLoader();

@Riverpod(keepAlive: true)
NativeMapsKey nativeMapsKey(Ref ref) => const NativeMapsKey();

/// One app-scoped SDK request precedes all platform-map construction: the
/// JavaScript API on the Web, the native key on iOS. Failed readiness remains
/// explicit until the user requests a retry.
@Riverpod(keepAlive: true, retry: _manualMapRetry)
Future<MapSurfaceReadiness> mapSurfaceReadiness(Ref ref) async {
  final env = ref.watch(envProvider);
  if (kIsWeb) {
    if (!env.hasGoogleMapsWebApiKey) return MapSurfaceReadiness.missingKey;
    await ref.watch(mapSurfaceApiLoaderProvider).load(env);
    return MapSurfaceReadiness.ready;
  }
  if (defaultTargetPlatform == TargetPlatform.iOS) {
    if (!env.hasGoogleMapsIosApiKey) return MapSurfaceReadiness.missingKey;
    await ref.watch(nativeMapsKeyProvider).provide(env.googleMapsIosApiKey);
    return MapSurfaceReadiness.ready;
  }
  return MapSurfaceReadiness.unsupportedPlatform;
}

typedef MapSurfaceBuilder = Widget Function(
  BuildContext context,
  MapSurfaceConfiguration configuration,
);

typedef MapAggregateRenderer = CoreRenderPlan Function(
  BuildContext context,
  List<AggregateMapItem> items,
  String? selectedItemId,
  ValueChanged<AggregateMapItem>? onSelected,
);

/// The test seam exposes overlays and callbacks without loading a network SDK.
final class MapSurfaceConfiguration {
  const MapSurfaceConfiguration({
    required this.initialCameraPosition,
    required this.renderPlan,
    required this.mapId,
    required this.onMapCreated,
    required this.onCameraChanged,
    required this.onCameraIdle,
    required this.onMapTap,
  });

  final CameraPosition initialCameraPosition;
  final CoreRenderPlan renderPlan;
  final String? mapId;
  final MapCreatedCallback? onMapCreated;
  final ValueChanged<CameraPosition>? onCameraChanged;
  final VoidCallback? onCameraIdle;
  final ValueChanged<LatLng>? onMapTap;
}

/// Bounded 2D surface. Root state owns camera queries and persistent selection.
/// Updating layer DTOs never recreates the platform map or moves its camera.
class MapSurface extends ConsumerWidget {
  const MapSurface({
    required this.layers,
    required this.enabledLayers,
    required this.dataMode,
    this.initialCameraPosition = const CameraPosition(
      target: LatLng(-37.8136, 144.9631),
      zoom: 14,
    ),
    this.selectedItemId,
    this.onItemSelected,
    this.onAggregateSelected,
    this.onCameraChanged,
    this.onCameraIdle,
    this.onMapCreated,
    this.onMapTap,
    this.mapBuilder,
    this.aggregateRenderer,
    this.overlay,
    this.compact = false,
    super.key,
  });

  final List<LayerResult> layers;
  final Set<MapLayerId> enabledLayers;
  final MapDataMode dataMode;
  final CameraPosition initialCameraPosition;
  final String? selectedItemId;
  final ValueChanged<MapItem>? onItemSelected;
  final ValueChanged<AggregateMapItem>? onAggregateSelected;
  final ValueChanged<CameraPosition>? onCameraChanged;
  final VoidCallback? onCameraIdle;
  final MapCreatedCallback? onMapCreated;
  final ValueChanged<LatLng>? onMapTap;
  final MapSurfaceBuilder? mapBuilder;
  final MapAggregateRenderer? aggregateRenderer;

  /// Objects drawn over the layers, such as the user events near the
  /// viewport (UC-09); they are not map records and are never selected.
  final CoreRenderPlan? overlay;

  /// Draws only the map and a data-mode label. The caller supplies the legend
  /// ([MapLegend]) and the object list ([MapObjectList]) elsewhere, so the map
  /// can fill its page.
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final env = ref.watch(envProvider);
    final readiness = ref.watch(mapSurfaceReadinessProvider);
    final items = <MapItem>[
      for (final layer in layers)
        if (enabledLayers.contains(layer.layerId))
          for (final item in layer.items)
            if (item.layerId == layer.layerId) item,
    ];

    void select(MapItem item) {
      if (item is AggregateMapItem && onAggregateSelected != null) {
        onAggregateSelected!(item);
      } else {
        onItemSelected?.call(item);
      }
    }

    var plan = buildCoreRenderPlan(
      items: items,
      colors: Theme.of(context).colorScheme,
      selectedItemId: selectedItemId,
      onSelected: onItemSelected,
      describeItem: (item) => _describeItem(strings, item),
      icons: ref.watch(mapMarkerIconsProvider(markerPixelRatio(context))).value,
    );
    final aggregates = items.whereType<AggregateMapItem>().toList(
      growable: false,
    );
    if (aggregates.isNotEmpty && aggregateRenderer != null) {
      plan = plan.merge(
        aggregateRenderer!(context, aggregates, selectedItemId, select),
      );
    }
    if (overlay != null) plan = plan.merge(overlay!);
    final configuration = MapSurfaceConfiguration(
      initialCameraPosition: initialCameraPosition,
      renderPlan: plan,
      mapId: env.googleMapsMapId.isEmpty ? null : env.googleMapsMapId,
      onMapCreated: onMapCreated,
      onCameraChanged: onCameraChanged,
      onCameraIdle: onCameraIdle,
      onMapTap: onMapTap,
    );
    final mapBody = readiness.when(
      data: (state) => switch (state) {
        MapSurfaceReadiness.ready =>
          mapBuilder?.call(context, configuration) ??
              _GoogleMapSurface(configuration: configuration),
        MapSurfaceReadiness.missingKey => _MapReadinessMessage(
          message: strings.mapSurfaceMissingKey,
        ),
        MapSurfaceReadiness.unsupportedPlatform => _MapReadinessMessage(
          message: strings.mapSurfaceNativeUnavailable,
        ),
      },
      loading: () => _MapReadinessMessage(
        message: strings.mapSurfaceLoading,
        loading: true,
      ),
      error: (error, stack) => _MapReadinessMessage(
        message: strings.mapSurfaceLoadError,
        onRetry: () => ref.invalidate(mapSurfaceReadinessProvider),
      ),
    );
    if (compact) {
      return Stack(
        fit: StackFit.expand,
        children: [
          mapBody,
          Positioned(
            left: 12,
            bottom: 12,
            child: IgnorePointer(child: MapDataModeLabel(dataMode: dataMode)),
          ),
        ],
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: math.min(144, constraints.maxHeight * 0.35),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: MapDataModeLabel(dataMode: dataMode),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    key: const ValueKey('map-surface-legend'),
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: MapLegend(enabledLayers: enabledLayers),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(child: mapBody),
          SizedBox(
            height: math.min(164, constraints.maxHeight * 0.3),
            child: MapObjectList(
              items: items,
              selectedItemId: selectedItemId,
              onSelected: onItemSelected == null && onAggregateSelected == null
                  ? null
                  : select,
            ),
          ),
        ],
      ),
    );
  }
}

/// What the map's shapes mean, each enabled layer's pin, and the scale of
/// the pedestrian circles.
class MapLegend extends StatelessWidget {
  const MapLegend({required this.enabledLayers, super.key});

  final Set<MapLayerId> enabledLayers;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(strings.mapSurfaceGeometryLegend),
        Wrap(
          spacing: 12,
          runSpacing: 4,
          children: [
            for (final layer in MapLayerId.values)
              if (enabledLayers.contains(layer))
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ExcludeSemantics(
                      child: MapLayerBadge(style: layerStyle(layer), size: 16),
                    ),
                    const SizedBox(width: 4),
                    Text(layerTitle(strings, layer)),
                  ],
                ),
          ],
        ),
        if (enabledLayers.contains(MapLayerId.pedestrian))
          Text(
            strings.mapSurfaceCountLegend(
              NumberFormat.decimalPattern('en_AU')
                  .format(passageCircleAreaSquareMeters),
            ),
          ),
      ],
    );
  }
}

class _GoogleMapSurface extends StatelessWidget {
  const _GoogleMapSurface({required this.configuration});

  final MapSurfaceConfiguration configuration;

  @override
  Widget build(BuildContext context) {
    final plan = configuration.renderPlan;
    // The pinned Maps plugin still reads Flutter's legacy Material Theme.
    // ignore: deprecated_member_use
    return MaterialUiCompatibilityBridge(
      child: GoogleMap(
        key: const ValueKey('map-surface-google-map'),
        initialCameraPosition: configuration.initialCameraPosition,
        mapId: configuration.mapId,
        markers: plan.markers,
        circles: plan.circles,
        polylines: plan.polylines,
        polygons: plan.polygons,
        onMapCreated: configuration.onMapCreated,
        onCameraMove: configuration.onCameraChanged,
        onCameraIdle: configuration.onCameraIdle,
        onTap: configuration.onMapTap,
        tiltGesturesEnabled: false,
        rotateGesturesEnabled: false,
        myLocationButtonEnabled: false,
        // Google's zoom and camera controls sit in the bottom-right corner,
        // under the app's own map buttons and chat button, and the overlap
        // reads as a smear on the Web. Wheel, pinch and double-tap zoom.
        zoomControlsEnabled: false,
        webCameraControlEnabled: false,
      ),
    );
  }
}

class _MapReadinessMessage extends StatelessWidget {
  const _MapReadinessMessage({
    required this.message,
    this.loading = false,
    this.onRetry,
  });

  final String message;
  final bool loading;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Semantics(
          liveRegion: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(message),
              if (loading)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: CircularProgressIndicator(semanticsLabel: message),
                ),
              if (onRetry != null)
                TextButton(
                  onPressed: onRetry,
                  child: Text(AppLocalizations.of(context).mapSurfaceRetry),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}

String _describeItem(AppLocalizations strings, MapItem item) {
  final description = <String>[
    if (item is AnomalyMapItem) strings.mapLayerAnomaly,
    if (item is DisruptionMapItem) ...[
      strings.mapLayerDisruption,
      switch (item.lifecycle) {
        MapLifecycle.active => strings.mapDetailActive,
        MapLifecycle.planned => strings.mapDetailPlanned,
        MapLifecycle.cancelled => strings.mapDetailCancelled,
        MapLifecycle.resolved => strings.mapDetailResolved,
        MapLifecycle.withdrawn => strings.mapDetailsWithdrawn,
      },
    ],
    if (!isDrawableMapItem(item))
      strings.mapSurfaceLocationUnavailable
    else
      switch (item.location.precision) {
        MapLocationPrecision.point => strings.mapSurfacePointLocation,
        MapLocationPrecision.line => strings.mapSurfaceLineLocation,
        MapLocationPrecision.area => strings.mapSurfaceAreaLocation,
        MapLocationPrecision.unlocated => strings.mapSurfaceLocationUnavailable,
      },
    if (item case PedestrianMapItem(:final details))
      details.totalCount == null || details.totalCount! < 0
          ? strings.mapCountUnknown
          : strings.mapSensorPassages(
              NumberFormat.decimalPattern('en_AU').format(details.totalCount),
            ),
    if (item.assertionKind == MapAssertionKind.prediction)
      strings.mapPrediction,
    if (item.assertionKind == MapAssertionKind.plan) strings.mapDetailPlan,
  ];
  return description.join(' · ');
}

/// The map's results as a list: the text alternative to the drawn shapes.
class MapObjectList extends StatelessWidget {
  const MapObjectList({
    required this.items,
    required this.selectedItemId,
    required this.onSelected,
    super.key,
  });

  final List<MapItem> items;
  final String? selectedItemId;
  final ValueChanged<MapItem>? onSelected;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return ListView.builder(
      key: const ValueKey('map-surface-objects'),
      itemCount: items.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) {
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              strings.mapSurfaceObjectList,
              style: Theme.of(context).textTheme.titleSmall,
            ),
          );
        }
        final item = items[index - 1];
        return ListTile(
          key: ValueKey('map-object:${item.id}'),
          title: Text(item.title),
          subtitle: Text(_describeItem(strings, item)),
          selected: item.id == selectedItemId,
          onTap: onSelected == null ? null : () => onSelected!(item),
        );
      },
    );
  }
}
