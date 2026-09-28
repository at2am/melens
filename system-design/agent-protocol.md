# Agent protocol

**Status:** Draft. Plan task F3 (agent framework contract and result card format) finalises it.

How the Flutter app talks to the agent service on Cloud Run. The app is an agent client: it sends context, renders streamed events, applies UI actions and renders cards. It never calls a language model itself; all reasoning, tools, keys and source checks stay on the server.

## Endpoint

`POST /v1/sessions/{sessionId}/turns`, called on the Cloud Run URL directly (or a custom domain mapped to Cloud Run), never through Firebase Hosting, which times out after 60 seconds. The response is a stream of server-sent events.

```
Flutter                                  Cloud Run (ADK)
  │ POST /turns {input, context}  ─────────▶│ route by input.kind: workflow or map_agent
  │◀── status    "Checking nearby news…"     │ one per tool call
  │◀── text      streamed text               │
  │◀── ui_action focus_map / draw_route      │ when the agent calls a UI action tool
  │◀── card      {type: "plan", …}           │ only after source validation
  │◀── done      {stop, usage}               │
```

## Request

```json
{
  "input": { "kind": "text", "text": "Plan a free 45-minute walk near me" },
  "context": {
    "viewport": { "north": -37.80, "south": -37.82, "east": 144.98, "west": 144.95 },
    "zoom": 15,
    "userLocation": { "lat": -37.8136, "lng": 144.9631 },
    "selected": { "featureId": null, "point": null },
    "layers": ["pedestrian", "events"],
    "openCardId": null,
    "localTime": "2026-10-10T18:40:00+11:00"
  }
}
```

| `input.kind` | Sent when | Other fields |
| --- | --- | --- |
| `text` | The user types in the chat box | `text` |
| `area` | The user selects a point on the map | `lat`, `lng` |
| `analyse` | The user taps Analyse on a "?" marker | `featureId` |

`context` is sent on every turn. The app is the source of truth for what is on screen; the server does not guess. `userLocation` is present only when the user granted location access.

## Events

Every event carries `turnId` and an increasing `seq`, so the app can de-duplicate and order them.

| Event | Payload | App behaviour |
| --- | --- | --- |
| `status` | `text` | Shows a progress line. This is the visible reasoning trace in the demo |
| `text` | `delta` | Appends to the current answer |
| `ui_action` | `action` (`show_layers`, `focus_map`, `draw_route`, `highlight_features`) and its arguments | The map controller applies it |
| `card` | `id`, `type` (`area_brief`, `anomaly_analysis`, `plan`, `history`, `list`), items with sources, attribution | Renders the card widget for that type, with sources and Google Maps attribution |
| `done` | `stop` (`end`, `budget`, `cancelled`), `usage` | Ends the turn |
| `error` | `message`, `retryable` | Shows the error; the user may retry if `retryable` |

## Rules

1. **Recommendations only in cards.** Streamed text carries explanations and transitions. Places, events and routes appear in `card` events, which are sent only after source validation (see [agent-design.md](agent-design.md#source-rules)).
2. **UI actions are one-way.** The server does not wait for the app to confirm an action. If an action fails in the app, the next request's `context` shows the real state.
3. **Features by id.** Cards and UI actions reference `featureId`s. The app resolves them from the Firestore features it already listens to, which keeps events small and consistent with the map.
4. **Server-side sessions.** Conversation history lives in the server session. The app keeps only `sessionId`.
5. **Cancellation reaches the server.** When the user taps stop or leaves the screen, the app aborts the request. The server detects the disconnect and cancels the run, so it stops spending tokens and grounding calls.

## Authentication

Firebase Anonymous Auth gives every user, judges included, a uid without a sign-in screen. Requests carry the Firebase ID token in the `Authorization` header and Cloud Run verifies it. This ties sessions to users and allows rate limiting, which protects the per-call grounding budget. Adding data sources (UC-07) and publishing events (UC-09) may need a full account; see the open questions in those use cases.

## Flutter implementation

| Part | Responsibility |
| --- | --- |
| `AgentClient` | Transport, SSE parsing, cancellation |
| `ChatController` | Conversation state and the turn in progress |
| `MapActions` | Applies `ui_action` events to the map |
| Card registry | One widget per card `type`, which maps to a use case |

**Flutter Web streaming:** `package:http`'s `BrowserClient` buffers the whole response, so SSE does not stream. Use a Fetch-based client such as `package:fetch_client`. The browser's `EventSource` supports only GET and cannot send the auth header, so it does not fit. Verify streaming on the Web build during the skeleton phase.

## Open questions

- Where the JSON Schema for requests, events and cards lives, so Dart and backend models are generated from one source.
