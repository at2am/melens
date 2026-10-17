import 'package:json_annotation/json_annotation.dart';

part 'memory_models.g.dart';

/// What a remembered fact is about (agent-protocol.md, Memory).
enum MemoryKind { travel, interest, routine, preference, other }

/// One lasting thing the user told the assistant about themselves, as the
/// agent service learned it from a chat.
@JsonSerializable(checked: true)
final class MemoryFact {
  const MemoryFact({
    required this.id,
    required this.kind,
    required this.text,
    required this.updatedAt,
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true, unknownEnumValue: MemoryKind.other)
  final MemoryKind kind;

  @JsonKey(required: true)
  final String text;

  /// ISO 8601, as sent.
  @JsonKey(required: true)
  final String updatedAt;

  factory MemoryFact.fromJson(Map<String, dynamic> json) =>
      _$MemoryFactFromJson(json);

  Map<String, dynamic> toJson() => _$MemoryFactToJson(this);
}

/// A layer the user browses often, with its share of what they browse.
/// [layer] is a map layer id or `community`.
@JsonSerializable(checked: true)
final class BrowsedLayer {
  const BrowsedLayer({required this.layer, required this.share});

  @JsonKey(required: true)
  final String layer;

  @JsonKey(required: true)
  final double share;

  factory BrowsedLayer.fromJson(Map<String, dynamic> json) =>
      _$BrowsedLayerFromJson(json);

  Map<String, dynamic> toJson() => _$BrowsedLayerToJson(this);
}

/// What the user browses most, heaviest first; recent browsing counts most.
@JsonSerializable(checked: true, explicitToJson: true)
final class BrowsingSummary {
  const BrowsingSummary({this.layers = const [], this.categories = const []});

  @JsonKey(required: true)
  final List<BrowsedLayer> layers;

  /// Event categories, lower case.
  @JsonKey(required: true)
  final List<String> categories;

  bool get isEmpty => layers.isEmpty && categories.isEmpty;

  factory BrowsingSummary.fromJson(Map<String, dynamic> json) =>
      _$BrowsingSummaryFromJson(json);

  Map<String, dynamic> toJson() => _$BrowsingSummaryToJson(this);
}

/// The assistant's memory of the user: what it learned from the chats and
/// what the user browses. Off, the assistant neither reads nor adds to it.
@JsonSerializable(checked: true, explicitToJson: true)
final class UserMemory {
  const UserMemory({
    required this.enabled,
    this.facts = const [],
    this.browsing = const BrowsingSummary(),
    this.updatedAt,
  });

  @JsonKey(required: true)
  final bool enabled;

  @JsonKey(required: true)
  final List<MemoryFact> facts;

  @JsonKey(required: true)
  final BrowsingSummary browsing;

  /// ISO 8601; null when nothing was ever remembered.
  final String? updatedAt;

  bool get isEmpty => facts.isEmpty && browsing.isEmpty;

  UserMemory copyWith({bool? enabled, List<MemoryFact>? facts}) => UserMemory(
    enabled: enabled ?? this.enabled,
    facts: facts ?? this.facts,
    browsing: browsing,
    updatedAt: updatedAt,
  );

  factory UserMemory.fromJson(Map<String, dynamic> json) =>
      _$UserMemoryFromJson(json);

  Map<String, dynamic> toJson() => _$UserMemoryToJson(this);
}

/// Turned a layer on, or opened a record.
enum BrowsingAction { show, open }

/// One thing the user did on the map. It carries no place, no record id and
/// no time.
@JsonSerializable(includeIfNull: false)
final class BrowsingSignal {
  const BrowsingSignal({
    required this.kind,
    required this.layer,
    this.category,
  });

  final BrowsingAction kind;

  /// A map layer id or `community`.
  final String layer;

  /// The event category of an opened event.
  final String? category;

  factory BrowsingSignal.fromJson(Map<String, dynamic> json) =>
      _$BrowsingSignalFromJson(json);

  Map<String, dynamic> toJson() => _$BrowsingSignalToJson(this);
}
