import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";
import { DomainStore } from "../store.ts";
import { executeDomain } from "../executor.ts";
import { ToolRegistry } from "../toolRegistry.ts";
import { LlamaSmallModel } from "../smallModel.ts";
import { CheckpointWriter } from "../checkpoints.ts";
import { JsonlLogger } from "../log.ts";
import type { WorldState } from "../types.ts";

export async function runDomain(
  name: string,
  input: WorldState,
  tools: ToolRegistry,
  sessionNodeId: string,
) {
  const store = new DomainStore();
  const yaml = store.load(name);
  const cp = new CheckpointWriter(join(homedir(), ".pi-htn", "runs", `${name}-${Date.now()}.jsonl`), sessionNodeId);
  return executeDomain(yaml, {
    input,
    tools,
    smallModel: new LlamaSmallModel(),
    logger: new JsonlLogger(),
    onStep: (s) => cp.record(s, {} as WorldState),
  });
}

export function registerRunCommand(_pi: ExtensionAPI): void {
  void runDomain;
}
