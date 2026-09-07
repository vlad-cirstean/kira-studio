# G3 — The history pipeline and the git data plane's wire format

> **What this phase is.** The third phase of `docs/v1.3/SPEC.md`'s headless-git chapter: everything
> between "a repository is open" (G2) and "a commit graph is on screen". It covers upstream's P2
> (History pipeline) in full, and acts on P15/P16's wire-format lesson the way SPEC §4.2 settled it
> — a JSON control plane with a FlatBuffers bulk data plane, built on this app's own P11
> infrastructure rather than a second one.
>
> **In one line: `gitclient` grows the three things a paged history walk is made of
> (`porcelain`, `catfile`, `logsession`), a new `gitstore` packs commits column-wise into
> upstream's `PackedCommitChunk`, a new `gitwire` FlatBuffers schema (`"KIG1"`) carries that chunk
> as raw bytes through a new binary frame variant `rpcstream` learns to write and
> `socketChannel.ts` learns to read, SPEC §6's per-connection `Walk` finally exists on
> `gitsession.Conn`, `gitrpc` serves the four `graph.*` methods, and the extension registers its
> graph webview so the thing actually draws.**
>
> **The SPEC is authoritative and is not re-litigated here.** The JSON-control-plane/FlatBuffers-
> data-plane split, the `"KIG1"` identifier, the reuse of P11's pinned `flatc` toolchain, the
> `Registry`/`RepoEntry`/`Conn`/`Walk` split and its shared-vs-private rule, the package layout, and
> the phasing table are settled in `docs/v1.3/SPEC.md` §2, §4.2 and §6. This plan is the *how*: the
> exact schema, the exact bytes on the wire, the exact Go types, the exact commit sequence, and the
> exact proof.
>
> **Five places where a literal reading of the SPEC (or of the code G1/G2 left behind) collides with
> what actually works are called out and resolved explicitly, with evidence** — the schema
> *filename* (F6/D1), the socket channel's inability to carry a byte (F4/D4), the contract's missing
> per-viewer settings (F2/D6), `RepoID` not surviving a round trip through `repo.open` (F8/D7), and
> what registering the webview really costs three phases early (F16/F17/D17). None is a deviation
> from a settled decision; each is a boundary the chapter spec did not draw, drawn here.
>
> **Two of those want a human eye before implementation starts — §11.**

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`43b499a6`, the whole
of G1 and G2). Every claim below was checked against source read or commands run in this container,
never against prose — including G1's and G2's own plans, which are records of intent and are
verified against the code they produced.

| Claim | Evidence |
|---|---|
| G2 landed in full and unchanged in shape | `git log --oneline`: `37e0f7f8`…`43b499a6`; `internal/gitclient/` now has `watcher.go` (240 lines) and a rewritten `runner.go` (320); `internal/gitsession/` has `registry.go`/`entry.go`/`conn.go`/`subscriber.go` |
| The runner streams, and has no stdin | `runner.go:128-142` — `Process` is `Stdout() io.ReadCloser`, `Wait()`, `Close()`; `Spec` (`:25-36`) is `{Dir, Args, ReadOnly}`. G2 §10 hands `Stdin` to G3 by name |
| Nothing in this repo parses a byte of git output beyond a trimmed single line | `repo.go:242-246` — `revParseLine` is `strings.TrimSpace(string(res.Stdout))`; `runner.go:38-44` — `Result`'s own comment: "no interpretation of Stdout/Stderr's bytes at all (that is G3's porcelain-parsing job)" |
| `gitrpc` serves three methods and no stream | `handlers.go:46-63` — `app.init`/`repo.open`/`repo.close`, and a `Stream` that returns `E_UNKNOWN_METHOD` unconditionally |
| `rpcstream.Handlers.Stream` still cannot emit a chunk | `session.go:33` — `Stream func(ctx, method string, params json.RawMessage) error`; `handleOpen` (`:144-167`) builds a `creditGate` only `handleCredit` can reach. G1 §11 assigns the widening to G3 |
| The credit gate is written, correct, and has never been called | `credit.go:8-12`'s own comment ("P1's one stream handler never actually calls acquire … P2 is the first real consumer") |
| `graph.status`/`graph.loadMore`/`graph.refresh`/`graph.stream` are **already** in the contract, both sides | `packages/git-ipc/src/contract.ts:883-896` and `:1102-1126`; `validate.ts:65-67` and `:101-103` |
| `graph.stream`'s params carry no per-viewer settings | `contract.ts:1104-1112` — `{repoId, resumeThroughRow?, range?}` only |
| The FlatBuffers seam exists in TypeScript, end to end, and is dead code today | `codec.ts:269-286` `encodeStreamPayload` / `:291-315` `decodeStreamPayload`, both keyed on `StreamKey` with a `never` default; `rpc.ts:413` and `:205` are the only call sites, and no stream is ever opened |
| The migrated schema is upstream's, with upstream's identifier — **not** SPEC §4.2's | `packages/git-ipc/schema/graphChunk.fbs:37` — `file_identifier "KVGC"`; `graphChunkCodec.ts:26` — `const FILE_IDENTIFIER = 'KVGC'`; `codec.ts:274` — `$fb: 'graphChunk/1'` |
| `socketChannel` is JSON-only in both directions | `socketChannel.ts:71` — `currentHandler?.(JSON.parse(body.toString('utf8')))`; `:81` — `Buffer.from(JSON.stringify(message), 'utf8')`; `:78` — `bufferEncoding: 'native'` |
| `'native'` encoding is a pass-through, so an `ArrayBuffer` reaches `JSON.stringify` intact | `codec.ts:196-201` — the `'native'` arm returns `{payload: message, transfer}` with `message` untouched |
| `gitsock`'s framing is already binary-clean and length-prefixed | `frame.go:31-60` — `writeFrame`/`readFrame` over a 4-byte big-endian prefix and an 8 MiB cap; the body is `[]byte`, never inspected |
| A frame over the cap is silently dropped, not reported | `frame.go:32-34` returns `errFrameTooLarge`; `rpcstream/session.go:75` — `_ = s.conn.Send(b)`, with a comment that the receive loop will notice a *connection* failure. A rejected oversize frame is not a connection failure |
| `RepoID` is the git dir | `repo.go:181` — `RepoID: gitDir` |
| The UI feeds `repoId` straight back in as a *path* | `packages/git-ui/src/App.vue:652` — `await repo.open(persisted.repoId)`; `state/repo.ts:39` — `request('repo.open', { path })` |
| `git rev-parse --show-toplevel` fails when cwd is the git dir | run here: `cd /tmp/ridtest/.git && git rev-parse --show-toplevel` → `fatal: this operation must be run in a work tree` (exit 128), while `--absolute-git-dir` and `--is-bare-repository` both answer normally |
| The graph webview provider is migrated, parameterised and unregistered | `apps/kira-studio-vscode/src/panelView.ts:22-25` (`handlers: ServerHandlers` from the constructor), `extension.ts:45-96` (no `registerWebviewViewProvider`) |
| `ConnectionManager` exposes `request` and nothing else | `connection.ts:109-118` |
| Opening a repo in the UI eagerly fires four requests G3 does not serve | `App.vue:220-229` → `refsState.setRepoId` (`state/refs.ts:71-83` → `refs.list`), `opsState.setRepoId` (`state/ops.ts:233-245` → `status.get`, `undo.peek`), `stashState.setRepoId` (`state/stash.ts:74-89` → `stash.list`). Every one is `void this.reload()` with no `catch` |
| A repo can only be opened from the UI through `repo.list`/`repo.pick` — or the `KIRA_REPO` dev seed | `state/repo.ts:34-46`; `apps/kira-studio-vscode/src/webview/main.ts:88-131` seeds `viewState.repoId` from `bootstrap.repo`, and `html.ts:100` fills it from `process.env.KIRA_REPO` |
| `packages/git-ipc`'s own tests are in no script | `package.json:35` — `"test:unit": "bun test apps/kira-studio/tests/unit packages/api-core/test"`. Run by hand here: `bun test packages/git-ipc/src` → 34 pass, 3 files |
| `build:vscode` produces both bundles and is wired into nothing | `scripts/build-vscode.ts:11-12`'s own comment ("G3, the phase that first loads a webview, wires this in"); run here → `dist/ui/assets/webview-*.js` 259 KB + `dist/extension.js`, bundle checks pass |
| The pinned `flatc` toolchain works in this container and reproduces the committed output byte-for-byte | `sh scripts/generate-wire.sh` → downloads `flatc 25.9.23`, regenerates, `git status` clean afterwards |
| **flatc names its TypeScript entry file after the schema filename**, so `gitWire.fbs` + `namespace gitwire` emits **both** `gitWire.ts` and `gitwire.ts` | probed here: `flatc --ts -o out gitWire.fbs` → `out/gitWire.ts` **and** `out/gitwire.ts` + `out/gitwire/*.ts`. Renaming the schema to `gitwire.fbs` collapses them to a single `gitwire.ts` barrel. `packages/shared/protocol/wire.fbs:9-14` documents the same trap from the other direction |
| `flatc --go -o apps/kira-studio/internal` on a `namespace gitwire` schema produces exactly `internal/gitwire/*.go`, `package gitwire` | same probe: `out-go/gitwire/{Frame,Payload,PackedCommitChunk,RowDecorations,DecorationRef}.go`, all `package gitwire`, importing only `flatbuffers` |
| `flatbuffers` is already a dependency on both sides | `go.mod:15` `github.com/google/flatbuffers v25.9.23+incompatible`; `packages/git-ipc/package.json` `"flatbuffers": "25.9.23"` |
| Generated TS is already excluded from biome | `biome.json:19` — `"!packages/git-ipc/src/generated"` |
| The layering test auto-enumerates, and exempts only transport/composition packages | `internal/layering_test.go:29-44` — `internal`, `internal/bridge`, `internal/ipcfixture`, `internal/shell`, `internal/bridge/rpcstream`, `internal/gitsock` |
| This repo already has the committed-fixture-with-a-regenerator pattern | `AGENTS.md`'s `tests/ipc` section — `KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...`; `internal/postman/testdata`, `internal/datagrip/testdata`, `internal/apivars/testdata` |
| `internal/page/encode.go` already solved little-endian column encoding for FlatBuffers | `page/encode.go:13-20` (`hostIsLittleEndian`) and `createUint32Vector`'s fast path |
| `go build ./apps/kira-studio/internal/...` is clean; git here is 2.43.0; Go is 1.27.0 | run here |

**Upstream baseline** (`/home/user/vlad-cirstean/kira-version-vscode`, `claude/start-p2-gwlgly`,
`0ea4cfe`):

| Claim | Evidence |
|---|---|
| The log format is ten `%x1f`-separated fields in one `-z` record, subject last | `parse/log.ts:13-18` — `LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%s"`, `FIELD_COUNT = 10`, with the reason subject is last spelled out |
| The final field absorbs stray delimiters, by construction | `core/util/nulSplit.ts:109-124` — `splitLimitedFields` stops splitting at `fieldCount - 1` |
| The walk's argv is fixed and shared by every consumer | `parse/log.ts:88-107` — `logArgs`/`logSessionArgs`/`logSessionSkipArgs`, all `["log", "--decorate=full", "--topo-order", "-z", "--format=…"]` + `walkArgs(walk)` |
| `--decorate=full` is load-bearing, not cosmetic | `parse/log.ts:4-8` and `:144-168` — classification is by `refs/heads/`, `refs/remotes/`, `tag: `, `HEAD -> `, `refs/stash` prefix; short names cannot be classified |
| The paged session is a *paused* process, not a `--max-count` re-walk | `logSession.ts:1-18`'s module doc; `:286-313`'s read loop stops reading at `pageSize` and returns |
| It spawns outside the bounded read pool, deliberately | same doc comment — a permanently paused session "would hold a quarter of the repository's read concurrency hostage" |
| A page boundary must carry parsed-but-unconsumed records forward | `logSession.ts:194-196`, `:266-284` — `#pendingRecords`, with a comment naming the bug this fixed ("stopping mid-array without queuing the rest would silently drop them") |
| A reclaimed session resumes by `--skip`, guarded by a ref snapshot | `logSession.ts:242-259` — snapshot at first read, re-snapshot before a `--skip` respawn, `{kind:"stale", reason:"refsChanged"}` if they differ |
| `idleReclaimMs` is optional and **never passed** by the service | `logSession.ts:38`, `:381-391`; `repoService.ts:3217-3227` `#openLogSession` passes only `walk` and `pageSize` |
| Exhaustion is decided by exit code, not by EOF | `logSession.ts:364-379` `#handleExit` |
| `remaining()` is one `rev-list --count` over the *same* rev set, cached | `logSession.ts:316-350` |
| `cat-file` is two persistent processes, `--batch-check` first, one request in flight at a time | `catFile.ts:1-15`, `:313-345`; `:266-277` `#pump` |
| Its framing is a two-phase state machine over raw bytes | `catFile.ts:109-180` — header line to LF, then exactly `size` bytes plus a trailing LF; `missing` is recognised by suffix, not by field count |
| A commit chunk is 500 rows | `repoService.ts:711` — `export const CHUNK_ROWS = 500` |
| A chunk's dictionary is a delta keyed by a per-row mark, never a running cursor | `repoService.ts:776-786` (`dictionaryMarks`), `:3344-3369` `#emitRange` |
| `resumeThroughRow` is clamped and resolved through the marks, never trusted | `repoService.ts:1051-1059` |
| `source` is `"cache"` for rows already in the store, `"git"` for rows this call read | `repoService.ts:1063-1100` |
| Only the first stream for a repo reads from git; every later page is an explicit `loadMore` | `repoService.ts:1080-1085`'s own comment |
| The packed chunk carries parents as **shas**, not row indices | `core/store/commitStore.ts:102` and `packSlice`'s `parentShas` loop |
| The receiver reconstructs typed arrays natively (endianness matters) | `commitStore.ts`'s `appendPacked` — `new Uint32Array(chunk.parentOffsets)` etc. |
| The dictionary base must match the receiver's interner size exactly, or the chunk is rejected | `commitStore.ts`'s `appendPacked` asserts both `chunk.from === rowCount` and `chunk.dictionaryBase === interner.size` |
| The golden corpus is raw byte recordings from deterministic repos, plus hand-authored edge cases | `tests/fixtures/recordPorcelain.ts:1-17`; `tests/fixtures/porcelain/log/*.bin` (5 files), `porcelain/handAuthored/*.bin` (10) |
| Args in the recorder come from the parsers' own builders, so recorder and parser cannot drift | `recordPorcelain.ts:7-10` and its imports |

### 0.2 Scope

1. `internal/gitclient/porcelain` — the log record format, its argv builders, the `-z`/`%x1f`
   splitters, decoration classification, and the ref snapshot (§3.1, D8–D9).
2. `internal/gitclient/catfile` — the two persistent `cat-file` processes and their framing, plus
   the `Spec.Stdin`/`Process.Stdin()` seam G2 handed forward (§3.2, D11).
3. `internal/gitclient/logsession` — the pausable, resumable paged walk (§3.3, D10).
4. `internal/gitstore` — the column-wise commit store, sha table, interner and `PackedChunk`
   builder, plus its FlatBuffers encoder (§3.4, D12).
5. `packages/git-ipc/schema/gitwire.fbs` + `internal/gitwire` + `packages/git-ipc/src/generated/` —
   the `"KIG1"` data-plane schema and its generated code (§3.5/§4.1, D1–D3).
6. A binary frame variant carrying one out-of-band blob, written by `rpcstream` and read by
   `socketChannel.ts`; `Handlers.Stream` widened to emit (§3.6/§4.3, D4–D5).
7. `gitsession.Walk` — SPEC §6's per-connection paging state, its lifecycle and its invalidation
   (§3.7, D13).
8. `gitrpc` — `graph.status`, `graph.loadMore`, `graph.refresh` and the `graph.stream` handler
   (§3.8, D14); `RepoID` corrected (D7); `CONTRACT_VERSION` 12 → 13 (D6).
9. The extension: `createProxyHandlers`, `ConnectionManager.stream`/`on`, and registering the graph
   webview view (§4.4–§4.6, D17–D19).
10. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G3 work:

- **Any parser the history walk does not use.** No `status --porcelain=v2`, no `diff`/`diff-tree`,
  no `stash list`, no `merge-tree`, no `for-each-ref` beyond D9's narrow snapshot. Each lands with
  its consumer (G4/G5/G8).
- **`commit.detail`, `commit.fileDiff`, blob reads.** `catfile` is built (D11) and its first
  production caller is G4's.
- **The ranged/review walk.** SPEC §6's "active review-range walk"; `graph.*`'s `range` parameter is
  rejected, not half-served (D14). G6.
- **`refs.list`, `status.get`, `undo.peek`, `stash.list`.** G5/G5/G5/G8 — and the four calls the
  webview fires on every repo open that this phase deliberately leaves unserved (F16/D17).
- **The five host-capability methods other than `repo.list`/`repo.pick`.** `editor.openDiff`,
  `editor.goToFile`, `clipboard.write`, `editor.resolveConflict` stay unanswered, and `app.init`
  reports their capabilities as `false` — which is what the contract's `capabilities` block is for
  (`contract.ts:855-864`). G4.
- **The review webview view.** Migrated, still unregistered. G6.
- **Search, and therefore the RE2-vs-`RegExp` question.** D21.
- **`stash.showInGraph` and the stash rows in the walk's rev set.** G8 (upstream's `revSetArgs`
  stash arguments are ported as a parameter that G3 always passes empty — see D8).
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule: a chapter spec is not
  retro-edited by a phase. Everything this plan settles that the SPEC left open is settled *here*.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out of this phase is left out *entirely*.
