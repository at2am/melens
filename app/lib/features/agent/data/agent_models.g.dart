// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'agent_models.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AgentLatLng _$AgentLatLngFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentLatLng', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['lat', 'lng']);
      final val = AgentLatLng(
        lat: $checkedConvert('lat', (v) => (v as num).toDouble()),
        lng: $checkedConvert('lng', (v) => (v as num).toDouble()),
      );
      return val;
    });

Map<String, dynamic> _$AgentLatLngToJson(AgentLatLng instance) =>
    <String, dynamic>{'lat': instance.lat, 'lng': instance.lng};

AgentViewport _$AgentViewportFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentViewport', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['north', 'south', 'east', 'west']);
      final val = AgentViewport(
        north: $checkedConvert('north', (v) => (v as num).toDouble()),
        south: $checkedConvert('south', (v) => (v as num).toDouble()),
        east: $checkedConvert('east', (v) => (v as num).toDouble()),
        west: $checkedConvert('west', (v) => (v as num).toDouble()),
      );
      return val;
    });

Map<String, dynamic> _$AgentViewportToJson(AgentViewport instance) =>
    <String, dynamic>{
      'north': instance.north,
      'south': instance.south,
      'east': instance.east,
      'west': instance.west,
    };

SelectedContext _$SelectedContextFromJson(Map<String, dynamic> json) =>
    $checkedCreate('SelectedContext', json, ($checkedConvert) {
      final val = SelectedContext(
        featureId: $checkedConvert('featureId', (v) => v as String?),
        point: $checkedConvert(
          'point',
          (v) => v == null
              ? null
              : AgentLatLng.fromJson(v as Map<String, dynamic>),
        ),
      );
      return val;
    });

Map<String, dynamic> _$SelectedContextToJson(SelectedContext instance) =>
    <String, dynamic>{
      'featureId': instance.featureId,
      'point': instance.point?.toJson(),
    };

RequestContext _$RequestContextFromJson(Map<String, dynamic> json) =>
    $checkedCreate('RequestContext', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['viewport', 'zoom', 'layers', 'localTime'],
      );
      final val = RequestContext(
        viewport: $checkedConvert(
          'viewport',
          (v) => AgentViewport.fromJson(v as Map<String, dynamic>),
        ),
        zoom: $checkedConvert('zoom', (v) => (v as num).toDouble()),
        layers: $checkedConvert(
          'layers',
          (v) => (v as List<dynamic>).map((e) => e as String).toList(),
        ),
        localTime: $checkedConvert('localTime', (v) => v as String),
        userLocation: $checkedConvert(
          'userLocation',
          (v) => v == null
              ? null
              : AgentLatLng.fromJson(v as Map<String, dynamic>),
        ),
        selected: $checkedConvert(
          'selected',
          (v) => v == null
              ? null
              : SelectedContext.fromJson(v as Map<String, dynamic>),
        ),
        openCardId: $checkedConvert('openCardId', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$RequestContextToJson(RequestContext instance) =>
    <String, dynamic>{
      'viewport': instance.viewport.toJson(),
      'zoom': instance.zoom,
      'userLocation': ?instance.userLocation?.toJson(),
      'selected': ?instance.selected?.toJson(),
      'layers': instance.layers,
      'openCardId': ?instance.openCardId,
      'localTime': instance.localTime,
    };

QuestionAnswer _$QuestionAnswerFromJson(Map<String, dynamic> json) =>
    $checkedCreate('QuestionAnswer', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['questionId', 'value']);
      final val = QuestionAnswer(
        questionId: $checkedConvert('questionId', (v) => v as String),
        value: $checkedConvert('value', (v) => v as String),
      );
      return val;
    });

Map<String, dynamic> _$QuestionAnswerToJson(QuestionAnswer instance) =>
    <String, dynamic>{
      'questionId': instance.questionId,
      'value': instance.value,
    };

TurnAttachment _$TurnAttachmentFromJson(Map<String, dynamic> json) =>
    $checkedCreate('TurnAttachment', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['kind', 'mimeType', 'data']);
      final val = TurnAttachment(
        mimeType: $checkedConvert('mimeType', (v) => v as String),
        data: $checkedConvert('data', (v) => v as String),
        kind: $checkedConvert('kind', (v) => v as String? ?? 'image'),
      );
      return val;
    });

Map<String, dynamic> _$TurnAttachmentToJson(TurnAttachment instance) =>
    <String, dynamic>{
      'kind': instance.kind,
      'mimeType': instance.mimeType,
      'data': instance.data,
    };

