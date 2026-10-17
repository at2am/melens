import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app/router.dart';
import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../data/saved_plan.dart';
import '../state/plans_providers.dart';

/// The plans the user saved from the chat, above the feed's items: one
/// tile each, coming up first and past ones last. Nothing shows until a
/// plan is saved; a failed load says so with a retry.
class SavedPlansSection extends ConsumerWidget {
  const SavedPlansSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final now = ref.watch(melbourneClockProvider).now();
    final plans = ref.watch(savedPlansProvider);
    final list = plans.value;
    if (list == null) {
      if (!plans.hasError) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 12, 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                strings.plansLoadFailed,
                key: const ValueKey('saved-plans-failed'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
            TextButton(
              onPressed: () => ref.invalidate(savedPlansProvider),
              child: Text(strings.feedRetry),
            ),
          ],
        ),
      );
    }
    if (list.isEmpty) return const SizedBox.shrink();
    // Stable sort: the service's newest-first order within each group.
    final ordered = [
      for (final plan in list)
        if (!plan.isPastAt(now)) plan,
      for (final plan in list)
        if (plan.isPastAt(now)) plan,
    ];
    return Padding(
      key: const ValueKey('saved-plans'),
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            strings.plansSectionTitle,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          for (final plan in ordered) ...[
            SavedPlanTile(plan: plan, past: plan.isPastAt(now)),
            const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

/// One saved plan: its title, how many stops and when it starts. Opens the
/// plan's page.
class SavedPlanTile extends ConsumerWidget {
  const SavedPlanTile({required this.plan, required this.past, super.key});

  final SavedPlan plan;
  final bool past;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final clock = ref.watch(melbourneClockProvider);
    final start = plan.span?.$1;
    final visited = plan.visited;
    final meta = [
      if (visited > 0 && !past)
        strings.planProgress(visited, plan.card.items.length)
      else
        strings.planStops(plan.card.items.length),
      if (start != null)
        '${DateFormat('EEE d MMM', 'en_AU').format(clock.toMelbourne(start))}, '
            '${DateFormat('h:mm a', 'en_AU').format(clock.toMelbourne(start))}',
    ];
    return Card(
      color: past ? colors.surfaceContainerLow : colors.secondaryContainer,
      child: InkWell(
        key: ValueKey('saved-plan-${plan.id}'),
        onTap: () => context.push(AppRoutes.plan(plan.id)),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
          child: Row(
            children: [
              Icon(
                Icons.route_outlined,
                color: past ? colors.outline : colors.onSecondaryContainer,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      plan.card.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: past ? colors.onSurfaceVariant : null,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      meta.join(' · '),
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              if (past)
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Text(
                    strings.planPast,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: colors.outline,
                    ),
                  ),
                ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
