import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import htn from "../src/htn.ts";
import { loadDomain } from "../src/yaml.ts";
import { compileDomain, makeContext } from "../src/compiler.ts";

test("compiles tally domain into a GamePlanHTN Domain with a sound plan", () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const domain = compileDomain(yaml);
  expect(domain).toBeInstanceOf(htn.Domain);

  const ctx = makeContext(yaml, { intent: "bug", body: "it crashes" });
  const { status, plan } = domain.findPlan(ctx);
  // bug branch is a 2-step sequence
  const names = plan.map((t: { Name: string }) => t.Name);
  expect(names).toEqual(["open-ticket", "reply"]);
  expect(String(status)).toMatch(/succ/i);
});

test("selects spam branch when intent=spam", () => {
  const yaml = loadDomain(readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const domain = compileDomain(yaml);
  const ctx = makeContext(yaml, { intent: "spam" });
  const names = domain.findPlan(ctx).plan.map((t: { Name: string }) => t.Name);
  expect(names).toEqual(["handle-spam"]);
});
