import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { authorCandidates } from "../src/commands/author.ts";
import { executeDomain } from "../src/executor.ts";
import { loadDomain } from "../src/yaml.ts";
import { ToolRegistry } from "../src/toolRegistry.ts";
import { FakeSmallModel } from "../src/smallModel.ts";

test("AC: best-of-N picks the passing tally candidate over a broken one", () => {
  const good = "```yaml\n" + readFileSync("test/fixtures/tally-triage.yaml", "utf8") + "\n```";
  const broken = "```yaml\n" + readFileSync("test/fixtures/broken-domain.yaml", "utf8") + "\n```";
  const r = authorCandidates("tally-triage", "test/fixtures/sample-session.jsonl", [broken, good]);
  expect(r.chosen).toBeDefined();
  expect(r.chosen!.yaml!.domain).toBe("tally-triage");
});

test("AC: best-of-N with no passing candidate yields no choice", () => {
  const broken = "```yaml\n" + readFileSync("test/fixtures/broken-domain.yaml", "utf8") + "\n```";
  const r = authorCandidates("broken", "test/fixtures/sample-session.jsonl", [broken, "no yaml here"]);
  expect(r.chosen).toBeUndefined();
  expect(r.candidates.every((c) => !c.ok)).toBe(true);
});

test("AC: spam branch runs end to end and sets replied", async () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const tools = new ToolRegistry();
  tools.register("tally.close", async () => ({ ok: true }));
  const res = await executeDomain(yaml, { input: { intent: "spam" }, tools, smallModel: new FakeSmallModel([]) });
  expect(res.ok).toBe(true);
  expect(res.finalWorldState.replied).toBe(true);
});
