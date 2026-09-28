// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'env.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The build's [Env]. Tests override it with `envProvider.overrideWithValue`.

@ProviderFor(env)
final envProvider = EnvProvider._();

/// The build's [Env]. Tests override it with `envProvider.overrideWithValue`.

final class EnvProvider extends $FunctionalProvider<Env, Env, Env>
    with $Provider<Env> {
  /// The build's [Env]. Tests override it with `envProvider.overrideWithValue`.
  EnvProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'envProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$envHash();

  @$internal
  @override
  $ProviderElement<Env> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  Env create(Ref ref) {
    return env(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(Env value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<Env>(value),
    );
  }
}

String _$envHash() => r'e502020e8a77022db3377b69959d5917a706dac9';
