# P110 — implementation plan: CSS-to-Tailwind migration (and the `@theme` name collision)

SPEC row: `docs/v1.9/SPEC.md` phasing table, P110. The row covers the `--color-muted` collision; the
user widened it to the full migration in `plans/css-tailwind-migration-audit.md` (the audit, written
at `05ec1cd`). This plan builds on the audit. It re-verified the audit's load-bearing claims
against real source rather than re-surveying (§2 lists every correction). Opus plans, two parallel
Sonnet implementers (Stream A, Stream B), then one closing step. No review-findings stage. Tree
verified: `771512bc`.

Paths repo-relative. `SF` = `apps/kira-studio/frontend/src`, `KF` = `apps/kira-space/frontend/src`,
`PT` = `packages/theme/src` (alias `@theme`), `PW` = `packages/workbench/src` (alias `@workbench`),
`GU` = `packages/git-ui/src`, `KU` = `packages/kira-ui/src`, `ST` = `apps/kira-studio/tests`, `KT` =
`apps/kira-space/tests`, `VT` = `apps/kira-space-vscode/tests`. Line numbers are at `771512bc`;
re-check each when work starts (§8).

## 0. Goal and acceptance

Move every convertible style rule from plain CSS into template utilities or shadcn-vue components,
and make every Tailwind `@theme` name resolve to exactly one definition.

Acceptance (orchestrator checks each with a real grep/run, §9):

