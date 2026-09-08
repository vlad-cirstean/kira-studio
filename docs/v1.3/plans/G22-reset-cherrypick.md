# G22 — Reset (3 modes), cherry-pick, and the undo slot finished

> **What this phase is.** The twenty-second phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and structurally G17's twin: **the wire contract, the client state, and every dialog/menu/tooltip this feature needs already exist and are already wired end to end.** `packages/git-ipc/src/contract.ts` carries `ResetMode` (`:420`), `ResetPreflight` (`:422-445`), `CherryPickBlocker`/`CherryPickPreflight` (`:447-467`), the `reset` and `cherryPick` `OpRequest` members (`:650-664`), three P10-specific `OpErrorKind`s (`EmptyCherryPick` `:718`, `ConfirmationRequired` `:722`, `MainlineRequired` `:724`) and both request methods (`preflight.reset` `:1393`, `preflight.cherryPick` `:1397`) — all already counted in `CONTRACT_VERSION = 24`. `packages/git-ui` has `ResetDialog.vue`, `CherryPickDialog.vue`, both row-menu entries (`rowMenuModel.ts:76-86`), both `App.vue` handlers (`:422-429`), the reset-mode undo tooltip table (`liveAnnouncements.ts:223-238`) and a fully implemented `OpsState` client (`runReset`/`previewResetMode`/`resolveResetDialog`/`runCherryPick`/`previewCherryPickMainline`/`resolveCherryPickDialog`/`#reconcileCherryPick`) — none of it stubbed, all of it calling real RPC methods. **Every one of those calls hits `E_UNKNOWN_METHOD` today**: `grep -ri 'reset\|cherrypick'` over `internal/gitops/`, `internal/gitpreflight/` and `internal/gitrpc/` finds only `conflict.go`'s sequencer verbs and stale phase-label comments — no `reset.go`, no `cherrypick.go`, no `opTable` entry, no handler. This is a port, not a design phase.
>
> **What "undo slot completed" means, concretely.** `internal/gitpreflight/undo.go`'s `UndoSlot`/`UndoRecord`/`UndoPolicy` and `gitsession.RunOp`'s capture-before-write discipline have existed since G5 and need **no new mechanism**. What is missing is *coverage*: upstream's `UNDO_POLICY` names exactly five undoable kinds — `branchDelete`, `tagDelete`, `stashDrop`, `reset`, `cherryPick` — and this app has captured three of them (G5's two, G17's `captureStashDropUndo`). This phase adds the remaining two, and with them the last two entries of upstream's total mapping. SPEC's "undo slot completed" is that sentence, and nothing more: two new `Undoable` `opTable` entries, two new capture functions, and the deletion of `packages/git-core/src/undo/slot.ts` — the last file of SPEC §5's "`git-core` drops `preflight/*` and `undo/*`" trim that no earlier phase owned.
>
> **Two things that are genuinely this phase's own work, not a port of anything.** (1) `EmptyCherryPick` cannot be produced by G17's `opSpec.Reclassify` seam as it stands: distinguishing an empty pick from any other failed pick needs `CHERRY_PICK_HEAD` to still be set, which lives in `InProgressOperation`, not in the `porcelain.StatusResult` the seam currently passes. D6 widens that signature by one parameter — the second use of a seam G17 built for one caller, exactly as its own doc comment anticipated. (2) G5 D12 explicitly deferred the **host-side `canRunOp` re-check** to this phase (`docs/v1.3/plans/G5-refs-checkout-preflight-and-the-undo-slot.md:858-864`: *"`canRunOp` stays client-side only and G13 adds the Go re-check when it adds the operations that need one"*), because reset is the one operation where git does **not** defend itself — P10 probe 3: `reset --mixed`/`--hard` mid-merge succeed and silently delete `MERGE_HEAD`, abandoning the sequencer. D8 is that gate.
>
> **One real scope call, argued and decided.** `packages/git-core/src/preflight/reset.ts` is the one classifier in this whole chapter that is **not** deleted when its Go twin lands: `classifyReset` has a live production caller (`packages/git-ui/src/state/ops.ts:490`, `previewResetMode`'s no-round-trip mode recompute), which G5's own F10 flagged and handed to this phase to decide. D3 keeps it, and keeps `cherryPick.ts`'s deletion, on that asymmetry — §10.1 hands the call to a human.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `ab6cc2f3` (G1–G21 complete). Working tree clean. Every claim below was checked against source read in this container — both this repo and the upstream checkout at `/home/user/vlad-cirstean/kira-version-vscode` (`claude/start-p2-gwlgly`, `0ea4cfe`) — never inferred from SPEC prose alone.

### 0.2 Scope

Full upstream P10: reset in all three modes with its pre-flight, typed confirmation and mode-matched undo; single-commit cherry-pick with its `merge-tree` prediction, path-scoped blockers, empty-pick detection and `--keep` undo; and the undo slot's last two entries. Concretely:

1. **`internal/gitclient/porcelain/reset.go`** (new) — `rev-list --count --left-right` argv + parser (probe 4's two-sided count), and the capped `log --format=%H%x1f%s -z -<cap+1> <base>..<tip>` argv + parser for `leavingCommits`.
2. **`internal/gitpreflight/reset.go`, `cherrypick.go`** (new) — direct Go ports of `git-core/src/preflight/reset.ts` and `cherryPick.ts`, field for field, blocker order for blocker order, with their 15 + 16 test cases re-expressed as Go table tests.
3. **`internal/gitpreflight/status.go`** (edited) — two new status folds, `DirtySplit` and `StagedNewPaths`, ports of upstream's `dirtySplitFrom`/`stagedNewPathsFrom`; the existing `DirtyPaths`'s tracked/untracked split cannot answer "staged vs unstaged", which both new classifiers need.
4. **`internal/gitops/reset.go`, `cherrypick.go`** (new) — `ResetArgs`, `ResetKeepArgs` (undo-only, never a user-selectable mode), `CherryPickArgs`.
5. **`internal/gitsession/preflight.go`** (edited) — `resolveCommit`, `PreflightReset`, `PreflightCherryPick`, `predictCherryPick`, `cherryPickCommitPaths`.
6. **`internal/gitsession/ops.go`** (edited) — `OpRequest` gains one field (`ConfirmToken`); `opSpec.Reclassify`'s signature gains one parameter (D6); two new `opTable` entries, both `Undoable`; `prepareReset`/`prepareCherryPick` with the host-side gate re-check, the fresh `destroys` recompute, and the two undo captures; `reclassifyCherryPick`.
7. **`internal/gitrpc`** — two new `Request` cases and their handlers (`gitrpc/reset.go`, new), two new `*Params` types; `op.run`'s dispatch needs no change (already generic — `ErrUnservedOpKind` simply stops firing for these two kinds).
8. **`packages/git-core`** — delete `preflight/cherryPick.ts` + its test, delete `undo/slot.ts` + its test, drop three `index.ts` export lines. **Keep `preflight/reset.ts`** (D3).
9. **`packages/git-ipc`** — two new `UiActionKind` members and **`CONTRACT_VERSION` 24 → 25** (D10). This is the only wire change; every result/param/error shape this phase serves already exists.
10. **`apps/kira-studio-vscode`** — the two `{ pending: 'G16' }` entries become real `PaletteCommand`s; two `contributes.commands` entries; the `MutatingEntry` union's stale `'G16'` label becomes `'unassigned'` (D11).

### 0.3 Not in this phase

- **`tagPush` / `tagDeleteRemote`.** Still unserved, still `pending`. They are pushes and need G7's askpass broker, which `RunOp`'s `runWriteArgv` does not wire (F11) — a real design question, not a drive-by. D11 relabels them honestly and §9 records the blocker; §10.2 is the human-eye item.
- **Multi-commit cherry-pick.** Upstream's §7.13 is explicit: *"A single commit only (multi-commit cherry-pick, like multi-commit revert, is not a v1 guarantee this section makes)."* `OpRequest.cherryPick` carries one `sha`, and `CherryPickPreflight` one `sha`. Not widened here.
- **Any redesign of `ResetDialog.vue`/`CherryPickDialog.vue`/`ConflictBanner.vue`.** They are correct as built; this phase makes their calls succeed, not different. The one client edit is two `runUiAction` cases.
- **`canRunOp`'s deletion from `git-core`.** It has three live callers (`ops.ts`, `rowMenuModel.ts`, `ConflictBanner.vue`) — G5 F10 already established that. The Go gate D8 adds is a *second, host-side* check, not a relocation.
- **A new `OpErrorKind`.** All three this phase produces (`ConfirmationRequired`, `EmptyCherryPick`, `MainlineRequired`) already exist on the wire; `MainlineRequired` already has its `ClassifyOpError` row (`gitops/errors.go:58-60`, added for revert).
- **No `docs/v1.3/SPEC.md` edit** — same convention G12/G14/G15/G16/G17 all followed. SPEC's G22 row needs no correction.
- **No new dependency, no new test tier.** `reset`, `cherry-pick`, `rev-list --left-right`, `merge-tree --merge-base` are all ordinary git, all above the 2.38 discovery floor already enforced.

### 0.4 Ground rules

- **Port the classifiers, don't redesign them.** `ClassifyReset`/`ClassifyCherryPick` are field-for-field, blocker-order-for-blocker-order ports. Any deviation is a decision, stated as one (there are none needed — both TS originals are correct and already tested against the upstream probes).
- **Every mutating verb goes through `RunOp`'s existing machinery.** The one addition (`Reclassify`'s widened signature, D6) is additive to that machinery, not a parallel path.
- **Capture the undo before the write, always.** Both new records read HEAD from a status spawn that happens inside `Prepare`, before `runWriteArgv` is ever called — the same ordering G5 D7 established and `RunOp`'s own step list documents.
- **The reset undo label is a wire contract in disguise** (F9). It must be byte-identical to `Reset (<mode>) to <subject-or-short-sha>`; a Go test guards it.
- **Fix a stale label where this phase's own diff already touches its neighbourhood**, and no further — D11 draws that line file by file, exactly as G17 D10 did.

---

## 1. Findings

### F1 — The entire wire contract for this feature already exists, at `CONTRACT_VERSION = 24`

`packages/git-ipc/src/contract.ts`:

- `ResetMode` (`:420`), `ResetPreflight` (`:422-445`) — every field the dialog and classifier need, including `leavingCommits`/`leavingTruncated` (the capped list), the three-way `dirty` split, `destroys`, `requiresTypedConfirmation`, `routes: readonly 'stashFirst'[]` and the two-member `blockers` union.
- `CherryPickBlocker` (`:447-452`, five members) and `CherryPickPreflight` (`:454-467`) — structural copies of `git-core`'s own.
- `OpRequest`'s two P10 members (`:650-664`): `reset` (`mode`/`target`/`confirmToken`) and `cherryPick` (`sha`/`mainline`/`noCommit`), each with the doc comment naming its own rule (`confirmToken`: *"required (and re-checked host-side) exactly when `mode === "hard"` and the pre-flight's `destroys` was non-empty"*).
- `OpErrorKind`'s three P10 members (`:718-724`), each with the mechanism written down rather than left to be rediscovered — `EmptyCherryPick`: *"`CHERRY_PICK_HEAD`/`REVERT_HEAD` is set, the worktree is clean and NO paths are unmerged (probe 6). Detected by exit code + read-back, never by pattern: the whole message goes to stdout."*
- Both request methods declared (`:1393-1400`), and both already present in `validate.ts`'s `REQUEST_KEYS` (`:137-138`).

`gitrpc/contract.go`'s `ContractVersion` history (nine dated bump comments, G7→16 through G21→24) never mentions reset or cherry-pick, because none of it needed to: the whole P1–P11 vocabulary landed in one shot when `packages/git-ipc` was ported whole at G1. **The only `packages/git-ipc` edit this phase needs is `UiActionKind`** (F10/D10).

### F2 — Zero Go implementation exists anywhere in the serving path

Confirmed by direct inspection:

- `internal/gitops/` has `branch.go`/`checkout.go`/`conflict.go`/`errors.go`/`fetch.go`/`progress.go`/`pull.go`/`push.go`/`remote.go`/`revert.go`/`stash.go`/`tag.go` — **no `reset.go`, no `cherrypick.go`**, despite SPEC's own package table naming `reset` among `gitops`'s owned verbs.
- `internal/gitpreflight/` has `checkout.go`/`operation.go`/`pull.go`/`push.go`/`revert.go`/`stash.go`/`status.go`/`undo.go` — **no `reset.go`, no `cherrypick.go`**.
- `internal/gitrpc/handlers.go`'s `Router.ForConn` switch (`:110-134`, the complete method table) has no `preflight.reset`/`preflight.cherryPick` case — such a call falls through to `default: E_UNKNOWN_METHOD`.
- `internal/gitsession/ops.go`'s `opTable` (`:112-186`, fifteen entries) has neither kind. `RunOp` answers them correctly *as a fallback* — `ErrUnservedOpKind{Kind:"reset"}`, mapped by `gitrpc/ops.go` to `E_UNKNOWN_METHOD` naming the kind — never a stub, never a silent success.

The only matches for "reset"/"cherry-pick" in the git packages are `conflict.go`'s sequencer verbs (`cherry-pick --continue/--abort/--skip`, `bisect reset`), `operation.go`'s `InProgressCherryPick`, and four stale phase-label comments (F8).

### F3 — Both classifiers are already written, already tested, and one of them has a live caller

`packages/git-core/src/preflight/reset.ts` (69 lines) exports `classifyReset`; `reset.test.ts` covers **15 cases** in four groups: probe 1's destroys matrix (soft never destroys however dirty; mixed never destroys either; hard destroys staged + unstaged tracked; hard destroys a **staged-but-new** file too — the "looks untracked but isn't" case; hard leaves genuinely-untracked and ignored alone; hard with nothing to destroy requires no token; de-duplication of a path that is both staged and staged-new), probe 4's leaving/gaining (`leaving === 0` forces the commit list empty even if the caller passed one; `leaving > 0` passes list and truncation flag through; a diverged target reports both counts, neither silently dropped), probe 3's blockers (in-progress blocks even a clean soft reset; an unresolved target blocks; `inProgressOperation` before `unknownTarget`; `blocked` beats `destructive`), and detached HEAD (`branch: null` carries through untouched).

`packages/git-core/src/preflight/cherryPick.ts` (81 lines) exports `classifyCherryPick`; `cherryPick.test.ts` covers **16 cases**: probe 7's dirty-tree matrix A–E (unrelated unstaged dirt tolerated; **any** staged change blocks regardless of what it touches; unstaged dirt on a *touched* path blocks as `localChangesWouldBeOverwritten`; staged dirt on a touched path is still `stagedChanges`, not the other kind; an untracked file at a path the pick *adds* blocks; an untracked file **not** among the added paths does not), blocker ordering (all five at once in the documented order; in-progress alone), probe 8's mainline rules (merge with no mainline ⇒ `mainlineRequired` names every parent and blocks; merge with mainline supplied ⇒ empty; a non-merge never requires one), `alreadyApplied` as advisory-never-blocker, prediction folding into verdict (conflicts ⇒ `willConflict`; unknown ⇒ neither; blocked beats conflicting), and detached HEAD as a note.

`grep -rn "classifyReset\|classifyCherryPick"` across the whole repo finds: the two definitions, their test files, two `index.ts` lines (`:132`, `:133`), one `ResetDialog.vue` doc-comment mention — and **one live production caller**: `packages/git-ui/src/state/ops.ts:1` imports `classifyReset`, used at `:490` by `previewResetMode`, the dialog's mode-radio recompute that deliberately avoids a second round trip. `classifyCherryPick` has **no** production caller. This asymmetry is D3.

### F4 — `git-core/src/undo/slot.ts` is fully dead, and it is the last file of SPEC §5's trim no phase owns

`UndoSlot`/`UNDO_POLICY`/`UndoRecord`/`UndoPolicy` are exported at `index.ts:188-189` and imported by **nothing except `slot.test.ts`**. The Go side has carried the whole mechanism since G5 (`internal/gitpreflight/undo.go`, a field-for-field port with G5 D7's two attribution fields added). G5's own §17 hand-forward names this file's owner: *"**G13** owns `preflight/{reset,cherryPick}.ts` and `undo/slot.ts`"* — G13 at that numbering is this phase after SPEC's `7698873a` renumbering. G1 D14 and SPEC §5 both assign the deletion here too.

`UNDO_POLICY`'s own value is its TypeScript mapped type over `OpRequest["kind"]` — a compile-time totality check. Its Go stand-in already exists and already runs: `TestOpTable_EveryEntryStatesAnUndoPolicy` (`gitsession/ops_test.go:18`), written at G5 D6 for exactly this reason. Deleting the TS original loses nothing that is not already guarded.

### F5 — The undo slot's *mechanism* is complete; only its *coverage* is not

`internal/gitpreflight/undo.go` has `UndoRecord` (with `Replay [][]string`), `UndoSlotSnapshot`, `SnapshotFor` (G5 D7's read-time attribution suffix), `UndoPolicy`/`Undoable`/`NotUndoable`, and a mutex-guarded `UndoSlot` with `Peek`/`Set`/`Take`. `gitsession.RunOp` (`ops.go:492-563`) already: captures in `Prepare` before any write; sets the slot on **every** op (nil clears); consults `opTable[kind].Undo` as the authority rather than trusting whether `Prepare` happened to build a record; and `UndoRun` (`:581-624`) already `Take`s once, re-checks the recovery sha through the `cat-file --batch` session (`ErrMissing` ⇒ a clean `NotFound` refusal, never a bad replay), and replays the argv list through the same `runWriteArgv`/`ClassifyOpError` path.

Undoable kinds today: `branchDelete` (`captureBranchDeleteUndo`, `ops.go:355`), `tagDelete` (`captureTagDeleteUndo`, `:394`), `stashDrop` (`captureStashDropUndo`, `:423`) — three. Upstream's `UNDO_POLICY` marks **five**. The two missing are exactly this phase's two kinds. `TestOpTable_UndoableKindsAreExactlyBranchTagDeleteAndStashDrop` (`ops_test.go:65`) locks the current three and is the test that will fail until it is updated to five — the mechanical proof that "undo slot completed" landed.

**Nothing about the mechanism changes.** `reset`'s replay is one argv (`reset --<mode> <prev>`); `cherryPick`'s is one argv (`reset --keep <prev>`); both are a single `[][]string` entry, both recover a plain commit sha `UndoRun`'s existing `cat-file` check already validates.

### F6 — `EmptyCherryPick` cannot be produced by G17's `Reclassify` seam as it currently stands

`opSpec.Reclassify`'s current signature (`ops.go:105`) is `func(opErr *OpError, status porcelain.StatusResult) *OpError`. Upstream's own detection (`repoService.ts:2061-2078`) needs three facts:

```
error.kind === "Unknown"  &&  op.kind === "cherryPick"
  && inProgress?.kind === "cherryPick"          // CHERRY_PICK_HEAD still set
  && unmergedPathsFrom(statusResult).length === 0
```

The third comes from `StatusResult`; the second does **not** — `InProgressOperation` is classified from `.git/` state files (`gitops.ReadInProgressStateFiles` → `gitpreflight.ClassifyInProgress`), not from `status --porcelain=v2` output. Dropping the `CHERRY_PICK_HEAD` condition and keying on "zero unmerged paths" alone would misclassify *every* clean-tree cherry-pick failure as an empty pick — a bad-object sha, a missing mainline, a hook refusal. So the seam needs widening.

`RunOp` already has both values in hand at the call site (`ops.go:533`: `statusResult, inProgress, serr := e.statusAndInProgress(ctx)`), so widening costs one parameter and one call-site edit (`reclassifyStashPop`), no new spawn. G17 D6's own doc comment anticipated a second caller (*"the day an eleventh kind needs it, this is the seam it reaches for rather than a new one"*); this is that day, with the small correction that the seam needs one more input than its first caller did.

### F7 — Reset's two host-side re-checks are load-bearing, and G5 explicitly deferred one of them to this phase

`docs/v1.3/plans/G5-refs-checkout-preflight-and-the-undo-slot.md:858-864`, verbatim:

> **No host-side gate re-check.** Upstream re-checks `canRunOp` immediately before the write for `reset` and `cherryPick` (P10 probe 3: git itself only refuses a *soft* reset mid-merge). Neither of G5's two gated operations has that hole … `canRunOp` stays client-side only (F10) and G13 adds the Go re-check when it adds the operations that need one.

Upstream's `GATED_OP_KINDS` comment (`git-core/src/model/operation.ts:351-356`) states the stake plainly: *"git does NOT refuse `reset --mixed`/`--hard` mid-merge/mid-pick — it silently succeeds and abandons the sequencer state — so this gate is the ONLY thing standing between a user and that data loss, unlike every op above it, which merely mirrors git's own refusal."*

The second re-check is D62's: the typed confirmation is validated against `destroys` **recomputed fresh from a status read immediately before the write**, not against the pre-flight's possibly-stale value — a dialog can sit open arbitrarily long, and the token must gate what would actually be destroyed *now*. Upstream serves both from one status spawn inside `#prepareOp` (`repoService.ts:2413-2456`). The Go port does the same: `prepareReset` takes one `statusAndInProgress`, and that same read supplies the gate, the fresh `destroys`, **and** the pre-write HEAD sha the undo record captures (F12).

### F8 — Four stale phase-label comments name this phase's own job, under labels that no longer resolve to it

All four predate SPEC's `7698873a` renumbering ("insert G16 … renumber G16-G28 to G17-G29"):

- `gitsession/ops.go:22` — *"the four still-unserved kinds' own fields (G7's tagPush/tagDeleteRemote, G18's reset/cherryPick)"*.
- `gitsession/ops.go:73-75` — *"four of OpRequest's nineteen kinds, each owned by a later phase (G7's tagPush/tagDeleteRemote, G18's reset/cherryPick)"*.
- `apps/kira-studio-vscode/src/commands.ts:39-45` — *"G16 owns reset/cherryPick and tagPush/tagDeleteRemote"*, the half G17 D10 deliberately left alone as *"its own next phase's problem"*.
- `apps/kira-studio-vscode/src/commands.ts:46` — the `MutatingEntry` union's `{ readonly pending: 'G16' }`.

D11 fixes all four, exactly at those lines, in the same commits that change the code beside them.

### F9 — The reset undo label is a wire contract in disguise, and nothing currently guards it

`packages/git-ui/src/state/liveAnnouncements.ts:223`:

```ts
const RESET_UNDO_LABEL_PATTERN = /^Reset \((soft|mixed|hard)\) to /;
```

`composeUndoTooltip` matches it to pick one of three per-mode tooltip strings (`:225-229`) — because a mixed reset's undo genuinely does not restore what was staged (probe 5: that index state was never written to the object database), and the tooltip is the one place a user learns that before they need it. The doc comment (`:214-222`) says so explicitly: *"the label doubles as the mode carrier without a dedicated field."* `UndoSlotSnapshot` carries no `kind`, so there is no alternative signal.

The pattern is **start-anchored**, which is exactly why G5 D7 made `SnapshotFor`'s cross-window attribution a *suffix* (`undo.go:32-36`: *"two future phases (G12/G13) pattern-match on it, both start-anchored"*). So the Go label must be `Reset (<mode>) to <subject-or-short-sha>` byte for byte — upstream's `Reset (${op.mode}) to ${resolved.subject || resolved.sha.slice(0,7)}` (`repoService.ts:2466`). `grep` finds **no test anywhere in this repo** exercising `composeUndoTooltip`, so the coupling is currently unguarded on both sides. §3.9 adds a Go guard.

Cherry-pick's label (`Undo cherry-pick of <sha7>`) matches no pattern and correctly falls to `DEFAULT_UNDO_TOOLTIP_SUFFIX` — the same doc comment says so, and says why (*"§7.12's own 'does not restore uncommitted work' already covers what a cherry-pick's undo cannot bring back"*).

### F10 — Neither `reset` nor `cherryPick` has a `UiActionKind`, and this is the phase's only wire change

`UiActionKind` (`contract.ts:956-990`) has seventeen members. `revertSelected` (`:960`) is the shape both new commands need — `App.vue`'s `runUiAction` (`:663-668`) reads `selection.sha.value`, calls `opsState.runRevert([sha])`, and announces *"Select a commit first."* otherwise. There is no equivalent for reset or cherry-pick, and no existing member does the right thing for either (unlike G17's four stash commands, which could honestly reuse `openBranchPicker` because `BranchPicker.vue` already contains the stash list — F8 there). `openBranchPicker` would land the user on a branch list with no reset or pick affordance at all.

So this phase adds two members, `resetSelected` and `cherryPickSelected`, and bumps `CONTRACT_VERSION`. That bump is required by this repo's own established rule even though the Go server neither emits nor parses `ui.action`: it is the sole compatibility authority (G10 D9's precedent, restated at G12, G13, G14, G19 and G21).

### F11 — `RunOp`'s write path has no askpass wiring, which is why `tagPush`/`tagDeleteRemote` are not a drive-by

`runWriteArgv` (`ops.go:453-474`) builds a `gitclient.Spec` with `Dir`/`Args`/`ReadOnly:false`/`Setsid:true` and **no `Env`**. Remote ops take an entirely different path: `gitsession/remote.go`'s `withAskpass` (`:165-180`) needs a `*Conn` (for `AskCredential`) and `RemoteDeps.Askpass` (the broker), composes `deps.Askpass.Env()` plus the per-op env, and only then spawns (`:186`). `RunOp` receives a `ConnID` **string**, not a `*Conn`, and no `RemoteDeps` at all.

Serving `tagPush` through `op.run` would therefore spawn `git push` with `GIT_TERMINAL_PROMPT=0` and no askpass shim — instant `AuthFailed` against any credential-requiring remote. Fixing that means either threading `*Conn`/`RemoteDeps` through `RunOp` (touching every `opTable` entry's `Prepare` signature) or moving both kinds to `remote.run` (a contract change: they are `OpRequest` members, not `RemoteOpParams` ones). Both are real design work with no SPEC row behind them. §9/§10.2.

### F12 — `status --porcelain=v2 --branch` already carries HEAD's sha, so the undo capture needs no extra spawn

`porcelain.StatusBranchInfo.OID` (`status.go:20`) is populated from git's own `# branch.oid <sha>` header, unconditionally except on an unborn HEAD (where the header reads `(initial)` and the parser sets `Unborn`, `OID: ""` — probe P11). Upstream's `#prepareOp` pays a separate `#resolveHead` `rev-parse HEAD` spawn for the recovery sha (`repoService.ts:2461`); this port reads it off the status result both `Prepare` functions already fetch for the gate. One fewer spawn per reset and per pick, with one honest consequence: on an unborn HEAD `OID` is `""`, so no undo record is captured at all (D9) — which is correct, since there is no commit to return to.

### F13 — `commands.test.ts` turns "serve these two kinds" into "also ship two real commands," mechanically

`apps/kira-studio-vscode/src/commands.test.ts` extracts `opTable`'s keys straight out of `ops.go`'s source text (`extractOpTableKinds`, brace-counted, anchored on `var opTable = map[string]opSpec{`, `:74-82`) and asserts for every extracted kind that `MUTATING_COMMANDS[kind]` is a real `PaletteCommand`, not `{ pending: … }` (`:124-133`), plus the converse (`:136-141`: a real command for a kind Go does not serve fails too). The moment `opTable` gains `reset`/`cherryPick`, this test fails against the tree as it stands (`commands.ts:122-123`). Same mechanism G10 D20 built specifically so a phase could not serve a kind without registering its palette command; same shape G17 F7 hit.

### F14 — `ResetPreflight.target` must be echoed verbatim, not canonicalized

`ResetDialog.vue:47` derives the confirmation token as `preflight.target.slice(0, 7)`; `prepareReset` compares `op.confirmToken` against `resolved.sha[:7]` (upstream `repoService.ts:2447`). The two agree only because `classifyReset` echoes `input.target` **unchanged** (`reset.ts:47`: `target: input.target`) and the client always passes a full sha taken from a graph row (`App.vue:425`, `runReset(commit.sha, 'mixed')`), never a ref name. Canonicalizing `target` to `resolved.sha` in the Go port would be a behaviour change the dialog is not written for and would silently alter what the user is asked to type. Port verbatim; `targetSubject` is where the resolved commit's information belongs.

---

## 2. Decisions

### Reset

### D1 — `ClassifyReset`: a direct Go port, field for field, blocker order for blocker order

New file `internal/gitpreflight/reset.go`. Every name on the left is `reset.ts`'s own, on the right this phase's Go:

| TypeScript | Go |
|---|---|
| `classifyReset(input)` | `ClassifyReset(in ClassifyResetInput) ResetPreflight` |
| `input.target` / `targetSubject` | `in.Target` / `in.TargetSubject string` — echoed verbatim (F14) |
| `input.mode: ResetMode` | `in.Mode string` (`"soft"`/`"mixed"`/`"hard"` — a Go `string`, matching the wire, not a new enum type; `RevertPreflight.Verdict`'s own precedent) |
| `input.currentHead` / `branch` | `in.CurrentHead string` / `in.Branch *string` (`null` on detached — a real pointer, never `omitempty`) |
| `input.leaving` / `gaining` | `in.Leaving` / `in.Gaining int` |
| `input.leavingCommits` / `leavingTruncated` | `in.LeavingCommits []ResetLeavingCommit` / `in.LeavingTruncated bool` |
| `input.dirty: {staged,unstaged,untracked}` | `in.Dirty ResetDirty` (new struct, three `[]string`, JSON-tagged — the wire shape) |
| `input.stagedNew` | `in.StagedNew []string` (`StagedNewPaths`, D5) |
| `input.inProgress` | `in.InProgress *InProgressOperation` (already exists) |
| `input.targetResolves` | `in.TargetResolves bool` |
| `destroys` = hard ? unique(staged ∪ unstaged ∪ stagedNew) : [] | identical, `unique` a small ordered-dedup helper (first occurrence wins, matching JS `Set` iteration order) |
| `requiresTypedConfirmation` = hard && destroys.length > 0 | identical |
| blocker order: `inProgressOperation`, `unknownTarget` | same two `if`s, same order |
| verdict: blocked > destructive > clean | identical three-way |
| `leavingCommits`/`leavingTruncated` forced empty/false when `leaving === 0` | identical — the test that guards it is named explicitly (§3.4) |
| `routes` = destroys.length > 0 ? ["stashFirst"] : [] | identical |

Every slice field is initialized to `[]T{}`, never left nil — `[]string(nil)` marshals to `null`, and the dialog reads `.length` on all of them. Same rule `ClassifyRevert` already follows (`revert.go:60-62`, `:98-101`).

**There is no dirty-worktree blocker.** `reset.ts`'s own header states why, and the Go doc comment repeats it: *"a dirty tree is exactly what `soft`/`mixed` are FOR (probe 1), and `hard`'s destruction of it is `destroys` plus `requiresTypedConfirmation`, an advisory the dialog surfaces, not a refusal."* This is the one place a reader coming from `ClassifyCheckout`/`ClassifyRevert` will expect a blocker and must not find one.

### D2 — `ClassifyCherryPick`: the same treatment, and it reuses `RevertParentChoice`/`RevertPrediction` rather than declaring twins

New file `internal/gitpreflight/cherrypick.go`.

| TypeScript | Go |
|---|---|
| `classifyCherryPick(input)` | `ClassifyCherryPick(in ClassifyCherryPickInput) CherryPickPreflight` |
| `input.mergeParents: RevertParentChoice[]` | `in.MergeParents []RevertParentChoice` — **reused**, already declared (`revert.go:4-8`) and already the wire shape `CherryPickPreflight.mainlineRequired` carries |
| `input.prediction: MergeOutcomePrediction` | `in.Prediction RevertPrediction` — **reused** (`revert.go:18-22`); identical `{kind,paths,reason}` union, the same reuse G17 made for `StashPopPreflight.prediction` (`preflight.go:235`) |
| `input.commitPaths: {touched, added}` | `in.CommitPaths CherryPickCommitPaths` (two `[]string`) |
| `input.dirty` | `in.Dirty ResetDirty` — **reused** from D1; both classifiers need the identical staged/unstaged/untracked split, and one struct is one fold |
| `input.mainline: number | undefined` | `in.Mainline *int` |
| blockers, in order: `inProgressOperation`, `mainlineRequired`, `stagedChanges`, `untrackedWouldBeOverwritten`, `localChangesWouldBeOverwritten` | same five `if`s, same order — `CherryPickBlocker` is a flattened struct (`Kind`/`Paths`/`Parents`/`Operation`), the same convention `CheckoutBlocker`/`StashPopBlocker` already use |
| `intersect(a, b)` | small ordered set-intersection helper, `a`'s order preserved |
| verdict: blocked > willConflict > clean | identical |

The two blockers that are set intersections against the *picked commit's own paths* (`untrackedWouldBeOverwritten` ∩ `added`, `localChangesWouldBeOverwritten` ∩ `touched`) and the one that is unconditional (`stagedChanges` — *"git refuses any staged change no matter what it touches, probe 7 B/D"*) get doc comments naming which probe letter each encodes, matching `checkout.go`'s convention of citing the probe rather than re-deriving the reasoning.

### D3 — `git-core` keeps `preflight/reset.ts`, drops `preflight/cherryPick.ts` and `undo/slot.ts`

Three separate calls, made on evidence rather than as one sweep:

- **`preflight/reset.ts` stays.** `classifyReset` has a live production caller (F3), and that caller is not a leftover: `previewResetMode` re-derives `destroys`/`requiresTypedConfirmation`/`routes`/`verdict` when the dialog's mode radio changes, with **no round trip** — every input it needs is already in the one `ResetPreflight` it holds. Replacing it with a second `preflight.reset` request per radio click would add a spawn-backed round trip to a keystroke-latency interaction for zero correctness gain (the recompute is a pure function of `mode` and a snapshot the client already has). This is exactly the case G5 F10 flagged and handed here. It creates a genuine duplication — two implementations of one classifier, in two languages — which §10.1 hands to a human with the mitigations D12 lists.
- **`preflight/cherryPick.ts` + `cherryPick.test.ts` deleted**, `index.ts:132` removed. No caller, Go twin lands in the same phase. The same pattern G5/G7/G17 executed three times already.
- **`undo/slot.ts` + `slot.test.ts` deleted**, `index.ts:188-189` removed (F4). This completes SPEC §5's `git-core` trim: after this phase, `packages/git-core/src/preflight/` holds `reset.ts` (D3), `tag.ts` (`validateRefName`, four live UI callers — G5 F17: never deleted) and `types.ts`, and `undo/` is gone.

`preflight/types.ts` stays whole and untouched: its exported *types* have their own `index.ts` block, and the implementer confirms by `grep` before removing any type export — removing only what F3/F4's "no live caller" greps actually proved dead, exactly the caution G17 §4.3 wrote down.

### D4 — `porcelain/reset.go`: two argv builders and two parsers, with upstream's `log`-not-`rev-list` finding carried over

New file, matching `porcelain/stash.go`'s shape:

```go
// ResetLeavingCommitsCap is ResetPreflight.leavingCommits' own display cap — upstream's own 10
// (repoService.ts:472). The list read below fetches cap+1 so `leavingTruncated` needs no second
// count spawn.
const ResetLeavingCommitsCap = 10

// LeftRightCountArgs is `rev-list --count --left-right <a>...<b>` (probe 4). THREE dots, not two:
// RangeToken's own two-dot token answers only "what leaves"; a reset target can diverge from HEAD
// in both directions and the dialog reports both. Deliberately not routed through RangeToken,
// whose doc comment states it exists so "no call site can drift to three-dot" — this is the one
// call that genuinely wants three, and says so here rather than weakening that guarantee.
func LeftRightCountArgs(a, b string) []string

// ParseLeftRightCount parses the single "<left>\t<right>" line. Left is only-reachable-from `a`
// (what a reset to `a` would GAIN); right is only-reachable-from `b` (what it would LEAVE).
func ParseLeftRightCount(stdout []byte) (left, right int, err error)

// RangeSubjectsArgs is `log --format=%H%x1f%s -z -<cap+1> <base>..<tip>`. Deliberately `log`, not
// the plan's literally-named `rev-list`: upstream verified empirically that `rev-list --format=…
// -z` prepends a `commit <sha>` line and ignores -z for record separation, while `log --format=…
// -z` gives clean NUL-delimited two-field records (queries.ts:281-286) — the same convention
// StashBaseSubjectArgs already follows here.
func RangeSubjectsArgs(base, tip string, cap int) []string

// ParseRangeSubjects frames raw through RecordSplitter and returns the first cap records plus
// whether more than cap came back.
func ParseRangeSubjects(raw []byte, cap int) (commits []RangeCommit, truncated bool, err error)
```

`RangeCommit` is `{Sha, Subject string}` with JSON tags — `ResetPreflight.leavingCommits`' own element shape. Framing reuses `RecordSplitter`/`SplitLimitedFields`, both already in this package; no new parser primitive.

### D5 — Two new status folds in `gitpreflight/status.go`, beside `DirtyPaths` and `UnmergedPaths`

```go
// ResetDirty is the staged/unstaged/untracked split ClassifyReset and ClassifyCherryPick both
// need — the split DirtyPaths' own tracked/untracked discrimination cannot make. Wire-shaped: it
// is ResetPreflight.dirty verbatim.
type ResetDirty struct {
	Staged    []string `json:"staged"`
	Unstaged  []string `json:"unstaged"`
	Untracked []string `json:"untracked"`
}

// DirtySplit ports repoService.ts's own dirtySplitFrom. An unmerged path counts as BOTH staged
// and unstaged — the XY code's two halves can each be non-'.' on a real merge conflict, and there
// is no case in this phase's scope where either classifier reaches this fold with one outstanding
// without inProgress already blocking first.
func DirtySplit(result porcelain.StatusResult) ResetDirty

// StagedNewPaths ports stagedNewPathsFrom — probe 1's third finding: a staged-but-uncommitted NEW
// file (status `A.`) reads as "added", not "modified". --hard destroys it exactly as it does a
// staged edit, but it is neither DirtySplit's `unstaged` nor its `untracked`, so ClassifyReset's
// `destroys` needs it as its own third input rather than reading it off either.
func StagedNewPaths(result porcelain.StatusResult) []string
```

Both live in `status.go` rather than `reset.go` because they are status folds, siblings of `DirtyPaths`/`UnmergedPaths`, shared by two classifiers.

### D6 — `opSpec.Reclassify` gains one parameter: the post-write `InProgressOperation` `RunOp` already computes

The minimal answer to F6. G17's seam widens by exactly one input:

```go
// Reclassify: nil for every kind that does not need it (thirteen of seventeen served kinds after
// G22). When set, called AFTER the write loop and AFTER the post-write statusAndInProgress read
// RunOp already performs — reusing that read, not adding a second one — with the raw OpError the
// stderr-only classification produced (nil on a clean exit), the fresh porcelain.StatusResult, and
// the fresh InProgressOperation (nil when nothing is in progress). G22 widened this by the third
// parameter: an empty cherry-pick is distinguishable from every other clean-tree pick failure ONLY
// by CHERRY_PICK_HEAD still being set, which lives in the in-progress classification, never in
// status output. Returns the OpError RunOp should actually report; a kind with no Reclassify keeps
// the stderr-only result unchanged.
Reclassify func(opErr *OpError, status porcelain.StatusResult, inProgress *gitpreflight.InProgressOperation) *OpError
```

`RunOp`'s body changes at exactly one line — the existing `spec.Reclassify(opErr, statusResult)` call gains `, inProgress`. `reclassifyStashPop` gains an ignored third parameter (`_ *gitpreflight.InProgressOperation`), and its behaviour is byte-for-byte unchanged. No other `opTable` entry is touched.

`reclassifyCherryPick`:

```go
func reclassifyCherryPick(opErr *OpError, status porcelain.StatusResult, inProgress *gitpreflight.InProgressOperation) *OpError {
	if opErr == nil || opErr.Kind != "Unknown" {
		return opErr
	}
	if inProgress == nil || inProgress.Kind != gitpreflight.InProgressCherryPick {
		return opErr
	}
	if len(gitpreflight.UnmergedPaths(status)) != 0 {
		return opErr // a genuinely conflicting pick — ClassifyOpError's "could not apply" row
		             // already named it Conflict, or, if git said nothing matchable, Unknown is honest.
	}
	// Probe 6: an empty pick exits non-zero, leaves CHERRY_PICK_HEAD set, a clean worktree and
	// ZERO unmerged paths — indistinguishable from a fully-resolved pick by state files alone, and
	// its whole message ("The previous cherry-pick is now empty…") goes to STDOUT, so the
	// stderr-only table could only ever say Unknown. The banner offers both Continue and Skip and
	// names which is which, rather than guessing.
	return &OpError{
		Kind:    "EmptyCherryPick",
		Message: "This change is already present on this branch — Skip it, or Continue to commit it anyway.",
	}
}
```

The `opErr.Kind != "Unknown"` early return is upstream's own guard, kept: a pick that failed for a *named* reason (`MainlineRequired`, `Conflict`, `LockHeld`) must never be re-labelled an empty pick just because the tree happens to be clean.

`reset` sets `Reclassify: nil` — every way a reset can fail (a bad target, a lock, an in-progress refusal from the D8 gate) is either an early error or already correctly named by `ClassifyOpError`'s existing rows.

### D7 — `gitops/reset.go` and `gitops/cherrypick.go`: three argv builders, `--keep` deliberately not a mode

Two new files, matching `gitops/revert.go`'s style:

```go
// ResetArgs builds `reset --<mode> <target>` for the three user-selectable modes (§7.7).
func ResetArgs(mode, target string) []string

// ResetKeepArgs builds `reset --keep <target>` and exists ONLY for an undo replay (probe 9):
// --keep preserves unrelated local modifications and REFUSES (exit 128, changing nothing) rather
// than lose work, which is exactly the guarantee an undo needs and no user-selectable mode
// provides. §7.7 names three modes; a fourth would be a spec change, not an implementation choice,
// so this is deliberately NOT reachable through ResetArgs' own mode string.
func ResetKeepArgs(target string) []string

// CherryPickArgs builds `cherry-pick [-m <n>] [--no-commit] <sha>` — mirrors RevertArgs exactly,
// minus --no-edit (a pick never opens a message editor to suppress; it reuses the original
// commit's own message).
func CherryPickArgs(sha string, mainline *int, noCommit bool) []string
```

`ResetArgs` takes `mode string` rather than a typed enum because the wire's own `mode` is a string and `prepareReset` is the one call site; validating it there (an unknown mode ⇒ a `BadRequest`-shaped early error) keeps the argv builder a pure function of its inputs.

### D8 — `prepareReset`: one status spawn serves the gate, the fresh `destroys`, and the undo capture

Ported from `repoService.ts:2407-2471`, in this exact order:

1. **`e.statusAndInProgress(ctx)`** — one spawn, three consumers.
2. **The host-side gate (F7/D8's own reason).** `inProgress != nil` ⇒ `earlyError{Kind:"OperationInProgress", Message: DescribeInProgress(inProgress) + " is in progress — finish or abort it before resetting."}`. This is the *only* thing standing between a user and a silently-abandoned merge, since git does not refuse a mixed/hard reset mid-merge. `gitpreflight.DescribeInProgress` already exists (`operation.go:134`). Deliberately **not** a Go port of `canRunOp`/`GATED_OP_KINDS`: only two kinds are gated server-side, each states its own refusal at its own `Prepare`.
3. **`resolveCommit(ctx, op.Target)`** — probe 3's bad-target guard re-run host-side. `nil` ⇒ `earlyError{Kind:"NotFound", Message: op.Target + " does not resolve to a commit."}`.
4. **The token re-check**, for `mode == "hard"` only, against `destroys` **recomputed from step 1's status** — never the pre-flight's own value. `len(destroys) > 0 && op.ConfirmToken != resolved.sha[:7]` ⇒ `earlyError{Kind:"ConfirmationRequired", Message:"Type the target commit's short sha to confirm — this reset would discard uncommitted work."}`. A stash-first route arrives with a clean tree, so `destroys` is empty and no token is demanded.
5. **Undo capture, before the write** (D9).

### D9 — Both undo records, and exactly what each promises

**Reset** — `Undo: gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable}`, record built in `prepareReset`:

```go
&gitpreflight.UndoRecord{
	ID:        newUndoID(),
	Label:     fmt.Sprintf("Reset (%s) to %s", op.Mode, labelTarget), // F9: byte-identical, guarded by a test
	RecoverySha: prev,                                                // status's branch.oid (F12)
	CreatedAt: time.Now().UnixMilli(),
	Replay:    [][]string{gitops.ResetArgs(op.Mode, prev)},           // MODE-MATCHED
	OriginConn: string(conn), OriginLabel: connLabel,
}
```

`labelTarget` is `resolved.Subject`, falling back to `resolved.Sha[:7]` when the subject is empty.

**The replay matches the mode.** The naive rule ("hard undoes with hard, everything else with soft") leaves the index at the reset state when undoing a `--mixed`, **staging a deletion for every file the returned commits added**. The reflog cannot supply the mode (every reset logs `reset: moving to <sha>` regardless), so capture-before is the only mechanism.

**Cherry-pick** — `Undo: gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable}`, record built in `prepareCherryPick`, with `Replay: [][]string{gitops.ResetKeepArgs(prev)}` and `Label: "Undo cherry-pick of " + op.Sha[:7]`, and **withheld entirely (`nil`) when `op.NoCommit` is true** — that pick moves no ref, so there is nothing a replay could restore.

**A conflicting pick's undo needs no special handling**: a conflicting pick fails, so `opErr != nil`, so `succeeded == false`, so `RunOp`'s existing `if succeeded && spec.Undo.Kind == Undoable` (`ops.go:551`) drops the record without any per-kind logic. Same for an *empty* pick, which also fails.

**`--keep` can refuse, and that is a feature.** A pick is legal with unrelated dirt already in the tree, so undoing it with `--hard` would destroy work the pick never touched; `--keep` moves the pointer, resets only what the move changes, and exits 128 changing nothing when local modifications sit on a path the move would overwrite. `UndoRun`'s existing path surfaces that as an ordinary failed undo — the commit stays, and the local work stays with it. No new mechanism, and no new `OpErrorKind`.

**Unborn HEAD**: `statusResult.Branch.OID == ""` ⇒ no record (F12). The operation still runs; the slot is simply cleared.

### D10 — `CONTRACT_VERSION` 24 → **25**, for exactly two new `UiActionKind` members and nothing else

State it plainly so no later phase's planner claims 25 blind: **this phase's own additions produce `CONTRACT_VERSION = 25` / `ContractVersion = 25`.** The bump covers:

- `UiActionKind` gains `'resetSelected'` and `'cherryPickSelected'` (`contract.ts`, after `'stashChanges'`), each with a doc comment matching every existing member's convention.

Nothing else on the wire changes: no request's params, no result shape, no event, no error kind, no stream. `gitrpc/contract.go` gains its tenth dated bump comment.

### D11 — Palette commands: two new `UiActionKind`s, mirroring `revertSelected` exactly

Per F13 (mandatory) and F10 (why reuse is not available):

```ts
reset: { command: 'kiraVersion.resetToCommit', title: 'Reset to Commit…', action: 'resetSelected' },
cherryPick: { command: 'kiraVersion.cherryPickCommit', title: 'Cherry-pick Commit…', action: 'cherryPickSelected' },
```

`App.vue`'s `runUiAction` gains two cases, structurally identical to `revertSelected`'s (`:663-668`):

```ts
case 'resetSelected': {
  const sha = selection.sha.value;
  if (sha) void opsState.runReset(sha, 'mixed');
  else liveAnnouncement.value = 'Select a commit first.';
  break;
}
case 'cherryPickSelected': {
  const sha = selection.sha.value;
  if (sha) void opsState.runCherryPick(sha);
  else liveAnnouncement.value = 'Select a commit first.';
  break;
}
```

`package.json` gains two `contributes.commands` entries under `CATEGORY` ("Kira Version").

**Stale-label cleanup, exactly at the four lines F8 names and nowhere broader:**

- `gitsession/ops.go:22` and `:73-75` — `"G18's reset/cherryPick"` drops out entirely; the remaining sentence names the two genuinely-unserved kinds without a phase label: *"two of OpRequest's nineteen kinds (tagPush/tagDeleteRemote) are unserved and unassigned — see G22 §9."*
- `commands.ts:39-45` — rewritten to name the real state: reset/cherryPick are served; tagPush/tagDeleteRemote are unassigned and blocked on askpass (F11).
- `commands.ts:46` — `MutatingEntry = PaletteCommand | { readonly pending: 'unassigned' }`.

**Not touched**: `gitclient/porcelain/types.go:67-72` and `log.go:34-35`'s stash-graph labels (G17 D10 left those deliberately), and every other stale phase reference the renumbering could have created elsewhere in the tree.

### D12 — The duplicated reset classifier gets a named twin comment on both sides

D3 leaves two implementations of one classifier alive. `preflight/reset.ts`'s header gains one sentence naming `internal/gitpreflight/reset.go` as its authoritative twin and stating that this copy exists solely for `previewResetMode`'s no-round-trip recompute; `internal/gitpreflight/reset.go`'s header names `packages/git-core/src/preflight/reset.ts` back and says any change must land in both. §10.1 is the human-eye item on whether that is good enough.

---

## 3. The Go side, file by file

### 3.1 `internal/gitclient/porcelain/reset.go` — **new** (D4)

`ResetLeavingCommitsCap`, `RangeCommit`, `LeftRightCountArgs`, `ParseLeftRightCount`, `RangeSubjectsArgs`, `ParseRangeSubjects`.

### 3.2 `internal/gitclient/porcelain/reset_test.go` — **new**

Argv assertions for both builders (three-dot vs two-dot is the one that matters), `ParseLeftRightCount` against a real tab-separated line and against garbage, and `ParseRangeSubjects` against a captured real `log --format=%H%x1f%s -z -N` byte sequence at cap and at cap+1.

### 3.3 `internal/gitpreflight/reset.go` — **new** (D1)

`ResetLeavingCommit`, `ResetDirty` (declared here, used by both classifiers), `ResetPreflight`, `ClassifyResetInput`, `ClassifyReset`, plus the small `unique` helper.

### 3.4 `internal/gitpreflight/reset_test.go` — **new**

Fifteen subtests, one per F3 case. Three get their own named subtests: `hard destroys a staged NEW file too`, `hard leaves untracked and ignored files alone`, `leaving === 0 forces the commit list empty even if the caller passed one`.

### 3.5 `internal/gitpreflight/cherrypick.go` — **new** (D2)

`CherryPickBlocker`, `CherryPickCommitPaths`, `CherryPickPreflight`, `ClassifyCherryPickInput`, `ClassifyCherryPick`, plus `intersect`.

### 3.6 `internal/gitpreflight/cherrypick_test.go` — **new**

Sixteen subtests, one per F3 case. Probe 7's five-row matrix (A–E) keeps its per-row naming.

### 3.7 `internal/gitpreflight/status.go` — edited (D5)

`ResetDirty` is declared in `reset.go`; `DirtySplit` and `StagedNewPaths` land here, beside `DirtyPaths`/`UnmergedPaths`.

### 3.8 `internal/gitsession/preflight.go` — edited (four new methods)

- **`resolveCommit(ctx, ref) (*resolvedCommit, error)`** — `runAllowingExit(ctx, porcelain.ShowMetadataArgs(ref), 0, 128)`; exit 128 ⇒ `(nil, nil)`, exit 0 ⇒ `ParseLogRecord` for `{Sha, Subject}`.
- **`PreflightReset(ctx, target, mode string) (gitpreflight.ResetPreflight, error)`** — `statusAndInProgress` and `resolveCommit` in parallel; `branch` from `headStateFromStatusBranch(statusResult.Branch)`; `currentHead` from `statusResult.Branch.OID` (F12). An unresolved target short-circuits the range reads. Otherwise: `LeftRightCountArgs(resolved.Sha, "HEAD")`, then `RangeSubjectsArgs(resolved.Sha, "HEAD", ResetLeavingCommitsCap)` only when `leaving > 0`. Calls `ClassifyReset` with `Target: target` verbatim (F14).
- **`PreflightCherryPick(ctx, sha string, mainline *int) (gitpreflight.CherryPickPreflight, error)`** — `statusAndInProgress`, `revertMergeParents(ctx, []string{sha})`, `isAncestor(sha, "HEAD")` and `resolveCommit(sha)` in parallel; `effectiveMainline` is `mainline`, or `1` when the commit is not a merge, or `nil` when it is a merge with none chosen; then `predictCherryPick` and `cherryPickCommitPaths` in parallel; then `ClassifyCherryPick`. `alreadyApplied` is `merge-base --is-ancestor` through `runAllowingExit(…, 0, 1, 128)`.
- **`predictCherryPick(ctx, sha string, effectiveMainline *int) gitpreflight.RevertPrediction`** — `nil` mainline ⇒ `{Kind:"unknown", Reason:"Pick a mainline parent first."}`. Otherwise `porcelain.MergeTreeArgs("HEAD", sha, fmt.Sprintf("%s^%d", sha, *effectiveMainline))` through `runAllowingExit(…, 0, 1)` and `ParseMergeTreeOutput`. Base is `HEAD`, other is `sha`, merge base is pinned to `<sha>^<mainline>` — the exact *inverse* arrangement of `predictRevert`'s, because a pick applies its diff forwards and a revert backwards.
- **`cherryPickCommitPaths(ctx, sha string, effectiveMainline *int) (gitpreflight.CherryPickCommitPaths, error)`** — `nil` mainline ⇒ both empty. Otherwise `e.CommitDetail(ctx, sha, *effectiveMainline-1)`, folding `Files`: `FileAdded` ⇒ `added`, everything else ⇒ `touched`, plus `OriginalPath` into `touched` when present.

### 3.9 `internal/gitsession/ops.go` — edited (D6–D9, plus two `opTable` entries)

- `OpRequest` gains **one** field: `ConfirmToken *string \`json:"confirmToken,omitempty"\`` — a pointer.
- `opSpec.Reclassify`'s signature widens by one parameter (D6); `RunOp`'s single call site passes `inProgress`; `reclassifyStashPop` gains an ignored third parameter.
- Two new `opTable` entries, both `Undo: gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable}`; `cherryPick` additionally sets `Reclassify: reclassifyCherryPick`.
- `prepareReset` (D8/D9) and `prepareCherryPick` (D9) — the latter's gate is the same shape as reset's, for the ordinary reason (git does refuse a second pick mid-sequence).
- `reclassifyCherryPick` (D6).
- Doc-comment corrections at `:22` and `:73-75` (D11).

### 3.10 `internal/gitsession/ops_test.go` — edited

- `TestOpTable_ServesExactlyTheFifteenNamedKinds` → `…SeventeenNamedKinds`.
- `TestOpTable_UndoableKindsAreExactlyBranchTagDeleteAndStashDrop` → `…BranchTagDeleteStashDropResetAndCherryPick`.
- **New** `TestPrepareReset_LabelMatchesTheWebviewPattern` — asserts the composed label matches `^Reset \((soft|mixed|hard)\) to ` for all three modes.
- **New** `TestRunOp_EmptyCherryPick_Reclassifies` — a real repo fixture, asserting `{ok:false, error:{kind:"EmptyCherryPick"}}` and that `CHERRY_PICK_HEAD` is still set afterwards.
- **New** `TestRunOp_ResetMidMerge_IsRefused` — a repo left mid-merge, asserting `{ok:false, error:{kind:"OperationInProgress"}}` **and that `MERGE_HEAD` still exists afterwards**.

### 3.11 `internal/gitrpc/reset.go` — **new**

`handlePreflightReset`, `handlePreflightCherryPick` — thin dispatch, the same shape `gitrpc/stash.go`'s four already use. `preflight.reset` validates `repoId` and `target` non-empty and `mode` ∈ {soft,mixed,hard}; `preflight.cherryPick` validates `repoId` and `sha`.

### 3.12 `internal/gitrpc/wire.go` — edited

```go
type PreflightResetParams struct {
	RepoID string `json:"repoId"`
	Target string `json:"target"`
	Mode   string `json:"mode"` // "soft" | "mixed" | "hard"
}

type PreflightCherryPickParams struct {
	RepoID   string `json:"repoId"`
	SHA      string `json:"sha"`
	Mainline *int   `json:"mainline,omitempty"`
}
```

### 3.13 `internal/gitrpc/handlers.go` — edited

Two new `case` arms in `Router.ForConn`'s switch, beside the existing `preflight.*` ones.

### 3.14 `internal/gitrpc/contract.go` — edited

`ContractVersion` 24 → 25, with D10's dated comment.

### 3.15 Not edited, and checked rather than assumed

- **`internal/gitrpc/ops.go`** — `handleOpRun` is already fully generic over `OpRequest.Kind`; once `opTable` serves these two, `op.run` serves them, zero changes.
- **`internal/gitops/errors.go`** — `MainlineRequired`'s row already exists. No new row: `ConfirmationRequired` is an early error and `EmptyCherryPick` is a read-back reclassification, neither ever a stderr pattern.
- **`internal/gitpreflight/undo.go`** — no change (F5). The mechanism is complete; only coverage moves.
- **`internal/gitsession/entry.go`, `status.go`, `queries.go`** — `statusAndInProgress`, `headStateFromStatusBranch`, `runOne`, `runAllowingExit`, `repoWorkingDir`, `CommitDetail`, `Head`, `Repo.Write` all already exist in exactly the shape this phase needs.

---

## 4. The TypeScript / Vue side, file by file

### 4.1 `packages/git-core/src/preflight/cherryPick.ts` + `cherryPick.test.ts` — **deleted** (D3)
### 4.2 `packages/git-core/src/undo/slot.ts` + `slot.test.ts` — **deleted** (D3/F4); the `undo/` directory goes with them
### 4.3 `packages/git-core/src/preflight/reset.ts` — **kept**, one doc-comment sentence added (D12)
### 4.4 `packages/git-core/src/index.ts` — edited

Three lines removed: `:132` (`classifyCherryPick`), `:188` (`UndoPolicy`/`UndoRecord` types), `:189` (`UNDO_POLICY`/`UndoSlot`). `:133` (`classifyReset`) **stays**.

### 4.5 `packages/git-ipc/src/contract.ts` — edited (D10)

Two new `UiActionKind` members with doc comments.

### 4.6 `packages/git-ipc/src/validate.ts` — edited (D10)

`CONTRACT_VERSION = 25`.

### 4.7 `packages/git-ui/src/App.vue` — edited (D11)

Two new `runUiAction` cases. **No other file under `packages/git-ui/` changes.** `OpsState`'s six reset/cherry-pick methods, `ResetDialog.vue`, `CherryPickDialog.vue`, `ConflictBanner.vue`'s Skip, `rowMenuModel.ts`'s two entries, `liveAnnouncements.ts`'s four compose functions and `UndoButton.vue` were all read during this plan's investigation and are complete and correct against the contract this phase implements server-side.

### 4.8 `apps/kira-studio-vscode/src/commands.ts` — edited (D11, F13)
### 4.9 `apps/kira-studio-vscode/package.json` — edited (D11): two `contributes.commands` entries
### 4.10 Not edited

`packages/git-ipc/schema/gitwire.fbs`, `apps/kira-studio-vscode/src/extension.ts`/`panelView.ts`/`proxyHandlers.ts`, `packages/git-core/src/model/operation.ts`, `packages/git-core/src/preflight/types.ts`, `packages/git-core/src/settings/schema.ts`.

---

## 5. Dependencies and tooling

Nothing new. `reset`, `cherry-pick`, `rev-list --count --left-right`, `merge-tree --write-tree --messages --name-only --merge-base=` and `log --format -z -N` are all ordinary git already exercised elsewhere in this codebase's fixtures.

---

## 6. Implementation order

One sequential subagent.

1. **`porcelain/reset.go` + its test** (§3.1/3.2).
2. **`gitpreflight/status.go`'s two folds, `reset.go`, `cherrypick.go` + both tests** (§3.3–3.7).
3. **`gitops/reset.go` + `gitops/cherrypick.go`** (§3.7's D7 builders).
4. **`gitsession/preflight.go`'s four new methods** (§3.8).
5. **`gitsession/ops.go`**: the `Reclassify` widening, `ConfirmToken` field, `prepareReset`/`prepareCherryPick`/`reclassifyCherryPick`, the two `opTable` entries, D11's doc-comment fixes. Then `ops_test.go` (§3.10). `go test ./apps/kira-studio/internal/...`.
6. **`gitrpc`'s two handlers, wire types, switch arms, and the `ContractVersion` bump** (§3.11–3.14). Manual smoke against a real repo over a raw socket.
7. **`git-core`'s two deletions + `index.ts`** (§4.1–4.4) — only after step 5 proves the Go classifier correct.
8. **`packages/git-ipc`'s two members + `CONTRACT_VERSION`, `App.vue`'s two cases, `commands.ts`, `package.json`** (§4.5–4.9).
9. Full check pass (§7).

Commits land incrementally, Conventional Commits, roughly one per numbered step.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` passes, including the 15 + 16 classifier subtests, `porcelain/reset_test.go`'s golden-fixture tests, the reset-label pattern guard, `TestRunOp_EmptyCherryPick_Reclassifies` and `TestRunOp_ResetMidMerge_IsRefused`.
2. `TestOpTable_UndoableKindsAreExactlyBranchTagDeleteStashDropResetAndCherryPick` passes with **five** kinds.
3. `bun run test:unit` passes, including `commands.test.ts` with zero `pending` entries for `reset`/`cherryPick`.
4. `bun run lint`, `bun run typecheck`, `bun run build:vscode` all pass. `bun run test:webview` passes **unchanged**.
5. `CONTRACT_VERSION` (TS) and `ContractVersion` (Go) are both **25**, and `git diff packages/git-ipc/src/contract.ts` shows exactly two added `UiActionKind` members and nothing else.
6. `packages/git-core/src/preflight/cherryPick.ts`, its test, `undo/slot.ts` and its test no longer exist; `packages/git-core/src/preflight/reset.ts` **does**.
7. Manual `op.run` smoke over a raw socket for both kinds.

### 7.2 Tier 2 — provable here as a reasoned check

8. The client's own flow is correct by inspection, not re-tested — two `runUiAction` cases.
9. `previewResetMode` still agrees with the server — checked once by comparing outputs, not trusted.

### 7.3 Tier 3 — needs a human on a Mac, with VS Code and Kira Studio both running

10. All three reset modes end to end from the graph row menu.
11. A conflicting cherry-pick end to end.
12. An empty cherry-pick.
13. Command palette entries.
14. Two windows on one repo, undo attribution suffix.

### 7.4 The checklist

- [ ] `opTable` has seventeen entries; five are `Undoable`.
- [ ] `commands.test.ts` passes; no `pending` entry for `reset` or `cherryPick`; `MutatingEntry`'s union member reads `'unassigned'`.
- [ ] `ClassifyReset`/`ClassifyCherryPick` pass all 15 + 16 ported cases.
- [ ] A reset attempted mid-merge is refused **and `MERGE_HEAD` survives**.
- [ ] A `--hard` reset's token is re-checked against a **freshly recomputed** `destroys`.
- [ ] Every reset's undo replays the **same mode**; a `--no-commit` pick offers none; a conflicting or empty pick offers none.
- [ ] The reset undo label matches `/^Reset \((soft|mixed|hard)\) to /`, asserted by a Go test.
- [ ] `packages/git-core/src/undo/` no longer exists; `preflight/reset.ts` does.
- [ ] `CONTRACT_VERSION` / `ContractVersion` are both 25; the contract diff is two `UiActionKind` members.
- [ ] No file under `packages/git-ui/` changed except `App.vue`'s two new cases.

---

## 8. Explicit non-goals for G22

- **`tagPush` / `tagDeleteRemote`** — F11's askpass blocker; §9/§10.2.
- **Multi-commit cherry-pick.**
- **A fourth reset mode.**
- **Any redesign of the two dialogs, the banner, or the undo button.**
- **A Go port of `canRunOp`/`GATED_OP_KINDS`.**
- **A new `OpErrorKind`.**
- **`reset --hard`'s reflog surfacing.**

---

## 9. Handed forward

- **`tagPush` / `tagDeleteRemote` are now orphaned in fact, not just in label.** F11's concrete blocker: `RunOp`'s write path has no askpass wiring. **Recommendation: move both to `remote.run`** (a `CONTRACT_VERSION` bump and a client change), rather than threading `*Conn`/`RemoteDeps` through every `opTable` entry's `Prepare` signature. §10.2.
- **`gitops/errors.go`'s `_ = exitCode` placeholder** stays true after this phase.
- **The reset classifier now lives in two languages** (D3/D12). Anything that later moves pre-flight shapes to codegen should make `previewResetMode` a generated client of the Go one.
- **`preflight/reset.ts` and `preflight/tag.ts` are all that remain of SPEC §5's `git-core` trim.**

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 Keeping `classifyReset` alive in TypeScript alongside its Go port.** **Recommendation: keep it, as built here**, with D12's paired twin comments and §7.2's three-mode agreement check as the guard. `previewResetMode` is a pure recompute over a snapshot the client already holds — a round trip would buy nothing but latency.

**10.2 `tagPush` / `tagDeleteRemote` — declined again, but this time with a named blocker and a named fix.** **Recommendation: leave them out of G22**, relabel `'unassigned'`, and record the recommended fix (move both to `remote.run`) in §9 for whoever picks them up next.

**10.3 Widening `opSpec.Reclassify` rather than giving cherry-pick a bespoke post-op path.** **Recommendation: widen it.** One parameter, one ignored argument at the only existing call site, zero behaviour change for the thirteen kinds with `Reclassify: nil`.

**10.4 One extra status spawn inside `prepareReset`/`prepareCherryPick`.** **Recommendation: keep both.** The pre-write read is the only thing that can gate on state as it is now, and the fresh-`destroys` recompute is a safety requirement, not an optimization target.

**10.5 `currentHead` read from `status --branch`'s `branch.oid` instead of a separate `rev-parse HEAD`.** **Recommendation: keep the saving.** Unborn HEAD withholds the undo record, which is correct.

**10.6 Cherry-pick's `commitPaths` reusing `CommitDetail` rather than a lean `diff-tree`.** **Recommendation: reuse `CommitDetail`** — cached, matches upstream, already handles rename both-names correctly.

**10.7 The mode-matched reset undo, and what it still does not restore.** **Recommendation: ship as designed** — the client already tells the user this per mode via `composeUndoTooltip`'s three-string table, which is why the label format is load-bearing and gets a Go guard test.

**10.8 A refused `reset --keep` undo surfaces as `Unknown`.** **Recommendation: leave it** — matches upstream; a named kind would cost a second `CONTRACT_VERSION` bump in this phase for a message the user already sees in full via git's own stderr.
