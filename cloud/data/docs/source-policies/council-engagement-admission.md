# Council community engagement projects: admission

Reviewed 2026-10-04 Melbourne time. Source ID `victoria.council.engagement`, connector `src/connectors/council_engagement`.

## Why this source

Council news pages and media releases are the obvious place to learn about local consultations, road changes and plans, but they cannot be collected automatically. Of the 12 inner councils checked, the main sites of nine (Melbourne, Yarra, Port Phillip, Stonnington, Bayside, Darebin, Moonee Valley, Maribyrnong, Hobsons Bay) answer automated requests with Akamai, Cloudflare or Incapsula bot challenges. Melens does not work around these controls. GDELT does not fill the gap. In a 72-hour sample, 57% of Victorian articles carried only the place name "Melbourne". Most suburb tags were wrong, matching AFL clubs, NSW places or ordinary nouns. GDELT coordinates are gazetteer centroids of those names, so they repeat the same errors.

Each council also runs a community engagement site ("Have your say") for consultations on parks, roads, parking, budgets, planning amendments and policies. Of the 31 Greater Melbourne councils, 28 host this site on the same Social Pinpoint (Harvest Digital Planning) platform. These sites are not behind bot challenges. Each project card carries a council-entered suburb, so a suburb can be attached without inference.

## Coverage

The connector reads the 28 councils listed in `councils.ts`. The other three are excluded: Manningham (`yoursay.manningham.vic.gov.au`) and Kingston (`www.yourkingstonyoursay.com.au`) use EngagementHQ, and Nillumbik (`participate.nillumbik.vic.gov.au`) uses its own site. Each needs a separate connector.

City of Melbourne's `/projects` page is a map fed by the vendor API `api.au.harvestdp.com`, which requires a token. Melens does not reuse the page's embedded token. For Melbourne, only the home page lists are read. These cover open and recently active projects, not the full archive.

## Access method

1. For each council, fetch the configured listing pages. Usually this is just `/projects`, whose list returns every project in one or a few pages. Home-page blocks are featured subsets paged three at a time and are not read. The exceptions are Melbourne (home page only), Yarra Ranges (`/consultations`) and Wyndham (`/projects` plus `/closed-projects`).
2. Discover every `<section class="... projects-list" data-route=".../the_hive_projects_list/load_more/{block}">` on the same host.
3. Request `GET {route}?page=N` with `X-Requested-With: XMLHttpRequest` until `moreToLoad` is false (at most 150 pages per block). Melton and Wyndham return three or four projects per page, about 70 pages each.
4. Merge cards by `projectID`. Two cards with the same ID but a different link or status stop the snapshot.

Block IDs are site-specific and change when councils edit their pages, so they are discovered at runtime rather than configured. Some of these sites sit behind Cloudflare and occasionally return a 404, 503 or timeout. When an HTTP failure occurs, the whole council is retried twice, after 5 s and then 15 s. A failure that persists still fails the snapshot.

On 2026-10-04 the 28 sites listed about 3,300 project cards: 2,413 Closed, 808 Active and 85 Open. Every card had a valid date, and every project link stayed on its own site.

## Access policy evidence

