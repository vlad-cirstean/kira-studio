# P68b — `outline_file`: absent file vs. definition-free file

Plan for SPEC row P68b. Closes the non-trivial dogfooding finding logged in
`docs/v1.6/mcp-repo-map-issues.md` ("P68 (code review, dimension 1)"). Small phase: one behavior
distinction, one test, one doc update.

## 1. Problem

`outline_file` renders one sentence — `"%s has no indexed definitions"` — for situations that need
different recoveries. Reproduced live against this worktree's own server at `6ecf6b59`:

| Call | Current answer |
| --- | --- |
| `{"file":"apps/kira-studio/internal/codegraph/graph.go"}` (typo; real file is `codegraph.go`) | `... has no indexed definitions` |
| `{"file":"apps/kira-studio/internal/does-not-exist-at-all.go"}` | `... has no indexed definitions` |
| `{"file":"README.md"}` (on disk, language not indexed) | `... has no indexed definitions` |
| `{"file":"apps/kira-studio/internal/repomap"}` (a directory) | `... has no indexed definitions` |
| `{"file":"packages/git-ui/src/icons/codicon.css"}` (indexed, genuinely zero definitions) | `... has no indexed definitions` |

Only the last row is true. The first four are wrong answers, not empty ones, and a caller who
believes them concludes a file has no definitions when it was never indexed at all. The honest
recovery — call `search_files` after every empty outline — is the extra round trip this server
exists to remove.

The two nonexistent-path rows are the finding's own repro. The `README.md` and directory rows are
new, found while confirming it; same defect, same fix, no scope growth.

`/etc/hosts` already answers correctly (`... is not inside this repository (/home/user/kira-studio)`,
from `relFile`), so only the in-repo cases are open.

## 2. Confirmed current state

- `render.go:179-208` `renderOutline`: `len(nodes) == 0` → `fmt.Sprintf("%s has no indexed
  definitions", path)` (line 181). No path check, and none is possible here — it never sees the
  index.
- `tools.go:396-416` `outlineFile`: validates `file`, `relFile`s it, calls `inst.graph.Outline`,
  renders. A Go error from `Outline` is treated as an internal fault; everything else renders.
- `codegraph/outline.go:13-26` `Graph.Outline` **already makes the check and throws it away**:

  ```go
  file, ok, err := g.store.GetFile(ctx, g.repoID, path)
  if err != nil { return nil, err }
  if !ok { return nil, nil }          // ← "no such file" collapsed into "no definitions"
  ```

  So no new query capability is needed, and no second lookup either. `codeindex.Store.GetFile`
  (`store.go:463`) selects on `UNIQUE (repo_id, path)` (`migrations/0001_c1_init.sql:8-21`) — an
  index hit, and it is the same `file` table `search_files` lists, so "indexed" means the same
  thing in both tools.
- `Graph.Outline` has exactly one caller in the tree (`tools.go:412`) and none in any test, so its
  signature is free to change.
- Precedent for the distinction in-package: `source.go:266-320` `sourceForOneFile` already separates
  `file not found` / `unreadable` / `not a regular file`, each via `pathsafe.ValidateRelPath` then
  `os.Open`/`Stat`.
- `inst.text` (`tools.go:47`) prepends P67f's degraded-index notice; `errResult` (`tools.go:21`) does
  not. Every current `errResult` caller is argument validation, where the index state is irrelevant —
  the new message is an index-derived claim, so it needs the notice.

## 3. Fix

### 3.1 Carry the distinction out of `codegraph`

`Graph.Outline` returns whether the path is an indexed file:

```go
func (g *Graph) Outline(ctx context.Context, path string) (nodes []Node, indexed bool, err error)
```

`!ok` from `GetFile` → `(nil, false, nil)`. A found file with zero symbols → `(nil, true, nil)`.
Update the doc comment to say what `indexed` means. Zero extra DB work: the lookup already happens.

Rejected: a `codegraph.ErrFileNotIndexed` sentinel (forces the one caller to `errors.Is` past a
real fault) and a second `store.GetFile` in `tools.go` (duplicates a query `Outline` just made).

### 3.2 `outlineFile` answers the absent case distinctly

```go
nodes, indexed, err := inst.graph.Outline(ctx, rel)
if err != nil {
    return nil, nil, err
}
if !indexed {
    return inst.errText(absentFileReason(inst.root, rel))
}
return inst.text(renderOutline(rel, nodes))
```

`renderOutline`'s empty-nodes sentence is **unchanged** — it now only ever means what it says. Add
one line to its doc comment recording that the caller guarantees `path` is an indexed file.

### 3.3 `absentFileReason` (new, `locator.go`, beside `relFile`)

Pure function of `root` + repository-relative `rel`, returning the message for a path with no index
row. Stats the path through `pathsafe.ValidateRelPath` (same containment check `sourceForOneFile`
uses; it also rejects a relative `..` escape, which `relFile` passes through today):

| Case | Message |
| --- | --- |
| `ValidateRelPath` error | `<rel> is not inside this repository (<root>)` — reuse `relFile`'s exact wording, one term per concept |
| `os.Stat` says not exist | `no indexed file at <rel>, and no such file on disk — call search_files to find the right path` |
| stat error otherwise | `no indexed file at <rel> (<rel> is unreadable)` |
| exists, directory | `<rel> is a directory, not a file — call search_files with it as pathPrefix to list indexed files under it` |
| exists, not regular | `<rel> is not a regular file` |
| exists, regular | `<rel> exists but is not indexed — its language is not one this index covers, or it is excluded — call search_files to see what is indexed` |

