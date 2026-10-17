// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'memory_models.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MemoryFact _$MemoryFactFromJson(Map<String, dynamic> json) => $checkedCreate(
  'MemoryFact',
  json,
  ($checkedConvert) {
    $checkKeys(json, requiredKeys: const ['id', 'kind', 'text', 'updatedAt']);
    final val = MemoryFact(
      id: $checkedConvert('id', (v) => v as String),
      kind: $checkedConvert(
        'kind',
        (v) =>
            $enumDecode(_$MemoryKindEnumMap, v, unknownValue: MemoryKind.other),
      ),
      text: $checkedConvert('text', (v) => v as String),
      updatedAt: $checkedConvert('updatedAt', (v) => v as String),
    );
    return val;
  },
);

Map<String, dynamic> _$MemoryFactToJson(MemoryFact instance) =>
    <String, dynamic>{
      'id': instance.id,
      'kind': _$MemoryKindEnumMap[instance.kind]!,
      'text': instance.text,
      'updatedAt': instance.updatedAt,
    };

const _$MemoryKindEnumMap = {
  MemoryKind.travel: 'travel',
  MemoryKind.interest: 'interest',
  MemoryKind.routine: 'routine',
  MemoryKind.preference: 'preference',
  MemoryKind.other: 'other',
};

BrowsedLayer _$BrowsedLayerFromJson(Map<String, dynamic> json) =>
    $checkedCreate('BrowsedLayer', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['layer', 'share']);
      final val = BrowsedLayer(
        layer: $checkedConvert('layer', (v) => v as String),
        share: $checkedConvert('share', (v) => (v as num).toDouble()),
      );
      return val;
    });

Map<String, dynamic> _$BrowsedLayerToJson(BrowsedLayer instance) =>
    <String, dynamic>{'layer': instance.layer, 'share': instance.share};

BrowsingSummary _$BrowsingSummaryFromJson(Map<String, dynamic> json) =>
    $checkedCreate('BrowsingSummary', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['layers', 'categories']);
      final val = BrowsingSummary(
        layers: $checkedConvert(
          'layers',
          (v) =>
              (v as List<dynamic>?)
                  ?.map((e) => BrowsedLayer.fromJson(e as Map<String, dynamic>))
                  .toList() ??
              const [],
        ),
        categories: $checkedConvert(
          'categories',
          (v) =>
              (v as List<dynamic>?)?.map((e) => e as String).toList() ??
              const [],
        ),
      );
      return val;
    });

Map<String, dynamic> _$BrowsingSummaryToJson(BrowsingSummary instance) =>
    <String, dynamic>{
      'layers': instance.layers.map((e) => e.toJson()).toList(),
      'categories': instance.categories,
    };

UserMemory _$UserMemoryFromJson(Map<String, dynamic> json) =>
    $checkedCreate('UserMemory', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['enabled', 'facts', 'browsing']);
      final val = UserMemory(
        enabled: $checkedConvert('enabled', (v) => v as bool),
        facts: $checkedConvert(
          'facts',
          (v) =>
              (v as List<dynamic>?)
                  ?.map((e) => MemoryFact.fromJson(e as Map<String, dynamic>))
                  .toList() ??
              const [],
        ),
        browsing: $checkedConvert(
          'browsing',
          (v) => v == null
              ? const BrowsingSummary()
              : BrowsingSummary.fromJson(v as Map<String, dynamic>),
        ),
        updatedAt: $checkedConvert('updatedAt', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$UserMemoryToJson(UserMemory instance) =>
    <String, dynamic>{
      'enabled': instance.enabled,
      'facts': instance.facts.map((e) => e.toJson()).toList(),
      'browsing': instance.browsing.toJson(),
      'updatedAt': instance.updatedAt,
    };

BrowsingSignal _$BrowsingSignalFromJson(Map<String, dynamic> json) =>
    $checkedCreate('BrowsingSignal', json, ($checkedConvert) {
      final val = BrowsingSignal(
        kind: $checkedConvert(
          'kind',
          (v) => $enumDecode(_$BrowsingActionEnumMap, v),
        ),
        layer: $checkedConvert('layer', (v) => v as String),
        category: $checkedConvert('category', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$BrowsingSignalToJson(BrowsingSignal instance) =>
    <String, dynamic>{
      'kind': _$BrowsingActionEnumMap[instance.kind]!,
      'layer': instance.layer,
      'category': ?instance.category,
    };

const _$BrowsingActionEnumMap = {
  BrowsingAction.show: 'show',
  BrowsingAction.open: 'open',
};
