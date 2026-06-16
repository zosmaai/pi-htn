import htnPkg from "./htn.ts";
import type { EffectSpec, Predicate } from "./types.ts";

// EffectType.PlanAndExecute is the only effect type that fires during real execution.
const PLAN_AND_EXECUTE = "planandexecute";

type Ctx = {
  getState: (k: string) => unknown;
  setState: (k: string, v: unknown, dirty?: boolean, type?: string) => void;
  hasState: (k: string, v?: unknown) => boolean;
};

export function compileCondition(p: Predicate): (ctx: Ctx) => boolean {
  if ("has" in p) return (ctx) => ctx.hasState(p.has);
  if ("not" in p) {
    const inner = compileCondition(p.not);
    return (ctx) => !inner(ctx);
  }
  if ("eq" in p) {
    const [k, v] = p.eq;
    return (ctx) => ctx.getState(k) === v;
  }
  throw new Error(`Unknown predicate: ${JSON.stringify(p)}`);
}

export interface CompiledEffect {
  name: string;
  type: string;
  action: (ctx: Ctx, type?: string) => void;
}

// $result.* and {{ws}} references are resolved by the executor before effects run,
// so by the time we apply an effect the value is a literal. v0.1 effects set literals.
export function compileEffect(e: EffectSpec): CompiledEffect {
  const entries = Object.entries(e.set);
  return {
    name: `set:${Object.keys(e.set).join(",")}`,
    type: PLAN_AND_EXECUTE,
    action: (ctx, type) => {
      for (const [k, v] of entries) ctx.setState(k, v as never, true, type ?? PLAN_AND_EXECUTE);
    },
  };
}

export { htnPkg };
