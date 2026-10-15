-- Map-serving views over the refreshed current copy (geo_records_current). They read a few MB
-- instead of rebuilding "current" from the whole history on every map request.

-- The current geo records of the map's sources, as v_geo_records_current returns them. The copy is
-- refreshed per publication, so the limits that depend on the read time are applied again here,
-- exactly as v_geo_records_history applies them, and so are the source's current rights.
CREATE OR REPLACE VIEW `melens_query.v_geo_records_current_served` AS
WITH latest_sources AS (
  SELECT source_id, license_status, access_status
  FROM `melens_ingest.data_sources`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_id
    ORDER BY updated_at DESC, source_id DESC
  ) = 1
)
SELECT g.*
FROM `melens_ingest.geo_records_current` AS g
JOIN latest_sources AS s USING (source_id)
WHERE s.license_status IN ('verified_open', 'restricted')
  AND s.access_status = 'active'
  AND (g.source_id != 'ticketmaster.events' OR
    (g.fetched_at <= CURRENT_TIMESTAMP()
     AND g.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)))
  AND (g.source_id != 'gdelt.news' OR
    g.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY));

-- Which published batch the served copy reflects per source. The map caches a layer only while
-- this matches the source registry's latest published batch.
CREATE OR REPLACE VIEW `melens_query.v_geo_records_current_state` AS
SELECT source_id, batch_id, published_at, refreshed_at
FROM `melens_ingest.geo_records_current_state`
QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY refreshed_at DESC) = 1;
