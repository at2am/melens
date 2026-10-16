// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'layer_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Saves the layers on this device (UC-01).
/// Tests override this with an in-memory [LayerMemory].

@ProviderFor(layerMemory)
final layerMemoryProvider = LayerMemoryProvider._();

/// Saves the layers on this device (UC-01).
/// Tests override this with an in-memory [LayerMemory].

final class LayerMemoryProvider
    extends $FunctionalProvider<LayerMemory, LayerMemory, LayerMemory>
    with $Provider<LayerMemory> {
  /// Saves the layers on this device (UC-01).
  /// Tests override this with an in-memory [LayerMemory].
  LayerMemoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'layerMemoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$layerMemoryHash();

  @$internal
  @override
  $ProviderElement<LayerMemory> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  LayerMemory create(Ref ref) {
    return layerMemory(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(LayerMemory value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<LayerMemory>(value),
    );
  }
}

String _$layerMemoryHash() => r'6c492c22e5b8021d3722e24f6959d1d7d61063cf';

/// Keep topic adjustments across panel closure and, through [LayerMemory],
/// across launches: the map opens on the layers the user last had on.
/// This controller never reads data or activates a source.

@ProviderFor(LayerController)
final layerControllerProvider = LayerControllerProvider._();

/// Keep topic adjustments across panel closure and, through [LayerMemory],
/// across launches: the map opens on the layers the user last had on.
/// This controller never reads data or activates a source.
final class LayerControllerProvider
    extends $NotifierProvider<LayerController, LayerSelectionState> {
  /// Keep topic adjustments across panel closure and, through [LayerMemory],
  /// across launches: the map opens on the layers the user last had on.
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

String _$layerControllerHash() => r'482a551dc98d7bb18dd4d0fc1562a428faa90586';

/// Keep topic adjustments across panel closure and, through [LayerMemory],
/// across launches: the map opens on the layers the user last had on.
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
