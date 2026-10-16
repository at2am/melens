import { normalizedInstant } from '@melens/shared/contracts/map-contract';

import type { TurnRegistry } from '../tools/define.js';
import type { FeatureReader, FeatureSearch } from './reader.js';

type SearchResult = Awaited<ReturnType<FeatureReader['search']>>;
type SearchInput = Omit<FeatureSearch, 'signal'>;

interface TurnSearchState {
  readonly queryTime: number;
  readonly readers: WeakMap<FeatureReader, Map<string, Promise<SearchResult>>>;
}

const searches = new WeakMap<TurnRegistry, TurnSearchState>();

function stateFor(turn: TurnRegistry): TurnSearchState {
  const previous = searches.get(turn);
  if (previous !== undefined) return previous;
  const state = { queryTime: turn.now().getTime(), readers: new WeakMap<FeatureReader, Map<string, Promise<SearchResult>>>() };
  searches.set(turn, state);
  return state;
}

/** Default query windows share one instant. Tool timing still uses the live turn clock. */
export function turnSearchTime(turn: TurnRegistry): Date {
  return new Date(stateFor(turn).queryTime);
}

/** Share only this turn's identical reads, including their pending work. Parking keeps its direct path. */
export function readTurnFeatures(reader: FeatureReader, turn: TurnRegistry, query: SearchInput): Promise<SearchResult> {
  if (query.layers.includes('parking')) return reader.search({ ...query, signal: turn.signal });
  turn.signal.throwIfAborted();
  const state = stateFor(turn);
  let entries = state.readers.get(reader);
  if (entries === undefined) {
    entries = new Map();
    state.readers.set(reader, entries);
  }
  const key = JSON.stringify({ bbox: query.bbox, layers: [...query.layers].sort(), mode: query.mode,
    window: { from: normalizedInstant(query.window.from), to: normalizedInstant(query.window.to) } });
  const existing = entries.get(key);
  if (existing !== undefined) return existing;
  const pending = Promise.resolve().then(() => {
    turn.signal.throwIfAborted();
    return reader.search({ ...query, signal: turn.signal });
  }).then((result) => {
    turn.signal.throwIfAborted();
    return result;
  });
  entries.set(key, pending);
  const forget = () => { if (entries.get(key) === pending) entries.delete(key); };
  void pending.then((result) => {
    if (result.some((layer) => layer.state === 'unavailable' || layer.completeness !== 'complete')) forget();
  }, forget);
  return pending;
}