- **Comments very concise, only where the code cannot say it itself.**
- **Tests only where `AGENTS.md`'s bar is met.** G3 clears it in six places and nowhere else: the
  record splitter's chunk-boundary state, the log record/decoration parser (a decision structure
  with several interacting rules, against a golden corpus), the `cat-file --batch` framing state
  machine, the paged walk's page-boundary arithmetic and `--skip`/staleness interaction, the
  packer's CSR/dictionary boundary arithmetic, and the `Walk`'s concurrency and invalidation. Plus
  one cross-language conformance fixture (D16), which is not a unit test but the only thing that
  proves the Go encoder and the TypeScript decoder agree.
- **Reach for a library before hand-rolling.** There is nothing to reach for here that is not
  already in the graph: FlatBuffers is the library, and it is already pinned, generated and paid
  for by P11. Everything else is a git-output parser, which is exactly the "requirement no library
  meets" case — a parser for *this* format string.
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§6).

---

## 1. Findings

### F1 — Nothing in this repo has ever parsed git output, and that is by design up to now

`Result`'s own doc comment (`runner.go:38-44`) states it: "no interpretation of Stdout/Stderr's
bytes at all (that is G3's porcelain-parsing job, explicitly out of scope here)". The only reader of
`Result.Stdout` today is `revParseLine` (`repo.go:242-246`), which trims a single line. So
`gitclient/porcelain` is a genuinely new package with no partial predecessor to reconcile — the
whole surface is ported at once, or not at all.

### F2 — `graph.*` is already in the contract on both sides, but its params cannot carry the two settings the server now needs

`contract.ts:883-896` and `:1102-1126` declare all four methods; `validate.ts:65-67`/`:101-103`
admit them. **No method is added by this phase.**

But `graph.stream`'s params are `{repoId, resumeThroughRow?, range?}` and `graph.loadMore`'s are
`{repoId, pages?, range?}` — neither carries `graph.scope` or `graph.pageSize`. Upstream did not
need them to: `repoService.ts:3217-3227`'s `#openLogSession` reads both straight out of
`this.#deps.settings()`, an in-process thunk over VS Code configuration.

In this architecture that thunk does not exist on the server side. SPEC §5 item 3 gives `settings`
to the extension (`app.init` "becomes a composition: … `settings` from VS Code configuration"), and
SPEC's Settings-ownership section says the per-viewer display settings — naming `graph.pageSize` and
`graph.scope` explicitly — "can travel with the request and differ per window harmlessly". They
currently have nothing to travel in.

Two settings that exist in the schema (`contract.ts:38-39`), in the extension's own settings UI
(`apps/kira-studio-vscode/package.json#contributes.configuration`) and in the snapshot the webview
already receives would otherwise be silently ignored by the only code that could honour them. That
is not a scope cut; it is a setting that lies.

### F3 — The FlatBuffers seam is already wired end to end in TypeScript, and is dead code

`encodeStreamPayload`/`decodeStreamPayload` (`codec.ts:269-315`) are keyed on `StreamKey` with a
`never`-typed default, and are called unconditionally by `rpc.ts:413` (server → chunk) and
`rpc.ts:205` (client → chunk). `graphChunkCodec.ts` implements `toWire`/`fromWire` against the
generated `graphChunk.ts` with four separate compile-time drift guards (its own doc comment lists
them).

None of it has ever run in this repo: no stream is opened, because no server serves one (F1's
sibling — `gitrpc/handlers.go:57-62`). So G3 inherits a complete, unexercised TypeScript half whose
first execution is this phase's own proof.

It carries upstream's identifier, not this chapter's: `"KVGC"` (`graphChunk.fbs:37`,
`graphChunkCodec.ts:26`) where SPEC §4.2 requires `"KIG1"`, "distinct from the `studio` data plane's
`"KIF1"` so the two can never be cross-decoded".

### F4 — The socket channel cannot carry a byte today; a chunk would cross as `{}`

This is the finding that decides the wire format, and it is not an optimisation question.

`socketChannel.ts` declares `bufferEncoding: 'native'` (`:78`) — correct in intent (a socket carries
bytes) — but its `post` is `JSON.stringify(message)` (`:81`) and its receive path is
`JSON.parse(body.toString('utf8'))` (`:71`). And `'native'` in `codec.ts:196-201` is a
**pass-through**: `encode` returns the message untouched with a transfer list the channel ignores.

So a `graph.stream` chunk whose `commits` field is `{$fb, d: ArrayBuffer}` — exactly what
`encodeStreamPayload` produces — would reach `JSON.stringify` with a live `ArrayBuffer` in it and
serialise as `"d":{}`. Silently. The webview would then throw in `fromWire` on a zero-length buffer,
if it got that far.

There are exactly two ways out, and no third:

1. Declare `bufferEncoding: 'base64'` on the socket channel. Everything then works with zero framing
   changes — at the cost of ~33% inflation plus a base64 encode on the Go side (which would mean
   building a FlatBuffer and then base64-ing it into a JSON string) and a decode on the TS side, per
   chunk, on the hop SPEC §4.2 chose FlatBuffers for.
2. Teach the channel a binary frame. D4.

### F5 — `Handlers.Stream` cannot emit, and the fix has one caller

`session.go:33` — `Stream func(ctx context.Context, method string, params json.RawMessage) error`.
`handleOpen` (`:144-167`) creates a `creditGate`, registers it, calls the handler, and sends `end`.
There is no path from a handler to a `chunk` frame at all.

G1 §11 records the required shape and assigns it here. `grep -rn "rpcstream\." --include=*.go`
outside tests still yields exactly one production caller, `gitsock/server.go:191`, so widening the
signature has one call site to update — and `gitrpc.Handlers` (`handlers.go:25-28`) is gitrpc's own
struct, structurally mirrored, so it changes in the same shape without gitrpc importing
`internal/bridge`.

### F6 — flatc names its TypeScript entry file after the *schema filename*, and SPEC §4.2's literal filename collides on macOS

`packages/shared/protocol/wire.fbs:9-14` already documents this trap from one direction: `page.fbs`
would have generated a top-level `page.ts` that silently overwrote the hand-written one, so the
schema was named to match its `namespace`.

Probed here, in the other direction. With `namespace gitwire;`:

- `flatc --ts -o out gitWire.fbs` produces **`out/gitWire.ts`** (entry point, named after the file)
  **and `out/gitwire.ts`** (namespace barrel) plus `out/gitwire/*.ts`.
- `flatc --ts -o out gitwire.fbs` produces exactly one `out/gitwire.ts` plus `out/gitwire/*.ts` —
  flatc merges entry point and barrel when the names coincide.

Two files differing only in case, in one directory, on a product whose only supported platform
defaults to a case-insensitive filesystem. On Linux (where `generate:wire` may well be run) they are
two files; on macOS one overwrites the other, and which one wins depends on flatc's write order.

SPEC §4.2 names the schema `packages/git-ipc/schema/gitWire.fbs`.

### F7 — `--go` on the same schema lands exactly where SPEC §2 wants it

Same probe: `flatc --go -o <dir> gitwire.fbs` with `namespace gitwire;` writes
`<dir>/gitwire/{Frame,Payload,PackedCommitChunk,RowDecorations,DecorationRef}.go`, all
`package gitwire`, importing only `github.com/google/flatbuffers/go`. With `-o
apps/kira-studio/internal` that is `internal/gitwire` — SPEC §2's package name, for free, and a
package the layering test covers automatically with nothing to exempt.

`sh scripts/generate-wire.sh` runs end to end in this container (it fetches the pinned, SHA-256-
verified `flatc 25.9.23` into `.tools/`) and regenerates the existing output byte-for-byte — `git
status` is clean afterwards. So the toolchain is not a risk this phase has to plan around.

### F8 — `repoId` is fed back in as a path, and the current `RepoID` cannot survive that round trip

`App.vue:652` — `await repo.open(persisted.repoId)` — and `state/repo.ts:39` sends it as
`request('repo.open', { path })`. This is §5.4's rehydration path, it is the *only* path that opens
a repo after a webview is recreated, and (with `KIRA_REPO` seeding `viewState.repoId`,
`webview/main.ts:88-131`) it is the only way a repo gets opened at all in a dev/e2e run.

`repo.go:181` sets `RepoID: gitDir`. Identifying from a git dir does not work:

```
$ cd /tmp/ridtest/.git
$ git rev-parse --is-bare-repository   # false
$ git rev-parse --absolute-git-dir     # /tmp/ridtest/.git
$ git rev-parse --show-toplevel        # fatal: this operation must be run in a work tree  (exit 128)
```

`Identify` (`repo.go:150-190`) runs `--is-bare-repository` first, gets `false`, and therefore runs
`--show-toplevel` — which fails. `Classify` turns exit 128 with that stderr into `KindUnknown`, so
`repo.open` answers `E_GIT_UNKNOWN`. Rehydration is broken, today, on the branch as it stands.

G2 F16 chose `gitDir` for a good reason — *"a **bare** repository has `Root == ""` (`repo.go:222-229`),
so keying on `Root` would collapse every bare repo into one entry"* — and explicitly reasoned that
"nothing client-side derives meaning from its contents". `App.vue:652` does.

### F9 — Moving the walk per-connection is the phase's one real structural departure, and it costs a process per viewer

Upstream keeps `logSession`, `store`, `dictionaryMarks`, `staleReason`, `nextSeq` and
`lastRemaining` on the single per-repo `RepoSession` (`repoService.ts:766-793`). SPEC §6 splits
them: *"a fact about the repository is shared (`RepoEntry`); a fact about one viewer's session is
private (`Walk`)"*, and lists "log session, commit store, dictionary marks, scroll/paging state"
under `Walk`.

That is right — two windows scrolled to different depths in one repository is precisely the case
upstream never had — and it has three consequences this plan has to own:

1. **One paused `git log` process per (connection, repo)**, not per repo.
2. **One commit store per (connection, repo)**, so the same 100k commits can be resident twice.
3. `graph.refresh` and a watcher-driven `refsChanged` invalidate *each viewer's* walk independently,
   and the `repo.changed` fan-out G2 built is the natural delivery point for the second.

### F10 — Upstream's idle-reclaim knob exists, is correct, and is never switched on

`logSession.ts:38` declares `idleReclaimMs`, `:381-398` implement arming and clearing, and
`repoService.ts:3217-3227` — the only production constructor — never passes it. So upstream holds a
paused `git log` open for the life of the panel, and the `--skip` resume path (`:242-259`) exists
only for tests.

With F9's multiplication, "held for the life of the panel" becomes "held for the life of every
panel", and this backend is meant to serve several VS Code windows at once (SPEC §6's opening
sentence). A knob that upstream designed and never turned on is exactly what this phase needs.

