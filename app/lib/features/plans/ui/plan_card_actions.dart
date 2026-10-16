import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../chat/state/chat_controller.dart';
import '../state/plans_providers.dart';

enum _SaveFailure { limit, other }

/// The buttons under a plan card in the chat: ask the agent to change the
/// plan, or save it to the Feed tab. A saved plan says so.
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

  Future<void> _save(String sessionId) async {
    setState(() {
      _saving = true;
      _failure = null;
    });
    try {
      await ref
          .read(savedPlansProvider.notifier)
          .save(sessionId: sessionId, card: widget.card);
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
    final saved =
        ref
            .watch(savedPlansProvider)
            .value
            ?.any((plan) => plan.id == card.id) ??
        false;
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
              else
                FilledButton.tonalIcon(
                  key: ValueKey('plan-save-${card.id}'),
                  onPressed: _saving || sessionId == null
                      ? null
                      : () => unawaited(_save(sessionId)),
                  icon: _saving
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.bookmark_add_outlined, size: 18),
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
