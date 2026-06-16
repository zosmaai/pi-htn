import { test, expect } from "vitest";
import { FakeSmallModel, renderTemplate } from "../src/smallModel.ts";

test("renderTemplate substitutes {{vars}} from world state", () => {
  expect(renderTemplate("Reply to {{body}} re {{ticketId}}", { body: "hi", ticketId: 7 }))
    .toBe("Reply to hi re 7");
});

test("FakeSmallModel returns scripted args", async () => {
  const m = new FakeSmallModel([{ body: "drafted" }]);
  const out = await m.complete({ prompt: "x", worldState: {} });
  expect(out).toEqual({ body: "drafted" });
});
