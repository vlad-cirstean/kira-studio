# G28 — Branch-scoped stash: auto-stash on checkout, cross-branch apply, auto-detach, and a durable global stash bucket

> **What this phase is.** The twenty-eighth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the **fifth from-scratch design phase in a row** (G24, G25, G26, G27 preceded it). SPEC `:341` names four deliverables and three open design questions, and says so in as many words: *"No upstream design to port — added 2026-09-07, requested with no further detail yet, so full design … happens entirely at this phase's own Opus planning pass."* This plan is that design.
>
> **The scope boundary, confirmed first, because it is the easiest thing in this phase to get wrong.** Upstream `kira-version-vscode` (`claude/start-p2-gwlgly`) does have an "autostash" concept — it is **P8/P9's *pull* autostash**, a dirty-tree-blocks-a-non-fast-forward-pull hazard, reserved as an always-empty `PullPreflight.routes` seam (`packages/ipc/src/contract.ts:467`, `packages/core/src/preflight/types.ts:89`, `docs/plans/P8.md`/`P9.md`). **This repo already ported it in full** — `internal/gitpreflight/pull.go` (`PullRoute`, `RouteStashAndCarry`, `PullPreflight.Routes`), executed client-side by `packages/git-ui/src/state/ops.ts`'s `#stashAndCarry`. That is a *different feature* from G28's row: it is pull-triggered, not checkout-triggered; it pops back immediately; it carries no origin-branch tag; and it has no cross-branch or global-bucket half. G28 borrows its **shape** — "a pre-flight computes a named route, the client offers it, the write is one atomic op" — and nothing else. Every reference below is explicit about which of the two is meant.
>
> **The three open questions SPEC names, answered up front.**
> 1. **The auto-stash trigger point.** `gitpreflight.ClassifyCheckout` gains one route, `"autoStash"` (**D2**), and `checkout` gains one field, `autoStash: boolean` (**D3**) — the stash and the switch become **two argv in one `opTable` `prepared.argvList`**, run in order under one `Repo.Write` chain, so there is no window in which the tree is stashed and the switch never happened. **It does not pop back** (**D1**) — the SPEC row's own text is the proof, argued in full below. `git stash push -u` is the one argv that clears *every* dirty-tree checkout blocker, tracked and untracked alike (probe **P15**), which is what makes "never blocks" a guarantee rather than a hope.
> 2. **The cross-apply RPC and the conflict-prediction reuse.** There is **no new RPC and no generalisation needed** (**F2/D5**). `RepoEntry.PreflightStashPop(ctx, sha, targetSha *string)` already defaults its target to *whatever is checked out now*, and `stashPopPrediction` is already `merge-tree --merge-base=<the stash's own base> <target> <stashSha>` — target-parameterised since G17. `gitops.StashApplyArgs` already addresses by raw sha. Probes **P19/P20** confirm a genuinely conflicting cross-branch apply is predicted correctly and classified correctly by `reclassifyStashPop`'s *existing* post-write unmerged-paths path. **Cross-branch apply is a labelling and affordance change, not plumbing** — and the one thing genuinely missing is that `StashEntry.branch` has crossed the wire since contract version 21 and **is rendered nowhere** (**F1**).
> 3. **The global bucket's storage.** **One git ref per entry — `refs/kira/globalstash/<stashSha>` → a stash-shaped commit built by `git stash create` (or `git commit-tree`), with no SQLite of any kind** (**D8/D9**). The decisive probe is **P7**: a reflog-backed namespace mirroring `refs/stash`'s own shape is **not durable** — with `gc.reflogExpire=now`, `git reflog expire --all` leaves `refs/stash` intact (git special-cases it) and **wipes a custom ref's reflog entirely**. One ref per entry survives `reflog expire --expire-unreachable=now --all` *plus* `gc --prune=now --aggressive` untouched (**P8**), because every ref is a gc root. SQLite is not needed for the metadata half either: the label, the origin branch, the created-at and the file count all already ride on the commit (`On <branch>: <label>`, author date, numstat) and are parsed by machinery `porcelain/stash.go` already owns.
>
> **SPEC's own characterisation of git's stash is imprecise, and this plan says so rather than repeating it.** The row calls git's stash *"a single ordered pop-once list"*. Probe **P1**: `git stash apply` does **not** drop the entry — only `pop` does. Reuse is already possible today. The real, and sufficient, deficiency is different and is stated in **F8**: it is a *single ordered list addressed by shifting `stash@{N}` positions*, which this very phase is about to churn far harder (every unblocked checkout now pushes an entry), and in which a keep-forever entry is one mis-clicked Pop or Drop from being gone.
>
> **`CONTRACT_VERSION` 29 → 30** (**D17**), claimed explicitly here so no later phase claims 30 blind.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `f07db449` (G1–G27 complete, working tree clean). Every claim below was checked against source read in this container, or produced by a read-only probe against real git 2.43.0 in a scratch fixture under `/tmp/g28probe` — never inferred from SPEC prose, and never run against this repository.

| Claim | Evidence |
|---|---|
| Upstream's only "autostash" is **pull**'s, and it is an empty seam there | `packages/ipc/src/contract.ts:467`, `packages/core/src/preflight/types.ts:89`, `docs/plans/P8.md`/`P9.md` at `/home/user/vlad-cirstean/kira-version-vscode` |
| This repo already ported that pull autostash in full | `internal/gitpreflight/pull.go` (`PullRoute`, `RouteStashAndCarry`, `PullPreflight.Routes`); `git-ui/src/state/ops.ts:1210-1240` |
| Upstream has **no** checkout-triggered auto-stash, no origin-branch tagging, no cross-branch apply action, no global bucket | Grep over upstream `src/`, `packages/`, `docs/` for `globalstash`/`global stash`/`autoStash`+`checkout`/`crossBranch` → nothing |
| Origin-branch parsing already exists server-side | `porcelain/stash.go`'s `parseBranchFromMessage` (`"WIP on "`/`"On "`, `(no branch)` ⇒ nil); `StashEntry.Branch *string` |
| …and crosses the wire | `packages/git-ipc/src/contract.ts:394` — `readonly branch: string \| null` |
| …and is rendered **nowhere** | `grep -rn "\.branch" packages/git-ui/src/components/StashList.vue StashDetailPane.vue state/stash.ts` → no match. G17 §10.4 recommended showing it; the shipped component does not |
| The stash-pop pre-flight is already target-parameterised | `gitsession/preflight.go:527` `PreflightStashPop(ctx, sha, targetSha *string)`; `:616` `stashPopPrediction(ctx, target, entry.Sha, entry.BaseSha)`; `:236` `MergeTreeArgs(target, stashSha, baseSha)` |
| `stash apply` addresses by raw sha; only pop/drop/branch need `stash@{N}` | `gitops/stash.go:27` vs `:38`/`:47`/`:54`; `gitsession/ops.go:373` `stashPositionMismatch` |
| A conflicting pop/apply is classified from a post-write status read, not stderr | `gitsession/ops.go:576` `reclassifyStashPop` |
| `ClassifyCheckout` already emits a `worktreeConflict` blocker and a `routes` list | `gitpreflight/checkout.go:96-98`, `:116-122` |
| `SwitchDetachArgs` and `checkout`'s `mode: "detach"` already exist | `gitops/checkout.go:25`; `gitsession/ops.go:263-266`; `contract.ts` `OpRequest.checkout` |
| G25 explicitly handed the auto-detach answer to this phase | `docs/v1.3/plans/G25-worktree-support.md:79`, `:404` |
| G26 explicitly handed "uncommitted work never blocks you" to this phase | `docs/v1.3/plans/G26-stacked-branches.md:464`, `:643`, `:660` |
| `opTable` serves **20** of `OpRequest`'s **22** kinds; **6** are `Undoable` | `gitsession/ops.go:138-253`; `ops_test.go:22`, `:46`, `:69` |
| `prepared.argvList` is already a multi-argv sequence run in order, stopping at the first classified failure | `gitsession/ops.go:804-814` |
| The graph walk's rev set is `--all` for every scope but `head`, shared by the paged walk, the remaining-count query and G23's tail scan | `porcelain/log.go:38-56` |
| `kiraVersion.stash.showInGraph` is stored and **never reaches the walk** | `grep -rn "StashShowInGraph\|IncludeStash"` → `wire.go`/`settings.go`/`model` only; no `gitrpc/graph.go` consumer |
| `refs.list` is scoped to `refs/heads`/`refs/remotes`/`refs/tags`, so a new namespace is invisible to it | `porcelain/refs.go:36`, `:42` |
| The watcher already reports any write under `commonDir/refs/**` as `refsChanged` | `gitclient/watcher.go`'s `classify`, first rule |
| `git_repo_settings` is a `(repo_id, key)` key-value table — a new setting needs **no migration** | `storage/migrations/0017_g18_git_repo_settings.sql` |
| G27's tiering: repo-relative file paths are **never** normalized; ref names stay byte-exact | `docs/v1.3/plans/G27-unicode-path-normalization.md` §D2, §8 |
| `CONTRACT_VERSION` is 29 (G26); G27 made no wire change | `packages/git-ipc/src/validate.ts:83`; `internal/gitrpc/contract.go:89`; G27 D10 |

**Probes run in this container against real git 2.43.0, read-only, in scratch fixtures under `/tmp/g28probe` (never this repo):**

