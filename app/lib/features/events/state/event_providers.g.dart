// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'event_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The person using this device. Until accounts exist (UC-09 open question)
/// it is a local profile whose name the user edits in Settings; the id
/// becomes the Firebase uid once publishing goes through the agent service.

@ProviderFor(CurrentProfile)
final currentProfileProvider = CurrentProfileProvider._();

/// The person using this device. Until accounts exist (UC-09 open question)
/// it is a local profile whose name the user edits in Settings; the id
/// becomes the Firebase uid once publishing goes through the agent service.
final class CurrentProfileProvider
    extends $NotifierProvider<CurrentProfile, UserProfile> {
  /// The person using this device. Until accounts exist (UC-09 open question)
  /// it is a local profile whose name the user edits in Settings; the id
  /// becomes the Firebase uid once publishing goes through the agent service.
  CurrentProfileProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'currentProfileProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$currentProfileHash();

  @$internal
  @override
  CurrentProfile create() => CurrentProfile();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserProfile value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserProfile>(value),
    );
  }
}

String _$currentProfileHash() => r'b750b95e61c37309f749faa529b1db4b977fae79';

/// The person using this device. Until accounts exist (UC-09 open question)
/// it is a local profile whose name the user edits in Settings; the id
/// becomes the Firebase uid once publishing goes through the agent service.

abstract class _$CurrentProfile extends $Notifier<UserProfile> {
  UserProfile build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<UserProfile, UserProfile>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<UserProfile, UserProfile>,
              UserProfile,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

@ProviderFor(userEventRepository)
final userEventRepositoryProvider = UserEventRepositoryProvider._();

final class UserEventRepositoryProvider
    extends
        $FunctionalProvider<
          UserEventRepository,
          UserEventRepository,
          UserEventRepository
        >
    with $Provider<UserEventRepository> {
  UserEventRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userEventRepositoryProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userEventRepositoryHash();

  @$internal
  @override
  $ProviderElement<UserEventRepository> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  UserEventRepository create(Ref ref) {
    return userEventRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserEventRepository value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserEventRepository>(value),
    );
  }
}

String _$userEventRepositoryHash() =>
    r'a24103d0cd56d256dd820d0d9c26a45bfc5d7ff3';

/// Every user event, newest state. Mutations go through the repository and
/// replace the list, so listeners (feed, map, detail) all update.

@ProviderFor(UserEvents)
final userEventsProvider = UserEventsProvider._();

/// Every user event, newest state. Mutations go through the repository and
/// replace the list, so listeners (feed, map, detail) all update.
final class UserEventsProvider
    extends $AsyncNotifierProvider<UserEvents, List<UserEvent>> {
  /// Every user event, newest state. Mutations go through the repository and
  /// replace the list, so listeners (feed, map, detail) all update.
  UserEventsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userEventsProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userEventsHash();

  @$internal
  @override
  UserEvents create() => UserEvents();
}

String _$userEventsHash() => r'15711e2e54bc3bc6bd5f0ec9856a45dd21558af2';

/// Every user event, newest state. Mutations go through the repository and
/// replace the list, so listeners (feed, map, detail) all update.

abstract class _$UserEvents extends $AsyncNotifier<List<UserEvent>> {
  FutureOr<List<UserEvent>> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<List<UserEvent>>, List<UserEvent>>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<List<UserEvent>>, List<UserEvent>>,
              AsyncValue<List<UserEvent>>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// One event by id, or null when it does not exist.

@ProviderFor(userEventById)
final userEventByIdProvider = UserEventByIdFamily._();

/// One event by id, or null when it does not exist.

final class UserEventByIdProvider
    extends $FunctionalProvider<UserEvent?, UserEvent?, UserEvent?>
    with $Provider<UserEvent?> {
  /// One event by id, or null when it does not exist.
  UserEventByIdProvider._({
    required UserEventByIdFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'userEventByIdProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$userEventByIdHash();

  @override
  String toString() {
    return r'userEventByIdProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  $ProviderElement<UserEvent?> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  UserEvent? create(Ref ref) {
    final argument = this.argument as String;
    return userEventById(ref, argument);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserEvent? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserEvent?>(value),
    );
  }

  @override
  bool operator ==(Object other) {
    return other is UserEventByIdProvider && other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$userEventByIdHash() => r'caf8147b5cb27ce638d0365fb4977a78561ec44a';

/// One event by id, or null when it does not exist.

final class UserEventByIdFamily extends $Family
    with $FunctionalFamilyOverride<UserEvent?, String> {
  UserEventByIdFamily._()
    : super(
        retry: null,
        name: r'userEventByIdProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// One event by id, or null when it does not exist.

  UserEventByIdProvider call(String id) =>
      UserEventByIdProvider._(argument: id, from: this);

  @override
  String toString() => r'userEventByIdProvider';
}

/// Events that are on the map and in the feed: public, not cancelled, not
/// finished.

@ProviderFor(publicUpcomingEvents)
final publicUpcomingEventsProvider = PublicUpcomingEventsProvider._();

/// Events that are on the map and in the feed: public, not cancelled, not
/// finished.

final class PublicUpcomingEventsProvider
    extends
        $FunctionalProvider<List<UserEvent>, List<UserEvent>, List<UserEvent>>
    with $Provider<List<UserEvent>> {
  /// Events that are on the map and in the feed: public, not cancelled, not
  /// finished.
  PublicUpcomingEventsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'publicUpcomingEventsProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$publicUpcomingEventsHash();

  @$internal
  @override
  $ProviderElement<List<UserEvent>> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  List<UserEvent> create(Ref ref) {
    return publicUpcomingEvents(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(List<UserEvent> value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<List<UserEvent>>(value),
    );
  }
}

String _$publicUpcomingEventsHash() =>
    r'4051fc38a97744e302aa8f25a48e66acc87a591c';

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

/// Whether community events are drawn on the map. They are not a layer of
/// the map contract (v1 registers nine layers), so the app keeps this switch
/// itself and the map shows it beside the contract layers.

@ProviderFor(CommunityLayerEnabled)
final communityLayerEnabledProvider = CommunityLayerEnabledProvider._();

/// Whether community events are drawn on the map. They are not a layer of
/// the map contract (v1 registers nine layers), so the app keeps this switch
/// itself and the map shows it beside the contract layers.
final class CommunityLayerEnabledProvider
    extends $NotifierProvider<CommunityLayerEnabled, bool> {
  /// Whether community events are drawn on the map. They are not a layer of
  /// the map contract (v1 registers nine layers), so the app keeps this switch
  /// itself and the map shows it beside the contract layers.
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

/// Whether community events are drawn on the map. They are not a layer of
/// the map contract (v1 registers nine layers), so the app keeps this switch
/// itself and the map shows it beside the contract layers.

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
