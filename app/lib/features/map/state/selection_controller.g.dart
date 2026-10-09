// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'selection_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(SelectionController)
final selectionControllerProvider = SelectionControllerProvider._();

final class SelectionControllerProvider
    extends $NotifierProvider<SelectionController, MapSelectionState> {
  SelectionControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'selectionControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$selectionControllerHash();

  @$internal
  @override
  SelectionController create() => SelectionController();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(MapSelectionState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<MapSelectionState>(value),
    );
  }
}

String _$selectionControllerHash() =>
    r'f1d3ac1bb4adf717682da3d07128dd2083d6c864';

abstract class _$SelectionController extends $Notifier<MapSelectionState> {
  MapSelectionState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<MapSelectionState, MapSelectionState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<MapSelectionState, MapSelectionState>,
              MapSelectionState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
