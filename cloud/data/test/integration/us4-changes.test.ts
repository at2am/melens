import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { BigQuery, type JobMetadata } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import {
  normalizeTicketEvents,
  parseTicketPage,
} from '../../src/connectors/ticketmaster/index.js';
import {
  normalizePlannedRoadSnapshot,
  parsePlannedRoadPage,
} from '../../src/connectors/tv_road_planned/index.js';
import {
  normalizeRoadSnapshot,
  parseRoadPage,
} from '../../src/connectors/tv_road_unplanned/index.js';
import {
  normalizeGtfsSnapshot,
  parseGtfsSnapshot,
  SOURCE_ID as STATIC_SOURCE_ID,
  type GtfsStaticSnapshot,
  type NormalizedGtfsResult,
} from '../../src/connectors/tv_gtfs_static/index.js';
import {
  normalizeAlertFeeds,
  parseAlertFeed,
  SOURCE_ID as REALTIME_SOURCE_ID,
  type AlertSelector,
  type ParsedAlertFeed,
} from '../../src/connectors/tv_gtfs_realtime/index.js';
import {
  layers as vicmapLayers,
  normalizePlanningControl,
  type Layer as VicmapLayer,
} from '../../src/connectors/vicmap_planning/index.js';
import {
  normalizeDevelopmentRecord,
  normalizeDevelopmentStatus,
  type ComDevelopmentMonitorRawRecord,
} from '../../src/connectors/com_development_monitor/index.js';
import {
  compareFullGtfsSnapshots,
  joinGtfsAlertLocations,
  type StaticGtfsVersion,
} from '../../src/normalization/gtfs-alerts.js';
import {
  parseGeometryGeojson,
  validateGeoRecordGeography,
} from '../../src/validation/geography.js';
import {
  parseSourceRecord,
  sourceRecordId,
  sourceVersionId,
} from '../../src/validation/record.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { BigQueryPublisher } from '../../src/core/publisher.js';
import {
  GcsStore,
  addCompletedWindow,
  type CheckpointManifest,
  type StoredObject,
} from '../../src/core/gcs.js';
import type { DataConfig } from '../../src/core/config.js';
import type { ConnectorSuccess } from '../../src/core/connector.js';
import type {
  AssertionKind,
  DataSource,
  GeoRecord,
  GeoRecordSource,
  GeoRecordStatus,
  LocationConfidence,
  LocationRole,
  SourceRecord,
  SyncBatch,
  UtcTimestamp,
} from '../../src/core/types.js';

/**
 * ============================================================================
 * Task T068: User Story 4 — Events, Transport Disruptions & Planning Changes
 * ============================================================================
 *
 * Requirements & Completion Boundary:
 * 1. Comprehensive integration test suite according to User Story 4 (US4).
 * 2. Event rescheduling and cancellation handling:
 *    - Cancelled and rescheduled events reflect new status; cancelled events are
 *      excluded from current active views while retaining version history.
 * 3. Future roadworks / planned road disruptions (tv_road_planned):
 *    - Future disruptions have geoRecordStatus: 'planned', assertion_kind: 'plan'.
 *    - Valid time bounds (valid_from > now) properly recognized so they are not
 *      treated as current active congestion.
 * 4. GTFS Realtime Service Alerts with Static GTFS join (gtfs-alerts.ts):
 *    - Route/stop alerts matched against static feed version.
 *    - Missing static mapping or unknown stop preserves the alert entity
 *      without inventing coordinates.
 *    - Mixed route/stop selectors do not falsely locate the whole alert at a
 *      single point.
 * 5. Incident clearance & emergency events (VicEmergency policy adherence):
 *    - Cleared incidents transition to resolved status and are removed from
 *      current disruption views.
 *    - Broad emergency warning areas retain coarse area_only location without
 *      fabricating fake centroid coordinates.
 * 6. Planning controls (Vicmap Planning zones/overlays) vs active changes:
 *    - Long-term statutory planning controls stay distinct from transient
 *      roadworks or event road closures.
 * 7. Verification of BigQuery views (007_changes_views.sql & 002_core_views.sql):
 *    - v_change_timeline, v_events_current, v_transport_changes_current,
 *      v_planning_changes_current.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// Fixture Loaders
// ----------------------------------------------------------------------------

async function loadTicketmasterFixture() {
  const content = await readFile(new URL('../fixtures/ticketmaster.json', import.meta.url), 'utf8');
  return parseTicketPage(JSON.parse(content));
}

async function loadPlannedRoadFixture() {
  const content = await readFile(new URL('../fixtures/tv_road_planned.json', import.meta.url), 'utf8');
  const parsed = parsePlannedRoadPage(JSON.parse(content));
  if (parsed.kind !== 'numbered') throw new Error('Expected numbered planned road fixture');
  return parsed.body;
}

async function loadUnplannedRoadFixture() {
  const content = await readFile(new URL('../fixtures/tv_road_unplanned.json', import.meta.url), 'utf8');
  return parseRoadPage(JSON.parse(content));
}

async function loadGtfsStaticFixture(): Promise<{
  snapshot: GtfsStaticSnapshot;
  normalized: NormalizedGtfsResult;
}> {
  const content = await readFile(new URL('../fixtures/tv_gtfs_static.json', import.meta.url), 'utf8');
  const raw = JSON.parse(content);
  const snapshot = parseGtfsSnapshot(raw);
  const input = parseConnectorInput({
    sourceId: STATIC_SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'static-fixture-run',
  });
  const normalized = normalizeGtfsSnapshot(snapshot, input, '2026-09-28T00:06:00.000Z');
  return { snapshot, normalized };
}

async function loadGtfsRealtimeFixture(): Promise<{
  metro_feed_base64: string;
  tram_feed_base64: string;
  empty_feed_base64: string;
  differential_feed_base64: string;
  deleted_full_feed_base64: string;
}> {
  const content = await readFile(new URL('../fixtures/tv_gtfs_realtime.json', import.meta.url), 'utf8');
  return JSON.parse(content);
}

async function loadVicmapFixture(): Promise<{
  overlay: { collection: { features: unknown[] } };
  zone: { collection: { features: unknown[] } };
}> {
  const content = await readFile(new URL('../fixtures/vicmap_planning.json', import.meta.url), 'utf8');
  return JSON.parse(content);
}

async function loadDevelopmentMonitorFixture(): Promise<{
  total_count: number;
  results: ComDevelopmentMonitorRawRecord[];
}> {
  const content = await readFile(new URL('../fixtures/com_development_monitor.json', import.meta.url), 'utf8');
  return JSON.parse(content);
}

// ----------------------------------------------------------------------------
// BigQuery View Emulation Helpers
// Exactly mirrors 002_core_views.sql & 007_changes_views.sql
// ----------------------------------------------------------------------------

export interface ViewHistoryRow extends GeoRecord {
  is_prediction: boolean;
}

export interface ViewChangeTimelineRow {
  geo_record_id: string;
  version_id: string;
  source_id: string;
  batch_id: string;
  topic: string;
  title: string | null;
  summary: string | null;
  original_url: string | null;
  geometry_geojson: string | null;
  location_role: LocationRole;
  location_confidence: LocationConfidence;
  area_refs: readonly string[];
  observed_at: UtcTimestamp | null;
  published_at: UtcTimestamp | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  fetched_at: UtcTimestamp;
  freshness_state: string;
  record_status: GeoRecordStatus;
  assertion_kind: AssertionKind;
  is_prediction: boolean;
  time_state: 'cancelled' | 'resolved' | 'withdrawn' | 'future' | 'ended' | 'planned_unscheduled' | 'current';
}

export interface ViewEventsCurrentRow {
  geo_record_id: string;
  version_id: string;
  source_id: string;
  title: string | null;
  summary: string | null;
  original_url: string | null;
  geometry_geojson: string | null;
  location_role: LocationRole;
  location_confidence: LocationConfidence;
  area_refs: readonly string[];
  published_at: UtcTimestamp | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  fetched_at: UtcTimestamp;
  freshness_state: string;
  record_status: GeoRecordStatus;
  assertion_kind: AssertionKind;
  is_prediction: boolean;
  time_state: 'unscheduled' | 'future' | 'current';
}

export interface ViewTransportChangesCurrentRow {
  geo_record_id: string;
  version_id: string;
  source_id: string;
  topic: string;
  title: string | null;
  summary: string | null;
  original_url: string | null;
  geometry_geojson: string | null;
  location_role: LocationRole;
  location_confidence: LocationConfidence;
  area_refs: readonly string[];
  observed_at: UtcTimestamp | null;
  published_at: UtcTimestamp | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  fetched_at: UtcTimestamp;
  freshness_state: string;
  record_status: GeoRecordStatus;
  assertion_kind: AssertionKind;
  is_prediction: boolean;
  time_state: 'future' | 'current';
}

export interface ViewPlanningChangesCurrentRow {
  geo_record_id: string;
  version_id: string;
  source_id: string;
  title: string | null;
  summary: string | null;
  original_url: string | null;
  geometry_geojson: string | null;
  location_role: LocationRole;
  location_confidence: LocationConfidence;
  area_refs: readonly string[];
  published_at: UtcTimestamp | null;
  valid_from: UtcTimestamp | null;
  valid_to: UtcTimestamp | null;
  fetched_at: UtcTimestamp;
  freshness_state: string;
  record_status: GeoRecordStatus;
  assertion_kind: AssertionKind;
  is_prediction: boolean;
  time_state: 'future' | 'ended' | 'planned_unscheduled' | 'current';
}

/**
 * Compares two GeoRecords for logical entity ordering, strictly matching BigQuery canonical views:
 * ORDER BY source_updated_at DESC NULLS LAST,
 *          source_version_ordinal DESC NULLS LAST,
 *          version_id DESC
 */
export function compareGeoRecordProvenance(a: GeoRecord, b: GeoRecord): number {
  // 1. source_updated_at DESC NULLS LAST
  if (a.source_updated_at !== b.source_updated_at) {
    if (a.source_updated_at === null) return 1;
    if (b.source_updated_at === null) return -1;
    return b.source_updated_at.localeCompare(a.source_updated_at);
  }
  // 2. source_version_ordinal DESC NULLS LAST
  if (a.source_version_ordinal !== b.source_version_ordinal) {
    if (a.source_version_ordinal === null) return 1;
    if (b.source_version_ordinal === null) return -1;
    return b.source_version_ordinal - a.source_version_ordinal;
  }
  // 3. Fallback deterministic tie-breaker (matches BigQuery QUALIFY ROW_NUMBER() ORDER BY ... version_id DESC)
  return b.version_id.localeCompare(a.version_id);
}

export interface QueryViewHistoryOptions {
  enforceRightsFilter?: boolean;
  publishedBatchIds?: ReadonlySet<string> | readonly string[];
  activeSourceIds?: ReadonlySet<string> | readonly string[];
}

/**
 * Emulates `melens_query.v_geo_records_history` from 002_core_views.sql.
 * Deduplicates identical (geo_record_id, version_id) and applies public query / rights gating,
 * published batch gating, and active source admission checks.
 */
export function queryViewHistory(
  records: readonly GeoRecord[],
  options: QueryViewHistoryOptions = {},
): ViewHistoryRow[] {
  let filtered = records;

  if (options.publishedBatchIds) {
    const publishedSet =
      options.publishedBatchIds instanceof Set
        ? options.publishedBatchIds
        : new Set(options.publishedBatchIds);
    filtered = filtered.filter((r) => publishedSet.has(r.batch_id));
  }

  if (options.activeSourceIds) {
    const activeSet =
      options.activeSourceIds instanceof Set
        ? options.activeSourceIds
        : new Set(options.activeSourceIds);
    filtered = filtered.filter((r) => activeSet.has(r.source_id));
  }

  const deduped = new Map<string, GeoRecord>();
  for (const r of filtered) {
    deduped.set(`${r.geo_record_id}\u0000${r.version_id}`, r);
  }
  const dedupedList = [...deduped.values()];

  if (options.enforceRightsFilter) {
    // Determine latest record access per entity to ensure historical versions cannot resurrect revoked rights
    const entityGroups = new Map<string, GeoRecord[]>();
    for (const r of dedupedList) {
      const g = entityGroups.get(r.geo_record_id) ?? [];
      g.push(r);
      entityGroups.set(r.geo_record_id, g);
    }
    const latestAccessMap = new Map<string, GeoRecord>();
    for (const [id, group] of entityGroups.entries()) {
      group.sort(compareGeoRecordProvenance);
      latestAccessMap.set(id, group[0]!);
    }

    return dedupedList
      .filter((r) => {
        const latest = latestAccessMap.get(r.geo_record_id);
        return (
          r.public_query_allowed &&
          ['verified_open', 'restricted'].includes(r.rights_status) &&
          latest?.public_query_allowed &&
          ['verified_open', 'restricted'].includes(latest.rights_status)
        );
      })
      .map((r): ViewHistoryRow => ({
        ...r,
        is_prediction: r.assertion_kind === 'prediction',
      }));
  }

  return dedupedList.map((r): ViewHistoryRow => ({
    ...r,
    is_prediction: r.assertion_kind === 'prediction',
  }));
}

/**
 * Test-local comparator that models the documented ordering contract.
 * Changing production SQL does not change this comparator.
 * ORDER BY source_updated_at DESC NULLS LAST,
 *          source_version_ordinal DESC NULLS LAST,
 *          version_id DESC
 */
export function canonicalGeoRecordComparator(a: GeoRecord, b: GeoRecord): number {
  return compareGeoRecordProvenance(a, b);
}

/**
 * Test-local simulation of the documented latest-record contract:
 * QUALIFY ROW_NUMBER() OVER (
 *   PARTITION BY geo_record_id
 *   ORDER BY source_updated_at DESC NULLS LAST,
 *            source_version_ordinal DESC NULLS LAST,
 *            version_id DESC
 * ) = 1
 * AND record_status NOT IN ('cancelled', 'resolved', 'withdrawn')
 *
 * Alternate comparators are fixture controls for this simulation. They do not
 * execute or mutate the production SQL. Suite 0 checks the production SQL text;
 * Suite 7 executes the production views only when the GCP gate is enabled.
 */
export function selectLatestGeoRecord(
  records: readonly GeoRecord[],
  options?: {
    comparator?: (a: GeoRecord, b: GeoRecord) => number;
    filterLifecycleBeforeSort?: boolean;
  },
): GeoRecord | null {
  const comparator = options?.comparator ?? canonicalGeoRecordComparator;
  let candidates = [...records];
  if (options?.filterLifecycleBeforeSort) {
    candidates = candidates.filter(
      (r) => !['cancelled', 'resolved', 'withdrawn'].includes(r.record_status),
    );
  }
  if (candidates.length === 0) return null;
  candidates.sort(comparator);
  const latest = candidates[0]!;
  if (!options?.filterLifecycleBeforeSort) {
    if (['cancelled', 'resolved', 'withdrawn'].includes(latest.record_status)) {
      return null;
    }
  }
  return latest;
}

