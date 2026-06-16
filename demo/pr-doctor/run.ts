#!/usr/bin/env -S npx tsx
/**
 * PR Doctor demo runner.
 *
 * Shows a 4B local model (qwopus-4b-coder) healing a red PR via an authored HTN
 * domain that BACKTRACKS structurally when a repair doesn't work.
 *
 *   1. run the suite -> capture the red output
 *   2. tiny model classifies the failure  (its ONE planning-relevant guess)
 *   3. executeDomain() runs the repair ladder; each failed verify trips a replan
 *      and the HTN climbs to the next rung until green
 *   4. tiny model writes the PR comment; report tool "posts" it
 *
 * Usage:
 *   npx tsx demo/pr-doctor/run.ts [--repo <path>] [--pr <n>] [--model <id>]
 *                                 [--base <url>] [--fake]
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type ShellExec, buildExecRegistry } from "../../src/exec.ts";
import { type StepRecord, executeDomain } from "../../src/executor.ts";
import { FakeSmallModel, LlamaSmallModel, parseModelJson } from "../../src/smallModel.ts";
import { loadDomain } from "../../src/yaml.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(flag: string, def?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const REPO = arg("--repo", join(process.env.HOME ?? "", "code/htn-demos/pr-doctor-demo"))!;
const PR = arg("--pr", "42")!;
// Default to the shared devserver (keeps inference off the local laptop).
const MODEL = arg("--model", "qwopus-coder-9b")!;
const BASE = arg("--base", "http://devserver.zosma.ai:8010/v1")!;
const FAKE = process.argv.includes("--fake");

// Real shell bound to the demo repo. Mirrors pi.exec's ExecResult shape.
function repoShell(cwd: string): ShellExec {
  return (cmd, args) =>
    new Promise((resolve) => {
      const p = spawn(cmd, args, { cwd });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => {
        stdout += d;
      });
      p.stderr.on("data", (d) => {
        stderr += d;
      });
      p.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    });
}

function sh(cwd: string, cmd: string, args: string[]): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd });
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
    });
    p.stderr.on("data", (d) => {
      out += d;
    });
    p.on("close", (code) => resolve({ out, code: code ?? 0 }));
  });
}

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

async function main() {
  console.log(c.bold(`\n  PR Doctor — PR #${PR}  (executor: ${FAKE ? "fake" : MODEL})\n`));

  // 1. Run the suite — capture the red output the model will read.
  const { out: testOut, code } = await sh(REPO, "npm", ["test", "--silent"]);
  console.log(`  ${c.dim("▸")} run tests ............. ${code === 0 ? c.green("✓ green") : c.red("✗ red")}`);
  if (code === 0) {
    console.log(c.yellow("\n  Build is already green — run ./break.sh in the demo repo first.\n"));
    process.exit(0);
  }

  // 2. Tiny model classifies the failure (its single planning-relevant call).
  const classifyPrompt = `A CI job failed. Test output:\n---\n${testOut.slice(0, 1200)}\n---\nClassify the failure. Output JSON only, one field "failure_class", one of: flaky, lint, test. Example: {"failure_class":"flaky"}`;
  let failureClass = "flaky";
  if (FAKE) {
    failureClass = "flaky"; // scripted wrong guess for deterministic demo
  } else {
    const m = new LlamaSmallModel(BASE, MODEL);
    const reply = await m.complete({ prompt: classifyPrompt, worldState: {} });
    failureClass = String((reply as { failure_class?: string }).failure_class ?? "flaky");
  }
  console.log(
    `  ${c.dim("▸")} classify (4B) ......... ${c.cyan(`"${failureClass}"`)}  ${c.dim("← the model's one guess")}`,
  );

  // 3. Execute the HTN repair ladder. Trace each step live.
  const yaml = loadDomain(readFileSync(join(HERE, "pr-doctor.yaml"), "utf8"));
  const smallModel = FAKE
    ? new FakeSmallModel([{ comment: `Reverted the breaking commit to restore green CI on PR #${PR}.` }])
    : new LlamaSmallModel(BASE, MODEL);

  let backtracks = 0;
  let lastApply = "";
  const onStep = (s: StepRecord) => {
    const tool = s.tool;
    if (tool === "verify") {
      // verify only records here when it SUCCEEDED (a throw skips onStep)
      console.log(`  ${c.dim("▸")} verify ................ ${c.green("✓ GREEN")}`);
    } else if (s.task.startsWith("apply-")) {
      lastApply = s.task.replace("apply-", "");
      console.log(`  ${c.dim("▸")} repair: ${lastApply.padEnd(12)} ${c.dim("applied")}`);
    } else if (tool === "report") {
      const note = (s.args as { comment?: string }).comment ?? "(posted)";
      console.log(`  ${c.dim("▸")} report ................ ${c.dim(note)}`);
    }
  };

  // We can't see the red verifies from onStep (a throw skips onStep), so wrap the
  // shell to print the backtrack moments as they happen.
  const baseShell = repoShell(REPO);
  const tracingShell: ShellExec = async (cmd, args) => {
    const res = await baseShell(cmd, args);
    if (args.some((a) => a.includes("verify-green")) && res.code !== 0) {
      console.log(`  ${c.dim("▸")} verify ................ ${c.red("✗ still red")}`);
      console.log(
        `  ${c.yellow("↩")} backtrack ............. ${c.dim(`${lastApply} excluded; planner selects next rung`)}`,
      );
      backtracks++;
    }
    return res;
  };
  const { tools: tracingTools } = buildExecRegistry(yaml, tracingShell);

  const res = await executeDomain(yaml, {
    input: { pr: PR, failure_class: failureClass },
    tools: tracingTools,
    smallModel,
    maxReplans: 6,
    onStep,
  });

  console.log(
    `\n  ${res.ok ? c.green("done ✓") : c.red("escalated ✗")} · ` +
      `${res.steps.filter((s) => s.task.startsWith("apply-")).length} repair attempts · ` +
      `${backtracks} backtracks · failure_class="${failureClass}"\n`,
  );
  if (!res.ok) {
    console.log(c.yellow(`  circuit breaker tripped: ${res.error ?? "max replans"} — would ping a human.\n`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(c.red(`\n  runner error: ${(e as Error).message}\n`));
  process.exit(1);
});

void parseModelJson;
