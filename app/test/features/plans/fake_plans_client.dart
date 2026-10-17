import 'package:melens/features/agent/data/agent_models.dart';
import 'package:melens/features/plans/data/plans_client.dart';
import 'package:melens/features/plans/data/saved_plan.dart';

/// The agent service's plan store for one user. [cards] are the plan cards
/// the user's sessions hold, by card id: a save copies one, as the service
/// copies it from the stored turn. [failure] makes the next calls throw.
/// A stop refresh puts [parking] on the stop, as the service reads it. An
/// edit keeps the named stops in their order and drops the route and the
/// progress, unless it gives the progress.
final class FakePlansClient implements PlansClient {
  FakePlansClient({List<SavedPlan>? stored, Map<String, AgentCard>? cards})
    : stored = stored ?? [],
      cards = cards ?? {};

  final List<SavedPlan> stored;
  final Map<String, AgentCard> cards;
  Object? failure;
  StopParking? parking;
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
    String? replaces,
  }) async {
    calls.add(
      'save:$sessionId/$cardId${replaces == null ? '' : ' replacing $replaces'}',
    );
    if (failure case final error?) throw error;
    final existing = stored.where((plan) => plan.id == cardId).firstOrNull;
    if (existing != null) return existing;
    final replaced = stored.indexWhere((plan) => plan.id == replaces);
    final plan = SavedPlan(
      id: cardId,
      sessionId: sessionId,
      turnId: 't_saved',
      savedAt: replaced < 0
          ? '2026-10-10T07:45:00.000Z'
          : stored[replaced].savedAt,
      updatedAt: replaced < 0 ? null : '2026-10-10T07:50:00.000Z',
      card: cards[cardId]!,
    );
    if (replaced < 0) {
      stored.insert(0, plan);
    } else {
      stored[replaced] = plan;
    }
    return plan;
  }

  @override
  Future<SavedPlan> edit(
    String id, {
    String? title,
    List<int>? stops,
    int? done,
  }) async {
    calls.add(
      'edit:$id ${title ?? '-'} ${stops ?? '-'}${done == null ? '' : ' done $done'}',
    );
    if (failure case final error?) throw error;
    final position = stored.indexWhere((plan) => plan.id == id);
    final plan = stored[position];
    final items = plan.card.items;
    final edited = SavedPlan(
      id: plan.id,
      sessionId: plan.sessionId,
      turnId: plan.turnId,
      savedAt: plan.savedAt,
      updatedAt: '2026-10-10T07:55:00.000Z',
      card: AgentCard(
        id: plan.card.id,
        type: plan.card.type,
        title: title ?? plan.card.title,
        travelMode: plan.card.travelMode,
        items: stops == null
            ? items
            : [for (final index in stops) items[index]],
      ),
      route: stops == null ? plan.route : null,
      done: done ?? (stops == null ? plan.done : null),
    );
    stored[position] = edited;
    return edited;
  }

  @override
  Future<void> remove(String id) async {
    calls.add('remove:$id');
    if (failure case final error?) throw error;
    stored.removeWhere((plan) => plan.id == id);
  }

  @override
  Future<SavedPlan> refreshStop(String id, int index) async {
    calls.add('refresh:$id/$index');
    if (failure case final error?) throw error;
    final position = stored.indexWhere((plan) => plan.id == id);
    final plan = stored[position];
    final card = AgentCard.fromJson({
      ...plan.card.toJson(),
      'items': [
        for (final (stop, item) in plan.card.items.indexed)
          stop == index
              ? {...item.toJson(), 'stop_parking': parking!.toJson()}
              : item.toJson(),
      ],
    });
    final refreshed = SavedPlan.fromJson({
      ...plan.toJson(),
      'card': card.toJson(),
    });
    stored[position] = refreshed;
    return refreshed;
  }
}
