# P131 Part 1 — shadcn plumbing for both git-ui hosts, and the 14 dialogs: plan

Plan for `docs/v2.0/SPEC.md`'s P131 row, split here into three parts (§2). This document is Part
1's full plan. It also fixes the phase-wide decisions (host plumbing, call-site rules, component
map) so Parts 2 and 3 plan against them rather than reopening them. Planned against `v1.9` at
`c73f44b5`.

Symbols and call sites read via `codegraph_explore` (8 calls): git-ui's `mount()`, `App.vue`,
the 14 dialogs and their `App.vue`/`WorktreeList.vue` callers, every `Kui*` component and
`useModalFocus`, `refBadges.ts`/`CommitGrid.vue`, `AttributeTooltip.vue`/`TooltipAnchorBridge.vue`
and their one Studio consumer, `floatingPosition.ts`, both apps' `App.vue` `TooltipProvider`. CSS and
config files are not in the CodeGraph index. Those came from `rg`/Read: `packages/theme/src/*.css`,
`packages/git-ui/src/theme/*.css`, Vite/tsconfig files, `scripts/check-*`. Tailwind's `@import …
theme(…)` handling was read from the installed `tailwindcss@4.3.3` `dist/lib.js`.

---

## 0. What SPEC left open, and resolutions

| Open point | Resolution | Where |
|---|---|---|
| Split? | Yes, three parts: foundation + dialogs, graph, review + closing. SPEC names "graph, review, dialogs" as candidates. Foundation must land before any component moves, and dialogs are its smallest self-contained first consumer. | §2 |
| How shadcn utilities and tokens reach Kira Space | Space's own unprefixed root gains `@source` over `packages/git-ui/src` through a new Space-only stylesheet. `workbench.css` stays untouched, so Studio does not scan git-ui. | §3.2 |
| How they reach the VS Code webview | A new webview-only unprefixed root, with preflight. It imports a host-neutral core split out of `base.css` using `theme(inline)`, plus a reverse bridge `--kira-*` ← `--kv-*` on `:root, body`. | §3.3 |
| `tailwind-merge` cannot merge `kv:` against unprefixed | Never mix them. Classes on a shadcn component are unprefixed and go through the theme's `cn`. `kv:` stays on plain git-ui markup only. A lint check enforces this. | §4, §7 |
| Font scale of shadcn controls in Space | They follow Kira's chrome scale (`--kira-t-md`, `--kira-control-h`), not `git.graphFontSize`. The grid, badges and `kv:` text keep following the graph size. At the default of 0 both scales match. **Interpretation call.** | §4.3 |
| Raw `<input>`/`<textarea>`/`<select>`/checkbox/radio in dialogs (not `Kui*`) | In scope. A dialog with a shadcn Button beside a raw browser checkbox still "doesn't use shadcn". CLAUDE.md's primitive rule applies to them anyway. **Interpretation call; the user can narrow it.** | §6 |
| No shadcn radio exists in `packages/theme` | Pull `radio-group` from the registry (DEV_ENVIRONMENT.md procedure). shadcn-vue and reka-ui are MIT. | §6.2 |
| Tooltip provider for git-ui's own Vue app | git-ui is a separate `createApp`, so Space's `App.vue` `TooltipProvider` does not reach it. Part 2 wraps both roots in `mount()`. Part 1 has no tooltip call site (dialogs hold zero `v-kui-tooltip`). | §5 |
| Where SlickGrid's AttributeTooltip lives | Part 2 hoists `AttributeTooltip.vue`, `TooltipAnchorBridge.vue` and the `TooltipContent` type from `packages/workbench` into `packages/theme/src/components/`. git-ui must not depend on workbench at runtime, and theme already holds a composed component (`TooltipIconButton.vue`). **Interpretation call.** | §5 |
| Helpers git-ui still needs from kira-ui | Part 3 moves the kv `cn`, `kuiRowVariants` (retokened to `--kv-*`) and `contextMenuModel`'s `MenuItem`/`MenuSection`/`enabledNeighbour`/`firstEnabled` (with its test) into git-ui. kira-ui keeps `KuiColumnResizeHandle` and `floatingPosition`. **Interpretation call.** | §5 |
| SPEC's "43 `.vue` files" | Correct as the count of kira-ui-using files. `packages/git-ui/src` holds 51 `.vue` files. The other 8 (for example `PreflightPrediction.vue`, `DetailPane.vue`) use no `Kui*` but may hold raw controls. | §1 |
| Overlap with P129 | None in files. P129 plans forbid any git-ui/kira-ui import under `src/ade/` (Part 1 plan line 140; Part 3 plan §7). The only shared file is Space's `main.ts`: one line here versus P129 Part 3's edits. SPEC's default is still `P` order, so Part 1 implements after P129 lands unless the user says otherwise. | §8 |

## 1. Confirmed current state

- **git-ui's `kv:` root.** `packages/git-ui/src/theme/tailwind.css` is a `kv`-prefixed root with no preflight and `@theme inline reference`. It has `@source "../"` plus kira-ui.
  - Load order in `packages/git-ui/src/main.ts`: `tailwind.css`, `app-shell.css`, `codicon.css`, `vscode-tokens.css`, `density.css`, `kui-bridge.css`, `kira-structure.css`.
  - Every `--kv-*` is defined on `:root`.
  - `vscode-tokens.css` redefines some tokens on `body.vscode-high-contrast[-light]` (lines 171-184) and on `body.vscode-light` (lines 196-231). Examples: `--kv-description-fg`, `--kv-input-bg`, `--kv-error-fg`, `--kv-focus-border`.
- **Kira Space.** `apps/kira-space/frontend/src/main.ts:23` imports `@workbench/workbench.css`, which is `@import "@theme/base.css"; @source "./"`.
  - `base.css` (259 lines) runs in this order: `@import "tailwindcss"` (line 1), token/bridge imports (lines 2-15), `@source "./"` (line 23), `@theme` (lines 27-124), `@utility` blocks (lines 127-196), `@layer base` focus rules (lines 197-209), then host rules for `html`/`body`/`#app`/scrollbars (lines 211-259).
  - `shadcn-bridge.css` holds `tw-animate-css`, `@custom-variant dark (&:is(.dark *))`, four `:root` shadcn names and an `@theme inline` block.
  - git-ui is loaded lazily (`apps/kira-space/frontend/src/repo/git/gitUiModule.ts`), so its CSS comes after `base.css`. Nothing scans `packages/git-ui/src` for unprefixed classes.
