---
name: verify
description: Build, serve, and drive the SysViz Astro site in headless Chrome to verify changes end-to-end.
---

# Verifying SysViz

Static Astro site (no server code). Node 22 required — always prefix npm/node commands with:

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null
```

## Build & serve

```bash
npm run build                      # must pass with zero WARN lines
npm run preview -- --port 4571     # serves dist/ (run in background)
```

## Drive (headless Chrome via playwright-core)

No Playwright browser download needed — system Chrome exists; launch with
`chromium.launch({ channel: 'chrome', headless: true })`. Install `playwright-core`
in the scratchpad dir (not the project) and run a script like
`scratchpad/drive.mjs` against `http://localhost:4571`.

Note: the Playwright node script may need `dangerouslyDisableSandbox: true` to
connect to Chrome.

## Flows worth driving

- Home: card count, search hit (`consumer group`), search miss shows "Nothing found",
  category chip filtering.
- Concept page (`/concepts/kafka/`): `section.concept-section` count equals TOC link
  count in the sidebar; TOC click scrolls; `.expressive-code button` (copy) present.
- PartitionSimulator island (hydrates on scroll — `client:visible`, wait ~400ms after
  scrollIntoView): produce preset keys, `+5 random`, `+ consumer` → status line shows
  "Rebalance!", custom key + Enter, auto-consume drains `lag N` labels over ~2.5s,
  `− consumer` floors at 1 consumer, reset empties partitions.
- Mobile (390px): sidebar hidden, back link visible.
- Unknown slug returns 404 (expected console error in probe).

## Gotchas

- Collect `pageerror`/console errors during the run; only the deliberate 404 probe
  should appear.
- New concepts: verify the card appears on home, sections are numbered panels, and
  search finds its section titles.
