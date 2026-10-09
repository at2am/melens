import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/network/http_client.dart';
import '../data/agent_client.dart';
import '../data/agent_sign_in.dart';

part 'agent_providers.g.dart';

/// Anonymous Firebase sign-in on this platform; null when the build has no
/// Firebase configuration for it. Tests override it.
@Riverpod(keepAlive: true)
AnonymousSignIn? anonymousSignIn(Ref ref) {
  final options = firebaseOptionsFor(ref.watch(envProvider));
  return options == null
      ? null
      : AnonymousSignIn(() => firebaseAuthFor(options));
}

/// Where the agent's bearer token comes from.
///
/// A development token goes first: a local agent in development mode accepts
/// nothing else. Otherwise the token is the ID token of the anonymous
/// Firebase user. A build with neither makes every agent call fail with
/// [AgentSignInException], which the chat panel explains.
@Riverpod(keepAlive: true)
AgentTokenSource agentTokenSource(Ref ref) {
  final env = ref.watch(envProvider);
  if (env.hasAgentDevToken) {
    final token = env.agentDevToken;
    return () async => token;
  }
  final signIn = ref.watch(anonymousSignInProvider);
  return signIn == null ? () async => null : anonymousTokenSource(signIn);
}

/// Tests override this with a scripted [AgentClient].
@Riverpod(keepAlive: true)
AgentClient agentClient(Ref ref) => HttpAgentClient(
  client: ref.watch(httpClientProvider),
  baseUrl: ref.watch(envProvider).agentBaseUrl,
  tokenSource: ref.watch(agentTokenSourceProvider),
);
