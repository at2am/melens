import { z } from 'zod';

import type { Connector, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { OpenDataSoftClient } from '../../core/opendatasoft.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';
import { parseBoundaryGeometry } from '../../validation/geography.js';
import type { Boundary, SourceRecord } from '../../core/types.js';

const SOURCE_ID = 'melbourne.municipal_boundary';
const LANDING_URL = 'https://data.melbourne.vic.gov.au/explore/dataset/municipal-boundary/';
const rowSchema = z.object({
  mccid_gis: z.number().int(),
  name: z.string().min(1),
  xdate: z.string().nullable().optional(),
  geo_shape: z.object({
    type: z.literal('Feature'),
    geometry: z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.unknown() }),
  }),
}).passthrough();

export const connector: Connector = {
  sourceId: SOURCE_ID,
  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await new OpenDataSoftClient().fetchRecords({
        portalUrl: 'https://data.melbourne.vic.gov.au',
        datasetId: 'municipal-boundary',
        orderBy: 'mccid_gis ASC',
      });
      if (response.totalCount !== 1 || response.records.length !== 1) {
        throw new Error('Municipal boundary response must contain exactly one municipality');
      }
      const row = rowSchema.parse(response.records[0]);
      if (row.name !== 'City of Melbourne') throw new Error('Unexpected municipal boundary identity');
      const geometry = JSON.stringify(parseBoundaryGeometry(row.geo_shape.geometry));
      const versionId = sourceVersionId(response.lastModified, row.geo_shape.geometry);
      const vintage = row.xdate ?? `geometry-${versionId.slice(0, 12)}`;
      const sourceId = sourceRecordId({ sourceId: SOURCE_ID, nativeId: String(row.mccid_gis),
        originalUrl: LANDING_URL, sourceTime: null });
      const sourceRecord: SourceRecord = {
        batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: response.fetchedAt, source_record_id: sourceId, version_id: versionId,
        original_url: LANDING_URL, raw_uri: null, published_at: null, observed_at: null,
        first_accessible_at: null,
        time_missing_reason: 'The municipal boundary endpoint does not provide a publication timestamp',
        valid_from: null, valid_to: null, source_updated_at: null,
        source_version_ordinal: null, record_status: 'active',
        assertion_kind: 'observation', rights_status: 'verified_open',
      };
      const boundary: Boundary = {
        batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: response.fetchedAt, boundary_id: `com_municipal:${row.mccid_gis}:${vintage}`,
        version_id: versionId, scheme: 'com_municipal', code: String(row.mccid_gis),
        name: row.name, vintage, geometry_geojson: geometry, valid_from: null,
        valid_to: null, source_record_id: sourceId,
      };
      return {
        kind: 'success', sourceId: SOURCE_ID, runId: input.runId,
        fetchedAt: response.fetchedAt, sourceRevision: versionId,
        sourceLatestUpdateAt: null, checkpointAfter: input.window.kind === 'time' ? input.window.to : null,
        completeness: { complete: true, method: 'pagination', expected_records: 1,
          fetched_records: 1, expected_pages: 1, fetched_pages: response.pageCount,
          evidence: 'OpenDataSoft total_count is one and the sole boundary has the expected municipal name' },
        inputCount: 1, outputCount: 1, rejectedCount: 0,
        sourceRecords: [sourceRecord], geoRecords: [], geoRecordSources: [],
        boundaries: [boundary], areaIndicators: [], parkingBays: [],
        parkingObservations: [], parkingRules: [], sensorLocations: [],
        pedestrianObservations: [], retainableRawRecords: null,
      };
    } catch (error) {
      return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt,
        code: error instanceof z.ZodError ? 'schema_changed' : 'validation_failed',
        message: 'Municipal boundary could not be validated', retryAfterSeconds: null,
        completeness: { complete: false, expected_records: 1, fetched_records: 0,
          expected_pages: 1, fetched_pages: 0, evidence: 'Boundary validation did not finish' },
        sourceLatestUpdateAt: null };
    }
  },
};
