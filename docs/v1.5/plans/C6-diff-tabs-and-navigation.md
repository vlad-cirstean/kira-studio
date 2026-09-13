# C6 — Diff tabs and code navigation

> **What this phase is.** `docs/v1.5/SPEC.md`'s C6 row turned into steps, researched against the real
> tree at `28ef7386` — C5 as it actually shipped (`baf364a3..28ef7386`), not as its own plan predicted
> it. Everything below was checked against source: `internal/codeworkspace/` (session/files/paths),
> `internal/bridge/codeworkspace.go`, `internal/codeindex/` (Open/Sync/Watch/Store),
> `internal/codegraph/` (DefinitionOf/SymbolAt/Query/Target), `internal/repomap/` (its index
> lifecycle and per-repository sync flock), `internal/gitclient/catfile/`, the frontend's
> `state/tabs.ts`/`state/mode.ts`/`state/tabKinds.ts`/`views/repo/*`/`repo/*`, and
> `node_modules/monaco-editor` at the pinned 0.56.0.

## 0. What C5 actually shipped, and what C6 inherits

C5's plan is a historical record; these are the facts C6 builds on, read from code:

- `codeworkspace.Session` is `{RepoID, Root, Runner, GitPath}` and is **rebuilt on every bound-service
  request** (`Registry.Open` replaces the map entry unconditionally). C6 changes that — an `Index`,
  a `Watcher` and a `catfile.Session` cannot be reconstructed per request.
- `CodeWorkspaceService` has six methods (ListRepos, ImportRepo, RenameRepo, RemoveRepo, ListFiles,
  ReadFile) and holds `Registry` explicitly "reserved for C6".
- Monaco is reached through `views/repo/monacoEntry.ts` — `monaco-editor/editor/editor.api.js` plus
  `monaco-editor/features/register.all.js` (**not** `edcore.main.js`, which does not exist in 0.56.0).
  One worker, `monaco-editor/editor/editor.worker.js?worker`, wired under label
  `editorWorkerService`; any other label throws.
- `views/repo/monaco.ts` owns `loadMonaco()` (memoised), the `kira-repo` theme, and a
  `Map<string, ITextModel>` model cache keyed by `repoFileUri(repoId, path)` =
  `` `kira-repo://${repoId}/${path}` `` — built by **string interpolation**, see D6.
- `views/repo/editors.ts` is the tabId-to-editor registry: `registerEditor`/`unmountEditor`/
  `dropRepoFileTab`/`editorForTab`.
- `tabsForWorkspace` (commit `28ef7386`) computes a real stable partition — pinned kinds first, then
  the rest — so a new non-pinned kind needs no insertion-order care at all.
- `TAB_KINDS` entries carry `mode/title/icon/railColor/defaultState/parseState/duplicateState/
  dropResources/menuExtras` plus optional `badge`/`pinned`.
- The tree's status map is `FileListing.Status`, four values `M`/`A`/`D`/`?`, present on
  `RepoTreeRowVm.status`.

## 1. What SPEC left open, and how each is resolved

**D1 — The byte-to-UTF-16 conversion lives in Go, in `internal/codeworkspace`, not in the renderer.**
`codegraph` speaks bytes and byte columns; `internal/repomap/render.go` states plainly why it cannot
convert ("this server never reads file bytes"). The workspace service *does* read file bytes already
(`ReadFile`), so it is the one place that can convert honestly. One implementation, in Go, testable
(§4). The renderer sends Monaco's own 1-based line plus 1-based UTF-16 column and receives the same
shape back — it never sees a byte offset.

**D2 — The query is `Query.Byte`, not `Query.Point`.** `codegraph`'s `resolveHit` gives the byte path
one extra rule the point path does not have: `innermostReferenceNode`, the fallback that makes a
Java `method_invocation` or a JavaScript member call resolve when the cursor is on the method name
but the stored reference range starts at the receiver. That is exactly the case `docs/ARCHITECTURE.md`
names as a limit. Using `Point` (repomap's own choice, forced on it by having no bytes) would
silently drop it. Cost: one absolute byte offset instead of a row-plus-column pair, which the line
index in §4 answers for free.

**D3 — No `references`/`implementations` providers.** SPEC's out-of-scope list. Only
`registerDefinitionProvider` and `registerHoverProvider`.

**D4 — `gotoLocation.multipleDefinitions: 'goto'`, so Monaco never opens its peek widget for a
multi-candidate result.** Verified in 0.56.0's `monaco.d.ts` (`IGotoLocationOptions`,
`GoToLocationValues = 'peek' | 'gotoAndPeek' | 'goto'`; the default for definitions is `peek`). This
matters for a concrete reason, not taste: standalone Monaco's peek preview resolves each result
through `ITextModelService`, which in the standalone build only finds *already-created* models — a
cross-file candidate with no open tab would render an empty preview pane. `'goto'` jumps to the
first (best-ranked) candidate through the editor opener instead, which needs no model at all.
**Honesty is preserved by the hover**, which lists every candidate with its own `Rule` and
`Confidence`, exactly as `internal/repomap/render.go` prints them. Stated plainly rather than
pre-creating throwaway models with a disposal policy nobody asked for.

**D5 — One bound method answers both providers.** Hover and definition ask the identical question
("what does the name at this position refer to"). `Definitions` returns the resolved name plus every
`Target`; the definition provider maps them to `Location[]`, the hover provider renders them as
markdown. No second Go path, no second conversion.