- **robots.txt:** on the sampled sites it is `User-agent: * / Crawl-delay: 1 / Allow: /`, with blocks only for named SEO crawlers. Each site also publishes a `sitemap.xml`.
- **Terms of use:** the [Darebin](https://yoursay.darebin.vic.gov.au/terms-use) and [Stonnington](https://connectstonnington.vic.gov.au/terms-use) terms are representative. Site content is the council's or the vendor's intellectual property and may not be copied or distributed without permission. The terms contain no prohibition on automated access. The CC BY-SA 4.0 clause covers only comments submitted by users, which Melens never collects.
- **Crawler identity:** the connector identifies itself as `MelensDataBot/0.1 (+https://github.com/at2am/melens)`, not a browser, and waits one second between its requests. Councils are fetched four at a time, each a different host.

## What is stored

`license_status` is `restricted`. Melens stores facts and the link, never the council's wording.

| Field | Stored | Use |
| --- | --- | --- |
| `projectName` | yes | title (a factual headline) |
| `projectStatus` | yes | Open/Active → `active`, Closed → `resolved` |
| `projectDateNum` | yes | `published_at`, at Melbourne local midnight |
| `projectLocationArray` | yes | `suburb:` area references |
| `projectCategoryArray` | yes | summary facts |
| `projectPath` | yes | `original_url`, always shown |
| `projectDescription`, images, comments | **no** | council expression, not licensed |

The summary is written by Melens from the stored facts. An example: "Community consultation by Darebin City Council; status: Open; categories: Transport & Parking; suburbs: Reservoir". It names at most four categories, because Boroondara tags most projects with a dozen or more. Any later AI summary must follow the same rule. It may use facts only, at most 50 words, with no close paraphrase of council text. Raw responses are not retained (`raw_retention_days: 0`), and staging load files expire after one day.

## Location

Every record carries the council's official LGA reference (`ASGS_LGA:{code}:2025`). Listed suburbs are added as `suburb:{slug}`, and pairs such as "Albert Park/ Middle Park" are split. A card listing more than six suburbs is treated as council-wide and keeps only the LGA reference. This stops a budget or policy consultation from appearing as local news in every suburb. Records are `area_only` with `resolved_area` confidence and never carry a point.

## Snapshot semantics

Each run is a complete snapshot. The publisher checks versions within the batch only, as it does for Ticketmaster. `v_geo_records_current` shows only projects in the newest published snapshot. A project that disappears leaves current results without an asserted cancellation, and its history remains. A version changes when the title, status, date, suburbs, categories or link change. Edits to the description or image do not create versions.

The snapshot fails closed in these cases:

- a council has no project list
- a council lists no projects
- a page is missing
- links conflict between cards
- a card links off the council's site
- a council has more than two malformed cards that also make up more than 5% of its cards

A single malformed card is skipped and counted in `rejected_count`. On 2026-10-04 that was one Boroondara card with an empty title.

## Schedule

The schedule is daily at 19:50 UTC (06:50 Melbourne daylight time), and remains `enabled: false` in `infra/schedules.json` until the shared identity and cloud verification gates pass. A run makes about 230 requests. The schedule allows 400 per run, leaving room for council retries, and the manifest allows 600 per day.

## Live verification

On 2026-10-04 a read-only connector run against all 28 sites succeeded in 300 seconds with 228 requests. It returned 3,926 projects: 968 active (Open or Active) and 2,958 resolved (Closed). One card was rejected, the Boroondara card with an empty title. Of the projects, 1,398 carry suburb references and 2,528 are council-wide. During the run Stonnington returned one 503, and the council retry recovered it. This run did not write to BigQuery, so it does not verify scheduled publication.

## Takedown

If a council asks Melens to stop, remove its row from `councils.ts` and redeploy. The next complete snapshot drops that council's projects from current results. If the request also covers history, delete the source's rows for record IDs with that council's prefix (`victoria.council.engagement:{council}:`) under the same 24-hour target as Ticketmaster withdrawals.

## Project news (`victoria.council.engagement_news`)

Connector: `src/connectors/council_engagement_news`. A separate source ID because news accumulates, while projects are a complete snapshot.

**What it is.** News posts sit under a project on the same 28 sites. Most are progress reports on a consultation: results ("What we heard", consultation summaries), decisions ("Council adopts new Local Law"), extensions and venue changes. A few are general council notices, such as award nominations, a library grant or a cancelled market. In the 30 days to 2026-10-04 the sites published 46 news posts from 10 councils. City of Melbourne published 14 of them.

**Access.** The sites' news lists come from the vendor API `api.au.harvestdp.com/hive/project/news`, which needs a token generated by the page; Melens does not reuse it. Every news post is also a public page listed in the site's `sitemap.xml`, which robots.txt allows. A news page's markup carries `page-type-news-full`, while other pages one level below a project carry `page-type-projectsubpage`. Each daily run:

1. Reads every council's `sitemap.xml`.
2. Picks the pages two path segments deep whose `lastmod` falls within the last 14 days. The snapshot revision `lookback-90d` backfills up to 365 days.
3. Opens each picked page and keeps those carrying the news marker.
4. Reads that council's project list only when news was found, to attach the parent project's suburbs.

Sitemaps lag one to two days (no site listed a change from the previous day), so 14 days re-reads every recent change several times.

**What is stored.** The headline and parent project name are taken from `og:title` ("News headline | Project name"). The stored date is the first date shown after the news marker, not the sitemap date. A revised old post keeps its original publication date, as seen on a Knox post dated 15 June and re-listed in September. Also stored are the link and Melens' own summary JSON with `news_scope`, council, project, area and attribution. The council's article text and images are never stored. `source_updated_at` is the sitemap `lastmod`, so a revised page orders after its earlier version. The version also covers the area taken from the parent project, as the GDELT location classification is in its derived version. A post outside any listed project keeps only the council's LGA reference.

**Failure handling.** An unreadable sitemap fails the run after the council retries. An unreadable page is skipped and counted, and later runs retry it inside the lookback window. More than two unreadable pages that are also over 10% of a council's candidates fail the run.

**Live verification.** On 2026-10-04 a read-only run with the default 14-day lookback succeeded in 319 seconds with 274 requests. It returned 19 news posts, all with a publication date. Twelve were linked to a parent project, and two of those carried suburb references. Most parent projects are council-wide, and City of Melbourne's project list is limited to its home page. One Stonnington page returned 503 and was counted as rejected. The schedule is daily at 20:20 UTC, after the project snapshot, and stays `enabled: false` with 500 requests per run and 600 per day.
