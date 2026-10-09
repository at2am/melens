// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'agent_providers.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning
/// Where the agent's bearer token comes from.
///
/// Until Firebase Anonymous Auth is set up (app README, Not set up yet), a
/// development build sends the fixed token the agent service accepts in
/// development mode. A build without one makes every agent call fail with
/// [AgentSignInException], which the chat panel explains.

@ProviderFor(agentTokenSource)
final agentTokenSourceProvider = AgentTokenSourceProvider._();

/// Where the agent's bearer token comes from.
///
/// Until Firebase Anonymous Auth is set up (app README, Not set up yet), a
/// development build sends the fixed token the agent service accepts in
/// development mode. A build without one makes every agent call fail with
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
  /// Until Firebase Anonymous Auth is set up (app README, Not set up yet), a
  /// development build sends the fixed token the agent service accepts in
  /// development mode. A build without one makes every agent call fail with
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

String _$agentTokenSourceHash() => r'456226ac3b667928e27a7e7d98375ebb042e242a';

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
