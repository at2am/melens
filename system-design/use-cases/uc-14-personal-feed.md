---
id: UC-14
title: Personal feeds
priority: P1
status: in-progress
proposed_by: Haoyuan Tang
trigger: browse
agents: []
tools: []
data_sources: [road-disruptions, events-ticketmaster, news-rss, pedestrian-live]
source_rows: []
---

# UC-14: Personal feeds

The home tab: what is happening in the feeds the user built. Added 2026-10-15 with the app shell; not from the Notion table. The priority is a proposal and needs team confirmation. Redesigned on 2026-10-15 by the project owner, from city-wide topic switches to feeds the user creates, each limited to one area, so that the feed loads only what the user follows.

## User stories

> As a user, I would like to follow a few topics in the parts of Melbourne I care about, so that the first screen shows what is happening there quickly, without my opening the map.

## Behaviour

1. The app has three bottom tabs: Feed (home), Discover (the map, UC-01 and UC-02) and Settings. A floating button on every tab opens the agent chat (UC-13).
2. **A feed** is a name, one or more topics and one scope. A topic is community events (UC-09) or one map layer (events, disruptions, news, anomalies, planning). The scope is one of:
   - **Map area**: the user moves and zooms a map until a frame covers the area; the framed box is stored, cut to the service area.
   - **Named area**: one of the City of Melbourne small areas the app lists (CBD, Carlton, Docklands, East Melbourne, Kensington, North Melbourne, Parkville, Port Melbourne, South Yarra west, Southbank, West Melbourne) or the whole municipality. Each is an approximate box, not a statistical boundary.
   - **All of Melbourne**: the whole service area. The slowest; offered, never the default.
3. Topics whose records may have no location (events, disruptions, planning) offer **Include reports without a place**: the feed also reads that layer's unlocated records by the area its sources cover, the same evidence the map's unlocated list uses. Those records are not limited to the feed's area. Off by default.
4. Community events take a time range instead: the next 24 hours, 7 days or 14 days (default 14). Their route accepts boxes up to 10 km a side, so a wider scope is cut down around its centre, and All of Melbourne reads central Melbourne.
5. The Feed tab has a **New feed** button that opens the editor. Chips under the title pick **All feeds** or one feed; a Manage chip opens Settings. An item two feeds share appears once. The list puts what is coming up first, soonest first, then what has happened, latest first. A map item opens on the map; a community event opens its page.
6. **Settings, Feeds** lists every feed with its topics and scope. A switch pauses or resumes a feed (a paused feed stays saved and is not loaded); a tap opens the editor, which also deletes. At most 20 feeds.
7. **Loading.** Each topic of each enabled feed is one source and one request: one map layer inside the feed's box, or one community events query. Sources load in parallel and are cached by their parameters, so feeds asking for the same layer and scope share a request. A source that fails is named in the feed as "feed: topic" and never hides the others; a source still loading shows a progress bar over what has arrived.
8. **Storage.** Feeds are stored per Firebase uid by the agent service (`GET` and `PUT /v1/feeds`, [agent-protocol.md](../agent-protocol.md#feed-subscriptions)), so they survive a restart. A user who never saved one sees a default "Melbourne CBD" feed (community events, events, disruptions), stored only once the user changes something. A change shows at once and is then saved; a failed save puts the list back and says so.

## Acceptance criteria (Draft)

- [x] A user creates a feed from the Feed tab with topics and a map area, a named area or all of Melbourne.
- [x] Each topic of a feed is its own request, limited to the feed's area, and the feed shows each source as it arrives.
- [x] A failing source is reported by feed and topic while the other sources still show.
- [x] Feeds are listed in Settings, where they can be paused, edited and deleted; the Feed tab follows at once.
- [x] Feeds survive an app restart (stored per uid by the agent service).
- [x] Tapping a map item opens it on the Discover tab; tapping a community event opens its page.
- [ ] Measured on live data: a one-area feed loads faster than the old city-wide request for the same layers.
- [ ] Topics from user-added sources (UC-07) can be followed.

## Notes

- **Rule: a feed never loads the whole city unless the user picked All of Melbourne.** Do not go back to the 2026-10-15 first version, which sent one request for the whole service envelope with every followed layer and switched topics on and off. The project owner rejected it as too slow.
- Why per-layer requests matter more than the box: the map service loads the layers of one viewport request one after another (`cloud/map/src/services/viewport.ts`), so one request with four layers waits for all four in turn, about 20 s on live data. BigQuery tables are clustered by `source_id`, not by location, so a smaller box cuts the rows returned, the adaptation and the response size, but barely the scan. Parallel single-layer requests make the wait the slowest layer instead of the sum.
- Feed requests ask at zoom 18, where the service returns single items. At a city-wide zoom it groups points into aggregates, which a feed cannot list; the first version dropped them and so lost items.
- Items from the Melens map keep their feature id, so the agent and the feed cite the same records.
- Map topics read what is on now (the current 15-minute window). Time-ahead windows for map events need the map contract to allow future windows; it is not decided.
- The named areas and their boxes live in the app (`app/lib/features/feed/data/melbourne_areas.dart`); the service stores only the id. An id the app no longer knows reads nothing. Never rename an id.
- Deployment order: the agent service image with `/v1/feeds` must be live before the app that reads it, or the Feed tab shows "The feed could not load".

## Open questions

- Should the agent personalise the feed (UC-03), or stay a plain list of feeds?
- Should a feed offer the user's current location as a scope?
