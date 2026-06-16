export interface SmallModelRequest {
  prompt: string;
  worldState: Record<string, unknown>;
}
export interface SmallModelClient {
  complete(req: SmallModelRequest): Promise<Record<string, unknown>>;
}

export function renderTemplate(tpl: string, ws: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(ws[k] ?? ""));
}

// Deterministic test double.
export class FakeSmallModel implements SmallModelClient {
  private i = 0;
  constructor(private scripted: Record<string, unknown>[]) {}
  async complete(_req: SmallModelRequest): Promise<Record<string, unknown>> {
    return this.scripted[this.i++] ?? {};
  }
}

// Small models often wrap JSON in ```json fences or add prose despite json_object
// mode. Strip fences, then fall back to the outermost {...} block before parsing.
export function parseModelJson(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error(`small model returned non-JSON: ${raw.slice(0, 200)}`);
  }
}

// OpenAI-compatible client for a local llama.cpp server (mirrors tally-harness pattern).
export class LlamaSmallModel implements SmallModelClient {
  // Reasoning models (e.g. qwopus-4b-coder) otherwise emit a HUGE
  // `reasoning_content` chain (18k+ tokens) before the JSON answer ever lands
  // in `content` — overflowing context and returning an empty `content` that
  // fails JSON.parse. We disable thinking (`enable_thinking: false`) so the
  // model answers directly; `maxTokens` then only needs to cover the JSON.
  constructor(
    private baseUrl = "http://localhost:8080/v1",
    private model = "local",
    private maxTokens = 1024,
    private enableThinking = false,
  ) {}
  async complete(req: SmallModelRequest): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: req.prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: this.maxTokens,
        // Qwen-family chat-template switch; harmlessly ignored by templates that
        // don't define it.
        chat_template_kwargs: { enable_thinking: this.enableThinking },
      }),
    });
    const data = (await res.json()) as {
      choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim())
      throw new Error(
        "small model returned empty content (likely hit the token cap mid-reasoning; raise maxTokens)",
      );
    return parseModelJson(content);
  }
}
