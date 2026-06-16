#!/usr/bin/env -S npx tsx
/**
 * pi-htn-watch — watch a PR (or every open PR) and heal its CI until merge-ready.
 *
 * Red checks -> classify the failure -> run the HTN repair ladder (pr-ci, or the
 * repo's own .pi-htn/<domain>.yaml) -> push the fix -> re-check `gh`. The HTN
 * backtracks across rounds (each tried rung is excluded) and every outcome is
 * recorded to the self-learning playbook so the next run tries the historically
 * best strategy first. The small model runs on the shared devserver by default.
 *
 * Usage:
 *   pi-htn-watch --repo <path> --pr <n> [--domain pr-ci]
 *   pi-htn-watch --repo <path> --all
 *   pi-htn-watch --repo <path> --pr <n> --interval 60   # poll forever
 *   [--model <id>] [--base <url>] [--max-rounds 5] [--poll 30] [--fake] [--no-checkout]
 */
import { spawn } from "node:child_process";

import { GhClient } from "../src/watcher/gh.ts";
import { watchPr, defaultHeal, type WatchEvent } from "../src/watcher/watcher.ts";
import { Playbook } from "../src/learn/playbook.ts";
import { resolveDomainYaml } from "../src/domains.ts";
import { loadDomain } from "../src/yaml.ts";
import { LlamaSmallModel, FakeSmallModel } from "../src/smallModel.ts";
import { JsonlLogger } from "../src/log.ts";
import { effectiveSettings } from "../src/settings.ts";
import type { ShellExec } from "../src/exec.ts";

function arg(flag: string, def?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (flag: string) => process.argv.includes(flag);

// Defaults come from saved settings (/htn settings) with env override; flags win.
const cfg = effectiveSettings();
const REPO = arg("--repo", process.cwd())!;
const DOMAIN = arg("--domain", cfg.domain)!;
const MODEL = arg("--model", cfg.model)!;
const BASE = arg("--base", cfg.modelBase)!;
const MAX_ROUNDS = Number(arg("--max-rounds", String(cfg.maxRounds)));
const POLL_MS = Number(arg("--poll", String(cfg.pollSeconds))) * 1000;
const INTERVAL = arg("--interval") ? Number(arg("--interval")) * 1000 : 0;
const FAKE = has("--fake");
const NO_CHECKOUT = has("--no-checkout");

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// Shell bound to the repo cwd, shaped like pi.exec's ExecResult.
function repoShell(cwd: string): ShellExec {
  return (cmd, args) =>
    new Promise((resolve) => {
      const p = spawn(cmd, args, { cwd });
      let stdout = "", stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    });
}

function onEvent(pr: number | string) {
  return (e: WatchEvent) => {
    const tag = e.type === "checks" ? c.dim("checks") : e.type === "heal" ? c.yellow("heal ") : c.cyan("done ");
    console.log(`  ${c.dim(`#${pr}`)} ${tag} ${c.dim(`r${e.round}`)} ${e.message}`);
  };
}

async function watchOne(pr: number | string, shell: ShellExec, gh: GhClient, playbook: Playbook) {
  const resolved = resolveDomainYaml(DOMAIN, { repoDir: REPO });
  const domain = loadDomain(resolved.yamlText);
  console.log(c.bold(`\n  PR #${pr} · domain '${DOMAIN}' (${resolved.kind}) · executor ${FAKE ? "fake" : MODEL}`));

  if (!NO_CHECKOUT && !FAKE) await shell("gh", ["pr", "checkout", String(pr)]);

  const smallModel = FAKE ? new FakeSmallModel([]) : new LlamaSmallModel(BASE, MODEL);
  const heal = defaultHeal({ domain, shell, smallModel, playbook, repo: REPO, pr, logger: new JsonlLogger(), maxReplans: MAX_ROUNDS + 1 });

  const res = await watchPr(
    { repo: REPO, pr, maxRounds: MAX_ROUNDS, pollMs: POLL_MS },
    { gh, heal, playbook, onEvent: onEvent(pr) },
  );

  const tag = res.mergeReady ? c.green("✓ merge-ready") : c.red("✗ not merge-ready");
  console.log(`  ${tag} · ${res.reason} · ${res.rounds.length} round(s)\n`);
  return res.mergeReady;
}

async function pass(): Promise<boolean> {
  const shell = repoShell(REPO);
  const gh = new GhClient(shell);
  const playbook = new Playbook();

  let targets: (number | string)[];
  if (has("--all")) {
    targets = (await gh.listOpen()).map((p) => p.number);
    console.log(c.dim(`  ${targets.length} open PR(s): ${targets.join(", ") || "none"}`));
  } else {
    const pr = arg("--pr");
    if (!pr) { console.error("Need --pr <n> or --all"); process.exit(2); }
    targets = [pr!];
  }

  let allReady = true;
  for (const pr of targets) allReady = (await watchOne(pr, shell, gh, playbook)) && allReady;
  return allReady;
}

async function main() {
  if (INTERVAL > 0) {
    console.log(c.dim(`  continuous mode: polling every ${INTERVAL / 1000}s (Ctrl-C to stop)`));
    for (;;) {
      await pass().catch((e) => console.error(c.red(`  pass error: ${e.message}`)));
      await new Promise((r) => setTimeout(r, INTERVAL));
    }
  }
  const ok = await pass();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
