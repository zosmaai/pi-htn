import { test, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlLogger } from "../src/log.ts";

test("logs small-model outputs and failures to separate jsonl streams", () => {
  const dir = mkdtempSync(join(tmpdir(), "htn-log-"));
  const log = new JsonlLogger(dir);
  log.smallModel("reply", "draft {{body}}", { body: "hi" });
  log.failure("author:x#0", "validate", "no plan for {intent:impossible}");

  const sm = JSON.parse(readFileSync(join(dir, "smallmodel.jsonl"), "utf8").trim());
  expect(sm.task).toBe("reply");
  expect(sm.output).toEqual({ body: "hi" });

  const f = JSON.parse(readFileSync(join(dir, "failures.jsonl"), "utf8").trim());
  expect(f.kind).toBe("validate");
  expect(existsSync(join(dir, "failures.jsonl"))).toBe(true);
});
