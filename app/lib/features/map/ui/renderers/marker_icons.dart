import 'dart:ui' as ui;

import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:material_ui/material_ui.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../data/map_models.dart';
import '../map_layer_style.dart';

part 'marker_icons.g.dart';

/// Every pin the map draws, one bitmap per kind of object. The Maps plugin
/// compares icons by identity, so a set is built once per pixel ratio and
/// reused: a new icon per build would re-apply every marker on each rebuild.
final class MapMarkerIcons {
  const MapMarkerIcons({
    required this._layers,
    required this._selectedLayers,
    required this.community,
    required this.routeStart,
    required this.routeEnd,
    required this.routeStop,
    required this.focus,
    required this.userLocation,
    required this.userLocationAnchor,
  });

  final Map<MapLayerId, BitmapDescriptor> _layers;
  final Map<MapLayerId, BitmapDescriptor> _selectedLayers;
  final BitmapDescriptor community;
  final BitmapDescriptor routeStart;
  final BitmapDescriptor routeEnd;
  final BitmapDescriptor routeStop;

  /// The place opened from a card or a plan stop.
  final BitmapDescriptor focus;
  final BitmapDescriptor userLocation;
  final Offset userLocationAnchor;

  /// The pin for a point of [layer]; a selected one is larger, ringed and
  /// haloed.
  BitmapDescriptor layer(MapLayerId layer, {bool selected = false}) =>
      (selected ? _selectedLayers : _layers)[layer] ??
      BitmapDescriptor.defaultMarker;

  /// Plain pins tinted to each style's hue, used until the bitmaps are drawn
  /// and if drawing them fails.
  static final MapMarkerIcons fallback = () {
    BitmapDescriptor tinted(MapMarkerStyle style) =>
        BitmapDescriptor.defaultMarkerWithHue(
          HSVColor.fromColor(style.color).hue,
        );
    final layers = {
      for (final layer in MapLayerId.values) layer: tinted(layerStyle(layer)),
    };
    return MapMarkerIcons(
      layers: layers,
      selectedLayers: layers,
      community: tinted(communityEventStyle),
      routeStart: tinted(routeStartStyle),
      routeEnd: tinted(routeEndStyle),
      routeStop: tinted(routeStopStyle),
      focus: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueYellow),
      userLocation: BitmapDescriptor.defaultMarkerWithHue(
        BitmapDescriptor.hueAzure,
      ),
      userLocationAnchor: const Offset(0.5, 1),
    );
  }();
}

/// The drawn pins for one device pixel ratio. Callers show
/// [MapMarkerIcons.fallback] while this loads or if it fails.
@Riverpod(keepAlive: true)
Future<MapMarkerIcons> mapMarkerIcons(Ref ref, double pixelRatio) async {
  final layers = <MapLayerId, BitmapDescriptor>{};
  final selectedLayers = <MapLayerId, BitmapDescriptor>{};
  for (final layer in MapLayerId.values) {
    final style = layerStyle(layer);
    layers[layer] = await _pinBitmap(style, pixelRatio);
    selectedLayers[layer] = await _pinBitmap(style, pixelRatio, selected: true);
  }
  return MapMarkerIcons(
    layers: layers,
    selectedLayers: selectedLayers,
    community: await _pinBitmap(communityEventStyle, pixelRatio),
    routeStart: await _pinBitmap(routeStartStyle, pixelRatio),
    routeEnd: await _pinBitmap(routeEndStyle, pixelRatio),
    routeStop: await _pinBitmap(routeStopStyle, pixelRatio),
    focus: await _pinBitmap(
      focusStyle,
      pixelRatio,
      selected: true,
      scale: 1.7,
      halo: focusHaloColor,
    ),
    userLocation: await _userDotBitmap(pixelRatio),
    userLocationAnchor: const Offset(0.5, 0.5),
  );
}

