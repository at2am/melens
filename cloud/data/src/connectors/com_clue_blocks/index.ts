import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { Connector, ConnectorFailure, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpFailure } from '../../core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../core/opendatasoft.js';
import type { Boundary, SourceRecord } from '../../core/types.js';
import { parseBoundaryGeometry } from '../../validation/geography.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';

export const SOURCE_ID = 'melbourne.clue.blocks';
export const DATASET_ID = 'blocks-for-census-of-land-use-and-employment-clue';
export const LANDING_URL = `https://data.melbourne.vic.gov.au/explore/dataset/${DATASET_ID}/`;
export const DEFAULT_PORTAL_URL = 'https://data.melbourne.vic.gov.au';
export const DEFAULT_VINTAGE = '2025';

export const blockRowSchema = z.object({
  block_id: z.number().int(),
  region_name: z.string().nullable().optional(),
  area_name: z.string().nullable().optional(),
  geo_shape: z.object({
    type: z.literal('Feature'),
    geometry: z.object({
      type: z.enum(['Polygon', 'MultiPolygon']),
      coordinates: z.unknown(),
    }),
  }),
  geo_point_2d: z.object({
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
  }).nullable().optional(),
}).passthrough();

export type ClueBlockRawRow = z.infer<typeof blockRowSchema>;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseClueBlockRow(value: unknown): ClueBlockRawRow {
  return blockRowSchema.parse(value);
}

export class ClueBlocksConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(
    private readonly client: OpenDataSoftClient = new OpenDataSoftClient(),
    private readonly portalUrl: string = DEFAULT_PORTAL_URL,
  ) {}

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    const checkedAt = new Date().toISOString();
    if (input.sourceId !== SOURCE_ID) {
      return {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code: 'validation_failed',
        message: `Expected sourceId ${SOURCE_ID}, got ${input.sourceId}`,
        retryAfterSeconds: null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: null,
          fetched_pages: 0,
          evidence: 'Invalid sourceId provided',
        },
        sourceLatestUpdateAt: null,
      };
    }

    if (input.window.kind !== 'snapshot'
      || !['latest', DEFAULT_VINTAGE].includes(input.window.revision)) {
      return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
        checkedAt, code: 'validation_failed',
        message: 'Only the documented current CLUE block boundary snapshot is available',
        retryAfterSeconds: null,
        completeness: { complete: false, expected_records: null, fetched_records: 0,
          expected_pages: null, fetched_pages: 0,
          evidence: 'The source does not expose historic block polygon vintages' },
        sourceLatestUpdateAt: null };
    }
    const vintage = DEFAULT_VINTAGE;

    try {
      const response = await this.client.fetchRecords({
        portalUrl: this.portalUrl,
        datasetId: DATASET_ID,
        orderBy: 'block_id ASC',
      });

      const sourceRecords: SourceRecord[] = [];
      const boundaries: Boundary[] = [];
      const seenBlockIds = new Set<number>();

      for (const raw of response.records) {
        const row = parseClueBlockRow(raw);
        if (seenBlockIds.has(row.block_id)) {
          throw new Error(`Duplicate block_id detected in CLUE blocks: ${row.block_id}`);
        }
        seenBlockIds.add(row.block_id);

        const validatedGeometry = parseBoundaryGeometry(row.geo_shape.geometry);
        const geometryJson = JSON.stringify(validatedGeometry);
        const versionId = sourceVersionId(response.lastModified, row.geo_shape.geometry);
        const recordId = sourceRecordId({
          sourceId: SOURCE_ID,
          nativeId: String(row.block_id),
          originalUrl: LANDING_URL,
          sourceTime: null,
        });

        const name = row.area_name?.trim() || row.region_name?.trim() || `Block ${row.block_id}`;

        const sourceRecord: SourceRecord = {
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          source_record_id: recordId,
          version_id: versionId,
          original_url: LANDING_URL,
          raw_uri: null,
          published_at: null,
          observed_at: null,
          first_accessible_at: null,
          time_missing_reason: 'The CLUE blocks dataset provides spatial boundary polygons without per-block timestamps',
          valid_from: null,
          valid_to: null,
          source_updated_at: response.lastModified,
          source_version_ordinal: null,
          record_status: 'active',
          assertion_kind: 'observation',
          rights_status: 'verified_open',
        };

        const boundary: Boundary = {
          batch_id: input.runId,
          source_id: SOURCE_ID,
          schema_version: 1,
          fetched_at: response.fetchedAt,
          boundary_id: `com_clue_block:${row.block_id}:${vintage}`,
          version_id: versionId,
          scheme: 'com_clue_block',
          code: String(row.block_id),
          name,
          vintage,
          geometry_geojson: geometryJson,
          valid_from: null,
          valid_to: null,
          source_record_id: recordId,
        };

        sourceRecords.push(sourceRecord);
        boundaries.push(boundary);
      }

      const sourceRevision = digest(boundaries.map(b => b.version_id).sort().join('\n'));
      const checkpointAfter = vintage;

      return {
        kind: 'success',
        sourceId: SOURCE_ID,
        runId: input.runId,
        fetchedAt: response.fetchedAt,
        sourceRevision,
        sourceLatestUpdateAt: response.lastModified,
        checkpointAfter,
        completeness: {
          complete: true,
          method: 'pagination',
          expected_records: response.totalCount,
          fetched_records: boundaries.length,
          expected_pages: response.pageCount,
          fetched_pages: response.pageCount,
          evidence: `All ${response.totalCount} CLUE block boundaries retrieved and verified without duplicates`,
        },
        inputCount: response.records.length,
        outputCount: boundaries.length,
        rejectedCount: 0,
        sourceRecords,
        geoRecords: [],
        geoRecordSources: [],
        boundaries,
        areaIndicators: [],
        parkingBays: [],
        parkingObservations: [],
        parkingRules: [],
        sensorLocations: [],
        pedestrianObservations: [],
        retainableRawRecords: null,
      };
    } catch (error) {
      const code = error instanceof HttpFailure
        ? error.code
        : error instanceof OdsIncompleteWindow
        ? error.code
        : error instanceof z.ZodError
        ? 'schema_changed'
        : 'validation_failed';

      const message = error instanceof Error ? error.message : 'CLUE blocks validation failed';

      const failure: ConnectorFailure = {
        kind: 'failure',
        sourceId: SOURCE_ID,
        runId: input.runId,
        checkedAt,
        code,
        message,
        retryAfterSeconds: error instanceof HttpFailure && error.status === 429 ? 60 : null,
        completeness: {
          complete: false,
          expected_records: null,
          fetched_records: 0,
          expected_pages: null,
          fetched_pages: 0,
          evidence: `CLUE block boundaries collection failed: ${message}`,
        },
        sourceLatestUpdateAt: null,
      };
      return failure;
    }
  }
}

export const connector = new ClueBlocksConnector();
export default connector;
