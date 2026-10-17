---
id: UC-16
title: Assistant memory and personalised answers
priority: P1
status: in-progress
proposed_by: Haoyuan Tang
trigger: query
agents: [map_agent]
tools: []
data_sources: []
source_rows: []
---

# UC-16: Assistant memory and personalised answers

The assistant remembers what lasts about the user (how they get around, what they enjoy, when they go out) and what they browse most on the map, and uses it to tailor its answers without asking again. Added 2026-10-17; not from the Notion table.

## User stories

> As a user, I would like the assistant to remember that I drive and that I like live music, so that I do not have to say it again and its answers fit me.

> As a user, I would like to see what the assistant remembers about me, delete any of it, and switch it off.

## Behaviour

1. After every chat turn the agent service reads what the user said (their message, or their answers to the agent's questions) together with the memory so far, and adds, updates or removes lasting facts: travel (drives, cycles, takes trams), interests, routines, preferences. One Gemini call per turn, after the answer, so it never delays it. The map's own entry points (Brief this area, Analyse) and photos without words are not read.
2. The app reports what the user does on the map: each layer they turn on and each record they open, with the event category for an event. A signal carries no place, record id or time. Signals go in batches of ten and before every chat message. Their weight halves every 14 days, so the summary follows what the user looks at now.
3. Every turn's message carries a User memory block: the facts and the layers and event categories the user browses most. The agent uses it as rule 11 of its instruction says: a driver is offered parking when the answer sends them somewhere, a plan does not ask how they travel when the memory says, and the agent states such assumptions ("Since you usually drive, …"). The current message, its answers and the map context win over the memory, and the agent never recites it.
4. Settings, under Memory, shows each fact with a button that forgets it, the "Often browses" line, Forget everything, and a switch. Switched off, the agent neither reads nor adds to the memory, and browsing is not kept; what was remembered stays until the user forgets it.

## Example queries

- "I drive in most weekends, where can I park near the MCG?" (remembers: drives into the city)
- "Plan my Saturday evening" after earlier answering "Drive" to how they get around (plans for driving with parking, asks nothing about travel)
- "Forget that I have a dog"
- "I'm into jazz, anything on tonight?" then, in a later conversation, "anything on tonight?" (leads with jazz)

## Acceptance criteria (Draft)

- [x] A turn's message carries the memory after the map context; the instruction and tools stay the same for every user, so the context cache still serves them.
- [x] An answer such as "Drive" to a plan question becomes a travel fact that the next turn reads.
- [x] Only the user's own words are read; the area and analyse entry points are not.
- [x] Browsing signals carry no place or id, fade with a 14-day half-life, and are dropped while memory is off.
- [x] The user sees, forgets one fact, forgets everything and switches memory off in Settings.
- [x] The memory update never delays or fails a turn; its model call is logged (`memoryLearned`) outside the turn's usage.
- [ ] The eval set includes a remembered driver planning an evening.

## Notes

- The memory model is told never to keep addresses, where the user lives or works, coordinates, names, contact details, health or disability, religion, ethnicity, sexuality, politics or finances, or anything about another person. The request's `userLocation` is never stored, as before.
- Up to 24 facts of at most 160 characters; when full, the facts changed longest ago make room. The memory is deleted 180 days after its last change (Firestore TTL).
- The memory belongs to the anonymous uid: a new browser or device starts without it, as with sessions.
- Deleting conversations does not delete the memory; Forget everything does.

## Open questions

- Should the Home tab's default feeds (UC-14) follow what the user browses most?
- Should the chat's first-message suggestions follow the memory?
