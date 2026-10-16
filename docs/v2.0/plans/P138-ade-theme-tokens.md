# P138 — `ade`'s chrome brought onto `packages/theme` tokens: plan

Plan for `docs/v2.0/SPEC.md`'s **P138** row. Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `3a71141f` (P137 landed: `AdeRepoTabs.vue` is a thin
`TabStrip` wrapper, its three hex literals gone). Every line number below is at that commit.

**Per-literal list:** `docs/v2.0/plans/P138-ade-hex-audit.md` (committed first, own commit). This
plan holds decisions and reasons; the audit holds every site. Implement from both.

**Discovery method, disclosed.** The worktree carries its own `.codegraph/` index, and results
came back with worktree paths at this commit. Two `codegraph_explore` calls ran before any
`Read`/`grep` of the files they covered: (1) tone/palette constants and consumers (`TONE`,
`chipStyle`, `PALETTE`, `DEPENDENCY_COLOR`, `colorSlot`, `workStatus`); (2) `tones.ts`,
`AdePanelHeader.vue`, `AdeStackBlock.vue`, `allAgents.ts`, `AdeAllAgentsView.vue` and their call
graph. `grep` then produced the literal list; `Read`/`sed` pinned context lines, `tokens.css`,
`tailwind-core.css`, `shadcn-bridge.css`, the lint scripts, the design spec §7 and the test
specs. Contrast ratios are computed (WCAG 2.x relative luminance), not estimated.

---

## 0. Open points and resolutions

| Open point | Resolution | Where |
|---|---|---|
| Split into Part 1/Part 2? | **No.** One mechanical pass inside `ade/` plus one lint script. The gate depends on every remap landing first. One sequential implementer. | §2 |
| Real count | **279 literals in 31 files** (255 hex, 24 `rgba()`; 28 `.vue`, 3 `.ts`), not the row's "190 in 23" (pre-P135/P137, hex-only, `.vue`-only). **109 kept, 162 remapped, 3 normalized onto a kept value, 5 comments reworded.** | audit §1 |
| Kept set | **57 values:** 18 `TONE` entries, 2 tone inks, 14 tone alpha tints, 3 dependency-kind values, 20 work palette slots. Nothing else. | §3.1, audit §2 |
| Single source of truth | `TONE` (`tones.ts:8-15`) and `PALETTE`/`DEPENDENCY_COLOR` (`useQueue.ts:37-61`) already exist. TS code (style objects, computed strings) reads them instead of re-typing values; new `TONE_INK` and `activityTextColor` absorb two duplicated literal patterns. Template class strings keep the literal: Tailwind v4 emits only classes spelled literally in source. | §3.2 |
| Hex with no exact token | Every chrome value maps to the **nearest existing** `--kira-*` token by role. **No new token.** Each no-exact-match case listed with its reason. | §3.3 |
| Claude accent `#d97757` | Design §7 lists it outside the tones, as a design colour. P129 Part 1 §2.1 maps design §7 colours to theme tokens. **Remapped to `--primary` (`--kira-accent`).** Most visible diff of the phase; flagged to the user. | §3.4 |
| Kept value in a chrome role | 21 sites (amber as active-tab/selection accent, red text as a form error, blue as a link, grey-tone tint as a neutral chip). **Remapped by role, not value.** The value gate cannot see them; §11 greps them. | §3.5 |
| Light theme | **Disclosed follow-up, not this phase's acceptance bar.** No light theme exists in either host; design §7 is dark-only; kept tone text measures 1.6-2.4:1 on white. Recorded as an `ARCHITECTURE.md` Known open item. Flagged to the user. | §3.7 |
| `rg` gate | New `scripts/check-ade-colours.sh`, chained into root `package.json` `lint` (runs in the pre-commit hook). Lint script, not a unit spec. Allowlist = the 57 kept values exactly; also fails on a stale allowlist entry. | §4 |
| Visual check | No existing visual spec covers `ade`. One-off before/after `toHaveScreenshot` comparison, never committed (CI-Linux baseline policy). No light-theme screenshot: no light theme. | §7 |
| Library rule | No new dependency. Tailwind utilities; the one existing `<style scoped>` block (`AdeNotesEditor.vue:226-284`, Tiptap-generated markup) keeps its stated exception and only swaps its literals to `var()`. No new SFC, no new store. | §3.6 |

## 1. Confirmed current state

- `packages/theme/src/tokens.css` is one `:root`, dark only (VS Code Dark Modern). Both hosts'
  `index.html` hardcode `<html class="dark">`. `shadcn-bridge.css:7-9` states the light `.dark`
  block was dropped on purpose.
