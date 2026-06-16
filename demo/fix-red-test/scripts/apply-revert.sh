#!/usr/bin/env bash
# rung 3 — guaranteed-green terminal: rewrite appendWikiStatus() from a canonical
# early-return-guard template. This is the HTN's reliability floor — it always
# makes the regression test pass, so the ladder cannot fail to converge.
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
    "  if (systemPrompt.includes(WIKI_STATUS_BLOCK)) return systemPrompt;",
    "  return `${systemPrompt}\\n\\n${WIKI_STATUS_BLOCK}`;",
    "}",
  ].join("\n");
  s = s.replace(
    /export function appendWikiStatus\(systemPrompt: string\): string \{[\s\S]*?\n\}/,
    body,
  );
  fs.writeFileSync(file, s);
' "$FILE"
echo "{\"applied\":\"canonical-template\"}"
