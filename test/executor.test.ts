import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { executeDomain } from "../src/executor.ts";
import { FakeSmallModel } from "../src/smallModel.ts";
import { ToolRegistry } from "../src/toolRegistry.ts";
import { loadDomain } from "../src/yaml.ts";

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

test("missing $result field resolves to null, not a phantom 1", async () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const tools = new ToolRegistry();
  // echo tool has NO `id` field -> $result.id is undefined
  for (const t of ["tally.close", "linear.create", "tally.reply"])
    tools.register(t, async (a) => ({ echo: true, args: a }));
  const res = await executeDomain(yaml, {
    input: { intent: "bug", body: "x" },
    tools,
    smallModel: new FakeSmallModel([{}, {}]),
  });
  expect(res.ok).toBe(true);
  expect(res.finalWorldState.ticketId).toBeNull(); // not 1
});

test("circuit breaker trips after repeated tool failure", async () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const r = reg();
  r.register("tally.close", async () => {
    throw new Error("boom");
  });
  const result = await executeDomain(yaml, {
    input: { intent: "spam" },
    tools: r,
    smallModel: new FakeSmallModel([]),
    maxReplans: 2,
  });
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/circuit breaker|boom/i);
});
