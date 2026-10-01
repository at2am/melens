# Crime news release evidence, 2026-10-01

## Delivery status

The release integrator confirmed actual cloud publication and BigQuery readback on 2026-10-01. The six reviewed reports and the CSA statistics are now queryable. A subsequent conservative candidate-classification update closes the automatic classification gap for new crime-related articles; its local verification is recorded separately from the already completed cloud readback.

| Work | Evidence |
| --- | --- |
| Existing crime metadata source | `gdelt.news`, counted once alongside general news. No replacement publisher source or key was added. |
| Required recent-30-day sample | Six distinct local reports, six original UTC publication dates. All six URLs are present in actual complete GKG archives. |
| Original publication time | One bounded head check per exact URL, canonical identity and matching two timestamp fields with explicit UTC offset. |
| Runtime enrichment | `src/normalization/crime-news-evidence.ts`, `enrichVerifiedCrimeNews(result)`. No runtime publisher requests. Exact-URL reviewed evidence takes priority; new candidates retain unverified occurrence. Geographic versions and provenance references update together; source versions change only for independently verified publication instants. Repeat application is idempotent. |
| CSA real input | Latest official by-LGA workbook, 21,983,501 bytes; 810 statistics across 81 source area labels and ten June-ending rolling-year periods. |
| CSA normalized output | 810 source facts and 1,620 count/rate indicators, publication output count 2,430. No invented geography code or vintage. |
| Local verification | Node 24 whole-project compilation; 22 focused tests passed, zero failed/skipped, including conservative candidate positives/negatives and publication batch identity on replay. |
| Actual CSA publication | `batch_89389c5fbb8d045b78cc3b7cdb4e9fc2a3f36203`: 810 input, 2,430 output, zero rejected, confirmed by the release integrator. |
| Actual news query readback | Seven historical GKG windows and initial scheduled-source collection published. `v_crime_news_current` returned six reviewed reports, six publication dates and zero Point geometries. |
| Actual statistics query readback | `v_crime_area_statistics` returned 1,620 indicators, 81 original area labels and ten statistical periods. |

## Source evidence

