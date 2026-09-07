# G4 — Commit detail, diff, blob reads, and the host-capability methods

> **What this phase is.** The fourth phase of `docs/v1.3/SPEC.md`'s headless-git chapter: the
> phase that first makes this backend read *file content*. Everything before it read history —
> shas, parents, identities, subjects, decorations. G4 reads trees, blobs and patches, and it is
> the phase that gives `gitclient/catfile` (built in G3 with no caller, D11) its first production
> consumer. It covers upstream's P5 (Commit detail) in full, plus SPEC's G4 row's second half:
> "the seven host-capability methods wired client-side".
>
> **In one line: `gitclient/porcelain` grows the three parsers a commit detail is made of
> (`diff-tree --numstat`/`--name-status`, the unified-diff patch, and `show`'s
> metadata/body/trailer/signature format), `gitsession.RepoEntry` grows the queries and the two
> caches SPEC §6 puts in the shared box, `gitrpc` serves `commit.detail`/`commit.fileDiff` plus
> two new server-only reads (`file.read`, `file.goToTarget`), and the extension stops forwarding
> `clipboard.write`/`editor.openDiff`/`editor.goToFile`/`editor.resolveConflict` and answers them
> from its own already-migrated ports — so the detail pane, the file tree, the in-app diff, "Open
> in editor", the line-mapped "Go to file" and every copy action work end to end.**
>
> **The SPEC is authoritative and is not re-litigated here.** The JSON-control-plane/FlatBuffers-
> data-plane split, the `Registry`/`RepoEntry`/`Conn`/`Walk` shared-vs-private rule, the package
> layout, `packages/git-ui` staying unchanged, and the phasing table are settled in
> `docs/v1.3/SPEC.md` §2, §4.2, §5 and §6. This plan is the *how*: the exact argv, the exact
> parsers, the exact wire shapes, the exact size rules, the exact commit sequence, and the exact
> proof.
>
> **Four places where a literal reading of the SPEC (or of what G3 left behind) collides with what
> actually works are called out and resolved with evidence** — a bulk payload that SPEC §4.2 would
> put in FlatBuffers and that measurably should not be (F9/D1), a response frame that can be
> silently dropped exactly the way G3 fixed chunks from being (F8/D2), a seventh host-capability
> method that cannot be wired in this phase without stubbing it (F3/D11), and a golden corpus that
> is reproducible only on the machine that generated it (F13/D15).
>
> **Two of those want a human eye before implementation starts — §11.**

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`24dd37db`, the whole
of G1, G2 and G3). Every claim below was checked against source read or commands run in this
container, never against prose — including G1/G2/G3's own plans, which are records of intent and
are verified against the code they produced.

| Claim | Evidence |
|---|---|
| G3 landed in full: parsers, catfile, log session, store, `"KIG1"` wire, `Walk`, four `graph.*` methods, the registered graph webview | `git log --oneline`: `099cfa70`…`24dd37db`; `internal/gitclient/{porcelain,catfile,logsession}/`, `internal/gitstore/`, `internal/gitwire/`, `gitsession/walk.go`, `gitrpc/graph.go`, `extension.ts:80` `registerWebviewViewProvider(GRAPH_VIEW_ID, …)` |
| The whole webview half of upstream's P5 is already in this repo and is off limits | `packages/git-ui/src/components/{DetailPane,CommitMeta,FileTree,DiffView}.vue`, `components/fileTreeModel.ts`, `state/{detail,detailActions,clipboardActions}.ts`; SPEC §5: `packages/git-ui` "**Unchanged.**" |
| The webview issues exactly three host-capability requests, and gates two of them on `capabilities` | `state/detailActions.ts:63` `editor.openDiff`, `:74` `editor.goToFile`, `state/clipboardActions.ts:26` `clipboard.write`; `DetailActions.capabilities` is `ResultOf<'app.init'>['capabilities']` |
| The webview computes the diff-line → revision-line mapping itself and sends the result | `components/DiffView.vue:13` imports `mapDiffLineToRevision` from `@kira/git-core`; `:168` `const line = mapDiffLineToRevision(body.hunks, focusedRow.value, side)` |
| `commit.detail`, `commit.fileDiff`, `editor.openDiff`, `editor.goToFile`, `clipboard.write`, `editor.resolveConflict` and every P5 wire type are **already** in the contract, both sides | `packages/git-ipc/src/contract.ts:79-151` (`CommitTrailer`/`FileChange`/`DiffLine`/`DiffHunk`/`FileDiffBody`/`GoToFileOutcome`), `:928-995`, `:1063`; `validate.ts:68-72`, `:80` |
| The contract has **no** way to read a blob and no way to resolve a "go to file" target | full request-key list, `contract.ts:848-1104` — no `blob.*`, no `file.*` |
| Every port G4 needs is migrated, complete and unconstructed | `apps/kira-studio-vscode/src/ports/clipboard.ts` (12 lines), `ports/editorIntegration.ts` (101 lines: `registerVirtualDocuments`, `openDiff`, `reveal`, `resolveConflict`, `capabilities` all `true`); `extension.ts:59-61` constructs only `logger`/`dialogs`/`roots` |
| `proxyHandlers` answers three methods locally and forwards the rest, reporting all four capabilities `false` | `proxyHandlers.ts:45-73` (`app.init`/`repo.list`/`repo.pick`), `:56-61`, `:90-94`/`:102` (`commit.*`/`editor.*`/`clipboard.write` all `forward(...)`) |
| `catfile` is built, tested, and has no production caller; it already carries P5's `missing`-by-suffix fix | `catfile/session.go:1-7`'s own doc ("its first production caller is G4's"); `catfile/batch.go:29-37` recognises ` missing` by suffix, not by field count |
| `catfile` has no fallback for a path containing a newline | `session.go:163`/`:192` — every request is `rev+"\n"`, and `cat-file --batch` reads one request per line |
| `porcelain` has the log walk's parsers and nothing else — including **no** `ShowMetadataArgs`, which G3's own file table named | `porcelain/log.go` exports `LogFormat`, `FieldCount`, `RevSetArgs`, `WalkArgs`, `LogSessionArgs`, `LogSessionSkipArgs`, `ParseLogRecord` and nothing else; `grep -rn "ShowMetadata" apps/kira-studio/internal/` → no match. G3 D8: "Not ported: `parse/status.ts`, `parse/diff.ts`, `parse/diffTree.ts` … Each lands with the RPC that reads it" |
| `RepoEntry` owns the cat-file session and no caches | `gitsession/entry.go:33-46` — `Summary`, `Repo`, `watcher`, `subs`, `catfile`, `done`; `:28-32`'s own comment defers "the caches … G3-G9" |
| `Conn` exposes no accessor for the `RepoEntry` it holds | `conn.go:91-99` — `alreadyHeld` is unexported; the exported surface is `Open`/`CloseRepo`/`Close`/`Walk`/`WalkFor` |
| An oversize **response** frame is silently dropped and the request never settles | `rpcstream/session.go:95-104` — `send` calls `encodeBody` and queues without consulting `MaxFrameBytes` (only `sendChunk`, `:109-124`, does); `:83-93` `writeLoop` discards `Send`'s error; `gitsock/frame.go:32-34` returns `errFrameTooLarge` for a body over 8 MiB |
| `socketChannel.ts`'s blob substitution is frame-generic, not chunk-specific | `socketChannel.ts:75-100` — `substituteBlobRoot` walks whatever JSON the frame carried; nothing keys on `t === 'chunk'` |
| `ServerHandlers.requests` is total over `RequestKey`, and the client never validates an outgoing method name | `rpc.ts:369-372` (`{ readonly [K in RequestKey]: RequestHandler<K> }`); `assertContractShape` is called at `rpc.ts:387`/`:418`/`:196` — server-side and on event arrival only |
| `--no-optional-locks` is already applied at git level, ahead of the subcommand | `gitclient/runner.go:117-126` `buildArgv` — `configOverrides`, `--no-pager`, then `--no-optional-locks` for `ReadOnly`, then the caller's subcommand |
| `color.ui=false`, `core.quotepath=false`, `i18n.logOutputEncoding=UTF-8` are already forced on every spawn | `runner.go:76-81` |
| A repo's read pool is 4 | `gitclient/repo.go:37` `maxConcurrentReads = 4` |
| `RepoID` is the worktree root for a non-bare repo and the git dir for a bare one | `repo.go:188-198` (G3 D7) |
| `repo.open`'s result carries `root`, and the extension keeps no map of it | `gitrpc/wire.go:30-35` `RepoOpenResult{Repo *gitclient.RepoSummary}`; `proxyHandlers.ts:74` is a bare `forward('repo.open')` |
| `mapLineAcrossDiff` and `splitTrailerBlock` exist in `@kira/git-core`, are exported, and have no caller in this repo | `packages/git-core/src/model/diff.ts:150`/`:190`, `index.ts:60-61`; `grep -rn` across `packages/git-ui/src` finds only `flattenDiffRows`/`mapDiffLineToRevision` |
| `git-ipc`'s tests run inside `test:unit`, and `build:vscode` bundles | `package.json:35` (G3 D20), `:24` |
| git here is 2.43.0; `go build ./apps/kira-studio/internal/...` and `go test ./apps/kira-studio/internal/gitclient/porcelain/...` are green | run here |

**Probes, re-run in this container against real git 2.43** (upstream's P5 recorded these against its
own tree; every one reproduces here, so the plan below rests on observation, not on citation):