### F11 — The server never needs a parent's *row*, only its sha, so the Go store is materially smaller than `commitStore.ts`

`commitStore.ts` maintains `#parentRows` (an `Int32Array` of resolved rows), `#pendingParents` (slot
→ hex sha for parents not yet loaded), an `UNRESOLVED_PARENT_ROW` sentinel and a
`resolvedParentSlots` delta — all of it for `layoutInput()` (the lane layout) and `commitAt()` (the
on-screen materialisation). Both are renderer concerns, and SPEC §2's last line keeps them in
TypeScript.

`packSlice`'s output takes the other path: `parentShas` is *"binary shas in CSR order — parents
travel as shas, not row indices"* (`contract.ts:167`), and the packer reaches for a resolved row's
sha or the pending map's hex purely to produce those bytes. A server that only ever packs can store
parent shas directly in CSR order and never resolve anything.

### F12 — The receiving side reconstructs native typed arrays, so the encoder must write little-endian

`appendPacked` does `new Uint32Array(chunk.parentOffsets)`, `new Uint32Array(chunk.identityIds)`,
`new Uint32Array(chunk.times)`, `new Uint32Array(chunk.subjectOffsets)` — the platform's own byte
order, which on every platform this app ships to or is built on is little-endian. The schema
declares those columns as `[ubyte]` (`graphChunk.fbs:23-33`), so the byte order is the encoder's
responsibility, not FlatBuffers'.

`internal/page/encode.go:13-20` already met this exact problem and answered it with a
`hostIsLittleEndian` fast path plus a correct slow path.

### F13 — The paged walk's page boundary is the one piece of arithmetic upstream recorded a bug in

`logSession.ts:194-196` and `:266-284`: `RecordSplitter.push()` returns every complete record in the
chunk it was handed and does not re-offer ones the caller declines, so a page that fills up
mid-array must queue the remainder — *"stopping mid-array without queuing the rest would silently
drop them, never to be seen again once the underlying bytes are gone. See this phase's Findings for
how this was actually caught."*

That is `AGENTS.md`'s "cursor/pagination boundary arithmetic" category verbatim, and it is the
single most likely thing to get wrong in the port.

### F14 — `cat-file --batch` needs a writable stdin, which G2 deliberately did not build

`catFile.ts:237-247` spawns with a piped stdin and drives the process by writing `"<oid>\n"`.
`Spec` (`runner.go:25-36`) has no `Stdin`, and `Process` (`:128-142`) has no `Stdin()`. G2 §10 hands
both forward by name, with the exact shape: *"Both are one field on `Spec` plus one on `Process`
(`Stdin() io.WriteCloser`) … **G3** adds stdin".*

### F15 — The golden corpus can be regenerated deterministically, and this repo already has the pattern for that

Upstream's fixtures are raw byte recordings (`recordPorcelain.ts:1-17`: *"Recorded as raw byte
files, never as string literals in a .ts file: escaping NUL and 0x1f into TypeScript source is
exactly where a fixture silently stops representing what git actually emits"*), built from
`generateRepo.ts`'s deterministic repositories, with args taken from the parsers' own builders so
recorder and parser cannot drift.

Deterministic is literal: with a fixed author/committer identity, fixed dates and fixed tree
content, git's object hashes are reproducible, so a regenerated fixture is byte-identical.

This repo's own precedent for "committed fixture plus an env-gated regenerator" is
`KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...` (`AGENTS.md`), with
`internal/postman/testdata`, `internal/datagrip/testdata` and `internal/apivars/testdata` as three
more instances of committed testdata beside a Go test.

### F16 — Registering the graph webview lights up four requests this phase does not serve, and the UI does not catch them

`App.vue:220-229` watches the active repo id and calls `setRepoId` on four state objects. Three of
them immediately issue a request:

| Trigger | Request | Phase that serves it |
|---|---|---|
| `refsState.setRepoId` (`state/refs.ts:71-83`) | `refs.list` | G5 |
| `opsState.setRepoId` (`state/ops.ts:233-245`) | `status.get` | G5 |
| the same | `undo.peek` | G5 (slot completed G9) |
| `stashState.setRepoId` (`state/stash.ts:74-89`) | `stash.list` | G8 |

Each is `void this.reload()` / `void this.refreshStatus()` with no `catch`, so a rejection is an
unhandled promise rejection in the webview. Selecting a row adds `commit.detail` (G4). None of this
can be fixed in `packages/git-ui`, which SPEC §5 requires to stay **unchanged**, and none of it can
be papered over in the extension without stubbing a server method client-side, which `AGENTS.md`
forbids.

