export type WorldState = Record<string, string | number | boolean | null>;

export type Predicate =
  | { has: string }
  | { not: Predicate }
  | { eq: [string, string | number | boolean | null] };

export type EffectSpec = { set: Record<string, string | number | boolean | null> };

export interface Operator { tool: string; prompt?: string | null }

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
