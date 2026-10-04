import 'dart:async';

import 'map_models.dart';

abstract interface class MapRepository {
  Future<MapLayerCatalog> getLayers({MapRequestCancellation? cancellation});

  Future<ViewportResponse> queryViewport(
    ViewportQuery query, {
    MapRequestCancellation? cancellation,
  });

  Future<MapItemResponse> getItem(
    String id,
    MapReadContext context, {
    MapRequestCancellation? cancellation,
  });

  Future<MapItemPage> getUnlocated(
    UnlocatedQuery query, {
    MapRequestCancellation? cancellation,
  });

  Future<MapItemPage> getAggregateMembers(
    String id,
    AggregateMembersQuery query, {
    MapRequestCancellation? cancellation,
  });
}

/// One cancellation handle per request, including superseded viewport requests.
final class MapRequestCancellation {
  final Completer<void> _cancelled = Completer<void>();

  bool get isCancelled => _cancelled.isCompleted;
  Future<void> get whenCancelled => _cancelled.future;

  void cancel() {
    if (!isCancelled) _cancelled.complete();
  }

  void throwIfCancelled() {
    if (isCancelled) throw const MapRequestCancelled();
  }
}

sealed class MapRepositoryException implements Exception {
  const MapRepositoryException();

  bool get retryable;
}

final class MapRequestException extends MapRepositoryException {
  const MapRequestException();

  @override
  bool get retryable => false;

  @override
  String toString() => 'MapRequestException: invalid map request';
}

enum MapContractFailure {
  invalidJson,
  unsupportedSchema,
  invalidEnvelope,
  requestMismatch,
  dataModeMismatch,
  responseTooLarge,
}

final class MapContractException extends MapRepositoryException {
  const MapContractException(this.failure);

  final MapContractFailure failure;

  @override
  bool get retryable => false;

  @override
  String toString() => 'MapContractException: ${failure.name}';
}

enum MapServiceErrorCode {
  invalidRequest,
  cursorMismatch,
  notFound,
  notAvailable,
  snapshotExpired,
  rateLimited,
  budgetExceeded,
  queryTimeout,
  serviceUnavailable,
}

final class MapHttpException extends MapRepositoryException {
  const MapHttpException({
    required this.statusCode,
    required this.retryable,
    this.code,
  });

  final int statusCode;
  final MapServiceErrorCode? code;

  @override
  final bool retryable;

  @override
  String toString() => 'MapHttpException: HTTP $statusCode';
}

final class MapNetworkException extends MapRepositoryException {
  const MapNetworkException();

  @override
  bool get retryable => true;

  @override
  String toString() => 'MapNetworkException: map service is unreachable';
}

final class MapTimeoutException extends MapRepositoryException {
  const MapTimeoutException();

  @override
  bool get retryable => true;

  @override
  String toString() => 'MapTimeoutException: map request timed out';
}

final class MapRequestCancelled extends MapRepositoryException {
  const MapRequestCancelled();

  @override
  bool get retryable => false;

  @override
  String toString() => 'MapRequestCancelled';
}
