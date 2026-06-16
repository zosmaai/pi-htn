# Demo: "PR Doctor" — a 4B model that heals a red PR via HTN backtracking

**Thesis to make people go wow:** a *4-billion-parameter local* model
(`qwopus-4b-coder`) drives a multi-step CI-repair task to a correct result —
including recovering from a wrong first guess — because an authored HTN domain
carries the planning and **backtracks structurally** when a repair doesn't work.
The model only fills narrow blanks.

## Cast

| Role | Model | Endpoint | What it actually does |
|------|-------|----------|------------------------|
| Tiny executor | `qwopus-4b-coder` | `http://localhost:8080/v1` (local llama-swap) | classify failure (1 of N), write commit msg / PR comment |
| Little-big author | `qwopus-27b` | `http://devserver.zosma.ai:8001/v1` | best-of-N authoring of the domain (rare, offline of the run) |

Real tools via `operator.exec` (throws on non-zero → replan): `git`, `gh`,
`npm`, `kubectl` (read-only verify), `linear`.

## The three scenes (stage script)

### Scene 1 — "the tiny model can't do this alone" (the baseline)
Run the *same* `qwopus-4b-coder` as a free-form agent on the broken PR:
*"the CI is red, fix it."* It edits the wrong file / hallucinates a green run /
declares victory on a still-red build. **Audience prior set: 4B can't plan.**

### Scene 2 — "now give it an authored HTN domain" (the heal)
`/htn run pr-doctor <PR#>`. Live trace:
```
▸ fetch-status      gh pr checks ........... ✗ 1 failing job: ci/test
▸ classify-failure  (4B model) ............. "flaky"          ← model's ONE guess
▸ repair: rerun     gh run rerun ........... applied
▸ verify            gh pr checks ........... ✗ still red       ← THE BREAK
↩ backtrack         rerun excluded (tried); select next valid method
▸ repair: lint-fix  npm run lint -- --fix .. applied (no diff)
▸ verify ............................. ✗ still red
↩ backtrack         lint excluded (tried); select next valid method
▸ repair: revert    git revert <sha> ...... applied
▸ verify ............................. ✓ GREEN
▸ report            gh pr comment + linear issue → "Fixed"
done · 3 repair attempts · 2 backtracks · model called twice (~60 tokens)
```
**The wow line:** *"The 4B model guessed 'flaky.' It was wrong. Nobody corrected
it. The HTN tried it, saw the build was still red, and on its own climbed the
repair ladder until green."*

### Scene 3 — "and it's reusable + auditable" (the payoff)
Show `~/.pi-htn/domains/pr-doctor.yaml` — inspectable *data*, not code. Show it
was authored once by `qwopus-27b` from a recorded trace (best-of-N, validated by
the offline gate). Re-run on a *different* injected break: same domain, different
path through it. **Crystallized, reusable plan — the reusability pillar.**

## Why the backtracking is REAL (not a retry loop)

The escalation is HTN-native, driven by **preconditions over world state**, not by
re-asking the model. Each repair method is a `sequence`:

1. `apply-<strategy>` — runs the fix; **effect sets `<strategy>_tried: true`** (commits on success — applying always "succeeds", it's the *verify* that judges).
2. `verify` — `gh pr checks`; **throws if still red** → executor replans.

The repair root is a `select` whose methods are guarded by
`{ not: <strategy>_tried }`. On replan, the just-tried method is no longer valid,
so the planner **decomposes to the next method** — a genuine alternate-branch
backtrack. The circuit breaker bounds total replans so a hopeless PR escalates to
a human (PR comment + Linear "needs-human") instead of looping.

The model's only load-bearing act is `classify-failure`; even if it's wrong, the
ladder converges. That is the point: **structure carries reliability, not the model.**

## Domain sketch (data — never executed as code)

```yaml
domain: pr-doctor
worldState:
  pr: null
  failure_class: null
  fixed: false
  rerun_tried: false
  lint_tried: false
  revert_tried: false
root:
  type: sequence
  tasks:
    - name: fetch-status
      operator:
        tool: gh.pr-checks
        exec: { cmd: gh, args: ["pr", "checks", "{{pr}}", "--json", "name,state,link"] }
      effects: [{ set: { failing: "$result" } }]

    - name: classify-failure
      operator:
        tool: classify
        prompt: |
          Given this failing CI job summary, output JSON with one field
          "failure_class", one of: flaky, lint, test. Example:
          {"failure_class":"lint"}. Do not output placeholders.
      effects: [{ set: { failure_class: "$result.failure_class" } }]

    - name: repair
      type: select
      tasks:
        - name: m-rerun
          type: sequence
          conditions: [{ eq: [failure_class, flaky] }, { not: rerun_tried }]
          tasks:
            - name: apply-rerun
              operator: { tool: gh.rerun, exec: { cmd: gh, args: ["run", "rerun", "--failed"] } }
              effects: [{ set: { rerun_tried: true } }]
            - name: verify-rerun
              operator: { tool: verify, exec: { cmd: bash, args: ["scripts/verify-green.sh", "{{pr}}"] } }
              effects: [{ set: { fixed: true } }]
        - name: m-lint
          type: sequence
          conditions: [{ not: lint_tried }]
          tasks:
            - name: apply-lint
              operator: { tool: lint.fix, exec: { cmd: bash, args: ["scripts/lint-fix-commit.sh"] } }
              effects: [{ set: { lint_tried: true } }]
            - name: verify-lint
              operator: { tool: verify, exec: { cmd: bash, args: ["scripts/verify-green.sh", "{{pr}}"] } }
              effects: [{ set: { fixed: true } }]
        - name: m-revert
          type: sequence
          conditions: [{ not: revert_tried }]
          tasks:
            - name: apply-revert
              operator: { tool: git.revert, exec: { cmd: bash, args: ["scripts/revert-last-commit.sh"] } }
              effects: [{ set: { revert_tried: true } }]
            - name: verify-revert
              operator: { tool: verify, exec: { cmd: bash, args: ["scripts/verify-green.sh", "{{pr}}"] } }
              effects: [{ set: { fixed: true } }]

    - name: report
      operator:
        tool: report
        prompt: 'Write a one-line PR comment summarizing the fix. Example: {"comment":"Reverted a8c1f to restore green CI."}'
      effects: [{ set: { reported: true } }]
```

## Build plan (v1 = reproducible & offline-capable, then real-PR showpiece)

- **v1 (today):** a throwaway demo repo with a deterministic break + `scripts/`
  that the domain shells out to. `verify-green.sh` can run **local** `npm test`
  (fast, offline, resettable) OR `gh pr checks` (real). Same domain, swappable
  tool bindings — because tools are just `exec` specs.
- **Showpiece:** point `verify-green.sh` / `apply-*` at real `gh` against a real
  PR in a demo GitHub repo with real Actions. Reset by re-running `break.sh`.
- **k8s/Linear:** keep k8s read-only (`kubectl rollout status` as an optional
  verify); Linear update is a real `linear` CLI call on a demo issue.

## Open decisions (need before building)
1. **v1 target:** local-CI simulation first (recommended — fast, deterministic,
   no Actions minutes) vs. straight to a real GitHub PR + Actions.
2. **Demo repo:** new throwaway `htn-pr-doctor-demo` vs. an existing repo.
3. **Author live or pre-write:** have `qwopus-27b` author the domain from a trace
   on stage (full loop, riskier) vs. ship a pre-authored validated domain and
   *show* the authoring artifact (safer). Recommended: pre-author, show artifact.
