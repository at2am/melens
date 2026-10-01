-- A free sensor does not prove legal parking. Missing current rule evidence
-- keeps may_park_now unknown. kerbsideid is not a verified marker_id crosswalk.
CREATE OR REPLACE VIEW `melens_query.v_parking_current` AS
WITH batches AS (
  SELECT batch_id, source_id, state, published_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
sources AS (
  SELECT source_id, cadence_seconds, check_interval_seconds,
         last_success_at, license_status, access_status
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
),
bay_candidates AS (
  SELECT b.*, r.record_status AS source_record_status,
    r.rights_status AS source_record_rights,
    TO_JSON_STRING(STRUCT(b.marker_id, b.geometry_geojson, b.public_access, b.valid_to, r.record_status, r.rights_status)) AS content_key
  FROM `melens_ingest.parking_bays` b
  JOIN batches p USING (batch_id, source_id)
  JOIN sources s USING (source_id)
  JOIN `melens_ingest.source_records` r
    ON r.batch_id = b.batch_id AND r.source_id = b.source_id
   AND r.source_record_id = b.source_record_id AND r.version_id = b.version_id
  WHERE p.state = 'published' AND p.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted') AND s.access_status = 'active'
  QUALIFY DENSE_RANK() OVER (
    PARTITION BY b.source_id, b.bay_id, b.valid_from
    ORDER BY r.source_updated_at DESC NULLS LAST,
             r.source_version_ordinal DESC NULLS LAST, b.fetched_at DESC
  ) = 1
),
bay_versions AS (
  SELECT b.*, COUNT(DISTINCT content_key) OVER (
    PARTITION BY source_id, bay_id, valid_from) AS content_variant_count
  FROM bay_candidates b
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id, bay_id, valid_from
    ORDER BY batch_id DESC, version_id DESC
  ) = 1
),
active_bays AS (
  SELECT b.*,
    COUNT(*) OVER (PARTITION BY source_id, bay_id) AS active_version_count
  FROM bay_versions b
  WHERE source_record_status IN ('active', 'corrected')
    AND source_record_rights IN ('verified_open', 'restricted')
    AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP())
    AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP())
),
bays AS (
  SELECT * FROM active_bays
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id, bay_id
    ORDER BY valid_from DESC NULLS LAST, fetched_at DESC, batch_id DESC
  ) = 1
),
marker_counts AS (
  SELECT marker_id, COUNT(DISTINCT TO_JSON_STRING(STRUCT(source_id, bay_id))) AS bay_count
  FROM bay_candidates WHERE source_record_status IN ('active', 'corrected')
    AND source_record_rights IN ('verified_open', 'restricted')
    AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP())
    AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP())
    AND marker_id IS NOT NULL AND TRIM(marker_id) != ''
  GROUP BY marker_id
),
observation_candidates AS (
  SELECT o.*, r.record_status AS source_record_status,
    r.rights_status AS source_record_rights,
         COALESCE(s.cadence_seconds, s.check_interval_seconds) AS cadence_seconds,
         s.last_success_at,
         TO_JSON_STRING(STRUCT(o.bay_id, o.marker_id, o.occupied, r.record_status, r.rights_status)) AS content_key
  FROM `melens_ingest.parking_observations` o
  JOIN batches b USING (batch_id, source_id)
  JOIN sources s USING (source_id)
  JOIN `melens_ingest.source_records` r
    ON r.batch_id = o.batch_id AND r.source_id = o.source_id
   AND r.source_record_id = o.source_record_id AND r.version_id = o.version_id
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted') AND s.access_status = 'active'
  QUALIFY DENSE_RANK() OVER (
    PARTITION BY o.source_id, o.sensor_id
    ORDER BY o.observed_at DESC, r.source_updated_at DESC NULLS LAST,
             r.source_version_ordinal DESC NULLS LAST
  ) = 1
),
observation_versions AS (
  SELECT o.*,
    COUNT(DISTINCT content_key) OVER (
      PARTITION BY source_id, sensor_id) > 1 AS ambiguous
  FROM observation_candidates o
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id, sensor_id
    ORDER BY fetched_at DESC, batch_id DESC, version_id DESC
  ) = 1
),
observations AS (
  SELECT * FROM observation_versions
  WHERE source_record_status IN ('active', 'corrected')
    AND source_record_rights IN ('verified_open', 'restricted')
),
observation_marker_counts AS (
  SELECT marker_id,
    COUNT(DISTINCT TO_JSON_STRING(STRUCT(source_id, sensor_id))) AS sensor_count
  FROM observation_candidates WHERE source_record_rights IN ('verified_open', 'restricted')
    AND marker_id IS NOT NULL AND TRIM(marker_id) != ''
  GROUP BY marker_id
),
matched AS (
  SELECT b.*, m.bay_count, om.sensor_count,
    o.sensor_id, o.source_id AS occupancy_source_id,
    o.batch_id AS occupancy_batch_id, o.source_record_id AS occupancy_source_record_id,
    o.version_id AS occupancy_version_id, o.observed_at, o.fetched_at AS occupancy_fetched_at,
    o.occupied, o.cadence_seconds, o.last_success_at,
    CASE
      WHEN o.observed_at IS NULL OR o.cadence_seconds IS NULL OR o.cadence_seconds <= 0
        OR o.last_success_at IS NULL OR o.observed_at > CURRENT_TIMESTAMP()
        OR o.last_success_at > CURRENT_TIMESTAMP() THEN 'unknown'
      WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.observed_at, SECOND) <= 2 * o.cadence_seconds
        AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.last_success_at, SECOND) <= 2 * o.cadence_seconds
        THEN 'current'
      WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.observed_at, SECOND) <= 4 * o.cadence_seconds
        AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.last_success_at, SECOND) <= 4 * o.cadence_seconds
        THEN 'late'
      ELSE 'stale'
    END AS occupancy_freshness
  FROM bays b
  LEFT JOIN marker_counts m ON b.marker_id = m.marker_id
  LEFT JOIN observation_marker_counts om ON b.marker_id = om.marker_id
  LEFT JOIN observations o
    ON b.marker_id = o.marker_id AND m.bay_count = 1 AND om.sensor_count = 1
   AND b.active_version_count = 1 AND b.content_variant_count = 1 AND NOT o.ambiguous
)
SELECT
  bay_id, marker_id, source_id AS bay_source_id, version_id AS bay_version_id,
  batch_id AS bay_batch_id, source_record_id AS bay_source_record_id,
  fetched_at AS bay_fetched_at, public_access,
  IF(active_version_count = 1 AND content_variant_count = 1, geometry_geojson, NULL) AS geometry_geojson,
  IF(active_version_count = 1 AND content_variant_count = 1,
    SAFE.ST_GEOGFROMGEOJSON(geometry_geojson), NULL) AS geometry,
  sensor_id, occupancy_source_id, occupancy_batch_id, occupancy_source_record_id,
  occupancy_version_id, observed_at AS occupancy_observed_at, occupancy_fetched_at, occupied,
  CASE WHEN sensor_id IS NOT NULL THEN 'shared_marker_id' ELSE 'unverified' END AS occupancy_join_evidence,
  CAST(NULL AS STRING) AS rule_source_ids,
  CAST(NULL AS TIMESTAMP) AS rule_fetched_at,
  CAST(NULL AS TIMESTAMP) AS rule_valid_from,
  bay_count AS bays_with_marker,
  0 AS applicable_rule_count,
  occupancy_freshness,
  CASE
    WHEN active_version_count != 1 OR content_variant_count != 1 THEN 'unknown'
    WHEN public_access = FALSE THEN 'no'
    WHEN public_access = TRUE AND occupancy_freshness = 'current' AND occupied = TRUE THEN 'no'
    ELSE 'unknown'
  END AS may_park_now
