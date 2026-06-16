import type { TraceCall } from "./recorder.ts";

// Builds the big-model prompt that turns a trace into a reusable YAML HTN domain.
// The model must extract reusable structure: which steps are conditional, the
// branch predicates, and any observed failures — not just replay the literal trace.
export function buildAuthorPrompt(name: string, trace: TraceCall[]): string {
  return [
    `You are authoring a reusable HTN domain named "${name}".`,
    `Below is the tool-call trace of a successful session. Generalize it into an HTN domain.`,
    ``,
    `Trace:`,
    ...trace.map((t, i) => `  ${i + 1}. ${t.name}(${JSON.stringify(t.arguments)})`),
    ``,
    `Output ONLY a fenced \`\`\`yaml block in this schema:`,
    `  domain: <name>`,
    `  worldState: { ... initial predicates ... }`,
    `  root: { type: select|sequence, tasks: [ ... ] }`,
    `Each primitive: { name, conditions?: [{eq:[k,v]}|{has:k}|{not:..}], operator: {tool, prompt?}, effects?: [{set:{k:v}}] }.`,
    `Identify which steps are conditional and express the branch predicates as conditions.`,
    `Use $result.<field> in effects to capture tool outputs. Do not invent tools not in the trace.`,
  ].join("\n");
}

// Extract the first fenced yaml block from a model reply.
export function extractYamlBlock(reply: string): string {
  const m = reply.match(/```ya?ml\s*\n([\s\S]*?)```/i);
  if (!m) throw new Error("No ```yaml block found in model reply");
  return m[1];
}
