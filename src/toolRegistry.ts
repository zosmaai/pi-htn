// Tools receive the small-model-filled args and (optionally) the current world
// state so exec-backed tools can interpolate {{ws}} references deterministically.
export type ToolFn = (
  args: Record<string, unknown>,
  worldState?: Record<string, unknown>,
) => Promise<unknown>;

export class ToolRegistry {
  private tools = new Map<string, ToolFn>();
  register(name: string, fn: ToolFn): void {
    this.tools.set(name, fn);
  }
  has(name: string): boolean {
    return this.tools.has(name);
  }
  async invoke(
    name: string,
    args: Record<string, unknown>,
    worldState?: Record<string, unknown>,
  ): Promise<unknown> {
    const fn = this.tools.get(name);
    if (!fn) throw new Error(`Unknown tool: ${name}`);
    return fn(args, worldState);
  }
}