Wording rules followed: lowercase sentence, em-dash remedy naming the tool that answers next
(matches `list_repos`' own "grant one in Kira Studio's Settings → Code intelligence" shape), no
invented abbreviation.

`os.Stat` is not a byte read, so `outline_file`'s advertised "without reading its bytes" and
`docs/ARCHITECTURE.md`'s C8 paragraph ("the one place this server reads a file's own bytes") both
still hold. No `ARCHITECTURE.md` change in this phase.

### 3.4 `errText` (new, `tools.go`, beside `text`)

`errResult` plus `indexNotice()`, mirroring `text`. Used only by the new message, so a degraded or
partial index can never present "no indexed file at X" as a settled fact — P67f's own invariant
("on every response while degraded"). Existing `errResult` callers stay as they are.

### 3.5 `IsError`

The new answer is `IsError: true` — §6.3's "caller-correctable condition". A typo'd path is exactly
that. The definition-free case stays a normal text result.

## 4. Test

One test in `conformance_test.go`, `TestOutlineFileAbsentVsDefinitionFree`, following that file's
existing dogfooding-regression pattern (`TestFindDefinitionGoTypeSymbolOnly`): seed a store, attach,
drive the real tool surface over the in-memory MCP transport.

Seed three states in one `root`:

1. `main.go` — index row with one symbol (the existing `newConformanceServer` seed already does this).
2. `blank.css` — index row, `Symbols: nil` (indexed, genuinely definition-free).
3. `typo.go` — nothing seeded, nothing on disk (absent).
4. `real.md` — written into `root` on disk, never seeded (exists, not indexed).

Assert: (2) returns `has no indexed definitions`, not an error; (3) and (4) return `IsError` with
their own distinct messages; (3) and (4) do **not** contain `has no indexed definitions`; (2) and (3)
do not render the same text. That last assertion is the finding itself, pinned.

This clears `CLAUDE.md`'s testing bar as a conformance-suite dogfooding regression, the same footing
`TestFindDefinitionGoTypeSymbolOnly` sits on — not as a unit test of a one-branch `if`. No test is
added in `codegraph`; the signature change is covered through this one.

## 5. Commits

1. `fix(repo-map): distinguish absent file from definition-free file in outline_file`
   — `codegraph/outline.go`, `repomap/tools.go`, `repomap/locator.go`, `repomap/render.go` doc
   comment, plus `conformance_test.go`.
2. `docs(P68b): close outline_file ambiguity finding in dogfooding log` — needs commit 1's SHA, so it
   lands second.

Plus this plan's own commit, `docs(P68b): plan repo-map outline_file absent-file fix`.

## 6. Verification

Fast checks, then one live run:

1. `go build ./...` and `go vet ./...` in `apps/kira-studio`.
2. `go test ./internal/repomap/... ./internal/codegraph/...`.
3. Live, against a rebuilt server on this worktree (`bun run mcp:repo-map:build`, then
   `bun run mcp:repo-map` backgrounded; kill a stale server **by PID**, never `pkill`/`pgrep -f`,
   which kill the agent's own shell — this chapter's recurring gotcha). Call over plain HTTP/JSON-RPC
   per `CLAUDE.md`. Re-run every row of §1's table and require:
   - `apps/kira-studio/internal/codegraph/graph.go` → absent message, `isError` true.
   - `apps/kira-studio/internal/does-not-exist-at-all.go` → same absent message.
   - `README.md` → exists-but-not-indexed message.
   - `apps/kira-studio/internal/repomap` → directory message.
   - `packages/git-ui/src/icons/codicon.css` → `has no indexed definitions`, **not** an error
     (the definition-free control; confirmed indexed — `search_files {"query":".css"}` lists it).
   - `apps/kira-studio/internal/repomap/render.go` → full 16-node outline, byte-identical to today's.
   - `/etc/hosts` → unchanged "not inside this repository".

## 7. Doc update

In `docs/v1.6/mcp-repo-map-issues.md`, the "P68 (code review, dimension 1)" entry under
**Non-trivial**: change the heading's trailing `Open.` to ``Fixed (`<sha>`).`` and append a
`**Fix (P68b, `<sha>`)**:` paragraph — the format every closed entry there already uses. Content:
`Graph.Outline` already looked the file row up and discarded the answer; it now returns it, and
`outline_file` renders a distinct, `IsError` message per §3.3's table. Name the two extra cases this
phase found (`README.md`, a directory path) and the definition-free control that still answers
normally.

## 8. Out of scope

- Every other tool's empty-result sentence — `find_definition`, `search_symbols` and the rest are
  name queries, not path queries; "no such name" is not a wrong answer the way "no such path" is.
- Retrofitting `errText` onto existing `errResult` callers.
- `relFile`'s unvalidated relative path in general (the other tools' own paths): `absentFileReason`
  validates its own, and nothing here reads bytes, so there is no traversal to fix in this phase.
- Any `docs/ARCHITECTURE.md` change (§3.3).