**D6 — Model URIs are built with `Uri.from`, not string interpolation.** C5's
`` `kira-repo://${repoId}/${path}` `` is fine while nothing parses it back, but C6 must go the other
way: the editor opener receives a `Uri` and has to recover `(repoId, path)`. A path containing a
space, `#`, `?` or `%` does not survive that round trip today. `Uri.from({scheme, authority, path})`
escapes correctly and `uri.authority`/`uri.path` give the decoded values back. Changing it costs
nothing persisted (the model cache is in-memory).

**D7 — Navigability is a WeakMap keyed by the model object, not a URI-shape check.** `monaco.ts`
records `model -> {repoId, path}` when it creates a navigable model. The diff editor's **HEAD side
is deliberately not recorded**: its content is a different revision than the index describes, so
answering a definition there would be a lie. The diff's worktree side *is* recorded — it is
byte-identical to the file the index parsed.

**D8 — Index readiness is reported, never waited on.** `repomap.Server.waitReady` blocks a tool call
up to 25s, correct for an agent with no UI. A hover that hangs 25s is not. `Definitions` checks the
readiness channel non-blocking and returns `status: "indexing"` immediately; the hover then says
"Code index is still building", and the next dwell asks again.

**D9 — "Open changes" opens a permanent tab, never the preview slot.** A single tree click already
owns the preview slot for the file viewer; a context-menu action is deliberate, so it behaves like
the menu's existing "Open" (permanent).

**D10 — The diff tab carries no session state.** `repoDiffTabStateSchema` is `z.object({})`, like
`repo-graph`. A restored diff tab re-reads both sides and opens at Monaco's own first change, which
is where a diff is read from anyway. `repo-file`'s `revealLine` exists because a file is scrolled
through; a diff is navigated by change, not by line.

**D11 — The per-repository sync flock moves from `internal/repomap` into `internal/codeindex`.**
C6 needs the identical discipline (`${KIRA_HOME}/codeindex-sync-<slug>.lock`, `LOCK_EX` around the
initial `Sync` only, timeout degrades rather than hangs). Copying 70 lines of flock into a third
package fails `CLAUDE.md`'s reuse rule; `internal/codeworkspace` importing `internal/repomap` (an
MCP protocol server) is a wrong dependency. The lock belongs beside the thing it protects — the
index — so it moves there and `repomap` calls it.

**D12 — No status field on the diff wire.** The diff's two sides already say what happened (HEAD
missing means added, worktree missing means deleted, both present means modified). A second
`git status` spawn per diff open to restate that would be cost for nothing.

## 2. Where the code lives

```
internal/codeindex/
  synclock_unix.go        moved from repomap/lock_unix.go, exported (S1)
  synclock_other.go       moved from repomap/lock_other.go
  synclock_unix_test.go   moved from repomap/lock_unix_test.go
internal/codeworkspace/
  session.go              extended: index, graph, watcher, catfile, readiness (S3)
  index.go                NEW  EnsureIndex / IndexStatus / Close (S3)
  textpos.go              NEW  LineIndex, the byte/UTF-16 conversion (S2)
  textpos_test.go         NEW  the one unit test this phase earns (S2)
  diff.go                 NEW  ReadDiff, HEAD-vs-worktree (S4)
  nav.go                  NEW  Definitions (S5)
internal/bridge/
  codeworkspace.go        +OpenWorkspace, CloseWorkspace, ReadDiff, Definitions, Shutdown (S6)
main.go                   store construction, service hoist, teardown (S6)
packages/shared/domain/
  tabs.ts                 'repo-diff' kind, schema, record type (S7)
  repo.ts                 diff and navigation wire schemas (S7)
internal/storage/model/tabs.go   'repo-diff' in RenderableTabKinds (S7)
frontend/src/bridge/index.ts     four control methods (S8)
frontend/src/views/repo/
  monaco.ts               Uri.from, location WeakMap, diff model helpers (S9)
  editors.ts              widened for a diff entry (S10)
  RepoDiffView.vue        NEW  the diff editor mount (S11)
  RepoFileView.vue        gotoLocation option, navigation registration (S12)
  navigation.ts           NEW  providers + editor opener (S12)
frontend/src/state/
  tabKinds.ts             'repo-diff' entry (S10)
  repoTabs.ts             openRepoDiffTab (S10)
  workspace.ts            index start/stop calls (S14)
frontend/src/repo/menus.ts       "Open changes" (S13)
frontend/src/workbench/tabViews.ts  TAB_VIEWS['repo-diff'] (S10)
frontend/src/main.ts             index start for restored workspaces (S14)
tests/ui/support/mockRuntime.ts  four channel names (S8)
tests/ui/repo-workspace.spec.ts  one diff-tab case (S16)
```

## 3. The index lifecycle

### 3.1 The shared store

One `*codeindex.Store` per process for this service, constructed in `main.go`
(`codeindex.OpenStore()`, which opens nothing until first use — `db.go`'s `ensureOpen`) and closed
in `teardown` beside `repositories.Close()`. The embedded repo-map server keeps opening its **own**
`Store` over the same file; two pools in one process are exactly what WAL plus `_busy_timeout=5000`
(already in `buildDSN`) exist for, and the alternative — threading one Store through
`RepoMapService`'s own start/stop lifecycle — couples two independent features for no gain.

### 3.2 The session, extended

`codeworkspace.Session` grows, keeping C5's four fields verbatim:

```go
type Session struct {
    RepoID  string // code_repos.id
    Root    string
    Runner  gitclient.Runner
    GitPath string

    // C6. IndexRepoID is gitclient's own RepoSummary.RepoID (code_repos.repo_id) — codeindex and
    // codegraph are keyed by that, never by code_repos.id.
    IndexRepoID string

    mu      sync.Mutex
    index   *codeindex.Index
    graph   *codegraph.Graph
    watcher *codeindex.Watcher
    catfile *catfile.Session
    ready   chan struct{}   // closed when the initial Sync has finished, success or not
    cancel  context.CancelFunc
}
```

`Registry.Open` changes from "replace unconditionally" to "reuse when nothing that matters changed":
if a session exists for `repoID` **and** its `Root` and `GitPath` are unchanged, return it; otherwise
`Close()` the old one and build a new one. This keeps C5's stated property (a `git.path` change takes
effect on the next call, with no explicit reopen) while not tearing down a live index and two
`cat-file` processes on every tree refresh.

