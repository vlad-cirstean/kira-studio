# G11 — Incremental review: `review.db`, the compressed blob snapshot, and the three-tier delta

> **What this phase is.** The eleventh phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> first *post-ship* one — G10 already produced an installable `.vsix`, so this and everything after
> it are follow-up rebuilds through a packaging pipeline that already exists. It is also the first
> phase in the chapter with **no upstream equivalent at all** (`kira-version-vscode` has no P-number
> for it) and the first that needs genuinely **new UI surface** rather than wiring up a migrated
> component. SPEC's "Review state (G11/G12)" section is the authoritative design source; this plan
> is the *how*.
>
> **In one line: `internal/gitreview` stops being a pure classifier and grows its own SQLite file
> (`review.db` under `${KIRA_HOME}`, opened lazily, migrated by its own forward-only runner) holding
> per-`(repo, branch)`-session, per-file "last reviewed" records — a `flate`-compressed content
> snapshot plus the commit sha it was taken at plus reviewed line ranges; `gitsession` gains one
> file that orchestrates a **three-tier** "what changed since you reviewed" selection (blob-oid
> equality → `git diff` fast path → stored-blob `diff --no-index` slow path); `gitrpc` serves three
> new methods and goes to `ContractVersion` 18; and the review sidebar gains a **Files** pane beside
> its existing Commits list, built by composing the `FileTree.vue` and `DiffView.vue` this chapter
> already ships, each gaining exactly one optional prop.**
>
> **Three things are called out rather than smuggled in.** (1) A *third* selection tier SPEC does
> not name — blob-oid equality — which is exact, needs no diff at all, and is what makes the common
> "came back, nothing moved" case one `cat-file --batch-check` per file (D7/F6). (2) A **new UI
> surface** in `packages/git-ui`, which SPEC otherwise freezes — justified in D16 and F10, kept to
> one new component that composes two existing ones plus one optional prop each. (3) `gitreview`
> stops being a pure leaf package and starts owning a database, which is what SPEC's own package
> table asks for but is a real change in that package's character (D2).
>
> **Two calls want a human eye before implementation starts — §11.**

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`ec986086`, "docs(v1.3):
add G24, the docs-update closeout phase"), i.e. on top of everything G1–G10 landed. Every claim below
was checked against source read or a command run **in this container**, never against prose —
including G4's, G6's and G10's own plans, which are records of intent and are verified against the
code they produced.

| Claim | Evidence |
|---|---|
| `internal/gitreview` exists and is **two files** — a pure classifier and its table test — importing `gitclient/porcelain` and nothing else | `ls internal/gitreview` → `resolve.go` (215 lines), `resolve_test.go` (207); `resolve.go:9`'s single import |
| G6's own hand-forward assigns exactly this work to the next review phase: *"`gitreview` exists and holds one classifier. G10 adds `review.db`, the compressed blob store, the fast/slow-path selection and the reaper beside it"* — G10 in the pre-renumber numbering, **G11** now | `docs/v1.3/plans/G6-…md:1474-1477` (and its §9 table's "`review.db`, blob snapshots, the fast/slow diff path, partial-review ranges, the TTL reaper") |
| SPEC's package table reserves `gitreview` for *"(G11/G12) `review.db` (own SQLite file), compressed blob storage, fast/slow-path diff selection, partial-review range state, TTL/PR-close reaper, the flat AI-comment list"* | `docs/v1.3/SPEC.md:80` |
| `ContractVersion` is **17** in three hand-maintained places | `internal/gitrpc/contract.go:17`, `packages/git-ipc/src/validate.ts:10`, `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93` |
| `gitrpc`'s request table is a 23-case switch plus one stream case; `review.resolveBase` is its only `review.*` entry | `internal/gitrpc/handlers.go:51-111` |
| G4's diff primitives are all reusable as-is: `FileDiffArgs(from *string, to, path string, originalPath *string)`, `ParseFileDiffBody`, the `FileDiffBody` union (text/binary/lfsPointer/tooLarge/empty), `DiffHunk`/`DiffLine` | `porcelain/diff.go:14-27`, `:119-133`, `:143-188`, `:51-67` |
| A **context** `DiffLine` carries *both* `OldLine` and `NewLine`; a `del` line carries only `OldLine`, an `add` line only `NewLine` | `porcelain/diff.go:305-321` |
| G4's file-list primitives are reusable as-is: `NumstatArgs`/`NameStatusArgs` take `(from *string, to string)` and `appendRevPair` puts them in as two plain revisions; `CombineFileChanges` produces `[]porcelain.FileChange` | `porcelain/difftree.go:11-29`; `RepoEntry.CommitDetail` uses exactly this pair (`gitsession/queries.go:193-220`) |
| `catfile.ObjectInfo` carries the resolved **OID**, and `--batch-check` echoes it as the header's first field for a `<rev>:<path>` request | `catfile/batch.go:12-17`, `:29-47`; probe P6 below |
| `catfile.DefaultMaxBlobBytes` is 10 MiB; `gitsession.MaxPatchBytes` is 1 MiB | `catfile/session.go:23`; `gitsession/queries.go:21` |
| `RepoEntry.diff` is an LRU-by-bytes cache keyed `(baseSHA, sha, path)` and **never invalidated**, on the stated grounds that two tree oids and a path determine a patch forever | `gitsession/cache.go:135-180` |
| `RepoEntry` reaches git through exactly two helpers: `runOne` (classify always) and `runAllowingExit(ctx, args, ok ...int)` | `gitsession/queries.go:49-89` |
| `Registry` already has three injectable seams defaulted in `NewRegistry` — `NewWatcher`, `LingerFor`, `Settings` — and `newRepoEntry` threads `Settings` onto every entry | `gitsession/registry.go:32-65`, `entry.go:93-112` |
| `gitsession` imports `gitclient`, `gitclient/catfile`, `gitclient/porcelain`, `gitaskpass`, `gitops`, `gitpreflight`, `gitreview` and stdlib — no `bridge`, no `config` | `registry.go:1-13`, `review.go:1-10`, `entry.go:1-11` |
| The app has exactly one SQLite idiom: `storage/db.go`'s DSN-pragma `buildDSN` + `SetMaxOpenConns(1)` + `Ping` + `chmod 0600`, and `storage/migrate.go`'s forward-only `schema_version` runner over `migrations/embed.go`'s hand-ordered `names` table (16 steps, the last being G1's `0016_g1_git_clients.sql`) | those three files, read in full |
| `config.KiraHome()` honours `$KIRA_HOME`, `EnsureLayout` makes it 0700, and `DbPath()` is `KiraHome()/kira.db` | `config/paths.go` |
| `main.go` constructs `gitsession.NewRegistry` and `gitrpc.New` **unconditionally**, before `gitSock.Start()` — whose failure is logged, not fatal | `main.go:113`, `:132-146` |
| The review sidebar has **no per-file surface**: `ReviewView.vue` renders `ReviewCommitRow`s, and a file appears only inside one expanded commit's own `DetailState`→`FileTree`/`DiffView` | `ReviewView.vue:416-458`, `:462-478`; `state/review.ts:213-241` |
| `FileTree.vue` takes `files: readonly FileChange[]`, `selectedFile`, `actions`, and already renders one **optional, capability-gated** per-row button | `FileTree.vue:26-34`; its template's `kv-file-tree-copy` block |
| `DiffView.vue` already owns a `focusedRow` cursor set by clicking any row, and a header with two conditionally-rendered action buttons | `DiffView.vue:79-87`, `:250`, `:223-228` |
| `DetailPane.vue` is exactly the composition the new pane mirrors: `DiffView` when `mode === 'diff'`, otherwise `FileTree` | `DetailPane.vue`'s template |
| G10's palette machinery: `commands.ts`'s `MUTATING_COMMANDS`/`OTHER_COMMANDS`, `commands.test.ts`'s two-way cross-check, `App.vue:581-631`'s `runUiAction` over the `ui.action` event, and `panelView.ts:78-86`'s emit | those files |
| `reviewView.ts` has `notifyRepoChanged`/`notifySettingsChanged` and **no** `runUiAction` | `reviewView.ts:81-101` |
| `go build ./apps/kira-studio/internal/...` is green here; git is **2.43.0** | run here |
| `git config user.email` / `user.name` | `noreply@anthropic.com` / `Claude` |

**Probes, run in this container against real git 2.43.0.** These decide code paths; the implementer
should extend them, not re-derive them.

| # | Question | Observed |
|---|---|---|
| **P1** | `git merge-base --is-ancestor <sha> <branch>` — the fast-path gate | ancestor ⇒ **exit 0**; non-ancestor ⇒ **exit 1**; a well-formed but absent sha ⇒ **exit 128** `fatal: Not a valid commit name …`; an abbreviated/garbage name ⇒ **exit 128**; a `<branch>` that does not exist ⇒ **exit 128** |
| **P2** | after `git commit --amend`, is the *old* tip still an object? | `merge-base --is-ancestor <oldTip> main` ⇒ **exit 1**, and `git cat-file -e <oldTip>` still **succeeds** — i.e. a rewritten history usually answers 1 (unreachable-but-present), not 128 (pruned). Both mean "slow path" |
| **P3** | `git diff --no-index` output shape | emits a real `index <old>..<new> <mode>` line, `---`/`+++` and ordinary `@@` hunks. **Exit 1** when the files differ, **exit 0** when identical |
| **P4** | …for a **binary** pair | `index 8d21d29..22f6b3b 100644` followed by `Binary files a/… and b/… differ` — so `ParseFileDiffBody`'s binary arm (which *errors* on "binary diff with no index line", `diff.go:161-163`) is satisfied |
| **P5** | …under this app's own full argv discipline (`-c core.quotepath=false -c color.ui=false … --no-pager --no-optional-locks diff --no-index --no-color --no-ext-diff --no-textconv --unified=3 -- <abs> <abs>`), run with `Dir` inside an unrelated repository | works unchanged, exit 1 / exit 0 as P3. `--no-optional-locks` does **not** trip the 129 trap G4 probe P6 found for post-subcommand placement — `buildArgv` already puts it at git level |
| **P6** | `echo "feature:a.txt" \| git cat-file --batch-check` | `9654793044dfefdf978aa2e75b9feef706a31875 blob 19` — the **resolved blob oid** is the header's first field. A deleted path answers `feature:k.txt missing` |
| **P7** | the range's file set: `diff-tree -r --no-commit-id --numstat/--name-status -M -C -z <mergeBase> <branch>` vs. `<base> <branch>` | three-dot (merge-base) gives `a.txt`, `n.txt`; **two-dot gives `a.txt`, `k.txt`, `n.txt`** — `k.txt` was deleted *on `base`*, not by the branch. Two-dot is wrong for review, and wrong in a way a reader would not notice |
| **P8** | `git diff <blobOid> <blobOid>` | works and emits an ordinary patch, but **exits 0 even when the blobs differ** — unlike every other diff form in this chapter. Recorded because it is the tempting "no temp files" shortcut and its exit-code semantics are a trap (D8's own rejected alternative) |
| **P9** | `flate` vs `gzip` (both `BestCompression`) over 597 real `.go`/`.ts`/`.vue`/`.md` files in this repo | raw 4,162,959 B → **flate 1,382,644 B (33.2%)**, gzip 1,393,390 B (33.5%). gzip's fixed cost is **18 bytes per file** (header + CRC32 + length). Re-run over `packages/` (260 files): 33.5% / 33.8%, same 18 B |

### 0.2 Scope

1. `internal/gitreview` — the phase's centre of gravity: `review.db`'s schema, its own migration
   runner, the compressed snapshot codec, the pure range algebra (`Union`/`Subtract`/`Normalize`)
   and the pure line projection (`ProjectRanges`), and the TTL reaper (§3.1, D2–D4, D9–D11).
2. `internal/gitclient/porcelain` — **two** new argv builders (`NoIndexDiffArgs`, `IsAncestorArgs`);
   `MergeBaseArgs` gains a second caller rather than a sibling (§3.2, D6/D8).
3. `internal/gitsession` — `incremental.go`: the range file list, the three-tier delta selection,
   and the mark orchestration; `Registry` gains one seam and `RepoEntry` one field (§3.3, D5–D8,
   D12, D14).
4. `internal/gitrpc` — `incremental.go` (three thin handlers), `wire.go`'s param structs, one new
   case block, **`ContractVersion` 17 → 18** (§3.4, D1, D13, D19).
5. `packages/git-ipc` — three request keys, their types, `REQUEST_KEY_MAP`, one `UiActionKind`
   member, the version constant (§4.1, D1).
6. `packages/git-ui` — the Files pane: one new component composing `FileTree.vue` and
   `DiffView.vue`, one optional prop on each of those two, one segmented control in the existing
   review header, one `ui.action` arm (§4.2, D16).
7. `apps/kira-studio-vscode` — one palette command, `reviewView.ts`'s `runUiAction` (§4.3, D17).
8. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G11 work:

- **Inline AI review comments.** **G12** — SPEC's own "flat table of `(session, file, line range,
  text, created_at)`". G11 creates `review.db` and its migration runner precisely so G12 adds
  `0002_g12_comments.sql` beside `0001_g11_review.sql` rather than inventing a store.
- **The eager PR-closed purge.** **G16**, once `branch.resolvePr` exists. G11 ships the seam it
  calls (`Store.Purge`, D11) and nothing that knows what a PR is.
- **A "mark every file reviewed" / "reset this session" bulk action.** Deliberately deferred to
  G12, which already owns a session-wide clear-all for comments and will be editing this exact
  surface (§10).
- **Reviewed state on the *graph* panel's commit detail pane.** `DetailPane.vue` is unchanged.
  Review state is a fact about a `(repo, branch)` review session; the panel has no such session.
- **Persisting anything about the *commit* list.** G6's ranged `Walk` is per-connection and
  in-memory and stays that way. Nothing in `review.db` is keyed by a commit sha except a snapshot's
  own `reviewed_at_sha`.
- **A second `RepoEntry`/`Conn` walk, or any change to `walkPair`.** G6's split is untouched.
- **Any change to the FlatBuffers schema or the data plane.** Everything this phase adds is JSON on
  the existing control plane; `gitWire.fbs`, `internal/gitwire` and `bun run generate:wire` are not
  touched.
- **Worktree/unstaged content.** Every rev this phase resolves is `<branch>` or a commit sha. The
  working tree is never read; a branch that is not checked out behaves identically to one that is.
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` in full: **no stubbed error handling, no `TODO: fix later`, no skipped validation.**
  Every degraded state this phase can reach is a *named* value the UI renders (D10's
  `snapshotUnavailable` is the sharpest example), never a silent empty result.
