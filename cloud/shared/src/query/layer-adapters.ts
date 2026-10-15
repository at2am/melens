import type { LayerId, UnlocatedQuery, ViewportQuery } from '../contracts/map-contract.js';
import { MapServiceError } from '../errors.js';
import type { PublishedItemBatch, PublicSourceResolver } from './adapter-common.js';
import { adaptBoundaryRows } from './boundaries.js';
import { adaptDisruptionRows } from './disruptions.js';
import { adaptEventRows } from './events.js';
import { adaptParkingRows } from './parking.js';
import { adaptPedestrianRows } from './pedestrian.js';
import { adaptPlanningRows } from './planning.js';
import type { ViewRow } from './query-runner.js';

export interface AdaptContext {
  readonly mode: 'current' | 'historical';
  readonly boundaryFilter: ViewportQuery['boundaryFilter'] | undefined;
  readonly resolveSource: PublicSourceResolver;
  /** The instant "current" lifecycle is judged against. */
  readonly asOf: string;
}

type LayerAdapter = (rows: readonly ViewRow[], context: AdaptContext) => PublishedItemBatch;

/** One entry per layer this service converts itself; registration here drives every layer check below. */
const LAYER_ADAPTERS = {
  planning: (rows, { resolveSource, mode }) => adaptPlanningRows(rows, { resolveSource, mode }),
  boundary: (rows, { resolveSource, boundaryFilter }) => {
    if (boundaryFilter == null) throw new MapServiceError('invalidRequest');
    return adaptBoundaryRows(rows, { resolveSource, selection: boundaryFilter });
  },
  pedestrian: (rows, { resolveSource, mode }) => adaptPedestrianRows(rows, { resolveSource, mode }),
  disruption: (rows, { resolveSource, mode, asOf }) => adaptDisruptionRows(rows, { resolveSource, mode, asOf }),
  event: (rows, { resolveSource, mode, asOf }) => adaptEventRows(rows, { resolveSource, mode, asOf }),
  parking: (rows, { resolveSource, mode }) => adaptParkingRows(rows, { resolveSource, mode }),
} satisfies Partial<Record<LayerId, LayerAdapter>>;

export type AdaptedLayerId = keyof typeof LAYER_ADAPTERS;

/** Layers with a row adapter; every other layer needs an external verified producer. */
export const ADAPTED_LAYERS: ReadonlySet<LayerId> = new Set(Object.keys(LAYER_ADAPTERS) as AdaptedLayerId[]);
/** Layers with a null-geometry read. Boundaries always carry geometry. */
export const UNLOCATED_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(['planning', 'pedestrian', 'disruption', 'event']);
/**
 * The boundary and pedestrian views do not yet prove latest record-level rights withdrawal,
 * so their rows need a trusted supplemental verifier until that view gate is repaired.
 */
export const EXTERNALLY_VERIFIED_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(['boundary', 'pedestrian']);

export function isAdaptedLayer(layerId: LayerId): layerId is AdaptedLayerId {
  return ADAPTED_LAYERS.has(layerId);
}

export function adaptContext(request: ViewportQuery | UnlocatedQuery, resolveSource: PublicSourceResolver,
  asOf: string): AdaptContext {
  return { mode: request.mode, resolveSource, asOf,
    boundaryFilter: 'boundaryFilter' in request ? request.boundaryFilter : undefined };
}

/** Convert published view rows into contract items for one layer. */
export function adaptLayerRows(layerId: LayerId, rows: readonly ViewRow[], context: AdaptContext): PublishedItemBatch {
  if (!isAdaptedLayer(layerId)) throw new MapServiceError('notAvailable');
  // Public reference URLs come from reviewed source metadata rather than provider rows.
  const published = rows.map((row) => Object.hasOwn(row, 'original_url')
    ? { ...row, original_url: context.resolveSource(String(row.source_id))?.url ?? null } : row);
  return LAYER_ADAPTERS[layerId](published, context);
}
