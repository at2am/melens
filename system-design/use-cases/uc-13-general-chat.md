---
id: UC-13
title: General chat assistant
priority: P0
status: planned
proposed_by: Haoyuan Tang
trigger: query
agents: [map_agent]
tools: [search_features, get_feature, heritage_lookup, get_anomaly, pedestrian_pattern, nearby_context, area_brief, analyse_anomaly, maps_grounding, search_grounding, show_layers, focus_map, draw_route, highlight_features, show_card]
data_sources: [pedestrian-live, pedestrian-history, ptv-gtfs-realtime, road-disruptions, events-ticketmaster, heritage-vhd, news-rss, maps-grounding, search-grounding]
source_rows: []
---

# UC-13: General chat assistant

Beyond the fixed entry points, the chat box is one agent flexible enough for random questions and precise enough to carry out requests with tools. Added 2026-09-28; not from the Notion table.

## User stories

> As a user, I would like to ask anything in the chat box, from a random question to a request that changes the map, and get a useful answer or have the request carried out.

## Behaviour

1. Everything typed into the chat box goes to `map_agent` with the request context (viewport, selection, layers, local time).
2. The agent picks tools from the full registry. Where a workflow covers the request, it calls that workflow instead of rebuilding it.
3. Map requests run through UI action tools, which the app applies.
4. Specific recommendations arrive as cards; general answers arrive as text.

## Example queries

Flexible:

- "Is the State Library worth visiting?"
- "Should I bring an umbrella for tonight's walk?"
- "What time does the free tram zone end?"

Precise (also check the tool trace):

- "Only show live music tonight." Expect `show_layers` and `search_features` with a time filter.
- "Take me to Fitzroy Gardens." Expect `focus_map` and `draw_route`.
- "Why is it so busy here?" Expect `analyse_anomaly`.

Multi-turn chain:

- "What's around here?", then "Why is it so busy right now?", then "OK, plan me a quiet walk away from the crowds."

## Acceptance criteria (Draft)

- [ ] Random questions outside our data get a useful answer, using Search or Maps grounding when facts are needed.
- [ ] Map requests ("only show…", "take me to…") change the map through UI action tools.
- [ ] Requests a workflow covers call that workflow.
- [ ] Specific facts and recommendations appear in cards with sources. General advice may be plain text but never presents live data without a tool result from the same turn.
- [ ] "Here", "now" and "this one" resolve from the request context.
- [ ] Every turn ends within the step budget; near the limit the agent wraps up and answers.
- [ ] The eval checks the tool trace for precise requests: the right tool with the right arguments.

## Notes

- The chat behaviour of UC-02, UC-03, UC-04 and UC-08 is this agent following those use cases' playbooks.

## Open questions

- Weather is a common random question with no data source yet: rely on Search grounding, or add the Google Maps Platform Weather API?
- Requests unrelated to Melbourne: answer briefly, or steer back to the map?
