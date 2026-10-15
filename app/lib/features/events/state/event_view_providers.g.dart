// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'event_view_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Whether user events are drawn on the map. They are not a layer of the map
/// contract (v1 registers nine layers), so the app keeps this switch itself
/// and the map shows it beside the contract layers.

@ProviderFor(CommunityLayerEnabled)
final communityLayerEnabledProvider = CommunityLayerEnabledProvider._();

/// Whether user events are drawn on the map. They are not a layer of the map
/// contract (v1 registers nine layers), so the app keeps this switch itself
/// and the map shows it beside the contract layers.
final class CommunityLayerEnabledProvider
    extends $NotifierProvider<CommunityLayerEnabled, bool> {
  /// Whether user events are drawn on the map. They are not a layer of the map
  /// contract (v1 registers nine layers), so the app keeps this switch itself
  /// and the map shows it beside the contract layers.
  CommunityLayerEnabledProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'communityLayerEnabledProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$communityLayerEnabledHash();

  @$internal
  @override
  CommunityLayerEnabled create() => CommunityLayerEnabled();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(bool value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<bool>(value),
    );
  }
}

String _$communityLayerEnabledHash() =>
    r'f8861719597da9d02768d706ef13de51063988c4';

/// Whether user events are drawn on the map. They are not a layer of the map
/// contract (v1 registers nine layers), so the app keeps this switch itself
/// and the map shows it beside the contract layers.

abstract class _$CommunityLayerEnabled extends $Notifier<bool> {
  bool build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<bool, bool>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<bool, bool>,
              bool,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

@ProviderFor(EventsPanelRequests)
final eventsPanelRequestsProvider = EventsPanelRequestsProvider._();

final class EventsPanelRequestsProvider
    extends $NotifierProvider<EventsPanelRequests, EventsPanelRequest?> {
  EventsPanelRequestsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'eventsPanelRequestsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$eventsPanelRequestsHash();

  @$internal
  @override
  EventsPanelRequests create() => EventsPanelRequests();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(EventsPanelRequest? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<EventsPanelRequest?>(value),
    );
  }
}

String _$eventsPanelRequestsHash() =>
    r'78e0fae5a52fd2ccc3c7d78a16d07ab36bb48db3';

abstract class _$EventsPanelRequests extends $Notifier<EventsPanelRequest?> {
  EventsPanelRequest? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<EventsPanelRequest?, EventsPanelRequest?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<EventsPanelRequest?, EventsPanelRequest?>,
              EventsPanelRequest?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// The origin that invite links point to: the Web app's own origin. Native
/// builds have no public origin yet, so they invite with text only.

@ProviderFor(inviteOrigin)
final inviteOriginProvider = InviteOriginProvider._();

/// The origin that invite links point to: the Web app's own origin. Native
/// builds have no public origin yet, so they invite with text only.

final class InviteOriginProvider extends $FunctionalProvider<Uri?, Uri?, Uri?>
    with $Provider<Uri?> {
  /// The origin that invite links point to: the Web app's own origin. Native
  /// builds have no public origin yet, so they invite with text only.
  InviteOriginProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'inviteOriginProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$inviteOriginHash();

  @$internal
  @override
  $ProviderElement<Uri?> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  Uri? create(Ref ref) {
    return inviteOrigin(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(Uri? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<Uri?>(value),
    );
  }
}

String _$inviteOriginHash() => r'c54b234576ed9cb73832418cdd885f2501bb2c01';
