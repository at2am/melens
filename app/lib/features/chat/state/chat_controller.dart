import 'dart:async';

import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../agent/state/agent_providers.dart';
import '../../map/state/map_actions.dart';
import 'chat_models.dart';
import 'request_context.dart';

part 'chat_controller.g.dart';

/// Conversation state: the open session, its turns, the turn in progress,
/// any pending question and the session list (agent-protocol.md, Flutter
/// implementation). One turn runs at a time; events are ordered by `seq`.
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

  Future<void> send(TurnInput input) async {
    if (!state.canSend) return;
    final normalised = switch (input) {
      TextTurnInput(:final text) => TurnInput.text(text: text.trim()),
      _ => input,
    };
    if (normalised case TextTurnInput(:final text) when text.isEmpty) return;
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
        TurnRequest(input: normalised, context: context),
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

  /// Sends the last failed or cancelled input again.
  Future<void> retryLast() async {
    if (!state.canSend || state.turns.isEmpty) return;
    final last = state.turns.last;
    if (last.phase == ChatTurnPhase.done) return;
    state = state.copyWith(
      turns: state.turns.sublist(0, state.turns.length - 1),
    );
    await send(last.input);
  }

  /// Aborts the turn in progress; the server sees the disconnect.
  void cancel() {
    if (!state.isRunning) return;
    _generation++;
    _abortRun();
    _markCancelled();
    unawaited(_refreshSessions(quiet: true));
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
        turns: detail.turns.map(_fromStored).toList(growable: false),
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
      case AgentStatusEvent(:final text):
        next = next.copyWith(statuses: [...next.statuses, text]);
      case AgentTextEvent(:final delta):
        next = next.copyWith(text: next.text + delta);
      case AgentUiActionEvent(:final action, :final args):
        final uiAction = UiAction(action: action, args: args);
        final report = ref
            .read(mapActionsControllerProvider.notifier)
            .apply(uiAction);
        next = next.copyWith(
          actions: [
            ...next.actions,
            ChatActionRecord(action: uiAction, report: report),
          ],
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

  ChatTurn _fromStored(StoredTurn turn) => ChatTurn(
    localId: ++_nextLocalId,
    input: turn.input,
    turnId: turn.id,
    phase: turn.stop == StopReason.cancelled
        ? ChatTurnPhase.cancelled
        : ChatTurnPhase.done,
    statuses: [for (final entry in turn.trace) ?entry.status],
    text: turn.text,
    actions: [
      for (final action in turn.uiActions)
        ChatActionRecord(
          action: action,
          report: const MapActionReport(MapActionOutcome.restored),
        ),
    ],
    cards: turn.cards,
    question: turn.question,
    usage: turn.usage,
    stop: turn.stop,
  );
}
