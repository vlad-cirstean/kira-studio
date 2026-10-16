# P138 — `ade` colour-literal audit

Resumability artifact for `docs/v2.0/plans/P138-ade-theme-tokens.md`. Committed before any source
file changes. Every line number is at `3a71141f` (chapter branch `claude/unfinished-phases-ru3wo4`,
P137 landed). Decisions and reasons live in the plan (§3); this file is the per-literal list only.

## 1. Commands and totals

Run from repo root, against `apps/kira-space/frontend/src/ade/` (all `.vue`/`.ts`, `state/`
included):

```sh
grep -rnoE '#[0-9a-fA-F]{3,8}\b' apps/kira-space/frontend/src/ade/            # 255 hits
grep -rnoiE 'rgba?\([^)]*\)|hsla?\([^)]*\)' apps/kira-space/frontend/src/ade/  # 24 hits, all rgba()
grep -rnoE '[a-z-]+-\[#[^]]*\]' apps/kira-space/frontend/src/ade/              # 154 arbitrary hex classes
```

- 279 literal occurrences: 255 hex (all 6-digit), 24 `rgba()`. No `hsl()`, `oklch()`,
  `color-mix()` or named colour keywords.
- 31 files: 28 `.vue`, 3 `.ts`. `state/` has none. SPEC row's "190 in 23 files" predates P135
  and P137.
- 5 hits sit in comments (quoting mockup values).
- 4 hits sit in `AdeNotesEditor.vue`'s existing `<style scoped>` block (Tiptap-generated markup).
- Decisions: **109 kept**, **162 remapped** onto theme tokens, **3 normalized** onto a kept value,
  **5 comments reworded** (no literal left).
- Kept set: **57 distinct values** (§2). Every one is in use after P138. It is the gate allowlist.
- 21 remapped sites carry a kept *value* in a chrome *role* (amber accent, error text, link blue,
  grey-tone surface). The value gate cannot see those; §11 of the plan greps them explicitly.

Legend: **kept** = literal stays (tone/palette data). **remap** = replaced by the named utility or
`var()`. **normalize to kept** = off-canon variant replaced by the named kept value. **comment
reworded** = comment rewritten without a colour literal.

A target written as a utility applies to a `class`/`:class` site; a target written as `var(...)`
applies to a style object or TS string. "(existing `<style>` block)" means the `var()` goes inside
that block.

## 2. Kept set (gate allowlist)

