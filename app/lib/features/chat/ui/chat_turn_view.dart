import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../cards/ui/card_registry.dart';
import '../../map/state/map_actions.dart';
import '../../plans/ui/plan_card_actions.dart';
import '../state/chat_models.dart';
import 'chat_photo_view.dart';

String chatInputText(AppLocalizations strings, TurnInput input) =>
    switch (input) {
      TextTurnInput(:final text) => text,
      AreaTurnInput(:final lat, :final lng) => strings.chatInputArea(
        lat.toStringAsFixed(5),
        lng.toStringAsFixed(5),
      ),
      AnalyseTurnInput(:final featureId) => strings.chatInputAnalyse(featureId),
      AnswerTurnInput(:final value) => strings.chatInputAnswer(value),
      RefineTurnInput(:final text) => text,
    };

String chatErrorText(AppLocalizations strings, ChatError error) =>
    switch (error.kind) {
      ChatErrorKind.signIn => strings.chatErrorSignIn,
      ChatErrorKind.signInFailed => strings.chatErrorSignInFailed,
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
        AgentErrorCode.forbidden ||
        AgentErrorCode.conflict ||
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
      MapActionOutcome.restored => strings.chatActionRestored,
    };

/// The tool error codes of tools.md, in the user's words; an unknown code is
/// shown as sent.
String _toolErrorLabel(AppLocalizations strings, String code) => switch (code) {
  'invalid_arguments' => strings.chatToolErrorInvalidArguments,
  'not_found' => strings.chatToolErrorNotFound,
  'not_an_anomaly' => strings.chatToolErrorNotAnAnomaly,
  'unverified_sources' => strings.chatToolErrorUnverifiedSources,
  'route_not_found' => strings.chatToolErrorRouteNotFound,
  'upstream_unavailable' => strings.chatToolErrorUpstreamUnavailable,
  _ => strings.chatStepFailed(code),
};

String _durationLabel(AppLocalizations strings, int durationMs) =>
    durationMs >= 1000
    ? strings.chatStepSeconds((durationMs / 1000).toStringAsFixed(1))
    : strings.chatStepMillis(durationMs);

IconData _outcomeIcon(MapActionOutcome outcome) => switch (outcome) {
  MapActionOutcome.applied => Icons.check,
  MapActionOutcome.partial => Icons.rule,
  MapActionOutcome.ignored => Icons.block,
  MapActionOutcome.restored => Icons.history,
};

/// One exchange: the user's input and photos, then what the agent did in the
/// order it happened. Each tool call is a step row that shows a spinner while it runs
/// and its result afterwards; the answer text appears around the steps as
/// it streamed; a Thinking or Writing line shows while the turn runs with no
/// step in progress. Cards, the question, the usage line and any error
/// follow.
class ChatTurnView extends StatelessWidget {
  const ChatTurnView({
    required this.turn,
    required this.isLast,
    this.pendingQuestion,
    this.onAnswer,
    this.onRetry,
    this.onCardItemTap,
    this.onOpenSource,
    this.refinedPlanTitle,
    super.key,
  });

  final ChatTurn turn;
  final bool isLast;
  final AgentQuestion? pendingQuestion;
  final void Function(AgentQuestion question, String option)? onAnswer;
  final VoidCallback? onRetry;
  final CardItemCallback? onCardItemTap;
  final ValueChanged<Uri>? onOpenSource;

