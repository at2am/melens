// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'agent_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Anonymous Firebase sign-in on this platform; null when the build has no
/// Firebase configuration for it. Tests override it.

@ProviderFor(anonymousSignIn)
final anonymousSignInProvider = AnonymousSignInProvider._();

/// Anonymous Firebase sign-in on this platform; null when the build has no
/// Firebase configuration for it. Tests override it.

final class AnonymousSignInProvider
    extends
        $FunctionalProvider<
          AnonymousSignIn?,
          AnonymousSignIn?,
          AnonymousSignIn?
        >
    with $Provider<AnonymousSignIn?> {
  /// Anonymous Firebase sign-in on this platform; null when the build has no
  /// Firebase configuration for it. Tests override it.
  AnonymousSignInProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'anonymousSignInProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$anonymousSignInHash();

  @$internal
  @override
  $ProviderElement<AnonymousSignIn?> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  AnonymousSignIn? create(Ref ref) {
    return anonymousSignIn(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(AnonymousSignIn? value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<AnonymousSignIn?>(value),
    );
  }
}

String _$anonymousSignInHash() => r'9c89d182ebdb9eb8d4b6f2f0d0747a7878c7bd52';

/// Where the agent's bearer token comes from.
///
/// A development token goes first: a local agent in development mode accepts
/// nothing else. Otherwise the token is the ID token of the anonymous
/// Firebase user. A build with neither makes every agent call fail with
/// [AgentSignInException], which the chat panel explains.

@ProviderFor(agentTokenSource)
final agentTokenSourceProvider = AgentTokenSourceProvider._();

/// Where the agent's bearer token comes from.
///
/// A development token goes first: a local agent in development mode accepts
/// nothing else. Otherwise the token is the ID token of the anonymous
/// Firebase user. A build with neither makes every agent call fail with
/// [AgentSignInException], which the chat panel explains.

final class AgentTokenSourceProvider
    extends
        $FunctionalProvider<
          AgentTokenSource,
          AgentTokenSource,
          AgentTokenSource
        >
    with $Provider<AgentTokenSource> {
  /// Where the agent's bearer token comes from.
  ///
  /// A development token goes first: a local agent in development mode accepts
  /// nothing else. Otherwise the token is the ID token of the anonymous
  /// Firebase user. A build with neither makes every agent call fail with
  /// [AgentSignInException], which the chat panel explains.
  AgentTokenSourceProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'agentTokenSourceProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$agentTokenSourceHash();

  @$internal
  @override
  $ProviderElement<AgentTokenSource> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  AgentTokenSource create(Ref ref) {
    return agentTokenSource(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(AgentTokenSource value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<AgentTokenSource>(value),
    );
  }
}

String _$agentTokenSourceHash() => r'11d07936b4a2ebd5d51d331d5a30e083a8b43ac2';

/// Tests override this with a scripted [AgentClient].

@ProviderFor(agentClient)
final agentClientProvider = AgentClientProvider._();

/// Tests override this with a scripted [AgentClient].

final class AgentClientProvider
    extends $FunctionalProvider<AgentClient, AgentClient, AgentClient>
    with $Provider<AgentClient> {
  /// Tests override this with a scripted [AgentClient].
  AgentClientProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'agentClientProvider',
        isAutoDispose: false,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$agentClientHash();

  @$internal
  @override
  $ProviderElement<AgentClient> $createElement($ProviderPointer pointer) =>
      $ProviderElement(pointer);

  @override
  AgentClient create(Ref ref) {
    return agentClient(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(AgentClient value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<AgentClient>(value),
    );
  }
}

String _$agentClientHash() => r'1b31c8890934e51104b35b2ffb0b7b1ae4af5506';
