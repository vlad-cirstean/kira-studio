# G27 — Unicode path normalization: NFC at the filesystem boundary, `core.precomposeunicode` at the git boundary

> **What this phase is.** The twenty-seventh phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the **fourth from-scratch design phase in a row** (G24, G25, G26 preceded it). Unlike those three it adds no feature: it is a **correctness audit and fix for a bug class already latent in shipped code from G2 through G26**. Upstream never addressed it — confirmed by a broader search than the one that prompted this phase (`normalize(`, `NFC`, `NFD`, `decompos`, `precompos`, `unicode`, `canonicaliz`, `precomposeunicode`, `quotepath` across `packages/`, `apps/`, `docs/` at `/home/user/vlad-cirstean/kira-version-vscode`, branch `claude/start-p2-gwlgly` @ `0ea4cfe`): the only hits are `git pull`'s "decomposed pull" (an unrelated use of the word) and `core.quotepath=false` in `packages/git/src/driver.ts:32`. Upstream's Node code on macOS gets NFD from `readdir` exactly as Go does, and handled it nowhere. This plan is the design.
>
> **The audit's headline finding inverts the SPEC row's own instruction, and the reason is a probe.** SPEC `:340` says *"normalize consistently at ingestion (from git output and from the filesystem alike)"*. Normalizing **from git output** is provably wrong for repository-relative file paths: probe **P7** shows `git cat-file -p HEAD:café.txt` (NFC) against a tree entry committed as NFD fails outright — `fatal: path 'café.txt' does not exist in 'HEAD'` — and `git diff --name-only HEAD -- <NFC>` matches nothing. Every repo-relative path this app parses is handed straight back to git as a `<rev>:<path>` operand or a pathspec (`porcelain.FileDiffArgs`, `catfile.Session.Check/Read`, `porcelain.WorktreeDiffArgs`), so blanket ingestion-normalization would convert a comparison bug into a hard functional break. **D2** replaces it with a provenance rule that is stricter, not looser, and still satisfies SPEC's actual requirement ("normalize at ingestion, not per-comparison"):
>
> 1. **Absolute/directory paths** (`RepoID`, `Root`, `GitDir`, `CommonDir`, `%(worktreepath)`, `worktree list`'s `worktree` field, every client-supplied path parameter, every filesystem event path) are **NFC-normalized at ingestion, always**. They are only ever used as map keys, comparands, `chdir` targets, or `os.Stat` operands — and filesystem *access* by path is normalization-**insensitive** on both APFS and HFS+, so normalizing them carries zero functional risk and buys key stability outright.
> 2. **Repository-relative file paths** (`porcelain`'s `Path`/`OriginalPath` from `status`, `diff-tree`, `diff`, `stash show`, `ls-tree`) are **left byte-exact, never normalized**. Consistency *among* git's own outputs is bought instead by making git normalize: `-c core.precomposeunicode=true` joins `configOverrides` (**D3**) beside the `core.quotepath=false` that has been there since G2, which is git's own documented, supported mechanism for exactly this — it precomposes the names git reads from `readdir`, which is the *only* place git's output can disagree with itself.
>
> **The single worst site in the tree, found by this audit, is not in the watcher.** SPEC's row predicts a watcher-vs-porcelain path mismatch; **F1** shows that comparison does not exist — `internal/gitclient/watcher.go` emits two coarse `Signal` constants and never reports a file path to anything. The real hazards are (a) `gitpreflight.ClassifyCheckout`'s `rewrittenSet[d.Path]` intersection (`checkout.go:78`), which crosses `status`'s readdir-sourced **untracked** entries against `diff --name-only`'s **tree**-sourced ones inside what is a *safety blocker* — a miss produces a "clean" verdict for a checkout git will then refuse; and (b) `gitsession/refs.go:107`'s `filepath.Clean(*r.CheckedOutIn) == root`, which crosses `for-each-ref`'s `%(worktreepath)` against `rev-parse --show-toplevel` — a miss makes the app report the user's *own* current branch as checked out in another worktree and refuse to check it out.
>
> **`CONTRACT_VERSION` stays 29** (**D10**) — no new request, no new type, no new field, no changed field shape. Stated explicitly so no later phase reads this row's silence as a claim on 30.
>
> **No totality guard is touched** (**D11**): no `opTable` entry, no `MutatingAction` member, no `OP_ERROR_TEXT` phrase, no `MUTATING_COMMANDS` key, no `UiActionKind`. This phase adds no operation. Stated rather than left unaddressed.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `5253f3e8` (G1–G26 complete, working tree clean). Every claim below was checked against source read in this container, or produced by a read-only probe against real git 2.43.0 and Go 1.27.0 in a scratch fixture outside this repo — never inferred from SPEC prose.

**This container cannot reproduce the target platform's behaviour, and that is stated up front.** Its filesystem is ext2/ext3 (`stat -f`), which is byte-transparent: probe **P1** shows `café.txt` (NFC) and `café.txt` (NFD) exist as **two distinct files** here, both round-tripping byte-exact through `readdir`, `git add`, `git ls-files -z`, and `git status --porcelain=v2 -z`. On macOS they are one file. Probe **P2** shows this build of git has no `PRECOMPOSE_UNICODE` support at all (`git config core.precomposeunicode` exits 1 on a fresh repo; setting it changes nothing), because git compiles that code only on macOS. So:

- **Empirically verified in this container**: everything about `golang.org/x/text/unicode/norm`'s behaviour (P3–P6, P9–P12), everything about git's byte-transparency and tree-entry lookup semantics (P1, P7, P8), and every source-code claim.
- **Reasoned from documented platform behaviour, to be confirmed by a human on a Mac (§7.3)**: that APFS/HFS+ return decomposed names from `readdir`; that `core.precomposeunicode` makes git precompose them; that `git init`/`git clone` on macOS write that key into `.git/config` themselves; that `-c core.precomposeunicode=true` overrides a repo-level `false`.

| Claim | Evidence |
|---|---|
| Upstream never handled NFC/NFD anywhere | Broad grep over `packages/`, `apps/`, `docs/` for `normalize(`/`NFC`/`NFD`/`decompos`/`precompos`/`unicode`/`canonicaliz`/`precomposeunicode` → only `git pull`'s "decomposed pull" prose and `core.quotepath=false` |
| Nothing in **this** repo normalizes a path either | Same grep over `apps/`, `packages/`, `docs/` → only `gitreview.Normalize` (line-**range** merging, `gitreview/ranges.go:17`) and `typeGlossary.ts`'s SQL-type `normalize()`. Zero Unicode normalization |
| `golang.org/x/text` is already a **direct** dependency; `unicode/norm` is in the module cache | `go.mod:35` (`golang.org/x/text v0.41.0`, direct require block); `/root/go/pkg/mod/golang.org/x/text@v0.41.0/unicode/norm` present. Today's only consumer is `internal/apivars/transforms.go:10-11` (`cases`, `language`) |
| The watcher reports **no** file path to any consumer | `gitclient/watcher.go:13-18` — `Signals() <-chan Signal`, two constants; `ev.Path` dies inside `classify` (`:58-92`) |
| `configOverrides` is the spawn-hygiene chokepoint, already carrying `core.quotepath=false` | `gitclient/runner.go:98-103`; asserted byte-exactly by `runner_test.go:40-52` and `:54-66` |
| `RepoID` is `git rev-parse --show-toplevel`'s output (or `--absolute-git-dir` for a bare repo) | `gitclient/repo.go:184-206`, `:221-227` |
| `Registry` and `Conn` are keyed on that string | `gitsession/registry.go:96`, `:138`, `:156`; `gitsession/conn.go:54-55` |
| Every path-bearing RPC funnels through one resolver | `gitrpc/detail.go:43-48` (`entryFor`) → `gitsession/conn.go:242` (`Conn.Entry`) |
| `review.db` uses paths as primary keys | `gitreview/migrations/0001_g11_review.sql` — `review_file` PK `(session_id, path)`, `review_range` PK `(session_id, path, start_line)`, `review_session` UNIQUE `(repo_id, branch)`; `0002_g13_comments.sql` — `review_comment.path` + its index |
| `kira.db` keys per-repo settings on the same path | `internal/storage/migrations/0017_g18_git_repo_settings.sql:10-14` — PK `(repo_id, key)` |
| The FlatBuffers data plane carries **no** path at all | `grep -n "path" packages/git-ipc/schema/gitWire.fbs` → nothing; `grep -rn "Path" internal/gitstore/*.go` → nothing |
| The porcelain golden corpus contains **zero** non-ASCII bytes | Byte scan of all 10 `testdata/` directories for `[\x80-\xff]` → no file matches |
| `CONTRACT_VERSION` is 29 (G26) | `packages/git-ipc/src/validate.ts:83`; `internal/gitrpc/contract.go:89` |

**Probes run in this container (read-only, in a scratch fixture, never this repo):**

| # | Question | Observed |
|---|---|---|
| **P1** | Does Linux/ext4 + git 2.43 preserve NFC and NFD as distinct byte sequences end to end? | **Yes, and they are two separate files.** `readdir` → `63 61 66 65 cc 81 …` and `63 61 66 c3 a9 …`; `git ls-files -z` and `git status --porcelain=v2 -z` echo both verbatim. **This container therefore cannot reproduce macOS's collapse of the two; §7.3 owns that.** |
| **P2** | Does this git know `core.precomposeunicode`? | **No.** `git config core.precomposeunicode` exits 1 on a fresh repo (git sets it on macOS only). Setting it explicitly changes nothing in `status` output. `-c core.precomposeunicode=true` is nonetheless **accepted without error** (exit 0 for `status --porcelain=v2` and `cat-file -p HEAD`) — so the D3 flag is safe on any platform, verified. |
| **P3** | `norm.NFC` on the two Latin forms | `63 61 66 65 cc 81 …` → `63 61 66 c3 a9 …`. `NFC(A) == NFC(B)` for the é pair: **true**. |
| **P4** | `norm.NFC` on precomposed vs. conjoining-jamo **Hangul** (`한글.md`) | `e1 84 92 e1 85 a1 e1 86 ab e1 84 80 e1 85 b3 e1 86 af …` → `ed 95 9c ea b8 80 …`, equal to the precomposed form. Non-Latin scripts are covered by the same one call — no script-specific handling. |
| **P5** | Does NFC do more than compose accents? | **Yes — singletons and canonical ordering.** `Ω` U+2126 OHM SIGN → `Ω` U+03A9 (`e2 84 a6` → `ce a9`). And `Ḋ` + U+0323 → `Ḍ` + U+0307 (`e1 b8 8a cc a3` → `e1 b8 8c cc 87`): combining marks are canonically **reordered**, so two paths differing only in mark order also unify. Recorded because it means NFC is a true canonical form, not a "compose accents" convenience. |
| **P6** | Does NFC touch a compatibility ligature? | **No.** `ﬁle.txt` (U+FB01) is unchanged by NFC. Only NFKC would fold it to `file.txt`, which would change the *meaning* of the path. This is the concrete reason D1 rejects NFKC. |
| **P7** | `git cat-file -p HEAD:<NFC>` against a tree entry committed as **NFD only** | **`fatal: path 'café.txt' does not exist in 'HEAD'`.** And `git diff --name-only HEAD -- <NFC>` prints nothing (0 bytes). **The decisive probe: normalizing a repo-relative path before handing it back to git breaks the lookup outright.** |
| **P8** | The same repo, asking with the **NFD** spelling git itself reported | Resolves, content printed. Round-tripping git's own bytes is always correct. |
| **P9** | `norm.NFC.String` on invalid UTF-8 — lone `0xff`, truncated `0xc3`, bad continuation `c3 28`, CESU-8 surrogate `ed a0 80` | **All four pass through byte-for-byte unchanged**, and are idempotent. No U+FFFD substitution, no truncation. A path that is not valid UTF-8 survives normalization intact. |
| **P10** | Does NFC ever create or destroy a `/` or a NUL? | **No.** `á/b́/c` keeps exactly 2 slashes; `á\x00b́` keeps its NUL. Path splitting and NUL record framing are unaffected — which is why normalization can safely happen *after* `records.go`'s splitter. |
| **P11** | Cost of `norm.NFC.String` on an already-normal ASCII path (55 chars) | **46.5 ns/op, 0 B/op, 0 allocs/op** — it has its own fast path and returns the input string. |
| **P12** | Cost of guarding it with `norm.NFC.IsNormalString` first | **58.7 ns/op, 8 B/op, 1 alloc/op — strictly worse.** The obvious "only normalize if needed" optimisation is a pessimisation. D4 forbids it by name. |

**Probes the implementer must run on a real Mac before writing code, with the expected result stated so a mismatch is visible (§7.3 records the outcomes):**

| # | Command | Expected |
|---|---|---|
| **M1** | On APFS: `printf x > "$(printf 'caf\xc3\xa9')"` then `ls | od -c`, and a Go `os.ReadDir` of the same directory | The bytes the filesystem returns for a name *created* as NFC. APFS is normalization-**preserving**, so this is expected to come back NFC; HFS+ would return NFD. Records which regime the tester is actually on — the answer changes how much M2–M4 exercise. |
| **M2** | In the same directory: `stat "$(printf 'cafe\xcc\x81')"` — the *other* spelling of a file created with the first | **Succeeds.** APFS/HFS+ are normalization-**insensitive** for lookup. This is the property D2 rests on: normalizing a directory path never breaks filesystem access. If this fails, D2's tier 1 is unsound and the whole design must be revisited. |
| **M3** | `git init` a fresh repo on macOS, then `git config --local --get core.precomposeunicode` | `true` — git's own probe wrote it. Confirms D3's flag is a restatement of the prevailing value for essentially every repo, not a new policy. |
| **M4** | In a repo with `core.precomposeunicode=false` in `.git/config`, create an untracked file through Finder/an editor (likely NFD) and run both `git status --porcelain=v2 -z` and `git -c core.precomposeunicode=true status --porcelain=v2 -z` | The two disagree on the untracked entry's bytes; the second matches the index/tree form. This is D3's entire justification, observed. |
| **M5** | `git worktree add` a directory whose name contains `é`, then compare `git worktree list --porcelain -z`'s `worktree` line against `git -C <that dir> rev-parse --show-toplevel` and against `git for-each-ref --format='%(worktreepath)'` | Ideally byte-identical. **A divergence here is `gitsession/refs.go:107`'s bug reproduced live** and is the single most valuable thing this probe set can find. |

### 0.2 Scope

1. **`internal/gitpath`** (new, ~40 lines) — the one canonicalisation function and its doc comment. Zero dependencies beyond `golang.org/x/text/unicode/norm` and `path/filepath`.
2. **`internal/gitclient/runner.go`** (edited) — one `-c core.precomposeunicode=true` pair in `configOverrides` (D3), plus the two argv goldens in `runner_test.go`.
3. **`internal/gitclient/repo.go`** (edited) — `Identify` normalizes `Root`/`GitDir`/`CommonDir` and therefore `RepoID` (D5a).
4. **`internal/gitclient/watcher.go`** (edited) — `resolveOrKeep` returns NFC; `classify` normalizes the incoming event path (D5b).
5. **`internal/gitclient/porcelain/{worktree,refs}.go`** (edited) — the two *absolute-path* fields these parsers emit, and only those (D5c).
6. **`internal/gitrpc`** (edited) — one normalization at `entryFor`, one at `handleRepoOpen`, four at the worktree/settings path params (D6).
7. **`internal/gitreview`** (edited) — an idempotent, SQL-prefiltered Go sweep that re-keys stored non-ASCII paths on open (D8).
8. **`packages/git-core/src/util/nfcPath.ts`** (new) — the TS twin, three lines.
9. **`apps/kira-studio-vscode/src`** (edited) — four filesystem-ingestion sites (D7).
10. **Tests** — a `gitpath` table test built entirely from byte literals, an argv golden, a `classify` case, a `subtractOwnWorktree` case, a `gitreview` sweep test, and one `nfcPath` unit test. **No test depends on the host filesystem's normalization behaviour** (D12).

### 0.3 Not in this phase

See §8. Headlines: **no normalization of repository-relative file paths** (P7); **no NFKC/NFKD anywhere** (P6); **no `kira.db` migration** (D9); **no `CONTRACT_VERSION` bump** (D10); **no case-folding** (a different axis, and macOS's case-insensitivity is a separate, unrequested bug class); **no change to `packages/git-ui`** (F12).

### 0.4 Ground rules

- **Provenance, not position, decides whether a path is normalized.** The question is never "is this a path?" but "where did these bytes come from, and where are they going?" (D2).
- **A path handed back to git is handed back exactly as git gave it.** P7 is the reason; there are no exceptions.
- **Normalization changes bytes, never meaning.** NFC is canonical equivalence: the two forms are, by Unicode's own definition, the same text and render identically. NFKC would not be, which is why it is excluded by name (P6/D13).
- **Nothing here is guarded by an "is it already normal?" check.** P11/P12 measured the guard as slower and allocating.
- `AGENTS.md` in full: no stubbed error handling, no skipped validation, named constants, table tests, and the unit-test bar — a test earns its keep here only for the canonicaliser itself (a decision structure with real edge cases) and the sweep (data rewriting with a key-collision rule), not for the one-line call sites.

---

## 1. Findings

### F1 — The watcher never reports a file path, so SPEC's predicted comparison does not exist

`RepoWatcher.Signals()` (`gitclient/watcher.go:184`) yields `Signal`, a two-constant string type (`refsChanged`, `worktreeChanged`, `:15-18`). The only path in the watcher is `rawEvent.Path`, consumed inside `classify` (`:58-92`) and discarded. Nothing downstream — `gitsession`'s subscribers, `repo.changed`, the caches — ever sees a filename. **SPEC `:340`'s framing ("what the watcher reports for the identical file") does not describe this codebase**, and the audit says so rather than manufacturing the site.

### F2 — But the watcher *does* compare an OS-supplied path against a git-supplied one, and a miss silences it completely

`classify` compares `path` (from FSEvents' `ev.Path`, `watcher_fsevents_darwin.go:111`, i.e. the kernel's own bytes) against `summary.CommonDir` / `summary.GitDir`, which came from `git rev-parse --absolute-git-dir` / `--git-common-dir` (`repo.go:171-180`), via `strings.HasPrefix` (`:63`, `:88`) and `==` (`:71`, `:74`). For a repository under a path containing a non-ASCII character — `/Users/José/dev/café/.git` — a form mismatch makes **every** rule fall through and the watcher goes permanently, silently dead: no `repo.changed`, no cache invalidation, a graph that never refreshes and never errors. That is a strictly worse failure than the per-file mismatch SPEC predicted, and the file's own comment at `:96-97` (*"Both backends deliver Path already agreeing with classify's comparison target"*) is the assumption this finding invalidates.

### F3 — `ClassifyCheckout`'s set intersection crosses git's two path sources inside a safety blocker

`gitpreflight/checkout.go:73-89`:

```go
rewrittenSet := make(map[string]bool, len(in.Rewritten))   // git diff --name-only -z HEAD <target>  — tree/index bytes
for _, d := range in.Dirty {                               // git status --porcelain=v2 -z            — index bytes for tracked,
    if rewrittenSet[d.Path] {                              //                                          READDIR bytes for untracked
```

`in.Dirty` is `gitpreflight.DirtyPaths(statusResult)` (`gitsession/preflight.go:69`), and `porcelain.ParseStatus` produces untracked entries from status's `?` records (`porcelain/status.go:179`) — which git fills from its own `readdir`, the one and only place git's output is not index-derived. An untracked file whose on-disk name is NFD, at a path the target tree adds in NFC, **misses the intersection**: no `blockedByUntracked` blocker, verdict `clean`, the dialog says the checkout is safe, and then `git checkout` refuses it with `error: The following untracked working tree files would be overwritten by checkout`. A false-negative on a safety blocker is the worst direction this bug can point. `ClassifyStashPop` (`gitpreflight/stash.go:87-98`, `dirtyTrackedSet[p]` against `stash show --numstat`'s tree paths) and `ClassifyCherryPick` (`cherrypick.go:54-60`, `intersect`) have the identical shape.

### F4 — `subtractOwnWorktree` crosses two *different git mechanisms* for the same directory and can lock a user out of their own branch

`gitsession/refs.go:107`: `if r.CheckedOutIn != nil && filepath.Clean(*r.CheckedOutIn) == root`. `*r.CheckedOutIn` is `for-each-ref`'s `%(worktreepath)` (`porcelain/refs.go:146`, `:169`), which git derives from the worktree registry under `commonDir/worktrees/<name>/gitdir` — a **file whose bytes were written when the worktree was created**. `root` is `rev-parse --show-toplevel`, derived from the process's cwd. These are two independent byte paths to the same directory. If they disagree, the branch checked out *here* is reported as checked out *elsewhere*, `ClassifyCheckout` raises `worktreeConflict` (`checkout.go:96-98`), and the user cannot check out the branch they are standing on. `gitsession/worktree.go:93` (`IsCurrent`), `:261` (`IsCurrentWorktree`, a removal blocker) and `:102`/`:263` (`e.isOpen(r.Path)` → `Registry.IsOpen`, `registry.go:222`, keyed on `RepoID`) all have the same shape. Probe **M5** is designed to catch this live.

### F5 — `RepoID` is a filesystem path taken from the client, and it keys everything

`repo.open`'s `path` originates at `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` (`extension.ts:638`, also `:150`, `:248`) or `showOpenDialog(...).fsPath` (`ports/dialogs.ts:17`) or `VsCodeWorkspaceRoots.list()` (`ports/workspaceRoots.ts:12`) — all filesystem-sourced. Go feeds it to `Identify`, whose `--show-toplevel` output becomes `RepoID` (`repo.go:203-206`). That string is then the key of `Registry.entries` (`registry.go:96`), `Conn.held` and `Conn.walks` (`conn.go:54-55`), `review_session.repo_id`, `git_repo_settings.repo_id`, and the extension's own `repoRoots` map (`proxyHandlers.ts:206`). **Two spellings of the same repository produce two `RepoEntry`s** — two watchers, two `cat-file` processes, two undo slots, two sets of caches, and a reader/writer gate (`Repo`'s, ported at G2) that no longer serializes writes between them. That last consequence is a data-safety issue, not a performance one.

### F6 — Every path-bearing RPC already funnels through one resolver, so the `repoId` fix is one line

`gitrpc/detail.go:43-48`'s `entryFor(c, repoID)` is called by every handler in `comments.go`, `detail.go`, `gh.go`, `incremental.go`, `refs.go`, `remote.go`, `reset.go`, `review.go`, `search.go`, `settings.go`, `stack.go`, `stash.go`, `worktree.go`; `graph.go:179` uses `c.Entry` directly for the same purpose. Normalizing `repoID` inside `entryFor` (and once more in `graph.go`'s direct call) covers the entire surface — and, as a bonus, makes a pre-G27 client's persisted NFD `repoId` resolve against a post-G27 registry.

### F7 — `review.db` stores paths as primary keys, and joins them against git output

`review_file` PK `(session_id, path)`, `review_range` PK `(session_id, path, start_line)` with an FK onto it, `review_comment.path` + `review_comment_session_path` index (`gitreview/migrations/0001`, `0002`). The join happens at `gitsession/incremental.go:442` — `rec, hasRecord := records[ch.Path]`, where `records` is `store.Records(...)` keyed by stored path and `ch.Path` comes from the current diff. Under a form mismatch the file reads permanently unreviewed, marking it reviewed inserts a *second* row that also never matches, and the reviewer's work product is silently lost. This is the only place in the tree where the bug survives a restart.

### F8 — `gitstore` and the FlatBuffers data plane carry no path at all

`grep -rn "Path" internal/gitstore/*.go` → nothing; `grep -n "path" packages/git-ipc/schema/gitWire.fbs` → nothing. The commit store, the interner, `PackedCommitChunk` and `graph.stream` are entirely path-free. **No `flatc` regeneration, no `gitwire` change, no `codec.ts` change.** A clean scope boundary, established by evidence rather than assumed.

### F9 — Filesystem *access* by path is normalization-insensitive on macOS; only string *comparison* breaks

This is the asymmetry the whole design rests on. `os.Stat`/`fs.stat`/`chdir`/`realpath` on APFS and HFS+ resolve either spelling to the same file (probe **M2** confirms). So every site that merely *touches* a path — `gitsession/queries.go:454`, `preflight.go:611`, `worktree.go:147`/`:152`, `gitprepare/script.go:17`, `virtualFileDecoration.ts:38-42`'s `workspace.fs.stat` — is already correct and needs nothing. It also means normalizing a *directory* path can never break access to it, which is what makes tier 1 of D2 risk-free.

### F10 — `ClassifyStashPop`'s untracked-collision test is a near-miss, and it is worth recording why it is safe

`ExistingUntrackedPaths` (`gitpreflight/stash.go:70`) is not a filesystem listing: it is `StashUntrackedPaths` filtered by `os.Stat(filepath.Join(root, p))` (`gitsession/preflight.go:611`). Both sides of the intersection at `stash.go:81-84` therefore descend from the same `ls-tree` output, and F9 makes the stat itself form-agnostic. **This site is correct today and must stay correct** — the design must not "fix" it into two sources.

### F11 — The porcelain golden corpus has zero non-ASCII bytes, so nothing existing exercises this at all

A byte scan of all ten `porcelain/testdata/` directories for `[\x80-\xff]` matches no file. Every recorded fixture — 43 files across `log`, `status`, `diffTree`, `refs`, `show`, `stash`, `diff`, `mergeTree`, `keys`, `handAuthored` — is pure ASCII. The parsers have never been shown a non-ASCII path in any test. D12's fixtures are the first.

### F12 — Exactly one TS site compares a git-sourced path against a filesystem-sourced one

`packages/git-ui/src/components/RepoPicker.vue:33` — `props.repoState.activeRepo.value?.root === candidate.path`. `root` comes from `repo.open`'s `RepoSummary` (Go, git-sourced). `candidate.path` comes from `repo.list`, which the **extension answers locally** (`proxyHandlers.ts:240-243`) from `VsCodeWorkspaceRoots.list()` → `folder.uri.fsPath`. Every other `.path ===` in `git-ui` (`reviewFiles.ts:164`, `:244`, `ReviewFilesPane.vue:57`, `:84`, `ReviewView.vue:219`, `ReviewCommentsPane.vue:37`) compares two wire-sourced values and is safe. `fileTreeModel.ts`'s `/`-splitting is byte-safe by P10. **`packages/git-ui` needs no change**: fixing the *ingestion* of `candidate.path` in `workspaceRoots.ts` fixes `RepoPicker.vue` without touching it, which is also what SPEC's "`packages/git-ui` untouched" rule wants.

### F13 — The extension never re-derives a repo-relative path from the filesystem

Every path the extension sends back to Go for a file comes out of `virtualKey.ts`'s base64url-encoded `{repoId, rev, path}` triple (`reviewMarking.ts:93-99`, `reviewComments.ts:30-39`, `diffToolbar.ts:52-58`, `goToFile.ts:31-48`) — i.e. our own bytes, round-tripped opaquely. `proxyHandlers.ts:381` and `:420` join `root` with a wire-sourced `change.path` to build a *display* resource for VS Code's multi-diff editor, never to send back. So tier 2 of D2 (leave repo-relative paths alone) needs no client-side counterpart at all.

### F14 — `norm.NFC.String` is already free on the common input, and the obvious guard makes it worse

P11 vs. P12: `norm.NFC.String` on an already-NFC 55-char ASCII path is **46.5 ns, 0 allocs** and returns the input string; wrapping it in `if !norm.NFC.IsNormalString(s)` costs **58.7 ns and 1 allocation**. D4 forbids the guard by name so a future reviewer does not "optimise" it back in.

### F15 — `norm.NFC` is byte-transparent for invalid UTF-8, which makes it safe to apply unconditionally

P9: lone `0xff`, a truncated `0xc3`, an invalid continuation, and a CESU-8 surrogate all pass through unchanged and idempotently. A Linux-created path that is not valid UTF-8 is neither mangled nor rejected. (APFS enforces UTF-8, so this is a robustness property rather than a macOS scenario — but it means the canonicaliser has no failure mode and needs no `error` return.)

### F16 — No totality guard is in play, and the diff should prove it

`opTable` (`gitsession/ops.go:138`) stays at twenty entries with six `Undoable`; `MutatingAction` (`apps/kira-studio-vscode/src/commands.ts:29`) gains no member; `OP_ERROR_TEXT` (`git-ui/src/state/liveAnnouncements.ts:135-165`) gains no phrase; `MUTATING_COMMANDS` gains no key; `UiActionKind` gains no member. Unlike G26 (whose F16 listed three guards that *would* break by design), this phase's relationship to them is that **nothing breaks** — and §7.2 asserts that as a check rather than leaving it implied.

---

## 2. Decisions

### The canonical form

### D1 — NFC, and never NFK-anything

| Option | Verdict |
|---|---|
| **NFC (Normalization Form C)** | **Chosen.** The W3C's `charmod-norm` recommendation for text on the wire, the form git records on macOS under `core.precomposeunicode` (so it is already the form ~all of a Mac user's tree entries are in), the form Linux and Windows filesystems produce naturally, and the shorter of the two for the same text. Choosing it means the *normalized* form and the *overwhelmingly common* form coincide, so P11's zero-alloc fast path is taken almost always. |
| NFD | Rejected. It would be the form that matches HFS+'s `readdir` — but not APFS's (which preserves whatever was written), not git's tree entries, not the wire, and not the other 99% of paths. It optimises for the one source we are *not* trying to match. |
| NFKC / NFKD | **Rejected on a probe.** P6: NFKC folds `ﬁle.txt` (U+FB01) to `file.txt` and would fold `①` to `1`, `㎏` to `kg`, full-width Latin to ASCII. Those are *different filenames*, not different spellings of one — compatibility decomposition is lossy by design. Using it would turn a byte-representation fix into a semantic corruption. |
| No canonical form; a normalization-insensitive comparator at each site | Rejected — this is precisely what SPEC `:340` forbids (*"rather than patching each comparison site ad hoc"*), and it fails the one place that matters most: a `map[string]` key and a SQLite primary key cannot be given a custom comparator. |

P5's singleton and reordering behaviour (U+2126 → U+03A9; combining-mark reordering) is accepted deliberately: both are *canonical* equivalences, which by Unicode's definition means the two strings are the same text and render identically. D13 states the display consequence explicitly.

### The provenance rule

### D2 — Two tiers, decided by where the bytes came from and where they are going

**Tier 1 — normalize to NFC at ingestion, always: absolute paths and directory paths.**

`RepoID`, `Root`, `GitDir`, `CommonDir`, `%(worktreepath)`, `worktree list --porcelain`'s `worktree` field, every filesystem-event path, and every client-supplied *directory* parameter (`repo.open`'s `path`, `preflight.worktreeAdd`/`worktreeRemove`/`worktree.prepare`'s `path`, `kiraVersion.worktree.basePath`, `settings.setGitPath`).

Why it is safe: these are used only as (a) map/registry/DB keys, (b) comparands, (c) `Spec.Dir` chdir targets, (d) `os.Stat` operands, and (e) `git worktree add/remove <dir>` operands — and F9/M2 establish that every one of (c), (d), (e) is normalization-insensitive on APFS and HFS+ (`git worktree remove` resolves its argument through `real_path()` before matching the registry). There is no path by which normalizing them can fail to find something.

Why it is necessary: F2, F4, F5 — all three of this codebase's genuinely cross-source comparisons are on absolute directory paths, and two of them (F4, F5) are functional or data-safety breaks.

**Tier 2 — never normalize: repository-relative file paths.**

`porcelain`'s `StatusEntry.Path`/`OriginalPath` (`status.go:39-40`), `NumstatEntry`/`NameStatusEntry`/`FileChange`'s `Path`/`OriginalPath` (`difftree.go:49-72`), `DiffHunk` paths, `stash show`'s numstat paths, `review.mark`/`commit.fileDiff`/`file.read`/`file.goToTarget`'s `path` parameters.

Why: **P7.** Every one of these is handed back to git — `porcelain.FileDiffArgs(from, to, path, originalPath)` (`diff.go:14-22`), `catfile.Session.Check/Read(rev + ":" + path)` (`queries.go:394`, `incremental.go:147`, `:165`), `porcelain.WorktreeDiffArgs(rev, path)` (`queries.go:485`) — where git does a **byte comparison** against tree and index entries. An NFC pathspec against an NFD tree entry resolves nothing, silently (`git diff --name-only` prints zero bytes) or loudly (`fatal: path … does not exist in 'HEAD'`). Normalizing tier 2 would trade a comparison bug for a hard break.

**Tier 2's internal consistency is bought by D3, not by us.** The *only* place git's own output can disagree with itself about a repo-relative path is `status`'s readdir-sourced untracked/ignored entries (F3). `core.precomposeunicode=true` is git's own supported fix for exactly that, applied at exactly that boundary, by the process that owns it.

This satisfies SPEC `:340`'s actual requirement — normalization happens once, at an ingestion boundary, never at a comparison site — while correcting its assumption that git output is a safe thing to normalize.

### D3 — `-c core.precomposeunicode=true` joins `configOverrides`

One pair added to `gitclient/runner.go:98-103`, beside the `core.quotepath=false` it structurally mirrors:

```go
var configOverrides = []string{
	"-c", "core.quotepath=false",
	"-c", "core.precomposeunicode=true",   // G27 D3
	"-c", "color.ui=false",
	"-c", "log.showSignature=false",
	"-c", "i18n.logOutputEncoding=UTF-8",
}
```

| Option | Verdict |
|---|---|
| **Force `true` on every spawn** | **Chosen.** It is the only thing that makes `status`'s untracked entries agree with the index inside one command's output (F3), and it is a *restatement* of the prevailing value for essentially every repository a Mac user has: git's own `probe_utf8_pathname_composition()` runs at `init`/`clone` on macOS and writes `core.precomposeunicode = true` into `.git/config` itself (probe **M3** confirms). It changes behaviour only for a repo whose config says `false` explicitly, or one created elsewhere and copied onto a Mac without the probe ever running — the two cases where F3 is live. Verified harmless on non-macOS: P2 shows `-c core.precomposeunicode=true` is accepted with exit 0 by a git built without `PRECOMPOSE_UNICODE`. |
| Leave it to the repo's own config | Rejected. It leaves F3 open in precisely the repositories where F3 fires, and makes the app's correctness depend on a config key it does not control — while `configOverrides` exists specifically so that spawn behaviour does *not* depend on the user's config (`runner.go:88-93`'s own doc comment). |
| Read the repo's value and adapt | Rejected. Adds a spawn and a per-repo branch, to end up doing one of two things where one of them is always right. |

**Named honestly**: forcing `true` over an explicit `false` means our `git status` can differ from the user's own terminal `git status` in that one repository. That is a real divergence, and it is the price of F3 not being a live hazard; §10.3 puts it in front of a human.

### D4 — `internal/gitpath`, one exported function, no guard

```go
// Package gitpath is the git module's single Unicode-canonicalisation point (G27 D2).
package gitpath

// NFC returns p in Unicode Normalization Form C.
//
// Applied ONLY to absolute/directory paths — D2 tier 1. A repository-relative path is
// handed back to git as a pathspec or a <rev>:<path> operand, where git does a byte
// comparison against tree entries: probe P7 shows an NFC spelling of an NFD tree entry
// resolves to `fatal: path ... does not exist`. Never call this on one.
//
// Unguarded on purpose: norm.NFC.String is 46ns/0 allocs on an already-NFC input and
// returns it unchanged (P11); an `if !IsNormalString` guard measured 59ns/1 alloc (P12).
// Byte-transparent for invalid UTF-8 (P9), so it has no failure mode and returns no error.
func NFC(p string) string { return norm.NFC.String(p) }

// CleanNFC is filepath.Clean composed with NFC, in that order — the form every absolute
// path in this module is stored and compared in.
func CleanNFC(p string) string { return NFC(filepath.Clean(p)) }
```

| Option | Verdict |
|---|---|
| **A new leaf package `internal/gitpath`** | **Chosen.** `gitreview` imports no git package at all (`store.go:1-9`), `gitclient/porcelain` imports only `bytes` (`worktree.go:3`), and `gitclient` is the lowest layer — there is no existing package all five consumers (`gitclient`, `porcelain`, `gitrpc`, `gitreview`, and any future one) can import without inverting the layering. A zero-dependency leaf named for its scope matches the precedent of `internal/ipcerr`, `internal/gitprepare`, `internal/gitvsix`, and satisfies SPEC §7's module-boundary rule (git-specific Go code in its own `internal/git*` package). |
| A function in `gitclient` | Rejected: `gitreview` would then import `gitclient` for a two-line function, coupling the review store to the spawn layer. |
| Duplicate it per package | Rejected outright — the mechanism SPEC's row exists to prevent. |
| `filepath.Clean` inside `NFC` | Rejected: `CleanNFC` is a separate name because a few callers (the watcher's event path) need the composition and others (`porcelain`'s parsers, which must not reinterpret git's output as a filesystem path) need only the normalization. |

`CleanNFC` orders `Clean` **before** `NFC` because `Clean` is a pure ASCII-separator operation (P10 proves NFC creates and destroys no `/`), so the two commute — but fixing the order makes the goldens deterministic and stops a reviewer wondering.

### The Go ingestion points

### D5 — Exactly five places in Go normalize, and nowhere else does

**D5a — `gitclient.Identify` (`repo.go:165-219`).** `gitDir`, `commonDir` and `root` change from `filepath.Clean(x)` to `gitpath.CleanNFC(x)` (`:179`, `:180`, `:188`). `repoID` derives from those (`:203-206`) and is therefore normalized for free. This one edit fixes F5 (registry/conn/DB key stability), and — because `RepoSummary` is what `NewRepoWatcher` receives (`gitsession/entry.go`'s construction) and what `repo.open` returns on the wire — supplies the normalized comparand F2 needs and the normalized `root` F12 needs client-side.

**D5b — `gitclient`'s watcher (`watcher.go`).** Two edits: `resolveOrKeep` (`:131-137`) returns `gitpath.CleanNFC(...)` on both its success and fallback paths (`filepath.EvalSymlinks` reads link *targets* from the filesystem, so its output is not guaranteed to inherit `Identify`'s form); and `classify` (`:58-61`) changes `path = filepath.Clean(path)` to `path = gitpath.CleanNFC(path)`. That is the whole of F2's fix: both sides of every `HasPrefix`/`==` in that function are then NFC by construction. The backends are untouched — normalizing `rawEvent.Path` in each of the two would be two edits where one suffices, and `classify` is the seam the file's own D6/D7 comments name as the place repository knowledge lives.

**D5c — `gitclient/porcelain`, two fields and only two.** `ParseWorktreeList`'s `cur.Path = value` (`worktree.go:69`) → `gitpath.NFC(value)`; `ParseRefRows`'s `worktreePath := string(fields[8])` (`refs.go:146`) → `gitpath.NFC(string(fields[8]))`. Both are absolute worktree directories (tier 1). **Every other `string(fields[n])` in this package stays byte-exact** — `status.go:102`, `:124`, `:135`, `:179`, `:183`; `difftree.go:93`, `:102`, `:144`, `:159`. The two edits are what makes F4's `subtractOwnWorktree` comparison sound, together with D5a's normalized `root`.

**D5d — `gitrpc`, the client's directory parameters.** `handleRepoOpen`'s `p.Path` (`handlers.go:222`); `handlePreflightWorktreeAdd`/`Remove`/`WorktreePrepare`'s `p.Path` (`worktree.go:47`, `:68`, `:92`); `handleRepoSettingsSet`'s `WorktreeBasePath` (`settings.go:48`); `handleSettingsSetGitPath`'s `p.GitPath` (`settings.go:103`). Six `gitpath.CleanNFC` calls at the decode site, each immediately after the existing emptiness validation so a blank stays blank.

**D5e — `gitreview`'s stored paths**, per D8.

Not normalized, deliberately, with the reason: `commit.fileDiff`/`file.read`/`file.goToTarget`/`review.mark`/`review.comment.*`'s `path` (tier 2, P7); anything in `gitstore`/`gitwire` (F8 — there is nothing there); `gitsearch` (it matches commit message and ref text, never a path — `grep -n "Path" gitsearch/*.go` finds only `GitPath`, the binary's location); `gitops`' argv builders (branch names and shas, plus tier-1 worktree directories that arrive already normalized from D5d).

### D6 — `repoId` is normalized once, at `entryFor`

`gitrpc/detail.go:43-48` becomes:

```go
func entryFor(c *gitsession.Conn, repoID string) (*gitsession.RepoEntry, error) {
	entry, ok := c.Entry(gitpath.CleanNFC(repoID))   // G27 D6
	...
}
```

plus the same wrap at `graph.go:179`'s direct `c.Entry(repoID)`. F6 establishes these two are the complete set. Two lines cover every one of the ~40 path-bearing methods, and a persisted pre-G27 `repoId` in an old `App.vue` state blob resolves against a post-G27 registry rather than erroring.

| Option | Verdict |
|---|---|
| **Normalize at `entryFor`/`c.Entry` call sites in `gitrpc`** | **Chosen.** Two edits, at the layer that owns wire ingestion, leaving `gitsession.Conn` a pure map lookup with no opinion about string forms. |
| Normalize inside `gitsession.Conn.Entry` | Rejected: it would make `gitsession` — the session/cache layer — import `gitpath` and quietly rewrite its callers' arguments, and `Conn.alreadyHeld`/`CloseRepo`/`Walk`/`WalkFor`/`ReviewWalkFor`/`markWalksStale` would each need the same treatment for consistency. Six edits instead of two, in the wrong layer. |
| Normalize in each of the ~40 handlers | Rejected — this is literally the per-site patching SPEC forbids. |

### The client side

### D7 — Four filesystem-ingestion points in the extension; `packages/git-ui` untouched

`packages/git-core/src/util/nfcPath.ts` (new, beside the existing `nulSplit.ts` and `assert.ts`):

```ts
/** G27 D7 — NFC-canonicalise an absolute path taken from the filesystem (a VS Code
 *  `Uri.fsPath`, a folder picker's result) before it is compared with, or sent as, a
 *  path the Go server produced. Never applied to a repository-relative path: those go
 *  back to git as pathspecs, where the byte form must be git's own (plan P7). */
export const nfcPath = (p: string): string => p.normalize('NFC');
```

Applied at exactly four sites, all of them filesystem boundaries:

1. `apps/kira-studio-vscode/src/ports/workspaceRoots.ts:12` — `path: nfcPath(folder.uri.fsPath)`. **This alone fixes F12**, without touching `RepoPicker.vue`.
2. `apps/kira-studio-vscode/src/ports/dialogs.ts:17` — `return picked?.[0]?.fsPath ? nfcPath(...) : null`. Covers `repo.pick` and the worktree-location picker.
3. `apps/kira-studio-vscode/src/extension.ts:150`, `:248`, `:638` — the three direct `workspaceFolders?.[0]?.uri.fsPath` reads (settings migration, status-bar tooltip, `openRepository`'s auto-open). `:638` is the one that matters: it is the path `repo.open` receives on every G12-item-6 auto-open.

`String.prototype.normalize` is ES2015, available in every Node the extension host runs and in the webview; no polyfill, no dependency.

**`packages/git-ui` gets no change at all** (F12/F13), which keeps SPEC's *"`packages/git-ui` — **Unchanged**"* rule intact for one more phase.

### D8 — `review.db` gets an idempotent, SQL-prefiltered Go sweep, not a SQL migration

The problem: a pre-G27 build stored `review_session.repo_id` in whatever form the client sent (F5) and `review_file.path` in whatever form git reported. After D5a, `repo_id` lookups use NFC; a session row stored under an NFD repo path becomes unreachable and the user's review state on that repository silently resets.

SQLite cannot normalize — it has no Unicode normalization function, and `migrations.All()` (`gitreview/migrations/embed.go`) runs SQL only. So:

```go
// normalizeStoredPaths (G27 D8): re-keys rows written before G27 normalized RepoID.
// Idempotent and self-disabling — the GLOB pre-filter matches only rows containing a
// byte outside printable ASCII, which is zero rows for essentially every install, so
// the steady-state cost is one index-free scan of a table with a few hundred rows.
// Called from migrate() after the SQL loop; needs no version of its own precisely
// because it is idempotent.
const nonASCII = `*[^ -~]*`
```

- `UPDATE OR REPLACE review_session SET repo_id = ? WHERE repo_id = ?` for each distinct `repo_id GLOB nonASCII` whose `CleanNFC` differs.
- `UPDATE OR REPLACE review_file SET path = ?` / `review_range SET path = ?` / `UPDATE review_comment SET path = ?` for each distinct `path GLOB nonASCII` that differs — **tier 2 paths, and D2 says never normalize those.** They are normalized *here anyway*, and the reason is specific: a `review_file.path` is never handed to git as a pathspec (`incremental.go` always uses the *live* `ch.Path` from the current diff for its git calls; the stored path is a lookup key only, `store.go:179`'s `out[rec.Path]`). Making the stored key NFC while the live comparand is byte-exact would *break* the join at `incremental.go:442`. **So the sweep must normalize the stored path to match what the live diff will report — which, post-D3, is git's own precomposed form.** Recorded as the one deliberate crossing of D2's line, with its justification, rather than left as an inconsistency.

  Concretely: the sweep rewrites a stored path only when `gitpath.NFC(p) != p`, i.e. only when the stored bytes are *not* what a post-D3 git will report. That is exactly the set of rows that would otherwise be orphaned.
- `UPDATE OR REPLACE`'s conflict resolution deletes the colliding row and applies the update: if both an NFD and an NFC row exist for the same `(session_id, path)`, **the normalized row survives** and the stale one is dropped. Documented in the function's comment; `review_range`'s `ON DELETE CASCADE` cleans its children.

Alternatives: a blunt `DELETE FROM review_file WHERE path GLOB '*[^ -~]*'` migration (rejected — it also destroys correct NFC non-ASCII rows, which are the majority of non-ASCII rows); doing nothing and letting G11's 14-day TTL reap the orphans (rejected — review state is work product, and "your review resets once on upgrade" is the exact user-visible symptom this phase exists to prevent); extending the migration runner to accept Go steps (rejected — a structural change to a shared mechanism for a one-off, when idempotence makes versioning unnecessary).

### D9 — No `kira.db` migration; `git_repo_settings` self-heals

`git_repo_settings(repo_id, key)` (`storage/migrations/0017`) has the same orphaning exposure. It gets **no sweep**, for a stated reason: its contents are *preferences* (`graph.pageSize`, `graph.scope`, `stash.showInGraph`, `worktree.basePath`, `worktree.prepareScript`), and an orphaned row means one repository falls back to schema defaults once and re-persists on the next change — recoverable in one click, unlike review state. The one entry with teeth is G25 D11's sha256-pinned prepare-script approval, and losing *that* re-prompts the user for approval, which is the safe direction for a security gate. Adding a Go sweep to `internal/storage` would also put git-module logic in a studio-module package for a benefit measured in one settings dialog.

### The contract and the guards

### D10 — `CONTRACT_VERSION` stays **29**

No new request, no new event, no new type, no new field, no removed field, no changed field type, no new `OpRequest` kind, no new `OpErrorKind`, no new capability, no new setting leaf, no new `UiActionKind`. The **only** wire-visible change is that the *bytes* inside three already-existing string fields (`RepoSummary.repoId`, `.root`, `.gitDir`, and `WorktreeEntry.path`) are now guaranteed NFC.

`CONTRACT_VERSION` is defined (`validate.ts:83`'s neighbourhood, SPEC §3.4) as the **structural** compatibility authority for a hard-lockstep handshake, and the two artefacts ship together in one DMG (G10). A byte-content invariant is not a shape change, and bumping for it would be the first bump in the chapter that does not correspond to a contract diff — devaluing the signal for every future reader of `validate.ts`'s bump log. The one scenario a bump would guard — a v29 client with a pre-G27 server — is already impossible: same release, same bundle, and the handshake refuses a mismatch outright.

**Explicitly recorded so a later phase claims 30 knowing 29 was not re-spent here.**

### D11 — No totality guard is touched, and §7.2 proves it

Per F16: `opTable` stays at twenty entries / six `Undoable`; `MutatingAction`, `MUTATING_COMMANDS`, `OTHER_COMMANDS`, `OP_ERROR_TEXT`, `UiActionKind`, `contributes.commands` and `contributes.configuration` are all untouched. This phase adds no operation, no error kind, and no user-invocable action — it changes the byte form of strings that already cross those surfaces. Stated as a decision rather than an omission because every phase since G17 has had to reason about these, and "nothing to do" is itself a finding a reviewer should be able to check.

### D12 — Tests are built from byte literals, never from the host filesystem

The problem the SPEC row implies and this decision answers: CI runs on Linux (this container: ext2/ext3, P1), where NFD and NFC are two different files and git precomposes nothing. **No test may depend on the OS producing an NFD name.**

- **`internal/gitpath/gitpath_test.go`** — a table test whose inputs are explicit `string([]byte{...})` / `\u`-escaped literals, so the source file's own encoding cannot silently normalize them:

  | Case | Input bytes | Expected |
  |---|---|---|
  | Latin, decomposed | `63 61 66 65 cc 81 2e 74 78 74` (`cafe`+U+0301) | `63 61 66 c3 a9 2e 74 78 74` |
  | Latin, already composed | `63 61 66 c3 a9 2e 74 78 74` | unchanged (idempotence) |
  | **Hangul, decomposed jamo** | `e1 84 92 e1 85 a1 e1 86 ab …` (`한글.md`) | `ed 95 9c ea b8 80 …` (P4) |
  | Hangul, precomposed | `ed 95 9c ea b8 80 …` | unchanged |
  | Pure ASCII | `internal/gitclient/porcelain/status.go` | unchanged, and `NFC(s) == s` |
  | Singleton | U+2126 OHM SIGN | U+03A9 (P5 — asserted so the behaviour is *documented*, not discovered later) |
  | Compatibility char | U+FB01 `ﬁ` | **unchanged** (P6 — the NFKC guard rail) |
  | Combining-mark reorder | `61 cc a7 cc 81` | `c3 a1 cc a7`, equal to `NFC(61 cc 81 cc a7)` (P5) |
  | Invalid UTF-8 | `61 ff 62`, `61 c3`, `c3 28` | unchanged, byte for byte (P9/F15) |
  | Separator/NUL safety | `61 cc 81 2f 62 2f 63`, `61 cc 81 00 62` | slash count and NUL preserved (P10) |
  | `CleanNFC` | `/a/./b/../café/` with a decomposed `é` | `/a/café` composed |

  The two golden pairs SPEC names (U+00E9 vs U+0065 U+0301; a Hangul syllable in both forms) are the first and third rows, and they prove the function is right regardless of the platform CI happens to run on.

- **`gitclient/runner_test.go`** — the two existing argv goldens (`:40-52`, `:54-66`) gain `"-c", "core.precomposeunicode=true"` in position 2. Byte-exact, so a reordering or a typo fails.
- **`gitclient/watcher_test.go`** — one `classify` case: a `summary` whose `CommonDir` is NFC and an event path spelled NFD for the same directory ⇒ `SignalRefsChanged, true`. This is F2's regression guard and it needs no filesystem at all (`newRepoWatcherWith` already takes a fake backend, `:159-161`).
- **`gitsession/refs_test.go`** — one `subtractOwnWorktree` case: `CheckedOutIn` NFD, `ownRoot` NFC, same directory ⇒ `CheckedOutIn` becomes `nil`. F4's guard. (The production fix is D5a+D5c normalizing both sides; the test asserts the *outcome*, so it keeps holding if the mechanism moves.)
- **`gitclient/porcelain/worktree_test.go`, `refs_test.go`** — one case each: a decomposed `worktree`/`%(worktreepath)` value parses to its composed form; a decomposed **repo-relative** path in `status`/`diff-tree` parses **unchanged** (the tier-2 guard — this is the test that stops a future contributor "finishing the job" and breaking P7).
- **`gitreview/store_test.go`** — the sweep: an NFD row is re-keyed; an NFD row colliding with an existing NFC row leaves exactly one row, the NFC one, with its ranges intact; an all-ASCII database is untouched and the sweep runs a second time with no further change (idempotence).
- **`packages/git-core/src/util/nfcPath.test.ts`** — the same é and Hangul pairs, written as `\u` escapes.

**No new `porcelain/testdata` fixture file.** The corpus is a recorded-bytes corpus of real git output (F11), and this phase has no real macOS git output to record; hand-authored byte literals in the test file are more legible and cannot be silently re-encoded by an editor. (`testdata/handAuthored/` sets the precedent that not everything has to be a recording.)

### D13 — Normalization changes bytes, never meaning, and never what the user reads

A user who names a file `café.txt` and sees `café.txt` in the file tree is looking at the same grapheme cluster either way: NFC and NFD are **canonically equivalent** by Unicode's own definition, and every conforming renderer draws them identically. Nothing the user typed is altered; nothing is transliterated, case-folded, stripped, or transliterated. The two cases where a reader might notice are both handled:

- **P5's singletons** (U+2126 → U+03A9): visually identical glyphs, and Unicode itself declares OHM SIGN deprecated in favour of GREEK CAPITAL OMEGA — this is the mapping's purpose.
- **P6's compatibility characters** (`ﬁ` → `fi`) would be visible — and are **excluded by D1's rejection of NFKC**, tested for at D12's seventh row.

And, because of D2 tier 2, the only strings a user sees that this phase touches at all are *directory* paths (a repo root in the picker tooltip, a worktree path in a badge). Every filename in the file tree, every diff header, every review row is byte-identical to today.

---

## 3. The Go side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 3.1 | `internal/gitpath/gitpath.go` | **new** | `NFC`, `CleanNFC`, and the doc comments carrying D2's provenance rule and P7/P11/P12's citations (D4) |
| 3.2 | `internal/gitpath/gitpath_test.go` | **new** | D12's byte-literal table — the é pair, the Hangul pair, ASCII, singleton, compatibility, mark-reordering, four invalid-UTF-8 forms, separator/NUL safety, `CleanNFC` composition, idempotence on every row |
| 3.3 | `internal/gitclient/runner.go` | edited | One `-c core.precomposeunicode=true` pair in `configOverrides` (`:98-103`), with a comment naming F3 as the reason and P2 as the cross-platform-safety evidence (D3) |
| 3.4 | `internal/gitclient/runner_test.go` | edited | The two argv goldens (`:40-52`, `:54-66`) gain the pair in position 2 |
| 3.5 | `internal/gitclient/repo.go` | edited | `Identify`: `filepath.Clean` → `gitpath.CleanNFC` at `:179`, `:180`, `:188`; a comment on `repoID` (`:203-206`) recording that its stability against two spellings of one repository is what F5 depends on (D5a) |
| 3.6 | `internal/gitclient/repo_test.go` | edited | `Identify` over a fake runner whose `rev-parse` output is decomposed ⇒ `RepoID`/`Root`/`GitDir`/`CommonDir` all composed, and `IsLinkedWorktree`'s `gitDir != commonDir` still correct |
| 3.7 | `internal/gitclient/watcher.go` | edited | `resolveOrKeep` (`:131-137`) returns `gitpath.CleanNFC` on both arms; `classify` (`:61`) normalizes its `path`; the `rawEvent` doc comment at `:96-97` corrected — the backends agree with `classify` because `classify` normalizes, not because they were already equal (D5b) |
| 3.8 | `internal/gitclient/watcher_test.go` | edited | F2's regression case: NFD event path against an NFC `CommonDir` ⇒ `SignalRefsChanged` |
| 3.9 | `internal/gitclient/porcelain/worktree.go` | edited | `cur.Path = gitpath.NFC(value)` (`:69`) — tier 1, one field (D5c) |
| 3.10 | `internal/gitclient/porcelain/refs.go` | edited | `worktreePath := gitpath.NFC(string(fields[8]))` (`:146`) — tier 1, one field (D5c) |
| 3.11 | `internal/gitclient/porcelain/{worktree,refs,status,difftree}_test.go` | edited | Four cases: the two tier-1 fields normalize; `status`'s and `diff-tree`'s repo-relative paths **do not** (the tier-2 guard, D12) |
| 3.12 | `internal/gitrpc/detail.go` | edited | `entryFor` wraps `repoID` in `gitpath.CleanNFC` (`:44`), with D6's comment (D6) |
| 3.13 | `internal/gitrpc/graph.go` | edited | The one direct `c.Entry(repoID)` (`:179`) gets the same wrap |
| 3.14 | `internal/gitrpc/handlers.go` | edited | `handleRepoOpen` normalizes `p.Path` after its existing validation (`:222`) (D5d) |
| 3.15 | `internal/gitrpc/worktree.go` | edited | `p.Path` normalized in `handlePreflightWorktreeAdd` (`:47`), `handlePreflightWorktreeRemove` (`:68`), `handleWorktreePrepare` (`:92`) (D5d) |
| 3.16 | `internal/gitrpc/settings.go` | edited | `WorktreeBasePath` (`:48`) and `GitPath` (`:103`) normalized (D5d) |
| 3.17 | `internal/gitrpc/handlers_test.go` | edited | A `Router` over a fake runner: `repo.open` with a decomposed path, then every subsequent request with the **composed** `repoId` the result carried, resolves — and the reverse (open composed, request decomposed) resolves too, proving D6 |
| 3.18 | `internal/gitreview/normalize.go` | **new** | `normalizeStoredPaths(db)` — D8's four `GLOB '*[^ -~]*'`-prefiltered rewrites, `UPDATE OR REPLACE` collision rule, idempotent, no version of its own |
| 3.19 | `internal/gitreview/migrate.go` | edited | One call to `normalizeStoredPaths` after the migration loop (`:72`), inside the same lazy-open path |
| 3.20 | `internal/gitreview/normalize_test.go` | **new** | D12's four sweep cases (re-key, collision, ASCII no-op, idempotence) |
| 3.21 | `go.mod` | **unchanged** | `golang.org/x/text v0.41.0` is already a direct require (`:35`); `unicode/norm` is a subpackage of it. `go.sum` unchanged. **No new module.** |
| 3.22 | Not edited | — | `gitstore/*`, `gitwire/*` (F8 — no path exists there); `gitsearch/*` (matches message/ref text only); `gitops/*` (branch names, shas, and already-normalized worktree dirs); `gitpreflight/*` (**pure functions whose inputs are fixed upstream** — F3's intersections become correct because D3 makes `status` agree with the index, not because the classifier changes); `internal/storage/*` (D9 — no migration); `bridge/*`, `gitsock/*`, `gitaskpass/*`, `ghclient/*`, `gitprepare/*`, `gitvsix/*` |

---

## 4. The TypeScript / Vue side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 4.1 | `packages/git-core/src/util/nfcPath.ts` | **new** | `nfcPath`, three lines, with D7's doc comment stating the tier-2 exclusion |
| 4.2 | `packages/git-core/src/util/nfcPath.test.ts` | **new** | The é and Hangul pairs as `\u` escapes; ASCII idempotence; the NFKC guard rail (`ﬁ` unchanged) |
| 4.3 | `packages/git-core/src/index.ts` | edited | Re-export `nfcPath` alongside the existing `util/*` exports |
| 4.4 | `apps/kira-studio-vscode/src/ports/workspaceRoots.ts` | edited | `path: nfcPath(folder.uri.fsPath)` (`:12`) — **this is F12's whole fix** |
| 4.5 | `apps/kira-studio-vscode/src/ports/dialogs.ts` | edited | `pickFolder` returns `nfcPath(...)` (`:17`) |
| 4.6 | `apps/kira-studio-vscode/src/extension.ts` | edited | The three direct `workspaceFolders?.[0]?.uri.fsPath` reads (`:150`, `:248`, `:638`) wrapped |
| 4.7 | Not edited | — | **`packages/git-ui` in its entirety** (F12/F13 — fixing ingestion in 4.4 fixes `RepoPicker.vue:33` without touching it; SPEC's "unchanged" rule holds); `virtualKey.ts` (opaque round-trip of our own bytes, F13); `proxyHandlers.ts` (`repoRoots` is keyed on a Go-produced `repoId` on both sides); `virtualFileDecoration.ts` (`fs.stat` is form-insensitive, F9); `packages/git-ipc/*` (**no contract change**, D10 — `validate.ts`'s `CONTRACT_VERSION` stays 29 and gains no bump comment); `gitWire.fbs`, `codec.ts` (F8); `commands.ts`, `commands.test.ts`, `package.json` (D11 — no new command, no new setting) |

---

## 5. Dependencies and tooling

Nothing new. `golang.org/x/text` is already a **direct** `require` (`go.mod:35`) and `golang.org/x/text/unicode/norm` is a subpackage of the module already in the cache — `go.mod` and `go.sum` are untouched. `String.prototype.normalize` is ES2015, in every Node and browser target this repo builds for; no npm package. `core.precomposeunicode` is core git config, understood by every version (and harmlessly ignored where unsupported, P2), far below the 2.38 floor (`gitclient/discovery.go:16-19`). No `flatc` regeneration (F8), no SQL migration in either database (D8's sweep is Go; D9 declines one), no new settings leaf, no new capability.

---

## 6. Implementation order

1. **Probes M1–M5 on a real Mac**, recorded in the first commit message alongside P1–P12. M2 is a gate: if filesystem lookup turns out to be normalization-*sensitive* on the tester's volume, D2 tier 1 is unsound and the design must be revisited before any code lands.
2. `internal/gitpath` + its table test. **Independently green here**, with no other file touched.
3. `gitclient/runner.go`'s one config pair + the two argv goldens (D3). Small, isolated, its own reviewable commit — it is the highest-leverage single line in the phase and deserves to be readable on its own.
4. `gitclient/repo.go` + `repo_test.go` (D5a). The registry/DB key fix.
5. `gitclient/watcher.go` + `watcher_test.go` (D5b). F2's fix.
6. `gitclient/porcelain`'s two fields + the four parser tests including both tier-2 negatives (D5c). The negatives matter as much as the positives.
7. `gitsession/refs_test.go`'s `subtractOwnWorktree` case — **no production change**, asserting that steps 4 and 6 together fixed F4.
8. `gitrpc`'s eight normalization points + `handlers_test.go`'s round-trip (D5d/D6).
9. `gitreview/normalize.go` + `migrate.go`'s call + `normalize_test.go` (D8). The only data-rewriting code in the phase; its own commit.
10. `packages/git-core/src/util/nfcPath.ts` + test + the `index.ts` export.
11. `apps/kira-studio-vscode`'s four ingestion sites (D7). **Expect `tsc` and `bun run test:unit` to stay green throughout** — unlike G26, nothing here breaks a totality guard, and a break would mean something in this plan is wrong.
12. Full check pass, plus the §7.2 grep audits.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` (chapter-scoped per SPEC's verification-scope note: `gitclient`, `gitclient/porcelain`, `gitclient/catfile`, `gitclient/logsession`, **`gitpath`**, `gitpreflight`, `gitops`, `gitreview`, `gitsession`, `gitrpc`, `gitsock`, `gitstore`, `gitwire`, `bridge`, `bridge/rpcstream`, `internal`) passes under `-race`.
2. `gitpath.NFC` satisfies every row of D12's table, including both SPEC-named golden pairs: `cafe`+U+0301 → `caf`+U+00E9, and decomposed Hangul jamo → `한글`.
3. `gitpath.NFC` leaves all four invalid-UTF-8 inputs byte-for-byte unchanged, and `NFC(NFC(x)) == NFC(x)` for every row.
4. `gitpath.NFC("ﬁle.txt") == "ﬁle.txt"` — the NFKC guard rail.
5. `buildArgv(Spec{Args:["status"]})` is byte-exactly `["-c","core.quotepath=false","-c","core.precomposeunicode=true","-c","color.ui=false","-c","log.showSignature=false","-c","i18n.logOutputEncoding=UTF-8","--no-pager","status"]`, and the `ReadOnly` variant is the same with `--no-optional-locks` before `log`.
6. `Identify` over a fake runner emitting decomposed `rev-parse` output returns composed `RepoID`/`Root`/`GitDir`/`CommonDir`, and `IsLinkedWorktree` is still computed correctly from them.
7. `classify` matches an NFD event path against an NFC `CommonDir` (`refsChanged`), and against an NFC `GitDir`'s `index` (`worktreeChanged`).
8. `subtractOwnWorktree` clears `CheckedOutIn` when it and `ownRoot` are two spellings of one directory.
9. `porcelain.ParseWorktreeList` and `ParseRefRows` compose their absolute-path fields; `ParseStatus` and `ParseNameStatus`/`ParseNumstat` leave a decomposed **repo-relative** path byte-exact.
10. A `Router` over a fake runner: `repo.open` with a decomposed path, then `refs.list`/`status.get`/`commit.detail` with the composed `repoId` from the result — all resolve; and the mirror case (open composed, request decomposed) resolves too.
11. `gitreview`'s sweep re-keys an NFD row, collapses an NFD/NFC collision to the single NFC row with its `review_range` children intact, leaves an all-ASCII database untouched, and is a no-op on a second run.
12. `bun run test:unit`, `bun run lint`, `bun run typecheck`, `bun run build:vscode`, `bun run test:webview` all pass.
13. `CONTRACT_VERSION` and `ContractVersion` are **both still 29**, and `git diff` shows **no change** to `packages/git-ipc/src/contract.ts` or `validate.ts`.

### 7.2 Tier 2 — reasoned check over the diff

14. A grep of the diff finds `gitpath.NFC` / `gitpath.CleanNFC` at **exactly** the sites §3 lists, and nowhere else. In particular: **zero** occurrences in `gitpreflight/`, `gitops/`, `gitstore/`, `gitwire/`, `gitsearch/`, or `internal/storage/`.
15. **No call to `gitpath.*` is reachable from a value that is later passed to a git argv builder as a pathspec or a `<rev>:<path>` operand.** Checked by reading `porcelain.FileDiffArgs`, `WorktreeDiffArgs`, `NoIndexDiffArgs` and both `catfile` request paths and confirming each still receives an un-normalized, git-sourced `Path`. **This is D2 tier 2, and it is the one invariant whose violation is a functional regression rather than a missed fix.**
16. `normalize`/`normalize('NFC')` appears in the TS diff only at `nfcPath.ts` and is *called* only at the four D7 sites — never on a repo-relative path, never in `packages/git-ui`.
17. `opTable` still has twenty entries with six `Undoable`; `MutatingAction`, `MUTATING_COMMANDS`, `OTHER_COMMANDS`, `OP_ERROR_TEXT`, `UiActionKind`, `contributes.commands` and `contributes.configuration` are all unchanged (D11).
18. `go.mod`/`go.sum`/`package.json`/`bun.lock` are unchanged.
19. `git diff --stat -- packages/git-ui` is empty.

### 7.3 Tier 3 — needs a human on a Mac with a real repository

20. **M1–M5 run and recorded.** M2 in particular: a file created as NFC is `stat`-able by its NFD spelling and vice versa. If it is not, stop and re-plan.
21. **M5's outcome recorded**: whether `git worktree list --porcelain`'s `worktree` value, `for-each-ref`'s `%(worktreepath)`, and `rev-parse --show-toplevel` agree byte-for-byte for a worktree whose directory name contains `é`. A disagreement is F4 observed live; agreement means D5a+D5c are belt-and-braces, which is still the right call.
22. A repository cloned into `~/Développement/café/` (both components non-ASCII, created through Finder so they are whatever form Finder produces): open it in the extension, confirm the graph loads, then **touch a file in a terminal and confirm the graph refreshes within a second** — F2's fix, end to end. Before the fix, confirm it does *not* refresh (the bug, observed once, so the fix is provably a fix).
23. In that repository, open it a second time from a *different* window via the folder picker: **exactly one `RepoEntry`** (verifiable from the *Connected editors* pane and from the absence of a second `cat-file` process) — F5.
24. In that repository, `git switch` a branch in a terminal, then in the app attempt to check out the branch you are already on: **no `worktreeConflict` blocker** — F4.
25. Create an untracked file with an accented name that the target branch also adds, in a repo with `core.precomposeunicode=false` forced into `.git/config`: `preflight.checkout` raises `blockedByUntracked` and names the file — **F3, the phase's headline hazard.** Confirm it does *not*, with the D3 line reverted, so the fix is demonstrated rather than assumed.
26. Add a review comment and mark a file reviewed on a file with an accented name; close and reopen the review; the state persists — F7.
27. `git worktree add` a directory with an accented name through the app; it appears in the worktree list with `isCurrent` correct, and can be removed — F4/M5.
28. Upgrade path: with a **pre-G27** build, review a file with an accented name in a repository at an accented path; upgrade; the review state is still there — D8's sweep.

### 7.4 The checklist

- [ ] Canonical form is **NFC**, applied through the single `internal/gitpath` function; NFKC/NFKD appear nowhere.
- [ ] `gitpath.NFC` is unguarded — no `IsNormalString` fast-path check (P11/P12).
- [ ] **Absolute/directory paths** are normalized at ingestion: `Identify`, the watcher's `classify` and `resolveOrKeep`, `porcelain`'s two absolute-path fields, `entryFor`, and the six `gitrpc` directory params.
- [ ] **Repository-relative file paths are never normalized** — in Go or in TS — and §7.2's item 15 proves it.
- [ ] `-c core.precomposeunicode=true` is in `configOverrides`, in both argv goldens.
- [ ] The watcher's `classify` compares two NFC strings on every arm.
- [ ] `subtractOwnWorktree` no longer depends on two git mechanisms agreeing byte-for-byte.
- [ ] `review.db`'s sweep is idempotent, SQL-prefiltered on non-ASCII, and resolves a key collision in favour of the normalized row.
- [ ] No `kira.db` migration; no SQL migration in either database.
- [ ] `CONTRACT_VERSION` / `ContractVersion` both **still 29**; `contract.ts` and `validate.ts` untouched.
- [ ] `packages/git-ui` untouched; `gitwire`/`gitstore`/`gitsearch`/`gitops`/`gitpreflight` untouched.
- [ ] No new Go module, no new npm package, no `flatc` run.
- [ ] Every test's NFC/NFD inputs are byte literals in source, not products of the host filesystem.

---

## 8. Explicit non-goals for G27

- **Normalizing repository-relative file paths.** P7 is the reason, D2 tier 2 is the rule, §7.2 item 15 is the guard. Restated here because it is the most likely thing for a well-meaning future contributor to "finish".
- **NFKC / NFKD anywhere.** P6: compatibility decomposition changes what a filename *is*.
- **Case folding.** macOS is case-**insensitive** by default, which is a second, entirely separate bug class (`README.md` vs `readme.md` resolving to one file while comparing unequal). It is not what SPEC `:340` asks for, it interacts with git's own `core.ignorecase`, and it needs its own audit. Named so its absence is a decision, not an oversight.
- **A `kira.db` / `git_repo_settings` sweep** — D9's argument: preferences self-heal in one click; a lost prepare-script approval re-prompts, which is the safe direction.
- **Changing `gitpreflight`'s classifiers.** F3's intersections become correct because D3 makes git's own output self-consistent, not because the pure functions learn about Unicode. Teaching them would put normalization *at the comparison site* — exactly what SPEC forbids — and would break F10's currently-correct `ClassifyStashPop`.
- **Fixing non-UTF-8 filenames end to end.** F15 shows `gitpath.NFC` is byte-transparent for them, but Go's `encoding/json` replaces invalid UTF-8 with U+FFFD on marshal, so such a path would still be corrupted on the wire. APFS rejects non-UTF-8 filenames outright, so this is unreachable on the target platform; recorded, not fixed.
- **A `--porcelain` fixture recording from a real macOS repository.** F11's corpus is a recording corpus and this phase has no recording to add; D12's byte literals are the honest alternative.
- **Normalizing branch names, tag names, remote names, refspecs, shas, or stash selectors.** Shas are hex. Ref names are subject to `git check-ref-format`, and while it does not forbid non-ASCII, a ref name is a *git object identifier* compared byte-wise by git itself against `packed-refs` and `refs/**` — normalizing one has exactly P7's failure mode with none of tier 1's safety. `gitpreflight`'s protected-branch glob matcher, `gitops`' argv builders, and G26's `branch.<name>.kirastack*` config keys all stay byte-exact.
- **Normalizing commit messages, author names, or any display text.** Non-ASCII, yes; compared for equality, no. `gitsearch`'s matcher is a *substring* search over message text where the user's query and the corpus are both arbitrary text — normalizing either would be a search-semantics change (a real feature, arguably a good one: "make search normalization-insensitive"), deliberately not smuggled in here. §9 prices it.
- **A `CONTRACT_VERSION` bump.** D10.
- **Any `docs/v1.3/SPEC.md` edit** — the convention every phase since G12 has followed. This plan's correction of the SPEC row's "from git output and from the filesystem alike" instruction lives here, in D2, not in the SPEC.

---

## 9. Handed forward

- **Case-insensitivity on macOS** is the sibling bug class and is genuinely larger than this one: it interacts with `core.ignorecase`, with git's own index, and with the question of whether two differently-cased paths are one file. If it is taken up, `internal/gitpath` is the right home and `CaseFoldNFC` the right shape — but the audit must be redone, because tier 2 (never normalize a path going back to git) applies just as hard and the tier-1 set is different (`RepoID` on a case-insensitive volume is a *stronger* candidate for folding than it is for NFC).
- **Normalization-insensitive search.** `gitsearch`'s literal matcher (`gitsearch/literal.go`) and the client-side matcher would both need to fold their needle and their corpus, and G23's own RE2-vs-`RegExp` reconciliation constraint (SPEC "Known open items") means the two halves must agree exactly or a hit's presence depends on which page is loaded. A real feature with a real design cost; not smuggled into a correctness phase.
- **A macOS fixture corpus for `porcelain`.** Once someone has a Mac in the loop regularly, recording a `status --porcelain=v2 -z` from a repository with an NFD untracked file under `core.precomposeunicode=false` would turn D12's reasoned tier-2 negatives into recorded ones. F11 shows the corpus has never had a non-ASCII byte; that is worth fixing whenever the opportunity is cheap.
- **G28 (branch-scoped stash)** inherits this phase's rules unchanged: its auto-stash and cross-branch apply operate on stash entries and branch names (byte-exact, §8) and on `merge-tree` predictions whose paths are tier 2. Its one new tier-1 surface, if it stores anything per-repo, is a `repo_id` — which D5a has already normalized by the time it sees one.
- **G30–G32's review rounds** should treat §7.2 item 15 as a standing invariant, not a one-off check: "a normalized path reaching a git argv builder" is the specific regression this phase's design makes possible, and it would be silent.
- **The `-c core.precomposeunicode=true` divergence** (§10.3) is worth revisiting if a user ever reports the app and their terminal disagreeing about `git status` in one repository. The remedy would be to surface the repo's own `core.precomposeunicode=false` as a warning rather than to drop the override.

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 — Departing from SPEC `:340`'s literal instruction ("normalize … from git output and from the filesystem alike"). (The big one.)** **Recommendation: depart, exactly as D2.** The instruction was written before the audit, and probe **P7** shows it is unsafe as stated: normalizing a repository-relative path and handing it back to git produces `fatal: path 'café.txt' does not exist in 'HEAD'` against an NFD tree entry, and a silently empty `git diff --name-only`. That converts a comparison bug into a hard functional break in the one direction the SPEC row explicitly worries about ("breaking any path comparison, map lookup, or cache key"). D2 still honours the row's *actual* rule — normalize once at an ingestion boundary, never per-comparison — by normalizing every path this app compares (all of which turn out to be absolute directory paths, F2/F4/F5) and by making git itself produce one consistent form for the rest (D3). If overridden, the fallback is to normalize repo-relative paths **and** carry the original bytes alongside every one of them for egress — roughly doubling every path-bearing struct in `porcelain`, `gitsession` and the wire, for a case D3 already covers.

**10.2 — `internal/gitpath` as a new package rather than a function in an existing one.** **Recommendation: the new package (D4).** Five packages need it — `gitclient`, `gitclient/porcelain`, `gitrpc`, `gitreview`, and any future one — and there is no existing package all five can import without inverting the layering: `porcelain` imports only `bytes`, and `gitreview` imports no git package at all. A ~40-line zero-dependency leaf matches `internal/ipcerr`'s precedent exactly. The alternative that almost works — putting it in `gitclient` — makes the review store depend on the spawn layer for one function.

**10.3 — Forcing `-c core.precomposeunicode=true` over a repository's own explicit `false`.** **Recommendation: force it (D3), and say so in the plan rather than bury it.** It is the only thing that makes `git status`'s readdir-sourced untracked entries agree with the index inside a single command's output, which is what F3's safety-blocker miss depends on — and probe **M3** expects it to be a *restatement* of the value git itself wrote at `init`/`clone` for essentially every repository a Mac user has. The honest cost: in a repository whose config says `false` explicitly, our `git status` will differ from the user's terminal `git status`. That population is approximately "people who deliberately set an escape-hatch config key", and the failure they get today (a checkout the app calls safe and git then refuses) is worse than the inconsistency they would get. If overridden, F3 stays live and the fallback is to *detect* `core.precomposeunicode=false` per repository and surface it as a warning — one extra spawn per `repo.open` and a new UI surface, for strictly less safety.

**10.4 — `CONTRACT_VERSION` stays 29.** **Recommendation: no bump (D10).** Nothing about the wire's *shape* changes: no request, no event, no type, no field, no kind. Only the bytes inside four already-existing string fields are now guaranteed NFC. The two artefacts ship in one DMG under a hard-lockstep handshake (SPEC §3.4), so the mixed-version case a bump would guard cannot occur; and bumping for a byte-content invariant would be the chapter's first bump with no contract diff behind it, which devalues `validate.ts`'s bump log as a change record. Recorded explicitly so G28 claims 30 knowing 29 was not re-spent.

**10.5 — Sweeping `review.db` rather than letting the TTL absorb it.** **Recommendation: sweep (D8).** Review state is *work product* — marked-reviewed files and inline comments the user typed — and "your review silently resets once, on upgrade, only for files with accented names" is precisely the class of failure this phase exists to eliminate. The sweep is ~40 lines, is idempotent (so it needs no schema version of its own), and its `GLOB '*[^ -~]*'` pre-filter matches zero rows for essentially every install, so the steady-state cost is one scan of a small table at lazy-open. The collision rule — `UPDATE OR REPLACE`, normalized row wins — is stated in the code because a silent row deletion should never be inferred from a SQL keyword.

**10.6 — Declining the same sweep for `kira.db`'s `git_repo_settings`.** **Recommendation: decline (D9).** Its contents are preferences that fall back to schema defaults and re-persist on the next change, and its one security-relevant entry (G25 D11's sha256-pinned prepare-script approval) re-prompts on loss, which is the safe direction. Doing it would also put git-module data logic inside `internal/storage`, a studio-module package, for a benefit measured in one settings dialog. Named as a decision so its asymmetry with 10.5 is visible and defended rather than looking like an oversight.

**10.7 — Correcting SPEC's premise about the watcher rather than inventing the site it predicts.** **Recommendation: state F1 plainly.** `internal/gitclient/watcher.go` emits two coarse `Signal` constants and reports no file path to anything, so the specific comparison SPEC `:340` names does not exist in this codebase. The audit says so, then names the *real* watcher hazard it found instead (F2: an NFD event path failing to prefix-match an NFC `CommonDir`, silencing the watcher entirely for a repository at a non-ASCII path) — which is strictly worse than the predicted one and would not have been found by looking for what the row described. AGENTS.md's *"say plainly when a pass finds nothing real rather than manufacture a finding"* is the governing rule.

**10.8 — Not touching `gitpreflight`, even though F3's hazard lives in `ClassifyCheckout`.** **Recommendation: leave it (§3.22).** The fix for F3 is D3 — making git's own `status` output self-consistent — not teaching a pure classifier about Unicode. Normalizing inside `ClassifyCheckout` would be normalization *at the comparison site*, the thing SPEC's row forbids by name; it would have to be repeated in `ClassifyStashPop`, `ClassifyCherryPick`, and `ClassifyReset`; and in `ClassifyStashPop`'s case it would actively *break* a currently-correct site (F10, whose two comparands already share one source). The classifiers stay byte-exact set intersections over inputs that are now guaranteed consistent.

**10.9 — Unguarded `norm.NFC.String`, no `IsNormalString` fast path.** **Recommendation: unguarded (D4), and say why in the doc comment.** Measured: 46.5 ns / 0 allocs unguarded on an already-NFC ASCII path (P11) versus 58.7 ns / 1 alloc with the guard (P12) — the "obvious optimisation" is a pessimisation, because `norm.NFC.String` already has its own fast path and returns the input string. The comment exists so a future reviewer does not add it back on intuition.

**10.10 — Tests built from byte literals rather than from the filesystem, and no new `testdata` fixture.** **Recommendation: byte literals (D12).** CI is Linux (P1: NFD and NFC are two distinct files there, and git precomposes nothing), so any test that asks the OS to produce an NFD name proves nothing about macOS and passes vacuously. Explicit `string([]byte{...})` inputs make the test independent of the host *and* of the editor that later opens the test file — a source file containing a literal `café` can be silently re-encoded by a tool, a byte array cannot. The two SPEC-named golden pairs (U+00E9 vs U+0065 U+0301; precomposed vs conjoining-jamo Hangul, P4) are the first and third rows, and the corpus deliberately also carries the *negative* cases — NFKC's ligature (P6) and the tier-2 repo-relative parser paths — because those are the assertions that stop the next contributor from over-applying the fix.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/gitclient/runner.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitclient/repo.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitclient/watcher.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitrpc/detail.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitreview/migrate.go`
