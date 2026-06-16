import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { buildAuthorPrompt } from "./author.ts";
import { authorCandidates } from "./commands/author.ts";
import { htnArgumentCompletions } from "./commands/complete.ts";
import { type ModelLike, PiSmallModel, type RegistryLike, completeText } from "./commands/piModel.ts";
import { resolveDomainYaml } from "./domains.ts";
import { buildExecRegistry } from "./exec.ts";
import type { ShellExec } from "./exec.ts";
import { executeDomain } from "./executor.ts";
import { Playbook } from "./learn/playbook.ts";
import { JsonlLogger } from "./log.ts";
import { extractTrace } from "./recorder.ts";
import {
  SETTING_FIELDS,
  coerceField,
  effectiveSettings,
  fieldByKey,
  loadSettings,
  resetSettings,
  saveSettings,
  summarizeSettings,
} from "./settings.ts";
import { DomainStore } from "./store.ts";
import type { WorldState } from "./types.ts";
import { GhClient } from "./watcher/gh.ts";
import { defaultHeal, watchPr } from "./watcher/watcher.ts";
import { loadDomain } from "./yaml.ts";

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
    // Tab-completion for subcommands, settings keys, and stored domain names.
    getArgumentCompletions: (prefix: string) => {
      try {
        return htnArgumentCompletions(prefix, new DomainStore().list());
      } catch {
        return htnArgumentCompletions(prefix, []);
      }
    },
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

          ui.notify(
            `Authoring '${name}' from ${trace.length} tool calls — sampling ${N_CANDIDATES} candidates…`,
            "info",
          );
          const prompt = buildAuthorPrompt(name, trace);
          const replies = await Promise.all(
            Array.from({ length: N_CANDIDATES }, () =>
              completeText(model, registry, prompt, { temperature: 0.8, signal }).catch(
                (e) => `ERROR: ${e.message}`,
              ),
            ),
          );
          const { candidates, chosen } = authorCandidates(name, sessionFile, replies, logger);
          if (!chosen) {
            const why = candidates.map((c) => `#${c.index}: ${c.failures[0] ?? "?"}`).join(" | ");
            return ui.notify(`No candidate passed validation. ${why}`, "error");
          }
          store.save(name, chosen.yamlText!);
          ui.notify(
            `Saved domain '${name}' (candidate #${chosen.index}, score ${chosen.score}). Run with /htn run ${name}`,
            "info",
          );
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
            : {
                async complete() {
                  return {};
                },
              };

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

        if (sub === "settings") {
          const [key, ...vrest] = rest;

          // Non-interactive paths: show / reset / quick-set <key> <value>.
          if (key === "show" || (!key && !ctx.hasUI)) {
            return ui.notify(summarizeSettings(effectiveSettings()), "info");
          }
          if (key === "reset") {
            resetSettings();
            return ui.notify(`Reset. ${summarizeSettings(effectiveSettings())}`, "info");
          }
          if (key && vrest.length) {
            const field = fieldByKey(key);
            if (!field)
              return ui.notify(
                `Unknown setting '${key}'. Keys: ${SETTING_FIELDS.map((f) => f.key).join(", ")}`,
                "warning",
              );
            try {
              saveSettings({ [field.key]: coerceField(field, vrest.join(" ")) });
              return ui.notify(summarizeSettings(effectiveSettings()), "info");
            } catch (e) {
              return ui.notify(`Invalid ${field.key}: ${(e as Error).message}`, "error");
            }
          }
          if (!ctx.hasUI)
            return ui.notify("No interactive UI. Use: /htn settings <key> <value> | show | reset", "warning");

          // Interactive panel: pick a field -> edit -> persist, looping until Done.
          for (;;) {
            const file = loadSettings();
            const eff = effectiveSettings();
            const labels = SETTING_FIELDS.map((f) => `${f.label}: ${file[f.key] ?? eff[f.key]}`);
            const RESET = "Reset to defaults";
            const DONE = "Done";
            const choice = await ui.select("pi-htn settings", [...labels, RESET, DONE]);
            if (!choice || choice === DONE) break;
            if (choice === RESET) {
              resetSettings();
              continue;
            }
            const field = SETTING_FIELDS[labels.indexOf(choice)];
            if (!field) continue;
            const cur = String(file[field.key] ?? eff[field.key]);
            const val = await ui.input(field.label, cur);
            if (val === undefined) continue; // cancelled
            try {
              saveSettings({ [field.key]: coerceField(field, val) });
            } catch (e) {
              ui.notify(`Invalid ${field.key}: ${(e as Error).message}`, "error");
            }
          }
          return ui.notify(summarizeSettings(effectiveSettings()), "info");
        }

        if (sub === "watch") {
          const pr = rest.find((r) => /^\d+$/.test(r));
          if (!pr) return ui.notify("Usage: /htn watch <prNumber> [domain]", "warning");
          const cfg = effectiveSettings();
          const domainName = rest.find((r) => !/^\d+$/.test(r)) ?? cfg.domain;
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
            : {
                async complete() {
                  return {};
                },
              };
          const heal = defaultHeal({ domain, shell, smallModel, playbook, repo, pr, logger, maxReplans: 6 });
          ui.notify(`Watching PR #${pr} with '${domainName}' (${resolved.kind})…`, "info");
          const res = await watchPr(
            { repo, pr, maxRounds: cfg.maxRounds, pollMs: cfg.pollSeconds * 1000 },
            {
              gh,
              heal,
              playbook,
              onEvent: (e) => ui.notify(`#${pr} ${e.type} r${e.round}: ${e.message}`, "info"),
            },
          );
          ui.notify(
            res.mergeReady
              ? `✓ PR #${pr} merge-ready (${res.reason}, ${res.rounds.length} round(s))`
              : `✗ PR #${pr} not merge-ready: ${res.reason}`,
            res.mergeReady ? "info" : "error",
          );
          return;
        }

        ui.notify("Usage: /htn [author|run|watch|settings|list] <name|pr>", "warning");
      } catch (e) {
        ui.notify(`/htn error: ${(e as Error).message}`, "error");
      }
    },
  });
};

export default extension;
