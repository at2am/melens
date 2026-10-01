-- Each query is read-only; run in project melens-510012 with maximumBytesBilled=500000000.

-- parking_bays
SELECT COUNT(*) AS bay_count, COUNTIF(geometry IS NOT NULL) AS located_bays, COUNTIF(may_park_now='yes') AS legal_yes FROM `melens-510012.melens_query.v_parking_current`;

-- parking_sensors
SELECT COUNT(*) AS sensor_count, COUNTIF(geometry IS NOT NULL) AS located_sensors, COUNTIF(occupied IS FALSE) AS reported_vacant, COUNTIF(source_freshness='current') AS fresh_sensors, COUNTIF(may_park_now='yes') AS legal_yes FROM `melens-510012.melens_query.v_parking_sensor_current`;

-- parking_rules
SELECT COUNT(*) AS rule_count, COUNTIF(rule_status='unverified_current_applicability') AS unverified_current_rules FROM `melens-510012.melens_query.v_parking_rule_reference`;

-- general_news
-- Logical keys include URL-based candidate keys; this total does not certify publication metadata or local occurrence.
SELECT COUNT(*) AS reports, COUNT(DISTINCT logical_event_key) AS distinct_logical_event_keys,
  COUNT(DISTINCT DATE(published_at)) AS available_publication_dates,
  COUNTIF(JSON_VALUE(geometry_geojson, '$.type') = 'Point') AS exact_points
FROM `melens-510012.melens_query.v_news_current`
WHERE source_id = 'gdelt.news' AND topic = 'news';

-- general_news_publication_catalogue
-- Only the ten exact finite catalogue entries can contribute to this coverage gate.
-- Unknown candidate keys and GKG processing timestamps cannot count as verified publisher evidence.
WITH catalogue AS (
  SELECT * FROM UNNEST([
    STRUCT('greens-waters-resignation-20260928' AS logical_event_key, '20260928124500-926' AS gkg_record_id, TIMESTAMP('2026-09-28T10:20:40.265Z') AS expected_published_at),
    STRUCT('royal-show-poultry-cancellation-20260929', '20260929103000-530', TIMESTAMP('2026-09-29T09:40:00Z')),
    STRUCT('footscray-hospital-capacity-report-20260929', '20260929103000-41', TIMESTAMP('2026-09-29T09:39:39Z')),
    STRUCT('mushroom-hq-property-listing-20260929', '20260929103000-209', TIMESTAMP('2026-09-29T07:31:08Z')),
    STRUCT('victoria-homelessness-outreach-report-20260929', '20260929103000-384', TIMESTAMP('2026-09-29T09:54:48Z')),
    STRUCT('orica-productivity-regulation-statement-20260929', '20260929103000-871', TIMESTAMP('2026-09-29T04:19:32Z')),
    STRUCT('malthouse-2027-program-announcement-20261001', '20261001103000-851', TIMESTAMP('2026-10-01T09:30:00Z')),
    STRUCT('medical-recording-identity-law-report-20261001', '20261001103000-411', TIMESTAMP('2026-10-01T09:30:00Z')),
    STRUCT('brandon-smith-contract-future-report-20261001', '20261001103000-173', TIMESTAMP('2026-10-01T05:19:07Z')),
    STRUCT('land-forces-police-exclusion-powers-20261001', '20261001103000-92', TIMESTAMP('2026-10-01T09:38:10Z'))
  ])
), matched AS (
  SELECT c.logical_event_key AS catalogue_key, n.*,
    JSON_VALUE(n.summary, '$.source_publication_evidence.method') AS evidence_method,
    CASE
      WHEN n.geo_record_id IS NULL THEN 'missing_catalogue_report'
      WHEN n.publication_time_status = 'source_provided'
        AND n.published_at = c.expected_published_at
        AND SAFE_CAST(JSON_VALUE(n.summary, '$.source_publication_evidence.source_timestamp') AS TIMESTAMP) = c.expected_published_at
        AND JSON_VALUE(n.summary, '$.source_publication_evidence.gkg_record_id') = c.gkg_record_id
        AND JSON_VALUE(n.summary, '$.source_publication_evidence.method') = 'bounded_publisher_head_metadata_review'
        AND JSON_VALUE(n.summary, '$.source_publication_evidence.precision') = 'timestamp_with_offset'
        AND JSON_VALUE(n.summary, '$.source_publication_evidence.field') IN ('article:published_time', 'publish_date', 'datePublished')
        AND JSON_VALUE(n.summary, '$.source_publication_evidence.url') = n.original_url
        THEN 'matched_catalogue_publication_metadata'
      ELSE 'catalogue_metadata_mismatch'
    END AS publication_evidence_status
  FROM catalogue c
  LEFT JOIN `melens-510012.melens_query.v_news_current` n
    ON n.logical_event_key = c.logical_event_key AND n.source_id = 'gdelt.news' AND n.topic = 'news'
)
SELECT publication_evidence_status, publication_time_status, evidence_method,
  COUNT(DISTINCT catalogue_key) AS catalogue_entries,
  COUNT(DISTINCT IF(publication_evidence_status = 'matched_catalogue_publication_metadata', catalogue_key, NULL)) AS distinct_verified_catalogue_events,
  COUNT(DISTINCT IF(publication_evidence_status = 'matched_catalogue_publication_metadata', DATE(published_at), NULL)) AS verified_publisher_dates,
  COUNT(DISTINCT IF(publication_evidence_status = 'matched_catalogue_publication_metadata' AND ARRAY_LENGTH(area_refs) > 0, catalogue_key, NULL)) AS verified_reports_with_official_area_refs,
  COUNTIF(publication_evidence_status = 'matched_catalogue_publication_metadata' AND JSON_VALUE(geometry_geojson, '$.type') = 'Point') AS verified_exact_points
