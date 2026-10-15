-- Anomaly results of published batches only, from sources that are active and
-- openly licensed. The producer in the map and agent services validates linkage
-- and publication; this view detects and recalculates nothing. Per result the
-- latest row wins. A replay row says so (is_replay, replay_label) and is never
-- presented as live.
CREATE OR REPLACE VIEW `melens_query.v_anomaly_current` AS
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
)
SELECT r.result_id, r.source_id, r.batch_id, r.sensor_id, r.sensor_name,
       r.lat, r.lon, r.window_from, r.window_to, r.observation_id,
       r.baseline_definition_id, r.baseline_value, r.observed_value, r.delta,
       r.direction, r.classification, r.is_replay, r.replay_label,
       r.location_evidence, b.published_at
FROM `melens_ingest.anomaly_results` AS r
JOIN batches AS b USING (batch_id, source_id)
JOIN sources AS s USING (source_id)
WHERE b.state = 'published' AND b.published_at IS NOT NULL
  AND s.license_status IN ('verified_open', 'restricted')
  AND s.access_status = 'active'
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY r.source_id, r.result_id
  ORDER BY r.fetched_at DESC, r.batch_id DESC
) = 1;
