# PR Doctor — the "4B model heals a red PR" demo

A 4-billion-parameter local model (`qwopus-4b-coder`) drives a multi-step CI
repair to a correct result — **including recovering from a wrong first guess** —
because an authored HTN domain carries the planning and **backtracks
structurally** when a repair doesn't work. The model only fills narrow blanks.

## What you watch

```
  PR Doctor — PR #42  (executor: qwopus-4b-coder)

  ▸ run tests ............. ✗ red
  ▸ classify (4B) ......... "flaky"   ← the model's one guess (wrong)
  ▸ repair: rerun         applied
  ▸ verify ................ ✗ still red
  ↩ backtrack ............. rerun excluded; planner selects next rung
  ▸ repair: lint          applied
  ▸ verify ................ ✗ still red
  ↩ backtrack ............. lint excluded; planner selects next rung
  ▸ repair: revert        applied
  ▸ verify ................ ✓ GREEN
  ▸ report ................ Reverted the breaking commit to restore green CI.

  done ✓ · 3 repair attempts · 2 backtracks · failure_class="flaky"
```

## Why the backtracking is REAL (not a retry loop)

The escalation is HTN-native, driven by **preconditions over world state**, not by
re-asking the model. Each repair rung is a `sequence`: `apply-<x>` (effect sets
`<x>_tried: true`) → `verify` (`scripts/verify-green.sh`, **throws if still red**).
The repair root is a `select` whose rungs are guarded by `{ not: { eq: [<x>_tried,
true] } }`. When `verify` throws, the executor replans, the just-tried rung is no
longer valid, and the planner **decomposes to the next rung** — a genuine
alternate-branch backtrack. `m-revert` is the guaranteed-green terminal rung, so
the ladder always converges; a hopeless PR trips the circuit breaker and escalates.

## Key design note (load-bearing)

`classify` is **hoisted to a pre-step** in the runner, not a task inside the plan.
The executor plans the whole domain up-front, so a mid-plan `$result` effect is
only a placeholder string at plan time and cannot gate a `select`. Running the
classify before `executeDomain` and passing `failure_class` as `input` lets
planning route to the guessed rung first. (See `run.ts`.)

## Run it

```bash
# one-time
cd ~/code/htn-demos/pr-doctor-demo && npm test   # should be RED on broken HEAD

# deterministic, scripted-wrong-guess flaky path (2 backtracks, no model needed)
cd ~/code/pi-packages/pi-htn
( cd ~/code/htn-demos/pr-doctor-demo && ./break.sh )
npx tsx demo/pr-doctor/run.ts --pr 42 --fake

# live tiny model (qwopus-4b-coder on local llama-swap :8080)
( cd ~/code/htn-demos/pr-doctor-demo && ./break.sh )
npx tsx demo/pr-doctor/run.ts --pr 42
```

Flags: `--repo <path>` (demo repo), `--pr <n>`, `--model <id>`, `--base <url>`
(OpenAI-compatible), `--fake` (no model — scripted).

## The A/B punchline

Run the *same* `qwopus-4b-coder` as a free-form agent on the broken repo
("CI is red, fix it") — it edits the wrong thing or declares a false victory.
Then run it inside this domain. *Same model. The structure carried the
reliability.*

## Upgrading to a real GitHub PR

The repair scripts are just shell. Swap the local stand-ins for real `gh`:
`verify-green.sh` → `gh pr checks <PR>`; `apply-rerun.sh` → `gh run rerun
--failed`; `report.sh` → `gh pr comment` + a `linear` issue update. The HTN domain
is unchanged — only the tool bindings move from local to real.
