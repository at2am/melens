---
id: UC-06
title: Local news by area
priority: P1
status: planned
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
2. The extraction agent (`gemini-3.5-flash-lite`, structured output) pulls out the place and a summary; Geocoding turns the place into coordinates.
3. Each item becomes a MapFeature in the `news` layer.
4. The app shows the top 3 items for the visible area and refreshes them on pan and zoom.

## Example queries

- "News on different areas." (browse behaviour, not a chat query)

## Acceptance criteria (Draft)

- [ ] The visible area shows at most 3 news items, and they change on pan and zoom.
- [ ] Each item links to the original article.
- [ ] Items without an identifiable Melbourne location are not placed on the map.

## Open questions

- How is "top 3" ranked: most recent, or most relevant to the area?
