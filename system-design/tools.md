# Tools

**Status:** Draft, 2026-09-28; revised 2026-10-09 so data tools read the published BigQuery views and ids follow the map contract. Implemented in `cloud/agent` on 2026-10-09: `search_features`, `get_feature`, `nearby_context`, `show_layers`, `focus_map`, `highlight_features`, `show_card`, `ask_user`, `maps_grounding` and `search_grounding`; on 2026-10-15: `get_anomaly`, `draw_route`, `area_brief` and `analyse_anomaly`; on 2026-10-16: `find_parking` (the Zod schemas in `cloud/agent/src/tools/catalog.ts` and `cloud/agent/src/workflows/workflows.ts` are now their source of truth); `heritage_lookup` and `pedestrian_pattern` remain this contract until they exist in code. After that the code schemas (Zod in `cloud/agent`, exported as JSON Schema) are the source of truth, and this file keeps the model-facing descriptions and the reasons behind them. Until then, any change to a tool's name, arguments, returns or description updates this file in the same commit.

These are the tools of the chat agent `map_agent`. The two workflow tools run the same code as the app's map-tap and Analyse entry points. How the loop uses the tools is in [agent-design.md](agent-design.md); the events they send to the app are in [agent-protocol.md](agent-protocol.md).

**Owners** are proposed from the plan's split and confirmed in F3: platform, framework, grounding and UI tools go to Haoyuan; data and anomaly tools to Alex (plan task A5 names `get_anomaly` and `nearby_context`); discovery workflows and card content to Wasabii.

