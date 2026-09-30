/** Canonical rows exchanged by connectors, validation, and BigQuery publication. */

/** UTC ISO-8601 text at the TypeScript boundary; BigQuery stores TIMESTAMP. */
export type UtcTimestamp = string;
export type SourceId = string;
export type BatchId = string;

export type SourceScope = 'city' | 'greater_melbourne' | 'victoria' | 'global';
export type LicenseStatus = 'verified_open' | 'restricted' | 'review_required';
export type AccessStatus = 'candidate' | 'ready' | 'active' | 'paused';
export type AssertionKind = 'observation' | 'report' | 'prediction' | 'plan';
export type SourceRecordStatus = 'active' | 'corrected' | 'cancelled' | 'withdrawn';
export type GeoRecordStatus = 'active' | 'planned' | 'cancelled' | 'resolved' | 'withdrawn';
export type FreshnessState = 'current' | 'late' | 'stale' | 'unknown';
export type GeoTopic =
  | 'news' | 'crime_news' | 'parking' | 'pedestrian' | 'road_disruption'
  | 'event' | 'planning' | 'housing' | 'transport' | 'other';

export interface AdmissionEvidence {
  dataset_url: string | null;
  native_record_key: string | null;
  completeness_rule: string | null;
  quota_requests_per_day: number | null;
  secret_names: readonly string[];
  allowed_fields: readonly string[] | null;
  raw_retention_days: number | null;
  staging_retention_days: number | null;
  license_evidence_url: string | null;
  reviewed_at: UtcTimestamp | null;
  /** Missing admission facts keep the effective license at review_required. */
  missing_requirements: readonly string[];
  declared_license_status: LicenseStatus;
}

export interface DataSource {
  source_id: SourceId;
  legacy_ids: readonly string[];
  provider: string;
  dataset_title: string;
  landing_url: string;
  topic: string;
  scope: SourceScope;
  coverage_area_refs: readonly string[];
  coverage_from: UtcTimestamp | null;
  coverage_to: UtcTimestamp | null;
  cadence_seconds: number | null;
  check_interval_seconds: number | null;
  admission_evidence: AdmissionEvidence;
  connector_owner: string | null;
  /** Effective status after admission checks, never a bare manifest claim. */
  license_status: LicenseStatus;
  access_status: AccessStatus;
  last_checked_at: UtcTimestamp | null;
  last_success_at: UtcTimestamp | null;
  last_source_update_at: UtcTimestamp | null;
  record_granularity: string;
}

export type SyncBatchState = 'running' | 'validated' | 'published' | 'failed';
export type ConnectorErrorCode =
  | 'rate_limited' | 'upstream_unavailable' | 'schema_changed'
  | 'auth_failed' | 'incomplete_window' | 'validation_failed';

export interface SyncBatch {
  batch_id: BatchId;
  source_id: SourceId;
  schema_version: number;
  window_from: UtcTimestamp | null;
  window_to: UtcTimestamp | null;
  source_revision: string | null;
  started_at: UtcTimestamp;
  finished_at: UtcTimestamp | null;
  state: SyncBatchState;
  state_updated_at: UtcTimestamp;
  raw_uri: string | null;
  staging_uris: readonly string[];
  published_at: UtcTimestamp | null;
  input_count: number;
  output_count: number;
  rejected_count: number;
  checkpoint_before: string | null;
  checkpoint_after: string | null;
  error_code: ConnectorErrorCode | null;
}

/** Every fact row carries a stable key, batch provenance, and fetch time. */
export interface FactProvenance {
  batch_id: BatchId;
  source_id: SourceId;
  schema_version: number;
  fetched_at: UtcTimestamp;
}

export interface SourceRecord extends FactProvenance {
  source_record_id: string;
  version_id: string;
  original_url: string | null;
  raw_uri: string | null;
  published_at: UtcTimestamp | null;
  observed_at: UtcTimestamp | null;
  first_accessible_at: UtcTimestamp | null;
  time_missing_reason: string | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  source_updated_at: UtcTimestamp | null;
  source_version_ordinal: number | null;
  record_status: SourceRecordStatus;
  assertion_kind: AssertionKind;
  rights_status: LicenseStatus;
}

