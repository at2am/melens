// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'map_actions.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Applies the agent's one-way UI actions to the map (agent-protocol.md,
/// Rules). The server never waits for a result; the next request context
/// reports the real state.

@ProviderFor(MapActionsController)
final mapActionsControllerProvider = MapActionsControllerProvider._();

/// Applies the agent's one-way UI actions to the map (agent-protocol.md,
/// Rules). The server never waits for a result; the next request context
/// reports the real state.
final class MapActionsControllerProvider
    extends $NotifierProvider<MapActionsController, MapActionsState> {
  /// Applies the agent's one-way UI actions to the map (agent-protocol.md,
  /// Rules). The server never waits for a result; the next request context
  /// reports the real state.
  MapActionsControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'mapActionsControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$mapActionsControllerHash();

  @$internal
  @override
  MapActionsController create() => MapActionsController();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(MapActionsState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<MapActionsState>(value),
    );
  }
}

String _$mapActionsControllerHash() =>
    r'f0d7b0e7bcc4a3ed711f03b1858be0bd14e4cea9';

/// Applies the agent's one-way UI actions to the map (agent-protocol.md,
/// Rules). The server never waits for a result; the next request context
/// reports the real state.

abstract class _$MapActionsController extends $Notifier<MapActionsState> {
  MapActionsState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<MapActionsState, MapActionsState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<MapActionsState, MapActionsState>,
              MapActionsState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
