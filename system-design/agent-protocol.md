# Agent protocol

**Status:** Draft. Revised 2026-10-09 for the agent service runtime (own Cloud Run service, TypeScript, map contract ids, sessions persisted per user), for streamed token usage, and for interrupting a running turn and attaching photos. Plan task F3 (agent framework contract and result card format) finalises it.

How the Flutter app talks to the agent service on Cloud Run. The app is an agent client: it sends context, renders streamed events, applies UI actions and renders cards. It never calls a language model itself; all reasoning, tools, keys and source checks stay on the server.

## Endpoints

All routes are called on the agent service's Cloud Run URL directly (or a custom domain mapped to Cloud Run), never through Firebase Hosting, which times out after 60 seconds. Every route requires the Firebase ID token and acts only on the caller's own sessions.

| Method and path | Purpose |
| --- | --- |
| `POST /v1/sessions` | Create a session for the caller; returns `sessionId` |
| `GET /v1/sessions` | List the caller's sessions, newest first: `id`, `title`, `createdAt`, `updatedAt`, `turnCount` |
| `GET /v1/sessions/{sessionId}` | The session's stored turns, for redrawing the chat panel, its pending question and `runningTurnId` (the turn still running, or null) |
| `DELETE /v1/sessions/{sessionId}` | Delete the session and its turns |
| `POST /v1/sessions/{sessionId}/turns` | Run one turn; the response is a stream of server-sent events. A turn still running in the session is interrupted ([Rules](#rules), 4) |
| `GET /v1/sessions/{sessionId}/turns/{turnId}/events?after={seq}` | Follow a running or just-finished turn again from the event after `seq`, as server-sent events ([Resuming a turn](#resuming-a-turn)) |
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
    "localTime": "2026-10-10T18:40:00+11:00",
    "actionReports": [{ "action": "highlight_features", "outcome": "partial", "skipped": ["event:9"] }]
  }
}
```

| `input.kind` | Sent when | Other fields |
| --- | --- | --- |
| `text` | The user types in the chat box | `text` |
| `area` | The user selects a point on the map | `lat`, `lng` |
| `analyse` | The user taps Analyse on a "?" marker | `featureId` |
| `answer` | The user taps an option under a question | `questionId`, `value` |
| `refine` | The user tapped Change plan under a plan card, or Change with Melens on a saved plan, and sends what to change | `cardId` (a `plan` card of this session, or the card of the saved plan `planId`), `text` (1 to 2,000 characters), `planId` (optional: the saved plan) |
| `answers` | The user picked answers under several questions of the last turn and sent them together | `answers`: 1 to 3 of `{ questionId, value }`, one per question |

A `refine` turn is the UC-03 plan refinement. The service reads the card from the session's stored turn, or with `planId` from the caller's saved plan (whose card must be `cardId`, from any session), never from the request: an unknown card answers `404 notFound` and a card that is not a plan `400 invalidRequest` (`messageKey` `agent.error.invalidRequest.not_a_plan`), both before the turn starts. The model gets the whole card, not only the item titles the history carries, and the card's sources count as returned in this turn, so the revised `plan` card may cite the kept stops without searching again. The app sends the card's id as `context.openCardId` too.

**Questions for a plan.** Before it makes or changes a plan the agent may ask up to three questions together (when the user leaves, how long they have, how they travel, what they enjoy); each `question` carries `forPlan: true`, and `planCardId` when it is about an existing plan (the plan a `refine` turn changes, or a plan card the turn showed). Questions without `planCardId` come before a new plan: the next turn makes it from the answers. While the session's pending question names a plan card, the next `answer`, `answers` or `text` input gets that card in full, like a `refine` turn, with its sources counting as returned in this turn: from the stored turn, or from the saved plan when the asking turn was a `refine` of one. The model reads each answer with its question's text and revises the plan once; it does not ask again. A `plan` card shown in a turn that changes a plan carries `revises`, that plan's card id. The app sends the card's id as `context.openCardId`. (Until 2026-10-17 a plan turn showed the plan first and asked afterwards.)

A `text` or `refine` input may carry photos the user attached, in `attachments` next to `input`; a `text` input's `text` may then be empty. Each is `{ "kind": "image", "mimeType": "image/jpeg", "data": "<standard base64>" }`: at most 4 per turn, each at most 1,000,000 bytes, of type `image/jpeg`, `image/png`, `image/webp`, `image/heic` or `image/heif`. The server checks that the bytes start like the declared type and answers `400` otherwise. The app downsizes photos before sending (long edge 1,600 px, JPEG quality 80 where the platform re-encodes) and re-encodes anything still too large, or of another type, as a smaller PNG. Gemini reads the photos with the message; a photo Gemini cannot decode ends the turn with an `error` that says so and is not `retryable`.

`context` is sent on every turn. The app is the source of truth for what is on screen; the server does not guess. `userLocation` is present only when the user granted location access. `actionReports` (optional, at most 8) names the map actions of the previous turn the app could not fully apply: the action, `outcome` (`partial` or `ignored`) and the layer names or feature ids it `skipped` (at most 20). The model reads them in the map context.

## Events

Every event carries `turnId` and an increasing `seq`, so the app can de-duplicate and order them. The stream also sends `seq` as the SSE `id:` field.

| Event | Payload | App behaviour |
| --- | --- | --- |
| `status` | `stepId`, `state` (`running`, `done`, `failed`), `tool`, `text` (the tool's status line), `detail` (a short summary of the arguments); when finished also `rows`, `durationMs`, `error` (a tool error code) and `memo` (answered from an identical earlier call) | Shows the step in the turn's trace: a spinner while it runs, then its row count, duration or error. Every tool call sends one `running` and one finished event with the same `stepId`; an instant call (memoised or invalid) sends only the finished one. This is the visible reasoning trace in the demo |
| `text` | `delta` | Appends to the current answer |
| `ui_action` | `stepId`, `action` (`show_layers`, `focus_map`, `draw_route`, `highlight_features`) and its arguments | The map controller applies it; the chat shows the outcome on the step with that `stepId` |
| `card` | `stepId`, `id`, `type` (`area_brief`, `anomaly_analysis`, `plan`, `history`, `list`), items with sources, attribution; a `find_parking` item also carries `parking` (see `CardParking` in tools.md); a plan may carry `travel_mode`, and the stops of a driven plan `stop_parking` (see `StopParking` in tools.md) | Renders the card widget for that type, with sources and Google Maps attribution. An item with `parking` renders as a parking bay: reading, best-match badge, distance and walk to the destination, and the area's fee, time limit, hours and payment on labelled lines with the note that the sign at the bay decides. A plan shows its travel mode; a stop with `stop_parking` shows its nearest free bays (each opens on the map), the free and taken counts, when they were read and the area's rules |
| `question` | `stepId`, `id`, `text`, `options`, `allowFreeText`, `forPlan` when it is asked to make or change a plan, and `planCardId` when it is about an existing plan | One question shows a button per option; a tap sends an `answer` input. Several questions show their options as choices; the user picks for any of them and sends the picks as one `answers` input |
| `usage` | `call` (one model call: `index`, `agent`, `model`, token counts, `durationMs`) and `turn` (running totals) | Updates the token counter of the turn in progress; see [Token usage](#token-usage) |
| `done` | `stop` (`end`, `asked`, `budget`, `cancelled`), `usage` (the final `turn` totals plus `complete`) | Ends the turn |
| `error` | `message`, `retryable`, `usage` (totals so far, `complete: false` when a model call was cut off) | Shows the error; the user may retry if `retryable` |

## Rules

1. **Recommendations only in cards.** Streamed text carries explanations and transitions. Places, events and routes appear in `card` events, which are sent only after source validation (see [agent-design.md](agent-design.md#source-rules)).
2. **UI actions are one-way.** The server does not wait for the app to confirm an action. If an action fails in the app, the next request's `context` shows the real state, and its `actionReports` say which actions of the previous turn were applied only in part or not at all. The app keeps the map as it was before a turn's first action, so the user can undo the last turn's map changes (layers, highlights, route and camera); reopening a conversation from the session list draws its last route and highlights again.
3. **Features by id.** Cards and UI actions reference `featureId`s, which are [map contract v1](../specs/002-map-data-presentation/contracts/map-api.md) MapItem ids. The app resolves them against the items it has loaded from the map query service, which keeps events small and consistent with the map. Card items also carry a `location`, so an item the app has not loaded still shows a pin; `highlight_features` reports ids the server could not find as `missing`, and carries `titles` (id to title) for the ids it found, so the app can label a highlight it has not loaded (an event later tonight while the map shows what is on now).
4. **Server-side sessions, per user.** Conversation history is stored in Firestore under the caller's uid and survives restarts and new revisions. The app keeps the current `sessionId` locally and can list and reopen earlier sessions. A session belongs to one uid; another user's session id returns `not_found`, never `forbidden`. One turn runs at a time per session, and a new turn interrupts the running one, so the user can redirect the agent at any moment: the server asks the running turn to stop, waits up to 5 seconds for it to store what it has (so the new turn's history includes it, marked as stopped), then runs the new turn. A turn that does not stop in time loses its lease; it is stored when it ends, without touching the newer turn's lease or pending question. The store numbers turns in the order they finish.
5. **Cancellation reaches the server.** When the user taps stop, the app aborts the request and calls `POST /v1/sessions/{sessionId}/cancel`; leaving the screen or the session aborts the request too. The server cancels the run on the cancel route, on a newer turn, at the turn deadline, and when no client has followed the turn for 20 seconds after a disconnect (the grace for [resuming](#resuming-a-turn)), so it stops spending tokens and grounding calls: model calls, BigQuery queries and grounding calls in flight are aborted. The stop request travels through the session's lease (`activeTurn.cancelRequested`), which the running turn watches, so it works whichever Cloud Run instance runs the turn. A stopped turn ends with `done` stop `cancelled` and is stored with what it produced so far.
6. **Questions end the turn.** A turn that asks the user sends `question`, then `done` with stop `asked`. A turn asks one question, or up to three about the plan it showed. Tapping an option sends an `answer` input; picks under several questions go as one `answers` input. Typing something else sends `text` as usual, and the agent decides whether it answers the question or changes the topic.

7. **Failed turns are stored.** A turn that fails (a model or tool failure the turn cannot recover from) ends with `error` and is stored with what it produced and `failure` (`message`, `retryable`), so a reopened conversation shows it as failed and the model's history marks it. A model call that fails with a passing error (429, 5xx, a dropped connection) before it streamed anything is made again, up to twice, before the turn fails.

## Resuming a turn

A phone that loses signal drops the turn's stream, but the turn keeps running for a 20-second grace. The app follows it again with `GET /v1/sessions/{sessionId}/turns/{turnId}/events?after={seq}`, where `seq` is the last event it handled: the response replays the later events and streams the rest. The instance keeps a finished turn's events for 60 seconds, so a late resume still gets the end. Only the instance that runs the turn has its events; another answers `404 notFound`, and the app then reads `GET /v1/sessions/{sessionId}` until `runningTurnId` no longer names the turn and shows the stored turn. The app tries to resume three times (after 1, 2 and 4 seconds) and shows "Reconnecting…" meanwhile.

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
| `users/{uid}/sessions/{sessionId}` | `createdAt`, `updatedAt`, `title` (the first user message, trimmed), `turnCount`, `pendingQuestion` (`id`, `text`, `options`, `planCardId`, `forPlan`; the first question when the turn asked several) or null, `activeTurn` lease (`turnId`, `expiresAt`, `cancelRequested` once a stop is asked) or null, `expiresAt` for the TTL policy |
| `users/{uid}/sessions/{sessionId}/turns/{turnId}` | `seq`, `input` (`kind` and `text`, `featureId` or `questionId`/`value`), `attachments` (`id`, `kind`, `mimeType`, `bytes` of each photo), the events the turn produced (`text` joined into one string, `card`, `ui_action`, `question` (the first) and `questions` (all of them; empty for turns stored before 2026-10-16), `done`), a compact tool trace (tool, arguments, status line, argument summary, row count, error, duration, memo flag) and `usage` (the final `turn` totals plus the per-call list, exactly as streamed) |

| `users/{uid}/sessions/{sessionId}/attachments/{attachmentId}` | One photo: `turnId`, `mimeType`, `data` (the bytes), `createdAt`, `expiresAtTs`. Written with its turn, deleted with it |

Stored is what the app needs to redraw the conversation and what the model needs for the next turn: user input and photos, answer text, cards, questions and answers, and the compact trace. The request `context` is not stored, and `userLocation` never is. Full tool results and grounding payloads are not stored with the session; grounding has its own cache.

The prompt for a turn carries the last 20 turns; older turns remain available to the app through `GET /v1/sessions/{sessionId}`. The photos of the last 3 turns go back to the model with them; older photos are only named, so a follow-up about a recent photo still sees it. Limits: 50 sessions per uid, deleting the oldest when a new one is created; 200 turns per session; a 30-day TTL from `updatedAt`. An anonymous uid is lost when the browser clears site data, and its sessions expire with the TTL.

The chat panel shows the user's session list. The user can switch to an earlier session, start a new one and delete one; switching restores that conversation from `GET /v1/sessions/{sessionId}`.

## User events

User-published events (UC-09) are served by the same service on `/v1/events`, with the Firebase ID token like every other route. Firestore holds them, written only by this service; the `user.events` connector in `cloud/data` exports published events to BigQuery as `event` records, so they reach the map's event layer and the agent's `search_features` like Ticketmaster's ([uc-09](use-cases/uc-09-user-events.md), Design).

| Method and path | Purpose |
| --- | --- |
| `POST /v1/events` | Publish an event; the body is a draft. `201` with `{ "event": … }` |
| `GET /v1/events?north&south&east&west&from&to` | Discover: published and cancelled events inside the box (at most 10 km per side) that take place at some point in `[from, to)`. `from` defaults to now, `to` to 14 days later. At most 200, soonest first: `{ "events": […] }` |
| `GET /v1/events/mine` | The caller's events, soonest first: `{ "owned": […], "joined": […] }` |
| `GET /v1/events/{eventId}` | One event: `{ "event": … }` |
| `PATCH /v1/events/{eventId}` | Owner only: any subset of the draft fields; `version` increments |
| `POST /v1/events/{eventId}/cancel` | Owner only: the event stays visible as `cancelled` and nobody can join |
| `DELETE /v1/events/{eventId}` | Owner only: the event disappears (`404` afterwards, `204` now); the export withdraws it |
| `POST /v1/events/{eventId}/join` | Join, with an optional `{ "displayName": "Sam" }`; `{ "event": … }` |
| `DELETE /v1/events/{eventId}/join` | Leave; `{ "event": … }` |
| `GET /v1/events/{eventId}/members` | Owner only: `{ "count": 12, "members": [ { "memberId", "displayName", "joinedAt" } ] }`; `members` is null for an anonymous event |
| `DELETE /v1/events/{eventId}/members/{memberId}` | Owner only: remove one member; `204` |

A draft, the body of `POST` (every field) and `PATCH` (any subset; `endAt`, `placeName` and `capacity` may be set to null):

```json
{
  "title": "Sunset run along the Yarra",
  "description": "Easy 5 km, all paces welcome. Meet at the boathouse steps.",
  "point": { "lat": -37.8206, "lng": 144.9775 },
  "placeName": "Boathouse Drive steps",
  "startAt": "2026-10-12T18:00:00+11:00",
  "endAt": "2026-10-12T19:00:00+11:00",
  "anonymousAttendance": true,
  "capacity": 20
}
```

An event, as every route returns it:

```json
{
  "id": "ue_k3Qm…",
  "title": "Sunset run along the Yarra",
  "description": "Easy 5 km, all paces welcome. Meet at the boathouse steps.",
  "point": { "lat": -37.8206, "lng": 144.9775 },
  "placeName": "Boathouse Drive steps",
  "startAt": "2026-10-12T07:00:00.000Z",
  "endAt": "2026-10-12T08:00:00.000Z",
  "timezone": "Australia/Melbourne",
  "anonymousAttendance": true,
  "capacity": 20,
  "status": "published",
  "attendeeCount": 3,
  "createdAt": "2026-10-10T02:15:00.000Z",
  "updatedAt": "2026-10-10T02:15:00.000Z",
  "version": 1,
  "viewer": { "isOwner": false, "joined": true }
}
```

Rules:

1. **Limits.** Title 1 to 120 characters; description at most 2000; `placeName` at most 120; `point` inside the service area (map contract `SERVICE_BBOX`); `startAt` at most 1 hour in the past and at most 1 year ahead when published; `endAt` after `startAt` and at most 7 days later, or null; `capacity` 2 to 1000, or null for no limit; `displayName` at most 40 characters. Times are accepted with any offset and returned in UTC; `timezone` is always `Australia/Melbourne`.
2. **Anonymous attendance.** With `anonymousAttendance` true, everyone including the owner sees only `attendeeCount`: `members` is null and no member can be removed. The viewer always knows whether they joined themselves.
3. **Joining** needs `status` `published`, a free place and not having joined already; the owner cannot join their own event. Otherwise `409 conflict`, with `messageKey` `agent.error.conflict.eventFull`, `.alreadyJoined`, `.eventCancelled`, `.eventEnded` or `.ownEvent`; leaving an event not joined is `.notJoined`. Owner routes on another user's event answer `403 forbidden`. Unknown and removed events answer `404 notFound`.
4. **Identity.** A member is named to the owner by `memberId`, a per-event hash; a uid never leaves the service. The display name given when joining is stored on that membership only, and a member without one is shown as a guest. The publisher is not named at all.
5. **Rate.** Writes count against a per-uid limit of 60 per hour (`429 rateLimited`); reads are not limited.

| Document | Fields |
| --- | --- |
| `userEvents/{eventId}` | The event fields above plus `ownerUid`, `visibility` (`visible`, or `hidden` for moderation), `attendeeUids` (who joined, in join order: the count, the viewer's `joined` flag and `GET /v1/events/mine` read it), `activeUntil` (`endAt`, or `startAt` plus 3 hours) and `expiresAtTs` (90 days after `activeUntil`, the TTL policy). `status` is `published`, `cancelled` or `removed`; a removed event stays until the TTL so the export can withdraw it. `version` increments on every change, joins included |
| `userEvents/{eventId}/attendees/{uid}` | `uid`, `memberId`, `displayName` or null, `joinedAt`; written and deleted with the membership |

## Feed subscriptions

The feeds a user built on the Home tab (UC-14) are stored per uid by the same service on `/v1/feeds`, with the Firebase ID token like every other route. Firestore holds them, written only by this service; no other service and no client reads them ([uc-14](use-cases/uc-14-personal-feed.md)).

| Method and path | Purpose |
| --- | --- |
| `GET /v1/feeds` | The caller's feeds, in the user's order: `{ "feeds": […] }`. `feeds` is null when this uid never saved, and the app then applies its default feeds; an empty list is a saved choice |
| `PUT /v1/feeds` | Replace the whole list with the body `{ "feeds": […] }`, order kept; `200` with the stored list, names trimmed |

A feed subscription:

```json
{
  "id": "f_k3Qm",
  "name": "Near the office",
  "topics": ["events", "disruptions"],
  "scope": { "kind": "bbox", "bbox": [144.955, -37.822, 144.972, -37.809] },
  "includeUnlocated": false,
  "communityHorizonDays": 7,
  "enabled": true
}
```

Rules:

1. **Shape.** Every field is required and unknown fields are refused (`400 invalidRequest`). `id` matches `^[A-Za-z0-9_-]{1,64}$` and is distinct within the list. `name` is 1 to 60 characters after trimming. `topics` is a nonempty list of distinct values from `community`, `events`, `disruptions`, `news`, `anomalies` and `planning`. `communityHorizonDays` is 1, 7 or 14. `enabled` false keeps a paused feed saved without loading it.
2. **Scope.** `{ "kind": "city" }` is the whole service area; `{ "kind": "area", "areaId": … }` names a City of Melbourne small area, whose list and boxes the app owns (the service checks only the id pattern); `{ "kind": "bbox", "bbox": [west, south, east, north] }` is a box the user framed on the map, finite, ordered and inside the map contract's `SERVICE_BBOX`. `includeUnlocated` also reads the source jurisdiction's records that have no location.
3. **Limits.** At most 20 feeds per uid. Saves count against a per-uid limit of 120 per hour (`429 rateLimited`); a refused body does not count, and reads are not limited.
4. **Whole-list writes.** A save replaces the stored list, last write wins; there is no per-feed route or version check.

| Document | Fields |
| --- | --- |
| `userFeeds/{uid}` | `feeds` (the list above, in order) and `updatedAt` (UTC instant of the last save). A stored list that no longer parses reads as null, as if never saved |

## Saved plans

A plan card the user saves from the chat (UC-03) is kept per uid on `/v1/plans` and shown on the Home tab until the user removes it. It is a one-off: a copy of the card, not a subscription. Its stops are not re-planned on their own, but the user can edit it (its name, which stops, their order), have the agent revise it in the chat and keep the revision in its place, and read each stop's live part again on request: today the parking around it, for a user who reached the stop before and drives on.

| Method and path | Purpose |
| --- | --- |
| `GET /v1/plans` | The caller's saved plans, newest first: `{ "plans": […] }` |
| `POST /v1/plans` | Save the plan card named by the body `{ "sessionId": …, "cardId": …, "replaces": … }` (`replaces` optional); `201` with `{ "plan": … }`. Saving a card already saved returns that plan |
| `PATCH /v1/plans/{planId}` | The user's own edits, body `{ "title": …, "stops": [2, 0] }` (at least one): a new name, or the indices (from 0) of the stops to keep in their new order; `200` with `{ "plan": … }` as kept |
| `DELETE /v1/plans/{planId}` | Remove one; `204`, or `404 notFound` |
| `POST /v1/plans/{planId}/stops/{index}/refresh` | Read one live part of stop `index` (from 0) again, body `{ "part": "parking" }`; `200` with `{ "plan": … }` as kept |

A saved plan:

```json
{
  "id": "c_t_Xk2…_1",
  "sessionId": "s_9fQ…",
  "turnId": "t_Xk2…",
  "savedAt": "2026-10-16T08:12:00.000Z",
  "updatedAt": "2026-10-17T02:30:00.000Z",
  "card": { "id": "c_t_Xk2…_1", "type": "plan", "title": "A quiet evening walk", "items": […] },
  "route": { "polyline": "…", "mode": "walk", "distance_m": 3400, "duration_min": 46, "waypoints": […] }
}
```

Rules:

1. **Copied, not sent.** The service copies the card from the caller's own stored turn, so its sources stay the ones it verified. A card id that is unknown, of another session or of another uid answers `404 notFound`; a card that is not a plan `400 invalidRequest` (`.not_a_plan`). The plan's `id` is the card's id.
2. **Route.** `route` is the arguments of the turn's last `draw_route` action, when it drew one; the app draws it again on request. Absent otherwise.
3. **Lifetime.** A saved plan outlives its 30-day session and has no TTL; the user removes it. `updatedAt` is the last edit or replacement, absent until there is one.
4. **Limits.** At most 30 saved plans per uid (`409 conflict`, `.plan_limit`); a save that replaces a plan does not add one. Saves, edits, removals and stop refreshes count against a per-uid limit of 120 per hour (`429 rateLimited`); saving a card already saved does not count, and reads are not limited.
5. **Refreshing a stop.** The service reads the parking sensors around the stop's `location` again, as `find_parking` does, and replaces the stop's `stop_parking`; no model runs. The area's rules are kept from the earlier reading when it had them, and looked up once (cached by place and day) when it did not. Any located stop can be refreshed, also in a plan that was not driven. An unknown plan or stop answers `404 notFound`, a stop without a location `400 invalidRequest` (`.no_location`), another `part` `400`, and a service without the parking reader `503`. A plan removed while the sensors were read stays removed (`404`).
6. **Replacing.** A save with `replaces` naming one of the caller's saved plans (the app sends the plan the card `revises`) keeps the card in that plan's place: the new plan takes its `savedAt`, gets `updatedAt`, and the replaced plan is removed in the same write. A `replaces` that names no saved plan saves the card as a new plan.
7. **Editing.** An edit changes only the copy: no model runs, and every kept stop keeps its source. A stop whose stop before it changed loses its `getting_there`, which described the old leg. When the plan has a `route`, the service computes it again (Routes API, in the route's mode) through the kept stops that have a `location`, in their new order, and each leg gives the stop it reaches its time as `getting_there` ("12 min walk"); a route it cannot compute (fewer than two located stops, transit through other than two, no route found) is dropped rather than left through the old stops. An unknown plan answers `404`, a stop index the plan does not have `400 invalidRequest` (`.no_stop`), an empty or unknown body `400`. A plan removed while the route was computed stays removed (`404`).

| Document | Fields |
| --- | --- |
| `userPlans/{uid}/plans/{planId}` | The saved plan above. A document that no longer parses is left out of the list |

## Authentication

Firebase Anonymous Auth gives every user, judges included, a uid without a sign-in screen. Requests carry the Firebase ID token in the `Authorization` header. The Cloud Run service allows unauthenticated invocation at the platform level, because a browser cannot obtain an IAM token; the service itself verifies the Firebase ID token on every request and rejects a missing or invalid token before any model or tool call. This ties sessions to users and allows per-uid rate limiting, with counters in Firestore, which protects the per-call grounding budget. Adding data sources (UC-07) and publishing events (UC-09) may need a full account; see the open questions in those use cases.

Anonymous sign-in is the project's only provider, and Firestore's client rules deny every read and write (`cloud/agent/infra/firebase.sh`). The app waits for the Firebase SDK to restore its persisted user before it signs in, and signs in only when there is none, so a reload or restart keeps the uid and the user's sessions. A new browser or device, or cleared site data, is a new user. A development build may send the fixed development token instead, for an agent service running locally in development mode.

## Flutter implementation

| Part | Responsibility |
| --- | --- |
| `AgentClient` | Transport, SSE parsing, cancellation (abort and the cancel route), resuming a dropped turn, stored photos |
| `ChatController` | Conversation state, the turn in progress, any pending question and the turn's running token counter from `usage` events; a message sent while a turn runs interrupts it; restores a session from `GET /v1/sessions/{sessionId}` |
| `SessionList` | Lists, switches, creates and deletes the user's sessions |
| `MapActions` | Applies `ui_action` events to the map |
| Card registry | One widget per card `type`, which maps to a use case |

**Flutter Web streaming:** `package:http`'s `BrowserClient` has used the Fetch API since http 1.3, so it streams response bodies, and http 1.5 added `AbortableRequest` for cancellation. The browser's `EventSource` supports only GET and cannot send the auth header, so the app parses the stream itself (`SseDecoder` in `app/lib/core/network/sse.dart`). Checked on 2026-09-28 in Chrome with http 1.6.0: events arrived as the server sent them, an aborted request closed the connection on the server, and the `Authorization` header passed the CORS preflight. The agent service must allow CORS from the Web origin, including that header.

## Open questions

- Where the JSON Schema for requests, events and cards lives, so Dart and backend models are generated from one source. With the service in TypeScript, the Zod schemas in `cloud/agent` are the natural source.
