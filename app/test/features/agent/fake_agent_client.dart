import 'dart:async';

import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';

const fakeStamp = '2026-10-10T07:00:00.000Z';

SessionSummary fakeSession(
  String id, {
  String title = '',
  int turnCount = 0,
  String updatedAt = fakeStamp,
}) => SessionSummary(
  id: id,
  title: title,
  createdAt: fakeStamp,
  updatedAt: updatedAt,
  turnCount: turnCount,
);

const fakeUsage = TurnUsage(
  calls: 2,
  input: 1200,
  cachedInput: 400,
  output: 80,
  thoughts: 30,
  toolUseInput: 0,
  total: 1310,
);

const fakeFinalUsage = TurnUsage(
  calls: 2,
  input: 1200,
  cachedInput: 400,
  output: 80,
  thoughts: 30,
  toolUseInput: 0,
  total: 1310,
  complete: true,
);

const fakeCall = CallUsage(
  index: 1,
  agent: 'map_agent',
  model: 'gemini-test',
  input: 600,
  cachedInput: 200,
  output: 40,
  thoughts: 15,
  toolUseInput: 0,
  total: 655,
  durationMs: 900,
);

const fakeCard = AgentCard(
  id: 'c_1',
  type: CardType.list,
  title: 'Tonight near Flinders Street',
  intro: 'Two things within a short walk.',
  items: [
    CardItem(
      title: 'Market night',
      summary: 'Food stalls until late.',
      source: FeatureCardSource(featureId: 'event:1'),
      location: AgentLatLng(lat: -37.8176, lng: 144.9669),
    ),
    CardItem(
      title: 'State Library',
      source: LinkCardSource(
        url: 'https://maps.google.com/?cid=1',
        title: 'Google Maps',
      ),
      placeId: 'place-1',
    ),
  ],
  attribution: {
    'google_maps': [
      {'place_id': 'place-1', 'maps_uri': 'https://maps.google.com/?cid=1'},
    ],
  },
);

/// One turn the fake received; the test feeds its events.
final class FakeTurn {
  FakeTurn(this.sessionId, this.request, this._events);

  final String sessionId;
  final TurnRequest request;
  final StreamController<AgentEvent> _events;
  bool aborted = false;

  void emit(AgentEvent event) => _events.add(event);

  Future<void> fail(Object error) async {
    _events.addError(error);
    await _events.close();
  }

  Future<void> close() => _events.close();
}

/// Scripted [AgentClient]: sessions in memory, turns fed by the test.
final class FakeAgentClient implements AgentClient {
  final sessions = <SessionSummary>[];
  final details = <String, SessionDetail>{};
  final turns = <FakeTurn>[];
  final calls = <String>[];
  int _nextSession = 0;
  Object? createError;
  Object? listError;
  Object? getError;
  Object? deleteError;
  Object? turnError;

  FakeTurn get lastTurn => turns.last;

  @override
  Future<SessionSummary> createSession() async {
    calls.add('create');
    if (createError case final error?) throw error;
    final session = fakeSession('s_${++_nextSession}');
    sessions.insert(0, session);
    return session;
  }

  @override
  Future<List<SessionSummary>> listSessions() async {
    calls.add('list');
    if (listError case final error?) throw error;
    return List.of(sessions);
  }

  @override
  Future<SessionDetail> getSession(String sessionId) async {
    calls.add('get:$sessionId');
    if (getError case final error?) throw error;
    final detail = details[sessionId];
    if (detail != null) return detail;
    final session = sessions.where((s) => s.id == sessionId).firstOrNull;
    if (session == null) {
      throw const AgentHttpException(
        statusCode: 404,
        retryable: false,
        code: AgentErrorCode.notFound,
      );
    }
    return SessionDetail(session: session, pendingQuestion: null, turns: []);
  }

  @override
  Future<void> deleteSession(String sessionId) async {
    calls.add('delete:$sessionId');
    if (deleteError case final error?) throw error;
    sessions.removeWhere((session) => session.id == sessionId);
    details.remove(sessionId);
  }

  @override
  Stream<AgentEvent> runTurn(
    String sessionId,
    TurnRequest request, {
    Future<void>? abortTrigger,
  }) {
    calls.add('turn:$sessionId');
    if (turnError case final error?) return Stream<AgentEvent>.error(error);
    final events = StreamController<AgentEvent>();
    final turn = FakeTurn(sessionId, request, events);
    turns.add(turn);
    unawaited(
      abortTrigger?.then((_) {
        turn.aborted = true;
        if (!events.isClosed) {
          events.addError(const AgentTurnAborted());
          unawaited(events.close());
        }
      }),
    );
    return events.stream;
  }
}
