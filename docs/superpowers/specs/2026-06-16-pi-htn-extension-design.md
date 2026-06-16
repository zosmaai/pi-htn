# pi-htn — Design Spec (v0.1)

**Date:** 2026-06-16
**Status:** Approved design, pre-planning
**Author:** brainstormed with Arjun

## 1. Problem

The big model re-derives a plan every time a recurring task appears, and sometimes
gets it wrong. There is no way to capture a known-good plan once and replay it
deterministically. We want a pi extension that lets the big model **author a
reusable HTN domain from a session's tool-call trace**, validate it, store it, and
later **execute it deterministically** — delegating the narrow per-task work to a
small/local model.

The extension is **generic** (an HTN authoring + execution framework). Each
authored **domain is specific** (Tally triage for v0.1; flight/warehouse-class
domains later). HTN's value grows with domain complexity: symbolic world state,
method branching, and free symbolic backtracking are exactly where HTN beats
ad-hoc LLM planning.

## 2. Priorities (drive every tradeoff)

1. **Reliability / determinism** — an auto-authored domain that mis-decomposes is
   worse than none. Validation is a hard gate.
2. **Cost** — bulk token volume runs on the small/local model; the big model is
   used only at rare authoring moments.
3. **Capability** — HTN decomposition produces better multi-step plans than
   ad-hoc LLM planning.
4. **Reusability** — a growing library of replayable domains; pi gets measurably
   better at recurring tasks over time.

## 3. Core principle

**The LLM authors a plan as inspectable data; a trusted runtime executes it.**
We never execute LLM-authored code — only interpret LLM-authored *data* (YAML)
through a fixed, audited TypeScript runtime that compiles to GamePlanHTN.

## 4. Execution model

Mode **B** (harness-driven, small model fills gaps):

- The HTN owns **structure and ordering** — deterministic, cannot drift.
- Each primitive operator names an **exact tool**; the harness invokes it.
- The small model only supplies **arguments** or **summarizes/confirms** results
  via a constrained prompt. Low blast radius per step.

## 5. Architecture & data flow

```
pi session (user + tools)
      │  tool-call trace recorded
      ▼
[ /htn author ] ── big model reads trace ──▶ YAML domain (data, not code)
      │                                          │
      │                       validate: compile + offline decompose
      ▼                                          ▼
  ~/.pi-htn/domains/<name>.yaml  ◀── saved only if decomposition is sound
      │
[ /htn run <name> ]
      ▼
  Compiler: YAML ──▶ GamePlanHTN Domain
      ▼
  Planner.tick loop ──▶ primitive operator ──▶ pi tool (deterministic)
                               │                      │
                  small model fills args      emits checkpoint record
                  / confirms (mode B)         (world-state snapshot + step)
```

Five independently-testable components:

| Component | Responsibility |
|-----------|----------------|
| **Recorder** | Capture the tool-call trace of the current session. |
| **Author**   | Big-model prompt: trace → YAML domain (extracts reusable structure, branch predicates, observed failures). |
| **Validator**| Compile YAML + run **offline** decomposition (no tools fired) across synthetic world states. Reject + report if any branch fails to produce a plan. **Reliability gate.** |
| **Compiler** | YAML → GamePlanHTN `Domain` object. |
| **Executor** | Tick loop; binds primitives to pi tools; small model does per-task work; emits a checkpoint record per primitive. |

## 6. Domain schema

Declarative YAML — no closures, no code. Conditions/effects use a tiny predicate
DSL; operators bind a named tool + an optional small-model prompt.

```yaml
domain: tally-triage
worldState: { status: received, intent: null, replied: false }
root:
  type: select          # pick first method whose conditions pass
  tasks:
    - name: handle-spam
      conditions: [{ eq: [intent, spam] }]
      operator: { tool: tally.close, prompt: null }   # pure harness, no LLM
      effects:  [{ set: { replied: true } }]
    - name: handle-bug
      type: sequence
      conditions: [{ eq: [intent, bug] }]
      tasks:
        - name: open-ticket
          operator: { tool: linear.create, prompt: "Summarize the bug from {{body}}" }
          effects:  [{ set: { ticketId: "$result.id" } }]
        - name: reply
          operator: { tool: tally.reply, prompt: "Reply referencing ticket {{ticketId}}" }
          effects:  [{ set: { replied: true } }]
```

### Predicate DSL (v0.1 minimum)

- **Conditions:** `{ has: KEY }`, `{ not: <cond> }`, `{ eq: [KEY, VALUE] }`
- **Effects:** `{ set: { KEY: VALUE } }` where VALUE may be a literal or a
  `$result.*` / `{{worldStateKey}}` reference resolved at execution time.