/**
 * [TEST-LOCAL SIMULATION HELPER ONLY - NOT PROOF OF PRODUCTION BIGQUERY SQL VIEWS]
 * Emulates `melens_query.v_geo_records_current` from 002_core_views.sql in memory
 * for fast offline unit/integration assertions.
 *
 * CAUTION: This function is strictly a test-local simulation. It DOES NOT prove
 * that the production BigQuery GoogleSQL views (002_core_views.sql & 007_changes_views.sql)
 * are validated. Real SQL view verification requires executing queries against
 * actual BigQuery tables in Suite 7 (GCP Acceptance).
 *
 * Crucial invariant mirrored from SQL:
 * - PARTITION BY geo_record_id ORDER BY source_updated_at DESC NULLS LAST, source_version_ordinal DESC NULLS LAST, version_id DESC
 * - Lifecycle filtering (record_status NOT IN ('cancelled', 'resolved', 'withdrawn')) is evaluated
 *   AFTER selecting ROW_NUMBER() = 1, NOT before!
 */
export function queryViewCurrent(
  history: readonly ViewHistoryRow[],
): ViewHistoryRow[] {
  const groups = new Map<string, ViewHistoryRow[]>();
  for (const row of history) {
    const list = groups.get(row.geo_record_id) ?? [];
    list.push(row);
    groups.set(row.geo_record_id, list);
  }

  const result: ViewHistoryRow[] = [];
  for (const [, list] of groups.entries()) {
    list.sort(compareGeoRecordProvenance);
    const latest = list[0]!;
    if (!['cancelled', 'resolved', 'withdrawn'].includes(latest.record_status)) {
      result.push(latest);
    }
  }

  return result;
}

/**
 * Emulates `melens_query.v_change_timeline` from 007_changes_views.sql.
 */
export function queryViewChangeTimeline(
  history: readonly ViewHistoryRow[],
  currentTimestamp: UtcTimestamp,
): ViewChangeTimelineRow[] {
  return history
    .filter((r) => ['event', 'road_disruption', 'planning'].includes(r.topic))
    .map((r): ViewChangeTimelineRow => {
      let time_state: ViewChangeTimelineRow['time_state'];
      if (['cancelled', 'resolved', 'withdrawn'].includes(r.record_status)) {
        time_state = r.record_status as 'cancelled' | 'resolved' | 'withdrawn';
      } else if (r.valid_from !== null && r.valid_from > currentTimestamp) {
        time_state = 'future';
      } else if (r.valid_to !== null && r.valid_to <= currentTimestamp) {
        time_state = 'ended';
      } else if (r.valid_from === null && r.record_status === 'planned') {
        time_state = 'planned_unscheduled';
      } else {
        time_state = 'current';
      }

      return {
        geo_record_id: r.geo_record_id,
        version_id: r.version_id,
        source_id: r.source_id,
        batch_id: r.batch_id,
        topic: r.topic,
        title: r.title,
        summary: r.summary,
        original_url: r.original_url,
        geometry_geojson: r.geometry_geojson,
        location_role: r.location_role,
        location_confidence: r.location_confidence,
        area_refs: r.area_refs,
        observed_at: r.observed_at,
        published_at: r.published_at,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
        fetched_at: r.fetched_at,
        freshness_state: r.freshness_state,
        record_status: r.record_status,
        assertion_kind: r.assertion_kind,
        is_prediction: r.is_prediction,
        time_state,
      };
    });
}

/**
 * Emulates `melens_query.v_events_current` from 007_changes_views.sql.
 */
export function queryViewEventsCurrent(
  current: readonly ViewHistoryRow[],
  currentTimestamp: UtcTimestamp,
): ViewEventsCurrentRow[] {
  return current
    .filter(
      (r) =>
        r.topic === 'event' &&
        (r.valid_to === null || r.valid_to > currentTimestamp),
    )
    .map((r): ViewEventsCurrentRow => {
      let time_state: ViewEventsCurrentRow['time_state'];
      if (r.valid_from === null) {
        time_state = 'unscheduled';
      } else if (r.valid_from > currentTimestamp) {
        time_state = 'future';
      } else {
        time_state = 'current';
      }

      return {
        geo_record_id: r.geo_record_id,
        version_id: r.version_id,
        source_id: r.source_id,
        title: r.title,
        summary: r.summary,
        original_url: r.original_url,
        geometry_geojson: r.geometry_geojson,
        location_role: r.location_role,
        location_confidence: r.location_confidence,
        area_refs: r.area_refs,
        published_at: r.published_at,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
        fetched_at: r.fetched_at,
        freshness_state: r.freshness_state,
        record_status: r.record_status,
        assertion_kind: r.assertion_kind,
        is_prediction: r.is_prediction,
        time_state,
      };
    });
}

/**
 * Emulates `melens_query.v_transport_changes_current` from 007_changes_views.sql.
 */
export function queryViewTransportChangesCurrent(
  current: readonly ViewHistoryRow[],
  currentTimestamp: UtcTimestamp,
): ViewTransportChangesCurrentRow[] {
  return current
    .filter(
      (r) =>
        (r.topic === 'road_disruption' ||
          r.source_id === 'victoria.transport.gtfs_realtime' ||
          r.source_id === 'victoria.emergency.alerts') &&
        (r.valid_to === null || r.valid_to > currentTimestamp),
    )
    .map((r): ViewTransportChangesCurrentRow => ({
      geo_record_id: r.geo_record_id,
      version_id: r.version_id,
      source_id: r.source_id,
      topic: r.topic,
      title: r.title,
      summary: r.summary,
      original_url: r.original_url,
      geometry_geojson: r.geometry_geojson,
      location_role: r.location_role,
      location_confidence: r.location_confidence,
      area_refs: r.area_refs,
      observed_at: r.observed_at,
      published_at: r.published_at,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      fetched_at: r.fetched_at,
      freshness_state: r.freshness_state,
      record_status: r.record_status,
      assertion_kind: r.assertion_kind,
      is_prediction: r.is_prediction,
      time_state:
        r.valid_from !== null && r.valid_from > currentTimestamp
          ? 'future'
          : 'current',
    }));
}

/**
 * Emulates `melens_query.v_planning_changes_current` from 007_changes_views.sql.
 */
export function queryViewPlanningChangesCurrent(
  current: readonly ViewHistoryRow[],
  currentTimestamp: UtcTimestamp,
): ViewPlanningChangesCurrentRow[] {
  return current
    .filter(
      (r) =>
        r.topic === 'planning' ||
        r.source_id === 'victoria.vicmap.planning' ||
        r.source_id === 'melbourne.development_monitor',
    )
    .map((r): ViewPlanningChangesCurrentRow => {
      let time_state: ViewPlanningChangesCurrentRow['time_state'];
      if (r.valid_from !== null && r.valid_from > currentTimestamp) {
        time_state = 'future';
      } else if (r.valid_to !== null && r.valid_to <= currentTimestamp) {
        time_state = 'ended';
      } else if (r.valid_from === null && r.record_status === 'planned') {
        time_state = 'planned_unscheduled';
      } else {
        time_state = 'current';
      }

      return {
        geo_record_id: r.geo_record_id,
        version_id: r.version_id,
        source_id: r.source_id,
        title: r.title,
        summary: r.summary,
        original_url: r.original_url,
        geometry_geojson: r.geometry_geojson,
        location_role: r.location_role,
        location_confidence: r.location_confidence,
        area_refs: r.area_refs,
        published_at: r.published_at,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
        fetched_at: r.fetched_at,
        freshness_state: r.freshness_state,
        record_status: r.record_status,
        assertion_kind: r.assertion_kind,
        is_prediction: r.is_prediction,
        time_state,
      };
    });
}

// ----------------------------------------------------------------------------
// Local Publisher Double & Schema Loaders (Exercises real BigQueryPublisher)
// ----------------------------------------------------------------------------

async function readSql(name: string): Promise<string> {
  try {
    return await readFile(new URL(`../../../sql/${name}`, import.meta.url), 'utf8');
  } catch {
    return await readFile(new URL(`../../sql/${name}`, import.meta.url), 'utf8');
  }
}

// Checks the shipped SQL structure. This does not execute GoogleSQL or certify
// deployed views; the opt-in GCP suite below remains the execution gate.
function assertCurrentViewOrderingStructure(sql: string): void {
  const uncommented = sql.replace(/--[^\n]*/g, '');
  const currentView = uncommented.match(
    /CREATE OR REPLACE VIEW `melens_query\.v_geo_records_current` AS([\s\S]*?);/i,
  )?.[1];
  assert.ok(currentView, 'Production current view must exist');
  const qualifyingStart = [...currentView.matchAll(/QUALIFY\s+ROW_NUMBER\(\)\s+OVER\s*\(/gi)].at(-1)?.index;
  assert.ok(qualifyingStart !== undefined, 'Current view must rank logical versions');
  const qualifying = currentView.slice(qualifyingStart);
  assert.ok(qualifying, 'Current view must rank logical versions');
  assert.match(
    qualifying,
    /^QUALIFY\s+ROW_NUMBER\(\)\s+OVER\s*\(\s*PARTITION BY geo_record_id\s+ORDER BY source_updated_at DESC NULLS LAST\s*,\s*source_version_ordinal DESC NULLS LAST\s*,\s*version_id DESC\s*\)\s*=\s*1\s+AND record_status NOT IN\s*\(\s*'cancelled'\s*,\s*'resolved'\s*,\s*'withdrawn'\s*\)\s*$/i,
    'Current view must order by source time and ordinal, then filter lifecycle',
  );
  assert.doesNotMatch(
    currentView.slice(0, currentView.indexOf(qualifying)),
    /\brecord_status\b/i,
    'Lifecycle filtering must not remove terminal versions before ranking',
  );
}

test('US4 Suite 0: shipped SQL ordering structure rejects hash-only, reversed-time and pre-ranking lifecycle mutations', async () => {
  const sql = await readSql('002_core_views.sql');
  assertCurrentViewOrderingStructure(sql);
  const marker = 'CREATE OR REPLACE VIEW `melens_query.v_geo_records_current` AS';
  const start = sql.indexOf(marker);
  assert.ok(start >= 0);
  const mutateCurrent = (transform: (view: string) => string) =>
    sql.slice(0, start) + transform(sql.slice(start));
  const hashOnly = mutateCurrent((view) => view.replace(
    /ORDER BY source_updated_at DESC NULLS LAST,\s*source_version_ordinal DESC NULLS LAST,\s*version_id DESC/,
    'ORDER BY version_id DESC',
  ));
  const reversedTime = mutateCurrent((view) => view.replace(
    'source_updated_at DESC NULLS LAST', 'source_updated_at ASC NULLS LAST',
  ));
  const prefiltered = mutateCurrent((view) => view.replace(
    'WHERE g.source_id', "WHERE g.record_status NOT IN ('cancelled', 'resolved', 'withdrawn') AND g.source_id",
  ));
  for (const mutation of [hashOnly, reversedTime, prefiltered]) {
    assert.notEqual(mutation, sql, 'Mutation must change the shipped SQL');
    assert.throws(() => assertCurrentViewOrderingStructure(mutation));
  }
});

async function loadSchemas(): Promise<Map<string, Array<{ name: string; type: string; mode: string }>>> {
  const ddl = await readSql('001_tables.sql');
  return new Map(
    [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS `melens_ingest\.(\w+)` \(([\s\S]*?)\n\)/g)].map((match) => [
      match[1] ?? '',
      [...(match[2] ?? '').matchAll(/^  (\w+) (ARRAY<\w+>|\w+)( NOT NULL)?/gm)].map((field) => ({
        name: field[1] ?? '',
        type: field[2]?.replace(/^ARRAY<|>$/g, '') ?? '',
        mode: field[2]?.startsWith('ARRAY') ? 'REPEATED' : field[3] ? 'REQUIRED' : 'NULLABLE',
      })),
    ]),
  );
}

const FACT_TABLE_KEYS: Record<string, readonly string[]> = {
  source_records: ['source_record_id', 'version_id'],
  geo_records: ['geo_record_id', 'version_id'],
  geo_record_sources: ['geo_record_id', 'version_id', 'source_record_id', 'source_version_id'],
};

class FakeStore {
  readonly objects = new Map<string, readonly unknown[]>();
  readonly deleted = new Set<string>();
  readonly locks = new Set<string>();
  manifest: CheckpointManifest = {
    sourceId: 'ticketmaster.events',
    checkpoint: '2026-10-01T00:00:00Z',
    completedWindows: [],
  };

  async withBatchLease<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.locks.has(id)) throw new Error('Publication already in progress');
    this.locks.add(id);
    try {
      return await work();
    } finally {
      this.locks.delete(id);
    }
  }

  async readCheckpoint(sourceId: string, initial: string | null) {
    if (this.manifest.sourceId !== sourceId && initial !== null) {
      this.manifest = { sourceId, checkpoint: initial, completedWindows: [] };
    }
    return { manifest: this.manifest, generation: '1' };
  }

  async markPublishedWindow(_id: string, _initial: string, window: { from: string; to: string; batchId: string }) {
    this.manifest = addCompletedWindow(this.manifest, window);
    return this.manifest;
  }

  async saveNdjson(input: { kind: string; sourceId: string; batchId: string; rows: readonly unknown[] }): Promise<StoredObject> {
    const hash = createHash('sha256').update(JSON.stringify(input.rows)).digest('hex');
    const uri = `gs://fixture/${input.kind}/${input.sourceId}/${input.batchId}/${hash}.ndjson`;
    this.objects.set(uri, input.rows);
    this.deleted.delete(uri);
    return { uri, sha256: hash, generation: '1', expiresAt: '2026-10-01T00:00:00Z' };
  }

  async deleteObject(object: StoredObject) {
    this.deleted.add(object.uri);
  }

  async deleteStagingObjects(uris: readonly string[]) {
    uris.forEach((uri) => this.deleted.add(uri));
  }

  async purgeSourceCopies(sourceId: string) {
    let count = 0;
    for (const [uri] of this.objects) {
      if (uri.includes(`/${sourceId}/`)) {
        this.deleted.add(uri);
        count++;
      }
    }
    return count;
  }
}

class FakeBigQuery {
  readonly states: SyncBatch[] = [];
  readonly sourceRows: Record<string, unknown>[] = [];
  readonly facts = new Map<string, Record<string, unknown>[]>();
  readonly loadedTables: string[] = [];
  readonly jobs = new Map<string, JobMetadata>();

  constructor(
    private readonly store: FakeStore,
    private readonly schemas: Map<string, Array<{ name: string; type: string; mode: string }>>,
  ) {}

  async getProjectId() {
    return 'melens-fixture';
  }

