# Agent design

**Status:** Draft from the 2026-09-27 plan. Tool names are working names until plan task F3 fixes the agent framework contract.

This file describes the agents inside the product. Instructions for coding agents are in [AGENTS.md](AGENTS.md).

AI does three jobs: it turns messy data into map features (extraction), answers "where should I go and what should I do" (discovery), and explains "why" (insight). The goal is AI as an active part of the map, not a chat box in a corner.

## Agents

| Agent | Answers | Tools | Model |
| --- | --- | --- | --- |
| Root | Detects intent and delegates | Discovery agent, insight agent | `gemini-3.8-flash` |
| Discovery | What's around here? Where can I see art after 7 pm? Plan me a 45-minute walk | `search_features`, `heritage_lookup`, Maps grounding, Search grounding | `gemini-3.8-flash` |
| Insight | Why is pedestrian traffic unusual here? | `get_anomaly`, `nearby_context`, Search grounding | `gemini-3.8-flash` |
| Extraction (not chat) | News item to place and summary; BYO URL to field mapping | Structured output (JSON schema) | `gemini-3.5-flash-lite` |

Chat uses the stable `gemini-3.8-flash`. Batch extraction uses the cheaper `gemini-3.5-flash-lite`. There is no stable Pro model yet (only `gemini-3.1-pro-preview`), and the product must not depend on preview models during the competition.

## Tools

| Tool | Used by | Returns |
| --- | --- | --- |
| `search_features` | Discovery | MapFeatures from Firestore layers near a point |
| `heritage_lookup` | Discovery | Victorian Heritage Database records near a point |
| `get_anomaly` | Insight | Anomaly value and baseline for a pedestrian sensor |
| `nearby_context` | Insight | Nearby news, events and transport disruptions |
| `maps_grounding` | Discovery | Google Maps grounding: places, opening hours, routes |
| `search_grounding` | Discovery, Insight | Google Search grounding: web results with links |

## Flow 1: pedestrian anomaly analysis (UC-04, demo highlight)

1. A scheduled job writes the latest pedestrian counts to BigQuery every hour.
2. Anomaly detection compares each sensor with the same hour over the past 7 days (one SQL query). The upgrade is BigQuery `AI.DETECT_ANOMALIES` (TimesFM, no training needed).
3. Sensors beyond the threshold are written to Firestore as a "?" MapFeature, and the app shows the marker in real time.
4. The user taps Analyse. The insight agent fetches the anomaly value, then checks nearby news, events and transport disruptions, and searches the web if needed.
5. The answer lists possible causes, a confidence level and source links. It does not state a cause as fact.

## Flow 2: place discovery and planning (UC-02, UC-03)

1. The user selects a point on the map or asks directly. The app sends the coordinates, the current time and the enabled layers to the agent.
2. The discovery agent searches layer features and heritage records within a radius, then uses Maps grounding for place details.
3. It returns a fixed-format card first (neighbourhood character, recommended places, upcoming activities). The chat stays open for follow-up questions.
4. Walking routes use the Maps grounding route capability (up to 13 waypoints) and are drawn on the map as a polyline.

## Answer rules

- **No source, no output.** Every recommendation carries a MapFeature id or a web link, matching the team rule that data must have a clearly traceable source.
- **Predictions labelled.** The `is_prediction` field on a MapFeature decides its UI style.
- **English only.** Maps grounding supports English only, so the app, prompts and deck are in English.
- **Grounding tools wrapped.** If ADK's built-in Search or Maps tools cannot be mixed with custom function tools in one agent, wrap them as sub-agents (`AgentTool`) and give those to the discovery and insight agents.

## Evaluation

- The example queries in the use-case files are the seed eval set. Grow it to about 25 queries.
- Run the set after every prompt change. Check that each answer has a source, the places exist and the times are correct.
- Results go into the deck as evidence for the technical score.
