# RailNiyojan Frontend — Design Record

This folder is the **condensed design record** for the RailNiyojan planning desk UI: what we set out to build, the decisions we argued about, and how the shipped interface differs from the interface we first specified.

It replaces an earlier 17-document, ~3,600-line pre-implementation specification. That spec did its job — it was written *before* the UI existed, to let frontend work start in parallel with the backend — and then the build taught us things the spec got wrong. Rather than keep a spec that no longer matches the code, we condensed it into five documents and kept the disagreements visible.

| Document | What it holds |
|---|---|
| [01-product-and-users.md](./01-product-and-users.md) | The problem, the user, the domain vocabulary |
| [02-design-decisions.md](./02-design-decisions.md) | The eight decisions that shaped the UI, with rationale |
| [03-screens-and-states.md](./03-screens-and-states.md) | Every screen, flow, and state machine |
| [04-api-contract-map.md](./04-api-contract-map.md) | Each UI action → its endpoint, guard, and failure path |
| [05-spec-vs-shipped.md](./05-spec-vs-shipped.md) | What we planned, what shipped, what we cut and why |

Hand-drawn design artefacts from the Excalidraw sessions are in [`../reference/`](../reference/). They are the original source of the corridor-over-timeline layout and are worth looking at before reading 03.

---

## The one-paragraph version

RailNiyojan schedules railway maintenance across three departments that historically plan in isolation. The frontend's entire job is to make a constraint solver's output **reviewable by a human who is accountable for it**. That single framing produced every decision worth defending: the UI renders backend truth and never derives its own numbers; the solver's output is a *recommendation* that a named person signs; every disabled control explains itself; and no progress bar animates something the server is not actually doing.

---

## Why the design record reads the way it does

Three conventions we held to, because they are what made the spec useful rather than decorative:

**Uncertainty was written down, not smoothed over.** The original spec carried a dedicated open-questions document listing every missing endpoint and every assumption. Six gaps were named there before a line of the review screen was written. Four were later closed by backend work that the spec itself provoked — that traceable arc is preserved in [05-spec-vs-shipped.md](./05-spec-vs-shipped.md).

**Ownership boundaries were explicit.** The frontend/backend split in [02](./02-design-decisions.md) is not a style preference. In a system that recommends taking railway track out of service, "who owns this number" is a safety question, and we answered it per-field.

**The spec was allowed to be wrong.** Where the build contradicted the plan, the shipped code won and the document was corrected. Several confident recommendations in the original spec — a routing structure, a server-state library, a four-action job panel — did not survive contact with the implementation. They are recorded as reversals rather than quietly deleted.
