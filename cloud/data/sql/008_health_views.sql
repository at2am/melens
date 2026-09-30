-- No credentials, admission evidence JSON, raw object URIs, or rejected record
-- bodies are exposed here. The query identity must be granted approved views
-- only; the IAM grant is performed by infrastructure, not this SQL file.
CREATE OR REPLACE VIEW `melens_query.v_source_health` AS
WITH sources AS (
  SELECT source_id, provider, dataset_title, topic, scope,
         cadence_seconds, check_interval_seconds,
         license_status, access_status, last_checked_at,
         last_success_at, last_source_update_at
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
),
batch_states AS (
  SELECT batch_id, source_id, state, started_at,
         state_updated_at, published_at, error_code,
         window_from, window_to, output_count
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
latest_check AS (
  SELECT * FROM batch_states
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY started_at DESC, state_updated_at DESC
  ) = 1
),
latest_published AS (
  SELECT * FROM batch_states
  WHERE state = 'published' AND published_at IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY published_at DESC, started_at DESC
  ) = 1
),
joined AS (
  SELECT s.*,
         2 * COALESCE(s.cadence_seconds, s.check_interval_seconds)
           AS budget_seconds,
         c.batch_id AS latest_batch_id,
         c.state AS latest_batch_state,
         c.error_code AS latest_error_code,
         p.batch_id AS latest_published_batch_id,
         p.published_at AS latest_published_at,
         p.window_from AS latest_published_window_from,
         p.window_to AS latest_published_window_to,
         p.output_count AS latest_published_output_count
  FROM sources AS s
  LEFT JOIN latest_check AS c USING (source_id)
  LEFT JOIN latest_published AS p USING (source_id)
)
SELECT joined.*,
       CASE
         WHEN license_status = 'review_required' OR access_status != 'active'
           THEN 'unknown'
         WHEN last_checked_at IS NULL OR last_success_at IS NULL
           THEN 'unknown'
         WHEN latest_batch_state = 'failed' AND budget_seconds IS NOT NULL
           AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_success_at, SECOND)
               > budget_seconds THEN 'source_unavailable'
         WHEN latest_batch_state = 'failed' THEN 'unknown'
         WHEN budget_seconds IS NULL THEN 'healthy_versioned'
         WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_success_at, SECOND)
              <= budget_seconds THEN 'current'
         WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_success_at, SECOND)
              <= 2 * budget_seconds THEN 'late'
         ELSE 'stale'
       END AS health_state,
       IF(last_source_update_at IS NULL, NULL,
          TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_source_update_at, SECOND))
         AS upstream_update_age_seconds,
       IF(last_success_at IS NULL, NULL,
          TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), last_success_at, SECOND))
         AS successful_check_age_seconds
FROM joined;

-- Coverage is evidence about a source, not a query-specific conclusion. A
-- caller must intersect the requested area/time with the declared references
-- and successful published window. Only then may zero matching facts become
-- no_matching_records; a failed covering source yields source_unavailable or
-- unknown, and no intersecting source yields not_covered.
CREATE OR REPLACE VIEW `melens_query.v_source_coverage` AS
WITH sources AS (
  SELECT source_id, topic, scope, coverage_area_refs,
         coverage_from, coverage_to, license_status, access_status
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
)
SELECT s.source_id, s.topic, s.scope, s.coverage_area_refs,
       s.coverage_from, s.coverage_to,
       s.license_status, s.access_status,
       h.health_state, h.latest_published_batch_id,
       h.latest_published_at, h.latest_published_window_from,
       h.latest_published_window_to,
       h.latest_published_output_count,
       CASE
         WHEN s.license_status = 'review_required'
           OR s.access_status != 'active' THEN 'unknown'
         WHEN ARRAY_LENGTH(s.coverage_area_refs) = 0
           OR s.coverage_area_refs IS NULL THEN 'unknown'
         WHEN s.coverage_from IS NULL THEN 'unknown'
         ELSE 'verified'
       END AS coverage_evidence_state
FROM sources AS s
JOIN `melens_query.v_source_health` AS h USING (source_id);

CREATE OR REPLACE VIEW `melens_query.v_source_abnormal_delay` AS
SELECT source_id, topic, health_state, latest_batch_id,
       latest_batch_state, latest_error_code, last_checked_at,
       last_success_at, last_source_update_at, budget_seconds,
       successful_check_age_seconds, upstream_update_age_seconds
FROM `melens_query.v_source_health`
WHERE health_state IN ('late', 'stale', 'source_unavailable', 'unknown');
