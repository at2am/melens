---
id: UC-03
title: Personalized discovery and planning
priority: P0
status: in-progress
proposed_by: Wasabii
trigger: query
agents: [map_agent]
tools: [search_features, maps_grounding, search_grounding, draw_route, highlight_features, show_card, ask_user]
data_sources: [events-ticketmaster, maps-grounding, search-grounding, parking-sensors]
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
4. The plan arrives as a `plan` card, with times, stops and a source for each item, each stop's location and the plan's travel mode. The agent says what it assumed for anything the user left open (leave now, about two to three hours, on foot and public transport).
5. **Questions before planning** (since 2026-10-17; before that the agent showed the plan first and asked afterwards). Before it plans, the agent asks up to three questions together about what the request leaves open and would change the plan: when the user leaves, how long they have, how they will get there, what they enjoy ([agent-design.md](../agent-design.md#asking-the-user)). That turn only asks: no search and no card. Each question has 2 to 4 options. The user picks for any of them and taps Make the plan, or types instead; the agent then makes the plan once from the request and the answers, and asks nothing after it. A request that leaves nothing open is planned at once. Answering one question sends it at once.
6. **Driving.** When the user drives (an answer, or the request says so), the plan's travel mode is `drive` and each located stop shows the live parking around it: the nearest free bays, how many sensors read free and taken, when they were read, and the area's rules, with the notes that the sign decides and that a free sensor is not permission to park (UC-15). Code reads it; the model never states a bay or a fee.
7. **Change plan.** Under a finished plan card the user taps Change plan, then types what to change or taps a suggestion (shorter, cheaper, an hour later, indoors). The message is a `refine` turn for that card ([agent-protocol.md](../agent-protocol.md#request)): the agent gets the whole plan, keeps the stops the user did not ask to change, searches only for new ones, redraws the route when the stops changed and shows the whole revised plan as a new `plan` card. When the change leaves open what the revision needs ("later" without when), the agent asks first, up to three questions together, and revises once from the answers (Update the plan). The user can change it again, as often as they like.
8. **Save plan.** Save plan keeps a copy of the card, with its route, on the Home tab (UC-14) under Saved plans: a one-off plan, not a feed that refreshes. It outlives the chat session. A saved plan opens on its own page, where each stop opens on the map, Show the route on the map draws the route again and Remove plan deletes it. Edit plan renames it and removes or reorders its stops; the service draws the route again for the new order ([agent-protocol.md](../agent-protocol.md#saved-plans)). Change with Melens opens the chat on that plan, from any session, as Change plan does; the revised card then offers Update saved plan, which replaces the saved plan in its place on Home instead of adding a second one. A revision of a plan the user saved from the chat offers the same. Each stop of a driven plan has Refresh parking (Find parking here before its first reading), which reads that stop's sensors again and keeps the new reading with the plan, for example once the user reached the stop before it ([agent-protocol.md](../agent-protocol.md#saved-plans)). Plans whose timed stops are all over are marked Past and listed last. At most 30 per user ([agent-protocol.md](../agent-protocol.md#saved-plans)).
9. **Following a plan** (since 2026-10-18). On a saved plan's page each stop's number is a tick the user taps on reaching it; ticking a stop ticks the ones before it, and taking a tick off takes off the ones after. The next stop is outlined and has I'm here. Above the card, a bar shows how many stops are visited, Next names the next stop and opens it on the map, and Start over clears the ticks. The progress is kept with the plan on the service, so it is the same on every device, and the plan's tile on Home shows it ("1 of 3 visited"). Removing or reordering stops starts it again ([agent-protocol.md](../agent-protocol.md#saved-plans)). A stop opened on the map, from a plan or any card, gets a large dark pin in an amber halo with its name above it, also when its layer is not drawn, until another place is opened.

## Example queries

- "What can I do after 7 PM tonight? I enjoy arts and culture and need somewhere accessible on foot or by public transport."
- "I'd like some free activities now."
- "Plan a free, 45-minute walk near me, with a few interesting stops along the way."
- After a walk plan, Change plan: "Swap the second stop for a café." Expect the other stops kept, one new searched stop and a new route.
- After an evening plan, Change plan: "Start an hour later." Expect the same kind of stops with later times, no unverified sources.
- "Plan something fun for tonight." Expect a plan card with stated assumptions, then up to three questions about it (when, how long, how they travel), asked together.
- After those questions, answer "In an hour" and "Drive". Expect a revised plan with later times, travel mode drive and live parking at each located stop, and no `find_parking` call.
- "Plan something fun for tonight." (since 2026-10-17) Expect no card in the first turn, only up to three questions asked together (such as what time tonight, how they get around, what they enjoy). After answering "2 to 3 hours" and "Walk", expect one plan card, walking, and no further questions.
- "Plan a free, 45-minute walk near me." Expect a plan at once: the request leaves nothing open that would change it.
- On a saved plan, Change with Melens: "Make it later." Expect up to three questions first (how much later), then one revised plan card that offers Update saved plan.

## Acceptance criteria (Draft)

- [ ] Evening results include only events that start after the requested time, each with a source link.
- [ ] Each evening result says how to get there on foot or by public transport.
- [ ] A walk plan has free stops only, takes about 45 minutes, uses at most 13 waypoints and is drawn on the map.
- [x] Every stop or event cites a MapFeature id or a web link.
- [ ] If the events layer has too few Melbourne events, the agent falls back to Search grounding and links the pages it used.
- [x] Change plan sends a `refine` turn for that card; the revised plan keeps the unchanged stops and cites their sources without a new search.
- [x] Save plan keeps the card and its route per uid; it shows on the Home tab until removed and outlives the chat session.
- [x] A plan turn may ask up to three questions about the plan it showed, each naming the card; the answers, sent together, reach the model with the whole plan and its sources.
- [x] Before a plan the agent asks up to three questions together, without a card, and makes the plan once from the answers; a change that needs answers asks first and revises once.
- [x] A saved plan can be renamed and have its stops removed or reordered, with its route drawn again; Change with Melens revises it in the chat, and Update saved plan keeps the revision in its place.
- [x] A saved plan's stops can be ticked off as the user reaches them; the next stop stands out and the progress is kept with the plan; a stop opened on the map is pinned and named.
- [x] A driven plan shows the live parking near each located stop, read by code with the area's cited rules; a saved plan's stop reads it again on request and keeps the new reading.

**Audit, 2026-10-17.** A ticked item is backed by code and a test or recorded check. Still open: `search_features` filters events by window overlap, so an event that started before the requested time still passes; `getting_there` is optional in the card schema and not checked; nothing checks that walk stops are free or that the walk takes about 45 minutes (the 13-waypoint limit is enforced); there is no rule or test for falling back to Search grounding when events are scarce. The eval checks tool traces, not card content.

## Notes

- Events come only from sources with a traceable origin. What's On Melbourne has no API; do not scrape it.

## Open questions

- Is Ticketmaster's Melbourne coverage enough? The plan set 2026-09-29 as the date to test it.
