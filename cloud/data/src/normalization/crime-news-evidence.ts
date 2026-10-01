import { createHash } from 'node:crypto';
import { z } from 'zod';

import { articleUrl } from '../connectors/gdelt/index.js';
import type { ConnectorSuccess } from '../core/connector.js';
import type { GeoRecord, SourceRecord } from '../core/types.js';

const POLICY = 'crime-publication-evidence-v1';
const CANDIDATE_POLICY = 'gdelt-crime-candidate-v1';
// Exact identifiers in GDELT's official Themes lookup; this subset is a Melens policy.
const CRIME_THEMES = new Set([
  'SOC_GENERALCRIME', 'UNGP_CRIME_VIOLENCE', 'WB_1014_CRIMINAL_JUSTICE',
  'WB_2453_ORGANIZED_CRIME', 'DRUG_TRADE', 'TAX_FNCACT_CRIMINAL',
]);
const CRIME_TITLE = /\b(?:murder(?:s|ed|er|ers)?|homicides?|manslaughter|arson|robber(?:y|ies)|burglar(?:y|ies)|thefts?|stolen|blackmail|rape(?:s|d)?|fraud|kidnap(?:s|ped|ping)?|assault(?:s|ed)?|stabb(?:ed|ing|ings)|shootings?|shot dead|drug trafficking|sexual offences?)\b/gi;
const POLICY_TITLE = /\b(?:laws?|legislation|bills?|polic(?:y|ies)|reforms?|regulations?)\b/i;
const VERIFIED_TIME_REASON = 'Incident time is absent; original publication instant was verified by one bounded publisher-head metadata check under crime-publication-evidence-v1';
const evidenceSchema = z.object({
  originalUrl: z.url(),
  publishedAt: z.iso.datetime(),
  checkedAt: z.iso.datetime(),
  reportedArea: z.string().min(1),
  reportKind: z.enum(['investigation', 'sentencing', 'arson_investigation', 'charges', 'trial', 'court_disposition']),
  legalStatus: z.string().min(1),
});
export type VerifiedCrimeNewsEvidence = z.infer<typeof evidenceSchema>;

/** One reviewed sample. This module makes no requests to publishers. */
export const VERIFIED_CRIME_NEWS_EVIDENCE: readonly VerifiedCrimeNewsEvidence[] = z.array(evidenceSchema).parse([
  {
    originalUrl: 'https://www.abc.net.au/news/2026-09-07/melbourne-thomastown-fatal-shooting/107122646',
    publishedAt: '2026-09-06T19:56:42Z', checkedAt: '2026-10-01T11:10:50.982Z',
    reportedArea: 'Thomastown, Greater Melbourne, Victoria', reportKind: 'investigation',
    legalStatus: 'Reported homicide investigation; this report is not a conviction',
  },
  {
    originalUrl: 'https://www.abc.net.au/news/2026-09-08/keilor-cafe-shooting-gavin-preston-sentencing/107127386',
    publishedAt: '2026-09-08T01:15:43Z', checkedAt: '2026-10-01T11:10:53.701Z',
    reportedArea: 'Keilor, Greater Melbourne, Victoria', reportKind: 'sentencing',
    legalStatus: 'Sentencing report concerning a 2023 shooting; publication time is not incident time',
  },
  {
    originalUrl: 'https://www.abc.net.au/news/2026-09-11/victoria-melton-arson-attack-ballarat-omcg-bandidos/107143230',
    publishedAt: '2026-09-11T03:44:29Z', checkedAt: '2026-10-01T11:10:56.529Z',
    reportedArea: 'Melton, Greater Melbourne, Victoria; investigation includes Ballarat', reportKind: 'arson_investigation',
    legalStatus: 'Reported arrests in an alleged arson investigation; guilt is not inferred',
  },
  {
    originalUrl: 'https://www.abc.net.au/news/2026-09-23/counter-terrorism-police-arrest-melbourne-man-alleged-isis-link/107185494',
    publishedAt: '2026-09-23T02:03:22Z', checkedAt: '2026-10-01T11:10:59.026Z',
    reportedArea: 'Carlton, Melbourne, Victoria', reportKind: 'charges',
    legalStatus: 'Reported terrorism charges; the accused denies the charges; no conviction is inferred',
  },
  {
    originalUrl: 'https://www.abc.net.au/news/2026-09-28/deer-park-machete-murder-trial-victorian-supreme-court/107205524',
    publishedAt: '2026-09-28T11:41:51Z', checkedAt: '2026-10-01T11:11:01.234Z',
    reportedArea: 'Deer Park, Greater Melbourne, Victoria', reportKind: 'trial',
    legalStatus: 'Reported murder trial concerning a 2024 incident; the accused pleads not guilty',
  },
  {
    originalUrl: 'https://www.abc.net.au/news/2026-10-01/ex-cfmeu-delegate-joel-leavitt-blackmail-charge-dropped/107217902',
    publishedAt: '2026-10-01T08:15:05Z', checkedAt: '2026-10-01T11:11:03.716Z',
    reportedArea: 'Brooklyn and Eltham, Greater Melbourne, Victoria', reportKind: 'court_disposition',
    legalStatus: 'Blackmail charge withdrawn; report describes convictions for other offences; no blackmail conviction is inferred',
  },
]);

