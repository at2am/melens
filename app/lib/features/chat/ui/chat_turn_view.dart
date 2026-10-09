import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../cards/ui/card_registry.dart';
import '../../map/state/map_actions.dart';
import '../state/chat_models.dart';

String chatInputText(AppLocalizations strings, TurnInput input) =>
    switch (input) {
      TextTurnInput(:final text) => text,
      AreaTurnInput(:final lat, :final lng) => strings.chatInputArea(
        lat.toStringAsFixed(5),
        lng.toStringAsFixed(5),
      ),
      AnalyseTurnInput(:final featureId) => strings.chatInputAnalyse(featureId),
      AnswerTurnInput(:final value) => strings.chatInputAnswer(value),
    };

String chatErrorText(AppLocalizations strings, ChatError error) =>
    switch (error.kind) {
      ChatErrorKind.signIn => strings.chatErrorSignIn,
      ChatErrorKind.network => strings.chatErrorNetwork,
      ChatErrorKind.timeout => strings.chatErrorTimeout,
      ChatErrorKind.http => switch (error.code) {
        AgentErrorCode.unauthorized => strings.chatErrorUnauthorized,
        AgentErrorCode.notFound => strings.chatErrorNotFound,
        AgentErrorCode.turnInProgress => strings.chatErrorTurnInProgress,
        AgentErrorCode.rateLimited => strings.chatErrorRateLimited,
        AgentErrorCode.serviceUnavailable => strings.chatErrorUnavailable,
        AgentErrorCode.timeout => strings.chatErrorTimeout,
        AgentErrorCode.invalidRequest => strings.chatErrorInvalidRequest,
        null => strings.chatErrorHttp,
      },
      ChatErrorKind.protocol => strings.chatErrorProtocol,
      ChatErrorKind.streamEnded => strings.chatErrorStreamEnded,
      ChatErrorKind.server => strings.chatErrorServer(
        error.serverMessage ?? '',
      ),
    };

String _actionLabel(AppLocalizations strings, UiActionName action) =>
    switch (action) {
      UiActionName.showLayers => strings.chatActionShowLayers,
      UiActionName.focusMap => strings.chatActionFocusMap,
      UiActionName.drawRoute => strings.chatActionDrawRoute,
      UiActionName.highlightFeatures => strings.chatActionHighlight,
    };

String _outcomeLabel(AppLocalizations strings, MapActionOutcome outcome) =>
    switch (outcome) {
      MapActionOutcome.applied => strings.chatActionApplied,
      MapActionOutcome.partial => strings.chatActionPartial,
      MapActionOutcome.ignored => strings.chatActionIgnored,
      MapActionOutcome.unsupported => strings.chatActionUnsupported,
      MapActionOutcome.restored => strings.chatActionRestored,
    };

/// One exchange: the user's input, then what the agent streamed back in the
/// order it arrived: status lines, text, UI actions, cards, a question, the
/// usage line and any error.
class ChatTurnView extends StatelessWidget {
  const ChatTurnView({
    required this.turn,
    required this.isLast,
    this.pendingQuestion,
    this.onAnswer,
    this.onRetry,
    this.onCardItemTap,
    this.onOpenSource,
    super.key,
  });

  final ChatTurn turn;
  final bool isLast;
  final AgentQuestion? pendingQuestion;
  final void Function(AgentQuestion question, String option)? onAnswer;
  final VoidCallback? onRetry;
  final CardItemCallback? onCardItemTap;
  final ValueChanged<Uri>? onOpenSource;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final question = turn.question;
    final showOptions =
        isLast &&
        question != null &&
        pendingQuestion?.id == question.id &&
        onAnswer != null;
    final error = turn.error;
    final usage = turn.usage;
    return Padding(
      key: ValueKey('chat-turn-${turn.localId}'),
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 480),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: colors.primaryContainer,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(
                chatInputText(strings, turn.input),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: colors.onPrimaryContainer,
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          for (final status in turn.statuses)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(
                children: [
                  Icon(Icons.bolt, size: 14, color: colors.tertiary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      status,
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (turn.isRunning && turn.text.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 8),
                  Text(strings.chatThinking, style: theme.textTheme.bodySmall),
                ],
              ),
            ),
          if (turn.text.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: SelectableText(
                turn.text,
                key: ValueKey('chat-answer-${turn.localId}'),
              ),
            ),
          if (turn.actions.isNotEmpty)
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final record in turn.actions)
                  Tooltip(
                    message: record.report.skipped.isEmpty
                        ? ''
                        : strings.chatActionSkipped(
                            record.report.skipped.join(', '),
                          ),
                    child: Chip(
                      avatar: Icon(switch (record.report.outcome) {
                        MapActionOutcome.applied => Icons.check,
                        MapActionOutcome.partial => Icons.rule,
                        MapActionOutcome.ignored => Icons.block,
                        MapActionOutcome.unsupported =>
                          Icons.construction_outlined,
                        MapActionOutcome.restored => Icons.history,
                      }, size: 16),
                      label: Text(
                        '${_actionLabel(strings, record.action.action)} · '
                        '${_outcomeLabel(strings, record.report.outcome)}',
                        style: theme.textTheme.labelSmall,
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
              ],
            ),
          for (final card in turn.cards)
            buildAgentCard(
              card,
              onItemTap: onCardItemTap,
              onOpenSource: onOpenSource,
            ),
          if (question != null) ...[
            const SizedBox(height: 4),
            Text(question.text, style: theme.textTheme.titleSmall),
            if (showOptions) ...[
              const SizedBox(height: 4),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  for (final option in question.options)
                    FilledButton.tonal(
                      key: ValueKey('chat-option-$option'),
                      onPressed: () => onAnswer!(question, option),
                      child: Text(option),
                    ),
                ],
              ),
              if (question.allowFreeText)
                Text(
                  strings.chatQuestionFreeText,
                  style: theme.textTheme.bodySmall,
                ),
            ],
          ],
          if (turn.phase == ChatTurnPhase.cancelled)
            Text(
              strings.chatTurnCancelled,
              style: theme.textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          if (turn.stop == StopReason.budget)
            Text(strings.chatStopBudget, style: theme.textTheme.bodySmall),
          if (error != null) ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: colors.errorContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                chatErrorText(strings, error),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colors.onErrorContainer,
                ),
              ),
            ),
          ],
          if (isLast &&
              onRetry != null &&
              (turn.phase == ChatTurnPhase.cancelled ||
                  (error != null && error.retryable)))
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const ValueKey('chat-retry'),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(strings.chatRetry),
              ),
            ),
          if (usage != null) ...[
            const SizedBox(height: 4),
            Text(
              strings.chatUsage(
                usage.calls,
                _count(usage.input),
                _count(usage.cachedInput),
                _count(usage.output),
                _count(usage.thoughts),
                _count(usage.total),
              ),
              key: ValueKey('chat-usage-${turn.localId}'),
              style: theme.textTheme.labelSmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
            if (usage.complete == false)
              Text(
                strings.chatUsageIncomplete,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: colors.error,
                ),
              ),
          ],
        ],
      ),
    );
  }

  static String _count(int value) =>
      NumberFormat.decimalPattern('en_AU').format(value);
}