| # | Behaviour | What was observed here |
|---|---|---|
| **P1** | `diff-tree --numstat -M -C -z` frames a rename as one stat record with an **empty** third field followed by two path records | `- \t - \t bin.dat \0` then `1 \t 1 \t \0 old.txt \0 new.txt \0` — the true `+1 −1`, not the `+10 −10` a `-M`-less numstat reports |
| | `--name-status -M -C -z` | `M \0 bin.dat \0 R077 \0 old.txt \0 new.txt \0` |
| **P2** | A pathspec filters **before** rename detection | `diff-tree … <par> <sha> -- new.txt` → `new file mode` + `--- /dev/null` + 10 added lines; `-- old.txt new.txt` → `similarity index 77%` / `rename from`/`rename to` / `@@ -2,7 +2,7 @@` |
| **P3** | `cat-file --batch-check` on `<rev>:<path>` with a space | `HEAD:my file.txt` → `<oid> blob 2`; `HEAD:nope me.txt` → `HEAD:nope me.txt missing` (already handled, `batch.go:35`) |
| **P4** | A binary file's patch | `diff --git`, `index 57ac8df..7294671 100644`, `Binary files a/bin.dat and b/bin.dat differ`, no hunks |
| **P6** | `git diff <rev> -- <path>` sees the working tree, uncommitted edits included | an uncommitted `+X0` at the top appears in `@@ -1,3 +1,4 @@` |
| | `git diff --no-optional-locks …` (flag after the subcommand) | **exit 129** — the flag is git-level only, and `buildArgv` already places it correctly |
| | a **never-tracked** path | `git diff <rev> -- untracked.txt` → **zero bytes** (upstream's own `+++ /dev/null` case is the *un-indexed-but-on-disk* one; both mean "do not re-map") |
| **P5** | `%G?` under this container's `commit.gpgsign=true`/`gpg.format=ssh` global config | writes `error: gpg.ssh.allowedSignersFile needs to be configured…` to **stderr** and still exits 0 with `N` — classification is by exit code, so it is harmless |
| | `show -s -z --format='%G?%x1f%GS%x1f%(trailers…)%x1f%b'` | one record, trailing `\0`, body last and still containing the trailer paragraph |

**Upstream baseline** (`/home/user/vlad-cirstean/kira-version-vscode`, `claude/start-p2-gwlgly`,
`0ea4cfe`), read as the source this phase ports:

| Claim | Evidence |
|---|---|
| P5's own design is `docs/plans/P5.md`: the two maps, the file tree, the diff view, "Go to file"'s decision procedure, the two caches, the three caps | `docs/plans/P5.md` in full |
| `commitDetail` is four spawns: metadata `show`, body/signature `show`, `numstat`, `name-status` | `packages/git/src/queries.ts:501-529` — metadata awaited first (the parent sha it yields is `from`), the other three in one `Promise.all` |
| The metadata `show` reuses the log walk's own format and parser | `queries.ts:508-510`; `parse/log.ts:110-112` `showMetadataArgs` = `["show","-s","--decorate=full","-z","--format="+LOG_FORMAT, sha]` |
| Body/signature is a **separate** minimal `show`, body last | `queries.ts:411-421` — `%G?%x1f%GS%x1f%(trailers:only=true,unfold=true)%x1f%b`, "a stray 0x1f inside a commit message can then only ever corrupt the body" |
| git parses trailers for us; `%b` still contains them, so the body is split client of git | `queries.ts:426-436` `parseTrailerBlock`; `core/src/model/diff.ts:190` `splitTrailerBlock` |
| The two `diff-tree` runs are joined on the new path alone, both with `-M -C` | `queries.ts:473-489` `combineFileChanges` |
| The per-file patch is `diff-tree`, not `git diff` — `--root` handles a root commit, and an explicit parent pair is what the merge selector needs | `parse/diff.ts:58-88` `fileDiffArgs` |
| The drift re-map is `git diff <rev> -- <path>` with `--no-renames` | `parse/diff.ts:90-110` `worktreeDiffArgs` |
| `worktreeDiff` returns `null` (do not re-map) for no output, no post-image, over-cap, or a failed spawn | `repoService.ts:1364-1382` |
| `blob` is `cat-file` on `<rev>:<path>`, with a NUL-in-first-8-KB binary sniff and a one-shot `git show` fallback for a newline path | `repoService.ts:1316-1351`, `:270-293` |
| The caps: 1 MB per patch, 4 MB diff LRU by bytes, 64 detail entries, 10 MB blob gate | `repoService.ts:276-285` |
| "Go to file" is one decision: does `<root>/<path>` exist on disk — live file (re-mapped across drift) if yes, historical blob if no, and it never consults HEAD, the index, or reachability | `docs/plans/P5.md`'s D14a; `rpcHandlers.ts:370-392` |
| The host answers `app.init`'s capabilities, `repo.list`, `repo.pick`, `editor.openDiff`, `editor.goToFile`, `clipboard.write`, `editor.resolveConflict` and `review.open` from its own ports | `rpcHandlers.ts:262-275`, `:354`, `:375`, `:389`, `:396`, `:509`, `:524-526` |

### 0.2 Scope

1. `internal/gitclient/porcelain` — `diff-tree --numstat`/`--name-status` (D5), the unified-diff
   patch parser and its two argv builders (D5), and `show`'s metadata/body/trailer/signature
   format plus `SplitTrailerBlock` (D5, D9).
2. `internal/gitsession` — the five queries and two caches SPEC §6 puts on the shared `RepoEntry`
   (D6, D7, D8), plus a `Conn` accessor for the entry a connection holds (D18).
3. `internal/gitclient/catfile` — the one-shot `git show` fallback for a path containing a newline
   (D10). Nothing else in the package changes.
4. `internal/bridge/rpcstream` — the response path's own frame-cap guard, the twin of the one G3's
   D5 gave chunks (D2).
5. `internal/gitrpc` — `commit.detail`, `commit.fileDiff`, and the two new server-only reads
   `file.read`/`file.goToTarget` (D3); `CONTRACT_VERSION` 13 → 14.
6. `packages/git-ipc` — two request keys, `CONTRACT_VERSION`, and `validate.ts`'s key map (D3).
7. `apps/kira-studio-vscode` — four host-capability methods answered locally over the already
   migrated ports, the virtual-document source, the `repoId → root` map, and `app.init`'s four
   capabilities flipped to `true` (D11–D14).
8. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G4 work:

- **`review.open`** — the seventh host-capability method. It reveals the *review* webview view,
  which is not registered until G6; answering it before that view exists is a stub, which
  `AGENTS.md` forbids. D11 states this in full.
- **Any parser G4's own four methods do not read.** No `status --porcelain=v2`, no `stash list`,
  no `merge-tree`, no full `for-each-ref`. Each still lands with its consumer (G5/G8).
- **`refs.list`, `status.get`, `undo.peek`, `stash.list`.** Still rejecting on every repo open
  (G3 F16/D17). G4 closes exactly one of the five rejections that phase documented —
  `commit.detail` on row selection — and says so out loud in §7.2.
- **The file tree's own folding.** `packages/git-ui/src/components/fileTreeModel.ts` already does
  it, client-side, and may not be touched (D17). The server produces a flat `FileChange` list.
- **The diff-line → revision-line map.** `mapDiffLineToRevision` runs in the webview
  (`DiffView.vue:168`) and is not ported to Go. Only the *drift* re-map is G4's, and D4 keeps that
  in TypeScript too.
- **The ranged/review walk, `review.resolveBase`, the review view.** G6.
- **Search.** G10, and with it the RE2-vs-`RegExp` question, untouched here.
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule: a chapter spec is not
  retro-edited by a phase. Everything this plan settles that the SPEC left open is settled *here*.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out of this phase is left out *entirely*.
- **Comments very concise, only where the code cannot say it itself.**
- **Tests only where `AGENTS.md`'s bar is met.** G4 clears it in five places and nowhere else
  (D16): the two `diff-tree` record parsers' non-uniform framing, the unified-diff hunk state
  machine and its counts invariant, `SplitTrailerBlock`'s paragraph rule, the two caches' eviction
  and invalidation, and the `file.goToTarget` decision procedure (as an integration test against
  real git, which is the only thing that can prove it).
- **Reach for a library before hand-rolling.** Nothing here is a library's job: every new file is
  a parser for one specific `git` output format, which is `AGENTS.md`'s own named exception.
- **Fixture repositories scope their git config to themselves.** `git -C <tmpdir> config` /
  `--local` / per-spawn `-c` / env only — **never `git config --global`**, which a prior phase's
  implementation agent leaked into real commits. D15 makes this concrete and, as it happens,
  fixes a real reproducibility bug (F13) with the same change.
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§6).

---

## 1. Findings

### F1 — The whole webview half of this phase is already in the tree, and G4 may not touch it

Upstream's P5 was mostly a UI phase: `DetailPane.vue`, `CommitMeta.vue`, `FileTree.vue`,
`DiffView.vue`, `fileTreeModel.ts`, `state/detail.ts`, `state/detailActions.ts`,
`state/clipboardActions.ts`, the `Esc` chain, the keyboard model, the render cap. Every one of
those files is already in `packages/git-ui`, migrated whole by G1, and SPEC §5 makes them
untouchable.

So G4 is not a port of P5. It is a port of **P5's lower half**: the git queries, the parsers, the
caches, and the host ports — plus the one thing upstream never had to solve, which is that the
host half and the git half now live in two processes.

The practical consequence, and the thing to check every deliverable against: *the webview already
knows exactly what it wants; G4's only job is to make what it asks for arrive.*

### F2 — The contract already declares everything P5 sends, and nothing G4 needs to fetch

`contract.ts:79-151` declares `CommitTrailer`, `FileChangeKind`, `FileChange`, `SignatureStatus`,
`DiffLineKind`, `DiffLine`, `DiffHunk`, `FileDiffBody` and `GoToFileOutcome`; `:928-995` declares
`commit.detail`, `commit.fileDiff`, `editor.openDiff`, `editor.goToFile` and `clipboard.write`;
`:1063` declares `editor.resolveConflict`. `validate.ts`'s `REQUEST_KEY_MAP` admits all of them.
**No wire type and no webview-facing method is designed by this phase.**

But the contract is upstream's, and upstream's `editor.*` handlers ran *in the same process as the
git service*. Here they do not. The extension can call `vscode.diff` and `showTextDocument`; it
cannot read a blob out of the object database, run `git diff <rev> -- <path>`, or know whether a
path exists in a repository it has never opened. Three of those are exactly what upstream's
handlers call `deps.service.*` for (`rpcHandlers.ts:332`, `:373`, `:379`), and there is no contract
entry for any of them, because upstream never needed one.

That is the gap G4 has to close, and it is the only genuinely new wire design in the phase.

### F3 — The seven host-capability methods, enumerated exactly — and the seventh cannot be wired here

SPEC §5 item 2 says "Seven previously-server-answered methods (folder pickers, diff-open,
clipboard, 'open externally', and similar host-capability calls) are now answered **locally** by
the extension's own ports". It never lists them. Upstream's `rpcHandlers.ts` does, by which
`deps.*` each handler reaches for — and there are exactly seven that touch a host port rather than
`deps.service`:

| # | Method | Upstream's own answer | State in this repo |
|---|---|---|---|
| 1 | `repo.list` | `deps.roots.list()` (`:270`) | **wired**, G3 D18 (`proxyHandlers.ts:64`) |
| 2 | `repo.pick` | `deps.dialogs.pickFolder(…)` (`:275`) | **wired**, G3 D18 (`:70`) |
| 3 | `clipboard.write` | `deps.clipboard.writeText` (`:396`) | forwarded to a server that answers `E_UNKNOWN_METHOD` (`:94`) |
| 4 | `editor.openDiff` | `deps.editor.openDiff` (`:354`) | forwarded (`:92`) |
| 5 | `editor.goToFile` | `deps.editor.reveal` (`:375`, `:389`) | forwarded (`:93`) |
| 6 | `editor.resolveConflict` | `deps.editor.resolveConflict` (`:509`) | forwarded (`:102`) |
| 7 | `review.open` | `deps.revealReview?.(…)` (`:524-526`) | forwarded (`:104`) |

(`app.init` is *not* one of the seven — SPEC §5 item 3 gives it its own line, and G3 already
composes it.)

