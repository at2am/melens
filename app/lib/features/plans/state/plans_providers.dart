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

  /// Keeps the plan [card] of [sessionId] and puts it first, or in the
  /// place of the saved plan [replaces], which it removes. Throws the
  /// [AgentClientException] family for the caller to report.
  Future<SavedPlan> save({
    required String sessionId,
    required AgentCard card,
    String? replaces,
  }) async {
    final plan = await ref
        .read(plansClientProvider)
        .save(sessionId: sessionId, cardId: card.id, replaces: replaces);
    if (!ref.mounted) return plan;
    final current = state.value;
    if (current == null) {
      // The list never loaded: load it again rather than show one plan.
      ref.invalidateSelf();
    } else if (current.any((old) => old.id == replaces)) {
      state = AsyncData([
        for (final old in current)
          if (old.id == replaces) plan else if (old.id != plan.id) old,
      ]);
    } else {
      state = AsyncData([
        plan,
        for (final old in current)
          if (old.id != plan.id) old,
      ]);
    }
    return plan;
  }

  /// Keeps the user's own edits of plan [id]: a new [title], or the [stops]
  /// to keep in their new order. Throws the [AgentClientException] family
  /// for the caller to report.
  Future<SavedPlan> edit(String id, {String? title, List<int>? stops}) async {
    final plan = await ref
        .read(plansClientProvider)
        .edit(id, title: title, stops: stops);
    _keep(plan);
    return plan;
  }

  /// Marks the first [count] stops of plan [id] as visited, at once and
  /// then on the service; a failure puts the old progress back and
  /// rethrows the [AgentClientException] family.
  Future<void> setVisited(String id, int count) async {
    final previous = state.value?.where((plan) => plan.id == id).firstOrNull;
    if (previous == null) return;
    _keep(previous.withVisited(count));
    try {
      _keep(await ref.read(plansClientProvider).edit(id, done: count));
    } on Object {
      _keep(previous);
      rethrow;
    }
  }

  /// Reads the live parking around stop [index] of plan [id] again and
  /// keeps the plan the service returns. Throws the [AgentClientException]
  /// family for the caller to report.
  Future<SavedPlan> refreshStop(String id, int index) async {
    final plan = await ref.read(plansClientProvider).refreshStop(id, index);
    _keep(plan);
    return plan;
  }

  /// Puts [plan], as the service returned it, in place of its old copy.
  void _keep(SavedPlan plan) {
    if (!ref.mounted) return;
    final current = state.value;
    if (current != null) {
      state = AsyncData([
        for (final old in current) old.id == plan.id ? plan : old,
      ]);
    }
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
