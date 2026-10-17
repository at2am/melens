import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../map/state/map_actions.dart';
import '../data/chat_photos.dart';

enum ChatTurnPhase { running, done, failed, cancelled }

/// Why an agent call failed, for the panel to explain in its own words.
enum ChatErrorKind {
  /// This build has no way to obtain an agent token.
  signIn,

  /// Signing in for a token failed; trying again may work.
  signInFailed,
  network,
  timeout,
  http,
  protocol,

  /// The stream closed before `done` or `error`.
  streamEnded,

  /// The server sent an `error` event; its message is shown as sent.
  server,
}

final class ChatError {
  const ChatError({
    required this.kind,
    required this.retryable,
    this.code,
    this.serverMessage,
  });

  factory ChatError.from(AgentClientException error) => switch (error) {
    AgentSignInException() => const ChatError(
      kind: ChatErrorKind.signIn,
      retryable: false,
    ),
    AgentSignInFailedException() => const ChatError(
      kind: ChatErrorKind.signInFailed,
      retryable: true,
    ),
    AgentNetworkException() => const ChatError(
      kind: ChatErrorKind.network,
      retryable: true,
    ),
    AgentTimeoutException() => const ChatError(
      kind: ChatErrorKind.timeout,
      retryable: true,
    ),
    AgentHttpException(:final code, :final retryable) => ChatError(
      kind: ChatErrorKind.http,
      retryable: retryable,
      code: code,
    ),
    AgentProtocolException() => const ChatError(
      kind: ChatErrorKind.protocol,
      retryable: false,
    ),
    AgentTurnAborted() => const ChatError(
      kind: ChatErrorKind.streamEnded,
      retryable: true,
    ),
  };

  final ChatErrorKind kind;
  final bool retryable;
  final AgentErrorCode? code;
  final String? serverMessage;
}

/// A `ui_action` as the app handled it.
final class ChatActionRecord {
  const ChatActionRecord({required this.action, required this.report});

  final UiAction action;
  final MapActionReport report;
}

/// One tool call of a turn, as the trace shows it: a spinner while it runs,
/// then its rows, duration or error. The `ui_action` the call produced is
/// attached, so the step row shows whether the map applied it.
final class ChatStep {
  const ChatStep({
    required this.id,
    required this.tool,
    required this.text,
    required this.state,
    this.detail,
    this.rows,
    this.error,
    this.durationMs,
    this.memo = false,
    this.textOffset = 0,
    this.action,
  });

  final String id;
  final String tool;

  /// The tool's status line, for example "Searching the map".
  final String text;
  final AgentStepState state;

  /// A short summary of the arguments.
  final String? detail;
  final int? rows;

  /// A tool error code when the state is `failed`.
  final String? error;
  final int? durationMs;

  /// Answered from an identical earlier call in the same turn.
  final bool memo;

  /// How much answer text had streamed when the step started, so the view
  /// shows the step between the text before it and the text after it.
  final int textOffset;

  /// The `ui_action` this step produced, as the app handled it.
  final ChatActionRecord? action;

  bool get isRunning => state == AgentStepState.running;

  ChatStep copyWith({ChatActionRecord? action}) => ChatStep(
    id: id,
    tool: tool,
    text: text,
    state: state,
    detail: detail,
    rows: rows,
    error: error,
    durationMs: durationMs,
    memo: memo,
    textOffset: textOffset,
    action: action ?? this.action,
  );
}

/// One exchange: the user's input and everything the agent streamed back.
final class ChatTurn {
  const ChatTurn({
    required this.localId,
    required this.input,
    required this.phase,
    this.photos = const [],
    this.turnId,
    this.steps = const [],
    this.text = '',
    this.actions = const [],
    this.cards = const [],
    this.questions = const [],
    this.usage,
    this.stop,
    this.error,
    this.lastSeq = -1,
  });

  final int localId;
  final TurnInput input;

  /// The photos sent with [input], in order.
  final List<ChatPhoto> photos;
  final ChatTurnPhase phase;

  /// Assigned by the server; null until the first event arrives.
  final String? turnId;

  /// The tool calls, in order: the visible reasoning trace.
  final List<ChatStep> steps;
  final String text;

  /// Every `ui_action` of the turn; those with a step are also on it.
  final List<ChatActionRecord> actions;
  final List<AgentCard> cards;

  /// What the turn asked, in order: one question, or up to three about the
  /// plan it showed.
  final List<AgentQuestion> questions;

