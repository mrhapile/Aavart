# 02 — Design Decisions

Eight decisions shaped this interface. Each is stated with the alternative we rejected, because a decision without a rejected alternative is just a description.

---

## 1. The backend owns every operational number

**Decision.** The frontend renders backend values. It does not compute, derive, or second-guess them.

**Rejected.** Deriving KPIs client-side from `schedule_items`. It would have worked, and it would have been a lie the first time the two disagreed.

In a system that recommends closing railway track, "who owns this number" is a safety question. So it is answered per field, not as a slogan:

| Field | Owner | Frontend's only job |
|---|---|---|
| `run.kpis.*` | Backend | Format and display |
| `run.state` (`OPTIMAL` / `FEASIBLE` / …) | Backend | Map to a badge |
| `run.export_ready` | Backend | Enable/disable the export control |
| `run.validator.passed` | Backend | Gate the approve control |
| `schedule_item.locked` | Backend | Render the lock icon |
| `reason_codes` | Backend | Map code → human label. **No further interpretation.** |

The frontend owns exactly three things: what is selected, what is in flight, and what the user has typed but not yet submitted.

**Consequence we accepted.** Every mutation is followed by a refetch, and the UI is briefly stale rather than optimistically wrong. For lock, replan, approve, and export, that is the correct trade.

---

## 2. Pessimistic updates everywhere

**Decision.** No optimistic UI. Wait for the server, then render what it says.

**Rejected.** Optimistic lock/approve for snappiness.

An optimistically-unlocked Export button is a safety violation, not a UX improvement. The same argument applies to lock (the UI must reflect the *actual* lock state the solver will honour) and approve (an approval that did not persist is worse than a slow one).

---

## 3. Never animate progress the server is not making

**Decision.** The solver runs synchronously inside the API request. The Create Plan screen advances a checklist on a timer *and holds the final item until the request actually resolves*. There is no percentage.

**Rejected.** A "72%" progress bar. There is no server-side progress to report — the number would have been fabricated, and fabricating a number in a system whose entire pitch is trustworthy numbers is self-defeating.

This is codified as a global rule in the UI: **never show fake progress**, alongside *never show a blank screen*, *never hide an error*, and *never disable a control silently*.

---

## 4. Every disabled control explains itself

**Decision.** A disabled button always carries the reason it is disabled.

**Rejected.** Hiding unavailable actions. Hiding teaches the planner nothing; a greyed *Approve Plan* reading "Plan has unsaved constraints — re-optimise first" teaches them the model.

This matters most at the two gates:

```
approveEnabled = state ∈ {FEASIBLE, OPTIMAL}
               ∧ validator.passed
               ∧ approval === null
               ∧ no pending review edits

exportEnabled  = run.export_ready          // backend-computed, never re-derived
```

The frontend guards these for good UX. The backend enforces them for real, and returns `409` if the guard was wrong — which the UI handles rather than assuming cannot happen.

---

## 5. Validation is a gate, not a form

**Decision.** Step 2 shows what the backend accepted or rejected, and offers **no control that can change that verdict**. If validation fails, the only path forward is back to Step 1 to fix the source data and re-upload.

**Rejected — and this one we shipped and then removed.** The first Check Data screen had *Mark as Resolved* and *Auto-Fix All* buttons. They flipped local state only. The backend had already refused the dataset and would refuse it again; the buttons let a planner walk a rejected dataset toward the solver believing they had fixed something. They were deleted, and the gate now keys off one fact — whether the backend registered a snapshot candidate — so the button and the solver can never disagree.

This is the decision we are most confident about, because we got it wrong first.

---

## 6. Job actions and plan actions are visually separate

**Decision.** Actions on the selected job (lock, move window, exclude) live in the right-hand inspector. Actions on the whole plan (re-optimise, approve, export) live in a distinct global panel.

**Rejected.** One action bar. The two have different blast radii: locking one job is reversible by re-optimising; approving the plan is a signature. Putting them in one row invites the wrong click.

---

## 7. Locking makes the plan *dirty*, and dirty blocks approval

**Decision.** A frontend-only concept. Locking a job does **not** re-optimise. It sets a pending-constraints state that visibly blocks approval until the planner re-optimises.

**Rejected.** Auto-replanning on every lock. Locking three jobs would have triggered three solves and shuffled the plan under the planner between clicks.

During re-optimisation, unlocked work shimmers and **locked jobs stay solid** — the animation is the explanation: the solver is working around your anchors.

Backend-enforced, not merely styled: pending review edits are carried as an *intent* the backend validates, and a run with unapplied edits cannot be approved. An e2e test asserts this.

---

## 8. Replan creates a new run, and the UI follows it

**Decision.** `POST /replan` returns a **new `run_id`**. The frontend switches its active run to the new one. Old runs stay readable in the archive.

**Rejected.** Mutating the current run in place. An immutable run history is what makes the audit trail meaningful — you can reopen exactly what was approved, not what it later became.

---

## Reversals

Recorded because a design record that only lists decisions that survived is a marketing document.

| Original spec said | What shipped | Why |
|---|---|---|
| URL routing (`/plan/new`, `/plan/:id`, `/emergency`) | Single-page view state | Deep-linking to an in-memory run would produce dead links. A refresh honestly reports the plan is gone rather than pretending to resume. |
| Add TanStack Query for server state | Plain `fetch` through one `api.ts` client | With every mutation followed by an explicit refetch, the cache layer earned nothing but a dependency. |
| Four job actions incl. *Find Alternative* | Three: Lock, Change Window, Exclude | *Find Alternative* needed a per-job solver endpoint that was never built. A permanently-disabled "Coming soon" button is clutter that lies about the roadmap, so it was cut. |
| `feature/`-based directory layout | `components/` by screen area | The feature folders were a guess made before the screens existed; the shipped grouping follows the actual UI. |
| Validation issues offer auto-fix | No fix controls at all | See decision 5. |