const evidenceByUrl = new Map<string, VerifiedCrimeNewsEvidence>();
for (const evidence of VERIFIED_CRIME_NEWS_EVIDENCE) {
  const url = articleUrl(evidence.originalUrl);
  if (url === null || evidenceByUrl.has(url)
    || Date.parse(evidence.publishedAt) > Date.parse(evidence.checkedAt)) {
    throw new Error('Crime publication evidence contains an invalid URL, duplicate, or future timestamp');
  }
  evidenceByUrl.set(url, evidence);
}
const summarySchema = z.record(z.string(), z.unknown());
const markerSchema = z.object({
  crime_news_evidence: z.object({ policy: z.literal(POLICY), evidence_hash: z.string() }),
});
const candidateMetadataSchema = z.object({
  news_scope: z.enum(['city', 'greater_melbourne']),
  location_reason: z.literal('official_place_mention'),
  themes: z.array(z.string()),
});
const candidateMarkerSchema = z.object({
  crime_news_evidence: z.object({
    policy: z.literal(CANDIDATE_POLICY), status: z.literal('gdelt_theme_candidate'),
    evidence_hash: z.string(),
  }),
});

function evidenceFor(url: string | null): VerifiedCrimeNewsEvidence | undefined {
  const key = url === null ? null : articleUrl(url);
  return key === null ? undefined : evidenceByUrl.get(key);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function identity(id: string, version: string): string {
  return `${id}\0${version}`;
}

function parseSummary(summary: string | null): Record<string, unknown> {
  if (summary === null) return {};
  try {
    const parsed: unknown = JSON.parse(summary);
    return summarySchema.parse(parsed);
  } catch {
    return { original_metadata_summary: summary };
  }
}

function candidateEvidence(record: GeoRecord, summary: Record<string, unknown>) {
  const metadata = candidateMetadataSchema.safeParse(summary);
  if (!metadata.success || record.area_refs.length === 0 || record.title === null
    || !['mentioned_place', 'unknown'].includes(record.location_role)
    || POLICY_TITLE.test(record.title)) return null;
  const matchedThemes = [...new Set(metadata.data.themes.filter(theme => CRIME_THEMES.has(theme)))].sort();
  const titleTerms = [...new Set((record.title.match(CRIME_TITLE) ?? []).map(term => term.toLowerCase()))].sort();
  if (matchedThemes.length === 0 || titleTerms.length === 0) return null;
  return {
    policy: CANDIDATE_POLICY, status: 'gdelt_theme_candidate',
    local_occurrence: 'unverified', review_required: true,
    news_scope: metadata.data.news_scope, area_refs: [...record.area_refs],
    matched_gdelt_themes: matchedThemes,
    headline_evidence: { source: 'gdelt_metadata_title', title: record.title, matched_terms: titleTerms },
    geographic_precision: 'mentioned_area_only_no_incident_point',
    publication_time_status: record.published_at === null ? 'not_provided' : 'provided_by_prior_enrichment',
    review_method: 'conservative_metadata_filter',
  };
}

/** Classify new metadata candidates and apply reviewed instants to exact URLs. */
export function enrichVerifiedCrimeNews(result: ConnectorSuccess): ConnectorSuccess {
  if (result.sourceId !== 'gdelt.news') return result;
  const sourceVersions = new Map<string, string>();
  const sourceEvidence = new Map<string, VerifiedCrimeNewsEvidence>();
  const sourceFacts = new Map(result.sourceRecords.map(record => [
    identity(record.source_record_id, record.version_id), record,
  ]));
  const sourceRecords: SourceRecord[] = result.sourceRecords.map(record => {
    const evidence = evidenceFor(record.original_url);
    if (record.source_id !== 'gdelt.news' || evidence === undefined) return record;
    if (record.published_at !== null && Date.parse(record.published_at) !== Date.parse(evidence.publishedAt)) {
      throw new Error('Crime source publication timestamp conflicts with the verified sample');
    }
    if (Date.parse(evidence.publishedAt) > Date.parse(record.fetched_at)) {
      throw new Error('Crime publication evidence is later than this record fetch');
    }
    const versionId = record.time_missing_reason === VERIFIED_TIME_REASON
      && Date.parse(record.published_at ?? '') === Date.parse(evidence.publishedAt)
      ? record.version_id
      : digest(`${record.version_id}\0${POLICY}\0${evidence.originalUrl}\0${evidence.publishedAt}`);
    const key = identity(record.source_record_id, record.version_id);
    sourceVersions.set(key, versionId);
    sourceEvidence.set(key, evidence);
    return { ...record, version_id: versionId, published_at: evidence.publishedAt,
      time_missing_reason: VERIFIED_TIME_REASON };
  });

  const geoVersions = new Map<string, string>();
  const geoRecords: GeoRecord[] = result.geoRecords.map(record => {
    const evidence = evidenceFor(record.original_url);
    if (record.source_id !== 'gdelt.news') return record;
    const links = result.geoRecordSources.filter(link => link.source_id === 'gdelt.news'
      && link.geo_record_id === record.geo_record_id && link.version_id === record.version_id);
    const summary = parseSummary(record.summary);
    if (evidence === undefined) {
      const candidate = candidateEvidence(record, summary);
      if (candidate === null) return record;
      const url = record.original_url === null ? null : articleUrl(record.original_url);
      if (url === null || !links.some(link => {
        const source = sourceFacts.get(identity(link.source_record_id, link.source_version_id));
        return source?.source_id === 'gdelt.news' && source.original_url !== null
          && articleUrl(source.original_url) === url && link.original_url !== null
          && articleUrl(link.original_url) === url;
      })) throw new Error('Crime candidate lacks its matching GDELT source metadata');
      const evidenceHash = digest(JSON.stringify(candidate));
      const marker = candidateMarkerSchema.safeParse(summary);
      const versionId = marker.success && marker.data.crime_news_evidence.evidence_hash === evidenceHash
        && record.topic === 'crime_news'
        ? record.version_id : digest(`${record.version_id}\0${CANDIDATE_POLICY}\0${evidenceHash}`);
      geoVersions.set(identity(record.geo_record_id, record.version_id), versionId);
      return { ...record, version_id: versionId, topic: 'crime_news',
        summary: JSON.stringify({ ...summary, crime_news_evidence: { ...candidate, evidence_hash: evidenceHash } }) };
    }
    if (!links.some(link => sourceEvidence.get(identity(link.source_record_id, link.source_version_id)) === evidence
      && evidenceFor(link.original_url) === evidence)) {
      throw new Error('Crime geographic record lacks its matching verified source fact');
    }
    if (record.published_at !== null && Date.parse(record.published_at) !== Date.parse(evidence.publishedAt)) {
      throw new Error('Crime geographic publication timestamp conflicts with the verified sample');
    }
    const marker = markerSchema.safeParse(summary);
    const evidenceHash = digest(JSON.stringify(evidence));
    const versionId = marker.success && marker.data.crime_news_evidence.evidence_hash === evidenceHash
      && record.topic === 'crime_news' && record.published_at === evidence.publishedAt
      ? record.version_id
      : digest(`${record.version_id}\0${POLICY}\0${evidenceHash}`);
    geoVersions.set(identity(record.geo_record_id, record.version_id), versionId);
    return {
      ...record, version_id: versionId, topic: 'crime_news', published_at: evidence.publishedAt,
      summary: JSON.stringify({ ...summary, crime_news_evidence: {
        policy: POLICY, status: 'verified_sample_metadata', original_url: evidence.originalUrl,
        evidence_hash: evidenceHash,
        published_at: evidence.publishedAt, precision: 'second', checked_at: evidence.checkedAt,
        time_evidence_kind: 'matching_html_head_meta_and_jsonld_datePublished',
        reported_area: evidence.reportedArea, report_kind: evidence.reportKind,
        legal_status: evidence.legalStatus,
        geographic_precision: 'reported_area_only_no_incident_point',
        review_method: 'one_source_metadata_sample_check',
      } }),
    };
  });

  const geoRecordSources = result.geoRecordSources.map(link => link.source_id !== 'gdelt.news' ? link : {
    ...link,
    version_id: geoVersions.get(identity(link.geo_record_id, link.version_id)) ?? link.version_id,
    source_version_id: sourceVersions.get(identity(link.source_record_id, link.source_version_id)) ?? link.source_version_id,
  });
  const changed = sourceRecords.some((record, index) => record.version_id !== result.sourceRecords[index]?.version_id)
    || geoRecords.some((record, index) => record.version_id !== result.geoRecords[index]?.version_id);
  const sourceRevision = changed ? digest(JSON.stringify({
    upstream: result.sourceRevision, policies: [POLICY, CANDIDATE_POLICY],
    sourceVersions: sourceRecords.map(record => identity(record.source_record_id, record.version_id)).sort(),
    geoVersions: geoRecords.map(record => identity(record.geo_record_id, record.version_id)).sort(),
  })) : result.sourceRevision;
  return { ...result, sourceRecords, geoRecords, geoRecordSources, sourceRevision };
}
