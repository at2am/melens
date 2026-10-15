-- Run in the target GCP project after bootstrap has created both datasets in
-- australia-southeast2. Fact tables are append-only; BigQuery does not enforce
-- uniqueness, enum values, or foreign keys. The publisher validates them before
-- changing a batch to published. CREATE IF NOT EXISTS never migrates an old table.

-- Registry and batch state are controlled by the ingestion identity. A source
-- moving to paused/review_required immediately disappears from public views.
CREATE TABLE IF NOT EXISTS `melens_ingest.data_sources` (
  source_id STRING NOT NULL,
  legacy_ids ARRAY<STRING>,
  provider STRING NOT NULL,
  dataset_title STRING NOT NULL,
  landing_url STRING NOT NULL,
  topic STRING NOT NULL,
  scope STRING NOT NULL,
  coverage_area_refs ARRAY<STRING>,
  coverage_from TIMESTAMP,
  coverage_to TIMESTAMP,
  cadence_seconds INT64,
  check_interval_seconds INT64,
  record_granularity STRING NOT NULL,
  admission_evidence JSON,
  connector_owner STRING,
  license_status STRING NOT NULL,
  access_status STRING NOT NULL,
  last_checked_at TIMESTAMP,
  last_success_at TIMESTAMP,
  last_source_update_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL
)
CLUSTER BY source_id;

-- A batch is published only after all fact writes and SQL checks succeed.
-- state_updated_at orders state transitions if retries leave duplicate rows.
CREATE TABLE IF NOT EXISTS `melens_ingest.sync_batches` (
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  window_from TIMESTAMP,
  window_to TIMESTAMP,
  source_revision STRING,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  state STRING NOT NULL,
  state_updated_at TIMESTAMP NOT NULL,
  raw_uri STRING,
  staging_uris ARRAY<STRING>,
  published_at TIMESTAMP,
  input_count INT64,
  output_count INT64,
  rejected_count INT64,
  checkpoint_before STRING,
  checkpoint_after STRING,
  error_code STRING,
  schema_version INT64 NOT NULL
)
PARTITION BY DATE(started_at)
CLUSTER BY source_id, batch_id;

