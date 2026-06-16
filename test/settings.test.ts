import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  SETTINGS_DEFAULTS,
  coerceField,
  effectiveSettings,
  fieldByKey,
  loadSettings,
  saveSettings,
  summarizeSettings,
} from "../src/settings.ts";

const dir = () => mkdtempSync(join(tmpdir(), "htn-set-"));

test("empty dir => defaults; precedence env > file > default", () => {
  const d = dir();
  expect(loadSettings(d)).toEqual({});
  expect(effectiveSettings({}, d)).toEqual(SETTINGS_DEFAULTS);

  saveSettings({ modelBase: "http://file:9/v1", maxRounds: 9 }, d);
  expect(effectiveSettings({}, d).modelBase).toBe("http://file:9/v1");
  expect(effectiveSettings({}, d).maxRounds).toBe(9);

  // env overrides the file
  expect(effectiveSettings({ PI_HTN_MODEL_BASE: "http://env:1/v1" }, d).modelBase).toBe("http://env:1/v1");
});

test("coerceField validates numbers and passes strings; fieldByKey resolves", () => {
  const num = fieldByKey("maxRounds")!;
  expect(coerceField(num, "7")).toBe(7);
  expect(() => coerceField(num, "-1")).toThrow(/positive number/);
  expect(() => coerceField(num, "abc")).toThrow(/positive number/);
  expect(coerceField(fieldByKey("model")!, "  qwopus-coder-9b ")).toBe("qwopus-coder-9b");
  expect(fieldByKey("nope")).toBeUndefined();
  expect(summarizeSettings(SETTINGS_DEFAULTS)).toMatch(/devserver\.zosma\.ai/);
});

test("save merges and drops blanks", () => {
  const d = dir();
  saveSettings({ model: "qwopus-coder-9b" }, d);
  const merged = saveSettings({ domain: "pr-ci", model: "" }, d); // blank model dropped
  expect(merged.domain).toBe("pr-ci");
  expect(merged.model).toBeUndefined();
});