`Registry.Close(repoID)` now has real work: `session.Close()` before dropping the map entry.
`Registry.CloseAll()` is new, for process teardown.

### 3.3 Start

`(*Session).EnsureIndex(store *codeindex.Store, home string, log *slog.Logger)` — idempotent, returns
immediately:

1. Under `s.mu`, if `s.index != nil` return.
2. `idx := codeindex.Open(store, s.Runner, s.GitPath, s.IndexRepoID, s.Root)`;
   `graph := codegraph.New(store, s.IndexRepoID)`; `s.ready = make(chan struct{})`;
   `ctx, s.cancel = context.WithCancel(context.Background())`.
3. Background goroutine, a direct port of `repomap.Server.runInitialSync`:
   `lock, acquired, err := codeindex.AcquireSyncLock(home, s.IndexRepoID, codeindex.DefaultSyncLockTimeout)`;
   log a non-acquisition at debug and proceed anyway; `idx.Sync(ctx)`; release the lock; log stats or
   the error; `close(s.ready)` exactly once **regardless of outcome** (a failed sync opens the gate
   with a partial index, which is honest; it must never hang).
4. `w, err := idx.Watch()` — a watcher failure is logged, never fatal, same posture as `repomap`.

Callers: the `OpenWorkspace` bound method (the warm-up path), **and** `Definitions` itself, so a
navigation request that somehow arrives first is still correct without `OpenWorkspace` ever having
been called. `ListFiles`/`ReadFile` deliberately do **not** call it — a tree refresh must not start
parsing a repository nobody is navigating.

The lock discipline is the whole point of reusing `repomap`'s: the desktop app and a headless
`bun run mcp:repo-map` (or the embedded MCP instance, which resolves this repository during
dogfooding) must never parse one repository's initial sync twice. Same path, same timeout, same
degrade-never-hang rule.

### 3.4 Stop

`(*Session).Close()`: `s.cancel()`, `watcher.Close()`, `index.Close()`, `catfile.Close()`, nil
everything out. Idempotent (`sync.Once`).

Three stop points, all real:

- `CloseWorkspace(id)` — from `closeRepoWorkspace(repoId)` in `state/workspace.ts`.
- `RemoveRepo(id)` — already calls `Registry.Close`, which now stops everything.
- Process teardown — `main.go`'s `teardown` calls `codeWorkspaceSvc.Shutdown()` (`Registry.CloseAll()`
  then `store.Close()`), beside the existing `bridge.StopRepoMap(repoMapSvc)`.

Nothing else. In particular there is no idle timer and no refcount: a workspace is open or it is not,
which is exactly the granularity `workspaceState.openRepos` already tracks.

## 4. Byte and UTF-16 conversion (`textpos.go`)

One type, two directions, five rules. This is the piece SPEC's C1 row deferred to "a later phase".

```go
// LineIndex is one file's own byte content plus the byte offset each line starts at.
type LineIndex struct { data []byte; starts []int }

func NewLineIndex(data []byte) *LineIndex
func (li *LineIndex) LineCount() int
// ByteOffset maps Monaco's 1-based line and 1-based UTF-16 column to an absolute byte offset.
func (li *LineIndex) ByteOffset(line, column int) int
// Position maps codegraph's 0-based row and byte column to Monaco's 1-based line and column.
func (li *LineIndex) Position(row, byteColumn int) (line, column int)
```

**Rule 1 — lines split on `\n` only.** `starts[0] = 0`, then one entry after each `\n`. A `\r` before
a `\n` stays part of the preceding line's bytes, which is exactly what tree-sitter counts too, so a
byte column from `codeindex` and a byte offset computed here agree on a CRLF file. Monaco's line
content excludes the EOL entirely, so a Monaco column can never address the `\r`; both directions
clamp at the line's last non-EOL byte.

**Rule 2 — one UTF-16 unit per BMP rune, two per rune above U+FFFF.** Decode forward with
`utf8.DecodeRune`; add `1` for a rune `<= 0xFFFF`, `2` otherwise. A column that lands *between* the
two halves of a surrogate pair (possible only from a malformed client position) clamps to the pair's
first byte — never to its second byte, which is not a rune boundary at all.

**Rule 3 — an invalid UTF-8 byte is exactly one UTF-16 unit.** This is not a guess about Monaco; it
is what the buffer actually contains. `ReadFile` returns `string(data)`, and `encoding/json` replaces
each invalid byte with one U+FFFD when that string crosses the bridge, so the renderer's model has
one code unit where the file has one invalid byte. `utf8.DecodeRune` returns `RuneError` with
`size == 1` for exactly those bytes, so the same loop gives the same answer with no special case.

**Rule 4 — a tab is one UTF-16 unit, never expanded.** Monaco's `IPosition.column` is a code-unit
index; display/visible columns are a separate concept (`tabSize`, `getLineLastNonWhitespaceColumn`)
that never crosses this boundary. Written down because assuming otherwise is the obvious mistake.

