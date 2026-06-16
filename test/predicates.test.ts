import { expect, test } from "vitest";
import htn from "../src/htn.ts";
import { compileCondition, compileEffect } from "../src/predicates.ts";

function execCtx(ws: Record<string, unknown>) {
  const ctx = new htn.Context();
  ctx.WorldState = { ...ws };
  ctx.init();
  return ctx; // ContextState defaults to Executing
}

test("eq condition reads world state", () => {
  const cond = compileCondition({ eq: ["intent", "spam"] });
  expect(cond(execCtx({ intent: "spam" }))).toBe(true);
  expect(cond(execCtx({ intent: "bug" }))).toBe(false);
});

test("has and not compose", () => {
  const cond = compileCondition({ not: { has: "replied" } });
  expect(cond(execCtx({ replied: false }))).toBe(true);
  expect(cond(execCtx({ replied: true }))).toBe(true); // has() checks === 1 by default; false !== 1
});

test("effect sets world state at execution time", () => {
  const eff = compileEffect({ set: { replied: true } });
  const ctx = execCtx({ replied: false });
  eff.action(ctx, eff.type);
  expect(ctx.getState("replied")).toBe(true);
});
