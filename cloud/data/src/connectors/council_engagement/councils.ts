/**
 * Greater Melbourne councils whose community engagement site runs on the
 * Social Pinpoint (Harvest Digital Planning) project list. Hosts and listing
 * paths were checked on 2026-10-04; see docs/source-policies/council-engagement-admission.md.
 *
 * Manningham and Kingston use EngagementHQ, and Nillumbik uses its own site.
 * Those three need different connectors and are intentionally absent.
 */
export interface EngagementCouncil {
  /** Stable slug, part of every source record ID. Never reuse or rename. */
  readonly id: string;
  readonly name: string;
  /** ABS ASGS LGA code; the 2025 boundary vintage is published by abs.asgs.boundaries. */
  readonly lgaCode: string;
  readonly host: string;
  /** Pages whose project-list blocks together cover the council's projects. */
  readonly listingPaths: readonly string[];
}

/**
 * The /projects list returns every project in one or a few pages. Home page
 * blocks are featured subsets paged three at a time, so they are not read.
 */
const DEFAULT_PATHS = ['/projects'] as const;

export const LGA_VINTAGE = '2025';

export const ENGAGEMENT_COUNCILS: readonly EngagementCouncil[] = [
  // participate.melbourne's /projects page is a map backed by an authenticated
  // vendor API; only the home page lists are read.
  { id: 'melbourne', name: 'City of Melbourne', lgaCode: '24600', host: 'participate.melbourne.vic.gov.au', listingPaths: ['/'] },
  { id: 'banyule', name: 'Banyule City Council', lgaCode: '20660', host: 'shaping.banyule.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'bayside', name: 'Bayside City Council', lgaCode: '20910', host: 'yoursay.bayside.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'boroondara', name: 'City of Boroondara', lgaCode: '21110', host: 'yoursay.boroondara.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'brimbank', name: 'Brimbank City Council', lgaCode: '21180', host: 'yoursay.brimbank.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'cardinia', name: 'Cardinia Shire Council', lgaCode: '21450', host: 'creating.cardinia.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'casey', name: 'City of Casey', lgaCode: '21610', host: 'conversations.casey.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'darebin', name: 'Darebin City Council', lgaCode: '21890', host: 'yoursay.darebin.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'frankston', name: 'Frankston City Council', lgaCode: '22170', host: 'engage.frankston.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'glen_eira', name: 'Glen Eira City Council', lgaCode: '22670', host: 'www.haveyoursaygleneira.com.au', listingPaths: DEFAULT_PATHS },
  { id: 'greater_dandenong', name: 'City of Greater Dandenong', lgaCode: '22830', host: 'yoursay.greaterdandenong.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'hobsons_bay', name: 'Hobsons Bay City Council', lgaCode: '23110', host: 'participate.hobsonsbay.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'hume', name: 'Hume City Council', lgaCode: '23270', host: 'participate.hume.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'knox', name: 'Knox City Council', lgaCode: '23670', host: 'haveyoursay.knox.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'maribyrnong', name: 'Maribyrnong City Council', lgaCode: '24330', host: 'www.yourcityyourvoice.com.au', listingPaths: DEFAULT_PATHS },
  { id: 'maroondah', name: 'Maroondah City Council', lgaCode: '24410', host: 'yoursay.maroondah.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'melton', name: 'City of Melton', lgaCode: '24650', host: 'conversations.melton.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'merri_bek', name: 'Merri-bek City Council', lgaCode: '25250', host: 'conversations.merri-bek.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'monash', name: 'City of Monash', lgaCode: '25340', host: 'shape.monash.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'moonee_valley', name: 'Moonee Valley City Council', lgaCode: '25060', host: 'yoursay.mvcc.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'mornington_peninsula', name: 'Mornington Peninsula Shire', lgaCode: '25310', host: 'shape.mornpen.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'port_phillip', name: 'City of Port Phillip', lgaCode: '25900', host: 'haveyoursay.portphillip.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'stonnington', name: 'City of Stonnington', lgaCode: '26350', host: 'connectstonnington.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'whitehorse', name: 'Whitehorse City Council', lgaCode: '26980', host: 'yoursay.whitehorse.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'whittlesea', name: 'City of Whittlesea', lgaCode: '27070', host: 'engage.whittlesea.vic.gov.au', listingPaths: DEFAULT_PATHS },
  { id: 'wyndham', name: 'Wyndham City Council', lgaCode: '27260', host: 'theloop.wyndham.vic.gov.au', listingPaths: ['/projects', '/closed-projects'] },
  { id: 'yarra', name: 'Yarra City Council', lgaCode: '27350', host: 'yoursayyarra.com.au', listingPaths: DEFAULT_PATHS },
  // /projects redirects to /consultations on this site.
  { id: 'yarra_ranges', name: 'Yarra Ranges Council', lgaCode: '27450', host: 'shaping.yarraranges.vic.gov.au', listingPaths: ['/consultations'] },
];
