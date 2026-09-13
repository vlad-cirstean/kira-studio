# C7 — Search: in-file and repository-wide, Go-native

> **What this phase is.** `docs/v1.5/SPEC.md`'s C7 row turned into steps, researched against the real
> tree at `daa59624` — C5 and C6 as they actually shipped, not as their plans predicted them.
> Everything below was checked against source: `internal/codeworkspace/` (session, files, paths,
> textpos, nav, diff), `internal/codeindex/` (enumerate, sync's worker pool, classifyAndRead),
> `internal/bridge/codeworkspace.go`, `internal/bridge/events.go` + `grpc.go`'s coalescing push
> channel, the frontend's `state/tabs.ts`/`mode.ts`/`tabKinds.ts`/`repoTabs.ts`/`workspace.ts`,
> `repo/RepoPanel.vue` + `repo/state/fileTree.ts`, `views/repo/*` (monaco, monacoEntry, editors,
> navigation, RepoFileView, RepoDiffView), `theme/primitives/PanelShell.vue`/`SegmentedControl.vue`/
> `VirtualList.vue`, `shortcuts/state.ts`, and `go.mod`.

## 0. What C5/C6 shipped, and what C7 inherits

Facts read from code, not from the two earlier plans:

- **`codeindex.EnumerateAll(ctx, runner, gitPath, root) ([]string, error)`** is the one file-listing
  shape in the tree: `git ls-files -z --cached --others --exclude-standard`, through
  `gitclient.Spec{ReadOnly: true}`, paths as git reported them (never NFC-normalized).
  `codeindex.Enumerate` is a filter over it. `codeworkspace.ListFiles` is its other caller.
- **`codeworkspace.Session`** is `{RepoID, Root, Runner, GitPath, IndexRepoID}` plus an index/graph/
  watcher/catfile set under one `sync.Mutex`, with `closeOnce`. `Registry.Open` reuses a live
  session when `Root` and `GitPath` are unchanged; `Registry.Close`/`CloseAll` stop it.
- **`ValidateRelPath(root, relPath)`** rejects an absolute path and any `..` segment, then resolves
  with `filepath.EvalSymlinks` and requires containment under the resolved root. Returns the
  absolute path. Every path crossing the bound service already goes through it.
- **`MaxReadBytes = 8 MiB`** (viewer cap) and `binarySniffBytes = 8 KiB` (NUL rule) are
  `codeworkspace` constants. `codeindex` has its own parallel pair (2 MiB parse cap, same 8 KiB NUL
  rule in `classifyAndRead`).
- **`textpos.go`'s `LineIndex`** converts both directions between Monaco's 1-based line / 1-based
  UTF-16 column and 0-based row / byte column, under five stated rules. Its unit test is the
  phase's own precedent for what earns one.
- **`codeindex`'s worker pool** (`sync.go`'s `parseStale`) is plain `sync.WaitGroup` + two channels,
  bounded by `syncWorkers()` = `min(NumCPU, 4)`, "cap how much of the machine a background reindex
  takes, not maximise throughput".
- **Push events**: `internal/bridge/events.go`'s channel constants are the Wails event names
  verbatim, mirrored in `packages/shared/protocol/events.ts`'s `CHANNEL`. `ChannelGrpcCall` is the
  one precedent for a *streaming* push channel — `EmitTo(windowKey, …)` (one window), fed by
  `grpcCoalescer`: flush on 60 ms, 64 messages, or a terminal event, and the terminal event always
  fires even with nothing pending. The renderer subscribes with `on(CHANNEL.x, cb)` and passes its
  own `windowKey` (from `bridge/rpc.ts`) as a call argument.
- **`openRepoFileTab(repoId, path, {preview, reveal: {line}})`** is the one file-opening path;
  `openTab`'s dedupe key is `(workspaceId, kind, connectionId, path)`. `RepoFileView.vue` applies
  `state.revealLine` **on mount only**, then re-patches it (debounced) from
  `onDidChangeCursorPosition`.
- **`RepoPanel.vue`** is `PanelShell` (title = repo name, one Refresh action, its own filter box
  driving `visibleRepoRows`) wrapping `RepoFileTree.vue` on `TreeHost.vue`.
- **`view.find`** is an existing app-wide command id: the native menu emits `kira:menu:view-find`,
  `App.vue` turns it into `runCommand('view.find')`, and nine views register a handler while
  mounted. **Neither repo view registers one** — in a repo workspace, Find is a no-op today.
- **Monaco's find widget already ships**: `monacoEntry.ts` imports
  `monaco-editor/features/register.all.js`, upstream's own "every standard contribution, no language
  services" bundle, which includes `find`.
- **`go.mod`** has `golang.org/x/sync` as an *indirect* dependency only. `github.com/google/uuid` is
  direct.

## 1. What SPEC left open, and how each is resolved

**D1 — No search library. Stdlib `regexp` (RE2) is the matching engine, `git ls-files` is the
ignore engine, and `codeindex`'s own worker-pool shape is the concurrency.** This is the decision
SPEC's row asks for, so it is argued rather than asserted.

A text searcher is four parts. Three of them are already a library here:

1. *Pattern matching.* Go's `regexp` is RE2: linear time in the input, no backtracking, so a
   user-typed pattern can never hang the app. A hand-rolled matcher would be strictly worse and is
   exactly what `CLAUDE.md`'s rule forbids. Unicode case folding also stays inside it (§3.3).
