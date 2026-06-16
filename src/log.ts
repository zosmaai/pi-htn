import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Structured JSONL logger. Two streams under ~/.pi-htn/logs/:
//   smallmodel.jsonl  - every small-model call (prompt + parsed output)
//   failures.jsonl    - every validation, parse, or tool failure (with reason)
export interface HtnLogger {
  smallModel(task: string, prompt: string | null | undefined, output: unknown): void;
  failure(where: string, kind: string, reason: string): void;
}

export class JsonlLogger implements HtnLogger {
  constructor(private dir = join(homedir(), ".pi-htn", "logs")) {
    mkdirSync(this.dir, { recursive: true });
  }
  private write(file: string, rec: Record<string, unknown>): void {
    appendFileSync(join(this.dir, file), `${JSON.stringify({ ts: Date.now(), ...rec })}\n`);
  }
  smallModel(task: string, prompt: string | null | undefined, output: unknown): void {
    this.write("smallmodel.jsonl", { task, prompt: prompt ?? null, output });
  }
  failure(where: string, kind: string, reason: string): void {
    this.write("failures.jsonl", { where, kind, reason });
  }
}

// No-op logger for tests / when logging is disabled.
export class NullLogger implements HtnLogger {
  smallModel(): void {}
  failure(): void {}
}
