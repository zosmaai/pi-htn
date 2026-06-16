import { readFileSync } from "node:fs";

export interface TraceCall { name: string; arguments: Record<string, unknown> }

// v0.1 recorder: parse the active session jsonl (id/parentId tree) and pull the
// ordered tool calls. Pi session files live at
// ~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<uuid>.jsonl
export function extractTrace(sessionFile: string): TraceCall[] {
  const calls: TraceCall[] = [];
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let obj: { toolCalls?: { name: string; arguments?: Record<string, unknown> }[] };
    try { obj = JSON.parse(line); } catch { continue; }
    for (const tc of obj.toolCalls ?? [])
      calls.push({ name: tc.name, arguments: tc.arguments ?? {} });
  }
  return calls;
}
