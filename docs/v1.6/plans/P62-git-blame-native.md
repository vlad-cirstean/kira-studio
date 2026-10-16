# P62 — Git blame in the native workspace

> **What this phase is.** `docs/v1.6/SPEC.md`'s P62 row, turned into concrete steps from direct
> reads of the real tree — every file, line number, method signature and Monaco API below was
> opened and checked, never recalled. No probe against a real git binary was needed: v1.4's P5
> already did that work (`docs/v1.4/plans/P5-git-blame-widget.md` §0) and this phase adds no new
> git invocation.

## 0. What SPEC left open, and how each is resolved

SPEC's P62 row names two questions for this plan.

**1. "Where does blame surface in the native workspace — inline over Monaco, a status-bar summary,
or both?"** Inline over Monaco, on the cursor line of `views/repo/RepoFileView.vue`, as injected
text. The status bar is unavailable for a reason that is written into the code (§2.2); both is
therefore not an option. §2.4 states the call in full.

**2. "Does `packages/git-ui` already carry a blame-consuming component from P5 worth reusing, or
did P5's consumer live entirely in the extension's own code?"** **Entirely in the extension.**
`packages/git-ui/src/**` contains zero occurrences of "blame" (checked directly, case-insensitive,
across all 129 files). P5's whole consumer is three extension-host files — `blameWidget.ts` (199 lines),
`blameState.ts` (65), `blameAge.ts` (30) — none importable here: `blameWidget.ts` imports `vscode`
at line 15 and renders into a `vscode.StatusBarItem`. So there is nothing in the shared package to
port. What *is* reusable is one pure function (§5) and the request/debounce/dedupe *shape*, which
this plan follows deliberately rather than reinventing.

**No backend work, confirmed rather than assumed** (§1). SPEC's premise holds: `ContractVersion`
stays 35 on both sides, `gitstream.go`'s allowlist is unchanged, and no Go file is touched.

---

## 1. Confirmed current state

### 1.1 Go — P5's plumbing, read directly

| File | What is there |
| --- | --- |
| `internal/gitclient/porcelain/blame.go:28` | `BlameLineArgs(path string, line int) []string` → `blame --line-porcelain -L <n>,<n> -- <path>` |
| `…/blame.go:14` | `const UncommittedBlameSHA = "0000000000000000000000000000000000000000"` |
| `…/blame.go:37` | `type BlameLine struct { SHA, Author string; AuthorTimeSeconds int64; Summary string }` |
| `…/blame.go:52` | `ParseBlameLine(raw []byte) (BlameLine, error)` — single hunk only |
| `internal/gitsession/queries.go:478` | `(*RepoEntry).BlameLine(ctx, path, line)` — `filepath.Rel` escape check, then `runOne` + parse |
| `internal/gitrpc/wire.go:204` | `BlameLineParams { RepoID, Path string; Line int }` |
| `internal/gitrpc/detail.go:195` | `handleBlameLine` — `repoId`/`path` non-empty and `line >= 1`, else `E_BAD_REQUEST` |
| `internal/gitrpc/handlers.go:153` | `case "blame.line": return r.handleBlameLine(…)` |

Three properties of this API that shape everything below:

1. **One line per call, one `git blame` spawn per call.** There is no whole-file request and no
   batch form.
2. **Working tree only.** No `atSha`/`rev` param exists (`wire.go:202`'s own comment states this is
   deliberate, P5 §7). Blame always answers "who last touched this line on disk".
3. **The repo must already be held by the calling connection.** `handleBlameLine` → `entryFor`
   (`detail.go:47`) → `Conn.Entry` → `alreadyHeld` (`gitsession/conn.go:277`); a miss is
   `ErrRepoNotHeld`, not an implicit open. §4.2.

### 1.2 The wire contract

`packages/git-ipc/src/contract.ts:1717`:

```ts
'blame.line': {
  params: { repoId: string; path: string; line: number };
  result: {
    readonly sha: string; readonly author: string;
    readonly authorTimeSeconds: number; readonly summary: string;
  };
};
```

`CONTRACT_VERSION = 35` (`validate.ts:126`) and `ContractVersion = 35` (`gitrpc/contract.go:135`).
**Neither moves in this phase** — nothing is added to the contract.

### 1.3 The bridge allowlist — confirmed present

`internal/bridge/gitstream.go:80`, inside `readOnlyMethods`:

```go
"commit.detail": {}, "commit.fileDiff": {}, "file.read": {}, "file.goToTarget": {},
"blame.line": {}, "working.detail": {}, "refs.list": {}, "status.get": {},
```

