// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'http_client.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// The one HTTP client the app uses.
///
/// `http.Client()` is an `IOClient` on Android and iOS and a Fetch-based
/// `BrowserClient` on the Web. Both stream response bodies, which the agent's
/// server-sent events need, and both honour `http.AbortableRequest`, which
/// cancels a turn on the server (agent-protocol.md, Rules).
///
/// Tests override this provider with `MockClient` from
/// `package:http/testing.dart`.

@ProviderFor(httpClient)
final httpClientProvider = HttpClientProvider._();

/// The one HTTP client the app uses.
///
/// `http.Client()` is an `IOClient` on Android and iOS and a Fetch-based
/// `BrowserClient` on the Web. Both stream response bodies, which the agent's
/// server-sent events need, and both honour `http.AbortableRequest`, which
/// cancels a turn on the server (agent-protocol.md, Rules).
///
/// Tests override this provider with `MockClient` from
/// `package:http/testing.dart`.

final class HttpClientProvider
    extends $FunctionalProvider<http.Client, http.Client, http.Client>
    with $Provider<http.Client> {
  /// The one HTTP client the app uses.
  ///
  /// `http.Client()` is an `IOClient` on Android and iOS and a Fetch-based
  /// `BrowserClient` on the Web. Both stream response bodies, which the agent's
  /// server-sent events need, and both honour `http.AbortableRequest`, which
  /// cancels a turn on the server (agent-protocol.md, Rules).
  ///
  /// Tests override this provider with `MockClient` from
  /// `package:http/testing.dart`.
  HttpClientProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'httpClientProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$httpClientHash();

  @$internal
  @override
  $ProviderElement<http.Client> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  http.Client create(Ref ref) {
    return httpClient(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(http.Client value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<http.Client>(value),
    );
  }
}

String _$httpClientHash() => r'7ec49beae0f15115de79f9aa98dbd250130e26d8';
