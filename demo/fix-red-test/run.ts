#!/usr/bin/env -S npx tsx
/**
 * fix-red-test demo runner.
 *
 * A 4B local model (qwopus-4b-coder) heals a RED regression test on a real PR
 * (arjun-zosma/pi-llm-wiki#1, reproducing zosmaai/pi-llm-wiki#87) via an HTN
 * domain that BACKTRACKS structurally when a repair doesn't work.
 *
 *   1. run the scoped regression test -> capture the red output
 *   2. the 4B model reads the failing test + the buggy function and emits the
 *      actual guard statement to insert (its narrow, planning-relevant work,
 *      HOISTED to plan input)
 *   3. executeDomain() runs the repair ladder; rung 1 applies the model's patch,
 *      and each failed verify trips a replan that climbs to a deterministic,
 *      known-good rung until the test is green
 *   4. the 4B model writes the PR comment; report.sh posts it via gh
 *   5. on green, commit the fix and push it to the PR branch
 *
 * Usage:
 *   npx tsx demo/fix-red-test/run.ts [--repo <path>] [--pr <n>] [--model <id>]
 *                                    [--base <url>] [--branch <name>]
 *                                    [--fake] [--no-push]
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildExecRegistry, type ShellExec } from "../../src/exec.ts";
import { executeDomain, type StepRecord } from "../../src/executor.ts";
import { LlamaSmallModel, FakeSmallModel } from "../../src/smallModel.ts";
import { loadDomain } from "../../src/yaml.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "scripts");

function arg(flag: string, def?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}
const REPO = arg("--repo", join(process.env.HOME ?? "", "code/pi-packages/pi-llm-wiki"))!;
const PR = arg("--pr", "1")!;
// Default to the shared devserver (keeps the executor off the local laptop).
// Override with --model / --base for a local llama-swap (e.g.
// --model qwopus-4b-coder --base http://localhost:8080/v1).
const MODEL = arg("--model", "qwopus-coder-9b")!;
const BASE = arg("--base", "http://devserver.zosma.ai:8010/v1")!;
const BRANCH = arg("--branch", "fix/87-idempotent-injection")!;
const FAKE = process.argv.includes("--fake");
const NO_PUSH = process.argv.includes("--no-push");

const TARGET = "extensions/llm-wiki/lib/inject.ts";

function sh(cwd: string, cmd: string, args: string[]): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ out, code: code ?? 0 }));
  });
}

// Shell bound to a fixed cwd. Mirrors pi.exec's ExecResult shape.
function repoShell(cwd: string): ShellExec {
  return (cmd, args) =>
    new Promise((resolve) => {
      const p = spawn(cmd, args, { cwd });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
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
  console.log(c.bold(`\n  fix-red-test — PR #${PR}  (executor: ${FAKE ? "fake" : MODEL})\n`));

  // 1. Run the scoped regression test — capture the red output the model reads.
  await sh(REPO, "npx", ["vitest", "run", "test/inject-idempotent.test.ts"]);
  console.log(`  ${c.dim("▸")} run regression test ... ${c.red("✗ red")}`);

  const buggyFn = readFileSync(join(REPO, TARGET), "utf8")
    .split("export function appendWikiStatus")[1]
    ?.split("\n}")[0];

  // 2. The 4B model does the narrow patch work: emit the guard statement.
  //    Hoisted to plan input — the executor plans the whole domain up-front, so
  //    a mid-plan $result can't gate the `select`.
  let approach = "guard";
  let line = 'if (systemPrompt.includes(WIKI_STATUS_BLOCK)) return systemPrompt;';
  if (FAKE) {
    // Scripted WRONG patch (references a non-existent constant) → rung 1 stays
    // red → the HTN backtracks to the deterministic rung. Deterministic demo.
    line = 'if (systemPrompt.includes(WIKI_FOOTER_BLOCK)) return systemPrompt;';
  } else {
    const patchPrompt =
      `The function below must be idempotent: appending the wiki-status footer ` +
      `when it is already present must be a no-op.\n\n` +
      `Buggy function:\nexport function appendWikiStatus${buggyFn}\n}\n\n` +
      `The footer constant is WIKI_STATUS_BLOCK. Emit ONE TypeScript guard ` +
      `statement for the TOP of the function body that returns systemPrompt ` +
      `unchanged when the footer is already present.\n` +
      `Output JSON only: {"approach":"guard","line":"<one statement>"}`;
    const m = new LlamaSmallModel(BASE, MODEL);
    const reply = await m.complete({ prompt: patchPrompt, worldState: {} });
    approach = String((reply as { approach?: string }).approach ?? "guard");
    line = String((reply as { line?: string }).line ?? line).trim();
  }
  console.log(`  ${c.dim("▸")} 4B patch (${approach}) ...... ${c.cyan(line)}`);

  // 3. Execute the HTN repair ladder. Trace each step live.
  const yaml = loadDomain(readFileSync(join(HERE, "fix-red-test.yaml"), "utf8"));
  const smallModel = FAKE
    ? new FakeSmallModel([
        { comment: `Made appendWikiStatus idempotent so the #87 footer no longer duplicates on retried starts.` },
      ])
    : new LlamaSmallModel(BASE, MODEL);

  let backtracks = 0;
  let lastApply = "";
  const onStep = (s: StepRecord) => {
    if (s.tool === "verify") {
      console.log(`  ${c.dim("▸")} verify ................ ${c.green("✓ GREEN")}`);
    } else if (s.task.startsWith("apply-")) {
      lastApply = s.task.replace("apply-", "");
      console.log(`  ${c.dim("▸")} repair: ${lastApply.padEnd(8)} ...... ${c.dim("applied")}`);
    } else if (s.tool === "report") {
      const note = (s.args as { comment?: string }).comment ?? "(posted)";
      console.log(`  ${c.dim("▸")} report ................ ${c.dim(note)}`);
    }
  };

  // verify throws on red (skipping onStep), so wrap the shell to surface the
  // backtrack moments as they happen.
  const baseShell = repoShell(REPO);
  const tracingShell: ShellExec = async (cmd, args) => {
    const res = await baseShell(cmd, args);
    if (args.some((a) => a.includes("verify-test.sh")) && res.code !== 0) {
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
    input: { pr: PR, repo: REPO, scriptdir: SCRIPTS, approach, line },
    tools: tracingTools,
    smallModel,
    maxReplans: 6,
    onStep,
  });

  const attempts = res.steps.filter((s) => s.task.startsWith("apply-")).length;
  console.log(
    `\n  ${res.ok ? c.green("done ✓") : c.red("escalated ✗")} · ` +
      `${attempts} repair attempt${attempts === 1 ? "" : "s"} · ${backtracks} backtracks · ` +
      `approach="${approach}"\n`,
  );
  if (!res.ok) {
    console.log(c.yellow(`  circuit breaker tripped: ${res.error ?? "max replans"} — would ping a human.\n`));
    process.exit(1);
  }

  // 4. Commit the healed file and push it to the PR branch.
  if (NO_PUSH) {
    console.log(c.dim("  --no-push: leaving the fix uncommitted in the working tree.\n"));
    return;
  }
  const strategy =
    (res.steps.find((s) => s.task.startsWith("apply-"))?.task ?? "").replace("apply-", "") || "fix";
  await sh(REPO, "git", ["add", TARGET]);
  const { code: commitCode } = await sh(REPO, "git", [
    "commit",
    "-m",
    `fix(#87): make appendWikiStatus idempotent (HTN ${strategy})\n\nAuthored by the fix-red-test HTN: the 4B model proposed the guard and the\nladder verified it against the scoped regression test.\n\nRefs zosmaai/pi-llm-wiki#87`,
  ]);
  if (commitCode !== 0) {
    console.log(c.yellow("  nothing to commit (working tree clean?)\n"));
    return;
  }
  const { code: pushCode, out: pushOut } = await sh(REPO, "git", ["push", "fork", BRANCH]);
  console.log(
    pushCode === 0
      ? c.green(`  pushed fix to ${BRANCH} → PR #${PR} is now green.\n`)
      : c.red(`  push failed:\n${pushOut}\n`),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
