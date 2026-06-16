import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainStore } from "../src/store.ts";

test("saves and loads a domain by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "htn-store-"));
  const store = new DomainStore(dir);
  store.save("tally-triage", readFileSync("test/fixtures/tally-triage.yaml", "utf8"));
  const loaded = store.load("tally-triage");
  expect(loaded.domain).toBe("tally-triage");
  expect(store.list()).toContain("tally-triage");
});
