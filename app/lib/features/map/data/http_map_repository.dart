import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'map_models.dart';
import 'map_repository.dart';

final class HttpMapRepository implements MapRepository {
  HttpMapRepository({
    required this.client,
    required Uri baseUrl,
    this.expectedDataMode = MapDataMode.live,
    this.requestTimeout = const Duration(seconds: 30),
  }) : _baseUrl = baseUrl {
    if (!{'http', 'https'}.contains(baseUrl.scheme) ||
        baseUrl.host.isEmpty ||
        baseUrl.userInfo.isNotEmpty ||
        baseUrl.hasQuery ||
        baseUrl.hasFragment ||
        requestTimeout <= Duration.zero) {
      throw const MapRequestException();
    }
  }

  static const int _maxResponseBytes = 2 * 1024 * 1024;
  static const int _maxRequestBytes = 256 * 1024;

  final http.Client client;
  final Uri _baseUrl;
  final MapDataMode expectedDataMode;
  final Duration requestTimeout;

  @override
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation}) =>
      _request(
        'GET',
        const ['v1', 'map', 'layers'],
        MapLayerCatalog.fromJson,
        cancellation: cancellation,
      );

  @override
  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  }) async {
    final Map<String, dynamic> body;
    try {
      validateViewportQuery(query);
      body = query.toJson();
    } on MapRepositoryException {
      rethrow;
    } on Object {
      throw const MapRequestException();
    }
    return _request(
      'POST',
      const ['v1', 'map', 'viewport'],
      (json) {
        final response = ViewportResponse.fromJson(json);
        final ids = response.layers.map((layer) => layer.layerId).toSet();
        if (ids.length != query.layers.length ||
            !query.layers.every(ids.contains)) {
          throw const MapContractException(MapContractFailure.requestMismatch);
        }
        return response;
      },
      body: body,
      requestId: _requiredString(body, 'requestId'),
      snapshotId: body['snapshotId'] as String?,
      mode: _requiredString(body, 'mode'),
      cancellation: cancellation,
    );
  }

  @override
  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  }) {
    _validateId(id);
    final parameters = _snapshotParameters(
      _validateInput(() {
        final json = context.toJson();
        MapReadContext.fromJson(json);
        return json;
      }),
    );
    return _request(
      'GET',
      ['v1', 'map', 'items', id],
      (json) {
        final response = MapItemResponse.fromJson(json);
        if (response.item.id != id) {
          throw const MapContractException(MapContractFailure.requestMismatch);
        }
        return response;
      },
      parameters: parameters,
      requestId: parameters['requestId'],
      snapshotId: parameters['snapshotId'],
      cancellation: cancellation,
    );
  }

  @override
  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    final body = _validateInput(() {
      validateUnlocatedQuery(query);
      return query.toJson();
    });
    final requestId = _requiredString(body, 'requestId');
    return _request(
      'GET',
      const ['v1', 'map', 'unlocated'],
      (json) {
        final response = MapItemPage.fromJson(json);
        final Object? scope = json['scope'];
        if (scope is! Map<String, dynamic> || scope['kind'] != 'unlocated') {
          throw const MapContractException(MapContractFailure.requestMismatch);
        }
        final selectedScope = query.scope.toJson();
        final Object? areaRefs = selectedScope['areaRefs'];
        final Object? returnedRefs = scope['areaRefs'];
        if (areaRefs is List<String>) {
          if (returnedRefs is! List<dynamic> ||
              returnedRefs.length != areaRefs.length ||
              !returnedRefs.every(areaRefs.contains) ||
              scope['sourceJurisdiction'] != null) {
            throw const MapContractException(
              MapContractFailure.requestMismatch,
            );
          }
        } else if (scope['sourceJurisdiction'] !=
            selectedScope['sourceJurisdiction']) {
          throw const MapContractException(MapContractFailure.requestMismatch);
        }
        return response;
      },
      parameters: {'query': _encodeBody(body)},
      requestId: requestId,
      snapshotId: body['snapshotId'] as String?,
      mode: _requiredString(body, 'mode'),
      cancellation: cancellation,
    );
  }

  @override
  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  }) {
    _validateId(id);
    final parameters = _snapshotParameters(
      _validateInput(() {
        final json = query.toJson();
        AggregateMembersQuery.fromJson(json);
        return json;
      }),
      withPage: true,
    );
    return _request(
      'GET',
      ['v1', 'map', 'aggregates', id, 'members'],
      (json) {
        final response = MapItemPage.fromJson(json);
        final Object? scope = json['scope'];
        if (scope is! Map<String, dynamic> ||
            scope['kind'] != 'aggregateMembers' ||
            scope['aggregateId'] != id) {
          throw const MapContractException(MapContractFailure.requestMismatch);
        }
        return response;
      },
      parameters: parameters,
      requestId: parameters['requestId'],
      snapshotId: parameters['snapshotId'],
      cancellation: cancellation,
    );
  }

  Uri _endpoint(List<String> segments, Map<String, String>? parameters) => Uri(
    scheme: _baseUrl.scheme,
    host: _baseUrl.host,
    port: _baseUrl.hasPort ? _baseUrl.port : null,
    pathSegments: [
      ..._baseUrl.pathSegments.where((segment) => segment.isNotEmpty),
      ...segments,
    ],
    queryParameters: parameters,
  );

  Future<T> _request<T>(
    String method,
    List<String> segments,
    T Function(Map<String, dynamic>) decode, {
    Map<String, String>? parameters,
    Map<String, dynamic>? body,
    String? requestId,
    String? snapshotId,
    String? mode,
    MapRequestCancellation? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    final abort = MapRequestCancellation();
    var timedOut = false;
    final request =
        http.AbortableRequest(
            method,
            _endpoint(segments, parameters),
            abortTrigger: Future.any([
              abort.whenCancelled,
              if (cancellation != null) cancellation.whenCancelled,
            ]),
          )
          ..followRedirects = false
          ..headers['accept'] = 'application/json';
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.bodyBytes = utf8.encode(_encodeBody(body));
    }
    final timer = Timer(requestTimeout, () {
      timedOut = true;
      abort.cancel();
    });
    try {
      final result = await Future.any([
        _sendAndDecode(
          request,
          decode,
          requestId: requestId,
          snapshotId: snapshotId,
          mode: mode,
        ),
        request.abortTrigger!.then<T>((_) => throw const MapRequestCancelled()),
      ]);
      cancellation?.throwIfCancelled();
      return result;
    } on MapRequestCancelled {
      if (timedOut) throw const MapTimeoutException();
      rethrow;
    } on http.RequestAbortedException {
      if (timedOut) throw const MapTimeoutException();
      throw const MapRequestCancelled();
    } on http.ClientException {
      throw const MapNetworkException();
    } on MapRepositoryException {
      rethrow;
    } on Exception {
      throw const MapNetworkException();
    } finally {
      timer.cancel();
    }
  }

  Future<T> _sendAndDecode<T>(
    http.BaseRequest request,
    T Function(Map<String, dynamic>) decode, {
    String? requestId,
    String? snapshotId,
    String? mode,
  }) async {
    final response = await client.send(request);
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in response.stream) {
      if (bytes.length + chunk.length > _maxResponseBytes) {
        throw const MapContractException(MapContractFailure.responseTooLarge);
      }
      bytes.add(chunk);
    }
    final body = bytes.takeBytes();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _httpFailure(response.statusCode, body);
    }
    final Map<String, dynamic> json;
    try {
      final Object? value = jsonDecode(utf8.decode(body));
      if (value is! Map<String, dynamic>) {
        throw const MapContractException(MapContractFailure.invalidEnvelope);
      }
      json = value;
    } on FormatException {
      throw const MapContractException(MapContractFailure.invalidJson);
    }
    if (json['schemaVersion'] != 1 || json['schemaVersion'] is! int) {
      throw const MapContractException(MapContractFailure.unsupportedSchema);
    }
    if (json['dataMode'] != expectedDataMode.name) {
      throw const MapContractException(MapContractFailure.dataModeMismatch);
    }
    if ((requestId != null && json['requestId'] != requestId) ||
        (snapshotId != null && json['snapshotId'] != snapshotId) ||
        (mode != null && json['mode'] != mode)) {
      throw const MapContractException(MapContractFailure.requestMismatch);
    }
    try {
      return decode(json);
    } on MapRepositoryException {
      rethrow;
    } on Object {
      throw const MapContractException(MapContractFailure.invalidEnvelope);
    }
  }

  static MapHttpException _httpFailure(int statusCode, Uint8List bytes) {
    MapServiceErrorCode? code;
    var retryable = {408, 429, 502, 503, 504}.contains(statusCode);
    try {
      final Object? json = jsonDecode(utf8.decode(bytes));
      if (json is Map<String, dynamic>) {
        final Object? error = json['error'];
        if (error is Map<String, dynamic>) {
          for (final candidate in MapServiceErrorCode.values) {
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
      // Proxy and network errors may have an HTML body; never expose it.
    }
    return MapHttpException(
      statusCode: statusCode,
      code: code,
      retryable: retryable,
    );
  }

  static void _validateId(String id) {
    if (id.isEmpty || id.length > 256 || RegExp(r'\s').hasMatch(id)) {
      throw const MapRequestException();
    }
  }

  static String _requiredString(Map<String, dynamic> json, String key) {
    final Object? value = json[key];
    if (value is! String) {
      throw const MapRequestException();
    }
    _validateId(value);
    return value;
  }

  static Map<String, dynamic> _validateInput(
    Map<String, dynamic> Function() encode,
  ) {
    try {
      return encode();
    } on MapRepositoryException {
      rethrow;
    } on Object {
      throw const MapRequestException();
    }
  }

  static Map<String, String> _snapshotParameters(
    Map<String, dynamic> json, {
    bool withPage = false,
  }) {
    final parameters = {
      'requestId': _requiredString(json, 'requestId'),
      'snapshotId': _requiredString(json, 'snapshotId'),
    };
    if (withPage) {
      final Object? cursor = json['cursor'];
      if (cursor != null) {
        if (cursor is! String || cursor.isEmpty) {
          throw const MapRequestException();
        }
        _validateId(cursor);
        parameters['cursor'] = cursor;
      }
      final Object? pageSize = json['pageSize'];
      if (pageSize != null) {
        if (pageSize is! int || pageSize < 1 || pageSize > 1000) {
          throw const MapRequestException();
        }
        parameters['pageSize'] = pageSize.toString();
      }
    }
    return parameters;
  }

  static String _encodeBody(Map<String, dynamic> json) {
    final String body;
    try {
      body = jsonEncode(json);
    } on Object {
      throw const MapRequestException();
    }
    if (utf8.encode(body).length > _maxRequestBytes) {
      throw const MapRequestException();
    }
    return body;
  }
}
