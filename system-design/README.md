# System design

Design docs for Melens. Coding agents: read [AGENTS.md](AGENTS.md) first.

**Status:** Draft, based on the team plan of 2026-09-27. Decisions the whole team has not confirmed yet are marked Draft or listed under Open questions.

| Doc | What it answers |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Rules for coding agents, and a project summary for humans |
| [CLAUDE.md](CLAUDE.md) | Claude Code entry point; imports AGENTS.md |
| [use-cases/](use-cases/README.md) | What we build, in priority order |
| [architecture.md](architecture.md) | Components, data model, data flow, deployment constraints |
| [agent-design.md](agent-design.md) | Product agents, tools, models, answer rules |
| [data-sources.md](data-sources.md) | External datasets and their limits |

The team plan (timeline, owners, task order) lives in the [team plan doc](https://claude.ai/code/artifact/b20e5265-c986-413b-99f0-4c0e4075083b). This folder holds what the code needs; the plan holds who does what and when.

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