G1 D13 rejected registering the views in *its* phase on exactly this ground ("that ships a visibly
broken panel"), and named G3 as the phase that does it.

### F17 — Without `repo.list`/`repo.pick`, the graph has no way to be pointed at a repository

`state/repo.ts:34-46` is the whole repo-selection surface: `repo.list` populates the picker,
`repo.pick` opens the folder dialog, `repo.open` follows. Both of the first two are answered by the
*host* upstream (`rpcHandlers.ts:269-275`: `deps.roots.list()`, `deps.dialogs.pickFolder(...)`), and
both of those ports are already migrated into this repo
(`apps/kira-studio-vscode/src/ports/workspaceRoots.ts`, `ports/dialogs.ts`).

SPEC's phasing table puts "the seven host-capability methods wired client-side" in G4. Two of the
seven are the difference between "the graph renders end to end" (G3's own row) and "the graph
renders end to end provided you set `KIRA_REPO` before launching VS Code".

### F18 — `packages/git-ipc`'s tests run in no script

`package.json:35` — `"test:unit": "bun test apps/kira-studio/tests/unit packages/api-core/test"`.
`codec.test.ts`, `rpc.test.ts` and `socketChannel.test.ts` are in neither path. Run by hand here:
`bun test packages/git-ipc/src` → **34 pass, 0 fail, 3 files**. They work; nothing runs them.

This phase adds the codec that carries every commit on the wire, and G1's own §8.1(d) calls
`socketChannel.test.ts` *"the only thing that keeps the TS framing byte-identical to Go's"*. A test
nothing runs is not that.

### F19 — `build:vscode` works here and is wired into nothing, by G1's own decision

`scripts/build-vscode.ts:11-12`: *"Not wired into `scripts/setup.sh` or `bun run build` … G3, the
phase that first loads a webview, wires this in."* Run here it produces
`apps/kira-studio-vscode/dist/ui/assets/webview-*.js` (259 KB) plus `dist/extension.js`, and its
no-Bun-API bundle check passes.

### F20 — `ConnectionManager` has no `stream` and no `on`

`connection.ts:109-118` exposes `request` only, over a `Transport` (`#transport`) that already has
all three. G2 §10 records the `on()` half as G3's ("`repo.changed` has no consumer on the extension
side until G3"); the `stream` half is new here.

### F21 — An oversize frame is silently dropped, which for a chunk means a stream that never ends

`writeFrame` (`gitsock/frame.go:31-40`) refuses a body over 8 MiB with `errFrameTooLarge`.
`rpcstream`'s write loop discards the error (`session.go:75`) on the stated assumption that a write
failure means the connection is going away — true for an I/O error, false for a rejected oversize
frame, where the connection is perfectly healthy and one chunk has simply vanished. The client is
then waiting on a `chunk`/`end` that will never arrive, with a credit it will never get back.

Today no frame can plausibly reach 8 MiB (the largest is a `RepoSummary`). A 500-row commit chunk
carrying 500 subjects can, in principle, on a repository with pathological commit subjects.

---

## 2. Decisions

### D1 — One new schema, `packages/git-ipc/schema/gitwire.fbs`, `namespace gitwire`, `file_identifier "KIG1"`, rooted at a `Frame` union

```
// packages/git-ipc/schema/gitwire.fbs
//
// The git module's bulk data plane (SPEC §4.2). Go: internal/gitwire (generated) +
// internal/gitstore/encode.go (the encoder). TypeScript: packages/git-ipc/src/generated/ +
// graphChunkCodec.ts. Regenerate both with scripts/generate-wire.sh.
//
// Control frames stay JSON text — this schema covers response/stream payloads only, the same
// split packages/shared/protocol/wire.fbs states for the studio data plane.
//
// Named gitwire.fbs, not gitWire.fbs: flatc's TypeScript generator names its entry-point file
// after the schema FILENAME and its namespace barrel after the namespace, so a name that differs
// from `namespace gitwire` only in case emits two files that collide on a case-insensitive
// filesystem (F6). wire.fbs carries the same note for the same reason.
//
// Append-only: never renumber, never reorder, never delete a field — retire with (deprecated).
// CONTRACT_VERSION, not this file, is the compatibility authority (upstream D46).

namespace gitwire;

table DecorationRef {
  kind:string (required);   // branch | remoteBranch | tag | head | stash
  name:string;              // absent for "head"; the decimal index for "stash"
  is_head:bool;             // meaningful only for "branch"
}

table RowDecorations {
  row:uint32;               // chunk-relative
  refs:[DecorationRef] (required);
}

table PackedCommitChunk {
  from:uint32;
  to:uint32;
  sha_width_bytes:uint8;
  shas:[ubyte] (required);
  parent_offsets:[ubyte] (required);    // little-endian uint32, (to-from)+1 entries
  parent_shas:[ubyte] (required);
  identity_ids:[ubyte] (required);      // little-endian uint32, 4 per row
  times:[ubyte] (required);             // little-endian uint32, 2 per row
  subject_bytes:[ubyte] (required);
  subject_offsets:[ubyte] (required);   // little-endian uint32, (to-from)+1 entries
  dictionary_base:uint32;
  dictionary:[string] (required);
  decorations:[RowDecorations] (required);
}

union Payload { PackedCommitChunk }

table Frame { payload:Payload; }

root_type Frame;
file_identifier "KIG1";
```

- **The field set is upstream's `graphChunk.fbs` verbatim**, because it is upstream's
  `PackedCommitChunk` (`contract.ts:159-182`) verbatim, and the receiver of these bytes is upstream's
  own `appendPacked`. Nothing here is redesigned.
- **The `Frame`/`Payload` wrapper is new**, and is SPEC §4.2's own words ("one `Frame` table per
  response"), matching `wire.fbs`'s `Frame`/`Payload` shape. It costs one indirection and buys G4
  its diff/blob payloads as *added union members* rather than a second root type and a second
  identifier check.
- **`gitwire.fbs`, not SPEC's literal `gitWire.fbs`** — F6. This is a filename, not a design; the
  identifier, the namespace, the location and the toolchain are all exactly what SPEC §4.2 says.

`packages/git-ipc/schema/graphChunk.fbs`, `schema/graphChunk.fields.json` and
`src/generated/graphChunk.ts` are **deleted**. There is no dual-format decoder and no compatibility
shim — SPEC §4.2's own house rule, and G1's migrated `"KVGC"` code has never once run (F3).

### D2 — The chunk *envelope* stays JSON; only `commits` becomes FlatBuffers

`encodeStreamPayload` (`codec.ts:254-286`) already draws this line, and its comment states the
reasoning: the envelope's seven scalars (`repoId`, `seq`, `from`, `to`, `source`, `remaining`,
`exhausted`) cost ~100 bytes and are not worth a schema statement; `commits` — the thirteen fields
that actually carry bytes — is.

Keeping it means `rpc.ts`, `codec.ts`'s traversals and the whole credit/correlation machine are
untouched by this phase, which is what SPEC §5's "kept whole" requires of `packages/git-ipc` and
what keeps the extension→webview hop working with no second design.

The `$fb` tag becomes `'gitwire/1'` (`codec.ts:274`, `:301`).

### D3 — Generation goes through `scripts/generate-wire.sh`, unchanged in every respect but two more lines

```sh
GIT_SCHEMA="$ROOT_DIR/packages/git-ipc/schema/gitwire.fbs"
...
"$FLATC" --go -o "$ROOT_DIR/apps/kira-studio/internal"        "$GIT_SCHEMA"
"$FLATC" --ts -o "$ROOT_DIR/packages/git-ipc/src/generated"   "$GIT_SCHEMA"
```

Same pinned, digest-verified `flatc 25.9.23`, same "generated output is committed, this script
reproduces it byte-for-byte" rule (P11 D11), same `bun run generate:wire` entry point. Verified in
this container that the toolchain fetches, runs and reproduces existing output exactly (F7).

`biome.json:19` already excludes `packages/git-ipc/src/generated`, so the new files need no lint
exemption.

### D4 — A binary frame variant, owned by `rpcstream`; `gitsock/frame.go` does not change at all

Resolving F4. Option 1 (declare `'base64'`) is rejected: it would mean the Go side building a
FlatBuffer and then base64-ing it into a JSON string on the one hop SPEC §4.2 chose FlatBuffers to
avoid exactly that on, and it inflates every commit chunk by a third for the life of the product.

**The frame layer is untouched.** `gitsock`'s `writeFrame`/`readFrame` (`frame.go:31-60`) already
carry arbitrary bytes with a 4-byte length prefix and never inspect the body — G1 §6 promised
precisely this ("G3 changes *what is inside a frame*, never the frame"), and it holds. What changes
is the *body* encoding, which is `rpcstream`'s (it is the package that marshals the envelope):

```
body (control frame) : '{' … UTF-8 JSON …                            unchanged from G1/G2
body (blob frame)    : 0x00 | uint32BE headerLen | headerJSON | blobBytes…to the end of the frame
```

- **The discriminant is the first byte.** A JSON frame's first byte is always `{`; `0x00` can never
  begin one. So the handshake, `app.init`, `repo.open`, `repo.close` and `repo.changed` are
  byte-identical to what G1/G2 shipped, and a peer that never opens a stream never sees a blob
  frame. A version-mismatched peer's `hello` still parses, so §3.4's blocking-panel diagnosis is
  preserved.
- **Exactly one blob per frame, and it is the rest of the frame** — the length prefix already
  bounds it, so no second length is written. One blob covers every payload this design has (each
  response carries at most one bulk column set); a second would be a format change, and inventing
  the generality now is scope this phase does not have a caller for.
- **Where the blob belongs in the payload is the payload's business, not the frame's.** The header
  JSON carries the marker `{"$blob":true}` at the position the bytes belong, and the reader
  substitutes. `gitrpc` produces that marker as part of its own `commits` value
  (`{"$fb":"gitwire/1","d":{"$blob":true}}`); `rpcstream` never learns what a graph chunk is, which
  is the property `session.go:1-9`'s module doc exists to protect.
- **`socketChannel.ts` is the only TypeScript that learns about this** (§4.3). `codec.ts`,
  `rpc.ts` and `graphChunkCodec.ts`'s decode path see exactly the shape they see today: an
  `ArrayBuffer` at `chunk.commits.d`.

The client never sends a blob (it opens streams, it does not serve them), so `socketChannel.post`
and the Go read path are unchanged.

### D5 — `Handlers.Stream` widens to `emit func(payload any, blob []byte) error`, and an oversize chunk fails the stream loudly

Resolving F5 and F21, in the shape G1 §11 specified.

```go
// rpcstream
type Handlers struct {
    ContractVersion int
    Request func(ctx context.Context, method string, params json.RawMessage) (any, error)
    Stream  func(ctx context.Context, method string, params json.RawMessage,
                 emit func(payload any, blob []byte) error) error
}
```

`emit`'s type is plain Go — no `rpcstream` type in it — so `gitrpc.Handlers` mirrors it structurally
and `gitrpc` still does not import `internal/bridge` (`layering_test.go:29-44`, and G1 §3.4's
resolution, both unchanged).

`emit`'s body, in order:

1. `gate.acquire(ctx)` — the transcription of `rpc.ts:406-411`, and `credit.go`'s first real caller.
2. Encode the body (D4).
3. **If the encoded body exceeds the frame cap, return an error** rather than queueing a frame that
   `writeFrame` will silently refuse (F21). The stream then ends with a real `end` frame carrying
   `E_FRAME_TOO_LARGE`, which the client surfaces, instead of hanging forever.
4. Queue it, `seq++`.

The cap is a new `Handlers.MaxFrameBytes` (set by `gitsock` from its own `maxFrameBytes`) rather
than a constant duplicated in `rpcstream` — one number, one owner. Zero means unbounded, which is
what `session_test.go`'s existing fixtures get.

### D6 — `CONTRACT_VERSION` 12 → 13: `graph.stream` and `graph.loadMore` gain optional `scope` and `pageSize`, filled by the extension

Resolving F2.

```ts
'graph.loadMore': {
  params: { repoId: string; pages?: number; range?: CommitRange;
            scope?: 'all' | 'head'; pageSize?: number };
  result: { started: boolean };
};
...
'graph.stream': {
  params: { repoId: string; resumeThroughRow?: number; range?: CommitRange;
            scope?: 'all' | 'head'; pageSize?: number };
  ...
}
```

- **Optional, not required** — `packages/git-ui` must stay unchanged (SPEC §5), and it calls
  `stream('graph.stream', {repoId, resumeThroughRow})` (`state/graphView.ts:107-112`). A required
  field would be a type error in a package this phase may not touch.
- **The extension fills them in**, in `createProxyHandlers` (D18), from `vscode.workspace
  .getConfiguration()` — the same coerced snapshot `extension.ts:49-51` already maintains. This is
  SPEC's "can travel with the request and differ per window harmlessly", implemented at the one
  layer that knows the window's configuration.
- **The server defaults them** when absent (`scope: "all"`, `pageSize: 5000` — upstream's
  `DEFAULT_PAGE_SIZE`, `logSession.ts:69`), so a raw socket client (every Go integration test) needs
  no settings plumbing to drive a walk.
- **Both sides bump**: `packages/git-ipc/src/validate.ts:7` and `apps/kira-studio/internal/gitrpc/
  contract.go:11`, still by hand, still one integer (G1 D20's standing judgment, re-checked here and
  unchanged).

Rejected: a `settings.push` request from the extension to the server. It is a second mechanism for
the same job, it makes the walk's behaviour depend on request ordering across a reconnect, and SPEC
already said which mechanism this class of setting uses.

### D7 — `RepoID` becomes the worktree root for a non-bare repository, and the git dir for a bare one

Resolving F8.

```go
repoID := gitDir
if !isBare {
    repoID = root
}
```

- **It fixes the round trip.** `repo.open(repoId)` is the rehydration path and the `KIRA_REPO` path;
  `Identify(root)` works, `Identify(gitDir)` does not.
- **It keeps G2 F16's constraint satisfied.** F16's actual objection was that a bare repo has
  `Root == ""` and would collapse every bare repo onto one key — which this does not do, because a
  bare repo keeps `gitDir`.
- **It keeps per-worktree uniqueness.** A linked worktree has its own `--show-toplevel`, distinct
  from the main worktree's, so the property F16 wanted ("unique per worktree even when several
  linked worktrees share one `commonDir`") still holds.
- **It matches upstream** (`repoService.ts:979` keys sessions by `identity.root`), which is what the
  client half was written against.

One existing assertion changes: `repo_test.go:271-273` (`RepoID` equals `GitDir`) becomes the
two-armed rule. Nothing else in the tree reads `RepoID`'s contents
(`gitsock/integration_test.go` and `gitsession/*_test.go` only compare it to itself).

### D8 — `gitclient/porcelain` ports the log walk's parsers and nothing else

The package that lands is exactly what the history pipeline reads:

| From upstream | To | Notes |
|---|---|---|
| `core/util/nulSplit.ts`'s `RecordSplitter` | `porcelain/records.go` | incremental `-z` record splitting across chunk boundaries, with the same remainder cap |
| `core/util/nulSplit.ts`'s `splitLimitedFields` | `porcelain/records.go` | the final field absorbs extra delimiters — the rule that makes a subject containing `0x1f` harmless |
| `git/parse/log.ts`'s `LOG_FORMAT`, `revSetArgs`, `walkArgs`, `logSessionArgs`, `logSessionSkipArgs` | `porcelain/log.go` | verbatim, including `--decorate=full`, `--topo-order`, `-z` |
| `git/parse/log.ts`'s `parseLogRecord`/`parseFields`/`parseDecoration*` | `porcelain/log.go` | verbatim classification, prefix by prefix |
| `core/model/commit.ts`'s `CommitRecord`/`CommitIdentity`/`DecorationRef` | `porcelain/types.go` | the Go shapes the store and the packer consume |

**Not ported**: `parse/status.ts`, `parse/diff.ts`, `parse/diffTree.ts`, `parse/stash.ts`,
`parse/mergeTree.ts`, and `parse/refs.ts`'s full `RefRow` parser. Each lands with the RPC that reads
it (G4/G5/G8). SPEC §2's "porcelain parsers" row describes the package's eventual contents, not one
phase's.

**`revSetArgs` keeps its stash parameters** (`stashShas`, `includeStash`) because `walkArgs` is one
builder shared by the walk, the count and (in G10) the scan — upstream's own reason for it being one
function. G3 always passes `includeStash=false`/no shas, which is `["--all"]`; G8 supplies real
values. That is a parameter with one caller, not a stub: the alternative is a second builder in G8
and the two silently disagreeing about the rev set, which is the failure `parse/log.ts:26-27`
names.

`DecorationRef`'s `stash` arm is parsed (a `refs/stash` decoration classifies), because it is one
`if` inside a classifier that must be complete to be correct; the *stash rows* the graph shows are
G8's.

### D9 — The `--skip` guard's ref snapshot is its own narrow query, not `refs.list`'s parser

Upstream reuses `refsArgs()` — the full `for-each-ref` used by `refs.list`, with upstream,
track, worktreepath and tag annotation — to capture a snapshot that only ever compares refname →
object id (`logSession.ts:91-120`).

G3 ports the snapshot, not the parser:

```go
// porcelain/refsnapshot.go
func RefSnapshotArgs() []string   // for-each-ref --format=%(refname)%x00%(objectname) --  (NUL-terminated records)
func ParseRefSnapshot(records [][]byte) (map[string]string, error)
```

Reason: `refs.list`'s parser is G5's, it is the largest of the porcelain parsers, and half-porting it
here to serve a comparison that needs two fields is precisely the half-implementation `AGENTS.md`
forbids. The snapshot is complete in itself, it is strictly cheaper than upstream's (no `%(upstream:
track)`, which costs git a reachability computation per ref), and when G5 lands the full parser the
snapshot keeps its own query rather than acquiring a dependency on one.

The range-walk snapshot (`captureRangeEndpointSnapshot`, `logSession.ts:128-155`) is **not** ported:
it exists only for a ranged walk, and ranged walks are G6.

### D10 — `gitclient/logsession`: upstream's session, ported whole, with idle reclaim switched on at 5 minutes

```go
package logsession

type Options struct {
    Walk          porcelain.WalkSpec
    PageSize      int            // 0 → DefaultPageSize (5000)
    IdleReclaim   time.Duration  // 0 → defaultIdleReclaim (5 min); negative → never
    PrecomputedTotal *int        // G6 supplies this for a ranged walk; nil here
}

type Outcome struct {
    Appended  int
    Exhausted bool
    Stale     bool   // refs moved under a reclaimed session — the caller resets and retries
}

type Session struct{ /* … */ }

func Open(deps Deps, opts Options) *Session
func (s *Session) ReadPage(ctx context.Context, sink func(porcelain.CommitRecord)) (Outcome, error)
func (s *Session) Remaining(ctx context.Context) (int, error)
func (s *Session) LoadedCount() int
func (s *Session) Exhausted() bool
func (s *Session) Close()
```

Ported faithfully, decision by decision: the pause *is* the page limit (stop reading, let the pipe
buffer apply backpressure); `#pendingRecords`'s carry-over (F13) becomes a `[][]byte` queue drained
before the read loop and again inside it; exhaustion is decided by exit code, never by EOF alone
(`logSession.ts:364-379`); `Remaining` caches one `rev-list --count` over the *same* rev set.

Two deliberate departures, both stated with their reason:

