# C11 — Code-review layer ported natively

Last feature phase of v1.5. Ports `packages/git-ui`'s `components/review/` + `state/review*.ts`
into the native workspace C10 established, and builds the one surface that has no portable half:
comment threads and review-marking gutter icons over Monaco.

Sources read for this plan: `internal/gitrpc/{handlers,comments,review}.go`,
`internal/gitsession/{comments,incremental,entry}.go`, `internal/gitreview/*`,
`internal/bridge/gitstream{,_test}.go`, `apps/kira-studio-vscode/src/review{View,Comments,Ranges,Marking}.ts`,
`packages/git-ui/src/{main.ts,index.ts,App.vue,components/review/*,state/review*.ts,components/rowMenuModel.ts}`,
`packages/git-ipc/src/contract.ts`, the native `views/repo/*` and `repo/git/*`, and
`node_modules/monaco-editor@0.56.0`'s own `monaco.d.ts`/`esm` sources.

## 0. What C10 shipped, and what C11 inherits

- `internal/bridge/gitstream.go`: a second in-process Wails stream, no handshake, and
  `readOnlyMethods` — a **default-deny allowlist** checked before any handler runs. `review.*` is
  absent from it by design (C10 §9).
- `repo/git/transport.ts`: one `Transport` per repo workspace, cached, disposed on workspace close.
  Requests go local (`hostHandlers.ts`) or forward to Go. Events and streams forward only.
- `repo/git/hostHandlers.ts`: host-answered methods, the `CodeRepo.ID` ⟷ `RepoSummary.RepoID`
  mapping, and four `readOnlyRefusal` stubs explicitly labelled "C11 scope":
  `editor.openRangeDiff`, `review.open`, `review.session.save`, `review.session.load`.
- `capabilities.write: false`, threaded through `git-ui` to hide every write affordance.
- `buildReadOnlyRefMenu()` returns `[]` — C10 dropped "Review branch changes" because
  `review.open` had no native surface (`rowMenuModel.ts:297-308`).
- `RepoDiffView.vue` renders a Monaco diff for both C6's HEAD-vs-worktree pair and C10's
  revision pair; `repoDiffTabStateSchema` already carries `left`/`right`/labels.
