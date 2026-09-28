# Tools

**Status:** Draft, 2026-09-28. This is the contract for plan task F3 until the tools exist in code. After that the code schemas (Pydantic or Zod, exported as JSON Schema) are the source of truth, and this file keeps the model-facing descriptions and the reasons behind them. Until then, any change to a tool's name, arguments, returns or description updates this file in the same commit.

These are the tools of the chat agent `map_agent`. The two workflow tools run the same code as the app's map-tap and Analyse entry points. How the loop uses the tools is in [agent-design.md](agent-design.md); the events they send to the app are in [agent-protocol.md](agent-protocol.md).

**Owners** are proposed from the plan's split and confirmed in F3: platform, framework, grounding and UI tools go to Haoyuan; data and anomaly tools to Alex (plan task A5 names `get_anomaly` and `nearby_context`); discovery workflows and card content to Wasabii.

| Tool | Group | Owner | Used by |
| --- | --- | --- | --- |
| [`search_features`](#search_features) | Data | Haoyuan | UC-02, UC-03, UC-13 |
| [`get_feature`](#get_feature) | Data | Haoyuan | UC-13 |
| [`heritage_lookup`](#heritage_lookup) | Data | Wasabii | UC-02, UC-08, UC-13 |
| [`get_anomaly`](#get_anomaly) | Data | Alex | UC-04, UC-13 |
| [`pedestrian_pattern`](#pedestrian_pattern) | Data | Alex | UC-13 |
| [`nearby_context`](#nearby_context) | Data | Alex | UC-04, UC-13 |
| [`area_brief`](#area_brief) | Workflow | Wasabii | UC-02, UC-13 |
| [`analyse_anomaly`](#analyse_anomaly) | Workflow | Alex | UC-04, UC-13 |
| [`maps_grounding`](#maps_grounding) | Grounding | Haoyuan | UC-02, UC-03, UC-13 |
| [`search_grounding`](#search_grounding) | Grounding | Haoyuan | UC-02, UC-03, UC-04, UC-08, UC-13 |
| [`show_layers`](#show_layers) | UI action | Haoyuan | UC-01, UC-13 |
| [`focus_map`](#focus_map) | UI action | Haoyuan | UC-02, UC-13 |
| [`draw_route`](#draw_route) | UI action | Haoyuan | UC-03, UC-13 |
| [`highlight_features`](#highlight_features) | UI action | Haoyuan | UC-02, UC-03, UC-08, UC-13 |
| [`show_card`](#show_card) | UI action | Haoyuan (validation), Wasabii (card content) | UC-02, UC-03, UC-08, UC-13 |
| [`ask_user`](#ask_user) | Conversation | Haoyuan | UC-13 |

## Conventions

- **Names** are snake_case, for tools and arguments alike.
- **Schemas are strict.** Enums are enums, required fields are required, and no extra fields are accepted. The server validates every call as well as the model provider.
- **Times** are ISO 8601 with an offset, in Melbourne local time, for example `2026-10-10T19:00:00+11:00`.
- **Lists** return at most 50 rows in compact form. The total always comes first, with `truncated: true` when rows were cut.
- **Data, workflow and grounding calls send a `status` event** to the app with the tool's status line. This is the reasoning trace users and judges see. UI action and conversation tools send their own event instead.
- **Read-only calls are memoised within a turn.** An identical call returns the earlier result. A UI action does not clear the memo, because no tool writes data.
- **Descriptions for the model** say when to use the tool, not only what it does. They are the text given to the model, and eval results decide changes to them.

## Shared types

| Type | Shape | Notes |
| --- | --- | --- |
| `LatLng` | `{ "lat": number, "lng": number }` | WGS84 |
| `Area` | `{ "center": LatLng, "radius_m": integer }` or `{ "bbox": { "north", "south", "east", "west" } }` | `radius_m` 50–5000; a bbox at most 10 km per side |
| `TimeWindow` | `{ "from": time, "to": time }` | Either end may be omitted |
| `LayerId` | `"pedestrian"`, `"anomaly"`, `"disruption"`, `"event"`, `"news"`, `"parking"`, or `"user:<source_id>"` | `parking` is P2; `user:` layers come from UC-07 |
| `FeatureId` | string | Stable MapFeature id; format fixed in F3 |
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

A `CompactFeature` shortens `summary` to 160 characters and uses the centroid for lines and polygons. `get_feature` returns the full record.

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

Status line: "Searching the map". Cost: Firestore reads.

**Description for the model:** Find map features (events, transport disruptions, news, pedestrian sensors, anomalies, user layers) in an area, optionally filtered by layer, time window and keywords. Use it before recommending or describing anything on the map, and cite the ids it returns.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `area` | `Area` | Yes | |
| `layers` | `LayerId[]` | No | Defaults to the layers enabled in the request context |
| `time` | `TimeWindow` | No | Keeps features valid at some point in the window |
| `query` | string | No | Keyword match on title and summary; at most 100 characters |
| `sort` | `"distance"` or `"time"` | No | Default `"distance"` from the area centre |
| `limit` | integer | No | 1–50, default 20 |

Returns `{ "total": 134, "truncated": true, "items": [CompactFeature, …] }`.

Implementation note: geohash range queries in Firestore, then time and keyword filters in memory.

### `get_feature`

Status line: "Reading the details". Cost: one Firestore read.

**Description for the model:** Get the full record of one map feature: an event's full description, a disruption's affected segments, a news item's full summary. Use it when a search result is not enough to answer.

| Argument | Type | Required |
| --- | --- | --- |
| `id` | `FeatureId` | Yes |

Returns the full MapFeature ([architecture.md](architecture.md#data-model-mapfeature-draft)) plus the layer's own `properties`. Geometry is simplified to at most 200 points. Errors: `not_found`.

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

Heritage records are not MapFeatures. Cards cite them by `url`.

### `get_anomaly`

Status line: "Reading the pedestrian anomaly". Cost: one Firestore read.

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

Status line: "Checking nearby news, events and disruptions". Cost: Firestore reads.

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

Returns `{ "card_id": "…", "summary": "…" }`. The summary is at most 500 characters and names the recommended places and activities with their ids. Sends a `card` event of type `area_brief`.

### `analyse_anomaly`

Status lines: "Analysing the pedestrian anomaly", then the lines of the tools it runs. Cost: one generation plus Search grounding; cached per anomaly for all users, because an anomaly does not change.

**Description for the model:** Explain a pedestrian anomaly: possible causes with a confidence level and sources, from nearby news, events and disruptions. Use it for "why is it so busy here" when there is an anomaly marker nearby. It shows the card to the user.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `feature_id` | `FeatureId` | Yes | A feature in the `anomaly` layer |

Returns `{ "card_id": "…", "summary": "…" }` with the causes and their confidence. Sends a `card` event of type `anomaly_analysis`. Errors: `not_found`, `not_an_anomaly`.

## Grounding tools

If Gemini's built-in grounding cannot be combined with function tools in one agent, each of these is an `AgentTool` wrapping a one-shot Gemini call with that grounding enabled. Either way, the grounding metadata is returned to the loop so `show_card` can validate against it. Both are billed per call. The exact metadata fields follow the Gemini grounding response and are confirmed in F3.

### `maps_grounding`

Status line: "Checking Google Maps". Cache: per normalised question, geohash-6 cell and date.

**Description for the model:** Ask Google Maps about places near a location: what is there, opening hours, ratings, what a place is like. Use it for places that are not on our map layers, such as cafés, bookstores and parks. Ask in English.

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

**Description for the model:** Search the web for facts our data does not cover: opening details, what happened somewhere recently, background on an event, general questions about Melbourne. Cite the sources it returns.

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

Returns `{ "distance_m": 3400, "duration_min": 46, "legs": [{ "from": 0, "to": 1, "duration_min": 8 }] }`. When drawn, the `ui_action` carries the encoded polyline. Errors: `route_not_found`, `invalid_arguments`.

The route is computed by the Routes API on the server, so the model never assembles geometry. The limit of 13 waypoints is our cap from the plan; the API allows more.

### `highlight_features`

Status line: none.

**Description for the model:** Highlight features on the map, such as the places you are talking about. Pass MapFeature ids only; places from Google Maps appear as pins in their card instead.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `ids` | `FeatureId[]` | Yes | 1–30 |
| `clear_previous` | boolean | No | Default `true` |

Returns `{ "ok": true, "missing": [FeatureId] }`. `missing` lists ids the server could not find.

### `show_card`

Status line: none. Cost: none; validation runs on the server.

**Description for the model:** Show the user a result card. Every specific recommendation (a place, an event, a stop on a walk, a historical fact about a place) goes in a card, not in plain text. Each item must cite a feature id or a URL that a tool returned in this turn.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | `"plan"`, `"history"` or `"list"` | Yes | `area_brief` and `anomaly_analysis` cards come only from their workflows |
| `title` | string | Yes | At most 80 characters |
| `intro` | string | No | At most 300 characters |
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

Validation: the server checks every item's `source` against the feature ids and URLs that tools returned in this turn. If any item fails, the whole call is rejected with `unverified_sources` and the failing item indexes in `details.items`, so the model can drop or fix them and call again. On success it attaches the attribution that grounding requires, sends a `card` event and returns `{ "card_id": "…" }`.

## Conversation tools

### `ask_user`

Status line: none; the question itself is the event.

**Description for the model:** Ask the user one question, only when the request is ambiguous in a way the request context cannot resolve (for example, which of several gardens or anomaly markers they mean), or when a required input has no sensible default. Do not ask about preferences you can assume, and do not ask for confirmation: act, state your assumption, and let the user adjust. Calling this ends your turn.

| Argument | Type | Required | Notes |
| --- | --- | --- | --- |
| `question` | string | Yes | At most 200 characters |
| `options` | string[] | Yes | 2–4 options, each at most 40 characters |
| `allow_free_text` | boolean | No | Default `true`; the user may type an answer instead |

Sends a `question` event; the server then ends the turn with `done` and stop `asked` ([agent-protocol.md](agent-protocol.md#rules)). Other tool calls in the same step run first. The server keeps the pending question in the session and puts it in the next turn's prompt, so the model can tell an answer from a change of topic. Returns `{ "question_id": "…" }` for the trace.

## Open questions

- The `FeatureId` format and the event category list (F3).
- The exact Maps and Search grounding metadata fields and display requirements (F3).
- Whether `map_agent` should also get a `geocode(text)` tool for places the user names that are not on the map, or rely on `maps_grounding`.
