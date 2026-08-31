# SIH26027 Hackathon Deviation Plan

Sources: [SIH26027 Detailed Technical Architecture PDF](./SIH26027_Detailed_Technical_Architecture.pdf) and [Risk Review](./risk-review-and-hackathon-deviation.md).

## Alignment Split

Approximate architectural split:

- **75% aligned with the PDF:** canonical model, validation pipeline, snapshots, compatibility rules, CP-SAT optimization, explanations, planner review, locks, re-optimization, audit trail and the decision-support purpose.
- **25% intentionally changed or simplified:** data adapters, corridor scope, ML usage, planning horizon, ruleset scope, sanctioning integration, deployment scale, emergency replanning scope and export guardrails.

This is an architecture estimate, not a code-size or feature-count measurement.

## Deviations

### 1. Real Railway Adapters -> Controlled CSV/JSON Input

- **PDF plan:** Integrate TMS, SMMS, TDMS, COA, Train Time Table and later BDMS through isolated adapters.
- **Our hackathon plan:** Use controlled CSV/JSON snapshots that follow the canonical data contract.
- **How much it differs:** High at the integration boundary; low in downstream planning logic.
- **Why we are changing it:** The PDF explicitly allows FileAdapters for the prototype, while real interfaces and authoritative fields still require validation.
- **Risk or complexity avoided:** Unverified interface assumptions, credentials, source conflicts, mapping errors and integration delays.
- **Decision:** Temporary for SIH. The adapter contract remains the production path.

### 2. Full Railway Topology -> One Small Explicit Corridor

- **PDF plan:** Model nodes, sections, conflict groups, isolation zones and train-path projections across a Railway corridor.
- **Our hackathon plan:** Model one small corridor with explicit sections, conflicts, isolation zones and train paths.
- **How much it differs:** High in geographic scope; low in topology behavior.
- **Why we are changing it:** The core value can be demonstrated on one reproducible corridor without inventing Railway-wide master data.
- **Risk or complexity avoided:** Large data preparation, ambiguous section mappings and optimizer scale problems.
- **Decision:** Temporary for SIH.

### 3. ML-First Priority/Duration -> Deterministic Rules First, ML Optional

- **PDF plan:** Support priority/risk and duration services using ML where historical data justifies it, with deterministic fallback.
- **Our hackathon plan:** Use deterministic priority, duration bounds and buffers first; keep ML optional and non-blocking.
- **How much it differs:** Medium in intelligence implementation; low in service contract and fallback behavior.
- **Why we are changing it:** The PDF requires historical actuals and evaluated models only where available. The hackathon does not have proven Railway training data.
- **Risk or complexity avoided:** Unsupported model claims, missing labels, unpredictable inference and false confidence in scores.
- **Decision:** Temporary emphasis for SIH. Deterministic fallback remains a permanent design requirement.

### 4. Weekly + Monthly Planning -> Weekly Planning Only

- **PDF plan:** Monthly planning reserves capacity and preferred windows; weekly planning expands them into detailed executable candidate blocks.
- **Our hackathon plan:** Implement detailed weekly planning only.
- **How much it differs:** Medium in planning horizon; the weekly optimizer remains aligned.
- **Why we are changing it:** Monthly planning adds another planning layer without improving proof of the core vertical slice.
- **Risk or complexity avoided:** Conflicting monthly and weekly objectives, soft reservation logic and an incomplete long-range workflow.
- **Decision:** Temporary for SIH.

### 5. Full Configurable Railway Rule Library -> Fixed Visible `Demo Ruleset v1`

- **PDF plan:** Store compatibility, safety, objective weights, duration bounds, topology and approval rules as versioned configuration artifacts.
- **Our hackathon plan:** Implement a small fixed ruleset that is visible in the UI and named `Demo Ruleset v1`.
- **How much it differs:** Medium in breadth; versioning and reason codes remain.
- **Why we are changing it:** Exact legal block, isolation, setup/restoration and simultaneous-work rules still require Railway validation.
- **Risk or complexity avoided:** Hiding unverified assumptions inside code and producing a falsely authoritative plan.
- **Decision:** Fixed scope is temporary for SIH. Versioned rule governance is permanent.

