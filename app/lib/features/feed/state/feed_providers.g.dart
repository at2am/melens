// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'feed_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The topics the user follows. Kept for the app run; persisting them needs
/// the account work in UC-09.

@ProviderFor(FeedSubscriptions)
final feedSubscriptionsProvider = FeedSubscriptionsProvider._();

/// The topics the user follows. Kept for the app run; persisting them needs
/// the account work in UC-09.
final class FeedSubscriptionsProvider
    extends $NotifierProvider<FeedSubscriptions, Set<FeedTopic>> {
  /// The topics the user follows. Kept for the app run; persisting them needs
  /// the account work in UC-09.
  FeedSubscriptionsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
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

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(Set<FeedTopic> value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<Set<FeedTopic>>(value),
    );
  }
}

String _$feedSubscriptionsHash() => r'3e31db6704a736450687c1a149366fe8f6d1a217';

/// The topics the user follows. Kept for the app run; persisting them needs
/// the account work in UC-09.

abstract class _$FeedSubscriptions extends $Notifier<Set<FeedTopic>> {
  Set<FeedTopic> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<Set<FeedTopic>, Set<FeedTopic>>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<Set<FeedTopic>, Set<FeedTopic>>,
              Set<FeedTopic>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// The subscribed map layers as one sorted, comma-separated key. A string
/// compares by value, so the feed's map request is not repeated when the
/// subscriptions change in a way that leaves the layers alone.

@ProviderFor(subscribedLayerKey)
final subscribedLayerKeyProvider = SubscribedLayerKeyProvider._();

/// The subscribed map layers as one sorted, comma-separated key. A string
/// compares by value, so the feed's map request is not repeated when the
/// subscriptions change in a way that leaves the layers alone.

final class SubscribedLayerKeyProvider
    extends $FunctionalProvider<String, String, String>
    with $Provider<String> {
  /// The subscribed map layers as one sorted, comma-separated key. A string
  /// compares by value, so the feed's map request is not repeated when the
  /// subscriptions change in a way that leaves the layers alone.
  SubscribedLayerKeyProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'subscribedLayerKeyProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$subscribedLayerKeyHash();

  @$internal
  @override
  $ProviderElement<String> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  String create(Ref ref) {
    return subscribedLayerKey(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(String value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<String>(value),
    );
  }
}

String _$subscribedLayerKeyHash() =>
    r'53578834edf07840a5abad59bbbab5611f07f6d9';

/// What is on now in the given map layers, as one comma-separated key of
/// layer names so that the request is made once per set of layers and not
/// again when community events change. Failures surface as the exception, for
/// [feed] to report per topic.

@ProviderFor(mapFeedItems)
final mapFeedItemsProvider = MapFeedItemsFamily._();

/// What is on now in the given map layers, as one comma-separated key of
/// layer names so that the request is made once per set of layers and not
/// again when community events change. Failures surface as the exception, for
/// [feed] to report per topic.

final class MapFeedItemsProvider
    extends
        $FunctionalProvider<
          AsyncValue<List<FeedItem>>,
          List<FeedItem>,
          FutureOr<List<FeedItem>>
        >
    with $FutureModifier<List<FeedItem>>, $FutureProvider<List<FeedItem>> {
  /// What is on now in the given map layers, as one comma-separated key of
  /// layer names so that the request is made once per set of layers and not
  /// again when community events change. Failures surface as the exception, for
  /// [feed] to report per topic.
  MapFeedItemsProvider._({
    required MapFeedItemsFamily super.from,
    required String super.argument,
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
    final argument = this.argument as String;
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

String _$mapFeedItemsHash() => r'f3019c434ca6a03fcf1103143648190d8c320f9a';

/// What is on now in the given map layers, as one comma-separated key of
/// layer names so that the request is made once per set of layers and not
/// again when community events change. Failures surface as the exception, for
/// [feed] to report per topic.

final class MapFeedItemsFamily extends $Family
    with $FunctionalFamilyOverride<FutureOr<List<FeedItem>>, String> {
  MapFeedItemsFamily._()
    : super(
        retry: _manualRetry,
        name: r'mapFeedItemsProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// What is on now in the given map layers, as one comma-separated key of
  /// layer names so that the request is made once per set of layers and not
  /// again when community events change. Failures surface as the exception, for
  /// [feed] to report per topic.

  MapFeedItemsProvider call(String layerKey) =>
      MapFeedItemsProvider._(argument: layerKey, from: this);

  @override
  String toString() => r'mapFeedItemsProvider';
}

/// The feed: the community events and what is on now in each subscribed map
/// layer, upcoming first. A source that fails is reported in
/// [FeedResult.failedTopics] instead of failing the feed. The map layers are
/// slower than the events, so the feed does not wait for them: it lists them
/// in [FeedResult.loadingTopics] and is rebuilt when they arrive.

@ProviderFor(feed)
final feedProvider = FeedProvider._();

/// The feed: the community events and what is on now in each subscribed map
/// layer, upcoming first. A source that fails is reported in
/// [FeedResult.failedTopics] instead of failing the feed. The map layers are
/// slower than the events, so the feed does not wait for them: it lists them
/// in [FeedResult.loadingTopics] and is rebuilt when they arrive.

final class FeedProvider
    extends
        $FunctionalProvider<
          AsyncValue<FeedResult>,
          FeedResult,
          FutureOr<FeedResult>
        >
    with $FutureModifier<FeedResult>, $FutureProvider<FeedResult> {
  /// The feed: the community events and what is on now in each subscribed map
  /// layer, upcoming first. A source that fails is reported in
  /// [FeedResult.failedTopics] instead of failing the feed. The map layers are
  /// slower than the events, so the feed does not wait for them: it lists them
  /// in [FeedResult.loadingTopics] and is rebuilt when they arrive.
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

String _$feedHash() => r'ed130ab8fa189f9b7f5d36033ec1eaf07bff6e88';
