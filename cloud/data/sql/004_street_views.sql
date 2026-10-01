-- Minute and hourly counts retain their original granularity. An absent
-- minute is absent, never zero. A sensor location is joined only for the
-- version effective at the observation time; unmatched counts stay visible.
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
observations AS (
  SELECT o.*, s.record_granularity, s.cadence_seconds,
         s.check_interval_seconds, s.last_success_at
  FROM `melens_ingest.pedestrian_observations` AS o
  JOIN batches AS b USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  JOIN `melens_ingest.source_records` r
    ON r.batch_id = o.batch_id AND r.source_id = o.source_id
   AND r.source_record_id = o.source_record_id AND r.version_id = o.version_id
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
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
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY l.sensor_id, l.valid_from
    ORDER BY l.source_updated_at DESC NULLS LAST,
             l.source_version_ordinal DESC NULLS LAST,
             l.version_id DESC
  ) = 1
)
SELECT
  o.source_id,
  o.batch_id,
  o.sensor_id,
  o.observed_at,
  o.direction_a_count,
  o.direction_b_count,
  o.total_count,
  o.record_granularity,
  o.fetched_at,
  o.last_success_at AS source_last_success_at,
  l.source_id AS location_source_id,
  l.valid_from AS location_valid_from,
  l.valid_to AS location_valid_to,
  l.device_status,
  l.geometry_geojson,
  SAFE.ST_GEOGFROMGEOJSON(l.geometry_geojson) AS geometry,
  IF(l.sensor_id IS NULL, 'unlocated', 'located') AS location_status,
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
FROM observations AS o
LEFT JOIN locations AS l
  ON o.sensor_id = l.sensor_id
 AND l.valid_from <= o.observed_at
 AND (l.valid_to IS NULL OR o.observed_at < l.valid_to)
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY o.source_id, o.sensor_id, o.observed_at
  ORDER BY l.valid_from DESC NULLS LAST, l.version_id DESC NULLS LAST
) = 1;

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
