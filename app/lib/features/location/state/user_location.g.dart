// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'user_location.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Whether this build can ask the device where it is: only the Web build has
/// a reader ([readDeviceLocation]); the phone builds have no location plugin
/// or permission strings, so their location controls are hidden.

@ProviderFor(deviceLocationSupported)
final deviceLocationSupportedProvider = DeviceLocationSupportedProvider._();

/// Whether this build can ask the device where it is: only the Web build has
/// a reader ([readDeviceLocation]); the phone builds have no location plugin
/// or permission strings, so their location controls are hidden.

final class DeviceLocationSupportedProvider
    extends $FunctionalProvider<bool, bool, bool>
    with $Provider<bool> {
  /// Whether this build can ask the device where it is: only the Web build has
  /// a reader ([readDeviceLocation]); the phone builds have no location plugin
  /// or permission strings, so their location controls are hidden.
  DeviceLocationSupportedProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'deviceLocationSupportedProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$deviceLocationSupportedHash();

  @$internal
  @override
  $ProviderElement<bool> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  bool create(Ref ref) {
    return deviceLocationSupported(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(bool value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<bool>(value),
    );
  }
}

String _$deviceLocationSupportedHash() =>
    r'5d0748b33ab981a6cc2612d42974217c45300d55';

/// Tests override this with a fake reader.

@ProviderFor(deviceLocationReader)
final deviceLocationReaderProvider = DeviceLocationReaderProvider._();

/// Tests override this with a fake reader.

final class DeviceLocationReaderProvider
    extends
        $FunctionalProvider<
          DeviceLocationReader,
          DeviceLocationReader,
          DeviceLocationReader
        >
    with $Provider<DeviceLocationReader> {
  /// Tests override this with a fake reader.
  DeviceLocationReaderProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'deviceLocationReaderProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$deviceLocationReaderHash();

  @$internal
  @override
  $ProviderElement<DeviceLocationReader> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  DeviceLocationReader create(Ref ref) {
    return deviceLocationReader(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(DeviceLocationReader value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<DeviceLocationReader>(value),
    );
  }
}

String _$deviceLocationReaderHash() =>
    r'bf808e28db6d5251a6f10a620fd985a739a3cfa6';

/// The user's own position, only after they switch it on. While on, the
/// agent's request context carries it; switching it off drops it.

@ProviderFor(UserLocation)
final userLocationProvider = UserLocationProvider._();

/// The user's own position, only after they switch it on. While on, the
/// agent's request context carries it; switching it off drops it.
final class UserLocationProvider
    extends $NotifierProvider<UserLocation, UserLocationState> {
  /// The user's own position, only after they switch it on. While on, the
  /// agent's request context carries it; switching it off drops it.
  UserLocationProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'userLocationProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$userLocationHash();

  @$internal
  @override
  UserLocation create() => UserLocation();

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(UserLocationState value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<UserLocationState>(value),
    );
  }
}

String _$userLocationHash() => r'53b4e450b8fd986eb23a5e82fcdf8f78e7804f0c';

/// The user's own position, only after they switch it on. While on, the
/// agent's request context carries it; switching it off drops it.

abstract class _$UserLocation extends $Notifier<UserLocationState> {
  UserLocationState build();
  @$mustCallSuper
  @override
  WhenComplete runBuild() {
    final ref = this.ref as $Ref<UserLocationState, UserLocationState>;
    final element =
        ref.element
            as $ClassProviderElement<
              AnyNotifier<UserLocationState, UserLocationState>,
              UserLocationState,
              Object?,
              Object?
            >;
    return element.handleCreate(ref, build);
  }
}
