// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'map_models.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TimeWindow _$TimeWindowFromJson(Map<String, dynamic> json) =>
    $checkedCreate('TimeWindow', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['from', 'to']);
      final val = TimeWindow(
        from: $checkedConvert(
          'from',
          (v) => const UtcInstantConverter().fromJson(v as String),
        ),
        to: $checkedConvert(
          'to',
          (v) => const UtcInstantConverter().fromJson(v as String),
        ),
      );
      return val;
    });

Map<String, dynamic> _$TimeWindowToJson(TimeWindow instance) =>
    <String, dynamic>{
      'from': const UtcInstantConverter().toJson(instance.from),
      'to': const UtcInstantConverter().toJson(instance.to),
    };

AreaFilter _$AreaFilterFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AreaFilter', json, ($checkedConvert) {
      $checkKeys(
        json,
        allowedKeys: const [
          'indicatorId',
          'periodId',
          'periodStart',
          'periodEnd',
          'propertyType',
          'boundaryVintage',
        ],
        requiredKeys: const [
          'indicatorId',
          'periodId',
          'periodStart',
          'periodEnd',
          'propertyType',
          'boundaryVintage',
        ],
      );
      final val = AreaFilter(
        indicatorId: $checkedConvert('indicatorId', (v) => v as String),
        periodId: $checkedConvert('periodId', (v) => v as String),
        propertyType: $checkedConvert('propertyType', (v) => v as String?),
        boundaryVintage: $checkedConvert('boundaryVintage', (v) => v as String),
        periodStart: $checkedConvert('periodStart', (v) => v as String),
        periodEnd: $checkedConvert('periodEnd', (v) => v as String),
      );
      return val;
    });

Map<String, dynamic> _$AreaFilterToJson(AreaFilter instance) =>
    <String, dynamic>{
      'indicatorId': instance.indicatorId,
      'periodId': instance.periodId,
      'periodStart': instance.periodStart,
      'periodEnd': instance.periodEnd,
      'propertyType': instance.propertyType,
      'boundaryVintage': instance.boundaryVintage,
    };

BoundaryFilter _$BoundaryFilterFromJson(Map<String, dynamic> json) =>
    $checkedCreate('BoundaryFilter', json, ($checkedConvert) {
      $checkKeys(
        json,
        allowedKeys: const ['level', 'vintage'],
        requiredKeys: const ['level', 'vintage'],
      );
      final val = BoundaryFilter(
        level: $checkedConvert(
          'level',
          (v) => $enumDecode(_$MapBoundaryLevelEnumMap, v),
        ),
        vintage: $checkedConvert('vintage', (v) => v as String),
      );
      return val;
    });

Map<String, dynamic> _$BoundaryFilterToJson(BoundaryFilter instance) =>
    <String, dynamic>{
      'level': _$MapBoundaryLevelEnumMap[instance.level]!,
      'vintage': instance.vintage,
    };

const _$MapBoundaryLevelEnumMap = {
  MapBoundaryLevel.gccsa: 'GCCSA',
  MapBoundaryLevel.lga: 'LGA',
  MapBoundaryLevel.sa2: 'SA2',
  MapBoundaryLevel.ste: 'STE',
  MapBoundaryLevel.clueBlock: 'CLUE_BLOCK',
  MapBoundaryLevel.municipal: 'MUNICIPAL',
};

ViewportQuery _$ViewportQueryFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('ViewportQuery', json, ($checkedConvert) {
  $checkKeys(
    json,
    allowedKeys: const [
      'requestId',
      'bbox',
      'zoom',
      'layers',
      'mode',
      'window',
      'areaFilter',
      'boundaryFilter',
      'pageSize',
      'cursor',
      'snapshotId',
    ],
    requiredKeys: const [
      'requestId',
      'bbox',
      'zoom',
      'layers',
      'mode',
      'window',
    ],
  );
  final val = ViewportQuery(
    requestId: $checkedConvert('requestId', (v) => v as String),
    bbox: $checkedConvert(
      'bbox',
      (v) => const MapBoundsConverter().fromJson(v as List),
    ),
    zoom: $checkedConvert('zoom', (v) => (v as num).toDouble()),
    layers: $checkedConvert(
      'layers',
      (v) => (v as List<dynamic>)
          .map((e) => $enumDecode(_$MapLayerIdEnumMap, e))
          .toList(),
    ),
    mode: $checkedConvert('mode', (v) => $enumDecode(_$MapQueryModeEnumMap, v)),
    window: $checkedConvert(
      'window',
      (v) => TimeWindow.fromJson(v as Map<String, dynamic>),
    ),
    areaFilter: $checkedConvert(
      'areaFilter',
      (v) => v == null ? null : AreaFilter.fromJson(v as Map<String, dynamic>),
    ),
    boundaryFilter: $checkedConvert(
      'boundaryFilter',
      (v) =>
          v == null ? null : BoundaryFilter.fromJson(v as Map<String, dynamic>),
    ),
    pageSize: $checkedConvert('pageSize', (v) => (v as num?)?.toInt()),
    cursor: $checkedConvert('cursor', (v) => v as String?),
    snapshotId: $checkedConvert('snapshotId', (v) => v as String?),
  );
  return val;
});

Map<String, dynamic> _$ViewportQueryToJson(ViewportQuery instance) =>
    <String, dynamic>{
      'requestId': instance.requestId,
      'bbox': const MapBoundsConverter().toJson(instance.bbox),
      'zoom': instance.zoom,
      'layers': instance.layers.map((e) => _$MapLayerIdEnumMap[e]!).toList(),
      'mode': _$MapQueryModeEnumMap[instance.mode]!,
      'window': instance.window.toJson(),
      'areaFilter': ?instance.areaFilter?.toJson(),
      'boundaryFilter': ?instance.boundaryFilter?.toJson(),
      'pageSize': ?instance.pageSize,
      'cursor': ?instance.cursor,
      'snapshotId': ?instance.snapshotId,
    };

const _$MapLayerIdEnumMap = {
  MapLayerId.pedestrian: 'pedestrian',
  MapLayerId.anomaly: 'anomaly',
  MapLayerId.disruption: 'disruption',
  MapLayerId.event: 'event',
  MapLayerId.planning: 'planning',
  MapLayerId.boundary: 'boundary',
  MapLayerId.news: 'news',
  MapLayerId.rent: 'rent',
  MapLayerId.census: 'census',
};

const _$MapQueryModeEnumMap = {
  MapQueryMode.current: 'current',
  MapQueryMode.historical: 'historical',
};

MapCoverage _$MapCoverageFromJson(Map<String, dynamic> json) => $checkedCreate(
  'MapCoverage',
  json,
  ($checkedConvert) {
    $checkKeys(
      json,
      requiredKeys: const ['state', 'areaRefs', 'window', 'evidenceSourceIds'],
    );
    final val = MapCoverage(
      state: $checkedConvert(
        'state',
        (v) => $enumDecode(_$MapCoverageStateEnumMap, v),
      ),
      areaRefs: $checkedConvert(
        'areaRefs',
        (v) => (v as List<dynamic>).map((e) => e as String).toList(),
      ),
      window: $checkedConvert(
        'window',
        (v) =>
            v == null ? null : TimeWindow.fromJson(v as Map<String, dynamic>),
      ),
      evidenceSourceIds: $checkedConvert(
        'evidenceSourceIds',
        (v) => (v as List<dynamic>).map((e) => e as String).toList(),
      ),
    );
    return val;
  },
);

Map<String, dynamic> _$MapCoverageToJson(MapCoverage instance) =>
    <String, dynamic>{
      'state': _$MapCoverageStateEnumMap[instance.state]!,
      'areaRefs': instance.areaRefs,
      'window': instance.window?.toJson(),
      'evidenceSourceIds': instance.evidenceSourceIds,
    };

const _$MapCoverageStateEnumMap = {
  MapCoverageState.verified: 'verified',
  MapCoverageState.notCovered: 'notCovered',
  MapCoverageState.unknown: 'unknown',
};

