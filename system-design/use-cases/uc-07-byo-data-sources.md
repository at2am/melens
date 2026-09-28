---
id: UC-07
title: Bring your own data sources
priority: P1
status: planned
proposed_by: Haoyuan Tang
trigger: browse
agents: [extraction]
tools: []
data_sources: []
source_rows: [BYO data sources]
---

# UC-07: Bring your own data sources

A source of innovation points, and the second thing Google Maps cannot do: paste a link and Gemini builds the layer.

## User stories

> As a user, I would like to add my own data sources to the map, like the old RSS readers, so that I can visualise things the map owner does not officially support, or something private.

## Behaviour

1. The user signs in with Firebase Auth and pastes a URL.
2. The extraction pipeline reads a sample, detects the fields and maps them to MapFeature fields (structured output).
3. A connector for that URL writes MapFeatures into a new user layer.
4. The layer appears in the layer panel (UC-01).

## Acceptance criteria (Draft)

- [ ] Pasting an RSS, GeoJSON or CSV URL produces a visible layer.
- [ ] Any other format is rejected with a clear message.
- [ ] Adding a source requires sign-in.
- [ ] Each feature from a user source links back to its record in that source.

## Notes

- Only three formats are supported: RSS, GeoJSON and CSV.

## Open questions

- Are user layers private to their owner, or can they be shared?
- How often are user sources refreshed?
- Everyone gets an anonymous account for chat. Does adding a source need a full account (for example Google sign-in), so the layer survives a device change?
