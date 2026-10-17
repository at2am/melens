# Use cases

What Melens does, in build order. Each file starts with YAML frontmatter that agents and scripts can parse, followed by the user stories, the behaviour, example queries and acceptance criteria.

**Source:** the team's Notion use-case table (15 rows, exported 2026-09-27, kept verbatim in [`_source/`](_source/notion-use-cases-2026-09-27.csv)). The 2026-09-27 plan merged these into UC-01 to UC-12; UC-13 was added on 2026-09-28, UC-14 on 2026-10-15, UC-15 (live parking, a v1 requirement) on 2026-10-15 and UC-16 (assistant memory) on 2026-10-17. Priorities are the plan's proposal and still need team confirmation.

Together the P0 use cases make one demo story: open the map, see an anomaly, ask the AI why, then plan tonight.

| ID | Use case | Priority | Proposed by | Agents | Status |
| --- | --- | --- | --- | --- | --- |
| [UC-01](uc-01-layers-and-topics.md) | Views, layers and topics | P0 | Haoyuan Tang | map_agent (UI action) | in-progress |
| [UC-02](uc-02-map-discovery.md) | Map discovery | P0 | Wasabii | area_brief, map_agent | in-progress |
| [UC-03](uc-03-personalized-discovery.md) | Personalized discovery and planning | P0 | Wasabii | map_agent | in-progress |
| [UC-04](uc-04-pedestrian-anomaly.md) | Pedestrian anomaly detection and analysis | P0 | Alex Gao | analyse_anomaly, map_agent | in-progress |
| [UC-05](uc-05-transport-disruption.md) | Tram and traffic disruption | P0 | unassigned | none (connector) | in-progress |
| [UC-13](uc-13-general-chat.md) | General chat assistant | P0 | Haoyuan Tang | map_agent | in-progress |
| [UC-15](uc-15-live-parking.md) | Live parking bays | P0 | Haoyuan Tang | map_agent, find_parking | in-progress |
| [UC-06](uc-06-local-news.md) | Local news by area | P1 | Alex Gao | extraction | in-progress |
| [UC-14](uc-14-personal-feed.md) | Personal feeds (topics in one area, stored per user) | P1 | Haoyuan Tang | none (app) | in-progress |
| [UC-16](uc-16-agent-memory.md) | Assistant memory and personalised answers | P1 | Haoyuan Tang | map_agent | in-progress |
| [UC-07](uc-07-byo-data-sources.md) | Bring your own data sources | P1 | Haoyuan Tang | extraction | planned |
| [UC-08](uc-08-local-history.md) | Local history | P1 | Haoyuan Tang | map_agent | planned |
| [UC-09](uc-09-user-events.md) | Publish and join user events | P2 | Haoyuan Tang | none (app) | in-progress |
| [UC-10](uc-10-parking-prediction.md) | Parking availability prediction (live bays are UC-15) | P2 | Wasabii | to be decided | planned |
| [UC-11](uc-11-local-deals.md) | Local deals | out-of-scope | Haoyuan Tang | none | dropped |
| [UC-12](uc-12-protest-map.md) | Protest map | out-of-scope | Haoyuan Tang | none | dropped |

## Priorities

| Priority | Meaning |
| --- | --- |
| P0 | Must work end to end by 2026-10-12 |
| P1 | Built from 2026-10-13, only once P0 works. There is no feature freeze; see `AGENTS.md` |
| P2 | Minimal version only, after P1 |
| out-of-scope | Do not build; the file records why |

## Frontmatter fields

| Field | Values |
| --- | --- |
| `id` | `UC-NN`; never reused |
| `title` | Short name |
| `priority` | `P0`, `P1`, `P2`, `out-of-scope` |
| `status` | `planned`, `in-progress`, `done`, `dropped` |
| `proposed_by` | Team member who proposed it in the Notion table |
| `trigger` | `browse` (user explores the map), `query` (user asks), `proactive` (the system surfaces it) |
| `agents` | Chat agent, workflows or pipeline involved: `map_agent`, `area_brief`, `analyse_anomaly`, `extraction`; see [agent-design.md](../agent-design.md) |
| `tools` | Agent tools involved; see [tools.md](../tools.md) |
| `data_sources` | Ids from [data-sources.md](../data-sources.md) |
| `source_rows` | Row titles in the Notion export that this use case merges |

## Evaluation

The **Example queries** sections are the seed eval set for the product agents, to be grown to about 25 queries. See [agent-design.md](../agent-design.md#evaluation).

## Adding a use case

Copy [`_template.md`](_template.md), take the next unused id, and add a row to the table above in the same commit.