- **No shell, ever.** Every new spawn goes through `gitclient`'s existing `Runner`/`Spec` with an
  argv slice, exactly like every spawn G2–G10 added. The two temp file paths the slow path
  produces are passed as two argv elements after `--`, never interpolated into anything.
- **No new dependency, in either language.** `compress/flate`, `database/sql`, `embed`, `os` are
  stdlib; `modernc.org/sqlite` is already a direct require (`storage/db.go:12`). `go.mod` and
  `bun.lock` are expected to be byte-identical after this phase — a diff in either is a signal
  something was reached for that this plan did not sanction.
- **Tests only where `AGENTS.md`'s bar is met** (D18). G11 clears it in four places and nowhere else.
- **Fixture repositories scope their git config to themselves** — G5 D19's `fixtureEnv()`
  (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `-c commit.gpgsign=false`).
  **Never `git config --global` or `--system`.** Every `review.db` a test opens lives under
  `t.TempDir()`.
- Comments very concise, only where the code cannot say it itself.
- Conventional Commits, granular, each one compiling with its own tests passing (§6).

---

## 1. Findings

### F1 — `gitreview` is a pure leaf today, and SPEC asks this phase to change that

`internal/gitreview` is `resolve.go` + `resolve_test.go`: a `ResolveBase(Input) Core` classifier over
a `for-each-ref` snapshot, importing `gitclient/porcelain` for `RefRow` and nothing else. Its own
package doc says so, and G6 D7a made the purity explicit ("Nothing here spawns a process or touches
the filesystem, which is what makes D16's matrix testable without a repository").

SPEC's package table (`SPEC.md:80`) nonetheless assigns the *whole* of G11/G12 to this package:
`review.db`, compressed blob storage, fast/slow-path selection, partial-review range state, the
reaper, and G12's comment list. G6's own hand-forward says the same thing in as many words.

So the package's character changes in this phase: it acquires `database/sql`, `modernc.org/sqlite`,
`compress/flate`, `embed`, `os` and `internal/config`. That is not a boundary violation — none of
those reaches `internal/bridge`, so `TestDomainPackagesDoNotImportBridge` passes by construction with
no exemption — but it *is* a real change worth naming rather than performing quietly (D2).

### F2 — Every diff and file-list primitive G11 needs already exists, and needs no change

This is what keeps the phase's Go surface small. Reading `porcelain/diff.go`, `porcelain/difftree.go`,
`gitsession/queries.go` and `catfile/`:

| Need | What already serves it |
|---|---|
| the range's file list | `NumstatArgs(from, to)` + `NameStatusArgs(from, to)` + `CombineFileChanges` — `appendRevPair` (`difftree.go:24-29`) puts `from`/`to` in as two plain revisions, so `<mergeBase> <branch>` is expressible today |
| one file's patch, base→tip | `FileDiffArgs(&mergeBase, branch, path, originalPath)` — verbatim, `to` is already a free-form rev string |
| one file's patch, snapshot-commit→tip (**the fast path**) | the *same* `FileDiffArgs(&reviewedAtSha, branch, path, nil)`. The fast path needs **no new argv at all** |
| parsing either into hunks | `ParseFileDiffBody` → `ParsedBody`, then `RepoEntry.resolveParsedBody` → the wire `FileDiffBody` |
| the wire diff union | `porcelain.FileDiffBody` — text / binary / lfsPointer / tooLarge / empty, already the exact shape `DiffView.vue` renders |
| current blob oid and size for `<branch>:<path>` | `RepoEntry.CatFile().Check(rev)` → `catfile.ObjectInfo{OID, Type, Size}` (probe P6) |
| current blob content | `.Read(rev)`, with `ErrMissing`/`ErrTooLarge` already classified |
| a per-file patch cache keyed by two tree oids and a path | `RepoEntry.diff` (`cache.go:135-180`), whose key `(baseSHA, sha, path)` fits `(mergeBase, branchTipSha, path)` exactly, and whose "never invalidated" property is *correct* for it |
| a size-capped result on the wire | `gitrpc.MaxResultBytes` + the marshal-once/re-marshal shape `handleCommitFileDiff` already uses |

The **only** new argv this phase needs is `diff --no-index` (D8). Everything else is composition.

### F3 — The range's file set is a *three-dot* diff, and getting it wrong is invisible

Probe P7, on a fixture where `base` (`main`) itself moved after the branch diverged:

```
diff-tree … <mergeBase> feature   ->  a.txt, n.txt          # correct
diff-tree … main        feature   ->  a.txt, k.txt, n.txt   # k.txt was deleted ON MAIN
```

The two-dot form reports the branch as having *deleted* `k.txt`, because a plain tree-to-tree diff
cannot tell "the branch removed it" from "the base added it after we diverged". Every review tool
uses three-dot semantics for exactly this reason, and G6 already commits this repo to them on the
commit side: its ranged walk is `<base>..<branch>`, the *commits reachable from branch but not base*
— whose aggregate tree change is precisely `diff <merge-base> <branch>`.

`git diff A...B` is sugar for `diff $(merge-base A B) B`; `diff-tree` has no `...` form, so this
phase resolves the merge-base explicitly and passes it as `from`. That resolution is one extra
`git merge-base <base> <branch>` spawn — the same command G6's `sharesHistory` already runs and
*discards the stdout of* (`gitsession/review.go:88-94`).

### F4 — `merge-base --is-ancestor` has three exit codes, and a rewritten history usually answers 1, not 128

Probes P1/P2:

| Situation | Exit |
|---|---|
| the snapshot commit is an ancestor of the branch | **0** — the fast path |
| the snapshot commit exists but is no longer reachable (amend, rebase, squash) | **1** |
| the snapshot commit no longer exists at all (pruned) | **128** |
| the *branch* no longer exists | **128** |

P2 matters more than it looks. After `git commit --amend`, `git cat-file -e <oldTip>` still succeeds
— git does not prune on rewrite, and `gc.pruneExpire` defaults to two weeks — so the overwhelmingly
common rewritten-history case is **exit 1**, not 128. Both take the slow path, so the distinction
does not change behaviour; what it changes is the honest description of the slow path's frequency
(common, not exotic) and the shape of the test fixture that exercises it (an `--amend`, not a
`gc --prune=now`).

Exit 128 for a missing *branch* is a different failure and must not be folded into "slow path": it
means the caller asked about a ref that is gone, which is a `E_BAD_REQUEST`-shaped answer, and the
branch tip is resolved from the cached refs snapshot *before* any of this runs, so it is already
ruled out by construction (D7).

### F5 — `git diff --no-index` produces output `ParseFileDiffBody` already handles, including the binary arm

The single biggest risk in taking SPEC's slow path literally was that `--no-index` might emit a
patch this chapter's parser cannot read. Probes P3/P4/P5 say it does not:

- It emits a real `index <old>..<new> <mode>` line. That is load-bearing, not cosmetic:
  `ParseFileDiffBody` **errors out** on a binary diff with no index line (`diff.go:161-163`), so a
  `--no-index` form that omitted it would turn every binary snapshot comparison into a hard failure.
- `Binary files a/… and b/… differ` matches the parser's own prefix/suffix test verbatim
  (`diff.go:160`).
- Exit **1** means "the files differ", exit **0** means "identical" — so it needs
  `runAllowingExit(ctx, args, 0, 1)`, exactly the shape merge-tree/`config --get-regexp`/undo capture
  already use (`queries.go:64-70`).
- It runs unchanged under this app's whole argv discipline (`configOverrides`, `--no-pager`,
  `--no-optional-locks`), from a `Dir` inside an unrelated repository, against absolute paths outside
  it (P5).

One consequence to be deliberate about: `--no-index`'s `diff --git a/<path> b/<path>` and `---`/`+++`
lines carry the **temp file paths**. `ParseFileDiffBody` never reads those lines (it looks only for
`index `, `@@ `, `Binary files … differ`, `old mode `, `new mode `), and only parsed hunks cross the
wire, so no temp path can reach a client. That is true by construction and is a checklist item
(§7.3), not a hope.

### F6 — Blob-oid equality is a complete, exact answer to "did anything change", and costs no diff at all

`cat-file --batch-check` on `<branch>:<path>` returns the **resolved blob oid** as its header's first
field (probe P6). If that equals the oid recorded when the file was marked reviewed, the file's
content at the branch tip is *byte-identical* to the snapshot — regardless of how the history in
between was rewritten, regardless of whether the snapshot commit still exists, regardless of renames
along the way.

This is stronger than either path SPEC names, and cheaper than both: it is one line written to and
one line read from a persistent process `RepoEntry` already owns and already keeps warm
(`entry.go:244-264`). It also covers the case the two named paths handle *worst*: a rebase that
rewrote every commit but did not change this file's content — the fast path is unavailable (the sha
is not an ancestor) and the slow path would decompress a blob, write two temp files and spawn git,
only to produce an empty patch.

It matters most for `review.files`, which needs a per-file "has this changed since you reviewed it"
answer for every file with a stored record. Doing that with a diff per file would be N spawns; doing
it with oid equality is N pipe round trips on one already-running process.

### F7 — The stored diff already contains an exact old→new line mapping, so range projection needs no heuristics

`porcelain.DiffLine` (`diff.go:51-57`) carries `OldLine *int` and `NewLine *int`, and
`parseOneHunk` (`diff.go:305-321`) sets **both** on a `context` line, `OldLine` only on a `del`, and
`NewLine` only on an `add`. `DiffHunk` carries `OldStart/OldLines/NewStart/NewLines`.

So, given the snapshot→current patch, every old line number has an exact answer:

- Inside a hunk: walk its `Lines`; a context line maps `OldLine → NewLine` directly; a `del` line has
  no image and drops out.
- Outside every hunk: `new = old + Σ(NewLines − OldLines)` over all hunks that end before it —
  unchanged regions shift uniformly, which is what a unified diff *means*.

That is arithmetic, not a heuristic, and it makes the whole family of content-hash schemes
unnecessary. It is also, on its own, exactly the "cursor/pagination boundary arithmetic" `AGENTS.md`
names as deserving a real unit test (D18).

### F8 — There is one SQLite idiom in this repo, and it is small enough to mirror deliberately

`storage/db.go` is ~100 lines: `buildDSN` sets `_busy_timeout=5000`, `_foreign_keys=1`,
`_auto_vacuum=INCREMENTAL`, `_pragma=journal_size_limit(4194304)`, `_journal_mode=WAL`,
`_synchronous=NORMAL`; `Open` calls `config.EnsureLayout`, `sql.Open("sqlite", …)`,
`SetMaxOpenConns(1)`, `Ping` (which is what actually creates the file, so the `chmod 0600` must come
after), then `migrate()`.

`storage/migrate.go` is 70 lines: a `schema_version` table with one row, a **refusal** when the
stored version exceeds what the binary knows, and one transaction per step. `migrations/embed.go`
holds an `//go:embed *.sql` FS plus a hand-ordered `names` slice — deliberately *not* directory
order — currently 16 entries ending at `{16, "g1_git_clients", "0016_g1_git_clients.sql"}`.

Every one of those choices applies verbatim to `review.db`: same driver, same single-writer posture,
same WAL, same forward-only refusal, same embedded ordered steps. `_auto_vacuum=INCREMENTAL` is if
anything *more* apt here than for `kira.db` — SPEC's own reason for a separate file is "TTL/PR-close
purges that want to reclaim space aggressively", which is exactly what an incremental-vacuum freelist
plus a periodic `PRAGMA incremental_vacuum` is for.

### F9 — `flate` beats `gzip` here by a small, measured margin, and the difference is a checksum we can do better

Probe P9, over 597 real source files in this repo: flate compresses to **33.2%**, gzip to **33.5%**;
the gap is gzip's fixed **18-byte** header/CRC32/length envelope per file. Over a 400-file branch
review that is ~7 KB of pure overhead — negligible in absolute terms, which is why SPEC says "either".

The tiebreaker is not the 18 bytes, it is what they buy: a CRC32 over the compressed payload. This
phase stores git's own **blob oid** alongside every snapshot anyway (F6), which is a SHA-1/SHA-256
over the *content* — a strictly stronger integrity check, computed by git, and one this phase must
store regardless. gzip's CRC would be a second, weaker checksum over a different thing. So `flate`
(D9).

### F10 — The review sidebar has no per-file surface, and the case this phase exists for makes the commit list useless

`ReviewView.vue` renders a list of `ReviewCommitRow`s; a file is reachable only by expanding a commit,
which constructs that commit's own `DetailState` and renders G4's `FileTree`/`DiffView` inside the row
(`state/review.ts:213-224`, `ReviewView.vue:434-478`).

SPEC's motivating scenario is a **rebase, squash or amend**. After one, *every commit in the list is
new*: the shas the user saw yesterday do not exist, the rows are all unfamiliar, and "which of these
have I already read" is unanswerable per-commit even in principle. The unit that survives a history
rewrite is the **file**, which is exactly why SPEC keys review state per-file with a content snapshot
rather than per-commit.

So a per-commit-only surface cannot carry this feature. G11 needs a file-level view of the range —
and this is the first phase in the chapter where SPEC's "the existing webview UI is the frontend,
as-is" runs into something the existing UI genuinely does not have. D16 resolves it.

### F11 — `FileTree.vue` and `DiffView.vue` are already parameterised for an additive extension

Neither component knows anything about commits:

- `FileTree.vue`'s props are `files: readonly FileChange[]`, `selectedFile`, `listMode`, `filter`,
  `parents`, `parentIndex`, `store`, `actions`. It emits `selectFile`/`update:*`. It already renders
  one **optional** per-row control, gated on a capability
  (`v-if="actions.capabilities.clipboard"` → the copy button), so a second optional per-row control
  is an established pattern in this exact file rather than a new one.
- `DiffView.vue` already owns a `focusedRow` cursor that any row click sets (`:250`), already resets
  it when the diff changes (`:79-87`), and already has a header that conditionally renders action
  buttons (`canOpenInEditor`/`canGoToFile`, `:223-228`).