| # | Question | Observed |
|---|---|---|
| **P1** | Does `git stash apply` drop the entry? | **No.** Exit 0, `git stash list` unchanged, tree updated. Only `pop` drops. **SPEC's "pop-once" wording is imprecise** — recorded, not repeated (F8). |
| **P2** | What is `refs/stash`, physically? | A single ref (`.git/refs/stash`) plus a reflog (`.git/logs/refs/stash`). Each entry is a commit with **2 parents** (base, index) or **3** with `-u` (base, index, untracked). |
| **P3** | `stash list` subject shapes | Default `WIP on <b>: <sha> <subject>`; `-m <msg>` ⇒ `On <b>: <msg>`; detached ⇒ `On (no branch): …`. `-m ""` still yields the `WIP on` form. All three are exactly what `parseBranchFromMessage` already handles. |
| **P4** | `git stash create <label>` | Produces a stash-shaped commit **without touching the worktree, the index, or `refs/stash`**. Subject is `On <branch>: <label>`. On a **clean tree**: exit 0, **empty stdout**, no commit. |
| **P5** | Does `git stash create` support `-u`? | **No.** `-u` is consumed as the *message* (`On main: -u`) and the commit has only 2 parents. A `stash create`-sourced global entry is tracked-only (F14/D10). |
| **P6** | `update-ref --create-reflog refs/kira/globalstash <sha> -m <msg>`, read back with `git log -g --format=<StashFormat>` | Works; framing byte-identical to `stash list`'s, `%gd` reads `kira/globalstash@{N}`. Recorded, then **rejected** by P7. |
| **P7** | **Durability of a reflog-backed namespace.** With `gc.reflogExpire=now`, run `git reflog expire --all` | **`refs/stash` survives intact** (git special-cases it to `never`); the **custom ref's reflog is wiped entirely** — every entry, including the tip's. A reflog-backed global bucket loses the user's data on an ordinary `git gc`. **The decisive probe of this phase.** |
| **P8** | **Durability of one-ref-per-entry.** `git reflog expire --expire=now --expire-unreachable=now --all` then `git gc --prune=now --aggressive` | The commit **survives**; `git for-each-ref refs/kira/` still lists it; `git fsck` reports nothing. Refs are gc roots — by construction, not by policy. |
| **P9** | Can `refs/kira/globalstash` and `refs/kira/globalstash/<x>` coexist? | **No** — `fatal: … 'refs/kira/globalstash' exists; cannot create …`. One shape must be chosen; D8 chooses the directory form. |
| **P10** | `update-ref -d` semantics | Deleting a **nonexistent** ref exits **0 silently** (⇒ D11 verifies existence host-side first). Deleting with an expected old value works. Re-creating (the undo replay) works. Creating an already-identical ref is idempotent, exit 0. `for-each-ref` on an empty namespace: exit 0, no output. |
| **P11** | Does `git log --all` sweep `refs/kira/**` (and `refs/stash`) into the walk? | **Yes, both.** `git log --exclude='refs/kira/*' --all` excludes them; the `--exclude` must **precede** `--all`. With no matching refs it is a harmless no-op. |
| **P12** | `git log --no-walk -m --first-parent -z --numstat -M -C --format=…` over stash commits | Produces **header record, then numstat records with a literal leading `\n` on the first** — structurally identical to `stash list -z --numstat`, so `ParseStashList`'s record walk applies unchanged. `--no-walk` sorts by commit date descending. |
| **P13** | Escape syntax differences | `for-each-ref` interprets `%00`/`%1f` but **not** `%x1f` (which prints literally); `git log --pretty` is the reverse. Matches `porcelain/refs.go:13-16`'s existing note. |
| **P14** | Checking out a branch held by another worktree | `git switch <b>` / `git checkout <b>`: `fatal: '<b>' is already used by worktree at '<path>'`, exit **128**. `git switch --detach <b>`: **exit 0**, `## HEAD (no branch)`. |
| **P15** | Does `git stash push -u` clear *both* checkout blocker classes? | **Yes.** With a tracked block *and* an untracked block present, `stash push -u` exits 0 and the subsequent `switch` succeeds. (`--discard-changes` provably cannot clear an untracked block — G5 probe P9, still true.) |
| **P16** | `git stash push` on a clean tree | Exit **0**, `No local changes to save` on **stdout**, no entry created. |
| **P17** | `git stash push` during a conflicted merge | Exit **1**, `f.txt: needs merge` on **stdout**, **stderr empty** ⇒ `ClassifyOpError` would say `Unknown`. The host-side in-progress gate is load-bearing (D3). |
| **P18** | `git stash push -u -m <m> -- <paths>` | Scopes correctly — listed paths stashed, others left dirty; mixes tracked and untracked freely. |
| **P19** | Cross-branch apply, non-overlapping | `merge-tree --merge-base=<stash base> <otherBranchHEAD> <stashSha>` ⇒ exit 0, clean. Actual `git stash apply <sha>` on that branch ⇒ exit 0, `Auto-merging`, applied. Prediction matches reality. |
| **P20** | Cross-branch apply, overlapping | `merge-tree` ⇒ exit **1**, stage-1/2/3 rows, `CONFLICT (content)`. Actual apply ⇒ exit **1**, *everything on stdout*, **stderr empty**, entry **kept**. Byte-for-byte the same failure shape as G17's own same-branch probe 5 ⇒ `reclassifyStashPop` already covers it with no change. |
| **P21** | `stash push -u` then `stash apply --index <sha>` round trip | Restores staged / unstaged / untracked **exactly** (`porcelain=v2` output byte-identical before and after). |
| **P22** | Pathspec hazard | `git stash push -- 'x*.txt'` stashed **both** `x*.txt` and `xy.txt`; `git stash push -- ':(literal)x*.txt'` stashed only the literal file. Generated pathspecs **must** be `:(literal)`-prefixed (D14). |
| **P23** | `git commit-tree <stashTree> -p <base> -p <index> [-p <untracked>] -m <subject>` | The rebuilt commit **applies identically**, untracked half included, and `git stash show` works on it. Recorded as the mechanism a future "rename a global entry" would use (§9); **not built here**. |
| **P24** | `gc.<pattern>.reflogExpire` config | Accepted and readable back. Recorded for completeness; unused, because D8 rejects the reflog shape outright rather than depending on a per-clone config write to stay safe. |

**Probes the implementer runs first, with the expected result stated so a mismatch is visible:**

