import 'package:http/http.dart' as http;
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'http_client.g.dart';

/// The one HTTP client the app uses.
///
/// `http.Client()` is an `IOClient` on Android and iOS and a Fetch-based
/// `BrowserClient` on the Web. Both stream response bodies, which the agent's
/// server-sent events need, and both honour `http.AbortableRequest`, which
/// cancels a turn on the server (agent-protocol.md, Rules).
///
/// Tests override this provider with `MockClient` from
/// `package:http/testing.dart`.
@Riverpod(keepAlive: true)
http.Client httpClient(Ref ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
}
