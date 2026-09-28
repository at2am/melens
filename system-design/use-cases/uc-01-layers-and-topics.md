---
id: UC-01
title: Views, layers and topics
priority: P0
status: planned
proposed_by: Haoyuan Tang
trigger: browse
agents: [map_agent]
tools: [show_layers]
data_sources: [pedestrian-live, ptv-gtfs-realtime, road-disruptions, events-ticketmaster]
source_rows: [Views/layers/topics]
---

# UC-01: Views, layers and topics

Every dataset reaches the user as a layer, and every other feature hangs off a layer. That makes this the first thing to build.

## User stories

> As a user, I would like to manage and categorise information as views, layers or topics, and toggle the related datasets' visibility on the map. For example, I can toggle on concerts and live music to focus on that kind of information on the map.

## Behaviour

1. The map shows a layer panel. Each layer groups the MapFeatures of one topic (`MapFeature.layer`).
2. Toggling a layer shows or hides its features at once; the app listens to Firestore.
3. The enabled layers are sent to the agent with every question, so answers focus on what the user is looking at.
4. In the chat, the agent can turn layers on or off with `show_layers` (UC-13).

## Acceptance criteria (Draft)

- [ ] Each P0 dataset appears as its own layer: pedestrian counts, anomalies (UC-04), transport disruptions (UC-05) and events.
- [ ] Toggling a layer updates the map without a reload.
- [ ] Agent requests include the list of enabled layers.
- [ ] Layers from user-added sources (UC-07, P1) appear alongside the built-in ones.

## Notes

- Heatmaps: the Maps JavaScript API removed the heatmap layer in version 3.65. On Flutter Web, pin version 3.64 or draw pedestrian counts as circles scaled by volume.

## Open questions

- Does the MVP need saved "views" (named combinations of layers), or only per-layer toggles?
