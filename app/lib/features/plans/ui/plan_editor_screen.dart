import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../data/saved_plan.dart';
import '../state/plans_providers.dart';

/// The user's own edits of a saved plan, opened from its page: a new name,
/// and which stops to keep in which order. No agent runs; the service draws
/// the route again for the new order (agent-protocol.md, Saved plans).
class PlanEditorScreen extends ConsumerStatefulWidget {
  const PlanEditorScreen({required this.planId, super.key});

  final String planId;

  @override
  ConsumerState<PlanEditorScreen> createState() => _PlanEditorScreenState();
}

class _PlanEditorScreenState extends ConsumerState<PlanEditorScreen> {
  final _name = TextEditingController();

  /// The plan as it was opened; the edits apply to this copy.
  SavedPlan? _plan;

  /// The indices of the kept stops in the opened plan, in their new order.
  List<int> _stops = const [];
  bool _saving = false;
  bool _failed = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _open(SavedPlan plan) {
    _plan = plan;
    _name.text = plan.card.title;
    _stops = [
      for (var index = 0; index < plan.card.items.length; index++) index,
    ];
  }

  bool _reordered(SavedPlan plan) =>
      _stops.length != plan.card.items.length ||
      _stops.indexed.any((entry) => entry.$1 != entry.$2);

  Future<void> _save(SavedPlan plan) async {
    final name = _name.text.trim();
    final reordered = _reordered(plan);
    final renamed = name != plan.card.title;
    if (!reordered && !renamed) {
      context.pop();
      return;
    }
    setState(() {
      _saving = true;
      _failed = false;
    });
    try {
      await ref
          .read(savedPlansProvider.notifier)
          .edit(
            plan.id,
            title: renamed ? name : null,
            stops: reordered ? _stops : null,
          );
      if (mounted) context.pop();
    } on AgentClientException {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final plans = ref.watch(savedPlansProvider);
    if (_plan == null) {
      final loaded = plans.value
          ?.where((plan) => plan.id == widget.planId)
          .firstOrNull;
      if (loaded != null) _open(loaded);
    }
    final plan = _plan;
    return Scaffold(
      appBar: AppBar(
        title: Text(strings.planEdit),
        actions: [
          if (plan != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ListenableBuilder(
                listenable: _name,
                builder: (context, _) => FilledButton(
                  key: const ValueKey('plan-edit-save'),
                  onPressed: _saving || _name.text.trim().isEmpty
                      ? null
                      : () => unawaited(_save(plan)),
                  child: _saving
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(strings.planEditSave),
                ),
              ),
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
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: TextField(
                    key: const ValueKey('plan-edit-name'),
                    controller: _name,
                    maxLength: 80,
                    textInputAction: TextInputAction.done,
                    decoration: InputDecoration(
                      labelText: strings.planEditName,
                      border: const OutlineInputBorder(),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                  child: Text(
                    strings.planEditStops,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                if (_failed)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Text(
                      strings.planEditFailed,
                      key: const ValueKey('plan-edit-failed'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.error,
                      ),
                    ),
                  ),
                Expanded(
                  child: ReorderableListView.builder(
                    key: const ValueKey('plan-edit-stops'),
                    padding: const EdgeInsets.only(bottom: 32),
                    itemCount: _stops.length,
                    onReorderItem: (from, to) => setState(() {
                      final stops = List.of(_stops);
                      stops.insert(to, stops.removeAt(from));
                      _stops = stops;
                    }),
                    itemBuilder: (context, position) {
                      final index = _stops[position];
                      return _StopTile(
                        key: ValueKey('plan-edit-stop-$index'),
                        number: position + 1,
                        item: plan.card.items[index],
                        // A plan keeps at least one stop.
                        onRemove: _stops.length == 1
                            ? null
                            : () => setState(
                                () => _stops = [
                                  for (final kept in _stops)
                                    if (kept != index) kept,
                                ],
                              ),
                        removeKey: ValueKey('plan-edit-remove-$index'),
                        removeTooltip: strings.planEditRemoveStop,
                      );
                    },
                  ),
                ),
              ],
            ),
    );
  }
}

class _StopTile extends StatelessWidget {
  const _StopTile({
    required this.number,
    required this.item,
    required this.onRemove,
    required this.removeKey,
    required this.removeTooltip,
    super.key,
  });

  final int number;
  final CardItem item;
  final VoidCallback? onRemove;
  final Key removeKey;
  final String removeTooltip;

  @override
  Widget build(BuildContext context) {
    final summary = item.summary;
    return ListTile(
      leading: CircleAvatar(radius: 14, child: Text('$number')),
      title: Text(item.title),
      subtitle: summary == null || summary.isEmpty
          ? null
          : Text(summary, maxLines: 1, overflow: TextOverflow.ellipsis),
      // Leaves room for the drag handle the list adds on wide screens.
      contentPadding: const EdgeInsets.only(left: 16, right: 48),
      trailing: IconButton(
        key: removeKey,
        tooltip: removeTooltip,
        onPressed: onRemove,
        icon: const Icon(Icons.remove_circle_outline),
      ),
    );
  }
}
