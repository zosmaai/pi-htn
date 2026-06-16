import { completeSimple } from "@earendil-works/pi-ai";
import type { SmallModelClient, SmallModelRequest } from "../smallModel.ts";

// Minimal structural types — we only touch the fields we use, so we avoid pinning
// to pi-ai's full Model<Api> generic (which jiti loads fine but tsc would over-constrain).
export interface ModelLike { api: string; baseUrl: string; provider: string; id: string }
export interface RegistryLike {
  getApiKeyAndHeaders(model: ModelLike): Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string> }>;
}

function textOf(msg: { content: { type: string; text?: string }[] }): string {
  return msg.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

// One-shot completion against the live pi model, with auth resolved via the registry.
export async function completeText(
  model: ModelLike,
  registry: RegistryLike,
  prompt: string,
  opts: { temperature?: number; system?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`No auth for model ${model.provider}/${model.id}`);
  const msg = await completeSimple(
    model as never,
    { systemPrompt: opts.system, messages: [{ role: "user", content: prompt }] } as never,
    { apiKey: auth.apiKey, headers: auth.headers, temperature: opts.temperature, signal: opts.signal } as never,
  );
  return textOf(msg as never);
}

// Tolerant JSON extraction: models often wrap JSON in prose or fences.
export function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return {}; }
}

// Small-model client backed by the live pi model (used for per-task arg filling, mode B).
export class PiSmallModel implements SmallModelClient {
  constructor(private model: ModelLike, private registry: RegistryLike, private signal?: AbortSignal) {}
  async complete(req: SmallModelRequest): Promise<Record<string, unknown>> {
    const prompt = `${req.prompt}\n\nRespond with ONLY a JSON object of the tool arguments. No prose.`;
    const text = await completeText(this.model, this.registry, prompt, { temperature: 0, signal: this.signal });
    return parseJsonObject(text);
  }
}