AttachmentRef _$AttachmentRefFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AttachmentRef', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['id', 'kind', 'mimeType', 'bytes']);
      final val = AttachmentRef(
        id: $checkedConvert('id', (v) => v as String),
        kind: $checkedConvert('kind', (v) => v as String),
        mimeType: $checkedConvert('mimeType', (v) => v as String),
        bytes: $checkedConvert('bytes', (v) => (v as num).toInt()),
      );
      return val;
    });

Map<String, dynamic> _$AttachmentRefToJson(AttachmentRef instance) =>
    <String, dynamic>{
      'id': instance.id,
      'kind': instance.kind,
      'mimeType': instance.mimeType,
      'bytes': instance.bytes,
    };

TurnRequest _$TurnRequestFromJson(Map<String, dynamic> json) =>
    $checkedCreate('TurnRequest', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['input', 'context']);
      final val = TurnRequest(
        input: $checkedConvert(
          'input',
          (v) => TurnInput.fromJson(v as Map<String, dynamic>),
        ),
        context: $checkedConvert(
          'context',
          (v) => RequestContext.fromJson(v as Map<String, dynamic>),
        ),
        attachments: $checkedConvert(
          'attachments',
          (v) => (v as List<dynamic>?)
              ?.map((e) => TurnAttachment.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
      );
      return val;
    });

Map<String, dynamic> _$TurnRequestToJson(TurnRequest instance) =>
    <String, dynamic>{
      'input': instance.input.toJson(),
      'context': instance.context.toJson(),
      'attachments': ?instance.attachments?.map((e) => e.toJson()).toList(),
    };

