import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../data/map_repository.dart';
import 'map_status.dart';
import 'renderers/aggregate_renderer.dart';

/// Snapshot-bound member browsing, including groups that stay dense up close.
class AggregateDetailsPanel extends ConsumerStatefulWidget {
  const AggregateDetailsPanel({
    required this.aggregate,
    required this.repository,
    required this.readContext,
    required this.mode,
    required this.dataMode,
    this.onZoomToBounds,
    this.onItemSelected,
    this.onOpenSource,
    this.onRefreshSnapshot,
    this.pageSize = 25,
    this.maxDisplayedMembers = 100,
    super.key,
  }) : assert(pageSize > 0 && pageSize <= 50),
       assert(maxDisplayedMembers > 0 && maxDisplayedMembers <= 200);

  final AggregateMapItem aggregate;
  final MapRepository repository;
  final MapReadContext readContext;
  final MapQueryMode mode;
  final MapDataMode dataMode;
  final ValueChanged<MapBounds>? onZoomToBounds;
  final ValueChanged<MapItem>? onItemSelected;
  final ValueChanged<Uri>? onOpenSource;
  final VoidCallback? onRefreshSnapshot;
  final int pageSize;
  final int maxDisplayedMembers;

  @override
  ConsumerState<AggregateDetailsPanel> createState() =>
      _AggregateDetailsPanelState();
}

class _AggregateDetailsPanelState extends ConsumerState<AggregateDetailsPanel> {
  final Map<String, MapItem> _members = {};
  final Set<String> _seenCursors = {};
  MapRequestCancellation? _cancellation;
  MapRepositoryException? _failure;
  String? _cursor;
  int? _exactTotal;
  String? _memberUnit;
  bool _busy = false;
  bool _queried = false;
  bool _partial = false;
  int _generation = 0;
  int _sequence = 0;
  int _pages = 0;

  bool get _snapshotExpired => switch (_failure) {
    MapHttpException(:final code) =>
      code == MapServiceErrorCode.snapshotExpired,
    _ => false,
  };

  bool get _bounded =>
      _members.length >= widget.maxDisplayedMembers ||
      _pages >= (widget.maxDisplayedMembers / widget.pageSize).ceil();

  @override
  void initState() {
    super.initState();
    unawaited(_readMembers());
  }

