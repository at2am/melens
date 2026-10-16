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
2. The map reads parking only from camera zoom 16 in (`parkingMinZoom` in `app/lib/features/map/state/viewport_controller.dart`); further out the layer stays on but is left out of the request, and the map says "Zoom in to see parking." The map service reads only the sensors inside that viewport from `melens_query.v_parking_sensor_current`. The assistant searches with `search_features` and `layers: ["parking"]` over a small radius, then shows the result on the map.
3. Close up (zoom 17 and above) each sensor is its bay, drawn to scale and centred on the sensor: green for vacant, red for occupied, grey for no data. Further out, sensors cluster, and the cluster counts the vacant ones. Tapping a bay opens its details: the reading, when the sensor last reported and when the status last changed, the parking zone when the source gives one, and two fixed notes: a vacant sensor does not mean parking there is allowed now, and works can block a bay that still reads vacant.

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
- [x] Zoomed out wider than zoom 16 the map sends no parking request and asks the user to zoom in.
- [ ] The live map in the deployed app shows parking around a searched place (needs the data job image and map/agent deployments from this change).

## Notes

**Design rules. Do not revert these without the project owner's agreement.**

- **No parking read for a wide view.** Asked for by the project owner on 2026-10-16 (zoom 16 is a first value, not yet tuned on devices): the map leaves parking out of the viewport request below zoom 16. Measured on live data on 2026-10-16, a parking read returned 370 to 470 KB at every zoom, even a metro-wide view that was one cluster, and the map service loads the layers of one request one after another, so a wide parking read held up every other layer and could miss the 30 s request deadline.

- **Collect the whole city, read by area.** The ingest job keeps collecting every sensor every 2 minutes and stores it in the Melens structure in BigQuery; the app and the agent read only the area they need through the published views. They never call the City of Melbourne API directly, and Flutter never reads BigQuery.
- **The map reads only the latest snapshot.** `melens_ingest.parking_sensor_current` holds one row per sensor and is replaced in one transaction after each published batch (`cloud/data/src/core/parking-sensor-current.ts`). `v_parking_sensor_current` reads only that table. An earlier version read the append-only history (`parking_sensor_memberships`, `source_records`, `geo_records`) and scanned 165 MB per read, so its cost grew with every retained snapshot. `cloud/data/test/integration/parking-sensor-current-view.test.ts` fails if the view reads a history table again.
- **Retention runs one query per table.** On 2026-10-01 the sensor ingest and the retention job blocked each other: the retention script shared one 500 MB ceiling across all its deletes, so a backlog stopped every cleanup and the ingest query outgrew its own ceiling. The sensor feed was down from 2026-10-01 18:00 to 2026-10-15 08:38 UTC. Retention now runs each table separately and cleans membership first, keeping one hour of snapshots.
- **A routine publication is not a withdrawal.** The snapshot is replaced every 2 minutes, so the map service's public-rights checks treat `melbourne.parking.sensors` differently from other sources (`ROUTINELY_REPUBLISHED_SOURCES` in `cloud/map/src/services/viewport.ts`, and the parking key in `cloud/map/src/services/public-records.ts`): a stored parking item stays readable while its source is still public and the current public view still returns that sensor, even if a newer batch has landed. Requiring the same batch failed about 1 in 14 viewport requests, and every detail read after the next publication, on 2026-10-15. Withdrawal still fails closed: a source that is no longer public, or a sensor the view no longer returns, is `notAvailable`.
- **A sensor's `lastupdated` is its heartbeat.** `status_timestamp` is only the last change of occupancy; an unchanged bay can keep an old one. Freshness comes from each sensor's own `lastupdated`.
- **Positions.** Sensors carry their own coordinates, so every sensor is drawable as a point. The City of Melbourne ArcGIS bay polygons match 3,843 sensors (61%) by point-in-polygon; drawing bay shapes needs a licence review of that layer first.
- **Bays are drawn at the standard size, not surveyed.** Until the bay polygons are cleared, the app draws each sensor as a standard Melbourne bay centred on the sensor (`app/lib/features/map/ui/renderers/parking_bays.dart`): a parallel bay 6.0 × 2.3 m (AS 2890.5:2020, streets of 50 km/h or less), a 90° bay 5.4 × 2.5 m (AS 2890.1). The feed has no kerb direction, so it comes from the nearest sensors within 10 m along the same line; neighbours under 4 m apart mean 90° bays, and a sensor with no neighbour follows the Hoddle Grid (20.5° north of east). Where sensors are closer than a standard bay, the bay is shortened to leave a 0.5 m gap, so no bay hides a neighbour's reading. About 500 sensors sit within half a metre of another and still draw over each other. On the 2026-10-16 feed (6,324 sensors) the layout takes about 30 ms for the whole city. The selected bay keeps its size and gains an outline.
- **No legal permission.** No crosswalk from sensors to restriction rules is admitted (`cloud/data/docs/source-policies/parking-join.md`), so the layer never says a bay may be used. Rules, limits, prices and off-street car parks remain web-search questions.

## Open questions

- Whether to draw bay polygons from the ArcGIS ParkingBays layer once its licence is reviewed.
- Whether a place search should turn the parking layer on automatically.