`DetailPane.vue` is the composition template: `DiffView` when the detail state says `mode === 'diff'`,
otherwise the tree. The new pane is that same shape over a different data source.

### F12 — Two Kira Studio processes can run, only one serves, and anything built unconditionally in `main.go` exists in both

SPEC §3.2's `flock` on `git.sock.lock` decides which instance *listens*; it does not stop a second
instance from starting, opening `kira.db`, and constructing the whole git stack —
`main.go:113`/`:132-146` build the `Registry` and the `Router` before `gitSock.Start()`, whose error
is logged and not fatal (`main.go:144-146`).

A `review.db` opened eagerly at construction would therefore be open in **both** processes, and its
TTL reaper would tick in both. Two writers on one SQLite file is survivable (WAL + `busy_timeout`)
but a *non-serving* instance silently deleting review rows is not something to design in on purpose.

### F13 — G10 made every post-ship phase responsible for its own palette command, and the review view cannot receive one yet

SPEC's G10 row: *"G11 onward are now post-ship follow-ups, **each responsible for registering its own
palette command when it lands**, since this one audit doesn't happen again."*

The machinery: `commands.ts` holds `MUTATING_COMMANDS` (a `Record<MutatingAction, …>` whose totality
is compiler-enforced) and `OTHER_COMMANDS` (a flat list of five non-mutating entries);
`commands.test.ts` cross-checks both against `package.json#contributes.commands` **and** against Go's
own served op kinds; `extension.ts:175-186` registers everything straight from those two tables;
`panelView.ts:78-86` focuses the panel and emits `ui.action` into it.

G11 adds no `OpRequest`/`RemoteOpParams` kind, so `MUTATING_COMMANDS` does not change. It does add a
user-facing mutating *action* (marking a file reviewed), which belongs in `OTHER_COMMANDS` — and
`reviewView.ts` has **no `runUiAction`** (`reviewView.ts:81-101` has only the two notify methods), so
the review webview cannot be reached from the palette at all today.

### F14 — `ContractVersion` is mirrored by hand in three places, and one of them has been missed before

`internal/gitrpc/contract.go:17`, `packages/git-ipc/src/validate.ts:10`, and
`apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93`. G4 missed the third and needed a
follow-up commit (`dd07252f`); G10 landed its own third-mirror fix as a separate commit
(`ca0330f0`). G11 moves all three in one commit.

### F15 — Snapshot storage is unbounded unless this phase bounds it

`catfile.DefaultMaxBlobBytes` is **10 MiB**. Without a cap of its own, `review.db` would accumulate
up to 10 MiB (≈3.3 MiB compressed, per F9) *per reviewed file, per branch*, held for 14 days. A
handful of reviewed lockfiles or minified bundles is enough for a multi-hundred-megabyte database in
a directory the user does not know exists.

`gitsession.MaxPatchBytes` is 1 MiB — upstream's own per-file patch cap (`queries.go:18-21`) — and is
the natural sibling bound: a file whose *content* exceeds the size at which this chapter already
refuses to render a *patch* is a file whose snapshot buys nothing.

### F16 — `RepoID` is a machine-local absolute path, which is the right primary key and has one honest consequence

