import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { ConnectorSuccess } from '../core/connector.js';
import { canonicalArticleUrl } from './news-dedup.js';

const publicationEvidenceSchema = z.object({
  articleUrl: z.url(), sourceTimestamp: z.iso.datetime({ offset: true }),
  metadataField: z.enum(['article:published_time', 'publish_date', 'datePublished']),
  logicalEventKey: z.string().min(1), gkgRecordId: z.string().min(1),
  checkedAt: z.iso.datetime(),
});

const CHECKED_AT = '2026-10-01T11:16:56Z';

/** One representative per independently distinct report, verified against publisher head metadata.
 * This finite evidence catalogue does not certify the 40-story human benchmark or local occurrence.
 */
export const verifiedNewsPublicationEvidence = z.array(publicationEvidenceSchema).parse([
  { articleUrl: 'https://www.sbs.com.au/news/article/greens-leader-larissa-waters-to-step-down-due-to-illness/x2xwk0c1r',
    sourceTimestamp: '2026-09-28T10:20:40.265Z', metadataField: 'publish_date',
    logicalEventKey: 'greens-waters-resignation-20260928', gkgRecordId: '20260928124500-926', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.theage.com.au/national/victoria/poultry-fanciers-show-dreams-fail-to-hatch-after-bird-flu-scare-20260929-p60tuo.html',
    sourceTimestamp: '2026-09-29T09:40:00.000+00:00', metadataField: 'article:published_time',
    logicalEventKey: 'royal-show-poultry-cancellation-20260929', gkgRecordId: '20260929103000-530', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.theage.com.au/national/victoria/discharging-themselves-in-disgust-funding-shortfall-leaves-new-1-5b-footscray-hospital-understaffed-beds-closed-20260929-p610kw.html',
    sourceTimestamp: '2026-09-29T09:39:39.000+00:00', metadataField: 'article:published_time',
    logicalEventKey: 'footscray-hospital-capacity-report-20260929', gkgRecordId: '20260929103000-41', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.afr.com/property/commercial/rock-and-roll-real-estate-mushroom-s-melbourne-hq-up-for-grabs-20260929-p611a5',
    sourceTimestamp: '2026-09-29T07:31:08Z', metadataField: 'article:published_time',
    logicalEventKey: 'mushroom-hq-property-listing-20260929', gkgRecordId: '20260929103000-209', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.theage.com.au/national/victoria/queues-at-9am-full-by-11-30am-housing-crunch-challenges-rough-sleeping-plan-20260929-p611cv.html',
    sourceTimestamp: '2026-09-29T09:54:48.000+00:00', metadataField: 'article:published_time',
    logicalEventKey: 'victoria-homelessness-outreach-report-20260929', gkgRecordId: '20260929103000-384', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.afr.com/policy/economy/take-a-hammer-to-this-orica-ceo-says-regulation-hurting-productivity-20260929-p611am',
    sourceTimestamp: '2026-09-29T04:19:32Z', metadataField: 'article:published_time',
    logicalEventKey: 'orica-productivity-regulation-statement-20260929', gkgRecordId: '20260929103000-871', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.smh.com.au/culture/theatre/malthouse-program-2027-20261001-p611z6.html',
    sourceTimestamp: '2026-10-01T09:30:00.000+00:00', metadataField: 'article:published_time',
    logicalEventKey: 'malthouse-2027-program-announcement-20261001', gkgRecordId: '20261001103000-851', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.brisbanetimes.com.au/national/victoria/a-doctor-filmed-alice-without-her-consent-the-law-stopped-her-knowing-who-he-was-20261001-p60uf9.html',
    sourceTimestamp: '2026-10-01T09:30:00.000+00:00', metadataField: 'article:published_time',
    logicalEventKey: 'medical-recording-identity-law-report-20261001', gkgRecordId: '20261001103000-411', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.zerotackle.com/brandon-smith-makes-call-on-rabbitohs-future-ahead-of-november-1-238605',
    sourceTimestamp: '2026-10-01T05:19:07+00:00', metadataField: 'datePublished',
    logicalEventKey: 'brandon-smith-contract-future-report-20261001', gkgRecordId: '20261001103000-173', checkedAt: CHECKED_AT },
  { articleUrl: 'https://www.abc.net.au/news/2026-10-01/people-banned-protesting-land-forces-police-additional-powers/107215944',
    sourceTimestamp: '2026-10-01T09:38:10+00:00', metadataField: 'article:published_time',
    logicalEventKey: 'land-forces-police-exclusion-powers-20261001', gkgRecordId: '20261001103000-92', checkedAt: CHECKED_AT },
]);

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Attach source publication facts only to the exact canonical URLs observed in real GKG reads. */
export function withVerifiedNewsPublicationEvidence(result: ConnectorSuccess): ConnectorSuccess {
  if (result.sourceId !== 'gdelt.news') return result;
  const catalogue = new Map(verifiedNewsPublicationEvidence.map(evidence =>
    [canonicalArticleUrl(evidence.articleUrl), evidence]));
  const sourceVersions = new Map<string, string>();
  const sourceRecords = result.sourceRecords.map(record => {
    const evidence = record.original_url === null ? undefined
      : catalogue.get(canonicalArticleUrl(record.original_url));
    if (!evidence) return record;
    const version = digest({ policy: 'publisher-publication-evidence-v1',
      sourceVersion: record.version_id, evidence });
    sourceVersions.set(record.source_record_id, version);
    return { ...record, version_id: version,
      published_at: new Date(evidence.sourceTimestamp).toISOString(),
      time_missing_reason: 'Publisher publication metadata is verified; incident time is not provided',
    };
  });
  const geoVersions = new Map<string, string>();
  const geoRecords = result.geoRecords.map(record => {
    const evidence = record.original_url === null ? undefined
      : catalogue.get(canonicalArticleUrl(record.original_url));
    if (!evidence) return record;
    const originalSummary: unknown = JSON.parse(record.summary ?? '{}');
    const metadata = z.record(z.string(), z.unknown()).parse(originalSummary);
    const version = digest({ policy: 'publisher-publication-evidence-v1',
      geographicVersion: record.version_id, evidence });
    geoVersions.set(record.geo_record_id, version);
    return { ...record, version_id: version,
      published_at: new Date(evidence.sourceTimestamp).toISOString(),
      summary: JSON.stringify({ ...metadata, publication_time_status: 'source_provided',
        logical_event_key: evidence.logicalEventKey,
        source_publication_evidence: {
          url: evidence.articleUrl, field: evidence.metadataField,
          source_timestamp: evidence.sourceTimestamp, precision: 'timestamp_with_offset',
          checked_at: evidence.checkedAt, gkg_record_id: evidence.gkgRecordId,
          method: 'bounded_publisher_head_metadata_review',
        },
      }),
    };
  });
  const geoRecordSources = result.geoRecordSources.map(link => ({
    ...link, version_id: geoVersions.get(link.geo_record_id) ?? link.version_id,
    source_version_id: sourceVersions.get(link.source_record_id) ?? link.source_version_id,
  }));
  return { ...result, sourceRecords, geoRecords, geoRecordSources,
    sourceRevision: digest({ upstream: result.sourceRevision,
      sourceVersions: [...sourceVersions.entries()].sort(), geoVersions: [...geoVersions.entries()].sort() }),
  };
}
