# Shared query library

`@melens/shared` holds the code every Cloud Run service that reads the published BigQuery views needs: the frozen map contract, the fixed query families, the bounded query runner, the per-layer row adapters, source admission and coverage, and the layer loaders. The map query service (`cloud/map`) and the agent service (`cloud/agent`, planned) import it; neither copies query code. Ingestion (`cloud/data`) writes the views and does not depend on this package.

## What belongs here

| Module | Responsibility |
| --- | --- |
| `src/contracts/map-contract.ts` | Frozen contract v1 schemas, instant comparison and the stable item order |
| `src/config.ts` | Query configuration (project, location, dataset, scan ceilings, timeouts, page and byte limits), loaded from the `MAP_*` variables |
| `src/errors.ts` | The one error-code table (status, retryable) and the error classes |
| `src/query/sql.ts` | SQL fragments shared by every query family: projections, filters, scan budgets |
| `src/query/view-queries.ts`, `unlocated-queries.ts`, `public-record-queries.ts` | The three fixed query families, composed from those fragments |
| `src/query/query-runner.ts`, `bigquery-adapter.ts` | Dry run, byte/row/time bounds and cancellation; the only BigQuery client |
| `src/query/layer-adapters.ts` plus the per-layer adapter modules | Published rows to contract items; the registry drives every layer check |
| `src/query/source-coverage.ts` | Source admission, publication and coverage assessment |
| `src/query/layer-loaders.ts` | Viewport and unlocated layer loads over the runner, and the loader types every consumer shares |
| `src/query/anomalies.ts` | The externally verified anomaly layer loader |

Not here: page services, snapshots, cursors, zoom aggregation and HTTP stay in `cloud/map`; agent tools, prompts and events belong to `cloud/agent`. A module moves here only when a second service needs it.

## Rules

- Services read BigQuery only through this package: fixed parameterized queries over approved `melens_query` views, a dry run, `maximumBytesBilled`, timeouts and cancellation. No caller SQL and no raw-table access.
- A new approved query (for example an hourly pedestrian pattern for the agent) is added to `view-queries.ts` and `sql.ts` here, behind a published view, never inline in a service.
- Changing the contract or the public fields an adapter exposes changes every consumer; run the whole workspace's tests.

## Local commands

The package is an npm workspace member of `cloud/`. Use Node.js `>=24 <25`; TypeScript 5.9.3, Zod 4.6.5 and BigQuery 9.1.0 are pinned and locked in `cloud/package-lock.json`.

```sh
cd cloud
npm ci
npm test                          # shared tests, then map tests
npm run test --workspace shared
```

The compiler writes source and test output into `dist`. Consumers resolve `@melens/shared/<path>` to `dist/src/<path>.js` through the package `exports`, so `cloud/map` compiles this package first (`prebuild`). The unit tests inject a fake BigQuery adapter and need no credentials.
