---
id: UC-14
title: Personal feed and topic subscriptions
priority: P1
status: in-progress
proposed_by: Haoyuan Tang
trigger: browse
agents: []
tools: []
data_sources: [road-disruptions, events-ticketmaster, news-rss, pedestrian-live]
source_rows: []
---

# UC-14: Personal feed and topic subscriptions

The home tab: what is happening in the topics the user chose to follow. Added 2026-10-15 with the app shell; not from the Notion table. The priority is a proposal and needs team confirmation.

## User stories

> As a user, I would like to follow the topics I care about, so that the first screen shows what is happening in them without my opening the map.

## Behaviour

1. The app has three bottom tabs: Feed (home), Discover (the map, UC-01 and UC-02) and Settings. A floating button on every tab opens the agent chat (UC-13).
2. A topic is a source of feed items: community events (UC-09, read from the agent service's `/v1/events` around central Melbourne for the next 14 days) or one map layer (events, disruptions, news, anomalies, planning). The user follows a topic with its chip on the feed, or with its switch in Settings; both change the same subscription.
3. The feed lists the items of followed topics: coming up first, soonest first, then what has happened, latest first. A map item opens on the map; a community event opens its page.
4. Map topics are read from the map service for the whole service area for the current window, through the same contract as the map. A source that fails is named in the feed and never hides the others.
5. New users follow community events, events and disruptions.

## Acceptance criteria (Draft)

- [x] Following or unfollowing a topic changes the feed at once, from the feed and from Settings.
- [x] A failing map source is reported by topic while the other topics still show.
- [x] Tapping a map item opens it on the Discover tab; tapping a community event opens its page.
- [ ] Subscriptions survive an app restart (needs an account store; today they live for the app run).
- [ ] Topics from user-added sources (UC-07) can be followed.

## Notes

- Items from the Melens map keep their feature id, so the agent and the feed cite the same records.
- The first version shows what is on now. Time-ahead windows for events need the map contract to allow future windows; it is not decided.

## Open questions

- Which topics are the demo's default?
- Should the feed be personalised by the agent (UC-03), or stay a plain list of subscriptions?
