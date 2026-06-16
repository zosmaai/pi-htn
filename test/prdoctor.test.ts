import { describe, it, expect } from "vitest";
import { buildExecRegistry, type ShellExec } from "../src/exec.ts";
import { executeDomain } from "../src/executor.ts";
import { FakeSmallModel } from "../src/smallModel.ts";
import type { YamlDomain } from "../src/types.ts";

// The repair ladder: rerun (flaky) -> lint -> revert (always green).
// classify is HOISTED to input.failure_class (planning precedes execution, so a
// mid-plan $result effect can't gate the select). report writes a comment (model).
function prDoctorDomain(): YamlDomain {
  const verify = (n: string) => ({
    name: `verify-${n}`,
    operator: { tool: "verify", exec: { cmd: "verify", args: [] } },
    effects: [{ set: { fixed: true } }],
  });
  return {
    domain: "pr-doctor",
    worldState: {
      pr: "",
      failure_class: null,
      rerun_tried: false,
      lint_tried: false,
      revert_tried: false,
      fixed: false,
      reported: false,
    },
    root: {
      name: "pr-doctor",
      type: "sequence",
      tasks: [
        {
          name: "repair",
          type: "select",
          conditions: [{ not: { eq: ["fixed", true] } }],
          tasks: [
            {
              name: "m-rerun",
              type: "sequence",
              conditions: [{ eq: ["failure_class", "flaky"] }, { not: { eq: ["rerun_tried", true] } }],
              tasks: [
                { name: "apply-rerun", operator: { tool: "rerun", exec: { cmd: "do", args: ["rerun"] } }, effects: [{ set: { rerun_tried: true } }] },
                verify("rerun"),
              ],
            },
            {
              name: "m-lint",
              type: "sequence",
              conditions: [{ not: { eq: ["lint_tried", true] } }],
              tasks: [
                { name: "apply-lint", operator: { tool: "lint", exec: { cmd: "do", args: ["lint"] } }, effects: [{ set: { lint_tried: true } }] },
                verify("lint"),
              ],
            },
            {
              name: "m-revert",
              type: "sequence",
              conditions: [{ not: { eq: ["revert_tried", true] } }],
              tasks: [
                { name: "apply-revert", operator: { tool: "revert", exec: { cmd: "do", args: ["revert"] } }, effects: [{ set: { revert_tried: true } }] },
                verify("revert"),
              ],
            },
          ],
        },
        {
          name: "report",
          conditions: [{ eq: ["fixed", true] }, { not: { eq: ["reported", true] } }],
          operator: { tool: "report", prompt: 'Write a PR comment. Example: {"comment":"x"}' },
          effects: [{ set: { reported: true } }],
        },
      ],
    },
  } as YamlDomain;
}

// verify fails the first `failsFirst` times (red build), then passes (green).
function shellThatGoesGreenAfter(failsFirst: number): { shell: ShellExec; order: string[]; verifyCount: () => number } {
  const order: string[] = [];
  let verifies = 0;
  const shell: ShellExec = async (cmd, args) => {
    order.push(`${cmd} ${args.join(" ")}`.trim());
    if (cmd === "verify") {
      verifies++;
      if (verifies <= failsFirst) return { stdout: "", stderr: "still red", code: 1 };
      return { stdout: "", stderr: "", code: 0 };
    }
    return { stdout: "{}", stderr: "", code: 0 };
  };
  return { shell, order, verifyCount: () => verifies };
}

describe("pr-doctor backtracking ladder", () => {
  it("model guesses flaky (wrong); HTN climbs rerun -> lint -> revert to green", async () => {
    const yaml = prDoctorDomain();
    const { shell, order } = shellThatGoesGreenAfter(2); // rerun & lint fail, revert green
    // report tool is exec-less in the registry -> override with identity-ish echo not needed:
    // report has a prompt, so the model fills {comment}; the dry-run echo tool returns it back.
    const { tools } = buildExecRegistry(yaml, shell);

    const model = new FakeSmallModel([{ comment: "Reverted the breaking commit to restore green CI." }]);
    const res = await executeDomain(yaml, {
      input: { pr: "42", failure_class: "flaky" }, // hoisted classification
      tools,
      smallModel: model,
      maxReplans: 6,
    });

    const applies = res.steps.map((s) => s.task).filter((t) => t.startsWith("apply-"));
    expect(applies).toEqual(["apply-rerun", "apply-lint", "apply-revert"]); // the ladder
    expect(res.finalWorldState.fixed).toBe(true);
    expect(res.finalWorldState.reported).toBe(true);
    expect(res.ok).toBe(true);
    // verify ran after each apply (3 times); last was green
    expect(order.filter((o) => o.startsWith("verify")).length).toBe(3);
  });

  it("model guesses lint (also wrong); skips rerun, lint -> revert", async () => {
    const yaml = prDoctorDomain();
    const { shell } = shellThatGoesGreenAfter(1); // lint fails, revert green
    const { tools } = buildExecRegistry(yaml, shell);
    const res = await executeDomain(yaml, {
      input: { pr: "7", failure_class: "lint" },
      tools,
      smallModel: new FakeSmallModel([{ comment: "Reverted." }]),
      maxReplans: 6,
    });
    const applies = res.steps.map((s) => s.task).filter((t) => t.startsWith("apply-"));
    expect(applies).toEqual(["apply-lint", "apply-revert"]); // rerun gated out (not flaky)
    expect(res.finalWorldState.fixed).toBe(true);
  });
});
