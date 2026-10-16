-- Shared time classification. The historical timeline can display resolved or
-- cancelled states without claiming that an old event is active now.
CREATE OR REPLACE VIEW `melens_query.v_change_timeline` AS
SELECT geo_record_id, version_id, source_id, batch_id, topic,
       title, summary, original_url, geometry, geometry_geojson,
       location_role, location_confidence, area_refs,
       observed_at, published_at, valid_from, valid_to, fetched_at,
       freshness_state, record_status, assertion_kind, is_prediction,
       CASE
         WHEN record_status IN ('cancelled', 'resolved', 'withdrawn')
           THEN record_status
         WHEN valid_from > CURRENT_TIMESTAMP() THEN 'future'
         WHEN valid_to IS NOT NULL AND valid_to <= CURRENT_TIMESTAMP()
           THEN 'ended'
         WHEN valid_from IS NULL AND record_status = 'planned'
           THEN 'planned_unscheduled'
         ELSE 'current'
       END AS time_state
FROM `melens_query.v_geo_records_history`
WHERE topic IN ('event', 'road_disruption', 'planning');

CREATE OR REPLACE VIEW `melens_query.v_events_current` AS
SELECT geo_record_id, version_id, source_id, title, summary, original_url,
       geometry, geometry_geojson, location_role, location_confidence,
       area_refs, published_at, valid_from, valid_to, fetched_at,
       freshness_state, record_status, assertion_kind, is_prediction,
       CASE WHEN valid_from IS NULL THEN 'unscheduled'
            WHEN valid_from > CURRENT_TIMESTAMP() THEN 'future'
            ELSE 'current' END AS time_state
FROM `melens_query.v_geo_records_current`
WHERE topic = 'event'
  AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP());

-- VicEmergency appears only if its permission review and connector have made
-- the source active and published. The core view applies those gates. GTFS
-- alerts may be normalized to road_disruption under their own source ID.
CREATE OR REPLACE VIEW `melens_query.v_transport_changes_current` AS
SELECT geo_record_id, version_id, source_id, topic, title, summary,
       original_url, geometry, geometry_geojson, location_role,
       location_confidence, area_refs, observed_at, published_at,
       valid_from, valid_to, fetched_at, freshness_state,
       record_status,
       assertion_kind, is_prediction,
       IF(valid_from > CURRENT_TIMESTAMP(), 'future', 'current') AS time_state
FROM `melens_query.v_geo_records_current`
WHERE (topic = 'road_disruption'
       OR source_id = 'victoria.transport.gtfs_realtime'
       OR source_id = 'victoria.emergency.alerts')
  AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP());

-- Planned zoning and development records remain plans. Their proposed
-- effective dates are preserved independently of the publication time.
CREATE OR REPLACE VIEW `melens_query.v_planning_changes_current` AS
SELECT geo_record_id, version_id, source_id, title, summary,
       original_url, geometry, geometry_geojson, location_role,
       location_confidence, area_refs, published_at,
       valid_from, valid_to, fetched_at, freshness_state,
       record_status, assertion_kind, is_prediction,
       CASE
         WHEN valid_from > CURRENT_TIMESTAMP() THEN 'future'
         WHEN valid_to IS NOT NULL AND valid_to <= CURRENT_TIMESTAMP()
           THEN 'ended'
         WHEN valid_from IS NULL AND record_status = 'planned'
           THEN 'planned_unscheduled'
         ELSE 'current'
       END AS time_state
FROM `melens_query.v_geo_records_current`
WHERE topic = 'planning'
   OR source_id IN ('victoria.vicmap.planning',
                    'melbourne.development_monitor');
