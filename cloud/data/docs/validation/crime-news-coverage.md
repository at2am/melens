# Melbourne crime news coverage gate

Reviewed 2026-10-01. Sample window ends at `2026-10-01T11:11:03.716Z` and starts 30 days earlier.

Six distinct qualifying article metadata rows were found in complete official GKG windows, and six explicit original publication instants were verified. The release integrator confirmed actual publication and `v_crime_news_current` readback: **six reports on six original publication dates, zero Point geometries**. The earlier unknown numerator is superseded by this published evidence.

| Original UTC publication instant | GKG record ID | Report and geographic evidence | Original source URL |
| --- | --- | --- | --- |
| 2026-09-06 19:56:42 | `20260906201500-325` | Homicide investigation in Thomastown, Melbourne's north. | [ABC report](https://www.abc.net.au/news/2026-09-07/melbourne-thomastown-fatal-shooting/107122646) |
| 2026-09-08 01:15:43 | `20260908034500-391` | Sentencing for the 2023 Keilor shooting; publication is a court update. | [ABC report](https://www.abc.net.au/news/2026-09-08/keilor-cafe-shooting-gavin-preston-sentencing/107127386) |
| 2026-09-11 03:44:29 | `20260911040000-437` | Investigation of an alleged Melton arson attack, with arrests in Ballarat. | [ABC report](https://www.abc.net.au/news/2026-09-11/victoria-melton-arson-attack-ballarat-omcg-bandidos/107143230) |
| 2026-09-23 02:03:22 | `20260923030000-71` | Charges following an arrest/search in Carlton; the accused denies the charges. | [ABC report](https://www.abc.net.au/news/2026-09-23/counter-terrorism-police-arrest-melbourne-man-alleged-isis-link/107185494) |
| 2026-09-28 11:41:51 | `20260928124500-701` | Murder trial concerning a reported 2024 Deer Park incident; guilt is not inferred. | [ABC report](https://www.abc.net.au/news/2026-09-28/deer-park-machete-murder-trial-victorian-supreme-court/107205524) |
| 2026-10-01 08:15:05 | `20261001103000-282` | Court disposition involving Brooklyn/Eltham. Blackmail was withdrawn; other offences resulted in convictions. | [ABC report](https://www.abc.net.au/news/2026-10-01/ex-cfmeu-delegate-joel-leavitt-blackmail-charge-dropped/107217902) |

## Method and limits

The DOC API returned HTTP 429, so a read-only public BigQuery discovery query selected article URLs and minimum/maximum GKG processing times from strictly bounded daily partitions. That query scanned `923,351,169` bytes and billed `923,795,456` bytes, below its `1,000,000,000` byte ceiling. The resulting 854 Australian outlet URLs were discovery candidates, not accepted crime reports or a complete count of incidents. The general-news worker fetched the corresponding six whole GKG ZIP windows and confirmed all six target URLs.

Each original URL received one bounded publisher `<head>` check. Each returned HTTP 200, canonical URL equality, and matching `article:published_time` and JSON-LD `datePublished` values with an explicit `+00:00` offset. Reads stopped at the head/body boundary after 18,432 to 22,528 bytes, below the 100,000-byte bound. Only timestamps, canonical URLs, validation time and precision were retained. No HTML, article body, image, audio, or publisher text feed was retained or added.

Original-date enrichment applies only to these exact reviewed URLs. It records the evidence in metadata, updates source/geographic versions and their provenance links together, and retains GKG processing time separately. Articles without independently verified original dates keep `published_at = null`. No incident time is manufactured. GKG incorrectly assigns Deer Park and Brooklyn to NSW and Carlton to Tasmania in these samples; they are not promoted to precise incident points or silently corrected into an official place join.

The same runtime module now also classifies new metadata as `gdelt_theme_candidate` when an official City/Greater Melbourne mention, an exact crime-theme allowlist match and an explicit crime headline term all agree. Those records keep `local_occurrence = unverified`, `review_required = true`, existing mention roles and unknown dates. Police activities, laws, broad kill/police/law themes, missing titles, overseas same names and unresolved geography are excluded. This local update compiled and passed positive/negative tests; the integrator owns its subsequent deployment. Candidate rows do not contribute to the verified six-report numerator. See the full rule and [official taxonomy references](crime-news-release-2026-10-01.md#automatic-candidate-classification).

The six reports concern distinct cases. Identical URLs across repeated GKG records count once. Syndicated copies of a case are not used to inflate this numerator. A charge withdrawal is a current court report, not an article withdrawal or a blackmail conviction. Recent publication does not imply a recent incident.

## Official regional statistics

The independent CSA source has a reviewed CC BY 4.0 catalogue and a successfully parsed real latest LGA workbook. Published batch `batch_89389c5fbb8d045b78cc3b7cdb4e9fc2a3f36203` has 810 input facts, 2,430 total output records and zero rejected. Actual `v_crime_area_statistics` readback confirmed 1,620 count/rate indicators, 81 original statistical area labels and ten rolling-year periods. The publication date is `2026-09-24`, while the file's actual Last-Modified revision time is `2026-09-10T09:05:22Z`; these remain distinct. Geography codes and vintage are absent and remain unresolved. The statistics are shown separately from reports.

## Acceptance state

The discovery, original-date sample, actual cloud publication and query readback are verified for this crime-category sample. The release integrator reported seven historical GKG windows plus initial collection published, and the CSA batch above. This meets the sample's minimum five reports on two dates; overall FR-002/SC-001 also depends on the other source/category criteria. Results and the separate subsequent candidate-classification update are recorded in [crime-news-release-2026-10-01.md](crime-news-release-2026-10-01.md).

SC-004's two independent human reviewers and 40-item geography benchmark remain a separate pending criterion. The six-report crime sample is not a replacement for that benchmark. Six selected reports cannot establish exhaustive reporting coverage, so an empty query must not be interpreted as no crime occurring.
