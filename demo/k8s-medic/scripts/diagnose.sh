#!/usr/bin/env bash
# Emit JSON describing a deployment's current pod failure.
# Skips transient states (ContainerCreating/PodInitializing) and waits for a
# real failure reason (ImagePullBackOff, ErrImagePull, CrashLoopBackOff, ...).
# Usage: diagnose.sh <ns> <deploy>
set -uo pipefail
ns="$1"; deploy="$2"
reason=""
for _ in $(seq 1 30); do
  reason=$(kubectl -n "$ns" get pods -l "app=$deploy" \
    -o jsonpath='{range .items[*].status.containerStatuses[*]}{.state.waiting.reason} {end}' 2>/dev/null \
    | tr -s ' ' '\n' \
    | grep -vE '^$|^ContainerCreating$|^PodInitializing$' | head -1)
  [ -n "$reason" ] && break
  sleep 2
done
image=$(kubectl -n "$ns" get "deploy/$deploy" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
printf '{"reason":"%s","image":"%s"}\n' "${reason:-Unknown}" "${image:-unknown}"
