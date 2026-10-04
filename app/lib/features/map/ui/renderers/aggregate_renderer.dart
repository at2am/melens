import 'dart:async';
import 'dart:ui' as ui;

import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../../l10n/app_localizations.dart';
import '../../data/map_models.dart';
import 'core_renderers.dart';

typedef AggregateRenderBuilder = CoreRenderPlan Function(
  BuildContext context,
  List<AggregateMapItem> items,
  String? selectedItemId,
  ValueChanged<AggregateMapItem>? onSelected,
);

bool aggregateHasUnknownTotal(AggregateMapItem item) =>
    item.details.resultRange.totalMatching == null ||
    item.details.resultRange.returnedCount <
        item.details.resultRange.totalMatching!;

bool aggregateRepresentsSelection(AggregateMapItem item, String? selectedId) =>
    selectedId != null &&
    (item.id == selectedId || item.details.memberIds.contains(selectedId));

String _symbolKey(AggregateMapItem item, String? selectedId) =>
    '${item.details.resultRange.returnedCount}:'
    '${aggregateHasUnknownTotal(item)}:${aggregateRepresentsSelection(item, selectedId)}';

/// Anchors a group to a supplied original point, never an invented centroid.
CoreRenderPlan buildAggregateRenderPlan(
  BuildContext context,
  List<AggregateMapItem> items,
  String? selectedItemId,
  ValueChanged<AggregateMapItem>? onSelected, {
  Map<String, BitmapDescriptor> icons = const {},
  ValueChanged<MapBounds>? onZoomToBounds,
}) {
  final strings = AppLocalizations.of(context);
  final colors = Theme.of(context).colorScheme;
  var plan = const CoreRenderPlan.empty();
  for (final item in items) {
    if (item.details.representation != AggregateRepresentation.cluster ||
        !isDrawableMapItem(item)) {
      continue;
    }
    final count = NumberFormat.decimalPattern('en_AU')
        .format(item.details.resultRange.returnedCount);
    final label = strings.mapAggregateLoadedRecords(count);
    final metric = item.details.metric;
    final description = metric.value == null
        ? strings.mapAggregateMetricUnknown(metric.label, metric.unit)
        : strings.mapAggregateMetric(
            metric.label,
            NumberFormat.decimalPattern('en_AU').format(metric.value),
            metric.unit,
          );
    final snippet =
        '$description · '
        '${aggregateHasUnknownTotal(item) ? strings.mapAggregateLoadedOnly : label}';
    void select() {
      onSelected?.call(item);
      onZoomToBounds?.call(item.details.bounds);
    }

    final geometry = item.geometry;
    final point = switch (geometry) {
      GeoJsonPoint(:final coordinates) => coordinates,
      GeoJsonMultiPoint(:final coordinates) => coordinates.first,
      _ => null,
    };
    if (point != null) {
      final icon = icons[_symbolKey(item, selectedItemId)];
      plan = plan.merge(
        CoreRenderPlan(
          markers: {
            Marker(
              markerId: MarkerId('${item.id}:aggregate'),
              position: LatLng(point[1], point[0]),
              icon: icon ?? BitmapDescriptor.defaultMarker,
              anchor: icon == null
                  ? const Offset(0.5, 1)
                  : const Offset(0.5, 0.5),
              infoWindow: InfoWindow(
                title: label,
                snippet: snippet,
                onTap: select,
              ),
              onTap: select,
              consumeTapEvents: true,
              zIndexInt: aggregateRepresentsSelection(item, selectedItemId)
                  ? 4
                  : 3,
            ),
          },
        ),
      );
    } else if (geometry != null) {
      plan = plan.merge(
        buildGeometryRenderPlan(
          id: '${item.id}:aggregate',
          geometry: geometry,
          title: label,
          description: snippet,
          color: colors.primary,
          selected: aggregateRepresentsSelection(item, selectedItemId),
          onTap: select,
        ),
      );
    }
  }
  return plan;
}

