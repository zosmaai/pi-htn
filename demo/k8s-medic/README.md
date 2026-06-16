# k8s-medic — self-heal a broken Kubernetes deployment (HTN + small model)

A third pi-htn demo, in a **new domain: live infrastructure.** Where `pr-doctor`
and `fix-red-test` heal CI/PRs, this one heals a **real Kubernetes deployment on
the current `kubectl` cluster** — diagnose → small-model remediation → verify
rollout → structural backtracking to a deterministic safety net.

## The scenario

1. Ensure a throwaway `Deployment` (`htn-demo/web`, nginx) on a known-good image.
2. **Break it:** `kubectl set image … *=nginx:9.9.9-htndemo-bad` → `ImagePullBackOff`.
3. **Diagnose:** read the pod failure reason + current image off the cluster.
4. **Model proposes** a concrete remediation — a corrected, pullable image —
   from the diagnosis. Hoisted to plan input (`action` + `image`).
5. **HTN heal ladder** applies it and verifies the rollout; if it doesn't go
   Ready, the executor replans and climbs to a deterministic restore rung.
6. **Model writes** a one-sentence incident note; `report.sh` annotates the
   deployment with it (survives in-cluster, visible via `kubectl describe`).

## The repair ladder

```
heal (select, until healthy)
 ├─ m-apply    apply the model's proposed image (tool: kset)      → verify rollout
 └─ m-restore  restore the last-known-good image (tool: krestore) → verify rollout
report          model writes an incident note; report.sh annotates the deploy
```

`verify-rollout.sh` runs `kubectl rollout status --timeout`; a non-Ready rollout
exits non-zero, which throws in the executor and trips a replan. The just-tried
rung is excluded by its `*_tried` guard, so the planner climbs to the next.

## Two runs, two stories

**Live (`qwopus-coder-9b` on the devserver):** the model reads `ErrImagePull` on
`nginx:9.9.9-htndemo-bad` and proposes `nginx:latest` — a genuine, valid fix.
Rung 1 verifies ✓ Ready. **1 attempt, 0 backtracks** — the small model actually
remediated the cluster.

**Forced backtrack (`--fake`):** the model proposes another bad image
(`nginx:0.0.0-still-broken`); rung 1 verifies ✗, the HTN **backtracks** to the
deterministic restore rung → ✓ Ready. Shows the reliability guarantee.

```
▸ diagnose ............. ErrImagePull  (image=nginx:9.9.9-htndemo-bad)
▸ model proposes ....... set-image → nginx:0.0.0-still-broken
▸ repair: model image .. applied
▸ verify rollout ....... ✗ not Ready
↩ backtrack ............ rung excluded; planner climbs to the safety net
▸ repair: restore known-good  applied
▸ verify rollout ....... ✓ Ready
▸ report ............... Restored web to the last-known-good image after a bad rollout.
done ✓ · 2 repair attempts · 1 backtrack · strategy="restore known-good"
```

## Run it

```bash
# live (model proposes the real kubectl remediation; off-laptop devserver):
npx tsx demo/k8s-medic/run.ts

# forced backtrack to the deterministic safety net (no model needed):
npx tsx demo/k8s-medic/run.ts --fake

# clean up the throwaway namespace afterwards:
npx tsx demo/k8s-medic/run.ts --cleanup        # (deletes ns at the end)
kubectl delete namespace htn-demo              # or manually
```

Flags: `--ns` `--deploy` `--good-image` `--bad-image` `--model` `--base`
`--fake` `--no-break` `--cleanup`.

## Reliability note (and a gotcha)

The terminal `m-restore` rung restores the pinned last-known-good image, so the
ladder cannot fail to converge — the model gets to try first, the HTN guarantees
green.

**Gotcha:** `buildExecRegistry` binds **one exec spec per tool name** (first
wins). Two rungs that need *different* args (here `{{image}}` vs
`{{good_image}}`) must therefore use **different tool names** (`kset` vs
`krestore`) — otherwise the second silently reuses the first's command.
