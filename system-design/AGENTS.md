# AGENTS.md

Instructions for coding agents (Claude Code, Gemini CLI, Antigravity, Codex and others) working in the Melens monorepo. It is also the shortest accurate summary of the project rules for humans.

## Project

Melens is a mobile and web app that shows City of Melbourne datasets as map layers. Gemini agents answer "what is happening here, why, and where should I go". It is our entry for the Google Cloud AI Builder Cup 2026.

## Repository layout

| Path | Contents |
| --- | --- |
| `system-design/` | Design docs, use cases and agent instructions. Read the relevant ones before building a feature. |
| `cloud/` | Google Cloud backend, TypeScript on Node 24: `cloud/data` ingestion jobs, `cloud/shared` the query library every reader uses (contract, fixed queries, runner, adapters), `cloud/map` the map query service, `cloud/agent` the agent service. Read each folder's README before changing it. |
| `app/` | Flutter app for Android, iOS and Web. Read `app/README.md` before changing it. |

Design docs, in reading order:

1. `system-design/use-cases/README.md`: every feature with its priority and status. Start here.
2. `system-design/architecture.md`: components, the map model boundary and the data flow.
3. `system-design/agent-design.md`: product agents, tools, models and answer rules.
4. `system-design/tools.md`: every agent tool with its arguments, returns, errors and owner.
5. `system-design/agent-protocol.md`: how the app talks to the agent service.
6. `system-design/data-sources.md`: external datasets, access and limits.

## Hard rules (competition)

Breaking one of these can disqualify the entry.

1. **Google Cloud only.** Build on Cloud Run, Firebase, Firestore, BigQuery, Secret Manager, Cloud Build and Cloud Scheduler. Do not add AWS, Azure, Vercel, Supabase or other cloud platforms.
2. **Google AI models in the product.** Product AI runs on Gemini (Gemma is also allowed). Do not call third-party model APIs such as OpenAI or Anthropic from product code.
3. **Deployed prototype.** The app must be reachable on Cloud Run or Firebase.
4. **Fresh code.** All code is written during the competition. Do not copy code from earlier projects.
5. **Public repository.** The repo becomes public at submission. Never commit secrets, API keys or `.env` files. Keys live in Secret Manager.

## Product rules

- Specific facts and recommendations (places, events, times, crowds, disruptions) appear in cards, and every card item cites a feature id (a map contract MapItem id) or a web link returned in the same turn. General advice may be plain text but never presents live data without a tool result. Enforce this in code (see `agent-design.md`, Source rules).
- Agents act and state their assumptions rather than ask. They ask the user only when the context cannot resolve an ambiguity: one question per turn, with options.
- Melens data first. Agents answer from the map's own tools and call Google Maps grounding or web search only when those tools cannot answer the request or leave a gap that needs filling, never as a routine step.
- The Flutter app never calls a language model. All agent logic runs in the agent service on Cloud Run.
- Predictions are always labelled as predictions (`is_prediction`) and never styled as live data.
- UI text, prompts and demo content are in English, because Maps grounding only supports English.
- Anything shown from Google Maps grounding carries the required Google Maps attribution.
- When explaining causes, agents give possible causes with a confidence level. They never state a cause as fact.

## Scope and schedule

- Build P0 use cases first. Start P1 only when P0 works end to end. Start P2 only after P1.
- Do not build use cases marked `out-of-scope`.
- Feature freeze is 2026-10-15. After that: bug fixes, UI polish and demo data only.
- Submission target is 2026-10-17; the deadline is 2026-10-18.

## Flutter app

- Package choices, layout and conventions are in `app/README.md`. Follow them, and change that file when they change.
- Use the pinned Flutter version in `app/.fvmrc` (`fvm flutter …`).
- Import `package:material_ui/material_ui.dart`, never `package:flutter/material.dart`.
- After changing annotated code, run `fvm dart run build_runner build` and commit the generated files with the change.
- `fvm flutter analyze` and `fvm flutter test` pass before every commit.

## Working with use cases

- Before implementing a feature, read its use-case file and meet its acceptance criteria.
- Reference the use-case id in commit messages and PR titles, for example `UC-04: publish anomaly markers to BigQuery`.
- When behaviour, priority or status changes, update the use-case frontmatter and the index table in `use-cases/README.md` in the same commit.
- Example queries in use-case files are the seed evaluation set. Add new queries rather than rewriting old ones.
- For a new use case, copy `use-cases/_template.md` and take the next unused id.

## Working with tools

- Implement tools exactly as `tools.md` defines them: names, arguments, limits, returns and error codes.
- Changing a tool's name, arguments, returns or model-facing description updates `tools.md` in the same commit. Once a tool exists in code, its code schema is the source of truth and `tools.md` keeps the description and rationale.
- A new tool gets an entry in `tools.md` and in the registry summary in `agent-design.md`, and is listed in the `tools` field of the use cases that need it.

## Cloud backend

- Everything under `cloud/` is TypeScript on Node 24, with the TypeScript and Zod versions pinned in `cloud/data` and `cloud/map`. New services reuse those pins.
- Product models are Gemini through Vertex AI. Do not add another model provider or a provider abstraction layer.
- Services read BigQuery only through the published `melens_query` views, with fixed parameterized queries and `maximumBytesBilled`. No caller SQL and no raw-table access. That code lives in `@melens/shared` (`cloud/shared`): the contract, the query runner, the layer adapters and the layer loaders. A service imports it instead of copying query code.
- HTTP servers use `node:http` directly, as `cloud/map` does; no web framework.
- Firestore is reached only by the agent service through the Admin SDK, and client security rules deny all access. Chat sessions are stored per Firebase uid.
- Deployment scripts plan by default, take an immutable image digest and audit the runtime identity, following `cloud/map/infra/deploy.sh`.

## Documentation conventions

- Design docs are Markdown in English. Diagrams are Mermaid code blocks so they diff cleanly and render on GitHub.
- Keep docs short and factual. Mark anything the team has not agreed yet as **Draft**, or list it under Open questions.
