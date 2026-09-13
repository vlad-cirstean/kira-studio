# G34 — Kira Studio visual parity for `packages/git-ui`: one scale, one button, one row, one menu

> **What this phase is.** `docs/v1.3/SPEC.md`'s G34 row, requested verbatim on 2026-09-09:
> *"Components should look like in Kira Studio, The main toolbar, the right click, as it now has
> different proportions and design and everything is off."* Deferred here by the graph/review
> UX-fixes batch (`docs/v1.3/plans/graph-review-ux-fixes.md` §7), which handed forward exactly one
> note: `.kv-toolbar` and `.kv-skin-kira` are two coexisting density scales by deliberate design
> (G12 D14 / G21 D11), and unifying them piecemeal would make this phase harder. This plan is that
> unification, plus the visual-language work that only becomes possible once there is one scale.
>
> **The surprising baseline, and why this is a CSS phase and not a component-migration phase.**
> G19 D3, G20 D2/D3/D5, G21 D2 and G-UX D9 already migrated essentially every control in
> `packages/git-ui` onto `packages/kira-ui`: there is exactly **one** raw `<button>` left in the
> whole package (`BranchPicker.vue:325`), every dialog is a `KuiDialog`, every context menu is
> already a `KuiContextMenu` (`RowContextMenu.vue` is a 38-line pass-through wrapper), and
> `@kira/kira-ui/theme/controls.css` is already imported and bundled by `main.ts:19`. So "replace
> bespoke widgets with `Kui*`" is **mostly already done** — and the app still looks wrong, because
> the two things that were never done are the two things the user is actually complaining about:
> (a) `--kui-*` is bridged onto the **workbench** scale (`--kui-control-h: 22px` literal,
> `--kui-radius: var(--kv-radius)` = **0**, `--kui-space-2` for a button's padding) rather than
> Kira's, so `.kui-button` renders as a bordered, square-cornered, full-brightness VS Code
> workbench button where Kira's `.p-btn` is borderless, 4px-rounded and muted-until-hover; and (b)
> **seven** different "row inside a floating panel" implementations and **five** different
> "icon button" implementations survived the migration as local classes that *override* the shared
> component, because a local class beats a library class on specificity and nobody ever compared
> the two side by side.
>
> **The reconciliation is a rename with zero rendered change** (F4/D2). `density.css`'s
> `--kv-space-1..5` are `2/4/8/12/16px`; `kira-structure.css`'s `--kv-s-1..6` are `2/4/6/8/12/16px`.
> The workbench scale is the Kira scale **with the 6px step removed** — every existing value maps
> one-to-one onto a Kira step of identical value. So "one scale" is a mechanical, value-identical
> rename of 226 call sites, after which the 6px step Kira's toolbar and menu rules actually need
> becomes reachable for the first time.
>
> **No `CONTRACT_VERSION` bump. No Go change. No wire change.** This phase touches CSS, Vue
> templates, one new `packages/kira-ui` component, and one new lint guard.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/step-g34-opus-planning-tg91e3` at `d33dbb6` (G1–G29 + G33 + the G-UX batch
complete, working tree clean). Every line number below is from that commit.

| Claim | Evidence |
|---|---|
| `packages/kira-ui`'s CSS is already bundled into the webview at build time — no runtime fetch, no CSP question left to answer | `git-ui/src/main.ts:19` (`import '@kira/kira-ui/theme/controls.css'`), `kira-ui/package.json`'s `"./theme/controls.css"` export, `git-ui/vite.config.ts` (one Vite build, `manifest: true`), `webviewDocument.ts:34-41` (`collectCss` walks `imports` transitively), `:62` (`<link rel="stylesheet">`), `:66-68` (`style-src ${cspSource} 'unsafe-inline'`) |
| `kira-ui` components reference **only** `--kui-*`, never `--kv-*`/`--kira-*`; each host bridges | `kira-ui/src/theme/controls.css:1-19` (file header), `git-ui/src/theme/kui-bridge.css`, `apps/kira-studio/frontend/src/theme/kui-bridge.css` |
| The git-ui bridge points `--kui-*` at the **workbench** scale: `--kui-radius: var(--kv-radius)` (= `0px`), `--kui-control-h: 22px` (a literal, not a token) | `kui-bridge.css:18-19`; `density.css:17` |
| Kira Studio's real toolbar is `.p-toolbar`: `height: --kira-toolbar-h` (34px), `gap: --kira-s-3` (6px), `padding: 0 --kira-s-4` (8px); its separator is `1px × --kira-control-inline-h` (14px) with `margin: 0 --kira-s-1` | `apps/kira-studio/frontend/src/theme/primitives.css:744-771` |
| Kira Studio's real text button is `.p-btn`: 22px, `gap: s-2`, `padding: 0 s-3` (6px), `radius-sm` (4px), `color: --kira-fg-muted`, `font-size: --kira-t-sm`, **no border**; hover adds `--kira-hover` **and** brightens to `--kira-fg`; `.is-active` is `--kira-bg-input` (a quiet grey), not the selection blue | `primitives.css:70-99` |
| Kira Studio's real icon button is `.p-iconbtn`: a **square** `--kira-control-h` x `--kira-control-h`, `radius-sm`, `--kira-fg-muted` | `primitives.css:35-58` |
| Kira Studio's floating surface is `.p-float`: `--kira-bg-elevated`, 1px `--kira-border-strong`, `--kira-radius` (**6px**, the panel tier), `--kira-shadow-dialog` (`0 8px 28px rgb(0 0 0 / 0.45)`) | `primitives.css:640-646`, `tokens.css:96-97` |
| Kira Studio's menu row is `.p-row`: `height: --kira-control-h` (22px), `gap: s-2`, `padding: 0 s-3` (6px), `radius-sm`; the menu itself is `padding: --kira-s-2`, `gap: 1px`, `min-width: 180px` | `primitives.css:505-522`; `workbench/ContextMenu.vue`'s `.context-menu` |
| Kira Studio boxes **every** menu row's icon slot, present or not, so labels align | `workbench/ContextMenu.vue:256-263` (the `<span class="icon-box">` is unconditional; the icon inside it is the `v-if`) |
| Kira Studio's codicon glyphs are **13px** inside a **16px** box | `primitives/IconButton.vue` (`size: 13` default), `AppButton.vue` (`:size="13"`), `ContextMenu.vue` (`:size="13"`), `tokens.css`'s `--kira-icon-box: 16px` |
| `.kui-icon-box .codicon` is **16px** inside a 16px box — the glyph exactly fills its box | `controls.css:30-32`, `:49-52` |
| The two spacing scales are the same values, differently indexed | `density.css:10-14` (`2/4/8/12/16`) vs `kira-structure.css:15-20` (`2/4/6/8/12/16`) |
| `.kv-skin-kira` is applied on exactly two roots | `ReviewView.vue:631`, `FileTree.vue:409` |
| The graph panel already references five Kira-scale tokens it cannot resolve — a live rendering defect | `App.vue:1693-1703` (`.kv-boot-error-banner` uses `--kv-s-2`, `--kv-s-3`, `--kv-border-width`, `--kv-font-ui`, `--kv-radius-sm` outside any `.kv-skin-kira` ancestor; `.kv-app` is `:1321`) |
| There is no `--kv-*` equivalent of `scripts/check-tokens.sh` — that guard is scoped to `--kira-*` under `apps/kira-studio/frontend/src` only | `scripts/check-tokens.sh:11-21` |
| Exactly one raw `<button>` survives in `packages/git-ui` | `BranchPicker.vue:321-337` (`ref="triggerEl"`, kept raw by G21 D2 because `KuiButton` exposes no root ref) |
| `rowMenuModel.test.ts` asserts item **ids** only, never whole objects | `rowMenuModel.test.ts:69`, `:76`, `:83`, `:124`, `:140` |
| The webview Playwright tiers assert **relative** geometry and `.kv-*` hooks this phase keeps | `webview-layout.spec.ts:69-115`; `kui-floating-geometry.spec.ts:75-155`; `graph-columns.spec.ts`, `commit-meta-clamp.spec.ts`, `file-tree-open.spec.ts`, `review-interaction.spec.ts` |
| The 300 ms first-paint budget is bounded by the history walk plus parsing (218-235 ms measured), not by bytes | `docs/PERF.md` §2.13 |

**No probes needed.** Every question this phase's charter poses is answered by a plain read of the
files above — including the CSP one, which is answered by an `import` statement that already ships
(F2). The one number worth capturing is a before/after CSS byte count, and that belongs in the
implementation commit message (§7.1 item 9), not in a design-time measurement.

### 0.2 Scope

1. **`packages/git-ui/src/theme/kira-structure.css`** — hoisted from `.kv-skin-kira` to `:root`;
   gains three tokens Kira has and this transcription missed.
2. **`packages/git-ui/src/theme/density.css`** — pared to the four tokens that are genuinely a
   *row-density* concern; `--kv-space-*`, `--kv-toolbar-height` and `--kv-radius` are deleted.
3. **`packages/git-ui/src/theme/vscode-tokens.css`** — three new theme-following colour tokens.
4. **`packages/git-ui/src/theme/kui-bridge.css`** — rewritten against the Kira scale.
5. **`packages/kira-ui/src/theme/controls.css`** — every rule re-specified against Kira's own
   primitives; new `.kui-row` and `.kui-button--icon`.
6. **`packages/kira-ui/src/KuiButton.vue`** — an `icon` variant, `ghost` retired, `focus()` exposed.
7. **`packages/kira-ui/src/KuiMenuList.vue`** (new) — the menu's rows plus roving focus, extracted
   from `KuiContextMenu.vue` so a trigger-anchored menu and a point-anchored one render identically.
8. **`packages/kira-ui/src/contextMenuModel.ts`** — `MenuItem` gains `detail`.
9. **`packages/git-ui`** — the 226-site scale rename, plus the duplicated-control deletions and the
   toolbar/menu/popover restyle, file by file (§4).
10. **`apps/kira-studio/frontend/src/theme/kui-bridge.css`** — the other half of the `--kui-*`
    contract, brought up to date (it has been missing `--kui-z-modal`/`--kui-overlay-bg`/
    `--kui-button-*` since G21).
11. **`scripts/check-tokens.sh`** — a second and third pass, over `--kv-*` in `packages/git-ui/src`
    and `--kui-*`, so F5's class of defect cannot recur.

### 0.3 Not in this phase

Colour: no `--kv-*` colour value changes meaning, and nothing adopts Kira Studio's own fixed Dark
Modern literals — the panel follows the user's VS Code theme, which is G12 D14's own guarantee and
is not up for revision. The commit grid's SlickGrid chrome (`CommitGrid.vue`, `columns.ts`,
`graph/*`). Ref badges (`refBadges.ts`, `.kv-badge-*`). The diff surfaces. Dialog *content* layout
(`KuiDialog`'s shell is already shared; the eleven dialogs' inner forms get only the scale rename).
Submenus. `docs/v1.3/SPEC.md`. Any wire, contract or Go change.

### 0.4 Ground rules

`CLAUDE.md` in full. Where a `Kui*` component exists and fits, the local override is **deleted**,
not adjusted around — a local class that re-declares `height`/`padding`/`border` on a `KuiButton` is
the exact defect this phase exists to close, and leaving one behind would hand the next phase the
same problem in a smaller form. Where something stays bespoke, §2's decision names the concrete
reason (a DOM contract, an ARIA pattern with no primitive, a third-party host), never "it already
works". No new colour is invented outside `vscode-tokens.css`, which is the one file permitted a
literal (its own header, and B4).

---

## 1. Findings

### F1 — Component migration is already done; the visual defect is entirely in the token bridge and in local overrides

One raw `<button>` remains in the whole package (`BranchPicker.vue:325`). Every dialog is a
`KuiDialog`; every context menu is already a `KuiContextMenu` behind `RowContextMenu.vue`'s
pass-through; every filter input is a `KuiSearchInput`; every toggle group is a `KuiSegmented`.
The SPEC row's own prose ("currently use bespoke layout, density and styling instead of ... `Kui*`")
was written against the pre-G19/G21 tree and is now accurate only about **styling**, not about
components. This phase therefore delivers visual parity, not a migration.

### F2 — The CSP/bundling question is already answered by a shipped `import`

`main.ts:19` does `import '@kira/kira-ui/theme/controls.css'`. Vite (root = repo root, one build,
`manifest: true`) emits it into the shared chunk's `css` array; `webviewDocument.ts:34-41`'s
`collectCss` walks `imports` transitively and `:62` emits one `<link rel="stylesheet">` per file
under `asWebviewUri`; the CSP's `style-src ${cspSource} 'unsafe-inline'` (`:67`) permits exactly
that. **There is no network fetch anywhere on this path**, so `style-src`'s remote restrictions
never apply and no directive needs changing. What must *not* happen is importing
`apps/kira-studio/frontend/src/theme/{tokens,primitives}.css` across the app boundary: those files
are ~1.3 kLOC of fixed Dark Modern colour literals, and pulling them in would break the
theme-following guarantee (G12 D14) — which is precisely why `kira-structure.css` exists as a
*colourless transcription* rather than an import.

### F3 — The perf cost of this phase is a rounding error, and first paint is not bytes-bound anyway

`docs/PERF.md` §2.13: a 20 000-commit first page lands at **218-235 ms** against the 300 ms budget,
and `firstChunk ~= total` because the whole page is read and parsed before anything is emitted —
first paint is bounded by the history walk plus parsing, not by transport and not by stylesheet
bytes. Separately, this phase's net CSS delta is near zero by construction: `controls.css` grows by
three small rule blocks while nine duplicated control blocks and one whole token block are deleted
from `git-ui` (`.kv-icon-button` 11 lines, `.kv-undo-button` 24, `.kv-branch-trigger` 25,
`.kv-base-trigger` 24, `.kv-review-comments-icon-button` 26, `.kv-review-row-action` 17,
`.kv-review-toolbar-filter` 11, `.kv-review-picker-filter` 6, `.kv-pull-picker-item` 15, plus
`density.css`'s 12). The stylesheet is a local `<link>` inside an iframe document; a couple of KB
either way is sub-millisecond. §7.1 item 9 records the real numbers from the build rather than
guessing them.

### F4 — The "two density scales" are the same scale with one step missing

| `density.css` | value | `kira-structure.css` | value |
|---|---|---|---|
| `--kv-space-1` | 2px | `--kv-s-1` | 2px |
| `--kv-space-2` | 4px | `--kv-s-2` | 4px |
| — | — | **`--kv-s-3`** | **6px** |
| `--kv-space-3` | 8px | `--kv-s-4` | 8px |
| `--kv-space-4` | 12px | `--kv-s-5` | 12px |
| `--kv-space-5` | 16px | `--kv-s-6` | 16px |

Every workbench step has a Kira step of **identical value**. The reconciliation the SPEC row asks
for is therefore not a compromise between two design languages — it is a rename that renders
byte-identically, after which the 6px step (which `.p-toolbar`'s gap, `.p-btn`'s padding and
`.p-row`'s padding all use, and which is the single most visible "the proportions are off"
difference) becomes available in the graph panel for the first time.

### F5 — The graph panel already references five Kira-scale tokens it cannot resolve

`App.vue:1693-1703`'s `.kv-boot-error-banner` uses `--kv-s-2`, `--kv-s-3`, `--kv-border-width`,
`--kv-font-ui` and `--kv-radius-sm`, but `.kv-app` (`:1321`) carries no `.kv-skin-kira` ancestor.
Each declaration is therefore invalid at computed-value time and falls back to the property's
initial value: `gap: normal`, `padding: 0`, no bottom border, the inherited font, square corners.
The banner has been rendering wrong since G14 D3 and nothing catches it — `scripts/check-tokens.sh`
is scoped to `--kira-*` under `apps/kira-studio/frontend/src` and never looks at `packages/git-ui`.
D1 fixes the banner as a side effect; D16 makes the class of defect impossible.

### F6 — `.kui-button` is a workbench button wearing a Kira component's name

`controls.css:34-47` gives it `border: 1px solid var(--kui-border)`, `border-radius: var(--kui-radius)`
(bridged to `--kv-radius` = **0px**), `padding: 0 var(--kui-space-2)` (4px), `gap: var(--kui-space-1)`
(2px), `color: var(--kui-fg)` (full brightness) and `font-size: inherit` (13px). Kira's `.p-btn`
(`primitives.css:70-90`) is borderless, 4px-rounded, `padding: 0 6px`, `gap: 4px`,
`color: --kira-fg-muted` brightening to `--kira-fg` on hover, `font-size: --kira-t-sm` (12px at a
13px base). Every one of those six differences is visible at a glance side by side, and the toolbar
is where the user sees eight of them in a row. `.kui-button--active` compounds it: it paints
`--kui-selected-bg` (`list.activeSelectionBackground`, a saturated blue) where Kira paints
`--kira-bg-input`, a quiet grey.

### F7 — Icons render one size too large everywhere

`.kui-icon-box .codicon { font-size: 16px }` (`controls.css:30-32`) inside a 16px box, versus
Kira's 13px glyph inside `--kira-icon-box: 16px`. A glyph that exactly fills its box reads as
crowded and heavy next to Kira's — in the toolbar, in every menu row and in every icon button.
`.kui-icon-box`'s own default size is worse: `var(--kui-control-h, 22px)`, overridden back down to
16px by two more-specific rules (`:49-52`, `:159-163`) — three rules for one constant.

### F8 — There are seven implementations of "a row inside a floating panel"

`.kui-menu-item` (`controls.css:149`), `.kv-repo-item` (`RepoPicker.vue:137`), `.kv-branch-row-main`
(`BranchPicker.vue:571`), `.kv-base-row` (`BaseSelector.vue:246`), `.kv-review-picker-row`
(`ReviewView.vue:1003`), `.kv-pull-picker-item` (`PullStrategyPicker.vue:175`) and
`.kv-file-tree-row` (`FileTree.vue:604`). Seven paddings (`2px 8px`, `2px 8px`, `2px 2px`,
`2px 8px`, `2px 4px`, `2px 4px`, `2px 8px`), five gaps, four radii, three hover treatments. Kira has
exactly one: `.p-row`. This is what makes every dropdown in the app read as a different app.

### F9 — There are five implementations of "an icon-only button", all of which override `KuiButton`

`.kv-icon-button` (defined in **`BranchPicker.vue:621-631`** in an unscoped `<style>` — a global
rule living inside one component's SFC, consumed by seven other components), `.kv-undo-button`
(`UndoButton.vue:60-82`, a verbatim re-declaration of `.kui-button`'s box with `border: none`),
`.kv-review-comments-icon-button` (`ReviewCommentsPane.vue:176-201`), `.kv-review-row-action`
(`ReviewCommitRow.vue:381-397`, whose `:hover` uses `--kv-row-selected-bg` — the selection blue, not
a hover tint), and `KuiButton`'s own `variant="ghost"` (`controls.css:91-99`). None of them is
square; none matches `.p-iconbtn`. `kira-ui` has no icon-only variant at all, which is why each
caller invented one.

### F10 — Two hand-rolled dropdown menus exist alongside the real one

`AppToolbar.vue:310-320`'s `.kv-push-menu` and `PullStrategyPicker.vue:119-144`'s
`.kv-pull-picker-panel` are both `role="menu"` built from `KuiButton role="menuitem"` inside a
`KuiPopoverPanel`. They have no roving `tabindex`, no arrow-key navigation, no `Home`/`End`, and no
visual relationship to `KuiContextMenu`'s rows — a user who right-clicks a commit and then opens the
Push overflow sees two different menus. The cause is structural: `KuiContextMenu` is point-anchored
(`x`/`y` props) and cannot be anchored to a trigger, so a trigger-anchored menu had nowhere to go.
`floatingPosition.ts:47-95` already accepts both an element and a `pointReference`, so positioning
was never the obstacle — only the coupling of rows to positioning inside one component.

### F11 — `.kv-toolbar` is the one bar in the app still on the workbench scale

`AppToolbar.vue:385-401`: `height: var(--kv-toolbar-height)` (35px), `gap: var(--kv-space-2)` (4px),
`padding: 0 var(--kv-space-3)` (8px), and a separator that `align-self: stretch`es to ~27px with 4px
block margins. The review sidebar's `.kv-review-toolbar` (`ReviewView.vue:1089-1097`) is already
Kira-shaped — `height: var(--kv-bar-h)`, `gap: var(--kv-s-3)`, `padding: 0 var(--kv-s-4)` — and so
is `.kv-review-comments-header` (`ReviewCommentsPane.vue:160-169`). The graph panel's toolbar is the
outlier, not the standard.

### F12 — Most menu items carry no icon, and the icon box is conditional, so labels do not align

`rowMenuModel.ts`: `buildRowMenu`/`buildRefMenu` give every item an icon, but `buildStashMenu`
(`:281-300`, six items) and `buildGlobalStashMenu` (`:310-332`, three of four) give none.
`KuiContextMenu.vue:179-181` renders the icon box only `v-if="item.icon"`, so an unfilled slot
collapses and the label slides left. Kira renders the box unconditionally
(`ContextMenu.vue:256-263`) for exactly this reason.

### F13 — `--kui-space-5` is load-bearing as a *gutter*, not as a spacing step

`controls.css:358` (`.kui-search-input-field`) and `:401` (`.kui-select-field`) use
`var(--kui-space-5, 20px)` as the clearance for a leading search glyph and a trailing chevron.
`--kui-space-5` currently bridges to `--kv-space-5` = 16px; after D2 the same index bridges to
`--kv-s-5` = **12px**, which would crowd both glyphs. This is the single silent regression the
rename could cause, and D3 pins those two declarations to `--kui-space-6` explicitly.

### F14 — `--kv-row-height` is read by JavaScript, so `density.css` cannot simply be deleted

`theme/readTokens.ts:18` reads `--kv-row-height`, `--kv-font-size` and `--kv-font-family` off the
live computed style and hands `rowHeightPx` to SlickGrid (`:96-103`, default `22`), re-reading on
theme change. `--kv-tree-indent` (`density.css:23`) is likewise written per-view from the live
settings snapshot (`App.vue:186`). Those four survive; everything else in the file goes.

### F15 — The `--kui-*` contract's other half has been stale since G21

`apps/kira-studio/frontend/src/theme/kui-bridge.css` maps 18 members of the vocabulary and is
missing `--kui-z-modal`, `--kui-overlay-bg` and `--kui-button-bg`/`-fg`/`-hover-bg` — all added by
G21 D2 to the git-ui bridge only. The file's own header states the property this breaks: "Loaded so
the contract is real and satisfiable from both hosts." It currently is not.

### F16 — The webview test tiers survive this phase, and one already documents a bug this phase can close

`webview-layout.spec.ts` asserts root height == viewport height and that children fit — indifferent
to a 35 -> 34px toolbar. `kui-floating-geometry.spec.ts` asserts *relative* flip/shift geometry, so
a taller menu row or a narrower `min-width` cannot break it. Every `.kv-*` selector the four
interaction specs use (`.kv-review-row-header`, `.kv-file-tree-row`, `.kv-file-tree-icon`,
`.kv-file-tree-status`, `.kv-cell-*`, `.kv-meta-*`, `.kv-review-row-actions`) is a *structural* hook
this phase keeps. `kui-floating-geometry.spec.ts:107-110` documents a live bubbling quirk —
`FileTree.vue`'s `onRowContextMenu` calls `preventDefault()` without `stopPropagation()`, so a
right-click on a file row opens the row's "Commit actions" menu underneath the "File actions" one.
Two menus stacked on one right-click is a visual defect in scope here even though its cause is an
event handler.

---

## 2. Decisions

### The scale

### D1 — `kira-structure.css` becomes the app's one scale, hoisted to `:root`

The `.kv-skin-kira` selector (`kira-structure.css:14`) becomes `:root`. `.kv-skin-kira` is removed
from `ReviewView.vue:631` and `FileTree.vue:409`, and the class ceases to exist. The file keeps its
name, its charter and its no-colour guarantee (grep it for a hex literal, `rgb(`, or a
`color`/`background`/`border-color` property and find nothing — G12 D14's own checkable promise,
carried forward verbatim in §7.4).

Hoisting changes **no** currently-resolving value: `--kv-s-*`/`--kv-t-*`/`--kv-h-*`/`--kv-control-h`/
`--kv-radius-sm`/`--kv-radius-panel`/`--kv-bar-h`/`--kv-icon-box`/`--kv-font-ui`/`--kv-font-data`/
`--kv-shadow`/`--kv-border-width` collide with nothing at `:root` (`vscode-tokens.css` and
`density.css` define none of them), and CSS custom properties resolve at *use* time, so import order
in `main.ts` is irrelevant to correctness. The only rules whose rendering changes are the five
declarations F5 found broken, which start rendering as their author intended.

Three tokens Kira has and this transcription missed are added, so later decisions have something to
reference:

```css
  --kv-control-h-sm: var(--kv-h-xs);   /* chip / badge / count / status density */
  --kv-control-inline-h: 14px;         /* drawn inside a control or a bar: separator, tab rail */
  --kv-shadow-dialog: 0 8px 28px;      /* geometry only — composed with --kv-widget-shadow */
```

`--kv-control-inline-h` stays a literal because Kira's own is (`tokens.css`'s
`--kira-control-inline-h: 14px`); this file's charter is transcription, not re-derivation.

The five `var(--kv-t-xs, 0.85em)` fallbacks (`FileTree.vue:665`, `:704`, `:723`;
`ReviewView.vue:1082`; `ReviewCommitRow.vue:338`) become dead and are simplified to
`var(--kv-t-xs)` — at the 13px default the two are 11px and 11.05px, so nothing moves.

**`main.ts`'s import block is reordered** so the scale loads before the bridge that consumes it:
`app-shell` -> `codicon` -> `vscode-tokens` -> `density` -> `kira-structure` -> `kui-bridge` ->
`controls`. Purely for legibility; behaviour is order-independent.

### D2 — `--kv-space-*` is renamed onto the Kira scale, value-identically, at all 226 call sites

Per F4's table: `--kv-space-1` -> `--kv-s-1`, `-2` -> `--kv-s-2`, `-3` -> `--kv-s-4`,
`-4` -> `--kv-s-5`, `-5` -> `--kv-s-6`. 81 + 145 occurrences across 40 files. The rename is
mechanical and collision-free (source and target namespaces are disjoint — `--kv-space-N` versus
`--kv-s-N`), so it can be applied in any order. **Every rendered value is unchanged by this step
alone** — the deliberate restyles are D5-D13 and are separate commits, so a bisect can distinguish
"the rename moved something" from "a restyle moved something". Verified by
`grep -rn 'kv-space-' packages/` returning nothing (§7.1 item 6).

`density.css` is then reduced to what F14 proves must survive:

```css
:root {
  --kv-row-height: 22px;
  --kv-row-height-compact: 20px;
  --kv-row-height-comfortable: 26px;
  --kv-tree-indent: 8px;
}
```

`--kv-toolbar-height` (one consumer; D13 replaces it with `--kv-bar-h`) and `--kv-radius` (18
consumers; D4 replaces every one with `--kv-radius-sm`) are deleted with it. The file's header is
rewritten: it is no longer "the spacing and row-height scale", it is the row-density tokens the Kira
scale deliberately does not express (a *list row height* is not a *control height*) plus the tree
indent the host supplies at runtime.

### D3 — The bridge is rewritten against the Kira scale, and gains the vocabulary Kira's primitives need

`packages/git-ui/src/theme/kui-bridge.css`, in full:

```css
:root {
  --kui-fg: var(--kv-app-fg);
  --kui-fg-muted: var(--kv-description-fg);
  --kui-fg-subtle: var(--kv-description-fg);
  --kui-bg-panel: var(--kv-panel-bg);
  --kui-bg-input: var(--kv-input-bg);
  --kui-border: var(--kv-panel-border);
  --kui-border-strong: var(--kv-border-strong);
  --kui-border-width: var(--kv-border-width);
  --kui-hover-bg: var(--kv-row-hover-bg);
  --kui-active-bg: var(--kv-input-bg);
  --kui-selected-bg: var(--kv-row-selected-bg);
  --kui-selected-fg: var(--kv-row-selected-fg);
  --kui-danger-fg: var(--kv-diff-deleted-fg);
  --kui-focus-border: var(--kv-focus-border);
  --kui-radius: var(--kv-radius-sm);          /* interactive controls — Kira's sm tier, 4px */
  --kui-radius-float: var(--kv-radius-panel); /* menus/popovers/dialogs — Kira's panel tier, 6px */
  --kui-control-h: var(--kv-control-h);
  --kui-control-h-sm: var(--kv-control-h-sm);
  --kui-control-inline-h: var(--kv-control-inline-h);
  --kui-icon-box: var(--kv-icon-box);
  --kui-icon-size: 13px;                      /* Kira's own CodiconIcon default */
  --kui-font-ui: var(--kv-font-ui);
  --kui-font-size: var(--kv-t-md);
  --kui-font-size-sm: var(--kv-t-sm);
  --kui-font-size-xs: var(--kv-t-xs);
  --kui-space-1: var(--kv-s-1);  --kui-space-2: var(--kv-s-2);  --kui-space-3: var(--kv-s-3);
  --kui-space-4: var(--kv-s-4);  --kui-space-5: var(--kv-s-5);  --kui-space-6: var(--kv-s-6);
  --kui-shadow-float: var(--kv-shadow-dialog) var(--kv-widget-shadow);
  --kui-overlay-bg: var(--kv-overlay-bg);
  --kui-button-bg: var(--kv-button-bg);
  --kui-button-fg: var(--kv-button-fg);
  --kui-button-hover-bg: var(--kv-button-hover-bg);
  --kui-z-popover: 20;  --kui-z-menu: 30;  --kui-z-modal: 40;  --kui-z-tooltip: 50;
}
```

Two things this makes true that were not: `--kui-control-h` is a *token* (so a user who raises VS
Code's font size gets taller controls instead of clipped text — `--kv-h-sm` is
`calc(--kv-font-size + 9px)`, exactly 22px at the 13px default), and `--kui-space-N` now means the
same physical step as `--kv-s-N`, one index scale for the whole webview.

**F13's regression is closed explicitly**: `controls.css`'s two gutter declarations
(`.kui-search-input-field`'s horizontal padding, `.kui-select-field`'s `padding-right`) move from
`var(--kui-space-5, 20px)` to `var(--kui-space-6, 16px)`, keeping the 16px clearance a 13px glyph
needs. Stated here rather than left to the implementer to notice.

`apps/kira-studio/frontend/src/theme/kui-bridge.css` gains the mirror image, closing F15:
`--kui-fg-subtle: var(--kira-fg-subtle)`, `--kui-bg-input: var(--kira-bg-input)`,
`--kui-border-strong: var(--kira-border-strong)`, `--kui-border-width: var(--kira-border-width)`,
`--kui-active-bg: var(--kira-bg-input)`, `--kui-radius-float: var(--kira-radius)`,
`--kui-control-h-sm: var(--kira-control-h-sm)`,
`--kui-control-inline-h: var(--kira-control-inline-h)`, `--kui-icon-box: var(--kira-icon-box)`,
`--kui-icon-size: 13px`, `--kui-font-ui: var(--kira-font-ui)`, `--kui-font-size: var(--kira-t-md)`,
`--kui-font-size-sm: var(--kira-t-sm)`, `--kui-font-size-xs: var(--kira-t-xs)`,
`--kui-space-5: var(--kira-s-5)`, `--kui-space-6: var(--kira-s-6)`,
`--kui-shadow-float: var(--kira-shadow-dialog)`, `--kui-z-modal: var(--kira-z-modal)`,
`--kui-overlay-bg`, `--kui-button-bg: var(--kira-accent)`,
`--kui-button-fg: var(--kira-accent-fg)`, `--kui-button-hover-bg: var(--kira-accent)`. Still inert
on that side — nothing there consumes `@kira/kira-ui` yet — but the contract becomes satisfiable
from both hosts again, which is the property that file exists to hold.

### D4 — Three new theme-following colour tokens; `--kv-radius` retires

`vscode-tokens.css` (the one file permitted colour literals) gains, in the Surfaces block:

```css
  --kv-input-bg: var(--vscode-input-background, #313131);
  --kv-input-border: var(--vscode-input-border, var(--kv-panel-border));
  --kv-border-strong: var(--vscode-widget-border, var(--kv-panel-border));
```

with `--kv-input-bg: var(--vscode-input-background, #ffffff)` added to the existing
`body.vscode-light, body.vscode-high-contrast-light` block (`:188`), for the same reason every other
literal in that block is there: the dark literal is only ever seen where no host supplies the real
value, and that is exactly where the light kinds need a different one. `--kv-border-strong` and
`--kv-input-border` need no light override — both fall through to `--kv-panel-border`, which already
handles both kinds.

`--kv-radius` (`density.css:17`, `0px`, "the workbench has square corners; we do not invent rounded
ones") is **deleted**. That rule states a *workbench* law; this phase's charter states a *Kira
Studio* law, and Kira rounds interactive controls at 4px and floating surfaces at 6px. All 17
`var(--kv-radius)` call sites outside the bridge move to `var(--kv-radius-sm)`: `App.vue:1685`,
`:1734`; `BranchPicker.vue:511`, `:607`; `SearchBox.vue:390`; `SearchResults.vue:163`, `:221`;
`PullStrategyPicker.vue:184`; `BaseSelector.vue:192`; `ReviewView.vue:953`; `UndoButton.vue:67`;
`LoadMoreButton.vue:95`, `:121`; `ConflictBanner.vue:199`; `NoRepositoryPanel.vue:85`;
`RevertDialog.vue:145`; `ResetDialog.vue:220`. `kui-bridge.css:18` is re-pointed by D3.

### The shared components

### D5 — `.kui-button` becomes `.p-btn`, and gains the icon variant `kira-ui` never had

`packages/kira-ui/src/theme/controls.css`, the button block, re-specified against
`primitives.css:35-99`:

```css
.kui-button {
  display: inline-flex;
  align-items: center;
  gap: var(--kui-space-2, 4px);
  height: var(--kui-control-h, 22px);
  padding: 0 var(--kui-space-3, 6px);
  background: transparent;
  color: var(--kui-fg-muted, inherit);
  /* A transparent 1px border, not `border: none`: the box must not resize between the default,
     primary and danger variants, which all draw one. Kira splits this across .p-btn (no border)
     and .p-dlgbtn (bordered); this package has one component for both, so the border is always
     present and only ever recoloured. */
  border: var(--kui-border-width, 1px) solid transparent;
  border-radius: var(--kui-radius, 4px);
  font-family: inherit;
  font-size: var(--kui-font-size-sm, inherit);
  cursor: pointer;
  flex-shrink: 0;
}
.kui-button:hover:not(:disabled) {
  background-color: var(--kui-hover-bg, rgba(128, 128, 128, 0.15));
  color: var(--kui-fg, inherit);
}
.kui-button:focus-visible {
  outline: var(--kui-border-width, 1px) solid var(--kui-focus-border, currentColor);
  outline-offset: -1px;
}
.kui-button:disabled { opacity: 0.6; cursor: default; }
.kui-button--active {
  background-color: var(--kui-active-bg, var(--kui-hover-bg));
  color: var(--kui-fg, inherit);
}
/* Kira's P1 icon button: a square at the control height, no text, no border. */
.kui-button--icon {
  width: var(--kui-control-h, 22px);
  padding: 0;
  justify-content: center;
}
```

`.kui-button--primary` and `--danger` keep their existing token triples unchanged (D3 keeps
`--kui-button-*` bridged); both now sit on the same box as the default, because the transparent
border reserves the space.

**`variant="ghost"` is retired** and its rule deleted. With `.kui-button` itself borderless-at-rest
and muted, `ghost` no longer names anything distinct — it differed only by `opacity: 0.8`, which is
a worse way of saying "muted" than a colour token is. Its four call sites become `variant="icon"`
where they are icon-only (`CommitMeta.vue:236`, `UndoButton.vue:42`, `FileTree.vue:536`) and the
plain default where they are text (`CommitMeta.vue:251`'s "Show more"/"Show less").

`KuiButton.vue` accordingly: `variant?: 'default' | 'primary' | 'danger' | 'icon'`, plus a `ref` on
the `<button>` and `defineExpose({ focus: () => el.value?.focus() })` — three lines, the same escape
hatch `KuiSearchInput` already exposes for the identical structural reason (a caller cannot reach
the root DOM node of a `<script setup>` component). That expose is what lets `BranchPicker.vue:325`'s
last raw `<button>` become a `KuiButton` (D14).

### D6 — `.kui-icon-box` is one rule and one constant

```css
.kui-icon-box {
  width: var(--kui-icon-box, 16px);
  height: var(--kui-icon-box, 16px);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.kui-icon-box .codicon { font-size: var(--kui-icon-size, 13px); }
```

The two size overrides (`controls.css:49-52`'s `.kui-button .kui-icon-box`, and the size half of
`:159-163`'s `.kui-menu-item .kui-icon-box`) are deleted; the menu rule keeps only its
`color: var(--kui-fg-muted)`, matching Kira's `.item-icon`. This closes F7 in both directions —
a 16px box holding a 13px glyph, everywhere, from two declarations.

### D7 — `.kui-row` is promoted: one row primitive, seven call sites

Kira's P8 row (`primitives.css:505-522`), transcribed into `controls.css` against `--kui-*`:

```css
.kui-row {
  display: flex;
  align-items: center;
  gap: var(--kui-space-2, 4px);
  min-height: var(--kui-control-h, 22px);
  padding: 0 var(--kui-space-3, 6px);
  border-radius: var(--kui-radius, 4px);
  color: var(--kui-fg, inherit);
  font-size: var(--kui-font-size, inherit);
  cursor: pointer;
  white-space: nowrap;
}
.kui-row:hover, .kui-row:focus-visible {
  background-color: var(--kui-hover-bg, rgba(128, 128, 128, 0.15));
  outline: none;
}
.kui-row--selected { background-color: var(--kui-selected-bg); color: var(--kui-selected-fg); }
.kui-row--disabled { color: var(--kui-fg-muted, currentColor); cursor: default; }
.kui-row--disabled:hover { background-color: transparent; }
.kui-row--danger, .kui-row--danger .kui-icon-box { color: var(--kui-danger-fg, var(--kui-fg)); }
```

`min-height`, not Kira's fixed `height`: `.kv-branch-row-main` and `KuiMenuList`'s `detail` line
(D8) are genuinely two-line rows, and a fixed height would clip them. Every single-line consumer
renders at exactly 22px either way.

`.kui-menu-item` keeps its class name — `KuiContextMenu`'s DOM contract and any
`getByRole('menuitem')` query stay untouched — but stops carrying its own geometry: the row element
becomes `class="kui-row kui-menu-item"`, and `.kui-menu-item` retains only what is menu-specific
(the `--danger`/`--disabled` modifier aliases and the icon-box colour). F8's six `packages/git-ui`
rows compose `.kui-row` the same way (§4).

### D8 — `KuiMenuList.vue` is extracted from `KuiContextMenu.vue`; both hand-rolled menus adopt it

New `packages/kira-ui/src/KuiMenuList.vue`: everything `KuiContextMenu.vue:38-120` and `:153-193`
does **except positioning and the outside-click backdrop** — the `role="menu"` element, the
section/separator/heading/row rendering, the roving `tabindex`, and the
`Escape`/`Arrow`/`Home`/`End`/`Enter`/`Space`/`Tab` handler (including its `stopPropagation()`
discipline, which is load-bearing and moves verbatim). Props `sections`, `label`, `title`; emits
`select`, `close`; exposes `focusFirst()`.

`KuiContextMenu.vue` becomes: `computeFloatPosition(pointReference(x, y), …)` plus the document
`pointerdown` capture plus focus-capture-and-return, wrapping `<KuiMenuList>`. **Its public API —
every prop, every emit — is unchanged**, so `RowContextMenu.vue` and all eight of its consumers need
zero edits.

`AppToolbar.vue`'s `.kv-push-menu` (`:310-320`) and `PullStrategyPicker.vue`'s
`.kv-pull-picker-panel` (`:119-144`) become `<KuiPopoverPanel><KuiMenuList …/></KuiPopoverPanel>`,
driven by a `MenuSection[]` computed in each file's `<script setup>`. They gain full keyboard
navigation for free and — the point of the phase — they render as the same menu the right-click
does. `.kv-push-menu`, `.kv-push-menu-item`, `.kv-pull-picker-panel`, `.kv-pull-picker-item`,
`.kv-pull-picker-item-label` and `.kv-pull-picker-item-detail` are deleted.
`data-testid="force-push-trigger"`, `"pull-strategy-default"` and `"pull-strategy-<strategy>"` are
preserved by deriving each row's `:data-testid` from `MenuItem.id`, so no test or palette path
changes.

`MenuItem` gains one optional field:

```ts
  /** A secondary line under the label — muted, one type step down. `PullStrategyPicker`'s own
   *  "Merge — from pull.rebase in your repository config" is the only producer today; it is a
   *  second LINE rather than Kira's right-aligned `.shortcut` slot because the string is a
   *  sentence, not a key chord, and right-aligning it in a 260 px panel would truncate it away. */
  readonly detail?: string;
```

rendered as `<span class="kui-menu-item-detail">` inside a column-flex label cell
(`font-size: var(--kui-font-size-xs); color: var(--kui-fg-muted)`).

### D9 — Every menu row boxes its icon, and every menu item has one

`KuiMenuList.vue` renders `<span class="kui-icon-box">` unconditionally with the codicon `v-if`
inside it (Kira's own shape, `ContextMenu.vue:256-263`), so labels align whether or not a given item
carries an icon. And `rowMenuModel.ts` fills the gaps F12 found:

| function | item | icon |
|---|---|---|
| `buildStashMenu` | `stashApply` | `codicon-diff-added` |
| | `stashPop` | `codicon-export` |
| | `stashDrop` | `codicon-trash` (+ `danger: true`) |
| | `stashBranch` | `codicon-git-branch` |
| | `stashSaveGlobal` | `codicon-archive` |
| | `stashShow` | `codicon-eye` |
| `buildGlobalStashMenu` | `stashApply` | `codicon-diff-added` |
| | `stashBranch` | `codicon-git-branch` |
| | `stashShow` | `codicon-eye` |
| | `globalStashRemove` | `codicon-trash` (already `danger`) |

`gatedItem`/`plainItem`'s signatures are unchanged; only call arguments grow.
`rowMenuModel.test.ts` asserts ids only, so no test edit is needed — which is the reason to fix the
icon set here in the plan rather than leave the choice to the implementer.

### D10 — The menu surface adopts `.p-float`

```css
.kui-menu-root {
  position: fixed;
  z-index: var(--kui-z-menu, 30);
  min-width: 180px;
  max-width: 320px;
  max-height: var(--kui-float-max-h, none);
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 1px;
  padding: var(--kui-space-2, 4px);
  background-color: var(--kui-bg-panel, canvas);
  color: var(--kui-fg, inherit);
  border: var(--kui-border-width, 1px) solid var(--kui-border-strong, transparent);
  border-radius: var(--kui-radius-float, 6px);
  box-shadow: var(--kui-shadow-float, 0 8px 28px rgba(0, 0, 0, 0.45));
}
```

`min-width` 220 -> **180** (Kira's), `max-width` **kept at 320** deliberately: Kira's own menu has no
horizontal cap because its labels are short, and this app's longest is "Checkout this commit
(detached HEAD)" — uncapped, the commit menu would be visibly wider than the file menu and would
change width per row, which is a worse artifact than one ellipsis. `padding: 4px` on all sides plus
`gap: 1px` between rows replaces `2px 0`, so a hovered row's rounded highlight has margin to sit in
instead of bleeding to the surface's edge — that inset is most of what makes Kira's menus read as
Kira's.

`.kui-menu-heading` adopts Kira's `.p-menu-label` (`primitives.css:647-656`): `--kui-control-h-sm`
height, `--kui-font-size-xs`, `--kui-fg-subtle`, `text-transform: uppercase`,
`letter-spacing: 0.06em`, and **no** `border-bottom` — Kira separates with whitespace, not a rule.
`.kui-menu-separator` adopts `.p-sep`: `--kui-border-width` tall, `--kui-border-strong`,
`margin: var(--kui-space-2) 0`.

`.kui-popover`, `.kui-tooltip` and `.kui-modal` take the same `--kui-radius-float` /
`--kui-border-strong` / `--kui-shadow-float` triple, so every floating surface in the app is one
specification (Kira uses `--kira-shadow-dialog` for all of them too).

### D11 — `KuiSegmented` becomes `.p-seg`: one bordered pill with hairline dividers

`controls.css:298-323` currently renders a *gapped row of independently-bordered buttons*. Kira's
`.p-seg` (`primitives.css:452-482`) is a single bordered, `overflow: hidden` pill whose children are
divided by 1px hairlines and whose active child is filled with `--kira-bg-input`:

```css
.kui-segmented {
  display: inline-flex;
  height: var(--kui-control-h, 22px);
  border: var(--kui-border-width, 1px) solid var(--kui-border-strong, transparent);
  border-radius: var(--kui-radius, 4px);
  overflow: hidden;
  flex-shrink: 0;
}
.kui-segmented-button {
  display: flex; align-items: center; justify-content: center; gap: var(--kui-space-1, 2px);
  padding: 0 var(--kui-space-3, 6px);
  border: none; background: none;
  color: var(--kui-fg-muted, inherit);
  font-size: var(--kui-font-size-sm, inherit);
  cursor: pointer; white-space: nowrap;
}
.kui-segmented-button + .kui-segmented-button {
  border-left: var(--kui-border-width, 1px) solid var(--kui-border-strong, transparent);
}
.kui-segmented-button:hover:not(.kui-segmented-button--active) {
  background-color: var(--kui-hover-bg);
}
.kui-segmented-button--active {
  background-color: var(--kui-active-bg, var(--kui-hover-bg));
  color: var(--kui-fg, inherit);
}
```

Four call sites, all in the review sidebar and the file tree (`FileTree.vue`, `ReviewFilesPane.vue`,
`ReviewView.vue` x2) — the Commits/Files and Tree/Flat toggles the user looks at most.
`.kui-segmented-badge` keeps its pill shape but moves onto `--kui-control-h-sm` /
`--kui-font-size-xs`.

### D12 — `KuiTextInput`/`KuiSearchInput`/`KuiSelect` adopt `.p-input`/`.p-select`

`.kui-text-input` and `.kui-search-input-field`: `padding: 0 var(--kui-space-4)` (8px — Kira's P16
D7, "the inset every other text surface uses"; was 4px), `background-color: var(--kui-bg-input)`
(was `--kui-bg-panel`, i.e. the same colour as the surface behind it, which is why the field
currently has no presence at all), `border-color: var(--kui-border-strong)`,
`border-radius: var(--kui-radius)` (4px, was 0), `font-size: var(--kui-font-size-sm)`, and on focus
`border-color: var(--kui-focus-border)` in addition to the existing `outline`.
`::placeholder { color: var(--kui-fg-muted) }` is added — Kira's P16 D8, and nothing sets it today.

`.kui-select-field` takes the same treatment plus
`padding: 0 var(--kui-space-6) 0 var(--kui-space-3)` (F13's gutter, and Kira's 6px leading inset).
Per F13, `.kui-search-input-field`'s left/right gutters are `var(--kui-space-6, 16px)`, **not** the
renamed `--kui-space-5`.

### The `packages/git-ui` surfaces

### D13 — `.kv-toolbar` moves onto Kira's bar geometry, in full

```css
.kv-toolbar {
  display: flex;
  align-items: center;
  gap: var(--kv-s-3);                 /* 6px — .p-toolbar's own gap (was 4px) */
  height: var(--kv-bar-h);            /* 34px at a 13px base, and it tracks the font size */
  padding: 0 var(--kv-s-4);           /* 8px — unchanged value, Kira index */
  background-color: var(--kv-toolbar-bg);
  border-bottom: var(--kv-border-width) solid var(--kv-toolbar-border);
  flex-shrink: 0;
}
.kv-toolbar-separator {               /* .p-toolbar .sep */
  width: var(--kv-border-width);
  height: var(--kv-control-inline-h); /* 14px, centred — was a stretched ~27px rail */
  align-self: center;
  margin: 0 var(--kv-s-1);
  background-color: var(--kv-border-strong);
  flex-shrink: 0;
}
```

35px -> 34px is deliberate. `AppToolbar.vue:15-16`'s stated reason for 35px ("Metrics match the
panel title bar's, not an invented toolbar height") does not survive scrutiny: the panel title bar
is VS Code chrome *outside* this webview's iframe, so there is no shared vertical edge for the two
to line up on, and 35px is a literal that does not grow when the user raises `--vscode-font-size`
while every control inside it does. `--kv-bar-h` is the token Kira's own toolbar, tab bar and title
bar all alias, and it is already what the review sidebar's toolbar uses. That doc comment is
rewritten rather than left contradicting the code.

`.kv-toolbar-restacking` and `.kv-remote-progress` adopt `.p-status` (`primitives.css:617-637`):
`height: var(--kv-control-h-sm)`, `padding: 0 var(--kv-s-3)`, `border-radius: var(--kv-radius-sm)`,
`gap: var(--kv-s-2)`, `font-size: var(--kv-t-sm)` (replacing the bare `0.9em`).
`.kv-remote-progress-label` keeps its 260px ellipsis clamp.

`App.vue:1651-1659`'s `.kv-search-row` takes the toolbar's own inset —
`gap: var(--kv-s-2); padding: var(--kv-s-2) var(--kv-s-4); border-bottom: var(--kv-border-width) …` —
so the two stacked bars read as one chrome block rather than two differently-padded strips.

### D14 — The five icon-button implementations and the two bespoke triggers are deleted

| Deleted | Where | Replacement |
|---|---|---|
| `.kv-icon-button` (11 lines, a global rule inside one SFC) | `BranchPicker.vue:621-631` | `variant="icon"` at all 16 call sites (`AppToolbar.vue:339`, `:351`, `:372`; `BranchPicker.vue:366`, `:395`, `:424`; `RefreshButton.vue:67`; `StackList.vue:111`, `:119`, `:139`; `WorktreeList.vue:131`, `:140`, `:149`; `StashList.vue:124`; `TagList.vue:105`; `GlobalStashList.vue:113`) |
| `.kv-undo-button` (24 lines re-declaring `.kui-button`'s box) | `UndoButton.vue:60-82` | nothing — the default `KuiButton` is now this exact shape |
| `.kv-branch-trigger` (25 lines) | `BranchPicker.vue:504-527` | `<KuiButton ref="triggerEl">` using D5's exposed `focus()`; only `max-width: 200px` survives |
| `.kv-base-trigger` (24 lines, `height: 24px` — a magic number matching nothing in either scale) | `BaseSelector.vue:185-208` | nothing; only `max-width: 100%` survives |
| `.kv-review-comments-icon-button` (26 lines) | `ReviewCommentsPane.vue:176-201` | `variant="icon"` at `:76`, `:85`, `:127` |
| `.kv-review-row-action` (17 lines; `:hover` used the selection blue, not a hover tint) | `ReviewCommitRow.vue:381-397` | `variant="icon"` on the `KuiButton`; the `<a>` at `:235-242` keeps `class="kui-button kui-button--icon"` — D15 |
| `.kv-review-toolbar-filter`'s chrome (height/background/border/radius/padding/font) | `ReviewView.vue:1099-1110` | `.kui-text-input`'s own; only `flex: 1; min-width: 0` survives |
| `.kv-review-picker-filter` (6 lines) | `ReviewView.vue:983-988` | `.kui-text-input`'s own |
| `.kv-review-comments-clear-confirm button` (10 lines) | `ReviewCommentsPane.vue:211-220` | nothing — both children are already `KuiButton`s |
| `.kv-review-comments-row-delete`'s `calc(var(--kv-control-h) * 0.8)` sizing | `ReviewCommentsPane.vue:269-273` | `variant="icon"` — a delete affordance inside a row is the same icon button as everywhere else |

### D15 — What stays bespoke, and the concrete reason for each

| Stays bespoke | The reason it cannot be a `Kui*` component | How it still reaches parity |
|---|---|---|
| `SearchBox.vue`'s combobox orchestration and `SearchResults.vue`'s listbox | An ARIA 1.2 combobox over a **sectioned** result list with `aria-activedescendant`, per-result match-range highlighting (`searchHighlight.ts`) and a regex-error `aria-describedby`. `KuiSearchInput` already supplies the input and, since G-UX D9, the ARIA escape hatch; there is no listbox primitive in `kira-ui` and exactly one consumer, so promoting one would be speculative generality. The SPEC row cites this as precedent and it holds | `.kv-search-error` and `SearchResults.vue`'s dropdown take D10's floating triple; its option rows compose `.kui-row`; `.kv-search-count`/`-scope`/`-toggle` move to `var(--kv-t-xs)` |
| `ReviewCommitRow.vue:235-242`'s "Open in graph" affordance | Must stay a real `<a href="command:…">`: VS Code's document-level link interceptor is what delivers the command URI, and G-UX D5/F6 fixed a live bug caused by interfering with that click. It is an anchor, not a button | It wears `class="kui-button kui-button--icon"`, so it is bespoke in *element* only, never in appearance |
| `FileTree.vue`'s tree rows | A `role="tree"`/`treeitem` roving-focus tree with CSS-mask seti icons, a token-driven indent, per-row review toggles and a 2 000-row cap. `kira-ui` has no tree primitive; Studio's own `TreeHost.vue` is `VirtualList`-backed and app-specific | `.kv-file-tree-row` composes `.kui-row` (its current geometry is already within 2px of it); `.kv-file-tree-toolbar` becomes `padding: 0 var(--kv-s-4) var(--kv-s-2); gap: var(--kv-s-2)` |
| `CommitGrid.vue` | SlickGrid owns the row DOM | Out of scope entirely (§8) |
| `.kv-badge-*` / `refBadges.ts` | Per-ref-kind coloured badges with four PR states and a stacked/stale outline; Kira's `.p-badge`/`.p-chip` are monochrome. One consumer, no shared abstraction earns its keep | Out of scope (§8) |
| `.kv-toolbar-restacking`, `.kv-remote-progress` | No `Kui*` status primitive exists and one consumer does not justify inventing one | Restyled onto `.p-status`'s exact proportions (D13) rather than left alone |

### D16 — `scripts/check-tokens.sh` grows two more passes

The script becomes a loop over three (source dir, prefix, definition files) triples:

| Prefix | Source | Definitions |
|---|---|---|
| `--kira-` | `apps/kira-studio/frontend/src` | `theme/{tokens,base,primitives}.css` |
| `--kv-` | `packages/git-ui/src` | `packages/git-ui/src/theme/{vscode-tokens,density,kira-structure}.css` |
| `--kui-` | `packages/kira-ui/src` and `packages/git-ui/src` | `packages/git-ui/src/theme/kui-bridge.css` |

Its existing blind spot is unchanged and still exactly right: a `var(--x, fallback)` is skipped by
construction, which is what `controls.css` needs, since *every* `--kui-*` reference there carries a
fallback on purpose (a host that has not loaded a bridge must still render something). The `--kui-`
pass therefore catches a `git-ui` call site referencing a `--kui-*` the bridge does not define,
while leaving `controls.css` alone. `bun run lint` already invokes this script, so no CI wiring
changes.

**This is the guard that would have caught F5**, and it is the only genuinely new *mechanism* this
phase adds.

### D17 — `FileTree.vue`'s right-click stops opening two menus

`kui-floating-geometry.spec.ts:107-110` documents it: `FileTree.vue`'s `onRowContextMenu` calls
`preventDefault()` but not `stopPropagation()`, so the same `contextmenu` event also reaches
`ReviewCommitRow.vue`'s handler and a second menu opens underneath the first. Two stacked menus on
one right-click is a visual defect squarely inside this phase's charter, the fix is one call, and
that spec's own comment can then lose its "pre-existing bubbling quirk, not fixed here" caveat and
scope back to `getByRole('menu')` without a name filter.

---

## 3. `packages/kira-ui`, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 3.1 | `src/theme/controls.css` | edited | D5/D6/D7/D10/D11/D12 — button, icon box, `.kui-row`, menu surface/heading/separator, segmented, inputs, popover/tooltip/modal chrome. `--ghost` deleted; `.kui-button--icon`, `.kui-row*`, `.kui-menu-item-detail` added |
| 3.2 | `src/KuiButton.vue` | edited | `variant` union gains `'icon'`, loses `'ghost'`; `ref` on the `<button>` plus `defineExpose({ focus })` |
| 3.3 | `src/KuiMenuList.vue` | **new** | D8 — rows, sections, separators, heading, roving focus, unconditional icon box, `detail` line |
| 3.4 | `src/KuiContextMenu.vue` | edited | Reduced to positioning + backdrop + focus return around `<KuiMenuList>`; public API byte-identical |
| 3.5 | `src/contextMenuModel.ts` | edited | `MenuItem.detail?: string` |
| 3.6 | `src/index.ts` | edited | `export { default as KuiMenuList }` |
| 3.7 | `src/contextMenuModel.test.ts`, `src/tooltip.test.ts` | unchanged | Pure helpers; the extraction does not touch them |
| 3.8 | `package.json`, `src/floatingPosition.ts`, `src/tooltip.ts`, `src/modalFocus.ts`, `src/optionTypes.ts` | unchanged | The `./theme/controls.css` export already exists; positioning already accepts both an element and a point |

---

## 4. `packages/git-ui` and `apps/*`, file by file

| # | File | What |
|---|---|---|
| 4.1 | `src/theme/kira-structure.css` | D1 — `.kv-skin-kira` -> `:root`; `+--kv-control-h-sm`, `+--kv-control-inline-h`, `+--kv-shadow-dialog`; header rewritten (it is now the app's one scale, not a second one) |
| 4.2 | `src/theme/density.css` | D2 — reduced to `--kv-row-height{,-compact,-comfortable}` and `--kv-tree-indent`; header rewritten |
| 4.3 | `src/theme/vscode-tokens.css` | D4 — `+--kv-input-bg`, `+--kv-input-border`, `+--kv-border-strong`; one light-kind override |
| 4.4 | `src/theme/kui-bridge.css` | D3 — rewritten in full |
| 4.5 | `src/main.ts` | D1 — import order and comment refresh |
| 4.6 | `src/App.vue` | D2 rename (9 sites); `.kv-search-row` inset (D13); `.kv-boot-error-banner` now resolves (F5); `--kv-radius` -> `--kv-radius-sm` at `:1685`, `:1734` |
| 4.7 | `src/components/AppToolbar.vue` | D13 toolbar, separator and progress strips; D8 push menu -> `KuiMenuList`; D14 `variant="icon"` x3; the doc comment at `:15-16` rewritten |
| 4.8 | `src/components/PullStrategyPicker.vue` | D8 — panel -> `KuiMenuList`; `.kv-pull-picker-item*` deleted; the split-button corner radii kept |
| 4.9 | `src/components/BranchPicker.vue` | D14 — `.kv-icon-button` and `.kv-branch-trigger` deleted, trigger becomes `KuiButton` with `focus()`; `.kv-branch-row-main` composes `.kui-row`; `.kv-branch-section-title` takes `.kui-menu-heading`'s treatment; `.kv-branch-rename-input` -> `KuiTextInput` |
| 4.10 | `src/components/RepoPicker.vue` | `.kv-repo-item`/`.kv-repo-empty` compose `.kui-row`; `.kv-repo-list` padding -> `var(--kv-s-2)` |
| 4.11 | `src/components/UndoButton.vue` | D14 — `.kv-undo-button` deleted; `ghost` -> `icon`; `.kv-undo-sha` font-size -> `var(--kv-t-xs)` |
| 4.12 | `src/components/RefreshButton.vue` | `variant="icon"`; the 6px pending dot re-anchored inside the square box |
| 4.13 | `src/components/SearchBox.vue` | D2 rename; `.kv-search-error` -> D10's floating triple; `.kv-search-toggle`/`-count`/`-scope` -> `var(--kv-t-xs)` |
| 4.14 | `src/components/SearchResults.vue` | Option rows compose `.kui-row`; dropdown chrome -> D10's triple |
| 4.15 | `src/components/FileTree.vue` | `.kv-skin-kira` removed from the root; `.kv-file-tree-row` composes `.kui-row`; toolbar inset; `ghost` -> `icon`; `--kv-t-xs` fallbacks dropped; D17's `stopPropagation()` |
| 4.16 | `src/components/CommitMeta.vue` | `ghost` -> `icon` at `:236`, default at `:251`; D2 rename |
| 4.17 | `src/components/{StackList,StashList,GlobalStashList,TagList,WorktreeList}.vue` | `variant="icon"`; section headers take `.kui-menu-heading`'s treatment; D2 rename |
| 4.18 | `src/components/review/ReviewView.vue` | `.kv-skin-kira` removed from the root; the two filter-chrome blocks deleted; picker rows compose `.kui-row`; D2 rename |
| 4.19 | `src/components/review/ReviewCommentsPane.vue` | D14 — icon-button, row-delete and clear-confirm rules deleted |
| 4.20 | `src/components/review/ReviewCommitRow.vue` | D14/D15 — `.kv-review-row-action` deleted; the `<a>` wears `kui-button kui-button--icon` |
| 4.21 | `src/components/review/{BaseSelector,ReviewFilesPane}.vue` | `.kv-base-trigger` deleted; `.kv-base-row` composes `.kui-row`; D2 rename |
| 4.22 | `src/components/dialogs/*.vue` (13 files) | D2 rename and `--kv-radius` -> `--kv-radius-sm` only — no layout change |
| 4.23 | `src/components/{ConflictBanner,LoadMoreButton,NoRepositoryPanel,EmptyRepositoryPanel,GitBlockedPanel,DetailPane,StashDetailPane,CommitGrid}.vue` | D2 rename only |
| 4.24 | `src/components/rowMenuModel.ts` | D9 — ten icons |
| 4.25 | `apps/kira-studio/frontend/src/theme/kui-bridge.css` | D3/F15 — the other half of the contract |
| 4.26 | `scripts/check-tokens.sh` | D16 |
| 4.27 | `apps/kira-studio-vscode/tests/interaction/kui-floating-geometry.spec.ts` | D17 — the two-menu caveat at `:107-110` removed once the bubbling is fixed |
| 4.28 | Not edited | `packages/git-ipc`, `packages/git-core`, every `internal/*` Go package, `gitwire.fbs`, `webviewDocument.ts`, `html.ts`, `vite.config.ts`, `readTokens.ts` |

---

## 5. Dependencies and tooling

**Nothing new.** No package is added, removed or upgraded. `@floating-ui/dom` (already a `kira-ui`
dependency) is untouched. The build, the CSP and the manifest walk are unchanged — F2.

---

## 6. Implementation order

Each step is its own commit, and each is independently reviewable because the mechanical steps are
separated from the visual ones.

1. **D1 + D2 — the scale, no visual change.** Hoist `kira-structure.css` to `:root`, remove
   `.kv-skin-kira` from the two roots, rename all 226 `--kv-space-*` sites, prune `density.css`,
   migrate the 17 `--kv-radius` sites to `--kv-radius-sm`, drop the five `--kv-t-xs` fallbacks.
   `bun run lint && bun run typecheck && bun run test:webview` must pass **before** anything is
   restyled; the only intended rendering change in this commit is F5's banner.
2. **D4 + D16 — the new tokens and the guard.** Land the guard immediately after step 1, so every
   later step is checked by it.
3. **D3 — the bridge.** This is the commit where the app's proportions visibly change: control
   height becomes a token, radius becomes 4px, spacing indices realign, and F13's two gutters are
   pinned to `--kui-space-6`.
4. **D5 + D6 + D14** — `KuiButton` and the icon box in `kira-ui`, and the `git-ui` deletions, in one
   commit. They cannot be split: deleting `.kv-icon-button` before `variant="icon"` exists leaves
   unstyled buttons, and adding the variant first leaves the old override still winning on
   specificity.
5. **D7 — `.kui-row`**, then its seven call sites.
6. **D8 + D9 — `KuiMenuList`**, `KuiContextMenu`'s reduction, the two hand-rolled menus' adoption,
   `MenuItem.detail`, the ten icons.
7. **D10 + D11 + D12** — menu/popover/tooltip/modal chrome, segmented, inputs.
8. **D13 — the toolbar.**
9. **D15's restyles** — search dropdown, error popover, status strips, file-tree toolbar.
10. **D17** — the `stopPropagation()` and the spec comment.
11. Full check pass: `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run build:vscode`,
    `bun run test:webview`. Record the before/after CSS asset bytes in the final commit message.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `bun run lint` passes, **including** `scripts/check-tokens.sh`'s three passes (D16).
2. `bun run typecheck` passes — notably `vue-tsc` over both `packages/git-ui` and `packages/kira-ui`.
3. `bun run test:unit` passes, with `vueComponentImports.test.ts`, `rowMenuModel.test.ts` and
   `contextMenuModel.test.ts` unchanged.
4. `bun run build:vscode` succeeds and the emitted manifest still lists a CSS chain reachable from
   `apps/kira-studio-vscode/src/webview/main.ts` (i.e. `collectCss` still resolves it).
5. `bun run test:webview` passes — both the `webview-layout` and `webview-interaction` projects,
   with only `kui-floating-geometry.spec.ts`'s D17 comment/locator edit.
6. `grep -rn 'kv-space-' packages/` returns nothing.
7. `grep -rn 'kv-skin-kira' packages/ apps/` returns nothing.
8. `grep -rn 'variant="ghost"' packages/` returns nothing, and no `.vue` template under
   `packages/git-ui/src` contains a literal `<button`.
9. The built CSS asset's raw and gzip size, before and after the whole phase, recorded in the final
   commit message. F3 predicts a delta inside ±3 KB raw; a materially larger one means something was
   duplicated rather than replaced and is worth investigating before merge.
10. `kira-structure.css` still contains no hex literal, no `rgb(`, and no
    `color`/`background`/`border-color` property — D1's carried-forward G12 D14 guarantee.
11. No `.kv-*` rule anywhere declares `height`, `padding`, `border` or `border-radius` on an element
    that is a `KuiButton` (the F9 class of defect), verified by reading each remaining `.kv-*-button`
    /`-trigger`/`-action` rule.

### 7.2 Tier 2 — reasoned check

12. A read of `webviewDocument.ts` confirms no CSP directive needed changing and no new `<link>`
    source was introduced (F2).
13. Every `data-testid` present before this phase is still present after it — in particular
    `force-push-trigger`, `pull-strategy-default`, `pull-strategy-<strategy>`,
    `push-overflow-trigger`, `remote-cancel`, `worktree-prepare-cancel`, `review-filter-toggle`,
    `search-toggle-*`, `search-scope`, `review-back-button`, `review-swap-button`.
14. Every menu built by `rowMenuModel.ts` has an icon on every item (D9's table), and `KuiMenuList`
    renders the box unconditionally, so no menu shows ragged labels.

### 7.3 Tier 3 — needs a human to look at it

15. Open the graph panel beside a Kira Studio window: toolbar height, button padding, corner radius,
    separator height and icon weight read as the same app.
16. Right-click a commit row, then open the Push overflow and the Pull strategy menu: all three are
    the same menu — same inset, same row height, same rounded hover, same shadow.
17. Arrow keys, `Home`/`End`, `Enter` and `Escape` work in the Push and Pull menus (they did not
    before D8).
18. Raise VS Code's font size: controls grow with the text instead of clipping it (D3's
    `--kui-control-h` token change).
19. Switch to a light theme and to a high-contrast theme: `--kv-input-bg`, `--kv-border-strong` and
    every restyled surface still read correctly (D4's light-kind override is the one place this
    could go wrong).
20. Right-click a file row inside an expanded review row: exactly one menu opens (D17).

### 7.4 The checklist

- [ ] One scale: `kira-structure.css` at `:root`, `--kv-space-*` gone, `.kv-skin-kira` gone.
- [ ] `density.css` holds only three row heights and the tree indent; `readTokens.ts` still resolves.
- [ ] `--kui-control-h` is a token, not a literal; `--kui-radius` is 4px; `--kui-radius-float` is 6px.
- [ ] The `--kui-space-5` reindexing did not shrink the search/select gutters (F13).
- [ ] One button: `.kui-button` plus `--icon`; no `.kv-*` rule re-declares a button's box.
- [ ] One row: `.kui-row`; the seven implementations F8 found are one.
- [ ] One menu: `KuiMenuList` renders the right-click menu, the Push menu and the Pull menu.
- [ ] Icons are 13px in a 16px box, everywhere, from two declarations.
- [ ] Every menu item has an icon; the icon box is unconditional.
- [ ] `check-tokens.sh` covers `--kv-*` and `--kui-*`, and fails on a deliberately-introduced
      undefined token (verify once, then revert the probe).
- [ ] Both hosts' `kui-bridge.css` define every `--kui-*` that `controls.css` references.
- [ ] No colour value changed meaning; the panel still follows the user's VS Code theme.

---

## 8. Explicit non-goals for G34

Kira Studio's fixed Dark Modern colour palette (`apps/kira-studio/frontend/src/theme/tokens.css`) —
the panel follows the user's VS Code theme (G12 D14), not revisited. Importing
`primitives.css`/`tokens.css` across the app boundary. The commit grid's SlickGrid chrome, its
column headers, its graph column and its row height. Ref badges and the PR badge palette. The diff
surfaces. Dialog *content* layout beyond the scale rename. Submenus (`KuiContextMenu` declined them
at G19 D3 and nothing needs one). A `Kui*` tree, listbox, badge, chip or status primitive. Keyboard
shortcuts rendered inside menu rows (Kira's `.shortcut` slot — this app's menus have no per-item
chords). Any `CONTRACT_VERSION`, wire, contract or Go change. A dedicated unit test for any of this:
it is styling and markup, which `CLAUDE.md`'s testing bar excludes by name; the two existing
Playwright tiers plus D16's lint guard are the coverage. `docs/v1.3/SPEC.md`.

---

## 9. Handed forward

`--kui-fg-subtle` is bridged to `--kv-description-fg` because `packages/git-ui` has two foreground
tiers where Kira has four (`fg`/`fg-muted`/`fg-subtle`/`fg-disabled`); a later phase wanting Kira's
exact tertiary/disabled separation needs two new `--vscode-*`-derived tokens first, WCAG-checked
against both theme kinds the way `vscode-tokens.css`'s light block already does. `KuiMenuList` has
no submenu and no per-item shortcut slot — both are one-file additions if a later phase needs them.
`.kui-row` is now the natural home for a `KuiTree`/`KuiListbox` if a second consumer ever appears;
today `SearchResults.vue` and `FileTree.vue` are one consumer each, which is below the bar.
`apps/kira-studio/frontend` still consumes none of `packages/kira-ui`; the bridge is complete again,
so the first Studio component to adopt a `Kui*` will find the contract satisfied.
`AppToolbar.vue` has no overflow behaviour at narrow widths — the buttons simply run out of room.
Kira's own toolbars have the same gap, so it is not a *parity* defect, but it is a real one.

---

## 10. Human-eye decisions — with a recommendation for each

*This phase runs autonomously; each recommendation below is the decision that will be taken unless a
human overrides it. The plan is reviewed first, so these are the places to push back.*

**10.1 — Renaming all 226 `--kv-space-*` sites rather than aliasing them.** The cheaper alternative
is to define `--kv-space-3: var(--kv-s-4)` and friends in `kira-structure.css` and migrate call
sites opportunistically. **Recommendation: do the full rename (D2).** It is value-identical (F4),
collision-free, verifiable by one grep, and it is the only version of "one scale" that is actually
true afterwards — an alias layer leaves two names for one thing and a coin-flip for the next author,
which is precisely the state the G-UX batch handed this phase. The cost is a wide but shallow diff
across files this phase is already touching. If the diff width is genuinely unacceptable, the alias
layer is the fallback and everything else in this plan still stands unchanged.

**10.2 — The toolbar drops from 35px to 34px.** **Recommendation: 34px, via `--kv-bar-h` (D13).**
`AppToolbar.vue:15`'s stated 35px rationale — matching VS Code's panel title bar — does not hold:
that bar is outside the webview's iframe, so there is no shared edge to align to, and a literal
cannot track the user's font size while everything inside the bar does. It is also what the review
sidebar's own toolbar already uses, so this makes the two bars agree rather than making them differ.

**10.3 — `--kv-radius: 0` is deleted, and controls become 4px-rounded.** This overturns
`density.css:17`'s explicit "the workbench has square corners; we do not invent rounded ones."
**Recommendation: delete it (D4).** That comment states a *workbench* law; this phase's charter
states a *Kira Studio* law, and they disagree. The user asked for the latter by name. If a reviewer
prefers square corners in the graph panel, the one-line override is `--kui-radius: 0` in
`kui-bridge.css` — but then the panel will not look like Kira Studio, which was the request.

**10.4 — `.kui-button`'s resting text colour becomes `--kui-fg-muted`.** Kira's toolbar buttons are
muted until hovered. **Recommendation: adopt it (D5).** After spacing, this is the largest single
contributor to "the proportions and design are off", and the hover rule restores full contrast the
moment a pointer lands. Contrast note: `--kv-description-fg` is the token `vscode-tokens.css`
already WCAG-checked for both theme kinds (`:141`, `:190`), and every affected element is an
interactive control with its own accessible name.

**10.5 — `variant="ghost"` is retired rather than kept alongside `icon`.** **Recommendation: retire
it (D5).** Once `.kui-button` is itself borderless and muted, `ghost` differs only by
`opacity: 0.8`, which is a worse way of saying "muted" than a colour token is. Four call sites move.

**10.6 — The context-menu `max-width` stays at 320px while `min-width` drops to Kira's 180px.**
Kira's own menu has no `max-width` at all. **Recommendation: keep the cap (D10).** Uncapped, this
app's commit menu ("Checkout this commit (detached HEAD)") would be visibly wider than its file menu
("Copy path"), and a menu whose width changes per row is a worse artifact than one ellipsis.

**10.7 — `MenuItem.detail` renders as a second line, not as Kira's right-aligned `.shortcut` slot.**
**Recommendation: second line (D8).** Kira's slot holds key chords; the only producer here holds a
sentence ("Merge — from `pull.rebase` in your repository config") that would truncate to nothing at
the right edge of a 260px panel.

**10.8 — `BranchPicker.vue`'s last raw `<button>` becomes a `KuiButton` via a new `focus()` expose,
rather than keeping the raw element and giving it `class="kui-button"`.** **Recommendation: expose
`focus()` (D5/D14).** It is three lines, it matches `KuiSearchInput`'s existing precedent for the
identical structural problem, and it leaves the package with zero hand-written buttons — which is
the property that keeps this phase's result from decaying back into F9.

**10.9 — Fixing `FileTree.vue`'s double-menu bubbling here (D17).** It is an event-handler bug, not
a style bug. **Recommendation: fix it.** Two stacked context menus is exactly the visual complaint
this phase exists to answer, the fix is one call, and its own test file already documents it as
knowingly unfixed — leaving it would mean shipping a "context menus now look right" phase in which
right-clicking a file still opens two of them.

**10.10 — Extending `scripts/check-tokens.sh` rather than adding a stylelint dependency.**
**Recommendation: extend the script (D16).** The repo has no stylelint and the script's own comment
already explains why (not in this toolchain); a third grep-and-`comm` pass costs about ten lines and
closes F5's class of defect permanently. Adding a linter to the toolchain for one rule is the wrong
trade, and `CLAUDE.md`'s "reach for a library" rule is about non-trivial infrastructure, which a
`comm` of two sorted greps is not.

---

### Critical files for implementation

- `packages/git-ui/src/theme/kui-bridge.css`
- `packages/git-ui/src/theme/kira-structure.css`
- `packages/kira-ui/src/theme/controls.css`
- `packages/git-ui/src/components/AppToolbar.vue`
- `packages/kira-ui/src/KuiContextMenu.vue`
