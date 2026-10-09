import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/network/http_client.dart';
import '../data/agent_client.dart';

part 'agent_providers.g.dart';

/// Where the agent's bearer token comes from.
///
/// Until Firebase Anonymous Auth is set up (app README, Not set up yet), a
/// development build sends the fixed token the agent service accepts in
/// development mode. A build without one makes every agent call fail with
/// [AgentSignInException], which the chat panel explains.
@Riverpod(keepAlive: true)
AgentTokenSource agentTokenSource(Ref ref) {
  final token = ref.watch(envProvider).agentDevToken;
  return () async => token.isEmpty ? null : token;
}

/// Tests override this with a scripted [AgentClient].
@Riverpod(keepAlive: true)
AgentClient agentClient(Ref ref) => HttpAgentClient(
  client: ref.watch(httpClientProvider),
  baseUrl: ref.watch(envProvider).agentBaseUrl,
  tokenSource: ref.watch(agentTokenSourceProvider),
);
