import { z } from 'zod';
import { readFile } from 'node:fs/promises';

import type { DataConfig } from '../core/config.js';
import type { ConnectorSuccess } from '../core/connector.js';
import type { LicenseStatus, ParkingSensorMembership, SourceRecord } from '../core/types.js';
import { parseSourceManifest } from '../core/registry.js';
import { SUPERSEDED_PARKING_MEMBERSHIP_SECONDS } from '../core/source-retention.js';
import { sourceVersionId } from '../validation/record.js';

const sourceId = 'melbourne.parking.sensors';
const nonEmpty = z.string().trim().min(1);
export const maximumParkingHistory = 50_000;
export const parkingRuntimeHistorySchema = z.array(z.object({
  sensor_id: z.string().regex(/^kerbside:\S+$/),
  business_source_record_id: nonEmpty,
  business_state_hash: nonEmpty,
  business_version_id: nonEmpty,
  business_batch_id: nonEmpty,
}).strict()).max(maximumParkingHistory).superRefine((rows, context) => {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (seen.has(row.sensor_id)) context.addIssue({ code: 'custom', path: [index],
      message: 'Multiple published current versions for one parking sensor' });
    seen.add(row.sensor_id);
    if (row.business_source_record_id !== `${sourceId}:${row.sensor_id}`) {
      context.addIssue({ code: 'custom', path: [index], message: 'Unexpected parking business record identity' });
    }
  }
});

export type ParkingRuntimeHistoryEntry = z.infer<typeof parkingRuntimeHistorySchema>[number];

// This narrow reader lets local tests exercise the recovery path without an
// SDK instance or Application Default Credentials.
export interface ParkingHistoryReader {
  query(options: { query: string; params: Record<string, string>; location: string;
    maximumBytesBilled: string }): Promise<readonly [unknown, ...unknown[]]>;
}

const count = z.string().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().min(0).max(maximumParkingHistory));
const latestSnapshotSchema = z.array(z.object({ batch_id: nonEmpty,
  source_revision: nonEmpty, input_count: count, output_count: count,
}).strict()).max(1);
const recoveredSnapshotSchema = z.array(z.object({ proof_count: count,
  member_count: count, history: parkingRuntimeHistorySchema,
}).strict()).length(1);

