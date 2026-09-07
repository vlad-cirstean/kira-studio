# G5 — Refs, checkout, the pre-flight engine, revert, the in-progress banner and the undo slot

> **What this phase is.** The fifth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> one where this backend stops being a reader. Everything through G4 queried git and rendered the
> answer; `gitclient.Repo.Write` — the exclusive write gate G2 built — has never had a single
> production caller. G5 gives it ten, and in doing so establishes the shape every later mutating
> phase (G7 remote ops, G12 stash, G13 reset/cherry-pick) copies: **pre-flight → confirm → execute →
> reconcile**, with pre-flight as pure Go functions computed server-side and crossed as data, and
> execution as one queued spawn behind one typed error vocabulary. It covers upstream's P6 in full
> minus the two operations that are pushes (F13).
>
> **In one line: `gitclient/porcelain` grows the three parsers this phase reads
> (`for-each-ref`'s two formats, `status --porcelain=v2 -z`, `merge-tree --write-tree`), two new
> packages appear — `gitpreflight` (the pure classifiers, the status folds and the undo slot) and
> `gitops` (argv builders, the `.git`-state-file reader and the operation-level error table) —
> `gitsession.RepoEntry` grows the live head, the refs cache, the undo slot and the write
> executor SPEC §6 puts in the shared box, and `gitrpc` serves the seven P6 methods the contract
> has declared since G1 and the server has rejected on every repo open ever since. The extension
> and the webview do not change at all.**
>
> **The SPEC is authoritative and is not re-litigated here.** The JSON-control-plane/FlatBuffers-
> data-plane split, the `Registry`/`RepoEntry`/`Conn`/`Walk` shared-vs-private rule, the package
> layout, "one undo slot per repo", `packages/git-ui` staying unchanged, and the phasing table are
> settled in `docs/v1.3/SPEC.md` §2, §4.2, §5 and §6. This plan is the *how*: the exact argv, the
> exact format strings, the exact framing, the exact wire shapes, the exact commit sequence, and
> the exact proof.
>
> **Four places where a literal reading of the SPEC (or of what an earlier phase left behind)
> collides with what actually works are called out and resolved with evidence** — a package table
> that names nine classifiers for a phase that needs three (F6/D3), a "visible omission" mechanism
> that is a TypeScript mapped type Go cannot express (F8/D6), a disconnect rule that collides with
> how `rpcstream` cancels requests (F7/D8), and two upstream P6 operations that cannot be honestly
> shipped before G7's askpass broker (F13/D5).
>
> **Two of those want a human eye before implementation starts — §11.**

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`4718c83b`, the whole
of G1–G4). Every claim below was checked against source read or commands run in this container,
never against prose — including G1–G4's own plans, which are records of intent and are verified
against the code they produced.

| Claim | Evidence |
|---|---|
| G4 landed in full: the three detail parsers, `ReadOneShot`, the response frame cap, the queries and two caches, four served methods, the four host-capability methods | `git log --oneline`: `b526b232`…`4718c83b`; `gitclient/porcelain/{difftree,diff,show}.go`, `gitsession/{queries,cache}.go`, `gitrpc/detail.go`, `proxyHandlers.ts:189-221` |
| The contract already declares **every** P6 wire type and **all seven** of this phase's request keys, on both sides | `contract.ts:184-329` (`RefKind`/`RefTrack`/`TagAnnotation`/`RefRow`/`InProgressKind`/`InProgressOperation`/`StatusSummary`/`CheckoutBlocker`/`CheckoutPreflight`/`RevertParentChoice`/`RevertPreflight`), `:551-714` (`OpRequest`/`OpErrorKind`/`UndoSlotSnapshot`/`OpResult`), `:997-1060` (`refs.list`, `status.get`, `preflight.checkout`, `preflight.revert`, `op.run`, `undo.peek`, `undo.run`); `validate.ts:73-79` has all seven in `REQUEST_KEY_MAP` |
| `proxyHandlers` already forwards all seven verbatim | `proxyHandlers.ts:203-209` — `forward('refs.list')` … `forward('undo.run')` |
| `editor.resolveConflict` is wired client-side and its banner is gated on `status.get` | `proxyHandlers.ts:212-221`; `App.vue:931-935` renders `<ConflictBanner :ops="opsState">`, and `ConflictBanner` reads `ops.statusSummary.value?.inProgress` |
| The server rejects all seven with `E_UNKNOWN_METHOD` today | `gitrpc/handlers.go:48-71` — nine cases, then `default:` |
| `porcelain` has no ref, status or merge-tree parser; G3's `RefSnapshotArgs` is deliberately narrow and self-contained | `ls gitclient/porcelain` → `diff.go difftree.go log.go records.go refsnapshot.go show.go`; `refsnapshot.go`'s own doc ("deliberately smaller than refs.list's own for-each-ref query"); G3 D9 |
| `RepoEntry` has no head, no refs cache, no undo slot — and `entry.go` says so by name | `entry.go:33-49`; `:30-32`: "Still to come: head, stash shapes, undo slot and active remote op (G5-G13) — no placeholders for any of that here" |
| `RepoSummary.Head` is resolved once at `Identify` and never refreshed | `gitclient/repo.go:183`, `:200-210`; nothing writes `Summary` after `newRepoEntry` |
| `Repo.Write` exists, is correct, and has never been called | `repo.go:89-115`; its own comment: "No operation in P1 actually calls this yet … it exists now so a later phase's first real write has nowhere else to go"; `grep -rn "\.Write(ctx" internal/git*` → only `repo_test.go` |
| `rpcstream` cancels a request's ctx on a `cancel` frame **and** on session teardown | `session.go:174-181` (`handleRequest` registers `cancel` in `activeWork`), `:293` (`for _, cancel := range s.activeWork`) |
| `gitclient.ErrorKind` is a five-member **driver** vocabulary, not the wire's 25-member `OpErrorKind` | `gitclient/errors.go:17-30`; its own comment: "P2 grows this set as real porcelain operations arrive (a merge conflict, a rejected push)" |
| `GIT_EDITOR=true` is already in the hygiene env — upstream's own W6 fix, already applied | `runner.go:97` |
| The watcher already classifies `CHERRY_PICK_HEAD`/`REVERT_HEAD`/`BISECT_LOG`/`sequencer`, in **both** `commonDir` and `gitDir` — upstream's own W7 fix, already applied | `watcher.go:33-43`, `:71-73` |
| `RepoSummary.IsLinkedWorktree` answers one half of upstream's D12 already | `repo.go:204-208` |
| `Conn` carries `ClientID` but no human label; the handshake has one and drops it | `gitsession/conn.go:31-39`; `gitsock/handshake.go:94` `label := clampLabel(...)`, `server.go:187` `NewConn(ConnID(sessionID), clientID, nil)` |
| The webview **pattern-matches on `UndoSlotSnapshot.label`**, twice, both anchored at the start | `liveAnnouncements.ts:196` `label.startsWith('Dropped stash@{')`, `:219` `/^Reset \((soft\|mixed\|hard)\) to /` |
| `packages/git-ui` imports exactly four symbols from `git-core`'s `preflight`/`undo`/`model/operation` surface: `validateRefName` (4 sites), `classifyReset`, `canRunOp`, `describeInProgress` | `grep -rn "@kira/git-core" packages/git-ui/src` — `dialogs/{StashDialog,BranchDialog,RenameRefDialog}.vue`, `dialogs/tagDialogModel.ts`, `state/ops.ts:1`, `components/rowMenuModel.ts:7`, `components/ConflictBanner.vue:22` |
| Nothing inside `git-core` imports `preflight/checkout.ts` or `preflight/revert.ts` except their own tests and two `index.ts` lines | `grep -rn "preflight/checkout\|preflight/revert" packages/git-core/src` → `index.ts:128`, `index.ts:134`, the two `.test.ts` files, and two stale comments in `model/status.ts` |
| The `gitsock` integration harness and G4 D15's config-isolated fixture builder both exist and are the ones to copy | `gitsock/{graphstream,detail}_test.go` (`newIntegrationServer`, `pairAndReady`, `openRepoOK`, `requestOK`, `unmarshalResult`); `porcelain/fixtures_test.go:52-60` `fixtureEnv()` |
| git here is 2.43.0; `go build ./apps/kira-studio/internal/...` is green | run here |

**Probes, run in this container against real git 2.43.** Upstream's P6 recorded nine; every one
relevant to this phase reproduces here, plus three this chapter's own constraints made necessary.
The implementer should extend these, not re-derive them.

| # | Question | What was observed here |
|---|---|---|
| **P1** | Does `for-each-ref`'s format expand `%1f` and `%00`? (G3 D9 found `%x1f` does **not** — that is `git log --pretty`'s syntax, and it made `RefSnapshotArgs` use a literal 0x1f byte) | **Both expand.** `--format='%(refname)%1f%(objectname)%00'` emits `refs/tags/ann<0x1f><sha><NUL><LF>` — the two-hex-digit `%NN` form is for-each-ref's own, and `%1f`/`%00` are it. `for-each-ref -z` still does not exist at this floor |
| | Record framing with `%00` | git appends its **own `\n` after every record regardless**, so the byte stream is `<rec>\0\n<rec>\0\n…` — splitting on NUL leaves a leading `\n` on every record but the first, and a trailing `\n` as the splitter's remainder |
| **P2** | `%(worktreepath)` for the branch checked out *here* | Populated: `refs/heads/main\|*\|/tmp/g5b` alongside `refs/heads/feature2\| \|/tmp/g5b-wt`. "Checked out elsewhere" is `worktreepath != <our toplevel>`, never `worktreepath != ""` |
| **P3** | A lightweight tag's `%(contents:subject)` | Returns the **pointed-at commit's** subject (`c1`), not an annotation. The discriminator must be `%(objecttype) == "tag"` |
| | `%(upstream:track)` shapes | `[ahead 1]`, `[gone]`, and empty. `%(upstream)` is the **full** refname (`refs/remotes/origin/main`) |
| | `git tag -f ann HEAD` on an annotated tag | `%(objecttype)` goes `tag` → `commit`: the annotation is destroyed |
| **P4** | `merge-tree --write-tree --messages --name-only HEAD <C>^1` for a conflicting revert | **exit 0, reports clean** — git picked its own base |
| | the same with `--merge-base=<C>` | **exit 1**, tree oid on line 0, then `f.txt`, then `Auto-merging…`/`CONFLICT (content)…` |
| **P5** | A conflicting single-commit `revert` | stderr `error: could not revert 7c7eba7... c1`; `.git` gains `REVERT_HEAD`, `MERGE_MSG`, `AUTO_MERGE` — and **no `sequencer/`** for a single-commit revert |
| | `git switch --no-guess main` during it | `fatal: cannot switch branch while reverting`, exit 128 |
| **P6** | `git revert <merge>` with no `-m` | `error: commit <sha> is a merge but no -m option was given.` / `fatal: revert failed` — `MainlineRequired`'s own string, and revert produces it as readily as cherry-pick does |
| **P7** | `switch` blocked by a tracked change | `error: Your local changes to the following files would be overwritten by checkout:` |
| | blocked by an untracked one | `error: The following untracked working tree files would be overwritten by checkout:` |
| | `switch --discard-changes` against an untracked block | `error: Untracked working tree file 'onlyonside.txt' would be overwritten by merge.` — a **different** string, still a refusal |
| **P8** | branch/worktree refusals | `fatal: 'feature2' is already used by worktree at '…'` (128); `error: cannot delete branch 'feature2' used by worktree at '…'` (1) |
| **P9** | Exit codes that are *not* failures | `git config --get-regexp '^branch\.x\.'` with no match → **exit 1, empty**; `for-each-ref … refs/tags/nope` → **exit 0, empty**; `merge-tree` conflict → **exit 1** |
| **P10** | `git check-ref-format --branch '@{-1}'` here | **exit 128** — upstream's P3 saw exit 0 with `cp` printed, because the shorthand *resolved* in its repo. The hazard is real and context-dependent; the pure prefilter is right either way, and nothing in this repo ever spawns this command (F17) |
| **P11** | `status --porcelain=v2 --branch -z` on an unborn HEAD | `# branch.oid (initial)\0# branch.head main\0` — no entries, and `oid == "(initial)"` is the unborn signal |
| | `diff --name-only -z HEAD <target>` | `added.txt\0f.txt\0` — plain NUL framing, trailing delimiter present |

**Upstream baseline** (`/home/user/vlad-cirstean/kira-version-vscode`, `claude/start-p2-gwlgly`,
`0ea4cfe`), read as the source this phase ports:

