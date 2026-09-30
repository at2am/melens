# Parking source join review (2026-09-29, Australia/Melbourne)

The current City of Melbourne exports do not support the planned complete three-table `marker_id` / `bay_id` join. Keep the three connectors at `review_required`; do not derive `may_park_now` from these feeds.

| Official dataset | Export rows | Current identity fields | Source processing time reported by API |
| --- | ---: | --- | --- |
| [On-street Parking Bay Sensors](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/) | 6,324 | `kerbsideid`; no `marker_id` or `bay_id` | 2026-09-28 17:58:53 UTC |
| [On-street Parking Bays](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bays/) | 29,053 | `roadsegmentid`, nullable string `kerbsideid`; point coordinates, no bay polygon or `marker_id` | 2026-06-25 00:52:56 UTC |
| [On-street Car Park Bay Restrictions](https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-park-bay-restrictions/) | 4,263 | `bayid`; up to six numbered rule slots | 2022-11-13 10:30:19 UTC |

Method: fetched each official `exports/json` snapshot, counted rows and distinct non-null IDs, normalized integer and string keys to decimal text, then compared exact ID sets. Sensor `kerbsideid` has 6,324 distinct values; bay `kerbsideid` has 5,053; restriction `bayid` has 4,263. The bay export has 23,981 rows with null `kerbsideid`. Exact overlaps: sensor ↔ bay `kerbsideid`: **4,825**; sensor `kerbsideid` ↔ restriction `bayid`: **76**; bay `kerbsideid` ↔ restriction `bayid`: **10**; three-way overlap: **10**. Equal numbers across the restriction table are not proof of a valid crosswalk.

The dataset descriptions still mention older `marker_id` / `bay_id` joins, but the current API schemas do not expose those keys. T035 and SC-005 need a publisher-confirmed mapping or replacement feed and a fresh 30-bay join sample. Coordinates alone are not a defensible substitute for a key.

## Candidate zone-level replacement

The official [Sign plates located in each Parking zone](https://data.melbourne.vic.gov.au/explore/dataset/sign-plates-located-in-each-parking-zone/) export uses `parkingzone`, days, times and `restriction_display`; the sensor feed uses `zone_number`. After integer key normalization, 458 of 536 distinct sensor zones appear in 622 sign zones, covering 4,849 of 6,324 sensors. The companion [Parking zones linked to street segments](https://data.melbourne.vic.gov.au/explore/dataset/parking-zones-linked-to-street-segments/) shares 527 sensor zones. These are promising **zone-level** joins, not proof that each bay follows the same rule or that exceptions, public access and holidays are fully represented. A separate source ID, connector and permission/field review would be needed before using them in parking decisions.