**Rule 5 — clamping, never erroring.** `line < 1` clamps to 1, `line > LineCount()` to `LineCount()`,
`column < 1` to 1, a column past end-of-line to end-of-line, a byte offset to `[0, len(data)]`.
A position arriving from a model that has drifted from disk is a stale answer, not a fault; the
conversion must always produce *some* in-range position.

**The honest limit, stated in the code:** the bytes converted against are the file on disk *now*.
If the worktree file changed after the tab opened, positions are computed against the newer bytes
while Monaco shows the older ones. The watcher keeps the index fresh on the same signal, so the two
converge; a hover in the drift window can be off by a line.

## 5. Reading a diff (`diff.go`)

```go
type DiffSide struct {
    Kind       string `json:"kind"` // found | binary | tooLarge | missing
    Text       string `json:"text"`
    Bytes      int    `json:"bytes"`
    LimitBytes int    `json:"limitBytes"`
}
type DiffContent struct {
    Path     string   `json:"path"`
    Language string   `json:"language"`
    Head     DiffSide `json:"head"`
    Worktree DiffSide `json:"worktree"`
}
func ReadDiff(ctx context.Context, s *Session, relPath string) (DiffContent, error)
```

- **Worktree side**: `ValidateRelPath` then the existing `ReadFile`, projected into `DiffSide`. No
  second classification path — `missing`, `binary` and `tooLarge` keep the identical meanings the
  file viewer already gives them.
- **HEAD side**: the session's lazily-constructed `catfile.Session`
  (`catfile.NewSession(catfile.Deps{Runner, GitPath, Dir: s.Root}, MaxReadBytes)` — the same 8 MiB
  gate as the worktree side rather than catfile's own 10 MiB default, so the two sides can never
  disagree about what is too large). `rev := "HEAD:" + relPath`; if `rev` contains a `\n`, use
  `ReadOneShot(ctx, rev)`, else `Read(rev)` — the exact guard `gitsession.Blob` carries and the
  security finding recorded in its own comment (a newline anywhere in the request desynchronises the
  one-line-in/one-line-out batch protocol for the life of the session). `catfile.ErrMissing` maps to
  `missing` (a new file, an untracked file, or an unborn `HEAD` — all "no original"), `ErrTooLarge`
  to `tooLarge`, a NUL in the first 8 KiB to `binary`.
- **Language**: the existing `languageFor(relPath)`, once, for both sides.
- Read-only holds: `catfile` spawns `cat-file --batch`/`--batch-check` only, and `gitclient.Run`
  is never reached from here with anything but those.

## 6. Navigation (`nav.go`)

```go
type NavTarget struct {
    Path       string `json:"path"`
    Language   string `json:"language"`
    Kind       string `json:"kind"`
    Name       string `json:"name"`
    Container  string `json:"container"`
    Rule       string `json:"rule"`       // codegraph's own, e.g. "sameFile.enclosing"
    Confidence string `json:"confidence"` // exact | scoped | repoWide
    // The identifier's own span, 1-based line, 1-based UTF-16 column — a Monaco IRange as-is.
    StartLine, StartColumn, EndLine, EndColumn int
}
type NavResult struct {
    Status  string      `json:"status"` // ready | indexing | unavailable
    Name    string      `json:"name"`
    Targets []NavTarget `json:"targets"`
}
func Definitions(ctx context.Context, s *Session, store *codeindex.Store,
                 relPath string, line, column int) (NavResult, error)
```

Sequence:

1. `ValidateRelPath(s.Root, relPath)` — the same §11 boundary every other path crosses.
2. Readiness: non-blocking `select` on `s.ready`. Not closed yet gives
   `NavResult{Status: "indexing"}` and returns (D8).
