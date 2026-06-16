import { test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchPr, type HealFn } from "../src/watcher/watcher.ts";
import { Playbook } from "../src/learn/playbook.ts";
import type { ChecksSummary } from "../src/watcher/gh.ts";

function fakeGh(seq: ChecksSummary[]) {
  let i = 0;
  return { checks: async () => seq[Math.min(i++, seq.length - 1)] } as never;
}
const RED: ChecksSummary = { state: "red", failing: ["unit-tests"], pending: [], total: 1 };
const PENDING: ChecksSummary = { state: "pending", failing: [], pending: ["ci"], total: 1 };
const GREEN: ChecksSummary = { state: "green", failing: [], pending: [], total: 1 };
const newPb = () => new Playbook(mkdtempSync(join(tmpdir(), "htn-w-")));

test("already-green PR is merge-ready with no heal", async () => {
  const heal: HealFn = async () => ({ ok: true, strategy: "noop", steps: [] });
  const r = await watchPr({ repo: "r", pr: 1 }, { gh: fakeGh([GREEN]), heal, playbook: newPb() });
  expect(r.mergeReady).toBe(true);
  expect(r.reason).toBe("already-green");
});

test("red → heal → pending → green yields merge-ready 'healed' and records outcome", async () => {
  const pb = newPb();
  let healed = false;
  const heal: HealFn = async () => { healed = true; return { ok: true, strategy: "test-fix", steps: ["apply→x"] }; };
  const r = await watchPr(
    { repo: "r", pr: 7, pollMs: 0 },
    { gh: fakeGh([RED, PENDING, GREEN]), heal, playbook: pb, sleep: async () => {} },
  );
  expect(healed).toBe(true);
  expect(r.mergeReady).toBe(true);
  expect(r.reason).toBe("healed");
  expect(pb.best("test")).toBe("test-fix"); // self-learning: outcome persisted
});

test("heal that fails escalates to a human", async () => {
  const heal: HealFn = async () => ({ ok: false, strategy: "revert", error: "circuit breaker", steps: [] });
  const r = await watchPr({ repo: "r", pr: 9 }, { gh: fakeGh([RED]), heal, playbook: newPb() });
  expect(r.mergeReady).toBe(false);
  expect(r.reason).toMatch(/escalated/);
});

test("persistently red exhausts the heal budget", async () => {
  const heal: HealFn = async () => ({ ok: true, strategy: "lint-fix", steps: [] });
  const r = await watchPr(
    { repo: "r", pr: 3, maxRounds: 2 },
    { gh: fakeGh([RED, RED, RED, RED, RED]), heal, playbook: newPb() },
  );
  expect(r.mergeReady).toBe(false);
  expect(r.reason).toBe("exhausted");
});
