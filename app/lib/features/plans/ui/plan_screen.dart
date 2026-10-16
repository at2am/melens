import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/network/public_source_opener.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../cards/ui/agent_card_view.dart';
import '../../map/state/map_actions.dart';
import '../../shell/state/shell_providers.dart';
import '../data/saved_plan.dart';
import '../state/plans_providers.dart';

/// One saved plan, opened from the Home tab: the card as the agent made it,
/// its route on the map, and a remove button. A stop opens on the map.
class PlanScreen extends ConsumerWidget {
  const PlanScreen({required this.planId, super.key});

  final String planId;

  void _showRoute(BuildContext context, WidgetRef ref, SavedPlan plan) {
    final route = plan.route;
    if (route == null) return;
    ref
        .read(mapActionsControllerProvider.notifier)
        .apply(UiAction(action: UiActionName.drawRoute, args: route));
    context.go(AppRoutes.discover);
  }

  Future<void> _remove(BuildContext context, WidgetRef ref) async {
    final strings = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(strings.planRemoveTitle),
        content: Text(strings.planRemoveBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(strings.planRemoveCancel),
          ),
          FilledButton(
            key: const ValueKey('plan-remove-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(strings.planRemove),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    context.pop();
    try {
      await ref.read(savedPlansProvider.notifier).remove(planId);
    } on AgentClientException {
      messenger.showSnackBar(SnackBar(content: Text(strings.planRemoveFailed)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final clock = ref.watch(melbourneClockProvider);
    final plans = ref.watch(savedPlansProvider);
    final plan = plans.value?.where((plan) => plan.id == planId).firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: Text(strings.planScreenTitle),
        actions: [
          if (plan != null)
            IconButton(
              key: const ValueKey('plan-remove'),
              tooltip: strings.planRemove,
              onPressed: () => unawaited(_remove(context, ref)),
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      ),
      body: plan == null
          ? Center(
              child: plans.isLoading
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(
                        plans.hasError
                            ? strings.plansLoadFailed
                            : strings.planMissing,
                        textAlign: TextAlign.center,
                      ),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                AgentCardView(
                  card: plan.card,
                  icon: Icons.route_outlined,
                  numbered: true,
                  // A stop the user drives to can read its parking again,
                  // for example on reaching the stop before it.
                  itemFooter: (index, item) =>
                      item.location != null &&
                          (plan.card.travelMode == TravelMode.drive ||
                              item.stopParking != null)
                      ? StopParkingRefresh(
                          key: ValueKey('plan-stop-refresh-$index'),
                          planId: plan.id,
                          index: index,
                          hasParking: item.stopParking != null,
                        )
                      : null,
                  onItemTap: (item) {
                    ref.read(cardItemRequestsProvider.notifier).request(item);
                    context.go(AppRoutes.discover);
                  },
                  onOpenSource: supportsPublicSourceOpening
                      ? openPublicSource
                      : null,
                ),
                if (plan.route != null) ...[
                  const SizedBox(height: 8),
                  FilledButton.tonalIcon(
                    key: const ValueKey('plan-show-route'),
                    onPressed: () => _showRoute(context, ref, plan),
                    icon: const Icon(Icons.directions_walk),
                    label: Text(strings.planShowRoute),
                  ),
                ],
                const SizedBox(height: 16),
                if (DateTime.tryParse(plan.savedAt) case final saved?)
                  Text(
                    strings.planSavedOn(
                      DateFormat(
                        'EEE d MMM, h:mm a',
                        'en_AU',
                      ).format(clock.toMelbourne(saved)),
                    ),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
    );
  }
}

/// Reads the live parking around one stop of a saved plan again, or for
/// the first time, and says when that failed.
class StopParkingRefresh extends ConsumerStatefulWidget {
  const StopParkingRefresh({
    required this.planId,
    required this.index,
    required this.hasParking,
    super.key,
  });

  final String planId;
  final int index;
  final bool hasParking;

  @override
  ConsumerState<StopParkingRefresh> createState() => _StopParkingRefreshState();
}

class _StopParkingRefreshState extends ConsumerState<StopParkingRefresh> {
  bool _busy = false;
  bool _failed = false;

  Future<void> _refresh() async {
    setState(() {
      _busy = true;
      _failed = false;
    });
    try {
      await ref
          .read(savedPlansProvider.notifier)
          .refreshStop(widget.planId, widget.index);
    } on AgentClientException {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton.icon(
          onPressed: _busy ? null : () => unawaited(_refresh()),
          icon: _busy
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Icon(
                  widget.hasParking ? Icons.refresh : Icons.local_parking,
                  size: 18,
                ),
          label: Text(
            widget.hasParking
                ? strings.stopParkingRefresh
                : strings.stopParkingFind,
          ),
        ),
        if (_failed)
          Text(
            strings.stopParkingRefreshFailed,
            key: ValueKey('plan-stop-refresh-failed-${widget.index}'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
            ),
          ),
      ],
    );
  }
}
