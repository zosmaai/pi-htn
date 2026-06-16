import htn from "./htn.ts";
import type { YamlDomain, TaskNode, WorldState, Predicate } from "./types.ts";
import { isCompound } from "./types.ts";
import { compileCondition, compileEffect } from "./predicates.ts";

// Build the plain-object task tree GamePlanHTN's Domain constructor understands.
function buildTask(node: TaskNode): Record<string, unknown> {
  const conditions = (node.conditions ?? []).map(compileCondition);
  if (isCompound(node)) {
    return {
      name: node.name,
      type: node.type, // "select" | "sequence"
      conditions,
      tasks: node.tasks.map(buildTask),
    };
  }
  const effects = (node.effects ?? []).map(compileEffect);
  return {
    name: node.name,
    conditions,
    // Real side-effects run in the Executor, not here. The planning operator is a
    // no-op that reports Success so decomposition completes. (Execution mode B.)
    operator: () => "success",
    effects,
    // Carried for reference; note GamePlanHTN's PrimitiveTask constructor does NOT
    // copy unknown fields, so compiled plan items expose only Name/operator/Effects.
    // The Executor recovers the binding by name (see executor.findBinding).
    __operator: (node as { operator: unknown }).operator,
  };
}

export function compileDomain(yaml: YamlDomain): InstanceType<typeof htn.Domain> {
  const root = buildTask(yaml.root);
  // Domain always wraps its `tasks` in a top-level select Root, so passing the single
  // root compound preserves that compound's own type (select OR sequence).
  return new htn.Domain({ name: yaml.domain, tasks: [root] });
}

// Collect every world-state key referenced by a condition or set by an effect.
function predicateKeys(p: Predicate, out: Set<string>): void {
  if ("has" in p) out.add(p.has);
  else if ("not" in p) predicateKeys(p.not, out);
  else if ("eq" in p) out.add(p.eq[0]);
}
function collectKeys(yaml: YamlDomain): Set<string> {
  const keys = new Set<string>(Object.keys(yaml.worldState));
  const walk = (n: TaskNode): void => {
    (n.conditions ?? []).forEach((c) => predicateKeys(c, keys));
    if (isCompound(n)) n.tasks.forEach(walk);
    else (n.effects ?? []).forEach((e) => Object.keys(e.set).forEach((k) => keys.add(k)));
  };
  walk(yaml.root);
  return keys;
}

export function makeContext(yaml: YamlDomain, input: WorldState = {}) {
  const ctx = new htn.Context();
  // Seed EVERY referenced key before init(): in Planning mode getState/setState index
  // WorldStateChangeStack[key] directly and throw if the key has no stack. init() only
  // creates stacks for keys present in WorldState at init time.
  const ws: Record<string, unknown> = {};
  for (const k of collectKeys(yaml)) ws[k] = yaml.worldState[k] ?? null;
  ctx.WorldState = { ...ws, ...input };
  ctx.init();
  return ctx;
}