-- source_updated_at or source_version_ordinal is required for any mutable
-- source with conflicting versions. Ambiguous conflicts must be quarantined;
-- fetched_at is never a substitute for upstream revision ordering.
CREATE TABLE IF NOT EXISTS `melens_ingest.source_records` (
  source_record_id STRING NOT NULL,
  version_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  source_updated_at TIMESTAMP,
  source_version_ordinal INT64,
  original_url STRING,
  raw_uri STRING,
  published_at TIMESTAMP,
  observed_at TIMESTAMP,
  first_accessible_at TIMESTAMP,
  time_missing_reason STRING,
  valid_from TIMESTAMP,
  valid_to TIMESTAMP,
  record_status STRING NOT NULL,
  assertion_kind STRING NOT NULL,
  rights_status STRING NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, source_record_id, version_id;

-- Only publisher-vetted public fields belong in title/summary/original_url.
-- public_query_allowed is deny-by-default, including for restricted sources.
-- A later withdrawn permission version suppresses all older history versions.
CREATE TABLE IF NOT EXISTS `melens_ingest.geo_records` (
  geo_record_id STRING NOT NULL,
  version_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  source_updated_at TIMESTAMP,
  source_version_ordinal INT64,
  topic STRING NOT NULL,
  assertion_kind STRING NOT NULL,
  title STRING,
  summary STRING,
  original_url STRING,
  geometry_geojson STRING,
  centroid_lat FLOAT64,
  centroid_lon FLOAT64,
  location_role STRING NOT NULL,
  location_confidence STRING NOT NULL,
  area_refs ARRAY<STRING>,
  observed_at TIMESTAMP,
  published_at TIMESTAMP,
  valid_from TIMESTAMP,
  valid_to TIMESTAMP,
  freshness_state STRING NOT NULL,
  record_status STRING NOT NULL,
  rights_status STRING NOT NULL,
  public_query_allowed BOOL NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, geo_record_id, version_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.geo_record_sources` (
  geo_record_id STRING NOT NULL,
  version_id STRING NOT NULL,
  source_record_id STRING NOT NULL,
  source_version_id STRING NOT NULL,
  evidence_role STRING NOT NULL,
  original_url STRING,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, geo_record_id, source_record_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.boundaries` (
  boundary_id STRING NOT NULL,
  version_id STRING NOT NULL,
  scheme STRING NOT NULL,
  code STRING NOT NULL,
  name STRING NOT NULL,
  vintage STRING NOT NULL,
  geometry_geojson STRING NOT NULL,
  valid_from TIMESTAMP,
  valid_to TIMESTAMP,
  source_record_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, boundary_id, vintage;

CREATE TABLE IF NOT EXISTS `melens_ingest.area_indicators` (
  indicator_id STRING NOT NULL,
  version_id STRING NOT NULL,
  boundary_id STRING NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  value NUMERIC,
  unit STRING NOT NULL,
  status STRING NOT NULL,
  assertion_kind STRING NOT NULL,
  definition STRING,
  source_area_name STRING,
  source_area_code STRING,
  source_area_vintage STRING,
  source_record_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  source_updated_at TIMESTAMP,
  source_version_ordinal INT64
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, indicator_id, boundary_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.parking_bays` (
  bay_id STRING NOT NULL,
  version_id STRING NOT NULL,
  marker_id STRING,
  geometry_geojson STRING,
  public_access BOOL,
  valid_from TIMESTAMP,
  valid_to TIMESTAMP,
  source_record_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  source_updated_at TIMESTAMP,
  source_version_ordinal INT64
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, bay_id, marker_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.parking_observations` (
  sensor_id STRING NOT NULL,
  bay_id STRING,
  marker_id STRING,
  version_id STRING NOT NULL,
  observed_at TIMESTAMP NOT NULL,
  occupied BOOL,
  source_record_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, bay_id, sensor_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.parking_sensor_memberships` (
  sensor_id STRING NOT NULL,
  version_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  business_source_record_id STRING NOT NULL,
  business_state_hash STRING NOT NULL,
  business_version_id STRING NOT NULL,
  business_batch_id STRING NOT NULL,
  source_updated_at TIMESTAMP,
  snapshot_source_record_id STRING NOT NULL,
  snapshot_version_id STRING NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, batch_id, sensor_id, business_version_id;

-- The latest complete sensor snapshot, replaced whole in one transaction after each
-- published batch (src/core/parking-sensor-current.ts). The map and agents read only this
-- table (through v_parking_sensor_current), so their cost stays at a few MB however much
-- append-only history the other parking tables hold. One row per sensor; never append.
CREATE TABLE IF NOT EXISTS `melens_ingest.parking_sensor_current` (
  sensor_id STRING NOT NULL,
  source_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  source_record_id STRING NOT NULL,
  version_id STRING NOT NULL,
  source_updated_at TIMESTAMP NOT NULL,
  observed_at TIMESTAMP,
  occupied BOOL,
  status_description STRING,
  zone_number INT64,
  marker_id STRING,
  bay_id STRING,
  latitude FLOAT64,
  longitude FLOAT64,
  geometry_geojson STRING,
  original_url STRING NOT NULL,
  record_status STRING NOT NULL,
  rights_status STRING NOT NULL
)
CLUSTER BY source_id, sensor_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.parking_rules` (
  rule_id STRING NOT NULL,
  version_id STRING NOT NULL,
  bay_id STRING NOT NULL,
  days_of_week ARRAY<INT64>,
  start_minute_of_day INT64,
  end_minute_of_day INT64,
  holiday_applicability STRING,
  vehicle_class STRING,
  restriction_type STRING NOT NULL,
  max_stay_minutes INT64,
  exemption STRING,
  valid_from TIMESTAMP,
  valid_to TIMESTAMP,
  source_record_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  source_updated_at TIMESTAMP,
  source_version_ordinal INT64
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, bay_id, rule_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.sensor_locations` (
  sensor_id STRING NOT NULL,
  version_id STRING NOT NULL,
  geometry_geojson STRING,
  device_status STRING,
  valid_from TIMESTAMP NOT NULL,
  valid_to TIMESTAMP,
  source_record_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL,
  source_updated_at TIMESTAMP,
  source_version_ordinal INT64
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, sensor_id, version_id;

CREATE TABLE IF NOT EXISTS `melens_ingest.pedestrian_observations` (
  sensor_id STRING NOT NULL,
  observed_at TIMESTAMP NOT NULL,
  version_id STRING NOT NULL,
  direction_a_count INT64,
  direction_b_count INT64,
  total_count INT64,
  source_record_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  source_id STRING NOT NULL,
  schema_version INT64 NOT NULL,
  fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, sensor_id, observed_at;

-- Anomaly results of the hourly detector, and of the replay of a historical day
-- (is_replay). One row is one sensor-hour judged against its baseline; a row is
-- public only through melens_query.v_anomaly_current, once its batch is published.
CREATE TABLE IF NOT EXISTS `melens_ingest.anomaly_results` (
  result_id STRING NOT NULL,
  source_id STRING NOT NULL,
  batch_id STRING NOT NULL,
  sensor_id STRING NOT NULL,
  sensor_name STRING,
  lat FLOAT64,
  lon FLOAT64,
  window_from TIMESTAMP NOT NULL,
  window_to TIMESTAMP NOT NULL,
  observation_id STRING,
  baseline_definition_id STRING,
  baseline_value FLOAT64,
  observed_value FLOAT64,
  delta FLOAT64,
  direction STRING NOT NULL,
  classification STRING NOT NULL,
  is_replay BOOL NOT NULL,
  replay_label STRING,
  location_evidence STRING,
  fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY source_id, result_id;
