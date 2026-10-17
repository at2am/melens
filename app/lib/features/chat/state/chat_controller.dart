import 'dart:async';
import 'dart:convert';

import 'package:logging/logging.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/time/melbourne_time.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../agent/state/agent_providers.dart';
import '../../map/state/map_actions.dart';
import '../../memory/state/memory_providers.dart';
import '../data/chat_photos.dart';
import 'chat_models.dart';
import 'request_context.dart';

part 'chat_controller.g.dart';

/// How the chat follows a turn again after its stream dropped: resume
/// attempts and their waits, then, when another server instance runs the
/// turn, polls of the session until the turn is stored.
final class ChatRecoveryTiming {
  const ChatRecoveryTiming({
    this.resumeDelays = const [
      Duration(seconds: 1),
      Duration(seconds: 2),
      Duration(seconds: 4),
    ],
    this.storedPollInterval = const Duration(seconds: 3),
    this.storedPolls = 110,
  });

  final List<Duration> resumeDelays;
  final Duration storedPollInterval;

  /// Enough polls to outlast the server's 300 s turn deadline.
  final int storedPolls;
}

/// Tests override this to recover without waiting.
@Riverpod(keepAlive: true)
ChatRecoveryTiming chatRecoveryTiming(Ref ref) => const ChatRecoveryTiming();

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
    // An answer to a question about a plan is about that plan's card.
    final aboutPlan = state.pendingQuestion?.planCardId;
    final normalised = switch (input) {
      TextTurnInput(:final text) => TurnInput.text(text: text.trim()),
      RefineTurnInput(:final cardId, :final text, :final planId) =>
        TurnInput.refine(cardId: cardId, text: text.trim(), planId: planId),
      _ => input,
    };
    final sent = normalised is TextTurnInput || normalised is RefineTurnInput
        ? photos
              .where((photo) => photo.bytes != null)
              .take(maxPhotosPerTurn)
              .toList(growable: false)
        : const <ChatPhoto>[];
    if (normalised case TextTurnInput(:final text)
        when text.isEmpty && sent.isEmpty) {
      return;
    }
    // A change to a plan needs words; photos alone cannot say what to change.
    if (normalised case RefineTurnInput(:final text) when text.isEmpty) return;
    // What the user browsed since the last batch reaches the memory with the
    // message.
    unawaited(ref.read(browsingTrackerProvider.notifier).flush());
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
    final reports = _actionReports(state.turns.lastOrNull);
    state = state.copyWith(
      turns: [
        ...state.turns,
        ChatTurn(
          localId: ++_nextLocalId,
          input: normalised,
          photos: sent,
          phase: ChatTurnPhase.running,
          startedAt: ref.read(melbourneClockProvider).now(),
        ),
      ],
      clearPendingQuestion: true,
      clearRefining: true,
      clearError: true,
    );
    final context = ref
        .read(requestContextBuilderProvider)(
          openCardId: switch (normalised) {
            RefineTurnInput(:final cardId) => cardId,
            _ => aboutPlan ?? _openCardId(),
          },
        )
        .withActionReports(reports);
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
      var ended = false;
      try {
        ended = await _follow(events, generation);
      } on AgentNetworkException {
        // A connection that dropped before the turn began has nothing to
        // resume.
        if (state.turns.last.turnId == null) rethrow;
      }
      if (!ref.mounted || generation != _generation) return;
      if (!ended) await _recover(sessionId, generation, abort.future);
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

  /// Handles the events of [events] until it ends; true when the turn ended
  /// with `done` or `error`, or another turn took over.
  Future<bool> _follow(Stream<AgentEvent> events, int generation) async {
    await for (final event in events) {
      if (!ref.mounted || generation != _generation) return true;
      _handle(event);
    }
    if (!ref.mounted || generation != _generation) return true;
    return !state.turns.last.isRunning;
  }

  /// The stream of the running turn dropped: follow it again after the last
  /// event, a few times. When this server instance does not run the turn,
  /// wait for it to be stored and show it as stored.
  Future<void> _recover(
    String sessionId,
    int generation,
    Future<void> abortTrigger,
  ) async {
    final timing = ref.read(chatRecoveryTimingProvider);
    final turnId = state.turns.last.turnId;
    if (turnId != null) {
      _replaceLast((turn) => turn.copyWith(reconnecting: true));
      for (final delay in timing.resumeDelays) {
        await Future.any([Future<void>.delayed(delay), abortTrigger]);
        if (!ref.mounted || generation != _generation) return;
        try {
          final ended = await _follow(
            _client.resumeTurn(
              sessionId,
              turnId,
              afterSeq: state.turns.last.lastSeq,
              abortTrigger: abortTrigger,
            ),
            generation,
          );
          if (!ref.mounted || generation != _generation) return;
          if (ended) {
            _replaceLast((turn) => turn.copyWith(reconnecting: false));
            return;
          }
        } on AgentHttpException catch (error) {
          if (error.code != AgentErrorCode.notFound) rethrow;
          await _awaitStored(sessionId, turnId, generation, timing);
          return;
        } on AgentNetworkException {
          // Still offline; the next attempt waits longer.
        } on AgentTimeoutException {
          // Likewise.
        }
      }
    }
    if (!ref.mounted || generation != _generation) return;
    _replaceLast((turn) => turn.copyWith(reconnecting: false));
    _finish(const ChatError(kind: ChatErrorKind.streamEnded, retryable: true));
  }

  /// Another instance runs [turnId]: reads the session until it no longer
  /// names the turn as running, then shows the turn as stored.
  Future<void> _awaitStored(
    String sessionId,
    String turnId,
    int generation,
    ChatRecoveryTiming timing,
  ) async {
    for (var poll = 0; poll < timing.storedPolls; poll++) {
      if (poll > 0) await Future<void>.delayed(timing.storedPollInterval);
      if (!ref.mounted || generation != _generation) return;
      final SessionDetail detail;
      try {
        detail = await _client.getSession(sessionId);
      } on AgentNetworkException {
        continue;
      } on AgentTimeoutException {
        continue;
      }
      if (!ref.mounted || generation != _generation) return;
      final stored = detail.turns
          .where((turn) => turn.id == turnId)
          .firstOrNull;
      if (stored != null) {
        _adoptStored(sessionId, stored, detail.pendingQuestion);
        return;
      }
      if (detail.runningTurnId != turnId) break;
    }
    if (!ref.mounted || generation != _generation) return;
    _replaceLast((turn) => turn.copyWith(reconnecting: false));
    _finish(const ChatError(kind: ChatErrorKind.streamEnded, retryable: true));
  }

  /// The live turn becomes its stored version; map actions the stream did not
  /// deliver are applied now.
  void _adoptStored(
    String sessionId,
    StoredTurn stored,
    AgentQuestion? pendingQuestion,
  ) {
    final live = state.turns.last;
    final mapActions = ref.read(mapActionsControllerProvider.notifier);
    var mapBefore = live.mapBefore;
    for (final action in stored.uiActions.skip(live.actions.length)) {
      mapBefore ??= mapActions.capture();
      mapActions.apply(action);
    }
    final restored = _fromStored(sessionId, stored);
    _replaceLast(
      (_) => ChatTurn(
        localId: live.localId,
        input: live.input,
        photos: live.photos,
        phase: restored.phase,
        turnId: stored.id,
        steps: restored.steps,
        text: restored.text,
        actions: restored.actions,
        cards: restored.cards,
        questions: restored.questions,
        usage: restored.usage,
        stop: restored.stop,
        error: restored.error,
        lastSeq: live.lastSeq,
        startedAt: live.startedAt,
        mapBefore: mapBefore,
      ),
    );
    state = state.copyWith(
      pendingQuestion: pendingQuestion,
      clearPendingQuestion: pendingQuestion == null,
    );
  }

  /// The map actions of [turn] the app could not fully apply, for the next
  /// request to report.
  static List<ActionReport> _actionReports(ChatTurn? turn) => [
    for (final record in turn?.actions ?? const <ChatActionRecord>[])
      if (record.report.outcome
          case MapActionOutcome.partial || MapActionOutcome.ignored)
        ActionReport(
          action: record.action.action,
          outcome: record.report.outcome.name,
          skipped: record.report.skipped.take(20).toList(growable: false),
        ),
  ].take(8).toList(growable: false);

  /// Puts back the map as it was before [turn] changed it.
  void undoMapChanges(ChatTurn turn) {
    final before = turn.mapBefore;
    if (before == null || turn.mapUndone) return;
    ref.read(mapActionsControllerProvider.notifier).restore(before);
    state = state.copyWith(
      turns: [
        for (final candidate in state.turns)
          candidate.localId == turn.localId
              ? candidate.copyWith(mapUndone: true)
              : candidate,
      ],
    );
  }

  /// The next message asks the agent to change [card], a plan of this
  /// session or the card of the saved plan [planId], instead of starting a
  /// new request.
  void startRefine(AgentCard card, {String? planId}) {
    if (card.type != CardType.plan) return;
    state = state.copyWith(refining: card, refiningPlanId: planId);
  }

  /// The next message is an ordinary one again.
  void cancelRefine() => state = state.copyWith(clearRefining: true);

  /// Answers the pending question with one of its options.
  Future<void> answer(AgentQuestion question, String option) =>
      send(TurnInput.answer(questionId: question.id, value: option));

  /// Answers several questions of the last turn at once, for example the
  /// questions the agent asked to make or change a plan. A single answer
  /// goes as an ordinary one.
  Future<void> answerAll(List<QuestionAnswer> answers) {
    if (answers.isEmpty) return Future.value();
    if (answers case [final only]) {
      return send(
        TurnInput.answer(questionId: only.questionId, value: only.value),
      );
    }
    return send(TurnInput.answers(answers: answers));
  }

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

  /// Opens a stored session. [restoreMap] draws its last route and
  /// highlights again, for a conversation the user picked from the list.
  Future<void> openSession(String sessionId, {bool restoreMap = false}) async {
    if (state.isRunning) cancel();
    final generation = ++_generation;
    state = state.copyWith(isRestoring: true, clearError: true);
    try {
      final detail = await _client.getSession(sessionId);
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(
        isRestoring: false,
        // A saved plan's card is changed in whichever session is open, such
        // as the one the chat reopens when it first shows.
        clearRefining: state.refiningPlanId == null,
        sessionId: detail.session.id,
        sessionTitle: detail.session.title,
        turns: [
          for (final turn in detail.turns) _fromStored(detail.session.id, turn),
        ],
        pendingQuestion: detail.pendingQuestion,
        clearPendingQuestion: detail.pendingQuestion == null,
      );
      if (restoreMap) {
        ref.read(mapActionsControllerProvider.notifier).restoreConversation([
          for (final turn in detail.turns) ...turn.uiActions,
        ]);
      }
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
      // The old conversation's route is not part of the new one.
      ref.read(mapActionsControllerProvider.notifier).clearRoute();
      state = state.copyWith(
        sessionId: session.id,
        sessionTitle: session.title,
        turns: const [],
        clearPendingQuestion: true,
        clearRefining: true,
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
    if (sessionId == state.sessionId) {
      ref.read(mapActionsControllerProvider.notifier).clearRoute();
    }
    state = state.copyWith(
      clearSession: sessionId == state.sessionId,
      turns: sessionId == state.sessionId ? const [] : null,
      clearPendingQuestion: sessionId == state.sessionId,
      clearRefining: sessionId == state.sessionId,
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
        next = next.copyWith(
          steps: _mergeStep(
            next,
            event,
            ref.read(melbourneClockProvider).now(),
          ),
        );
      case AgentTextEvent(:final delta):
        next = next.copyWith(text: next.text + delta);
      case AgentUiActionEvent(:final stepId, :final action, :final args):
        final uiAction = UiAction(action: action, args: args);
        final mapActions = ref.read(mapActionsControllerProvider.notifier);
        // The map as the turn found it, so its changes can be undone.
        final before = next.mapBefore ?? mapActions.capture();
        final report = mapActions.apply(uiAction);
        final record = ChatActionRecord(action: uiAction, report: report);
        next = next.copyWith(
          mapBefore: before,
          actions: [...next.actions, record],
          steps: _attachAction(next.steps, stepId, record),
        );
      case AgentCardEvent(:final card):
        next = next.copyWith(cards: [...next.cards, card]);
      case AgentQuestionEvent(:final question):
        next = next.copyWith(questions: [...next.questions, question]);
        pending = next.questions.first;
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
  static List<ChatStep> _mergeStep(
    ChatTurn turn,
    AgentStatusEvent event,
    DateTime now,
  ) {
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
      startedAt: existing?.startedAt ?? now,
      finishedAt: event.state == AgentStepState.running ? null : now,
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
    final failure = turn.failure;
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
      phase: failure != null
          ? ChatTurnPhase.failed
          : turn.stop == StopReason.cancelled
          ? ChatTurnPhase.cancelled
          : ChatTurnPhase.done,
      error: failure == null
          ? null
          : ChatError(
              kind: ChatErrorKind.server,
              retryable: failure.retryable,
              serverMessage: failure.message,
            ),
      steps: steps,
      text: turn.text,
      actions: actions,
      cards: turn.cards,
      questions: turn.allQuestions,
      usage: turn.usage,
      stop: turn.stop,
    );
  }
}
