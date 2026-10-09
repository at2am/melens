import { MapContractError } from './contracts/map-contract.js';

/** One public error vocabulary for the HTTP boundary, the query runner and the services. */
export const MAP_ERROR_CODES = {
  invalidRequest: { status: 400, retryable: false },
  cursorMismatch: { status: 400, retryable: false },
  notFound: { status: 404, retryable: false },
  notAvailable: { status: 410, retryable: false },
  snapshotExpired: { status: 409, retryable: false },
  rateLimited: { status: 429, retryable: true },
  budgetExceeded: { status: 503, retryable: false },
  queryTimeout: { status: 504, retryable: true },
  serviceUnavailable: { status: 503, retryable: true },
} as const satisfies Record<string, { status: number; retryable: boolean }>;

export type MapServiceErrorCode = keyof typeof MAP_ERROR_CODES;
/** The subset a BigQuery view read can produce on its own. */
export type MapQueryErrorCode = Extract<MapServiceErrorCode,
  'invalidRequest' | 'cursorMismatch' | 'notAvailable' | 'budgetExceeded' | 'queryTimeout' | 'serviceUnavailable'>;

export class MapServiceError extends Error {
  constructor(readonly code: MapServiceErrorCode) {
    super(`Map request failed: ${code}`);
    this.name = 'MapServiceError';
  }
}

/** Never attach SDK messages, SQL, project paths, job IDs, or row contents. */
export class MapQueryError extends Error {
  readonly messageKey: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(readonly code: MapQueryErrorCode) {
    super(`Map query failed: ${code}`);
    this.name = 'MapQueryError';
    this.messageKey = `map.error.${code}`;
    this.status = MAP_ERROR_CODES[code].status;
    this.retryable = MAP_ERROR_CODES[code].retryable;
  }
}

/** The code a client may see for any failure; unknown errors never leak their cause. */
export function mapErrorCode(error: unknown): MapServiceErrorCode {
  if (error instanceof MapServiceError || error instanceof MapQueryError || error instanceof MapContractError) {
    return error.code;
  }
  return 'serviceUnavailable';
}
