import 'dart:async';
import 'dart:convert';

import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../agent/state/agent_providers.dart';
import '../../map/state/map_actions.dart';
import '../data/chat_photos.dart';
import 'chat_models.dart';
import 'request_context.dart';

part 'chat_controller.g.dart';

/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; a message sent while one runs
/// interrupts it. Events are ordered by `seq`.
@Riverpod(keepAlive: true)
class ChatController extends _$ChatController {
  static final _log = Logger('ChatController');
  Completer<void>? _abort;
  int _generation = 0;
  int _nextLocalId = 0;

  AgentClient get _client => ref.read(agentClientProvider);

  @override
  ChatState build() {
    ref.onDispose(_abortRun);
    return const ChatState();
  }

  /// Lists the sessions and reopens the newest one, once per app run.
  Future<void> start() async {
    if (state.started) return;
    state = state.copyWith(started: true);
    await reconnect();
  }

  /// Lists the sessions again and opens the newest when none is open.
  Future<void> reconnect() async {
    final sessions = await _refreshSessions(quiet: false);
    if (sessions != null && sessions.isNotEmpty && state.sessionId == null) {
      await openSession(sessions.first.id);
    }
  }

  /// Sends one input; [photos] go only with a text input, whose text may
  /// then be empty. A turn still running is interrupted: its request is
  /// aborted and the server stops it, stores what it has and runs this one.
  Future<void> send(
    TurnInput input, {
    List<ChatPhoto> photos = const [],
  }) async {
    if (!state.canSend) return;
    final normalised = switch (input) {
      TextTurnInput(:final text) => TurnInput.text(text: text.trim()),
      _ => input,
    };
    final sent = normalised is TextTurnInput
        ? photos
              .where((photo) => photo.bytes != null)
              .take(maxPhotosPerTurn)
              .toList(growable: false)
        : const <ChatPhoto>[];
    if (normalised case TextTurnInput(:final text)
        when text.isEmpty && sent.isEmpty) {
      return;
    }
    if (state.isRunning) {
      _generation++;
      _abortRun();
      _markCancelled();
    }
    var sessionId = state.sessionId;
    if (sessionId == null) {
      try {
        final session = await _client.createSession();
        if (!ref.mounted) return;
        sessionId = session.id;
        state = state.copyWith(
          sessionId: session.id,
          sessionTitle: session.title,
          turns: const [],
          clearPendingQuestion: true,
          clearError: true,
        );
      } on AgentClientException catch (error) {
        if (ref.mounted) state = state.copyWith(error: ChatError.from(error));
        return;
      }
    }
    final generation = ++_generation;
    final abort = Completer<void>();
    _abort = abort;
    state = state.copyWith(
      turns: [
        ...state.turns,
        ChatTurn(
          localId: ++_nextLocalId,
          input: normalised,
          photos: sent,
          phase: ChatTurnPhase.running,
        ),
      ],
      clearPendingQuestion: true,
      clearError: true,
    );
    final context = ref.read(requestContextBuilderProvider)(
      openCardId: _openCardId(),
    );
    try {
      final events = _client.runTurn(
        sessionId,
        TurnRequest(
          input: normalised,
          context: context,
          attachments: sent.isEmpty
              ? null
              : [
                  for (final photo in sent)
                    TurnAttachment(
                      mimeType: photo.mimeType,
                      data: base64Encode(photo.bytes!),
                    ),
                ],
        ),
        abortTrigger: abort.future,
      );
      await for (final event in events) {
        if (!ref.mounted || generation != _generation) return;
        _handle(event);
      }
      if (!ref.mounted || generation != _generation) return;
      if (state.turns.last.isRunning) {
        _finish(
          const ChatError(kind: ChatErrorKind.streamEnded, retryable: true),
        );
      }
    } on AgentTurnAborted {
      if (ref.mounted && generation == _generation) _markCancelled();
    } on AgentClientException catch (error) {
      if (ref.mounted && generation == _generation) {
        _finish(ChatError.from(error));
      }
    } on Object catch (error, stack) {
      _log.severe('Turn failed', error, stack);
      if (ref.mounted && generation == _generation) {
        _finish(
          const ChatError(kind: ChatErrorKind.protocol, retryable: false),
        );
      }
    } finally {
      if (ref.mounted && generation == _generation) {
        _abort = null;
        unawaited(_refreshSessions(quiet: true));
      }
    }
  }

  /// Answers the pending question with one of its options.
  Future<void> answer(AgentQuestion question, String option) =>
      send(TurnInput.answer(questionId: question.id, value: option));

  /// Sends the last failed or cancelled input again, with its photos; a
  /// restored turn's photos are downloaded first.
  Future<void> retryLast() async {
    if (!state.canSend || state.isRunning || state.turns.isEmpty) return;
    final last = state.turns.last;
    if (last.phase == ChatTurnPhase.done) return;
    final generation = _generation;
    final List<ChatPhoto> photos;
    try {
      photos = await Future.wait(last.photos.map(_loadPhoto));
    } on AgentClientException catch (error) {
      if (ref.mounted) state = state.copyWith(error: ChatError.from(error));
      return;
    }
    if (!ref.mounted || generation != _generation) return;
    state = state.copyWith(
      turns: state.turns.sublist(0, state.turns.length - 1),
    );
    await send(last.input, photos: photos);
  }

