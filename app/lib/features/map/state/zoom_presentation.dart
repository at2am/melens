import 'zoom_policy.dart';

/// Captures the real camera and the stable granularity used by one request.
///
/// Frozen map contract v1 has `zoom`, without a separate zoom-band field. The
/// request therefore sends one representative zoom inside the active nominal
/// band. Server grouping uses the same fixed scale for each band. Camera zoom
/// and viewport bounds remain real, and the request's presentation zoom remains
/// part of the server snapshot identity for any continuation.
final class ZoomPresentation {
  const ZoomPresentation._({required this.cameraZoom, required this.band});

  factory ZoomPresentation.initial(double cameraZoom) => ZoomPresentation._(
    cameraZoom: cameraZoom,
    band: ZoomPolicy.nominalBand(cameraZoom),
  );

  final double cameraZoom;
  final ZoomBand band;

  /// The values match the server's overview/district/neighbourhood/close scale.
  /// They represent presentation granularity, never the actual camera position.
  double get requestZoom => switch (band) {
    ZoomBand.overview => 10,
    ZoomBand.district => 12,
    ZoomBand.neighbourhood => 15,
    ZoomBand.closeUp => 18,
  };

  ZoomPresentation at(double cameraZoom) => ZoomPresentation._(
    cameraZoom: cameraZoom,
    band: ZoomPolicy.bandFor(cameraZoom, previousBand: band),
  );
}
