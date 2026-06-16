import { expect, test } from "vitest";
import { ToolRegistry } from "../src/toolRegistry.ts";

test("resolves and invokes a registered tool", async () => {
  const reg = new ToolRegistry();
  reg.register("tally.reply", async (args) => ({ ok: true, echo: args }));
  const out = await reg.invoke("tally.reply", { body: "hi" });
  expect(out).toEqual({ ok: true, echo: { body: "hi" } });
});

test("throws on unknown tool", async () => {
  const reg = new ToolRegistry();
  await expect(reg.invoke("missing.tool", {})).rejects.toThrow(/missing.tool/);
});