  Future<ChatPhoto> _loadPhoto(ChatPhoto photo) async {
    final sessionId = photo.sessionId;
    final attachmentId = photo.attachmentId;
    if (photo.bytes != null || sessionId == null || attachmentId == null) {
      return photo;
    }
    return ChatPhoto(
      mimeType: photo.mimeType,
      bytes: await _client.getAttachment(sessionId, attachmentId),
    );
  }

  /// Stops the turn in progress: the request is aborted, and the server is
  /// told directly, so the turn stops even when the disconnect does not
  /// reach it.
  void cancel() {
    if (!state.isRunning) return;
    _generation++;
    _abortRun();
    _markCancelled();
    if (state.sessionId case final sessionId?) {
      unawaited(_cancelOnServer(sessionId));
    }
    unawaited(_refreshSessions(quiet: true));
  }

  Future<void> _cancelOnServer(String sessionId) async {
    try {
      await _client.cancelTurn(sessionId);
    } on AgentClientException catch (error) {
      // The aborted request still reaches the server as a disconnect, and a
      // new message interrupts whatever is left.
      _log.fine('Cancelling the turn on the server failed', error);
    }
  }

  Future<void> openSession(String sessionId) async {
    if (state.isRunning) cancel();
    final generation = ++_generation;
    state = state.copyWith(isRestoring: true, clearError: true);
    try {
      final detail = await _client.getSession(sessionId);
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(
        isRestoring: false,
        sessionId: detail.session.id,
        sessionTitle: detail.session.title,
        turns: [
          for (final turn in detail.turns) _fromStored(detail.session.id, turn),
        ],
        pendingQuestion: detail.pendingQuestion,
        clearPendingQuestion: detail.pendingQuestion == null,
      );
    } on AgentClientException catch (error) {
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(isRestoring: false, error: ChatError.from(error));
    }
  }

  Future<void> newSession() async {
    if (state.isRunning) cancel();
    final generation = ++_generation;
    state = state.copyWith(clearError: true);
    try {
      final session = await _client.createSession();
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(
        sessionId: session.id,
        sessionTitle: session.title,
        turns: const [],
        clearPendingQuestion: true,
      );
      await _refreshSessions(quiet: true);
    } on AgentClientException catch (error) {
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(error: ChatError.from(error));
    }
  }

  Future<void> deleteSession(String sessionId) async {
    if (sessionId == state.sessionId && state.isRunning) cancel();
    try {
      await _client.deleteSession(sessionId);
    } on AgentHttpException catch (error) {
      // Already gone on the server: drop it locally all the same.
      if (!ref.mounted) return;
      if (error.code != AgentErrorCode.notFound) {
        state = state.copyWith(error: ChatError.from(error));
        return;
      }
    } on AgentClientException catch (error) {
      if (ref.mounted) state = state.copyWith(error: ChatError.from(error));
      return;
    }
    if (!ref.mounted) return;
    state = state.copyWith(
      clearSession: sessionId == state.sessionId,
      turns: sessionId == state.sessionId ? const [] : null,
      clearPendingQuestion: sessionId == state.sessionId,
      sessions: state.sessions
          .where((session) => session.id != sessionId)
          .toList(growable: false),
    );
    await _refreshSessions(quiet: true);
  }

  void _handle(AgentEvent event) {
    final turns = state.turns;
    final turn = turns.last;
    if (turn.turnId != null && turn.turnId != event.turnId) {
      _log.warning('Ignoring an event of turn ${event.turnId}');
      return;
    }
    if (event.seq <= turn.lastSeq) return;
    var next = turn.copyWith(turnId: event.turnId, lastSeq: event.seq);
    AgentQuestion? pending;
    switch (event) {
      case AgentStatusEvent():
        next = next.copyWith(steps: _mergeStep(next, event));
      case AgentTextEvent(:final delta):
        next = next.copyWith(text: next.text + delta);
      case AgentUiActionEvent(:final stepId, :final action, :final args):
        final uiAction = UiAction(action: action, args: args);
        final report = ref
            .read(mapActionsControllerProvider.notifier)
            .apply(uiAction);
        final record = ChatActionRecord(action: uiAction, report: report);
        next = next.copyWith(
          actions: [...next.actions, record],
          steps: _attachAction(next.steps, stepId, record),
        );
      case AgentCardEvent(:final card):
        next = next.copyWith(cards: [...next.cards, card]);
      case AgentQuestionEvent(:final question):
        next = next.copyWith(question: question);
        pending = question;
      case AgentUsageEvent(turn: final usage):
        next = next.copyWith(usage: usage);
      case AgentDoneEvent(:final stop, :final usage):
        next = next.copyWith(
          phase: stop == StopReason.cancelled
              ? ChatTurnPhase.cancelled
              : ChatTurnPhase.done,
          stop: stop,
          usage: usage,
        );
      case AgentErrorEvent(:final message, :final retryable, :final usage):
        next = next.copyWith(
          phase: ChatTurnPhase.failed,
          usage: usage,
          error: ChatError(
            kind: ChatErrorKind.server,
            retryable: retryable,
            serverMessage: message,
          ),
        );
    }
    state = state.copyWith(
      turns: [...turns.sublist(0, turns.length - 1), next],
      pendingQuestion: pending,
    );
  }

