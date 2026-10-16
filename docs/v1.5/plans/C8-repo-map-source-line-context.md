# C8 — Repo-map MCP: source-line context on results

Deliverable: `find_definition`, `find_references`, `find_implementations` and `search_symbols` print
the literal source line at each hit's position, under the hit's own grep-style line. `outline_file`
and `search_files` are unchanged.

Reference: `docs/v1.5/SPEC.md`'s C8 row; evidence in `docs/v1.5/mcp-ab-test.md` §Results
(Implementation stage). Predecessors: `docs/v1.5/plans/C3-mcp-repo-map-server.md` (the server),
`docs/v1.5/plans/C1-tree-sitter-sqlite-cache.md` (`codeindex`),
`docs/v1.5/plans/C2-code-graph.md` (`codegraph`).

## 0. What C3 shipped, and what C8 changes

`internal/repomap` is a wire format over `codegraph.Graph`. Every response today is synthesized from
indexed metadata alone. `render.go:13-15`:

```go
func position(path string, p codegraph.Point) string {
	return fmt.Sprintf("%s:%d:%d", path, p.Row+1, p.Column+1)
}
```

and `renderTargetLine` (`render.go:29-31`) emits `path:line:col  kind name  confidence  rule`.
`renderReferences` (`render.go:57-81`) emits `path:line:col   kind   in Enclosing`. Neither carries
a byte of the file.

Three places state that as a guarantee:

- `render.go:11-12` — "this server never reads file bytes, so it cannot convert one".
- `server.go:187` (`instructions`, the paragraph every MCP client sees) — "answer navigation
  questions from a pre-built index without reading files".
