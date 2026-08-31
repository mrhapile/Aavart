# 03 — Screens and States

The app is one Next.js page driving a view state machine. Components live in `apps/web/src/components/`, grouped by screen area.

## Navigation map

```
Home ──┬── Start New Plan ──────► 5-step wizard ──► Plan Approved
       ├── View Previous Plans ──► Archive list ──► Review Desk (read-only)
       └── Emergency Block ──────► RapidBlock (no wizard stepper)
```

The wizard stepper is shown only in the wizard. RapidBlock deliberately does not show it — it is not step 6 of anything, it modifies an *already-approved* plan, and dressing it as part of the normal flow would misrepresent its risk.

---

## The five wizard steps

### Step 1 — Select Data · `SelectDataStep`

Pick a corridor preset, then add or skip each department feed (TMS / SMMS / TDMS / Civil). Files are read in the browser (`.json` / `.csv`), parsed, and merged into one canonical payload with `metadata.source_provenance`.

Planning horizon toggles Weekly (7-day) or Monthly (30-day date-bounded filter). At least one department must supply data.

**No API call.** Nothing is sent until the planner asks for validation.

### Step 2 — Check Data · `CheckDataStep`

`POST /datasets/validate` on entry. Two states, and only the backend decides which:

- **Snapshot registered** → counts (jobs / windows / sections / crews), the backend source hash, per-department provenance, and the solver unlocks.
- **No snapshot** → the rejection list, each issue expandable with its code, field, job, and message. The only exit is back to Step 1.

There is no control on this screen that can change the verdict. See [decision 5](./02-design-decisions.md).

### Step 3 — Create Plan · `CreatePlanStep`

`POST /planning-runs` with the snapshot candidate. Checklist advances on a timer; the last item waits for the real response. Failure paths are distinct, because they need different recoveries:

| Outcome | What the planner sees |
|---|---|
| `INFEASIBLE` | No schedule satisfies the constraints — with the unscheduled jobs and their reason codes |
| `TIMEOUT` | Solver hit its budget; partial result may exist, and it is labelled as partial |
| `STALE_SNAPSHOT` (409) | Data expired — go back and re-validate |
| Network failure | Retry, without losing the wizard |

A failed solve can be retried without abandoning the plan. That is an e2e-tested path, not an intention.

### Step 4 — Review Plan · `ReviewPlanScreen`

The primary workspace, and the screen the Excalidraw sessions in [`../reference/`](../reference/) were mostly about. Four regions:

```
┌──────────────────────────────────────────┬─────────────────┐
│ CORRIDOR OVERVIEW      (where)   [expand]│  JOB INSPECTOR  │
│  stations, sections, status per section  │  details        │
├──────────────────────────────────────────┤  why this time? │
│ WEEKLY TIMELINE        (when)    [expand]│  reason codes   │
│  section rows × day columns, Gantt bars  │                 │
├──────────────────────────────────────────┤  JOB ACTIONS    │
│ PLAN IMPACT            (worth)           │  lock / move /  │
│  closure ▾ · downtime ▾ · coverage       │  exclude        │
├──────────────────────────────────────────┼─────────────────┤
│ [Export Plan]              [Approve →]   │  GLOBAL ACTION  │
└──────────────────────────────────────────┴─────────────────┘
```

The layout answers four questions in a fixed order — **where**, **when**, **what it is worth**, **what you can do about it** — and the inspector is a persistent right rail rather than a modal so the planner never loses the plan while inspecting one job of it.

Selection is one shared `selectedJobId`. Clicking a bar in the timeline, a section on the map, or a row in the task table all drive the same value, and all three re-render from it. There is no per-component selection state to fall out of sync.

**Plan Impact** never shows a reduction without its coverage beside it. A 40% closure reduction achieved by refusing to schedule half the work is not a win, and the panel is built so that framing is impossible: scheduled vs. rejected maintenance minutes and job coverage sit next to every percentage. The comparison modal labels the baseline as **serial**, not as an alternative plan someone might have produced. Both facts are asserted by `e2e/kpi-honesty.spec.ts`.

### Step 5 — Approve Plan · `ApprovePlanStep`

Named reviewer plus a comment, then `POST /approve`. All five gate conditions from [decision 4](./02-design-decisions.md) must hold. The approval screen surfaces **unscheduled work**, not only the headline reduction — the planner signs for what was left out as well as what was placed.

On success → `PlanApprovedScreen`: export (CSV), print, or start a new version. Export before approval is refused by the backend and surfaced as an error, never silently swallowed.

---

## State machines

### Run state — server-owned

```
POST /planning-runs
      ├─► OPTIMAL ──┐
      ├─► FEASIBLE ─┼─► (validator) ─► approvable ─► APPROVED ─► exportable
      │             └─► INVALID ─► approval blocked
      ├─► INFEASIBLE ─► no schedule; show unscheduled + reasons
      ├─► TIMEOUT ────► partial, labelled
      └─► FAILED ─────► retry
```

`QUEUED` and `RUNNING` do not exist. They were in the original spec, ready for an async worker that was never built; the enum members were removed rather than left as states nothing could ever produce.

### Optimisation state — frontend-owned

```
UP_TO_DATE ──lock a job──► UNSAVED_CONSTRAINTS ──re-optimise──► REOPTIMIZING
     ▲                              ▲                                │
     └──────── new run loaded ──────┴────────── failed ──────────────┘
```

| State | Global panel | Approve | Timeline |
|---|---|---|---|
| `UP_TO_DATE` | Quiet | Enabled if valid | Normal |
| `UNSAVED_CONSTRAINTS` | Prominent warning | **Disabled**, with reason | Lock icons visible |
| `REOPTIMIZING` | Spinner | Disabled | Unlocked work shimmers; **locked work stays solid** |
| `FAILED` | Error + retry | Disabled | **Previous plan preserved** — never blanked |

### RapidBlock state

```
FORM_IDLE ──submit──► CANDIDATE_READY ──approve──► DISPATCH_SUCCESS
              ├─────► NO_CANDIDATE  ─┐
              └─────► REJECTED ──────┴──► back to FORM_IDLE (editable)
```

`REJECTED` always carries its reason code — `UNAUTHORISED_ACTOR`, `NO_ELIGIBLE_WINDOW`, `LOCK_CONFLICT`, `OUTSIDE_PLANNING_SCOPE` — because "request denied" without a cause is unusable to someone holding a real incident.

---

## Non-happy paths

Specified as first-class, not as an afterthought. Four global rules: never a blank screen, never a hidden error, never a silently disabled control, never fake progress.

- **Loading** — skeletons mirror the real layout, not a centred "Loading…".
- **Empty** — no jobs scheduled, no previous plans, and no job selected each get their own state with a next action.
- **Mid-workflow refresh** — the UI states that the plan is gone. It does not pretend to resume an in-memory run it cannot recover.
- **Backend outage** — surfaces an error and stays put; it never advances a step on fabricated data.

The last two are e2e-tested by name, in `e2e/foundation.spec.ts` and `e2e/failure-modes.spec.ts`.

---

## Responsive behaviour

Desktop-first (≥1280px) — this is a divisional-office tool on a large monitor. Below that the inspector becomes a bottom drawer and the KPI row scrolls horizontally. Mobile is supported, not optimised for; pretending otherwise would have cost layout quality on the screen the tool is actually used on.