  @override
  void didUpdateWidget(AggregateDetailsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.aggregate.id != widget.aggregate.id ||
        oldWidget.aggregate.versionId != widget.aggregate.versionId ||
        oldWidget.readContext.snapshotId != widget.readContext.snapshotId ||
        oldWidget.repository != widget.repository ||
        oldWidget.mode != widget.mode ||
        oldWidget.dataMode != widget.dataMode ||
        oldWidget.pageSize != widget.pageSize ||
        oldWidget.maxDisplayedMembers != widget.maxDisplayedMembers) {
      _generation++;
      _cancellation?.cancel();
      _members.clear();
      _seenCursors.clear();
      _cursor = null;
      _exactTotal = null;
      _memberUnit = null;
      _pages = 0;
      _busy = false;
      _queried = false;
      _partial = false;
      _failure = null;
      unawaited(_readMembers());
    }
  }

  Future<void> _readMembers() async {
    if (_busy || _bounded || _snapshotExpired) return;
    final generation = _generation;
    final cancellation = MapRequestCancellation();
    _cancellation = cancellation;
    final aggregateId = widget.aggregate.id;
    final snapshotId = widget.readContext.snapshotId;
    final requestId = '${widget.readContext.requestId}-members-${++_sequence}';
    final cursor = _cursor;
    final expectedMode = widget.mode;
    final expectedDataMode = widget.dataMode;
    final requestedSize = math.min(
      widget.pageSize,
      widget.maxDisplayedMembers - _members.length,
    );
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      final page = await widget.repository.getAggregateMembers(
        aggregateId,
        AggregateMembersQuery(
          requestId: requestId,
          snapshotId: snapshotId,
          cursor: cursor,
          pageSize: requestedSize,
        ),
        cancellation: cancellation,
      );
      if (!mounted || generation != _generation || cancellation.isCancelled) {
        return;
      }
      final scope = page.scope;
      if (scope is! AggregateMembersPageScope) {
        throw const MapContractException(MapContractFailure.invalidEnvelope);
      }
      final valid =
          page.schemaVersion == 1 &&
          page.requestId == requestId &&
          page.snapshotId == snapshotId &&
          page.mode == expectedMode &&
          page.dataMode == expectedDataMode &&
          scope.aggregateId == aggregateId &&
          page.items.length <= requestedSize &&
          (page.nextCursor == null ||
              (page.completeness == MapCompleteness.partial &&
                  page.nextCursor != cursor &&
                  !_seenCursors.contains(page.nextCursor))) &&
          (_memberUnit == null || _memberUnit == scope.unit) &&
          (_exactTotal == null ||
              page.totalMatching == null ||
              _exactTotal == page.totalMatching);
      if (!valid) {
        throw const MapContractException(MapContractFailure.invalidEnvelope);
      }
      final updated = {..._members};
      for (final item in page.items) {
        final previous = updated[item.id];
        if (previous != null && previous.versionId != item.versionId) {
          throw const MapContractException(MapContractFailure.invalidEnvelope);
        }
        updated[item.id] = item;
      }
      if (page.totalMatching != null && page.totalMatching! < updated.length) {
        throw const MapContractException(MapContractFailure.invalidEnvelope);
      }
      setState(() {
        _members
          ..clear()
          ..addAll(updated);
        if (cursor != null) _seenCursors.add(cursor);
        _memberUnit = scope.unit;
        _cursor = page.nextCursor;
        _exactTotal = page.totalMatching ?? _exactTotal;
        _partial = page.completeness == MapCompleteness.partial;
        _queried = true;
        _pages++;
      });
    } on MapRepositoryException catch (error) {
      if (mounted && generation == _generation && !cancellation.isCancelled) {
        setState(() => _failure = error);
      }
    } catch (_) {
      if (mounted && generation == _generation && !cancellation.isCancelled) {
        setState(
          () => _failure = const MapContractException(
            MapContractFailure.invalidEnvelope,
          ),
        );
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _generation++;
    _cancellation?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final details = widget.aggregate.details;
    final format = NumberFormat.decimalPattern('en_AU');
    final clock = ref.watch(melbourneClockProvider);
    String localTime(DateTime instant) {
      final local = clock.toMelbourne(instant);
      return '${DateFormat.yMMMd('en_AU').format(local)}, '
          '${DateFormat.Hm('en_AU').format(local)} ${local.timeZoneName}';
    }

    final metric = details.metric;
    if (details.representation == AggregateRepresentation.areaMentions) {
      return _areaMentions(context, strings, format);
    }
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            widget.aggregate.title,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          Text(
            strings.mapAggregateLoadedRecords(
              format.format(details.resultRange.returnedCount),
            ),
          ),
          Text(strings.mapAggregateScopeExplanation),
          if (aggregateHasUnknownTotal(widget.aggregate))
            Text(strings.mapAggregateLoadedOnly),
          if (details.resultRange.totalMatching case final total?)
            Text(strings.mapAggregateGroupTotal(format.format(total)))
          else
            Text(strings.mapTotalUnknown),
          Text(
            metric.value == null
                ? strings.mapAggregateMetricUnknown(metric.label, metric.unit)
                : strings.mapAggregateMetric(
                    metric.label,
                    format.format(metric.value),
                    metric.unit,
                  ),
          ),
          Text(metric.definition),
          if (details.window case final window?)
            Text(
              strings.mapObservedWindow(
                localTime(window.from),
                localTime(window.to),
              ),
            )
          else
            Text(strings.mapObservedWindowUnknown),
          if (_sameLocation(widget.aggregate.geometry))
            Text(strings.mapAggregateSameLocation),
          if (widget.onZoomToBounds != null)
            OutlinedButton.icon(
              onPressed: () => widget.onZoomToBounds!(details.bounds),
              icon: const Icon(Icons.zoom_in),
              label: Text(strings.mapAggregateZoom),
            ),
          MapItemProvenance(
            time: widget.aggregate.time,
            sources: widget.aggregate.sources,
            assertionKind: widget.aggregate.assertionKind,
            mode: widget.mode,
            dataMode: widget.dataMode,
            onOpenSource: widget.onOpenSource,
          ),
          const SizedBox(height: 16),
          Text(
            strings.mapAggregateMembersTitle,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Text(
            strings.mapAggregateMembersLoaded(format.format(_members.length)),
          ),
          if (_memberUnit case final unit?)
            Text(strings.mapAggregateMemberUnit(unit)),
          if (_exactTotal case final total?)
            Text(strings.mapAggregateGroupTotal(format.format(total)))
          else
            Text(strings.mapTotalUnknown),
          if (_partial) Text(strings.mapPartialScope),
          if (_busy) ...[
            Text(strings.mapAggregateMembersLoading),
            LinearProgressIndicator(
              semanticsLabel: strings.mapAggregateMembersLoading,
            ),
          ],
          if (_failure != null) ...[
            Text(
              _snapshotExpired
                  ? strings.mapAggregateSnapshotExpired
                  : strings.mapStatusClientError,
            ),
            if (_snapshotExpired && widget.onRefreshSnapshot != null)
              TextButton(
                onPressed: widget.onRefreshSnapshot,
                child: Text(strings.mapAggregateRefreshSnapshot),
              )
            else if (_failure!.retryable && !_busy)
              TextButton(
                onPressed: () => unawaited(_readMembers()),
                child: Text(strings.mapAggregateMembersRetry),
              ),
          ],
          if (_queried && _members.isEmpty && !_busy && _failure == null)
            Text(strings.mapAggregateMembersEmpty),
          for (final member in _members.values)
            ListTile(
              key: ValueKey('aggregate-member:${member.id}'),
              title: Text(member.title),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (member case PedestrianMapItem(:final details))
                    MapMeasuredCount(count: details.totalCount),
                  if (member.time.observedAt case final observed?)
                    Text(strings.mapObservedAt(localTime(observed))),
                  Text(
                    member.sources.isEmpty
                        ? strings.mapSourceUnknown
                        : strings.mapSourceAttribution(
                            member.sources.first.attribution,
                          ),
                  ),
                ],
              ),
              onTap: widget.onItemSelected == null
                  ? null
                  : () => widget.onItemSelected!(member),
            ),
          if (_bounded && (_cursor != null || _partial))
            Text(strings.mapAggregateMembersBounded),
          if (_cursor != null && !_bounded && _failure == null)
            TextButton(
              onPressed: _busy ? null : () => unawaited(_readMembers()),
              child: Text(strings.mapAggregateMembersMore),
            ),
        ],
      ),
    );
  }
}