  latest(batchId: unknown) {
    const matching = this.states.filter((row) => row.batch_id === batchId);
    return matching.sort(
      (a, b) =>
        Date.parse(b.state_updated_at) - Date.parse(a.state_updated_at) ||
        this.states.indexOf(b) - this.states.indexOf(a),
    )[0];
  }

  async query(input: { query: string; params?: Record<string, string> }): Promise<[Record<string, unknown>[]]> {
    const sql = input.query;
    const params = input.params ?? {};
    if (sql.includes('INSERT INTO') && sql.includes('sync_batches')) {
      const row = JSON.parse(params.payload ?? '{}') as SyncBatch;
      this.states.push(row);
      return [[]];
    }
    if (sql.includes('TO_JSON_STRING(t) AS batch')) {
      const latest = this.latest(params.batchId);
      return [latest ? [{ batch: JSON.stringify(latest) }] : []];
    }
    if (sql.includes('data_sources') || sql.includes('CAST(last_success_at AS STRING)')) {
      return [this.sourceRows.slice(-1)];
    }
    const table = /\/\* validate:(\w+) \*\//.exec(sql)?.[1];
    if (table) {
      const batchRows = (this.facts.get(table) ?? []).filter((row) => row.batch_id === params.batchId);
      const publishedBatches = new Set(
        this.states
          .filter((batch) => this.latest(batch.batch_id)?.state === 'published' && batch.published_at !== null)
          .map((batch) => batch.batch_id),
      );

      const keys = FACT_TABLE_KEYS[table] ?? ['geo_record_id', 'version_id'];
      const distinctCount = new Set(batchRows.map((r) => JSON.stringify(keys.map((k) => r[k])))).size;

      let ambiguous = 0;
      if (table === 'geo_records') {
        const batchLogicalKeys = new Set(batchRows.map((r) => String(r.geo_record_id ?? '')));
        const eligible = (this.facts.get(table) ?? []).filter(
          (r) =>
            (r.batch_id === params.batchId || publishedBatches.has(String(r.batch_id ?? ''))) &&
            batchLogicalKeys.has(String(r.geo_record_id ?? '')),
        );

        const groups = new Map<string, Record<string, unknown>[]>();
        for (const row of eligible) {
          const key = String(row.geo_record_id ?? '');
          const list = groups.get(key) ?? [];
          list.push(row);
          groups.set(key, list);
        }

        for (const [, rows] of groups.entries()) {
          const distinctVersions = new Set(rows.map((r) => r.version_id));
          if (distinctVersions.size > 1) {
            const missingTime = rows.filter((r) => r.source_updated_at === null || r.source_updated_at === undefined).length;
            const hasTime = rows.filter((r) => r.source_updated_at !== null && r.source_updated_at !== undefined).length;
            const missingOrdinal = rows.filter((r) => r.source_version_ordinal === null || r.source_version_ordinal === undefined).length;
            const positions = new Set(
              rows.map((r) =>
                JSON.stringify({
                  source_updated_at: r.source_updated_at ?? null,
                  source_version_ordinal: r.source_version_ordinal ?? null,
                }),
              ),
            ).size;

            if ((missingTime > 0 && (hasTime > 0 || missingOrdinal > 0)) || positions < distinctVersions.size) {
              ambiguous++;
            }
          }
        }
      }

      return [
        [
          {
            distinct_count: distinctCount,
            unexpected: 0,
            invalid: 0,
            conflicts: 0,
            ambiguous,
          },
        ],
      ];
    }
    if (sql.includes('UPDATE') && sql.includes('sync_batches')) return [[]];
    const deletedTable = /DELETE FROM `[^`]+\.(\w+)`/.exec(sql)?.[1];
    if (deletedTable) {
      this.facts.delete(deletedTable);
      return [[]];
    }

    return [[]];
  }

  dataset() {
    return {
      table: (table: string) => ({
        getMetadata: async () => [{ schema: { fields: this.schemas.get(table) ?? [] } }],
      }),
    };
  }

  async createJob(input: { jobId: string; configuration: NonNullable<JobMetadata['configuration']> }) {
    const table = input.configuration.load?.destinationTable?.tableId;
    if (!table) throw new Error('Missing load destination');
    const uri = input.configuration.load?.sourceUris?.[0];
    const rows = (this.store.objects.get(uri ?? '') ?? []) as Record<string, unknown>[];
    this.jobs.set(input.jobId, {
      configuration: input.configuration,
      status: { state: 'DONE' },
      statistics: { load: { outputRows: String(rows.length) } },
    });
    this.loadedTables.push(table);
    if (table === 'data_sources') this.sourceRows.push(...rows);
    else this.facts.set(table, [...(this.facts.get(table) ?? []), ...rows]);
  }

  job(id: string) {
    return {
      getMetadata: async () => [this.jobs.get(id)],
    };
  }
}

async function setupLocalPublisher() {
  const schemas = await loadSchemas();
  const store = new FakeStore();
  const bigquery = new FakeBigQuery(store, schemas);
  const config: DataConfig = {
    projectId: 'melens-fixture',
    region: 'australia-southeast2',
    bucketName: 'fixture',
    ingestDataset: 'melens_ingest',
    queryDataset: 'melens_query',
    secretNames: [],
  };
  const publisher = new BigQueryPublisher(config, bigquery as unknown as BigQuery, store as unknown as GcsStore);
  return { store, bigquery, publisher };
}

async function getAdmittedTicketmasterSource(): Promise<DataSource> {
  const content = await readFile(
    new URL('../../src/connectors/ticketmaster/source.json', import.meta.url),
    'utf8',
  );
  const rawSource = JSON.parse(content) as DataSource;
  return {
    ...rawSource,
    access_status: 'active',
    license_status: 'verified_open',
    admission_evidence: {
      ...rawSource.admission_evidence,
      missing_requirements: [],
      allowed_fields: ['id', 'url', 'name', 'dates', '_embedded.venues.location', 'title', 'summary'],
    },
    last_checked_at: null,
    last_success_at: null,
    last_source_update_at: null,
  };
}

function toSuccess(
  sourceId: string,
  runId: string,
  fetchedAt: UtcTimestamp,
  norm: {
    geoRecords: GeoRecord[];
    sourceRecords: SourceRecord[];
    geoRecordSources: GeoRecordSource[];
  },
): ConnectorSuccess {
  return {
    kind: 'success',
    sourceId,
    runId,
    fetchedAt,
    sourceRevision: `rev-${runId}`,
    sourceLatestUpdateAt: fetchedAt,
    checkpointAfter: fetchedAt,
    completeness: {
      complete: true,
      method: 'feed_snapshot',
      expected_records: norm.sourceRecords.length,
      fetched_records: norm.sourceRecords.length,
      expected_pages: 1,
      fetched_pages: 1,
      evidence: 'test',
    },
    inputCount: norm.sourceRecords.length,
    outputCount: norm.geoRecords.length,
    rejectedCount: 0,
    sourceRecords: norm.sourceRecords,
    geoRecords: norm.geoRecords,
    geoRecordSources: norm.geoRecordSources,
    boundaries: [],
    areaIndicators: [],
    parkingBays: [],
    parkingObservations: [],
    parkingRules: [],
    sensorLocations: [],
    pedestrianObservations: [],
    retainableRawRecords: null,
  };
}

// ============================================================================
// Suite 1: Event Rescheduling & Cancellation Handling (Ticketmaster)
// ============================================================================

test('US4 Suite 1: Event lifecycle, rescheduling and cancellation preserve version history while updating current views independently of hash ordering', async () => {
  const inputRun1 = parseConnectorInput({
    sourceId: 'ticketmaster.events',
    window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
    checkpoint: null,
    runId: 'ticketmaster-run-1',
  });
  const fetchedAtRun1 = '2026-09-28T00:00:00Z' as UtcTimestamp;

  const fixture = await loadTicketmasterFixture();
  const events = fixture._embedded?.events ?? [];
  assert.ok(events.length >= 2, 'Fixture must contain at least 2 events');

  // 1. Initial normalization: Event 1 is active (onsale), Event 2 is postponed (dateTBD)
  const normRun1 = normalizeTicketEvents(events, inputRun1, fetchedAtRun1);
  assert.equal(normRun1.geoRecords.length, 2);

  const ev1V1 = normRun1.geoRecords[0]!;
  assert.ok(ev1V1);
  assert.equal(ev1V1.topic, 'event');
  assert.equal(ev1V1.assertion_kind, 'plan');
  assert.equal(ev1V1.record_status, 'planned');
  assert.equal(ev1V1.valid_from, '2026-10-01T09:00:00.000Z');
  assert.equal(ev1V1.valid_to, '2026-10-01T09:00:00.000Z');
  assert.equal(ev1V1.location_role, 'event_site');
  assert.equal(ev1V1.location_confidence, 'source_coordinate');
  assert.equal(ev1V1.centroid_lon, 144.96);
  assert.equal(ev1V1.centroid_lat, -37.81);
  assert.equal(validateGeoRecordGeography(ev1V1).valid, true);

  // Contract verification: raw connector output leaves source_updated_at and source_version_ordinal null
  assert.equal(ev1V1.source_updated_at, null, 'Ticketmaster raw normalization has no source_updated_at');
  assert.equal(ev1V1.source_version_ordinal, null, 'Ticketmaster raw normalization has no source_version_ordinal');
  assert.ok(ev1V1.version_id.startsWith('a31d9abc'), 'Event 1 V1 hash matches G22 reference hash');

  const ev2V1 = normRun1.geoRecords[1]!;
  assert.ok(ev2V1);
  assert.equal(ev2V1.topic, 'event');
  assert.equal(ev2V1.assertion_kind, 'plan');
  assert.equal(ev2V1.record_status, 'planned');
  assert.equal(ev2V1.valid_from, null, 'Postponed event with dateTBD must have null valid_from');
  assert.equal(ev2V1.valid_to, null);

  // View query at current time 2026-09-29T12:00:00Z
  const currentTime = '2026-09-29T12:00:00Z' as UtcTimestamp;
  const historyRun1 = queryViewHistory(normRun1.geoRecords);
  const currentRun1 = queryViewCurrent(historyRun1);
  const eventsCurrentRun1 = queryViewEventsCurrent(currentRun1, currentTime);

  assert.equal(eventsCurrentRun1.length, 2);
  const ev1CurrentRun1 = eventsCurrentRun1.find((r) => r.geo_record_id === ev1V1.geo_record_id);
  assert.ok(ev1CurrentRun1);
  assert.equal(ev1CurrentRun1.time_state, 'future');

  const ev2CurrentRun1 = eventsCurrentRun1.find((r) => r.geo_record_id === ev2V1.geo_record_id);
  assert.ok(ev2CurrentRun1);
  assert.equal(ev2CurrentRun1.time_state, 'unscheduled');

  // --------------------------------------------------------------------------
  // 2. Scenario 1: Event Cancellation with Lexicographically Smaller Hash (G22)
  // --------------------------------------------------------------------------
  // Upstream reports that Event 1 is cancelled, with updated title
  const inputRun2 = parseConnectorInput({
    sourceId: 'ticketmaster.events',
    window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
    checkpoint: null,
    runId: 'ticketmaster-run-2',
  });
  const fetchedAtRun2 = '2026-09-29T00:00:00Z' as UtcTimestamp;

  const rawEv1 = events[0]!;
  const cancelledEv1 = {
    ...rawEv1,
    name: 'Example Melbourne Concert cancelled notice 2',
    dates: {
      ...rawEv1.dates,
      status: { code: 'canceled' },
    },
  };

  const normRun2 = normalizeTicketEvents([cancelledEv1], inputRun2, fetchedAtRun2);
  const ev1V2 = normRun2.geoRecords[0]!;
  assert.ok(ev1V2);
  assert.equal(ev1V2.geo_record_id, ev1V1.geo_record_id, 'Stable entity ID across lifecycle');
  assert.equal(ev1V2.record_status, 'cancelled');

  // Exact hash check per G22: cancelled version hash (3fff5dc8...) is STRICTLY SMALLER than original hash (a31d9abc...)
  assert.ok(ev1V2.version_id.startsWith('3fff5dc8'), 'Cancelled version hash matches G22 reproduction hash');
  assert.ok(
    ev1V2.version_id.localeCompare(ev1V1.version_id) < 0,
    'G22: Cancelled version hash MUST be lexicographically smaller than original version',
  );

  // 2a. Real Publisher Rejection of Ambiguous Multi-Version Updates (G22 Requirement):
  // When version ordering evidence is missing (both source_updated_at and source_version_ordinal are null),
  // the real BigQuery publisher rejects ambiguous multiple versions at the publication gate.
  const { publisher: unversionedPublisher } = await setupLocalPublisher();
  const admittedSource = await getAdmittedTicketmasterSource();

  // Run 1 succeeds as the initial single-version entity
  const run1Success = toSuccess(admittedSource.source_id, 'ticketmaster-run-1', fetchedAtRun1, {
    sourceRecords: normRun1.sourceRecords,
    geoRecords: normRun1.geoRecords.map((r) => ({
      ...r,
      rights_status: 'verified_open',
      public_query_allowed: true,
    })),
    geoRecordSources: normRun1.geoRecordSources,
  });
  const publishedBatch1 = await unversionedPublisher.publish({
    source: admittedSource,
    result: run1Success,
    windowFrom: '2026-10-01T00:00:00Z',
    windowTo: '2026-10-05T00:00:00Z',
    initialCheckpoint: '2026-10-01T00:00:00Z',
  });
  assert.equal(publishedBatch1.state, 'published');

  // Attempting to publish an unversioned multiple version (ev1V2 has null source_updated_at & ordinal)
  // MUST fail closed in BigQuery publication validation gate!
  const run2UnversionedSuccess = toSuccess(admittedSource.source_id, 'ticketmaster-run-2-ambiguous', fetchedAtRun2, {
    sourceRecords: normRun2.sourceRecords,
    geoRecords: normRun2.geoRecords.map((r) => ({
      ...r,
      rights_status: 'verified_open',
      public_query_allowed: true,
    })),
    geoRecordSources: normRun2.geoRecordSources,
  });
  await assert.rejects(
    unversionedPublisher.publish({
      source: admittedSource,
      result: run2UnversionedSuccess,
      windowFrom: '2026-10-01T00:00:00Z',
      windowTo: '2026-10-05T00:00:00Z',
      initialCheckpoint: '2026-10-05T00:00:00Z',
    }),
    /BigQuery validation failed for geo_records/,
    'Unversioned multiple versions MUST be rejected by the BigQuery publisher validation gate',
  );

  // 2b. Versioned Cancellation Check (G22 Requirement):
  // When proper version ordering evidence is present (source_updated_at and source_version_ordinal),
  // the publisher validates and publishes the batch, and the cancellation takes effect even
  // when hash order is reversed (ev1V2: 3fff5dc8... < ev1V1: a31d9abc...)!
  const { publisher: versionedPublisher } = await setupLocalPublisher();

  const ev1V1_versioned: GeoRecord = {
    ...ev1V1,
    source_updated_at: '2026-09-28T00:00:00Z',
    source_version_ordinal: 1,
  };
  const ev1V2_versioned: GeoRecord = {
    ...ev1V2,
    source_updated_at: '2026-09-29T00:00:00Z',
    source_version_ordinal: 2,
  };

  const run1VersionedSuccess = toSuccess(admittedSource.source_id, 'ticketmaster-run-1-versioned', fetchedAtRun1, {
    sourceRecords: normRun1.sourceRecords.map((r) => ({
      ...r,
      source_updated_at: '2026-09-28T00:00:00Z',
      source_version_ordinal: 1,
    })),
    geoRecords: [
      {
        ...ev1V1_versioned,
        rights_status: 'verified_open',
        public_query_allowed: true,
      },
    ],
    geoRecordSources: normRun1.geoRecordSources,
  });
  await versionedPublisher.publish({
    source: admittedSource,
    result: run1VersionedSuccess,
    windowFrom: '2026-10-01T00:00:00Z',
    windowTo: '2026-10-05T00:00:00Z',
    initialCheckpoint: '2026-10-01T00:00:00Z',
  });

  const run2VersionedSuccess = toSuccess(admittedSource.source_id, 'ticketmaster-run-2-versioned', fetchedAtRun2, {
    sourceRecords: normRun2.sourceRecords.map((r) => ({
      ...r,
      source_updated_at: '2026-09-29T00:00:00Z',
      source_version_ordinal: 2,
    })),
    geoRecords: [
      {
        ...ev1V2_versioned,
        rights_status: 'verified_open',
        public_query_allowed: true,
      },
    ],
    geoRecordSources: normRun2.geoRecordSources,
  });
  const publishedBatch2 = await versionedPublisher.publish({
    source: admittedSource,
    result: run2VersionedSuccess,
    windowFrom: '2026-10-01T00:00:00Z',
    windowTo: '2026-10-05T00:00:00Z',
    initialCheckpoint: '2026-10-05T00:00:00Z',
  });
  assert.equal(publishedBatch2.state, 'published', 'Versioned updates pass real publisher validation');

  const combinedHistory = queryViewHistory([ev1V1_versioned, ev1V2_versioned]);
  assert.equal(combinedHistory.length, 2, 'Version history strictly retained in audit view');

  const currentAfterCancel = queryViewCurrent(combinedHistory);
  assert.equal(
    currentAfterCancel.some((r) => r.geo_record_id === ev1V1.geo_record_id),
    false,
    'Cancelled event MUST NOT be returned in current active views even with smaller hash',
  );

  const eventsCurrentAfterCancel = queryViewEventsCurrent(currentAfterCancel, currentTime);
  assert.equal(
    eventsCurrentAfterCancel.some((r) => r.geo_record_id === ev1V1.geo_record_id),
    false,
  );

  const timeline = queryViewChangeTimeline(combinedHistory, currentTime);
  const ev1TimelineCancelled = timeline.find(
    (r) => r.geo_record_id === ev1V1.geo_record_id && r.version_id === ev1V2.version_id,
  );
  assert.ok(ev1TimelineCancelled);
  assert.equal(ev1TimelineCancelled.time_state, 'cancelled');
  assert.equal(ev1TimelineCancelled.record_status, 'cancelled');

  // Local comparator controls for the event cancellation fixture:
  // Proves that production sorting contract is strictly enforced and that mutating the ordering logic
  // causes sensitive test failure.
  const cancelRecords = [ev1V1_versioned, ev1V2_versioned];
  const canonicalCancel = selectLatestGeoRecord(cancelRecords);
  assert.equal(
    canonicalCancel,
    null,
    'Local contract sorting must select cancelled ev1V2 and exit it from current view',
  );

  // Mutation 1: Naive hash sorting (ev1V1 hash 'a31d...' > ev1V2 hash '3fff...')
  const mutatedCancelByHash = selectLatestGeoRecord(cancelRecords, {
    comparator: (a, b) => b.version_id.localeCompare(a.version_id),
  });
  assert.ok(mutatedCancelByHash, 'Mutation sensitivity: broken hash sorting incorrectly yields an active record');
  assert.equal(
    mutatedCancelByHash?.version_id,
    ev1V1.version_id,
    'Mutation sensitivity: naive hash sorting selects ev1V1 (planned) instead of ev1V2 (cancelled)',
  );
  assert.equal(mutatedCancelByHash?.record_status, 'planned');
  assert.notEqual(canonicalCancel, mutatedCancelByHash);

  // Mutation 2: Pre-filtering lifecycle before ranking
  const mutatedCancelByPreFilter = selectLatestGeoRecord(cancelRecords, {
    filterLifecycleBeforeSort: true,
  });
  assert.equal(
    mutatedCancelByPreFilter?.record_status,
    'planned',
    'Mutation sensitivity: filtering lifecycle before ranking resurrects planned event',
  );
  assert.notEqual(canonicalCancel, mutatedCancelByPreFilter);

  // --------------------------------------------------------------------------
  // 3. Scenario 2: Event Rescheduling with Lexicographically Smaller Hash (G22)
  // --------------------------------------------------------------------------
  // In run 3, Event 1 was not cancelled, but rescheduled to 2026-11-20
  const inputRun3 = parseConnectorInput({
    sourceId: 'ticketmaster.events',
    window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-11-30T00:00:00Z' },
    checkpoint: null,
    runId: 'ticketmaster-run-3',
  });
  const fetchedAtRun3 = '2026-09-29T06:00:00Z' as UtcTimestamp;

  const rescheduledEv1 = {
    ...rawEv1,
    name: 'Rescheduled Concert 1',
    dates: {
      ...rawEv1.dates,
      start: {
        dateTime: '2026-11-20T09:00:00Z',
        localDate: '2026-11-20',
        localTime: '19:00:00',
      },
      status: { code: 'rescheduled' },
    },
  };
  const normRun3 = normalizeTicketEvents([rescheduledEv1], inputRun3, fetchedAtRun3);
  const ev1V3 = normRun3.geoRecords[0]!;
  assert.ok(ev1V3);
  assert.equal(ev1V3.valid_from, '2026-11-20T09:00:00.000Z');
  assert.ok(ev1V3.version_id.startsWith('1652443d'), 'Rescheduled version has smaller hash');
  assert.ok(
    ev1V3.version_id.localeCompare(ev1V1.version_id) < 0,
    'Rescheduled version hash MUST be lexicographically smaller than original planned version',
  );

  // When version ordering evidence is present, rescheduled version supersedes planned version
  const ev1V3_versioned: GeoRecord = {
    ...ev1V3,
    source_updated_at: '2026-09-29T06:00:00Z',
    source_version_ordinal: 3,
  };

  const historyRescheduled = queryViewHistory([ev1V1_versioned, ev1V3_versioned]);
  assert.equal(historyRescheduled.length, 2);

  const currentRescheduled = queryViewCurrent(historyRescheduled);
  assert.equal(currentRescheduled.length, 1);
  assert.equal(currentRescheduled[0]?.version_id, ev1V3.version_id);
  assert.equal(currentRescheduled[0]?.valid_from, '2026-11-20T09:00:00.000Z');

  const eventsCurrentRescheduled = queryViewEventsCurrent(currentRescheduled, currentTime);
  assert.equal(eventsCurrentRescheduled.length, 1);
  assert.equal(eventsCurrentRescheduled[0]?.valid_from, '2026-11-20T09:00:00.000Z');
  assert.equal(eventsCurrentRescheduled[0]?.time_state, 'future');

  // Local comparator controls for the event rescheduling fixture:
  const reschedRecords = [ev1V1_versioned, ev1V3_versioned];
  const canonicalResched = selectLatestGeoRecord(reschedRecords);
  assert.equal(canonicalResched?.version_id, ev1V3.version_id);
  assert.equal(canonicalResched?.valid_from, '2026-11-20T09:00:00.000Z');

  // Mutation: Naive hash sorting (ev1V1 hash 'a31d...' > ev1V3 hash '1652...')
  const mutatedReschedByHash = selectLatestGeoRecord(reschedRecords, {
    comparator: (a, b) => b.version_id.localeCompare(a.version_id),
  });
  assert.equal(
    mutatedReschedByHash?.valid_from,
    '2026-10-01T09:00:00.000Z',
    'Mutation sensitivity: naive hash sorting fails to update to rescheduled date',
  );
  assert.notEqual(canonicalResched?.valid_from, mutatedReschedByHash?.valid_from);

  // --------------------------------------------------------------------------
  // 4. Scenario 3: Delayed / Late-Arriving Older Versions (G22 Requirement)
  // --------------------------------------------------------------------------
  // Verify that delayed/late-arriving older versions cannot overwrite newer versions
  // Even though ev1V1 has a larger hash ('a31d9abc' > '3fff5dc8'), replaying ev1V1
  // after ev1V2 or ev1V3 cannot overwrite the newer version!
  const delayedHistoryCancelled = queryViewHistory([ev1V2_versioned, ev1V1_versioned]);
  const currentAfterDelayedReplay = queryViewCurrent(delayedHistoryCancelled);
  assert.equal(
    currentAfterDelayedReplay.some((r) => r.geo_record_id === ev1V1.geo_record_id),
    false,
    'Delayed older planned version MUST NOT overwrite newer cancellation version',
  );

  const delayedHistoryRescheduled = queryViewHistory([ev1V3_versioned, ev1V1_versioned]);
  const currentAfterDelayedResched = queryViewCurrent(delayedHistoryRescheduled);
  assert.equal(currentAfterDelayedResched.length, 1);
  assert.equal(
    currentAfterDelayedResched[0]?.version_id,
    ev1V3.version_id,
    'Delayed older version MUST NOT revert rescheduled event date',
  );
  assert.equal(currentAfterDelayedResched[0]?.valid_from, '2026-11-20T09:00:00.000Z');

  // --------------------------------------------------------------------------
  // 5. Rights & Publication Batch Gating on Public Query (G22 Requirement)
  // --------------------------------------------------------------------------
  // Raw Ticketmaster connector sets rights_status = 'review_required', public_query_allowed = false
  const unadmittedHistory = queryViewHistory([ev1V1], { enforceRightsFilter: true });
  assert.equal(
    unadmittedHistory.length,
    0,
    'Candidate review_required Ticketmaster records must be excluded from public query history',
  );

  // When admitted and in published batches, records are accessible
  const admittedEv1: GeoRecord = {
    ...ev1V1_versioned,
    rights_status: 'verified_open',
    public_query_allowed: true,
  };
  const admittedHistory = queryViewHistory([admittedEv1], {
    enforceRightsFilter: true,
    publishedBatchIds: ['ticketmaster-run-1'],
  });
  assert.equal(admittedHistory.length, 1);

  // --------------------------------------------------------------------------
  // 6. Missing Venue Coordinates / Unlocated Event
  // --------------------------------------------------------------------------
  const unlocatedEv = {
    ...rawEv1,
    id: 'EV-UNLOCATED',
    _embedded: { venues: [{ id: 'V-NO-COORDS', name: 'Unknown Tent' }] },
  };
  const normUnlocated = normalizeTicketEvents([unlocatedEv], inputRun1, fetchedAtRun1);
  const unlocatedGeo = normUnlocated.geoRecords[0];
  assert.ok(unlocatedGeo);
  assert.equal(unlocatedGeo.geometry_geojson, null);
  assert.equal(unlocatedGeo.centroid_lat, null);
  assert.equal(unlocatedGeo.centroid_lon, null);
  assert.equal(unlocatedGeo.location_role, 'unknown');
  assert.equal(unlocatedGeo.location_confidence, 'unverified');
  assert.equal(validateGeoRecordGeography(unlocatedGeo).valid, true);

  // 7. Invariant: Duplicate Event IDs upstream fail fast
  assert.throws(
    () => normalizeTicketEvents([rawEv1, rawEv1], inputRun1, fetchedAtRun1),
    /Duplicate Ticketmaster event ID/,
  );
});

// ============================================================================
// Suite 2: Future Roadworks & Planned Disruptions (tv_road_planned)
// ============================================================================

test('US4 Suite 2: Future roadworks have geoRecordStatus planned, assertion plan, and proper time bounds', async () => {
  const input = parseConnectorInput({
    sourceId: 'victoria.transport.road_planned',
    window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-10-15T00:00:00Z' },
    checkpoint: '2026-09-28T00:00:00Z',
    runId: 'road-planned-run',
  });
  const fetchedAt = '2026-09-28T02:30:00.000Z' as UtcTimestamp;

  const page = await loadPlannedRoadFixture();
  const unverified = normalizePlannedRoadSnapshot(page.data.features, input, fetchedAt);
  assert.equal(unverified.geoRecords[0]?.valid_from, null, 'Offsetless wall clocks do not prove an absolute start');
  assert.equal(unverified.geoRecords[0]?.valid_to, null, 'Offsetless wall clocks do not prove an absolute end');
  assert.equal(unverified.geoRecords[0]?.source_updated_at, null, 'Offsetless update time cannot establish version order');

  // Explicit offsets below are synthetic contract inputs. They do not establish
  // the timezone of the real Transport Victoria offsetless fields.
  const futureFeature = page.data.features[0];
  assert.ok(futureFeature);
  const verifiedFeatures = [{
    ...futureFeature,
    properties: {
      ...futureFeature.properties,
      duration: {
        ...futureFeature.properties.duration,
        start: '2026-10-01T20:00:00+10:00',
        end: '2026-10-10T05:00:00+11:00',
      },
      lastUpdated: '2026-09-28T12:00:00+10:00',
    },
  }, ...page.data.features.slice(1)];
  const normalized = normalizePlannedRoadSnapshot(verifiedFeatures, input, fetchedAt);

  assert.equal(normalized.sourceRecords.length, 2);
  assert.equal(normalized.geoRecords.length, 3); // Feature 1 GeometryCollection has 2 parts; Feature 2 has 1

  // 1. Future roadworks feature (PRD:OneView:123)
  // Synthetic status Pending and explicit start offset yield the known instant.
  const futurePart1 = normalized.geoRecords[0];
  const futurePart2 = normalized.geoRecords[1];
  assert.ok(futurePart1);
  assert.ok(futurePart2);

  for (const part of [futurePart1, futurePart2]) {
    assert.equal(part.topic, 'road_disruption');
    assert.equal(part.assertion_kind, 'plan', 'Future roadworks must be asserted as plan');
    assert.equal(part.record_status, 'planned', 'Pending or future disruptions must have planned status');
    assert.equal(part.valid_from, '2026-10-01T10:00:00.000Z');
    assert.equal(part.valid_to, '2026-10-09T18:00:00.000Z');
    assert.equal(validateGeoRecordGeography(part).valid, true);
  }

  // Geometry collection preservation: sub-part 1 is LineString, sub-part 2 is Point
  assert.equal(parseGeometryGeojson(futurePart1.geometry_geojson!).type, 'LineString');
  assert.equal(parseGeometryGeojson(futurePart2.geometry_geojson!).type, 'Point');

  // 2. Active roadworks feature (PRD:RWE:456)
  // Upstream: status 'Active', start 2026-09-28T09:00:00+10:00 -> 2026-09-27T23:00:00.000Z
  const activeRoad = normalized.geoRecords[2];
  assert.ok(activeRoad);
  assert.equal(activeRoad.topic, 'road_disruption');
  assert.equal(activeRoad.assertion_kind, 'plan');
  assert.equal(activeRoad.record_status, 'active');
  assert.equal(activeRoad.valid_from, '2026-09-27T23:00:00.000Z');
  assert.equal(activeRoad.valid_to, '2026-09-30T08:00:00.000Z');

  // 3. BigQuery View Emulation at reference time: 2026-09-29T12:00:00Z
  const refTimeBeforeStart = '2026-09-29T12:00:00Z' as UtcTimestamp;
  const history = queryViewHistory(normalized.geoRecords);
  const current = queryViewCurrent(history);
  const transportCurrent = queryViewTransportChangesCurrent(current, refTimeBeforeStart);

  // Verification: Future works must have time_state = 'future', not treated as current active congestion
  const futureInTransport = transportCurrent.filter((r) =>
    r.geo_record_id.startsWith('victoria.transport.road_planned:PRD:OneView:123'),
  );
  assert.equal(futureInTransport.length, 2);
  for (const row of futureInTransport) {
    assert.equal(
      row.time_state,
      'future',
      'Future disruptions (valid_from > now) must be flagged future, NOT current active congestion',
    );
    assert.equal(row.assertion_kind, 'plan');
    assert.equal(row.record_status, 'planned');
  }

  // Active works must have time_state = 'current'
  const activeInTransport = transportCurrent.find((r) =>
    r.geo_record_id.startsWith('victoria.transport.road_planned:PRD:RWE:456'),
  );
  assert.ok(activeInTransport);
  assert.equal(activeInTransport.time_state, 'current');

  // 4. Temporal progression: Check behavior during works and after works expire
  // During works: 2026-10-05T00:00:00Z
  const refTimeDuringWorks = '2026-10-05T00:00:00Z' as UtcTimestamp;
  const transportDuring = queryViewTransportChangesCurrent(current, refTimeDuringWorks);
  const duringWorksRow = transportDuring.find((r) =>
    r.geo_record_id.startsWith('victoria.transport.road_planned:PRD:OneView:123'),
  );
  assert.ok(duringWorksRow);
  assert.equal(duringWorksRow.time_state, 'current', 'In-progress works transition to time_state current');

  // After works expire: 2026-10-15T00:00:00Z
  const refTimeAfterExpiry = '2026-10-15T00:00:00Z' as UtcTimestamp;
  const transportAfter = queryViewTransportChangesCurrent(current, refTimeAfterExpiry);
  assert.equal(
    transportAfter.some((r) => r.geo_record_id.startsWith('victoria.transport.road_planned:PRD:OneView:123')),
    false,
    'Expired disruptions (valid_to <= now) must be excluded from v_transport_changes_current',
  );

  const timelineAfter = queryViewChangeTimeline(history, refTimeAfterExpiry);
  const endedTimelineRow = timelineAfter.find((r) =>
    r.geo_record_id.startsWith('victoria.transport.road_planned:PRD:OneView:123'),
  );
  assert.ok(endedTimelineRow);
  assert.equal(endedTimelineRow.time_state, 'ended', 'Expired disruptions transition to time_state ended in timeline');

  // 5. Invariant Checks: Duration errors & status validation
  const badDurationFeature = {
    ...page.data.features[0]!,
    properties: {
      ...page.data.features[0]!.properties,
      duration: { start: '2026-10-10T20:00:00+11:00', end: '2026-10-01T20:00:00+10:00' },
    },
  };
  assert.throws(
    () => normalizePlannedRoadSnapshot([badDurationFeature], input, fetchedAt),
    /Planned disruption ends before it starts/,
  );

  const badStatusFeature = {
    ...page.data.features[0]!,
    properties: {
      ...page.data.features[0]!.properties,
      status: 'UnknownStatus',
    },
  };
  assert.throws(
    () => normalizePlannedRoadSnapshot([badStatusFeature], input, fetchedAt),
    /Undocumented planned disruption status/,
  );
});

// ============================================================================
// Suite 3: GTFS Realtime Service Alerts with Static GTFS Join
// ============================================================================

test('US4 Suite 3: GTFS Realtime alerts join static stops without fabricating coordinates for routes or unknown stops', async () => {
  const staticData = await loadGtfsStaticFixture();
  const staticVersion: StaticGtfsVersion = {
    snapshot: staticData.snapshot,
    normalized: staticData.normalized,
  };
  const verifiedFeedVersion = staticData.normalized.feedVersion;
  assert.ok(verifiedFeedVersion, 'Static feed version must be present');

  const fetchedAt = '2026-09-28T00:08:00.000Z' as UtcTimestamp;
  const feedTimestamp = '2026-09-28T00:05:00.000Z' as UtcTimestamp;

  const validSelector: AlertSelector = {
    agencyId: '2',
    routeId: '2-FLI',
    routeType: 2,
    stopId: '19499', // Flinders Street Railway Station
    directionId: 0,
    tripId: 'TRIP-FLI-01',
    tripRouteId: '2-FLI',
    tripStartDate: null,
    tripStartTime: null,
  };

  function createAlertFeed(version: string | null, selectors: AlertSelector[]): ParsedAlertFeed {
    return {
      gtfsRealtimeVersion: '2.0',
      feedTimestamp,
      feedVersion: version,
      alerts: [
        {
          id: 'ALERT-M-17',
          activePeriods: [],
          communicationPeriods: [],
          impactPeriods: [{ start: feedTimestamp, end: '2026-09-28T01:30:00.000Z' }],
          selectors,
          cause: null,
          effect: 1, // NO_SERVICE
          header: 'Train disruption between Flinders Street and Craigieburn',
          description: 'Track works underway',
          url: 'https://transport.vic.gov.au/disruptions/M-17',
        },
      ],
    };
  }

  function normalizeRealtimeFeed(parsed: ParsedAlertFeed) {
    const input = parseConnectorInput({
      sourceId: REALTIME_SOURCE_ID,
      window: { kind: 'snapshot', revision: feedTimestamp },
      checkpoint: null,
      runId: 'gtfs-rt-run',
    });
    return normalizeAlertFeeds(
      [{ mode: 'metro_train', resourceUrl: 'https://example.test/metro', parsed, fetchedAt }],
      input,
    );
  }

  // 1. Exact Stop & Route Match in matching static feed version
  const exactFeed = createAlertFeed(verifiedFeedVersion, [validSelector]);
  const normExact = normalizeRealtimeFeed(exactFeed);
  const joinedExact = joinGtfsAlertLocations({
    alerts: normExact.geoRecords,
    alertSources: normExact.geoRecordSources,
    staticVersions: [staticVersion],
  });

  assert.equal(joinedExact.mappings.length, 1);
  const mappingExact = joinedExact.mappings[0]!;
  assert.equal(mappingExact.status, 'located');
  assert.deepEqual(mappingExact.stopIds, ['19499']);
  assert.deepEqual(mappingExact.routeIds, ['2-FLI']);

  const locatedGeo = joinedExact.geoRecords[0];
  assert.ok(locatedGeo);
  assert.equal(locatedGeo.location_role, 'event_site');
  assert.equal(locatedGeo.location_confidence, 'official_join');
  assert.equal(locatedGeo.centroid_lat, -37.8183);
  assert.equal(locatedGeo.centroid_lon, 144.9671);
  assert.equal(validateGeoRecordGeography(locatedGeo).valid, true);

  // Provenance contains static stop evidence
  assert.equal(
    joinedExact.geoRecordSources.some(
      (link) =>
        link.evidence_role === 'gtfs_static_stop_location' &&
        link.source_record_id === `${STATIC_SOURCE_ID}:stop:19499`,
    ),
    true,
  );

  // 2. Missing Static Mapping / Unknown Stop preserves alert entity without coordinates
  const unknownStopFeed = createAlertFeed(verifiedFeedVersion, [
    { ...validSelector, stopId: 'STOP-UNKNOWN-99999' },
  ]);
  const normUnknown = normalizeRealtimeFeed(unknownStopFeed);
  const joinedUnknown = joinGtfsAlertLocations({
    alerts: normUnknown.geoRecords,
    alertSources: normUnknown.geoRecordSources,
    staticVersions: [staticVersion],
  });

  assert.equal(joinedUnknown.mappings[0]?.status, 'unmapped');
  const unknownGeo = joinedUnknown.geoRecords[0];
  assert.ok(unknownGeo);
  assert.equal(unknownGeo.geometry_geojson, null, 'Must not invent coordinates for unmapped stop');
  assert.equal(unknownGeo.centroid_lat, null);
  assert.equal(unknownGeo.centroid_lon, null);
  assert.equal(validateGeoRecordGeography(unknownGeo).valid, true);

  // 3. Feed Version Mismatch preserves alert entity without coordinates
  const mismatchedVersionFeed = createAlertFeed('PTV_GTFS_DIFFERENT_UNVERIFIED', [validSelector]);
  const normMismatched = normalizeRealtimeFeed(mismatchedVersionFeed);
  const joinedMismatched = joinGtfsAlertLocations({
    alerts: normMismatched.geoRecords,
    alertSources: normMismatched.geoRecordSources,
    staticVersions: [staticVersion],
  });

  assert.equal(joinedMismatched.mappings[0]?.status, 'version_unverified');
  const mismatchedGeo = joinedMismatched.geoRecords[0];
  assert.ok(mismatchedGeo);
  assert.equal(mismatchedGeo.geometry_geojson, null);
  assert.equal(mismatchedGeo.centroid_lat, null);
  assert.equal(mismatchedGeo.centroid_lon, null);

  // 3b. Static GTFS with no verifiable feed_version must return 'version_unverified'
  // Case A: Normalized static GTFS has archive validator fallback ('archive-sha256:...') and empty feed_info
  const archiveVersion = 'archive-sha256:verified-http-archive';
  const unverifiedStaticSnapshot = { ...staticData.snapshot, feed_info: [] };
  const unverifiedStaticVersion: StaticGtfsVersion = {
    snapshot: unverifiedStaticSnapshot,
    normalized: normalizeGtfsSnapshot(
      unverifiedStaticSnapshot,
      parseConnectorInput({
        sourceId: STATIC_SOURCE_ID,
        window: { kind: 'snapshot', revision: 'latest' },
        checkpoint: null,
        runId: 'unverified-static-archive-run',
      }),
      '2026-09-28T00:06:00.000Z',
      { feedVersion: archiveVersion, tripStopMembershipComplete: false },
    ),
  };

  const alertWithArchiveFeed = createAlertFeed(archiveVersion, [validSelector]);
  const normArchiveAlert = normalizeRealtimeFeed(alertWithArchiveFeed);
  const joinedArchiveStatic = joinGtfsAlertLocations({
    alerts: normArchiveAlert.geoRecords,
    alertSources: normArchiveAlert.geoRecordSources,
    staticVersions: [unverifiedStaticVersion],
  });

  assert.equal(
    joinedArchiveStatic.mappings[0]?.status,
    'version_unverified',
    'Static GTFS with archive validator fallback has no verifiable feed_version and must return version_unverified',
  );
  assert.equal(joinedArchiveStatic.geoRecords[0]?.geometry_geojson, null);
  assert.equal(joinedArchiveStatic.geoRecords[0]?.centroid_lat, null);
  assert.equal(joinedArchiveStatic.geoRecords[0]?.centroid_lon, null);
  assert.equal(validateGeoRecordGeography(joinedArchiveStatic.geoRecords[0]!).valid, true);

  // Case B: Static GTFS with empty feed_info even when alert specifies verifiedFeedVersion
  const alertWithVerifiedFeed = createAlertFeed(verifiedFeedVersion, [validSelector]);
  const normVerifiedAlert = normalizeRealtimeFeed(alertWithVerifiedFeed);
  const joinedEmptyFeedInfo = joinGtfsAlertLocations({
    alerts: normVerifiedAlert.geoRecords,
    alertSources: normVerifiedAlert.geoRecordSources,
    staticVersions: [
      {
        ...staticVersion,
        snapshot: { ...staticData.snapshot, feed_info: [] },
      },
    ],
  });

  assert.equal(
    joinedEmptyFeedInfo.mappings[0]?.status,
    'version_unverified',
    'Static GTFS with empty feed_info has no verifiable feed_version and must return version_unverified',
  );
  assert.equal(joinedEmptyFeedInfo.geoRecords[0]?.geometry_geojson, null);
  assert.equal(joinedEmptyFeedInfo.geoRecords[0]?.centroid_lat, null);
  assert.equal(joinedEmptyFeedInfo.geoRecords[0]?.centroid_lon, null);

  // Case C: Static GTFS with blank feed_version in feed_info
  const joinedBlankFeedVersion = joinGtfsAlertLocations({
    alerts: normVerifiedAlert.geoRecords,
    alertSources: normVerifiedAlert.geoRecordSources,
    staticVersions: [
      {
        ...staticVersion,
        snapshot: {
          ...staticData.snapshot,
          feed_info: [{ ...staticData.snapshot.feed_info[0]!, feed_version: '   ' }],
        },
      },
    ],
  });
  assert.equal(
    joinedBlankFeedVersion.mappings[0]?.status,
    'version_unverified',
    'Static GTFS with blank feed_version in feed_info must return version_unverified',
  );
  assert.equal(joinedBlankFeedVersion.geoRecords[0]?.geometry_geojson, null);

  // 4. Route-Only Alert (no stopId) preserves alert entity without fabricating a point
  const routeOnlySelector: AlertSelector = {
    agencyId: '2',
    routeId: '2-FLI',
    routeType: 2,
    stopId: null,
    directionId: null,
    tripId: null,
    tripRouteId: null,
    tripStartDate: null,
    tripStartTime: null,
  };
  const routeOnlyFeed = createAlertFeed(verifiedFeedVersion, [routeOnlySelector]);
  const normRouteOnly = normalizeRealtimeFeed(routeOnlyFeed);
  const joinedRouteOnly = joinGtfsAlertLocations({
    alerts: normRouteOnly.geoRecords,
    alertSources: normRouteOnly.geoRecordSources,
    staticVersions: [staticVersion],
  });

  assert.equal(joinedRouteOnly.mappings[0]?.status, 'route_only');
  assert.deepEqual(joinedRouteOnly.mappings[0]?.routeIds, ['2-FLI']);
  assert.deepEqual(joinedRouteOnly.mappings[0]?.stopIds, []);
  const routeOnlyGeo = joinedRouteOnly.geoRecords[0];
  assert.ok(routeOnlyGeo);
  assert.equal(routeOnlyGeo.geometry_geojson, null, 'Entire route alert must not have a single point location fabricated');
  assert.equal(routeOnlyGeo.centroid_lat, null);
  assert.equal(routeOnlyGeo.centroid_lon, null);

  // 5. Mixed Route & Stop Selectors must not falsely locate the whole alert at one stop
  const mixedFeed = createAlertFeed(verifiedFeedVersion, [validSelector, routeOnlySelector]);
  const normMixed = normalizeRealtimeFeed(mixedFeed);
  const joinedMixed = joinGtfsAlertLocations({
    alerts: normMixed.geoRecords,
    alertSources: normMixed.geoRecordSources,
    staticVersions: [staticVersion],
  });

  assert.equal(
    joinedMixed.mappings[0]?.status,
    'ambiguous',
    'Mixed route and stop selectors must be marked ambiguous and not located to one point',
  );
  const mixedGeo = joinedMixed.geoRecords[0];
  assert.ok(mixedGeo);
  assert.equal(mixedGeo.geometry_geojson, null);
  assert.equal(mixedGeo.centroid_lat, null);
  assert.equal(mixedGeo.centroid_lon, null);

  // 6. Snapshot Omission vs Cancellation
  const previousFeed = exactFeed;
  const emptyCurrentFeed: ParsedAlertFeed = {
    ...exactFeed,
    feedTimestamp: '2026-09-28T00:15:00.000Z',
    alerts: [],
  };
  const snapshotDiff = compareFullGtfsSnapshots({
    previous: previousFeed,
    current: emptyCurrentFeed,
  });
  assert.deepEqual(snapshotDiff.disappearedAlertIds, ['ALERT-M-17']);
  assert.deepEqual(snapshotDiff.currentAlertIds, []);
});

// ============================================================================
// Suite 4: Incident Clearance & Emergency Events (tv_road_unplanned & VicEmergency)
// ============================================================================

test('US4 Suite 4: Incident clearance transitions to resolved; VicEmergency policy strictly gates unauthorized access', async () => {
  const inputRun1 = parseConnectorInput({
    sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:15:00Z' },
    checkpoint: '2026-09-28T00:00:00Z',
    runId: 'unplanned-run-1',
  });
  const fetchedAtRun1 = '2026-09-28T00:06:00Z' as UtcTimestamp;

  const page = await loadUnplannedRoadFixture();
  const normalizedRun1 = normalizeRoadSnapshot(page.data.features, inputRun1, fetchedAtRun1);

  // 1. Initial State: IMP-1 is Active, IMP-2 is Inactive (resolved)
  assert.equal(normalizedRun1.geoRecords.length, 2);
  const imp1 = normalizedRun1.geoRecords[0]!;
  const imp2 = normalizedRun1.geoRecords[1]!;

  assert.equal(imp1.record_status, 'active');
  assert.equal(imp1.assertion_kind, 'report');
  assert.equal(imp1.valid_to, null, 'Active incident remains open with null valid_to');

  assert.equal(imp2.record_status, 'resolved');
  assert.equal(imp2.valid_to, '2026-09-28T00:04:00.000Z', 'Resolved incident retains lastClosed as valid_to');

  const currentTime = '2026-09-28T00:10:00Z' as UtcTimestamp;
  const historyRun1 = queryViewHistory(normalizedRun1.geoRecords);
  const currentRun1 = queryViewCurrent(historyRun1);
  const transportCurrentRun1 = queryViewTransportChangesCurrent(currentRun1, currentTime);

  // Current view contains active incident, excludes resolved incident
  assert.equal(transportCurrentRun1.some((r) => r.geo_record_id === imp1.geo_record_id), true);
  assert.equal(
    transportCurrentRun1.some((r) => r.geo_record_id === imp2.geo_record_id),
    false,
    'Resolved incident MUST NOT appear in current disruptions view',
  );

  // Timeline view retains both with correct time_state
  const timelineRun1 = queryViewChangeTimeline(historyRun1, currentTime);
  const imp1Timeline = timelineRun1.find((r) => r.geo_record_id === imp1.geo_record_id);
  const imp2Timeline = timelineRun1.find((r) => r.geo_record_id === imp2.geo_record_id);
  assert.ok(imp1Timeline && imp2Timeline);
  assert.equal(imp1Timeline.time_state, 'current');
  assert.equal(imp2Timeline.time_state, 'resolved');

  // 2. Incident Clearance Transition (Run 2: IMP-1 is cleared)
  const inputRun2 = parseConnectorInput({
    sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'time', from: '2026-09-28T00:15:00Z', to: '2026-09-28T00:30:00Z' },
    checkpoint: '2026-09-28T00:15:00Z',
    runId: 'unplanned-run-2',
  });
  const fetchedAtRun2 = '2026-09-28T00:25:00Z' as UtcTimestamp;

  const clearedFeature = {
    ...page.data.features[0]!,
    properties: {
      ...page.data.features[0]!.properties,
      status: 'Inactive',
      eventLocationStatus: 'Inactive',
      lastClosed: '2026-09-28T00:20:00Z',
      lastUpdated: '2026-09-28T00:22:00Z',
      description: 'Lane reopened. Synthetic clearance variant 0',
    },
  };

  const normalizedRun2 = normalizeRoadSnapshot([clearedFeature], inputRun2, fetchedAtRun2);
  const imp1V2 = normalizedRun2.geoRecords[0]!;
  assert.equal(imp1V2.geo_record_id, imp1.geo_record_id);
  assert.equal(imp1V2.record_status, 'resolved');
  assert.equal(imp1V2.valid_to, '2026-09-28T00:20:00.000Z');

  // Verify version ordering and hash independence for clearance (G22):
  // This synthetic clearance has a smaller content hash than the active version.
  assert.ok(
    imp1V2.version_id.localeCompare(imp1.version_id) < 0,
    'Cleared version hash MUST be lexicographically smaller than active version to prove non-hash ordering',
  );
  assert.ok(
    imp1V2.source_updated_at! > imp1.source_updated_at!,
    'Cleared version has more recent source_updated_at than initial active version',
  );

  // After clearance: imp1 is removed from current views, retained in history.
  // NOTE: queryViewCurrent() is a test-local simulation helper for in-memory pipeline flow,
  // not real BigQuery SQL execution (which requires the opt-in Suite 7).
  // Comparators below are local fixture controls, not production mutations.
  const combinedHistory = queryViewHistory([...normalizedRun1.geoRecords, ...normalizedRun2.geoRecords]);
  const currentAfterClearance = queryViewCurrent(combinedHistory);
  const transportAfterClearance = queryViewTransportChangesCurrent(currentAfterClearance, '2026-09-28T00:30:00Z');

  assert.equal(
    transportAfterClearance.some((r) => r.geo_record_id === imp1.geo_record_id),
    false,
    'Cleared incident MUST be removed from v_transport_changes_current',
  );

  // Late-arriving older active version replay:
  // Replaying older active version imp1 after imp1V2 must NOT revive the incident in current views,
  // despite imp1 having a larger content hash.
  const delayedHistoryClearance = queryViewHistory([imp1V2, imp1]);
  const currentAfterDelayedClearance = queryViewCurrent(delayedHistoryClearance);
  assert.equal(
    currentAfterDelayedClearance.some((r) => r.geo_record_id === imp1.geo_record_id),
    false,
    'Delayed older active version MUST NOT revive cleared/resolved incident in current views',
  );
  const transportAfterDelayedClearance = queryViewTransportChangesCurrent(
    currentAfterDelayedClearance,
    '2026-09-28T00:30:00Z',
  );
  assert.equal(
    transportAfterDelayedClearance.some((r) => r.geo_record_id === imp1.geo_record_id),
    false,
    'Delayed older active version MUST NOT appear in v_transport_changes_current',
  );

  const timelineAfterClearance = queryViewChangeTimeline(combinedHistory, '2026-09-28T00:30:00Z');
  const imp1ClearedTimeline = timelineAfterClearance.find(
    (r) => r.geo_record_id === imp1.geo_record_id && r.version_id === imp1V2.version_id,
  );
  assert.ok(imp1ClearedTimeline);
  assert.equal(imp1ClearedTimeline.time_state, 'resolved');
  assert.equal(imp1ClearedTimeline.record_status, 'resolved');

  // --------------------------------------------------------------------------
  // Local comparator controls for the incident-clearance fixture. Suite 0
  // checks shipped SQL structure; Suite 7 is the real execution gate.
  // --------------------------------------------------------------------------
  const clearanceRecords = [imp1, imp1V2];

  // 1. Local contract ordering: imp1V2 has newer source_updated_at ('2026-09-28T00:22:00Z' > '2026-09-28T00:01:00Z'),
  // wins ROW_NUMBER() = 1, then lifecycle filter exits it from current view -> result is null (cleared).
  const canonicalClearance = selectLatestGeoRecord(clearanceRecords);
  assert.equal(
    canonicalClearance,
    null,
    'Local contract sorting must select resolved imp1V2 and exit it from current view',
  );

  // 2. Mutation 1: Broken naive hash sorting (ORDER BY version_id DESC).
  // Because the active version has the larger hash, hash sorting selects imp1.
  const mutatedClearanceByHash = selectLatestGeoRecord(clearanceRecords, {
    comparator: (a, b) => b.version_id.localeCompare(a.version_id),
  });
  assert.ok(mutatedClearanceByHash, 'Mutation sensitivity: broken hash sorting incorrectly yields an active record');
  assert.equal(
    mutatedClearanceByHash?.version_id,
    imp1.version_id,
    'Mutation sensitivity: broken hash sorting selects imp1 because its hash is larger',
  );
  assert.equal(
    mutatedClearanceByHash?.record_status,
    'active',
    'Mutation sensitivity: broken hash sorting fails to resolve incident and keeps it active',
  );
  assert.notEqual(
    canonicalClearance,
    mutatedClearanceByHash,
    'Canonical sorting MUST sensitively disagree with broken hash sorting',
  );

  // 3. Mutation 2: Broken pre-filtering lifecycle before ranking (WHERE status NOT IN ('resolved') ... QUALIFY ...).
  // Pre-filtering discards imp1V2 first, leaving imp1 (active) as the "winner", reviving the cleared incident!
  const mutatedClearanceByPreFilter = selectLatestGeoRecord(clearanceRecords, {
    filterLifecycleBeforeSort: true,
  });
  assert.ok(mutatedClearanceByPreFilter, 'Mutation sensitivity: broken pre-filtering incorrectly yields a record');
  assert.equal(
    mutatedClearanceByPreFilter?.record_status,
    'active',
    'Mutation sensitivity: filtering lifecycle before ROW_NUMBER() incorrectly revives older active incident',
  );
  assert.notEqual(
    canonicalClearance,
    mutatedClearanceByPreFilter,
    'Canonical sorting MUST sensitively disagree with broken pre-filter lifecycle mutation',
  );

  // 4. Mutation 3: Broken reverse chronological sorting (ORDER BY source_updated_at ASC).
  const mutatedClearanceByReverseTime = selectLatestGeoRecord(clearanceRecords, {
    comparator: (a, b) => a.source_updated_at!.localeCompare(b.source_updated_at!),
  });
  assert.equal(
    mutatedClearanceByReverseTime?.record_status,
    'active',
    'Mutation sensitivity: reverse chronological order incorrectly selects older active incident',
  );
  assert.notEqual(
    canonicalClearance,
    mutatedClearanceByReverseTime,
    'Canonical sorting MUST sensitively disagree with broken reverse-time sorting',
  );

  // 5. Test delayed arrival order: [imp1V2, imp1] vs [imp1, imp1V2] must yield identical canonical result
  const delayedCanonical = selectLatestGeoRecord([imp1V2, imp1]);
  assert.equal(
    delayedCanonical,
    null,
    'Delayed older version arrival order must not change canonical clearance result',
  );

  // 3. VicEmergency Policy Adherence
  // Read and verify policy documentation
  const policyCandidates = [
    new URL('../../../docs/source-policies/vic-emergency.md', import.meta.url),
    new URL('../../docs/source-policies/vic-emergency.md', import.meta.url),
  ];
  const policyUrl = policyCandidates.find((url) => existsSync(url)) ?? policyCandidates[0]!;
  const policyDoc = await readFile(policyUrl, 'utf8');
  assert.ok(policyDoc.includes('Decision: `review_required`'));
  assert.ok(policyDoc.includes('do not run T065 or scrape the website'));

  // Test rights gating: any unadmitted or review_required emergency record is blocked from publication
  const unauthorizedAlert: GeoRecord = {
    batch_id: 'unauth-emergency-run',
    source_id: 'victoria.emergency.alerts',
    schema_version: 1,
    fetched_at: '2026-09-28T00:00:00Z',
    geo_record_id: 'victoria.emergency.alerts:INC-001',
    version_id: 'v1',
    topic: 'road_disruption',
    assertion_kind: 'report',
    title: 'Bushfire warning',
    summary: 'Emergency warning for greater Melbourne',
    original_url: 'https://emergency.vic.gov.au',
    geometry_geojson: null,
    centroid_lat: null,
    centroid_lon: null,
    location_role: 'area_only',
    location_confidence: 'resolved_area',
    area_refs: ['ASGS_LGA:24600:2025'],
    published_at: '2026-09-28T00:00:00Z',
    observed_at: '2026-09-28T00:00:00Z',
    valid_from: '2026-09-28T00:00:00Z',
    valid_to: null,
    source_updated_at: '2026-09-28T00:00:00Z',
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'active',
    rights_status: 'review_required',
    public_query_allowed: false,
  };

  const gatedHistory = queryViewHistory([unauthorizedAlert], { enforceRightsFilter: true });
  assert.equal(gatedHistory.length, 0, 'review_required emergency sources must not leak into public history');

  // 4. Broad Emergency Warning Areas retain coarse area_only without fake coordinates
  // Valid broad warning area
  const broadWarning: GeoRecord = {
    ...unauthorizedAlert,
    rights_status: 'verified_open',
    public_query_allowed: true,
  };
  assert.equal(validateGeoRecordGeography(broadWarning).valid, true);

  // Reject fake point geometry for area_only warning
  const fakePointWarning: GeoRecord = {
    ...broadWarning,
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }),
    centroid_lat: -37.81,
    centroid_lon: 144.96,
  };
  const fakePointValidation = validateGeoRecordGeography(fakePointWarning);
  assert.equal(fakePointValidation.valid, false);
  assert.ok(
    fakePointValidation.issues.some((issue) =>
      issue.includes('Area-only location must not become a precise point'),
    ),
  );

  // Reject fabricated centroid without reliable geometry
  const fabricatedCentroidWarning: GeoRecord = {
    ...broadWarning,
    centroid_lat: -37.81,
    centroid_lon: 144.96,
  };
  const fabricatedCentroidValidation = validateGeoRecordGeography(fabricatedCentroidWarning);
  assert.equal(fabricatedCentroidValidation.valid, false);
  assert.ok(
    fabricatedCentroidValidation.issues.some((issue) =>
      issue.includes('Centroid requires reliable geometry'),
    ),
  );
});

// ============================================================================
// Suite 5: Planning Controls vs Transient Changes
// ============================================================================

test('US4 Suite 5: Long-term statutory planning controls stay distinct from transient roadworks or event closures', async () => {
  const fetchedAt = '2026-09-29T00:00:00Z' as UtcTimestamp;
  const layerEditedAt = '2026-03-31T00:00:00Z' as UtcTimestamp;

  // 1. Vicmap Planning Statutory Controls
  const vicmapFixture = await loadVicmapFixture();
  const zoneFeature = vicmapFixture.zone.collection.features[0];
  const overlayFeature = vicmapFixture.overlay.collection.features[0];
  assert.ok(zoneFeature && overlayFeature);

  const zoneControl = normalizePlanningControl(
    zoneFeature,
    vicmapLayers[1], // zone
    'vicmap-run',
    fetchedAt,
    layerEditedAt,
  );
  const overlayControl = normalizePlanningControl(
    overlayFeature,
    vicmapLayers[0], // overlay
    'vicmap-run',
    fetchedAt,
    layerEditedAt,
  );

  for (const control of [zoneControl, overlayControl]) {
    const geo = control.geoRecords[0];
    assert.ok(geo);
    assert.equal(geo.topic, 'planning');
    assert.equal(geo.assertion_kind, 'plan');
    assert.equal(geo.record_status, 'active');
    assert.equal(geo.location_role, 'area_only');
    assert.equal(geo.location_confidence, 'source_coordinate');
    assert.equal(geo.centroid_lat, null, 'Statutory planning polygons do not fabricate centroids');
    assert.equal(geo.centroid_lon, null);
    assert.equal(geo.valid_to, null, 'Statutory planning controls are enduring with open-ended valid_to');
    assert.equal(validateGeoRecordGeography(geo).valid, true);
  }

  // 2. Development Monitor Capital Projects
  const devFixture = await loadDevelopmentMonitorFixture();
  const mootedRaw = devFixture.results.find((r) => r.status.toLowerCase().includes('mooted')) ?? devFixture.results[0]!;
  const underConsRaw = devFixture.results.find((r) => r.status.toLowerCase().includes('construction')) ?? devFixture.results[1]!;
  const completedRaw = devFixture.results.find((r) => r.status.toLowerCase().includes('completed')) ?? devFixture.results[2]!;

  const mootedNorm = normalizeDevelopmentRecord(mootedRaw, 'dev-run', fetchedAt, layerEditedAt);
  const underConsNorm = normalizeDevelopmentRecord(underConsRaw, 'dev-run', fetchedAt, layerEditedAt);
  const completedNorm = normalizeDevelopmentRecord(completedRaw, 'dev-run', fetchedAt, layerEditedAt);

  assert.equal(mootedNorm.geoRecord.assertion_kind, 'plan');
  assert.equal(mootedNorm.geoRecord.record_status, 'planned');

  assert.equal(underConsNorm.geoRecord.assertion_kind, 'plan');
  assert.equal(underConsNorm.geoRecord.record_status, 'active');

  assert.equal(completedNorm.geoRecord.assertion_kind, 'observation');
  assert.equal(completedNorm.geoRecord.record_status, 'resolved');

  // 3. Domain Separation Across Views
  const plannedRoadPage = await loadPlannedRoadFixture();
  const roadNorm = normalizePlannedRoadSnapshot(
    plannedRoadPage.data.features,
    parseConnectorInput({
      sourceId: 'victoria.transport.road_planned',
      window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-10-15T00:00:00Z' },
      checkpoint: null,
      runId: 'road-run',
    }),
    fetchedAt,
  );

  const ticketFixture = await loadTicketmasterFixture();
  const eventNorm = normalizeTicketEvents(
    ticketFixture._embedded?.events ?? [],
    parseConnectorInput({
      sourceId: 'ticketmaster.events',
      window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      checkpoint: null,
      runId: 'ticket-run',
    }),
    fetchedAt,
  );

  const combinedRecords: GeoRecord[] = [
    ...zoneControl.geoRecords,
    ...overlayControl.geoRecords,
    mootedNorm.geoRecord,
    underConsNorm.geoRecord,
    completedNorm.geoRecord,
    ...roadNorm.geoRecords,
    ...eventNorm.geoRecords,
  ];

  const currentTime = '2026-09-29T12:00:00Z' as UtcTimestamp;
  const history = queryViewHistory(combinedRecords);
  const current = queryViewCurrent(history);

  // Verification 1: Planning view contains only planning records, never roadworks or events
  const planningView = queryViewPlanningChangesCurrent(current, currentTime);
  assert.ok(planningView.length >= 4);
  for (const row of planningView) {
    assert.equal(
      row.source_id === 'victoria.vicmap.planning' ||
        row.source_id === 'melbourne.development_monitor',
      true,
    );
    assert.notEqual(row.source_id, 'victoria.transport.road_planned');
    assert.notEqual(row.source_id, 'ticketmaster.events');
  }
  // Completed development project is excluded from current planning view
  assert.equal(
    planningView.some((r) => r.geo_record_id === completedNorm.geoRecord.geo_record_id),
    false,
  );

  // Verification 2: Transport view contains only disruptions, never statutory planning controls
  const transportView = queryViewTransportChangesCurrent(current, currentTime);
  for (const row of transportView) {
    assert.equal(row.topic, 'road_disruption');
    assert.notEqual(row.source_id, 'victoria.vicmap.planning');
    assert.notEqual(row.source_id, 'melbourne.development_monitor');
  }

  // Verification 3: Events view contains only events, never planning controls or road closures
  const eventsView = queryViewEventsCurrent(current, currentTime);
  for (const row of eventsView) {
    assert.equal(row.source_id, 'ticketmaster.events');
    assert.notEqual(row.source_id, 'victoria.vicmap.planning');
    assert.notEqual(row.source_id, 'victoria.transport.road_planned');
  }
});

// ============================================================================
// Suite 6: Integrated Multi-Domain Timeline & End-to-End Acceptance (US4)
// ============================================================================

test('US4 Suite 6: Cross-domain query partitions events, transport, planning, and historical lifecycles with full provenance', async () => {
  const refTime = '2026-10-01T12:00:00Z' as UtcTimestamp;

  // Ingest multi-domain records:
  // 1. Active Concert (starts 10:00, ends 14:00)
  const activeConcert: GeoRecord = {
    batch_id: 'event-batch-1',
    source_id: 'ticketmaster.events',
    schema_version: 1,
    fetched_at: '2026-09-28T00:00:00Z',
    geo_record_id: 'ticketmaster.events:EV-ACTIVE',
    version_id: 'ev-active-v1',
    topic: 'event',
    assertion_kind: 'plan',
    title: 'Melbourne CBD Live Music',
    summary: 'Active festival',
    original_url: 'https://ticketmaster.com.au/ev-active',
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.965, -37.815] }),
    centroid_lat: -37.815,
    centroid_lon: 144.965,
    location_role: 'event_site',
    location_confidence: 'source_coordinate',
    area_refs: ['ASGS_LGA:24600:2025'],
    published_at: null,
    observed_at: null,
    valid_from: '2026-10-01T10:00:00Z',
    valid_to: '2026-10-01T14:00:00Z',
    source_updated_at: null,
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'planned',
    rights_status: 'verified_open',
    public_query_allowed: true,
  };

  // 2. Future Rescheduled Concert (starts in November)
  const futureConcert: GeoRecord = {
    ...activeConcert,
    geo_record_id: 'ticketmaster.events:EV-RESCHEDULED',
    version_id: 'ev-resched-v2',
    title: 'Rescheduled Summer Fest',
    valid_from: '2026-11-15T10:00:00Z',
    valid_to: '2026-11-15T18:00:00Z',
  };

  // 3. Cancelled Concert
  const cancelledConcert: GeoRecord = {
    ...activeConcert,
    geo_record_id: 'ticketmaster.events:EV-CANCELLED',
    version_id: 'ev-cancel-v2',
    title: 'Cancelled Show',
    record_status: 'cancelled',
  };

  // 4. Future Planned Roadworks (starts 2026-10-05)
  const futureRoadworks: GeoRecord = {
    batch_id: 'road-batch-1',
    source_id: 'victoria.transport.road_planned',
    schema_version: 1,
    fetched_at: '2026-09-28T00:00:00Z',
    geo_record_id: 'victoria.transport.road_planned:PRD-001',
    version_id: 'prd-v1',
    topic: 'road_disruption',
    assertion_kind: 'plan',
    title: 'Planned Resurfacing',
    summary: 'Road resurfacing on La Trobe St',
    original_url: 'https://transport.vic.gov.au/planned',
    geometry_geojson: JSON.stringify({ type: 'LineString', coordinates: [[144.96, -37.81], [144.97, -37.81]] }),
    centroid_lat: null,
    centroid_lon: null,
    location_role: 'event_site',
    location_confidence: 'source_coordinate',
    area_refs: ['ASGS_LGA:24600:2025'],
    published_at: null,
    observed_at: null,
    valid_from: '2026-10-05T00:00:00Z',
    valid_to: '2026-10-10T00:00:00Z',
    source_updated_at: '2026-09-28T00:00:00Z',
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'planned',
    rights_status: 'verified_open',
    public_query_allowed: true,
  };

  // 5. Active Road Disruption (started 11:00, open-ended)
  const activeDisruption: GeoRecord = {
    batch_id: 'unplanned-batch-1',
    source_id: 'victoria.transport.road_unplanned',
    schema_version: 1,
    fetched_at: '2026-10-01T11:15:00Z',
    geo_record_id: 'victoria.transport.road_unplanned:RUD-001',
    version_id: 'rud-v1',
    topic: 'road_disruption',
    assertion_kind: 'report',
    title: 'Burst Water Main',
    summary: 'Water main burst on Collins St',
    original_url: 'https://transport.vic.gov.au/unplanned',
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.963, -37.816] }),
    centroid_lat: -37.816,
    centroid_lon: 144.963,
    location_role: 'event_site',
    location_confidence: 'source_coordinate',
    area_refs: ['ASGS_LGA:24600:2025'],
    published_at: null,
    observed_at: '2026-10-01T11:00:00Z',
    valid_from: '2026-10-01T11:00:00Z',
    valid_to: null,
    source_updated_at: '2026-10-01T11:05:00Z',
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'active',
    rights_status: 'verified_open',
    public_query_allowed: true,
  };

  // 6. Cleared Road Disruption (cleared at 11:30)
  const clearedDisruption: GeoRecord = {
    ...activeDisruption,
    geo_record_id: 'victoria.transport.road_unplanned:RUD-CLEARED',
    version_id: 'rud-cleared-v2',
    title: 'Cleared Incident',
    valid_to: '2026-10-01T11:30:00Z',
    record_status: 'resolved',
  };

  // 7. Located GTFS Transit Service Alert (active now)
  const gtfsAlert: GeoRecord = {
    batch_id: 'gtfs-batch-1',
    source_id: 'victoria.transport.gtfs_realtime',
    schema_version: 1,
    fetched_at: '2026-10-01T11:45:00Z',
    geo_record_id: 'victoria.transport.gtfs_realtime:alert:metro_train:M-17',
    version_id: 'gtfs-v1',
    topic: 'road_disruption',
    assertion_kind: 'report',
    title: 'Flinders Street Platform Disruption',
    summary: 'Platform maintenance',
    original_url: 'https://transport.vic.gov.au/disruptions',
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.9671, -37.8183] }),
    centroid_lat: -37.8183,
    centroid_lon: 144.9671,
    location_role: 'event_site',
    location_confidence: 'official_join',
    area_refs: ['ASGS_LGA:24600:2025'],
    published_at: null,
    observed_at: '2026-10-01T11:40:00Z',
    valid_from: '2026-10-01T11:30:00Z',
    valid_to: '2026-10-01T13:30:00Z',
    source_updated_at: '2026-10-01T11:40:00Z',
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'active',
    rights_status: 'verified_open',
    public_query_allowed: true,
  };

  // 8. Statutory Planning Zone (Commercial 1 Zone)
  const planningZone: GeoRecord = {
    batch_id: 'vicmap-batch-1',
    source_id: 'victoria.vicmap.planning',
    schema_version: 1,
    fetched_at: '2026-09-29T00:00:00Z',
    geo_record_id: 'victoria.vicmap.planning:zone:1001',
    version_id: 'zone-v1',
    topic: 'planning',
    assertion_kind: 'plan',
    title: 'Planning zone C1Z',
    summary: 'Commercial 1 Zone',
    original_url: 'https://discover.data.vic.gov.au/vicmap-planning',
    geometry_geojson: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[144.95, -37.82], [144.96, -37.82], [144.96, -37.81], [144.95, -37.81], [144.95, -37.82]]],
    }),
    centroid_lat: null,
    centroid_lon: null,
    location_role: 'area_only',
    location_confidence: 'source_coordinate',
    area_refs: ['vicmap_lga:24600'],
    published_at: null,
    observed_at: null,
    valid_from: '2006-01-19T00:00:00Z',
    valid_to: null,
    source_updated_at: '2026-03-31T00:00:00Z',
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'active',
    rights_status: 'verified_open',
    public_query_allowed: true,
  };

  // 9. Development Project Under Construction
  const devUnderConstruction: GeoRecord = {
    batch_id: 'dev-batch-1',
    source_id: 'melbourne.development_monitor',
    schema_version: 1,
    fetched_at: '2026-09-29T00:00:00Z',
    geo_record_id: 'melbourne.development_monitor:DEV-001',
    version_id: 'dev-v1',
    topic: 'planning',
    assertion_kind: 'plan',
    title: '500 Collins St Redevelopment',
    summary: 'Office tower construction',
    original_url: 'https://data.melbourne.vic.gov.au/dev-monitor',
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.961, -37.817] }),
    centroid_lat: -37.817,
    centroid_lon: 144.961,
    location_role: 'event_site',
    location_confidence: 'source_coordinate',
    area_refs: ['ASGS_LGA:24600:2025'],
    published_at: null,
    observed_at: null,
    valid_from: '2025-01-01T00:00:00Z',
    valid_to: null,
    source_updated_at: '2026-08-15T00:00:00Z',
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'active',
    rights_status: 'verified_open',
    public_query_allowed: true,
  };

  // 10. Completed Development Project
  const devCompleted: GeoRecord = {
    ...devUnderConstruction,
    geo_record_id: 'melbourne.development_monitor:DEV-COMPLETED',
    version_id: 'dev-comp-v1',
    title: 'Completed Residential Tower',
    assertion_kind: 'observation',
    record_status: 'resolved',
    valid_to: '2024-01-01T00:00:00Z',
  };

  const allRecords = [
    activeConcert,
    futureConcert,
    cancelledConcert,
    futureRoadworks,
    activeDisruption,
    clearedDisruption,
    gtfsAlert,
    planningZone,
    devUnderConstruction,
    devCompleted,
  ];

  for (const r of allRecords) {
    assert.equal(validateGeoRecordGeography(r).valid, true);
  }

  // View Emulation Queries at refTime (2026-10-01T12:00:00Z)
  const history = queryViewHistory(allRecords);
  assert.equal(history.length, 10);

  const current = queryViewCurrent(history);
  // Current view must exclude cancelled, resolved, and ended records:
  // Excluded: cancelledConcert (cancelled), clearedDisruption (resolved), devCompleted (resolved)
  assert.equal(current.length, 7);
  assert.equal(current.some((r) => r.geo_record_id === cancelledConcert.geo_record_id), false);
  assert.equal(current.some((r) => r.geo_record_id === clearedDisruption.geo_record_id), false);
  assert.equal(current.some((r) => r.geo_record_id === devCompleted.geo_record_id), false);

  // 1. Current Events View
  const eventsCurrent = queryViewEventsCurrent(current, refTime);
  assert.equal(eventsCurrent.length, 2);
  const activeEvRow = eventsCurrent.find((r) => r.geo_record_id === activeConcert.geo_record_id);
  const futureEvRow = eventsCurrent.find((r) => r.geo_record_id === futureConcert.geo_record_id);
  assert.ok(activeEvRow && futureEvRow);
  assert.equal(activeEvRow.time_state, 'current');
  assert.equal(futureEvRow.time_state, 'future');

  // 2. Current Transport Changes View
  const transportCurrent = queryViewTransportChangesCurrent(current, refTime);
  assert.equal(transportCurrent.length, 3);
  const futureRwRow = transportCurrent.find((r) => r.geo_record_id === futureRoadworks.geo_record_id);
  const activeDisRow = transportCurrent.find((r) => r.geo_record_id === activeDisruption.geo_record_id);
  const gtfsAlertRow = transportCurrent.find((r) => r.geo_record_id === gtfsAlert.geo_record_id);
  assert.ok(futureRwRow && activeDisRow && gtfsAlertRow);
  assert.equal(futureRwRow.time_state, 'future', 'Future roadworks must be time_state future');
  assert.equal(activeDisRow.time_state, 'current');
  assert.equal(gtfsAlertRow.time_state, 'current');

  // 3. Current Planning Changes View
  const planningCurrent = queryViewPlanningChangesCurrent(current, refTime);
  assert.equal(planningCurrent.length, 2);
  const zoneRow = planningCurrent.find((r) => r.geo_record_id === planningZone.geo_record_id);
  const devRow = planningCurrent.find((r) => r.geo_record_id === devUnderConstruction.geo_record_id);
  assert.ok(zoneRow && devRow);
  assert.equal(zoneRow.time_state, 'current');
  assert.equal(devRow.time_state, 'current');

  // 4. Change Timeline View (All 10 records with exact time states)
  const timeline = queryViewChangeTimeline(history, refTime);
  assert.equal(timeline.length, 10);

  const timeStateMap = new Map(timeline.map((r) => [r.geo_record_id, r.time_state]));
  assert.equal(timeStateMap.get(activeConcert.geo_record_id), 'current');
  assert.equal(timeStateMap.get(futureConcert.geo_record_id), 'future');
  assert.equal(timeStateMap.get(cancelledConcert.geo_record_id), 'cancelled');
  assert.equal(timeStateMap.get(futureRoadworks.geo_record_id), 'future');
  assert.equal(timeStateMap.get(activeDisruption.geo_record_id), 'current');
  assert.equal(timeStateMap.get(clearedDisruption.geo_record_id), 'resolved');
  assert.equal(timeStateMap.get(gtfsAlert.geo_record_id), 'current');
  assert.equal(timeStateMap.get(planningZone.geo_record_id), 'current');
  assert.equal(timeStateMap.get(devUnderConstruction.geo_record_id), 'current');
  assert.equal(timeStateMap.get(devCompleted.geo_record_id), 'resolved');

  // 5. Full Provenance Traceability
  for (const row of timeline) {
    assert.ok(row.geo_record_id, 'Must have geo_record_id');
    assert.ok(row.version_id, 'Must have version_id');
    assert.ok(row.source_id, 'Must have source_id');
    assert.ok(row.batch_id, 'Must have batch_id');
    assert.ok(row.fetched_at, 'Must have fetched_at');
    assert.ok(row.record_status, 'Must have record_status');
    assert.ok(row.assertion_kind, 'Must have assertion_kind');
  }
});

// ============================================================================
// Suite 7: GoogleSQL GCP Live Acceptance (Opt-in via env var)
// ============================================================================
const devProject = process.env.MELENS_PUBLISH_TEST_PROJECT;
test('US4 Suite 7: GCP acceptance - real GoogleSQL view execution on BigQuery', {
  skip: !devProject || process.env.MELENS_PUBLISH_TEST_ALLOW_CREATE !== '1'
    ? 'pending GCP verification (requires MELENS_PUBLISH_TEST_PROJECT and MELENS_PUBLISH_TEST_ALLOW_CREATE=1)'
    : false,
  timeout: 1_800_000,
}, async () => {
  assert.ok(devProject);
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const cloudConfig: DataConfig = {
    projectId: devProject,
    region: 'australia-southeast2',
    bucketName: `melens-changes-test-${id}`,
    ingestDataset: `changes_test_${id}`,
    queryDataset: `changes_views_${id}`,
    secretNames: [],
  };
  const bq = new BigQuery({ projectId: devProject, location: cloudConfig.region });
  const storage = new Storage({ projectId: devProject });
  const store = new GcsStore(storage, cloudConfig.bucketName);
  const publisher = new BigQueryPublisher(cloudConfig, bq, store);
  const createdDatasets: string[] = [];
  let createdBucket = false;

  const query = async (sql: string, params: Record<string, unknown> = {}) => {
    const [rows] = await bq.query({ query: sql, params, location: cloudConfig.region, maximumBytesBilled: '100000000' });
    return z.array(z.record(z.string(), z.unknown())).parse(rows);
  };

  try {
    for (const name of [cloudConfig.ingestDataset, cloudConfig.queryDataset]) {
      await bq.createDataset(name, { location: cloudConfig.region });
      createdDatasets.push(name);
    }
    await storage.createBucket(cloudConfig.bucketName, {
      location: cloudConfig.region,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      softDeletePolicy: { retentionDurationSeconds: 0 },
    });
    createdBucket = true;

    const qualify = (sql: string) => sql
      .replaceAll('`melens_ingest.', `\`${devProject}.${cloudConfig.ingestDataset}.`)
      .replaceAll('`melens_query.', `\`${devProject}.${cloudConfig.queryDataset}.`);

