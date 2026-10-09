import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import '../../../core/network/sse.dart';
import 'agent_models.dart';

/// Supplies the bearer token for the agent service, or null when the user is
/// not signed in. In development this is the fixed token the service accepts
/// in development mode; later it is the Firebase ID token.
typedef AgentTokenSource = Future<String?> Function();

/// The transport of the agent protocol: session routes and the streamed turn
/// route (agent-protocol.md, Endpoints). It never calls a language model.
abstract interface class AgentClient {
  Future<SessionSummary> createSession();

  /// The caller's sessions, newest first.
  Future<List<SessionSummary>> listSessions();

  Future<SessionDetail> getSession(String sessionId);

  Future<void> deleteSession(String sessionId);

  /// Runs one turn and yields its events as they arrive. Completing
  /// [abortTrigger] aborts the request; the server sees the disconnect and
  /// cancels the run (agent-protocol.md, Rules). A turn sent while another
  /// runs in the session interrupts that one.
  Stream<AgentEvent> runTurn(
    String sessionId,
    TurnRequest request, {
    Future<void>? abortTrigger,
  });

  /// Stops the session's running turn wherever it runs, even when the
  /// disconnect of an aborted request does not reach the server.
  Future<void> cancelTurn(String sessionId);

  /// The bytes of a stored photo of the session.
  Future<Uint8List> getAttachment(String sessionId, String attachmentId);
}

sealed class AgentClientException implements Exception {
  const AgentClientException();

  bool get retryable;
}

/// No token is available, so the request was not sent.
final class AgentSignInException extends AgentClientException {
  const AgentSignInException();

  @override
  bool get retryable => false;

  @override
  String toString() => 'AgentSignInException: no agent token is configured';
}

/// The service answered with its JSON error envelope or another non-2xx.
final class AgentHttpException extends AgentClientException {
  const AgentHttpException({
    required this.statusCode,
    required this.retryable,
    this.code,
  });

  final int statusCode;
  final AgentErrorCode? code;

  @override
  final bool retryable;

  @override
  String toString() => 'AgentHttpException: HTTP $statusCode ${code?.name}';
}

final class AgentNetworkException extends AgentClientException {
  const AgentNetworkException();

  @override
  bool get retryable => true;

  @override
  String toString() => 'AgentNetworkException: agent service is unreachable';
}

final class AgentTimeoutException extends AgentClientException {
  const AgentTimeoutException();

  @override
  bool get retryable => true;

  @override
  String toString() => 'AgentTimeoutException: agent request timed out';
}

/// The response did not follow the protocol: bad JSON, an unknown event or a
/// non-stream body on the turn route.
final class AgentProtocolException extends AgentClientException {
  const AgentProtocolException(this.message);

  final String message;

  @override
  bool get retryable => false;

  @override
  String toString() => 'AgentProtocolException: $message';
}

/// The app aborted the turn through [AgentClient.runTurn]'s trigger.
final class AgentTurnAborted extends AgentClientException {
  const AgentTurnAborted();

  @override
  bool get retryable => false;

  @override
  String toString() => 'AgentTurnAborted';
}

