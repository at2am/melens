import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_rest_transport.dart';
import 'memory_models.dart';

/// The assistant's memory of the user, kept per account by the agent service
/// (agent-protocol.md, Memory). Failures throw the [AgentClientException]
/// family.
abstract interface class MemoryClient {
  /// `GET /v1/memory`.
  Future<UserMemory> load();

  /// `PATCH /v1/memory`: switches memory on or off; off keeps what is
  /// remembered but stops using and adding to it.
  Future<UserMemory> setEnabled({required bool enabled});

  /// `DELETE /v1/memory`: forgets every fact and all browsing.
  Future<void> clear();

  /// `DELETE /v1/memory/facts/{id}`.
  Future<void> forget(String factId);

  /// `POST /v1/memory/signals`: what the user did on the map, in a batch.
  Future<void> report(List<BrowsingSignal> signals);
}

final class HttpMemoryClient implements MemoryClient {
  HttpMemoryClient({
    required http.Client client,
    required Uri baseUrl,
    required AgentTokenSource tokenSource,
  }) : _transport = AgentRestTransport(
         client: client,
         baseUrl: baseUrl,
         tokenSource: tokenSource,
         // Two dozen short facts and a few browsing lines.
         maxResponseBytes: 64 * 1024,
       );

  static final _log = Logger('MemoryClient');

  final AgentRestTransport _transport;

  @override
  Future<UserMemory> load() async =>
      _memory(await _transport.json('GET', const ['v1', 'memory']));

  @override
  Future<UserMemory> setEnabled({required bool enabled}) async => _memory(
    await _transport.json(
      'PATCH',
      const ['v1', 'memory'],
      body: {'enabled': enabled},
    ),
  );

  @override
  Future<void> clear() => _transport.json('DELETE', const ['v1', 'memory']);

  @override
  Future<void> forget(String factId) =>
      _transport.json('DELETE', ['v1', 'memory', 'facts', factId]);

  @override
  Future<void> report(List<BrowsingSignal> signals) => _transport.json(
    'POST',
    const ['v1', 'memory', 'signals'],
    body: {
      'signals': [for (final signal in signals) signal.toJson()],
    },
  );

  static UserMemory _memory(Map<String, dynamic>? json) {
    try {
      return UserMemory.fromJson(json!['memory'] as Map<String, dynamic>);
    } on Object catch (error) {
      _log.fine('Protocol decode failed', error);
      throw const AgentProtocolException('The response did not match');
    }
  }
}