AgentTimeWindow _$AgentTimeWindowFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentTimeWindow', json, ($checkedConvert) {
      final val = AgentTimeWindow(
        from: $checkedConvert('from', (v) => v as String?),
        to: $checkedConvert('to', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$AgentTimeWindowToJson(AgentTimeWindow instance) =>
    <String, dynamic>{'from': ?instance.from, 'to': ?instance.to};

CardParking _$CardParkingFromJson(Map<String, dynamic> json) => $checkedCreate(
  'CardParking',
  json,
  ($checkedConvert) {
    $checkKeys(
      json,
      requiredKeys: const [
        'state',
        'recommended',
        'distance_m',
        'walk_min',
        'policy_scope',
      ],
    );
    final val = CardParking(
      state: $checkedConvert(
        'state',
        (v) => $enumDecode(_$CardParkingStateEnumMap, v),
      ),
      recommended: $checkedConvert('recommended', (v) => v as bool),
      distanceMetres: $checkedConvert('distance_m', (v) => (v as num).toInt()),
      walkMinutes: $checkedConvert('walk_min', (v) => (v as num).toInt()),
      policyScope: $checkedConvert(
        'policy_scope',
        (v) => $enumDecode(_$CardParkingPolicyScopeEnumMap, v),
      ),
      destination: $checkedConvert('destination', (v) => v as String?),
      reportedAt: $checkedConvert('reported_at', (v) => v as String?),
      zone: $checkedConvert('zone', (v) => (v as num?)?.toInt()),
      fee: $checkedConvert('fee', (v) => v as String?),
      timeLimit: $checkedConvert('time_limit', (v) => v as String?),
      hours: $checkedConvert('hours', (v) => v as String?),
      payment: $checkedConvert('payment', (v) => v as String?),
      policyUrl: $checkedConvert('policy_url', (v) => v as String?),
    );
    return val;
  },
  fieldKeyMap: const {
    'distanceMetres': 'distance_m',
    'walkMinutes': 'walk_min',
    'policyScope': 'policy_scope',
    'reportedAt': 'reported_at',
    'timeLimit': 'time_limit',
    'policyUrl': 'policy_url',
  },
);

Map<String, dynamic> _$CardParkingToJson(CardParking instance) =>
    <String, dynamic>{
      'state': _$CardParkingStateEnumMap[instance.state]!,
      'recommended': instance.recommended,
      'distance_m': instance.distanceMetres,
      'walk_min': instance.walkMinutes,
      'destination': instance.destination,
      'reported_at': instance.reportedAt,
      'zone': instance.zone,
      'fee': instance.fee,
      'time_limit': instance.timeLimit,
      'hours': instance.hours,
      'payment': instance.payment,
      'policy_scope': _$CardParkingPolicyScopeEnumMap[instance.policyScope]!,
      'policy_url': instance.policyUrl,
    };

const _$CardParkingStateEnumMap = {
  CardParkingState.vacant: 'vacant',
  CardParkingState.occupied: 'occupied',
  CardParkingState.noData: 'noData',
};

const _$CardParkingPolicyScopeEnumMap = {
  CardParkingPolicyScope.area: 'area',
  CardParkingPolicyScope.unknown: 'unknown',
};

StopParkingBay _$StopParkingBayFromJson(
  Map<String, dynamic> json,
) => $checkedCreate(
  'StopParkingBay',
  json,
  ($checkedConvert) {
    $checkKeys(
      json,
      requiredKeys: const ['feature_id', 'location', 'distance_m', 'walk_min'],
    );
    final val = StopParkingBay(
      featureId: $checkedConvert('feature_id', (v) => v as String),
      location: $checkedConvert(
        'location',
        (v) => AgentLatLng.fromJson(v as Map<String, dynamic>),
      ),
      distanceMetres: $checkedConvert('distance_m', (v) => (v as num).toInt()),
      walkMinutes: $checkedConvert('walk_min', (v) => (v as num).toInt()),
      reportedAt: $checkedConvert('reported_at', (v) => v as String?),
    );
    return val;
  },
  fieldKeyMap: const {
    'featureId': 'feature_id',
    'distanceMetres': 'distance_m',
    'walkMinutes': 'walk_min',
    'reportedAt': 'reported_at',
  },
);

Map<String, dynamic> _$StopParkingBayToJson(StopParkingBay instance) =>
    <String, dynamic>{
      'feature_id': instance.featureId,
      'location': instance.location.toJson(),
      'distance_m': instance.distanceMetres,
      'walk_min': instance.walkMinutes,
      'reported_at': instance.reportedAt,
    };

StopParking _$StopParkingFromJson(Map<String, dynamic> json) => $checkedCreate(
  'StopParking',
  json,
  ($checkedConvert) {
    $checkKeys(
      json,
      requiredKeys: const [
        'checked_at',
        'radius_m',
        'vacant',
        'occupied',
        'no_data',
        'bays',
        'policy_scope',
      ],
    );
    final val = StopParking(
      checkedAt: $checkedConvert('checked_at', (v) => v as String),
      radiusMetres: $checkedConvert('radius_m', (v) => (v as num).toInt()),
      vacant: $checkedConvert('vacant', (v) => (v as num).toInt()),
      occupied: $checkedConvert('occupied', (v) => (v as num).toInt()),
      noData: $checkedConvert('no_data', (v) => (v as num).toInt()),
      bays: $checkedConvert(
        'bays',
        (v) => (v as List<dynamic>)
            .map((e) => StopParkingBay.fromJson(e as Map<String, dynamic>))
            .toList(),
      ),
      policyScope: $checkedConvert(
        'policy_scope',
        (v) => $enumDecode(_$CardParkingPolicyScopeEnumMap, v),
      ),
      fee: $checkedConvert('fee', (v) => v as String?),
      timeLimit: $checkedConvert('time_limit', (v) => v as String?),
      hours: $checkedConvert('hours', (v) => v as String?),
      payment: $checkedConvert('payment', (v) => v as String?),
      policyUrl: $checkedConvert('policy_url', (v) => v as String?),
    );
    return val;
  },
  fieldKeyMap: const {
    'checkedAt': 'checked_at',
    'radiusMetres': 'radius_m',
    'noData': 'no_data',
    'policyScope': 'policy_scope',
    'timeLimit': 'time_limit',
    'policyUrl': 'policy_url',
  },
);

Map<String, dynamic> _$StopParkingToJson(StopParking instance) =>
    <String, dynamic>{
      'checked_at': instance.checkedAt,
      'radius_m': instance.radiusMetres,
      'vacant': instance.vacant,
      'occupied': instance.occupied,
      'no_data': instance.noData,
      'bays': instance.bays.map((e) => e.toJson()).toList(),
      'fee': instance.fee,
      'time_limit': instance.timeLimit,
      'hours': instance.hours,
      'payment': instance.payment,
      'policy_scope': _$CardParkingPolicyScopeEnumMap[instance.policyScope]!,
      'policy_url': instance.policyUrl,
    };

CardItem _$CardItemFromJson(Map<String, dynamic> json) => $checkedCreate(
  'CardItem',
  json,
  ($checkedConvert) {
    $checkKeys(json, requiredKeys: const ['title', 'source']);
    final val = CardItem(
      title: $checkedConvert('title', (v) => v as String),
      source: $checkedConvert(
        'source',
        (v) => CardSource.fromJson(v as Map<String, dynamic>),
      ),
      summary: $checkedConvert('summary', (v) => v as String?),
      time: $checkedConvert(
        'time',
        (v) => v == null
            ? null
            : AgentTimeWindow.fromJson(v as Map<String, dynamic>),
      ),
      location: $checkedConvert(
        'location',
        (v) =>
            v == null ? null : AgentLatLng.fromJson(v as Map<String, dynamic>),
      ),
      placeId: $checkedConvert('place_id', (v) => v as String?),
      cost: $checkedConvert('cost', (v) => v as String?),
      gettingThere: $checkedConvert('getting_there', (v) => v as String?),
      parking: $checkedConvert(
        'parking',
        (v) =>
            v == null ? null : CardParking.fromJson(v as Map<String, dynamic>),
      ),
      stopParking: $checkedConvert(
        'stop_parking',
        (v) =>
            v == null ? null : StopParking.fromJson(v as Map<String, dynamic>),
      ),
    );
    return val;
  },
  fieldKeyMap: const {
    'placeId': 'place_id',
    'gettingThere': 'getting_there',
    'stopParking': 'stop_parking',
  },
);

Map<String, dynamic> _$CardItemToJson(CardItem instance) => <String, dynamic>{
  'title': instance.title,
  'summary': ?instance.summary,
  'source': instance.source.toJson(),
  'time': ?instance.time?.toJson(),
  'location': ?instance.location?.toJson(),
  'place_id': ?instance.placeId,
  'cost': ?instance.cost,
  'getting_there': ?instance.gettingThere,
  'parking': ?instance.parking?.toJson(),
  'stop_parking': ?instance.stopParking?.toJson(),
};

AgentCard _$AgentCardFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentCard', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['id', 'type', 'title', 'items']);
      final val = AgentCard(
        id: $checkedConvert('id', (v) => v as String),
        type: $checkedConvert('type', (v) => $enumDecode(_$CardTypeEnumMap, v)),
        title: $checkedConvert('title', (v) => v as String),
        items: $checkedConvert(
          'items',
          (v) => (v as List<dynamic>)
              .map((e) => CardItem.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        intro: $checkedConvert('intro', (v) => v as String?),
        travelMode: $checkedConvert(
          'travel_mode',
          (v) => $enumDecodeNullable(
            _$TravelModeEnumMap,
            v,
            unknownValue: JsonKey.nullForUndefinedEnumValue,
          ),
        ),
        revises: $checkedConvert('revises', (v) => v as String?),
        attribution: $checkedConvert(
          'attribution',
          (v) => v as Map<String, dynamic>?,
        ),
      );
      return val;
    }, fieldKeyMap: const {'travelMode': 'travel_mode'});

Map<String, dynamic> _$AgentCardToJson(AgentCard instance) => <String, dynamic>{
  'id': instance.id,
  'type': _$CardTypeEnumMap[instance.type]!,
  'title': instance.title,
  'intro': ?instance.intro,
  'travel_mode': ?_$TravelModeEnumMap[instance.travelMode],
  'revises': ?instance.revises,
  'items': instance.items.map((e) => e.toJson()).toList(),
  'attribution': ?instance.attribution,
};

const _$CardTypeEnumMap = {
  CardType.areaBrief: 'area_brief',
  CardType.anomalyAnalysis: 'anomaly_analysis',
  CardType.plan: 'plan',
  CardType.history: 'history',
  CardType.list: 'list',
};

const _$TravelModeEnumMap = {
  TravelMode.walk: 'walk',
  TravelMode.transit: 'transit',
  TravelMode.drive: 'drive',
  TravelMode.cycle: 'cycle',
};

UiAction _$UiActionFromJson(Map<String, dynamic> json) =>
    $checkedCreate('UiAction', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['action', 'args']);
      final val = UiAction(
        action: $checkedConvert(
          'action',
          (v) => $enumDecode(_$UiActionNameEnumMap, v),
        ),
        args: $checkedConvert('args', (v) => v as Map<String, dynamic>),
      );
      return val;
    });

