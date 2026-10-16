import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_rest_transport.dart';
import 'saved_plan.dart';

/// The user's saved plans, stored per account by the agent service
/// (agent-protocol.md, Saved plans). Failures throw the
/// [AgentClientException] family.
abstract interface class PlansClient {
  /// `GET /v1/plans`: newest first.
  Future<List<SavedPlan>> list();

  /// `POST /v1/plans`: keeps the plan card [cardId] of [sessionId]. The
  /// service copies the card from the stored turn; saving it again returns
  /// the same plan.
  Future<SavedPlan> save({required String sessionId, required String cardId});

  /// `DELETE /v1/plans/{id}`.
  Future<void> remove(String id);

  /// `POST /v1/plans/{id}/stops/{index}/refresh`: reads the live parking
  /// around stop [index] again and returns the plan with it, as kept.
  Future<SavedPlan> refreshStop(String id, int index);
}

final class HttpPlansClient implements PlansClient {
  HttpPlansClient({
    required http.Client client,
    required Uri baseUrl,
    required AgentTokenSource tokenSource,
  }) : _transport = AgentRestTransport(
         client: client,
         baseUrl: baseUrl,
         tokenSource: tokenSource,
         // Thirty plans of up to 13 stops, each with a route polyline.
         maxResponseBytes: 1024 * 1024,
       );

  static final _log = Logger('PlansClient');

  final AgentRestTransport _transport;

  @override
  Future<List<SavedPlan>> list() async {
    final json = await _transport.json('GET', const ['v1', 'plans']);
    return _decode(
      () => [
        for (final plan in json!['plans'] as List<dynamic>)
          SavedPlan.fromJson(plan as Map<String, dynamic>),
      ],
    );
  }

  @override
  Future<SavedPlan> save({
    required String sessionId,
    required String cardId,
  }) async {
    final json = await _transport.json(
      'POST',
      const ['v1', 'plans'],
      body: {'sessionId': sessionId, 'cardId': cardId},
    );
    return _decode(
      () => SavedPlan.fromJson(json!['plan'] as Map<String, dynamic>),
    );
  }

  @override
  Future<void> remove(String id) async {
    await _transport.json('DELETE', ['v1', 'plans', id]);
  }

  @override
  Future<SavedPlan> refreshStop(String id, int index) async {
    final json = await _transport.json(
      'POST',
      ['v1', 'plans', id, 'stops', '$index', 'refresh'],
      body: const {'part': 'parking'},
    );
    return _decode(
      () => SavedPlan.fromJson(json!['plan'] as Map<String, dynamic>),
    );
  }

  static T _decode<T>(T Function() decode) {
    try {
      return decode();
    } on Object catch (error) {
      _log.fine('Protocol decode failed', error);
      throw const AgentProtocolException('The response did not match');
    }
  }
}
