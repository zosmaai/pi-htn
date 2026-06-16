import { renderTemplate } from "./smallModel.ts";
import { ToolRegistry } from "./toolRegistry.ts";
import type { ExecSpec, YamlDomain } from "./types.ts";

// Injected shell runner. In production this is pi.exec; in tests it's a fake.
// Mirrors pi's ExecResult shape (stdout/stderr/code/killed).
export type ShellResult = { stdout: string; stderr: string; code: number; killed?: boolean };
export type ShellExec = (cmd: string, args: string[]) => Promise<ShellResult>;

// Interpolate {{key}} in each arg against merged { ...worldState, ...toolArgs }.
// toolArgs win so a small-model-filled value can override a world-state default.
function renderArgs(
  spec: ExecSpec,
  toolArgs: Record<string, unknown>,
  worldState: Record<string, unknown>,
): string[] {
  const scope = { ...worldState, ...toolArgs };
  return (spec.args ?? []).map((a) => renderTemplate(a, scope));
}

// Run one exec spec; throw on non-zero exit so the executor replans / trips the
// circuit breaker. On success, parse stdout as JSON when it is an object (so
// $result.* effects resolve), else return the raw { stdout, stderr, code }.
async function runExec(
  spec: ExecSpec,
  shell: ShellExec,
  toolArgs: Record<string, unknown>,
  worldState: Record<string, unknown>,
): Promise<unknown> {
  const args = renderArgs(spec, toolArgs, worldState);
  const res = await shell(spec.cmd, args);
  if (res.code !== 0)
    throw new Error(`exec '${spec.cmd}' exited ${res.code}: ${res.stderr.trim() || res.stdout.trim()}`);
  const out = res.stdout.trim();
  if (out.startsWith("{") || out.startsWith("[")) {
    try {
      const parsed = JSON.parse(out);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to raw shape
    }
  }
  return { stdout: out, stderr: res.stderr.trim(), code: res.code };
}

// Walk the domain and bind one tool per referenced operator.tool:
//   - operator.exec present -> real shell-backed tool (via the injected runner)
//   - otherwise             -> safe dry-run echo (proves the executor offline)
// First exec encountered for a given tool name wins (a tool name should map to
// one command). Returns the registry plus the set of tool names that are live.
export function buildExecRegistry(
  yaml: YamlDomain,
  shell: ShellExec,
): { tools: ToolRegistry; live: string[]; dryRun: string[] } {
  const tools = new ToolRegistry();
  const execByTool = new Map<string, ExecSpec>();
  const allTools = new Set<string>();

  const walk = (n: unknown): void => {
    const node = n as { operator?: { tool: string; exec?: ExecSpec }; tasks?: unknown[] };
    if (node.operator?.tool) {
      const name = node.operator.tool;
      allTools.add(name);
      if (node.operator.exec && !execByTool.has(name)) execByTool.set(name, node.operator.exec);
    }
    node.tasks?.forEach(walk);
  };
  walk(yaml.root);

  for (const name of allTools) {
    const spec = execByTool.get(name);
    if (spec) {
      tools.register(name, (args, ws) => runExec(spec, shell, args, (ws ?? {}) as Record<string, unknown>));
    } else {
      tools.register(name, async (args) => ({ dryRun: true, tool: name, args }));
    }
  }

  return {
    tools,
    live: [...execByTool.keys()],
    dryRun: [...allTools].filter((t) => !execByTool.has(t)),
  };
}