/// Supplies count bitmaps to MapSurface's synchronous aggregate-renderer hook.
/// No advanced-marker Map ID, private map handle or platform map is required.
class AggregateRenderLayer extends StatefulWidget {
  const AggregateRenderLayer({
    required this.items,
    required this.builder,
    this.selectedItemId,
    this.onZoomToBounds,
    super.key,
  });

  final List<AggregateMapItem> items;
  final String? selectedItemId;
  final ValueChanged<MapBounds>? onZoomToBounds;
  final Widget Function(BuildContext context, AggregateRenderBuilder render)
  builder;

  @override
  State<AggregateRenderLayer> createState() => _AggregateRenderLayerState();
}

class _AggregateRenderLayerState extends State<AggregateRenderLayer> {
  Map<String, BitmapDescriptor> _icons = const {};
  int _generation = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    unawaited(_prepare());
  }

  @override
  void didUpdateWidget(AggregateRenderLayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.items != widget.items ||
        oldWidget.selectedItemId != widget.selectedItemId) {
      _icons = const {};
      unawaited(_prepare());
    }
  }

  Future<void> _prepare() async {
    final generation = ++_generation;
    final colors = Theme.of(context).colorScheme;
    final strings = AppLocalizations.of(context);
    final ratio = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 2.0);
    final style = Theme.of(context).textTheme.labelLarge ?? const TextStyle();
    final symbols = <String, BitmapDescriptor>{};
    for (final item in widget.items) {
      if (!mounted || generation != _generation) return;
      if (item.details.representation != AggregateRepresentation.cluster ||
          !isDrawableMapItem(item)) {
        continue;
      }
      final key = _symbolKey(item, widget.selectedItemId);
      if (symbols.containsKey(key)) continue;
      // The remaining groups still have their exact count in their public
      // info window and accessible details; raster work never grows unbounded.
      if (symbols.length == 128) break;
      final count = NumberFormat.decimalPattern('en_AU')
          .format(item.details.resultRange.returnedCount);
      final selected = aggregateRepresentsSelection(
        item,
        widget.selectedItemId,
      );
      try {
        symbols[key] = await _countBitmap(
          count: '$count${aggregateHasUnknownTotal(item) ? '*' : ''}',
          unit: strings.mapAggregateBadgeRecords,
          ratio: ratio,
          style: style,
          background: selected ? colors.primary : colors.primaryContainer,
          foreground: selected ? colors.onPrimary : colors.onPrimaryContainer,
          border: colors.outline,
        );
      } catch (_) {
        // Keep the public marker and readable details if rasterization fails.
      }
    }
    if (mounted && generation == _generation) {
      setState(() => _icons = symbols);
    }
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(
    context,
    (context, items, selectedId, onSelected) => buildAggregateRenderPlan(
      context,
      items,
      selectedId,
      onSelected,
      icons: _icons,
      onZoomToBounds: widget.onZoomToBounds,
    ),
  );
}

Future<BitmapDescriptor> _countBitmap({
  required String count,
  required String unit,
  required double ratio,
  required TextStyle style,
  required Color background,
  required Color foreground,
  required Color border,
}) async {
  const size = Size(88, 52);
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..scale(ratio);
  final shape = RRect.fromRectAndRadius(
    const Rect.fromLTWH(1, 1, 86, 50),
    const Radius.circular(24),
  );
  canvas.drawRRect(shape, Paint()..color = background);
  canvas.drawRRect(
    shape,
    Paint()
      ..color = border
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2,
  );
  final text = TextPainter(
    text: TextSpan(
      children: [
        TextSpan(
          text: '$count\n',
          style: style.copyWith(
            color: foreground,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        TextSpan(
          text: unit,
          style: style.copyWith(color: foreground, fontSize: 11),
        ),
      ],
    ),
    textDirection: ui.TextDirection.ltr,
    textAlign: TextAlign.center,
    maxLines: 2,
  )..layout(maxWidth: 78);
  text.paint(
    canvas,
    Offset((size.width - text.width) / 2, (size.height - text.height) / 2),
  );
  text.dispose();
  final picture = recorder.endRecording();
  try {
    final image = await picture.toImage(
      (size.width * ratio).round(),
      (size.height * ratio).round(),
    );
    try {
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) throw StateError('Count symbol unavailable');
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
