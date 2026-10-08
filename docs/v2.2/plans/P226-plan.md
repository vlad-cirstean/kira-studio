# P226 plan: one colour mark everywhere

Base: `717fe5ef2` (P225/P226 SPEC rows), branch `v22-fix-B`.

## Ask (user's words)

"The colours in the left panel should be shown the same everywhere. If they are a coloured left bar in
studio then they are the same for scripts and for git."

SPEC row: one shared bar component and tone mapping instead of per-module variants.

One sequential Sonnet implementer. No stream split: every part edits `packages/theme/src/connColor.ts`'s
callers and the same two new UI specs, and Part A's helper must land before any caller moves.

## Inventory (verified on disk at base)

Palette colour means a stored `PaletteColor` (`packages/shared/domain/color.ts`), painted from
`--kira-conn-*` (`packages/theme/src/tokens.css`, exposed as `bg-conn-*`/`text-conn-*` in
`tailwind-core.css`). Every site below paints that token at full opacity unless stated.

Left-panel rows:

| # | Site | Shape | Paint | `'none'` | Icon |
|---|---|---|---|---|---|
| 1 | Studio `project/TreeRow.vue:149-153`, connections tree, every depth of a connection's group | `absolute inset-y-0 left-0 w-0.5`: 2px, full row height, square, at the panel edge | `bg-(--kira-rail)` + `:style` `connColorVar` | transparent, slot kept | not tinted |
| 2 | `packages/workbench/src/terminal/TerminalPanel.vue:323-327`, `378-382`, quick commands (both apps) | `w-2.5 h-2.5 rounded-full` 10px dot, replaces the play icon; nested rows sit in a `pl-3.5` wrapper | `connBgClass` | play icon instead | replaced by dot |
| 3 | Space `repo/GitPanel.vue:432-437` + `repoIconClass` l.150, repo rows (P222) | none: colour is the `source-control` icon's text colour | `connTextClass` | icon `text-fg`/`text-muted-foreground` by open state | tinted |
| 4 | Space `repo/GitPanel.vue:480-520`, worktree rows | no colour | | | |
| 5 | Space `repo/ReposDialog.vue:125`, dialog left nav (P222) | `size-2 rounded-full` 8px dot | `connBgClass` | invisible (no ring) | |
| 6 | Studio `api/CollectionsTree.vue`, docker lists, memory panel | no palette colour (collections have none) | | | |

Tabs:

| # | Site | Shape | Paint | `'none'` |
|---|---|---|---|---|
| 7 | `packages/workbench/src/components/TabStrip.vue:264-267` (both apps: Studio connection kinds, terminal kind = script colour, Space repo kinds via `repoRailColor`) | `w-0.5 h-3.5 rounded-xs shrink-0` inline bar | `bg-(--kira-rail)` + `:style` on the tab | transparent |
| 8 | Same file l.214-238, pinned repo-graph tab | no mark | | |

Main-area lists, headers, cells (Studio only):

| # | Site | Shape | Paint | `'none'` |
|---|---|---|---|---|
| 9 | `workbench/panels/StudioStart.vue:114-117`, recent rows | `w-0.5 h-3.5 rounded-xs` inline bar | `connBgClass` | transparent |
| 10 | `workbench/panels/OperationsPanel.vue:160-164`, op log connection cell | `w-2 h-2 rounded-kira-xs` 8px square | `connBgClass` | transparent |
| 11 | `api/EnvironmentsView.vue:286-291` rows; `api/EnvironmentSelect.vue:84-90`, `104`, `116-121`; `api/VariablesOverviewPanel.vue:202-208` | `size-1.25 rounded-full` 5px dot | var + `:style` | ring `bg-none border border-disabled` |
| 12 | View header dot + under-toolbar band: `views/shared/keyvalue/KeyValuePane.vue:718-735`, `views/httprequest/HttpRequestView.vue:469-527`, `views/definition/DefinitionView.vue:232-250`, `views/grpcrequest/GrpcRequestView.vue:277-329`, `views/browse/BrowseView.vue:284-303`, `views/stream/StreamView.vue:691-717`, `views/documents/DocumentView.vue:728-748`, `views/console/ConsoleView.vue:679-697`, `api/VariableSetView.vue:503-515`, `api/EnvironmentsView.vue:233-243` | dot as #11; band `h-0.5 shrink-0` | var + `:style` | dot ring; band transparent |
| 13 | `views/grid/DataView.vue:200`, `221-225` | dot + band as #12 | var + `:style` | **dot invisible**: condition tests `!railColor` only, so `'none'` gets `bg-(--kira-rail)` with an unset var instead of the ring every other view shows. Bug, fixed by Part D |

