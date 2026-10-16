import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../data/map_repository.dart';

/// Empty items never establish coverage. Guard direct, non-decoded DTOs too.
MapLayerState layerStateForPresentation(LayerResult layer) {
  if (layer.state != MapLayerState.noMatching) return layer.state;
  final coverage = layer.coverage;
  final window = coverage.window;
  final verified =
      layer.completeness == MapCompleteness.complete &&
      layer.items.isEmpty &&
      layer.nextCursor == null &&
      layer.totalMatching == 0 &&
      layer.unresolvedCount == 0 &&
      coverage.state == MapCoverageState.verified &&
      coverage.areaRefs.isNotEmpty &&
      coverage.evidenceSourceIds.isNotEmpty &&
      window != null &&
      window.from.isBefore(window.to);
  return verified ? MapLayerState.noMatching : MapLayerState.unknown;
}

String _localTime(MelbourneClock clock, DateTime value) {
  final local = clock.toMelbourne(value);
  return '${DateFormat.yMMMd('en_AU').format(local)}, '
      '${DateFormat.Hm('en_AU').format(local)} ${local.timeZoneName}';
}

String _layerTitle(AppLocalizations strings, MapLayerId layer) =>
    switch (layer) {
      MapLayerId.pedestrian => strings.mapLayerPedestrian,
      MapLayerId.anomaly => strings.mapLayerAnomaly,
      MapLayerId.disruption => strings.mapLayerDisruption,
      MapLayerId.event => strings.mapLayerEvent,
      MapLayerId.planning => strings.mapLayerPlanning,
      MapLayerId.boundary => strings.mapLayerBoundary,
      MapLayerId.news => strings.mapLayerNews,
      MapLayerId.rent => strings.mapLayerRent,
      MapLayerId.census => strings.mapLayerCensus,
      MapLayerId.parking => strings.mapLayerParking,
    };

String _stateText(AppLocalizations strings, MapLayerState state) =>
    switch (state) {
      MapLayerState.available => strings.mapStatusAvailable,
      MapLayerState.noMatching => strings.mapStatusNoMatching,
      MapLayerState.notCovered => strings.mapStatusNotCovered,
      MapLayerState.unavailable => strings.mapStatusUnavailable,
      MapLayerState.unknown => strings.mapStatusUnknown,
    };

String _freshnessText(AppLocalizations strings, MapFreshness freshness) =>
    switch (freshness) {
      MapFreshness.current => strings.mapFreshnessCurrent,
      MapFreshness.late => strings.mapFreshnessLate,
      MapFreshness.stale => strings.mapFreshnessStale,
      MapFreshness.versioned => strings.mapFreshnessVersioned,
      MapFreshness.unknown => strings.mapFreshnessUnknown,
    };

/// A reusable status surface; retained data keeps its original dates on failure.
class MapLayerStatus extends ConsumerWidget {
  const MapLayerStatus({
    required this.layerId,
    required this.result,
    required this.mode,
    required this.dataMode,
    this.onRetry,
    super.key,
  });

