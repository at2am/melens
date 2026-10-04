// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'layer_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Keep topic adjustments for the application session, including panel closure.
/// This controller never reads data or activates a source.

@ProviderFor(LayerController)
final layerControllerProvider = LayerControllerProvider._();

/// Keep topic adjustments for the application session, including panel closure.
/// This controller never reads data or activates a source.
final class LayerControllerProvider
    extends $NotifierProvider<LayerController, LayerSelectionState> {
  /// Keep topic adjustments for the application session, including panel closure.
  /// This controller never reads data or activates a source.
  LayerControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'layerControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$layerControllerHash();

  @$internal
  @override
  LayerController create() => LayerController();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(LayerSelectionState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<LayerSelectionState>(value),
    );
  }
}

String _$layerControllerHash() => r'7a0495c08e0b0a8a68c49063e2b89d5ba48c1d64';

/// Keep topic adjustments for the application session, including panel closure.
/// This controller never reads data or activates a source.

abstract class _$LayerController extends $Notifier<LayerSelectionState> {
  LayerSelectionState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<LayerSelectionState, LayerSelectionState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<LayerSelectionState, LayerSelectionState>,
              LayerSelectionState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
