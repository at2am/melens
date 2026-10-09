import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/time/melbourne_time.dart';
import '../../agent/data/agent_models.dart';
import '../../map/data/map_models.dart';
import '../../map/state/layer_controller.dart';
import '../../map/state/selection_controller.dart';
import '../../map/state/viewport_controller.dart';

part 'request_context.g.dart';

typedef RequestContextBuilder = RequestContext Function({String? openCardId});

/// The Melbourne CBD at the map's initial camera, used until the map has
/// reported a visible region, so the agent still has a sensible "here".
const defaultRequestViewport = AgentViewport(
  north: -37.795,
  south: -37.832,
  east: 144.990,
  west: 144.936,
);

/// Builds the per-turn context from the map state (agent-protocol.md,
/// Request). The app is the source of truth for what is on screen, so this
/// reads the controllers at send time rather than caching anything.
RequestContext buildRequestContext({
  required ViewportState viewport,
  required LayerSelectionState layers,
  required MapSelectionState selection,
  required MelbourneClock clock,
  String? openCardId,
  AgentLatLng? userLocation,
}) {
  final bbox = viewport.bbox;
  final box = bbox == null
      ? defaultRequestViewport
      : AgentViewport(
          north: bbox.north,
          south: bbox.south,
          east: bbox.east,
          west: bbox.west,
        );
  final selectedId = selection.selectedItemId;
  return RequestContext(
    viewport: box,
    zoom: viewport.zoom.clamp(0, 22).toDouble(),
    userLocation: userLocation,
    selected: selectedId == null
        ? null
        : SelectedContext(
            featureId: selectedId,
            point: pointOfGeometry(selection.item?.geometry),
          ),
    layers: layers.enabledLayerIds.map((layer) => layer.name).toList(),
    openCardId: openCardId,
    localTime: clock.now().toProtocolString(),
  );
}

/// A point geometry as a protocol point; lines and areas have no single
/// point the agent should assume.
AgentLatLng? pointOfGeometry(GeoJsonGeometry? geometry) {
  if (geometry is! GeoJsonPoint || geometry.coordinates.length < 2) {
    return null;
  }
  return AgentLatLng(
    lat: geometry.coordinates[1],
    lng: geometry.coordinates[0],
  );
}

/// Tests override this to send a fixed context.
@Riverpod(keepAlive: true)
RequestContextBuilder requestContextBuilder(Ref ref) =>
    ({String? openCardId}) => buildRequestContext(
      viewport: ref.read(viewportControllerProvider),
      layers: ref.read(layerControllerProvider),
      selection: ref.read(selectionControllerProvider),
      clock: ref.read(melbourneClockProvider),
      openCardId: openCardId,
    );