extension on _AggregateDetailsPanelState {
  /// UC-06: an area's latest articles, each with its own original link.
  Widget _areaMentions(
    BuildContext context,
    AppLocalizations strings,
    NumberFormat format,
  ) {
    final details = widget.aggregate.details;
    final total = details.resultRange.totalMatching;
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        // The record header above already shows the title and the count's
        // definition; this section adds the articles themselves.
        children: [
          Text(strings.mapNewsAreaExplanation),
          const SizedBox(height: 16),
          Text(
            strings.mapNewsAreaLatest,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (total != null && _members.isNotEmpty)
            Text(
              strings.mapNewsAreaShowing(
                format.format(_members.length),
                format.format(total),
              ),
            ),
          if (_busy)
            LinearProgressIndicator(
              semanticsLabel: strings.mapAggregateMembersLoading,
            ),
          if (_failure != null) ...[
            Text(
              _snapshotExpired
                  ? strings.mapAggregateSnapshotExpired
                  : strings.mapStatusClientError,
            ),
            if (_snapshotExpired && widget.onRefreshSnapshot != null)
              TextButton(
                onPressed: widget.onRefreshSnapshot,
                child: Text(strings.mapAggregateRefreshSnapshot),
              )
            else if (_failure!.retryable && !_busy)
              TextButton(
                onPressed: () => unawaited(_readMembers()),
                child: Text(strings.mapAggregateMembersRetry),
              ),
          ],
          if (_queried && _members.isEmpty && !_busy && _failure == null)
            Text(strings.mapAggregateMembersEmpty),
          for (final member in _members.values)
            ListTile(
              key: ValueKey('aggregate-member:${member.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text(member.title),
              // The outlet's site says more than the shared GDELT credit,
              // which the provenance below still carries.
              subtitle: Text(switch (Uri.tryParse(
                member.sources.firstOrNull?.url ?? '',
              )) {
                Uri(:final host) when host.isNotEmpty => host.replaceFirst(
                  RegExp(r'^www\.'),
                  '',
                ),
                _ =>
                  member.sources.isEmpty
                      ? strings.mapSourceUnknown
                      : strings.mapSourceAttribution(
                          member.sources.first.attribution,
                        ),
              }),
              trailing: switch (member.sources.firstOrNull?.url) {
                final url? when widget.onOpenSource != null => IconButton(
                  key: ValueKey('aggregate-member-open:${member.id}'),
                  tooltip: strings.mapNewsAreaOpenArticle,
                  icon: const Icon(Icons.open_in_new),
                  onPressed: () => widget.onOpenSource!(Uri.parse(url)),
                ),
                _ => null,
              },
              onTap: widget.onItemSelected == null
                  ? null
                  : () => widget.onItemSelected!(member),
            ),
          MapItemProvenance(
            time: widget.aggregate.time,
            sources: widget.aggregate.sources,
            assertionKind: widget.aggregate.assertionKind,
            mode: widget.mode,
            dataMode: widget.dataMode,
            onOpenSource: widget.onOpenSource,
          ),
        ],
      ),
    );
  }
}

bool _sameLocation(GeoJsonGeometry? geometry) {
  if (geometry is! GeoJsonMultiPoint || geometry.coordinates.length < 2) {
    return false;
  }
  final first = geometry.coordinates.first;
  return geometry.coordinates.every(
    (point) => point[0] == first[0] && point[1] == first[1],
  );
}