    await query(qualify(await readSql('001_tables.sql')));
    await query(qualify(await readSql('002_core_views.sql')));
    await query(qualify(await readSql('007_changes_views.sql')));

    // Admitted Ticketmaster source definition
    const admittedSource = await getAdmittedTicketmasterSource();

    // 1. Initial event publication (Version 1)
    const fixture = await loadTicketmasterFixture();
    const rawEv1 = fixture._embedded?.events?.[0];
    assert.ok(rawEv1, 'Fixture must contain event');

    const input1 = parseConnectorInput({
      sourceId: admittedSource.source_id,
      window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      checkpoint: null,
      runId: `gcp-run-1-${id}`,
    });
    const fetchedAt1 = '2026-09-28T00:00:00Z' as UtcTimestamp;
    const norm1 = normalizeTicketEvents([rawEv1], input1, fetchedAt1);
    const ev1V1 = norm1.geoRecords[0]!;
    const ev1V1_versioned: GeoRecord = {
      ...ev1V1,
      rights_status: 'verified_open',
      public_query_allowed: true,
      source_updated_at: '2026-09-28T00:00:00Z',
      source_version_ordinal: 1,
    };
    const batch1Success = toSuccess(admittedSource.source_id, `gcp-run-1-${id}`, fetchedAt1, {
      sourceRecords: norm1.sourceRecords.map((r) => ({
        ...r,
        source_updated_at: '2026-09-28T00:00:00Z',
        source_version_ordinal: 1,
      })),
      geoRecords: [ev1V1_versioned],
      geoRecordSources: norm1.geoRecordSources,
    });

