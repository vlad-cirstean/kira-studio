# G26 — Stacked branches: the parent pointer, the restack executor, and stack navigation

> **What this phase is.** The twenty-sixth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the **third from-scratch design phase in a row** (G24 was the first, G25 the second). There is no upstream implementation, no upstream design, and no upstream plan: the upstream checkout at `/home/user/vlad-cirstean/kira-version-vscode` has no stacked-branch feature of any kind — its only `stack` matches are `git stash`'s own stack. This chapter's own SPEC row (`docs/v1.3/SPEC.md:339`) says so in as many words: *"No upstream design to port — added 2026-09-07, requested with no further detail yet, so **not designed at all** — full design … happens entirely at this phase's own Opus planning pass."* This plan is that design.
>
> **The three questions the SPEC row names, answered up front.**
> 1. **How the stack relationship is tracked** — in `.git/config`, as `branch.<name>.kirastackparent` / `branch.<name>.kirastackbase` (D1). Chosen over an app-side SQLite table and over merge-base inference for one decisive empirical reason each: `git branch -m` **moves the whole `branch.<name>.*` section** and `git branch -d` **deletes it** (probe P1/P2), so rename and delete come free and G5's existing `captureBranchDeleteUndo` — which already replays every `branch.<name>.*` line — restores stack membership on undo without one new line of code; the SQLite store is keyed on `RepoID`, which is a *worktree root*, so a stack defined in the main worktree would be invisible from a linked one, while `.git/config` lives in `commonDir` and is shared by every worktree of the repository; and merge-base inference is **provably wrong** the moment a parent is amended or rebased (probe P6 — it replays commits already present and conflicts).
> 2. **The restack algorithm and its conflict/undo story** — a sequential, top-down `git rebase --no-autostash --no-update-refs --onto <parentName> <recordedBase> <branch>` per stale branch, run by a dedicated `stack.restack` executor modelled *exactly* on `remote.run` (D6/D9). One `UndoRecord` for the whole restack, captured before anything moves, replayed as `switch` + `update-ref`s + one `reset --keep` (D11). A conflict pauses the restack at that branch, leaves git's own `rebase-merge` state, and surfaces through G5's **already-shipped** in-progress banner — which this phase makes actionable by flipping rebase's `CanContinue` from `false` to `true` (D12). **A partial restack is never half-undone; it is idempotently re-runnable**, because staleness is derived from git state and never from a stored plan (D8).
> 3. **How it renders against G6's branch review and G24's PR indicator** — a fifth `BranchPicker` section (`StackList.vue`) that reuses `PrState.byBranch` for the PR badge exactly as G24 §9 anticipated (*"G26 … will want a per-branch-in-stack view of `PrState.byBranch`. The snapshot is already exactly that shape."*), `RefRow.track` for "needs force-push", and `RefRow.checkedOutIn` for the worktree badge; plus a fourth `columns.ts` accessor context (`StackContext`) painting a stale-branch class in the graph, the same two-line pattern G24 F12 established. Branch review needs **no resolver change at all** (D15): the stack row's "Review" action passes the parent as `review.resolveBase`'s already-existing explicit `base` override.
>
> **`CONTRACT_VERSION` 28 → 29** (D17), claimed explicitly here so no later phase claims 29 blind.
>
> **This phase must design `git rebase` itself, not just stacking on top of it.** Confirmed by grep: the only rebase in the tree is `gitops.RebaseArgs(upstream)` (pull's integrate phase, `pull.go:20`) and `rebase --abort` in `AbortArgs`. There is no `--onto` builder, no rebase preflight, no rebase conflict path that offers Continue, and no `opTable` kind that rebases. G26 builds all four.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `4a3d09ac` (G1–G25 complete, working tree clean). Every claim below was checked against source read in this container, or produced by a read-only probe against real git 2.43.0 in a scratch fixture under `/tmp` — never inferred from SPEC prose.

| Claim | Evidence |
|---|---|
| No upstream stacked-branch feature exists | `grep -ri "stack" /home/user/vlad-cirstean/kira-version-vscode/{src,packages,docs}` → `git stash` stack only; SPEC `:339` ("No upstream design to port") |
| Nothing in this repo models a branch dependency | `grep -rn "stack\|parentBranch\|restack" internal/gitops internal/gitpreflight internal/gitsession` → nothing but `gitstore`'s unrelated "rebased to 0" pack comments |
| `git rebase` exists in this tree only as pull's integrate phase and an abort verb | `gitops/pull.go:17-21`; `gitops/conflict.go:81-82` |
| Rebase deliberately offers **no** Continue today | `gitpreflight/operation.go:33`, `:92-96` (`canContinue: false`, *"§9's report-only posture"*); `gitops.ContinueArgs` has no rebase arm; `operation_test.go:53` asserts it |
| `opTable` serves nineteen kinds; five are `Undoable` | `gitsession/ops.go:134-242`; `ops_test.go:22-23`, `:46`, `:70` |
| `remote.run` is the house template for a long, multi-phase, cancellable, progress-emitting op with a ≤1 per-repo slot | `gitsession/remote.go:18-78`, `:285-383`, `:482-556` |
| `runPullOp` already runs a **rebase under `Repo.Write`** and already combines stdout+stderr before classifying | `remote.go:530-551` (*"a rebase conflict's 'could not apply' is on stderr"*) |
| `porcelain.LeftRightCountArgs`/`ParseLeftRightCount` already exist (G22 D4) and answer exactly "behind/ahead" for a pair | `porcelain/reset.go:26`, `:33` |
| `gitops.IsAncestorArgs` already exists (G7 D13) | `gitops/remote.go:56` |
| `captureBranchDeleteUndo` already captures and replays **every `branch.<name>.*` config line** | `gitsession/ops.go:558-589` |
| `parsePullConfig` already parses `git config --null --get-regexp`'s `key\nvalue\0` framing | `gitsession/remote.go:614-639` |
| `GIT_EDITOR=true` is already in `hygieneEnv`, so `rebase --continue` can never hang on an editor | `gitclient/runner.go:113-115`, `:121-127` |
| The watcher's ref-ish basenames do **not** include `config` | `gitclient/watcher.go:28-39` |
| `MutatingAction` = `OpRequest['kind'] \| RemoteOpParams['kind'] \| 'undo' \| 'cancel'`, and `commands.test.ts` cross-checks it against Go's `opTable` **and** `RunRemote`'s switch | `apps/kira-studio-vscode/src/commands.ts:29`, `:1-17` |
| `OP_ERROR_TEXT` is a total `Record<OpErrorKind, string>` | `git-ui/src/state/liveAnnouncements.ts:135-165` |
| `CONTRACT_VERSION` is 28 (G25) | `packages/git-ipc/src/validate.ts:75` |
| Git floor is 2.38 | `gitclient/discovery.go:16-19` |

**Probes run in this container against real git 2.43.0, read-only against scratch fixtures in `/tmp` (never this repo):**

| # | Question | Observed |
|---|---|---|
| **P1** | Does `git branch -m old new` carry a *custom* `branch.old.*` key across? | **Yes.** `branch.feat2.kirastackparent` → `branch.feat2renamed.kirastackparent`, value intact. Git lowercases the variable name (`kiraStackParent` is stored and read back as `kirastackparent`); the subsection (the branch name) keeps its case. |
| **P2** | Does `git branch -D name` remove `branch.name.*`? | **Yes** — the whole section, custom keys included. |
| **P3** | `git config --local --null --get-regexp '^branch\..*\.kirastack'` framing | `key\nvalue\0` records — byte-identical to what `parsePullConfig` already parses. Exit **1** on no match, **0** on match. |
| **P4** | A branch name containing a dot (`feat.x`) | Round-trips fine: `branch.feat.x.kirastackparent`. Parse by stripping the known `branch.` prefix and `.kirastack<key>` suffix, never by splitting on `.`. |
| **P5** | `git config --local branch.x.k ""` | Writes an empty value, exit 0; `--get` returns exit 0 with an empty line; `--get-regexp` emits `key\n\0`. **`--unset` of a missing key exits 5** — which is why D2 uses `""` for "not stacked" rather than `--unset`. |
| **P6** | Restacking `C` onto a **rewritten** `B` using `merge-base(B,C)` as the old base | **Conflicts.** Git replays `B1`, already logically present in the new `B`. `EXIT=1`. This is the single finding that makes a *recorded* base mandatory rather than a nicety. |
| **P7** | Restacking `C` with the **recorded** old parent tip | `git rebase --onto B <oldBtip> C` → exit 0, replays only C's own commit, `Successfully rebased and updated refs/heads/C.` |
| **P8** | Where does `rebase` leave HEAD? | On the rebased branch — **always**, including the no-op case (`Current branch B is up to date.`, exit 0, HEAD still moved to `B`). A multi-branch restack must therefore restore HEAD itself. |
| **P9** | Conflicted rebase state | HEAD detached; `.git/rebase-merge/{head-name,onto,orig-head}` present (`head-name` = `refs/heads/C` — exactly what `ClassifyInProgress` already reads); `git status --porcelain=v2 --branch` shows `# branch.head (detached)` and the unmerged rows. `git rebase --abort` → exit 0, HEAD back on `C`. |
| **P10** | Conflict output streams | `CONFLICT (content): Merge conflict in f` on **stdout**; `error: could not apply <sha>… <subject>` and `Rebasing (n/m)` on **stderr**; exit **1**. `ClassifyOpError`'s existing `"could not apply"` row already names this `Conflict` — but only if stdout and stderr are combined, exactly as `runPullOp` already does. |
| **P11** | `git rebase --continue` after resolution | Does **not** open an editor (reuses the original message); continues to the next pick and can conflict again (exit 1, same shape). |
| **P12** | Dirty-tree refusal | `error: cannot rebase: You have unstaged changes.` / `error: cannot rebase: Your index contains uncommitted changes.` — stderr, exit **1**. Matched by **no** existing `ClassifyOpError` row → `Unknown` today. |
| **P13** | Branch checked out in another worktree | `fatal: 'C' is already used by worktree at '/tmp/…'`, exit 128 → existing `"used by worktree at"` row → `WorktreeConflict`. |
| **P14** | Non-existent branch | `fatal: no such branch/commit 'nosuch'`, exit 128. Matched by **no** existing row (`"no branch named"` is a different string) → `Unknown` today. |
| **P15** | Already-upstream commits | Silently dropped: `dropping <sha> <subject> -- patch contents already upstream`, exit 0, no stop. |
| **P16** | `git rebase --update-refs` (git ≥ 2.38, at the floor) | Restacks a whole *linear* stack in one command and reports `Updated the following refs with --update-refs:`. **But it also silently moved two branches the user never named** (`stray`, `sibling`, both pointing into the rebased range). Rejected — see D7. |
| **P17** | `--no-update-refs`/`--no-autostash` accepted at 2.43 | Yes (`git rebase -h` lists `--[no-]update-refs`, `--[no-]autostash`). Both added in the same releases as their positive forms, at or below the 2.38 floor. |
| **P18** | Mid-`--update-refs` conflict | `.git/rebase-merge/update-refs` records the pending moves; **no ref is moved until the rebase finishes**; `--abort` restores everything. Recorded for completeness; not used (D7). |

**Probes the implementer runs first, with the expected result stated so a mismatch is visible:**

| # | Command | Expected |
|---|---|---|
| M1 | `rebase --onto <parent> <base> <branch>` where `<branch>` has an upstream | Succeeds; `git status` afterwards reports the branch ahead of its upstream by its own commit count (D14's `needsForcePush`) |
| M2 | `rebase --onto` while `.git/rebase-merge` already exists | `fatal: It seems that there is already a rebase-merge directory…`, exit 128 ⇒ the D4 preflight's `inProgressOperation` blocker fires first, so this is never reached in practice |
| M3 | `rebase --onto` onto a ref that does not resolve | `fatal: invalid upstream '<x>'` or `fatal: no such branch/commit` ⇒ D5's new `NotFound` pattern |
| M4 | `config --local branch.<b>.kirastackparent <p>` inside a **linked worktree** | Lands in `commonDir/config`, visible from the main worktree — confirms D1's cross-worktree claim |
| M5 | `rebase --continue` with `GIT_SEQUENCE_EDITOR` unset in a repo with `sequence.editor` set to something interactive | Never invoked (no `-i`); if it is, D6's own `GIT_SEQUENCE_EDITOR=true` in `Spec.Env` neutralises it |

### 0.2 Scope

1. **`internal/gitops/stack.go`** (new) — the config key builders, the `--local --null --get-regexp` read argv, the config write argv, `MergeBaseArgs`, and `RebaseOntoArgs`.
2. **`internal/gitops/errors.go`** (edited) — two new rows (D5).
3. **`internal/gitops/conflict.go`** (edited) — rebase arms in `ContinueArgs` and `SkipArgs` (D12).
4. **`internal/gitpreflight/operation.go`** (edited) — rebase's `canContinue` `false` → `true`; `CanSkip` widened (D12).
5. **`internal/gitpreflight/stack.go`** (new) — the wire types, `ParseStackConfig`, `BuildStacks` (forest assembly + cycle detection + ordering), `ClassifyRestack`. Pure; no spawn, no filesystem.
6. **`internal/gitsession/stack.go`** (new) — the stack cache, `Stacks`, `RestackPreflight`, `restackSlot`, `RunRestack`, `CancelRestack`, `prepareStackSet`, `captureStackSetUndo`, the branchRename/branchDelete fix-ups.
7. **`internal/gitsession/ops.go`** (edited) — one new `opTable` entry (`stackSet`, `Undoable`); `OpRequest` gains `Parent *string`; `prepareBranchRename`/`prepareBranchDelete` gain stack fix-ups; `captureBranchDeleteUndo` widened.
8. **`internal/gitsession/entry.go`** (edited) — the stack cache slot, the restack slot, the two drops, teardown's force-cancel.
9. **`internal/gitrpc`** — four new handlers, their params, `ContractVersion` 28 → **29**.
10. **`internal/gitclient/watcher.go`** (edited) — `"config"` joins `refIshNames` (D16).
11. **`packages/git-ipc`** — eight new types, four requests, one event, one `OpRequest` kind, one `OpErrorKind`, three `UiActionKind` members; `CONTRACT_VERSION = 29`.
12. **`packages/git-ui`** — `state/stack.ts`, `components/stackListModel.ts`, `StackList.vue`, `dialogs/StackDialog.vue`, the graph stale class, the toolbar strip, `ops.ts`, `rowMenuModel.ts`, `liveAnnouncements.ts`, `App.vue`, theme tokens.
13. **`apps/kira-studio-vscode`** — `MutatingAction` gains `'restack'`; one new `MUTATING_COMMANDS` entry (`stackSet`) plus a `restack` entry; two `OTHER_COMMANDS` navigation entries; `commands.test.ts` learns a third Go source.

### 0.3 Not in this phase

See §8 for the full argued list. The headline exclusions: **no automatic PR re-basing on GitHub** (setting a PR's `base` is a `PATCH`, and G24 §0.3 forbids every GitHub write by name); **no cross-clone/cross-machine stack sharing** (D1 stores per-clone, deliberately); **no `--update-refs`** (P16's stray-ref hazard, D7); **no interactive rebase**; **no auto-force-push after a restack**; **no auto-restack on pull/fetch**; **no stack creation of the branches themselves** (a stack is assembled from branches that already exist, or from `branchCreate` with a parent).

### 0.4 Ground rules

- **Design decisions are decisions**, not defaults — there is no upstream to defer to, and every alternative considered is named with the reason it lost.
- **Staleness is always derived from git, never from stored plan state.** This one rule is what makes a partial restack safe (§D8): losing the plan, restarting the app, or resolving a conflict by hand in a terminal all leave a state the next `stack.list` reads correctly.
- **Nothing this phase adds may ever rewrite a branch the user did not name.** P16 is the concrete hazard; D7 is the concrete refusal.
- **Every git failure is classified from stderr text, never from an exit code** — `ClassifyOpError`'s existing rule, extended by two rows and no exceptions (D5).
- `AGENTS.md` in full: no stubbed error handling, no skipped validation, named constants, table tests.

---

## 1. Findings

### F1 — There is no rebase machinery to build on; this phase builds it

`gitops` has `RebaseArgs(upstream)` for pull's integrate phase, and `rebase --abort` in `AbortArgs`, and nothing else. There is no `--onto` builder, no rebase preflight, no `opTable` kind that rebases, and rebase is the one in-progress kind G5 deliberately gave `canContinue: false`. So "restacking" is not a thin layer over an existing verb — the rebase verb, its preflight, its error rows, and its continue path are all this phase's own work. The *shape* to copy is `runPullOp` (`remote.go:482-556`), which already runs a rebase under `Repo.Write` with `Setsid`, already combines stdout+stderr before classifying, and already documents why.

### F2 — `.git/config`'s `branch.<name>.*` section is a rename- and delete-aware key-value store this app already reads and writes

Three independent facts converge:

- **P1**: `git branch -m` moves the whole section, custom keys included.
- **P2**: `git branch -d/-D` deletes it.
- `captureBranchDeleteUndo` (`ops.go:558-589`) *already* captures every `branch.<name>.*` line via `BranchConfigRegexpArgs` and replays each as a `git config` argv on undo.

Together these mean the parent pointer survives rename, is cleaned up on delete, and is **restored by the existing branch-delete undo with zero new code**. No other storage option in this codebase has any of those three properties.

### F3 — The app's own per-repo SQLite store is keyed on a worktree root, which is the wrong scope for a stack

`git_repo_settings` is `(repo_id, key)` and `RepoID` is the *worktree* root (`gitclient/repo.go`, and G25 F6 states it plainly: *"Each worktree is already its own `RepoEntry`"*). A stack defined while working in the main worktree would be invisible from a linked worktree of the same repository — and G25 just shipped worktree creation, so multi-worktree use is now a first-class workflow. `.git/config` lives in `commonDir` and is shared by every worktree (probe M4 confirms).

### F4 — Merge-base inference is not a fallback, it is a wrong answer in the exact case the feature exists for

P6 is the whole argument: after `A` is amended (the canonical "address review feedback on the bottom PR" move), `merge-base(A, B)` is no longer `B`'s base — it walks back past `A`'s own commits — and restacking `B` with it replays commits already logically in `A`, producing a conflict on the first pick. A recorded base is therefore load-bearing, not an optimisation. Merge-base remains the **honest fallback** when no base is recorded (a branch that joined a stack before this phase, or whose recorded base has been gc'd), and the preflight says so per branch rather than silently guessing (`baseSource: 'recorded' | 'mergeBase'`).

### F5 — `rebase` always moves HEAD, including on a no-op

P8. `git rebase --onto A A B` prints `Current branch B is up to date.`, exits 0, **and leaves HEAD on `B`**. A three-branch restack therefore moves HEAD three times and ends on the top branch. Restoring HEAD is the restack's own job, and it must be the *last* step, skipped entirely when a rebase failed (HEAD is mid-rebase and must not be moved).

### F6 — `rebase --update-refs` would restack a linear stack in one command, and silently rewrite branches nobody named

P16. In a fixture with `stray` and `sibling` both pointing at `B`'s tip, `git rebase --onto main <old> C --update-refs` reported four updated refs, two of which were not stack members. That is git's documented behaviour and arguably desirable at a terminal; in a "Restack this stack" button it is a silent rewrite of a branch that may have its own open PR. It also only works for a strictly linear stack, and it collapses per-branch progress and per-branch base bookkeeping into one opaque command. D7 rejects it and, crucially, passes `--no-update-refs` **explicitly**, because a user with `rebase.updateRefs = true` in their global config would otherwise get P16's behaviour from our per-branch rebases too.

### F7 — Because `--onto` resolves its arguments at spawn time, a whole restack's argv list *could* be built up front — but the base bookkeeping cannot

`rebase --onto <parentBranchName> <base> <child>` resolves `<parentBranchName>` when it runs, i.e. *after* the parent's own rebase. And every `<base>` is computed from the pre-restack snapshot, which is exactly the correct value. So the rebases themselves fit `opTable`'s `prepared.argvList` shape perfectly. What does **not** fit is recording each child's new base: that value is the parent's tip *after* its rebase, which no literal argv can name. This is the single reason `stack.restack` is its own executor (D6) rather than an `opTable` kind — stated here rather than left as an unexplained architectural choice.

### F8 — A restack is naturally idempotent, which removes the need for any persisted "restack session"

Because `stack.list` computes staleness from `rev-list --left-right <parentTip>...<childTip>` and nothing else, a restack that stopped halfway leaves a state the next read describes correctly: the branches that moved are up to date, the rest are still stale. Re-running Restack finishes the job. So there is no need to persist a plan across a conflict pause, an app restart, or a `RepoEntry` eviction — and no risk of a persisted plan going stale against a repository the user edited by hand. This is the finding that makes the conflict story small.

### F9 — G5's in-progress banner already renders a paused rebase; only `Continue` is missing

`ClassifyInProgress` reads `rebase-merge`/`rebase-apply` and `head-name`/`onto` (P9 confirms all three exist during a conflicted restack), `DescribeInProgress` already produces `Rebasing <branch>`, and `ConflictBanner.vue` already renders it with Abort. The single gap is `canContinue: false`, set deliberately at G5 for *"§9's report-only posture"* — a posture adopted when nothing in the app could *start* a rebase. G26 is the phase that starts one, so the posture no longer holds (D12).

### F10 — Two error strings a restack produces are currently classified `Unknown`

P12 (`cannot rebase: You have unstaged changes.` / `Your index contains uncommitted changes.`) and P14 (`no such branch/commit`) match no row in `ClassifyOpError`'s table. Both need rows; both map onto **existing** kinds (`DirtyWorktree`, `NotFound`), so neither costs an `OpErrorKind` (D5).

### F11 — `MutatingAction`'s totality does not cover a non-`opTable`, non-`RunRemote` executor

`MutatingAction = OpRequest['kind'] | RemoteOpParams['kind'] | 'undo' | 'cancel'`, and `commands.test.ts` cross-checks both directions against `gitsession/ops.go`'s `opTable` and `gitsession/remote.go`'s `RunRemote` switch. A third executor (`RunRestack`) is invisible to both halves: it would ship with no palette command and no test would notice. D13 widens the union by exactly one member (`'restack'`) and extends `commands.test.ts` with a third Go source — a deliberate, visible act, not a silent gap.

### F12 — `columns.ts`'s accessor-context pattern is now on its third instance and this is the fourth

`MessageSearchContext` (G3), `LaneColorContext` (G3), `PrContext` (G24 F12/D9) — each is a one-accessor interface read on every render pass, paired with a generation counter `CommitGrid.vue` watches. `StackContext` is a pattern match, not a new mechanism.

### F13 — `PrState.byBranch` is exactly the shape the stack rows need, and G24 said so

`pr.ts:39` — `byBranch: ShallowRef<ReadonlyMap<string, PrRecord>>`, warmed by `ensureSnapshot(branchNames)`. G24 §9's hand-forward names this phase. `StackList.vue` calls `ensureSnapshot` with the stack's branch names once per load and renders `buildPrBadge`/`pickBestPr` per row — no new RPC, no new cache, no new rate-limit exposure beyond the snapshot G24 already fetches lazily.

### F14 — `RefRow` already carries everything a stack row needs besides the parent link

`track` (`{ahead, behind}` vs upstream → "needs force-push after restack"), `checkedOutIn` (the worktree badge and the restack blocker), `isHead`, `objectId` (the tip). `stack.list` therefore joins the parsed config against the refs snapshot the entry already caches, and adds exactly one spawn per stacked branch.

### F15 — `git config --unset` exits 5 on a missing key, which makes an unset unreplayable through `runWriteArgv`

P5. `runWriteArgv` treats any non-zero exit as a classified `OpError`, so an undo replay that unsets an already-absent key would report a spurious failure. D2 therefore represents "not stacked" as an **empty string value**, never an absent key: every write and every undo replay is then a single always-succeeding `git config` argv, and the read side treats empty-or-whitespace as absent.

### F16 — Three totality guards will fail to compile or fail their test the moment this phase lands, by design

`MUTATING_COMMANDS` (a missing `stackSet` key is a `tsc` error), `OP_ERROR_TEXT` (a missing `StackCycle` phrase is a `tsc` error), and `commands.test.ts`'s Go cross-check (a served kind with no command fails). Plus `ops_test.go`'s three hard-coded counts. These are the safety net, not obstacles to route around.

---

## 2. Decisions

### The model

### D1 — The stack relationship lives in `.git/config`, as two keys per branch

```
branch.<name>.kirastackparent = <short branch name, or "" for "not stacked">
branch.<name>.kirastackbase   = <40-hex sha, or "" for "not recorded">
```

Read with one spawn: `git config --local --null --get-regexp '^branch\..*\.kirastack'` (P3 framing, exit 1 on no match, `--local` so a global config can never inject a stack relationship). Written with `git config --local <key> <value>`.

**Why this and not the alternatives, in full:**

| Option | Survives `branch -m`? | Survives `branch -d`? | Visible from a linked worktree? | Survives a hand-edit by plain git? | Correct after an external amend/rebase? |
|---|---|---|---|---|---|
| **`.git/config` (chosen)** | **Yes, free (P1)** | **Yes, free (P2)** — and restored by the existing delete-undo | **Yes** — `commonDir/config` (F3, M4) | Yes — it *is* plain git; a user can read and edit it | **Yes** — the recorded base is what makes P6's case correct |
| App SQLite (`git_repo_settings`) | No — needs its own hook | No — needs its own hook | **No** (F3) — keyed on the worktree root | No — invisible to the user | Yes |
| A ref namespace (`refs/kira/stack/…`) | No | No | Yes | Partly | Yes |
| Merge-base inference, no storage | n/a | n/a | Yes | Yes | **No (P6/F4)** — the feature's central case is wrong |

**The value is a short branch name, not a refname** — because every consumer uses the short name (`rebase --onto A`, the UI label, the rename fix-up), and it keeps `.git/config` human-editable. Git lowercases the variable name on write (P1), so the canonical spelling everywhere in this codebase is all-lowercase `kirastackparent` / `kirastackbase`; the parser is case-insensitive regardless.

**The parent may name a local branch *or* a remote-tracking branch.** A local-branch parent that is itself in the table makes this branch a stack member; anything else (`origin/main`, `main` with no stack keys of its own) is the stack's **base** and is never restacked. This is what lets a stack sit on `origin/main` without inventing a "trunk" setting.

**Honest limitation, stated rather than hidden:** `.git/config` is per-clone. A stack does not follow a `git clone`, does not reach a second machine, and is not shared with a collaborator. That is the correct scope — a stack is a statement about *local branches you are rewriting* — and §8 records it as an explicit non-goal rather than a gap.

### D2 — "Not stacked" is the empty string, never an absent key

F15. `stackSet` with no parent writes `""` to both keys rather than `--unset`-ing them, so every write and every undo replay is one always-succeeding `git config` argv. `ParseStackConfig` treats an empty or all-whitespace value as absent. The cost is a residual `kirastackparent =` line in `.git/config` for a branch that left its stack; the benefit is that `stackSet` and its undo are symmetric, total, and free of exit-code special cases.

### D3 — `stack.list`: the forest, flattened, with one spawn per stacked branch

```ts
export type StackBranchState = 'upToDate' | 'needsRestack' | 'parentMissing';

export interface StackBranch {
  readonly name: string;
  /** The recorded parent — a local branch in this same stack, or the stack's base. */
  readonly parent: string;
  /** 0 for a branch sitting directly on the stack's base. */
  readonly depth: number;
  readonly tip: string;
  readonly parentTip: string | undefined;   // undefined ⇒ parentMissing
  /** `branch.<name>.kirastackbase`, when set AND still resolvable. */
  readonly recordedBase: string | undefined;
  /** Commits on the parent this branch does not have — > 0 ⇒ needsRestack (D4). */
  readonly behind: number;
  /** This branch's own commits since the merge base. */
  readonly ahead: number;
  readonly state: StackBranchState;
  /** Reused verbatim from `RefRow` (F14). */
  readonly checkedOutIn: string | undefined;
  readonly track: RefTrack | 'gone' | undefined;
  readonly isHead: boolean;
}

export interface StackSummary {
  /** The base every root in this stack sits on — a branch name that is not itself stacked. */
  readonly base: string;
  readonly baseTip: string | undefined;
  /** Pre-order, bottom-to-top; `depth` carries the tree shape without a recursive wire type. */
  readonly branches: readonly StackBranch[];
  readonly needsRestack: boolean;
}

export interface StackListResult {
  readonly stacks: readonly StackSummary[];
  /** Branches whose recorded parent no longer exists, or that sit in a cycle — never silently
   *  dropped, always surfaced with a remedy. */
  readonly orphans: readonly StackBranch[];
}
```

**Flat-with-`depth`, not recursive**: the UI renders an indented list, the Go type marshals without recursion, and the ordering is fixed by the server rather than re-derived per client. A stack is a *forest* in the model (a parent may have two children) even though SPEC's own wording is "a sequence" — because parent pointers naturally admit it, refusing it would need extra machinery, and pre-order flattening renders both shapes identically.

**Cost.** One `git config --local --null --get-regexp` (always). Then, only if that returned anything: the refs snapshot (already cached) plus **one `rev-list --count --left-right <parentTip>...<childTip>` per stacked branch** — `porcelain.LeftRightCountArgs`/`ParseLeftRightCount`, reused verbatim from G22 D4, which yield `behind` and `ahead` in a single spawn each. `behind > 0` **is** "needs restack", so no separate `merge-base --is-ancestor` is spawned. A repository with no stacked branches costs exactly one config read and nothing else. Result cached per `RepoEntry`, dropped on `refsChanged` and by `invalidateAfterWrite` (D16). `maxStackedBranches = 64`; beyond it the rows are returned with `behind`/`ahead` zero and `state: 'parentMissing'` suppressed in favour of a single truncation note, rather than issuing an unbounded number of spawns.

### D4 — Staleness is `behind > 0`, and nothing else

`LeftRightCountArgs(parentTip, childTip)` → *left* = commits reachable from the parent but not the child, *right* = the reverse (`porcelain/reset.go:33`'s own doc comment). `left > 0` means the parent has moved on — whether by new commits (fast-forward) or by a rewrite (amend/rebase) — and either way the child must be restacked. `left == 0` means the parent's tip is already an ancestor of the child: up to date. This is one predicate, computed from git alone, with no reference to any stored plan (F8).

### The restack

### D5 — Two new `ClassifyOpError` rows, zero new `OpErrorKind` from rebase

| Pattern (lowercased `strings.Contains`) | Kind | Probe |
|---|---|---|
| `"cannot rebase: you have unstaged changes"` **or** `"cannot rebase: your index contains uncommitted changes"` | `DirtyWorktree` (**reused**) | P12 |
| `"no such branch/commit"` | `NotFound` (**reused**) — added as its own row rather than widening the existing `NotFound` row's pattern list, so the probe citation sits next to the string it came from | P14 |

Both rows are placed beside the existing `DirtyWorktree`/`NotFound` rows, preserving the table's "more specific first" ordering rule. `"could not apply"` (`Conflict`) and `"used by worktree at"` (`WorktreeConflict`) already exist and already fire for rebase (P10/P13) — **provided stdout and stderr are combined before classifying**, which D6's executor does exactly as `runPullOp` already does (`remote.go:546`).

The phase's **one** new `OpErrorKind` is `StackCycle`, produced only by `stackSet` (D10) — never by a rebase.

### D6 — `stack.restack` is its own executor, modelled on `remote.run`, not an `opTable` kind

F7 is the reason: the per-branch base bookkeeping needs a value that only exists after the previous rebase ran, which `prepared.argvList` cannot express. The alternatives were (a) widening `opSpec` with a post-write `Finalize` hook, and (b) not recording bases at all — (a) puts a best-effort, silently-failing write in the middle of `RunOp`'s otherwise total machinery, and (b) is F4/P6's wrong answer. So a dedicated executor, structurally identical to `RunRemote`:

```go
// restackSlot is the ≤1-per-repository box, the same shape prepareOpSlot uses (G25 D13):
// a restack is always cancellable BETWEEN branches, never during a rebase spawn (D9).
type restackSlot struct { mu sync.Mutex; active bool; cancel context.CancelFunc }

func (e *RepoEntry) RunRestack(ctx context.Context, conn *Conn, branch string) (RestackResult, error)
func (e *RepoEntry) CancelRestack() bool
```

`RunRestack`'s order, stated exactly:

0. `ctx` is already detached from the request by `gitrpc` (G5 D8's rule, the same one `remote.run` follows); wrapped here in the entry's own `WithCancel`.
1. **Claim the slot**; already claimed ⇒ `{ok:false, OperationInProgress}` with no write.
2. **Recompute the preflight fresh** (D14) — never trusting the client's copy, exactly as `prepareReset` re-runs its own gate. Any blocker ⇒ `{ok:false, <that blocker's error>}` with no write. This covers in-progress, dirty, worktree conflict, missing parent, and cycle.
3. **Capture the undo record** (D11) — before anything moves — and `defer e.invalidateAfterWrite()`.
4. For each planned branch, in order (bottom-up), emitting `stack.progress` before each:
   - `Repo.Write` → `gitclient.Run` with `Args: gitops.RebaseOntoArgs(parent, base, branch)`, `ReadOnly: false`, `Setsid: true` (G8 D6's reason: a rebase can invoke a gpg pinentry or a merge driver), and `Env: []string{"GIT_SEQUENCE_EDITOR=true"}` (belt-and-braces; `GIT_EDITOR=true` is already in `hygieneEnv`).
   - Non-zero exit ⇒ classify `stdout + "\n" + stderr` through `gitops.ClassifyOpError`, **stop the loop**, record `stoppedAt` and `remaining`.
   - Zero exit ⇒ read the parent's new tip (`rev-parse --verify refs/heads/<parent>`, or the base ref for a root) and write `git config --local branch.<branch>.kirastackbase <newParentTip>`. A failure here is a real error, not best-effort: the whole point of the executor is that this write is exact.
5. **Restore HEAD** — only when no rebase failed (F5): `switch <origBranch>` or `switch --detach <origSha>` (`gitops.SwitchArgs`/`SwitchDetachArgs`, `discard: false`).
6. Set the undo slot **only on a fully successful restack** (D8); read back `head` + `inProgress` **always**, success or failure, exactly as `RunOp` and `RunRemote` both do.
7. Release the slot (deferred) and return.

```go
// RebaseOntoArgs is the phase's one rebase verb. --no-autostash and --no-update-refs are passed
// EXPLICITLY, never left to config: rebase.autoStash would silently stash a tree the preflight
// just declared clean, and rebase.updateRefs would silently rewrite branches nobody named (P16).
func RebaseOntoArgs(onto, upstream, branch string) []string {
    return []string{"rebase", "--no-autostash", "--no-update-refs", "--onto", onto, upstream, branch}
}
```

`onto` is the **parent's name**, not a sha (F7): it resolves at spawn time, after the parent's own rebase, so the plan is correct even though it was computed before anything moved. `upstream` is the **recorded base sha** (or the merge-base fallback), computed from the pre-restack snapshot, which is exactly the right value.

### D7 — `--update-refs` is rejected, and `--no-update-refs` is passed explicitly

P16: it moved `stray` and `sibling`, two branches the user never named, because they happened to point into the rebased range. Three reasons to decline it and one to actively defend against it:

1. **It rewrites unnamed branches.** In a "Restack" button that is a silent rewrite of a branch that may carry its own open PR.
2. **It only handles a strictly linear stack.** D3's model is a forest.
3. **It collapses per-branch progress and per-branch base bookkeeping** into one opaque command, which is exactly what D6 exists to keep exact.
4. **A user's global `rebase.updateRefs = true` would give our per-branch rebases the same behaviour**, so `--no-update-refs` is not merely "not opting in" — it is a required defence.

What is lost: a single `rebase --continue` would have finished a whole conflicted stack, where per-branch rebases need the user to press Restack again after resolving. D8 argues that is an acceptable, even preferable, trade.

### D8 — The conflict story: pause, surface, re-run. A partial restack is never half-undone

When branch *k*'s rebase conflicts:

- Git leaves `.git/rebase-merge` with `head-name = refs/heads/<k>`, `onto`, `orig-head`, HEAD detached, unmerged paths in the index (P9).
- `RunRestack` stops immediately, does **not** restore HEAD (F5 — moving HEAD mid-rebase is not a thing), does **not** set the undo slot, and returns `{ok:false, error:{kind:'Conflict'}, restacked:[…branches before k], stoppedAt:k, remaining:[…], head, inProgress}`.
- `inProgress` is G5's own `{kind:'rebase', headName:'refs/heads/<k>', conflictedPaths:[…]}` — **`ConflictBanner.vue` already renders it**, saying `Rebasing <k>`, with Abort. D12 adds Continue and Skip.
- The client additionally shows, in `StackList.vue`, a one-line strip: *"Restack paused on `<k>` — resolve the conflict, then Continue, then Restack again to finish the remaining N."*

Resolution paths, all of them already existing machinery:

| The user does | What happens |
|---|---|
| Resolves + **Continue** (`opContinue`, now enabled for rebase, D12) | `git rebase --continue` finishes *branch k's* rebase; k is now restacked; branches after k are still stale. Pressing **Restack** again restacks exactly those (F8). |
| **Skip** (`opSkip`, D12) | The offending commit is dropped from k; the rebase proceeds. Same follow-up. |
| **Abort** (`opAbort`, already offered) | k returns to its pre-rebase tip. Branches *before* k stay restacked — which is correct, not a half-state: they are genuinely, correctly rebased onto their parents. `stack.list` shows k and everything above it as `needsRestack`. |

**"Is a multi-branch restack a single undoable unit, or per-branch?"** — **A single unit, and only when it fully succeeds.** A partial restack sets no undo record, deliberately: replaying `update-ref`s while `.git/rebase-merge` exists would leave the sequencer pointing at commits the refs no longer name. The recovery for a partial restack is git's own abort/continue plus a re-run, and the plan says so to the user in those words rather than offering an undo button that cannot honestly deliver.

**Why no persisted restack session.** F8: nothing needs to survive the pause, because the next `stack.list` re-derives the truth from refs. This is the single biggest simplification in the phase, and it is bought entirely by D4's rule that staleness never consults stored state.

### D9 — Cancellation is between branches, never during a rebase

`restackSlot.tryCancel()` cancels `opCtx`. The per-branch `Repo.Write` spawn takes `opCtx`, so a cancel *during* a rebase kills the git process — which, for a rebase, leaves `.git/rebase-merge` behind exactly as a conflict would, and is therefore recoverable through the same banner. But the loop's between-branch check is the intended cancellation point, and `RunRestack` checks `opCtx.Err()` before each branch and returns `{ok:false, error:{kind:'Cancelled'}}` with the branches done so far reported. This mirrors `remote.go`'s `killable` distinction (`setKillable`), simplified: there is no phase of a restack whose outcome is unknowable the way a half-delivered push is, so a restack is **always** cancellable and needs no `killable` flag — the same simplification G25's `prepareOpSlot` made for the same reason.

### D10 — `stackSet` is an ordinary `opTable` kind, undoable, with server-side cycle detection

```ts
| { readonly kind: 'stackSet';
    readonly branch: string;
    /** `undefined` ⇒ remove `branch` from its stack (D2 writes `""`). */
    readonly parent: string | undefined; }
```

`prepareStackSet`, in order:

1. Read the fresh refs snapshot and the fresh stack config (never the caches — the same rule `prepareCheckout` follows via `refsSnapshot`).
2. `branch` must be an existing **local** branch ⇒ else `NotFound`.
3. `parent`, when set, must resolve as a local branch or a remote-tracking branch ⇒ else `NotFound`; must not equal `branch` ⇒ `StackCycle`.
4. **Cycle check**: walk parent pointers up from `parent`; reaching `branch` ⇒ `StackCycle` naming the cycle. Bounded by `maxStackedBranches` iterations so a pre-existing cycle in a hand-edited config cannot spin.
5. Compute the new base: `git merge-base <parent> <branch>` (`gitops.MergeBaseArgs`, new, `runAllowingExit(0,1)`) — correct at join time by construction. Unresolvable ⇒ `""`.
6. Capture the undo (the branch's current parent/base values, D11).
7. `argvList` = two `git config --local` writes, always exactly two, always exit 0 (D2).

`Undo: Undoable`. Label: `Set <branch>'s stack parent to <parent>` / `Removed <branch> from its stack`. `RecoverySha` = the branch's own tip (so `UndoRun`'s existing `cat-file` existence check has something real to validate). `Replay` = the two `git config --local` writes with the *old* values. This makes `opTable` twenty entries, six of them `Undoable`.

### D11 — The restack's undo record, exactly

Captured in step 3 of D6, before any write:

- `origHead` — `HeadState` (branch name, or detached sha) and `origHeadSha`.
- For every branch in the plan: its `oldTip` and its `oldBase` (the raw config value, possibly `""`).

```
Label:       "Restacked <N> branches onto <base>"        (N ≥ 1; never matches
                                                          RESET_UNDO_LABEL_PATTERN or
                                                          STASH_DROP_UNDO_LABEL_PREFIX)
RecoverySha: origHeadSha
Replay (in order):
  1. ["switch", <origBranch>]                     — only when origHead was a branch IN the plan
  2. ["update-ref", "refs/heads/<b>", <oldTip>]   — for every planned b EXCEPT that one
  3. ["config", "--local", "branch.<b>.kirastackbase", <oldBase>]  — for every planned b
  4. ["reset", "--keep", <oldTip of origBranch>]  — only when origHead was a branch IN the plan
```

**Why `switch` first and `reset --keep` last.** `update-ref` on the *checked-out* branch moves the ref out from under the index and worktree, leaving every file in the restacked commits reported as staged — so the checked-out branch is restored with `reset --keep` instead, which moves the ref *and* the worktree, and **refuses (exit 128, changing nothing) rather than destroy** unrelated local modifications. That is G22 D9's exact argument for cherry-pick's undo, reused. The leading `switch` closes the one race G22's reset undo leaves open: if the user switched branches between the restack and the undo, `reset --keep` would otherwise reset the wrong branch. A `switch` that fails on a dirty tree fails the undo cleanly, corrupting nothing.

Undo is honest here because the pre-restack commits still exist — orphaned, but present in the object database and reachable through each branch's reflog (P7 shows `rebase (finish)` reflog entries on both sides) — and `UndoRun` already refuses a `RecoverySha` that no longer resolves.

### D12 — Rebase gains Continue and Skip; G5's "report-only posture" is retired with its reason

`gitpreflight/operation.go` today: rebase is classified with `canContinue: false`, doc-commented *"false for rebase (§9's report-only posture)"*, and `operation_test.go:53` asserts it. That posture was correct when nothing in the app could start a rebase; D6 makes the app start one, and a paused restack with no Continue is a dead end. So:

- `ClassifyInProgress`'s rebase arm: `canContinue: true`.
- `operationOf`'s `CanSkip`: `kind == InProgressCherryPick || kind == InProgressRevert || kind == InProgressRebase` — git prints `You can instead skip this commit: run "git rebase --skip"` in its own hint (P10), and an already-applied commit inside a stack is exactly when it is wanted (P15's automatic drop covers only the patch-identical case).
- `gitops.ContinueArgs` gains `case InProgressRebase: return []string{"rebase", "--continue"}, true`.
- `gitops.SkipArgs` gains `case InProgressRebase: return []string{"rebase", "--skip"}, true`.
- `operation_test.go`'s two rebase assertions are **inverted, not deleted**, with the G26 reason stated in the test name.

No editor hazard: `GIT_EDITOR=true` is already in `hygieneEnv` (`runner.go:113-115`), and P11 confirms `rebase --continue` does not open one anyway.

**This is a behaviour change to a shipped surface** (`ConflictBanner.vue` will now show Continue and Skip for a rebase started *outside* the app too, e.g. a `git pull --rebase` conflict from G7). That is a strict improvement — those buttons run git's own documented remedies — but it is called out here rather than slipped in, and §10.4 hands it to a human.

### D13 — `MutatingAction` gains `'restack'`; `commands.test.ts` learns a third Go source

F11. Concretely:

```ts
export type MutatingAction =
  | OpRequest['kind'] | RemoteOpParams['kind'] | 'undo' | 'cancel'
  /** G26: `stack.restack` is served by its own executor (`gitsession/stack.go`'s RunRestack),
   *  not by `opTable` and not by `RunRemote` — the first mutating operation in this chapter that
   *  is neither, so the union names it explicitly rather than leaving it invisible to the audit. */
  | 'restack';
```

`MUTATING_COMMANDS` gains two entries: `stackSet` (forced by `OpRequest['kind']`'s totality) and `restack`. `commands.test.ts`'s `extractOpTableKinds` is joined by an `extractsRestackExecutor` assertion — a grep for `func (e *RepoEntry) RunRestack(` in `gitsession/stack.go` — so `'restack'` is proven served, both directions, the same way the other two sources are. `stack.cancelRestack` gets **no** palette command, matching `worktree.cancelPrepare`'s precedent (G25) — cancel is a button on the surface that started the work.

### The pre-flight

### D14 — `RestackPreflight`: six blockers in one order, a plan, and a stash route

```ts
export type RestackBlocker =
  | { readonly kind: 'inProgressOperation'; readonly operation: InProgressOperation }
  | { readonly kind: 'notStacked'; readonly branch: string }
  | { readonly kind: 'cycle'; readonly branches: readonly string[] }
  | { readonly kind: 'parentMissing'; readonly branch: string; readonly parent: string }
  | { readonly kind: 'checkedOutElsewhere'; readonly branch: string; readonly worktreePath: string }
  | { readonly kind: 'dirtyWorktree'; readonly paths: readonly string[] };

export interface RestackPlanEntry {
  readonly branch: string;
  readonly parent: string;
  readonly base: string;
  readonly baseSource: 'recorded' | 'mergeBase';
  readonly commits: number;
  readonly reason: 'stale' | 'ancestorRestacked';
}

export interface RestackPreflight {
  readonly base: string;
  readonly plan: readonly RestackPlanEntry[];
  readonly blockers: readonly RestackBlocker[];
  readonly verdict: 'clean' | 'noop' | 'blocked';
  /** Where HEAD is returned to (F5) — a branch name, or a short sha for a detached HEAD. */
  readonly restoresHead: string;
  /** Branches with an upstream that this restack will make diverge — a force-push-with-lease
   *  is needed afterwards (F14, `RefRow.track`). Never acted on by this phase (§8). */
  readonly needsForcePush: readonly string[];
  readonly routes: readonly 'stashFirst'[];
}
```

**Blocker order** — `inProgressOperation`, `notStacked`, `cycle`, `parentMissing`, `checkedOutElsewhere`, `dirtyWorktree`. First is the dialog's headline, the same convention `ClassifyCheckout` (`checkout.go:92-104`) and `ClassifyCherryPick` established.

**The plan's own rule** — a branch is in the plan iff it is `needsRestack` **or** any ancestor of it in the stack is in the plan (`reason: 'ancestorRestacked'`). Computed top-down in one pass. An up-to-date branch whose whole ancestry is up to date is omitted entirely, which is what makes a re-run after a resolved conflict cheap (F8).

**Scope is always the whole stack**, never "from here up". A branch cannot be stale without its ancestors being at least as stale, so "from here" would produce a plan whose first entry rebases onto a parent that is itself about to move. One behaviour, no option.

**`dirtyWorktree` is a blocker, always** — every rebase checks out its branch (F5/P8), so any dirty tree blocks any restack. It carries `routes: ['stashFirst']`, reusing `ResetPreflight`'s own route vocabulary so `StackDialog.vue` can offer the existing stash dialog. **Deliberately not autostash**: `--no-autostash` is passed explicitly (D7), and the "uncommitted work never blocks you" answer is G28's, designed there once rather than half-built here.

`ClassifyRestack` is a pure function in `gitpreflight/stack.go` over `(stacks, target, status, inProgress, refs)` — no spawn, table-tested with no repository, exactly like `ClassifyCheckout`/`ClassifyReset`.

### D15 — Branch review needs no resolver change; the stack row passes the parent as the existing explicit base

`review.resolveBase` already takes an optional `base` override (`ResolveReviewBase(ctx, branch, base *string, candidates)`, `review.go:148`). `StackList.vue`'s per-row **Review** action passes the row's `parent` as that override. The result is exactly what a stacked review wants — "show me *this* PR's commits, not the whole stack's" — with **zero** change to `gitreview.ResolveBase`, zero new `Reason` member (which would be a totality change on both sides), and zero risk to G6's ported test corpus. §9 hands forward "make `stackParent` a first-class base reason" as the follow-up if the override proves too implicit in use.

### D16 — Two invalidation points, and one new watched basename

- `entry.go`'s `note()` (on `refsChanged`) and `invalidateAfterWrite()` both drop the new stack cache, joining `detail`/`refs`/`rangeCount`. `RunRestack` and `stackSet` both go through `invalidateAfterWrite`.
- `gitclient/watcher.go`'s `refIshNames` gains `"config"`. Today a hand-edited `.git/config` — the one place a user can legitimately edit their own stack outside the app — produces no signal at all. A `git branch -m` run in a terminal already fires through `refs/**`, so this closes only the hand-edit case; `.git/config` is written rarely enough (`--set-upstream`, `remote add`) that a spurious `refsChanged` costs one debounced cache drop. One map entry, one test case.

### D17 — `CONTRACT_VERSION` 28 → **29**

Stated plainly so no later phase claims 29 blind: **this phase's own additions produce `CONTRACT_VERSION = 29` / `ContractVersion = 29`.**

| Addition | Count |
|---|---|
| Requests: `stack.list`, `preflight.restack`, `stack.restack`, `stack.cancelRestack` | 4 |
| Events: `stack.progress` | 1 |
| Wire types: `StackBranchState`, `StackBranch`, `StackSummary`, `StackListResult`, `RestackBlocker`, `RestackPlanEntry`, `RestackPreflight`, `RestackResult`, `RestackProgress` | 9 |
| `OpRequest` kinds: `stackSet` | 1 |
| `OpErrorKind` members: `StackCycle` | 1 |
| `UiActionKind` members: `restackStack`, `checkoutStackParent`, `checkoutStackChild` | 3 |
| Capabilities / settings / streams | **0** |

All four requests are **Go-served** — none is an extension-answered `editor.*`-shaped method. `REQUEST_KEY_MAP` gains four entries and `EVENT_KEY_MAP` one.

---

## 3. The Go side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 3.1 | `internal/gitops/stack.go` | new | `StackParentKey`/`StackBaseKey`, `StackConfigReadArgs()`, `StackConfigSetArgs(key, value)`, `MergeBaseArgs(a, b)`, `RebaseOntoArgs(onto, upstream, branch)` — each with its probe citation (D1/D6/D7) |
| 3.2 | `internal/gitops/stack_test.go` | new | Byte-exact argv goldens for all five, including that `--no-autostash`/`--no-update-refs` precede `--onto` and that `--local` is present on both config verbs |
| 3.3 | `internal/gitops/errors.go` | edited | D5's two rows, placed beside their existing kin |
| 3.4 | `internal/gitops/errors_test.go` | edited | P12's two strings → `DirtyWorktree`; P14's string → `NotFound`; P10's `error: could not apply` (combined stream) → `Conflict` |
| 3.5 | `internal/gitops/conflict.go` | edited | Rebase arms in `ContinueArgs` and `SkipArgs` (D12) |
| 3.6 | `internal/gitpreflight/operation.go` | edited | Rebase `canContinue: true`; `CanSkip` includes rebase; both doc comments rewritten to name G26 as the phase that retired the report-only posture and why |
| 3.7 | `internal/gitpreflight/operation_test.go` | edited | The two rebase assertions inverted, under names stating the G26 reason |
| 3.8 | `internal/gitpreflight/stack.go` | new | The nine wire types, `StackConfigEntry`, `ParseStackConfig` (P3/P4/P5 framing), `BuildStacks` (forest assembly, cycle detection, pre-order flatten, `maxStackedBranches`), `ClassifyRestack` (D14). Pure — no spawn, no filesystem |
| 3.9 | `internal/gitpreflight/stack_test.go` | new | `ParseStackConfig`: dotted branch names, empty values, lowercased keys, truncated input. `BuildStacks`: linear chain, fork, orphan (missing parent), self-cycle, two-branch cycle, remote-branch base, cap. `ClassifyRestack`: each blocker alone, all six together in order, `noop`, the `ancestorRestacked` cascade, `restoresHead` for branch/detached, `needsForcePush`, `routes` |
| 3.10 | `internal/gitsession/stack.go` | new | `stackCache`; `stackConfig(ctx)`; `Stacks(ctx)` (D3, one spawn per stacked branch via `porcelain.LeftRightCountArgs`); `RestackPreflight(ctx, branch)`; `restackSlot`; `RunRestack` (D6/D8/D9/D11); `CancelRestack`; `prepareStackSet` (D10); `captureStackSetUndo`; `stackChildrenOf`; `reparentArgsOnDelete`; `reparentArgsOnRename` |
| 3.11 | `internal/gitsession/stack_test.go` | new | Zero-spawn when no branch is stacked; cache hit/drop on `refsChanged`; cycle refusal spawns no write; restack plan ordering; a conflicting branch stops the loop and sets **no** undo record; a successful restack sets one whose replay is `switch`+`update-ref`s+`reset --keep`; a second `stack.restack` while one runs answers `OperationInProgress` with no spawn |
| 3.12 | `internal/gitsession/ops.go` | edited | `opTable` gains `stackSet` (`Undoable`); `OpRequest` gains `Parent *string`; `prepareBranchRename` appends child-parent rewrites (D1); `prepareBranchDelete` appends child re-parent + base recompute; `captureBranchDeleteUndo` also captures each child's old parent/base and replays them; the stale `"nineteen kinds"` doc comments at `:18-24` and `:91-93` corrected in the same commits that touch their neighbourhood (G17 D10/G22 D11's own convention) |
| 3.13 | `internal/gitsession/ops_test.go` | edited | Counts 19 → **20**; `TestOpTable_UndoableKindsAre…` renamed and widened to six; a new test that deleting a stacked parent re-parents its children and that undoing the delete restores both the branch and every child's pointer |
| 3.14 | `internal/gitsession/entry.go` | edited | `stack *stackCache`, `restack restackSlot`; drops in `note()` and `invalidateAfterWrite()`; `e.restack.forceCancel()` in `teardown` |
| 3.15 | `internal/gitrpc/stack.go` | new | `handleStackList`, `handlePreflightRestack`, `handleStackRestack` (ctx detached, G5 D8), `handleStackCancelRestack` |
| 3.16 | `internal/gitrpc/{wire,handlers,contract}.go` | edited | Four param types, four switch arms, `ContractVersion` 28 → **29** with its own dated bump comment |
| 3.17 | `internal/gitrpc/stack_test.go` | new | A `Router` over a fake runner: `app.init`/`repo.open`/`refs.list` spawn no config read; `stack.list` on an unstacked repo spawns exactly one; `stack.restack` with a blocker spawns no `rebase` |
| 3.18 | `internal/gitclient/{watcher,watcher_fsnotify}.go` | edited | `"config"` in `refIshNames` + one classify test case (D16) |
| 3.19 | Not edited | — | `gitreview/*` (D15), `gitwire/*`, `ghclient/*`, `gitprepare/*`, `gitsearch/*`, `internal/storage/*` (**no migration, no new settings leaf**) |

---

## 4. The TypeScript / Vue side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 4.1 | `packages/git-ipc/src/contract.ts` | edited | D17's nine types, four requests, one event, `stackSet`, `StackCycle`, three `UiActionKind` members |
| 4.2 | `packages/git-ipc/src/validate.ts` | edited | `CONTRACT_VERSION = 29`; four `REQUEST_KEY_MAP` entries; one `EVENT_KEY_MAP` entry; the dated bump comment |
| 4.3 | `packages/git-ui/src/state/stack.ts` | new | `StackState` — `stacks`/`orphans`/`generation`/`restacking`, `setRepoId`, `reload` (with the in-flight repo-switch guard `WorktreeState.reload` already makes), `previewRestack`, `runRestack`, `cancelRestack`; subscribes to `repo.changed`/`refsChanged`; calls `PrState.ensureSnapshot(branchNames)` after each load (F13) |
| 4.4 | `packages/git-ui/src/state/stack.test.ts` | new | Reload on `refsChanged`; stale-reply drop on repo switch; `ensureSnapshot` called once per load with the union of branch names |
| 4.5 | `packages/git-ui/src/components/stackListModel.ts` | new | Pure: indent/row model, the stale chip's text, `needsForcePush` labelling, and `parentOf`/`childOf` for navigation (D-nav) |
| 4.6 | `packages/git-ui/src/components/stackListModel.test.ts` | new | Chain and fork indenting; orphan section; nav wrap-around behaviour at the ends |
| 4.7 | `packages/git-ui/src/components/StackList.vue` | new | The fifth `BranchPicker` section: per row — name, depth indent, `ahead` count, stale chip, G24 PR badge (`pickBestPr`/`buildPrBadge` over `PrState.byBranch`), `formatTrack` upstream state, `checkedOutIn` badge; header actions **Restack** / **New stacked branch…**; the paused-restack strip (D8) |
| 4.8 | `packages/git-ui/src/components/dialogs/StackDialog.vue` | new | Two modes: *set parent* (a branch picker with live `preflight.restack`-free validation) and *restack* (the plan table with `baseSource`/`commits`/`reason`, the blocker headline, the `stashFirst` route, and a live progress list driven by `stack.progress`, with Cancel) |
| 4.9 | `packages/git-ui/src/components/BranchPicker.vue` | edited | Mounts `StackList` as a fifth section, exactly as `WorktreeList` was mounted at G25 |
| 4.10 | `packages/git-ui/src/components/columns.ts` | edited | `StackContext` — the fourth accessor context (F12); one call in `messageFormatter` |
| 4.11 | `packages/git-ui/src/components/refBadges.ts` | edited | A branch badge that is a stack member gains `kv-badge-branch--stacked`; a stale one additionally `--stale` (a dashed outline, the existing `dashed` affordance). **No new `DecorationRef` kind** — `badgeSpecFor`'s exhaustive switch is untouched |
| 4.12 | `packages/git-ui/src/components/refBadges.test.ts` | edited | Stacked/stale class cases |
| 4.13 | `packages/git-ui/src/components/CommitGrid.vue` | edited | A `stack.generation` watcher → `invalidateAllRows()/render()` (the fourth instance) |
| 4.14 | `packages/git-ui/src/components/rowMenuModel.ts` | edited | `buildRefMenu` gains a stack section: *Set stack parent…*, *Remove from stack*, *Restack this stack*, *Go to parent branch*, *Go to child branch* |
| 4.15 | `packages/git-ui/src/components/rowMenuModel.test.ts` | edited | The new section's presence/absence by stack membership |
| 4.16 | `packages/git-ui/src/state/ops.ts` | edited | `runStackSet`, `runRestack`, `cancelRestack`, and the restack announcement composition |
| 4.17 | `packages/git-ui/src/state/liveAnnouncements.ts` | edited | `StackCycle: 'that would make a branch its own ancestor'`; `composeRestackAnnouncement(restacked, stoppedAt, remaining)` |
| 4.18 | `packages/git-ui/src/components/AppToolbar.vue` | edited | A restacking strip, reusing the `remote.progress`/`worktree.progress` strip shape |
| 4.19 | `packages/git-ui/src/App.vue` | edited | Construct `StackState`; mount `StackDialog`; three new `runUiAction` cases (`restackStack`, `checkoutStackParent`, `checkoutStackChild` — the last two resolve a target client-side from `stackListModel` and call the existing `opsState.runCheckout`) |
| 4.20 | `packages/git-ui/src/theme/vscode-tokens.css` | edited | `--kv-badge-branch-stacked-*` and `--kv-stack-stale-*`, light and dark |
| 4.21 | `apps/kira-studio-vscode/src/commands.ts` | edited | `MutatingAction` gains `'restack'`; `MUTATING_COMMANDS` gains `stackSet` and `restack`; `OTHER_COMMANDS` gains the two navigation commands |
| 4.22 | `apps/kira-studio-vscode/src/commands.test.ts` | edited | The third Go source (`gitsession/stack.go`'s `RunRestack`), both directions |
| 4.23 | `apps/kira-studio-vscode/package.json` | edited | Four `contributes.commands` entries under `CATEGORY`; two `contributes.keybindings` (`alt+up`/`alt+down`, `when: kiraVersion.webviewFocused`) |
| 4.24 | `apps/kira-studio-vscode/tests/unit/ipc/wireConformance.test.ts` | edited | Structural conformance for `StackBranch`/`StackSummary`/`RestackPreflight`/`RestackResult` |
| 4.25 | Not edited | — | `gitWire.fbs`, `codec.ts`, `git-core/settings/schema.ts` (**no new setting**), `git-core/search/*`, `review/*` |

---

## 5. Dependencies and tooling

Nothing new. `git rebase --onto`, `--no-autostash`, `--no-update-refs`, `git config --local --null --get-regexp`, `git merge-base`, `git rev-list --count --left-right` and `git update-ref` are all ordinary git at or below the 2.38 floor (P17). No new Go module, no new npm package, no SQL migration, no new settings leaf, no `flatc` regeneration.

---

## 6. Implementation order

1. **Probes M1–M5** against a scratch fixture, recorded in the commit message alongside P1–P18.
2. `gitops/stack.go` + `stack_test.go`; `errors.go`'s two rows + `errors_test.go`. **Independently green here.**
3. `gitops/conflict.go` + `gitpreflight/operation.go` + the two inverted tests (D12) — small, isolated, its own reviewable commit.
4. `gitpreflight/stack.go` + `stack_test.go` — the whole model, pure, fully provable before any session wiring exists.
5. `gitsession/stack.go`'s read half (`stackConfig`, `Stacks`, `RestackPreflight`) + `entry.go`'s cache slot and its two drops.
6. `gitsession/ops.go`'s `stackSet` entry, `prepareStackSet`, `captureStackSetUndo`, and `ops_test.go`'s three count updates.
7. `gitsession/ops.go`'s branchRename/branchDelete fix-ups and the widened `captureBranchDeleteUndo` + their tests.
8. `gitsession/stack.go`'s write half — `restackSlot`, `RunRestack`, `CancelRestack` — plus `stack_test.go`. The highest-risk code, in its own commit.
9. `gitrpc`'s four handlers, `ContractVersion` 29, `stack_test.go`. Manual raw-socket smoke against a real three-branch fixture, including a deliberately conflicting one.
10. `watcher.go`'s `"config"` + its test case.
11. `packages/git-ipc` + `validate.ts` — **expect `tsc` to break in `commands.ts` and `liveAnnouncements.ts`** (F16); fix them there.
12. `packages/git-ui`'s pure layer (`stackListModel.ts`, `state/stack.ts`) + tests.
13. `packages/git-ui`'s components: `StackList.vue`, `StackDialog.vue`, `BranchPicker.vue`, the toolbar strip, theme tokens.
14. The graph layer: `refBadges.ts`, `columns.ts`, `CommitGrid.vue`, `rowMenuModel.ts`, `App.vue`.
15. The extension: `commands.ts`, `commands.test.ts`, `package.json`.
16. Full check pass.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` (chapter-scoped per SPEC's verification-scope note) passes, including `ParseStackConfig`'s dotted/empty/lowercase cases, `BuildStacks`'s cycle and fork cases, and `ClassifyRestack`'s blocker-order table.
2. `opTable` has **twenty** entries; exactly **six** are `Undoable`; every entry states a policy (`TestOpTable_EveryEntryStatesAnUndoPolicy` still passes).
3. Argv goldens: `RebaseOntoArgs` is byte-exactly `["rebase","--no-autostash","--no-update-refs","--onto",onto,upstream,branch]`; both config verbs carry `--local`.
4. `ClassifyOpError` returns `DirtyWorktree` for both P12 strings, `NotFound` for P14's, and `Conflict` for P10's combined-stream text.
5. `ContinueArgs(InProgressRebase)` and `SkipArgs(InProgressRebase)` both return their argv with `ok == true`; `ClassifyInProgress` reports `canContinue: true`, `canSkip: true` for a rebase.
6. **Zero spawns for an unstacked repository beyond one config read**: a `Router` over a counting fake runner drives `app.init`, `repo.open`, `refs.list`, `graph.loadMore`, `status.get`, then `stack.list` — asserting exactly one `config --local --null --get-regexp` and no `rev-list`.
7. A restack whose second branch conflicts returns `{ok:false, stoppedAt:'<b2>', restacked:['<b1>'], remaining:['<b3>']}`, leaves `.git/rebase-merge` present, and **sets no undo record**.
8. A fully successful restack sets exactly one undo record whose `Replay` is `switch` → `update-ref`(s) → `config`(s) → `reset --keep`, in that order, and whose `Label` matches neither `^Reset \(` nor `^Dropped stash@\{`.
9. `stackSet` with a parent that reaches the branch answers `{kind:'StackCycle'}` and spawns **no** write.
10. Deleting a stacked branch re-parents its children onto its own parent; undoing that delete restores the branch, its own `branch.*` config, and every child's pointer.
11. `bun run test:unit` passes, including `commands.test.ts`'s three-source cross-check.
12. `bun run lint`, `bun run typecheck`, `bun run build:vscode`, `bun run test:webview` all pass.
13. `CONTRACT_VERSION` / `ContractVersion` both **29**; the contract diff matches D17's table exactly.

### 7.2 Tier 2 — reasoned check

14. A grep over the diff finds `--update-refs` only in the negative form and only in `RebaseOntoArgs` + its golden test (D7).
15. No code path reads stack membership from anywhere but `.git/config`, and no code path decides staleness from anything but D4's predicate (F8's invariant).
16. No GitHub write of any kind appears in the diff (§8's PR-stacking non-goal).

### 7.3 Tier 3 — needs a human on a Mac with a real repository

17. A real three-branch stack on `main`: add a commit to the bottom branch, press **Restack**, watch the two above rebase, HEAD return to where it started, and all three go green.
18. Amend the bottom branch instead of appending (P6's case) and restack — the middle branch replays **only its own** commits, proving `kirastackbase` is doing its job.
19. Force a conflict on the middle branch: the banner reads `Rebasing <b2>` with Abort **and Continue**; resolving and pressing Continue, then Restack, finishes the stack.
20. Abort instead: the bottom branch stays restacked, the middle and top show as stale, Restack re-runs cleanly.
21. Rename a stacked branch in a terminal (`git branch -m`) — the stack survives, pointers intact (P1 in the real app).
22. Delete the bottom branch after "merging" it — the middle re-parents onto `main` and shows up to date.
23. Each stack row shows its GitHub PR badge from G24's snapshot, and its "needs force-push" state after a restack.
24. `alt+up`/`alt+down` walk the stack; both palette commands work.
25. Check out a stack branch in a linked worktree (G25) and confirm the restack is **blocked** with `checkedOutElsewhere`, naming the worktree path.

### 7.4 The checklist

- [ ] Stack membership lives only in `.git/config`, as `branch.<name>.kirastack{parent,base}`, read with `--local`.
- [ ] `"not stacked"` is `""`, never an absent key — every write and undo replay exits 0.
- [ ] `RebaseOntoArgs` passes `--no-autostash` and `--no-update-refs` explicitly.
- [ ] No branch outside the computed plan is ever rewritten.
- [ ] Staleness is `behind > 0` from `rev-list --left-right`, and never consults stored plan state.
- [ ] A partial restack sets no undo record and is idempotently re-runnable.
- [ ] A successful restack is one undo unit; its replay is `switch` → `update-ref`s → `config`s → `reset --keep`.
- [ ] Rebase offers Continue and Skip; the two G5 tests are inverted with the reason stated.
- [ ] `opTable` has twenty entries, six undoable.
- [ ] `MutatingAction` gains `'restack'` and `commands.test.ts` proves it served.
- [ ] `OP_ERROR_TEXT` has a `StackCycle` phrase; `MUTATING_COMMANDS` has a `stackSet` entry.
- [ ] `CONTRACT_VERSION` / `ContractVersion` both 29.
- [ ] No SQL migration, no new settings leaf, no GitHub write.

---

## 8. Explicit non-goals for G26

- **Cross-clone / cross-machine / cross-collaborator stack sharing.** D1 stores per-clone by design. A stack is a statement about local branches you are rewriting; publishing it would need a shared ref namespace, a merge policy for concurrent edits, and an answer for "whose stack wins" — none of which this SPEC row asks for.
- **Automatic PR stacking on GitHub** — setting each PR's `base` to its parent branch, or reordering bases after a restack. This is a `PATCH /repos/{o}/{r}/pulls/{n}`, i.e. a **write**, and G24 §0.3 rules out every GitHub write by name (*"it reads, it does not overlay, review, or write"*), with SPEC §3.5's *"own no credentials of any kind"* behind it. The stack view **renders** each branch's PR (D3/F13); it never touches one. §9 prices the follow-up.
- **Creating or submitting PRs** for a stack (`gh pr create`) — same reason.
- **Auto-force-push after a restack.** The preflight *names* the branches that will need one (`needsForcePush`, F14) and G7's existing force-push-with-lease is one click away per branch; doing it automatically would push rewritten history to a shared remote as a side effect of a local reorganisation.
- **`git rebase --update-refs`** — D7/P16.
- **Interactive rebase, squash, reorder, split, or "absorb"** — the whole `rebase -i` surface. `RebaseOntoArgs` is the phase's one rebase verb.
- **Auto-restack on pull/fetch**, or on any timer. Nothing in this phase rewrites history without a direct user act, the same rule G24 D7 applied to network calls.
- **Auto-stash to unblock a restack** — G28 owns "uncommitted changes never block you", designed there once. `routes: ['stashFirst']` points at the existing stash dialog instead.
- **Merge-commit-bearing stacks.** `--no-rebase-merges` is the effective behaviour; a stack whose branch contains a merge commit will have that merge flattened by rebase, exactly as plain `git rebase` does. Named, not hidden.
- **A stack-aware unified graph** (drawing the stack as a distinct lane structure). The graph gets a stale/stacked *class* on existing branch badges (D-4.11) and nothing more.
- **Restack progress inside the commit graph**, a second progress surface, or a per-commit restack view.
- **Naming stacks**, stack templates, or a stack-level description.
- **A `stackParent` base reason in `gitreview.ResolveBase`** — D15 uses the existing explicit override instead.
- **No `docs/v1.3/SPEC.md` edit** — the convention every phase since G12 has followed.

---

## 9. Handed forward

- **PR-base stacking on GitHub** is the obvious next request and is a G24-shaped decision, not a G26 one: it needs the first GitHub *write* in this chapter, which means revisiting §3.5's "own no credentials" posture in the specific, bounded case of `gh api --method PATCH`. Recommendation if it is taken up: one explicit, per-PR, user-initiated action with a confirmation, never a side effect of a restack.
- **Auto-force-push after a restack**, gated behind the protected-branch machinery G7 already ships, is the natural companion. `RestackPreflight.needsForcePush` is built for exactly that caller.
- **Restack progress with per-commit granularity** — the `Rebasing (n/m)` lines on stderr (P10) are already parseable; `gitops.NewProgressParser` would need one new phase pattern, and `RunRestack` would need an `OnStderr` tee. Deliberately not built: a stack's rebases are seconds long, and a second progress vocabulary for one op is not worth it until measurement says otherwise.
- **`stackParent` as a first-class `gitreview` base reason** (D15's follow-up) — a one-member `Reason` addition plus a client label, if the implicit override proves confusing in real use.
- **A "restack on top of the latest `origin/main`" convenience** — the parent can already be `origin/main` (D1), so this is a UI affordance, not a model change.
- **G28's auto-stash** should route through `RestackPreflight`'s `routes: ['stashFirst']` rather than inventing a second one.
- **G27 (NFC/NFD)** does not touch this phase: branch names and shas are the only strings crossing here, and neither comes from the filesystem.
- **`gitclient.hygieneEnv` could grow `GIT_SEQUENCE_EDITOR=true`** — D6 sets it per-spawn instead, to keep the blast radius at one call site. If a second caller ever needs it, promote it.

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 — Where the stack relationship is stored. (The big one.)** Alternatives: (a) `.git/config`'s `branch.<name>.*`; (b) the app's own per-repo SQLite (`git_repo_settings`); (c) a ref namespace (`refs/kira/stack/…`); (d) pure merge-base inference, no storage. **Recommendation: (a), exactly as D1.** It is the only option that survives `branch -m`/`branch -d` for free (P1/P2) — and, because `captureBranchDeleteUndo` already replays `branch.<name>.*`, the only one whose undo story costs zero new code; it is the only one visible across a repository's worktrees (F3), which matters now that G25 ships worktree creation; and (d) is provably wrong in the feature's central case (P6). Its one real cost — a stack does not travel with a clone — is the correct scope, recorded as a non-goal rather than a gap. If overridden, (b) is the fallback, and it must then add its own rename/delete hooks and accept the per-worktree blindness.

**10.2 — Per-branch `rebase --onto` rather than one `rebase --update-refs`.** **Recommendation: per-branch, as D7.** The one-command version is genuinely tempting (P16 restacked a whole stack in one call, with atomic `--abort`), but it moved two branches the user never named, only works for a strictly linear stack, and hides the per-branch base bookkeeping D6 depends on. `--no-update-refs` is additionally passed *explicitly*, because a user's own `rebase.updateRefs = true` would otherwise reproduce the hazard through our per-branch rebases.

**10.3 — A restack is one undo unit, and only when it fully succeeds.** **Recommendation: as D8/D11.** A partial restack leaves `.git/rebase-merge` live, and replaying `update-ref`s underneath a running sequencer is not a safe undo — so no record is set, and the user is told, in words, that the remedy is git's own Continue/Abort plus a re-run. That re-run is safe precisely because staleness is derived, never stored (F8). The alternative — a per-branch undo stack — would need a second undo mechanism beside the one-slot-per-repo model SPEC §6 fixes, for a case the idempotent re-run already covers.

**10.4 — Flipping rebase's `canContinue` from `false` to `true`, retiring G5's "report-only posture".** **Recommendation: flip it (D12).** The posture was correct when nothing in the app could start a rebase; D6 starts one, and a paused restack with no Continue button is a dead end whose only exit is a terminal. Note the side effect honestly: a rebase started *outside* the app (a `git pull --rebase` conflict from G7, or one begun in a terminal) will now also offer Continue and Skip. That is a strict improvement — both run git's own documented remedies for exactly that state — but it is a visible change to a shipped surface, so it is listed here rather than buried in a diff.

**10.5 — `stack.restack` as its own executor rather than an `opTable` kind.** **Recommendation: its own executor (D6).** The rebase argvs themselves fit `opTable` perfectly (F7's late-resolving `--onto`), and that version would have been ~60 lines instead of ~250. What does not fit is recording each child's new base, which needs the parent's post-rebase tip. The alternatives were a `Finalize` hook on `opSpec` (a best-effort, silently-failing write inside otherwise total machinery) or not recording bases (P6's wrong answer). The cost is D13's `MutatingAction` widening and the `commands.test.ts` extension, both of which are visible, tested, and one-time.

**10.6 — The model is a forest (a parent may have several children), not strictly a chain.** SPEC's own wording is *"a sequence of dependent branches"*. **Recommendation: allow the forest (D3).** Parent pointers admit it naturally; refusing it needs an extra "at most one child" constraint, an error kind for violating it, and a UI for resolving it. Pre-order flattening with a `depth` field renders a chain and a fork identically, and the restack plan's top-down cascade is correct for both.

**10.7 — Restack scope is always the whole stack, never "from this branch up".** **Recommendation: whole stack (D14), one behaviour, no option.** A branch cannot be stale without its ancestors being at least as stale, so a "from here" plan would rebase onto a parent that is itself about to move. The apparent flexibility would only ever produce a worse result.

**10.8 — `git config --unset` replaced by writing `""`.** **Recommendation: write `""` (D2).** `--unset` on a missing key exits 5 (P5), and `runWriteArgv` classifies every non-zero exit as an error — so an undo replay of "it previously had no parent" would report a spurious failure. The cost is a residual `kirastackparent =` line for a branch that left its stack; the benefit is that `stackSet` and its undo are symmetric and total.

**10.9 — Re-parenting a deleted branch's children onto its own parent, inside `prepareBranchDelete`.** **Recommendation: do it (D-3.12).** "PR 1 merged, delete branch 1, branches 2..n now sit on `main`" is the single most common stack lifecycle event, and leaving the children orphaned would make the feature feel broken at exactly the moment it should feel best. It costs one `merge-base` spawn per child and a small widening of `captureBranchDeleteUndo`, which already replays config lines — so undoing the delete restores the whole shape.

**10.10 — Adding `"config"` to the watcher's ref-ish basenames.** **Recommendation: add it (D16).** One map entry and one test case; without it, a user who hand-edits their stack in `.git/config` — the one legitimate out-of-app edit this design invites, precisely because it chose a human-readable store — sees nothing change until something else touches a ref. `.git/config` is written rarely enough that a spurious `refsChanged` costs one debounced cache drop.

**10.11 — Branch review's base for a stacked branch comes from the existing explicit override, not a new resolver reason.** **Recommendation: the override (D15).** It is behaviourally identical from the user's seat, and it keeps `gitreview.ResolveBase` — a faithfully ported, table-tested G6 pure function with a client-side label map over its `Reason` union — completely untouched. §9 records the first-class version as the follow-up if the implicitness bites.

**10.12 — No new setting, and no SQL migration.** **Recommendation: ship zero settings.** Every candidate considered (a default trunk name, an auto-restack toggle, an auto-force-push toggle) is either already expressible through the parent pointer or is an explicit non-goal. G18's store, `RepoSettingsSnapshot`, and `settings/schema.ts` are all untouched, which keeps D17's contract bump to requests and types alone.

**10.13 — `CONTRACT_VERSION` 28 → 29.** **Recommendation: bump.** Unavoidable: four new Go-served requests, one new event, one new `OpRequest` kind and one new `OpErrorKind`.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/gitsession/ops.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitsession/remote.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitpreflight/operation.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitops/errors.go`
- `/home/user/kira-studio/packages/git-ipc/src/contract.ts`
