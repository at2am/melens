// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'feed_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Tests override this with a scripted [FeedsClient].

@ProviderFor(feedsClient)
final feedsClientProvider = FeedsClientProvider._();

/// Tests override this with a scripted [FeedsClient].

final class FeedsClientProvider
    extends $FunctionalProvider<FeedsClient, FeedsClient, FeedsClient>
    with $Provider<FeedsClient> {
  /// Tests override this with a scripted [FeedsClient].
  FeedsClientProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'feedsClientProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$feedsClientHash();

  @$internal
  @override
  $ProviderElement<FeedsClient> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  FeedsClient create(Ref ref) {
    return feedsClient(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(FeedsClient value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<FeedsClient>(value),
    );
  }
}

String _$feedsClientHash() => r'0b5c7f9c69502eefe8dd73324bdc5bd6217bacd1';

/// The user's feeds, in their order, as the agent service stores them. A
/// user who never saved one sees [defaultFeedSubscriptions].
///
/// A change shows at once and then saves the whole list. Saves run one after
/// another, so an older list never lands after a newer one; a failed save
/// puts the list back and rethrows for the caller to report.

@ProviderFor(FeedSubscriptions)
final feedSubscriptionsProvider = FeedSubscriptionsProvider._();

/// The user's feeds, in their order, as the agent service stores them. A
/// user who never saved one sees [defaultFeedSubscriptions].
///
/// A change shows at once and then saves the whole list. Saves run one after
/// another, so an older list never lands after a newer one; a failed save
/// puts the list back and rethrows for the caller to report.
final class FeedSubscriptionsProvider
    extends $AsyncNotifierProvider<FeedSubscriptions, List<FeedSubscription>> {
  /// The user's feeds, in their order, as the agent service stores them. A
  /// user who never saved one sees [defaultFeedSubscriptions].
  ///
  /// A change shows at once and then saves the whole list. Saves run one after
  /// another, so an older list never lands after a newer one; a failed save
  /// puts the list back and rethrows for the caller to report.
  FeedSubscriptionsProvider._()
    : super(
        from: null,
        argument: null,
        retry: _manualRetry,
        name: r'feedSubscriptionsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$feedSubscriptionsHash();

  @$internal
  @override
  FeedSubscriptions create() => FeedSubscriptions();
}

String _$feedSubscriptionsHash() => r'03f0f972857590babd6f4811c0cad03227468aec';

/// The user's feeds, in their order, as the agent service stores them. A
/// user who never saved one sees [defaultFeedSubscriptions].
///
/// A change shows at once and then saves the whole list. Saves run one after
/// another, so an older list never lands after a newer one; a failed save
/// puts the list back and rethrows for the caller to report.

abstract class _$FeedSubscriptions
    extends $AsyncNotifier<List<FeedSubscription>> {
  FutureOr<List<FeedSubscription>> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref =
        this.ref
            as $Ref<AsyncValue<List<FeedSubscription>>, List<FeedSubscription>>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<
                AsyncValue<List<FeedSubscription>>,
                List<FeedSubscription>
              >,
              AsyncValue<List<FeedSubscription>>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// Null in the app, which asks the platform map; tests, which have none,
/// override it.

@ProviderFor(areaPickerRegionReader)
final areaPickerRegionReaderProvider = AreaPickerRegionReaderProvider._();

/// Null in the app, which asks the platform map; tests, which have none,
/// override it.

final class AreaPickerRegionReaderProvider
    extends
        $FunctionalProvider<
          VisibleRegionReader?,
          VisibleRegionReader?,
          VisibleRegionReader?
        >
    with $Provider<VisibleRegionReader?> {
  /// Null in the app, which asks the platform map; tests, which have none,
  /// override it.
  AreaPickerRegionReaderProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'areaPickerRegionReaderProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$areaPickerRegionReaderHash();

  @$internal
  @override
  $ProviderElement<VisibleRegionReader?> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  VisibleRegionReader? create(Ref ref) {
    return areaPickerRegionReader(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(VisibleRegionReader? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<VisibleRegionReader?>(value),
    );
  }
}

String _$areaPickerRegionReaderHash() =>
    r'e5fbf11b8c50b50dba961be14ea13b10783a2c27';

/// The feed chip the user picked: one feed's id, or null for all of them.

@ProviderFor(SelectedFeed)
final selectedFeedProvider = SelectedFeedProvider._();

/// The feed chip the user picked: one feed's id, or null for all of them.
final class SelectedFeedProvider
    extends $NotifierProvider<SelectedFeed, String?> {
  /// The feed chip the user picked: one feed's id, or null for all of them.
  SelectedFeedProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'selectedFeedProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$selectedFeedHash();

  @$internal
  @override
  SelectedFeed create() => SelectedFeed();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(String? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<String?>(value),
    );
  }
}

String _$selectedFeedHash() => r'e395543657c61cdd1de9979ccccfee11e7b0b0bc';

/// The feed chip the user picked: one feed's id, or null for all of them.

abstract class _$SelectedFeed extends $Notifier<String?> {
  String? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<String?, String?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<String?, String?>,
              String?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// What one layer holds now inside one scope. Each layer is its own request,
/// so the layers load in parallel and a slow one delays only its own items.
/// Failures surface as the exception, for [feed] to report per source.

@ProviderFor(mapFeedItems)
final mapFeedItemsProvider = MapFeedItemsFamily._();

/// What one layer holds now inside one scope. Each layer is its own request,
/// so the layers load in parallel and a slow one delays only its own items.
/// Failures surface as the exception, for [feed] to report per source.

final class MapFeedItemsProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<FeedItem>>,
          List<FeedItem>,
          FutureOr<List<FeedItem>>
        >
    with $FutureModifier<List<FeedItem>>, $FutureProvider<List<FeedItem>> {
  /// What one layer holds now inside one scope. Each layer is its own request,
  /// so the layers load in parallel and a slow one delays only its own items.
  /// Failures surface as the exception, for [feed] to report per source.
  MapFeedItemsProvider._({
    required MapFeedItemsFamily super.from,
    required FeedLayerQuery super.argument,
  }) : super(
         retry: _manualRetry,
         name: r'mapFeedItemsProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$mapFeedItemsHash();

  @override
  String toString() {
    return r'mapFeedItemsProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<FeedItem>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<FeedItem>> create(Ref ref) {
    final argument = this.argument as FeedLayerQuery;
    return mapFeedItems(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is MapFeedItemsProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$mapFeedItemsHash() => r'3591dee6d8e108c62d17082a265dbd25192482ef';

/// What one layer holds now inside one scope. Each layer is its own request,
/// so the layers load in parallel and a slow one delays only its own items.
/// Failures surface as the exception, for [feed] to report per source.

final class MapFeedItemsFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<List<FeedItem>>, FeedLayerQuery> {
  MapFeedItemsFamily._()
    : super(
        retry: _manualRetry,
        name: r'mapFeedItemsProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// What one layer holds now inside one scope. Each layer is its own request,
  /// so the layers load in parallel and a slow one delays only its own items.
  /// Failures surface as the exception, for [feed] to report per source.

  MapFeedItemsProvider call(FeedLayerQuery query) =>
      MapFeedItemsProvider._(argument: query, from: this);

  @override
  String toString() => r'mapFeedItemsProvider';
}

/// The published, upcoming community events of one scope. The discover
/// route takes boxes up to 10 km a side, so a wider scope is cut down around
/// its centre; the whole city reads central Melbourne.

@ProviderFor(feedCommunityEvents)
final feedCommunityEventsProvider = FeedCommunityEventsFamily._();

/// The published, upcoming community events of one scope. The discover
/// route takes boxes up to 10 km a side, so a wider scope is cut down around
/// its centre; the whole city reads central Melbourne.

final class FeedCommunityEventsProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<FeedItem>>,
          List<FeedItem>,
          FutureOr<List<FeedItem>>
        >
    with $FutureModifier<List<FeedItem>>, $FutureProvider<List<FeedItem>> {
  /// The published, upcoming community events of one scope. The discover
  /// route takes boxes up to 10 km a side, so a wider scope is cut down around
  /// its centre; the whole city reads central Melbourne.
  FeedCommunityEventsProvider._({
    required FeedCommunityEventsFamily super.from,
    required FeedCommunityQuery super.argument,
  }) : super(
         retry: _manualRetry,
         name: r'feedCommunityEventsProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$feedCommunityEventsHash();

  @override
  String toString() {
    return r'feedCommunityEventsProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $FutureProviderElement<List<FeedItem>> $createElement(
    $ProviderPointer pointer,
  ) => $FutureProviderElement(pointer);

  @override
  FutureOr<List<FeedItem>> create(Ref ref) {
    final argument = this.argument as FeedCommunityQuery;
    return feedCommunityEvents(ref, argument);
  }

  @override
  bool operator ==(Object other) {
    return other is FeedCommunityEventsProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$feedCommunityEventsHash() =>
    r'aa439661dbaceeda377dc5f319c032d13bd7d2a0';

/// The published, upcoming community events of one scope. The discover
/// route takes boxes up to 10 km a side, so a wider scope is cut down around
/// its centre; the whole city reads central Melbourne.

final class FeedCommunityEventsFamily extends $Family
    with
        $FunctionalFamilyOverride<
          FutureOr<List<FeedItem>>,
          FeedCommunityQuery
        > {
  FeedCommunityEventsFamily._()
    : super(
        retry: _manualRetry,
        name: r'feedCommunityEventsProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// The published, upcoming community events of one scope. The discover
  /// route takes boxes up to 10 km a side, so a wider scope is cut down around
  /// its centre; the whole city reads central Melbourne.

  FeedCommunityEventsProvider call(FeedCommunityQuery query) =>
      FeedCommunityEventsProvider._(argument: query, from: this);

  @override
  String toString() => r'feedCommunityEventsProvider';
}

/// The feed: the items of every enabled feed, an item two feeds share shown
/// once, upcoming first. Each source (one topic of one feed) loads on its
/// own: one that fails is reported in [FeedResult.failedSources], one that
/// has not answered yet in [FeedResult.loadingSources], and neither holds up
/// the others.

@ProviderFor(feed)
final feedProvider = FeedProvider._();

/// The feed: the items of every enabled feed, an item two feeds share shown
/// once, upcoming first. Each source (one topic of one feed) loads on its
/// own: one that fails is reported in [FeedResult.failedSources], one that
/// has not answered yet in [FeedResult.loadingSources], and neither holds up
/// the others.

final class FeedProvider
    extends
        $FunctionalProvider<
          AsyncValue<FeedResult>,
          FeedResult,
          FutureOr<FeedResult>
        >
    with $FutureModifier<FeedResult>, $FutureProvider<FeedResult> {
  /// The feed: the items of every enabled feed, an item two feeds share shown
  /// once, upcoming first. Each source (one topic of one feed) loads on its
  /// own: one that fails is reported in [FeedResult.failedSources], one that
  /// has not answered yet in [FeedResult.loadingSources], and neither holds up
  /// the others.
  FeedProvider._()
    : super(
        from: null,
        argument: null,
        retry: _manualRetry,
        name: r'feedProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$feedHash();

  @$internal
  @override
  $FutureProviderElement<FeedResult> $createElement($ProviderPointer pointer) =>
      $FutureProviderElement(pointer);

  @override
  FutureOr<FeedResult> create(Ref ref) {
    return feed(ref);
  }
}

String _$feedHash() => r'94213ed1c4b4f53e288fb8f67d60f59f488a07af';