Not colour marks, out of scope (kept as is):
- Pickers: `packages/theme/src/SwatchRadio.vue`, `ContextMenu.vue` `swatch` (l.80, l.119). P222 kept pickers inline; this phase is display only.
- ADE board chips (main area, not rows): `repoTint`/`repoText` in `state/coderepos.ts`, used by `AdeRepoTag`, `AdeRepoChip`, `AdeBranchRow` (repo chip), `AdeTaskTab`, `AdeAddPopover`, `AdeCandidateRow`. A 12% tint pill, a different object from a row mark.
- View header icon tint `connTextClass` (`DataView`, `StreamView`, `DocumentView`, `KeyValuePane`, `StudioStart` `iconColorClass`): main-area target icon, not a list mark.
- State, not palette: ADE `TONE_*` maps (`ade/v2/tones.ts`, P213), ADE selection `border-l-3` (`AdeBranchRow`, `AdeBacklogRow`, `AdeWorkflowsPage`, `AdeTaskCard`), docker selection `shadow-[inset_2px_0_0_var(--color-focus)]`, mobile `taskColor`.

Differences in one line: five shapes (2px full rail, 2x14 bar, 5px dot, 8px dot, 10px dot, 8px square) plus an
icon tint, two paint paths (`--kira-rail` var with `:style`, literal `bg-conn-*`), three `'none'` behaviours
(transparent, ring, swap to an icon), and DataView's broken ring.

## Canonical look and why

The Studio tree rail (#1): 2px wide, full row height, square ends, flush with the panel's left edge, full
opacity `--kira-conn-*`, unchanged by hover or selection (only the row background changes), icon untinted,
`'none'` leaves the slot empty.

- The user named it.
- It is the design system's own law (P16, comment at `TreeRow.vue:57-60`): colour is a 2px rail on every row
  of the item's group, not a badge on one row.
- `PALETTE_COLOR_CHOICES` (color.ts:27-33) was picked for legibility "at a 2px rail or a 5px status dot";
  those two shapes are the designed ones. The 8px/10px dots, the square and the icon tint are not.
- It leaves the icon slot alone, so play/source-control keep their meaning and the colour does not
  fight open/selected text colours.

## Design decisions

D1. **One class map, not a component.** `colorMarkClass(mark, color)` in `packages/theme/src/connColor.ts`,
next to `CONN_BG`. Why theme, not workbench or kira-ui: the palette class map already lives there, both apps
and `packages/workbench` already import it, and `kira-ui` is the `kv:`-prefixed library shared with the VS
Code webview, which paints no palette colour. Why not a component: P104 §3 turned `ColorPicker` and
`RunState` (a status dot) into inline composition (no library counterpart), and P213 made dynamic colours
literal class maps. A function keeps every call site a plain `<span>` with its own `data-testid`.

D2. **Four marks, each one role.**

| Mark | Classes | Role |
|---|---|---|
| `rail` | `absolute inset-y-0 left-0 w-0.5` | left-panel list row of a coloured item; row must be `relative` |
| `bar` | `w-0.5 h-3.5 rounded-xs shrink-0` | inline before a label: tab chips, Studio Start recent rows |
| `dot` | `size-1.25 rounded-full shrink-0` | inline beside a label in a header, select, table cell or main-area list |
| `band` | `h-0.5 shrink-0` | 2px band under a view toolbar |

Paint: append `connBgClass(color)` (literal `bg-conn-*`). No `:style`, no `--kira-rail`.
`'none'`, `null`, `undefined`: `rail`, `bar`, `band` get the shape only (transparent, slot kept, same pixels
as today's unset var); `dot` gets `bg-none border border-disabled` (today's ring).

```ts
export type ColorMark = 'rail' | 'bar' | 'dot' | 'band';

// Tailwind emits only scanned literals, so each shape is spelled in full.
const MARK_SHAPE: Record<ColorMark, string> = {
  rail: 'absolute inset-y-0 left-0 w-0.5',
  bar: 'w-0.5 h-3.5 rounded-xs shrink-0',
  dot: 'size-1.25 rounded-full shrink-0',
  band: 'h-0.5 shrink-0',
};

/** Every palette colour mark in both apps. No colour: an empty slot, or an empty ring for a dot. */
export function colorMarkClass(mark: ColorMark, color: string | null | undefined): string {
  const paint = connBgClass(color);
  if (paint) return `${MARK_SHAPE[mark]} ${paint}`;
  return mark === 'dot' ? `${MARK_SHAPE.dot} bg-none border border-disabled` : MARK_SHAPE[mark];
}
```

`connBgClass('none')` already returns `undefined` (`CONN_BG` has no `none` key). Keep `connColorVar` (still
used by `repoTint`/`repoText`) and `connTextClass` (view icon tints).

D3. **Rule for which mark.** Left-panel row of a coloured item: `rail`. Tab: `bar`. Main-area inline mark:
`dot` (or `bar` where the row already shows one, Start recent rows). View toolbar underline: `band`.

D4. **Rail runs the whole group** (Studio law). Git panel worktree rows carry their repo's rail, like a
Studio table row carries its connection's rail. Quick-command collection header rows carry none (a
collection has no colour), like Studio group folders.