- **VS Code webview.** `apps/kira-space-vscode/src/webview/main.ts` imports git-ui and has no CSS import of its own.
  - `html.ts` collects every CSS asset from the Vite manifest, so a new CSS import there ships automatically.
  - The webview has no `--kira-*` token, no preflight and no unprefixed root.
- **Webview build paths.**
  - `packages/git-ui/vite.config.ts` has `root` = repo root, `vue()` + `tailwindcss()`, and no `@theme` alias.
  - `packages/git-ui/tsconfig.json` maps only `@workbench/*`.
  - `apps/kira-space-vscode/tsconfig.json` has no `paths`.
  - `apps/kira-space-vscode/tests/interaction/support/commitMetaHarnessServer.ts` runs its own Vite build (`vue()` + `tailwindcss()`, root = its own dir). Its entry imports git-ui's theme CSS files directly.
  - `reka-ui` 2.10.5, `@lucide/vue`, `class-variance-authority`, `clsx`, `tailwind-merge` and `tw-animate-css` are declared in the root `package.json` only. Studio and Space both resolve them that way, and `packages/theme/package.json` declares none.
- **Dialogs** (`packages/git-ui/src/components/dialogs/`): 14 `KuiDialog` files, 45 `KuiButton`s (15 `variant="primary"`, 1 `danger`, the rest default) and 5 `KuiSelect`s (all in `RepoSettingsDialog.vue`).
  - Raw controls per file (`<input>` count includes checkbox/radio lines):

    | File | Raw controls |
    |---|---|
    | Branch | text + checkbox |
    | CherryPick | radio |
    | ForcePush | checkbox |
    | RenameRef | text |
    | RepoSettings | text + textarea + 4 checkboxes + 1 `<select>` |
    | Reset | 3 radios + checkbox + text |
    | Revert | radio |
    | Stack | 1 `<select>` |
    | Stash | 2 radios + 2 checkboxes + text |
    | Tag | text + textarea + 2 checkboxes |
    | Worktree | 3 radios + checkbox + texts |
    | `PreflightPrediction.vue` (no `Kui*`) | checkbox |

  - All 14 are mounted from `App.vue` only.
  - A fifteenth `KuiDialog` sits in `components/WorktreeList.vue:181` and goes with that file in Part 2 (one touch per file).
- **`KuiDialog` behaviour to preserve** (`packages/kira-ui/src/KuiDialog.vue`):
  - teleports to body; overlay;
  - `role="dialog" aria-modal` with `aria-labelledby` on the title;
  - Escape and outside click emit `close`; focus trap and return via `useModalFocus`;
  - width `min(480px, 90vw)` (no caller passes `width`), `max-h-[85vh]`;
  - scrolling body, right-aligned `actions` slot with a 4px gap;
  - `title` given as a prop or as a `#title` slot (`ResetDialog.vue` uses the slot for `<code>` markup).
- **Existing shadcn dialog precedent.** `apps/kira-space/frontend/src/workbench/GitCredentialDialog.vue` renders `Dialog` with `@update:open`, then `DialogContent :show-close-button="false"` with `flex flex-col p-0 gap-0 w-110 max-h-4/5`. Inside: `DialogHeader`/`DialogTitle`, a body div, and `DialogFooter` holding `Button variant="dialog"|"dialog-primary" size="kira-lg"`.
- **Tests that see dialogs.** Only `apps/kira-space-vscode/tests/interaction/graph-dialog-reconnect.spec.ts` does, through `getByRole('dialog', { name: 'Repository settings' })`. It stays valid because `DialogTitle` supplies the accessible name. No Space test opens a git dialog.

## 2. Split

