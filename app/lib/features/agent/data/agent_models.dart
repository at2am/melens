// Freezed forwards the factory annotations to its generated concrete classes.
// ignore_for_file: invalid_annotation_target

import 'package:freezed_annotation/freezed_annotation.dart';

part 'agent_models.freezed.dart';
part 'agent_models.g.dart';

/// Wire models of the agent protocol (system-design/agent-protocol.md).
///
/// The Zod schemas in `cloud/agent/src/protocol/schemas.ts` are the source of
/// truth; these classes mirror them field by field. Requests use camelCase;
/// card item fields keep the snake_case of tools.md (app README, Conventions).
/// Times are ISO 8601 strings with an offset, kept as sent.

@JsonSerializable(checked: true, explicitToJson: true)
final class AgentLatLng {
  const AgentLatLng({required this.lat, required this.lng});

  @JsonKey(required: true)
  final double lat;

  @JsonKey(required: true)
  final double lng;

  factory AgentLatLng.fromJson(Map<String, dynamic> json) =>
      _$AgentLatLngFromJson(json);

  Map<String, dynamic> toJson() => _$AgentLatLngToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class AgentViewport {
  const AgentViewport({
    required this.north,
    required this.south,
    required this.east,
    required this.west,
  });

  @JsonKey(required: true)
  final double north;

  @JsonKey(required: true)
  final double south;

  @JsonKey(required: true)
  final double east;

  @JsonKey(required: true)
  final double west;

  factory AgentViewport.fromJson(Map<String, dynamic> json) =>
      _$AgentViewportFromJson(json);

  Map<String, dynamic> toJson() => _$AgentViewportToJson(this);
}

/// What the user selected on the map. Both keys are always sent; the server's
/// schema requires them and accepts null.
@JsonSerializable(checked: true, explicitToJson: true)
final class SelectedContext {
  const SelectedContext({this.featureId, this.point});

  final String? featureId;
  final AgentLatLng? point;

  factory SelectedContext.fromJson(Map<String, dynamic> json) =>
      _$SelectedContextFromJson(json);

  Map<String, dynamic> toJson() => _$SelectedContextToJson(this);
}

/// The map state sent with every turn; the app is the source of truth for
/// what is on screen.
@JsonSerializable(checked: true, explicitToJson: true)
final class RequestContext {
  const RequestContext({
    required this.viewport,
    required this.zoom,
    required this.layers,
    required this.localTime,
    this.userLocation,
    this.selected,
    this.openCardId,
  });

  @JsonKey(required: true)
  final AgentViewport viewport;

  @JsonKey(required: true)
  final double zoom;

  /// Present only when the user granted location access.
  @JsonKey(includeIfNull: false)
  final AgentLatLng? userLocation;

  @JsonKey(includeIfNull: false)
  final SelectedContext? selected;

  /// Map contract layer ids, in preset order.
  @JsonKey(required: true)
  final List<String> layers;

  @JsonKey(includeIfNull: false)
  final String? openCardId;

  /// Melbourne local time with offset, from `toProtocolString()`.
  @JsonKey(required: true)
  final String localTime;

  factory RequestContext.fromJson(Map<String, dynamic> json) =>
      _$RequestContextFromJson(json);

  Map<String, dynamic> toJson() => _$RequestContextToJson(this);
}

/// What the user did: typed, selected a point, tapped Analyse or answered.
@Freezed(unionKey: 'kind', fromJson: true, toJson: true)
sealed class TurnInput with _$TurnInput {
  @FreezedUnionValue('text')
  const factory TurnInput.text({
    @JsonKey(required: true) required String text,
  }) = TextTurnInput;

  @FreezedUnionValue('area')
  const factory TurnInput.area({
    @JsonKey(required: true) required double lat,
    @JsonKey(required: true) required double lng,
  }) = AreaTurnInput;

  @FreezedUnionValue('analyse')
  const factory TurnInput.analyse({
    @JsonKey(required: true) required String featureId,
  }) = AnalyseTurnInput;

  @FreezedUnionValue('answer')
  const factory TurnInput.answer({
    @JsonKey(required: true) required String questionId,
    @JsonKey(required: true) required String value,
  }) = AnswerTurnInput;

