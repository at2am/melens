import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../data/map_repository.dart';
import '../state/selection_controller.dart';
import 'map_status.dart';

/// Place this inside bounded map constraints; the details never cover the map.
class MapDetailsLayout extends StatelessWidget {
  const MapDetailsLayout({required this.map, this.details, super.key});

  final Widget map;
  final Widget? details;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      if (details == null) return map;
      if (constraints.maxWidth >= 720) {
        return Row(
          key: const ValueKey('map-details-side-layout'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: map),
            SizedBox(width: 360, child: details),
          ],
        );
      }
      return Column(
        key: const ValueKey('map-details-bottom-layout'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: map),
          SizedBox(
            height: math.min(360, constraints.maxHeight * 0.48),
            child: details,
          ),
        ],
      );
    },
  );
}

/// A single original object remains readable independently of camera movement.
class MapDetails extends ConsumerWidget {
  const MapDetails({
    required this.state,
    required this.onClose,
    this.onRetry,
    this.onOpenSource,
    this.additionalContent,
    this.typedDetailsBuilder,
    super.key,
  });

  final MapSelectionState state;
  final VoidCallback onClose;
  final VoidCallback? onRetry;
  final ValueChanged<Uri>? onOpenSource;
  final Widget? additionalContent;
  final Widget? Function(MapItem item)? typedDetailsBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!state.hasSelection) return const SizedBox.shrink();
    final strings = AppLocalizations.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final item = state.item;
    final typedContent = item == null ? null : typedDetailsBuilder?.call(item);
    final colors = Theme.of(context).colorScheme;
    return CallbackShortcuts(
      bindings: {const SingleActivator(LogicalKeyboardKey.escape): onClose},
      child: Focus(
        autofocus: true,
        child: Semantics(
          container: true,
          label: strings.mapDetailsTitle,
          child: Material(
            color: colors.surface,
            shape: RoundedRectangleBorder(
              side: BorderSide(color: colors.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          strings.mapDetailsTitle,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      IconButton(
                        key: const ValueKey('map-details-close'),
                        tooltip: strings.mapDetailsClose,
                        onPressed: onClose,
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    key: const ValueKey('map-details-scroll'),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (state.disposition !=
                            MapSelectionDisposition.matching)
                          Semantics(
                            liveRegion: true,
                            child: Text(_dispositionText(strings, state)),
                          ),
                        if (state.aggregateId != null &&
                            state.highlightedItemId != null)
                          Semantics(
                            liveRegion: true,
                            child: Text(strings.mapDetailsInAggregate),
                          ),
                        if (state.isLoading) ...[
                          Text(strings.mapDetailsLoading),
                          LinearProgressIndicator(
                            semanticsLabel: strings.mapDetailsLoading,
                          ),
                        ],
                        if (state.detailError != null) ...[
                          Semantics(
                            liveRegion: true,
                            child: Text(
                              state.detailError is MapHttpException &&
                                      (state.detailError! as MapHttpException)
                                              .code ==
                                          MapServiceErrorCode.snapshotExpired
                                  ? strings.mapDetailsSnapshotExpired
                                  : strings.mapDetailsError,
                            ),
                          ),
                          if (item != null) Text(strings.mapRetainedData),
                          if (state.canRetry && onRetry != null)
                            TextButton(
                              onPressed: onRetry,
                              child: Text(strings.mapRetry),
                            ),
                        ],
                        if (item != null) ...[
                          Text(
                            item.title,
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          _fact(strings, strings.mapDetailIdentifier, item.id),
                          _fact(
                            strings,
                            strings.mapDetailVersion,
                            item.versionId,
                          ),
                          Text(_lifecycleText(strings, item.lifecycle)),
                          if (item.assertionKind == MapAssertionKind.plan)
                            Text(strings.mapDetailPlan),
                          Text(
                            _precisionText(strings, item.location.precision),
                          ),
                          Text(_roleText(strings, item.location.role)),
                          _fact(
                            strings,
                            strings.mapDetailLocationEvidence,
                            item.location.evidence,
                          ),
                          if (item.geometryPresentation?.simplified == true)
                            Text(strings.mapDetailSimplified),
                          const SizedBox(height: 12),
                          if (typedContent != null)
                            typedContent
                          else
                            ..._typedFacts(strings, clock, item),
                          ?additionalContent,
                          const SizedBox(height: 12),
                          MapItemProvenance(
                            time: item.time,
                            sources: item.sources,
                            assertionKind: item.assertionKind,
                            mode: state.mode,
                            dataMode: state.dataMode,
                            onOpenSource: onOpenSource,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _typedFacts(
    AppLocalizations strings,
    MelbourneClock clock,
    MapItem item,
  ) => switch (item) {
    PedestrianMapItem(:final details) => [
      _fact(strings, strings.mapDetailSensor, details.sensorId),
      MapMeasuredCount(count: details.totalCount),
      _fact(
        strings,
        strings.mapDetailDirectionA,
        _number(details.directionACount),
      ),
      _fact(
        strings,
        strings.mapDetailDirectionB,
        _number(details.directionBCount),
      ),
      Text(strings.mapDetailDirectionsUncalibrated),
      Text(
        details.granularity == PedestrianGranularity.minute
            ? strings.mapDetailMinuteGranularity
            : strings.mapDetailHourGranularity,
      ),
      Text(_locationStatusText(strings, details.locationStatus)),
      _window(strings, clock, details.window),
      _fact(
        strings,
        strings.mapDetailLocationValidFrom,
        _time(clock, details.locationValidFrom),
      ),
      _fact(
        strings,
        strings.mapDetailLocationValidTo,
        _time(clock, details.locationValidTo),
      ),
    ],
    AnomalyMapItem(:final details) => [
      _fact(strings, strings.mapDetailSensor, details.sensorId),
      _fact(strings, strings.mapDetailResult, details.resultId),
      _fact(strings, strings.mapDetailObservation, details.observationId),
      _window(strings, clock, details.window),
      _fact(
        strings,
        strings.mapDetailBaselineDefinition,
        details.baselineDefinitionId,
      ),
      _fact(
        strings,
        strings.mapDetailBaselineValue,
        _number(details.baselineValue),
      ),
      _fact(
        strings,
        strings.mapDetailObservedValue,
        _number(details.observedValue),
      ),
      _fact(strings, strings.mapDetailDelta, _number(details.delta)),
    ],
    DisruptionMapItem(:final details) => [
      _fact(strings, strings.mapDetailSummary, details.summary),
      _fact(strings, strings.mapDetailImpact, details.impact),
      _fact(
        strings,
        strings.mapDetailServices,
        details.serviceNames.isEmpty ? null : details.serviceNames.join(', '),
      ),
      Text(_eventStatusText(strings, details.status)),
      Text(_extentText(strings, details.extentKind)),
    ],
    EventMapItem(:final details) => [
      _fact(strings, strings.mapDetailSummary, details.summary),
      _fact(strings, strings.mapDetailVenue, details.venueName),
      _fact(strings, strings.mapDetailCategory, details.category),
      _fact(strings, strings.mapDetailStarts, _time(clock, details.startAt)),
      _fact(strings, strings.mapDetailEnds, _time(clock, details.endAt)),
      Text(_eventStatusText(strings, details.status)),
    ],
    PlanningMapItem(:final details) => [
      _fact(strings, strings.mapDetailSummary, details.summary),
      _fact(strings, strings.mapDetailProjectStatus, details.projectStatus),
      _fact(strings, strings.mapDetailPermit, details.permitId),
    ],
    ParkingMapItem(:final details) => [
      Text(switch (details.state) {
        ParkingState.vacant => strings.mapDetailParkingVacant,
        ParkingState.occupied => strings.mapDetailParkingOccupied,
        ParkingState.noData => strings.mapDetailParkingNoData,
      }),
      if (details.noDataReason case final reason?)
        Text(switch (reason) {
          ParkingNoDataReason.notReporting =>
            strings.mapDetailParkingNotReporting,
          ParkingNoDataReason.publicHoliday =>
            strings.mapDetailParkingPublicHoliday,
          ParkingNoDataReason.holidayUnknown =>
            strings.mapDetailParkingHolidayUnknown,
          ParkingNoDataReason.noStatus => strings.mapDetailParkingNoStatus,
        }),
      if (details.state != ParkingState.noData &&
          details.reading == ParkingReading.late)
        Text(strings.mapDetailParkingLate),
      _fact(
        strings,
        strings.mapDetailParkingLastReported,
        _time(clock, details.lastReportedAt),
      ),
      _fact(
        strings,
        strings.mapDetailParkingStatusChanged,
        _time(clock, details.statusChangedAt),
      ),
      _fact(strings, strings.mapDetailParkingZone, _number(details.zoneNumber)),
      // Shown with every sensor: occupancy is never legal permission.
      Text(strings.mapDetailParkingNotLegal),
      if (details.mayBeObstructed) Text(strings.mapDetailParkingObstruction),
    ],
    BoundaryMapItem(:final details) => [
      _fact(strings, strings.mapDetailBoundary, details.boundaryId),
      _fact(
        strings,
        strings.mapDetailBoundaryLevel,
        _boundaryLevel(details.boundaryLevel),
      ),
      _fact(strings, strings.mapDetailBoundaryVintage, details.vintage),
      _fact(strings, strings.mapDetailBoundaryName, details.name),
    ],
    NewsMapItem(:final details) => [
      _fact(strings, strings.mapDetailSummary, details.summary),
      _fact(
        strings,
        strings.mapDetailLocationEvidence,
        details.localizationEvidence,
      ),
      for (final article in details.articleRefs)
        _article(strings, clock, article),
    ],
    AreaIndicatorMapItem(:final details) => [
      _fact(strings, strings.mapDetailIndicator, details.indicatorId),
      _fact(strings, strings.mapDetailValue, _number(details.value)),
      if (details.valueState == MapValueState.missing)
        Text(strings.mapDetailValueMissing),
      if (details.valueState == MapValueState.suppressed)
        Text(strings.mapDetailValueSuppressed),
      _fact(strings, strings.mapDetailUnit, details.unit),
      Text(strings.mapStatisticalPeriod(details.periodLabel)),
      _fact(strings, strings.mapDetailPropertyType, details.propertyType),
      _fact(strings, strings.mapDetailDefinition, details.definition),
      _fact(strings, strings.mapDetailBoundary, details.boundaryId),
      _fact(strings, strings.mapDetailBoundaryVintage, details.boundaryVintage),
    ],
    AggregateMapItem(:final details) => [
      _fact(strings, strings.mapDetailMetric, details.metric.label),
      _fact(strings, strings.mapDetailValue, _number(details.metric.value)),
      _fact(strings, strings.mapDetailUnit, details.metric.unit),
      _fact(strings, strings.mapDetailDefinition, details.metric.definition),
      if (details.window != null) _window(strings, clock, details.window!),
      if (details.resultRange.totalMatching == null)
        Text(strings.mapTotalUnknown)
      else
        Text(
          strings.mapExactTotal(_number(details.resultRange.totalMatching)!),
        ),
    ],
  };

  Widget _article(
    AppLocalizations strings,
    MelbourneClock clock,
    ArticleReference article,
  ) {
    final uri = article.url == null ? null : Uri.tryParse(article.url!);
    final public =
        uri != null &&
        (uri.scheme == 'https' || uri.scheme == 'http') &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(article.title),
        if (article.reportedAt != null)
          Text(strings.mapReportedAt(_time(clock, article.reportedAt)!))
        else
          Text(strings.mapObservationTimeUnknown),
        if (public && onOpenSource != null)
          TextButton(
            onPressed: () => onOpenSource!(uri),
            child: Text(strings.mapOpenSource(article.title)),
          )
        else if (public)
          SelectableText(uri.toString())
        else
          Text(strings.mapSourceLinkUnknown),
      ],
    );
  }
}

Widget _fact(AppLocalizations strings, String label, String? value) =>
    Text(strings.mapDetailFact(label, value ?? strings.mapDetailUnknown));

String? _number(num? value) =>
    value == null ? null : NumberFormat.decimalPattern('en_AU').format(value);

String? _time(MelbourneClock clock, DateTime? value) {
  if (value == null) return null;
  final local = clock.toMelbourne(value);
  return '${DateFormat.yMMMd('en_AU').format(local)}, '
      '${DateFormat.Hm('en_AU').format(local)} ${local.timeZoneName}';
}

Widget _window(
  AppLocalizations strings,
  MelbourneClock clock,
  TimeWindow window,
) => Text(
  strings.mapObservedWindow(
    _time(clock, window.from)!,
    _time(clock, window.to)!,
  ),
);

String _dispositionText(AppLocalizations strings, MapSelectionState state) =>
    switch (state.disposition) {
      MapSelectionDisposition.matching => '',
      MapSelectionDisposition.offscreen => strings.mapDetailsOffscreen,
      MapSelectionDisposition.filterExcluded =>
        strings.mapDetailsFilterExcluded,
      MapSelectionDisposition.removed => strings.mapDetailsRemoved,
      MapSelectionDisposition.withdrawn => strings.mapDetailsWithdrawn,
    };

String _precisionText(AppLocalizations strings, MapLocationPrecision value) =>
    switch (value) {
      MapLocationPrecision.point => strings.mapDetailPointPrecision,
      MapLocationPrecision.line => strings.mapDetailLinePrecision,
      MapLocationPrecision.area => strings.mapDetailAreaPrecision,
      MapLocationPrecision.unlocated => strings.mapDetailUnlocatedPrecision,
    };

String _roleText(AppLocalizations strings, MapLocationRole value) =>
    switch (value) {
      MapLocationRole.eventSite => strings.mapDetailRoleEventSite,
      MapLocationRole.sensor => strings.mapDetailRoleSensor,
      MapLocationRole.affectedExtent => strings.mapDetailRoleAffectedExtent,
      MapLocationRole.statisticalArea => strings.mapDetailRoleStatisticalArea,
      MapLocationRole.areaAssociation => strings.mapDetailRoleAreaAssociation,
      MapLocationRole.mention => strings.mapDetailRoleMention,
      MapLocationRole.unknown => strings.mapDetailRoleUnknown,
    };

String _lifecycleText(AppLocalizations strings, MapLifecycle value) =>
    switch (value) {
      MapLifecycle.active => strings.mapDetailActive,
      MapLifecycle.planned => strings.mapDetailPlanned,
      MapLifecycle.cancelled => strings.mapDetailCancelled,
      MapLifecycle.resolved => strings.mapDetailResolved,
      MapLifecycle.withdrawn => strings.mapDetailsWithdrawn,
    };

String _eventStatusText(AppLocalizations strings, MapEventStatus value) =>
    switch (value) {
      MapEventStatus.active => strings.mapDetailActive,
      MapEventStatus.planned => strings.mapDetailPlanned,
      MapEventStatus.cancelled => strings.mapDetailCancelled,
      MapEventStatus.resolved => strings.mapDetailResolved,
      MapEventStatus.unknown => strings.mapDetailStatusUnknown,
    };

String _extentText(AppLocalizations strings, DisruptionExtentKind value) =>
    switch (value) {
      DisruptionExtentKind.roadSegment => strings.mapDetailExtentRoad,
      DisruptionExtentKind.route => strings.mapDetailExtentRoute,
      DisruptionExtentKind.stop => strings.mapDetailExtentStop,
      DisruptionExtentKind.area => strings.mapDetailExtentArea,
      DisruptionExtentKind.unknown => strings.mapDetailExtentUnknown,
    };

String _locationStatusText(
  AppLocalizations strings,
  PedestrianLocationStatus value,
) => switch (value) {
  PedestrianLocationStatus.located => strings.mapDetailLocationLocated,
  PedestrianLocationStatus.unlocated => strings.mapDetailLocationUnlocated,
  PedestrianLocationStatus.ambiguous => strings.mapDetailLocationAmbiguous,
  PedestrianLocationStatus.inactive => strings.mapDetailLocationInactive,
};

String _boundaryLevel(MapBoundaryLevel value) => switch (value) {
  MapBoundaryLevel.gccsa => 'GCCSA',
  MapBoundaryLevel.lga => 'LGA',
  MapBoundaryLevel.sa2 => 'SA2',
  MapBoundaryLevel.ste => 'STE',
  MapBoundaryLevel.clueBlock => 'CLUE_BLOCK',
  MapBoundaryLevel.municipal => 'MUNICIPAL',
};