`repo.open` is on the same allowlist (`:77`), which §4.2 needs. The native mount's `repo.open` can
never arm auto-fetch (`ServeGitStream` sets `DisableAutoFetch`) — so §4.2's call is a pure read, as
the allowlist intends.

### 1.4 P5's consumer, and why none of it ports

`apps/kira-studio-vscode/src/blameWidget.ts` — `vscode.window.onDidChangeActiveTextEditor` /
`onDidChangeTextEditorSelection` / `onDidSaveTextDocument` (`:170-178`), a 150 ms debounce
(`DEBOUNCE_MS = 150`, `:22`), a `lineKey` dedupe carrying `document.isDirty` (`:114`), a
`repoId`-per-workspace-folder memo resolved through `repo.open` (`:64-82`), an `AbortController`
per request (`:141`), and a superseded-response guard (`:151`). It renders through
`extension.ts`'s single `vscode.StatusBarItem`.

`blameState.ts` is the pure half: `selectBlameDisplayState` maps
dirty / none / result → `'dirty' | 'none' | 'uncommitted' | 'resolved'` (`:28-57`).

**Nothing here is a component.** It is host-API wiring plus a four-way switch. The native
equivalent needs its own listeners (Monaco's, not vscode's) and its own renderer (decorations, not
a status-bar item), so this phase re-derives the same *behaviour* (§4.3) and reuses the same
*decision table* by hand, not by import. The one genuinely portable artifact is `blameAge`, and §5
handles it properly instead of making a third copy.

---

## 2. Where blame surfaces

### 2.1 The native surfaces that exist today

| Surface | File | Content shown | Blameable by `blame.line`? |
| --- | --- | --- | --- |
| Repo file viewer | `views/repo/RepoFileView.vue` | the file **on disk**, via `control.codeWorkspaceReadFile` (`:43`) | **yes** — same bytes `git blame` reads |
| HEAD-vs-worktree diff | `views/repo/RepoDiffView.vue`, `left === null` | modified pane is the worktree | yes, but §11 |
| Commit diff | same file, `left !== null` | two historical revisions (`file.read` at `:97-100`) | **no** — no `atSha` param exists |
| Review diff | same file, `review !== null` | `<branchTip>:<path>` | **no** — same reason |
| Graph | `views/repo/RepoGraphView.vue` | `@kira/git-ui`'s `mount()` | n/a — no per-line surface |
| Status bar | `workbench/StatusBar.vue` | metrics, cache, engine | §2.2 |

`RepoFileView.vue` is the only surface whose displayed bytes and `blame.line`'s answer are the same
document by construction. It is also the surface a user actually reads code in.

### 2.2 The status bar is not available — and that is written down, not inferred

`workbench/StatusBar.vue:60`:

> `LAW 14: the left readout answers "where is the caret" and nothing else — every fact a toolbar
> already carries (row counts, pending edits, durations) stays there instead of accumulating here
> too. Not yet wired per-view; "no selection" is the honest default.`

The law is real (`docs/design/kira-design-system/build.mjs:66` carries the same sentence). Blame is
not "where is the caret" — it is a fact about the line under the caret, which is exactly the class
of thing LAW 14 keeps out. The right slot holds app-wide readouts (CPU, memory, cache, engine),
not per-editor state.

So porting P5's shape literally would mean either breaking LAW 14 or wiring the caret readout
per-view first (a separate, unrelated deliverable). Declined on both counts. "Both surfaces" dies
with it.

### 2.3 Whole-file gutter blame would be new backend work — declined, and flagged

The other obvious shape — an author/date column beside every line, GitLens-style — **cannot be
built on the existing API**. `blame.line` is one line per `git blame` spawn (§1.1); a 2 000-line
file would be 2 000 process spawns. A real implementation needs:

- a new `porcelain` multi-hunk parser (`--porcelain`'s abbreviated-header continuation lines, which
  `ParseBlameLine` explicitly does not handle — `blame.go:16-22`),
- a new `RepoEntry.BlameFile`, a new `blame.file` gitrpc method and wire type,
- a `CONTRACT_VERSION`/`ContractVersion` bump to 36 on both sides,
- a new `gitstream.go` allowlist entry,
- and a real invalidation story (P5 §3 already argued no stable cache key exists for a working-tree
  blame).

That is a backend phase, and **SPEC's P62 row states the opposite premise** ("not new backend
work… the wire/backend plumbing this phase needs already exists"). Flagged here rather than
silently scoped in or out: if a human wants whole-file blame, it is its own row, not this one.
OQ-1.

### 2.4 D1 — the call

**Blame renders as injected text at the end of the cursor's line in `RepoFileView.vue`**, in the
muted data font: `alice, 2h · Fix the porcelain parser`. One `blame.line` request per settled
cursor line, debounced 150 ms, memoised per mount.