| Part | Scope | Why this boundary |
|---|---|---|
| **Part 1** (this plan) | Host plumbing for both hosts (§3); lint guards (§7); `radio-group` pull; the 14 `components/dialogs/*.vue` files plus `PreflightPrediction.vue`. | Nothing can migrate before the plumbing exists. Dialogs are portaled, uniform (`KuiDialog` + `KuiButton` + form controls) and hold no tooltip, grid or menu work. That makes them the smallest consumer that proves both hosts end to end. |
| **Part 2** | `App.vue` and every non-dialog, non-review `components/*.vue`, including `WorktreeList.vue` and `FileTree.vue` (shared with review). `refBadges.ts`/`CommitGrid.vue` badges via `badgeVariants`. The grid tooltip via the hoisted `AttributeTooltip`. A `TooltipProvider` in `mount()`. Context menus, `KuiMenuList` and `KuiPopoverPanel` move to DropdownMenu/Popover. Delete `app-shell.css`'s checkbox rule once no raw checkbox is left. | This is the graph's own tree. It also touches `packages/workbench` (`AttributeTooltip` hoist) and so Studio's `SlickGridHost.vue`. |
| **Part 3** | `components/review/*.vue`; remove the `vKuiTooltip` registration from `main.ts`; move the §5 helpers into git-ui; delete every zero-consumer kira-ui module and both `kui-bridge.css` copies once unused; update lint scripts and `ARCHITECTURE.md`; run the whole-phase acceptance. | Review is the second view, and deletion only becomes safe once every consumer is gone. |

Each part gets its own plan under `docs/v2.0/plans/` (`P131-part2-…`, `P131-part3-…`), its own implementation pass and its own result section. Parts 2 and 3 are planned against the tree Part 1 leaves, not against this document's summary.

**No stream split inside Part 1.** The plumbing commits are order-dependent (the core partial comes before both roots). Dialogs share `RadioGroup`/lint changes that must land first. One sequential implementer.

## 3. Host plumbing (phase-wide)

### 3.1 Split `base.css` into a host-neutral core

New file `packages/theme/src/tailwind-core.css`. It contains, moved verbatim from `base.css`:
- the `@import "@theme/shadcn-bridge.css"` line;
- the whole `@theme { … }` block (lines 27-124);
- every `@utility` (lines 127-196);
- the `@layer base` focus rules (lines 197-209);
- `@source "./components"`.

It has no `@import "tailwindcss"`, no tokens, no host rules and no `:root` token values of its own.

`base.css` keeps `@import "tailwindcss"`, the codicon/tokens/kui/vscode bridge imports, the primitives, review-decorations and blame-annotation imports, and `@import "@theme/tailwind-core.css"`. It also keeps `@source "./"`, which still covers `components/`, and its `html`/`body`/`#app`/scrollbar rules.

Move `@custom-variant dark (&:is(.dark *));` from `shadcn-bridge.css` into `base.css`. The dark selector is host-specific; the core must not fix it.

**Verification: no-op for both apps.** Build Space and Studio CSS before and after this one commit. The emitted CSS must be identical apart from rule order within a layer. Diff the sorted selector+declaration list; a script in the scratchpad is enough and is not committed. This is a real question (a refactor that must not change two apps), so the measurement earns its keep. If the output is not identical, run `test:ui:studio` too, and explain each difference in the result section.

Layer order note: `@import` must precede other at-rules, so `tailwind-core.css` goes after the other imports in `base.css`. Its `@theme` then comes after `shadcn-bridge.css`'s `@theme inline` in source order, as it does today, because shadcn-bridge moves inside the core ahead of the block. Keep that relative order: shadcn-bridge first, then `@theme`. `base.css`'s own comment at lines 29-35 explains why later `@theme` must not redeclare shadcn names.

### 3.2 Kira Space: scan git-ui

- New `apps/kira-space/frontend/src/styles.css`:
  `@import "@workbench/workbench.css"; @source "../../../../packages/git-ui/src";`
- `apps/kira-space/frontend/src/main.ts:23` changes from `import '@workbench/workbench.css'` to `import './styles.css'`. One line. Rebase over P129's edits if needed.
- Nothing else. Space already loads the shadcn components and `--kira-*` tokens.
- git-ui's shadcn controls then render in Space's `.dark` document, in Space's own theme.

Side effect to verify: Space's root now scans git-ui text, so bare words there can emit unprefixed utilities. git-ui DOM carries only `kv:` utilities plus its own CSS hooks (`kv-*`, `codicon*`, `seti-*`). Check that no git-ui class token also names an unprefixed utility: the §10 audit greps for this. Any hit gets renamed or confirmed intentional.

### 3.3 VS Code webview: its own unprefixed root

New `apps/kira-space-vscode/src/webview/tailwind.css`, imported first in `apps/kira-space-vscode/src/webview/main.ts`:

```css
@import "tailwindcss" source(none);
@import "@theme/tailwind-core.css" theme(inline);
@import "./kira-bridge.css";

@custom-variant dark (&:is(.vscode-dark *, .vscode-high-contrast:not(.vscode-high-contrast-light) *));

@source "../../../../packages/theme/src/components";
@source "../../../../packages/git-ui/src";
```

