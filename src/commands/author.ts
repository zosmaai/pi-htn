import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildAuthorPrompt, extractYamlBlock } from "../author.ts";
import type { HtnLogger } from "../log.ts";
import { extractTrace } from "../recorder.ts";
import { DomainStore } from "../store.ts";
import type { WorldState, YamlDomain } from "../types.ts";
import { validateDomain } from "../validator.ts";
import { loadDomain } from "../yaml.ts";

export interface AuthorCandidate {
  index: number;
  yamlText?: string;
  yaml?: YamlDomain;
  ok: boolean;
  failures: string[];
  score: number;
}

// Derive synthetic world states for the validator gate from the domain's initial state.
function syntheticStates(yaml: YamlDomain): WorldState[] {
  const states = Object.keys(yaml.worldState)
    .filter((k) => k === "intent")
    .flatMap(() => [{ intent: "spam" } as WorldState, { intent: "bug", body: "x" } as WorldState]);
  return states.length ? states : [yaml.worldState];
}

// Structural richness: prefer passing candidates with more branches/primitives.
// (No extra LLM call. LLM advisory scoring à la evaluate_candidate is a v0.2 option.)
function richness(yaml: YamlDomain): number {
  let n = 0;
  const walk = (node: { tasks?: unknown[] }): void => {
    n++;
    (node.tasks as { tasks?: unknown[] }[] | undefined)?.forEach(walk);
  };
  walk(yaml.root as never);
  return n;
}

// Best-of-N authoring: validate every candidate reply, keep the best PASSING one.
// The symbolic validator is the hard gate; score only ranks among passers.
// Per-candidate parse/validate failures are caught + logged, never crash authoring.
export function authorCandidates(
  name: string,
  sessionFile: string,
  modelReplies: string[],
  logger?: HtnLogger,
): { prompt: string; candidates: AuthorCandidate[]; chosen?: AuthorCandidate } {
  const trace = extractTrace(sessionFile);
  const prompt = buildAuthorPrompt(name, trace);
  const candidates: AuthorCandidate[] = modelReplies.map((reply, index) => {
    try {
      const yamlText = extractYamlBlock(reply);
      const yaml = loadDomain(yamlText);
      const res = validateDomain(yaml, syntheticStates(yaml));
      const score = (res.ok ? 1000 : 0) - res.failures.length + richness(yaml);
      if (!res.ok) logger?.failure(`author:${name}#${index}`, "validate", res.failures.join("; "));
      return { index, yamlText, yaml, ok: res.ok, failures: res.failures, score };
    } catch (e) {
      logger?.failure(`author:${name}#${index}`, "parse", (e as Error).message);
      return { index, ok: false, failures: [(e as Error).message], score: -1 };
    }
  });
  const chosen = candidates.filter((c) => c.ok).sort((a, b) => b.score - a.score)[0];
  return { prompt, candidates, chosen };
}

// Command registration (sub-dispatch handled in index.ts). The handler builds `prompt`
// once, requests N completions of it from the big model (temperature>0 for diversity),
// passes them to authorCandidates, and saves chosen.yamlText via DomainStore only when
// a passing candidate exists. Keeping authorCandidates pure makes the gate fully testable.
export function registerAuthorCommand(_pi: ExtensionAPI, _getSessionFile: () => string): void {
  void DomainStore;
}
