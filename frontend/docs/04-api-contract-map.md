# 04 — API Contract Map

Every UI action, its endpoint, its guard, and its failure path. All calls go through `apps/web/src/lib/api.ts` — the frontend never constructs a raw `fetch` elsewhere. Base URL: `NEXT_PUBLIC_API_URL`.

Types in `apps/web/src/lib/api-schema.ts` are **generated** from the backend's OpenAPI document (`make openapi`). They are never hand-edited: the Pydantic contract is the single source, and drift between the two is a build failure rather than a runtime surprise.

---

## Action → endpoint

| UI action | Endpoint | Guard before calling | On success |
|---|---|---|---|
| Check Data | `POST /datasets/validate` | ≥1 department loaded | Store snapshot candidate + source hash |
| Create Plan | `POST /planning-runs` | `snapshot_candidate_id !== null` | Fetch run detail, go to Review |
| Load / refresh plan | `GET /planning-runs/{id}` | — | Render the whole review desk |
| Lock job | `POST /planning-runs/{id}/lock` | Job scheduled, not locked, plan not approved | Refetch run; mark plan dirty |
| Move / exclude job | (queued as review intent) | Plan not approved | Held as **pending** until re-optimise |
| Re-optimise | `POST /planning-runs/{id}/replan` | — | **New `run_id`** → fetch it → clear dirty |
| Approve | `POST /planning-runs/{id}/approve` | All five gate conditions | Refetch → Approved screen |
| Export CSV | `GET /planning-runs/{id}/export` | `run.export_ready === true` | Download `{run_id}.csv` |
| Previous plans | `GET /planning-runs` | — | Archive rows (no schedule payload) |
| Emergency inject | `POST /rapidblock-requests` | Base run selected, form valid | Cascade impact panel |
| Emergency detail | `GET /rapidblock-requests/{id}` | — | Changed + preserved-locked jobs |
| Live train context | `GET /railradar/trains/{no}/live` | — | Advisory panel only — **never a planning input** |

Two properties of this table are deliberate:

**Replan returns a new run.** Not a mutation. The frontend must adopt the returned `run_id` and refetch; the previous run stays in the archive exactly as it was. This is what makes "reopen the plan that was approved" a truthful operation.

**Move and exclude are not endpoints.** They are *review intent*, held client-side as pending edits and sent with the replan call. The backend validates the intent, applies what it can, and returns `rejected_intent_edits` for what it refused. The UI shows the edits as pending — never as applied — until a re-optimisation actually returns them. A run with unapplied edits cannot be approved.

---

## Mutation → refetch

Every mutation is followed by an explicit read. There is no cache to invalidate and nothing is inferred from the mutation response.

| Mutation | Refetch |
|---|---|
| `POST /planning-runs` | `GET /planning-runs/{new_id}` |
| `POST /{id}/lock` | `GET /planning-runs/{id}` |
| `POST /{id}/replan` | `GET /planning-runs/{new_id}` ← **new id** |
| `POST /{id}/approve` | `GET /planning-runs/{id}` |
| `POST /rapidblock-requests` | `GET /rapidblock-requests/{request_id}` |

---

## Error codes → planner-facing messages

The backend returns `{ code, message }`. The frontend translates the code; it does not invent new failure semantics.

| Code | Message |
|---|---|
| `STALE_SNAPSHOT` | Planning data has expired — re-upload the dataset |
| `SNAPSHOT_NOT_FOUND` | Dataset not found — validate before creating a plan |
| `RUN_NOT_FOUND` | Planning run not found |
| `INVALID_RUN_STATE` | Not allowed in the current plan state |
| `ALREADY_APPROVED` | Already approved — refresh and redirect |
| `SAFETY_VALIDATION_FAILED` | Independent safety validation did not pass; cannot approve |
| `EXPORT_BLOCKED` | Export requires an approved, feasible, validated run |
| `UNAUTHORISED_ACTOR` | Not authorised for this action |
| `NO_ELIGIBLE_WINDOW` | No available maintenance window for this job |
| `LOCK_CONFLICT` | Conflicts with a locked schedule item |
| `OUTSIDE_PLANNING_SCOPE` | Outside the current snapshot's boundaries |

| HTTP | Handling |
|---|---|
| 400 / 422 | Inline validation error |
| 403 | "Not authorised" — no login redirect; there is no auth system, and faking one would be worse |
| 404 | Not-found state with a way back |
| 409 | Usually stale UI — show the specific code, offer refresh |
| 500 / network | Toast with retry; current view preserved |

A 409 is treated as expected, not exceptional. The frontend guards these transitions for UX, but the backend is the enforcer, and the UI is written assuming its own guard can be wrong.
