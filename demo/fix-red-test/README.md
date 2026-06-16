# fix-red-test — a 4B model heals a real RED PR via HTN backtracking

This demo points pi-htn at a **real bug in a real repo** and lets a local 4B
model (`qwopus-4b-coder`) fix it — with the HTN providing structural
backtracking when the model's first patch is wrong.

- **Issue:** [zosmaai/pi-llm-wiki#87](https://github.com/zosmaai/pi-llm-wiki/issues/87)
  — `appendWikiStatus()` injects the `<wiki_status>` footer non-idempotently, so
  an aborted/retried agent start stacks it 2×, 3×, …
- **PR (target):** [arjun-zosma/pi-llm-wiki#1](https://github.com/arjun-zosma/pi-llm-wiki/pull/1)
  — ships a failing idempotency regression test (RED).

## What makes this harder than `pr-doctor`

`pr-doctor` used canned repair scripts; the model only classified. Here the
**4B model does genuine patch work**: it reads the buggy function and emits the
actual TypeScript guard statement to insert. The HTN still owns ordering and
backtracking, and reliability is structural — deterministic fallback rungs
guarantee convergence even when the model is wrong.

## The repair ladder

```
repair (select, until fixed)
 ├─ m-guard   apply the 4B model's emitted guard line → verify
 ├─ m-dedupe  deterministic strip-then-append (known-good) → verify
 └─ m-revert  rewrite from canonical template (guaranteed green) → verify
report         4B writes a one-sentence PR comment; report.sh posts via gh
```

Each rung applies then **verifies the scoped regression test** (`verify` throws
on red → the executor replans). The just-tried rung is excluded by its
`*_tried` guard, so the planner climbs to the next rung.

The classification + patch is **hoisted to plan input** (`approach` + `line`):
the executor plans the whole domain up-front, so a mid-plan `$result` can't gate
the `select`.

## A real, honest backtrack

Live, the 4B model produced:

```ts
if (systemPrompt.endsWith(WIKI_STATUS_BLOCK)) return systemPrompt;
```

Plausible — but the regression test seeds the footer **mid-prompt**, so
`endsWith` is `false` and the footer still duplicates. `m-guard` verifies RED,
the HTN backtracks, and `m-dedupe` lands GREEN:

```
▸ run regression test ... ✗ red
▸ 4B patch (guard) ...... if (systemPrompt.endsWith(WIKI_STATUS_BLOCK)) return systemPrompt;
▸ repair: guard    ...... applied
▸ verify ................ ✗ still red
↩ backtrack ............. guard excluded; planner selects next rung
▸ repair: dedupe   ...... applied
▸ verify ................ ✓ GREEN
▸ report ................ Fixed non-idempotent context injection …
done ✓ · 2 repair attempts · 1 backtracks
```

## Run it

```bash
# live 4B (commits + pushes the fix to the PR branch, posts a gh comment):
npx tsx demo/fix-red-test/run.ts

# inspect without committing/pushing:
npx tsx demo/fix-red-test/run.ts --no-push

# deterministic (scripted wrong guess → forced backtrack, no model):
npx tsx demo/fix-red-test/run.ts --fake --no-push
```

Flags: `--repo <path>` `--pr <n>` `--branch <name>` `--model <id>` `--base <url>`.

> Note: the `report` step posts a PR comment on every run (it runs inside the
> plan, regardless of `--no-push`). Use a throwaway PR when iterating.

## Reliability note

`verify` runs **only** the scoped regression test, so the gate is deterministic
and immune to unrelated local-env test noise. The terminal `m-revert` rung is a
known-good rewrite, so the ladder cannot fail to converge — the model gets to
try first, but the HTN guarantees green.
