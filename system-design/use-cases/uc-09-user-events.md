---
id: UC-09
title: Publish and join user events
priority: P2
status: in-progress
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

## Behaviour in the app today (2026-10-15)

The app side is built behind a repository seam; the shared store is not.

1. **Define.** An event has a title, description, category, start and end (Melbourne time), a place, a visibility (public, or link only), an optional guest limit, a host and the guests who joined. The host is the first guest.
2. **Publish.** The Feed tab's add button opens the editor. Places are picked from a list of Melbourne landmarks until a map picker exists. A public event appears on the Discover tab (a "Community events" chip beside the layers, violet markers) and in the feed of people who follow community events. A link-only event appears in neither.
3. **Join.** A guest joins or leaves on the event page, up to the guest limit. The host cancels instead of leaving; a cancelled or finished event is closed.
4. **Bring people.** The host's Invite sheet gives a message to paste into any chat, with a link that opens the event page where the app has a public origin (the Web build). The app sends nothing itself. Sharing through the system share sheet and push notifications are not built.
5. **Store.** Events live in memory for the app run (`InMemoryUserEventRepository`), and development builds seed three labelled sample events. The shared store is Firestore behind the agent service, which needs a publish and join endpoint that does not exist yet; the app never reaches Firestore itself (AGENTS.md).
6. **Identity.** Until accounts exist, the person is a local profile whose name is edited in Settings.

## Acceptance criteria (Draft)

- [ ] A signed-in user can publish an event, and it appears on the map for other users.
- [x] In the app, a published public event appears on the map and in the feed of the same device, and a guest can join it (in-memory store).

## Notes

- Build only after P1 is done, and only the "publish + show on the map" minimum. Joining, moderation and seeding content are later.

## Open questions

- Can anonymous users publish, or does publishing need a full account?
- Moderation: who removes an abusive public event, and how is it reported?
- The map contract registers nine layers; a shared user-events layer needs a tenth, or events stay a client-side overlay.
