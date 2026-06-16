#!/usr/bin/env bash
# Annotate the deployment with the model's incident note (survives in-cluster).
# Usage: report.sh <ns> <deploy> <note>
set -uo pipefail
ns="$1"; deploy="$2"; note="${3:-healed by k8s-medic}"
kubectl -n "$ns" annotate "deploy/$deploy" "htn.medic/last-incident=$note" \
  --overwrite >/dev/null 2>&1 || true
printf '{"noted":true}\n'