final class HttpAgentClient implements AgentClient {
  HttpAgentClient({
    required this.client,
    required Uri baseUrl,
    required this.tokenSource,
    this.requestTimeout = const Duration(seconds: 30),
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

  static final _log = Logger('AgentClient');

  /// A session of 200 stored turns with cards stays well below this.
  static const int _maxResponseBytes = 8 * 1024 * 1024;

  final http.Client client;
  final Uri _baseUrl;
  final AgentTokenSource tokenSource;

  /// Applies to the session routes only; a turn streams for up to 300 s.
  final Duration requestTimeout;

  @override
  Future<SessionSummary> createSession() async {
    final json = await _json('POST', const ['v1', 'sessions']);
    return _decode(() => SessionSummary.fromJson(_object(json, 'session')));
  }

  @override
  Future<List<SessionSummary>> listSessions() async {
    final json = await _json('GET', const ['v1', 'sessions']);
    return _decode(() {
      final Object? sessions = json?['sessions'];
      if (sessions is! List<dynamic>) {
        throw const FormatException('sessions must be a list');
      }
      return sessions
          .map((item) => SessionSummary.fromJson(item as Map<String, dynamic>))
          .toList(growable: false);
    });
  }

  @override
  Future<SessionDetail> getSession(String sessionId) async {
    _validateId(sessionId);
    final json = await _json('GET', ['v1', 'sessions', sessionId]);
    return _decode(() => SessionDetail.fromJson(json ?? const {}));
  }

  @override
  Future<void> deleteSession(String sessionId) async {
    _validateId(sessionId);
    await _json('DELETE', ['v1', 'sessions', sessionId]);
  }

  @override
  Future<void> cancelTurn(String sessionId) async {
    _validateId(sessionId);
    await _send('POST', ['v1', 'sessions', sessionId, 'cancel']);
  }

  @override
  Future<Uint8List> getAttachment(String sessionId, String attachmentId) {
    _validateId(sessionId);
    _validateId(attachmentId);
    return _send('GET', [
      'v1',
      'sessions',
      sessionId,
      'attachments',
      attachmentId,
    ], accept: 'image/*');
  }

  @override
  Stream<AgentEvent> runTurn(
    String sessionId,
    TurnRequest request, {
    Future<void>? abortTrigger,
  }) async* {
    _validateId(sessionId);
    final headers = await _headers(accept: 'text/event-stream');
    final body = _encode(request.toJson());
    final httpRequest =
        http.AbortableRequest(
            'POST',
            _endpoint(['v1', 'sessions', sessionId, 'turns']),
            abortTrigger: abortTrigger,
          )
          ..followRedirects = false
          ..headers.addAll(headers)
          ..headers['content-type'] = 'application/json'
          ..bodyBytes = utf8.encode(body);
    final http.StreamedResponse response;
    try {
      response = await client.send(httpRequest);
    } on http.RequestAbortedException {
      throw const AgentTurnAborted();
    } on http.ClientException {
      throw const AgentNetworkException();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _httpFailure(
        response.statusCode,
        await _collect(response.stream, limit: 64 * 1024),
      );
    }
    final contentType = response.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('text/event-stream')) {
      throw const AgentProtocolException('The turn route did not stream');
    }
    try {
      await for (final event in response.stream.transform(const SseDecoder())) {
        yield _decodeEvent(event);
      }
    } on http.RequestAbortedException {
      throw const AgentTurnAborted();
    } on http.ClientException {
      throw const AgentNetworkException();
    }
  }

  AgentEvent _decodeEvent(SseEvent event) {
    final Object? decoded;
    try {
      decoded = jsonDecode(event.data);
    } on FormatException {
      throw const AgentProtocolException('An event was not JSON');
    }
    if (decoded is! Map<String, dynamic>) {
      throw const AgentProtocolException('An event was not an object');
    }
    final Map<String, dynamic> json = decoded;
    // The `event:` field repeats the JSON's `event`; the JSON decides.
    if (event.event != 'message' && json['event'] != event.event) {
      throw const AgentProtocolException('Event name and payload disagree');
    }
    return _decode(() => AgentEvent.fromJson(json));
  }

  Future<Map<String, String>> _headers({String? accept}) async {
    final token = await tokenSource();
    if (token == null || token.isEmpty) throw const AgentSignInException();
    return {
      'authorization': 'Bearer $token',
      'accept': accept ?? 'application/json',
    };
  }

  /// A session route: bounded, timed out and decoded; null for `204`.
  Future<Map<String, dynamic>?> _json(
    String method,
    List<String> segments,
  ) async {
    final bytes = await _send(method, segments);
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

  /// A session route's body, bounded and timed out; empty for `204`.
  Future<Uint8List> _send(
    String method,
    List<String> segments, {
    String? accept,
  }) async {
    final headers = await _headers(accept: accept);
    final timeout = Completer<void>();
    final timer = Timer(requestTimeout, timeout.complete);
    final request =
        http.AbortableRequest(
            method,
            _endpoint(segments),
            abortTrigger: timeout.future,
          )
          ..followRedirects = false
          ..headers.addAll(headers);
    try {
      final response = await client.send(request);
      final bytes = await _collect(response.stream, limit: _maxResponseBytes);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw _httpFailure(response.statusCode, bytes);
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

  Uri _endpoint(List<String> segments) => Uri(
    scheme: _baseUrl.scheme,
    host: _baseUrl.host,
    port: _baseUrl.hasPort ? _baseUrl.port : null,
    pathSegments: [
      ..._baseUrl.pathSegments.where((segment) => segment.isNotEmpty),
      ...segments,
    ],
  );

  static Map<String, dynamic> _object(Map<String, dynamic>? json, String key) {
    final Object? value = json?[key];
    if (value is! Map<String, dynamic>) {
      throw FormatException('$key must be an object');
    }
    return value;
  }

  static T _decode<T>(T Function() decode) {
    try {
      return decode();
    } on Object catch (error) {
      _log.fine('Protocol decode failed', error);
      throw const AgentProtocolException('The response did not match');
    }
  }

  static String _encode(Map<String, dynamic> json) {
    try {
      return jsonEncode(json);
    } on Object {
      throw const AgentProtocolException('The request could not be encoded');
    }
  }

  static void _validateId(String id) {
    if (id.isEmpty ||
        id.length > 64 ||
        !RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(id)) {
      throw ArgumentError.value(id, 'id');
    }
  }

  static AgentHttpException _httpFailure(int statusCode, Uint8List bytes) {
    AgentErrorCode? code;
    var retryable = {408, 429, 502, 503, 504}.contains(statusCode);
    try {
      final Object? json = jsonDecode(utf8.decode(bytes));
      if (json is Map<String, dynamic>) {
        final Object? error = json['error'];
        if (error is Map<String, dynamic>) {
          for (final candidate in AgentErrorCode.values) {
            if (candidate.name == error['code']) {
              code = candidate;
              break;
            }
          }
          if (code != null && error['retryable'] is bool) {
            retryable = error['retryable'] as bool;
          }
        }
      }
    } on FormatException {
      // Proxy and network errors may carry HTML; never expose it.
    }
    return AgentHttpException(
      statusCode: statusCode,
      code: code,
      retryable: retryable,
    );
  }
}