MapSource _$MapSourceFromJson(Map<String, dynamic> json) =>
    $checkedCreate('MapSource', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['sourceId', 'url', 'attribution', 'versionRef'],
      );
      final val = MapSource(
        sourceId: $checkedConvert('sourceId', (v) => v as String),
        url: $checkedConvert('url', (v) => v as String?),
        attribution: $checkedConvert('attribution', (v) => v as String),
        versionRef: $checkedConvert('versionRef', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$MapSourceToJson(MapSource instance) => <String, dynamic>{
  'sourceId': instance.sourceId,
  'url': instance.url,
  'attribution': instance.attribution,
  'versionRef': instance.versionRef,
};

MapLocation _$MapLocationFromJson(Map<String, dynamic> json) =>
    $checkedCreate('MapLocation', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['precision', 'role', 'evidence']);
      final val = MapLocation(
        precision: $checkedConvert(
          'precision',
          (v) => $enumDecode(_$MapLocationPrecisionEnumMap, v),
        ),
        role: $checkedConvert(
          'role',
          (v) => $enumDecode(_$MapLocationRoleEnumMap, v),
        ),
        evidence: $checkedConvert('evidence', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$MapLocationToJson(MapLocation instance) =>
    <String, dynamic>{
      'precision': _$MapLocationPrecisionEnumMap[instance.precision]!,
      'role': _$MapLocationRoleEnumMap[instance.role]!,
      'evidence': instance.evidence,
    };

const _$MapLocationPrecisionEnumMap = {
  MapLocationPrecision.point: 'point',
  MapLocationPrecision.line: 'line',
  MapLocationPrecision.area: 'area',
  MapLocationPrecision.unlocated: 'unlocated',
};

const _$MapLocationRoleEnumMap = {
  MapLocationRole.eventSite: 'eventSite',
  MapLocationRole.sensor: 'sensor',
  MapLocationRole.affectedExtent: 'affectedExtent',
  MapLocationRole.statisticalArea: 'statisticalArea',
  MapLocationRole.areaAssociation: 'areaAssociation',
  MapLocationRole.mention: 'mention',
  MapLocationRole.unknown: 'unknown',
};

MapItemTime _$MapItemTimeFromJson(Map<String, dynamic> json) =>
    $checkedCreate('MapItemTime', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'observedAt',
          'reportedAt',
          'validFrom',
          'validTo',
          'periodLabel',
          'fetchedAt',
          'sourceTimeText',
          'sourceTimezone',
        ],
      );
      final val = MapItemTime(
        observedAt: $checkedConvert(
          'observedAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        reportedAt: $checkedConvert(
          'reportedAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        validFrom: $checkedConvert(
          'validFrom',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        validTo: $checkedConvert(
          'validTo',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        periodLabel: $checkedConvert('periodLabel', (v) => v as String?),
        fetchedAt: $checkedConvert(
          'fetchedAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        sourceTimeText: $checkedConvert('sourceTimeText', (v) => v as String?),
        sourceTimezone: $checkedConvert('sourceTimezone', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$MapItemTimeToJson(MapItemTime instance) =>
    <String, dynamic>{
      'observedAt': _$JsonConverterToJson<String, DateTime>(
        instance.observedAt,
        const UtcInstantConverter().toJson,
      ),
      'reportedAt': _$JsonConverterToJson<String, DateTime>(
        instance.reportedAt,
        const UtcInstantConverter().toJson,
      ),
      'validFrom': _$JsonConverterToJson<String, DateTime>(
        instance.validFrom,
        const UtcInstantConverter().toJson,
      ),
      'validTo': _$JsonConverterToJson<String, DateTime>(
        instance.validTo,
        const UtcInstantConverter().toJson,
      ),
      'periodLabel': instance.periodLabel,
      'fetchedAt': _$JsonConverterToJson<String, DateTime>(
        instance.fetchedAt,
        const UtcInstantConverter().toJson,
      ),
      'sourceTimeText': instance.sourceTimeText,
      'sourceTimezone': instance.sourceTimezone,
    };

Value? _$JsonConverterFromJson<Json, Value>(
  Object? json,
  Value? Function(Json json) fromJson,
) => json == null ? null : fromJson(json as Json);

Json? _$JsonConverterToJson<Json, Value>(
  Value? value,
  Json? Function(Value value) toJson,
) => value == null ? null : toJson(value);

GeometryPresentation _$GeometryPresentationFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('GeometryPresentation', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const ['simplified', 'originalPrecision', 'toleranceMeters'],
  );
  final val = GeometryPresentation(
    simplified: $checkedConvert('simplified', (v) => v as bool),
    originalPrecision: $checkedConvert(
      'originalPrecision',
      (v) => $enumDecode(_$MapLocationPrecisionEnumMap, v),
    ),
    toleranceMeters: $checkedConvert(
      'toleranceMeters',
      (v) => (v as num?)?.toDouble(),
    ),
  );
  return val;
});

Map<String, dynamic> _$GeometryPresentationToJson(
  GeometryPresentation instance,
) => <String, dynamic>{
  'simplified': instance.simplified,
  'originalPrecision':
      _$MapLocationPrecisionEnumMap[instance.originalPrecision]!,
  'toleranceMeters': instance.toleranceMeters,
};

PedestrianDetails _$PedestrianDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('PedestrianDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'sensorId',
          'totalCount',
          'directionACount',
          'directionBCount',
          'granularity',
          'window',
          'locationValidFrom',
          'locationValidTo',
          'locationStatus',
        ],
      );
      final val = PedestrianDetails(
        sensorId: $checkedConvert('sensorId', (v) => v as String),
        totalCount: $checkedConvert('totalCount', (v) => (v as num?)?.toInt()),
        directionACount: $checkedConvert(
          'directionACount',
          (v) => (v as num?)?.toInt(),
        ),
        directionBCount: $checkedConvert(
          'directionBCount',
          (v) => (v as num?)?.toInt(),
        ),
        granularity: $checkedConvert(
          'granularity',
          (v) => $enumDecode(_$PedestrianGranularityEnumMap, v),
        ),
        window: $checkedConvert(
          'window',
          (v) => TimeWindow.fromJson(v as Map<String, dynamic>),
        ),
        locationValidFrom: $checkedConvert(
          'locationValidFrom',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        locationValidTo: $checkedConvert(
          'locationValidTo',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        locationStatus: $checkedConvert(
          'locationStatus',
          (v) => $enumDecode(_$PedestrianLocationStatusEnumMap, v),
        ),
      );
      return val;
    });

Map<String, dynamic> _$PedestrianDetailsToJson(
  PedestrianDetails instance,
) => <String, dynamic>{
  'sensorId': instance.sensorId,
  'totalCount': instance.totalCount,
  'directionACount': instance.directionACount,
  'directionBCount': instance.directionBCount,
  'granularity': _$PedestrianGranularityEnumMap[instance.granularity]!,
  'window': instance.window.toJson(),
  'locationValidFrom': _$JsonConverterToJson<String, DateTime>(
    instance.locationValidFrom,
    const UtcInstantConverter().toJson,
  ),
  'locationValidTo': _$JsonConverterToJson<String, DateTime>(
    instance.locationValidTo,
    const UtcInstantConverter().toJson,
  ),
  'locationStatus': _$PedestrianLocationStatusEnumMap[instance.locationStatus]!,
};

const _$PedestrianGranularityEnumMap = {
  PedestrianGranularity.minute: 'minute',
  PedestrianGranularity.hour: 'hour',
};

const _$PedestrianLocationStatusEnumMap = {
  PedestrianLocationStatus.located: 'located',
  PedestrianLocationStatus.unlocated: 'unlocated',
  PedestrianLocationStatus.ambiguous: 'ambiguous',
  PedestrianLocationStatus.inactive: 'inactive',
};

AnomalyDetails _$AnomalyDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AnomalyDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'resultId',
          'sensorId',
          'observationId',
          'window',
          'baselineDefinitionId',
          'baselineValue',
          'observedValue',
          'delta',
          'direction',
          'eligibility',
          'classification',
        ],
      );
      final val = AnomalyDetails(
        resultId: $checkedConvert('resultId', (v) => v as String),
        sensorId: $checkedConvert('sensorId', (v) => v as String),
        observationId: $checkedConvert('observationId', (v) => v as String?),
        window: $checkedConvert(
          'window',
          (v) => TimeWindow.fromJson(v as Map<String, dynamic>),
        ),
        baselineDefinitionId: $checkedConvert(
          'baselineDefinitionId',
          (v) => v as String?,
        ),
        baselineValue: $checkedConvert(
          'baselineValue',
          (v) => (v as num?)?.toDouble(),
        ),
        observedValue: $checkedConvert(
          'observedValue',
          (v) => (v as num?)?.toDouble(),
        ),
        delta: $checkedConvert('delta', (v) => (v as num?)?.toDouble()),
        direction: $checkedConvert(
          'direction',
          (v) => $enumDecode(_$AnomalyDirectionEnumMap, v),
        ),
        eligibility: $checkedConvert(
          'eligibility',
          (v) => $enumDecode(_$AnomalyEligibilityEnumMap, v),
        ),
        classification: $checkedConvert(
          'classification',
          (v) => $enumDecode(_$AnomalyClassificationEnumMap, v),
        ),
      );
      return val;
    });

Map<String, dynamic> _$AnomalyDetailsToJson(
  AnomalyDetails instance,
) => <String, dynamic>{
  'resultId': instance.resultId,
  'sensorId': instance.sensorId,
  'observationId': instance.observationId,
  'window': instance.window.toJson(),
  'baselineDefinitionId': instance.baselineDefinitionId,
  'baselineValue': instance.baselineValue,
  'observedValue': instance.observedValue,
  'delta': instance.delta,
  'direction': _$AnomalyDirectionEnumMap[instance.direction]!,
  'eligibility': _$AnomalyEligibilityEnumMap[instance.eligibility]!,
  'classification': _$AnomalyClassificationEnumMap[instance.classification]!,
};

const _$AnomalyDirectionEnumMap = {
  AnomalyDirection.higher: 'higher',
  AnomalyDirection.lower: 'lower',
  AnomalyDirection.none: 'none',
  AnomalyDirection.unknown: 'unknown',
};

const _$AnomalyEligibilityEnumMap = {
  AnomalyEligibility.eligible: 'eligible',
  AnomalyEligibility.ineligible: 'ineligible',
  AnomalyEligibility.unknown: 'unknown',
};

const _$AnomalyClassificationEnumMap = {
  AnomalyClassification.anomalous: 'anomalous',
  AnomalyClassification.notAnomalous: 'notAnomalous',
  AnomalyClassification.unclassified: 'unclassified',
};

DisruptionDetails _$DisruptionDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('DisruptionDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'summary',
          'impact',
          'serviceNames',
          'status',
          'extentKind',
        ],
      );
      final val = DisruptionDetails(
        summary: $checkedConvert('summary', (v) => v as String?),
        impact: $checkedConvert('impact', (v) => v as String?),
        serviceNames: $checkedConvert(
          'serviceNames',
          (v) => (v as List<dynamic>).map((e) => e as String).toList(),
        ),
        status: $checkedConvert(
          'status',
          (v) => $enumDecode(_$MapEventStatusEnumMap, v),
        ),
        extentKind: $checkedConvert(
          'extentKind',
          (v) => $enumDecode(_$DisruptionExtentKindEnumMap, v),
        ),
      );
      return val;
    });

