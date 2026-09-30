import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseConnectorInput, type ConnectorInput } from '../core/connector.js';
import { loadConnector, loadSourceRegistry } from '../core/registry.js';

function flags(args: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || !['--source', '--from', '--to', '--revision'].includes(key) || !value
      || value.startsWith('--') || parsed.has(key)) throw new Error('Invalid probe arguments');
    parsed.set(key, value);
  }
  return parsed;
}

export async function probe(args: readonly string[]): Promise<void> {
  const options = flags(args);
  const root = join(dirname(fileURLToPath(import.meta.url)), '../connectors');
  const registry = await loadSourceRegistry(root);
  const sourceArg = options.get('--source');
  const entry = sourceArg ? registry.get(sourceArg) : null;
  if (!entry) throw new Error('Unknown or missing --source');
  const source = entry.dataSource;
  if (source.admission_evidence.secret_names.length > 0) {
    throw new Error('Public probe is disabled for sources requiring a secret');
  }
  const from = options.get('--from');
  const to = options.get('--to');
  const revision = options.get('--revision');
  if ((from === undefined) !== (to === undefined) || (from !== undefined && revision !== undefined)) {
    throw new Error('Specify either --from and --to, or --revision');
  }
  const window: ConnectorInput['window'] = from && to
    ? { kind: 'time', from, to }
    : { kind: 'snapshot', revision: revision ?? 'latest' };
  const input = parseConnectorInput({ sourceId: source.source_id, window,
    checkpoint: null, runId: `probe_${randomUUID()}` });
  const connector = await loadConnector(entry);
  const result = await connector.collect(input);
  const summary = result.kind === 'success' ? {
    kind: result.kind, source_id: source.source_id,
    license_status: source.license_status, access_status: source.access_status,
    fetched_at: result.fetchedAt, source_latest_update_at: result.sourceLatestUpdateAt,
    input_count: result.inputCount, output_count: result.outputCount,
    rejected_count: result.rejectedCount, completeness: result.completeness,
    table_counts: {
      source_records: result.sourceRecords.length, geo_records: result.geoRecords.length,
      boundaries: result.boundaries.length, area_indicators: result.areaIndicators.length,
      parking_bays: result.parkingBays.length,
      parking_observations: result.parkingObservations.length,
      parking_rules: result.parkingRules.length,
      sensor_locations: result.sensorLocations.length,
      pedestrian_observations: result.pedestrianObservations.length,
    },
  } : {
    kind: result.kind, source_id: source.source_id,
    license_status: source.license_status, access_status: source.access_status,
    checked_at: result.checkedAt, code: result.code,
    completeness: result.completeness,
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
  if (result.kind === 'failure') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  probe(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Probe failed'}\n`);
    process.exitCode = 1;
  });
}
