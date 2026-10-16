---
id: UC-15
title: Live parking bays
priority: P0
status: in-progress
proposed_by: Haoyuan Tang
trigger: query
agents: [map_agent, find_parking]
tools: [find_parking, search_features, get_feature, show_layers, focus_map, highlight_features, search_grounding]
data_sources: [parking-sensors]
source_rows: []
---

# UC-15: Live parking bays

The map shows, for the area the user searches or looks at, which on-street bays the City of Melbourne sensors read as vacant or occupied right now. Added on 2026-10-15 as a v1 requirement; it is not UC-10, which predicts future availability and stays P2.

## User stories

> As a driver heading somewhere in the city, I would like to see which bays near my destination are free right now, so I can go straight to one instead of circling.

## Behaviour

1. The user searches for a place or pans the map there, and turns on the Parking sensors layer, or asks the assistant ("is there parking near Melbourne Central?").
2. The map service reads only the sensors inside that viewport from `melens_query.v_parking_sensor_current`. When the user asks the assistant to find parking, it calls `find_parking` (added 2026-10-16): it reads the bays within 400 m of the destination (800 m when fewer than 3 read vacant), turns the parking layer on, moves the map to the nearest vacant bay at zoom 18 and highlights up to 5 candidates. The user can then pan and zoom freely; the map reads the bays of whatever it shows.
3. The parking card lists the candidates, nearest first, the recommended one marked **Best match**. Each bay shows its live reading and when the sensor last reported, its straight-line distance and walking time to the destination, and the area's published fee, time limit, hours and payment on labelled lines, with the note that these are the area's rules and the sign at the bay decides. When no web source states the rules, the bay says they are not published and to check the sign. A last item cites the page the rules come from.
4. Close up (zoom 17 and above) each sensor is its bay, drawn to scale and centred on the sensor: green for vacant, red for occupied, grey for no data. Further out, sensors cluster, and the cluster counts the vacant ones. Tapping a bay opens its details: the reading, when the sensor last reported and when the status last changed, the parking zone when the source gives one, and two fixed notes: a vacant sensor does not mean parking there is allowed now, and works can block a bay that still reads vacant.

## Example queries