Map<String, dynamic> _$DisruptionDetailsToJson(DisruptionDetails instance) =>
    <String, dynamic>{
      'summary': instance.summary,
      'impact': instance.impact,
      'serviceNames': instance.serviceNames,
      'status': _$MapEventStatusEnumMap[instance.status]!,
      'extentKind': _$DisruptionExtentKindEnumMap[instance.extentKind]!,
    };

const _$MapEventStatusEnumMap = {
  MapEventStatus.active: 'active',
  MapEventStatus.planned: 'planned',
  MapEventStatus.cancelled: 'cancelled',
  MapEventStatus.resolved: 'resolved',
  MapEventStatus.unknown: 'unknown',
};

const _$DisruptionExtentKindEnumMap = {
  DisruptionExtentKind.roadSegment: 'roadSegment',
  DisruptionExtentKind.route: 'route',
  DisruptionExtentKind.stop: 'stop',
  DisruptionExtentKind.area: 'area',
  DisruptionExtentKind.unknown: 'unknown',
};

EventDetails _$EventDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('EventDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'summary',
          'venueName',
          'category',
          'startAt',
          'endAt',
          'status',
        ],
      );
      final val = EventDetails(
        summary: $checkedConvert('summary', (v) => v as String?),
        venueName: $checkedConvert('venueName', (v) => v as String?),
        category: $checkedConvert('category', (v) => v as String?),
        startAt: $checkedConvert(
          'startAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        endAt: $checkedConvert(
          'endAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        status: $checkedConvert(
          'status',
          (v) => $enumDecode(_$MapEventStatusEnumMap, v),
        ),
      );
      return val;
    });

Map<String, dynamic> _$EventDetailsToJson(EventDetails instance) =>
    <String, dynamic>{
      'summary': instance.summary,
      'venueName': instance.venueName,
      'category': instance.category,
      'startAt': _$JsonConverterToJson<String, DateTime>(
        instance.startAt,
        const UtcInstantConverter().toJson,
      ),
      'endAt': _$JsonConverterToJson<String, DateTime>(
        instance.endAt,
        const UtcInstantConverter().toJson,
      ),
      'status': _$MapEventStatusEnumMap[instance.status]!,
    };

PlanningDetails _$PlanningDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('PlanningDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['summary', 'projectStatus', 'permitId'],
      );
      final val = PlanningDetails(
        summary: $checkedConvert('summary', (v) => v as String?),
        projectStatus: $checkedConvert('projectStatus', (v) => v as String?),
        permitId: $checkedConvert('permitId', (v) => v as String?),
      );
      return val;
    });

Map<String, dynamic> _$PlanningDetailsToJson(PlanningDetails instance) =>
    <String, dynamic>{
      'summary': instance.summary,
      'projectStatus': instance.projectStatus,
      'permitId': instance.permitId,
    };

BoundaryDetails _$BoundaryDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('BoundaryDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['boundaryId', 'boundaryLevel', 'vintage', 'name'],
      );
      final val = BoundaryDetails(
        boundaryId: $checkedConvert('boundaryId', (v) => v as String),
        boundaryLevel: $checkedConvert(
          'boundaryLevel',
          (v) => $enumDecode(_$MapBoundaryLevelEnumMap, v),
        ),
        vintage: $checkedConvert('vintage', (v) => v as String),
        name: $checkedConvert('name', (v) => v as String),
      );
      return val;
    });

Map<String, dynamic> _$BoundaryDetailsToJson(BoundaryDetails instance) =>
    <String, dynamic>{
      'boundaryId': instance.boundaryId,
      'boundaryLevel': _$MapBoundaryLevelEnumMap[instance.boundaryLevel]!,
      'vintage': instance.vintage,
      'name': instance.name,
    };

ArticleReference _$ArticleReferenceFromJson(Map<String, dynamic> json) =>
    $checkedCreate('ArticleReference', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['articleId', 'url', 'title', 'reportedAt'],
      );
      final val = ArticleReference(
        articleId: $checkedConvert('articleId', (v) => v as String),
        url: $checkedConvert('url', (v) => v as String?),
        title: $checkedConvert('title', (v) => v as String),
        reportedAt: $checkedConvert(
          'reportedAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
      );
      return val;
    });

Map<String, dynamic> _$ArticleReferenceToJson(ArticleReference instance) =>
    <String, dynamic>{
      'articleId': instance.articleId,
      'url': instance.url,
      'title': instance.title,
      'reportedAt': _$JsonConverterToJson<String, DateTime>(
        instance.reportedAt,
        const UtcInstantConverter().toJson,
      ),
    };

NewsDetails _$NewsDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('NewsDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'eventId',
          'summary',
          'articleRefs',
          'localizationEvidence',
          'dedupStatus',
        ],
      );
      final val = NewsDetails(
        eventId: $checkedConvert('eventId', (v) => v as String),
        summary: $checkedConvert('summary', (v) => v as String?),
        articleRefs: $checkedConvert(
          'articleRefs',
          (v) => (v as List<dynamic>)
              .map((e) => ArticleReference.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        localizationEvidence: $checkedConvert(
          'localizationEvidence',
          (v) => v as String?,
        ),
        dedupStatus: $checkedConvert(
          'dedupStatus',
          (v) => $enumDecode(_$NewsDedupStatusEnumMap, v),
        ),
      );
      return val;
    });

