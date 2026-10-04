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

1. The map shows topic views and a layer panel. A topic groups one or more registered layer ids; each typed map item identifies its layer with `layerId`.
2. Toggling a layer updates existing results at once. The app requests bounded viewport/time results from the read-only Cloud Run map service using [map contract v1](../../specs/002-map-data-presentation/contracts/map-api.md); the service reads admitted, published BigQuery views. No Firestore map listener is required.
3. The enabled layers are sent to the agent with every question, so answers focus on what the user is looking at.
4. In the chat, the agent can turn layers on or off with `show_layers` (UC-13).

## Acceptance criteria (Draft)

- [ ] Each P0 dataset appears as its own layer: pedestrian counts, anomalies (UC-04), transport disruptions (UC-05) and events.
- [ ] Toggling a layer updates the map without a reload.
- [ ] Agent requests include the list of enabled layers.
- [ ] Layers from user-added sources (UC-07, P1) appear alongside the built-in ones.

## Notes

- First delivery draws pedestrian count circles with area proportional to same-window sensor passages. Missing observations remain unknown, and a measured zero remains zero. Later H3 coverage/anomaly views and the count-driven 3D pilot have separate delivery gates; neither blocks P0.
- V1 registers pedestrian, anomaly, disruption, event, planning, boundary, news, rent and census. Registration does not imply published coverage or source admission. P0 display, source publication and full P0 product acceptance are separate gates in [the map plan](../../specs/002-map-data-presentation/plan.md).
- The first topic views are City activity, Nearby news and Area comparison. Session toggles are preserved within each topic; only one area metric is filled at once. Persistent named views remain outside the first delivery.

## Open questions

- Saved named views can be considered after the P0 map; v1 requires topic-session state and per-layer toggles only.
