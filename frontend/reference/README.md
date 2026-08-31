# Design Artefacts

The hand-drawn Excalidraw work that the RailNiyojan interface was designed from. These came before the code, and the shipped screens in `apps/web/src/components/` still follow their structure.

Read them alongside [`../docs/03-screens-and-states.md`](../docs/03-screens-and-states.md), which describes what each of these became.

---

## Complete UI flow

![Complete UI Flow](./Complete_UI_Flow.png)

The whole application as one board: home, the five wizard steps, the review desk, approval, and the emergency branch. This is where the decision to keep RapidBlock *off* the wizard stepper was made — it modifies an already-approved plan, so it is drawn as a separate entry point rather than a sixth step.

## Home screen

![Home Screen Reference](./homepage-reffrence.png)

Three paths, no dashboard. A planner arriving at this tool is doing one of exactly three things — starting a plan, reviewing an old one, or reacting to an incident — and the home screen refuses to be anything more than that choice.

## Emergency blocking flow

![Emergency Blocking Flow](./emergency-blocking-flow.png)

The RapidBlock decision path end to end, including the rejection branches. Every terminal state here carries a reason, which is why `REJECTED` in the shipped UI always names its code rather than just refusing.

## Rapid block interface

![Rapid Block Interface](./rapidBlock.png)

The two-panel emergency layout: incident form on the left, corridor map and cascade impact on the right. The planner sees what their injection costs the existing plan before they commit to it.

## Rapid block resolve

![Rapid Block Resolve](./rapidBlockResolve.png)

The confirmation step — changed jobs, preserved locked jobs, and the dispatch decision.
