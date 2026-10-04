// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'map_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The build selects one repository. A live request never falls back to samples.

@ProviderFor(mapRepository)
final mapRepositoryProvider = MapRepositoryProvider._();

/// The build selects one repository. A live request never falls back to samples.

final class MapRepositoryProvider
    extends $FunctionalProvider<MapRepository, MapRepository, MapRepository>
    with $Provider<MapRepository> {
  /// The build selects one repository. A live request never falls back to samples.
  MapRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'mapRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$mapRepositoryHash();

  @$internal
  @override
  $ProviderElement<MapRepository> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  MapRepository create(Ref ref) {
    return mapRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(MapRepository value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<MapRepository>(value),
    );
  }
}

String _$mapRepositoryHash() => r'd3f0c185af78aebe4fde91bd139999c8d0a55ec2';

@ProviderFor(mapLayerCatalog)
final mapLayerCatalogProvider = MapLayerCatalogProvider._();

final class MapLayerCatalogProvider
    extends
        $FunctionalProvider<
          AsyncValue<MapLayerCatalog>,
          MapLayerCatalog,
          FutureOr<MapLayerCatalog>
        >
    with $FutureModifier<MapLayerCatalog>, $FutureProvider<MapLayerCatalog> {
  MapLayerCatalogProvider._()
    : super(
        from: null,
        argument: null,
        retry: _manualRetry,
        name: r'mapLayerCatalogProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$mapLayerCatalogHash();

  @$internal
  @override
  $FutureProviderElement<MapLayerCatalog> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<MapLayerCatalog> create(Ref ref) {
    return mapLayerCatalog(ref);
  }
}

String _$mapLayerCatalogHash() => r'aef63492f75e6c6beee9ebd20ebe5a41fd581d39';

/// Each query owns its cancellation handle; changing a family key releases it.

@ProviderFor(mapViewport)
final mapViewportProvider = MapViewportFamily._();

/// Each query owns its cancellation handle; changing a family key releases it.

final class MapViewportProvider
    extends
        $FunctionalProvider<
          AsyncValue<ViewportResponse>,
          ViewportResponse,
          FutureOr<ViewportResponse>
        >
    with $FutureModifier<ViewportResponse>, $FutureProvider<ViewportResponse> {
  /// Each query owns its cancellation handle; changing a family key releases it.
  MapViewportProvider._({
    required MapViewportFamily super.from,
    required ViewportQuery super.argument,
  }) : super(
         retry: _manualRetry,
         name: r'mapViewportProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$mapViewportHash();

  @override
  String toString() {
    return r'mapViewportProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<ViewportResponse> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<ViewportResponse> create(Ref ref) {
    final argument = this.argument as ViewportQuery;
    return mapViewport(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is MapViewportProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$mapViewportHash() => r'ff5cde332b7bcc7c61aafb9a5f5fed400a2a0f85';

/// Each query owns its cancellation handle; changing a family key releases it.

final class MapViewportFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<ViewportResponse>, ViewportQuery> {
  MapViewportFamily._()
    : super(
        retry: _manualRetry,
        name: r'mapViewportProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// Each query owns its cancellation handle; changing a family key releases it.

  MapViewportProvider call(ViewportQuery query) =>
      MapViewportProvider._(argument: query, from: this);

  @override
  String toString() => r'mapViewportProvider';
}

@ProviderFor(mapItem)
final mapItemProvider = MapItemFamily._();

final class MapItemProvider
    extends
        $FunctionalProvider<
          AsyncValue<MapItemResponse>,
          MapItemResponse,
          FutureOr<MapItemResponse>
        >
    with $FutureModifier<MapItemResponse>, $FutureProvider<MapItemResponse> {
  MapItemProvider._({
    required MapItemFamily super.from,
    required (String, MapReadContext) super.argument,
  }) : super(
         retry: _manualRetry,
         name: r'mapItemProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$mapItemHash();

  @override
  String toString() {
    return r'mapItemProvider'
        ''
        '$argument';
  }

  @$internal
  @override
  $FutureProviderElement<MapItemResponse> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<MapItemResponse> create(Ref ref) {
    final argument = this.argument as (String, MapReadContext);
    return mapItem(ref, argument.$1, argument.$2);
  }

  @override
  bool operator ==(Object other) {
    return other is MapItemProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$mapItemHash() => r'5a68d9539d03a394fe4e92698d877f48f7edc078';

final class MapItemFamily extends $Family
    with
        $FunctionalFamilyOverride<
          FutureOr<MapItemResponse>,
          (String, MapReadContext)
        > {
  MapItemFamily._()
    : super(
        retry: _manualRetry,
        name: r'mapItemProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  MapItemProvider call(String id, MapReadContext context) =>
      MapItemProvider._(argument: (id, context), from: this);

  @override
  String toString() => r'mapItemProvider';
}

@ProviderFor(mapUnlocated)
final mapUnlocatedProvider = MapUnlocatedFamily._();

final class MapUnlocatedProvider
    extends
        $FunctionalProvider<
          AsyncValue<MapItemPage>,
          MapItemPage,
          FutureOr<MapItemPage>
        >
    with $FutureModifier<MapItemPage>, $FutureProvider<MapItemPage> {
  MapUnlocatedProvider._({
    required MapUnlocatedFamily super.from,
    required UnlocatedQuery super.argument,
  }) : super(
         retry: _manualRetry,
         name: r'mapUnlocatedProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$mapUnlocatedHash();

  @override
  String toString() {
    return r'mapUnlocatedProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<MapItemPage> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<MapItemPage> create(Ref ref) {
    final argument = this.argument as UnlocatedQuery;
    return mapUnlocated(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is MapUnlocatedProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$mapUnlocatedHash() => r'92edbe65bf27ddf30fd199bf2ca3a89a2b8b8f54';

final class MapUnlocatedFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<MapItemPage>, UnlocatedQuery> {
  MapUnlocatedFamily._()
    : super(
        retry: _manualRetry,
        name: r'mapUnlocatedProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  MapUnlocatedProvider call(UnlocatedQuery query) =>
      MapUnlocatedProvider._(argument: query, from: this);

  @override
  String toString() => r'mapUnlocatedProvider';
}

@ProviderFor(mapAggregateMembers)
final mapAggregateMembersProvider = MapAggregateMembersFamily._();

final class MapAggregateMembersProvider
    extends
        $FunctionalProvider<
          AsyncValue<MapItemPage>,
          MapItemPage,
          FutureOr<MapItemPage>
        >
    with $FutureModifier<MapItemPage>, $FutureProvider<MapItemPage> {
  MapAggregateMembersProvider._({
    required MapAggregateMembersFamily super.from,
    required (String, AggregateMembersQuery) super.argument,
  }) : super(
         retry: _manualRetry,
         name: r'mapAggregateMembersProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$mapAggregateMembersHash();

  @override
  String toString() {
    return r'mapAggregateMembersProvider'
        ''
        '$argument';
  }

  @$internal
  @override
  $FutureProviderElement<MapItemPage> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<MapItemPage> create(Ref ref) {
    final argument = this.argument as (String, AggregateMembersQuery);
    return mapAggregateMembers(ref, argument.$1, argument.$2);
  }

  @override
  bool operator ==(Object other) {
    return other is MapAggregateMembersProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$mapAggregateMembersHash() =>
    r'86fac68c0d065264335679ef77bd37f8d99d4b73';

final class MapAggregateMembersFamily extends $Family
    with
        $FunctionalFamilyOverride<
          FutureOr<MapItemPage>,
          (String, AggregateMembersQuery)
        > {
  MapAggregateMembersFamily._()
    : super(
        retry: _manualRetry,
        name: r'mapAggregateMembersProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  MapAggregateMembersProvider call(String id, AggregateMembersQuery query) =>
      MapAggregateMembersProvider._(argument: (id, query), from: this);

  @override
  String toString() => r'mapAggregateMembersProvider';
}
