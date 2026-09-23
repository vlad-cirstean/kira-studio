# P105 — fix every remaining `.vue` accessibility finding; delete the `a11y: off` override

Plan for `docs/v1.9/SPEC.md`'s P105 row. Written against the tree at `129bb25d` (P104 landed, plus
the four follow-up Tailwind arbitrary-value batches).

One rule governs everything below: **P105 changes accessibility semantics only.** Spacing, sizing,
colour tokens, component-library adoption and primitive replacement are P104's territory and the
Tailwind sweep's — both already landed. A diff line in this phase that does not change a role, a
name, a keyboard path, a focus path or an element's semantics does not belong to this phase.

Second rule: **the override's deletion is the acceptance test, not a separate check.** `biome.json`
must end this phase with no `a11y` entry in its `**/*.vue` override, and `bun run lint` must pass
clean in a normal (non-bypassed) commit.

---

## 0. What SPEC leaves open, and how each is resolved

| Open point | Resolution | Where |
|---|---|---|
| "whatever else P104's component swaps introduce or remove" | Re-measured: 254 findings, 13 rules, 95 files. Two rules the SPEC row never names (`noNoninteractiveTabindex` 81, `useAriaPropsSupportedByRole` 11) are now the 1st and 6th largest | §1 |
| Which markup actually satisfies each rule | Every fix pattern below was verified empirically against Biome in this worktree, not inferred from rule docs | §3 |
| P104's 78 `<span tabindex="0">` disabled-tooltip wrappers, which Biome rejects and shadcn-vue documents | One shared component owns the pattern; exactly one documented suppression, in that component | §4 |
| Findings inside vendored upstream `components/ui/*` source | Fixed in place where the fix is upstream-compatible; suppressed with the divergence named where not | §16 |
| Scope of "fix" for findings that are Biome misreading a Vue component prop | Rename the prop, not suppress — `:scope` is a real name collision with the HTML attribute | §13 |
| When implementation may start | Only after P107 merges into `v1.9` | §19 |

---

## 1. Confirmed current state (measured, not inherited from P104)

### 1.1 Method

`biome.json`'s `**/*.vue` override had its `"a11y": "off"` line removed in this worktree, then
`biome check . --max-diagnostics=2000 --reporter=json` was run over the whole repo, and
`biome.json` was restored with `git checkout` (working tree confirmed clean afterwards). The JSON
reporter, not the pretty one, so nothing is truncated: `diagnosticsNotPrinted: 0`.

