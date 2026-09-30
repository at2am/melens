-- Run after 001_tables.sql. These views belong to melens_query, while all
-- writable tables remain in melens_ingest. Authorize the approved views on the
-- ingest dataset, then grant the query identity access only to melens_query and
-- permission to run query jobs. SQL alone does not grant that authorization.

-- History retains each published logical version, including corrections,
-- cancellation, resolution and withdrawal. Duplicate physical writes of the
-- same version collapse. Permission is checked twice: against each historical
-- version and against the latest version, so a later rights withdrawal cannot
-- resurrect content from an older version. Source admission is also checked
-- live, allowing a source-level revocation to stop every public query.
CREATE OR REPLACE VIEW `melens_query.v_geo_records_history` AS
WITH latest_batches AS (
  SELECT batch_id, source_id, state, published_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id
    ORDER BY state_updated_at DESC, started_at DESC, batch_id DESC
  ) = 1
),
published_batches AS (
  SELECT batch_id, source_id, published_at
  FROM latest_batches
  WHERE state = 'published' AND published_at IS NOT NULL
),
latest_sources AS (
  SELECT source_id, license_status, access_status
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id
    ORDER BY updated_at DESC, source_id DESC
  ) = 1
),
published_geo AS (
  SELECT g.*, b.published_at AS batch_published_at
  FROM `melens_ingest.geo_records` AS g
  JOIN published_batches AS b
    ON g.batch_id = b.batch_id AND g.source_id = b.source_id
),
deduplicated AS (
  SELECT *
  FROM published_geo
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY geo_record_id, version_id
    ORDER BY batch_published_at DESC, fetched_at DESC, batch_id DESC
  ) = 1
),
latest_record_access AS (
  SELECT geo_record_id, source_id, rights_status, public_query_allowed
  FROM deduplicated
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY geo_record_id
    ORDER BY source_updated_at DESC NULLS LAST,
             source_version_ordinal DESC NULLS LAST,
             version_id DESC
  ) = 1
)
SELECT
  g.geo_record_id,
  g.version_id,
  g.batch_id,
  g.source_id,
  g.schema_version,
  g.topic,
  g.assertion_kind,
  g.assertion_kind = 'prediction' AS is_prediction,
  g.title,
  g.summary,
  g.original_url,
  g.geometry_geojson,
  SAFE.ST_GEOGFROMGEOJSON(g.geometry_geojson) AS geometry,
  g.centroid_lat,
  g.centroid_lon,
  g.location_role,
  g.location_confidence,
  g.area_refs,
  g.observed_at,
  g.published_at,
  g.valid_from,
  g.valid_to,
  g.fetched_at,
  g.batch_published_at,
  g.source_updated_at,
  g.source_version_ordinal,
  g.freshness_state,
  g.record_status,
  g.rights_status
FROM deduplicated AS g
JOIN latest_record_access AS a USING (geo_record_id)
JOIN latest_sources AS s ON g.source_id = s.source_id
JOIN latest_sources AS current_source ON a.source_id = current_source.source_id
WHERE g.public_query_allowed = TRUE
  AND g.rights_status IN ('verified_open', 'restricted')
  AND a.public_query_allowed = TRUE
  AND a.rights_status IN ('verified_open', 'restricted')
  AND s.license_status IN ('verified_open', 'restricted')
  AND s.access_status = 'active'
  AND current_source.license_status IN ('verified_open', 'restricted')
  AND current_source.access_status = 'active';

-- Filter lifecycle only after selecting the latest visible version. This
-- prevents a cancelled/resolved/withdrawn event from reverting to an older
-- active state. A future planned event may remain visible with status planned.
CREATE OR REPLACE VIEW `melens_query.v_geo_records_current` AS
SELECT *
FROM `melens_query.v_geo_records_history`
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY geo_record_id
  ORDER BY source_updated_at DESC NULLS LAST,
           source_version_ordinal DESC NULLS LAST,
           version_id DESC
) = 1
AND record_status NOT IN ('cancelled', 'resolved', 'withdrawn');