1. **Collision gone.** `--color-muted:`, `--color-input:` and `--color-border:` each appear exactly
   once under `PT` (in `shadcn-bridge.css`). `bg-muted` resolves to `--kira-bg-input` (#313131).
   Legacy muted text keeps #9d9d9d through `text-muted-foreground`. Legacy input fills keep #313131
   through the new `bg-field`.
2. **Guard.** `scripts/check-theme-classes.sh` runs in `bun run lint` and fails on any retired class
   name (§3.4, §5.12).
3. **Live bugs fixed.** The run-state ring spins in `primary` and colours its label `info`/`error`
   (audit §2.1). The 4 `h-bar` panel heads measure 34px (§2.2). kira-size `Button` variants keep
   their own text colour (§3.3, new).
4. **Plain CSS retired.**
   - `PW/workbench.css` holds only its `@import`/`@source` lines.
   - `PT/primitives.css` holds only the §5.11 residue.
   - `KU/theme/controls.css` is deleted along with its package export.
   - Every Studio/Space/workbench/git-ui `<style>` block is gone, except the §5.15/§6.5 stays-CSS lists.
     `grep -c '<style'` matches that list's count exactly.
5. **Inline styles.** Zero static `style="…"` attributes and zero constant `:style` bindings remain.
   Only §5.6's runtime list stays.
6. **Arbitrary values.** Every arbitrary utility this phase adds is on the §1.2 allowlist. A grep of
   the phase diff for `-\[` finds nothing else.
7. **Suites.** `bun run lint`, `bun run typecheck`, `bun run test:unit`, all three builds,
   `test:ui:studio`, `test:ui:space`, `test:webview` pass clean. `test:visual:studio` re-records
   once in step C (§7.3), then re-runs clean.

## 1. Conventions (both streams)

### 1.1 Escape-hatch rule — the order every conversion tries, stop at the first that fits

1. **Tailwind default-scale utility** (`gap-1`, `w-120`, `max-h-4/5`, `animate-spin`).
2. **Existing `@theme` token utility** backed by a `--kira-*` (`text-kira-sm`, `h-control`,
   `bg-hover`, `rounded-kira-sm`, `font-data`). In git-ui: the `kv:` theme in §6.1.
3. **New `@theme` token.** Allowed only when the value recurs 3+ times or is a deliberate design
   seam. §5.3 lists every one this phase adds. Adding one outside that list needs a one-line reason
   in the commit body.
4. **Arbitrary value** (`w-[123px]`, `[--x:y]`). Allowed only for a one-off or runtime/viewport/
   calc value. Each one needs a stated reason. §1.2 is the full allowed list. Anything else gets
   a token (rung 3) or a nearest-step change disclosed in the commit body.

P104 had to clean up 425 arbitrary utilities that P99 left behind. This rule stops that from
recurring. The token is the reason: a `px-[7px]` hides a design decision that a token would name.

### 1.2 Arbitrary-value allowlist (every one this phase may add)

| Value | Where | Reason |
|---|---|---|
| `max-h-[82vh]` | `SF/workbench/GenerateDataDialog.vue` | One-off viewport value, no scale step. Kept exact rather than a 2vh change |
| `max-w-[calc(100vw-8px)]` | `SF/…/ErrorPopover.vue` | One-off viewport calc |
| `before:content-['\eab6']` + `before:font-[codicon]` | `.p-disclosure` successor | Codicon glyph escape. No utility carries a glyph |
| `after:content-['']` | `TabStrip` attention dot | Pseudo-element needs empty content |
| `[appearance:base-select]`, `[&::picker(select)]:…`, `[&::picker-icon]:…` | `PT/components/ui/native-select/NativeSelect.vue` only | No utility yet. Confined to one component |
| `shadow-[inset_0_calc(var(--kira-border-width)*-1)_0_0_var(--kira-border)]` | `PT/components/ui/resizable/ResizableHandle.vue` only | One definition, keeps the border-width indirection |
| `[&::-webkit-inner-spin-button]:appearance-none` (+ outer) | the `p-input` successor component only | Vendor pseudo, no utility |
| `z-(--kira-z-*)` | wherever `z-index: var(--kira-z-*)` converts | P104's decision: z-index stays var-based |
| `*-(--kira-rail)`-style var shorthands for a runtime custom property | only where §5.6 already binds that property at runtime | Runtime value |

No new `!` important utilities. If a utility loses to an unlayered rule, convert that rule in the
same commit (§1.3); never force it with `!`. The existing `h-8! rounded-lg!` in shadcn's
`CommandInput.vue` is registry-authored and stays.

### 1.3 Cascade and ordering rules

- **The hazard.** `primitives.css`, `workbench.css`, `controls.css`, `app-shell.css` and every
  `<style>` block (scoped or not, `@apply` or not) emit unlayered CSS. Unlayered CSS beats every
  layered utility, whatever the specificity. A utility that shares an element with an unlayered
  rule setting the same property is dead (audit §2).
- **Convert in the same commit.** An inline style or scoped rule on an element that also carries an
  unlayered class setting the same property converts in that class's commit. Example: the
  `DefinitionView` chip's inline style goes with the Badge commit (B22), not with B10.
- **Replace, never add alongside.** When a converted utility conflicts with one already on the
  element, keep the value that renders today and delete the other. Today's winner is always the
  unlayered rule. Two same-property utilities on one element resolve by stylesheet order, which
  nobody should have to reason about.
- **Global primitives before scoped blocks.** Convert `primitives.css`/`workbench.css` classes (§5.7-
  §5.11) before the scoped raw-declaration blocks (§5.13) and `@apply` blocks (§5.14). Converting a
  scoped rule first would leave its new utility losing to the still-unlayered primitive on the same
  element. The reverse order is safe: the scoped rule (unlayered) keeps winning until its own
  commit, where the rule above deletes the primitive's now-redundant utility.
- **Complete class literals only.** Tailwind scans literal strings. Conditional classes use a lookup
  map or a ternary of whole class names, never string concatenation.
- **Through `cn()`.** A class prop that overrides a shadcn component's base class goes through the
  component's `cn(base, props.class)`. B1 makes `cn()` understand the kira scales (§3.3).

### 1.4 Disclosed visual changes

Pre-approved by the user:
- TreeRow pulse becomes `animate-pulse`.
- git-ui's stepped 1.5s spinners become a smooth 1s `animate-spin`.
- `.p-count`'s `#f0f0f0` becomes `text-fg`.
- `.segmented` becomes `ToggleGroup`.

Required by the live-bug fixes: §3 (bg-muted surfaces), §5.4 (run-state), §5.5 (panel heads) and
§3.3 (Button variant colours). Also disclosed:
- Removing the global `.field` leak from 3 non-settings components (§5.9).
- `.sec-label` letter-spacing goes from 0.06em to 0.05em (`tracking-wider`). That is 0.11px at 11px.
- git-ui em-literal nearest-step changes of 1px or less (§6.4).

Any other visible change stops the implementer: write it in the commit body and ask the
orchestrator. `.p-strip.err` stays exact through a new `--kira-error-text` token (§5.3), so the
fallback approval to `text-error` is not used.

### 1.5 CodeGraph, tests, commits, resumability

- **CodeGraph.** This plan names every file and change, so CodeGraph is not mandatory for the
  implementers. Two exceptions count as discovery and need `codegraph_explore` first (load it with
  `ToolSearch` "codegraph"): re-verifying §8's drift list, and any consumer this plan does not name
  that a grep surfaces. Discovery for this plan used `codegraph_explore` on the settings-field
  blast radius, git-ui's mount path (`loadGitUi` to `createApp`), and the
  `DialogContent`/`toggleVariants`/`buttonVariants` consumers.
- **No new unit tests.** CSS moves carry no complex logic (CLAUDE.md). The one exception is B1's
  `cn()` config: add one table spec (`ST/unit/cn-merge.spec.ts`) only if the implementer finds a
  merge case that needs a guard. Default: none.
- **Spec selectors.** 15 spec files select class hooks this phase removes: `VT/interaction/branch-
  picker.spec.ts` (`.kui-segmented-badge`), plus Studio `slick-grid`, `data-view`, `connections`,
  `fake-data`, `http-history`, `tree`, `api-ui-consistency`, `mode-switch`,
  `settings-apply-on-save`, `control-sizing`, `http-variables`, `font-roles`, `autocomplete` and
  `tabs`. Move a selector to `data-testid` in the commit that removes its class. `KT/…/repo-
  workspace.spec.ts:1059` selects git-ui's `.kv-cell-message`. Stream A keeps that class as a
  plain hook.
- **Commits.** Conventional Commits, one concern each. The subject ends with the stream tag, e.g.
  `(P110 B7)`, so `git log --grep 'P110 B'` shows where a stream stopped. The pre-commit hook
  (`bun run lint` + `bun run typecheck`) must pass on every commit. Never use `--no-verify`.
  Per-commit fast checks: the hook, plus the owning app's `build:*` when a commit touches build
  config or `@theme`.
- **Resumability.** Every decision is in this file. A re-spawned implementer reads its stream's
  section, runs `git log --oneline --grep 'P110 A'` (or `B`), and resumes at the first missing tag.
  Nothing is kept only in a conversation.

## 2. Audit corrections (verified at `771512bc`)

| Audit claim | Verified reality | Effect on plan |
|---|---|---|
| SPEC row: `bg-muted` consumers render "gray text" | They render a #9d9d9d **background fill**. `--color-muted` backs `bg-muted`. Text stays whatever the element sets | Wording of §3 |
| §2.4: collision is a "side finding", separate from the SPEC row | Same root cause as the SPEC row. `base.css`'s `@theme` (l.31, 33, 36) re-declares 3 names that `shadcn-bridge.css`'s `@theme inline` (l.67, 73, 74) already owns, and the later block wins. One fix covers all 3 (§3) | One fix, not two |
| §2.4: `ToggleGroupItem` `bg-muted` has 63 usages | 25 `<ToggleGroupItem>` elements. `bg-muted` sits in `toggle/index.ts`'s base and outline variant, applied through `toggleVariants`. Other `bg-muted` sources: `button/index.ts` outline/ghost (`hover:`, `aria-expanded:`, `dark:hover:bg-muted/50`), `CommandItem.vue` (`data-highlighted:`), and `DialogFooter.vue` (`bg-muted/50`, 33 callers) | §3.2 lists every surface |
| §2.4: `border-input` harmless | True, and it also covers `bg-input`: `--kira-bg-input` = `--kira-border-strong` = #313131. P108 Part 13's result already asked for `--color-input` to be folded into P110 | Renamed for meaning, not pixels (§3.4) |
| Not in audit | **New live bug.** `cn()` is `twMerge(clsx())` with no config. tailwind-merge 3.7.0 reads `text-kira-sm` as a text **colour**. `Button.vue:27` runs `cn(buttonVariants({variant, size}))`, so the `kira*` size's `text-kira-sm` removes the variant's `text-muted`/`text-fg`. 130 kira-size Buttons lose their variant text colour (toolbar 45, dialog 40, dialog-primary 34, toolbar-primary 9, danger 1, default 1). twMerge also never dedupes `h-control`/`h-8` or `rounded-kira-sm`/`rounded-lg` | New commit B1 (§3.3) |
| Not in audit | 5 sites use `text-fg-muted`, which generates no CSS: `OperationsPanel.vue:239`, `BrowseView.vue:380`, `StreamView.vue:897` and `:970`, `ConnectionDialog.vue:666` | B4 (visible fix) |
| §2.1 run-state: swap `border-*-accent` at 11 sites | Only 4 run-state sites still use `accent` (`BrowseView:365`, `StreamView:854`, `DocumentView:884`, `ConsoleView:850`). The other 7 already use `primary`. `GenerateDataDialog:504` has the same bug outside run-state. 5 sites also use `font-[family-name:var(--kira-font-data)]` instead of `font-data`. The inner `class="ring"` is a real Tailwind utility and emits a ring box-shadow by accident | §5.4 |
| §2.2 panel heads: 8 consumers | 4 with `h-bar` (as the audit says), 2 without (`PreviewCommandPanel:61`, `StreamComposeMessage:61`), and 2 comment-only mentions (`OperationsPanel:423`, git-ui `ReviewView:1188`) | §5.5 |
| §3.1: 15 inline-width dialogs plus the `sm:max-w-[calc(100%-2rem)]` class per site | Confirmed. Every `DialogContent` consumer sets its own width, so the audit's "wider alternative" (drop `sm:max-w-sm` from the base) is safe and chosen. Also: `ConnectionDialog` is now at l.604. `CommandPalette` has `w-105 sm:max-w-105`. `SettingsShell` has a runtime `maxWidth` | §5.6 |
| §3.3: 8 constant `:style` bindings | 9. Also `SF/views/grid/DataToolbar.vue:295`: error/warn/none ternary. `PW/components/StatusBar.vue:11` sits on `.p-statusbar`, which sets no colour, so there is no conflict | §5.6 |
| §3.5: build `SettingsField`/`FieldHelp` pair or inline utilities | shadcn-vue's `field` registry item exists (reka-nova, http 200, deps `label`/`separator`, both already present). CLAUDE.md prefers the shadcn primitive | §5.8 |
| §3.5: `.field` leaks into 3 non-settings components | True for `.field` (exact-match grep: 12 files, the 3 named are right). `.field-error` also reaches `SchemaDialog.vue` and `TerminalPanel.vue` | §5.9 |
| §3.5: `.sec-label` becomes `tracking-[0.06em]` | Arbitrary value with no recurrence (§1.1 rung 4 fails). `tracking-wider` is 0.05em | Disclosed change |
| §3.7: `color: var(--kira-fg-muted)` becomes `text-muted` | `text-muted` is the collided name. It becomes `text-muted-foreground` | §3 |
| §3.7: `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` inline | Recurs in 3 files. Under §1.1 rung 3 it becomes `@utility scrollbar-none` | §5.3 |
| §3.7: `[--wails-draggable:drag]` inline | Recurs 4+ times with `none`. Becomes `@utility wails-drag`/`wails-no-drag` | §5.3 |
| §3.8: `p-empty` becomes utilities | Confirmed. shadcn `Empty` (registry 200) is a multi-part card, not a one-line pane message. Declined | §5.10 |
| §5 step 2: `@theme` mapping `--color-*` onto `--kv-*` | Under `prefix(kv)`, Tailwind emits theme variables as `--kv-<namespace>-*`. `--kv-font-size`, `--kv-font-family`, `--kv-radius`, `--kv-radius-sm`, `--kv-shadow` and others already exist as git-ui tokens. A plain `@theme` would emit `--kv-font-data: var(--kv-font-data)`, a self-reference cycle. Needs `@theme inline reference` and namespace resets | §6.1 (compile-verified) |
| §5: kira-ui is git-ui-only | `SF/views/stream/StreamView.vue:2` renders `KuiColumnResizeHandle` inside Studio. Studio's Tailwind root does not scan kira-ui and uses no prefix | §6.2: that component stays presentation-free |
| §6: `@keyframes p-spin` stays in primitives.css | It moves into `base.css`'s `@theme` (v4 supports `@keyframes` there), so `primitives.css` loses it | §5.3 |

## 3. The collision: one root cause, one fix

### 3.1 Root cause

`PT/base.css` imports `shadcn-bridge.css`, then declares its own `@theme`. Three names in that
`@theme` are already declared by the bridge's `@theme inline`. In Tailwind v4 the later definition of
a theme name wins, so all three resolve to base.css's legacy value:

| Name | Bridge (intended, shadcn meaning) | base.css (wins today) | Same value? |
|---|---|---|---|
| `--color-muted` | `var(--muted)` = `--kira-bg-input` #313131 (surface) | `var(--kira-fg-muted)` #9d9d9d (text) | **No** |
| `--color-input` | `var(--input)` = `--kira-border-strong` #313131 | `var(--kira-bg-input)` #313131 | Yes, by coincidence |
| `--color-border` | `var(--border)` = `--kira-border` | `var(--kira-border)` | Yes |

The SPEC row (`--color-muted`), audit §2.4 (`bg-muted`, `border-input`) and P108 Part 13's note
(`--color-input`) describe one bug. Compiled output confirms it: `--color-muted: var(--kira-fg-
muted)` and `.bg-muted{background-color:var(--color-muted)}`.

### 3.2 What changes on screen

Every `bg-muted` surface goes from a #9d9d9d fill to #313131:
- Pressed/hovered `ToggleGroupItem`s (25 elements) and `Toggle`.
- `Button` outline/ghost hover and `aria-expanded`.
- `CommandItem` highlight.
- `DialogFooter`'s `bg-muted/50` strip (33 dialogs).

This is the intended shadcn look and a disclosed change. P104 left a `test:visual` failure open;
the fix clears it when step C re-records.

### 3.3 Prerequisite: `cn()` must know the kira scales (B1)

Without B1, the renames below cannot be trusted. A class prop like `text-muted-foreground` passed
next to `text-kira-sm` is dropped by twMerge as a conflicting colour.

Change `PT/lib/utils.ts`: build `cn` from `extendTailwindMerge({ extend: { theme: {…} } })`, with
the kira values registered in their real groups:
- `text`: `kira-xs`, `kira-sm`, `kira-md`, `kira-lg`, `kira-xl`
- `spacing`: `control`, `control-lg`, `control-sm`, `row`, `bar`, plus the §5.3 additions
- `radius`: every `--radius-kira-*`
- `shadow`: every `--shadow-kira*`

Read the exact names from `base.css`'s `@theme` when implementing. Visible effect: the 130
kira-size Buttons get their variant text colour back. For example, `toolbar` turns #9d9d9d with an
`fg` hover, as `button/index.ts:27` intended.

### 3.4 The fix (B2-B5)

1. **B2 `bg-field`.** Add `--color-field: var(--kira-bg-input)` to `base.css`'s `@theme`. Rename
   every legacy `bg-input` to `bg-field` in app code: 102 occurrences in 43 files outside
   `PT/components/ui/`, with every variant prefix (`hover:bg-input`, `bg-input/50`, …).
   - Also rename it in `button/index.ts`'s `dialog` variant (l.30), which is ours, not registry
     code.
   - Leave shadcn's own registry `bg-input/30` and `border-input` strings alone. Those mean
     shadcn's `--input`.
   - Update `shadcn-bridge.css`'s l.36-38 comment, which points readers at `bg-input` for a filled
     control.
   - Pixel-identical.
2. **B3 `text-muted-foreground`.** Rename every legacy `text-muted`: 109 occurrences in 51 files,
   including `@apply` lines and variant prefixes. Also rename `button/index.ts:27`'s `toolbar`
   variant.
   - `text-muted-foreground` is shadcn's own token for the same value (`--muted-foreground` =
     `--kira-fg-muted`). It is already used by `Input`, `Textarea` and `Badge`. That makes it one
     term per concept, not a new kira name.
   - Pixel-identical.
