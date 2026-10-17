// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'memory_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Tests override this with a scripted [MemoryClient].

@ProviderFor(memoryClient)
final memoryClientProvider = MemoryClientProvider._();

/// Tests override this with a scripted [MemoryClient].

final class MemoryClientProvider
    extends $FunctionalProvider<MemoryClient, MemoryClient, MemoryClient>
    with $Provider<MemoryClient> {
  /// Tests override this with a scripted [MemoryClient].
  MemoryClientProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'memoryClientProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$memoryClientHash();

  @$internal
  @override
  $ProviderElement<MemoryClient> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  MemoryClient create(Ref ref) {
    return memoryClient(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(MemoryClient value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<MemoryClient>(value),
    );
  }
}

String _$memoryClientHash() => r'9ff55e6e963859697667f7e8dccf9c81e911f611';

/// What the assistant remembers about the user, as the agent service keeps
/// it. Settings shows it; the user switches it off, forgets one fact or
/// clears it all.

@ProviderFor(AssistantMemory)
final assistantMemoryProvider = AssistantMemoryProvider._();

/// What the assistant remembers about the user, as the agent service keeps
/// it. Settings shows it; the user switches it off, forgets one fact or
/// clears it all.
final class AssistantMemoryProvider
    extends $AsyncNotifierProvider<AssistantMemory, UserMemory> {
  /// What the assistant remembers about the user, as the agent service keeps
  /// it. Settings shows it; the user switches it off, forgets one fact or
  /// clears it all.
  AssistantMemoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: _manualRetry,
        name: r'assistantMemoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$assistantMemoryHash();

  @$internal
  @override
  AssistantMemory create() => AssistantMemory();
}

String _$assistantMemoryHash() => r'2666f0fa867f48443f64663fa5e8600a7dba960a';

/// What the assistant remembers about the user, as the agent service keeps
/// it. Settings shows it; the user switches it off, forgets one fact or
/// clears it all.

abstract class _$AssistantMemory extends $AsyncNotifier<UserMemory> {
  FutureOr<UserMemory> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<UserMemory>, UserMemory>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<UserMemory>, UserMemory>,
              AsyncValue<UserMemory>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// What the user does on the map, kept for the assistant's memory: the layers
/// they turn on and the records they open, never where. Signals wait here and
/// go to the agent service in batches, and before each chat message, so the
/// assistant reads them with the message. While memory is off nothing is
/// kept. A batch that fails is dropped: browsing is a hint, not a record.

@ProviderFor(BrowsingTracker)
final browsingTrackerProvider = BrowsingTrackerProvider._();

/// What the user does on the map, kept for the assistant's memory: the layers
/// they turn on and the records they open, never where. Signals wait here and
/// go to the agent service in batches, and before each chat message, so the
/// assistant reads them with the message. While memory is off nothing is
/// kept. A batch that fails is dropped: browsing is a hint, not a record.
final class BrowsingTrackerProvider
    extends $NotifierProvider<BrowsingTracker, List<BrowsingSignal>> {
  /// What the user does on the map, kept for the assistant's memory: the layers
  /// they turn on and the records they open, never where. Signals wait here and
  /// go to the agent service in batches, and before each chat message, so the
  /// assistant reads them with the message. While memory is off nothing is
  /// kept. A batch that fails is dropped: browsing is a hint, not a record.
  BrowsingTrackerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'browsingTrackerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$browsingTrackerHash();

  @$internal
  @override
  BrowsingTracker create() => BrowsingTracker();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(List<BrowsingSignal> value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<List<BrowsingSignal>>(value),
    );
  }
}

String _$browsingTrackerHash() => r'197ce9a69332a6128d9117e70460cfbedd074e5b';

/// What the user does on the map, kept for the assistant's memory: the layers
/// they turn on and the records they open, never where. Signals wait here and
/// go to the agent service in batches, and before each chat message, so the
/// assistant reads them with the message. While memory is off nothing is
/// kept. A batch that fails is dropped: browsing is a hint, not a record.

abstract class _$BrowsingTracker extends $Notifier<List<BrowsingSignal>> {
  List<BrowsingSignal> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<List<BrowsingSignal>, List<BrowsingSignal>>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<List<BrowsingSignal>, List<BrowsingSignal>>,
              List<BrowsingSignal>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