/// The device pixel ratio the icons are drawn at: clamped and rounded to a
/// half so a window resize does not redraw them for every fractional ratio.
double markerPixelRatio(BuildContext context) =>
    (MediaQuery.devicePixelRatioOf(context).clamp(1.0, 3.0) * 2).round() / 2;

/// A round badge with the style's glyph over a short tail whose tip marks
/// the point; a selected pin is larger, carries a dark ring and sits in a
/// halo of its colour, or of [halo]. The halo widens the bitmap at the top
/// and sides only, so the tip stays at the bottom like every other pin.
Future<BitmapDescriptor> _pinBitmap(
  MapMarkerStyle style,
  double ratio, {
  bool selected = false,
  double scale = 1.5,
  Color? halo,
}) {
  if (!selected) scale = 1.0;
  final pad = selected ? 7.0 : 0.0;
  final size = Size((36 + 2 * pad) * scale, (46 + pad) * scale);
  return _rasterize(size, ratio, (canvas) {
    canvas
      ..scale(scale)
      ..translate(pad, pad);
    const center = Offset(18, 18);
    const radius = 15.0;
    final tail = Path()
      ..moveTo(11, 28)
      ..lineTo(18, 44)
      ..lineTo(25, 28)
      ..close();
    if (selected) {
      canvas.drawCircle(
        center,
        radius + 2 + pad,
        Paint()..color = (halo ?? style.color).withValues(alpha: 0.35),
      );
    }
    final shadow = Paint()
      ..color = Colors.black.withValues(alpha: 0.3)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 1.5);
    canvas
      ..drawCircle(center.translate(0, 1), radius + 2, shadow)
      ..drawPath(tail.shift(const Offset(0, 1)), shadow);
    final white = Paint()..color = Colors.white;
    canvas
      ..drawPath(tail, white)
      ..drawCircle(center, radius + 2, white);
    final fill = Paint()..color = style.color;
    canvas
      ..drawPath(
        Path()
          ..moveTo(13, 28)
          ..lineTo(18, 40)
          ..lineTo(23, 28)
          ..close(),
        fill,
      )
      ..drawCircle(center, radius, fill);
    if (selected) {
      canvas.drawCircle(
        center,
        radius + 2,
        Paint()
          ..color = Colors.black87
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }
    _paintGlyph(canvas, style.icon, center, 18);
  });
}

/// A blue dot with a white rim and a soft halo, centred on the position.
Future<BitmapDescriptor> _userDotBitmap(double ratio) =>
    _rasterize(const Size(28, 28), ratio, (canvas) {
      const center = Offset(14, 14);
      canvas
        ..drawCircle(
          center,
          13,
          Paint()..color = userLocationColor.withValues(alpha: 0.2),
        )
        ..drawCircle(center, 8, Paint()..color = Colors.white)
        ..drawCircle(center, 6, Paint()..color = userLocationColor);
    });

void _paintGlyph(Canvas canvas, IconData icon, Offset center, double size) {
  final glyph = TextPainter(
    text: TextSpan(
      text: String.fromCharCode(icon.codePoint),
      style: TextStyle(
        fontFamily: icon.fontFamily,
        package: icon.fontPackage,
        fontSize: size,
        height: 1,
        color: Colors.white,
      ),
    ),
    textDirection: ui.TextDirection.ltr,
  )..layout();
  glyph.paint(canvas, center - Offset(glyph.width / 2, glyph.height / 2));
  glyph.dispose();
}

Future<BitmapDescriptor> _rasterize(
  Size size,
  double ratio,
  void Function(Canvas canvas) paint,
) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..scale(ratio);
  paint(canvas);
  final picture = recorder.endRecording();
  try {
    final image = await picture.toImage(
      (size.width * ratio).ceil(),
      (size.height * ratio).ceil(),
    );
    try {
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) throw StateError('Marker icon unavailable');
      return BitmapDescriptor.bytes(
        bytes.buffer.asUint8List(),
        width: size.width,
        height: size.height,
      );
    } finally {
      image.dispose();
    }
  } finally {
    picture.dispose();
  }
}