/** Persist full snapshot membership and individual refresh clocks, plus changed business facts. */
export function assembleParkingRuntime(input: {
  result: ConnectorSuccess;
  history: readonly ParkingRuntimeHistoryEntry[];
  licenseStatus: LicenseStatus;
}): ConnectorSuccess & { parkingSensorMemberships: readonly ParkingSensorMembership[] } {
  const { result } = input;
  if (result.sourceId !== sourceId) throw new Error('Parking runtime requires the parking sensor source');
  if (result.sourceRecords.length !== result.inputCount || result.geoRecords.length !== result.inputCount) {
    throw new Error('Parking runtime requires all source facts and sensor sites from a complete snapshot');
  }
  const history = new Map(parkingRuntimeHistorySchema.parse(input.history).map(row => [row.sensor_id, row]));
  const current = result.sourceRecords.map(record => {
    const prefix = `${sourceId}:`;
    if (!record.source_record_id.startsWith(prefix)) throw new Error('Unexpected parking snapshot record');
    const sensorId = record.source_record_id.slice(prefix.length);
    if (!/^kerbside:\S+$/.test(sensorId)) throw new Error('Invalid parking sensor identity');
    const old = history.get(sensorId);
    const changed = old === undefined || old.business_source_record_id !== record.source_record_id
      || old.business_state_hash !== record.version_id;
    const businessVersionId = changed ? sourceVersionId(record.source_updated_at, {
      policy: 'parking-sensor-business-generation-v1', business_state_hash: record.version_id,
      previous_business_version_id: old?.business_version_id ?? null,
    }) : old.business_version_id;
    return { record, sensorId, changed, businessVersionId,
      businessBatchId: changed ? result.runId : old.business_batch_id };
  });
  if (new Set(current.map(row => row.sensorId)).size !== current.length) {
    throw new Error('Duplicate sensors cannot establish a complete parking snapshot');
  }
  const proofId = `${sourceId}:snapshot:${result.fetchedAt}`;
  const proofVersion = sourceVersionId(result.sourceLatestUpdateAt, {
    policy: 'complete-parking-sensor-snapshot-v1', fetched_at: result.fetchedAt,
    input_count: result.inputCount,
    members: current.map(row => ({ sensor_id: row.sensorId,
      business_source_record_id: row.record.source_record_id,
      business_version_id: row.businessVersionId, business_state_hash: row.record.version_id,
      business_batch_id: row.businessBatchId,
      source_updated_at: row.record.source_updated_at }))
      .sort((a, b) => a.sensor_id.localeCompare(b.sensor_id)),
  });
  const proof: SourceRecord = {
    source_id: sourceId, batch_id: result.runId, schema_version: 1,
    fetched_at: result.fetchedAt, source_record_id: proofId, version_id: proofVersion,
    original_url: 'https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/',
    raw_uri: null, published_at: null, observed_at: null, first_accessible_at: result.fetchedAt,
    time_missing_reason: 'Complete sensor snapshot proof has no independent occupancy observation time',
    valid_from: null, valid_to: null, source_updated_at: result.sourceLatestUpdateAt,
    source_version_ordinal: null, record_status: 'active', assertion_kind: 'observation',
    rights_status: input.licenseStatus,
  };
  const memberships: ParkingSensorMembership[] = current.map(row => ({
    source_id: sourceId, batch_id: result.runId, schema_version: 1, fetched_at: result.fetchedAt,
    sensor_id: row.sensorId,
    version_id: sourceVersionId(row.record.source_updated_at, {
      sensor_id: row.sensorId, business_source_record_id: row.record.source_record_id,
      business_version_id: row.businessVersionId, business_state_hash: row.record.version_id,
      business_batch_id: row.businessBatchId,
      snapshot_source_record_id: proofId, snapshot_version_id: proofVersion,
    }),
    snapshot_source_record_id: proofId, snapshot_version_id: proofVersion,
    business_source_record_id: row.record.source_record_id,
    business_version_id: row.businessVersionId, business_state_hash: row.record.version_id,
    business_batch_id: row.businessBatchId,
    source_updated_at: row.record.source_updated_at,
  }));
  const changedKeys = new Set(current.filter(row => row.changed).map(row =>
    `${row.record.source_record_id}\n${row.record.version_id}`));
  const isChanged = (recordId: string, versionId: string) => changedKeys.has(`${recordId}\n${versionId}`);
  const versions = new Map(current.map(row => [row.record.source_record_id, row.businessVersionId]));
  const version = (recordId: string): string => {
    const value = versions.get(recordId);
    if (value === undefined) throw new Error('Business facts must belong to the complete parking snapshot');
    return value;
  };
  const changedFacts = current.filter(row => row.changed).map(row => ({ ...row.record,
    version_id: row.businessVersionId }));
  return { ...result, sourceRevision: proofVersion, outputCount: memberships.length,
    sourceRecords: [...changedFacts, proof],
    geoRecords: result.geoRecords.filter(row => isChanged(row.geo_record_id, row.version_id))
      .map(row => ({ ...row, version_id: version(row.geo_record_id) })),
    parkingObservations: result.parkingObservations.filter(row => isChanged(row.source_record_id, row.version_id))
      .map(row => ({ ...row, version_id: version(row.source_record_id) })),
    geoRecordSources: result.geoRecordSources.filter(row => isChanged(row.source_record_id, row.source_version_id))
      .map(row => ({ ...row, version_id: version(row.source_record_id), source_version_id: version(row.source_record_id) })),
    parkingSensorMemberships: memberships,
  };
}

