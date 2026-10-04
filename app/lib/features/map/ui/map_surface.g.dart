// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'map_surface.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(mapSurfaceApiLoader)
final mapSurfaceApiLoaderProvider = MapSurfaceApiLoaderProvider._();

final class MapSurfaceApiLoaderProvider
    extends
        $FunctionalProvider<
          GoogleMapsWebApiLoader,
          GoogleMapsWebApiLoader,
          GoogleMapsWebApiLoader
        >
    with $Provider<GoogleMapsWebApiLoader> {
  MapSurfaceApiLoaderProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'mapSurfaceApiLoaderProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$mapSurfaceApiLoaderHash();

  @$internal
  @override
  $ProviderElement<GoogleMapsWebApiLoader> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  GoogleMapsWebApiLoader create(Ref ref) {
    return mapSurfaceApiLoader(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(GoogleMapsWebApiLoader value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<GoogleMapsWebApiLoader>(value),
    );
  }
}

String _$mapSurfaceApiLoaderHash() =>
    r'44e57fcbc2bd1eedbfa272e090e5c3d008610b90';

/// One app-scoped SDK request precedes all Web platform-map construction.
/// Failed readiness remains explicit until the user requests a retry.

@ProviderFor(mapSurfaceReadiness)
final mapSurfaceReadinessProvider = MapSurfaceReadinessProvider._();

/// One app-scoped SDK request precedes all Web platform-map construction.
/// Failed readiness remains explicit until the user requests a retry.

final class MapSurfaceReadinessProvider
    extends
        $FunctionalProvider<
          AsyncValue<MapSurfaceReadiness>,
          MapSurfaceReadiness,
          FutureOr<MapSurfaceReadiness>
        >
    with
        $FutureModifier<MapSurfaceReadiness>,
        $FutureProvider<MapSurfaceReadiness> {
  /// One app-scoped SDK request precedes all Web platform-map construction.
  /// Failed readiness remains explicit until the user requests a retry.
  MapSurfaceReadinessProvider._()
    : super(
        from: null,
        argument: null,
        retry: _manualMapRetry,
        name: r'mapSurfaceReadinessProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$mapSurfaceReadinessHash();

  @$internal
  @override
  $FutureProviderElement<MapSurfaceReadiness> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<MapSurfaceReadiness> create(Ref ref) {
    return mapSurfaceReadiness(ref);
  }
}

String _$mapSurfaceReadinessHash() =>
    r'15679535ed909db0cb0da76bdf7c7d7eeab0ba00';
