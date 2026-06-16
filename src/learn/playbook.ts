import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// One recorded repair outcome. The playbook is pi-htn's self-learning memory:
// over many PRs it accumulates which strategy actually fixes which failure class,
// so the watcher can try the historically-most-successful rung first.
export interface PlaybookEntry {
  ts: number;
  repo: string;
  pr: number | string;
  failureClass: string; // e.g. "lint" | "flaky" | "test" | "build" | "unknown"
  strategy: string; // the repair rung that ran (last_strategy from the HTN)
  ok: boolean; // did checks go green after it?
}

export interface StrategyStat {
  strategy: string;
  attempts: number;
  successes: number;
  rate: number; // Laplace-smoothed success rate, so 1/1 ranks above 0/0
}

export class Playbook {
  private file: string;
  constructor(dir = join(homedir(), ".pi-htn")) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "playbook.jsonl");
  }

  record(entry: Omit<PlaybookEntry, "ts">): void {
    appendFileSync(this.file, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
  }

  all(): PlaybookEntry[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as PlaybookEntry];
        } catch {
          return [];
        }
      });
  }

  // Strategies for a failure class, best-first. Laplace smoothing (+1/+2) keeps a
  // single past success ahead of an untried strategy without overweighting noise.
  rank(failureClass: string): StrategyStat[] {
    const agg = new Map<string, { attempts: number; successes: number }>();
    for (const e of this.all()) {
      if (e.failureClass !== failureClass) continue;
      const s = agg.get(e.strategy) ?? { attempts: 0, successes: 0 };
      s.attempts++;
      if (e.ok) s.successes++;
      agg.set(e.strategy, s);
    }
    return [...agg.entries()]
      .map(([strategy, s]) => ({ strategy, ...s, rate: (s.successes + 1) / (s.attempts + 2) }))
      .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts);
  }

  // The single best strategy for a class, or undefined if never seen.
  best(failureClass: string): string | undefined {
    return this.rank(failureClass)[0]?.strategy;
  }
}

// Heuristic prior: map failing check names to a coarse failure class. Cheap,
// deterministic first guess; the small model can refine it when available.
export function classifyFromChecks(failing: string[]): string {
  const blob = failing.join(" ").toLowerCase();
  if (/lint|format|prettier|eslint|style|fmt|clippy/.test(blob)) return "lint";
  if (/type|tsc|typecheck|mypy/.test(blob)) return "typecheck";
  if (/build|compile|bundle/.test(blob)) return "build";
  if (/flaky|e2e|integration|timeout/.test(blob)) return "flaky";
  if (/test|spec|unit|jest|vitest|pytest/.test(blob)) return "test";
  return "unknown";
}
