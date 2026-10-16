---
id: UC-06
title: Local news by area
priority: P1
status: in-progress
proposed_by: Alex Gao
trigger: browse
agents: [extraction]
tools: []
data_sources: [news-rss]
source_rows: [Local News]
---

# UC-06: Local news by area

Low marginal cost: it reuses the news pipeline that UC-04 already needs.

## User stories

> As a user, I would like to browse what has happened near me in Melbourne. At each zoom level and area, the map shows the top 3 recent news items for that area. I open the map, drag or zoom, and see different news.

## Behaviour

1. The ingestion job reads the news RSS feeds.
2. The extraction pipeline (`gemini-3.5-flash-lite`, structured output) pulls out the place and a summary; Geocoding turns the place into coordinates.
3. Each item becomes a MapFeature in the `news` layer.
4. The app shows the top 3 items for the visible area and refreshes them on pan and zoom.

## Example queries

- "News on different areas." (browse behaviour, not a chat query)

## Acceptance criteria (Draft)

- [ ] The visible area shows at most 3 news items, and they change on pan and zoom. Built differently, see Notes: every area in view that recent news names is drawn, and each lists its latest 5 stories.
- [x] Each item links to the original article.
- [x] Items without an identifiable Melbourne location are not placed on the map.

## Open questions

- How is "top 3" ranked: most recent, or most relevant to the area? Answered 2026-10-16 for the area view: most recent, using GDELT's processing time because GDELT carries no article time.

## Notes (2026-10-16)

The steps under Behaviour are not built: no RSS reader, extraction pipeline or geocoding exists. The only news source is GDELT (`gdelt.news`), plus council engagement news. GDELT names places in an article but never says where the reported event happened, so no article is a point and none was drawn; the map showed nothing.

What is built instead (`cloud/shared/src/query/news-areas.ts`):

- The news layer draws each official area (ABS ASGS LGA or SA2) that current articles name, as an `areaMentions` aggregate: the area outline (simplified at 100 m and labelled as simplified), shaded by its story count. The area is an association, never an event site.
- A story is one headline; syndicated copies count once. Tapping an area lists its latest 5 stories, each with its original article link.
- "Current" news is the last 7 days up to the window end. The map's current window is 15 minutes, which suits sensors, not news. GDELT's processing time places an article in time and orders it, and is never shown as its publication time. Before this, rows without a time stayed in every current window (news from 6 weeks ago) and were dropped from every historical one.
- Historical mode draws no areas: the copy holds current records only.
- `abs.asgs.boundaries` (CC BY 4.0) joined the map's public reference registry for the outlines.
- The News chip is on the default map topic. The map lost its topic switch on 2026-10-15, which had left no way to turn news on.

Known limits: GDELT resolves a bare "Melbourne" to the City of Melbourne council area, so that area collects national stories (about 2,000 a week). Club and place names also match (North Melbourne gathers AFL stories). The fix belongs in `classifyGdeltMentions` (`cloud/data`), for example by treating a bare "Melbourne" as Greater Melbourne.