3. `store.GetFile(ctx, s.IndexRepoID, relPath)` — no row means this file is not in the index (an
   unparsed language, a file over C1's 2 MiB parse cap, a path added since the last sync). Return
   `Status: "unavailable"`. Checked by a real lookup rather than by string-matching
   `codegraph.loadFile`'s error text.
4. Read the file's bytes, `NewLineIndex`, `off := li.ByteOffset(line, column)`.
5. `s.graph.DefinitionOf(ctx, codegraph.Query{Path: relPath, Byte: off})` — `Point` nil, `Byte` set
   explicitly (its zero value is a meaningful offset, so it is never left defaulted).
6. Convert every `Target.NameSpan` back through a `LineIndex` for **that target's** file, memoised in
   a `map[string]*LineIndex` for the call (`DefinitionOf` caps at 16 candidates, and several usually
   share a file). A target file that cannot be read falls back to `line = Row+1, column = 1` rather
   than failing the whole call.
7. `Name` is the resolved name; `Targets` carries `Rule` and `Confidence` through untouched — the
   renderer renders them (§8.2), following `internal/repomap/render.go`'s discipline that a
   `repoWide` guess must never read like a fact.

Cost, stated rather than hidden: one `os.ReadFile` of the hovered file per call, plus one per
distinct target file. Bounded by the 8 MiB viewer cap, served from the OS page cache in practice,
and gated behind Monaco's own hover delay. No cache, because a cache here would need an invalidation
rule keyed on mtime and would be the only such rule in this package.

## 7. The bound service

Four new methods on `CodeWorkspaceService`, which also gains two fields: `IndexStore *codeindex.Store`
and `Home string` (`config.KiraHome()`, injected the way `repomap.Config.Home` already is, so a test
can point it elsewhere).

```go
func (s *CodeWorkspaceService) OpenWorkspace(ctx context.Context, args CodeWorkspaceIDArgs) error
func (s *CodeWorkspaceService) CloseWorkspace(args CodeWorkspaceIDArgs) error
func (s *CodeWorkspaceService) ReadDiff(ctx context.Context, args CodeWorkspaceReadFileArgs) (codeworkspace.DiffContent, error)
func (s *CodeWorkspaceService) Definitions(ctx context.Context, args CodeWorkspaceDefinitionArgs) (codeworkspace.NavResult, error)

type CodeWorkspaceDefinitionArgs struct {
    ID     string `json:"id"`
    Path   string `json:"path"`
    Line   int    `json:"line"`   // 1-based
    Column int    `json:"column"` // 1-based, UTF-16
}
```

`OpenWorkspace` resolves the session through the existing `session()` helper (which now also fills
`IndexRepoID` from `repo.RepoID`) and calls `EnsureIndex`. It returns as soon as the goroutine is
started — the initial sync of a large repository takes far longer than an IPC call may.
`CloseWorkspace` calls `Registry.Close(args.ID)`. `Shutdown()` (not bound; called from `main.go`)
closes every session and the store.

**Read-only is unchanged and still enforced in three places.** No method here writes; every git
invocation still goes through `internal/codeworkspace` with `ReadOnly: true`; the diff editor's own
write affordances are disabled explicitly (§8.1).

## 8. The renderer

### 8.1 The diff tab

**Vocabulary — six places, one Go and five TypeScript.** `tabKindSchema`, `RENDERABLE_TAB_KINDS`,
`TAB_KIND_MODE` (`'repo-diff': 'repo'`), `tabRecordSchema`'s union, and Go's
`model.RenderableTabKinds`. `tests/unit/go-ts-vocabulary-parity.spec.ts` catches the Go miss, which
is the one TypeScript cannot.

**State**: `repoDiffTabStateSchema = z.object({})`, `defaultRepoDiffTabState()`,
`RepoDiffTabRecord` (D10).

**`TAB_KINDS['repo-diff']`**, mirroring `'repo-file'`'s shape exactly:

- `title`: the basename plus `" (Working Tree)"` — `tabTitle`'s `pathTail` cannot parse a plain
  repository-relative path, the same reason `repoFileTitle` exists.
- `icon`: `'git-compare'`.
- `railColor`: `() => undefined`. `defaultState`/`duplicateState`: `{}`.
- `dropResources`: `dropRepoDiffTab(tabId)` (§8.3).
- `menuExtras`: `() => []`. No `badge`, no `pinned` — a read-only tab, `definition`'s own precedent.

**`TAB_VIEWS['repo-diff'] = RepoDiffTabView`**, one line beside the other two.

**Opening**: `openRepoDiffTab(repoId, path)` in `state/repoTabs.ts`, beside `openRepoFileTab`, calling
`openTab('repo-diff', null, path, defaultRepoDiffTabState, { reuse: true, workspaceId:
repoWorkspaceKey(repoId), preview: false })`. `openTab`'s dedupe key is
`(workspaceId, kind, connectionId, path)`, so a diff tab and a file tab for the same path coexist and
a second "Open changes" activates the existing one. No new tab-opening mechanism (SPEC's explicit
requirement, applied to the diff as well as to jumps).

**`RepoDiffView.vue`**, modelled on `RepoFileView.vue` line for line:

```ts
const mod = await loadMonaco();
const [headUri, worktreeUri] = repoDiffUris(mod, repoId, path);
const original = getOrCreateModel(mod, headUri, diff.head.text, language);
const modified = getOrCreateModel(mod, worktreeUri, diff.worktree.text, language);
const editor = mod.editor.createDiffEditor(container.value, {
  theme: REPO_THEME_NAME,
  readOnly: true,
  domReadOnly: true,
  originalEditable: false,
  renderMarginRevertIcon: false,
  renderGutterMenu: false,
  automaticLayout: true,
  renderSideBySide: true,
  ignoreTrimWhitespace: false,
  hideUnchangedRegions: { enabled: true },
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontFamily: settingsState.appearance.fontFamily,
  fontSize: settingsState.appearance.fontSize,
});
editor.setModel({ original, modified });
```

Every one of these was verified against `node_modules/monaco-editor/monaco.d.ts` at 0.56.0:
`editor.createDiffEditor(domElement, IStandaloneDiffEditorConstructionOptions)` returns
`IStandaloneDiffEditor`; `setModel(IDiffEditorModel | IDiffEditorViewModel | null)` takes
`{original, modified}`; `readOnly`/`domReadOnly` come from `IEditorConstructionOptions`, which
`IDiffEditorConstructionOptions` extends, and apply to both panes; `originalEditable`,
`renderMarginRevertIcon`, `renderGutterMenu`, `renderSideBySide`, `ignoreTrimWhitespace` and
`hideUnchangedRegions` are all `IDiffEditorBaseOptions` members. The contribution is registered:
`features/register.all.js` imports `editor/browser/widget/diffEditor/diffEditor.contribution.js`.

`renderMarginRevertIcon: false` and `renderGutterMenu: false` are **not cosmetic** — both surface
revert/apply affordances, which are writes into a buffer this chapter forbids. `readOnly` already
blocks the mutation; hiding the affordance is the second layer, and the reason each is spelled out
rather than left at its default.

`diffAlgorithm` is deliberately left unset, taking the pinned default. Never `'advanced-wasm'` or
`'advanced-external'` — both resolve an external computer this bundle does not ship
(`linesDiffComputers.getAdvancedWasm`).

Non-`found` sides render an `EmptyState` instead of the editor: binary either side ("This file is
binary and can't be compared."), too large either side ("This file is too large to compare (over
8 MB)."), both sides missing ("This file no longer exists."). A missing HEAD side with a found
worktree side is *not* an error — it is an added file, and renders as a diff against empty.

### 8.2 The providers

`views/repo/navigation.ts`, a new module with one memoised `ensureNavigationRegistered(mod)` called
from `RepoFileView.vue`'s and `RepoDiffView.vue`'s mount, right after `loadMonaco()`.

**Why not in `monaco.ts`:** the providers need `openRepoFileTab` from `state/repoTabs.ts`, and
`state/tabKinds.ts` already imports `views/repo/editors.ts`, which imports `views/repo/monaco.ts`.
Putting the import there would close a module cycle
(`tabKinds` to `editors` to `monaco` to `repoTabs` to `tabs` to `tabKinds`). A separate module that
only views import keeps the existing edges acyclic.

```ts
const SELECTOR = { scheme: 'kira-repo', hasAccessToAllModels: true };
```

Verified against `monaco-editor/esm/vs/editor/common/languageSelector.js`: a filter with `scheme` set
and no `language` scores 10 for any model in that scheme, so one registration covers all nineteen
languages plus `plaintext`. `hasAccessToAllModels: true` is what keeps the provider live for a model
too large to be synchronised to the worker — correct here, since this provider runs on the main
thread and answers over IPC, not in the worker.

**Definition provider**:

```ts
languages.registerDefinitionProvider(SELECTOR, {
  async provideDefinition(model, position) {
    const loc = repoLocationOf(model);            // WeakMap, D7 — null on the HEAD side
    if (!loc) return null;
    const res = await control.codeWorkspaceDefinitions(loc.repoId, loc.path,
                                                      position.lineNumber, position.column);
    if (res.status !== 'ready') return null;
    return res.targets.map((t) => ({
      uri: repoFileUriObject(mod, loc.repoId, t.path),
      range: { startLineNumber: t.startLine, startColumn: t.startColumn,
               endLineNumber: t.endLine, endColumn: t.endColumn },
    }));
  },
});
```

**Hover provider**: same call, rendered as one `IMarkdownString`, using
`model.getWordAtPosition(position)` for the hover's own range (Monaco's own word definition, which is
what the user sees highlighted). Returns `null` when `targets` is empty and the status is `ready` —
an empty hover box is worse than none. When the status is `indexing` it returns a single line,
"Code index is still building…", which is the whole reason D8's status field exists.