  factory TurnInput.fromJson(Map<String, dynamic> json) =>
      _$TurnInputFromJson(json);
}

/// The most photos one turn carries, and the most bytes one photo may have
/// (`ATTACHMENT_LIMITS` in the service's schemas).
const int maxPhotosPerTurn = 4;
const int maxPhotoBytes = 1000000;

/// The photo types the service accepts.
const Set<String> photoMimeTypes = {
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
};

/// A photo attached to a text turn: its type and its bytes in standard
/// base64.
@JsonSerializable(checked: true, explicitToJson: true)
final class TurnAttachment {
  const TurnAttachment({
    required this.mimeType,
    required this.data,
    this.kind = 'image',
  });

  @JsonKey(required: true)
  final String kind;

  @JsonKey(required: true)
  final String mimeType;

  @JsonKey(required: true)
  final String data;

  factory TurnAttachment.fromJson(Map<String, dynamic> json) =>
      _$TurnAttachmentFromJson(json);

  Map<String, dynamic> toJson() => _$TurnAttachmentToJson(this);
}

/// A stored photo of a turn; its bytes come from
/// `AgentClient.getAttachment`.
@JsonSerializable(checked: true, explicitToJson: true)
final class AttachmentRef {
  const AttachmentRef({
    required this.id,
    required this.kind,
    required this.mimeType,
    required this.bytes,
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true)
  final String kind;

  @JsonKey(required: true)
  final String mimeType;

  @JsonKey(required: true)
  final int bytes;

  factory AttachmentRef.fromJson(Map<String, dynamic> json) =>
      _$AttachmentRefFromJson(json);

  Map<String, dynamic> toJson() => _$AttachmentRefToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class TurnRequest {
  const TurnRequest({
    required this.input,
    required this.context,
    this.attachments,
  });

  @JsonKey(required: true)
  final TurnInput input;

  @JsonKey(required: true)
  final RequestContext context;

  /// Photos, only with a `text` input, whose text may then be empty.
  @JsonKey(includeIfNull: false)
  final List<TurnAttachment>? attachments;

  factory TurnRequest.fromJson(Map<String, dynamic> json) =>
      _$TurnRequestFromJson(json);

  Map<String, dynamic> toJson() => _$TurnRequestToJson(this);
}

/// A time window of a card item; either end may be missing.
@JsonSerializable(checked: true, explicitToJson: true)
final class AgentTimeWindow {
  const AgentTimeWindow({this.from, this.to});

  @JsonKey(includeIfNull: false)
  final String? from;

  @JsonKey(includeIfNull: false)
  final String? to;

  factory AgentTimeWindow.fromJson(Map<String, dynamic> json) =>
      _$AgentTimeWindowFromJson(json);

  Map<String, dynamic> toJson() => _$AgentTimeWindowToJson(this);
}

/// A card item cites one map feature id or one URL a tool returned in the
/// same turn (agent-design.md, Source rules). The wire shape has no
/// discriminator, so the key decides.
sealed class CardSource {
  const CardSource();

  factory CardSource.fromJson(Map<String, dynamic> json) {
    final Object? featureId = json['feature_id'];
    if (featureId is String) return FeatureCardSource(featureId: featureId);
    final Object? url = json['url'];
    final Object? title = json['title'];
    if (url is String && (title == null || title is String)) {
      return LinkCardSource(url: url, title: title as String?);
    }
    throw const FormatException('A card source cites a feature_id or a url.');
  }

  Map<String, dynamic> toJson();
}

final class FeatureCardSource extends CardSource {
  const FeatureCardSource({required this.featureId});

  final String featureId;

  @override
  Map<String, dynamic> toJson() => {'feature_id': featureId};

  @override
  bool operator ==(Object other) =>
      other is FeatureCardSource && other.featureId == featureId;

  @override
  int get hashCode => featureId.hashCode;
}

final class LinkCardSource extends CardSource {
  const LinkCardSource({required this.url, this.title});

  final String url;
  final String? title;

  @override
  Map<String, dynamic> toJson() => {
    'url': url,
    if (title != null) 'title': title,
  };

  @override
  bool operator ==(Object other) =>
      other is LinkCardSource && other.url == url && other.title == title;

  @override
  int get hashCode => Object.hash(url, title);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class CardItem {
  const CardItem({
    required this.title,
    required this.source,
    this.summary,
    this.time,
    this.location,
    this.placeId,
    this.cost,
    this.gettingThere,
  });

  @JsonKey(required: true)
  final String title;

  @JsonKey(includeIfNull: false)
  final String? summary;

  @JsonKey(required: true)
  final CardSource source;

  @JsonKey(includeIfNull: false)
  final AgentTimeWindow? time;

  /// Lets an item the app has not loaded still show a pin.
  @JsonKey(includeIfNull: false)
  final AgentLatLng? location;

  @JsonKey(name: 'place_id', includeIfNull: false)
  final String? placeId;

  @JsonKey(includeIfNull: false)
  final String? cost;

  @JsonKey(name: 'getting_there', includeIfNull: false)
  final String? gettingThere;

  factory CardItem.fromJson(Map<String, dynamic> json) =>
      _$CardItemFromJson(json);

  Map<String, dynamic> toJson() => _$CardItemToJson(this);
}

/// Each card type maps to a use case and has its own widget.
enum CardType {
  @JsonValue('area_brief')
  areaBrief,
  @JsonValue('anomaly_analysis')
  anomalyAnalysis,
  plan,
  history,
  list,
}

@JsonSerializable(checked: true, explicitToJson: true)
final class AgentCard {
  const AgentCard({
    required this.id,
    required this.type,
    required this.title,
    required this.items,
    this.intro,
    this.attribution,
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true)
  final CardType type;

  @JsonKey(required: true)
  final String title;

  @JsonKey(includeIfNull: false)
  final String? intro;

  @JsonKey(required: true)
  final List<CardItem> items;

  /// Provider attribution, for example `google_maps` with place ids and Maps
  /// URIs; shown whenever present (AGENTS.md, Product rules).
  @JsonKey(includeIfNull: false)
  final Map<String, dynamic>? attribution;

  bool get hasGoogleMapsAttribution => attribution?['google_maps'] != null;

  factory AgentCard.fromJson(Map<String, dynamic> json) =>
      _$AgentCardFromJson(json);

  Map<String, dynamic> toJson() => _$AgentCardToJson(this);
}

enum UiActionName {
  @JsonValue('show_layers')
  showLayers,
  @JsonValue('focus_map')
  focusMap,
  @JsonValue('draw_route')
  drawRoute,
  @JsonValue('highlight_features')
  highlightFeatures,
}

/// A one-way instruction to the map; the arguments follow tools.md.
@JsonSerializable(checked: true, explicitToJson: true)
final class UiAction {
  const UiAction({required this.action, required this.args});

  @JsonKey(required: true)
  final UiActionName action;

  @JsonKey(required: true)
  final Map<String, dynamic> args;

  factory UiAction.fromJson(Map<String, dynamic> json) =>
      _$UiActionFromJson(json);

  Map<String, dynamic> toJson() => _$UiActionToJson(this);
}

/// One model call's usage, copied from Gemini's `usageMetadata`.
@JsonSerializable(checked: true, explicitToJson: true)
final class CallUsage {
  const CallUsage({
    required this.index,
    required this.agent,
    required this.model,
    required this.input,
    required this.cachedInput,
    required this.output,
    required this.thoughts,
    required this.toolUseInput,
    required this.total,
    required this.durationMs,
  });

  @JsonKey(required: true)
  final int index;

  @JsonKey(required: true)
  final String agent;

  @JsonKey(required: true)
  final String model;

  @JsonKey(required: true)
  final int input;

  @JsonKey(required: true)
  final int cachedInput;

  @JsonKey(required: true)
  final int output;

  @JsonKey(required: true)
  final int thoughts;

  @JsonKey(required: true)
  final int toolUseInput;

  @JsonKey(required: true)
  final int total;

  @JsonKey(required: true)
  final int durationMs;

  factory CallUsage.fromJson(Map<String, dynamic> json) =>
      _$CallUsageFromJson(json);

  Map<String, dynamic> toJson() => _$CallUsageToJson(this);
}

/// Running totals of a turn. `complete` arrives with `done` and `error`;
/// `perCall` only in stored turns.
@JsonSerializable(checked: true, explicitToJson: true)
final class TurnUsage {
  const TurnUsage({
    required this.calls,
    required this.input,
    required this.cachedInput,
    required this.output,
    required this.thoughts,
    required this.toolUseInput,
    required this.total,
    this.complete,
    this.perCall,
  });

  @JsonKey(required: true)
  final int calls;

  @JsonKey(required: true)
  final int input;

  @JsonKey(required: true)
  final int cachedInput;

  @JsonKey(required: true)
  final int output;

  @JsonKey(required: true)
  final int thoughts;

  @JsonKey(required: true)
  final int toolUseInput;

  @JsonKey(required: true)
  final int total;

  /// False when a model call was cut off, so its tokens are missing although
  /// Gemini may still bill them.
  @JsonKey(includeIfNull: false)
  final bool? complete;

  @JsonKey(includeIfNull: false)
  final List<CallUsage>? perCall;

  factory TurnUsage.fromJson(Map<String, dynamic> json) =>
      _$TurnUsageFromJson(json);

  Map<String, dynamic> toJson() => _$TurnUsageToJson(this);
}

enum StopReason { end, asked, budget, cancelled }

@JsonSerializable(checked: true, explicitToJson: true)
final class AgentQuestion {
  const AgentQuestion({
    required this.id,
    required this.text,
    required this.options,
    required this.allowFreeText,
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true)
  final String text;

  @JsonKey(required: true)
  final List<String> options;

  @JsonKey(required: true)
  final bool allowFreeText;

  factory AgentQuestion.fromJson(Map<String, dynamic> json) =>
      _$AgentQuestionFromJson(json);

  Map<String, dynamic> toJson() => _$AgentQuestionToJson(this);
}

/// Where a tool call is: `running` when it starts, then `done` or `failed`
/// (a tool error) when it ends.
enum AgentStepState { running, done, failed }

/// One server-sent event of a turn. Every event carries `turnId` and an
/// increasing `seq`, so the app can de-duplicate and order them. Every tool
/// call is one step; the events it produces carry the same `stepId`.
@Freezed(unionKey: 'event', fromJson: true, toJson: true)
sealed class AgentEvent with _$AgentEvent {
  /// A step of the turn: sent with state `running` when the tool call
  /// starts and again with `done` or `failed` when it ends. [detail] sums up
  /// the arguments; [rows], [durationMs], [error] and [memo] arrive with the
  /// finished event.
  @FreezedUnionValue('status')
  const factory AgentEvent.status({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required String stepId,
    @JsonKey(required: true) required AgentStepState state,
    @JsonKey(required: true) required String tool,
    @JsonKey(required: true) required String text,
    @JsonKey(includeIfNull: false) String? detail,
    @JsonKey(includeIfNull: false) int? rows,
    @JsonKey(includeIfNull: false) String? error,
    @JsonKey(includeIfNull: false) int? durationMs,
    @Default(false) bool memo,
  }) = AgentStatusEvent;

  @FreezedUnionValue('text')
  const factory AgentEvent.text({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required String delta,
  }) = AgentTextEvent;

  @FreezedUnionValue('ui_action')
  const factory AgentEvent.uiAction({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required String stepId,
    @JsonKey(required: true) required UiActionName action,
    @JsonKey(required: true) required Map<String, dynamic> args,
  }) = AgentUiActionEvent;

  @FreezedUnionValue('card')
  const factory AgentEvent.card({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required String stepId,
    @JsonKey(required: true) required AgentCard card,
  }) = AgentCardEvent;

  @FreezedUnionValue('question')
  const factory AgentEvent.question({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required String stepId,
    @JsonKey(required: true) required AgentQuestion question,
  }) = AgentQuestionEvent;

  @FreezedUnionValue('usage')
  const factory AgentEvent.usage({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required CallUsage call,
    @JsonKey(required: true) required TurnUsage turn,
  }) = AgentUsageEvent;

  @FreezedUnionValue('done')
  const factory AgentEvent.done({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required StopReason stop,
    @JsonKey(required: true) required TurnUsage usage,
  }) = AgentDoneEvent;

  @FreezedUnionValue('error')
  const factory AgentEvent.error({
    @JsonKey(required: true) required String turnId,
    @JsonKey(required: true) required int seq,
    @JsonKey(required: true) required String message,
    @JsonKey(required: true) required bool retryable,
    @JsonKey(required: true) required TurnUsage usage,
  }) = AgentErrorEvent;

  factory AgentEvent.fromJson(Map<String, dynamic> json) =>
      _$AgentEventFromJson(json);
}

/// One line of the compact tool trace stored with a turn: the step as the
/// app showed it while the turn ran. Turns stored before `detail` and `memo`
/// existed lack them.
@JsonSerializable(checked: true, explicitToJson: true)
final class TraceEntry {
  const TraceEntry({
    required this.tool,
    required this.args,
    required this.status,
    required this.rows,
    required this.error,
    required this.durationMs,
    this.detail,
    this.memo = false,
  });

  @JsonKey(required: true)
  final String tool;

  @JsonKey(required: true)
  final Map<String, dynamic> args;

  /// The tool's status line; null in turns stored before UI tools had one.
  @JsonKey(required: true)
  final String? status;

  /// A short summary of the arguments.
  @JsonKey(includeIfNull: false)
  final String? detail;

  @JsonKey(required: true)
  final int? rows;

  @JsonKey(required: true)
  final String? error;

  @JsonKey(required: true)
  final int durationMs;

  /// Answered from an identical earlier call in the same turn.
  @JsonKey(defaultValue: false)
  final bool memo;

  factory TraceEntry.fromJson(Map<String, dynamic> json) =>
      _$TraceEntryFromJson(json);

  Map<String, dynamic> toJson() => _$TraceEntryToJson(this);
}

/// A finished turn as the server stores it: what the app needs to redraw.
@JsonSerializable(checked: true, explicitToJson: true)
final class StoredTurn {
  const StoredTurn({
    required this.id,
    required this.seq,
    required this.createdAt,
    required this.input,
    required this.text,
    required this.cards,
    required this.uiActions,
    required this.question,
    required this.stop,
    required this.trace,
    required this.usage,
    this.attachments = const [],
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true)
  final int seq;

  @JsonKey(required: true)
  final String createdAt;

  @JsonKey(required: true)
  final TurnInput input;

  /// The photos the user attached; turns stored before photos have none.
  @JsonKey(defaultValue: <AttachmentRef>[])
  final List<AttachmentRef> attachments;

  @JsonKey(required: true)
  final String text;

  @JsonKey(required: true)
  final List<AgentCard> cards;

  @JsonKey(required: true)
  final List<UiAction> uiActions;

  @JsonKey(required: true)
  final AgentQuestion? question;

  @JsonKey(required: true)
  final StopReason stop;

  @JsonKey(required: true)
  final List<TraceEntry> trace;

  @JsonKey(required: true)
  final TurnUsage usage;

  factory StoredTurn.fromJson(Map<String, dynamic> json) =>
      _$StoredTurnFromJson(json);

  Map<String, dynamic> toJson() => _$StoredTurnToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class SessionSummary {
  const SessionSummary({
    required this.id,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    required this.turnCount,
  });

  @JsonKey(required: true)
  final String id;

  /// The first user message, trimmed; empty until the first turn.
  @JsonKey(required: true)
  final String title;

  @JsonKey(required: true)
  final String createdAt;

  @JsonKey(required: true)
  final String updatedAt;

  @JsonKey(required: true)
  final int turnCount;

  factory SessionSummary.fromJson(Map<String, dynamic> json) =>
      _$SessionSummaryFromJson(json);

  Map<String, dynamic> toJson() => _$SessionSummaryToJson(this);
}

/// `GET /v1/sessions/{sessionId}`: the summary, any pending question and the
/// stored turns, oldest first.
@JsonSerializable(checked: true, explicitToJson: true)
final class SessionDetail {
  const SessionDetail({
    required this.session,
    required this.pendingQuestion,
    required this.turns,
  });

  @JsonKey(required: true)
  final SessionSummary session;

  @JsonKey(required: true)
  final AgentQuestion? pendingQuestion;

  @JsonKey(required: true)
  final List<StoredTurn> turns;

  factory SessionDetail.fromJson(Map<String, dynamic> json) =>
      _$SessionDetailFromJson(json);

  Map<String, dynamic> toJson() => _$SessionDetailToJson(this);
}

/// Error codes of the service's JSON error envelope, by name.
enum AgentErrorCode {
  invalidRequest,
  unauthorized,

  /// An owner-only user event route called by another user.
  forbidden,
  notFound,

  /// A user event action its state does not allow; the envelope's
  /// `messageKey` names why (agent-protocol.md, User events, Rules 3).
  conflict,
  turnInProgress,
  rateLimited,
  serviceUnavailable,
  timeout,
}
