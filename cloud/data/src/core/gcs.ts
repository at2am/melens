import { createHash } from 'node:crypto';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

const utc = z.iso.datetime({ offset: false });
const sourceId = z.string().regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/);
const safeId = z.string().regex(/^[A-Za-z0-9._-]+$/);
const windowSchema = z.object({
  from: utc,
  to: utc,
  batchId: safeId,
}).refine(window => Date.parse(window.from) < Date.parse(window.to), 'Window must be non-empty');
const manifestSchema = z.object({
  sourceId,
  checkpoint: utc,
  completedWindows: z.array(windowSchema),
});

export type CompletedWindow = z.infer<typeof windowSchema>;
export type CheckpointManifest = z.infer<typeof manifestSchema>;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function httpCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  return typeof code === 'number' ? code : typeof code === 'string' ? Number(code) : null;
}

export function addCompletedWindow(manifest: CheckpointManifest, window: CompletedWindow): CheckpointManifest {
  manifestSchema.parse(manifest);
  windowSchema.parse(window);
  const completed = new Map<string, CompletedWindow>();
  for (const existing of [...manifest.completedWindows, window]) {
    completed.set(`${Date.parse(existing.from)}/${Date.parse(existing.to)}`, existing);
  }
  const windows = [...completed.values()].sort((a, b) => Date.parse(a.from) - Date.parse(b.from)
    || Date.parse(a.to) - Date.parse(b.to));
  let cursor = manifest.checkpoint;
  while (true) {
    const next = windows.filter(candidate => Date.parse(candidate.from) <= Date.parse(cursor)
      && Date.parse(candidate.to) > Date.parse(cursor))
      .sort((a, b) => Date.parse(b.to) - Date.parse(a.to))[0];
    if (!next) break;
    cursor = next.to;
  }
  return {
    sourceId: manifest.sourceId,
    checkpoint: cursor,
    completedWindows: windows.filter(candidate => Date.parse(candidate.to) > Date.parse(cursor)),
  };
}

export interface StoredObject {
  uri: string;
  sha256: string;
  generation: string;
  expiresAt: string;
}

/** GCS objects use generation preconditions; a retry may only reuse identical bytes. */
export class GcsStore {
  constructor(private readonly storage: Storage, private readonly bucketName: string) {}

  private get bucket() {
    return this.storage.bucket(this.bucketName);
  }