| # | Command | Expected |
|---|---|---|
| **M1** | `git stash push -u -m "auto-stash: switching to X"` with **only** an untracked block present, then `git switch X` | Both exit 0 — confirms P15 generalises to the untracked-only case, which the auto-stash `-u` rule (D3) depends on |
| **M2** | `git stash create ""` on a dirty tree | A sha, subject `On <b>: ` (empty label) — confirms the empty-label guard in D10 is a *validation* concern, not a git one |
| **M3** | `git update-ref refs/kira/globalstash/<sha> <sha>` inside a **linked worktree**, then `for-each-ref` from the main worktree | The entry is visible from both — confirms D9's cross-worktree claim (`refs/` lives in `commonDir`) |
| **M4** | Touch `refs/kira/globalstash/<sha>` and watch `repo.changed` | One debounced `refsChanged` — confirms no watcher change is needed (`classify`'s first rule) |
| **M5** | `git log --exclude='refs/stash' --exclude='refs/kira/*' --all` in a repo with both | Neither namespace's commits appear; ordinary history unchanged (D15) |

### 0.2 Scope

1. **`internal/gitops/stash.go`** (edited) — `:(literal)` pathspec hardening (D14); `AutoStashMessage`; `GlobalStashRef`/`GlobalStashRefPrefix`; `StashCreateArgs`; `GlobalStashSetArgs`/`GlobalStashDeleteArgs`/`GlobalStashListRefsArgs`; `StashBranchByShaArgs`.
2. **`internal/gitclient/porcelain/stash.go`** (edited) — `GlobalStashFormat`, `GlobalStashLogArgs`, and one shared record-walk extracted out of `ParseStashList` so `ParseGlobalStashList` reuses it verbatim.
3. **`internal/gitclient/porcelain/log.go`** (edited) — `RevSetArgs` gains two `--exclude` emissions (D15).
4. **`internal/gitpreflight/checkout.go`** (edited) — two new routes, `"autoStash"` and `"detachHere"` (D2/D6). Pure.
5. **`internal/gitpreflight/worktree.go`** (edited) — `WorktreeAddPreflight.Routes`, one member, `"detachHere"` (D7). Pure.
6. **`internal/gitsession/stash.go`** (edited) — `GlobalStashList`, `resolveStashEntryScoped`, the global half of the resolve.
7. **`internal/gitsession/preflight.go`** (edited) — `PreflightStashPop`/`PreflightStashBranch` gain a `scope`; `PreflightCheckout` unchanged except that `ClassifyCheckout` now returns the new routes.
8. **`internal/gitsession/ops.go`** (edited) — `prepareCheckout` gains the auto-stash arm; two new `opTable` entries (`globalStashSave`, `globalStashRemove`); `captureGlobalStashRemoveUndo`; `OpRequest` gains `AutoStash`/`Label`/`Scope`.
9. **`internal/gitrpc`** — one new handler (`globalStash.list`), three widened param types, `ContractVersion` 29 → **30**.
10. **`internal/storage/model` + `internal/gitrpc/wire.go`** — one new settings leaf, `kiraVersion.checkout.autoStash`. **No SQL migration.**
11. **`packages/git-ipc`** — `CONTRACT_VERSION = 30`; `StashEntry` widened; two `OpRequest` kinds; one `OpRequest` field; two `CheckoutPreflight` routes; `WorktreeAddPreflight.routes`; one `OpErrorKind`; one `UiActionKind`; one request.
12. **`packages/git-core/src/settings/schema.ts`** — one new `source: 'repo'` leaf.
13. **`packages/git-ui`** — `components/stashListModel.ts` (new, pure), `GlobalStashList.vue` (new), `StashList.vue`/`StashDetailPane.vue`/`BranchPicker.vue`/`StashDialog.vue`/`CheckoutDialog.vue`/`rowMenuModel.ts`/`state/stash.ts`/`state/ops.ts`/`liveAnnouncements.ts`/`App.vue`/theme tokens (edited).
14. **`apps/kira-studio-vscode`** — two `MUTATING_COMMANDS` entries, two `contributes.commands`, `commands.test.ts` counts.

### 0.3 Not in this phase

See §8 for the full argued list. Headline exclusions: **no auto-pop of the auto-stash onto the new branch** (D1 — that is G17's `stashAndCarry` route, which stays exactly as it is); **no renaming a global entry** (P23 records the mechanism, §9 prices it); **no path-scoped auto-stash** (D4 — it cannot honour the "never blocks" guarantee); **no cross-repository/cross-clone sharing of the global bucket**; **no expiry, quota or reaper for the global bucket**; **no new `merge-tree` prediction code of any kind** (F2 — the existing one is already correct for cross-branch); **no auto-detach for anything but an explicit user checkout / worktree add**; **no `docs/v1.3/SPEC.md` edit**.

### 0.4 Ground rules

- **The auto-stash's promise is "never blocks", and only a whole-tree `stash push -u` actually delivers it.** Every design choice that would weaken that guarantee to "usually doesn't block" is rejected by name (D4).
- **Nothing is ever silently destroyed.** Auto-stash *moves* work into an entry that is named, tagged with its origin branch, and one right-click from coming back. Auto-detach *moves HEAD*, and says so loudly. `globalStashSave` **copies**; it never drops its source (D10).
- **Storage that promises "keep this forever" must be durable against the tools the user already runs.** P7 is why the obvious design is rejected; P8 is why the chosen one is not (D8).
- **Every git failure is classified from stderr text, never from an exit code** — with the two documented exceptions this codebase already has (`reclassifyStashPop`'s post-write status read, `stashPositionMismatch`'s pre-write verify), both of which G28 reuses rather than duplicating.
- `AGENTS.md` in full: no stubbed error handling, no skipped validation, named constants, table tests.

---

## 1. Findings

### F1 — Origin-branch tracking already exists end to end on the server, and is rendered nowhere

`porcelain.parseBranchFromMessage` parses git's own `WIP on <b>: ` / `On <b>: ` reflog-subject prefix (P3), maps `(no branch)` to `nil`, and populates `StashEntry.Branch`. It crosses the wire as `branch: string | null` and has since contract version 21. **G17's own §10.4 explicitly recommended showing it**, on the belief that `StashList.vue` "was already built to expect the field". It was not, or it stopped being: a grep of `StashList.vue`, `StashDetailPane.vue` and `state/stash.ts` finds no reference to `entry.branch` at all. So SPEC's *"the stash list shows each entry's origin branch"* is a **pure UI addition over data that has been on the wire for eleven phases** — no parser change, no wire change, no spawn.

### F2 — Cross-branch apply already works, prediction included; the SPEC row's assumption does not hold

Three independent facts:

- `PreflightStashPop(ctx, sha, targetSha *string)` defaults `target` to `rev-parse HEAD` — *whatever is checked out now*, not the stash's origin.
- `stashPopPrediction` is `MergeTreeArgs(target, entry.Sha, entry.BaseSha)` — the merge base is pinned to **the stash's own base** (G17 probe 2's finding), which is exactly what makes the prediction correct against an *arbitrary* target rather than only the origin branch.
- `StashApplyArgs(sha, restoreIndex)` addresses by raw sha (G17 probe 8); only `pop`/`drop`/`branch` need `stash@{N}`, and `stashApply` therefore has no positional assumption at all.

P19 and P20 confirm both directions empirically against a real two-branch fixture: the clean case is predicted clean and applies clean; the conflicting case is predicted `conflicts` with the right paths, and the actual apply fails with **everything on stdout and an empty stderr**, keeping the entry — byte-for-byte the same shape G17's own probe 5 recorded for a same-branch pop, and therefore already handled by `reclassifyStashPop`.

**So SPEC's third open question resolves negatively: there is no new cross-apply RPC, and the G17 prediction needs no generalising.** What is missing is entirely presentational: the user cannot *see* which branch an entry came from (F1), the row menu does not distinguish "apply here" from "apply back home", and the confirmation dialog does not name the two branches. This is the same shape of answer G27 reached when it checked SPEC's own instruction against a probe and found it did not hold.

### F3 — The auto-stash this row asks for is neither of the two auto-stash mechanisms already in the tree

| Mechanism | Trigger | Pops back? | Origin tag? | Where |
|---|---|---|---|---|
| **Pull autostash** (upstream P8/P9, ported) | a dirty tree blocking a non-fast-forward pull | **Yes**, immediately | No | `gitpreflight/pull.go`'s `RouteStashAndCarry`; `ops.ts:1237` |
| **Checkout `stashAndCarry`** (G17 D8) | user picks it from `CheckoutDialog` when blocked | **Yes**, if predicted clean | No | `ClassifyCheckout`'s `"stashAndCarry"` route; `ops.ts:340-352` |
| **G28 auto-stash** (this phase) | *any* dirty-tree-blocked checkout, by default, no dialog | **No** (D1) | **Yes** | new `"autoStash"` route |

The first two are "carry my work across the boundary". The third is "get my work out of the way, tagged, so I can bring it back deliberately — possibly onto a different branch than it came from". They coexist; none replaces another.

### F4 — SPEC's own wording proves the auto-stash must not pop back

Read the row's four sentences as one: *"…they're stashed automatically, **tagged with the branch they came from**"*, then *"**Cross-branch apply**: the stash list shows each entry's origin branch, and a stash from a different branch can be applied to the branch currently checked out … (**not just onto the branch it came from**)"*, then *"merge-tree pop prediction (G17) applies here too, since **a cross-branch apply is exactly the case most likely to conflict**."*

If the auto-stash popped back onto the new branch, the entry would not exist afterwards, so there would be nothing to tag with an origin branch, nothing for the stash list to display an origin branch *for*, and no "stash from a different branch" to right-click. The three bullets are only mutually coherent under the non-popping reading. Independently: the popping variant **already exists and already ships** (F3, row 2), so reading G28's row as the popping variant would make the phase's headline deliverable a re-implementation of G17 D8. The reading is settled.

The user-facing consequence, stated honestly rather than hidden: after an auto-stashed switch the working tree is clean on the new branch, and the announcement must say **where the work went** in the same breath as saying the switch happened (D16).

### F5 — `stash push -u` is the only argv that clears every dirty-tree checkout blocker

`ClassifyCheckout` emits two dirty blockers: `blockedByTracked` (D ∩ T, tracked) and `blockedByUntracked` (D ∩ T, untracked). `--discard-changes` **cannot** clear the untracked one — G5's probe P9 is why `routes` is empty whenever an untracked block is present (`checkout.go:116-122`). P15 shows `stash push -u` clears **both** in one argv, after which the switch succeeds. This is what makes "uncommitted changes never block a branch switch" a guarantee rather than a best effort, and it is the reason D4 rejects path-scoped stashing.

### F6 — `opTable`'s multi-argv `prepared` already expresses "stash, then switch" atomically

`RunOp` runs `prep.argvList` in order under `e.Repo.Write`, stopping at the first classified failure and reading back head/in-progress on every exit path (`ops.go:804-830`). `prepareBranchCreate` already returns two argv. So auto-stash needs **no new executor** — the contrast with G26 F7 is exact and worth naming: G26 needed its own executor because a value (each child's new base) only existed *after* an earlier argv ran; nothing in auto-stash does. Doing it as one server-side op rather than the client-side two-request sequence `#stashAndCarry` uses also closes a real hole: a client that disconnects between the two requests today leaves the tree stashed and the checkout never attempted.

### F7 — Auto-detach is two lines of pre-flight plus a client re-issue

`gitops.SwitchDetachArgs` exists. `OpRequest.checkout` already carries `mode: 'switch' | 'detach'`, and `prepareCheckout` already routes `mode == "detach"` to `SwitchDetachArgs` (`ops.go:263-266`). P14 confirms `git switch --detach <b>` succeeds on a branch held by another worktree where plain `switch` fails with exit 128. So the *entire* auto-detach feature is: `ClassifyCheckout` adds a `"detachHere"` route when the sole blocker is `worktreeConflict`; the client re-issues the same `checkout` op with `mode: 'detach'`. **This is genuinely small** — as the SPEC row's own framing suspected — and it closes G25 §9's explicitly named hand-forward, which also asks for the `worktree add` analogue (D7).

### F8 — SPEC's "pop-once" claim is imprecise, and the accurate deficiency is a better argument anyway

P1: `git stash apply` does not drop. Reuse is already possible on the ordinary stack. The accurate case for a separate bucket is:

1. **`stash@{N}` positions shift under every push, pop and drop.** G17 shipped `stashPositionMismatch` precisely because that is a live correctness hazard; `stashPop`/`stashDrop`/`stashBranch` are all position-addressed by necessity (G17 probe 8).
2. **This phase multiplies the churn.** Every unblocked checkout now pushes an entry onto that same list. A "keep and reuse" entry created in week one is buried under twenty auto-stashes by week two.
3. **The stack's affordances are pop-shaped.** `Pop` and `Drop` sit in the same row menu as `Apply`; a keep-forever entry is one mis-click from gone, and `stashDrop`'s undo is a single slot cleared by the very next operation.
4. **Nothing marks an entry as "not part of the queue."** The reflog has no room for it.

That is a sufficient and *true* justification for a separate bucket, and it is what this plan states.

### F9 — A reflog-backed custom namespace is not durable, and `refs/stash`'s own safety does not transfer

P6 shows the reflog shape works beautifully — `git log -g --format=<StashFormat>` reads a custom namespace back in *exactly* `stash list`'s framing, `%gd` and all. P7 shows it is unusable: with `gc.reflogExpire=now`, `git reflog expire --all` leaves `refs/stash` completely intact — git hard-codes an expiry of `never` for it — and **wipes the custom ref's reflog to nothing**, tip entry included. Under real defaults (`gc.reflogExpire` 90 days, `gc.reflogExpireUnreachable` 30 days) that is a quiet, delayed, total data loss for exactly the entries the feature promises to keep. Depending on writing `gc.refs/kira/globalstash.reflogExpire=never` into every clone's config (P24) to prevent it would make the durability of the user's saved work contingent on a config line any `git config --unset`, fresh clone, or hand edit removes.

### F10 — One ref per entry is durable by construction, and needs nothing else

P8: `refs/kira/globalstash/<sha>` survives `git reflog expire --expire=now --expire-unreachable=now --all` **and** `git gc --prune=now --aggressive`, with `git fsck` clean afterwards. That is not a policy, it is the definition of a gc root. P10 adds that delete is `update-ref -d` (exit 0 even when absent — hence D11's existence check), that re-creating is the exact inverse (making removal genuinely undoable), and that creating an identical entry twice is idempotent. P9 records the one constraint: the directory form and a single-ref form cannot coexist, so the shape must be chosen once — it is.

### F11 — The global bucket needs no SQLite for either half

SPEC asks whether this is "more like commit content" or "more like metadata". It is both, and git already stores both:

| Field | Source | Spawn |
|---|---|---|
| tracked + index + untracked content | the stash commit's own three parents/trees | — |
| origin branch | `parseBranchFromMessage(subject)` — `On <b>: <label>` | — |
| label | the same subject, after the prefix | — |
| created at | the commit's author date | — |
| file count | `--numstat` against the first parent (P12) | shared |
| identity / durability | the ref name | `for-each-ref` |

So the *only* thing SQLite could add is a second, divergent copy. And it would be a **worse** copy: `git_repo_settings.repo_id` is a **worktree root** (G26 F3's finding, still true), so a global stash saved in the main worktree would be invisible from a linked one — while `refs/` lives in `commonDir` and is shared by every worktree of the repository (M3 confirms). This is G26 D1's argument, transposed, and it lands the same way.

### F12 — `git log --all` sweeps any new ref namespace into the graph walk

P11: `git log --all` lists **every** ref under `refs/`, `refs/kira/**` included. `porcelain.RevSetArgs` is shared by the paged walk, the remaining-count query and G23's tail scan (`log.go:32-36`'s own doc comment insists all three agree), so without an exclusion, every global-stash entry — and every helper commit hanging off it — would appear as graph rows in all three. `--exclude='refs/kira/*'` placed **before** `--all` removes them, and is a harmless no-op when nothing matches.

### F13 — `kiraVersion.stash.showInGraph` is inert, and this phase makes its inertness worse

The setting is stored (`git_repo_settings`), crosses the wire (`RepoSettingsSnapshot.StashShowInGraph`), is rendered in G18's dialog, defaults to `true`, and **reaches no walk argv anywhere**. Meanwhile `--all` puts `refs/stash` into the graph unconditionally (P11), so the *observed* behaviour happens to match `true`. G17 §9 handed the wiring forward and no phase has claimed it. G28 pushes far more entries onto `refs/stash` than any prior phase, so "off" becomes a thing users will actually want. D15 wires the **easy, decidable half only** — `showInGraph: false` ⇒ `--exclude=refs/stash` — which needs none of the row-filter architecture question G17 left open (that question only arises for `true`, whose behaviour is unchanged). Flagged in §10 as a deliberate, separable, out-of-row addition.

### F14 — `git stash create` cannot include untracked files, which bounds one of the two save paths

P5. A global entry created from the *current working tree* without disturbing it is therefore tracked-only. A global entry created from an *existing stash-stack entry* inherits that entry's full three-parent shape, `-u` half included, for free. D10 ships both paths and says which is which in the dialog, rather than pretending the limitation away. P21 records the alternative (`push -u` → `apply --index` back) and §8 explains why it is not taken.

### F15 — `stash push` during an in-progress operation fails in a way this codebase would classify `Unknown`

P17: exit 1, `f.txt: needs merge` on **stdout**, stderr **empty**. `ClassifyOpError` reads stderr only, so it would answer `Unknown` — a useless message on a path the user did not knowingly take. The remedy is not a new classifier row (there is no stderr to match): it is the host-side `statusAndInProgress` re-check `prepareReset`/`prepareCherryPick` already establish as this codebase's convention, run on the auto-stash arm before any argv is built (D3).

### F16 — Generated pathspecs are a live over-match hazard the moment anything populates `stashPush.paths`

P22: `git stash push -- 'x*.txt'` stashed **both** `x*.txt` and `xy.txt`. `gitops.StashPushArgs` passes `paths` through verbatim after `--`. Today all three client call sites pass `[]`, so the bug is latent. D14 hardens it with `:(literal)` (proven accepted, P22) regardless of whether this phase generates paths — two lines, one golden test, zero behaviour change today, and one fewer footgun for whoever wires path-scoped stashing later. This is also the phase's **only** contact with G27's tiering, and it lands on tier 2: a pathspec is a repository-relative path handed straight back to git, so it is **byte-exact, never NFC-normalized** (D18).

### F17 — Three totality guards will fail by design the moment this phase lands

`MUTATING_COMMANDS` (two missing keys ⇒ `tsc` error), `OP_ERROR_TEXT` (a missing `NothingToStash` phrase ⇒ `tsc` error), `REQUEST_KEY_MAP` (a missing `globalStash.list` ⇒ `tsc` error), plus `ops_test.go`'s hard-coded `20`/`6` counts and `commands.test.ts`'s two-direction cross-check. These are the safety net, not obstacles to route around.

---

## 2. Decisions

### The auto-stash

### D1 — The auto-stash creates an entry tagged with its **origin** branch and does **not** pop it onto the new branch

F4 is the argument in full. Concretely:

- The entry's message is `AutoStashMessage(target)` = `"auto-stash: switching to " + target`. Git itself prepends the origin branch: the reflog subject becomes `On <originBranch>: auto-stash: switching to <target>` (P3), which `parseBranchFromMessage` already turns into `StashEntry.Branch` with **no parser change** (F1).
- Nothing pops it. G17 D8's `stashAndCarry` route — which *does* push, switch, and pop back if predicted clean — **remains exactly as shipped** and remains reachable (D2 keeps it in `routes`). The two are different answers to different questions and both stay on the menu.
- The recovery path is cross-branch apply (D5), which is *strictly better* than G17's blind auto-pop: it is user-initiated, predicted, and works onto any branch rather than only the one the switch landed on.

**The one deliberate marker.** `AutoStashMessagePrefix = "auto-stash: "` is a named constant in `gitops`, used to build the message and (client-side, in `stashListModel.ts`) to render an "auto" badge on the row. A user could type it by hand; the consequence is a cosmetic badge, and the doc comment says so. No behaviour anywhere branches on it.

### D2 — `ClassifyCheckout` gains two routes; the classifier's verdict semantics do not change

```go
// routes, in order. The first two are G5/G17's, unchanged.
if len(trackedBlocked) > 0 && len(untrackedBlocked) == 0 {
    routes = append(routes, "discard")
    if in.StashAvailable { routes = append(routes, "stashAndCarry") }
}
// G28 D2: autoStash is the ONLY route that clears an untracked block (F5/P15), so unlike
// "discard"/"stashAndCarry" it is offered whenever EITHER dirty blocker is present.
if in.StashAvailable && in.InProgress == nil && (len(trackedBlocked) > 0 || len(untrackedBlocked) > 0) {
    routes = append(routes, "autoStash")
}
// G28 D6: offered only for a branch target the caller asked to SWITCH to — a tag/sha target
// already detaches, and an explicit detach request is already the thing this route would do.
if in.CheckedOutIn != nil && in.InProgress == nil && in.Mode == "switch" &&
   (in.Target.Kind == "branch" || in.Target.Kind == "remoteBranch") {
    routes = append(routes, "detachHere")
}
```

`verdict` stays `"blocked"` in both cases. That is deliberate: the classifier reports **what git would do**, and git would refuse. Whether the app routes around that refusal is *policy*, and policy lives in one client place (D16), not smuggled into a pure function that eight other call sites read. `ClassifyStashBranch`'s composed `CheckoutPreflight` (`preflight.go:675`) picks the new routes up for free and ignores them, exactly as it ignores `"discard"` today.

### D3 — `checkout` gains `autoStash: boolean`; the stash and the switch are two argv in one `prepared`

Wire:

```ts
| { readonly kind: 'checkout';
    readonly target: string;
    readonly mode: 'switch' | 'detach';
    readonly discardLocalChanges: boolean;
    /** G28 D3: prepend a whole-tree `stash push [-u]` tagged with the CURRENT branch, so the
     *  switch cannot be blocked by a dirty tree. Never popped back (D1). Mutually exclusive
     *  with `discardLocalChanges` — the server refuses both at once rather than guessing. */
    readonly autoStash: boolean }
```

`prepareCheckout`, when `op.AutoStash` is true, in this order:

1. **Refuse `autoStash && discardLocalChanges`** ⇒ `earlyError{Kind:"Unknown", Message:"Choose either discarding local changes or stashing them, not both."}`. No write.
2. **`statusAndInProgress` host-side** (F15/P17) ⇒ `inProgress != nil` ⇒ `earlyError{Kind:"OperationInProgress", …}`. No write. This is `prepareReset`/`prepareCherryPick`'s existing convention, applied for the same reason: a dialog can sit open arbitrarily long, and a pre-flight is advice, not a lock.
3. **Recompute the dirty split from that same status read** — never the client's claim. Nothing dirty ⇒ **omit the stash argv entirely** (P16 would otherwise print `No local changes to save` and produce a misleading announcement).
4. **Derive `-u` server-side**: `includeUntracked = any untracked dirty path exists`. The common case (tracked-only dirt) does **not** sweep untracked build output; the untracked-blocked case cannot block (F5).
5. `argvList = [ StashPushArgs(&msg, includeUntracked, false, nil), <the existing switch argv> ]`, where `msg = gitops.AutoStashMessage(resolved.Name)`.

Nothing else in `prepareCheckout` changes: the `willDetach` / `remoteBranch` / plain-branch arms are untouched, so `autoStash` composes with `mode: 'detach'` (the both-blockers case, D6) for free.

`checkout` stays a single `opTable` entry with `Undo: NotUndoable`; its reason text is widened to name the stash honestly:

> `"Switch back to the previous ref to undo this. Auto-stashed changes stay in the stash list, tagged with the branch they came from."`

### D4 — The auto-stash is **whole-tree**, not path-scoped

The tempting alternative — `stash push [-u] -- :(literal)<blocked paths>`, leaving `carried` changes in the tree — is rejected, and P22/P18 show it is *implementable*, so this is a design call rather than a capability limit:

| | Whole tree (chosen) | Scoped to blocked paths |
|---|---|---|
| Does the switch always then succeed? | **Yes** (P15) | **Not guaranteed** — our blocked set is `D ∩ T` computed from `status` + `diff --name-only`; git's own refusal set is computed independently and need only be a superset for the switch to fail *after* we have already moved the user's files |
| Files moved | all dirty | minimum |
| Pathspec hazard | none — no pathspec at all | needs `:(literal)` on every entry (F16) |
| "Never blocks" promise | delivered | downgraded to "usually" |

The first row decides it. A guarantee that can silently degrade into "we moved your work and then failed anyway" is worse than no guarantee. The scoped variant is recorded in §8 as a considered alternative, and D14 hardens the pathspec machinery anyway so that a later phase that wants it starts from a safe primitive.

### Cross-branch apply

### D5 — Cross-branch apply ships as **zero** new server plumbing and one new pure client model

F2. Concretely, what actually lands:

- **`packages/git-ui/src/components/stashListModel.ts`** (new, pure, table-tested):
  - `stashLabel(entry)` — strips git's own `WIP on <b>: ` / `On <b>: ` prefix so the row shows the user's text, not git's framing. (Today the raw subject is rendered, which is why every manual stash reads `On main: …`.)
  - `isAutoStash(entry)` — the `AutoStashMessagePrefix` badge (D1).
  - `originLabel(entry, currentBranch)` — `undefined` when the entry's origin *is* the current branch; otherwise the origin branch name, which is what turns the row into a visibly cross-branch one.
  - `applyMenuLabel(entry, currentBranch)` — `"Apply"` vs `"Apply here (from `main`)"`.
- **`StashList.vue`** renders an origin-branch chip whenever `originLabel` is set, plus the auto badge.
- **`rowMenuModel.ts`**'s `buildStashMenu(inProgress, entry, currentBranch)` uses `applyMenuLabel`, and **omits `Pop`** for a cross-branch entry — popping a stash from another branch drops it from the stack on success, which for the "I'll want this back on `main` later" case is a trap. Apply (which keeps, P1) is the correct verb across a branch boundary, and the menu says so instead of leaving both and hoping.
- **`StashDialog.vue`**'s apply/pop confirmation names both branches when they differ: *"Applying a stash from `main` onto `feature`."* above the existing prediction block.
- **`liveAnnouncements.ts`**'s `composeStashAnnouncement` gains the same "from `<origin>`" clause.

`preflight.stashPop`, `stashPopPrediction`, `ClassifyStashPop`, `StashApplyArgs`, `reclassifyStashPop` and `#runStashPopLike` are all **untouched**. §7.2 item 14 is a grep that proves it.

### Auto-detach

### D6 — Auto-detach on a worktree conflict: a `"detachHere"` route, re-issued client-side as `mode: 'detach'`

`ClassifyCheckout` emits the route (D2). `OpsState.runCheckout` (D16) takes it. `prepareCheckout` needs **no change at all** — `mode: 'detach'` already routes to `SwitchDetachArgs` (F7/P14).

**Why the decision lives client-side rather than the server rewriting `mode`.** Two reasons, both structural: this codebase's write path never rewrites what the caller asked for (a `checkout` that silently became a detach would make `OpResult.head` disagree with every log line and every test's expectation), and the client is the only place that can compose the announcement that makes the detach *visible* — which is the entire safety story for landing a user in a detached HEAD they did not ask for.

The announcement is mandatory and specific:

> `feature` is checked out in `/Users/…/wt-feature` — HEAD is now **detached** at its commit. Create a branch here, or switch to another branch, when you're done.

`HeadState` already reports `detached`, `AppToolbar` already renders it, and G5's existing detached-HEAD affordances are unchanged.

### D7 — `worktree add` gets the same route, closing G25's hand-forward

G25 §9 named this phase by name: *"G28 owns the 'already checked out elsewhere' auto-detach answer, applicable to `worktree add` too."* `WorktreeAddPreflight` gains a `Routes []string` field (its first), emitting `["detachHere"]` when the **only** blocker is `branchCheckedOutElsewhere`. `WorktreeDialog.vue` offers "Create it detached at that branch's commit", which re-issues the *existing* `worktreeAdd` op with `mode: 'detach'` and `startPoint: <branch>` — G25 already built that mode, and its `detachedHead` note already exists to explain it. **No new op kind, no new argv, no `-f`** — G25 §0.3 rules `worktree add -f` out by name and this route is precisely the safe alternative it pointed at.

Unlike checkout, this one is **offered, not automatic**: `worktree add` is an explicit creation act with a dialog already open, so there is a natural place to ask, and no "never blocks" promise to keep.

### The global bucket

### D8 — The global stash is **one git ref per entry** under `refs/kira/globalstash/<stashSha>`

```
refs/kira/globalstash/<40-hex stash-commit sha>  ->  that same stash commit
```

The ref name **is** the entry's identity, it is derived (not generated), it is hex (so no ref-name validation, no Unicode, no escaping), and saving identical content twice is idempotent (P10).

**Why this and not the alternatives, in full:**

| Option | Durable against `git gc` / `reflog expire`? | Deletable per entry? | Visible from a linked worktree? | Needs new storage? | Ordered/listable? |
|---|---|---|---|---|---|
| **`refs/kira/globalstash/<sha>`, one ref per entry (chosen)** | **Yes, by construction (P8)** — every ref is a gc root | **Yes** — `update-ref -d` (P10) | **Yes** — `refs/` is in `commonDir` (M3) | **No** | Yes — `for-each-ref` + `log --no-walk` (P12), newest first |
| `refs/kira/globalstash` single ref + reflog (mirroring `refs/stash`) | **No (P7)** — `refs/stash` is special-cased in git; a custom ref is not, and its whole reflog is wiped | Awkward — `reflog delete <ref>@{N}`, positional again | Yes | No | Yes, and the parser is free (P6) |
| Ordinary `refs/stash` entries "that we just never pop" | Yes | Yes | Yes | No | Yes — **but F8's four problems are exactly this option's problems** |
| `review.db` (G11, per-repo SQLite) | n/a | Yes | Yes | Yes — a blob store for file trees SQLite has no business holding | Yes |
| `kira.db` `git_repo_settings` | n/a | Yes | **No** — keyed on a *worktree root* (F11) | Yes | Yes |

P7 alone eliminates row 2; F11 eliminates rows 4 and 5; F8 eliminates row 3.

**Honest limitation, stated rather than hidden:** `refs/kira/**` is per-clone. A global stash does not follow a `git clone`, does not reach a second machine, and is not pushed anywhere (nothing in this app ever pushes a `refs/kira/*` refspec, and §8 records that as a non-goal). That is the correct scope — SPEC's own examples are *"a WIP experiment, a personal local tweak"* — and it matches G26 D1's identical trade for stack parents.

### D9 — The metadata rides on the commit; there is **no** SQLite, and no second source of truth

F11's table is the design. `globalStash.list` is **two spawns, and one when the bucket is empty**:

1. `git for-each-ref --format='%(objectname)' refs/kira/globalstash/` → the sha set. Empty output (exit 0, P10) ⇒ return `{entries: []}` and **stop**.
2. `git log --no-walk -m --first-parent -z --numstat -M -C --format=<GlobalStashFormat> <shas…>` → header + numstat records in **exactly `stash list`'s framing** (P12), newest first (`--no-walk` sorts by commit date descending).

```go
// GlobalStashFormat is StashFormat with %gd replaced by %H (there is no reflog selector for a
// namespace ref, P13) and %gs replaced by %s (the commit's own subject IS the message here,
// because stash create / commit-tree wrote it, P4/P23). Field count and order are otherwise
// identical, so ParseStashList's own record walk is reused verbatim.
const GlobalStashFormat = "%H%x1f%H%x1f%P%x1f%s%x1f%at"
```

`ParseStashList`'s body is refactored **once**, without behaviour change, into a shared `parseStashRecords(recs, isHeader func([]byte) bool, indexOf func(string) (int, error), scope string, subjects map[string]string)`; `ParseStashList` and the new `ParseGlobalStashList` become thin wrappers over it. `isHeader` is `HasPrefix("stash@{")` for the stack and "is 40 hex bytes" for the bucket — unambiguous against a numstat record, which begins with `\n` or a digit-tab. The existing golden corpus for `ParseStashList` is untouched and must still pass byte-for-byte.

`baseSubject` reuses `StashBaseSubjectArgs`' existing batch spawn (a third spawn, only when the bucket is non-empty and only for distinct base shas), exactly as `StashList` already does.

**Uncached**, matching `StashList`'s own documented reason: every mutating global-stash op re-reads it immediately before acting as its own race guard. The bucket is small by nature; a repository with none costs exactly one `for-each-ref`.

### D10 — `globalStashSave`: an ordinary `opTable` kind, two sources, **never** dropping its source

```ts
| { readonly kind: 'globalStashSave';
    /** The entry's name. Non-empty, single-line — validated host-side (a newline would corrupt
     *  the reflog subject line every reader of this bucket parses). */
    readonly label: string;
    /** `undefined` ⇒ snapshot the CURRENT working tree (tracked changes only, F14/P5).
     *  Otherwise the sha of an existing stash-stack or global entry to copy. */
    readonly sha: string | undefined }
```

`prepareGlobalStashSave`, in order:

1. Validate `label`: non-empty after trim, no `\n`/`\r` ⇒ else `earlyError{Kind:"Unknown", …}` naming the rule.
2. **Source = working tree** (`sha == nil`): `git stash create <label>` through `runOne` — a read-pool spawn that writes only loose objects and touches no ref, index or worktree (P4); the same latitude `stashPopPrediction`'s `merge-tree --write-tree` already takes. Empty output ⇒ `earlyError{Kind:"NothingToStash", Message:"There are no local changes to save."}`. No write.
3. **Source = an existing entry** (`sha != nil`): resolve it fresh through `resolveStashEntryScoped` (D12) across **both** buckets ⇒ `ErrStashNotFound` if absent. Read its tree and parent list, then `git commit-tree <tree> -p… -m "On <sourceOriginBranch|(no branch)>: <label>"` (P23) — which **preserves the source's own origin-branch tag** rather than re-stamping it with whatever is checked out now, and preserves the `-u` third parent when the source had one.
4. `argvList = [ ["update-ref", "refs/kira/globalstash/<newSha>", "<newSha>"] ]` — one argv, idempotent (P10).

**`Undo: NotUndoable`**, reason `"Remove it from the global stash to undo this."` — `branchCreate`/`worktreeAdd`'s exact precedent, and honest: the inverse *is* `globalStashRemove`, which is one click away and itself undoable.

**No `dropSource` flag, no move semantics.** Save always copies. The source stash entry stays in the stack until the user drops it with the existing, already-undoable `Drop` action. This removes an entire class of "where did my stash go" and keeps every op in this phase individually reversible.

### D11 — `globalStashRemove`: the cleanest undo in the whole `opTable`

```ts
| { readonly kind: 'globalStashRemove'; readonly sha: string }
```

`prepareGlobalStashRemove`:

1. `git for-each-ref --format='%(objectname)' refs/kira/globalstash/<sha>` ⇒ empty ⇒ `earlyError{Kind:"NotFound", …}`. **Required**, because `update-ref -d` on an absent ref exits 0 silently (P10) and would otherwise report a successful removal of nothing.
2. Undo record captured before the write: `Label: "Removed global stash: " + label`, `RecoverySha: sha`, `Replay: [["update-ref", "refs/kira/globalstash/"+sha, sha]]`.
3. `argvList = [ ["update-ref", "-d", "refs/kira/globalstash/"+sha, sha] ]` — the expected-old-value form, so a concurrent change refuses rather than clobbers.

`Undo: Undoable`. The replay is *exact* — same ref, same object, no reordering, no positional ambiguity — which is more than any other undoable kind in this table can say. `UndoRun`'s existing `cat-file` recovery-sha check covers the one honest failure mode (the commit was gc'd after the ref was deleted and before the undo).

This makes `opTable` **22 entries, 7 undoable**.

### D12 — Both stash pre-flights, `stash.show`, and the resolve become scope-aware; nothing else does

```go
// resolveStashEntryScoped is resolveStashEntry, widened by one parameter. "stack" reads
// StashList (unchanged); "global" reads GlobalStashList; "" behaves as "stack" so every
// pre-G28 caller and every pre-G28 wire message keeps its exact meaning.
func (e *RepoEntry) resolveStashEntryScoped(ctx context.Context, sha, scope string) (porcelain.StashEntry, error)
```

`PreflightStashPop(ctx, sha, targetSha *string, scope string)` and `PreflightStashBranch(ctx, sha, branch, scope string)` pass it through; **everything downstream is untouched** — `ClassifyStashPop`, `stashPopPrediction`, the untracked-collision `os.Stat` loop, `ClassifyStashBranch` and its composed `CheckoutPreflight` all take a `porcelain.StashEntry` and do not care where it came from.

`StashShow(ctx, sha, scope)` likewise, so the existing `StashDetailPane.vue` renders a global entry's file tree with no change at all.

`prepareStashApply` needs **no** change: it builds `stash apply <raw sha>`, which works on a global entry verbatim (P4/P23 both applied successfully from outside `refs/stash`). `prepareStashBranch` gets one arm: for `scope == "global"` it skips `stashPositionMismatch` (there is no position) and uses a new `StashBranchByShaArgs(name, sha)` — G17 probe 8's "given a raw sha, `stash branch` applies but silently never drops" is precisely the desired behaviour for a keep-forever entry, and the doc comment says so.

`stashPop` and `stashDrop` are **never offered** for a global entry — they are position-addressed by necessity and the bucket has no positions. `buildGlobalStashMenu` simply does not contain them (D13).

### D13 — The UI: a sixth `BranchPicker` section, one shared pure model, one extended state class

- **`state/stash.ts`** gains `globalEntries: ShallowRef<readonly StashEntry[]>` and `reloadGlobal()`, subscribed to the same `repo.changed`/`refsChanged` signal the stack list already uses (a `refs/kira/**` write fires it — `classify`'s first rule, M4). `selected` searches **both** lists, so `StashDetailPane.vue` needs **zero** changes: it already renders whatever `selected` is, and `#requestShow` simply passes `entry.scope` through.
- **`components/GlobalStashList.vue`** (new) — `StashList.vue`'s structure, with `stash@{N}` replaced by the origin-branch chip and the label, and a header **"Save to global stash…"** button. Row menu: *Apply here*, *Create branch from this…*, *Show changes*, *Remove from global stash*. No Pop, no Drop.
- **`components/StashList.vue`** (edited) — origin chip, auto badge, `stashLabel` (D5).
- **`dialogs/StashDialog.vue`** (edited) — a fourth mode, *save to global stash*: a label field, a source radio (**this working tree** — with the tracked-only note from F14 spelled out when untracked files exist — or **this stash entry**, pre-selected when opened from a stack row), and the existing dialog chrome.
- **`dialogs/CheckoutDialog.vue`** (edited) — unchanged for the routes it already knows; it is simply reached less often, because D16 resolves the two new routes without opening it.

### D14 — `StashPushArgs` hardens its pathspec with `:(literal)`

F16/P22. `paths` are emitted as `":(literal)" + p`. Two lines, one golden argv test, **zero behaviour change today** (every current caller passes `[]`), and it removes a real over-match bug from the one primitive a future path-scoped stash would build on. G27 tier 2 applies unchanged: the path bytes themselves are **not** normalized (D18).

### D15 — `RevSetArgs` excludes `refs/kira/*` always, and `refs/stash` when `showInGraph` is off

```go
func RevSetArgs(spec WalkSpec) []string {
    var args []string
    switch {
    case spec.Range != nil: args = append(args, RangeToken(*spec.Range))
    case spec.Scope == "head": args = append(args, "HEAD")
    default:
        // G28 D15/probe P11: `--all` lists EVERY ref under refs/, this app's own namespace
        // included, and --exclude must precede the --all it modifies.
        args = append(args, "--exclude=refs/kira/*")
        if spec.ExcludeStash { args = append(args, "--exclude=refs/stash") }
        args = append(args, "--all")
    }
    if spec.IncludeStash { args = append(args, spec.StashShas...) }
    return args
}
```

`WalkSpec.ExcludeStash` is populated in `gitrpc/graph.go` from `entry.RepoSettings().StashShowInGraph == false` — a **server-side** read, so **no wire change**. `gitsession/walk.go`'s cache-key comparison gains the field, so flipping the setting re-opens the walk on the next `graph.stream`.

Two things this deliberately does **not** do: it does not change behaviour when `showInGraph` is `true` (today's de-facto behaviour, and the half whose row-filter architecture G17 §9 left genuinely undecided), and it does not touch `stashRows.ts`. It wires the decidable half of a setting that has shipped inert since G18, on a phase that multiplies the number of `refs/stash` entries. Flagged in §10.6 as separable.

### D16 — The routing policy lives in exactly one client method

`OpsState.runCheckout`, after the pre-flight, when `verdict === 'blocked'`:

```
inProgressOperation among blockers?          -> dialog (unchanged; neither route is offered)
routes has 'detachHere' and 'autoStash'?     -> re-issue { mode:'detach', autoStash:true }
routes has 'detachHere' only?                -> re-issue { mode:'detach', autoStash:false }
routes has 'autoStash' and autoStash setting -> re-issue { mode, autoStash:true }
otherwise                                    -> dialog (discard / stashAndCarry / cancel), unchanged
```

`kiraVersion.checkout.autoStash` (new, `source: 'repo'`, default `true`) is the one switch. It is read **client-side only** — the server never consults it, so a stale or absent value can only ever produce the old dialog, never an unexpected write. That is the fail-safe direction, and it keeps the server free of viewer policy exactly as SPEC's "Settings ownership" section intends for a per-viewer choice.

Announcements (`liveAnnouncements.ts`, all composed from data the client already has — no new `OpResult` field):

- auto-stash: `"Stashed 3 files from main and switched to feature — the stash is tagged main; apply it back from the stash list."`
- auto-detach: D6's text.
- both: the two sentences, in that order.

### D17 — `CONTRACT_VERSION` 29 → **30**

Stated plainly so no later phase claims 30 blind: **this phase's own additions produce `CONTRACT_VERSION = 30` / `ContractVersion = 30`.**

| Addition | Count | Detail |
|---|---|---|
| Requests | **1** | `globalStash.list` → `{ entries: readonly StashEntry[] }` |
| Requests with widened params | **3** | `stash.show`, `preflight.stashPop`, `preflight.stashBranch` each gain `scope?: 'stack' \| 'global'` (absent ⇒ `'stack'`) |
| Events / streams / capabilities | **0** | — |
| New wire interfaces | **0** | The bucket reuses `StashEntry` (D12) |
| Changed wire types | **4** | `StashEntry` (+`scope`, +`ref`; `index` doc widened to `-1` for a global entry); `CheckoutPreflight.routes` (+`'autoStash'`, +`'detachHere'`); `WorktreeAddPreflight` (+`routes`); `OpRequest.checkout` (+`autoStash`) |
| `OpRequest` kinds | **+2** | `globalStashSave`, `globalStashRemove` → 24 kinds, 22 served |
| `OpErrorKind` members | **+1** | `NothingToStash` |
| `UiActionKind` members | **+1** | `saveGlobalStash` |
| `RepoSettingsSnapshot` leaves | **+1** | `kiraVersion.checkout.autoStash` (boolean, default `true`) |
| SQL migrations | **0** | `git_repo_settings` is `(repo_id, key)` key-value |

`REQUEST_KEY_MAP` gains one entry; `EVENT_KEY_MAP` and `STREAM_KEY_MAP` are untouched. All new/changed requests are **Go-served** — none is an extension-answered `editor.*`-shaped method.

**On the `index: -1` sentinel.** A global entry has no stack position, and `StashEntry.index` becomes `-1` for it. The alternative — a parallel `GlobalStashEntry` interface — was rejected because it would fork `StashDetailPane.vue`, `stash.show`, `PreflightStashPop`, `ClassifyStashPop`, `StashPopPreflight` and every announcement helper for one field's worth of real difference. One discriminated type with a `scope` field and per-kind-optional data is this codebase's own established convention (`CheckoutBlocker`, `WorktreeAddBlocker`, `RefRow`), and the sentinel is guarded structurally: `stashPositionMismatch` is reached only by `stashPop`/`stashDrop`/`stashBranch`, and D13's global row menu offers none of the first two while D12 gives the third a sha-addressed arm.

### D18 — G27's tiering: **no new path-bearing wire field**, and one existing path parameter hardened at tier 2

Stated explicitly because the task asks for it, and because "no" needs to be a checked answer rather than an assumption:

| Thing G28 touches | G27 tier | Treatment |
|---|---|---|
| `refs/kira/globalstash/<sha>` | n/a — 40 hex bytes | Never normalized; cannot contain non-ASCII |
| `StashEntry.branch` (origin branch) | ref name | **Byte-exact**, per G27 §8's explicit non-goal ("normalizing branch names… has exactly P7's failure mode") |
| The global entry's **label** | display text | **Not normalized** — G27 §8's "commit messages, author names, or any display text" rule; it is never compared for equality |
| `StashPushArgs`' `paths` (D14) | **tier 2** — repository-relative, handed back to git as a pathspec | **Never normalized**; additionally `:(literal)`-guarded |
| `WorktreeAddPreflight.routes`, `CheckoutPreflight.routes` | enums | n/a |
| `repoWorkingDir(e.Summary)` (already used by `PreflightStashPop`'s `os.Stat` loop) | tier 1 | Already NFC by G27 D5a — unchanged |

**Net: this phase introduces zero new path-bearing wire fields, and its one contact with the tiering makes an existing tier-2 parameter safer without normalizing it.**

---

## 3. The Go side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 3.1 | `internal/gitops/stash.go` | edited | `AutoStashMessagePrefix`/`AutoStashMessage(target)`; `:(literal)` in `StashPushArgs` (D14); `StashCreateArgs(label)`; `GlobalStashRefPrefix`/`GlobalStashRef(sha)`; `GlobalStashSetArgs`/`GlobalStashDeleteArgs`/`GlobalStashRefExistsArgs`/`GlobalStashListRefsArgs`; `CommitTreeArgs(tree, parents, message)`; `StashBranchByShaArgs(name, sha)` — each with its probe citation |
| 3.2 | `internal/gitops/stash_test.go` | edited | Byte-exact argv goldens for all nine, including that every generated pathspec carries `:(literal)`, that `GlobalStashDeleteArgs` passes the expected-old-value (P10), and that `AutoStashMessage` has no newline |
| 3.3 | `internal/gitclient/porcelain/stash.go` | edited | `GlobalStashFormat`, `GlobalStashLogArgs(shas)`; `ParseStashList` refactored (no behaviour change) onto a shared `parseStashRecords`; `ParseGlobalStashList` as its second wrapper; `StashEntry` gains `Scope string` and `Ref string` |
| 3.4 | `internal/gitclient/porcelain/stash_test.go` | edited | The **existing golden corpus must pass byte-for-byte after the refactor** (the primary regression guard). New: the 40-hex header predicate; a 3-parent (`-u`) global entry; an untracked-only entry with zero numstat records; `Scope`/`Ref` population; a header-shaped path never mis-detected |
| 3.5 | `internal/gitclient/porcelain/log.go` | edited | `WalkSpec.ExcludeStash`; `RevSetArgs`' two `--exclude` emissions **before** `--all` (D15/P11) |
| 3.6 | `internal/gitclient/porcelain/log_test.go` | edited | Argv goldens: `scope:"all"` ⇒ `["--exclude=refs/kira/*","--all"]`; with `ExcludeStash` ⇒ three tokens in that exact order; `scope:"head"` and a range spec ⇒ **no** `--exclude` at all |
| 3.7 | `internal/gitpreflight/checkout.go` | edited | D2's two routes; `ClassifyCheckoutInput` unchanged (every input it needs is already there) |
| 3.8 | `internal/gitpreflight/checkout_test.go` | edited | Route table: tracked-only, untracked-only, both, in-progress-present (⇒ no `autoStash`), worktree conflict alone (⇒ `detachHere`), worktree conflict + dirty (⇒ both), `mode:"detach"` (⇒ no `detachHere`), tag/sha target (⇒ no `detachHere`), `StashAvailable:false` (⇒ neither) |
| 3.9 | `internal/gitpreflight/worktree.go` | edited | `WorktreeAddPreflight.Routes []string`; `["detachHere"]` iff `branchCheckedOutElsewhere` is the sole blocker (D7) |
| 3.10 | `internal/gitpreflight/worktree_test.go` | edited | Sole-blocker case ⇒ route; blocker plus `pathExists` ⇒ no route; `mode:"detach"` ⇒ no route; `Routes` is never `nil` |
| 3.11 | `internal/gitsession/stash.go` | edited | `GlobalStashList(ctx)` (D9, two-or-three spawns, one when empty); `resolveStashEntryScoped` (D12); `StashShow(ctx, sha, scope)` |
| 3.12 | `internal/gitsession/stash_test.go` | new | Zero `log` spawn for an empty bucket; scope routing (a global sha is not found in `"stack"` and vice versa); `Scope`/`Ref` round trip; `-1` index for global entries |
| 3.13 | `internal/gitsession/preflight.go` | edited | `PreflightStashPop`/`PreflightStashBranch` gain `scope`; **no other line changes** — the target-parameterisation F2 relies on is already there |
| 3.14 | `internal/gitsession/ops.go` | edited | `OpRequest` gains `AutoStash bool`, `Label string`, `Scope string`; `prepareCheckout`'s auto-stash arm (D3, five ordered steps); two new `opTable` entries; `prepareGlobalStashSave` (D10); `prepareGlobalStashRemove` + `captureGlobalStashRemoveUndo` (D11); `prepareStashBranch`'s global arm (D12); `checkout`'s widened `Undo.Reason`; the stale `"eighteen of OpRequest's twenty kinds"` doc comments at `:22-24` and `:133-137` corrected in the same commit that touches their neighbourhood (G17 D10 / G22 D11's own convention) |
| 3.15 | `internal/gitsession/ops_test.go` | edited | Counts 20 → **22**, undoable 6 → **7**; `TestOpTable_UndoableKindsAre…` renamed and widened; auto-stash `argvList` is exactly `[stash push…, switch…]` in that order; auto-stash on a clean tree emits **one** argv; auto-stash + `discardLocalChanges` refuses with **no** spawn; auto-stash with an in-progress op refuses with **no** spawn; `-u` present iff an untracked dirty path exists; `globalStashSave` on a clean tree answers `NothingToStash` with no write; `globalStashRemove` of an absent ref answers `NotFound` with no write; its undo replay is exactly one `update-ref` |
| 3.16 | `internal/gitsession/walk.go` | edited | `ExcludeStash` joins the spec comparison at `:78` (D15) |
| 3.17 | `internal/gitrpc/stash.go` | edited | `handleGlobalStashList`; `scope` threaded through the three existing handlers, validated against `{"", "stack", "global"}` ⇒ else `E_BAD_REQUEST` |
| 3.18 | `internal/gitrpc/{wire,handlers,contract,graph,settings}.go` | edited | One param type + one result type; one switch arm; `RepoSettingsSnapshot`/`RepoSettingsPatchWire` gain `CheckoutAutoStash`; `graph.go` populates `WalkSpec.ExcludeStash` from `RepoSettings()`; `ContractVersion` 29 → **30** with a dated bump comment |
| 3.19 | `internal/gitrpc/stash_test.go` | new | A `Router` over a counting fake runner: `globalStash.list` on an empty bucket spawns exactly one `for-each-ref` and no `log`; an unknown `scope` is `E_BAD_REQUEST` with no spawn; `preflight.stashPop` with `scope:"global"` resolves from the bucket |
| 3.20 | `internal/storage/model/gitreposettings.go` | edited | `CheckoutAutoStash bool` + `Patch` pointer + `DefaultGitRepoSettings()` `true`. **No migration** — `git_repo_settings` is key-value |
| 3.21 | Not edited | — | `gitclient/watcher.go` (`commonDir/refs/**` already covers `refs/kira/**`, M4); `gitpreflight/stash.go` (`ClassifyStashPop`/`ClassifyStashBranch` unchanged, F2/D12); `gitpreflight/pull.go` (**a different mechanism**, F3); `gitops/errors.go` (**no new stderr row** — every failure this phase can produce is already classified, or is refused host-side before it can happen); `gitwire/*`; `gitreview/*`; `internal/storage/migrations/*` |

---

## 4. The TypeScript / Vue side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 4.1 | `packages/git-ipc/src/contract.ts` | edited | D17's full table: `StashEntry` (+`scope`, +`ref`, `index` doc), `CheckoutPreflight.routes`, `WorktreeAddPreflight.routes`, `OpRequest.checkout.autoStash`, two `OpRequest` kinds, `NothingToStash`, `saveGlobalStash`, `globalStash.list`, `scope?` on three requests, the new settings leaf |
| 4.2 | `packages/git-ipc/src/validate.ts` | edited | `CONTRACT_VERSION = 30`; one `REQUEST_KEY_MAP` entry; the dated bump comment |
| 4.3 | `packages/git-core/src/settings/schema.ts` | edited | `kiraVersion.checkout.autoStash`, `boolean`, default `true`, `source: 'repo'`, with a description that names what it does *and* that the stash is tagged with the origin branch and never popped back |
| 4.4 | `packages/git-ui/src/components/stashListModel.ts` | new | Pure: `stashLabel`, `isAutoStash`, `originLabel`, `applyMenuLabel`, `globalRowModel` (D5/D13) |
| 4.5 | `packages/git-ui/src/components/stashListModel.test.ts` | new | Both subject prefixes and the `(no branch)` case; a label that itself contains `": "`; the auto prefix; `originLabel` `undefined` on a same-branch entry and set on a cross-branch one; a detached HEAD as `currentBranch` |
| 4.6 | `packages/git-ui/src/components/StashList.vue` | edited | Origin chip, auto badge, `stashLabel` in place of the raw subject |
| 4.7 | `packages/git-ui/src/components/GlobalStashList.vue` | new | The sixth `BranchPicker` section (D13) |
| 4.8 | `packages/git-ui/src/components/BranchPicker.vue` | edited | Mounts `GlobalStashList`, exactly as `WorktreeList` was mounted at G25 and `StackList` at G26 |
| 4.9 | `packages/git-ui/src/components/rowMenuModel.ts` | edited | `buildStashMenu(inProgress, entry, currentBranch)` — cross-branch apply label, Pop omitted across a branch boundary; new `buildGlobalStashMenu` |
| 4.10 | `packages/git-ui/src/components/rowMenuModel.test.ts` | edited | Pop present same-branch / absent cross-branch; the global menu never contains `stashPop` or `stashDrop` |
| 4.11 | `packages/git-ui/src/state/stash.ts` | edited | `globalEntries`, `reloadGlobal()`, `selected` searching both, `scope` threaded into `stash.show` |
| 4.12 | `packages/git-ui/src/state/stash.test.ts` | new | Both lists reload on one `refsChanged`; the stale-reply repo-switch guard; selecting a global entry requests `stash.show` with `scope:'global'` |
| 4.13 | `packages/git-ui/src/state/ops.ts` | edited | `runCheckout`'s route resolution (D16); `runGlobalStashSave`/`runGlobalStashRemove` as `#runSimple` one-liners; `scope` threaded into `#runStashPopLike`'s pre-flight and op; **`#stashAndCarry` untouched** |
| 4.14 | `packages/git-ui/src/state/liveAnnouncements.ts` | edited | `NothingToStash: 'there is nothing to save — the working tree is clean'`; `composeAutoStashAnnouncement`; `composeAutoDetachAnnouncement`; the "from `<origin>`" clause in `composeStashAnnouncement` |
| 4.15 | `packages/git-ui/src/components/dialogs/StashDialog.vue` | edited | The fourth mode (save to global stash, D13); the cross-branch sentence above the prediction block |
| 4.16 | `packages/git-ui/src/components/dialogs/WorktreeDialog.vue` | edited | The `detachHere` route button (D7), reusing G25's existing `detachedHead` note copy |
| 4.17 | `packages/git-ui/src/components/dialogs/CheckoutDialog.vue` | edited | Doc comment only — it now handles strictly fewer cases (D16); its Discard / Stash-and-carry / Cancel buttons are unchanged |
| 4.18 | `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` | edited | The new leaf renders from `SETTINGS` automatically; verify the schema-driven path needs no per-key code |
| 4.19 | `packages/git-ui/src/App.vue` | edited | Mount `GlobalStashList`'s dialog wiring; one new `runUiAction` case (`saveGlobalStash`) |
| 4.20 | `packages/git-ui/src/theme/vscode-tokens.css` | edited | `--kv-stash-origin-*` and `--kv-stash-auto-*` chips, light and dark |
| 4.21 | `apps/kira-studio-vscode/src/commands.ts` | edited | `MUTATING_COMMANDS` gains `globalStashSave` (`saveGlobalStash`) and `globalStashRemove` (`openBranchPicker`, matching the four stash siblings' precedent) — **32 entries** |
| 4.22 | `apps/kira-studio-vscode/src/commands.test.ts` | edited | Both directions against the widened `opTable`; the entry count |
| 4.23 | `apps/kira-studio-vscode/package.json` | edited | Two `contributes.commands` entries under `CATEGORY` |
| 4.24 | `apps/kira-studio-vscode/tests/unit/ipc/wireConformance.test.ts` | edited | Structural conformance for the widened `StashEntry`, `CheckoutPreflight`, `WorktreeAddPreflight` |
| 4.25 | Not edited | — | `packages/git-core/src/preflight/types.ts` (a legacy re-export; nothing in `git-ui` reads its `CheckoutPreflight`/`StashPopPreflight` — `@kira/git-ipc` is the wire authority, and G26 set the precedent of leaving it alone); `gitWire.fbs`; `codec.ts`; `git-core/search/*`; `review/*`; `StashDetailPane.vue` (D13 — it already renders whatever `selected` is) |

---

## 5. Dependencies and tooling

Nothing new. `git stash create`, `git commit-tree`, `git update-ref [-d]`, `git for-each-ref`, `git log --no-walk -m --first-parent`, `git log --exclude=<glob> --all`, `git switch --detach` and `:(literal)` pathspec magic are all ordinary git at or below the 2.38 floor. No new Go module, no new npm package, **no SQL migration**, no `flatc` regeneration, no watcher change.

---

## 6. Implementation order

1. **Probes M1–M5** against a scratch fixture, recorded in the commit message alongside P1–P24.
2. `gitops/stash.go` + `stash_test.go` — the argv layer, including D14's `:(literal)` hardening. **Independently green here.**
3. `porcelain/stash.go`'s **refactor only** (`parseStashRecords` extracted, `ParseStashList` a wrapper), with the existing golden corpus passing byte-for-byte and no other file touched. Its own reviewable commit.
4. `porcelain/stash.go`'s `GlobalStashFormat`/`ParseGlobalStashList` + tests.
5. `porcelain/log.go`'s `--exclude` emissions + argv goldens (D15's walk half).
6. `gitpreflight/checkout.go` + `worktree.go`'s routes + their table tests — pure, fully provable before any session wiring exists.
7. `gitsession/stash.go`'s `GlobalStashList`/`resolveStashEntryScoped`/`StashShow` + `preflight.go`'s scope threading + tests.
8. `gitsession/ops.go`'s **auto-stash arm** + `ops_test.go`'s auto-stash cases. Highest-risk code in the phase; its own commit.
9. `gitsession/ops.go`'s two global-stash kinds + undo capture + the `opTable` count updates.
10. `gitsession/walk.go` + `gitrpc/graph.go` — the `ExcludeStash` wiring (D15's settings half). Separable by design (§10.6).
11. `gitrpc`'s handler, param widening, settings leaf, `ContractVersion` 30, `stash_test.go`. Manual raw-socket smoke against a real fixture: a blocked checkout, a cross-branch apply, a global save/apply/remove/undo round trip.
12. `internal/storage/model` + `settings/schema.ts` — the new leaf, both sides.
13. `packages/git-ipc` + `validate.ts` — **expect `tsc` to break in `commands.ts` and `liveAnnouncements.ts`** (F17); fix them there.
14. `packages/git-ui`'s pure layer (`stashListModel.ts`, `state/stash.ts`) + tests.
15. `packages/git-ui`'s components and dialogs; `state/ops.ts`'s routing (D16); announcements; theme tokens.
16. The extension: `commands.ts`, `commands.test.ts`, `package.json`.
17. Full check pass.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` (chapter-scoped per SPEC's verification-scope note) passes, **including the pre-existing `ParseStashList` golden corpus byte-for-byte after step 3's refactor**.
2. `opTable` has **22** entries; exactly **7** are `Undoable`; every entry states a policy.
3. Argv goldens: `StashPushArgs` prefixes every path with `:(literal)`; `RevSetArgs` emits `--exclude=refs/kira/*` **before** `--all` for every `--all` scope and **never** for `head`/range; `GlobalStashDeleteArgs` passes the expected old value.
4. `ClassifyCheckout` emits `"autoStash"` for a tracked-only, an untracked-only and a both block; **never** with an in-progress operation; **never** with `StashAvailable:false`. It emits `"detachHere"` only for a `switch` to a branch/remote-branch target whose sole blocker is `worktreeConflict`.
5. `ClassifyWorktreeAdd` emits `["detachHere"]` iff `branchCheckedOutElsewhere` is the sole blocker; `Routes` is never `nil`.
6. Auto-stash `prepareCheckout` produces exactly `[stash push …, switch …]` in that order; exactly one argv on a clean tree; `-u` present iff an untracked dirty path exists; **zero** spawns for the both-flags refusal and for the in-progress refusal.
7. `globalStashSave` on a clean tree answers `NothingToStash` with no write; with a source sha it resolves across both buckets and refuses `ErrStashNotFound` otherwise; an empty or multi-line label refuses with no write.
8. `globalStashRemove` of an absent ref answers `NotFound` with **no** write; of a present one sets exactly one undo record whose `Replay` is a single `update-ref <ref> <sha>`.
9. `globalStash.list` on an empty bucket spawns exactly **one** `for-each-ref` and **no** `log` — proven by a `Router` over a counting fake runner that first drives `app.init`/`repo.open`/`refs.list`/`stash.list`.
10. `preflight.stashPop` with `scope:'global'` resolves from the bucket and produces a `StashPopPreflight` whose `targetSha` is the current HEAD.
11. A grep over the diff finds **no** change to `stashPopPrediction`, `ClassifyStashPop`, `StashApplyArgs`, `reclassifyStashPop`, or `#stashAndCarry` (F2/D5's claim, mechanised).
12. `bun run test:unit` passes, including `commands.test.ts`'s two-direction cross-check at **32** entries and `stashListModel.test.ts`'s prefix cases.
13. `bun run lint`, `bun run typecheck`, `bun run build:vscode`, `bun run test:webview` all pass.
14. `CONTRACT_VERSION` / `ContractVersion` both **30**; the contract diff matches D17's table exactly, with **zero** new wire interfaces.

### 7.2 Tier 2 — reasoned check

15. No code path anywhere reads global-stash state from SQLite, and no `git_repo_settings` key names a stash entry (D9's invariant).
16. Every `refs/kira/` string in the diff is built from `gitops.GlobalStashRefPrefix` — no hand-spelled ref path.
17. No code path drops a stash entry as a side effect of `globalStashSave` (D10's copy-never-move rule).
18. The diff contains no `--force`, no `worktree add -f`, and no push refspec naming `refs/kira/*` (§8).
19. Every generated pathspec in the diff is `:(literal)`-prefixed, and no repository-relative path is passed through `gitpath.NFC` (D18 / G27 tier 2).

### 7.3 Tier 3 — needs a human on a Mac with a real repository

20. Edit a tracked file that the target branch also changes, click a branch: **no dialog**; the switch happens; the stash list shows a new entry badged *auto*, chipped with the origin branch, and the announcement names both.
21. Switch back and *Apply* that entry from the stash list — the work returns; the entry is **still there**; Drop it deliberately.
22. Repeat with an **untracked** file that the target branch adds — the same, and the entry shows `-u`.
23. From a third branch, right-click a stash whose origin is another branch: the menu reads *Apply here (from `main`)* and offers **no Pop**; the confirmation names both branches; a genuinely conflicting one is predicted `conflicts` and, when run anyway, reports `StashConflict` and **keeps** the entry.
24. Create a linked worktree on `feature` (G25), then check out `feature` from the main worktree: **no hard error** — HEAD detaches at `feature`'s commit and the announcement says so and names the worktree path.
25. `worktree add` targeting that same branch offers *Create it detached at that branch's commit*, and it works.
26. Save a global stash from a dirty tree; the tree is **unchanged**; the entry appears in its own section with the label as typed. Apply it three times on three different branches — it survives all three.
27. Promote an existing `-u` stash entry into the bucket with a new label; the source stays in the stack; the promoted entry keeps its origin-branch tag and its untracked half.
28. Run `git gc --prune=now --aggressive` and `git reflog expire --expire-unreachable=now --all` in a terminal; every global entry is still listed and still applies (P8 in the real app — **the single most important tier-3 check in this phase**).
29. Remove a global entry, then Undo — it comes back at the same ref with the same content.
30. Turn `kiraVersion.checkout.autoStash` off in the settings dialog: the old `CheckoutDialog` returns, with Discard and Stash-and-carry unchanged.
31. Turn `kiraVersion.stash.showInGraph` off and refresh the graph: stash rows disappear; turn it on: they return. Global stash entries **never** appear in the graph either way.
32. Two windows on the same repo: an auto-stash in one appears in the other's stash list; a global save in one appears in the other's global section.

### 7.4 The checklist

- [ ] The auto-stash is created, tagged with its **origin** branch, and **never popped back**.
- [ ] `stash push -u` is used exactly when an untracked block exists, and the whole tree is stashed either way.
- [ ] The auto-stash arm re-checks in-progress and dirtiness host-side and refuses/skips before any argv.
- [ ] `autoStash` and `discardLocalChanges` are refused together, never merged.
- [ ] G17's `stashAndCarry` route and the pull autostash are both untouched and still reachable.
- [ ] Cross-branch apply added **zero** server plumbing; `stashPopPrediction` and `ClassifyStashPop` are byte-identical.
- [ ] `StashEntry.branch` is rendered — closing G17 §10.4's unfulfilled recommendation.
- [ ] Pop is not offered for a cross-branch or a global entry.
- [ ] Auto-detach is one route plus a client re-issue; `prepareCheckout` gained no detach code.
- [ ] The global bucket is `refs/kira/globalstash/<sha>`, one ref per entry, no reflog, no SQLite.
- [ ] `globalStashSave` copies and never drops; `globalStashRemove` is undoable with an exact one-argv replay.
- [ ] `RevSetArgs` excludes `refs/kira/*` before `--all`, always.
- [ ] `opTable` has 22 entries, 7 undoable; `MUTATING_COMMANDS` has 32.
- [ ] `OP_ERROR_TEXT` has a `NothingToStash` phrase; `REQUEST_KEY_MAP` has `globalStash.list`.
- [ ] `CONTRACT_VERSION` / `ContractVersion` both 30; zero new wire interfaces.
- [ ] No SQL migration; no watcher change; no new `ClassifyOpError` stderr row.
- [ ] No new path-bearing wire field; the one generated pathspec is `:(literal)` and byte-exact.

---

## 8. Explicit non-goals for G28

- **Auto-popping the auto-stash onto the new branch.** F4/D1. That mechanism exists (G17 D8's `stashAndCarry`) and is untouched. Restated here because it is the single most likely thing for a future reader to "finish".
- **Path-scoped auto-stash** (stash only the blocking paths, carry the rest). D4's table: it cannot honour the "never blocks" guarantee, because our blocked set is computed independently of git's own refusal set. `StashPushArgs` is hardened (D14) so a later phase can build it safely if measurement ever justifies it.
- **A `stash push -u` → `apply --index` round trip to give the *worktree* global-save path untracked support** (P21 proves it works). It is a four-step dance with a real window in which the tree is clean, in service of a case the *promote-an-existing-entry* path (D10) already covers with zero risk. Named, priced in §9, not built.
- **Renaming or relabelling a global entry.** P23 records the exact `commit-tree` mechanism; §9 prices it.
- **Expiry, quota, or a reaper for the global bucket.** "Keep this and reuse it" and "we quietly deleted it" are incompatible. The bucket grows only when the user saves, and Remove is one click and undoable.
- **Pushing, fetching, or otherwise sharing `refs/kira/*`.** Per-clone by design (D8), exactly as G26 D1 scoped stack parents. Nothing in this app ever names a `refs/kira/*` refspec.
- **A separate `GlobalStashEntry` wire type.** D17's closing paragraph argues the fork it would cause.
- **Making `stash pop`/`stash drop` work on a global entry.** Both are position-addressed by necessity; the bucket has no positions, and Apply-plus-Remove is the honest pair.
- **Auto-detaching anywhere other than an explicit user checkout or `worktree add`.** Nothing in this phase moves HEAD without a direct user act.
- **A per-repo setting for auto-detach.** One behaviour, no option — SPEC states it flatly, and the route is announced loudly enough that a preference would be solving a visibility problem with a switch.
- **Synthesising stash rows in the graph when `showInGraph` is `true`** — G17 §9's genuinely undecided server-vs-client row-filter question. D15 wires only the decidable `false` half.
- **Any new `ClassifyOpError` row.** Every failure this phase can produce is already classified (`WorktreeConflict`, `Conflict`, `DirtyWorktree`, `UntrackedWouldBeOverwritten`, `LockHeld`) or is refused host-side before git can produce it (P17's empty-stderr case).
- **Touching `gitpreflight/pull.go`, `PullRoute`, `RouteStashAndCarry`, or `#stashAndCarry`.** F3 — a different mechanism, correctly shipped, out of scope.
- **Editing `packages/git-core/src/preflight/types.ts`** — a legacy re-export nothing consumes for these types; G26 set the precedent.
- **Any `docs/v1.3/SPEC.md` edit** — the convention every phase since G12 has followed. This plan's correction of the row's "pop-once" wording lives here, in F8, not in the SPEC.

---

## 9. Handed forward

- **Untracked support for the worktree-sourced global save.** F14/P5 is the limit; P21 is the mechanism (`push -u` → `update-ref` → `drop` → `apply --index`). Recommendation if taken up: make it an explicit checkbox in the save dialog labelled with what it does ("briefly clears and restores your working tree"), never the default.
- **Renaming a global entry.** P23 proves `commit-tree` over the source's tree and parents produces an appliable stash commit with a new subject; rename is then save-with-new-label plus remove-old, and both halves already exist as ops. It needs a two-op client sequence or one new `dropSource` flag, and D10 deliberately declined the flag.
- **`kiraVersion.stash.showInGraph`'s `true` half** — G17 §9's row-filter question (drop helper commits, truncate parent lists, synthesize the decoration; server-side in `gitstore` vs. client-side over decoded `CommitRecord`s). D15 leaves it exactly as G17 left it and does not prejudge it.
- **A "you have N stashes from this branch" hint when switching back.** The data is now all present client-side (`originLabel`). Deliberately not built as a modal — recommendation: a count badge on the stash section header, never a prompt.
- **Promoting the auto-stash into a first-class "shelf" concept** (auto-stashes in their own collapsible group, aged out after N days). Only worth doing after real usage says the stack is actually cluttered; the `AutoStashMessagePrefix` marker is already there to key it off.
- **`refs/kira/*` is now a reserved namespace for this app.** G26 chose `.git/config` for stack parents; any future phase that wants a ref-backed store should join this namespace and inherit D15's exclusion rather than adding a second one.
- **G27** does not touch this phase beyond D18: no new path-bearing wire field exists, ref names and labels stay byte-exact, and the one generated pathspec is tier 2 by construction.
- **G30–G32's review rounds** should specifically re-examine D3's auto-stash arm — it is the one place in this phase where a host-side recomputation (dirtiness, `-u`, in-progress) gates a write that moves user files.

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 — The auto-stash does not pop back. (The big one.)** Alternatives: (a) create the entry, tag it, leave it — the user brings it back deliberately, possibly onto a different branch; (b) push, switch, pop back if predicted clean — G17 D8's existing `stashAndCarry`, promoted from an opt-in button to the default. **Recommendation: (a), exactly as D1.** F4 is the argument: the SPEC row's three bullets — "tagged with the branch they came from", "the stash list shows each entry's origin branch", "a stash from a different branch can be applied … not just onto the branch it came from" — are only mutually coherent if the entry still exists after the switch, and (b) already ships, so reading the row as (b) would make this phase's headline deliverable a re-run of G17. The honest cost is that a user who switches branches with dirty work now finds a clean tree on the other side; D16's announcement is what makes that a visible, one-click-reversible event rather than a surprise, and it is *mandatory*, not decoration. If overridden, the change is small and contained — `runCheckout` calls the existing `#stashAndCarry` instead of setting `autoStash: true` — but the origin-branch tagging, the cross-branch apply affordance and half of §7.3 lose their purpose.

**10.2 — Whole-tree auto-stash rather than path-scoped.** **Recommendation: whole tree (D4).** The scoped version is implementable (P18/P22) and moves strictly less of the user's work, but our blocked set (`D ∩ T`, from `status` plus `diff --name-only`) is computed independently of git's own refusal set, so a scoped stash can leave the switch *still* blocked after having already moved files — turning a guarantee into "usually". P15 shows only `stash push -u` makes "never blocks" true. A reviewer who prefers minimum movement over the guarantee should say so; D14 already hardens the pathspec primitive either way.

**10.3 — The global stash is one ref per entry, not a reflog namespace mirroring `refs/stash`.** **Recommendation: one ref per entry (D8).** The reflog shape is genuinely more elegant — P6 shows `git log -g` reads it back in `stash list`'s exact framing, `%gd` and all, for free — and it is **rejected on a probe, not on taste**: P7 shows that with `gc.reflogExpire=now`, `git reflog expire --all` leaves `refs/stash` untouched (git hard-codes `never` for it) and **wipes a custom ref's reflog completely**. Under real defaults that is silent, delayed, total loss of exactly the entries this feature promises to keep, and defending against it would mean making the durability of the user's work depend on a `gc.<pattern>.reflogExpire=never` line in every clone's config. P8 shows one-ref-per-entry survives the most aggressive prune git offers. The cost is a second small parser (D9) and a ref per entry; the benefit is that "keep this forever" is true by construction.

**10.4 — No SQLite anywhere in the global stash.** **Recommendation: none (D9/F11).** Every display field already rides on the commit git wrote: the label and origin branch in `On <b>: <label>`, created-at in the author date, file count in `--numstat`, identity in the ref name. A `review.db` or `git_repo_settings` table could only hold a divergent second copy — and `git_repo_settings.repo_id` is a *worktree root*, so a global stash saved in the main worktree would be invisible from a linked one, which is G26 F3's finding transposed and is disqualifying now that G25 ships worktree creation.

**10.5 — One widened `StashEntry` with a `scope` field and `index: -1`, rather than a parallel `GlobalStashEntry`.** **Recommendation: widen it (D17).** The sentinel is the one genuinely uncomfortable thing in this plan. The alternative forks `StashDetailPane.vue`, `stash.show`, `PreflightStashPop`, `ClassifyStashPop`, `StashPopPreflight` and every announcement helper for one field's worth of real difference; a single discriminated type with per-kind-optional data is this codebase's own convention (`CheckoutBlocker`, `WorktreeAddBlocker`, `RefRow`); and the sentinel is guarded *structurally* — the only three ops that read `index` are never offered for a global entry, or take a sha-addressed arm (D12).

**10.6 — Wiring `kiraVersion.stash.showInGraph`'s "off" half, which is not in this phase's SPEC row.** **Recommendation: do it (D15), in its own commit so it can be dropped cleanly.** The case for: the setting has shipped **inert** since G18 with a default and a written description, which is precisely the anti-pattern this codebase's own history argues against; `RevSetArgs` is being touched anyway for `refs/kira/*` (F12, non-optional); the "off" behaviour needs **none** of the row-filter architecture question G17 §9 left open, since that only arises for "on"; and G28 multiplies `refs/stash` entries, making "off" a thing users will now actually reach for. The case against: it is not in G28's row, and it is a visible behaviour change to a shipped surface. If overridden, delete step 10 of §6 and the `ExcludeStash` field; the `refs/kira/*` exclusion stands alone and unchanged.

**10.7 — Auto-detach happens automatically for a checkout, but is offered as a button for `worktree add`.** **Recommendation: as D6/D7.** The asymmetry is deliberate: SPEC's row is explicit that a checkout must not block (*"detach `HEAD` at that branch's commit instead of blocking the user"*), and there is no dialog open at that moment to ask in; `worktree add` is an explicit creation act with a dialog already on screen and no "never blocks" promise to keep, so asking costs nothing and detached-HEAD-by-surprise is a real cost. A reviewer who wants symmetry should choose *offer* for both, not *automatic* for both — and then §7.3 item 24 becomes a dialog check.

**10.8 — The routing policy lives in one client method, not in the server or in the pure classifier.** **Recommendation: client-side (D16).** `ClassifyCheckout` keeps reporting what *git* would do (`verdict: "blocked"`) and merely names the available routes; the server never rewrites the `mode` a caller asked for; and the client is the only place that can compose the announcement that makes an auto-stash or an auto-detach *visible* — which is the entire safety story for both. The cost is that a future second frontend must re-implement five lines of route resolution, which is the same cost `#stashAndCarry` and the pull route already carry.

**10.9 — `kiraVersion.checkout.autoStash`, a new per-repo setting defaulting to `true`.** **Recommendation: ship it (D16).** G26 §10.7's "one behaviour, no option" instinct is right for things where the alternative is strictly worse; this is not one of those — auto-stash silently moves a user's uncommitted work, and a user who dislikes that currently has no recourse at all. It costs no migration (`git_repo_settings` is key-value), it is read client-side only so it can never cause an unexpected *write*, and turning it off restores exactly today's dialog. No setting is added for auto-detach (10.7's reasoning).

**10.10 — `globalStashSave` copies and never drops its source.** **Recommendation: copy-only (D10).** A `dropSource` flag would make "promote this stash to global" one click instead of two, but it would also make one op both create and destroy, needing a compound undo (`stash store` + `update-ref -d`) with a position it cannot guarantee. Two totally-reversible ops beat one partially-reversible one, and the second click is the existing, already-undoable Drop.

**10.11 — Refactoring `ParseStashList` to share its record walk, rather than copy-pasting it.** **Recommendation: refactor (D9), as its own commit with the existing golden corpus as the gate.** The parser is one of the more subtle pieces of `porcelain` (the leading `\n` on the first numstat record, untracked-only entries with zero numstat records, header detection against arbitrary paths), and a second hand-maintained copy would drift. The risk is real — it is shipped, tested code with a recorded fixture corpus — which is exactly why it is sequenced as step 3, alone, with "the existing corpus passes byte-for-byte" as its only success criterion.

**10.12 — Hardening `StashPushArgs` with `:(literal)` even though nothing populates `paths` today.** **Recommendation: harden it (D14).** P22 is a real over-match bug found by this phase's own probes in shipped code; it is unreachable only because all three call sites pass `[]`. Two lines, one golden test, zero behaviour change now, and one fewer trap for whoever wires path-scoped stashing later. A reviewer who prefers to keep the diff strictly within the row's scope should hand it to G30's review round instead — but it should not be silently forgotten.

**10.13 — `CONTRACT_VERSION` 29 → 30.** **Recommendation: bump.** Unavoidable: one new request, two new `OpRequest` kinds, one new `OpRequest` field, one new `OpErrorKind`, one new `UiActionKind`, three widened param types, four changed wire types and one new settings leaf. Notably **zero new wire interfaces** — the bucket reuses `StashEntry` (10.5).

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/gitsession/ops.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitpreflight/checkout.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitclient/porcelain/stash.go`
- `/home/user/kira-studio/apps/kira-studio/internal/gitsession/stash.go`
- `/home/user/kira-studio/packages/git-ipc/src/contract.ts`
