import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { ShellResult } from "../src/exec.ts";
import { Playbook } from "../src/learn/playbook.ts";
import { FakeSmallModel } from "../src/smallModel.ts";
import { GhClient } from "../src/watcher/gh.ts";
import { defaultHeal, watchPr } from "../src/watcher/watcher.ts";
import { loadDomain } from "../src/yaml.ts";

// Drives the REAL heal path (built-in pr-ci -> buildExecRegistry -> executeDomain)
// through the watcher. The fake shell turns checks green once a repair has run.
test("built-in pr-ci heals a red 'test' PR end to end via the watcher", async () => {
  const domain = loadDomain(readFileSync("src/domains/pr-ci.yaml", "utf8"));
  const pb = new Playbook(mkdtempSync(join(tmpdir(), "htn-int-")));

  let repaired = false;
  const shell = async (cmd: string, args: string[]): Promise<ShellResult> => {
    if (cmd === "gh" && args[0] === "pr" && args[1] === "checks") {
      const rows = repaired
        ? [{ name: "unit-tests", bucket: "pass" }]
        : [{ name: "unit-tests", bucket: "fail" }];
      return { stdout: JSON.stringify(rows), stderr: "", code: repaired ? 0 : 8 };
    }
    if (cmd === "bash") {
      repaired = true;
      return { stdout: "", stderr: "", code: 0 };
    } // lint-fix ran
    return { stdout: "", stderr: "", code: 0 };
  };

  const gh = new GhClient(shell);
  const heal = defaultHeal({
    domain,
    shell,
    smallModel: new FakeSmallModel([]),
    playbook: pb,
    repo: "r",
    pr: 5,
  });
  const res = await watchPr(
    { repo: "r", pr: 5, pollMs: 0 },
    { gh, heal, playbook: pb, sleep: async () => {} },
  );

  expect(res.mergeReady).toBe(true);
  expect(res.reason).toBe("healed");
  expect(pb.best("test")).toBe("lint-fix"); // recorded + learnable
});
