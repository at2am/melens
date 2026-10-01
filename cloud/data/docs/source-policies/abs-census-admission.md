# ABS Census DataPacks admission

Reviewed 2026-09-30 for `abs.census` in the Melens development project.

## Rights and official files

The [ABS copyright page](https://www.abs.gov.au/website-privacy-copyright-and-disclaimer) licenses ABS website material under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), excluding microdata, third-party content, logos and branding. These aggregate Census General Community Profile tables are ABS statistical material, not microdata. Attribute Australian Bureau of Statistics, link the [Census DataPacks catalog](https://www.abs.gov.au/census/find-census-data/datapacks), and disclose the selected metrics and transformations.

The production connector reads the official 2021 Victoria SA1, SA2 and LGA ZIP archives. It extracts only G01 and G02 through bounded HTTP byte ranges, validates Content-Range, archive validators, ZIP sizes and CSV checksums, and requires the exact geographic-code and metric headers. Six selected CSVs produce 32,176 region-table source facts and 144,792 indicators across nine selected population, age, income, rent and household-size metrics. This is complete extraction of those selected tables and metrics, not every DataPack table.

The content SHA-256 identifies the snapshot. The fixed `2022-06-28` publication timestamp records the 2021 Census release, not the last modification of each ZIP. A changed value with the same ordering timestamp must fail the publisher's ambiguous-version check and require review; recurring ingestion remains disabled. The 100-request daily manifest limit is a Melens cap, not an ABS-published quota. Three archive tails and two range reads per selected CSV normally require 15 HTTP requests; the configured execution limit is 20, including retry attempts. A source job must enforce that limit before recurring operation.

## Time and boundary semantics

The observation reference is 2021-08-10. Indicators and source facts now use the reference-day interval ending 2021-08-11. The earlier code incorrectly extended the end to 2026; no such extended rows were published. A Census observation does not assert a current 2026 population, asking rent or income. Production defaults ignore environment fixture/URL overrides; offline test data requires explicit constructor injection.

Boundary IDs retain the exact ASGS 2021 scheme and code. In the development query view, 720 indicators match 80 LGA polygons and 3,249 match 361 Greater Melbourne SA2 polygons. The other 140,823 indicators remain visible with `boundary_mapping_status = missing`; their absent polygons are not inferred from names or another vintage. SA1 and other Victoria statistics remain queryable as source facts while the corresponding boundaries are absent.

## Development publication and verification

Batch `batch_f090301c8942cbb474b9ee3dc9447eb2fbd8d400` reached `published` with 32,176 inputs, 144,792 outputs and zero rejected records. Source facts were all `verified_open`, unique by `source_record_id`, and none extended past the 2021-08-11 reference-day end. `melens_query.v_area_indicators` returned all 144,792 indicators, with 3,969 exact boundary matches.

A complete second collection and publisher revalidation returned the same batch ID and counts. No second set of fact rows was appended.

The matched 2021 LGA population examples are Melbourne 149,615, Port Phillip 101,942 and Yarra 90,114. Each has non-null ASGS 2021 geometry. Their Census median weekly rents are AUD 396, 420 and 451 respectively; these are historical Census statistics. This verifies one statistical reference period. It does not satisfy the two-period area category gate or a continuous monitor.

Raw archive bodies are not retained. Temporary normalized load files have one-day retention and are cleaned after publication; the independent staging cleanup handles orphans. Each ingestion query has an explicit 500,000,000-byte limit. That limits each query's billed scan, not aggregate query count, storage, or all cloud charges. Source-specific Cloud Run identity, recurring deployment and final coverage gates remain open.
