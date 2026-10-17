import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';

/// The questions a turn asked. One question shows a button per option and a
/// tap answers it. Several questions (the agent asks up to three before it
/// makes or changes a plan: when, how long, how) show their options as
/// choices, and a question that takes free text also offers "Other…" with a
/// box for the user's own words. The user answers any of them and sends the
/// answers together, so the next turn makes or revises the plan once for all
/// of them; a skipped question goes as "No preference" and the agent assumes
/// a default. While the questions are not pending, only their text shows.
class ChatQuestionsView extends StatefulWidget {
  const ChatQuestionsView({
    required this.questions,
    required this.active,
    this.onAnswer,
    this.onAnswers,
    super.key,
  });

  final List<AgentQuestion> questions;

  /// Whether the agent still waits on these questions and the user may
  /// answer them now.
  final bool active;
  final void Function(AgentQuestion question, String option)? onAnswer;
  final ValueChanged<List<QuestionAnswer>>? onAnswers;

  @override
  State<ChatQuestionsView> createState() => _ChatQuestionsViewState();
}

class _ChatQuestionsViewState extends State<ChatQuestionsView> {
  /// The option picked for each question id.
  final Map<String, String> _picked = {};

  /// The user's own words for each question whose "Other…" is chosen.
  final Map<String, TextEditingController> _other = {};

  @override
  void dispose() {
    for (final controller in _other.values) {
      controller.dispose();
    }
    super.dispose();
  }

  String? _answerOf(AgentQuestion question) {
    if (_other[question.id] case final controller?) {
      final text = controller.text.trim();
      return text.isEmpty ? null : text.substring(0, text.length.clamp(0, 200));
    }
    return _picked[question.id];
  }

  void _send(String noPreference) {
    widget.onAnswers?.call([
      for (final question in widget.questions)
        QuestionAnswer(
          questionId: question.id,
          value: _answerOf(question) ?? noPreference,
        ),
    ]);
  }

  void _pick(AgentQuestion question, String option, bool selected) =>
      setState(() {
        _other.remove(question.id)?.dispose();
        if (selected) {
          _picked[question.id] = option;
        } else {
          _picked.remove(question.id);
        }
      });

  void _pickOther(AgentQuestion question, bool selected) => setState(() {
    _picked.remove(question.id);
    if (selected) {
      _other[question.id] ??= TextEditingController();
    } else {
      _other.remove(question.id)?.dispose();
    }
  });

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final questions = widget.questions;
    if (questions.isEmpty) return const SizedBox.shrink();
    if (questions.length == 1) {
      final question = questions.single;
      final canAnswer = widget.active && widget.onAnswer != null;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 4),
          Text(question.text, style: theme.textTheme.titleSmall),
          if (canAnswer) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final option in question.options)
                  FilledButton.tonal(
                    key: ValueKey('chat-option-$option'),
                    onPressed: () => widget.onAnswer!(question, option),
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
      );
    }
    final canAnswer = widget.active && widget.onAnswers != null;
    final aboutPlan = questions.any((question) => question.planCardId != null);
    // Asked before there is a plan: the answers make it.
    final beforePlan =
        !aboutPlan && questions.any((question) => question.forPlan);
    return Column(
      key: const ValueKey('chat-questions'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 4),
        if ((aboutPlan || beforePlan) && canAnswer)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              beforePlan
                  ? strings.chatQuestionsBeforePlan
                  : strings.chatQuestionsAboutPlan,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        for (final question in questions) ...[
          Text(question.text, style: theme.textTheme.titleSmall),
          if (canAnswer)
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  for (final option in question.options)
                    ChoiceChip(
                      key: ValueKey('chat-question-${question.id}-$option'),
                      label: Text(option),
                      selected: _picked[question.id] == option,
                      onSelected: (selected) =>
                          _pick(question, option, selected),
                    ),
                  if (question.allowFreeText)
                    ChoiceChip(
                      key: ValueKey('chat-question-${question.id}-other'),
                      label: Text(strings.chatQuestionOther),
                      selected: _other.containsKey(question.id),
                      onSelected: (selected) => _pickOther(question, selected),
                    ),
                ],
              ),
            ),
          if (canAnswer && _other[question.id] != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextField(
                key: ValueKey('chat-question-${question.id}-text'),
                controller: _other[question.id],
                autofocus: true,
                maxLength: 200,
                decoration: InputDecoration(
                  hintText: strings.chatQuestionOtherHint,
                  isDense: true,
                  counterText: '',
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),
        ],
        if (canAnswer) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              key: const ValueKey('chat-questions-send'),
              onPressed: () => _send(strings.chatQuestionNoPreference),
              icon: const Icon(Icons.auto_fix_high, size: 18),
              label: Text(
                beforePlan
                    ? strings.chatQuestionsMakePlan
                    : strings.chatQuestionsSend,
              ),
            ),
          ),
          if (questions.any((question) => _answerOf(question) == null))
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                strings.chatQuestionsDefaults,
                key: const ValueKey('chat-questions-defaults'),
                style: theme.textTheme.bodySmall,
              ),
            ),
          if (questions.any((question) => question.allowFreeText))
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                strings.chatQuestionsFreeText,
                style: theme.textTheme.bodySmall,
              ),
            ),
        ],
      ],
    );
  }
}