D5. **Rail at the panel edge.** Indentation moves into the row's own padding, never a wrapper, so a nested
row's rail sits at x=0 like `TreeRow` (which indents with `paddingLeft`).

D6. **Icons stop carrying colour in left panels.** Quick commands always show the play icon; Git repo rows
drop the `connTextClass` tint and keep the open-state colour. Matches `TreeRow` (engine icon untinted).

## Part A: shared class map, Studio tree and tab strip

1. `packages/theme/src/connColor.ts`: add D2's `ColorMark`, `MARK_SHAPE`, `colorMarkClass`. Fix the header
   comment's "rail/dot" sentence to point at `colorMarkClass`.
2. `apps/kira-studio/frontend/src/project/TreeRow.vue` l.149-153: rail becomes
   `<div :class="colorMarkClass('rail', railColor)" data-testid="tree-rail" />`. Drop `:style` and the
   `connColorVar` import.
3. `packages/workbench/src/components/TabStrip.vue` l.264-267: drop the tab's `:style`; keep `:data-color`;
   bar becomes `<span :class="colorMarkClass('bar', host.railColorFor(tab))" />`. Drop `connColorVar` import.
4. `apps/kira-studio/tests/ui/connections.spec.ts` l.328-331, 371-374, 473-475, 480-482: the four
   `toHaveAttribute('style', /--kira-conn-X/)` become `toHaveClass(/\bbg-conn-X\b/)` (orange, green, red,
   cyan).

Commit: `feat(theme): one class map for palette colour marks`.

## Part B: quick commands get the rail (both apps)

`packages/workbench/src/terminal/TerminalPanel.vue`:

1. Both script `<button>`s (ungrouped l.~312, grouped l.~367): add `relative`; first child
   `<span :class="colorMarkClass('rail', script.color)" data-testid="quick-command-rail" aria-hidden="true" />`.
2. Delete the `v-if="script.color !== 'none'"` dot and the `v-else`; the play icon
   (`<CodiconIcon name="play" :size="13" class="shrink-0 text-muted-foreground" />`) always renders.
3. D5: grouped wrapper `<div v-if="isOpen(...)" class="flex flex-col pl-3.5">` loses `pl-3.5`; grouped
   rows use `py-1 pl-5 pr-1.5` (6px row padding + 14px indent, same 20px text start as today) instead of
   `py-1 px-1.5`. Ungrouped rows keep `px-1.5`.
4. Replace the `connBgClass` import with `colorMarkClass`.

Commit: `feat(workbench): quick commands show their colour as a row rail`.

## Part C: Git panel and Repositories dialog get the rail

1. `apps/kira-space/frontend/src/repo/GitPanel.vue`:
   - Repo row (l.411-423): add `relative` to the static class; first child
     `<span :class="colorMarkClass('rail', repo.color)" data-testid="repo-rail" aria-hidden="true" />`.
   - Worktree rows (l.~483): add `relative`; first child
     `<span :class="colorMarkClass('rail', repo.color)" data-testid="repo-worktree-rail" aria-hidden="true" />`
     (D4; `repo` is in scope from the outer `v-for`).
   - `repoIconClass` (l.150-153): drop the colour branch, return
     `isOpen(repo.id) ? 'text-fg' : 'text-muted-foreground'`; drop the `connTextClass` import.