3. **B4 dead `text-fg-muted`.** Change the 5 sites (§2) to `text-muted-foreground`. This is visible:
   those 5 labels turn from inherited colour to #9d9d9d, as their authors intended.
4. **B5 delete the duplicates.** Delete `base.css` l.31 (`--color-input`), l.33 (`--color-muted`)
   and l.36 (`--color-border`).
   - Add `scripts/check-theme-classes.sh` and wire it into root `lint` after `check-tokens.sh`.
     It greps `SF KF PW PT` (excluding `PT/components/ui/`) for retired names and fails with the
     file:line and the replacement. Its starting list: bare `text-muted` (not followed by `-`),
     `text-fg-muted`, and legacy `bg-input`.
   - Later commits append each class they retire (§5.12). Step C appends git-ui's.
   - Visible: §3.2.

Rename regex for B2/B3 (run from a scratch script, not committed). Match
`(^|[\s"'\x60{:])((?:[a-z0-9-]+:)*)text-muted(?![-\w])`, keeping the variant chain. Afterwards,
re-grep with the guard itself.

### 3.5 Why rename the legacy names, not the shadcn ones

The shadcn names are what every registry component we fetch speaks (`bg-muted`, `border-input`).
Renaming them would mean editing every future `shadcn-vue add` output. The legacy names live only
in our own code, and the guard keeps them from coming back.

## 4. Structure: one phase, two parallel streams, one closing step

### 4.1 Not split into parts

CLAUDE.md runs `P110 Part 1`/`Part 2` sequentially, each with its own plan and result. The
coordinator asked for two parallel implementers. A parts split would contradict that, and the
acceptance is one grep set over one end state. So P110 stays one phase. Its implementation splits
into two file-disjoint streams, which is CLAUDE.md's allowance for "genuinely independent"
parallel work inside one phase.

### 4.2 Ownership

| | Stream A — git-ui/kira-ui | Stream B — theme/workbench/apps |
|---|---|---|
| Owns | `packages/git-ui/**`, `packages/kira-ui/**`, `apps/kira-space-vscode/**` (incl. `VT/`), `bun.lock` | `packages/theme/**`, `packages/workbench/**`, `SF/**`, `KF/**`, `ST/**`, `KT/**`, `scripts/check-tokens.sh`, `scripts/check-theme-classes.sh` (new), root `package.json` |
| Size | ~45 Vue files, 2,731 block lines, `controls.css` 549, `app-shell.css` ~40 | ~180 files, ~4,014 block lines, `primitives.css` 1,013, `workbench.css` 164, ~430 alias attributes |
| Commits | ~20 (§7.2) | ~40 (§7.1) |

**No overlap, confirmed.**
- The two globs are disjoint path prefixes.
- Stream B adds no npm dependency. Every registry item it fetches (`field`, `badge`,
  `native-select`, `resizable`) depends only on `reka-ui`/`@vueuse/core`, both already in root.
  So `bun.lock` is Stream A's alone.
- Stream A edits no root file: its deps go in `packages/{git-ui,kira-ui}/package.json`.
- Neither stream touches `docs/`. Step C owns `docs/ARCHITECTURE.md`, `docs/v1.9/SPEC.md` and
  this file.

**No ordering dependency, confirmed.**
- Stream A's Tailwind root (§6.1) reads only `--kv-*`/`--kui-*` tokens that exist today. It never
  reads `PT/base.css`'s `@theme`.