The markdown, one target per line, is `render.go`'s shape carried into the UI:

```
**method** `Index.Sync`
internal/codeindex/sync.go:47 (exact, sameFile.enclosing)
_Name-resolved, not type-resolved._
```

The trailing note prints **always**, not only on a low-confidence answer — the same reason
`renderTargetLine` prints `Rule` and `Confidence` on every line. Several targets print several
location lines under one header reading how many there are.

**Editor opener** (the cross-file jump):

```ts
editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (resource.scheme !== 'kira-repo') return false;
    const repoId = resource.authority;
    const path = resource.path.slice(1);
    const line = selectionOrPosition
      ? ('lineNumber' in selectionOrPosition
          ? selectionOrPosition.lineNumber
          : selectionOrPosition.startLineNumber)
      : undefined;
    openRepoFileTab(repoId, path, { preview: true, reveal: line ? { line } : undefined });
    return true;
  },
});
```

This is SPEC's "a cross-file jump opens its target as a preview tab in C5's workspace" satisfied by
C5's own `openRepoFileTab` — no second tab-opening path. A same-file jump never reaches here: Monaco
moves the cursor in the editor it is already in.

`RepoFileView.vue` and the diff view's two panes gain `gotoLocation: { multipleDefinitions: 'goto' }`
(D4). Nothing else in the option set changes.

### 8.3 `monaco.ts` and `editors.ts`

`monaco.ts`:

- `repoFileUriObject(mod, repoId, path)` returns `mod.Uri.from({ scheme: 'kira-repo', authority:
  repoId, path: '/' + path })`; `repoFileUri(...)` is its `.toString()` (D6). The model cache stays a
  `Map` keyed by that string, so `disposeModel` is unchanged.
- `repoDiffUris(mod, repoId, path)` returns the same URI with `query: 'side=head'` and
  `query: 'side=worktree'` — one scheme for everything, so one selector covers it (D7).
- `const repoLocations = new WeakMap<ITextModel, { repoId: string; path: string }>()`, written by
  `getOrCreateModel` for the file and worktree-side models only, read by `repoLocationOf(model)`.

