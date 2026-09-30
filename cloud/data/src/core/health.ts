import type { DataSource, FreshnessState } from './types.js';

export interface SourceHealthInput {
  source: DataSource;
  now: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  latestCheckSucceeded: boolean | null;
  latestUpstreamUpdateAt: string | null;
  consecutiveFailures: number;
  knownGapCount: number;
}

export interface SourceHealth {
  state: FreshnessState;
  budgetSeconds: number | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  latestUpstreamUpdateAt: string | null;
  consecutiveFailures: number;
  knownGapCount: number;
  reason: string;
}

export function computeSourceHealth(input: SourceHealthInput): SourceHealth {
  const interval = input.source.cadence_seconds ?? input.source.check_interval_seconds;
  const budgetSeconds = interval === null ? null : interval * 2;
  const base = { budgetSeconds, lastCheckedAt: input.lastCheckedAt,
    lastSuccessAt: input.lastSuccessAt, latestUpstreamUpdateAt: input.latestUpstreamUpdateAt,
    consecutiveFailures: input.consecutiveFailures, knownGapCount: input.knownGapCount };
  if (input.source.license_status === 'review_required' || input.source.access_status !== 'active') {
    return { ...base, state: 'unknown', reason: 'source admission or access is not active' };
  }
  if (budgetSeconds === null || input.lastSuccessAt === null || input.lastCheckedAt === null
    || input.latestCheckSucceeded === null) {
    return { ...base, state: 'unknown', reason: 'monitoring or check evidence is missing' };
  }
  const now = Date.parse(input.now);
  const lastSuccess = Date.parse(input.lastSuccessAt);
  const lastCheck = Date.parse(input.lastCheckedAt);
  if (!Number.isFinite(now) || !Number.isFinite(lastSuccess) || !Number.isFinite(lastCheck)
    || lastSuccess > now || lastCheck > now || input.consecutiveFailures < 0 || input.knownGapCount < 0) {
    return { ...base, state: 'unknown', reason: 'invalid time or failure evidence' };
  }
  const ageSeconds = (now - lastSuccess) / 1000;
  if (ageSeconds > budgetSeconds * 2) {
    return { ...base, state: 'stale', reason: 'last successful check exceeds twice the freshness budget' };
  }
  if (ageSeconds > budgetSeconds) {
    return { ...base, state: 'late', reason: 'last successful check exceeds the freshness budget' };
  }
  if (!input.latestCheckSucceeded || input.knownGapCount > 0) {
    return { ...base, state: 'unknown', reason: 'latest check failed or a coverage gap is known' };
  }
  return { ...base, state: 'current', reason: 'latest check succeeded within the freshness budget' };
}

export type CoverageStatus =
  | 'covered' | 'no_matching_records' | 'not_covered' | 'source_unavailable' | 'unknown';

export function computeCoverageStatus(input: {
  coveringSources: readonly SourceHealth[];
  matchingRecords: number;
  completeWindow: boolean;
}): CoverageStatus {
  if (!Number.isInteger(input.matchingRecords) || input.matchingRecords < 0) {
    throw new Error('Invalid matching record count');
  }
  if (input.coveringSources.length === 0) return 'not_covered';
  const allUnavailable = input.coveringSources.every(source =>
    source.state === 'stale' || (source.consecutiveFailures > 0 && source.lastSuccessAt === null));
  if (allUnavailable) return 'source_unavailable';
  if (!input.completeWindow || input.coveringSources.some(source => source.state !== 'current'
    || source.knownGapCount > 0 || source.consecutiveFailures > 0)) return 'unknown';
  return input.matchingRecords > 0 ? 'covered' : 'no_matching_records';
}
