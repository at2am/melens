// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'viewport_controller.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
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
    r'efd10adf4632f0bd96f821d1ff5de771f6b2526a';

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