- Stream B never renders a git-ui component.

**The one shared runtime seam** is Kira Space, which loads git-ui through `KF/repo/git/
gitUiModule.ts` (`loadGitUi()`). Two rules keep it independent:
- **A1.** Stream A keeps git-ui's mount API (`gitUiModule`'s imports from `@kira/git-ui`)
  unchanged.
- **A2.** Stream A adds no new `--kui-*` token. Every kui utility maps to a token already defined
  in both bridges: `PT/kui-bridge.css`, owned by B and left untouched, and `GU/theme/kui-
  bridge.css`, owned by A.

### 4.3 Worktrees and landing

The hook lints and typechecks the whole repo. Two implementers in one checkout would fail each
other's hooks on half-done edits. So:

1. Before spawning, the orchestrator updates the SPEC P110 row to the expanded scope and commits
   it on the chapter branch. Then it creates two worktrees from that commit:
   `git worktree add ../kira-p110-a -b p110-stream-a` and
   `git worktree add ../kira-p110-b -b p110-stream-b`.
2. Each implementer works only in its worktree. It runs `bun install` there first.
3. When both finish, the orchestrator rebases `p110-stream-b` and then `p110-stream-a` onto the
   chapter branch and fast-forwards. The file sets are disjoint, so the rebase is conflict-free and
   the history stays linear. Then it removes the worktrees.
4. Step C (§7.3) runs on the merged chapter branch.

### 4.4 Load imbalance

B is about twice A. Rebalancing is declined. Moving part of B to A would split atomic commits: B2/B3
rename across Studio, Space, workbench and theme in one commit each, and every primitive commit
spans both apps. Splitting those would break the "one commit, whole rename" rule and put both
streams on the same files.

## 5. Stream B design

### 5.1 B1: `cn()` config — §3.3

### 5.2 B2-B5: collision — §3.4

### 5.3 B6: `@theme` and `@utility` additions (`PT/base.css`, `PT/tokens.css`)

New tokens (§1.1 rung 3). Each is a recurring value or a deliberate seam:

| Entry | Maps to | Why a token |
|---|---|---|
| `--color-search-match`, `--color-search-match-current` | `--kira-search-match[-current]` | 7 and 5 uses |
| `--color-var-resolved` | `--kira-var-resolved` | 4 uses |
| `--color-syntax-{property,string,number,keyword,function,meta}` | `--kira-syntax-*` | Shared palette across 3 files |
| `--color-error-text` | new `--kira-error-text: #f3a3a3` in `tokens.css`, next to `--kira-warn-text` | Sibling of existing `warn-text`/`note-text`. Keeps `.p-strip.err` exact |
| `--spacing-titlebar`, `--spacing-tabbar`, `--spacing-statusbar`, `--spacing-titlebar-inset` | `--kira-titlebar-h`, `-tabbar-h`, `-statusbar-h`, `-titlebar-inset-left` | Deliberate per-bar seams (`tokens.css:94-105`). `h-bar` would collapse them |

Also in B6:
- Move `@keyframes p-spin` from `primitives.css:792` into `base.css`'s `@theme` as
  `@keyframes kira-spin`, and point `--animate-kira-spin` at it.
- Add `@utility` blocks in `base.css`, each replacing a multi-declaration or pseudo-element pattern
  that recurs:
  - `scrollbar-none`: `scrollbar-width: none` plus `&::-webkit-scrollbar { display: none }`. Used
    in ConsoleView, DocumentTree, TabStrip.
  - `swatch-none`: the diagonal-slash gradient. Used in ConnectionDialog, ScriptsPane,
    VariableSetView.
  - `wails-drag` / `wails-no-drag`: `--wails-draggable: drag | none`. Used in TitleBar,
    `.title-bar-actions`, `.title-action` and the tab strip.
- Extend B1's twMerge config with the new spacing names.
- Pixel-identical, since nothing uses the new entries yet.

### 5.4 B7: run-state fix (11 sites) — audit §2.1, corrected

Sites:
- `SF/views/shared/keyvalue/KeyValuePane.vue:774`
- `SF/views/httprequest/HttpRequestView.vue:619`
- `SF/views/definition/DefinitionView.vue:288`
- `SF/views/grpcrequest/GrpcRequestView.vue:413`
- `SF/views/browse/BrowseView.vue:358`
- `SF/views/grid/DataView.vue:267`
- `SF/views/stream/StreamView.vue:847`
- `SF/views/documents/DocumentView.vue:877`
- `SF/views/console/ConsoleView.vue:843`
- `SF/api/VariableSetView.vue:498`
- `SF/api/EnvironmentsView.vue:254`

Changes:
- Delete `primitives.css` l.754-791 (`.p-run-state*`, including the dead `.is-running`/`.is-error`).
- Remove the `p-run-state` and inner `ring` hook classes from all 11 templates. Add
  `data-testid="run-state"` on the outer span and `data-testid="run-state-label"` on the label.
- Move `ST/ui/data-view.spec.ts:1085,1100` to those test ids.
- Swap `border-*-accent` to `border-*-primary` at the 4 sites in §2, plus `GenerateDataDialog:504`
  (same bug).
- Swap `font-[family-name:var(--kira-font-data)]` for `font-data` at the 5 sites that use it.
- Visible: the ring is 12px, spins in brand blue, and the label turns `info`/`error`. The
  accidental ring box-shadow is gone.

### 5.5 B8: panel heads — audit §2.2, corrected

- Convert `.p-panel-head` (`primitives.css:648-660`) to utilities on its 6 element consumers:
  `flex items-center shrink-0 h-control-lg px-… uppercase tracking-wider text-kira-sm
  text-muted-foreground …`. Copy every declaration of the rule. `letter-spacing: .05em` is exactly
  `tracking-wider`.
- The 4 `h-bar` sites (`SF/workbench/panels/ProjectPanel.vue:35`, `SF/terminal/TerminalPanel.vue:
  142`, `SF/api/CollectionsPanel.vue:127`, `KF/repo/GitPanel.vue:334`) drop `h-control-lg` and
  keep `h-bar`. Visible: 26px becomes 34px.
- `PreviewCommandPanel:61` and `StreamComposeMessage:61` keep `h-control-lg`. Pixel-identical.
- Reword the comment at `OperationsPanel:423`. Stream A rewords git-ui `ReviewView:1188`.
- Delete the rule and add `p-panel-head` to the guard.

### 5.6 B9-B10: dialogs, inline styles, constant bindings

**B9 dialogs.**
- `PT/components/ui/dialog/DialogContent.vue:36`: delete `sm:max-w-sm` from the base. Every
  consumer sets a width (verified), and the base `max-w-[calc(100%-2rem)]` (registry-authored)
  becomes the only cap.
- The 15 audit §3.1 sites become `class="w-N"` plus `max-h-4/5` or `h-N`, using the audit's table
  with no `sm:max-w-…`. `GenerateDataDialog` keeps `max-h-[82vh]` (allowlisted).
- `PW/components/ConfirmDialog.vue:40`: change to `w-100`, which fixes the <432px overflow. Delete
  the l.34-36 comment.
- `SF/shortcuts/CommandPalette.vue:39`: change to `w-105`.
- `PW/components/SettingsShell.vue:194-196`: keep the runtime `width`/`height` in `:style` and drop
  `maxWidth`, so the base cap applies. Delete the l.187-189 comment.
- Visible only below ~672px viewports (no overflow now).

**B10 other inline styles and constant bindings.**
- `StreamView` `w-10`/`flex-1` ×4.
- `PW/components/WorkbenchShell.vue:133`: `px-1.5 pb-0.5 bg-chrome`.
- The 9 constant bindings from audit §3.3, plus `SF/views/grid/DataToolbar.vue:295` as
  `:class="rt?.countError ? 'text-error' : rt?.count?.stale ? 'text-warn' : ''"`.
