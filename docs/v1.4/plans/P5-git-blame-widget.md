# P5 — Git extension: status-bar blame widget

> **What this phase is.** `docs/v1.4/SPEC.md`'s P5 row, turned into concrete steps from direct
> research against the real tree plus empirical probes against the real git binary (git 2.43.0;
> full probe transcripts kept out of this file per `docs/v1.4/plans/`'s discipline — see §0).
> **Session override, this chapter only** (same as P1/P3/P4): plan and implementation both done by
> the orchestrating session directly, not a Sonnet implementer subagent.

## 0. What SPEC left open, and how each is resolved

SPEC's own P5 row names two open design questions for this plan to answer: *"Whether blame is
computed per-line on demand or per-file incrementally, and how a dirty buffer's line numbers map
back to committed lines."*

**Per-line on demand, always.** The status bar shows exactly one line's blame — the active editor's
current cursor line — never a whole-file gutter overlay (that is a materially bigger feature, not
this row's scope). `git blame --line-porcelain -L <line>,<line> -- <path>` blames exactly one line;
probed directly against a real repo, this always produces exactly one, fully-headered hunk (no
abbreviated-header continuation lines — those only appear when a single invocation's output touches
the same commit more than once, which a one-line request cannot). A whole-file incremental cache
would need invalidation logic (on edit, on save, on `repo.changed`) for a benefit this widget never
uses — one more root-container-style trap `AGENTS.md`'s "no speculative abstraction" rule exists to
head off.

**A dirty buffer is never blamed against its own live content.** Probed: plain `git blame -L
<n>,<n>` (no `--contents`) already reports an unsaved on-disk edit as commit
`0000000000000000000000000000000000000000` with a synthetic identity (`Not Committed Yet` /
`<not.committed.yet>`) — git's own answer to "who wrote this line" for a line that differs from
every real commit, computed against the file **on disk**. The alternative — piping the editor's
live in-memory buffer through `--contents=-` so an *unsaved* edit's own line numbers remap
correctly — was probed too (works: git resolves it the identical way, sentinel `author "External
file (--contents)"`) but is declined: it needs a second gitclient capability (`Spec.Stdin` wired
through a new `runOneWithStdin`, RepoEntry method, and the whole contract/handler pair carrying the
buffer's bytes on every request), for a case — blaming a still-unsaved line, this session — a
correctness-conscious user's next keystroke already resolves via `onDidSaveTextDocument`. The
widget instead treats "document is dirty" as its own explicit state (§5): it shows a plain "Unsaved
changes" indicator and skips the blame request entirely while `document.isDirty`, re-querying the
line the document is saved. This is the same "honest degradation, not a new failure mode" call P4
made for an unresolvable root container — never wrong, only quieter than a live-buffer blame would
be for the one window between an edit and its save.

A third option surfaced by research and also declined: `@kira/git-core`'s existing
`mapLineAcrossDiff` (`goToFile.ts`/`file.goToTarget`'s own line-remapping primitive) could map the
dirty buffer's cursor line back to the last-saved line client-side — real, tested coverage already
exists for it. Declined for the same reason `--contents=-` is: it buys a correct answer for a window
the "Unsaved changes" message already resolves honestly and briefly, at the cost of pulling a
primitive built for a different problem (diffing two *revisions*, not a live in-memory buffer
against disk) into a shape it was never exercised for.

**In scope**: `internal/gitclient/porcelain`'s new single-hunk blame parser (with a golden-byte
corpus, §2), a new `RepoEntry.BlameLine` query (§3), a new `blame.line` gitrpc handler and wire
types (§4), the `CONTRACT_VERSION`/`ContractVersion` bump to 34 on both sides (§4), and the
extension's active-line tracking, debounce, status-bar rendering and click-through (§5-§6).

**Explicitly not attempted** (§7): a whole-file/gutter blame view; blaming an unsaved buffer's live
content (`--contents=-`); blaming any revision other than the working tree (no `atSha` param — no
caller needs one); any Go-side cache (§3 states why one has no stable key here, unlike `diffCache`'s
immutable tree-oid keying).

## 1. `internal/gitclient/porcelain`: `BlameLineArgs` + `ParseBlameLine`

New file `blame.go`, beside `log.go`/`difftree.go`/`worktree.go`:

```go
func BlameLineArgs(path string, line int) []string {
    return []string{"blame", "--line-porcelain", "-L", fmt.Sprintf("%d,%d", line, line), "--", path}
}
```

`--` before `path` is load-bearing the same way it is in every other argv this package builds
(`FileDiffArgs` et al.) — a path this app receives is never trusted not to start with `-`, and `--`
makes the following token unambiguously a pathspec regardless of its content, so no separate
option-injection guard is needed for `path` the way `validRefArg` guards a `sha`/`rev` string
elsewhere in `gitrpc` (§4). Confirmed against the existing precedent, not assumed: `commit.fileDiff`'s
own handler (`detail.go:96-103`) calls `validRefArg` on `sha` only, never on `path` — a `path` param's
safety in this codebase already comes from `--` plus (for one that resolves against a live worktree)
the escape check §3 reuses, never from rejecting a leading dash. `line` is a decoded JSON number by
the time it reaches this function, never a raw external string, so there is nothing to inject there
either.

`BlameLine`, this file's own result type — deliberately narrow (only what the status bar renders,
not every field `--line-porcelain` emits):

```go
const UncommittedBlameSHA = "0000000000000000000000000000000000000000"

type BlameLine struct {
    SHA               string `json:"sha"`
    Author            string `json:"author"`
    AuthorTimeSeconds int64  `json:"authorTimeSeconds"`
    Summary           string `json:"summary"`
}
```

No `Uncommitted()` method — the wire result carries `SHA` only, and both the Go and TypeScript sides
compare it against the same literal sentinel directly (`porcelain.UncommittedBlameSHA` /
`contract.ts`'s own doc comment on the constant), the same "no second interpretation of a value one
side already has" instinct `wire.go`'s own doc comment states for why a handler returns a
`gitsession`/`porcelain` type directly rather than a parallel gitrpc-owned copy (§4).

`ParseBlameLine(raw []byte) (BlameLine, error)` parses **exactly one hunk** — the shape a `-L
<n>,<n>` request always produces (§0). Line-oriented (`bufio.Scanner`, `\n`-delimited — probed: `-z`
has no effect on `blame`'s own output framing, unlike `worktree list -z`; every attribute line here
is plain LF-terminated text, and the content line is TAB-prefixed, never NUL). First line is the
commit-info line (`<sha> <origLine> <finalLine> [<groupLineCount>]`) parsed by field position; every
line after it is a `key value` attribute (`cutFirstSpace`, already unexported in this package from
`worktree.go` — reused here verbatim rather than copied, same file, same package) until the
tab-prefixed content line, which ends the record (the value in `ParseBlameLine`'s single-hunk
contract — nothing follows it). Recognised keys: `author`, `author-time`; every other key
(`author-mail`, `author-tz`, `committer*`, `summary`'s already handled, `previous`, `boundary`,
`filename`) is read only for `summary` and otherwise **ignored**, the identical "unknown attribute
ignored" contract `ParseWorktreeList` already documents — this parser does not need `previous`/
`filename`/`boundary` for anything the status bar renders, and a future git version's own new
attribute line must not break it.

## 2. Golden-byte corpus

`fixtures_test.go`'s `TestFixtures_Regenerate` gains one new section (mirrors the existing
`log/`/`diff/` blocks exactly, `captureRaw` already generic over any argv):

1. `blame/committed.bin` — an ordinary line from a non-root commit (`previous` present, no
   `boundary`).
2. `blame/boundary.bin` — a line from the repository's first commit (`boundary`, no `previous` —
   probed: this is the real shape, not a guess).
3. `blame/uncommitted.bin` — an unstaged on-disk edit at the probed line (the all-zero sha,
   synthetic `Not Committed Yet` identity — probed verbatim, §0).

`blame_test.go` (`porcelain_test` package, same `readFixture`/golden-corpus-missing error message
convention as `log_test.go`/`difftree_test.go`) asserts each fixture's parsed `SHA`/`Author`/
`AuthorTimeSeconds`/`Summary`, plus `SHA == porcelain.UncommittedBlameSHA` true only for case 3. One
more test, no fixture
needed (pure byte literal, mirrors `TestParseWorktreeList_UnknownAttributeIgnored`): a hand-built
single hunk carrying an attribute line this parser doesn't recognise must not error or misfile a
later field. This is the "several interacting rules" case `AGENTS.md`'s testing bar names — five-plus
attribute lines, two optional flag lines, one sentinel-sha branch — real coverage, not a placeholder.

## 3. `internal/gitsession`: `RepoEntry.BlameLine`

`queries.go` gains:

```go
func (e *RepoEntry) BlameLine(ctx context.Context, path string, line int) (porcelain.BlameLine, error)
```

Resolves `path` against the repo root exactly like `GoToTarget` already does (`filepath.Rel`,
`ErrPathEscapesRoot` on escape — reused verbatim, not a new error kind: a blame request also
resolves a path against a live worktree, the identical risk `GoToTarget` was written to close), then
`e.runOne(ctx, porcelain.BlameLineArgs(relPath, line))` and `porcelain.ParseBlameLine(raw)`.

**No cache.** `diffCache`/`detailCache`/`refsCache` all key on an immutable tree oid (a `sha`, a
`baseSha`) — cheap to key on because the answer can never change for that key. A working-tree blame
has no such key: the same `(path, line)` can answer differently from one keystroke to the next with
no ref changing at all (an uncommitted edit is neither `refsChanged` nor `worktreeChanged` in the
watcher's own vocabulary — it is `vscode`'s own document-dirty state, which the Go side cannot see
and the watcher does not fire for). Caching here would need its own bespoke, editor-driven
invalidation signal for no round-trip saved on the common path (a user who just moved the cursor is
about to see a new line's blame anyway) — and would be actively wrong, not just wasteful, if built on
the existing cache machinery as-is: `entry.go`'s `note()` (the refs/worktree-signal handler every
existing cache is dropped from) only clears caches on `SignalRefsChanged`, never on
`SignalWorktreeChanged`, so a naive reuse of that path would keep serving a blame answer past the
exact edit that invalidated it. Declined; the extension's own debounce (§5) is what bounds request
rate, the same job G12 D10's in-flight indicator debounce already does for a different signal.

## 4. `internal/gitrpc`: `blame.line` + the contract bump

`wire.go` gains:

```go
type BlameLineParams struct {
    RepoID string `json:"repoId"`
    Path   string `json:"path"`
    Line   int    `json:"line"`
}
```

`detail.go` gains `handleBlameLine`, same shape as `handleCommitFileDiff` minus the size-guard
re-marshal step (this result is a handful of short fields, nowhere near `MaxResultBytes`):

```go
func (r *Router) handleBlameLine(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
    var p BlameLineParams
    if err := json.Unmarshal(params, &p); err != nil {
        return nil, ipcerr.BadRequest("gitrpc: blame.line: invalid params")
    }
    if p.RepoID == "" || p.Path == "" || p.Line < 1 {
        return nil, ipcerr.BadRequest("gitrpc: blame.line: repoId, path and a 1-based line are required")
    }
    entry, err := entryFor(c, p.RepoID)
    if err != nil {
        return nil, err
    }
    line, err := entry.BlameLine(ctx, p.Path, p.Line)
    if err != nil {
        return nil, mapDetailError(err) // ErrPathEscapesRoot already mapped; everything else (untracked path, line past EOF) falls to mapGitError's default arm
    }
    return line, nil
}
```

`handlers.go`'s dispatch switch gains `case "blame.line": return r.handleBlameLine(ctx, c, params)`,
placed beside `commit.fileDiff`/`file.read`.

**Contract bump, both sides, same accumulating-comment convention every prior bump in this file
used** (`internal/gitrpc/contract.go`'s `ContractVersion` **and** `packages/git-ipc/src/
validate.ts`'s `CONTRACT_VERSION` — the sole compatibility authority per both files' own doc
comments, moved together even though, unlike most additions in this file's history, this one really
is served by the Go side): `33 -> 34`, one new Go-served request, `blame.line`. Comment block
appended to both, matching e.g. G24 D14's own entry in shape.

`packages/git-ipc/src/contract.ts` gains, beside `commit.detail`:

```ts
/** P5: the status bar's one-line-at-a-time query — never a whole-file blame (no such request
 *  exists). `sha` is the all-zero sentinel for a line whose content isn't in any commit yet (an
 *  unsaved-but-on-disk edit) — the caller checks this before treating `sha` as a real commit to
 *  route `revealCommit` at. */
'blame.line': {
  params: { repoId: string; path: string; line: number };
  result: {
    readonly sha: string;
    readonly author: string;
    readonly authorTimeSeconds: number;
    readonly summary: string;
  };
};
```

**`apps/kira-studio-vscode/src/proxyHandlers.ts` needs one more entry too, even though no webview
caller exists.** `ServerHandlers['requests']` (`@kira/git-ipc`) is a total mapped type over every
`RequestKey` the contract declares, so adding `blame.line` to `contract.ts` makes this file stop
compiling until it gains a `'blame.line': forward('blame.line')` line — confirmed against the
existing precedent for a request answered entirely by the Go server but never called from the
webview (`file.read`/`file.goToTarget`, `proxyHandlers.ts:530-533`, its own comment: *"server-only,
never called by the webview — plain forwarders are enough (`ServerHandlers.requests` is total over
`RequestKey`, so both need an entry regardless)"*). A plain `forward(...)`, not the thrown-stub shape
`credential.provide`/`settings.setGitPath` use — that shape is reserved for a request that must
*never* reach the Go server from the webview at all; `blame.line` has no such restriction, it simply
has no webview caller yet.

## 5. Extension: active-line tracking, debounce, status-bar rendering

New file `apps/kira-studio-vscode/src/blameWidget.ts` (mirrors `diffToolbar.ts`'s own
deps-bundle-plus-exported-functions shape, not a class — this codebase's convention for a feature
that owns a few `vscode.Disposable`s and one piece of derived state, `reviewMarking.ts`'s
`activeEditorSub`/`selectionSub` pair being the closest precedent for the listeners themselves).

**Triggers** (mirrors `reviewMarking.ts`'s own pair, extended by one): `onDidChangeActiveTextEditor`,
`onDidChangeTextEditorSelection` (cursor moved — the active *line*, not every column move:
de-duplicate on `selection.active.line`, since a same-line horizontal cursor move must not re-fire),
`onDidSaveTextDocument` (a dirty document just became blameable again), and the `repo.changed`
forward already wired at `extension.ts:493-496` — a fourth line added there,
`blameWidget.notifyRepoChanged(payload)`, alongside the graph/review/reviewMarking three.

**Debounce**: same 150ms-on-rising-edge shape as G12 D10's `activityDebounce` (`extension.ts:418`
onward) — a burst of rapid cursor moves (arrow-key-held, a search jump) must not fire one `blame.line`
request per intermediate line; a `setTimeout` reset on every qualifying event, firing once 150ms
after the last one, same inline pattern (no shared debounce utility exists in this codebase to
import — `memoizedSetter.ts` is a different shape, a value-change gate, not a time gate).

**What skips the request entirely** (no debounce timer even started): no active editor; the active
document is not backed by a file (`document.uri.scheme !== 'file'`); no workspace folder contains it;
`manager.state.kind !== 'connected'`; and `document.isDirty` (§0's own call — shows the "Unsaved
changes" text state instead, next in this section).

**Resolving a `repoId` — the one real gap research flagged.** Nothing in the extension host already
holds "the repoId for the active editor's workspace folder": `proxyHandlers.ts`'s own
`repoRoots`/`activeRepoId` are private to its closure, and `ConnectionState` carries no repoId at all
— every existing host-side caller that needs one (`migrateLegacySettings`, `openRepository`) gets it
by calling `repo.open` itself, idempotent per `(connection, repoId)`. `blameWidget.ts` does the same:
`manager.request('repo.open', { path: workspaceFolder.fsPath })` once per workspace folder, caching
the resolved `repoId` in a small `Map<string, string>` keyed by the folder's own `nfcPath`-composed
fsPath for the life of the connection (cleared on `manager.onStateChange` leaving `connected`, the
same reset `lastAppInit` already gets at `extension.ts:566`) — never re-resolved on every keystroke,
only the first time a given folder is blamed from. A `repo.open` that fails (not a git repository)
memoizes to "no repoId for this folder" the same session, so a non-repo workspace folder does not
retry every debounce tick.

**Path resolution**: `path.relative(workspaceFolder.fsPath, document.uri.fsPath)`, NFC-composed the
same way every other filesystem-sourced path this extension sends over the wire already is (G27 D7
— `nfcPath`, already imported where `migrateLegacySettings` uses it).

**Rendering** shares the one `vscode.StatusBarItem` `updateStatusBar` (`extension.ts:224`) already
owns (G10 D16) — **not** a second status-bar item. `updateStatusBar`'s existing `connected` arm
(`extension.ts:245-267`) already branches on `active` (the in-flight indicator); this phase adds a
third input, `blame: BlameDisplayState | undefined`, consulted only inside the already-existing
`else` (not-busy) branch of that arm — busy and blame are mutually exclusive states of the same
item by construction (a blame result can't be showing while a request is in flight), so no new
precedence rule is invented, only one more thing the not-busy branch can render instead of the
plain `$(git-branch)` icon it falls back to today when there is nothing more specific to say.

`updateStatusBar` is called from five sites today (`extension.ts:429`, and inside
`onActivityChange`'s two branches and `onStateChange`'s two — confirmed by direct count, not
assumed), every one of which would otherwise need updating to thread a new parameter through. Rather
than widen all five call sites by hand, wrap the existing calls in one `render()` closure — reading
`isActive`, `lastAppInit` and the new `blame` variable directly, called with no arguments from all
five sites in place of today's `updateStatusBar(statusItem, manager.state, isActive, lastAppInit)` —
which is a pure refactor of the existing five call sites (behavior-preserving on its own, verified
by the existing manual-check posture §9 already commits to) landing in the same commit as the new
third input, not a second, separate change:

- No blame state yet (no active editor, untracked/new file, blame request failed, or the debounce
  window hasn't settled) → today's unchanged `$(git-branch)` / *Connected* tooltip. Any blame
  failure (untracked path, line past EOF, a `mapGitError` fallthrough) reads as "nothing to add here"
  and is swallowed the same way `state/schemaColumns.ts`'s `ensureSchemaColumns` catch already
  treats a rejected container — never a shown error for what is, from the editor's own vantage, a
  perfectly ordinary file.
- Dirty document → `$(git-branch) Unsaved changes` (§0).
- Uncommitted line (the all-zero sentinel) → `$(git-branch) Uncommitted`.
- A real blame line → `` $(git-branch) <author>, <age> `` (`author`/`summary`'s own local
  `formatRelativeDate`-shaped age string, §5a below), tooltip lines
  `['**Kira Studio**', '<summary>', '<author>, <absolute date>']` (`markdownTooltip`, reused
  verbatim), `item.command` set to `'kiraVersion.openCommitInGraph'` with `arguments: [{ repoId,
  sha }]` — the exact existing command `diffToolbar.ts`'s `openCommitInGraphCommand` already
  registers and already accepts an explicit `{repoId, sha}` argument for (`asExplicitTarget`,
  `diffToolbar.ts:155`), routing through `graphProvider.runUiAction('revealCommit', ...)` with zero
  new command registration (§6 states why no new command is needed at all).

**5a. Age formatting — a small local function, not a cross-boundary import.** `packages/git-ui`'s
`dateFormat.ts` already has the exact terse format this widget wants (`formatRelativeDate`), but
`@kira/git-ui`'s `package.json` exposes only `"exports": {".": "./src/index.ts"}` — no subpath, and
its barrel pulls in Vue/webview-only code no extension-**host** file has ever imported (confirmed:
`@kira/git-ui` today is imported from exactly one file in this package, `src/webview/main.ts` — the
webview bundle, a separate esbuild target from `extension.ts`'s own host bundle). Reusing it from
host code would be the first crossing of that boundary, for one ~10-line pure function. A small
local copy (`blameAge.ts`, same terse `now`/`2h`/`5d`/`3mo`/`1y` shape, its own `nowMs` parameter for
a deterministic test — `memoizedSetter.test.ts`'s own precedent for a tiny pure host-side helper
getting its own file and its own test) is the scoped answer.

## 6. Click-through — no new command

`kiraVersion.openCommitInGraph` (`diffToolbar.ts:135`, contributed via `commands.ts`'s existing
table) already accepts an explicit `{repoId, sha}` target (`asExplicitTarget`, `diffToolbar.ts:155`)
and already routes it through `graphProvider.runUiAction('revealCommit', ...)` — exactly SPEC's own
"click-through to the commit it names," already shipped in v1.3 for the diff-toolbar's identical
need. `vscode.StatusBarItem.command` accepts either a bare command-id string (every existing arm of
`updateStatusBar` uses that form) or a full `vscode.Command` object carrying its own `arguments` —
only the object form can pass one, so the blame arm sets `item.command = { command:
'kiraVersion.openCommitInGraph', title: 'Open Commit in Graph', arguments: [{ repoId, sha }] }`, the
one arm of `updateStatusBar` that differs from the rest in *shape*, not just value. No new command
id, no new registration in `commands.ts` (which would also have obligated a `commands.test.ts`
update — that file cross-checks its own command tables against `package.json` in both directions),
matching SPEC's own "commit.detail (G4) already renders a commit and is the natural click target"
framing precisely: the natural click target was already wired for a different caller, and this
phase is its second. One side effect worth stating, not hiding: `runUiAction` always focuses the
graph panel first (`panelView.ts:96`) — clicking a resolved blame line reveals the panel, which is
the point of "click-through," not an accident.

`commit.resolvePr` (G24): re-checked against SPEC's own wording — it is cited as *context* for why
`commit.detail`'s click-through is valuable (the detail view it opens can itself resolve a PR), not
as something this widget calls directly. The status bar shows author/age/summary only; it never
needs to know whether a commit shipped in a PR, and `openCommitInGraph`'s existing flow already
carries the user to the view that does. No new `resolvePr` call site.

## 7. Explicitly out of scope

- **A whole-file/gutter blame view** (a decoration per line, VS Code's own `TextEditorDecorationType`
  the way `reviewMarking.ts` already uses for its own gutter icons). Real, and the natural "next
  size up" from this row, but a materially bigger feature — its own line-by-line cache, its own
  invalidation on every edit (not just save), and its own rendering surface. SPEC's own wording
  ("a status-bar item showing... the active editor's current line") scopes this row to one line;
  a gutter view is a candidate for its own later phase.
- **Blaming an unsaved buffer's live content** (`--contents=-`). Probed and confirmed it resolves
  correctly (§0), but costs a second gitclient stdin-spawn capability, a wider contract param, and a
  buffer-bytes-on-every-keystroke-adjacent round trip, for a window (between an edit and its next
  save) the dirty-state message already covers honestly.
- **An `atSha` param / blaming any revision but the working tree.** No caller needs one — the
  status bar always shows "who last touched the line I'm looking at right now." `commit.detail`'s
  own file list is the surface for "blame as of this historical commit," if that is ever wanted, and
  is unaffected by anything in this phase.
- **A Go-side cache.** §3's own closing argument — no stable key exists for a working-tree blame the
  way one exists for a diff between two fixed tree oids.

## 8. Testing

1. **Go unit tests**, `internal/gitclient/porcelain/blame_test.go`: the three golden fixtures (§2)
   plus the hand-built unknown-attribute case. `internal/gitsession/queries_test.go` gains one
   `BlameLine` test exercising `ErrPathEscapesRoot` (mirrors the existing `GoToTarget` escape test
   at `queries_test.go:237` exactly) and one confirming a real fixture repo's committed line comes
   back with the right sha/author/summary end to end (spawns real git, same `newRepoBuilder`
   convention `fixtures_test.go` itself uses — `internal/gitsession`'s own tests already build real
   throwaway repos elsewhere in this package, this is not a new pattern for it).
2. **`internal/gitrpc`**: one `handlers_test.go`-style dispatch test (`blame.line` reaches
   `handleBlameLine`, not `E_UNKNOWN_METHOD`) and one `detail_test.go`-style params-validation test
   (empty `repoId`/`path`, `line < 1` → `E_BAD_REQUEST`) — same shape as
   `TestCommitDetailAndFileDiff_RejectOptionInjectingSHA`'s neighbours, minus the option-injection
   half (§1 already states why `path`'s `--` guard makes that class of test inapplicable here).
3. **`packages/git-ipc`**: `codec.test.ts`/`rpc.test.ts` gain the same round-trip coverage every
   prior contract addition gets there (encode/decode `blame.line`'s params and result shape;
   `CONTRACT_VERSION` mismatch still throws, already generically covered, no new test needed for
   that half).
4. **Extension-side pure logic**: `blameAge.test.ts` (§5a, `memoizedSetter.test.ts`'s own shape —
   a fixed `nowMs`, table of deltas → expected strings, boundary values at each unit transition).
   A second small test file for whatever pure "which state should the status bar show" selector
   this phase factors out of `blameWidget.ts` (dirty vs. uncommitted vs. resolved vs. nothing) —
   kept pure and vscode-API-free the same way `memoizedSetter.ts` is, specifically so it is testable
   under Bun with no `vscode` module to fake.
5. **No new Playwright/webview UI test** — nothing in this phase touches a webview; the status bar
   itself is native VS Code chrome, outside every existing `tests/ui/`/`apps/kira-studio-vscode/
   tests/` Playwright harness's own reach (those drive the webview's DOM, not the host window
   chrome). Verification of the rendered item is manual (§9) — consistent with how G10 D16/G12 D10
   themselves shipped without an automated status-bar-pixel test.

## 9. Verification

Fast checks per commit (`go build`/`go vet`, `bun run typecheck`, `bun run lint`), `AGENTS.md`'s
default. `go test ./internal/gitclient/... ./internal/gitsession/... ./internal/gitrpc/...` for the
new Go coverage. `bun test` (workspace-wide — the new `git-ipc`/extension pure-logic specs).
`KIRA_GIT_FIXTURES=write` run once to generate the three new fixtures, committed, then the suite
re-run without it to confirm the parser reads back its own golden bytes. Manual check in a real VS
Code Extension Development Host (this sandbox has no VS Code UI to automate against, per §8's own
note): open a tracked file, move the cursor across a committed line, an uncommitted line, and a
dirty (unsaved) line, confirm the status bar's three distinct renderings and that clicking a
resolved blame opens the named commit in the graph.
