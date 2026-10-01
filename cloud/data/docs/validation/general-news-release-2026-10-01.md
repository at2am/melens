# General news release evidence, 2026-10-01

This record covers the GDELT category code, bounded source reads and the coordinating release agent's real Cloud Run and BigQuery readback on October 1. The cloud facts below were supplied by that agent after actual execution; this documentation update made no additional authenticated cloud calls. Local candidate files and fixtures are separate from the production evidence.

## Completed code

- GDELT metadata admission records the official redistribution terms, attribution, allowed fields, reviewed owner, 160-request project daily cap, zero raw retention and one-day staging.
- HTTP reads now stream into a 32 MB compressed bound and cancel an oversized response. Retries are disabled at the connector so each file consumes one reviewed request. Expanded CSV and row bounds are checked. Missing, duplicate, corrupt, invalid UTF-8 or malformed archives fail the entire window.
- PAGE_TITLE metadata is decoded from Extras. All country/location evidence survives parsing and URL deduplication.
- `withPublishedNewsLocations` loads published official boundary references and preserves mentioned-place or unknown precision. No Point is produced. Geographic versions and source links remain consistent after normalization.
- News views expose GKG processing time, source publication-time availability and mention scope. The Melbourne news view keeps the role and confidence columns. Source evidence requires the same published batch as its referenced source and geographic facts.

## Real bounded reads

| Requested UTC window | Outcome | Unique Victoria candidates | Melbourne-name mentions | Supplied titles |
| --- | --- | ---: | ---: | ---: |
| 2026-09-06 20:15 to 20:30 | Complete archive; cloud backfill published successfully | 12 | 6 | 12 |
| 2026-09-08 03:45 to 04:00 | Complete archive; cloud backfill published successfully | 15 | 14 | 15 |
| 2026-09-11 04:00 to 04:15 | Complete archive; cloud backfill published successfully | 25 | 21 | 25 |
| 2026-09-23 03:00 to 03:15 | Complete archive; cloud backfill published successfully | 11 | Not recounted | 11 |
| 2026-09-28 12:45 to 13:00 | Complete archive; cloud backfill published successfully | 9 | 8 | 9 |
| 2026-09-29 10:30 to 10:45 | Complete archive; cloud backfill published successfully | 23 | 20 | 23 |
| 2026-09-30 10:30 to 10:45 | Rejected, official expanded CSV contains invalid UTF-8 | Not published | Not published | Not published |
| 2026-10-01 10:30 to 10:45 | Complete archive; cloud backfill published successfully | 15 | 12 | 15 |

These are discrete processing windows. Their intervals do not prove coverage of the gaps between them. The counts above identify GKG article candidates and exact Melbourne mention names from the bounded local read before official-boundary normalization. They do not count local occurrences or independently adjudicated logical events. GKG processing dates are separate from publication dates: publisher timestamps remain absent for candidates outside the finite general and crime evidence catalogues.

The October 1 10:30 archive had 4,747,178 compressed bytes. No full global response or publisher body was retained. Temporary local files contain permitted candidate metadata for coordination with the crime coverage agent.

## Validation and outstanding acceptance

The GKG, publication-normalization, publisher-publication-evidence, location and deduplication suites passed 43 of 43 tests under Node.js 24.21.0 on October 1. The latest shared `npm run build` also completed successfully after the root-owned publisher integration was repaired.

### Real publication and natural scheduling

The coordinating release agent confirmed all seven discrete cloud backfills succeeded using the guarded manual ingestion entrypoint. Actual BigQuery readback matched all ten distinct general publication-catalogue logical events across three publisher dates. All ten catalogue reports have official `area_refs`; there are zero Point geometries. These area references describe permitted place mentions and do not establish ten incident sites. The separate crime catalogue returned six verified sample reports across six publisher dates, also with zero Point geometries.

The release readback reports 12 sources in the published release cohort. GDELT contributes one source, `gdelt.news`, shared by general and crime news. This count does not convert other registry candidates into admitted or published sources.

| Natural Scheduler trigger, UTC | Execution suffix | Observed state |
| --- | --- | --- |
| 2026-10-01 12:30 | `fxdsl` | Completed successfully |
| 2026-10-01 12:45 | `gg8dj` | Started; completion not established in this record |

These are natural Scheduler executions, separate from manual historical backfills. One successful execution proves that the deployed schedule can collect and publish; a full 24-hour continuous run, quota compliance and freshness acceptance remain incomplete. The seven historical windows do not advance a contiguous checkpoint across their uncollected gaps.