2. `apps/kira-space/frontend/src/repo/ReposDialog.vue` l.115-127: nav `<button>` gets `relative`; the dot
   becomes `<span :class="colorMarkClass('rail', r.color)" data-testid="repos-dialog-repo-rail" aria-hidden="true" />`
   as first child. Replace `connBgClass` import.
3. `apps/kira-space/tests/ui/repos-dialog.spec.ts` l.213-217: locator `repos-dialog-repo-rail`, same
   `toHaveClass(/bg-conn-red/)`.

Commit: `feat(space): repositories show their colour as a row rail`.

## Part D: Studio main-area marks through the map

Each site from inventory #9-#13 drops its hand-written shape, ternary, `:style` and `connColorVar`/`connBgClass`
import, and calls `colorMarkClass`. Keep every existing `v-if` (undefined means "no owner, no mark"),
`data-testid` and surrounding markup.

- Dots: `KeyValuePane.vue`, `HttpRequestView.vue`, `DefinitionView.vue`, `GrpcRequestView.vue`,
  `BrowseView.vue`, `StreamView.vue`, `DocumentView.vue`, `ConsoleView.vue`, `VariableSetView.vue`,
  `EnvironmentsView.vue` (header and rows), `DataView.vue` (fixes #13), `EnvironmentSelect.vue` (three:
  closed trigger, the static "no environment" option at l.104 as `colorMarkClass('dot', 'none')`, options),
  `VariablesOverviewPanel.vue`: `:class="colorMarkClass('dot', X)"`.
- Bands: the same ten views plus `DataView.vue`: `<div :class="colorMarkClass('band', railColor)" />`
  (`KeyValuePane` uses `connColor`).
- `StudioStart.vue` l.114-117: `colorMarkClass('bar', connectionFor(entry)?.color)`. `connTextClass` stays
  for `iconColorClass`.
- `OperationsPanel.vue` l.160-164: square becomes `colorMarkClass('dot', connectionFor(record)?.color)`.
- `StreamView.vue` l.76 comment: replace the `--kira-rail` wording with "no colour leaves the band empty".
- `scripts/check-theme-classes.sh` (same commit, P110 §5.12 rule): replacement text of `p-toolbar-rail`,
  `p-conn-dot`, `p-tab-rail`, `p-tree-rail` (l.529, 539-541) becomes `colorMarkClass('band'|'dot'|'bar'|'rail', color)
  (packages/theme/src/connColor.ts)`; append
  `check_class_all 'bg-\(--kira-rail\)' "colorMarkClass() (packages/theme/src/connColor.ts)"` after l.541.
  Confirm it fires by temporarily reintroducing one `bg-(--kira-rail)` locally, then remove it.

If `scripts/check-class-conflicts.ts` objects to the mark-name string literal inside `:class`, the mark
element carries no static `class`, so nothing can be dropped; fix the script only if it really fails.

Commit: `refactor(studio): paint colour dots, bars and bands through colorMarkClass`.

## Part E: cross-module UI specs

No unit test: `colorMarkClass` is a two-branch lookup (CLAUDE.md test bar).

1. `apps/kira-studio/tests/ui/color-rails.spec.ts` (new), one test. Fixtures: a connection coloured `cyan`
   (pattern from `connections.spec.ts`'s `CONTROL`) and a quick command coloured `cyan` (`IPC.customScriptsList`,
   pattern from `terminal-module.spec.ts`). Steps: read the connection row's `tree-rail`; switch to the
   terminal mode tab; read `quick-command-rail`. Assert for both:
   - `class` attribute equals exactly `'absolute inset-y-0 left-0 w-0.5 bg-conn-cyan'`;
   - bounding box width 2, `x` equals its row's `x`, height equals its row's height;
   - `getComputedStyle(el).backgroundColor` equal between the two.
   Add a second quick command with `color: 'none'`: its rail has class exactly
   `'absolute inset-y-0 left-0 w-0.5'` and the play icon is visible.