  /// The running step with this id takes the finished event's fields; a new
  /// id starts a step at the current text length, so the view can place it.
  static List<ChatStep> _mergeStep(ChatTurn turn, AgentStatusEvent event) {
    final index = turn.steps.indexWhere((step) => step.id == event.stepId);
    final existing = index < 0 ? null : turn.steps[index];
    final step = ChatStep(
      id: event.stepId,
      tool: event.tool,
      text: event.text,
      state: event.state,
      detail: event.detail ?? existing?.detail,
      rows: event.rows,
      error: event.error,
      durationMs: event.durationMs,
      memo: event.memo,
      textOffset: existing?.textOffset ?? turn.text.length,
      action: existing?.action,
    );
    if (existing == null) return [...turn.steps, step];
    return [...turn.steps]..[index] = step;
  }

  static List<ChatStep> _attachAction(
    List<ChatStep> steps,
    String stepId,
    ChatActionRecord record,
  ) {
    final index = steps.indexWhere((step) => step.id == stepId);
    if (index < 0) return steps;
    return [...steps]..[index] = steps[index].copyWith(action: record);
  }

  void _finish(ChatError error) {
    _replaceLast(
      (turn) => turn.copyWith(phase: ChatTurnPhase.failed, error: error),
    );
  }

  void _markCancelled() {
    _replaceLast(
      (turn) => turn.isRunning
          ? turn.copyWith(
              phase: ChatTurnPhase.cancelled,
              stop: StopReason.cancelled,
            )
          : turn,
    );
  }

  void _replaceLast(ChatTurn Function(ChatTurn turn) update) {
    final turns = state.turns;
    if (turns.isEmpty) return;
    state = state.copyWith(
      turns: [...turns.sublist(0, turns.length - 1), update(turns.last)],
    );
  }

  void _abortRun() {
    final abort = _abort;
    _abort = null;
    if (abort != null && !abort.isCompleted) abort.complete();
  }

  Future<List<SessionSummary>?> _refreshSessions({required bool quiet}) async {
    if (!quiet) state = state.copyWith(sessionsLoading: true);
    try {
      final sessions = await _client.listSessions();
      if (!ref.mounted) return null;
      final current = state.sessionId;
      final title = sessions
          .where((session) => session.id == current)
          .map((session) => session.title)
          .firstOrNull;
      state = state.copyWith(
        sessions: sessions,
        sessionsLoading: false,
        sessionTitle: title,
        clearError: !quiet,
      );
      return sessions;
    } on AgentClientException catch (error) {
      if (!ref.mounted) return null;
      state = state.copyWith(
        sessionsLoading: false,
        error: quiet ? null : ChatError.from(error),
      );
      return null;
    }
  }

  String? _openCardId() {
    for (final turn in state.turns.reversed) {
      if (turn.cards.isNotEmpty) return turn.cards.last.id;
    }
    return null;
  }

  /// The tools whose successful call stores one `ui_action`, in call order.
  static const _uiActionTools = {
    'show_layers',
    'focus_map',
    'draw_route',
    'highlight_features',
  };

  /// A stored turn redraws as finished steps. The trace and the stored
  /// actions are both in call order, so each successful UI action tool call
  /// takes the next stored action.
  ChatTurn _fromStored(String sessionId, StoredTurn turn) {
    final actions = [
      for (final action in turn.uiActions)
        ChatActionRecord(
          action: action,
          report: const MapActionReport(MapActionOutcome.restored),
        ),
    ];
    var nextAction = 0;
    final steps = <ChatStep>[];
    for (final (index, entry) in turn.trace.indexed) {
      ChatActionRecord? action;
      if (entry.error == null &&
          _uiActionTools.contains(entry.tool) &&
          nextAction < actions.length) {
        action = actions[nextAction++];
      }
      steps.add(
        ChatStep(
          id: 'trace-$index',
          tool: entry.tool,
          text: entry.status ?? entry.tool,
          state: entry.error == null
              ? AgentStepState.done
              : AgentStepState.failed,
          detail: entry.detail,
          rows: entry.rows,
          error: entry.error,
          durationMs: entry.durationMs,
          memo: entry.memo,
          action: action,
        ),
      );
    }
    return ChatTurn(
      localId: ++_nextLocalId,
      input: turn.input,
      photos: [
        for (final attachment in turn.attachments)
          ChatPhoto(
            mimeType: attachment.mimeType,
            sessionId: sessionId,
            attachmentId: attachment.id,
          ),
      ],
      turnId: turn.id,
      phase: turn.stop == StopReason.cancelled
          ? ChatTurnPhase.cancelled
          : ChatTurnPhase.done,
      steps: steps,
      text: turn.text,
      actions: actions,
      cards: turn.cards,
      question: turn.question,
      usage: turn.usage,
      stop: turn.stop,
    );
  }
}
