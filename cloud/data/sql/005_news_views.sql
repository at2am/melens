-- Article metadata only. The core views have already enforced published
-- batches, source admission and per-record public rights; no scraped body is
-- projected here. A mentioned location is not promoted to an event site.
CREATE OR REPLACE VIEW `melens_query.v_news_current` AS
SELECT geo_record_id, version_id, source_id, batch_id, topic,
       title, summary, original_url, geometry, geometry_geojson,
       location_role, location_confidence, area_refs,
       published_at, observed_at, fetched_at, batch_published_at,
       source_updated_at, source_version_ordinal,
       freshness_state, record_status, assertion_kind, is_prediction,
       JSON_VALUE(summary, '$.news_scope') AS news_scope,
       JSON_VALUE(summary, '$.logical_event_key') AS logical_event_key,
       IF(source_id = 'gdelt.news', source_updated_at, NULL) AS gdelt_processed_at,
       IF(published_at IS NULL, 'not_provided', 'source_provided') AS publication_time_status
FROM `melens_query.v_geo_records_current`
WHERE topic IN ('news', 'crime_news')
  AND assertion_kind = 'report';

CREATE OR REPLACE VIEW `melens_query.v_news_history` AS
SELECT geo_record_id, version_id, source_id, batch_id, topic,
       title, summary, original_url, geometry, geometry_geojson,
       location_role, location_confidence, area_refs,
       published_at, observed_at, fetched_at, batch_published_at,
       source_updated_at, source_version_ordinal,
       freshness_state, record_status, rights_status,
       assertion_kind, is_prediction,
       JSON_VALUE(summary, '$.news_scope') AS news_scope,
       JSON_VALUE(summary, '$.logical_event_key') AS logical_event_key,
       IF(source_id = 'gdelt.news', source_updated_at, NULL) AS gdelt_processed_at,
       IF(published_at IS NULL, 'not_provided', 'source_provided') AS publication_time_status
FROM `melens_query.v_geo_records_history`
WHERE topic IN ('news', 'crime_news')
  AND assertion_kind = 'report';

CREATE OR REPLACE VIEW `melens_query.v_crime_news_current` AS
SELECT *
FROM `melens_query.v_news_current`
WHERE topic = 'crime_news';

-- Melbourne-related reports may mention the area without describing a local
-- event. location_role and location_confidence remain visible to callers.
CREATE OR REPLACE VIEW `melens_query.v_melbourne_news_current` AS
SELECT *
FROM `melens_query.v_news_current`
WHERE news_scope IN ('city', 'greater_melbourne');

-- Multiple reports may support one logical news event. Evidence links are
-- returned separately so grouping never discards a published source URL.
CREATE OR REPLACE VIEW `melens_query.v_news_sources` AS
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
SELECT e.geo_record_id, e.version_id, e.source_record_id,
       e.source_version_id, e.evidence_role, e.original_url,
       e.source_id, e.fetched_at
FROM `melens_ingest.geo_record_sources` AS e
JOIN batches AS b USING (batch_id, source_id)
JOIN sources AS s USING (source_id)
JOIN `melens_ingest.source_records` AS sr
 ON sr.source_record_id = e.source_record_id
 AND sr.version_id = e.source_version_id
 AND sr.source_id = e.source_id
 AND sr.batch_id = e.batch_id
JOIN batches AS source_batch
  ON sr.batch_id = source_batch.batch_id
 AND sr.source_id = source_batch.source_id
JOIN `melens_query.v_news_history` AS n
  ON n.geo_record_id = e.geo_record_id
 AND n.version_id = e.version_id
 AND n.batch_id = e.batch_id
WHERE b.state = 'published' AND b.published_at IS NOT NULL
  AND source_batch.state = 'published'
  AND source_batch.published_at IS NOT NULL
  AND s.license_status IN ('verified_open', 'restricted')
  AND s.access_status = 'active'
  AND sr.rights_status IN ('verified_open', 'restricted')
  AND (e.source_id != 'ticketmaster.events' OR (
    sr.fetched_at <= CURRENT_TIMESTAMP() AND e.fetched_at <= CURRENT_TIMESTAMP()
    AND sr.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    AND e.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)))
  AND (e.source_id != 'gdelt.news' OR (
    sr.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
    AND e.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)))
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY e.geo_record_id, e.version_id,
               e.source_record_id, e.source_version_id
  ORDER BY e.fetched_at DESC, e.batch_id DESC
) = 1;

-- CSA statistics are period-and-area aggregates, never individual crime
-- reports or a real-time crime rate. This view remains independent of 006.
CREATE OR REPLACE VIEW `melens_query.v_crime_area_statistics` AS
WITH batches AS (
  SELECT batch_id, source_id, state, published_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
source AS (
  SELECT source_id, license_status, access_status
  FROM `melens_ingest.data_sources`
  WHERE source_id = 'victoria.csa.recorded_offences'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id ORDER BY updated_at DESC
  ) = 1
)
SELECT i.indicator_id, i.version_id, i.boundary_id,
       i.source_area_name, i.source_area_code, i.source_area_vintage,
       i.period_start, i.period_end,
       IF(i.status = 'observed', i.value, NULL) AS value,
       i.unit, i.status, i.definition, i.assertion_kind,
       i.assertion_kind = 'prediction' AS is_prediction,
       i.source_record_id, i.source_id, i.batch_id, i.fetched_at,
       i.source_updated_at, i.source_version_ordinal
FROM `melens_ingest.area_indicators` AS i
JOIN batches AS b USING (batch_id, source_id)
JOIN source AS s USING (source_id)
WHERE b.state = 'published' AND b.published_at IS NOT NULL
  AND s.license_status IN ('verified_open', 'restricted')
  AND s.access_status = 'active'
  AND i.assertion_kind = 'observation'
  AND EXISTS (
    SELECT 1 FROM `melens_ingest.source_records` AS sr
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
) = 1;
