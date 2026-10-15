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
/// pages sit under the feed branch, inside the shell, so the chat button stays
/// reachable on them.

@ProviderFor(router)
final routerProvider = RouterProvider._();

/// The app's router. It is a provider so that redirects can later watch app
/// state, for example the auth state for UC-07 and UC-09.
///
/// The three tabs are branches of one stateful shell, so each keeps its scroll
/// position and the map keeps its camera while the user is elsewhere. Event
/// pages sit under the feed branch, inside the shell, so the chat button stays
/// reachable on them.

final class RouterProvider
    extends $FunctionalProvider<GoRouter, GoRouter, GoRouter>
    with $Provider<GoRouter> {
  /// The app's router. It is a provider so that redirects can later watch app
  /// state, for example the auth state for UC-07 and UC-09.
  ///
  /// The three tabs are branches of one stateful shell, so each keeps its scroll
  /// position and the map keeps its camera while the user is elsewhere. Event
  /// pages sit under the feed branch, inside the shell, so the chat button stays
  /// reachable on them.
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

String _$routerHash() => r'de72bf1f0574e01e3708667963daa2d06b1c1f65';
