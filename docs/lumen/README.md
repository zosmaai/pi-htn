# pi-htn — Visual Docs

Interactive, **offline-playable** documentation generated with the [`lumen`](https://github.com/the-forge-flow/lumen) skill suite. Every file here is a single self-contained HTML page (no build step, no CDN), so it renders anywhere.

> [!IMPORTANT]
> GitHub shows **raw source** when you click an `.html` file in the repo. To *view* these docs rendered, use a **Rendered** link below (GitHub Pages or the htmlpreview proxy), not the file link.

## Docs

| Doc | What it covers | Rendered | Source |
|---|---|---|---|
| 🗂️ **Gallery** | Landing page linking every visual doc | [Pages](https://zosmaai.github.io/pi-htn/lumen/) · [preview](https://htmlpreview.github.io/?https://github.com/zosmaai/pi-htn/blob/master/docs/lumen/index.html) | [`index.html`](./index.html) |
| 🏛️ **System Architecture** | 6 tabs + 6 subsystem diagrams + the 3 domains + fact-check ledger | [Pages](https://zosmaai.github.io/pi-htn/lumen/architecture.html) · [preview](https://htmlpreview.github.io/?https://github.com/zosmaai/pi-htn/blob/master/docs/lumen/architecture.html) | [`architecture.html`](./architecture.html) |
| 🎞️ **Decomposition & LLM Artifacts** | 18-slide deck: HTN task trees + the 3 inference artifacts | [Pages](https://zosmaai.github.io/pi-htn/lumen/decomposition-slides.html) · [preview](https://htmlpreview.github.io/?https://github.com/zosmaai/pi-htn/blob/master/docs/lumen/decomposition-slides.html) | [`decomposition-slides.html`](./decomposition-slides.html) |

> The **Pages** links work once GitHub Pages is enabled (see below). The **preview** links work immediately — `htmlpreview.github.io` proxies the raw file and runs it in your browser, which is fine because these docs are fully self-contained.

## Enabling GitHub Pages (one-time)

Pages gives you stable, fast `https://zosmaai.github.io/pi-htn/lumen/…` URLs.

**Option A — serve `/docs` from a branch (no workflow):**
1. Repo **Settings → Pages**
2. **Source:** *Deploy from a branch*
3. **Branch:** `master`, **Folder:** `/docs`
4. Save. Your docs land at `https://zosmaai.github.io/pi-htn/lumen/`.

**Option B — GitHub Actions** (already wired): the [`pages.yml`](../../.github/workflows/pages.yml) workflow publishes `docs/` on every push to `master`. Just set **Settings → Pages → Source: GitHub Actions**.

## Adding a new lumen doc

1. Generate the HTML with any `lumen-*` skill.
2. Drop the self-contained `.html` into **this folder** (`docs/lumen/`).
3. Add a row to the table above **and** a card in [`index.html`](./index.html).
4. Commit. Done — the gallery and README stay the single source of truth.