  async saveNdjson(input: {
    kind: 'raw' | 'staging';
    sourceId: string;
    batchId: string;
    rows: readonly unknown[];
    allowedFields: readonly string[] | null;
    retentionDays: number;
  }): Promise<StoredObject> {
    const id = sourceId.parse(input.sourceId);
    const batchId = safeId.parse(input.batchId);
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 0) {
      throw new Error('A nonnegative retention period is required');
    }
    if (input.kind === 'raw' && (!input.allowedFields || input.allowedFields.length === 0)) {
      throw new Error('Raw fields are not approved for retention');
    }
    const projected = input.rows.map(row => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error('NDJSON rows must be objects');
      }
      if (input.kind !== 'raw') return row;
      const record = row as Record<string, unknown>;
      return Object.fromEntries(input.allowedFields?.filter(field => Object.hasOwn(record, field))
        .map(field => [field, record[field]]) ?? []);
    });
    const bytes = Buffer.from(projected.map(row => JSON.stringify(row)).join('\n') + (projected.length ? '\n' : ''));
    const hash = sha256(bytes);
    const objectName = `${input.kind}/${id}/${batchId}/${hash}.ndjson`;
    const file = this.bucket.file(objectName);
    const expiresAt = new Date(Date.now() + input.retentionDays * 86_400_000).toISOString();
    try {
      await file.save(bytes, {
        resumable: false,
        contentType: 'application/x-ndjson',
        metadata: { metadata: { sha256: hash, expiresAt, sourceId: id, batchId } },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if (httpCode(error) !== 412) throw error;
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.sha256 !== hash) throw new Error('Existing object content differs');
    }
    const [metadata] = await file.getMetadata();
    if (!metadata.generation) throw new Error('Missing GCS generation');
    return { uri: `gs://${this.bucketName}/${objectName}`, sha256: hash,
      generation: String(metadata.generation),
      expiresAt: typeof metadata.metadata?.expiresAt === 'string' ? metadata.metadata.expiresAt : expiresAt };
  }

  async deleteObject(object: StoredObject): Promise<void> {
    const prefix = `gs://${this.bucketName}/`;
    if (!object.uri.startsWith(prefix)) throw new Error('Object belongs to another bucket');
    await this.bucket.file(object.uri.slice(prefix.length), { generation: object.generation })
      .delete({ ignoreNotFound: true });
  }

  async deleteStagingObjects(uris: readonly string[]): Promise<void> {
    const prefix = `gs://${this.bucketName}/staging/`;
    for (const uri of uris) {
      if (!uri.startsWith(prefix)) throw new Error('Not a staging object in this bucket');
      const name = uri.slice(`gs://${this.bucketName}/`.length);
      try {
        const [metadata] = await this.bucket.file(name).getMetadata();
        if (!metadata.generation) throw new Error('Missing staging generation');
        await this.bucket.file(name, { generation: String(metadata.generation) }).delete({ ignoreNotFound: true });
      } catch (error) {
        if (httpCode(error) !== 404) throw error;
      }
    }
  }

  async readCheckpoint(id: string, initialCursor: string): Promise<{ manifest: CheckpointManifest; generation: string }> {
    const canonicalId = sourceId.parse(id);
    utc.parse(initialCursor);
    const file = this.bucket.file(`checkpoints/${canonicalId}.json`);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let metadata;
      try {
        [metadata] = await file.getMetadata();
      } catch (error) {
        if (httpCode(error) !== 404) throw error;
        return { manifest: { sourceId: canonicalId, checkpoint: initialCursor, completedWindows: [] }, generation: '0' };
      }
      if (!metadata.generation) throw new Error('Missing checkpoint generation');
      const generation = String(metadata.generation);
      try {
        const [bytes] = await this.bucket.file(file.name, { generation }).download();
        const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (manifest.sourceId !== canonicalId) throw new Error('Invalid checkpoint source');
        return { manifest, generation };
      } catch (error) {
        if (![404, 412].includes(httpCode(error) ?? -1)) throw error;
      }
    }
    throw new Error('Checkpoint changed repeatedly during read');
  }

  async markPublishedWindow(id: string, initialCursor: string, window: CompletedWindow): Promise<CheckpointManifest> {
    const canonicalId = sourceId.parse(id);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { manifest, generation } = await this.readCheckpoint(canonicalId, initialCursor);
      const next = addCompletedWindow(manifest, window);
      if (JSON.stringify(next) === JSON.stringify(manifest)) return next;
      try {
        await this.bucket.file(`checkpoints/${canonicalId}.json`).save(JSON.stringify(next), {
          resumable: false,
          contentType: 'application/json',
          preconditionOpts: { ifGenerationMatch: generation },
        });
        return next;
      } catch (error) {
        if (httpCode(error) !== 412) throw error;
      }
    }
    throw new Error('Checkpoint contention exceeded retry limit');
  }

  async cleanupExpired(kind: 'raw' | 'staging', now = new Date(), maxObjects = 1000): Promise<number> {
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid cleanup clock');
    if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 10_000) {
      throw new Error('Cleanup scan limit must be between 1 and 10000');
    }
    // One extra result makes an incomplete scan visible without listing the whole bucket.
    const [files] = await this.bucket.getFiles({ prefix: `${kind}/`, maxResults: maxObjects + 1 });
    let deleted = 0;
    for (const file of files.slice(0, maxObjects)) {
      let metadata;
      try {
        [metadata] = await file.getMetadata();
      } catch (error) {
        if (httpCode(error) === 404) continue;
        throw error;
      }
      const expiresAt = metadata.metadata?.expiresAt;
      const explicitExpiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
      const createdAt = typeof metadata.timeCreated === 'string' ? Date.parse(metadata.timeCreated) : NaN;
      const fallbackExpiry = kind === 'staging' && Number.isFinite(createdAt)
        ? createdAt + 86_400_000 : NaN;
      const deadline = Number.isFinite(explicitExpiry) ? explicitExpiry : fallbackExpiry;
      if (!Number.isFinite(deadline) || deadline > now.getTime()) continue;
      if (!metadata.generation) continue;
      await this.bucket.file(file.name, { generation: String(metadata.generation) }).delete({ ignoreNotFound: true });
      deleted += 1;
    }
    if (files.length > maxObjects) {
      throw new Error(`Cleanup scan limit reached after ${maxObjects} ${kind} objects; deleted ${deleted}`);
    }
    return deleted;
  }

  /** Remove retained copies after a source's reuse permission is withdrawn. */
  async cleanupSourceExpired(id: string, now: Date, maxObjects: number,
    maximumAgeSeconds: number): Promise<number> {
    const canonicalId = sourceId.parse(id);
    if (!Number.isFinite(now.getTime()) || !Number.isInteger(maxObjects)
      || maxObjects < 1 || maxObjects > 10_000 || maximumAgeSeconds <= 0) {
      throw new Error('Invalid source cleanup bounds');
    }
    let deleted = 0;
    for (const kind of ['raw', 'staging'] as const) {
      const [files] = await this.bucket.getFiles({ prefix: `${kind}/${canonicalId}/`,
        maxResults: maxObjects + 1 });
      for (const file of files.slice(0, maxObjects)) {
        const [metadata] = await file.getMetadata();
        const created = Date.parse(String(metadata.timeCreated ?? ''));
        const expiry = Date.parse(String(metadata.metadata?.expiresAt ?? ''));
        const ageLimit = Number.isFinite(created) ? created + maximumAgeSeconds * 1000 : NaN;
        const deadline = Number.isFinite(expiry)
          ? Number.isFinite(ageLimit) ? Math.min(expiry, ageLimit) : expiry : ageLimit;
        if (!Number.isFinite(deadline) || deadline > now.getTime() || !metadata.generation) continue;
        await this.bucket.file(file.name, { generation: String(metadata.generation) })
          .delete({ ignoreNotFound: true });
        deleted += 1;
      }
      if (files.length > maxObjects) throw new Error('Source retention scan is incomplete');
    }
    return deleted;
  }

  /** Remove retained copies after a source's reuse permission is withdrawn. */
  async purgeSourceCopies(id: string): Promise<number> {
    const canonicalId = sourceId.parse(id);
    let deleted = 0;
    for (const kind of ['raw', 'staging'] as const) {
      const [files] = await this.bucket.getFiles({ prefix: `${kind}/${canonicalId}/` });
      for (const file of files) {
        const [metadata] = await file.getMetadata();
        if (!metadata.generation) continue;
        await this.bucket.file(file.name, { generation: String(metadata.generation) })
          .delete({ ignoreNotFound: true });
        deleted += 1;
      }
    }
    return deleted;
  }

  /** A generation-bound lease serializes publication of the same batch. */
  async withBatchLease<T>(batchId: string, work: () => Promise<T>): Promise<T> {
    const id = safeId.parse(batchId);
    const file = this.bucket.file(`locks/${id}.json`);
    const leaseUntil = new Date(Date.now() + 30 * 60_000).toISOString();
    try {
      await file.save(JSON.stringify({ leaseUntil }), {
        resumable: false, contentType: 'application/json',
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if (httpCode(error) !== 412) throw error;
      throw new Error('Batch publication is already in progress; inspect the job before clearing a stale lease');
    }
    const [metadata] = await file.getMetadata();
    if (!metadata.generation) throw new Error('Missing batch lease generation');
    try {
      return await work();
    } finally {
      await this.bucket.file(file.name, { generation: String(metadata.generation) })
        .delete({ ignoreNotFound: true });
    }
  }
}
