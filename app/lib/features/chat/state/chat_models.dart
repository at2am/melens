import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../map/state/map_actions.dart';

enum ChatTurnPhase { running, done, failed, cancelled }

/// Why an agent call failed, for the panel to explain in its own words.
enum ChatErrorKind {
  signIn,
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

/// One exchange: the user's input and everything the agent streamed back.
final class ChatTurn {
  const ChatTurn({
    required this.localId,
    required this.input,
    required this.phase,
    this.turnId,
    this.statuses = const [],
    this.text = '',
    this.actions = const [],
    this.cards = const [],
    this.question,
    this.usage,
    this.stop,
    this.error,
    this.lastSeq = -1,
  });

  final int localId;
  final TurnInput input;
  final ChatTurnPhase phase;

  /// Assigned by the server; null until the first event arrives.
  final String? turnId;

  /// The status lines, in order: the visible reasoning trace.
  final List<String> statuses;
  final String text;
  final List<ChatActionRecord> actions;
  final List<AgentCard> cards;
  final AgentQuestion? question;

  /// Running totals while the turn runs; the final totals afterwards.
  final TurnUsage? usage;
  final StopReason? stop;
  final ChatError? error;
  final int lastSeq;

  bool get isRunning => phase == ChatTurnPhase.running;

  ChatTurn copyWith({
    ChatTurnPhase? phase,
    String? turnId,
    List<String>? statuses,
    String? text,
    List<ChatActionRecord>? actions,
    List<AgentCard>? cards,
    AgentQuestion? question,
    TurnUsage? usage,
    StopReason? stop,
    ChatError? error,
    int? lastSeq,
  }) => ChatTurn(
    localId: localId,
    input: input,
    phase: phase ?? this.phase,
    turnId: turnId ?? this.turnId,
    statuses: statuses ?? this.statuses,
    text: text ?? this.text,
    actions: actions ?? this.actions,
    cards: cards ?? this.cards,
    question: question ?? this.question,
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
  final AgentQuestion? pendingQuestion;

  /// A failed session operation (list, create, open, delete).
  final ChatError? error;

  bool get isRunning => turns.isNotEmpty && turns.last.isRunning;

  bool get canSend => !isRunning && !isRestoring;

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
    error: clearError ? null : error ?? this.error,
  );
}
