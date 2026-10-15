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

@ProviderFor(nativeMapsKey)
final nativeMapsKeyProvider = NativeMapsKeyProvider._();

final class NativeMapsKeyProvider
    extends $FunctionalProvider<NativeMapsKey, NativeMapsKey, NativeMapsKey>
    with $Provider<NativeMapsKey> {
  NativeMapsKeyProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'nativeMapsKeyProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$nativeMapsKeyHash();

  @$internal
  @override
  $ProviderElement<NativeMapsKey> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  NativeMapsKey create(Ref ref) {
    return nativeMapsKey(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(NativeMapsKey value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<NativeMapsKey>(value),
    );
  }
}

String _$nativeMapsKeyHash() => r'b6fd53e5e0c93ca558731f26df7c53c6491a4aaf';

/// One app-scoped SDK request precedes all platform-map construction: the
/// JavaScript API on the Web, the native key on iOS. Failed readiness remains
/// explicit until the user requests a retry.

@ProviderFor(mapSurfaceReadiness)
final mapSurfaceReadinessProvider = MapSurfaceReadinessProvider._();

/// One app-scoped SDK request precedes all platform-map construction: the
/// JavaScript API on the Web, the native key on iOS. Failed readiness remains
/// explicit until the user requests a retry.

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
  /// One app-scoped SDK request precedes all platform-map construction: the
  /// JavaScript API on the Web, the native key on iOS. Failed readiness remains
  /// explicit until the user requests a retry.
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
    r'415fb85600878e9cfc21963f0cf47ba87f776e11';
