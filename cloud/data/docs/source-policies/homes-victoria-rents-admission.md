# Homes Victoria quarterly rents: source admission

Reviewed 2026-09-30 for `homes_victoria.rents` in the Melens development project.

## Rights and provenance

The [DataVic dataset page](https://discover.data.vic.gov.au/dataset/rental-report-quarterly-quarterly-median-rents-by-lga) and the [current Sep 2025 XLSX resource page](https://discover.data.vic.gov.au/dataset/rental-report-quarterly-quarterly-median-rents-by-lga/resource/458264e7-0b2f-4061-80b4-c73ad4e94aa7) both explicitly show **Creative Commons Attribution 4.0 International**. The live CKAN package response declares `license_id = cc-by` and links to the CC BY 4.0 licence. The publisher is Homes Victoria; source figures come principally from Residential Tenancies Bond Authority bond lodgements. Product attribution must name Homes Victoria/State of Victoria, link the dataset and licence, and disclose transformations. No article text, personal records, or raw workbook is retained by Melens.

The resource endpoint is on `www.dffh.vic.gov.au` and redirected to a DFFH XLSX asset during review. The Sep 2025 workbook response gave `Last-Modified: Fri, 20 Feb 2026 01:17:41 GMT`. The connector requires a valid file `Last-Modified` before accepting a live workbook and copies it to each source fact, geo fact, and indicator as `source_updated_at`. This orders revisions to the same quarterly fact. A changed workbook with an unchanged `Last-Modified` produces a different content version but fails the shared publisher's ambiguous-revision check; it must be investigated rather than arbitrarily selecting a winner. CKAN `metadata_modified` is not used as a content revision because the portal can edit metadata independently of the file.

## Scope and quality

One full read-only live probe parsed all seven expected property-type sheets from the official Sep 2025 workbook: **58,618 unique quarterly LGA/property facts** across 106 quarters. Of these, 49,310 had observed medians and 9,308 were suppressed; suppressed values stayed null. The latest two quarters (Jun and Sep 2025) contain 553 facts each. The statistic is a historical moving quarterly median weekly rent from lodged bonds. It is not a live asking rent, available rental listing, vacancy rate, or real-time affordability measure.

The workbook is labelled by LGA but does not carry ABS LGA codes or a verified geography vintage. Source area names are retained; `boundary_id` remains explicitly unresolved and geometry remains null. The BigQuery view can expose the historical numeric series with `boundary_mapping_status = missing`, but it must not render those rows as a resolved LGA polygon or compare them as if an ASGS vintage match were proven. Official crosswalk evidence is required before this source satisfies the area-map category gate. No suburb facts are asserted from this particular workbook despite generic portal wording mentioning suburbs and towns.

The geo fact's `location_confidence = official_join` records that the area name comes from an official LGA-labelled workbook. It does **not** assert a matched polygon; the indicator view's `boundary_mapping_status` and null geometry are the governing map eligibility signals.

## Operational limits

The 10 requests/day manifest value is a **Melens cap**, not a provider-published quota. A normal check uses two upstream GETs (catalog and XLSX). Stored raw retention is zero; only normalized facts are published. Temporary BigQuery load objects expire after one day and the independent staging cleanup handles orphans. Recurring Scheduler ingestion remains disabled pending source-specific identity, cost and request enforcement. A bounded one-shot development publication may target two quarters; that is a partial historical ingest, not a complete source backfill.

## Development publication

On 2026-09-30, one bounded manual backfill covered `2025-04-01T00:00:00Z` to `2025-10-01T00:00:00Z` in project `melens-510012`. Batch `batch_360b670cb9cd9d7b770da2c09e4c6fc6f57a56cd` reached `published` with **1,106 input and output records, zero rejected**. `melens_query.v_area_indicators` showed 553 records in each of the two quarters: 467 observed and 86 suppressed/null in Jun; 457 observed and 96 suppressed/null in Sep. All 1,106 rows reported `boundary_mapping_status = missing`; no polygon was invented. The matching source records were all `verified_open`, unique by `source_record_id`, and ordered at the workbook revision `2026-02-20T01:17:41Z`. The public geo view exposed 1,106 `area_only` records with null geometry. No staging object remained under this source's prefix. A second run returned the same batch ID and the three fact tables remained at 1,106 rows each.
