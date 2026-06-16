import { expect, test } from "vitest";
import { htnArgumentCompletions } from "../src/commands/complete.ts";

const labels = (r: ReturnType<typeof htnArgumentCompletions>) => (r ?? []).map((i) => i.label);

test("suggests subcommands on empty prefix and filters by prefix", () => {
  expect(labels(htnArgumentCompletions("", []))).toEqual(["author", "run", "watch", "settings", "list"]);
  expect(labels(htnArgumentCompletions("se", []))).toEqual(["settings"]);
  expect(labels(htnArgumentCompletions("l", []))).toEqual(["list"]);
  expect(htnArgumentCompletions("zzz", [])).toBeNull();
});

test("settings keys complete as full 'settings <key>' values", () => {
  const r = htnArgumentCompletions("settings ", [])!;
  expect(r.map((i) => i.label)).toContain("model");
  expect(r.map((i) => i.label)).toContain("reset");
  expect(r.find((i) => i.label === "model")!.value).toBe("settings model");
  expect(htnArgumentCompletions("settings mod", [])!.map((i) => i.label)).toEqual(["modelBase", "model"]);
});

test("run/author complete stored domain names", () => {
  const r = htnArgumentCompletions("run ", ["pr-ci", "tally-triage"])!;
  expect(r.map((i) => i.value)).toEqual(["run pr-ci", "run tally-triage"]);
  expect(htnArgumentCompletions("author pr", ["pr-ci", "tally-triage"])!.map((i) => i.value)).toEqual([
    "author pr-ci",
  ]);
});

test("watch completes domain at the 3rd token, not the PR number", () => {
  expect(htnArgumentCompletions("watch ", ["pr-ci"])).toBeNull(); // PR number slot
  const r = htnArgumentCompletions("watch 42 ", ["pr-ci"])!;
  expect(r[0].value).toBe("watch 42 pr-ci");
});