  /// For a `refine` input, the title of the plan it changes, when the
  /// conversation still shows it.
  final String? refinedPlanTitle;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final question = turn.question;
    final refines = turn.input is RefineTurnInput;
    final showOptions =
        isLast &&
        question != null &&
        pendingQuestion?.id == question.id &&
        onAnswer != null;
    final error = turn.error;
    final usage = turn.usage;
    final unattached = turn.unattachedActions;
    final inputText = chatInputText(strings, turn.input);
    return Padding(
      key: ValueKey('chat-turn-${turn.localId}'),
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (turn.photos.isNotEmpty)
            Padding(
              padding: EdgeInsets.only(bottom: inputText.isEmpty ? 0 : 4),
              child: Wrap(
                alignment: WrapAlignment.end,
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final (index, photo) in turn.photos.indexed)
                    ChatPhotoView(
                      key: ValueKey('chat-photo-${turn.localId}-$index'),
                      photo: photo,
                      size: 96,
                      label: strings.chatPhoto(index + 1),
                      expandable: true,
                    ),
                ],
              ),
            ),
          if (refines)
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.tune, size: 14, color: colors.onSurfaceVariant),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        refinedPlanTitle == null
                            ? strings.chatRefinedPlanUnknown
                            : strings.chatRefinedPlan(refinedPlanTitle!),
                        key: ValueKey('chat-refined-${turn.localId}'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (inputText.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: Container(
                constraints: const BoxConstraints(maxWidth: 480),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  inputText,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colors.onPrimaryContainer,
                  ),
                ),
              ),
            ),
          const SizedBox(height: 8),
          ..._timeline(strings, theme),
          if (unattached.isNotEmpty)
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final record in unattached)
                  Tooltip(
                    message: record.report.skipped.isEmpty
                        ? ''
                        : strings.chatActionSkipped(
                            record.report.skipped.join(', '),
                          ),
                    child: Chip(
                      avatar: Icon(
                        _outcomeIcon(record.report.outcome),
                        size: 16,
                      ),
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
              // A plan can be changed or saved once its turn has finished.
              footer: card.type == CardType.plan && !turn.isRunning
                  ? PlanCardActions(card: card)
                  : null,
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
            Align(
              alignment: Alignment.centerLeft,
              child: Tooltip(
                message: strings.chatUsageTooltip,
                child: Text(
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

  /// Steps and text in arrival order: the text that had streamed when a step
  /// started goes before it, the rest after the last step.
  List<Widget> _timeline(AppLocalizations strings, ThemeData theme) {
    final widgets = <Widget>[];
    final text = turn.text;
    var cursor = 0;
    for (final step in turn.steps) {
      final offset = step.textOffset.clamp(cursor, text.length);
      if (offset > cursor) {
        widgets.add(_answer(text.substring(cursor, offset), cursor));
        cursor = offset;
      }
      widgets.add(
        _StepRow(
          key: ValueKey('chat-step-${turn.localId}-${step.id}'),
          step: step,
        ),
      );
    }
    if (text.length > cursor) {
      widgets.add(_answer(text.substring(cursor), cursor));
    }
    if (turn.isThinking) {
      widgets.add(
        Padding(
          key: ValueKey('chat-progress-${turn.localId}'),
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 8),
              Text(
                turn.isWriting ? strings.chatWriting : strings.chatThinking,
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      );
    }
    return widgets;
  }

  Widget _answer(String text, int offset) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: SelectableText(
      text,
      key: ValueKey('chat-answer-${turn.localId}-$offset'),
    ),
  );

  static String _count(int value) =>
      NumberFormat.decimalPattern('en_AU').format(value);
}

/// One tool call: its state as an icon, the status line with the argument
/// summary, and on the right what it returned: rows, the UI action outcome,
/// "reused", the duration, or the error.
class _StepRow extends StatelessWidget {
  const _StepRow({required this.step, super.key});

  final ChatStep step;

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final action = step.action;
    final error = step.error;
    final results = <String>[
      if (error != null)
        _toolErrorLabel(strings, error)
      else ...[
        if (step.rows case final rows?) strings.chatStepRows(rows),
        if (action != null) _outcomeLabel(strings, action.report.outcome),
        if (step.memo) strings.chatStepMemo,
      ],
      if (step.durationMs case final durationMs? when !step.memo)
        _durationLabel(strings, durationMs),
    ];
    final Widget leading = switch (step.state) {
      AgentStepState.running => const CircularProgressIndicator(strokeWidth: 2),
      AgentStepState.done => Icon(
        action == null
            ? Icons.check_circle_outline
            : _outcomeIcon(action.report.outcome),
        size: 16,
        color: colors.tertiary,
      ),
      AgentStepState.failed => Icon(
        Icons.error_outline,
        size: 16,
        color: colors.error,
      ),
    };
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: SizedBox(
              width: 16,
              height: 16,
              child: Center(child: leading),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: step.text),
                  if (step.detail case final detail?)
                    TextSpan(
                      text: ' · $detail',
                      style: TextStyle(color: colors.onSurfaceVariant),
                    ),
                ],
              ),
              style: theme.textTheme.bodySmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (results.isNotEmpty) ...[
            const SizedBox(width: 8),
            Text(
              results.join(' · '),
              style: theme.textTheme.labelSmall?.copyWith(
                color: error == null ? colors.onSurfaceVariant : colors.error,
              ),
            ),
          ],
        ],
      ),
    );
    if (action == null || action.report.skipped.isEmpty) return row;
    return Tooltip(
      message: strings.chatActionSkipped(action.report.skipped.join(', ')),
      child: row,
    );
  }
}
