---
id: UC-04
title: Pedestrian anomaly detection and analysis
priority: P0
status: in-progress
proposed_by: Alex Gao
trigger: proactive
agents: [analyse_anomaly, map_agent]
tools: [get_anomaly, analyse_anomaly, nearby_context, search_grounding]
data_sources: [pedestrian-live, pedestrian-history, news-rss, events-ticketmaster, ptv-gtfs-realtime, road-disruptions, search-grounding]
source_rows: [Abnormal detection & analysis]
---

# UC-04: Pedestrian anomaly detection and analysis

The most memorable demo moment. The map notices something unusual on its own and the AI explains it. Google Maps does not do this.

## User stories

Translated from the original Chinese in the Notion table:

> The map shows pedestrian volumes. If today's count at a location stands out against the past week of history, a ping icon (for example a question mark) appears on the map. Tapping it opens a small pop-up that says the count is higher or lower than in the previous week, and asks whether the user wants an analysis of why. If the user taps Analyse, the AI queries the collected news data to judge whether a recent event caused the rise or drop, and gives the user an answer.

## Behaviour

1. A scheduled job writes the latest pedestrian counts to BigQuery every hour.
2. Anomaly detection compares each sensor with the same hour over the past 7 days (one SQL query). The upgrade is BigQuery `AI.DETECT_ANOMALIES` (TimesFM, no training).
3. Sensors beyond the threshold are published to the BigQuery anomaly view. The map query service serves them in the `anomaly` layer, and the app shows the "?" marker on its next bounded refresh; there is no Firestore listener.
4. Tapping the marker opens a pop-up: higher or lower than usual, by how much, and an Analyse button.
5. Analyse runs the `analyse_anomaly` workflow. It fetches the anomaly and its baseline, and nearby news, events and transport disruptions, in parallel; then one generation with Search grounding writes the answer. When the question comes from the chat, `map_agent` calls the same workflow.
6. The `anomaly_analysis` card gives possible causes, a confidence level and source links. It never states a cause as fact.

## Example queries

- "Why is pedestrian traffic unusual here?" (sent by the Analyse button)

## Acceptance criteria (Draft)

- [ ] The hourly job writes new counts to BigQuery without gaps or duplicates.
- [ ] Sensors beyond the threshold appear as "?" markers without an app reload.
- [ ] The pop-up shows the direction (higher or lower) and the size of the difference against the baseline.
- [ ] The analysis lists possible causes, each with a confidence level and at least one source link.
- [x] Replay mode: a chosen historical day can run through the same pipeline, so the demo works even with no live anomaly (once `apply-sql.py` has applied 009 and the replay script has published a batch).

## Notes

- Live counts carry no coordinates; join them with the sensor locations table (134 sensors). Live data lags by about 15–30 minutes.
- News arrives without coordinates; it is placed by the UC-06 extraction pipeline, which this use case shares.
- The biggest demo risk is having no real anomaly on the day, so replay mode is part of P0.

## Status

- 2026-10-15: the `analyse_anomaly` workflow, `get_anomaly` and the Analyse button are built. The hourly pedestrian ingestion and the live detector do not exist yet (the pedestrian and road-disruption jobs are `enabled: false` in `cloud/data/infra/schedules.json` and their admission gates are open), so there is no live marker.
- **Replay mode** (this day): `cloud/data/scripts/anomaly_replay.py` compares real City of Melbourne hourly counts of a historical day (default 2025-09-27, AFL Grand Final day) with the mean of the same hour on the previous 7 days (`same-hour-prev-7d-mean-v1`; anomalous at 50% and 300 people or more, at most 3 hours per sensor) and publishes the result as the source `melens.anomaly.replay` into `melens_ingest.anomaly_results`. `melens_query.v_anomaly_current` serves it; the map service and the agent read it through the same anomaly layer loader a live detector would use (`@melens/shared/query/anomaly-producer`). A replay result keeps its historical window, its title starts with "Replay · ", its attribution names the replayed day, and the consumer refuses a replay result without that title. The source was registered by the replay script without the live-source admission gates and awaits team review (see its `admission_evidence`). A failing anomaly read makes only the anomaly layer unavailable.

## Open questions

- What threshold counts as an anomaly?
- Which historical day to replay, for example a big event day around the AFL Grand Final?