### 6. BDMS/Sanction Workflow -> Recommendation + Human Approval + Export Only

- **PDF plan:** Produce candidate plans for planner review and support a future BDMS handoff after exact write semantics are validated.
- **Our hackathon plan:** Produce a recommendation, require human review/approval, then allow CSV/PDF export only.
- **How much it differs:** High at the operational handoff boundary; low in planner review and approval behavior.
- **Why we are changing it:** The PDF keeps sanctioning under authorized Railway workflows and lists BDMS semantics as an open validation item.
- **Risk or complexity avoided:** Treating a solver result as legal authority or writing an unverified payload into BDMS.
- **Decision:** No BDMS integration is temporary for SIH. Human approval before export is a permanent design decision.

### 7. Broad Production Deployment -> Single-Host Prototype

- **PDF plan:** Use Docker Compose for SIH, with a path to multiple workers, HA database, identity integration and controlled deployment.
- **Our hackathon plan:** Run the web/API, database and one optimizer worker on a single host.
- **How much it differs:** High in deployment scale; low in logical service boundaries.
- **Why we are changing it:** The PDF itself identifies single-host Docker Compose as the SIH deployment level.
- **Risk or complexity avoided:** Kubernetes, HA, networking, secrets and operational infrastructure work that does not prove planning value.
- **Decision:** Temporary for SIH.

### 8. Full-Scale Emergency Replanning -> Replan Only Unlocked/Affected Jobs

- **PDF plan:** Create a delta snapshot, identify the affected region, lock accepted unaffected blocks and replan where possible.
- **Our hackathon plan:** Replan only the affected corridor/time region and unlocked jobs; keep accepted locks fixed.
- **How much it differs:** Medium in scope; the lock-and-replan principle is retained.
- **Why we are changing it:** A full network emergency model requires broader topology, live feeds and cross-boundary coordination that the SIH prototype does not have.
- **Risk or complexity avoided:** Uncontrolled plan churn, hidden cross-corridor dependencies and a false claim of network-wide emergency handling.
- **Decision:** Restricted scope is temporary for SIH. Preserving locked decisions is a permanent design principle.

### 9. Solver Output Trusted Directly -> Stronger Validation Before Export

- **PDF plan:** Persist the best feasible solution, calculate KPIs, attach explanations and apply approval policies for degraded or suboptimal runs.
- **Our hackathon plan:** Add an independent post-solve validator and block export when safety checks, data quality or solver status fail.
- **How much it differs:** Low in architecture; stronger in enforcement.
- **Why we are changing it:** A solver can satisfy only the constraints that were encoded. A `FEASIBLE` result is not proof of optimality or operational validity.
- **Risk or complexity avoided:** Exporting an invalid, degraded or weakly understood plan.
- **Decision:** Permanent design decision.

## Why We Are Not Deviating More

Too much simplification would weaken alignment with the SIH problem statement. The implementation must still demonstrate:

- Multi-department maintenance planning.
- Asset and section availability.
- Train-path and corridor constraints.
- Explainable prioritization and scheduling.
- Weekly block optimization.
- Planner review, locks and re-optimization.

Removing these would turn the project into a generic scheduling demo instead of an SIH26027 solution.

## What Stays Exactly The Same

- Canonical railway planning data model.
- Source normalization and validation concepts.
- Immutable planning snapshots.
- Compatibility and safety logic.
- CP-SAT constraint optimization.
- Priority and duration outputs as inputs to scheduling, not replacements for constraints.
- Planner review and human-in-the-loop operation.
- Locks, rejects and re-optimization.
- Explainability through reason codes and alternatives.
- Auditability, lineage, configuration versions and run history.
- Fail-safe behavior for stale data, unavailable ML, solver timeout and infeasibility.

## Final Decision

We are narrowing and hardening the PDF architecture for SIH, not replacing it.