FROM matched
GROUP BY publication_evidence_status, publication_time_status, evidence_method
ORDER BY publication_evidence_status;

-- crime_news
-- Theme candidates remain unverified and cannot contribute to the crime coverage gate below.
SELECT COALESCE(JSON_VALUE(summary, '$.crime_news_evidence.status'), 'unclassified') AS evidence_status,
  COUNT(*) AS reports, COUNT(DISTINCT DATE(published_at)) AS available_publication_dates,
  COUNTIF(JSON_VALUE(geometry_geojson, '$.type') = 'Point') AS exact_points
FROM `melens-510012.melens_query.v_crime_news_current`
WHERE source_id = 'gdelt.news'
GROUP BY evidence_status ORDER BY evidence_status;

-- crime_news_verified_sample_coverage
SELECT COUNT(DISTINCT original_url) AS verified_sample_reports,
  COUNT(DISTINCT DATE(published_at)) AS verified_publisher_dates,
  COUNTIF(ARRAY_LENGTH(area_refs) > 0) AS verified_reports_with_official_area_refs,
  COUNTIF(JSON_VALUE(geometry_geojson, '$.type') = 'Point') AS verified_exact_points
FROM `melens-510012.melens_query.v_crime_news_current`
WHERE source_id = 'gdelt.news'
  AND JSON_VALUE(summary, '$.crime_news_evidence.status') = 'verified_sample_metadata'
  AND JSON_VALUE(summary, '$.crime_news_evidence.policy') = 'crime-publication-evidence-v1'
  AND JSON_VALUE(summary, '$.crime_news_evidence.time_evidence_kind') = 'matching_html_head_meta_and_jsonld_datePublished'
  AND published_at = SAFE_CAST(JSON_VALUE(summary, '$.crime_news_evidence.published_at') AS TIMESTAMP)
  AND JSON_VALUE(summary, '$.crime_news_evidence.original_url') = original_url
  AND original_url IN (
    'https://www.abc.net.au/news/2026-09-07/melbourne-thomastown-fatal-shooting/107122646',
    'https://www.abc.net.au/news/2026-09-08/keilor-cafe-shooting-gavin-preston-sentencing/107127386',
    'https://www.abc.net.au/news/2026-09-11/victoria-melton-arson-attack-ballarat-omcg-bandidos/107143230',
    'https://www.abc.net.au/news/2026-09-23/counter-terrorism-police-arrest-melbourne-man-alleged-isis-link/107185494',
    'https://www.abc.net.au/news/2026-09-28/deer-park-machete-murder-trial-victorian-supreme-court/107205524',
    'https://www.abc.net.au/news/2026-10-01/ex-cfmeu-delegate-joel-leavitt-blackmail-charge-dropped/107217902'
  );

-- crime_statistics
SELECT COUNT(*) AS indicators, COUNT(DISTINCT source_area_name) AS areas, COUNT(DISTINCT period_end) AS periods FROM `melens-510012.melens_query.v_crime_area_statistics`;

-- events
SELECT COUNT(*) AS current_events, COUNTIF(valid_from>CURRENT_TIMESTAMP() AND valid_from<TIMESTAMP_ADD(CURRENT_TIMESTAMP(),INTERVAL 30 DAY)) AS future_dated_events, COUNTIF(geometry IS NOT NULL) AS located_events, COUNTIF(original_url IS NOT NULL) AS linked_events FROM `melens-510012.melens_query.v_events_current` WHERE source_id='ticketmaster.events';

-- sources
SELECT source_id, access_status, license_status, last_success_at FROM `melens-510012.melens_query.v_source_health` ORDER BY source_id;