- Colour utilities (`tailwind-core.css` `@theme`, `shadcn-bridge.css` `@theme inline`): `bg`,
  `elevated`, `chrome`, `field` (`--kira-bg-input`), `fg`, `subtle`, `disabled`, `border`,
  `border-strong`, `focus`, `select`, `hover`, `badge`, `error`, `warn`, `ok`, `info`, `primary`,
  `primary-foreground`, `muted-foreground`, plus `conn-*`/`syntax-*`/`state-on`.
- `ade/` already on tokens: `AdeView`, `AdeRepoView` (`bg-bg` root), `AdeTimeline`,
  `AdeProjectHeader`, `AdeRepoTabs`, `AdeActivityIcon`, and parts of others (`text-fg`,
  `text-muted-foreground`, `border-border-strong`, `bg-elevated` in `AdeMainLine.vue:39-42`).
- `TONE` (`tones.ts:8-15`) is `[tint, text, solid]` per tone, matching design §7 exactly.
  Consumers: `chipStyle` (`AdePanelHeader`, `AdeLinkRow`), `AdePanelHeader.actionStyle`,
  `AdeStackBlock` (`boxStyle`, `tagStyle`, `actionButtonStyle`). Many other files re-type the same
  values as literals.
- `PALETTE` (`useQueue.ts:37-58`) is the 20-slot work palette, indexed by Go's `colorSlot`
  (`internal/ade/facts.go:315`, `maxColorSlots = 20`). Consumers: `useQueue.ts` (`spansForDay`,
  `buildPanel`, segments), `allAgents.ts`. `DEPENDENCY_COLOR` (`useQueue.ts:61`) is P135's fixed
  dependency kind colour.
- `ade` is mounted only in Kira Space's native window. `apps/kira-space-vscode` does not import
  `frontend/src/ade`, so the webview's light `--kv-*` bridge never reaches it.
- Tests touching colour: `tests/ui/ade-all-agents.spec.ts:507-511,526` (`toHaveCSS` on kept amber
  values), `tests/ui/ade-panel.spec.ts:1005-1007` (`toHaveClass(/f28b7d/)` on the conflict file
  row). Parity unit specs (`ade-queue-parity`, `ade-dialog-parity`) read the *mockup's* own style
  strings, not ours. `tests/visual/` holds only `settings.spec.ts`.

## 2. Split

None. Every edit is a colour/class swap inside `ade/`, plus `tones.ts` helpers every group
consumes, plus a gate that can only pass once all groups land. Order-dependent through `tones.ts`
and the gate. One sequential implementer.

## 3. Design

### 3.1 Classification rule

A literal is **kept** when its colour distinguishes one queue-model state from another: work
status tone, tag tone, activity kind, item kind (review blue, parked grey, dependency cyan),
work colour, calendar state (today, overdue, over capacity), or the ink on a tone solid. A literal
is **chrome** when it colours UI furniture independent of queue data: surfaces, borders, text
hierarchy, selection, focus, drop feedback, active tab, generic buttons, form errors, links.

Kept set, 57 values (audit §2 lists each with its definition site):

- **Tone (18):** `TONE`'s six `[tint, text, solid]` triples. Design §7 lists five; purple is the
  mockup's merged tone, already in `TONE`.
- **Tone ink (2):** `#15161a` on amber/red/green/blue/grey solids, `#ffffff` on purple. Classified
  as tone data: a solid is fixed, so its text must be fixed. A themed ink would lose contrast under
  any other theme (white `--kira-accent-fg` on amber solid is 2.2:1).
- **Tone alpha (14):** a tone solid's RGB at another alpha (tints 3-18%, a 28% halo, 35%/55%
  borders). One site each. One of them, `rgba(239,107,91,0.08)`, is new (normalizes `#2a1917`).
- **Dependency kind (3):** `DEPENDENCY_COLOR` `#4fb8c4`, its text `#9fdde4`, its tint
  `rgba(79,184,196,0.07)`. P135 made dependency a fixed kind colour standing where a palette slot
  stands (panel dot, box rail). Palette-class data.
- **Work palette (20):** `PALETTE`, untouched.

### 3.2 Single source of truth

- **TS/style-object sites read constants.** Where script code re-types a canonical `TONE` value,
  it reads `TONE[tone][i]` instead. Sites: `AdeAgentsTab.vue:66`, `AdeChangesTab.vue:24,25,84`,
  `AdeDayBand.vue:68,75,82,102`, `AdeStackBlock.vue:53,54` (`DEPENDENCY_COLOR`), `:66`, `:84`,
  `:150`, `AdePanelHeader.vue:65`, `AdeStackRow.vue:34`.
- **New `TONE_INK: Record<Tone, string>`** in `tones.ts` (`'#15161a'` for five tones, `'#ffffff'`
  for purple). Replaces `tone === 'purple' ? '#ffffff' : '#15161a'` in `AdePanelHeader.vue:65` and
  `AdeStackBlock.vue:84`, and the archive button's `'#ffffff'` at `AdeStackBlock.vue:150`.
