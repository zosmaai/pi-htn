// Single source of truth for the small-model endpoint.
//
// Default to the shared Zosma devserver so the executor never runs on a laptop
// (local inference cooks the machine). Override per-process with env vars or an
// explicit --model/--base flag in the runners.
//
//   PI_HTN_MODEL_BASE  OpenAI-compatible base URL (default devserver:8010)
//   PI_HTN_MODEL       model id served there      (default qwopus-coder-9b)
export const DEFAULT_MODEL_BASE = "http://devserver.zosma.ai:8010/v1";
export const DEFAULT_MODEL_ID = "qwopus-coder-9b";

export interface ModelEndpoint {
  base: string;
  model: string;
}

export function modelEndpoint(env: NodeJS.ProcessEnv = process.env): ModelEndpoint {
  return {
    base: env.PI_HTN_MODEL_BASE?.trim() || DEFAULT_MODEL_BASE,
    model: env.PI_HTN_MODEL?.trim() || DEFAULT_MODEL_ID,
  };
}
