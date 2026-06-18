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

Press **Tab** after `/htn ` to autocomplete subcommands, setting keys (`/htn settings →`),
and stored domain names (`/htn run →`, `/htn watch <pr> →`).


- `/htn author <name>` — read the current session's tool-call trace, ask the big model for
  **N candidate** YAML domains, validate each through the offline gate, and save the best
  **passing** one (best-of-N; the symbolic validator is the hard gate).
- `/htn run <name> [input]` — compile the stored YAML to a GamePlanHTN domain, plan, and execute
  each primitive: the harness calls the bound tool deterministically; the small model only fills
  arguments / confirms (execution **mode B**). Operators with an `exec:` block run for **real**
  via `pi.exec()`; operators without one fall back to a safe **dry-run** echo (mixed domains OK).
  The run notice reports the mode (`live` / `dry-run` / `live: <tools>`).
- `/htn watch <prNumber> [domain]` — watch a PR and **heal its CI until merge-ready** (see below).
- `/htn settings` — open a panel to set the model endpoint, default domain, heal rounds, and poll
  interval (persisted to `~/.pi-htn/config.json`). Non-interactive forms: `/htn settings show`,
  `/htn settings reset`, `/htn settings <key> <value>` (keys: `modelBase model maxRounds pollSeconds domain`).
- `/htn list` — list stored domains.

## Self-learning PR watcher (v0.2)

> **Every time a PR is raised, watch it and fix the actions until it's ready to merge.**

`/htn watch <pr>` (in-session) or the headless `pi-htn-watch` CLI (cron/CI) runs this loop:

```
read `gh pr checks` ──▶ green/none ─▶ merge-ready ✓
        │
        ├─ pending ─▶ wait (poll) ─▶ re-check
        │
        └─ red ─▶ classify failure ─▶ run repair-ladder HTN ─▶ push fix ─▶ re-check
                       │
                       │   the HTN backtracks ACROSS rounds: each tried rung is
                       │   excluded via `tried_<id>`, so the planner climbs to the
                       │   next rung until checks go green or the budget is
                       │   exhausted → escalate to a human
                       ▼
              record outcome to the playbook  ◀── self-learning memory
```

**Self-learning.** Every `{failureClass → strategy → ok}` outcome is appended to
`~/.pi-htn/playbook.jsonl`. The watcher ranks strategies per failure class by smoothed success
rate and **tries the historically-best one first** — the more PRs it heals, the faster it
converges. It *uses* what it learns automatically; no re-training, just inspectable data.

**Reusable, per-repo domains.** The repair ladder resolves most-specific-first:
`<repo>/.pi-htn/<name>.yaml` → your global store → the shipped built-in `pr-ci.yaml`. Drop a
`.pi-htn/pr-ci.yaml` into any repo to give it project-specific repair rungs; the ladder travels
with the repo.

```bash
npx pi-htn-watch --repo /path/to/repo --pr 123          # one PR
npx pi-htn-watch --repo /path/to/repo --all             # every open PR, once
npx pi-htn-watch --repo /path/to/repo --all --interval 60   # poll forever / cron
```

## Model endpoint (runs off your laptop)

Inference defaults to the shared **Zosma devserver** so it never cooks the local machine:

```
PI_HTN_MODEL_BASE   default http://devserver.zosma.ai:8010/v1
PI_HTN_MODEL        default qwopus-coder-9b
```

Override per-process with those env vars, or `--base` / `--model` on any runner. The `/htn settings`
panel persists the same values (plus default domain / heal rounds / poll interval) to
`~/.pi-htn/config.json`. Resolution precedence is **env var > saved settings > built-in default**
(`src/config.ts`, `src/settings.ts`).

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
- **Templates:** `{{key}}` in a prompt/arg/exec-arg is rendered from world state at execution time.
- **Real execution:** add `exec: { cmd, args }` to an operator to run a deterministic shell
  command. Each arg is interpolated against `{ ...worldState, ...promptFilledArgs }` (args win).
  Stdout that is a JSON object is exposed to `$result.<field>` effects; a non-zero exit throws
  so the executor replans (and trips the circuit breaker after `maxReplans`). Example:

  ```yaml
  - name: bump
    operator:
      tool: bump
      exec: { cmd: bash, args: ["-c", "echo {{item}} >> ~/tally.log && wc -l < ~/tally.log"] }
    effects: [{ set: { total: "$result.total" } }]
  ```

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

## Visual docs

Interactive, offline-playable docs live in [`docs/lumen/`](docs/lumen/) — see the
[**index**](docs/lumen/README.md) for all of them.

| Doc | Rendered |
|---|---|
| 🗂️ **Gallery** — landing page for every visual doc | [Pages](https://zosmaai.github.io/pi-htn/lumen/) · [preview](https://htmlpreview.github.io/?https://github.com/zosmaai/pi-htn/blob/main/docs/lumen/index.html) |
| 🏛️ **System Architecture** — 6 tabs, 6 subsystem diagrams, the 3 domains, fact-check | [Pages](https://zosmaai.github.io/pi-htn/lumen/architecture.html) · [preview](https://htmlpreview.github.io/?https://github.com/zosmaai/pi-htn/blob/main/docs/lumen/architecture.html) |
| 🎞️ **Decomposition & LLM Artifacts** — 18-slide deck on the HTN trees + 3 inference artifacts | [Pages](https://zosmaai.github.io/pi-htn/lumen/decomposition-slides.html) · [preview](https://htmlpreview.github.io/?https://github.com/zosmaai/pi-htn/blob/main/docs/lumen/decomposition-slides.html) |

> Clicking an `.html` file on GitHub shows **source**, not the rendered page. Use a **Rendered** link.
> *Pages* links activate once GitHub Pages is enabled (`Settings → Pages`); *preview* links work immediately.

## Develop

```bash
npm install
npm test        # vitest, fully offline (deterministic core needs no live model)
npm run typecheck
```

## Roadmap

- **Auto-observation / auto-authoring** — watch sessions and propose domains without `/htn author`.
- **Per-round local verify + checkpoint-retry** — re-run the repo's own tests between rungs.
- HTN selection/matching + vector-db retrieval by task similarity; LLM advisory candidate scoring;
  **merge candidates into one action tree** (Tree-Planner style) instead of best-of-N select-and-discard.
- Playbook-driven rung *reordering* (not just a prior) and a `/htn playbook` inspector.
