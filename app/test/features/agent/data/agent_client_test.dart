import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';

const context = RequestContext(
  viewport: AgentViewport(
    north: -37.80,
    south: -37.82,
    east: 144.98,
    west: 144.95,
  ),
  zoom: 15,
  layers: ['event'],
  localTime: '2026-10-10T18:40:00+11:00',
);

http.StreamedResponse jsonResponse(int status, Object? body) =>
    http.StreamedResponse(
      Stream.value(body == null ? <int>[] : utf8.encode(jsonEncode(body))),
      status,
      headers: const {'content-type': 'application/json; charset=utf-8'},
    );

http.StreamedResponse errorResponse(int status, String code, bool retryable) =>
    jsonResponse(status, {
      'schemaVersion': 1,
      'error': {
        'code': code,
        'messageKey': 'agent.error.$code',
        'retryable': retryable,
      },
    });

http.StreamedResponse sseResponse(List<String> chunks) => http.StreamedResponse(
  Stream.fromIterable(chunks.map(utf8.encode)),
  200,
  headers: const {'content-type': 'text/event-stream; charset=utf-8'},
);

String sse(String event, Map<String, dynamic> body) =>
    'event: $event\ndata: ${jsonEncode({'event': event, ...body})}\n\n';

final class Capture {
  http.BaseRequest? request;
  String? body;
}

HttpAgentClient clientWith(
  Future<http.StreamedResponse> Function(http.BaseRequest request) handler, {
  Capture? capture,
  Uri? baseUrl,
  String? token = 'dev',
}) => HttpAgentClient(
  client: MockClient.streaming((request, bodyStream) async {
    capture?.request = request;
    capture?.body = await bodyStream.bytesToString();
    return handler(request);
  }),
  baseUrl: baseUrl ?? Uri.parse('http://localhost:8080'),
  tokenSource: () async => token,
);