- `PW/components/StatusBar.vue:11`: `text-muted-foreground`.
- `TimelinePane`'s `RESIDUE_COLOR` binding becomes the `bg-conn-grey` class. Delete the constant.
- `SearchToolbar:262` toggles `.muted` against the error colour. Convert both halves into one
  ternary.
- The `DefinitionView:241` chip is **not** here; it goes with B22 (§1.3).

**Stays inline (runtime):**
- Virtualizer transforms, tree-depth padding and column widths.
- floating-ui `left`/`top`.
- `--kira-rail`.
- `var(--kira-conn-${color})`.
- `fileIconStyle` and AppearancePane previews.
- `FkPreviewPopover:163`.
- `SettingsShell` width/height.

### 5.7 B11: fetch the shadcn `field` set

Fetch the `field` set with P99 §4.2's direct-curl procedure: `https://shadcn-vue.com/r/styles/
reka-nova/field.json`, writing each `files[].content` under `PT/components/ui/field/` and
rewriting the registry import aliases to `@theme/…`, as P99 did.

Then restyle the components to today's settings geometry, since the components are ours once
copied:

| Component | Classes (from `workbench.css`) |
|---|---|
| `Field` (vertical) | `flex flex-col gap-1 text-kira-sm` |
| `Field orientation="horizontal"` | `flex-row items-center gap-1.5` (was `.field.checkbox`) |
| `FieldLabel` | `text-muted-foreground`. Replaces `.field > span:first-child` |
| `FieldDescription` | `leading-normal text-subtle text-kira-xs` (`.helper-text`) |
| `FieldError` | `leading-normal text-error text-kira-xs` (`.field-error`) |
| `FieldLegend` | `uppercase text-kira-sm text-subtle tracking-wider pt-1` (`.sec-label`; `.first` becomes `pt-0` at the call site) |
| `FieldGroup` | `flex flex-row items-start` plus `[&>[data-slot=field]]:flex-1 [&>[data-slot=field]]:min-w-0` (`.checkbox-row`). This `[&>…]` is a variant, not an arbitrary value |

`.field-head` stays a plain `flex items-center justify-between gap-1` row at the call site (11
files). No component needed.

### 5.8 B12: settings onto Field

Convert every consumer of the `workbench.css` field vocabulary to the `Field*` components:
- the 5 shared fields in `PW/settings/fields/*`
- `PW/components/SettingsShell.vue`
- both apps' settings panes (13 `settings-pane` files)
- `SF/api/RequestSettingsPane.vue`, which deliberately uses the settings vocabulary

Then:
- Replace `.settings-pane` with `contents`.
- Delete the field vocabulary block (`workbench.css` l.84-160) and add its class names to the
  guard.
- Pixel-identical for settings except the 0.01em tracking.

### 5.9 B12 (same commit): the 4 non-settings leak sites

`ConnectionDialog`, `StreamComposeMessage`, `SchemaDialog` and `TerminalPanel` get today's computed
style pinned with utilities, so deleting the global rule changes nothing:
- **ConnectionDialog** redeclares most properties in its own scoped `.field`. Its B35 commit
  converts that later. B12 only drops the global's share and pins `gap`/`font-size` where the
  scoped rule does not set them.
- **StreamComposeMessage and TerminalPanel/SchemaDialog `.field-error`:** add the utilities the
  global gave them.

Check each by computed style in the dev build (`getComputedStyle` on the element before and after).
Record the check in the commit body.

### 5.10 B13: title bar and tab-new; workbench.css done

- Add `title` to `button/index.ts`: variant `rounded-kira-sm border border-transparent bg-transparent
  text-muted-foreground hover:bg-hover wails-no-drag aria-pressed:bg-elevated aria-pressed:border-
  border-strong aria-pressed:text-fg aria-pressed:hover:bg-hover`, size `size-5.5`, and size
  `title-labelled` `h-5.5 px-1 gap-1 text-kira-sm`.
  - Swap every `.title-action`/`.is-on` for `<Button variant="title" size="title" :aria-pressed>`.
    `aria-pressed` fixes the unexposed toggle state.
- `.title-bar-actions` becomes `flex items-center gap-0.5 ml-auto wails-no-drag`.
- `.tab-strip-actions`/`.tab-new` become audit §3.5's utilities, with `text-muted-foreground`.
- Delete their rules. `workbench.css` is left with its `@import`/`@source` lines. Update its
  header comment.

### 5.11 B14-B31: `primitives.css`

**B14-B20: alias classes, one commit each** (audit §3.6):

| Alias | Becomes |
|---|---|
| `mono` | `font-data` |
| `muted` | `text-muted-foreground` |
| `dim` | `text-subtle` |
| `p-sm` | `text-kira-sm` |
| `p-xs` | `text-kira-xs` |
| `p-push` | `ml-auto` |
| `icon-box` | `size-4 flex items-center justify-center shrink-0` |

In each commit:
- Replace static `class`, `:class` object keys, `cn()` strings, and scoped selectors that name the
  alias (e.g. `.row .muted`).
- Apply §1.3's replace rule wherever the element already has a conflicting utility.
- Move `api-ui-consistency` (`.dim`), `mode-switch` (`.icon-box`) and `font-roles` (`.mono`)
  selectors to `data-testid`.
- Append the alias to the guard, matched only inside class contexts, since `muted` is a common word.

**B21: dead selectors.** Delete `.p-btn.is-hover`, `.p-input.is-focus`, `.p-input.has-stepper`,
`.p-row.is-hover`, `.p-status.is-hover` and `.p-td.num` (the run-state ones went in B7). Re-grep
each first, including dynamic `:class` strings.

**Component-backed primitives** (each commit fetches its registry item when needed, converts all
consumers, deletes the rule and extends the guard):

| Commit | Classes | Target |
|---|---|---|
| B22 | `p-badge` (15 files), `p-chip` (25), `p-count` (2), `DefinitionView:241` chip | `Badge` (fetch `badge`). Variants `warn/err/ok/info` = `bg-warn/16 text-warn`, `bg-error/16 text-error`, `bg-ok/14 text-ok`, `bg-info/16 text-info`, plus `rounded-kira-sm px-1 text-kira-xs`. `count` variant uses `text-fg` (pre-approved) |
| B23 | `p-strip` (11) + the scoped `.strip-warn/-note/-err` + `-text` duplicates (~10 files, e.g. `FkPreviewPopover.vue:246-253`) | `Alert` variants `warn`/`note`/`err` in `PT/components/ui/alert`: `bg-warn/10 text-warn-text`, `bg-info/8 text-note-text`, `bg-error/10 text-error-text` |
| B24 | `p-select` (16) | `NativeSelect` (fetch `native-select`). Put `base-select`/`::picker` in its class list (allowlisted). Keep the P61 WebKit `min-height` workaround (`primitives.css:343`) as a class on the component, with its comment |
| B25 | `p-input` (10) | A `kira` variant on `InputGroup`, with the spin-button resets (`primitives.css:234`) in the variant. The 6 `:deep(.p-input)` blocks (`DocumentView`, `FilterToolbar`, `GrpcRequestView`, `HttpRequestView`, `FormDataTable`, `FieldRowsTable`) become `class` props. `PagerControls`' `:deep(input)` becomes a class prop on its child. `.is-grow` stays CSS (§5.11 residue) |
| B26 | `p-btn` (4), `p-dlgbtn` (2) | `Button` variants that already exist (`toolbar`, `dialog*`). Add one only if a computed-style diff shows a real mismatch |
| B27 | `p-dialog-body` (11), `p-dialog-actions` (8) | utilities / `DialogFooter` with a `class` override pinning today's padding and border (not `bg-muted/50`: today's actions have no fill) |

**Utility-only primitives** (P104's inline-composition precedent). Copy each rule's declarations
through §1.1:

| Commit | Classes |
|---|---|
| B28 | toolbar family: `p-toolbar` (26), `p-toolbar-rail` (11), `p-view-head`/`p-view-target` (12), `p-float` (5), `p-panel` (2) |
| B29 | list/table family: `p-row` (11), `p-thead`/`p-th`/`p-td`, `p-tree-rail`, `p-tab`, `p-tab-rail`, `p-statusbar`, `p-status`, `p-method`, `p-conn-dot` (13) |
| B30 | the rest: `p-empty` (5; shadcn `Empty` declined, §2), `p-menu-label`, `p-completion*` (AutocompleteField), `p-disclosure` (allowlisted codicon `before:`), `p-kv-*`, `def-*` |

Where a family's class string repeats 4+ times in one file, extract a tiny local component or a
`const` class string in that file. Do not paste a 12-utility string 6 times.

**B31: residue.** `primitives.css` keeps only `.p-input.is-grow` and its `::after` replica (audit
§6, WebKit has no `field-sizing`).
- Import it into `base.css` with `layer(components)` if no `is-grow` element carries a utility
  that is meant to lose to it. Check each consumer's classes.
- If one does, keep it unlayered and say why in a one-line comment.
- Update the file header.
- Update `scripts/check-tokens.sh`'s defs list only if a `--kira-*` definition moved.

### 5.12 The guard grows

B5 creates `scripts/check-theme-classes.sh`. Every retiring commit (B7, B8, B12-B30) appends its
names in the same commit. Step C appends git-ui's `kui-*` names.

Format: one line per name, the name plus its replacement. The failure output then tells the next
author what to write instead.

### 5.13 B32-B37: shared patterns, then raw-declaration blocks

- **B32** `resizable`: fetch the registry item. Put the splitter styling on `ResizableHandle` with
  the allowlisted shadow, plus `hover:shadow-none data-[state=drag]:shadow-none hover:bg-focus
  data-[state=drag]:bg-focus`.
  - Swap the `SplitterResizeHandle` uses in the 7 audit files (9 files use the reka component;
    swap all of them) and delete their scoped blocks.
- **B33** `.segmented` becomes `ToggleGroup`: `ConnectionDialog` (l.816/1515) and both
  `SettingsDialog`s. Pre-approved. After B5, the pressed fill is the intended #313131.
- **B34** repeated scoped patterns: `swatch-none` at its 3 sites, `.search-match`/`-current`,
  `.virtual-row`, `.empty-state`, `.sticky-row`, `.twisty`/`.tree-row`, and `.columns-menu-*`.
  Extract `ColumnsMenu`/`ProjectionMenu`'s shared list only if the two templates are truly the
  same.
- **B35-B37** convert the 47 raw-declaration blocks (audit §3.7) using its mapping table (with
  `text-muted-foreground`/`bg-field`/`text-primary`) and literal-px notes:
  - **B35** `SF/project/**` (ConnectionDialog, FiltersDialog, DataGripImportDialog, `TreeRow`
    with the pre-approved `animate-pulse`, `ErrorPopover`, …)
  - **B36** workbench chrome in `SF/workbench/**`, `KF/workbench/**` and `PW/**` (both
    `SettingsDialog`s, `OperationsPanel`, `StudioStart`, `PW/components/TabStrip.vue`,
    `WorkbenchShell`, `TitleBar`)
  - **B37** everything else: views, api, editor (`MonacoHost` non-Monaco rules, `AutocompleteField`
    non-decoration rules), shortcuts, `FkPreviewPopover` (`animate-spin`, exact), and `KF/repo/**`
  - A commit that grows past ~25 files splits by directory with a `B35a`/`B35b` tag.
  - The unscoped `SettingsDialog` blocks move their utilities onto the pane elements themselves
    (audit §3.7).

### 5.14 B38-B40: `@apply`-only blocks

Convert all 59 blocks. The coordinator's scope is the full audit, so this is not opportunistic.
- Move each `@apply` list onto its elements. A class used 4+ times in one file becomes a local child
  component, e.g. `.tree-row`.
- Delete the `<style>` block and its `@reference` line.
- Split the commits by the same three areas as B35-B37.

### 5.15 What stays CSS in Stream B (audit §6, kept, no new reason found)

- `PT/tokens.css`, `kui-bridge.css`, `vscode-bridge.css`, `shadcn-bridge.css`.
- `base.css` `@theme`/`@utility`/html/body/scrollbar rules.
- `slickTheme.css`.
- `review-decorations.css` and `blame-annotation.css`. The `.kira-review-load-error*` domNode
  exception is **not** taken: it would be a category 2 font change with no user approval.
- Monaco `:deep`/`:global` rules in `MonacoHost`/`OperationsPanel`/`ResponseDiffDialog`.
- `.kira-ed-var*` decoration rules. Their colours may switch to the §5.3 `var(--kira-syntax-*)`
  names; the selectors stay.
- `RepoFileView`'s 28 `v-html` `:deep` rules. `@tailwindcss/typography` is declined, since the
  change is visible and adds a dependency.
- `.p-input.is-grow`.
- `docs/design/**`, `ST/visual/support/pin-fonts.css`.

## 6. Stream A design

### 6.1 A1: git-ui Tailwind build (compile-verified with Tailwind 4.3.3)

1. `packages/git-ui/package.json` devDeps: `@tailwindcss/vite` and `tailwindcss`, at root's
   4.3.3. Run `bun install`.
2. `packages/git-ui/vite.config.ts`: `plugins: [vue(), tailwindcss()]`.
3. New `GU/theme/tailwind.css`, imported first in `GU/main.ts`:

```css
@import "tailwindcss/theme" layer(theme) prefix(kv);
@import "tailwindcss/utilities" layer(utilities) prefix(kv) source(none);
@source "../";
@source "../../../kira-ui/src";
@import "@kira/kira-ui/theme/tailwind-theme.css"; /* A2 */

