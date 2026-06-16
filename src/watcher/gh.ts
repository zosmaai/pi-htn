import type { ShellExec } from "../exec.ts";

// One row from `gh pr checks <pr> --json name,state,bucket`.
export interface CheckRow {
  name: string;
  state?: string;
  bucket?: string;
  workflow?: string;
}

export type CheckState = "green" | "red" | "pending" | "none";
export interface ChecksSummary {
  state: CheckState;
  failing: string[];
  pending: string[];
  total: number;
}
export interface PrView {
  number: number;
  headRefName: string;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  state: string; // OPEN | MERGED | CLOSED
}

const FAIL = new Set(["fail", "failure", "error", "cancelled", "canceled", "timed_out", "action_required"]);
const PEND = new Set([
  "pending",
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "neutral",
  "skipping",
  "stale",
]);

// Pure: collapse per-check rows into a single state. Order matters — any failure
// makes the PR red; otherwise any pending keeps it pending; else green.
export function parseChecks(rows: CheckRow[]): ChecksSummary {
  if (!rows || rows.length === 0) return { state: "none", failing: [], pending: [], total: 0 };
  const failing: string[] = [];
  const pending: string[] = [];
  for (const r of rows) {
    const key = (r.bucket || r.state || "").toLowerCase();
    if (FAIL.has(key)) failing.push(r.name);
    else if (PEND.has(key)) pending.push(r.name);
  }
  const state: CheckState = failing.length ? "red" : pending.length ? "pending" : "green";
  return { state, failing, pending, total: rows.length };
}

function tolerantJson<T>(stdout: string, fallback: T): T {
  const s = stdout.trim();
  if (!s) return fallback;
  const start = s.search(/[[{]/);
  if (start === -1) return fallback;
  try {
    return JSON.parse(s.slice(start)) as T;
  } catch {
    return fallback;
  }
}

// Thin typed wrapper over the `gh` CLI, bound to a repo via the injected shell.
// `gh pr checks` exits non-zero when checks are failing/pending, so we ALWAYS
// parse stdout and ignore the exit code for status reads.
export class GhClient {
  constructor(private shell: ShellExec) {}

  async checks(pr: number | string): Promise<ChecksSummary> {
    const r = await this.shell("gh", ["pr", "checks", String(pr), "--json", "name,state,bucket,workflow"]);
    return parseChecks(tolerantJson<CheckRow[]>(r.stdout, []));
  }

  async view(pr: number | string): Promise<PrView | null> {
    const r = await this.shell("gh", [
      "pr",
      "view",
      String(pr),
      "--json",
      "number,headRefName,mergeable,state",
    ]);
    return tolerantJson<PrView | null>(r.stdout, null);
  }

  async listOpen(): Promise<PrView[]> {
    const r = await this.shell("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--json",
      "number,headRefName,mergeable,state",
    ]);
    return tolerantJson<PrView[]>(r.stdout, []);
  }

  async comment(pr: number | string, body: string): Promise<void> {
    await this.shell("gh", ["pr", "comment", String(pr), "--body", body]);
  }
}