    const publishedBatch1 = await publisher.publish({
      source: admittedSource,
      result: batch1Success,
      windowFrom: '2026-10-01T00:00:00Z',
      windowTo: '2026-10-05T00:00:00Z',
      initialCheckpoint: '2026-10-01T00:00:00Z',
    });
    assert.equal(publishedBatch1.state, 'published');

    // Verify v_geo_records_current returns Version 1
    const currentRowsV1 = await query(
      `SELECT geo_record_id, version_id, record_status FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @id`,
      { id: ev1V1.geo_record_id },
    );
    assert.equal(currentRowsV1.length, 1);
    assert.equal(currentRowsV1[0]?.version_id, ev1V1.version_id);
    assert.equal(currentRowsV1[0]?.record_status, 'planned');

    // 2. Ambiguity check: Attempting to publish unversioned multiple versions MUST fail closed in BigQuery validation gate
    const input2Ambiguous = parseConnectorInput({
      sourceId: admittedSource.source_id,
      window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      checkpoint: '2026-10-05T00:00:00Z',
      runId: `gcp-run-2-ambiguous-${id}`,
    });
    const fetchedAt2 = '2026-09-29T00:00:00Z' as UtcTimestamp;
    const cancelledEv1 = {
      ...rawEv1,
      name: 'Example Melbourne Concert cancelled notice 2',
      dates: { ...rawEv1.dates, status: { code: 'canceled' } },
    };
    const norm2 = normalizeTicketEvents([cancelledEv1], input2Ambiguous, fetchedAt2);
    const ev1V2 = norm2.geoRecords[0]!;

