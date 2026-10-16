-- Minute and hourly counts retain their original granularity. An absent
-- minute is absent, never zero. A sensor location is joined only for the
-- version effective for the complete count window; unmatched counts stay visible.
CREATE OR REPLACE VIEW `melens_query.v_pedestrian_observations` AS
WITH batches AS (
  SELECT batch_id, source_id, state, published_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
sources AS (
  SELECT source_id, license_status, access_status, record_granularity,
         cadence_seconds, check_interval_seconds, last_success_at
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
),
published_records AS (
  SELECT r.*, b.published_at AS record_batch_published_at
  FROM `melens_ingest.source_records` r
  JOIN batches b USING (batch_id, source_id)
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
),
record_versions AS (
  SELECT * FROM published_records
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id, source_record_id, version_id
    ORDER BY record_batch_published_at DESC, fetched_at DESC,
      IF(rights_status IN ('verified_open', 'restricted')
        AND record_status IN ('active', 'corrected'), 1, 0), batch_id DESC
  ) = 1
),
orderable_records AS (
  SELECT source_id, source_record_id
  FROM record_versions
  GROUP BY source_id, source_record_id
  HAVING COUNT(*) = 1
    OR COUNTIF(source_updated_at IS NULL) = 0
    OR (COUNTIF(source_updated_at IS NOT NULL) = 0
      AND COUNTIF(source_version_ordinal IS NULL) = 0)
    -- Unknown revision order is harmless only when every version grants the
    -- same access. A conflicting permission with no upstream order denies all.
    OR COUNT(DISTINCT TO_JSON_STRING(STRUCT(rights_status, record_status))) = 1
),
ranked_record_access AS (
  SELECT r.*, DENSE_RANK() OVER (
    PARTITION BY source_id, source_record_id
    ORDER BY source_updated_at DESC NULLS LAST, source_version_ordinal DESC NULLS LAST
  ) AS access_rank
  FROM record_versions r
  JOIN orderable_records USING (source_id, source_record_id)
),
latest_record_access AS (
  -- A source revision can close one location interval and open another.
  -- Equal revision clocks therefore agree on permission, or deny access.
  SELECT source_id, source_record_id,
    LOGICAL_AND(rights_status IN ('verified_open', 'restricted')
      AND record_status IN ('active', 'corrected')) AS is_public
  FROM ranked_record_access WHERE access_rank = 1
  GROUP BY source_id, source_record_id
),
observations AS (
  SELECT o.*, CASE s.record_granularity
      WHEN 'sensor_minute' THEN TIMESTAMP_ADD(o.observed_at, INTERVAL 1 MINUTE)
      WHEN 'sensor_hour' THEN TIMESTAMP_ADD(o.observed_at, INTERVAL 1 HOUR) END AS observation_end,
    s.record_granularity, s.cadence_seconds,
         s.check_interval_seconds, s.last_success_at
  FROM `melens_ingest.pedestrian_observations` AS o
  JOIN batches AS b USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  JOIN published_records r
    ON r.batch_id = o.batch_id AND r.source_id = o.source_id
   AND r.source_record_id = o.source_record_id AND r.version_id = o.version_id
  JOIN latest_record_access access
    ON access.source_id = o.source_id AND access.source_record_id = o.source_record_id
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
    AND r.rights_status IN ('verified_open', 'restricted')
    AND r.record_status IN ('active', 'corrected')
    AND access.is_public
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.source_id, o.sensor_id, o.observed_at
    ORDER BY r.source_updated_at DESC NULLS LAST,
             r.source_version_ordinal DESC NULLS LAST,
             o.fetched_at DESC, o.batch_id DESC
  ) = 1
),
locations AS (
  SELECT l.*
  FROM `melens_ingest.sensor_locations` AS l
  JOIN batches AS b USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  JOIN published_records r
    ON r.batch_id = l.batch_id AND r.source_id = l.source_id
   AND r.source_record_id = l.source_record_id AND r.version_id = l.version_id
  JOIN latest_record_access access
    ON access.source_id = l.source_id AND access.source_record_id = l.source_record_id
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
    AND r.rights_status IN ('verified_open', 'restricted')
    AND r.record_status IN ('active', 'corrected')
    AND access.is_public
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY l.source_id, l.sensor_id, l.valid_from
    ORDER BY r.source_updated_at DESC NULLS LAST,
             r.source_version_ordinal DESC NULLS LAST,
             l.fetched_at DESC, IF(l.valid_to IS NULL, 1, 0),
             b.published_at DESC, l.batch_id DESC
  ) = 1
),
classified_locations AS (
  SELECT l.*, CASE
    WHEN l.geometry_geojson IS NULL OR TRIM(l.geometry_geojson) = ''
      OR SAFE.ST_GEOGFROMGEOJSON(l.geometry_geojson) IS NULL
      OR LOWER(TRIM(l.device_status)) LIKE '%decommission%' THEN 'unlocated'
    WHEN l.device_status IS NOT NULL
      AND LOWER(TRIM(l.device_status)) NOT IN ('a', 'active') THEN 'inactive'
    ELSE 'located'
  END AS location_state
  FROM locations l
),
matches AS (
  SELECT o.*, l.source_id AS location_source_id,
    l.source_record_id AS location_source_record_id, l.version_id AS location_version_id,
    l.valid_from AS location_valid_from, l.valid_to AS location_valid_to,
    l.device_status, l.geometry_geojson AS location_geometry_geojson, l.location_state,
    l.valid_from <= o.observed_at
      AND (l.valid_to IS NULL OR l.valid_to >= o.observation_end) AS location_covers_window,
    COUNT(DISTINCT IF(l.sensor_id IS NULL, NULL,
      TO_JSON_STRING(STRUCT(l.geometry_geojson, l.location_state)))) OVER (
        PARTITION BY o.source_id, o.sensor_id, o.observed_at) AS location_variants,
    ROW_NUMBER() OVER (
      PARTITION BY o.source_id, o.sensor_id, o.observed_at
      ORDER BY IF(l.valid_from <= o.observed_at
        AND (l.valid_to IS NULL OR l.valid_to >= o.observation_end), 0, 1),
        l.valid_from DESC NULLS LAST, l.fetched_at DESC NULLS LAST,
        l.source_updated_at DESC NULLS LAST, l.batch_id DESC NULLS LAST) AS chosen
  FROM observations o
  LEFT JOIN classified_locations l
    ON o.sensor_id = l.sensor_id AND l.valid_from < o.observation_end
   AND (l.valid_to IS NULL OR o.observed_at < l.valid_to)
)
SELECT
  o.source_id,
  o.batch_id,
  o.source_record_id,
  o.version_id,
  o.sensor_id,
  o.observed_at,
  o.direction_a_count,
  o.direction_b_count,
  o.total_count,
  o.record_granularity,
  o.fetched_at,
  o.last_success_at AS source_last_success_at,
  o.location_source_id,
  o.location_source_record_id,
  o.location_version_id,
  o.location_valid_from,
  o.location_valid_to,
  o.device_status,
  'latest_published_record_v1' AS rights_evidence,
  IF(o.location_covers_window AND o.location_variants = 1 AND o.location_state = 'located',
    o.location_geometry_geojson, NULL) AS geometry_geojson,
  IF(o.location_covers_window AND o.location_variants = 1 AND o.location_state = 'located',
    SAFE.ST_GEOGFROMGEOJSON(o.location_geometry_geojson), NULL) AS geometry,
  CASE WHEN NOT COALESCE(o.location_covers_window, FALSE) THEN 'unlocated'
    WHEN o.location_variants > 1 THEN 'ambiguous'
    ELSE COALESCE(o.location_state, 'unlocated') END AS location_status,
  CASE
    WHEN o.cadence_seconds IS NULL AND o.check_interval_seconds IS NULL
      THEN 'versioned'
    WHEN o.last_success_at IS NULL THEN 'unknown'
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.last_success_at, SECOND)
         <= 2 * COALESCE(o.cadence_seconds, o.check_interval_seconds)
      THEN 'current'
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.last_success_at, SECOND)
         <= 4 * COALESCE(o.cadence_seconds, o.check_interval_seconds)
      THEN 'late'
    ELSE 'stale'
  END AS source_freshness_state
