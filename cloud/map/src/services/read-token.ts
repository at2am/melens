import { createHash } from 'node:crypto';

import { identifierSchema, layerIdSchema, normalizedViewportIdentity, parseUnlocatedQuery, parseViewportQuery,
  type LayerId, type UnlocatedQuery, type ViewportQuery } from '@melens/shared/contracts/map-contract';
import { MapServiceError } from '@melens/shared/errors';

/**
 * Stateless read tokens (system-design/map-serving-stateless.md). A `snapshotId` carries the normalized request
 * context, so any instance can recompute a response's layers from the in-memory layer cache, and a `cursor` carries
 * an offset bound to that token. The server stores nothing per request. A context too long for a 256-character id
 * gets a digest instead, which later reads report as `snapshotExpired`, so the client reissues the request.
 */
export type ReadContext =
  | { readonly family: 'viewport'; readonly request: ViewportQuery }
  | { readonly family: 'unlocated'; readonly query: UnlocatedQuery };

const SEPARATOR = '~';
const LAYERS = layerIdSchema.options;
const MAX_TOKEN_LENGTH = 256;

const encodeLayers = (layers: readonly LayerId[]) => layers.map((layer) => LAYERS.indexOf(layer).toString(36)).join('');
function decodeLayers(text: string): LayerId[] {
  return [...text].map((char) => {
    const layer = LAYERS[Number.parseInt(char, 36)];
    if (layer === undefined) throw new TypeError('Unknown layer');
    return layer;
  });
}
const encodeJson = (value: unknown) => value == null ? '' : Buffer.from(JSON.stringify(value)).toString('base64url');
const decodeJson = (text: string): unknown => text === '' ? null : JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 32);

function bounded(token: string, context: unknown): string {
  return token.length <= MAX_TOKEN_LENGTH && identifierSchema.safeParse(token).success ? token : `x1${SEPARATOR}${digest(context)}`;
}

export function viewportToken(request: ViewportQuery): string {
  const [west, south, east, north] = request.bbox;
  return bounded(['v1', west, south, east, north, request.zoom, encodeLayers(request.layers), request.mode,
    request.window.from, request.window.to, request.pageSize ?? '', encodeJson(request.areaFilter),
    encodeJson(request.boundaryFilter)].join(SEPARATOR), normalizedViewportIdentity(request));
}

export function unlocatedToken(query: UnlocatedQuery): string {
  return bounded(['u1', encodeLayers(query.layers), query.mode, query.window.from, query.window.to, query.pageSize ?? '',
    encodeJson(query.scope), encodeJson(query.areaFilter), encodeJson(query.boundaryFilter)].join(SEPARATOR), query);
}

/** The request a token was issued for, with the reader's requestId; `snapshotExpired` when it cannot be recomputed. */
export function readContext(token: string, requestId: string): ReadContext {
  const parts = token.split(SEPARATOR);
  const optional = (text: string | undefined) => text === undefined || text === '' ? undefined : text;
  try {
    if (parts[0] === 'v1' && parts.length === 13) {
      const [, west, south, east, north, zoom, layers, mode, from, to, pageSize, areaFilter, boundaryFilter] = parts;
      const request = parseViewportQuery({ requestId, bbox: [west, south, east, north].map(Number), zoom: Number(zoom),
        layers: decodeLayers(layers!), mode, window: { from, to },
        ...(optional(pageSize) === undefined ? {} : { pageSize: Number(pageSize) }),
        ...(optional(areaFilter) === undefined ? {} : { areaFilter: decodeJson(areaFilter!) }),
        ...(optional(boundaryFilter) === undefined ? {} : { boundaryFilter: decodeJson(boundaryFilter!) }) });
      if (viewportToken(request) !== token) throw new TypeError('Non-canonical token');
      return { family: 'viewport', request };
    }
    if (parts[0] === 'u1' && parts.length === 9) {
      const [, layers, mode, from, to, pageSize, scope, areaFilter, boundaryFilter] = parts;
      const query = parseUnlocatedQuery({ requestId, layers: decodeLayers(layers!), mode, window: { from, to },
        scope: decodeJson(scope!),
        ...(optional(pageSize) === undefined ? {} : { pageSize: Number(pageSize) }),
        ...(optional(areaFilter) === undefined ? {} : { areaFilter: decodeJson(areaFilter!) }),
        ...(optional(boundaryFilter) === undefined ? {} : { boundaryFilter: decodeJson(boundaryFilter!) }) });
      if (unlocatedToken(query) !== token) throw new TypeError('Non-canonical token');
      return { family: 'unlocated', query };
    }
  } catch { /* An undecodable token is treated like an expired one: the client reissues its request. */ }
  throw new MapServiceError('snapshotExpired');
}

export interface CursorBinding {
  readonly snapshotId: string; readonly family: 'viewport' | 'unlocated' | 'aggregateMembers';
  readonly layerId: LayerId | null; readonly aggregateId: string | null; readonly pageSize: number;
}

export const cursorToken = (offset: number, binding: CursorBinding) =>
  `k1${SEPARATOR}${offset}${SEPARATOR}${digest([offset, binding])}`;
/** At least as long as any real cursor (offsets stay below 10,000), so a page can be measured before it is issued. */
export const CURSOR_PLACEHOLDER = cursorToken(9_999, { snapshotId: '', family: 'viewport', layerId: null, aggregateId: null, pageSize: 0 });

/** The offset a cursor continues from; `cursorMismatch` when it was issued for another token, layer or page size. */
export function cursorOffset(cursor: string, binding: CursorBinding): number {
  const [version, offset, bound, ...rest] = cursor.split(SEPARATOR);
  const value = Number(offset);
  if (version !== 'k1' || rest.length !== 0 || !Number.isSafeInteger(value) || value < 1 || String(value) !== offset
    || bound !== digest([value, binding])) throw new MapServiceError('cursorMismatch');
  return value;
}