- "Is there parking near Melbourne Central right now?"
- "Show me free parking bays around Queen Victoria Market."
- "Any empty spots on Lygon Street?"
- "Find me a park near Melbourne Central" (the map moves to the nearest vacant bay; the card shows distances and the area's fees and limits)
- "Anywhere to park near here?" (no destination named: the selected point, the user's location or the map centre)

## Acceptance criteria (Draft)

- [x] Only the sensors inside the requested viewport are read; a map read scans a few MB, under the 100 MB dynamic ceiling, however much history the warehouse keeps.
- [x] A sensor whose own last report is too old reads **No data** (`notReporting`), never vacant. About 1,040 of the 6,324 sensors were silent on 2026-10-15.
- [x] Readings are not shown on public holidays (the sensors do not operate) or when the holiday calendar is unknown.
- [x] Every parking item has `legalParking: unknown`, and the details and the assistant say that a vacant sensor is not permission to park.
- [x] Close up each bay is drawn on its own; further out sensors cluster with a vacant count.
- [x] Asking the assistant to find parking moves the map to the nearest vacant bay (zoom 18), turns the layer on and highlights up to 5 candidates, before the rules lookup ends; the map stays free to pan and zoom (`find_parking`, 2026-10-16).
- [x] Each recommended bay on the card shows its reading, distance and walk to the destination, and the area's fee, time limit, hours and payment labelled as the area's rules, or that they are unknown.
- [ ] The live map in the deployed app shows parking around a searched place (needs the data job image and map/agent deployments from this change).

## Notes

**Design rules. Do not revert these without the project owner's agreement.**

- **Collect the whole city, read by area.** The ingest job keeps collecting every sensor every 2 minutes and stores it in the Melens structure in BigQuery; the app and the agent read only the area they need through the published views. They never call the City of Melbourne API directly, and Flutter never reads BigQuery.
- **The map reads only the latest snapshot.** `melens_ingest.parking_sensor_current` holds one row per sensor and is replaced in one transaction after each published batch (`cloud/data/src/core/parking-sensor-current.ts`). `v_parking_sensor_current` reads only that table. An earlier version read the append-only history (`parking_sensor_memberships`, `source_records`, `geo_records`) and scanned 165 MB per read, so its cost grew with every retained snapshot. `cloud/data/test/integration/parking-sensor-current-view.test.ts` fails if the view reads a history table again.
- **Retention runs one query per table.** On 2026-10-01 the sensor ingest and the retention job blocked each other: the retention script shared one 500 MB ceiling across all its deletes, so a backlog stopped every cleanup and the ingest query outgrew its own ceiling. The sensor feed was down from 2026-10-01 18:00 to 2026-10-15 08:38 UTC. Retention now runs each table separately and cleans membership first, keeping one hour of snapshots.
- **A routine publication is not a withdrawal.** The snapshot is replaced every 2 minutes, so the map service's public-rights checks treat `melbourne.parking.sensors` differently from other sources (`ROUTINELY_REPUBLISHED_SOURCES` in `cloud/map/src/services/viewport.ts`, and the parking key in `cloud/map/src/services/public-records.ts`): a stored parking item stays readable while its source is still public and the current public view still returns that sensor, even if a newer batch has landed. Requiring the same batch failed about 1 in 14 viewport requests, and every detail read after the next publication, on 2026-10-15. Withdrawal still fails closed: a source that is no longer public, or a sensor the view no longer returns, is `notAvailable`.
- **A sensor's `lastupdated` is its heartbeat.** `status_timestamp` is only the last change of occupancy; an unchanged bay can keep an old one. Freshness comes from each sensor's own `lastupdated`.
- **Positions.** Sensors carry their own coordinates, so every sensor is drawable as a point. The City of Melbourne ArcGIS bay polygons match 3,843 sensors (61%) by point-in-polygon; drawing bay shapes needs a licence review of that layer first.
- **Bays are drawn at the standard size, not surveyed.** Until the bay polygons are cleared, the app draws each sensor as a standard Melbourne bay centred on the sensor (`app/lib/features/map/ui/renderers/parking_bays.dart`): a parallel bay 6.0 × 2.3 m (AS 2890.5:2020, streets of 50 km/h or less), a 90° bay 5.4 × 2.5 m (AS 2890.1). The feed has no kerb direction, so it comes from the nearest sensors within 10 m along the same line; neighbours under 4 m apart mean 90° bays, and a sensor with no neighbour follows the Hoddle Grid (20.5° north of east). Where sensors are closer than a standard bay, the bay is shortened to leave a 0.5 m gap, so no bay hides a neighbour's reading. About 500 sensors sit within half a metre of another and still draw over each other. On the 2026-10-16 feed (6,324 sensors) the layout takes about 30 ms for the whole city. The selected bay keeps its size and gains an outline.
- **No legal permission.** No crosswalk from sensors to restriction rules is admitted (`cloud/data/docs/source-policies/parking-join.md`), so the layer never says a bay may be used. Rules, limits, prices and off-street car parks remain web-search questions.
- **Card rules are the area's, never the bay's.** `find_parking` shows a fee, time limit, hours and payment only as the published rules for the area around the destination, copied from one cited web page by a generation that may not add anything the sources do not state (`policy_scope: "area"`), and the app always adds that the sign at the bay decides. Without a source they are null and the card says to check the sign. The model cannot write them: the `parking` card fields come only from the workflow, and `show_card` rejects them. Showing a per-bay rule needs an admitted sensor-to-sign crosswalk first; the sensor's `zone_number` joined to the sign-plates dataset is not one.
- **Recommend the nearest vacant bay.** Ranking is straight-line distance from the sensor to the destination, with a `late` reading counted 150 m further; occupied and no-data bays are never recommended. The map focuses on the first at zoom 18 so its neighbours are drawn too.

## Open questions

- Whether to draw bay polygons from the ArcGIS ParkingBays layer once its licence is reviewed.
- Whether a place search should turn the parking layer on automatically.
- Whether to rank by walking route instead of straight-line distance (one Routes call per candidate).
- Whether to admit the sign-plates dataset with a reviewed zone crosswalk, so a bay could show its own posted limits.