FROM matches AS o
WHERE chosen = 1;

-- Generic street facts and road events use the already licensed, published
-- core views. Lifecycle and freshness remain separate columns.
CREATE OR REPLACE VIEW `melens_query.v_street_observations` AS
SELECT geo_record_id, version_id, source_id, topic, assertion_kind,
       is_prediction, title, geometry, geometry_geojson, location_role,
       location_confidence, area_refs, observed_at, published_at,
       valid_from, valid_to, fetched_at, freshness_state, record_status
FROM `melens_query.v_geo_records_current`
WHERE topic IN ('pedestrian', 'parking', 'road_disruption', 'other')
  AND assertion_kind = 'observation';

CREATE OR REPLACE VIEW `melens_query.v_road_disruptions_current` AS
SELECT geo_record_id, version_id, source_id, title, summary, original_url,
       geometry, geometry_geojson, location_role, location_confidence,
       area_refs, observed_at, published_at, valid_from, valid_to,
       fetched_at, freshness_state, record_status, assertion_kind,
       is_prediction
FROM `melens_query.v_geo_records_current`
WHERE topic = 'road_disruption'
  AND record_status = 'active'
  AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP())
  AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP());

CREATE OR REPLACE VIEW `melens_query.v_road_disruptions_history` AS
SELECT geo_record_id, version_id, source_id, title, summary, original_url,
       geometry, geometry_geojson, location_role, location_confidence,
       area_refs, observed_at, published_at, valid_from, valid_to,
       fetched_at, freshness_state, record_status, assertion_kind,
       is_prediction
FROM `melens_query.v_geo_records_history`
WHERE topic = 'road_disruption';
