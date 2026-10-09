import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:melens/features/agent/data/agent_client.dart';
import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/events/data/user_event_models.dart';
import 'package:melens/features/events/data/user_events_client.dart';
import 'package:melens/features/map/data/map_models.dart';

import 'user_event_models_test.dart' show eventJson;

http.StreamedResponse jsonResponse(int status, Object? body) =>
    http.StreamedResponse(
      Stream.value(body == null ? <int>[] : utf8.encode(jsonEncode(body))),
      status,
      headers: const {'content-type': 'application/json; charset=utf-8'},
    );

http.StreamedResponse errorResponse(
  int status,
  String code, {
  bool retryable = false,
  String? reason,
}) => jsonResponse(status, {
  'schemaVersion': 1,
  'error': {
    'code': code,
    'messageKey': 'agent.error.$code${reason == null ? '' : '.$reason'}',
    'retryable': retryable,
  },
});

final class Capture {
  final requests = <http.BaseRequest>[];
  final bodies = <String>[];
}

HttpUserEventsClient clientWith(
  Future<http.StreamedResponse> Function(http.BaseRequest request) handler, {
  Capture? capture,
  String? token = 'dev',
}) => HttpUserEventsClient(
  client: MockClient.streaming((request, bodyStream) async {
    capture?.requests.add(request);
    capture?.bodies.add(await bodyStream.bytesToString());
    return handler(request);
  }),
  baseUrl: Uri.parse('http://localhost:8080'),
  tokenSource: () async => token,
);

