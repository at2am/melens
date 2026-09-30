import { adapt, managedwriter, protos } from '@google-cloud/bigquery-storage';
import { z } from 'zod';

type JsonObject = Parameters<managedwriter.JSONWriter['appendRows']>[0][number];

const HIGH_FREQUENCY_TABLES = new Set([
  'parking_observations', 'pedestrian_observations', 'source_records', 'geo_records',
]);

function jsonObject(value: unknown): JsonObject {
  return z.record(z.string(), z.json()).parse(value);
}

/** The default stream is at least once; stable row keys are required for query deduplication. */
export async function writeHighFrequencyRows(input: {
  projectId: string;
  dataset: string;
  table: string;
  batchId: string;
  rows: readonly unknown[];
  client?: Pick<managedwriter.WriterClient, 'enableWriteRetries' | 'getWriteStream' | 'createStreamConnection' | 'close'>;
}): Promise<{ acknowledgedRows: number; guarantee: 'at_least_once' }> {
  if (!HIGH_FREQUENCY_TABLES.has(input.table)) throw new Error('Unsupported high-frequency table');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(input.projectId)
    || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.dataset)) throw new Error('Invalid BigQuery destination');
  if (input.rows.length === 0) return { acknowledgedRows: 0, guarantee: 'at_least_once' };
  const rows = input.rows.map(value => {
    const row = jsonObject(value);
    const keys = input.table === 'source_records' ? ['source_record_id']
      : input.table === 'geo_records' ? ['geo_record_id'] : ['sensor_id', 'observed_at'];
    if (!input.batchId || row.batch_id !== input.batchId
      || ['source_id', 'version_id', ...keys].some(key => typeof row[key] !== 'string' || !row[key])) {
      throw new Error('Write API row lacks stable batch, source or version key');
    }
    return row;
  });
  const client = input.client ?? new managedwriter.WriterClient({ projectId: input.projectId });
  const ownsClient = input.client === undefined;
  const destinationTable = `projects/${input.projectId}/datasets/${input.dataset}/tables/${input.table}`;
  let writer: managedwriter.JSONWriter | null = null;
  try {
    client.enableWriteRetries(true);
    const stream = await client.getWriteStream({
      streamId: `${destinationTable}/streams/_default`,
      view: protos.google.cloud.bigquery.storage.v1.WriteStreamView.FULL,
    });
    if (!stream.tableSchema) throw new Error('Write stream table schema is missing');
    for (const row of rows) {
      for (const field of stream.tableSchema.fields ?? []) {
        // The live Storage Write API sends the enum name as a string even
        // though the generated TypeScript type also permits the numeric value.
        if (!field.name || (field.type !== protos.google.cloud.bigquery.storage.v1.TableFieldSchema.Type.TIMESTAMP
          && field.type !== 'TIMESTAMP')) continue;
        const value = row[field.name];
        if (value === null || value === undefined) continue;
        const timestamp = z.iso.datetime({ offset: false }).parse(value);
        const [seconds, fraction = ''] = timestamp.slice(0, -1).split('.');
        if (!seconds || fraction.length > 6) throw new Error('Timestamp exceeds BigQuery microsecond precision');
        row[field.name] = (BigInt(Date.parse(`${seconds}Z`)) * 1000n
          + BigInt(fraction.padEnd(6, '0'))).toString();
      }
    }
    const descriptor = adapt.convertStorageSchemaToProto2Descriptor(stream.tableSchema, 'root');
    const connection = await client.createStreamConnection({ streamId: managedwriter.DefaultStream, destinationTable });
    writer = new managedwriter.JSONWriter({
      connection, protoDescriptor: descriptor,
    });
    let acknowledgedRows = 0;
    for (let start = 0; start < rows.length; start += 250) {
      const chunk = rows.slice(start, start + 250);
      if (Buffer.byteLength(JSON.stringify(chunk)) >= 8_000_000) {
        throw new Error('Write API chunk exceeds safe request size');
      }
      const response = await writer.appendRows(chunk).getResult();
      if (response.error || response.rowErrors?.length || !response.appendResult) {
        throw new Error(`Write API append rejected: ${response.error?.code ?? 'missing acknowledgement or row errors'}`);
      }
      acknowledgedRows += chunk.length;
    }
    return { acknowledgedRows, guarantee: 'at_least_once' };
  } finally {
    writer?.close();
    if (ownsClient) client.close();
  }
}
