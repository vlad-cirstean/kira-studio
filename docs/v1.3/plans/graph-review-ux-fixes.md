# G-UX: graph & review UX fixes before the G30–G32 review rounds

`docs/v1.3/plans/graph-review-ux-fixes.md`

> **What this is.** Not a `SPEC.md` phase. G1–G29 are shipped on `claude/feature-v1-3-headless-git`
> (HEAD `23cbe644`); the user has driven the real extension and reported nine concrete UX defects
> and gaps. This plan diagnoses each against the *shipped source* (not against earlier phases'
> plan documents, several of which describe intent the code drifted from or never fully matched)
> and specifies the fix. It lands **before** G30–G32's three review rounds, so those rounds review
> the corrected code rather than re-finding these nine by hand.
>
> `docs/v1.3/SPEC.md` is **not** edited by this plan.

---

## 1. Findings — root-cause diagnosis, item by item

Every citation below is `file:line` against the tree at `23cbe644`.

### F1 — Item 1a: author/date columns stay visible while the detail pane eats the width

`CommitGrid.vue` always builds four columns; `columns.ts:199-255`'s `buildColumns` has no notion of
a narrowed grid. The message column is *"whatever remains"*:

```ts
// CommitGrid.vue:192-195
function computeMessageWidth(hostWidth: number, laneCount: number): number {
  const fixed = graphColumnWidth(laneCount) + widths.value.author + widths.value.date;
  return Math.max(MIN_MESSAGE_WIDTH, hostWidth - fixed);
}
```

Defaults are `author: 140`, `date: 152` (`viewState.ts:74`), so **292 px plus the graph column** is
permanently reserved. Opening the detail pane removes a further `DEFAULT_DETAIL_WIDTH = 380`
(`viewState.ts:75`, `App.vue:1649-1656`) from `.kv-graph-region`. On a 1000 px-wide panel with the
pane open, the message column is left roughly `1000 − 380 − 292 − graph ≈ 300 px` — the subject
truncates almost immediately, which is precisely the "make space for the relevant content" the user
is describing. `MIN_MESSAGE_WIDTH = 120` (`CommitGrid.vue:93`) means it can be squeezed further and
the four columns then overflow the host.

**"Relevant content" resolves concretely to: the message column** (subject + ref badges + PR badge +
stack badges + search highlights). Everything the author/date columns show is *also* already in the
detail pane the click just opened (`CommitMeta.vue:322-331` renders Author/Committer) — so they are
literally duplicating what is on screen while starving the one column that is not.

### F2 — Item 1b: toggling commit details genuinely takes two clicks

`CommitGrid.vue:307-319`, unchanged since P4 and documented as intentional at the time:

```ts
function handleClick(row: number, cell: number): void {
  const dateColumnIndex = grid?.getColumns().findIndex((c) => c.id === DATE_COLUMN_ID) ?? -1;
  if (cell === dateColumnIndex) toggleDateFormat();

  const wasSelected = props.selection.row.value === row;
  props.selection.select(row);
  pendingFocusRow = row;
  if (wasSelected) emit('toggleDetail');   // ← only on the SECOND click
}
```

Click 1 on an unselected row only *selects*; `toggleDetail` fires only when the row was already the
selection. This is the whole mechanism — there is **no** `dblclick` binding (only
`instance.onClick.subscribe(...)` at `CommitGrid.vue:651`; SlickGrid's `onDblClick` is never
subscribed), no debounce, no focus-then-click two-step. The user's "2 clicks" is exactly this guard.

The user's suspicion about the cursor is *also* a real, separate defect, and it is what makes the
two-click behaviour read as a broken control rather than a deliberate one:

* `CommitGrid.vue:967-974` — `.kv-commit-grid .slick-cell` sets `position/border/padding/display/
  align-items/overflow` and **no `cursor`**. With `enableTextSelectionOnCells: true`
  (`CommitGrid.vue:607`) and text content, the UA default resolves to the I-beam.
* `CommitGrid.vue:1184-1190` — `.kv-cell-date` is the **only** cell with `cursor: pointer`, and it
  has it because clicking it toggles the date format (item 8). So today the one cell that looks
  clickable is the one whose click does something the user did not ask for, and the rows that *are*
  clickable look like static text.

Contrast `FileTree.vue:587-595`, which does set `cursor: pointer` on its rows — the grid is the
outlier.

### F3 — Item 2: the graph is the one piece of state that never auto-refreshes

The watcher → event → client pipeline is healthy end to end. Verified:

* `gitclient/watcher.go:25` — 200 ms leading-window debounce; `classify` (`watcher.go:66-100`)
  covers `commonDir/refs/**`, `HEAD`/`packed-refs`/`FETCH_HEAD`/`MERGE_HEAD`/`rebase-*`/
  `CHERRY_PICK_HEAD`/`REVERT_HEAD`/`BISECT_LOG`/`sequencer`/`config` (with `.lock` stripping,
  `watcher.go:52`), `gitDir/index` → `worktreeChanged`, and `commonDir/worktrees/**`.
* `gitsession/entry.go:196-222` — `note()` drops caches then fans out to every subscriber;
  `gitsession/conn.go:382-398` — `markWalksStale` already marks **both** walk slots stale on
  `refsChanged`, so the server is *already* prepared to re-walk.
* `extension.ts:489-493` — `manager.on('repo.changed', …)` forwards to `graphProvider
  .notifyRepoChanged`, `reviewProvider.notifyRepoChanged` and `reviewMarking`.

Nine client state classes subscribe to `repo.changed` and reload: `RefsState` (`refs.ts:61-65`),
`StashState` (`stash.ts:72-77`), `WorktreeState` (`worktrees.ts:22`), `StackState` (`stack.ts:61`),
`PrState` (`pr.ts:78`), `SearchState` (`search.ts:313`), `OpsState` (`ops.ts:271-274`, both kinds),
`ReviewSessionState` (`review.ts:104`), `ReviewCommentsState` (`reviewComments.ts:41`).

**`GraphViewState` does not.** It has no `bridge.on('repo.changed', …)` anywhere
(`graphView.ts:1-343`). The only consumer of the signal on the graph side is a *badge*:

```ts
// RefreshButton.vue:9-12 (doc comment, verbatim)
//  a `repo.changed` event with `kind: "refsChanged"` shows a small dot and changes the tooltip,
//  cleared again once a refresh actually runs. P4 does not auto-refresh — pulling the list out
//  from under a mid-scroll user because a background `git fetch` finished is exactly what §6.2
//  draws the line against.
```

```ts
// RefreshButton.vue:31-36
watch(() => props.repoState.lastChange.value, (change) => {
  if (change?.kind === 'refsChanged') hasPendingChange.value = true;
});
```

So: **the branch name, ref badges, stash list, worktree list, stack decorations, PR badges and
status banner all update automatically; the commit list itself never does.** That asymmetry is
exactly what the user experienced — most of the chrome moves, the graph does not, so the whole panel
reads as "not refreshing". This was a deliberate P4 decision (§6.2) that the user is now explicitly
overruling.

Two second-order defects fall out of the same code:

* `hasPendingChange` is cleared **only** inside `doRefresh` (`RefreshButton.vue:47`). Once
  auto-refresh exists, the dot must clear on *any* completed refresh or it becomes permanent noise.
* `App.vue:726-742` announces `composeRefreshAnnouncement(...)` into the polite live region every
  time `loading` leaves `'refreshing'`. A background refresh firing on every commit would spam a
  screen-reader user. The announcement must become manual-refresh-only.

There is **no missing kind**: saving a file touches nothing under `.git` and correctly produces no
signal (the graph shows committed history, not the working tree); `git add` produces
`worktreeChanged`, which `OpsState` already consumes for `isClean`/`inProgress`.

### F4 — Item 3: the file tree renders coarse monochrome codicons, not per-type icons

`FileTree.vue:479` renders `<span class="kv-file-tree-icon codicon" :class="fileIcon(row.node.path)"`,
resolved by `fileTreeModel.ts:397-423`'s `fileIconFor`. That function collapses **every** source
language onto one glyph:

```ts
// fileTreeModel.ts:329-333 (doc comment, verbatim)
/** Every genuine source extension this table knows about — none of these has a more specific
 *  codicon glyph than "this is code" (F9's own ceiling), so they all land on the one shared
 *  `codicon-file-code` icon; ... */
const CODE_EXTENSIONS = new Set(['js','jsx','ts','tsx','mjs','cjs','vue','py','go','rs','java', …]);
```

`.ts`, `.go`, `.vue`, `.rs`, `.py`, `.css`, `.html` — all `codicon-file-code`. Styling is
`.kv-file-tree-icon { width: 16px; font-size: 14px; color: var(--kv-description-fg) }`
(`FileTree.vue:634-640`) — one muted grey for everything. The codicon set has no per-language
glyphs, so this is a ceiling of the icon font, not a bug in the mapping.