The read-only `four-category-readback.sql` now reports all general candidate logical keys without labelling them verified. A separate query checks the ten exact general catalogue keys, GKG identifiers, original publisher timestamps and publication-evidence status. Crime totals are grouped as `verified_sample_metadata`, `gdelt_theme_candidate` or unclassified; only the six finite verified sample URLs count toward the crime coverage gate.

GKG processing dates cannot satisfy the publisher-date requirement. The SC004 fixed 40-story benchmark still requires two independent human reviewers and adjudication. Its matching, location and precision acceptance remains pending; finite metadata catalogue checks do not certify that benchmark.

## Ten representative publication facts

The integrator read bounded public publisher head metadata and retained only publication timestamp fields, URLs and evidence metadata. Responses were HTTP 200; reading stopped at `</head>` and cancelled the stream. Each response was bounded at 512 KB, with observed reads between 16 KB and 150 KB. There were no automated article-body copies or access-control workarounds. A first parser pass missed Nine/AFR meta tags, so the corrective pass specifically extracted `article:published_time` rather than treating `dateModified` or URL dates as publication dates.

The source timestamps and GKG native IDs are stored in `news-publication-evidence.ts`. Original offsets are preserved in evidence and converted to UTC only for `published_at`. Incident time remains unknown. These ten distinct representative report subjects are a coverage sample. Their existing GKG Victorian mentions establish a mentioned-place relation; this review does not assert that each event occurred in Melbourne.

| Representative subject | Primary source | GKG native record | Source publication UTC |
| --- | --- | --- | --- |
| Greens leadership resignation | [SBS](https://www.sbs.com.au/news/article/greens-leader-larissa-waters-to-step-down-due-to-illness/x2xwk0c1r) | 20260928124500-926 | 2026-09-28T10:20:40.265Z |
| Royal Show poultry cancellation | [The Age](https://www.theage.com.au/national/victoria/poultry-fanciers-show-dreams-fail-to-hatch-after-bird-flu-scare-20260929-p60tuo.html) | 20260929103000-530 | 2026-09-29T09:40:00Z |
| Footscray hospital capacity report | [The Age](https://www.theage.com.au/national/victoria/discharging-themselves-in-disgust-funding-shortfall-leaves-new-1-5b-footscray-hospital-understaffed-beds-closed-20260929-p610kw.html) | 20260929103000-41 | 2026-09-29T09:39:39Z |
| Mushroom headquarters sale listing | [AFR](https://www.afr.com/property/commercial/rock-and-roll-real-estate-mushroom-s-melbourne-hq-up-for-grabs-20260929-p611a5) | 20260929103000-209 | 2026-09-29T07:31:08Z |
| Homelessness outreach services report | [The Age](https://www.theage.com.au/national/victoria/queues-at-9am-full-by-11-30am-housing-crunch-challenges-rough-sleeping-plan-20260929-p611cv.html) | 20260929103000-384 | 2026-09-29T09:54:48Z |
| Orica regulation statement | [AFR](https://www.afr.com/policy/economy/take-a-hammer-to-this-orica-ceo-says-regulation-hurting-productivity-20260929-p611am) | 20260929103000-871 | 2026-09-29T04:19:32Z |
| Malthouse 2027 program announcement | [SMH](https://www.smh.com.au/culture/theatre/malthouse-program-2027-20261001-p611z6.html) | 20261001103000-851 | 2026-10-01T09:30:00Z |
| Medical recording identity-law report | [Brisbane Times](https://www.brisbanetimes.com.au/national/victoria/a-doctor-filmed-alice-without-her-consent-the-law-stopped-her-knowing-who-he-was-20261001-p60uf9.html) | 20261001103000-411 | 2026-10-01T09:30:00Z |
| Player contract future report | [Zero Tackle](https://www.zerotackle.com/brandon-smith-makes-call-on-rabbitohs-future-ahead-of-november-1-238605) | 20261001103000-173 | 2026-10-01T05:19:07Z |
| Land Forces police exclusion powers | [ABC](https://www.abc.net.au/news/2026-10-01/people-banned-protesting-land-forces-police-additional-powers/107215944) | 20261001103000-92 | 2026-10-01T09:38:10Z |

The separate syndicated Malthouse and medical-recording URLs were excluded from this ten-report count. The finite publication catalogue does not automatically merge other reports by matching titles or convert a mentioned location into an occurrence site.