- **New `activityTextColor(kind: ActivityKind): string`** in `tones.ts`: `input` to
  `TONE.amber[1]`, `working` to `TONE.green[1]`, `waiting` to `TONE.blue[1]`, else
  `'var(--kira-fg-muted)'`. Replaces the two identical `stateColor` functions
  (`AdeAgentsPill.vue:19-24`, `AdeAllAgentsRow.vue:21-26`). Type-only import of `ActivityKind`
  from `./activity` (no runtime cycle).
- **Elbow:** `AdeStackRow.vue:34` becomes `TONE[parentKind === 'review' ? 'blue' : 'grey'][2]`.
  Old non-review elbow `#5c606b` becomes the grey tone solid `#6b6f7a`: the elbow colour already
  encodes parent kind (blue under a review), so grey tone is its natural other half.
- **Template classes keep literals** (`text-[#f0b85c]` etc.). Tailwind v4 generates a class only
  when it is spelled literally in a scanned file; routing them through TS constants would force
  `:style` bindings in place of utilities. The gate pins the value set, so a literal cannot drift.
- **Alpha tints stay inline.** Each is used once; a named constant per alpha adds names without
  removing a duplicate.

### 3.3 Chrome map (default per value)

Nearest existing token by role. Luminance deltas are small; hue shifts from the mockup's blue-grey
to Kira's neutral grey. No new `--kira-*` token: every value has a same-role token, and a new
token would change `packages/theme` for both apps without a requirement a current token fails.

| Mockup value(s) | Role | Token / utility | Note |
|---|---|---|---|
| `#9a9ca5` (48) | muted text | `text-muted-foreground` / `var(--kira-fg-muted)` #9d9d9d | near exact |
| `#c9c7c2` (12), `#e8e6e1` (2) | secondary / primary text | `text-fg` / `var(--kira-fg)` #cccccc | `#e8e6e1` dims; Kira has one primary text token |
| `#7c7f88` (8), `#6b6f7a` (2 non-tone), `#4f525b` (2) | tertiary text | `text-subtle` / `var(--kira-fg-subtle)` #8a8a8a | brighter; `--kira-fg-subtle` is the non-interactive text token that must hold 4.5:1 (`tokens.css:8-11`), so weekend/day-off labels use it, not `--kira-fg-disabled` |
| `#4a4d56` (2) | stopped-session square (graphic) | `bg-disabled` #6e6e6e | graphic, not text: `--kira-fg-disabled`'s under-4.5 contrast is allowed for non-text |
| `#3a3e48` (10 incl. resize grip fill), `#34373f` (3), `#2f323b` (borders, 3) | strong border | `border-border-strong` / `var(--kira-border-strong)` #313131 | dimmer; dashed borders lose some contrast (§3.8) |
| `#2a2d35` (6), `#22252c` (7), `#202227` (1) | border / divider | `border-border` / `var(--kira-border)` #2b2b2b | near exact |
| `#2f323b` (on-state bg, 3), `#2a2c33` (2), `#23252b` (2 non-tone), `#1b1d22` (input, 1) | control fill | `bg-field` #313131 | Toggle primitive's own `data-[state=on]:bg-field` precedent (`components/ui/toggle/index.ts:7`) |
| `#26272d` (1) | selected row bg | `var(--kira-hover)` #2a2d2e | near exact |
| `#1b1d22` (3), `#1a1c21` (1) | raised surface (box, bar, segmented group) | `bg-elevated` / `var(--kira-bg-elevated)` #202020 | |
| `#16171b` (3), `#121316` (1 stopped list), `#101114` (1), `#0f1013` (1), `#17181c` (1 stripe) | panel / bar | `bg-chrome` / `var(--kira-bg-chrome)` #181818 | Kira's panel token (`tokens.css:5`) |
| `#0b0c0e` (2), `#121316` (notes editor, tick), `#1c1d22` (1 stripe) | editor/terminal surface | `bg-bg` / `var(--kira-bg)` #1f1f1f | xterm and Monaco paint `--kira-bg` (`terminalRenderer.ts:64`); Agents tab now matches its terminal |
| `rgba(255,255,255,0.018)`, `0.012` | faint surface wash | `color-mix(in srgb, var(--kira-fg) 2%, transparent)`, `1.5%` | tracks the theme foreground instead of fixed white |
| `#3a3e48` in `allAgents.ts:24` `NO_COLOR` | "no work colour" rail | `'var(--kira-border-strong)'` | absence of colour, not data |
| `'IBM Plex Mono', monospace` (`AdeNotesEditor.vue:270`) | design §7 font | `var(--kira-font-data)` | design §7 IBM Plex maps to theme fonts |

