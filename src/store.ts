import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadDomain } from "./yaml.ts";
import type { YamlDomain } from "./types.ts";

export class DomainStore {
  constructor(private dir = join(homedir(), ".pi-htn", "domains")) {
    mkdirSync(this.dir, { recursive: true });
  }
  private path(name: string) { return join(this.dir, `${name}.yaml`); }
  save(name: string, yamlText: string): void {
    loadDomain(yamlText); // structural validation before persisting
    writeFileSync(this.path(name), yamlText);
  }
  load(name: string): YamlDomain {
    if (!existsSync(this.path(name))) throw new Error(`No domain named ${name}`);
    return loadDomain(readFileSync(this.path(name), "utf8"));
  }
  list(): string[] {
    return readdirSync(this.dir).filter((f) => f.endsWith(".yaml")).map((f) => f.replace(/\.yaml$/, ""));
  }
}
