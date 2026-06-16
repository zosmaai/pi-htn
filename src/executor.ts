import type { YamlDomain, WorldState } from "./types.ts";
import { compileDomain, makeContext } from "./compiler.ts";
import type { ToolRegistry } from "./toolRegistry.ts";
import type { SmallModelClient } from "./smallModel.ts";
import { renderTemplate } from "./smallModel.ts";
import type { HtnLogger } from "./log.ts";

const EXECUTING = "executing";

export interface StepRecord {
  task: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}
export interface ExecuteOptions {
  input?: WorldState;
  tools: ToolRegistry;
  smallModel: SmallModelClient;
  maxReplans?: number;
  onStep?: (s: StepRecord) => void; // checkpoint hook (Task 7)
  logger?: HtnLogger;               // optional observability (Task 5b)
}
export interface ExecuteResult {
  ok: boolean;
  steps: StepRecord[];
  finalWorldState: WorldState;
  error?: string;
}

type Ctx = {
  ContextState: string;
  WorldState: WorldState;
  setState: (k: string, v: unknown, dirty: boolean, type: string) => void;
};

type PlanItem = { Name: string; applyEffects: (c: unknown) => void };

// Resolve {{ws}} references in an args object against current world state.
function resolveArgs(operatorArgs: Record<string, unknown>, ws: WorldState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(operatorArgs)) {
    out[k] = typeof v === "string" && v.includes("{{")
      ? renderTemplate(v, ws as Record<string, unknown>) : v;
  }
  return out;
}

export async function executeDomain(yaml: YamlDomain, opts: ExecuteOptions): Promise<ExecuteResult> {
  const maxReplans = opts.maxReplans ?? 5;
  const domain = compileDomain(yaml);
  const ctx = makeContext(yaml, opts.input ?? {}) as unknown as Ctx;
  const steps: StepRecord[] = [];
  let replans = 0;

  while (true) {
    const { plan } = domain.findPlan(ctx as never) as { plan: PlanItem[] };
    ctx.ContextState = EXECUTING; // leave planning mode so setState mutates WorldState
    if (!plan || plan.length === 0) break; // nothing left to do

    let failed = false;
    for (const compiledTask of plan) {
      const binding = findBinding(yaml, compiledTask.Name);
      const tool = binding.tool;
      try {
        // Per-task language work: small model fills args when a prompt is present (mode B).
        let args: Record<string, unknown> = {};
        if (binding.prompt) {
          const prompt = renderTemplate(binding.prompt, ctx.WorldState as Record<string, unknown>);
          args = await opts.smallModel.complete({ prompt, worldState: ctx.WorldState });
          opts.logger?.smallModel(compiledTask.Name, prompt, args);
        }
        const result = await opts.tools.invoke(tool, resolveArgs(args, ctx.WorldState));

        // Apply literal effects FIRST (e.g. replied:true, and the placeholder
        // ticketId:"$result.id"), THEN override $result.* keys with the real tool
        // output so the resolved value wins. Order matters — do not swap.
        compiledTask.applyEffects(ctx);
        applyResultRefs(yaml, compiledTask.Name, result, ctx);

        const rec: StepRecord = { task: compiledTask.Name, tool, args, result };
        steps.push(rec);
        opts.onStep?.(rec);
      } catch (e) {
        opts.logger?.failure(compiledTask.Name, "tool", (e as Error).message);
        failed = true;
        replans++;
        if (replans > maxReplans)
          return { ok: false, steps, finalWorldState: ctx.WorldState, error: `circuit breaker: ${(e as Error).message}` };
        break; // re-enter while loop -> replan
      }
    }
    if (!failed) break;
  }
  return { ok: true, steps, finalWorldState: ctx.WorldState };
}

// Look up the raw operator binding by task name (compiled plan items don't carry it).
function findBinding(yaml: YamlDomain, name: string): { tool: string; prompt?: string | null } {
  let found: { tool: string; prompt?: string | null } | undefined;
  const walk = (n: unknown): void => {
    const node = n as { name?: string; operator?: { tool: string; prompt?: string | null }; tasks?: unknown[] };
    if (node.name === name && node.operator) found = node.operator;
    node.tasks?.forEach(walk);
  };
  walk(yaml.root);
  if (!found) throw new Error(`No operator binding for task ${name}`);
  return found;
}

// Apply $result.<path> effect references from the tool result into world state.
function applyResultRefs(yaml: YamlDomain, name: string, result: unknown, ctx: Ctx): void {
  const node = locate(yaml.root as never, name);
  for (const eff of node?.effects ?? []) {
    for (const [k, v] of Object.entries(eff.set)) {
      if (typeof v === "string" && v.startsWith("$result.")) {
        const path = v.slice("$result.".length).split(".");
        let cur: unknown = result;
        for (const p of path) cur = (cur as Record<string, unknown>)?.[p];
        // NB: vendored Context.setState defaults value to 1 when given undefined.
        // Coerce missing result fields to null so absent data never becomes a phantom 1.
        ctx.setState(k, cur ?? null, true, "planandexecute");
      }
    }
  }
}

function locate(
  node: { name: string; tasks?: unknown[]; effects?: { set: Record<string, unknown> }[] },
  name: string,
): { effects?: { set: Record<string, unknown> }[] } | undefined {
  if (node.name === name) return node;
  for (const c of (node.tasks ?? []) as (typeof node)[]) { const r = locate(c, name); if (r) return r; }
  return undefined;
}
