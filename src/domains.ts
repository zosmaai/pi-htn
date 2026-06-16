import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BUILTIN_DOMAIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "domains");

export type DomainSourceKind = "repo" | "store" | "builtin";
export interface ResolvedDomain {
  name: string;
  yamlText: string;
  path: string;
  kind: DomainSourceKind;
}

// Resolve a domain by name, most-specific first:
//   1. <repoDir>/.pi-htn/<name>.yaml   — per-repo, version-controlled domain
//   2. <storeDir>/<name>.yaml          — user's global authored domains
//   3. <builtin>/<name>.yaml           — shipped safe default
// This is what makes pi-htn reusable: a repo's own repair ladder travels with it.
export function resolveDomainYaml(
  name: string,
  opts: { repoDir?: string; storeDir?: string } = {},
): ResolvedDomain {
  const storeDir = opts.storeDir ?? join(homedir(), ".pi-htn", "domains");
  const candidates: { path: string; kind: DomainSourceKind }[] = [];
  if (opts.repoDir) candidates.push({ path: join(opts.repoDir, ".pi-htn", `${name}.yaml`), kind: "repo" });
  candidates.push({ path: join(storeDir, `${name}.yaml`), kind: "store" });
  candidates.push({ path: join(BUILTIN_DOMAIN_DIR, `${name}.yaml`), kind: "builtin" });

  for (const c of candidates) {
    if (existsSync(c.path))
      return { name, yamlText: readFileSync(c.path, "utf8"), path: c.path, kind: c.kind };
  }
  throw new Error(`No domain '${name}' found (looked in: ${candidates.map((c) => c.kind).join(", ")})`);
}