- `server.go:220` (`outline_file`'s description) — "without reading its bytes".

C8 breaks the first two deliberately and keeps the third true (see §9).

## 1. The evidence, and the exact gap

`docs/v1.5/mcp-ab-test.md` §Results, Implementation stage, Arm A's own self-report: `outline_file`
saved a discovery step on unfamiliar Go files, but **every file still needed a full `Read` after it**
for exact shapes. Tokens and duration came out within noise between arms (498,227 vs 498,521;
50.2 vs 50.4 min). The verdict row names C8 as the mechanism that could change that.

Scope boundary, stated so it is not conflated: Arm A also logged that **constants** (Go `const`,
TS `export const`) are absent from the index entirely. That is a separate open gap in
`docs/v1.5/mcp-repo-map-issues.md`, about *what resolves*. C8 is about *what is printed next to a
hit that already resolves correctly*. C8 fixes nothing about constants and must not pretend to.

## 2. What SPEC left open, and how each is resolved

**D1 — How a line is read: group hits by file, one open, one forward pass.** Not open-and-seek per
hit, not `ReadAt` windows around `NameSpan.StartByte`. Measured against this repository's own index
(`/root/.kira-studio/codeindex.db`, rows scoped to this worktree's own `repo_id`): **1,797 indexed
files, mean 8,580 bytes, max 164,344 bytes, 5 files over 100 KB, 13,290 symbols**. Measured
worst-case fanout, live, against a running `kira-repo-map` on this repo:

| call | hits | distinct files |
|---|---|---|
| `search_symbols query=e substring=true limit=200` | 200 | **131** |
| `find_references Store` (file-disambiguated, `codeindex/store.go`) | 54 | 19 |
| `find_references Point` (file-disambiguated, `codegraph/codegraph.go`) | 29 | 8 |
| `find_references Sync` | 17 | 6 |
| `find_references ValidateRelPath` | 3 | 3 |

The realistic ceiling is therefore ~131 distinct files, ~1.1 MB read, page-cached — single-digit
milliseconds. The hard ceiling is `findReferencesMaxLimit = 500` (`tools.go:114`) distinct files,
each bounded at `codeindex`'s own `maxFileBytes = 2 * 1024 * 1024` (`codeindex/sync.go:18-19`),
because a file over that cap is recorded `tooLarge` with **no symbols and no references**, so it can
never own a hit.

Against those numbers a `ReadAt` window buys nothing worth its cost: it needs a backward newline
scan, partial-line-on-both-sides handling, and it sources the text from `NameSpan.StartByte` while
the printed line number comes from `NameSpan.Start.Row` — two index fields that agree only while
fresh. A forward pass keyed on `Row` makes the printed line number and the printed text the *same*
fact by construction. Per `CLAUDE.md`: the measurement was worth taking because it decides this; it
decided for the simpler shape.

**D2 — Nothing existing reads a line by number; C8 needs its own reader.** Checked:

- `codeworkspace.LineIndex` (`codeworkspace/textpos.go:32-48`) is a whole-file `[]byte` plus a
  `starts []int` table, built for Monaco UTF-16 column conversion. It requires the caller to already
  hold the entire file in memory and offers no line-text accessor at all (`lineBounds` is
  unexported, `ByteOffset`/`Position` return offsets). Wrong shape and wrong package.
- `internal/codegraph` reads no files. `internal/codeindex` reads files only inside `parseOne`
  (`sync.go:220+`), whole-file, to hash and parse.
- C7's `codeworkspace/search.go` scanner **is not on `v1.5`** — it exists only on `v1.5-c7-arm-a`
  and `v1.5-c7-arm-b`, and the ab-test defers the canonical-implementation choice until after the
  C8 re-run. C8 must not depend on it, and must not be blocked on it.

So: a new `internal/repomap/source.go`, self-contained, ~120 lines.

**D3 — Per-line cap: 512 bytes, truncate with `…`, never omit.** Precedents in this repo:
`codeworkspace.MaxReadBytes = 8 * 1024 * 1024` (viewer, `files.go:18-20`),
`binarySniffBytes = 8 * 1024` (`files.go:22-23`), C7's `maxSearchLineBytes = 1 * 1024 * 1024` (both
arms, identically). Those three bound *memory*, not *display*. A rendered line goes into an LLM's
context, so the display cap is the one that matters and none of the three transfers. 512 bytes is
~4x the longest line this repository actually formats and ~128 tokens worst case.

Truncate rather than omit: the head of an over-long line is the informative half (a minified
bundle's first statement still names what the file is), and omitting would make a hit look
unreadable when it is merely long. Cut on a UTF-8 rune boundary, append `…`. The cap is stated in
`instructions` so a caller never has to guess whether `…` is code or a marker.

Response-cost arithmetic, stated honestly rather than hidden: at `find_references`' **default**
limit of 100 (`tools.go:113`) and this repository's typical ~50-byte source lines, C8 adds ~5 KB to
a full-limit response; at the 500 hard cap with pathological 512-byte lines, ~256 KB. The trade is
against one `Read` of an 8.6 KB mean file. See D8 for the caller's opt-out and §15 OQ4.

**D4 — Staleness: compare `os.Stat` against the indexed row, reusing `codeindex`'s own rule.**
`codeindex/sync.go:201-217`'s `isStale` is the existing definition:

```go
return info.Size() != existing.SizeBytes || info.ModTime().UnixNano() != existing.MtimeUnixNs
```

`content_sha` is deliberately not a comparand there (it is computed only once a file is actually
read). `FileRow` (`codeindex/store.go:22-35`) carries `SizeBytes`/`MtimeUnixNs`, and
`Store.GetFile(ctx, repoID, path)` (`store.go:329-353`) already has a caller inside `repomap`
(`tools.go:183-185`). There is no cheaper global signal: the only `meta` keys written are
`last_full_sync_at`, `last_used_at`, the repo root and the parser fingerprint (`sync.go:56,111,124,337`)
— none is a per-file version counter.

The race is real but narrow: the watcher debounces at `watchDebounce = 200 * time.Millisecond`
(`codeindex/watch.go:18-21`) and then reparses, so an edit's stale window is roughly that plus one
file's parse. C8 detects it rather than silently printing a line from the wrong revision.

Detected-stale behaviour is decided by the SPEC row itself — "a stale line, read honestly and
labeled as such, never silently presented as current" — so: print the line, prefix `[stale] `.

Cost: one `GetFile` per distinct file. 131 point queries against local SQLite is ~10 ms. A batched
`FilesByPaths` mirroring `read.go:192`'s `FilesByIDs` is the obvious next step if that ever shows up
in a trace; it does not now, so it is not built (`CLAUDE.md`: skip a measurement, and an
optimisation, that would not change the decision).

**D5 — Safe failure: always a parseable note, never an error, never `IsError`.** Every failure keeps
the hit line exactly as it is today and replaces the source line with `[no source: <reason>]`:

| condition | reason text |
|---|---|
| path fails the containment check | `path outside repository` |
| `os.Open` → `IsNotExist` | `file not found` |
| open succeeds, not a regular file | `not a regular file` |
| any other open/read error | `unreadable` |
| EOF before the indexed row | `line N past end of file` |
| a NUL byte inside the line | `binary content` |

A line that is empty after trimming emits **no** continuation line at all (nothing to say). An
internal fault building the whole lookup (a store error) drops every source line for that response
and logs at debug — the tool still answers. This follows `render.go`'s existing posture: never
crash, always return something parseable, and `errResult` (`tools.go:20-25`) stays reserved for
caller-correctable input problems.

**D6 — Path safety: extract `ValidateRelPath` into a new leaf package, `internal/pathsafe`.**

There is no import cycle today: `internal/codeworkspace` imports `codeindex`, `codegraph`,
`gitclient`, `gitclient/catfile`, `gitclient/porcelain` and nothing from `repomap`; `repomap`
imports `codegraph`, `codeindex`, `config`, `mcpauth`, `gitclient`. `repomap` → `codeworkspace`
would compile, and `internal/layering_test.go` only forbids importing `internal/bridge`. So a direct
import is *available* — it is still the wrong call:

1. It couples two sibling domain packages for one pure function, and drags `catfile`/`porcelain` and
   the whole `codeworkspace.Session` graph into the headless `cmd/kira-repo-map` binary.
2. The repo already carries **two** independent path-containment implementations —
   `codeworkspace.ValidateRelPath` (`paths.go:26-60`, the strong one: reject absolute, reject `..`,
   then `filepath.EvalSymlinks` both sides and require containment) and
   `gitsession.GoToTarget`'s inline check (`gitsession/queries.go:459-463`, join + `filepath.Rel`
   only, no symlink resolution). A third copy inside `repomap` would make three. `CLAUDE.md`'s
   library-reuse bar applies to internal infrastructure too.
3. `internal/gitpath` is this repo's own precedent for exactly this: a leaf package with zero
   internal imports, created because several unrelated packages needed one shared rule and shared no
   sane common import.

So: move `ValidateRelPath`, `requireUnder` and `ErrPathEscapesRoot` into `internal/pathsafe` (zero
internal imports), and leave `codeworkspace/paths.go` as a two-line delegate plus
`var ErrPathEscapesRoot = pathsafe.ErrPathEscapesRoot`. Every existing call site
(`codeworkspace/diff.go:36`, `codeworkspace/nav.go:41`, `bridge/codeworkspace.go:216`) compiles
unchanged, `errors.Is` keeps working, and both unmerged C7 arm branches — which call
`ValidateRelPath` from `codeworkspace/search.go` — keep compiling when whichever one merges.

`gitsession`'s weaker check is **not** touched: different package, different purpose (a rev/path
go-to target, not a worktree read), and folding it in is scope C8 was not given.