- **Preflight included.** shadcn's `border` utilities rely on preflight's `border: 0 solid`; without it, `border` sets a width with style `none`. git-ui already renders under preflight in Space, so its markup is proven under it. `tests/layout/webview-layout.spec.ts` guards the webview's own boxes.
- **`theme(inline)`.** Tailwind 4.3.3 appends the option to every `@theme` in the imported file (`dist/lib.js`, `E.startsWith("theme(")`). Utilities then emit `var(--kira-*)` directly and resolve per element. They are not fixed by a `:root`-computed `--color-*`. That is what lets `body.vscode-light`/HC overrides reach shadcn controls.
- **`kira-bridge.css`** (new, webview-only, never imported in Space: it would form a cycle with `vscode-bridge.css`).
  - One `:root, body { … }` block maps every `--kira-*` that `tailwind-core.css` or `packages/theme/src/components/**` references onto an existing `--kv-*`.
  - Examples:
    - `--kira-bg` ← `--kv-app-bg`
    - `--kira-bg-elevated` and `--kira-bg-chrome` ← panel background
    - `--kira-bg-input` ← `--kv-input-bg`
    - `--kira-fg` ← app foreground
    - `--kira-fg-muted` and `--kira-fg-subtle` ← `--kv-description-fg`
    - `--kira-border` ← panel border
    - `--kira-border-strong` ← strong border
    - `--kira-focus` ← `--kv-focus-border`
    - `--kira-accent` and `--kira-accent-fg` ← button bg and fg
    - `--kira-select` and `--kira-hover` ← row selected and hover bg
    - `--kira-error` ← `--kv-error-fg`
    - `--kira-t-*`, `--kira-control-h*`, `--kira-radius*`, `--kira-font-ui`/`-data`, `--kira-shadow*` ← their `--kv-*` structural counterparts
    - `--kira-border-width` ← 1px via the `--kv-*` structural token that already holds it
  - The implementer derives the exact list from `rg -o 'var\(--kira-[a-z0-9-]+' packages/theme/src/tailwind-core.css packages/theme/src/components`.
  - A `--kira-*` with no `--kv-*` counterpart gets a new `--kv-*` in `vscode-tokens.css` (the one file allowed colour literals), never a literal in the bridge.
  - Declared on `body` as well as `:root` so body-level light/HC redefinitions of `--kv-*` flow through.
  - The same block re-declares `shadcn-bridge.css`'s four names (`--primary`, `--primary-foreground`, `--muted-foreground`, `--border`) on `body` with the same right-hand sides. They are computed on `:root` otherwise, so light kinds would miss the body override.
- **Aliases.**
  - Add `resolve.alias['@theme']` = `packages/theme/src` to `packages/git-ui/vite.config.ts` and to `commitMetaHarnessServer.ts`'s inline config.
  - Add `"@theme/*": ["../theme/src/*"]` to `packages/git-ui/tsconfig.json` `paths`, and the matching entry to `apps/kira-space-vscode/tsconfig.json`.
  - `bun test` resolves `@theme` through the importing package's tsconfig `paths`. Confirm this with `test:unit` once Part 2's `refBadges.ts` import lands. Part 1 has no `.ts` importer.
- **Harness.** `commitMetaHarness.entry.ts` imports the new webview `tailwind.css` before git-ui's theme files, so migrated `DetailPane` children render in Part 2.
- **Guard.** Extend `scripts/check-tokens.sh` with one more layer: every `var(--kira-…)` in `packages/theme/src/tailwind-core.css` and `packages/theme/src/components` must be defined in `apps/kira-space-vscode/src/webview/kira-bridge.css`. That catches a future shadcn component that reads a `--kira-*` the webview lacks.

Portals: reka's `DialogPortal`/`PopoverPortal`/`TooltipPortal` teleport to `body`. That is inside `:root, body` in both hosts, and inside Space's `.dark` `html`. `KuiDialog` already teleports to `body`, so there is no change in where dialogs land.

## 4. Call-site rules (phase-wide)

### 4.1 Prefix discipline

- A shadcn component tag (anything imported from `@theme/components/ui/*` or `@theme/components/*`) takes **unprefixed** classes only. They merge through the theme's `cn` inside the component.
- A `kv:` token on a shadcn tag is an error, enforced by §7.
- Plain git-ui markup (divs, spans, labels, paragraphs) keeps `kv:` utilities. It is not converted: the `kv:` scale is the graph's sizing and theming system, and SPEC keeps it.
- Never both prefixes for the same CSS property on one element.

### 4.2 Arbitrary values

The P110 escape-hatch ladder applies to unprefixed classes as it does elsewhere. A `--kv-*` read from an unprefixed class (for example `h-(--kv-h-xs)` on a badge) is rung 4 (reads a custom property with no Tailwind scale step). Name that reason in a comment only where it is not obvious.

### 4.3 Sizing

