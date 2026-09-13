# G34 — Kira Studio visual-language parity for the git webviews

`docs/v1.3/plans/G34-kira-studio-styling-parity.md`

> **What this phase is.** This is `SPEC.md`'s **G34** — depends on **G19, G20, G21**. Its row is one
> sentence of real-usage feedback, verbatim: *"Components should look like in Kira Studio, The main
> toolbar, the right click, as it now has different proportions and design and everything is off."*
> The row was filed *Not designed at all*, in the placeholder-then-design style G25/G26/G28 already
> use, with four questions handed to this planning pass: which git-ui elements get replaced with
> real `Kui*` components and which genuinely stay bespoke; whether the webview can consume
> `packages/kira-ui`'s real tokens/CSS at all under VS Code's webview isolation and CSP; what that
> costs against `docs/PERF.md`'s first-paint budget; and how the toolbar's and the file trees' two
> density scales get reconciled without breaking either surface.
>
> The immediately-preceding batch (`docs/v1.3/plans/graph-review-ux-fixes.md`, implemented and
> shipped, HEAD `a89c8b2c`) declared this work a non-goal and handed forward exactly one note: that
> `.kv-toolbar` and `.kv-skin-kira` are *two coexisting density scales by deliberate design*
> (G12 D14 / G21 D11), and that unifying them piecemeal would make this phase harder. §1 below is
> that unification's diagnosis; §2 D1 is the reconciliation.
>
> **Two of the four handed-forward questions have answers that change the shape of this plan and
> should be read before anything else:**
>
> 1. **The webview already consumes `packages/kira-ui`'s real components and real CSS.** There is no
>    isolation problem, no CSP problem, no bundling problem, and nothing here is a bespoke lookalike
>    of a `Kui*` component. Every context menu in git-ui is already a `KuiContextMenu`; every
>    dropdown but two is already a `KuiPopoverPanel`; there are 121 `KuiButton` call sites. The
>    webview looks wrong for a *different* reason (F1–F9), and a plan built on the isolation
>    hypothesis would have solved a problem this repo solved in G19/G20/G21.
> 2. **`packages/kira-ui` is not "Kira Studio's canonical shared library used throughout the main
>    app."** `apps/kira-studio/frontend` imports it **nowhere** — its own
>    `theme/kui-bridge.css:5-7` says so in as many words ("nothing in this app's own UI imports
>    `@kira/kira-ui` yet … this file alone stays inert until something does"), and a grep confirms
>    it. `kira-ui` was extracted *for git-ui*. The real Kira Studio visual language lives in
>    `apps/kira-studio/frontend/src/theme/primitives.css` (1091 lines, `.p-toolbar`/`.p-btn`/
>    `.p-iconbtn`/`.p-row`/`.p-float`/`.p-sep`/`.p-seg`/`.p-input`) over
>    `theme/tokens.css`. **"Look like Kira Studio" therefore means: measured against
>    `primitives.css`, delivered through `kira-ui`.** That is the axis every decision below is on.
>
> `docs/v1.3/SPEC.md` is **not** edited by this plan — the G34 row already exists.

---

## 0. Baseline

Authored against `claude/feature-v1-3-headless-git` at **`a89c8b2c`** ("test(vscode): interaction
coverage for the nine ux fixes") — the tip of the graph/review UX-fixes batch's twelve commits.
Working tree clean; every `file:line` below was produced by reading that tree in this container on
2026-09-09.

State that matters going in:

* `CONTRACT_VERSION` is **31** (`packages/git-ipc/src/validate.ts:102`,
  `apps/kira-studio/internal/gitrpc/contract.go:114`). *(`docs/ARCHITECTURE.md:2170` still says 30 —
  stale since that batch's bump. Noticed, not this phase's job; see §7.)*
* `packages/kira-ui` exports `KuiButton`, `KuiIconBox`, `KuiTextInput`, `KuiSearchInput`,
  `KuiSelect`, `KuiSegmented`, `KuiDialog`, `KuiContextMenu`, `KuiPopoverPanel`, `KuiTooltip`, plus
  `contextMenuModel.ts` / `floatingPosition.ts` / `tooltip.ts` / `modalFocus.ts`, and one stylesheet
  — `src/theme/controls.css` (422 lines).
* `packages/git-ui` loads that stylesheet in its single entry
  (`packages/git-ui/src/main.ts:16-20`): `kui-bridge.css`, then
  `@kira/kira-ui/theme/controls.css`, then `kira-structure.css`.
* Every `<style>` block in `packages/git-ui/src/**/*.vue` is **unscoped** — checked, all 24 of them.
  A rule written in one component is a global rule. This is the existing convention and this plan
  keeps it; it is also the mechanism behind F8.

---

## 1. Findings — what is actually different, measured against `primitives.css`

### F1 — The webview has *two* structural scales, and the graph panel is on the wrong one

This is the note the prior batch handed forward, now diagnosed.

`packages/git-ui/src/theme/density.css:5-24` — the **workbench scale**, at `:root`:

```css
--kv-row-height: 22px;
--kv-space-1: 2px;  --kv-space-2: 4px;  --kv-space-3: 8px;
--kv-space-4: 12px; --kv-space-5: 16px;      /* five steps — no 6px */
--kv-toolbar-height: 35px;
--kv-radius: 0px; /* the workbench has square corners; we do not invent rounded ones */
--kv-tree-indent: 8px;
```

`packages/git-ui/src/theme/kira-structure.css:14-77` — **Kira Studio's scale**, transcribed from
`apps/kira-studio/frontend/src/theme/tokens.css` by G12 D14 and scoped to a class:

```css
.kv-skin-kira {
  --kv-s-1..6: 2/4/6/8/12/16px;              /* six steps — the 6px the other scale lacks */
  --kv-t-xs/sm/md/lg: calc(--kv-font-size -2/-1/+0/+1 px);
  --kv-h-xs/sm/md/lg: 18/22/26/30px (font-size-derived);  --kv-icon-box: 16px;
  --kv-control-h: var(--kv-h-sm);  --kv-control-h-lg: var(--kv-h-md);
  --kv-radius-sm: 4px;  --kv-radius-panel: 6px;
  --kv-bar-h: 34px;  --kv-border-width: 1px;
  --kv-font-ui / --kv-font-data;             /* LAW 08's two roles */
  --kv-shadow: 0 2px 8px;                    /* geometry only */
}
```

`.kv-skin-kira` is applied in exactly **two** places: `ReviewView.vue:631` (the whole review
sidebar) and `FileTree.vue:409` (both file trees). `App.vue:1321`'s `.kv-app` — the graph panel,
which owns the *main toolbar* the user named — **never carries it**. That is the split, stated
precisely, and it is why the review sidebar's own toolbar
(`ReviewView.vue:1089-1098`) is already Kira-shaped —

```css
.kv-review-toolbar { gap: var(--kv-s-3); height: var(--kv-bar-h); padding: 0 var(--kv-s-4); border-bottom: var(--kv-border-width) …; }
```

— while the graph toolbar (`AppToolbar.vue:385-394`) is not:

```css
.kv-toolbar { gap: var(--kv-space-2); height: var(--kv-toolbar-height); padding: 0 var(--kv-space-3); border-bottom: 1px solid …; }
```

Reading the two against `.p-toolbar` (`primitives.css:744-761`, `height: --kira-toolbar-h` 34px,
`gap: --kira-s-3` 6px, `padding: 0 --kira-s-4` 8px, `border-bottom: --kira-border-width`): the
review toolbar is an exact port; the graph toolbar is 35px tall with a 4px gap and a literal
border. **The two bars in the same product are one pixel and one gap step apart, and only one of
them was ever meant to be.**

The scales are *additive*, not conflicting — `kira-structure.css` introduces only names
`density.css` does not define, and vice versa. That is the property D1 relies on.

### F2 — The split already leaked, and five declarations are silently dead in the shipped build

`App.vue:1693-1713`, added by G14 D3, inside `.kv-app` — which never carries `.kv-skin-kira`:

```css
.kv-boot-error-banner {
  gap: var(--kv-s-2);                                    /* undefined here */
  padding: var(--kv-s-2) var(--kv-s-3);                  /* undefined here */
  border-bottom: var(--kv-border-width) solid var(--kv-panel-border);   /* undefined here */
  font-family: var(--kv-font-ui);                        /* undefined here */
}
.kv-boot-error-banner button { border-radius: var(--kv-radius-sm); }    /* undefined here */
```

An unresolvable `var()` with no fallback makes the whole declaration invalid at computed-value
time, so today that banner renders with **no padding, no gap, no bottom border, the wrong font
family and square corners** — none of which its author intended. `scripts/check-tokens.sh` cannot
see this: it only covers `apps/kira-studio/frontend/src` and greps `--kira-*`, and even pointed at
git-ui it would find `--kv-s-2` *defined* (it just cannot know the definition is class-scoped).

This is the failure mode the prior batch's note predicted. It is one banner today; it is a standing
trap for every future author for as long as two scales coexist in one document.

### F3 — `KuiButton`'s default is not a Kira Studio button, and 72 of 121 call sites work around it

`controls.css:34-47`:

```css
.kui-button {
  gap: var(--kui-space-1, 2px);  height: var(--kui-control-h, 22px);
  padding: 0 var(--kui-space-2, 4px);
  color: var(--kui-fg, inherit);
  border: 1px solid var(--kui-border, transparent);   /* ← a visible border, at rest */
  border-radius: var(--kui-radius, 0);
  font-size: inherit;
}
```

Against `.p-btn` (`primitives.css:70-81`) — Kira Studio's toolbar button:

| | `.kui-button` in the webview | `.p-btn` |
|---|---|---|
| border at rest | **`1px solid var(--kv-panel-border)`** (a real, visible line — `--kui-border` is bridged to `--kv-panel-border`, `kui-bridge.css:12`) | **none** |
| radius | `var(--kv-radius)` = **0px** | `--kira-radius-sm` = **4px** |
| horizontal padding | `--kui-space-2` → `--kv-space-2` = **4px** | `--kira-s-3` = **6px** |
| gap | `--kui-space-1` = **2px** | `--kira-s-2` = **4px** |
| colour at rest | `--kui-fg` (**full-strength** foreground) | `--kira-fg-muted` |
| font size | `inherit` (**13px**, the body size) | `--kira-t-sm` (**one step down**) |

So every toolbar control in the git panel is a full-strength, body-sized label inside a
square-cornered bordered box. Kira Studio's is a muted, one-step-smaller label in a borderless
4px-rounded hit area that only paints on hover. That single row of the table is most of "different
proportions and design."

**The call sites already know.** Of 121 `<KuiButton` usages in `packages/git-ui/src`, **72** carry a
`class=` override, and four of those overrides exist specifically to *undo* the border:

* `.kv-icon-button` (`BranchPicker.vue:621-631`) — `background: transparent; border: none; padding: var(--kv-space-1)`. Defined in `BranchPicker.vue`'s global style block but consumed by `AppToolbar.vue:339/351/372`, `TagList.vue:105` and `GlobalStashList.vue:113`. It is not square, so it is not `.p-iconbtn` either — just padding.
* `.kv-undo-button` (`UndoButton.vue:60-73`) — re-declares `height: 22px; padding: 0 var(--kv-space-2); border: none; border-radius: var(--kv-radius); font-family: inherit; font-size: inherit`, i.e. the whole of `.kui-button` again, minus the border.
* `.kv-branch-trigger` (`BranchPicker.vue:504-518`) — the same declaration list again, on a genuinely raw `<button>` (kept raw for a real reason: `closeForCheckout()` calls `.focus()` on `triggerEl`, and `KuiButton` exposes no root ref — `BranchPicker.vue:321-324`, G21 D2).
* `.kv-review-picker-row` (`ReviewView.vue:~1007-1015`) — `border: none; background: transparent`.

Four independent hand-rolls of "a `.kui-button` without its border" is the shared component's
default being wrong, not four call sites being sloppy.

### F4 — Icons are one whole size step too large

`controls.css:21-32`: `.kui-icon-box` is `var(--kui-control-h, 22px)` square and its glyph is
`font-size: 16px`. Kira Studio's `.icon-box` (`primitives.css:25-32`) is `var(--kira-icon-box)` =
**16px** square, and every consumer renders the glyph at **13px** — `AppButton.vue` and
`IconButton.vue` both hard-default `:size="13"`, and `ContextMenu.vue` passes `:size="13"` at all
six of its `<CodiconIcon>` sites.

git-ui partially patches this (`controls.css:49-52` and `:159-163` narrow the box to 16px inside
buttons and menu items) but never touches the **glyph**, which stays 16px everywhere. A 16px glyph
in a 16px box against a 13px glyph in a 16px box is the difference between "icon fills its cell" and
"icon sits in its cell", and it is visible on every button and every menu row in both panels.

### F5 — The context menu is the right *component* with the wrong *geometry*

Every right-click menu in git-ui already routes through `KuiContextMenu`:
`RowContextMenu.vue` is a 37-line pass-through wrapper over it (G19 D3b), used by
`App.vue:1529/1538/1548`, `BranchPicker.vue:487`, `StashList.vue:138`, `GlobalStashList.vue:127`,
`TagList.vue:119`, `ReviewCommitRow.vue:267`; `FileTree.vue:551` uses `KuiContextMenu` directly.
There is **no** hand-rolled menu anywhere. So the user's "the right click" is a pure styling
finding, and it is a big one:

| | `.kui-menu-*` (`controls.css:131-199`) | Kira Studio (`ContextMenu.vue:341-355` + `.p-float`/`.p-row`/`.p-sep`/`.p-menu-label`) |
|---|---|---|
| surface radius | `var(--kui-radius)` → **0px** | `--kira-radius` = **6px** (`.p-float`, `primitives.css:640-646`) |
| surface border | `--kui-border` → `--kv-panel-border` | `--kira-border-strong` (`.p-float`) |
| surface shadow | **hardcoded** `0 2px 8px rgba(0,0,0,.36)` | `--kira-shadow-dialog` |
| surface padding | `2px 0` (**no horizontal inset**) | `--kira-s-2` = **4px, all round** |
| min-width | **220px** | **180px** |
| row height | none — `padding: 2px 8px`, so height is whatever the line box is | `.p-row`: **`height: --kira-control-h`** (22px), `padding: 0 --kira-s-3` |
| row radius | none | `.p-row`: `--kira-radius-sm` = **4px** |
| row gap | none (rows abut) | **1px** (`ContextMenu.vue:353`) |
| separator | `height: 1px; margin: 2px 0` on `--kui-border` | `.p-sep`: `--kira-border-width` on `--kira-border-strong`, `margin: --kira-s-2 0` |
| heading | bold + a **bottom border** | `.p-menu-label`: `--kira-control-h-sm` tall, uppercase, `--kira-t-xs`, `--kira-fg-subtle`, **no border** |

A square-cornered, 220px-wide, edge-to-edge-padded box of abutting rows against a 6px-rounded,
180px, inset box of 22px rounded rows with 1px between them. Same behaviour, different object.

**What is *not* missing:** submenus, a shortcut column and a checked column. `ContextMenu.vue` has
all three; `KuiContextMenu` has none, deliberately (G19 D3's stated non-goal, `KuiContextMenu.vue:10-11`).
Checked against every git-ui menu producer — `rowMenuModel.ts`'s `MenuSection`/`MenuItem` has no
`submenu`, no `shortcut` and no `checked` member, and no `contributes.keybindings` entry maps to a
menu item — so all three are correctly absent and stay absent (§7).

### F6 — The two `kui-bridge.css` files disagree about what the shared vocabulary means

`controls.css` is written against `--kui-*` and never references `--kv-*` or `--kira-*`; each host
bridges. The two bridges do not agree:

| `--kui-*` | git-ui (`kui-bridge.css:20-24`) | main app (`kui-bridge.css:22-25`) |
|---|---|---|
| `--kui-space-1` | `--kv-space-1` = 2px | `--kira-s-1` = 2px ✅ |
| `--kui-space-2` | `--kv-space-2` = 4px | `--kira-s-2` = 4px ✅ |
| `--kui-space-3` | `--kv-space-3` = **8px** | `--kira-s-3` = **6px** ❌ |
| `--kui-space-4` | `--kv-space-4` = **12px** | `--kira-s-4` = **8px** ❌ |
| `--kui-space-5` | `--kv-space-5` = 16px | **not bridged** — falls back to `controls.css`'s literal |
| `--kui-control-h` | **literal `22px`** (`:19`) | `var(--kira-control-h)` — font-size-derived |
| `--kui-radius` | `--kv-radius` = **0px** | `--kira-radius-sm` = **4px** |

The spacing rows are a direct consequence of F1: `--kv-space-*` has five steps and no 6px, so
`--kui-space-3` cannot mean what it means on the other side. `--kui-control-h` as a literal is the
same defect G14 D7 already fixed on the review side — raise VS Code's font size and every shared
control stops growing with its text.

The main app's bridge is inert (nothing there imports `kira-ui`), so this has never rendered wrong
*there*. It is still a live contract violation and it is why the shared components cannot be made to
look like Kira Studio without touching it.

### F7 — Ten hand-rolled dropdown rows, none of them `.p-row`

Every dropdown is already a `KuiPopoverPanel` (G20 D5) — the *surface* is shared. The **rows inside**
are not; each list re-declares `padding: var(--kv-space-1) var(--kv-space-3)` or
`var(--kv-space-1) var(--kv-space-2)` with no height, no radius and its own hover rule:

`RepoPicker.vue:137` (`.kv-repo-item`), `BranchPicker.vue:560` (`.kv-branch-row`) and `:643`,
`SearchResults.vue:184` (`.kv-search-option`), `PullStrategyPicker.vue:180`,
`review/BaseSelector.vue:240` and `:252`, `ReviewView.vue:987`/`:1007`/`:1022`, `StackList.vue:167`.

`primitives.css:505-521`'s `.p-row` is one rule — 22px tall, `--kira-s-3` inset, `--kira-s-2` gap,
`--kira-radius-sm`, `:hover → --kira-hover`, `.is-selected → --kira-select` — and Kira Studio uses
it for tree rows, operations rows *and* menu rows, on purpose (`ContextMenu.vue:357-358`: "Rows share
the tree/operations-list row primitive (P8) so a menu row and a tree row highlight identically").
git-ui has ten variants of it and none matches.

### F8 — The dialog field/note/error rules are defined 28 times, globally, and disagree

Every `<style>` block in git-ui is unscoped, and thirteen dialogs each declare their own copy of the
same shared classes:

| class | definitions |
|---|---|
| `.kv-dialog-field` | **8** |
| `.kv-dialog-field--inline` | **6** |
| `.kv-dialog-note` | **12** |
| `.kv-dialog-error` | **8** |

Because they are global, exactly one copy of each wins for the whole bundle, decided by Vite's CSS
concatenation order. **They are not all identical**: `StackDialog.vue:215` sets
`.kv-dialog-note { color: var(--kv-description-fg) }` while the other eleven set
`color: var(--kv-diff-deleted-fg)`. So `StackDialog`'s note is painted by whichever file happens to
land last, not by `StackDialog`. And the winning colour is *diff-deleted red* for a class whose
actual users are explanatory notes — e.g. `RepoSettingsDialog.vue:106`'s "this setting is
instance-wide" scope note, which is not an error.

The field inputs themselves (`.kv-dialog-field input[type='text'], textarea`) are
`padding: 2px 4px; border: 1px solid var(--kv-panel-border); font-family: inherit` — no height, no
radius, no input background. `.p-input` (`primitives.css:137-153`) is `--kira-control-h` tall,
`--kira-s-4` inset, `--kira-radius-sm`, on `--kira-bg-input`, at `--kira-t-sm`.

### F9 — LAW 08 stops at the review panel's boundary

`kira-structure.css:51-59` carries the design system's LAW 08 verbatim — *"Mono is for data. If a
string came out of a database — a value, an identifier, a query, a duration — it is mono. If the app
wrote it, it is UI."* — and the review side applies it: `ReviewView.vue:915` sets `--kv-font-ui` on
its root, `:1066` sets `--kv-font-data` on the branch name with the law quoted inline, and
`FileTree.vue:633/642/721` sets `--kv-font-ui` on tree chrome with `:676` mono for the status letter.

The graph panel applies none of it. `App.vue:1638-1644` and `CommitGrid.vue:895-906` both set
`font-family: var(--kv-font-family)` — one family for chrome, ref names, dates and paths alike —
because `--kv-font-ui`/`--kv-font-data` do not resolve there (F1). Two panels in one product, one
following the law and one not.

### F10 — What is *not* wrong: isolation, CSP, fonts, bundling, and the components themselves

Checked directly, because the SPEC row asks and because the opposite would have changed everything:

* **`packages/kira-ui` is a real workspace dependency of `packages/git-ui`**
  (`packages/git-ui/package.json`: `"@kira/kira-ui": "workspace:*"`), and its stylesheet is a real
  export (`packages/kira-ui/package.json`: `"./theme/controls.css"`), imported once at
  `packages/git-ui/src/main.ts:17`. Vite bundles it into the webview stylesheet the extension
  serves; `webviewDocument.ts:37-40`'s `collectCss` walks the chunk graph and emits a `<link>` for
  it. **The webview already has the real thing.**
* **CSP is not implicated.** `webviewDocument.ts:65-77` emits
  `style-src ${cspSource} 'unsafe-inline'` and `font-src ${cspSource}` — extension-origin
  stylesheets and fonts are both allowed, which is how `@vscode/codicons`' `codicon.ttf`
  (`icons/codicon.css:5-9`) already loads.
* **No webfont is needed and none is proposed.** `--kv-font-ui` resolves to
  `var(--vscode-font-family, <system stack>)` and `--kv-font-data` to `--kv-mono-font-family` =
  `var(--vscode-editor-font-family, …)`. Both are host-injected values on locally-installed
  families. Kira Studio's own `--kira-font-ui` is a system stack too (`tokens.css:124-126`).
* **No `Kui*` lookalike exists to replace.** Every menu is `KuiContextMenu`; every dialog is
  `KuiDialog` (13 of them); every dropdown but two is `KuiPopoverPanel`; segmented groups are
  `KuiSegmented`; filters are `KuiSearchInput`. The two exceptions are documented and legitimate:
  `SearchResults.vue:47-58` (an ARIA combobox listbox that must not sit inside `KuiPopoverPanel`'s
  capture-phase `Escape` handler) and `BranchPicker.vue:321-324`'s raw trigger (F3).

So the SPEC row's "whether/how the webview can consume kira-ui's real tokens/CSS given VS Code's
webview isolation" resolves to: **it already does; the tokens it consumes are the wrong values.**
That is a much better problem to have, and it is what §2 fixes.

---

## 2. Decisions

### D1 — One structural scale, at `:root`. `.kv-skin-kira` is retired

`kira-structure.css`'s block moves from `.kv-skin-kira` to `:root`; the class attribute is removed
from `ReviewView.vue:631` and `FileTree.vue:409`; the file's header comment is rewritten to record
why the scoping existed (G12 §12.2 resolved item 9 as *the review sidebar only*, and explicitly
recorded "the graph panel keeps the workbench one") and why G34 overturns it (the user's ask names
the *main toolbar*, which is the graph panel's). Two tokens are added while the file is open:
`--kv-control-h-sm: var(--kv-h-xs)` (Kira's chip/badge density role) and
`--kv-control-inline-h: 14px` (`--kira-control-inline-h`, the toolbar separator's height).

**This commit is provably rendering-neutral except for F2's bug fix**, and that is the point of
doing it first and alone. `kira-structure.css` declares only names `density.css` does not, and
vice versa (verified name by name), so promoting the block's scope cannot change any value that
already resolved. Two consequences, both intended:

* Every descendant of `.kv-app` can now resolve `--kv-s-*`/`--kv-t-*`/`--kv-radius-sm`/`--kv-font-ui`.
  `.kv-boot-error-banner`'s five dead declarations start working (F2).
* A `check-tokens.sh`-style guard becomes *sound* for `packages/git-ui` for the first time — with
  one scale at one scope, "is this name defined?" is the whole question. D2 is that guard.

There are no `.kv-skin-kira <descendant>` compound selectors anywhere (the last one,
`ReviewView.vue`'s `.kv-file-tree-status` override, was deleted by G21 D11), and no test queries the
class — both verified — so removing it is safe rather than merely tidy.

**Alternative considered:** put `.kv-skin-kira` on `.kv-app` as well, keeping the class. Rejected: a
class applied to every root is a `:root` selector with extra steps, and it leaves the same trap for
the next author who writes a rule outside a root (F2 was exactly that). `CLAUDE.md`'s "scope left
out is left out entirely, not half-implemented" points the same way.

### D2 — `scripts/check-tokens.sh` grows to cover `--kv-*` and `--kui-*`

The existing script (`scripts/check-tokens.sh`, wired into `bun run lint` via `package.json:27`) is a
grep-and-`comm` guard proving every bare `var(--kira-…)` in `apps/kira-studio/frontend/src` resolves
to a real definition. Two more passes, same shape, same file:

* `--kv-*` used in `packages/git-ui/src` ⊆ defined in `theme/{vscode-tokens,density,kira-structure}.css`.
* `--kui-*` used in `packages/kira-ui/src` ⊆ defined in **both** `kui-bridge.css` files.

The second pass is the direct guard against F6, and it is the reason this lands at commit 2 rather
than at the end: every commit from 3 onward is checked by it. Its blind spot is the existing one and
is fine — a `var()` carrying a fallback is legitimate and skipped by construction, which is exactly
how `controls.css` is written for an unbridged host.

*Not* a new dependency: stylelint is still not in this repo's toolchain, and the script's own header
comment already says why.

### D3 — `--kv-space-*` folds into `--kv-s-*`; `--kv-radius: 0` gives way to the two tiers

With one scale at one scope, two spellings of "spacing" in one document is exactly the duplication
G19 D3 and G21 D2 kept closing. `--kv-space-*` (240 references across `packages/git-ui/src`) is
renamed mechanically and deleted from `density.css`:

| from | to | value |
|---|---|---|
| `--kv-space-1` | `--kv-s-1` | 2px |
| `--kv-space-2` | `--kv-s-2` | 4px |
| `--kv-space-3` | `--kv-s-4` | **8px** |
| `--kv-space-4` | `--kv-s-5` | 12px |
| `--kv-space-5` | `--kv-s-6` | 16px |

Every substitution is value-preserving, so the rename renders byte-identically; what it buys is
`--kv-s-3` (6px) becoming *available*, which is what D6's toolbar needs and what
`.kv-toolbar`'s 4px gap could not express.

Separately, `--kv-radius: 0px` is deleted and its **36** references in `packages/git-ui/src` are
re-pointed per site to Kira's own two tiers — `--kv-radius-sm` (4px) for controls, `--kv-radius-panel`
(6px) for floating surfaces and panels. This is a real appearance change and it overturns a stated
decision (`density.css:17`: *"the workbench has square corners; we do not invent rounded ones"*). It
is also unavoidable: `--kui-radius` bridges from it, so as long as it is 0 every shared component is
square regardless of what `controls.css` says. The user is overruling the workbench-citizenship
argument in favour of "look like Kira Studio," and G12's own §12.2 already established the pattern —
colour follows VS Code, **structure follows Kira Studio**. Radius is structure.

`density.css` keeps `--kv-row-height*` and `--kv-tree-indent` and gets a rewritten header saying
what it is now: the *workbench list density* that deliberately does **not** follow Kira Studio's
28px comfortable row (`tokens.css:114`), because these rows sit in VS Code's own tree/list idiom and
`readTokens.ts` feeds `--kv-row-height` straight into SlickGrid.

**Alternative considered:** keep `--kv-space-*` as deprecated aliases of `--kv-s-*` and migrate only
the files this phase touches. Rejected — that is the "half-implemented" shape, and it leaves the
next author a coin flip between two correct-looking spellings.

### D4 — `controls.css`'s `--kui-*` vocabulary grows to cover what `primitives.css` actually uses

`.p-btn`/`.p-row`/`.p-float`/`.p-input` reference type steps, two radius tiers, an input background,
a strong border, a subtle foreground, two shadows and two font roles. `--kui-*` has none of those, so
they are added — each with a fallback, so an unbridged host still renders reasonably (the file's own
stated contract, `controls.css:6-8`):

| new `--kui-*` | git-ui bridges to | main app bridges to |
|---|---|---|
| `--kui-t-xs` / `-sm` / `-md` | `--kv-t-xs` / `-sm` / `-md` | `--kira-t-xs` / `-sm` / `-md` |
| `--kui-radius-panel` | `--kv-radius-panel` | `--kira-radius` |
| `--kui-control-h-sm` / `-lg` | `--kv-control-h-sm` / `--kv-control-h-lg` | `--kira-control-h-sm` / `-lg` |
| `--kui-icon-box` / `--kui-icon-size` | `--kv-icon-box` / `13px` | `--kira-icon-box` / `13px` |
| `--kui-bg-input` | `--kv-input-bg` | `--kira-bg-input` |
| `--kui-border-strong` | `--kv-panel-border` | `--kira-border-strong` |
| `--kui-fg-subtle` | `--kv-description-fg` | `--kira-fg-subtle` |
| `--kui-shadow` / `--kui-shadow-dialog` | `var(--kv-shadow) var(--kv-widget-shadow)` composed | `--kira-shadow` / `--kira-shadow-dialog` |
| `--kui-border-width` | `--kv-border-width` | `--kira-border-width` |
| `--kui-font-ui` / `--kui-font-data` | `--kv-font-ui` / `--kv-font-data` | `--kira-font-ui` / `--kira-font-data` |

and three existing entries are corrected (F6): **`--kui-space-N` is re-pointed to `--kv-s-N` for all
six steps on the git-ui side and `--kira-s-N` for all six on the app side**, and `--kui-space-6` is
added, so the two bridges become the same six-step scale under the same six names. `--kui-control-h`
stops being a literal and becomes `var(--kv-control-h)`, so shared controls track VS Code's font size
(the G14 D7 fix, finally reaching the shared layer). `--kui-radius` becomes `var(--kv-radius-sm)`.

The main app's bridge is edited even though it renders nothing — G19 D3's contract is that the
`--kui-*` vocabulary is satisfiable *from both hosts*, and D2's second pass now enforces it
mechanically instead of by comment.

`--kv-input-bg` does not exist yet and is added to `vscode-tokens.css` as
`var(--vscode-input-background, var(--kv-panel-bg))` — the one new `--kv-*` colour token in this
plan, derived like every other one in that file, no literal.

### D5 — Buttons, icon boxes and rows take `primitives.css`'s geometry

**`.kui-button` becomes `.p-btn`** (`controls.css`):

```css
.kui-button {
  height: var(--kui-control-h, 22px);
  gap: var(--kui-space-2, 4px);
  padding: 0 var(--kui-space-3, 6px);
  border: var(--kui-border-width, 1px) solid transparent;   /* was: solid var(--kui-border) */
  border-radius: var(--kui-radius, 4px);
  color: var(--kui-fg-muted, inherit);                      /* was: var(--kui-fg) */
  font-size: var(--kui-t-sm, inherit);                      /* was: inherit */
}
.kui-button:hover:not(:disabled) { background: var(--kui-hover-bg); color: var(--kui-fg); }
.kui-button--active { background: var(--kui-bg-input); color: var(--kui-fg); }
```

The border stays declared as `transparent` rather than removed so `--primary`/`--danger`, which do
set a border colour, keep a stable box and never shift layout on state change — `.p-btn` gets the
same effect from `.p-tab`'s pattern. `--primary` keeps `--kui-button-fg` at full strength (G21 D2's
real filled-button triple is untouched).

**New `.kui-button--icon`** = `.p-iconbtn` (`primitives.css:35-45`): `width` and `height` both
`--kui-control-h`, `padding: 0`, `border-radius: --kui-radius`, `flex-shrink: 0`, muted at rest.
`KuiButton.vue`'s `variant` union grows `'icon'`. This is what replaces `.kv-icon-button`.

**`.kui-icon-box`** becomes `--kui-icon-box` (16px) square with `.codicon { font-size: var(--kui-icon-size, 13px) }`,
and the two per-context 16px overrides (`controls.css:49-52`, `:159-163`) are deleted as redundant (F4).

**New `.kui-row`** = `.p-row` (`primitives.css:505-521`), exported for direct use: `height:
--kui-control-h`, `gap: --kui-space-2`, `padding: 0 --kui-space-3`, `border-radius: --kui-radius`,
`:hover → --kui-hover-bg`, `.kui-row--selected → --kui-selected-bg`. **A class, not a component** —
its ten consumers differ in element and ARIA role (`<li role="option">`, `<div role="menuitem">`,
plain `<div>`) and share only geometry, which is exactly the seam `.p-row` itself occupies in Kira
Studio.

git-ui call sites, in the same commits: `.kv-icon-button` (5 sites) → `<KuiButton variant="icon">`
and the rule deleted from `BranchPicker.vue`; `.kv-undo-button`'s geometry block deleted (the new
default *is* that shape, minus the border it was removing); `.kv-branch-trigger` keeps its raw
`<button>` and its `.focus()` contract but gains `class="kui-button kv-branch-trigger"`, leaving only
`max-width: 200px` behind; `.kv-review-picker-row`'s de-styling override deleted.

### D6 — The graph toolbar becomes a Kira Studio toolbar

`AppToolbar.vue:385-401`, re-expressed on `.p-toolbar`/`.p-toolbar .sep`:

```css
.kv-toolbar {
  height: var(--kv-bar-h);                 /* 34px, font-size-derived — was 35px literal */
  gap: var(--kv-s-3);                      /* 6px — was 4px */
  padding: 0 var(--kv-s-4);                /* 8px, unchanged in value */
  border-bottom: var(--kv-border-width) solid var(--kv-toolbar-border);
}
.kv-toolbar-separator {
  width: var(--kv-border-width);
  height: var(--kv-control-inline-h);      /* 14px — was `align-self: stretch` (~27px) */
  margin: 0 var(--kv-s-1);                 /* was `var(--kv-space-2) 0` */
  background: var(--kv-panel-border);
  align-self: center;
}
```

`--kv-toolbar-height` is deleted from `density.css` — one consumer, now gone. The prior batch's
`.kv-search-row` (`App.vue:1650-1660`) takes the same bar geometry so the graph panel's two stacked
bars read as one system, matching `apps/kira-studio/frontend`'s own `DataToolbar` + `FilterToolbar`
pair.

The doc comment at `AppToolbar.vue:15-16` ("Metrics match the panel title bar's… 35px, square
corners, no shadow") is rewritten rather than left contradicting the code.

Kira Studio's `.p-toolbar-rail` (LAW 07, the 2px connection-colour cap) is **not** ported: LAW 07
reserves that rail for connection identity, and a git panel has no connection to identify.

### D7 — The context menu takes `.p-float`/`.p-row`/`.p-sep`/`.p-menu-label`

`controls.css`'s `.kui-menu-*` block, line for line against F5's table: `min-width: 180px`,
`padding: var(--kui-space-2)`, `display: flex; flex-direction: column; gap: 1px`,
`border-radius: var(--kui-radius-panel)`, `border-color: var(--kui-border-strong)`,
`box-shadow: var(--kui-shadow-dialog)`; `.kui-menu-item` gains `height: var(--kui-control-h)` and
`border-radius: var(--kui-radius)` with `padding: 0 var(--kui-space-3)`; `.kui-menu-separator`
becomes `.p-sep`; `.kui-menu-heading` becomes `.p-menu-label` (uppercase, `--kui-t-xs`,
`--kui-fg-subtle`, `--kui-control-h-sm` tall, no bottom border).

`.kui-popover`, `.kui-modal` and `.kui-tooltip` move to `--kui-radius-panel` and the shadow tokens in
the same commit — they are the same floating-surface primitive and leaving three of four square
would look like a bug rather than a decision.

**No behavioural change**: no submenu, no shortcut column, no checked column, no change to
`contextMenuModel.ts`, `floatingPosition.ts`, the roving-focus logic or the `flip: true` divergence
`KuiContextMenu.vue:122-130` deliberately documents. This is D7's whole scope and F5 is the evidence
that it is sufficient.

### D8 — Inputs, selects and segmented groups take `.p-input`/`.p-seg`

`.kui-text-input`, `.kui-select-field` and `.kui-search-input-field` take `.p-input`'s geometry
(`--kui-control-h`, `padding: 0 --kui-space-4`, `--kui-radius`, `border: --kui-border-width solid
--kui-border-strong`, `background: --kui-bg-input`, `font-size: --kui-t-sm`). Kira's `.p-input`
defaults to `--kira-font-data` with a `.ui` opt-out; the shared component defaults the other way
(`font-family: inherit`) because its callers are filters, not data fields — noted at the rule.

`.kui-segmented` becomes `.p-seg` (`primitives.css:452-482`): **one** bordered container at
`--kui-control-h` with `--kui-radius` and `overflow: hidden`, children separated by
`border-left`, active child on `--kui-bg-input` — replacing today's row of independently-bordered
gapped buttons. Its four call sites (`FileTree.vue`, `ReviewFilesPane.vue`, `ReviewView.vue` ×2) need
no markup change; `KuiSegmented.vue` keeps its props and emits.

### D9 — One dialog field rule, on `.p-input`, and the note stops being red

The 28 duplicated global declarations (F8) collapse into `packages/kira-ui/src/theme/controls.css`
as `.kui-field` / `.kui-field--inline` / `.kui-note` / `.kui-error`, and the thirteen dialogs' class
attributes are renamed to match. Field inputs get `.p-input` geometry via
`.kui-field input, .kui-field textarea, .kui-field select`.

`.kui-note` resolves to `--kui-fg-muted`, not the diff-deleted red twelve of its thirteen copies
carry today. Its actual consumers are explanatory scope notes (`RepoSettingsDialog.vue:106`'s
instance-wide note is the canonical one). `.kui-error` keeps `--kui-danger-fg`. This is a bug fix
with a colour consequence, not a colour decision: nothing here picks a new hue, it stops a note from
borrowing an error's.

**Not in scope:** migrating the ~25 raw `<input>`/`<select>` elements in those dialogs to
`KuiTextInput`/`KuiSelect` components. They are plain fields with `v-model`, no shared behaviour to
consolidate, and the geometry is what was wrong. §7.

### D10 — LAW 08 reaches the graph panel

`.kv-app` (`App.vue:1638-1644`) sets `font-family: var(--kv-font-ui)`, exactly as
`ReviewView.vue:915` already does, and the identifiers the graph renders get `--kv-font-data`:
the ref-badge label, the branch-picker trigger label, the repo-picker item label (a path), the
date cell, and `CommitGrid.vue:903`'s grid root drops to `--kv-font-ui` with the date cell
overriding back.

**The commit subject stays UI font.** Strict LAW 08 would call it data, but the review panel already
shipped the opposite reading — `ReviewCommitRow.vue:309` sets `--kv-font-ui` on the row and `:354`
mono only on the sha — and matching the panel next door beats matching the law's letter when the two
disagree. Flagged in §9.

---

## 3. Contract, Go, settings and perf impact — all four are "none"

**`CONTRACT_VERSION` stays 31.** No request, no response, no event, no `UiActionKind` member, no
`HostKind`, no bootstrap-island field changes. `packages/git-ipc/src/contract.ts` and
`validate.ts` are not touched; `apps/kira-studio/internal/gitrpc/contract.go` is not touched.
Verified rather than assumed: every decision above edits CSS, one `variant` union member
(`KuiButton.vue`), class attributes in `.vue` templates, and one shell script.

**No Go changes at all.** `go test ./apps/kira-studio/internal/...` is unaffected; the scoped race
run this chapter defines for a git phase has nothing to run against.

**No settings.** `packages/git-core/src/settings/schema.ts`, `RepoSettingsSnapshot`/`Patch`, and
`contributes.configuration` are untouched. No `kiraVersion.*.theme` or density setting is
introduced — G12 D14 already rejected one and, with colour still theme-derived, there is nothing for
it to switch.

**No `PersistedViewState` bump.** Nothing here is persisted.

**No new dependency**, so `CLAUDE.md`'s license discipline has nothing new to check and `NOTICES.md`
is untouched. `primitives.css` and `tokens.css` are this repo's own files; nothing is copied from a
third party.

**No first-paint risk, and no measurement is warranted** (`CLAUDE.md`: "measure when there's a real,
concrete question at stake"). The concrete question the SPEC row raises is whether loading real
kira-ui CSS/fonts threatens the ≤300 ms budget `docs/PERF.md` §2.13 records. Read off the code:

* **kira-ui's CSS is already in the bundle** (F10) — this plan changes the *contents* of
  `controls.css` (422 → ~540 lines, ≈2 KB more, well under 1 KB gzipped) and adds ~15 custom
  properties to `:root`. It adds no stylesheet, no `<link>`, no import.
* **No font is added.** `--kv-font-ui`/`--kv-font-data` resolve to `--vscode-font-family` /
  `--vscode-editor-font-family`, host-injected before our stylesheet parses, on locally-installed
  families. No `@font-face`, no `font-src` change, no FOUT possible. The one webfont in the document
  (`codicon.ttf`) is unchanged.
* **The budget's own numbers say the lever is elsewhere.** §2.13 measures a 20 000-commit first page
  at 218-235 ms and records that `firstChunk ≈ total` — first paint is bounded by `git log` plus
  parsing, "**not** by the socket and not by FlatBuffers." A 2 KB CSS delta is three orders of
  magnitude off that critical path.

`docs/PERF.md` is not edited: this phase produces no number worth recording there.

---

## 4. File-by-file changes

### `packages/kira-ui`

| File | Change | Decisions |
|---|---|---|
| `src/theme/controls.css` | `--kui-*` vocabulary grows (type steps, `--kui-radius-panel`, `--kui-control-h-sm/-lg`, `--kui-icon-box`/`--kui-icon-size`, `--kui-bg-input`, `--kui-border-strong`, `--kui-fg-subtle`, two shadows, `--kui-border-width`, two font roles) and its header documents them; `.kui-button` → `.p-btn` geometry; new `.kui-button--icon` (`.p-iconbtn`); `.kui-icon-box` → 16px box / 13px glyph, two redundant overrides deleted; `.kui-menu-*` → `.p-float`/`.p-row`/`.p-sep`/`.p-menu-label`; `.kui-popover`/`.kui-modal`/`.kui-tooltip` → `--kui-radius-panel` + shadow tokens; `.kui-text-input`/`.kui-select-field`/`.kui-search-input-field` → `.p-input`; `.kui-segmented` → `.p-seg`; **new** `.kui-row`/`.kui-row--selected`; **new** `.kui-field`/`--inline`/`.kui-note`/`.kui-error` | D4, D5, D7, D8, D9 |
| `src/KuiButton.vue` | `variant` union `+ 'icon'` | D5 |

### `packages/git-ui` — theme

| File | Change | Decisions |
|---|---|---|
| `src/theme/kira-structure.css` | block moves `.kv-skin-kira` → `:root`; header rewritten (why G12 D14 scoped it, why G34 unscopes it); `+ --kv-control-h-sm`, `+ --kv-control-inline-h` | D1 |
| `src/theme/density.css` | `--kv-space-1..5` and `--kv-radius` **deleted**; `--kv-toolbar-height` **deleted**; header rewritten to "workbench list density only" | D3, D6 |
| `src/theme/kui-bridge.css` | six-step `--kui-space-*` off `--kv-s-*`; `--kui-control-h` off `--kv-control-h` (no longer a literal); `--kui-radius` off `--kv-radius-sm`; all D4 tokens bridged | D4 |
| `src/theme/vscode-tokens.css` | `+ --kv-input-bg: var(--vscode-input-background, var(--kv-panel-bg))` — the only new token, derived, no literal | D4 |

### `packages/git-ui` — components

| File | Change | Decisions |
|---|---|---|
| `src/App.vue` | `--kv-font-ui` on `.kv-app`; `.kv-search-row` → bar geometry; `.kv-boot-error*` re-pointed to the one scale; `--kv-space-*`/`--kv-radius` migration | D1, D3, D6, D10 |
| `src/components/AppToolbar.vue` | `.kv-toolbar` → `.p-toolbar` geometry; `.kv-toolbar-separator` → 14px centred; gear/cancel → `variant="icon"`; `.kv-push-*`/`.kv-remote-progress` on the one scale; doc comment rewritten | D5, D6 |
| `src/components/BranchPicker.vue` | `.kv-icon-button` rule **deleted** (5 consumers migrated); `.kv-branch-trigger` keeps the raw `<button>`, gains `class="kui-button …"`, keeps only `max-width`; `.kv-branch-row` → `.kui-row`; trigger label → `--kv-font-data` | D5, D7, D10 |
| `src/components/UndoButton.vue` | `.kv-undo-button` geometry block **deleted** | D5 |
| `src/components/RepoPicker.vue` | `.kv-repo-item` → `.kui-row`; item label → `--kv-font-data` | D5, D10 |
| `src/components/SearchResults.vue` | `.kv-search-option` → `.kui-row`; surface radius → `--kv-radius-panel`; stays outside `KuiPopoverPanel` | D3, D5 |
| `src/components/PullStrategyPicker.vue`, `review/BaseSelector.vue`, `StackList.vue`, `TagList.vue`, `GlobalStashList.vue`, `StashList.vue`, `WorktreeList.vue` | panel rows → `.kui-row`; `.kv-icon-button` → `variant="icon"`; scale migration | D3, D5 |
| `src/components/CommitGrid.vue` | grid root → `--kv-font-ui`; `.kv-cell-date`/`.kv-ref-badge` label → `--kv-font-data`; scale migration | D3, D10 |
| `src/components/FileTree.vue`, `CommitMeta.vue`, `DetailPane.vue`, `StashDetailPane.vue`, `ConflictBanner.vue`, `RefreshButton.vue`, `SearchBox.vue`, `NoRepositoryPanel.vue`, `EmptyRepositoryPanel.vue`, `GitBlockedPanel.vue`, `LoadMoreButton.vue` | `.kv-skin-kira` attribute removed (FileTree); `--kv-space-*`/`--kv-radius` migration; no other change | D1, D3 |
| `src/components/review/ReviewView.vue` | `.kv-skin-kira` attribute removed; `.kv-review-picker-row` de-styling override deleted; picker rows → `.kui-row`; scale migration | D1, D3, D5 |
| `src/components/review/ReviewCommitRow.vue`, `ReviewFilesPane.vue`, `ReviewCommentsPane.vue` | scale migration only | D3 |
| `src/components/dialogs/*.vue` (13 files) | `.kv-dialog-field`/`--inline`/`-note`/`-error` class attributes → `.kui-*`; **all 28 duplicated rule blocks deleted**; `StackDialog.vue`'s raw `<select>` gains `class="kui-select-field"` | D9 |

### Repo-level

| File | Change | Decisions |
|---|---|---|
| `apps/kira-studio/frontend/src/theme/kui-bridge.css` | six-step `--kui-space-*`; every D4 token bridged from its real `--kira-*` equivalent; header notes it is still inert but now contract-complete and guarded | D4 |
| `scripts/check-tokens.sh` | two more passes: `--kv-*` over `packages/git-ui/src`, `--kui-*` over `packages/kira-ui/src` against **both** bridges | D2 |
| `apps/kira-studio-vscode/tests/interaction/kira-parity-geometry.spec.ts` | **new** — §6 Tier 2 | all |
| `apps/kira-studio-vscode/tests/layout/webview-layout.spec.ts` | the 35 → 34 toolbar height, if it is asserted there | D6 |

---

## 5. Implementation order

One sequential Sonnet subagent; each step its own conventional commit. Ordered so the two
rendering-neutral foundations land first and the guard that protects everything after them lands
second.

1. **`refactor(git-ui): one structural scale for the whole webview`** — D1. `kira-structure.css`
   → `:root`, `.kv-skin-kira` retired, `--kv-control-h-sm`/`--kv-control-inline-h` added. Rendering-
   neutral except `.kv-boot-error-banner`, which starts rendering as written (F2).
2. **`chore(lint): check-tokens guards the --kv-* and --kui-* layers too`** — D2.
3. **`refactor(git-ui): --kv-space-* folds into the --kv-s-* scale`** — D3, first half. 240
   value-preserving substitutions; `--kv-space-*` deleted.
4. **`refactor(git-ui): --kv-radius gives way to Kira Studio's two radius tiers`** — D3, second
   half. 36 sites re-pointed per surface; `--kv-radius` deleted. **First visible change.**
5. **`feat(kira-ui): the --kui-* vocabulary grows type, radius, elevation and font roles`** — D4.
   `controls.css`'s token references and both bridges, in one commit so the two sides can never be
   seen apart; no rule geometry changes yet.
6. **`feat(kira-ui): buttons and icon boxes take p-btn and p-iconbtn's geometry`** — D5, plus the
   four git-ui de-styling overrides that exist only to undo the old default.
7. **`feat(kira-ui): the context menu takes p-float, p-row and p-sep's geometry`** — D7. *(the user's
   "the right click")*
8. **`feat(kira-ui): inputs, selects and segmented groups take p-input and p-seg's geometry`** — D8.
9. **`feat(git-ui): the graph toolbar is a Kira Studio toolbar`** — D6. *(the user's "the main
   toolbar")*
10. **`refactor(git-ui): ten hand-rolled dropdown rows become one .kui-row`** — D5/F7.
11. **`refactor(git-ui): one dialog field rule, not twenty-eight`** — D9.
12. **`feat(git-ui): LAW 08's font roles reach the graph panel`** — D10.
13. **`test(vscode): rendered-geometry coverage for the Kira Studio parity batch`** — §6 Tier 2, run
    once at the end per `CLAUDE.md`'s "implement the whole plan first, then test once."

Per-commit fast checks: `bun run lint` (now including D2's guard), `bun run typecheck`. Once, at
step 13: `bun run test:unit`, `bun run test:webview`. No Go run is needed — nothing Go-side changes
(§3) — beyond the tree-wide backstop if one is being run anyway.

---

## 6. Exit criteria

### Tier 1 — mechanical (`bun run lint` / `typecheck` / `test:unit`)

- [ ] `bun run lint` passes, and `scripts/check-tokens.sh` now reports three passes, one per token
      layer. *(D2)*
- [ ] `grep -rn -- '--kv-space-' packages apps --include='*.vue' --include='*.css' --include='*.ts'`
      returns nothing outside this plan file (`dist/` is gitignored and excluded). *(D3)*
- [ ] `grep -rn 'var(--kv-radius)' packages/git-ui/src` returns nothing, and `--kv-radius:` is
      defined nowhere. *(D3)*
- [ ] `grep -rn 'kv-skin-kira' packages/git-ui/src` returns nothing but `kira-structure.css`'s own
      historical note. *(D1)*
- [ ] `grep -rn 'kv-icon-button\|kv-undo-button' packages/git-ui/src` returns nothing. *(D5)*
- [ ] Exactly **one** definition each of `.kui-field`, `.kui-field--inline`, `.kui-note`,
      `.kui-error`, and **zero** of `.kv-dialog-field`, `.kv-dialog-note`, `.kv-dialog-error`. *(D9)*
- [ ] `kira-structure.css` still contains no hex literal, no `rgb(`, and no
      `color`/`background`/`border-color` property — G12 D14's own guarantee, unchanged by the move
      to `:root`. *(D1)*
- [ ] The two `kui-bridge.css` files declare the **identical** set of `--kui-*` names
      (`comm -3` on the two sorted name lists is empty), and every `--kui-*` referenced without a
      fallback in `controls.css` appears in that set. *(D2, D4)*
- [ ] `bun run typecheck` clean — including `vue-tsc` over both `packages/git-ui` and
      `packages/kira-ui`. *(D5)*
- [ ] `bun run test:unit` passes with no spec edited: no unit test asserts on a removed class or a
      token value. *(all)*
- [ ] `CONTRACT_VERSION` is still **31** on both sides, and `git diff --stat` touches no `.go` file
      and no file under `packages/git-ipc/` or `packages/git-core/`. *(§3)*
- [ ] No entry added to `package.json` dependencies anywhere; `NOTICES.md` unchanged. *(§3)*

### Tier 2 — Playwright (`bun run test:webview`)

New `apps/kira-studio-vscode/tests/interaction/kira-parity-geometry.spec.ts`, over the existing
`fakeGraphHost.ts` / `fakeReviewHost.ts` fixtures — rendered box geometry against the real emitted
webview documents, the tier this chapter already uses for exactly this class of claim.

- [ ] `.kv-toolbar`'s computed `height` is **34px** and its `border-bottom-width` is 1px. *(D6)*
- [ ] `.kv-toolbar` and `.kv-review-toolbar` (booted in the two documents at the same viewport and
      font size) have the **same** computed height — the single assertion that proves F1's two
      scales are reconciled. *(D1, D6)*
- [ ] `.kv-toolbar-separator`'s computed `height` is **14px**, not the toolbar's own. *(D6)*
- [ ] `[data-testid="fetch-button"]`: `border-top-width === '0px'` *(a transparent border still
      computes to 1px width, so assert `border-top-color`'s alpha is 0 **or** the rule's own
      `transparent` — the spec asserts the rendered outcome: no visible edge)*, `border-radius`
      `4px`, `height` `22px`, and `font-size` strictly less than the document root's. *(D5)*
- [ ] `[data-testid="repo-settings-button"]` is square: computed `width === height === '22px'`. *(D5)*
- [ ] A `.codicon` inside a toolbar button computes `font-size: '13px'`, and its `.kui-icon-box`
      is 16×16. *(D5)*
- [ ] Right-clicking a file-tree row opens `.kui-menu-root` with `border-radius: '6px'`,
      `min-width: 180px` and non-zero horizontal padding; its `.kui-menu-item` is `22px` tall with
      `border-radius: '4px'`. *(D7)*
- [ ] `.kui-menu-separator`'s computed `height` is 1px and its vertical margin is 4px. *(D7)*
- [ ] A `.kui-row` in the repo-picker dropdown is `22px` tall with `border-radius: '4px'`. *(D5)*
- [ ] `.kv-boot-error-banner`, forced visible by the fake host, has non-zero computed
      `padding-left` and a 1px `border-bottom-width` — the F2 regression, asserted directly. *(D1)*
- [ ] `.kv-app`'s computed `font-family` equals `.kv-review-view`'s. *(D10)*
- [ ] `webview-layout.spec.ts` still passes (the height chain absorbs 35 → 34 and nothing else).
- [ ] `kui-floating-geometry.spec.ts` still passes unchanged — D7 changes the menu's *chrome*, never
      its `flip`/`shift`/`size` behaviour. *(D7)*
- [ ] `graph-columns.spec.ts`, `file-tree-open.spec.ts`, `commit-meta-clamp.spec.ts` and
      `review-interaction.spec.ts` all still pass without edits.

### Tier 3 — needs a human to click through it

- [ ] **(D6)** The graph toolbar and the review toolbar, side by side, read as the same bar: same
      height, same rhythm, same separator weight.
- [ ] **(D5)** No toolbar button shows a box around it at rest; hovering paints a soft rounded
      highlight; the labels sit one step down from body text and are muted until hovered — the same
      feel as Kira Studio's own view toolbars.
- [ ] **(D7)** A right-click menu in the graph, in the branch picker, and in the file tree each look
      like Kira Studio's: rounded surface, inset padding, rows that highlight as rounded pills with a
      hairline of space between them.
- [ ] **(D4/D5)** Raise VS Code's `window.zoomLevel` and `editor.fontSize`: every shared control
      grows with its text instead of clipping it (the `--kui-control-h` literal is gone).
- [ ] **(D3)** On a **light** and a **high-contrast** VS Code theme, nothing has lost contrast:
      no colour token changed, and the only new one (`--kv-input-bg`) derives from
      `--vscode-input-background`.
- [ ] **(D9)** The Repository settings dialog's "this applies to every repository" note is grey, not
      red; its fields have the same height and rounding as everything else in the dialog.
- [ ] **(D10)** In the graph, a ref badge, a branch name and a date read in the editor font; the
      commit subject and every label read in the UI font — the same split the review panel shows.
- [ ] **(D1)** Disconnect Kira Studio while the panel is open: the boot-error banner has padding, a
      bottom border and the UI font.

---

## 7. Non-goals

* **Any colour change.** `vscode-tokens.css` is edited only to *add* one derived token
  (`--kv-input-bg`); its `:root`, `body.vscode-light` and `body.vscode-high-contrast` blocks are
  untouched. Kira Studio's fixed VS-Code-Dark-Modern palette is **not** ported — G12 §12.2 rejected
  exactly that, for every light and high-contrast user, and that resolution still holds. Structure
  follows Kira Studio; colour follows the user's theme.
* **Any new font or icon set.** No `@font-face`, no `font-src` change; codicons stay the only icon
  font, and `seti-icons` (the prior batch's D3) is untouched.
* **`apps/kira-studio/frontend` adopting `packages/kira-ui`.** Its bridge is completed and guarded
  so the contract stays satisfiable from both hosts (G19 D3's own terms), but nothing there imports
  `@kira/kira-ui` and this phase does not change that. `primitives.css` is **read**, never edited.
* **Submenus, a shortcut column, or a checked column in `KuiContextMenu`.** G19 D3's stated
  non-goal, re-verified: `rowMenuModel.ts`'s `MenuItem` has no such member and no git-ui menu item
  has a keybinding (F5).
* **Migrating dialogs' raw `<input>`/`<select>` to `KuiTextInput`/`KuiSelect`.** D9 unifies their
  geometry; the component migration is a separate, larger change with no styling payoff.
* **`SearchBox.vue`'s query input.** It is a full ARIA combobox with `aria-activedescendant` and
  regex-error `aria-describedby` (`SearchBox.vue:1-10`, and G-UX D9 already reused `KuiSearchInput`
  for the parts that could be); its geometry follows from D8 and its structure is left alone.
* **`SearchResults.vue` moving into `KuiPopoverPanel`.** Its own documented reason
  (`SearchResults.vue:47-58`: the panel's capture-phase `Escape` would swallow the combobox's
  two-stage dismiss) is still correct; only its surface radius changes.
* **`BranchPicker.vue`'s trigger becoming a `KuiButton`.** G21 D2's `.focus()`-before-dialog
  requirement is unchanged; it gains the shared class, not the component.
* **`--kv-row-height` merging into `--kv-control-h`.** They are equal at the default font size but
  mean different things: the former is VS Code list density, read as a number by `readTokens.ts` into
  SlickGrid; Kira Studio's own comfortable row is 28px. Left alone deliberately.
* **`.p-toolbar-rail` / LAW 07's connection colour.** Reserved for connection identity; a git panel
  has none.
* **`docs/v1.3/SPEC.md`.** Not edited — the G34 row already exists.
* **`docs/ARCHITECTURE.md`'s stale `CONTRACT_VERSION` **30**** (`:2170`, actually 31 since the prior
  batch). Noticed here, not fixed here; it belongs in the next docs pass, as G33 was.
* **`docs/PERF.md`.** No number this phase produces is worth recording (§3).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Promoting `kira-structure.css` to `:root` silently changes something in the review panel | The two token sets are name-disjoint (verified name by name), so no value that already resolved can change; commit 1 is rendering-neutral by construction and its only visible effect is F2's fix. Tier-2 asserts the review suites still pass untouched. |
| The 240-reference `--kv-space-*` rename slips a value | The substitution table is five entries, all value-preserving; the commit is mechanical and `grep -c -- '--kv-space-'` → 0 is the completeness check. D2's guard catches any typo'd target name as an undefined token, at `lint` time, in the same commit. |
| Retiring `--kv-radius: 0` makes the panel look un-VS-Code | This is the user's explicit ask, and G12 §12.2 already drew the structure/colour line this sits on. It is one token; reverting is a one-line change and every call site now names *which* tier it wanted. §9.2. |
| `.kui-button` losing its border regresses a call site that relied on it to look like a bordered control | The four dialog submit buttons use `variant="primary"`, which keeps its own border colour; every other override that exists today removes the border rather than relying on it (F3). Tier-3's toolbar and dialog checks are the eyes on it. |
| Editing `controls.css` breaks the main Kira Studio app | It cannot: nothing in `apps/kira-studio/frontend` imports `@kira/kira-ui` (F10 §2). The blast radius of every `controls.css` change in this plan is the two git webviews. |
| The bridges drift apart again | D2's second pass is exactly this guard, wired into `bun run lint`, and it is the first thing that has ever checked it. |
| Tier-2 asserts a computed style that varies by Chromium version | Every assertion is a px value this repo's own tokens set, not a UA default; the existing `kui-floating-geometry.spec.ts` and `webview-layout.spec.ts` already assert rendered geometry on the same runner and have been stable. |
| A `.kui-row` migration changes a row's keyboard or ARIA behaviour | `.kui-row` is a class, not a component — no element, role, `tabindex` or handler moves. Ten diffs that touch only `class` and a `<style>` block. |

---

## 9. Human-eye decisions

Each carries my explicit recommendation. Per this project's standing convention the implementer
takes the recommendation without asking further — but the plan itself is reviewed first, so these
are the places to push back.

1. **`kira-structure.css` moves to `:root` and `.kv-skin-kira` is deleted, overturning G12 D14's
   scoping and §12.2's "the graph panel keeps the workbench language."** **Recommendation: do it.**
   The user's ask names the main toolbar, which is the graph panel's; the split has already produced
   one silent five-declaration bug (F2) and would produce more; and the prior batch's handover note
   says this phase's job is precisely to unify the two rather than let them coexist.

2. **`--kv-radius: 0px` is retired, so the git panels gain 4px controls and 6px floating surfaces —
   overturning `density.css:17`'s own "the workbench has square corners; we do not invent rounded
   ones."** **Recommendation: retire it.** It is the single token gating every shared component's
   corner, and G12 already settled that structure follows Kira Studio while colour follows VS Code.
   If a reviewer disagrees, keeping it is one line and costs only the corners — everything else in
   this plan still lands.

3. **The `--kv-space-*` → `--kv-s-*` rename is one commit of ~240 mechanical substitutions.**
   **Recommendation: do it in one commit, as step 3.** It is value-preserving and trivially
   verifiable; splitting it per-file would produce a dozen commits that each leave the codebase in a
   two-spellings state, which is worse to review, not better.

4. **`.kui-button` loses its border at rest and drops to muted `--kui-t-sm`.** This is the largest
   single visual change in the plan and it touches all 121 call sites at once.
   **Recommendation: yes** — it is `.p-btn` verbatim, and four call sites have already hand-rolled
   their way to it (F3), which is the strongest evidence available that the default is wrong.

5. **Codicon glyphs drop from 16px to 13px.** **Recommendation: 13px.** Both of Kira Studio's own
   button primitives and its context menu hard-default to it, and 16px-in-a-16px-box is what makes
   the panel read as "everything is slightly too big."

6. **The context menu narrows from `min-width: 220px` to `180px`.** **Recommendation: 180px**,
   matching `ContextMenu.vue:349`. git-ui's longest menu label is well inside it, and `max-width:
   320px` still catches an unusually long ref name.

7. **LAW 08 in the graph panel: sha, ref names, paths and dates become `--kv-font-data`; the commit
   subject stays `--kv-font-ui`.** Strict LAW 08 would make a subject data.
   **Recommendation: keep the subject in the UI font**, matching what the review panel already
   shipped (`ReviewCommitRow.vue:309`). Two panels agreeing beats one panel being more literally
   correct, and a mono commit list would be a far larger change than the user asked for.

8. **`.kv-dialog-note` stops being `--kv-diff-deleted-fg` red.** **Recommendation: `--kui-fg-muted`.**
   Twelve of its thirteen declarations chose red and one chose muted (F8); its real consumers are
   explanatory scope notes, not errors, and `.kui-error` still exists for the ones that are.

9. **The toolbar goes 35px → 34px.** **Recommendation: 34px**, i.e. `--kv-bar-h`, which also makes
   it track the user's font size. The 1px is invisible on its own; what matters is that both bars in
   the product then come from one token.

10. **`KuiSegmented` becomes a single bordered `.p-seg` container rather than gapped buttons.** This
    changes four visible toggles (Tree/Flat, Commits/Files, and two more).
    **Recommendation: yes** — it is the primitive Kira Studio uses for exactly this control, and
    leaving it as the one un-ported family would be conspicuous next to the restyled toolbar it sits
    under.

11. **`.kui-row` is a class, not a `KuiRow` component.** **Recommendation: a class.** Its ten
    consumers differ in element and ARIA role and share only geometry; `.p-row` occupies the same
    seam in Kira Studio for the same reason, and a component would force ten call sites to route
    their roles and handlers through props for no gain.

12. **`scripts/check-tokens.sh` grows rather than the repo gaining stylelint.** **Recommendation:
    grow the script.** Its own header already records that stylelint is not in this toolchain, the
    two new passes are the same eight-line grep-and-`comm` shape, and `CLAUDE.md`'s "reach for a
    library before hand-rolling non-trivial infrastructure" does not bite on a `comm` of two sorted
    name lists.