Map<String, dynamic> _$NewsDetailsToJson(NewsDetails instance) =>
    <String, dynamic>{
      'eventId': instance.eventId,
      'summary': instance.summary,
      'articleRefs': instance.articleRefs.map((e) => e.toJson()).toList(),
      'localizationEvidence': instance.localizationEvidence,
      'dedupStatus': _$NewsDedupStatusEnumMap[instance.dedupStatus]!,
    };

const _$NewsDedupStatusEnumMap = {
  NewsDedupStatus.confirmedDistinct: 'confirmedDistinct',
  NewsDedupStatus.confirmedDuplicate: 'confirmedDuplicate',
  NewsDedupStatus.unconfirmed: 'unconfirmed',
};

AreaIndicatorDetails _$AreaIndicatorDetailsFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('AreaIndicatorDetails', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const [
      'indicatorId',
      'value',
      'valueState',
      'unit',
      'periodId',
      'periodLabel',
      'propertyType',
      'boundaryId',
      'boundaryVintage',
      'mappingState',
      'definition',
    ],
  );
  final val = AreaIndicatorDetails(
    indicatorId: $checkedConvert('indicatorId', (v) => v as String),
    value: $checkedConvert('value', (v) => (v as num?)?.toDouble()),
    valueState: $checkedConvert(
      'valueState',
      (v) => $enumDecode(_$MapValueStateEnumMap, v),
    ),
    unit: $checkedConvert('unit', (v) => v as String),
    periodId: $checkedConvert('periodId', (v) => v as String),
    periodLabel: $checkedConvert('periodLabel', (v) => v as String),
    propertyType: $checkedConvert('propertyType', (v) => v as String?),
    boundaryId: $checkedConvert('boundaryId', (v) => v as String?),
    boundaryVintage: $checkedConvert('boundaryVintage', (v) => v as String?),
    mappingState: $checkedConvert(
      'mappingState',
      (v) => $enumDecode(_$MapMappingStateEnumMap, v),
    ),
    definition: $checkedConvert('definition', (v) => v as String),
  );
  return val;
});

Map<String, dynamic> _$AreaIndicatorDetailsToJson(
  AreaIndicatorDetails instance,
) => <String, dynamic>{
  'indicatorId': instance.indicatorId,
  'value': instance.value,
  'valueState': _$MapValueStateEnumMap[instance.valueState]!,
  'unit': instance.unit,
  'periodId': instance.periodId,
  'periodLabel': instance.periodLabel,
  'propertyType': instance.propertyType,
  'boundaryId': instance.boundaryId,
  'boundaryVintage': instance.boundaryVintage,
  'mappingState': _$MapMappingStateEnumMap[instance.mappingState]!,
  'definition': instance.definition,
};

const _$MapValueStateEnumMap = {
  MapValueState.observed: 'observed',
  MapValueState.missing: 'missing',
  MapValueState.suppressed: 'suppressed',
};

const _$MapMappingStateEnumMap = {
  MapMappingState.matched: 'matched',
  MapMappingState.missing: 'missing',
  MapMappingState.ambiguous: 'ambiguous',
};

AggregateMetric _$AggregateMetricFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AggregateMetric', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['id', 'label', 'unit', 'value', 'definition'],
      );
      final val = AggregateMetric(
        id: $checkedConvert('id', (v) => v as String),
        label: $checkedConvert('label', (v) => v as String),
        unit: $checkedConvert('unit', (v) => v as String),
        value: $checkedConvert('value', (v) => (v as num?)?.toDouble()),
        definition: $checkedConvert('definition', (v) => v as String),
      );
      return val;
    });

Map<String, dynamic> _$AggregateMetricToJson(AggregateMetric instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'unit': instance.unit,
      'value': instance.value,
      'definition': instance.definition,
    };

ResultRange _$ResultRangeFromJson(Map<String, dynamic> json) =>
    $checkedCreate('ResultRange', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const ['scope', 'returnedCount', 'totalMatching'],
      );
      final val = ResultRange(
        scope: $checkedConvert(
          'scope',
          (v) => $enumDecode(_$MapResultScopeEnumMap, v),
        ),
        returnedCount: $checkedConvert(
          'returnedCount',
          (v) => (v as num).toInt(),
        ),
        totalMatching: $checkedConvert(
          'totalMatching',
          (v) => (v as num?)?.toInt(),
        ),
      );
      return val;
    });

Map<String, dynamic> _$ResultRangeToJson(ResultRange instance) =>
    <String, dynamic>{
      'scope': _$MapResultScopeEnumMap[instance.scope]!,
      'returnedCount': instance.returnedCount,
      'totalMatching': instance.totalMatching,
    };

const _$MapResultScopeEnumMap = {
  MapResultScope.viewport: 'viewport',
  MapResultScope.areaAssociation: 'areaAssociation',
  MapResultScope.sourceJurisdiction: 'sourceJurisdiction',
};

GridDetails _$GridDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('GridDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'cellId',
          'resolution',
          'validSensorCount',
          'observedSensorCount',
          'classifiedSensorCount',
          'unclassifiedSensorCount',
          'anomalousSensorCount',
          'baselineDefinitionId',
          'anomalyRatio',
        ],
      );
      final val = GridDetails(
        cellId: $checkedConvert('cellId', (v) => v as String),
        resolution: $checkedConvert('resolution', (v) => (v as num).toInt()),
        validSensorCount: $checkedConvert(
          'validSensorCount',
          (v) => (v as num).toInt(),
        ),
        observedSensorCount: $checkedConvert(
          'observedSensorCount',
          (v) => (v as num).toInt(),
        ),
        classifiedSensorCount: $checkedConvert(
          'classifiedSensorCount',
          (v) => (v as num).toInt(),
        ),
        unclassifiedSensorCount: $checkedConvert(
          'unclassifiedSensorCount',
          (v) => (v as num).toInt(),
        ),
        anomalousSensorCount: $checkedConvert(
          'anomalousSensorCount',
          (v) => (v as num).toInt(),
        ),
        baselineDefinitionId: $checkedConvert(
          'baselineDefinitionId',
          (v) => v as String?,
        ),
        anomalyRatio: $checkedConvert(
          'anomalyRatio',
          (v) => (v as num?)?.toDouble(),
        ),
      );
      return val;
    });

Map<String, dynamic> _$GridDetailsToJson(GridDetails instance) =>
    <String, dynamic>{
      'cellId': instance.cellId,
      'resolution': instance.resolution,
      'validSensorCount': instance.validSensorCount,
      'observedSensorCount': instance.observedSensorCount,
      'classifiedSensorCount': instance.classifiedSensorCount,
      'unclassifiedSensorCount': instance.unclassifiedSensorCount,
      'anomalousSensorCount': instance.anomalousSensorCount,
      'baselineDefinitionId': instance.baselineDefinitionId,
      'anomalyRatio': instance.anomalyRatio,
    };

AggregateDetails _$AggregateDetailsFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AggregateDetails', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'representation',
          'memberIds',
          'memberCursor',
          'resultRange',
          'metric',
          'window',
          'coverage',
          'bounds',
          'grid',
        ],
      );
      final val = AggregateDetails(
        representation: $checkedConvert(
          'representation',
          (v) => $enumDecode(_$AggregateRepresentationEnumMap, v),
        ),
        memberIds: $checkedConvert(
          'memberIds',
          (v) => (v as List<dynamic>).map((e) => e as String).toList(),
        ),
        memberCursor: $checkedConvert('memberCursor', (v) => v as String?),
        resultRange: $checkedConvert(
          'resultRange',
          (v) => ResultRange.fromJson(v as Map<String, dynamic>),
        ),
        metric: $checkedConvert(
          'metric',
          (v) => AggregateMetric.fromJson(v as Map<String, dynamic>),
        ),
        window: $checkedConvert(
          'window',
          (v) =>
              v == null ? null : TimeWindow.fromJson(v as Map<String, dynamic>),
        ),
        coverage: $checkedConvert(
          'coverage',
          (v) => MapCoverage.fromJson(v as Map<String, dynamic>),
        ),
        bounds: $checkedConvert(
          'bounds',
          (v) => const MapBoundsConverter().fromJson(v as List),
        ),
        grid: $checkedConvert(
          'grid',
          (v) => v == null
              ? null
              : GridDetails.fromJson(v as Map<String, dynamic>),
        ),
      );
      return val;
    });