Because `FileTree.vue` is the single component behind **both** trees (`DetailPane.vue:79-94`,
`StashDetailPane.vue`, `ReviewFilesPane.vue:112-126`, `ReviewCommitRow.vue:238-251` — see
`FileTree.vue:11-17`'s "one component, one anatomy" note from G21 D11), one change fixes both panels
the user named.

**License survey (against `CLAUDE.md`'s "only fully open-source libraries", checked at package *and*
feature level):**

| Source | License | Ships | Verdict |
|---|---|---|---|
| `seti-icons@0.0.4` (npm) | MIT | `lib/icons.json` (144 KB of SVG bodies, 173 icons), `lib/definitions.json` (11 KB: `files`/`extensions`/`partials`/`default`), `getIcon`/`themeIcons` (1.7 KB of code), `index.d.ts` | **Recommended.** Repackages jesseweed/seti-ui verbatim; `vs-seti` is derived from the same source. |
| `seti-ui@1.11.0` (npm) | MIT | 173 SVGs + `styles/components/icons/mapping.less` + `styles/ui-variables.less` | Viable; ships the raw assets but **no** generated font and no machine-readable mapping (LESS macros would need parsing). |
| VS Code `extensions/theme-seti/icons/{seti.woff, vs-seti-icon-theme.json}` | MIT | Most faithful, smallest bytes | Requires vendoring a **binary font** + generated JSON into the repo; no npm tracking. |
| `vscode-icons-js` / `vscode-icons` | MIT | A different icon set | Not what the user asked for. |
| `material-icon-theme` | MIT | A different icon set | Not what the user asked for. |

No non-commercial tier, no Enterprise gate, in any of them. Palette verified from
`seti-ui@1.11.0/styles/ui-variables.less` (these are the same hexes `vs-seti` uses as `fontColor`):
`white #d4d7d6`, `grey #4d5a5e`, `grey-light #6d8086`, `blue #519aba`, `green #8dc149`,
`orange #e37933`, `pink #f55385`, `purple #a074c4`, `red #cc3e44`, `yellow #cbcb41`.

### F5 — Item 4: three folder-browsing affordances exist; exactly one legitimate switcher exists

**Legitimate — must stay.** `RepoPicker.vue`'s candidate list (`RepoPicker.vue:93-115`) is fed by
`repo.list` → `proxyHandlers.ts:240-243` → `VsCodeWorkspaceRoots.list()`
(`ports/workspaceRoots.ts`), which is literally `vscode.workspace.workspaceFolders`. That **is** the
multi-root workspace switcher and is exactly the model the user wants.

**Illegitimate — three of them, all reaching one native OS dialog.**

1. `RepoPicker.vue:117-128` — the `Open Folder…` list row → `RepoPicker.vue:55-61`'s `openFolder()`
   → `RepoState.pick()` (`repo.ts:45-48`) → `repo.pick`.
2. `NoRepositoryPanel.vue:45-47` — a second, always-visible `Open Folder…` button →
   `NoRepositoryPanel.vue:26-31` → the same `repo.pick`.
3. `extension.ts:640-649` — the `kiraVersion.openRepository` **palette command**, which falls back
   to the native dialog when there is no workspace folder:
   ```ts
   const path = folder ?? (await dialogs.pickFolder({ title: 'Open Repository' }));
   ```

All three bottom out in `proxyHandlers.ts:244-247`:

```ts
'repo.pick': async () => {
  const path = await dialogs.pickFolder({ title: 'Open Repository' });
  return { path };
},
```

→ `ports/dialogs.ts`'s `VsCodeDialogs.pickFolder` → `vscode.window.showOpenDialog({ canSelectFolders: true })`.

`repo.pick` is answered **entirely inside the extension** — `grep -rn "repo.pick" apps/kira-studio/`
returns nothing; the Go server has never heard of it. The `Dialogs` port
(`git-core/src/ports/dialogs.ts`) has exactly **two** consumers (`proxyHandlers.ts:245`,
`extension.ts:648`) and one test fake (`ports/testFakes.ts:143`). Removing the feature removes the
whole port cleanly — leaving the port behind with no caller would be dead code, which
`CLAUDE.md`'s "scope left out is left out entirely, not half-implemented" argues against.

### F6 — Item 5: "Open in graph" is swallowed before VS Code can see it

The affordance is `ReviewCommitRow.vue:222-230`:

```vue
<a
  class="kv-review-row-action"
  v-kui-tooltip="'Open in graph'"
  aria-label="Open in graph"
  :href="openInGraphHref"
  @click.stop
>
```

Everything *around* it checks out:

* `openInGraphHref` (`ReviewCommitRow.vue:147-151`) builds
  `command:kiraVersion.openCommitInGraph?%5B%7B%22repoId%22…` and only degrades to `"#"` when
  `repoId` is undefined — and `ReviewView.vue:852` does pass `:repo-id="repoId"`, resolved at
  `ReviewView.vue:84/96/123`.
* `reviewView.ts:64-70` sets `enableCommandUris: [OPEN_COMMIT_IN_GRAPH_COMMAND]` — the array form,
  correctly listing that exact id (`reviewView.ts:33`).
* `extension.ts:463` registers `kiraVersion.openCommitInGraph` →
  `diffToolbar.ts:135-153`'s `openCommitInGraphCommand`, whose `asExplicitTarget`
  (`diffToolbar.ts:155-167`) accepts exactly the `{repoId, sha}` shape the href encodes, and calls
  `deps.graphProvider.runUiAction('revealCommit', fromArg)`.
* `panelView.ts:86-93`'s `runUiAction` handles both the live arm (`server.emit('ui.action', …)`) and
  the cold arm (`#pendingUiAction` → `html.ts:86` bootstrap island → `App.vue:880-882`), reaching
  `App.vue:801-803` → `revealCommitInGraph` (`App.vue:381-390`).
* The graph and review views live in **different** containers (`viewsContainers.panel.kiraVersion`
  vs `viewsContainers.activitybar.kiraVersionReview`), so focusing the graph cannot hide the review
  view mid-click.

The break is `@click.stop`. Vue's `.stop` modifier calls `event.stopPropagation()` on the anchor's
own listener. VS Code's webview preload registers its link interceptor as a **bubble-phase listener
on the webview document/`body`** — it walks the composed path for an `<a href>`, `postMessage`s
`did-click-link` to the host, then `preventDefault()`s. A `stopPropagation()` fired on the anchor
itself means the event never reaches that ancestor listener, so the `command:` URI is never
delivered to the host and the click is a silent no-op. Nothing in the webview's CSP is implicated —
`webviewDocument.ts:64-77` has no `navigate-to`/`form-action` directive and Chromium does not gate
link activation on `default-src`.

`.stop` is there for a real reason: the anchor sits inside `.kv-review-row-header`, which carries
`@click="onRowClick"` (`ReviewCommitRow.vue:186-190`), and an un-stopped click would also toggle the
row's expansion. The sibling "Open all changes" button solves the same problem with an explicit
`event.stopPropagation()` (`ReviewCommitRow.vue:116`) — harmless there, because that one *is* a real
JS handler and needs nothing from VS Code's link machinery.

Note the precedent for the right shape: G19 D10 fixed the mirror-image bug (a file-tree click
collapsing its own commit) by **moving the listener**, not by stopping propagation —
`ReviewCommitRow.vue:182-185` and the regression test at
`tests/interaction/review-interaction.spec.ts:43`.

> **Confidence.** High, from code alone. I could not run the Playwright harness to confirm without
> writing files (this planning task is strictly read-only, and `bun run test:webview` runs
> `build:vscode` first, which writes `dist/`). D5 below therefore specifies a fix that is correct
> regardless — the guard it adds is required for correctness even if some second cause also exists —
> plus a Tier-2 regression test that reproduces the exact mechanism (a document-level listener that
> must observe the click) without needing VS Code.

### F7 — Item 6: the status letter is full body-size bold mono

`FileTree.vue:647-652`:

```css
.kv-file-tree-status {
  min-width: 1ch;
  font-family: var(--kv-mono-font-family);
  font-weight: 700;
  flex-shrink: 0;
}
```

No `font-size`, so it inherits the row's `--kv-font-size` (13 px default) at weight 700 in the
*editor* mono font (`--kv-mono-font-family`), which is typically larger-looking per glyph than the
UI font around it. G21 D10 deliberately stripped the chip (background/border-radius/1.3em box) but
kept the letter at full size — that is the "too large" the user is reporting. Neighbours for
comparison: `.kv-file-tree-counts` is `0.85em` (`FileTree.vue:690-697`),
`.kv-file-tree-dir-stats` `0.85em` (`:623-630`), `.kv-file-tree-file-dir`
`var(--kv-t-xs, 0.85em)` (`:683-688`). The status letter is the only sub-element still at 1em/700.

`.kv-file-tree-icon` at `font-size: 14px` in a 16 px box (`:634-640`) is *also* on the large side
relative to VS Code's own 16 px explorer icon box, and is replaced wholesale by D3 anyway.

### F8 — Item 7: trailers render outside the clamp; SHA/parents/author eat the pane

`CommitMeta.vue` mounts twice — `section="message"` above the tree and `section="details"` below it
(`DetailPane.vue:71-103`, and `CommitMeta.vue:25-28` explains why).

**7a — trailers.** The clamp (`CommitMeta.vue:266-271`, `:385-392`) applies to `.kv-meta-body`
only — a 4-line `-webkit-line-clamp`. The trailers are a **separate `<dl>` rendered
unconditionally, after the "Show more" toggle, entirely outside the clamp**:

```vue
<!-- CommitMeta.vue:280-288 -->
<dl v-if="trailerRows.length > 0" class="kv-meta-trailers">
  <template v-for="(row, index) in trailerRows" :key="index">
    <dt>{{ row.token }}</dt>
    <dd v-if="row.name !== undefined">{{ row.name }} <span class="kv-meta-trailer-email">…</span></dd>
    <dd v-else>{{ row.raw }}</dd>
  </template>
</dl>
```

`trailerRows` (`CommitMeta.vue:215-226`) maps *every* trailer git reported. The Go side already
separates them cleanly: `porcelain/show.go:22` formats `%(trailers:only=true,unfold=true)` into its
own field, and `SplitTrailerBlock` (`show.go:99-120`) strips the trailer paragraph out of `body`.
So `detail.body` is already trailer-free and `detail.trailers` is structured — this is purely a
rendering decision, and today's decision is "always show all of them, always expanded". Two
trailers (`Co-Authored-By: …`, `Claude-Session: https://claude.ai/code/session_…`) is four grid rows
of metadata sitting permanently above the file tree.

**7b — the details section.** `CommitMeta.vue:291-354` renders, in order: **SHA** (`:293-306`, with
its own copy button), **Parent/Parents** (`:307-321`), **Author** (+ **Committer** when they differ,
`:322-331`), **Refs** (`:332-333`), **Signature** (`:334-337`), **Pull request** (`:338-353`). The
first three are exactly what the user asked to remove or relocate. There is no date row at all,
despite `CommitMeta.vue:122-126`'s doc comment claiming "author and committer with both timestamps"
— a drift between plan prose and shipped code, which is why the user's own wording ("author …
shown at the bottom") is the accurate description.

**7c — the 80 % target.** `.kv-detail-pane` is a flex column (`DetailPane.vue:110-115`) with the
message meta (auto), the tree (`flex: 1` via `.kv-file-tree`, `FileTree.vue:549-554`) and the
details meta (auto). The tree already takes the remainder, so the *only* way to hit 80 % is to
shrink what sits above and below it and then bound both. `.kv-commit-meta` carries
`padding: var(--kv-space-4)` and `gap: var(--kv-space-4)` (`CommitMeta.vue:360-365`); the message
block alone is subject + up to 4 body lines + a toggle + N trailer rows.

### F9 — Item 8: the date-format toggle is a *cell* click, not a header click, and is already persisted

There is no column header to click — `showColumnHeader: false` (`CommitGrid.vue:606`). The toggle is
`CommitGrid.vue:310-313`: any click landing in the date **cell** flips relative↔absolute, via
`toggleDateFormat()` (`:299-305`), which emits `update:dateFormat` up to `App.vue:1361`. So a user
clicking a row anywhere near its right edge silently reformats the whole column — and, because of
F2, that same click does not open the detail pane. `.kv-cell-date { cursor: pointer }`
(`:1189`) advertises this as the grid's only clickable thing.

The **value is already persisted**: `PersistedViewState.dateFormat` (`viewState.ts:48`), written by
`App.vue:1000-1049`'s persistence watch and restored at `App.vue:950`. Default `'relative'`
(`App.vue:159`, `:917`). So item 8 needs **no new storage** — only a relocation of the control.

`RepoSettingsDialog.vue` (opened from `AppToolbar.vue:353-360`'s gear via
`App.vue:1300`/`:1528-1532`) is the established settings surface, and it already carries the exact
precedent for a field whose scope differs from the dialog's default: the `kiraVersion.log.level`
note (`RepoSettingsDialog.vue:106`, `:241-243`, driven by `SETTINGS[...].instanceWide`).

### F10 — Item 9: the search box is a bespoke widget in the toolbar's right-hand cluster

`SearchBox.vue` is mounted inline in the toolbar between the spacer and the gear
(`AppToolbar.vue:345-360`), i.e. crammed into the same 35 px row (`--kv-toolbar-height`) as the repo
picker, branch picker, refresh, fetch/pull/push, stash, gear, remote progress and undo. Its input is
a **raw `<input class="kv-search-input">`** (`SearchBox.vue:260-277`) inside a hand-rolled
`.kv-search-box` shell (`:350-378`) — `height: 22px`, its own border/background/radius, a
160 px-fixed field, plus three `.kv-search-toggle { width:20px; height:18px }` buttons
(`:385-389`) and a `KuiSelect` scope dropdown.

It is **not** `KuiSearchInput`, and `SearchBox.vue:1-10` says why, verbatim:

> `SearchBox.vue`'s main query input stays raw (G19's own reasoning, restated at that call site):
> it is a full ARIA combobox with `aria-activedescendant` and regex-error `aria-describedby`
> wiring bound directly to its own ref, not a simple filter.

