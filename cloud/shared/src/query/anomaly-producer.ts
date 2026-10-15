import { z } from 'zod';

import { MAX_PAGE_ITEMS, normalizedViewportIdentity, timeWindowSchema, type ViewportQuery } from '../contracts/map-contract.js';
import { MapQueryError } from '../errors.js';
import type { PublicSourceReference } from './adapter-common.js';
import { REPLAY_TITLE_PREFIX, type VerifiedAnomalyProducer } from './anomalies.js';
import type { ViewQueryResult } from './query-runner.js';

const instant = timeWindowSchema.shape.from;
const optionalNumber = z.number().nullable();
const rowSchema = z.object({
  result_id: z.string().min(1), source_id: z.string().min(1), batch_id: z.string().min(1), sensor_id: z.string().min(1),
  sensor_name: z.string().nullable(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  window_from: instant, window_to: instant, observation_id: z.string().min(1).nullable(),
  baseline_definition_id: z.string().min(1).nullable(), baseline_value: optionalNumber, observed_value: optionalNumber, delta: optionalNumber,
  direction: z.enum(['higher', 'lower', 'none']), classification: z.enum(['anomalous', 'notAnomalous']),
  is_replay: z.boolean(), replay_label: z.string().nullable(), location_evidence: z.string().min(1).nullable(), published_at: instant,
});
type AnomalyRow = z.infer<typeof rowSchema>;

function instantOf(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new MapQueryError('serviceUnavailable');
  return parsed.toISOString();
}

/**
 * Reads the published anomaly results of `melens_query.v_anomaly_current` for the viewport and shapes them as the
 * verified batch that `consumeVerifiedAnomalyBatch` checks. It detects and recalculates nothing: the detector, or the
 * replay of a historical day, wrote the rows. Only the latest published batch of each source is offered, because
 * that is the batch the source coverage view certifies.
 */
export function createViewAnomalyProducer(options: {
  readonly runQuery: (input: unknown, execution: { readonly signal?: AbortSignal }) => Promise<ViewQueryResult>;
  /** Reviewed public references by source id; a result of any other source is dropped. */
  readonly references: ReadonlyMap<string, PublicSourceReference>;
}): VerifiedAnomalyProducer {
  return {
    async read(request: ViewportQuery, execution) {
      const result = await options.runQuery({ queryId: 'anomaly', request: { ...request, pageSize: execution.rowLimit },
        publicSourceIds: [...options.references.keys()], resultBudgetBytes: execution.resultBudgetBytes }, execution);
      let rows: AnomalyRow[];
      try {
        rows = z.array(rowSchema).max(MAX_PAGE_ITEMS).parse(result.rows.map((row) => typeof row === 'string' ? JSON.parse(row) : row));
      } catch { throw new MapQueryError('serviceUnavailable'); }
      const latest = new Map<string, AnomalyRow>();
      for (const row of rows) {
        const current = latest.get(row.source_id);
        if (current === undefined || new Date(row.published_at).getTime() > new Date(current.published_at).getTime()) latest.set(row.source_id, row);
      }
      const current = rows.filter((row) => latest.get(row.source_id)?.batch_id === row.batch_id && options.references.has(row.source_id));
      const replay = current.some((row) => row.is_replay);
      if (replay && !current.every((row) => row.is_replay)) throw new MapQueryError('serviceUnavailable');
      const proofs = [...latest.values()].filter((row) => options.references.has(row.source_id)).map((row) => ({
        sourceId: row.source_id, publishedBatchId: row.batch_id, publishedAt: instantOf(row.published_at) }));
      return {
        verification: 'verifiedPublic', dataMode: 'live', queryIdentity: normalizedViewportIdentity(request), replay,
        publicationProofs: proofs,
        records: current.map((row) => {
          const window = { from: instantOf(row.window_from), to: instantOf(row.window_to) };
          const reference = options.references.get(row.source_id)!;
          const title = `${row.is_replay ? REPLAY_TITLE_PREFIX : ''}${row.sensor_name ?? `Sensor ${row.sensor_id}`}`;
          const attribution = row.is_replay && row.replay_label !== null ? `${reference.attribution} — ${row.replay_label}` : reference.attribution;
          return {
            item: { id: `anomaly:${row.result_id}`, versionId: row.batch_id, layerId: 'anomaly', kind: 'anomaly', title,
              geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
              location: { precision: 'point', role: 'sensor', evidence: row.location_evidence },
              assertionKind: 'observation', lifecycle: 'active',
              time: { observedAt: window.from, reportedAt: null, validFrom: window.from, validTo: window.to,
                fetchedAt: instantOf(row.published_at), periodLabel: null, sourceTimeText: null, sourceTimezone: null },
              sources: [{ sourceId: row.source_id, url: reference.url, attribution, versionRef: row.batch_id }],
              details: { resultId: row.result_id, sensorId: row.sensor_id, observationId: row.observation_id, window,
                baselineDefinitionId: row.baseline_definition_id, baselineValue: row.baseline_value,
                observedValue: row.observed_value, delta: row.delta, direction: row.direction,
                eligibility: 'eligible', classification: row.classification } },
            evidence: { resultId: row.result_id, observationId: row.observation_id, baselineDefinitionId: row.baseline_definition_id,
              observationWindow: row.observation_id === null ? null : window, baselineAppliesToWindow: row.baseline_definition_id === null ? null : window,
              sourceIds: [row.source_id] },
          };
        }),
        completeness: result.kind, totalMatching: result.kind === 'complete' ? current.length : null, unresolvedCount: 0,
      };
    },
  };
}
