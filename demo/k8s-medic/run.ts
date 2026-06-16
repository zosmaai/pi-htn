#!/usr/bin/env -S npx tsx
/**
 * k8s-medic demo runner — self-heal a broken Kubernetes deployment.
 *
 * On a REAL cluster (current kubectl context), this:
 *   1. ensures a throwaway deployment, then BREAKS it (bad image tag ->
 *      ImagePullBackOff)
 *   2. diagnoses the failure (pod state + current image) via kubectl
 *   3. asks a small model to propose a concrete remediation (a corrected,
 *      pullable image) — its narrow, planning-relevant work, HOISTED to plan
 *      input (`action` + `image`)
 *   4. runs executeDomain(): rung 1 applies the model's image and verifies the
 *      rollout; if it doesn't go Ready the executor replans and climbs to a
 *      deterministic restore-to-known-good rung
 *   5. the model writes a one-sentence incident note; report.sh annotates the
 *      deployment with it
 *
 * Usage:
 *   npx tsx demo/k8s-medic/run.ts [--ns <ns>] [--deploy <name>]
 *     [--good-image <ref>] [--bad-image <ref>] [--model <id>] [--base <url>]
 *     [--fake] [--no-break] [--cleanup]
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExecRegistry, type ShellExec } from "../../src/exec.ts";
import { executeDomain, type StepRecord } from "../../src/executor.ts";
import { readFileSync } from "node:fs";
import { FakeSmallModel, LlamaSmallModel } from "../../src/smallModel.ts";
import { loadDomain } from "../../src/yaml.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "scripts");

function arg(flag: string, def?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (flag: string) => process.argv.includes(flag);

const NS = arg("--ns", "htn-demo")!;
const DEPLOY = arg("--deploy", "web")!;
const GOOD_IMAGE = arg("--good-image", "nginx:1.27-alpine")!;
const BAD_IMAGE = arg("--bad-image", "nginx:9.9.9-htndemo-bad")!;
// Default to the shared devserver (keeps the executor off the local laptop).
const MODEL = arg("--model", "qwopus-coder-9b")!;
const BASE = arg("--base", "http://devserver.zosma.ai:8010/v1")!;
const FAKE = has("--fake");

// Plain spawn -> { out, code } for setup/break steps.
function sh(cmd: string, args: string[]): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ out, code: code ?? 0 }));
  });
}
// Shell injected into the HTN tool registry (mirrors pi.exec's ExecResult).
function clusterShell(): ShellExec {
  return (cmd, args) =>
    new Promise((resolve) => {
      const p = spawn(cmd, args);
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
const row = (label: string, val: string) =>
  console.log(`  ${c.dim("▸")} ${label.padEnd(22, ".")} ${val}`);

async function main() {
  console.log(
    c.bold(`\n  k8s-medic — ${NS}/${DEPLOY}  (executor: ${FAKE ? "fake" : MODEL})\n`),
  );

  // 0. Ensure namespace + a healthy deployment on the known-good image.
  await sh("bash", [
    "-c",
    `kubectl get ns ${NS} >/dev/null 2>&1 || kubectl create ns ${NS} >/dev/null 2>&1; ` +
      `kubectl -n ${NS} get deploy ${DEPLOY} >/dev/null 2>&1 || ` +
      `kubectl -n ${NS} create deployment ${DEPLOY} --image=${GOOD_IMAGE} --replicas=1 >/dev/null 2>&1`,
  ]);
  await sh("bash", [SCRIPTS_BIN("apply-image.sh"), NS, DEPLOY, GOOD_IMAGE]);
  await sh("kubectl", ["-n", NS, "rollout", "status", `deploy/${DEPLOY}`, "--timeout=60s"]);
  row("baseline", c.green(`Ready on ${GOOD_IMAGE}`));

  // 1. Break it (unless told not to) — bad image tag -> ImagePullBackOff.
  if (!has("--no-break")) {
    await sh("kubectl", ["-n", NS, "set", "image", `deploy/${DEPLOY}`, `*=${BAD_IMAGE}`]);
    row("inject fault", c.red(`set image → ${BAD_IMAGE}`));
  }

  // 2. Diagnose: read the pod failure + current image off the cluster.
  const diag = await sh("bash", [SCRIPTS_BIN("diagnose.sh"), NS, DEPLOY]);
  const { reason, image } = JSON.parse(diag.out.trim()) as { reason: string; image: string };
  row("diagnose", c.red(`${reason}`) + c.dim(`  (image=${image})`));

  // 3. Small model proposes a concrete remediation (HOISTED to plan input).
  const classifyPrompt =
    `A Kubernetes deployment is failing. Diagnosis: pods are in state "${reason}" ` +
    `and the current container image is "${image}". Propose a corrected, valid, ` +
    `publicly pullable image to roll out for this app. ` +
    `Output JSON only: {"action":"set-image","image":"<image:tag>"}`;
  const model = FAKE
    ? new FakeSmallModel([
        // deliberately propose ANOTHER bad image to force a backtrack
        { action: "set-image", image: "nginx:0.0.0-still-broken" },
        { note: `Restored ${DEPLOY} to the last-known-good image after a bad rollout.` },
      ])
    : new LlamaSmallModel(BASE, MODEL);
  let action = "set-image";
  let proposed = GOOD_IMAGE;
  const reply = await model.complete({ prompt: classifyPrompt, worldState: {} });
  action = String((reply as { action?: string }).action ?? "set-image");
  proposed = String((reply as { image?: string }).image ?? GOOD_IMAGE).trim();
  row("model proposes", c.cyan(`${action} → ${proposed}`));

  // 4. Run the HTN heal ladder, tracing backtracks live.
  const yaml = loadDomain(readFileSync(join(HERE, "k8s-medic.yaml"), "utf8"));
  let backtracks = 0;
  let lastStrategy = "";
  const onStep = (s: StepRecord) => {
    if (s.tool === "verify") {
      row("verify rollout", c.green("✓ Ready"));
    } else if (s.task.startsWith("apply-")) {
      lastStrategy = s.task === "apply-model" ? "model image" : "restore known-good";
      row(`repair: ${lastStrategy}`, c.dim("applied"));
    } else if (s.tool === "report") {
      const note = (s.args as { note?: string }).note ?? "(annotated)";
      row("report", c.dim(note));
    }
  };
  // verify throws on failure (skipping onStep), so wrap the shell to surface
  // the backtrack moment.
  const base = clusterShell();
  const tracingShell: ShellExec = async (cmd, args) => {
    const res = await base(cmd, args);
    if (args.some((a) => a.includes("verify-rollout.sh")) && res.code !== 0) {
      row("verify rollout", c.red("✗ not Ready"));
      console.log(
        `  ${c.yellow("↩")} ${"backtrack".padEnd(22, ".")} ` +
          c.dim("rung excluded; planner climbs to the safety net"),
      );
      backtracks++;
    }
    return res;
  };
  const { tools } = buildExecRegistry(yaml, tracingShell);
  const res = await executeDomain(yaml, {
    input: {
      ns: NS,
      deploy: DEPLOY,
      scriptdir: SCRIPTS,
      good_image: GOOD_IMAGE,
      action,
      image: proposed,
      reason,
    },
    tools,
    smallModel: model,
    maxReplans: 6,
    onStep,
  });

  const attempts = res.steps.filter((s) => s.task.startsWith("apply-")).length;
  console.log(
    `\n  ${res.ok ? c.green("done ✓") : c.red("escalated ✗")} · ` +
      `${attempts} repair attempt(s) · ${backtracks} backtrack(s) · ` +
      `strategy="${lastStrategy}"\n`,
  );

  if (has("--cleanup")) {
    await sh("kubectl", ["delete", "namespace", NS, "--wait=false"]);
    console.log(c.dim(`  --cleanup: deleting namespace ${NS}.\n`));
  } else {
    console.log(
      c.dim(`  inspect:  kubectl -n ${NS} get deploy/${DEPLOY} -o wide\n`) +
        c.dim(`  incident: kubectl -n ${NS} get deploy/${DEPLOY} -o jsonpath='{.metadata.annotations.htn\\.medic/last-incident}'\n`) +
        c.dim(`  cleanup:  kubectl delete namespace ${NS}\n`),
    );
  }
}

function SCRIPTS_BIN(name: string): string {
  return join(SCRIPTS, name);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
