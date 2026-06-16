import { test, expect } from "vitest";
import { buildAuthorPrompt, extractYamlBlock } from "../src/author.ts";

test("author prompt embeds the trace and demands YAML + branch reasoning", () => {
  const p = buildAuthorPrompt("tally-triage", [
    { name: "tally.close", arguments: { id: 1 } },
  ]);
  expect(p).toMatch(/tally-triage/);
  expect(p).toMatch(/tally\.close/);
  expect(p).toMatch(/YAML/i);
  expect(p).toMatch(/conditions|branch/i);
});

test("extractYamlBlock pulls the first fenced yaml block", () => {
  const reply = "Here:\n```yaml\ndomain: x\n```\ntrailing";
  expect(extractYamlBlock(reply).trim()).toBe("domain: x");
});