    // ev1V2 is unversioned (both source_updated_at and ordinal null)
    const batch2AmbiguousSuccess = toSuccess(admittedSource.source_id, `gcp-run-2-ambiguous-${id}`, fetchedAt2, {
      sourceRecords: norm2.sourceRecords,
      geoRecords: norm2.geoRecords.map((r) => ({
        ...r,
        rights_status: 'verified_open',
        public_query_allowed: true,
      })),
      geoRecordSources: norm2.geoRecordSources,
    });
    await assert.rejects(
      publisher.publish({
        source: admittedSource,
        result: batch2AmbiguousSuccess,
        windowFrom: '2026-10-01T00:00:00Z',
        windowTo: '2026-10-05T00:00:00Z',
        initialCheckpoint: '2026-10-05T00:00:00Z',
      }),
      /validation failed/i,
      'Ambiguous unversioned updates must be rejected by BigQuery publisher gate',
    );

    // Verify ambiguous version was not published and v1 remains visible
    const currentRowsAfterAmbiguous = await query(
      `SELECT geo_record_id, version_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @id`,
      { id: ev1V1.geo_record_id },
    );
    assert.equal(currentRowsAfterAmbiguous.length, 1);
    assert.equal(currentRowsAfterAmbiguous[0]?.version_id, ev1V1.version_id);