`gitclient.Identify` sets `RepoID` to the worktree root for a non-bare repository and the git dir for
a bare one (`repo.go:196-209`). It is stable for a repository that stays where it is, and it changes
if the user moves or re-clones one — at which point that repository's review sessions become
unreachable and the reaper eventually deletes them. That is the same outcome as the 14-day TTL, which
SPEC already declares acceptable ("returning after that window starts clean, by design, not an error
case"), so it needs no migration story — only a sentence saying so (D5).

---

## 2. Decisions

### D1 — `ContractVersion` 17 → 18: three new requests and one new `UiActionKind` member

| Added | Channel |
|---|---|
| `review.files` | request |
| `review.fileDiff` | request |
| `review.mark` | request |
| `'toggleFileReviewed'` on `UiActionKind` | (a member of an existing event's payload union) |

No event, no stream, no change to any existing request's params or result. The three mirrors move in
one commit (F14): `packages/git-ipc/src/validate.ts:10`, `internal/gitrpc/contract.go:17`,
`apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts:93`.

**Why three methods and not one.** They have genuinely different shapes and lifetimes: `review.files`
is a per-session list (N files, one merge-base resolution, N cheap oid checks, no patch);
`review.fileDiff` is one file's patch plus its projected ranges (one or two spawns, size-capped);
`review.mark` is the only writer (it re-snapshots, so it is the only one that reads blob *content*
and the only one that writes to `review.db`). Folding them would mean one method whose cost varies by
three orders of magnitude depending on a mode flag.

**Why not a stream for `review.files`.** The file list of a branch review is bounded by what a human
will read — `FileTree.vue` already caps its own rendering at `FILE_TREE_ROW_CAP` with a "Show all N
files" escape. A JSON array of `FileChange` + a small status struct is the same shape
`commit.detail` already returns for a commit's files, and the same `MaxResultBytes` guard applies
(D19). SPEC §4.2's FlatBuffers rule is about *bulk* payloads — commit chunks, diff hunks, blob bytes
— and a file list is neither bulk nor new: it is the exact type `commit.detail` already crosses as
JSON.

### D2 — `internal/gitreview` becomes the phase's home; `resolve.go` stays pure and untouched

Resolving F1, and following SPEC's package table literally.

```
internal/gitreview/
  resolve.go          UNCHANGED — G6's pure base-resolution classifier
  resolve_test.go     UNCHANGED
  store.go            NEW  Store: open, session/file/range read+write, Touch, Purge
  db.go               NEW  DSN, Open, chmod, the lazy-open guard (D3)
  migrate.go          NEW  the forward-only schema_version runner (a mirror of storage/migrate.go)
  migrations/
    embed.go          NEW  //go:embed *.sql + the hand-ordered names slice
    0001_g11_review.sql
  snapshot.go         NEW  flate encode/decode, the size cap, ContentKind
  ranges.go           NEW  pure: LineRange, Normalize, Union, Subtract, Expand
  project.go          NEW  pure: ProjectRanges over []porcelain.DiffHunk
  reaper.go           NEW  the sweep loop and its ticker
  ranges_test.go, project_test.go, store_test.go   NEW (D18)
```

The package gains `database/sql`, `modernc.org/sqlite`, `compress/flate`, `embed`, `os`,
`path/filepath`, `time`, `sync` and `internal/config`. It still reaches nothing under
`internal/bridge`, so `TestDomainPackagesDoNotImportBridge` passes with **no exemption added** —
a checklist item (§7.3), not an assumption.

**Rejected: a separate `internal/gitreviewstore`.** SPEC's package table names one package for both
G11 and G12, and `ranges.go`/`project.go` are pure policy that the store and the session
orchestration both need — splitting would put a leaf's policy on one side of a boundary and its only
two callers on the other.

**Rejected: putting the schema in `internal/storage`'s migrations.** SPEC is explicit and gives the
reason: *"a second SQLite file, `review.db` under `${KIRA_HOME}`, not a table in `kira.db` — its
lifecycle is nothing like the rest of the app's data (bulk blob content, TTL/PR-close purges that
want to reclaim space aggressively, no reason to hold a lock on the main db while doing it)."*
`storage/db.go`'s `SetMaxOpenConns(1)` makes that last clause concrete: a purge of a hundred
megabytes of blobs on the main database would serialise behind, and ahead of, every tab save.

### D3 — `review.db` opens **lazily**, on the first review request, and its path comes from `gitreview.DefaultPath()`

Resolving F12.

```go
// Store is review.db's whole surface. Construction is free: the file is neither created nor
// opened until the first call that needs it, so a Kira Studio instance that never serves a
// review request (including the second instance that lost the git.sock.lock flock, SPEC §3.2)
// never creates the file and never starts the reaper.
func NewStore(path string) *Store
func DefaultPath() string   // filepath.Join(config.KiraHome(), "review.db")
func (s *Store) Close() error
```

- **Lazy, guarded by a `sync.Once`-shaped `ensureOpen()`** that runs `config.EnsureLayout`, opens with
  D4's DSN, `SetMaxOpenConns(1)`, `Ping`, `chmod 0600`, migrates, runs one sweep (D11), and starts the
  reaper ticker. A failure is returned to the caller and **not** memoised as permanent: the next
  request retries, since the common failure (a full or read-only home directory) is transient in a way
  a broken `git` binary is not.
- **The same lazy-construction shape `RepoEntry.CatFile()` already uses** (`entry.go:241-264`) — "a
  connection that never reads a blob never pays for two extra processes", here "an instance that never
  reviews never creates a database".
- **A user who never uses branch review never gets a `review.db` at all**, which is a small, real
  courtesy for a file in a directory they did not choose.
- `Close` stops the reaper, joins its goroutine and closes the `*sql.DB`; it is idempotent and safe to
  call when the store was never opened.

**Where it is constructed**: `gitsession.NewRegistry` defaults a new `Review *gitreview.Store` field to
`gitreview.NewStore(gitreview.DefaultPath())`, exactly as it already defaults `NewWatcher`,
`LingerFor` and `Settings` (`registry.go:57-65`); `Registry.Close()` closes it. **`main.go` needs no
change at all** — it already constructs the `Registry` and already reaches `Registry.Close()` through
`gitsock.Server.Close()`. Tests override `Registry.Review` with a store under `t.TempDir()`, the same
seam `NewWatcher` already is.

This does mean `gitsession` transitively depends on `internal/config` (through `gitreview`). `config`
imports only stdlib and is already a dependency of `internal/storage`, `internal/logging` and
`internal/secrets`; nothing about it reaches `bridge`.

### D4 — `review.db`'s DSN and migration runner mirror `internal/storage`'s, deliberately and by copy

Resolving F8. `gitreview/db.go`'s `buildDSN` is `storage/db.go`'s, with one deletion and one comment:

```go
q.Set("_busy_timeout", "5000")
q.Set("_foreign_keys", "1")               // review_range -> review_file -> review_session CASCADE
q.Set("_auto_vacuum", "INCREMENTAL")      // SPEC's "purges that want to reclaim space aggressively"
q.Set("_pragma", "journal_size_limit(4194304)")
q.Set("_journal_mode", "WAL")
q.Set("_synchronous", "NORMAL")
```

`_foreign_keys=1` is **load-bearing here** in a way it is not for `kira.db`: `Purge` (D11) is a single
`DELETE FROM review_session`, and the file/range rows go with it only because the cascade is enforced.

`gitreview/migrate.go` is `storage/migrate.go`'s runner — `schema_version`, seed 0, **refuse a version
newer than this binary knows**, one transaction per step — over `gitreview/migrations`' own embedded,
hand-ordered `names` slice, starting at `{1, "g11_review", "0001_g11_review.sql"}`.

**This is ~60 lines of deliberate duplication and the plan says so rather than hiding it.** The
alternative — exporting a generic `storage.RunMigrations(db, steps)` and importing `internal/storage`
from `gitreview` — was rejected on SPEC's own module-boundary rule ("git-specific Go code stays in its
own packages … no phase merges git and studio/api code into a shared file where a per-module one would
do"): it would make a studio-module package a compile-time dependency of a git-module package in
exchange for a `for` loop. The runner exists from day one rather than a bare `CREATE TABLE IF NOT
EXISTS` because **G12 is already known to add `0002_g12_comments.sql`** — the second step is not
hypothetical. Recorded in §10: if a *third* SQLite file ever appears, extraction becomes worth it.

### D5 — The session key is `(repo_id, branch)`, exactly as SPEC says — and the base is deliberately not part of it

SPEC: *"Session scope: keyed by `(repo, branch)`, joining G6's base-resolver/ranged-walk concept of a
branch review rather than inventing a second one."*

Two consequences, both stated rather than discovered later:

1. **Changing the base does not reset review state.** Reviewing `feature` against `origin/develop` and
   then against `main` is one review session; the files you already read, you have already read. This
   is right — the base is a lens on the same branch, not a different piece of work — and it matches
   G6's own "the override holds for the session" (`state/review.ts:86-91`). The *file set* changes with
   the base, so a record for a path the new base's range does not contain simply does not appear; it is
   not deleted, and it reappears if the base changes back.
2. **`RepoID` is a machine-local absolute path** (F16). Moving or re-cloning a repository orphans its
   sessions, which the reaper collects after 14 days. That is the same outcome SPEC already declares
   correct for the TTL, so there is no migration or repair path and none is built.

`review.mark`'s params therefore carry **no `base`** — the write is a fact about `(repo, branch, path)`
only. `review.files` and `review.fileDiff` carry one because they need the merge-base to compute the
range. That asymmetry on the wire is the session key made visible, not an oversight.

### D6 — The range's file set is `diff-tree <mergeBase> <branch>`, and the merge-base is resolved once per request

Resolving F3. `RepoEntry.mergeBase(ctx, base, branch) (string, bool, error)` is
`runAllowingExit(ctx, porcelain.MergeBaseArgs(base, branch), 0, 1)`:

- exit 0 ⇒ the trimmed sha, `true`
- exit 1 ⇒ `""`, `false` — unrelated histories (G6 probe P2)
- anything else ⇒ the classified error

**`porcelain.MergeBaseArgs(a, b)` already exists** — G6 added it for `sharesHistory`
(`porcelain/review.go:12-14`), and that caller *discards stdout*. So the change here is not a new
builder but a new **caller**: `mergeBase` reads the sha `sharesHistory` throws away, and
`sharesHistory` collapses into `mergeBase`'s own `ok` return. **One helper, two callers, one spawn** —
`ResolveReviewBase` (G6) keeps its behaviour byte for byte and stops having a near-duplicate three
lines away.

The file list is then the exact pair `CommitDetail` already runs, with `from = &mergeBase`,
`to = branch`:

```go
raw, _ := e.runOne(ctx, porcelain.NumstatArgs(&mb, branch))
numstat, _ := porcelain.ParseNumstatRecords(allRecords(raw))
raw2, _ := e.runOne(ctx, porcelain.NameStatusArgs(&mb, branch))
nameStatus, _ := porcelain.ParseNameStatusRecords(allRecords(raw2))
files := porcelain.CombineFileChanges(numstat, nameStatus)   // []porcelain.FileChange
```

Run concurrently, as `CommitDetail` runs its own three (`queries.go:177-221`) — two of the repo's four
read slots, not three.

**The branch tip sha comes from the cached refs snapshot**, not a fourth spawn: `findBranchRef`
(`gitsession/review.go:108-120`) already resolves a short name to a `porcelain.RefRow`, and
`RefRow.ObjectID` is the tip. A branch that is not in the snapshot is `E_BAD_REQUEST` naming it — the
same answer `ResolveReviewBase` already gives (its `ask` arm), reached before any spawn.

### D7 — The delta selection is **three** tiers, and the extra one is the cheap common case

Resolving F4/F6, and the phase's central algorithm. Given a stored record for `(session, path)` and a
resolved `branchTip` sha:

```
0. currentOID := CatFile().Check(branchTip + ":" + path)     — ErrMissing => ""
   if currentOID == record.BlobOID:
        -> deltaSource "unchanged"; hunks = nil; ranges project identically
   (exact, no diff, one pipe round trip — F6)

1. merge-base --is-ancestor <record.ReviewedAtSha> <branch>
   exit 0  -> deltaSource "fast"
              patch = FileDiffArgs(&record.ReviewedAtSha, branch, path, nil)
              the stored blob is NOT read
   exit 1
   exit 128 -> tier 2                                        (F4: 1 is the common rewrite case)
   other    -> the classified error

2. record.ContentKind == "text"  -> deltaSource "slow"
        dir  := os.MkdirTemp("", "kira-review-")             (D8)
        write flate-decoded snapshot to dir/old  (0600)
        write CatFile().Read(branchTip+":"+path) to dir/new  (0600)
        patch = NoIndexDiffArgs(dir/old, dir/new)  via runAllowingExit(0, 1)
   record.ContentKind != "text"  -> deltaSource "snapshotUnavailable"
        (binary, over the cap, or absent at review time: there is nothing to diff against,
         and the phase says so rather than pretending)
```

Then in every tier: `body := resolveParsedBody(ParseFileDiffBody(patch))`, and
`reviewedRanges := ProjectRanges(record.Ranges, body.Hunks, currentLineCount)` (D10).

**Why tier 0 is a decision and not an optimisation slipped in.** SPEC names two paths and this adds a
third *ahead* of both. It earns it: it is exact (byte equality of content-addressed objects), it is
the only tier that works when the snapshot commit is pruned *and* the content is unchanged, and it is
the one `review.files` uses for every file — turning an N-spawn list into N pipe writes. Naming it
`unchanged` on the wire rather than folding it into `fast` is deliberate: a reader of a
`deltaSource: "fast"` response should be able to conclude a `git diff` actually ran.

**This is precisely `AGENTS.md`'s "a decision structure too large to hold in your head"** — three
tiers × four content kinds × three exit codes, with two of the branches (128 and
`snapshotUnavailable`) unreachable from any happy path. It gets a real Go unit test over a real
fixture repository (D18), not an integration test that happens to cover one arm.

### D8 — The slow path's temp files are request-scoped, in one `MkdirTemp`, and never shared

Resolving SPEC's own deferral (*"Precise temp-file lifecycle and concurrency … is G11's own planning
concern"*).

```go
dir, err := os.MkdirTemp("", "kira-review-")   // 0700, per os.MkdirTemp
defer os.RemoveAll(dir)
os.WriteFile(filepath.Join(dir, "old"), snapshot, 0o600)
os.WriteFile(filepath.Join(dir, "new"), current,  0o600)
```

- **One directory per delta computation**, created and removed inside the one function that needs it.
  There is no shared temp directory, no content-addressed name, no reuse across requests and no
  cleanup pass — so two connections computing the same delta at the same instant cannot collide, by
  construction rather than by lock. This is the whole of the concurrency answer for the temp files;
  D12 covers the database.
- **0700 directory, 0600 files.** Repository content is written to `$TMPDIR`; it must not be
  world-readable there any more than `kira.db` is.
- `defer os.RemoveAll(dir)` runs on every path including a cancelled context — the spawn is bounded by
  the request's own ctx through `Repo.Read`, so a cancellation returns and the defer fires.
- `NoIndexDiffArgs(oldPath, newPath)` (§3.2) puts both paths after `--`, so a path that somehow began
  with `-` could not be read as a flag. Our own names are `old` and `new`, so this is belt and braces,
  and it is one line.

**Rejected: `git diff <blobOid> <blobOid>` with the snapshot written into the odb.** Tempting — no
temp files at all, and probe P8 confirms it produces an ordinary patch. Three reasons against, in
order: it **exits 0 even when the blobs differ** (P8), a semantics unlike every other diff form in
this chapter and exactly the kind of thing a future reader gets wrong; it requires the stored blob to
still be *in* the object database, which is the one thing the slow path exists to not depend on; and
getting it in there means `hash-object -w`, i.e. writing loose objects into the user's repository to
answer a read.

**Rejected: a hand-rolled Go diff.** SPEC forecloses it (*"reusing `gitclient`'s existing spawn
discipline … rather than a hand-rolled Go diff algorithm"*), and `AGENTS.md`'s library rule points the
same way: git is the diff implementation this chapter already depends on, and a second one would have
to agree with it exactly for the two paths to be interchangeable.

### D9 — Snapshot storage: `flate` at `BestCompression`, capped at 1 MiB, with git's own oid as the integrity check

Resolving F9/F15.

| Field | Value |
|---|---|
| codec | `compress/flate`, `flate.BestCompression`, no dictionary |
| cap | `MaxSnapshotBytes = 1 << 20` — `gitsession.MaxPatchBytes`'s sibling (F15) |
| integrity | `blob_oid`, git's own content hash, stored for every record including the ones with no content |
| kinds | `content_kind` ∈ `text` / `binary` / `tooLarge` / `absent`; **content is stored only for `text`** |

- **`binary`** — decided by `gitsession.looksBinary` (`queries.go:381-387`), the NUL-in-the-first-8-KiB
  sniff G4 already uses for `file.read`. A binary file is whole-file-reviewable only (no ranges), and
  its change detection is *exact* through tier 0 anyway (F6), so storing the bytes would buy nothing.
- **`tooLarge`** — content over `MaxSnapshotBytes`, or `catfile.ErrTooLarge` from the 10 MiB session
  gate. Same treatment as `binary`.
- **`absent`** — the path did not exist at `reviewed_at_sha` (a file the user reviewed *as deleted*).
  `blob_oid` is `""`, which tier 0 compares against a `""` from an `ErrMissing` lookup, so
  "still deleted" is `unchanged` with no special case.
- **`line_count`** is stored for `text` records — it is what `Expand` (D10) turns a `full` state into a
  concrete range set, and it is computed once, at mark time, from content already in hand.
- The snapshot is stored **decompressed-length-prefixed nowhere**: `content_bytes` is a column, so a
  corrupt or truncated blob is detected on decode (length mismatch) rather than producing a shorter
  file silently. A mismatch is an error naming the path, never a partial snapshot.

### D10 — Partial review: ranges live in **snapshot coordinates**, are projected forward on read, and marking always re-snapshots

Resolving SPEC's other explicit deferral (*"the requirement is fixed here, the mechanism is not"*).
This is the phase's second real design decision after D7.

**The invariant, stated once:** *every `review_range` row is a line range in the coordinates of the
`review_file` row's own stored snapshot.* Nothing else is ever stored.

**On read** (`review.files`, `review.fileDiff`): the delta selection (D7) already produces the
snapshot→current hunks; `ProjectRanges` maps the stored ranges through them into **branch-tip
(new-side) line numbers**, which is what the wire carries and what `DiffView.vue` can tint directly
against `DiffLine.newLine`. Tier 0 (`unchanged`) needs no projection at all.

**On write** (`review.mark`): the operation is always

```
1. read the current record (if any) and compute the delta exactly as a read would (D7)
2. existing := ProjectRanges(record.Ranges, hunks, currentLineCount)   // now in tip coordinates
   (record.State == "full" => existing := Expand(1..record.LineCount) projected the same way)
3. next := Union(existing, given)      for reviewed=true
        := Subtract(existing, given)   for reviewed=false
   (given absent => the whole file: next := everything / nothing)
4. re-snapshot: read <branchTip>:<path>, classify, compress, and REPLACE the record —
   reviewed_at_sha = branchTip, blob_oid = currentOID, line_count = currentLineCount
5. write `next` as the new range rows — which are now, by construction, in the NEW snapshot's
   coordinates, restoring the invariant
```

**Why re-snapshot on every mark.** It is what makes the invariant hold with a single projection
direction. The alternative — keeping the old snapshot and projecting the *incoming* range backwards —
needs a second, inverse projection, and it leaves the record anchored to a commit that gets older
every time the user touches the file, so the slow path's stored blob drifts further from what they
were actually looking at. Re-snapshotting means the record always describes *the state the user last
saw*, which is the only thing "last reviewed" can honestly mean.

**Whole-file is a `state`, not a range.** `state = 'full'` avoids materialising `[1..12000]` for a
large file, makes the overwhelmingly common case a single row, and makes "fully reviewed and
unchanged" a two-column comparison. `Expand` turns it into `[{1, line_count}]` on the one path that
needs concrete ranges (an *un*mark of part of a fully-reviewed file, which is what demotes it to
`partial`).

**How it degrades, case by case — this is the "degrade sensibly" requirement, discharged:**

| What happened | What the user sees |
|---|---|
| new commits land, this file untouched | tier 0: `unchanged`, ranges carry over verbatim |
| new commits edit lines the user had reviewed | those lines' ranges are dropped by the projection (a `del` line has no image, F7); the replacing `add` lines are unreviewed, which is exactly right |
| new commits insert lines elsewhere | reviewed ranges shift by the running delta; nothing is lost |
| the branch is rebased, content identical | tier 0 again — the rewrite is invisible, which is the whole point of the blob snapshot |
| the branch is rebased *and* the file changed | tier 2 against the stored blob: an exact projection with no history involvement at all |
| the file is deleted on the branch | `currentOID == ""`; the record keeps its `reviewed`/`partial` state, the file leaves the range's file list, and the record is left for the reaper |
| the snapshot was `binary`/`tooLarge`/`absent` and the sha is gone | `deltaSource: "snapshotUnavailable"` — reviewed-on-a-date is still shown, "what changed since" is honestly reported as unavailable, `reviewedRanges` is empty |
| a range mark on a non-`text` file | `E_BAD_REQUEST` naming the path — never a silently ignored range |

**Rejected: line-content hashing.** Store a hash per reviewed line; a line is reviewed if its hash is
in the set. It survives arbitrary movement with no diff at all — and it is wrong for the single most
common line in any source file: `}`. One reviewed closing brace marks every closing brace in the file
reviewed. Anchoring the hash with k lines of context reduces but does not remove the collision, and it
introduces a tuning constant with no principled value. The projection (F7) is *exact* and reuses a
diff this phase computes anyway.

**Rejected: storing ranges in tip coordinates and re-writing them on every read.** It turns every read
into a write, which is wrong on a path a scrolling UI hits repeatedly, and it makes two windows
reading the same session fight over the same rows for no benefit.

### D11 — The reaper is a **background sweep**: one at open, then hourly, with `Purge` as G16's seam

SPEC leaves the shape open (*"background sweep vs. lazy check-on-access, mirroring G2's `Registry`
linger pattern either way"*). This picks the sweep, and the reason is not preference:

**A lazy check-on-access cannot do this reaper's job.** The population TTL exists to delete is
*sessions nobody will ever open again* — a branch that shipped, a spike that was abandoned, a
repository the user moved (F16). A check that only fires when a session is accessed is structurally
incapable of collecting exactly the rows that will never be accessed. `Registry`'s linger is a
different problem with a different shape: it governs a *live object* with a known owner and a
bounded lifetime, and its `time.AfterFunc` per entry is right for that. Rows in a file outlive every
object, so they need a sweep over the file.

```go
const IdleTTL     = 14 * 24 * time.Hour   // SPEC's own number
const sweepPeriod = time.Hour

func (s *Store) sweep(now time.Time) (removed int, err error)
// DELETE FROM review_session WHERE last_used_at < ?   (cascade takes file + range rows)
// then, when anything was removed: PRAGMA incremental_vacuum

func (s *Store) Purge(ctx context.Context, repoID, branch string) error   // <- G16's seam
```

- **One sweep at open** (inside `ensureOpen`, D3), so an app that was closed for a month reclaims
  immediately rather than an hour later.
- **A `time.Ticker` at one hour** in one goroutine per store, stopped and joined by `Close`. Not
  `AfterFunc`-per-session: there is no per-session object to hang a timer on, and a single ticker over
  one `DELETE … WHERE last_used_at < ?` is cheaper than N timers regardless.
- **`last_used_at` is touched by every one of the three methods**, but **only for a session row that
  already exists**. A session row is created *only* by the first `review.mark` — listing a branch's
  files is not reviewing it, and a row per branch anyone ever glanced at would be a leak the TTL then
  has to clean up.
- **`Purge` is the seam, not the ticker.** The sweep calls `Purge` per expired session (or the single
  bulk `DELETE`, which is the same statement); G16 calls `Purge(ctx, repoID, branch)` from its
  PR-closed handler. G16 wires into an existing exported method rather than rebuilding a lifecycle —
  SPEC's own "with a seam G16 can hook rather than rebuild".
- **`_auto_vacuum=INCREMENTAL` (D4) is what makes the reclaim real.** Without it a purge frees pages
  into a file that never shrinks, which for a blob store is most of the point of the TTL.

### D12 — Concurrency: one process, one `*sql.DB` at `MaxOpenConns(1)`, one keyed mutex per `(session, path)`

Resolving SPEC's flagged concern (*"two review sessions in different `Conn`s touching the same repo …
is G11's own planning concern, not fixed here"*).

**The state is shared, not per-connection, and that is the correct reading of SPEC §6's split rule.**
"I have reviewed `src/foo.ts` on branch `feature`" is a fact about the repository and the person, not
about which window they were looking at. Two windows on the same branch see the same reviewed marks,
immediately. The `Store` therefore hangs off the `Registry` (D3), not off `Conn`, and `Conn` gains
nothing at all in this phase.

Three layers, each doing one thing:

1. **Cross-process: there is only one writer.** SPEC §3.2's `flock` decides which instance serves, and
   D3's lazy open means a non-serving instance never opens the file. Cross-process contention on
   `review.db` is therefore out of scope *by construction*; `_busy_timeout=5000` and WAL remain in the
   DSN as belt and braces for a hand-off after a crash, not as a design assumption.
2. **Cross-statement: `SetMaxOpenConns(1)`**, `storage/db.go`'s own posture and its own stated reason
   ("serialising every statement onto one connection removes the `SQLITE_BUSY` class of bug entirely
   at no measurable cost"). Every write is a single explicit transaction.
3. **Cross-*operation*: a keyed mutex.** `review.mark` is a read-modify-write whose "modify" step runs
   git (the delta selection and the re-snapshot read) *outside* any transaction. Two concurrent marks
   on the same file would both project from the same old record and the second would overwrite the
   first's ranges. `Store` therefore holds a `map[string]*sync.Mutex` keyed by
   `repoID + "\x00" + branch + "\x00" + path`, taken for the whole of `review.mark`'s
   read-diff-write and released at the end, with the map entry refcounted so it does not grow without
   bound. Concurrent marks on *different* files never contend.

**Rejected: an optimistic `revision` column with a compare-and-set retry.** It is the right answer when
the writers are in different processes; here they are goroutines in one process, so an in-process lock
is both simpler and strictly stronger (it also serialises the *git* work, not just the write). The
keyed mutex is ~25 lines including its refcount; the CAS is fewer lines but needs a retry loop that
re-runs the whole delta selection, and a second failure would have to become an error the UI renders.

**Reads take no lock.** `review.files` and `review.fileDiff` read a consistent snapshot from one
SQLite transaction; a mark landing mid-read means the reader sees either the old or the new record,
both of which are correct answers to "what is reviewed right now".

### D13 — The three wire methods, in full

All three are `E_BAD_REQUEST` on a missing/empty `repoId`, `branch` or `path`, and all three run
`validRefArg` (G6 D8, `gitrpc/review.go:18-26`) on `branch` and `base` — the same guard, at the same
entrance, for the same reason.

```ts
/** 1-based, inclusive, both ends. Always new-side (branch-tip) line numbers on the wire. */
export interface LineRange { readonly start: number; readonly end: number }

export interface ReviewFileStatus {
  readonly kind: 'none' | 'partial' | 'full';
  /** The branch tip's content for this path differs from the snapshot the state was recorded
   *  against. Always false for 'none'. */
  readonly changedSinceReview: boolean;
  readonly reviewedAt: number | undefined;      // unix millis
  readonly reviewedAtSha: string | undefined;
}

export interface ReviewFileEntry {
  readonly change: FileChange;                  // G4's own type, unchanged
  readonly review: ReviewFileStatus;
}

/** Which mechanism answered "what changed since the snapshot" (G11 D7). Reported even in
 *  `mode: "range"`, because it is also what produced `reviewedRanges`' own projection. */
export type ReviewDeltaSource =
  | 'noSnapshot'            // never reviewed — the delta IS the whole range diff
  | 'unchanged'             // blob oid equality: nothing changed, no diff ran
  | 'fast'                  // the snapshot commit is still an ancestor; an ordinary git diff ran
  | 'slow'                  // history was rewritten; the stored blob was diffed with --no-index
  | 'snapshotUnavailable';  // reviewed, but no content was stored and the sha no longer resolves

export type ReviewDiffMode = 'range' | 'sinceReview';
```

| Method | Params | Result |
|---|---|---|
| `review.files` | `{repoId, branch, base}` | `{branchTip: string, mergeBase: string, files: readonly ReviewFileEntry[]}` |
| `review.fileDiff` | `{repoId, branch, base, path, mode: ReviewDiffMode}` | `{path, deltaSource: ReviewDeltaSource, body: FileDiffBody, reviewedRanges: readonly LineRange[], lineCount: number, reviewedAtSha: string \| null}` |
| `review.mark` | `{repoId, branch, path, reviewed: boolean, ranges?: readonly LineRange[]}` | `{review: ReviewFileStatus}` |

Notes that are decisions, not descriptions:

- **`review.files` refuses an unrelated pair** with `E_BAD_REQUEST` naming both refs. `review.resolveBase`
  already answers `unrelated` before the view would ever call this, so the refusal is a guard against a
  raw socket client, not a state the UI can reach.
- **`review.fileDiff` runs the delta selection in *both* modes**, because `reviewedRanges` needs the
  projection either way. `mode` decides only which patch becomes `body`: the range diff
  (`<mergeBase>..<branchTip>`, cached in `RepoEntry.diff`) or the delta. `deltaSource` therefore always
  describes the projection, never the body — which is why it has no `'range'` member.
- **`deltaSource: 'noSnapshot'` returns the range diff as `body` even in `sinceReview` mode.** "What
  changed since you last reviewed" when you never reviewed it *is* the whole range diff; returning an
  empty body there would be a lie dressed as a degradation.
- **`review.mark` returns the resulting status**, so the file list updates from the response rather than
  re-requesting `review.files` after every checkbox.
- **`review.mark` takes no `base`** (D5).
- **A ranged mark on a non-`text` snapshot is `E_BAD_REQUEST`**, naming the path and the reason.

### D14 — `gitsession` gains one file and two fields; `Conn`, `Walk` and `walkPair` are untouched

| Change | Detail |
|---|---|
| `registry.go` | `Registry.Review *gitreview.Store`, defaulted in `NewRegistry` to `gitreview.NewStore(gitreview.DefaultPath())` (D3); `Close()` closes it |
| `entry.go` | `RepoEntry.review *gitreview.Store`, threaded by `newRepoEntry` from `Registry.Review` — the same shape `settings` already has (`entry.go:85-104`) |
| `review.go` | `sharesHistory` becomes a thin wrapper over the new `mergeBase` (D6); `ResolveReviewBase`'s behaviour is byte-identical |
| `incremental.go` (new) | `RangeFiles`, `FileDelta`, `MarkFile` — the three orchestrations §3.3 details |

**Nothing else in `gitsession` changes.** In particular `Conn`, `walkPair`, `Walk`, `markWalksStale`,
the subscriber and `note()`'s cache drops are untouched: review state is not a cache of a git read, it
is durable user intent, and a `refsChanged` must **not** drop it. That absence is deliberate and is a
checklist item (§7.3) — the reflex when adding state to `RepoEntry` in this codebase is to drop it in
`note()`, and here that reflex would delete the user's work.

### D15 — Results are size-guarded exactly as `commit.fileDiff` already is

`review.fileDiff` inherits G4 D2(b)'s marshal-once / check `MaxResultBytes` / replace-body-with-
`tooLarge` / re-marshal shape verbatim (`gitrpc/detail.go:79-108`) — the body is the same
`FileDiffBody` union, so the same `{kind: "tooLarge", bytes, limitBytes}` arm applies with no new type.

`review.files` gets the same *check* with a different remedy: a file list has no `tooLarge` arm, so an
over-cap list is a `E_TOO_LARGE`-shaped `ipcerr` naming the file count. In practice this is
unreachable — a `FileChange` plus a `ReviewFileStatus` is well under 300 bytes and `MaxResultBytes`
is measured in megabytes — but "unreachable" is not "unhandled".

### D16 — The UI addition: a **Files** pane in the review sidebar, composed from `FileTree.vue` and `DiffView.vue`

Resolving F10/F11, and the one place this phase adds to `packages/git-ui` — which SPEC otherwise
freezes (*"Unchanged. No redesign … the existing webview UI is the frontend, as-is"*).

**Why an addition is unavoidable here, in one sentence:** the feature's whole motivating case is a
rewritten history, after which every row in the existing Commits list is a commit the user has never
seen, so a per-commit surface cannot express "which of this branch's files have I already read"
(F10). The prompt for this plan asks for exactly this to be said explicitly, and it is.

**Why this is an addition and not a redesign, concretely:**

| Piece | Size |
|---|---|
| `ReviewView.vue` — a two-button segmented control in the **existing** `kv-review-header`, and a `v-else` branch in the **existing** `kv-review-body` | ~20 lines of template, no restructuring |
| `ReviewFilesPane.vue` — **new**, and the *only* new component | composes `FileTree.vue` + `DiffView.vue` in exactly `DetailPane.vue`'s own shape (diff when a file is open, tree otherwise) |
| `FileTree.vue` | **one optional prop** (`reviewStates?: ReadonlyMap<string, ReviewFileStatus>`) and one optional emit (`toggleReviewed`), rendering a checkbox in the same slot the existing capability-gated copy button already occupies (F11). Absent prop ⇒ byte-identical behaviour, so `DetailPane.vue`'s use is provably unaffected |
| `DiffView.vue` | **one optional prop** (`review?: ReviewDiffAdornment`) carrying `reviewedRanges`, a `selectionAnchor` and two callbacks. When present: reviewed new-side rows get a gutter mark, shift-click extends a selection from `focusedRow` (which already exists, `:79`/`:250`), and two more buttons appear in the **existing** header row beside "Open in editor"/"Go to file" |
| `state/reviewFiles.ts` | **new** — the pane's own state object, `DetailState`'s sibling: the file list, the selected file, the diff, the mode toggle, supersede-and-verify on every request |
| `App.vue` | **unchanged** |

**No new rendering primitive, no native VS Code surface, no second diff implementation.** Every pixel
is a `FileTree` row or a `DiffView` row that already existed; what is new is a checkbox, a gutter mark,
two header buttons and a tab.

**Range selection is the existing cursor, extended.** `DiffView.vue` already tracks `focusedRow` and
sets it on any row click. Shift-click sets `[min(anchor, index), max(anchor, index)]`; the two header
buttons ("Mark reviewed" / "Mark unreviewed") apply to the selection when there is one and to the whole
file when there is not. That is the per-range **and** per-file toggle SPEC asks for, in one control
each, with no new interaction model to learn.

**Rejected: reviewed checkboxes on the per-commit file trees too.** Reviewed state is per-`(branch,
path)`; a commit's tree shows one commit's subset of paths, so a checkbox there would silently mean
something different from the same checkbox one pane over. `FileTree.vue`'s prop is optional precisely
so the commit path keeps rendering exactly what it renders today.

**Rejected: a third webview view.** The chapter registers two (`kiraVersion.graph`,
`kiraVersion.review`) and G6's own hand-forward says "`apps/kira-studio-vscode` registers no further
views in this chapter". A tab inside the view that already exists is the smaller change and the one
the user's mental model already has.

### D17 — One palette command, and `reviewView.ts` learns to receive `ui.action`

Resolving F13 and discharging SPEC's G10 obligation for this phase.

- `commands.ts`'s `OTHER_COMMANDS` gains one entry:
  `{ command: 'kiraVersion.toggleFileReviewed', title: 'Toggle File Reviewed' }`.
- `UiActionKind` gains `'toggleFileReviewed'` (D1) — the *only* contract change the UI half of this
  phase makes.
- `reviewView.ts` gains `runUiAction(action: UiActionKind)`, a ~10-line mirror of
  `panelView.ts:78-86`: reveal the view, then `this.#server?.emit('ui.action', { action })`.
- `ReviewView.vue` subscribes to `ui.action` (as `App.vue:631` already does) and, for
  `'toggleFileReviewed'`, toggles the file currently open in the Files pane — announcing "Open a file
  in the Files tab first." through the existing live region when there is none.

`MUTATING_COMMANDS` does **not** change: G11 adds no `OpRequest`/`RemoteOpParams` kind, and
`commands.test.ts`'s cross-check against Go's `opTable`/`RunRemote` switch is therefore expected to
pass untouched. It *will* need its `OTHER_COMMANDS` ↔ `package.json` assertion to see the new entry,
which is the test doing its job.

### D18 — What gets a test, and what does not

`AGENTS.md`'s bar, applied honestly. **Tested:**

- **`gitreview.ProjectRanges`** (`project_test.go`) — F7's arithmetic. A table over: a range entirely
  before every hunk (identity); entirely after (shifted by the total delta); spanning a hunk;
  containing only deleted lines (drops out entirely); containing only added lines (impossible as
  input, asserted as a no-op); a hunk at line 1; a hunk at EOF; two hunks with opposite-sign deltas;
  an empty hunk list (identity); and a range that runs past `newLineCount` (clamped). *"Cursor/
  pagination boundary arithmetic"* is `AGENTS.md`'s own named category.
- **`gitreview` range algebra** (`ranges_test.go`) — `Normalize`/`Union`/`Subtract`/`Expand` over
  adjacent, overlapping, touching, contained, disjoint and reversed inputs. Interval-set arithmetic
  with several interacting rules; the same category.
- **The three-tier selection** (`gitsession/incremental_test.go`) — D7's decision structure, over a real
  fixture repository built with `fixtureEnv()`: `unchanged` after unrelated commits land;
  `fast` after a normal commit edits the file; `slow` after `git commit --amend` (F4/P2: the sha is
  unreachable but present); `slow` after the snapshot commit is genuinely pruned
  (`reflog expire --expire=now --all && gc --prune=now`, giving exit 128); `snapshotUnavailable` for a
  binary snapshot whose sha was rewritten; and `noSnapshot` for a file with no record. **This is D7's
  whole correctness claim** and `AGENTS.md`'s "a decision structure too large to hold in your head",
  named explicitly by this plan's own prompt.
- **`gitreview.Store` round-trip and reaper** (`store_test.go`) — mark → read back → re-mark
  (replacement, not accumulation) → unmark-a-sub-range (demotes `full` to `partial`) → `Purge`
  cascades file and range rows → `sweep` deletes only sessions past `IdleTTL` and leaves the rest.
  Cache/eviction with interacting rules, plus the one place the FK cascade is load-bearing (D4).
- **`gitsock` integration** (§3.6) — the three methods over a real socket against real repositories.
  **The phase's real end-to-end proof.**

**Not tested, deliberately:** `NoIndexDiffArgs`/`IsAncestorArgs` (literal slices —
`AGENTS.md`'s "constructors/builders"; both are exercised for real by the integration tier), the flate
encode/decode round trip (`AGENTS.md`'s "format round-trips with no edge case" — the one real edge, a
length mismatch, is a single `if` in the decoder), `gitrpc`'s three handlers (thin dispatch; their
refusals are asserted once each in integration), `migrate.go` (a structural copy of a runner
`storage/migrations/*_test.go` already covers, and its one interesting branch — refusing a newer
schema — is one comparison), and every TypeScript change (`typecheck:git` plus §7.2's macOS script).

**No golden corpus entries.** G3 D15's fixture mechanism exists for *formats* — multi-field,
multi-framing output where a parser can silently misread a byte. This phase adds no parser: it reuses
`ParseFileDiffBody`, `ParseNumstatRecords` and `ParseNameStatusRecords` unchanged, and the one new
output shape (`--no-index`'s) is proven to go through the existing parser by probes P3–P5 and by the
integration tier.

### D19 — `gitrpc` stays thin dispatch, in one new file and three edited lines

`incremental.go` holds the three handlers: decode, validate (`repoId`/`branch`/`path` non-empty,
`validRefArg` on `branch`/`base`), `entryFor`, one `RepoEntry` call, marshal (with D15's size guard on
two of them). `handlers.go` gains three cases. `wire.go` gains three param structs. `contract.go` goes
to 18. No handler in this phase computes anything.

### D20 — G16's hook, named precisely so it is not rebuilt

SPEC: *"Eager purge on PR closed/merged is G16's own small addition once `branch.resolvePr` exists,
wired into G11's reaper rather than duplicating it."*

The hook is **`(*gitreview.Store).Purge(ctx context.Context, repoID, branch string) error`** — exported
in this phase, called by this phase's own sweep, and doing exactly what G16 needs: one
`DELETE FROM review_session WHERE repo_id = ? AND branch = ?`, with the file and range rows following
through the FK cascade, followed by the same `PRAGMA incremental_vacuum` the sweep runs. G16 adds a
caller and nothing else. Recorded in §10 so a G16 that writes its own delete has gone wrong.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/internal/`.

### 3.1 `gitreview/` — the new half of the package (D2, D3, D4, D9, D10, D11, D12)

| File | Contents |
|---|---|
| `db.go` | `DefaultPath()`; `buildDSN(path)` (D4's six pragmas); `(*Store).ensureOpen()` — `config.EnsureLayout`, `sql.Open("sqlite", …)`, `SetMaxOpenConns(1)`, `Ping`, `os.Chmod(path, 0o600)` **after** the Ping (`storage/db.go:77-90`'s own recorded ordering trap), `migrate()`, one `sweep`, then `go s.reap()`. Guarded so a failure is returned and retried on the next call, never memoised |
| `migrate.go` | `schema_version`, seed 0, refuse-a-newer-version, one transaction per step — `storage/migrate.go`'s runner over this package's own steps |
| `migrations/embed.go` | `//go:embed *.sql`, `Migration{Version, Name, SQL}`, the hand-ordered `names` slice: `{1, "g11_review", "0001_g11_review.sql"}` |
| `migrations/0001_g11_review.sql` | §3.1.1 |
| `store.go` | `Store`, `NewStore(path string) *Store`, `Close() error`; the keyed mutex (D12); and the record API below |
| `snapshot.go` | `ContentKind` (`text`/`binary`/`tooLarge`/`absent`), `MaxSnapshotBytes = 1 << 20`, `Compress([]byte) ([]byte, error)` / `Decompress(b []byte, want int) ([]byte, error)` over `compress/flate` at `BestCompression`, with the length check D9 requires |
| `ranges.go` | `LineRange{Start, End int}` (1-based, inclusive), `Normalize`, `Union`, `Subtract`, `Expand(lineCount int) []LineRange`, `CountLines([]LineRange) int` |
| `project.go` | `ProjectRanges(ranges []LineRange, hunks []porcelain.DiffHunk, newLineCount int) []LineRange` — F7's algorithm |
| `reaper.go` | `IdleTTL`, `sweepPeriod`, `(*Store).sweep(now)`, `(*Store).Purge(ctx, repoID, branch)`, the ticker goroutine and its `done` channel |

The store's record API, which is the whole of what `gitsession` calls:

```go
type FileRecord struct {
    Path          string
    State         string          // "full" | "partial"
    ReviewedAtSHA string
    ReviewedAt    time.Time
    BlobOID       string
    ContentKind   ContentKind
    ContentBytes  int
    LineCount     int
    Ranges        []LineRange     // snapshot coordinates (D10's invariant); empty when State=="full"
}

// Records returns every record for (repoID, branch), keyed by path, WITHOUT reading the content
// column — the list path (review.files) never needs a snapshot's bytes, and a query that selects
// the BLOB would read megabytes to answer a question about oids.
func (s *Store) Records(ctx context.Context, repoID, branch string) (map[string]FileRecord, error)

// Record returns one path's record, and its decompressed content when ContentKind is "text".
func (s *Store) Record(ctx context.Context, repoID, branch, path string) (FileRecord, []byte, bool, error)

// Put replaces one path's record and its ranges in one transaction, creating the session row if
// this is its first record, and touching last_used_at either way.
func (s *Store) Put(ctx context.Context, repoID, branch string, rec FileRecord, content []byte) error

// Delete removes one path's record (and its ranges, by cascade). The session row is left alone —
// an empty session is the reaper's business, not this call's.
func (s *Store) Delete(ctx context.Context, repoID, branch, path string) error

// Touch bumps last_used_at for an EXISTING session only (D11) — never creates one.
func (s *Store) Touch(ctx context.Context, repoID, branch string) error

// Lock takes the per-(session, path) mutex (D12). The returned func releases it.
func (s *Store) Lock(repoID, branch, path string) func()
```

#### 3.1.1 `0001_g11_review.sql`

```sql
CREATE TABLE review_session (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id      TEXT    NOT NULL,
  branch       TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,          -- unix millis
  last_used_at INTEGER NOT NULL,          -- unix millis; the reaper's own clock (D11)
  UNIQUE (repo_id, branch)
);

-- The reaper's whole query is `WHERE last_used_at < ?`, so it gets its own index rather than a
-- full scan of a table that grows one row per reviewed branch.
CREATE INDEX review_session_last_used ON review_session (last_used_at);

CREATE TABLE review_file (
  session_id      INTEGER NOT NULL REFERENCES review_session(id) ON DELETE CASCADE,
  path            TEXT    NOT NULL,
  state           TEXT    NOT NULL,       -- 'full' | 'partial'
  reviewed_at_sha TEXT    NOT NULL,       -- the commit the snapshot was taken at
  reviewed_at     INTEGER NOT NULL,       -- unix millis
  blob_oid        TEXT    NOT NULL,       -- git's own oid; '' when content_kind = 'absent'
  content_kind    TEXT    NOT NULL,       -- 'text' | 'binary' | 'tooLarge' | 'absent'
  content_bytes   INTEGER NOT NULL,       -- UNCOMPRESSED length; the decoder's own length check
  line_count      INTEGER NOT NULL,       -- text only; 0 otherwise
  content         BLOB,                   -- flate(raw); NULL unless content_kind = 'text'
  PRIMARY KEY (session_id, path)
);

CREATE TABLE review_range (
  session_id INTEGER NOT NULL,
  path       TEXT    NOT NULL,
  start_line INTEGER NOT NULL,            -- 1-based, inclusive, in the SNAPSHOT's coordinates
  end_line   INTEGER NOT NULL,            -- inclusive
  PRIMARY KEY (session_id, path, start_line),
  FOREIGN KEY (session_id, path) REFERENCES review_file(session_id, path) ON DELETE CASCADE
);
```

Four notes, each a decision rather than a transcription:

- **No `WITHOUT ROWID` on `review_file`**, despite its composite primary key: a `WITHOUT ROWID` table
  stores whole rows inside the index B-tree, which is exactly the wrong place for a megabyte BLOB.
- **`content` is a separate column, and every query that does not need it does not select it**
  (`Records`, above). SQLite reads a row's overflow pages only for columns actually requested.
- **The FK cascade is load-bearing**, which is why `_foreign_keys=1` is in the DSN (D4): `Purge` and
  the sweep are one `DELETE FROM review_session` each.
- **Times are unix millis**, matching `storage/model/time.go`'s convention and the wire's own
  `reviewedAt`.

### 3.2 `gitclient/porcelain/review.go` — edited (D6, D8)

| Export | Contents |
|---|---|
| `MergeBaseArgs(a, b string) []string` | **unchanged** (`porcelain/review.go:12-14`). Listed only to record that D6 adds a second *caller* — one that reads the sha `sharesHistory` discards — rather than a second builder |
| `IsAncestorArgs(ancestor, descendant string) []string` | `merge-base --is-ancestor <ancestor> <descendant>` — new; probe P1's three exit codes are the caller's concern |
| `NoIndexDiffArgs(oldPath, newPath string) []string` | `diff --no-index --no-color --no-ext-diff --no-textconv --unified=3 -- <oldPath> <newPath>` — new. No `-z` (there is no path list to frame, and `ParseFileDiffBody` splits on LF); no `--no-optional-locks` (`buildArgv` places it at git level for every `ReadOnly` spec); both paths after `--` (D8) |

### 3.3 `gitsession/incremental.go` — new (D6, D7, D8, D10, D12, D14)

| Symbol | Contents |
|---|---|
| `(*RepoEntry).mergeBase(ctx, base, branch) (string, bool, error)` | D6. `runAllowingExit(…, 0, 1)`; exit 1 ⇒ `("", false, nil)` |
| `(*RepoEntry).branchTip(ctx, branch) (string, error)` | `Refs(ctx)` → `findBranchRef` → `RefRow.ObjectID`; a branch not in the snapshot is `ErrBranchNotFound` (a new sentinel `gitrpc` maps to `E_BAD_REQUEST`, alongside G4's own three in `mapDetailError`) |
| `(*RepoEntry).RangeFiles(ctx, base, branch string) (RangeFilesResult, error)` | D6's two concurrent `diff-tree` spawns + `CombineFileChanges`; then `review.Records` once; then, **only for paths that have a record**, one `CatFile().Check("<tip>:<path>")` each to set `changedSinceReview` (D7 tier 0); then `Touch` |
| `(*RepoEntry).FileDelta(ctx, branch, path string, rec gitreview.FileRecord, snapshot []byte, tip string) (deltaResult, error)` | **D7's three tiers, verbatim.** Returns `{Source, Hunks, Body, CurrentOID, CurrentLineCount}`. The one function `gitsession/incremental_test.go` drives directly |
| `(*RepoEntry).ReviewFileDiff(ctx, base, branch, path, mode string) (ReviewFileDiffResult, error)` | reads the record, calls `FileDelta`, calls `gitreview.ProjectRanges`, then picks `body` by mode — `mode == "range"` re-uses `FileDiffArgs(&mergeBase, tip, path, orig)` through the **existing** `RepoEntry.diff` cache (keyed `(mergeBase, tip, path)`, F2) |
| `(*RepoEntry).MarkFile(ctx, branch, path string, reviewed bool, ranges []gitreview.LineRange) (gitreview.FileRecord, error)` | D10's five steps, entirely inside `Store.Lock(repoID, branch, path)` (D12) |
| `(*RepoEntry).readSnapshotSource(ctx, tip, path)` | one `CatFile().Read("<tip>:<path>")`, classifying `ErrMissing` → `absent`, `ErrTooLarge`/over-cap → `tooLarge`, `looksBinary` → `binary`, else `text` + a line count |

`RangeFilesResult` and `ReviewFileDiffResult` are this file's own wire-shaped structs, JSON-tagged the
same way `FileDiffResult`/`BlobResult`/`GoToTarget` already are in `queries.go` — `gitrpc` marshals
them without a translation layer, D19's "thin dispatch" made structural.

### 3.4 `gitsession/{registry,entry,review}.go` — edited (D6, D14)

- `registry.go`: the `Review *gitreview.Store` field, its default in `NewRegistry`, and its `Close()`.
- `entry.go`: `RepoEntry.review`, set by `newRepoEntry`. **`note()` and `invalidateAfterWrite()` are
  not touched** — D14's own point, and §7.3's checklist line.
- `review.go`: `sharesHistory` becomes `_, ok, err := e.mergeBase(...)`. Its callers and its behaviour
  do not change.

### 3.5 `gitrpc/` — edited (D1, D13, D15, D19)

| File | Change |
|---|---|
| `contract.go` | `ContractVersion` 17 → **18**, with the same one-paragraph "what moved and why" note G7's and G10's own bumps carry |
| `wire.go` | `ReviewFilesParams`, `ReviewFileDiffParams`, `ReviewMarkParams` |
| `incremental.go` (new) | the three handlers; `mapDetailError` gains an arm for `gitsession.ErrBranchNotFound` |
| `handlers.go` | three new cases |

### 3.6 `gitsock/incremental_test.go` — new, integration (D18)

Uses the existing harness (`newIntegrationServer`, `pairAndReady`, `openRepoOK`, `requestOK`,
`unmarshalResult`) over a fixture repository built with `fixtureEnv()` and a `Registry.Review` pointed
at `t.TempDir()`:

- **`TestIntegration_ReviewFilesIsTheThreeDotRange`** — the returned paths **equal**
  `git diff --name-only $(git merge-base main feature) feature`, and a file deleted *on `main`* after
  the divergence is **absent** (F3/probe P7). Asserted against git itself, not against a fixture we
  wrote.
- **`TestIntegration_MarkThenNothingChanges`** — mark a file, land an unrelated commit on the branch,
  re-list: `kind: "full"`, `changedSinceReview: false`; `review.fileDiff` reports
  `deltaSource: "unchanged"` with an `empty` body and **no** `git diff` spawn (asserted through a
  counting `Runner`, the seam `newIntegrationServerWithRunner` already provides).
- **`TestIntegration_MarkThenEditTakesTheFastPath`** — edit the file, commit: `changedSinceReview:
  true`, `deltaSource: "fast"`, and the hunks match `git diff <markSha> feature -- <path>`.
- **`TestIntegration_MarkThenAmendTakesTheSlowPath`** — `git commit --amend` after the mark:
  `deltaSource: "slow"`, and the hunks are still exactly right. **This is the case SPEC exists for.**
- **`TestIntegration_MarkThenPruneStillTakesTheSlowPath`** — `reflog expire --expire=now --all` +
  `gc --prune=now` so the snapshot sha is genuinely gone (probe P1's exit 128): still `"slow"`, still
  correct.
- **`TestIntegration_PartialRangesSurviveAnInsertion`** — mark lines 10–20, insert five lines above
  them, re-read: `reviewedRanges` is `[{15,25}]`. **D10's whole claim, over the socket.**
- **`TestIntegration_UnmarkingPartOfAFullFileDemotesIt`** — `full` → unmark `[5,7]` → `partial`, with
  the complement returned.
- **`TestIntegration_BinarySnapshotDegradesHonestly`** — a binary file marked reviewed, then amended:
  `deltaSource: "snapshotUnavailable"`, `reviewedRanges: []`, and a ranged mark on it is
  `E_BAD_REQUEST`.
- **`TestIntegration_TwoConnectionsShareReviewState`** — two clients, one repository, one branch: a
  mark on connection A is visible in connection B's next `review.files`. **D12's shared-state claim.**
- **`TestIntegration_ReviewRefusalsAreBadRequests`** — an empty `path`, a `branch` beginning with `-`,
  an unrelated `base`, and a `branch` not in the ref snapshot: each `E_BAD_REQUEST` naming the field,
  never a spawn.
- **`TestIntegration_RefsChangedDoesNotDropReviewState`** — force-move an unrelated branch, wait for
  `repo.changed`, re-list: every mark is still there. **D14's negative claim, which is the one a
  future contributor is most likely to break.**

### 3.7 `main.go`

**Unchanged** (D3): `Registry.Review` defaults itself, and `Registry.Close()` — already reached through
`gitsock.Server.Close()` — closes it.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ipc` — three keys, five types, one constant (D1, D13)

- `contract.ts`: `LineRange`, `ReviewFileStatus`, `ReviewFileEntry`, `ReviewDeltaSource`,
  `ReviewDiffMode`; the three `Contract["requests"]` entries; `'toggleFileReviewed'` on
  `UiActionKind`.
- `validate.ts`: three `REQUEST_KEY_MAP` entries (the mapped-type totality check makes a forgotten one
  a compile error, `validate.ts:48-61`'s own note) and `CONTRACT_VERSION = 18`.
- Nothing else: no event, no stream, no codec, no schema, no generated code.

### 4.2 `packages/git-ui` — the Files pane (D16)

| File | Change |
|---|---|
| `state/reviewFiles.ts` | **new.** `ReviewFilesState`: `files`, `selectedPath`, `diff`, `diffMode`, `reviewedRanges`, `deltaSource`, `pending`; `load()`, `selectFile()`, `setDiffMode()`, `mark(path, reviewed, ranges?)`. Supersede-and-verify on every request, `DetailState`'s own discipline (`state/detail.ts`), and an `AbortController` per in-flight call |
| `components/review/ReviewFilesPane.vue` | **new**, and the only new component: `DetailPane.vue`'s shape over `ReviewFilesState` — `DiffView` when a file is open, `FileTree` otherwise |
| `components/FileTree.vue` | one optional prop `reviewStates?: ReadonlyMap<string, ReviewFileStatus>`, one optional emit `toggleReviewed(path)`, one checkbox rendered in the row's existing trailing-control slot. **Absent prop ⇒ no visual or behavioural change**, which is what keeps `DetailPane.vue` provably unaffected |
| `components/DiffView.vue` | one optional prop `review?: {reviewedRanges, onMark(ranges, reviewed), onToggleMode}`; shift-click range selection anchored on the existing `focusedRow`; a gutter mark on reviewed new-side rows; two more buttons in the existing header |
| `components/review/ReviewView.vue` | a `Commits`/`Files` segmented control in the existing header; a `v-else` arm rendering `ReviewFilesPane`; a `bridge.on('ui.action', …)` subscription for `'toggleFileReviewed'` (D17) |
| `state/review.ts` | one field: the pane the view is showing, so `setTarget`/`setBase` reset it alongside everything else they already reset |

`packages/git-core` is **not touched**: nothing in this phase is lane layout, a wire model, a port, or
a client-side search half.

### 4.3 `apps/kira-studio-vscode` (D17)

- `src/commands.ts`: one `OTHER_COMMANDS` entry.
- `package.json#contributes.commands`: the matching entry, category "Kira Version".
- `src/reviewView.ts`: `runUiAction`, a mirror of `panelView.ts:78-86`.
- `src/extension.ts`: one `otherCommandHandlers` entry — `extension.ts:183-186` already registers
  everything in `OTHER_COMMANDS` from the table.
- `src/proxyHandlers.ts`: the three new methods **forward verbatim**. None is a host capability; the
  seventh and last of those was closed by G6 D13 and this phase adds no eighth.

### 4.4 `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts`

`CONTRACT_VERSION = 18` (F14) — named here rather than left to be discovered, because two earlier
phases needed a follow-up commit for exactly this mirror.

---

## 5. Dependencies and tooling

**No new dependency, in either language.** `compress/flate`, `database/sql`, `embed`, `os`,
`path/filepath`, `sync`, `time` are stdlib; `modernc.org/sqlite` is already a direct require
(`storage/db.go:12`) and stays cgo-free on every platform, so `AGENTS.md`'s fast Linux loop is
unaffected. No FlatBuffers schema change, so `bun run generate:wire` is not run.

**`go.mod`, `go.sum` and `bun.lock` are expected to be byte-identical after this phase.** A diff in any
of them is a signal something was reached for that this plan did not sanction.

`AGENTS.md`'s licence bar therefore has nothing new to check at the package or the feature level — the
one library involved (`modernc.org/sqlite`) was already checked when `internal/storage` and the sqlite
adapter adopted it.

---

## 6. Implementation order

Eight commits. `go build ./apps/kira-studio/internal/...`, `bun run lint` and `bun run typecheck` run
after **each** — they are fast. The expensive tier (§7.1(e)–(h)) runs once at C8, per `AGENTS.md`'s
"implement the whole plan first, then test once".

- **C1** `feat(gitreview): line-range algebra and the snapshot-to-current projection`
  — `ranges.go`, `project.go` and both table tests (D10, F7, D18). Pure; depends on nothing but
  `porcelain.DiffHunk`. **Landing this first means the phase's two hardest pieces of arithmetic are
  green before anything can hide a bug in them.**
- **C2** `feat(gitreview): review.db — schema, migrations, and the compressed snapshot store`
  — `db.go`, `migrate.go`, `migrations/`, `snapshot.go`, `store.go`, `store_test.go` (D2–D4, D9, D12).
  No caller yet.
- **C3** `feat(gitreview): the 14-day idle reaper and its Purge seam`
  — `reaper.go` and its half of `store_test.go` (D11, D20). Depends on C2.
- **C4** `feat(gitclient): --no-index and --is-ancestor argv`
  — §3.2 (D6, D8). Three builders, no callers yet.
- **C5** `feat(gitsession): the three-tier "changed since you reviewed" selection`
  — `incremental.go` + the `Registry`/`RepoEntry` seams + `sharesHistory`'s reshape into `mergeBase`,
  with `incremental_test.go` (D6, D7, D10, D12, D14, D18). Depends on C1–C4. **This is the phase's
  centre; it should be one agent's continuous piece of work.**
- **C6** `feat(git): serve review.files/fileDiff/mark, and bump the contract to 18`
  — §3.5 + §4.1 + §4.4 (D1, D13, D15, D19). All three `CONTRACT_VERSION` mirrors move here.
- **C7** `feat(git-ui): a Files pane in the review view, with per-file and per-range reviewed marks`
  — §4.2 + §4.3 (D16, D17).
- **C8** `test(git): incremental review end to end`
  — §3.6 in full, then the full §7.1 run.

Dependency order: C1 and C2 before C3 and C5; C4 before C5; C5 before C6; C6 before C7; everything
before C8. C1, C2 and C4 are mutually independent.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 Tier 1 — provable here, automatically, and expected green

**Scoped per SPEC's "Full verification scope, 2026-09-07" note**, not the whole `internal/` tree: this
phase's git packages plus the layering test, and nothing else.

**(a) The scoped race run, once, at C8** — the note's own list, plus `gitreview` (added to it by G6)
and `gitvsix` (added by G10):

```
go test -race \
  ./apps/kira-studio/internal/gitclient/... \
  ./apps/kira-studio/internal/gitpreflight/... \
  ./apps/kira-studio/internal/gitops/... \
  ./apps/kira-studio/internal/gitreview/... \
  ./apps/kira-studio/internal/gitsession/... \
  ./apps/kira-studio/internal/gitrpc/... \
  ./apps/kira-studio/internal/gitsock/... \
  ./apps/kira-studio/internal/gitstore/... \
  ./apps/kira-studio/internal/gitwire/... \
  ./apps/kira-studio/internal/gitvsix/... \
  ./apps/kira-studio/internal/bridge/... \
  ./apps/kira-studio/internal/
```

`-race` matters more than usual this phase: the reaper's ticker, `Store`'s keyed mutex and the two
concurrent `diff-tree` spawns in `RangeFiles` are three genuinely concurrent additions.

**(b) `go test ./apps/kira-studio/internal/gitreview/...`** — D18's three suites: the projection
table, the range algebra, and the store/reaper round trip against a real `review.db` under
`t.TempDir()`. No git, no repository, no network.

**(c) `go test ./apps/kira-studio/internal/gitsession/...`** — `incremental_test.go`'s six selection
scenarios against real fixture repositories, including the pruned-object one
(`reflog expire --expire=now --all && gc --prune=now`). **This is D7's whole correctness claim.**

**(d) `go test ./apps/kira-studio/internal/gitsock/`** — §3.6's eleven integration tests over a real
socket. **The phase's real end-to-end proof on the Go side.**

**(e) `go test ./apps/kira-studio/internal/`** — the layering test, with **nothing added to
`packagesExemptFromBridgeCheck`**: `gitreview` gains `database/sql`, `modernc.org/sqlite`,
`compress/flate`, `embed` and `internal/config`, none of which reaches `internal/bridge`.

**(f) `KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the tree clean** — G4 D15's
machine-independence check. This phase adds no fixture (D18), so a diff here means something
regenerated that should not have.

**(g) `bun test packages/git-ipc/src`** — the contract, codec and rpc tests against
`CONTRACT_VERSION = 18`. Both suites reference the constant symbolically and should need no edit; an
edit is a signal the bump touched more than one integer.

**(h) `bun run lint` / `bun run typecheck` / `bun run test:unit` / `bun run build:vscode` — green.**
`typecheck:git` is what proves `FileTree.vue`'s and `DiffView.vue`'s new optional props compile against
`DetailPane.vue`'s existing, unchanged call sites; `commands.test.ts` (under `test:unit`) is what
proves `OTHER_COMMANDS` and `package.json#contributes.commands` still agree in both directions;
`build:vscode` proves the review root still bundles.

**(i) `bun run test:e2e-real` — green**, adding no new spec. Its `git-pairing-real.spec.ts` carries the
third `CONTRACT_VERSION` mirror (§4.4); its continued passing is what proves the handshake's hard
lockstep agrees across all three copies.

**(j) `go.mod`/`go.sum`/`bun.lock` have an empty diff** (§5).

### 7.2 Tier 2 — what cannot be proven in this container, named honestly

Unlike G9, **there is no unverifiable *source file* in this phase**: every Go file compiles, vets and
tests here, and `modernc.org/sqlite` is cgo-free on Linux exactly as it is on macOS. What cannot be
reached here is a *runtime*, not a compiler:

1. **A real VS Code extension host.** The Files tab, the checkbox column, the gutter marks, the
   shift-click range selection, the two header buttons and the palette command are Vue inside a webview
   that only exists inside VS Code. §7.1(d) proves every byte underneath them and nothing about them.
   This is the same gap G3–G10 each recorded, unchanged.
2. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin (G2 F18), so
   nothing here reaches the real `repo.open` path a human uses.
3. **`review.db` at a real `${KIRA_HOME}`.** Every test here points `Registry.Review` at a
   `t.TempDir()`. The default path, the 0700 directory, the 0600 file mode and the two-instance
   behaviour (F12/D3) are exercised only by a real launch.
4. **The reaper on a real clock.** `sweep(now)` takes its `now`, so the *rule* is tested here; that the
   hourly ticker actually fires over days, and that `PRAGMA incremental_vacuum` actually shrinks the
   file, are observations only a long-lived process makes.

There is no perf budget in this phase to re-baseline: G3/G8 measured the graph's first paint, and
nothing here is on that path.

### 7.3 Tier 3 — the macOS script, run once on real hardware before G11 is called done

1. The §7.1(a) scoped race run on macOS — the same suite, on the platform that ships.
2. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository; pair.
3. **`review.db` is created on the first mark and not before.** Open the review view, switch to Files,
   scroll — `ls -la ~/.kira-studio/` shows **no** `review.db`. Mark one file; it appears, **0600**,
   inside the **0700** directory. This is D3's whole claim and only a real launch can show it.
4. **The Files tab lists the three-dot range**: its paths equal
   `git diff --name-only $(git merge-base <base> <branch>) <branch>` in a terminal, including a file
   deleted on `<base>` after the divergence being **absent** (F3).
5. **Per-file marking**: check a file; the row shows reviewed, the count updates, and the state
   survives collapsing the sidebar, switching to Commits and back, and reloading the window.
6. **Per-range marking**: open a file's diff, click a line, shift-click ten lines down, "Mark
   reviewed" — those rows get the gutter mark and nothing else does. Then "Mark unreviewed" on a
   three-line sub-selection and confirm the remainder stays marked (the `full`→`partial` demotion,
   D10).
7. **The unchanged path**: commit an unrelated file on the branch. The reviewed file stays `full`,
   shows no "changed" badge, and its diff header says nothing changed since review. (`deltaSource:
   "unchanged"` — visible in the extension's own output channel log.)
8. **The fast path**: edit the reviewed file and commit. The badge appears; "Changes since you last
   reviewed" shows only that edit, not the whole range; the previously-reviewed lines that survived
   are still marked.
9. **The slow path — the case this phase exists for**: `git rebase -i` (or a plain `--amend`) the
   branch so every sha is rewritten, then force-move it. The reviewed marks are **still there**, the
   badge is correct, and "Changes since you last reviewed" is still exact. **If anything about this
   phase is going to be wrong on real hardware, it is this step.**
10. **The pruned case**: `git reflog expire --expire=now --all && git gc --prune=now` after step 9,
    then re-open. Still exact (the stored blob is the only thing that made it possible).
11. **Binary and huge files degrade honestly**: mark a `.png` and a >1 MiB generated file; after a
    rewrite, both say "reviewed on <date>" and report that what changed since cannot be shown, rather
    than showing nothing or an error toast.
12. **Two windows**: open the same branch's review in two VS Code windows against one Kira Studio.
    A mark in window A appears in window B's list after its next refresh. **D12's shared-state claim.**
13. **The palette command**: `Kira Version: Toggle File Reviewed` with a file open in the Files tab
    toggles it; with none open it announces "Open a file in the Files tab first." rather than doing
    nothing.
14. **A second Kira Studio instance** launched while the first is serving: it logs the socket-lock
    failure as it already does, and **creates no `review.db` activity** — confirm with
    `lsof ~/.kira-studio/review.db` showing exactly one process (F12/D3).
15. **Nothing else regressed**: the graph panel's own commit detail pane has **no** checkbox column
    (D16's optional-prop claim), the Commits tab of the review view is exactly as G6 left it, and the
    per-commit expansion still opens G4's diff overlay.

### 7.4 The checklist

- [ ] `CONTRACT_VERSION` is **18** in all three places: `git-ipc/src/validate.ts:10`,
      `gitrpc/contract.go:17`, `tests/e2e-real/git-pairing-real.spec.ts:93` (D1/F14).
- [ ] `packages/git-ipc`'s diff is the constant, five types, three request entries, three
      `REQUEST_KEY_MAP` lines and one `UiActionKind` member — no event, no stream, no codec, no schema.
- [ ] `packages/git-core` is byte-for-byte unchanged; `gitWire.fbs`, `src/generated/` and
      `internal/gitwire` are unchanged and `bun run generate:wire` was not run.
- [ ] `go.mod`, `go.sum` and `bun.lock` are unchanged (§5).
- [ ] `packagesExemptFromBridgeCheck` is unchanged; `gitreview` reaches nothing under
      `internal/bridge` (D2, §7.1(e)).
- [ ] `review.db` is under `${KIRA_HOME}`, is **not** a table in `kira.db`, and is opened **lazily**
      on the first review request (D3) — a process that serves none never creates the file.
- [ ] The DSN carries all six pragmas, `SetMaxOpenConns(1)` is set, and `chmod 0600` runs **after**
      `Ping` (D4, `storage/db.go`'s own recorded ordering trap).
- [ ] `_foreign_keys=1` is set and both cascades are declared — `Purge` is one `DELETE` (D4/D11/D20).
- [ ] Migration `0001_g11_review.sql` is version 1 in `gitreview/migrations`' own hand-ordered `names`
      slice, and the runner refuses a schema newer than the binary knows (D4).
- [ ] `review_file` is **not** `WITHOUT ROWID`, and `Records` does not select the `content` column
      (§3.1.1).
- [ ] Snapshots are `compress/flate` at `BestCompression`, capped at `MaxSnapshotBytes = 1 << 20`, and
      content is stored **only** for `content_kind = 'text'` (D9/F15).
- [ ] Every record stores `blob_oid`, including the ones with no content, and `''` is the oid for an
      `absent` path (D9).
- [ ] The delta selection is tier 0 (oid equality) → tier 1 (`--is-ancestor` exit 0) → tier 2, with
      exit 1 **and** exit 128 both taking tier 2 and anything else classifying as an error (D7/F4).
- [ ] `deltaSource` is one of `noSnapshot`/`unchanged`/`fast`/`slow`/`snapshotUnavailable`, and
      `'fast'` is reported **only** when a `git diff` actually ran (D7/D13).
- [ ] The slow path's temp files live in one per-request `os.MkdirTemp` (0700) with `defer
      os.RemoveAll`, files at 0600, both paths passed after `--` (D8).
- [ ] No temp path can reach a client: only parsed hunks cross the wire (F5).
- [ ] Stored ranges are always in the **snapshot's** coordinates; `review.mark` re-snapshots so the
      invariant holds after every write; wire ranges are always **new-side** line numbers (D10).
- [ ] `state = 'full'` is a state, not a materialised `[1..N]` range, and `Expand` is the only thing
      that turns it into one (D10).
- [ ] A ranged mark on a non-`text` snapshot is `E_BAD_REQUEST` naming the path (D10/D13).
- [ ] The reaper is a background sweep — one at open, then hourly — and `Purge(ctx, repoID, branch)`
      is exported as G16's seam (D11/D20).
- [ ] A session row is created **only** by the first `review.mark`; `Touch` never creates one (D11).
- [ ] `review.mark` holds `Store.Lock(repoID, branch, path)` for its whole read-diff-write (D12).
- [ ] **`gitsession`'s `note()` and `invalidateAfterWrite()` are unchanged** — a `refsChanged` must
      never drop review state (D14), and `TestIntegration_RefsChangedDoesNotDropReviewState` proves it.
- [ ] `Conn`, `Walk`, `walkPair` and `markWalksStale` have an empty diff (D14).
- [ ] `main.go` has an empty diff (D3/§3.7).
- [ ] `review.mark` takes no `base` (D5).
- [ ] `FileTree.vue`'s and `DiffView.vue`'s new props are **optional**, and `DetailPane.vue` renders
      identically with them absent (D16) — checked in the browser at §7.3 step 15, and by
      `DetailPane.vue` having an empty diff.
- [ ] `ReviewFilesPane.vue` is the **only** new component, and it composes `FileTree.vue` and
      `DiffView.vue` rather than reimplementing either (D16).
- [ ] `kiraVersion.toggleFileReviewed` is in `OTHER_COMMANDS` **and** in
      `package.json#contributes.commands`, and `MUTATING_COMMANDS` is unchanged (D17/F13).
- [ ] `proxyHandlers.ts` forwards all three new methods verbatim; `app.init`'s capability block still
      has exactly four fields (D17/§4.3).
- [ ] No test, fixture or script runs `git config --global` or `--system`; every `review.db` a test
      opens is under `t.TempDir()` (§0.4).
- [ ] §7.1(a)–(j) all green; §7.3's fifteen macOS steps all pass.

---

## 8. Sequencing — one implementer, sequential

**Recommendation: one sequential Sonnet subagent for the whole phase.** G1–G10 all made the same call
and all ten carried it through.

1. **The phase is one dependency chain.** The pure arithmetic → the store → the reaper → the argv →
   the three-tier selection → the router → the UI → the proof. That is `AGENTS.md`'s textbook case of
   *not* "genuinely independent (unrelated adapters, non-overlapping fixes)".
2. **C5 is where the phase's real risk lives.** The three-tier selection is a decision structure whose
   correctness depends on holding C1's projection semantics, C2's record shape and C4's exit-code
   contract in one head at once. Splitting it from any of those three puts a subtle wrong answer
   exactly where nothing would catch it.
3. **The one piece that looks separable is worth separating only if the orchestrator insists.** C1
   (`ranges.go` + `project.go` + their two table tests) is pure, touches files nothing else creates,
   and `go test ./…/gitreview/...` is its whole proof. It is the only defensible cut, and it is a few
   hundred lines against a coordination cost that is not much smaller.

Two things to carry into the implementing prompt, because a fresh subagent starts cold and both are
counter-intuitive:

- **Do not add a drop of review state to `RepoEntry.note()`.** Every other piece of state on
  `RepoEntry` is a cache of a git read and is dropped on `refsChanged`. Review state is durable user
  intent and must survive it. §3.6's own test exists to catch this, and it is the single most likely
  way to ship this phase wrong.
- **Do not "simplify" the three tiers into SPEC's two.** Tier 0 is not an optimisation that can be
  dropped for clarity: it is the only tier that answers correctly when the snapshot commit has been
  pruned *and* the content is unchanged, and it is what keeps `review.files` from spawning a diff per
  file.

---

## 9. Explicit non-goals for G11

| Not in G11 | Owner |
|---|---|
| Inline AI review comments; the flat `(session, file, line range, text, created_at)` table; a session-wide clear-all | **G12** — and `0002_g12_comments.sql` is the migration number waiting for it |
| A "mark every file reviewed" / "reset this session" bulk action | **G12**, which already owns a session-wide clear-all and will be editing this surface (§10) |
| The eager purge on PR closed/merged, and anything that knows what a PR is | **G16**, calling `Store.Purge` (D20) |
| `stash.*`, `preflight.stashPop`, `preflight.stashBranch` and their `op.run` kinds | G13 |
| `preflight.reset`, `preflight.cherryPick`, `tagPush`, `tagDeleteRemote` | G14 |
| `search.run` and the RE2-vs-`RegExp` reconciliation | G15 |
| `git worktree` create/list/switch/remove | G17 |
| Stacked branches | G18 |
| NFC/NFD path normalization — including in `review_file.path`, which stores whatever bytes `diff-tree` reported | **G19**, whose own audit explicitly covers "`gitsession`'s caches and the wire contract"; `review.db` is a new path-keyed store and should be on its list (§10) |
| Reviewed marks anywhere in the *graph* panel | never in v1.3 — the panel has no review session (D16) |
| A third webview view | never — G6's own hand-forward |
| Any change to `packages/git-core` | never, per SPEC §5 |
| Any change to the FlatBuffers data plane | never — this phase adds no bulk payload (D1) |
| Editing `docs/v1.3/SPEC.md` | house rule; this plan is the record |

---

## 10. Handed forward

- **`Store.Purge(ctx, repoID, branch)` is G16's hook** (D20). A G16 that writes its own delete, or its
  own reaper, has gone wrong — the one thing it needs to add is a caller.
- **`review.db` is now a second path-keyed store, and G19's NFC/NFD audit should include it.** SPEC's
  G19 row names `gitclient/porcelain`, the watcher, `gitsession`'s caches and the wire contract; a
  `review_file.path` written from `diff-tree`'s bytes and looked up from a client-supplied string is
  exactly the comparison class that row is about. Recorded here because G19's own list predates this
  file existing.
- **`0002_*.sql` is G12's, and the runner refuses a downgrade.** Once a user has run a G12 build,
  rolling back to a G11 build makes `review.db` refuse to open (the "schema_version newer than this
  build knows" arm) and the app logs it. That is `internal/storage`'s own established posture, applied
  to a second file; it is worth knowing before someone bisects.
- **No bulk "mark all reviewed" / "reset session" action exists.** Deliberate (§0.3): G12 already owns
  a session-wide clear-all for comments and is the natural place for the reviewed-state twin, sharing
  one confirmation and one code path rather than two built a phase apart.
- **The 1 MiB snapshot cap is a chosen number, not a measured one** (D9/F15). It is
  `gitsession.MaxPatchBytes`'s sibling and is defensible on that ground alone, but nobody has yet
  looked at a real `review.db` after a month of use. Whichever phase first has one in front of it —
  realistically G12, which will be adding to the same file — should look at the size distribution
  before either raising or lowering it.
- **`review_file` rows for paths that have left the range are never deleted before the TTL.** A file
  reviewed and then removed from the branch keeps its record for 14 idle days. That is correct (the
  branch may bring it back, and the base may change back, D5) and it is bounded, but it is the one
  place `review.db` can hold rows nothing will ever read.
- **Two windows share review state and neither is told when the other writes** (D12). There is no
  `review.changed` event; window B sees window A's mark on its next `review.files`. Adding an event is
  a one-line contract change if it ever turns out to matter — G8 is the phase with a real two-window
  matrix and it did not exist for this feature, so this is the first thing to re-examine if the
  chapter ever runs that matrix again.
- **The migration runner is duplicated between `internal/storage` and `internal/gitreview`** (D4),
  deliberately and for a stated reason. If a *third* SQLite file ever appears, extract it then — the
  right home would be a new leaf package both can import, not either of the two that exist.
- **`gitreview` is no longer a pure package** (D2/F1). G6's `resolve.go` is still pure and still tested
  without a repository; the package around it is not. A future contributor looking for "the pure
  review policy" should look at `resolve.go`, `ranges.go` and `project.go`, which are the three files
  that spawn nothing and touch no disk.

---

## 11. Two calls worth a human eye before implementation starts

Both are judgment calls the orchestrator or the user may reasonably decide differently, and both are
cheap to change *now* and awkward to change after C5/C7. Neither is a blocker: the plan takes a
position on each and can be implemented as written.

### 11.1 Is a **Files** pane the right addition to a UI SPEC freezes? (D16, F10)

**As planned**: yes — a `Commits`/`Files` segmented control in the review view's existing header, and
one new component that composes `FileTree.vue` and `DiffView.vue` in exactly the shape
`DetailPane.vue` already uses. Nothing is redesigned, no native VS Code surface replaces anything, and
both touched components take *optional* props so the commit path is provably unaffected.

**The alternative**: put the reviewed checkbox on the per-commit file trees only, and add no pane at
all. It is a strictly smaller diff and it does not touch `ReviewView.vue`'s structure. Against it, and
the reason this plan does not take it: after a rebase — the exact case SPEC wrote this phase for —
every commit in the list is new, so there is no commit whose tree a user could sensibly tick, and the
feature would work only in the one situation (nothing rewritten) where a plain sha would have been
enough. It would also make the same checkbox mean two different things in two places (D16's own
rejected-alternatives note).

The reason this is flagged rather than settled quietly: SPEC says `packages/git-ui` is *"Unchanged. No
redesign"*, and although G10 already amended it (four `defineExpose` lines and a dispatcher), this is
the first phase to add a **view** to it. A reviewer seeing that diff should see it because it was
decided, not because it was convenient.

### 11.2 Should tier 0 (blob-oid equality) exist at all? (D7, F6)

**As planned**: yes, and it runs *before* both paths SPEC names. It is exact, it is one pipe round
trip on a process `RepoEntry` already keeps warm, it is the only tier that answers correctly when the
snapshot commit has been pruned and the content is unchanged, and it is what keeps `review.files`'s
per-file "has this changed" check from being a spawn per file.

**The alternative**: implement exactly SPEC's two paths. The selection logic shrinks to two branches,
the `deltaSource` union loses a member, and the plan matches SPEC's own wording literally. Against it:
`review.files` would spawn one `git diff` per reviewed file to answer a question `cat-file
--batch-check` answers exactly, and the common "came back the next morning, nothing moved" case would
decompress a blob and write two temp files to produce an empty patch.

Flagged because it is an addition to a mechanism SPEC states in some detail, and because the extra
member on `ReviewDeltaSource` is wire-visible — cheap now, a contract bump later.

---
