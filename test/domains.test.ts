import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDomainYaml } from "../src/domains.ts";
import { loadDomain } from "../src/yaml.ts";

test("falls back to the shipped built-in pr-ci domain", () => {
  const r = resolveDomainYaml("pr-ci", { storeDir: mkdtempSync(join(tmpdir(), "htn-empty-")) });
  expect(r.kind).toBe("builtin");
  expect(loadDomain(r.yamlText).domain).toBe("pr-ci");
});

test("a repo's own .pi-htn/<name>.yaml wins over the built-in", () => {
  const repo = mkdtempSync(join(tmpdir(), "htn-repo-"));
  mkdirSync(join(repo, ".pi-htn"), { recursive: true });
  writeFileSync(
    join(repo, ".pi-htn", "pr-ci.yaml"),
    "domain: pr-ci\nworldState: { x: 1 }\nroot: { name: r, type: sequence, tasks: [{ name: t, operator: { tool: noop } }] }\n",
  );
  const r = resolveDomainYaml("pr-ci", { repoDir: repo });
  expect(r.kind).toBe("repo");
  expect(loadDomain(r.yamlText).root.tasks.length).toBe(1);
});

test("throws a helpful error when nothing matches", () => {
  expect(() => resolveDomainYaml("nope", { storeDir: mkdtempSync(join(tmpdir(), "htn-x-")) }))
    .toThrow(/No domain 'nope'/);
});
