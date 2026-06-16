import { SETTING_FIELDS } from "../settings.ts";

// Shape of pi-tui's AutocompleteItem (structural — no import needed).
export interface AcItem {
  value: string;
  label: string;
  description?: string;
}

export const HTN_SUBCOMMANDS: AcItem[] = [
  { value: "author", label: "author", description: "Author a reusable domain from this session's trace" },
  { value: "run", label: "run", description: "Run a stored domain" },
  { value: "watch", label: "watch", description: "Watch a PR and heal its CI until merge-ready" },
  { value: "settings", label: "settings", description: "Open the settings panel" },
  { value: "list", label: "list", description: "List stored domains" },
];

const SETTINGS_ARGS: AcItem[] = [
  ...SETTING_FIELDS.map((f) => ({ value: f.key as string, label: f.key as string, description: f.label })),
  { value: "show", label: "show", description: "Print current settings" },
  { value: "reset", label: "reset", description: "Reset settings to defaults" },
];

const byPrefix = (items: AcItem[], cur: string): AcItem[] | null => {
  const c = cur.toLowerCase();
  const hits = items.filter((i) => i.label.toLowerCase().startsWith(c));
  return hits.length ? hits : null;
};

/**
 * Tab-completion for `/htn <args>`. `prefix` is everything after the command name.
 * Returns AutocompleteItems whose `value` is the FULL argument string to substitute
 * (matching the built-in `/model` command's whole-argument replacement semantics).
 */
export function htnArgumentCompletions(prefix: string, domains: string[]): AcItem[] | null {
  const lead = prefix.replace(/^\s+/, "");
  const endsWithSpace = prefix.length > 0 && /\s$/.test(prefix);
  const tokens = lead.split(/\s+/).filter(Boolean);
  const sub = tokens[0] ?? "";
  const completingIndex = endsWithSpace ? tokens.length : Math.max(0, tokens.length - 1);
  const cur = endsWithSpace ? "" : (tokens[tokens.length - 1] ?? "");

  // First token: the subcommand itself.
  if (completingIndex === 0) return byPrefix(HTN_SUBCOMMANDS, cur);

  // Second token: depends on the subcommand.
  if (completingIndex === 1) {
    if (sub === "settings") {
      const hits = byPrefix(SETTINGS_ARGS, cur);
      return hits ? hits.map((h) => ({ ...h, value: `settings ${h.value}` })) : null;
    }
    if (sub === "run" || sub === "author") {
      const hits = byPrefix(
        domains.map((d) => ({ value: d, label: d })),
        cur,
      );
      return hits ? hits.map((h) => ({ ...h, value: `${sub} ${h.value}` })) : null;
    }
    return null; // watch <pr>: the PR number isn't completable
  }

  // Third token: `watch <pr> <domain>`.
  if (completingIndex === 2 && sub === "watch") {
    const hits = byPrefix(
      domains.map((d) => ({ value: d, label: d, description: "repair domain" })),
      cur,
    );
    return hits ? hits.map((h) => ({ ...h, value: `watch ${tokens[1]} ${h.value}` })) : null;
  }

  return null;
}
