import { describe, expect, it } from "vitest";
import { type ShellExec, type ShellResult, buildExecRegistry } from "../src/exec.ts";
import type { YamlDomain } from "../src/types.ts";

const ok = (stdout: string): ShellResult => ({ stdout, stderr: "", code: 0, killed: false });

// Capture what the shell was called with so we can assert interpolation.
function spyShell(impl: (cmd: string, args: string[]) => ShellResult): {
  shell: ShellExec;
  calls: { cmd: string; args: string[] }[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  const shell: ShellExec = async (cmd, args) => {
    calls.push({ cmd, args });
    return impl(cmd, args);
  };
  return { shell, calls };
}

function domainWith(operator: Record<string, unknown>): YamlDomain {
  return {
    domain: "d",
    worldState: {},
    root: {
      name: "d",
      type: "sequence",
      tasks: [{ name: "step", operator: operator as never, effects: [] }],
    },
  } as YamlDomain;
}

describe("buildExecRegistry", () => {
  it("interpolates {{worldState}} and {{toolArgs}} into command args (args win)", async () => {
    const { shell, calls } = spyShell(() => ok("{}"));
    const { tools, live, dryRun } = buildExecRegistry(
      domainWith({ tool: "bump", exec: { cmd: "bash", args: ["-c", "echo {{name}} {{extra}}"] } }),
      shell,
    );
    expect(live).toEqual(["bump"]);
    expect(dryRun).toEqual([]);
    await tools.invoke("bump", { extra: "X" }, { name: "tally", extra: "WS" });
    expect(calls[0]).toEqual({ cmd: "bash", args: ["-c", "echo tally X"] });
  });

  it("parses JSON object stdout so $result.* effects can resolve", async () => {
    const { shell } = spyShell(() => ok('{"id":"BUG-7","count":3}'));
    const { tools } = buildExecRegistry(
      domainWith({ tool: "create", exec: { cmd: "bash", args: ["-c", "true"] } }),
      shell,
    );
    const res = await tools.invoke("create", {}, {});
    expect(res).toEqual({ id: "BUG-7", count: 3 });
  });

  it("returns raw {stdout,stderr,code} for non-JSON output", async () => {
    const { shell } = spyShell(() => ok("hello world"));
    const { tools } = buildExecRegistry(
      domainWith({ tool: "say", exec: { cmd: "echo", args: ["hello world"] } }),
      shell,
    );
    const res = await tools.invoke("say", {}, {});
    expect(res).toEqual({ stdout: "hello world", stderr: "", code: 0 });
  });

  it("throws on non-zero exit so the executor can replan / trip the breaker", async () => {
    const shell: ShellExec = async () => ({ stdout: "", stderr: "boom", code: 2, killed: false });
    const { tools } = buildExecRegistry(
      domainWith({ tool: "fail", exec: { cmd: "false", args: [] } }),
      shell,
    );
    await expect(tools.invoke("fail", {}, {})).rejects.toThrow(/exited 2: boom/);
  });

  it("falls back to a dry-run echo for operators without exec", async () => {
    const { shell } = spyShell(() => ok("{}"));
    const { tools, live, dryRun } = buildExecRegistry(domainWith({ tool: "noexec" }), shell);
    expect(live).toEqual([]);
    expect(dryRun).toEqual(["noexec"]);
    const res = await tools.invoke("noexec", { a: 1 }, {});
    expect(res).toEqual({ dryRun: true, tool: "noexec", args: { a: 1 } });
  });
});

describe("buildExecRegistry + executeDomain (real exec pipeline)", () => {
  it("runs a tally domain end-to-end against a fake shell, flowing $result.* into state", async () => {
    // A tiny in-memory tally: the shell increments a counter and echoes JSON.
    let count = 0;
    const shell: ShellExec = async (_cmd, args) => {
      // last arg is the script; emulate `bump` returning the new total as JSON
      if (args.join(" ").includes("bump")) {
        count += 1;
        return { stdout: JSON.stringify({ total: count }), stderr: "", code: 0, killed: false };
      }
      return { stdout: "{}", stderr: "", code: 0, killed: false };
    };

    const yaml: YamlDomain = {
      domain: "tally",
      worldState: { item: "apples", bumped: false, total: 0 },
      root: {
        name: "tally",
        type: "sequence",
        tasks: [
          {
            name: "bump",
            operator: { tool: "bump", exec: { cmd: "bash", args: ["-c", "bump {{item}}"] } },
            effects: [{ set: { bumped: true, total: "$result.total" } }],
          },
        ],
      },
    } as YamlDomain;

    const { tools, live } = buildExecRegistry(yaml, shell);
    expect(live).toEqual(["bump"]);

    const { FakeSmallModel } = await import("../src/smallModel.ts");
    const { executeDomain } = await import("../src/executor.ts");
    const res = await executeDomain(yaml, { tools, smallModel: new FakeSmallModel([]) });

    expect(res.ok).toBe(true);
    expect(res.steps.map((s) => s.tool)).toEqual(["bump"]);
    expect(res.finalWorldState.bumped).toBe(true);
    expect(res.finalWorldState.total).toBe(1); // $result.total flowed from real exec output
    expect(count).toBe(1);
  });
});
