import { test, expect } from "vitest";
// Vendored GamePlanHTN, re-exported via src/htn.ts (see that file for why).
import htn from "../src/htn.ts";

test("gameplanhtn exposes Domain, Context, Planner", () => {
  expect(typeof htn.Domain).toBe("function");
  expect(typeof htn.Context).toBe("function");
  expect(typeof htn.Planner).toBe("function");
});
