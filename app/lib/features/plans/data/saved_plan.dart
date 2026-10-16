import 'package:json_annotation/json_annotation.dart';

import '../../agent/data/agent_models.dart';

part 'saved_plan.g.dart';

/// A plan card the user kept (agent-protocol.md, Saved plans): a copy of the
/// card as the agent service stored it, so it outlives the chat session.
/// Its id is the card's id. [route] is the `draw_route` action of the same
/// turn, when the agent drew one.
@JsonSerializable(checked: true, explicitToJson: true)
final class SavedPlan {
  const SavedPlan({
    required this.id,
    required this.sessionId,
    required this.turnId,
    required this.savedAt,
    required this.card,
    this.route,
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

  @JsonKey(required: true)
  final AgentCard card;

  @JsonKey(includeIfNull: false)
  final Map<String, dynamic>? route;

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
