# Progress Tracker

This file is the working tracker for the team.

## Strict rule

- After every feature, bugfix, contract change, or doc change that affects the demo, the person doing the work must stop and read this tracker before starting the next task.
- No one may skip this step because they are using AI.
- No one may begin the next item until the tracker is updated and the next dependency is clear.
- Only the owner updates this file.
- If a task changes the contract, the tracker must point to the decision log entry and the affected acceptance checks.

## Ownership

- Tracker owner: Akash
- Integration owner: Akash
- Rule: everyone reads, only Akash edits

## Current focus

| Item | Owner | Status | Notes |
|---|---|---|---|
| Shared contract lock | Akash | done | Contract and deviation rules already exist |
| Progress tracker | Akash | done | Updated from passing backend, frontend, build, and browser evidence |
| Backend foundation | Akash | done | Validate, plan, inspect, lock, re-plan, approve, guarded CSV export, KPI summary, AI estimate evidence, audit logging, and SQL store path are implemented |
| Solver core | Dev Jaiswal | done | Deterministic OR-Tools CP-SAT output, reason codes, and independent validation are implemented |
| Frontend shell | Arnav | done | The UI executes the real backend workflow and renders API state only |
| Sample data and fixtures | Aadi | done | The deterministic baseline drives backend and browser acceptance tests |
| UI/assets polish | Mohit | done | Desktop/mobile planning desk and explicit run-state labels are implemented |
| Demo script | Sakshi | done | The script matches synchronous planning and CSV export behavior |
| RapidBlock extension | Akash | done | Backend endpoints, guardrail tests, and the emergency UI (incident form, cascade impact, corridor map, live train lookup) are implemented |

## Completion criteria

The project is complete only when all of these are true:

1. The core demo path works end to end: load sample data -> validate -> create snapshot -> run planner -> inspect schedule and reasons -> lock one accepted block -> re-plan unlocked work -> approve -> export.
2. Every check in `docs/project-context/02_acceptance_checks.md` is passing.
3. Planning runs are real, not stubs: the API returns run state, schedule, reason codes, and stable error codes.
4. The solver produces deterministic results for the baseline fixture and preserves locked work during re-plan.
5. The frontend displays backend truth only and does not invent schedule data, states, or approvals.
6. Export is blocked until a valid human-approved run exists.
7. The demo script matches the actual runtime behavior and does not claim live railway sanctioning or validated ML.

RapidBlock is optional. It is not required for completion of the mandatory demo, and it is now implemented end to end.

## Verification record

- Mandatory demo status: complete on 2026-08-29. Full audit re-run on 2026-08-31.
- Backend: 49 tests passed; Ruff and strict mypy passed.
- Frontend: typecheck, lint, 12 unit tests, and production build passed.
- Browser: 32 Playwright tests passed across four specs (foundation, validation gate, failure modes, KPI honesty).
- Contract: generated OpenAPI and TypeScript API schema are current (`make openapi` produces no diff).
- Known limitation: default test mode still uses process-local memory. Durable demo mode requires `STORE_BACKEND=sql` and migrated Postgres.
- Optional work not completed: BlockReady, WeatherGuard, monthly planning as a separate optimiser, and an unlock endpoint.

## Working cycle

1. Read the tracker.
2. Read the shared contract and role file.
3. Do one narrow task.
4. Run the relevant tests.
5. Record what changed.
6. Stop.
7. Read the tracker again before starting the next task.

## Delivery order

1. Mandatory core flow is complete and verified.
2. Hand Arnav the KPI and RapidBlock backend fields if the UI will present them.
3. Add WeatherGuard or monthly planning only after a new decision-log entry.

## Status values

- `pending`
- `in progress`
- `blocked`
- `done`

## Minimum handoff

```text
Completed:
Changed files:
Contract impact:
Acceptance checks:
Test command/results:
Known limitations:
Next dependency:
```
