import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadDomain } from "../src/yaml.ts";
import { validateDomain } from "../src/validator.ts";

test("valid domain passes across synthetic states", () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const res = validateDomain(yaml, [{ intent: "spam" }, { intent: "bug", body: "x" }]);
  expect(res.ok).toBe(true);
});

test("broken domain is rejected with a reason", () => {
  const yaml = loadDomain(readFileSync("test/fixtures/broken-domain.yaml", "utf8"));
  const res = validateDomain(yaml, [{ intent: "received" }]);
  expect(res.ok).toBe(false);
  expect(res.failures[0]).toMatch(/no plan/i);
});
