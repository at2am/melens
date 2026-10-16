import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../data/map_repository.dart';
import '../data/source_summaries.dart';
import '../state/selection_controller.dart';
import 'anomaly_details.dart';
import 'layer_panel.dart';
import 'map_detail_parts.dart';
import 'map_layer_style.dart';
import 'map_status.dart';
import 'renderers/aggregate_renderer.dart';

/// Place this inside bounded map constraints; the details never cover the map.
class MapDetailsLayout extends StatelessWidget {
  const MapDetailsLayout({required this.map, this.details, super.key});

  final Widget map;
  final Widget? details;

  /// One [Flex] whether or not details show, with the map always its first
  /// child: opening or closing the details keeps the map's element, so the
  /// platform map is not rebuilt and a camera move started by the same tap
  /// (a cluster zooming to its members) is not lost.
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final side = constraints.maxWidth >= 720;
      return Flex(
        direction: side ? Axis.horizontal : Axis.vertical,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: map),
          if (details case final details?)
            side
                ? SizedBox(
                    key: const ValueKey('map-details-side-layout'),
                    width: 360,
                    child: details,
                  )
                : SizedBox(
                    key: const ValueKey('map-details-bottom-layout'),
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
    final view = item == null ? null : _view(context, strings, clock, item);
    final colors = Theme.of(context).colorScheme;
    return CallbackShortcuts(
      bindings: {const SingleActivator(LogicalKeyboardKey.escape): onClose},
      child: _SelectedDetailsFocus(
        selectedItemId: state.selectedItemId!,
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
                      if (item != null) ...[
                        MapLayerBadge(style: layerStyle(item.layerId)),
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Text(
                          item == null
                              ? strings.mapDetailsTitle
                              : layerTitle(strings, item.layerId),
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
                        if (item != null && view != null) ...[
                          Text(
                            view.title,
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          if (view.subtitle case final subtitle?)
                            Text(
                              subtitle,
                              style: Theme.of(context).textTheme.bodyMedium
                                  ?.copyWith(color: colors.onSurfaceVariant),
                            ),
                          if (view.chips.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: view.chips,
                              ),
                            ),
                          const SizedBox(height: 12),
                          if (typedContent != null)
                            typedContent
                          else
                            ...view.body,
                          // A group's own location is only its members'.
                          if (item is! AggregateMapItem)
                            MapDetailFactRow(
                              label: strings.mapDetailLocation,
                              value: _whereText(strings, item.location),
                            ),
                          ?additionalContent,
                          const SizedBox(height: 12),
                          MapItemProvenance(
                            time: item.time,
                            sources: item.sources,
                            assertionKind: item.assertionKind,
                            mode: state.mode,
                            dataMode: state.dataMode,
                            onOpenSource: onOpenSource,
                            showSourceVersions: false,
                          ),
                          _TechnicalDetails(
                            // A newly selected record starts collapsed.
                            key: ValueKey('map-details-technical-${item.id}'),
                            children: [
                              _fact(
                                strings,
                                strings.mapDetailIdentifier,
                                item.id,
                              ),
                              _fact(
                                strings,
                                strings.mapDetailVersion,
                                item.versionId,
                              ),
                              Text(
                                _precisionText(
                                  strings,
                                  item.location.precision,
                                ),
                              ),
                              Text(_roleText(strings, item.location.role)),
                              _fact(
                                strings,
                                strings.mapDetailLocationEvidence,
                                item.location.evidence,
                              ),
                              if (item.geometryPresentation?.simplified == true)
                                Text(strings.mapDetailSimplified),
                              ...view.technical,
                              for (final source in item.sources)
                                if (source.versionRef case final version?)
                                  Text(strings.mapSourceVersion(version)),
                            ],
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

  _ItemView _view(
    BuildContext context,
    AppLocalizations strings,
    MelbourneClock clock,
    MapItem item,
  ) {
    final colors = Theme.of(context).colorScheme;
    String orUnknown(String? value) => value ?? strings.mapDetailUnknown;
    MapDetailFactRow row(String label, String? value, {String? caption}) =>
        MapDetailFactRow(
          label: label,
          value: orUnknown(value),
          caption: caption,
        );
    Widget paragraph(String text) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
    );
    final lifecycle = _lifecycleChip(strings, item);
    switch (item) {
      case PedestrianMapItem(:final details):
        return _ItemView(
          title: item.title,
          chips: [?lifecycle],
          body: [
            if (details.totalCount case final count?)
              MapDetailHeadline(
                value: _number(count)!,
                caption: details.granularity == PedestrianGranularity.minute
                    ? strings.mapPeopleCountedMinute
                    : strings.mapPeopleCountedHour,
              )
            else
              Text(strings.mapCountUnknown),
            row(strings.mapDetailTime, _range(strings, clock, details.window)),
            row(strings.mapDetailDirectionA, _number(details.directionACount)),
            row(strings.mapDetailDirectionB, _number(details.directionBCount)),
            MapDetailNote(strings.mapDetailDirectionsUncalibrated),
            if (details.locationStatus != PedestrianLocationStatus.located)
              MapDetailNote(
                _locationStatusText(strings, details.locationStatus),
              ),
          ],
          technical: [
            _fact(strings, strings.mapDetailSensor, details.sensorId),
            Text(
              details.granularity == PedestrianGranularity.minute
                  ? strings.mapDetailMinuteGranularity
                  : strings.mapDetailHourGranularity,
            ),
            Text(_locationStatusText(strings, details.locationStatus)),
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
        );
      case AnomalyMapItem(:final details):
        return _ItemView(
          title: item.title,
          chips: [anomalyClassificationChip(strings, details.classification)],
          body: [AnomalyDetailsSection(item: item)],
          technical: anomalyTechnicalFacts(strings, details),
        );
      case DisruptionMapItem(:final details):
        return _ItemView(
          title: item.title,
          chips: [_eventStatusChip(strings, details.status)],
          body: [
            if (details.summary case final summary?) paragraph(summary),
            if (details.impact case final impact?)
              row(strings.mapDetailImpact, impact),
            if (details.serviceNames.isNotEmpty)
              row(strings.mapDetailServices, details.serviceNames.join(', ')),
            MapDetailNote(_extentText(strings, details.extentKind)),
          ],
        );
      case EventMapItem(:final details):
        final ticketmaster = TicketmasterSummary.tryParse(details.summary);
        final venue = details.venueName ?? ticketmaster?.venue;
        return _ItemView(
          title: item.title,
          subtitle: venue,
          chips: [
            if (ticketmaster != null)
              ?_ticketChip(strings, ticketmaster.ticketStatus),
            if (ticketmaster == null ||
                details.status == MapEventStatus.cancelled)
              _eventStatusChip(strings, details.status),
          ],
          body: [
            row(strings.mapDetailStarts, _dayTime(clock, details.startAt)),
            if (details.endAt != null)
              row(strings.mapDetailEnds, _dayTime(clock, details.endAt)),
            if (venue != null) row(strings.mapDetailVenue, venue),
            if (details.category case final category?)
              row(strings.mapDetailCategory, category),
            if (ticketmaster == null)
              if (details.summary case final summary?) paragraph(summary),
          ],
        );
      case PlanningMapItem(:final details):
        if (DevelopmentProjectSummary.tryParse(details.summary)
            case final project?) {
          return _ItemView(
            title: DevelopmentProjectSummary.cleanTitle(item.title, project),
            chips: [_developmentChip(strings, project)],
            body: [
              row(strings.mapDetailFloors, _number(project.floors)),
              row(strings.mapDetailDwellings, _number(project.dwellings)),
              if (project.application case final application?)
                row(strings.mapDetailApplication, application),
            ],
            technical: [
              _fact(strings, strings.mapDetailProjectRef, project.projectKey),
              _fact(strings, strings.mapDetailSummary, details.summary),
            ],
          );
        }
        if (CouncilConsultationSummary.tryParse(details.summary)
            case final consultation?) {
          return _ItemView(
            title: item.title,
            subtitle: strings.mapConsultationLabel,
            chips: [_consultationChip(strings, consultation.status)],
            body: [
              row(strings.mapDetailCouncil, consultation.council),
              row(
                strings.mapDetailArea,
                consultation.councilWide
                    ? strings.mapDetailCouncilWide
                    : consultation.suburbs.isEmpty
                    ? null
                    : consultation.suburbs.join(', '),
              ),
              if (consultation.categories.isNotEmpty)
                row(
                  strings.mapDetailTopics,
                  consultation.categories.join(', '),
                ),
            ],
            technical: [
              _fact(strings, strings.mapDetailSummary, details.summary),
            ],
          );
        }
        return _ItemView(
          title: item.title,
          chips: [?lifecycle],
          body: [
            if (details.summary case final summary?) paragraph(summary),
            if (details.projectStatus case final status?)
              row(strings.mapDetailProjectStatus, status),
          ],
          technical: [
            _fact(strings, strings.mapDetailPermit, details.permitId),
          ],
        );
      case ParkingMapItem(:final details):
        return _ItemView(
          title: item.title,
          body: [
            MapDetailHeadline(
              value: switch (details.state) {
                ParkingState.vacant => strings.mapDetailParkingVacant,
                ParkingState.occupied => strings.mapDetailParkingOccupied,
                ParkingState.noData => strings.mapDetailParkingNoData,
              },
              color: switch (details.state) {
                ParkingState.vacant => colors.primary,
                ParkingState.occupied => colors.error,
                ParkingState.noData => colors.onSurfaceVariant,
              },
            ),
            if (details.noDataReason case final reason?)
              MapDetailNote(switch (reason) {
                ParkingNoDataReason.notReporting =>
                  strings.mapDetailParkingNotReporting,
                ParkingNoDataReason.publicHoliday =>
                  strings.mapDetailParkingPublicHoliday,
                ParkingNoDataReason.holidayUnknown =>
                  strings.mapDetailParkingHolidayUnknown,
                ParkingNoDataReason.noStatus =>
                  strings.mapDetailParkingNoStatus,
              }),
            if (details.state != ParkingState.noData &&
                details.reading == ParkingReading.late)
              MapDetailNote(strings.mapDetailParkingLate),
            row(
              strings.mapDetailParkingLastReported,
              _time(clock, details.lastReportedAt),
            ),
            row(
              strings.mapDetailParkingStatusChanged,
              _time(clock, details.statusChangedAt),
            ),
            if (details.zoneNumber case final zone?)
              row(strings.mapDetailParkingZone, _number(zone)),
            // Shown with every sensor: occupancy is never legal permission.
            MapDetailNote(
              strings.mapDetailParkingNotLegal,
              icon: Icons.warning_amber_rounded,
            ),
            if (details.mayBeObstructed)
              MapDetailNote(strings.mapDetailParkingObstruction),
          ],
          technical: [
            _fact(strings, strings.mapDetailSensor, details.sensorId),
          ],
        );
      case BoundaryMapItem(:final details):
        return _ItemView(
          title: item.title,
          subtitle: _boundaryLevel(strings, details.boundaryLevel),
          body: [
            row(strings.mapDetailBoundaryName, details.name),
            row(
              strings.mapDetailBoundaryLevel,
              _boundaryLevel(strings, details.boundaryLevel),
            ),
            row(strings.mapDetailBoundaryVintage, details.vintage),
          ],
          technical: [
            _fact(strings, strings.mapDetailBoundary, details.boundaryId),
          ],
        );
      case NewsMapItem(:final details):
        return _ItemView(
          title: item.title,
          chips: [?lifecycle],
          body: [
            if (details.summary case final summary?) paragraph(summary),
            if (details.localizationEvidence case final evidence?)
              MapDetailNote(evidence, icon: Icons.place_outlined),
            for (final article in details.articleRefs)
              _article(strings, clock, article),
          ],
        );
      case AreaIndicatorMapItem(:final details):
        return _ItemView(
          title: item.title,
          body: [
            switch (details.valueState) {
              MapValueState.missing => Text(strings.mapDetailValueMissing),
              MapValueState.suppressed => Text(
                strings.mapDetailValueSuppressed,
              ),
              MapValueState.observed => MapDetailHeadline(
                value: orUnknown(_number(details.value)),
                caption: details.unit,
              ),
            },
            Text(strings.mapStatisticalPeriod(details.periodLabel)),
            if (details.propertyType case final propertyType?)
              row(strings.mapDetailPropertyType, propertyType),
            MapDetailNote(details.definition),
          ],
          technical: [
            _fact(strings, strings.mapDetailIndicator, details.indicatorId),
            _fact(strings, strings.mapDetailUnit, details.unit),
            _fact(strings, strings.mapDetailBoundary, details.boundaryId),
            _fact(
              strings,
              strings.mapDetailBoundaryVintage,
              details.boundaryVintage,
            ),
          ],
        );
      case AggregateMapItem(:final details):
        final total = details.resultRange.totalMatching;
        return _ItemView(
          title: item.title,
          body: [
            MapDetailHeadline(
              value: orUnknown(_number(details.metric.value)),
              caption: details.metric.unit,
            ),
            if (details.window case final window?)
              row(strings.mapDetailTime, _range(strings, clock, window)),
            Text(
              total == null
                  ? strings.mapTotalUnknown
                  : strings.mapExactTotal(_number(total)!),
            ),
            if (aggregateHasUnknownTotal(item))
              MapDetailNote(strings.mapAggregateLoadedOnly),
            MapDetailNote(strings.mapAggregateScopeExplanation),
            MapDetailNote(details.metric.definition),
          ],
          technical: [
            _fact(strings, strings.mapDetailMetric, details.metric.label),
          ],
        );
    }
  }

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

class _SelectedDetailsFocus extends StatefulWidget {
  const _SelectedDetailsFocus({
    required this.selectedItemId,
    required this.child,
  });

  final String selectedItemId;
  final Widget child;

  @override
  State<_SelectedDetailsFocus> createState() => _SelectedDetailsFocusState();
}

class _SelectedDetailsFocusState extends State<_SelectedDetailsFocus> {
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.requestFocus();
  }

  @override
  void didUpdateWidget(_SelectedDetailsFocus oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.selectedItemId != oldWidget.selectedItemId) {
      _focusNode.requestFocus();
    }
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      Focus(focusNode: _focusNode, child: widget.child);
}

Widget _fact(AppLocalizations strings, String label, String? value) =>
    Text(strings.mapDetailFact(label, value ?? strings.mapDetailUnknown));

String? _number(num? value) =>
    value == null ? null : NumberFormat.decimalPattern('en_AU').format(value);

/// "Tue 3 Nov 2026, 09:30 AEDT": events read better with the weekday.
String? _dayTime(MelbourneClock clock, DateTime? value) {
  if (value == null) return null;
  final local = clock.toMelbourne(value);
  return '${DateFormat('EEE d MMM y', 'en_AU').format(local)}, '
      '${DateFormat.Hm('en_AU').format(local)} ${local.timeZoneName}';
}

String _range(AppLocalizations strings, MelbourneClock clock, TimeWindow w) =>
    strings.mapDetailRange(_time(clock, w.from)!, _time(clock, w.to)!);

String? _time(MelbourneClock clock, DateTime? value) {
  if (value == null) return null;
  final local = clock.toMelbourne(value);
  return '${DateFormat.yMMMd('en_AU').format(local)}, '
      '${DateFormat.Hm('en_AU').format(local)} ${local.timeZoneName}';
}

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

/// The record's lifecycle as a chip; a planned plan reads once as "Planned".
MapStatusChip? _lifecycleChip(AppLocalizations strings, MapItem item) =>
    switch (item.lifecycle) {
      MapLifecycle.active => MapStatusChip(
        label: strings.mapChipActive,
        tone: MapChipTone.positive,
      ),
      MapLifecycle.planned => MapStatusChip(label: strings.mapChipPlanned),
      MapLifecycle.cancelled => MapStatusChip(
        label: strings.mapChipCancelled,
        tone: MapChipTone.negative,
      ),
      MapLifecycle.resolved => MapStatusChip(label: strings.mapChipResolved),
      MapLifecycle.withdrawn => null,
    };

MapStatusChip _eventStatusChip(
  AppLocalizations strings,
  MapEventStatus value,
) => switch (value) {
  MapEventStatus.active => MapStatusChip(
    label: strings.mapChipActive,
    tone: MapChipTone.positive,
  ),
  MapEventStatus.planned => MapStatusChip(label: strings.mapChipPlanned),
  MapEventStatus.cancelled => MapStatusChip(
    label: strings.mapChipCancelled,
    tone: MapChipTone.negative,
  ),
  MapEventStatus.resolved => MapStatusChip(label: strings.mapChipResolved),
  MapEventStatus.unknown => MapStatusChip(label: strings.mapChipStatusUnknown),
};

/// Ticketmaster sale status; an unrecognised status shows no chip.
MapStatusChip? _ticketChip(AppLocalizations strings, String status) =>
    switch (status) {
      'onsale' => MapStatusChip(
        label: strings.mapTicketsOnSale,
        tone: MapChipTone.positive,
      ),
      'offsale' => MapStatusChip(label: strings.mapTicketsOffSale),
      'cancelled' || 'canceled' => MapStatusChip(
        label: strings.mapTicketsCancelled,
        tone: MapChipTone.negative,
      ),
      'postponed' => MapStatusChip(
        label: strings.mapTicketsPostponed,
        tone: MapChipTone.caution,
      ),
      'rescheduled' => MapStatusChip(
        label: strings.mapTicketsRescheduled,
        tone: MapChipTone.caution,
      ),
      _ => null,
    };

/// Development Activity Monitor status; an unknown status keeps the council's
/// own wording.
MapStatusChip _developmentChip(
  AppLocalizations strings,
  DevelopmentProjectSummary project,
) => switch (project.status) {
  'mooted' => MapStatusChip(label: strings.mapDevelopmentMooted),
  'approved' => MapStatusChip(
    label: strings.mapDevelopmentApproved,
    tone: MapChipTone.positive,
  ),
  'under_construction' => MapStatusChip(
    label: strings.mapDevelopmentUnderConstruction,
    tone: MapChipTone.caution,
  ),
  'completed' => MapStatusChip(label: strings.mapDevelopmentCompleted),
  _ => MapStatusChip(label: project.sourceStatus),
};

MapStatusChip _consultationChip(AppLocalizations strings, String status) =>
    switch (status) {
      'Open' => MapStatusChip(
        label: strings.mapConsultationOpen,
        tone: MapChipTone.positive,
      ),
      'Active' => MapStatusChip(label: strings.mapConsultationActive),
      'Closed' => MapStatusChip(label: strings.mapConsultationClosed),
      _ => MapStatusChip(label: status),
    };

/// Location basis in plain words; precision and evidence stay in the
/// technical section.
String _whereText(AppLocalizations strings, MapLocation location) {
  if (location.precision == MapLocationPrecision.unlocated) {
    return strings.mapDetailWhereUnlocated;
  }
  return switch (location.role) {
    MapLocationRole.sensor => strings.mapDetailWhereSensor,
    MapLocationRole.eventSite => strings.mapDetailWhereSite,
    MapLocationRole.affectedExtent => strings.mapDetailWhereExtent,
    MapLocationRole.statisticalArea => strings.mapDetailWhereStatisticalArea,
    MapLocationRole.areaAssociation => strings.mapDetailWhereAreaAssociation,
    MapLocationRole.mention => strings.mapDetailWhereMention,
    MapLocationRole.unknown => strings.mapDetailWhereUnknown,
  };
}

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

String _boundaryLevel(AppLocalizations strings, MapBoundaryLevel value) =>
    switch (value) {
      MapBoundaryLevel.gccsa => strings.mapBoundaryGccsa,
      MapBoundaryLevel.lga => strings.mapBoundaryLga,
      MapBoundaryLevel.sa2 => strings.mapBoundarySa2,
      MapBoundaryLevel.ste => strings.mapBoundaryState,
      MapBoundaryLevel.clueBlock => strings.mapBoundaryClueBlock,
      MapBoundaryLevel.municipal => strings.mapBoundaryMunicipal,
    };

/// What one selected record shows: its readable title, status chips, the
/// facts a reader came for, and ids that only matter for tracing the record.
final class _ItemView {
  const _ItemView({
    required this.title,
    required this.body,
    this.subtitle,
    this.chips = const [],
    this.technical = const [],
  });

  final String title;
  final String? subtitle;
  final List<Widget> chips;
  final List<Widget> body;
  final List<Widget> technical;
}

/// Record ids, versions and location evidence, collapsed by default.
class _TechnicalDetails extends StatelessWidget {
  const _TechnicalDetails({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Theme(
      data: theme.copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 8),
        expandedAlignment: Alignment.centerLeft,
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        title: Text(
          AppLocalizations.of(context).mapDetailTechnical,
          style: theme.textTheme.titleSmall,
        ),
        children: [
          DefaultTextStyle.merge(
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}
