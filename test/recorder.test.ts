import { expect, test } from "vitest";
import { extractTrace } from "../src/recorder.ts";

test("extracts ordered tool calls from a session jsonl", () => {
  const trace = extractTrace("test/fixtures/sample-session.jsonl");
  expect(trace.map((t) => t.name)).toEqual(["tally.close", "tally.reply"]);
  expect(trace[1].arguments).toEqual({ body: "thanks" });
});
