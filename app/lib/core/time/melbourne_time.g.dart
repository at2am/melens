// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'melbourne_time.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(melbourneClock)
final melbourneClockProvider = MelbourneClockProvider._();

final class MelbourneClockProvider
    extends $FunctionalProvider<MelbourneClock, MelbourneClock, MelbourneClock>
    with $Provider<MelbourneClock> {
  MelbourneClockProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'melbourneClockProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$melbourneClockHash();

  @$internal
  @override
  $ProviderElement<MelbourneClock> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  MelbourneClock create(Ref ref) {
    return melbourneClock(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(MelbourneClock value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<MelbourneClock>(value),
    );
  }
}

String _$melbourneClockHash() => r'e02d9c5ffa8bfb7e194640b0a504d64a302ff5db';