### 3.4 Claude accent

`#d97757`, `#1a0f0a`, `#e8a07f`, `rgba(217,119,87,0.18)`: design §7's "Claude accent", not a
tone. Remapped to Kira's accent:

- `CLAUDE_BUTTON_STYLE` (`tones.ts:36-40`): `background: 'var(--primary)'`,
  `color: 'var(--primary-foreground)'`. White on `#0078d4` is 4.53:1. Consumers unchanged
  (`AdePanelHeader`, `AdeAllAgentsRow`); `AdeStackBlock.vue:151`'s inline copy switches to it.
- Robot icons (`AdeAgentsPill.vue:38`, `AdeClaudeDialog.vue:113`): `text-primary`.
- Active session tab rail (`AdeAgentsTab.vue:108`): `shadow-[inset_0_2px_0_var(--primary)]`
  (`DocumentRow.vue:46` precedent).
- Agents count pill (`AdeDetailPanel.vue:36-41`): style object becomes a class computed: running
  `bg-primary/20 text-fg`, idle `bg-field text-muted-foreground`.

Keeping the orange would mean a 58th kept value outside the P129 rule. The user can overturn this
in one place (`tones.ts` plus four class sites) if they want Claude's own colour back.

### 3.5 Kept value, chrome role (per-site overrides)