/** Restore only the latest snapshot's exact published business references. */
export async function withPublishedParkingState(result: ConnectorSuccess,
  config: DataConfig, bigquery: ParkingHistoryReader): Promise<ConnectorSuccess> {
  if (result.sourceId !== sourceId) return result;
  if (!config.maxBytesBilled) throw new Error('Parking history requires a billed-byte ceiling');
  const maximumBytesBilled = config.maxBytesBilled;
  const table = (name: string) => `\`${config.projectId}.${config.ingestDataset}.${name}\``;
  const query = async (sql: string, params: Record<string, string>) => {
    try {
      const [rows] = await bigquery.query({ query: sql, params, location: config.region,
        maximumBytesBilled });
      return rows;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Parking published state query failed');
    }
  };
  // Resolve a bounded constant batch ID before reading the clustered membership
  // table. A dynamic join to latest_snapshot cannot guarantee block pruning.
  const latest = latestSnapshotSchema.parse(await query(`/* latest-published-parking-snapshot */
    WITH states AS (
      SELECT batch_id, source_revision, input_count, output_count, state, published_at, started_at
      FROM ${table('sync_batches')} WHERE source_id = @sourceId
      QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC) = 1
    )
    SELECT batch_id, source_revision, CAST(input_count AS STRING) AS input_count,
      CAST(output_count AS STRING) AS output_count
    FROM states WHERE state = 'published' AND published_at IS NOT NULL
    ORDER BY started_at DESC, batch_id DESC LIMIT 1`, { sourceId }))[0];
  let history: ParkingRuntimeHistoryEntry[] = [];
  if (latest !== undefined) {
    if (latest.input_count !== latest.output_count) {
      throw new Error('Published parking snapshot must account for every input sensor');
    }
    const recovered = recoveredSnapshotSchema.parse(await query(`/* recover-published-parking-business-state */
          WITH members AS (
            SELECT sensor_id, business_source_record_id, business_state_hash, business_version_id,
              business_batch_id, snapshot_source_record_id, snapshot_version_id
            FROM ${table('parking_sensor_memberships')}
            WHERE source_id = @sourceId AND batch_id = @batchId
          ), records AS (
            SELECT source_record_id, version_id, batch_id,
              ANY_VALUE(record_status) AS record_status, ANY_VALUE(rights_status) AS rights_status,
              COUNT(DISTINCT TO_JSON_STRING(STRUCT(record_status, rights_status))) AS status_variants
            FROM ${table('source_records')}
            WHERE source_id = @sourceId AND (batch_id = @batchId
              OR batch_id IN (SELECT business_batch_id FROM members))
            GROUP BY source_record_id, version_id, batch_id
          ), proof AS (
            SELECT source_record_id, version_id FROM records
            WHERE batch_id = @batchId AND version_id = @sourceRevision
              AND STARTS_WITH(source_record_id, CONCAT(@sourceId, ':snapshot:'))
              AND rights_status IN ('verified_open', 'restricted') AND record_status = 'active'
              AND status_variants = 1
          ), states AS (
            SELECT batch_id, state, published_at FROM ${table('sync_batches')}
            WHERE source_id = @sourceId AND batch_id IN (SELECT business_batch_id FROM members)
            QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC) = 1
          )
          SELECT CAST((SELECT COUNT(*) FROM proof) AS STRING) AS proof_count,
            CAST((SELECT COUNT(*) FROM members) AS STRING) AS member_count,
            ARRAY(SELECT AS STRUCT m.sensor_id, m.business_source_record_id, m.business_state_hash,
              m.business_version_id, m.business_batch_id
              FROM members m JOIN proof p ON p.source_record_id = m.snapshot_source_record_id
                AND p.version_id = m.snapshot_version_id
              JOIN states b ON b.batch_id = m.business_batch_id
                AND b.state = 'published' AND b.published_at IS NOT NULL
              JOIN records r ON r.batch_id = m.business_batch_id
                AND r.source_record_id = m.business_source_record_id AND r.version_id = m.business_version_id
                AND r.rights_status IN ('verified_open', 'restricted') AND r.record_status IN ('active', 'corrected')
                AND r.status_variants = 1
              ORDER BY m.sensor_id LIMIT ${maximumParkingHistory + 1}) AS history`,
    { sourceId, batchId: latest.batch_id, sourceRevision: latest.source_revision }))[0];
    if (recovered === undefined || recovered.proof_count !== 1
      || recovered.member_count !== latest.output_count || recovered.history.length !== latest.output_count) {
      throw new Error('Published parking snapshot proof or exact business references are incomplete');
    }
    history = recovered.history;
  }
  const declaration = parseSourceManifest(JSON.parse(await readFile(
    new URL('../connectors/com_parking_sensors/source.json', import.meta.url), 'utf8')));
  return assembleParkingRuntime({ result, history, licenseStatus: declaration.license_status });
}

/**
 * Remove membership rows of snapshots that a newer published snapshot has
 * superseded. Every two-minute run writes one row per sensor, and the current
 * views join this table without block pruning, so leaving superseded snapshots
 * in place makes every current-records query scan more each run.
 * The fetched_at floor keeps this frequent delete to recent partitions; the
 * retention job clears anything older one day at a time.
 */
export async function pruneSupersededParkingMemberships(config: DataConfig,
  bigquery: ParkingHistoryReader, publishedBatchId: string, now = new Date()): Promise<void> {
  if (!config.maxBytesBilled) throw new Error('Parking membership pruning requires a billed-byte ceiling');
  nonEmpty.parse(publishedBatchId);
  const cutoff = new Date(now.getTime() - SUPERSEDED_PARKING_MEMBERSHIP_SECONDS * 1000).toISOString();
  const floor = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  await bigquery.query({ query: `/* prune-superseded-parking-memberships */
    DELETE FROM \`${config.projectId}.${config.ingestDataset}.parking_sensor_memberships\`
    WHERE source_id = @sourceId AND batch_id != @batchId
      AND fetched_at >= TIMESTAMP(@floor) AND fetched_at < TIMESTAMP(@cutoff)`,
  params: { sourceId, batchId: publishedBatchId, floor, cutoff },
  location: config.region, maximumBytesBilled: config.maxBytesBilled });
}
