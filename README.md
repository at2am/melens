# Melens

Melens shows City of Melbourne datasets as map layers, and Gemini agents answer "what is happening here, why, and where should I go". It is our entry for the Google Cloud AI Builder Cup 2026. Coding agents: read [system-design/AGENTS.md](system-design/AGENTS.md) first.

| Folder | Contents |
| --- | --- |
| [system-design/](system-design/) | Design docs, use cases and agent instructions |
| [cloud/](cloud/) | Google Cloud backend (empty for now) |
| [app/](app/) | Flutter app (empty for now) |

## Design docs

**Status:** Draft, based on the team plan of 2026-09-27. Decisions the whole team has not confirmed yet are marked Draft or listed under Open questions.

| Doc | What it answers |
| --- | --- |
| [AGENTS.md](system-design/AGENTS.md) | Rules for coding agents, and a project summary for humans |
| [CLAUDE.md](system-design/CLAUDE.md) | Claude Code entry point; imports AGENTS.md |
| [use-cases/](system-design/use-cases/README.md) | What we build, in priority order |
| [architecture.md](system-design/architecture.md) | Components, data model, data flow, deployment constraints |
| [agent-design.md](system-design/agent-design.md) | Product agents, tools, models, answer rules |
| [data-sources.md](system-design/data-sources.md) | External datasets and their limits |

The team plan (timeline, owners, task order) lives in the [team plan doc](https://claude.ai/code/artifact/b20e5265-c986-413b-99f0-4c0e4075083b). `system-design/` holds what the code needs; the plan holds who does what and when.

## Competition facts

| Item | Value |
| --- | --- |
| Competition | Google Cloud AI Builder Cup 2026 (JAPAC) |
| Theme (proposed) | Media, Content & Digital Experiences |
| Judging | Technical merit & GenAI 40%, problem alignment & impact 25%, innovation & creativity 25%, UX & solution design 10% |
| Deliverables | Live URL on Cloud Run or Firebase, demo video under 3 minutes, public GitHub repo, PDF deck |
| Team registration closes | 2026-10-11 |
| Feature freeze | 2026-10-15 |
| Submission | Target 2026-10-17, deadline 2026-10-18 |
| Finals | Demo Day in Singapore, 2026-12-04 |

Rules: [Challenges & Requirements](https://aibuildercup.com/themes.html), [FAQ](https://aibuildercup.com/Faqs.html), [Terms & Conditions](https://docs.google.com/document/d/e/2PACX-1vRm7ChZ6Ij9fG7uFDkxzUMpwgVeBmnQ6cMDnAIEEX84AiLBOOQ9cYbl3S5OzFBbcVb8TF55s-eVpiXb/pub).