Map<String, dynamic> _$AggregateDetailsToJson(
  AggregateDetails instance,
) => <String, dynamic>{
  'representation': _$AggregateRepresentationEnumMap[instance.representation]!,
  'memberIds': instance.memberIds,
  'memberCursor': instance.memberCursor,
  'resultRange': instance.resultRange.toJson(),
  'metric': instance.metric.toJson(),
  'window': instance.window?.toJson(),
  'coverage': instance.coverage.toJson(),
  'bounds': const MapBoundsConverter().toJson(instance.bounds),
  'grid': instance.grid?.toJson(),
};

const _$AggregateRepresentationEnumMap = {
  AggregateRepresentation.cluster: 'cluster',
  AggregateRepresentation.coverageGrid: 'coverageGrid',
};

LayerResult _$LayerResultFromJson(Map<String, dynamic> json) =>
    $checkedCreate('LayerResult', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'layerId',
          'state',
          'freshness',
          'completeness',
          'sourceIds',
          'coverage',
          'observedWindow',
          'updatedAt',
          'items',
          'unresolvedCount',
          'nextCursor',
          'totalMatching',
        ],
      );
      final val = LayerResult(
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        state: $checkedConvert(
          'state',
          (v) => $enumDecode(_$MapLayerStateEnumMap, v),
        ),
        freshness: $checkedConvert(
          'freshness',
          (v) => $enumDecode(_$MapFreshnessEnumMap, v),
        ),
        completeness: $checkedConvert(
          'completeness',
          (v) => $enumDecode(_$MapCompletenessEnumMap, v),
        ),
        sourceIds: $checkedConvert(
          'sourceIds',
          (v) => (v as List<dynamic>).map((e) => e as String).toList(),
        ),
        coverage: $checkedConvert(
          'coverage',
          (v) => MapCoverage.fromJson(v as Map<String, dynamic>),
        ),
        observedWindow: $checkedConvert(
          'observedWindow',
          (v) =>
              v == null ? null : TimeWindow.fromJson(v as Map<String, dynamic>),
        ),
        updatedAt: $checkedConvert(
          'updatedAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
        items: $checkedConvert(
          'items',
          (v) => (v as List<dynamic>)
              .map((e) => MapItem.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        unresolvedCount: $checkedConvert(
          'unresolvedCount',
          (v) => (v as num?)?.toInt(),
        ),
        nextCursor: $checkedConvert('nextCursor', (v) => v as String?),
        totalMatching: $checkedConvert(
          'totalMatching',
          (v) => (v as num?)?.toInt(),
        ),
      );
      return val;
    });

Map<String, dynamic> _$LayerResultToJson(LayerResult instance) =>
    <String, dynamic>{
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'state': _$MapLayerStateEnumMap[instance.state]!,
      'freshness': _$MapFreshnessEnumMap[instance.freshness]!,
      'completeness': _$MapCompletenessEnumMap[instance.completeness]!,
      'sourceIds': instance.sourceIds,
      'coverage': instance.coverage.toJson(),
      'observedWindow': instance.observedWindow?.toJson(),
      'updatedAt': _$JsonConverterToJson<String, DateTime>(
        instance.updatedAt,
        const UtcInstantConverter().toJson,
      ),
      'items': instance.items.map((e) => e.toJson()).toList(),
      'unresolvedCount': instance.unresolvedCount,
      'nextCursor': instance.nextCursor,
      'totalMatching': instance.totalMatching,
    };

const _$MapLayerStateEnumMap = {
  MapLayerState.available: 'available',
  MapLayerState.noMatching: 'noMatching',
  MapLayerState.notCovered: 'notCovered',
  MapLayerState.unavailable: 'unavailable',
  MapLayerState.unknown: 'unknown',
};

const _$MapFreshnessEnumMap = {
  MapFreshness.current: 'current',
  MapFreshness.late: 'late',
  MapFreshness.stale: 'stale',
  MapFreshness.versioned: 'versioned',
  MapFreshness.unknown: 'unknown',
};

const _$MapCompletenessEnumMap = {
  MapCompleteness.complete: 'complete',
  MapCompleteness.partial: 'partial',
};

ViewportResponse _$ViewportResponseFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('ViewportResponse', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const [
      'schemaVersion',
      'requestId',
      'snapshotId',
      'generatedAt',
      'mode',
      'dataMode',
      'layers',
    ],
  );
  final val = ViewportResponse(
    schemaVersion: $checkedConvert('schemaVersion', (v) => (v as num).toInt()),
    requestId: $checkedConvert('requestId', (v) => v as String),
    snapshotId: $checkedConvert('snapshotId', (v) => v as String),
    generatedAt: $checkedConvert(
      'generatedAt',
      (v) => const UtcInstantConverter().fromJson(v as String),
    ),
    mode: $checkedConvert('mode', (v) => $enumDecode(_$MapQueryModeEnumMap, v)),
    dataMode: $checkedConvert(
      'dataMode',
      (v) => $enumDecode(_$MapDataModeEnumMap, v),
    ),
    layers: $checkedConvert(
      'layers',
      (v) => (v as List<dynamic>)
          .map((e) => LayerResult.fromJson(e as Map<String, dynamic>))
          .toList(),
    ),
  );
  return val;
});

Map<String, dynamic> _$ViewportResponseToJson(ViewportResponse instance) =>
    <String, dynamic>{
      'schemaVersion': instance.schemaVersion,
      'requestId': instance.requestId,
      'snapshotId': instance.snapshotId,
      'generatedAt': const UtcInstantConverter().toJson(instance.generatedAt),
      'mode': _$MapQueryModeEnumMap[instance.mode]!,
      'dataMode': _$MapDataModeEnumMap[instance.dataMode]!,
      'layers': instance.layers.map((e) => e.toJson()).toList(),
    };

const _$MapDataModeEnumMap = {
  MapDataMode.live: 'live',
  MapDataMode.sample: 'sample',
};

LayerDescriptor _$LayerDescriptorFromJson(Map<String, dynamic> json) =>
    $checkedCreate('LayerDescriptor', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'titleKey',
          'topic',
          'defaultEnabled',
          'supportedModes',
          'sourceIds',
          'availability',
          'freshness',
          'coverage',
          'timeSemantics',
          'updatedAt',
        ],
      );
      final val = LayerDescriptor(
        id: $checkedConvert('id', (v) => $enumDecode(_$MapLayerIdEnumMap, v)),
        titleKey: $checkedConvert('titleKey', (v) => v as String),
        topic: $checkedConvert(
          'topic',
          (v) => $enumDecode(_$MapTopicEnumMap, v),
        ),
        defaultEnabled: $checkedConvert('defaultEnabled', (v) => v as bool),
        supportedModes: $checkedConvert(
          'supportedModes',
          (v) => (v as List<dynamic>)
              .map((e) => $enumDecode(_$MapQueryModeEnumMap, e))
              .toList(),
        ),
        sourceIds: $checkedConvert(
          'sourceIds',
          (v) => (v as List<dynamic>).map((e) => e as String).toList(),
        ),
        availability: $checkedConvert(
          'availability',
          (v) => $enumDecode(_$MapAvailabilityEnumMap, v),
        ),
        freshness: $checkedConvert(
          'freshness',
          (v) => $enumDecode(_$MapFreshnessEnumMap, v),
        ),
        coverage: $checkedConvert(
          'coverage',
          (v) => MapCoverage.fromJson(v as Map<String, dynamic>),
        ),
        timeSemantics: $checkedConvert(
          'timeSemantics',
          (v) => $enumDecode(_$MapTimeSemanticsEnumMap, v),
        ),
        updatedAt: $checkedConvert(
          'updatedAt',
          (v) => _$JsonConverterFromJson<String, DateTime>(
            v,
            const UtcInstantConverter().fromJson,
          ),
        ),
      );
      return val;
    });

