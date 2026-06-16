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

// OpenAI-compatible client for a local llama.cpp server (mirrors tally-harness pattern).
export class LlamaSmallModel implements SmallModelClient {
  constructor(private baseUrl = "http://localhost:8080/v1", private model = "local") {}
  async complete(req: SmallModelRequest): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: req.prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0].message.content);
  }
}
