// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Melens';

  @override
  String get mapPlaceholder => 'The map goes here (UC-01).';

  @override
  String get notFoundTitle => 'Page not found';

  @override
  String get notFoundBackToMap => 'Back to the map';

  @override
  String get mapLayerPedestrian => 'Pedestrian counts';

  @override
  String get mapLayerAnomaly => 'Pedestrian anomalies';

  @override
  String get mapLayerDisruption => 'Transport disruptions';

  @override
  String get mapLayerEvent => 'Events';

  @override
  String get mapLayerPlanning => 'Development projects';

  @override
  String get mapLayerBoundary => 'Area boundaries';

  @override
  String get mapLayerNews => 'Nearby news';

  @override
  String get mapLayerRent => 'Rental statistics';

  @override
  String get mapLayerCensus => 'Census statistics';

  @override
  String get mapStatusAvailable => 'Data available';

  @override
  String get mapStatusNoMatching =>
      'No matching data in the covered area and time';

  @override
  String get mapStatusNotCovered => 'This area or time is not covered';

  @override
  String get mapStatusUnavailable => 'Source data unavailable';

  @override
  String get mapStatusUnknown => 'Coverage or result unknown';

  @override
  String get mapStatusLoading => 'Loading map data';

  @override
  String get mapStatusRefreshing => 'Refreshing map data';

  @override
  String get mapStatusClientError => 'Could not retrieve map data';

  @override
  String get mapRetainedData =>
      'Showing the previous result with its original time';

  @override
  String get mapRetry => 'Retry map data';

  @override
  String get mapFreshnessCurrent => 'Source update is current';

  @override
  String get mapFreshnessLate => 'Source update is late';

  @override
  String get mapFreshnessStale => 'Source data is stale';

  @override
  String get mapFreshnessVersioned => 'Published data version';

  @override
  String get mapFreshnessUnknown => 'Source freshness unknown';

  @override
  String get mapPartialScope => 'Partial result — more data may exist';

  @override
  String mapExactTotal(String count) {
    return 'Exact matching total: $count';
  }

  @override
  String get mapTotalUnknown => 'Full matching total unknown';

  @override
  String get mapUpdatedUnknown => 'Update time unknown';

  @override
  String mapUpdatedAt(String time) {
    return 'Updated: $time';
  }

  @override
  String mapObservedWindow(String from, String to) {
    return 'Observation window: $from to $to (end excluded)';
  }

  @override
  String get mapObservedWindowUnknown => 'Observation window unknown';

  @override
  String mapUnlocatedCount(String count) {
    return 'Records without a usable map location: $count';
  }

  @override
  String get mapSampleData => 'Sample data — illustrative only';

  @override
  String get mapHistoricalData => 'Historical data';

  @override
  String get mapPrediction => 'Prediction';

  @override
  String get mapCountUnknown => 'Passage count unknown';

  @override
  String mapSensorPassages(String count) {
    return 'Sensor passages: $count';
  }

  @override
  String mapStatisticalPeriod(String period) {
    return 'Statistical period: $period';
  }

  @override
  String mapObservedAt(String time) {
    return 'Observed: $time';
  }

  @override
  String mapReportedAt(String time) {
    return 'Reported: $time';
  }

  @override
  String get mapObservationTimeUnknown => 'Observation or report time unknown';

  @override
  String mapValidFrom(String time) {
    return 'Effective from: $time';
  }

  @override
  String mapValidTo(String time) {
    return 'Effective until: $time (end excluded)';
  }

  @override
  String mapSourceTimeUnknownZone(String value) {
    return 'Source time: $value (timezone unknown)';
  }

  @override
  String mapSourceTime(String value, String zone) {
    return 'Source time: $value ($zone)';
  }

  @override
  String get mapRetrievedUnknown => 'Retrieved time unknown';

  @override
  String mapRetrievedAt(String time) {
    return 'Retrieved: $time';
  }

  @override
  String get mapSourceUnknown => 'Source unknown';

  @override
  String mapSourceVersion(String version) {
    return 'Source version: $version';
  }

  @override
  String mapSourceAttribution(String attribution) {
    return 'Source: $attribution';
  }

  @override
  String mapOpenSource(String attribution) {
    return 'Open source: $attribution';
  }

  @override
  String get mapSourceLinkUnknown => 'Public source link unavailable';

  @override
  String get mapLayerPanelTitle => 'Topics and layers';

  @override
  String get mapTopicCityActivity => 'City activity';

  @override
  String get mapTopicNearbyNews => 'Nearby news';

  @override
  String get mapTopicAreaComparison => 'Area comparison';

  @override
  String get mapLaterTopicsUnavailable =>
      'Nearby news and Area comparison will be available after the core map features are ready.';

  @override
  String get mapOneAreaMetric =>
      'One filled area metric at a time. Point and line layers can be shown alongside it.';

  @override
  String get mapNoLayersSelected =>
      'No layers selected. Turn on a layer to show map data.';

  @override
  String get mapSurfaceGeometryLegend =>
      'Points keep reported locations; lines and areas keep reported extents.';

  @override
  String mapSurfaceCountLegend(String area) {
    return 'Circle area represents sensor passages: $area m² per passage. Compare only the same observation window. This display scale does not represent population density.';
  }

  @override
  String get mapSurfaceMissingKey =>
      'Base map unavailable: configure an authorized Google Maps Web API key. Data remains available in the object list.';

  @override
  String get mapSurfaceNativeUnavailable =>
      'The base map is not configured on this platform. Data remains available in the object list.';

  @override
  String get mapSurfaceLoading => 'Loading base map…';

  @override
  String get mapSurfaceLoadError =>
      'Base map could not load. Data remains available in the object list.';

  @override
  String get mapSurfaceRetry => 'Retry base map';

  @override
  String get mapSurfaceLocationUnavailable =>
      'Location unavailable; not drawn on map';

  @override
  String get mapSurfacePointLocation => 'Reported point location';

  @override
  String get mapSurfaceLineLocation => 'Reported line extent';

  @override
  String get mapSurfaceAreaLocation => 'Reported area extent';

  @override
  String get mapSurfaceObjectList => 'Map objects — keyboard accessible';

  @override
  String mapAggregateLoadedRecords(String count) {
    return 'Group: $count loaded records';
  }

  @override
  String get mapAggregateBadgeRecords => 'records';

  @override
  String get mapAggregateLoadedOnly =>
      'Loaded scope only (*) — the complete matching population may be larger';

  @override
  String mapAggregateMetric(String label, String value, String unit) {
    return '$label: $value $unit';
  }

  @override
  String mapAggregateMetricUnknown(String label, String unit) {
    return '$label: value unknown ($unit)';
  }

  @override
  String get mapAggregateScopeExplanation =>
      'This group represents the supplied records in this map result. Its count is not a city-wide total or a count of unique people.';

  @override
  String mapAggregateGroupTotal(String count) {
    return 'Exact matching records in this group: $count';
  }

  @override
  String get mapAggregateSameLocation =>
      'Several records share this location. Open a member below to view its own details.';

  @override
  String get mapAggregateZoom => 'Zoom to group bounds';

  @override
  String get mapAggregateMembersTitle => 'Group members';

  @override
  String mapAggregateMembersLoaded(String count) {
    return 'Member records retrieved: $count';
  }

  @override
  String mapAggregateMemberUnit(String unit) {
    return 'Member scope unit: $unit';
  }

  @override
  String get mapAggregateMembersLoading => 'Retrieving group members';

  @override
  String get mapAggregateSnapshotExpired =>
      'This group snapshot has expired. Refresh the map and select the group again.';

  @override
  String get mapAggregateRefreshSnapshot => 'Refresh map snapshot';

  @override
  String get mapAggregateMembersRetry => 'Retry group members';

  @override
  String get mapAggregateMembersEmpty =>
      'No member records were returned for this group.';

  @override
  String get mapAggregateMembersBounded =>
      'This list has reached its display limit. More records may exist; zoom to the group for a narrower view.';

  @override
  String get mapAggregateMembersMore => 'Retrieve more group members';

  @override
  String get mapDetailsTitle => 'Selected record';

  @override
  String get mapDetailsClose => 'Close selected record details';

  @override
  String get mapDetailsOffscreen =>
      'This record is outside the current view. Its original details are retained.';

  @override
  String get mapDetailsFilterExcluded =>
      'This record no longer matches the selected layers or filters. Its map highlight is cleared.';

  @override
  String get mapDetailsRemoved =>
      'This record is no longer available. Its details and map highlight are cleared.';

  @override
  String get mapDetailsWithdrawn =>
      'This record has been withdrawn. Its details and map highlight are cleared.';

  @override
  String get mapDetailsInAggregate =>
      'The selected record belongs to the highlighted aggregate. These are its original details.';

  @override
  String get mapDetailsLoading => 'Loading selected record details';

  @override
  String get mapDetailsError => 'Could not retrieve selected record details';

  @override
  String get mapDetailsSnapshotExpired =>
      'The selected data snapshot has expired. Select a record from a refreshed map to request new details.';

  @override
  String mapDetailFact(String label, String value) {
    return '$label: $value';
  }

  @override
  String get mapDetailUnknown => 'Unknown';

  @override
  String get mapDetailPlan => 'Plan';

  @override
  String get mapDetailDirectionsUncalibrated =>
      'Directions A and B are source channels; geographic headings are not known.';

  @override
  String get mapDetailMinuteGranularity => 'Observation granularity: minute';

  @override
  String get mapDetailHourGranularity => 'Observation granularity: hour';

  @override
  String get mapDetailSimplified =>
      'Simplified display geometry; the source location precision is retained.';

  @override
  String get mapDetailPointPrecision => 'Location precision: point';

  @override
  String get mapDetailLinePrecision => 'Location precision: line';

  @override
  String get mapDetailAreaPrecision => 'Location precision: area';

  @override
  String get mapDetailUnlocatedPrecision => 'Location precision: unlocated';

  @override
  String get mapDetailRoleEventSite => 'Location role: evidenced event site';

  @override
  String get mapDetailRoleSensor => 'Location role: sensor';

  @override
  String get mapDetailRoleAffectedExtent => 'Location role: affected extent';

  @override
  String get mapDetailRoleStatisticalArea => 'Location role: statistical area';

  @override
  String get mapDetailRoleAreaAssociation => 'Location role: area association';

  @override
  String get mapDetailRoleMention => 'Location role: mentioned place';

  @override
  String get mapDetailRoleUnknown => 'Location role: unknown';

  @override
  String get mapDetailActive => 'Status: active';

  @override
  String get mapDetailPlanned => 'Status: planned';

  @override
  String get mapDetailCancelled => 'Status: cancelled';

  @override
  String get mapDetailResolved => 'Status: resolved';

  @override
  String get mapDetailStatusUnknown => 'Status: unknown';

  @override
  String get mapDetailExtentRoad => 'Affected extent: road segment';

  @override
  String get mapDetailExtentRoute => 'Affected extent: route';

  @override
  String get mapDetailExtentStop => 'Affected extent: stop';

  @override
  String get mapDetailExtentArea => 'Affected extent: area';

  @override
  String get mapDetailExtentUnknown => 'Affected extent: unknown';

  @override
  String get mapDetailLocationLocated => 'Sensor location status: located';

  @override
  String get mapDetailLocationUnlocated => 'Sensor location status: unlocated';

  @override
  String get mapDetailLocationAmbiguous => 'Sensor location status: ambiguous';

  @override
  String get mapDetailLocationInactive => 'Sensor location status: inactive';

  @override
  String get mapDetailValueMissing => 'Value missing';

  @override
  String get mapDetailValueSuppressed => 'Value suppressed';

  @override
  String get mapUnlocatedTitle => 'Records without map locations';

  @override
  String get mapUnlocatedClose => 'Close records without map locations';

  @override
  String mapUnlocatedAreaScope(String scope) {
    return 'Associated area references: $scope';
  }

  @override
  String mapUnlocatedJurisdictionScope(String scope) {
    return 'Source jurisdiction: $scope';
  }

  @override
  String get mapUnlocatedScopeExplanation =>
      'These records have no usable map geometry. Association with this scope does not establish membership in the current map view.';

  @override
  String get mapUnlocatedLoading => 'Loading records without map locations';

  @override
  String get mapUnlocatedSnapshotExpired =>
      'This list snapshot has expired. Restart the list to use a new snapshot.';

  @override
  String get mapUnlocatedRestart => 'Restart scoped list';

  @override
  String get mapUnlocatedEmptyPage => 'No records returned on this page';

  @override
  String get mapUnlocatedNextPage => 'Show next page';

  @override
  String get mapDetailIdentifier => 'Record id';

  @override
  String get mapDetailVersion => 'Record version';

  @override
  String get mapDetailLocationEvidence => 'Location evidence';

  @override
  String get mapDetailSensor => 'Sensor id';

  @override
  String get mapDetailDirectionA => 'Direction A passages';

  @override
  String get mapDetailDirectionB => 'Direction B passages';

  @override
  String get mapDetailLocationValidFrom => 'Location valid from';

  @override
  String get mapDetailLocationValidTo => 'Location valid until (end excluded)';

  @override
  String get mapDetailResult => 'Result id';

  @override
  String get mapDetailObservation => 'Observation id';

  @override
  String get mapDetailBaselineDefinition => 'Baseline definition id';

  @override
  String get mapDetailBaselineValue => 'Baseline value';

  @override
  String get mapDetailObservedValue => 'Observed value';

  @override
  String get mapDetailDelta => 'Difference from baseline';

  @override
  String get mapDetailSummary => 'Summary';

  @override
  String get mapDetailImpact => 'Impact';

  @override
  String get mapDetailServices => 'Affected services';

  @override
  String get mapDetailVenue => 'Venue';

  @override
  String get mapDetailCategory => 'Category';

  @override
  String get mapDetailStarts => 'Starts';

  @override
  String get mapDetailEnds => 'Ends';

  @override
  String get mapDetailProjectStatus => 'Project status';

  @override
  String get mapDetailPermit => 'Permit id';

  @override
  String get mapDetailBoundary => 'Boundary id';

  @override
  String get mapDetailBoundaryLevel => 'Boundary level';

  @override
  String get mapDetailBoundaryVintage => 'Boundary vintage';

  @override
  String get mapDetailBoundaryName => 'Boundary name';

  @override
  String get mapDetailIndicator => 'Indicator id';

  @override
  String get mapDetailValue => 'Value';

  @override
  String get mapDetailUnit => 'Unit';

  @override
  String get mapDetailPropertyType => 'Property type';

  @override
  String get mapDetailDefinition => 'Definition';

  @override
  String get mapDetailMetric => 'Metric';

  @override
  String get mapScreenTitle => 'Melens map';

  @override
  String get mapScreenStatuses => 'Layer statuses';

  @override
  String get mapScreenUnlocated => 'Records without map locations';

  @override
  String get mapScreenCatalogLoading => 'Loading layer catalog…';

  @override
  String get mapScreenCatalogError => 'Layer catalog could not load.';

  @override
  String get mapScreenRetryCatalog => 'Retry layer catalog';

  @override
  String get mapScreenOutsideService =>
      'This view is outside the query service area.';

  @override
  String get mapScreenWaitingArea =>
      'Waiting for the map area or query service bounds.';

  @override
  String get mapScreenServiceArea =>
      'Results use the query service area until a map view is available.';

  @override
  String get mapScreenFilterRequired =>
      'Boundary or area layers need a published version and filter before querying.';

  @override
  String get mapScreenRegionError => 'The visible map area could not be read.';

  @override
  String get mapScreenPreviousWindow =>
      'Displayed records keep their previous query window.';

  @override
  String get mapScreenCurrent => 'Current · last 15 minutes';

  @override
  String get mapScreenHistorical => 'Historical';

  @override
  String get mapScreenHistoryRange => 'History range';

  @override
  String get mapScreenOneHour => '1 hour';

  @override
  String get mapScreenOneDay => '24 hours';

  @override
  String get mapScreenSevenDays => '7 days';

  @override
  String get mapScreenThirtyOneDays => '31 days';

  @override
  String get mapScreenPrevious => 'Previous time window';

  @override
  String get mapScreenNext => 'Next time window';

  @override
  String get mapScreenRefresh => 'Refresh records';

  @override
  String mapScreenWindow(String from, String to) {
    return 'Melbourne time: $from to $to (end excluded)';
  }

  @override
  String get mapAnomalyDirectionHigher => 'Direction: higher than the baseline';

  @override
  String get mapAnomalyDirectionLower => 'Direction: lower than the baseline';

  @override
  String get mapAnomalyDirectionNone =>
      'Direction: no change from the baseline';

  @override
  String get mapAnomalyDirectionUnknown => 'Direction: unknown';

  @override
  String get mapAnomalyEligible => 'Eligibility: eligible';

  @override
  String get mapAnomalyIneligible => 'Eligibility: ineligible';

  @override
  String get mapAnomalyEligibilityUnknown => 'Eligibility: unknown';

  @override
  String get mapAnomalyClassified => 'Classification: anomalous';

  @override
  String get mapAnomalyNotAnomalous => 'Classification: not anomalous';

  @override
  String get mapAnomalyUnclassified => 'Classification: unclassified';

  @override
  String get mapAnomalyCauseUnestablished =>
      'A difference from the baseline does not establish a cause.';

  @override
  String get chatPanelTitle => 'Agent chat';

  @override
  String get chatOpen => 'Open the agent chat';

  @override
  String get chatClose => 'Close the agent chat';

  @override
  String get chatSessions => 'Conversations';

  @override
  String get chatNewSession => 'New conversation';

  @override
  String get chatDeleteSession => 'Delete conversation';

  @override
  String get chatSessionUntitled => 'Untitled conversation';

  @override
  String chatSessionMeta(int count, String updated) {
    return '$count turns, updated $updated';
  }

  @override
  String get chatSessionsLoading => 'Loading conversations…';

  @override
  String get chatNoSessions => 'No conversations yet.';

  @override
  String get chatRestoring => 'Restoring the conversation…';

  @override
  String get chatEmpty =>
      'Ask about what is on the map, for example \"What\'s around here?\" or \"Only show live music tonight.\"';

  @override
  String get chatInputHint => 'Ask about the map…';

  @override
  String get chatInputHintRunning => 'Type to interrupt with a new message…';

  @override
  String get chatAttachPhotos => 'Attach photos';

  @override
  String get chatPhotoGallery => 'Choose photos';

  @override
  String get chatPhotoCamera => 'Take a photo';

  @override
  String get chatPhotoRemove => 'Remove photo';

  @override
  String chatPhotoLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Up to $count photos per message.',
      one: 'One photo per message.',
    );
    return '$_temp0';
  }

  @override
  String chatPhotosRejected(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count photos could not be used: they are unreadable or too large.',
      one: 'One photo could not be used: it is unreadable or too large.',
    );
    return '$_temp0';
  }

  @override
  String get chatPhotoPickFailed => 'The photo picker could not be opened.';

  @override
  String chatPhoto(int index) {
    return 'Photo $index';
  }

  @override
  String get chatPhotoUnavailable => 'Photo unavailable';

  @override
  String get chatSend => 'Send';

  @override
  String get chatStop => 'Stop this turn';

  @override
  String get chatRetry => 'Retry';

  @override
  String get chatThinking => 'Thinking…';

  @override
  String get chatWriting => 'Writing…';

  @override
  String chatStepRows(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count results',
      one: '1 result',
    );
    return '$_temp0';
  }

  @override
  String get chatStepMemo => 'reused';

  @override
  String chatStepSeconds(String seconds) {
    return '$seconds s';
  }

  @override
  String chatStepMillis(int millis) {
    return '$millis ms';
  }

  @override
  String chatStepFailed(String code) {
    return 'failed: $code';
  }

  @override
  String get chatToolErrorInvalidArguments => 'invalid arguments';

  @override
  String get chatToolErrorNotFound => 'not found';

  @override
  String get chatToolErrorNotAnAnomaly => 'not an anomaly';

  @override
  String get chatToolErrorUnverifiedSources => 'unverified sources';

  @override
  String get chatToolErrorRouteNotFound => 'no route found';

  @override
  String get chatToolErrorUpstreamUnavailable => 'source unavailable';

  @override
  String get cardItemDetailsTitle => 'Agent result';

  @override
  String get cardItemDetailsClose => 'Close the result details';

  @override
  String get cardItemDetailsNotOnMap =>
      'This result is not a record on the map. It comes from the source below, as the agent reported it.';

  @override
  String get cardItemDetailsOpenSource => 'Open the source';

  @override
  String get chatTurnCancelled => 'Stopped.';

  @override
  String get chatStopBudget =>
      'The agent reached its call budget and wrapped up.';

  @override
  String get chatQuestionFreeText => 'Or type your own answer below.';

  @override
  String chatInputArea(String lat, String lng) {
    return 'Selected the point $lat, $lng';
  }

  @override
  String chatInputAnalyse(String featureId) {
    return 'Analyse $featureId';
  }

  @override
  String chatInputAnswer(String value) {
    return 'Answer: $value';
  }

  @override
  String get chatAnalyseSelected => 'Analyse this anomaly';

  @override
  String get chatBriefSelected => 'Brief this area';

  @override
  String chatUsage(
    int calls,
    String input,
    String cached,
    String output,
    String thoughts,
    String total,
  ) {
    return '$calls calls · ↑ $input ($cached cached) · ↓ $output · $thoughts thinking · $total total';
  }

  @override
  String get chatUsageTooltip =>
      '↑ input tokens sent to Gemini, with the part served from its cache · ↓ output tokens Gemini wrote · thinking tokens are billed as output';

  @override
  String get chatUsageIncomplete =>
      'Usage is incomplete: a model call was cut off.';

  @override
  String get chatActionShowLayers => 'Show layers';

  @override
  String get chatActionFocusMap => 'Focus map';

  @override
  String get chatActionDrawRoute => 'Draw route';

  @override
  String get chatActionHighlight => 'Highlight features';

  @override
  String get chatActionApplied => 'applied';

  @override
  String get chatActionPartial => 'partly applied';

  @override
  String get chatActionIgnored => 'ignored';

  @override
  String get chatActionUnsupported => 'not supported yet';

  @override
  String get chatActionRestored => 'from history';

  @override
  String chatActionSkipped(String items) {
    return 'Not applied: $items';
  }

  @override
  String get chatErrorSignIn =>
      'Agent sign-in is not configured. Add the FIREBASE_ keys to config/dev.json (cloud/agent/infra/firebase.sh --app-config), or AGENT_DEV_TOKEN for a local agent.';

  @override
  String get chatErrorSignInFailed =>
      'Could not sign in to the agent service. Try again.';

  @override
  String get chatErrorNetwork => 'The agent service could not be reached.';

  @override
  String get chatErrorTimeout => 'The agent service timed out.';

  @override
  String get chatErrorUnauthorized =>
      'The agent service rejected the sign-in token.';

  @override
  String get chatErrorNotFound =>
      'This conversation no longer exists on the server.';

  @override
  String get chatErrorTurnInProgress =>
      'Another turn is still running in this conversation. Try again in a moment.';

  @override
  String get chatErrorRateLimited =>
      'Too many turns in the last hour. Try again later.';

  @override
  String get chatErrorUnavailable =>
      'The agent service is unavailable right now.';

  @override
  String get chatErrorInvalidRequest =>
      'The agent service rejected the request.';

  @override
  String get chatErrorHttp => 'The agent service returned an unexpected error.';

  @override
  String get chatErrorProtocol =>
      'The agent service sent something the app could not read.';

  @override
  String get chatErrorStreamEnded =>
      'The turn ended before the agent finished.';

  @override
  String chatErrorServer(String message) {
    return 'Agent error: $message';
  }

  @override
  String get cardTypeAreaBrief => 'Area brief';

  @override
  String get cardTypeAnomalyAnalysis => 'Anomaly analysis';

  @override
  String get cardTypePlan => 'Plan';

  @override
  String get cardTypeHistory => 'History';

  @override
  String get cardTypeList => 'List';

  @override
  String cardItemTime(String time) {
    return 'When: $time';
  }

  @override
  String cardTimeRange(String from, String to) {
    return '$from – $to';
  }

  @override
  String cardTimeFrom(String from) {
    return 'from $from';
  }

  @override
  String cardTimeUntil(String to) {
    return 'until $to';
  }

  @override
  String cardItemCost(String cost) {
    return 'Cost: $cost';
  }

  @override
  String cardItemGettingThere(String text) {
    return 'Getting there: $text';
  }

  @override
  String cardSourceFeature(String id) {
    return 'Source: map feature $id';
  }

  @override
  String cardSourceLink(String title) {
    return 'Source: $title';
  }

  @override
  String get cardGoogleMapsAttribution => 'Place details from Google Maps';

  @override
  String get mapAgentHighlights => 'Highlighted by the agent';

  @override
  String get mapAgentHighlightsClear => 'Clear highlights';

  @override
  String get eventsOpen => 'Open user events';

  @override
  String get eventsClose => 'Close user events';

  @override
  String get eventsPanelTitle => 'User events';

  @override
  String get eventsTabNearby => 'Nearby';

  @override
  String get eventsTabMine => 'Mine';

  @override
  String get eventsPublish => 'Publish event';

  @override
  String get eventsFormPickOnMap => 'Pick on the map';

  @override
  String get eventsFormPickBanner => 'Tap the map to place the event pin';

  @override
  String get eventsFormPickStop => 'Stop picking';

  @override
  String eventsFormUseSelected(String title) {
    return 'Use $title';
  }

  @override
  String get eventsFormSearchPlace => 'Search an address or place';

  @override
  String get eventsFormSearchHint => 'Google Places, greater Melbourne';

  @override
  String get eventsFormSearchNoResults => 'No place matches';

  @override
  String eventsFormSearchUnavailable(String reason) {
    return 'Address search is not available: $reason';
  }

  @override
  String get eventsRefresh => 'Refresh';

  @override
  String get eventsRetry => 'Try again';

  @override
  String get eventsNearbyEmpty =>
      'No user events here in the next two weeks. Publish the first one.';

  @override
  String get eventsNearbyNoViewport =>
      'Move the map to an area to find events.';

  @override
  String get eventsMineEmpty =>
      'You have not published or joined any events yet.';

  @override
  String get eventsMineOwnedHeading => 'Published by you';

  @override
  String get eventsMineJoinedHeading => 'Joined';

  @override
  String eventsLoadFailed(String reason) {
    return 'Could not load events. $reason';
  }

  @override
  String eventsGoing(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count going',
      one: '1 going',
      zero: 'Nobody going yet',
    );
    return '$_temp0';
  }

  @override
  String eventsGoingOf(int count, int capacity) {
    return '$count of $capacity going';
  }

  @override
  String get eventsYouAreGoing => 'You\'re going';

  @override
  String get eventsYours => 'Yours';

  @override
  String get eventsCancelled => 'Cancelled';

  @override
  String get eventsFull => 'Full';

  @override
  String get eventsEnded => 'Ended';

  @override
  String get eventsAnonymousBadge => 'Anonymous attendance';

  @override
  String get eventsAnonymousExplainer =>
      'Only the number of people going is shown, never who.';

  @override
  String get eventsBack => 'Back to the list';

  @override
  String get eventsShowOnMap => 'Show on map';

  @override
  String get eventsJoin => 'Join';

  @override
  String get eventsLeave => 'Leave';

  @override
  String get eventsJoinNameLabel => 'Your name (optional)';

  @override
  String get eventsJoinNameHint => 'Shown to the organiser only';

  @override
  String get eventsEdit => 'Edit';

  @override
  String get eventsCancelEvent => 'Cancel event';

  @override
  String get eventsRemoveEvent => 'Remove event';

  @override
  String get eventsCancelConfirmTitle => 'Cancel this event?';

  @override
  String get eventsCancelConfirmBody =>
      'It stays visible as cancelled and nobody can join.';

  @override
  String get eventsRemoveConfirmTitle => 'Remove this event?';

  @override
  String get eventsRemoveConfirmBody =>
      'It disappears from the map for everyone. This cannot be undone.';

  @override
  String get eventsConfirmKeep => 'Keep it';

  @override
  String get eventsMembers => 'Members';

  @override
  String eventsMembersCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count members',
      one: '1 member',
      zero: 'No members yet',
    );
    return '$_temp0';
  }

  @override
  String get eventsMembersAnonymous =>
      'Anonymous attendance: names are not kept.';

  @override
  String get eventsMemberGuest => 'Guest';

  @override
  String get eventsMemberRemove => 'Remove member';

  @override
  String eventsMemberJoinedAt(String time) {
    return 'Joined $time';
  }

  @override
  String get eventsWhen => 'When';

  @override
  String get eventsWhere => 'Where';

  @override
  String eventsTimeRange(String start, String end) {
    return '$start to $end';
  }

  @override
  String eventsPlacePin(String lat, String lng) {
    return 'Pinned at $lat, $lng';
  }

  @override
  String get eventsFormPublishTitle => 'Publish an event';

  @override
  String get eventsFormEditTitle => 'Edit event';

  @override
  String get eventsFormTitle => 'Title';

  @override
  String get eventsFormDescription => 'Description';

  @override
  String get eventsFormPlaceName => 'Place name (optional)';

  @override
  String get eventsFormStart => 'Starts';

  @override
  String get eventsFormEnd => 'Ends (optional)';

  @override
  String get eventsFormNoEnd => 'No end time';

  @override
  String get eventsFormPickDate => 'Pick the date';

  @override
  String get eventsFormPickTime => 'Pick the time';

  @override
  String get eventsFormAnonymous => 'Anonymous attendance';

  @override
  String get eventsFormCapacity => 'Capacity (optional)';

  @override
  String get eventsFormCapacityHint =>
      '2 to 1000 people, or leave empty for no limit';

  @override
  String get eventsFormLocation => 'Location';

  @override
  String get eventsFormLocationHint =>
      'Tap the map, use its centre or a selected record, or search an address.';

  @override
  String get eventsFormUseMapCentre => 'Use map centre';

  @override
  String get eventsFormSubmitPublish => 'Publish';

  @override
  String get eventsFormSubmitSave => 'Save';

  @override
  String get eventsFormCancel => 'Cancel';

  @override
  String get eventsFormTitleRequired => 'Give the event a title.';

  @override
  String eventsFormTooLong(int max) {
    return 'At most $max characters.';
  }

  @override
  String get eventsFormStartTooEarly => 'The start can be at most an hour ago.';

  @override
  String get eventsFormStartTooLate => 'The start must be within a year.';

  @override
  String get eventsFormEndBeforeStart => 'The end must be after the start.';

  @override
  String get eventsFormDurationTooLong => 'An event lasts at most 7 days.';

  @override
  String get eventsFormCapacityRange => 'Capacity is 2 to 1000.';

  @override
  String get eventsFormLocationOutside =>
      'The location must be in the Melbourne service area.';

  @override
  String get eventsFormNoChanges => 'Nothing changed.';

  @override
  String get eventsErrorSignIn =>
      'Sign-in is not configured, so events are unavailable.';

  @override
  String get eventsErrorNetwork => 'The service is unreachable.';

  @override
  String get eventsErrorTimeout => 'The request timed out.';

  @override
  String get eventsErrorRateLimited =>
      'Too many changes in an hour. Try again later.';

  @override
  String get eventsErrorNotFound => 'This event no longer exists.';

  @override
  String get eventsErrorForbidden => 'Only the organiser can do that.';

  @override
  String get eventsErrorInvalid => 'The service rejected the event details.';

  @override
  String get eventsErrorUnknown => 'Something went wrong.';

  @override
  String get eventsErrorEventFull => 'This event is full.';

  @override
  String get eventsErrorAlreadyJoined => 'You already joined this event.';

  @override
  String get eventsErrorEventCancelled => 'This event was cancelled.';

  @override
  String get eventsErrorEventEnded => 'This event has ended.';

  @override
  String get eventsErrorOwnEvent => 'You organise this event.';

  @override
  String get eventsErrorNotJoined => 'You had not joined this event.';
}
