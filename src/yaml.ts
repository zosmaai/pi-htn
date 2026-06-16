import { parse } from "yaml";
import type { CompoundNode, TaskNode, YamlDomain } from "./types.ts";
import { isCompound } from "./types.ts";

function validateNode(n: TaskNode, path: string): void {
  if (!n || typeof (n as { name?: string }).name !== "string")
    throw new Error(`Task at ${path} is missing a name`);
  if (isCompound(n)) {
    if (!Array.isArray((n as CompoundNode).tasks) || (n as CompoundNode).tasks.length === 0)
      throw new Error(`Compound '${n.name}' at ${path} must have at least one task`);
    (n as CompoundNode).tasks.forEach((c, i) => validateNode(c, `${path}.${n.name}[${i}]`));
  } else {
    const op = (n as { operator?: { tool?: string; exec?: { cmd?: unknown; args?: unknown } } }).operator;
    if (!op || typeof op.tool !== "string")
      throw new Error(`Primitive '${n.name}' at ${path} must have operator.tool`);
    if (op.exec !== undefined) {
      if (typeof op.exec.cmd !== "string" || op.exec.cmd.length === 0)
        throw new Error(`Primitive '${n.name}' at ${path} operator.exec.cmd must be a non-empty string`);
      if (op.exec.args !== undefined && !Array.isArray(op.exec.args))
        throw new Error(`Primitive '${n.name}' at ${path} operator.exec.args must be an array of strings`);
    }
  }
}

export function loadDomain(yamlText: string): YamlDomain {
  const raw = parse(yamlText) as Partial<YamlDomain>;
  if (!raw || typeof raw.domain !== "string") throw new Error("domain: name is required");
  if (!raw.worldState || typeof raw.worldState !== "object") throw new Error("worldState is required");
  if (!raw.root || !isCompound(raw.root)) throw new Error("root must be a compound task (select/sequence)");
  // The domain root may omit its name; default it to the domain name.
  if (typeof raw.root.name !== "string") raw.root.name = raw.domain;
  validateNode(raw.root, "root");
  return raw as YamlDomain;
}
