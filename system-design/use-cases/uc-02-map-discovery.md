---
id: UC-02
title: Map discovery
priority: P0
status: in-progress
proposed_by: Wasabii
trigger: query
agents: [area_brief, map_agent]
tools: [area_brief, search_features, heritage_lookup, maps_grounding, search_grounding, focus_map, highlight_features, show_card]
data_sources: [heritage-vhd, events-ticketmaster, maps-grounding, search-grounding]
source_rows: [Map Discovery (current area), Map Discovery (selected location)]
---

# UC-02: Map discovery

The main GenAI feature: the user points at the map and learns what makes that place worth exploring.

## User stories

1. **Current area.** Spontaneous; the user has not planned ahead. The Notion row has no proposer.
   > As a user, I'd like to understand what's happening in my current area.
2. **Selected location.**
   > As a user, I'd like to select a location on the map and discover its local character, notable places, and upcoming activities, so I can understand what makes the area distinctive and decide what to explore.

## Behaviour

1. The user selects a point on the map, or asks in the chat about where they are. The app sends the coordinates, the current time and the enabled layers.
2. The `area_brief` workflow searches layer features and heritage records within a radius, and uses Maps grounding only for place details the layers do not carry or when they return nothing useful there. From the chat, `map_agent` calls the same workflow as a tool.
3. The first answer is an `area_brief` card with a fixed format: neighbourhood character, recommended places, upcoming activities.
4. The chat stays open; follow-up questions go to `map_agent`.

## Example queries

- "What's interesting around here?"
- "I've never been to this area. Where should I start?"
- "What's this neighborhood known for?"
- "I have an hour to explore here. What should I check out?"
- "Are there any small galleries or independent bookstores nearby?"
- "Anything happening around here this weekend?"
- "What's this area like in the evening?"
- "Where can I sit somewhere quiet and have a coffee?"
- "I walk past here every day. What might I be missing?"
- "Can you suggest a short walk that helps me get to know this neighborhood?"

## Acceptance criteria (Draft)

- [ ] Works both for a point selected on the map and for the user's current location.
- [ ] The first answer is a card with three sections: neighbourhood character, recommended places, upcoming activities.
- [ ] Every recommended place or activity cites a MapFeature id or a web link.
- [ ] Follow-up questions keep the selected location as context.
- [ ] Results from Maps grounding show Google Maps attribution.

## Notes

- Walk requests ("suggest a short walk") share the route logic with UC-03.
- Maps grounding answers in English only.