1. **`IdleReclaim` defaults to 5 minutes** (F10). Per-connection walks (F9) multiply the number of
   paused `git log` processes by the number of open windows, and a paused process holding a pipe
   open is the resource this backend has most of. Five minutes matches
   `gitsession.defaultLingerFor`, so a walk's process and its `RepoEntry` age out on the same clock.
   The `--skip` + ref-snapshot resume path (already ported, and already the guard against a spliced
   page) is what makes this safe — and switching reclaim on is what makes that path production code
   rather than test-only code.
2. **The short-lived spawns go through the repo's read gate; the long-lived one does not.** The
   paged `git log` calls the `Runner` directly (G2 F13: routing it through `Repo.Read` "would hold a
   quarter of the repository's read concurrency hostage"), but `for-each-ref` (the snapshot) and
   `rev-list --count` are ordinary burst reads and run inside `entry.Repo.Read` — which is what that
   gate is for. Upstream spawns all three outside its pool; the distinction it draws in prose
   (`logSession.ts:1-18`) applies only to the paused one.

### D11 — `gitclient/catfile` is built in this phase, wired onto `RepoEntry`, with its first production caller in G4 — and `Spec` finally gets a stdin

SPEC's G3 row names `cat-file --batch` as this phase's deliverable. Its consumers — `commit.detail`,
`commit.fileDiff`, blob reads — are G4's. The tension is real and is resolved as follows, with both
sides recorded because §11 flags it for a human:

- **It is built here**, as `gitclient/catfile`: the `--batch-check`-then-`--batch` pair, the
  two-phase framing state machine (`catFile.ts:109-180`), one request in flight per process, lazy
  restart bounded at three consecutive failures, and the `missing`-reply-by-suffix rule that
  `<rev>:<path>` requests with spaces in them depend on.
- **`RepoEntry` owns it, lazily**: SPEC §6 puts "cat-file batch session" in the shared box, and the
  entry's `teardown()` (`gitsession/entry.go:101-112`) is where its two processes must be killed.
  Constructing it lazily on first use means a G3-only session never spawns it, and G4 needs no
  lifecycle work at all.
- **`Spec` gains `Stdin bool` and `Process` gains `Stdin() io.WriteCloser`** — G2 §10's exact
  handed-forward shape (F14). This is the one piece of `runner.go` G3 touches, and `catfile` is what
  gives it a caller; adding stdin without it would be the "code with no caller" problem in its purer
  form.
- **What is honestly true**: no RPC reaches it in G3, and its proof is its own test against real git
  (§7.1(b)), not an end-to-end path.

Rejected: deferring the whole package to G4. It is a clean cut (nothing else in G3 depends on it,
and `Spec.Stdin` would move with it), and it is §11's first flagged question — but it makes G4 carry
parsing + cat-file + diff + detail + blob + four host methods in one phase, against a phasing table
that deliberately split them.

### D12 — `gitstore` is the *packing* half of `commitStore.ts` only

Resolving F11. The Go store keeps every column upstream keeps, and drops every mechanism that exists
for the renderer:

```go
type Store struct {
    shaWidth int          // 20 or 32, fixed by the first record
    shas     []byte       // rowCount * shaWidth
    parentOffsets []uint32 // rowCount + 1, CSR
    parentShas    []byte   // CSR order, shaWidth each — stored, never resolved (F11)
    authorName, authorEmail, committerName, committerEmail []uint32
    authorTime, committerTime []uint32
    subjectBytes   []byte
    subjectOffsets []uint32 // rowCount + 1
    decorations map[int][]porcelain.DecorationRef
    interner *Interner
}
```

Gone, with reasons: `#parentRows`, `#pendingParents`, `UNRESOLVED_PARENT_ROW`,
`resolvedParentSlots`, `layoutInput`, `commitAt`, `parentsOf`, `rowOfSha`, `appendPacked` — every
one of them serves the lane layout or the on-screen materialisation, both of which stay in
TypeScript (SPEC §2's closing line). A parent's sha is written into `parentShas` at append time
straight from the parsed record, which is what `packSlice` was reconstructing anyway.

Kept exactly: the uint32 timestamp clamp (`commitStore.ts:17-26` — clock-skewed histories are real,
and a `Float64Array` timestamp column for every repository to accommodate them is not the trade),
the interner's id-order dictionary delta (`intern.ts:60-68`'s `valuesFrom`), the contiguous subject
buffer with its `rowCount + 1` offsets, and `packSlice`'s CSR rebasing arithmetic.

`PackSlice(from, to, dictionaryBase) PackedChunk` returns Go-typed columns (`[]uint32` where the
wire says `[ubyte]`); **the little-endian conversion happens in exactly one place**,
`gitstore/encode.go`, next to the FlatBuffers builder (F12). Written with
`binary.LittleEndian.PutUint32` unconditionally — no `unsafe` fast path. `internal/page/encode.go`
has one because it encodes multi-megabyte result pages; a 500-row commit chunk is ~3,500 uint32s,
where the fast path would buy microseconds and cost a host-endianness branch this package would
otherwise never need.

### D13 — `gitsession.Walk`: one per (connection, repo), created lazily, torn down with its hold, invalidated per viewer

SPEC §6's `Conn.walks` finally exists.

```go
// walk.go
type Walk struct {
    entry *RepoEntry
    spec  porcelain.WalkSpec

    mu       sync.Mutex        // serialises every operation on this walk
    log      *logsession.Session
    store    *gitstore.Store
    marks    map[int]int       // boundary row -> interner size after it; seeded {0: 0}
    nextSeq  int
    lastRemaining int

    staleRefs    atomic.Bool   // set by the watcher fan-out — never takes mu
    staleRefresh atomic.Bool   // set by graph.refresh
}

// Conn
func (c *Conn) Walk(repoID string, gitPath string, spec porcelain.WalkSpec) (*Walk, error)
func (c *Conn) walkFor(repoID string) (*Walk, bool)
```

- **Ownership.** `Conn.walks map[string]*Walk`, created lazily by whichever `graph.*` handler runs
  first. `Conn.CloseRepo` and `Conn.Close` dispose the walk (killing its `git log`) **before**
  releasing the `RepoEntry` ref, so the registry's refcount can never reach zero while a walk still
  holds a process against that repository.
- **A scope change rebuilds it.** `Walk(repoID, gitPath, spec)` returns the existing walk when
  `spec` matches and otherwise disposes and rebuilds — upstream's `#ensureReviewWalk` shape
  (`repoService.ts:3379-3405`), applied to the one axis G3 has (`scope`).
- **One mutex, held for the whole of an operation**, including `emit`. Upstream gets this
  serialisation free from JavaScript's event loop; Go has to say it. A stalled consumer cannot hold
  it indefinitely: `creditGate.acquire` returns on ctx cancellation (`credit.go:35-51`), and
  `rpcstream` cancels a stream's ctx on `cancel` and on disconnect. The cost is that a client which
  opens a stream and stops granting credit blocks *its own* subsequent `graph.*` calls for *that
  repo* until it cancels — which is what the UI's own single-flight guard (`state/graphView.ts:134`,
  `loading.value !== 'idle'`) already enforces from the other side.
- **Invalidation never touches the mutex.** The watcher fan-out runs on the subscriber's goroutine
  (G2 D14) and must not block behind a page read, so `refsChanged` sets `staleRefs` with
  `atomic.Bool.Store(true)`; `graph.refresh` sets `staleRefresh` the same way. `ensureFresh` (under
  the mutex, at the top of every operation) tests-and-clears both, and on either drops the store,
  reseeds `marks` to `{0:0}`, zeroes `lastRemaining` and reopens the log session — upstream's
  `#resetSession` (`repoService.ts:3292-3306`) minus the stash refresh (G8).
- **`Conn.Open`'s subscriber callback marks before it emits**, so a client that reacts to
  `repo.changed` by re-opening its stream can never observe a walk that has not yet been told.

`RepoEntry` gains nothing in this phase but the lazy `catfile` session (D11) — SPEC §6's caches,
head, stash shapes, undo slot and active remote op stay with their phases, exactly as G2 D13 set the
precedent.

### D14 — `gitrpc` serves four `graph.*` methods; a `range` parameter is refused, not half-served

| Method | Behaviour |
|---|---|
| `graph.status` | the walk's `{loaded, remaining, exhausted}`; `{0,0,false}` when this connection has no walk for the repo (upstream's own answer for an unopened range, `repoService.ts:1005-1017`) |
| `graph.loadMore` | `{started:false}` when exhausted; else read `pages` pages into the walk and answer `{started:true}` |
| `graph.refresh` | sets `staleRefresh`; `{restarted:true}` when this connection has a walk, `{restarted:false}` when it does not (upstream returns `false` for an unknown session, `repoService.ts:1166-1172`) |
| `graph.stream` | upstream's `streamGraph` (`repoService.ts:1029-1100`) transcribed: `ensureFresh`, clamp `resumeThroughRow` to the store's row count, resolve its dictionary base from `marks` (falling back to row 0/base 0 when the row has no mark), replay `[cursor, cachedThrough)` as `source:"cache"` in 500-row chunks, read one page from git only when nothing is cached at all, then emit the new rows as `source:"git"` |

**`range` is refused**: `ipcerr.BadRequest("gitrpc: graph.stream: ranged walks are not served by this
build")`, on all three methods that accept one. It is the honest statement of what this server does
— the same posture as G1 D12's single `default` arm — and no client in G3 sends one, because the
review view is not registered until G6.

`CHUNK_ROWS = 500`, `DefaultPageSize = 5000`: upstream's constants (`repoService.ts:711`,
`logSession.ts:69`), named as Go constants, not literals.

The chunk envelope, in `gitrpc/wire.go`:

```go
type graphChunk struct {
    RepoID    string      `json:"repoId"`
    Seq       int         `json:"seq"`
    From      int         `json:"from"`
    To        int         `json:"to"`
    Source    string      `json:"source"`     // "git" | "cache"
    Remaining int         `json:"remaining"`
    Exhausted bool        `json:"exhausted"`
    Commits   commitsBlob `json:"commits"`
}

// commitsBlob marshals as {"$fb":"gitwire/1","d":{"$blob":true}} — the D4 marker naming where the
// frame's out-of-band FlatBuffer belongs once the reader substitutes it.
type commitsBlob struct{}
```

### D15 — The golden corpus is committed bytes with an env-gated Go regenerator

Resolving F15, with this repo's own pattern rather than a new one.

- `apps/kira-studio/internal/gitclient/porcelain/testdata/log/{linear,branchy,crissCross,octopus}.bin`
  — recordings of `git log` over four deterministic topologies (a linear chain, a branchy history
  with a merge and a `HEAD -> main` decoration, a criss-cross, and an octopus merge), matching
  upstream's own four generated shapes.
- `.../testdata/handAuthored/{emptySubject,crlfSubject,subjectWith0x1f,fullDecoration}.bin` — the
  four edge cases a generated repository cannot produce, built with plumbing exactly as
  `recordPorcelain.ts` builds them.
