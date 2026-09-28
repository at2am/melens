---
id: UC-09
title: Publish and join user events
priority: P2
status: planned
proposed_by: Haoyuan Tang
trigger: browse
agents: []
tools: []
data_sources: []
source_rows: [User-published event, Join user-published event]
---

# UC-09: Publish and join user events

Local events that cannot be found anywhere in Google Maps. P2 because it needs accounts, moderation and cold-start content.

## User stories

1. **Publish.**
   > As a user, I would like to publish customised events on the map directly, so that other people who may be interested can discover and join them.
2. **Join.**
   > As a user, I would like to discover and join local events that cannot be found anywhere in Google Maps.

## Behaviour (minimal version)

1. A signed-in user publishes an event: title, time, place, description.
2. The event is stored in Firestore as a MapFeature in a user-events layer.
3. Everyone sees it on the map.

## Acceptance criteria (Draft)

- [ ] A signed-in user can publish an event, and it appears on the map for other users.

## Notes

- Build only after P1 is done, and only the "publish + show on the map" minimum. Joining, moderation and seeding content are later.
