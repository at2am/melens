// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'viewport_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Whether the map searches again by itself after the user pans or zooms.
/// On by default since the map service answers from memory in milliseconds
/// (system-design/map-serving-stateless.md); turned off, a moved map offers
/// "Search this area" instead. Kept for the application session, like the
/// theme choice.

@ProviderFor(MapAutoSearch)
final mapAutoSearchProvider = MapAutoSearchProvider._();

/// Whether the map searches again by itself after the user pans or zooms.
/// On by default since the map service answers from memory in milliseconds
/// (system-design/map-serving-stateless.md); turned off, a moved map offers
/// "Search this area" instead. Kept for the application session, like the
/// theme choice.
final class MapAutoSearchProvider
    extends $NotifierProvider<MapAutoSearch, bool> {
  /// Whether the map searches again by itself after the user pans or zooms.
  /// On by default since the map service answers from memory in milliseconds
  /// (system-design/map-serving-stateless.md); turned off, a moved map offers
  /// "Search this area" instead. Kept for the application session, like the
  /// theme choice.
  MapAutoSearchProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'mapAutoSearchProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$mapAutoSearchHash();

  @$internal
  @override
  MapAutoSearch create() => MapAutoSearch();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(bool value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<bool>(value),
    );
  }
}

String _$mapAutoSearchHash() => r'169faafbbd2c361e9c88157341498fa893df72b1';

/// Whether the map searches again by itself after the user pans or zooms.
/// On by default since the map service answers from memory in milliseconds
/// (system-design/map-serving-stateless.md); turned off, a moved map offers
/// "Search this area" instead. Kept for the application session, like the
/// theme choice.

abstract class _$MapAutoSearch extends $Notifier<bool> {
  bool build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<bool, bool>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<bool, bool>,
              bool,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// Cancels superseded operations before the debounce, and guards every result.

@ProviderFor(ViewportController)
final viewportControllerProvider = ViewportControllerProvider._();

/// Cancels superseded operations before the debounce, and guards every result.
final class ViewportControllerProvider
    extends $NotifierProvider<ViewportController, ViewportState> {
  /// Cancels superseded operations before the debounce, and guards every result.
  ViewportControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'viewportControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$viewportControllerHash();

  @$internal
  @override
  ViewportController create() => ViewportController();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(ViewportState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<ViewportState>(value),
    );
  }
}

String _$viewportControllerHash() =>
    r'fccdf4c2668a20026c08b0ad3e597634f654135d';

/// Cancels superseded operations before the debounce, and guards every result.

abstract class _$ViewportController extends $Notifier<ViewportState> {
  ViewportState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<ViewportState, ViewportState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<ViewportState, ViewportState>,
              ViewportState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
