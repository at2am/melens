---
id: UC-05
title: Tram and traffic disruption
priority: P0
status: planned
proposed_by: unassigned
trigger: browse
agents: []
tools: []
data_sources: [ptv-gtfs-realtime, road-disruptions]
source_rows: [Tram/Traffic Disruption]
---

# UC-05: Tram and traffic disruption

Official real-time data that is cheap to ingest and visible at a glance. It also gives the insight agent context for UC-04.

## User stories

Translated from the original Chinese in the Notion table:

> On the map, affected public transport or congested motorway sections are marked with red lines or other icons. When the user sees these icons or red segments and taps one, a floating window or other prompt tells them what happened, so they can avoid it when planning a trip.

## Behaviour

1. A connector polls tram and train Service Alerts (GTFS-R) and planned and unplanned road disruptions.
2. Each disruption becomes a MapFeature in the `disruption` layer. Road events are expanded from the parent event into the affected line segments.
3. The app draws red lines or icons. Tapping one shows what happened.

## Acceptance criteria (Draft)

- [ ] Road disruptions appear as red line segments on the affected roads.
- [ ] Tram and train disruptions appear on the affected routes or stops.
- [ ] Tapping a disruption shows what happened, what is affected and the time window if known, with a source.
- [ ] Polling stays within 24 calls per 60 seconds per transport mode.
- [ ] Disruptions are available to the insight agent through `nearby_context`.

## Notes

- Service Alerts cover trams and trains only; buses are not covered.
- Needs the Transport Victoria key. Until it arrives, build against recorded sample responses.

## Open questions

- Who owns this use case?
- Where does route geometry for highlighting tram and train lines come from? Service Alerts name routes and stops, not shapes.
