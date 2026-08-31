# RailNiyojan

**Integrated railway maintenance block planning.** Smart India Hackathon problem statement **SIH26027**, built by **Team Aavart**.

RailNiyojan takes the weekly maintenance job lists from three railway departments that currently plan in isolation, solves them jointly under real safety and timetable constraints, explains every decision it makes, and refuses to release a plan until a named human has approved it.

> **This is decision-support software, not a sanctioning system.** Its output is a *candidate recommendation*. It does not grant railway operating authority, and nothing it produces is a possession, a permit-to-work, or a dispatch. That boundary is enforced by a test that fails the build if authority language appears anywhere in the interface.

---

## The problem

Track (TMS), Signal (SMMS), and Traction (TDMS) each produce a weekly list of maintenance jobs. Each job needs a *possession* — a block of time with a section of track taken out of traffic service. Because the three lists are built separately, the same section gets blocked twice, crews get double-booked, work lands in windows where trains are running, and — most expensively — two departments take two separate possessions where one shared block would have done.

Every unshared possession is track closure that bought half the maintenance it could have.

## What we built

A working vertical slice, measured on a 90-job corridor:

| | Result |
|---|---|
| Jobs placed | **81 of 90** (90%) |
| Section closure used | **1,995 min** vs. a 5,340 min serial baseline |
| **Closure reduction** | **−62.6%** |
| Maintenance done per closed minute | **2.68×** |
| The 9 unplaced jobs | Lowest priority, each with a machine-readable reason code |

That reduction is measured against a **named counterfactual** — one possession per job, stacked back to back within each section — not against an imaginary human plan. The nine jobs it cannot fit are reported as loudly as the nine-tenths it can. `docs/solver_capacity.md` shows the full measurement and how to reproduce it.

### How it works

```
 CSV / JSON department feeds  (TMS · SMMS · TDMS · Civil)
              │
              ▼
    Validation and canonical merge  ──►  rejected data never reaches the solver
              │
              ▼
    Immutable, hash-identified snapshot
              │
              ▼
    AI estimate pre-pass  (local heuristic, deterministic fallback)
              │
              ▼
    OR-Tools CP-SAT solve  ──►  schedule + reason codes + KPIs
              │
              ▼
    Independent validator  ──►  re-checks the solver's own output
              │
              ▼
    Planner review  ──►  lock · move · exclude · re-optimise
              │
              ▼
    Named human approval  ──►  only now does CSV export unlock
```

Five properties we consider the actual contribution:

1. **The solver is checked by something that is not the solver.** An independent validator re-verifies the output against the safety rules. A run that fails it cannot be approved, no matter what CP-SAT returned.
2. **Every decision is explained.** Each scheduled job carries reason codes for *why that window*; each rejected job carries *why not at all*.
3. **Locks survive re-optimisation.** A planner pins the blocks they have committed to, and the solver re-plans everything else around them.
4. **Runs are immutable.** Re-optimising creates a *new* run. The archive reopens exactly what was approved, never what it later became.
5. **Human approval is a hard gate.** Export is blocked until an approved, feasible, independently-validated run exists — enforced server-side, not just greyed out in the UI.

---

## Quick start

**Requirements:** Docker + Docker Compose, Python 3.12, Node.js 24, `pnpm`, `uv`.

```bash
cp .env.example .env     # or just run `make dev`, which seeds it for you
make install
make dev
```

- Web UI — <http://localhost:3000>
- API health — <http://localhost:8000/health>

Compose starts three services: `db` (PostgreSQL/PostGIS), `api` (FastAPI, solving in-process), and `web` (Next.js).

Click **Start New Plan**, keep the default corridor, and walk the five steps. The baseline fixture at `fixtures/baseline_valid/dataset.json` is what the demo is built around; `docs/demo_script.md` is the guided walkthrough.

## Verifying it

```bash
make test        # backend + web unit tests
make test-e2e    # Playwright, boots its own API and web server
make lint
make typecheck
make openapi     # regenerate the API schema + TS types; should produce no diff
```

Last full run (2026-08-31), all green:

| Check | Result |
|---|---|
| Backend (pytest) | 49 passed |
| Web unit (Vitest) | 12 passed |
| Browser (Playwright) | 32 passed |
| Ruff · strict mypy · ESLint · tsc | clean |
| Production build | clean |
| OpenAPI / TS schema drift | none |

> If `make test-e2e` fails on the outage or archive specs, check whether `make dev` is still running — Playwright reuses an existing server on ports 3000/8000. Run `docker compose down`, or use `PORT=3100 API_PORT=8100 pnpm test:e2e`.

CI runs the same checks on every push and pull request (`.github/workflows/ci.yml`).

---

## Repository map

