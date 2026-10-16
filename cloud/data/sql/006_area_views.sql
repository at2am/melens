-- Boundary IDs are vintage-specific (scheme + code + vintage). The view never
-- joins an indicator to a different year's boundary by name or area code.
-- Source records carry the revision order. Multiple boundary versions without
-- a unique upstream timestamp or ordinal are hidden until the order is known.
CREATE OR REPLACE VIEW `melens_query.v_boundaries` AS
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
boundary_versions AS (
  SELECT b.*, sr.source_updated_at, sr.source_version_ordinal,
    sr.rights_status, sr.record_status,
    access.is_public AS latest_record_is_public
  FROM `melens_ingest.boundaries` AS b
  JOIN batches AS batch USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  JOIN published_records AS sr
    ON sr.batch_id = b.batch_id AND sr.source_id = b.source_id
    AND sr.source_record_id = b.source_record_id AND sr.version_id = b.version_id
  JOIN latest_record_access access
    ON access.source_id = b.source_id AND access.source_record_id = b.source_record_id
  WHERE batch.state = 'published' AND batch.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY b.boundary_id, b.version_id
    ORDER BY batch.published_at DESC, b.fetched_at DESC, b.batch_id DESC
  ) = 1
),
orderable AS (
  SELECT boundary_id
  FROM boundary_versions
  GROUP BY boundary_id
  HAVING COUNT(*) = 1
    OR (COUNTIF(source_updated_at IS NULL) = 0
      AND COUNT(DISTINCT TO_JSON_STRING(STRUCT(source_updated_at, source_version_ordinal))) = COUNT(*))
    OR (COUNTIF(source_updated_at IS NOT NULL) = 0
      AND COUNTIF(source_version_ordinal IS NULL) = 0
      AND COUNT(DISTINCT source_version_ordinal) = COUNT(*))
),
latest_boundaries AS (
  SELECT b.* FROM boundary_versions b
  JOIN orderable USING (boundary_id)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY b.boundary_id
    ORDER BY b.source_updated_at DESC NULLS LAST, b.source_version_ordinal DESC NULLS LAST
  ) = 1
)
SELECT b.boundary_id, b.version_id, b.scheme, b.code, b.name,
       b.vintage, b.geometry_geojson,
       SAFE.ST_GEOGFROMGEOJSON(b.geometry_geojson) AS geometry,
       b.valid_from, b.valid_to, b.source_record_id,
       b.source_id, b.batch_id, b.fetched_at,
       'latest_published_record_v1' AS rights_evidence
FROM latest_boundaries AS b
WHERE b.rights_status IN ('verified_open', 'restricted')
  AND b.record_status IN ('active', 'corrected')
  AND b.latest_record_is_public;

-- Explicit missing/suppressed rows survive with NULL values. An indicator
-- whose exact boundary ID is unavailable remains visible with missing mapping
-- status instead of being silently attached to another vintage.
CREATE OR REPLACE VIEW `melens_query.v_area_indicators` AS
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
eligible AS (
  SELECT i.*
  FROM `melens_ingest.area_indicators` AS i
  JOIN batches AS b USING (batch_id, source_id)
  JOIN sources AS s USING (source_id)
  WHERE b.state = 'published' AND b.published_at IS NOT NULL
    AND s.license_status IN ('verified_open', 'restricted')
    AND s.access_status = 'active'
    AND EXISTS (
      SELECT 1
      FROM `melens_ingest.source_records` AS sr
      WHERE sr.batch_id = i.batch_id
        AND sr.source_id = i.source_id
        AND sr.source_record_id = i.source_record_id
        AND sr.rights_status IN ('verified_open', 'restricted')
    )
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY i.indicator_id, i.boundary_id, i.period_start, i.period_end
    ORDER BY i.source_updated_at DESC NULLS LAST,
             i.source_version_ordinal DESC NULLS LAST,
             i.version_id DESC
  ) = 1
)
SELECT i.indicator_id, i.version_id, i.boundary_id,
       b.scheme AS boundary_scheme, b.code AS boundary_code,
       b.name AS boundary_name, b.vintage AS boundary_vintage,
       b.geometry AS boundary_geometry,
       IF(b.boundary_id IS NULL, 'missing', 'matched') AS boundary_mapping_status,
       i.period_start, i.period_end,
       IF(i.status = 'observed', i.value, NULL) AS value,
       i.unit, i.status, i.assertion_kind,
       i.assertion_kind = 'prediction' AS is_prediction,
       i.definition, i.source_area_name, i.source_area_code,
       i.source_area_vintage, i.source_record_id, i.source_id,
       i.batch_id, i.fetched_at
FROM eligible AS i
LEFT JOIN `melens_query.v_boundaries` AS b
  ON i.boundary_id = b.boundary_id;