shadcn controls keep their `kira*` sizes (`size="kira"`, `"kira-lg"`, `"kira-icon"`, `text-kira-md`).
- In Space these follow app chrome.
- In the webview they follow `--kv-t-*` and `--kv-control-h*` through `kira-bridge.css`, so they track VS Code's font size.
- Space's "Graph > Font size" (`git.graphFontSize`, non-zero) resizes grid text and `kv:` text but not shadcn buttons and inputs. Record this in `ARCHITECTURE.md` (Part 3). The Part 1 result section states it too, so the user can object before Part 2.

### 4.4 Other rules

- **Accessibility.** Carry over P104 §6.2 (explicit `aria-label` on icon-only triggers) and §6.3 (focusable wrapper span for a disabled tooltip trigger) unchanged.
- **Conversion rules.** P104 §9 applies:
  - one touch per file;
  - no wrapper layer around shadcn components (no `GitButton`);
  - VueUse for DOM composables;
  - no new unit tests (none of this is complex logic);
  - `<script setup lang="ts">` only.
- **Focus ring.** P130's at-rest ring in `tailwind-core.css`'s `@layer base` covers migrated controls in both hosts.

## 5. Component map (phase-wide)

| kira-ui | Replacement | Part |
|---|---|---|
| `KuiDialog` | `Dialog` + `DialogContent :show-close-button="false"` + `DialogHeader`/`DialogTitle` + body div + `DialogFooter` (§6.1) | 1 (dialogs), 2 (`WorktreeList`) |
| `KuiButton` default / primary / danger, in dialogs | `Button variant="dialog"` / `"dialog-primary"` / `"dialog-danger"`, `size="kira-lg"` | 1 |
| `KuiButton` elsewhere: default / primary / danger / icon | `variant="toolbar"` `size="kira"` / `"toolbar-primary"` / `"danger"` / `variant="toolbar" size="kira-icon"` + `aria-label`. `active` becomes `aria-pressed`, `count` becomes a `Badge variant="count"` child. The Part 2 plan confirms each against the rendered toolbar. | 2, 3 |
| `KuiSelect`, raw `<select>` | `NativeSelect variant="bordered" size="kira"` + `<option>` | 1, 2 |
| `KuiTextInput`, raw text `<input>` | `Input size="kira"` | 1, 2, 3 |
| raw `<textarea>` | `Textarea` | 1 |
| raw checkbox | `Checkbox` + `Label` (`v-model` boolean) | 1, 2 |
| raw radio set | `RadioGroup` + `RadioGroupItem` + `Label` | 1 |
| label/control stacks | `Field`/`FieldLabel` where a label wraps one control | 1, 2, 3 |
| `KuiSearchInput` | `InputGroup variant="kira"` + `InputGroupInput` (forwarding `role`, `aria-expanded`/`-controls`/`-activedescendant`/`-describedby`/`-invalid`/`-haspopup`, `keydown`) + `InputGroupAddon` icon (P104 §3) | 2, 3 |
| `KuiSegmented` | `ToggleGroup type="single"` + `ToggleGroupItem` per option, `String(value)`, null guard (P104 §3.1). Keep the badge span and its test id, renamed per §9. | 2, 3 |
| `v-kui-tooltip`, `KuiTooltip` | `Tooltip`/`TooltipTrigger as-child`/`TooltipContent` under one `TooltipProvider` (400/300, `disable-hoverable-content`) wrapping the root in `mount()` | 2, 3 |
| `data-kui-tip` (SlickGrid DOM) | `data-kira-tip` read by the hoisted `AttributeTooltip` (container = grid viewport), `TooltipAnchorBridge` pattern (P104 §6.4) | 2 |
| ref/PR badges (`refBadges.ts`) | `badgeVariants({ variant: 'chip' })` merged with `--kv-*` geometry overrides once at module level. `badgeVariants` moves to a `.vue`-free `badge/variants.ts`, re-exported from `badge/index.ts`, so `refBadges.test.ts` still loads under `bun test`. `.kv-badge-*` kind colours stay git-specific CSS. | 2 |
| `KuiContextMenu`, `RowContextMenu` | Point-anchored `DropdownMenu` with a 0×0 fixed trigger span (P104 §5.2) | 2, 3 |
| `KuiMenuList` + `KuiPopoverPanel` | `DropdownMenu` (action lists) or `Popover` (`BranchPicker`, `BaseSelector` pickers with search) | 2, 3 |
| force-delete popup (`App.vue` 955-976, `computeFloatPosition(pointReference)`) | `Popover` anchored to a point span | 2 |
| `computeFloatPosition` in `SearchBox`/`SearchResults` | `Popover` anchored to the input (`PopoverAnchor`) | 2 |
| `KuiColumnResizeHandle` | stays (SPEC) | — |
| `useModalFocus` | dropped: reka `FocusScope` inside `DialogContent` | 1, 2 |
| `cn` (kv), `kuiRowVariants`, `MenuItem`/`MenuSection`/`enabledNeighbour`/`firstEnabled` | moved into `packages/git-ui/src/lib/` (Part 3); `kuiRowVariants` retokened onto `--kv-*` | 3 |

## 6. Part 1 dialog conversion

### 6.1 Shell

Every `KuiDialog` becomes:

```vue
<Dialog :open="active" @update:open="(v) => !v && cancel()">
  <DialogContent :show-close-button="false" class="flex flex-col gap-0 p-3 w-120 max-w-[90vw] max-h-4/5">
    <DialogHeader><DialogTitle>{{ title }}</DialogTitle></DialogHeader>
    <div class="min-h-0 overflow-y-auto">…body…</div>
    <DialogFooter>…buttons, unchanged order…</DialogFooter>
  </DialogContent>
</Dialog>
```

- `w-120` is 480px. `max-w-[90vw]` preserves `min(480px, 90vw)`; it is an arbitrary literal (rung 5) with no scale step. `max-h-4/5` follows `GitCredentialDialog.vue`'s precedent (80% versus the old 85vh). Accept the 5% difference rather than add a literal.
- `v-if` guards on the `KuiDialog` (PostCheckoutPull, Pull, Reset, ForcePush) move onto `Dialog` unchanged.
- The `#title` slot (`ResetDialog.vue`) becomes `DialogTitle`'s default slot.
- The `@close` handler each file passes today (`cancel`, `onClose`, `closeDialog`, `notNow`, `close`) is the one `@update:open` calls on `false`. Escape and outside pointer-down both route through it, as `KuiDialog` did.
- Suppress reka's missing-description warning with `:aria-describedby="undefined"` on `DialogContent`, unless the dialog has a natural one-line description worth wiring through `DialogDescription`. Follow whichever the existing Space dialogs do.
- `DialogFooter` alignment must match `KuiDialog`'s right-aligned 4px gap. Adjust with unprefixed classes on `DialogFooter` if its default differs, and confirm live.
- Body markup keeps its `kv:` classes. The body is plain markup, not a shadcn tag.

### 6.2 Controls

- **Buttons.** Map per §5; keep order, `:disabled`, test ids.
- **Text inputs and textareas.** Use `Input size="kira"` or `Textarea`, with `v-model` and existing `id`/`aria-*`/test ids. Drop the old `kv:` border/bg classes that duplicated the control's own look.
- **Checkboxes.**
  - `<label><input type="checkbox" v-model="x"> Text</label>` becomes `<Label class="…"><Checkbox v-model="x" /> Text</Label>`. Wrapping keeps click-to-toggle without new ids.
  - Where `:indeterminate` or `:disabled` is used, map it to Checkbox's `model-value="indeterminate"` or `disabled`.
