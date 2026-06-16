#!/usr/bin/env bash
# Succeed only if the latest rollout goes Ready within the timeout.
# Non-zero exit (timeout) makes the HTN executor replan -> backtrack.
# Usage: verify-rollout.sh <ns> <deploy> [timeout]
set -euo pipefail
ns="$1"; deploy="$2"; timeout="${3:-60s}"
kubectl -n "$ns" rollout status "deploy/$deploy" --timeout="$timeout" >/dev/null 2>&1