Why the check is needed at all, given paths come from the index and not the caller: `codeindex`
enumerates through `git ls-files --cached --others --exclude-standard` (`codeindex/enumerate.go:47`),
which lists a tracked **symlink** as an ordinary path. Opening one follows it. `EvalSymlinks`-based
containment is what keeps a repository that tracks `link -> /home/user/.ssh/id_rsa` from turning a
`find_references` response into a key dump.

**D7 — One line, not a window.** The SPEC row says "the literal source line at each hit's position".
Uniform across all four tools, uniform cost per hit, no new parameter. The known limit: a definition
whose signature wraps across lines shows only the identifier's own line. See §15 OQ1 — this is the
one design point where a human may reasonably want more.

**D8 — Additive shape plus an `omitSource` opt-out.** The source line is a *continuation* line: four
leading spaces, emitted after its hit line. Every existing hit line is unchanged byte for byte, and
no existing hit line in any of the four renderers can begin with whitespace (they all begin with
`position(...)`, and a repository-relative path never starts with a space). A parser that reads one
hit per line keeps working by discarding leading-space lines. `omitSource` (default false, i.e.
source lines on) restores the exact pre-C8 bytes for a caller that wants the compact shape back.

**D9 — `renderAmbiguous` gets source lines too.** It renders `Target`s through `renderTargetLine`
(`render.go:185-193`) and its whole job is helping the caller pick one of several same-named
symbols. The source line is precisely the disambiguator. `renderOutline` and `renderFileSearch` get
nothing (SPEC's own exclusions).

## 3. Where the code lives

| file | change |
|---|---|
| `apps/kira-studio/internal/pathsafe/pathsafe.go` | **new** — moved from `codeworkspace/paths.go` |
| `apps/kira-studio/internal/codeworkspace/paths.go` | shrinks to a delegate + error alias |
| `apps/kira-studio/internal/repomap/source.go` | **new** — the reader, caps, staleness, notes |
| `apps/kira-studio/internal/repomap/source_test.go` | **new** — §11 |
| `apps/kira-studio/internal/repomap/render.go` | four renderers + `renderAmbiguous` take `sourceLines` |
| `apps/kira-studio/internal/repomap/tools.go` | four handlers build the lookup; `omitSource` field |
| `apps/kira-studio/internal/repomap/server.go` | `instructions` and two tool descriptions |
| `apps/kira-studio/internal/repomap/conformance_test.go` | one added assertion (§11) |
| `docs/ARCHITECTURE.md` | §12 |
| `docs/DEV_ENVIRONMENT.md` | §12 |

## 4. `source.go`

### 4.1 Types

```go
// sourceLine is one hit's own line of code as read from disk — or the honest reason it is absent.
type sourceLine struct {
	Text      string // trimmed, truncated and sanitised; empty when Note is set
	Truncated bool   // Text was cut at sourceLineMaxBytes
	Stale     bool   // the file on disk no longer matches the row the index was built from
	Note      string // non-empty means no line: "file not found", "unreadable", ...
}

// sourceLines is path -> 0-based row -> line. A nil map answers "not found" for everything, which
// is exactly what every renderer does with a missing entry: print nothing extra.
type sourceLines map[string]map[int]sourceLine

// hitPos is one position a renderer is about to print — the (path, row) pair position() renders.
type hitPos struct {
	Path string
	Row  int // 0-based, as codegraph stores it
}
```

`sourceLineMaxBytes = 512` (D3). `sourceReadBufBytes = 64 * 1024` — the `bufio.Reader` size; it
bounds peak memory per file at 64 KiB regardless of line length, since an over-long line is drained,
not buffered.

### 4.2 Entry point

```go
func (s *Server) sourceFor(ctx context.Context, hits []hitPos) sourceLines
```

1. Group `hits` into `map[string][]int`, rows deduped and sorted ascending.
2. For each path, in map order, checking `ctx.Err()` first:
   a. `pathsafe.ValidateRelPath(s.root, path)` → `abs`, or every row gets
      `Note: "path outside repository"`.
   b. `s.store.GetFile(ctx, s.repoID, path)` → the indexed `FileRow` (a miss or an error means
      staleness is simply unknown; read the line anyway, `Stale` false — an unknown is not a lie,
      and the index having no row for a path it just returned a hit from is itself transient).
   c. `os.Open(abs)`, `f.Stat()`. Classify per D5's table. `info.Mode().IsRegular()` is required.
   d. `stale := row.SizeBytes != info.Size() || row.MtimeUnixNs != info.ModTime().UnixNano()` —
      `codeindex`'s own rule (D4), via the exported helper S1 adds.
   e. `readRows(f, rows)` → `map[int]sourceLine`, then stamp `Stale` onto each.
3. Never returns an error. A store or path failure degrades one file; nothing degrades the response.

Sequential, no goroutine pool: 131 files × 8.6 KB mean is ~1.1 MB of page-cached reads (D1), and a
pool would add cancellation and ordering machinery to save single-digit milliseconds.

### 4.3 `readRows` — the forward pass

```go
func readRows(f *os.File, rows []int) map[int]sourceLine
```

`bufio.NewReaderSize(f, sourceReadBufBytes)`, walk from row 0, capture the rows in `rows` as they go
by, stop after the last one. EOF before a wanted row → that row and every later one get
`Note: fmt.Sprintf("line %d past end of file", row+1)`.

Per-line read uses `ReadSlice('\n')` in a loop, **not** `bufio.Scanner`. `Scanner` aborts the whole
scan with `ErrTooLong` on the first over-long line, which would silently drop the source line of
every later hit in the same file — the exact failure a minified vendored file in the middle of a
`search_symbols` response would cause. `ReadSlice` returns `ErrBufferFull` and keeps going:

```go
// readLine returns the line's first sourceLineMaxBytes bytes (EOL excluded), whether it was cut,
// and whether EOF ended the file before any byte was read. An over-long line is drained, never
// buffered — peak memory is sourceReadBufBytes, not the line's own length.
func readLine(r *bufio.Reader) (buf []byte, truncated bool, eof bool)
```

`ReadSlice`'s returned slice is only valid until the next read, so the kept prefix is copied.

### 4.4 Sanitising, in this order

1. Drop a trailing `\n`, then a trailing `\r` (a CRLF file's own line, same rule as
   `codeworkspace/textpos.go`'s rule 1).
2. If the raw bytes contain `0x00` → `Note: "binary content"`, no text. (Reachable only after a file
   changed kind since indexing: `codeindex` records a binary file as `StatusBinary` with no symbols,
   so it owns no hits.)
3. Truncate to `sourceLineMaxBytes`, backing off to the last UTF-8 rune boundary.
4. `strings.TrimSpace`. Indentation carries nothing the caller needs — the position already gives
   the column — and dropping it keeps the output aligned under a fixed four-space prefix. The text
   itself stays literal: nothing is reflowed, reordered or summarised.
5. Replace each interior `\t` with one space, and each remaining C0/`0x7f` control byte with
   `�`. Both are rendering, not editing: a raw control byte in a printed line can break the
   one-continuation-line-per-hit shape the format depends on. Invalid UTF-8 needs no handling of its
   own — `encoding/json` replaces each bad byte with `�` crossing the wire, the same fact
   `textpos.go`'s rule 3 already documents.
6. Empty after all of that → no entry (D5).

## 5. `render.go` changes

Each of the five affected renderers takes one added `src sourceLines` parameter and calls one new
helper after writing its hit line:

```go
// writeSource appends one hit's own source line, indented four spaces so it can never be mistaken
// for a hit line (every hit line starts with a path). Nothing is written when src has no entry.
func writeSource(b *strings.Builder, src sourceLines, path string, row int) {
	ln, ok := src.at(path, row)
	if !ok {
		return
	}
	b.WriteString("\n    ")
	if ln.Note != "" {
		b.WriteString("[no source: " + ln.Note + "]")
		return
	}
	if ln.Stale {
		b.WriteString("[stale] ")
	}
	b.WriteString(ln.Text)
	if ln.Truncated {
		b.WriteString("…")
	}
}
```

Call sites: `renderDefinitions` (`render.go:48-51`), `renderReferences` (`71-79`),
`renderImplementations` (`103-106`), `renderSymbolSearch` (`121-124`), `renderAmbiguous`
(`188-191`). Each passes `t.NameSpan.Start.Row` / `s.NameSpan.Start.Row` — the same field
`position()` prints, so the printed number and the printed text can never disagree.

`renderTargetLine` itself is untouched (it renders one line and knows no row-to-source mapping);
the continuation is written by its callers, which is also what keeps `renderOutline` free of it.

## 6. `tools.go` changes

Each of the four handlers, after it has its results and before it renders:

```go
targets, err := s.graph.DefinitionOf(ctx, q)
...
src := s.sourceForTargets(ctx, in.OmitSource, targets)
return textResult(renderDefinitions(name, resolvedFrom, targets, src))
```

Two one-line adapters, `sourceForTargets([]codegraph.Target)` and `sourceForSites([]codegraph.Site)`,
build `[]hitPos` and return `nil` immediately when `omitSource` is set.

`locatorFields` (`tools.go:35-40`) gains the opt-out, so all three navigation tools inherit it from
one declaration; `searchSymbolsArgs` (`191-197`) gains its own copy:

```go
OmitSource bool `json:"omitSource,omitempty" jsonschema:"Omit the source line printed under each hit. Default false — each hit is followed by its own line of code, indented."`
```

A plain `bool` whose zero value means "include" — no pointer, no schema gymnastics, and `omitempty`
keeps it out of a request that does not set it.

`findReferences`' resolved path can return the definition's own site (`IncludeDefinition`,
`codegraph/references.go:209`); it carries a `NameSpan` like any other and needs no special case.

## 7. `server.go` changes

`instructions` (`server.go:187`) — the "without reading files" clause becomes true-as-written again,
and the new behaviour and its cap are stated, because this paragraph is the only place an LLM caller
learns the format:

> These tools answer navigation questions from a pre-built index; prefer them to opening a file to
> find a definition. Positions are 1-based lines; a column, where given, is a 1-based byte column.
> Each hit is followed by its own line of source, indented, read from the file at that position and
> truncated at 512 bytes with a trailing `…`; `[stale]` marks a file changed since it was indexed,
> `[no source: …]` a line that could not be read. Pass `omitSource` to drop them. Results are
> name-resolved, not type-resolved, and each carries its own confidence and the rule that produced
> it.

`outline_file`'s description (`server.go:220`) keeps "without reading its bytes" — still literally
true, and now the sentence that tells a caller which tool is the cheap one. `find_definition` and
`find_references`' descriptions each gain one clause naming the source line, so a caller choosing a
tool from `tools/list` alone sees it.

## 8. Read-only

Preserved, not crossed. `repomap` still writes nothing: `os.Open` is read-only, no truncate, no
create, no rename. What changes is *read scope* — from "the SQLite index only" to "the index plus
the bytes of files already inside the indexed worktree", gated by `pathsafe.ValidateRelPath`.

The "never reads file bytes" claim is retired in all three of its current spellings
(`render.go:11-12`, `server.go:187`, and `docs/ARCHITECTURE.md`'s `internal/repomap` section at
line ~937) rather than left to quietly become false. `render.go:11-12`'s specific claim — that the
server cannot convert a byte column to a UTF-16 column because it holds no bytes — stays accurate in
its *conclusion*: C8 reads one line per hit, never a whole file, and deliberately does not start
converting columns. That comment is rewritten to say so instead of being deleted.

## 9. Implementation steps

`go build ./...`, `go vet ./...` and `gofmt` pass at every step. The expensive suites run once, at
S8, per `CLAUDE.md`.

**S1 — `internal/pathsafe`.** Move `ValidateRelPath`/`requireUnder`/`ErrPathEscapesRoot` out of
`codeworkspace/paths.go`, error strings re-prefixed `pathsafe:`. `codeworkspace/paths.go` becomes
the delegate plus the error alias. Add `codeindex.FileRow.MatchesDisk(info os.FileInfo) bool` and
make `Index.isStale` (`sync.go:204-217`) call it, so D4's comparison has one definition. No
behaviour change anywhere; `go test ./internal/...` is the guard.

**S2 — `source.go`: types, caps, `readLine`, `readRows`.** The forward pass and the sanitiser, no
`Server` method yet. Pure functions over an `*os.File`/`*bufio.Reader`.

**S3 — `source_test.go`.** §11's table. Lands with S2's code, before anything depends on it.

**S4 — `Server.sourceFor` plus the two adapters.** Path validation, `GetFile`, stat, staleness
stamping, D5's whole note table.

**S5 — `render.go`.** `writeSource`, `sourceLines.at`, the five renderer signatures and their call
sites. Working increment: the renderers emit continuation lines for any lookup handed to them.

**S6 — `tools.go`.** `OmitSource` on `locatorFields` and `searchSymbolsArgs`; the four handlers
build and pass the lookup. Working increment: a live `curl` against all four tools shows source
lines (§14).

**S7 — `server.go` strings**, and the added conformance assertion (§11).

**S8 — Docs (§12) and verification (§14).**

Sequencing: S1 before S4 (it supplies both helpers). S2 before S4, S3 with S2. S5 before S6. S7 and
S8 last. Nothing here is parallelizable across subagents — it is one continuous change to one
package.

## 10. Testing

`CLAUDE.md`'s bar: a dedicated test only for logic genuinely hard to get right.

**`internal/repomap/source_test.go` — earns one.** `readRows`/`readLine` is boundary arithmetic with
several interacting rules, the same grounds `codeworkspace/textpos_test.go` was earned on. Table
cases over in-memory fixtures written to a `t.TempDir()`:

- multiple wanted rows in one file, out of order on input, all returned;
- a line longer than `sourceLineMaxBytes` **followed by** a wanted row — the case
  `bufio.Scanner` would have silently lost, asserting both the `…` on the long line and the correct
  text on the later one;
- a line whose 512-byte cut lands mid-rune (multi-byte runes straddling the boundary), asserting the
  result is valid UTF-8 and no rune is halved;
- CRLF, and a file with no trailing newline on its last line;
- a wanted row past EOF → `line N past end of file`;
- a NUL byte in a wanted line → `binary content`;
- a whitespace-only line → no entry;
- interior tab and interior `0x01` → one space and `�`.

**`conformance_test.go` — one added assertion, not a new test.** `newConformanceServer`
(`conformance_test.go:19-47`) seeds `main.go` into the store with `root` a `t.TempDir()` that has no
such file. That is already an exact reproduction of D5's missing-file case, and the existing test
asserts only "not `IsError`" — so after C8 it silently proves the safe-failure path. Make it
explicit: assert the `find_definition` response contains `[no source: file not found]` and that
`res.IsError` is still false. That is the one claim worth pinning, because "a deleted file must not
turn a navigation answer into an error" is the whole of D5.

**Nothing else.** `writeSource`, the `omitSource` branch, the adapters and the note strings are
short, single-condition string building — `render.go`/`tools.go` already earn no tests by §11 of the
C3 plan's own stated bar, and C8 changes nothing about that.

## 11. Documentation to update

- **`docs/ARCHITECTURE.md`**, `internal/repomap` section (~line 937): the "a grep-like text
  rendering (`render.go`)" sentence gains the source line, the cap, the `[stale]`/`[no source: …]`
  markers and the fact that this is the one place the server touches the filesystem. The new
  `internal/pathsafe` package gets its own short entry naming its two callers and why it is a leaf
  (mirroring how `internal/gitpath` is described).
- **`docs/DEV_ENVIRONMENT.md`**, "repo-map MCP server" section (~line 254): one line noting that
  responses now carry source lines, since the section's own `curl` recipe output changes shape.
- **`docs/v1.5/mcp-repo-map-issues.md`**: nothing. C8 is planned work, not a dogfooding finding, and
  the constants gap stays open and untouched.
- **`CLAUDE.md`**: nothing. Process only; this is an app fact.

## 12. Explicitly out of scope

- `outline_file` and `search_files` (SPEC's own exclusions).
- A multi-line window (§15 OQ1).
- The missing-constants gap (§1).
- Byte-column to UTF-16-column conversion, now that bytes are available (§8) — no caller asked, and
  `codeworkspace.LineIndex` already serves the one surface that needs it.
- Folding `gitsession`'s weaker containment check into `pathsafe` (D6).
- Any change to `find_references`' default or max limit (§15 OQ4).
- Re-running the C7 A/B implementation stage against the improved server — that is the *next* task,
  named by the ab-test's own verdict row, and it must run against C8 already merged.

## 13. Verification

### 13.1 Build, vet, test

```
go build ./...
go vet ./...
go test ./apps/kira-studio/internal/...
gofmt -l apps/kira-studio/internal
```

Frontend is untouched, so `bun run typecheck` / `lint` / `build` are run once as a regression check
only — no frontend file is in §3's table.

### 13.2 Live smoke test, before and after

Per `CLAUDE.md`'s HTTP recipe. Start the server and capture the token it prints:

```
bun run mcp:repo-map:build     # once per clone
bun run mcp:repo-map           # background it; prints the Bearer token on a fresh mint
```

(If it prints "Using this repository's existing token", delete that repository's
`mcp-repo-map-*-token.json` under `KIRA_HOME` and restart to mint a readable one.)

```
call() { curl -s http://127.0.0.1:8765/mcp -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"; }
call find_references '{"symbol":"ValidateRelPath"}'
```

**Before (captured live from this repository at `52270fe6`, `result.content[0].text`):**

```
3 references to "ValidateRelPath"
apps/kira-studio/internal/codeworkspace/diff.go:36:18   call   in ReadDiff
apps/kira-studio/internal/codeworkspace/nav.go:41:18   call   in Definitions
apps/kira-studio/internal/bridge/codeworkspace.go:216:32   call   in ReadFile
```

**After (the shape S6 must produce — every hit line above byte-identical, one indented line added
under each):**

```
3 references to "ValidateRelPath"
apps/kira-studio/internal/codeworkspace/diff.go:36:18   call   in ReadDiff
    absPath, err := ValidateRelPath(s.Root, relPath)
apps/kira-studio/internal/codeworkspace/nav.go:41:18   call   in Definitions
    absPath, err := ValidateRelPath(s.Root, relPath)
apps/kira-studio/internal/bridge/codeworkspace.go:216:32   call   in ReadFile
    absPath, err := codeworkspace.ValidateRelPath(sess.Root, args.Path)
```

(Those three continuation lines are the real current contents of `diff.go:36`, `nav.go:41` and
`bridge/codeworkspace.go:216`, trimmed — read at plan time. The check at implementation time is that
each printed line equals `sed -n '<line>p' <path>` trimmed, not that it still matches this document.)

Six checks against the same running server:

1. **Line fidelity.** For each hit in the block above, `sed -n '36p'
   apps/kira-studio/internal/codeworkspace/diff.go` trimmed equals the printed continuation line.
2. **The other three tools.** `call find_definition '{"symbol":"spanFromBytes"}'` (one hit,
   `codegraph/position.go:13:6` today) and `call search_symbols '{"query":"spanFrom","limit":5}'`
   each gain one continuation line. `call find_implementations '{"symbol":"Runner"}'` resolves to
   four same-named symbols today and so returns `renderAmbiguous`, not an implementations list —
   which makes it the D9 check: all four candidate lines gain their source line, the thing that
   makes the candidates distinguishable. The Go-interfaces honesty message (`render.go:86`) is
   unchanged when it fires.
3. **Unchanged tools.** `call outline_file '{"file":"apps/kira-studio/internal/repomap/render.go"}'`
   and `call search_files '{"query":"render"}'` are byte-identical to their pre-C8 output.
4. **Opt-out.** `call find_references '{"symbol":"ValidateRelPath","omitSource":true}'` reproduces
   the "before" block byte for byte.
5. **Scale and staleness, in one pass.** `call search_symbols '{"query":"e","substring":true,
   "limit":200}'` — the measured 200-hit / 131-file worst case (D1). Confirm it answers in well
   under a second and that every hit has a line. Then, while the server runs, append a line near the
   top of one hit file and immediately re-issue: hits in that file print `[stale]` until the
   watcher's ~200 ms debounce plus reparse lands, after which they print fresh again. This is the
   one check that cannot be made from a unit test — it needs the live watcher.
6. **Missing file.** `git mv` a hit file aside, re-issue the query before the watcher catches up:
   `[no source: file not found]`, `IsError` still false, every other hit unaffected.

### 13.3 What is not measured

No CDP trace, no bundle comparison, no profiling run. D1's decision rests on a file-count and
file-size measurement already taken against this repository's real index, and nothing else in C8
poses a question a measurement would settle.

## 14. Open questions for a human

**OQ1 — Multi-line definitions.** D7 prints only the identifier's own line. A Go function whose
parameters wrap, or a TS generic spanning three lines, shows a fragment. `codegraph.Target.Span`
(the whole definition, `codegraph.go:60`) is right there, so `find_definition` /
`find_implementations` / `search_symbols` *could* print `Span.Start.Row` through
`min(Span.End.Row, Start.Row+2)` at roughly 3x the cost for those three tools. The recommendation is
to ship single-line and revisit if the C7 A/B re-run shows implementers still reading the file
afterward for signatures specifically — but this is a product judgement about what an LLM caller
needs, and a human may reasonably want the window in the first version.

**OQ2 — Is `omitSource` worth the schema surface?** D8 adds one field to four tools for a caller
that wants the old compact shape. It is cheap and additive, but it is also four more fields in a
schema an LLM reads on every `tools/list`, for a case nobody has yet asked for. Cutting it is a
one-line change to this plan.

**OQ3 — `pathsafe` extraction versus the cheap import.** D6 recommends the extraction, and the
reasoning holds on its own. But it touches `codeworkspace`, a package both unmerged C7 arm branches
have modified, and the canonical C7 arm has not been chosen yet (ab-test verdict, deferred until
after the C8 re-run). The delegate shim is designed so either branch still merges cleanly, and the
move itself is ~70 lines with three call sites — but a human who wants zero cross-branch risk can
have `repomap` import `codeworkspace.ValidateRelPath` directly instead, and schedule the extraction
for after C7 merges.

**OQ4 — 512 bytes, and `find_references`' default limit of 100.** The cap value is a judgement, not
a derivation: 512 is ~4x this repository's longest formatted line. Separately, each hit now costs
roughly 5x what it did, so a default-limit `find_references` response grows from ~4 KB to ~9 KB.
Dropping the default from 100 to something smaller would be a *behaviour* change to an existing
tool, which C8 was not asked to make — flagged rather than done. Both numbers are one-constant
changes if a human wants different ones.
