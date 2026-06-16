import type { ExtensionAPI, ExtensionFactory, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DomainStore } from "./store.ts";
import { buildAuthorPrompt } from "./author.ts";
import { extractTrace } from "./recorder.ts";
import { authorCandidates } from "./commands/author.ts";
import { executeDomain } from "./executor.ts";
import { buildExecRegistry } from "./exec.ts";
import { JsonlLogger } from "./log.ts";
import { completeText, PiSmallModel, type ModelLike, type RegistryLike } from "./commands/piModel.ts";
import { GhClient } from "./watcher/gh.ts";
import { watchPr, defaultHeal } from "./watcher/watcher.ts";
import { Playbook } from "./learn/playbook.ts";
import { resolveDomainYaml } from "./domains.ts";
import { loadDomain } from "./yaml.ts";
import type { ShellExec } from "./exec.ts";
import type { WorldState } from "./types.ts";

const N_CANDIDATES = 3;

// Parse "intent=bug body=crash" -> { intent: "bug", body: "crash" }.
function parseInput(parts: string[]): WorldState {
  const ws: WorldState = {};
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i > 0) ws[p.slice(0, i)] = p.slice(i + 1);
  }
  return ws;
}

const extension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerCommand("htn", {
    description: "Author and run reusable HTN domains",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // Capture ctx surfaces synchronously BEFORE any await (stale-ctx guard).
      const ui = ctx.ui;
      const sessionManager = ctx.sessionManager;
      const model = ctx.model as ModelLike | undefined;
      const registry = ctx.modelRegistry as unknown as RegistryLike;
      const signal = ctx.signal;

      const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const store = new DomainStore();
      const logger = new JsonlLogger();

      try {
        if (sub === "list") {
          const names = store.list();
          ui.notify(`HTN domains: ${names.join(", ") || "(none)"}`, "info");
          return;
        }

        if (sub === "author") {
          const name = rest[0];
          if (!name) return ui.notify("Usage: /htn author <name>", "warning");
          if (!model) return ui.notify("No active model to author with.", "error");

          const sessionFile = sessionManager.getSessionFile();
          if (!sessionFile) return ui.notify("No session file to read a trace from.", "warning");
          const trace = extractTrace(sessionFile);
          if (trace.length === 0)
            return ui.notify("No tool calls in this session to author from.", "warning");

          ui.notify(`Authoring '${name}' from ${trace.length} tool calls — sampling ${N_CANDIDATES} candidates…`, "info");
          const prompt = buildAuthorPrompt(name, trace);
          const replies = await Promise.all(
            Array.from({ length: N_CANDIDATES }, () =>
              completeText(model, registry, prompt, { temperature: 0.8, signal }).catch((e) => `ERROR: ${e.message}`),
            ),
          );
          const { candidates, chosen } = authorCandidates(name, sessionFile, replies, logger);
          if (!chosen) {
            const why = candidates.map((c) => `#${c.index}: ${c.failures[0] ?? "?"}`).join(" | ");
            return ui.notify(`No candidate passed validation. ${why}`, "error");
          }
          store.save(name, chosen.yamlText!);
          ui.notify(`Saved domain '${name}' (candidate #${chosen.index}, score ${chosen.score}). Run with /htn run ${name}`, "info");
          return;
        }

        if (sub === "run") {
          const name = rest[0];
          if (!name) return ui.notify("Usage: /htn run <name> [key=value …]", "warning");
          const yaml = store.load(name);
          const input = parseInput(rest.slice(1));

          // Extensions can't invoke pi's own tools, but pi.exec() runs real shell.
          // Operators with an `exec:` block execute for real; operators without one
          // fall back to a safe dry-run echo. Mixed domains are fine.
          const { tools, live, dryRun } = buildExecRegistry(yaml, async (cmd, a) => {
            const r = await pi.exec(cmd, a);
            return { stdout: r.stdout, stderr: r.stderr, code: r.code, killed: r.killed };
          });

          const smallModel = model
            ? new PiSmallModel(model, registry, signal)
            : { async complete() { return {}; } };

          const mode =
            live.length === 0 ? "dry-run" : dryRun.length === 0 ? "live" : `live: ${live.join(",")}`;
          ui.notify(`Running '${name}' (${mode})…`, "info");
          const result = await executeDomain(yaml, { input, tools, smallModel, logger });
          const steps = result.steps.map((s) => `${s.task}→${s.tool}`).join(", ") || "(none)";
          const ws = JSON.stringify(result.finalWorldState);
          ui.notify(
            result.ok
              ? `✓ ran '${name}': [${steps}] · final state ${ws}`
              : `✗ '${name}' failed: ${result.error} · steps [${steps}]`,
            result.ok ? "info" : "error",
          );
          return;
        }

        if (sub === "watch") {
          const pr = rest.find((r) => /^\d+$/.test(r));
          if (!pr) return ui.notify("Usage: /htn watch <prNumber> [domain]", "warning");
          const domainName = rest.find((r) => !/^\d+$/.test(r)) ?? "pr-ci";
          const repo = ctx.cwd;
          const shell: ShellExec = async (cmd, a) => {
            const r = await pi.exec(cmd, a);
            return { stdout: r.stdout, stderr: r.stderr, code: r.code, killed: r.killed };
          };
          const resolved = resolveDomainYaml(domainName, { repoDir: repo });
          const domain = loadDomain(resolved.yamlText);
          const playbook = new Playbook();
          const gh = new GhClient(shell);
          const smallModel = model
            ? new PiSmallModel(model, registry, signal)
            : { async complete() { return {}; } };
          const heal = defaultHeal({ domain, shell, smallModel, playbook, repo, pr, logger, maxReplans: 6 });
          ui.notify(`Watching PR #${pr} with '${domainName}' (${resolved.kind})…`, "info");
          const res = await watchPr(
            { repo, pr, maxRounds: 5, pollMs: 15_000 },
            { gh, heal, playbook, onEvent: (e) => ui.notify(`#${pr} ${e.type} r${e.round}: ${e.message}`, "info") },
          );
          ui.notify(
            res.mergeReady
              ? `✓ PR #${pr} merge-ready (${res.reason}, ${res.rounds.length} round(s))`
              : `✗ PR #${pr} not merge-ready: ${res.reason}`,
            res.mergeReady ? "info" : "error",
          );
          return;
        }

        ui.notify("Usage: /htn [author|run|watch|list] <name|pr>", "warning");
      } catch (e) {
        ui.notify(`/htn error: ${(e as Error).message}`, "error");
      }
    },
  });
};

export default extension;
