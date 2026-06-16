// Single import surface for the vendored GamePlanHTN planner.
//
// The upstream npm package (`gameplan-htn`) ships `exports` pointing at a `dist/`
// that is never built on a GitHub install, so the bare specifier fails to resolve.
// We vendor the clean ESM `src/` (see vendor/gameplanhtn/) and re-export its default
// here. Every module imports the planner from THIS file, never from "gameplanhtn",
// so the vendor path lives in exactly one place.
//
// @ts-expect-error - vendored JS has no type declarations; treated as `any`.
import htn from "../vendor/gameplanhtn/index.js";

export default htn as {
  Domain: new (def: Record<string, unknown>) => any;
  Context: new () => any;
  Planner: new () => any;
};
