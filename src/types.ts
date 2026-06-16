export type WorldState = Record<string, string | number | boolean | null>;

export type Predicate =
  | { has: string }
  | { not: Predicate }
  | { eq: [string, string | number | boolean | null] };

export type EffectSpec = { set: Record<string, string | number | boolean | null> };

// Optional real-execution binding. When present, /htn run executes the command
// via pi.exec() instead of a dry-run echo. Each arg string supports {{key}}
// interpolation against the merged { ...worldState, ...toolArgs } at call time.
export interface ExecSpec { cmd: string; args?: string[] }

export interface Operator { tool: string; prompt?: string | null; exec?: ExecSpec }

export interface PrimitiveNode {
  name: string;
  conditions?: Predicate[];
  operator: Operator;
  effects?: EffectSpec[];
}

export interface CompoundNode {
  name: string;
  type: "select" | "sequence";
  conditions?: Predicate[];
  tasks: TaskNode[];
}

export type TaskNode = PrimitiveNode | CompoundNode;

export interface YamlDomain {
  domain: string;
  worldState: WorldState;
  root: CompoundNode;
}

export function isCompound(n: TaskNode): n is CompoundNode {
  return (n as CompoundNode).type === "select" || (n as CompoundNode).type === "sequence";
}