| Sites | Was | Becomes | Reason |
|---|---|---|---|
| `AdeDetailPanel.vue:70,77,84` | `data-[state=active]:border-b-[#e8a33d]` | `data-[state=active]:border-b-primary` | active tab indicator |
| `AdeStackRow.vue:44` | bg `#26272d`, rail `#e8a33d` | `var(--kira-hover)`, `var(--primary)` | selection (`DocumentRow.vue:46` rail precedent) |
| `AdeDayBand.vue:58,110` | amber 10% wash, amber dashed outline | `color-mix(in srgb, var(--kira-focus) 10%, transparent)`, `outline-focus` | drop feedback (`DockResizeHandle.vue:65` drag uses `bg-focus`) |
| `AdeHistoryBar.vue:39` | `bg-[#e8a33d] text-[#15161a]` | `bg-primary text-primary-foreground` | "Current work" is a plain primary button, no data state |
| `AdeChangesTab.vue:97` | commit sha `text-[#e8a33d]` | `text-muted-foreground` | identifier, not state (`git-ui` sha precedent) |
| `AdeAgentsTab.vue:169`, `AdeCandidatePicker.vue:38`, `AdeDetailsTab.vue:235`, `AdeEstimateField.vue:128`, `AdeLinkRow.vue:144`, `AdeWorkTypeField.vue:58` | `text-[#f28b7d]` | `text-error` | form/mutation error; `AdeView.vue:61` already uses `text-error` |
| `AdeStackRow.vue:161,165`, `AdeNotesEditor.vue:274` | `#7aa7ff` | `text-info` / `var(--kira-info)` | link. `text-primary` (the app's link colour elsewhere) is 3.64:1 on `--kira-bg`, under 4.5; `--kira-info` is 5.37:1 |
| `AdeAddPopover.vue:226`, `AdeDetailPanel.vue:40` | `#23252b` | `bg-field` | neutral chip, not the grey tone |
| `AdeDayBand.vue:76`, `AdeNotesEditor.vue:279` | `#6b6f7a` | `var(--kira-fg-subtle)` | text hierarchy, not the grey tone |

Normalized onto kept values (off-canon mockup variants):

- `AdePanelHeader.vue:143` `text-[#b9cfff]` to `text-[#93b6ff]` (blue tone text).
- `AdeChangesTab.vue:108` `bg-[#2a1917]` to `bg-[rgba(239,107,91,0.08)]` (red tone alpha). Keeps
  `text-[#f28b7d]`, so `ade-panel.spec.ts:1005`'s `/f28b7d/` class assertion still holds.
- `AdeStackRow.vue:34` `#5c606b` to `TONE.grey[2]` (§3.2).

Kept on purpose (data state, not chrome), in case a reviewer asks: today marker and tick
(`AdeDayBand.vue:68,102`), overdue/over-capacity text and buttons, ripple box border
(`AdeStackBlock.vue:66`), "Rebase all" (`AdeMainLine.vue:53`, shown only while behind), segment
action buttons (tone of their tag), review banner and lock (blue = review kind), other-author name
in `AdeAddPopover.vue:226` (blue = someone else's work), dirty/added file codes, conflict text.

### 3.6 `AdeNotesEditor.vue` `<style scoped>` block

Kept as a block. Its own comment (`:227-230`) names the requirement: ProseMirror emits the markup,
so no utility class can attach. Only its four literals (`:263,268,274,279`) and the IBM Plex font
(`:270`) change to `var(--kira-fg-subtle)`, `var(--kira-bg-input)`, `var(--kira-info)`,
`var(--kira-fg-subtle)`, `var(--kira-font-data)`. Converting it to arbitrary descendant variants
is a separate refactor, not a colour change.

### 3.7 Light theme: disclosed follow-up

Not this phase's acceptance bar. Reasons:

1. Nothing to render against. Kira Space has no light theme: one dark `:root`, `<html
   class="dark">`, no theme setting. `ade` is absent from the VS Code webview, the only host with a
   light variant.
2. Design §7 is dark-only ("Dark: bg `#121316` …"). The mockup has no light palette.
3. Kept tone text fails on light surfaces: on `#ffffff`, amber text 1.79:1, green 1.78, blue
   2.02, purple 2.11, grey 2.03, red 2.40. Work palette slots measure 1.86-3.76:1 on white. A
   light theme needs light tone variants, which changes kept values: the thing P129 Part 1 §2.1
   and this row say not to relitigate here.
4. A light theme is a `packages/theme` change for both apps, not an `ade` styling pass.

What P138 delivers toward it: every `ade` chrome colour resolves through `--kira-*`, so a future
light `:root` flips `ade` chrome with zero `ade` edits; the kept set is enumerated in one gate.
Record it in `docs/ARCHITECTURE.md` Known open items (§6). Flag to the user; add no SPEC row (the
user decides whether a light theme is wanted at all).

### 3.8 Contrast (dark theme)

- **Tone text on new surfaces:** all pass AA with margin. Text on its own tint composited over
  the new surfaces: amber 7.0-7.7:1, red 5.6-6.1, green 7.0-7.7, blue 6.3-6.9, purple 6.2-6.8,
  grey 7.6 (range covers `bg`, `elevated`, `chrome`). Each drops ≤0.4 versus the mockup surfaces.
- **Remapped text:** `text-muted-foreground` 6.0-6.6:1, `text-subtle` 4.7-5.1:1, `text-error`
  4.56-4.97:1, `text-info` 5.3-5.8:1 on `bg`/`elevated`/`chrome`. Day labels on the timeline's
  `bg-bg`: weekend/day-off 2.11:1 to 4.77:1, empty/past 3.28:1 to 4.77:1.
- **`--primary` as non-text:** robot icons, rails, underline: 3.6-3.9:1, above the 3:1 non-text
  bar. Never used as text.
- **Pre-existing, kept, disclosed:** white on purple solid 3.35:1 and ink on grey solid 3.60:1,
  both under 4.5 for 11-12px button labels. Both are kept tone values; fixing them changes a tone.
  Report in the result as a user decision, not a P138 change.
- **Dashed borders:** `#3a3e48` to `#313131` lowers border contrast from ~1.6:1 to ~1.25:1
  (parked box, continuation row, day controls, history pull). Borders are decorative; the parked box keeps its
  stripe and tone rail. Check in §7's screenshots.

## 4. Gate: `scripts/check-ade-colours.sh`

Repo pattern: one `sh` guard per concern, chained in root `package.json` `lint`
(`check-tokens.sh`, `check-theme-classes.sh`). No stylelint, no new dependency. Lint, not a unit
spec: it inspects source text, runs in the pre-commit hook, and needs no test runner. CLAUDE.md's
unit-test bar does not apply.

Wiring: `"lint": "biome check . && sh scripts/check-tokens.sh && sh scripts/check-theme-classes.sh
&& sh scripts/check-ade-colours.sh && bun scripts/check-class-conflicts.ts"`.

Behaviour:

- Scans every `*.vue` and `*.ts` under `apps/kira-space/frontend/src/ade/` (recursive, `state/`
  included) for `#[0-9a-f]{3,8}\b` and `(rgba?|hsla?|oklch|hwb|lab|lch)\([^)]*\)`,
  case-insensitive. Comments and `<style>` blocks included on purpose: a comment quoting a chrome
  hex fails too (reword it).
- Normalizes each hit (lowercase, spaces removed) and fails, printing `file:line:literal`, on any
  value not in the allowlist.
- Fails on a stale allowlist entry (an allowed value with zero hits), so the list stays exactly
  the kept set.
- Allowlist: the 57 values of audit §2, in a sorted heredoc inside the script, grouped by comment
  (tone, tone ink, tone alpha, dependency kind, work palette). Header comment cites P129 Part 1
  §2.1 and this plan.

Skeleton (prototype measured 1.3 s on this tree; it reports 148 non-allowed hits before P138 and
one stale entry, the new red 8% tint):

```sh
#!/bin/sh
set -e
cd "$(dirname "$0")/.."
ADE=apps/kira-space/frontend/src/ade
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sort >"$TMP/allow" <<'EOF'
... 57 values ...
EOF
grep -rnoiE --include='*.vue' --include='*.ts' -- \
  '#[0-9a-f]{3,8}\b|(rgba?|hsla?|oklch|hwb|lab|lch)\([^)]*\)' "$ADE" >"$TMP/hits" || true
# per hit: strip "file:line:", lowercase, drop spaces; not in allow -> report
# used values (sort -u) vs allow via comm -13 -> stale entries
```

The value gate cannot catch a kept value reused in a chrome role (the 21 §3.5 sites). §11's
role greps cover those at close; review covers them afterwards.

## 5. File ownership (one implementer)

| Group | Files |
|---|---|
| Constants | `ade/tones.ts`, `ade/allAgents.ts` |
| Timeline | `AdeDayBand.vue`, `AdeDayControls.vue`, `AdeStackBlock.vue`, `AdeStackRow.vue`, `AdeContinuationRow.vue`, `AdeHistoryBar.vue`, `AdeHistoryPull.vue`, `AdeActivityGlyph.vue`, `AdeAgentsPill.vue`, `AdeMyWorkToggle.vue`, `AdeAddPopover.vue` |
| Detail panel | `AdeDetailPanel.vue`, `AdePanelHeader.vue`, `AdePanelResizeHandle.vue`, `AdeDetailsTab.vue`, `AdeChangesTab.vue`, `AdeAgentsTab.vue`, `AdeNotesEditor.vue`, `AdeEstimateField.vue`, `AdeLinkRow.vue`, `AdeWorkTypeField.vue`, `AdeDependencyDetails.vue`, `AdeBlockerRow.vue`, `AdeCandidatePicker.vue` |
| All agents, dialog | `AdeAllAgentsView.vue`, `AdeAllAgentsRow.vue`, `AdeClaudeDialog.vue` |
| Gate | `scripts/check-ade-colours.sh` (new), root `package.json` (`lint` only) |
| Docs | `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md` (result section only) |

Not touched: `useQueue.ts`, `AdeMainLine.vue` (kept literals only), `packages/theme/**`, Go code,
tests (no locator or assertion changes needed, §7).

## 6. `docs/ARCHITECTURE.md`

- After the `ade` module paragraph (anchor: "`ade/useQueue.ts` is a pure port of the design
  mockup"), add one paragraph: `ade` chrome colours are `--kira-*` tokens; the literal kept set
  (tones with ink and alpha tints, dependency kind colour, 20-slot work palette) lives in
  `tones.ts`/`useQueue.ts` plus one-site alpha tints; `scripts/check-ade-colours.sh` (in `bun run
  lint`) fails on any other literal and on a stale allowlist entry; design §7's Claude accent is
  the theme's `--primary`.
- Known open items: "**No light theme; `ade`'s kept tone and work-palette values are dark-only
  (P138).**" State the 1.6-2.4:1 tone-text measurement on white and that a light theme needs
  light tone variants plus a light `:root`.

## 7. Tests and visual verification

**Existing specs, expected unchanged:**

- `tests/ui/ade-all-agents.spec.ts:507-511,526`: kept amber values, still rendered.
- `tests/ui/ade-panel.spec.ts:1005-1007`: `/f28b7d/` class on the conflict row, kept (§3.5).
- `tests/ui/ade-module.spec.ts`, `ade-timeline.spec.ts`, `ade-dialogs.spec.ts`: no colour
  assertions; test ids unchanged.
- `tests/unit/ade-*-parity.spec.ts`: read the mockup's own style strings; unaffected.
- `tests/visual/settings.spec.ts`: no token value changes, so no pixel change.

**No new unit test** (CLAUDE.md bar: a colour swap is not complex logic). **No committed `ade`
visual spec:** `tests/visual/*` baselines are CI-Linux-only (`docs/DEV_ENVIRONMENT.md`,
"`tests/visual/*` pixel diffs"); a sandbox baseline would be non-canonical.

**One-off before/after comparison** (real question: "dark looks near-identical except the listed
diffs", which no assertion can check):

1. Before any source edit, write `apps/kira-space/tests/visual/ade-p138-compare.spec.ts`
   (untracked; lint- and typecheck-clean, since the pre-commit hook scans the whole tree). Build
   `ade` fixtures by copying the minimal builders from `tests/ui/ade-timeline.spec.ts`/
   `ade-panel.spec.ts`. Six `toHaveScreenshot` states: (a) repo timeline with mine, review,
   parked, dependency, merged-history, continuation, overdue, today and weekend bands, main line,
   one row selected; (b) detail panel Details tab (notes with a link and inline code, estimate,
   link rows, an error shown if a fixture allows); (c) Changes tab with a conflict file and dirty
   files; (d) Agents tab, one running and one stopped session; (e) All agents view with an input
   row; (f) history bar visible.
2. `bun run build:test:space && node node_modules/.bin/playwright test
   --config=apps/kira-space/playwright.config.ts --project=visual ade-p138-compare
   --update-snapshots` (the file filter keeps `settings` baselines untouched).
3. After the last source commit: the same without `--update-snapshots`. Open each
   `*-diff.png`/`*-actual.png` under `apps/kira-space/test-results/`. Every changed region must be
   on the expected list below; anything else is a bug, fixed as its own commit.
4. Delete the spec and its `-snapshots/` directory. `git status --porcelain` must be empty.

**Expected dark diffs:** neutral greys replace blue-greys (panel `#16171b` to `#181818`, box
`#1a1c21` to `#202020`, borders); Agents tab and notes editor lighter (`#0b0c0e`/`#121316` to
`#1f1f1f`); primary text `#e8e6e1` dims to `#cccccc`; tertiary and weekend/past day labels
brighter; Claude orange becomes Kira blue (Start buttons, robot icons, session tab rail, count
pill); selection rail and detail-tab underline amber to blue; "Current work" button amber to blue;
drop highlight amber to focus blue; form errors `#f28b7d` to `#f14c4c`; Jira key and notes links
`#7aa7ff` to `#3794ff`; commit sha amber to grey; review banner text slightly more saturated;
non-review elbow slightly brighter; conflict file row tint slightly redder. **Unchanged:** every
tone chip/tag/button, work colours, activity glyphs for input/working/waiting, today marker,
overdue/over-capacity states, dependency box.

No light-theme screenshot (§3.7).

## 8. Verification commands

Per commit (pre-commit hook): `bun run lint` (biome, `check-tokens`, `check-theme-classes`,
`check-ade-colours` once added, `check-class-conflicts`), `bun run typecheck`.

Once, near the end: `bun run lint:all` (adds `lint:go`, `lint:dead`/knip: `TONE_INK` and
`activityTextColor` need real importers), `bun run typecheck`, `bun run build:space`,
`bun run test:unit`, `bun run test:ui:space`, `bun run test:visual:space` (settings baselines;
read a uniform glyph-fringe diff per `docs/DEV_ENVIRONMENT.md` as sandbox font drift), and §7's
comparison.

## 9. Steps and commits

Each commit passes the hook without `--no-verify` and ends with the session's attribution lines.
A group's commit converts every audit §5 row of its files; a crash resumes at the first group
whose commit is missing (`git log`), and the gate prototype in §4 lists what remains.

0. §7 step 1-2: write the compare spec, capture "before" baselines. No commit.
1. `refactor(space): ade tone ink, activity colour and Claude button read theme and tone constants`
   — `tones.ts` (`TONE_INK`, `activityTextColor`, `CLAUDE_BUTTON_STYLE` on `--primary`, comment
   `:33-35` reworded), `allAgents.ts` (`NO_COLOR`, comment `:21`).
2. `refactor(space): ade timeline chrome on theme tokens` — Timeline group (§5).
3. `refactor(space): ade detail panel chrome on theme tokens` — Detail panel group.
4. `refactor(space): ade All agents view and dialog chrome on theme tokens` — last group.
5. `chore(lint): gate ade colour literals to the kept tone and palette set` — script plus
   `package.json`. Must pass on the tree as committed; if it reports a hit, the fix lands in the
   group commit's file as its own `fix(space): …` commit first.
6. Follow-up `fix(…)` commits for whatever §8's full run and §7's comparison find.
7. `docs: ARCHITECTURE records ade theme tokens, colour gate and light-theme gap (P138)` — §6.
8. `docs(v2.0): P138 result` — result section after the SPEC row block: counts, §11 audit output,
   §7 comparison outcome, the §3.8 pre-existing contrast note, and the open points (§12).

## 10. What a Linux sandbox cannot verify

- **Shipped webviews.** Playwright drives its own WebKit build; the app ships WebKitGTK (Linux)
  and WKWebView (macOS). `color-mix()` and Tailwind's `/20` opacity modifier already ship in this
  app (`--kira-search-match`, `hover:bg-[#e8a33d]/80`), so support is established, but colour
  rendering on a real macOS display is unverified. State it.
- **CI-canonical pixels.** The §7 comparison uses sandbox fonts on both sides, so it is valid as a
  relative diff only.
- **Live `ade` on real repos:** optional, via `docs/DEV_ENVIRONMENT.md`'s P129 Part 5 bypass.
  Report whether it ran.

## 11. Closing audit

Report each row with its command and result in the result section.

| Check | Command | Expect |
|---|---|---|
| Gate passes | `sh scripts/check-ade-colours.sh` | exit 0 |
| Gate is wired | `grep -c 'check-ade-colours' package.json` | 1 |
| Kept-set size | count allowlist lines in the script | 57 |
| Residual literal count | `grep -rnoiE '#[0-9a-f]{3,8}\b\|rgba?\([^)]*\)' apps/kira-space/frontend/src/ade \| wc -l` | 92: 109 kept-value sites, minus 25 TS sites moved onto constants (§3.2), plus 6 `TONE_INK` entries, plus 2 normalized sites |
| Amber not used as chrome accent | `grep -rnE 'border-b-\[#e8a33d\]\|outline-\[#e8a33d\]\|text-\[#e8a33d\]' apps/kira-space/frontend/src/ade` | empty |
| Red text only in state roles | `grep -rn '#f28b7d' apps/kira-space/frontend/src/ade` | 6: `AdeChangesTab.vue` 64, 108; `AdeDayBand.vue` 170, 175; `AdeDependencyDetails.vue` 126; `tones.ts` 10 |
| Links on `info` | `grep -rn 'text-\[#7aa7ff\]' apps/kira-space/frontend/src/ade` | only `AdeAddPopover.vue` author name |
| Claude orange gone | `grep -rniE 'd97757\|1a0f0a\|e8a07f\|217,119,87' apps/kira-space/frontend/src/ade` | empty |
| `TONE_INK`/`activityTextColor` used | `grep -rn 'TONE_INK\|activityTextColor' apps/kira-space/frontend/src/ade` | definitions plus `AdePanelHeader`, `AdeStackBlock`, `AdeAgentsPill`, `AdeAllAgentsRow` |
| No duplicate `stateColor` | `grep -rn 'function stateColor' apps/kira-space/frontend/src/ade` | empty |
| IBM Plex gone | `grep -rni 'plex' apps/kira-space/frontend/src/ade` | empty |
| No new `<style>` | `grep -rln '<style' apps/kira-space/frontend/src/ade` | `AdeNotesEditor.vue` only |
| Theme untouched | `git diff --stat 3a71141f -- packages/theme` | empty |
| No new dependency | `git diff --stat 3a71141f -- package.json bun.lock '**/package.json'` | `package.json` `lint` line only |
| Compare spec gone | `git status --porcelain` and `ls apps/kira-space/tests/visual` | clean; `settings.spec.ts*` only |
| Suites | §8 | all green |

"Kept" in the audit means the value stays, whether spelled as a literal or read from a constant.
The 25 TS sites of §3.2 keep their value but lose their literal. If the residual count differs
from 92, list the difference site by site before closing: a site was missed or over-converted.

## 12. Risks

- **Specificity against primitive defaults.** Removing `data-[state=on]:bg-[#2a2c33]` in
  `AdeAllAgentsView.vue:185,191` relies on `ToggleGroupItem`'s own `data-[state=on]:bg-field`; if
  `cn()` merge drops it, set `data-[state=on]:bg-field` explicitly.
- **`check-class-conflicts.ts`** may flag a new pair (e.g. `border-b-2 border-transparent` with
  `data-[state=active]:border-b-primary`). Resolve per its message; never suppress.
- **`check-theme-classes.sh`** retired names: targets here use `bg-field`, never `bg-input`, and
  `text-muted-foreground`, never `text-muted`.
- **Temp spec blocks commits** if not lint/typecheck clean (hook scans the whole tree). Keep it
  clean or move it out before committing.
- **Gate false positive:** a future `#123`-style issue reference in an `ade` comment fails the
  gate. Reword it; do not widen the regex.
- **Claude accent and light theme are user-visible decisions.** Both reversible in one place.
- **Open points for the user** (reported, not acted on): (a) keep Kira blue for the Claude accent,
  or restore Claude orange as a 58th kept value; (b) whether to plan a light theme (app-wide, with
  light tone variants); (c) the two pre-existing sub-4.5 tone button labels (purple, grey).

## 13. Acceptance

| Requirement | Where met |
|---|---|
| Audit pass over every `ade` literal, sorted kept vs remapped, committed before any file changes | audit file, first commit |
| Kept set = tone tints and 20-colour work palette, per P129 Part 1 §2.1, not relitigated | §3.1 (57 values; ink, alpha and dependency classified as tone/palette data, reasons given) |
| Everything else on its matching `--kira-*` token or utility | §3.3-3.6, §11 |
| Light and dark: plan states which is the bar | §3.7: dark is the bar; light is a disclosed follow-up and Known open item |
| `rg` gate, allowlist exactly the kept set | §4, §11 |
| Tailwind utilities, no new scoped `<style>`, no new dependency | §3.2, §3.6, §11 |
