// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'user_events_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Tests override this with a scripted [UserEventsClient].

@ProviderFor(userEventsClient)
final userEventsClientProvider = UserEventsClientProvider._();

/// Tests override this with a scripted [UserEventsClient].

final class UserEventsClientProvider
    extends
        $FunctionalProvider<
          UserEventsClient,
          UserEventsClient,
          UserEventsClient
        >
    with $Provider<UserEventsClient> {
  /// Tests override this with a scripted [UserEventsClient].
  UserEventsClientProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userEventsClientProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userEventsClientHash();

  @$internal
  @override
  $ProviderElement<UserEventsClient> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  UserEventsClient create(Ref ref) {
    return userEventsClient(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserEventsClient value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserEventsClient>(value),
    );
  }
}

String _$userEventsClientHash() => r'5bb75c9f0dbfb23ec472ed0bb689b75bd9275bde';

/// The box the nearby list searches: the map's bounded viewport, shrunk to
/// the discover route's limit around its centre. Null until the map has a
/// viewport. Tests override it.

@ProviderFor(userEventSearchBounds)
final userEventSearchBoundsProvider = UserEventSearchBoundsProvider._();

/// The box the nearby list searches: the map's bounded viewport, shrunk to
/// the discover route's limit around its centre. Null until the map has a
/// viewport. Tests override it.

final class UserEventSearchBoundsProvider
    extends $FunctionalProvider<MapBounds?, MapBounds?, MapBounds?>
    with $Provider<MapBounds?> {
  /// The box the nearby list searches: the map's bounded viewport, shrunk to
  /// the discover route's limit around its centre. Null until the map has a
  /// viewport. Tests override it.
  UserEventSearchBoundsProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userEventSearchBoundsProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userEventSearchBoundsHash();

  @$internal
  @override
  $ProviderElement<MapBounds?> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  MapBounds? create(Ref ref) {
    return userEventSearchBounds(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(MapBounds? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<MapBounds?>(value),
    );
  }
}

String _$userEventSearchBoundsHash() =>
    r'ae51cb6c45f170fd620d9f7abc02d2d55cb1b011';

/// The user events near the map's viewport. It loads while the events panel
/// is open, following the viewport with a debounce, and keeps the last list
/// when the panel closes so the markers stay.

@ProviderFor(NearbyUserEventsController)
final nearbyUserEventsControllerProvider =
    NearbyUserEventsControllerProvider._();

/// The user events near the map's viewport. It loads while the events panel
/// is open, following the viewport with a debounce, and keeps the last list
/// when the panel closes so the markers stay.
final class NearbyUserEventsControllerProvider
    extends
        $NotifierProvider<NearbyUserEventsController, NearbyUserEventsState> {
  /// The user events near the map's viewport. It loads while the events panel
  /// is open, following the viewport with a debounce, and keeps the last list
  /// when the panel closes so the markers stay.
  NearbyUserEventsControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'nearbyUserEventsControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$nearbyUserEventsControllerHash();

  @$internal
  @override
  NearbyUserEventsController create() => NearbyUserEventsController();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(NearbyUserEventsState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<NearbyUserEventsState>(value),
    );
  }
}

String _$nearbyUserEventsControllerHash() =>
    r'7bf61188ba27d04b693f69909000ac55ba38594f';

/// The user events near the map's viewport. It loads while the events panel
/// is open, following the viewport with a debounce, and keeps the last list
/// when the panel closes so the markers stay.

