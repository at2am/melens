import 'package:json_annotation/json_annotation.dart';

import '../../agent/data/agent_models.dart';

part 'saved_plan.g.dart';

/// A plan card the user kept (agent-protocol.md, Saved plans): a copy of the
/// card as the agent service stored it, so it outlives the chat session.
/// Its id is the card's id. [route] is the `draw_route` action of the same
/// turn, when the agent drew one; an edit draws it again or drops it.
/// [done] is how many stops, from the first, the user marked as visited.
@JsonSerializable(checked: true, explicitToJson: true)
final class SavedPlan {
  const SavedPlan({
    required this.id,
    required this.sessionId,
    required this.turnId,
    required this.savedAt,
    required this.card,
    this.updatedAt,
    this.route,
    this.done,
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true)
  final String sessionId;

  @JsonKey(required: true)
  final String turnId;

  /// ISO 8601, as sent.
  @JsonKey(required: true)
  final String savedAt;

  /// The last edit or replacement, ISO 8601; null when never changed.
  @JsonKey(includeIfNull: false)
  final String? updatedAt;

  @JsonKey(required: true)
  final AgentCard card;

  @JsonKey(includeIfNull: false)
  final Map<String, dynamic>? route;

  @JsonKey(includeIfNull: false)
  final int? done;

  /// How many stops are visited, within the stops the plan has.
  int get visited => (done ?? 0).clamp(0, card.items.length);

  /// The index of the stop to visit next, or null once all are visited.
  int? get nextStop => visited < card.items.length ? visited : null;

  /// This plan with [count] stops visited, as the service will keep it.
  SavedPlan withVisited(int count) => SavedPlan(
    id: id,
    sessionId: sessionId,
    turnId: turnId,
    savedAt: savedAt,
    updatedAt: updatedAt,
    card: card,
    route: route,
    done: count == 0 ? null : count,
  );

  /// The earliest and latest times its stops give, or null without any.
  (DateTime, DateTime)? get span {
    final times = [
      for (final item in card.items) ...[
        if (item.time?.from case final from?) DateTime.tryParse(from),
        if (item.time?.to case final to?) DateTime.tryParse(to),
      ],
    ].nonNulls.toList()..sort();
    return times.isEmpty ? null : (times.first, times.last);
  }

  /// Every stop with a time is over by [now]; a plan without times never is.
  bool isPastAt(DateTime now) {
    final end = span?.$2;
    return end != null && end.isBefore(now);
  }

  factory SavedPlan.fromJson(Map<String, dynamic> json) =>
      _$SavedPlanFromJson(json);

  Map<String, dynamic> toJson() => _$SavedPlanToJson(this);
}
