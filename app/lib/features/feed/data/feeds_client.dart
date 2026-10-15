import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_rest_transport.dart';
import 'feed_models.dart';

/// The user's feeds, stored per account by the agent service
/// (agent-protocol.md, Feed subscriptions). Failures throw the
/// [AgentClientException] family.
abstract interface class FeedsClient {
  /// `GET /v1/feeds`: the saved feeds in the user's order, or null when the
  /// user never saved any.
  Future<List<FeedSubscription>?> load();

  /// `PUT /v1/feeds`: replaces the whole list and returns what was stored.
  Future<List<FeedSubscription>> save(List<FeedSubscription> feeds);
}

final class HttpFeedsClient implements FeedsClient {
  HttpFeedsClient({
    required http.Client client,
    required Uri baseUrl,
    required AgentTokenSource tokenSource,
  }) : _transport = AgentRestTransport(
         client: client,
         baseUrl: baseUrl,
         tokenSource: tokenSource,
         // Twenty feeds are a few kilobytes.
         maxResponseBytes: 256 * 1024,
       );

  static final _log = Logger('FeedsClient');

  final AgentRestTransport _transport;

  @override
  Future<List<FeedSubscription>?> load() async {
    final json = await _transport.json('GET', const ['v1', 'feeds']);
    if (json?['feeds'] == null) return null;
    return _feeds(json);
  }

  @override
  Future<List<FeedSubscription>> save(List<FeedSubscription> feeds) async {
    final json = await _transport.json(
      'PUT',
      const ['v1', 'feeds'],
      body: {
        'feeds': [for (final feed in feeds) feed.toJson()],
      },
    );
    return _feeds(json);
  }

  static List<FeedSubscription> _feeds(Map<String, dynamic>? json) {
    try {
      return [
        for (final feed in json!['feeds'] as List<dynamic>)
          FeedSubscription.fromJson(feed as Map<String, dynamic>),
      ];
    } on Object catch (error) {
      _log.fine('Protocol decode failed', error);
      throw const AgentProtocolException('The response did not match');
    }
  }
}
