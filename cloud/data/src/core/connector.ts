import { z } from 'zod';

import type {
  AreaIndicator, Boundary, GeoRecord, GeoRecordSource, ParkingBay,
  ParkingObservation, ParkingRule, PedestrianObservation, SensorLocation,
  SourceId, SourceRecord, UtcTimestamp,
} from './types.js';

export const CONNECTOR_ERROR_CODES = [
  'rate_limited', 'upstream_unavailable', 'schema_changed',
  'auth_failed', 'incomplete_window', 'validation_failed',
] as const;

export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

const utcTimestampSchema = z.iso.datetime({ offset: false }).refine(
  value => !Number.isNaN(Date.parse(value)),
  'Must be an ISO-8601 UTC timestamp',
);

const timeWindowSchema = z.object({
  kind: z.literal('time'),
  from: utcTimestampSchema,
  to: utcTimestampSchema,
}).strict().refine(
  window => Date.parse(window.from) < Date.parse(window.to),
  'Window must be non-empty and half-open [from, to)',
);

const snapshotWindowSchema = z.object({
  kind: z.literal('snapshot'),
  revision: z.string().trim().min(1),
}).strict();

export const connectorInputSchema = z.object({
  sourceId: z.string().regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/),
  window: z.union([timeWindowSchema, snapshotWindowSchema]),
  checkpoint: z.string().nullable(),
  runId: z.string().trim().min(1),
}).strict();

export type ConnectorInput = z.infer<typeof connectorInputSchema>;

export function parseConnectorInput(value: unknown): ConnectorInput {
  return connectorInputSchema.parse(value);
}

export interface ConnectorCompleteness {
  complete: true;
  method: 'pagination' | 'export_count' | 'feed_snapshot' | 'not_applicable';
  expected_records: number | null;
  fetched_records: number;
  expected_pages: number | null;
  fetched_pages: number;
  /** Why an absent expected count is still a complete upstream response. */
  evidence: string;
}

export interface IncompleteConnectorWindow {
  complete: false;
  expected_records: number | null;
  fetched_records: number;
  expected_pages: number | null;
  fetched_pages: number;
  evidence: string;
}

/** A successful connector run is not a published batch. Publication belongs to the common layer. */
export interface ConnectorSuccess {
  kind: 'success';
  sourceId: SourceId;
  runId: string;
  fetchedAt: UtcTimestamp;
  sourceRevision: string | null;
  sourceLatestUpdateAt: UtcTimestamp | null;
  /** Candidate only; publisher persists it after a complete validated publication. */
  checkpointAfter: string | null;
  completeness: ConnectorCompleteness;
  inputCount: number;
  outputCount: number;
  rejectedCount: number;
  sourceRecords: readonly SourceRecord[];
  geoRecords: readonly GeoRecord[];
  geoRecordSources: readonly GeoRecordSource[];
  boundaries: readonly Boundary[];
  areaIndicators: readonly AreaIndicator[];
  parkingBays: readonly ParkingBay[];
  parkingObservations: readonly ParkingObservation[];
  parkingRules: readonly ParkingRule[];
  sensorLocations: readonly SensorLocation[];
  pedestrianObservations: readonly PedestrianObservation[];
  /** Raw fields already filtered to those the source license allows us to retain. */
  retainableRawRecords: readonly unknown[] | null;
}

export interface ConnectorFailure {
  kind: 'failure';
  sourceId: SourceId;
  runId: string;
  checkedAt: UtcTimestamp;
  code: ConnectorErrorCode;
  /** Secret-free diagnostic text; never include request URLs with tokens. */
  message: string;
  retryAfterSeconds: number | null;
  completeness: IncompleteConnectorWindow;
  sourceLatestUpdateAt: UtcTimestamp | null;
}

export type ConnectorResult = ConnectorSuccess | ConnectorFailure;

export interface Connector {
  readonly sourceId: SourceId;
  collect(input: ConnectorInput): Promise<ConnectorResult>;
}

export function isConnector(value: unknown): value is Connector {
  if (typeof value !== 'object' || value === null) return false;
  return 'sourceId' in value && typeof value.sourceId === 'string'
    && 'collect' in value && typeof value.collect === 'function';
}
