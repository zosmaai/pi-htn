import type { YamlDomain, WorldState } from "./types.ts";
import { compileDomain, makeContext } from "./compiler.ts";

export interface ValidationResult { ok: boolean; failures: string[] }

// Reliability gate: every synthetic world state must yield a non-empty plan.
// No operators run (findPlan only decomposes) — this is pure offline checking.
export function validateDomain(yaml: YamlDomain, syntheticStates: WorldState[]): ValidationResult {
  const failures: string[] = [];
  const domain = compileDomain(yaml);
  for (const state of syntheticStates) {
    try {
      const ctx = makeContext(yaml, state);
      const { plan } = domain.findPlan(ctx);
      if (!plan || plan.length === 0)
        failures.push(`no plan produced for state ${JSON.stringify(state)}`);
    } catch (e) {
      failures.push(`error planning state ${JSON.stringify(state)}: ${(e as Error).message}`);
    }
  }
  return { ok: failures.length === 0, failures };
}
