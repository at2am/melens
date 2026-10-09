# User-published events (`user.events`)

**Status:** Draft, 2026-10-10. The connector and manifest exist; the identity and schedule are not provisioned yet (`access_status: ready`).

Events that users publish in the app ([UC-09](../../../../system-design/use-cases/uc-09-user-events.md)). They are written by the agent service to Firestore (`userEvents/{eventId}`, [agent-protocol.md](../../../../system-design/agent-protocol.md#user-events)) and exported to BigQuery by the `user_events` connector, so they reach the map's event layer and the agent's `search_features` like any other event source.

## What is exported

| Field | Exported as |
| --- | --- |
| `title` | `title` |
| `description`, `placeName`, the attendee count, `anonymousAttendance` | `summary`, as one JSON object; the shared event adapter turns it into the item's summary and venue |
| `point` | A Point geometry, `location_role` `event_site`, `location_confidence` `source_coordinate` (the publisher placed the pin, and the geography validation admits a point only from the source or an official join) |
| `startAt`, `endAt` | `valid_from`, `valid_to` |
| `createdAt`, `updatedAt`, `version` | `published_at`, `source_updated_at`, `source_version_ordinal` |
| `status`, `visibility` | `record_status`: `planned` before the start, `active` after it, `cancelled`; `withdrawn` for a removed or hidden event, which suppresses every earlier version |

Never exported: the owner's uid, the attendees' uids or display names, the capacity (the attendee count suffices). The schema drops unknown fields, and the connector test asserts that no uid appears in any row.

## Licence and rights

The content is the user's own. By publishing, the user grants Melens the right to show the event on the map and in the agent's answers while it is published; the licence status is `restricted` because it is not an open-data licence. The owner can edit, cancel or remove the event at any time in the app, and the export withdraws a removed event on its next run (every 5 minutes once scheduled). Moderation hides an event by setting `visibility` to `hidden`, which exports the same way. There is no external publisher and no original link: the public source reference carries a null URL and the attribution "Published by a Melens user".

## Completeness and schedule

One Firestore query returns every document whose `updatedAt` lies in the half-open window, ordered by `updatedAt`; there is no paging and nothing is sampled. The connector refuses snapshot runs. The schedule is time mode, every 5 minutes with no overlap (`infra/schedules.json`); Cloud Scheduler retries are idempotent because the window is aligned to the interval and a re-exported version has the same `version_id`.

## Provisioning

The connector's dedicated identity needs Firestore read access on the project (`roles/datastore.viewer`) in addition to the standard ingestion grants; it uses no secret. `infra/source-identities.py` lists the source; `access_status` becomes `active` and the schedule `enabled` when the integrator provisions the identity and verifies the first run. AGENTS.md records that the data pipeline is the second service, after the agent service, that reaches Firestore, read-only.