Map<String, dynamic> _$UiActionToJson(UiAction instance) => <String, dynamic>{
  'action': _$UiActionNameEnumMap[instance.action]!,
  'args': instance.args,
};

const _$UiActionNameEnumMap = {
  UiActionName.showLayers: 'show_layers',
  UiActionName.focusMap: 'focus_map',
  UiActionName.drawRoute: 'draw_route',
  UiActionName.highlightFeatures: 'highlight_features',
};

CallUsage _$CallUsageFromJson(Map<String, dynamic> json) => $checkedCreate(
  'CallUsage',
  json,
  ($checkedConvert) {
    $checkKeys(
      json,
      requiredKeys: const [
        'index',
        'agent',
        'model',
        'input',
        'cachedInput',
        'output',
        'thoughts',
        'toolUseInput',
        'total',
        'durationMs',
      ],
    );
    final val = CallUsage(
      index: $checkedConvert('index', (v) => (v as num).toInt()),
      agent: $checkedConvert('agent', (v) => v as String),
      model: $checkedConvert('model', (v) => v as String),
      input: $checkedConvert('input', (v) => (v as num).toInt()),
      cachedInput: $checkedConvert('cachedInput', (v) => (v as num).toInt()),
      output: $checkedConvert('output', (v) => (v as num).toInt()),
      thoughts: $checkedConvert('thoughts', (v) => (v as num).toInt()),
      toolUseInput: $checkedConvert('toolUseInput', (v) => (v as num).toInt()),
      total: $checkedConvert('total', (v) => (v as num).toInt()),
      durationMs: $checkedConvert('durationMs', (v) => (v as num).toInt()),
    );
    return val;
  },
);