export type LocationRole = 'event_site' | 'mentioned_place' | 'sensor_site' | 'area_only' | 'unknown';
export type LocationConfidence = 'source_coordinate' | 'official_join' | 'resolved_area' | 'unverified';

export interface GeoRecord extends FactProvenance {
  geo_record_id: string;
  version_id: string;
  topic: GeoTopic;
  assertion_kind: AssertionKind;
  title: string | null;
  summary: string | null;
  original_url: string | null;
  geometry_geojson: string | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  location_role: LocationRole;
  location_confidence: LocationConfidence;
  area_refs: readonly string[];
  published_at: UtcTimestamp | null;
  observed_at: UtcTimestamp | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  source_updated_at: UtcTimestamp | null;
  source_version_ordinal: number | null;
  freshness_state: FreshnessState;
  record_status: GeoRecordStatus;
  rights_status: LicenseStatus;
  public_query_allowed: boolean;
}

export interface GeoRecordSource extends FactProvenance {
  geo_record_id: string;
  /** Version of the derived geographic record. */
  version_id: string;
  source_record_id: string;
  source_version_id: string;
  evidence_role: string;
  original_url: string | null;
}

export interface Boundary extends FactProvenance {
  boundary_id: string;
  version_id: string;
  scheme: string;
  code: string;
  name: string;
  vintage: string;
  geometry_geojson: string;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  source_record_id: string;
}

export type AreaIndicatorValue =
  | { status: 'observed'; value: number }
  | { status: 'suppressed' | 'missing'; value: null };

export type AreaIndicator = FactProvenance & AreaIndicatorValue & {
  indicator_id: string;
  version_id: string;
  boundary_id: string;
  period_start: UtcTimestamp;
  period_end: UtcTimestamp;
  unit: string;
  assertion_kind: AssertionKind;
  source_record_id: string;
  definition: string;
  /** Original statistical geography is retained when an exact boundary vintage is unavailable. */
  source_area_name?: string | null;
  source_area_code?: string | null;
  source_area_vintage?: string | null;
  source_updated_at: UtcTimestamp | null;
  source_version_ordinal: number | null;
};

export interface ParkingBay extends FactProvenance {
  bay_id: string;
  version_id: string;
  marker_id: string | null;
  geometry_geojson: string | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  public_access: boolean | null;
  source_record_id: string;
  source_updated_at: UtcTimestamp | null;
  source_version_ordinal: number | null;
}

export interface ParkingObservation extends FactProvenance {
  sensor_id: string;
  bay_id: string | null;
  marker_id: string | null;
  version_id: string;
  observed_at: UtcTimestamp;
  occupied: boolean | null;
  source_record_id: string;
}

export interface ParkingRule extends FactProvenance {
  rule_id: string;
  version_id: string;
  bay_id: string;
  days_of_week: readonly number[];
  start_minute_of_day: number | null;
  end_minute_of_day: number | null;
  holiday_applicability: string | null;
  vehicle_class: string | null;
  restriction_type: string;
  max_stay_minutes: number | null;
  exemption: string | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  source_record_id: string;
  source_updated_at: UtcTimestamp | null;
  source_version_ordinal: number | null;
}

export interface SensorLocation extends FactProvenance {
  sensor_id: string;
  version_id: string;
  geometry_geojson: string | null;
  device_status: string | null;
  valid_from: UtcTimestamp;
  valid_to: UtcTimestamp | null;
  source_record_id: string;
  source_updated_at: UtcTimestamp | null;
  source_version_ordinal: number | null;
}

export interface PedestrianObservation extends FactProvenance {
  sensor_id: string;
  observed_at: UtcTimestamp;
  version_id: string;
  direction_a_count: number | null;
  direction_b_count: number | null;
  total_count: number | null;
  source_record_id: string;
}
