import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/env.dart';
import '../../../core/network/http_client.dart';
import '../../agent/data/agent_client.dart';
import '../../agent/data/agent_models.dart';
import '../../agent/state/agent_providers.dart';
import '../data/plans_client.dart';
import '../data/saved_plan.dart';

part 'plans_providers.g.dart';

// A pull to refresh reissues the request; failures never loop.
Duration? _manualRetry(int retryCount, Object error) => null;

/// Tests override this with a scripted [PlansClient].
@Riverpod(keepAlive: true)
PlansClient plansClient(Ref ref) => HttpPlansClient(
  client: ref.watch(httpClientProvider),
  baseUrl: ref.watch(envProvider).agentBaseUrl,
  tokenSource: ref.watch(agentTokenSourceProvider),
);

/// The plans the user saved from the chat, newest first, as the agent
/// service stores them. They show on the Home tab until the user removes
/// them.
@Riverpod(keepAlive: true, retry: _manualRetry)
class SavedPlans extends _$SavedPlans {
  @override
  Future<List<SavedPlan>> build() => ref.watch(plansClientProvider).list();

  /// Keeps the plan [card] of [sessionId] and puts it first. Throws the
  /// [AgentClientException] family for the caller to report.
  Future<SavedPlan> save({
    required String sessionId,
    required AgentCard card,
  }) async {
    final plan = await ref
        .read(plansClientProvider)
        .save(sessionId: sessionId, cardId: card.id);
    if (!ref.mounted) return plan;
    final current = state.value;
    if (current == null) {
      // The list never loaded: load it again rather than show one plan.
      ref.invalidateSelf();
    } else {
      state = AsyncData([
        plan,
        for (final old in current)
          if (old.id != plan.id) old,
      ]);
    }
    return plan;
  }

  /// Removes the plan at once and then on the service; a failure puts it
  /// back and rethrows. A plan the service no longer has stays removed.
  Future<void> remove(String id) async {
    final previous = state.value;
    if (previous == null) return;
    state = AsyncData([
      for (final plan in previous)
        if (plan.id != id) plan,
    ]);
    try {
      await ref.read(plansClientProvider).remove(id);
    } on AgentHttpException catch (error) {
      if (error.code == AgentErrorCode.notFound) return;
      if (ref.mounted) state = AsyncData(previous);
      rethrow;
    } on Object {
      if (ref.mounted) state = AsyncData(previous);
      rethrow;
    }
  }
}
