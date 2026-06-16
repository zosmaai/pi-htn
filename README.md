# pi-htn

Author **reusable HTN domains** from a pi session's tool-call trace, validate them with an
offline decomposition gate, and replay them deterministically — delegating only the narrow
per-task language work to a small/local model.

> Stop the big model from re-deriving (and sometimes botching) the same multi-step task.
> Capture the plan **once** as inspectable data; replay it reliably from then on.

## Why

Priorities, in order: **Reliability > Cost > Capability > Reusability.**

- **Reliability** — the LLM authors a plan as **YAML data**, never code. A trusted TypeScript
  runtime executes it. An offline *validator* proves a domain decomposes soundly before it can
  be saved.
- **Cost** — the big model authors *once* (rare); a small/local model fills per-task arguments
  on *every* replay (cheap). One expensive planning call, many cheap execution calls.
- **Capability** — HTN decomposition + symbolic backtracking beats ad-hoc LLM planning on
  multi-step, branching tasks (the classic flight/warehouse-style domains).
- **Reusability** — domains persist under `~/.pi-htn/domains/` and compound over time.

This design is independently validated by **Tree-Planner** (arXiv:2310.08582): separating one
plan-sampling call from many grounded-execution calls cut tokens ~92% and error-corrections ~40%.
See `docs/superpowers/specs/` for the full design and the ToT-vs-HTN positioning.

## Commands

- `/htn author <name>` — read the current session's tool-call trace, ask the big model for
  **N candidate** YAML domains, validate each through the offline gate, and save the best
  **passing** one (best-of-N; the symbolic validator is the hard gate).
- `/htn run <name> [input]` — compile the stored YAML to a GamePlanHTN domain, plan, and execute
  each primitive: the harness calls the bound tool deterministically; the small model only fills
  arguments / confirms (execution **mode B**).
- `/htn list` — list stored domains.

## Domain schema (YAML, data — never code)

```yaml
domain: tally-triage
worldState: { status: received, intent: null, replied: false }
root:
  type: select            # select = first valid branch; sequence = all in order
  tasks:
    - name: handle-spam
      conditions: [{ eq: [intent, spam] }]
      operator: { tool: tally.close }
      effects:  [{ set: { replied: true } }]
    - name: handle-bug
      type: sequence
      conditions: [{ eq: [intent, bug] }]
      tasks:
        - name: open-ticket
          operator: { tool: linear.create, prompt: "Summarize the bug from {{body}}" }
          effects:  [{ set: { ticketId: "$result.id" } }]   # capture tool output
        - name: reply
          operator: { tool: tally.reply, prompt: "Reply referencing ticket {{ticketId}}" }
          effects:  [{ set: { replied: true } }]
```

- **Predicate DSL:** `{ eq: [key, value] }`, `{ has: key }`, `{ not: <predicate> }`.
- **Effects:** `{ set: { key: literal } }`, or `{ set: { key: "$result.<path>" } }` to bind a
  tool result into world state.
- **Templates:** `{{key}}` in a prompt/arg is rendered from world state at execution time.

## Architecture

```
session trace ──▶ /htn author ──▶ big model: N candidate YAML domains
                                       │  validate each (offline decomposition gate)
                                       ▼
                          ~/.pi-htn/domains/<name>.yaml  (best passing candidate)
                                       │
session ──▶ /htn run ─────────────────┘
   compile YAML ──▶ GamePlanHTN Domain ──▶ findPlan (plan + symbolic backtracking)
                                       │
              async Executor: for each primitive ──▶ bound pi tool (deterministic)
                                       │  small model fills args (mode B)
                                       ▼  apply effects, replan on failure (circuit breaker)
              checkpoint record per step ──▶ links to session-tree node (v0.2 retry seam)
```

Components: **Recorder** (trace) · **Author** (best-of-N prompt + gate) · **Validator**
(reliability gate) · **Compiler** (YAML→Domain) · **Executor** (async run loop) ·
**Checkpoints** (session-tree link) · **Logger** (`~/.pi-htn/logs/`).

GamePlanHTN is vendored under `vendor/gameplanhtn/` and used purely as the planner/backtracker;
the async execution loop is our own (its operators are synchronous).

## Develop

```bash
npm install
npm test        # vitest, fully offline (deterministic core needs no live model)
npm run typecheck
```

## Roadmap (v0.2, not built here)

Auto-observation / auto-authoring; checkpoint-retry + parallel small-model search; HTN
selection/matching + vector-db retrieval by task similarity; LLM advisory candidate scoring;
**merge candidates into one action tree** (Tree-Planner style) instead of best-of-N
select-and-discard.