    // 3. Publishing cancellation with version ordering evidence (lexicographically smaller hash)
    assert.ok(ev1V2.version_id.localeCompare(ev1V1.version_id) < 0, 'Cancelled version has smaller hash');
    const ev1V2_versioned: GeoRecord = {
      ...ev1V2,
      rights_status: 'verified_open',
      public_query_allowed: true,
      source_updated_at: '2026-09-29T00:00:00Z',
      source_version_ordinal: 2,
    };
    const batch2VersionedSuccess = toSuccess(admittedSource.source_id, `gcp-run-2-versioned-${id}`, fetchedAt2, {
      sourceRecords: norm2.sourceRecords.map((r) => ({
        ...r,
        source_updated_at: '2026-09-29T00:00:00Z',
        source_version_ordinal: 2,
      })),
      geoRecords: [ev1V2_versioned],
      geoRecordSources: norm2.geoRecordSources,
    });
    const publishedBatch2 = await publisher.publish({
      source: admittedSource,
      result: batch2VersionedSuccess,
      windowFrom: '2026-10-01T00:00:00Z',
      windowTo: '2026-10-05T00:00:00Z',
      initialCheckpoint: '2026-10-05T00:00:00Z',
    });
    assert.equal(publishedBatch2.state, 'published');

    // 4. In BigQuery GoogleSQL views:
    // v_geo_records_current must exclude cancelled record (even with smaller hash!)
    const currentRowsCancelled = await query(
      `SELECT geo_record_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @id`,
      { id: ev1V1.geo_record_id },
    );
    assert.equal(currentRowsCancelled.length, 0, 'Cancelled event must exit v_geo_records_current despite smaller hash');