FROM matched;

-- Unmatched or conflicting observations retain their source references. They
-- cannot grant legal parking or acquire geometry from an ambiguous marker.
CREATE OR REPLACE VIEW `melens_query.v_parking_unmatched_observations` AS
WITH batches AS (
  SELECT batch_id, source_id, state, published_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
sources AS (
  SELECT source_id, cadence_seconds, check_interval_seconds,
         last_success_at, license_status, access_status
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
),
observation_candidates AS (
  SELECT o.*, r.record_status AS source_record_status,
    r.rights_status AS source_record_rights,
         COALESCE(s.cadence_seconds, s.check_interval_seconds) AS cadence_seconds,
         s.last_success_at,
         TO_JSON_STRING(STRUCT(o.bay_id, o.marker_id, o.occupied, r.record_status, r.rights_status)) AS content_key
  FROM `melens_ingest.parking_observations` o
  JOIN batches b USING (batch_id, source_id)
  JOIN sources s USING (source_id)
  JOIN `melens_ingest.source_records` r
    ON r.batch_id = o.batch_id AND r.source_id = o.source_id
   AND r.source_record_id = o.source_record_id AND r.version_id = o.version_id
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted') AND s.access_status = 'active'
  QUALIFY DENSE_RANK() OVER (
    PARTITION BY o.source_id, o.sensor_id
    ORDER BY o.observed_at DESC, r.source_updated_at DESC NULLS LAST,
             r.source_version_ordinal DESC NULLS LAST
  ) = 1
),
observation_versions AS (
  SELECT o.*,
    COUNT(DISTINCT content_key) OVER (
      PARTITION BY source_id, sensor_id) > 1 AS ambiguous
  FROM observation_candidates o
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id, sensor_id
    ORDER BY fetched_at DESC, batch_id DESC, version_id DESC
  ) = 1
),
observations AS (
  SELECT * FROM observation_versions
  WHERE source_record_status IN ('active', 'corrected')
    AND source_record_rights IN ('verified_open', 'restricted')
)
SELECT o.sensor_id, o.bay_id, o.marker_id, o.observed_at,
  IF(o.ambiguous, NULL, o.occupied) AS occupied,
  o.fetched_at, o.source_id, o.batch_id, o.version_id, o.source_record_id,
  IF(o.ambiguous, 'ambiguous', 'unmatched') AS observation_status,
  'unknown' AS may_park_now
FROM observations o
WHERE o.ambiguous OR NOT EXISTS (
  SELECT 1 FROM `melens_query.v_parking_current` b
  WHERE b.occupancy_source_id = o.source_id AND b.sensor_id = o.sensor_id
    AND b.occupancy_version_id = o.version_id
    AND b.occupancy_batch_id = o.batch_id
    AND b.occupancy_join_evidence = 'shared_marker_id'
);
