# Agent protocol

**Status:** Draft. Revised 2026-10-09 for the agent service runtime (own Cloud Run service, TypeScript, map contract ids, sessions persisted per user), for streamed token usage, and for interrupting a running turn and attaching photos. Plan task F3 (agent framework contract and result card format) finalises it.

How the Flutter app talks to the agent service on Cloud Run. The app is an agent client: it sends context, renders streamed events, applies UI actions and renders cards. It never calls a language model itself; all reasoning, tools, keys and source checks stay on the server.

## Endpoints

All routes are called on the agent service's Cloud Run URL directly (or a custom domain mapped to Cloud Run), never through Firebase Hosting, which times out after 60 seconds. Every route requires the Firebase ID token and acts only on the caller's own sessions.

| Method and path | Purpose |
| --- | --- |
| `POST /v1/sessions` | Create a session for the caller; returns `sessionId` |
| `GET /v1/sessions` | List the caller's sessions, newest first: `id`, `title`, `createdAt`, `updatedAt`, `turnCount` |
| `GET /v1/sessions/{sessionId}` | The session's stored turns, for redrawing the chat panel |
| `DELETE /v1/sessions/{sessionId}` | Delete the session and its turns |
| `POST /v1/sessions/{sessionId}/turns` | Run one turn; the response is a stream of server-sent events. A turn still running in the session is interrupted ([Rules](#rules), 4) |
| `POST /v1/sessions/{sessionId}/cancel` | Stop the session's running turn, wherever it runs; `204` also when none runs |
| `GET /v1/sessions/{sessionId}/attachments/{attachmentId}` | A stored photo's bytes, with its image type, for redrawing a restored turn |

The app has two base URLs: `MAP_BASE_URL` for the map query service and `AGENT_BASE_URL` for this service; they are different Cloud Run services ([architecture.md](architecture.md#key-decisions)). The Cloud Run request timeout is 300 seconds, enough for a turn of 16 model calls.

```
Flutter                                  Cloud Run: agent service (ADK, TypeScript)
  │ POST /turns {input, context}  ─────────▶│ verify Firebase ID token, rate limit by uid
  │                                         │ route by input.kind: workflow or map_agent
  │◀── status    {state: "running", …}       │ a tool call starts: its status line and arguments
  │◀── text      streamed text               │
  │◀── ui_action focus_map / draw_route      │ when the agent calls a UI action tool
  │◀── card      {type: "plan", …}           │ only after source validation
  │◀── status    {state: "done", rows, …}    │ the call ends: rows, duration, or the error
  │◀── usage     {call, turn}                │ after every model call
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
| `answer` | The user taps an option under a question | `questionId`, `value` |

A `text` input may carry photos the user attached, in `attachments` next to `input`; its `text` may then be empty. Each is `{ "kind": "image", "mimeType": "image/jpeg", "data": "<standard base64>" }`: at most 4 per turn, each at most 1,000,000 bytes, of type `image/jpeg`, `image/png`, `image/webp`, `image/heic` or `image/heif`. The server checks that the bytes start like the declared type and answers `400` otherwise. The app downsizes photos before sending (long edge 1,600 px, JPEG quality 80 where the platform re-encodes) and re-encodes anything still too large, or of another type, as a smaller PNG. Gemini reads the photos with the message; a photo Gemini cannot decode ends the turn with an `error` that says so and is not `retryable`.

`context` is sent on every turn. The app is the source of truth for what is on screen; the server does not guess. `userLocation` is present only when the user granted location access.

## Events

Every event carries `turnId` and an increasing `seq`, so the app can de-duplicate and order them.

| Event | Payload | App behaviour |
| --- | --- | --- |
| `status` | `stepId`, `state` (`running`, `done`, `failed`), `tool`, `text` (the tool's status line), `detail` (a short summary of the arguments); when finished also `rows`, `durationMs`, `error` (a tool error code) and `memo` (answered from an identical earlier call) | Shows the step in the turn's trace: a spinner while it runs, then its row count, duration or error. Every tool call sends one `running` and one finished event with the same `stepId`; an instant call (memoised or invalid) sends only the finished one. This is the visible reasoning trace in the demo |
| `text` | `delta` | Appends to the current answer |
| `ui_action` | `stepId`, `action` (`show_layers`, `focus_map`, `draw_route`, `highlight_features`) and its arguments | The map controller applies it; the chat shows the outcome on the step with that `stepId` |
| `card` | `stepId`, `id`, `type` (`area_brief`, `anomaly_analysis`, `plan`, `history`, `list`), items with sources, attribution | Renders the card widget for that type, with sources and Google Maps attribution |
| `question` | `stepId`, `id`, `text`, `options`, `allowFreeText` | Shows the question with one button per option; a tap sends an `answer` input |
| `usage` | `call` (one model call: `index`, `agent`, `model`, token counts, `durationMs`) and `turn` (running totals) | Updates the token counter of the turn in progress; see [Token usage](#token-usage) |
| `done` | `stop` (`end`, `asked`, `budget`, `cancelled`), `usage` (the final `turn` totals plus `complete`) | Ends the turn |
| `error` | `message`, `retryable`, `usage` (totals so far, `complete: false` when a model call was cut off) | Shows the error; the user may retry if `retryable` |

## Rules

1. **Recommendations only in cards.** Streamed text carries explanations and transitions. Places, events and routes appear in `card` events, which are sent only after source validation (see [agent-design.md](agent-design.md#source-rules)).
2. **UI actions are one-way.** The server does not wait for the app to confirm an action. If an action fails in the app, the next request's `context` shows the real state.
3. **Features by id.** Cards and UI actions reference `featureId`s, which are [map contract v1](../specs/002-map-data-presentation/contracts/map-api.md) MapItem ids. The app resolves them against the items it has loaded from the map query service, which keeps events small and consistent with the map. Card items also carry a `location`, so an item the app has not loaded still shows a pin; `highlight_features` reports ids the server could not find as `missing`.
4. **Server-side sessions, per user.** Conversation history is stored in Firestore under the caller's uid and survives restarts and new revisions. The app keeps the current `sessionId` locally and can list and reopen earlier sessions. A session belongs to one uid; another user's session id returns `not_found`, never `forbidden`. One turn runs at a time per session, and a new turn interrupts the running one, so the user can redirect the agent at any moment: the server asks the running turn to stop, waits up to 5 seconds for it to store what it has (so the new turn's history includes it, marked as stopped), then runs the new turn. A turn that does not stop in time loses its lease; it is stored when it ends, without touching the newer turn's lease or pending question. The store numbers turns in the order they finish.
5. **Cancellation reaches the server.** When the user taps stop, the app aborts the request and calls `POST /v1/sessions/{sessionId}/cancel`; leaving the screen or the session aborts the request too. The server cancels the run on the disconnect, on the cancel route, on a newer turn and at the turn deadline, so it stops spending tokens and grounding calls: model calls, BigQuery queries and grounding calls in flight are aborted. The stop request travels through the session's lease (`activeTurn.cancelRequested`), which the running turn watches, so it works whichever Cloud Run instance runs the turn. A stopped turn ends with `done` stop `cancelled` and is stored with what it produced so far.
6. **Questions end the turn.** A turn that asks the user sends `question`, then `done` with stop `asked`. Tapping an option sends an `answer` input. Typing something else sends `text` as usual, and the agent decides whether it answers the question or changes the topic.

## Token usage

The app sees what a turn costs while it runs, not only at the end. The service sends one `usage` event per model call, as soon as that call's final response has arrived and before the tool calls it requested run, and repeats the final totals in `done`.

```json
{
  "event": "usage", "turnId": "t_8f3c", "seq": 9,
  "call": { "index": 3, "agent": "map_agent", "model": "gemini-3.8-flash",
            "input": 6210, "cachedInput": 4096, "output": 182, "thoughts": 540,
            "toolUseInput": 0, "total": 6932, "durationMs": 1870 },
  "turn": { "calls": 3, "input": 15930, "cachedInput": 8192, "output": 410,
            "thoughts": 1300, "toolUseInput": 0, "total": 17640 }
}
```

| Field | Gemini `usageMetadata` field | Meaning |
| --- | --- | --- |
| `input` | `promptTokenCount` | The whole prompt of that call, cached part included |
| `cachedInput` | `cachedContentTokenCount` | The part of `input` served from Gemini's cache, billed at the cache rate |
| `output` | `candidatesTokenCount` | Answer text and function calls |
| `thoughts` | `thoughtsTokenCount` | Thinking tokens, billed at the output rate |
| `toolUseInput` | `toolUsePromptTokenCount` | Prompt tokens added by Gemini's built-in grounding tools |
| `total` | `totalTokenCount` | Gemini's own total (documented as prompt, thoughts and candidates), copied, never recomputed |

`call.index` counts the model calls of the turn from 1. `call.agent` names the caller: `map_agent`, a workflow (`workflow:area_brief`, `workflow:analyse_anomaly`) or a grounding sub-agent (`grounding:maps`, `grounding:search`). `turn` holds the running sums over every call so far, whoever made it. `done.usage` is the last `turn` object plus `complete`: `true` when every model call of the turn finished and reported usage, `false` when the turn was cancelled or failed while a model call was in flight, so that call's tokens are missing from the totals although Gemini may still bill them. `error` carries the same object.

Rules that keep the numbers accurate:

1. **Copied from Gemini, never estimated.** Every count is the `usageMetadata` Vertex AI returned for that call. The service never runs `countTokens`, a tokenizer or a character heuristic, and never fills a gap with a guess. A field Gemini did not return is `0`.
2. **One reading per call, from the final response.** Streamed chunks may carry provisional counts; only the final, non-partial response of a call is authoritative. The service reads usage once from that response (`LlmResponse.usageMetadata` in `@google/adk`) and never adds chunk values together. A generation Gemini pauses and ADK resumes is one call, with the usage ADK sums across the resumed requests.
3. **Every call counts, in full.** Loop calls, workflow generations and grounding sub-agent calls all report. Each call's prompt is counted whole, so `turn.input` grows with every call; that is the billed figure, not the size of the conversation.
4. **Stream and store agree.** The `turn` object of the last `usage` event, `done.usage` and the `usage` stored in the turn document hold the same numbers; the eval compares them.

## Sessions

Sessions are stored in Firestore in the project's agent database. Only the agent service reads or writes them, through the Admin SDK; client security rules deny all access, and the app never holds Firestore credentials.

| Document | Fields |
| --- | --- |
| `users/{uid}/sessions/{sessionId}` | `createdAt`, `updatedAt`, `title` (the first user message, trimmed), `turnCount`, `pendingQuestion` (`id`, `text`, `options`) or null, `activeTurn` lease (`turnId`, `expiresAt`, `cancelRequested` once a stop is asked) or null, `expiresAt` for the TTL policy |
| `users/{uid}/sessions/{sessionId}/turns/{turnId}` | `seq`, `input` (`kind` and `text`, `featureId` or `questionId`/`value`), `attachments` (`id`, `kind`, `mimeType`, `bytes` of each photo), the events the turn produced (`text` joined into one string, `card`, `ui_action`, `question`, `done`), a compact tool trace (tool, arguments, status line, argument summary, row count, error, duration, memo flag) and `usage` (the final `turn` totals plus the per-call list, exactly as streamed) |

| `users/{uid}/sessions/{sessionId}/attachments/{attachmentId}` | One photo: `turnId`, `mimeType`, `data` (the bytes), `createdAt`, `expiresAtTs`. Written with its turn, deleted with it |

Stored is what the app needs to redraw the conversation and what the model needs for the next turn: user input and photos, answer text, cards, questions and answers, and the compact trace. The request `context` is not stored, and `userLocation` never is. Full tool results and grounding payloads are not stored with the session; grounding has its own cache.

The prompt for a turn carries the last 20 turns; older turns remain available to the app through `GET /v1/sessions/{sessionId}`. The photos of the last 3 turns go back to the model with them; older photos are only named, so a follow-up about a recent photo still sees it. Limits: 50 sessions per uid, deleting the oldest when a new one is created; 200 turns per session; a 30-day TTL from `updatedAt`. An anonymous uid is lost when the browser clears site data, and its sessions expire with the TTL.

The chat panel shows the user's session list. The user can switch to an earlier session, start a new one and delete one; switching restores that conversation from `GET /v1/sessions/{sessionId}`.

## Authentication

Firebase Anonymous Auth gives every user, judges included, a uid without a sign-in screen. Requests carry the Firebase ID token in the `Authorization` header. The Cloud Run service allows unauthenticated invocation at the platform level, because a browser cannot obtain an IAM token; the service itself verifies the Firebase ID token on every request and rejects a missing or invalid token before any model or tool call. This ties sessions to users and allows per-uid rate limiting, with counters in Firestore, which protects the per-call grounding budget. Adding data sources (UC-07) and publishing events (UC-09) may need a full account; see the open questions in those use cases.

Anonymous sign-in is the project's only provider, and Firestore's client rules deny every read and write (`cloud/agent/infra/firebase.sh`). The app waits for the Firebase SDK to restore its persisted user before it signs in, and signs in only when there is none, so a reload or restart keeps the uid and the user's sessions. A new browser or device, or cleared site data, is a new user. A development build may send the fixed development token instead, for an agent service running locally in development mode.

## Flutter implementation

| Part | Responsibility |
| --- | --- |
| `AgentClient` | Transport, SSE parsing, cancellation (abort and the cancel route), stored photos |
| `ChatController` | Conversation state, the turn in progress, any pending question and the turn's running token counter from `usage` events; a message sent while a turn runs interrupts it; restores a session from `GET /v1/sessions/{sessionId}` |
| `SessionList` | Lists, switches, creates and deletes the user's sessions |
| `MapActions` | Applies `ui_action` events to the map |
| Card registry | One widget per card `type`, which maps to a use case |

**Flutter Web streaming:** `package:http`'s `BrowserClient` has used the Fetch API since http 1.3, so it streams response bodies, and http 1.5 added `AbortableRequest` for cancellation. The browser's `EventSource` supports only GET and cannot send the auth header, so the app parses the stream itself (`SseDecoder` in `app/lib/core/network/sse.dart`). Checked on 2026-09-28 in Chrome with http 1.6.0: events arrived as the server sent them, an aborted request closed the connection on the server, and the `Authorization` header passed the CORS preflight. The agent service must allow CORS from the Web origin, including that header.

## Open questions

- Where the JSON Schema for requests, events and cards lives, so Dart and backend models are generated from one source. With the service in TypeScript, the Zod schemas in `cloud/agent` are the natural source.
