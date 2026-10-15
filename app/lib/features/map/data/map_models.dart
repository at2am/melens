// Freezed forwards the factory annotations to its generated concrete classes.
// ignore_for_file: invalid_annotation_target

import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/config/map_data_mode.dart';

export '../../../core/config/map_data_mode.dart';

part 'map_models.freezed.dart';
part 'map_models.g.dart';

enum MapQueryMode { current, historical }

enum MapLayerId {
  pedestrian,
  anomaly,
  disruption,
  event,
  planning,
  boundary,
  news,
  rent,
  census,

  /// Live on-street parking sensors (UC-15), a v1 layer since 2026-10-15.
  parking,
}

enum MapLayerState { available, noMatching, notCovered, unavailable, unknown }

enum MapFreshness { current, late, stale, versioned, unknown }

enum MapCompleteness { complete, partial }

enum MapCoverageState { verified, notCovered, unknown }

enum MapLocationPrecision { point, line, area, unlocated }

enum MapLocationRole {
  eventSite,
  sensor,
  affectedExtent,
  statisticalArea,
  areaAssociation,
  mention,
  unknown,
}

enum MapAssertionKind { observation, report, plan, prediction }

enum MapLifecycle { active, planned, cancelled, resolved, withdrawn }

enum MapTopic { cityActivity, nearbyNews, areaComparison, context }

enum MapTimeSemantics {
  observationWindow,
  effectiveInterval,
  reportedAt,
  statisticalPeriod,
  boundaryVintage,
}

enum MapAvailability { available, notCovered, unavailable, unknown }

enum MapBoundaryLevel {
  @JsonValue('GCCSA')
  gccsa,
  @JsonValue('LGA')
  lga,
  @JsonValue('SA2')
  sa2,
  @JsonValue('STE')
  ste,
  @JsonValue('CLUE_BLOCK')
  clueBlock,
  @JsonValue('MUNICIPAL')
  municipal,
}

enum PedestrianGranularity { minute, hour }

enum PedestrianLocationStatus { located, unlocated, ambiguous, inactive }

enum AnomalyDirection { higher, lower, none, unknown }

enum AnomalyEligibility { eligible, ineligible, unknown }

enum AnomalyClassification { anomalous, notAnomalous, unclassified }

/// What the map may draw for a parking sensor. `noData` whenever the reading is
/// not current, never a guess.
enum ParkingState { occupied, vacant, noData }

enum ParkingNoDataReason {
  notReporting,
  publicHoliday,
  holidayUnknown,
  noStatus,
}

enum ParkingReading { current, late, stale, unknown }

enum MapEventStatus { active, planned, cancelled, resolved, unknown }

enum DisruptionExtentKind { roadSegment, route, stop, area, unknown }

enum NewsDedupStatus { confirmedDistinct, confirmedDuplicate, unconfirmed }

enum AggregateRepresentation { cluster, coverageGrid }

enum MapResultScope { viewport, areaAssociation, sourceJurisdiction }

enum MapValueState { observed, missing, suppressed }

enum MapMappingState { matched, missing, ambiguous }

enum MapItemKind {
  pedestrian,
  anomaly,
  disruption,
  event,
  planning,
  parking,
  boundary,
  news,
  areaIndicator,
  aggregate,
}

/// Instants on the map boundary are UTC; source clock text is separate.
class UtcInstantConverter implements JsonConverter<DateTime, String> {
  const UtcInstantConverter();

  @override
  DateTime fromJson(String json) {
    final match = RegExp(
      r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$',
    ).firstMatch(json);
    final instant = DateTime.tryParse(json);
    if (match == null || instant == null || !instant.isUtc) {
      throw const FormatException('Expected a UTC ISO 8601 instant.');
    }
    final components = <int>[
      instant.year,
      instant.month,
      instant.day,
      instant.hour,
      instant.minute,
      instant.second,
    ];
    for (var index = 0; index < components.length; index++) {
      if (components[index] != int.parse(match.group(index + 1)!)) {
        throw const FormatException('UTC instant contains an invalid date.');
      }
    }
    return instant;
  }

  @override
  String toJson(DateTime object) {
    if (!object.isUtc) {
      throw const FormatException('Map instants must be UTC.');
    }
    return object.toIso8601String();
  }
}

void _require(bool condition, String message) {
  if (!condition) throw FormatException(message);
}

void _nonempty(String value, String field) {
  _require(value.trim().isNotEmpty, '$field must not be empty.');
}

void _nonnegative(int? value, String field) {
  _require(value == null || value >= 0, '$field must be nonnegative or null.');
}

final class MapBounds {
  const MapBounds({
    required this.west,
    required this.south,
    required this.east,
    required this.north,
  });

  final double west;
  final double south;
  final double east;
  final double north;

  List<double> toJson() => [west, south, east, north];

  bool contains(double longitude, double latitude) =>
      longitude >= west &&
      longitude <= east &&
      latitude >= south &&
      latitude <= north;
}

class MapBoundsConverter implements JsonConverter<MapBounds, List<dynamic>> {
  const MapBoundsConverter();

  @override
  MapBounds fromJson(List<dynamic> json) {
    _require(
      json.length == 4 && json.every((value) => value is num),
      'bbox must contain west, south, east and north.',
    );
    final values = json.cast<num>().map((value) => value.toDouble()).toList();
    final bounds = MapBounds(
      west: values[0],
      south: values[1],
      east: values[2],
      north: values[3],
    );
    _validateBounds(bounds);
    return bounds;
  }

  @override
  List<double> toJson(MapBounds object) {
    _validateBounds(object);
    return object.toJson();
  }
}

sealed class UnlocatedScope {
  const UnlocatedScope();

  const factory UnlocatedScope.areaRefs(List<String> areaRefs) = AreaRefsScope;
  const factory UnlocatedScope.sourceJurisdiction(String sourceJurisdiction) =
      SourceJurisdictionScope;

  factory UnlocatedScope.fromJson(Map<String, dynamic> json) {
    if (json.keys.length == 1 && json['areaRefs'] is List) {
      final refs = (json['areaRefs'] as List<dynamic>).cast<String>();
      _require(refs.isNotEmpty, 'Unlocated area scope must not be empty.');
      _uniqueIds(refs, 'areaRefs');
      return UnlocatedScope.areaRefs(List.unmodifiable(refs));
    }
    if (json.keys.length == 1 && json['sourceJurisdiction'] is String) {
      final jurisdiction = json['sourceJurisdiction'] as String;
      _nonempty(jurisdiction, 'sourceJurisdiction');
      return UnlocatedScope.sourceJurisdiction(jurisdiction);
    }
    throw const FormatException('Select one explicit unlocated scope.');
  }

  Map<String, dynamic> toJson() => switch (this) {
    AreaRefsScope(:final areaRefs) => {'areaRefs': areaRefs},
    SourceJurisdictionScope(:final sourceJurisdiction) => {
      'sourceJurisdiction': sourceJurisdiction,
    },
  };
}

final class AreaRefsScope extends UnlocatedScope {
  const AreaRefsScope(this.areaRefs);
  final List<String> areaRefs;
}

final class SourceJurisdictionScope extends UnlocatedScope {
  const SourceJurisdictionScope(this.sourceJurisdiction);
  final String sourceJurisdiction;
}

sealed class MapItemDetails {
  const MapItemDetails();
}

@JsonSerializable(checked: true, explicitToJson: true)
final class TimeWindow {
  const TimeWindow({required this.from, required this.to});

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime from;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime to;

