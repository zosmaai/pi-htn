import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_MODEL_BASE, DEFAULT_MODEL_ID } from "./config.ts";

// Persisted user settings, written by `/htn settings`. Precedence when resolving
// effective values: explicit env var  >  this file  >  built-in default.
// (Env stays the CI/override escape hatch; the panel edits the file.)
export interface HtnSettings {
  modelBase?: string;
  model?: string;
  maxRounds?: number;
  pollSeconds?: number;
  domain?: string;
}

export const SETTINGS_DEFAULTS: Required<HtnSettings> = {
  modelBase: DEFAULT_MODEL_BASE,
  model: DEFAULT_MODEL_ID,
  maxRounds: 5,
  pollSeconds: 30,
  domain: "pr-ci",
};

function settingsPath(dir: string): string {
  return join(dir, "config.json");
}
function defaultDir(): string {
  return join(homedir(), ".pi-htn");
}

// Field metadata drives the /htn settings panel AND the `/htn settings <key> <value>`
// quick-set path. Kept pure + exported so it is unit-testable.
export interface SettingField {
  key: keyof HtnSettings;
  label: string;
  kind: "string" | "number";
}
export const SETTING_FIELDS: SettingField[] = [
  { key: "modelBase", label: "Model endpoint (base URL)", kind: "string" },
  { key: "model", label: "Model id", kind: "string" },
  { key: "maxRounds", label: "Max heal rounds", kind: "number" },
  { key: "pollSeconds", label: "Poll interval (seconds)", kind: "number" },
  { key: "domain", label: "Default repair domain", kind: "string" },
];
export function fieldByKey(key: string): SettingField | undefined {
  return SETTING_FIELDS.find((f) => f.key === key);
}
// Validate + coerce a raw string for one field. Throws on bad input.
export function coerceField(field: SettingField, raw: string): string | number {
  const v = raw.trim();
  if (field.kind === "number") {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`expected a positive number, got '${raw}'`);
    return Math.floor(n);
  }
  return v;
}
export function summarizeSettings(eff: Required<HtnSettings>): string {
  return `pi-htn settings — model ${eff.model} @ ${eff.modelBase} · domain ${eff.domain} · maxRounds ${eff.maxRounds} · poll ${eff.pollSeconds}s`;
}
export function resetSettings(dir = defaultDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(dir), "{}\n");
}

export function loadSettings(dir = defaultDir()): HtnSettings {
  const p = settingsPath(dir);
  if (!existsSync(p)) return {};
  try {
    const obj = JSON.parse(readFileSync(p, "utf8"));
    return obj && typeof obj === "object" ? (obj as HtnSettings) : {};
  } catch {
    return {};
  }
}

export function saveSettings(patch: Partial<HtnSettings>, dir = defaultDir()): HtnSettings {
  mkdirSync(dir, { recursive: true });
  const merged = { ...loadSettings(dir), ...patch };
  // Drop empty-string / undefined so they fall back to defaults rather than persist blanks.
  for (const k of Object.keys(merged) as (keyof HtnSettings)[]) {
    const v = merged[k];
    if (v === undefined || v === "") delete merged[k];
  }
  writeFileSync(settingsPath(dir), JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

// Effective config with full precedence applied. `env` defaults to process.env.
export function effectiveSettings(
  env: NodeJS.ProcessEnv = process.env,
  dir = defaultDir(),
): Required<HtnSettings> {
  const file = loadSettings(dir);
  const num = (s: string | undefined, fallback: number) => {
    const n = Number(s);
    return s !== undefined && Number.isFinite(n) ? n : fallback;
  };
  return {
    modelBase: env.PI_HTN_MODEL_BASE?.trim() || file.modelBase || SETTINGS_DEFAULTS.modelBase,
    model: env.PI_HTN_MODEL?.trim() || file.model || SETTINGS_DEFAULTS.model,
    maxRounds: num(env.PI_HTN_MAX_ROUNDS, file.maxRounds ?? SETTINGS_DEFAULTS.maxRounds),
    pollSeconds: num(env.PI_HTN_POLL_SECONDS, file.pollSeconds ?? SETTINGS_DEFAULTS.pollSeconds),
    domain: env.PI_HTN_DOMAIN?.trim() || file.domain || SETTINGS_DEFAULTS.domain,
  };
}