abstract class _$NearbyUserEventsController
    extends $Notifier<NearbyUserEventsState> {
  NearbyUserEventsState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<NearbyUserEventsState, NearbyUserEventsState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<NearbyUserEventsState, NearbyUserEventsState>,
              NearbyUserEventsState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// The caller's own and joined events.

@ProviderFor(MyUserEventsController)
final myUserEventsControllerProvider = MyUserEventsControllerProvider._();

/// The caller's own and joined events.
final class MyUserEventsControllerProvider
    extends $AsyncNotifierProvider<MyUserEventsController, MyUserEvents> {
  /// The caller's own and joined events.
  MyUserEventsControllerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'myUserEventsControllerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$myUserEventsControllerHash();

  @$internal
  @override
  MyUserEventsController create() => MyUserEventsController();
}

String _$myUserEventsControllerHash() =>
    r'e56d0cd43041426969af2b591e8f2fb0ee543b0a';

/// The caller's own and joined events.

abstract class _$MyUserEventsController extends $AsyncNotifier<MyUserEvents> {
  FutureOr<MyUserEvents> build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<MyUserEvents>, MyUserEvents>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<MyUserEvents>, MyUserEvents>,
              AsyncValue<MyUserEvents>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

/// One event's details and the actions on it. Every successful action
/// updates this state and the lists, so the panel never shows a stale copy.

@ProviderFor(UserEventDetailController)
final userEventDetailControllerProvider = UserEventDetailControllerFamily._();

/// One event's details and the actions on it. Every successful action
/// updates this state and the lists, so the panel never shows a stale copy.
final class UserEventDetailControllerProvider
    extends $AsyncNotifierProvider<UserEventDetailController, UserEvent> {
  /// One event's details and the actions on it. Every successful action
  /// updates this state and the lists, so the panel never shows a stale copy.
  UserEventDetailControllerProvider._({
    required UserEventDetailControllerFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'userEventDetailControllerProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$userEventDetailControllerHash();

  @override
  String toString() {
    return r'userEventDetailControllerProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  UserEventDetailController create() => UserEventDetailController();

  @override
  bool operator ==(Object other) {
    return other is UserEventDetailControllerProvider &&
        other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$userEventDetailControllerHash() =>
    r'e9118d8b6adbff5d18b467b29687daa38434865a';

/// One event's details and the actions on it. Every successful action
/// updates this state and the lists, so the panel never shows a stale copy.

final class UserEventDetailControllerFamily extends $Family
    with
        $ClassFamilyOverride<
          UserEventDetailController,
          AsyncValue<UserEvent>,
          UserEvent,
          FutureOr<UserEvent>,
          String
        > {
  UserEventDetailControllerFamily._()
    : super(
        retry: null,
        name: r'userEventDetailControllerProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// One event's details and the actions on it. Every successful action
  /// updates this state and the lists, so the panel never shows a stale copy.

  UserEventDetailControllerProvider call(String eventId) =>
      UserEventDetailControllerProvider._(argument: eventId, from: this);

  @override
  String toString() => r'userEventDetailControllerProvider';
}

/// One event's details and the actions on it. Every successful action
/// updates this state and the lists, so the panel never shows a stale copy.

abstract class _$UserEventDetailController extends $AsyncNotifier<UserEvent> {
  late final _$args = ref.$arg as String;
  String get eventId => _$args;

  FutureOr<UserEvent> build(String eventId);
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<AsyncValue<UserEvent>, UserEvent>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<UserEvent>, UserEvent>,
              AsyncValue<UserEvent>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, () => build(_$args));
  }
}

/// The members of one event, for its owner. Null `members` means the event
/// is anonymous and only the count is known.

@ProviderFor(UserEventMembersController)
final userEventMembersControllerProvider = UserEventMembersControllerFamily._();

/// The members of one event, for its owner. Null `members` means the event
/// is anonymous and only the count is known.
final class UserEventMembersControllerProvider
    extends
        $AsyncNotifierProvider<UserEventMembersController, UserEventMembers> {
  /// The members of one event, for its owner. Null `members` means the event
  /// is anonymous and only the count is known.
  UserEventMembersControllerProvider._({
    required UserEventMembersControllerFamily super.from,
    required String super.argument,
  }) : super(
         retry: null,
         name: r'userEventMembersControllerProvider',
         isAutoDispose: true,
         dependencies: null,
         $allTransitiveDependencies: null,
       );

  @override
  String debugGetCreateSourceHash() => _$userEventMembersControllerHash();

  @override
  String toString() {
    return r'userEventMembersControllerProvider'
        ''
        '($argument)';
  }

  @$internal
  @override
  UserEventMembersController create() => UserEventMembersController();

  @override
  bool operator ==(Object other) {
    return other is UserEventMembersControllerProvider &&
        other.argument == argument;
  }

  @override
  int get hashCode {
    return argument.hashCode;
  }
}

String _$userEventMembersControllerHash() =>
    r'aded0c8c70e7b0f79e4db6aeadc8274bf971e204';

/// The members of one event, for its owner. Null `members` means the event
/// is anonymous and only the count is known.

final class UserEventMembersControllerFamily extends $Family
    with
        $ClassFamilyOverride<
          UserEventMembersController,
          AsyncValue<UserEventMembers>,
          UserEventMembers,
          FutureOr<UserEventMembers>,
          String
        > {
  UserEventMembersControllerFamily._()
    : super(
        retry: null,
        name: r'userEventMembersControllerProvider',
        dependencies: null,
        $allTransitiveDependencies: null,
        isAutoDispose: true,
      );

  /// The members of one event, for its owner. Null `members` means the event
  /// is anonymous and only the count is known.

  UserEventMembersControllerProvider call(String eventId) =>
      UserEventMembersControllerProvider._(argument: eventId, from: this);

  @override
  String toString() => r'userEventMembersControllerProvider';
}

/// The members of one event, for its owner. Null `members` means the event
/// is anonymous and only the count is known.

abstract class _$UserEventMembersController
    extends $AsyncNotifier<UserEventMembers> {
  late final _$args = ref.$arg as String;
  String get eventId => _$args;

  FutureOr<UserEventMembers> build(String eventId);
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref =
        this.ref as $Ref<AsyncValue<UserEventMembers>, UserEventMembers>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<AsyncValue<UserEventMembers>, UserEventMembers>,
              AsyncValue<UserEventMembers>,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, () => build(_$args));
  }
}

/// The name the user last joined with, kept for the session so the next
/// join offers it again.

@ProviderFor(UserEventDisplayName)
final userEventDisplayNameProvider = UserEventDisplayNameProvider._();

/// The name the user last joined with, kept for the session so the next
/// join offers it again.
final class UserEventDisplayNameProvider
    extends $NotifierProvider<UserEventDisplayName, String?> {
  /// The name the user last joined with, kept for the session so the next
  /// join offers it again.
  UserEventDisplayNameProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userEventDisplayNameProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userEventDisplayNameHash();

  @$internal
  @override
  UserEventDisplayName create() => UserEventDisplayName();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(String? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<String?>(value),
    );
  }
}

String _$userEventDisplayNameHash() =>
    r'9a1bb07d2b183f36213004c73ea61ee48c5a970e';

/// The name the user last joined with, kept for the session so the next
/// join offers it again.

abstract class _$UserEventDisplayName extends $Notifier<String?> {
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

/// The event the panel should show, set when a marker on the map is tapped;
/// null once the panel took it.

@ProviderFor(OpenUserEvent)
final openUserEventProvider = OpenUserEventProvider._();

/// The event the panel should show, set when a marker on the map is tapped;
/// null once the panel took it.
final class OpenUserEventProvider
    extends $NotifierProvider<OpenUserEvent, String?> {
  /// The event the panel should show, set when a marker on the map is tapped;
  /// null once the panel took it.
  OpenUserEventProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'openUserEventProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$openUserEventHash();

  @$internal
  @override
  OpenUserEvent create() => OpenUserEvent();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(String? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<String?>(value),
    );
  }
}

String _$openUserEventHash() => r'38b650a707a62fda2915f6dbff4f06cccce8be7c';

/// The event the panel should show, set when a marker on the map is tapped;
/// null once the panel took it.

abstract class _$OpenUserEvent extends $Notifier<String?> {
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

/// Address and place search for the form: Google Places on the Web when the
/// build has a browser Maps key, unavailable otherwise. Tests override it.

@ProviderFor(placeSearch)
final placeSearchProvider = PlaceSearchProvider._();

/// Address and place search for the form: Google Places on the Web when the
/// build has a browser Maps key, unavailable otherwise. Tests override it.

final class PlaceSearchProvider
    extends $FunctionalProvider<PlaceSearch, PlaceSearch, PlaceSearch>
    with $Provider<PlaceSearch> {
  /// Address and place search for the form: Google Places on the Web when the
  /// build has a browser Maps key, unavailable otherwise. Tests override it.
  PlaceSearchProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'placeSearchProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$placeSearchHash();

  @$internal
  @override
  $ProviderElement<PlaceSearch> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  PlaceSearch create(Ref ref) {
    return placeSearch(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(PlaceSearch value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<PlaceSearch>(value),
    );
  }
}

String _$placeSearchHash() => r'933be723820b22da916e7af49dbf4d11719f9683';

@ProviderFor(UserEventPinPicker)
final userEventPinPickerProvider = UserEventPinPickerProvider._();

final class UserEventPinPickerProvider
    extends $NotifierProvider<UserEventPinPicker, UserEventPinPickerState> {
  UserEventPinPickerProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userEventPinPickerProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userEventPinPickerHash();

  @$internal
  @override
  UserEventPinPicker create() => UserEventPinPicker();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserEventPinPickerState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserEventPinPickerState>(value),
    );
  }
}

String _$userEventPinPickerHash() =>
    r'1f3463f5d9e6c165d42ceed87b5abbf140a481f0';

abstract class _$UserEventPinPicker extends $Notifier<UserEventPinPickerState> {
  UserEventPinPickerState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref =
        this.ref as $Ref<UserEventPinPickerState, UserEventPinPickerState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<UserEventPinPickerState, UserEventPinPickerState>,
              UserEventPinPickerState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}

@ProviderFor(UserEventFormDraft)
final userEventFormDraftProvider = UserEventFormDraftProvider._();

final class UserEventFormDraftProvider
    extends $NotifierProvider<UserEventFormDraft, UserEventFormSnapshot?> {
  UserEventFormDraftProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userEventFormDraftProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userEventFormDraftHash();

  @$internal
  @override
  UserEventFormDraft create() => UserEventFormDraft();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserEventFormSnapshot? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserEventFormSnapshot?>(value),
    );
  }
}

String _$userEventFormDraftHash() =>
    r'be2f4f03f3aa64437ba8216e2b2c09aee2e137b3';

abstract class _$UserEventFormDraft extends $Notifier<UserEventFormSnapshot?> {
  UserEventFormSnapshot? build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref =
        this.ref as $Ref<UserEventFormSnapshot?, UserEventFormSnapshot?>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<UserEventFormSnapshot?, UserEventFormSnapshot?>,
              UserEventFormSnapshot?,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
