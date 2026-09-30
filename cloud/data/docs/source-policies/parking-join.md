# Current parking join evidence (2026-09-30)

The [City of Melbourne parking bays page](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bays/) still describes polygon bays joined to sensors by `marker_id`, and the [restrictions page](https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-park-bay-restrictions/) describes a sensor-to-rule join by `bay_id`. The current v2.1 API response sampled on 2026-09-29 differs:

| Current API | Observed fields relevant to joining |
| --- | --- |
| [Parking bays](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bays/records?limit=1) | `roadsegmentid`, optional `kerbsideid`, latitude/longitude point; no `marker_id`, no bay polygon |
| [Parking sensors](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records?limit=1) | `kerbsideid`, location, occupancy and timestamps; no `marker_id` or `bay_id` in inspected current and latest rows |
| [Restrictions](https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-car-park-bay-restrictions/records?limit=1) | `bayid`, `deviceid` and rule slots; no `kerbsideid` |

The 2026-09-30 read-only `limit=1` API recheck returned 29,053 bays, 6,324 sensors and 4,263 restriction rows with the fields above. The latest sensor row previously inspected was updated on 2026-09-29, so the sensor feed itself is active. The restrictions dataset page reports a static source and last data processing in 2022. A sample sensor `kerbsideid=9623` matched exactly one bay row on that field, but matched no restrictions row by `bayid` or `deviceid`. One example is insufficient to approve a general crosswalk; `kerbsideid` must not be relabelled `marker_id` or `bay_id`.

The connector retains missing identifiers as null. `evaluateParkingBay` returns `mayParkNow=unknown` until it has an explicit unique bay-to-sensor marker, an independently verified sensor-bay-to-rule crosswalk, a current rule validity window, public access evidence, a current observation and holiday/vehicle evidence. It still exposes an occupancy observation only when its sensor-to-bay marker is unique. T035 remains open until a current official mapping and rule validity evidence are available.

The BigQuery `v_parking_current` view uses only a unique publisher `marker_id` for bay-to-sensor occupancy evidence. It does not join the current restrictions directly to the bay export by equal-looking `bay_id`; without an admitted crosswalk its rule fields are null and `may_park_now` cannot become `yes`. A fresh occupied sensor or an explicitly non-public bay may still yield `no` with its own evidence.