- **Radios.**
  - Each radio set becomes one `RadioGroup` with `v-model`, or `:model-value` + `@update:model-value` where the file calls a handler (`ResetDialog.vue`'s `selectMode`).
  - Use one `RadioGroupItem :value` per option inside a `Label`.
  - Existing per-radio `disabled` stays per item.
- **Selects.** `KuiSelect`'s `{value,label}[]` options become `<option v-for>` inside `NativeSelect`. `@update:model-value` handlers (for example `onDateFormatChange`) keep receiving a `string`, so no cast changes.
- **`radio-group` pull (§0).**
  1. Run `curl -sS https://shadcn-vue.com/r/styles/reka-nova/radio-group.json`.
  2. Write the files under `packages/theme/src/components/ui/radio-group/`.
  3. Rewrite `@/lib/utils` to `@theme/lib/utils`.
  4. Rename shadcn colour and radius aliases to kira names until `check_alias` passes.
  5. Pull no `registryDependencies` beyond what exists.
  6. Its `lucide` indicator icon uses the already-declared `@lucide/vue`.
  7. Run `bun run format`.
  8. No new package.

### 6.3 Per file

| File | Kui* | Raw controls to convert | Notes |
|---|---|---|---|
| `BranchDialog.vue` | Dialog, 2 Button | text, checkbox | |
| `CheckoutDialog.vue` | Dialog, 3 Button | — | title from template literal |
| `CherryPickDialog.vue` | Dialog, 2 Button | radio set, text | |
| `ForcePushDialog.vue` | Dialog, 3 Button | checkbox, text | one button sits in the body (see its own comment) and stays there |
| `PostCheckoutPullDialog.vue` | Dialog, 2 Button | — | `v-if="pending"` |
| `PullDialog.vue` | Dialog, 2 Button | — | `v-if="pending"` |
| `RenameRefDialog.vue` | Dialog, 2 Button | text | |
| `RepoSettingsDialog.vue` | Dialog, 2 Button, 5 Select | text, textarea, 4 checkboxes, 1 `<select>` | largest file |
| `ResetDialog.vue` | Dialog, 3 Button | 3-radio set, checkbox, token text | `#title` markup; `selectMode` handler |
| `RevertDialog.vue` | Dialog, 2 Button | radio set, text | |
| `StackDialog.vue` | Dialog, 5 Button | 1 `<select>` | |
| `StashDialog.vue` | Dialog, 8 Button | radio sets, checkboxes, texts | four modes, one shell |
| `TagDialog.vue` | Dialog, 2 Button | text, textarea, 2 checkboxes | |
| `WorktreeDialog.vue` | Dialog, 7 Button | 3-radio set, checkbox, texts | two phases, one shell |
| `PreflightPrediction.vue` | — | checkbox | rendered inside dialogs |

After Part 1: `rg -n "@kira/kira-ui|Kui[A-Z]|<input|<textarea|<select" packages/git-ui/src/components/dialogs` returns nothing, except a raw `<input>` a file needs for a type shadcn has no control for. None is expected; justify any hit in the result section.

## 7. Lint guards

- **`scripts/check-class-conflicts.ts`.** It already scans git-ui and splits tokens by `kv:` prefix. Add one rule: in `packages/git-ui/src/**/*.vue`, a tag whose name is imported from `@theme/components/**` must carry no `kv:` token in `class`/`:class`. Report the file:line.
- **`scripts/check-theme-classes.sh`.** Extend `check_alias`, `check_focus_width`, the host pass of `check_font_scale` and the radius guard to scan **unprefixed** tokens in `packages/git-ui/src`.
  - Match only tokens not beginning with `kv:`, via a leading `(?<![\w:-])(?!kv:)` on the existing pattern.
  - Keep the `kv:` passes as they are. The kv root defines its own radius and focus recipe, which is why those guards were "never extended to GU/KU".
  - Update the comments that say so.
- **`scripts/check-tokens.sh`.** Add the webview `--kira-*` layer (§3.3).
- **Proof step (not committed).** Plant one deliberate violation of each new rule in a scratch copy, confirm the guard fails, then remove it.

## 8. Steps and commits

Commits land in this order, each passing the pre-commit hook. `bun run typecheck:git` + `lint` + the relevant build run per commit (cheap). The expensive suites run once at the end (§9).

1. `refactor(theme): split host-neutral Tailwind core out of base.css`: `tailwind-core.css`, `base.css`, `shadcn-bridge.css` (dark variant moved out). Run the built-CSS diff for Space and Studio (§3.1).
2. `feat(space): scan git-ui sources from the app Tailwind root`: `apps/kira-space/frontend/src/styles.css`, `main.ts` one line.
3. `feat(vscode): unprefixed Tailwind root and --kira-* bridge for the webview`: webview `tailwind.css`, `kira-bridge.css`, webview `main.ts` import, `@theme` alias in `packages/git-ui/vite.config.ts` + harness server, `paths` in both tsconfigs, harness entry import, any new `--kv-*` in `vscode-tokens.css`, `check-tokens.sh` layer.
4. `feat(theme): add shadcn-vue radio-group`.
5. `chore(lint): guard unprefixed shadcn classes in git-ui`: §7's two script changes.
6. `refactor(git-ui): confirm dialogs onto shadcn Dialog and Button`: Checkout, PostCheckoutPull, Pull, ForcePush.
7. `refactor(git-ui): ref-name dialogs onto shadcn controls`: Branch, RenameRef, Tag.
8. `refactor(git-ui): cherry-pick and revert dialogs onto shadcn controls`.
9. `refactor(git-ui): reset dialog and preflight prediction onto shadcn controls`.
10. `refactor(git-ui): stash dialog onto shadcn controls`.
11. `refactor(git-ui): worktree dialog onto shadcn controls`.
12. `refactor(git-ui): stack dialog onto shadcn controls`.
13. `refactor(git-ui): repository settings dialog onto shadcn controls`.
14. Follow-up `fix(…)` commits for whatever §9 finds, one per finding.
15. `docs: ARCHITECTURE records git-ui's two-host shadcn plumbing (P131 Part 1)`: Styling/Frontend baseline rows, the Theme section, and the "never `--kira-*`" note. That note stays true for `kv:` markup, but the webview now has a bridged `--kira-*` for shadcn controls.
16. `docs(v2.0): P131 Part 1 result`.

Rebase over P129's `main.ts` and `ARCHITECTURE.md` edits if they land first. Both are small, textual and conflict-only.

## 9. Verification

Run once, near the end of Part 1:

- `bun run typecheck:git` and the full `bun run typecheck` (pre-commit runs it; set up per DEV_ENVIRONMENT.md), then `bun run lint`, `bun run build:space` and `bun run build:vscode`.
- `bun run test:unit`: kira-ui, git-ui and workbench specs unchanged and green.
- `bun run test:webview`: both layout and interaction projects. Watch `webview-layout.spec.ts` (preflight) and `graph-dialog-reconnect.spec.ts` (dialog role/name).
- `bun run test:ui:space`.
- Built-CSS diff from §3.1. If it is not identical: `bun run test:ui:studio`.
- **Live, Kira Space.**
  - Run `bun run dev:space` (or the `run` skill), open a repo's graph, and open every dialog: Branch, Tag, Rename, Checkout, CherryPick, Revert, Reset (soft/mixed/hard), Stash (four modes), Worktree (both phases), Stack, Pull, PostCheckoutPull, ForcePush, Repository settings.
  - Check each: Escape and outside click close it; focus lands inside and returns on close; Tab stays trapped; radios, checkboxes and selects change state.
  - Screenshots in the result section.
- **Live, VS Code webview.**
  - Where a VS Code install is available, run the extension (`code --extensionDevelopmentPath=apps/kira-space-vscode`) with a dark and a light theme, and open the same dialogs.
  - In this sandbox, serve the built webview with `apps/kira-space-vscode/tests/support/webviewServer.ts`'s fake host in Playwright Chromium, once with `body.vscode-dark` and once with `body.vscode-light`, and screenshot each dialog.
  - Record which of the two was run. If only the sandbox form was possible, say so plainly and leave the real-VS-Code check for the user.
  - In both runs, confirm `getComputedStyle` of a dialog `Button` and `Input` resolves to the `--kv-*` host value (for example `--kv-input-bg` light literal `#ffffff` under `vscode-light`), not to Space's `--kira-*` palette.

## 10. Closing audit

Report each item as a real check, with the command and its result, in the result section.

| Check | Command | Expect |
|---|---|---|
| No kira-ui in dialogs | `rg -n "@kira/kira-ui\|Kui[A-Z]\|useModalFocus" packages/git-ui/src/components/dialogs` | empty |
| No raw form control in dialogs | `rg -n "<input\|<textarea\|<select" packages/git-ui/src/components/dialogs` | empty (or each justified) |
| shadcn components really used | `rg -n "from '@theme/components/ui/(dialog\|button\|input\|textarea\|checkbox\|radio-group\|native-select\|label\|field)'" packages/git-ui/src/components/dialogs` | every dialog file imports at least Dialog + Button |
| No `kv:` on a shadcn tag | `bun run lint` (§7 rule) | green |
| Webview CSS carries shadcn utilities | `rg -o "\.bg-primary\|\.rounded-kira-sm\|data-open\\\\:animate-in" apps/kira-space-vscode/dist/ui/assets/*.css` | present |
| Every webview `--kira-*` resolves | `sh scripts/check-tokens.sh` | new layer green |
| Space CSS has git-ui's shadcn classes | grep the built Space CSS for a class used only in a git-ui dialog (for example `w-120`) | present |
| No stray unprefixed class in git-ui markup | list git-ui `class` tokens without `kv:` on non-shadcn tags; intersect with built Space CSS selectors | only intended hits |
| Space/Studio core refactor is a no-op | §3.1 diff | identical, or each difference explained |
| No wrapper layer | `rg -n "defineComponent\|<script>(?! setup)" packages/git-ui/src/components/dialogs` and no new `Git*Button`-style file | empty |

## 11. Risks

- **Two Tailwind roots in one document (Space).** This is already true today (`kv:` root plus app root). Part 1 adds no third root in Space. In the webview it adds a second one. Both emit `@layer theme, base, components, utilities`; layers with the same name merge across stylesheets, and prefixes keep their utilities disjoint. Preflight's element resets now apply in the webview. That is expected, and covered by the layout spec.
- **`theme(inline)` changes utility output only in the webview root.** Space keeps non-inline `@theme` from `base.css`. The reverse bridge sits on `body`, so any shadcn utility reading a `--color-*` variable directly (not via the utility) would read the `:root` value. `rg 'var\(--color-' packages/theme/src/components` must be empty, or each hit gets checked live under `vscode-light`.
- **reka focus return with no `DialogTrigger`.** Dialogs are opened from state, not a trigger. Reka's `FocusScope` restores focus to the element focused before mount, which matches `useModalFocus`. The live check confirms it for one menu-opened dialog (Reset from a row menu).
- **Portal plus outside-click inside nested popovers.** None in Part 1 (no dialog hosts a popover). This matters for Part 2's pickers.

## 12. Acceptance

The SPEC row's own wording, split by part:

| SPEC wording | Part 1 | Parts 2-3 |
|---|---|---|
| "(1) Settle first how shadcn's unprefixed utilities and tokens reach both hosts … The plan decides and records it." | §3 decided; implemented in commits 1-3; recorded in `ARCHITECTURE.md` (commit 15). | — |
| "(2) Swap every `Kui*` call site … The plan maps each component." | Map in §5. Dialog call sites swapped: 14 `KuiDialog`, 45 `KuiButton`, 5 `KuiSelect`. | Remaining call sites. |
| "(3) … Badges take `badgeVariants` … Cell tooltips go through one shadcn Tooltip … `TooltipAnchorBridge`" | Decided (§5). | Part 2 implements. |
| "(4) `KuiColumnResizeHandle` … stays. The `kv:` token scale stays … Delete each `Kui*` component left with no consumer" | `kv:` scale untouched (§4.1). | Part 3 deletes. `StreamView.vue`/`floatingPosition.ts` keep kira-ui. |
| "no `Kui*` import left in `git-ui` except `KuiColumnResizeHandle`" | True for `components/dialogs/` (§10). | Part 3 closes it package-wide. |
| "`test:ui:space`, `test:webview` and `test:unit` pass" | All three green at Part 1's end (§9). | Each part re-runs them. |
| "A live Kira Space run and a VS Code webview run of graph and review both show shadcn controls, each in its own host's theme" | Dialogs shown live in both hosts, dark and light kinds in the webview (§9). | Part 2 (graph), Part 3 (review and final). |
