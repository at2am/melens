# Data sources

**Status:** Checked call by call on 2026-09-27. Only the Transport Victoria data needs a key (self-service registration on the open data portal). Events are the weakest source: What's On Melbourne has no API.

Use cases reference sources by the `id` column. The chat agent (UC-13) can reach every source through its tools, parking sensors through `search_features` with the `parking` layer (UC-15); `pedestrian_pattern` reads `pedestrian-history`.

| id | Data | Source | Access | Freshness | Notes | Use cases |
| --- | --- | --- | --- | --- | --- | --- |
| `pedestrian-live` | Pedestrian counts (live) | [City of Melbourne: past-hour counts per minute](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-past-hour-counts-per-minute/) | Opendatasoft REST v2.1, no key | Per minute, about 15–30 min delay | No coordinates; join with the [sensor locations](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-sensor-locations/) table (134 sensors) | UC-04 |
| `pedestrian-history` | Pedestrian counts (history) | [City of Melbourne: monthly counts per hour](https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-monthly-counts-per-hour/) | Opendatasoft REST v2.1, no key | About daily | Hourly since 2009, about 1.6 million rows; sensor locations changed over the years | UC-04 |
| `ptv-gtfs-realtime` | Tram and train disruptions | [Transport Victoria: GTFS Realtime](https://opendata.transport.vic.gov.au/dataset/gtfs-realtime) | GTFS-R protobuf, key required | Tram every 60 s, train near real time | Service Alerts cover train and tram only, not bus; 24 calls per 60 s per transport mode | UC-05 |
| `road-disruptions` | Road disruptions | [Unplanned](https://opendata.transport.vic.gov.au/dataset/unplanned-disruptions-road) and [planned](https://opendata.transport.vic.gov.au/dataset/planned-disruptions-road) road disruptions | REST, same key | Near real time | Event-to-affected-segment parent/child structure; expand into line segments | UC-05 |
| `parking-sensors` | Parking bays (live) | [City of Melbourne: on-street parking bay sensors](https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/) | REST, no key | Every 2 minutes (checked 2026-10-15) | 6,324 sensors with their own coordinates. Each sensor's `lastupdated` is its heartbeat: 1,040 had not reported for over a day on 2026-10-15 and are shown as no data; `status_timestamp` is only the last occupancy change. No operation on public holidays; works can block a bay that reads vacant. No admitted crosswalk to the restriction rules, so a reading is never legal permission. Collected citywide, read by viewport from the latest-snapshot table (UC-15). History only runs to May 2020, which is why parking prediction is P2 | UC-10, UC-15 |
| `events-ticketmaster` | Events | [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/) | REST, free key issued instantly | Real time | 5,000 calls per day; Melbourne coverage still to be tested | UC-02, UC-03 |
| `heritage-vhd` | History and heritage | [Victorian Heritage Database API](https://api.heritagecouncil.vic.gov.au/) | REST JSON, no key | Not verified | Coordinates and history summaries; about 2,862 records in the City of Melbourne | UC-02, UC-08 |
| `news-rss` | News | [ABC Just In](https://www.abc.net.au/news/feed/51120/rss.xml), [The Age Victoria](https://www.theage.com.au/rss/national/victoria.xml) | RSS | Real time | No coordinates: Gemini extracts place names, then Geocoding locates them | UC-04, UC-06 |
| `maps-grounding` | Places and routes | [Gemini: Grounding with Google Maps](https://ai.google.dev/gemini-api/docs/maps-grounding) | Gemini tool | Real time | English questions and answers only; Google Maps attribution required wherever results are shown | UC-02, UC-03 |
| `search-grounding` | Web search | [Gemini: Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search) | Gemini tool | Real time | Billed per call; cache results in Firestore | UC-02, UC-03, UC-04, UC-08 |

**Event fallback:** if Ticketmaster has too few Melbourne events, `map_agent` uses Search grounding to find tonight's events and links the pages it used. Do not scrape What's On Melbourne.

**Before the transport key arrives:** build against recorded sample responses.
