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

-- Independent sensor coordinates and reported occupancy need no bay crosswalk.
-- This view reads only parking_sensor_current: the latest complete snapshot, replaced whole in
-- one transaction after each published batch. It never reads the append-only history, so a read
-- costs a few MB however much history exists. Do not point it back at parking_sensor_memberships,
-- source_records or geo_records: that version scanned 165 MB per read (limit 100 MB) and made the
-- map query cost grow with every retained snapshot.
-- A sensor's own `source_updated_at` is its heartbeat. A sensor that stopped reporting keeps its
-- last report time, so it reads as stale and must be drawn as no data, never as vacant.
CREATE OR REPLACE VIEW `melens_query.v_parking_sensor_current` AS
WITH sources AS (
  SELECT source_id, cadence_seconds, check_interval_seconds,
    last_success_at, license_status, access_status
  FROM `melens_ingest.data_sources`
  WHERE source_id = 'melbourne.parking.sensors'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY updated_at DESC) = 1
), snapshot AS (
  SELECT * FROM `melens_ingest.parking_sensor_current`
  WHERE source_id = 'melbourne.parking.sensors'
), published AS (
  SELECT batch_id, source_id
  FROM `melens_ingest.sync_batches`
  WHERE source_id = 'melbourne.parking.sensors'
    AND batch_id IN (SELECT DISTINCT batch_id FROM snapshot)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1 AND state = 'published' AND published_at IS NOT NULL
), candidates AS (
  SELECT p.*, COALESCE(s.cadence_seconds, s.check_interval_seconds) AS cadence_seconds,
    s.last_success_at
  FROM snapshot p
  JOIN published b USING (batch_id, source_id)
  JOIN sources s USING (source_id)
  WHERE s.license_status IN ('verified_open', 'restricted') AND s.access_status = 'active'
    AND p.record_status IN ('active', 'corrected')
    AND p.rights_status IN ('verified_open', 'restricted')
), clock AS (
  SELECT CURRENT_DATE('Australia/Melbourne') AS local_date
), operating_day AS (
  SELECT local_date,
    CASE WHEN EXTRACT(YEAR FROM local_date) = 2026 THEN local_date IN (
      DATE '2026-01-01', DATE '2026-01-26', DATE '2026-03-09', DATE '2026-04-03',
      DATE '2026-04-04', DATE '2026-04-05', DATE '2026-04-06', DATE '2026-04-25',
      DATE '2026-06-08', DATE '2026-09-25', DATE '2026-11-03', DATE '2026-12-25',
      DATE '2026-12-26', DATE '2026-12-28'
    ) ELSE CAST(NULL AS BOOL) END AS is_public_holiday
  FROM clock
), evaluated AS (
  SELECT v.*, d.local_date, d.is_public_holiday,
    CASE
      WHEN cadence_seconds IS NULL OR cadence_seconds <= 0 OR last_success_at IS NULL
        OR source_updated_at > CURRENT_TIMESTAMP() OR last_success_at > CURRENT_TIMESTAMP()
        OR observed_at > source_updated_at THEN 'unknown'
      WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), source_updated_at, SECOND) <= 2 * cadence_seconds
        AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_success_at, SECOND) <= 2 * cadence_seconds
        THEN 'current'
      WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), source_updated_at, SECOND) <= 4 * cadence_seconds
        AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_success_at, SECOND) <= 4 * cadence_seconds
        THEN 'late'
      ELSE 'stale'
    END AS source_freshness
  FROM candidates v CROSS JOIN operating_day d
)
SELECT source_id, batch_id, sensor_id, source_record_id, version_id, marker_id, bay_id,
  occupied,
  status_description AS reported_status,
  zone_number,
  observed_at AS status_changed_at, source_updated_at, fetched_at, last_success_at,
  geometry_geojson,
  SAFE.ST_GEOGFROMGEOJSON(geometry_geojson) AS geometry,
  latitude, longitude,
  original_url, 'City of Melbourne' AS attribution,
  'https://creativecommons.org/licenses/by/4.0/' AS license_url,
  source_freshness,
  IF(is_public_holiday IS FALSE AND observed_at IS NOT NULL, source_freshness, 'unknown') AS occupancy_freshness,
  local_date, is_public_holiday,
  'https://business.vic.gov.au/business-information/public-holidays/victorian-public-holidays-2026' AS holiday_evidence_url,
  '2026 calendar reviewed 2026-10-01, other years unknown' AS holiday_evidence_scope,
  CASE WHEN is_public_holiday IS TRUE THEN 'sensor_not_operational_public_holiday'
    WHEN is_public_holiday IS NULL THEN 'sensor_holiday_status_unknown'
    -- Its own last report is too old: the status it still holds is not a current reading.
    WHEN source_freshness IN ('stale', 'unknown') THEN 'sensor_not_reporting'
    ELSE 'vacancy_does_not_prove_access_or_legal_permission' END AS availability_note,
  TRUE AS construction_obstruction_possible,
  'unknown' AS may_park_now
FROM evaluated;

-- These are source rule references. The publisher calls this dataset static and
-- not updated, and provides no current effective dates or current sensor join.
CREATE OR REPLACE VIEW `melens_query.v_parking_rule_reference` AS
WITH batches AS (
  SELECT batch_id, source_id, state, published_at, started_at
  FROM `melens_ingest.sync_batches`
  WHERE source_id = 'melbourne.parking.restrictions'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
), latest_snapshot AS (
  SELECT batch_id, source_id FROM batches
  WHERE state = 'published' AND published_at IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY started_at DESC, batch_id DESC) = 1
), sources AS (
  SELECT source_id, license_status, access_status
  FROM `melens_ingest.data_sources`
  WHERE source_id = 'melbourne.parking.restrictions'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY updated_at DESC) = 1
)
SELECT q.*, r.version_id AS source_version_id, r.original_url,
  'unverified_current_applicability' AS rule_status,
  'unverified' AS sensor_join_evidence, 'unknown' AS may_park_now,
  'City of Melbourne' AS attribution,
  'https://creativecommons.org/licenses/by/4.0/' AS license_url
FROM `melens_ingest.parking_rules` q
JOIN latest_snapshot b USING (batch_id, source_id)
JOIN sources s USING (source_id)
JOIN `melens_ingest.geo_record_sources` l
  ON l.batch_id = q.batch_id AND l.source_id = q.source_id
 AND l.geo_record_id = q.rule_id AND l.version_id = q.version_id
 AND l.source_record_id = q.source_record_id AND l.evidence_role = 'official_bay_restriction'
JOIN `melens_ingest.source_records` r
  ON r.batch_id = l.batch_id AND r.source_id = l.source_id
 AND r.source_record_id = l.source_record_id AND r.version_id = l.source_version_id
WHERE s.license_status IN ('verified_open', 'restricted') AND s.access_status = 'active'
  AND r.rights_status IN ('verified_open', 'restricted') AND r.record_status IN ('active', 'corrected');