| Claim | Evidence |
|---|---|
| P6's own design — the set-intersection argument, the fifth blocker, the in-progress precedence table, the undo mechanism, `op.run` as one key | `docs/plans/P6.md` in full |
| §7.5's classification is a **set intersection**, exact and not an approximation | `docs/plans/P6.md`'s "The hard parts" and probe P1/2c: a locally modified file byte-identical to the target's version is *still* refused, so a content-aware predictor would be wrong, not merely expensive |
| The ordered blocker list, the `routes` rule, the DWIM/`createsTracking` rule | `packages/core/src/preflight/checkout.ts` in full |
| The revert classifier, `predictedFor = shas[0]`, detached HEAD as a note not a blocker | `packages/core/src/preflight/revert.ts` |
| The in-progress precedence table (rebase shadows everything; `AUTO_MERGE` is a stale artefact, not a signal) | `packages/core/src/model/operation.ts:97-160` |
| The state-file reader is per-worktree `gitDir`, never `commonDir` | `packages/git/src/ops/conflict.ts:1-20` |
| The undo slot: capture **before** the write, `set(null)` on every op, `take(id)` once | `packages/core/src/undo/slot.ts`; `repoService.ts:2000-2080` |
| A deleted branch's recovery is a ref write **plus** its `branch.<name>.*` config | `repoService.ts`'s `#captureBranchDeleteUndo`; `ops/branch.ts`'s two capture reads |
| A deleted annotated tag is restored with `update-ref <tagObjectSha>`, never `tag -a -m` | `ops/tag.ts`'s `undoAnnotatedTagArgs`; P6 probe P3 |
| Pre-flight reads a **fresh** ref snapshot, never `refsCache` | `repoService.ts:1533` `preflightCheckout` calls `fetchRefsSnapshot` directly; only `refs(repoId)` (`:1419-1435`) consults the cache |
| Post-op read-back happens on **both** outcomes | `repoService.ts:2038-2041` and its own comment: a conflicting revert fails *and* leaves `REVERT_HEAD` |
| The `dirtyPaths` display cap is 200, and the *intersection* is computed over the uncapped set | `repoService.ts:468`, `:489-495`, `:1513-1521` |
| `%(worktreepath)` subtraction is what turns "any worktree" into "elsewhere" | `repoService.ts:528-536` `subtractOwnWorktree` |
| Target resolution order is branches → tags → remote branches → raw sha | `repoService.ts:600-622` `resolveCheckoutTarget` |

### 0.2 Scope

1. `internal/gitclient/porcelain` — `refs.go` (the real `for-each-ref` parser and its two format
   strings, D10), `status.go` (`--porcelain=v2 -z`, D11), `mergetree.go` (D13).
2. `internal/gitpreflight` — **new package**: `ClassifyInProgress`, `ClassifyCheckout`,
   `ClassifyRevert`, the status folds, the wire result types, and the undo slot (D3, D7).
3. `internal/gitops` — **new package**: checkout/branch/tag/revert argv, the `.git` state-file
   reader with the continue/abort/skip tables, and the operation-level error classifier (D4, D14).
4. `internal/gitclient` — one export: a head resolver the session can re-run (D16). Nothing else.
5. `internal/gitsession` — refs, status, the two pre-flights, the write executor, the per-repo
   undo slot, the live head, the refs cache; `Conn` gains a client label (D5–D8, D10–D13, D16).
6. `internal/gitrpc` — the seven handlers. **`CONTRACT_VERSION` stays 14** (D1).
7. `internal/gitsock` — one line threading the handshake's label into `Conn`; the integration tier.
8. `packages/git-core` — delete `preflight/checkout.ts`, `preflight/revert.ts`, their two tests and
   two `index.ts` lines (D17). The only TypeScript change in the phase.
9. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G5 work:

- **`stash.list`.** Still rejecting on every repo open — the last of G3 F16's four. G12's.
- **Tag push and remote tag delete** (`op.run`'s `tagPush`/`tagDeleteRemote`). Upstream's P6
  shipped them; this chapter cannot, because a push needs G7's askpass broker and credential relay
  (F13/D5). They answer `E_UNKNOWN_METHOD` naming the kind — not a stub, not a silent no-op.
- **Reset, cherry-pick and their pre-flights, stash and its pre-flights, remote ops.** G13/G12/G7.
  `gitpreflight` and `gitops` are created here with only what G5 reads; every later phase extends
  the same two packages (D3/D4).
- **The protected-branch glob matcher.** SPEC's `gitpreflight` row names it, but its only consumer
  anywhere is `preflight/push.ts` (`grep`: `matchProtectedBranch` has exactly one call site), and
  push is G7's. Porting it now would be code with no caller. G7's.
- **`review.open`.** Still the seventh host-capability method, still G6's (G4 D11).
- **Any change to the graph, the diff, the detail pane, or their caches.**
- **Any UI work at all.** `packages/git-ui` already contains `BranchPicker.vue`, `TagList.vue`,
  `ConflictBanner.vue`, `UndoButton.vue`, `RowContextMenu.vue`, every dialog, `state/refs.ts` and
  `state/ops.ts`, migrated whole by G1 and untouchable by SPEC §5.
- **`packages/git-ipc`.** Not one byte: no key, no type, no version (D1).
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out of this phase is left out *entirely*.
- **Comments very concise, only where the code cannot say it itself.**
- **Tests only where `AGENTS.md`'s bar is met** (D18). G5 clears it in six places and nowhere else.
- **Reach for a library before hand-rolling.** Nothing here is a library's job: every new file is
  either a parser for one specific `git` output format (`AGENTS.md`'s own named exception) or a
  decision table with several interacting rules.
- **Fixture repositories scope their git config to themselves** — G4 D15's `fixtureEnv()`
  (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `-c commit.gpgsign=false`),
  copied by every new fixture builder this phase adds. **Never `git config --global`.**
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§6).

---

## 1. Findings

### F1 — The contract already declares every type and every method this phase serves; G5 designs no wire

`contract.ts:184-329` and `:551-714` are a structural copy of upstream's P6 model, migrated whole
by G1. `contract.ts:997-1060` declares all seven request keys. `validate.ts:73-79` admits all
seven. `proxyHandlers.ts:203-209` forwards all seven.

So the whole vocabulary of this phase — `RefRow`, `TagAnnotation`, `InProgressOperation`,
`StatusSummary`, `CheckoutPreflight`, `RevertPreflight`, `OpRequest`'s nineteen arms,
`OpErrorKind`'s twenty-five members, `UndoSlotSnapshot`, `OpResult` — is **given**, not designed.
G5's job is to produce those bytes from a real repository.

The practical consequence, and the thing to check every deliverable against: *the JSON this phase
emits must match `contract.ts` field for field, including which fields are `undefined` (absent) and
which are `null` (present)*. G4 D5 already set the Go encoding rule for that distinction and this
phase inherits it unchanged.

### F2 — The extension side of this phase is empty, and that is a first

G1 migrated the extension, G3 wrote `proxyHandlers`, G4 replaced four forwarders with local
answers. Every method G5 serves is already a plain `forward(...)` and needs to stay one: none of
them touches a host port, a picker, the clipboard or the editor. `app.init`'s four capabilities are
already all `true` (G4 D11).

The one exception is not a handler at all: `gitsock` needs to hand `gitsession.Conn` the client
label the handshake already computes and throws away (F11), which is a Go change, not a TypeScript
one.

So `apps/kira-studio-vscode/` is **byte-for-byte unchanged by this phase**, and so is
`packages/git-ipc/`. The only TypeScript diff is a deletion in `packages/git-core` (F10/D17).

### F3 — G5 closes three of G3 F16's four rejections, and makes G4's conflict banner reachable

G3 F16 recorded four requests the webview fires on every repo open that no server answers:

| Trigger | Request | Closed by |
|---|---|---|
| `refsState.setRepoId` (`state/refs.ts:71-83`) | `refs.list` | **G5** |
| `opsState.setRepoId` (`state/ops.ts:233-245`) | `status.get` | **G5** |
| the same | `undo.peek` | **G5** |
| `stashState.setRepoId` (`state/stash.ts:74-89`) | `stash.list` | G12 |

The second of those is what makes G4's own hand-off land. `App.vue:931-935` renders
`<ConflictBanner :ops="opsState" :resolve-conflict-enabled="…capabilities.resolveConflict"
:resolve-conflict="resolveConflictInEditor">`; `ConflictBanner.vue` shows nothing unless
`ops.statusSummary.value?.inProgress` is non-null; `App.vue:535-538` sends
`editor.resolveConflict`, which `proxyHandlers.ts:212-221` answers locally over
`ports/editorIntegration.ts`'s already-written `resolveConflict`. **Every link in that chain
exists except the one that produces `inProgress`, which is `status.get`.** G4 D11's judgment call
("wire it in G4 even though its banner is not reachable until G5") is confirmed correct here: no
change is needed on the extension side for the banner to start working — only a served
`status.get`.

### F4 — `porcelain` has none of this phase's three parsers, and G3 D9's snapshot must not be widened into one

`gitclient/porcelain/` is `diff.go difftree.go log.go records.go refsnapshot.go show.go`. There is
no `for-each-ref` parser beyond `refsnapshot.go`'s two-field snapshot, no `status` parser and no
`merge-tree` parser.

`refsnapshot.go` is G3 D9's own narrow query, and its doc comment states why it is narrow: it feeds
the paged walk's `--skip` guard, it compares refname → object id only, and it is "strictly cheaper
than upstream's (no `%(upstream:track)`, which costs git a reachability computation per ref)". It
also records the framing fact G5 needs: **`for-each-ref` has no `-z` at this chapter's 2.38 floor**
(probed against 2.43: ``error: unknown switch `z'``), and `%x1f` is `git log --pretty`'s escape
syntax, not for-each-ref's.

Probe P1 completes that picture: for-each-ref's *own* escape syntax is `%NN` — `%1f` and `%00` both
expand — and git appends its own `\n` after every record regardless of what the format ends with.
So the real parser can use `%1f` between fields, and the tags-only spawn can use a trailing `%00`
to carry an annotation body containing raw newlines, exactly as upstream does, provided the
splitter accounts for the extra `\n` git adds after each NUL.

G3 D9's snapshot **keeps its own query** (its own doc comment promises this: "when G5 lands the
full parser the snapshot keeps its own query rather than acquiring a dependency on one").

### F5 — `RepoEntry` has no head, no refs cache and no undo slot, and `Summary.Head` is frozen at open

`entry.go:33-49` is `Summary`, `Repo`, `watcher`, `subs`, `catfile`, `detail`, `diff`, `done`.
`:30-32` names exactly what is missing and assigns it: "Still to come: head, stash shapes, undo
slot and active remote op (G5-G13)".

`Summary.Head` comes from `Identify` at open (`repo.go:183`) and nothing ever writes it again. A
second connection opening an already-open repository is handed that same frozen value
(`conn.go:58-61`, `:84`). After any checkout — this app's own, or one made in a terminal —
`RepoSummary.head` is wrong, and so is `refs.list`'s `head` if it is derived from it.

G5 is the first phase that has any reason to notice, and the first that can fix it: it is the phase
that both moves HEAD and reads a `status --branch` header that carries HEAD's identity for free.

### F6 — SPEC's `gitpreflight` row names nine classifiers; this phase reads three of them

The package table's row reads `classifyCheckout`/`StashPop`/`Reset`/`Revert`/`CherryPick`/`Push`/
`Pull`/`StashBranch`/`InProgress`, protected-branch glob matcher, undo slot — a description of the
package's *eventual* contents, written once for the whole chapter, exactly as the `gitclient/
porcelain` row named every parser at once and G3/G4 each ported only the ones their own RPCs read.

What G5's own methods actually read:

| Symbol | Read by | Phase |
|---|---|---|
| `ClassifyInProgress` | `status.get`, both pre-flights, `op.run`'s read-back | **G5** |
| `ClassifyCheckout` | `preflight.checkout` | **G5** |
| `ClassifyRevert` | `preflight.revert` | **G5** |
| the undo slot | `op.run`, `undo.peek`, `undo.run` | **G5** (completed G13 — SPEC's own G13 row) |
| `ClassifyPush`/`ClassifyPull` + the protected-branch matcher | `remote.pushPreflight`/`remote.pullPreflight` | G7 |
| `ClassifyStashPop`/`ClassifyStashBranch` | `preflight.stashPop`/`preflight.stashBranch` | G12 |
| `ClassifyReset`/`ClassifyCherryPick` | `preflight.reset`/`preflight.cherryPick` | G13 |

The protected-branch matcher is the clearest case: `grep -rn matchProtectedBranch packages/` finds
exactly one non-test call site, `preflight/push.ts:24`. Porting it in G5 would produce a Go
function with no caller for two phases.

### F7 — SPEC §6's disconnect rule collides with how `rpcstream` cancels a request

SPEC §6: *"**A write already in flight is never killed by a client disconnect** — it is detached
from the connection and finishes on its own; the result is simply not delivered anywhere."*

`rpcstream/session.go:174-181` builds a per-request `context.WithCancel(context.Background())`,
registers its `cancel` in `activeWork`, and cancels it when the handler returns; `:293` cancels
every entry in `activeWork` when the session tears down; a `cancel` frame cancels one. `gitclient`
threads that ctx into `exec.CommandContext`, whose `WaitDelay`/`Setpgid` machinery then
SIGTERMs-then-SIGKILLs the process group (`runner.go`).

So a handler that passes its request ctx straight into `Repo.Write` gets exactly the behaviour SPEC
forbids: a VS Code window closing mid-`git switch` kills the switch. G4's F15 relied on precisely
this mechanism for `commit.detail` — correctly, because a superseded *read* should die. A write
must not.

The stake is larger than one interrupted command. `RepoEntry`'s state is **shared**: the undo slot,
the live head and the refs cache are read by every other connection on that repository. A write
that half-runs and then loses its post-op read-back leaves the shared state describing a repository
that no longer exists, for every window, not just the one that disconnected.

### F8 — Go cannot express upstream's "visible omission" mechanism, which is a TypeScript mapped type

§7.12 asks for an undo policy "so adding a new destructive operation without an undo entry is a
visible omission rather than a silent one", and upstream implements that literally:
`const UNDO_POLICY: { readonly [K in OpRequest['kind']]: UndoPolicy }` (`undo/slot.ts:35`). Adding
a member to the union without an entry fails `tsc`. That is the whole trick, and it is why the slot
lives in `core` beside the operation model.

Go has no equivalent. `OpRequest["kind"]` crosses the wire as a plain string; a Go
`map[string]UndoPolicy` is never checked for totality by any compiler, and a `switch` over a string
has no exhaustiveness check either. A direct transcription silently loses the one property §7.12
asked for by name.

### F9 — The webview pattern-matches on `UndoSlotSnapshot.label`, twice, both anchored at the start

`liveAnnouncements.ts:196`: `label.startsWith('Dropped stash@{')` → the announcement becomes
"Restored as stash@{0}" instead of the generic "Undone: `<label>`". `:219`:
`/^Reset \((soft|mixed|hard)\) to /` → the undo button's tooltip picks one of three mode-specific
caveats. Both files' own comments say the label "doubles as the mode carrier without a dedicated
field", and both name `RepoService`'s capture sites as the only producers.

Two consequences for G5. First, the labels this phase produces must be **byte-identical to
upstream's** (`Deleted branch <name>`, `Deleted tag <name>`), or G12's and G13's own detectors will
be looking for prefixes that the Go server never emits. Second, SPEC §6's required attribution
("*so a second window sees "Undo reset of `main` (window: repo-review)"*") must be a **suffix**:
both patterns are start-anchored, so anything appended is safe and anything prepended breaks two
future phases.

### F10 — `git-core`'s `preflight`/`undo` trim: only four symbols are actually live client-side

G1 D14 deferred SPEC §5's "`git-core` **drops** `preflight/*` and `undo/*`" to G5/G13 and named an
exact deletion list — 17 preflight files, 2 undo files, three `index.ts` ranges, "minus whatever G5
decides to relocate". Re-checked against the tree:

| Symbol | File | Imported by `packages/git-ui`? |
|---|---|---|
| `validateRefName` | `preflight/tag.ts` | **yes** — `BranchDialog.vue:11`, `RenameRefDialog.vue:12`, `StashDialog.vue:20`, `tagDialogModel.ts:9` |
| `classifyReset` | `preflight/reset.ts` | **yes** — `state/ops.ts:1` (`previewResetMode`, a client-side re-derivation with no round trip) |
| `canRunOp`, `describeInProgress` | `model/operation.ts` | **yes** — `state/ops.ts:1`, `rowMenuModel.ts:7`, `ConflictBanner.vue:22` |
| `classifyTagCreate` | `preflight/tag.ts` | **no** — `tagDialogModel.ts`'s own comment calls itself "an adaptation of `core`'s `classifyTagCreate` over the wire's `RefRow` rather than a `RefRecord`" |
| `classifyCheckout` | `preflight/checkout.ts` | **no** |
| `classifyRevert` | `preflight/revert.ts` | **no** |
| `classifyCherryPick`, `classifyPush`, `buildPullPreflight`/`resolvePullStrategy`, `classifyStashPop`/`classifyStashBranch` | four files | **no** — but their server counterparts are G7/G12/G13's, not G5's |
| `UndoSlot`, `UNDO_POLICY` | `undo/slot.ts` | **no** — SPEC's G13 row and G1 D14 both assign this deletion to G13 |

Two things G1 D14 could not have known without this check: `validateRefName` lives *inside*
`preflight/tag.ts`, so that file cannot be deleted at all; and nothing in `git-core` imports
`checkout.ts` or `revert.ts` except their own tests and two `index.ts` lines, so those two are a
clean removal.

### F11 — Two upstream P6 driver fixes are already in this tree, and one upstream P6 fact is missing

Upstream's W6 and W7 were P1 bug fixes surfacing in P6. Both are already applied here:

- `runner.go:97` — `GIT_EDITOR=true` in `hygieneEnv`, with a comment that names the exact failure
  it prevents ("`merge --continue` blocks forever and leaves MERGE_HEAD in place").
- `watcher.go:33-43` — `refIshNames` already contains `CHERRY_PICK_HEAD`, `REVERT_HEAD`,
  `BISECT_LOG` and `sequencer`; `:71-73` already checks them against **both** `commonDir` and
  `gitDir`, which is upstream's linked-worktree fix.

So **G5 changes neither the runner nor the watcher.** What *is* missing is the handshake's client
label: `handshake.go:94` computes `clampLabel(hello.Client.Label)`, uses it for the pairing prompt
and the trust-store row, and `server.go:187` then constructs
`gitsession.NewConn(ConnID(sessionID), clientID, nil)` without it. SPEC §6's undo attribution needs
it (F9).

### F12 — `Repo.Write` has never been called, and it already gives cross-connection serialization for free

`repo.go:89-115` is an exclusive gate: no concurrent `Read`, no concurrent `Write`, ctx-aware,
broadcast-and-recheck. Its own comment says no caller exists. `grep` confirms: only `repo_test.go`.

Because the gate lives on `RepoEntry.Repo` and `RepoEntry` is shared across connections (SPEC §6),
routing every `op.run` through it makes "two windows' operations never interleave" true with no new
machinery — which is upstream's third stated reason for having one `op.run` key at all ("it is
where the write queue's serialization is visible"). A second window's op *queues* rather than
failing; SPEC §6 reserves the "≤1 concurrent, reject the second" rule for **remote** ops, which are
G7's.

### F13 — Two of upstream's eleven P6 operations are pushes, and this chapter splits them out

`OpRequest` has `tagPush` (`push <remote> <names…>` / `push <remote> --tags`) and `tagDeleteRemote`
(`push <remote> --delete <name>`). Upstream shipped both in P6 because it had no separate remote-op
phase boundary to respect; its own P8 then built fetch/pull/push around them.

This chapter's phasing table draws the line differently and explicitly: **G7** owns "Remote ops:
fetch/push/decomposed pull/force-with-lease/protected branches/**askpass broker + credential
relay**/auto-fetch". SPEC's G5 row names refs/tags/branches, checkout, pre-flight, revert,
linked-worktree detection, the in-progress banner and the undo slot — and no push.

Shipping them in G5 anyway would mean a `git push` running with `GIT_TERMINAL_PROMPT=0` and no
credential broker: against any authenticated remote it fails immediately rather than hanging, so it
would not *hang*, but it would fail for every user of a private remote with an error the UI has no
remedy for. That is `AGENTS.md`'s "half-implemented" exactly.

### F14 — Three of this phase's commands have non-zero or empty exits that are ordinary outcomes

`gitclient.Classify` (`errors.go:88-110`) turns any non-zero exit into a `*gitclient.Error`. That is
right for every command G1–G4 ran. Three of G5's are not:

| Command | Ordinary outcome `Classify` would misread | Probe |
|---|---|---|
| `merge-tree --write-tree …` | **exit 1 = conflicts predicted**, which is a *successful* prediction; only >1 is a real failure | P4, P9 |
| `config --get-regexp '^branch\.<name>\.'` | **exit 1, empty output = the branch has no config**, which is the common case | P9 |
| `for-each-ref … <refname>` | **exit 0, empty output = no such ref**, never an error | P9 |

`repo.go:232-260`'s `headState` already establishes the house pattern for this: run raw, inspect
`res.ExitCode` first, and only call `Classify` for the codes that really are failures.

### F15 — The linked-worktree half SPEC's G5 row names is the `%(worktreepath)` subtraction, not detection

G2 already answers "am I in a linked worktree" (`RepoSummary.IsLinkedWorktree`, `repo.go:204-208`,
derived for free from `gitDir != commonDir`). What does not exist is the other half of upstream's
D12: **which branch is checked out where**, which is what produces the branch-list badge and
`CheckoutBlocker`'s fifth member, `worktreeConflict`.

Probe P2 settles the trap: `%(worktreepath)` is populated for the branch checked out in *this*
worktree too, so "elsewhere" is `worktreepath != <our own toplevel>`, not `worktreepath != ""`. And
probe P8 confirms the two refusals this blocker exists to pre-empt are not dirty-worktree problems
at all — neither stashing nor discarding can clear them, so folding them into `blockedByTracked`
would print a remedy that cannot work.

### F16 — Pre-flight reads a fresh snapshot; only `refs.list` reads the cache

Upstream caches `RefsResult` on the session and drops it on `refsChanged` (`repoService.ts:1419-1435`),
but `preflightCheckout` (`:1533`) and `#prepareOp`'s checkout arm both call `fetchRefsSnapshot`
directly. The reason is not stated there but is structural, and worth stating here: a pre-flight is
the moment before a write, and resolving `origin/topic` against a cache that was populated before a
`git fetch --prune` would pick a target that no longer exists — or worse, the wrong kind of target.
The cache exists to make repeated `refs.list` calls (two windows, one repository) cheap, not to
make decisions from.

### F17 — `check-ref-format` is never spawned anywhere in this repo, and does not need to be

Upstream's P6 says names are "validated with `git check-ref-format --branch` before spawning".
`grep -rn "check-ref-format"` across `packages/` and `apps/` finds only comments. The real
mechanism is `validateRefName` — a pure client-side prefilter rejecting `@{`, a leading `-`, and
the empty string — plus git's own refusal when the argv actually runs. Probe P10 shows why the
prefilter carries the weight: `check-ref-format --branch` *resolves* `@{-N}` shorthand rather than
validating a literal, so it is the wrong tool for the question, and its behaviour is
context-dependent (upstream saw exit 0 with `cp` printed; this container sees exit 128, because the
shorthand had nothing to resolve to).

So G5 adds no name-validation spawn, and `validateRefName` stays exactly where it is (D17).

### F18 — Read-pool arithmetic: the pre-flights are this phase's heaviest reads

`maxConcurrentReads = 4` (`repo.go:37`), and G4 F14 already flagged that one `commit.detail` takes
three of the four slots.

- `preflight.checkout` = a fresh refs snapshot (2 spawns) + `status` (1) + `diff --name-only HEAD
  <target>` (1) + up to nine `.git` file reads (no spawn at all).
- `preflight.revert` = `status` (1) + one `show -s` per requested sha + one per distinct merge
  parent + one `merge-tree` (1).

The second is the unbounded one: a multi-select revert of N commits with M distinct merge parents
is N+M `show -s` spawns. Upstream fires them all through `Promise.all` with no pool at all. Here
they would each take a read slot, and a 50-commit selection would hold the repository's entire read
capacity for the duration — starving the graph stream of the *other* window on the same repository.

### F19 — The integration harness and the config-isolated fixture builder both already exist

`gitsock/graphstream_test.go` and `gitsock/detail_test.go` build a real fixture repository, pair a
client over a real socket, open a real repo and drive real requests (`newIntegrationServer`,
`pairAndReady`, `openRepoOK`, `requestOK`, `unmarshalResult[T]`). `porcelain/fixtures_test.go:52-60`
and `gitsock/detail_test.go:52` both carry G4 D15's `fixtureEnv()` —
`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, and `-c commit.gpgsign=false` on
every commit.

So G5's own tests are new files in existing packages, not a new harness — and every fixture
repository this phase builds copies `fixtureEnv()` rather than the ambient environment.

---

## 2. Decisions

### D1 — No wire method, no wire type, no param changes: **`CONTRACT_VERSION` stays 14**

Resolving F1. The standing rule (G1 D20, re-applied by G3 D6 and G4 D3) is: bump when a wire
method, event, stream or param is **added, changed or removed**. G5 does none of those. Every one
of its seven methods, every param and every result type has been in `contract.ts` and
`validate.ts`'s `REQUEST_KEY_MAP` since G1's migration, and `proxyHandlers` has forwarded all seven
since G3.

What changes is only *whether the server answers* — `E_UNKNOWN_METHOD` becomes a real result. That
is not a compatibility axis: a client and server on the same `CONTRACT_VERSION` already agree on
these shapes, and the handshake's hard lockstep (SPEC §3.4) means a client can never be talking to
a server from a different build in the first place.

Stated explicitly rather than left implicit, because "a phase this large must surely bump the
contract" is the natural assumption and it is wrong here. **`packages/git-ipc` is byte-for-byte
unchanged by this phase**, and a diff in it is a signal something drifted out of scope.

### D2 — Everything in this phase crosses as **JSON**; `gitwire` and `gitwire.fbs` are not touched

SPEC §4.2 puts "bulk response/stream payloads" in FlatBuffers and G4 D1 already argued the boundary
for a payload the SPEC named by name (diff hunks). G5's payloads are not even close to that line
and the reasoning is short enough to state rather than re-derive:

- The largest result here is `refs.list` on a big repository — a few thousand `RefRow`s at roughly
  200 bytes of JSON each, so single-digit megabytes at the extreme and tens of kilobytes normally.
  G4 D2(a)'s response-frame guard already makes the pathological case a visible
  `E_FRAME_TOO_LARGE` rather than a hang.
- None of the seven is a stream, none has a typed-array receiver, and each fires on a user action
  or a repo-changed event, not continuously.
- All seven result types are declared in `contract.ts` as ordinary TypeScript and are read directly
  by `packages/git-ui`, which may not change to receive a second representation.

So `packages/git-ipc/schema/`, `src/generated/`, `graphChunkCodec.ts`, `codec.ts` and
`internal/gitwire` are untouched, and `Payload` stays a one-member union. G4 D1's own hand-forward
stands unchanged.

### D3 — `gitpreflight` is created with exactly what G5 reads; G7/G12/G13 extend the same package

Resolving F6, and answering the "how much of a shared package do we build now" tension G2 and G3
each hit and resolved the same way (G3 D8: "Each lands with the RPC that reads it").

**The package that lands in G5:**

```
internal/gitpreflight/
  operation.go   InProgressKind, InProgressOperation, InProgressStateFiles, ClassifyInProgress
  status.go      StatusSummary, SummarizeStatus, DirtyPaths, UnmergedPaths, DirtyPathsDisplayCap
  checkout.go    CheckoutBlocker, CheckoutPreflight, DirtyPath, ClassifyCheckout
  revert.go      RevertParentChoice, RevertPrediction, RevertPreflight, ClassifyRevert
  undo.go        UndoRecord, UndoSlotSnapshot, UndoPolicy, UndoSlot
```

and nothing else. No `ClassifyReset`, no `ClassifyCherryPick`, no `ClassifyStashPop`, no
`ClassifyStashBranch`, no `ClassifyPush`, no `ClassifyPull`, no protected-branch matcher — each of
those has a phase that owns its RPC, and each will add one file to this package with no rework of
anything G5 wrote.

**The alternative, rejected**: build the whole package's shape now with the six unbuilt classifiers
present as unimplemented stubs. `AGENTS.md` forbids it in two separate clauses ("no stubbed error
handling, no `TODO: fix later`" and "Scope left out of a phase is left out entirely, not
half-implemented"), and there is no cost to deferring: nothing about `ClassifyCheckout`'s signature
or `UndoSlot`'s shape changes when `ClassifyReset` arrives beside them. The only thing that *would*
have been expensive to defer is the wire vocabulary, and that is already fixed in `contract.ts`
(D1).

`SummarizeStatus`/`DirtyPaths`/`UnmergedPaths` live here rather than in `porcelain` (where upstream
puts them, in `core/src/model/status.ts`) for one reason: `porcelain` parses git's bytes and takes
no position on what they mean, and these three are policy — which XY codes count as staged, whether
an unmerged path is "tracked", which entries are dirty at all. `gitpreflight` importing
`gitclient/porcelain` for the parse types is a one-directional dependency between two leaf
packages, and it is the same direction upstream's `core` → `git` relationship would have if
TypeScript had forced one.

### D4 — `gitops` is created with exactly what G5 spawns, and it holds no policy

Resolving F6 for the second package, on the same rule.

```
internal/gitops/
  checkout.go   SwitchArgs, SwitchDetachArgs, SwitchCreateTrackingArgs, RewrittenPathsArgs
  branch.go     BranchCreateArgs, BranchCreateAndSwitchArgs, BranchSetUpstreamArgs,
                BranchDeleteArgs, BranchRenameArgs, BranchRevParseArgs, BranchConfigRegexpArgs
  tag.go        TagCreateArgs, TagDeleteArgs, UndoTagArgs
  revert.go     RevertArgs
  conflict.go   ReadInProgressStateFiles, ContinueArgs, AbortArgs, SkipArgs
  errors.go     ClassifyOpError
```

Not here: `fetch`/`push`/`pull` and the stderr **progress parser** (G7), `stash` (G12), `reset` and
`cherryPick` (G13). Every one of those is a file this package gains later, beside these, with no
change to what G5 wrote.

`conflict.go` is the one file that is not an argv builder — it reads the `.git` state files off
disk (D9) — and it is the one place in this phase where completeness over `InProgressKind` is not
speculative but required: `ContinueArgs`/`AbortArgs`/`SkipArgs` must answer for all six kinds,
including `merge`, `rebase`, `bisect` and `cherryPick`, because the repository can *be* in any of
those states when the user opens it whether or not this app can start them (D5). That is upstream's
§9 "report a rebase in progress and refuse to interfere", read literally.

`gitops` holds no policy at all: nothing in it decides *whether* to run a command. That decision is
`gitpreflight`'s (pure) or `gitsession`'s (stateful), which is the same `parse/` ↔ `ops/` split
upstream draws and the same one `porcelain` ↔ `gitsession` already has in this repo.

### D5 — `op.run` serves ten of `OpRequest`'s nineteen kinds; the other nine answer `E_UNKNOWN_METHOD` naming the kind

Resolving F13, and the one place this phase's coverage of upstream's P6 is deliberately narrower.

| Kind | G5 | Why not |
|---|---|---|
| `checkout` | ✅ | |
| `branchCreate` / `branchDelete` / `branchRename` | ✅ | |
| `tagCreate` / `tagDelete` | ✅ | local only |
| `revert` | ✅ | |
| `opContinue` / `opAbort` / `opSkip` | ✅ | the banner's escape hatches, for **whatever** operation the repository is in — merge, rebase, cherry-pick, bisect included |
| `tagPush` / `tagDeleteRemote` | ❌ | pushes; need G7's askpass broker and credential relay (F13) |
| `stashPush` / `stashApply` / `stashPop` / `stashDrop` / `stashBranch` | ❌ | G12 |
| `reset` / `cherryPick` | ❌ | G13 |

An unserved kind is answered with `ipcerr.New("E_UNKNOWN_METHOD", "gitrpc: op.run: <kind> is not served yet")`
— the same code the router already returns for a method it does not serve, reaching the UI as an
ordinary `RpcError` through the same `catch` path every rejected request already takes. Nothing is
stubbed, nothing lies, and the failure names the operation rather than the transport.

**Why `opSkip` is in and `tagPush` is out**, since both are single-line argv builders: `opSkip`
completes a state machine over conditions the repository can already be in and this phase already
detects and renders (`InProgressOperation.canSkip` is `true` for `cherryPick` and `revert`, and
`revert` is G5's own operation — probe P6's empty-revert case is reachable in G5). `tagPush` starts
a network operation whose whole failure surface — auth, hooks, lease, progress, cancellation — is
another phase's design.

**Consequence recorded honestly**: `TagList.vue:77` and `BranchPicker.vue:158` offer "push tag"
and "delete on remote" menu entries that will fail with a clear error until G7, exactly as
`stash.list` has failed since G3 (G3 D17's own precedent). §7.2 step 11 tells the macOS reviewer to
expect it.

### D6 — The op table carries the argv builder and the undo policy in one entry, and one test proves every entry states one

Resolving F8 — Go's answer to a TypeScript mapped type.

Upstream's guarantee is "you cannot add an operation without stating its undo policy". The Go shape
that comes closest is a single table where the two facts are *the same struct literal*, so there is
no second place to forget:

```go
// gitsession/ops.go
type opSpec struct {
    // Undo states this kind's policy — gitpreflight.UndoPolicy, never a bare bool: a
    // notUndoable kind carries the user-facing reason upstream's own UNDO_POLICY does.
    Undo gitpreflight.UndoPolicy
    // Prepare builds the argv sequence and, for an undoable kind, captures the recovery record
    // BEFORE anything is written (D7). An earlyError short-circuits with no write at all.
    Prepare func(ctx context.Context, e *RepoEntry, op OpRequest) (prepared, error)
}

var opTable = map[string]opSpec{ /* ten entries, D5 */ }
```

A kind absent from the table is one this phase does not serve (D5) — which is the behaviour we
want, and is visible the moment anyone tries it. A kind present in the table without a policy is
the failure mode Go cannot catch, so one test does:
`TestOpTable_EveryEntryStatesAnUndoPolicy` asserts every entry's `Undo.Kind` is one of the two
legal values and that every `notUndoable` carries a non-empty reason. It is four lines and it is
the only thing standing where `tsc` stood upstream, so it is worth the exception to
`AGENTS.md`'s test bar — and it is named in D18 as such.

The reasons themselves are ported verbatim from `undo/slot.ts:35-61` for the ten served kinds, so
G12/G13 inherit strings the UI already renders.

### D7 — The undo slot: one per repo, on `RepoEntry`, attributed at read time by suffix

Resolving SPEC §6's "**Undo slot: one per repo**, not per connection, with the *originating client*
attributed in its label" together with F9.

**Shape** (`gitpreflight/undo.go`, a port of `undo/slot.ts` with two fields added):

```go
type UndoRecord struct {
    ID          string
    Label       string      // upstream's exact text: "Deleted branch <name>" / "Deleted tag <name>"
    RecoverySha string
    CreatedAt   int64       // unix millis
    Replay      [][]string  // a list: restoring a branch is a ref write plus N config writes
    OriginConn  ConnID      // SPEC §6's attribution — never crosses the wire as a field
    OriginLabel string      // the handshake's clamped client label (F11)
}

type UndoSlot struct{ mu sync.Mutex; record *UndoRecord }
func (s *UndoSlot) Peek() *UndoRecord
func (s *UndoSlot) Set(r *UndoRecord)          // nil clears — called for EVERY op
func (s *UndoSlot) Take(id string) *UndoRecord // returns and clears; nil on id mismatch
```

**Storage**: one `*UndoSlot` field on `RepoEntry`, beside the two caches G4 added, with its own
mutex exactly as `detailCache`/`diffCache` have theirs (`cache.go`). Not on `Conn`: SPEC §6's split
rule puts a fact about *the repository* in the shared box, and "what the last operation on this
repository was" is one. Not its own package-level registry: the `RepoEntry` already is the per-repo
shared box, and a second keyed structure beside the `Registry` would be a second lifetime to get
right.

**Lifecycle** — three bounds, exactly upstream's, none of them a wall-clock timer:

1. **The next operation clears it.** `RunOp` calls `slot.Set(record | nil)` unconditionally, on
   every path including the early-error one; clearing is the default and retaining is the explicit
   act. An operation run by *another* connection clears it too — that is what "one per repo" means.
2. **The entry's teardown drops it.** `RepoEntry.teardown()` (refcount zero plus the 5-minute
   linger) already drops both caches; the slot goes with them.
3. **`undo.run` refuses a recovery object that no longer resolves** — `cat-file -e <sha>^{commit}`
   through the entry's existing batch session, checked after `Take` and before any replay. §7.12's
   "so the user can recover manually even after the slot is cleared" only holds if a stale sha is
   refused rather than replayed against something else.

**Attribution is composed at read time, as a suffix.** The record stores who created it; the
snapshot that crosses the wire is built per request:

```go
func (r *UndoRecord) SnapshotFor(conn ConnID) UndoSlotSnapshot   // label + " (window: <OriginLabel>)" iff conn != r.OriginConn
```

This satisfies SPEC §6 precisely ("*so a **second window** sees …*"), keeps the single-window label
byte-identical to upstream's — which F9 shows two future phases depend on — and appends rather than
prepends, which is what makes it safe against both start-anchored detectors. A record whose
`OriginLabel` is empty (a raw socket client that sent no label) gets no suffix rather than
`(window: )`.

### D8 — `RunOp` runs **entirely** under a context detached from the request

Resolving F7. `gitrpc`'s `op.run`/`undo.run` handlers call
`entry.RunOp(context.WithoutCancel(ctx), …)` — and the detachment covers the *whole* executor, not
just the write:

| Step | Detached? | Why |
|---|---|---|
| capture undo (reads) | yes | it is the write's own precondition; a half-captured record is worse than none |
| the write itself | yes | SPEC §6, in as many words |
| post-op read-back (head + in-progress) | yes | **the decisive one**: head and the undo slot are *shared* state, read by every other connection. Skipping the read-back because one window disconnected leaves every other window describing a repository that no longer exists |
| marshalling and delivery | n/a | `rpcstream` drops the result if the session is gone (`removeActiveWork` returns false) — exactly SPEC's "the result is simply not delivered anywhere" |

`context.WithoutCancel` (stdlib, Go 1.21+; this module is on `go 1.27.0`) keeps the request's values
and drops its cancellation, which is the exact semantic wanted.

**No deadline is added.** Every operation in this phase is a local spawn, `GIT_TERMINAL_PROMPT=0`
means git cannot block on a prompt, and the only remaining way to hang is a foreign process holding
`index.lock` indefinitely — which a timeout would convert from "slow" into "killed halfway", the
worse outcome for a write. G7's remote ops get real cancellation semantics of their own
(`remote.cancel`, its own killable-phase policy); local ops are deliberately uncancellable and
SPEC §6 says so. Recorded in §10 so it is a decision, not an omission.

Reads are unaffected: both pre-flights and `status.get`/`refs.list` keep the request ctx and keep
dying on cancel, exactly as G4 F15 established.

### D9 — The in-progress state reader is plain filesystem reads off the per-worktree `GitDir`, and the watcher does not change

Resolving F11 and porting `ops/conflict.ts` verbatim.

```go
// gitops/conflict.go
func ReadInProgressStateFiles(gitDir string) gitpreflight.InProgressStateFiles
```

Nine reads against `RepoSummary.GitDir` — **never `CommonDir`**: all of these are per-worktree, and
in a linked worktree they live in `<commonDir>/worktrees/<name>/`, which is exactly what `GitDir`
already is (`repo.go:163`, `:204-208`). `MERGE_HEAD`/`CHERRY_PICK_HEAD`/`REVERT_HEAD` and
`rebase-merge/head-name`/`rebase-merge/onto` are read as trimmed content; `BISECT_LOG`,
`rebase-merge/`, `rebase-apply/` and `sequencer/` are presence checks. A missing file is the zero
value, never an error — `os.ReadFile`'s error is swallowed by design, because "not there" is the
answer 99% of the time and the classifier has no use for the distinction.

`AUTO_MERGE` is deliberately **not** read: upstream's probe P4 found it left behind after an
aborted cherry-pick, so it is a stale artefact rather than a state signal (this container's probe
P5 sees it written during a conflicting revert, consistent with that).

The nine reads run sequentially, not in nine goroutines: they are `stat`/`read` calls on files
almost certainly in the page cache, and a `Promise.all` there is a JavaScript idiom for an I/O
model Go does not have.

**The watcher is unchanged** (F11): `refIshNames` already covers all four state files upstream's W7
had to add, in both directories.

`ContinueArgs`/`AbortArgs`/`SkipArgs` are total over `InProgressKind`, ported verbatim including
`bisect`'s abort being `bisect reset` (bisect has no `--abort`) and `rebase`/`bisect` having no
continue at all (SPEC's own v1 rebase posture: report and refuse to interfere).

### D10 — `refs.list`: two spawns, two formats, one cache on the shared entry — and pre-flight never reads that cache

Resolving F4, F15 and F16.

**Two spawns**, because `for-each-ref` takes a single `--sort` and git's `v:refname` version-aware
comparison is not something to reimplement:

```
heads:  for-each-ref --format=<RefsFormat>    --sort=-committerdate  refs/heads refs/remotes
tags:   for-each-ref --format=<TagRefsFormat> --sort=-v:refname      refs/tags
```

**Two formats and two framings** (probe P1):

- `RefsFormat` — eleven `%1f`-separated fields, records delimited by the `\n` git appends. Safe
  because no field in it can contain a raw newline (refnames, hex oids, `%(HEAD)`, unix timestamps,
  a tagger name).
- `TagRefsFormat` — `RefsFormat` plus `%(contents:subject)` and `%(contents:body)`, ending in a
  literal `%00`. The annotation body legally contains newlines, so the tags spawn is NUL-framed.
  Git still appends its own `\n` **after** the NUL, so the splitter must strip a single leading
  `\n` from every record after the first and expect exactly `"\n"` (or nothing) as the flush
  remainder. Anything else is a malformed stream and an error, not a silent skip.
- The tag subject/body fields are **only** in the tags format, and the parser gates the whole
  `annotation` object on `%(objecttype) == "tag"` — probe P3: a lightweight tag's
  `%(contents:subject)` is the pointed-at commit's subject, and storing it would render as an
  annotation the tag does not have.

**`ObjectType` is parsed and does not cross the wire** (`json:"-"`): `contract.ts`'s `RefRow` has no
such field, and the one consumer is the tag-delete undo capture, which needs it to know whether
`objectId` is a tag object or a commit.

**`checkedOutIn` is the subtraction** (F15): `%(worktreepath)`, `filepath.Clean`ed on both sides
and compared against `filepath.Clean(Summary.Root)`; equal ⇒ omitted, different ⇒ kept, empty ⇒
omitted. Applied to branches and remote branches, never tags.

**Caching**: a single-value `refsCache` on `RepoEntry` beside G4's two, dropped in
`RepoEntry.note()` on `refsChanged` **before** the fan-out — the same ordering G4 D7 established
for the detail cache and G3 D13 for `Walk` staleness, for the same reason.

**Pre-flight and the executor never read it** (F16): `preflight.checkout` and `op.run`'s checkout
arm each take a fresh snapshot. Stated as a rule rather than left to each call site: *the cache
answers `refs.list`; a decision that precedes a write reads git.*

### D11 — `status.get`: the parser is narrowed to what is read, the 200-path cap is display-only

Resolving F1's encoding rule and porting `parse/status.ts` + `model/status.ts`.

**The parser** (`porcelain/status.go`) frames all six record markers correctly and parses only the
fields something reads:

| Marker | Framed | Parsed |
|---|---|---|
| `#` | header line | `branch.oid` (with `(initial)` → unborn, probe P11), `branch.head`, `branch.upstream`, `branch.ab` |
| `1` | one record | XY codes, path |
| `2` | **one record plus the next chunk** | XY codes, path, original path, rename-vs-copy, similarity |
| `u` | one record | XY codes, path |
| `?` / `!` | one record | path |

The `2` record's extra NUL chunk **must** be consumed even though only `originalPath` is read from
it: skipping it misframes every following record. The modes and object ids porcelain-v2 carries in
`1`/`2`/`u` records are not parsed, because nothing in G5, G12 or G13 reads them — upstream models
them in `core/src/model/conflict.ts` for a three-way conflict view its own §9 defers to v2, and
this chapter defers it too. An unrecognised marker is an error, not a skipped line.

**The folds** (`gitpreflight/status.go`), ported verbatim from `model/status.ts`:
`SummarizeStatus(result, inProgress) StatusSummary`, `DirtyPaths(result) []DirtyPath` (unmerged
counts as **tracked** — it has index stages, and discard is the remedy that applies), and
`UnmergedPaths(result) []string`.

**The cap**: `DirtyPathsDisplayCap = 200` is applied to `StatusSummary.dirtyPaths` on its way to the
wire, with `dirtyTruncated` set. The checkout intersection is computed over the **full, uncapped**
set — capping the input produces a wrong verdict, capping the display produces a shorter dialog.
That distinction is the entire reason the cap lives in `gitsession`'s handler and not in the fold.

### D12 — `ClassifyCheckout` is ported verbatim, including the two parameters that do nothing yet

Resolving F15 and porting `preflight/checkout.ts` line for line — the set intersection, split by
trackedness, plus the three non-path blockers, in upstream's exact blocker order
(`inProgressOperation`, `worktreeConflict`, `blockedByUntracked`, `blockedByTracked`) because the
dialog renders the first as its headline.

Two parameters are ported *with their upstream values* rather than dropped:

- **`targetTreePaths` is always `nil`.** Upstream's own comment explains why and this phase does not
  re-derive it: for a plain checkout every path in `T = diff --name-only HEAD <target>` is one the
  target either changes or adds, so "in `T`" and "in the target tree" coincide for an untracked
  path. Keeping the parameter is what lets the test matrix state the distinction and what lets G12's
  stash-pop caller supply a genuinely different `T` without changing the signature.
- **`stashAvailable` is `false` until G12.** `routes` already gates `"stashAndCarry"` on it, so G12's
  whole change is flipping one call site — upstream's own P9 W9 did exactly that.

The `worktreeConflict` blocker is the fifth §7.5 does not enumerate (F15), and the two refusals it
pre-empts are probe P8's.

**No host-side gate re-check.** Upstream re-checks `canRunOp` immediately before the write for
`reset` and `cherryPick` (P10 probe 3: git itself only refuses a *soft* reset mid-merge). Neither
of G5's two gated operations has that hole — probe P5 shows git refusing `switch` during a revert
with `fatal: cannot switch branch while reverting`, and revert refuses itself the same way — so
adding a re-check here would be defending against a case git already defends. `canRunOp` stays
client-side only (F10) and G13 adds the Go re-check when it adds the operations that need one.

### D13 — `ClassifyRevert`: `merge-tree --merge-base`, prediction scoped to `shas[0]`, parent lookups sequential

Porting `preflight/revert.ts` plus its orchestration, with one deviation.

- The prediction is `merge-tree --write-tree --messages --name-only --merge-base=<C> HEAD <C>^<N>`
  — "merge, into HEAD, the tree of `C`'s mainline parent, treating `C` itself as the base", which
  *is* the inverse patch a revert applies, and unifies the non-merge (`^1`) and merge (`^N`) cases
  into one invocation. Probe P4 is why the `--merge-base` is not optional: without it git picks its
  own base and reports a genuinely conflicting revert **clean**.
- Exit 0 = clean, exit 1 = conflicts, >1 = a real failure (D15).
- A merge commit with no mainline chosen yet gets `{kind:"unknown", reason:…}` rather than a guess
  — §7.10's "rather than guessing `-m 1`", made structural.
- `predictedFor = shas[0]`, always; the UI quotes it when `shas.length > 1`.
- `detachedHead` is a note, not a blocker.
- **Deviation from upstream (F18): the per-sha `show -s` lookups run sequentially, not through a
  `Promise.all` equivalent.** Upstream has no read pool; this app's is four wide and shared with
  every other connection on the repository, so a 50-commit multi-select revert firing 50 concurrent
  reads would hold the whole pool and stall the other window's graph stream. A revert pre-flight is
  a human-speed action on a selection that is realistically one to a few commits; sequential costs
  a few milliseconds each and cannot starve anything.

### D14 — Operation-level error classification is `gitops`'s, scoped to the kinds G5 can produce; `gitclient.ErrorKind` is not widened

Resolving F7. Two vocabularies exist and must stay separate:

- **`gitclient.ErrorKind`** — five members, about the *spawn*: cancelled, timeout, permission,
  not-a-repository, unknown. Every read in this app classifies through it and G5 changes nothing
  about it.
- **`OpErrorKind`** — twenty-five members, about the *operation*, declared in `contract.ts:636-692`
  and rendered by the UI with a remedy per kind.

`gitops.ClassifyOpError(stderr string, exitCode int) (kind, message string)` is an **ordered**
pattern table (order matters as much as the patterns — a more specific rule must precede the
general one it would be swallowed by), scoped to what G5's own ten operations can actually produce.
Every pattern is verbatim from a real failure observed in this container:

| Kind | Pattern (lowercased match) | Probe |
|---|---|---|
| `AlreadyExists` | `a branch named '…' already exists`, `tag '…' already exists` | upstream P4/P3 |
| `NotFullyMerged` | `the branch '…' is not fully merged` | upstream P4 |
| `WorktreeConflict` | `used by worktree at` (covers both the switch and the delete message) | **P8** |
| `MainlineRequired` | `is a merge but no -m option was given` | **P6** |
| `UntrackedWouldBeOverwritten` | `untracked working tree file` (matches both the plural list header and `--discard-changes`' singular form) | **P7** |
| `DirtyWorktree` | `your local changes to the following files would be overwritten` | **P7** |
| `OperationInProgress` | `cannot switch branch while `, `there is no … in progress` | **P5** |
| `Conflict` | `could not apply`, `could not revert`, `conflict (` | **P5** |
| `NotFound` | `reference is not a tree:`, `no branch named`, `not found`, `bad object`, `invalid reference` | upstream P7 |
| `LockHeld` | `index.lock`, `another git process seems to be running` | — |
| `Unknown` | everything else; the message is still git's own stderr, verbatim | — |

`MainlineRequired` is in this table even though upstream put it in P10, because probe P6 shows
`git revert <merge>` producing it and G5 ships revert — and "pre-flight is advice, not a lock"
(upstream's own phrase) means the race that reaches it is real, not hypothetical.

Not in the table: every `AuthFailed`/`NonFastForward`/`LeaseViolation`/`RemoteRefUpdated`/
`NetworkFailed`/`RemoteNotFound`/`RemoteRefMissing`/`HookRejected`/`ProtectedBranch`/`Cancelled`
(G7), `StashConflict`/`StashIndexConflict`/`StashUntrackedCollision` (G12),
`EmptyCherryPick`/`ConfirmationRequired` (G13). Each lands with the operation that produces it,
prepended or appended to the same ordered table.

**A classified operation failure is never an RPC error.** `op.run` is the one request where a git
failure is an expected outcome with a rendering: a non-zero exit becomes `OpResult{ok:false,
error:{kind,message}}` together with the post-op `head` and `inProgress`. Only a spawn failure, a
cancellation or a genuinely broken repository propagates as an `RpcError` — the same rule
upstream's own W11 states ("`op.run`'s handler does **not** try/catch").

### D15 — Three commands get a raw-exit helper rather than going through `Classify`

Resolving F14, following `repo.go:232-260`'s existing pattern.

```go
// gitsession
func (e *RepoEntry) runAllowingExit(ctx context.Context, args []string, ok ...int) (gitclient.Result, error)
```

Runs through the same read gate and the same `gitclient.Run`, then calls `Classify` only when
`ExitCode` is outside `ok`. Used by exactly three callers, each with its reason at the call site:
`merge-tree` (`ok = 0, 1`), `config --get-regexp` (`ok = 0, 1`) and `rev-parse --verify` during
undo capture (`ok = 0, 1` — a ref that has already vanished is a `nil` record, not an error).
`for-each-ref` on a single refname needs nothing special: exit 0 with empty output is already the
"no such ref" answer.

### D16 — `RepoEntry` grows a **live** head, re-resolved lazily after a ref change

Resolving F5. Three writers, one reader, no polling:

- `gitclient` exports `ResolveHead(ctx, runner, gitPath, dir) (HeadState, error)` — the existing
  unexported `headState` (`repo.go:232-266`), promoted with no behaviour change. `Identify` keeps
  calling it.
- `RepoEntry` holds `head HeadState` (seeded from `Summary.Head` at construction) plus a
  `headStale bool` set by `note()` on `refsChanged`, under one mutex.
- `RepoEntry.Head(ctx)` returns the cached value, re-resolving through `ResolveHead` first if stale.
- `statusAndInProgress` and `RunOp`'s read-back both **write** the head they already computed from
  `status --branch`'s header, for free, and clear the stale flag — so the extra two spawns only ever
  happen when a ref changed and the next reader is `refs.list` rather than `status.get`.
- `repo.open` composes its `RepoSummary` with the live head, so a second window opening an
  already-open repository is no longer handed a value frozen at the first window's open.

Upstream is weaker here — `session.head` is refreshed only by `statusSummary` and by scanning
`refs.list`'s own `%(HEAD)` markers, which leaves a detached or unborn HEAD stale — and the weaker
version is not worth porting when the stronger one is a field, a flag and one promoted function.

### D17 — `git-core` drops exactly `preflight/checkout.ts` and `preflight/revert.ts`; the four live symbols stay where they are

Resolving F10 and closing G1 D14's hand-off with the information G1 did not have.

**Deleted in this phase**: `packages/git-core/src/preflight/checkout.ts`, `preflight/revert.ts`,
their two `.test.ts` files, and the two `index.ts` lines that re-export them (`:128`, `:134`). Two
stale comment references in `model/status.ts` (`:12`, `:168`) are reworded to name the Go home.
Nothing else in `git-core` changes; `preflight/types.ts` stays whole (the other classifiers use it,
and the exported *types* have their own `index.ts` block that is untouched).

**Not deleted, with the phase that owns each**: `preflight/cherryPick.ts` and `preflight/reset.ts`
(G13 — and `reset.ts`'s `classifyReset` has a live UI caller, `state/ops.ts:490`, so G13 must decide
whether the client-side re-derivation survives), `preflight/push.ts` and `preflight/pull.ts` (G7),
`preflight/stashPop.ts` (G12), `undo/slot.ts` (G13, per SPEC's own G13 row and G1 D14).

**`preflight/tag.ts` is never deleted**: `validateRefName` lives in it and has four live UI callers
(F10). `classifyTagCreate` shares the file and has none — but deleting one export from a file four
components import to reduce a 71-line file to 40 is churn for its own sake, and there is no server
counterpart to point at (`preflight.tag` is not a contract method; tag-name validation is
deliberately client-side, F17).

**`validateRefName` and `classifyReset` stay exactly where they are.** G1 D14 floated relocating
them to `git-core/src/model/`. Rejected: they work, four `.vue` files and one state module import
them at their current paths, `packages/git-core` is upstream's code kept recognisable against its
source, and a move would be a diff in five files that changes nothing anyone can observe.

### D18 — What gets a test, and what does not

`AGENTS.md`'s bar, applied honestly. **Tested:**

- **`porcelain/refs.go`** — the eleven- and thirteen-field records with their two different
  framings, the trailing-empty-field case (a branch's `%(taggerdate:unix)` is empty *and last*,
  which a naive split gets wrong), the `%00`-plus-`\n` record boundary, a lightweight tag whose
  borrowed commit subject must be discarded, an annotated tag with a multi-line body, a branch
  checked out in a worktree, and all three `%(upstream:track)` shapes. ("a parser/splitter with
  several interacting rules")
- **`porcelain/status.go`** — the `2` record's two-chunk framing (and that a following record still
  parses), an unborn header (`(initial)`), `branch.ab` parsing, a `u` record, a path containing a
  space, and an unrecognised marker failing loudly. (same clause)
- **`gitpreflight/operation.go`** — `ClassifyInProgress`, one named test per row of the precedence
  table plus the two shadowing cases (a rebase that also left sequencer files must classify as
  `rebase`; unmerged paths with no state file at all must classify as `unmergedOnly`), and
  `canContinue`/`canSkip` staying independent of `unmergedCount`. ("a decision structure too large
  to hold in your head")
- **`gitpreflight/checkout.go`** — upstream's whole matrix: the six probe-P1 cases, a clean tree, a
  dirty-but-disjoint tree with both tracked and untracked members, both blocker kinds at once, each
  non-path blocker alone and in combination (asserting the **order**), a `sha` target, a tag target,
  a remote-branch target in both modes, an empty `T`, and `stashAvailable` in both states asserting
  only that `routes` changes. (the phase's densest pure logic)
- **`gitpreflight/revert.go`** — non-merge, two-parent merge, octopus, mainline already supplied,
  dirty tree, in-progress op, detached HEAD, and multi-sha asserting `predictedFor == shas[0]`.
- **`gitops/errors.go`** — one case per row of D14's table, each using verbatim stderr from this
  plan's probes, plus the two ordering assertions that matter: a worktree-conflict delete
  classifies as `WorktreeConflict` and *not* `NotFullyMerged`, and a conflicting revert classifies
  as `Conflict` and not `Unknown`.
- **`gitsession`** — the undo slot's lifecycle (set/peek/take, take twice, id mismatch, cleared by
  the next op) and the op table's completeness (D6).
- **`gitsock` integration** — §3.8's tests over a real socket against real repositories. **This is
  the phase's real end-to-end proof.**

**Not tested, deliberately**: `gitops`' argv builders (each returns one literal slice — `AGENTS.md`'s
"thin pass-through" and "constructors/builders"; their correctness is proven by the integration
tier actually running them), `gitrpc`'s handlers (thin dispatch), `gitpreflight/status.go`'s folds
(a switch with one arm per marker, exercised by every integration test), and `gitops/conflict.go`'s
three argv tables (a `switch` returning literals — the *reader* is exercised in integration).

### D19 — The golden corpus grows; every fixture builder copies G4 D15's isolated environment

New recordings under `KIRA_GIT_FIXTURES=write`, argv taken from this package's own builders so
recorder and parser cannot drift (G3 D15's rule, unchanged):

| Fixture | Shape it pins |
|---|---|
| `testdata/refs/heads.bin` | a branch, a remote branch, `%(HEAD)`'s `*`, a `%(worktreepath)` for a linked worktree, `[ahead N]`/`[gone]`/empty track, the trailing empty field |
| `testdata/refs/tags.bin` | a lightweight tag (borrowed commit subject, to be discarded) and an annotated one with a multi-line body, in the `%00`+`\n` framing |
| `testdata/status/{clean,mixed,renamed,unmerged,unborn}.bin` | the six markers, the `2` record's two chunks, `branch.ab`, `(initial)` |
| `testdata/mergeTree/{clean,conflict}.bin` | the tree-oid line, the path block, the message block |

Every new fixture repository — in `porcelain`, in `gitpreflight` (none: it is pure), in `gitops`,
in `gitsession` and in `gitsock` — is built with `fixtureEnv()`'s `GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_SYSTEM=/dev/null` and per-commit `-c commit.gpgsign=false`. **No test, fixture or
script in this phase runs `git config --global` or `--system`.**

### D20 — `gitrpc` stays thin dispatch, in two new files

The handlers decode params, resolve `c.Entry(repoID)` (G4 D18's accessor), call one `RepoEntry`
method, and marshal. `refs.go` holds `refs.list`/`status.get`/`preflight.checkout`/
`preflight.revert`; `ops.go` holds `op.run`/`undo.peek`/`undo.run`. `mapDetailError`'s pattern
(G4) extends to this phase's own closed error set. No handler in this phase can produce a result
large enough to need G4 D2(b)'s exact-size treatment, so all seven return plain structs.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/internal/`.

### 3.1 `gitclient/porcelain/refs.go` — new (D10)

| Export | Contents |
|---|---|
| `RefsFormat` | `%(refname)%1f%(objectname)%1f%(objecttype)%1f%(upstream)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(HEAD)%1f%(*objectname)%1f%(worktreepath)%1f%(taggername)%1f%(taggerdate:unix)` — 11 fields |
| `TagRefsFormat` | `RefsFormat + "%1f%(contents:subject)%1f%(contents:body)%00"` — 13 fields, NUL-terminated |
| `HeadsRefsArgs()` | `for-each-ref --format=<RefsFormat> --sort=-committerdate refs/heads refs/remotes` |
| `TagRefsArgs()` | `for-each-ref --format=<TagRefsFormat> --sort=-v:refname refs/tags` |
| `SingleRefArgs(refname)` | `for-each-ref --format=<RefsFormat> <refname>` — the undo capture's own read (D7) |
| `RefTrack`, `TagAnnotation`, `RefRow` | JSON-tagged per G4 D5's encoding rule; `ObjectType` is `json:"-"` |
| `ParseRefRows(raw []byte, withSubject bool) ([]RefRow, error)` | LF framing when `!withSubject`; NUL framing with the leading-`\n` trim and the `"\n"`-only remainder check when `withSubject` (probe P1) |

`RefRow.Track` is `any` — `RefTrack{…}`, the string `"gone"`, or `nil` with `omitempty`. The
contract's `RefTrack | 'gone' | undefined` is a three-way union whose Go alternative is a typed
wrapper with a `MarshalJSON`; `any` produces byte-identical output with a doc comment instead of
twenty lines, and this is the only field in the chapter shaped that way.

`refs_test.go`: D18's list, table-driven over the committed fixtures.

### 3.2 `gitclient/porcelain/status.go` — new (D11)

`StatusArgs()` = `status --porcelain=v2 --branch --untracked-files=normal -z`. **Never
`--untracked-files=all`** — probe/upstream: with `normal`, an ignored file never appears in status,
so it is never in `D`, so the intersection never sees it, and git silently overwrites it on
checkout. That is git's behaviour and this phase reproduces it; `all` would drag every build
artefact into `D` and block half the checkouts in a real repository.

`StatusBranchInfo`, `StatusEntry` (kind, staged/unstaged codes, path, originalPath,
renameOrCopy, similarity), `StatusResult`, `ParseStatus(records [][]byte) (StatusResult, error)`.
`status_test.go`: D18's list.

### 3.3 `gitclient/porcelain/mergetree.go` — new (D13)

`MergeTreeArgs(base, other, mergeBase string) []string` — `merge-tree --write-tree --messages
--name-only [--merge-base=<sha>] <base> <other>`, the option before the two revisions.
`MergePrediction{Kind, TreeID, Paths, Messages}`, `ParseMergeTreeOutput(stdout []byte, exitCode
int) (MergePrediction, error)` — line 0 is the tree oid, then blank-line-separated blocks; exit 0
⇒ clean, exit 1 ⇒ the first block is the conflicted paths, anything else ⇒ an error.
`mergetree_test.go`: the two committed fixtures.

### 3.4 `gitpreflight/` — new package (D3)

| File | Contents |
|---|---|
| `operation.go` | `InProgressKind`, `InProgressOperation` (JSON-tagged), `InProgressStateFiles`, `ClassifyInProgress` — the precedence table verbatim, `canSkip` true for `cherryPick`/`revert` only, `canContinue` false for `rebase`/`bisect`/`unmergedOnly` and independent of `unmergedCount` |
| `status.go` | `StatusSummary` (JSON-tagged), `SummarizeStatus`, `DirtyPath`, `DirtyPaths`, `UnmergedPaths`, `DirtyPathsDisplayCap = 200` |
| `checkout.go` | `CheckoutBlocker`, `CheckoutPreflight`, `ClassifyCheckout` — D12 |
| `revert.go` | `RevertParentChoice`, `RevertPrediction`, `RevertPreflight`, `ClassifyRevert` — D13 |
| `undo.go` | `UndoRecord`, `UndoSlotSnapshot`, `UndoPolicy`, `UndoSlot` — D7 |

Imports: `gitclient/porcelain` (for `StatusResult`) and stdlib. No `gitclient`, no `gitsession`, no
`bridge`. Pure functions and one mutex-guarded slot; nothing here spawns a process or touches the
filesystem, which is what makes D18's matrices testable without a repository.

### 3.5 `gitops/` — new package (D4)

| File | Exports |
|---|---|
| `checkout.go` | `SwitchArgs(branch, discard)`, `SwitchDetachArgs(target, discard)`, `SwitchCreateTrackingArgs(branch, upstream, discard)`, `RewrittenPathsArgs(target)` |
| `branch.go` | `BranchCreateArgs`, `BranchCreateAndSwitchArgs`, `BranchSetUpstreamArgs`, `BranchDeleteArgs`, `BranchRenameArgs`, `BranchRevParseArgs`, `BranchConfigRegexpArgs` |
| `tag.go` | `TagCreateArgs(name, target, message, force)`, `TagDeleteArgs(name)`, `UndoTagArgs(name, sha)` |
| `revert.go` | `RevertArgs(shas, mainline, noCommit)` |
| `conflict.go` | `ReadInProgressStateFiles(gitDir)`, `ContinueArgs(kind)`, `AbortArgs(kind)`, `SkipArgs(kind)` |
| `errors.go` | `ClassifyOpError(stderr string, exitCode int) (kind, message string)` |

Details that are easy to get wrong and are therefore fixed here:

- **`--no-guess` on every plain `switch`** (upstream probe P7): without it `git switch topic`
  silently creates a local branch tracking `origin/topic`, which is a helpful terminal default and
  a bad one in a UI that just showed the user a list labelled "remote branches".
  `CheckoutPreflight.createsTracking` turns the same case into a labelled choice.
- **`RewrittenPathsArgs` is `diff --name-only -z HEAD <target>`** and carries no
  `--no-optional-locks`: `buildArgv` places that at git level for every `ReadOnly` spec, and after
  the subcommand git exits 129 (G4 probe P6).
- **`TagCreateArgs` re-supplies `-a -m` whenever a message is present, including under `-f`** —
  probe P3: `git tag -f <name> <sha>` on an annotated tag silently downgrades it to lightweight.
- **`UndoTagArgs` is one function, not upstream's two.** `undoAnnotatedTagArgs` and
  `undoLightweightTagArgs` have identical bodies (`update-ref refs/tags/<name> <sha>`); what
  differs is only which sha the caller captured, which is the caller's decision and is recorded in
  the capture (D7), not in two argv builders that emit the same argv.
- **`RevertArgs` always passes `--no-edit`**, one invocation for all shas (§7.10's all-or-nothing
  is `--abort`, not chunking), `-m <n>` only when a mainline was chosen.
- **`ContinueArgs`/`AbortArgs`/`SkipArgs` are total over `InProgressKind`** (D4), including
  `bisect`'s `bisect reset`.

### 3.6 `gitclient/repo.go` — edited (D16)

`headState` becomes exported `ResolveHead(ctx, runner, gitPath, dir) (HeadState, error)`, body
unchanged; `Identify` calls it. Its doc comment gains one sentence naming the new caller. Nothing
else in `gitclient` changes.

### 3.7 `gitsession/` — edited (D5–D8, D10–D16)

| File | Change |
|---|---|
| `refs.go` (new) | `(*RepoEntry).Refs(ctx)` (cache-reading), `refsSnapshot(ctx)` (always fresh, F16), the `%(worktreepath)` subtraction, `resolveCheckoutTarget` (branches → tags → remote branches → raw sha), `localNameForRemoteBranch` |
| `status.go` (new) | `(*RepoEntry).Status(ctx)`, `statusAndInProgress(ctx)` — the one place `ParseStatus`, `ReadInProgressStateFiles` and `ClassifyInProgress` are joined, so no caller pays a second `status` spawn and none of them can disagree about what "in progress" means; refreshes the live head as its side effect (D16) |
| `preflight.go` (new) | `PreflightCheckout(ctx, target, mode)`, `PreflightRevert(ctx, shas, mainline)`, `revertMergeParents` (sequential, D13), `predictRevert` |
| `ops.go` (new) | `OpRequest` (the Go decode of `contract.ts`'s union), `opTable` (D6), `prepareOp`, `RunOp`, the two undo captures, `UndoPeek`, `UndoRun` |
| `entry.go` | `head`/`headStale`, `refs *refsCache`, `undo *gitpreflight.UndoSlot` fields; `note()` drops the refs cache and marks the head stale **before** the fan-out; `teardown` clears both |
| `cache.go` | `refsCache` — a single value plus a mutex, not an LRU: there is one ref list per repository |
| `conn.go` | `ClientLabel string` field, set by `NewConn` (F11) |
| `queries.go` | `runAllowingExit` (D15) beside the existing `runOne` |
| `ops_test.go`, `undo_test.go` (new) | D18's slot lifecycle and op-table completeness |

**`RunOp`, in this exact order** (upstream's, with D8's detachment):

```
0. ctx = context.WithoutCancel(request ctx)                        (D8)
1. spec, ok := opTable[op.Kind]; !ok -> E_UNKNOWN_METHOD naming the kind   (D5)
2. prepared, err := spec.Prepare(ctx, e, op)   — argv, and the undo record CAPTURED FIRST
   prepared.earlyError -> slot.Set(nil), read back, return {ok:false, …}
3. e.Repo.Write(ctx, …) each argv in order                          (F12: cross-connection serial)
4. read back head + in-progress state, ALWAYS — success or failure
5. slot.Set(record) iff the write succeeded AND opTable[kind].Undo is undoable; else Set(nil)
6. return OpResult{ok, error, undo: snapshotFor(conn), head, inProgress}
```

Step 2 before step 3 is the entire correctness of undo: the sha must be read while the ref still
exists. Step 4 after *both* outcomes is what makes a conflicting revert — which fails with
`Conflict` and *leaves* `REVERT_HEAD` (probe P5) — produce an `OpResult` whose `inProgress` is
populated, so the banner appears from the operation's own reply rather than waiting on a watcher
tick. Step 5 consults the table rather than trusting which `Prepare` branch happened to build a
record, so the policy stays the one authority.

**The two undo captures**, both "capture before, replay after", never "parse git's output":

- **Branch delete**: `rev-parse --verify refs/heads/<name>` (the sha, while the ref still exists)
  plus `config --get-regexp '^branch\.<name>\.'` (D15's tolerated exit 1). Replay is
  `update-ref refs/heads/<name> <sha>` followed by one `config <key> <value>` per captured line.
  Upstream's probe P4: `git branch -D` deletes `branch.<name>.remote`/`.merge` along with the ref,
  so an undo that stops at the ref silently downgrades the branch. Label: `Deleted branch <name>`.
- **Tag delete**: one `SingleRefArgs("refs/tags/<name>")` read, parsed by `ParseRefRows`. Replay is
  `update-ref refs/tags/<name> <objectId>` — the **tag object's** sha for an annotated tag, which
  survives `git tag -d` in the object database (upstream probe P3), restoring tagger, date and
  message byte-identically. Re-creating it with `tag -a -m` would mint a *new* object with a new
  tagger date, which is not "restoring a deleted tag". Label: `Deleted tag <name>`.

Both labels are byte-identical to upstream's (F9). Both captures return `nil` on any failure rather
than aborting the operation: an undo that could not be captured is an undo not offered, never a
delete that does not happen.

**`UndoRun`**: `slot.Take(id)` (nil ⇒ `{ok:false, NotFound, "This undo is no longer available."}`),
then `cat-file -e <recoverySha>^{commit}` through the entry's existing batch session (nil ⇒
`{ok:false, NotFound, "The recovered commit <short> no longer exists."}`), then replay the argv
list in order through `Repo.Write`, then the same read-back, returning `undo: null`.

### 3.8 `gitrpc/` — edited (D20)

| File | Change |
|---|---|
| `wire.go` | params/results for the seven methods, mirroring `contract.ts` field for field |
| `refs.go` (new) | `refs.list`, `status.get`, `preflight.checkout`, `preflight.revert` |
| `ops.go` (new) | `op.run`, `undo.peek`, `undo.run` — the two write methods detach their context (D8) |
| `handlers.go` | seven new cases in `Request`; `Stream` unchanged |
| `contract.go` | **unchanged** — `ContractVersion` stays 14 (D1) |

### 3.9 `gitsock/` — edited

`server.go:187` becomes `gitsession.NewConn(ConnID(sessionID), clientID, label, nil)`, with
`handshake` returning the clamped label alongside `clientID`/`sessionID` (F11). No other change:
`Router`, framing, pairing and the trust store are untouched.

`gitsock/ops_test.go` (new), over the existing harness (F19), against a fixture repository built
with two branches, a linked worktree, a lightweight tag, an annotated tag, an upstream-tracking
branch and a commit pair that reverts into a conflict:

- **`TestIntegration_RefsList`** — branches, remote branches and tags in their two sort orders;
  `isHead`; `checkedOutIn` present for the linked worktree's branch and **absent for our own**;
  `peeledObjectId` and `annotation` on the annotated tag and neither on the lightweight one;
  `track` in all three shapes.
- **`TestIntegration_StatusAndInProgressBanner`** — a clean tree, then a dirty one with counts and
  `dirtyPaths`, then a conflicting revert producing `inProgress.kind == "revert"` with
  `conflictedPaths`, `canContinue`, `canSkip` and `isSequence: false`; then `opAbort` clearing it.
- **`TestIntegration_CheckoutPreflightAndRun`** — clean, cleanCarry (a dirty file outside `T`),
  `blockedByTracked` with `routes: ["discard"]`, `blockedByUntracked` with `routes: []`, and
  `worktreeConflict` for the linked worktree's branch; then `op.run` performing the switch and the
  result's `head` naming the new branch **before** any `repo.changed` arrives.
- **`TestIntegration_RevertPreflightAndConflict`** — a clean prediction, a conflicting prediction
  (proving `--merge-base` is in the argv, probe P4), `mainlineRequired` for a merge commit, and the
  conflicting `op.run` returning `ok:false` with `Conflict` **and** a populated `inProgress`.
- **`TestIntegration_UndoBranchDeleteRestoresTracking`** — delete a branch that has
  `branch.<name>.remote`/`.merge`, `undo.peek` reports the slot, `undo.run` restores both the ref
  and the config; a second `undo.run` with the same id answers `NotFound`.
- **`TestIntegration_UndoSlotIsSharedAndAttributed`** — **two connections, one repository**: window
  A deletes a tag, window B's `undo.peek` sees the slot with the ` (window: …)` suffix and window
  A's does not; any op from either window clears it.
- **`TestIntegration_UnservedOpKindIsRefused`** — `op.run` with `kind: "tagPush"` answers
  `E_UNKNOWN_METHOD` naming the kind, not a silent success (D5).
- **`TestIntegration_WriteSurvivesClientCancel`** — a `cancel` frame sent mid-`op.run` does not
  prevent the write from completing or the shared head from being updated, observed from a second
  connection (D8). Driven through an injected `Runner` that blocks until the test releases it, so
  the race is deterministic rather than timing-dependent.

### 3.10 `main.go`

**Unchanged.** Every new type is reached through the `Registry`, the `Router` and the socket server
G1/G2 already construct.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-core` — two deletions (D17)

Delete `src/preflight/checkout.ts`, `src/preflight/checkout.test.ts`, `src/preflight/revert.ts`,
`src/preflight/revert.test.ts`; delete `index.ts:128` and `index.ts:134`; reword the two comments in
`model/status.ts` (`:12`, `:168`) that point at the deleted files to name
`internal/gitpreflight/checkout.go` instead.

`bun run typecheck:git` and `bun test packages/git-ipc/src` are what prove nothing depended on
them.

### 4.2 What does **not** change

**`packages/git-ui`, `packages/git-ipc` and `apps/kira-studio-vscode` are byte-for-byte untouched by
this phase** (F1, F2, D1). Not one file, not one line, not the contract version. If an implementer
finds themselves editing any of the three, something has drifted out of scope — the most likely
drift being an attempt to "fix" a webview rejection that G5 is not meant to close (`stash.list`,
`review.open`) or to add a wire field the contract already declares under a different name.

---

## 5. Dependencies and tooling

**No new dependency, in either language.** No FlatBuffers schema change, so `bun run generate:wire`
is not run and `internal/gitwire`/`src/generated` do not move (D2). `go.mod` and `bun.lock` are
expected to be **unchanged**; a diff in either is a signal something was reached for that this plan
did not sanction.

---

## 6. Implementation order

Seven commits. `go build ./apps/kira-studio/internal/...`, `go test
./apps/kira-studio/internal/...`, `bun run lint` and `bun run typecheck` run after **each** — they
are fast. The expensive tier (§7.1(g)–(i)) runs once at C7, per `AGENTS.md`'s "implement the whole
plan first, then test once".

- **C1** `feat(gitclient): for-each-ref, status --porcelain=v2 and merge-tree parsing`
  — §3.1 + §3.2 + §3.3 and their fixtures, built with `fixtureEnv()`. Nothing imports them yet.
- **C2** `feat(gitpreflight): the checkout, revert and in-progress classifiers and the undo slot`
  — §3.4 in full, with D18's matrices. Pure; depends on C1 only for `StatusResult`.
- **C3** `feat(gitops): checkout, branch, tag and revert argv, the in-progress reader and the op error table`
  — §3.5 in full, with `errors_test.go`. Depends on C2 for `InProgressKind`/`InProgressStateFiles`.
- **C4** `feat(gitclient): export the head resolver a session can re-run`
  — §3.6. Three lines and a doc comment; kept its own commit because it is the one edit to a
  package four phases have already stabilised.
- **C5** `feat(gitsession): refs, status, pre-flight, the write executor and the per-repo undo slot`
  — §3.7 in full: the four new files, the three `RepoEntry` fields, the invalidation point,
  `runAllowingExit`, `Conn.ClientLabel`, and the two unit tests. Depends on C1–C4.
- **C6** `feat(git): serve refs.list, status.get, the two pre-flights, op.run and undo.*`
  — §3.8 + §3.9's one-line label threading. **No contract bump** (D1), stated in the commit body so
  the omission reads as a decision.
- **C7** `refactor(git-core): drop the checkout and revert pre-flight classifiers, now server-side`
  — §4.1, then §3.9's integration tests and the full §7.1 run.

Dependency order: C1 before C2 and C3; C2 before C3 and C5; C3, C4 before C5; C5 before C6; C6
before C7's integration tier.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 What is proven automatically, in this container

**(a) `go test ./apps/kira-studio/internal/gitclient/porcelain/...`** — the two ref framings, the
trailing-empty-field case, the lightweight-tag subject discard, the `2`-record two-chunk framing,
the unborn header, and the merge-tree block split, all against committed recordings of real git
output (§3.1–§3.3).

**(b) `GIT_CONFIG_GLOBAL=/dev/null KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the
tree clean** — G4 D15's machine-independence check, extended to this phase's new fixtures.

**(c) `go test ./apps/kira-studio/internal/gitpreflight/...`** — the checkout matrix (including the
blocker **order**), the revert matrix, and one named test per row of the in-progress precedence
table plus the two shadowing cases.

**(d) `go test ./apps/kira-studio/internal/gitops/...`** — D14's error table, one case per row from
verbatim probe stderr, plus the two ordering assertions.

**(e) `go test ./apps/kira-studio/internal/gitsession/...`** — the undo slot's lifecycle and the op
table's completeness (D6, the Go stand-in for upstream's mapped type).

**(f) `go test ./apps/kira-studio/internal/gitsock/`** — §3.9's eight integration tests over a real
socket against real repositories, **including a real `git worktree add`** (which works in this
container, so `checkedOutIn` and `worktreeConflict` are genuinely proven here, not deferred to
macOS). **This is the phase's real end-to-end proof on the Go side.**

**(g) `bun test packages/git-ipc/src` (inside `bun run test:unit`)** — unchanged by this phase and
therefore a regression check that D17's deletion did not disturb the contract or the codec.

**(h) `bun run lint` / `bun run typecheck` / `bun run build:vscode` — green.** `typecheck:git` is
what proves D17's two deletions broke nothing; `build:vscode` has been an exit criterion since
G3 D20.

**(i) `bun run test:e2e-real` — green**, adding no new spec: its `{kind:"gitUnavailable"}`
assertions still hold on Linux, and its continued passing proves the un-openable path is
undisturbed. `go test ./apps/kira-studio/internal/` — the layering test, with **nothing added to
`packagesExemptFromBridgeCheck`**: `gitpreflight` and `gitops` import only `gitclient`,
`gitclient/porcelain` and stdlib, so both sit cleanly under the line.

### 7.2 What genuinely cannot be proven here, and the macOS script for it

Three things are structurally out of reach in this container:

1. **A real VS Code extension host.** The branch picker, the tag list, every dialog, the conflict
   banner and the undo button are Vue components rendered by a webview that only exists inside VS
   Code. §7.1(f) proves every byte underneath them and nothing about them.
2. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin (G2 F18), so
   nothing in this container ever reaches the real `repo.open` path a human uses.
3. **Perf.** G3 D22's harness measures this container; G8 re-measures.

**The macOS script, run once on real hardware before G5 is called done:**

1. `go test ./apps/kira-studio/internal/...` on macOS — the same suite on the platform that ships.
2. `GIT_CONFIG_GLOBAL=/dev/null KIRA_GIT_FIXTURES=write go test ./…/porcelain/...`, then
   `git status` — **clean on a second machine**, which is the only real check of D19.
3. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository; pair.
4. **The branch picker populates** — local branches by committer date, remote branches, ahead/behind
   badges, the current branch marked. **The tag list populates** with `v10` sorted after `v9` (the
   version-aware sort git does and JS does not), annotated tags showing their tagger and subject and
   lightweight ones showing **no** annotation at all.
5. **Checkout, all five verdicts**: a clean switch; a `cleanCarry` switch announcing what carried;
   a `blockedByTracked` dialog offering **Discard** and Cancel (and *not* stash — G12's route, and
   `routes` must not contain it); a `blockedByUntracked` dialog offering **neither** (probe P7:
   `--discard-changes` cannot clear it); and a branch checked out in a `git worktree add`'d
   worktree refusing with the worktree's path named, not with "commit or stash your changes".
6. **Detached checkout of a tag and of a raw sha**, both announcing the detached HEAD; and a plain
   checkout of `origin/topic` with no local counterpart offering "create `topic` tracking
   `origin/topic`" as a labelled choice rather than doing it silently (`--no-guess`, upstream probe
   P7 — the most visible way to get D4 wrong).
7. **Branch create / rename / delete**, and **tag create (both kinds) / delete**. Force-moving an
   annotated tag must keep it annotated (probe P3).
8. **Undo**: delete a branch that tracks a remote, click Undo, then confirm `git config
   --get-regexp '^branch\.<name>\.'` in a terminal shows the tracking config back. Delete an
   annotated tag, Undo, and confirm `git cat-file -t refs/tags/<name>` still says `tag` with the
   original tagger date. Then perform any other operation and confirm the button disappears.
9. **The in-progress banner**, in four states produced from a terminal in the same repository: a
   conflicted merge (Continue offered, disabled until the last file is resolved, then enabled — the
   `.git/index` watch is what drives that), a conflicted cherry-pick, a conflicted revert started
   from the app itself, and a **rebase** (named, Abort offered, **Continue not offered** — SPEC's
   own v1 posture). In each, "Resolve in VS Code" opens the SCM view and the merge editor, which is
   G4's wiring becoming reachable for the first time (F3).
10. **The banner in a linked worktree** — `git worktree add`, open *that* directory as the repo, and
    start a conflicting revert there. The banner must appear (the state files live in
    `.git/worktrees/<name>/`, which G2's watcher already covers — this step is what proves it).
11. Confirm what is *expected to still be broken*, so it is not mistaken for a regression: the
    stash list is still empty and the webview console still carries an unhandled rejection for
    `stash.list` (G12); "Push tag" and "Delete on remote" fail with an error naming the operation
    (D5, G7); the review sidebar view is still unregistered (G6). The three rejections G3 D17
    listed for G5 — `refs.list`, `status.get`, `undo.peek` — are **gone**.
12. **Two windows, one repository**: check out a branch in window A and confirm window B's toolbar,
    branch picker and banner all reconcile without a reload; delete a tag in A and confirm B's undo
    button shows it with the `(window: …)` suffix while A's does not; close A mid-operation and
    confirm the operation still completes and B still sees its result (D8).

### 7.3 The checklist

- [ ] `CONTRACT_VERSION` is **still 14** on both sides; `packages/git-ipc` is byte-for-byte
      unchanged (D1).
- [ ] `packages/git-ui` and `apps/kira-studio-vscode` are byte-for-byte unchanged.
- [ ] `packages/git-core`'s only diff is D17's two deletions, two `index.ts` lines and two
      reworded comments.
- [ ] `go.mod` and `bun.lock` are unchanged; `gitwire.fbs` and `src/generated/` are unchanged.
- [ ] `gitpreflight` contains three classifiers, the status folds and the undo slot — and no
      stub for the six classifiers other phases own (D3).
- [ ] `gitops` contains no `fetch`/`push`/`pull`/`reset`/`cherryPick`/`stash` file and no progress
      parser (D4).
- [ ] `op.run` serves exactly ten kinds and refuses the other nine by name (D5).
- [ ] Every `switch` argv carries `--no-guess`; no argv repeats `--no-optional-locks`.
- [ ] `merge-tree` always carries `--merge-base=<sha>` for a revert prediction, and exit 1 is a
      prediction, not an error (D13/D15).
- [ ] `status` is spawned with `--untracked-files=normal`, never `all` (D11).
- [ ] The `dirtyPaths` display cap never reaches the intersection (D11).
- [ ] `checkedOutIn` is absent for the branch checked out in **our own** worktree (D10, probe P2).
- [ ] A lightweight tag carries no `annotation`, and the tags spawn's `%00`+`\n` framing round-trips
      an annotation body containing newlines (D10, probe P1/P3).
- [ ] The undo record is captured **before** the write, on both undoable kinds, and a branch undo
      replays the config as well as the ref.
- [ ] Undo labels are byte-identical to upstream's; the attribution is a **suffix** and appears only
      for a reader that is not the originating connection (D7/F9).
- [ ] Every op clears the slot; `take` twice returns `nil`; a stale recovery sha is refused.
- [ ] `RunOp` runs under a detached context, and the post-op read-back is inside it (D8).
- [ ] The refs cache is dropped, and the head marked stale, **before** the `repo.changed` fan-out.
- [ ] Pre-flight and the executor never read the refs cache (D10/F16).
- [ ] `gitclient.ErrorKind` gained no members (D14).
- [ ] No test, fixture or script runs `git config --global` or `--system` (D19).
- [ ] `packagesExemptFromBridgeCheck` is unchanged.
- [ ] §7.1(a)–(i) all green; §7.2's twelve macOS steps all pass.

---

## 8. Sequencing — one implementer

**Recommendation: one sequential Sonnet subagent for the whole phase.** G1–G4 all made the same
call, and G3 — comparable in size to this — carried it through successfully.

1. **The phase is one dependency chain.** Parsers → classifiers → argv builders → the executor →
   the handlers → the deletion. That is `AGENTS.md`'s textbook case of *not* "genuinely independent
   (unrelated adapters, non-overlapping fixes)".
2. **C5 is where every earlier commit meets.** `RunOp` needs `gitops`' argv, `gitpreflight`'s
   policy, `porcelain`'s parsers and `RepoEntry`'s new state at once; an agent that did not write
   C1–C4 would be landing it against this plan's prose rather than against a compiler.
3. **The one piece that looks separable is not worth separating.** C4 (`ResolveHead`) and C7
   (the `git-core` deletion) are each independent of the rest, but they are three lines and four
   file deletions respectively — the coordination would cost more than the concurrency saves. If
   the orchestrator does choose to parallelise anyway, **C7 alone** is the only defensible cut: it
   touches a package no other commit in this phase edits, and `bun run typecheck:git` is its whole
   proof.

---

## 9. Explicit non-goals for G5

| Not in G5 | Owner |
|---|---|
| `stash.list`, `stash.show`, `preflight.stashPop`, `preflight.stashBranch`, `gitops/stash.go`, `ClassifyStashPop`/`ClassifyStashBranch`, and flipping `stashAvailable` to `true` | G12 |
| `preflight.reset`, `preflight.cherryPick`, `gitops/{reset,cherryPick}.go`, `ClassifyReset`/`ClassifyCherryPick`, the `EmptyCherryPick`/`ConfirmationRequired` error rows, deleting `undo/slot.ts` | G13 |
| `remote.*`, `gitops/{fetch,push,pull}.go` + the stderr progress parser, the askpass broker, the credential relay, the protected-branch matcher, `op.run`'s `tagPush`/`tagDeleteRemote` | G7 |
| `review.open`, `review.resolveBase`, the ranged walk, the review view | G6 |
| `search.run` and the RE2-vs-`RegExp` reconciliation | G14 |
| Command-palette commands for any operation this phase introduces | G9 (SPEC's own G9 row: "a command-palette audit wiring a command for every mutating operation introduced across G5–G11") |
| PR badges on branch rows | G15 |
| `git worktree` create/list/switch/remove | G16 |
| Rebase — starting, continuing or skipping one | out of scope for v1.3 (SPEC's v1 posture: report and refuse to interfere) |
| Any conflict-resolution UI of our own: three-way view, accept-ours/theirs, marker editing | out of scope; the host's own SCM surface is the answer (G4 D11's `resolveConflict`) |
| Signed tags (`-s`) and tag signature verification | unassigned upstream, unassigned here |
| Any change to `packages/git-ui`, `packages/git-ipc` or `apps/kira-studio-vscode` | never, per SPEC §5 / D1 |

---

## 10. Handed forward

- **`stash.list` is the last of G3 F16's four rejections still open.** **G12**. After G5 the webview
  console carries exactly one unhandled rejection on repo open instead of four.
- **`op.run`'s nine unserved kinds** (D5). **G7** takes `tagPush`/`tagDeleteRemote` (and should
  revisit whether they belong in `op.run` at all once `remote.run` exists — upstream's own D51 put
  every other push behind `remote.run` precisely because a push is killable, streaming and
  progress-reporting); **G12** the five stash kinds; **G13** `reset` and `cherryPick`. Each is one
  entry in the same `opTable`.
- **Local operations are deliberately uncancellable and carry no deadline** (D8). SPEC §6 says so
  for the disconnect case; this plan extends it to `cancel` frames for the same reason (shared
  state). **G7** is where a real cancellation policy arrives, with `remote.cancel` and its own
  killable-phase table; if a local op is ever observed hanging on a foreign `index.lock`, that is
  the phase whose machinery to reuse rather than a timeout bolted on here.
- **The op table's completeness is guarded by a test, not a compiler** (D6/F8). Anything that
  later moves `OpRequest`'s decoding to codegen should take the opportunity to make it structural
  again.
- **`git-core`'s trim is two files short of SPEC §5's end state after G5** (D17). **G7** owns
  `preflight/{push,pull}.ts`, **G12** owns `preflight/stashPop.ts`, **G13** owns
  `preflight/{reset,cherryPick}.ts` and `undo/slot.ts` — and G13 additionally has to decide whether
  `classifyReset`'s live client-side caller (`state/ops.ts:490`'s no-round-trip mode preview)
  survives the move. `preflight/tag.ts` never goes: `validateRefName` lives in it (F10/F17).
- **The read pool is four, and `preflight.checkout` takes two of it while `preflight.revert` takes
  one per selected commit** (F18/D13). **G8**'s multi-client matrix is where a real answer to "is
  four the right number under two windows scrolling and reverting" comes from.
- **`InProgressOperation` is computed from files, `status.get` from a spawn, and the two are joined
  in one place** (`statusAndInProgress`). Every later phase that needs either must go through that
  join rather than adding a second `status` read — upstream's own reason, and the reason G5's
  pre-flights cost one spawn each rather than two.
- **The undo slot dies with the `RepoEntry`** (D7 bound 2), i.e. five minutes after the last
  connection releases the repository. Nothing persists it across an app restart, deliberately: a
  replayed `update-ref` against a repository the user has since rewritten is worse than no button.

---

## 11. Two calls worth a human eye before implementation starts

Both are judgment calls the orchestrator or the user may reasonably decide differently, and both
are cheap to change *now* and awkward to change after C5. Neither is a blocker: the plan takes a
position on each and can be implemented as written.

### 11.1 Should `tagPush` and `tagDeleteRemote` ship in G5 after all? (D5, F13)

**As planned**: no. They are pushes; SPEC's G7 row owns "Remote ops … askpass broker + credential
relay"; and a push that runs with `GIT_TERMINAL_PROMPT=0` and no broker fails immediately for
every user of an authenticated remote, with an error the UI has no remedy for. The menu entries
exist and answer with a clear "not served yet", exactly as `stash.list` has since G3.

**The alternative**: ship them, on the reading that SPEC's G5 row inherits *all* of upstream's P6
and that a public HTTPS remote or an `ssh-agent`-backed one works fine today. That is true for
some users and produces a confusing failure for the rest, and it puts the first push in this
chapter outside the phase that designs how a push reports progress, is cancelled, and asks for
credentials.

This is the one place this phase's coverage of upstream's P6 is deliberately incomplete, so it is
flagged rather than settled quietly.

### 11.2 Is the undo attribution right as a read-time suffix? (D7, F9)

**As planned**: the record stores the originating connection and its label; the snapshot appends
`" (window: <label>)"` only when the reader is a *different* connection. That is SPEC §6's stated
intent read literally ("*so a second window sees …*"), it keeps the single-window label
byte-identical to upstream's — which F9 shows `liveAnnouncements.ts` depends on twice — and it
appends rather than prepends, which is what makes it safe against both start-anchored detectors.

**The alternative**: bake the attribution into the stored label unconditionally, which is simpler
(no per-reader composition, no `ConnID` on the record) at the cost of a noisier button for the
overwhelmingly common single-window case, and of a label that no longer matches upstream's for the
two future phases that pattern-match it.

A third option — a dedicated `originatingClient` field on `UndoSlotSnapshot` — is **not** available:
that would be a wire-type change, and D1's whole point is that this phase changes none.
