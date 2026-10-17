import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../../core/time/melbourne_time.dart';
import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../cards/ui/card_registry.dart';
import '../../map/state/map_actions.dart';
import '../../plans/ui/plan_card_actions.dart';
import '../state/chat_models.dart';
import 'chat_markdown.dart';
import 'chat_photo_view.dart';
import 'chat_questions_view.dart';

String chatInputText(AppLocalizations strings, TurnInput input) =>
    switch (input) {
      TextTurnInput(:final text) => text,
      AreaTurnInput(:final lat, :final lng) => strings.chatInputArea(
        lat.toStringAsFixed(5),
        lng.toStringAsFixed(5),
      ),
      AnalyseTurnInput(:final featureId) => strings.chatInputAnalyse(featureId),
      AnswerTurnInput(:final value) => strings.chatInputAnswer(value),
      AnswersTurnInput(:final answers) => strings.chatInputAnswers(
        answers.map((answer) => answer.value).join(', '),
      ),
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
    this.onAnswers,
    this.onRetry,
    this.onUndoMap,
    this.onCardItemTap,
    this.onOpenSource,
    this.refinedPlanTitle,
    super.key,
  });

  final ChatTurn turn;
  final bool isLast;
  final AgentQuestion? pendingQuestion;
  final void Function(AgentQuestion question, String option)? onAnswer;

  /// Answers several questions of this turn at once.
  final ValueChanged<List<QuestionAnswer>>? onAnswers;
  final VoidCallback? onRetry;

  /// Puts the map back as it was before this turn changed it.
  final VoidCallback? onUndoMap;
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
    final pending =
        isLast && question != null && pendingQuestion?.id == question.id;
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
          if (question != null)
            ChatQuestionsView(
              key: ValueKey('chat-questions-${turn.localId}'),
              questions: turn.questions,
              active: pending,
              onAnswer: onAnswer,
              onAnswers: onAnswers,
            ),
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
          if (turn.mapBefore != null && !turn.isRunning)
            if (turn.mapUndone)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(
                  strings.chatMapUndone,
                  key: ValueKey('chat-map-undone-${turn.localId}'),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              )
            else if (isLast && onUndoMap != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: ValueKey('chat-undo-map-${turn.localId}'),
                  onPressed: onUndoMap,
                  icon: const Icon(Icons.undo, size: 18),
                  label: Text(strings.chatUndoMap),
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
    if (turn.reconnecting || turn.isThinking) {
      final since = turn.thinkingSince;
      final label = turn.reconnecting
          ? strings.chatReconnecting
          : turn.isWriting
          ? strings.chatWriting
          : strings.chatThinking;
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
              Flexible(
                child: Text(
                  label,
                  style: theme.textTheme.bodySmall,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // How long the model has worked with nothing to show yet.
              if (since != null && !turn.reconnecting && !turn.isWriting)
                _Elapsed(
                  since: since,
                  builder: (elapsed) => elapsed.inSeconds < 3
                      ? const SizedBox.shrink()
                      : Text(
                          ' · ${strings.chatElapsed(elapsed.inSeconds)}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
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
    child: _AnswerText(
      text: text,
      reveal: turn.isRunning,
      onOpenLink: onOpenSource,
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
    final startedAt = step.startedAt;
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
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
                // A slow source (Google grounding takes up to a minute)
                // says so rather than looking stuck.
                if (step.isRunning && startedAt != null)
                  _Elapsed(
                    since: startedAt,
                    builder: (elapsed) => elapsed < _slowStep
                        ? const SizedBox.shrink()
                        : Text(
                            strings.chatStepSlow,
                            key: ValueKey('chat-step-slow-${step.id}'),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                  ),
              ],
            ),
          ),
          if (step.isRunning && startedAt != null)
            _Elapsed(
              since: startedAt,
              builder: (elapsed) => elapsed.inSeconds < 3
                  ? const SizedBox.shrink()
                  : Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: Text(
                        strings.chatElapsed(elapsed.inSeconds),
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
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

/// A running step slower than this says that its source can take a while.
const _slowStep = Duration(seconds: 12);

/// Rebuilds once a second with the time since [since], while it is shown.
class _Elapsed extends ConsumerStatefulWidget {
  const _Elapsed({required this.since, required this.builder});

  final DateTime since;
  final Widget Function(Duration elapsed) builder;

  @override
  ConsumerState<_Elapsed> createState() => _ElapsedState();
}

class _ElapsedState extends ConsumerState<_Elapsed> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final elapsed = ref
        .read(melbourneClockProvider)
        .now()
        .difference(widget.since);
    return widget.builder(elapsed.isNegative ? Duration.zero : elapsed);
  }
}

/// Answer text, as Markdown when it uses any. While the turn runs, a long
/// piece that arrives at once (a model call that streamed no partial text)
/// is revealed over a moment instead of appearing in one jump.
class _AnswerText extends StatefulWidget {
  const _AnswerText({
    required this.text,
    required this.reveal,
    this.onOpenLink,
    super.key,
  });

  final String text;
  final bool reveal;
  final ValueChanged<Uri>? onOpenLink;

  @override
  State<_AnswerText> createState() => _AnswerTextState();
}

class _AnswerTextState extends State<_AnswerText>
    with SingleTickerProviderStateMixin {
  /// Arrivals shorter than this show at once, as streamed text does.
  static const _revealFrom = 120;

  /// Characters a second while revealing; a piece never takes longer than
  /// [_longestReveal].
  static const _charsPerSecond = 900;
  static const _longestReveal = Duration(milliseconds: 700);

  late final AnimationController _reveal = AnimationController(vsync: this)
    ..addListener(() => setState(() {}));
  int _from = 0;
  int _to = 0;

  @override
  void initState() {
    super.initState();
    _revealTo(widget.text.length, from: 0);
  }

  @override
  void didUpdateWidget(_AnswerText old) {
    super.didUpdateWidget(old);
    if (widget.text.length != old.text.length) {
      _revealTo(widget.text.length, from: _shown);
    }
  }

  int get _shown => _reveal.isAnimating
      ? (_from + (_to - _from) * _reveal.value).round()
      : _to;

  void _revealTo(int length, {required int from}) {
    _reveal.stop();
    _from = from.clamp(0, length);
    _to = length;
    if (!widget.reveal || length - _from < _revealFrom) return;
    final millis = ((length - _from) * 1000 / _charsPerSecond).round();
    _reveal.duration = Duration(
      milliseconds: millis.clamp(0, _longestReveal.inMilliseconds),
    );
    unawaited(_reveal.forward(from: 0));
  }

  @override
  void dispose() {
    _reveal.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.text.substring(0, _shown.clamp(0, widget.text.length));
    return hasChatMarkdown(text)
        ? ChatMarkdown(text, onOpenLink: widget.onOpenLink)
        : SelectableText(text);
  }
}
