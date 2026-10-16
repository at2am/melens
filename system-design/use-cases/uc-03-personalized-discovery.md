---
id: UC-03
title: Personalized discovery and planning
priority: P0
status: in-progress
proposed_by: Wasabii
trigger: query
agents: [map_agent]
tools: [search_features, maps_grounding, search_grounding, draw_route, highlight_features, show_card]
data_sources: [events-ticketmaster, maps-grounding, search-grounding]
source_rows: [Personalized Discovery (arts after 7 PM), Personalized Discovery (free 45-minute walk)]
---

# UC-03: Personalized discovery and planning

Shows the agent calling several tools to build a plan around the user's time, interests and budget.

## User stories

1. **Evening arts and culture.** Official events with a clearly traceable data source.
   > As a user, I would like to explore arts and cultural experiences available after 7 PM that are accessible without a car.
2. **Free walk.** More casual activities that may not be officially published, such as a walk, fishing, visiting a dog park to see the dogs, a high-rise city view, or watching the sunset.
   > As a user, I would like a free walk of about 45 minutes nearby, with interesting places along the way.

## Behaviour

1. The user asks in the chat.
2. `map_agent`, following the UC-03 playbook, finds candidates: events from the events layer for story 1, free places and activities for story 2, and Maps grounding only for stops the layers do not have, such as a café or a park.
3. For a walk, it builds a route with the Maps grounding route capability (up to 13 waypoints) and calls `draw_route`, so the app draws it on the map.
4. The plan arrives as a `plan` card, with times, stops and a source for each item.
5. **Change plan.** Under a finished plan card the user taps Change plan, then types what to change or taps a suggestion (shorter, cheaper, an hour later, indoors). The message is a `refine` turn for that card ([agent-protocol.md](../agent-protocol.md#request)): the agent gets the whole plan, keeps the stops the user did not ask to change, searches only for new ones, redraws the route when the stops changed and shows the whole revised plan as a new `plan` card. The user can change it again, as often as they like.
6. **Save plan.** Save plan keeps a copy of the card, with its route, on the Home tab (UC-14) under Saved plans: a one-off plan, not a feed that refreshes. It outlives the chat session. A saved plan opens on its own page, where each stop opens on the map, Show the route on the map draws the route again and Remove plan deletes it. Plans whose timed stops are all over are marked Past and listed last. At most 30 per user ([agent-protocol.md](../agent-protocol.md#saved-plans)).

## Example queries

- "What can I do after 7 PM tonight? I enjoy arts and culture and need somewhere accessible on foot or by public transport."
- "I'd like some free activities now."
- "Plan a free, 45-minute walk near me, with a few interesting stops along the way."
- After a walk plan, Change plan: "Swap the second stop for a café." Expect the other stops kept, one new searched stop and a new route.
- After an evening plan, Change plan: "Start an hour later." Expect the same kind of stops with later times, no unverified sources.

## Acceptance criteria (Draft)

- [ ] Evening results include only events that start after the requested time, each with a source link.
- [ ] Each evening result says how to get there on foot or by public transport.
- [ ] A walk plan has free stops only, takes about 45 minutes, uses at most 13 waypoints and is drawn on the map.
- [ ] Every stop or event cites a MapFeature id or a web link.
- [ ] If the events layer has too few Melbourne events, the agent falls back to Search grounding and links the pages it used.
- [x] Change plan sends a `refine` turn for that card; the revised plan keeps the unchanged stops and cites their sources without a new search.
- [x] Save plan keeps the card and its route per uid; it shows on the Home tab until removed and outlives the chat session.

## Notes

- Events come only from sources with a traceable origin. What's On Melbourne has no API; do not scrape it.

## Open questions

- Is Ticketmaster's Melbourne coverage enough? The plan set 2026-09-29 as the date to test it.