2. *Ignore semantics.* `git ls-files --cached --others --exclude-standard` is git's own
   `.gitignore`/`.git/info/exclude`/global-excludes implementation, already wrapped by
   `codeindex.EnumerateAll`. A Go `.gitignore` matcher (`go-git`'s `gitignore`, `sabhiram/
   go-gitignore`) would be a *second* implementation of semantics this repo already sources from
   git itself — D2 below.
3. *Concurrency.* A bounded worker pool over a channel, ~25 lines, already written twice in this
   repo. `errgroup` would promote `golang.org/x/sync` from indirect to direct for no behaviour this
   pool does not have (the pool needs first-error-wins plus continue-on-cancel, not fail-fast).

What is left to hand-roll is part 4: read a file, walk its lines, run the matcher, cut a preview.
That is a scanner over `bufio`, not infrastructure, and it is where all of this phase's real rules
live (binary, size, long lines, caps, zero-width advance, UTF-16 columns) — none of which a generic
library would answer the way this app needs.

Libraries weighed and declined, with the specific reason each fails:

| Candidate | License | Why not |
|---|---|---|
| `sourcegraph/zoekt` | Apache-2.0 | Builds and serves its own trigram index in its own shard files. This chapter already owns an index (`codeindex.db`); a second one, with its own sync/staleness/eviction story, is a bigger commitment than the scanner it replaces — and it answers indexed queries, not "grep the worktree as it is right now", which is what a read-only workspace over a live working tree needs. |
| `google/codesearch` (`index`, `regexp`) | BSD-3 | Same index-first shape. Its `regexp` subpackage's actual value is *trigram query planning for an index* — with no index it degenerates to a slower `regexp`. Effectively unmaintained since 2015. |
| `monochromegane/the_platinum_searcher`, `boyter/cs` | MIT | Applications, not libraries: their matching is entangled with CLI output and their own file walkers. Neither exposes a callback-per-match API. |
| `gobwas/glob`, `bmatcuk/doublestar` | MIT | Genuinely good, and the right answer *if* this phase shipped include/exclude globs. It does not (§12) — `path.Match`'s lack of `**` is the reason globs are deferred whole rather than hand-rolled badly. Named here so a later phase reaches for one instead of writing a matcher. |
| `BurntSushi/rure-go` (ripgrep's own engine) | MIT | Needs a prebuilt Rust `librure` at build time. `docs/ARCHITECTURE.md`'s cgo-free preference exists for exactly this reason, and C1 only broke it where no pure-Go tree-sitter binding exists at all. Here a pure-Go engine (RE2) exists and is fully adequate. |

**Skipping a measurement, deliberately.** No benchmark run here: the decision does not turn on
throughput. This search is bounded by a 10,000-match cap on a single user-initiated action over one
worktree, and the alternative to `regexp` is not "a faster matcher" but "a second index". A measured
megabytes-per-second number would not change any line of this plan.

**D2 — Enumeration is `codeindex.EnumerateAll`, unchanged and unwidened; `.git` internals and
vendored/build directories are excluded by git's own rules, never by a hardcoded list.** `ls-files`
never reports anything under `.git/`, and `--exclude-standard` drops whatever the repository itself
ignores (`node_modules`, `dist`, `target`, `vendor` where ignored). A hardcoded skip list on top
would be wrong in both directions: it would hide a `vendor/` tree that a repository deliberately
commits (Go repositories do), and it would miss the thousand other generated directories it does not
name. One consequence is stated honestly rather than papered over: a repository that commits its
dependencies gets them searched, because they are part of that repository. §12 names the
include/exclude filter that would let a user narrow it, and why that is a later phase.

**D3 — Every candidate path goes through `ValidateRelPath` before it is opened.** Not ceremony: a
repository can commit a symlink (`git ls-files` lists it as an ordinary path) pointing at
`~/.ssh/id_rsa`, and a repository-wide search for `PRIVATE KEY` would otherwise read it and print
matching lines into the results panel. `ValidateRelPath` already resolves symlinks before the
containment check, so reusing it — rather than `filepath.Join` in the scanner — is what keeps
search inside the same boundary `ReadFile` and `ReadDiff` sit behind. A path that fails validation
is skipped and counted, never surfaced as an error.

**D4 — Binary, huge and minified files are skipped by three stated rules, and the skip count is
reported.** §3.4. The size cap is `MaxReadBytes` (8 MiB) reused verbatim, for a reason beyond
symmetry: above it the viewer refuses to open the file, so a match there is a result the user cannot
click — a dead end is worse than an omission, and the omission is counted.

**D5 — Matching is per line, so `^`/`$` anchor to a line and no pattern can span lines.** The
scanner hands the matcher one line at a time with its EOL stripped. Multi-line patterns are out of
scope (§12), stated rather than left for a user to discover.

**D6 — A match's column is Monaco's own 1-based UTF-16 column, computed by the rules already in
`textpos.go`, not a second implementation.** The byte-to-UTF-16 loop (one unit per rune ≤ U+FFFF,
two above, one per invalid UTF-8 byte) is lifted out of `LineIndex.Position` into an unexported
`utf16Units(b []byte) int` that both call. The scanner has a line in hand, not a whole file, so it
cannot use `LineIndex` directly — but it must not disagree with it, or a result click would land the
cursor a column off on any line containing a non-ASCII rune.

**D7 — Results stream over a new push channel, `kira:code:search`, coalesced, aimed at the
requesting window with `EmitTo`.** The exact shape `ChannelGrpcCall` established (P11 D8): flush on
whichever comes first — 60 ms, 256 matches, or the terminal event, which always fires. A second
small coalescer is written for this channel rather than generifying `grpcCoalescer`: that would
rewrite a shipped, `-race`-tested path for one new caller's benefit, and the two payloads share no
field. The coalescer lives in `internal/bridge` (it needs the `appcore.Emitter`);
`internal/codeworkspace` stays emitter-free and streams through a plain callback (§4.1), which is
what keeps the layering test green.

**D8 — One in-flight search per workspace, owned by the `Session`.** Starting a search cancels that
workspace's previous one; `Session.Close` cancels whatever is running. Not a refcount and not a
queue: the UI has exactly one query box per workspace, so a second concurrent full-worktree scan is
never something a user asked for, and making that true by construction is cheaper than bounding a
fan-out nobody wants.

**D9 — The results surface is the repo workspace's own left panel, not a new tab kind.** The
deciding factor is the workflow, not convention: a user clicks several results in turn, and an
opened file takes over the main area — so results rendered *in* the main area would be replaced by
the first click, with no way back but the tab strip. VS Code puts search in the side bar for this
reason. It also matches what C5's own §12 reserved ("the repo panel's section layout to mount a
results pane beside the tree"), costs no new tab-kind vocabulary (six places, Go included), and
raises no "what does a restored search tab do" question. `RepoPanel.vue` gains a two-value
`SegmentedControl` (Files / Search) and `PanelShell` gains one opt-out prop (§7.1).

**D10 — A search runs on Enter or the Search button, never on every keystroke.** Each run reads
every non-skipped file in the worktree; a debounced search-as-you-type would start and cancel a
full scan per pause. The panel's *tree* filter stays live, because that one filters an array already
in memory — the two are different acts and behave differently on purpose.

**D11 — Workers emit out of order; the renderer inserts each file's group at its sorted position.**
Buffering Go-side to restore enumeration order would stall the whole stream behind one slow file,
which defeats streaming. `git ls-files` output is already sorted, so a binary insert by path in the
renderer costs nothing and gives a stable, alphabetical list that never reshuffles.

**D12 — A result click opens a preview tab through C5's `openRepoFileTab`, and reveals through a
new mechanism that also works on an already-mounted editor.** `RepoFileView.vue` applies
`revealLine` on mount only, so today a jump into the tab that is *already mounted and active* moves
nothing — narrow, but it is the common case for search (two matches in the file you are reading).
`views/repo/reveal.ts` (§7.4) holds a pending reveal per tab: applied immediately when that tab's
editor is live, consumed on mount otherwise. It carries a column and an end column, which
`repo-file`'s persisted state deliberately does not (§7.4).

**D13 — In-file search is Monaco's own find widget, reached by registering the existing `view.find`
command in the two repo views.** No second find UI: `features/register.all.js` already ships the
widget, and `view.find` is already wired from the menu, the palette and (per view) the command
registry. This phase's whole in-file deliverable is two `registerCommand` calls plus the diff
editor's "which pane" answer (§6).

**In scope**: the Go search engine (§3), streaming and cancellation (§4), the bound service (§5),
in-file search (§6), the search panel and result opening (§7), read-only and path safety (§8), steps
(§9), tests (§10), docs (§11), verification (§13).

**Not attempted** (§12): include/exclude globs, replace of any kind, multi-line patterns,
symbol-aware search (that is `codegraph`, not this), search history, search in a diff tab's HEAD
side, quick open (C8), and any write path.

## 2. Where the code lives

```
apps/kira-studio/internal/codeworkspace/
  search.go          NEW  SearchRequest/Match/FileMatches/Stats, Search(), the scanner   (S2,S3)
  search_test.go     NEW  the one unit test this phase earns                             (S3)
  textpos.go         utf16Units extracted, used by LineIndex and the scanner             (S1)
  session.go         +searchCancel; beginSearch(); Close() cancels it                    (S2)
apps/kira-studio/internal/bridge/
  events.go          +ChannelCodeSearch                                                  (S4)
  codeworkspace.go   +StartSearch/CancelSearch, +searchCoalescer                         (S4)
packages/shared/protocol/events.ts   +CHANNEL.codeSearch                                 (S5)
packages/shared/domain/repo.ts       search request/match/event schemas                  (S5)
apps/kira-studio/frontend/src/
  bridge/index.ts                    codeWorkspaceStartSearch/CancelSearch/onCodeSearch  (S6)
  repo/state/search.ts     NEW  per-workspace search store, event subscription, row fold (S7)
  repo/RepoSearchView.vue  NEW  query field, options, streamed results                   (S8)
  repo/RepoSearchRow.vue   NEW  one file-header or match row                             (S8)
  repo/RepoPanel.vue       Files/Search switch                                           (S8)
  theme/primitives/PanelShell.vue    +searchable prop                                    (S8)
  views/repo/reveal.ts     NEW  pending-reveal registry (D12)                            (S9)
  views/repo/RepoFileView.vue        consumes a reveal; registers view.find              (S9,S10)
  views/repo/RepoDiffView.vue        registers view.find on the modified pane            (S10)
  state/repoTabs.ts                  openRepoFileTab's reveal widened                    (S9)
  shortcuts/state.ts                 one palette entry                                   (S10)
apps/kira-studio/tests/ui/support/mockRuntime.ts   two channel names, one default        (S6)
apps/kira-studio/tests/ui/repo-workspace.spec.ts   one streamed-search case              (S11)
```

Layering is unchanged: `internal/codeworkspace` imports `codeindex`/`gitclient`/`codegraph` and
never `internal/bridge` (`internal/layering_test.go` picks the new file up automatically). The
`biome.json` `repo/**` block already forbids `views/**` imports from the panel — the search panel
opens tabs through `state/repoTabs.ts`, like the tree does.

## 3. The Go search engine

### 3.1 Wire types (`search.go`)

```go
type SearchRequest struct {
    Query         string `json:"query"`
    Regex         bool   `json:"regex"`
    CaseSensitive bool   `json:"caseSensitive"`
    WholeWord     bool   `json:"wholeWord"`
}

type SearchMatch struct {
    Line        int `json:"line"`        // 1-based
    Column      int `json:"column"`      // 1-based UTF-16, in the file's own line
    EndColumn   int `json:"endColumn"`   // exclusive, 1-based UTF-16
    Preview     string `json:"preview"`  // the line, EOL stripped, possibly windowed (§3.5)
    PreviewMatchStart int `json:"previewMatchStart"` // 0-based UTF-16 offset into Preview
    PreviewMatchEnd   int `json:"previewMatchEnd"`
    TruncatedStart bool `json:"truncatedStart"`
    TruncatedEnd   bool `json:"truncatedEnd"`
}

type FileMatches struct {
    Path      string        `json:"path"`
    Matches   []SearchMatch `json:"matches"`
    Truncated bool          `json:"truncated"` // this file hit MaxMatchesPerFile
}

type SearchStats struct {
    FilesScanned int  `json:"filesScanned"`
    FilesMatched int  `json:"filesMatched"`
    FilesSkipped int  `json:"filesSkipped"` // binary, tooLarge, longLine, unreadable, unsafe path
    Matches      int  `json:"matches"`
    Truncated    bool `json:"truncated"`    // the run hit MaxSearchMatches and stopped early
}
```

Constants, all in `search.go`, none a settings key (C5's own posture):

```go
MaxSearchFileBytes  = MaxReadBytes        // 8 MiB — the viewer cap, reused (D4)
maxSearchLineBytes  = 1 * 1024 * 1024     // a longer line means generated/minified: skip the file
MaxSearchMatches    = 10_000              // whole-run cap
MaxMatchesPerFile   = 500
previewMaxBytes     = 512
previewLeadBytes    = 64                  // context kept before a windowed match
```

### 3.2 The entry point

```go
func Search(ctx context.Context, s *Session, req SearchRequest,
            onFile func(FileMatches)) (SearchStats, error)
```

Callback-streamed, not slice-returning: the bridge wraps `onFile` with the coalescer (D7), and
`codeworkspace` never learns an emitter exists. `onFile` is called from worker goroutines, so its
documented contract is "may be called concurrently"; the coalescer's own mutex is what satisfies it.

Sequence:

1. `matcher, err := newMatcher(req)` — a bad regex returns before any work (§5 maps it to
   `E_INVALID`).
2. `paths, err := codeindex.EnumerateAll(ctx, s.Runner, s.GitPath, s.Root)` (D2). One `ls-files`
   spawn per run: the listing is not cached from `ListFiles`, because a tree loaded ten minutes ago
   is not what a search should be answering against, and the spawn is ~30 ms beside a scan.
3. A bounded worker pool over a `chan string`, `searchWorkers()` workers, each with its own reusable
   read buffer. Results go to an `outcomes` channel drained by `Search` itself (single-threaded),
   which counts stats, enforces `MaxSearchMatches`, and calls `onFile` for any file with matches.
4. On the whole-run cap, the drain loop cancels an internal `context.WithCancel` derived from `ctx`,
   sets `Truncated`, and keeps draining until the workers exit — no goroutine leak, no partial
   channel send left blocking.
5. `ctx.Err()` on a cancelled run is returned as-is; the caller reports `done` with what it had.

```go
// searchWorkers: a user-initiated foreground scan, unlike codeindex.syncWorkers' background
// reindex — so min(NumCPU, 8) rather than that function's deliberate 4. The cap still exists:
// a search must not starve the index sync or the UI thread's IPC.
func searchWorkers() int { … }
```

### 3.3 The matcher

One interface, two implementations, and every hard case goes to RE2:

```go
type matcher interface{ find(line []byte, from int) (start, end int, ok bool) }
```

- **Case-sensitive literal, no whole-word, no regex** → `bytes.Index`. The common case, and the one
  where `regexp` would be pure overhead.
- **Everything else** → one `*regexp.Regexp`, built by wrapping:
  - a literal query is `regexp.QuoteMeta`'d first, so `.`/`*` in a plain search stay literal;
  - `WholeWord` wraps the (quoted or raw) pattern in `\b(?:…)\b`;
  - `CaseSensitive == false` prefixes `(?i)`.

Unicode case folding therefore never gets hand-rolled — `(?i)` is RE2's own, and a `bytes.ToLower`
pass would both allocate per line and be wrong for the cases folding exists for. A user-supplied
pattern is RE2, so no input can make it backtrack exponentially: the reason a regex box is safe to
expose at all.

**Zero-width advance.** `a*`, `^`, `\b` all match empty. After a match the scan continues from
`end`, or from `start+1` when `end == start` — without that rule a zero-width pattern loops forever
on one line. Named here because it is the one genuine trap in the loop, and it is in the test.

### 3.4 Per-file gating (D4)

In order, each cheapest-first, each counted as `FilesSkipped`:

1. `ValidateRelPath(s.Root, path)` (D3) — a path resolving outside the root is skipped.
2. `os.Stat`: a directory, a vanished file, or `Size() > MaxSearchFileBytes` is skipped.
3. `os.Open`, then `bufio.Reader.Peek(8 KiB)`: a NUL in that window is binary — the identical rule
   `ReadFile` and `codeindex.classifyAndRead` already use, so one file is never "text" to one part
   of this app and "binary" to another.
4. A NUL found on a line that is *about to be reported as a match*: the file is dropped whole
   (`FilesSkipped`), including matches already collected for it. This catches a file whose first
   8 KiB is ASCII and whose body is not, without paying an `IndexByte` over every line of every
   file — a check that only runs on match lines is affordable and closes the only hole rule 3
   leaves.
5. A line longer than `maxSearchLineBytes` (`bufio.ErrTooLong`) skips the whole file: a file with a
   1 MiB line is minified or generated, and its matches are unreadable anyway.

Files are never read whole: `bufio.Scanner` over the open file with a per-worker reused 64 KiB
buffer and `maxSearchLineBytes` as its cap. Peak memory is bounded by
`searchWorkers() × maxSearchLineBytes`, not by the 8 MiB file cap.

### 3.5 Line handling, columns and preview

- A line's trailing `\r` is stripped before matching and before preview — `textpos.go`'s rule 1 says
  Monaco's line content excludes the EOL entirely, so a CRLF file must not match `\r$` or show one.
- `Column` = `utf16Units(line[:start]) + 1`; `EndColumn` = `utf16Units(line[:end]) + 1` (D6).
- **Preview** is the whole line when it is at most `previewMaxBytes`. Longer, it is a window:
  start at the last rune boundary at or before `start - previewLeadBytes`, end at the first rune
  boundary at or after `previewMaxBytes` further on, with `TruncatedStart`/`TruncatedEnd` set. The
  renderer draws the ellipsis; the string itself never carries one, so a copied preview is real file
  text. Cutting on rune boundaries (`utf8.DecodeRune`/`DecodeLastRune`) is what keeps the preview
  from ending in half a character.
- `PreviewMatchStart`/`End` are UTF-16 offsets *into the preview*, so the renderer highlights without
  re-deriving anything; a match whose own span exceeds the window is clamped to the window's end.

## 4. Streaming and cancellation

### 4.1 The split

`codeworkspace.Search` takes a callback. `internal/bridge` owns the channel, the window key, the
coalescer and the search-id registry. That division is not stylistic: `codeworkspace` importing an
emitter would put a UI transport inside the package `codegraph`/`codeindex` sit under.

### 4.2 `searchCoalescer` (`internal/bridge/codeworkspace.go`)

`grpcCoalescer`'s rules, one payload type changed:

```go
type CodeSearchEvent struct {
    SearchID string        `json:"searchId"`
    Seq      int           `json:"seq"`   // index of the first file group in this batch
    Files    []codeworkspace.FileMatches `json:"files"`
    Done     bool          `json:"done"`
    Stats    *codeworkspace.SearchStats  `json:"stats,omitempty"`
    Error    *CodeSearchEventErr         `json:"error,omitempty"`
}
```

Flush on 60 ms, 256 accumulated matches, or the terminal event — which fires exactly once,
unconditionally, even with nothing pending and even on cancel, so the panel's "Searching…" state can
never strand. `EmitTo(windowKey, ChannelCodeSearch, …)`: a search belongs to the window that asked.

### 4.3 Cancellation (D8)

`Session` gains one field and one method:

```go
searchCancel context.CancelFunc          // under s.mu

// beginSearch cancels this workspace's previous search (D8: one in flight per workspace) and
// returns the context the new one runs under.
func (s *Session) beginSearch() context.Context
```

`Session.Close`'s existing `closeOnce` body calls `searchCancel` alongside `cancel`. Every stop
point therefore already covers search: `CloseWorkspace`, `RemoveRepo`, process teardown
(`Shutdown` → `CloseAll`), and a `Registry.Open` that rebuilds a session because `Root`/`GitPath`
changed.

A cancelled run still emits its terminal event, with `Stats` reflecting what it had reached. The
renderer drops any event whose `searchId` is not the one it is currently waiting on, so a late batch
from a superseded search can never land in the new one's list.

## 5. The bound service

Two methods on `CodeWorkspaceService`, plus the coalescer state:

```go
type CodeWorkspaceSearchArgs struct {
    ID            string `json:"id"`
    WindowKey     string `json:"windowKey"`
    Query         string `json:"query"`
    Regex         bool   `json:"regex"`
    CaseSensitive bool   `json:"caseSensitive"`
    WholeWord     bool   `json:"wholeWord"`
}
type CodeWorkspaceSearchHandle struct {
    SearchID string `json:"searchId"`
}

func (s *CodeWorkspaceService) StartSearch(ctx context.Context,
        args CodeWorkspaceSearchArgs) (CodeWorkspaceSearchHandle, error)
func (s *CodeWorkspaceService) CancelSearch(args CodeWorkspaceIDArgs) error
```

- `StartSearch` validates (`id`, `windowKey`, non-empty `query`), resolves the session through the
  existing `session()` helper, **compiles the pattern before returning** (a bad regex is
  `E_INVALID` on the call, never a stream error the panel has to render twice), mints a
  `uuid.NewString()` search id, then starts one goroutine: `codeworkspace.Search(sessCtx, sess, req,
  coalescer.push)` followed by `coalescer.finish(stats, err)`. It returns the handle immediately —
  a full-worktree scan takes far longer than an IPC call may (`OpenWorkspace`'s own posture).
- The goroutine's context is `sess.beginSearch()`, not the bound call's `ctx` (which ends when the
  call returns).
- `CancelSearch(args{ID})` takes the **workspace** id, not a search id: one in flight per workspace
  (D8), and the renderer always means "stop what this panel is running". It calls
  `sess.beginSearch()`'s cancel via a dedicated `Session.CancelSearch()`.
- `StartSearch` does **not** call `EnsureIndex`: text search is independent of C2's graph (SPEC's
  own note), and searching a repository must not start parsing one.

## 6. In-file search (D13)

`RepoFileView.vue`, in `onMounted` after the editor exists:

```ts
unregisterFind = registerCommand('view.find', () => {
  editor.focus();
  void editor.getAction('actions.find')?.run();
});
```

disposed in `onUnmounted` beside the cursor subscription, the exact lifecycle
`views/console/ConsoleView.vue` and seven others already use for this command id.

`RepoDiffView.vue` does the same against `editor.getModifiedEditor()` — the worktree pane. Stated
rather than defaulted: `IStandaloneDiffEditor` has no `getAction`, and a find started on the HEAD
pane searches a revision the user is not editing toward. The modified pane is the one whose content
matches the file on disk (C6 D7's own reasoning for which side is navigable).

Nothing else: the widget, its regex/case/word toggles, its match navigation and its highlighting are
Monaco's, already in the bundle. `actions.find` is also what Monaco's own ⌘F binding runs, so the
menu accelerator and a direct keypress converge on one path instead of two.

## 7. The renderer

### 7.1 Panel structure (D9)

`PanelShell.vue` gains one prop:

```ts
searchable?: boolean   // default true — false hides the magnifier and the filter box
```

One `v-if` on the existing `IconButton` and one on the existing `PanelSearchBox`. Nothing else in
that component changes, and every current caller is unaffected by the default.

`RepoPanel.vue` gains a `SegmentedControl` in its `#actions` slot (`Files` / `Search`, the
`theme/primitives` component, `size="sm"`), passes `:searchable="view === 'files'"` — in Search mode
the panel's own tree filter is meaningless and would read as a second query box — and renders either
`<RepoFileTree>` or `<RepoSearchView>` in `#body`. The Refresh action stays visible in Files mode
only. `view` is per workspace and lives in `repo/state/search.ts`, not in component state, so
switching workspaces and back does not reset it.

### 7.2 The store (`repo/state/search.ts`)

One entry per repo id, a `reactive(new Map())` for the same reason `fileTree.ts`'s own map documents
(an untracked `.get()` on a plain Map never re-renders):

```ts
interface RepoSearchState {
  view: 'files' | 'search';
  query: string;
  options: { regex: boolean; caseSensitive: boolean; wholeWord: boolean };
  searchId: string | null;        // null when idle
  running: boolean;
  files: FileMatches[];           // path-sorted (D11)
  collapsed: Set<string>;
  stats: SearchStats | null;
  error: string | null;
}
```

- `startRepoSearch(repoId)`: clears results, calls `control.codeWorkspaceStartSearch(...)`, stores
  the returned `searchId`, sets `running`. A rejected call (empty query, bad regex, git unavailable)
  sets `error` and leaves `running` false.
- The `CHANNEL.codeSearch` subscription is created **once, lazily, on the first search** (module-level
  `let unsubscribe`), not at boot: a window that never opens a repo workspace should not hold a
  listener. Each event is routed by `searchId`; an event for an id no entry is waiting on is dropped
  (§4.3).
- A batch's `files` are merged by binary insert on `path` (D11). `done` sets `running = false` and
  stores `stats`.
- `dropRepoSearch(repoId)` mirrors `dropRepoTree`, called from the same repo-removal path.

Row folding for the list: a flat `RepoSearchRowVm[]` of `{kind:'file'|'match'}` — one header row per
file (path, match count, a collapse chevron) followed by its match rows unless collapsed. Uniform
row height, rendered through `VirtualList.vue` (the primitive the tree, the ops panel and both
console grids already use) so a 10,000-match run renders a screenful.

### 7.3 `RepoSearchView.vue`

A query `TextField` (Enter runs the search, Escape clears), three option toggles rendered as
`IconButton`s with `:active` (case, whole word, regex — Monaco's own find-widget vocabulary, so the
in-file and repository-wide surfaces read the same), a Search/Stop button, and the results list.
Above the list, one status line: `Searching…` while running, `N results in M files` when done,
`N results in M files (stopped at 10,000)` when `stats.truncated`, `K files skipped` appended when
non-zero — the skip count is surfaced, never silent (D4). An error renders as the same
`p-strip note error-note` the tree's error uses.

A single click on a match row opens a **preview** tab; double-click or Enter opens a **permanent**
one — the tree's own `onSelect`/`onOpen` split, so one convention covers both ways into a file.
Clicking a file header row toggles its collapse.

### 7.4 Opening a result, and the reveal fix (D12)

`openRepoFileTab`'s option widens:

```ts
export interface OpenRepoFileOpts {
  preview: boolean;
  reveal?: { line: number; column?: number; endColumn?: number };
}
```

`revealLine` stays the only *persisted* field (`repoFileTabStateSchema` is untouched): a column is
worth restoring a cursor to within a session, not across a restart, and widening the stored schema
would mean a migration-shaped concern for a scroll position.

`views/repo/reveal.ts`:

```ts
export interface RevealRequest { line: number; column?: number; endColumn?: number }
export function requestReveal(tabId: string, req: RevealRequest): void
export function consumeReveal(tabId: string): RevealRequest | null
```

`requestReveal` applies the reveal immediately when `editorForTab(tabId)` returns a live editor
(`setSelection` + `revealRangeInCenterIfOutsideViewport`, or `revealLineInCenter` with no column),
and otherwise stores it for the mount to consume. `RepoFileView.vue`'s mount prefers
`consumeReveal(tab.id)` over `state.revealLine`, falling back to it. The module imports only
`views/repo/editors.ts`, so it closes no cycle (`editors` → `monaco`, neither imports `state/*`).

That is the whole fix for the case C6 left: a jump into the tab that is already mounted and active
now moves the cursor, whether it comes from a search result or from go-to-definition.

## 8. Read-only and path safety

Unchanged and re-checked, not re-argued — the three places C5 named still hold, and this phase adds
nothing to any of them:

1. **No write method.** `StartSearch`/`CancelSearch` read files and spawn one `git ls-files` through
   the existing `gitclient.Spec{ReadOnly: true}` path. Nothing in `search.go` opens a file for
   writing, and `os.Open` (read-only) is the only open it performs.
2. **Monaco stays `readOnly`/`domReadOnly`.** Nothing here mounts an editor; the find widget is a
   read surface. Monaco's find widget does host a *Replace* toggle — it is inert against a
   `readOnly` model (the replace actions are disabled by the same flag that blocks typing), and no
   code in this phase enables it. Stated explicitly because "the find widget" is the one place in
   this phase where a write affordance is even visible.
3. **No new tab kind, so no new badge/dirty/save surface.** D9's panel choice means this phase adds
   nothing to `tabKindSchema` at all.

**Path safety** gets one genuine addition, and it deserves prose rather than a fragment. Repository
search is the first surface in this chapter that touches a path the user did not individually ask
for: the tree reads a file only when clicked, whereas a search opens every file in the worktree.
That makes the symlink case real rather than theoretical, because a repository can commit a symlink
pointing anywhere on the machine and a search would otherwise read through it and print the matching
lines. Every path the scanner touches therefore passes through `ValidateRelPath` first, which
resolves symlinks with `filepath.EvalSymlinks` and requires the result to stay under the session's
own resolved root; a path that fails is skipped silently and counted in `FilesSkipped`, never
surfaced as an error and never read.

## 9. Implementation steps

Each step builds and passes `bun run typecheck`, `bun run lint`, and `go vet` on the touched
packages. The expensive suites run once, at S12, per `CLAUDE.md`.

**S1 — `utf16Units` extraction.** Lift the decode loop out of `LineIndex.Position` into
`utf16Units(b []byte) int`; `Position` calls it. No behaviour change — `textpos_test.go` is the
guard, unchanged.

**S2 — `search.go`'s types, matcher and pool skeleton; `Session.beginSearch`/`CancelSearch`.**
`SearchRequest`/`SearchMatch`/`FileMatches`/`SearchStats`, the constants, `newMatcher`, the worker
pool, the drain loop and the whole-run cap. `session.go` gains `searchCancel` and cancels it in
`Close`.

**S3 — The scanner.** `scanFile` with §3.4's five gates and §3.5's columns and previews, plus
`search_test.go` (§10).

**S4 — `ChannelCodeSearch`, the coalescer, and the two bound methods.** `events.go`'s constant;
`searchCoalescer` in `codeworkspace.go`; `StartSearch`/`CancelSearch`. `go build ./...` and
`go test ./internal/...` (the layering test picks the new file up).

**S5 — Shared vocabulary.** `CHANNEL.codeSearch` in `packages/shared/protocol/events.ts`;
`searchRequestSchema`/`searchMatchSchema`/`fileMatchesSchema`/`searchStatsSchema`/
`codeSearchEventSchema` in `packages/shared/domain/repo.ts`, beside `navResultSchema`.

**S6 — `bridge/index.ts` plus the mock channel map.** `codeWorkspaceStartSearch`,
`codeWorkspaceCancelSearch` (both one-line `unwrap(...).then(trust<T>)` in the existing C5/C6 block,
passing `windowKey`), `onCodeSearch` (an `on(CHANNEL.codeSearch, cb)`); two entries plus one default
response in `mockRuntime.ts`.

**S7 — `repo/state/search.ts`.** The store, the lazy subscription, the merge-by-path insert, the row
fold, `dropRepoSearch` wired into the same place `dropRepoTree` is.

**S8 — The panel.** `PanelShell.searchable`; `RepoPanel.vue`'s segmented control and body switch;
`RepoSearchView.vue`; `RepoSearchRow.vue`. Working increment: a query returns streamed results;
clicking one does nothing yet.

**S9 — `views/repo/reveal.ts`**, `openRepoFileTab`'s widened `reveal`, `RepoFileView.vue`'s
`consumeReveal`, and the result-row click handlers. Working increment: a result click opens the file
at the match, in the preview slot.

**S10 — In-file search.** `registerCommand('view.find', …)` in both repo views; one palette entry
(`repo.search`, "Search in repository", registered by `RepoPanel.vue` while mounted) in
`shortcuts/state.ts`.

**S11 — One UI case** in `repo-workspace.spec.ts` (§10).

**S12 — Docs and verification.** §11, then §13.

Sequencing: S1-S4 are Go and land first as one coherent backend (S1 before S3). S5 gates S6-S9.
S10 and S11 are independent of each other.

## 10. Testing

`CLAUDE.md`'s bar — a dedicated test only for something genuinely hard to get right. This phase
earns exactly one, on the same grounds `textpos_test.go` was earned.

**`internal/codeworkspace/search_test.go` — yes.** The scanner is several interacting rules over
boundary arithmetic: per-line match extraction with a zero-width advance, per-line and per-file
caps, preview windowing on rune boundaries, UTF-16 column agreement with `LineIndex`, CRLF stripping,
and the binary/size/long-line gates. Table-driven over an in-memory fixture set covering: an ASCII
line with two matches; a match after a 3-byte rune (`€`) and after a surrogate-pair emoji, asserting
`Column` equals what `NewLineIndex(file).Position(row, byteCol)` gives for the same byte — the
cross-check that keeps D6 true rather than merely intended; a CRLF file; a line longer than
`previewMaxBytes` with the match in the middle, both truncation flags set and both cut points on
rune boundaries; a zero-width pattern (`x*`) that must terminate; a file exceeding
`MaxMatchesPerFile`, asserting `Truncated` and exactly the cap; a NUL in the first 8 KiB; a NUL only
on a match line (the whole file dropped); a line over `maxSearchLineBytes`; and a regex with `^`/`$`
anchoring per line.

**Everything else — no.** `newMatcher` is three `if`s composing a string handed to `regexp` (the
regex semantics under test would be RE2's, not ours). The worker pool is the third instance of a
shape `codeindex`'s own tests already exercise. The bound methods are thin pass-throughs. The
coalescer is `grpcCoalescer`'s rules with one payload type, and the behaviour worth testing there
(the terminal flush) is asserted by the UI case below actually reaching a `done` state. The store's
merge-insert is a binary insert into a sorted array. The panel is wiring.

**One UI case, not a new spec file.** `repo-workspace.spec.ts` gains a case that stubs
`codeWorkspaceStartSearch` to return a fixed search id, switches the panel to Search, submits a
query, then drives two `emitWailsEvent(page, CHANNEL.codeSearch, …)` batches (the second `done`),
and asserts: both files' rows render in path order, the status line reads the final count, and
clicking a match row opens a preview tab whose title is that file's basename. Its value is the parts
neither a Go test nor typecheck reaches — the event subscription, the out-of-order merge, and the
result-click-to-preview-tab path.

## 11. Documentation to update

- **`docs/ARCHITECTURE.md`, the "Native code workspace" section**: a new "Search (C7)" subsection —
  the Go-native decision and the one-line reason no library was added (RE2 plus `git ls-files` plus
  the existing pool *is* the library answer); the enumeration source and what that means for `.git`
  and vendored directories; the three skip rules and that the skip count is reported; the streaming
  channel and its coalescing; one search per workspace; the panel placement and why it is not a tab;
  and that in-file search is Monaco's own widget.
- **`docs/ARCHITECTURE.md`, the push-channel list**: `kira:code:search` beside `kira:grpc:call`, with
  the same "`EmitTo`, one window" note.
- **`docs/ARCHITECTURE.md`, Known open items**: repository search has no include/exclude filter, so a
  repository that commits its dependencies searches them; results are a point-in-time snapshot with
  no live update as files change; a pattern cannot span lines.
- **`docs/ARCHITECTURE.md`, the C6 paragraph on navigation**: one sentence that a reveal now applies
  to an already-mounted editor (D12), since that paragraph currently implies mount-time only.
- **`docs/v1.5/mcp-repo-map-issues.md`**: log whatever dogfooding this phase turns up, per
  `CLAUDE.md` — trivial items fixed inline with a one-line entry, non-trivial ones logged and left
  for a dedicated pass.
- **`CLAUDE.md`**: nothing. App fact, not process.
- **`NOTICES.md`**: nothing. No new dependency (D1).

## 12. Explicitly out of scope

- **Include/exclude globs** (`files to include`, `files to exclude`). Deferred whole rather than
  half-built: `path.Match` has no `**`, and the right answer is a library (`bmatcuk/doublestar` or
  `gobwas/glob`, both MIT) plus a UI for two more fields — a phase's worth of scope on its own, and
  `CLAUDE.md` is explicit that scope left out stays out entirely.
- **Replace, in any form.** The chapter forbids writes; the find widget's own replace affordance is
  inert against a `readOnly` model and is never enabled (§8).
- **Multi-line / cross-line patterns** (D5), and any `--multiline` equivalent.
- **Symbol-aware search.** `codegraph` answers "where is this defined"; this is text, by SPEC's own
  framing of the row.
- **Search history, saved searches, a results-to-editor "open all"**, and a results context menu
  beyond what the row itself does.
- **Searching a diff tab's HEAD pane repository-wide.** Repository search reads the worktree only —
  searching a revision means `git grep <rev>` semantics and a revision picker, which C6 already put
  out of scope for diffs.
- **A live-updating result list.** Results do not follow the filesystem; re-run to refresh, the same
  posture C5's tree takes.
- **Quick Open (C8)**, which reuses this phase's result-opening convention but is its own row.
- **A settings key** for any bound in §3.1 — all constants, like C5's.

## 13. Verification

1. `bun run typecheck`, `bun run lint`, `bun run build`.
2. `go build ./...`, `go vet` on the touched packages, `go test ./apps/kira-studio/internal/...` —
   including the new `search_test.go` and the layering test over the new file.
3. `bun run test:unit`.
4. `bun run test:ui` for `repo-workspace.spec.ts` plus the existing tabs/mode/smoke specs;
   `bun run test:visual` (the repo panel gains a segmented control and a second body — snapshots
   updated deliberately, reviewed, not blanket-accepted).
5. **One real manual pass against this repository itself**, recorded in the commit message rather
   than asserted as a threshold (C1 §13's posture): import `kira-studio`, search a literal that
   appears widely (`func `), confirm results stream rather than appearing all at once, then
   cross-check a narrower query's count against `git grep -c` run in a terminal. `git grep` is a
   developer cross-check here, not shipped code — the implementation spawns nothing but
   `git ls-files`, and no `ripgrep` anywhere.
6. Confirm the three skip rules on real inputs: a binary file under `assets/` produces no matches, a
   search for a string inside a >8 MiB file reports it skipped rather than matched, and the skipped
   count in the status line is non-zero and plausible for this repository.
7. Confirm cancellation: start a search, immediately start a second, and confirm the panel never
   shows a batch from the first (the `searchId` guard) and never stays stuck on "Searching…".
8. Confirm in-file search: ⌘F in a `repo-file` tab opens Monaco's find widget, ⌘F in a `repo-diff`
   tab opens it on the worktree pane, and neither offers a working replace.
