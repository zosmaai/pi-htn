import type { ExtensionAPI, ExtensionFactory, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DomainStore } from "./store.ts";

const extension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerCommand("htn", {
    description: "Author and run reusable HTN domains",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      if (sub === "list") {
        const names = new DomainStore().list();
        ctx.ui.notify(`Domains: ${names.join(", ") || "(none)"}`, "info");
        return;
      }
      if (sub === "author") {
        ctx.ui.notify(`Authoring '${rest[0] ?? "<name>"}' — see plan Task 9 wiring.`, "info");
        return;
      }
      if (sub === "run") {
        ctx.ui.notify(`Running '${rest[0] ?? "<name>"}' — see plan Task 9 wiring.`, "info");
        return;
      }
      ctx.ui.notify("Usage: /htn [author|run|list] <name>", "warning");
    },
  });
};

export default extension;
