---
id: UC-10
title: Parking availability prediction
priority: P2
status: planned
proposed_by: Wasabii
trigger: query
agents: []
tools: []
data_sources: [parking-sensors]
source_rows: [Personalized Discovery (parking)]
---

# UC-10: Parking availability prediction

P2 because it needs a model built on historical sensor data, predictions must be clearly separated from live data, and that cannot be done well in 3 weeks.

## User stories

> As a driver, I'd like to know whether parking is likely to be available near my destination when I arrive, so I can plan ahead and spend less time searching for a space.

Expected output, from the Notion notes: a map of nearby parking options with estimated availability at the expected arrival time, parking restrictions, costs, walking distance to the destination, and alternative options. Predictions should be clearly distinguished from current availability.

## Example queries

- "I'm heading to Melbourne Central and expect to arrive at 6 PM. Where am I likely to find parking nearby?"

## Acceptance criteria (Draft)

- [ ] Predicted availability is marked `is_prediction: true` and styled differently from live sensor data.

## Notes

- 6,324 bay sensors, some no longer updating. History only runs to May 2020, which limits any prediction model.

## Open questions

- If built, is it a `map_agent` tool or a workflow?