2. `apps/kira-space/tests/ui/color-rails.spec.ts` (new), one test. Fixtures: `REPO` shape from
   `git-panel-tab.spec.ts` with `color: 'cyan'`, a worktree list reused from `repo-workspace.spec.ts`'s
   worktree fixture, a `cyan` quick command. Assert the same exact class string and geometry on `repo-rail`,
   `repo-worktree-rail` (after expanding the repo), `quick-command-rail` (terminal mode), and
   `repos-dialog-repo-rail` (open via `manage-repos`; geometry check is width 2 and `x` equal to its row's).
   Open the repo; the repo tab's `data-color` is `cyan` and its bar's computed background equals the rail's.
3. Both specs pin the same literal, so Studio and Space rails match by construction of the test.

Commit: `test: colour rails match across modules`.

## Visual baselines (note only, do not re-record)

Expected zero pixel diff: same token, same geometry, var paint swapped for the literal class.
- Studio `workbench.spec.ts` (`workbench-shell`), `data-view.spec.ts` (`data-grid`, amber connection),
  `http-request-view.spec.ts`, `console.spec.ts`: header dots, bands, tree rails, tab bars repainted
  through the map.
- Studio `terminal-module.spec.ts` (`quick-commands-dialog`): dialog only, untouched.
- Space `settings.spec.ts`: untouched (its four baselines were already stale before P222).
A diff in any Studio baseline above is a regression to fix, not a re-record.

## Verification

Run once at the end (CLAUDE.md: expensive suites once per phase):
- `bun run typecheck`, `bun run lint`, `bun run lint:dead`.
- `bun run test:ui:studio` and `bun run test:ui:space` full; at minimum green: `connections`, `tree`, `tabs`,
  `terminal-module`, `api-ui-consistency`, `color-rails` (Studio); `repos-dialog`, `git-panel-tab`,
  `repo-workspace`, `terminal-quick-commands`, `modules`, `color-rails` (Space).
- `bun run test:visual:studio`, `bun run test:visual:space`: report results; no re-record.

Greps proving no per-module variant survives (run from repo root, exclude docs):
- `git grep -n "kira-rail" -- '*.vue' '*.ts' '*.css'`: no hits.
- `git grep -nE "connColorVar" -- '*.vue'`: no hits. In `.ts`: only `connColor.ts`, `state/coderepos.ts`.
- `git grep -nE "connBgClass" -- '*.vue' '*.ts'`: only `connColor.ts`, `SwatchRadio.vue`, `ContextMenu.vue`.
- `git grep -n "connTextClass" -- apps/kira-space packages/workbench`: no hits.
- `git grep -nE "size-1\.25 rounded-full|w-0\.5 h-3\.5|inset-y-0 left-0 w-0\.5|h-0\.5 shrink-0|bg-none border border-disabled" -- '*.vue'`:
  no hits.
- `git grep -nE "w-2\.5 h-2\.5 rounded-full|size-2 shrink-0 rounded-full|w-2 h-2 shrink-0 rounded-kira-xs" -- '*.vue'`:
  only `ContextMenu.vue` swatches.
- `git grep -n "colorMarkClass" -- '*.vue' '*.ts' | wc -l`: a real caller in each of TreeRow, TabStrip,
  TerminalPanel, GitPanel, ReposDialog and every Part D file.

## Docs

`docs/ARCHITECTURE.md`, folded into the Part E commit or a final `docs: P226 colour marks` commit:
- Stack table Styling row (l.34), after the P213 sentence: "**P226: every palette colour mark goes through
  `colorMarkClass(mark, color)` (`packages/theme/src/connColor.ts`): `rail` on left-panel rows (Studio tree,
  quick commands, Git panel repos and worktrees, Repositories dialog), `bar` on tabs, `dot` inline, `band`
  under view toolbars; no colour leaves the slot empty, a dot shows a ring.**"
- Per-repo colour bullet (l.3920-3925): "Git panel icon" becomes "Git panel and Repositories dialog row
  rails"; name `colorMarkClass`.
- Quick commands paragraph (l.~1366): rows show the colour as a left rail; the play icon always shows.

`docs/v2.2/SPEC.md`: P226 status `Done` and a `## P226 result` section (implementer); delete this plan in that
commit, as P222 did.

## Deferred decisions (defaults taken)

1. Git repo rows lose the P222 icon tint (D6). Alternative: keep both tint and rail. Default follows the
   Studio tree, which tints nothing.
2. Repositories dialog nav uses the rail, not a dot. It lists the same repos as the Git panel. Alternative:
   `dot`, as an inline mark in a dialog.
3. Op log connection cell moves from an 8px square to the 5px dot (visible change in the dock).
4. Pinned repo-graph tab stays icon-only, no bar.
5. ADE repo chips (`repoTint`/`repoText`) and view header icon tints stay: main-area objects, not row marks.
   Moving `repoTint` into theme as a generic palette tint is possible later if a second module needs a chip.
6. Disabled quick commands (`disabled:opacity-50`) fade their rail with the row. Studio has no disabled row
   to compare.