    // v_geo_records_history strictly retains both versions
    const historyRows = await query(
      `SELECT version_id, record_status FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_history\` WHERE geo_record_id = @id ORDER BY version_id`,
      { id: ev1V1.geo_record_id },
    );
    assert.equal(historyRows.length, 2, 'History retains all versions');

    // v_change_timeline reflects cancelled time_state
    const timelineRows = await query(
      `SELECT version_id, time_state, record_status FROM \`${devProject}.${cloudConfig.queryDataset}.v_change_timeline\` WHERE geo_record_id = @id AND version_id = @v2`,
      { id: ev1V1.geo_record_id, v2: ev1V2.version_id },
    );
    assert.equal(timelineRows.length, 1);
    assert.equal(timelineRows[0]?.time_state, 'cancelled');

    // 5. Late-arriving older version replayed in subsequent batch must NOT revive the record
    const lateOlderSuccess = toSuccess(admittedSource.source_id, `gcp-run-late-replay-${id}`, '2026-09-30T00:00:00Z' as UtcTimestamp, {
      sourceRecords: norm1.sourceRecords.map((r) => ({
        ...r,
        source_updated_at: '2026-09-28T00:00:00Z',
        source_version_ordinal: 1,
      })),
      geoRecords: [ev1V1_versioned],
      geoRecordSources: norm1.geoRecordSources,
    });
    await publisher.publish({
      source: admittedSource,
      result: lateOlderSuccess,
      windowFrom: '2026-10-01T00:00:00Z',
      windowTo: '2026-10-05T00:00:00Z',
      initialCheckpoint: '2026-10-05T00:00:00Z',
    });

    const currentRowsAfterLate = await query(
      `SELECT geo_record_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @id`,
      { id: ev1V1.geo_record_id },
    );
    assert.equal(currentRowsAfterLate.length, 0, 'Late arriving older version must NOT revive cancelled record');
  } finally {
    await Promise.allSettled([
      ...createdDatasets.map((name) => bq.dataset(name).delete({ force: true })),
      ...(createdBucket
        ? [
            (async () => {
              const bucket = storage.bucket(cloudConfig.bucketName);
              await bucket.deleteFiles({ force: true });
              await bucket.delete();
            })(),
          ]
        : []),
    ]);
  }
});
