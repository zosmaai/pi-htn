#!/usr/bin/env bash
# Report — post the 4B model's one-sentence comment to the real PR via gh.
# Falls back to a local log if gh is unavailable or posting fails.
#   $1 = repo root   $2 = PR number   $3 = comment text
set -uo pipefail
REPO="$1"; PR="$2"; COMMENT="$3"
cd "$REPO"
if command -v gh >/dev/null 2>&1; then
  if gh pr comment "$PR" --repo arjun-zosma/pi-llm-wiki --body "🤖 $COMMENT" >/dev/null 2>&1; then
    echo "{\"posted\":\"gh\",\"pr\":\"$PR\"}"
    exit 0
  fi
fi
echo "[$(date -u +%FT%TZ)] PR#$PR :: $COMMENT" >> "$REPO/.fix-red-test.log"
echo "{\"posted\":\"local-log\",\"pr\":\"$PR\"}"
