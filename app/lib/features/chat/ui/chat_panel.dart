import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:logging/logging.dart';
import 'package:material_ui/material_ui.dart';

import '../../../l10n/app_localizations.dart';
import '../../agent/data/agent_models.dart';
import '../../cards/ui/card_registry.dart';
import '../../map/data/map_models.dart';
import '../../map/state/selection_controller.dart';
import '../data/chat_photos.dart';
import '../state/chat_controller.dart';
import '../state/chat_draft.dart';
import '../state/chat_models.dart';
import '../state/chat_photo_providers.dart';
import '../state/request_context.dart';
import 'chat_photo_view.dart';
import 'chat_turn_view.dart';
import 'session_list.dart';

/// The agent chat: streamed turns, cards, questions, the session list and
/// the input box with its photos (UC-13). A message sent while a turn runs
/// interrupts it; the stop button stops it. It reads and writes
/// [chatControllerProvider], so it can be closed and reopened without losing
/// the conversation.
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
  static final _log = Logger('ChatPanel');
  late final ChatDraft _draft;
  TextEditingController get _input => _draft.input;
  final _scroll = ScrollController();
  final _inputFocus = FocusNode();
  List<ChatPhoto> get _photos => _draft.photos;
  String? get _photoNotice => _draft.photoNotice;
  set _photoNotice(String? notice) => _draft.photoNotice = notice;
  int _renderedTurns = 0;
  int _renderedLength = 0;

  @override
  void initState() {
    super.initState();
    _draft = ref.read(chatDraftProvider);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(ref.read(chatControllerProvider.notifier).start());
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    _inputFocus.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _input.text.trim();
    final refining = ref.read(chatControllerProvider).refining;
    // A change to a plan needs words; photos alone cannot say what to change.
    if (text.isEmpty && (_photos.isEmpty || refining != null)) return;
    final photos = List.of(_photos);
    _input.clear();
    setState(() {
      _photos.clear();
      _photoNotice = null;
    });
    unawaited(
      ref
          .read(chatControllerProvider.notifier)
          .send(
            refining == null
                ? TurnInput.text(text: text)
                : TurnInput.refine(cardId: refining.id, text: text),
            photos: photos,
          ),
    );
    _inputFocus.requestFocus();
  }

  /// A suggested change to the plan being refined, sent as it is.
  void _sendRefinement(AgentCard plan, String text) {
    unawaited(
      ref
          .read(chatControllerProvider.notifier)
          .send(TurnInput.refine(cardId: plan.id, text: text)),
    );
  }

  /// The title of a plan card the conversation shows, by id.
  static String? _planTitle(ChatState chat, String cardId) {
    for (final turn in chat.turns) {
      for (final card in turn.cards) {
        if (card.id == cardId) return card.title;
      }
    }
    return null;
  }

  /// The camera is offered on phones; a browser's file chooser offers it
  /// itself where the device has one.
  bool get _offersCamera =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  Future<void> _pickPhotos() async {
    final strings = AppLocalizations.of(context);
    final remaining = maxPhotosPerTurn - _photos.length;
    if (remaining <= 0) {
      setState(() => _photoNotice = strings.chatPhotoLimit(maxPhotosPerTurn));
      return;
    }
    final source = _offersCamera
        ? await showModalBottomSheet<PhotoSource>(
            context: context,
            builder: (sheetContext) => SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ListTile(
                    leading: const Icon(Icons.photo_library_outlined),
                    title: Text(strings.chatPhotoGallery),
                    onTap: () =>
                        Navigator.of(sheetContext).pop(PhotoSource.gallery),
                  ),
                  ListTile(
                    leading: const Icon(Icons.photo_camera_outlined),
                    title: Text(strings.chatPhotoCamera),
                    onTap: () =>
                        Navigator.of(sheetContext).pop(PhotoSource.camera),
                  ),
                ],
              ),
            ),
          )
        : PhotoSource.gallery;
    if (source == null || !mounted) return;
    final PhotoPick pick;
    try {
      pick = await ref.read(photoPickerProvider).pick(source, limit: remaining);
    } on Object catch (error, stack) {
      _log.warning('The photo picker failed', error, stack);
      if (mounted) setState(() => _photoNotice = strings.chatPhotoPickFailed);
      return;
    }
    if (!mounted) return;
    setState(() {
      _photos.addAll(pick.photos.take(maxPhotosPerTurn - _photos.length));
      _photoNotice = pick.rejected > 0
          ? strings.chatPhotosRejected(pick.rejected)
          : null;
    });
    _inputFocus.requestFocus();
  }

  void _scrollToEnd(ChatState chat) {
    final last = chat.turns.isEmpty ? null : chat.turns.last;
    // Every change that adds a row to the last turn moves the scroll: text,
    // a step starting or finishing, a card.
    final steps = last?.steps ?? const <ChatStep>[];
    final length =
        (last?.text.length ?? 0) +
        steps.fold<int>(0, (sum, step) => sum + (step.isRunning ? 1 : 2)) +
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
    // Change plan puts the cursor in the box, ready for what to change.
    ref.listen(chatControllerProvider.select((state) => state.refining), (
      previous,
      next,
    ) {
      if (next != null && next.id != previous?.id) _inputFocus.requestFocus();
    });
    final refining = chat.refining;
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
                        onRetry: chat.canSend && !chat.isRunning
                            ? () => unawaited(controller.retryLast())
                            : null,
                        onCardItemTap: widget.onCardItemTap,
                        onOpenSource: widget.onOpenSource,
                        refinedPlanTitle: switch (turn.input) {
                          RefineTurnInput(:final cardId) => _planTitle(
                            chat,
                            cardId,
                          ),
                          _ => null,
                        },
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
          if (refining != null)
            Padding(
              key: const ValueKey('chat-refining'),
              padding: const EdgeInsets.fromLTRB(12, 8, 4, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.tune, size: 16, color: colors.primary),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          strings.chatRefiningPlan(refining.title),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.labelLarge,
                        ),
                      ),
                      IconButton(
                        key: const ValueKey('chat-refining-cancel'),
                        tooltip: strings.planRefineCancel,
                        visualDensity: VisualDensity.compact,
                        onPressed: controller.cancelRefine,
                        icon: const Icon(Icons.close, size: 18),
                      ),
                    ],
                  ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      for (final (index, suggestion) in [
                        strings.planRefineShorter,
                        strings.planRefineCheaper,
                        strings.planRefineLater,
                        strings.planRefineIndoors,
                      ].indexed)
                        ActionChip(
                          key: ValueKey('chat-refine-suggestion-$index'),
                          label: Text(suggestion),
                          onPressed: chat.canSend
                              ? () => _sendRefinement(refining, suggestion)
                              : null,
                        ),
                    ],
                  ),
                ],
              ),
            ),
          if (_photos.isNotEmpty || _photoNotice != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_photos.isNotEmpty)
                    Wrap(
                      key: const ValueKey('chat-pending-photos'),
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final (index, photo) in _photos.indexed)
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              ChatPhotoView(
                                photo: photo,
                                size: 56,
                                label: strings.chatPhoto(index + 1),
                              ),
                              Positioned(
                                top: -10,
                                right: -10,
                                child: IconButton.filledTonal(
                                  key: ValueKey('chat-photo-remove-$index'),
                                  tooltip: strings.chatPhotoRemove,
                                  visualDensity: VisualDensity.compact,
                                  iconSize: 14,
                                  onPressed: () => setState(() {
                                    _photos.removeAt(index);
                                    _photoNotice = null;
                                  }),
                                  icon: const Icon(Icons.close),
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
                  if (_photoNotice case final notice?)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        notice,
                        key: const ValueKey('chat-photo-notice'),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.error,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 8, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton(
                  key: const ValueKey('chat-attach'),
                  tooltip: strings.chatAttachPhotos,
                  onPressed: chat.isRestoring
                      ? null
                      : () => unawaited(_pickPhotos()),
                  icon: const Icon(Icons.add_photo_alternate_outlined),
                ),
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
                        hintText: refining != null
                            ? strings.chatInputHintRefine
                            : chat.isRunning
                            ? strings.chatInputHintRunning
                            : strings.chatInputHint,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                if (chat.isRunning) ...[
                  IconButton.filledTonal(
                    key: const ValueKey('chat-stop'),
                    tooltip: strings.chatStop,
                    onPressed: controller.cancel,
                    icon: const Icon(Icons.stop),
                  ),
                  const SizedBox(width: 4),
                ],
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
