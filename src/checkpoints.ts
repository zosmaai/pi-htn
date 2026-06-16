import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { StepRecord } from "./executor.ts";
import type { WorldState } from "./types.ts";

// v0.1 writes checkpoints only (no fork/retry). The sessionNodeId links each
// HTN primitive execution back to the pi session tree for v0.2 checkpoint-retry.
export class CheckpointWriter {
  constructor(
    private path: string,
    private sessionNodeId: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }
  record(step: StepRecord, worldState: WorldState): void {
    const rec = { ts: Date.now(), sessionNodeId: this.sessionNodeId, ...step, worldState };
    appendFileSync(this.path, `${JSON.stringify(rec)}\n`);
  }
}
