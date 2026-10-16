// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'plans_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Tests override this with a scripted [PlansClient].

@ProviderFor(plansClient)
final plansClientProvider = PlansClientProvider._();

/// Tests override this with a scripted [PlansClient].

final class PlansClientProvider
    extends $FunctionalProvider<PlansClient, PlansClient, PlansClient>
    with $Provider<PlansClient> {
  /// Tests override this with a scripted [PlansClient].
  PlansClientProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'plansClientProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$plansClientHash();

  @$internal
  @override
  $ProviderElement<PlansClient> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  PlansClient create(Ref ref) {
    return plansClient(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(PlansClient value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<PlansClient>(value),
    );
  }
}

String _$plansClientHash() => r'c0924a16a854e3cbd9c1b5f9244ede8a4b62afd2';

/// The plans the user saved from the chat, newest first, as the agent
/// service stores them. They show on the Feed tab until the user removes
/// them.

@ProviderFor(SavedPlans)
final savedPlansProvider = SavedPlansProvider._();

/// The plans the user saved from the chat, newest first, as the agent
/// service stores them. They show on the Feed tab until the user removes
/// them.
final class SavedPlansProvider
    extends $AsyncNotifierProvider<SavedPlans, List<SavedPlan>> {
  /// The plans the user saved from the chat, newest first, as the agent
  /// service stores them. They show on the Feed tab until the user removes
  /// them.
  SavedPlansProvider._()
    : super(
        from: null,
        argument: null,
        retry: _manualRetry,
        name: r'savedPlansProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$savedPlansHash();

  @$internal
  @override
  SavedPlans create() => SavedPlans();
}

String _$savedPlansHash() => r'006c41764108daf5fcf5ab5f22a0d007118db9a8';

/// The plans the user saved from the chat, newest first, as the agent
/// service stores them. They show on the Feed tab until the user removes
/// them.

abstract class _$SavedPlans extends $AsyncNotifier<List<SavedPlan>> {
  FutureOr<List<SavedPlan>> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<List<SavedPlan>>, List<SavedPlan>>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<List<SavedPlan>>, List<SavedPlan>>,
              AsyncValue<List<SavedPlan>>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