`editors.ts` widens its entry to `{ uris: string[]; editor: IStandaloneCodeEditor |
IStandaloneDiffEditor | null }` and gains `registerDiffEditor`/`unmountDiffEditor`/`dropRepoDiffTab`,
which dispose both models. `editorForTab` keeps returning a standalone code editor only (its one
caller, C10's future gutter work, means that one). One map, one lifecycle, two kinds of entry — the
alternative, a second parallel map, would give `closeTab`'s single `dropResources` call two places to
forget.

The diff's worktree model duplicates the file tab's model content for the same path. Deliberate:
sharing one model across two tabs would make either tab's close dispose the other's buffer, and the
duplicate costs one copy of a file already capped at 8 MiB.

### 8.4 "Open changes"

`repo/menus.ts`, file rows only, inserted between "Open" and "Copy path":

```ts
...(row.status
  ? [{ type: 'item', id: 'open-changes', label: 'Open changes', icon: 'git-compare',
       run: () => void openRepoDiffTab(repoId, row.path) }]
  : []),
```

Gated on the same status map C5's tree already colors from (`FileListing.Status`, `M`/`A`/`D`/`?`) —
an unchanged file has nothing to compare. All four codes qualify, untracked included: its diff
against an absent HEAD is exactly "everything here is new", which is what VS Code shows too. A `D`
row still exists in the tree (`git ls-files --cached` lists a deleted-but-tracked path) and diffs as
a full removal.

The status map is only as fresh as the last tree load — C5's own stated limitation, inherited, not
made worse.

### 8.5 Workspace lifecycle calls

- `openRepoWorkspace(repoId)` (`state/workspace.ts`): `void control.codeWorkspaceOpenWorkspace(repoId)`
  after `ensureWorkspaceShell`. Fire-and-forget with a caught rejection — a failed index start must
  never block opening a workspace whose tree and viewer work regardless.
- `closeRepoWorkspace(repoId)`: `void control.codeWorkspaceCloseWorkspace(repoId)`.
- `main.ts`'s restore loop already calls `ensureWorkspaceShell(repoId)` per surviving repo; the open
  call joins it there, so a restored session indexes what it restored.
- `removeCodeRepo`'s existing path needs nothing new — `RemoveRepo` stops the session Go-side.

## 9. Implementation steps

**S1 — Move the sync lock into `internal/codeindex`.** `repomap/lock_unix.go`, `lock_other.go` and
`lock_unix_test.go` become `codeindex/synclock_unix.go`, `synclock_other.go`, `synclock_unix_test.go`.
Export `SyncLock`, `AcquireSyncLock(home, repoID string, timeout time.Duration) (*SyncLock, bool,
error)`, `(*SyncLock).Release()`, `DefaultSyncLockTimeout = 5 * time.Minute`, and
`SyncLockPath(home, repoID string) string`. The path formula is copied byte-for-byte
(`home + "/codeindex-sync-" + hex(sha256(repoID)[:6]) + ".lock"`) with a comment in both
`codeindex` and `mcpauth` pointing at the other, since `mcpauth.Slug` keeps naming the token file the
same way. Update `repomap/server.go` to call it and delete `lockPathFor`. No behaviour change: verify
by running `go test ./internal/repomap/...`.

**S2 — `textpos.go` plus `textpos_test.go`.** §4 verbatim. The one unit test this phase earns
(§10).

**S3 — Session, registry and index lifecycle.** `session.go`'s struct and `Registry.Open`/`Close`/
`CloseAll` per §3.2; `index.go`'s `EnsureIndex`/`IndexReady`/`Close` per §3.3/§3.4, ported from
`repomap.Server`'s own sequence.

**S4 — `diff.go`.** §5, including the lazy `catfile.Session` on the session and the newline guard.

**S5 — `nav.go`.** §6.

**S6 — Bound service and `main.go`.** The four methods plus `Shutdown`; `session()` fills
`IndexRepoID`; `main.go` opens the store, hoists `codeWorkspaceSvc` to a variable the way
`repoMapSvc` already is, and calls `codeWorkspaceSvc.Shutdown()` in `teardown`. Run `go build ./...`
and `go test ./internal/...` (the layering test picks up the new files automatically).

**S7 — Shared vocabulary.** `'repo-diff'` into the five TypeScript places and Go's
`RenderableTabKinds`; `repoDiffTabStateSchema`/`defaultRepoDiffTabState`/`RepoDiffTabRecord`; the
`diffContentSchema`/`navResultSchema` wire schemas into `packages/shared/domain/repo.ts` beside the
existing `fileContentSchema`.

**S8 — `bridge/index.ts` plus the mock channel map.** `codeWorkspaceOpenWorkspace`,
`codeWorkspaceCloseWorkspace`, `codeWorkspaceReadDiff`, `codeWorkspaceDefinitions`, each a one-line
`unwrap(...).then(trust<T>)` in the C5 block; four entries in
`tests/ui/support/mockRuntime.ts`'s channel map.

**S9 — `monaco.ts`.** §8.3's URI change, the location WeakMap, the diff URI helper.

**S10 — Tab kind wiring.** `editors.ts` widening, `TAB_KINDS['repo-diff']`,
`TAB_VIEWS['repo-diff']`, `openRepoDiffTab`.

**S11 — `RepoDiffView.vue`.** §8.1.

**S12 — `navigation.ts` plus the two views' registration call** and `gotoLocation` on the file view.

**S13 — "Open changes"** in `repo/menus.ts`.

**S14 — Lifecycle calls** in `state/workspace.ts` and `main.ts`.

**S15 — Docs.** §11.

**S16 — One UI case** in `tests/ui/repo-workspace.spec.ts` (§10).

Sequencing: S1 through S6 are Go and land first as one coherent backend (S1 before S3, S2 before S5).
S7 gates S8 through S14. S9 before S10 through S12. S13 and S14 are independent of each other.

## 10. Testing

`CLAUDE.md`'s bar: a dedicated test only for something genuinely hard to get right. Applied honestly,
this phase earns exactly one, and I agree with SPEC's own guess about which.

**`internal/codeworkspace/textpos_test.go` — yes.** Boundary arithmetic with five interacting rules
in two directions, which is the same reason `codeparse/edit.go` and C5's preview/pin slot logic each
earned one test. One table-driven test over a fixture holding: an ASCII line, a line starting with
tabs, a CRLF line, a 2-byte rune (`é`), a 3-byte rune (`€`), a 4-byte rune needing a surrogate pair
(an emoji), an invalid UTF-8 byte, an empty last line, and a file with no trailing newline. Cases
assert both directions plus a round-trip identity (`Position(ByteOffset(l, c))` equals `(l, c)` for
every valid position in the fixture) — the round trip is what actually catches an off-by-one in
either function, which a one-directional table would not.

**Everything else — no.** The diff read is single-input-to-single-output classification over
primitives `ReadFile` and `catfile` already own. The bound methods are thin pass-throughs. The tab
kind is registry data. The providers are wiring whose only interesting behaviour lives in Monaco and
in Go. The index lifecycle is a port of `repomap`'s own already-shipped sequence, whose one genuinely
tricky part — the flock's concurrent release — carries its existing test along in S1 rather than
gaining a second copy.

**One UI case, not a new spec file.** `tests/ui/repo-workspace.spec.ts` gains a case that seeds
`codeWorkspaceReadDiff`, right-clicks a modified tree row, invokes "Open changes", and asserts a
second tab exists with the diff host rendered. Its value is not the diff algorithm (Monaco's) but
the six-place tab-kind vocabulary and the real `createDiffEditor` mount under WebKit — the one thing
neither typecheck nor a Go test can reach. The providers are deliberately not covered there: they
need a real index, which the mock harness has no way to produce, and a fake would only assert that
the mock returned what the mock was given.

## 11. Documentation to update

- `docs/ARCHITECTURE.md`, "Native code workspace (C5)": replace the closing "C6 (a separate phase…)
  bullet with a real "Diff tabs and navigation (C6)" subsection — the index lifecycle and its shared
  flock, the diff tab's options and why the revert affordances are off, the provider registration
  (one scheme-scoped selector, `multipleDefinitions: 'goto'` and why), and the byte/UTF-16 rules in
  one paragraph.
- The Stack table's Monaco row: the diff editor is now the `editor.worker`'s first real consumer, and
  `hideUnchangedRegions`/`renderSideBySide` are the shipped shape. Record the measured chunk delta
  from `bun run build` (the diff contribution is already in `register.all.js`, so the delta should be
  near zero — state the measured number either way).
- The `internal/codeindex` paragraph: the sync lock now lives in that package and has two callers.
- "Known open items": add **"a repository open in the native workspace while the embedded repo-map
  MCP server serves the same repository parses every saved file twice"** — two `codeindex.Index`
  instances in one process, each with its own watcher. Harmless (`ReplaceFile` is transactional) and
  bounded, but real, and the sync flock only covers the *initial* sync, by design. Also add the
  drift-window limit from §4 if the review considers it more than a footnote.
- `docs/v1.5/mcp-repo-map-issues.md`: log anything dogfooding this phase turns up, per `CLAUDE.md` —
  trivial items fixed inline with a one-line entry, non-trivial ones logged and left for a dedicated
  pass. Navigating C5's own tab/state code with `find_definition`/`find_references` over raw
  HTTP/JSON-RPC is the expected working mode for the implementation pass; `CLAUDE.md`'s "Repo-map
  MCP server" section has the exact curl invocation.

## 12. Explicitly out of scope

- `references` and `implementations` providers (SPEC's own out-of-scope line). `codegraph` answers
  both today; a later phase registers them once it has a surface to render a result list in.
- Any write: no revert, no stage, no apply, no edit — §11 of C5's plan holds unchanged, with the diff
  editor's own revert/gutter affordances explicitly disabled rather than merely unreachable.
- Diffing against anything but `HEAD`. A revision picker, a three-way merge view and a staged-vs-HEAD
  diff are all C9/C10 territory at the earliest.
- A live-refreshing status map; the "Open changes" gate is exactly as fresh as the tree.
- Pre-creating models for a peek preview, and any model cache eviction policy (D4 removes the need).
- An index progress indicator beyond the hover's one line; a real progress surface belongs with a
  status bar this app does not yet have.
- Navigation inside the diff's HEAD pane (D7).

## 13. Verification

1. `bun run typecheck`, `bun run lint`, `bun run build` — the build also reports the Monaco chunk
   sizes the Stack table records.
2. `go build ./...`, `go test ./internal/...` — includes the moved lock test and the new `textpos`
   test, and the layering test over the new files.
3. `bun run test:unit` (the Go/TS vocabulary parity test is the one that catches a forgotten
   `'repo-diff'` in `RenderableTabKinds`).
4. `bun run test:ui` for `repo-workspace.spec.ts` plus the existing tabs/mode/smoke specs.
5. **The one environmental risk worth a real check**: this phase is the first time an `editor.worker`
   is actually *instantiated* — C5 shipped the chunk and verified it exists in `dist/assets`, but a
   read-only file viewer never asks `IEditorWorkerService` for anything, whereas the diff editor
   computes its diff there. Open a diff tab in a real `wails3 task dev` window and confirm the diff
   renders (an unloadable worker shows two panes with no change decorations and a console error, not
   a crash). If the Worker fails to construct under the packaged asset scheme, the fallback is Vite's
   `?worker&inline` on the same import — still exactly one worker, still no language service.
6. Dogfooding pass: with `bun run mcp:repo-map` running against this worktree, open this repository
   in the native workspace and confirm go-to-definition and hover answer on a Go, a TypeScript and a
   `.vue` file — the last one exercising `codegraph`'s template fallback, which should hover as a
   `repoWide` or `scoped` answer and say so, never silently as `exact`.
