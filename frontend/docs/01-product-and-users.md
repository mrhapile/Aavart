# 01 — Product and Users

## The problem

Indian Railways maintenance is planned by three departments that do not share a planning table:

- **Track** (TMS) — rail, ballast, geometry
- **Signal** (SMMS) — signalling and interlocking
- **Traction / Electrical** (TDMS) — OHE and power

Each department produces a weekly list of jobs. Each job needs a *possession*: a block of time when a section of track is taken out of traffic service. Because the three lists are built independently, four failures recur:

| Failure | What it looks like |
|---|---|
| Spatial conflict | Two departments block the same section at the same time |
| Temporal conflict | Work is placed in a window a train is actually running through |
| Resource conflict | One crew is committed to two jobs simultaneously |
| **Missed integration** | Two departments could have shared one possession and did not |

The fourth is the expensive one. Every unshared possession is track closure that bought half the maintenance it could have.

## What RailNiyojan does

It ingests all three departments into one validated snapshot, runs a joint constraint solve (Google OR-Tools CP-SAT), independently re-validates the solver's own output, and presents the result to a human planner who must sign it before anything can leave the system.

The measurable claim is **closure-time reduction against a serial baseline** — what the same jobs would have cost if each department took its own possession, one after another.

## What it explicitly does not do

This boundary is load-bearing. It is enforced in the UI copy and asserted by an e2e test that fails the build if prohibited authority language appears anywhere in the workflow.

- It does not connect to live TMS / SMMS / TDMS systems.
- It does not grant railway operating authority. Output is a **candidate recommendation**, never a sanction, dispatch, or permit-to-work.
- It does not schedule trains. It plans *around* existing train paths.
- It is not a real-time control system.
- It plans weekly. Monthly mode is a 30-day date filter over the same solver, not a separate long-range optimiser — and the UI says so rather than implying a second planning tier.

## The user

**Primary — Divisional Manager / Senior Planner.** Works at a desk, on a large monitor, in a divisional office. Accountable by name for the plan they approve. Not a data scientist: they will not accept "the optimiser says so" as an explanation, which is why every scheduled job carries reason codes and every rejected job carries why it could not be placed.

**Secondary — authorised emergency planner.** Injects an urgent job (rail fracture, signal failure) into an already-approved plan through RapidBlock. Checked against a planner allowlist server-side; the UI never decides authorisation for itself.

## Vocabulary

Used identically in the UI, the API, and these documents. Renaming a domain term in the interface is treated as a defect.

| Term | Meaning |
|---|---|
| **Snapshot** | Immutable, validated copy of the input dataset. Hash-identified (`SNAP-…`). Cannot be edited once created. |
| **Planning run** | One solver execution against one snapshot. Produces schedule, reason codes, KPIs, validator result. |
| **Window** | A time slot in which maintenance is permitted on a section. |
| **Section** | A corridor segment between two stations. |
| **Possession** | An authorised block of time with a section out of traffic service. |
| **Integrated block** | Multiple departments sharing one possession — the efficiency win. |
| **Lock** | A planner pinning a job to its slot. Locks survive re-optimisation. |
| **Replan** | Re-solving with locks preserved. Produces a **new run with a new `run_id`** — never mutates the old one. |
| **RapidBlock** | Emergency injection of an urgent job into an active plan, bypassing the 5-step wizard. |
| **Reason code** | Machine-readable justification for a placement or a rejection (`PRIORITY_FIT`, `TRAIN_PATH_CONFLICT`, `LOCK_PRESERVED`). |
| **AI estimate** | Local heuristic pre-pass adjusting priority and duration before the solve. Always has a deterministic fallback, and reports which of the two produced each number. |
| **Approval** | Named human sign-off. Required before export unlocks. |

Full domain reference: [`docs/domain_glossary.md`](../../docs/domain_glossary.md).