Map<String, dynamic> _$CallUsageToJson(CallUsage instance) => <String, dynamic>{
  'index': instance.index,
  'agent': instance.agent,
  'model': instance.model,
  'input': instance.input,
  'cachedInput': instance.cachedInput,
  'output': instance.output,
  'thoughts': instance.thoughts,
  'toolUseInput': instance.toolUseInput,
  'total': instance.total,
  'durationMs': instance.durationMs,
};

TurnUsage _$TurnUsageFromJson(Map<String, dynamic> json) => $checkedCreate(
  'TurnUsage',
  json,
  ($checkedConvert) {
    $checkKeys(
      json,
      requiredKeys: const [
        'calls',
        'input',
        'cachedInput',
        'output',
        'thoughts',
        'toolUseInput',
        'total',
      ],
    );
    final val = TurnUsage(
      calls: $checkedConvert('calls', (v) => (v as num).toInt()),
      input: $checkedConvert('input', (v) => (v as num).toInt()),
      cachedInput: $checkedConvert('cachedInput', (v) => (v as num).toInt()),
      output: $checkedConvert('output', (v) => (v as num).toInt()),
      thoughts: $checkedConvert('thoughts', (v) => (v as num).toInt()),
      toolUseInput: $checkedConvert('toolUseInput', (v) => (v as num).toInt()),
      total: $checkedConvert('total', (v) => (v as num).toInt()),
      complete: $checkedConvert('complete', (v) => v as bool?),
      perCall: $checkedConvert(
        'perCall',
        (v) => (v as List<dynamic>?)
            ?.map((e) => CallUsage.fromJson(e as Map<String, dynamic>))
            .toList(),
      ),
    );
    return val;
  },
);

Map<String, dynamic> _$TurnUsageToJson(TurnUsage instance) => <String, dynamic>{
  'calls': instance.calls,
  'input': instance.input,
  'cachedInput': instance.cachedInput,
  'output': instance.output,
  'thoughts': instance.thoughts,
  'toolUseInput': instance.toolUseInput,
  'total': instance.total,
  'complete': ?instance.complete,
  'perCall': ?instance.perCall?.map((e) => e.toJson()).toList(),
};

AgentQuestion _$AgentQuestionFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentQuestion', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['id', 'text', 'options', 'allowFreeText'],
      );
      final val = AgentQuestion(
        id: $checkedConvert('id', (v) => v as String),
        text: $checkedConvert('text', (v) => v as String),
        options: $checkedConvert(
          'options',
          (v) => (v as List<dynamic>).map((e) => e as String).toList(),
        ),
        allowFreeText: $checkedConvert('allowFreeText', (v) => v as bool),
        planCardId: $checkedConvert('planCardId', (v) => v as String?),
        forPlan: $checkedConvert('forPlan', (v) => v as bool? ?? false),
      );
      return val;
    });

Map<String, dynamic> _$AgentQuestionToJson(AgentQuestion instance) =>
    <String, dynamic>{
      'id': instance.id,
      'text': instance.text,
      'options': instance.options,
      'allowFreeText': instance.allowFreeText,
      'planCardId': ?instance.planCardId,
      'forPlan': instance.forPlan,
    };

TraceEntry _$TraceEntryFromJson(Map<String, dynamic> json) =>
    $checkedCreate('TraceEntry', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'tool',
          'args',
          'status',
          'rows',
          'error',
          'durationMs',
        ],
      );
      final val = TraceEntry(
        tool: $checkedConvert('tool', (v) => v as String),
        args: $checkedConvert('args', (v) => v as Map<String, dynamic>),
        status: $checkedConvert('status', (v) => v as String?),
        rows: $checkedConvert('rows', (v) => (v as num?)?.toInt()),
        error: $checkedConvert('error', (v) => v as String?),
        durationMs: $checkedConvert('durationMs', (v) => (v as num).toInt()),
        detail: $checkedConvert('detail', (v) => v as String?),
        memo: $checkedConvert('memo', (v) => v as bool? ?? false),
      );
      return val;
    });