Numbers 3–6 are G4's, and all four have their VS Code implementation sitting finished and
unconstructed in `apps/kira-studio-vscode/src/ports/` (F4). Number 7 is not G4's and cannot be:
`revealReview` reveals the *review* sidebar view, which G3 deliberately left unregistered ("the
review webview view. Migrated, still unregistered. G6.") and which G6 owns. Wiring `review.open` to
a view that does not exist means either a silent no-op or a `revealReview?.` that is always
`undefined` — a stub either way.

### F4 — Every port G4 needs is migrated, complete, and has never been constructed

`ports/clipboard.ts` is 12 lines over `vscode.env.clipboard.writeText`, with a rejection that
propagates rather than being swallowed. `ports/editorIntegration.ts` is 101 lines and already
implements all four of `capabilities` (`{openInEditor: true, goToFile: true, resolveConflict:
true}`), `registerVirtualDocuments` (the `kira-version:` scheme, the opaque-key-then-real-basename
URI shape, no `onDidChange` because a `<rev>:<path>` blob is immutable), `openDiff`, `reveal` (with
a `Selection` on the mapped line) and `resolveConflict` (`workbench.view.scm` then `vscode.open`).

`extension.ts:59-61` constructs `logger`, `dialogs` and `roots` — and nothing else.

So the extension-side work in G4 is *composition*, not implementation: construct two more ports,
register the virtual-document provider once, and write four handler bodies whose VS Code half is
already written and whose git half is a request over the socket.

### F5 — `catfile` is G4's, exactly as G3 promised, and it is one fix short of complete

`catfile/session.go:1-7` says so in its own package doc. It is built, tested against real git, and
carries P5's own `missing`-by-suffix fix already (`batch.go:29-37`) — the fix upstream discovered
because P5 was the first phase to pass a `<rev>:<path>` string with a space in it.

What it does not carry is the second half of the same discovery (`docs/plans/P5.md`, "The
`cat-file` header bug"): `cat-file --batch` reads **one request per line**, so a path containing a
newline (legal in git) cannot be expressed in the batch protocol at all, and `-z` batch input needs
git 2.42 — above this chapter's 2.38 floor, but not guaranteed by it. Every `Session.Check`/`Read`
here writes `rev+"\n"` (`session.go:163`, `:192`).

G4 is the first phase that can hand it a path at all, so this is G4's to answer (D10).

### F6 — `porcelain` is missing three parsers *and* one argv builder G3's own plan listed

G3 D8 is explicit about the first part: `parse/diff.ts`, `parse/diffTree.ts` and the rest are "not
ported … Each lands with the RPC that reads it (G4/G5/G8)". Correct, and G4 is that RPC.

The second part is smaller and easier to miss: G3's §3.1 file table lists `ShowMetadataArgs` among
`log.go`'s contents, and the shipped `log.go` does not have it (`grep -rn "ShowMetadata"` finds
nothing in `apps/kira-studio/internal/`). That is the right call under `AGENTS.md` — it had no
caller in G3 — but it means `commit.detail`'s very first spawn is an argv builder that does not
exist yet. It is three lines, it belongs beside `LogFormat` (whose format string it reuses
verbatim), and this plan names it so it is not rediscovered as a surprise.

### F7 — `RepoEntry` has the cat-file session and nothing else; `Conn` cannot hand a handler an entry

`entry.go:33-46` is `Summary`, `Repo`, `watcher`, `subs`, `catfile`, `done`. `:28-32`'s own comment
defers "the caches, cat-file session, head, stash shapes, undo slot and active remote op SPEC §6
also lists" to "G3-G9", and G3 delivered only the cat-file session.

`conn.go`'s exported surface is `Open`, `CloseRepo`, `Close`, `Walk`, `WalkFor`. `alreadyHeld` —
the one function that maps a `RepoID` to the `*RepoEntry` this connection holds — is unexported. So
today there is no way for a `gitrpc` handler to reach the repository at all except through a
`Walk`, which is the wrong object for every method in this phase (a walk is per-viewer paging
state; a commit's detail is a fact about the repository).

### F8 — An oversize *response* is silently dropped and hangs the request — G3 fixed only the chunk half

G3's F21 found this for chunks and D5 fixed it there: `emit` refuses a body over
`Handlers.MaxFrameBytes` with `E_FRAME_TOO_LARGE` rather than queueing a frame `writeFrame` will
refuse. The response path never got the same treatment:

- `session.go:95-104` — `send` calls `encodeBody` and pushes to `sendCh` with no size check at all.
- `session.go:83-93` — `writeLoop` does `_ = s.conn.Send(b)`, on the stated assumption that a write
  failure means the connection is going away.
- `gitsock/frame.go:32-34` — `writeFrame` returns `errFrameTooLarge` for a body over 8 MiB. The
  connection is perfectly healthy; one `res` frame has simply vanished.

The client is then waiting on a response that will never arrive, with no error and no timeout. In
G1–G3 no response could plausibly reach 8 MiB (the largest is a `RepoSummary`). In G4 two of them
can: a commit whose patch or file list is large (F9).

### F9 — A JSON diff is small in practice and unbounded in principle, and the arithmetic decides the wire format

SPEC §4.2 names "diff hunks, blob bytes" as bulk payloads that cross as FlatBuffers. The numbers
say otherwise for this phase, and they are worth writing down rather than asserting either way.

One `DiffLine` on the wire is `{"kind":"add","text":"…","oldLine":null,"newLine":123,
"noNewlineAtEof":false}` — about **60 bytes of envelope** plus the line's own text. So:

- A *typical* patch line is ~40 bytes of text ⇒ ~100 bytes of JSON ⇒ a 1 MiB patch (upstream's cap,
  `repoService.ts:285`) encodes to roughly **2.5 MiB**. Comfortably inside the 8 MiB frame.
- A *pathological* patch — a column of two-byte lines, e.g. a generated table of digits — is
  ~333k lines per MiB ⇒ ~**21 MiB** of JSON. Well outside it.

The same shape applies to `commit.detail`: a `FileChange` is ~120 bytes, so a commit touching
~70k files (a monorepo's initial import, a vendored-dependency drop) reaches the cap too.

Two facts about the receiver matter as much as the size. First, the consumer of these bytes is a
Vue component rendering rows one at a time (`DiffView.vue`, `FileTree.vue`) — there is no typed
array to reconstruct and no `appendPacked` equivalent, which is what made FlatBuffers pay for
itself for commit chunks (G3 D12/F12). Second, `commit.fileDiff` fires **once per user action**,
not continuously while scrolling.

And one fact about what already exists: `socketChannel.ts`'s blob substitution is frame-generic
(`socketChannel.ts:75-100` walks whatever JSON the frame carried and never inspects `t`), so a
blob-carrying **response** would already decode on the TypeScript side today, with zero changes.
Only the Go half is missing.

### F10 — The line map the drift re-map needs already exists, in TypeScript, tested, unused

`packages/git-core/src/model/diff.ts` exports `flattenDiffRows`, `mapDiffLineToRevision`,
`mapLineAcrossDiff` and `splitTrailerBlock`, with `diff.test.ts` beside it. `DiffView.vue` uses the
first two. `mapLineAcrossDiff` and `splitTrailerBlock` have **no caller anywhere in this repo**.

`mapLineAcrossDiff` is the drift re-map's whole arithmetic (upstream's "second map"), and
`splitTrailerBlock` is what removes the trailer paragraph from `%b`. One of them is needed on the
side of the wire that already has it; the other is needed on the side that does not (D4, D9).

### F11 — The extension cannot safely join a path against a `repoId`, though upstream does

Upstream writes `join(repoId, path)` twice (`rpcHandlers.ts:375`, `:509`) because its `repoId` *is*
the worktree root. In this repo, since G3's D7, `RepoID` is the worktree root **only for a non-bare
repository**; for a bare one it is the git dir. `join(gitDir, "config")` resolves to a real file
that is not the file anyone asked for.

A bare repository has no checkout, so both call sites are unreachable in practice — but "correct by
an accident of which repositories exist" is exactly the kind of thing this plan should name rather
than inherit. `repo.open`'s result already carries the real `root` (`gitrpc/wire.go:30-35`); the
extension currently forwards that result without looking at it (`proxyHandlers.ts:74`).

### F12 — A server-only method still has to be a contract key, and costs one forwarder

`ServerHandlers.requests` is `{ readonly [K in RequestKey]: RequestHandler<K> }` (`rpc.ts:369-372`)
— total, so every key needs a handler in `proxyHandlers`. `ConnectionManager.request` is generic
over `RequestKey` (`connection.ts:126`), so a method name outside the contract does not type-check
at the call site the extension would use.

Meanwhile `assertContractShape` is only called by `createRpcServer` and on event arrival
(`rpc.ts:387`, `:418`, `:196`) — never on an outgoing request — so the *runtime* does not police
the extension→server direction at all; only the types do.

So a method that only the extension ever issues is still cheapest as a contract key plus a
one-line forwarder, rather than as a second, untyped request surface on `ConnectionManager`.

### F13 — The golden corpus is reproducible only on the machine that generated it

G3 D15 says the fixtures are "byte-identical run to run (fixed identity, fixed
`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, fixed tree content ⇒ deterministic object ids)". Run here,
`KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the tree clean — so on this machine that
is true.

It is true for a reason the plan did not account for. This container's **global** git config has
`commit.gpgsign=true`, `gpg.format=ssh` and an ed25519 signing key
(`git config --global --list`), and `fixtures_test.go`'s builder spawns `exec.Command("git", …)`
with `os.Environ()` and no config isolation — so every fixture commit is **signed**. Ed25519
signatures are deterministic, so the same key over the same content yields the same signature and
therefore the same commit sha, run after run, on this machine.

Verified directly:

```
$ GIT_CONFIG_GLOBAL=/dev/null KIRA_GIT_FIXTURES=write go test ./…/gitclient/porcelain/...
FAIL
$ git status --short
 M …/testdata/handAuthored/crlfSubject.bin        (and all seven others)
```

All eight committed fixtures are rewritten, and the test fails. A regeneration on macOS — with a
different signing key, or with signing off — produces a different corpus. G4 adds fixtures of its
own, so it inherits the problem; the fix is one line in the builder and it is the same line that
makes the "never touch global git config" rule structurally true rather than merely intended (D15).

### F14 — `commit.detail` is four spawns into a four-slot read pool

`queries.ts:501-529`: the metadata `show` is awaited first (its parent sha is what the two
`diff-tree` invocations diff *from*), then the body/signature `show` and the two `diff-tree` runs
go out together in one `Promise.all`. Upstream spawns all four outside any pool.

Here, `maxConcurrentReads = 4` (`repo.go:37`) and `Repo.Read` is a real gate. A naive transcription
that fires three concurrent reads means one detail request can hold three quarters of a
repository's read concurrency — noticeable under keyboard navigation, where the webview fires a
detail request per row (`state/detail.ts`'s own abort-on-supersede logic exists for exactly that).

### F15 — Cancellation already works end to end, provided the handler threads its context

`state/detail.ts:143`/`:177` requests through the webview's `BridgeClient` with an
`AbortController`; `rpc.ts` turns an abort into a `cancel` frame; `proxyHandlers`' `forward` passes
`ctx.signal` into `connection.request`; `rpcstream.handleRequest` (`session.go:153-160`) builds a
per-request context and registers its cancel in `activeWork`, which the `cancel` frame reaches.

So a superseded `commit.detail`'s git processes really do die — **if** the handler passes its `ctx`
into every spawn. That is upstream's own `signal` discipline (`CommitDetailOptions.signal`:
"a superseded request's processes must actually die, not merely have their result discarded"),
and here it costs nothing but remembering to do it.

### F16 — `gitsock` already has the harness this phase's end-to-end proof needs

`graphstream_test.go` builds a real fixture repository, pairs a client over a real socket, opens a
real repo and drives real requests (`newIntegrationServer`, `initFixtureRepoWithCommits`,
`pairAndReady`, `openRepoOK`, `client.openStream`, `client.readStreamFrame`). Its fixture builder
passes identity through the spawn's own env (`GIT_AUTHOR_NAME=Test`, …) rather than through any
config file — the pattern D15 generalises.

So G4's own integration tests are a new file in the same package, not a new harness.

---

## 2. Decisions

### D1 — Diff hunks, file lists and blob content cross as **JSON**; `gitwire`'s `Payload` union gains no member

Resolving F9. This is the phase's wire-format call, and it is a departure from a literal reading of
SPEC §4.2 ("Bulk response/stream payloads are FlatBuffers — commit chunks, **diff hunks, blob
bytes**"), so it is argued rather than asserted.

**What FlatBuffers bought for commit chunks, and does not buy here.** G3's chunk encoding exists
because of three properties, and a per-file diff has none of them:

1. *A typed-array receiver.* `appendPacked` reconstructs `Uint32Array`s straight from the wire
   bytes (G3 F12), so the format on the wire is the format in memory. A `DiffHunk[]` is consumed by
   `flattenDiffRows` and rendered row by row; there is no column, no typed array, and no
   allocation the encoding could avoid.
2. *Continuous streaming.* A graph stream emits chunk after chunk while the user scrolls, 500 rows
   at a time, for as long as the history lasts. `commit.fileDiff` fires once per file the user
   clicks, at human speed.
3. *A schema the receiver already had.* `PackedCommitChunk` was upstream's own type, and its
   FlatBuffers schema was a transcription of a shape both sides already agreed on. `DiffHunk`,
   `DiffLine` and `FileDiffBody` are declared in `contract.ts` as ordinary TypeScript, are read
   directly by `DiffView.vue`, and would need a *second* representation plus a codec plus a
   conformance test to cross any other way — in a package (`packages/git-ui`) that may not change
   to receive it.

**What it would cost.** Four new schema tables and a union member, a Go encoder, a TypeScript
decoder, an entry in `codec.ts`'s `StreamKey`-keyed encode/decode (which is keyed on *streams*, and
none of G4's methods is one), and a cross-language fixture to keep them honest (G3 D16's own
lesson). All of that so a payload that is ~2.5 MiB in its pathological case and a few kilobytes in
the normal one can be a bit smaller.

**Decision**: `commit.detail`, `commit.fileDiff` and `file.read` return plain JSON, structurally
identical to `contract.ts`'s existing declarations. `packages/git-ipc/schema/gitwire.fbs`,
`internal/gitwire` and `graphChunkCodec.ts` are **not touched by this phase**. G3 D1's `Frame`/
`Payload` union stays a one-member union, and G3's own hand-forward ("**G4** adds diff-hunk and
blob-bytes members") is answered: it does not, and this is why.

**Rejected — an out-of-band blob response.** Genuinely cheaper than it looks: `socketChannel.ts`
already substitutes a `$blob` marker in *any* frame (F9), so the TypeScript half exists. The Go
half is a widened `Handlers.Request` returning `(any, []byte, error)` threaded through `gitrpc`,
`gitsock` and their tests. It was rejected because the only payload that would use it —
`file.read`'s content — has to become a JavaScript **string** for
`provideTextDocumentContent` anyway, so the bytes would be decoded on arrival regardless, and
because a `[]byte`-through-JSON round trip and a `TextDecoder` round trip produce the same result
for the same input (both replace invalid UTF-8 with U+FFFD). What it would buy is a smaller frame
for a payload that is already bounded by D2. Recorded here so a later phase that *does* need binary
in a response (G14's stored blob snapshots are the plausible one) knows the client half is already
built and only the Go half is missing.

### D2 — Two size rules, one of them a transport fix

Resolving F8 and F9. Both layers are stated because each is wrong on its own.

**(a) Transport — an oversize response is refused, never dropped.** `rpcstream.handleRequest` gains
the guard `sendChunk` already has: if the encoded `res` body exceeds `Handlers.MaxFrameBytes`, the
response sent is an *error* `res` carrying `E_FRAME_TOO_LARGE` instead of the result. One frame
either way; the client always settles. This is G3 D5's own fix applied to the path G3 did not need
it on, with `gitsock` still the single owner of the number (`server.go:195` already passes
`MaxFrameBytes: maxFrameBytes`).

**(b) Domain — the two methods that can produce a big result cap themselves, in their own
vocabulary.** Falling back on (a) would mean the pane shows a transport error where the UI already
has a designed, honest answer for "too big":

| Method | Cap | Answer when exceeded |
|---|---|---|
| `commit.fileDiff` | `MaxPatchBytes = 1 MiB` of raw patch (upstream's own, `repoService.ts:285`) | `{kind:"tooLarge", bytes, limitBytes}` — `DiffView.vue` renders "File too large to display" |
| `commit.fileDiff` | `MaxResultBytes = 6 MiB` of *encoded* result | the same `tooLarge` body, `bytes` still the real patch size |
| `file.read` | `catfile.DefaultMaxBlobBytes = 10 MiB` raw (existing gate, `--batch-check` decides before any content is read) | `{kind:"tooLarge", bytes, limitBytes}` → the UI's `unavailable / tooLarge` |
| `file.read` | `MaxResultBytes = 6 MiB` of encoded result | the same, with `limitBytes` reporting whichever limit fired |

The encoded check is **exact, not estimated**: these two handlers marshal their own result body once
and return it as a `json.RawMessage` (which `rpcstream`'s own `json.Marshal` passes through
unchanged), so the size is measured, not guessed, and nothing is encoded twice. Every other handler
returns a plain struct exactly as today.

`commit.detail` deliberately gets **no** domain cap: its result is a file list whose only honest
truncation would be a wire shape the migrated UI cannot read (there is no `truncated` field in
`contract.ts`, and inventing one means redesigning `FileTree.vue`'s input). At ~120 bytes per
`FileChange` the transport guard fires somewhere around 70k files in a single commit, and (a)
makes that a visible `E_FRAME_TOO_LARGE` rather than a hang. §10 hands the question forward.

`MaxResultBytes = 6 MiB` is chosen as "comfortably under the 8 MiB frame cap, and far above
anything a 1 MiB patch produces in practice" (F9: ~2.5 MiB worst realistic case), not measured —
there is no decision it would change.

### D3 — Two new **server-only** contract methods, `file.read` and `file.goToTarget`; `CONTRACT_VERSION` 13 → 14

Resolving F2 and F12. These are the only wire additions in the phase.

```ts
/** The blob at `<rev>:<path>`, for the extension's own virtual-document provider (G4 D14) —
 *  never called by the webview, which has no use for file content it does not render itself.
 *  Text only: a binary blob is refused rather than encoded, because the only consumer is a
 *  read-only text document. */
'file.read': {
  params: { repoId: string; rev: string; path: string };
  result:
    | { readonly kind: 'found'; readonly content: string }
    | { readonly kind: 'missing' }
    | { readonly kind: 'binary' }
    | { readonly kind: 'tooLarge'; readonly bytes: number; readonly limitBytes: number };
};

/** D14a's decision procedure, minus the part only VS Code can do (G4 D4). The extension maps
 *  `line` through `hunks` with `@kira/git-core`'s `mapLineAcrossDiff` and then reveals; it never
 *  asks the filesystem or the object database anything itself. */
'file.goToTarget': {
  params: { repoId: string; rev: string; path: string };
  result:
    | { readonly kind: 'live'; readonly absPath: string;
        /** `null` ⇒ do not re-map: identical file, a path git cannot see, over the patch cap,
         *  or a spawn that failed. A refinement declining to fire is never an error. */
        readonly hunks: readonly DiffHunk[] | null }
    | { readonly kind: 'historical'; readonly rev: string; readonly path: string }
    | { readonly kind: 'unavailable'; readonly reason: 'notInRevision' | 'binary' | 'tooLarge' };
};
```

- **They live in `contract.ts`, in their own clearly-labelled "server-only" section**, because
  `ConnectionManager.request` is typed over `RequestKey` (F12) and a parallel untyped request
  surface for two methods is a second vocabulary and a second validation story for no gain. Each
  gets a `forward(...)` entry in `proxyHandlers` (F12's totality) and a key in
  `validate.ts`'s `REQUEST_KEY_MAP`; the webview never calls either, and both doc comments say so.
- **`file.`, not `blob.` or `commit.`**, because both are "a file at a revision" operations and one
  new prefix is less noise than two — and neither is commit-scoped (`rev` is routinely a *parent*
  sha, from a diff's pre-image side).
- **`CONTRACT_VERSION` 13 → 14**, by hand in the same two files as always
  (`packages/git-ipc/src/validate.ts:7`, `apps/kira-studio/internal/gitrpc/contract.go:11`) — G1
  D20's standing judgment, re-checked here and unchanged. Two request keys added, none removed,
  no existing params or results touched.

### D4 — `file.goToTarget` returns the drift **hunks**, not the final line — the line arithmetic stays in TypeScript

Resolving F10, and the one place this phase deliberately splits upstream's handler down a seam
upstream never had.

Upstream's `editor.goToFile` does everything in one process: `pathExistsInCheckout` → `worktreeDiff`
→ `mapLineAcrossDiff` → `editor.reveal`. Here the first two need git and the fourth needs VS Code,
so the cut has to happen somewhere. It happens between the third and the fourth:

| Step | Where, and why |
|---|---|
| Does `<root>/<path>` exist on disk? | **Server.** It is the side that knows `Root` vs. `GitDir` (F11) and can refuse a path escaping the root; the extension would have to be told the root to ask the question at all. |
| `git diff <rev> -- <path>` | **Server.** It is a git spawn. |
| `mapLineAcrossDiff(hunks, line, 'old')` | **Extension**, over `@kira/git-core`'s existing, tested implementation (F10). |
| `reveal` a file or a virtual document, and the announcement's line number | **Extension.** VS Code. |

**Why not compute the line server-side and return `GoToFileOutcome` whole.** That is the tidier
wire shape and it was rejected on one ground: it means porting `mapLineAcrossDiff` *and*
`mapDiffLineToRevision` (which it delegates to) into Go, where they would sit beside an identical,
already-tested TypeScript implementation that `DiffView.vue` keeps calling for the *other* half of
the same feature — two copies of the trickiest arithmetic in the phase, in two languages, with
nothing forcing them to agree. G3 met the analogous problem with the commit chunk and answered it
with a cross-language fixture (D16); here the problem can simply be avoided, by not having a second
copy.

The cost is one wire field carrying hunks that exist only to be mapped through. It is the same
`DiffHunk` type the contract already declares, it is bounded by D2's patch cap, and `null` — the
common case, for a file nobody has edited since — costs nothing.

### D5 — `porcelain` grows exactly three files, and its parse types carry JSON tags

The package that lands is exactly what G4's four methods read, no more (G3 D8's own rule, applied
again):

| From upstream | To | Notes |
|---|---|---|
| `parse/diffTree.ts`'s `numstatArgs`/`nameStatusArgs`/`parseNumstatRecords`/`parseNameStatusRecords` | `porcelain/difftree.go` | including probe P1's two-path record framing, in **both** invocations |
| `queries.ts`'s `combineFileChanges` | `porcelain/difftree.go` | joins on the new path alone, no rename branch (both sides run `-M -C`) |
| `parse/diff.ts`'s `fileDiffArgs`/`worktreeDiffArgs`/`parseFileDiffBody`/`hasDeletedPostImage`/the LFS sniff | `porcelain/diff.go` | verbatim, including the hunk-counts invariant that throws |
| `parse/log.ts`'s `showMetadataArgs` (F6) and `queries.ts`'s `BODY_AND_SIGNATURE_FORMAT`/`parseTrailerBlock` | `porcelain/show.go` | body last, always |
| `core/model/diff.ts`'s `splitTrailerBlock` | `porcelain/show.go` | D9 |

**The parse types carry `json` tags and cross the wire directly**, rather than being copied into a
second set of structs in `gitrpc`. Precedent, in this exact repo: `gitclient.RepoSummary` and
`gitclient.HeadState` carry tags matching `@kira/git-ipc`'s own shapes and are used as wire types
by `gitrpc/wire.go:30-35`. A `DiffHunk`/`DiffLine` copy would be a deep, field-for-field
duplication of a nested structure for no benefit — and the JSON tags are the documentation of which
contract type each one mirrors.

Two encoding details the tags have to get exactly right, because TypeScript's `| undefined` and
`| null` are different things to `JSON.parse`:

- `originalPath`, `similarity`, `additions`, `deletions`, `oldLine`, `newLine`, `oldBytes`,
  `newBytes` are `undefined` in the contract ⇒ Go pointers with `omitempty` (absent, not `null`).
- `baseSha` is `string | null` in the contract ⇒ `*string` **without** `omitempty` (present and
  `null` for a root commit).
- `FileDiffBody`'s five arms are one Go struct with a `Kind` field and `omitempty` on every arm's
  own fields — the UI switches on `kind` and reads only that arm.

### D6 — The queries live on `RepoEntry`, and `gitrpc` stays thin dispatch

SPEC §6 puts the cat-file session and the "detail/diff caches" on `RepoEntry`, and G3 put the
paging logic on `gitsession.Walk` rather than in `gitrpc` (whose own §3.8 note says the handlers
are "thin dispatch over tested code"). G4 follows the same line:

```go
// gitsession
func (e *RepoEntry) CommitDetail(ctx context.Context, sha string, parentIndex int) (porcelain.CommitDetail, error)
func (e *RepoEntry) FileDiff(ctx context.Context, sha, path, originalPath string, parentIndex int) (FileDiffResult, error)
func (e *RepoEntry) Blob(ctx context.Context, rev, path string) (BlobResult, error)
func (e *RepoEntry) GoToTarget(ctx context.Context, rev, path string) (GoToTarget, error)
```

They belong here because they need what only the entry has: the reader gate (`e.Repo.Read`), the
lazily-started cat-file session (`e.CatFile()`), the two caches (D7), and the identity that says
where the worktree is. `gitrpc` decodes params, calls one of these, and marshals — which is why it
still earns no dedicated test (`AGENTS.md`'s pass-through exclusion), and why the proof is §7.1's
integration tier.

### D7 — Two caches on the shared entry: detail by entries and invalidated, diff by bytes and not

SPEC §6 lists "detail/diff caches" in the shared box, and upstream states plainly why the two are
different (`docs/plans/P5.md`, "The two caches, and why they are different"):

| Cache | Key | Cap | Invalidation |
|---|---|---|---|
| detail | `<sha>:<parentIndex>` | 64 entries | **dropped on `refsChanged`** — one field of it (`decoration`, `%D`) is a fact about refs, not about the commit |
| diff | `<baseSha>:<sha>:<path>` | 4 MiB total, LRU by **bytes**, not entries | **never** — two tree oids and a path determine a patch forever, and the absence of invalidation machinery here is a fact about git objects, not an oversight |

Both are ported with upstream's own constants. Two things this architecture adds:

- **They are shared across connections**, which is the point of `RepoEntry` (SPEC §6) and is safe
  precisely because both keys are content-addressed. Two windows on one repository looking at the
  same commit pay for it once.
- **The invalidation point is `RepoEntry.note`** (`entry.go:70-80`), before the fan-out to
  subscribers — so a client that reacts to `repo.changed` by re-requesting a detail can never be
  served the pre-change decoration. Exactly the ordering rule G3 D13 established for marking a
  `Walk` stale, applied to the cache.

The drift diff (`GoToTarget`'s hunks) is **not** cached, deliberately: its answer changes on every
keystroke in the user's editor, and a cache there would need the one piece of invalidation
machinery the other two are structured to avoid, to save a single spawn on an action that happens
at human speed. Recording the reason is what stops a later phase adding it.

### D8 — `commit.detail`'s spawn plan: metadata first, then three concurrent reads, `ctx` threaded through every one

Resolving F14 and F15.

1. `show -s --decorate=full -z --format=<LogFormat> <sha>` through `e.Repo.Read` — parsed by
   `porcelain.ParseLogRecord`, the same parser the graph walk uses. Its `parents[parentIndex]` is
   what the next two need, so it is awaited first (upstream's own ordering).
2. Then, concurrently, each taking its own read slot: the body/signature `show`, `diff-tree
   --numstat -M -C -z`, and `diff-tree --name-status -M -C -z`.
3. `porcelain.CombineFileChanges` joins the last two on the new path.

Three concurrent reads out of four slots is the deliberate trade: it is what keeps a single detail
inside upstream's ≤80 ms budget, and the gate is what stops five concurrent detail requests from
spawning fifteen processes. A `parentIndex` past the parent list is a `BadRequest`, never a silent
clamp — the webview only ever sends an index it read out of the same result's `parents`.

Every spawn takes the request's `ctx`. `rpcstream` already cancels it on a `cancel` frame (F15), so
a superseded keyboard-navigation request's processes really die, which is the entire reason
upstream threads a signal.

### D9 — `SplitTrailerBlock` is ported to Go, not applied in the extension

`commit.detail.result.body` is defined by the contract as "`%b` with the trailer paragraph removed"
(`contract.ts:936-938`), and the server is what produces `body`. The alternative — send the raw
body and let `proxyHandlers` strip it with `@kira/git-core`'s existing `splitTrailerBlock`
(F10) — was rejected: it makes one string field mean something different on the extension→server
hop than on the webview→extension hop, silently, in a way no type or test would catch. `app.init`'s
divergence is tolerable because it is *structural* and documented; a field whose semantics quietly
change in transit is not.

The rule ported is upstream's, stated so it is testable: take the final blank-line-separated
paragraph of the body; drop it **iff** at least one trailer was returned *and* every one of its
lines either matches `^[A-Za-z][A-Za-z0-9-]*:` or is a folded continuation (begins with
whitespace).

`@kira/git-core`'s TypeScript copy stays where it is, unused — `packages/git-core` is upstream's
and is not edited by this phase (§9).

### D10 — The newline-path blob fallback is built, because "no skipped validation" means this case gets an answer

Resolving F5. A path containing a newline cannot be expressed in `cat-file --batch`'s line-oriented
request protocol at this chapter's git floor. `catfile.Session` gains one method:

```go
// ReadOneShot answers a rev the batch protocol cannot express — a path with a newline in it.
func (s *Session) ReadOneShot(ctx context.Context, rev string) (ObjectInfo, []byte, error)
```

It spawns `git show <rev>` once, argv-only, with no line framing to break, bounded by the same
`maxBlobBytes` gate, and reports a non-zero exit as `ErrMissing` (a path that does not resolve at
that revision is the overwhelmingly likely reason, and it is the same answer the batch protocol
gives). `RepoEntry.Blob` routes to it when `strings.ContainsRune(path, '\n')`, and to the batch
session otherwise.

It is three dozen lines with a real caller and a real (if rare) case behind it. Leaving it out
would mean a legal repository path whose "Go to file" throws an unrecognised-protocol error, which
is precisely the "skipped validation" `AGENTS.md` forbids.

### D11 — Six of the seven host-capability methods are wired here; `review.open` is G6's, and is not stubbed

Resolving F3. SPEC's G4 row says "the seven host-capability methods wired client-side". Six of them
can be, and the seventh cannot be wired without a view that does not exist until G6 — so this plan
wires six, names the seventh, and does not pretend.

After G4:

| Method | Answered by |
|---|---|
| `repo.list` | `roots.list()` — since G3 |
| `repo.pick` | `dialogs.pickFolder(…)` — since G3 |
| `clipboard.write` | `clipboard.writeText(text)`, with `label` logged and `text` never logged |
| `editor.openDiff` | `editor.openDiff(…)` over two virtual/empty document refs (D12) |
| `editor.goToFile` | `file.goToTarget` + `mapLineAcrossDiff` + `editor.reveal` (D4) |
| `editor.resolveConflict` | `editor.resolveConflict({path})` over the absolute path (D13) |
| `review.open` | **still forwarded, still `E_UNKNOWN_METHOD`** — G6 |

And `app.init`'s capability block stops lying: `openInEditor`, `goToFile`, `clipboard` and
`resolveConflict` all become `true`, because all four ports are now constructed and all four
methods now answer.

**`editor.resolveConflict` is wired here rather than in G5**, even though its consumer (the
conflict banner) needs `status.get`, which is G5's. Three reasons: it has no server dependency at
all (two `vscode.commands.executeCommand` calls the port already implements); its capability flag
lives in the same object as the other three, which G4 flips anyway, so leaving it `false` would
make one field of a four-field block lie for one phase; and its call site already exists in the
migrated `packages/git-ui`. It is wiring an existing port to an existing call site, not writing
code with no caller. §11.2 flags the judgment.

### D12 — `editor.openDiff` resolves its two sides from `commit.detail`, not from `commit.fileDiff`

Upstream's handler calls `service.fileDiff` purely to learn `{baseSha, change}` and then throws the
patch away (`rpcHandlers.ts:332-345`) — free for it, because the diff cache made the same call the
UI had just made a hit in the same process.

Here that would mean pulling a whole patch across the socket to read two fields off it. The
extension instead calls `commit.detail` (server-side cached, D7) and reads:

- `baseSha = parents[parentIndex] ?? null` — `null` for a root commit, whose left side is then the
  `empty` document ref;
- `change = files.find(f => f.path === path)` — for `kind === 'deleted'`, whose right side is the
  `empty` ref, and for `originalPath`, which names the left side of a rename.

Everything else is upstream's, verbatim: the two `virtual` refs keyed by `virtualKey(repoId, rev,
path)`, the `basename` labels (which is what drives VS Code's language mode), and the
`<basename> (<shortSha>^ ↔ <shortSha>)` title.

This is the only place G4 departs from upstream's handler body, and it is a transport consequence,
not a redesign.

### D13 — `proxyHandlers` keeps a `repoId → root` map, fed by the `repo.open` results it already forwards

Resolving F11. `forward('repo.open')` becomes a handler that forwards, and — when the result's
`kind` is `"ok"` — records `repo.repoId → repo.root`; `repo.close` drops the entry. One `Map`,
two writes, one read.

Its one G4 consumer is `editor.resolveConflict`, which needs an absolute path and must not
`join(repoId, …)`. A conflict path for a repo with no entry (or with an empty root, i.e. a bare
repository, which cannot have a conflicted worktree at all) is refused with a clear error rather
than resolved against a guess.

`editor.goToFile` needs no entry: `file.goToTarget` returns `absPath` from the side that knows it.
G5+ inherit the map for any other host action that needs a worktree path.

### D14 — The virtual document source is registered once, at activation, and resolves through `file.read`

`ports/editorIntegration.ts` already implements `registerVirtualDocuments(source)` over
`vscode.workspace.registerTextDocumentContentProvider` (F4). G4 supplies the `source`:

```ts
// key === `${repoId}\0${rev}\0${path}` — opaque to VS Code, meaningful only here.
provide(key) -> connection.request('file.read', {repoId, rev, path}) -> content | undefined
```

- `found` → the content. `missing`/`binary`/`tooLarge` → `undefined`, which the port already turns
  into an empty document — the honest outcome, since the content genuinely is not showable.
- A request that fails because the connection dropped → `undefined` too, never a throw into VS
  Code's provider machinery.
- Registration happens once in `activate()`, disposed with the extension, exactly as the port's own
  doc comment specifies. Content is cached by VS Code per URI and never invalidated, because a
  `<rev>:<path>` blob is immutable — the port already says so, and G4 must not add an emitter.

### D15 — The golden corpus grows, and its builder stops inheriting the machine's git config

Resolving F13, and making `AGENTS.md`'s "never touch global git config" structurally true rather
than merely intended.

**The fix**: `fixtures_test.go`'s `repoBuilder.git` sets, in the spawn's own environment,
`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null`, and passes
`-c commit.gpgsign=false` on every commit. Nothing else about the builder changes. The eight
existing fixtures are then regenerated **once, in the same commit**, so the corpus and its
generator agree; from then on any machine reproduces it byte for byte.

The same isolation applies to every new fixture repository this phase builds (in `porcelain`, in
`gitsession`, and in `gitsock`) — and to `graphstream_test.go`'s existing builder, which already
passes identity by env and only needs the two config vars for the same reason.

**The new fixtures**, recorded under `KIRA_GIT_FIXTURES=write` exactly as G3 D15 established, with
argv taken from this package's own builders so recorder and parser cannot drift:

| Fixture | Shape it pins |
|---|---|
| `testdata/diffTree/renameWithEdit.{numstat,nameStatus}.bin` | probe P1's two-path record framing, and `+1 −1` rather than `+10 −10` |
| `testdata/diffTree/mixed.{numstat,nameStatus}.bin` | add, modify, delete, copy, type change, and a binary file's `-\t-\t` |
| `testdata/diff/{text,rename,addedFile,deletedFile,binary,modeOnly,noNewline,lfsPointer}.bin` | probe P4's shapes, one file per patch |
| `testdata/show/{signed,trailers,emptyBody,bodyIsAllTrailers}.bin` | the `%G?%x1f%GS%x1f%(trailers…)%x1f%b` record, body last |

### D16 — What gets a test, and what does not

`AGENTS.md`'s bar, applied honestly. **Tested:**

- `porcelain/difftree.go` — the non-uniform `-z` framing where one logical entry spans three
  records, in both invocations, plus the empty-third-field rename shape and a binary `-\t-\t`.
  ("a parser/splitter with several interacting rules")
- `porcelain/diff.go` — the hunk state machine: omitted counts (`@@ -1 +1 @@`), a section heading,
  `\ No newline at end of file` on either or both sides, an added file (`@@ -0,0 +1,N @@`), a
  deleted file, a multi-hunk patch whose second hunk's numbers come from its own header, a binary
  body, an LFS pointer, a mode-only change, and a patch whose hunk counts disagree with its header
  (which must **fail**, not half-render).
- `porcelain/show.go` — `SplitTrailerBlock`'s paragraph rule: no body; a body that is only
  trailers; a last paragraph with a colon line that git did *not* report as a trailer; a folded
  trailer; trailing blank lines.
- `gitsession` cache tests — the diff cache evicting by **bytes** under an LRU order, and the
  detail cache dropping on a `refsChanged` while the diff cache does not. ("cache
  eviction/invalidation with interacting rules")
- `gitsock` integration — the four methods over a real socket against a real repository, and
  `file.goToTarget`'s three branches (§3.7). This is the phase's real end-to-end proof.

**Not tested, deliberately**: `gitrpc`'s handlers (thin dispatch over the above), the two ports
(direct `vscode` wraps, `AGENTS.md`'s "thin pass-through wrappers"), `proxyHandlers`'
forwarders, and the `repoId → root` map (a two-line `Map`).

### D17 — The file tree is folded in the webview; the server produces a flat list

SPEC's G4 row says "file tree". `packages/git-ui/src/components/fileTreeModel.ts` already folds a
flat `readonly FileChange[]` into a directory tree, aggregates counts, collapses single-child
chains, applies the filter and produces the flat mode — and may not be touched (SPEC §5).

So the server's contribution to "file tree" is `commit.detail.result.files`, a flat list, in
`--name-status` order. Stated because "file tree" in a backend plan is exactly the kind of phrase
that invites someone to build a second one.

### D18 — `Conn` gains one accessor, and nothing else

Resolving F7:

```go
// Entry returns the RepoEntry this connection holds for repoID — the seam every per-repo request
// that is not a graph.* walk needs (D6). ErrRepoNotHeld's own condition, reported as a bool.
func (c *Conn) Entry(repoID string) (*RepoEntry, bool)
```

`alreadyHeld` becomes its body. No other change to `conn.go`: no new per-connection state, because
nothing in G4 is per-viewer — a commit's detail, a file's patch and a blob's bytes are facts about
the repository (SPEC §6's split rule), and they all live on the shared entry.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/`.

### 3.1 `internal/gitclient/porcelain/difftree.go` — new (D5)

| Export | Contents |
|---|---|
| `NumstatArgs(from *string, to string) []string` | `diff-tree -r --no-commit-id --numstat -M -C -z` + (`--root to` \| `from to`) |
| `NameStatusArgs(from *string, to string) []string` | the same with `--name-status` |
| `FileChange` | `Kind`/`Path`/`OriginalPath`/`Similarity`/`Additions`/`Deletions`/`IsBinary`, JSON-tagged per D5 |
| `ParseNumstatRecords([][]byte) ([]NumstatEntry, error)` | tab-limited split to 3; `-`/`-` ⇒ binary; an **empty third field** consumes the next two records as `originalPath`, `path` (probe P1) |
| `ParseNameStatusRecords([][]byte) ([]NameStatusEntry, error)` | `R`/`C` consume two path records, everything else one; `A/M/D/T/U/R/C` classified, an unknown letter is an error |
| `CombineFileChanges(numstat, nameStatus) []FileChange` | joins on the new path alone — no rename branch, because both invocations run `-M -C` |

`difftree_test.go`: the golden fixtures (D15) plus the framing cases — a rename's `+1 −1`, a
binary's `-\t-\t`, a record set that ends mid-rename (an error, not a panic), and a copy (`C`) with
its similarity.

### 3.2 `internal/gitclient/porcelain/diff.go` — new (D5)

| Export | Contents |
|---|---|
| `FileDiffArgs(from *string, to, path string, originalPath *string) []string` | `diff-tree -r -p -M -C --no-commit-id --no-color --no-ext-diff --no-textconv -z --unified=3` + rev pair + `--` + both paths when a rename (probe P2) |
| `WorktreeDiffArgs(rev, path string) []string` | `diff --no-color --no-ext-diff --no-textconv --no-renames -z --unified=3 <rev> -- <path>`. **No `--no-optional-locks` here** — `buildArgv` places it at git level already, and after the subcommand git exits 129 (probe P6) |
| `DiffLine`, `DiffHunk`, `FileDiffBody` | JSON-tagged per D5 |
| `ParseFileDiffBody([]byte) (ParsedBody, error)` | the header walk, the hunk state machine with its counts invariant, the `Binary files … differ` arm, the LFS sniff, and the `empty` arms (`modeChangeOnly` / `identical`) |
| `HasDeletedPostImage([]byte) bool` | `deleted file mode` / `+++ /dev/null` before the first `@@` — read off the header, never inferred from all-`-` hunks |

`ParsedBody`'s `binary` arm carries the two **oids** from the `index` line, not byte sizes: turning
an oid into a size is a `cat-file --batch-check` round trip, and this package is pure (upstream's
own split, `parse/diff.ts:1-9`). `gitsession.FileDiff` does that round trip.

Bytes are decoded with `strings.ToValidUTF8`-equivalent tolerance — an invalid-UTF-8 file renders
replacement characters rather than failing — and line endings are left exactly as git emits them
(`core.autocrlf` is the user's business).

`diff_test.go`: D16's list, table-driven over the committed fixtures.

### 3.3 `internal/gitclient/porcelain/show.go` — new (D5, D9)

`ShowMetadataArgs(sha)` = `["show","-s","--decorate=full","-z","--format="+LogFormat, sha]` (F6),
parsed by the existing `ParseLogRecord`. `ShowBodyAndSignatureArgs(sha)` over
`%G?%x1f%GS%x1f%(trailers:only=true,unfold=true)%x1f%b` — **body last**, so a stray `0x1f` in a
commit message can only corrupt the field that is already last (`SplitLimitedFields`'s own rule).
`ParseTrailerBlock`, `SplitTrailerBlock` (D9), and `CommitDetail`'s Go shape.

`show_test.go`: `SplitTrailerBlock`'s five cases (D16) plus a signed-commit fixture proving `%G?`'s
stderr chatter (probe P5) does not disturb the record.

### 3.4 `internal/gitclient/catfile/session.go` — edited (D10)

`ReadOneShot` plus the `strings.ContainsRune(path, '\n')` routing note. `catfile_test.go` gains two
cases: a spaced path found and missing through the batch session (P3, guarding the existing fix),
and a newline path resolved through the fallback.

### 3.5 `internal/gitsession/` — edited (D6, D7, D18)

| File | Change |
|---|---|
| `queries.go` (new) | `CommitDetail`, `FileDiff`, `Blob`, `GoToTarget`, `worktreeDiff` — D8's spawn plan, D2's caps, D10's routing, and probe P2's both-paths pathspec |
| `cache.go` (new) | `detailCache` (64 entries) and `diffCache` (4 MiB, LRU by bytes), each with its own mutex |
| `entry.go` | the two caches as fields; `note` drops the detail cache on a `refsChanged` **before** fanning out (D7); `teardown` drops both |
| `conn.go` | `Entry(repoID) (*RepoEntry, bool)` (D18) |
| `cache_test.go` | D16's cache cases |
| `queries_test.go` | `GoToTarget`'s three branches against a real repository: a path on disk (re-mapped, hunks non-nil after an uncommitted edit above the line), a path not on disk whose blob exists, and a path whose blob does not; plus a path escaping the root, refused |

`GoToTarget`'s decision procedure, in this order and no other:

```
1. root == "" (bare)                         -> historical branch (there is no checkout)
2. abs = filepath.Join(root, path); refuse if it escapes root; os.Stat(abs)
   exists  -> {live, absPath: abs, hunks: worktreeDiff(rev, path)}
3. Blob(rev, path)
   missing -> {unavailable, notInRevision}
   binary  -> {unavailable, binary}            // NUL in the first 8 KiB
   tooLarge-> {unavailable, tooLarge}
   found   -> {historical, rev, path}
```

`worktreeDiff` returns `nil` hunks — never an error — for: zero output (identical, probe P6), a
deleted post-image (`HasDeletedPostImage`, the un-indexed-but-on-disk case), over `MaxPatchBytes`,
a parse failure, or a failed spawn. A refinement that cannot run must never turn a working "Go to
file" into an error.

### 3.6 `internal/gitrpc/` — edited (D2, D3)

| File | Change |
|---|---|
| `contract.go` | `ContractVersion = 14` |
| `wire.go` | `CommitDetailParams`/`Result`, `CommitFileDiffParams`/`Result`, `FileReadParams`/`Result`, `FileGoToTargetParams`/`Result`, and `MaxResultBytes` |
| `detail.go` (new) | the four handlers: decode, `c.Entry(repoID)` (D18) or `E_BAD_REQUEST`, call the entry, marshal — with the two size-sensitive ones returning `json.RawMessage` (D2b) |
| `handlers.go` | four cases in `Request`; `Stream`'s default is unchanged |

### 3.7 `internal/bridge/rpcstream/session.go` — edited (D2a)

`handleRequest` encodes the result body and, when it exceeds `h.MaxFrameBytes`, sends an error
`res` (`E_FRAME_TOO_LARGE`) in its place. `session_test.go` gains one case: a handler returning an
oversize result produces an error response, not silence.

### 3.8 `internal/gitsock/detail_test.go` — new (§7.1(e))

Over `graphstream_test.go`'s existing harness (F16), against a fixture repository built with one
rename-with-edit, one binary file, one deleted file, one merge and one signed commit:

- **`TestIntegration_CommitDetailAndFileTree`** — `commit.detail` returns the metadata, the
  trailer-stripped body, the structured trailers, the signature, the decoration, and a `files` list
  whose rename carries `originalPath`, `similarity`, and `+1 −1`.
- **`TestIntegration_CommitDetailMergeParentSelector`** — `parentIndex: 1` changes the file list;
  an out-of-range index is `E_BAD_REQUEST`.
- **`TestIntegration_FileDiffShapes`** — `text` (with both paths in the pathspec for the rename,
  proving probe P2's failure mode does not ship), `binary` with sizes filled from `--batch-check`,
  `empty` for a mode-only change, and `tooLarge` for a patch over the cap.
- **`TestIntegration_FileReadBranches`** — `found`, `missing`, `binary`, and a path with a newline
  in it resolving through D10's fallback.
- **`TestIntegration_GoToTargetBranches`** — the three branches, including a `live` branch whose
  returned hunks shift the caller's line by exactly the net insertion above it.
- **`TestIntegration_DetailCacheDropsOnRefsChanged`** — a second `commit.detail` after a `git tag`
  reports the new decoration (a counting `Runner` wrapper proves the first was a cache hit and the
  second was not).

### 3.9 `main.go`

**Unchanged.** Every new type is reached through the `Registry`, the `Router` and the socket server
that G1/G2 already construct.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ipc/src/contract.ts` and `validate.ts` — edited (D3)

Two request keys in their own labelled server-only section, two entries in `REQUEST_KEY_MAP`,
`CONTRACT_VERSION = 14`. No existing entry changes. No event, no stream.

### 4.2 `apps/kira-studio-vscode/src/proxyHandlers.ts` — edited (D11–D13)

Deps gain `clipboard: Clipboard`, `editor: EditorIntegration` and `repoRoots` (D13). Four handlers
stop forwarding:

- **`clipboard.write`** → `clipboard.writeText(text)`; log `label`, never `text`; a rejection
  propagates so `toWireError` carries the reason to the UI (§6.4: silence is the one unacceptable
  outcome).
- **`editor.openDiff`** → D12's composition, then `editor.openDiff({left, right, title})`.
- **`editor.goToFile`** → `file.goToTarget`, then:
  `live` ⇒ `mapLineAcrossDiff(hunks, line, 'old')` when `hunks !== null` else `line`, `reveal({kind:'file', path: absPath}, final)`, return `{kind:'liveFile', path, line: final}`;
  `historical` ⇒ `reveal({kind:'virtual', key: virtualKey(repoId, rev, path), label: basename(path)}, line)`, return `{kind:'virtualBlob', path, rev, line}`;
  `unavailable` ⇒ returned as-is.
- **`editor.resolveConflict`** → `editor.resolveConflict({path: join(root, path)})` over D13's map,
  refused with a clear error when the repo is unknown or bare.

`repo.open`/`repo.close` forward *and* maintain the map (D13). `file.read`/`file.goToTarget` get
plain forwarders (F12). `app.init`'s four capabilities become `true` (D11).

### 4.3 `apps/kira-studio-vscode/src/extension.ts` — edited (D14)

Construct `VsCodeClipboard` and `VsCodeEditorIntegration` beside the existing three ports; pass
both into `createProxyHandlers`; register the virtual-document source once
(`editor.registerVirtualDocuments(source)`, pushed onto `context.subscriptions`), with the source
resolving through `connection.request('file.read', …)`.

### 4.4 What does **not** change

**`packages/git-ui` and `packages/git-core` are not touched by this phase.** Not one file. The
extension *imports* `mapLineAcrossDiff` from `@kira/git-core` (D4) — importing an existing export is
not editing the package. If an implementer finds themselves editing either, something has drifted
out of scope (SPEC §5).

`packages/git-ipc/schema/`, `src/generated/`, `graphChunkCodec.ts`, `codec.ts`, `socketChannel.ts`
and `rpc.ts` are likewise untouched — D1 is why.

---

## 5. Dependencies and tooling

**No new dependency, in either language.** No FlatBuffers schema change, so `bun run
generate:wire` is not run and `internal/gitwire`/`src/generated` do not move (D1). `go.mod` and
`bun.lock` are expected to be **unchanged**; a diff in either is a signal something was reached for
that this plan did not sanction.

---

## 6. Implementation order

Six commits. `go build ./apps/kira-studio/internal/...`, `go test
./apps/kira-studio/internal/...`, `bun run lint` and `bun run typecheck` run after **each** — they
are fast. The expensive tier (§7.1(f)–(h)) runs once at C6, per `AGENTS.md`'s "implement the whole
plan first, then test once".

- **C1** `feat(gitclient): diff-tree, unified-diff and commit-show parsing`
  — §3.1 + §3.2 + §3.3, their fixtures, and D15's config isolation applied to the existing builder
  with all eight existing fixtures regenerated in the same commit. Nothing imports it yet.
- **C2** `feat(gitclient): a one-shot blob read for a path the batch protocol cannot express`
  — §3.4. Independent of everything else in the phase but D6's `Blob`.
- **C3** `feat(rpcstream): refuse an oversize response instead of dropping its frame`
  — §3.7. Small, self-contained, and lands before the first handler that can produce one.
- **C4** `feat(gitsession): commit detail, file diff, blob reads and go-to-file targets`
  — §3.5 in full: the queries, the two caches, the invalidation point, `Conn.Entry`. Depends on
  C1 and C2.
- **C5** `feat(git): serve commit.detail/commit.fileDiff/file.read/file.goToTarget, and bump the contract to 14`
  — §3.6 + §4.1. **The atomic cross-language swap**: the contract version, the two new keys, the
  wire types and the handlers agree across Go and TypeScript in one commit or they do not compile.
- **C6** `feat(vscode): the editor, clipboard and virtual-document ports answered locally`
  — §4.2 + §4.3, then §3.8's integration tests and the full §7.1 run.

Dependency order: C1 before C4; C2 before C4; C3 before C5; C4 before C5; C5 before C6.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 What is proven automatically, in this container

**(a) `go test ./apps/kira-studio/internal/gitclient/porcelain/...`** — the two `diff-tree` record
parsers' framing, the unified-diff hunk state machine and its counts invariant, `SplitTrailerBlock`,
all against committed recordings of real git output (§3.1–§3.3).

**(b) `GIT_CONFIG_GLOBAL=/dev/null KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the
tree clean** — F13's bug, fixed. This is the check that proves the corpus is machine-independent,
and it is the one that fails today.

**(c) `go test ./apps/kira-studio/internal/gitclient/catfile/...`** — the spaced path in both
directions, and the newline path through D10's fallback.

**(d) `go test ./apps/kira-studio/internal/gitsession/...`** — the two caches' eviction and
invalidation, and `GoToTarget`'s three branches plus its path-escape refusal against a real
repository.

**(e) `go test ./apps/kira-studio/internal/gitsock/`** — §3.8's six integration tests over a real
socket: **this is the phase's real end-to-end proof on the Go side**, and the first time a commit's
detail, a file's patch and a blob's bytes cross this transport.

**(f) `go test ./apps/kira-studio/internal/bridge/rpcstream/`** — an oversize response answers
`E_FRAME_TOO_LARGE` instead of vanishing (D2a).

**(g) `bun test packages/git-ipc/src` (inside `bun run test:unit`)** — unchanged by this phase and
therefore a regression check that `CONTRACT_VERSION = 14` and the two new keys did not disturb the
codec or the framing.

**(h) `bun run lint` / `bun run typecheck` / `bun run build:vscode` / `bun run test:e2e-real` —
green.** `build:vscode` is an exit criterion from G3 D20 on. `test:e2e-real` adds no new spec: its
`{kind:"gitUnavailable"}` assertions still hold on Linux, and its continued passing is what proves
the contract bump did not break the un-openable path.

**(i) `go test ./apps/kira-studio/internal/`** — the layering test, with nothing added to
`packagesExemptFromBridgeCheck` (no new package is created outside the existing tree).

### 7.2 What genuinely cannot be proven here, and the macOS script for it

Four things are structurally out of reach in this container, and one of them is bigger in G4 than
it was in G3 — **most of this phase's user-visible behaviour is VS Code's**:

1. **A real VS Code extension host.** `vscode.diff` opening two virtual URIs, a
   `TextDocumentContentProvider` resolving a `kira-version:` URI, `showTextDocument` landing a
   cursor on a line, `vscode.env.clipboard`, and `workbench.view.scm`. §7.1(e) proves everything
   underneath them and nothing about them.
2. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin (G2 F18).
3. **The two inherently-native host methods `repo.list`/`repo.pick`** — G3's own carried-forward
   gap, still only checkable by a human opening a folder picker.
4. **Perf.** G3 D22's harness measures this container; G11 re-measures.

**The macOS script, run once on real hardware before G4 is called done:**

1. `go test ./apps/kira-studio/internal/...` on macOS — the same suite on the platform that ships.
2. `GIT_CONFIG_GLOBAL=/dev/null KIRA_GIT_FIXTURES=write go test ./…/porcelain/...`, then
   `git status` — **clean on a second machine**, which is F13's only real check.
3. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository; pair.
4. Select a commit in the graph. **The detail pane populates**: message, trailers, signature line,
   parents, decoration, and a file tree with statuses, rename arrows and `+adds/−dels`. Try a
   merge (the parent selector changes the list), a root commit, an unsigned commit and a commit
   with no body.
5. Click a file. **The diff renders** — text hunks with old/new gutters; then a binary file
   ("Binary file — not shown"), a too-large patch, and a mode-only change, each as its own one-line
   row rather than a rendered approximation.
6. **"Open in editor"** opens VS Code's own diff, both sides historical, with the tab titled
   `<basename> (<shortSha>^ ↔ <shortSha>)` and syntax highlighting on (the URI's last segment is
   the real filename — the most visible way to get D14 wrong).
7. **"Go to file"** on four cases, and the announcement quotes the line the cursor actually landed
   on in each: (a) a file present in the checkout and unchanged since — lands on the mapped line;
   (b) a file present but **edited above the cursor since**, uncommitted — lands on the *shifted*
   line, and the number differs from the historical one by exactly the net insertion above it;
   (c) a file deleted since — opens the historical blob at the same line, announced as "not in your
   checkout", not as a failure; (d) a file that only ever existed on a branch never checked out —
   same, which is the case this feature exists for.
8. **Copy actions**: the sha column's button (enabled at last), the two sha buttons and the message
   button in the detail pane, and a file row's path. Each reports what it copied.
9. Confirm what is *expected to still be broken*, so it is not mistaken for a regression: the
   branch picker is still empty and the webview console still carries unhandled rejections for
   `refs.list`/`status.get`/`undo.peek` (G5) and `stash.list` (G8). `commit.detail`'s rejection —
   one of the five G3 D17 listed — is gone.
10. **Two windows, one repository**: open the same commit in both and confirm the second is served
    from the shared detail cache (the extension's output channel shows one round trip, and a
    `git tag` in a terminal makes both re-fetch).

### 7.3 The checklist

- [ ] `CONTRACT_VERSION` is 14 on both sides; exactly two request keys added, none removed, no
      existing param or result changed.
- [ ] `packages/git-ipc/schema/`, `src/generated/`, `graphChunkCodec.ts`, `codec.ts` and
      `socketChannel.ts` are byte-for-byte unchanged (D1).
- [ ] `packages/git-ui` and `packages/git-core` are byte-for-byte unchanged.
- [ ] `go.mod` and `bun.lock` are unchanged.
- [ ] Both `diff-tree` invocations run `-M -C`, and a rename with a one-line edit reports `+1 −1`.
- [ ] A per-file diff of a rename names **both** paths in its pathspec (probe P2).
- [ ] `WorktreeDiffArgs` does not repeat `--no-optional-locks` (probe P6: exit 129).
- [ ] A patch whose hunk counts disagree with its header fails loudly rather than half-rendering.
- [ ] `%b`'s trailer paragraph is removed server-side, and the trailers travel structured.
- [ ] A blob over the gate is answered from `--batch-check` alone, with no content read.
- [ ] A path with a newline resolves through the one-shot `git show` fallback.
- [ ] `commit.fileDiff` answers `tooLarge` — never a transport error — for a patch over 1 MiB or a
      result over 6 MiB.
- [ ] An oversize response is an `E_FRAME_TOO_LARGE` error frame, never a dropped frame.
- [ ] The detail cache drops on `refsChanged`, before the fan-out; the diff cache does not, and
      evicts by bytes.
- [ ] `file.goToTarget` never consults HEAD, the index, or reachability — only "is there a file on
      disk" and "is there an object at `<rev>:<path>`".
- [ ] A `path` escaping the repository root is refused, in the one place that resolves one.
- [ ] A bare repository takes the historical branch, and no host method joins a path against a
      `repoId`.
- [ ] Six host-capability methods are answered locally; `review.open` still rejects; all four
      `app.init` capabilities are `true`.
- [ ] The virtual-document provider is registered once and disposed with the extension, and fires
      no `onDidChange`.
- [ ] `KIRA_GIT_FIXTURES=write` reproduces the corpus byte-for-byte **with the machine's global git
      config ignored**.
- [ ] No fixture, test or script runs `git config --global`.
- [ ] §7.1(a)–(i) all green; §7.2's ten macOS steps all pass.

---

## 8. Sequencing — one implementer

**Recommendation: one sequential Sonnet subagent for the whole phase.** G1, G2 and G3 all made the
same call, and G3 — materially larger than this — carried it through successfully.

1. **C5 is a cross-language atomic swap**, exactly like G3's C8: the contract version, two new
   keys, the Go wire types and the handlers have to agree across two languages in one commit. An
   agent that did not write C4's queries cannot land it against a compiler, only against this
   plan's prose.
2. **The phase is one dependency chain.** Parsers → queries → handlers → contract → extension. That
   is `AGENTS.md`'s textbook case of *not* "genuinely independent (unrelated adapters,
   non-overlapping fixes)".
3. **The one piece that looks separable is not worth separating.** C2 (`ReadOneShot`) and C3
   (`rpcstream`'s guard) are each independent of the rest, but they are a few dozen lines apiece —
   the coordination would cost more than the concurrency saves. If the orchestrator does choose to
   parallelise anyway, **C3 alone** is the only defensible cut: it touches one file in one package
   nothing else in this phase edits.

---

## 9. Explicit non-goals for G4

| Not in G4 | Owner |
|---|---|
| `review.open` — the seventh host-capability method, and the review view it reveals | G6 |
| `refs.list`, `status.get`, `undo.peek`, the pre-flight engine, the in-progress banner, checkout/revert | G5 |
| `status --porcelain=v2`, `stash list`, `merge-tree`, the full `for-each-ref` parser | G5 / G8 |
| The ranged/review walk, `review.resolveBase`, `review.target` | G6 |
| Remote ops, the askpass broker, the credential relay, auto-fetch | G7 |
| Reset, cherry-pick, the completed undo slot | G9 |
| Search, and the RE2-vs-`RegExp` reconciliation | G10 |
| A FlatBuffers member for diff hunks or blob bytes (D1), and any change to `gitwire.fbs` | nobody, unless a phase measures a need |
| A paged or truncated `commit.detail.files` for a pathological commit (D2) | §10 |
| Side-by-side diff, blame, file history, pickaxe search | out of scope for v1.3 |
| Any change to `packages/git-ui` or `packages/git-core` | never, per SPEC §5 |

---

## 10. Handed forward

- **`review.open` is the seventh host-capability method and is still unanswered** (F3/D11). **G6**
  owns it, together with registering the review view it reveals. SPEC's G4 row says "seven"; six is
  what can honestly be wired before that view exists.
- **`commit.detail` has no domain size cap** (D2). A commit touching tens of thousands of files
  fails with `E_FRAME_TOO_LARGE` rather than hanging — visible, not silent, but not graceful. A
  future phase that wants graceful needs a wire shape for a partial file list, which means changing
  what `FileTree.vue` is fed; not worth it until someone hits it.
- **The blob-in-a-response path is half-built** (D1/F9). `socketChannel.ts` already substitutes a
  `$blob` marker in any frame; only `Handlers.Request`'s signature is missing. **G14**'s stored blob
  snapshots are the plausible first real need.
- **`@kira/git-core`'s `splitTrailerBlock` now has a Go twin and still no TypeScript caller**
  (D9/F10). Two implementations of one rule, in two languages, with nothing forcing agreement —
  accepted here because the wire field is defined server-side and `packages/git-core` may not be
  edited. If a later phase ever finds them disagreeing, the Go one is authoritative.
- **The drift diff is deliberately uncached** (D7). If a future phase measures "Go to file" as slow,
  the answer is not a third cache — it is one spawn on a human-speed action, and the reason is
  recorded so the trade is re-made deliberately rather than by default.
- **G3's fixture corpus was machine-dependent for one phase** (F13/D15). Anything else in this repo
  that builds a git repository from `exec.Command` and trusts the ambient config has the same
  latent bug; G4 fixes the two builders that exist (`porcelain`, `gitsock`) and every new one it
  adds. **G5+** should copy the isolated builder rather than the old one.
- **The read pool is 4 and one `commit.detail` takes 3 of it** (F14/D8). **G11**'s multi-client
  matrix is where a real answer to "is that the right number under two windows scrolling" comes
  from; nothing before it has enough concurrent load to tell.

---

## 11. Two calls worth a human eye before implementation starts

Both are judgment calls the orchestrator or the user may reasonably decide differently, and both
are cheap to change *now* and awkward to change after C5. Neither is a blocker: the plan takes a
position on each and can be implemented as written.

### 11.1 Is JSON really the right wire for diffs and blobs? (D1, F9)

**As planned**: yes. The receiver has no typed arrays to reconstruct, the payload fires once per
user action rather than continuously, the contract's types are already plain TypeScript that
`DiffView.vue` reads directly, and D2's two caps plus the transport guard make the pathological
case a visible, honest "too large" rather than a hang. FlatBuffers would cost a schema, two codecs
and a cross-language fixture to make a ~2.5 MiB worst-realistic-case payload smaller.

**The alternative**: honour SPEC §4.2's literal wording ("diff hunks, blob bytes" as FlatBuffers).
The client half of an out-of-band blob response already exists (F9), so this is smaller than it
sounds — but it still means new union members, a Go encoder, a TypeScript decoder that
`packages/git-ui` cannot be changed to consume without a translation layer, and a conformance
fixture.

This is the one place this phase deviates from a literal reading of the chapter spec, so it is
flagged rather than settled quietly.

### 11.2 Does `editor.resolveConflict` get wired in G4 or G5? (D11)

**As planned**: G4. It is a pure host capability with no server dependency, its port is already
written, its call site already exists in the migrated `packages/git-ui`, and its capability flag
sits in the same four-field object G4 flips to `true` anyway — leaving one field of that object
`false` for one phase is a smaller lie than the others but still a lie.

**The alternative**: leave it forwarded until G5, the phase whose `status.get` makes the conflict
banner appear at all, on the strict reading that a method whose UI cannot be reached yet is code
with no caller. That reading also means `app.init` reports three `true`s and one `false` for one
phase, which the UI handles correctly (it feature-detects) but which is one more thing to explain
in G5's own exit criteria.
