import { MAX_PAGE_ITEMS } from '@melens/shared/contracts/map-contract';
import { MapServiceError } from '@melens/shared/errors';
import { jsonBytes } from '../util.js';

/** Per-layer shares of the request's row and byte allowances. */
export function layerBudgets(layerCount: number, maxBytes: number, reserveBytes: number): {
  readonly rowLimit: number; readonly resultBudgetBytes: number;
} {
  return {
    rowLimit: Math.max(1, Math.floor(MAX_PAGE_ITEMS / layerCount)),
    resultBudgetBytes: Math.max(2, Math.floor((maxBytes - reserveBytes) / layerCount)),
  };
}

/**
 * Choose the longest slice of `items` from `offset` whose rendered page fits `maxBytes`.
 *
 * `build` renders the page for a candidate slice and its continuation flag. Apart from
 * the slice itself, the page may differ only by whether the slice is empty and by `more`,
 * so the envelope is measured at most four times and every item exactly once. The result
 * is the same slice the one-row-at-a-time search would have picked.
 */
export function fitPage<T>(options: {
  readonly items: readonly T[];
  readonly offset: number;
  readonly limit: number;
  readonly maxBytes: number;
  readonly build: (slice: readonly T[], more: boolean) => unknown;
}): { readonly slice: readonly T[]; readonly more: boolean } {
  const { items, offset, maxBytes, build } = options;
  const initial = Math.max(0, Math.min(options.limit, items.length - offset));
  const candidates = items.slice(offset, offset + initial);
  const sizes = candidates.map(jsonBytes);
  const prefix = [0];
  for (const size of sizes) prefix.push(prefix[prefix.length - 1]! + size);
  const envelopes = new Map<string, number>();
  const envelopeBytes = (more: boolean, nonEmpty: boolean): number => {
    const key = `${more}:${nonEmpty}`;
    let bytes = envelopes.get(key);
    if (bytes === undefined) {
      // JSON arrays are "[" + items joined by "," + "]": measure the page around one item.
      bytes = jsonBytes(build(nonEmpty ? candidates.slice(0, 1) : [], more)) - (nonEmpty ? sizes[0]! : 0);
      envelopes.set(key, bytes);
    }
    return bytes;
  };
  for (let count = initial; count >= 0; count -= 1) {
    const more = offset + count < items.length;
    const total = envelopeBytes(more, count > 0) + prefix[count]! + Math.max(0, count - 1);
    if (total <= maxBytes) return { slice: candidates.slice(0, count), more };
  }
  throw new MapServiceError('budgetExceeded');
}