void main() {
  test(
    'session routes send the bearer token and decode the envelopes',
    () async {
      final capture = Capture();
      final client = clientWith(capture: capture, (request) async {
        switch ('${request.method} ${request.url.path}') {
          case 'POST /v1/sessions':
            return jsonResponse(201, {
              'session': {
                'id': 's_1',
                'title': '',
                'createdAt': '2026-10-10T07:00:00.000Z',
                'updatedAt': '2026-10-10T07:00:00.000Z',
                'turnCount': 0,
              },
            });
          case 'GET /v1/sessions':
            return jsonResponse(200, {
              'sessions': [
                {
                  'id': 's_1',
                  'title': 'Hi',
                  'createdAt': '2026-10-10T07:00:00.000Z',
                  'updatedAt': '2026-10-10T07:01:00.000Z',
                  'turnCount': 1,
                },
              ],
            });
          case 'GET /v1/sessions/s_1':
            return jsonResponse(200, {
              'session': {
                'id': 's_1',
                'title': 'Hi',
                'createdAt': '2026-10-10T07:00:00.000Z',
                'updatedAt': '2026-10-10T07:01:00.000Z',
                'turnCount': 0,
              },
              'pendingQuestion': null,
              'turns': <Object?>[],
            });
          case 'DELETE /v1/sessions/s_1':
            return jsonResponse(204, null);
        }
        return errorResponse(404, 'notFound', false);
      });

      final created = await client.createSession();
      expect(created.id, 's_1');
      expect(capture.request!.headers['authorization'], 'Bearer dev');
      expect(capture.request!.headers['accept'], 'application/json');

      final sessions = await client.listSessions();
      expect(sessions.single.title, 'Hi');

      final detail = await client.getSession('s_1');
      expect(detail.turns, isEmpty);
      expect(detail.pendingQuestion, isNull);

      await client.deleteSession('s_1');
      expect(capture.request!.method, 'DELETE');
    },
  );

  test('a base URL with a path prefix is joined, never replaced', () async {
    final capture = Capture();
    final client = clientWith(
      capture: capture,
      baseUrl: Uri.parse('https://agent.example/api/'),
      (request) async => jsonResponse(200, {'sessions': <Object?>[]}),
    );

    await client.listSessions();

    expect(
      capture.request!.url.toString(),
      'https://agent.example/api/v1/sessions',
    );
  });

  test('without a token nothing is sent', () async {
    var sent = false;
    final client = clientWith(token: null, (request) async {
      sent = true;
      return jsonResponse(200, {'sessions': <Object?>[]});
    });

    await expectLater(
      client.listSessions,
      throwsA(isA<AgentSignInException>()),
    );
    expect(sent, isFalse);
  });

  test('the error envelope maps to a code and its retryability', () async {
    final client = clientWith((request) async {
      return request.method == 'POST'
          ? errorResponse(409, 'turnInProgress', true)
          : errorResponse(401, 'unauthorized', false);
    });

    await expectLater(
      client.listSessions,
      throwsA(
        isA<AgentHttpException>()
            .having((e) => e.code, 'code', AgentErrorCode.unauthorized)
            .having((e) => e.retryable, 'retryable', isFalse)
            .having((e) => e.statusCode, 'status', 401),
      ),
    );
    await expectLater(
      () => client
          .runTurn(
            's_1',
            const TurnRequest(
              input: TurnInput.text(text: 'x'),
              context: context,
            ),
          )
          .toList(),
      throwsA(
        isA<AgentHttpException>()
            .having((e) => e.code, 'code', AgentErrorCode.turnInProgress)
            .having((e) => e.retryable, 'retryable', isTrue),
      ),
    );
  });

  test('a turn posts the request and streams the decoded events', () async {
    final capture = Capture();
    final client = clientWith(capture: capture, (request) async {
      return sseResponse([
        ': keep-alive\n\n',
        sse('status', {
          'turnId': 't_1',
          'seq': 0,
          'stepId': 's_1',
          'state': 'running',
          'tool': 'search_features',
          'text': 'Searching the map',
        }),
        sse('text', {
          'turnId': 't_1',
          'seq': 1,
          'delta': 'Near ',
        }).substring(0, 20),
        sse('text', {
          'turnId': 't_1',
          'seq': 1,
          'delta': 'Near ',
        }).substring(20),
        sse('done', {
          'turnId': 't_1',
          'seq': 2,
          'stop': 'end',
          'usage': {
            'calls': 1,
            'input': 10,
            'cachedInput': 0,
            'output': 5,
            'thoughts': 0,
            'toolUseInput': 0,
            'total': 15,
            'complete': true,
          },
        }),
      ]);
    });

    final events = await client
        .runTurn(
          's_1',
          const TurnRequest(
            input: TurnInput.text(text: 'What is here?'),
            context: context,
          ),
        )
        .toList();

    expect(capture.request!.method, 'POST');
    expect(capture.request!.url.path, '/v1/sessions/s_1/turns');
    expect(capture.request!.headers['content-type'], 'application/json');
    expect(capture.request!.headers['accept'], 'text/event-stream');
    expect(jsonDecode(capture.body!), {
      'input': {'kind': 'text', 'text': 'What is here?'},
      'context': context.toJson(),
    });
    expect(events.map((event) => event.seq), [0, 1, 2]);
    expect((events[1] as AgentTextEvent).delta, 'Near ');
    expect((events[2] as AgentDoneEvent).stop, StopReason.end);
  });

  test('a turn answered without an event stream is a protocol error', () async {
    final client = clientWith(
      (request) async => jsonResponse(200, {'ok': true}),
    );

    await expectLater(
      () => client
          .runTurn(
            's_1',
            const TurnRequest(
              input: TurnInput.text(text: 'x'),
              context: context,
            ),
          )
          .toList(),
      throwsA(isA<AgentProtocolException>()),
    );
  });

  test('an event whose payload is not JSON fails the stream', () async {
    final client = clientWith(
      (request) async => sseResponse(['event: text\ndata: not json\n\n']),
    );

    await expectLater(
      () => client
          .runTurn(
            's_1',
            const TurnRequest(
              input: TurnInput.text(text: 'x'),
              context: context,
            ),
          )
          .toList(),
      throwsA(isA<AgentProtocolException>()),
    );
  });

  test('a connection failure is a network error', () async {
    final client = clientWith(
      (request) async => throw http.ClientException('refused', request.url),
    );

    await expectLater(
      client.listSessions,
      throwsA(isA<AgentNetworkException>()),
    );
  });

  test('an invalid session id never reaches the network', () {
    final client = clientWith((request) async => jsonResponse(200, {}));

    expect(() => client.getSession('../x'), throwsArgumentError);
    expect(() => client.deleteSession(''), throwsArgumentError);
  });
}