void main() {
  test('every route sends the bearer token and decodes its envelope', () async {
    final capture = Capture();
    final client = clientWith(capture: capture, (request) async {
      switch ('${request.method} ${request.url.path}') {
        case 'POST /v1/events':
          return jsonResponse(201, {'event': eventJson});
        case 'GET /v1/events':
          return jsonResponse(200, {
            'events': [eventJson],
          });
        case 'GET /v1/events/mine':
          return jsonResponse(200, {
            'owned': [eventJson],
            'joined': <Object?>[],
          });
        case 'GET /v1/events/ue_1':
        case 'PATCH /v1/events/ue_1':
        case 'POST /v1/events/ue_1/cancel':
        case 'POST /v1/events/ue_1/join':
        case 'DELETE /v1/events/ue_1/join':
          return jsonResponse(200, {'event': eventJson});
        case 'DELETE /v1/events/ue_1':
        case 'DELETE /v1/events/ue_1/members/m_1':
          return jsonResponse(204, null);
        case 'GET /v1/events/ue_1/members':
          return jsonResponse(200, {
            'count': 1,
            'members': [
              {
                'memberId': 'm_1',
                'displayName': 'Sam',
                'joinedAt': '2026-10-10T02:15:00.000Z',
              },
            ],
          });
      }
      return jsonResponse(404, null);
    });
    final draft = UserEventDraft(
      title: 'Walk',
      description: 'Easy.',
      point: const AgentLatLng(lat: -37.81, lng: 144.96),
      startAt: DateTime.utc(2026, 10, 12, 7),
      anonymousAttendance: true,
    );
    expect((await client.publish(draft)).id, 'ue_1');
    final events = await client.discover(
      const MapBounds(west: 144.95, south: -37.82, east: 144.98, north: -37.8),
      from: DateTime.utc(2026, 10, 10, 7, 40),
      to: DateTime.utc(2026, 10, 24, 7, 40),
    );
    expect(events.single.title, 'Sunset run along the Yarra');
    expect((await client.mine()).owned, hasLength(1));
    expect((await client.get('ue_1')).version, 1);
    expect(
      (await client.update('ue_1', const UserEventPatch(title: 'Run'))).id,
      'ue_1',
    );
    expect((await client.cancel('ue_1')).id, 'ue_1');
    await client.remove('ue_1');
    expect((await client.join('ue_1', displayName: ' Sam ')).id, 'ue_1');
    expect((await client.leave('ue_1')).id, 'ue_1');
    expect((await client.members('ue_1')).members!.single.displayName, 'Sam');
    await client.removeMember('ue_1', 'm_1');

    expect(capture.requests, hasLength(11));
    for (final request in capture.requests) {
      expect(request.headers['authorization'], 'Bearer dev');
      expect(request.headers['accept'], 'application/json');
    }
    final publish = capture.requests[0];
    expect(publish.headers['content-type'], startsWith('application/json'));
    expect(jsonDecode(capture.bodies[0]), draft.toJson());
    final discover = capture.requests[1].url;
    expect(discover.queryParameters, {
      'north': '-37.800000',
      'south': '-37.820000',
      'east': '144.980000',
      'west': '144.950000',
      'from': '2026-10-10T07:40:00.000Z',
      'to': '2026-10-24T07:40:00.000Z',
    });
    expect(capture.requests[4].method, 'PATCH');
    expect(jsonDecode(capture.bodies[4]), {'title': 'Run'});
    expect(jsonDecode(capture.bodies[7]), {'displayName': 'Sam'});
    expect(capture.requests[8].method, 'DELETE');
    expect(capture.requests[8].url.path, '/v1/events/ue_1/join');
  });

  test('a join without a name sends an empty object', () async {
    final capture = Capture();
    final client = clientWith(
      capture: capture,
      (request) async => jsonResponse(200, {'event': eventJson}),
    );
    await client.join('ue_1');
    await client.join('ue_1', displayName: '   ');
    expect(jsonDecode(capture.bodies[0]), <String, dynamic>{});
    expect(jsonDecode(capture.bodies[1]), <String, dynamic>{});
  });

  test('the error envelope maps to the exception with its reason', () async {
    final client = clientWith(
      (request) async => switch (request.url.path) {
        '/v1/events/full/join' => errorResponse(
          409,
          'conflict',
          reason: 'eventFull',
        ),
        '/v1/events/other/cancel' => errorResponse(403, 'forbidden'),
        '/v1/events/gone' => errorResponse(404, 'notFound'),
        '/v1/events' => errorResponse(429, 'rateLimited', retryable: true),
        _ => http.StreamedResponse(
          Stream.value(utf8.encode('<html>proxy</html>')),
          502,
        ),
      },
    );
    await expectLater(
      client.join('full'),
      throwsA(
        isA<AgentHttpException>()
            .having((e) => e.code, 'code', AgentErrorCode.conflict)
            .having((e) => e.reason, 'reason', 'eventFull')
            .having((e) => e.retryable, 'retryable', isFalse),
      ),
    );
    await expectLater(
      client.cancel('other'),
      throwsA(
        isA<AgentHttpException>()
            .having((e) => e.code, 'code', AgentErrorCode.forbidden)
            .having((e) => e.reason, 'reason', isNull),
      ),
    );
    await expectLater(
      client.get('gone'),
      throwsA(
        isA<AgentHttpException>().having(
          (e) => e.code,
          'code',
          AgentErrorCode.notFound,
        ),
      ),
    );
    await expectLater(
      client.mine(),
      throwsA(
        isA<AgentHttpException>()
            .having((e) => e.statusCode, 'status', 502)
            .having((e) => e.code, 'code', isNull)
            .having((e) => e.retryable, 'retryable', isTrue),
      ),
    );
  });

  test('a missing token and a bad body are their own exceptions', () async {
    final noToken = clientWith(
      token: null,
      (request) async => jsonResponse(200, {'event': eventJson}),
    );
    await expectLater(noToken.mine(), throwsA(isA<AgentSignInException>()));
    final badBody = clientWith(
      (request) async => jsonResponse(200, {'event': <String, dynamic>{}}),
    );
    await expectLater(
      badBody.get('ue_1'),
      throwsA(isA<AgentProtocolException>()),
    );
    final notJson = clientWith(
      (request) async =>
          http.StreamedResponse(Stream.value(utf8.encode('nope')), 200),
    );
    await expectLater(notJson.mine(), throwsA(isA<AgentProtocolException>()));
    expect(() => badBody.get('bad id'), throwsArgumentError);
  });
}