  final MapLayerId layerId;
  final AsyncValue<LayerResult> result;
  final MapQueryMode mode;
  final MapDataMode dataMode;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final layer = result.value;
    final error = result.error;
    final retryable = error is MapRepositoryException && error.retryable;
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      container: true,
      liveRegion: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surfaceContainerLow,
          border: Border.all(color: colors.outlineVariant),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _layerTitle(strings, layerId),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              MapDataModeLabel(dataMode: dataMode),
              if (mode == MapQueryMode.historical)
                Text(strings.mapHistoricalData),
              if (result.isLoading) ...[
                Text(
                  layer == null
                      ? strings.mapStatusLoading
                      : strings.mapStatusRefreshing,
                ),
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  semanticsLabel: layer == null
                      ? strings.mapStatusLoading
                      : strings.mapStatusRefreshing,
                ),
              ],
              if (result.hasError) ...[
                Text(strings.mapStatusClientError),
                if (layer != null) Text(strings.mapRetainedData),
                if (retryable && onRetry != null)
                  TextButton(onPressed: onRetry, child: Text(strings.mapRetry)),
              ],
              if (layer != null) ...[
                Text(_stateText(strings, layerStateForPresentation(layer))),
                Text(_freshnessText(strings, layer.freshness)),
                if (layer.completeness == MapCompleteness.partial)
                  Text(strings.mapPartialScope),
                if (layer.totalMatching != null)
                  Text(
                    strings.mapExactTotal(
                      NumberFormat.decimalPattern('en_AU')
                          .format(layer.totalMatching),
                    ),
                  )
                else
                  Text(strings.mapTotalUnknown),
                Text(
                  layer.updatedAt == null
                      ? strings.mapUpdatedUnknown
                      : strings.mapUpdatedAt(
                          _localTime(clock, layer.updatedAt!),
                        ),
                ),
                if (layer.observedWindow case final window?)
                  Text(
                    strings.mapObservedWindow(
                      _localTime(clock, window.from),
                      _localTime(clock, window.to),
                    ),
                  )
                else
                  Text(strings.mapObservedWindowUnknown),
                if (layer.unresolvedCount case final count? when count > 0)
                  Text(
                    strings.mapUnlocatedCount(
                      NumberFormat.decimalPattern('en_AU').format(count),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Use this beside every sample map surface, including retained sample results.
class MapDataModeLabel extends StatelessWidget {
  const MapDataModeLabel({required this.dataMode, super.key});

  final MapDataMode dataMode;

  @override
  Widget build(BuildContext context) {
    if (dataMode != MapDataMode.sample) return const SizedBox.shrink();
    return Text(
      AppLocalizations.of(context).mapSampleData,
      style: Theme.of(context).textTheme.labelLarge,
    );
  }
}

/// Exact sensor passages stay readable independently of circles or animation.
class MapMeasuredCount extends StatelessWidget {
  const MapMeasuredCount({required this.count, super.key});

  final int? count;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    return Text(
      count == null
          ? strings.mapCountUnknown
          : strings.mapSensorPassages(
              NumberFormat.decimalPattern('en_AU').format(count),
            ),
    );
  }
}

/// Only public sources and source clock text are displayed; no time is guessed.
class MapItemProvenance extends ConsumerWidget {
  const MapItemProvenance({
    required this.time,
    required this.sources,
    required this.assertionKind,
    required this.mode,
    required this.dataMode,
    this.onOpenSource,
    this.showSourceVersions = true,
    super.key,
  });

  final MapItemTime time;
  final List<MapSource> sources;
  final MapAssertionKind assertionKind;
  final MapQueryMode mode;
  final MapDataMode dataMode;
  final void Function(Uri)? onOpenSource;

  /// False when the caller lists source version refs elsewhere, such as the
  /// selected-record panel's technical section.
  final bool showSourceVersions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final clock = ref.watch(melbourneClockProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        MapDataModeLabel(dataMode: dataMode),
        if (mode == MapQueryMode.historical) Text(strings.mapHistoricalData),
        if (assertionKind == MapAssertionKind.prediction)
          Text(strings.mapPrediction),
        if (time.periodLabel case final period?)
          Text(strings.mapStatisticalPeriod(period)),
        if (time.observedAt case final observed?)
          Text(strings.mapObservedAt(_localTime(clock, observed))),
        if (time.reportedAt case final reported?)
          Text(strings.mapReportedAt(_localTime(clock, reported))),
        if (time.observedAt == null &&
            time.reportedAt == null &&
            time.periodLabel == null &&
            time.validFrom == null)
          Text(strings.mapObservationTimeUnknown),
        if (time.validFrom case final from?)
          Text(strings.mapValidFrom(_localTime(clock, from))),
        if (time.validTo case final to?)
          Text(strings.mapValidTo(_localTime(clock, to))),
        if (time.sourceTimeText case final sourceTime?)
          Text(
            time.sourceTimezone == null
                ? strings.mapSourceTimeUnknownZone(sourceTime)
                : strings.mapSourceTime(sourceTime, time.sourceTimezone!),
          ),
        Text(
          time.fetchedAt == null
              ? strings.mapRetrievedUnknown
              : strings.mapRetrievedAt(_localTime(clock, time.fetchedAt!)),
        ),
        if (sources.isEmpty) Text(strings.mapSourceUnknown),
        for (final source in sources) ...[
          _PublicSource(source: source, onOpenSource: onOpenSource),
          if (showSourceVersions)
            if (source.versionRef case final version?)
              Text(strings.mapSourceVersion(version)),
        ],
      ],
    );
  }
}

class _PublicSource extends StatelessWidget {
  const _PublicSource({required this.source, this.onOpenSource});

  final MapSource source;
  final void Function(Uri)? onOpenSource;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final uri = source.url == null ? null : Uri.tryParse(source.url!);
    final publicUri =
        uri != null &&
        (uri.scheme == 'https' || uri.scheme == 'http') &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(strings.mapSourceAttribution(source.attribution)),
        if (publicUri && onOpenSource != null)
          TextButton(
            onPressed: () => onOpenSource!(uri),
            child: Text(strings.mapOpenSource(source.attribution)),
          )
        else if (publicUri)
          SelectableText(uri.toString())
        else
          Text(strings.mapSourceLinkUnknown),
      ],
    );
  }
}
