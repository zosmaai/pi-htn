#!/usr/bin/env bash
# rung 1 — insert the 4B model's emitted guard line at the top of the
# appendWikiStatus() body. The model owns this narrow patch; if its line is
# wrong, verify stays red and the HTN backtracks to a deterministic rung.
#   $1 = repo root   $2 = the guard statement (one line, model-authored)
set -euo pipefail
REPO="$1"; LINE="$2"
FILE="$REPO/extensions/llm-wiki/lib/inject.ts"
node -e '
  const fs = require("fs");
  const [file, line] = [process.argv[1], process.argv[2]];
  let s = fs.readFileSync(file, "utf8");
  const anchor = "export function appendWikiStatus(systemPrompt: string): string {\n";
  if (!s.includes(anchor)) { console.error("anchor not found"); process.exit(2); }
  // Replace the whole body each time so reruns/backtracks start clean.
  s = s.replace(
    /export function appendWikiStatus\(systemPrompt: string\): string \{[\s\S]*?\n\}/,
    "export function appendWikiStatus(systemPrompt: string): string {\n  " + line +
      "\n  return `${systemPrompt}\\n\\n${WIKI_STATUS_BLOCK}`;\n}",
  );
  fs.writeFileSync(file, s);
' "$FILE" "$LINE"
echo "{\"applied\":\"model-guard\"}"
