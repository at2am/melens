-- Parking eligibility is conservative. A free sensor never proves that parking
-- is legal. All inputs must come from published, active sources.
-- A unique publisher marker_id can show occupancy. The current City export
-- has only kerbsideid, which is deliberately kept distinct from marker_id.
-- The restriction export has no verified crosswalk, so neither its bayid nor
-- a coincidentally equal ID can grant or prohibit parking in this view.
CREATE OR REPLACE VIEW `melens_query.v_parking_current` AS
WITH batches AS (
  SELECT batch_id, source_id, state, published_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
published AS (
  SELECT batch_id, source_id FROM batches
  WHERE state = 'published' AND published_at IS NOT NULL
),
sources AS (
  SELECT source_id, cadence_seconds, check_interval_seconds,
         last_success_at, license_status, access_status
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
),
bays AS (
  SELECT b.*
  FROM `melens_ingest.parking_bays` AS b
  JOIN published AS p USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  WHERE s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY bay_id
    ORDER BY source_updated_at DESC NULLS LAST,
             source_version_ordinal DESC NULLS LAST,
             version_id DESC
  ) = 1
),
marker_counts AS (
  SELECT marker_id, COUNT(*) AS bay_count
  FROM bays
  WHERE marker_id IS NOT NULL
  GROUP BY marker_id
),
observations AS (
  SELECT o.*,
         COALESCE(s.cadence_seconds, s.check_interval_seconds) AS cadence_seconds,
         s.last_success_at
  FROM `melens_ingest.parking_observations` AS o
  JOIN published AS p USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  WHERE s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.sensor_id
    ORDER BY o.observed_at DESC, o.version_id DESC, o.fetched_at DESC
  ) = 1
),
observation_marker_counts AS (
  SELECT marker_id, COUNT(*) AS sensor_count
  FROM observations
  WHERE marker_id IS NOT NULL
  GROUP BY marker_id
)
-- A verified sensor-bay-to-rule mapping is required before rules can be used.
-- No such mapping has been admitted for the present City exports.
SELECT
  b.bay_id,
  b.marker_id,
  b.source_id AS bay_source_id,
  b.version_id AS bay_version_id,
  b.public_access,
  b.geometry_geojson,
  SAFE.ST_GEOGFROMGEOJSON(b.geometry_geojson) AS geometry,
  o.sensor_id,
  o.source_id AS occupancy_source_id,
  o.observed_at AS occupancy_observed_at,
  o.fetched_at AS occupancy_fetched_at,
  o.occupied,
  CASE WHEN m.bay_count = 1 AND om.sensor_count = 1 AND o.sensor_id IS NOT NULL
       THEN 'shared_marker_id' ELSE 'unverified' END AS occupancy_join_evidence,
  CAST(NULL AS STRING) AS rule_source_ids,
  CAST(NULL AS TIMESTAMP) AS rule_fetched_at,
  CAST(NULL AS TIMESTAMP) AS rule_valid_from,
  m.bay_count AS bays_with_marker,
  0 AS applicable_rule_count,
  CASE
    WHEN o.observed_at IS NULL OR o.cadence_seconds IS NULL
      OR o.last_success_at IS NULL THEN 'unknown'
    WHEN o.observed_at > CURRENT_TIMESTAMP() THEN 'unknown'
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.observed_at, SECOND)
         <= 2 * o.cadence_seconds
      AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.last_success_at, SECOND)
          <= 2 * o.cadence_seconds THEN 'current'
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.observed_at, SECOND)
         <= 4 * o.cadence_seconds THEN 'late'
    ELSE 'stale'
  END AS occupancy_freshness,
  CASE
    WHEN b.public_access = FALSE THEN 'no'
    WHEN b.public_access IS NULL OR o.observed_at IS NULL
      OR b.marker_id IS NULL OR o.marker_id IS NULL
      OR b.marker_id != o.marker_id
      OR m.bay_count != 1 OR om.sensor_count != 1 THEN 'unknown'
    WHEN o.cadence_seconds IS NULL OR o.last_success_at IS NULL
      OR o.observed_at > CURRENT_TIMESTAMP()
      OR TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.observed_at, SECOND)
         > 2 * o.cadence_seconds
      OR TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.last_success_at, SECOND)
         > 2 * o.cadence_seconds THEN 'unknown'
    WHEN o.occupied = TRUE THEN 'no'
    ELSE 'unknown'
  END AS may_park_now
FROM bays AS b
LEFT JOIN marker_counts AS m ON b.marker_id = m.marker_id
LEFT JOIN observation_marker_counts AS om ON b.marker_id = om.marker_id
LEFT JOIN observations AS o ON b.marker_id = o.marker_id AND om.sensor_count = 1
WHERE (b.valid_from IS NULL OR b.valid_from <= CURRENT_TIMESTAMP())
  AND (b.valid_to IS NULL OR b.valid_to > CURRENT_TIMESTAMP());

-- Keep admitted sensor observations that cannot be joined to an active bay
-- available for diagnosis; they have no legal-parking conclusion or geometry.
CREATE OR REPLACE VIEW `melens_query.v_parking_unmatched_observations` AS
WITH batches AS (
  SELECT batch_id, source_id, state, published_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
sources AS (
  SELECT source_id, license_status, access_status
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
),
observations AS (
  SELECT o.sensor_id, o.bay_id, o.marker_id, o.observed_at,
         o.occupied, o.fetched_at, o.source_id, o.batch_id, o.version_id
  FROM `melens_ingest.parking_observations` AS o
  JOIN batches AS b USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.sensor_id
    ORDER BY o.observed_at DESC, o.version_id DESC, o.fetched_at DESC
  ) = 1
)
SELECT o.*, 'unknown' AS may_park_now
FROM observations AS o
WHERE o.marker_id IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM `melens_query.v_parking_current` AS b
     WHERE b.marker_id = o.marker_id AND b.occupancy_join_evidence = 'shared_marker_id'
   );