`KuiSearchInput.vue:19-23` takes exactly three props (`modelValue`, `placeholder`, `ariaLabel`),
forwards no `keydown`, and exposes only `focus()` — it genuinely cannot express the combobox today.
Its visuals (`controls.css:340-390`) are the ones used by `FileTree.vue:423-429`,
`BranchPicker.vue` (×2) and `review/BaseSelector.vue:128` — five call sites the graph search does
not match.

Shortcuts today: `/` and `Ctrl/Cmd+F` **focus** the input from anywhere in the webview
(`SearchBox.vue:238-245`) — there is no *toggle*, because the box is always rendered. `Escape` is a
two-stage dismiss (`:188-200`).

`contributes.keybindings` holds exactly two entries, both scoped identically:

```json
{ "command": "kiraVersion.goToStackParent", "key": "alt+up",   "when": "focusedView == 'kiraVersion.graph'" },
{ "command": "kiraVersion.goToStackChild",  "key": "alt+down", "when": "focusedView == 'kiraVersion.graph'" }
```

That `when` clause is the convention. Conflict scan for a new binding under it: `ctrl+f`/`cmd+f`
collides with `actions.find` (`when: editorFocus || editorIsOpen` — `editorIsOpen` is true whenever
*any* editor tab exists, which is the normal case); `ctrl+shift+f` is `workbench.view.search`;
`ctrl+shift+g` is `workbench.view.scm`; `alt+f` opens the File menu on Windows/Linux.
`ctrl+alt+f` / `cmd+alt+f` is unbound by default on all three platforms (macOS's
`cmd+alt+f` = Find-and-Replace requires `editorFocus`, which is false while a webview view has
focus) — it is the clean choice.

---

## 2. Decisions

### D1 — Item 1a: hide `author`/`date` while the detail pane is open; reflow into `message`

`CommitGrid.vue` gains one prop, `detailOpen: boolean`, bound from `App.vue`'s existing
`detailOpen` ref (`App.vue:157`). When it is `true`:

* `currentColumns()` (`CommitGrid.vue:228-252`) builds **graph + message only**.
* `computeMessageWidth` (`:192-195`) stops subtracting `widths.author + widths.date`, so all
  292 px go to the subject.
* Both resize handles (`:819-846`) are `v-if`'d out, and `updateHandlePositions` (`:254-259`) is
  skipped — a handle for a column that is not rendered is a dead hit target.
* `applyAccessibility` (`:507-577`) is **untouched**: `composeRowLabel(commit, dateText)` still
  puts the author and the date into every row's `aria-label` (`:533-538`), so nothing is lost to a
  screen reader — the columns are a *visual* redundancy with the pane, not an information source.

`buildColumns` (`columns.ts:199-255`) grows one optional `options: { compact?: boolean }` parameter
and returns 2 or 4 columns accordingly, keeping the column model in the one module that owns it.
`ColumnWidths` persistence is untouched — a width the user dragged is remembered and reappears the
moment the pane closes.

**Alternative considered:** keep four columns and shrink `author`/`date` proportionally. Rejected —
a 40 px author column shows an ellipsis and nothing else, which is worse than absent, and it does
not return the width the message column actually needs.

### D2 — Item 1b: one click opens; the cursor says so

```ts
function handleClick(row: number): void {
  const wasSelected = props.selection.row.value === row;
  props.selection.select(row);
  pendingFocusRow = row;
  if (wasSelected) emit('toggleDetail');
  else emit('openDetail');
}
```

* New `openDetail` emit → `App.vue` sets `detailOpen.value = true` (a dedicated one-liner, not
  `toggleDetail`, so a click on a *different* row while the pane is open never closes it).
* Clicking the already-selected row still toggles (§6.4's model, and the only way to close by
  mouse); `Enter` still toggles (`CommitGrid.vue:430-433`); `Esc` still closes (`:434-437`).
* The `cell` parameter and the `DATE_COLUMN_ID` import disappear along with D8's toggle removal.
* CSS: add `cursor: pointer` to `.kv-commit-grid .slick-row` and drop it from `.kv-cell-date`
  (`:1189`), which is no longer clickable. `enableTextSelectionOnCells: true` stays — a pointer
  cursor does not prevent drag-selecting a subject.
* `App.vue:1088-1093`'s narrow-breakpoint "selection opens the pane" watch stays as-is; it now
  agrees with the wide breakpoint instead of contradicting it.

### D3 — Item 3: real seti file icons, in both trees

**Dependency:** `seti-icons@0.0.4` (MIT), added to `packages/git-ui/package.json`. Chosen over the
alternatives in F4 because it is the only option that ships *both* halves (icon bodies **and** a
machine-readable filename/extension/partial → `[icon, color]` mapping) as tracked, MIT, plain-data
npm content, with no vendored binary and no LESS-parsing build step. Its own README's caveat
("in a webapp … better to use an SVG spritesheet") is addressed below.

**Rendering — CSS mask, not inline SVG or `v-html`:**

New `packages/git-ui/src/icons/setiFileIcon.ts`:

```ts
// Palette: seti-ui@1.11.0/styles/ui-variables.less — the same hexes vs-seti uses as `fontColor`.
// `white` (seti's default/unknown icon) is deliberately NOT #d4d7d6: that is invisible on a light
// VS Code theme. It resolves to the host's own muted foreground instead, so the fallback icon
// follows the user's theme exactly as every other muted glyph in this panel already does.
const themed = themeIcons({ blue:'#519aba', green:'#8dc149', orange:'#e37933', pink:'#f55385',
  purple:'#a074c4', red:'#cc3e44', yellow:'#cbcb41', grey:'#4d5a5e', 'grey-light':'#6d8086',
  ignore:'#6d8086', white:'var(--kv-description-fg)' });

export function setiIconFor(path: string): { maskUrl: string; color: string }
```

