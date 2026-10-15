import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import '../../agent/data/agent_client.dart';
import '../../map/data/map_models.dart';
import 'user_event_models.dart';

/// The transport of user-published events (agent-protocol.md, User events):
/// the `/v1/events` routes of the agent service, with its bearer token and
/// its error envelope. Failures throw the [AgentClientException] family.
abstract interface class UserEventsClient {
  /// `POST /v1/events`.
  Future<UserEvent> publish(UserEventDraft draft);

  /// `GET /v1/events`: published and cancelled events inside [bounds] that
  /// take place at some point in `[from, to)`, soonest first.
  Future<List<UserEvent>> discover(
    MapBounds bounds, {
    required DateTime from,
    required DateTime to,
  });

  /// `GET /v1/events/mine`.
  Future<MyUserEvents> mine();

  /// `GET /v1/events/{eventId}`.
  Future<UserEvent> get(String eventId);

  /// `PATCH /v1/events/{eventId}`, owner only.
  Future<UserEvent> update(String eventId, UserEventPatch patch);

  /// `POST /v1/events/{eventId}/cancel`, owner only.
  Future<UserEvent> cancel(String eventId);

  /// `DELETE /v1/events/{eventId}`, owner only.
  Future<void> remove(String eventId);

  /// `POST /v1/events/{eventId}/join`.
  Future<UserEvent> join(String eventId, {String? displayName});

  /// `DELETE /v1/events/{eventId}/join`.
  Future<UserEvent> leave(String eventId);

  /// `GET /v1/events/{eventId}/members`, owner only.
  Future<UserEventMembers> members(String eventId);

  /// `DELETE /v1/events/{eventId}/members/{memberId}`, owner only.
  Future<void> removeMember(String eventId, String memberId);
}

final class HttpUserEventsClient implements UserEventsClient {
  HttpUserEventsClient({
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

  static final _log = Logger('UserEventsClient');

  /// 200 events of 2000-character descriptions stay well below this.
  static const int _maxResponseBytes = 2 * 1024 * 1024;

  final http.Client client;
  final Uri _baseUrl;
  final AgentTokenSource tokenSource;
  final Duration requestTimeout;

  @override
  Future<UserEvent> publish(UserEventDraft draft) async {
    final json = await _json('POST', const [
      'v1',
      'events',
    ], body: draft.toJson());
    return _event(json);
  }

  @override
  Future<List<UserEvent>> discover(
    MapBounds bounds, {
    required DateTime from,
    required DateTime to,
  }) async {
    final json = await _json(
      'GET',
      const ['v1', 'events'],
      query: {
        'north': _coordinate(bounds.north),
        'south': _coordinate(bounds.south),
        'east': _coordinate(bounds.east),
        'west': _coordinate(bounds.west),
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
      },
    );
    return _decode(() => _events(json, 'events'));
  }

  @override
  Future<MyUserEvents> mine() async {
    final json = await _json('GET', const ['v1', 'events', 'mine']);
    return _decode(() => MyUserEvents.fromJson(json ?? const {}));
  }

  @override
  Future<UserEvent> get(String eventId) async {
    _validateId(eventId);
    return _event(await _json('GET', ['v1', 'events', eventId]));
  }

  @override
  Future<UserEvent> update(String eventId, UserEventPatch patch) async {
    _validateId(eventId);
    return _event(
      await _json('PATCH', ['v1', 'events', eventId], body: patch.toJson()),
    );
  }

  @override
  Future<UserEvent> cancel(String eventId) async {
    _validateId(eventId);
    return _event(await _json('POST', ['v1', 'events', eventId, 'cancel']));
  }

  @override
  Future<void> remove(String eventId) async {
    _validateId(eventId);
    await _json('DELETE', ['v1', 'events', eventId]);
  }

  @override
  Future<UserEvent> join(String eventId, {String? displayName}) async {
    _validateId(eventId);
    final name = displayName?.trim();
    return _event(
      await _json(
        'POST',
        ['v1', 'events', eventId, 'join'],
        body: {if (name != null && name.isNotEmpty) 'displayName': name},
      ),
    );
  }

  @override
  Future<UserEvent> leave(String eventId) async {
    _validateId(eventId);
    return _event(await _json('DELETE', ['v1', 'events', eventId, 'join']));
  }

  @override
  Future<UserEventMembers> members(String eventId) async {
    _validateId(eventId);
    final json = await _json('GET', ['v1', 'events', eventId, 'members']);
    return _decode(() => UserEventMembers.fromJson(json ?? const {}));
  }

  @override
  Future<void> removeMember(String eventId, String memberId) async {
    _validateId(eventId);
    _validateId(memberId);
    await _json('DELETE', ['v1', 'events', eventId, 'members', memberId]);
  }

  UserEvent _event(Map<String, dynamic>? json) =>
      _decode(() => UserEvent.fromJson(_object(json, 'event')));

  static List<UserEvent> _events(Map<String, dynamic>? json, String key) {
    final Object? events = json?[key];
    if (events is! List<dynamic>) {
      throw FormatException('$key must be a list');
    }
    return events
        .map((item) => UserEvent.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  /// Six decimals: about 10 cm, what the map's own bounds carry.
  static String _coordinate(double value) => value.toStringAsFixed(6);

  Future<Map<String, String>> _headers() async {
    final token = await tokenSource();
    if (token == null || token.isEmpty) throw const AgentSignInException();
    return {'authorization': 'Bearer $token', 'accept': 'application/json'};
  }

  /// A route: bounded, timed out and decoded; null for `204`.
  Future<Map<String, dynamic>?> _json(
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
      final bytes = await _collect(response.stream, limit: _maxResponseBytes);
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
}
