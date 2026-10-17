import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../chat/state/chat_controller.dart';
import '../../chat/state/chat_models.dart';
import '../data/saved_plan.dart';
import '../state/plans_providers.dart';

enum _SaveFailure { limit, other }

/// The saved plan [card] revises: the nearest plan it was made from, through
/// the earlier revisions [turns] show, that the user kept. Null for a new
/// plan, or when none of them was kept.
SavedPlan? revisedSavedPlan(
  List<ChatTurn> turns,
  List<SavedPlan> plans,
  AgentCard card,
) {
  final shown = {
    for (final turn in turns)
      for (final earlier in turn.cards) earlier.id: earlier,
  };
  final seen = <String>{};
  for (
    var id = card.revises;
    id != null && seen.add(id);
    id = shown[id]?.revises
  ) {
    for (final plan in plans) {
      if (plan.id == id) return plan;
    }
  }
  return null;
}

/// The buttons under a plan card in the chat: ask the agent to change the
/// plan, or save it to the Home tab. A saved plan says so; a revision of a
/// saved plan updates it, taking its place.
class PlanCardActions extends ConsumerStatefulWidget {
  const PlanCardActions({required this.card, super.key});

  final AgentCard card;

  @override
  ConsumerState<PlanCardActions> createState() => _PlanCardActionsState();
}

class _PlanCardActionsState extends ConsumerState<PlanCardActions> {
  bool _saving = false;

  /// Why the last save failed: the plan limit, or anything else.
  _SaveFailure? _failure;

  Future<void> _save(String sessionId, {String? replaces}) async {
    setState(() {
      _saving = true;
      _failure = null;
    });
    try {
      await ref
          .read(savedPlansProvider.notifier)
          .save(sessionId: sessionId, card: widget.card, replaces: replaces);
    } on AgentHttpException catch (error) {
      if (mounted) {
        setState(
          () => _failure = error.code == AgentErrorCode.conflict
              ? _SaveFailure.limit
              : _SaveFailure.other,
        );
      }
    } on AgentClientException {
      if (mounted) setState(() => _failure = _SaveFailure.other);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final card = widget.card;
    final chat = ref.watch(chatControllerProvider);
    final sessionId = chat.sessionId;
    final plans = ref.watch(savedPlansProvider).value ?? const <SavedPlan>[];
    final saved = plans.any((plan) => plan.id == card.id);
    final revised = saved ? null : revisedSavedPlan(chat.turns, plans, card);
    final saving = _saving
        ? const SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : null;
    final refining = chat.refining?.id == card.id;
    final controller = ref.read(chatControllerProvider.notifier);
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              if (refining)
                FilledButton.tonalIcon(
                  key: ValueKey('plan-refine-${card.id}'),
                  onPressed: controller.cancelRefine,
                  icon: const Icon(Icons.close, size: 18),
                  label: Text(strings.planRefineCancel),
                )
              else
                OutlinedButton.icon(
                  key: ValueKey('plan-refine-${card.id}'),
                  onPressed: chat.canSend
                      ? () => controller.startRefine(card)
                      : null,
                  icon: const Icon(Icons.tune, size: 18),
                  label: Text(strings.planRefine),
                ),
              if (saved)
                FilledButton.tonalIcon(
                  key: ValueKey('plan-saved-${card.id}'),
                  onPressed: null,
                  icon: const Icon(Icons.bookmark_added, size: 18),
                  label: Text(strings.planSaved),
                )
              else if (revised != null)
                FilledButton.tonalIcon(
                  key: ValueKey('plan-update-${card.id}'),
                  onPressed: _saving || sessionId == null
                      ? null
                      : () => unawaited(_save(sessionId, replaces: revised.id)),
                  icon: saving ?? const Icon(Icons.bookmark_added, size: 18),
                  label: Text(strings.planUpdateSaved),
                )
              else
                FilledButton.tonalIcon(
                  key: ValueKey('plan-save-${card.id}'),
                  onPressed: _saving || sessionId == null
                      ? null
                      : () => unawaited(_save(sessionId)),
                  icon:
                      saving ??
                      const Icon(Icons.bookmark_add_outlined, size: 18),
                  label: Text(strings.planSave),
                ),
            ],
          ),
          if (_failure case final failure?)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                switch (failure) {
                  _SaveFailure.limit => strings.planSaveLimit,
                  _SaveFailure.other => strings.planSaveFailed,
                },
                key: ValueKey('plan-save-failed-${card.id}'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
