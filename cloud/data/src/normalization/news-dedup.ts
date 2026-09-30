import { createHash } from 'node:crypto';

import type { FactProvenance, GeoRecordSource } from '../core/types.js';

export interface NewsEvidence {
  sourceId: string;
  sourceRecordId: string;
  versionId: string;
  nativeEventId: string | null;
  originalUrl: string;
  eventType: string | null;
  /** Source-confirmed occurrence time, never article publication or fetch time. */
  occurredAt: string | null;
  /** An official local area or incident site, never a mere place mention. */
  incidentAreaRef: string | null;
  locationPrecision: 'site' | 'local_area' | 'state_only' | 'unknown';
  sourceUpdatedAt: string | null;
  sourceVersionOrdinal: number | null;
  recordStatus: 'active' | 'corrected' | 'cancelled' | 'withdrawn';
  batchId?: string;
  fetchedAt?: string;
  schemaVersion?: number;
  evidenceRole?: string;
}

export interface NewsGroup {
  eventId: string;
  allVersions: readonly NewsEvidence[];
  currentVersions: readonly NewsEvidence[];
  originalUrls: readonly string[];
  requiresReview: boolean;
  geoRecordSources: readonly GeoRecordSource[];
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function canonicalArticleUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid article URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Article URL must use HTTP(S)');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

function identity(item: NewsEvidence): string {
  return `${item.sourceId}\u001f${item.sourceRecordId}`;
}

export function pairDecision(a: NewsEvidence, b: NewsEvidence): 'merge' | 'review' | 'separate' {
  if (identity(a) === identity(b)) return 'merge';
  if (a.sourceId === b.sourceId && a.nativeEventId !== null
    && a.nativeEventId === b.nativeEventId) return 'merge';
  if (canonicalArticleUrl(a.originalUrl) === canonicalArticleUrl(b.originalUrl)) return 'merge';
  if (a.sourceId === b.sourceId) return 'separate';
  if (a.eventType !== null && b.eventType !== null && a.eventType !== b.eventType) return 'separate';
  const aTime = a.occurredAt === null ? null : Date.parse(a.occurredAt);
  const bTime = b.occurredAt === null ? null : Date.parse(b.occurredAt);
  if ((aTime !== null && !Number.isFinite(aTime)) || (bTime !== null && !Number.isFinite(bTime))) {
    throw new Error('Invalid confirmed occurrence time');
  }
  if (aTime !== null && bTime !== null && Math.abs(aTime - bTime) > 3_600_000) return 'separate';
  const aPlace = a.locationPrecision === 'site' || a.locationPrecision === 'local_area'
    ? a.incidentAreaRef : null;
  const bPlace = b.locationPrecision === 'site' || b.locationPrecision === 'local_area'
    ? b.incidentAreaRef : null;
  if (aPlace !== null && bPlace !== null && aPlace !== bPlace) return 'separate';
  if (a.locationPrecision === 'state_only' && b.locationPrecision === 'state_only'
    && a.incidentAreaRef !== null && b.incidentAreaRef !== null
    && a.incidentAreaRef !== b.incidentAreaRef) {
    return 'separate';
  }
  const sameType = a.eventType !== null && b.eventType !== null && a.eventType === b.eventType;
  const sameTime = aTime !== null && bTime !== null && Math.abs(aTime - bTime) <= 3_600_000;
  const samePlace = aPlace !== null && bPlace !== null && aPlace === bPlace;

  // Cross-source merge requires at least two independent consistent facts
  // among: matching incident site, matching occurrence time window, and matching incident/entity semantics.
  // Native ID only applies within the same source publisher and cannot count as cross-source evidence (quality-rules.md §3).
  let matchingFacts = 0;
  if (sameTime) matchingFacts += 1;
  if (samePlace) matchingFacts += 1;
  if (sameType) matchingFacts += 1;

  if (matchingFacts >= 2) return 'merge';
  return 'review';
}

function latestVersions(items: readonly NewsEvidence[]): {
  current: NewsEvidence[];
  ambiguous: boolean;
} {
  const grouped = new Map<string, NewsEvidence[]>();
  for (const item of items) {
    grouped.set(identity(item), [...(grouped.get(identity(item)) ?? []), item]);
  }
  const current: NewsEvidence[] = [];
  let ambiguous = false;
  for (const versions of grouped.values()) {
    const ordered = [...versions].sort((a, b) => {
      const byTime = (b.sourceUpdatedAt ?? '').localeCompare(a.sourceUpdatedAt ?? '');
      return byTime || (b.sourceVersionOrdinal ?? -1) - (a.sourceVersionOrdinal ?? -1);
    });
    const latest = ordered[0];
    if (!latest) continue;
    const equalPosition = ordered.filter(item => item.sourceUpdatedAt === latest.sourceUpdatedAt
      && item.sourceVersionOrdinal === latest.sourceVersionOrdinal);
    if (new Set(equalPosition.map(item => item.versionId)).size > 1) {
      ambiguous = true;
      continue;
    }
    if (latest.recordStatus !== 'withdrawn' && latest.recordStatus !== 'cancelled') {
      current.push(latest);
    }
  }
  return { current, ambiguous };
}

/** Build GeoRecordSource links for all evidence items in a NewsGroup, preserving every source version link. */
export function buildNewsGeoRecordSources(
  group: Pick<NewsGroup, 'eventId' | 'allVersions'>,
  provenanceDefaults?: Partial<FactProvenance>
): GeoRecordSource[] {
  const seen = new Set<string>();
  const sources: GeoRecordSource[] = [];
  for (const item of group.allVersions) {
    const key = `${group.eventId}\u001f${item.sourceId}\u001f${item.sourceRecordId}\u001f${item.versionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const batchId = item.batchId ?? provenanceDefaults?.batch_id;
    const fetchedAt = item.fetchedAt ?? provenanceDefaults?.fetched_at;
    if (!batchId || !fetchedAt) {
      continue;
    }
    sources.push({
      batch_id: batchId,
      source_id: item.sourceId,
      schema_version: item.schemaVersion ?? provenanceDefaults?.schema_version ?? 1,
      fetched_at: fetchedAt,
      geo_record_id: group.eventId,
      version_id: item.versionId,
      source_record_id: item.sourceRecordId,
      source_version_id: item.versionId,
      evidence_role: item.evidenceRole ?? 'article_metadata',
      original_url: item.originalUrl,
    });
  }
  return sources;
}

/**
 * Reconcile evidence without deleting source rows or article links.
 *
 * Event ID generation is deterministic and stable:
 * - When `previousEventIds` is provided, existing event IDs are preserved across runs.
 *   If multiple previously separate events merge, `requiresReview` is flagged.
 * - In default calls (without `previousEventIds`), the event ID is derived from a SHA-256
 *   digest of deduplicated source record identities (`${sourceId}\u001f${sourceRecordId}`).
 *   Consequently, adding historical versions (e.g. corrected, withdrawn, or updated versions)
 *   of existing articles or permuting input order does not alter the generated eventId.
 * - Providing `previousEventIds` is only required when cross-source events merge over time
 *   and callers wish to preserve a previously published UUID/key rather than the content-derived hash.
 */
export function groupNewsEvidence(
  items: readonly NewsEvidence[],
  previousEventIds: ReadonlyMap<string, string> = new Map(),
  provenanceDefaults?: Partial<FactProvenance>
): {
  groups: readonly NewsGroup[];
  reviewPairs: readonly [string, string][];
} {
  const versions = [...items];
  const keys = new Set<string>();
  for (const item of versions) {
    const key = `${identity(item)}\u001f${item.versionId}`;
    if (keys.has(key)) throw new Error('Duplicate source version in news reconciliation');
    keys.add(key);
    canonicalArticleUrl(item.originalUrl);
  }
  const roots = versions.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (roots[root] !== root) root = roots[root] ?? root;
    return root;
  };
  const merge = (a: number, b: number) => { roots[find(b)] = find(a); };
  const reviewPairs: [string, string][] = [];
  for (let left = 0; left < versions.length; left += 1) {
    for (let right = left + 1; right < versions.length; right += 1) {
      const a = versions[left];
      const b = versions[right];
      if (!a || !b || find(left) === find(right)) continue;
      const decision = pairDecision(a, b);
      if (decision === 'merge') {
        const leftGroup = versions.filter((_, index) => find(index) === find(left));
        const rightGroup = versions.filter((_, index) => find(index) === find(right));
        const conflict = leftGroup.some(l => rightGroup.some(r => pairDecision(l, r) === 'separate'));
        if (!conflict) merge(left, right);
        else reviewPairs.push([identity(a), identity(b)]);
      } else if (decision === 'review') {
        reviewPairs.push([identity(a), identity(b)]);
      }
    }
  }
  const byRoot = new Map<number, NewsEvidence[]>();
  versions.forEach((item, index) => {
    const root = find(index);
    byRoot.set(root, [...(byRoot.get(root) ?? []), item]);
  });
  const groups = [...byRoot.values()].map(members => {
    const ordered = members.sort((a, b) => identity(a).localeCompare(identity(b))
      || a.versionId.localeCompare(b.versionId));
    const distinctIdentities = [...new Set(ordered.map(item => identity(item)))].sort();
    const previous = [...new Set(distinctIdentities.map(id => previousEventIds.get(id)).filter(
      (value): value is string => value !== undefined))].sort();
    const eventId = previous[0] ?? `event_${digest(distinctIdentities.join('\n'))}`;
    const latest = latestVersions(ordered);
    const originalUrls = [...new Set(ordered.map(item => item.originalUrl))].sort();
    const geoRecordSources = buildNewsGeoRecordSources({ eventId, allVersions: ordered }, provenanceDefaults);
    return {
      eventId,
      allVersions: ordered,
      currentVersions: latest.current,
      originalUrls,
      requiresReview: latest.ambiguous || previous.length > 1,
      geoRecordSources,
    };
  }).sort((a, b) => a.eventId.localeCompare(b.eventId));
  return { groups, reviewPairs };
}
