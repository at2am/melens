# Current parking join evidence (2026-10-01)

The [City of Melbourne parking bays page](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bays/) still describes polygon bays joined to sensors by `marker_id`, and the [restrictions page](https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-park-bay-restrictions/) describes a sensor-to-rule join by `bay_id`. The current v2.1 API response sampled on 2026-09-29 differs:

| Current API | Observed fields relevant to joining |
| --- | --- |
| [Parking bays](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bays/records?limit=1) | `roadsegmentid`, optional `kerbsideid`, latitude/longitude point; no `marker_id`, no bay polygon |
| [Parking sensors](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records?limit=1) | `kerbsideid`, location, occupancy and timestamps; no `marker_id` or `bay_id` in inspected current and latest rows |
| [Restrictions](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-car-park-bay-restrictions/records?limit=1) | `bayid`, `deviceid` and rule slots; no `kerbsideid` |

The 2026-09-30 read-only `limit=1` API recheck returned 29,053 bays, 6,324 sensors and 4,263 restriction rows with the fields above. The latest sensor row previously inspected was updated on 2026-09-29, so the sensor feed itself is active. The restrictions dataset page reports a static source and last data processing in 2022. A sample sensor `kerbsideid=9623` matched exactly one bay row on that field, but matched no restrictions row by `bayid` or `deviceid`. One example is insufficient to approve a general crosswalk; `kerbsideid` must not be relabelled `marker_id` or `bay_id`.

The 2026-10-01 read-only recheck used one record from each dataset. The three counts and missing identifiers above were unchanged. The sampled sensor had `zone_number`, but neither an official marker nor a sensor-bay key. The restrictions metadata still reports `data_processed=2022-11-13T10:30:19+00:00`. Metadata processing in 2026 does not establish that the signs remain effective in 2026.

The connector retains missing identifiers as null. `evaluateParkingBay` returns `mayParkNow=unknown` until it has an explicit unique bay-to-sensor marker, an independently verified sensor-bay-to-rule crosswalk, a current rule validity window, public access evidence, a current observation and holiday/vehicle evidence. It still exposes an occupancy observation only when its sensor-to-bay marker is unique. T035 remains open until a current official mapping and rule validity evidence are available.

The BigQuery `v_parking_current` view uses only a unique publisher `marker_id` for bay-to-sensor occupancy evidence. It does not join the current restrictions directly to the bay export by equal-looking `bay_id`; without an admitted crosswalk its rule fields are null and `may_park_now` cannot become `yes`. A fresh occupied sensor or an explicitly non-public bay may still yield `no` with its own evidence.

## Additional official datasets investigated