Map<String, dynamic> _$LayerDescriptorToJson(LayerDescriptor instance) =>
    <String, dynamic>{
      'id': _$MapLayerIdEnumMap[instance.id]!,
      'titleKey': instance.titleKey,
      'topic': _$MapTopicEnumMap[instance.topic]!,
      'defaultEnabled': instance.defaultEnabled,
      'supportedModes': instance.supportedModes
          .map((e) => _$MapQueryModeEnumMap[e]!)
          .toList(),
      'sourceIds': instance.sourceIds,
      'availability': _$MapAvailabilityEnumMap[instance.availability]!,
      'freshness': _$MapFreshnessEnumMap[instance.freshness]!,
      'coverage': instance.coverage.toJson(),
      'timeSemantics': _$MapTimeSemanticsEnumMap[instance.timeSemantics]!,
      'updatedAt': _$JsonConverterToJson<String, DateTime>(
        instance.updatedAt,
        const UtcInstantConverter().toJson,
      ),
    };

const _$MapTopicEnumMap = {
  MapTopic.cityActivity: 'cityActivity',
  MapTopic.nearbyNews: 'nearbyNews',
  MapTopic.areaComparison: 'areaComparison',
  MapTopic.context: 'context',
};

const _$MapAvailabilityEnumMap = {
  MapAvailability.available: 'available',
  MapAvailability.notCovered: 'notCovered',
  MapAvailability.unavailable: 'unavailable',
  MapAvailability.unknown: 'unknown',
};

const _$MapTimeSemanticsEnumMap = {
  MapTimeSemantics.observationWindow: 'observationWindow',
  MapTimeSemantics.effectiveInterval: 'effectiveInterval',
  MapTimeSemantics.reportedAt: 'reportedAt',
  MapTimeSemantics.statisticalPeriod: 'statisticalPeriod',
  MapTimeSemantics.boundaryVintage: 'boundaryVintage',
};

MapLayerCatalog _$MapLayerCatalogFromJson(Map<String, dynamic> json) =>
    $checkedCreate('MapLayerCatalog', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'schemaVersion',
          'generatedAt',
          'dataMode',
          'serviceBounds',
          'layers',
        ],
      );
      final val = MapLayerCatalog(
        schemaVersion: $checkedConvert(
          'schemaVersion',
          (v) => (v as num).toInt(),
        ),
        generatedAt: $checkedConvert(
          'generatedAt',
          (v) => const UtcInstantConverter().fromJson(v as String),
        ),
        dataMode: $checkedConvert(
          'dataMode',
          (v) => $enumDecode(_$MapDataModeEnumMap, v),
        ),
        serviceBounds: $checkedConvert(
          'serviceBounds',
          (v) => const MapBoundsConverter().fromJson(v as List),
        ),
        layers: $checkedConvert(
          'layers',
          (v) => (v as List<dynamic>)
              .map((e) => LayerDescriptor.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
      );
      return val;
    });

Map<String, dynamic> _$MapLayerCatalogToJson(
  MapLayerCatalog instance,
) => <String, dynamic>{
  'schemaVersion': instance.schemaVersion,
  'generatedAt': const UtcInstantConverter().toJson(instance.generatedAt),
  'dataMode': _$MapDataModeEnumMap[instance.dataMode]!,
  'serviceBounds': const MapBoundsConverter().toJson(instance.serviceBounds),
  'layers': instance.layers.map((e) => e.toJson()).toList(),
};

MapItemResponse _$MapItemResponseFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('MapItemResponse', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const [
      'schemaVersion',
      'requestId',
      'snapshotId',
      'generatedAt',
      'mode',
      'dataMode',
      'item',
    ],
  );
  final val = MapItemResponse(
    schemaVersion: $checkedConvert('schemaVersion', (v) => (v as num).toInt()),
    requestId: $checkedConvert('requestId', (v) => v as String),
    snapshotId: $checkedConvert('snapshotId', (v) => v as String),
    generatedAt: $checkedConvert(
      'generatedAt',
      (v) => const UtcInstantConverter().fromJson(v as String),
    ),
    mode: $checkedConvert('mode', (v) => $enumDecode(_$MapQueryModeEnumMap, v)),
    dataMode: $checkedConvert(
      'dataMode',
      (v) => $enumDecode(_$MapDataModeEnumMap, v),
    ),
    item: $checkedConvert(
      'item',
      (v) => MapItem.fromJson(v as Map<String, dynamic>),
    ),
  );
  return val;
});

Map<String, dynamic> _$MapItemResponseToJson(MapItemResponse instance) =>
    <String, dynamic>{
      'schemaVersion': instance.schemaVersion,
      'requestId': instance.requestId,
      'snapshotId': instance.snapshotId,
      'generatedAt': const UtcInstantConverter().toJson(instance.generatedAt),
      'mode': _$MapQueryModeEnumMap[instance.mode]!,
      'dataMode': _$MapDataModeEnumMap[instance.dataMode]!,
      'item': instance.item.toJson(),
    };

UnlocatedQuery _$UnlocatedQueryFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('UnlocatedQuery', json, ($checkedConvert) {
  $checkKeys(
    json,
    allowedKeys: const [
      'requestId',
      'layers',
      'mode',
      'window',
      'scope',
      'areaFilter',
      'boundaryFilter',
      'pageSize',
      'cursor',
      'snapshotId',
    ],
    requiredKeys: const ['requestId', 'layers', 'mode', 'window', 'scope'],
  );
  final val = UnlocatedQuery(
    requestId: $checkedConvert('requestId', (v) => v as String),
    layers: $checkedConvert(
      'layers',
      (v) => (v as List<dynamic>)
          .map((e) => $enumDecode(_$MapLayerIdEnumMap, e))
          .toList(),
    ),
    mode: $checkedConvert('mode', (v) => $enumDecode(_$MapQueryModeEnumMap, v)),
    window: $checkedConvert(
      'window',
      (v) => TimeWindow.fromJson(v as Map<String, dynamic>),
    ),
    scope: $checkedConvert(
      'scope',
      (v) => UnlocatedScope.fromJson(v as Map<String, dynamic>),
    ),
    areaFilter: $checkedConvert(
      'areaFilter',
      (v) => v == null ? null : AreaFilter.fromJson(v as Map<String, dynamic>),
    ),
    boundaryFilter: $checkedConvert(
      'boundaryFilter',
      (v) =>
          v == null ? null : BoundaryFilter.fromJson(v as Map<String, dynamic>),
    ),
    pageSize: $checkedConvert('pageSize', (v) => (v as num?)?.toInt()),
    cursor: $checkedConvert('cursor', (v) => v as String?),
    snapshotId: $checkedConvert('snapshotId', (v) => v as String?),
  );
  return val;
});

Map<String, dynamic> _$UnlocatedQueryToJson(UnlocatedQuery instance) =>
    <String, dynamic>{
      'requestId': instance.requestId,
      'layers': instance.layers.map((e) => _$MapLayerIdEnumMap[e]!).toList(),
      'mode': _$MapQueryModeEnumMap[instance.mode]!,
      'window': instance.window.toJson(),
      'scope': instance.scope.toJson(),
      'areaFilter': ?instance.areaFilter?.toJson(),
      'boundaryFilter': ?instance.boundaryFilter?.toJson(),
      'pageSize': ?instance.pageSize,
      'cursor': ?instance.cursor,
      'snapshotId': ?instance.snapshotId,
    };

MapItemPage _$MapItemPageFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('MapItemPage', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const [
      'schemaVersion',
      'requestId',
      'snapshotId',
      'generatedAt',
      'mode',
      'dataMode',
      'items',
      'completeness',
      'nextCursor',
      'totalMatching',
      'scope',
    ],
  );
  final val = MapItemPage(
    schemaVersion: $checkedConvert('schemaVersion', (v) => (v as num).toInt()),
    requestId: $checkedConvert('requestId', (v) => v as String),
    snapshotId: $checkedConvert('snapshotId', (v) => v as String),
    generatedAt: $checkedConvert(
      'generatedAt',
      (v) => const UtcInstantConverter().fromJson(v as String),
    ),
    mode: $checkedConvert('mode', (v) => $enumDecode(_$MapQueryModeEnumMap, v)),
    dataMode: $checkedConvert(
      'dataMode',
      (v) => $enumDecode(_$MapDataModeEnumMap, v),
    ),
    items: $checkedConvert(
      'items',
      (v) => (v as List<dynamic>)
          .map((e) => MapItem.fromJson(e as Map<String, dynamic>))
          .toList(),
    ),
    completeness: $checkedConvert(
      'completeness',
      (v) => $enumDecode(_$MapCompletenessEnumMap, v),
    ),
    nextCursor: $checkedConvert('nextCursor', (v) => v as String?),
    totalMatching: $checkedConvert(
      'totalMatching',
      (v) => (v as num?)?.toInt(),
    ),
    scope: $checkedConvert(
      'scope',
      (v) => PageScope.fromJson(v as Map<String, dynamic>),
    ),
  );
  return val;
});

