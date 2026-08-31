# 05 — Spec vs. Shipped

The original specification carried a dedicated open-questions document. It named six missing backend endpoints and several data gaps **before** the review screen was built, on the rule that uncertainty gets written down rather than discovered later.

Naming them early is what made them fixable. Four of the six were closed by backend work the spec itself provoked.

## The six gaps, and what happened

| # | Gap named in the spec | Outcome |
|---|---|---|
| 1 | No **list planning runs** endpoint — "View Previous Plans" had nothing to call | **Closed.** `GET /planning-runs` was added, returning archive rows without the schedule payload. The archive reopens real backend runs, e2e-tested. |
| 2 | No **snapshot entities** endpoint — the emergency form could not populate its dropdowns | **Worked around.** Sections derive from `run.jobs[].section_id`; corridor presets supply station geometry. No new endpoint. |
| 3 | No **unlock** endpoint — an accidental lock was unrecoverable | **Open.** Locks are re-declared per replan rather than deleted. A planner who locks wrongly still has no single-click undo. Named here rather than quietly dropped. |
| 4 | No **find alternative** endpoint for a single job | **Cut.** Building a per-job solver path was not worth the scope. Rather than ship a permanently disabled "Coming soon" button, the fourth job action was removed. |
| 5 | No **exclude job** endpoint | **Closed differently.** Instead of a dedicated endpoint, exclusion became part of the replan *intent* payload the backend validates — a better shape than the one the spec asked for. |
| 6 | No **share with teams** mechanism | **Cut.** No sharing backend exists. The tile was removed rather than faked. |

Gap 5 is the one worth dwelling on. The spec asked for `POST /planning-runs/{id}/jobs/{job_id}/exclude`. What shipped was better: exclusions and window moves both became *review intent* carried into the replan call, validated server-side, with refused edits returned as `rejected_intent_edits`. One mechanism instead of two endpoints, and it made "the planner's edits are pending until the solver honours them" enforceable by the backend rather than merely styled by the UI.

## Assumptions that did not survive

| Spec assumed | Reality |
|---|---|
| Backend would move to an async worker; UI would poll `QUEUED`/`RUNNING` | Solve stayed synchronous. The worker stub and both enum members were deleted rather than left as dead states. |
| Job location as a km range in the inspector | Never in the contract. The inspector shows section + asset — an honestly derived label, not an invented km marker. |
| Validation issues would carry auto-fixable suggestions | The backend rejects or accepts. Fix controls were removed entirely. |
| Monthly planning would be a second optimiser | It is a 30-day date filter over the same solver, and the UI says so. |

## What shipped that the spec never anticipated

- **RailRadar live train lookup** — real running status for a train number, proxied and cached by our own backend, shown as planner context and explicitly never a planning input.
- **Corridor map** — a real Leaflet map with station geography, alongside the schematic corridor view.
- **KPI honesty panel** — coverage beside every reduction, and a comparison modal that labels the baseline as *serial*. This came out of realising the headline number was gameable by scheduling less work.
- **Prohibited-language test** — an e2e spec that fails the build if railway-authority vocabulary appears anywhere in the workflow. The safety boundary in [01](./01-product-and-users.md) is enforced by CI, not by discipline.

## Still open

Stated plainly, because a closing section that lists only wins is worth nothing to the next person reading it.

- **No unlock.** Gap 3 above.
- **No authentication.** RapidBlock checks a server-side planner allowlist; there is no identity system behind it.
- **Default storage is process-local.** Durable mode needs `STORE_BACKEND=sql` and a migrated Postgres. A refresh mid-workflow loses the run — the UI says so rather than pretending to resume.
- **One corridor, controlled inputs.** No live TMS / SMMS / TDMS adapters.
- **Weekly only.** Monthly is a filter, not a planning tier.
