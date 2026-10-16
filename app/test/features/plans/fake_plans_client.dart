import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/plans/data/plans_client.dart';
import 'package:melens/features/plans/data/saved_plan.dart';

/// The agent service's plan store for one user. [cards] are the plan cards
/// the user's sessions hold, by card id: a save copies one, as the service
/// copies it from the stored turn. [failure] makes the next calls throw.
final class FakePlansClient implements PlansClient {
  FakePlansClient({List<SavedPlan>? stored, Map<String, AgentCard>? cards})
    : stored = stored ?? [],
      cards = cards ?? {};

  final List<SavedPlan> stored;
  final Map<String, AgentCard> cards;
  Object? failure;
  final calls = <String>[];

  @override
  Future<List<SavedPlan>> list() async {
    calls.add('list');
    if (failure case final error?) throw error;
    return List.of(stored);
  }

  @override
  Future<SavedPlan> save({
    required String sessionId,
    required String cardId,
  }) async {
    calls.add('save:$sessionId/$cardId');
    if (failure case final error?) throw error;
    final existing = stored.where((plan) => plan.id == cardId).firstOrNull;
    if (existing != null) return existing;
    final plan = SavedPlan(
      id: cardId,
      sessionId: sessionId,
      turnId: 't_saved',
      savedAt: '2026-10-10T07:45:00.000Z',
      card: cards[cardId]!,
    );
    stored.insert(0, plan);
    return plan;
  }

  @override
  Future<void> remove(String id) async {
    calls.add('remove:$id');
    if (failure case final error?) throw error;
    stored.removeWhere((plan) => plan.id == id);
  }
}
