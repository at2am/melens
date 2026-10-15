import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'agent_client.dart';

/// The JSON routes of the agent service (user events, feed subscriptions):
/// the bearer token, a bounded and timed-out body and the service's error
/// envelope. Failures throw the [AgentClientException] family.
final class AgentRestTransport {
  AgentRestTransport({
    required this.client,
    required Uri baseUrl,
    required this.tokenSource,
    this.requestTimeout = const Duration(seconds: 30),
    this.maxResponseBytes = 2 * 1024 * 1024,
  }) : _baseUrl = baseUrl {
    if (!{'http', 'https'}.contains(baseUrl.scheme) ||
        baseUrl.host.isEmpty ||
        baseUrl.userInfo.isNotEmpty ||
        baseUrl.hasQuery ||
        baseUrl.hasFragment ||
        requestTimeout <= Duration.zero) {
      throw ArgumentError.value(baseUrl, 'baseUrl');
    }
  }

  final http.Client client;
  final Uri _baseUrl;
  final AgentTokenSource tokenSource;
  final Duration requestTimeout;
  final int maxResponseBytes;

  /// A route: bounded, timed out and decoded; null for `204`.
  Future<Map<String, dynamic>?> json(
    String method,
    List<String> segments, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final bytes = await _send(method, segments, query: query, body: body);
    if (bytes.isEmpty) return null;
    final Object? json;
    try {
      json = jsonDecode(utf8.decode(bytes));
    } on FormatException {
      throw const AgentProtocolException('The response was not JSON');
    }
    if (json is! Map<String, dynamic>) {
      throw const AgentProtocolException('The response was not an object');
    }
    return json;
  }

  Future<Map<String, String>> _headers() async {
    final token = await tokenSource();
    if (token == null || token.isEmpty) throw const AgentSignInException();
    return {'authorization': 'Bearer $token', 'accept': 'application/json'};
  }

  Future<Uint8List> _send(
    String method,
    List<String> segments, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final headers = await _headers();
    final timeout = Completer<void>();
    final timer = Timer(requestTimeout, timeout.complete);
    final request =
        http.AbortableRequest(
            method,
            _endpoint(segments, query),
            abortTrigger: timeout.future,
          )
          ..followRedirects = false
          ..headers.addAll(headers);
    if (body != null) {
      request
        ..headers['content-type'] = 'application/json'
        ..bodyBytes = utf8.encode(_encode(body));
    }
    try {
      final response = await client.send(request);
      final bytes = await _collect(response.stream, limit: maxResponseBytes);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw parseAgentHttpFailure(response.statusCode, bytes);
      }
      return bytes;
    } on http.RequestAbortedException {
      throw const AgentTimeoutException();
    } on http.ClientException {
      throw const AgentNetworkException();
    } finally {
      timer.cancel();
    }
  }

  Future<Uint8List> _collect(
    http.ByteStream stream, {
    required int limit,
  }) async {
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in stream) {
      if (bytes.length + chunk.length > limit) {
        throw const AgentProtocolException('The response was too large');
      }
      bytes.add(chunk);
    }
    return bytes.takeBytes();
  }

  Uri _endpoint(List<String> segments, Map<String, String>? query) => Uri(
    scheme: _baseUrl.scheme,
    host: _baseUrl.host,
    port: _baseUrl.hasPort ? _baseUrl.port : null,
    pathSegments: [
      ..._baseUrl.pathSegments.where((segment) => segment.isNotEmpty),
      ...segments,
    ],
    queryParameters: query,
  );

  static String _encode(Map<String, dynamic> json) {
    try {
      return jsonEncode(json);
    } on Object {
      throw const AgentProtocolException('The request could not be encoded');
    }
  }
}
