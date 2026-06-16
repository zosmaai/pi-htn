import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadDomain } from "../src/yaml.ts";
import { ToolRegistry } from "../src/toolRegistry.ts";
import { FakeSmallModel } from "../src/smallModel.ts";
import { executeDomain } from "../src/executor.ts";

function reg() {
  const r = new ToolRegistry();
  r.register("tally.close", async () => ({ closed: true }));
  r.register("linear.create", async () => ({ id: "BUG-1" }));
  r.register("tally.reply", async () => ({ sent: true }));
  return r;
}

test("runs the bug sequence end to end, applying effects", async () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const result = await executeDomain(yaml, {
    input: { intent: "bug", body: "crash" },
    tools: reg(),
    smallModel: new FakeSmallModel([{ title: "crash" }, { text: "fixed soon" }]),
  });
  expect(result.ok).toBe(true);
  expect(result.steps.map((s) => s.task)).toEqual(["open-ticket", "reply"]);
  expect(result.finalWorldState.replied).toBe(true);
  expect(result.finalWorldState.ticketId).toBe("BUG-1"); // $result.id resolved
});

test("circuit breaker trips after repeated tool failure", async () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const r = reg();
  r.register("tally.close", async () => { throw new Error("boom"); });
  const result = await executeDomain(yaml, {
    input: { intent: "spam" },
    tools: r,
    smallModel: new FakeSmallModel([]),
    maxReplans: 2,
  });
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/circuit breaker|boom/i);
});
