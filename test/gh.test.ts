import { expect, test } from "vitest";
import type { ShellResult } from "../src/exec.ts";
import { GhClient, parseChecks } from "../src/watcher/gh.ts";

test("parseChecks: any failure => red with failing names", () => {
  const s = parseChecks([
    { name: "build", bucket: "pass" },
    { name: "test", bucket: "fail" },
    { name: "lint", bucket: "pending" },
  ]);
  expect(s.state).toBe("red");
  expect(s.failing).toEqual(["test"]);
});

test("parseChecks: pending (no failures) => pending", () => {
  expect(parseChecks([{ name: "ci", bucket: "pending" }]).state).toBe("pending");
});

test("parseChecks: all pass => green; empty => none", () => {
  expect(parseChecks([{ name: "ci", bucket: "pass" }]).state).toBe("green");
  expect(parseChecks([]).state).toBe("none");
});

test("GhClient.checks parses stdout even when gh exits non-zero", async () => {
  const shell = async (): Promise<ShellResult> => ({
    stdout: JSON.stringify([{ name: "e2e", bucket: "fail" }]),
    stderr: "",
    code: 8, // gh pr checks exits non-zero on failing checks
  });
  const gh = new GhClient(shell);
  const s = await gh.checks(42);
  expect(s.state).toBe("red");
  expect(s.failing).toEqual(["e2e"]);
});