| # | Value | Category | Meaning | Definition site |
|---|---|---|---|---|
| 1 | `rgba(232,163,61,0.14)` | tone | amber tint | `tones.ts:9-14` `TONE` |
| 2 | `#f0b85c` | tone | amber text | `tones.ts:9-14` `TONE` |
| 3 | `#e8a33d` | tone | amber solid | `tones.ts:9-14` `TONE` |
| 4 | `rgba(239,107,91,0.14)` | tone | red tint | `tones.ts:9-14` `TONE` |
| 5 | `#f28b7d` | tone | red text | `tones.ts:9-14` `TONE` |
| 6 | `#ef6b5b` | tone | red solid | `tones.ts:9-14` `TONE` |
| 7 | `rgba(108,197,138,0.14)` | tone | green tint | `tones.ts:9-14` `TONE` |
| 8 | `#7fd49b` | tone | green text | `tones.ts:9-14` `TONE` |
| 9 | `#6cc58a` | tone | green solid | `tones.ts:9-14` `TONE` |
| 10 | `rgba(122,167,255,0.14)` | tone | blue tint | `tones.ts:9-14` `TONE` |
| 11 | `#93b6ff` | tone | blue text | `tones.ts:9-14` `TONE` |
| 12 | `#7aa7ff` | tone | blue solid | `tones.ts:9-14` `TONE` |
| 13 | `rgba(163,113,247,0.16)` | tone | purple tint | `tones.ts:9-14` `TONE` |
| 14 | `#c3a3fb` | tone | purple text | `tones.ts:9-14` `TONE` |
| 15 | `#a371f7` | tone | purple solid | `tones.ts:9-14` `TONE` |
| 16 | `#23252b` | tone | grey tint | `tones.ts:9-14` `TONE` |
| 17 | `#b4b6bd` | tone | grey text | `tones.ts:9-14` `TONE` |
| 18 | `#6b6f7a` | tone | grey solid | `tones.ts:9-14` `TONE` |
| 19 | `#15161a` | tone ink | ink on amber/red/green/blue/grey solid | `TONE_INK` (new, `tones.ts`); today inline in `AdePanelHeader.vue:65`, `AdeStackBlock.vue:84,150` |
| 20 | `#ffffff` | tone ink | ink on purple solid | `TONE_INK` (new, `tones.ts`); today inline in `AdePanelHeader.vue:65`, `AdeStackBlock.vue:84,150` |
| 21 | `rgba(232,163,61,0.07)` | tone alpha | amber tint 7% | inline at its one site (see §5) |
| 22 | `rgba(232,163,61,0.08)` | tone alpha | amber tint 8% | inline at its one site (see §5) |
| 23 | `rgba(232,163,61,0.04)` | tone alpha | amber tint 4% | inline at its one site (see §5) |
| 24 | `rgba(108,197,138,0.28)` | tone alpha | green halo 28% | inline at its one site (see §5) |
| 25 | `rgba(163,113,247,0.06)` | tone alpha | purple tint 6% | inline at its one site (see §5) |
| 26 | `rgba(163,113,247,0.08)` | tone alpha | purple tint 8% | inline at its one site (see §5) |
| 27 | `rgba(163,113,247,0.18)` | tone alpha | purple tint 18% | inline at its one site (see §5) |
| 28 | `rgba(163,113,247,0.55)` | tone alpha | purple border 55% | inline at its one site (see §5) |
| 29 | `rgba(122,167,255,0.35)` | tone alpha | blue border 35% | inline at its one site (see §5) |
| 30 | `rgba(122,167,255,0.12)` | tone alpha | blue tint 12% | inline at its one site (see §5) |
| 31 | `rgba(122,167,255,0.16)` | tone alpha | blue tint 16% | inline at its one site (see §5) |
| 32 | `rgba(122,167,255,0.07)` | tone alpha | blue stripe 7% | inline at its one site (see §5) |
| 33 | `rgba(122,167,255,0.03)` | tone alpha | blue stripe 3% | inline at its one site (see §5) |
| 34 | `rgba(239,107,91,0.08)` | tone alpha | red tint 8% (new, replaces #2a1917) | inline at its one site (see §5) |
| 35 | `#4fb8c4` | dependency kind | dependency solid | `useQueue.ts:61` `DEPENDENCY_COLOR` (solid); text/tint inline, one site each |
| 36 | `#9fdde4` | dependency kind | dependency text | `useQueue.ts:61` `DEPENDENCY_COLOR` (solid); text/tint inline, one site each |
| 37 | `rgba(79,184,196,0.07)` | dependency kind | dependency tint | `useQueue.ts:61` `DEPENDENCY_COLOR` (solid); text/tint inline, one site each |
| 38 | `#e07a4f` | work palette | slot 0 | `useQueue.ts:38` `PALETTE` |
| 39 | `#e3a53c` | work palette | slot 1 | `useQueue.ts:39` `PALETTE` |
| 40 | `#c9c23a` | work palette | slot 2 | `useQueue.ts:40` `PALETTE` |
| 41 | `#8cc152` | work palette | slot 3 | `useQueue.ts:41` `PALETTE` |
| 42 | `#4db86c` | work palette | slot 4 | `useQueue.ts:42` `PALETTE` |
| 43 | `#35b5a0` | work palette | slot 5 | `useQueue.ts:43` `PALETTE` |
| 44 | `#38a8cc` | work palette | slot 6 | `useQueue.ts:44` `PALETTE` |
| 45 | `#4a8ee6` | work palette | slot 7 | `useQueue.ts:45` `PALETTE` |
| 46 | `#6e79ea` | work palette | slot 8 | `useQueue.ts:46` `PALETTE` |
| 47 | `#9a6ee2` | work palette | slot 9 | `useQueue.ts:47` `PALETTE` |
| 48 | `#c566d8` | work palette | slot 10 | `useQueue.ts:48` `PALETTE` |
| 49 | `#e062a8` | work palette | slot 11 | `useQueue.ts:49` `PALETTE` |
| 50 | `#e35f79` | work palette | slot 12 | `useQueue.ts:50` `PALETTE` |
| 51 | `#b88458` | work palette | slot 13 | `useQueue.ts:51` `PALETTE` |
| 52 | `#94a35a` | work palette | slot 14 | `useQueue.ts:52` `PALETTE` |
| 53 | `#58a08e` | work palette | slot 15 | `useQueue.ts:53` `PALETTE` |
| 54 | `#7b92b8` | work palette | slot 16 | `useQueue.ts:54` `PALETTE` |
| 55 | `#a57ec0` | work palette | slot 17 | `useQueue.ts:55` `PALETTE` |
| 56 | `#d58c8c` | work palette | slot 18 | `useQueue.ts:56` `PALETTE` |
| 57 | `#a3aab4` | work palette | slot 19 | `useQueue.ts:57` `PALETTE` |

## 3. Chrome value map (default per value; per-site overrides in §5)

| Literal | Uses | Kept | Remap | Normalize | Comment | Role / default target |
|---|---|---|---|---|---|---|
| `#9a9ca5` | 48 | 0 | 48 | 0 | 0 | chrome: var(--kira-fg-muted) |
| `#e8a33d` | 15 | 8 | 7 | 0 | 0 | tone: amber solid |
| `#f0b85c` | 13 | 13 | 0 | 0 | 0 | tone: amber text |
| `#f28b7d` | 13 | 7 | 6 | 0 | 0 | tone: red text |
| `#c9c7c2` | 12 | 0 | 12 | 0 | 0 | chrome: var(--kira-fg) |
| `#3a3e48` | 12 | 0 | 11 | 0 | 1 | chrome: var(--kira-border-strong) |
| `#7aa7ff` | 8 | 4 | 3 | 0 | 1 | tone: blue solid |
| `#7c7f88` | 8 | 0 | 8 | 0 | 0 | chrome: var(--kira-fg-subtle) |
| `#93b6ff` | 7 | 7 | 0 | 0 | 0 | tone: blue text |
| `#d97757` | 7 | 0 | 5 | 0 | 2 | chrome: var(--primary) |
| `#22252c` | 7 | 0 | 7 | 0 | 0 | chrome: var(--kira-border) |
| `#15161a` | 6 | 5 | 1 | 0 | 0 | tone ink: ink on amber/red/green/blue/grey solid |
| `#2a2d35` | 6 | 0 | 6 | 0 | 0 | chrome: var(--kira-border) |
| `#2f323b` | 6 | 0 | 6 | 0 | 0 | chrome: var(--kira-border-strong) |
| `#7fd49b` | 5 | 5 | 0 | 0 | 0 | tone: green text |
| `#1b1d22` | 5 | 0 | 5 | 0 | 0 | chrome: var(--kira-bg-elevated) |
| `#23252b` | 3 | 1 | 2 | 0 | 0 | tone: grey tint |
| `#34373f` | 3 | 0 | 3 | 0 | 0 | chrome: var(--kira-border-strong) |
| `#121316` | 3 | 0 | 3 | 0 | 0 | chrome: var(--kira-bg-chrome) |
| `#6b6f7a` | 3 | 1 | 2 | 0 | 0 | tone: grey solid |
| `#c3a3fb` | 3 | 3 | 0 | 0 | 0 | tone: purple text |
| `#16171b` | 3 | 0 | 3 | 0 | 0 | chrome: var(--kira-bg-chrome) |
| `#ffffff` | 3 | 3 | 0 | 0 | 0 | tone ink: ink on purple solid |
| `#4fb8c4` | 3 | 3 | 0 | 0 | 0 | dependency kind: dependency solid |
| `#6cc58a` | 2 | 2 | 0 | 0 | 0 | tone: green solid |
| `#4a4d56` | 2 | 0 | 2 | 0 | 0 | chrome: var(--kira-fg-disabled) |
| `#0b0c0e` | 2 | 0 | 2 | 0 | 0 | chrome: var(--kira-bg) |
| `#2a2c33` | 2 | 0 | 2 | 0 | 0 | see sites |
| `rgba(232,163,61,0.14)` | 2 | 2 | 0 | 0 | 0 | tone: amber tint |
| `#4f525b` | 2 | 0 | 2 | 0 | 0 | chrome: var(--kira-fg-subtle) |
| `#e8e6e1` | 2 | 0 | 2 | 0 | 0 | chrome: var(--kira-fg) |
| `#ef6b5b` | 2 | 2 | 0 | 0 | 0 | tone: red solid |
| `#a371f7` | 2 | 2 | 0 | 0 | 0 | tone: purple solid |
| `#1a0f0a` | 2 | 0 | 2 | 0 | 0 | chrome: var(--primary-foreground) |
| `#5c606b` | 2 | 0 | 0 | 1 | 1 | see sites |
| `#b4b6bd` | 2 | 2 | 0 | 0 | 0 | tone: grey text |
| `rgba(108,197,138,0.28)` | 1 | 1 | 0 | 0 | 0 | tone alpha: green halo 28% |
| `#0f1013` | 1 | 0 | 1 | 0 | 0 | chrome: var(--kira-bg-chrome) |
| `rgba(232,163,61,0.08)` | 1 | 1 | 0 | 0 | 0 | tone alpha: amber tint 8% |
| `#101114` | 1 | 0 | 1 | 0 | 0 | chrome: var(--kira-bg-chrome) |
| `rgba(232,163,61,0.07)` | 1 | 1 | 0 | 0 | 0 | tone alpha: amber tint 7% |
| `#2a1917` | 1 | 0 | 0 | 1 | 0 | see sites |
| `#202227` | 1 | 0 | 1 | 0 | 0 | chrome: var(--kira-border) |
| `rgba(232,163,61,0.1)` | 1 | 0 | 1 | 0 | 0 | see sites |
| `rgba(255,255,255,0.018)` | 1 | 0 | 1 | 0 | 0 | see sites |
| `rgba(232,163,61,0.04)` | 1 | 1 | 0 | 0 | 0 | tone alpha: amber tint 4% |
| `rgba(255,255,255,0.012)` | 1 | 0 | 1 | 0 | 0 | see sites |
| `rgba(163,113,247,0.06)` | 1 | 1 | 0 | 0 | 0 | tone alpha: purple tint 6% |
| `#e8a07f` | 1 | 0 | 1 | 0 | 0 | see sites |
| `rgba(217,119,87,0.18)` | 1 | 0 | 1 | 0 | 0 | see sites |
| `rgba(163,113,247,0.18)` | 1 | 1 | 0 | 0 | 0 | tone alpha: purple tint 18% |
| `#b9cfff` | 1 | 0 | 0 | 1 | 0 | see sites |
| `rgba(122,167,255,0.12)` | 1 | 1 | 0 | 0 | 0 | tone alpha: blue tint 12% |
| `rgba(122,167,255,0.35)` | 1 | 1 | 0 | 0 | 0 | tone alpha: blue border 35% |
| `rgba(79,184,196,0.07)` | 1 | 1 | 0 | 0 | 0 | dependency kind: dependency tint |
| `#17181c` | 1 | 0 | 1 | 0 | 0 | chrome: var(--kira-bg-chrome) |
| `#1c1d22` | 1 | 0 | 1 | 0 | 0 | chrome: var(--kira-bg) |
| `rgba(163,113,247,0.55)` | 1 | 1 | 0 | 0 | 0 | tone alpha: purple border 55% |
| `#1a1c21` | 1 | 0 | 1 | 0 | 0 | chrome: var(--kira-bg-elevated) |
| `#9fdde4` | 1 | 1 | 0 | 0 | 0 | dependency kind: dependency text |
| `#26272d` | 1 | 0 | 1 | 0 | 0 | chrome: var(--kira-hover) |
| `rgba(163,113,247,0.08)` | 1 | 1 | 0 | 0 | 0 | tone alpha: purple tint 8% |
| `rgba(122,167,255,0.03)` | 1 | 1 | 0 | 0 | 0 | tone alpha: blue stripe 3% |
| `rgba(122,167,255,0.07)` | 1 | 1 | 0 | 0 | 0 | tone alpha: blue stripe 7% |
| `rgba(122,167,255,0.16)` | 1 | 1 | 0 | 0 | 0 | tone alpha: blue tint 16% |
| `rgba(239,107,91,0.14)` | 1 | 1 | 0 | 0 | 0 | tone: red tint |
| `rgba(108,197,138,0.14)` | 1 | 1 | 0 | 0 | 0 | tone: green tint |
| `rgba(122,167,255,0.14)` | 1 | 1 | 0 | 0 | 0 | tone: blue tint |
| `rgba(163,113,247,0.16)` | 1 | 1 | 0 | 0 | 0 | tone: purple tint |

Plus 20 work palette values, 1 use each (`useQueue.ts:38-57`), all kept.

## 4. Per-file summary

| File | Total | Kept | Remap | Normalize | Comment |
|---|---|---|---|---|---|
| `AdeActivityGlyph.vue` | 8 | 6 | 2 | 0 | 0 |
| `AdeAddPopover.vue` | 2 | 1 | 1 | 0 | 0 |
| `AdeAgentsPill.vue` | 7 | 3 | 4 | 0 | 0 |
| `AdeAgentsTab.vue` | 21 | 2 | 19 | 0 | 0 |
| `AdeAllAgentsRow.vue` | 8 | 4 | 4 | 0 | 0 |
| `AdeAllAgentsView.vue` | 7 | 0 | 7 | 0 | 0 |
| `AdeBlockerRow.vue` | 1 | 0 | 1 | 0 | 0 |
| `AdeCandidatePicker.vue` | 3 | 2 | 1 | 0 | 0 |
| `AdeChangesTab.vue` | 22 | 7 | 14 | 1 | 0 |
| `AdeClaudeDialog.vue` | 1 | 0 | 1 | 0 | 0 |
| `AdeContinuationRow.vue` | 5 | 1 | 4 | 0 | 0 |
| `AdeDayBand.vue` | 29 | 14 | 15 | 0 | 0 |
| `AdeDayControls.vue` | 3 | 0 | 3 | 0 | 0 |
| `AdeDependencyDetails.vue` | 5 | 1 | 4 | 0 | 0 |
| `AdeDetailPanel.vue` | 12 | 0 | 12 | 0 | 0 |
| `AdeDetailsTab.vue` | 4 | 0 | 4 | 0 | 0 |
| `AdeEstimateField.vue` | 11 | 0 | 11 | 0 | 0 |
| `AdeHistoryBar.vue` | 8 | 0 | 8 | 0 | 0 |
| `AdeHistoryPull.vue` | 2 | 1 | 1 | 0 | 0 |
| `AdeLinkRow.vue` | 7 | 0 | 7 | 0 | 0 |
| `AdeMainLine.vue` | 5 | 5 | 0 | 0 | 0 |
| `AdeMyWorkToggle.vue` | 1 | 0 | 1 | 0 | 0 |
| `AdeNotesEditor.vue` | 11 | 0 | 11 | 0 | 0 |
| `AdePanelHeader.vue` | 11 | 5 | 4 | 1 | 1 |
| `AdePanelResizeHandle.vue` | 3 | 0 | 3 | 0 | 0 |
| `AdeStackBlock.vue` | 17 | 9 | 8 | 0 | 0 |
| `AdeStackRow.vue` | 19 | 9 | 7 | 1 | 2 |
| `AdeWorkTypeField.vue` | 2 | 0 | 2 | 0 | 0 |
| `allAgents.ts` | 2 | 0 | 1 | 0 | 1 |
| `tones.ts` | 21 | 18 | 2 | 0 | 1 |
| `useQueue.ts` | 21 | 21 | 0 | 0 | 0 |
| **Total** | **279** | **109** | **162** | **3** | **5** |

Files with no literal (untouched for colour): `AdeActivityIcon.vue`, `AdeProjectHeader.vue`,
`AdeRepoTabs.vue`, `AdeRepoView.vue`, `AdeTimeline.vue`, `AdeView.vue`, every other `.ts`. Files
with only kept literals (no edit needed): `AdeMainLine.vue`, `useQueue.ts`.

## 5. Per-site list

### `AdeActivityGlyph.vue` (8: 6 kept, 2 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 33 | `#15161a` | kept | tone ink: ink on amber/red/green/blue/grey solid |
| 33 | `#e8a33d` | kept | tone: amber solid |
| 39 | `#6cc58a` | kept | tone: green solid |
| 39 | `rgba(108,197,138,0.28)` | kept | tone alpha: green halo 28% |
| 44 | `#7aa7ff` | kept | tone: blue solid |
| 44 | `#93b6ff` | kept | tone: blue text |
| 50 | `#7c7f88` | remap | border-subtle |
| 52 | `#4a4d56` | remap | bg-disabled |

### `AdeAddPopover.vue` (2: 1 kept, 1 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 226 | `#23252b` | remap | bg-field |
| 226 | `#7aa7ff` | kept | tone: blue solid |

### `AdeAgentsPill.vue` (7: 3 kept, 4 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 20 | `#f0b85c` | kept | tone: amber text |
| 21 | `#7fd49b` | kept | tone: green text |
| 22 | `#93b6ff` | kept | tone: blue text |
| 23 | `#9a9ca5` | remap | var(--kira-fg-muted) |
| 35 | `#0f1013` | remap | bg-chrome |
| 35 | `#34373f` | remap | border-border-strong |
| 38 | `#d97757` | remap | text-primary (robot icon) |

### `AdeAgentsTab.vue` (21: 2 kept, 19 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 66 | `#f0b85c` | kept | tone: amber text |
| 66 | `rgba(232,163,61,0.08)` | kept | tone alpha: amber tint 8% |
| 68 | `#9a9ca5` | remap | var(--kira-fg-muted) |
| 93 | `#0b0c0e` | remap | bg-bg |
| 97 | `#101114` | remap | bg-chrome |
| 97 | `#22252c` | remap | border-border |
| 105 | `#22252c` | remap | border-border |
| 108 | `#0b0c0e` | remap | bg-bg |
| 108 | `#d97757` | remap | shadow-[inset_0_2px_0_var(--primary)] (active session tab rail) |
| 109 | `#9a9ca5` | remap | text-muted-foreground |
| 119 | `#9a9ca5` | remap | text-muted-foreground |
| 131 | `#22252c` | remap | border-border |
| 148 | `#9a9ca5` | remap | text-muted-foreground |
| 150 | `#22252c` | remap | border-border |
| 169 | `#f28b7d` | remap | text-error (form/mutation error; AdeView.vue importError precedent) |
| 171 | `#9a9ca5` | remap | text-muted-foreground |
| 177 | `#121316` | remap | bg-chrome |
| 177 | `#22252c` | remap | border-border |
| 179 | `#9a9ca5` | remap | text-muted-foreground |
| 186 | `#4a4d56` | remap | bg-disabled |
| 188 | `#9a9ca5` | remap | text-muted-foreground |

### `AdeAllAgentsRow.vue` (8: 4 kept, 4 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 22 | `#f0b85c` | kept | tone: amber text |
| 23 | `#7fd49b` | kept | tone: green text |
| 24 | `#93b6ff` | kept | tone: blue text |
| 25 | `#9a9ca5` | remap | var(--kira-fg-muted) |
| 32 | `rgba(232,163,61,0.07)` | kept | tone alpha: amber tint 7% |
| 53 | `#9a9ca5` | remap | text-muted-foreground |
| 73 | `#9a9ca5` | remap | text-muted-foreground |
| 78 | `#7c7f88` | remap | text-subtle |

### `AdeAllAgentsView.vue` (7: 7 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 179 | `#1b1d22` | remap | bg-elevated |
| 179 | `#2a2d35` | remap | border-border |
| 185 | `#2a2c33` | remap | delete data-[state=on]:bg-[..]: ToggleGroupItem default data-[state=on]:bg-field applies |
| 191 | `#2a2c33` | remap | delete data-[state=on]:bg-[..]: ToggleGroupItem default data-[state=on]:bg-field applies |
| 200 | `#c9c7c2` | remap | text-fg |
| 214 | `#22252c` | remap | border-border |
| 226 | `#9a9ca5` | remap | text-muted-foreground |

### `AdeBlockerRow.vue` (1: 1 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 61 | `#9a9ca5` | remap | text-muted-foreground |

### `AdeCandidatePicker.vue` (3: 2 kept, 1 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 26 | `#f0b85c` | kept | tone: amber text |
| 26 | `rgba(232,163,61,0.14)` | kept | tone: amber tint |
| 38 | `#f28b7d` | remap | text-error (form/mutation error; AdeView.vue importError precedent) |

### `AdeChangesTab.vue` (22: 7 kept, 14 remap, 1 normalize to kept)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 24 | `#c9c7c2` | remap | var(--kira-fg) |
| 24 | `#f0b85c` | kept | tone: amber text |
| 25 | `#c9c7c2` | remap | var(--kira-fg) |
| 25 | `#f0b85c` | kept | tone: amber text |
| 54 | `#9a9ca5` | remap | text-muted-foreground |
| 58 | `#9a9ca5` | remap | text-muted-foreground |
| 60 | `#9a9ca5` | remap | text-muted-foreground |
| 63 | `#9a9ca5` | remap | text-muted-foreground |
| 64 | `#f28b7d` | kept | tone: red text |
| 69 | `#9a9ca5` | remap | text-muted-foreground |
| 70 | `#f0b85c` | kept | tone: amber text |
| 77 | `#9a9ca5` | remap | text-muted-foreground |
| 84 | `#7fd49b` | kept | tone: green text |
| 84 | `#f0b85c` | kept | tone: amber text |
| 85 | `#c9c7c2` | remap | text-fg |
| 90 | `#9a9ca5` | remap | text-muted-foreground |
| 97 | `#e8a33d` | remap | text-muted-foreground (commit sha; git-ui precedent) |
| 103 | `#9a9ca5` | remap | text-muted-foreground |
| 108 | `#2a1917` | normalize to kept | bg-[rgba(239,107,91,0.08)] (red tone alpha; opaque off-canon variant replaced) |
| 108 | `#c9c7c2` | remap | text-fg |
| 108 | `#f28b7d` | kept | tone: red text |
| 113 | `#9a9ca5` | remap | text-muted-foreground |

### `AdeClaudeDialog.vue` (1: 1 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 113 | `#d97757` | remap | text-primary (robot icon) |

### `AdeContinuationRow.vue` (5: 1 kept, 4 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 17 | `#34373f` | remap | border-border-strong |
| 22 | `#7c7f88` | remap | text-subtle |
| 25 | `#7c7f88` | remap | text-subtle |
| 25 | `#f0b85c` | kept | tone: amber text |
| 28 | `#c9c7c2` | remap | text-fg |

### `AdeDayBand.vue` (29: 14 kept, 15 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 52 | `#34373f` | remap | border-t-border-strong |
| 53 | `#202227` | remap | border-t-border |
| 58 | `rgba(232,163,61,0.1)` | remap | 'color-mix(in srgb, var(--kira-focus) 10%, transparent)' (drop highlight) |
| 60 | `rgba(255,255,255,0.018)` | remap | 'color-mix(in srgb, var(--kira-fg) 2%, transparent)' (weekend/day-off stripe) |
| 62 | `rgba(232,163,61,0.04)` | kept | tone alpha: amber tint 4% |
| 63 | `rgba(255,255,255,0.012)` | remap | 'color-mix(in srgb, var(--kira-fg) 1.5%, transparent)' (past-day wash) |
| 68 | `#e8a33d` | kept | tone: amber solid |
| 69 | `#2a2d35` | remap | var(--kira-border) |
| 70 | `#3a3e48` | remap | var(--kira-border-strong) |
| 74 | `#4f525b` | remap | var(--kira-fg-subtle) |
| 75 | `#f0b85c` | kept | tone: amber text |
| 76 | `#6b6f7a` | remap | var(--kira-fg-subtle) (empty/past day label) |
| 77 | `#e8e6e1` | remap | var(--kira-fg) |
| 81 | `#4f525b` | remap | var(--kira-fg-subtle) |
| 82 | `#f28b7d` | kept | tone: red text |
| 83 | `#9a9ca5` | remap | var(--kira-fg-muted) |
| 102 | `#121316` | remap | var(--kira-bg) (tick hides on the timeline's own bg-bg) |
| 102 | `#e8a33d` | kept | tone: amber solid |
| 110 | `#e8a33d` | remap | outline-focus (drop highlight) |
| 147 | `rgba(163,113,247,0.06)` | kept | tone alpha: purple tint 6% |
| 149 | `#c3a3fb` | kept | tone: purple text |
| 150 | `#c3a3fb` | kept | tone: purple text |
| 151 | `#c9c7c2` | remap | text-fg |
| 156 | `#f0b85c` | kept | tone: amber text |
| 161 | `#15161a` | kept | tone ink: ink on amber/red/green/blue/grey solid |
| 161 | `#e8a33d` | kept | tone: amber solid |
| 170 | `#f28b7d` | kept | tone: red text |
| 175 | `#ef6b5b` | kept | tone: red solid |
| 175 | `#f28b7d` | kept | tone: red text |

### `AdeDayControls.vue` (3: 3 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 21 | `#3a3e48` | remap | border-border-strong |
| 32 | `#3a3e48` | remap | border-border-strong |
| 32 | `#c9c7c2` | remap | text-fg |

### `AdeDependencyDetails.vue` (5: 1 kept, 4 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 94 | `#9a9ca5` | remap | text-muted-foreground |
| 105 | `#9a9ca5` | remap | text-muted-foreground |
| 116 | `#9a9ca5` | remap | text-muted-foreground |
| 126 | `#f28b7d` | kept | tone: red text |
| 134 | `#9a9ca5` | remap | text-muted-foreground |

### `AdeDetailPanel.vue` (12: 12 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 39 | `#e8a07f` | remap | running count pill: class text-fg |
| 39 | `rgba(217,119,87,0.18)` | remap | running count pill: class bg-primary/20 |
| 40 | `#23252b` | remap | idle count pill: class bg-field (style object becomes a class computed) |
| 40 | `#9a9ca5` | remap | idle count pill: class text-muted-foreground |
| 46 | `#16171b` | remap | bg-chrome |
| 65 | `#2a2d35` | remap | border-border |
| 70 | `#9a9ca5` | remap | text-muted-foreground |
| 70 | `#e8a33d` | remap | data-[state=active]:border-b-primary (active tab underline) |
| 77 | `#9a9ca5` | remap | text-muted-foreground |
| 77 | `#e8a33d` | remap | data-[state=active]:border-b-primary (active tab underline) |
| 84 | `#9a9ca5` | remap | text-muted-foreground |
| 84 | `#e8a33d` | remap | data-[state=active]:border-b-primary (active tab underline) |

### `AdeDetailsTab.vue` (4: 4 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 191 | `#9a9ca5` | remap | text-muted-foreground |
| 197 | `#1b1d22` | remap | bg-field (name input surface) |
| 203 | `#c9c7c2` | remap | text-fg |
| 235 | `#f28b7d` | remap | text-error (form/mutation error; AdeView.vue importError precedent) |

### `AdeEstimateField.vue` (11: 11 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 63 | `#9a9ca5` | remap | text-muted-foreground |
| 77 | `#9a9ca5` | remap | text-muted-foreground |
| 87 | `#9a9ca5` | remap | text-muted-foreground |
| 101 | `#1b1d22` | remap | bg-elevated |
| 101 | `#2f323b` | remap | border-border-strong |
| 108 | `#2f323b` | remap | bg-field (segmented on-state; Toggle primitive precedent) |
| 108 | `#9a9ca5` | remap | text-muted-foreground |
| 118 | `#2f323b` | remap | bg-field (segmented on-state) |
| 118 | `#9a9ca5` | remap | text-muted-foreground |
| 126 | `#9a9ca5` | remap | text-muted-foreground |
| 128 | `#f28b7d` | remap | text-error (form/mutation error; AdeView.vue importError precedent) |

### `AdeHistoryBar.vue` (8: 8 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 16 | `#1b1d22` | remap | bg-elevated |
| 16 | `#2f323b` | remap | border-border-strong |
| 24 | `#3a3e48` | remap | border-border-strong |
| 24 | `#c9c7c2` | remap | text-fg |
| 31 | `#3a3e48` | remap | border-border-strong |
| 31 | `#c9c7c2` | remap | text-fg |
| 39 | `#15161a` | remap | text-primary-foreground |
| 39 | `#e8a33d` | remap | bg-primary ("Current work" is a plain primary button, no data state) |

### `AdeHistoryPull.vue` (2: 1 kept, 1 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 26 | `#3a3e48` | remap | border-border-strong |
| 32 | `rgba(163,113,247,0.18)` | kept | tone alpha: purple tint 18% |

### `AdeLinkRow.vue` (7: 7 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 84 | `#9a9ca5` | remap | text-muted-foreground |
| 99 | `#7c7f88` | remap | text-subtle |
| 102 | `#9a9ca5` | remap | text-muted-foreground |
| 112 | `#9a9ca5` | remap | text-muted-foreground |
| 122 | `#9a9ca5` | remap | text-muted-foreground |
| 131 | `#7c7f88` | remap | text-subtle |
| 144 | `#f28b7d` | remap | text-error (form/mutation error; AdeView.vue importError precedent) |

### `AdeMainLine.vue` (5: 5 kept)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 32 | `#7fd49b` | kept | tone: green text |
| 32 | `#f0b85c` | kept | tone: amber text |
| 53 | `#15161a` | kept | tone ink: ink on amber/red/green/blue/grey solid |
| 53 | `#e8a33d` | kept | tone: amber solid |
| 53 | `#e8a33d` | kept | tone: amber solid |

### `AdeMyWorkToggle.vue` (1: 1 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 12 | `#9a9ca5` | remap | text-muted-foreground |

### `AdeNotesEditor.vue` (11: 11 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 181 | `#121316` | remap | bg-bg (editor surface; Monaco/xterm use --kira-bg) |
| 181 | `#2f323b` | remap | border-border-strong |
| 185 | `#16171b` | remap | bg-chrome |
| 185 | `#22252c` | remap | border-border |
| 187 | `#9a9ca5` | remap | text-muted-foreground |
| 193 | `#2f323b` | remap | bg-field (toolbar button on-state) |
| 193 | `#c9c7c2` | remap | text-fg |
| 263 | `#7c7f88` | remap | var(--kira-fg-subtle) (existing <style> block) |
| 268 | `#1b1d22` | remap | var(--kira-bg-input) (inline code chip, inside the existing <style> block) |
| 274 | `#7aa7ff` | remap | var(--kira-info) (link, inside the existing <style> block) |
| 279 | `#6b6f7a` | remap | var(--kira-fg-subtle) (placeholder, inside the existing <style> block) |

### `AdePanelHeader.vue` (11: 5 kept, 4 remap, 1 normalize to kept, 1 comment reworded)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 55 | `#d97757` | comment reworded | reword: "the Claude button style (CLAUDE_BUTTON_STYLE)"; no literal |
| 61 | `#3a3e48` | remap | var(--kira-border-strong) |
| 61 | `#e8e6e1` | remap | var(--kira-fg) |
| 65 | `#15161a` | kept | tone ink: ink on amber/red/green/blue/grey solid |
| 65 | `#ffffff` | kept | tone ink: ink on purple solid |
| 121 | `#2a2d35` | remap | border-border |
| 138 | `#9a9ca5` | remap | text-muted-foreground |
| 143 | `#b9cfff` | normalize to kept | text-[#93b6ff] (blue tone text; off-canon lighter variant collapsed) |
| 143 | `rgba(122,167,255,0.12)` | kept | tone alpha: blue tint 12% |
| 143 | `rgba(122,167,255,0.35)` | kept | tone alpha: blue border 35% |
| 146 | `#93b6ff` | kept | tone: blue text |

### `AdePanelResizeHandle.vue` (3: 3 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 80 | `#16171b` | remap | bg-chrome |
| 80 | `#2a2d35` | remap | border-border |
| 84 | `#3a3e48` | remap | bg-border-strong |

### `AdeStackBlock.vue` (17: 9 kept, 8 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 53 | `#4fb8c4` | kept | dependency kind: dependency solid |
| 54 | `#4fb8c4` | kept | dependency kind: dependency solid |
| 55 | `rgba(79,184,196,0.07)` | kept | dependency kind: dependency tint |
| 60 | `#3a3e48` | remap | var(--kira-border-strong) |
| 61 | `#17181c` | remap | var(--kira-bg-chrome) |
| 61 | `#1c1d22` | remap | var(--kira-bg) |
| 66 | `#e8a33d` | kept | tone: amber solid |
| 68 | `rgba(163,113,247,0.55)` | kept | tone alpha: purple border 55% |
| 70 | `#3a3e48` | remap | var(--kira-border-strong) |
| 71 | `#2a2d35` | remap | var(--kira-border) |
| 72 | `#1a1c21` | remap | var(--kira-bg-elevated) |
| 84 | `#15161a` | kept | tone ink: ink on amber/red/green/blue/grey solid |
| 84 | `#ffffff` | kept | tone ink: ink on purple solid |
| 150 | `#a371f7` | kept | purple tone solid; read as TONE.purple[2] (archive cell action) |
| 150 | `#ffffff` | kept | purple ink; read as TONE_INK.purple |
| 151 | `#1a0f0a` | remap | CLAUDE_BUTTON_STYLE |
| 151 | `#d97757` | remap | CLAUDE_BUTTON_STYLE (Start cell action reuses the shared style) |

### `AdeStackRow.vue` (19: 9 kept, 7 remap, 1 normalize to kept, 2 comment reworded)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 17 | `#5c606b` | comment reworded | same comment as above; no literal |
| 17 | `#7aa7ff` | comment reworded | reword: elbow = blue tone solid under a review parent, grey tone solid otherwise |
| 34 | `#5c606b` | normalize to kept | TONE.grey[2] (#6b6f7a): elbow = TONE[parentKind === 'review' ? 'blue' : 'grey'][2] |
| 34 | `#7aa7ff` | kept | blue tone solid, read as TONE.blue[2] in the same expression |
| 37 | `#93b6ff` | kept | tone: blue text |
| 38 | `#b4b6bd` | kept | tone: grey text |
| 39 | `#9fdde4` | kept | dependency kind: dependency text |
| 44 | `#26272d` | remap | var(--kira-hover) (selected row background) |
| 44 | `#e8a33d` | remap | var(--primary) (selected row rail; DocumentRow.vue precedent) |
| 45 | `rgba(163,113,247,0.08)` | kept | tone alpha: purple tint 8% |
| 49 | `rgba(122,167,255,0.03)` | kept | tone alpha: blue stripe 3% |
| 49 | `rgba(122,167,255,0.07)` | kept | tone alpha: blue stripe 7% |
| 129 | `#93b6ff` | kept | tone: blue text |
| 129 | `rgba(122,167,255,0.16)` | kept | tone alpha: blue tint 16% |
| 147 | `#7c7f88` | remap | text-subtle |
| 147 | `#9a9ca5` | remap | text-muted-foreground |
| 161 | `#7aa7ff` | remap | text-info (Jira link; 5.3:1 on bg, text-primary would be 3.6:1) |
| 165 | `#7aa7ff` | remap | text-info (Jira key, same styling as the link form) |
| 166 | `#9a9ca5` | remap | text-muted-foreground |

### `AdeWorkTypeField.vue` (2: 2 remap)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 39 | `#9a9ca5` | remap | text-muted-foreground |
| 58 | `#f28b7d` | remap | text-error (form/mutation error; AdeView.vue importError precedent) |

### `allAgents.ts` (2: 1 remap, 1 comment reworded)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 21 | `#3a3e48` | comment reworded | reword: "the mockup fallback swatch, now --kira-border-strong" |
| 24 | `#3a3e48` | remap | NO_COLOR = 'var(--kira-border-strong)' (absence of a work colour, not a colour) |

### `tones.ts` (21: 18 kept, 2 remap, 1 comment reworded)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 9 | `#e8a33d` | kept | tone: amber solid |
| 9 | `#f0b85c` | kept | tone: amber text |
| 9 | `rgba(232,163,61,0.14)` | kept | tone: amber tint |
| 10 | `#ef6b5b` | kept | tone: red solid |
| 10 | `#f28b7d` | kept | tone: red text |
| 10 | `rgba(239,107,91,0.14)` | kept | tone: red tint |
| 11 | `#6cc58a` | kept | tone: green solid |
| 11 | `#7fd49b` | kept | tone: green text |
| 11 | `rgba(108,197,138,0.14)` | kept | tone: green tint |
| 12 | `#7aa7ff` | kept | tone: blue solid |
| 12 | `#93b6ff` | kept | tone: blue text |
| 12 | `rgba(122,167,255,0.14)` | kept | tone: blue tint |
| 13 | `#a371f7` | kept | tone: purple solid |
| 13 | `#c3a3fb` | kept | tone: purple text |
| 13 | `rgba(163,113,247,0.16)` | kept | tone: purple tint |
| 14 | `#23252b` | kept | tone: grey tint |
| 14 | `#6b6f7a` | kept | tone: grey solid |
| 14 | `#b4b6bd` | kept | tone: grey text |
| 34 | `#d97757` | comment reworded | reword: drop the literal; CLAUDE_BUTTON_STYLE is now the theme primary button |
| 37 | `#d97757` | remap | background: 'var(--primary)' |
| 38 | `#1a0f0a` | remap | color: 'var(--primary-foreground)' |

### `useQueue.ts` (21: 21 kept)

| Line | Literal | Decision | Target |
|---|---|---|---|
| 38 | `#e07a4f` | kept | work palette slot 0 |
| 39 | `#e3a53c` | kept | work palette slot 1 |
| 40 | `#c9c23a` | kept | work palette slot 2 |
| 41 | `#8cc152` | kept | work palette slot 3 |
| 42 | `#4db86c` | kept | work palette slot 4 |
| 43 | `#35b5a0` | kept | work palette slot 5 |
| 44 | `#38a8cc` | kept | work palette slot 6 |
| 45 | `#4a8ee6` | kept | work palette slot 7 |
| 46 | `#6e79ea` | kept | work palette slot 8 |
| 47 | `#9a6ee2` | kept | work palette slot 9 |
| 48 | `#c566d8` | kept | work palette slot 10 |
| 49 | `#e062a8` | kept | work palette slot 11 |
| 50 | `#e35f79` | kept | work palette slot 12 |
| 51 | `#b88458` | kept | work palette slot 13 |
| 52 | `#94a35a` | kept | work palette slot 14 |
| 53 | `#58a08e` | kept | work palette slot 15 |
| 54 | `#7b92b8` | kept | work palette slot 16 |
| 55 | `#a57ec0` | kept | work palette slot 17 |
| 56 | `#d58c8c` | kept | work palette slot 18 |
| 57 | `#a3aab4` | kept | work palette slot 19 |
| 61 | `#4fb8c4` | kept | dependency kind: dependency solid |