  factory TimeWindow.fromJson(Map<String, dynamic> json) {
    final value = _$TimeWindowFromJson(json);
    _validateWindow(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$TimeWindowToJson(this);
}

@JsonSerializable(
  checked: true,
  explicitToJson: true,
  disallowUnrecognizedKeys: true,
)
final class AreaFilter {
  const AreaFilter({
    required this.indicatorId,
    required this.periodId,
    required this.propertyType,
    required this.boundaryVintage,
    required this.periodStart,
    required this.periodEnd,
  });

  @JsonKey(required: true)
  final String indicatorId;

  @JsonKey(required: true)
  final String periodId;

  @JsonKey(required: true)
  final String periodStart;

  @JsonKey(required: true)
  final String periodEnd;

  @JsonKey(required: true)
  final String? propertyType;

  @JsonKey(required: true)
  final String boundaryVintage;

  factory AreaFilter.fromJson(Map<String, dynamic> json) {
    final value = _$AreaFilterFromJson(json);
    _validateAreaFilter(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$AreaFilterToJson(this);
}

@JsonSerializable(
  checked: true,
  explicitToJson: true,
  disallowUnrecognizedKeys: true,
)
final class BoundaryFilter {
  const BoundaryFilter({required this.level, required this.vintage});

  @JsonKey(required: true)
  final MapBoundaryLevel level;

  @JsonKey(required: true)
  final String vintage;

  factory BoundaryFilter.fromJson(Map<String, dynamic> json) {
    final value = _$BoundaryFilterFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$BoundaryFilterToJson(this);
}

@JsonSerializable(
  checked: true,
  explicitToJson: true,
  disallowUnrecognizedKeys: true,
)
final class ViewportQuery {
  const ViewportQuery({
    required this.requestId,
    required this.bbox,
    required this.zoom,
    required this.layers,
    required this.mode,
    required this.window,
    this.areaFilter,
    this.boundaryFilter,
    this.pageSize,
    this.cursor,
    this.snapshotId,
  });

  @JsonKey(required: true)
  final String requestId;

  @JsonKey(required: true)
  @MapBoundsConverter()
  final MapBounds bbox;

  @JsonKey(required: true)
  final double zoom;

  @JsonKey(required: true)
  final List<MapLayerId> layers;

  @JsonKey(required: true)
  final MapQueryMode mode;

  @JsonKey(required: true)
  final TimeWindow window;

  @JsonKey(includeIfNull: false)
  final AreaFilter? areaFilter;

  @JsonKey(includeIfNull: false)
  final BoundaryFilter? boundaryFilter;

  @JsonKey(includeIfNull: false)
  final int? pageSize;

  @JsonKey(includeIfNull: false)
  final String? cursor;

  @JsonKey(includeIfNull: false)
  final String? snapshotId;

  factory ViewportQuery.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['pageSize']);
    final value = _$ViewportQueryFromJson(json);
    validateViewportQuery(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$ViewportQueryToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class MapCoverage {
  const MapCoverage({
    required this.state,
    required this.areaRefs,
    required this.window,
    required this.evidenceSourceIds,
  });

  @JsonKey(required: true)
  final MapCoverageState state;

  @JsonKey(required: true)
  final List<String> areaRefs;

  @JsonKey(required: true)
  final TimeWindow? window;

  @JsonKey(required: true)
  final List<String> evidenceSourceIds;

  factory MapCoverage.fromJson(Map<String, dynamic> json) {
    final value = _$MapCoverageFromJson(json);
    _validateCoverage(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapCoverageToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class MapSource {
  const MapSource({
    required this.sourceId,
    required this.url,
    required this.attribution,
    required this.versionRef,
  });

  @JsonKey(required: true)
  final String sourceId;

  @JsonKey(required: true)
  final String? url;

  @JsonKey(required: true)
  final String attribution;

  @JsonKey(required: true)
  final String? versionRef;

  factory MapSource.fromJson(Map<String, dynamic> json) {
    final value = _$MapSourceFromJson(json);
    _validateSource(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapSourceToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class MapLocation {
  const MapLocation({
    required this.precision,
    required this.role,
    required this.evidence,
  });

  @JsonKey(required: true)
  final MapLocationPrecision precision;

  @JsonKey(required: true)
  final MapLocationRole role;

  @JsonKey(required: true)
  final String? evidence;

  factory MapLocation.fromJson(Map<String, dynamic> json) {
    final value = _$MapLocationFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapLocationToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class MapItemTime {
  const MapItemTime({
    required this.observedAt,
    required this.reportedAt,
    required this.validFrom,
    required this.validTo,
    required this.periodLabel,
    required this.fetchedAt,
    required this.sourceTimeText,
    required this.sourceTimezone,
  });

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? observedAt;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? reportedAt;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? validFrom;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? validTo;

  @JsonKey(required: true)
  final String? periodLabel;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? fetchedAt;

  @JsonKey(required: true)
  final String? sourceTimeText;

  @JsonKey(required: true)
  final String? sourceTimezone;

  factory MapItemTime.fromJson(Map<String, dynamic> json) {
    final value = _$MapItemTimeFromJson(json);
    _validateItemTime(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapItemTimeToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class GeometryPresentation {
  const GeometryPresentation({
    required this.simplified,
    required this.originalPrecision,
    required this.toleranceMeters,
  });

  @JsonKey(required: true)
  final bool simplified;

  @JsonKey(required: true)
  final MapLocationPrecision originalPrecision;

  @JsonKey(required: true)
  final double? toleranceMeters;

  factory GeometryPresentation.fromJson(Map<String, dynamic> json) {
    final value = _$GeometryPresentationFromJson(json);
    _validateGeometryPresentation(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$GeometryPresentationToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class PedestrianDetails extends MapItemDetails {
  const PedestrianDetails({
    required this.sensorId,
    required this.totalCount,
    required this.directionACount,
    required this.directionBCount,
    required this.granularity,
    required this.window,
    required this.locationValidFrom,
    required this.locationValidTo,
    required this.locationStatus,
  });

  @JsonKey(required: true)
  final String sensorId;

  @JsonKey(required: true)
  final int? totalCount;

  @JsonKey(required: true)
  final int? directionACount;

  @JsonKey(required: true)
  final int? directionBCount;

  @JsonKey(required: true)
  final PedestrianGranularity granularity;

  @JsonKey(required: true)
  final TimeWindow window;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? locationValidFrom;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? locationValidTo;

  @JsonKey(required: true)
  final PedestrianLocationStatus locationStatus;

  factory PedestrianDetails.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, [
      'totalCount',
      'directionACount',
      'directionBCount',
    ]);
    final value = _$PedestrianDetailsFromJson(json);
    _validatePedestrian(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$PedestrianDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class AnomalyDetails extends MapItemDetails {
  const AnomalyDetails({
    required this.resultId,
    required this.sensorId,
    required this.observationId,
    required this.window,
    required this.baselineDefinitionId,
    required this.baselineValue,
    required this.observedValue,
    required this.delta,
    required this.direction,
    required this.eligibility,
    required this.classification,
  });

  @JsonKey(required: true)
  final String resultId;

  @JsonKey(required: true)
  final String sensorId;

  @JsonKey(required: true)
  final String? observationId;

  @JsonKey(required: true)
  final TimeWindow window;

  @JsonKey(required: true)
  final String? baselineDefinitionId;

  @JsonKey(required: true)
  final double? baselineValue;

  @JsonKey(required: true)
  final double? observedValue;

  @JsonKey(required: true)
  final double? delta;

  @JsonKey(required: true)
  final AnomalyDirection direction;

  @JsonKey(required: true)
  final AnomalyEligibility eligibility;

  @JsonKey(required: true)
  final AnomalyClassification classification;

  factory AnomalyDetails.fromJson(Map<String, dynamic> json) {
    final value = _$AnomalyDetailsFromJson(json);
    _validateAnomaly(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$AnomalyDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class DisruptionDetails extends MapItemDetails {
  const DisruptionDetails({
    required this.summary,
    required this.impact,
    required this.serviceNames,
    required this.status,
    required this.extentKind,
  });

  @JsonKey(required: true)
  final String? summary;

  @JsonKey(required: true)
  final String? impact;

  @JsonKey(required: true)
  final List<String> serviceNames;

  @JsonKey(required: true)
  final MapEventStatus status;

  @JsonKey(required: true)
  final DisruptionExtentKind extentKind;

  factory DisruptionDetails.fromJson(Map<String, dynamic> json) {
    final value = _$DisruptionDetailsFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$DisruptionDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class EventDetails extends MapItemDetails {
  const EventDetails({
    required this.summary,
    required this.venueName,
    required this.category,
    required this.startAt,
    required this.endAt,
    required this.status,
  });

  @JsonKey(required: true)
  final String? summary;

  @JsonKey(required: true)
  final String? venueName;

  @JsonKey(required: true)
  final String? category;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? startAt;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? endAt;

  @JsonKey(required: true)
  final MapEventStatus status;

  factory EventDetails.fromJson(Map<String, dynamic> json) {
    final value = _$EventDetailsFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$EventDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class PlanningDetails extends MapItemDetails {
  const PlanningDetails({
    required this.summary,
    required this.projectStatus,
    required this.permitId,
  });

  @JsonKey(required: true)
  final String? summary;

  @JsonKey(required: true)
  final String? projectStatus;

  @JsonKey(required: true)
  final String? permitId;

  factory PlanningDetails.fromJson(Map<String, dynamic> json) {
    final value = _$PlanningDetailsFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$PlanningDetailsToJson(this);
}

/// A live on-street parking sensor (UC-15). The feed proves only whether a car
/// is on the bay: it never proves that parking there is legal, so
/// [legalParking] is always `unknown`, and construction can leave a blocked bay
/// looking vacant ([mayBeObstructed]).
@JsonSerializable(checked: true, explicitToJson: true)
final class ParkingDetails extends MapItemDetails {
  const ParkingDetails({
    required this.sensorId,
    required this.state,
    required this.noDataReason,
    required this.reading,
    required this.lastReportedAt,
    required this.statusChangedAt,
    required this.zoneNumber,
    required this.legalParking,
    required this.mayBeObstructed,
  });

  @JsonKey(required: true)
  final String sensorId;

  @JsonKey(required: true)
  final ParkingState state;

  @JsonKey(required: true)
  final ParkingNoDataReason? noDataReason;

  @JsonKey(required: true)
  final ParkingReading reading;

  /// The sensor's own last report. A sensor that stopped reporting keeps an
  /// old value here.
  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? lastReportedAt;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? statusChangedAt;

  @JsonKey(required: true)
  final int? zoneNumber;

  @JsonKey(required: true)
  final String legalParking;

  @JsonKey(required: true)
  final bool mayBeObstructed;

  factory ParkingDetails.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['zoneNumber']);
    final value = _$ParkingDetailsFromJson(json);
    _validateParking(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$ParkingDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class BoundaryDetails extends MapItemDetails {
  const BoundaryDetails({
    required this.boundaryId,
    required this.boundaryLevel,
    required this.vintage,
    required this.name,
  });

  @JsonKey(required: true)
  final String boundaryId;

  @JsonKey(required: true)
  final MapBoundaryLevel boundaryLevel;

  @JsonKey(required: true)
  final String vintage;

  @JsonKey(required: true)
  final String name;

  factory BoundaryDetails.fromJson(Map<String, dynamic> json) {
    final value = _$BoundaryDetailsFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$BoundaryDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class ArticleReference {
  const ArticleReference({
    required this.articleId,
    required this.url,
    required this.title,
    required this.reportedAt,
  });

  @JsonKey(required: true)
  final String articleId;

  @JsonKey(required: true)
  final String? url;

  @JsonKey(required: true)
  final String title;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? reportedAt;

  factory ArticleReference.fromJson(Map<String, dynamic> json) {
    final value = _$ArticleReferenceFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$ArticleReferenceToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class NewsDetails extends MapItemDetails {
  const NewsDetails({
    required this.eventId,
    required this.summary,
    required this.articleRefs,
    required this.localizationEvidence,
    required this.dedupStatus,
  });

  @JsonKey(required: true)
  final String eventId;

  @JsonKey(required: true)
  final String? summary;

  @JsonKey(required: true)
  final List<ArticleReference> articleRefs;

  @JsonKey(required: true)
  final String? localizationEvidence;

  @JsonKey(required: true)
  final NewsDedupStatus dedupStatus;

  factory NewsDetails.fromJson(Map<String, dynamic> json) {
    final value = _$NewsDetailsFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$NewsDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class AreaIndicatorDetails extends MapItemDetails {
  const AreaIndicatorDetails({
    required this.indicatorId,
    required this.value,
    required this.valueState,
    required this.unit,
    required this.periodId,
    required this.periodLabel,
    required this.propertyType,
    required this.boundaryId,
    required this.boundaryVintage,
    required this.mappingState,
    required this.definition,
  });

  @JsonKey(required: true)
  final String indicatorId;

  @JsonKey(required: true)
  final double? value;

  @JsonKey(required: true)
  final MapValueState valueState;

  @JsonKey(required: true)
  final String unit;

  @JsonKey(required: true)
  final String periodId;

  @JsonKey(required: true)
  final String periodLabel;

  @JsonKey(required: true)
  final String? propertyType;

  @JsonKey(required: true)
  final String? boundaryId;

  @JsonKey(required: true)
  final String? boundaryVintage;

  @JsonKey(required: true)
  final MapMappingState mappingState;

  @JsonKey(required: true)
  final String definition;

  factory AreaIndicatorDetails.fromJson(Map<String, dynamic> json) {
    final value = _$AreaIndicatorDetailsFromJson(json);
    _validateAreaIndicator(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$AreaIndicatorDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class AggregateMetric {
  const AggregateMetric({
    required this.id,
    required this.label,
    required this.unit,
    required this.value,
    required this.definition,
  });

  @JsonKey(required: true)
  final String id;

  @JsonKey(required: true)
  final String label;

  @JsonKey(required: true)
  final String unit;

  @JsonKey(required: true)
  final double? value;

  @JsonKey(required: true)
  final String definition;

  factory AggregateMetric.fromJson(Map<String, dynamic> json) {
    final value = _$AggregateMetricFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$AggregateMetricToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class ResultRange {
  const ResultRange({
    required this.scope,
    required this.returnedCount,
    required this.totalMatching,
  });

  @JsonKey(required: true)
  final MapResultScope scope;

  @JsonKey(required: true)
  final int returnedCount;

  @JsonKey(required: true)
  final int? totalMatching;

  factory ResultRange.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['returnedCount', 'totalMatching']);
    final value = _$ResultRangeFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$ResultRangeToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class GridDetails {
  const GridDetails({
    required this.cellId,
    required this.resolution,
    required this.validSensorCount,
    required this.observedSensorCount,
    required this.classifiedSensorCount,
    required this.unclassifiedSensorCount,
    required this.anomalousSensorCount,
    required this.baselineDefinitionId,
    required this.anomalyRatio,
  });

  @JsonKey(required: true)
  final String cellId;

  @JsonKey(required: true)
  final int resolution;

  @JsonKey(required: true)
  final int validSensorCount;

  @JsonKey(required: true)
  final int observedSensorCount;

  @JsonKey(required: true)
  final int classifiedSensorCount;

  @JsonKey(required: true)
  final int unclassifiedSensorCount;

  @JsonKey(required: true)
  final int anomalousSensorCount;

  @JsonKey(required: true)
  final String? baselineDefinitionId;

  @JsonKey(required: true)
  final double? anomalyRatio;

  factory GridDetails.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, [
      'resolution',
      'validSensorCount',
      'observedSensorCount',
      'classifiedSensorCount',
      'unclassifiedSensorCount',
      'anomalousSensorCount',
    ]);
    final value = _$GridDetailsFromJson(json);
    _validateGrid(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$GridDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class AggregateDetails extends MapItemDetails {
  const AggregateDetails({
    required this.representation,
    required this.memberIds,
    required this.memberCursor,
    required this.resultRange,
    required this.metric,
    required this.window,
    required this.coverage,
    required this.bounds,
    required this.grid,
  });

  @JsonKey(required: true)
  final AggregateRepresentation representation;

  @JsonKey(required: true)
  final List<String> memberIds;

  @JsonKey(required: true)
  final String? memberCursor;

  @JsonKey(required: true)
  final ResultRange resultRange;

  @JsonKey(required: true)
  final AggregateMetric metric;

  @JsonKey(required: true)
  final TimeWindow? window;

  @JsonKey(required: true)
  final MapCoverage coverage;

  @JsonKey(required: true)
  @MapBoundsConverter()
  final MapBounds bounds;

  @JsonKey(required: true)
  final GridDetails? grid;

  factory AggregateDetails.fromJson(Map<String, dynamic> json) {
    final value = _$AggregateDetailsFromJson(json);
    _validateAggregate(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$AggregateDetailsToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class LayerResult {
  const LayerResult({
    required this.layerId,
    required this.state,
    required this.freshness,
    required this.completeness,
    required this.sourceIds,
    required this.coverage,
    required this.observedWindow,
    required this.updatedAt,
    required this.items,
    required this.unresolvedCount,
    required this.nextCursor,
    required this.totalMatching,
  });

  @JsonKey(required: true)
  final MapLayerId layerId;

  @JsonKey(required: true)
  final MapLayerState state;

  @JsonKey(required: true)
  final MapFreshness freshness;

  @JsonKey(required: true)
  final MapCompleteness completeness;

  @JsonKey(required: true)
  final List<String> sourceIds;

  @JsonKey(required: true)
  final MapCoverage coverage;

  @JsonKey(required: true)
  final TimeWindow? observedWindow;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? updatedAt;

  @JsonKey(required: true)
  final List<MapItem> items;

  @JsonKey(required: true)
  final int? unresolvedCount;

  @JsonKey(required: true)
  final String? nextCursor;

  @JsonKey(required: true)
  final int? totalMatching;

  factory LayerResult.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['unresolvedCount', 'totalMatching']);
    final value = _$LayerResultFromJson(json);
    _validateLayer(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$LayerResultToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class ViewportResponse {
  const ViewportResponse({
    required this.schemaVersion,
    required this.requestId,
    required this.snapshotId,
    required this.generatedAt,
    required this.mode,
    required this.dataMode,
    required this.layers,
  });

  @JsonKey(required: true)
  final int schemaVersion;

  @JsonKey(required: true)
  final String requestId;

  @JsonKey(required: true)
  final String snapshotId;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime generatedAt;

  @JsonKey(required: true)
  final MapQueryMode mode;

  @JsonKey(required: true)
  final MapDataMode dataMode;

  @JsonKey(required: true)
  final List<LayerResult> layers;

  factory ViewportResponse.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['schemaVersion']);
    final value = _$ViewportResponseFromJson(json);
    _validateViewportResponse(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$ViewportResponseToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class LayerDescriptor {
  const LayerDescriptor({
    required this.id,
    required this.titleKey,
    required this.topic,
    required this.defaultEnabled,
    required this.supportedModes,
    required this.sourceIds,
    required this.availability,
    required this.freshness,
    required this.coverage,
    required this.timeSemantics,
    required this.updatedAt,
  });

  @JsonKey(required: true)
  final MapLayerId id;

  @JsonKey(required: true)
  final String titleKey;

  @JsonKey(required: true)
  final MapTopic topic;

  @JsonKey(required: true)
  final bool defaultEnabled;

  @JsonKey(required: true)
  final List<MapQueryMode> supportedModes;

  @JsonKey(required: true)
  final List<String> sourceIds;

  @JsonKey(required: true)
  final MapAvailability availability;

  @JsonKey(required: true)
  final MapFreshness freshness;

  @JsonKey(required: true)
  final MapCoverage coverage;

  @JsonKey(required: true)
  final MapTimeSemantics timeSemantics;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime? updatedAt;

  factory LayerDescriptor.fromJson(Map<String, dynamic> json) {
    final value = _$LayerDescriptorFromJson(json);
    return value;
  }

  Map<String, dynamic> toJson() => _$LayerDescriptorToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class MapLayerCatalog {
  const MapLayerCatalog({
    required this.schemaVersion,
    required this.generatedAt,
    required this.dataMode,
    required this.serviceBounds,
    required this.layers,
  });

  @JsonKey(required: true)
  final int schemaVersion;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime generatedAt;

  @JsonKey(required: true)
  final MapDataMode dataMode;

  @JsonKey(required: true)
  @MapBoundsConverter()
  final MapBounds serviceBounds;

  @JsonKey(required: true)
  final List<LayerDescriptor> layers;

  factory MapLayerCatalog.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['schemaVersion']);
    final value = _$MapLayerCatalogFromJson(json);
    _validateCatalog(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapLayerCatalogToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class MapItemResponse {
  const MapItemResponse({
    required this.schemaVersion,
    required this.requestId,
    required this.snapshotId,
    required this.generatedAt,
    required this.mode,
    required this.dataMode,
    required this.item,
  });

  @JsonKey(required: true)
  final int schemaVersion;

  @JsonKey(required: true)
  final String requestId;

  @JsonKey(required: true)
  final String snapshotId;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime generatedAt;

  @JsonKey(required: true)
  final MapQueryMode mode;

  @JsonKey(required: true)
  final MapDataMode dataMode;

  @JsonKey(required: true)
  final MapItem item;

  factory MapItemResponse.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['schemaVersion']);
    final value = _$MapItemResponseFromJson(json);
    _validateItemResponse(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapItemResponseToJson(this);
}

@JsonSerializable(
  checked: true,
  explicitToJson: true,
  disallowUnrecognizedKeys: true,
)
final class UnlocatedQuery {
  const UnlocatedQuery({
    required this.requestId,
    required this.layers,
    required this.mode,
    required this.window,
    required this.scope,
    this.areaFilter,
    this.boundaryFilter,
    this.pageSize,
    this.cursor,
    this.snapshotId,
  });

  @JsonKey(required: true)
  final String requestId;

  @JsonKey(required: true)
  final List<MapLayerId> layers;

  @JsonKey(required: true)
  final MapQueryMode mode;

  @JsonKey(required: true)
  final TimeWindow window;

  @JsonKey(required: true)
  final UnlocatedScope scope;

  @JsonKey(includeIfNull: false)
  final AreaFilter? areaFilter;

  @JsonKey(includeIfNull: false)
  final BoundaryFilter? boundaryFilter;

  @JsonKey(includeIfNull: false)
  final int? pageSize;

  @JsonKey(includeIfNull: false)
  final String? cursor;

  @JsonKey(includeIfNull: false)
  final String? snapshotId;

  factory UnlocatedQuery.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['pageSize']);
    final value = _$UnlocatedQueryFromJson(json);
    validateUnlocatedQuery(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$UnlocatedQueryToJson(this);
}

@JsonSerializable(checked: true, explicitToJson: true)
final class MapItemPage {
  const MapItemPage({
    required this.schemaVersion,
    required this.requestId,
    required this.snapshotId,
    required this.generatedAt,
    required this.mode,
    required this.dataMode,
    required this.items,
    required this.completeness,
    required this.nextCursor,
    required this.totalMatching,
    required this.scope,
  });

  @JsonKey(required: true)
  final int schemaVersion;

  @JsonKey(required: true)
  final String requestId;

  @JsonKey(required: true)
  final String snapshotId;

  @JsonKey(required: true)
  @UtcInstantConverter()
  final DateTime generatedAt;

  @JsonKey(required: true)
  final MapQueryMode mode;

  @JsonKey(required: true)
  final MapDataMode dataMode;

  @JsonKey(required: true)
  final List<MapItem> items;

  @JsonKey(required: true)
  final MapCompleteness completeness;

  @JsonKey(required: true)
  final String? nextCursor;

  @JsonKey(required: true)
  final int? totalMatching;

  @JsonKey(required: true)
  final PageScope scope;

  factory MapItemPage.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['schemaVersion', 'totalMatching']);
    final value = _$MapItemPageFromJson(json);
    _validateItemPage(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapItemPageToJson(this);
}

@JsonSerializable(
  checked: true,
  explicitToJson: true,
  disallowUnrecognizedKeys: true,
)
final class MapReadContext {
  const MapReadContext({
    required this.requestId,
    required this.snapshotId,
    this.cursor,
    this.pageSize,
  });

  @JsonKey(required: true)
  final String requestId;

  @JsonKey(required: true)
  final String snapshotId;

  @JsonKey(includeIfNull: false)
  final String? cursor;

  @JsonKey(includeIfNull: false)
  final int? pageSize;

  factory MapReadContext.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['pageSize']);
    final value = _$MapReadContextFromJson(json);
    _validateReadContext(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$MapReadContextToJson(this);
}

@JsonSerializable(
  checked: true,
  explicitToJson: true,
  disallowUnrecognizedKeys: true,
)
final class AggregateMembersQuery {
  const AggregateMembersQuery({
    required this.requestId,
    required this.snapshotId,
    this.cursor,
    this.pageSize,
  });

  @JsonKey(required: true)
  final String requestId;

  @JsonKey(required: true)
  final String snapshotId;

  @JsonKey(includeIfNull: false)
  final String? cursor;

  @JsonKey(includeIfNull: false)
  final int? pageSize;

  factory AggregateMembersQuery.fromJson(Map<String, dynamic> json) {
    _requireIntegers(json, ['pageSize']);
    final value = _$AggregateMembersQueryFromJson(json);
    _validateMembersQuery(value);
    return value;
  }

  Map<String, dynamic> toJson() => _$AggregateMembersQueryToJson(this);
}

@Freezed(unionKey: 'type', fromJson: true, toJson: true)
sealed class GeoJsonGeometry with _$GeoJsonGeometry {
  const GeoJsonGeometry._();

  @FreezedUnionValue('Point')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory GeoJsonGeometry.point({
    @JsonKey(required: true) required List<double> coordinates,
  }) = GeoJsonPoint;

  @FreezedUnionValue('MultiPoint')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory GeoJsonGeometry.multiPoint({
    @JsonKey(required: true) required List<List<double>> coordinates,
  }) = GeoJsonMultiPoint;

  @FreezedUnionValue('LineString')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory GeoJsonGeometry.lineString({
    @JsonKey(required: true) required List<List<double>> coordinates,
  }) = GeoJsonLineString;

  @FreezedUnionValue('MultiLineString')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory GeoJsonGeometry.multiLineString({
    @JsonKey(required: true) required List<List<List<double>>> coordinates,
  }) = GeoJsonMultiLineString;

  @FreezedUnionValue('Polygon')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory GeoJsonGeometry.polygon({
    @JsonKey(required: true) required List<List<List<double>>> coordinates,
  }) = GeoJsonPolygon;

  @FreezedUnionValue('MultiPolygon')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory GeoJsonGeometry.multiPolygon({
    @JsonKey(required: true)
    required List<List<List<List<double>>>> coordinates,
  }) = GeoJsonMultiPolygon;

  factory GeoJsonGeometry.fromJson(Map<String, dynamic> json) {
    final value = _$GeoJsonGeometryFromJson(json);
    _validateGeometry(value);
    return value;
  }

  MapLocationPrecision get precision => switch (this) {
    GeoJsonPoint() || GeoJsonMultiPoint() => MapLocationPrecision.point,
    GeoJsonLineString() ||
    GeoJsonMultiLineString() => MapLocationPrecision.line,
    GeoJsonPolygon() || GeoJsonMultiPolygon() => MapLocationPrecision.area,
  };
}

@Freezed(unionKey: 'kind', fromJson: true, toJson: true)
sealed class PageScope with _$PageScope {
  const PageScope._();

  @FreezedUnionValue('unlocated')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory PageScope.unlocated({
    @JsonKey(required: true) required List<String> areaRefs,
    @JsonKey(required: true) required String? sourceJurisdiction,
  }) = UnlocatedPageScope;

  @FreezedUnionValue('aggregateMembers')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory PageScope.aggregateMembers({
    @JsonKey(required: true) required String aggregateId,
    @JsonKey(required: true) @MapBoundsConverter() required MapBounds bounds,
    @JsonKey(required: true) required TimeWindow? window,
    @JsonKey(required: true) required String unit,
  }) = AggregateMembersPageScope;

  factory PageScope.fromJson(Map<String, dynamic> json) {
    final value = _$PageScopeFromJson(json);
    switch (value) {
      case UnlocatedPageScope(:final areaRefs, :final sourceJurisdiction):
        _uniqueIds(areaRefs, 'areaRefs');
        _require(
          areaRefs.isNotEmpty != (sourceJurisdiction != null),
          'Unlocated page must identify one area or jurisdiction scope.',
        );
      case AggregateMembersPageScope(:final aggregateId, :final unit):
        _id(aggregateId, 'aggregateId');
        _nonempty(unit, 'unit');
    }
    return value;
  }
}

@Freezed(unionKey: 'kind', fromJson: true, toJson: true)
sealed class MapItem with _$MapItem {
  const MapItem._();

  @override
  MapItemDetails get details;

  @FreezedUnionValue('pedestrian')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.pedestrian({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required PedestrianDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = PedestrianMapItem;

  @FreezedUnionValue('anomaly')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.anomaly({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required AnomalyDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = AnomalyMapItem;

  @FreezedUnionValue('disruption')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.disruption({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required DisruptionDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = DisruptionMapItem;

  @FreezedUnionValue('event')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.event({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required EventDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = EventMapItem;

  @FreezedUnionValue('planning')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.planning({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required PlanningDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = PlanningMapItem;

  @FreezedUnionValue('parking')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.parking({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required ParkingDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = ParkingMapItem;

  @FreezedUnionValue('boundary')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.boundary({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required BoundaryDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = BoundaryMapItem;

  @FreezedUnionValue('news')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.news({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required NewsDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = NewsMapItem;

  @FreezedUnionValue('areaIndicator')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.areaIndicator({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required AreaIndicatorDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = AreaIndicatorMapItem;

  @FreezedUnionValue('aggregate')
  @JsonSerializable(checked: true, explicitToJson: true)
  const factory MapItem.aggregate({
    @JsonKey(required: true) required String id,
    @JsonKey(required: true) required String versionId,
    @JsonKey(required: true) required MapLayerId layerId,
    @JsonKey(required: true) required String title,
    @JsonKey(required: true) required GeoJsonGeometry? geometry,
    @JsonKey(required: true) required MapLocation location,
    @JsonKey(required: true) required MapAssertionKind assertionKind,
    @JsonKey(required: true) required MapLifecycle lifecycle,
    @JsonKey(required: true) required MapItemTime time,
    @JsonKey(required: true) required List<MapSource> sources,
    @JsonKey(required: true) required AggregateDetails details,
    @JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation,
  }) = AggregateMapItem;

  factory MapItem.fromJson(Map<String, dynamic> json) {
    final value = _$MapItemFromJson(json);
    _validateItem(value);
    return value;
  }

  MapItemKind get kind => switch (this) {
    PedestrianMapItem() => MapItemKind.pedestrian,
    AnomalyMapItem() => MapItemKind.anomaly,
    DisruptionMapItem() => MapItemKind.disruption,
    EventMapItem() => MapItemKind.event,
    PlanningMapItem() => MapItemKind.planning,
    ParkingMapItem() => MapItemKind.parking,
    BoundaryMapItem() => MapItemKind.boundary,
    NewsMapItem() => MapItemKind.news,
    AreaIndicatorMapItem() => MapItemKind.areaIndicator,
    AggregateMapItem() => MapItemKind.aggregate,
  };
}

void _id(String value, String field) {
  _require(
    value.isNotEmpty && value.length <= 256 && !RegExp(r'\s').hasMatch(value),
    '$field must be a nonempty opaque identifier.',
  );
}

void _uniqueIds(List<String> values, String field) {
  _require(values.toSet().length == values.length, '$field must be distinct.');
  for (final value in values) {
    _id(value, field);
  }
}

void _validateBounds(MapBounds bounds) {
  _require(
    bounds.toJson().every((value) => value.isFinite),
    'bbox must be finite.',
  );
  _require(
    bounds.west >= 144 &&
        bounds.east <= 146.5 &&
        bounds.south >= -39 &&
        bounds.north <= -37 &&
        bounds.west < bounds.east &&
        bounds.south < bounds.north,
    'bbox must be increasing and inside the Melbourne service area.',
  );
}

void _validateWindow(TimeWindow window) {
  _require(
    window.from.isUtc && window.to.isUtc && window.from.isBefore(window.to),
    'Time window must be UTC, half-open and increasing.',
  );
}

void _validateAreaFilter(AreaFilter filter) {
  _id(filter.indicatorId, 'indicatorId');
  _id(filter.periodId, 'periodId');
  _id(filter.boundaryVintage, 'boundaryVintage');
  final start = _statisticalDate(filter.periodStart);
  final end = _statisticalDate(filter.periodEnd);
  _require(start.isBefore(end), 'Statistical period must be increasing.');
  if (filter.propertyType != null) {
    _nonempty(filter.propertyType!, 'propertyType');
  }
}

DateTime _statisticalDate(String value) {
  _require(
    RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value),
    'Statistical period needs a date-only bound.',
  );
  return const UtcInstantConverter().fromJson('${value}T00:00:00Z');
}

void _validateQueryFields({
  required String requestId,
  required List<MapLayerId> layers,
  required TimeWindow window,
  required AreaFilter? areaFilter,
  required BoundaryFilter? boundaryFilter,
  required int? pageSize,
  required String? cursor,
  required String? snapshotId,
}) {
  _id(requestId, 'requestId');
  _require(
    layers.isNotEmpty &&
        layers.length <= MapLayerId.values.length &&
        layers.toSet().length == layers.length,
    'Select distinct registered layers.',
  );
  _validateWindow(window);
  _require(
    window.to.difference(window.from) <= const Duration(days: 31),
    'Request windows must not exceed 31 days; statistical periods are separate.',
  );
  _require(
    !layers.any(
          (layer) => layer == MapLayerId.rent || layer == MapLayerId.census,
        ) ||
        areaFilter != null,
    'Indicator layers require an area filter.',
  );
  _require(
    !layers.contains(MapLayerId.boundary) || boundaryFilter != null,
    'Boundary layer requires one level and vintage.',
  );
  if (areaFilter != null) _validateAreaFilter(areaFilter);
  if (boundaryFilter != null) _id(boundaryFilter.vintage, 'vintage');
  _require(
    pageSize == null || (pageSize >= 1 && pageSize <= 1000),
    'pageSize must be between 1 and 1000.',
  );
  _require(
    (cursor == null) == (snapshotId == null),
    'Continuation requires both cursor and snapshotId.',
  );
  if (cursor != null) _id(cursor, 'cursor');
  if (snapshotId != null) _id(snapshotId, 'snapshotId');
}

void validateViewportQuery(ViewportQuery query) {
  _validateBounds(query.bbox);
  _require(
    query.zoom.isFinite && query.zoom >= 0 && query.zoom <= 22,
    'zoom must be between 0 and 22.',
  );
  _validateQueryFields(
    requestId: query.requestId,
    layers: query.layers,
    window: query.window,
    areaFilter: query.areaFilter,
    boundaryFilter: query.boundaryFilter,
    pageSize: query.pageSize,
    cursor: query.cursor,
    snapshotId: query.snapshotId,
  );
}

void validateUnlocatedQuery(UnlocatedQuery query) {
  _validateQueryFields(
    requestId: query.requestId,
    layers: query.layers,
    window: query.window,
    areaFilter: query.areaFilter,
    boundaryFilter: query.boundaryFilter,
    pageSize: query.pageSize,
    cursor: query.cursor,
    snapshotId: query.snapshotId,
  );
  switch (query.scope) {
    case AreaRefsScope(:final areaRefs):
      _require(
        areaRefs.isNotEmpty,
        'Area association scope must not be empty.',
      );
      _uniqueIds(areaRefs, 'areaRefs');
    case SourceJurisdictionScope(:final sourceJurisdiction):
      _nonempty(sourceJurisdiction, 'sourceJurisdiction');
  }
}

void _validateReadContext(MapReadContext context) {
  _id(context.requestId, 'requestId');
  _id(context.snapshotId, 'snapshotId');
  if (context.cursor != null) _id(context.cursor!, 'cursor');
  _require(
    context.pageSize == null ||
        (context.pageSize! >= 1 && context.pageSize! <= 1000),
    'Invalid pageSize.',
  );
}

void _validateMembersQuery(AggregateMembersQuery query) {
  _validateReadContext(
    MapReadContext(
      requestId: query.requestId,
      snapshotId: query.snapshotId,
      cursor: query.cursor,
      pageSize: query.pageSize,
    ),
  );
}

void _validateCoverage(MapCoverage coverage) {
  _uniqueIds(coverage.areaRefs, 'areaRefs');
  _uniqueIds(coverage.evidenceSourceIds, 'evidenceSourceIds');
  if (coverage.state == MapCoverageState.verified) {
    _require(
      coverage.areaRefs.isNotEmpty && coverage.evidenceSourceIds.isNotEmpty,
      'Verified coverage needs area and public evidence.',
    );
  }
}

void _validateSource(MapSource source) {
  _id(source.sourceId, 'sourceId');
  _nonempty(source.attribution, 'attribution');
  if (source.versionRef != null) _id(source.versionRef!, 'versionRef');
  if (source.url != null) {
    final uri = Uri.tryParse(source.url!);
    _require(
      uri != null &&
          (uri.scheme == 'https' || uri.scheme == 'http') &&
          uri.host.isNotEmpty,
      'Source URL must use HTTP(S).',
    );
  }
}

void _validateItemTime(MapItemTime time) {
  if (time.validFrom != null && time.validTo != null) {
    _require(
      time.validFrom!.isBefore(time.validTo!),
      'Validity interval must be increasing.',
    );
  }
}

void _validatePedestrian(PedestrianDetails detail) {
  _id(detail.sensorId, 'sensorId');
  _nonnegative(detail.totalCount, 'totalCount');
  _nonnegative(detail.directionACount, 'directionACount');
  _nonnegative(detail.directionBCount, 'directionBCount');
  if (detail.locationStatus == PedestrianLocationStatus.located) {
    _require(
      detail.locationValidFrom != null &&
          !detail.window.from.isBefore(detail.locationValidFrom!) &&
          (detail.locationValidTo == null ||
              !detail.window.to.isAfter(detail.locationValidTo!)),
      'Sensor location must be effective throughout the observation window.',
    );
  }
}

void _validateParking(ParkingDetails detail) {
  _id(detail.sensorId, 'sensorId');
  _nonnegative(detail.zoneNumber, 'zoneNumber');
  _require(
    detail.legalParking == 'unknown',
    'A parking sensor never establishes legal parking.',
  );
  _require(
    (detail.state == ParkingState.noData) == (detail.noDataReason != null),
    'noData needs its reason, and only noData has one.',
  );
  _require(
    detail.state == ParkingState.noData ||
        detail.reading == ParkingReading.current ||
        detail.reading == ParkingReading.late,
    'Occupancy cannot be drawn from a stale or unknown reading.',
  );
}

void _validateAnomaly(AnomalyDetails detail) {
  _id(detail.resultId, 'resultId');
  _id(detail.sensorId, 'sensorId');
  for (final value in [
    detail.baselineValue,
    detail.observedValue,
    detail.delta,
  ]) {
    _require(
      value == null || value.isFinite,
      'Anomaly values must be finite or null.',
    );
  }
  if (detail.classification != AnomalyClassification.unclassified) {
    _require(
      detail.eligibility == AnomalyEligibility.eligible &&
          detail.baselineDefinitionId != null &&
          detail.baselineValue != null &&
          detail.observedValue != null,
      'Classified anomaly requires eligible observations and a defined baseline.',
    );
  }
}

void _validateAreaIndicator(AreaIndicatorDetails detail) {
  _require(
    (detail.valueState == MapValueState.observed) == (detail.value != null),
    'Missing or suppressed values must remain null; observations need a value.',
  );
  _require(
    detail.value == null || detail.value!.isFinite,
    'Indicator value must be finite or null.',
  );
  if (detail.mappingState == MapMappingState.matched) {
    _require(
      detail.boundaryId != null && detail.boundaryVintage != null,
      'Matched indicators need a boundary id and vintage.',
    );
  }
}

void _validateGrid(GridDetails grid) {
  _id(grid.cellId, 'cellId');
  _require(
    grid.resolution >= 0 && grid.resolution <= 15,
    'Grid resolution must be between 0 and 15.',
  );
  for (final count in [
    grid.validSensorCount,
    grid.observedSensorCount,
    grid.classifiedSensorCount,
    grid.unclassifiedSensorCount,
    grid.anomalousSensorCount,
  ]) {
    _nonnegative(count, 'sensor count');
  }
  _require(
    grid.observedSensorCount <= grid.validSensorCount &&
        grid.classifiedSensorCount + grid.unclassifiedSensorCount ==
            grid.observedSensorCount &&
        grid.anomalousSensorCount <= grid.classifiedSensorCount,
    'Grid denominators must describe the same observations.',
  );
  if (grid.classifiedSensorCount == 0) {
    _require(
      grid.anomalyRatio == null,
      'No classification denominator means no anomaly ratio.',
    );
  } else {
    _require(
      grid.baselineDefinitionId != null,
      'Classification requires a baseline definition.',
    );
    if (grid.anomalyRatio != null) {
      _require(
        grid.anomalyRatio!.isFinite &&
            (grid.anomalyRatio! -
                        grid.anomalousSensorCount / grid.classifiedSensorCount)
                    .abs() <
                1e-9,
        'Anomaly ratio must use classified observations as its denominator.',
      );
    }
  }
}

void _validateAggregate(AggregateDetails detail) {
  _uniqueIds(detail.memberIds, 'memberIds');
  if (detail.memberCursor != null) _id(detail.memberCursor!, 'memberCursor');
  _nonnegative(detail.resultRange.returnedCount, 'returnedCount');
  _nonnegative(detail.resultRange.totalMatching, 'totalMatching');
  _require(
    detail.resultRange.totalMatching == null ||
        detail.resultRange.totalMatching! >= detail.resultRange.returnedCount,
    'Aggregate range cannot exceed its exact total.',
  );
  _require(
    (detail.representation == AggregateRepresentation.coverageGrid) ==
        (detail.grid != null),
    'Coverage grids require grid details; clusters do not carry grid data.',
  );
  _require(
    detail.metric.value == null || detail.metric.value!.isFinite,
    'Aggregate metric must be finite or null.',
  );
}

void _validateGeometryPresentation(GeometryPresentation presentation) {
  _require(
    presentation.originalPrecision != MapLocationPrecision.unlocated,
    'Original geometry precision must be geographic.',
  );
  _require(
    presentation.toleranceMeters == null ||
        (presentation.toleranceMeters!.isFinite &&
            presentation.toleranceMeters! >= 0),
    'Geometry tolerance must be nonnegative or null.',
  );
  _require(
    !presentation.simplified || presentation.toleranceMeters != null,
    'Simplified extents need an explicit tolerance.',
  );
}

void _validatePoint(List<double> point) {
  _require(
    point.length == 2 &&
        point.every((value) => value.isFinite) &&
        point[0] >= -180 &&
        point[0] <= 180 &&
        point[1] >= -90 &&
        point[1] <= 90,
    'GeoJSON positions must be [longitude, latitude] in WGS84.',
  );
}

void _validateLine(List<List<double>> line) {
  _require(line.length >= 2, 'LineString needs at least two positions.');
  for (final point in line) {
    _validatePoint(point);
  }
}

void _validatePolygon(List<List<List<double>>> polygon) {
  _require(polygon.isNotEmpty, 'Polygon needs an exterior ring.');
  for (final ring in polygon) {
    _require(ring.length >= 4, 'Polygon rings need at least four positions.');
    for (final point in ring) {
      _validatePoint(point);
    }
    _require(
      ring.first[0] == ring.last[0] && ring.first[1] == ring.last[1],
      'Polygon rings must close.',
    );
  }
}

void _validateGeometry(GeoJsonGeometry geometry) {
  switch (geometry) {
    case GeoJsonPoint(:final coordinates):
      _validatePoint(coordinates);
    case GeoJsonMultiPoint(:final coordinates):
      _require(coordinates.isNotEmpty, 'MultiPoint must not be empty.');
      for (final point in coordinates) {
        _validatePoint(point);
      }
    case GeoJsonLineString(:final coordinates):
      _validateLine(coordinates);
    case GeoJsonMultiLineString(:final coordinates):
      _require(coordinates.isNotEmpty, 'MultiLineString must not be empty.');
      for (final line in coordinates) {
        _validateLine(line);
      }
    case GeoJsonPolygon(:final coordinates):
      _validatePolygon(coordinates);
    case GeoJsonMultiPolygon(:final coordinates):
      _require(coordinates.isNotEmpty, 'MultiPolygon must not be empty.');
      for (final polygon in coordinates) {
        _validatePolygon(polygon);
      }
  }
}

void _validateItem(MapItem item) {
  _id(item.id, 'id');
  _id(item.versionId, 'versionId');
  _nonempty(item.title, 'title');
  _require(item.sources.isNotEmpty, 'Items need public source provenance.');
  _require(
    (item.geometry == null) ==
        (item.location.precision == MapLocationPrecision.unlocated),
    'Null geometry must remain unlocated.',
  );
  if (item.geometry != null) {
    _require(
      item.geometry!.precision == item.location.precision,
      'Geometry must retain its declared precision.',
    );
  }
  switch (item) {
    case PedestrianMapItem(:final details):
      _require(
        item.layerId == MapLayerId.pedestrian,
        'Pedestrian kind must use pedestrian layer.',
      );
      _require(
        (details.locationStatus == PedestrianLocationStatus.located) ==
            (item.geometry != null),
        'Ambiguous, inactive or missing sensor locations cannot create points.',
      );
      if (item.geometry != null) {
        _require(
          item.geometry is GeoJsonPoint &&
              item.location.role == MapLocationRole.sensor,
          'Located observations need a sensor point.',
        );
      }
    case AnomalyMapItem():
      _require(
        item.layerId == MapLayerId.anomaly,
        'Anomaly kind must use anomaly layer.',
      );
    case DisruptionMapItem():
      _require(
        item.layerId == MapLayerId.disruption,
        'Disruption kind must use disruption layer.',
      );
    case EventMapItem():
      _require(
        item.layerId == MapLayerId.event,
        'Event kind must use event layer.',
      );
    case PlanningMapItem():
      _require(
        item.layerId == MapLayerId.planning,
        'Planning kind must use planning layer.',
      );
    case ParkingMapItem():
      _require(
        item.layerId == MapLayerId.parking,
        'Parking kind must use parking layer.',
      );
      _require(
        item.geometry is GeoJsonPoint &&
            item.location.role == MapLocationRole.sensor,
        'A parking sensor is drawn only at its own sensor point.',
      );
    case BoundaryMapItem():
      _require(
        item.layerId == MapLayerId.boundary &&
            item.location.role == MapLocationRole.statisticalArea,
        'Boundary kind must use boundary layer and geographic area role.',
      );
    case NewsMapItem():
      _require(
        item.layerId == MapLayerId.news,
        'News kind must use news layer.',
      );
      _require(
        item.location.role != MapLocationRole.mention || item.geometry == null,
        'A news mention is not a geographic event site.',
      );
      if (item.geometry is GeoJsonPoint) {
        _require(
          item.location.role == MapLocationRole.eventSite,
          'News point requires event-site evidence.',
        );
      }
    case AreaIndicatorMapItem(:final details):
      _require(
        item.layerId == MapLayerId.rent || item.layerId == MapLayerId.census,
        'Indicator kind must use an indicator layer.',
      );
      if (item.geometry != null) {
        _require(
          details.mappingState == MapMappingState.matched &&
              item.location.role == MapLocationRole.statisticalArea,
          'Only matched statistical areas are drawable.',
        );
      }
    case AggregateMapItem():
      _require(item.geometry != null, 'Geographic aggregates need geometry.');
  }
}

void _validateLayer(LayerResult layer) {
  _uniqueIds(layer.sourceIds, 'sourceIds');
  _nonnegative(layer.unresolvedCount, 'unresolvedCount');
  _nonnegative(layer.totalMatching, 'totalMatching');
  _require(
    layer.items.length <= 1000,
    'A layer page is bounded to 1000 items.',
  );
  for (final item in layer.items) {
    _require(
      item.layerId == layer.layerId,
      'Item must belong to its returned layer.',
    );
  }
  _require(
    layer.totalMatching == null || layer.totalMatching! >= layer.items.length,
    'Returned items cannot exceed the exact total.',
  );
  _require(
    layer.nextCursor == null || layer.completeness == MapCompleteness.partial,
    'Continuation implies partial results.',
  );
  if (layer.state == MapLayerState.noMatching) {
    _require(
      layer.coverage.state == MapCoverageState.verified &&
          layer.coverage.window != null &&
          layer.completeness == MapCompleteness.complete &&
          layer.items.isEmpty &&
          layer.totalMatching == 0 &&
          layer.unresolvedCount == 0 &&
          layer.nextCursor == null,
      'noMatching requires verified complete coverage and a zero matching result.',
    );
  }
  if (layer.state == MapLayerState.notCovered) {
    _require(
      layer.coverage.state == MapCoverageState.notCovered,
      'notCovered needs explicit absence of coverage.',
    );
  }
  if (layer.state == MapLayerState.unavailable ||
      layer.state == MapLayerState.unknown ||
      layer.state == MapLayerState.notCovered) {
    _require(
      layer.items.isEmpty && layer.totalMatching == null,
      'Unavailable coverage is not a zero-result claim.',
    );
  }
}

void _validateEnvelope(int schemaVersion, String requestId, String snapshotId) {
  _require(schemaVersion == 1, 'Unsupported map schema version.');
  _id(requestId, 'requestId');
  _id(snapshotId, 'snapshotId');
}

void _validateViewportResponse(ViewportResponse response) {
  _validateEnvelope(
    response.schemaVersion,
    response.requestId,
    response.snapshotId,
  );
  _require(
    response.layers.isNotEmpty &&
        response.layers.length <= MapLayerId.values.length &&
        response.layers.map((layer) => layer.layerId).toSet().length ==
            response.layers.length,
    'Viewport results need distinct registered layers.',
  );
  _require(
    response.layers.fold<int>(
          0,
          (total, layer) => total + layer.items.length,
        ) <=
        1000,
    'Viewport response is bounded to 1000 items.',
  );
  for (final layer in response.layers) {
    _require(
      layer.items.every((item) => item.geometry != null),
      'Unlocated facts belong in the scoped list, not geographic totals.',
    );
  }
}

void _validateCatalog(MapLayerCatalog catalog) {
  _require(catalog.schemaVersion == 1, 'Unsupported map schema version.');
  _require(
    catalog.layers.length == MapLayerId.values.length &&
        catalog.layers.map((layer) => layer.id).toSet().length ==
            MapLayerId.values.length,
    'The catalog must describe all registered layers exactly once.',
  );
}

void _validateItemResponse(MapItemResponse response) {
  _validateEnvelope(
    response.schemaVersion,
    response.requestId,
    response.snapshotId,
  );
}

void _validateItemPage(MapItemPage page) {
  _validateEnvelope(page.schemaVersion, page.requestId, page.snapshotId);
  _require(page.items.length <= 1000, 'Item pages are bounded to 1000 items.');
  _nonnegative(page.totalMatching, 'totalMatching');
  _require(
    page.totalMatching == null || page.totalMatching! >= page.items.length,
    'Items cannot exceed the full-query total.',
  );
  _require(
    page.nextCursor == null || page.completeness == MapCompleteness.partial,
    'Continuation implies partial results.',
  );
  if (page.scope is UnlocatedPageScope) {
    _require(
      page.items.every((item) => item.geometry == null),
      'Unlocated lists cannot contain geographic points.',
    );
  }
}

void _requireIntegers(Map<String, dynamic> json, List<String> fields) {
  for (final field in fields) {
    final value = json[field];
    _require(
      value == null ||
          (value is num && value.isFinite && value == value.truncate()),
      '$field must be an integer or null.',
    );
  }
}
