// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'request_context.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Tests override this to send a fixed context.

@ProviderFor(requestContextBuilder)
final requestContextBuilderProvider = RequestContextBuilderProvider._();

/// Tests override this to send a fixed context.

final class RequestContextBuilderProvider
    extends
        $FunctionalProvider<
          RequestContextBuilder,
          RequestContextBuilder,
          RequestContextBuilder
        >
    with $Provider<RequestContextBuilder> {
  /// Tests override this to send a fixed context.
  RequestContextBuilderProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'requestContextBuilderProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$requestContextBuilderHash();

  @$internal
  @override
  $ProviderElement<RequestContextBuilder> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  RequestContextBuilder create(Ref ref) {
    return requestContextBuilder(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(RequestContextBuilder value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<RequestContextBuilder>(value),
    );
  }
}

String _$requestContextBuilderHash() =>
    r'b0fa9c64b6a8eaa2f02689e4d33d8ac4514bf2b7';