| Tool | Group | Owner | Used by |
| --- | --- | --- | --- |
| [`search_features`](#search_features) | Data | Haoyuan | UC-02, UC-03, UC-13, UC-15 |
| [`get_feature`](#get_feature) | Data | Haoyuan | UC-13 |
| [`heritage_lookup`](#heritage_lookup) | Data | Wasabii | UC-02, UC-08, UC-13 |
| [`get_anomaly`](#get_anomaly) | Data | Alex | UC-04, UC-13 |
| [`pedestrian_pattern`](#pedestrian_pattern) | Data | Alex | UC-13 |
| [`nearby_context`](#nearby_context) | Data | Alex | UC-04, UC-13 |
| [`area_brief`](#area_brief) | Workflow | Wasabii | UC-02, UC-13 |
| [`analyse_anomaly`](#analyse_anomaly) | Workflow | Alex | UC-04, UC-13 |
| [`find_parking`](#find_parking) | Workflow | Haoyuan | UC-15, UC-13 |
| [`maps_grounding`](#maps_grounding) | Grounding | Haoyuan | UC-02, UC-03, UC-13 |
| [`search_grounding`](#search_grounding) | Grounding | Haoyuan | UC-02, UC-03, UC-04, UC-08, UC-13 |
| [`show_layers`](#show_layers) | UI action | Haoyuan | UC-01, UC-13 |
| [`focus_map`](#focus_map) | UI action | Haoyuan | UC-02, UC-13 |
| [`draw_route`](#draw_route) | UI action | Haoyuan | UC-03, UC-13 |
| [`highlight_features`](#highlight_features) | UI action | Haoyuan | UC-02, UC-03, UC-08, UC-13 |
| [`show_card`](#show_card) | UI action | Haoyuan (validation), Wasabii (card content) | UC-02, UC-03, UC-08, UC-13 |
| [`ask_user`](#ask_user) | Conversation | Haoyuan | UC-03, UC-13 |

## Conventions

- **Names** are snake_case, for tools and arguments alike.
- **Schemas are strict.** Enums are enums, required fields are required, and no extra fields are accepted. The server validates every call as well as the model provider.
- **Data tools read BigQuery.** Every data tool runs a fixed parameterized query over the published `melens_query` views under the agent's read-only identity, with a dry run and `maximumBytesBilled`, the same rules as the map service's query runner. No caller SQL, no raw or staging tables, no Firestore map data and no HTTP calls to the map service.
- **Times** are ISO 8601 with an offset, in Melbourne local time, for example `2026-10-10T19:00:00+11:00`.
- **Lists** return at most 50 rows in compact form. The total always comes first, with `truncated: true` when rows were cut.
- **Every call sends `status` events** to the app: one with state `running` when it starts, carrying the tool's status line and a short summary of its arguments, and one with `done` or `failed` when it ends, carrying the row count, the duration and any error code. This is the reasoning trace users and judges see, step by step while the turn runs. UI action and conversation tools send their own event as well (`ui_action`, `card`, `question`), tagged with the same `stepId`.
- **Read-only calls are memoised within a turn.** An identical call returns the earlier result. A UI action does not clear the memo, because no tool writes data.
- **Descriptions for the model** say when to use the tool, not only what it does. They are the text given to the model, and eval results decide changes to them.

## Shared types

| Type | Shape | Notes |
| --- | --- | --- |
| `LatLng` | `{ "lat": number, "lng": number }` | WGS84 |
| `Area` | `{ "center": LatLng, "radius_m": integer }` or `{ "bbox": { "north", "south", "east", "west" } }` | `radius_m` 50–5000; a bbox at most 10 km per side |
| `TimeWindow` | `{ "from": time, "to": time }` | Either end may be omitted |
| `LayerId` | `"pedestrian"`, `"anomaly"`, `"disruption"`, `"event"`, `"news"`, `"planning"`, `"parking"`, or `"user:<source_id>"` | The point-feature layers of map contract v1. `parking` is the live bay sensor layer of UC-15, a v1 layer since 2026-10-15; it is in the code enum but not in the default search layers, so the model asks for it by name. `user:` layers come from UC-07 and are not in the code enum yet |
| `FeatureId` | string | A [map contract v1](../specs/002-map-data-presentation/contracts/map-api.md) MapItem `id`; the server resolves the current `versionId`. The example ids in this file are illustrative until F3 confirms them against the published views |
| `CompactFeature` | See below | What list results contain |
| `Source` | `{ "feature_id": FeatureId }` or `{ "url": string, "title"?: string }` | What a card item cites |

```json
{
  "id": "event:tm-G5v0Z9JkcKq",
  "layer": "event",
  "title": "Melbourne Symphony Orchestra: Mahler 5",
  "summary": "Hamer Hall, 7:30 pm. Tickets from $59.",
  "lat": -37.8211,
  "lng": 144.9683,
  "valid_from": "2026-10-10T19:30:00+11:00",
  "valid_to": "2026-10-10T21:30:00+11:00",
  "is_prediction": false,
  "source_url": "https://www.ticketmaster.com.au/event/...",
  "distance_m": 420
}
```

A `CompactFeature` shortens `summary` to 160 characters and uses the centroid for lines and polygons. `get_feature` returns the full record. A parking sensor's `summary` is its reading, for example "Vacant (live sensor, sensor reported 18:38); legal parking and time limits are not known" or "No data: the sensor is not reporting".

## Errors

A failed call returns an error object to the model instead of raising, so the model can correct itself. After two invalid calls in a row, the rest of the turn runs without tools ([agent-design.md](agent-design.md#precision)).

```json
{ "error": { "code": "invalid_arguments", "message": "radius_m must be at most 5000", "retryable": false, "details": {} } }
```

| Code | Meaning | What the model should do |
| --- | --- | --- |
| `invalid_arguments` | Schema or range violation | Fix the arguments |
| `not_found` | The id does not exist | Stop referring to it |
| `not_an_anomaly` | The feature is not an anomaly | Use `pedestrian_pattern` instead |
| `unverified_sources` | `show_card` items whose sources did not come from this turn | Drop those items or find sources for them |
| `route_not_found` | No route between the waypoints | Use fewer waypoints or another mode |
| `upstream_unavailable` | A data source or Google API failed; `retryable` is true | Answer with what it has and say what is missing |

## Data tools

### `search_features`

Status line: "Searching the map". Cost: one BigQuery query per selected layer family.

**Description for the model:** Find map features (events, transport disruptions, news, planning applications, pedestrian sensors, anomalies, live parking bay sensors) in an area, optionally filtered by layer, time window and keywords. Use it before recommending or describing anything on the map, and cite the ids it returns. For parking, pass layers ["parking"] with a small radius (about 300 m): each result is one on-street bay sensor that reads Vacant, Occupied or No data. A vacant reading does not mean parking there is legal or allowed now; say so, and do not state rules, limits or prices from it.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `area` | `Area` | Yes | |
| `layers` | `LayerId[]` | No | Defaults to the layers enabled in the request context, without `parking`; with nothing enabled, every layer except `parking`. A few hundred sensors sit near any central point and would crowd out every other result, so parking is searched only by name or when it is the only visible layer |
| `time` | `TimeWindow` | No | Keeps features valid at some point in the window |
| `query` | string | No | Keyword match on title and summary; at most 100 characters |
| `sort` | `"distance"` or `"time"` | No | Default `"distance"` from the area centre |
| `limit` | integer | No | 1–50, default 20 |

Returns `{ "total": 134, "truncated": true, "items": [CompactFeature, …] }`.

Implementation note: a bounding-box query over the published current or history views for the selected layers, with the box as query parameters, then radius, time and keyword filters in memory.

### `get_feature`

Status line: "Reading the details". Cost: one BigQuery query.

**Description for the model:** Get the full record of one map feature: an event's full description, a disruption's affected segments, a news item's full summary. Use it when a search result is not enough to answer.

| Argument | Type | Required |
| --- | --- | --- |
| `id` | `FeatureId` | Yes |

Returns the full map item (map contract v1 MapItem: id, version, layer, geometry, time, sources and kind-specific details). Geometry is simplified to at most 200 points. Errors: `not_found`. A feature that this turn has not searched for is resolved by one search over the request's viewport (the features a user can select are on screen), not by a lookup-by-id query; `get_anomaly`, `focus_map`, `highlight_features`, `draw_route` and `analyse_anomaly` resolve ids the same way.

### `heritage_lookup`

Status line: "Checking heritage records". Cost: Victorian Heritage Database API call; cached across users for 7 days by rounded point and radius.

**Description for the model:** Find heritage places and their history near a point, from the Victorian Heritage Database. Use it for history, architecture and "what's this building" questions, and cite the record URL.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `point` | `LatLng` | Yes | |
| `radius_m` | integer | No | 50–2000, default 300 |
| `limit` | integer | No | 1–20, default 10 |

```json
{
  "total": 12,
  "truncated": false,
  "items": [
    { "name": "Flinders Street Railway Station", "lat": -37.8183, "lng": 144.9671, "summary": "Built 1905–1910 …", "url": "https://vhd.heritagecouncil.vic.gov.au/places/..." }
  ]
}
```

Heritage records are not map items. Cards cite them by `url`.

### `get_anomaly`

Status line: "Reading the pedestrian anomaly". Cost: one BigQuery query over the published anomaly view (the detector's output, UC-04).

**Description for the model:** Get the numbers behind a pedestrian anomaly marker: the observed count, the usual count and the size of the difference. Use it when the user asks about a specific "?" marker. To explain the anomaly, prefer `analyse_anomaly`.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `feature_id` | `FeatureId` | Yes | A feature in the `anomaly` layer |

```json
{
  "feature_id": "anomaly:sensor-41-2026-10-10T18",
  "sensor": { "id": "41", "name": "Flinders La-Swanston St (West)", "lat": -37.8166, "lng": 144.9654 },
  "hour": "2026-10-10T18:00:00+11:00",
  "observed": 4210,
  "baseline": 1830,
  "change_pct": 130,
  "direction": "higher",
  "method": "same hour, past 7 days",
  "data_delay_min": 25
}
```

Errors: `not_found`, `not_an_anomaly`.

### `pedestrian_pattern`

Status line: "Checking how busy it usually is". Cost: one BigQuery query; cached for a day by sensor set, day of week and lookback.

**Description for the model:** How busy an area usually is by hour, from historical pedestrian counts. Use it for "what's this area like in the evening", "when is it quiet" and "is it crowded now" questions. It does not explain anomalies; use `analyse_anomaly` for that.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `area` | `Area` | Yes | Uses the pedestrian sensors inside it |
| `day_of_week` | `"mon"` … `"sun"` | No | Defaults to today |
| `hours` | integer[] | No | 0–23; defaults to all hours |
| `weeks` | integer | No | Lookback, 1–52, default 8 |

```json
{
  "sensors": [{ "id": "41", "name": "Flinders La-Swanston St (West)", "lat": -37.8166, "lng": 144.9654 }],
  "hourly": [{ "hour": 19, "typical": 1650, "p25": 1320, "p75": 1980 }],
  "today": [{ "hour": 18, "count": 4210 }],
  "busiest_hour": 17,
  "quietest_hour": 4,
  "data_delay_min": 25
}
```

With no sensors in the area it returns `"sensors": []` and a `message`, not an error.

### `nearby_context`

Status line: "Checking nearby news, events and disruptions". Cost: three BigQuery queries (news, events, disruptions), run in parallel.

**Description for the model:** What else is going on around a place: recent news, events and transport disruptions. Use it to explain crowds, or to check a plan against disruptions before recommending it.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `point` | `LatLng` | Yes | |
| `radius_m` | integer | No | 100–3000, default 1000 |
| `time` | `TimeWindow` | No | Defaults to the past 24 hours through the next 6 hours |

Returns `{ "totals": { "news": 4, "events": 9, "disruptions": 1 }, "news": [CompactFeature], "events": [CompactFeature], "disruptions": [CompactFeature] }`, at most 10 of each.

## Workflow tools

Workflow tools run a fixed procedure and send their card to the app themselves. The model gets back a short summary to use in follow-up turns.

### `area_brief`

Status lines: "Looking around this area", then the lines of the tools it runs. Cost: one generation plus Maps grounding; cached by geohash-6 cell and date.

**Description for the model:** Build the standard area card for a point: neighbourhood character, recommended places and upcoming activities. Use it when the user asks what an area is like or what is around them. It shows the card to the user, so do not repeat the card's content in text.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `point` | `LatLng` | Yes | |
| `radius_m` | integer | No | 200–1500, default 600 |

Returns `{ "card_id": "…", "summary": "…" }`; `card_id` is null, with no card, when nothing with a source was found. The summary is at most 500 characters and names the recommended places and activities with their ids. Sends a `card` event of type `area_brief`: the intro is the neighbourhood character, the items are places (no time) then activities (with a time), each citing a feature id or a URL from this turn. Implementation: parallel layer search and Search-grounded answer, one JSON-schema generation, then code drops every item whose numbered source reference was not fetched in this turn; cached by area cell, radius and date.

### `find_parking`

Status lines: "Looking for free parking", then the lines of the tools it runs. Cost: one or two parking map reads, plus one Search grounding call and one generation for the area's rules, both cached across users by question and date. The card itself is never cached: sensor readings change every 2 minutes.

**Description for the model:** Find free on-street parking near a destination. It searches the live bay sensors within a short walk (widening when few are free), turns the parking layer on, moves the map to the nearest vacant bay, highlights the other candidates, and shows the parking card with each bay's distance to the destination and the area's published fee, time limit and hours. Use it for any request to find or check parking. It shows the card itself: do not also call show_card, focus_map or search_grounding for the same request.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `destination` | `LatLng` | No | Defaults to the selected point, then the user location, then the viewport centre |
| `destination_name` | string | No | At most 80 characters, for example `"Melbourne Central"`; shown on the card and used in the rules search |

Procedure, in this order:

1. Start the area-rules lookup (Search grounding, then one generation that may only copy values the sources state and must cite one W reference; nothing stated means no rules).
2. Read the `parking` layer within 400 m of the destination; when fewer than 3 bays read vacant, read again within 800 m.
3. Rank the vacant bays by straight-line distance to the destination; a `late` reading counts as 150 m further. Keep the first 5.
4. Send `show_layers` (`parking`, `add`), then `focus_map` on the first bay at zoom 18 with its `feature_id`, then `highlight_features` with the 5 ids. The map moves before the rules lookup ends.
5. Send a `card` of type `list`: one item per bay with a `parking` object (see `CardItem` under `show_card`), plus, when the rules have a source, a last item "Parking rules in this area" citing that URL.

With no vacant bay it sends `show_layers` and `focus_map` on the destination at zoom 17, no card, and says so in the summary.

Returns `{ "card_id": "…", "focused_on": FeatureId, "bays": [{ "id", "distance_m", "reading" }], "area_rules": { "fee", "time_limit", "hours", "payment", "url" } | null, "note": "…" }`, or `{ "card_id": null, "summary": "…" }` when nothing reads vacant.

Rules it keeps (UC-15, do not change without the project owner):

- Fee, time limit, hours and payment are the **area's** published rules from one cited web page, with `policy_scope: "area"`, and the app always says the sign at the bay decides. They are never presented as the rule of one bay: no admitted crosswalk links a sensor to its bay's sign (`cloud/data/docs/source-policies/parking-join.md`). Without a source every field is null, `policy_scope` is `"unknown"`, and the card says to check the sign.
- The `parking` object is written only by this tool. `show_card` does not accept it, so the model cannot state a fee or a distance for a bay.
- Distances are straight lines from the sensor to the destination; walking minutes are that distance at 80 m a minute.

### `analyse_anomaly`

Status lines: "Analysing the pedestrian anomaly", then the lines of the tools it runs. Cost: one generation plus Search grounding; cached per anomaly for all users, because an anomaly does not change.

**Description for the model:** Explain a pedestrian anomaly: possible causes with a confidence level and sources, from nearby news, events and disruptions. Use it for "why is it so busy here" when there is an anomaly marker nearby. It shows the card to the user.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `feature_id` | `FeatureId` | Yes | A feature in the `anomaly` layer |

Returns `{ "card_id": "…", "summary": "…" }` with the causes and their confidence. Sends a `card` event of type `anomaly_analysis`: the intro is the headline, each item is one possible cause with `Confidence low|medium|high.` leading its summary and a source from this turn; with no cause the card says "No clear cause found" at low confidence and cites the anomaly itself. Errors: `not_found`, `not_an_anomaly`.

## Grounding tools

Grounding is the fallback, not a routine step: the agent calls these only when the data tools cannot answer the request or leave a gap the question needs filled ([agent-design.md](agent-design.md#tool-registry), Melens data first). Search grounding is preferred; Maps grounding is reserved for one specific place's details because it is far slower (48 to 110 s per call against 10 s, measured 2026-10-09). A call that exceeds `AGENT_GROUNDING_TIMEOUT_MS` (default 40 s) returns `upstream_unavailable`, so the model answers from the map data and says what is missing. If Gemini's built-in grounding cannot be combined with function tools in one agent, each of these is an `AgentTool` wrapping a one-shot Gemini call with that grounding enabled. Either way, the grounding metadata is returned to the loop so `show_card` can validate against it. Both are billed per call. The exact metadata fields follow the Gemini grounding response and are confirmed in F3.

### `maps_grounding`

Status line: "Checking Google Maps". Cache: per normalised question, geohash-6 cell and date.

**Description for the model:** Ask Google Maps for the details of one specific place: its opening hours, rating, what it is like, where exactly it is. Slow, often a minute: use it only when the user asks about a specific place our map layers do not carry (a café, a shop, a park), after search_features. Not for finding venues, events or things to do: the layers and search_grounding cover those. Ask in English.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `question` | string | Yes | English, at most 300 characters |
| `location` | `LatLng` | No | Defaults to the centre of the user's viewport |

```json
{
  "answer": "…",
  "places": [{ "title": "Hardware Société", "place_id": "ChIJ…", "maps_uri": "https://maps.google.com/?cid=…" }],
  "attribution": {}
}
```

`attribution` carries what Google's display rules require, such as the contextual widget token. `show_card` attaches it to any card that uses these places; the model never passes it along.

### `search_grounding`

Status line: "Searching the web". Cache: per normalised question and date.

**Description for the model:** Search the web for facts our data does not cover: opening details, parking rules, weather, what happened somewhere recently, background on an event, general questions about Melbourne. Use it only when no map tool can answer or their results leave a gap; try search_features or nearby_context first. Prefer it over maps_grounding for anything that is not one place's details. Cite the sources it returns.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `question` | string | Yes | English, at most 300 characters |

```json
{
  "answer": "…",
  "sources": [{ "title": "…", "url": "https://…" }],
  "search_entry_point": "<rendered Google Search suggestions>"
}
```

Google's terms for Search grounding require showing the search suggestions (`search_entry_point`) with grounded results; the app renders it with the card. Confirm the exact requirement in F3.

## UI action tools

UI action tools return to the model at once and send a `ui_action` event to the app without waiting for a reply ([agent-protocol.md](agent-protocol.md#rules)). They change only what the user sees, never data.

### `show_layers`

Status line: none (the map change is the feedback).

**Description for the model:** Change which layers are visible on the map, optionally filtered by category or time. Use it when the user asks to see or hide something, such as "only show live music tonight".

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `layers` | `LayerId[]` | Yes | At least one |
| `mode` | `"only"`, `"add"` or `"remove"` | No | Default `"add"`; `"only"` hides every other layer |
| `filter` | `{ "categories"?: string[], "time"?: TimeWindow }` | No | Categories come from the event source's classification; the list is fixed in F3 |

Returns `{ "ok": true, "visible_layers": [LayerId] }`.

### `focus_map`

Status line: none.

**Description for the model:** Move the map to a place, an area or a feature. Use it when the user asks to go somewhere or look at something, and before showing results that are off screen.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `target` | `{ "point": LatLng }`, `{ "bbox": … }` or `{ "feature_id": FeatureId }` | Yes | |
| `zoom` | integer | No | 10–20; the app picks one if omitted |

Returns `{ "ok": true }`.

### `draw_route`

Status line: "Working out the route". Cost: one Routes API call.

**Description for the model:** Compute a walking or public transport route through stops, and draw it on the map unless `draw` is false. Use `draw: false` to check a candidate route's duration before committing to a plan.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `waypoints` | (`LatLng` or `{ "feature_id": FeatureId }`)[] | Yes | 2–13, first is the start and last is the end; `transit` takes exactly 2 |
| `mode` | `"walk"` or `"transit"` | Yes | |
| `draw` | boolean | No | Default `true` |

Returns `{ "distance_m": 3400, "duration_min": 46, "legs": [{ "from": 0, "to": 1, "duration_min": 8 }] }`. When drawn, the `ui_action` carries the encoded polyline. Errors: `route_not_found`, `invalid_arguments`, `not_found` (a `feature_id` waypoint this turn did not return).

The route is computed by the Routes API on the server with the service identity's OAuth token, so the model never assembles geometry or sees the polyline. The drawn route's `ui_action` carries `{ polyline, mode, distance_m, duration_min, waypoints: [{ lat, lng, label? }] }`; with `draw: false` nothing is sent. The limit of 13 waypoints is our cap from the plan; the API allows more.

### `highlight_features`

Status line: none.

**Description for the model:** Highlight features on the map, such as the places you are talking about. Pass feature ids only; places from Google Maps appear as pins in their card instead.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `ids` | `FeatureId[]` | Yes | 1–30 |
| `clear_previous` | boolean | No | Default `true` |

Returns `{ "ok": true, "missing": [FeatureId] }`. `missing` lists ids the server could not find.

### `show_card`

Status line: none. Cost: none; validation runs on the server.

**Description for the model:** Show the user a result card. Every specific recommendation (a place, an event, a stop on a walk, a historical fact about a place) goes in a card, not in plain text. Each item must cite a feature id or a URL that a tool returned in this turn. Keep getting_there under 80 characters and give times as full ISO 8601 with an offset, or leave time out. A plan gives each stop its location and says how the user travels in travel_mode; with "drive" the card adds the live parking near each stop by itself.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | `"plan"`, `"history"` or `"list"` | Yes | `area_brief` and `anomaly_analysis` cards come only from their workflows |
| `title` | string | Yes | At most 80 characters |
| `intro` | string | No | At most 300 characters |
| `travel_mode` | `"walk"`, `"transit"`, `"drive"` or `"cycle"` | No | Plans only (ignored on other types); stored on the card. `drive` adds `stop_parking` to each located stop (below) |
| `items` | `CardItem[]` | Yes | 1–13; the order is the display order, which for a `plan` is the visiting order |

`CardItem`:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | Yes | At most 80 characters |
| `summary` | string | No | At most 240 characters |
| `source` | `Source` | Yes | Must come from a tool result in this turn |
| `time` | `TimeWindow` | No | For events and plan stops |
| `location` | `LatLng` | No | Shown as a pin |
| `place_id` | string | No | For a place from `maps_grounding`; triggers its attribution |
| `cost` | string | No | For example `"free"` or `"from $59"` |
| `getting_there` | string | No | For example `"8 min walk"` or `"tram 96"` |
| `parking` | `CardParking` | No | Only in cards from `find_parking`; `show_card` rejects it |
| `stop_parking` | `StopParking` | No | Only on the stops of a driven plan, written by the server; `show_card` rejects it |

`CardParking` (UC-15): `state` (`vacant`, `occupied`, `noData`), `recommended` (the bay the map moved to), `distance_m` (straight line to the destination), `walk_min`, `destination` (name or null), `reported_at` (when the sensor last reported, Melbourne time with offset, or null), `zone` (the zone number the sensor reports, or null), `fee`, `time_limit`, `hours`, `payment` (the area's rules, each nullable), `policy_scope` (`area` or `unknown`) and `policy_url` (the page the rules come from, or null). A `find_parking` item also fills `cost` and `getting_there`, so an app that ignores `parking` still shows the fee and the distance.

`StopParking` (UC-03 with UC-15): the live parking around one stop. `checked_at` (when the sensors were read, Melbourne time with offset), `radius_m` (400, or 800 when few bays read vacant), `vacant`, `occupied`, `no_data` (sensor counts in that radius), `bays` (at most three vacant bays, nearest first: `feature_id`, `location`, `distance_m` and `walk_min` to the stop, `reported_at`), and the area's rules exactly as in `CardParking` (`fee`, `time_limit`, `hours`, `payment`, `policy_scope`, `policy_url`).

Validation: the server checks every item's `source` against the feature ids and URLs that tools returned in this turn. If any item fails, the whole call is rejected with `unverified_sources` and the failing item indexes in `details.items`, so the model can drop or fix them and call again. On success it attaches the attribution that grounding requires, sends a `card` event and returns `{ "card_id": "…" }`.

**Driven plans.** For a `plan` with `travel_mode` `drive`, after validation and before the card is sent, the server reads the parking around each stop it can place (the item's `location`, else the centroid of the feature it cites; at most 6 stops) in a step of its own, `plan_parking` ("Checking parking at each stop"), which the model cannot call. Each stop reads the sensors as `find_parking` does (400 m, then 800 m) and gets the area's rules from the same cached lookup; stops in the same 0.01° cell share one lookup, because the rules are published per area and each lookup is a billed web search. A stop placed from its feature keeps that point as its `location`. The result adds `parking` (each stop's title, vacant count and nearest vacant distance) and a note to mention parking in one sentence at most. A saved plan reads one stop's parking again on request ([agent-protocol.md](agent-protocol.md#saved-plans)), without a model call.

## Conversation tools

### `ask_user`

Status line: none; the question itself is the event.

**Description for the model:** Ask the user one question, only when the request is ambiguous in a way the request context cannot resolve (for example, which of several gardens or anomaly markers they mean), or when a required input has no sensible default. Do not ask about preferences you can assume, and do not ask for confirmation: act, state your assumption, and let the user adjust. After you showed a plan card in this turn you may ask up to three questions about it (when they leave, how long they have, how they travel), all in the same response. Calling this ends your turn.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `question` | string | Yes | At most 200 characters |
| `options` | string[] | Yes | 2–4 options, each at most 40 characters |
| `allow_free_text` | boolean | No | Default `true`; the user may type an answer instead |

Sends a `question` event; the server then ends the turn with `done` and stop `asked` ([agent-protocol.md](agent-protocol.md#rules)). Other tool calls in the same step run first, in order, so a model response may show a plan and then ask about it. A turn asks one question; a turn that showed a `plan` card may ask up to three, each carrying `planCardId` (that card), and a call over the limit returns `invalid_arguments`. The server keeps the pending question in the session and puts it in the next turn's prompt, so the model can tell an answer from a change of topic. Returns `{ "question_id": "…" }` for the trace.

## Open questions

- Confirming that MapItem ids from the published views work as `FeatureId` everywhere, and the event category list (F3).
- The exact Maps and Search grounding metadata fields and display requirements (F3).
- Whether `map_agent` should also get a `geocode(text)` tool for places the user names that are not on the map, or rely on `maps_grounding`.