P104's own §10.4 recount was also run over only `apps/kira-studio/frontend/src packages/git-ui/src
packages/kira-ui/src` for comparison: **219 findings**. The 35-finding gap is the whole point of
running it over `.` instead — the override is repo-wide, so the phase is not done until
`packages/theme`, `packages/workbench` and `apps/kira-space` are clean too.

### 1.2 Totals

**254 findings, 13 rules, 95 files.** Identical to P104 §10.4's figure, rule for rule. The four
Tailwind batches that landed after P104's count shifted no a11y finding, as expected — they touched
`class` attributes only.

| Rule | Count | Files | Section |
|---|---:|---:|---|
| `noNoninteractiveTabindex` | 81 | 27 | §4 |
| `noStaticElementInteractions` | 62 | 40 | §5 |
| `useKeyWithClickEvents` | 46 | 30 | §6 |
| `useSemanticElements` | 20 | 16 | §7 |
| `noAutofocus` | 14 | 12 | §8 |
| `useAriaPropsSupportedByRole` | 11 | 9 | §9 |
| `useButtonType` | 5 | 4 | §10 |
| `useFocusableInteractive` | 4 | 4 | §11 |
| `noLabelWithoutControl` | 4 | 1 | §12 |
| `noHeaderScope` | 3 | 3 | §13 |
| `noNoninteractiveElementToInteractiveRole` | 2 | 2 | §14 |
| `useAriaPropsForRole` | 1 | 1 | §15 |
| `noSvgWithoutTitle` | 1 | 1 | §15 |

### 1.3 Where they live

| Area | Findings |
|---|---:|
| `apps/kira-studio/frontend/src/views` | 110 |
| `packages/git-ui/src` | 44 |
| `apps/kira-space/frontend` | 29 |
| `apps/kira-studio/frontend/src/workbench` | 25 |
| `apps/kira-studio/frontend/src/api` | 16 |
| `packages/kira-ui/src` | 9 |
| `apps/kira-studio/frontend/src/project` | 7 |
| `apps/kira-studio/frontend/src/shortcuts` | 4 |
| `apps/kira-studio/frontend/src/terminal` | 4 |
| `packages/theme/src` | 3 |
| `packages/workbench/src` | 3 |

Ten files carry 5 or more: `views/stream/StreamView.vue` (22),
`views/shared/keyvalue/KeyValuePane.vue` (8), `apps/kira-space/.../repo/GitPanel.vue` (7),
`views/console/ConsoleView.vue` (7), `workbench/settings/ApiPane.vue` (7),
`workbench/settings/AppearancePane.vue` (7), `apps/kira-space/.../settings/AppearancePane.vue` (5),
`views/grid/DataView.vue` (5), `views/httprequest/HttpRequestView.vue` (5),
`git-ui/components/BranchPicker.vue` (5), `git-ui/components/dialogs/RepoSettingsDialog.vue` (5).

### 1.4 The overlap that shrinks the work

`noStaticElementInteractions` and `useKeyWithClickEvents` are largely the same elements seen twice:

- **40 elements** carry both — a static `<div>`/`<span>` with `@click`, no role, no keyboard path.
  One correct fix per element clears **80 of the 254 findings**.
- **22 elements** are `noStaticElementInteractions` only — container-level `@keydown`,
  `@contextmenu`, or drag-surface listeners, with no click at all (§5.1).
- **6 elements** are `useKeyWithClickEvents` only — they already carry a role, and only lack the
  keyboard handler (§6.2).

So the real unit of work is **~185 elements**, not 254 findings.

---

## 2. Scope

### 2.1 In scope

- Every one of the 254 findings, across all four areas the override covers (`apps/kira-studio`,
  `apps/kira-space`, `packages/*`), reaching zero.
- Deleting `"a11y": "off"` from `biome.json`'s `**/*.vue` override.
- Structural markup changes where a role cannot be made honest without one: the three nested
  close-affordances of §11, the `<nav role="tablist">` of §14.
- One shared component extraction (§4) and one shared resize-handle extraction (§5.2), both because
  they are the only way to keep the suppression count at one per pattern.

### 2.2 Declined, each with the requirement named

- **`:tabindex="0"` instead of `tabindex="0"`.** Verified: Biome's Vue analyzer reads static
  attributes only, so a bound `tabindex` silences `noNoninteractiveTabindex` completely. This is
  evasion, not a fix — the rendered DOM is identical and the finding is real. **Forbidden
  everywhere in this phase**, including as a "temporary" step.
- **`role="button"` on the §4 wrappers.** Verified: trades 81 `noNoninteractiveTabindex` for 81
  `useSemanticElements`, because Biome wants a real `<button>` for that role. Net zero.
- **`role="menuitem"` / `"tab"` / `"treeitem"` / `"option"` on the §4 wrappers.** Verified clean,
  and rejected: each is a semantic lie that an assistive technology would act on.
- **Converting the 76 disabled `<Button>` sites to `aria-disabled` + click guards** (§4.3). Named
  and declined on risk, not on effort.
- **Per-site `biome-ignore` at scale.** A suppression is acceptable once, in one shared place, with
  the requirement written next to it. Eighty copies of it is the override under another name.

### 2.3 Not in scope, confirmed not forgotten

- Spacing, sizing, arbitrary-bracket utilities, colour tokens — P104 and the Tailwind sweep.
- Replacing any further hand-rolled primitive with a `components/ui` one — P104's closing audit
  already proved none remains.
- The `--color-muted` collision — already P110's own row.
- Axe/Playwright accessibility assertions. Nothing in the SPEC row asks for a new test suite, and
  `CLAUDE.md`'s unit-test bar does not reach markup attributes.

---

## 3. Verified fix vocabulary

Every pattern below was run through Biome in this worktree with a11y enabled, in a throwaway
`.vue` file that was deleted afterwards. **Clean** means no a11y finding at all.

| Markup | Result |
|---|---|
| `<span tabindex="0">` | `noNoninteractiveTabindex` |
| `<span tabindex="0" role="button">` | `useSemanticElements` |
| `<span tabindex="0" role="group"\|"presentation"\|"none"\|"tooltip"\|"toolbar"\|"application">` | `noNoninteractiveTabindex` (still) |
| `<span tabindex="0" role="menuitem"\|"tab"\|"treeitem"\|"option">` | clean |
| `<span :tabindex="0">` | clean (analyzer blind spot — see §2.2) |
| `<span tabindex="-1">` | clean |
| `<div @click @keydown>` (no role) | `noStaticElementInteractions` |
| `<div role="button" tabindex="0" @click @keydown>` | `useSemanticElements` |
| `<div role="option" tabindex="0" @click @keydown>` | clean |
| `<div role="option" tabindex="-1" aria-selected @click @keydown>` | clean |
| `<span aria-hidden="true" @pointerdown @click.stop>` | clean |
| `<div role="group" aria-label>` / `aria-labelledby` | `useSemanticElements` |
| `<fieldset aria-label>` | clean |
| `<section aria-label>` | clean |
| `<span role="img" aria-label>` | clean |
| `<hr>` | clean |
| `<svg aria-hidden="true">` | clean |
| `<div role="tablist" aria-label>` wrapping `<button role="tab">` | clean |
| `<!-- biome-ignore lint/a11y/<rule>: reason -->` before a template element | suppresses that element only |

The last row matters: Biome's HTML-comment suppression works inside a Vue `<template>`, and it
suppresses exactly one element — the one on the next line, not the block.

---

## 4. `noNoninteractiveTabindex` — 81, 27 files

### 4.1 What they are

80 of the 81 are literally the same eight characters: P104 §6.3's disabled-control tooltip wrapper,

```vue
<Tooltip>
  <TooltipTrigger as-child>
    <span tabindex="0" class="inline-flex">
      <Button :disabled="running" @click="runStatement">Run</Button>
    </span>
  </TooltipTrigger>
  <TooltipContent>Run the statement under the cursor</TooltipContent>
