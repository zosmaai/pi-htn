import type { ExtensionAPI, ExtensionFactory, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DomainStore } from "./store.ts";
import { buildAuthorPrompt } from "./author.ts";
import { extractTrace } from "./recorder.ts";
import { authorCandidates } from "./commands/author.ts";
import { executeDomain } from "./executor.ts";
import { ToolRegistry } from "./toolRegistry.ts";
import { JsonlLogger } from "./log.ts";
import { completeText, PiSmallModel, type ModelLike, type RegistryLike } from "./commands/piModel.ts";
import type { WorldState, YamlDomain } from "./types.ts";

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

// Collect every operator.tool the domain references (for the dry-run registry).
function collectTools(yaml: YamlDomain): string[] {
  const tools = new Set<string>();
  const walk = (n: unknown): void => {
    const node = n as { operator?: { tool: string }; tasks?: unknown[] };
    if (node.operator?.tool) tools.add(node.operator.tool);
    node.tasks?.forEach(walk);
  };
  walk(yaml.root);
  return [...tools];
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

          // Extensions can't invoke pi's tools directly, so v0.1 binds a safe dry-run
          // registry: each tool echoes its args (and is logged). Proves the executor +
          // small model live without side effects. Real tool binding is the next step.
          const tools = new ToolRegistry();
          for (const t of collectTools(yaml))
            tools.register(t, async (a) => ({ dryRun: true, tool: t, args: a }));

          const smallModel = model
            ? new PiSmallModel(model, registry, signal)
            : { async complete() { return {}; } };

          ui.notify(`Running '${name}' (dry-run tools)…`, "info");
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

        ui.notify("Usage: /htn [author|run|list] <name>", "warning");
      } catch (e) {
        ui.notify(`/htn error: ${(e as Error).message}`, "error");
      }
    },
  });
};

export default extension;
