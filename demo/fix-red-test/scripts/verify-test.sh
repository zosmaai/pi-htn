#!/usr/bin/env bash
# Verify gate — runs ONLY the scoped regression test so the signal is
# deterministic (unrelated local-env test noise is irrelevant). Exits non-zero
# on red, which makes the HTN executor's verify operator throw → replan.
#   $1 = repo root
set -uo pipefail
REPO="$1"
cd "$REPO"
npx vitest run test/inject-idempotent.test.ts >/tmp/fix-red-verify.log 2>&1
code=$?
if [ $code -eq 0 ]; then
  echo "{\"verify\":\"green\"}"
else
  tail -3 /tmp/fix-red-verify.log >&2
fi
exit $code