| Path | What is in it |
|---|---|
| `apps/web` | Next.js planning desk — the whole UI |
| `backend/src/railniyojan/api` | FastAPI routes, validation, run lifecycle |
| `backend/src/railniyojan/optimizer` | CP-SAT planner and the independent validator |
| `backend/src/railniyojan/contracts` | Pydantic contracts — the single source of truth for every field |
| `backend/src/railniyojan/planning` | KPIs, AI estimates, storage backends |
| `backend/migrations` | Alembic migrations |
| `fixtures` | Deterministic datasets and expected outputs |
| `openapi` | Generated schema; the web app's types derive from it |
| `docs` | System documentation (below) |
| `frontend/docs` | Frontend design record |
| `frontend/reference` | Hand-drawn Excalidraw design artefacts |

## Documentation

**Start here if you are reviewing this project:**

| Read | For |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | The whole system in one document |
| [`docs/solver_capacity.md`](docs/solver_capacity.md) | Measured results, and an honest account of what the planner *cannot* fit |
| [`docs/demo_script.md`](docs/demo_script.md) | The guided walkthrough |
| [`frontend/docs/`](frontend/docs/) | How the interface was designed, and where the design was wrong |
| [`docs/security_and_safety.md`](docs/security_and_safety.md) | The safety boundary and how it is enforced |

**Depth, by area:** [`docs/architecture/`](docs/architecture/) (backend · frontend · solver) · [`docs/api_contract.md`](docs/api_contract.md) · [`docs/data_contract.md`](docs/data_contract.md) · [`docs/database_schema.md`](docs/database_schema.md) · [`docs/ruleset_demo_v1.md`](docs/ruleset_demo_v1.md) · [`docs/test_strategy.md`](docs/test_strategy.md) · [`docs/domain_glossary.md`](docs/domain_glossary.md)

**Process and honesty:** [`docs/project-context/`](docs/project-context/) holds the shared contract, acceptance checks, decision log, and progress tracker. [`risk-review-and-hackathon-deviation.md`](risk-review-and-hackathon-deviation.md) and [`hackathon-deviation-plan.md`](hackathon-deviation-plan.md) document, with citations to Indian Railways rules, exactly where we narrowed the reference architecture and why.

---

## The team

**Team Aavart** — six members, with owned surfaces rather than shared mush. Role briefs are in [`docs/roles/`](docs/roles/).

| Member | Owns |
|---|---|
| **Akash** | Backend, API, run lifecycle, integration and merge decisions |
| **Dev Jaiswal** | CP-SAT model, constraints, reason codes, AI estimates |
| **Arnav Gogia** | Frontend — ingestion, review desk, approval and export states |
| **Aadi Shah** | Research, data contract, fixtures, conflict scenarios |
| **Mohit Ray** | Design system, visual hierarchy, demo assets |
| **Sakshi Raghuwanshi** | Problem framing, solution story, demo script, deck |

How we worked is recorded, not just claimed: a locked shared contract before parallel work began, a decision log for every contract change, and a progress tracker with a single owner. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Known limitations

Stated deliberately. A prototype that hides its edges is harder to trust than one that names them.

- **No live railway adapters.** Input is controlled CSV/JSON following our canonical contract. Real TMS/SMMS/TDMS integration needs interface validation we cannot do in a hackathon.
- **One corridor.** Explicit sections, isolation zones, and train paths — not railway-wide master data.
- **Weekly only.** Monthly mode is a 30-day filter over the same solver, not a second planning tier, and the UI says so.
- **Fixed ruleset.** `Demo Ruleset v1`, visible in the UI. Exact legal block and isolation rules require Railway expert validation.
- **No authentication.** RapidBlock checks a server-side planner allowlist; there is no identity system behind it.
- **Process-local storage by default.** Durable mode needs `STORE_BACKEND=sql` and a migrated Postgres.
- **No unlock.** A planner who locks a job wrongly must re-plan rather than undo.
- **Synthetic data.** A successful demo proves the pipeline works, not that real railway data works.

## Where this goes next

1. **Real source adapters** behind the existing contract boundary — the adapter interface is already the production path.
2. **Monthly planning** as a genuine capacity-reservation tier that weekly planning expands, rather than a date filter.
3. **Rule governance** — the fixed demo ruleset becomes versioned, configurable, expert-validated rule artefacts.
4. **ML priority and duration** trained on historical actuals, with the deterministic fallback kept permanently as the floor.
5. **Identity and audited authority** — real planner identity, then a sanctioning-system handoff, which is the only path from recommendation to operational block.
6. **Scale** beyond one corridor, with solver telemetry (variables, runtime, gap) surfaced as a first-class quality signal.

---

## Common mistakes

- Do not read solver output as a railway sanction.
- Do not edit `apps/web/src/lib/api-schema.ts` by hand — change the Pydantic contract and run `make openapi`.
- Do not change the shared contract without updating the docs, fixtures, and tests that depend on it.
- Do not edit the progress tracker unless you are Akash.
