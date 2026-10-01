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
  AND current_source.access_status = 'active'
  AND (g.source_id != 'ticketmaster.events' OR
    (g.fetched_at <= CURRENT_TIMESTAMP()
     AND g.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)))
  AND (g.source_id != 'gdelt.news' OR
    g.fetched_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY));

-- Filter lifecycle only after selecting the latest visible version. This
-- prevents a cancelled/resolved/withdrawn event from reverting to an older
-- active state. A future planned event may remain visible with status planned.
CREATE OR REPLACE VIEW `melens_query.v_geo_records_current` AS
WITH batch_states AS (
  SELECT batch_id, source_id, source_revision, state, published_at, started_at
  FROM `melens_ingest.sync_batches`
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC
  ) = 1
),
development_snapshots AS (
  SELECT batch_id, SAFE_CAST(source_revision AS TIMESTAMP) AS snapshot_at
  FROM batch_states
  WHERE source_id = 'melbourne.development_monitor'
    AND state = 'published' AND published_at IS NOT NULL
    AND SAFE_CAST(source_revision AS TIMESTAMP) IS NOT NULL
),
current_development_snapshot AS (
  SELECT batch_id
  FROM development_snapshots
  WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM development_snapshots)
),
gtfs_mode_snapshots AS (
  -- The parent source fact exists even when a successful mode feed is empty.
  -- Use provider time per mode; a failed refresh or late backfill cannot advance it.
  SELECT DISTINCT r.batch_id, r.source_record_id, r.version_id, r.source_updated_at,
    REGEXP_EXTRACT(r.source_record_id,
      r'^victoria\.transport\.gtfs_realtime:feed:(metro_train|yarra_tram):') AS mode
  FROM `melens_ingest.source_records` r
  JOIN batch_states b ON r.batch_id = b.batch_id AND r.source_id = b.source_id
  WHERE r.source_id = 'victoria.transport.gtfs_realtime'
    AND b.state = 'published' AND b.published_at IS NOT NULL
    AND r.source_updated_at IS NOT NULL
),
current_gtfs_mode_snapshots AS (
  SELECT * FROM gtfs_mode_snapshots
  WHERE mode IS NOT NULL
  QUALIFY source_updated_at = MAX(source_updated_at) OVER (PARTITION BY mode)
),
current_gtfs_members AS (
  SELECT DISTINCT l.geo_record_id, l.version_id
  FROM `melens_ingest.geo_record_sources` l
  JOIN current_gtfs_mode_snapshots snapshot ON l.batch_id = snapshot.batch_id
    AND l.source_record_id = snapshot.source_record_id
    AND l.source_version_id = snapshot.version_id
  WHERE l.source_id = 'victoria.transport.gtfs_realtime'
    AND l.evidence_role = 'parent_feed_snapshot'
),
road_snapshots AS (
  -- A complete road response proves membership at fetch time. Its timestamp
  -- does not stand in for an incident time or an undocumented provider clock.
  SELECT DISTINCT r.batch_id, r.source_id, r.source_record_id, r.version_id,
    r.fetched_at AS snapshot_at
  FROM `melens_ingest.source_records` r
  JOIN batch_states b ON r.batch_id = b.batch_id AND r.source_id = b.source_id
  WHERE r.source_id IN ('victoria.transport.road_unplanned', 'victoria.transport.road_planned')
    AND b.state = 'published' AND b.published_at IS NOT NULL
    AND STARTS_WITH(r.source_record_id, CONCAT(r.source_id, ':snapshot:'))
    AND SAFE_CAST(SUBSTR(r.source_record_id, LENGTH(r.source_id) + 11) AS TIMESTAMP) = r.fetched_at
),
latest_road_snapshots AS (
  SELECT * FROM road_snapshots
  QUALIFY snapshot_at = MAX(snapshot_at) OVER (PARTITION BY source_id)
),
unambiguous_road_snapshots AS (
  -- Repeated identical proofs are harmless. Two different snapshots claiming
  -- the same observation time cannot be arbitrarily ordered by a content hash.
  SELECT * FROM latest_road_snapshots
  QUALIFY COUNT(DISTINCT CONCAT(source_record_id, '\x1f', version_id))
    OVER (PARTITION BY source_id) = 1
),
current_road_members AS (
  SELECT DISTINCT l.source_id, l.geo_record_id, l.version_id
  FROM `melens_ingest.geo_record_sources` l
  JOIN unambiguous_road_snapshots snapshot
    ON l.batch_id = snapshot.batch_id AND l.source_id = snapshot.source_id
    AND l.source_record_id = snapshot.source_record_id
    AND l.source_version_id = snapshot.version_id
  WHERE l.evidence_role = 'road_snapshot_membership'
),
current_ticketmaster_snapshot AS (
  SELECT batch_id FROM batch_states
  WHERE source_id = 'ticketmaster.events' AND state = 'published' AND published_at IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (ORDER BY started_at DESC, published_at DESC, batch_id DESC) = 1
),
current_parking_sensor_snapshot AS (
  SELECT batch_id FROM batch_states
  WHERE source_id = 'melbourne.parking.sensors' AND state = 'published' AND published_at IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (ORDER BY started_at DESC, published_at DESC, batch_id DESC) = 1
),
current_parking_sensor_members AS (
  SELECT DISTINCT m.business_source_record_id, m.business_version_id
  FROM `melens_ingest.parking_sensor_memberships` m
  JOIN current_parking_sensor_snapshot b USING (batch_id)
  WHERE m.source_id = 'melbourne.parking.sensors'
)
SELECT g.*
FROM `melens_query.v_geo_records_history` AS g
-- Development is a complete, versioned snapshot. A project removed from its
-- latest published snapshot remains in history but is no longer current.
-- Snapshot disappearance does not assert that the project was cancelled.
WHERE (g.source_id != 'melbourne.development_monitor'
   OR EXISTS (
     SELECT 1 FROM `melens_ingest.geo_records` AS member
     JOIN current_development_snapshot AS snapshot USING (batch_id)
     WHERE member.source_id = g.source_id
       AND member.geo_record_id = g.geo_record_id
   ))
  -- FULL_DATASET disappearance removes current membership, preserving history.
  -- A NO_SERVICE effect or an omitted alert does not invent a cancellation.
  AND (g.source_id != 'victoria.transport.gtfs_realtime'
    OR EXISTS (SELECT 1 FROM current_gtfs_members member
      WHERE member.geo_record_id = g.geo_record_id AND member.version_id = g.version_id))
  -- A disappeared road impact leaves current results without asserting that
  -- the provider resolved it. Failed/unpublished snapshots preserve the last
  -- complete published membership; an empty complete snapshot removes it all.
  AND (g.source_id NOT IN ('victoria.transport.road_unplanned', 'victoria.transport.road_planned')
    OR EXISTS (SELECT 1 FROM current_road_members member
      WHERE member.source_id = g.source_id AND member.geo_record_id = g.geo_record_id
        AND member.version_id = g.version_id))
  AND (g.source_id != 'ticketmaster.events' OR EXISTS (
    SELECT 1 FROM `melens_ingest.geo_records` member
    JOIN current_ticketmaster_snapshot snapshot USING (batch_id)
    WHERE member.source_id = g.source_id AND member.geo_record_id = g.geo_record_id
      AND member.version_id = g.version_id))
  AND (g.source_id != 'melbourne.parking.sensors' OR EXISTS (
    SELECT 1 FROM current_parking_sensor_members member
    WHERE member.business_source_record_id = g.geo_record_id
      AND member.business_version_id = g.version_id))
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY geo_record_id
  ORDER BY source_updated_at DESC NULLS LAST,
           source_version_ordinal DESC NULLS LAST,
           version_id DESC
) = 1
AND record_status NOT IN ('cancelled', 'resolved', 'withdrawn');