- `theme/app-shell.css` is already loaded natively (imported by `git-ui`'s `main.ts`), so a second
  `mount()` adds no new document-level assumption.

## 1. What SPEC left open, and how each is resolved

| SPEC's open item | Resolution |
|---|---|
| Where the panel lives | **The repo workspace's left panel, as a third segment beside Files and Search** (§5). Diffs stay in the tab area, which is the extension's own split, ported. |
| Gutter-icon anchoring over Monaco | §7. No line mapping is needed — the server anchors, and the right-hand document is always the branch tip. Monaco's `glyphMarginClassName` + `IViewZone` + `onMouseDown` carry the rest. |
| What changes versus the extension | §6. |
| Read-only holds here too | §3 (review state writes `review.db` only, never the repository) and §4 (what stays refused). |
| "AI-review feedback" | §9. There is no AI service in this repo; the phrase names the user-authored comment list formatted for pasting into an AI chat. |

## 2. Where the code lives

| Area | Files |
|---|---|
| Go boundary | `internal/bridge/gitstream.go`, `gitstream_test.go` |
| Portable algebra | `apps/kira-studio-vscode/src/reviewRanges.ts` (+ its test) → `packages/git-core/src/model/reviewRanges.ts` |
| Ported Vue | `packages/git-ui/src/components/review/*` + `state/review*.ts`, unchanged, mounted via `mount({view: 'review'})` |
| Native host | `repo/git/hostHandlers.ts`, `repo/git/transport.ts`, new `repo/git/reviewSession.ts` |
| Native panel | `repo/RepoPanel.vue`, new `repo/RepoReviewView.vue` |
| Native diff surface | `views/repo/RepoDiffView.vue`, new `views/repo/reviewDecorations.ts`, new `views/repo/ReviewThread.vue` |
| Shared vocabulary | `packages/shared/domain/tabs.ts`, `state/repoTabs.ts` |
| `git-ui` edits | `components/rowMenuModel.ts` (one builder) only |

## 3. Does `review.*` write the repository? — the allowlist question

The safety-critical section, and the reason this plan exists before any code.

### 3.1 What each method actually persists

Traced through the real handler chain, not inferred from names.

`handlers.go:185-212` routes nine `review.*` methods. Each is a thin decode-validate-delegate
(`comments.go:14-17`'s own doc comment) onto `gitsession.RepoEntry`:

| Method | `RepoEntry` call | What it persists |
|---|---|---|
| `review.resolveBase` | `ResolveReviewBase` | nothing — resolves a base ref |
| `review.files` | `RangeFiles` | `review_session.last_used_at` (`Touch`) |
| `review.fileDiff` | `ReviewFileDiff` | nothing |
| `review.mark` | `MarkFile` | `review_file` + `review_range` rows |
| `review.comment.add` | `AddComment` | a `review_comment` row |
| `review.comment.list` | `ListComments` | `Touch` |
| `review.comment.remove` | `RemoveComment` | deletes one `review_comment` row |
| `review.comment.clear` | `ClearComments` | deletes this session's `review_comment` rows |
| `review.comment.export` | `ExportComments` | `Touch` |

Every one of those rows lives in **`review.db`, a second SQLite file under `KIRA_HOME`** —
`gitreview/db.go:18-20`: `filepath.Join(config.KiraHome(), "review.db")`, its own file by design
(`docs/ARCHITECTURE.md:835-847`). `internal/gitreview` contains **no `exec.Command`, no
`os.WriteFile`, no git invocation of any kind**; `store.go`'s only writes are
`INSERT`/`UPDATE`/`DELETE` against `review_session`, `review_file`, `review_range`,
`review_comment`.

The git work these handlers *do* perform is read-only porcelain:

- `readSnapshotSource`/`blobOID` → `git cat-file --batch`/`--batch-check` sessions
  (`incremental.go:162-190`, `catfile`).
- `anchorOne` → `git merge-base --is-ancestor` (`IsAncestorArgs`) and `git diff`
  (`FileDiffArgs`) — `comments.go:204-248`.
- `MarkFile` → the same snapshot read plus `FileDelta`'s diff (`incremental.go:673+`).

No `update-index`, no `write-tree`, no `commit-tree`, no ref update, no note, no working-tree
write, anywhere in the review path.

### 3.2 The decision

**All nine `review.*` methods are admitted to `readOnlyMethods`.** This is the same shape as C10's
own `repoSettings.set` exception (§4.4 there): a method whose name says "write" but whose writes
land in Kira's own storage, never the user's repository. Here the case is stronger — review state
is the *entire point* of the surface SPEC asks for, and denying it would leave a panel that can
render comments it can never create.

Stated plainly, with the evidence above behind it: **`review.mark` and `review.comment.add/remove/
clear` cannot modify a git repository.** The worst outcome of a bug in this layer is a wrong row in
`review.db`, which `gitreview`'s own reaper purges on branch close or TTL anyway.

Admitted (nine): `review.resolveBase`, `review.files`, `review.fileDiff`, `review.mark`,
`review.comment.add`, `review.comment.list`, `review.comment.remove`, `review.comment.clear`,
`review.comment.export`.

The allowlist comment at `gitstream.go:51-52` ("review.* is deliberately absent — C11's own
surface") is replaced with the finding above, so the next reader sees why these are in rather than
having to re-derive it.

### 3.3 `review.session.save`/`.load` never reach Go at all

Not a Go method. `handlers.go` has no case for either; `contract.go:39`'s own history note says so
outright — G19 D11b added them for "the review sidebar's durable *back to branch selection* resume
point, stored in the extension's own `context.workspaceState` and **never reaching this server**".

So they stay **out** of the Go allowlist and are answered host-side (§8). `gitstream.go` refusing
them remains correct and is kept as defence in depth: if a future frontend bug forwarded one, it
would be refused rather than reaching a router that has no case for it.

### 3.4 The test that currently asserts the opposite

`gitstream_test.go:66-72`'s `TestReadOnlyRequest_WriteMethodsAreRefused` lists `review.mark`,
`review.comment.add/remove/clear` and `review.session.save` under the comment "Every method here
writes the repository (§4.1's table)". That comment is now false for all five, and the four Go-served
ones must move or the test fails the moment §3.2 lands.

The fix is not a deletion. The table splits in two, each entry keeping an accurate reason:

- `TestReadOnlyRequest_WriteMethodsAreRefused` keeps only methods that genuinely write the
  repository: `op.run`, `remote.run`, `remote.cancel`, `undo.run`, `worktree.prepare`,
  `worktree.cancelPrepare`, `stack.restack`, `stack.cancelRestack`, `credential.provide`,
  `editor.resolveConflict`, `settings.setGitPath`.
- A new `TestReadOnlyRequest_HostAnsweredMethodsAreRefused` covers `review.session.save`,
  `review.session.load`, `review.open` and `editor.openRangeDiff` — refused *because the Go router
  has no handler for them*, not because they are writes (§3.3).
- The four newly-admitted review writes are covered by the existing
  `TestReadOnlyRequest_AllowlistedMethodsReachInnerHandler`, which iterates `readOnlyMethods` and
  therefore picks them up with no edit.
- `TestReadOnlyRequest_UnknownMethodIsRefused` is untouched — it is what keeps the allowlist an
  allowlist.

## 4. The read-only boundary beyond review state

SPEC: "viewing and reacting to review feedback, never writing code from this surface." Concretely,
this phase rules out:

| Ruled out | Enforcement |
|---|---|
| Editing either side of a review diff | `readOnly: true` + `domReadOnly: true` on the diff editor (C6, unchanged); `originalEditable: false` |
| Applying/reverting a hunk from the diff gutter | `renderMarginRevertIcon: false`, `renderGutterMenu: false` (C6/C10, unchanged) — Monaco's own apply-change affordances |
| "Accept/apply this suggestion" from a comment | No such action exists and none is added. A comment is prose; the only outbound action is `review.comment.export` → clipboard |
| Staging, committing, discarding from the review pane | Not in `git-ui` at all (C10 §4.1) |
| Checkout of the reviewed branch from the ref picker | `buildReadOnlyRefMenu` still hides every checkout item; §12's restored entry is `reviewBranch` alone |
| Conflict resolution, credential answering, git-path writes | `hostHandlers.ts`'s existing throws (C10 layer 2) plus layer 1 |
| Every `op.run`/`remote.run`/`undo.run`/`stack.*`/`worktree.*`/`preflight.*` | Layer 1, unchanged |

The three-layer structure (Go allowlist → host-handler throws → hidden UI affordances) is C10's and
is not restructured. Only the allowlist's membership changes, by exactly the nine methods in §3.2.

## 5. Where the panel lives

SPEC leaves this open. This section makes the call.

### 5.1 The shell as it actually is

`WorkbenchShell.vue` has three regions: a resizable left panel (`layoutState.panel.project`,
default width 260px, visibility toggleable), the tab area (`MainView`), and a bottom operations
panel. There is no secondary/right panel and no split-editor concept. A repo workspace's left panel
is `RepoPanel.vue` — `PanelShell` plus a `SegmentedControl` switching Files ⟷ Search
(`repo/state/search.ts`).

### 5.2 Options

**A — its own tab kind (`repo-review`), mirroring `repo-graph`.** Symmetric with C10, and
persistence is free (`patchTabState`, tab hydration). But the review workflow is *pick a file →
read its diff → mark it → pick the next*: with the file list in one tab and the diff in another,
every file switch costs two tab switches and hides the diff being reviewed. That is not a polish
issue; it is the core loop.

**B — a third left-panel segment (Files | Search | Review).** The file list, commit list and
comments stay visible beside the diff in the tab area — exactly the extension's ergonomics. Costs:
no free persistence (§8.3 answers it), and the default 260px panel is narrower than VS Code's
~300px sidebar default (both resizable).

**C — a side panel beside the diff, inside the tab area.** Needs a split-pane concept the workbench
does not have. Real new shell work for a layout nothing else in the app uses. Rejected.

### 5.3 The call: option B

Decisive evidence comes from the code being ported. The extension puts the **graph** in a
`panel` view container and the **review view** in an `activitybar` container
(`apps/kira-studio-vscode/package.json:37-52`) — it already decided these two surfaces play
different roles: the graph is content, the review view is a navigator driving diffs in the editor.
C10 mapped the graph onto a tab. The faithful mapping for the review view is the native equivalent
of a sidebar, which is the left panel.

Two corroborating facts:

- `ReviewView.vue` is built for sidebar width — single column, panes swapped rather than tiled,
  `height: 100%` on its root, its own internal scrollers. It is not a wide-canvas component.
- `ReviewView.vue` **never reads `viewState`** (the prop exists on `MountOptions`; the extension
  hands it `NullViewStateStore`, `ReviewView.vue:11`). Option A's one structural advantage —
  free per-tab view-state persistence — buys nothing for this component. The state that must
  survive is the review *session*, which already has its own mechanism (`review.session.save/load`,
  §8.3) precisely because the extension's webview is destroyed on hide.

Consequences, all handled below: the mount is kept alive with `v-show` while the workspace is open
(§8.4), `review.open` switches the segment and pushes a target (§8.2), and the panel is widened to
a review-appropriate width the first time the segment is opened (§14 OQ2 asks a human to confirm
the exact behaviour).

## 6. What changes versus the extension's review surface

| Concern | Extension today | Native (C11) |
|---|---|---|
| Panel host | `kiraVersion.review` webview in an activity-bar container | Left-panel segment in `RepoPanel.vue` |
| Panes (commits/files/comments) | `ReviewView.vue` + `state/review*.ts` | **Identical components, unchanged** |
| Diff rendering | VS Code's native diff editor over `kira-version:` virtual documents | `RepoDiffView.vue`'s Monaco diff editor over `kira-repo:` models |
| Comment threads | `vscode.comments` API (`reviewComments.ts`): controller, `commentingRangeProvider`, thread widgets | Monaco decorations + `IViewZone` widgets (§7) |
| "Add comment" gesture | VS Code's gutter "+" from `commentingRangeProvider` | Hover "+" glyph + an editor action (§7.4) |
| Review marking | `reviewMarking.ts`: 3 decoration types, trusted hover command links, CodeLens, selection context keys | Same three visual roles as Monaco decorations; the hover-link/CodeLens/context-key machinery is dropped for a glyph click plus an editor action (§7.4) |
| Range algebra | `reviewRanges.ts` | **Same file, moved to `@kira/git-core`** and imported by both (§10 S1) |
| Session resume | `review.session.save/load` → `context.workspaceState` | Same two methods → native per-repo store (§8.3) |
| Target push | `review.target` event from the extension host | Same event, emitted by the transport's local bus (§8.1) |
| Comment refresh after an editor-side add | `ui.action: refreshReviewComments` | Same event, same local bus |
| Copy-for-AI | `copyReviewComments` palette command → `ui.action` | Same, plus the pane's own button; `clipboard.write` already host-answered |
| Write affordances | present (`write: true`) | absent (`write: false`), unchanged from C10 |

Nothing in `components/review/` or `state/review*.ts` is edited. That is the SPEC requirement
("the exact same Vue components") and the mount contract already supports it.

## 7. Gutter icons and comment threads over Monaco

No precedent in this repo. This is the phase's design surface.

### 7.1 Which half of the extension's implementation ports

`reviewRanges.ts` imports nothing from `vscode` — it is pure interval algebra
(`normalizeRanges`, `unionRanges`, `subtractRanges`, `clampRanges`, `coverage`, `selectionToRange`,
`hunkChangeBlock`) with its own test. It moves to `@kira/git-core` and is imported by the extension
and the native app alike. Its 295-line test moves with it.

`reviewComments.ts`/`reviewMarking.ts` are the `vscode`-facing controllers — URI parsing, comment
controllers, decoration types, context keys, CodeLens. Their *structure* ports (resolve an anchor →
fetch → paint → repaint on mutation); their API surface does not.

### 7.2 Anchoring: there is no line mapping to do

The most important finding of this section, because it removes the hard problem SPEC anticipated.

A review diff's right-hand document is **always `<branchTip>:<path>`** — `editor.openRangeDiff`
carries `branchTip` as its own parameter and only `leftRev` varies by mode (merge base in `range`,
the file's `reviewedAtSha` in `sinceReview`). `LineRange` is defined in exactly those coordinates:

> D5's selection → `LineRange` mapping: the modified pane's own line numbers, taken directly — the
> document IS `<branchTip>:<path>` (F6) and `LineRange` is defined in exactly those coordinates, so
> there is no projection to do. (`reviewRanges.ts:116-119`)

Cross-revision drift is resolved **server-side**, in `anchorOne` (`gitsession/comments.go:194-248`):
tier 0 compares blob OIDs (exact), tier 1 projects the range through a real `git diff` when the
anchor sha is an ancestor (projected), tier 2 reports the original range with a label when history
was rewritten or the lines are gone (stale/removed). `review.comment.list` returns the already-
anchored range plus an `anchor` kind.

So the native renderer places a decoration at `comment.range.start..end` of the modified model and
renders `anchor` as a thread label — the same two lines of logic `reviewComments.ts:63-74` already
uses. It computes no mapping of its own, which is also what keeps the two hosts from disagreeing.

### 7.3 Monaco 0.56.0 mechanics, verified against the pinned package

Checked in `node_modules/monaco-editor/monaco.d.ts` and the ESM sources, not from memory:

- `IModelDecorationOptions.glyphMarginClassName` (`:2018`), `.glyphMarginHoverMessage` (`:1984`),
  `.glyphMargin: { position: GlyphMarginLane.Left|Center|Right, persistLane? }` (`:1916-1926`,
  `:1860-1864`), `.isWholeLine`, `.overviewRuler`, `.zIndex` — all present.
- `ICodeEditor.createDecorationsCollection` (`:3156`) — the non-deprecated replacement for
  `deltaDecorations` (`:6590`).
- `changeViewZones` / `IViewZone` (`:6677`, `:5743`) — the vertical-space widget a thread needs.
- `onMouseDown` with `MouseTargetType.GUTTER_GLYPH_MARGIN = 2` (`:6071`, `:6157`).
- `editor.addAction` for the context-menu/keybinding entry.
- Everything above is core editor API; `monacoEntry.ts` already pulls
  `monaco-editor/features/register.all.js` (hover, find, folding), and **no new Monaco import or
  worker is needed**.

Two concrete gotchas, both found by reading the pinned source rather than assuming:

1. **`glyphMargin` must be set explicitly.** `monaco.d.ts:3578-3582` documents "Defaults to true in
   vscode and to false in monaco-editor", but the registered option default in
   `esm/vs/editor/common/config/editorOptions.js:3233` is `true`, and no standalone override sets
   it to `false`. The two disagree. `RepoDiffView.vue` currently sets nothing. Pass
   `glyphMargin: true` explicitly for the review variant rather than depending on which of the two
   is authoritative in a future bump.
2. **`hideUnchangedRegions` hides decorations.** `RepoDiffView.vue:163` enables it. A comment can
   anchor to any line of the file (the extension's `commentingRangeProvider` offers the whole
   document, `reviewComments.ts:108-111`), so a commented line can fall inside a collapsed region —
   and 0.56.0 exposes no public API to expand a specific unchanged region (`monaco.d.ts` has
   `hideUnchangedRegions` as an option only; `setHiddenAreas` is not in the public typings). A
   silently invisible comment is not acceptable, so the **review variant sets
   `hideUnchangedRegions: { enabled: false }`**. C6's plain diff tab keeps it enabled.

### 7.4 The native surface, concretely

One new module, `views/repo/reviewDecorations.ts`, attached to a diff editor whose tab carries
review state. Three decoration roles, mirroring `reviewMarking.ts:183-200` and
`reviewComments.ts`:

| Role | Rendering |
|---|---|
| Reviewed lines | whole-line background + left overview-ruler mark (`reviewedType`'s equivalent) |
| Hunk actionable / hunk reviewed | glyph-margin icon at the hunk's change block (`hunkChangeBlock`), two classes by `coverage()` |
| Comment present | glyph-margin icon at the comment's first line, `glyphMarginHoverMessage` carrying the body's first line and the anchor label |

Interactions:

- **Open a thread**: `onMouseDown` with `MouseTargetType.GUTTER_GLYPH_MARGIN` on a comment glyph
  toggles a view zone under that line. The zone's DOM node hosts `ReviewThread.vue`, mounted with
  `createApp` and unmounted with the zone — the body, the anchor label, a Delete action
  (`review.comment.remove`), nothing else.
- **Add a comment**: a `+` glyph painted on the hovered line (tracked via `onMouseMove`, cleared on
  `onMouseLeave`) opens an empty composing zone; `addAction('kira.review.addComment', …)` gives the
  same gesture a context-menu entry and a keybinding for selections. Submit calls
  `review.comment.add` with `selectionToRange` of the current selection (or the clicked line) and
  `at: branchTip`, then repaints. This is the only place a comment is ever created — the panel
  never adds one, exactly as in the extension (`reviewComments.ts:5`, D10).
- **Mark reviewed**: clicking a hunk glyph, or the editor action over a selection, calls
  `review.mark` with `clampRanges(…, lineCount)`. The response's `review` field repaints; the
  client never predicts the stored state (`reviewRanges.ts:8-11`).

`review.fileDiff` supplies `hunks`, `reviewedRanges` and `lineCount` for a review tab — the same
call `reviewMarking.ts:244-276` makes, with the same two-mode selection.

### 7.5 The review diff tab

Extend `repo-diff` rather than forking a third kind, following C10 §6.1's own precedent.
`repoDiffTabStateSchema` gains one nullable object:

```ts
review: { branch: string; branchTip: string; leftLabel: string } | null   // default null
```

Non-null turns on §7.4's layer, `glyphMargin: true` and `hideUnchangedRegions: {enabled: false}`;
null is C6/C10 behaviour, byte-identical. `left`/`right` already carry `leftRev`/`branchTip`, so
`file.read` loads both sides through the existing path with no new request shape.

`openRepoReviewDiffTab` joins `openRepoCommitDiffTab` in `state/repoTabs.ts`, with one correction
to the dedupe predicate: the existing lookup matches on `(workspaceId, path, left, right)` only, so
a single-commit branch whose merge base equals the commit's parent would reuse a plain commit-diff
tab and silently render no review layer. The predicate gains `review === null` equality on both
sides, so a review diff and a commit diff are never the same tab.

### 7.6 Repaint choreography

The extension keeps the sidebar and editor in sync through `proxyHandlers.ts` hooks
(`notifyCommentsMutated`, `notifyMarked`, `refreshReviewComments`). Natively both halves share one
`Transport`, so the same choreography is a post-processing step in `transport.ts`:

| Trigger | Effect |
|---|---|
| `review.comment.add/remove/clear` succeeds (from either half) | repaint every open review diff tab for that `(repoId, branch)`; emit `ui.action: refreshReviewComments` on the local bus so the Comments pane reloads |
| `review.mark` succeeds | repaint the affected path's open review tabs |
| `repo.changed` (already emitted over the git stream, `gitstream.go:117`) | re-resolve and repaint; this is what `ReviewSessionState`'s "the comparison has changed" banner already listens to |
| tab closed / editor unmounted | dispose zones, decoration collections and mounted thread apps |

## 8. Host-answered methods and the local event bus

### 8.1 A local event bus in `transport.ts`

`transport.ts`'s `on()` currently forwards to `remote.on` only — correct for C10, where every event
originates in Go. C11 needs two events Go never emits: `review.target` (the panel learning which
branch to review) and `ui.action` (`refreshReviewComments`, `copyReviewComments`,
`toggleFileReviewed`). Both are extension-host-composed today.

So `on()` becomes a composite over the remote subscription and a small local emitter, and the
transport exposes an internal `emitLocal(event, payload)` used by `review.open`'s handler and by
§7.6. ~25 lines. This is the honest native analogue of what `KiraReviewViewProvider` does with
`this.#server?.emit(...)` — not a workaround.

### 8.2 The four stubs C10 left

| Method | Native answer |
|---|---|
| `editor.openRangeDiff` | Map `(repoId, branch, branchTip, leftRev, leftLabel, path, status, pinned)` onto `openRepoReviewDiffTab` (§7.5). `status: 'deleted'` has no right-hand blob — open the left revision read-only instead of a diff, matching `file.read`'s `missing` classification C6 already renders |
| `review.open` | Switch `RepoPanel`'s segment to Review, ensure the panel is visible, then `emitLocal('review.target', {repoId, branch})` |
| `review.session.save` | §8.3 |
| `review.session.load` | §8.3 |

`editor.goToFile` stays a throw (no caller, C10 §5).

### 8.3 Session persistence

The extension stores the resume point in `context.workspaceState`. The panel itself is not a tab, so
it has no tab record of its own — and `repo/state/search.ts` shows the native panel-state precedent
is in-memory only (no `control.*` persistence call), which would lose exactly what G19 D11b built
this for.

The right host already exists: **the pinned `repo-graph` tab's own state**. It is created once per
repo workspace by `ensureWorkspaceShell`, never closed, persisted through `control.tabsSave`, and
already carries one opaque `git-ui`-owned blob (`repoGraphTabStateSchema.viewState`,
`z.unknown().nullable()`, C10 S13). So `repoGraphTabStateSchema` gains a second field of the same
shape:

```ts
reviewSession: z.unknown().nullable().default(null)
```

New `repo/git/reviewSession.ts` resolves the repo workspace's pinned graph tab and reads/writes that
field through `patchRepoGraphTabState`, mirroring `viewStateStore.ts` line for line. The value stays
**opaque to the host** — `ReviewView.vue` defines and validates its own shape
(`ReviewView.vue:155,197,206`) — the same discipline C10 applied to `PersistedViewState`: store it,
let `git-ui` parse it. Saving `null` clears it, which is the "back to branch selection" gesture. No
new Go method, no new table, no second persistence mechanism.

### 8.4 Mount lifecycle

`RepoReviewView.vue` mounts `mount(el, {transport: gitTransportFor(repoId), viewState:
NullViewStateStore, host: 'kira', view: 'review', target, hostConnectionState: {kind:'connected'}})`
— `NullViewStateStore` because `ReviewView.vue` never reads it (§5.3).

Mounted lazily on the segment's first activation and kept alive with `v-show` while the workspace
is open, so switching to Files and back does not tear down an in-flight review. Unmounted with the
panel when the workspace closes; the transport itself is already workspace-scoped and disposed by
C10's S17 path.

## 9. "AI-review feedback" — what it actually is

SPEC says "AI-review feedback surfaced via gutter icons on the affected lines". Checked against the
code: **there is no AI service, no AI API call and no AI-authored data anywhere in this repo.**
`docs/v1.3/SPEC.md:427-430` states it directly for G13, the phase that built this:

> intentionally the simplest possible shape — a flat table of `(session, file, line range, text,
> created_at)`, rendered as an ordered plain-text list for the user to paste into an AI
> conversation by hand. No AI API call, no response ingestion, no threading in v1.3

`reviewComments.ts:4-7` says the same from the other side ("a feature whose entire output is prose
to hand an AI"). So the feature is: the user writes comments on lines, they render as gutter icons
and threads, and `review.comment.export` formats them for pasting. That is what this phase ports —
no AI integration is invented here, and none is stubbed. This is recorded so a later reader does
not go looking for a missing AI data source.

## 10. Implementation steps

**S1 — Move the range algebra.** `apps/kira-studio-vscode/src/reviewRanges.ts` and
`reviewRanges.test.ts` → `packages/git-core/src/model/reviewRanges.ts` (+ test). Export from
`git-core`'s `index.ts`. Rewrite `reviewMarking.ts`'s import to `@kira/git-core`. All three
consumers already depend on that package. No behaviour change — `bun test packages/git-core`.

**S2 — `internal/bridge/gitstream.go`.** Add §3.2's nine methods to `readOnlyMethods`, replacing
the "review.* is deliberately absent" comment with §3.1's finding (what `review.db` is, and that no
git write exists in the path).

**S3 — `internal/bridge/gitstream_test.go`.** §3.4's split. Lands **with S2, in the same commit** —
the allowlist is this phase's safety boundary and must never be untested, the same rule C10's S19a
set.

**S4 — `transport.ts`'s local event bus** (§8.1), plus the repaint hooks' registration seam (§7.6).

**S5 — `hostHandlers.ts`.** Replace the four refusal stubs with §8.2's handlers.

**S6 — `repo/git/reviewSession.ts`** (§8.3), plus `repoGraphTabStateSchema.reviewSession`.

**S7 — Shared vocabulary.** `repoDiffTabStateSchema.review` (§7.5) and `defaultRepoDiffTabState`.

**S8 — `state/repoTabs.ts`.** `openRepoReviewDiffTab` plus the dedupe-predicate correction.

**S9 — `views/repo/reviewDecorations.ts`** (§7.3/§7.4): decoration collections, the glyph/hover/
click wiring, the `review.fileDiff` and `review.comment.list` fetches, and the repaint registry
S4 calls into.

**S10 — `views/repo/ReviewThread.vue`**: one thread's body, anchor label and delete action, plus the
composing form.

**S11 — `RepoDiffView.vue`'s review branch**: `glyphMargin: true`,
`hideUnchangedRegions: {enabled: false}`, attach/detach `reviewDecorations` when
`tab.state.review !== null`.

**S12 — `rowMenuModel.ts`.** `buildReadOnlyRefMenu()` returns one section containing
`plainItem('reviewBranch', 'Review branch changes', 'codicon-diff-multiple')` — the item C10
removed (`:297-308`). Its handler (`App.vue:745-748` → `opsState.openReview` →
`review.open`) needs no change. The only `git-ui` edit in this phase.

**S13 — `repo/RepoReviewView.vue`** (§8.4) and **S14 — `RepoPanel.vue`'s third segment** (§5.3),
including `:searchable="false"` for the review segment and the panel-width behaviour (§14 OQ2).

**S15 — Docs** (§12).

**S16 — Tests** (§11).

Sequencing: S1 independent. S2→S3 (Go, needs nothing else). S4→S5→S6. S7→S8→S11. S9 needs S7/S8;
S10 with S9. S13 needs S4/S5/S6; S14 needs S13. S12 independent after S5. S15/S16 last, except S3
which lands with S2.

## 11. Testing

CLAUDE.md's bar: a dedicated test only for genuinely hard logic.

**`gitstream_test.go` — yes, mandatory** (S3). A safety boundary, and this phase changes its
membership. §3.4's three tables.

**`reviewRanges.test.ts` — moves, unchanged** (S1). It is the existing guard on interval algebra
with interacting rules (split, merge, adjacency, clamping) — exactly the category CLAUDE.md keeps.
Running it under `@kira/git-core` also means the native app's copy is covered for the first time.

**No new unit test earns its keep.** The decoration layer is editor wiring (paint, dispose, refetch)
with no arithmetic of its own — §7.2 is the whole reason: the anchoring is server-side and already
has `gitsession`/`gitreview` tests (`resolve_test.go`, `ranges_test.go`, `store_test.go`,
`normalize_test.go`). The local event bus is a `Map` of callbacks. The session store is a
read/write pass-through. Writing tests for these would restate short function bodies.

**UI test** (`tests/ui/repo-workspace.spec.ts`): one case — open a repo workspace, switch the panel
to Review, assert the mount renders its branch selector rather than an empty container. Deliberately
shallow; the deep review behaviour needs a real repository with a real branch comparison, which is
§15's manual recipe, not a UI spec.

## 12. Documentation to update

- `docs/ARCHITECTURE.md`: the C5-C10 native-workspace section gains the review layer — where the
  panel lives, that review state is `review.db` and never the repository, and the Monaco decoration
  design (§7). Delete any "Known open items" entry this phase closes; add none that it does not
  genuinely leave open.
- `docs/v1.5/mcp-repo-map-issues.md`: log whatever the dogfooding pass finds (§15 step 8).
- This plan is the durable record of the allowlist decision; `gitstream.go`'s own comment carries
  the short form for a reader who never opens `docs/`.

## 13. Explicitly out of scope

- Threaded replies. The schema is flat by design (v1.3 SPEC; `thread.canReply = false`).
- Any AI integration (§9).
- PR creation, approval or submission against a forge. `commit.resolvePr`/`branch.resolvePr` are
  read-only lookups and stay that way.
- A multi-file review diff (the extension's own "Open all changes" already opens N tabs, C10 §6.1).
- CodeLens and trusted-hover command links (`reviewMarking.ts`'s VS Code-specific affordances) —
  replaced by the glyph click and the editor action, not reproduced.
- Restoring any write affordance C10 hid.

## 14. Open questions for a human

**OQ1 — panel placement.** §5.3 chooses the left-panel segment over its own tab, on the strength of
the extension's own panel-vs-sidebar split and the review loop's need to keep the file list visible
beside the diff. SPEC calls this an open design question, so it is flagged rather than assumed
settled. The cost if a human disagrees is small and local: option A is the same mount in a
`repo-review` tab kind, roughly S13/S14 replaced by a tab kind plus registration.

**OQ2 — panel width on first open.** The left panel defaults to 260px; VS Code's sidebar defaults
to ~300px and the review panes are denser than a file tree. Options: leave it (user resizes),
widen to a minimum on first Review activation, or widen only if the user has never resized it. I
lean to the third — it respects a user's own choice and fixes the default — but it is product
behaviour, not a technical call.

**OQ3 — the hover "+" glyph.** §7.4 paints an add-comment glyph on the hovered line, tracked via
`onMouseMove`. It is the discoverable affordance (`reviewComments.ts:5-7` argues exactly that for
the VS Code gutter "+"), and it is ~30 lines. The cheaper alternative is the context-menu action
alone, with no hover affordance at all. I recommend keeping both; a human who wants the smaller
surface should say so before S9.

## 15. Verification

1. `bun run typecheck` — all five projects. S1's move and S7's schema change are the two most
   likely to surface a real mismatch.
2. `bun run lint`.
3. `bun run build` — record the bundle delta (the review components are new to the native bundle;
   no new Monaco chunk or worker, §7.3).
4. `go build ./...`, `go test ./internal/...` — includes S3 and `layering_test.go`.
5. `bun run test:unit` — `git-core` (with the moved suite), `git-ipc`, `git-ui`.
6. `bun run test:ui`.
7. **Manual recipe** (`bun run dev`, a repository with a branch ahead of `main`):
   - Right-click a branch badge in the graph: "Review branch changes" is present and nothing else
     (S12). It opens the left panel's Review segment with that branch targeted.
   - The commit list, Files pane and Comments pane render at panel width; switching to Files and
     back does not restart the review (§8.4).
   - Click a file: a diff tab opens with both revision labels. The file list stays visible.
   - Select lines, add a comment: a glyph appears in the modified pane's margin; clicking it opens
     the thread inline; the Comments pane lists it without a manual refresh (§7.6).
   - The comment survives a tab close/reopen and an app restart, and its glyph sits on the right
     line after a new commit lands on the branch (server-side projection, §7.2).
   - Mark a hunk reviewed: the line background and the Files pane's status change together.
   - Copy review comments: the clipboard holds the ordered plain-text list (§9).
   - Confirm a commented line inside a long unchanged stretch is actually visible (§7.3 gotcha 2).
8. **The backstop check, the one that matters.** In DevTools, reach past the UI and issue requests
   directly on the stream:
   - `review.mark` and `review.comment.add` must now **succeed**, and immediately afterwards
     `git status`, `git reflog`, `git stash list` and `git rev-parse HEAD` in that repository must
     be **unchanged**, while a row appears in `${KIRA_HOME}/review.db`. That pair is the whole of
     §3's claim, checked live rather than argued.
   - `op.run` (e.g. `branchCreate`), `remote.run`, `undo.run` and `settings.setGitPath` must still
     reject with `E_READ_ONLY` and must not reach a handler.
   - `review.session.save` over the stream must reject with `E_READ_ONLY` (§3.3) while the same
     call through the panel's own transport succeeds host-side.
   A failure in the first bullet means the allowlist is wrong; a success in the second means C10's
   layer 1 has regressed, and nothing else in this phase matters until it is fixed.
9. Dogfooding pass with `bun run mcp:repo-map` running; log findings per CLAUDE.md.