### Compiler mapping (encodes known GamePlanHTN pitfalls)

- One **persistent `Planner`** instance across ticks (never `new Planner()` per tick).
- Effects compile to `EffectType.PlanAndExecute` so they fire at execution time,
  not only during planning.
- State mutation always via `ctx.setState` / `ctx.hasState`, never raw
  `WorldState.foo = …` (preserves rollback + dirty-replan).
- `select`/`sequence` map to GamePlanHTN selector/sequence compound tasks.

## 7. Authoring flow (`/htn author`)

1. Recorder provides the session tool-call trace.
2. Author prompt asks the big model to extract **reusable structure**: which steps
   are conditional, the branch predicates, and what failed and why.
3. Big model emits a YAML domain (Section 6 schema).
4. **Validator** compiles it and runs offline decomposition across a few synthetic
   world states. If any branch fails to yield a plan, the domain is **rejected and
   reported**, never saved. (This is the `plan:demo` discipline from the
   tally-harness, promoted to a gate.)
5. On success, write to `~/.pi-htn/domains/<name>.yaml`.

## 8. Execution flow (`/htn run <name>`)

0. `/htn run <name>` takes an **input payload** (e.g. a Tally submission). The
   payload seeds the initial `Context.WorldState` and is the source of
   `{{...}}` template references in operator prompts (e.g. `{{body}}`).
1. Compiler loads YAML → GamePlanHTN `Domain`.
2. Persistent `Planner` ticks the domain against a `Context`.
3. Each primitive: harness calls the named tool; if `prompt` is present, the small
   model fills arguments or summarizes the result; effects update world state.
4. On primitive failure, the planner replans (symbolic, no LLM) and picks an
   alternative branch — HTN's native restore-history backtracking.
5. Each primitive execution **emits a checkpoint record**: world-state snapshot +
   the small-model call + tool result, linked to a session-tree node id. v0.1
   only *writes* these; it does not fork or retry from them.

## 9. The three trees (design constraint: link, never unify)

1. **Session tree** — pi events linked by `parentId` (verified: every entry has
   `id` + `parentId`). State space = tokens/messages. Backtracking here is
   expensive.
2. **HTN domain tree** (static) — compound → methods → subtasks.
3. **HTN decomposition tree** (dynamic) — planner DFS + `WorldStateChangeStack`
   restore history. State space = symbolic world state. Backtracking here is
   nearly free (no LLM).

**HTN already provides backtracking, and it is strictly better than session-tree
backtracking** because it operates in symbolic world-state space. We therefore do
not embed the HTN in the session tree. Instead each HTN primitive **references**
the session node where it executed (`htnNode.sessionNodeId`). Two state spaces
that reference each other — never one tree pretending to be both.

## 10. v0.1 scope

**In scope**

- `/htn author` (explicit, command-driven) and `/htn run <name>`.
- YAML domains on disk at `~/.pi-htn/domains/`.
- Predicate DSL (Section 6 minimum).
- YAML → GamePlanHTN compiler with pitfalls encoded.
- Validator offline-decomposition gate.
- Mode-B execution; small model fills per-task gaps.
- Checkpoint records emitted per primitive (write-only; carries `sessionNodeId`).
- Tally triage domain working end-to-end as the acceptance case.
- TypeScript extension consuming GamePlanHTN (JS) as the planner runtime.

**Out of scope (→ v0.2+)**

- Automatic observation / auto-authoring (blackhole-style passive watching).
- Checkpoint-retry: forking a checkpoint node to re-run one primitive; parallel
  N-way small-model retries with effect-validation selection (MCTS/beam over
  execution).
- HTN selection/matching ("which stored domain fits this new task").
- Domain-slot splicing; multi-domain library retrieval.

## 11. Acceptance criteria (v0.1)

1. From a real Tally-triage session trace, `/htn author tally-triage` produces a
   YAML domain that passes the Validator.
2. A deliberately broken domain (a branch with no satisfiable method) is
   **rejected** by the Validator and never written.
3. `/htn run tally-triage` executes end-to-end against a sample submission,
   delegating per-task language work to the small model, with deterministic
   structure/ordering.
4. A forced tool failure on one primitive triggers HTN replan to an alternative
   branch (no big-model call).
5. Each executed primitive writes a checkpoint record carrying a `sessionNodeId`.

## 12. Open questions for planning

- Exact pi-extension API surface for registering `/htn` commands and tapping the
  tool-call trace (Recorder integration point).
- Tool registry shape: how `operator.tool` names resolve to callable pi tools.
- Small-model client (reuse llama.cpp OpenAI-compat pattern from tally-harness).
- Checkpoint record storage location and schema (separate file vs session-tree
  custom event).
