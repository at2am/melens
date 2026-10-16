import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';

/// The questions a turn asked. One question shows a button per option and a
/// tap answers it. Several questions (a plan turn asks up to three about the
/// plan it showed: when, how long, how) show their options as choices; the
/// user picks for any of them and sends the picks together, so the next
/// turn revises the plan once for all of them. While the questions are not
/// pending, only their text shows.
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

  void _send() {
    widget.onAnswers?.call([
      for (final question in widget.questions)
        if (_picked[question.id] case final value?)
          QuestionAnswer(questionId: question.id, value: value),
    ]);
  }

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
    return Column(
      key: const ValueKey('chat-questions'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 4),
        if (aboutPlan && canAnswer)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              strings.chatQuestionsAboutPlan,
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
                      onSelected: (selected) => setState(() {
                        if (selected) {
                          _picked[question.id] = option;
                        } else {
                          _picked.remove(question.id);
                        }
                      }),
                    ),
                ],
              ),
            ),
        ],
        if (canAnswer) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              key: const ValueKey('chat-questions-send'),
              onPressed: _picked.isEmpty ? null : _send,
              icon: const Icon(Icons.auto_fix_high, size: 18),
              label: Text(strings.chatQuestionsSend),
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
