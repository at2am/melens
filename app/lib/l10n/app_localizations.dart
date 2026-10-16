import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[Locale('en')];

  /// App name, shown in the browser tab and the task switcher.
  ///
  /// In en, this message translates to:
  /// **'Melens'**
  String get appTitle;

  /// Temporary body of the map screen until the map is built.
  ///
  /// In en, this message translates to:
  /// **'The map goes here (UC-01).'**
  String get mapPlaceholder;

  /// Title of the screen shown for an unknown URL.
  ///
  /// In en, this message translates to:
  /// **'Page not found'**
  String get notFoundTitle;

  /// Button on the not-found screen that opens the map.
  ///
  /// In en, this message translates to:
  /// **'Back to the map'**
  String get notFoundBackToMap;

  /// Layer title for measured sensor passages.
  ///
  /// In en, this message translates to:
  /// **'Pedestrian counts'**
  String get mapLayerPedestrian;

  /// Layer title for verified anomaly results.
  ///
  /// In en, this message translates to:
  /// **'Pedestrian anomalies'**
  String get mapLayerAnomaly;

  /// Layer title for road and public transport impacts.
  ///
  /// In en, this message translates to:
  /// **'Transport disruptions'**
  String get mapLayerDisruption;

  /// Layer title for admitted public events.
  ///
  /// In en, this message translates to:
  /// **'Events'**
  String get mapLayerEvent;

  /// Layer title for development monitor records.
  ///
  /// In en, this message translates to:
  /// **'Development projects'**
  String get mapLayerPlanning;

  /// Layer title for live on-street parking bay sensors (UC-15).
  ///
  /// In en, this message translates to:
  /// **'Parking sensors'**
  String get mapLayerParking;

  /// Layer title for geographic context polygons.
  ///
  /// In en, this message translates to:
  /// **'Area boundaries'**
  String get mapLayerBoundary;

  /// Layer title for nearby public news reports.
  ///
  /// In en, this message translates to:
  /// **'Nearby news'**
  String get mapLayerNews;

  /// Layer title for historical official rental indicators.
  ///
  /// In en, this message translates to:
  /// **'Rental statistics'**
  String get mapLayerRent;

  /// Layer title for census period indicators.
  ///
  /// In en, this message translates to:
  /// **'Census statistics'**
  String get mapLayerCensus;

  /// Successful layer result without a coverage or empty-result inference.
  ///
  /// In en, this message translates to:
  /// **'Data available'**
  String get mapStatusAvailable;

  /// Empty-result label only for a complete query with verified geographic and temporal coverage.
  ///
  /// In en, this message translates to:
  /// **'No matching data in the covered area and time'**
  String get mapStatusNoMatching;

  /// The selected scope is outside verified observation coverage.
  ///
  /// In en, this message translates to:
  /// **'This area or time is not covered'**
  String get mapStatusNotCovered;

  /// The source is currently unavailable; does not imply a measured zero.
  ///
  /// In en, this message translates to:
  /// **'Source data unavailable'**
  String get mapStatusUnavailable;

  /// The service has insufficient evidence to describe the selected scope.
  ///
  /// In en, this message translates to:
  /// **'Coverage or result unknown'**
  String get mapStatusUnknown;

  /// Initial client request before any result is available.
  ///
  /// In en, this message translates to:
  /// **'Loading map data'**
  String get mapStatusLoading;

  /// A client request is in progress while an earlier result remains visible.
  ///
  /// In en, this message translates to:
  /// **'Refreshing map data'**
  String get mapStatusRefreshing;

  /// Safe client request error; raw server or transport errors are never exposed.
  ///
  /// In en, this message translates to:
  /// **'Could not retrieve map data'**
  String get mapStatusClientError;

  /// Previous data remains visible after a refresh failure without a fabricated new timestamp.
  ///
  /// In en, this message translates to:
  /// **'Showing the previous result with its original time'**
  String get mapRetainedData;

  /// Accessible action for a retryable client request failure.
  ///
  /// In en, this message translates to:
  /// **'Retry map data'**
  String get mapRetry;

  /// Source freshness label; this does not make an older observation or statistical period current.
  ///
  /// In en, this message translates to:
  /// **'Source update is current'**
  String get mapFreshnessCurrent;

  /// Source has missed its expected refresh cadence.
  ///
  /// In en, this message translates to:
  /// **'Source update is late'**
  String get mapFreshnessLate;

  /// Source observations have exceeded the producer-defined freshness threshold.
  ///
  /// In en, this message translates to:
  /// **'Source data is stale'**
  String get mapFreshnessStale;

  /// A static or statistical published vintage whose age alone is not a stale-live-data claim.
  ///
  /// In en, this message translates to:
  /// **'Published data version'**
  String get mapFreshnessVersioned;

  /// No reliable source freshness classification is supplied.
  ///
  /// In en, this message translates to:
  /// **'Source freshness unknown'**
  String get mapFreshnessUnknown;

  /// Incomplete result warning; the displayed rows do not imply the complete population.
  ///
  /// In en, this message translates to:
  /// **'Partial result — more data may exist'**
  String get mapPartialScope;

  /// Full-query total only when an exact total is supplied.
  ///
  /// In en, this message translates to:
  /// **'Exact matching total: {count}'**
  String mapExactTotal(String count);

  /// The current page length cannot be substituted for an exact total.
  ///
  /// In en, this message translates to:
  /// **'Full matching total unknown'**
  String get mapTotalUnknown;

  /// No reliable source update instant is supplied.
  ///
  /// In en, this message translates to:
  /// **'Update time unknown'**
  String get mapUpdatedUnknown;

  /// Source update instant formatted in Melbourne local time with its timezone.
  ///
  /// In en, this message translates to:
  /// **'Updated: {time}'**
  String mapUpdatedAt(String time);

  /// Half-open observation interval in Melbourne time.
  ///
  /// In en, this message translates to:
  /// **'Observation window: {from} to {to} (end excluded)'**
  String mapObservedWindow(String from, String to);

  /// No reliable observation interval is supplied.
  ///
  /// In en, this message translates to:
  /// **'Observation window unknown'**
  String get mapObservedWindowUnknown;

  /// Records excluded from geographic totals because a trustworthy map location is missing.
  ///
  /// In en, this message translates to:
  /// **'Records without a usable map location: {count}'**
  String mapUnlocatedCount(String count);

  /// Mandatory visible label for every explicit development sample surface.
  ///
  /// In en, this message translates to:
  /// **'Sample data — illustrative only'**
  String get mapSampleData;

  /// The selected view represents a historical period rather than a current fact.
  ///
  /// In en, this message translates to:
  /// **'Historical data'**
  String get mapHistoricalData;

  /// Required text label for a prediction; independent of colour.
  ///
  /// In en, this message translates to:
  /// **'Prediction'**
  String get mapPrediction;

  /// Missing sensor counts stay unknown rather than becoming zero.
  ///
  /// In en, this message translates to:
  /// **'Passage count unknown'**
  String get mapCountUnknown;

  /// Exact measured count; passages are not unique people.
  ///
  /// In en, this message translates to:
  /// **'Sensor passages: {count}'**
  String mapSensorPassages(String count);

  /// Original statistical period label preserved without inventing an observation instant.
  ///
  /// In en, this message translates to:
  /// **'Statistical period: {period}'**
  String mapStatisticalPeriod(String period);

  /// Observation instant in Melbourne time with its timezone.
  ///
  /// In en, this message translates to:
  /// **'Observed: {time}'**
  String mapObservedAt(String time);

  /// Report publication instant in Melbourne time with its timezone.
  ///
  /// In en, this message translates to:
  /// **'Reported: {time}'**
  String mapReportedAt(String time);

  /// No observation, report, validity-start or statistical-period time is available.
  ///
  /// In en, this message translates to:
  /// **'Observation or report time unknown'**
  String get mapObservationTimeUnknown;

  /// Start of the source-provided validity interval in Melbourne time.
  ///
  /// In en, this message translates to:
  /// **'Effective from: {time}'**
  String mapValidFrom(String time);

  /// Exclusive end of the source-provided validity interval in Melbourne time.
  ///
  /// In en, this message translates to:
  /// **'Effective until: {time} (end excluded)'**
  String mapValidTo(String time);

  /// Unresolved source clock text retained verbatim without conversion to UTC.
  ///
  /// In en, this message translates to:
  /// **'Source time: {value} (timezone unknown)'**
  String mapSourceTimeUnknownZone(String value);

  /// Original source clock text and source timezone retained without inference.
  ///
  /// In en, this message translates to:
  /// **'Source time: {value} ({zone})'**
  String mapSourceTime(String value, String zone);

  /// No reliable source fetch instant is available.
  ///
  /// In en, this message translates to:
  /// **'Retrieved time unknown'**
  String get mapRetrievedUnknown;

  /// Source fetch instant in Melbourne time; independent of observation age.
  ///
  /// In en, this message translates to:
  /// **'Retrieved: {time}'**
  String mapRetrievedAt(String time);

  /// No public source provenance is available.
  ///
  /// In en, this message translates to:
  /// **'Source unknown'**
  String get mapSourceUnknown;

  /// Public source version reference; does not expose private ingestion evidence.
  ///
  /// In en, this message translates to:
  /// **'Source version: {version}'**
  String mapSourceVersion(String version);

  /// Readable public source attribution.
  ///
  /// In en, this message translates to:
  /// **'Source: {attribution}'**
  String mapSourceAttribution(String attribution);

  /// Accessible source action label naming the public source.
  ///
  /// In en, this message translates to:
  /// **'Open source: {attribution}'**
  String mapOpenSource(String attribution);

  /// No safe public HTTP or HTTPS source URL is available.
  ///
  /// In en, this message translates to:
  /// **'Public source link unavailable'**
  String get mapSourceLinkUnknown;

  /// Heading for the topic selection and per-layer visibility controls.
  ///
  /// In en, this message translates to:
  /// **'Topics and layers'**
  String get mapLayerPanelTitle;

  /// Topic for pedestrian observations, anomalies and transport disruptions with optional events and development.
  ///
  /// In en, this message translates to:
  /// **'City activity'**
  String get mapTopicCityActivity;

  /// Topic for news associated with the selected region; selection is gated until later delivery.
  ///
  /// In en, this message translates to:
  /// **'Nearby news'**
  String get mapTopicNearbyNews;

  /// Topic for comparing published statistical periods at their original geographic scale.
  ///
  /// In en, this message translates to:
  /// **'Area comparison'**
  String get mapTopicAreaComparison;

  /// Explains disabled later-topic controls in the P0 map shell without claiming source failure or starting later workflows.
  ///
  /// In en, this message translates to:
  /// **'Nearby news and Area comparison will be available after the core map features are ready.'**
  String get mapLaterTopicsUnavailable;

  /// Explains that selecting rent or Census replaces the other filled metric while auxiliary layers remain independent.
  ///
  /// In en, this message translates to:
  /// **'One filled area metric at a time. Point and line layers can be shown alongside it.'**
  String get mapOneAreaMetric;

  /// User-selected empty layer state, distinct from no matching records or missing coverage.
  ///
  /// In en, this message translates to:
  /// **'No layers selected. Turn on a layer to show map data.'**
  String get mapNoLayersSelected;

  /// 2D map legend explaining that rendered geometry retains source precision.
  ///
  /// In en, this message translates to:
  /// **'Points keep reported locations; lines and areas keep reported extents.'**
  String get mapSurfaceGeometryLegend;

  /// Fixed circle-area scale and same-window comparison limitation. A zero or missing count never receives a positive-sized circle.
  ///
  /// In en, this message translates to:
  /// **'Circle area represents sensor passages: {area} m² per passage. Compare only the same observation window. This display scale does not represent population density.'**
  String mapSurfaceCountLegend(String area);

  /// Missing Web key state; sample data must not imply a working base map.
  ///
  /// In en, this message translates to:
  /// **'Base map unavailable: configure an authorized Google Maps API key for this platform. Data remains available in the object list.'**
  String get mapSurfaceMissingKey;

  /// Native SDK setup has not been accepted; Web readiness does not certify native rendering.
  ///
  /// In en, this message translates to:
  /// **'The base map is not configured on this platform. Data remains available in the object list.'**
  String get mapSurfaceNativeUnavailable;

  /// Google Maps SDK readiness is pending.
  ///
  /// In en, this message translates to:
  /// **'Loading base map…'**
  String get mapSurfaceLoading;

  /// SDK readiness failed without exposing keys or raw provider error text.
  ///
  /// In en, this message translates to:
  /// **'Base map could not load. Data remains available in the object list.'**
  String get mapSurfaceLoadError;

  /// Explicit SDK retry after a readiness failure.
  ///
  /// In en, this message translates to:
  /// **'Retry base map'**
  String get mapSurfaceRetry;

  /// Missing, ambiguous, inactive, contradictory or invalid geometry remains accessible without an invented marker.
  ///
  /// In en, this message translates to:
  /// **'Location unavailable; not drawn on map'**
  String get mapSurfaceLocationUnavailable;

  /// Accessible object-list location precision for a supplied point.
  ///
  /// In en, this message translates to:
  /// **'Reported point location'**
  String get mapSurfacePointLocation;

  /// Accessible object-list location precision for a supplied line.
  ///
  /// In en, this message translates to:
  /// **'Reported line extent'**
  String get mapSurfaceLineLocation;

  /// Accessible object-list location precision for a supplied area.
  ///
  /// In en, this message translates to:
  /// **'Reported area extent'**
  String get mapSurfaceAreaLocation;

  /// Object list provides exact counts and keyboard selection independently of platform-map interaction.
  ///
  /// In en, this message translates to:
  /// **'Map objects — keyboard accessible'**
  String get mapSurfaceObjectList;

  /// Count of actual records represented by this supplied aggregate, not unique people or the entire source population.
  ///
  /// In en, this message translates to:
  /// **'Group: {count} loaded records'**
  String mapAggregateLoadedRecords(String count);

  /// Unit shown below a cluster bitmap's actual loaded member-record count.
  ///
  /// In en, this message translates to:
  /// **'records'**
  String get mapAggregateBadgeRecords;

  /// Explains the asterisk on incomplete or unknown-total cluster symbols without inventing a full total.
  ///
  /// In en, this message translates to:
  /// **'Loaded scope only (*) — the complete matching population may be larger'**
  String get mapAggregateLoadedOnly;

  /// Producer-defined aggregate measure, value and unit, distinct from its loaded member-record count.
  ///
  /// In en, this message translates to:
  /// **'{label}: {value} {unit}'**
  String mapAggregateMetric(String label, String value, String unit);

  /// Unknown aggregate metric remains unknown rather than zero; preserves the supplied measure and unit.
  ///
  /// In en, this message translates to:
  /// **'{label}: value unknown ({unit})'**
  String mapAggregateMetricUnknown(String label, String unit);

  /// Explains the scope and count semantics of an aggregate independently of colour or map zoom.
  ///
  /// In en, this message translates to:
  /// **'This group represents the supplied records in this map result. Its count is not a city-wide total or a count of unique people.'**
  String get mapAggregateScopeExplanation;

  /// An explicit exact group/member-query total from the server, never derived from a partial list or inferred as a viewport-wide total.
  ///
  /// In en, this message translates to:
  /// **'Exact matching records in this group: {count}'**
  String mapAggregateGroupTotal(String count);

  /// Explains why an exact colocated MultiPoint can remain grouped even at a close zoom.
  ///
  /// In en, this message translates to:
  /// **'Several records share this location. Open a member below to view its own details.'**
  String get mapAggregateSameLocation;

  /// Accessible action forwarding the group's supplied navigation bounds without inventing a geometry extent.
  ///
  /// In en, this message translates to:
  /// **'Zoom to group bounds'**
  String get mapAggregateZoom;

  /// UC-06: explains that a news area is an association with the place an article names, never an event site.
  ///
  /// In en, this message translates to:
  /// **'Shaded areas are places these articles name. A named place is not where a reported event happened.'**
  String get mapNewsAreaExplanation;

  /// UC-06: heading for the latest articles that name the selected area.
  ///
  /// In en, this message translates to:
  /// **'Latest articles'**
  String get mapNewsAreaLatest;

  /// UC-06: how many of the area's articles the list shows.
  ///
  /// In en, this message translates to:
  /// **'Showing {shown} of {total}'**
  String mapNewsAreaShowing(String shown, String total);

  /// UC-06: opens the original article of a listed news item.
  ///
  /// In en, this message translates to:
  /// **'Open article'**
  String get mapNewsAreaOpenArticle;

  /// Heading for the bounded, snapshot-bound member records list.
  ///
  /// In en, this message translates to:
  /// **'Group members'**
  String get mapAggregateMembersTitle;

  /// Number of unique member records currently retrieved by the client; this is never substituted for the full-query total.
  ///
  /// In en, this message translates to:
  /// **'Member records retrieved: {count}'**
  String mapAggregateMembersLoaded(String count);

  /// Preserves the member-page producer's supplied unit, separately from the client record count.
  ///
  /// In en, this message translates to:
  /// **'Member scope unit: {unit}'**
  String mapAggregateMemberUnit(String unit);

  /// Readable and accessible progress label for a bounded member-page request.
  ///
  /// In en, this message translates to:
  /// **'Retrieving group members'**
  String get mapAggregateMembersLoading;

  /// An expired group cannot be resumed using stale cursors; a new viewport snapshot is required.
  ///
  /// In en, this message translates to:
  /// **'This group snapshot has expired. Refresh the map and select the group again.'**
  String get mapAggregateSnapshotExpired;

  /// Action requesting a new viewport snapshot after the member snapshot expires.
  ///
  /// In en, this message translates to:
  /// **'Refresh map snapshot'**
  String get mapAggregateRefreshSnapshot;

  /// Manual action for retryable member requests; retained members keep their original source time.
  ///
  /// In en, this message translates to:
  /// **'Retry group members'**
  String get mapAggregateMembersRetry;

  /// Describes an empty successful member page without asserting a measured zero or verified source-wide no-match coverage.
  ///
  /// In en, this message translates to:
  /// **'No member records were returned for this group.'**
  String get mapAggregateMembersEmpty;

  /// The client stops after its bounded row/page limit while preserving unknown or partial totals.
  ///
  /// In en, this message translates to:
  /// **'This list has reached its display limit. More records may exist; zoom to the group for a narrower view.'**
  String get mapAggregateMembersBounded;

  /// Keyboard-accessible manual action fetching the next bounded snapshot-bound member page.
  ///
  /// In en, this message translates to:
  /// **'Retrieve more group members'**
  String get mapAggregateMembersMore;

  /// Heading of the persistent selected-object details panel.
  ///
  /// In en, this message translates to:
  /// **'Selected record'**
  String get mapDetailsTitle;

  /// Accessible close action; Escape also closes focused details.
  ///
  /// In en, this message translates to:
  /// **'Close selected record details'**
  String get mapDetailsClose;

  /// Camera movement retains the selected original snapshot; absence is not removal.
  ///
  /// In en, this message translates to:
  /// **'This record is outside the current view. Its original details are retained.'**
  String get mapDetailsOffscreen;

  /// Filter exclusion keeps original detail and explicitly clears the geographic highlight.
  ///
  /// In en, this message translates to:
  /// **'This record no longer matches the selected layers or filters. Its map highlight is cleared.'**
  String get mapDetailsFilterExcluded;

  /// Confirmed missing or no-longer-public selected record without implying an empty viewport.
  ///
  /// In en, this message translates to:
  /// **'This record is no longer available. Its details and map highlight are cleared.'**
  String get mapDetailsRemoved;

  /// Explicit retraction removes public content and selection highlight.
  ///
  /// In en, this message translates to:
  /// **'This record has been withdrawn. Its details and map highlight are cleared.'**
  String get mapDetailsWithdrawn;

  /// Evidence-based aggregate linkage preserves the selected individual record.
  ///
  /// In en, this message translates to:
  /// **'The selected record belongs to the highlighted aggregate. These are its original details.'**
  String get mapDetailsInAggregate;

  /// A snapshot-bound detail request is in progress.
  ///
  /// In en, this message translates to:
  /// **'Loading selected record details'**
  String get mapDetailsLoading;

  /// Safe detail request failure; raw errors are not displayed.
  ///
  /// In en, this message translates to:
  /// **'Could not retrieve selected record details'**
  String get mapDetailsError;

  /// Expired detail snapshot retains original facts and never silently queries a newer publication.
  ///
  /// In en, this message translates to:
  /// **'The selected data snapshot has expired. Select a record from a refreshed map to request new details.'**
  String get mapDetailsSnapshotExpired;

  /// Typed fact label and value; null is explicitly unknown.
  ///
  /// In en, this message translates to:
  /// **'{label}: {value}'**
  String mapDetailFact(String label, String value);

  /// Unknown nullable fact value; never a measured zero.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get mapDetailUnknown;

  /// Explicit planned assertion label independent of colour.
  ///
  /// In en, this message translates to:
  /// **'Plan'**
  String get mapDetailPlan;

  /// A parking sensor whose own current reading detects no car.
  ///
  /// In en, this message translates to:
  /// **'Vacant now (live sensor)'**
  String get mapDetailParkingVacant;

  /// A parking sensor whose own current reading detects a car.
  ///
  /// In en, this message translates to:
  /// **'Occupied (live sensor)'**
  String get mapDetailParkingOccupied;

  /// A parking sensor whose reading cannot be shown; never presented as vacant.
  ///
  /// In en, this message translates to:
  /// **'No current reading'**
  String get mapDetailParkingNoData;

  /// Why a parking sensor has no current reading: its own last report is too old.
  ///
  /// In en, this message translates to:
  /// **'This sensor has stopped reporting, so its last status is not shown.'**
  String get mapDetailParkingNotReporting;

  /// Why parking sensors have no current reading on a public holiday.
  ///
  /// In en, this message translates to:
  /// **'Bay sensors do not operate on public holidays.'**
  String get mapDetailParkingPublicHoliday;

  /// Why parking sensors have no current reading when the holiday calendar is not known.
  ///
  /// In en, this message translates to:
  /// **'Today\'s public holiday status is not known, so sensor readings are not shown.'**
  String get mapDetailParkingHolidayUnknown;

  /// Why a parking sensor has no current reading: the source gives no status.
  ///
  /// In en, this message translates to:
  /// **'This sensor has no status.'**
  String get mapDetailParkingNoStatus;

  /// A parking reading that is late but still shown.
  ///
  /// In en, this message translates to:
  /// **'This reading is a few minutes old.'**
  String get mapDetailParkingLate;

  /// Label for the sensor's own last report time.
  ///
  /// In en, this message translates to:
  /// **'Sensor last reported'**
  String get mapDetailParkingLastReported;

  /// Label for when the sensor's occupied/vacant status last changed.
  ///
  /// In en, this message translates to:
  /// **'Status last changed'**
  String get mapDetailParkingStatusChanged;

  /// Label for the City of Melbourne parking zone number of a sensor.
  ///
  /// In en, this message translates to:
  /// **'Parking zone'**
  String get mapDetailParkingZone;

  /// Always shown with a parking sensor: occupancy is never legal permission.
  ///
  /// In en, this message translates to:
  /// **'A vacant sensor only means no car is detected. It does not mean you may park here now: check the signs for limits, permits and fees.'**
  String get mapDetailParkingNotLegal;

  /// Always shown with a parking sensor: a vacant reading can be a blocked bay.
  ///
  /// In en, this message translates to:
  /// **'Works or construction can block a bay that still reads vacant.'**
  String get mapDetailParkingObstruction;

  /// Direction counters do not imply geographic movement or headings.
  ///
  /// In en, this message translates to:
  /// **'Directions A and B are source channels; geographic headings are not known.'**
  String get mapDetailDirectionsUncalibrated;

  /// Source measurement interval is minute-based.
  ///
  /// In en, this message translates to:
  /// **'Observation granularity: minute'**
  String get mapDetailMinuteGranularity;

  /// Source measurement interval is hourly, never presented as minute data.
  ///
  /// In en, this message translates to:
  /// **'Observation granularity: hour'**
  String get mapDetailHourGranularity;

  /// Geometry simplification does not improve or enlarge source precision.
  ///
  /// In en, this message translates to:
  /// **'Simplified display geometry; the source location precision is retained.'**
  String get mapDetailSimplified;

  /// Original sourced point precision.
  ///
  /// In en, this message translates to:
  /// **'Location precision: point'**
  String get mapDetailPointPrecision;

  /// Original sourced line precision.
  ///
  /// In en, this message translates to:
  /// **'Location precision: line'**
  String get mapDetailLinePrecision;

  /// Area precision must remain area-level when zooming in.
  ///
  /// In en, this message translates to:
  /// **'Location precision: area'**
  String get mapDetailAreaPrecision;

  /// No trustworthy drawable location is available.
  ///
  /// In en, this message translates to:
  /// **'Location precision: unlocated'**
  String get mapDetailUnlocatedPrecision;

  /// Event-site role from the typed location contract.
  ///
  /// In en, this message translates to:
  /// **'Location role: evidenced event site'**
  String get mapDetailRoleEventSite;

  /// Sensor location role from the typed contract.
  ///
  /// In en, this message translates to:
  /// **'Location role: sensor'**
  String get mapDetailRoleSensor;

  /// Source-evidenced affected geography rather than a guessed site.
  ///
  /// In en, this message translates to:
  /// **'Location role: affected extent'**
  String get mapDetailRoleAffectedExtent;

  /// Original statistical geography remains visible.
  ///
  /// In en, this message translates to:
  /// **'Location role: statistical area'**
  String get mapDetailRoleStatisticalArea;

  /// Area association is not an exact event-site location.
  ///
  /// In en, this message translates to:
  /// **'Location role: area association'**
  String get mapDetailRoleAreaAssociation;

  /// A mentioned place is not an evidenced event location.
  ///
  /// In en, this message translates to:
  /// **'Location role: mentioned place'**
  String get mapDetailRoleMention;

  /// No reliable geographic role is supplied.
  ///
  /// In en, this message translates to:
  /// **'Location role: unknown'**
  String get mapDetailRoleUnknown;

  /// Record active lifecycle or event status.
  ///
  /// In en, this message translates to:
  /// **'Status: active'**
  String get mapDetailActive;

  /// Planned lifecycle or event status is not presented as active.
  ///
  /// In en, this message translates to:
  /// **'Status: planned'**
  String get mapDetailPlanned;

  /// Cancelled lifecycle or event status is explicit.
  ///
  /// In en, this message translates to:
  /// **'Status: cancelled'**
  String get mapDetailCancelled;

  /// Resolved lifecycle or event status is explicit.
  ///
  /// In en, this message translates to:
  /// **'Status: resolved'**
  String get mapDetailResolved;

  /// Source event status is unknown.
  ///
  /// In en, this message translates to:
  /// **'Status: unknown'**
  String get mapDetailStatusUnknown;

  /// Transport disruption affects an evidenced road segment.
  ///
  /// In en, this message translates to:
  /// **'Affected extent: road segment'**
  String get mapDetailExtentRoad;

  /// Transport disruption affects a route.
  ///
  /// In en, this message translates to:
  /// **'Affected extent: route'**
  String get mapDetailExtentRoute;

  /// Transport disruption affects a stop.
  ///
  /// In en, this message translates to:
  /// **'Affected extent: stop'**
  String get mapDetailExtentStop;

  /// Transport disruption affects an area.
  ///
  /// In en, this message translates to:
  /// **'Affected extent: area'**
  String get mapDetailExtentArea;

  /// Transport disruption extent is unknown.
  ///
  /// In en, this message translates to:
  /// **'Affected extent: unknown'**
  String get mapDetailExtentUnknown;

  /// A sensor location is valid for the observation.
  ///
  /// In en, this message translates to:
  /// **'Sensor location status: located'**
  String get mapDetailLocationLocated;

  /// A sensor lacks a reliable drawable location.
  ///
  /// In en, this message translates to:
  /// **'Sensor location status: unlocated'**
  String get mapDetailLocationUnlocated;

  /// Ambiguous sensor location must not be guessed.
  ///
  /// In en, this message translates to:
  /// **'Sensor location status: ambiguous'**
  String get mapDetailLocationAmbiguous;

  /// Inactive sensor location does not establish observation coverage.
  ///
  /// In en, this message translates to:
  /// **'Sensor location status: inactive'**
  String get mapDetailLocationInactive;

  /// An indicator is missing rather than measured zero.
  ///
  /// In en, this message translates to:
  /// **'Value missing'**
  String get mapDetailValueMissing;

  /// A statistical value is withheld and must not be inferred.
  ///
  /// In en, this message translates to:
  /// **'Value suppressed'**
  String get mapDetailValueSuppressed;

  /// Scoped unlocated-list heading, distinct from viewport results.
  ///
  /// In en, this message translates to:
  /// **'Records without map locations'**
  String get mapUnlocatedTitle;

  /// Accessible close action for the unlocated list.
  ///
  /// In en, this message translates to:
  /// **'Close records without map locations'**
  String get mapUnlocatedClose;

  /// Shows the exact caller-approved area association identifiers.
  ///
  /// In en, this message translates to:
  /// **'Associated area references: {scope}'**
  String mapUnlocatedAreaScope(String scope);

  /// Shows the exact approved source jurisdiction supplied by the caller.
  ///
  /// In en, this message translates to:
  /// **'Source jurisdiction: {scope}'**
  String mapUnlocatedJurisdictionScope(String scope);

  /// Unlocated facts never inherit guessed centroids or viewport membership.
  ///
  /// In en, this message translates to:
  /// **'These records have no usable map geometry. Association with this scope does not establish membership in the current map view.'**
  String get mapUnlocatedScopeExplanation;

  /// Scoped unlocated request loading status.
  ///
  /// In en, this message translates to:
  /// **'Loading records without map locations'**
  String get mapUnlocatedLoading;

  /// Expired pagination cannot mix old and new publication pages.
  ///
  /// In en, this message translates to:
  /// **'This list snapshot has expired. Restart the list to use a new snapshot.'**
  String get mapUnlocatedSnapshotExpired;

  /// Explicitly clears the old page before creating a new list snapshot.
  ///
  /// In en, this message translates to:
  /// **'Restart scoped list'**
  String get mapUnlocatedRestart;

  /// Empty page only; does not claim verified absence or source coverage.
  ///
  /// In en, this message translates to:
  /// **'No records returned on this page'**
  String get mapUnlocatedEmptyPage;

  /// Replaces the current bounded page using its snapshot-bound cursor.
  ///
  /// In en, this message translates to:
  /// **'Show next page'**
  String get mapUnlocatedNextPage;

  /// Label for the typed record id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Record id'**
  String get mapDetailIdentifier;

  /// Label for the typed record version detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Record version'**
  String get mapDetailVersion;

  /// Label for the typed location evidence detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Location evidence'**
  String get mapDetailLocationEvidence;

  /// Label for the typed sensor id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Sensor id'**
  String get mapDetailSensor;

  /// Label for the typed direction a passages detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Direction A passages'**
  String get mapDetailDirectionA;

  /// Label for the typed direction b passages detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Direction B passages'**
  String get mapDetailDirectionB;

  /// Label for the typed location valid from detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Location valid from'**
  String get mapDetailLocationValidFrom;

  /// Label for the typed location valid until (end excluded) detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Location valid until (end excluded)'**
  String get mapDetailLocationValidTo;

  /// Label for the typed result id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Result id'**
  String get mapDetailResult;

  /// Label for the typed observation id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Observation id'**
  String get mapDetailObservation;

  /// Label for the typed baseline definition id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Baseline definition id'**
  String get mapDetailBaselineDefinition;

  /// Label for the typed baseline value detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Baseline value'**
  String get mapDetailBaselineValue;

  /// Label for the typed observed value detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Observed value'**
  String get mapDetailObservedValue;

  /// Label for the typed difference from baseline detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Difference from baseline'**
  String get mapDetailDelta;

  /// Label for the typed summary detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Summary'**
  String get mapDetailSummary;

  /// Label for the typed impact detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Impact'**
  String get mapDetailImpact;

  /// Label for the typed affected services detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Affected services'**
  String get mapDetailServices;

  /// Label for the typed venue detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Venue'**
  String get mapDetailVenue;

  /// Label for the typed category detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get mapDetailCategory;

  /// Label for the typed starts detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Starts'**
  String get mapDetailStarts;

  /// Label for the typed ends detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Ends'**
  String get mapDetailEnds;

  /// Label for the typed project status detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Project status'**
  String get mapDetailProjectStatus;

  /// Label for the typed permit id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Permit id'**
  String get mapDetailPermit;

  /// Label for the typed boundary id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Boundary id'**
  String get mapDetailBoundary;

  /// Label for the typed boundary level detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Boundary level'**
  String get mapDetailBoundaryLevel;

  /// Label for the typed boundary vintage detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Boundary vintage'**
  String get mapDetailBoundaryVintage;

  /// Label for the typed boundary name detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Boundary name'**
  String get mapDetailBoundaryName;

  /// Label for the typed indicator id detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Indicator id'**
  String get mapDetailIndicator;

  /// Label for the typed value detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Value'**
  String get mapDetailValue;

  /// Label for the typed unit detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Unit'**
  String get mapDetailUnit;

  /// Label for the typed property type detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Property type'**
  String get mapDetailPropertyType;

  /// Label for the typed definition detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Definition'**
  String get mapDetailDefinition;

  /// Label for the typed metric detail field; null values are unknown.
  ///
  /// In en, this message translates to:
  /// **'Metric'**
  String get mapDetailMetric;

  /// Map screen title.
  ///
  /// In en, this message translates to:
  /// **'Melens map'**
  String get mapScreenTitle;

  /// Opens selected layer status and coverage information.
  ///
  /// In en, this message translates to:
  /// **'Layer statuses'**
  String get mapScreenStatuses;

  /// Opens independently scoped records without drawable geometry.
  ///
  /// In en, this message translates to:
  /// **'Records without map locations'**
  String get mapScreenUnlocated;

  /// Catalog request is in progress.
  ///
  /// In en, this message translates to:
  /// **'Loading layer catalog…'**
  String get mapScreenCatalogLoading;

  /// Safe catalog failure text.
  ///
  /// In en, this message translates to:
  /// **'Layer catalog could not load.'**
  String get mapScreenCatalogError;

  /// Manual catalog retry while query bounds are unavailable.
  ///
  /// In en, this message translates to:
  /// **'Retry layer catalog'**
  String get mapScreenRetryCatalog;

  /// Outside operational envelope, with no claim about coverage.
  ///
  /// In en, this message translates to:
  /// **'This view is outside the query service area.'**
  String get mapScreenOutsideService;

  /// No bounded query area supplied.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the map area or query service bounds.'**
  String get mapScreenWaitingArea;

  /// Explicit catalog-bounds fallback list scope.
  ///
  /// In en, this message translates to:
  /// **'Results use the query service area until a map view is available.'**
  String get mapScreenServiceArea;

  /// Layers lacking required approved filters are blocked.
  ///
  /// In en, this message translates to:
  /// **'Boundary or area layers need a published version and filter before querying.'**
  String get mapScreenFilterRequired;

  /// The parking layer is on, but the map is zoomed out too far to read it.
  ///
  /// In en, this message translates to:
  /// **'Zoom in to see parking.'**
  String get mapParkingZoomIn;

  /// Safe visible-region failure.
  ///
  /// In en, this message translates to:
  /// **'The visible map area could not be read.'**
  String get mapScreenRegionError;

  /// Retained response belongs to an earlier time window.
  ///
  /// In en, this message translates to:
  /// **'Displayed records keep their previous query window.'**
  String get mapScreenPreviousWindow;

  /// Current mode with bounded recent fifteen-minute window.
  ///
  /// In en, this message translates to:
  /// **'Current · last 15 minutes'**
  String get mapScreenCurrent;

  /// Historical mode for bounded past windows.
  ///
  /// In en, this message translates to:
  /// **'Historical'**
  String get mapScreenHistorical;

  /// Historical duration menu.
  ///
  /// In en, this message translates to:
  /// **'History range'**
  String get mapScreenHistoryRange;

  /// Historical duration.
  ///
  /// In en, this message translates to:
  /// **'1 hour'**
  String get mapScreenOneHour;

  /// Historical duration.
  ///
  /// In en, this message translates to:
  /// **'24 hours'**
  String get mapScreenOneDay;

  /// Historical duration.
  ///
  /// In en, this message translates to:
  /// **'7 days'**
  String get mapScreenSevenDays;

  /// Maximum dynamic query duration.
  ///
  /// In en, this message translates to:
  /// **'31 days'**
  String get mapScreenThirtyOneDays;

  /// Move historical window back by its duration.
  ///
  /// In en, this message translates to:
  /// **'Previous time window'**
  String get mapScreenPrevious;

  /// Move historical window forward up to now.
  ///
  /// In en, this message translates to:
  /// **'Next time window'**
  String get mapScreenNext;

  /// Manual viewport refresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh records'**
  String get mapScreenRefresh;

  /// Half-open query interval in Australia/Melbourne.
  ///
  /// In en, this message translates to:
  /// **'Melbourne time: {from} to {to} (end excluded)'**
  String mapScreenWindow(String from, String to);

  /// Direction supplied by the verified anomaly producer; no client threshold or sign inference.
  ///
  /// In en, this message translates to:
  /// **'Direction: higher than the baseline'**
  String get mapAnomalyDirectionHigher;

  /// Lower direction supplied by the anomaly producer.
  ///
  /// In en, this message translates to:
  /// **'Direction: lower than the baseline'**
  String get mapAnomalyDirectionLower;

  /// Producer explicitly supplies no difference direction; never a substitute for unknown.
  ///
  /// In en, this message translates to:
  /// **'Direction: no change from the baseline'**
  String get mapAnomalyDirectionNone;

  /// Producer direction is unknown and must not be inferred from counts.
  ///
  /// In en, this message translates to:
  /// **'Direction: unknown'**
  String get mapAnomalyDirectionUnknown;

  /// Producer explicitly confirms eligibility for its own baseline definition.
  ///
  /// In en, this message translates to:
  /// **'Eligibility: eligible'**
  String get mapAnomalyEligible;

  /// Producer has excluded this observation from classification.
  ///
  /// In en, this message translates to:
  /// **'Eligibility: ineligible'**
  String get mapAnomalyIneligible;

  /// No producer eligibility conclusion is available.
  ///
  /// In en, this message translates to:
  /// **'Eligibility: unknown'**
  String get mapAnomalyEligibilityUnknown;

  /// Anomalous classification supplied by the producer, independent of display colour.
  ///
  /// In en, this message translates to:
  /// **'Classification: anomalous'**
  String get mapAnomalyClassified;

  /// Explicit producer classification; an unclassified observation never receives this text.
  ///
  /// In en, this message translates to:
  /// **'Classification: not anomalous'**
  String get mapAnomalyNotAnomalous;

  /// Producer supplied no classification; absence of a baseline is not normal activity.
  ///
  /// In en, this message translates to:
  /// **'Classification: unclassified'**
  String get mapAnomalyUnclassified;

  /// Anomaly comparison is not a causal explanation. This view does not invent possible causes or call AI.
  ///
  /// In en, this message translates to:
  /// **'A difference from the baseline does not establish a cause.'**
  String get mapAnomalyCauseUnestablished;

  /// Title of the chat panel before a conversation has a title.
  ///
  /// In en, this message translates to:
  /// **'Agent chat'**
  String get chatPanelTitle;

  /// Tooltip of the map toolbar button that opens the chat panel.
  ///
  /// In en, this message translates to:
  /// **'Open the agent chat'**
  String get chatOpen;

  /// Tooltip of the chat panel's close button.
  ///
  /// In en, this message translates to:
  /// **'Close the agent chat'**
  String get chatClose;

  /// Title of the session list and tooltip of the button that opens it.
  ///
  /// In en, this message translates to:
  /// **'Conversations'**
  String get chatSessions;

  /// Button that starts a new conversation on the server.
  ///
  /// In en, this message translates to:
  /// **'New conversation'**
  String get chatNewSession;

  /// Tooltip of the delete button on a session row.
  ///
  /// In en, this message translates to:
  /// **'Delete conversation'**
  String get chatDeleteSession;

  /// Session row title before its first message.
  ///
  /// In en, this message translates to:
  /// **'Untitled conversation'**
  String get chatSessionUntitled;

  /// Session row subtitle: the turn count and the last update time. {count} is a number, {updated} a formatted date and time.
  ///
  /// In en, this message translates to:
  /// **'{count} turns, updated {updated}'**
  String chatSessionMeta(int count, String updated);

  /// Shown while the session list loads.
  ///
  /// In en, this message translates to:
  /// **'Loading conversations…'**
  String get chatSessionsLoading;

  /// Shown when the user has no stored sessions.
  ///
  /// In en, this message translates to:
  /// **'No conversations yet.'**
  String get chatNoSessions;

  /// Shown while a stored session is fetched.
  ///
  /// In en, this message translates to:
  /// **'Restoring the conversation…'**
  String get chatRestoring;

  /// Body of an empty conversation, with example prompts.
  ///
  /// In en, this message translates to:
  /// **'Ask about what is on the map, for example \"What\'s around here?\" or \"Only show live music tonight.\"'**
  String get chatEmpty;

  /// Placeholder of the chat input box.
  ///
  /// In en, this message translates to:
  /// **'Ask about the map…'**
  String get chatInputHint;

  /// Hint in the chat input while a turn runs: sending a message stops the turn and answers the new one.
  ///
  /// In en, this message translates to:
  /// **'Type to interrupt with a new message…'**
  String get chatInputHintRunning;

  /// Tooltip of the button that adds photos to the next message.
  ///
  /// In en, this message translates to:
  /// **'Attach photos'**
  String get chatAttachPhotos;

  /// Menu item: pick photos from the device's gallery or files.
  ///
  /// In en, this message translates to:
  /// **'Choose photos'**
  String get chatPhotoGallery;

  /// Menu item: take a photo with the camera.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get chatPhotoCamera;

  /// Tooltip of the button that removes a photo from the next message.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get chatPhotoRemove;

  /// Shown when the user tries to attach more photos than one message carries.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{One photo per message.} other{Up to {count} photos per message.}}'**
  String chatPhotoLimit(int count);

  /// Shown when picked photos could not be read or shrunk below the size limit.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{One photo could not be used: it is unreadable or too large.} other{{count} photos could not be used: they are unreadable or too large.}}'**
  String chatPhotosRejected(int count);

  /// Shown when the gallery or camera fails to open, for example without permission.
  ///
  /// In en, this message translates to:
  /// **'The photo picker could not be opened.'**
  String get chatPhotoPickFailed;

  /// Accessibility label of a photo in the chat.
  ///
  /// In en, this message translates to:
  /// **'Photo {index}'**
  String chatPhoto(int index);

  /// Shown in place of a stored photo that could not be loaded.
  ///
  /// In en, this message translates to:
  /// **'Photo unavailable'**
  String get chatPhotoUnavailable;

  /// Tooltip of the send button.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get chatSend;

  /// Tooltip of the button that cancels the turn in progress.
  ///
  /// In en, this message translates to:
  /// **'Stop this turn'**
  String get chatStop;

  /// Button that sends the failed input or request again.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get chatRetry;

  /// Shown while a turn runs before any status or text arrived.
  ///
  /// In en, this message translates to:
  /// **'Thinking…'**
  String get chatThinking;

  /// Progress line under a running turn while the answer text streams and no tool call is running.
  ///
  /// In en, this message translates to:
  /// **'Writing…'**
  String get chatWriting;

  /// How many rows a finished tool call returned, shown on its step row.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 result} other{{count} results}}'**
  String chatStepRows(int count);

  /// Marks a step whose tool call was answered from an identical earlier call in the same turn.
  ///
  /// In en, this message translates to:
  /// **'reused'**
  String get chatStepMemo;

  /// Duration of a tool call of one second or more, shown on its step row.
  ///
  /// In en, this message translates to:
  /// **'{seconds} s'**
  String chatStepSeconds(String seconds);

  /// Duration of a tool call under one second, shown on its step row.
  ///
  /// In en, this message translates to:
  /// **'{millis} ms'**
  String chatStepMillis(int millis);

  /// A failed step whose tool error code the app has no label for; the code is shown as sent.
  ///
  /// In en, this message translates to:
  /// **'failed: {code}'**
  String chatStepFailed(String code);

  /// Step outcome when the agent called a tool with arguments the server rejected.
  ///
  /// In en, this message translates to:
  /// **'invalid arguments'**
  String get chatToolErrorInvalidArguments;

  /// Step outcome when a tool could not find the feature or place asked for.
  ///
  /// In en, this message translates to:
  /// **'not found'**
  String get chatToolErrorNotFound;

  /// Step outcome when analyse_anomaly was called on a feature that is not an anomaly.
  ///
  /// In en, this message translates to:
  /// **'not an anomaly'**
  String get chatToolErrorNotAnAnomaly;

  /// Step outcome when a card cited sources no tool returned in the turn.
  ///
  /// In en, this message translates to:
  /// **'unverified sources'**
  String get chatToolErrorUnverifiedSources;

  /// Step outcome when draw_route could not find a route.
  ///
  /// In en, this message translates to:
  /// **'no route found'**
  String get chatToolErrorRouteNotFound;

  /// Step outcome when the data source or a Google API did not answer.
  ///
  /// In en, this message translates to:
  /// **'source unavailable'**
  String get chatToolErrorUpstreamUnavailable;

  /// Title of the details pane that shows a tapped card item which is not a map record.
  ///
  /// In en, this message translates to:
  /// **'Agent result'**
  String get cardItemDetailsTitle;

  /// Tooltip of the close button of the card item details pane.
  ///
  /// In en, this message translates to:
  /// **'Close the result details'**
  String get cardItemDetailsClose;

  /// Explains, in the card item details pane, why the item has no map record details.
  ///
  /// In en, this message translates to:
  /// **'This result is not a record on the map. It comes from the source below, as the agent reported it.'**
  String get cardItemDetailsNotOnMap;

  /// Button in the card item details pane that opens the item's source link.
  ///
  /// In en, this message translates to:
  /// **'Open the source'**
  String get cardItemDetailsOpenSource;

  /// Shown under a turn the user cancelled.
  ///
  /// In en, this message translates to:
  /// **'Stopped.'**
  String get chatTurnCancelled;

  /// Shown when a turn ended because of the model call budget.
  ///
  /// In en, this message translates to:
  /// **'The agent reached its call budget and wrapped up.'**
  String get chatStopBudget;

  /// Shown under a question whose options are not exhaustive.
  ///
  /// In en, this message translates to:
  /// **'Or type your own answer below.'**
  String get chatQuestionFreeText;

  /// User bubble for an area input. {lat} and {lng} are coordinates.
  ///
  /// In en, this message translates to:
  /// **'Selected the point {lat}, {lng}'**
  String chatInputArea(String lat, String lng);

  /// User bubble for an Analyse tap on a marker. {featureId} is the feature id.
  ///
  /// In en, this message translates to:
  /// **'Analyse {featureId}'**
  String chatInputAnalyse(String featureId);

  /// User bubble for a tapped question option. {value} is the option text.
  ///
  /// In en, this message translates to:
  /// **'Answer: {value}'**
  String chatInputAnswer(String value);

  /// Chip that sends the selected anomaly marker to the agent for analysis.
  ///
  /// In en, this message translates to:
  /// **'Analyse this anomaly'**
  String get chatAnalyseSelected;

  /// Chip that asks the agent what is around the selected point.
  ///
  /// In en, this message translates to:
  /// **'Brief this area'**
  String get chatBriefSelected;

  /// Token usage of a turn, from Gemini's own counts: ↑ marks input (prompt) tokens, ↓ output tokens. All placeholders are formatted numbers.
  ///
  /// In en, this message translates to:
  /// **'{calls} calls · ↑ {input} ({cached} cached) · ↓ {output} · {thoughts} thinking · {total} total'**
  String chatUsage(
    int calls,
    String input,
    String cached,
    String output,
    String thoughts,
    String total,
  );

  /// Tooltip on a turn's token usage line, explaining the arrows.
  ///
  /// In en, this message translates to:
  /// **'↑ input tokens sent to Gemini, with the part served from its cache · ↓ output tokens Gemini wrote · thinking tokens are billed as output'**
  String get chatUsageTooltip;

  /// Shown when the turn's usage totals miss a cancelled or failed model call.
  ///
  /// In en, this message translates to:
  /// **'Usage is incomplete: a model call was cut off.'**
  String get chatUsageIncomplete;

  /// Label of a show_layers UI action.
  ///
  /// In en, this message translates to:
  /// **'Show layers'**
  String get chatActionShowLayers;

  /// Label of a focus_map UI action.
  ///
  /// In en, this message translates to:
  /// **'Focus map'**
  String get chatActionFocusMap;

  /// Label of a draw_route UI action.
  ///
  /// In en, this message translates to:
  /// **'Draw route'**
  String get chatActionDrawRoute;

  /// Label of a highlight_features UI action.
  ///
  /// In en, this message translates to:
  /// **'Highlight features'**
  String get chatActionHighlight;

  /// Outcome of a UI action the map applied in full.
  ///
  /// In en, this message translates to:
  /// **'applied'**
  String get chatActionApplied;

  /// Outcome of a UI action the map applied in part.
  ///
  /// In en, this message translates to:
  /// **'partly applied'**
  String get chatActionPartial;

  /// Outcome of a UI action the map could not apply.
  ///
  /// In en, this message translates to:
  /// **'ignored'**
  String get chatActionIgnored;

  /// Outcome of a UI action read back from a stored turn; it is not applied again.
  ///
  /// In en, this message translates to:
  /// **'from history'**
  String get chatActionRestored;

  /// Tooltip listing the layers or feature ids a UI action could not use. {items} is a comma-separated list.
  ///
  /// In en, this message translates to:
  /// **'Not applied: {items}'**
  String chatActionSkipped(String items);

  /// Shown when the build has no Firebase configuration for this platform and no development token.
  ///
  /// In en, this message translates to:
  /// **'Agent sign-in is not configured. Add the FIREBASE_ keys to config/dev.json (cloud/agent/infra/firebase.sh --app-config), or AGENT_DEV_TOKEN for a local agent.'**
  String get chatErrorSignIn;

  /// Shown when anonymous sign-in or fetching its ID token failed for a reason other than the network.
  ///
  /// In en, this message translates to:
  /// **'Could not sign in to the agent service. Try again.'**
  String get chatErrorSignInFailed;

  /// Shown when the agent request failed before a response.
  ///
  /// In en, this message translates to:
  /// **'The agent service could not be reached.'**
  String get chatErrorNetwork;

  /// Shown when the agent request or turn timed out.
  ///
  /// In en, this message translates to:
  /// **'The agent service timed out.'**
  String get chatErrorTimeout;

  /// Shown on HTTP 401 from the agent service.
  ///
  /// In en, this message translates to:
  /// **'The agent service rejected the sign-in token.'**
  String get chatErrorUnauthorized;

  /// Shown on HTTP 404 from the agent service.
  ///
  /// In en, this message translates to:
  /// **'This conversation no longer exists on the server.'**
  String get chatErrorNotFound;

  /// Shown on HTTP 409 from the agent service.
  ///
  /// In en, this message translates to:
  /// **'Another turn is still running in this conversation. Try again in a moment.'**
  String get chatErrorTurnInProgress;

  /// Shown on HTTP 429 from the agent service.
  ///
  /// In en, this message translates to:
  /// **'Too many turns in the last hour. Try again later.'**
  String get chatErrorRateLimited;

  /// Shown on HTTP 503 from the agent service.
  ///
  /// In en, this message translates to:
  /// **'The agent service is unavailable right now.'**
  String get chatErrorUnavailable;

  /// Shown on HTTP 400 from the agent service.
  ///
  /// In en, this message translates to:
  /// **'The agent service rejected the request.'**
  String get chatErrorInvalidRequest;

  /// Shown on an HTTP error without a known code.
  ///
  /// In en, this message translates to:
  /// **'The agent service returned an unexpected error.'**
  String get chatErrorHttp;

  /// Shown when a response or event did not match the protocol.
  ///
  /// In en, this message translates to:
  /// **'The agent service sent something the app could not read.'**
  String get chatErrorProtocol;

  /// Shown when the event stream closed without a done or error event.
  ///
  /// In en, this message translates to:
  /// **'The turn ended before the agent finished.'**
  String get chatErrorStreamEnded;

  /// An error event from the agent service. {message} is the server's text.
  ///
  /// In en, this message translates to:
  /// **'Agent error: {message}'**
  String chatErrorServer(String message);

  /// Label of an area_brief card.
  ///
  /// In en, this message translates to:
  /// **'Area brief'**
  String get cardTypeAreaBrief;

  /// Label of an anomaly_analysis card.
  ///
  /// In en, this message translates to:
  /// **'Anomaly analysis'**
  String get cardTypeAnomalyAnalysis;

  /// Label of a plan card; stops are numbered in visiting order.
  ///
  /// In en, this message translates to:
  /// **'Plan'**
  String get cardTypePlan;

  /// Label of a history card.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get cardTypeHistory;

  /// Label of a list card.
  ///
  /// In en, this message translates to:
  /// **'List'**
  String get cardTypeList;

  /// A card item's time window. {time} is a formatted range.
  ///
  /// In en, this message translates to:
  /// **'When: {time}'**
  String cardItemTime(String time);

  /// A time window with both ends. {from} and {to} are formatted local times.
  ///
  /// In en, this message translates to:
  /// **'{from} – {to}'**
  String cardTimeRange(String from, String to);

  /// A time window with only a start. {from} is a formatted local time.
  ///
  /// In en, this message translates to:
  /// **'from {from}'**
  String cardTimeFrom(String from);

  /// A time window with only an end. {to} is a formatted local time.
  ///
  /// In en, this message translates to:
  /// **'until {to}'**
  String cardTimeUntil(String to);

  /// A card item's cost. {cost} is the server's text.
  ///
  /// In en, this message translates to:
  /// **'Cost: {cost}'**
  String cardItemCost(String cost);

  /// A card item's directions hint. {text} is the server's text.
  ///
  /// In en, this message translates to:
  /// **'Getting there: {text}'**
  String cardItemGettingThere(String text);

  /// A parking card bay whose live sensor reads vacant.
  ///
  /// In en, this message translates to:
  /// **'Vacant now'**
  String get cardParkingVacant;

  /// A parking card bay whose live sensor reads occupied.
  ///
  /// In en, this message translates to:
  /// **'Occupied'**
  String get cardParkingOccupied;

  /// A parking card bay whose sensor has no current reading.
  ///
  /// In en, this message translates to:
  /// **'No reading'**
  String get cardParkingNoData;

  /// Badge on the parking bay the map moved to: the nearest vacant one.
  ///
  /// In en, this message translates to:
  /// **'Best match'**
  String get cardParkingBest;

  /// A bay's straight-line distance to the destination the user named.
  ///
  /// In en, this message translates to:
  /// **'{distance} to {destination}, about {minutes} min walk'**
  String cardParkingDistanceTo(
    String distance,
    String destination,
    int minutes,
  );

  /// A bay's straight-line distance to the destination when it has no name.
  ///
  /// In en, this message translates to:
  /// **'{distance} to your destination, about {minutes} min walk'**
  String cardParkingDistance(String distance, int minutes);

  /// Label of the area's parking fee on a parking card bay.
  ///
  /// In en, this message translates to:
  /// **'Fee'**
  String get cardParkingFee;

  /// Label of the area's usual time limit on a parking card bay.
  ///
  /// In en, this message translates to:
  /// **'Time limit'**
  String get cardParkingTimeLimit;

  /// Label of the days and hours the area's fee and limit apply.
  ///
  /// In en, this message translates to:
  /// **'Applies'**
  String get cardParkingHours;

  /// Label of how drivers pay in the area.
  ///
  /// In en, this message translates to:
  /// **'Pay by'**
  String get cardParkingPayment;

  /// Note under a parking card bay's fee and limits, which describe the area, not this bay.
  ///
  /// In en, this message translates to:
  /// **'Published rules for this area. The sign at the bay decides.'**
  String get cardParkingAreaRules;

  /// Shown on a parking card bay when no source gave the area's rules.
  ///
  /// In en, this message translates to:
  /// **'Fee and time limit not published for this bay. Check the sign at the bay.'**
  String get cardParkingRulesUnknown;

  /// The parking zone number a bay sensor reports.
  ///
  /// In en, this message translates to:
  /// **'Zone {zone}'**
  String cardParkingZone(int zone);

  /// When a bay sensor last reported, Melbourne local time.
  ///
  /// In en, this message translates to:
  /// **'Sensor reported {time}'**
  String cardParkingReported(String time);

  /// A card item that cites a map feature. {id} is the feature id.
  ///
  /// In en, this message translates to:
  /// **'Source: map feature {id}'**
  String cardSourceFeature(String id);

  /// A card item that cites a web page. {title} is the page title or host.
  ///
  /// In en, this message translates to:
  /// **'Source: {title}'**
  String cardSourceLink(String title);

  /// Required attribution under a card that used Google Maps grounding.
  ///
  /// In en, this message translates to:
  /// **'Place details from Google Maps'**
  String get cardGoogleMapsAttribution;

  /// Label of the chip row listing features the agent highlighted.
  ///
  /// In en, this message translates to:
  /// **'Highlighted by the agent'**
  String get mapAgentHighlights;

  /// Button that clears the agent's highlights.
  ///
  /// In en, this message translates to:
  /// **'Clear highlights'**
  String get mapAgentHighlightsClear;

  /// Label of the bottom tab that opens the home page: saved plans and the user's feeds.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get tabFeed;

  /// Label of the bottom tab that opens the map.
  ///
  /// In en, this message translates to:
  /// **'Discover'**
  String get tabDiscover;

  /// Label of the bottom tab that opens settings, and the settings title.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get tabSettings;

  /// Button on the not-found screen that opens the Home tab.
  ///
  /// In en, this message translates to:
  /// **'Back to Home'**
  String get notFoundBackToFeed;

  /// Small label on demo content that is not real.
  ///
  /// In en, this message translates to:
  /// **'Sample'**
  String get sampleBadge;

  /// Large title of the feed.
  ///
  /// In en, this message translates to:
  /// **'Melbourne'**
  String get feedTitle;

  /// Tooltip of the feed button that opens the event editor.
  ///
  /// In en, this message translates to:
  /// **'Host an event'**
  String get feedHostEvent;

  /// Feed topic: events people publish in the app.
  ///
  /// In en, this message translates to:
  /// **'Community events'**
  String get feedTopicCommunity;

  /// Feed topic: official events from the events layer.
  ///
  /// In en, this message translates to:
  /// **'Events'**
  String get feedTopicEvents;

  /// Feed topic: road and tram disruptions.
  ///
  /// In en, this message translates to:
  /// **'Disruptions'**
  String get feedTopicDisruptions;

  /// Feed topic: news by area.
  ///
  /// In en, this message translates to:
  /// **'Local news'**
  String get feedTopicNews;

  /// Feed topic: unusual pedestrian counts.
  ///
  /// In en, this message translates to:
  /// **'Crowd anomalies'**
  String get feedTopicAnomalies;

  /// Feed topic: planning permits and projects.
  ///
  /// In en, this message translates to:
  /// **'Planning'**
  String get feedTopicPlanning;

  /// Subtitle of the community events topic switch.
  ///
  /// In en, this message translates to:
  /// **'Events people host around Melbourne'**
  String get feedTopicCommunityHint;

  /// Subtitle of the events topic switch.
  ///
  /// In en, this message translates to:
  /// **'Concerts, festivals and shows'**
  String get feedTopicEventsHint;

  /// Subtitle of the disruptions topic switch.
  ///
  /// In en, this message translates to:
  /// **'Road and tram disruptions right now'**
  String get feedTopicDisruptionsHint;

  /// Subtitle of the news topic switch.
  ///
  /// In en, this message translates to:
  /// **'Local news, placed on the map'**
  String get feedTopicNewsHint;

  /// Subtitle of the anomalies topic switch.
  ///
  /// In en, this message translates to:
  /// **'Unusual foot traffic in the city'**
  String get feedTopicAnomaliesHint;

  /// Subtitle of the planning topic switch.
  ///
  /// In en, this message translates to:
  /// **'Planning permits and projects'**
  String get feedTopicPlanningHint;

  /// Feed message when subscribed topics have no items.
  ///
  /// In en, this message translates to:
  /// **'Nothing right now'**
  String get feedEmpty;

  /// Feed message body when subscribed topics have no items.
  ///
  /// In en, this message translates to:
  /// **'Nothing is happening in your feeds right now. Try a wider area or more topics, or host something yourself.'**
  String get feedEmptyBody;

  /// Feed message when loading failed.
  ///
  /// In en, this message translates to:
  /// **'The feed could not load'**
  String get feedError;

  /// Button that reloads the feed.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get feedRetry;

  /// Button that opens the invite sheet.
  ///
  /// In en, this message translates to:
  /// **'Invite people'**
  String get eventInvite;

  /// Invite sheet body.
  ///
  /// In en, this message translates to:
  /// **'Send this to the people you want to bring. The link opens the event so they can join.'**
  String get eventInviteHint;

  /// Invite sheet body without a link.
  ///
  /// In en, this message translates to:
  /// **'This build has no public link yet. Send this message; people can find the event on the Discover tab under Events.'**
  String get eventInviteNoLink;

  /// Button that copies the invite message.
  ///
  /// In en, this message translates to:
  /// **'Copy message'**
  String get eventInviteCopyMessage;

  /// Button that copies the invite link.
  ///
  /// In en, this message translates to:
  /// **'Copy link'**
  String get eventInviteCopyLink;

  /// Snackbar after copying.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get eventInviteCopied;

  /// Map layer chip for user events.
  ///
  /// In en, this message translates to:
  /// **'Community events'**
  String get mapCommunityLayer;

  /// Button shown after the user moves the map while auto-search is off; searches the area now in view.
  ///
  /// In en, this message translates to:
  /// **'Search this area'**
  String get mapSearchThisArea;

  /// The time pill on the map while it shows current data.
  ///
  /// In en, this message translates to:
  /// **'Now'**
  String get mapTimeNow;

  /// Development sample time pill and menu use the fixed fixture observation interval, not the current time.
  ///
  /// In en, this message translates to:
  /// **'Sample observation window'**
  String get mapTimeSampleWindow;

  /// Time pill menu entry.
  ///
  /// In en, this message translates to:
  /// **'Past hour'**
  String get mapTimePastHour;

  /// Time pill menu entry.
  ///
  /// In en, this message translates to:
  /// **'Past 24 hours'**
  String get mapTimePastDay;

  /// Time pill menu entry.
  ///
  /// In en, this message translates to:
  /// **'Past 7 days'**
  String get mapTimePastWeek;

  /// Time pill menu entry.
  ///
  /// In en, this message translates to:
  /// **'Past 31 days'**
  String get mapTimePastMonth;

  /// Button that opens the list of map results.
  ///
  /// In en, this message translates to:
  /// **'Results'**
  String get mapResultsButton;

  /// Folded section in the results sheet with each layer's freshness and coverage.
  ///
  /// In en, this message translates to:
  /// **'Data status'**
  String get mapDataStatus;

  /// Button that opens the layers sheet.
  ///
  /// In en, this message translates to:
  /// **'Layers'**
  String get mapLayersButton;

  /// Settings section and dialog title for the profile.
  ///
  /// In en, this message translates to:
  /// **'Your name'**
  String get settingsProfile;

  /// Subtitle under the profile name.
  ///
  /// In en, this message translates to:
  /// **'Shown to the organiser when you join an event'**
  String get settingsProfileHint;

  /// Name field label.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get settingsNameLabel;

  /// Dialog cancel button.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get settingsCancel;

  /// Dialog save button.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get settingsSave;

  /// Settings section for map behaviour.
  ///
  /// In en, this message translates to:
  /// **'Map'**
  String get settingsMap;

  /// Settings switch that makes the map search again after every pan or zoom.
  ///
  /// In en, this message translates to:
  /// **'Search as the map moves'**
  String get settingsMapAutoSearch;

  /// Subtitle of the map auto-search switch while on.
  ///
  /// In en, this message translates to:
  /// **'On. The map searches again after every pan or zoom.'**
  String get settingsMapAutoSearchOn;

  /// Subtitle of the map auto-search switch while off.
  ///
  /// In en, this message translates to:
  /// **'Off. After moving the map, tap Search this area.'**
  String get settingsMapAutoSearchOff;

  /// Settings section for the theme.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settingsAppearance;

  /// Theme option: follow the device.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// Theme option.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// Theme option.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// Settings section.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get settingsAbout;

  /// Settings row title.
  ///
  /// In en, this message translates to:
  /// **'Map data'**
  String get settingsData;

  /// Settings row when sample data is on.
  ///
  /// In en, this message translates to:
  /// **'Sample data for development'**
  String get settingsDataSample;

  /// Settings row when live data is on.
  ///
  /// In en, this message translates to:
  /// **'Live City of Melbourne data'**
  String get settingsDataLive;

  /// About text.
  ///
  /// In en, this message translates to:
  /// **'Melens shows City of Melbourne open data as map layers. Answers come from Gemini agents on Google Cloud.'**
  String get settingsAboutBody;

  /// Notice that some feed sources failed.
  ///
  /// In en, this message translates to:
  /// **'Could not load: {topics}. Pull down to try again.'**
  String feedSourceFailed(String topics);

  /// Row in the layers sheet that lists map items that have no place on the map.
  ///
  /// In en, this message translates to:
  /// **'Items without a location'**
  String get mapUnlocatedAction;

  /// Title of the sheet that holds the map's layers, time window and results.
  ///
  /// In en, this message translates to:
  /// **'Layers and time'**
  String get mapLayersSheetTitle;

  /// Tooltip of the toolbar button that opens the user events panel (UC-09).
  ///
  /// In en, this message translates to:
  /// **'Open user events'**
  String get eventsOpen;

  /// Tooltip of the toolbar button that closes the user events panel.
  ///
  /// In en, this message translates to:
  /// **'Close user events'**
  String get eventsClose;

  /// Title of the user events panel.
  ///
  /// In en, this message translates to:
  /// **'User events'**
  String get eventsPanelTitle;

  /// Segment of the events panel listing events near the map's viewport.
  ///
  /// In en, this message translates to:
  /// **'Nearby'**
  String get eventsTabNearby;

  /// Segment of the events panel listing the user's own and joined events.
  ///
  /// In en, this message translates to:
  /// **'Mine'**
  String get eventsTabMine;

  /// Button that opens the form to publish a new event.
  ///
  /// In en, this message translates to:
  /// **'Publish event'**
  String get eventsPublish;

  /// Button in the event form: the next tap on the map places the event pin.
  ///
  /// In en, this message translates to:
  /// **'Pick on the map'**
  String get eventsFormPickOnMap;

  /// Banner above the map while the user picks the event pin.
  ///
  /// In en, this message translates to:
  /// **'Tap the map to place the event pin'**
  String get eventsFormPickBanner;

  /// Button on the pin-picking banner that returns to the form without a new pin.
  ///
  /// In en, this message translates to:
  /// **'Stop picking'**
  String get eventsFormPickStop;

  /// Button in the event form that pins the event at the map record the user selected.
  ///
  /// In en, this message translates to:
  /// **'Use {title}'**
  String eventsFormUseSelected(String title);

  /// Label of the address search field in the event form.
  ///
  /// In en, this message translates to:
  /// **'Search an address or place'**
  String get eventsFormSearchPlace;

  /// Helper text under the address search field.
  ///
  /// In en, this message translates to:
  /// **'Google Places, greater Melbourne'**
  String get eventsFormSearchHint;

  /// Shown under the address search field when the search returned nothing.
  ///
  /// In en, this message translates to:
  /// **'No place matches'**
  String get eventsFormSearchNoResults;

  /// Shown under the address search field when Google Places refused or is not set up.
  ///
  /// In en, this message translates to:
  /// **'Address search is not available: {reason}'**
  String eventsFormSearchUnavailable(String reason);

  /// Button that reloads the events list.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get eventsRefresh;

  /// Button that retries a failed events request.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get eventsRetry;

  /// Shown when the nearby list is empty.
  ///
  /// In en, this message translates to:
  /// **'No user events here in the next two weeks. Publish the first one.'**
  String get eventsNearbyEmpty;

  /// Shown in the nearby list before the map has a viewport.
  ///
  /// In en, this message translates to:
  /// **'Move the map to an area to find events.'**
  String get eventsNearbyNoViewport;

  /// Shown when the user has no own or joined events.
  ///
  /// In en, this message translates to:
  /// **'You have not published or joined any events yet.'**
  String get eventsMineEmpty;

  /// Heading of the user's own events in the Mine segment.
  ///
  /// In en, this message translates to:
  /// **'Published by you'**
  String get eventsMineOwnedHeading;

  /// Heading of the events the user joined in the Mine segment.
  ///
  /// In en, this message translates to:
  /// **'Joined'**
  String get eventsMineJoinedHeading;

  /// Shown when an events list failed to load. {reason} is the error text.
  ///
  /// In en, this message translates to:
  /// **'Could not load events. {reason}'**
  String eventsLoadFailed(String reason);

  /// How many people joined an event without a capacity.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Nobody going yet} =1{1 going} other{{count} going}}'**
  String eventsGoing(int count);

  /// How many people joined an event with a capacity.
  ///
  /// In en, this message translates to:
  /// **'{count} of {capacity} going'**
  String eventsGoingOf(int count, int capacity);

  /// Chip on an event the user joined.
  ///
  /// In en, this message translates to:
  /// **'You\'re going'**
  String get eventsYouAreGoing;

  /// Chip on an event the user published.
  ///
  /// In en, this message translates to:
  /// **'Yours'**
  String get eventsYours;

  /// Badge on a cancelled event.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get eventsCancelled;

  /// Badge on an event whose capacity is reached.
  ///
  /// In en, this message translates to:
  /// **'Full'**
  String get eventsFull;

  /// Badge on an event that has ended.
  ///
  /// In en, this message translates to:
  /// **'Ended'**
  String get eventsEnded;

  /// Badge on an event that shows only the number of people going.
  ///
  /// In en, this message translates to:
  /// **'Anonymous attendance'**
  String get eventsAnonymousBadge;

  /// Explains anonymous attendance under the badge and the form switch.
  ///
  /// In en, this message translates to:
  /// **'Only the number of people going is shown, never who.'**
  String get eventsAnonymousExplainer;

  /// Button that returns from an event's details to the list.
  ///
  /// In en, this message translates to:
  /// **'Back to the list'**
  String get eventsBack;

  /// Button that moves the map to the event's location.
  ///
  /// In en, this message translates to:
  /// **'Show on map'**
  String get eventsShowOnMap;

  /// Button that joins an event.
  ///
  /// In en, this message translates to:
  /// **'Join'**
  String get eventsJoin;

  /// Button that leaves an event the user joined.
  ///
  /// In en, this message translates to:
  /// **'Leave'**
  String get eventsLeave;

  /// Label of the name field shown when joining an event.
  ///
  /// In en, this message translates to:
  /// **'Your name (optional)'**
  String get eventsJoinNameLabel;

  /// Helper text of the name field shown when joining an event.
  ///
  /// In en, this message translates to:
  /// **'Shown to the organiser only'**
  String get eventsJoinNameHint;

  /// Owner button that opens the event for editing.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get eventsEdit;

  /// Owner button that cancels the event.
  ///
  /// In en, this message translates to:
  /// **'Cancel event'**
  String get eventsCancelEvent;

  /// Owner button that removes the event.
  ///
  /// In en, this message translates to:
  /// **'Remove event'**
  String get eventsRemoveEvent;

  /// Title of the dialog confirming an event cancellation.
  ///
  /// In en, this message translates to:
  /// **'Cancel this event?'**
  String get eventsCancelConfirmTitle;

  /// Body of the dialog confirming an event cancellation.
  ///
  /// In en, this message translates to:
  /// **'It stays visible as cancelled and nobody can join.'**
  String get eventsCancelConfirmBody;

  /// Title of the dialog confirming an event removal.
  ///
  /// In en, this message translates to:
  /// **'Remove this event?'**
  String get eventsRemoveConfirmTitle;

  /// Body of the dialog confirming an event removal.
  ///
  /// In en, this message translates to:
  /// **'It disappears from the map for everyone. This cannot be undone.'**
  String get eventsRemoveConfirmBody;

  /// Dialog button that keeps the event as it is.
  ///
  /// In en, this message translates to:
  /// **'Keep it'**
  String get eventsConfirmKeep;

  /// Owner section listing the event's members.
  ///
  /// In en, this message translates to:
  /// **'Members'**
  String get eventsMembers;

  /// Heading of the members section with the count.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No members yet} =1{1 member} other{{count} members}}'**
  String eventsMembersCount(int count);

  /// Shown in the members section of an anonymous event instead of a list.
  ///
  /// In en, this message translates to:
  /// **'Anonymous attendance: names are not kept.'**
  String get eventsMembersAnonymous;

  /// Name shown for a member who gave none.
  ///
  /// In en, this message translates to:
  /// **'Guest'**
  String get eventsMemberGuest;

  /// Tooltip of the button that removes a member from the event.
  ///
  /// In en, this message translates to:
  /// **'Remove member'**
  String get eventsMemberRemove;

  /// When a member joined. {time} is a formatted Melbourne time.
  ///
  /// In en, this message translates to:
  /// **'Joined {time}'**
  String eventsMemberJoinedAt(String time);

  /// Label of the event's time in its details.
  ///
  /// In en, this message translates to:
  /// **'When'**
  String get eventsWhen;

  /// Label of the event's place in its details.
  ///
  /// In en, this message translates to:
  /// **'Where'**
  String get eventsWhere;

  /// An event's start and end, both formatted Melbourne times.
  ///
  /// In en, this message translates to:
  /// **'{start} to {end}'**
  String eventsTimeRange(String start, String end);

  /// An event's coordinates when it has no place name, or under it.
  ///
  /// In en, this message translates to:
  /// **'Pinned at {lat}, {lng}'**
  String eventsPlacePin(String lat, String lng);

  /// Title of the form publishing a new event.
  ///
  /// In en, this message translates to:
  /// **'Publish an event'**
  String get eventsFormPublishTitle;

  /// Title of the form editing an event.
  ///
  /// In en, this message translates to:
  /// **'Edit event'**
  String get eventsFormEditTitle;

  /// Label of the event title field.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get eventsFormTitle;

  /// Label of the event description field.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get eventsFormDescription;

  /// Label of the event place name field.
  ///
  /// In en, this message translates to:
  /// **'Place name (optional)'**
  String get eventsFormPlaceName;

  /// Label of the event start date and time.
  ///
  /// In en, this message translates to:
  /// **'Starts'**
  String get eventsFormStart;

  /// Label of the event end date and time.
  ///
  /// In en, this message translates to:
  /// **'Ends (optional)'**
  String get eventsFormEnd;

  /// Shown instead of an end time when none is set, and the button that clears it.
  ///
  /// In en, this message translates to:
  /// **'No end time'**
  String get eventsFormNoEnd;

  /// Tooltip of the button that opens the date picker.
  ///
  /// In en, this message translates to:
  /// **'Pick the date'**
  String get eventsFormPickDate;

  /// Tooltip of the button that opens the time picker.
  ///
  /// In en, this message translates to:
  /// **'Pick the time'**
  String get eventsFormPickTime;

  /// Label of the switch that hides who joined.
  ///
  /// In en, this message translates to:
  /// **'Anonymous attendance'**
  String get eventsFormAnonymous;

  /// Label of the capacity field.
  ///
  /// In en, this message translates to:
  /// **'Capacity (optional)'**
  String get eventsFormCapacity;

  /// Helper text of the capacity field.
  ///
  /// In en, this message translates to:
  /// **'2 to 1000 people, or leave empty for no limit'**
  String get eventsFormCapacityHint;

  /// Label of the event location section of the form.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get eventsFormLocation;

  /// Helper text under the location in the form.
  ///
  /// In en, this message translates to:
  /// **'Tap the map, use its centre or a selected record, or search an address.'**
  String get eventsFormLocationHint;

  /// Button that sets the event location to the map's current centre.
  ///
  /// In en, this message translates to:
  /// **'Use map centre'**
  String get eventsFormUseMapCentre;

  /// Submit button of the publish form.
  ///
  /// In en, this message translates to:
  /// **'Publish'**
  String get eventsFormSubmitPublish;

  /// Submit button of the edit form.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get eventsFormSubmitSave;

  /// Button that closes the form without saving.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get eventsFormCancel;

  /// Validation message for an empty title.
  ///
  /// In en, this message translates to:
  /// **'Give the event a title.'**
  String get eventsFormTitleRequired;

  /// Validation message for a text field over its limit. {max} is the limit.
  ///
  /// In en, this message translates to:
  /// **'At most {max} characters.'**
  String eventsFormTooLong(int max);

  /// Validation message for a start more than an hour in the past.
  ///
  /// In en, this message translates to:
  /// **'The start can be at most an hour ago.'**
  String get eventsFormStartTooEarly;

  /// Validation message for a start more than a year ahead.
  ///
  /// In en, this message translates to:
  /// **'The start must be within a year.'**
  String get eventsFormStartTooLate;

  /// Validation message for an end at or before the start.
  ///
  /// In en, this message translates to:
  /// **'The end must be after the start.'**
  String get eventsFormEndBeforeStart;

  /// Validation message for an end more than 7 days after the start.
  ///
  /// In en, this message translates to:
  /// **'An event lasts at most 7 days.'**
  String get eventsFormDurationTooLong;

  /// Validation message for a capacity outside its range.
  ///
  /// In en, this message translates to:
  /// **'Capacity is 2 to 1000.'**
  String get eventsFormCapacityRange;

  /// Validation message for a location outside the service area.
  ///
  /// In en, this message translates to:
  /// **'The location must be in the Melbourne service area.'**
  String get eventsFormLocationOutside;

  /// Shown when the edit form is submitted without changes.
  ///
  /// In en, this message translates to:
  /// **'Nothing changed.'**
  String get eventsFormNoChanges;

  /// Events error when the app has no token source.
  ///
  /// In en, this message translates to:
  /// **'Sign-in is not configured, so events are unavailable.'**
  String get eventsErrorSignIn;

  /// Events error for a network failure.
  ///
  /// In en, this message translates to:
  /// **'The service is unreachable.'**
  String get eventsErrorNetwork;

  /// Events error for a timed-out request.
  ///
  /// In en, this message translates to:
  /// **'The request timed out.'**
  String get eventsErrorTimeout;

  /// Events error on HTTP 429.
  ///
  /// In en, this message translates to:
  /// **'Too many changes in an hour. Try again later.'**
  String get eventsErrorRateLimited;

  /// Events error on HTTP 404.
  ///
  /// In en, this message translates to:
  /// **'This event no longer exists.'**
  String get eventsErrorNotFound;

  /// Events error on HTTP 403.
  ///
  /// In en, this message translates to:
  /// **'Only the organiser can do that.'**
  String get eventsErrorForbidden;

  /// Events error on HTTP 400.
  ///
  /// In en, this message translates to:
  /// **'The service rejected the event details.'**
  String get eventsErrorInvalid;

  /// Events error without a known cause.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong.'**
  String get eventsErrorUnknown;

  /// Join refused: the capacity is reached.
  ///
  /// In en, this message translates to:
  /// **'This event is full.'**
  String get eventsErrorEventFull;

  /// Join refused: the user is already a member.
  ///
  /// In en, this message translates to:
  /// **'You already joined this event.'**
  String get eventsErrorAlreadyJoined;

  /// Join refused: the event is cancelled.
  ///
  /// In en, this message translates to:
  /// **'This event was cancelled.'**
  String get eventsErrorEventCancelled;

  /// Join refused: the event is over.
  ///
  /// In en, this message translates to:
  /// **'This event has ended.'**
  String get eventsErrorEventEnded;

  /// Join refused: the user is the owner.
  ///
  /// In en, this message translates to:
  /// **'You organise this event.'**
  String get eventsErrorOwnEvent;

  /// Leave refused: the user was not a member.
  ///
  /// In en, this message translates to:
  /// **'You had not joined this event.'**
  String get eventsErrorNotJoined;

  /// Settings row title when no display name is set.
  ///
  /// In en, this message translates to:
  /// **'Add your name'**
  String get settingsNameUnset;

  /// Chip over the map describing the route the agent drew: duration, distance and how to travel.
  ///
  /// In en, this message translates to:
  /// **'{minutes} min · {distance} km, {mode, select, transit{public transport} other{walk}}'**
  String mapRouteSummary(String minutes, String distance, String mode);

  /// Chip over the map for a route with no duration or distance.
  ///
  /// In en, this message translates to:
  /// **'{mode, select, transit{Public transport route} other{Walking route}}'**
  String mapRouteSummaryBare(String mode);

  /// Tooltip of the button that removes the agent's route from the map.
  ///
  /// In en, this message translates to:
  /// **'Remove route'**
  String get mapRouteRemove;

  /// Info window title of an unnamed stop on the agent's route.
  ///
  /// In en, this message translates to:
  /// **'Stop {number}'**
  String mapRouteStop(String number);

  /// Chip on the map that shares and shows the user's position.
  ///
  /// In en, this message translates to:
  /// **'My location'**
  String get mapMyLocation;

  /// Chip label while the device position is being read.
  ///
  /// In en, this message translates to:
  /// **'Finding you…'**
  String get mapMyLocationLocating;

  /// Info window title of the user's position marker.
  ///
  /// In en, this message translates to:
  /// **'You are here'**
  String get mapMyLocationHere;

  /// Shown when the user refused the location permission.
  ///
  /// In en, this message translates to:
  /// **'Location permission was refused. Allow it in your browser\'s site settings to use My location.'**
  String get mapMyLocationDenied;

  /// Shown when the device could not work out a position.
  ///
  /// In en, this message translates to:
  /// **'Your position could not be found. Try again in a moment.'**
  String get mapMyLocationUnavailable;

  /// Shown when the position request timed out.
  ///
  /// In en, this message translates to:
  /// **'Finding your position took too long. Try again.'**
  String get mapMyLocationTimeout;

  /// Shown on platforms with no location support.
  ///
  /// In en, this message translates to:
  /// **'Location is not available on this device or in this build.'**
  String get mapMyLocationUnsupported;

  /// Settings section title.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get settingsLocation;

  /// Settings switch that turns on My location.
  ///
  /// In en, this message translates to:
  /// **'Share my location with the assistant'**
  String get settingsLocationShare;

  /// Subtitle of the location switch while off.
  ///
  /// In en, this message translates to:
  /// **'Off. The assistant does not know where you are, so “near me” needs a map selection.'**
  String get settingsLocationOff;

  /// Subtitle of the location switch while on.
  ///
  /// In en, this message translates to:
  /// **'On. Your position is sent with your questions while this is on, and never stored.'**
  String get settingsLocationOn;

  /// Tooltip of the feed button that creates a feed, and title of the feed editor for a new feed.
  ///
  /// In en, this message translates to:
  /// **'New feed'**
  String get feedNew;

  /// Title of the feed editor for an existing feed.
  ///
  /// In en, this message translates to:
  /// **'Edit feed'**
  String get feedEdit;

  /// Feed chip that shows the items of every feed.
  ///
  /// In en, this message translates to:
  /// **'All feeds'**
  String get feedChipAll;

  /// Feed chip and button that open the feeds section in Settings.
  ///
  /// In en, this message translates to:
  /// **'Manage feeds'**
  String get feedManage;

  /// Title of the feed when the user has no feeds.
  ///
  /// In en, this message translates to:
  /// **'You have no feeds yet'**
  String get feedEmptyNoFeeds;

  /// Body of the feed when the user has no feeds.
  ///
  /// In en, this message translates to:
  /// **'A feed follows a few topics in one part of Melbourne. Create one and what happens there shows up here.'**
  String get feedEmptyNoFeedsBody;

  /// Button that opens the feed editor from an empty feed.
  ///
  /// In en, this message translates to:
  /// **'Create a feed'**
  String get feedCreate;

  /// Title of the feed when every feed is paused.
  ///
  /// In en, this message translates to:
  /// **'All your feeds are paused'**
  String get feedAllPaused;

  /// Body of the feed when every feed is paused.
  ///
  /// In en, this message translates to:
  /// **'Turn a feed back on in Settings.'**
  String get feedAllPausedBody;

  /// One failed feed source in the failure notice.
  ///
  /// In en, this message translates to:
  /// **'{feed}: {topic}'**
  String feedSourceName(String feed, String topic);

  /// Label of the feed name field.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get feedEditorName;

  /// Hint of the feed name field; an empty name takes the area name.
  ///
  /// In en, this message translates to:
  /// **'For example: Near the office'**
  String get feedEditorNameHint;

  /// Heading of the topic chips in the feed editor.
  ///
  /// In en, this message translates to:
  /// **'What to follow'**
  String get feedEditorTopics;

  /// Shown when no topic is chosen in the feed editor.
  ///
  /// In en, this message translates to:
  /// **'Choose at least one topic.'**
  String get feedEditorTopicsNone;

  /// Heading of the scope choice in the feed editor.
  ///
  /// In en, this message translates to:
  /// **'Where'**
  String get feedEditorWhere;

  /// Scope option: a box the user frames on the map.
  ///
  /// In en, this message translates to:
  /// **'Map area'**
  String get feedScopeMap;

  /// Scope option: one named City of Melbourne area.
  ///
  /// In en, this message translates to:
  /// **'Named area'**
  String get feedScopeArea;

  /// Scope option and summary: the whole service area.
  ///
  /// In en, this message translates to:
  /// **'All of Melbourne'**
  String get feedScopeCity;

  /// Hint under the whole-city scope.
  ///
  /// In en, this message translates to:
  /// **'Everything the map holds. The slowest to load. Community events stay within central Melbourne.'**
  String get feedScopeCityHint;

  /// Summary of a named area this app version no longer knows.
  ///
  /// In en, this message translates to:
  /// **'Unknown area'**
  String get feedScopeAreaUnknown;

  /// Summary of a framed map area.
  ///
  /// In en, this message translates to:
  /// **'Map area, {size}'**
  String feedScopeMapSummary(String size);

  /// Shown before the user frames a map area.
  ///
  /// In en, this message translates to:
  /// **'No area framed yet'**
  String get feedScopeMapNone;

  /// Button that opens the area picker.
  ///
  /// In en, this message translates to:
  /// **'Frame on the map'**
  String get feedScopeMapPick;

  /// Button that reopens the area picker.
  ///
  /// In en, this message translates to:
  /// **'Change area'**
  String get feedScopeMapChange;

  /// Hint under the map-area scope.
  ///
  /// In en, this message translates to:
  /// **'Smaller areas load faster.'**
  String get feedScopeMapHint;

  /// Switch that adds records with no location to the feed.
  ///
  /// In en, this message translates to:
  /// **'Include reports without a place'**
  String get feedEditorUnlocated;

  /// Subtitle of the unlocated switch.
  ///
  /// In en, this message translates to:
  /// **'Adds reports that cover the whole city, such as a disruption to a whole tram line. These are not limited to the area.'**
  String get feedEditorUnlocatedHint;

  /// Heading of the time range of the events and community events topics.
  ///
  /// In en, this message translates to:
  /// **'Events ahead'**
  String get feedEditorHorizon;

  /// Community events range option.
  ///
  /// In en, this message translates to:
  /// **'24 hours'**
  String get feedHorizonToday;

  /// Community events range option.
  ///
  /// In en, this message translates to:
  /// **'7 days'**
  String get feedHorizonWeek;

  /// Community events range option.
  ///
  /// In en, this message translates to:
  /// **'14 days'**
  String get feedHorizonFortnight;

  /// Button that saves the feed.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get feedEditorSave;

  /// Button that deletes the feed being edited.
  ///
  /// In en, this message translates to:
  /// **'Delete feed'**
  String get feedEditorDelete;

  /// Title of the dialog that confirms deleting a feed.
  ///
  /// In en, this message translates to:
  /// **'Delete {name}?'**
  String feedEditorDeleteTitle(String name);

  /// Body of the dialog that confirms deleting a feed.
  ///
  /// In en, this message translates to:
  /// **'Its items leave your feed.'**
  String get feedEditorDeleteBody;

  /// Confirm button of the delete-feed dialog.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get feedEditorDeleteConfirm;

  /// Cancel button of the delete-feed dialog.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get feedEditorCancel;

  /// Notice that saving the feeds failed.
  ///
  /// In en, this message translates to:
  /// **'Your feeds could not be saved. Try again.'**
  String get feedSaveFailed;

  /// Notice that the feed limit is reached.
  ///
  /// In en, this message translates to:
  /// **'You can keep up to {count} feeds.'**
  String feedLimitReached(int count);

  /// Shown when the feed editor opens a feed that was deleted.
  ///
  /// In en, this message translates to:
  /// **'This feed no longer exists.'**
  String get feedNotFound;

  /// Title of the area picker.
  ///
  /// In en, this message translates to:
  /// **'Frame the area'**
  String get feedAreaPickerTitle;

  /// Hint of the area picker.
  ///
  /// In en, this message translates to:
  /// **'Move and zoom the map until the frame covers the area to follow.'**
  String get feedAreaPickerHint;

  /// Button that confirms the framed area.
  ///
  /// In en, this message translates to:
  /// **'Use this area'**
  String get feedAreaPickerUse;

  /// Notice that the framed area is outside the service area.
  ///
  /// In en, this message translates to:
  /// **'That area is outside Melbourne. Move the map back.'**
  String get feedAreaPickerOutside;

  /// Settings section listing the user's feeds.
  ///
  /// In en, this message translates to:
  /// **'Feeds'**
  String get settingsFeeds;

  /// Settings row when the feeds failed to load.
  ///
  /// In en, this message translates to:
  /// **'Your feeds could not load.'**
  String get settingsFeedsError;

  /// Prefix of a paused feed's subtitle in Settings.
  ///
  /// In en, this message translates to:
  /// **'Paused'**
  String get settingsFeedPaused;

  /// Collapsed section holding record ids, versions and location evidence.
  ///
  /// In en, this message translates to:
  /// **'Technical details'**
  String get mapDetailTechnical;

  /// Fact label for the plain-language location basis.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get mapDetailLocation;

  /// Location basis: the point is the sensor itself.
  ///
  /// In en, this message translates to:
  /// **'Sensor position'**
  String get mapDetailWhereSensor;

  /// Location basis: the source supplies the site location.
  ///
  /// In en, this message translates to:
  /// **'Site given by the source'**
  String get mapDetailWhereSite;

  /// Location basis: the drawn shape is the affected extent.
  ///
  /// In en, this message translates to:
  /// **'Affected road, route or area'**
  String get mapDetailWhereExtent;

  /// Location basis: a statistical reporting area.
  ///
  /// In en, this message translates to:
  /// **'Statistical area'**
  String get mapDetailWhereStatisticalArea;

  /// Location basis: the record is only associated with this area.
  ///
  /// In en, this message translates to:
  /// **'Linked area, not an exact location'**
  String get mapDetailWhereAreaAssociation;

  /// Location basis: a place named in a report.
  ///
  /// In en, this message translates to:
  /// **'Place mentioned in the report, not where it happened'**
  String get mapDetailWhereMention;

  /// Location basis is not known.
  ///
  /// In en, this message translates to:
  /// **'Location basis unknown'**
  String get mapDetailWhereUnknown;

  /// The record has no location on the map.
  ///
  /// In en, this message translates to:
  /// **'No map location'**
  String get mapDetailWhereUnlocated;

  /// Short status chip.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get mapChipActive;

  /// Short status chip.
  ///
  /// In en, this message translates to:
  /// **'Planned'**
  String get mapChipPlanned;

  /// Short status chip.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get mapChipCancelled;

  /// Short status chip.
  ///
  /// In en, this message translates to:
  /// **'Resolved'**
  String get mapChipResolved;

  /// Short status chip.
  ///
  /// In en, this message translates to:
  /// **'Status unknown'**
  String get mapChipStatusUnknown;

  /// Development Activity Monitor status mooted.
  ///
  /// In en, this message translates to:
  /// **'Proposed'**
  String get mapDevelopmentMooted;

  /// Development Activity Monitor status approved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get mapDevelopmentApproved;

  /// Development Activity Monitor status under_construction.
  ///
  /// In en, this message translates to:
  /// **'Under construction'**
  String get mapDevelopmentUnderConstruction;

  /// Development Activity Monitor status completed.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get mapDevelopmentCompleted;

  /// Development project floor count.
  ///
  /// In en, this message translates to:
  /// **'Floors above ground'**
  String get mapDetailFloors;

  /// Development project residential dwelling count.
  ///
  /// In en, this message translates to:
  /// **'Dwellings'**
  String get mapDetailDwellings;

  /// Town planning application number.
  ///
  /// In en, this message translates to:
  /// **'Planning application'**
  String get mapDetailApplication;

  /// Development Activity Monitor project key.
  ///
  /// In en, this message translates to:
  /// **'Project reference'**
  String get mapDetailProjectRef;

  /// Council running a community consultation.
  ///
  /// In en, this message translates to:
  /// **'Council'**
  String get mapDetailCouncil;

  /// Categories a council lists for a consultation.
  ///
  /// In en, this message translates to:
  /// **'Topics'**
  String get mapDetailTopics;

  /// Suburbs or area a consultation covers.
  ///
  /// In en, this message translates to:
  /// **'Area'**
  String get mapDetailArea;

  /// A consultation that covers the whole council.
  ///
  /// In en, this message translates to:
  /// **'Whole council area'**
  String get mapDetailCouncilWide;

  /// Subtitle for a council consultation project.
  ///
  /// In en, this message translates to:
  /// **'Community consultation'**
  String get mapConsultationLabel;

  /// Consultation status Open.
  ///
  /// In en, this message translates to:
  /// **'Open for feedback'**
  String get mapConsultationOpen;

  /// Consultation status Active.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get mapConsultationActive;

  /// Consultation status Closed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get mapConsultationClosed;

  /// Ticketmaster status onsale.
  ///
  /// In en, this message translates to:
  /// **'Tickets on sale'**
  String get mapTicketsOnSale;

  /// Ticketmaster status offsale.
  ///
  /// In en, this message translates to:
  /// **'Tickets not on sale'**
  String get mapTicketsOffSale;

  /// Ticketmaster status cancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get mapTicketsCancelled;

  /// Ticketmaster status postponed.
  ///
  /// In en, this message translates to:
  /// **'Postponed'**
  String get mapTicketsPostponed;

  /// Ticketmaster status rescheduled.
  ///
  /// In en, this message translates to:
  /// **'Rescheduled'**
  String get mapTicketsRescheduled;

  /// Fact label for an observation window.
  ///
  /// In en, this message translates to:
  /// **'Time'**
  String get mapDetailTime;

  /// Caption under an hourly pedestrian count.
  ///
  /// In en, this message translates to:
  /// **'people counted in this hour'**
  String get mapPeopleCountedHour;

  /// Caption under a per-minute pedestrian count.
  ///
  /// In en, this message translates to:
  /// **'people counted in this minute'**
  String get mapPeopleCountedMinute;

  /// Chip for an anomalous result.
  ///
  /// In en, this message translates to:
  /// **'Unusual'**
  String get mapAnomalyUnusual;

  /// Chip for a not-anomalous result.
  ///
  /// In en, this message translates to:
  /// **'Within the usual range'**
  String get mapAnomalyNormal;

  /// Chip for an unclassified result.
  ///
  /// In en, this message translates to:
  /// **'Not classified'**
  String get mapAnomalyNotChecked;

  /// Headline when the observation equals the baseline.
  ///
  /// In en, this message translates to:
  /// **'In line with usual'**
  String get mapAnomalyInLine;

  /// Caption under the observed anomaly value.
  ///
  /// In en, this message translates to:
  /// **'observed'**
  String get mapAnomalyObservedCaption;

  /// Anomaly baseline value label.
  ///
  /// In en, this message translates to:
  /// **'Usual level'**
  String get mapDetailUsual;

  /// Anomaly eligibility ineligible.
  ///
  /// In en, this message translates to:
  /// **'This sensor was not eligible for anomaly checks in this window.'**
  String get mapAnomalyIneligibleNote;

  /// Anomaly eligibility unknown.
  ///
  /// In en, this message translates to:
  /// **'Whether this sensor was eligible for anomaly checks is not known.'**
  String get mapAnomalyEligibilityUnknownNote;

  /// ASGS GCCSA level.
  ///
  /// In en, this message translates to:
  /// **'Greater capital city area'**
  String get mapBoundaryGccsa;

  /// ASGS LGA level.
  ///
  /// In en, this message translates to:
  /// **'Local government area'**
  String get mapBoundaryLga;

  /// ASGS SA2 level.
  ///
  /// In en, this message translates to:
  /// **'Statistical Area Level 2'**
  String get mapBoundarySa2;

  /// ASGS STE level.
  ///
  /// In en, this message translates to:
  /// **'State'**
  String get mapBoundaryState;

  /// CLUE block level.
  ///
  /// In en, this message translates to:
  /// **'City of Melbourne CLUE block'**
  String get mapBoundaryClueBlock;

  /// Municipal boundary level.
  ///
  /// In en, this message translates to:
  /// **'Municipal boundary'**
  String get mapBoundaryMunicipal;

  /// Headline: observation is lower than the baseline by a percentage.
  ///
  /// In en, this message translates to:
  /// **'{percent} below usual'**
  String mapAnomalyBelow(String percent);

  /// Headline: observation is higher than the baseline by a percentage.
  ///
  /// In en, this message translates to:
  /// **'{percent} above usual'**
  String mapAnomalyAbove(String percent);

  /// Plain-language anomaly baseline definition.
  ///
  /// In en, this message translates to:
  /// **'Average for the same hour over the previous {days} days'**
  String mapAnomalyBaselineSameHour(String days);

  /// A time range; the end is excluded.
  ///
  /// In en, this message translates to:
  /// **'{from} to {to}'**
  String mapDetailRange(String from, String to);

  /// Placeholder of the chat input box while the next message changes a plan.
  ///
  /// In en, this message translates to:
  /// **'What should change?'**
  String get chatInputHintRefine;

  /// Line above the chat input while the next message changes a plan. {title} is the plan's title.
  ///
  /// In en, this message translates to:
  /// **'Changing “{title}”'**
  String chatRefiningPlan(String title);

  /// Small label above a user message that asked to change a plan. {title} is the plan's title.
  ///
  /// In en, this message translates to:
  /// **'Change to “{title}”'**
  String chatRefinedPlan(String title);

  /// Small label above a user message that asked to change a plan the conversation no longer shows.
  ///
  /// In en, this message translates to:
  /// **'Change to a plan'**
  String get chatRefinedPlanUnknown;

  /// Button under a plan card in the chat: the next message asks the agent to change this plan.
  ///
  /// In en, this message translates to:
  /// **'Change plan'**
  String get planRefine;

  /// Button that leaves plan-change mode, so the next message is an ordinary one.
  ///
  /// In en, this message translates to:
  /// **'Stop changing'**
  String get planRefineCancel;

  /// Suggested change to a plan, sent to the agent as written.
  ///
  /// In en, this message translates to:
  /// **'Make it shorter'**
  String get planRefineShorter;

  /// Suggested change to a plan, sent to the agent as written.
  ///
  /// In en, this message translates to:
  /// **'Make it cheaper'**
  String get planRefineCheaper;

  /// Suggested change to a plan, sent to the agent as written.
  ///
  /// In en, this message translates to:
  /// **'Start an hour later'**
  String get planRefineLater;

  /// Suggested change to a plan, sent to the agent as written.
  ///
  /// In en, this message translates to:
  /// **'Keep it indoors'**
  String get planRefineIndoors;

  /// Button under a plan card in the chat that keeps the plan on the Home tab.
  ///
  /// In en, this message translates to:
  /// **'Save plan'**
  String get planSave;

  /// Disabled button under a plan card that is already saved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get planSaved;

  /// Error under a plan card when saving it failed.
  ///
  /// In en, this message translates to:
  /// **'The plan could not be saved. Try again.'**
  String get planSaveFailed;

  /// Error under a plan card when the user already has the most saved plans.
  ///
  /// In en, this message translates to:
  /// **'You have 30 saved plans. Remove one on the Home tab first.'**
  String get planSaveLimit;

  /// Heading of the saved plans on the Home tab.
  ///
  /// In en, this message translates to:
  /// **'Saved plans'**
  String get plansSectionTitle;

  /// Shown when the saved plans failed to load.
  ///
  /// In en, this message translates to:
  /// **'Saved plans could not load.'**
  String get plansLoadFailed;

  /// How many stops a saved plan has.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 stop} other{{count} stops}}'**
  String planStops(int count);

  /// Label on a saved plan whose stops are all over.
  ///
  /// In en, this message translates to:
  /// **'Past'**
  String get planPast;

  /// Title of the page that shows one saved plan.
  ///
  /// In en, this message translates to:
  /// **'Saved plan'**
  String get planScreenTitle;

  /// Button on a saved plan that draws its route on the map.
  ///
  /// In en, this message translates to:
  /// **'Show the route on the map'**
  String get planShowRoute;

  /// When a plan was saved. {date} is a Melbourne date and time.
  ///
  /// In en, this message translates to:
  /// **'Saved {date}'**
  String planSavedOn(String date);

  /// Shown when a saved plan page opens for a plan that was removed.
  ///
  /// In en, this message translates to:
  /// **'This plan is no longer saved.'**
  String get planMissing;

  /// Button and tooltip that removes a saved plan.
  ///
  /// In en, this message translates to:
  /// **'Remove plan'**
  String get planRemove;

  /// Title of the dialog that confirms removing a saved plan.
  ///
  /// In en, this message translates to:
  /// **'Remove this plan?'**
  String get planRemoveTitle;

  /// Body of the dialog that confirms removing a saved plan.
  ///
  /// In en, this message translates to:
  /// **'It disappears from Home. The chat it came from stays.'**
  String get planRemoveBody;

  /// Button that closes the remove dialog without removing the plan.
  ///
  /// In en, this message translates to:
  /// **'Keep'**
  String get planRemoveCancel;

  /// Shown when removing a saved plan failed.
  ///
  /// In en, this message translates to:
  /// **'The plan could not be removed. Try again.'**
  String get planRemoveFailed;

  /// The user's bubble for several answers sent at once, joined by commas.
  ///
  /// In en, this message translates to:
  /// **'Answers: {values}'**
  String chatInputAnswers(String values);

  /// Above several questions the agent asked about the plan it just showed.
  ///
  /// In en, this message translates to:
  /// **'A few questions to fit the plan to you. Answer any of them.'**
  String get chatQuestionsAboutPlan;

  /// Sends the answers chosen under several questions about a plan.
  ///
  /// In en, this message translates to:
  /// **'Update the plan'**
  String get chatQuestionsSend;

  /// Under several questions: the user may type instead of choosing.
  ///
  /// In en, this message translates to:
  /// **'Or type what you have in mind below.'**
  String get chatQuestionsFreeText;

  /// A plan's travel mode: walking.
  ///
  /// In en, this message translates to:
  /// **'On foot'**
  String get cardTravelWalk;

  /// A plan's travel mode: public transport.
  ///
  /// In en, this message translates to:
  /// **'By public transport'**
  String get cardTravelTransit;

  /// A plan's travel mode: driving.
  ///
  /// In en, this message translates to:
  /// **'By car'**
  String get cardTravelDrive;

  /// A plan's travel mode: cycling.
  ///
  /// In en, this message translates to:
  /// **'By bike'**
  String get cardTravelCycle;

  /// Heading of the live parking section under a plan stop.
  ///
  /// In en, this message translates to:
  /// **'Parking near this stop'**
  String get stopParkingTitle;

  /// The nearest vacant bay to a plan stop.
  ///
  /// In en, this message translates to:
  /// **'Nearest free bay {distance} away, about {minutes} min walk'**
  String stopParkingNearest(String distance, int minutes);

  /// No vacant sensor around a plan stop.
  ///
  /// In en, this message translates to:
  /// **'No bay reads free within {radius}.'**
  String stopParkingNone(String radius);

  /// How many sensors around a plan stop read vacant and occupied.
  ///
  /// In en, this message translates to:
  /// **'{vacant} free, {occupied} taken within {radius}'**
  String stopParkingCounts(int vacant, int occupied, String radius);

  /// When the sensors around a plan stop were read, in Melbourne time.
  ///
  /// In en, this message translates to:
  /// **'Checked {time}'**
  String stopParkingChecked(String time);

  /// A vacant bay chip under a plan stop: distance and walking minutes. Tapping it shows the bay on the map.
  ///
  /// In en, this message translates to:
  /// **'{distance} · {minutes} min'**
  String stopParkingBay(String distance, int minutes);

  /// Title of a vacant bay opened on the map from a plan stop.
  ///
  /// In en, this message translates to:
  /// **'Free parking bay'**
  String get stopParkingBayTitle;

  /// Always under a plan stop's parking.
  ///
  /// In en, this message translates to:
  /// **'A free sensor shows no car on the bay, not that parking is allowed now.'**
  String get stopParkingSensorNote;

  /// Reads the parking sensors around a saved plan's stop again.
  ///
  /// In en, this message translates to:
  /// **'Refresh parking'**
  String get stopParkingRefresh;

  /// Reads the parking around a saved plan's stop that has none yet.
  ///
  /// In en, this message translates to:
  /// **'Find parking here'**
  String get stopParkingFind;

  /// Shown when refreshing a saved plan stop's parking failed.
  ///
  /// In en, this message translates to:
  /// **'Parking could not be refreshed. Try again.'**
  String get stopParkingRefreshFailed;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
