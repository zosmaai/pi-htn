#!/usr/bin/env bash
# rung 2 — deterministic, known-good idempotency via strip-then-append.
# A genuinely different approach from the guard clause; always converges green.
#   $1 = repo root
set -euo pipefail
REPO="$1"
FILE="$REPO/extensions/llm-wiki/lib/inject.ts"
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  let s = fs.readFileSync(file, "utf8");
  const body = [
    "export function appendWikiStatus(systemPrompt: string): string {",
    "  const base = systemPrompt.split(`\\n\\n${WIKI_STATUS_BLOCK}`).join(\"\");",
    "  return `${base}\\n\\n${WIKI_STATUS_BLOCK}`;",
    "}",
  ].join("\n");
  s = s.replace(
    /export function appendWikiStatus\(systemPrompt: string\): string \{[\s\S]*?\n\}/,
    body,
  );
  fs.writeFileSync(file, s);
' "$FILE"
echo "{\"applied\":\"strip-then-append\"}"
