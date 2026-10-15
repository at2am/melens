// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'router.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The app's router. It is a provider so that redirects can later watch app
/// state, for example the auth state for UC-07 and UC-09.
///
/// The three tabs are branches of one stateful shell, so each keeps its scroll
/// position and the map keeps its camera while the user is elsewhere. Event
/// links (`/events/:id`, the address an invite carries) open that event in the
/// events panel on the Discover tab. The feed editor opens above the tabs,
/// from the feed or from Settings, and returns to where it was opened.

@ProviderFor(router)
final routerProvider = RouterProvider._();

/// The app's router. It is a provider so that redirects can later watch app
/// state, for example the auth state for UC-07 and UC-09.
///
/// The three tabs are branches of one stateful shell, so each keeps its scroll
/// position and the map keeps its camera while the user is elsewhere. Event
/// links (`/events/:id`, the address an invite carries) open that event in the
/// events panel on the Discover tab. The feed editor opens above the tabs,
/// from the feed or from Settings, and returns to where it was opened.

final class RouterProvider
    extends $FunctionalProvider<GoRouter, GoRouter, GoRouter>
    with $Provider<GoRouter> {
  /// The app's router. It is a provider so that redirects can later watch app
  /// state, for example the auth state for UC-07 and UC-09.
  ///
  /// The three tabs are branches of one stateful shell, so each keeps its scroll
  /// position and the map keeps its camera while the user is elsewhere. Event
  /// links (`/events/:id`, the address an invite carries) open that event in the
  /// events panel on the Discover tab. The feed editor opens above the tabs,
  /// from the feed or from Settings, and returns to where it was opened.
  RouterProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'routerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$routerHash();

  @$internal
  @override
  $ProviderElement<GoRouter> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  GoRouter create(Ref ref) {
    return router(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(GoRouter value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<GoRouter>(value),
    );
  }
}

String _$routerHash() => r'f3374b932ef12db5b0c660655bcaecabfe317b60';