[GDELT terms](https://www.gdeltproject.org/about.html#termsofuse) permit use and redistribution of GDELT datasets with GDELT attribution and a website link. The application keeps the dataset's URLs, titles, themes and location mentions. Publisher article text and images are not included in that grant or collected by this worker.

[DataVic's CSA dataset](https://discover.data.vic.gov.au/dataset/data-tables-recorded-offences) states CC BY 4.0 and quarterly publication. The actual catalogue returned `license_id = cc-by`, the CC BY 4.0 licence URL and `update_frequency = quarterly`. The selected latest LGA resource is `06bb24c8-8f62-4144-a746-99ef5492e4f9`, the June 2026 year-ending workbook released on `2026-09-24`. Its actual HTTP Last-Modified is `2026-09-10T09:05:22Z`. File revision time, publication date and statistical period remain distinct.

The CSA manifest now has complete admission evidence, project cap six HTTP requests per UTC day, `maxAttempts = 1` for each of the catalogue and workbook calls, no retained raw cloud copy, one-day staging retention, daily checks and an approximate quarterly cadence. Six is a conservative Melens cap, not a provider-published quota. One normal check uses two upstream requests. The regional statistics are 12-month offence totals/rates and do not represent individual reports, live incidents or single-quarter counts. The original workbook does not identify a numeric LGA code or geography vintage, so all 810 rows preserve unresolved source geography.

## Bounded discovery

Two DOC API attempts returned HTTP 429. The worker queried the official public `gdelt-bq.gdeltv2.gkg_partitioned` table in US instead. The SELECT projected only `DocumentIdentifier` and minimum/maximum `DATE`, filtered daily partitions `20260902` to `20261001`, limited Australian outlet domains and crime-related URL terms, and capped the result at 1,000 URLs. `DATE` was treated as GKG processing time, never article publication time.

The dry run estimated `923,351,169` bytes. Actual query `bqjob_r442791cdd28c977a_000001a0f71dda66_1` processed `923,351,169` and billed `923,795,456` bytes, below the `1,000,000,000` maximum. It returned 854 candidate URLs, including 83 with Melbourne/Victoria place or section terms. That list is bounded discovery, not comprehensive coverage or 854 local crimes. No US result was written directly across regions to the Melbourne data warehouse. The general-news worker used the discovered times to fetch complete original GKG files through the actual connector.

## Six reviewed publication facts

Each check stopped at `</head>` or `<body>` and was bounded at 100,000 bytes. The observed reads used only 18,432 to 22,528 bytes. No HTML/body file was saved. `article:published_time` and the article's JSON-LD `datePublished` agreed, each had `+00:00`, and canonical URL identity matched the sampled GKG URL. This was a one-time time-fact verification and does not create a publisher body feed or broaden the GDELT dataset licence to ABC text.

| GKG native ID | Original UTC instant | One-time checked at UTC | Head bytes scanned | Original evidence URL |
| --- | --- | --- | --- | --- |
| `20260906201500-325` | `2026-09-06T19:56:42Z` | `2026-10-01T11:10:50.982Z` | 22,528 | [Thomastown investigation](https://www.abc.net.au/news/2026-09-07/melbourne-thomastown-fatal-shooting/107122646) |
| `20260908034500-391` | `2026-09-08T01:15:43Z` | `2026-10-01T11:10:53.701Z` | 20,480 | [Keilor sentencing](https://www.abc.net.au/news/2026-09-08/keilor-cafe-shooting-gavin-preston-sentencing/107127386) |
| `20260911040000-437` | `2026-09-11T03:44:29Z` | `2026-10-01T11:10:56.529Z` | 18,432 | [Melton arson investigation](https://www.abc.net.au/news/2026-09-11/victoria-melton-arson-attack-ballarat-omcg-bandidos/107143230) |
| `20260923030000-71` | `2026-09-23T02:03:22Z` | `2026-10-01T11:10:59.026Z` | 20,480 | [Carlton charges](https://www.abc.net.au/news/2026-09-23/counter-terrorism-police-arrest-melbourne-man-alleged-isis-link/107185494) |
| `20260928124500-701` | `2026-09-28T11:41:51Z` | `2026-10-01T11:11:01.234Z` | 18,432 | [Deer Park trial](https://www.abc.net.au/news/2026-09-28/deer-park-machete-murder-trial-victorian-supreme-court/107205524) |
| `20261001103000-282` | `2026-10-01T08:15:05Z` | `2026-10-01T11:11:03.716Z` | 18,432 | [Charge withdrawal and other convictions](https://www.abc.net.au/news/2026-10-01/ex-cfmeu-delegate-joel-leavitt-blackmail-charge-dropped/107217902) |

The publication day in Australia/Melbourne for the first article is September 7, while its actual UTC date is September 6. URL dates or midnight are never substituted for these instants. Cases are kept distinct; mirrors/syndications were not counted twice. The reviewed report kinds and legal status remain in `crime_news_evidence` so charges, alleged conduct, sentencing and charge withdrawal are not conflated. Publication instants do not populate `observed_at`.

## Geographic limits and rejected numerator candidates

The six original reports explicitly concern Melbourne occurrence or judicial/investigative progress in Thomastown, Keilor, Melton, Carlton, Deer Park, Brooklyn and Eltham. Their GKG mentions are retained as mentions. GKG labels Deer Park and Brooklyn as NSW and Carlton as Tasmania in these samples; the enrichment adds reported-area evidence without pretending those identifiers are a verified official join or manufacturing incident points. No `event_site` point or coordinates are introduced.

The following sampled candidates do not contribute to the six-report numerator:

- A Melbourne mention in reporting on an activist jailed in Vietnam does not establish a Melbourne crime occurrence.
- Police powers at a protest, hospital staffing, or housing policy can have crime themes without being a distinct local crime report.
- Repeated syndicated URLs for the same car theft or doctor-filming case are not independent case evidence.
- An incorrect Melbourne geocode in Florida restaurant reporting does not establish Australian coverage.

## Automatic candidate classification

The prior runtime only set `crime_news` for the six reviewed exact URLs. `gdelt-crime-candidate-v1` also classifies newly collected metadata when all these conditions hold:

- The preceding official boundary normalization produced `news_scope = city` or `greater_melbourne`, `location_reason = official_place_mention`, and a nonempty official `area_refs` list. Overseas same names, statewide-only scope and unresolved mentions fail this gate.
- At least one exact GDELT theme is in the Melens allowlist: `SOC_GENERALCRIME`, `UNGP_CRIME_VIOLENCE`, `WB_1014_CRIMINAL_JUSTICE`, `WB_2453_ORGANIZED_CRIME`, `DRUG_TRADE`, or `TAX_FNCACT_CRIMINAL`.
- The GDELT metadata title contains an explicit offence term, such as murder, arson, robbery, theft, assault, kidnapping, blackmail, fraud or drug trafficking. Missing titles and titles about laws, legislation, policy or reform are conservatively excluded. Police, killing, law, arrest and trial themes alone do not qualify.
- The geographic record retains its matching source metadata and provenance link for the same normalized article URL.

Theme identifiers were checked against GDELT's [official Themes lookup](https://data.gdeltproject.org/api/v2/guides/LOOKUP-GKGTHEMES.TXT) and its [lookup publication](https://blog.gdeltproject.org/new-november-2021-gkg-2-0-themes-lookup/). The subset and headline filter are Melens heuristics, not a GDELT claim that an offence occurred in Melbourne. The [GKG codebook](https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.pdf) describes document themes and location mentions, including possible location false positives.

Candidates have `crime_news_evidence.status = gdelt_theme_candidate`, `local_occurrence = unverified` and `review_required = true`, with the exact matching themes and headline terms retained. Their source facts, publication/incident clocks, location role/confidence and geometry are unchanged. A missing original publication instant stays NULL. The existing six exact-URL samples remain `verified_sample_metadata` and bypass candidate filters; only that verified status contributes to the minimum-report acceptance numerator. The conservative English title terms can miss reports and do not establish comprehensive coverage.

Crime normalization also updates `sourceRevision` when effective source/geographic versions change, hashing the upstream revision, crime policies and sorted final version identities. Replaying a previously published window after new classification therefore produces a distinct stable batch identity. Reapplying the already enriched result keeps its revision and batch identity; unchanged results retain their upstream revision. A regression uses the publisher's actual pure `stableBatchId` function without cloud calls.

This classifier and revision update compiled successfully and passed the 22 focused tests. Its deployment is owned by the release integrator; the readback above confirms the original six reviewed reports and CSA batch, not a later classifier deployment.

## Query readback for the integrator

The release integrator has confirmed these deployed query views. The verified-report readback below returned six reports, six publication days and zero incident points at the fixed sample cutoff. The status filter deliberately excludes automatic candidates from this acceptance count.

```sql
SELECT COUNT(DISTINCT original_url) AS reviewed_reports,
       COUNT(DISTINCT DATE(published_at, 'Australia/Melbourne')) AS publication_days,
       COUNTIF(ST_GEOMETRYTYPE(geometry) = 'ST_Point') AS incident_points
FROM `melens-510012.melens_query.v_crime_news_current`
WHERE source_id = 'gdelt.news'
  AND JSON_VALUE(summary, '$.crime_news_evidence.status') = 'verified_sample_metadata'
  AND published_at >= TIMESTAMP '2026-09-01 11:11:03.716+00'
  AND published_at <= TIMESTAMP '2026-10-01 11:11:03.716+00';
```

```sql
SELECT source_area_name, COUNT(DISTINCT period_end) AS periods,
       COUNT(*) AS indicators,
       COUNTIF(source_area_code IS NOT NULL OR source_area_vintage IS NOT NULL) AS guessed_geographies
FROM `melens-510012.melens_query.v_crime_area_statistics`
WHERE source_area_name IN ('Melbourne', 'Yarra')
GROUP BY source_area_name;
```

The latest source workbook contains ten periods and two metrics per area, so each selected area should return twenty indicators and zero guessed geographies. News and CSA must be in separate views. SC-004's independent two-human, 40-item location benchmark remains pending independently of this six-report sample. Selected reports cannot establish exhaustive incident coverage, so empty queries require the category coverage state and must never imply no crimes occurred.