  /// The first question, which the session reports as pending.
  AgentQuestion? get question => questions.firstOrNull;

  /// Running totals while the turn runs; the final totals afterwards.
  final TurnUsage? usage;
  final StopReason? stop;
  final ChatError? error;
  final int lastSeq;

  bool get isRunning => phase == ChatTurnPhase.running;

  /// The model is working between tool calls: nothing shows progress but
  /// the turn is still running.
  bool get isThinking => isRunning && !steps.any((step) => step.isRunning);

  /// Answer text has streamed since the last step started.
  bool get isWriting =>
      text.length > (steps.isEmpty ? 0 : steps.last.textOffset);

  /// Actions no step claimed, for example from a server without step ids.
  List<ChatActionRecord> get unattachedActions {
    final attached = steps.map((step) => step.action).nonNulls.toSet();
    return actions
        .where((record) => !attached.contains(record))
        .toList(growable: false);
  }

  ChatTurn copyWith({
    ChatTurnPhase? phase,
    String? turnId,
    List<ChatStep>? steps,
    String? text,
    List<ChatActionRecord>? actions,
    List<AgentCard>? cards,
    List<AgentQuestion>? questions,
    TurnUsage? usage,
    StopReason? stop,
    ChatError? error,
    int? lastSeq,
  }) => ChatTurn(
    localId: localId,
    input: input,
    photos: photos,
    phase: phase ?? this.phase,
    turnId: turnId ?? this.turnId,
    steps: steps ?? this.steps,
    text: text ?? this.text,
    actions: actions ?? this.actions,
    cards: cards ?? this.cards,
    questions: questions ?? this.questions,
    usage: usage ?? this.usage,
    stop: stop ?? this.stop,
    error: error ?? this.error,
    lastSeq: lastSeq ?? this.lastSeq,
  );
}

final class ChatState {
  const ChatState({
    this.started = false,
    this.sessionId,
    this.sessionTitle = '',
    this.turns = const [],
    this.sessions = const [],
    this.sessionsLoading = false,
    this.isRestoring = false,
    this.pendingQuestion,
    this.refining,
    this.refiningPlanId,
    this.error,
  });

  /// Whether [ChatController.start] has run; the panel calls it once.
  final bool started;

  /// The open session; null until the first turn creates one.
  final String? sessionId;
  final String sessionTitle;
  final List<ChatTurn> turns;

  /// The user's sessions, newest first.
  final List<SessionSummary> sessions;
  final bool sessionsLoading;
  final bool isRestoring;

  /// The question the agent is waiting on; tapping an option answers it.
  /// When the last turn asked several, this is the first of them.
  final AgentQuestion? pendingQuestion;

  /// The plan card the next message asks to change; the input box says so.
  final AgentCard? refining;

  /// The saved plan [refining] is the card of, when the user changes a plan
  /// they kept rather than one of this conversation.
  final String? refiningPlanId;

  /// A failed session operation (list, create, open, delete).
  final ChatError? error;

  bool get isRunning => turns.isNotEmpty && turns.last.isRunning;

  /// A message may go at any time but while a session is restored; one sent
  /// while a turn runs interrupts it.
  bool get canSend => !isRestoring;

  ChatState copyWith({
    bool? started,
    String? sessionId,
    bool clearSession = false,
    String? sessionTitle,
    List<ChatTurn>? turns,
    List<SessionSummary>? sessions,
    bool? sessionsLoading,
    bool? isRestoring,
    AgentQuestion? pendingQuestion,
    bool clearPendingQuestion = false,
    AgentCard? refining,
    String? refiningPlanId,
    bool clearRefining = false,
    ChatError? error,
    bool clearError = false,
  }) => ChatState(
    started: started ?? this.started,
    sessionId: clearSession ? null : sessionId ?? this.sessionId,
    sessionTitle: clearSession ? '' : sessionTitle ?? this.sessionTitle,
    turns: turns ?? this.turns,
    sessions: sessions ?? this.sessions,
    sessionsLoading: sessionsLoading ?? this.sessionsLoading,
    isRestoring: isRestoring ?? this.isRestoring,
    pendingQuestion: clearPendingQuestion
        ? null
        : pendingQuestion ?? this.pendingQuestion,
    refining: clearRefining ? null : refining ?? this.refining,
    // A new card to change starts without the saved plan of the last one.
    refiningPlanId: clearRefining
        ? null
        : refining != null
        ? refiningPlanId
        : this.refiningPlanId,
    error: clearError ? null : error ?? this.error,
  );
}
