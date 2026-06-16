import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Playbook, classifyFromChecks } from "../src/learn/playbook.ts";

test("ranks strategies by smoothed success rate, best first", () => {
  const dir = mkdtempSync(join(tmpdir(), "htn-pb-"));
  const pb = new Playbook(dir);
  pb.record({ repo: "r", pr: 1, failureClass: "lint", strategy: "lint-fix", ok: true });
  pb.record({ repo: "r", pr: 2, failureClass: "lint", strategy: "lint-fix", ok: true });
  pb.record({ repo: "r", pr: 3, failureClass: "lint", strategy: "revert", ok: false });
  const ranked = pb.rank("lint");
  expect(ranked[0].strategy).toBe("lint-fix");
  expect(pb.best("lint")).toBe("lint-fix");
});

test("returns empty / undefined for an unseen class", () => {
  const dir = mkdtempSync(join(tmpdir(), "htn-pb-"));
  const pb = new Playbook(dir);
  expect(pb.rank("nope")).toEqual([]);
  expect(pb.best("nope")).toBeUndefined();
});

test("classifyFromChecks maps check names to a failure class", () => {
  expect(classifyFromChecks(["ESLint"])).toBe("lint");
  expect(classifyFromChecks(["unit-tests"])).toBe("test");
  expect(classifyFromChecks(["build-and-bundle"])).toBe("build");
  expect(classifyFromChecks(["mystery"])).toBe("unknown");
});