Why this and not the alternatives:

- It is the only shape the existing per-line API serves honestly — one line at a time is exactly
  what the user is looking at, and exactly what the backend answers.
- It follows C11's own precedent on the same surface: `views/repo/reviewDecorations.ts` already
  paints per-line state over Monaco with a decorations collection, an attach/dispose handle and a
  glyph/hover vocabulary. This phase reuses that structure, not a new one.
- It keeps P5's semantics intact — per-line on demand, working tree only, the all-zero sentinel
  shown as its own state — so the two surfaces never disagree about what blame means.

Cost, stated rather than discovered later: **one `git blame` spawn per cursor line the user rests
on**, bounded by the 150 ms debounce, the line-key dedupe and the per-mount cache (§4.3). Same
order of request rate P5 already ships against a real repository. §6 adds a settings toggle so a
user who does not want that traffic can turn the annotation off entirely.

---

## 3. Monaco mechanics, verified against the pinned `monaco-editor@0.56.0`

Read in `node_modules/monaco-editor/monaco.d.ts`, not recalled:

| Need | API | Line |
| --- | --- | --- |
| Text after the line, not in the document | `IModelDecorationOptions.after?: InjectedTextOptions` | `:2085` |
| Style it | `InjectedTextOptions { content, inlineClassName, inlineClassNameAffectsLetterSpacing }` | `:2107` |
| Hover on the decoration | `IModelDecorationOptions.hoverMessage?: IMarkdownString \| IMarkdownString[]` | `:1988` |
| Paint/replace as a set | `editor.createDecorationsCollection()` | `:3156` (already used, `reviewDecorations.ts:136`) |
| Cursor line | `onDidChangeCursorPosition` | already used, `RepoFileView.vue:120` |
| End-of-line column | `model.getLineMaxColumn(line)` | `ITextModel` |
| Context-menu/keybinding entry | `editor.addAction(IActionDescriptor)` | already used, `reviewDecorations.ts:528` |

Three things checked because getting them wrong is invisible until runtime:

