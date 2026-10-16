// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'saved_plan.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SavedPlan _$SavedPlanFromJson(Map<String, dynamic> json) =>
    $checkedCreate('SavedPlan', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['id', 'sessionId', 'turnId', 'savedAt', 'card'],
      );
      final val = SavedPlan(
        id: $checkedConvert('id', (v) => v as String),
        sessionId: $checkedConvert('sessionId', (v) => v as String),
        turnId: $checkedConvert('turnId', (v) => v as String),
        savedAt: $checkedConvert('savedAt', (v) => v as String),
        card: $checkedConvert(
          'card',
          (v) => AgentCard.fromJson(v as Map<String, dynamic>),
        ),
        route: $checkedConvert('route', (v) => v as Map<String, dynamic>?),
      );
      return val;
    });

Map<String, dynamic> _$SavedPlanToJson(SavedPlan instance) => <String, dynamic>{
  'id': instance.id,
  'sessionId': instance.sessionId,
  'turnId': instance.turnId,
  'savedAt': instance.savedAt,
  'card': instance.card.toJson(),
  'route': ?instance.route,
};
