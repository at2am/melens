import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/map_models.dart';
import '../data/map_repository.dart';
import '../state/map_providers.dart';
import 'map_status.dart';

/// A list selection uses its own query-family snapshot, never a viewport token.
final class UnlocatedSelection {
  const UnlocatedSelection({
    required this.item,
    required this.context,
    required this.mode,
    required this.dataMode,
  });

  final MapItem item;
  final MapReadContext context;
  final MapQueryMode mode;
  final MapDataMode dataMode;
}

/// Caller supplies an approved scope. The widget never guesses jurisdiction,
/// viewport membership or a centroid, and retains at most one bounded page.
class UnlocatedList extends ConsumerStatefulWidget {
  const UnlocatedList({
    required this.query,
    required this.onItemSelected,
    this.selectedItemId,
    this.onClose,
    this.onOpenSource,
    super.key,
  });

  final UnlocatedQuery query;
  final ValueChanged<UnlocatedSelection> onItemSelected;
  final String? selectedItemId;
  final VoidCallback? onClose;
  final ValueChanged<Uri>? onOpenSource;

  @override
  ConsumerState<UnlocatedList> createState() => _UnlocatedListState();
}

class _UnlocatedListState extends ConsumerState<UnlocatedList> {
  MapItemPage? _page;
  Object? _error;
  bool _loading = false;
  MapRequestCancellation? _request;
  UnlocatedQuery? _requestedQuery;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load(widget.query));
  }

  @override
  void didUpdateWidget(covariant UnlocatedList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (jsonEncode(oldWidget.query.toJson()) !=
        jsonEncode(widget.query.toJson())) {
      _page = null;
      _error = null;
      unawaited(_load(widget.query));
    }
  }

  @override
  void dispose() {
    _generation++;
    _request?.cancel();
    super.dispose();
  }

  Future<void> _load(UnlocatedQuery query) async {
    _request?.cancel();
    final generation = ++_generation;
    final cancellation = MapRequestCancellation();
    _request = cancellation;
    _requestedQuery = query;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      validateUnlocatedQuery(query);
      final page = await ref
          .read(mapRepositoryProvider)
          .getUnlocated(query, cancellation: cancellation);
      if (!mounted || generation != _generation || cancellation.isCancelled) {
        return;
      }
      if (page.requestId != query.requestId ||
          page.mode != query.mode ||
          (query.snapshotId != null && page.snapshotId != query.snapshotId) ||
          page.items.length > (query.pageSize ?? 1000) ||
          page.items.any(
            (item) =>
                item.geometry != null ||
                !query.layers.contains(item.layerId) ||
                item.lifecycle == MapLifecycle.withdrawn,
          ) ||
          !_sameScope(query.scope, page.scope)) {
        throw const MapContractException(MapContractFailure.requestMismatch);
      }
      setState(() {
        _page = page;
        _loading = false;
      });
    } on MapRequestCancelled {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    } catch (error) {
      if (!mounted || generation != _generation || cancellation.isCancelled) {
        return;
      }
      setState(() {
        _loading = false;
        _error = error;
      });
    } finally {
      if (generation == _generation) _request = null;
    }
  }

  UnlocatedQuery _pageQuery({String? cursor, String? snapshotId}) =>
      UnlocatedQuery(
        requestId: '${widget.query.requestId}:list:${_generation + 1}',
        layers: widget.query.layers,
        mode: widget.query.mode,
        window: widget.query.window,
        scope: widget.query.scope,
        areaFilter: widget.query.areaFilter,
        boundaryFilter: widget.query.boundaryFilter,
        pageSize: widget.query.pageSize,
        cursor: cursor,
        snapshotId: snapshotId,
      );

  void _restart() {
    setState(() => _page = null);
    unawaited(_load(_pageQuery()));
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final page = _page;
    final error = _error;
    final expired =
        error is MapHttpException &&
        error.code == MapServiceErrorCode.snapshotExpired;
    final retryable = error is MapRepositoryException && error.retryable;
    return CallbackShortcuts(
      bindings: {
        if (widget.onClose != null)
          const SingleActivator(LogicalKeyboardKey.escape): widget.onClose!,
      },
      child: Focus(
        skipTraversal: true,
        child: Semantics(
          container: true,
          label: strings.mapUnlocatedTitle,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Flexible(
                flex: 2,
                child: SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                strings.mapUnlocatedTitle,
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                            ),
                            if (widget.onClose != null)
                              IconButton(
                                tooltip: strings.mapUnlocatedClose,
                                onPressed: widget.onClose,
                                icon: const Icon(Icons.close),
                              ),
                          ],
                        ),
                        Text(_scopeText(strings, widget.query.scope)),
                        Text(strings.mapUnlocatedScopeExplanation),
                        Text(
                          strings.mapObservedWindow(
                            _localTime(clock, widget.query.window.from),
                            _localTime(clock, widget.query.window.to),
                          ),
                        ),
                        if (widget.query.mode == MapQueryMode.historical)
                          Text(strings.mapHistoricalData),
                        if (page != null) ...[
                          MapDataModeLabel(dataMode: page.dataMode),
                          if (page.completeness == MapCompleteness.partial)
                            Text(strings.mapPartialScope),
                          if (page.totalMatching == null)
                            Text(strings.mapTotalUnknown)
                          else
                            Text(
                              strings.mapExactTotal(
                                NumberFormat.decimalPattern('en_AU')
                                    .format(page.totalMatching),
                              ),
                            ),
                        ],
                        if (_loading) ...[
                          Text(strings.mapUnlocatedLoading),
                          LinearProgressIndicator(
                            semanticsLabel: strings.mapUnlocatedLoading,
                          ),
                        ],
                        if (error != null) ...[
                          Semantics(
                            liveRegion: true,
                            child: Text(
                              expired
                                  ? strings.mapUnlocatedSnapshotExpired
                                  : strings.mapStatusClientError,
                            ),
                          ),
                          if (page != null) Text(strings.mapRetainedData),
                          if (expired)
                            TextButton(
                              onPressed: _restart,
                              child: Text(strings.mapUnlocatedRestart),
                            )
                          else if (retryable)
                            TextButton(
                              onPressed: _loading
                                  ? null
                                  : () => unawaited(_load(_requestedQuery!)),
                              child: Text(strings.mapRetry),
                            ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
              Expanded(
                flex: 3,
                child: page == null
                    ? const SizedBox.shrink()
                    : page.items.isEmpty
                    ? Center(child: Text(strings.mapUnlocatedEmptyPage))
                    : ListView.builder(
                        key: ValueKey('unlocated-page-${page.snapshotId}'),
                        itemCount: page.items.length,
                        itemBuilder: (context, index) {
                          final item = page.items[index];
                          return ListTile(
                            key: ValueKey('unlocated-item-${item.id}'),
                            selected: item.id == widget.selectedItemId,
                            title: Text(item.title),
                            subtitle: MapItemProvenance(
                              time: item.time,
                              sources: item.sources,
                              assertionKind: item.assertionKind,
                              mode: page.mode,
                              dataMode: page.dataMode,
                              onOpenSource: widget.onOpenSource,
                            ),
                            onTap: () => widget.onItemSelected(
                              UnlocatedSelection(
                                item: item,
                                context: MapReadContext(
                                  requestId:
                                      '${widget.query.requestId}:detail:${item.id}',
                                  snapshotId: page.snapshotId,
                                ),
                                mode: page.mode,
                                dataMode: page.dataMode,
                              ),
                            ),
                          );
                        },
                      ),
              ),
              if (page?.nextCursor != null)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: TextButton(
                    onPressed: _loading || expired
                        ? null
                        : () => unawaited(
                            _load(
                              _pageQuery(
                                cursor: page!.nextCursor,
                                snapshotId: page.snapshotId,
                              ),
                            ),
                          ),
                    child: Text(strings.mapUnlocatedNextPage),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

bool _sameScope(UnlocatedScope query, PageScope response) {
  if (response is! UnlocatedPageScope) return false;
  return switch (query) {
    AreaRefsScope(:final areaRefs) =>
      response.sourceJurisdiction == null &&
          listEquals([...areaRefs]..sort(), [...response.areaRefs]..sort()),
    SourceJurisdictionScope(:final sourceJurisdiction) =>
      response.areaRefs.isEmpty &&
          response.sourceJurisdiction == sourceJurisdiction,
  };
}

String _scopeText(AppLocalizations strings, UnlocatedScope scope) =>
    switch (scope) {
      AreaRefsScope(:final areaRefs) => strings.mapUnlocatedAreaScope(
        areaRefs.join(', '),
      ),
      SourceJurisdictionScope(:final sourceJurisdiction) =>
        strings.mapUnlocatedJurisdictionScope(sourceJurisdiction),
    };

String _localTime(MelbourneClock clock, DateTime value) {
  final local = clock.toMelbourne(value);
  return '${DateFormat.yMMMd('en_AU').format(local)}, '
      '${DateFormat.Hm('en_AU').format(local)} ${local.timeZoneName}';
}
