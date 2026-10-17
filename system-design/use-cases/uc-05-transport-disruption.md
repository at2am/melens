---
id: UC-05
title: Tram and traffic disruption
priority: P0
status: in-progress
proposed_by: unassigned
trigger: browse
agents: []
tools: []
data_sources: [ptv-gtfs-realtime, road-disruptions]
source_rows: [Tram/Traffic Disruption]
---

# UC-05: Tram and traffic disruption

Official real-time data that is cheap to ingest and visible at a glance. It also gives the UC-04 analysis its transport context.

## User stories

Translated from the original Chinese in the Notion table:

> On the map, affected public transport or congested motorway sections are marked with red lines or other icons. When the user sees these icons or red segments and taps one, a floating window or other prompt tells them what happened, so they can avoid it when planning a trip.

## Behaviour

1. A connector polls tram and train Service Alerts (GTFS-R) and planned and unplanned road disruptions.
2. Each disruption becomes a MapFeature in the `disruption` layer. Road events are expanded from the parent event into the affected line segments.
3. The app draws red lines or icons. Tapping one shows what happened.

## Acceptance criteria (Draft)

- [x] Road disruptions appear as red line segments on the affected roads (live in dev since 2026-10-16).
- [x] Tram and train disruptions appear on the affected routes or stops (live in dev since 2026-10-16; 25 of 32 alerts placed on the first feed).
- [ ] Tapping a disruption shows what happened, what is affected and the time window if known, with a source.
- [x] Polling stays within 24 calls per 60 seconds per transport mode (the shared key's limit is 20; schedules peak near 16).
- [ ] Disruptions are available to `map_agent` and `analyse_anomaly` through `nearby_context`.

**Audit, 2026-10-17.** A ticked item is backed by code and a test or recorded check. Still open: the GTFS-R adapter always sends `serviceNames: []` (`cloud/shared/src/query/disruptions.ts`), so a tram or train alert never names its routes, and the details test does not assert the time window or source. `analyse_anomaly` reads disruptions through `searchArea`, not `nearby_context`, and no test shows `nearby_context` returning disruptions.

## Notes

- Service Alerts cover trams and trains only; buses are not covered.
- The Transport Victoria key is in Secret Manager (`transport_victoria_key_id`, version 1) and works.
- 2026-10-16: planned and unplanned road disruptions are admitted (CC BY 4.0), scheduled and registered with the map. Unplanned roads now run every 20 minutes (first every 10, not every minute), because each road publication rebuilds the source's rows in `geo_records_current` (about 0.5 GB billed). Planned roads now run every 6 hours (first at :07 and :37), about 10,400 events statewide on 21 pages.
- 2026-10-16: tram and train service alerts are live. The official GTFS archive has no `feed_info`, so alerts match the newest published static schedule instead of a feed version. The static job reads `shapes.txt` (daily at 01:20 UTC) and publishes each route's paths, simplified to about 5 m. An alert is placed at its station or stop, drawn along the routes it names, or, when it lists several stations on named routes, drawn along those routes (`route_with_stops`). Alerts whose selectors only partly match stay unlocated. Realtime runs every 10 minutes.
- Road and GTFS-R batches are validated as complete snapshots, within the batch, so the version checks do not grow with history.
- Cost, 2026-10-16: the layer billed about 300 GB a day of BigQuery, nearly all in publishing (validation and the current-table rebuild re-read each source's history; planned roads rewrote about 10,000 rows every 30 minutes). Planned roads now run every 6 hours and unplanned roads every 20 minutes. Transport snapshot validation, rebuilds and the static-schedule load read only recent partitions; an unplanned run fell from about 825 MB to 454 MB. The remaining structural fix, partitions shared by every source, is GitHub issue #9.

## Open questions

- Who owns this use case?
- Should a works alert between two stations be drawn as only that stretch of the line? Today the whole named route is drawn.