</Tooltip>
```

copied across 26 files. What the wrappers contain, counted: **76 `<Button>`, 2 `<button>`,
1 `<Input>`, 8 where the wrapper's child is a bare `<CodiconIcon>`** (some wrappers contain both a
control and an icon, so these overlap).

The 81st is `api/VariableRow.vue:190` — `<Label class="secret-toggle" tabindex="0">`, the same idea
applied to a shadcn `Label` instead of a span. Same treatment, same section.

The pattern is deliberate and documented: Blink dispatches no pointer or focus event on a
`disabled` control, so a stock `TooltipTrigger` on a disabled `<Button>` never fires, and several
of these tips exist only to explain *why* the control is disabled. It is also shadcn-vue's own
documented answer for a tooltip on a disabled trigger. Biome's rule disagrees with the library, and
offers no option to narrow it.

### 4.2 Fix — one shared component, one documented suppression

Extract the whole pattern into **`packages/theme/src/components/ui/tooltip/TooltipDisabledTrigger.vue`**
(`<script setup lang="ts">`, per `CLAUDE.md`), exported from that directory's `index.ts`:

```vue
<!-- Blink dispatches no pointer/focus event on a disabled control, so a TooltipTrigger placed
     directly on one never fires; several tips exist only to explain the disabled state. shadcn-vue
     documents this focusable wrapper as the answer. Biome's rule has no option to allow it, and
     every role that silences it (menuitem/tab/treeitem/option) would be a semantic lie. -->
<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: see comment above -->
<span tabindex="0" class="inline-flex" :aria-describedby="undefined">
  <slot />
