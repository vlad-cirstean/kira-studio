# P75 — Review tab: navigation, then polish

`docs/v1.8/SPEC.md`'s P75 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `cca00816`, P71-P74 landed); line numbers are from
that tree. `hostHandlers.ts`, `state/tabs.ts`'s preview cohort and `FileTree.vue`'s row menu were
re-read after P74, not from pre-P74 context.

Two halves, in order. **Part A — navigation**: two dead controls in the review commit row. **Part
B — polish**: the comment compose zone, the mark-reviewed control, the reviewed line tint.

Both of SPEC's guesses about Part A are wrong. Neither dead path is a stale reference into a
pre-P72 graph API, and `reviewSession.ts` builds no commit list at all — it is 47 lines of
load/save over the pinned graph tab's own state (`reviewSession.ts:32`-`47`). The real causes are
stated in §1.1 and §2.1, each with the evidence that rules the guess out.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Why "open a commit's diff" does nothing | **Not a stale API.** `ReviewCommitRow.vue`'s "Open all changes" reads its whole action bundle off `props.expansion`, which is `undefined` until the row is expanded — and the "expand first" announcement is itself written `exp?.actions.announce(…)`, so on a collapsed row the guard returns in silence. The row actions are revealed on hover, so the collapsed row is the normal case | §1 |
| Why "reveal a commit in the graph" does nothing | **Not a session-scoped commit list.** The control is `<a href="command:kiraVersion.openCommitInGraph?…">` — VS Code's webview command-URI escape hatch, hard-coded into a component both hosts mount. Nothing outside a VS Code webview handles the `command:` scheme, so in Kira Studio the anchor is inert | §2 |
| Does P74's preview cohort / `promoteTab` / `goToFile` apply to review diffs? | **Already, and with no change needed.** A review diff opens through `editor.openRangeDiff` → `openRepoReviewDiffTab`, which P74 gave the same `previewCohort` pass-through and promote-on-reuse as `openRepoCommitDiffTab` (`repoTabs.ts:145`-`147`); "Open all changes" from a review row reaches `editor.openAllChanges`, which P74 already converted to a cohort (`hostHandlers.ts:289`-`299`). §1 fixes who may *call* it, not what it does | §1.3 |
| Which control is "round" | The codicon **glyph**, not the button box: `circle-large-outline` / `circle-large-filled` / `pass-filled` are three circles (`FileTree.vue:440`-`449`). `.kui-button--icon` is already `--kv-radius-sm` | §4.1 |
| Where to reposition it, "given the go-to-file button already in the same row area" | **There is no go-to-file button.** P74 landed "Go to file" as a row *context-menu* entry (`rowMenuModel.ts:147`, `FileTree.vue:419`-`425`), not an inline control. So the trailing cluster is status letter · counts · changed badge · toggle. The checkbox moves to the row's **leading** edge, which gives it a fixed column instead of one that shifts with the counts' width | §4.3 |
| What the "green reviewed row highlight" is | `kira-review-line-reviewed` — a whole-line background at 10% `--kira-ok` painted over every reviewed range in the review diff editor (`review-decorations.css:35`-`37`). A fully reviewed file stores `[1..lineCount]` (`gitsession/incremental.go:469`-`475`'s `recordRanges`), so every line in the diff goes green and stays | §5 |
| New unit tests | **None.** Nothing here is interacting-rules logic; §8 measures each item against the bar rather than waving past it | §8 |
| One Sonnet pass or a split | One, with a real seam between Part A and Part B | §9.2 |

### 0.1 Which host each item is about

| Item | Kira Studio | VS Code extension |
|---|---|---|
| §1 Open all changes from a collapsed row | yes | yes (same `git-ui` component) |
| §2 Reveal in graph | **yes — the broken host** | works today via the command URI; keeps working through the new request |
| §3 Comment compose zone | **yes — desktop Monaco layer only** | no (VS Code's own Comments API) |
| §4 The mark-reviewed checkbox | yes | yes (same `git-ui` component) |
| §5 Reviewed line tint | yes (`reviewDecorations.ts`) | yes (`reviewMarking.ts`, same rule) |

---

# Part A — navigation

## 1. "Open all changes" on a collapsed row

### 1.1 The dead path, exactly

`ReviewCommitRow.vue:122`-`130`:

```ts
async function openAllChanges(): Promise<void> {
  const exp = props.expansion;
  const files = exp?.detail.detail.value?.files;
  if (!exp || !files) {
    exp?.actions.announce('Expand the commit first.');
    return;
  }
```

`props.expansion` is `review.expansionFor(sha)` (`ReviewView.vue:902`), and
`ReviewSessionState.expansionFor` reads `#expansions`, which only `expand()` ever writes
(`review.ts:265`-`270`). A row that has never been expanded therefore has `expansion === undefined`
— and the announcement meant to explain that is optional-chained through the very binding that is
undefined, so it never runs. Click the `diff-multiple` button on a collapsed row: no tabs, no
announcement, no error. Nothing.

The row header's own click does not fire either — `onRowClick` returns early for anything inside
`.kv-review-row-actions` (`:65`-`69`), correctly. So the click is fully absorbed.

Two facts rule out SPEC's "stale pre-P72 API" guess:

- The call chain is intact end to end. `actions.openAllChanges` → `editor.openAllChanges` →
  `hostHandlers.ts:267`-`301` (desktop) / `proxyHandlers.ts:380`-`395` (extension). Both fetch
  `commit.detail` themselves and open every file. P72 touched neither.
- Expanded, the button works. The defect is reachability, not the action.

`:121`'s own comment claims "an unexpanded row announces why instead of silently doing nothing".
That was the intent; the optional chain is what made it false.

### 1.2 The fix: give the row a bundle that does not depend on expansion

The bundle is per-session, not per-row — `#createRowActions(repoId)` (`review.ts:408`-`437`)
closes over nothing else, so the N bundles one per expanded row are N identical closures.

`ReviewSessionState`:

```ts
/** The row-level action bundle, one per targeted session rather than one per expanded row —
 *  every bundle `#createRowActions` ever built closed over `repoId` and nothing else. Rebuilt by
 *  `setTarget`, cleared by `clearTarget`. */
readonly rowActions: ShallowRef<DetailActions | undefined> = shallowRef(undefined);
```

- `setTarget` sets it (right after `this.repoId.value = repoId`).
- `clearTarget` clears it, beside the fields it already clears (`:172`-`184`).
- `expand()` stops calling `#createRowActions` and stores `rowActions.value` into the
  `ReviewExpansion` instead, so the expanded tree and the row header share one bundle and cannot
  drift.

`ReviewCommitRow.vue` gains an `actions: DetailActions` prop (bound from
`review.rowActions.value`), and `openAllChanges` loses its precondition entirely:

```ts
async function openAllChanges(): Promise<void> {
  try {
    const { opened, failed, mode } = await props.actions.openAllChanges({
      sha: props.sha,
      parentIndex: props.expansion?.detail.parentIndex.value,
    });
    …unchanged announcement…
  } catch (err) { …unchanged… }
}
```

`parentIndex` becomes optional on `DetailActions.openAllChanges` (`detailActions.ts:51`-`54`),
matching the contract, which has had `parentIndex?: number` since G21
(`contract.ts:1858`). Both host handlers already pass it straight through to `commit.detail`,
whose own default is parent 0 — the same parent an unexpanded row would have shown. No new
defaulting logic, and an expanded row still sends whatever merge parent its picker selected.

The announcement now reaches the live region on every outcome, because `announce` goes to
`ReviewSessionState.announcement`, which `ReviewView.vue:642`-`647` already mirrors into
`liveAnnouncement`.

### 1.3 What is deliberately not changed

- **The preview-cohort behaviour.** `editor.openAllChanges` already opens one cohort of preview
  tabs (P74 §5.2); this phase changes who may call it, nothing about what it does.
- **`ReviewExpansion.detail`.** The expanded file tree still needs its own `DetailState`; only the
  actions bundle is hoisted.
- **`FileTree`'s own open-file path** inside an expanded row (`:165`-`176`) — it works.

## 2. "Open in graph"

### 2.1 A VS Code escape hatch in a shared component

`ReviewCommitRow.vue:155`-`159`:

```ts
const openInGraphHref = computed(() => {
  if (!props.repoId) return '#';
  const args = [{ repoId: props.repoId, sha: props.sha }];
  return `command:kiraVersion.openCommitInGraph?${encodeURIComponent(JSON.stringify(args))}`;
});
```

rendered as a real `<a href>` (`:238`-`245`), with `reviewView.ts:71`'s
`enableCommandUris: [OPEN_COMMIT_IN_GRAPH_COMMAND]` as the other half. That is VS Code's own
webview link interceptor, and it exists nowhere else. `RepoReviewView.vue` mounts the same
component into a Wails WebView with `host: 'kira'`, where no `command:` handler exists at any
layer — the click resolves to nothing.

The G14 D10 comment at `:39`-`43` states the trade openly ("D8 makes no RPC/contract change, and a
command URI is not one"). It was true for a VS Code-only feature; C11 put the same component in a
second host and the trade stopped holding.

Again, not SPEC's guess: no pre-P72 symbol is referenced, and the sha the anchor carries is
`props.sha` straight off the packed store — the same identifier `CommitStore.rowOfSha` and
`App.vue`'s `revealAndSelectSha` (`:390`-`400`) expect. The identifier was never the problem; the
transport was.

### 2.2 Both hosts already implement the reveal — only the route is missing

- **Extension**: `diffToolbar.ts:135`-`152`'s `openCommitInGraphCommand` calls
  `graphProvider.runUiAction('revealCommit', {repoId, sha})`, which handles the cold case itself
  (`panelView.ts:94`-`101`: stash the pending action, focus the view, emit when the server exists).
- **Desktop**: `blameAnnotation.ts:90`-`104`'s `revealBlameCommit` does exactly this — emit
  `ui.action`/`revealCommit` on the workspace's local bus, stash only if nothing consumed it, then
  activate the pinned graph tab. Both halves already exist in `hostHandlers.ts:66`-`81`
  (`stashPendingBlameReveal`/`takePendingBlameReveal`) and `transport.ts:136`-`138`
  (`emitUiAction`), and `RepoGraphView.vue:67` consumes the stash on mount.

Either way the receiving end is `App.vue:893`-`894` → `revealCommitInGraph` (`:407`-`416`), which
opens the target repo when it is not the active one and then reveals and selects. Nothing new is
needed there.

So this is a routing gap, and the fix is one contract method both hosts answer locally — exactly
the shape `review.open` already has (`hostHandlers.ts:355`-`365`).

### 2.3 `graph.revealCommit`

1. **Contract** — a new request `graph.revealCommit`,
   `params: { repoId: string; sha: string }`, `result: { revealed: boolean }`. Host-answered in
   both hosts, never reaching Go (`gitstream.go:87` already records that host-answered methods are
   absent from its allowlist by design — this one joins `review.open`/`editor.openRangeDiff`
   there). Add it to `validate.ts`'s `REQUEST_KEY_MAP`.

   `revealed: false` is not a stub: the desktop genuinely cannot reveal when this window has no
   record of the repository, or when its workspace has no pinned graph tab. The caller announces
   that rather than swallowing it.

2. **`git-ui`** — `DetailActions` gains

   ```ts
   /** Reveals and selects `sha` in the graph. Review-row-only today (`ReviewCommitRow.vue`);
    *  implemented in every bundle because `DetailActions` is one interface, the same way
    *  `openPullRequest` is (P74 §3.3). */
   revealInGraph(params: { sha: string }): Promise<{ revealed: boolean }>;
   ```

   implemented in `createDetailActions` (`detailActions.ts`), `ReviewSessionState.#createRowActions`
   and `ReviewView.vue`'s `filesActions` bundle — the same three sites P74 §3.3 touched for
   `openPullRequest`, three lines each.

3. **`ReviewCommitRow.vue`** — the `<a class="kui-button kui-button--icon">` becomes

   ```vue
   <KuiButton
     variant="icon"
     icon="codicon-git-commit"
     v-kui-tooltip="'Open in graph'"
     aria-label="Open in graph"
     @click="revealInGraph"
   />
   ```

   with

   ```ts
   async function revealInGraph(): Promise<void> {
     const { revealed } = await props.actions.revealInGraph({ sha: props.sha });
     if (!revealed) props.actions.announce("Couldn't reveal this commit — no graph is open for this repository.");
   }
   ```

   `onRowClick`'s `.kv-review-row-actions` guard (`:65`-`69`) keeps doing its job unchanged. G-UX
   D5's whole reason for that guard — "one of those actions is a `command:` anchor VS Code's own
   bubble-phase interceptor must be allowed to see" — no longer applies, but the guard is still
   correct for the other button, so it stays; only its comment's second half goes.

   The `repoId` prop (`:39`-`45`) exists solely for `openInGraphHref` and is deleted with it, along
   with `ReviewView.vue:906`'s binding. G34 D15's "this must stay a real `<a href>`" note goes with
   the anchor.

4. **Desktop host** — `hostHandlers.ts` answers `graph.revealCommit` with `revealBlameCommit`'s
   body, moved here (this file already owns the pending-reveal map):

   ```ts
   'graph.revealCommit': async ({ repoId: gitRepoId, sha }) => {
     const codeRepoId = codeRepoIdFor(gitRepoId);
     if (codeRepoId === undefined) return { revealed: false };
     const graphTabId = pinnedGraphTabId(codeRepoId);
     if (!graphTabId) return { revealed: false };
     const target = { repoId: gitRepoId, sha };
     // Emit first, stash only if nothing was listening — Group 6 (P68 review)'s own rule, kept.
     if (!deps.emitLocal('ui.action', { action: 'revealCommit', target })) {
       pendingBlameRevealByCodeRepoId.set(codeRepoId, target);
     }
     activateTab(graphTabId);
     return { revealed: true };
   },
   ```

   `HostHandlersDeps.emitLocal`'s declared return type widens from `void` to `boolean`;
   `transport.ts:147` already passes `local.emit`, which has returned a boolean since P68 (`:61`,
   `:77`-`82`) — only the type discarded it.

   `blameAnnotation.ts`'s `revealBlameCommit` becomes one call on the transport it already holds:

   ```ts
   void deps.transport.request('graph.revealCommit', { repoId: gitRepoId, sha });
   ```

   dropping its `codeRepoIdFor`/`pinnedGraphTabId`/`emitUiAction`/`activateTab` imports. One
   implementation for both callers, per `CLAUDE.md`'s reuse rule — not a second copy of a four-line
   sequence. `stashPendingBlameReveal` loses its last external caller and stops being exported;
   `takePendingBlameReveal` stays (`RepoGraphView.vue` consumes it).

5. **VS Code host** — `proxyHandlers.ts` gains a `revealCommitInGraph: (repoId, sha) => void` dep
   and answers `graph.revealCommit` by calling it and returning `{ revealed: true }`
   (`runUiAction` is total: it reveals the view and queues when no webview is resolved). `deps` is
   a plain function, never a provider instance, for the same reason `revealReview` is
   (`proxyHandlers.ts:101`-`105`: this file never imports `vscode`). `extension.ts:411` wires it to
   `graphProvider.runUiAction('revealCommit', { repoId, sha })`; `graphProvider` is declared at
   `:432`, after the handlers, but the closure only runs once a request arrives, so this needs no
   new `let` break the way `reviewProvider` did (`:391`-`397`).

   `reviewView.ts` drops `OPEN_COMMIT_IN_GRAPH_COMMAND` and `enableCommandUris` entirely — a
   webview privilege removed, not relocated. `kiraVersion.openCommitInGraph` itself stays: it is
   still a real palette/diff-title command (`commands.ts:249`, `package.json:128`/`:325`,
   `extension.ts:278`/`:510`), just no longer reached from a webview anchor.

---

# Part B — polish

## 3. The comment compose zone is unclickable

### 3.1 Root cause: the zone paints under `.view-lines`

`reviewDecorations.ts:156`-`163` mounts `ReviewThread.vue` into a bare `<div>` handed to
`accessor.addZone(…)`. Three facts about the pinned `monaco-editor@0.56.0`, read in
`node_modules`, explain why nothing in it can be clicked:

- `view.js:178`-`179` appends `.view-zones` **before** `.view-lines` in `.lines-content`.
- `viewLines.js:481`-`482` sizes `.view-lines` to the full scroll width and height.
- Neither carries a `z-index` (`viewLines.css` sets only `white-space`), and both are
  `position: absolute`. A later positioned sibling with `z-index: auto` wins the hit test.

So `.view-lines` covers the zone's rectangle and takes every mousedown over it. The zone is
*visible* — `.view-lines` is transparent where there is no glyph — and completely unreachable. That
is the reported "opens something but isn't interactive in any way", precisely.

Monaco itself is not the thief: `mouseHandler.js:239`-`246` shows the `CONTENT_VIEW_ZONE` branch
does nothing at all unless `suppressMouseDown` is set, which this code correctly never sets. The
defect is paint order, not event handling.

Corroboration, not speculation: the only other view zone in this repository is
`showBannerZone`'s error banner (`:182`-`200`), whose **Retry button has the same defect** — C13-9
built a retry nobody has ever been able to click. Two independent interactive zones, both dead, one
cause.

### 3.2 The fix

Both zones' `domNode` get, in `reviewDecorations.ts` where they are created:

```ts
domNode.style.zIndex = '10';
```

`.view-zones` is `position: absolute; z-index: auto`, which creates no stacking context, so a
positioned descendant with an explicit `z-index` is hoisted into `.lines-content`'s own context and
lands above `.view-lines`. `10` is VS Code's own value for the zone widgets it mounts the same way.
One comment states the *why* (the paint order above), since the code cannot say it.

Second, smaller blocker in the same place: `.lines-content` and its descendants carry
`user-select: none` on every engine except Safari/WebKit
(`editorConfiguration.js:178`-`192`'s `no-user-select`, `viewLines.css:36`-`40`), so text inside
the compose textarea cannot be selected even once clicks land. `ReviewThread.vue`'s `.review-thread`
rule gains `user-select: text` — scoped to the thread, never to the editor.

Third: `openZone`'s `heightInPx: 120` is a literal that predates the compose form's final shape (a
3-row textarea plus a button row plus 8px/12px padding). Pass the mode's own height —
`heightInPx: mode === 'compose' ? 148 : 120` is still two literals; instead measure once after
mount and call `accessor.layoutZone(id)`. Concretely: `openZone` takes the mounted app's root
`scrollHeight` after `nextTick` and re-lays the zone out, so a long existing comment scrolls inside
its own box (`.review-thread` is already `overflow: auto`) rather than being clipped by a guess.

### 3.3 What is deliberately not changed

- **`ReviewThread.vue`'s markup, emits and submit rules.** They are correct; nothing could reach
  them. `createApp(Comp, props)` does deliver `onSubmit`/`onCancel`/`onClose`/`onDelete` to the
  root component's `emit`, so no prop plumbing changes.
- **`handleSubmit`/`handleDelete`'s no-explicit-reload rule** (`:479`-`481`, `:495`-`497`) — the
  repaint fan-out already covers this editor (C12-4).
- **The extension's comment surface.** VS Code's Comments API owns it (`reviewComments.ts`), and it
  has no view zone.

## 4. The mark-reviewed control

SPEC lists three asks — square, repositioned, a real indeterminate state — for one control. They
land together: a half-converted checkbox is worse than either end state.

### 4.1 Reuse the checkbox this package already has

`packages/git-ui/src/theme/app-shell.css:50`-`92` already defines a square checkbox for this
package: `appearance: none`, 14px, 3px radius, `--kv-input-border`/`--kv-input-bg` at rest,
`--kv-button-bg` filled when checked, with the codicon check glyph (`\eab2`) as `::after`. P67c D8
built it for the nine dialogs' own `<input type="checkbox">` elements. Reuse it rather than
building a square variant of an icon button: one checkbox appearance across the package, and the
indeterminate state below is then a two-rule addition instead of a new control.

`FileTree.vue:581`-`590` becomes:

```vue
<input
  v-if="reviewStates"
  type="checkbox"
  class="kv-file-tree-review-toggle"
  :checked="reviewStatusFor(row.node.change.path)?.kind === 'full'"
  :indeterminate="reviewStatusFor(row.node.change.path)?.kind === 'partial'"
  v-kui-tooltip="reviewToggleTitle(row.node.change.path)"
  :aria-label="reviewToggleTitle(row.node.change.path)"
  @click.prevent.stop="emit('toggleReviewed', row.node.change.path)"
/>
```

- `.prevent` matters: the server's answer is the only state this control has
  (`ReviewFilesState.mark` applies `result.review` to the list, `reviewFiles.ts:268`-`270`).
  Letting the native toggle run would show an optimistic state for the round trip's duration and
  then contradict it. `.stop` is what the `KuiButton` already carried.
- `indeterminate` is a DOM property with no HTML attribute; Vue sets it as a property because the
  key exists on the element, the same path `:checked` takes.
- A native checkbox reports `aria-checked="mixed"` for the indeterminate state on its own, so the
  partial case gains a correct accessible name/state without an explicit ARIA attribute. The
  `aria-pressed` toggle-button semantics (`:586`) go away with the `KuiButton`.

`reviewToggleIcon` (`:440`-`449`) is deleted. `reviewToggleTitle` (`:450`-`453`) stays exactly as
it is — the click still maps partial to "mark unreviewed" (`ReviewFilesPane.vue:83`-`87`), and this
phase changes no marking semantics.

### 4.2 The indeterminate visual

`app-shell.css`, beside the existing `:checked` rules:

```css
.kv-mount-root input[type="checkbox"]:indeterminate {
  background: var(--kv-button-bg);
  border-color: var(--kv-button-bg);
}
```

and the glyph block at `:71`-`84` gains `:indeterminate::after` as a second selector, with only
`content` differing per state (`\eab2` check, `\eacc` `codicon-dash`). Factor the shared
font/size/inset/color declarations into one rule listing both selectors rather than copying nine
lines.

This is what SPEC asks for by name: a distinct *shape*, not a third colour on a two-state control.
`FileTree.vue:810`-`812`'s `[aria-pressed='true'] { color: var(--kv-diff-added-fg) }` — the green
that made "partial" and "reviewed" differ only by fill and hue — is deleted. Checked now reads as
the same filled box every other checkbox in the package uses.

### 4.3 Placement

The trailing cluster is, in order, status letter (`margin-left: auto`), `+N/-N` counts, the
changed-since-review dot, then the toggle — so the control's horizontal position shifts with the
counts' width, row to row, and sits hard against the pane's scrollbar. SPEC's stated reason for
moving it (a neighbouring go-to-file button) does not exist, but the crowding does.

Move the checkbox to the row's **leading** edge, before the file icon, and give directory rows a
same-width empty slot so the review tree keeps one aligned checkbox column:

```vue
<!-- directory branch, first child -->
<span v-if="reviewStates" class="kv-file-tree-review-slot" aria-hidden="true"></span>
```

```css
/* One checkbox column for the whole review tree: a directory row has nothing to mark, but the
   file rows below it must still line up under a single column. */
.kv-file-tree-review-slot {
  width: 14px;
  flex-shrink: 0;
}
```

`.kv-file-tree-review-toggle` keeps only `flex-shrink: 0`; its 14px box comes from the shared
checkbox rule. The row's existing `gap` applies to it like every other child, and the per-depth
`paddingLeft` (`:515`) still indents the whole row, checkbox included — which is right: the mark
belongs to that row, not to a gutter outside the tree.

Both additions are gated on `reviewStates`, so `DetailPane.vue`'s tree and the stash tree render
byte-identically to today — the same "absent, not disabled" rule `reviewStates` already follows
(`:59`-`63`).

Rejected: keeping it trailing and merely reordering within that cluster. It leaves the column
ragged, which is the actual complaint behind "reposition it".

## 5. The reviewed line tint persists after a full review

### 5.1 What it is

`review.mark(path, true)` with no ranges records a `"full"` file; `recordRanges`
(`gitsession/incremental.go:469`-`475`) expands a full record to `[1..lineCount]`, so
`review.fileDiff`'s `reviewedRanges` covers the whole file. `reviewDecorations.ts:230`-`244` paints
`kira-review-line-reviewed` (`review-decorations.css:35`-`37`, `--kira-ok` at 10%) plus an
overview-ruler mark over every one of them. Result: the moment a file is marked reviewed, the whole
diff turns green and stays green for as long as that mark stands.

The tint earns its keep for a *partial* review — it is the only thing showing which lines are
covered. At full coverage it shows nothing the per-hunk `pass-filled` glyph and the file tree's
checked box do not already say, on every line at once.

### 5.2 The fix

In `paint()`, compute the file-level state from data already in hand and skip the collection when
it is full:

```ts
const fullyReviewed =
  lineCount > 0 && coverage({ start: 1, end: lineCount }, reviewedRanges) === 'full';
reviewedLineCollection.set(fullyReviewed ? [] : normalizeRanges(reviewedRanges).map(…));
```

`coverage` is already imported from `@kira/git-core` (`:19`) and is the same helper the per-hunk
branch uses three lines below, so "fully reviewed" cannot come to mean two different things inside
one function. `lineCount > 0` keeps an empty/binary body (where `lineCount` is 0 and
`reviewedRanges` is empty) out of the "fully reviewed" branch — there is nothing to tint either
way, but the two states should not be conflated.

Per-hunk glyphs, the overview ruler for a partial review, "Mark unreviewed" from a glyph click and
the file-tree checkbox are all unchanged, so nothing becomes unreachable.

### 5.3 The extension carries the same defect

`reviewMarking.ts:305` paints `reviewedType` over `state.reviewedRanges` with no coverage check,
and `MarkingState` already carries `lineCount` (`:84`). The same three-line guard applies, in the
same place, for the same reason. Fixing one host and not the other would leave the two review
surfaces disagreeing about what "reviewed" looks like — the thing `packages/git-ui` exists to
prevent, one layer down.

## 6. Deliberately out of scope

- **Marking semantics.** Partial still toggles to unreviewed on a click (`ReviewFilesPane.vue:83`-
  `87`); SPEC asks for an indeterminate *visual*, not a three-way cycle.
- **Marking a directory reviewed.** The new leading column is a checkbox on file rows and an empty
  slot on directory rows. A directory-level mark is a new feature with its own server semantics.
- **`review.comment.add` from the sidebar.** `ReviewCommentsPane.vue:145` states the design (the
  gutter `+` is the add affordance) and D9 put the gesture in the editor deliberately. §3 makes the
  existing gesture work; it does not add a second one.
- **Per-range marking UI in the webview.** Deleted at G21 D12 with `DiffView.vue`; the editor owns
  it.
- **The `repo-workspace.spec.ts` git mock's missing `graph.stream`/`commit.detail` streaming.** P74
  recorded this gap; closing it is its own piece of work, not a rider on this phase (§8).
- **`reviewComments.ts`'s known cross-file phantom-glyph gap** in the extension (C14-6's own note at
  `reviewDecorations.ts:382`-`386`) — unrelated to any P75 item.
- **The graph's own reveal behaviour.** §2 routes to `App.vue`'s existing `revealCommitInGraph`;
  what that does once it runs is P72's, unchanged.

## 7. Files

Modified:

| File | Change |
|---|---|
| `packages/git-ui/src/components/review/ReviewCommitRow.vue` | `actions` prop; `openAllChanges` loses its expansion precondition (§1.2); the command-URI anchor becomes a `KuiButton` calling `revealInGraph`; `repoId` prop deleted (§2.3) |
| `packages/git-ui/src/components/review/ReviewView.vue` | Binds `:actions="review.rowActions.value"`, drops `:repo-id`; `filesActions` gains `revealInGraph` (§1.2, §2.3) |
| `packages/git-ui/src/state/review.ts` | `rowActions` on `ReviewSessionState`; `expand()` reuses it; `#createRowActions` gains `revealInGraph` (§1.2, §2.3) |
| `packages/git-ui/src/state/detailActions.ts` | `revealInGraph` on `DetailActions` + `createDetailActions`; `openAllChanges`'s `parentIndex` becomes optional (§1.2, §2.3) |
| `packages/git-ui/src/components/FileTree.vue` | The reviewed toggle becomes a real tri-state checkbox at the row's leading edge; `reviewToggleIcon` and the green `aria-pressed` rule deleted; directory-row slot (§4) |
| `packages/git-ui/src/theme/app-shell.css` | `:indeterminate` fill + dash glyph, sharing the existing `::after` block (§4.2) |
| `packages/git-ipc/src/contract.ts`, `validate.ts` | `graph.revealCommit`; `REQUEST_KEY_MAP` entry; `CONTRACT_VERSION` 36 → 37 (§2.3, §9.3) |
| `apps/kira-studio/frontend/src/repo/git/hostHandlers.ts` | Answers `graph.revealCommit`; `emitLocal` typed `boolean`; `stashPendingBlameReveal` no longer exported (§2.3) |
| `apps/kira-studio/frontend/src/views/repo/blameAnnotation.ts` | `revealBlameCommit` becomes one `graph.revealCommit` request (§2.3) |
| `apps/kira-studio/frontend/src/views/repo/reviewDecorations.ts` | Zone `z-index` and height measurement; the fully-reviewed tint guard (§3.2, §5.2) |
| `apps/kira-studio/frontend/src/views/repo/ReviewThread.vue` | `user-select: text` on the thread root (§3.2) |
| `apps/kira-studio-vscode/src/proxyHandlers.ts` | `revealCommitInGraph` dep; answers `graph.revealCommit` (§2.3) |
| `apps/kira-studio-vscode/src/extension.ts` | Wires that dep to `graphProvider.runUiAction` (§2.3) |
| `apps/kira-studio-vscode/src/reviewView.ts` | `enableCommandUris` and `OPEN_COMMIT_IN_GRAPH_COMMAND` deleted (§2.3) |
| `apps/kira-studio-vscode/src/reviewMarking.ts` | The same fully-reviewed tint guard (§5.3) |
| `apps/kira-studio/internal/gitrpc/contract.go`, `stash_test.go` | `ContractVersion` 36 → 37; `TestContractVersion_Is36` → `Is37` (§9.3) |
| `packages/git-ipc/testdata/graphChunkFrame.{bin,json}` | Regenerated for the version bump (§9.3) |

Added: none. Deleted: none. No new dependency — codicon and the checkbox chrome are already in
`packages/git-ui`; `coverage` is already imported by both files that need it.

## 8. Tests

`CLAUDE.md`'s default is no dedicated unit test, and **this phase earns none**. Each item measured
against the bar rather than waved past it:

- **§1's guard removal** — deleting a precondition and passing an optional through. Nothing to get
  wrong that a type error would not catch.
- **§2's routing** — a request key, two handlers, three one-line bundle entries. No decision
  structure.
- **§3's z-index / §5's tint guard** — one CSS property and one `coverage` call into
  `@kira/git-core`, whose own range arithmetic is already tested there. Re-testing `coverage`
  through a caller would be the "restates a short function body" case the bar names.
- **§4's tri-state** — a three-way enum to two booleans. Exactly the "one/two-condition" shape the
  bar excludes.

**Existing specs extended**, no new spec file:

| Spec | Assertion |
|---|---|
| `apps/kira-studio-vscode/tests/interaction/review-interaction.spec.ts` | "Open all changes" on a **collapsed** row sends `editor.openAllChanges` and writes to `[data-testid="live-announcements"]` (§1); "Open in graph" sends `graph.revealCommit` with that row's sha (§2) |
| same file, plus `support/fakeReviewHost.ts` | The Files pane's reviewed control is an `input[type="checkbox"]`, `indeterminate` for a `partial` entry and `checked` for a `full` one (§4) |

`fakeReviewHost.ts` today answers five methods (`:66`-`72`: `app.init`, `review.resolveBase`,
`graph.stream`, `commit.detail`, `editor.openDiff`). The checkbox assertions need a sixth,
`review.files`, returning three entries with `review.kind` of `none`/`partial`/`full` — additive,
in the fixture's own existing "hand-written literal responses" style, not a general mock layer. The
two Part A assertions need only a record of which method was requested, which the fixture's own
dispatcher already sees.

**Not covered by any harness, stated rather than invented:** §3 and §5's desktop halves live in
`reviewDecorations.ts`, reachable only from a mounted review diff tab.
`apps/kira-studio/tests/ui/repo-workspace.spec.ts`'s `gitStreamMock` answers only
`app.init`/`repo.list`/`refs.list` with no streaming support (P74's own result section records
this), so no review diff can be opened through it, and extending that mock is out of scope (§6).
Both changes are proved by mechanism in §3.1 and §5.1 and verified by hand: open a review diff,
click a gutter `+`, type in the box and submit; mark the file reviewed and confirm the line tint
clears while the hunk glyphs stay.

Fast checks per commit: `bun run typecheck`, `bun run lint`, `bun run build` **and**
`bun run build:vscode` (this phase edits `packages/git-ui/`, so both bundles must build), plus
`go build ./... && go vet ./...` on the contract-version commit.

## 9. Order and sizing

### 9.1 Implementation order

Navigation first — SPEC's own sequencing reason, and a concrete one here: §4 changes the same rows
§1's fix makes reachable, and reviewing a checkbox you cannot get to is not reviewing it.

1. **§1 — Open all changes from a collapsed row.** `review.ts`'s `rowActions` first, then the row.
   → `fix(git-ui): open a commit's changes from a collapsed review row`
2. **§2 — Reveal in graph.** Contract, both hosts, the row and `blameAnnotation.ts` in one commit:
   a contract method with one end wired is a half-applied path, and the blame caller moves onto the
   same request in the same change.
   → `feat(git-ui,workbench): reveal a review commit in the graph from either host`
3. **§3 — The comment zone.** `z-index`, the height measurement, `user-select`.
   → `fix(repo): make the review comment zone reachable above the editor's own lines`
4. **§4 — The reviewed checkbox.** `app-shell.css` first, then `FileTree.vue`'s markup, layout and
   deletions. One commit: shape, placement and the indeterminate state are one control.
   → `feat(git-ui): mark a file reviewed with a square tri-state checkbox`
5. **§5 — The tint.** Both hosts in one commit (§5.3's reason).
   → `fix(repo,git-ui): drop the reviewed line tint once a file is fully reviewed`
6. **Spec assertions** (§8), once the behaviour they describe is in.
   → `test: assert review row actions and the reviewed checkbox's three states`

### 9.2 One pass, one seam

One Sonnet pass. **The seam is between step 2 and step 3**: Part A is the action bundle plus one
contract method across both hosts; Part B is three independent visual fixes that share no file with
it. Steps 3, 4 and 5 may land in any order among themselves. Never split inside step 2 (a contract
method with one end wired) or step 4 (§4's reason).

Size: roughly 16 source files across TypeScript, Vue, CSS and Go. The load-bearing decisions are
two — `graph.revealCommit` replacing a host-specific escape hatch (§2.3), and the session-level
action bundle that makes a collapsed row's actions reachable at all (§1.2). Everything else is
local.

### 9.3 Contract version

Step 2 adds a wire method, so `CONTRACT_VERSION` moves 36 → 37 with a `validate.ts` comment entry in
the shape the ones already there use — and, per P74's own result section, **four things move with
it, not one**:

- `packages/git-ipc/src/validate.ts` — the constant and its comment.
- `apps/kira-studio/internal/gitrpc/contract.go:141` — `const ContractVersion`.
- `apps/kira-studio/internal/gitrpc/stash_test.go:47` — `TestContractVersion_Is36` → `Is37`, that
  file's own established per-bump convention.
- `packages/git-ipc/testdata/graphChunkFrame.{bin,json}` — regenerate with `gitsock`'s
  `TestFixtures_CaptureGraphChunkFrame` under `KIRA_GIT_FIXTURES=write`; the captured envelope
  carries the version.

`internal/bridge/gitstream.go` needs **no** entry: `graph.revealCommit` is host-answered and never
reaches Go's dispatch, exactly like `review.open`/`editor.openRangeDiff`, which that file's own
comment at `:87` already records as deliberately absent. Run
`TestGitrpcDispatch_EveryMethodIsClassified` to confirm rather than assume.

## 10. Dogfooding note

The repo-map MCP server's tools were not reachable for this planning pass: this is a subagent
session, and `CLAUDE.md`'s own step-3 caveat applies — the tool manifest is fixed at session start.
Navigation was done with Grep/Glob/Read instead.

**Nothing new is logged in `docs/v1.8/mcp-repo-map-issues.md`.** This pass never called the server,
so it produced no evidence about it; inventing an entry would be the manufactured finding
`CLAUDE.md` warns against.

One consequence for whoever implements this: §3.1's three Monaco facts were read directly out of
`node_modules/monaco-editor` (`view.js`, `viewLines.js`, `viewLines.css`, `mouseHandler.js`,
`editorConfiguration.js`), not from memory of how view zones behave. Re-read them if the pinned
version moves — the fix depends on paint order, which is an implementation detail of that version,
not a documented API.
