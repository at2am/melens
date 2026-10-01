# GDELT metadata release policy

Reviewed on 2026-10-01 by the Melens general news ingestion integrator.

## Official evidence

The [GDELT terms of use](https://www.gdeltproject.org/about.html#termsofuse) permit academic, commercial and governmental use of released datasets, including redistribution. Redistribution must credit The GDELT Project and link to `https://www.gdeltproject.org/`. This admission covers GKG dataset metadata. The connector does not request publisher pages or article bodies.

The [GKG documentation](https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf) defines the 27-column GKG format. The [official title guidance](https://blog.gdeltproject.org/unescaping-article-titles-in-the-gkg-2-0/) documents `PAGE_TITLE` in Extras and its entity escaping. The title parser decodes metadata entities and rejects nested elements and oversized values.

## Fields and retention

- Keep GKG record ID, processing DATE, source name, canonical article URL, theme codes, location mention metadata and supplied PAGE_TITLE. Include GDELT attribution in the normalized metadata summary.
- Do not fetch or archive article bodies, images or videos.
- Do not retain global ZIP or CSV responses. Normalized metadata has a project retention period of 30 days. Temporary publication staging expires after one day.
- `published_at` and `observed_at` stay null because GKG processing DATE establishes neither original publication nor incident time. Preserve the processing timestamp in `source_updated_at` and the query column `gdelt_processed_at`.

## Request and window bounds

The configured 160 requests per UTC day is a project budget. The publisher does not promise this quota. A normal 15-minute schedule makes 96 archive requests per day; the remaining allowance supports bounded recovery and selected backfills. Each HTTP call has one attempt, a 120-second whole-response deadline and a compressed streaming limit of 32 MB. Each requested window contains at most 16 aligned 15-minute archives. The selected expanded CSV is limited to 100 MB and 100,000 rows.

Every archive in `[from, to)` must be completely fetched and contain one expected GKG CSV with valid UTF-8 and 27-column rows. A missing file, size overrun, invalid encoding or schema failure rejects the whole window. No partial candidate set may advance the continuous cursor. Discrete backfills establish coverage only for their actual windows.

The official [last-update manifest](https://data.gdeltproject.org/gdeltv2/lastupdate.txt) reported a 4,747,178-byte GKG archive for `20261001103000`. Multiplying this observed size by 96 gives about 456 MB per day; actual sizes vary. Use a delayed scheduler window so the requested archive has been published. This transport estimate excludes GCP SQL and storage charges, which remain subject to the shared budget guards.

## Geography and grouping

The parser retains all GKG location evidence, including overseas places, before selecting Victoria candidates. The publication normalizer matches names against published official ASGS 2026 state, GCCSA and SA2 boundaries, ASGS LGA 2025, and the City municipal boundary. It records the actual version-specific boundary IDs.

Matched mentions remain `mentioned_place` with `unverified` precision and no geometry. Melbourne Victoria and Melbourne Florida in one candidate remain `unknown`. No mention centroid becomes an incident point. `v_melbourne_news_current` selects reports whose official mention references have city or Greater Melbourne scope; this geographic relation does not certify local occurrence.

Canonical URLs identify article versions. Cross-publisher reports have not been automatically certified as distinct logical events. The formal 14-day coverage and 40-story independent dual-review benchmark remain separate acceptance checks.