Map<String, dynamic> _$TraceEntryToJson(TraceEntry instance) =>
    <String, dynamic>{
      'tool': instance.tool,
      'args': instance.args,
      'status': instance.status,
      'detail': ?instance.detail,
      'rows': instance.rows,
      'error': instance.error,
      'durationMs': instance.durationMs,
      'memo': instance.memo,
    };

StoredTurn _$StoredTurnFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('StoredTurn', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const [
      'id',
      'seq',
      'createdAt',
      'input',
      'text',
      'cards',
      'uiActions',
      'question',
      'stop',
      'trace',
      'usage',
    ],
  );
  final val = StoredTurn(
    id: $checkedConvert('id', (v) => v as String),
    seq: $checkedConvert('seq', (v) => (v as num).toInt()),
    createdAt: $checkedConvert('createdAt', (v) => v as String),
    input: $checkedConvert(
      'input',
      (v) => TurnInput.fromJson(v as Map<String, dynamic>),
    ),
    text: $checkedConvert('text', (v) => v as String),
    cards: $checkedConvert(
      'cards',
      (v) => (v as List<dynamic>)
          .map((e) => AgentCard.fromJson(e as Map<String, dynamic>))
          .toList(),
    ),
    uiActions: $checkedConvert(
      'uiActions',
      (v) => (v as List<dynamic>)
          .map((e) => UiAction.fromJson(e as Map<String, dynamic>))
          .toList(),
    ),
    question: $checkedConvert(
      'question',
      (v) =>
          v == null ? null : AgentQuestion.fromJson(v as Map<String, dynamic>),
    ),
    stop: $checkedConvert('stop', (v) => $enumDecode(_$StopReasonEnumMap, v)),
    trace: $checkedConvert(
      'trace',
      (v) => (v as List<dynamic>)
          .map((e) => TraceEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
    ),
    usage: $checkedConvert(
      'usage',
      (v) => TurnUsage.fromJson(v as Map<String, dynamic>),
    ),
    attachments: $checkedConvert(
      'attachments',
      (v) =>
          (v as List<dynamic>?)
              ?.map((e) => AttachmentRef.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    ),
    questions: $checkedConvert(
      'questions',
      (v) =>
          (v as List<dynamic>?)
              ?.map((e) => AgentQuestion.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    ),
  );
  return val;
});

Map<String, dynamic> _$StoredTurnToJson(StoredTurn instance) =>
    <String, dynamic>{
      'id': instance.id,
      'seq': instance.seq,
      'createdAt': instance.createdAt,
      'input': instance.input.toJson(),
      'attachments': instance.attachments.map((e) => e.toJson()).toList(),
      'text': instance.text,
      'cards': instance.cards.map((e) => e.toJson()).toList(),
      'uiActions': instance.uiActions.map((e) => e.toJson()).toList(),
      'question': instance.question?.toJson(),
      'questions': instance.questions.map((e) => e.toJson()).toList(),
      'stop': _$StopReasonEnumMap[instance.stop]!,
      'trace': instance.trace.map((e) => e.toJson()).toList(),
      'usage': instance.usage.toJson(),
    };

const _$StopReasonEnumMap = {
  StopReason.end: 'end',
  StopReason.asked: 'asked',
  StopReason.budget: 'budget',
  StopReason.cancelled: 'cancelled',
};

SessionSummary _$SessionSummaryFromJson(Map<String, dynamic> json) =>
    $checkedCreate('SessionSummary', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'title',
          'createdAt',
          'updatedAt',
          'turnCount',
        ],
      );
      final val = SessionSummary(
        id: $checkedConvert('id', (v) => v as String),
        title: $checkedConvert('title', (v) => v as String),
        createdAt: $checkedConvert('createdAt', (v) => v as String),
        updatedAt: $checkedConvert('updatedAt', (v) => v as String),
        turnCount: $checkedConvert('turnCount', (v) => (v as num).toInt()),
      );
      return val;
    });

Map<String, dynamic> _$SessionSummaryToJson(SessionSummary instance) =>
    <String, dynamic>{
      'id': instance.id,
      'title': instance.title,
      'createdAt': instance.createdAt,
      'updatedAt': instance.updatedAt,
      'turnCount': instance.turnCount,
    };