</span>
```

Then every call site becomes `<TooltipTrigger as-child><TooltipDisabledTrigger><Button …/></TooltipDisabledTrigger></TooltipTrigger>`.

Net effect: 81 findings → 0, one suppression in one file, and 79 copies of duplicated markup
deleted. The suppression is an exception with its requirement written beside it, which is what
`CLAUDE.md`'s library rule asks for when declining the linter's preferred shape — it is not the
override in miniature, which covered all 266 `.vue` files and 13 rules.

**Before writing this component, grep for one P107 may already have created.** Consolidating 79
copies of one markup block is squarely P107's subject matter, and P107 lands first (§19). If it
already extracted a wrapper, add the suppression and the comment to *that* component and delete
nothing else; never introduce a second.

### 4.3 The alternative, named and declined

Dropping `disabled` in favour of `:aria-disabled` on the `<Button>` is the WAI-ARIA answer and
would delete the wrapper outright. It is declined here for two concrete reasons, not for effort:

1. `buttonVariants` (`packages/theme/src/components/ui/button/index.ts`) styles the disabled state
   through `disabled:pointer-events-none disabled:opacity-50` on the base plus `disabled:opacity-45`
   on four variants. `aria-disabled` fires none of them, so every one needs an `aria-disabled:` twin
   — editing the vendored shadcn-vue component, which is P104's territory and a standing upstream
   divergence.
2. An `aria-disabled` button is still clickable. All 76 sites would need a click guard, and the
   handlers behind them include `runStatement`, `runAll` and delete actions. One missed guard fires
   a destructive action from a control that looks disabled. That is a behaviour change, and P105 is
   a semantics phase.

Dropping `tabindex="0"` and keeping the span also silences the rule, and is declined because it
deletes the only keyboard path to those tooltips — an accessibility regression inside an
accessibility phase.

---

## 5. `noStaticElementInteractions` — 62, 40 files

Three sub-classes, each with its own fix. Counted, not estimated.

### 5.1 Container-level listeners, no click — 22 elements

Every one is a `<div>` that exists for layout and carries a delegated `@keydown` (a
keyboard-shortcut scope), a `@contextmenu.prevent` (a tree background), or drag-surface handlers:

| File | Line | Handlers |
|---|---:|---|
| `apps/kira-space/.../repo/GitPanel.vue` | 364 | `@keydown` |
| `apps/kira-space/.../repo/RepoFileTree.vue` | 87 | `@contextmenu.prevent`, `@scroll` |
| `apps/kira-space/.../repo/RepoSearchView.vue` | 98 | `@keydown` |
| `api/CollectionsPanel.vue` | 154 | `@keydown` |
| `api/CollectionsTree.vue` | 157, 158 | `@contextmenu.prevent`, `@scroll`, `@keydown` |
| `api/EnvironmentsView.vue` | 225 | `@keydown`, `@dragstart`, `@dragover.prevent`, `@dragend` |
| `api/VariableRow.vue` | 120 | same drag set |
| `project/ProjectTree.vue` | 179, 180 | `@contextmenu.prevent`, `@scroll`, `@keydown` |
| `terminal/TerminalPanel.vue` | 139 | `@keydown` |
| `views/grpcrequest/MetadataTable.vue` | 209 | `@keydown` |
| `views/httprequest/FieldRowsTable.vue` | 264 | `@keydown` |
| `views/shared/ResponseFindBar.vue` | 132 | `@keydown` |
| `views/shared/celleditor/CellEditorView.vue` | 623 | `@keydown`, `@focusout` |
| `views/shared/page/SearchToolbar.vue` | 250 | `@keydown` |
| `views/stream/StreamSearchToolbar.vue` | 98 | `@keydown` |
| `workbench/panels/ProjectPanel.vue` | 32 | `@keydown` |
| `git-ui/components/BranchPicker.vue` | 581, 615 | `@keydown`, `@keydown.escape` |
| `git-ui/components/FileTree.vue` | 487 | `@keydown` |
| `git-ui/components/review/BaseSelector.vue` | 113 | `@keydown`, `@keydown.escape` |

**Fix: move the listener out of the template into `useEventListener` from VueUse**, bound to a
template ref for that container. The DOM attribute disappears, so the rule is silent; the element
genuinely is not interactive, so nothing is being hidden. This is also what `CLAUDE.md` already
requires — "a browser/DOM composable … event-listener wiring … comes from VueUse" — so these 22
sites are a standing-rule violation that happens to also be a lint finding.

Do not reach for `role="group"`/`"presentation"` here: verified, `presentation` does not silence
the rule, and `group` trades it for `useSemanticElements`.

### 5.2 Static elements with `@click` — 40 elements (also §6)

These are the 40 that carry both rules. They split cleanly again:

**(a) Column resize handles — 10 in `views/stream/StreamView.vue` (lines 1070–1169).** Each is
`<span class="resize-handle" @pointerdown @pointermove @pointerup @click.stop>`; the `@click.stop`
exists only to stop the header's own sort click. They have no role, no name, no keyboard path.

`packages/git-ui/src/components/CommitGrid.vue` (lines 1216, 1231, 1246) already implements the
correct thing for the same job — `role="separator"`, `aria-orientation`, `aria-label`,
`aria-valuenow`/`min`/`max`/`valuetext`, `tabindex="0"`, and a `@keydown` that resizes by arrow key.

**Fix: extract one `ColumnResizeHandle.vue` carrying CommitGrid's pattern, and point both
StreamView's ten handles and CommitGrid's three at it.** That turns 10 findings-pairs plus 3
`useSemanticElements` findings into one component with one documented suppression (`<hr>`, which
Biome's `useSemanticElements` wants for `role="separator"`, cannot carry `aria-valuenow` or focus —
that is the named requirement). StreamView's columns gain real keyboard resizing, which is a
genuine win, not a lint-shaped one. Same P107 caution as §4.2: check first whether P107 already
extracted a resize handle.

Fallback, only if the extraction turns out to collide with P107's own work on those files: mark
StreamView's handles `aria-hidden="true"` (verified clean, since a pointer-only affordance that is
not exposed to AT is an honest description of what they are today) and suppress CommitGrid's three
separators in place. Take the fallback only with the collision named in the commit message.

**(b) Dismiss scrims and backdrops — 6 elements.** `apps/kira-space/.../repo/GitPanel.vue:647`,
`views/console/ConsoleSavedMenu.vue:150`, `views/shared/FilterHistoryMenu.vue:207` (all three the
same `<div class="prompt-scrim" @click.stop>`), `views/grid/FkPreviewPopover.vue:131`,
`shortcuts/CommandPalette.vue:30` and `:36`, plus `packages/kira-ui/src/KuiDialog.vue`'s
`@click.self="close"` backdrop.

**Fix: `onClickOutside` from VueUse on the panel element**, deleting the scrim's own handler; the
scrim then becomes a purely visual layer and takes `aria-hidden="true"`. Again this is the
`CLAUDE.md` VueUse rule, not a lint workaround. Where the scrim's `@click.stop` exists only to keep
a click inside the panel from reaching the backdrop, deleting the backdrop handler removes the need
for the stopper entirely.

**(c) List, tree and menu rows — the remaining ~24.** `project/TreeRow.vue:100`,
`api/CollectionRow.vue:103`, `apps/kira-space/.../repo/RepoTreeRow.vue:51`,
`.../RepoSearchRow.vue:53` and `:86`, `.../views/repo/RepoFileView.vue:292`,
`views/shared/document/DocumentRow.vue:35`, `views/shared/SavedListMenu.vue:59` and `:97`,
`views/grpcrequest/CallHistoryList.vue:132`, `views/httprequest/ResponseHistoryList.vue:168`,
`views/shared/keyvalue/KeyValuePane.vue:1102`, `views/browse/BrowseView.vue:491`,
`views/console/ConsoleResultGrid.vue:388`, `workbench/panels/OperationsPanel.vue:240`,
`terminal/TerminalPanel.vue:235`, `git-ui/components/FileTree.vue`,
`git-ui/components/review/ReviewCommitRow.vue`, `git-ui/components/BranchPicker.vue`,
`packages/kira-ui/src/KuiPopoverPanel.vue` (2).

**Fix, per row, in this order of preference:**

1. If the row is really a button and nothing nests inside it that must also be clickable → make it
   `<button type="button">`. Clears `noStaticElementInteractions`, `useKeyWithClickEvents` and
   `useButtonType` at once, and needs no role.
2. Otherwise give it the role its container already implies, plus focus and keys:
   `role="option"` inside a listbox, `role="treeitem"` inside a tree, `role="menuitem"` inside a
   menu, `tabindex="0"` (or `tabindex="-1"` where the container drives
   `aria-activedescendant` — verified clean), and `@keydown.enter`/`@keydown.space` bound to the
   same handler as `@click`.

Do not invent a role the surrounding markup does not support. Where the container has no
`role="listbox"`/`"tree"`/`"menu"`, add it in the same edit — a lone `role="option"` with no
`listbox` parent is worse markup than the `<div>` it replaced.

---

## 6. `useKeyWithClickEvents` — 46, 30 files

### 6.1 The 40 shared with §5.2

Same elements, cleared by the same edit. Do not fix them twice.

### 6.2 The 6 that are this rule only

Elements that already carry a role and only lack the keyboard handler:

| File | Line | Shape | Fix |
|---|---:|---|---|
| `views/console/ConsoleView.vue` | 877 | `<span class="result-close" role="button" @click.stop>` nested inside a `<button>` | §11 |
| `views/console/ExplainResultView.vue` | 134 | same close-inside-a-tab shape | §11 |
| `packages/workbench/src/components/TabStrip.vue` | 262 | same | §11 |
| `git-ui/components/SearchResults.vue` | 81 | `role="option"` with `@click`, focus driven by `aria-activedescendant` | add `tabindex="-1"` and `@keydown.enter` |
| `packages/kira-ui/src/KuiMenuList.vue` | 127 | menu row with `@click`, no keys | add `@keydown.enter`/`.space` |
| `packages/theme/.../input-group/InputGroupAddon.vue` | 27 | vendored shadcn-vue | §16 |

---

## 7. `useSemanticElements` — 20, 16 files

Four groups, all four with an exact target element.

**`role="button"` on a non-button — 6.** `api/DynamicValuesDialog.vue:114`,
`api/VariablesOverviewPanel.vue:128` (on a `<code>`), `views/console/ConsoleView.vue:879`,
`views/console/ExplainResultView.vue:137`, `git-ui/.../review/ReviewCommentsPane.vue:116`,
`packages/workbench/.../TabStrip.vue:264`. **Fix: a real `<button type="button">`.** For the
`<code>` case, `<button type="button"><code>…</code></button>` keeps the monospace rendering. Three
of the six are the nested-close shape and are handled together in §11.

**`role="radio"` — 5.** `api/VariableSetView.vue:535`, `project/ConnectionDialog.vue:638` and
`:738`, `workbench/settings/ScriptsPane.vue:175` and `:242` (colour swatches in a
`role="radiogroup"`). **Fix: shadcn-vue's `ToggleGroup`** (`packages/theme/src/components/ui/toggle-group`,
already vendored, single-select) for the pickers, per `CLAUDE.md`'s "component primitive comes from
shadcn-vue". Where the swatch grid is genuinely a form control rather than a toolbar toggle, the
alternative is a visually-hidden `<input type="radio">` inside a `<label>`. There is no
`radio-group` set vendored today; add it with `shadcn-vue add` rather than hand-rolling one, if the
implementer judges the toggle-group semantics wrong for the swatches.

**`role="separator"` — 5.** `packages/kira-ui/src/KuiMenuList.vue:126` is a decorative menu divider
→ **`<hr>`**, or the vendored `ui/separator` set with `decorative`. `git-ui/src/App.vue:1760` and
`CommitGrid.vue:1216`/`1231`/`1246` are focusable, value-bearing splitters → §5.2(a).

**`role="group"` — 4.** `git-ui/components/SearchBox.vue:273`,
`packages/kira-ui/src/KuiSegmented.vue:26`, and the two vendored ones in §16. **Fix: `<fieldset>`**
(verified clean with `aria-label`), or `<section aria-label>` where a fieldset's form semantics
would be wrong. `KuiSegmented` should be checked against `ui/toggle-group` first — if it is a
duplicate of a vendored primitive, P107 may already be deleting it.

---

## 8. `noAutofocus` — 14, 12 files

Eleven of the fourteen are in `packages/git-ui`, all inside dialogs:
`dialogs/StashDialog.vue` (3, lines 260/288/306), `dialogs/BranchDialog.vue:63`,
`dialogs/ForcePushDialog.vue`, `dialogs/RenameRefDialog.vue`, `dialogs/RepoSettingsDialog.vue`,
`dialogs/ResetDialog.vue`, `dialogs/TagDialog.vue`, `dialogs/WorktreeDialog.vue`,
`components/BranchPicker.vue:635`, `components/WorktreeList.vue`, `components/review/ReviewView.vue`,
plus `apps/kira-studio/.../api/ImportCurlDialog.vue:72`.

Biome objects because the dialog is `KuiDialog`, a custom `role="dialog"` component, not a native
`<dialog>` — so it cannot see the modal context.

**`KuiDialog` already focuses the first focusable element on open**, through
`useModalFocus(active, rootEl)` in `packages/kira-ui/src/modalFocus.ts`, which queries
`FOCUSABLE_SELECTOR` and focuses the first match on the next animation frame.

**Fix, per site:**

1. If the `autofocus`-ed control is the first focusable element inside the dialog body → **delete
   the attribute.** `useModalFocus` already does exactly what it was asking for; behaviour is
   unchanged. This covers most of the list — check, do not assume, by reading the template above
   the input.
2. If it is not first → delete the attribute and focus it explicitly: a template ref plus VueUse's
   `useFocus`, or a `watch` on the dialog's own `active` ref. Never leave it to `autofocus`.
3. `StashDialog.vue`'s three are mutually exclusive branches (`v-if`) on the same dialog; each is
   first-in-its-branch, so all three are case 1 — verify each branch, then delete all three.

Keyboard behaviour must not change. `apps/kira-studio/tests/ui/` covers several of these dialogs;
run them (§18).

---

## 9. `useAriaPropsSupportedByRole` — 11, 9 files

All eleven are the same message: `aria-label` on an element whose implicit role does not support an
accessible name — a bare `<div>` or `<span>`.

Two shapes:

**(a) Section containers with a visible title — 9.** `git-ui/components/StashList.vue:117`,
`GlobalStashList.vue:100`, `StackList.vue:88`, `TagList.vue:114`, `WorktreeList.vue:120`,
`BranchPicker.vue:621` and `:701`, `review/BaseSelector.vue:135` and `:148`. Every one is
`<div class="kv-branch-section" aria-label="Stashes">` immediately followed by
`<div class="kv-branch-section-title">Stashes</div>`.

**Fix: `<section :aria-labelledby="…">`** pointing at the title element (give it an `id` via Vue's
`useId()`), and drop the duplicated `aria-label`. Verified clean, removes the duplicate name, and
the label now tracks the visible text instead of drifting from it. `<section aria-label="…">` is
also clean if a title element is absent.

**(b) Status glyphs — 2.** `views/httprequest/HttpRequestView.vue:492` and
`views/grpcrequest/GrpcRequestView.vue:303`:
`<span class="dirty-mark" aria-label="Unsaved changes">•</span>` inside a `TooltipTrigger`.

**Fix: add `role="img"`** — verified clean, and correct: the bullet is a graphic conveying
"unsaved", and `img` is the role that takes an accessible name.

---

## 10. `useButtonType` — 5, 4 files

`views/httprequest/CookiesPane.vue:94` and `:155`, `views/httprequest/RequestSettingsPane.vue:278`,
`workbench/StatusBar.vue:112`, `apps/kira-space/.../workbench/StatusBar.vue:34`.

**Fix: add `type="button"`.** Five one-word edits. Check each is not a real form submit first; none
of the five sits in a `<form>`, but read before editing.

---

## 11. `useFocusableInteractive` — 4, 4 files

`git-ui/components/SearchResults.vue:81` is §6.2's listbox option.

The other three are one structural bug appearing three times: a tab-close affordance rendered as
`<span role="button" aria-label="Close …" @click.stop>` **nested inside the tab's own `<button>`**.
`views/console/ConsoleView.vue:877`, `views/console/ExplainResultView.vue:134`,
`packages/workbench/src/components/TabStrip.vue:262`. Each carries three findings between this rule,
§6.2 and §7 — nine findings for one shape.

It cannot be fixed by adding `tabindex`: a focusable control inside a `<button>` is invalid HTML,
and it is why the close control is unreachable by keyboard today.

**Fix: make the close control a sibling of the tab button, not a child.** The tab becomes
`<div class="tab" role="presentation">` (or keeps its existing wrapper) containing
`<button type="button" class="tab-main">` and `<button type="button" class="tab-close">`. Preserve
every `data-testid` verbatim (`tab-close`, `console-result-close`) — the selectors are what
`apps/kira-studio/tests/ui/` uses. This is the one genuinely structural change in the phase; give
it its own commit and run the UI suite against it (§18).

---

## 12. `noLabelWithoutControl` — 4, 1 file

All four in `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` (lines 193, 216, 269,
285), each `<label class="kv-dialog-field">Commit date <KuiSelect … /></label>`. The control is a
Vue component, so Biome cannot see an input inside the label.

**Fix: shadcn-vue's `ui/label` with an explicit association**, which P104 already adopted across the
repo — `<Label :for="id">Commit date</Label>` plus `:id="id"` on the control, `id` from Vue's
`useId()`. Requires `KuiSelect` to forward `id` to its rendered control; if it does not, forward it
there in the same commit, or swap the field to the vendored `ui/select` equivalent if P107's work
already replaced `KuiSelect`.

---

## 13. `noHeaderScope` — 3, 3 files

`api/VariableSetView.vue:479`, `views/console/ConsoleResultGrid.vue:352`,
`views/documents/DocumentView.vue:1072`. All three are **`:scope="…"` — a Vue prop on a child
component**, not the HTML `scope` attribute. Biome reads the attribute name and cannot tell.

**Fix: rename the prop.** It is a real collision with a reserved HTML attribute name, so the rename
is the honest fix and not linter appeasement. Pick one name (`owner-scope`, or the domain word the
component actually means — `pageKey`/`tabId` are what get passed) and change the prop declaration
plus every call site in one commit. Verify with a grep for the old prop name reaching zero.

Suppress only if the rename turns out to reach outside this phase's files; say so in the commit
message if it does.

---

## 14. `noNoninteractiveElementToInteractiveRole` — 2, 2 files

- `api/VariablesOverviewPanel.vue:128` — `<code role="button" tabindex="0" @click @keydown.enter>`.
  Fix with §7's first group: `<button type="button"><code>…</code></button>`. Clears this finding
  and its `useSemanticElements` twin.
- `project/ConnectionDialog.vue:659` — `<nav class="p-tab-strip" role="tablist" aria-label="Connection detail tabs">`.
  A tablist is not a navigation landmark. **Fix: `<nav>` → `<div>`**, keeping `role="tablist"` and
  the label. Verified clean, and the `<button role="tab">` children already inside it are correct.

---

## 15. Singletons

- **`useAriaPropsForRole` — `git-ui/components/SearchBox.vue:262`.** `role="combobox"` on a
  component that receives its ARIA through camelCase props (`ariaExpanded`, `ariaControls`,
  `ariaActivedescendant`), which never reach the DOM under those names as far as Biome can see.
  **Fix: move the combobox wiring onto the real `<input>` using hyphenated `aria-*` attributes**,
  or drop `role="combobox"` from the wrapper if the input already carries it. Note the `**/*.vue`
  override also turns `useVueHyphenatedAttributes` off, which is what allowed the camelCase form;
  that entry is not P105's to remove, but the hyphenated attributes are the correct shape here
  regardless.
- **`noSvgWithoutTitle` — `git-ui/components/UncommittedChangesStrip.vue:136`.** A decorative graph
  node circle inside a row that already has its own accessible name. **Fix: `aria-hidden="true"` on
  the `<svg>`** (verified clean). Do not invent a `<title>` for a decoration.

---

## 16. Vendored `components/ui/*` source — 3 findings

`packages/theme/src/components/ui/input-group/InputGroup.vue:13` (`role="group"`),
`InputGroupAddon.vue:28` (`role="group"`) and `:27` (`@click` focusing the sibling input).

These files are shadcn-vue's own source, vendored by P104. Diverging from upstream costs a merge
conflict on every `shadcn-vue add` refresh.

**Fix, in order:**

1. `role="group"` → `<fieldset>` is a behaviour-neutral, upstream-compatible change on a wrapper
   that carries no form semantics of its own. Apply it in place and note in the commit that it is a
   local divergence from upstream shadcn-vue.
2. `InputGroupAddon`'s `@click` is a real convenience (clicking the addon focuses the input) and
   its keyboard equivalent is `Tab` to the input itself — there is nothing to add a `@keydown` to
   without inventing a second focus path. Suppress this one with
   `<!-- biome-ignore lint/a11y/useKeyWithClickEvents: … -->` and name the reason: vendored upstream
   source, and the click is a pointer-only shortcut to a control that is already in the tab order.

Three findings, at most one suppression.

---

## 17. Suppression budget

The phase may end with **at most three** `biome-ignore lint/a11y/*` comments in the tree, each in a
shared component or vendored file, each with the named requirement written immediately above it:

1. §4.2 — the disabled-tooltip wrapper's `tabindex`.
2. §5.2(a) — the resize handle's `role="separator"`, if the shared extraction lands (the fallback
   path raises this to four, in CommitGrid, and must say so in its commit message).
3. §16 — `InputGroupAddon`'s pointer-only click.

Anything beyond that is the override coming back under a different name, and goes back for a real
fix. A suppression added to a *call site* rather than a shared component is out of budget by
construction.

---

## 18. Sequencing

One Sonnet subagent, sequential. The findings share files across rules (`StreamView.vue` alone
spans three sections; `TabStrip.vue` spans four), so splitting by rule would put two editors in one
file. No parallel streams.

Commit order, each commit landing on a green `bun run lint` + `bun run typecheck`:

1. §4 — the shared disabled-tooltip component and its 79 call sites. Largest single drop: 81.
2. §5.1 — the 22 container listeners onto `useEventListener`.
3. §5.2(a) — the shared resize handle; StreamView and CommitGrid repointed.
4. §5.2(b) — scrims onto `onClickOutside`.
5. §5.2(c) + §6 — rows to `<button>` or role+keys, subsystem by subsystem, several commits.
6. §11 — the nested close affordances. Own commit; UI suite run against it.
7. §7, §9, §14, §15 — roles, names and semantic elements.
8. §8 — `autofocus` removal.
9. §10, §12, §13, §16 — the small rules.
10. Delete `"a11y": "off"` from `biome.json`. Final commit, and the phase's acceptance test.

Expensive suites run once near the end, per `CLAUDE.md`: `bun run test:ui:studio` and
`bun run test:visual:studio`, with fixes as follow-up commits. Fast checks (`bun run lint`,
`bun run typecheck`) run per commit.

---

## 19. Verification

Before reporting done, each as a real command:

1. `biome.json` contains no `"a11y"` key — `grep -n '"a11y"' biome.json` returns nothing. The
   `**/*.vue` override keeps its `useVueHyphenatedAttributes` and `noNonNullAssertion` entries; only
   the a11y line goes.
2. `bun run lint` passes clean, in a normal commit, with no `--no-verify` anywhere in the phase's
   history.
3. `biome check . --max-diagnostics=2000 --reporter=json` reports **0** diagnostics in any
   `lint/a11y/*` category — run over `.`, not over the three directories P99 and P104 used, because
   the override is repo-wide and 35 of the 254 live outside them.
4. `grep -rn "biome-ignore lint/a11y" apps packages` returns at most 3 hits (4 on §5.2's fallback
   path), each in a shared or vendored component, each with its reason comment directly above.
5. `grep -rn ':tabindex="0"' --include=*.vue apps packages` returns nothing — the §2.2 evasion never
   landed.
6. `bun run typecheck` clean.
7. `bun run test:ui:studio` passes. Any failure is a real regression from a changed element or a
   moved `data-testid`, and gets fixed here, not deferred.
8. `bun run test:visual:studio` — a role or `type` attribute changes no pixel; a `<span>` that
   became a `<button>` can. Re-record only a baseline whose diff is explained by a deliberate
   element change, and say which in the commit message. The ~0.01-ratio glyph noise
   `docs/ARCHITECTURE.md` documents for locally-captured baselines still applies and is not chased.
9. Spot-check that this phase changed only accessibility semantics:
   `git diff <phase-start>..HEAD -- '*.vue' | grep '^[+-]' | grep -c 'class='` should be near zero
   outside the two new shared components. Spacing, sizing and colour are not P105's.

---

## 20. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **P107 is editing many of these same `.vue` files right now, in its own worktrees, unmerged** | Certain | High — two concurrent editors in one file | **Do not start P105's implementation pass until P107 fully merges into `v1.9`.** Then re-run §1.1's measurement before touching anything: P107's consolidation will have moved, merged or deleted some of these 254 findings, and the per-rule counts in §1.2 are a starting point, not a contract |
| §4 and §5.2(a) both propose extracting a shared component from duplicated markup — exactly P107's subject | High | Medium | Grep for an existing shared wrapper before writing either; if P107 made one, add the suppression to it rather than introducing a second |
| A row converted to `<button>` or given a role breaks a Playwright selector | High | Medium | Every flagged element's `data-testid` is preserved verbatim; `bun run test:ui:studio` in §18 step 6 and §19 step 7 is the guard |
| §11's structural change to tab close buttons alters tab-strip layout | Medium | Medium | Own commit, visual suite run against it, `tab-close`/`console-result-close` testids preserved |
| Deleting `autofocus` changes which control is focused on dialog open | Medium | Medium | §8's per-site rule: case 1 only where the control is provably first in `FOCUSABLE_SELECTOR` order; case 2 focuses explicitly. UI suite covers several dialogs |
| `onClickOutside` changes dismiss behaviour at a scrim (e.g. a click inside a nested popover now dismisses) | Medium | Medium | Convert scrims one at a time; each has a `data-testid` and a UI test path |
| `role="option"`/`"treeitem"` added without the matching container role | Medium | Medium | §5.2(c) requires adding the container role in the same edit; a lone option with no listbox parent is worse than the `<div>` |
| The suppression budget creeps past three | Medium | High — it is the override returning under another name | §17 is a hard cap; §19 step 4 counts it |
| A finding is "fixed" by a bound attribute Biome cannot read | Low | High | §19 step 5's grep; §2.2 forbids it explicitly |
| `<fieldset>` substitutions change layout (its default `min-width: min-content`) | Low | Low | Four sites; visual suite catches it, and `min-w-0` is the one-class answer |
| A rename in §13 misses a call site | Low | Low | `grep` for the old prop name reaching zero, plus `bun run typecheck` |