| Official dataset | Evidence observed on 2026-10-01 | Remaining gaps |
| --- | --- | --- |
| [ArcGIS ParkingBays](https://gisags.melbourne.vic.gov.au/server_wa/rest/services/Basemaps/Basemap_Light_WMS/MapServer/7) | Polygon geometry; fields include `SensorID`, `UNIQUE_ID`, `HISTORIC_ID`, `EXTERNAL_ID`, `PBP_ZONE_NO`, `LeftSignID` and `RightSignID`. Two limited sample rows had empty `SensorID` and null candidate crosswalk keys. | Layer field names do not prove equivalence with the current `kerbsideid`, historical `bayid` or `deviceid`. No verified current three-way mapping, validity, or reuse license was found. |
| [ParkingBayCentroid_7855](https://gisags.melbourne.vic.gov.au/server_wa/rest/services/Hosted/ParkingBayCentroid_7855/FeatureServer/0) | Point geometry and `orig_fid`; no sensor, zone or restriction fields. | A centroid cannot restore the missing sensor-to-rule mapping. |
| [Sign plates located in each parking zone](https://data.melbourne.vic.gov.au/explore/dataset/sign-plates-located-in-each-parking-zone/) | 1,821 records; zone, day range, wall-clock times and compact restriction codes. Data processing was 2026-06-25. | Metadata says monthly source updates and static quality updates. Rows have no validity dates, holiday policy, exemptions, current per-bay relation or complete restriction semantics. |
| [Parking zones linked to street segments](https://data.melbourne.vic.gov.au/explore/dataset/parking-zones-linked-to-street-segments/) | 926 records. The publisher documents joining the sign-plate dataset by parking zone and the road-corridor dataset by street segment. Zones and street segments can each map to several of the other. | The documented join supports street/zone context. It does not prove that sensor `zone_number` is a current per-bay legal-rule crosswalk. |

These sources are investigation candidates. Equal-looking zone or sensor values and spatial proximity do not constitute an admitted crosswalk. No connector or source admission was added from these samples.

## Sensor operating limits

The [official sensor metadata API](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors) currently reports a two-minute quality update frequency. It also says sensors do not operate on public holidays, and construction zones can block bays that still appear vacant. The source manifest and disabled candidate schedule now use 120 seconds. A one-minute collection setting would not make the provider refresh every minute.

For `melbourne.parking.sensors`, the normalizer now returns unknown occupancy freshness when the Melbourne holiday state is true or unverified. It preserves the recorded occupancy value and timestamp, with the operating-limit reason. A recent reading cannot prove availability on a day when the publisher says the sensor does not operate. Vacancy also needs current public-access and rule evidence; it cannot prove that a construction zone is accessible.

## Normalizer changes and verification

- Rule applicability distinguishes current, known inactive and unknown evidence. A missing or malformed validity date, unknown schedule, unknown holiday policy, or competing unidentified restriction cannot disappear from consideration and let another rule produce `yes`.
- Zod validates calendar dates and ISO timestamps before comparison. Validity dates and successful-check timestamps require UTC `Z`; observations may carry an explicit offset and are compared as absolute instants. Invalid dates such as February 30, date-only values, and unzoned wall-clock values cannot establish current evidence. Invalid or reversed validity intervals fail the current decision. Overnight and equal-time signs remain unknown until the publisher defines date ownership and full-day semantics.
- `EffectiveOnPH=1` means a scheduled restriction also applies on public holidays. It does not make the restriction exclusive to holidays. Unverified holiday status prevents permission, including for a synthetic `all_days` rule, as required by the acceptance rule.
- Each sensor's latest observation is selected by its timestamp instant before joining its current marker. A move cannot leave a previous marker looking available. Multiple current device identities or conflicting observations at the same instant produce unknown occupancy.
- Cadence must be finite and positive. A successful source check older than the reported observation does not prove current data. Bay identity/version and nonempty marker/crosswalk keys must match.

The targeted normalization tests exercise these behaviors with synthetic reviewed-crosswalk inputs. Node.js 24.21.0 passed all 24 normalization tests, the full TypeScript type check, and the changed-file whitespace check on 2026-10-01. These are development checks. They do not meet the 30 real complete-bay and 10 anomaly samples required by SC-005. No real row in this investigation was promoted to legal parking permission.

## Live map layer verification (2026-10-15, UC-15)

Read-only full exports of the official sensor and bay datasets at 08:13–08:16 UTC:

| Check | Result |
| --- | --- |
| Refresh | The export refreshed every 2 minutes (`lastupdated` 08:12:49 → 08:14:49); 140 sensors changed state in one cycle. |
| Heartbeat | Each sensor's `lastupdated` is its own last report. 5,284 sensors equalled the snapshot time; 1,040 had not reported for over a day, 963 for over 30 days, and none of the 140 changes came from them. `status_timestamp` is only the last occupancy change. |
| Positions | All 6,324 sensors have coordinates inside the service envelope. |
| `kerbsideid` to bay points | 4,825 sensors (76%) match a bay point, at a median 1.6 m from the sensor, so the bay point adds nothing; 14 matches are over 25 m apart (the largest 3.5 km). The bay export stores `kerbsideid` as a string and the sensor export as a number. |
| ArcGIS `ParkingBays` polygons | 24,807 polygons. `SensorID` is an empty string on nearly every row and matches one sensor. Point-in-polygon puts 3,843 sensors (61%) inside exactly one polygon and 2,481 outside any; 332 polygons hold more than one sensor. The layer's licence is not reviewed. |

Decisions:

- The layer draws each sensor at its own coordinates. Bay polygons wait for the ArcGIS licence review.
- The map reads only `melens_ingest.parking_sensor_current`, the latest complete snapshot that the ingest job replaces in one transaction after each published batch, through `v_parking_sensor_current`. That view had read the append-only history and scanned 165 MB per read against the 100 MB dynamic ceiling; the probe of the new view with real source tables billed 21 MB, mostly minimum billing on the two small tables. Do not point it back at the history tables.
- A sensor whose own last report is older than four cadences is `stale` and is drawn as no data (`sensor_not_reporting`), never as vacant.

Outage found the same day: the sensor job failed from 2026-10-01 18:00 to 2026-10-15 08:38 UTC on its 500 MB billed-byte ceiling (`recover-published-parking-business-state` needed 506 MB), while the retention job failed on the 500 MB ceiling its multi-statement script shared, so `parking_sensor_memberships` grew to 961,248 rows and was never cleaned. After a manual cleanup of old membership rows and two retention runs the job published again at 08:38 UTC. Retention now issues one query per table, cleans membership first and keeps one hour of membership (`src/core/source-retention.ts`).