SessionDetail _$SessionDetailFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('SessionDetail', json, ($checkedConvert) {
  $checkKeys(json, requiredKeys: const ['session', 'pendingQuestion', 'turns']);
  final val = SessionDetail(
    session: $checkedConvert(
      'session',
      (v) => SessionSummary.fromJson(v as Map<String, dynamic>),
    ),
    pendingQuestion: $checkedConvert(
      'pendingQuestion',
      (v) =>
          v == null ? null : AgentQuestion.fromJson(v as Map<String, dynamic>),
    ),
    turns: $checkedConvert(
      'turns',
      (v) => (v as List<dynamic>)
          .map((e) => StoredTurn.fromJson(e as Map<String, dynamic>))
          .toList(),
    ),
  );
  return val;
});

Map<String, dynamic> _$SessionDetailToJson(SessionDetail instance) =>
    <String, dynamic>{
      'session': instance.session.toJson(),
      'pendingQuestion': instance.pendingQuestion?.toJson(),
      'turns': instance.turns.map((e) => e.toJson()).toList(),
    };

TextTurnInput _$TextTurnInputFromJson(Map<String, dynamic> json) =>
    $checkedCreate('TextTurnInput', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['text']);
      final val = TextTurnInput(
        text: $checkedConvert('text', (v) => v as String),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$TextTurnInputToJson(TextTurnInput instance) =>
    <String, dynamic>{'text': instance.text, 'kind': instance.$type};

AreaTurnInput _$AreaTurnInputFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AreaTurnInput', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['lat', 'lng']);
      final val = AreaTurnInput(
        lat: $checkedConvert('lat', (v) => (v as num).toDouble()),
        lng: $checkedConvert('lng', (v) => (v as num).toDouble()),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AreaTurnInputToJson(AreaTurnInput instance) =>
    <String, dynamic>{
      'lat': instance.lat,
      'lng': instance.lng,
      'kind': instance.$type,
    };

AnalyseTurnInput _$AnalyseTurnInputFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AnalyseTurnInput', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['featureId']);
      final val = AnalyseTurnInput(
        featureId: $checkedConvert('featureId', (v) => v as String),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AnalyseTurnInputToJson(AnalyseTurnInput instance) =>
    <String, dynamic>{'featureId': instance.featureId, 'kind': instance.$type};

AnswerTurnInput _$AnswerTurnInputFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AnswerTurnInput', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['questionId', 'value']);
      final val = AnswerTurnInput(
        questionId: $checkedConvert('questionId', (v) => v as String),
        value: $checkedConvert('value', (v) => v as String),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AnswerTurnInputToJson(AnswerTurnInput instance) =>
    <String, dynamic>{
      'questionId': instance.questionId,
      'value': instance.value,
      'kind': instance.$type,
    };

RefineTurnInput _$RefineTurnInputFromJson(Map<String, dynamic> json) =>
    $checkedCreate('RefineTurnInput', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['cardId', 'text']);
      final val = RefineTurnInput(
        cardId: $checkedConvert('cardId', (v) => v as String),
        text: $checkedConvert('text', (v) => v as String),
        planId: $checkedConvert('planId', (v) => v as String?),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$RefineTurnInputToJson(RefineTurnInput instance) =>
    <String, dynamic>{
      'cardId': instance.cardId,
      'text': instance.text,
      'planId': ?instance.planId,
      'kind': instance.$type,
    };

AnswersTurnInput _$AnswersTurnInputFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AnswersTurnInput', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['answers']);
      final val = AnswersTurnInput(
        answers: $checkedConvert(
          'answers',
          (v) => (v as List<dynamic>)
              .map((e) => QuestionAnswer.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AnswersTurnInputToJson(AnswersTurnInput instance) =>
    <String, dynamic>{
      'answers': instance.answers.map((e) => e.toJson()).toList(),
      'kind': instance.$type,
    };

AgentStatusEvent _$AgentStatusEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentStatusEvent', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'turnId',
          'seq',
          'stepId',
          'state',
          'tool',
          'text',
        ],
      );
      final val = AgentStatusEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        stepId: $checkedConvert('stepId', (v) => v as String),
        state: $checkedConvert(
          'state',
          (v) => $enumDecode(_$AgentStepStateEnumMap, v),
        ),
        tool: $checkedConvert('tool', (v) => v as String),
        text: $checkedConvert('text', (v) => v as String),
        detail: $checkedConvert('detail', (v) => v as String?),
        rows: $checkedConvert('rows', (v) => (v as num?)?.toInt()),
        error: $checkedConvert('error', (v) => v as String?),
        durationMs: $checkedConvert('durationMs', (v) => (v as num?)?.toInt()),
        memo: $checkedConvert('memo', (v) => v as bool? ?? false),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentStatusEventToJson(AgentStatusEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'stepId': instance.stepId,
      'state': _$AgentStepStateEnumMap[instance.state]!,
      'tool': instance.tool,
      'text': instance.text,
      'detail': ?instance.detail,
      'rows': ?instance.rows,
      'error': ?instance.error,
      'durationMs': ?instance.durationMs,
      'memo': instance.memo,
      'event': instance.$type,
    };

const _$AgentStepStateEnumMap = {
  AgentStepState.running: 'running',
  AgentStepState.done: 'done',
  AgentStepState.failed: 'failed',
};

AgentTextEvent _$AgentTextEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentTextEvent', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['turnId', 'seq', 'delta']);
      final val = AgentTextEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        delta: $checkedConvert('delta', (v) => v as String),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentTextEventToJson(AgentTextEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'delta': instance.delta,
      'event': instance.$type,
    };

AgentUiActionEvent _$AgentUiActionEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentUiActionEvent', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['turnId', 'seq', 'stepId', 'action', 'args'],
      );
      final val = AgentUiActionEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        stepId: $checkedConvert('stepId', (v) => v as String),
        action: $checkedConvert(
          'action',
          (v) => $enumDecode(_$UiActionNameEnumMap, v),
        ),
        args: $checkedConvert('args', (v) => v as Map<String, dynamic>),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentUiActionEventToJson(AgentUiActionEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'stepId': instance.stepId,
      'action': _$UiActionNameEnumMap[instance.action]!,
      'args': instance.args,
      'event': instance.$type,
    };

AgentCardEvent _$AgentCardEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentCardEvent', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['turnId', 'seq', 'stepId', 'card']);
      final val = AgentCardEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        stepId: $checkedConvert('stepId', (v) => v as String),
        card: $checkedConvert(
          'card',
          (v) => AgentCard.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentCardEventToJson(AgentCardEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'stepId': instance.stepId,
      'card': instance.card.toJson(),
      'event': instance.$type,
    };

AgentQuestionEvent _$AgentQuestionEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentQuestionEvent', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['turnId', 'seq', 'stepId', 'question'],
      );
      final val = AgentQuestionEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        stepId: $checkedConvert('stepId', (v) => v as String),
        question: $checkedConvert(
          'question',
          (v) => AgentQuestion.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentQuestionEventToJson(AgentQuestionEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'stepId': instance.stepId,
      'question': instance.question.toJson(),
      'event': instance.$type,
    };

AgentUsageEvent _$AgentUsageEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentUsageEvent', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['turnId', 'seq', 'call', 'turn']);
      final val = AgentUsageEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        call: $checkedConvert(
          'call',
          (v) => CallUsage.fromJson(v as Map<String, dynamic>),
        ),
        turn: $checkedConvert(
          'turn',
          (v) => TurnUsage.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentUsageEventToJson(AgentUsageEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'call': instance.call.toJson(),
      'turn': instance.turn.toJson(),
      'event': instance.$type,
    };

AgentDoneEvent _$AgentDoneEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentDoneEvent', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['turnId', 'seq', 'stop', 'usage']);
      final val = AgentDoneEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        stop: $checkedConvert(
          'stop',
          (v) => $enumDecode(_$StopReasonEnumMap, v),
        ),
        usage: $checkedConvert(
          'usage',
          (v) => TurnUsage.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentDoneEventToJson(AgentDoneEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'stop': _$StopReasonEnumMap[instance.stop]!,
      'usage': instance.usage.toJson(),
      'event': instance.$type,
    };

AgentErrorEvent _$AgentErrorEventFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AgentErrorEvent', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['turnId', 'seq', 'message', 'retryable', 'usage'],
      );
      final val = AgentErrorEvent(
        turnId: $checkedConvert('turnId', (v) => v as String),
        seq: $checkedConvert('seq', (v) => (v as num).toInt()),
        message: $checkedConvert('message', (v) => v as String),
        retryable: $checkedConvert('retryable', (v) => v as bool),
        usage: $checkedConvert(
          'usage',
          (v) => TurnUsage.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('event', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'event'});

Map<String, dynamic> _$AgentErrorEventToJson(AgentErrorEvent instance) =>
    <String, dynamic>{
      'turnId': instance.turnId,
      'seq': instance.seq,
      'message': instance.message,
      'retryable': instance.retryable,
      'usage': instance.usage.toJson(),
      'event': instance.$type,
    };
