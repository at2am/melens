# Development budget response verification

Verified on 2026-10-01 Melbourne time in project `melens-510012`. The monthly budget remains AUD 100 with actual-spend notifications at 50%, 80% and 100%. Default Billing IAM email recipients remain enabled. Budget notifications can arrive late and do not enforce a hard spending cap.

## Ordinary Billing delivery

A temporary pull subscription observed a natural Cloud Billing notification published at `2026-09-30T12:58:23.901Z`, message `21284962283360051`. Its billing account and budget identifiers matched the reviewed budget, its currency was AUD and its specified budget amount was 100. It was below the actual-spend stop threshold. The private response service logged `ignored` with zero paused jobs at `2026-09-30T12:58:25.631271Z`. The billing period started at `2026-09-01T07:00:00Z`; no actual cost value is reproduced here.

The first implementation compared months in Melbourne time. Google defines monthly billing budgets using [US and Canadian Pacific calendar time](https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets#calendarperiod). The handler now uses `America/Los_Angeles`, including daylight saving. Seven local behavior tests passed, including September/October and January/February month boundaries. Melbourne October 1 can still belong to the September billing period.

## New image threshold and duplicate checks

The private budget service deployed image `australia-southeast2-docker.pkg.dev/melens-510012/melens-data/data@sha256:53953afb101acd5be5d20b08c20a09c77637fbcac96ff2aac93e6a596d35d8e4`. Revision `melens-dev-budget-action-00003-vnr` passed these checks:

- An unauthenticated POST returned HTTP 403.
- A synthetic September actual-spend alert sent through the real topic at AUD 100, message `22097718226475464`, caused the disposable Scheduler job to read back `PAUSED`. The service logged `checked`, `paused_jobs: 1` at `2026-09-30T23:39:14.559997Z`. This test did not alter Cloud Billing cost data.
- Repeating that alert, message `22101241044122343`, logged `checked`, `paused_jobs: 0` at `2026-09-30T23:41:33.082110Z`. The job stayed paused.
- The disposable Scheduler job and temporary audit subscription were deleted. Reapplying the budget setup excluded the smoke job and read back zero deployed non-P0 source jobs in the allowlist.

The handler identity has only Scheduler get/pause permissions. Authenticated Pub/Sub push uses a separate invoker identity. The handler validates the budget identity, amount, currency, billing period and actual threshold, then pauses only explicitly allowlisted non-P0 jobs. `budget_action_verified` is now true. All source schedules remain disabled pending their own admission, quotas and dedicated runtime identities.
