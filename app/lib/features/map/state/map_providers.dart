import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/network/http_client.dart';
import '../data/http_map_repository.dart';
import '../data/map_models.dart';
import '../data/map_repository.dart';
import '../data/sample_map_repository.dart';

part 'map_providers.g.dart';

/// The build selects one repository. A live request never falls back to samples.
@Riverpod(keepAlive: true)
MapRepository mapRepository(Ref ref) {
  final configuration = ref.watch(envProvider);
  if (configuration.usesSampleMapData) {
    return SampleMapRepository();
  }
  return HttpMapRepository(
    client: ref.watch(httpClientProvider),
    baseUrl: configuration.mapBaseUrl,
  );
}

MapRequestCancellation _requestCancellation(Ref ref) {
  final cancellation = MapRequestCancellation();
  ref.onDispose(cancellation.cancel);
  return cancellation;
}

// A user action or later refresh may reissue the request; failures never loop.
Duration? _manualRetry(int retryCount, Object error) => null;

@Riverpod(retry: _manualRetry)
Future<MapLayerCatalog> mapLayerCatalog(Ref ref) => ref
    .watch(mapRepositoryProvider)
    .getLayers(cancellation: _requestCancellation(ref));

/// Each query owns its cancellation handle; changing a family key releases it.
@Riverpod(retry: _manualRetry)
Future<ViewportResponse> mapViewport(Ref ref, ViewportQuery query) => ref
    .watch(mapRepositoryProvider)
    .queryViewport(query, cancellation: _requestCancellation(ref));

@Riverpod(retry: _manualRetry)
Future<MapItemResponse> mapItem(Ref ref, String id, MapReadContext context) =>
    ref
        .watch(mapRepositoryProvider)
        .getItem(id, context, cancellation: _requestCancellation(ref));

@Riverpod(retry: _manualRetry)
Future<MapItemPage> mapUnlocated(Ref ref, UnlocatedQuery query) => ref
    .watch(mapRepositoryProvider)
    .getUnlocated(query, cancellation: _requestCancellation(ref));

@Riverpod(retry: _manualRetry)
Future<MapItemPage> mapAggregateMembers(
  Ref ref,
  String id,
  AggregateMembersQuery query,
) => ref
    .watch(mapRepositoryProvider)
    .getAggregateMembers(id, query, cancellation: _requestCancellation(ref));
