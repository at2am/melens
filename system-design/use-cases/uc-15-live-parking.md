---
id: UC-15
title: Live parking bays
priority: P0
status: in-progress
proposed_by: Haoyuan Tang
trigger: query
agents: [map_agent]
tools: [search_features, get_feature, show_layers, focus_map, highlight_features, show_card]
data_sources: [parking-sensors]
source_rows: []
---

# UC-15: Live parking bays

The map shows, for the area the user searches or looks at, which on-street bays the City of Melbourne sensors read as vacant or occupied right now. Added on 2026-10-15 as a v1 requirement; it is not UC-10, which predicts future availability and stays P2.

## User stories

> As a driver heading somewhere in the city, I would like to see which bays near my destination are free right now, so I can go straight to one instead of circling.

## Behaviour

1. The user searches for a place or pans the map there, and turns on the Parking sensors layer, or asks the assistant ("is there parking near Melbourne Central?").
2. The map service reads only the sensors inside that viewport from `melens_query.v_parking_sensor_current`. The assistant searches with `search_features` and `layers: ["parking"]` over a small radius, then shows the result on the map.
3. Close up (zoom 17 and above) each sensor is a dot: green for vacant, red for occupied, grey for no data. Further out, sensors cluster, and the cluster counts the vacant ones. Tapping a dot opens its details: the reading, when the sensor last reported and when the status last changed, the parking zone, and two fixed notes: a vacant sensor does not mean parking there is allowed now, and works can block a bay that still reads vacant.

## Example queries

- "Is there parking near Melbourne Central right now?"
- "Show me free parking bays around Queen Victoria Market."
- "Any empty spots on Lygon Street?"

## Acceptance criteria (Draft)

- [x] Only the sensors inside the requested viewport are read; a map read scans a few MB, under the 100 MB dynamic ceiling, however much history the warehouse keeps.
- [x] A sensor whose own last report is too old reads **No data** (`notReporting`), never vacant. About 1,040 of the 6,324 sensors were silent on 2026-10-15.
- [x] Readings are not shown on public holidays (the sensors do not operate) or when the holiday calendar is unknown.
- [x] Every parking item has `legalParking: unknown`, and the details and the assistant say that a vacant sensor is not permission to park.
- [x] Close up each bay is drawn on its own; further out sensors cluster with a vacant count.
- [ ] The live map in the deployed app shows parking around a searched place (needs the data job image and map/agent deployments from this change).

## Notes

**Design rules. Do not revert these without the project owner's agreement.**

- **Collect the whole city, read by area.** The ingest job keeps collecting every sensor every 2 minutes and stores it in the Melens structure in BigQuery; the app and the agent read only the area they need through the published views. They never call the City of Melbourne API directly, and Flutter never reads BigQuery.
- **The map reads only the latest snapshot.** `melens_ingest.parking_sensor_current` holds one row per sensor and is replaced in one transaction after each published batch (`cloud/data/src/core/parking-sensor-current.ts`). `v_parking_sensor_current` reads only that table. An earlier version read the append-only history (`parking_sensor_memberships`, `source_records`, `geo_records`) and scanned 165 MB per read, so its cost grew with every retained snapshot. `cloud/data/test/integration/parking-sensor-current-view.test.ts` fails if the view reads a history table again.
- **Retention runs one query per table.** On 2026-10-01 the sensor ingest and the retention job blocked each other: the retention script shared one 500 MB ceiling across all its deletes, so a backlog stopped every cleanup and the ingest query outgrew its own ceiling. The sensor feed was down from 2026-10-01 18:00 to 2026-10-15 08:38 UTC. Retention now runs each table separately and cleans membership first, keeping one hour of snapshots.
- **A sensor's `lastupdated` is its heartbeat.** `status_timestamp` is only the last change of occupancy; an unchanged bay can keep an old one. Freshness comes from each sensor's own `lastupdated`.
- **Positions.** Sensors carry their own coordinates, so every sensor is drawable as a point. The City of Melbourne ArcGIS bay polygons match 3,843 sensors (61%) by point-in-polygon; drawing bay shapes needs a licence review of that layer first.
- **No legal permission.** No crosswalk from sensors to restriction rules is admitted (`cloud/data/docs/source-policies/parking-join.md`), so the layer never says a bay may be used. Rules, limits, prices and off-street car parks remain web-search questions.

## Open questions

- Whether to draw bay polygons from the ArcGIS ParkingBays layer once its licence is reviewed.
- Whether a place search should turn the parking layer on automatically.
