import type { GhClient, ChecksSummary } from "./gh.ts";
import { classifyFromChecks, Playbook } from "../learn/playbook.ts";
import { buildExecRegistry, type ShellExec } from "../exec.ts";
import { executeDomain } from "../executor.ts";
import type { SmallModelClient } from "../smallModel.ts";
import type { HtnLogger } from "../log.ts";
import type { YamlDomain, WorldState } from "../types.ts";

export interface HealOutcome {
  ok: boolean;
  strategy: string;
  error?: string;
  steps: string[];
}
// A heal attempt for one red round. `tried` carries the strategy ids already
// attempted in earlier rounds so the HTN excludes those rungs and climbs the
// ladder (cross-round backtracking, with gh re-checks as the verifier).
// Injected so the watcher loop is testable without a real model or repo;
// `defaultHeal` wires the real HTN engine.
export type HealFn = (ctx: { failureClass: string; round: number; summary: ChecksSummary; tried: string[] }) => Promise<HealOutcome>;

export interface WatchEvent {
  type: "checks" | "heal" | "done";
  round: number;
  message: string;
}
export interface WatchRound {
  round: number;
  state: ChecksSummary["state"];
  failing: string[];
  failureClass?: string;
  strategy?: string;
  ok?: boolean;
}
export interface WatchResult {
  mergeReady: boolean;
  rounds: WatchRound[];
  reason: "already-green" | "healed" | "exhausted" | "pending-timeout" | "conflict" | string;
}

export interface WatchDeps {
  gh: GhClient;
  heal: HealFn;
  playbook: Playbook;
  sleep?: (ms: number) => Promise<void>;
  classify?: (failing: string[]) => string;
  onEvent?: (e: WatchEvent) => void;
}
export interface WatchOptions {
  repo: string;
  pr: number | string;
  maxRounds?: number;   // max heal attempts before escalating to a human
  maxPolls?: number;    // max times to wait out "pending" checks before timing out
  pollMs?: number;      // delay between re-checks while CI is pending
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Watch one PR until its checks are merge-ready or the budget is exhausted.
// Red -> classify -> heal (HTN) -> record outcome -> re-check (CI reruns,
// usually pending -> green). Every outcome is written to the playbook so future
// runs try the historically-best strategy first.
export async function watchPr(opts: WatchOptions, deps: WatchDeps): Promise<WatchResult> {
  const maxRounds = opts.maxRounds ?? 5;
  const maxPolls = opts.maxPolls ?? 20;
  const pollMs = opts.pollMs ?? 30_000;
  const sleep = deps.sleep ?? sleepReal;
  const classify = deps.classify ?? classifyFromChecks;
  const emit = deps.onEvent ?? (() => {});

  const rounds: WatchRound[] = [];
  const tried: string[] = [];
  let heals = 0;
  let polls = 0;

  while (true) {
    const checks = await deps.gh.checks(opts.pr);
    emit({ type: "checks", round: heals, message: `${checks.state} (${checks.failing.join(",") || "—"})` });

    if (checks.state === "green" || checks.state === "none") {
      rounds.push({ round: heals, state: checks.state, failing: [] });
      const reason = heals > 0 ? "healed" : "already-green";
      emit({ type: "done", round: heals, message: reason });
      return { mergeReady: true, rounds, reason };
    }

    if (checks.state === "pending") {
      if (++polls > maxPolls) {
        rounds.push({ round: heals, state: "pending", failing: [] });
        return { mergeReady: false, rounds, reason: "pending-timeout" };
      }
      await sleep(pollMs);
      continue;
    }

    // red
    if (heals >= maxRounds) {
      rounds.push({ round: heals, state: "red", failing: checks.failing });
      return { mergeReady: false, rounds, reason: "exhausted" };
    }
    heals++;
    const failureClass = classify(checks.failing);
    emit({ type: "heal", round: heals, message: `red [${checks.failing.join(",")}] → class=${failureClass}` });
    const outcome = await deps.heal({ failureClass, round: heals, summary: checks, tried: [...tried] });
    if (outcome.strategy && !tried.includes(outcome.strategy)) tried.push(outcome.strategy);
    deps.playbook.record({ repo: opts.repo, pr: opts.pr, failureClass, strategy: outcome.strategy, ok: outcome.ok });
    rounds.push({ round: heals, state: "red", failing: checks.failing, failureClass, strategy: outcome.strategy, ok: outcome.ok });

    if (!outcome.ok) {
      const reason = `escalated:${outcome.error ?? "heal-failed"}`;
      emit({ type: "done", round: heals, message: reason });
      return { mergeReady: false, rounds, reason };
    }
    polls = 0; // give CI time to re-run after the push
  }
}

// Wire the real HTN engine as a HealFn: classify -> prime the world state with
// the playbook's best strategy -> run the repair-ladder domain with a repo-bound
// shell. The HTN owns ordering/backtracking; the small model fills task args.
export function defaultHeal(args: {
  domain: YamlDomain;
  shell: ShellExec;
  smallModel: SmallModelClient;
  playbook: Playbook;
  repo: string;
  pr: number | string;
  logger?: HtnLogger;
  maxReplans?: number;
  scriptdir?: string;
}): HealFn {
  return async ({ failureClass, tried }) => {
    const { tools } = buildExecRegistry(args.domain, args.shell);
    const input: WorldState = {
      pr: String(args.pr),
      repo: args.repo,
      failure_class: failureClass,
      // Prior: the strategy that has historically fixed this class fastest.
      preferred_strategy: args.playbook.best(failureClass) ?? "",
      scriptdir: args.scriptdir ?? "",
    };
    // Cross-round backtracking: exclude rungs already tried by setting tried_<id>.
    for (const s of tried) input[`tried_${s}`] = true;
    const res = await executeDomain(args.domain, {
      input,
      tools,
      smallModel: args.smallModel,
      logger: args.logger,
      maxReplans: args.maxReplans ?? 6,
    });
    return {
      ok: res.ok,
      strategy: String(res.finalWorldState.last_strategy ?? "unknown"),
      error: res.error,
      steps: res.steps.map((s) => `${s.task}→${s.tool}`),
    };
  };
}
