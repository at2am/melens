/// Presentation granularity, from the widest view to the closest view.
///
/// A closer band does not grant finer source precision. Statistical areas keep
/// their original geography, and dense or same-location objects may stay grouped.
enum ZoomBand { overview, district, neighbourhood, closeUp }

/// Pure zoom classification shared by camera state and presentation decisions.
///
/// Call [nominalBand] when opening a map, or [bandFor] without a previous band.
/// Retain the returned band between camera updates to apply hysteresis. This
/// policy does not change geometry, membership or the selected object's identity.
abstract final class ZoomPolicy {
  static const double minimumZoom = 0;
  static const double maximumZoom = 22;
  static const double hysteresis = 0.2;

  static const List<double> _boundaries = [11, 14, 17];

  /// Classifies the first view using the unbuffered nominal boundaries.
  ///
  /// Throws [ArgumentError] for nonfinite zoom or values outside 0–22.
  static ZoomBand nominalBand(double zoom) {
    _validateZoom(zoom);
    return _nominalBand(zoom);
  }

  /// Applies the 0.2 buffer to every boundary crossed from [previousBand].
  ///
  /// Moving closer requires strictly more than boundary + 0.2; moving farther
  /// requires strictly less than boundary - 0.2. At either buffered boundary the
  /// current band is retained. A camera jump may cross several bands at once.
  /// Without [previousBand], the initial view uses nominal classification.
  /// Throws [ArgumentError] for nonfinite zoom or values outside 0–22.
  static ZoomBand bandFor(double zoom, {ZoomBand? previousBand}) {
    _validateZoom(zoom);
    if (previousBand == null) return _nominalBand(zoom);

    var bandIndex = previousBand.index;
    while (bandIndex < _boundaries.length &&
        zoom > _boundaries[bandIndex] + hysteresis) {
      bandIndex++;
    }
    while (bandIndex > 0 && zoom < _boundaries[bandIndex - 1] - hysteresis) {
      bandIndex--;
    }
    return ZoomBand.values[bandIndex];
  }

  static ZoomBand _nominalBand(double zoom) {
    if (zoom < 11) return ZoomBand.overview;
    if (zoom < 14) return ZoomBand.district;
    if (zoom < 17) return ZoomBand.neighbourhood;
    return ZoomBand.closeUp;
  }

  static void _validateZoom(double zoom) {
    if (!zoom.isFinite || zoom < minimumZoom || zoom > maximumZoom) {
      throw ArgumentError.value(
        zoom,
        'zoom',
        'Must be finite and within 0–22.',
      );
    }
  }
}
