import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../cards/ui/card_registry.dart';
import '../../map/data/map_models.dart';
import '../../map/state/selection_controller.dart';
import '../state/chat_controller.dart';
import '../state/chat_models.dart';
import '../state/request_context.dart';
import 'chat_turn_view.dart';
import 'session_list.dart';

/// The agent chat: streamed turns, cards, questions, the session list and
/// the input box (UC-13). It reads and writes [chatControllerProvider], so
/// it can be closed and reopened without losing the conversation.
class ChatPanel extends ConsumerStatefulWidget {
  const ChatPanel({
    this.onClose,
    this.onCardItemTap,
    this.onOpenSource,
    super.key,
  });

  final VoidCallback? onClose;

  /// A card item was tapped: the map screen selects or focuses it.
  final CardItemCallback? onCardItemTap;
  final ValueChanged<Uri>? onOpenSource;

  @override
  ConsumerState<ChatPanel> createState() => _ChatPanelState();
}

class _ChatPanelState extends ConsumerState<ChatPanel> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _inputFocus = FocusNode();
  int _renderedTurns = 0;
  int _renderedLength = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(ref.read(chatControllerProvider.notifier).start());
    });
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    _inputFocus.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    _input.clear();
    unawaited(
      ref
          .read(chatControllerProvider.notifier)
          .send(TurnInput.text(text: text)),
    );
    _inputFocus.requestFocus();
  }

  void _scrollToEnd(ChatState chat) {
    final last = chat.turns.isEmpty ? null : chat.turns.last;
    final length =
        (last?.text.length ?? 0) +
        (last?.statuses.length ?? 0) +
        (last?.cards.length ?? 0);
    if (chat.turns.length == _renderedTurns && length == _renderedLength) {
      return;
    }
    _renderedTurns = chat.turns.length;
    _renderedLength = length;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  @override
  Widget build(BuildContext context) {
    final strings = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final chat = ref.watch(chatControllerProvider);
    final controller = ref.read(chatControllerProvider.notifier);
    final selection = ref.watch(selectionControllerProvider);
    _scrollToEnd(chat);
    final selectedItem = selection.item;
    final selectedPoint = pointOfGeometry(selectedItem?.geometry);
    final error = chat.error;
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 4, 0),
            child: Row(
              children: [
                Icon(Icons.smart_toy_outlined, color: colors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    chat.sessionTitle.isEmpty
                        ? strings.chatPanelTitle
                        : chat.sessionTitle,
                    style: theme.textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  key: const ValueKey('chat-sessions'),
                  tooltip: strings.chatSessions,
                  onPressed: () => unawaited(showSessionListSheet(context)),
                  icon: const Icon(Icons.history),
                ),
                IconButton(
                  key: const ValueKey('chat-new-session'),
                  tooltip: strings.chatNewSession,
                  onPressed: chat.isRestoring
                      ? null
                      : () => unawaited(controller.newSession()),
                  icon: const Icon(Icons.add_comment_outlined),
                ),
                if (widget.onClose != null)
                  IconButton(
                    key: const ValueKey('chat-close'),
                    tooltip: strings.chatClose,
                    onPressed: widget.onClose,
                    icon: const Icon(Icons.close),
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: chat.isRestoring
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const CircularProgressIndicator(),
                        const SizedBox(height: 8),
                        Text(strings.chatRestoring),
                      ],
                    ),
                  )
                : chat.turns.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        strings.chatEmpty,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                  )
                : ListView.builder(
                    key: const ValueKey('chat-turns'),
                    controller: _scroll,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    itemCount: chat.turns.length,
                    itemBuilder: (context, index) {
                      final turn = chat.turns[index];
                      final isLast = index == chat.turns.length - 1;
                      return ChatTurnView(
                        turn: turn,
                        isLast: isLast,
                        pendingQuestion: chat.pendingQuestion,
                        onAnswer: chat.canSend
                            ? (question, option) =>
                                  unawaited(controller.answer(question, option))
                            : null,
                        onRetry: chat.canSend
                            ? () => unawaited(controller.retryLast())
                            : null,
                        onCardItemTap: widget.onCardItemTap,
                        onOpenSource: widget.onOpenSource,
                      );
                    },
                  ),
          ),
          if (error != null)
            Container(
              key: const ValueKey('chat-error'),
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      chatErrorText(strings, error),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colors.error,
                      ),
                    ),
                  ),
                  TextButton(
                    key: const ValueKey('chat-reconnect'),
                    onPressed: () => unawaited(controller.reconnect()),
                    child: Text(strings.chatRetry),
                  ),
                ],
              ),
            ),
          if (selectedItem != null &&
              (selectedItem is AnomalyMapItem || selectedPoint != null))
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Wrap(
                spacing: 8,
                children: [
                  if (selectedItem is AnomalyMapItem)
                    ActionChip(
                      key: const ValueKey('chat-analyse-selected'),
                      avatar: const Icon(Icons.insights_outlined, size: 16),
                      label: Text(strings.chatAnalyseSelected),
                      onPressed: chat.canSend
                          ? () => unawaited(
                              controller.send(
                                TurnInput.analyse(featureId: selectedItem.id),
                              ),
                            )
                          : null,
                    ),
                  if (selectedPoint != null)
                    ActionChip(
                      key: const ValueKey('chat-brief-selected'),
                      avatar: const Icon(Icons.explore_outlined, size: 16),
                      label: Text(strings.chatBriefSelected),
                      onPressed: chat.canSend
                          ? () => unawaited(
                              controller.send(
                                TurnInput.area(
                                  lat: selectedPoint.lat,
                                  lng: selectedPoint.lng,
                                ),
                              ),
                            )
                          : null,
                    ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 8, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: CallbackShortcuts(
                    bindings: {
                      const SingleActivator(LogicalKeyboardKey.enter): _submit,
                    },
                    child: TextField(
                      key: const ValueKey('chat-input'),
                      controller: _input,
                      focusNode: _inputFocus,
                      enabled: !chat.isRestoring,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        hintText: strings.chatInputHint,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                if (chat.isRunning)
                  IconButton.filledTonal(
                    key: const ValueKey('chat-stop'),
                    tooltip: strings.chatStop,
                    onPressed: controller.cancel,
                    icon: const Icon(Icons.stop),
                  )
                else
                  IconButton.filled(
                    key: const ValueKey('chat-send'),
                    tooltip: strings.chatSend,
                    onPressed: chat.canSend ? _submit : null,
                    icon: const Icon(Icons.send),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
