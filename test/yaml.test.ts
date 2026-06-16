import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { loadDomain } from "../src/yaml.ts";

test("loads a valid domain", () => {
  const d = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  expect(d.domain).toBe("tally-triage");
  expect(d.root.type).toBe("select");
  expect(d.root.tasks.length).toBe(2);
});

test("rejects a domain missing root", () => {
  expect(() => loadDomain("domain: x\nworldState: {}")).toThrow(/root/);
});

test("rejects a primitive missing operator.tool", () => {
  const bad = "domain: x\nworldState: {}\nroot:\n  type: select\n  tasks:\n    - name: a\n      operator: {}";
  expect(() => loadDomain(bad)).toThrow(/tool/);
});
