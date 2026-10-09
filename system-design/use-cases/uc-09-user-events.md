---
id: UC-09
title: Publish and join user events
priority: P2
status: in-progress
proposed_by: Haoyuan Tang
trigger: browse
agents: []
tools: []
data_sources: [user.events]
source_rows: [User-published event, Join user-published event]
---

# UC-09: Publish and join user events

Local events that cannot be found anywhere in Google Maps. P2 because it needs accounts, moderation and cold-start content.

## User stories

1. **Publish.**
   > As a user, I would like to publish customised events on the map directly, so that other people who may be interested can discover and join them.
2. **Join.**
   > As a user, I would like to discover and join local events that cannot be found anywhere in Google Maps.

## Behaviour

1. A signed-in user publishes an event: title, description, a pin (the map centre or a tapped point), start and optional end time, an optional place name and capacity, and whether attendance is anonymous.
2. The event is stored in Firestore by the agent service (`/v1/events`, [agent-protocol.md](../agent-protocol.md#user-events)) and exported to BigQuery as `event` versions of source `user.events`, so it reads like any other event on the map and in the agent's tools.
3. Everyone discovers published events near the map's viewport in the Events panel, and on the map once the export has run.
4. A user joins or leaves an event, optionally with a display name. An anonymous event shows only how many are going; otherwise the owner sees the members.
5. The owner edits, cancels or removes the event and removes members. A cancelled event stays visible as cancelled; a removed one disappears and is withdrawn from BigQuery.

## Acceptance criteria (Draft)

- [x] A signed-in user can publish an event, and it appears in the Events panel for other users (implemented 2026-10-10, pending the review of the panel).
- [ ] The published event appears on the map's event layer for other users once the `user.events` export is scheduled.
- [x] A user can join and leave an event; an anonymous event shows only the count.
- [x] The owner can edit, cancel and remove the event and remove a member.

## Design (Draft, 2026-10-09; implemented 2026-10-10, see the protocol's User events section for the routes)

**Firestore writes, BigQuery reads, one-way export between them.** Firestore is the source of truth for user content: per-record writes bound to a uid, with the agent service's token check and per-uid rate limit in front. BigQuery is the only thing the map service and the agent read (AGENTS.md, Cloud backend), so an exported event flows through `v_geo_records_current`, `adaptEventRows`, `search_features`, `nearby_context` and the `show_card` source check with no reader change. Edits never touch BigQuery; the export appends a new version.

**Layer.** The minimal version reuses the `event` layer and tells user events apart by `sourceId` and attribution. A separate `userEvent` layer touches the contract enum, `GEO_TOPICS` in `sql.ts`, the layer adapters, source coverage, the app's `MapLayerId` and the tools' layer enum; it waits for join and moderation.

### Firestore document

Collection `userEvents/{eventId}`, written only by the agent service. Each field maps to the contract's `kind: 'event'` MapItem.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | `ue_<ulid>`; a contract identifier (no whitespace, at most 256 characters) |
| `ownerUid` | string | Firebase uid. Stays in Firestore; never exported |
| `title` | string | 1 to 120 characters |
| `description` | string | At most 2000 characters, plain text |
| `point` | `{ lat, lng }` | Inside `SERVICE_BBOX`; points only in v1 |
| `placeName` | string or null | What the user called the place |
| `startAt`, `endAt` | UTC timestamp | `startAt < endAt`; `endAt` may be null |
| `timezone` | string | Fixed `Australia/Melbourne`, exported as `sourceTimezone` |
| `status` | enum | `published`, `cancelled`, `removed` |
| `visibility` | enum | `visible`, `hidden`; for moderation, always `visible` in v1 |
| `version` | integer | Incremented on every edit; becomes `version_id` |
| `createdAt`, `updatedAt` | timestamp | `updatedAt` is the export cursor |
| `attendeeCount` | integer | 0 in v1; denormalised from `attendees/{uid}` once join exists |

No user-supplied URLs in v1: `geo_records` admits only vetted public fields into `title`, `summary` and `original_url`.

### Export to `geo_records`

One row per document version, written the way the Ticketmaster connector writes its rows.

| Column | Value |
| --- | --- |
| `source_id` | `user.events`, added to the public source registry with attribution "Published by a Melens user" |
| `geo_record_id`, `version_id` | From `sourceRecordId`; version `v<version>` |
| `topic`, `assertion_kind` | `event`, `plan` |
| `title` | `title` |
| `summary` | JSON `{ "description", "placeName", "attendeeCount" }`; `adaptEventRow` gets a `user.events` branch that fills `venueName`, as `disruptions.ts` parses its JSON summary |
| `geometry_geojson` | Point `[lng, lat]`; `location_role` `event_site` |
| `location_confidence` | `source_coordinate`: the publisher placed the pin (the geography validation admits a point only from the source or an official join) |
| `valid_from`, `valid_to` | `startAt`, `endAt` |
| `record_status` | `planned` before `startAt`, `active` during, `cancelled`; `withdrawn` for `removed` or `hidden`, which suppresses the earlier versions |
| `public_query_allowed` | true |

### Write and export paths

1. The app calls `POST /v1/user-events` on the agent service with the Firebase ID token. The service validates with Zod, applies the per-uid rate limit and writes the document.
2. A `user_events` connector in `cloud/data` runs on Cloud Scheduler every 5 minutes. It reads documents with `updatedAt` after its checkpoint through the Admin SDK, returns the three row sets, and the publisher gates the batch like any other source.
3. The 5-minute delay is acceptable for the minimal version. The app may show the publisher's own event locally until the published row appears.

**Rule change.** AGENTS.md says only the agent service reaches Firestore. This design adds a read-only path from `cloud/data`; update that rule in the same commit as the connector. The Firebase "Stream Firestore to BigQuery" extension is the alternative, but it bypasses the publisher gate and still needs a view to shape its change log into `geo_records`.

## Notes

- Build only after P1 is done, and only the "publish + show on the map" minimum. Joining, moderation and seeding content are later.

## Open questions

- Anonymous publishing: an anonymous uid can publish. Linking a Google account later keeps the uid, so the events follow the account. Confirm with the team.
- Whether the 5-minute export delay is acceptable for the map's event layer. The Events panel reads the live records from the agent service, so discovery and joining do not wait for it.
- The export's `original_url` is `https://melens-510012.web.app/events/{eventId}`; the app does not open that path yet.
- Moderation: nothing sets `visibility` to `hidden` yet; the export and the routes already honour it.
