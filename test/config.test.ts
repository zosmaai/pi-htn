import { expect, test } from "vitest";
import { DEFAULT_MODEL_BASE, DEFAULT_MODEL_ID, modelEndpoint } from "../src/config.ts";

test("defaults to the devserver, not the laptop", () => {
  const e = modelEndpoint({});
  expect(e.base).toBe(DEFAULT_MODEL_BASE);
  expect(e.base).toContain("devserver.zosma.ai");
  expect(e.model).toBe(DEFAULT_MODEL_ID);
});

test("env overrides win", () => {
  const e = modelEndpoint({ PI_HTN_MODEL_BASE: "http://localhost:8080/v1", PI_HTN_MODEL: "qwopus-4b-coder" });
  expect(e.base).toBe("http://localhost:8080/v1");
  expect(e.model).toBe("qwopus-4b-coder");
});
