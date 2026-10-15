import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/config/env.dart';
import '../../../l10n/app_localizations.dart';
import '../../map/data/map_models.dart';
import '../../map/state/viewport_controller.dart';
import '../../map/ui/map_surface.dart';
import '../data/melbourne_areas.dart';
import '../state/feed_providers.dart';

/// The space between the map's edge and the frame the user fills.
const _frameInset = 24.0;

/// A map the user moves and zooms until the frame covers the area a feed
/// should follow. Pops the framed box, already cut to the service area.
class AreaPickerScreen extends ConsumerStatefulWidget {
  const AreaPickerScreen({this.initial, super.key});

  /// The box to start from; the city centre when null.
  final MapBounds? initial;

  @override
  ConsumerState<AreaPickerScreen> createState() => _AreaPickerScreenState();
}

class _AreaPickerScreenState extends ConsumerState<AreaPickerScreen> {
  GoogleMapController? _map;
  Size? _mapSize;

  Future<void> _onMapCreated(GoogleMapController controller) async {
    _map = controller;
    final start = widget.initial ?? melbourneAreaById(cbdAreaId)!.bounds;
    await controller.moveCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(start.south, start.west),
          northeast: LatLng(start.north, start.east),
        ),
        _frameInset,
      ),
    );
  }

  Future<MapBounds?> _visibleRegion() async {
    final reader = ref.read(areaPickerRegionReaderProvider);
    if (reader != null) return reader();
    final region = await _map?.getVisibleRegion();
    if (region == null) return null;
    return MapBounds(
      west: region.southwest.longitude,
      south: region.southwest.latitude,
      east: region.northeast.longitude,
      north: region.northeast.latitude,
    );
  }

  Future<void> _confirm() async {
    final strings = AppLocalizations.of(context);
    final visible = await _visibleRegion();
    if (!mounted || visible == null) return;
    final framed = boundedViewportRegion(_insideFrame(visible));
    if (framed == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(strings.feedAreaPickerOutside)));
      return;
    }
    Navigator.of(context).pop(framed);
  }

  /// The visible region less the frame's inset on every side. At city scale
  /// degrees are close enough to linear for this.
  MapBounds _insideFrame(MapBounds visible) {
    final size = _mapSize;
    if (size == null || size.width <= 2 * _frameInset) return visible;
    final x = _frameInset / size.width * (visible.east - visible.west);
    final y = _frameInset / size.height * (visible.north - visible.south);
    return MapBounds(
      west: visible.west + x,
      south: visible.south + y,
      east: visible.east - x,
      north: visible.north - y,
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final env = ref.watch(envProvider);
    return Scaffold(
      appBar: AppBar(title: Text(strings.feedAreaPickerTitle)),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                _mapSize = constraints.biggest;
                return Stack(
                  fit: StackFit.expand,
                  children: [
                    MapSurface(
                      key: const ValueKey('feed-area-map'),
                      layers: const [],
                      enabledLayers: const {},
                      dataMode: env.mapDataMode,
                      compact: true,
                      onMapCreated: (controller) =>
                          unawaited(_onMapCreated(controller)),
                    ),
                    IgnorePointer(
                      child: Padding(
                        padding: const EdgeInsets.all(_frameInset),
                        child: DecoratedBox(
                          key: const ValueKey('feed-area-frame'),
                          decoration: BoxDecoration(
                            border: Border.all(
                              color: theme.colorScheme.primary,
                              width: 3,
                            ),
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(strings.feedAreaPickerHint),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    key: const ValueKey('feed-area-use'),
                    onPressed: () => unawaited(_confirm()),
                    icon: const Icon(Icons.check),
                    label: Text(strings.feedAreaPickerUse),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
