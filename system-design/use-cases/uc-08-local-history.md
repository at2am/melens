---
id: UC-08
title: Local history
priority: P1
status: planned
proposed_by: Haoyuan Tang
trigger: query
agents: [map_agent]
tools: [heritage_lookup, search_grounding]
data_sources: [heritage-vhd, search-grounding]
source_rows: [Local history]
---

# UC-08: Local history

Cheap to add: essentially one agent tool plus Search grounding.

## User stories

> As a user, I would like to know the history of a selected region, to learn what happened there in the past.

## Behaviour

1. The user selects a region and asks about its history.
2. `map_agent` calls `heritage_lookup` for heritage records nearby and uses Search grounding for more context.
3. The answer is a short history with a source for each claim.

## Example queries

None collected yet.

## Acceptance criteria (Draft)

- [ ] The answer cites Victorian Heritage Database records or web links for each historical claim.
- [ ] Heritage places mentioned in the answer can be located on the map.

## Notes

- The Victorian Heritage Database has coordinates and history summaries, with about 2,862 records in the City of Melbourne. Its update frequency is not verified.