Map<String, dynamic> _$MapItemPageToJson(MapItemPage instance) =>
    <String, dynamic>{
      'schemaVersion': instance.schemaVersion,
      'requestId': instance.requestId,
      'snapshotId': instance.snapshotId,
      'generatedAt': const UtcInstantConverter().toJson(instance.generatedAt),
      'mode': _$MapQueryModeEnumMap[instance.mode]!,
      'dataMode': _$MapDataModeEnumMap[instance.dataMode]!,
      'items': instance.items.map((e) => e.toJson()).toList(),
      'completeness': _$MapCompletenessEnumMap[instance.completeness]!,
      'nextCursor': instance.nextCursor,
      'totalMatching': instance.totalMatching,
      'scope': instance.scope.toJson(),
    };

MapReadContext _$MapReadContextFromJson(Map<String, dynamic> json) =>
    $checkedCreate('MapReadContext', json, ($checkedConvert) {
      $checkKeys(
        json,
        allowedKeys: const ['requestId', 'snapshotId', 'cursor', 'pageSize'],
        requiredKeys: const ['requestId', 'snapshotId'],
      );
      final val = MapReadContext(
        requestId: $checkedConvert('requestId', (v) => v as String),
        snapshotId: $checkedConvert('snapshotId', (v) => v as String),
        cursor: $checkedConvert('cursor', (v) => v as String?),
        pageSize: $checkedConvert('pageSize', (v) => (v as num?)?.toInt()),
      );
      return val;
    });

Map<String, dynamic> _$MapReadContextToJson(MapReadContext instance) =>
    <String, dynamic>{
      'requestId': instance.requestId,
      'snapshotId': instance.snapshotId,
      'cursor': ?instance.cursor,
      'pageSize': ?instance.pageSize,
    };

AggregateMembersQuery _$AggregateMembersQueryFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('AggregateMembersQuery', json, ($checkedConvert) {
  $checkKeys(
    json,
    allowedKeys: const ['requestId', 'snapshotId', 'cursor', 'pageSize'],
    requiredKeys: const ['requestId', 'snapshotId'],
  );
  final val = AggregateMembersQuery(
    requestId: $checkedConvert('requestId', (v) => v as String),
    snapshotId: $checkedConvert('snapshotId', (v) => v as String),
    cursor: $checkedConvert('cursor', (v) => v as String?),
    pageSize: $checkedConvert('pageSize', (v) => (v as num?)?.toInt()),
  );
  return val;
});

Map<String, dynamic> _$AggregateMembersQueryToJson(
  AggregateMembersQuery instance,
) => <String, dynamic>{
  'requestId': instance.requestId,
  'snapshotId': instance.snapshotId,
  'cursor': ?instance.cursor,
  'pageSize': ?instance.pageSize,
};

GeoJsonPoint _$GeoJsonPointFromJson(Map<String, dynamic> json) =>
    $checkedCreate('GeoJsonPoint', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['coordinates']);
      final val = GeoJsonPoint(
        coordinates: $checkedConvert(
          'coordinates',
          (v) =>
              (v as List<dynamic>).map((e) => (e as num).toDouble()).toList(),
        ),
        $type: $checkedConvert('type', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'type'});

Map<String, dynamic> _$GeoJsonPointToJson(GeoJsonPoint instance) =>
    <String, dynamic>{
      'coordinates': instance.coordinates,
      'type': instance.$type,
    };

GeoJsonMultiPoint _$GeoJsonMultiPointFromJson(Map<String, dynamic> json) =>
    $checkedCreate('GeoJsonMultiPoint', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['coordinates']);
      final val = GeoJsonMultiPoint(
        coordinates: $checkedConvert(
          'coordinates',
          (v) => (v as List<dynamic>)
              .map(
                (e) => (e as List<dynamic>)
                    .map((e) => (e as num).toDouble())
                    .toList(),
              )
              .toList(),
        ),
        $type: $checkedConvert('type', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'type'});

Map<String, dynamic> _$GeoJsonMultiPointToJson(GeoJsonMultiPoint instance) =>
    <String, dynamic>{
      'coordinates': instance.coordinates,
      'type': instance.$type,
    };

GeoJsonLineString _$GeoJsonLineStringFromJson(Map<String, dynamic> json) =>
    $checkedCreate('GeoJsonLineString', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['coordinates']);
      final val = GeoJsonLineString(
        coordinates: $checkedConvert(
          'coordinates',
          (v) => (v as List<dynamic>)
              .map(
                (e) => (e as List<dynamic>)
                    .map((e) => (e as num).toDouble())
                    .toList(),
              )
              .toList(),
        ),
        $type: $checkedConvert('type', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'type'});

Map<String, dynamic> _$GeoJsonLineStringToJson(GeoJsonLineString instance) =>
    <String, dynamic>{
      'coordinates': instance.coordinates,
      'type': instance.$type,
    };

GeoJsonMultiLineString _$GeoJsonMultiLineStringFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('GeoJsonMultiLineString', json, ($checkedConvert) {
  $checkKeys(json, requiredKeys: const ['coordinates']);
  final val = GeoJsonMultiLineString(
    coordinates: $checkedConvert(
      'coordinates',
      (v) => (v as List<dynamic>)
          .map(
            (e) => (e as List<dynamic>)
                .map(
                  (e) => (e as List<dynamic>)
                      .map((e) => (e as num).toDouble())
                      .toList(),
                )
                .toList(),
          )
          .toList(),
    ),
    $type: $checkedConvert('type', (v) => v as String?),
  );
  return val;
}, fieldKeyMap: const {r'$type': 'type'});

Map<String, dynamic> _$GeoJsonMultiLineStringToJson(
  GeoJsonMultiLineString instance,
) => <String, dynamic>{
  'coordinates': instance.coordinates,
  'type': instance.$type,
};

GeoJsonPolygon _$GeoJsonPolygonFromJson(Map<String, dynamic> json) =>
    $checkedCreate('GeoJsonPolygon', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['coordinates']);
      final val = GeoJsonPolygon(
        coordinates: $checkedConvert(
          'coordinates',
          (v) => (v as List<dynamic>)
              .map(
                (e) => (e as List<dynamic>)
                    .map(
                      (e) => (e as List<dynamic>)
                          .map((e) => (e as num).toDouble())
                          .toList(),
                    )
                    .toList(),
              )
              .toList(),
        ),
        $type: $checkedConvert('type', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'type'});

Map<String, dynamic> _$GeoJsonPolygonToJson(GeoJsonPolygon instance) =>
    <String, dynamic>{
      'coordinates': instance.coordinates,
      'type': instance.$type,
    };

GeoJsonMultiPolygon _$GeoJsonMultiPolygonFromJson(Map<String, dynamic> json) =>
    $checkedCreate('GeoJsonMultiPolygon', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['coordinates']);
      final val = GeoJsonMultiPolygon(
        coordinates: $checkedConvert(
          'coordinates',
          (v) => (v as List<dynamic>)
              .map(
                (e) => (e as List<dynamic>)
                    .map(
                      (e) => (e as List<dynamic>)
                          .map(
                            (e) => (e as List<dynamic>)
                                .map((e) => (e as num).toDouble())
                                .toList(),
                          )
                          .toList(),
                    )
                    .toList(),
              )
              .toList(),
        ),
        $type: $checkedConvert('type', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'type'});

Map<String, dynamic> _$GeoJsonMultiPolygonToJson(
  GeoJsonMultiPolygon instance,
) => <String, dynamic>{
  'coordinates': instance.coordinates,
  'type': instance.$type,
};

