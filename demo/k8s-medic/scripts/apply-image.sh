#!/usr/bin/env bash
# Set every container of a deployment to <image> (used by both repair rungs).
# Usage: apply-image.sh <ns> <deploy> <image>
set -euo pipefail
ns="$1"; deploy="$2"; image="$3"
kubectl -n "$ns" set image "deploy/$deploy" "*=$image" >/dev/null
printf '{"applied":"%s"}\n' "$image"