@theme inline reference {
  --color-*: initial; --font-*: initial; --text-*: initial;
  --radius-*: initial; --shadow-*: initial;
  --spacing: 4px;
  /* one line per mapping, e.g.: */
  --color-fg: var(--kv-foreground);
  --text-sm: var(--kv-t-sm);
  --radius-kv: var(--kv-radius);
  /* … */
}
```

Why each part:
- **No preflight.** The VS Code webview relies on its defaults, and Space already ships its own.
- **`prefix(kv)`.** git-ui mounts into Space's document. Unprefixed utilities from two compiled
  roots would duplicate and order unpredictably. Classes read `kv:flex`.
- **`source(none)` + `@source`.** Scan only git-ui and kira-ui.
- **`inline reference` + namespace resets.** Under the prefix, emitted theme variables are named
  `--kv-*` and would collide with git-ui's own `--kv-font-size`/`--kv-radius`/`--kv-shadow`
  tokens, creating self-reference cycles. `reference` emits no variables, and `inline` writes
  `var(--kv-…)` straight into each utility.
- **Mappings.** Colours map to `--kv-*` colour tokens. `--spacing-control*`/`h-*` map to the
  runtime `--kv-control-h*`/`--kv-h-*` calcs. `--text-*` maps to `--kv-t-*`. The default 4px
  `--spacing` already equals `--kv-s-1..6` (2/4/6/8/12/16px).
- The mapping list follows §1.1: add a mapping only for a token the converted rules actually use.

Space needs no change. Its vite already runs `tailwindcss()`, which compiles this file as a second
root when `loadGitUi()` imports git-ui's CSS. Its own root never scans git-ui, and `kv:flex` is an
unknown variant there anyway.

Acceptance for A1:
- A scratch template with `kv:flex kv:text-sm` compiles in both `bun run build:vscode` and
  `bun run build:space`. Delete the scratch file before committing.
- The built CSS defines no `--kv-` custom property inside `@layer theme`.

### 6.2 A2: kira-ui class helper and theme partial

- `packages/kira-ui/package.json` deps: `class-variance-authority`, `clsx` and `tailwind-merge`,
  at root's versions.
- New `KU/cn.ts`: `extendTailwindMerge({ prefix: 'kv', extend: { theme: {…} } })` with the §6.1
  names. Export it from `KU/index.ts` for git-ui.
- New `KU/theme/tailwind-theme.css`: an `@theme inline reference` block mapping the kui control
  names (`--color-kui-*`, `--spacing-kui-control`, …) to `var(--kui-*, <fallback>)`. It uses the
  same fallbacks `controls.css` carries today, so a host with no bridge still renders.
  - Add it to the package `exports`.
  - `check-tokens.sh` skips fallback-carrying `var()`s by construction, so it needs no change.
- **Rule:** `KuiColumnResizeHandle` stays presentation-free (no utilities). Studio renders it
  (`SF/views/stream/StreamView.vue:1108-1156`), and Studio's Tailwind root does not compile
  `kv:` classes.

### 6.3 A3-A8: `controls.css` to cva in the Kui* components

Follow the shadcn extension-point pattern: a `*Variants` cva in the component, applied through
`cn(variants(…), props.class)`. git-ui's overrides (e.g. `BranchPicker`'s `.kui-button` height
override, `SearchBox`'s width note) move to `class` props in the same commit as the component.

| Commit | controls.css classes | Component(s) | git-ui direct uses moved in the same commit |
|---|---|---|---|
| A3 | `kui-button` (+`--active/--icon/--primary/--danger`), `kui-button-count`, `kui-icon-box`, `kui-visually-hidden` | `KuiButton`, `KuiIconBox` | 6 `kui-button`, 2 `.kui-button--icon` selectors |
| A4 | `kui-text-input`, `kui-search-input*`, `kui-select*` | `KuiTextInput`, `KuiSearchInput`, `KuiSelect` | `.kui-text-input` ×2, `.kui-search-input*` |
| A5 | `kui-row` (+`--disabled/--danger/--selected`), `kui-menu-*` | `KuiMenuList`, `KuiContextMenu`, plus an exported `kuiRowVariants` cva | 17 `kui-row` uses become `:class="kuiRowVariants({…})"`, `.kui-menu-heading` |
| A6 | `kui-tooltip`, `kui-popover*`, `kui-modal*` | `KuiTooltip` + `tooltip.ts`'s DOM (literal class string in scanned source), `KuiPopoverPanel`, `KuiDialog` | `.kui-popover` ×2 |
| A7 | `kui-segmented*` | `KuiSegmented` | `VT/interaction/branch-picker.spec.ts` `.kui-segmented-badge` becomes `data-testid` |
| A8 | — | Delete `KU/theme/controls.css`, its `exports` entry, and the `GU/main.ts:16-18` import | — |

The `kui-*` names that remain as hooks (e.g. `v-kui-tooltip` is a directive, not a class) stay.

### 6.4 A9-A19: the 44 git-ui blocks

Same §1.1/§1.3 rules. The `kv:` prefix goes on every utility, including variants
(`kv:hover:bg-…`). Group by area, one commit per row. Split a row past ~25 files or ~600 block
lines into `a`/`b`.

| Commit | Files (block lines) |
|---|---|
| A9 | `dialogs/*` (13 files: Reset 65, Worktree 47, RepoSettings 47, Stash 45, Revert 42, ForcePush 41, CherryPick 33, Stack 32, Tag 29, Branch 29, RenameRef 23, Checkout 12, Pull 3) |
| A10 | banners/panels: `ConflictBanner` 61, `ConnectionBanner` 22, `NoRepositoryPanel` 49, `EmptyRepositoryPanel` 22, `GitBlockedPanel` 28 |
| A11 | toolbar: `AppToolbar` 112, `RefreshButton` 29 (both spinners become `kv:animate-spin`, pre-approved), `UndoButton` 15, `LoadMoreButton` 15, `PullStrategyPicker` 22 |
| A12 | `App.vue` 172. `width: v-bind(detailWidthPx)` becomes `:style` |
| A13 | `CommitGrid.vue` 474: template-bound rules only. The 11 selectors on SlickGrid's JS-built DOM and the `slick.grid.css` overrides stay CSS |
| A14 | `CommitMeta` 217, `DetailPane` 45, `WorkingDetailPane` 24, `StashDetailPane` 33 |
| A15 | `FileTree` 220, `UncommittedChangesStrip` 44 (`style="fill: none"` becomes `kv:fill-none`) |
| A16 | `review/*`: `ReviewView` 263, `ReviewCommitRow` 123, `ReviewCommentsPane` 111, `BaseSelector` 68, `ReviewFilesPane` 29. Reword the `ReviewView:1188`/`:1332` comments that cite `.p-panel-head`/`.p-btn` |
| A17 | `BranchPicker` 151, `SearchBox` 63, `SearchResults` 88 |
| A18 | lists: `StackList` 61, `StashList` 47, `WorktreeList` 41, `TagList` 24, `GlobalStashList` 7 |
| A19 | `GU/theme/app-shell.css`: the ~40 convertible lines move onto `App.vue`/mount-root elements. The checkbox pseudo-element rules stay (audit §6) |

The pre-approved spinner change: git-ui's stepped 1.5s rotation becomes smooth 1s. Em literals
(`StashList`-style `0.8em`/`0.4em`/`3px`) go to the nearest `--kv-t-*`/`--kv-s-*`/`--kv-radius`
step. Each differs by 1px or less. List each in its commit body.

`KuiButton.vue`'s comment citing `.p-btn` geometry is reworded in A3.

### 6.5 What stays CSS in Stream A

- `GU/theme/vscode-tokens.css`, `kira-structure.css`, `density.css`, `kui-bridge.css`.
- `codicon.css` `@font-face`.
- `app-shell.css` checkbox pseudo-elements.
- CommitGrid's SlickGrid-DOM rules.

Final expected `<style>` count in `GU`: 1 (`CommitGrid`).

## 7. Commit order

### 7.1 Stream B (sequential, in its worktree)

| # | Commit |
|---|---|
| B1 | `fix(theme): register kira scales with tailwind-merge in cn() (P110 B1)` |
| B2 | `refactor: rename legacy bg-input to bg-field (P110 B2)` |
| B3 | `refactor: rename legacy text-muted to text-muted-foreground (P110 B3)` |
| B4 | `fix: restore muted colour on five dead text-fg-muted labels (P110 B4)` |
| B5 | `fix(theme): drop base.css duplicates of shadcn colour names, add class guard (P110 B5)` |
| B6 | `feat(theme): add search/syntax/error-text/bar tokens, utilities and spin keyframes (P110 B6)` |
| B7 | `fix(studio): run-state ring colours and size (P110 B7)` |
| B8 | `fix: panel heads honour h-bar (P110 B8)` |
| B9 | `refactor: dialog widths as utilities, drop DialogContent sm cap (P110 B9)` |
| B10 | `refactor: static inline styles and constant style bindings to classes (P110 B10)` |
| B11 | `feat(theme): add shadcn-vue field components (P110 B11)` |
| B12 | `refactor(workbench): settings fields onto Field components (P110 B12)` |
| B13 | `refactor(workbench): title-bar and tab-new controls as Button variants (P110 B13)` |
| B14-B20 | `refactor: replace .<alias> with <utility> (P110 B14…B20)` |
| B21 | `refactor(theme): delete dead primitive selectors (P110 B21)` |
| B22-B27 | component-backed primitives (§5.11 table) |
| B28-B30 | utility-only primitive families |
| B31 | `refactor(theme): primitives.css down to is-grow residue (P110 B31)` |
| B32-B34 | shared patterns (§5.13) |
| B35-B37 | raw-declaration blocks by area |
| B38-B40 | `@apply`-only blocks by area |

At the end of the stream, in its worktree, run `bun run test:ui:studio` and `bun run test:ui:space`
once. Fix what they find, as follow-up commits tagged `(P110 B-fix)`.

Why this order:
- **B1 first.** Every later class prop that crosses a shadcn component depends on correct merging.
- **B2-B5 next.** The rename frees `muted`/`input`/`border` before any conversion writes new
  utilities. Otherwise later commits would write `text-muted` and need renaming again. Once B5
  lands, the guard catches regressions.
- **B6 before its consumers.**
- **B7/B8 early.** They are the highest-value visible fixes, and they are independent of
  everything after.
- **B9/B10.** Trivial and exact.
- **B11-B13.** Empty `workbench.css`, a small self-contained global file.
- **B14-B31.** All global unlayered primitives, before any scoped block (§1.3).
- **B32-B40.** Scoped blocks last. §3.10 comes last because it changes no pixel.

### 7.2 Stream A (sequential, in its worktree)

| # | Commit |
|---|---|
| A1 | `build(git-ui): prefixed Tailwind build for git-ui and kira-ui sources (P110 A1)` |
| A2 | `feat(kira-ui): cn helper and theme partial for kv utilities (P110 A2)` |
| A3-A7 | `refactor(kira-ui): <component group> onto cva variants (P110 A3…A7)` |
| A8 | `refactor(kira-ui): delete controls.css (P110 A8)` |
| A9-A19 | `refactor(git-ui): <area> styles to kv utilities (P110 A9…A19)` |

At the end of the stream, in its worktree, run `bun run test:webview` and `bun run test:ui:space`
once. Fix what they find as `(P110 A-fix)`.

Why this order:
- **A1 before everything.** No `kv:` class generates CSS without it.
- **A2 before A3.** The components need `cn`.
- **Kui components (A3-A8) before git-ui blocks (A9+).** git-ui's scoped overrides of `.kui-*`
  become class props, and they need the component's `props.class` seam in place first.
- **A13 CommitGrid late.** It is the largest block and mixes in rules that stay CSS.

### 7.3 Closing step C (one Sonnet subagent, after both streams land, on the merged branch)

1. `chore: guard retired kui-* class names (P110 C1)`: append A3-A8's retired `kui-*` classes to
   `check-theme-classes.sh`, scanning `GU KU`. Reword `check-tokens.sh`'s header comment, which
   cites the deleted `controls.css`.
2. Run `bun run lint`, `typecheck`, `test:unit`, `build:studio`, `build:space`, `build:vscode`,
   `test:ui:studio`, `test:ui:space` and `test:webview` on the merged tree. Fix anything red,
   tagged `(P110 C-fix)`.
3. `test:visual:update:studio`, then `test:visual:studio` clean. Commit the re-recorded baselines as
   `test(studio): re-record visual baselines for P110 (P110 C2)`, listing which §1.4 changes each
   baseline shows.
4. `docs: record P110 CSS migration (P110 C3)`:
   - Update `docs/ARCHITECTURE.md:35`'s frontend-baseline row: primitives.css is residue, and
     git-ui has a `kv:`-prefixed Tailwind root.
   - Add the escape-hatch rule and the one-definition-per-theme-name rule to the styling section.
   - Remove any "Known open items" entry this closes.
5. The orchestrator writes `## P110 result` in `docs/v1.9/SPEC.md`.

## 8. Risks and drift notes

- **Drift.** This plan was verified at `771512bc`. Before B1 and A1, each implementer re-checks its
  stream's line references with `codegraph_explore` (§1.5) and re-counts the rename sets (§3.4).
  A count off by more than ~10% means new code landed; convert it too.
- **Rename regex overreach (B2/B3).** `text-muted` is a prefix of `text-muted-foreground`, and
  `bg-input` is a prefix of shadcn's `bg-input/30`. Exclude `PT/components/ui/`. Anchor on the
  word end (`(?![-\w])`). Then diff-review every hunk. The guard, not the regex, is the final check.
- **twMerge config and existing class props (B1).** Once `h-control` merges against `h-8`,
  a call site that passed both on purpose now keeps only the later one. Grep `cn(`/`class=` sites
  that pass a kira spacing or text token into a shadcn component. Check each renders as before,
  except the §3.3 Button colours.
- **Removing `sm:max-w-sm` (B9).** A future `DialogContent` with no width would span the viewport
  minus 2rem. Record this in `docs/ARCHITECTURE.md` (C3). Every dialog sets `w-N`.
- **Leak removal (B12).** Computed-style check per site (§5.9). Do not rely on a visual glance.
- **Same-element utility conflicts** after primitives convert. §1.3's replace rule covers it. A
  missed case shows as a pixel change in `test:ui`/visual. The fix is deleting the loser, never `!`.
- **`layer(components)` for the residue (B31).** A wrong call flips is-grow behaviour. Check the
  grow-input spec paths (`http-variables`, `autocomplete`) after B31.
- **git-ui in Space (Stream A).** Two Tailwind roots share Space's document. Both emit `@layer theme,
  base, components, utilities`, so layer order is shared. Prefixed classes cannot collide.
  `test:ui:space`'s repo-workspace specs cover the mounted git-ui.
- **`kv:` variant order.** In v4 the prefix comes first (`kv:hover:bg-x`, not `hover:kv:bg-x`). A
  wrong order silently generates nothing. The A-stream end-of-stream suites catch it. Spot-check
  the built CSS after A3.
- **VS Code theme runtime tokens.** `--kv-*` colours come from `--vscode-*`, set at runtime. The
  `inline` theme keeps them as `var()` references, so theme switches still apply.
  `test:webview` covers the light and dark fixtures it has.
- **Worktree hooks.** Each worktree needs its own `bun install`. A hook failure that comes from a
  missing install is not a code failure. Fix the install; never use `--no-verify`.

## 9. Verification (orchestrator runs each for real)

1. **Collision.** `grep -c -- '--color-muted:' -r packages/theme/src` gives 1, and the same for
   `--color-input:` and `--color-border:`. Build Studio and grep the emitted CSS for
   `--color-muted:var(--muted)` (or its inline equivalent).
2. **Renames.** `sh scripts/check-theme-classes.sh` passes. Its list includes `text-muted`,
   `text-fg-muted`, `bg-input`, `p-run-state`, `p-panel-head`, every alias, every retired `p-*`,
   the field vocabulary and the `kui-*` names.
3. **Real callers, not scaffolding.** Each fetched component has consumers:
   - `git grep -l "components/ui/field"` covers the settings panes.
   - `badge`, `native-select` and `resizable` each have 5+ importers.
   - `ToggleGroup` appears in `ConnectionDialog` and both `SettingsDialog`s.
   - `Button variant="title"` appears in both apps' title bars.
   - kira-ui's `cn` is imported by every `Kui*` component with variants.
4. **Stays-CSS count.**
   - `git grep -l '<style' -- '*.vue'` lists only the §5.15/§6.5 files: the Monaco/`v-html`/
     decoration holders, plus git-ui `CommitGrid`.
   - `wc -l packages/theme/src/primitives.css` shows only the residue.
   - `packages/workbench/src/workbench.css` has 2 non-comment lines.
   - `KU/theme/controls.css` is absent.
5. **Arbitrary values.** `git diff <phase-start>..HEAD -U0 | grep -oE '[a-z:-]+-\[[^]]+\]' | sort -u`.
   Every hit is on §1.2's allowlist or was already on the line before the phase. Same check for
   `\[--` arbitrary properties and a trailing `!`.
6. **Live bugs.** In a dev build, check the computed style of a running run-state ring: 12px,
   `border-top-color` = `--kira-accent`, label colour = `--kira-info`. Check the 4 panel heads are
   34px tall. Check a `toolbar` Button's colour is #9d9d9d at rest.
7. **Inline styles.** `git grep -nE 'style="' -- '*.vue'` and constant `:style="{` bindings match
   only §5.6's runtime list.
8. **Suites.** All of §0 acceptance 7, run on the merged branch. Hooks green on every commit
   (`git log --grep 'P110'` shows no `--no-verify` trail; spot-check with `git rebase -x` if in
   doubt).
9. **CodeGraph usage.** Confirm the implementers' tool-call logs show `codegraph_explore` for the
   §8 drift re-check (the one discovery step).