1. **`content` must be a single line** (`:2107-2111`'s own prose). A commit subject can contain neither
   `\n` nor `\r` after `--line-porcelain`'s `summary` attribute (one line by definition), but the
   renderer normalises whitespace anyway (§4.4) rather than trusting that.
2. **`inlineClassNameAffectsLetterSpacing` is left unset (falsy).** The annotation sits after the
   line's last column, so it cannot shift the glyph grid — the same care `P60a` §4.3 takes for
   range highlights.
3. **Injected text is not addressable from a mouse target.** `IMouseTargetContentTextData` carries
   only `mightBeForeignElement` (`:6177-6179`); there is no injected-text identity in the public
   0.56.0 target union. So a click *on the annotation itself* is not implementable through the
   library, which decides §4.5.

---

## 4. `views/repo/blameAnnotation.ts`

One new module, shaped exactly like `reviewDecorations.ts`: an `attach…(mod, editor, deps)` that
returns a `{ dispose() }` handle, called once from the mount it belongs to.

```ts
export interface BlameAnnotationDeps {
  readonly transport: Transport;   // gitTransportFor(codeRepoId)
  readonly gitRepoId: string;      // gitRepoIdFor(codeRepoId)
  readonly path: string;           // props.tab.path — already repo-relative
}
export interface BlameAnnotationHandle { dispose(): void; }
export function attachBlameAnnotation(
  mod: MonacoModule,
  editor: IStandaloneCodeEditor,
  deps: BlameAnnotationDeps,
): BlameAnnotationHandle;
```

`path` needs no `relative()` and no `nfcPath` — unlike the extension, which starts from a
`vscode.Uri.fsPath` (`blameWidget.ts:140`). `props.tab.path` is already the repo-relative string
the Go file listing produced, and `gitsession.BlameLine` resolves it against the repo root the same
way `codeWorkspaceReadFile` already does for the very bytes on screen.

### 4.1 Where it attaches

`RepoFileView.vue`'s `mount()`, after the editor is created (`:88`) and beside the existing
`registerEditor`/`registerCommand` wiring. Guarded on three things, each a silent no-op:

- `settingsState.appearance.inlineBlame` is off (§6),
- `gitRepoIdFor(repoId)` returns `undefined` — this window has no git record for the repository
  (`hostHandlers.ts:68`'s own "never guessed" contract),
- the view resolved to anything but `'found'`.

Disposed in `onUnmounted` (`:142-148`) alongside `disposeCursorSub`/`unregisterFind`. A tab switch
tears the annotation down with the widget; the model survives, as it already does.

### 4.2 The repo hold

`blame.line` needs this connection to already hold the repo (§1.1, point 3). The pinned graph tab's
`App.vue` calls `repo.open` on the same per-workspace transport (`gitTransportFor`, one per repo
workspace, `transport.ts:182`) — but only while it is mounted, and a file tab can be the active one
before the graph ever mounts.

So this module ensures the hold itself, exactly as `blameWidget.ts:64-82` does and for the same
reason: **`repo.open` is idempotent per `(connection, repoId)`**, and `git-ui` never calls
`repo.close` (checked: zero occurrences in `packages/git-ui/src`), so the hold lives as long as the
transport. One memoised promise per `(codeRepoId, gitRepoId)`, module-level so two open file tabs in
one workspace share it, a rejection evicted rather than cached — the `baseMemo` rule C12-7/C13-14
already established twice in this codebase (`reviewDecorations.ts:78`, `gitUiModule.ts:22`).

`repo.open`'s param is a **path**, and `gitclient.RepoSummary.RepoID` *is* the repo root path here
(`App.vue:406` passes `target.repoId` straight to `repo.open`; `tests/ui/repo-workspace.spec.ts:14-17`
shows `root` and `repoId` equal). So `repo.open({ path: deps.gitRepoId })`, no second lookup.

### 4.3 Request lifecycle

P5's shape, re-derived on Monaco's events:

- **Trigger**: `editor.onDidChangeCursorPosition`. One subscription; `RepoFileView.vue` already has
  its own for `revealLine` persistence and that one stays untouched.
- **Dedupe on the line, not the column** — `lastLine`, mirroring `blameWidget.ts:111-115`. A
  horizontal cursor move must not re-fire. There is no `isDirty` half of the key here: the view is
  `readOnly`/`domReadOnly` (`RepoFileView.vue:69-70`) and nothing in this app writes its model, so
  the buffer is always the saved file. P5's whole dirty-buffer state (§0 of that plan) is
  **structurally absent** on this surface — not skipped, not degraded.
- **Debounce 150 ms**, `DEBOUNCE_MS` matching `blameWidget.ts:22`, cleared on dispose.
- **`AbortController` per request**, aborted when a newer line supersedes it, plus the
  `line !== lastLine` guard on resolution (`blameWidget.ts:151`) so a slow answer never clobbers a
  fresh one.
- **Per-mount cache**: `Map<number, BlameLine | null>`. Legitimate here in a way P5 §3 correctly
  refused server-side: the model is immutable for the life of the mount, so `(path, line)` is a
  stable key until the repository itself moves. Arrowing back over a blamed line costs nothing.
- **Invalidation**: `transport.on('repo.changed', …)` (`contract.ts:2178`, `{ repoId, kind }`) —
  filter on `repoId === deps.gitRepoId`, clear the cache and re-resolve the current line. The same
  staleness posture `blameWidget.ts`'s `notifyRepoChanged` takes (`:185-188`): cheap to re-resolve,
  not worth narrowing by `kind`.
- **Failure is silence.** Untracked path, line past EOF, aborted request, `E_READ_ONLY`, a
  `mapGitError` fallthrough — all render nothing, never an error surface. `blameWidget.ts:162-167`
  states the reason and it holds identically here: from the reader's vantage this is an ordinary
  file. Cache the miss as `null` so it is not retried on every revisit.

### 4.4 Render states

Three, from P5's four minus `dirty` (§4.3):

| State | Injected text | Hover |
| --- | --- | --- |
| unresolved / failed / feature off | nothing | — |
| `sha === UncommittedBlameSHA` | `Uncommitted` | `Not committed yet` |
| resolved | `<author>, <age> · <summary>` | `<summary>` · `<author>, <absolute date>` |

The sentinel is compared against the same literal both other sides already carry
(`porcelain.UncommittedBlameSHA`, `blameState.ts:11`) — a fourth copy of that string is not worth
avoiding by inventing a boolean the wire does not have, which is the rule `blame.go:10-13` states.

Rendering details:

- Range: `new mod.Range(line, maxCol, line, maxCol)` where `maxCol = model.getLineMaxColumn(line)`.
- `after: { content, inlineClassName: 'kira-blame-inline' }`, content prefixed with a few spaces so
  it does not butt against the code, and passed through a `.replace(/\s+/g, ' ').trim()`
  normaliser plus a length clamp (`summary` is a commit subject; a pathological one must not push
  the horizontal scrollbar out to 400 columns).
- `hoverMessage`: two `IMarkdownString`s, **untrusted** (`isTrusted` unset) — see §4.5.
- One `editor.createDecorationsCollection()` for the whole module; every repaint is one `.set()`.

CSS lands in a new `theme/blame-annotation.css` imported from `theme/base.css:13`, beside
`review-decorations.css` — the same precedent, a separate file because blame is not review. Colour
`var(--kira-fg-subtle)`, `font-style: italic`, `opacity` left alone. No new token.

### 4.5 Click-through to the commit

P5's status-bar item routed a click to `kiraVersion.openCommitInGraph` → `revealCommit` (P5 §6).
The native equivalent of that destination exists: `git-ui`'s `App.vue:877` handles
`ui.action` with `{ action: 'revealCommit', target: { repoId, sha } }` and
`revealCommitInGraph` (`:402`) opens the repo if needed and pages until the sha appears.
`transport.ts`'s local bus emits `ui.action` host-side (`:50`, `:150`) — Go never emits it.

**The affordance is an editor action, not a clickable annotation and not a trusted hover.**

- *Not a clickable annotation*: 0.56.0 cannot tell a click on injected text from a click past
  end-of-line (§3, point 3). A `closest('.kira-blame-inline')` listener on the editor's DOM node
  would work today, but it is app code reaching into a library's rendered markup for a hit-test the
  library declines to expose — precisely the shape `CLAUDE.md`'s library rule exists to avoid, with
  no requirement forcing it.
- *Not a trusted-hover command link*: `IMarkdownString.isTrusted` accepts
  `{ enabledCommands }` (`:751`, `:760`) and `mod.editor.registerCommand` exists (`:1418`), so it
  is technically available — but **C11 §13 already declined exactly this affordance on exactly this
  surface** ("CodeLens and trusted-hover command links … replaced by the glyph click and the editor
  action, not reproduced"). Re-introducing it for blame would make two neighbouring Monaco layers
  disagree about how a command is offered.
- *So*: `editor.addAction({ id: 'kira.blame.revealCommit', label: 'Open Blame Commit in Graph',
  contextMenuGroupId: 'kiraBlame', … })`, disposed with the handle — the identical lifecycle
  `kira.review.addComment`/`markReviewed`/`markUnreviewed` already use
  (`reviewDecorations.ts:528-550`). It reads the current line's cached blame and does nothing when
  there is none or when the sha is the uncommitted sentinel.

**The mount race, and the precedent that solves it.** `RepoGraphView.vue` unmounts on a tab switch
(`:55-58`), taking `App.vue`'s `ui.action` listener with it — so emitting the event from a file tab
would drop it. C11 hit the identical race for `review.target` and solved it with a pending-target
map consumed once on mount (`hostHandlers.ts:44`'s `pendingReviewTargetByCodeRepoId` /
`takePendingReviewTarget` at `:50`). This phase mirrors it exactly:

1. find the pinned graph tab (`tabsForWorkspace(key).find(t => t.kind === 'repo-graph')` — the
   one-line lookup `reviewSession.ts:23` already owns; export it rather than writing a second copy),
2. stash `{ repoId, sha }` in a `pendingRevealBySha`-shaped map,
3. `activateTab(graphTabId)` (`state/tabs.ts:695`),
4. emit `ui.action` on the transport anyway, for the case where the graph was already mounted.

`RepoGraphView.vue`'s `mount()` already has the seam for the cold case: `MountOptions.pendingUiAction`
(`git-ui/src/main.ts:42-45`, `{ action, target }`) is passed straight through today as nothing. It
gains the pending entry, consumed once — which is what that option was built for
(`panelView.ts`'s own bootstrap-island arm, per its doc comment).

---

## 5. Age and date formatting — reuse, not a third copy

`formatRelativeDate` exists three times in this repo's history of wanting it:

| Where | Why it is a copy |
| --- | --- |
| `packages/git-ui/src/components/dateFormat.ts:23` | the original, for the graph's date column |
| `apps/kira-studio-vscode/src/blameAge.ts:23` | P5's copy — its own doc comment names the reason: `@kira/git-ui`'s `exports` is `{".": "./src/index.ts"}` and the barrel pulls Vue into an extension-**host** bundle |
| (this phase would be the third) | — |

A third copy is not acceptable, and the native app cannot import the first one either — for a
*different* reason, checked directly: `@kira/git-ui` is behind a memoised dynamic import
(`repo/git/gitUiModule.ts`), and `repo/git/viewStateStore.ts:13-20` goes out of its way to keep its
git-ui import type-only precisely so the chunk stays lazy (C12-3: ~426 KB gzip otherwise back in
the eager bundle). A static value import from `RepoFileView.vue` would undo that.

**D2: move the two pure formatters to `@kira/git-core`.** `packages/git-core/src/util/dateFormat.ts`
gains `formatRelativeDate` and `formatAbsoluteDate` verbatim; `git-ui`'s
`components/dateFormat.ts` re-exports both and keeps `measureAbsoluteDateWidth` (canvas
measurement — DOM-bound, and git-core has no DOM dependency today; it stays where it is used).

This is genuinely free, not a bundle trade: `@kira/git-core` is **already eager** in the native app
— `reviewDecorations.ts:17-23` imports it statically, `RepoDiffView.vue:32` imports that, and
`workbench/tabViews.ts:13` imports that statically by design (`:18-21`'s own comment). Both packages
already declare `@kira/git-core` as a `workspace:*` dependency
(`apps/kira-studio/frontend/package.json:14`, `apps/kira-studio-vscode/package.json:29`).

Consequence worth taking in the same phase: **`blameAge.ts`/`blameAge.test.ts` are deleted** and
`blameState.ts:6` imports `formatRelativeDate` from `@kira/git-core` instead. The extension host
bundle already carries git-core (`blameWidget.ts:13` imports `nfcPath` from it), so the reason P5
gave for the copy is gone, not merely outweighed. One function, one home, three callers. If a human
would rather leave the extension untouched, OQ-2.

Test coverage follows the code, the same move C11 made for `reviewRanges.test.ts` (C11 §11):
`blameAge.test.ts`'s fixed-clock table and `dateFormat.test.ts`'s `formatAbsoluteDate` cases become
`packages/git-core/src/util/dateFormat.test.ts`; `dateFormat.test.ts` keeps its
`measureAbsoluteDateWidth` describe. No new test is written — existing ones move.

---

## 6. The settings toggle

`appearance.inlineBlame: z.boolean().default(true)` in
`packages/shared/domain/settings.ts`'s `appearanceSettingsSchema` (`:21-36`), beside `wordWrap`
(`:31`) and `rowColoring` (`:34`) — the same `.default(…)` discipline, so a settings row stored
before this field existed hydrates unchanged.

Why a toggle at all, when P5 shipped without one: the status-bar item was a line of chrome the user
could ignore; injected text sits *inside the code being read*, and it costs a `git blame` spawn per
rested line. A user who wants neither should not have to want them.

Surface: one `Checkbox` row in `SettingsDialog.vue`'s Appearance tab, copying the Word-wrap block
verbatim (`:570-591`) — `data-testid="settings-inline-blame"`, the `IconButton` reset affordance,
`isAtDefault`/`resetLeaf`. Helper text: *"Show who last changed the current line, at the end of that
line, in the repository file viewer."*

Live application: `RepoFileView.vue` watches `settingsState.appearance.inlineBlame` and
attaches/disposes the handle, so toggling takes effect without reopening the tab — matching how
`wordWrap` already applies live.

---

## 7. Files

**New**

```
packages/git-core/src/util/dateFormat.ts          formatRelativeDate + formatAbsoluteDate (moved, §5)
packages/git-core/src/util/dateFormat.test.ts     the moved cases (§5)
apps/kira-studio/frontend/src/views/repo/blameAnnotation.ts   the whole layer (§4)
apps/kira-studio/frontend/src/theme/blame-annotation.css      .kira-blame-inline (§4.4)
```

**Extended**

```
packages/git-core/src/index.ts                    export the two formatters
packages/git-ui/src/components/dateFormat.ts      re-export them; keep measureAbsoluteDateWidth
packages/git-ui/src/components/dateFormat.test.ts keep only the measure describe
packages/shared/domain/settings.ts                appearance.inlineBlame (§6)
apps/kira-studio/frontend/src/workbench/SettingsDialog.vue    one checkbox row (§6)
apps/kira-studio/frontend/src/theme/base.css                  one @import
apps/kira-studio/frontend/src/views/repo/RepoFileView.vue     attach/dispose + the settings watch
apps/kira-studio/frontend/src/views/repo/RepoGraphView.vue    pendingUiAction pass-through (§4.5)
apps/kira-studio/frontend/src/repo/git/reviewSession.ts       export pinnedGraphTabId (§4.5)
apps/kira-studio-vscode/src/blameState.ts                     import from @kira/git-core (§5)
```

**Deleted**

```
apps/kira-studio-vscode/src/blameAge.ts
apps/kira-studio-vscode/src/blameAge.test.ts
```

**Untouched, and that is the point**: every Go file, `packages/git-ipc/**`,
`internal/bridge/gitstream.go`, both `ContractVersion` constants.

---

## 8. Implementation steps

Sequential; one commit per numbered step unless stated. One Sonnet subagent, whole phase — the
steps are order-dependent (nothing here is parallelizable).

1. **`refactor:` move `formatRelativeDate`/`formatAbsoluteDate` to `@kira/git-core`** (§5) — the
   git-ui re-export, the index export, the test move, the git-ui test trim. `bun test` green before
   anything else lands on it.
2. **`refactor:` delete `blameAge.ts`/`blameAge.test.ts`**; `blameState.ts` imports from
   `@kira/git-core` (§5). `bun run typecheck` covers the extension project.
3. **`feat:` `appearance.inlineBlame` schema field + the Settings checkbox** (§6). Landing it first
   means step 4 can read the real setting rather than a placeholder.
4. **`feat:` `views/repo/blameAnnotation.ts` + `theme/blame-annotation.css`** (§4.1-§4.4) — the
   whole layer except click-through: attach/dispose, repo hold, debounce/dedupe/cache/abort,
   `repo.changed` invalidation, the three render states. Largest step; may land as two commits
   (request lifecycle, then rendering) but is one continuous piece of work.
5. **`feat:` wire it into `RepoFileView.vue`** — attach after editor creation, dispose in
   `onUnmounted`, watch the setting.
6. **`feat:` click-through** (§4.5) — the editor action, the pending-reveal map, `pinnedGraphTabId`
   exported from `reviewSession.ts`, `activateTab`, and `RepoGraphView.vue`'s `pendingUiAction`
   pass-through.
7. **`test:`** the UI spec (§9).
8. **`docs:`** `docs/ARCHITECTURE.md` (§10), and `docs/v1.6/mcp-repo-map-issues.md` with whatever
   dogfooding turns up.

Fast checks per commit (`bun run typecheck`, `bun run lint`, `bun run build`). The expensive suites
run once, near the end (§12), per `CLAUDE.md`.

---

## 9. Testing

`CLAUDE.md`'s bar: a dedicated unit test only for genuinely hard logic. **This phase writes no new
unit test**, and that is a considered answer, not an omission:

- `blameAnnotation.ts` is editor wiring — a debounce timer, a `Map`, a decorations `.set()`, an
  abort guard. Every piece restates a short function body. It is the same category C11 §11 declined
  for `reviewDecorations.ts`, on the same surface, for the same reason.
- The one piece with real arithmetic, `formatRelativeDate`, **already has a fixed-clock table test**
  — it moves with the code (§5) and, landing in `@kira/git-core`, covers the native app's use of it
  for the first time.
- The parser it all depends on is tested where it belongs and is untouched:
  `internal/gitclient/porcelain/blame_test.go` (three golden fixtures plus the unknown-attribute
  case), `internal/gitsession/queries_test.go`, `internal/gitrpc/detail_test.go`.
- `gitstream_test.go`'s allowlist tables are unchanged because the allowlist is unchanged.

**One UI test**, `tests/ui/repo-workspace.spec.ts` — deliberately shallow, matching C11's own call
there. `tests/ui/` has no git-stream mock at all (`support/mockStream.ts` serves the engine stream's
FlatBuffers protocol only; no spec mounts the graph), so a spec cannot assert a real blame answer
without building a git-stream fixture, which is its own piece of work and not this row's. What the
spec *can* assert, and should:

- with `inlineBlame` on and no git record for the repository, a repo-file tab still renders its
  editor and no annotation — the `gitRepoIdFor === undefined` guard (§4.1) is honest, not a crash,
- toggling `settings-inline-blame` off and on leaves the editor mounted and healthy.

Everything deeper is §12's manual recipe against a real repository. Stated plainly rather than
padded with a spec that would only assert the mock.

---

## 10. Documentation to update

- `docs/ARCHITECTURE.md`, the C10/C11 native-workspace run: a short subsection after "Code review,
  ported natively (C11)" — where blame surfaces and why not the status bar (LAW 14), that it is the
  same `blame.line` the extension's status bar uses with no contract change, the repo-hold
  requirement, and that whole-file blame is deliberately not built (§2.3).
- `docs/ARCHITECTURE.md`'s "Known open items": add nothing unless §2.3 is judged a genuine
  standing limitation rather than a scoping decision (it is a scoping decision — do not add it).
- `docs/v1.6/mcp-repo-map-issues.md` — the dogfooding line for this phase.

---

## 11. Explicitly out of scope

- **Whole-file / gutter blame** (§2.3). Needs a new Go method, parser, contract bump and allowlist
  entry — a different phase.
- **Blame on any diff surface.** The HEAD-vs-worktree diff's modified pane *is* the working tree and
  would be correct, but its whole purpose is showing what changed since HEAD, where per-line
  authorship of the committed side is noise; the commit and review diffs show historical revisions
  `blame.line` structurally cannot answer for (no `atSha`, §1.1). Left out entirely rather than
  enabled on one diff mode out of three.
- **Blaming a dirty buffer.** Structurally impossible here — the file view is read-only (§4.3).
- **Any new git invocation, wire method, or contract field.** SPEC's premise, held (§0).
- **Wiring the status bar's caret readout** (LAW 14's "not yet wired per-view"). Real, unrelated.
- **A blame-annotation hover that opens the commit detail pane.** `commit.detail` exists and is
  allowlisted, but rendering a detail pane from a file tab is a second surface, not an annotation.

---

## 12. Verification

### 12.1 Mechanical

```
bun run typecheck      # all five projects
bun run lint
bun run build
bun run test:unit      # the moved dateFormat cases
bun run test:ui
bun run test:visual    # Settings Appearance tab gains a row — review the diff, don't blind-update
bun run test:webview
go build ./... && go vet ./...   # must be a no-op diff: no Go file is touched
```

Then confirm `git diff --stat` names **no** file under `apps/kira-studio/internal/`,
`packages/git-ipc/`, and that both `ContractVersion` constants still read 35.

### 12.2 Manual recipe (a real repository, `bun run dev`)

1. Open a repo workspace on a repository with real history. Graph tab mounts.
2. Open a tracked file from the file tree. Put the cursor on a committed line → the annotation
   appears at end of line after ~150 ms, muted, `author, age · subject`.
3. Hold ↓ through 30 lines → **one** annotation at a time, and far fewer than 30 requests
   (debounce). Arrow back up over already-blamed lines → instant, no new request.
4. Hover the annotation → summary, author, absolute date.
5. Context menu on that line → *Open Blame Commit in Graph* → the graph tab activates and selects
   that commit.
6. Do the same from a file tab **after** switching away from the graph tab at least once → still
   works (the pending-reveal path, §4.5).
7. `echo "x" >> <file>` on disk, then open that file fresh: the appended line reads `Uncommitted`.
8. Open an untracked file → no annotation, no error, no console noise.
9. Settings → Appearance → uncheck Inline blame → annotation disappears from the open tab
   immediately; re-check → it comes back.
10. Open a repo workspace for a repository this window has no git record for → file viewer works,
    no annotation, no error.
11. Confirm no regression on the surfaces this touches: review diff glyphs and threads still paint;
    the graph's date column still renders relative/absolute (the §5 move).
12. DevTools Network: opening a file tab still fetches `monacoEntry-*.js` and **not** the git-ui
    chunk (§5's whole reason).

### 12.3 Checklist

- [ ] No Go, `git-ipc` or `gitstream.go` change; both contract versions still 35.
- [ ] `formatRelativeDate` exists exactly once in the repo (`packages/git-core/src/util/`).
- [ ] `blameAge.ts`/`blameAge.test.ts` gone; extension still typechecks and `bun test` green.
- [ ] Eager `index-*.js` raw+gzip recorded against P61's landed baseline; git-ui still lazy.
- [ ] Annotation never shifts the glyph grid (§3, point 2) — check against a line with tabs.
- [ ] Disposing a file tab disposes the decorations collection, the action, the cursor
      subscription, the `repo.changed` unsubscribe and any pending timer/abort
      (`tests/ui/leaks.spec.ts`).
- [ ] A repo-map MCP `tools/call` answered correctly during the phase; logged.

---

## 13. Open questions for a human

**OQ-1 — whole-file blame.** §2.3: the existing API is one spawn per line, so a gutter column for
every line is real backend work (new parser, new method, contract bump, allowlist entry) that
SPEC's P62 row explicitly says this phase does not do. The cursor-line annotation is the honest
shape for the API that exists. *Recommendation: ship the annotation; raise whole-file blame as its
own row if it is wanted.*

**OQ-2 — touching the extension in §5.** Deleting `blameAge.ts` and pointing `blameState.ts` at
`@kira/git-core` removes the second copy of `formatRelativeDate` and keeps this phase from adding a
third. It is two small edits in a package this row is otherwise not about. *Recommendation: do it —
the reason P5 gave for the copy (git-ui's barrel pulls Vue into a host bundle) is genuinely void
once the function lives in git-core, which that host bundle already imports.*

**OQ-3 — annotation content.** `<author>, <age> · <subject>` is P5's status-bar text plus the
subject, since a full line has room a status bar does not. The subject is also the noisiest part.
Alternatives: author+age only (quieter), or subject only. *Recommendation: keep all three, clamped
(§4.4) — the subject is what makes the annotation answer "why", and the hover would otherwise carry
the only thing worth reading.*

**OQ-4 — default on.** §6 defaults `inlineBlame` to `true`. It costs a `git blame` spawn per rested
line for every user of the file viewer, and it is opinionated chrome inside the code. *Recommendation:
default on — an off-by-default annotation nobody discovers is not shipped — but this is a product
call, not a technical one.*