UnlocatedPageScope _$UnlocatedPageScopeFromJson(Map<String, dynamic> json) =>
    $checkedCreate('UnlocatedPageScope', json, ($checkedConvert) {
      $checkKeys(json, requiredKeys: const ['areaRefs', 'sourceJurisdiction']);
      final val = UnlocatedPageScope(
        areaRefs: $checkedConvert(
          'areaRefs',
          (v) => (v as List<dynamic>).map((e) => e as String).toList(),
        ),
        sourceJurisdiction: $checkedConvert(
          'sourceJurisdiction',
          (v) => v as String?,
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$UnlocatedPageScopeToJson(UnlocatedPageScope instance) =>
    <String, dynamic>{
      'areaRefs': instance.areaRefs,
      'sourceJurisdiction': instance.sourceJurisdiction,
      'kind': instance.$type,
    };

AggregateMembersPageScope _$AggregateMembersPageScopeFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('AggregateMembersPageScope', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const ['aggregateId', 'bounds', 'window', 'unit'],
  );
  final val = AggregateMembersPageScope(
    aggregateId: $checkedConvert('aggregateId', (v) => v as String),
    bounds: $checkedConvert(
      'bounds',
      (v) => const MapBoundsConverter().fromJson(v as List),
    ),
    window: $checkedConvert(
      'window',
      (v) => v == null ? null : TimeWindow.fromJson(v as Map<String, dynamic>),
    ),
    unit: $checkedConvert('unit', (v) => v as String),
    $type: $checkedConvert('kind', (v) => v as String?),
  );
  return val;
}, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AggregateMembersPageScopeToJson(
  AggregateMembersPageScope instance,
) => <String, dynamic>{
  'aggregateId': instance.aggregateId,
  'bounds': const MapBoundsConverter().toJson(instance.bounds),
  'window': instance.window?.toJson(),
  'unit': instance.unit,
  'kind': instance.$type,
};

PedestrianMapItem _$PedestrianMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('PedestrianMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = PedestrianMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => PedestrianDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$PedestrianMapItemToJson(PedestrianMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };

const _$MapAssertionKindEnumMap = {
  MapAssertionKind.observation: 'observation',
  MapAssertionKind.report: 'report',
  MapAssertionKind.plan: 'plan',
  MapAssertionKind.prediction: 'prediction',
};

const _$MapLifecycleEnumMap = {
  MapLifecycle.active: 'active',
  MapLifecycle.planned: 'planned',
  MapLifecycle.cancelled: 'cancelled',
  MapLifecycle.resolved: 'resolved',
  MapLifecycle.withdrawn: 'withdrawn',
};

AnomalyMapItem _$AnomalyMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AnomalyMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = AnomalyMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => AnomalyDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AnomalyMapItemToJson(AnomalyMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };

DisruptionMapItem _$DisruptionMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('DisruptionMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = DisruptionMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => DisruptionDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$DisruptionMapItemToJson(DisruptionMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };

EventMapItem _$EventMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('EventMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = EventMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => EventDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$EventMapItemToJson(EventMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };

PlanningMapItem _$PlanningMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('PlanningMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = PlanningMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => PlanningDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$PlanningMapItemToJson(PlanningMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };

BoundaryMapItem _$BoundaryMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('BoundaryMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = BoundaryMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => BoundaryDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$BoundaryMapItemToJson(BoundaryMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };

NewsMapItem _$NewsMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('NewsMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = NewsMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => NewsDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$NewsMapItemToJson(NewsMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };

AreaIndicatorMapItem _$AreaIndicatorMapItemFromJson(
  Map<String, dynamic> json,
) => $checkedCreate('AreaIndicatorMapItem', json, ($checkedConvert) {
  $checkKeys(
    json,
    requiredKeys: const [
      'id',
      'versionId',
      'layerId',
      'title',
      'geometry',
      'location',
      'assertionKind',
      'lifecycle',
      'time',
      'sources',
      'details',
    ],
  );
  final val = AreaIndicatorMapItem(
    id: $checkedConvert('id', (v) => v as String),
    versionId: $checkedConvert('versionId', (v) => v as String),
    layerId: $checkedConvert(
      'layerId',
      (v) => $enumDecode(_$MapLayerIdEnumMap, v),
    ),
    title: $checkedConvert('title', (v) => v as String),
    geometry: $checkedConvert(
      'geometry',
      (v) => v == null
          ? null
          : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
    ),
    location: $checkedConvert(
      'location',
      (v) => MapLocation.fromJson(v as Map<String, dynamic>),
    ),
    assertionKind: $checkedConvert(
      'assertionKind',
      (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
    ),
    lifecycle: $checkedConvert(
      'lifecycle',
      (v) => $enumDecode(_$MapLifecycleEnumMap, v),
    ),
    time: $checkedConvert(
      'time',
      (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
    ),
    sources: $checkedConvert(
      'sources',
      (v) => (v as List<dynamic>)
          .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
          .toList(),
    ),
    details: $checkedConvert(
      'details',
      (v) => AreaIndicatorDetails.fromJson(v as Map<String, dynamic>),
    ),
    geometryPresentation: $checkedConvert(
      'geometryPresentation',
      (v) => v == null
          ? null
          : GeometryPresentation.fromJson(v as Map<String, dynamic>),
    ),
    $type: $checkedConvert('kind', (v) => v as String?),
  );
  return val;
}, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AreaIndicatorMapItemToJson(
  AreaIndicatorMapItem instance,
) => <String, dynamic>{
  'id': instance.id,
  'versionId': instance.versionId,
  'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
  'title': instance.title,
  'geometry': instance.geometry?.toJson(),
  'location': instance.location.toJson(),
  'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
  'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
  'time': instance.time.toJson(),
  'sources': instance.sources.map((e) => e.toJson()).toList(),
  'details': instance.details.toJson(),
  'geometryPresentation': ?instance.geometryPresentation?.toJson(),
  'kind': instance.$type,
};

AggregateMapItem _$AggregateMapItemFromJson(Map<String, dynamic> json) =>
    $checkedCreate('AggregateMapItem', json, ($checkedConvert) {
      $checkKeys(
        json,
        requiredKeys: const [
          'id',
          'versionId',
          'layerId',
          'title',
          'geometry',
          'location',
          'assertionKind',
          'lifecycle',
          'time',
          'sources',
          'details',
        ],
      );
      final val = AggregateMapItem(
        id: $checkedConvert('id', (v) => v as String),
        versionId: $checkedConvert('versionId', (v) => v as String),
        layerId: $checkedConvert(
          'layerId',
          (v) => $enumDecode(_$MapLayerIdEnumMap, v),
        ),
        title: $checkedConvert('title', (v) => v as String),
        geometry: $checkedConvert(
          'geometry',
          (v) => v == null
              ? null
              : GeoJsonGeometry.fromJson(v as Map<String, dynamic>),
        ),
        location: $checkedConvert(
          'location',
          (v) => MapLocation.fromJson(v as Map<String, dynamic>),
        ),
        assertionKind: $checkedConvert(
          'assertionKind',
          (v) => $enumDecode(_$MapAssertionKindEnumMap, v),
        ),
        lifecycle: $checkedConvert(
          'lifecycle',
          (v) => $enumDecode(_$MapLifecycleEnumMap, v),
        ),
        time: $checkedConvert(
          'time',
          (v) => MapItemTime.fromJson(v as Map<String, dynamic>),
        ),
        sources: $checkedConvert(
          'sources',
          (v) => (v as List<dynamic>)
              .map((e) => MapSource.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        details: $checkedConvert(
          'details',
          (v) => AggregateDetails.fromJson(v as Map<String, dynamic>),
        ),
        geometryPresentation: $checkedConvert(
          'geometryPresentation',
          (v) => v == null
              ? null
              : GeometryPresentation.fromJson(v as Map<String, dynamic>),
        ),
        $type: $checkedConvert('kind', (v) => v as String?),
      );
      return val;
    }, fieldKeyMap: const {r'$type': 'kind'});

Map<String, dynamic> _$AggregateMapItemToJson(AggregateMapItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'versionId': instance.versionId,
      'layerId': _$MapLayerIdEnumMap[instance.layerId]!,
      'title': instance.title,
      'geometry': instance.geometry?.toJson(),
      'location': instance.location.toJson(),
      'assertionKind': _$MapAssertionKindEnumMap[instance.assertionKind]!,
      'lifecycle': _$MapLifecycleEnumMap[instance.lifecycle]!,
      'time': instance.time.toJson(),
      'sources': instance.sources.map((e) => e.toJson()).toList(),
      'details': instance.details.toJson(),
      'geometryPresentation': ?instance.geometryPresentation?.toJson(),
      'kind': instance.$type,
    };
