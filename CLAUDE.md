# SysViz

Personal, client-side-only knowledge platform: one interactive cheatsheet page per
backend concept (Kafka, design patterns, Redis, …). Grows one concept at a time as
Jatin learns. No auth, no backend, personal use only.

## Stack

Astro 7 (static output) + MDX content collections, React 19 islands for interactivity,
Tailwind 4, astro-expressive-code for code blocks, Fuse.js search. Deployed to GitHub
Pages via `.github/workflows/deploy.yml`.

**Node 22 required** (system default is 20): prefix commands with
`source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null`.

## Adding a concept (the main recurring task)

Create `src/content/concepts/<slug>.mdx` — nothing else is required; routing, home-page
card, TOC, and search all derive from it. Frontmatter contract (schema in
`src/content.config.ts`):

```yaml
title: Apache Kafka          # last word gets the accent color in the hero
description: one-liner shown in hero + home card
category: Messaging          # groups cards on home (reuse existing categories when sensible)
tags: [streaming, spring-boot]
updated: YYYY-MM-DD
links: [{ label: Kafka Docs, href: https://... }]   # optional footer links
```

Body conventions (see `src/content/concepts/kafka.mdx` as the reference):

- Content before the first `##` renders as the intro box.
- Every `##` heading becomes a numbered panel (via `plugins/rehype-sections.mjs`)
  and a sidebar TOC entry. `###` for sub-steps inside a section.
- Plain markdown lists render as definition-style rows (bold term — description).
  Opt-in variants: `<ul class="plain">` (bullets), `<ul class="checks">` (green ✓).
- Markdown tables and fenced code blocks (` ```java title="Foo.java" `) are styled.
- `<Callout type="info|tip|warn" title="...">` from `src/components/ui/Callout.astro`.
- Interactive visualizations: React component under `src/components/viz/<concept>/`,
  embedded with `<MyViz client:visible />`. Build one wherever a concept has dynamic
  behavior worth simulating (see `viz/kafka/PartitionSimulator.tsx` for the style:
  `#0f0f14` container with `#26262e` border, status line explaining each action,
  small controls).

Theme: dual, user-chosen. Default is "paper" (warm cream reading surface, indigo
accent); a ☾/☀ toggle (persisted in localStorage, wired in `BaseLayout.astro`)
switches to the dark theme via `html[data-theme="dark"]` token overrides. All tokens
live in `@theme` in `src/styles/global.css`. The sidebar, code blocks, and viz
islands stay dark in BOTH themes (terminal-on-paper look), so simulators may keep
hardcoded dark hex values — but everything else MUST use token classes (`bg-panel`,
`border-line`, `text-heading`, `text-accent-ink`, `bg-info-bg`, …) so it adapts to
both themes. Never hardcode `text-white`/`bg-white` in page content. Fonts: Inter +
JetBrains Mono (self-hosted via @fontsource-variable).

## Verify

Use the project verify skill (`.claude/skills/verify/SKILL.md`): build must be
warning-free, then drive the site in headless Chrome (system Chrome via
playwright-core, `channel: 'chrome'`).