- **`KIRA_GIT_FIXTURES=write go test ./apps/kira-studio/internal/gitclient/porcelain/...`**
  regenerates all eight from real `git`, byte-identically run to run (fixed identity, fixed
  `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, fixed tree content ⇒ deterministic object ids). Mirrors
  `KIRA_IPC_FIXTURES=write` (`AGENTS.md`) in spelling and in intent.
- **The recorder builds its argv from `porcelain`'s own builders**, never from a copied string —
  upstream's rule (`recordPorcelain.ts:7-10`), and the thing that stops a fixture from silently
  ceasing to represent what the parser is fed.

Assertions are structural and, where the fixture is deterministic, sha-pinned: parent counts per
topology, `HEAD -> main` classified as `{branch, isHead:true}`, `refs/tags/…` as `tag`,
`refs/remotes/…` as `remoteBranch`, `refs/stash` as `stash`, an unrecognised `refs/` namespace kept
rather than dropped, an empty subject surviving as `""`, a `0x1f` inside a subject not shifting any
field, and a CRLF subject preserved byte for byte.

The remaining ~30 upstream fixtures (`diffBody`, `diffTree`, `refs`, `stash`, `status`, `mergeTree`,
and the `scan*` recordings) arrive with their parsers in G4/G5/G8/G10.

### D16 — One cross-language fixture is what actually proves the wire, and it is a captured frame

Everything else in §7 proves one side. This proves the seam:

- A Go test (`internal/gitsock`, under `KIRA_GIT_FIXTURES=write`) drives a real `graph.stream` over
  a real socket against a real fixture repository and writes **the first chunk frame's exact body
  bytes** to `packages/git-ipc/testdata/graphChunkFrame.bin`, plus the decoded values it expects a
  reader to recover, to `packages/git-ipc/testdata/graphChunkFrame.json`.
- A bun test (`packages/git-ipc/src/socketChannel.test.ts`) feeds those bytes through
  `createSocketChannel` over a real socket, then through `unwrapVersioned` and
  `decodeStreamPayload('graph.stream', …)`, and asserts the resulting `PackedCommitChunk` field for
  field against the JSON.

One fixture, both layers: the binary frame's byte layout (D4) *and* the FlatBuffers schema's
encoding (D1/D12). If the Go encoder and the TS decoder ever disagree — a field written to the wrong
slot, a big-endian column, a mis-sized header prefix — this is the test that fails, and it is the
only one that can.

### D17 — The graph webview view is registered in this phase; the review view is not

Resolving F16, and honouring both SPEC's G3 row ("the graph renders end to end") and G1 D13's
explicit hand-off ("G3 is the phase that first has a graph to draw; it wires the two providers as
its own first step" — one of the two, here).

What that means precisely, stated rather than discovered later:

- `kiraVersion.graph` is registered; `kiraVersion.review` is not (G6). The `kiraVersion.focusGraph`
  command returns to `package.json#contributes.commands` (G1 §5.4 removed it saying it "returns in
  G3"); `kiraVersion.reviewBranch` does not.
- Four requests reject on every repo open — `refs.list`, `status.get`, `undo.peek` (G5),
  `stash.list` (G8) — plus `commit.detail`/`commit.fileDiff` (G4) on row selection. The rejection is
  the same `E_UNKNOWN_METHOD` a genuinely wrong method name gets; nothing is stubbed, nothing lies.
- Visibly, in G3: the graph draws (rows, lanes, subjects, authors, dates, ref badges — all of it
  comes out of the chunk itself), the branch picker is empty, the detail pane errors on selection,
  and the webview console carries unhandled rejections from the three `void`-called reloads (F16).
- `app.init`'s `capabilities` are reported **honestly false** for all four (D18), which is what that
  block is for (`contract.ts:855-864`: "an optional capability the UI feature-detects rather than
  assumes") — so the UI does not offer actions it cannot complete.

The alternative — defer registration to G5, when only `stash.list` still fails — is real, is
cheaper, and pushes SPEC's own G3 deliverable three phases out. §11 flags it.

### D18 — `createProxyHandlers` lands here, answering three methods locally and forwarding the rest

The composition SPEC §5 items 2–4 describe, written for the first time (G1 §5.5 deliberately did not
write it: "a version of it that only forwards would be replaced wholesale by G4").

```ts
// apps/kira-studio-vscode/src/proxyHandlers.ts
export function createProxyHandlers(deps: {
  connection: ConnectionManager;
  settings: () => SettingsSnapshot;
  roots: WorkspaceRoots;
  dialogs: Dialogs;
  serverGit: () => GitStatus;
}): ServerHandlers
```

- **Answered locally**: `app.init` (composed — `host: 'vscode'`, `contractVersion`, the coerced
  settings snapshot, `git` from the server's own `app.init`, and `capabilities` reporting
  `openInEditor`/`goToFile`/`clipboard`/`resolveConflict` as **`false` until G4 wires the ports**),
  `repo.list` (`roots.list()`), `repo.pick` (`dialogs.pickFolder`). F17 is why the last two are here
  and not in G4: without them the graph cannot be pointed at a repository at all.
- **Injected**: `graph.stream` and `graph.loadMore` get `scope`/`pageSize` from the current settings
  snapshot before forwarding (D6).
- **Forwarded**: everything else, verbatim, through `connection.request`/`connection.stream` — and
  a method the server does not serve rejects, which is the honest answer.
- **Events**: `repo.changed` is forwarded from the connection into the view's `RpcServer.emit`,
  replacing G1 §5.5's `service.onChanged` note. `settings.changed` continues to be emitted by
  `extension.ts`'s configuration watcher through `notifySettingsChanged` (`panelView.ts:66-68`),
  which already exists and has never been called.
- The remaining four host-capability methods stay unanswered until G4, at which point this file
  grows four cases and `capabilities` starts reporting `true`. That is an additive change to one
  file, which is the whole reason for writing the seam now rather than a forwarder G4 replaces.

### D19 — `ConnectionManager` gains `stream` and `on`, mirroring `request` exactly

```ts
stream<K extends StreamKey>(method: K, params: StreamParamsOf<K>,
                            onChunk: (chunk: StreamChunkOf<K>) => void,
                            signal?: AbortSignal): Promise<void>
on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void
```

Both delegate to `#transport` (`connection.ts:117`'s shape), both reject/no-op the same way when not
connected. `on`'s subscriptions must survive a reconnect — the transport is rebuilt on every
successful handshake — so `ConnectionManager` keeps its own handler set and re-subscribes the new
transport, which `request` does not need and is the one piece of real logic here.

### D20 — `test:unit` gains `packages/git-ipc/src`; `build:vscode` gains a documented place in the proof

Resolving F18 and F19.

- `package.json`'s `test:unit` becomes
  `bun test apps/kira-studio/tests/unit packages/api-core/test packages/git-ipc/src`. Verified here:
  those 34 tests pass today, so this adds coverage rather than a red suite, and D16's new
  cross-language assertion lands somewhere that actually runs.
- `build:vscode` stays out of `bun run build` and `scripts/setup.sh` (it is not on the critical path
  of a Kira Studio dev run, and G1's reasoning for keeping it off there is unchanged), but §7.1(f)
  makes running it a per-phase exit criterion from now on, since a webview that does not bundle is a
  graph that does not render.

### D21 — RE2 vs. JS `RegExp` is untouched, and stays G10's

SPEC's "Known open items" flags it, and the prompt asks G3 to say plainly whether it is touched.
It is not: G3 compiles no pattern, matches no text, and creates no `gitsearch` package.
`packages/git-core/src/search/matcher.ts` travels unchanged and unloaded.

The one thing G3 does that G10 will depend on is preserved deliberately: `logSessionArgs` and
(in G10) `logScanArgs` are built from the *same* `walkArgs(walk)` call, so the paging walk and the
tail scan produce byte-identical ordering over the same rev set — upstream's own probe-11 property
(`parse/log.ts:122-136`). Porting `walkArgs` as one shared builder in D8 is what keeps it true.

### D22 — Perf is measured and recorded in this phase, not asserted

SPEC's second known open item asks for empirical confirmation "in G3 and G11", not for a budget
re-derived from upstream's `postMessage` numbers.

An opt-in Go test (`-run TestGraphStreamPerf`, skipped under `testing.Short()` and behind
`KIRA_GIT_PERF=1`) builds an N-commit repository through **one `git fast-import`** (not N commits —
a per-commit spawn makes a 20k-commit fixture take minutes), opens `graph.stream` over the real
socket and records: time to the first chunk delivered, time to a full 5000-row page, mean bytes per
chunk, and total bytes for the page. It prints them; it asserts nothing. The numbers go in the
commit message and are carried to G11, which re-measures on real hardware against the same harness.

Asserting a threshold here would be asserting it about this container, which is not the shipped
platform — the same honesty §7.2 applies to everything else.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/`.

### 3.1 `internal/gitclient/porcelain/` — new (D8, D9, D15)

| File | Contents |
|---|---|
| `types.go` | `CommitIdentity`, `DecorationRef` (a `Kind`/`Name`/`IsHead`/`Index` struct mirroring the TS union), `CommitRecord`, `WalkSpec` (`Scope`/`Range` two-arm) |
| `records.go` | `RecordSplitter` (incremental, delimiter-parameterised, `maxRemainderBytes` cap with a named error), `SplitLimitedFields(b []byte, delim byte, n int) [][]byte` |
| `log.go` | `LogFormat`, `FieldCount`, `RevSetArgs`, `WalkArgs`, `LogSessionArgs`, `LogSessionSkipArgs`, `ShowMetadataArgs`, `ParseLogRecord`, `parseDecoration`, `parseDecorationToken`, `parseIdentity` |
| `refsnapshot.go` | `RefSnapshotArgs`, `ParseRefSnapshot` (D9) |
| `records_test.go` | chunk-boundary state: a record split across three pushes; a delimiter as the first/last byte of a chunk; the trailing empty record after the final NUL; `SplitLimitedFields` letting the final field absorb extra delimiters; the remainder cap |
| `log_test.go` | the golden corpus (D15), table-driven over the eight fixtures |
| `fixtures_test.go` | the `KIRA_GIT_FIXTURES=write` recorder: four deterministic topologies built with real `git`, four hand-authored cases built with plumbing, argv from this package's own builders |

### 3.2 `internal/gitclient/runner.go` + `internal/gitclient/catfile/` — edited / new (D11)

`runner.go`: `Spec` gains `Stdin bool`; `Process` gains `Stdin() io.WriteCloser`; `execRunner.Start`
calls `cmd.StdinPipe()` when asked and `execProcess` carries it, closing it in `Close`. Nothing else
in the file moves — the hygiene set, the process group, the cancel/escalate sequence and the bounded
stderr drain are G2's and stay exactly as they are.

| File | Contents |
|---|---|
| `catfile/batch.go` | `batchReader`: the two-phase framing state machine (header line to LF, then exactly `size` bytes plus the protocol's trailing LF), `missing` recognised by its ` missing` suffix, an unrecognised header line a hard error |
| `catfile/session.go` | `persistentProcess` (lazy start, FIFO one-in-flight queue, exit handling, three-consecutive-failure circuit breaker) and `Session` over the `--batch-check`/`--batch` pair with the `maxBlobBytes` gate (`DefaultMaxBlobBytes = 10 MiB`); `Read`, `Check`, `Close` |
| `catfile/catfile_test.go` | the framing state machine against a real repository: a found blob, a `missing` reply, a `missing` reply whose echoed request contains spaces, a response split across arbitrary read boundaries, a blob over the size gate answered from `--batch-check` alone with no content read, and a killed process failing every queued request rather than hanging |

### 3.3 `internal/gitclient/logsession/session.go` — new (D10)

`Deps{Runner gitclient.Runner, GitPath, Dir string, Read func(ctx, fn) error}` — `Read` is
`(*gitclient.Repo).Read`, injected rather than imported so the package stays testable without a
registry, and so D10's "short spawns through the gate, the paused one direct" is visible in the type.

`session_test.go` covers, and covers only, what `AGENTS.md`'s bar admits:

- **the page boundary** (F13): a page size that lands mid-chunk, the remainder delivered by the
  *next* `ReadPage` and none dropped — asserted by counting records against a repository whose
  commit count is known;
- **exhaustion**: the last page reports `Exhausted:true` and a further `ReadPage` is a no-op;
- **reclaim + `--skip`**: with `IdleReclaim` set to milliseconds, the process is gone after the
  window and the next page resumes at the right record;
- **the staleness guard**: a commit created between two pages of a reclaimed session yields
  `Outcome{Stale:true}` rather than a spliced page;
- **cancellation**: a ctx cancelled mid-page kills the child and returns promptly.

### 3.4 `internal/gitstore/` — new (D12)

| File | Contents |
|---|---|
| `intern.go` | `Interner`: `Intern(string) uint32`, `Size`, `ValuesFrom(base)` |
| `sha.go` | `hexToBytes`/`bytesToHex`, width detection (20/32) fixed by the first record |
| `store.go` | `Store`, `Append(porcelain.CommitRecord)`, `RowCount`, `Clear`, the uint32 timestamp clamp |
| `pack.go` | `PackSlice(from, to, dictionaryBase int) PackedChunk` — CSR rebasing, the identity/time columns, the chunk-relative decoration list, the dictionary delta |
| `encode.go` | `EncodeChunkFrame(PackedChunk) []byte` — the `gitwire.Frame`/`Payload` builder, little-endian column serialisation (F12), `FinishFrameBufferWithFileIdentifier` |
| `pack_test.go` | the boundary arithmetic: a slice starting mid-store rebasing `parentOffsets` to 0; a root commit's empty parent range; the dictionary delta at `base == interner size` and at a base several chunks back; `sha_width_bytes` on an empty store |
| `encode_test.go` | round-trip through the generated Go decoder: identifier present, every column recovered, uint32 columns little-endian byte for byte |

### 3.5 `internal/gitwire/` — new, generated (D1, D3)

Five files, `package gitwire`, produced by `scripts/generate-wire.sh` and committed. Not hand-edited,
not exempted from anything: it imports only `flatbuffers`, so `layering_test.go`'s auto-enumeration
covers it with no change to `packagesExemptFromBridgeCheck`.

### 3.6 `internal/bridge/rpcstream/` — edited (D4, D5)

| File | Change |
|---|---|
| `frame.go` | new `encodeBody(env envelope, blob []byte) ([]byte, error)` — D4's `0x00`/`uint32BE`/header/blob layout for a blob frame, plain `json.Marshal` otherwise; `blobMarker` documented beside it |
| `session.go` | `Handlers.Stream` widened (D5) and `Handlers.MaxFrameBytes` added; `handleOpen` builds and passes `emit`; `send` routed through `encodeBody`; the `Emit` doc comment left alone (G2's caller is unchanged) |
| `session_test.go` | one new test: a stream handler that emits two chunks, one with a blob and one without, and a fake `Conn` asserting the exact bytes of both — including that the JSON-only frame is byte-identical to what a `res` frame produces today |

### 3.7 `internal/gitsession/` — edited (D13)

| File | Change |
|---|---|
| `walk.go` | new — `Walk`, `ensureFresh`, `ReadPage`, `Stream` (the packing/emitting loop), `Status`, `MarkStale`, `dispose` |
| `conn.go` | `walks map[string]*Walk`; `Walk(repoID, gitPath, spec)`; `CloseRepo`/`Close` dispose walks before releasing refs; the subscribe callback marks the walk stale before emitting |
| `entry.go` | a lazily-constructed `catfile.Session` and its teardown (D11) |
| `walk_test.go` | the concurrency and invalidation this phase adds: a stream and a `loadMore` racing on one walk produce a consistent store; a `refsChanged` between two pages resets to row 0 and the next chunk carries `from: 0`; `resumeThroughRow` past the store's rows clamps and replays from 0; a mark-less row replays from 0 with base 0; disposing a conn kills the walk's process |

### 3.8 `internal/gitrpc/` — edited (D6, D14)

| File | Change |
|---|---|
| `contract.go` | `ContractVersion = 13` |
| `wire.go` | `GraphStatusParams`/`Result`, `GraphLoadMoreParams`/`Result`, `GraphRefreshParams`/`Result`, `GraphStreamParams`, `graphChunk`, `commitsBlob` |
| `graph.go` | new — the four handlers, `range` refusal, the 500-row emit loop |
| `handlers.go` | `Request` gains three cases; `Stream` gains `graph.stream` and keeps its `E_UNKNOWN_METHOD` default; `Handlers.Stream`'s signature mirrors D5's |

**No dedicated test.** Still thin dispatch over tested code (`AGENTS.md`'s pass-through exclusion);
the behaviour that matters is §3.9's.

### 3.9 `internal/gitsock/` — edited

`server.go` passes `MaxFrameBytes: maxFrameBytes` into `rpcstream.Handlers` (D5). `frame.go` is
**unchanged** (D4). `integration_test.go` gains, over G1's existing harness:

- **`TestIntegration_GraphStreamRendersAPage`** — pair, `repo.open` a fixture repository with a
  known commit count, `open` + `credit` a `graph.stream`, and assert: chunk frames arrive as blob
  frames, `seq` increases from 0, `from`/`to` tile `[0, n)` in 500-row steps, `source` is `"git"`,
  `exhausted` is true on the last, the FlatBuffer carries `"KIG1"`, and decoding it yields the
  repository's real shas in `--topo-order`.
- **`TestIntegration_GraphStreamResumesFromCache`** — re-open the stream with
  `resumeThroughRow: <n>` and assert every chunk reports `source: "cache"` and no `git log` process
  is spawned (asserted through a counting `Runner` wrapper, not by process inspection).
- **`TestIntegration_WalksArePrivatePerConnection`** — two clients on one repository; A pages twice,
  B once; `graph.status` reports different `loaded` counts per connection, and A's `graph.refresh`
  leaves B's walk alone.
- **`TestIntegration_CreditsApplyBackpressure`** — a client that grants 2 credits and stops receives
  exactly 2 chunks and no more until it grants another.
- **the D16 fixture capture**, under `KIRA_GIT_FIXTURES=write`.
- **`TestGraphStreamPerf`** (D22), opt-in.

### 3.10 `internal/gitclient/repo.go` — edited (D7)

Four lines in `Identify`, and `repo_test.go:271-273`'s assertion becomes the two-armed rule (root for
a non-bare repo, git dir for a bare one), with a new sub-case asserting a bare repository still keys
on its git dir.

### 3.11 `main.go`

**Unchanged.** The registry, the router and the socket server are constructed exactly as G2 left
them; every new package is reached through types those three already hold.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ipc/schema/` and `src/generated/` (D1, D3)

Deleted: `schema/graphChunk.fbs`, `schema/graphChunk.fields.json`, `src/generated/graphChunk.ts`.
Added: `schema/gitwire.fbs`, `src/generated/gitwire.ts` + `src/generated/gitwire/*.ts` (generated,
committed, biome-excluded by the existing `biome.json:19` rule).

### 4.2 `packages/git-ipc/src/graphChunkCodec.ts` — rewritten (D1, D2)

Same file, same exported `toWire`/`fromWire`, same four drift guards — retargeted at the new
generated module, the `"KIG1"` identifier and the `Frame`/`Payload` root (`fromWire` reads
`Frame.payload(new PackedCommitChunk())`; `toWire` wraps its chunk in a `Frame` before finishing the
buffer with the identifier). The `stash`-index-through-the-`name`-slot convention
(`graphChunkCodec.ts:77-83`) is preserved verbatim: the schema is upstream's, so its workarounds are
too.

`codec.ts` changes in exactly two places: the `$fb` tag it writes and the one it accepts, both
`'graphChunk/1'` → `'gitwire/1'`.

### 4.3 `packages/git-ipc/src/socketChannel.ts` — edited (D4)

The read path learns the blob frame:

```
if (body[0] === 0x00) {
  headerLen = body.readUInt32BE(1)
  message   = JSON.parse(body.subarray(5, 5 + headerLen))
  blob      = body.subarray(5 + headerLen)          // copied into its own ArrayBuffer
  deliver(substituteBlob(message, blob))
} else {
  deliver(JSON.parse(body))                          // unchanged
}
```

`substituteBlob` is a fourth walk of the same shape rule `codec.ts`'s three traversals follow,
living here rather than there because it is a property of *this channel's* framing, not of the
buffer encodings `codec.ts` owns: it replaces the single `{"$blob": true}` object with the
`ArrayBuffer` and throws if it finds none or more than one. A malformed blob frame (a header length
past the end, a header that is not JSON) destroys the socket, exactly as `FrameTooLargeError`
already does — the same hard-error posture, never a silent truncation.

`post` is unchanged: the client never sends a blob (D4).

`socketChannel.test.ts` gains: a blob frame reassembled correctly; a blob frame split across three
socket reads; a JSON frame immediately following a blob frame in one read; a header length past the
frame end destroying the socket; a header carrying no `$blob` marker throwing; and **D16's captured
fixture**, decoded end to end into a `PackedCommitChunk` and compared to its JSON.

### 4.4 `packages/git-ipc/src/contract.ts` and `validate.ts` — edited (D6)

Two optional params on two methods; `CONTRACT_VERSION = 13`. No key added to any of the three maps
(`validate.ts:59-103`), because no method is added.

### 4.5 `apps/kira-studio-vscode/src/proxyHandlers.ts` — new (D18)

### 4.6 `apps/kira-studio-vscode/src/{connection,extension}.ts` and `package.json` — edited (D17, D19)

`connection.ts`: `stream` and `on`, with `on`'s subscriptions re-attached across a reconnect.

`extension.ts`: build the proxy handlers once the connection reaches `connected`, construct the
`KiraGraphViewProvider` with them, `registerWebviewViewProvider('kiraVersion.graph', …)`, call
`notifySettingsChanged` from the existing `onDidChangeConfiguration` watcher (`extension.ts:83-92` —
G1 removed the two calls saying they return in G3), and register `kiraVersion.focusGraph`.

`apps/kira-studio-vscode/package.json`: `contributes.commands` regains `kiraVersion.focusGraph` only.
`viewsContainers`/`views`/`colors` are already there, kept verbatim by G1 for exactly this moment.

### 4.7 Root `package.json` and `scripts/generate-wire.sh` — edited (D3, D20)

Two flatc invocations; `test:unit` gains `packages/git-ipc/src`.

**`packages/git-ui` and `packages/git-core` are not touched by this phase.** Not one file. If an
implementer finds themselves editing either, something has drifted out of scope (SPEC §5: the
existing webview UI ships as-is).

---

## 5. Dependencies and tooling

**No new dependency, in either language.** `flatbuffers` is already a direct dependency on both
sides (`go.mod:15`, `packages/git-ipc/package.json`), and the pinned `flatc` toolchain is P11's,
already provisioned by `scripts/generate-wire.sh` and verified working in this container (F7).

`go.mod` and `bun.lock` are expected to be **unchanged** by this phase. A diff in either is a signal
something was reached for that this plan did not sanction.

---

## 6. Implementation order

Ten commits. `go build ./apps/kira-studio/internal/...`, `go test ./apps/kira-studio/internal/...`,
`bun run lint` and `bun run typecheck` run after **each** — they are fast. The expensive tier
(§7.1(e)–(g)) runs once at C10, per `AGENTS.md`'s "implement the whole plan first, then test once".

- **C1** `feat(gitclient): porcelain record splitting and the log walk's parsers`
  — §3.1 in full, including the fixture recorder and the committed corpus. Nothing imports it yet.
- **C2** `feat(gitclient): writable stdin on the runner, and the cat-file batch session`
  — §3.2. `Spec.Stdin`/`Process.Stdin()` plus `catfile`, with its own tests against real git.
- **C3** `feat(gitclient): the pausable paged log session`
  — §3.3. Depends on C1's parsers and C2's runner change (only for the shared file, not for stdin).
- **C4** `feat(gitstore): column-wise commit store, interner and chunk packer`
  — §3.4 minus `encode.go`. Pure Go, no git, no FlatBuffers yet.
- **C5** `feat(gitwire): the KIG1 data-plane schema and its generated code`
  — §3.5 + §4.1 + §4.7's `generate-wire.sh` change + `gitstore/encode.go` + `encode_test.go`, and
  the TypeScript half of the swap (§4.2's rewritten codec, `codec.ts`'s two tag changes). **This
  commit deletes `graphChunk.*`**; it must land as one change because the TS codec and its generated
  module cannot be half-swapped.
- **C6** `feat(rpcstream): stream chunks, with one out-of-band binary payload per frame`
  — §3.6 + §4.3's `socketChannel.ts` read path and its non-fixture tests. The two halves of one byte
  format land together or the format has no meaning.
- **C7** `feat(gitsession): per-connection paged walks over the shared repo entry`
  — §3.7. Depends on C1, C3, C4.
- **C8** `feat(git): serve graph.status/loadMore/refresh/stream, and bump the contract to 13`
  — §3.8 + §3.9's `server.go` line + §3.10's `RepoID` fix + §4.4's contract/version change.
  **This is the atomic swap**: the contract version, the wire types, the handlers and the `RepoID`
  correction are one change that either compiles and agrees across both languages or does not.
- **C9** `feat(vscode): proxy handlers and the graph webview, wired to the socket`
  — §4.5 + §4.6 + §4.7's `test:unit` change.
- **C10** `test(git): graph.stream end to end, and the cross-language chunk fixture`
  — §3.9's integration tests, D16's fixture in both directions, and the full §7.1 run.

Dependency order: C1 before C3/C4/C7; C2 before C3 (shared file) and independent otherwise; C4 before
C5; C5 and C6 before C8; C7 before C8; C8 before C9; everything before C10.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 What is proven automatically, in this container

**(a) `go test ./apps/kira-studio/internal/gitclient/porcelain/...`** — the record splitter's
chunk-boundary state and the golden corpus (§3.1). Real `git` builds the fixtures; the committed
`.bin` files are what the parser is actually fed.

**(b) `go test ./apps/kira-studio/internal/gitclient/catfile/...`** — the batch protocol's framing
against a real repository, including a response split across arbitrary read boundaries and a
`missing` reply whose echoed request contains spaces (§3.2).

**(c) `go test ./apps/kira-studio/internal/gitclient/logsession/...`** — the page boundary, the
`--skip` resume, the ref-snapshot staleness guard, exhaustion by exit code, and cancellation
(§3.3). This is F13's arithmetic, tested.

**(d) `go test ./apps/kira-studio/internal/gitstore/...`** — CSR rebasing, the dictionary delta, and
a full round trip through the generated FlatBuffers decoder with the uint32 columns asserted
little-endian byte for byte (§3.4).

**(e) `go test ./apps/kira-studio/internal/gitsock/`** — `graph.stream` over the real socket against
a real repository: chunk tiling, `source` transitions, credit backpressure, per-connection walk
privacy, and the `"KIG1"` frame decoding to the repository's real shas in `--topo-order` (§3.9).
**This is the phase's real end-to-end proof on the Go side.**

**(f) `bun test packages/git-ipc/src`** (now inside `bun run test:unit`, D20) — the binary frame
reader, and **D16's captured fixture decoded field for field**. This is the only thing in the repo
that proves the Go encoder and the TypeScript decoder agree.

**(g) `bun run build:vscode`** — both bundles produced, the no-Bun-API check passing. Verified
working in this container before this plan was written (F19); from this phase on it is an exit
criterion, because a webview that does not bundle is a graph that does not render.

**(h) `bun run lint` / `bun run typecheck` / `bun run test:e2e-real` — green.** `test:e2e-real` adds
**no new spec**: `git-pairing-real.spec.ts`'s `{kind:"gitUnavailable"}` assertions still hold on
Linux (G2 F18's platform gate is unchanged), and a spec that only re-asserts them could not fail for
a G3 reason. Its continued passing is the regression check that the `CONTRACT_VERSION` bump and the
`RepoID` change did not break the un-openable path.

**(i) `go test ./apps/kira-studio/internal/`** — the layering test, with `internal/gitwire`,
`internal/gitstore`, `internal/gitclient/porcelain`, `internal/gitclient/catfile` and
`internal/gitclient/logsession` auto-enumerated and **none of them added to
`packagesExemptFromBridgeCheck`**.

**(j) `sh scripts/generate-wire.sh` leaves the tree clean** — the committed generated code is
reproducible from the pinned toolchain, for the git schema exactly as it already is for the studio
one.

**(k) `KIRA_GIT_PERF=1 go test -run TestGraphStreamPerf ./apps/kira-studio/internal/gitsock/`** —
numbers recorded, nothing asserted (D22).

### 7.2 What genuinely cannot be proven here, and the macOS script for it

Four things are structurally out of reach in this container:

1. **A real VS Code extension host.** No VS Code, no display, macOS-only product. §7.1(e)–(g) prove
   the protocol, the codec and the bundles; they do not prove `activate()` registering a view,
   `resolveWebviewView` rendering, or a webview actually painting rows.
2. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin (G2 F18), so
   nothing here exercises the real `/usr/bin/git` probe order behind a real `graph.stream`.
3. **The case-insensitive filesystem** F6 is about. Linux happily holds `gitWire.ts` and
   `gitwire.ts` side by side; the whole point of D1's filename is a platform this container is not.
4. **Perf on the shipped hardware.** §7.1(k) measures this container.

The macOS script, run once on real hardware before G3 is called done:

1. `go test ./apps/kira-studio/internal/...` on macOS — the same suite on the platform that ships.
2. `bun run generate:wire` on macOS, then `git status` — **one** `gitwire.ts` under
   `packages/git-ipc/src/generated/`, no case-collision casualty, tree clean. This is F6's only real
   check.
3. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository; pair.
4. Open the *Kira Version* graph view. **The graph draws**: rows, lanes, subjects, authors, dates and
   ref badges, on a repository with at least one merge and one tag. Scroll to the bottom, press
   *Load more*, confirm the next page appends and the row count grows.
5. Collapse the view and reopen it (VS Code destroys and recreates the webview). **The rows come
   back without git running again** — `source: "cache"` on every chunk, verifiable in the extension's
   output channel. This is §5.4's rehydration, and it is the one behaviour F8's `RepoID` fix exists
   for.
6. **Two windows, one repository**: page one window deep, leave the other at page one, and confirm
   the two disagree (F9's whole point) and neither disturbs the other. Then commit in a terminal and
   confirm both re-walk.
7. Confirm what is *expected to be broken* in this phase, so it is not mistaken for a regression:
   the branch picker is empty, selecting a row shows a detail-pane error, and the webview console
   carries unhandled rejections for `refs.list`/`status.get`/`undo.peek`/`stash.list` (D17).
8. `KIRA_GIT_PERF=1 go test -run TestGraphStreamPerf …` on real hardware, and record the numbers
   against §7.1(k)'s — the empirical answer SPEC's second known open item asks for, half of it.

### 7.3 The checklist

- [ ] `packages/git-ipc/schema/gitwire.fbs` exists, `namespace gitwire`, `file_identifier "KIG1"`,
      rooted at `Frame`; `graphChunk.fbs`/`.fields.json`/`generated/graphChunk.ts` are gone.
- [ ] `bun run generate:wire` regenerates Go and TS for both schemas and leaves the tree clean, on
      Linux and on macOS.
- [ ] `internal/gitwire` is generated, committed, imports only flatbuffers, and is not exempted from
      the layering check.
- [ ] A chunk frame is `0x00 | uint32BE headerLen | headerJSON | blob`; every other frame is
      byte-identical to what G1/G2 shipped, including the whole handshake.
- [ ] `socketChannel.ts` reassembles a blob frame, across arbitrary read boundaries, and destroys the
      socket on a malformed one.
- [ ] `rpcstream.Handlers.Stream` can emit; `emit` acquires a credit first and refuses an oversize
      frame with an error rather than dropping it.
- [ ] `CONTRACT_VERSION` is 13 on both sides; `graph.stream`/`graph.loadMore` carry optional
      `scope`/`pageSize`; no request/event/stream **key** was added or removed.
- [ ] The extension injects `scope`/`pageSize` from VS Code configuration; the server defaults them.
- [ ] `RepoID` is the worktree root for a non-bare repo and the git dir for a bare one, and
      `repo.open(repoId)` round-trips.
- [ ] The log walk's argv is `log --decorate=full --topo-order -z --format=<LOG_FORMAT>` plus
      `walkArgs`, built by one shared builder.
- [ ] A page that fills mid-chunk carries its remaining parsed records to the next page; none is
      dropped.
- [ ] A paused walk is reclaimed after 5 minutes idle and resumes by `--skip`, refusing a spliced
      page when refs moved.
- [ ] Parents travel as shas; the server resolves no parent to a row anywhere.
- [ ] Every uint32 column crosses little-endian, converted in exactly one file.
- [ ] A chunk carries at most 500 rows; the dictionary is a delta against a per-row mark, never a
      running cursor.
- [ ] `resumeThroughRow` is clamped, and a row with no mark replays from row 0 with base 0.
- [ ] `Walk` is per (connection, repo); two connections on one repository page independently, and one
      connection's `graph.refresh` does not touch the other's.
- [ ] A `refsChanged` marks every holder's walk stale without the watcher's fan-out ever taking a
      walk's mutex.
- [ ] Disposing a connection kills its walks' `git log` processes before releasing the repo refs.
- [ ] A `range` parameter is refused with a clear error on all three methods that accept one.
- [ ] `catfile` exists, is owned lazily by `RepoEntry`, is torn down with it, and has no G3 caller.
- [ ] The graph webview view is registered; the review view is not; `kiraVersion.focusGraph` is back.
- [ ] `app.init` is composed by the extension and reports all four capabilities `false`.
- [ ] `packages/git-ui` and `packages/git-core` are byte-for-byte unchanged.
- [ ] `go.mod` and `bun.lock` are unchanged.
- [ ] §7.1(a)–(k) all green; §7.2's eight macOS steps all pass.

---

## 8. Sequencing — one implementer, with one defensible cut

**Recommendation: one sequential Sonnet subagent for the whole phase.**

G3 is materially larger than G1 or G2, and the temptation to split it is correspondingly stronger.
It is still the wrong trade, for three reasons:

1. **C8 is a cross-language atomic swap.** The contract version, the wire types, the four handlers
   and the `RepoID` correction have to agree across Go and TypeScript in one commit. An agent that
   did not write C5's schema and C6's frame format cannot land it against a compiler; it would be
   landing it against this plan's prose, and every discrepancy would surface in C10 — the commit
   neither agent owns.
2. **The wire format is one idea held in two languages.** D4's byte layout exists in
   `rpcstream/frame.go` and `socketChannel.ts`, and D1's schema exists in `gitstore/encode.go` and
   `graphChunkCodec.ts`. Splitting by language is splitting a format down the middle; D16's fixture
   catches a disagreement, but only after both halves are written, and the fix is then a negotiation
   between two agents rather than an edit.
3. **`AGENTS.md` is explicit**: parallel subagents "only when the plan's work is genuinely
   independent (unrelated adapters, non-overlapping fixes)". A parser, the store built on it, the
   wire format built on that, and the session state built on all three are the textbook case of not
   that.

**If the orchestrator does choose to parallelise**, the only defensible cut is **C2 alone** —
`Spec.Stdin`/`Process.Stdin()` plus the whole of `gitclient/catfile` and its tests. It is the one
piece of this phase nothing else in it depends on (D11 says so plainly: its first caller is G4's), it
touches one shared file in one small, mechanical way, and it can run concurrently with C1/C3–C5.
Everything from C6 onward stays sequential behind all of it.

---

## 9. Explicit non-goals for G3

| Not in G3 | Owner |
|---|---|
| `status --porcelain=v2`, `diff`, `diff-tree`, `stash list`, `merge-tree`, the full `for-each-ref` parser, and their fixtures | G4 / G5 / G8 |
| `commit.detail`, `commit.fileDiff`, blob reads, line-mapped "Go to file" — i.e. every production caller of `catfile` | G4 |
| `editor.openDiff`, `editor.goToFile`, `clipboard.write`, `editor.resolveConflict`, and `app.init`'s capabilities reporting `true` | G4 |
| `refs.list`, `status.get`, `undo.peek`, the pre-flight engine, the in-progress banner | G5 |
| The ranged/review walk, the review webview view, `review.resolveBase`/`review.open`, `review.target` | G6 |
| Remote ops, the askpass broker, the credential relay, auto-fetch, server-owned settings | G7 |
| `stash.list`/`stash.show`, `stash.showInGraph`'s rev-set arguments, the stash row filter | G8 |
| Reset, cherry-pick, the completed undo slot | G9 |
| Search, the tail scan, and the RE2-vs-`RegExp` reconciliation (D21) | G10 |
| The two-window/two-repo matrix, revoke-while-connected, stale-socket recovery, the perf re-baseline on real hardware | G11 |
| Any embedded git UI in Kira Studio's own Wails frontend | out of scope for v1.3 |
| Any change to `packages/git-ui` or `packages/git-core` | never, per SPEC §5 |

---

## 10. Handed forward

Open items this phase found and deliberately did not close. Each belongs in the named phase's own
plan, not in `AGENTS.md`.

- **`catfile` has no production caller until G4** (D11). `RepoEntry` constructs it lazily and tears
  it down; **G4** supplies `commit.detail`/`commit.fileDiff`/blob reads. If G4 finds the session's
  shape wrong for those, changing it costs nothing that has shipped.
- **Four requests reject on every repo open, and the UI does not catch them** (F16/D17). **G5**
  closes three (`refs.list`, `status.get`, `undo.peek`), **G8** the fourth (`stash.list`), **G4**
  `commit.detail`. Until then the console noise is expected, not a regression, and §7.2 step 7 says
  so out loud.
- **`Payload` is a one-member union today** (D1). **G4** adds diff-hunk and blob-bytes members —
  appended, never renumbered — and gets the frame, the identifier and the reader for free. If G4
  needs a payload that is not a `Frame` member, that is a schema change worth re-reading D1 first.
- **`Walk` holds the whole operation's mutex, including `emit`** (D13). It is upstream's own
  serialisation, made explicit, and it is safe only because a stream's ctx is cancellable. **G6**'s
  ranged walk lands beside it in the same `Conn.walks` map and inherits the property; if a phase
  ever adds a `graph.*` call the UI can issue *while* a stream is stalled, this is the assumption to
  revisit.
- **A `graph.stream` chunk is capped by the frame cap** (D5/F21). 500 rows against 8 MiB is ~16 KiB
  of subject per row before it bites, which no real repository approaches — but the failure is now
  a loud `E_FRAME_TOO_LARGE` rather than a hang. **G11**'s perf re-baseline should record the real
  distribution of chunk sizes so a future phase can decide whether the chunk should split on bytes
  as well as rows.
- **`packages/git-ipc`'s tests only just started running** (F18/D20). Anything they were silently
  failing to catch between G1 and G3 is now caught; if C9's run turns up something red that G3 did
  not cause, it is a G1/G2 finding surfacing late, not a G3 regression.
- **`CONTRACT_VERSION` is still duplicated across languages by hand** (G1 D20). This phase bumps it
  for the first time, which is the moment that judgment gets tested. It survived: two files, one
  integer, one commit. **G8** and any later phase that changes params will bump it again; if a phase
  ever needs to change it *and* a second cross-language constant, revisit rather than adding a
  third.
- **The perf numbers §7.1(k) records are this container's** (D22). **G11** re-measures on real
  hardware against the same harness and against a repository with a deliberately large loose-ref
  set (G2 §10's own carried-forward item), so the two open questions SPEC lists get one answer each.

---

## 11. Two calls worth a human eye before implementation starts

Both are judgment calls the orchestrator or the user may reasonably decide differently, and both are
cheap to change *now* and expensive to change after C9. Neither is a blocker: the plan takes a
position on each and can be implemented as written.

### 11.1 Does the graph webview really get registered in G3? (D17, F16/F17)

**As planned**: yes. SPEC's G3 row says "the graph renders end to end", G1 D13 hands registration
here by name, and the graph itself works completely. The cost is a panel with an empty branch picker,
a detail pane that errors on selection, and four unhandled promise rejections per repo open, until
G5/G8 close them — visible to anyone who opens the panel between now and then, and unfixable inside
G3 because `packages/git-ui` may not be touched.

**The alternative**: defer registration to G5 (after which only `stash.list` still fails) or G8
(after which none does), and prove G3's graph through §7.1(e)'s Go integration tests plus a
`bun run build:vscode` that is known to bundle. That is cleaner to look at and pushes SPEC's own G3
deliverable two to five phases out.

This is a product-facing call about what a half-built panel is allowed to look like during
development, not an engineering one.

### 11.2 Is `cat-file --batch` built in G3 or moved to G4? (D11)

**As planned**: built in G3, because SPEC's G3 row names it and because it is what gives
`Spec.Stdin` a caller. It ships with real tests and no production consumer until G4.

**The alternative**: move `gitclient/catfile` and the `Spec.Stdin`/`Process.Stdin()` change wholesale
into G4. It is a clean cut — nothing else in G3 touches either — and it is more consistent with how
G2 handled the same tension twice (D16's `capabilitiesForVersion`, §10's `Spec.Stdin`/`Env`), which
both deferred to the phase with the first caller. The cost is that G4 then carries parsing, cat-file,
diff, detail, blob reads and four host-capability methods in one phase.

If the orchestrator prefers the stricter no-caller discipline, drop C2 from §6 entirely and move
§3.2 into G4's plan; nothing else in this plan changes.
