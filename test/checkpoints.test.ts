import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointWriter } from "../src/checkpoints.ts";

test("writes one checkpoint line per step with sessionNodeId", () => {
  const dir = mkdtempSync(join(tmpdir(), "htn-"));
  const w = new CheckpointWriter(join(dir, "run.jsonl"), "sess-node-42");
  w.record({ task: "reply", tool: "tally.reply", args: {}, result: { sent: true } }, { replied: true });
  const lines = readFileSync(join(dir, "run.jsonl"), "utf8").trim().split("\n");
  const rec = JSON.parse(lines[0]);
  expect(rec.sessionNodeId).toBe("sess-node-42");
  expect(rec.task).toBe("reply");
  expect(rec.worldState).toEqual({ replied: true });
});