* Keyed on the **basename** (`seti-icons`' own `getDetails` slices from `fileName.indexOf('.')`,
  so a full path would poison extension matching; `.gitignore`-style dotfiles resolve correctly
  from a basename).
* The `svg` string becomes `url("data:image/svg+xml,<encodeURIComponent(svg)>")`, **memoised per
  icon name** in a module-level `Map` — a session touches ~10–20 distinct icons, so at most that
  many data URLs are ever built. This is the direct answer to the package's spritesheet caveat.
* CSP: `webviewDocument.ts:67` already allows `img-src ${cspSource} data:`, which is the directive
  a CSS mask fetch is checked against. No CSP edit.
* **No dynamic `import()`** — CSP is `script-src 'nonce-…'` with no `'strict-dynamic'`, so a
  code-split chunk would be blocked. The 144 KB of icon data is a static import; that is ≈40 KB
  gzipped and a low-single-digit-millisecond parse, which does not threaten §5.1's ≤300 ms
  first-paint budget (a plain read of the cost, per `CLAUDE.md`'s "measure only when a real
  question is at stake").

**`FileTree.vue`:**

```vue
<span
  class="kv-file-tree-icon"
  :style="{ maskImage: icon.maskUrl, WebkitMaskImage: icon.maskUrl, backgroundColor: icon.color }"
  aria-hidden="true"
></span>
```

```css
.kv-file-tree-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  mask-size: contain; mask-repeat: no-repeat; mask-position: center;
  -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;
}
```

**Directories keep the chevron** (`FileTree.vue:461-466`) — `vs-seti` itself ships no folder icons,
and the chevron already carries expand/collapse state.

`fileTreeModel.ts`: `fileIconFor` and its eleven extension tables (`:290-423`) are **deleted**, along
with their unit coverage in `fileTreeModel.test.ts`. `STATUS_LETTERS`/`STATUS_COLOR_CLASS`
(`:10-31`) stay — §6.1's "no colour-only meaning" is satisfied by the letter, not the icon.

`NOTICES.md` gains a `## seti-icons / seti-ui` section (MIT, both upstreams credited, following the
existing `## simple-icons` shape).

### D4 — Item 4: the workspace is the only source of repositories

Removed, in full:

1. `RepoPicker.vue` — the `Open Folder…` `<li>` (`:116-128`), `openFolder()` (`:55-61`), and the
   now-orphan `.kv-repo-separator` rule. The candidate list and its "No repositories found" empty
   state stay exactly as they are. **This is the legitimate multi-root switcher and it is
   untouched.**
2. `NoRepositoryPanel.vue` — the `Open Folder…` button (`:45-47`) and `openFolder()` (`:26-31`).
   Its copy changes to state the model plainly: *"Kira Version follows the folders open in this VS
   Code window. None of them is a Git repository — open one with File → Open Folder."*
3. `RepoState.pick()` (`repo.ts:45-48`).
4. `proxyHandlers.ts:244-247`'s `'repo.pick'` handler and the `dialogs` dep
   (`:84`, `:184`); `proxyHandlers.test.ts:39`/`:206`'s `dialogs: {} as any` fixtures.
5. `git-core/src/ports/dialogs.ts`, its re-exports (`ports/index.ts:3`, `src/index.ts:113`), and
   `FakeDialogs` (`ports/testFakes.ts:143-155`).
6. `apps/kira-studio-vscode/src/ports/dialogs.ts` (`VsCodeDialogs`) and its construction
   (`extension.ts:309`, `:385`).
7. `Contract['requests']['repo.pick']` (`contract.ts:1489`), `REQUEST_KEY_MAP['repo.pick']`
   (`validate.ts:152`), `rpc.test.ts:124`.

**Kept, narrowed:** `kiraVersion.openRepository` stays a registered palette command (it is
cross-checked by `commands.test.ts` against `contributes.commands`, and removing it would ripple
into that audit for no user benefit) but `openRepository` (`extension.ts:640-…`) loses its
`dialogs.pickFolder` fallback:

* 1 workspace folder → open it (today's behaviour).
* ≥2 → `vscode.window.showQuickPick` over `vscode.workspace.workspaceFolders` — the same set the
  toolbar dropdown offers, reached from the palette.
* 0 → `showInformationMessage("Kira Version follows this window's workspace folders — open a folder
  first (File → Open Folder).")`.

**Alternative considered:** delete the UI affordances only, leaving `repo.pick`/`Dialogs` on the
wire. Rejected: it leaves a port with zero consumers and a live wire method that any future phase
could re-surface by accident, which is the opposite of what the user asked for.

### D5 — Item 5: let the click reach VS Code; guard the header instead

Two edits in `ReviewCommitRow.vue`:

```vue
<!-- was: @click.stop  — see this plan's F6: a stopPropagation() on the anchor's own listener
     prevents VS Code's own bubble-phase link interceptor from ever seeing the click, so the
     `command:` URI is never delivered to the host. -->
<a class="kv-review-row-action" v-kui-tooltip="'Open in graph'" aria-label="Open in graph"
   :href="openInGraphHref">
```

```ts
function onRowClick(event: MouseEvent): void {
  // The row-action cluster (Open all changes, Open in graph) is inside this header; a click on it
  // is not a request to expand the row. Guarded here rather than stopped at each action, because
  // one of those actions is a `command:` anchor VS Code must be allowed to see bubble past us.
  if ((event.target as Element | null)?.closest('.kv-review-row-actions')) return;
  emit('focus-row');
  emit('toggle');
}
```

`openAllChanges`'s own `event.stopPropagation()` (`ReviewCommitRow.vue:116`) becomes redundant and is
removed, so there is one rule for the whole cluster. `Enter` on the anchor still works — the browser
synthesises a click that now bubbles normally.

This mirrors G19 D10's fix shape exactly (move/guard the toggle, never stop propagation) and is
required for correctness regardless of whether F6's mechanism is the *only* cause: without the
guard, un-stopping the anchor would toggle the row on every "Open in graph" click.

### D6 — Item 6: shrink the status letter to the tree's secondary scale

```css
.kv-file-tree-status {
  min-width: 1ch;
  font-family: var(--kv-mono-font-family);
  font-size: var(--kv-t-xs, 0.85em);   /* was: inherited 1em */
  font-weight: 600;                     /* was: 700 */
  line-height: 1;
  flex-shrink: 0;
}
```

`--kv-t-xs` is `calc(var(--kv-font-size) - 2px)` under `.kv-skin-kira`
(`kira-structure.css:25`), which `FileTree.vue`'s root already applies (`FileTree.vue:411`), with an
`0.85em` fallback matching `.kv-file-tree-file-dir`'s existing pattern (`:687`). This puts the
letter on the same secondary tier as the `+n/−n` counts and the dimmed directory suffix. The colour
classes (`.kv-status-added` … `.kv-status-unmerged`, `:654-674`) are untouched — the letter still
carries meaning without colour.

`.kv-file-tree-changed-badge`'s `font-size: 0.5em` (`:706-710`) is already tiny and stays.
`.kv-file-tree-icon` is re-specified by D3 at a 16 px box, matching VS Code's explorer.

### D7 — Item 7: the commit-detail panel becomes subject + tree

**7a — trailers move inside the collapsible region, and out of the collapsed view.**
The `<dl class="kv-meta-trailers">` (`CommitMeta.vue:280-288`) moves inside a new
`v-if="bodyExpanded"` block. Collapsed (the default) shows **subject + clamped body + toggle** and
nothing else.

*Alternatives weighed:* (i) drop trailers everywhere — rejected, `Signed-off-by` and
`Co-authored-by` are real attribution a user legitimately looks for, and the parsing that renders
them nicely (`CommitMeta.vue:201-226`) already exists; (ii) filter to a denylist of "noisy" tokens —
rejected, it hard-codes a policy about which trailers matter and would silently hide a project's own
convention; (iii) **move them behind the existing "Show more" toggle** — chosen: zero information
lost, zero space cost in the default view, one affordance the user already knows.

**7b — author moves up; SHA and parents are deleted.**
* `Author` (and `Committer`, when `committerDiffersFromAuthor` is true — `CommitMeta.vue:127-135`)
  moves into the same `v-if="bodyExpanded"` block, above the trailers, rendered as a compact
  `Name <email>` line rather than a `<dl>` row.
* The `SHA` row (`:293-306`), `copyFullSha`, `shaCopied`/`shaCopiedTimer` (`:232-243`), `shortSha`
  (`:106`), `.kv-meta-sha`/`.kv-meta-sha-row`/`.kv-meta-mono` CSS (`:449-467`) — **deleted**. The
  sha is not lost: the row context menu's `copySha` (`rowMenuModel.ts`'s `buildRowMenu`, dispatched
  at `App.vue:471-473`) remains the copy path, and G19 D7 already set the precedent of deleting a
  redundant sha affordance in favour of the context menu.
* The `Parent`/`Parents` row (`:307-321`), `parentRows` (`:108-120`), `.kv-meta-parents`/
  `.kv-meta-parent` CSS (`:469-489`) — **deleted**. The `selectParentCommit` emit
  (`CommitMeta.vue:38`), `DetailPane.vue:40/44-46/77/101`'s forwarding and `App.vue:338-346`'s
  `selectCommitFromDetail` go with it (nothing else emits it — verified). The graph's own edges are
  how you reach a parent.
* What survives in `section="details"`: **Refs**, **Signature**, **Pull request** — each already
  conditional. The whole `<section>` gains a `v-if` so that when all three are absent (the common
  case: no decoration on this commit, unsigned, GitHub disabled) it renders **nothing at all**,
  rather than an empty padded box.

**7c — the 80 % proportion, enforced by layout, not by hope.**

```css
/* DetailPane.vue */
.kv-detail-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* The subject/description block: naturally ~3 lines collapsed; hard-bounded so a pathological
   subject or an expanded description can never push the tree below its share of the pane. */
.kv-detail-pane-meta          { flex: 0 0 auto; max-height: 20%; overflow: hidden; }
.kv-detail-pane-meta--expanded{ max-height: 50%; overflow: auto; }
.kv-detail-pane-details       { flex: 0 0 auto; max-height: 12%; overflow: auto; }
.kv-detail-pane-tree          { flex: 1 1 auto; min-height: 0; }
```

plus, in `CommitMeta.vue`, the collapsed clamp tightens from 4 lines to **2**
(`-webkit-line-clamp: 2`, `:387-392`) and the block's padding drops from `--kv-space-4` to
`--kv-space-3` with `gap: var(--kv-space-2)` (`:360-365`).

Arithmetic for the common case (13 px font, `--kv-row-height` 22 px, a 1-line subject, a 2-line
body, no refs/signature/PR): meta ≈ 6 px + 18 + 4 + 36 + 18 + 6 ≈ **88 px**, details **0 px**, tree
= the rest. At a 480 px pane the tree gets **≈82 %**; at 400 px, **≈78 %**; at 320 px the 20 % cap
binds and the tree gets **80 %**. The caps are what make the bad cases (a wrapped 3-line subject,
an expanded description) degrade to ≥68 % instead of collapsing the tree. This is directly
measurable — see the Tier-2 exit criterion.

`CommitMeta.vue`'s own `section` prop and double-mount survive unchanged; only what each section
renders changes.

### D8 — Item 8: a Display setting, and the cell click goes away

* `CommitGrid.vue`: delete `toggleDateFormat` (`:299-305`), the `update:dateFormat` emit
  (`:58`), the `dateFormatRef` local mirror (`:128`) and the `DATE_COLUMN_ID` import/branch
  (`:31`, `:310-313`). The formatter accessor reads the prop directly
  (`{ dateFormat: () => props.dateFormat, … }`, `:233`), with a
  `watch(() => props.dateFormat, () => { grid?.invalidateAllRows(); grid?.render(); })` mirroring the
  four existing `generation`/`searchGeneration`/`pr`/`stack` watchers (`:718-762`). Drop
  `cursor: pointer` from `.kv-cell-date` (`:1189`). `App.vue:1361`'s `@update:date-format` binding
  goes; the `dateFormat` ref, its persistence (`viewState.ts:48`) and its `'relative'` default
  (`App.vue:159`) stay exactly as they are.
* `RepoSettingsDialog.vue` gains a **Display** section, placed first (above **Graph**):

  ```vue
  <section class="kv-repo-settings-section">
    <h3 class="kv-repo-settings-heading">Display</h3>
    <label class="kv-dialog-field">
      Commit date
      <KuiSelect :model-value="dateFormat"
                 :options="[{value:'relative',label:'Relative (3 days ago)'},
                            {value:'absolute',label:'Absolute (2024-12-30 22:48)'}]"
                 @update:model-value="v => emit('update:dateFormat', v as DateFormat)" />
    </label>
    <p class="kv-dialog-note">This applies to every repository in this panel, not just this one.</p>
  </section>
  ```

  It arrives as a `dateFormat` prop and leaves as an `update:dateFormat` emit — it does **not** join
  the `draft`/`patch` diff in `save()` (`:112-151`), because it is not a `repoSettings.set` key. It
  applies immediately (like every other view preference), not on Save. The scope note reuses the
  `log.level`-note precedent (`:241-243`) verbatim in shape.
* `App.vue` binds `:date-format="dateFormat"` / `@update:date-format="dateFormat = $event"` on
  `<RepoSettingsDialog>` (`:1528-1532`).

**Alternative considered and rejected:** add `kiraVersion.graph.dateFormat` to
`git-core/src/settings/schema.ts` + `RepoSettingsSnapshot`/`Patch` + the Go per-repo store, the full
G18 pattern. Rejected on three grounds: (a) date format is a *user* preference, not a repository
fact, so per-repo storage is the wrong scope and would surprise a user switching repos; (b) it
already has a correct home in `PersistedViewState`, so this would mean two stores for one value;
(c) it would force a `CONTRACT_VERSION` bump plus Go schema/storage work for a display toggle. The
one cost of the chosen design — a dialog whose fields come from two backing stores — is exactly what
the visible scope note exists to explain, and the dialog already does this for `log.level`.

### D9 — Item 9: a real search row, built from `KuiSearchInput`, toggled by a shortcut

**9a — `KuiSearchInput` grows an ARIA/keyboard escape hatch** (`packages/kira-ui`):

```ts
const props = defineProps<{
  modelValue: string; placeholder?: string; ariaLabel: string;
  /** Combobox callers only (git-ui's SearchBox): forwarded verbatim onto the real <input>, which
   *  a caller cannot otherwise reach — the component's root is a <div>, so a fallthrough attr
   *  lands in the wrong place (the same reason `focus()` is exposed). */
  role?: string; ariaExpanded?: boolean; ariaControls?: string;
  ariaActivedescendant?: string; ariaDescribedby?: string; ariaInvalid?: boolean;
  ariaHaspopup?: string;
}>();
```

plus `@keydown` forwarded from the inner `<input>` (Vue's default attrs inheritance would put a
`@keydown` listener on the root `<div>`, which sees the event only after the input's own handlers —
adequate for bubbling, but an explicit forward keeps the contract obvious and matches `focus()`).
Every prop is optional; the five existing call sites (`FileTree.vue:423`, `BranchPicker.vue` ×2,
`BaseSelector.vue:128`, `ReviewView.vue:667`) render byte-identically.

*Alternative:* copy `.kui-search-input`'s CSS into `.kv-search-box`. Rejected outright — that is
precisely the duplication G19 D3a and G21 D2 closed at its source.

**9b — the search row moves below the toolbar.** `SearchBox.vue` is removed from
`AppToolbar.vue:347-351` and rendered by `App.vue` as a sibling *between* `<AppToolbar>` and
`<ConflictBanner>` in **both** template branches (`App.vue:1275-1303` and `:1306-1332`), inside a
`v-if="searchOpen"` row:

```css
.kv-search-row {
  display: flex; align-items: center; gap: var(--kv-space-2);
  padding: var(--kv-space-1) var(--kv-space-3);
  background-color: var(--kv-toolbar-bg);
  border-bottom: 1px solid var(--kv-toolbar-border);
  flex-shrink: 0;
}
```

`SearchBox.vue`'s own `.kv-search-box` shell CSS (`:350-378`) is deleted; the input becomes
`<KuiSearchInput class="kv-search-field" …>` with `flex: 1; min-width: 0` so it grows to the row
width instead of a hard 160 px. The three toggles keep their `KuiButton`s but drop the bespoke
`.kv-search-toggle { width:20px; height:18px }` override (`:385-389`) in favour of `KuiButton`'s own
`--kui-control-h` sizing, so they match every other icon toggle in the app. `SearchBox.vue`'s
`search-select`/`search-focus-grid` emits reroute from `AppToolbar` straight to `App.vue`
(`AppToolbar.vue:94-100`'s two forwarding emits are deleted).

**9c — toggle + persistence.** `App.vue` owns `const searchOpen = ref(false)`;
`PersistedViewState` goes **v5 → v6** with a `searchOpen: boolean` field (`viewState.ts:37-56`,
`:88-109`, `App.vue:907-922`, `:938-980`, `:1000-1049`). A version bump discards the old blob whole
(`viewState.ts:111-121`), which is the documented, intended behaviour.

* Opening focuses the field on the next tick (`KuiSearchInput`'s exposed `focus()`).
* Closing clears the query via `SearchState.clear()` — a hidden box holding a live query that still
  highlights rows would be a ghost.
* `SearchBox.vue`'s existing global `/` and `Ctrl/Cmd+F` handler (`:238-245`) moves up to `App.vue`
  (it must fire when the row is *closed*, and the component is then unmounted). Semantics:
  `/` and `Ctrl/Cmd+F` **open and focus**; pressing `Ctrl/Cmd+F` while the row is open *and*
  focused **closes** it; `Escape`'s second stage (`SearchBox.vue:195-200`) now closes the row as
  well as clearing, then hands focus back to the grid.
* **New VS Code keybinding** for discoverability, following the manifest's one convention:

  ```json
  { "command": "kiraVersion.toggleSearch", "key": "ctrl+alt+f", "mac": "cmd+alt+f",
    "when": "focusedView == 'kiraVersion.graph'" }
  ```

  with `{ command: 'kiraVersion.toggleSearch', title: 'Toggle Search' }` in `OTHER_COMMANDS`
  (`commands.ts:221-…`) and `contributes.commands`, registered in `extension.ts:444-469`'s
  `otherCommandHandlers` as `() => graphProvider.runUiAction('toggleSearch')`, and a new
  `'toggleSearch'` member of `UiActionKind` (`contract.ts:1399-1410`) handled in `App.vue`'s
  `runUiAction` (`:751-850`). Conflict-checked in F10.

### D10 — Item 2: the graph auto-refreshes, near-instantly, without moving the user

**Where.** `GraphViewState` owns its own `repo.changed` subscription — the ninth instance of the
pattern `RefsState`/`StashState`/`WorktreeState`/`StackState`/`PrState`/`SearchState`/`OpsState`/
`ReviewSessionState`/`ReviewCommentsState` already follow, rather than a bespoke watcher in
`App.vue`.

```ts
// graphView.ts — new
/** G-UX item 2: the graph is the last piece of state that did not follow the watcher (see this
 *  chapter's own ux-fixes plan, F3). RefreshButton.vue's badge stays — as the *backup* for the
 *  cases below that deliberately do not auto-refresh, not as the primary mechanism. */
const AUTO_REFRESH_COALESCE_MS = 250;  // on top of the server's own 200ms leading-window debounce
const AUTO_REFRESH_MIN_GAP_MS  = 1000; // a `git fetch --prune` storm must not re-walk continuously

readonly autoRefreshing: ShallowRef<boolean> = shallowRef(false);
```

Rules:

1. `kind !== 'refsChanged'` → ignore. `worktreeChanged` (an index write) cannot change committed
   history; `OpsState` (`ops.ts:271-274`) already consumes both kinds for status.
2. `event.repoId !== this.#repoId` → ignore (the standard guard).
3. Coalesce arrivals in a 250 ms window, then run.
4. If `loading.value !== 'idle'` when the timer fires (a `loadMore`/`loadAll`/`revealSha`/manual
   refresh is running), **set a pending flag and re-arm** rather than dropping the signal — this is
   the difference between "usually refreshes" and "always refreshes", and it is the failure mode the
   user is describing.
5. Enforce `AUTO_REFRESH_MIN_GAP_MS` since the last auto-refresh *completed*.
6. Reuse `refresh()` (`graphView.ts:231-235`) with `autoRefreshing` set for its duration.

**Why reuse `refresh()`** even though `conn.go:382-398` has *already* marked the walk stale, making
the `graph.refresh` request nominally redundant: `MarkRefresh` (`gitrpc/graph.go:180`) and
`MarkStale` are not the same guarantee, and a second, subtly-different refresh path is exactly the
kind of divergence a review round exists to find. One extra ~1 ms request is the right price.

**Not moving the user** — the concern `RefreshButton.vue:9-12` raised, addressed rather than
inherited:

* `CommitGrid.vue` exposes `scrollToTopRow(row)` alongside `scrollToRow`/`focusGrid`
  (`:780-804`), wrapping SlickGrid's `scrollRowToTop(row)`.
* `App.vue`'s existing `graphView.loading` watch (`:726-742`) captures `grid.getViewport().top`
  when `loading` becomes `'refreshing'` **and** `autoRefreshing` is true, and calls
  `scrollToTopRow(captured)` when it returns to `'idle'`. It runs *after* the
  `pendingSelectionSha` re-resolution (`App.vue:245-252`), so on a background refresh the user's
  viewport wins over the selection's `scrollRowIntoView`. A **manual** refresh keeps today's
  behaviour untouched.
* Focus is safe by construction: `applyAccessibility` only re-focuses when `pendingFocusRow` or
  `focusedRowIndex` is set (`CommitGrid.vue:569-575`), neither of which an auto-refresh touches.

**Announcements and the badge:**

* `App.vue:739-741`'s `composeRefreshAnnouncement` is gated on `!autoRefreshing` — a background
  refresh must not speak on every commit.
* `RefreshButton.vue` clears `hasPendingChange` whenever `graphView.loading` leaves `'refreshing'`
  (not only inside `doRefresh`), so the dot appears only when auto-refresh genuinely did not run —
  which is precisely the user's "the refresh button exists only as a backup in case something was
  missed". Its tooltip copy is unchanged.

**Rejected:** a `loadedRows`-based cap that falls back to badge-only above N rows. It trades the
user's stated requirement ("near-instant, fully automatic") for a hypothetical cost that the manual
Refresh button already pays today at the same magnitude, on demand. Listed in §9 in case a review
round disagrees.

---

## 3. Contract and Go impact — stated item by item

| Item | Contract? | Go? |
|---|---|---|
| 1 — columns hide, one-click detail | No | No |
| 2 — auto-refresh | **No** — `repo.changed`/`graph.refresh`/`graph.stream` all exist and are already emitted, forwarded and served; the client simply never subscribed | **No** |
| 3 — seti icons | No | No |
| 4 — remove folder picking | **Yes** — `repo.pick` is *removed* from `Contract['requests']` | **One constant + its comment block** (`gitrpc/contract.go:107`). `grep -rn "repo.pick" apps/kira-studio/` returns nothing: the Go server never served it |
| 5 — "Open in graph" | No | No |
| 6 — status letter size | No | No |
| 7 — commit-detail redesign | No — `body`/`trailers`/`parents` are all already on the wire (`porcelain/show.go:45-60`); this is purely what the webview renders | No |
| 8 — date-format setting | **No** — the value already lives in `PersistedViewState`, not in `RepoSettingsSnapshot`; no schema key is added (see D8's rejected alternative) | No |
| 9 — search row + shortcut | **Yes** — one new `UiActionKind` member, `'toggleSearch'` | **Same one constant** |

**`CONTRACT_VERSION` 30 → 31**, once, for items 4 and 9 together:

* `packages/git-ipc/src/validate.ts:97` + its comment block (the file's own convention: every bump
  documents exactly what moved).
* `apps/kira-studio/internal/gitrpc/contract.go:107` + its mirrored comment block.

Nothing else in Go changes. `packages/git-core/src/settings/schema.ts` is **not** touched (no new
setting key). `MUTATING_COMMANDS` (`commands.ts:62-…`) is **not** touched — `toggleSearch` is not a
repository mutation, so it belongs in `OTHER_COMMANDS` (`:221`) exactly as `kiraVersion.refresh`
does; the `Record<MutatingAction, MutatingEntry>` totality guard is unaffected. `commands.test.ts`'s
both-directions cross-check against `package.json#contributes.commands` **will** fail until the new
command is added to both lists — that is the guard working as designed.

`PersistedViewState` **5 → 6** (`viewState.ts:38`, `:92`) for `searchOpen` — client-side only, no
wire impact; a stale v5 blob is discarded whole, per that file's documented policy.

---

## 4. File-by-file changes

### `packages/git-ui`

| File | Change | Items |
|---|---|---|
| `src/components/CommitGrid.vue` | `detailOpen` prop; 2-column compact build; message reflow; hide resize handles when compact; `handleClick` → open-on-first-click + new `openDetail` emit; delete `toggleDateFormat`/`update:dateFormat`/`dateFormatRef`/`DATE_COLUMN_ID`; `props.dateFormat` watcher; `cursor: pointer` on `.slick-row`, removed from `.kv-cell-date`; expose `scrollToTopRow` | 1, 2, 8 |
| `src/components/columns.ts` | `buildColumns(..., { compact })` returns 2 or 4 columns | 1 |
| `src/state/graphView.ts` | `repo.changed`/`refsChanged` subscription; coalesce + re-arm + min-gap; `autoRefreshing` ref; unsubscribe in `dispose()` | 2 |
| `src/components/RefreshButton.vue` | clear `hasPendingChange` on any completed refresh | 2 |
| `src/icons/setiFileIcon.ts` | **new** — `themeIcons` palette, basename lookup, memoised data-URL masks | 3 |
| `src/components/FileTree.vue` | seti mask icon replaces the codicon; `.kv-file-tree-icon` box; `.kv-file-tree-status` scale | 3, 6 |
| `src/components/fileTreeModel.ts` | delete `fileIconFor` + its 11 extension tables (`:290-423`) | 3 |
| `src/components/fileTreeModel.test.ts` | drop the `fileIconFor` cases | 3 |
| `src/components/RepoPicker.vue` | delete `Open Folder…` row + `openFolder()` + separator rule | 4 |
| `src/components/NoRepositoryPanel.vue` | delete `Open Folder…` + `openFolder()`; new workspace-scoped copy | 4 |
| `src/state/repo.ts` | delete `pick()` | 4 |
| `src/components/review/ReviewCommitRow.vue` | drop `@click.stop` on the anchor; `.kv-review-row-actions` guard in `onRowClick`; drop `openAllChanges`'s `stopPropagation` | 5 |
| `src/components/CommitMeta.vue` | trailers + author/committer move inside `v-if="bodyExpanded"`; delete SHA row/`copyFullSha`/`shaCopied`/`shortSha`; delete parents row/`parentRows`/`selectParentCommit` emit; `v-if` the whole details section; clamp 4→2 lines; tighter padding; delete the orphaned CSS | 7 |
| `src/components/DetailPane.vue` | drop `selectParentCommit` plumbing; `.kv-detail-pane-meta`/`--expanded`/`-details`/`-tree` flex + max-height rules | 7 |
| `src/components/SearchBox.vue` | `KuiSearchInput` replaces the raw input + `.kv-search-box` shell; delete the bespoke shell/toggle CSS; global `/`+`Ctrl/Cmd+F` handler moves to `App.vue`; `Escape` stage 2 also closes the row | 9 |
| `src/components/AppToolbar.vue` | remove `<SearchBox>` and its two forwarding emits | 9 |
| `src/state/viewState.ts` | v5 → v6 + `searchOpen` (interface, shape guard, doc comment) | 9 |
| `src/components/dialogs/RepoSettingsDialog.vue` | new **Display** section: date-format `KuiSelect` + scope note, via prop/emit (not the `draft`/`patch` diff) | 8 |
| `src/App.vue` | `:detail-open` on the grid; `openDetail` handler; drop `@update:date-format`; `searchOpen` ref + persistence + shortcut handler + the search row in both branches; auto-refresh viewport capture/restore; gate the refresh announcement on `!autoRefreshing`; delete `selectCommitFromDetail`; bind `dateFormat` into the settings dialog | 1, 2, 7, 8, 9 |
| `package.json` | `+ seti-icons` | 3 |

### `packages/kira-ui`

| File | Change | Items |
|---|---|---|
| `src/KuiSearchInput.vue` | optional ARIA passthrough props + `keydown` forward onto the real `<input>` | 9 |

### `apps/kira-studio-vscode`

| File | Change | Items |
|---|---|---|
| `src/proxyHandlers.ts` | delete the `repo.pick` handler and the `dialogs` dep | 4 |
| `src/proxyHandlers.test.ts` | drop the two `dialogs: {} as any` fixtures | 4 |
| `src/ports/dialogs.ts` | **delete** | 4 |
| `src/extension.ts` | delete `VsCodeDialogs` construction/threading; `openRepository` → quick-pick over workspace folders / information message; register `kiraVersion.toggleSearch` | 4, 9 |
| `src/commands.ts` | `OTHER_COMMANDS` += `kiraVersion.toggleSearch` | 9 |
| `package.json` | `contributes.commands` += Toggle Search; `contributes.keybindings` += `ctrl+alt+f`/`cmd+alt+f` scoped `focusedView == 'kiraVersion.graph'` | 9 |
| `tests/interaction/support/commitMetaHarness.entry.ts` | fixture gains trailers + a distinct author | 7 |
| `tests/interaction/commit-meta-clamp.spec.ts` | + trailer-hidden-while-collapsed case | 7 |
| `tests/interaction/graph-columns.spec.ts` | + compact-column case; + one-click-opens case; + pointer-cursor case | 1 |
| `tests/interaction/review-interaction.spec.ts` | + "Open in graph" click reaches a document listener and does not toggle the row | 5 |
| `tests/interaction/file-tree-open.spec.ts` | + seti mask/colour case; + status-letter size case | 3, 6 |

### `packages/git-ipc` / `packages/git-core` / Go

| File | Change | Items |
|---|---|---|
| `git-ipc/src/contract.ts` | delete `'repo.pick'`; `UiActionKind` += `'toggleSearch'` | 4, 9 |
| `git-ipc/src/validate.ts` | delete `REQUEST_KEY_MAP['repo.pick']`; `CONTRACT_VERSION` 30 → 31 + comment block | 4, 9 |
| `git-ipc/src/rpc.test.ts` | drop the `'repo.pick': notImplemented` entry | 4 |
| `git-core/src/ports/dialogs.ts` | **delete** | 4 |
| `git-core/src/ports/index.ts`, `src/index.ts` | drop the `Dialogs`/`PickFolderOptions` re-exports | 4 |
| `git-core/src/ports/testFakes.ts` | delete `FakeDialogs` | 4 |
| `apps/kira-studio/internal/gitrpc/contract.go` | `ContractVersion` 30 → 31 + comment block. **The only Go edit in this plan.** | 4, 9 |
| `NOTICES.md` | `## seti-icons / seti-ui` (MIT ×2) | 3 |

---

## 5. Implementation order

One sequential Sonnet subagent; each step is its own conventional commit. Ordered so the two
structural/wire changes land first and nothing downstream has to be re-touched.

1. **`fix(vscode): remove every folder-picking path but the workspace switcher`** — item 4, all
   layers except the version constants.
2. **`feat(ipc)!: CONTRACT_VERSION 30 -> 31 — drop repo.pick, add the toggleSearch ui action`** —
   both constants + both comment blocks, in one commit so the two sides can never be seen apart.
3. **`fix(git-ui): the commit graph follows the watcher`** — item 2 (`graphView.ts`,
   `RefreshButton.vue`, `App.vue`'s capture/restore + announcement gate, `CommitGrid.scrollToTopRow`).
4. **`fix(git-ui): one click opens the commit detail, and the row says it is clickable`** — item 1b
   + the cursor.
5. **`feat(git-ui): the author and date columns yield to the message when the detail pane is open`** —
   item 1a.
6. **`refactor(git-ui): the relative/absolute date toggle becomes a Display setting`** — item 8
   (depends on 4/5 having removed the cell-click plumbing).
7. **`feat(git-ui): real vs-seti file icons in both file trees`** — item 3 (+ `NOTICES.md`).
8. **`fix(git-ui): shrink the file status letter to the tree's secondary scale`** — item 6.
9. **`fix(git-ui): Open in graph reaches VS Code again`** — item 5.
10. **`feat(git-ui): the commit detail panel is subject and files`** — item 7.
11. **`feat(git-ui): the search row moves below the toolbar and reuses KuiSearchInput`** — item 9
    (depends on 2 for `toggleSearch`).
12. **`test(vscode): interaction coverage for the nine ux fixes`** — the spec/fixture changes, run
    once at the end per `CLAUDE.md`'s "implement the whole plan first, then test once".

Per-commit fast checks: `bun run lint`, `bun run typecheck`. Once, at step 12:
`bun run test:unit`, `bun run test:webview`, `go test ./...` (step 2's constant only).

---

## 6. Exit criteria

### Tier 1 — mechanical (`bun run lint` / `typecheck` / `test:unit` / `go test`)

- [ ] `grep -rn "repo.pick\|pickFolder\|Open Folder" packages apps --include=*.ts --include=*.vue --include=*.json` returns **nothing** outside this plan file. *(4)*
- [ ] `grep -rn "Dialogs" packages/git-core/src apps/kira-studio-vscode/src` returns nothing. *(4)*
- [ ] `validate.ts:CONTRACT_VERSION === 31` and `gitrpc/contract.go:ContractVersion == 31`. *(4, 9)*
- [ ] `commands.test.ts` passes — `kiraVersion.toggleSearch` is in `OTHER_COMMANDS` **and**
      `contributes.commands`. *(9)*
- [ ] `MUTATING_COMMANDS` compiles unchanged (32 entries, one per `MutatingAction`). *(all)*
- [ ] `fileTreeModel.test.ts` passes with the `fileIconFor` cases removed; no other case regresses. *(3)*
- [ ] `parsePersistedViewState` accepts a v6 blob with `searchOpen` and rejects a v5 blob. *(9)*
- [ ] `grep -rn "selectParentCommit" packages` returns nothing. *(7)*
- [ ] `NOTICES.md` names `seti-icons` and `seti-ui`, both MIT. *(3)*
- [ ] No new dependency has a non-commercial tier or a paid-tier-gated feature (`seti-icons` MIT,
      pure data). *(3)*

### Tier 2 — Playwright (`bun run test:webview`)

- [ ] `graph-columns.spec.ts`: with the detail pane open, `.slick-header-column` count is **2** and
      the ids are `{graph, message}`; with it closed, **4**. *(1a)*
- [ ] `graph-columns.spec.ts`: with the pane open, the `.kv-cell-message` `.slick-cell` is at least
      `author + date` px wider than with it closed. *(1a)*
- [ ] `graph-columns.spec.ts`: **one** click on `.slick-row[data-row="0"]` makes
      `[data-testid="detail-region"]` visible. *(1b)*
- [ ] `graph-columns.spec.ts`: `getComputedStyle(row).cursor === 'pointer'` for a `.slick-row`, and
      the date cell is no longer `pointer`. *(1b, 8)*
- [ ] `graph-columns.spec.ts`: clicking the date cell does **not** change the rendered date text. *(8)*
- [ ] `commit-meta-clamp.spec.ts`, with the fixture given a `Co-authored-by` trailer: while
      collapsed, `.kv-meta-trailers` is **not** in the DOM; after "Show more", it is, and so is the
      author line. *(7a, 7b)*
- [ ] `commit-meta-clamp.spec.ts`: `.kv-meta-sha`, `.kv-meta-parents` and `.kv-meta-parent` are
      absent from the DOM entirely. *(7b)*
- [ ] A new `detail-pane-proportion` case: in a 480 px-tall pane, with a 1-line subject, a 2-line
      body, no refs/signature/PR, `.kv-detail-pane-tree`'s height ÷ `.kv-detail-pane`'s height is
      **≥ 0.75** collapsed. *(7c)*
- [ ] `review-interaction.spec.ts`: a `document`-level click listener installed via
      `page.evaluate` **does** receive the click on `a[aria-label="Open in graph"]`, and the row's
      `aria-expanded` is unchanged by it. *(5)* — this reproduces F6's exact mechanism without VS Code.
- [ ] `file-tree-open.spec.ts`: two rows with different extensions (e.g. `.ts` and `.md`) have
      **different** `mask-image` values and **different** `background-color` values. *(3)*
- [ ] `file-tree-open.spec.ts`: `.kv-file-tree-status`'s computed `font-size` is strictly less than
      the row's own. *(6)*
- [ ] A new `graph-auto-refresh` case, over an extended `fakeGraphHost.ts` that can emit
      `repo.changed`: emitting `{kind:'refsChanged'}` for the open repo causes a `graph.refresh`
      request within 1 s, with no click; emitting `{kind:'worktreeChanged'}` causes none; emitting
      for a different `repoId` causes none. *(2)*
- [ ] Same case: after the auto-refresh settles, `.slick-viewport`'s `scrollTop` is within one row
      height of its pre-refresh value. *(2)*
- [ ] `webview-layout.spec.ts` still passes with the new search row present and absent (the height
      chain must not regress). *(9)*

### Tier 3 — needs a human to click through it

These are visual/interactive and cannot be honestly asserted from a headless run.

- [ ] **(1a)** Open the pane on a real repo: the subject column visibly widens and long subjects
      stop truncating; closing it restores the author/date columns at their dragged widths.
- [ ] **(1b)** The cursor is an arrow over every row, and a single click opens the detail. Clicking
      the same row again closes it; clicking a *different* row keeps it open.
- [ ] **(2)** With the panel open: `git commit`, `git checkout -b`, `git fetch` and a `git rebase`
      from an external terminal each make the graph update **within about a second, with no click**.
      The refresh-button dot does **not** stay lit afterwards. A `git fetch --prune` on a busy
      remote does not make the list flicker continuously.
- [ ] **(2)** Scrolled ~500 rows deep, an external commit updates the list **without** jumping the
      viewport to the top.
- [ ] **(3)** In both panels: `.ts`, `.go`, `.vue`, `.json`, `.md`, `.css`, `Dockerfile`,
      `package.json`, `.gitignore` each show a distinct, correctly-coloured seti icon; an unknown
      extension shows the default icon in a colour that is legible on **both** a light and a dark
      VS Code theme.
- [ ] **(4)** There is no way to reach a native folder dialog: not from the toolbar dropdown, not
      from the no-repository panel, not from the command palette. The toolbar dropdown still lists
      and switches between every folder of a multi-root workspace.
- [ ] **(5)** "Open in graph" on a review row focuses the graph panel and selects that commit — both
      when the graph panel is already open and when it is closed (the cold `#pendingUiAction` arm).
- [ ] **(6)** The A/M/D letters read as secondary metadata beside the filename, not as headings.
- [ ] **(7)** With a commit carrying `Co-Authored-By:` and `Claude-Session:`: neither is visible
      until "Show more"; the file tree occupies roughly four fifths of the pane; the sha and parent
      rows are gone; the author appears under "Show more".
- [ ] **(8)** The date format is changed from the settings dialog, survives a panel hide/reveal, and
      clicking a date cell does nothing.
- [ ] **(9)** `Ctrl/Cmd+F`, `/`, and `Ctrl/Alt+F` each open the search row below the toolbar; it is
      visually indistinguishable from the file-tree filter and the branch-picker filter; `Escape`
      closes it and returns focus to the grid; the open/closed state survives a hide/reveal.

---

## 7. Non-goals

* **Kira Studio visual language for the toolbar and context menus.** The user has explicitly named
  and explicitly **deferred** a later phase: *"Components should look like in Kira Studio — the main
  toolbar, the right click [menu], as it now has different proportions and design and everything is
  off."* This plan does **not** address it, does not investigate it, and does not design for it.
  Handed forward as its own phase. The only adjacent thing done here is item 9's reuse of
  `KuiSearchInput` for one control, which is a *correctness* fix (an input that should already have
  been the shared component and was not) rather than a restyling.
  **One note for whoever writes that phase:** `.kv-toolbar` (`AppToolbar.vue:400-409`) and
  `.kv-skin-kira` (`kira-structure.css:14-77`) are two coexisting density scales by deliberate
  design (G12 D14 / G21 D11) — the toolbar is on `density.css`'s workbench scale, the file trees on
  Kira's. Unifying them is exactly the deferred phase's job, and doing it piecemeal here would make
  that phase harder, not easier.
* **`docs/v1.3/SPEC.md`.** Not edited. This is a defect batch, not a phase.
* **New settings keys.** No `RepoSettingsSnapshot` member, no `contributes.configuration` entry, no
  Go schema/storage change (D8).
* **Folder-icon theming.** `vs-seti` ships none; the chevron stays (D3).
* **Review-panel search.** Item 9 is the graph panel's search; `ReviewView.vue`'s own filter already
  uses `KuiSearchInput` (`ReviewView.vue:667`) and is untouched.
* **The stash detail pane.** `StashDetailPane.vue` shares `FileTree.vue`, so items 3 and 6 reach it
  for free; item 7's layout is `DetailPane.vue`-specific and is not ported to it in this batch.
* **Server-side watcher tuning.** The 200 ms leading-window debounce (`watcher.go:25`) and the
  `classify` table are correct as shipped (F3); item 2 is entirely a client-side subscription.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Auto-refresh reintroduces the "list pulled out from under a scrolling user" that P4 refused | Viewport capture/restore via `scrollRowToTop`, background-only; manual refresh unchanged; Tier-2 scroll assertion + Tier-3 deep-scroll check (D10) |
| `seti-icons` is at `0.0.4` and lightly maintained | It is pure data (1.7 KB of code); pinned; the fallback path is seti's own `default` icon; `seti-ui` and VS Code's own `theme-seti` remain drop-in re-derivation sources if it ever goes stale |
| The 144 KB icon payload cannot be code-split under this CSP | Accepted deliberately and documented at the import site — `script-src 'nonce-…'` without `'strict-dynamic'` blocks dynamic `import()`; the cost is a few ms of parse against a ≤300 ms budget |
| One click opening the pane surprises a user who only wanted to select | The pane is where the row's detail belongs, the same row-click model VS Code's own SCM view uses; a second click on the same row closes it and `Esc` still closes |
| Removing `repo.pick` breaks a host we did not check | `HostKind` is `'vscode' | 'harness'` (`contract.ts:16`); the harness fixtures (`fakeGraphHost.ts`, `fakeReviewHost.ts`) never answer `repo.pick` at all, and `grep` confirms the Go server never served it |
| D5's diagnosis is right about the fix but wrong about the mechanism | The `.kv-review-row-actions` guard is required for correctness either way; the Tier-2 test asserts the *observable* property (the click reaches an ancestor listener), which is the necessary condition for VS Code's interceptor regardless of where exactly it is bound |

---

## 9. Human-eye decisions

Each carries my explicit recommendation. Per this task's own terms the implementer takes the
recommendation without further input — but the plan itself is reviewed first, so these are the
places to push back.

1. **Clicking the already-selected row still closes the pane.** Item 1b asks for one click to
   *open*; it does not say what a second click should do. **Recommendation: keep the toggle.** It is
   §6.4's documented model, it is the only mouse-only way to close the pane, and `Esc` and the
   narrow-breakpoint drawer both already agree with it.

2. **Auto-refresh has no row-count cap.** A user with 50 000 rows loaded pays a full re-walk per
   external ref change (coalesced, minimum 1 s apart). **Recommendation: ship without a cap.** It is
   the same work the Refresh button already does on demand, and a cap silently reintroduces exactly
   the "sometimes automatic" behaviour the user is complaining about. If a review round measures a
   real problem, the constants are named and one-line tunable.

3. **The seti `white` (default/unknown) colour resolves to `var(--kv-description-fg)`, not
   `#d4d7d6`.** VS Code's own `vs-seti` needs a light-theme override for the same reason.
   **Recommendation: use the theme token.** Every other seti colour is a saturated hue that reads on
   both themes and stays a literal, faithful to `vs-seti`.

4. **`ignore` maps to `grey-light` (`#6d8086`).** `seti-icons`' `Color` union includes `ignore`;
   `seti-ui`'s `ui-variables.less` does not define it. **Recommendation: `#6d8086`** — the dimmed
   look ignored files are meant to have. Verify against the shipped `definitions.json` at
   implementation time; if `ignore` never actually occurs in it, drop the entry.

5. **`Ctrl/Alt+F` (`Cmd+Alt+F`) is the new keybinding.** Conflict analysis is in F10.
   **Recommendation: ship it**, keeping `/` and `Ctrl/Cmd+F` as the in-webview gestures. If the
   review disagrees, the manifest entry is the disposable half — the in-webview shortcuts already
   satisfy the requirement on their own.

6. **The date-format setting is view-scoped, not repo-scoped, and lives in a repo-scoped dialog.**
   Argued at length in D8. **Recommendation: prop/emit + a visible scope note**, reusing the
   `log.level` precedent. The alternative is a `CONTRACT_VERSION` bump plus Go schema work to store
   a display preference per repository, which is the wrong scope for the value.

7. **`Author`/`Committer` go behind "Show more" rather than staying visible.** The user said "move
   up into the collapsible commit-description section", which reads as inside the collapsible part.
   **Recommendation: inside** — that is what makes the 80 % target reachable. If it should instead
   be a persistently-visible line under the subject, that is a one-line move of the `v-if`.

8. **The commit sha loses its dedicated copy button; the row context menu's `copySha` is the only
   path left.** Item 7 says the sha row is "removed entirely", and G19 D7 already set this exact
   precedent for the review row. **Recommendation: remove it.** If a copy affordance must survive,
   the cheapest home is the subject row's existing copy button
   (`CommitMeta.vue:258-264`) growing a second, sha-copying sibling.

9. **The collapsed body clamp tightens from 4 lines to 2.** This is the largest single contributor
   to the 80 % target after removing the sha/parent rows. **Recommendation: 2 lines.** A user who
   wants the body has a "Show more" one click away, and the file tree is what item 7 is about.

10. **`repo.pick` is removed from the wire, not just from the UI.** **Recommendation: remove it.**
    Leaving it would leave `Dialogs`, `VsCodeDialogs` and `FakeDialogs` as a port with zero
    consumers, which `CLAUDE.md`'s "left out entirely, not half-implemented" argues against, and it
    would leave a live wire method a future phase could re-surface by accident.
