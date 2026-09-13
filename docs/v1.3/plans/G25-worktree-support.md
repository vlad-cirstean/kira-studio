# G25 — Worktree support: create/list/switch/remove, and the prepare script

> **What this phase is.** The twenty-fifth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the second of the chapter's from-scratch design phases (G24 was the first). **There is no upstream implementation and no upstream design document to port.** Upstream's `docs/plans/` contains `P0`–`P11`, `P15`, `P16` and no `P14`; upstream's own `docs/plans/README.md:7` says so in as many words ("Phase 14 is worktree support (`SPEC.md` §10), not planned yet"), and upstream's `SPEC.md:2196` is a placeholder row whose entire deliverable column reads *"Not designed yet — planned in full only when this phase's turn comes up, after P13."* Its exit criteria column reads *"To be defined at design time."* This plan is that design time.
>
> **What already exists, and is the whole reason this is a small phase and not a large one.** G5 shipped the *read* half of worktree awareness in full: `RepoSummary.IsLinkedWorktree`, `%(worktreepath)` in the ref format, `RefRow.CheckedOutIn`, `subtractOwnWorktree`, the `worktreeConflict` `CheckoutBlocker`, `WorktreeConflict`'s `OpErrorKind` and its stderr row, and the client's `worktreeBranches` set and branch-row badge. This phase turns that read-only awareness into management: three new git verbs, two new `opTable` entries, two new pure classifiers, one new event, one new Go package — and **one genuinely novel, safety-sensitive feature the SPEC names by name: the prepare script.**
>
> **The prepare script is the phase's centre of gravity, not a footnote.** It is the only place in this entire chapter where the app executes code the user wrote, rather than `git` with a fixed argv. Every spawn discipline this codebase has exists precisely because the app never shells out. This feature is asked to. D9–D14 design that honestly: **a shell is used, and that is the correct answer, because no app-supplied value is ever interpolated into the command string** — the distinction between "a shell over data" (an injection bug) and "a shell over the user's own command" (the feature) is the whole safety argument, and it is made explicitly rather than assumed. The remaining safety work is where the script text may live (D10: never anywhere a repository can carry it), what proves the user has seen it (D11: a sha256-pinned approval, re-checked immediately before the spawn — G22's `confirmToken` pattern, reused), and what the process can reach (D12: scrubbed env, no tty, no write gate, bounded output, hard timeout, group kill).
>
> **`CONTRACT_VERSION` 27 → 28** (D16), claimed explicitly here so no later phase claims 28 blind.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `27f8f9b0` (G1–G24 complete, working tree clean).

| Claim | Evidence |
|---|---|
| Upstream never designed P14 — no plan file, only a SPEC placeholder row | `ls /home/user/vlad-cirstean/kira-version-vscode/docs/plans/` → `P0…P11,P15,P16`, no `P14`; `docs/plans/README.md:7`; `docs/SPEC.md:2196` |
| G5's linked-worktree detection is exactly two things: `IsLinkedWorktree`, and the `%(worktreepath)` subtraction that produces `checkedOutIn`/`worktreeConflict` | `gitclient/repo.go:212-217`; `porcelain/refs.go:16`, `:146`, `:169`; `gitsession/refs.go:99-113`; `gitpreflight/checkout.go:96-98` |
| Nothing anywhere runs, parses or models `git worktree` itself | `grep -rn "worktree" internal/gitops internal/gitclient/porcelain` → only `refs.go`'s `%(worktreepath)`; no `WorktreeListArgs`, no parser, no op kind |
| `opTable` serves seventeen kinds; `RunOp` is the write executor; `Repo.Write` is exclusive | `gitsession/ops.go:123-215`, `:668-739`; `gitclient/repo.go:100-123` |
| `remote.run` is the house pattern for a long, cancellable, progress-streaming operation | `gitsession/remote.go:23-78`, `:297-383`, `:339-348`; `gitrpc/remote.go:64-96` |
| `ghclient` is the house precedent for spawning a non-git binary: its own package, its own Runner seam, its own hygiene env, timeouts, output caps, group-kill | `ghclient/runner.go:17-21`, `:48-58`, `:106-160` |
| Per-repo settings live server-side in this app's own SQLite, in a generic `(repo_id, key, value)` table | `storage/migrations/0017_g18_git_repo_settings.sql`; `storage/repos/gitreposettings.go` |
| `MutatingAction` is a total `Record` over `OpRequest['kind']` — a new op kind is a compile error until it has a palette command | `apps/kira-studio-vscode/src/commands.ts:29`, `:52` |
| `OP_ERROR_TEXT` is a total `Record<OpErrorKind, string>` — a new error kind is a compile error until it has a phrase | `git-ui/src/state/liveAnnouncements.ts:135` |
| An event reaches the webview through: server `Conn.Emit` → `ConnectionManager.on` → `panelView.notify*` → webview bridge | `gitsession/conn.go`; `extension.ts:503-505`; `panelView.ts:107-113`; `git-ui/src/state/ops.ts:227` |
| The watcher watches `commonDir`, `gitDir` and `commonDir/refs/**` — `commonDir/worktrees/**` is in neither list | `watcher.go:28-38`, `:52-70`; `watcher_fsnotify.go:47-56` |
| `CONTRACT_VERSION` is 27 (G24) | `packages/git-ipc/src/validate.ts:61` |
| Git floor is 2.38 | `gitclient/discovery.go:16-19` |

**Probes run against real git 2.43.0, read-only** (this repo has a linked worktree, making the read side fully probeable):

| # | Question | Observed |
|---|---|---|
| P1 | `git worktree list --porcelain -z` framing | `worktree <path>\0HEAD <sha>\0branch <refname>\0\0` — attributes NUL-terminated, an extra NUL ends each record, the stream ends on a double NUL |
| P2 | Is `-z` available at the 2.38 floor? | `-z` added in git 2.36.0, below the floor — unconditionally safe |
| P3 | `--porcelain -v` | Rejected: `fatal: options '--verbose' and '--porcelain' cannot be used together` |
| P4 | Per-repo or per-worktree fact? | Per repository — identical output from either worktree, main first |
| P5 | Flag surface at 2.43 | `add [-f] [--detach] [--checkout] [--lock [--reason <s>]] [--orphan] [(-b|-B) <branch>] <path> [<commit-ish>]`; `remove [-f] <worktree>` — `-f` is its only flag; `list [-v | --porcelain [-z]]` |
| P6 | `rev-parse` inside a linked worktree | `--absolute-git-dir` → `<common>/worktrees/<name>`, `--git-common-dir` → `<common>`, `--show-toplevel` → the worktree path — `Identify` already produces a correct `RepoSummary` for a worktree; "switch" needs no new server machinery |
| P7 | `git worktree prune -n -v`, nothing prunable | Exit 0, no output |
| P8 | Subcommand set | `add`, `list`, `lock`, `move`, `prune`, `remove`, `repair`, `unlock` |

**Probes the implementer runs first (mutating), with the expected result stated so a mismatch is visible:**

| # | Command | Expected |
|---|---|---|
| M1 | `worktree add <existing non-empty path> <branch>` | `fatal: '<path>' already exists` ⇒ existing `"already exists"` row → `AlreadyExists` |
| M2 | `worktree add <path> <branch-checked-out-elsewhere>` | `fatal: '<branch>' is already used by worktree at '<path>'` ⇒ existing row → `WorktreeConflict` |
| M3 | `worktree add -b <existing-branch> <path>` | `fatal: a branch named '<b>' already exists` ⇒ `AlreadyExists` |
| M4 | `worktree remove` on a dirty worktree | `fatal: '<path>' contains modified or untracked files, use --force to delete it` ⇒ new row → `DirtyWorktree` |
| M5 | `worktree remove` on a locked worktree | `fatal: cannot remove a locked working tree, lock reason: <reason>` ⇒ new row + new kind `WorktreeLocked` |
| M6 | `worktree remove` on the main worktree | `fatal: '<path>' is a main working tree` ⇒ left `Unknown`; pre-flight blocks it first |
| M7 | `worktree remove` on a directory already deleted | Decides D8's `prunable` arm |
| M8 | `worktree add <path>` with no commit-ish | DWIM creates `basename <path>` branch — confirms D3's decision never to rely on it |
| M9 | Does `worktree add` write checkout progress to stderr? | Decides whether creation itself needs an `OnStderr` tee |

### 0.2 Scope

1. **`internal/gitclient/porcelain/worktree.go`** (new) — `WorktreeListArgs()`/`ParseWorktreeList`, the `--porcelain -z` parser.
2. **`internal/gitops/worktree.go`** (new) — `WorktreeAddArgs`, `WorktreeRemoveArgs`; two new rows in `errors.go`.
3. **`internal/gitpreflight/worktree.go`** (new) — `ClassifyWorktreeAdd`, `ClassifyWorktreeRemove`.
4. **`internal/gitprepare`** (new package) — the prepare script's execution seam.
5. **`internal/gitsession/worktree.go`** (new) — orchestration, the prepare slot, `RunPrepare`/`CancelPrepare`; `entry.go`/`ops.go`/`registry.go` edits.
6. **`internal/gitrpc`** — five new handlers, `ContractVersion` 27 → 28.
7. **`internal/gitclient/watcher.go`/`watcher_fsnotify.go`** — one new classify arm, one new watch directory.
8. **`internal/storage`** — two new settings leaves and a server-only approval key; no migration.
9. **`packages/git-ipc`** — six requests, one event, two `OpRequest` kinds, one `OpErrorKind`, two capabilities, one `UiActionKind`, two settings leaves; `CONTRACT_VERSION` 28.
10. **`packages/git-core`** — two `SETTINGS` definitions.
11. **`packages/git-ui`** — `state/worktrees.ts`, `WorktreeDialog.vue`, `WorktreeList.vue`, the prepare-progress strip, `ops.ts` wiring, `App.vue`, one `liveAnnouncements` phrase.
12. **`apps/kira-studio-vscode`** — `worktree.openWindow` answered locally, two new capabilities, the progress forward, two palette commands.

### 0.3 Not in this phase

`git worktree move`/`repair`/`prune`/`lock`/`unlock`; `--orphan`/`--no-checkout`/`--lock`/`--track`/`--guess-remote`; forcing a branch already checked out elsewhere onto a worktree (`worktree add -f` — G28's "auto-detach" answer); auto-running the prepare script anywhere except right after a creation this app performed or an explicit "Re-run"; any claim of sandboxing beyond what D12 actually implements; a worktree-aware unified graph; editing `docs/v1.3/SPEC.md`.

### 0.4 Ground rules

Design decisions are decisions, not defaults — there is no upstream to defer to. `CLAUDE.md` in full: no stubbed error handling, no skipped validation. The prepare script's own code is held to the same standard as the git spawn path: named constants, an explicit env table with a reason per entry, a `Runner` seam so tests never spawn a real shell, a golden argv test.

---

## 1. Findings

### F1 — No upstream design exists; this chapter's own SPEC row assigns it here

Confirmed by `ls` on upstream's `docs/plans/` and by upstream's own placeholder text. No probe log, no reference implementation — the evidence base is this app's own code plus the probes above.

### F2 — G5's worktree work is a read of one field, and it is exactly the field this phase needs

`%(worktreepath)` → `RefRow.CheckedOutIn` → `worktreeConflict`/`WorktreeConflict` is already computed, crossed as data, and rendered. `PreflightWorktreeAdd` reads it from the same fresh `refsSnapshot` checkout pre-flight uses, with no new spawn. What's absent is the inverse mapping (worktree → branch/HEAD/lock/prunable) — `git worktree list`'s job, this phase's first parser.

### F3 — `worktree add`/`remove` fit `RunOp` exactly; the prepare script does not, and must not run under `Repo.Write`

Both git verbs are fast, local, non-interactive writes wanting exactly what `RunOp` already provides. The prepare script is the opposite on every axis: unbounded duration, user-authored, cancellable, streaming. Running it inside `Repo.Write` would hold the repository's exclusive gate for minutes, blocking every read in every window — the worst blocking outcome the concurrency model names. The two halves cannot share a mechanism.

### F4 — `remote.run` is a complete template for the long half

A per-repo slot with claim/release/cancel, throttled progress via `conn.Emit`, always-read-back on exit, a detached ctx. Every property wanted verbatim, plus a hard timeout no remote op has, and always-killable (unlike a push, a killed script leaves a knowable, re-runnable state).

### F5 — `ghclient` is the precedent for "a non-git binary gets its own package"; the prepare script needs the same plus streaming

Putting a shell inside `gitclient` would falsify its own doc comment ("no shell anywhere in this path"). `internal/gitprepare` is a new leaf package.

### F6 — "Switch to a worktree" needs no server-side mechanism at all

`Identify` run against a linked worktree already yields a correct, distinct `RepoSummary` with its own `RepoID` (the worktree root). Each worktree is already its own `RepoEntry`. "Switch" is the existing `repo.open`. What's genuinely absent is the editor half — `vscode.openFolder` — answerable only by the extension.

### F7 — `git worktree remove` has two hazards git cannot catch: this session's own root, and another window's

`Registry` has no "is this repoId open" query. One small addition (`IsOpen`) turns an invisible cross-window footgun into a named pre-flight blocker.

### F8 — A removed worktree's files are not recoverable by any git argv

`UndoRecord.Replay` restores refs; a worktree removal deletes files, some of which (modified/untracked) cannot be re-materialised by any argv. Both new kinds are `NotUndoable`; the destructive one gets G22 D8's typed-confirmation pattern instead.

### F9 — `worktree add`/`remove` is only half-visible to the watcher; the detached case is invisible

`classify` recognises `commonDir/refs/**`, `gitDir/index`, and ten basenames. A detached `worktree add`/`remove` writes only under `commonDir/worktrees/<name>/`, which matches none of those — a real, pre-existing G5-era gap this phase makes reachable.

### F10 — The per-repo settings store is the one place a script may live where a repository cannot carry it

A value in `git_repo_settings` is local, absolute-path-keyed, written only through `repoSettings.set` — cloning a hostile repository can never populate it. Residual exposures: a paired client could write it, or the user could be socially engineered into pasting one. D11's approval gate addresses both.

### F11 — A "prepare script" restricted to a single argv is not a smaller attack surface, only a smaller feature

Realistic scripts are `npm ci && cp ../.env .env` — never a single executable. Restricting the field pushes users toward `#!`-scripts committed inside the repository, the one place F10 says the payload must never live. The property actually worth protecting is "no app-supplied value is ever interpolated into a command string" — preserved by passing the command as one argv element and app data through the environment.

### F12 — The environment a spawned process inherits is not neutral

`GIT_DIR`/`GIT_WORK_TREE`/`GIT_CONFIG_*`/`GIT_ASKPASS`/`SSH_ASKPASS`/`KIRA_ASKPASS_*` all carry either mis-targeting or credential-handle risk if inherited into a user script.

### F13 — The progress plumbing exists end to end and has exactly one shape

`Throttle` → `conn.Emit('remote.progress')` → `ConnectionManager.on` → `panelView.notify*` → webview bridge → `AppToolbar.vue`'s progress strip. Six files, one pattern, reused rather than duplicated.

### F14 — Two totality guards will fail to compile the moment this phase adds its kinds, by design

`MUTATING_COMMANDS`/`commands.test.ts` and `OP_ERROR_TEXT` are both total mappings — the compile error is the safety net, not a bug to route around.

### F15 — `RepoSettingsSnapshot` is a wire type, so the approval record cannot live in it

The approval sha must be unwritable through `repoSettings.set` (else self-approval is possible) — it lives as a server-only key in the same generic table, read/written through two dedicated methods, absent from the wire triple entirely.

### F16 — `$SHELL` versus `/bin/sh` is a real functional fork

A Finder/launchd-launched server inherits a minimal environment; `npm`/`pnpm`/Homebrew binaries typically resolve only through a login shell's profile. `/bin/sh -c` fails for a large fraction of users on their first attempt. D9 uses the login shell, with `/bin/sh` fallback, and states the cost (profile-sourcing time inside the timeout budget).

---

## 2. Decisions

### The git half

### D1 — `worktree.list` is its own read method over its own porcelain parser, with `-z` unconditionally

One spawn (`git worktree list --porcelain -z`), never cached — F9's watcher gap means a cache would be the stale thing users notice first.

```ts
export interface WorktreeEntry {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly isBare: boolean;
  readonly isDetached: boolean;
  readonly isMain: boolean;
  readonly isCurrent: boolean;
  readonly locked: { readonly reason: string } | null;
  readonly prunable: { readonly reason: string } | null;
  readonly openElsewhere: boolean;
}
```

### D2 — `worktreeAdd` and `worktreeRemove` are `OpRequest` kinds served by `opTable`, not a new `worktree.run`

```ts
| { readonly kind: 'worktreeAdd'; readonly path: string; readonly mode: 'existingBranch' | 'newBranch' | 'detach';
    readonly branch: string | undefined; readonly startPoint: string | undefined; }
| { readonly kind: 'worktreeRemove'; readonly path: string; readonly force: boolean;
    readonly confirmToken: string | undefined; }
```

Deliberately no `force` on add — its only real use enables exactly the hazard G5's `worktreeConflict` machinery exists to prevent; G28 owns the right answer.

### D3 — Three creation modes, always explicit; the DWIM is never relied on

`existingBranch` / `newBranch` (`-b`) / `detach` (`--detach`), each with `--` before the path, each with an explicit commit-ish (never bare DWIM). The dialog pre-fills a basename suggestion visibly instead.

### D4 — `WorktreeAddPreflight`: five blockers, three notes, no new spawn beyond the worktree list

Blocker order: `invalidPath`, `pathExists`, `branchCheckedOutElsewhere`, `branchExists`, `unknownStartPoint`. `pathInsideRepo` is a note, not a blocker (git allows it; blocking a legal action would be this app deciding for the user).

### D5 — Neither worktree op is gated on an in-progress operation

`worktree add`/`remove` never touch this worktree's HEAD/index/state files. Stated as a decision since every mutating phase since G5 added such a gate.

### D6 — "Switch" is `repo.open`; the editor half is one new extension-answered request and one new capability

Switch = existing `repo.open`. "Open in New Window" = new `worktree.openWindow`, answered locally by the extension via `vscode.openFolder`, gated by capability `openWorktreeWindow`. `forceNewWindow: true` is the default offered (same-window `openFolder` tears down the extension host mid-request).

### D7 — New-branch mode reuses `validateRefName`, client-side, as four dialogs already do

No new validation, no `check-ref-format` spawn.

### D8 — `WorktreeRemovePreflight`: three hard blockers, two soft, a dirty route, typed confirmation

```ts
export type WorktreeRemoveBlocker =
  | { readonly kind: 'notAWorktree'; readonly path: string }
  | { readonly kind: 'mainWorktree' }
  | { readonly kind: 'currentWorktree' }
  | { readonly kind: 'openInAnotherWindow' }
  | { readonly kind: 'locked'; readonly reason: string };
```

`notAWorktree` is also the security check that guarantees the app never runs a destructive command against a caller-supplied arbitrary path. `mainWorktree`/`currentWorktree` are unconditional — no force route unlocks them. `openInAnotherWindow` names its remedy, no force route. Dirty gets `verdict:'dirty'`, a `force` route, and a typed confirmation (the worktree's basename) re-checked host-side immediately before the write — G22 D8's exact mechanism.

### D9 — The prepare script runs through a login shell, as a single argv element, with zero interpolation

**The setting is one string: a command line.** Not a path, not an argv array.

```
argv[0] = <shell>          // $SHELL when set, absolute, executable; else /bin/sh
argv[1] = "-l"             // omitted for the /bin/sh fallback
argv[2] = "-c"
argv[3] = <the script text, verbatim, as ONE argv element>
```

**The script text is never concatenated with, formatted into, or joined to any other string.** No `Sprintf` anywhere on this path — asserted by a golden test and a grep.

**Why a shell at all**: the codebase's argv-only rule protects against *injection* — data becoming code. That hazard doesn't exist here: the command string is not data, it is the user's own command, and no app-supplied value is placed inside it.

**Why argv-only is rejected**: it doesn't remove the shell, it relocates it into a `#!`-script *inside the repository* — the one place D10 exists to keep payloads out of. Net-negative for security.

**App data reaches the script only via environment**: `KIRA_WORKTREE_PATH`, `KIRA_WORKTREE_BRANCH`, `KIRA_REPO_ROOT`, `KIRA_REPO_COMMON_DIR`, `KIRA_PREPARE=1`. A malicious branch name becomes an environment *value*, subject only to word-splitting, never re-parsed as a command.

**Login shell, `/bin/sh` fallback**: makes `npm`/`pnpm`/Homebrew resolve for a Finder-launched server. Cost accepted: profile-sourcing time inside the timeout budget.

### D10 — The script text may live in exactly one place, and no repository can reach it

`kiraVersion.worktree.prepareScript` is `source: 'repo'`, stored in `git_repo_settings`. Never read from `git config`, `.git/`, any tracked file, a conventional path, or `.vscode/settings.json`. Empty means the feature is off — no spawn, no shell, no prepare step. Second leaf, `kiraVersion.worktree.basePath` — pure UX, pre-fills the dialog's path field.

### D11 — A sha256-pinned approval, re-checked immediately before the spawn

`prepareScriptApprovedSha` is a server-only key in `git_repo_settings`, absent from `GitRepoSettings`/`GitRepoSettingsPatch`/`RepoSettingsSnapshot` — `repoSettings.set` cannot write it. Editing the script clears the approval in the same transaction. The dialog always shows the full text; the "Run" checkbox defaults on iff approved. `worktree.prepare` carries `scriptSha256`; the server re-reads and recomputes, refusing with `ScriptChanged` on any mismatch, before any spawn.

### D12 — What "sandboxing" actually means here, stated exactly

No container, no seatbelt profile, no capability dropping exists in this app. What's actually implemented: cwd validated against the repo's own `worktree list`; never runs implicitly; an explicit env scrub/add table; stdin closed; `Setsid` + group SIGTERM→SIGKILL; a 15-minute hard timeout; bounded (256 KiB/500 lines) and sanitized (control/ANSI-stripped) output; never under `Repo.Write`; ≤1 run per repository; a workspace-trust gate; the full text always shown before an unapproved run. `internal/gitprepare`'s package doc states this table plainly rather than implying isolation that doesn't exist.

### D13 — `worktree.prepare` is a long, cancellable, streaming method modelled exactly on `remote.run`

```ts
'worktree.prepare':       { params: { repoId, path, scriptSha256 }, result: WorktreePrepareResult }
'worktree.cancelPrepare': { params: { repoId }, result: { cancelled: boolean } }
```

Server order: detach ctx → claim the ≤1 prepare slot (else `AlreadyRunning`) → resolve script (empty ⇒ `NotConfigured`) → re-check digest (mismatch ⇒ `ScriptChanged`) → verify path is a real worktree (⇒ `NotAWorktree`) → spawn outside `Repo.Write`, streaming sanitized lines via a throttled `worktree.progress` event → release slot, return result. Progress surfaces in a live output pane in `WorktreeDialog.vue`, with an `AppToolbar` strip when the dialog is dismissed (reusing the existing `remote.progress` strip shape). Always cancellable.

### D14 — Two host capabilities; workspace trust gates the script

`openWorktreeWindow` (true under VS Code); `runPrepareScript` (VS Code: `vscode.workspace.isTrusted`; harness: true). Trust is extension-side by necessity — the Go server has no notion of it. Stated explicitly as defence in depth, not the primary control (D10/D11 are).

### D15 — One new `OpErrorKind`, one new stderr row, one reused kind

`"contains modified or untracked files"` → `DirtyWorktree` (reused). `"locked working tree"` → **`WorktreeLocked`** (the phase's one new kind — folding it into `LockHeld` would print the wrong remedy). `"is a main working tree"` gets no row — the pre-flight blocks it first.

### D16 — `CONTRACT_VERSION` 27 → **28**

6 requests (`worktree.list`, `preflight.worktreeAdd`, `preflight.worktreeRemove`, `worktree.prepare`, `worktree.cancelPrepare`, `worktree.openWindow`); 1 event (`worktree.progress`); 2 `OpRequest` kinds; 1 `OpErrorKind`; 2 capabilities; 1 `UiActionKind`; 2 `RepoSettingsSnapshot` leaves.

### D17 — The watcher learns about `commonDir/worktrees`, in two lines

One `classify` arm recognizing `commonDir/worktrees/**` as `refsChanged`; one new fsnotify watch directory. Fixes F9's G5-era gap, reachable only now that this phase lets the app create worktrees.

### D18 — `internal/gitprepare` is a new leaf package; `gitsession/worktree.go` owns the orchestration

`gitprepare` imports stdlib only, knows nothing about repositories/sessions/git — testable without a real shell via a fake `Runner`. Policy (which script, approval, legal paths, the slot) lives in `gitsession/worktree.go`, the same `gitops`(mechanism)/`gitsession`(policy) split the chapter uses throughout.

---

## 3. The Go side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 3.1 | `internal/gitclient/porcelain/worktree.go` | new | `WorktreeRecord`, `WorktreeListArgs`, `ParseWorktreeList` |
| 3.2 | `internal/gitclient/porcelain/worktree_test.go` | new | Golden bytes (P1), locked/prunable, newline-in-path, truncated input |
| 3.3 | `internal/gitops/worktree.go` | new | `WorktreeAddArgs`, `WorktreeRemoveArgs` |
| 3.4 | `internal/gitops/errors.go` | edited | Two rows (D15) |
| 3.5 | `internal/gitpreflight/worktree.go` | new | The two wire types, `ClassifyWorktreeAdd`, `ClassifyWorktreeRemove` |
| 3.6 | `internal/gitpreflight/worktree_test.go` | new | Blocker ordering/combination tables |
| 3.7 | `internal/gitprepare/{doc,script,runner,output}.go` | new | The full execution seam (D9/D12) |
| 3.8 | `internal/gitprepare/{runner,output}_test.go` | new | Golden argv, env scrub/add, cancellation, line-splitting/sanitizing/eviction |
| 3.9 | `internal/gitsession/worktree.go` | new | `Worktrees`, both preflight methods, both `Prepare` funcs, the prepare slot, `RunPrepare`/`CancelPrepare` |
| 3.10 | `internal/gitsession/ops.go` | edited | Two `opTable` entries, both `NotUndoable`; `OpRequest` gains `Path` |
| 3.11 | `internal/gitsession/ops_test.go` | edited | Kind count → nineteen; new confirmation-refusal test |
| 3.12 | `internal/gitsession/entry.go` | edited | One `prepare` field; teardown cancels it |
| 3.13 | `internal/gitsession/registry.go` | edited | `IsOpen(repoID) bool` |
| 3.14 | `internal/gitrpc/worktree.go` | new | Five handlers |
| 3.15 | `internal/gitrpc/{wire,handlers,contract}.go` | edited | Params, switch arms, `ContractVersion` 28 |
| 3.16 | `internal/gitclient/{watcher,watcher_fsnotify}.go` | edited | D17's two lines + test case |
| 3.17 | `internal/storage/model/gitreposettings.go`, `internal/storage/repos/gitreposettings.go` | edited | Two leaves, the server-only approval methods, clear-on-change |
| 3.18 | Not edited | — | `gitclient/runner.go`, `gitclient/repo.go`, `gitpreflight/undo.go`, `gitrpc/ops.go`, `gitwire/*` |

---

## 4. The TypeScript / Vue side, file by file

| # | File | New/edited | What |
|---|---|---|---|
| 4.1 | `packages/git-ipc/src/contract.ts` | edited | Ten new types, six requests, one event, kinds/capabilities/settings (D16) |
| 4.2 | `packages/git-ipc/src/validate.ts` | edited | `CONTRACT_VERSION = 28`, key maps |
| 4.3 | `packages/git-core/src/settings/schema.ts` | edited | Two `source:'repo'` definitions, security-literate description text |
| 4.4 | `packages/git-ui/src/state/worktrees.ts` | new | `WorktreeState` |
| 4.5 | `packages/git-ui/src/components/dialogs/WorktreeDialog.vue` | new | Create phase + preparing phase (live output, Cancel/Open/Close) |
| 4.6 | `packages/git-ui/src/components/WorktreeList.vue` | new | Fourth `BranchPicker` section |
| 4.7 | `packages/git-ui/src/components/BranchPicker.vue` | edited | Mounts the new section |
| 4.8 | `packages/git-ui/src/state/ops.ts` | edited | `runWorktreeAdd`/`runWorktreeRemove`, prepare lifecycle |
| 4.9 | `packages/git-ui/src/components/AppToolbar.vue` | edited | Preparing-worktree strip |
| 4.10 | `packages/git-ui/src/App.vue` | edited | Dialog mount, `createWorktree` action, Switch handler |
| 4.11 | `packages/git-ui/src/state/liveAnnouncements.ts` | edited | `WorktreeLocked` phrase |
| 4.12 | `apps/kira-studio-vscode/src/ports/windows.ts` | new | `openFolder` wrapper |
| 4.13 | `apps/kira-studio-vscode/src/proxyHandlers.ts`, `extension.ts`, `panelView.ts` | edited | `worktree.openWindow`, two capabilities, progress forward |
| 4.14 | `apps/kira-studio-vscode/src/commands.ts`, `package.json` | edited | Two palette commands |
| 4.15 | Not edited | — | `gitwire.fbs`, `codec.ts`, `preflight/*`/`model/*`, review-side files |

---

## 5. Dependencies and tooling

Nothing new. `git worktree` is ordinary git below the 2.38 floor; the shell is the OS's; `crypto/sha256`/`os/exec` are stdlib.

---

## 6. Implementation order

1. Probes M1–M9 against a scratch fixture, recorded in the commit message.
2. `porcelain/worktree.go` + test.
3. `gitops/worktree.go` + `errors.go`'s two rows.
4. `gitpreflight/worktree.go` + test — pure, fully provable before session wiring.
5. `internal/gitprepare` in full + its two tests — highest-risk code, its own reviewable commit.
6. Storage: two leaves, the approval key, clear-on-change.
7. `gitsession/worktree.go`, `entry.go`, `registry.go`, `ops.go`'s two entries, `ops_test.go`.
8. `gitrpc`'s five handlers, `ContractVersion` 28. Manual smoke including a deliberately failing prepare script.
9. Watcher's two lines + test case.
10. `packages/git-ipc` + `git-core`'s schema — expect `tsc` breaks in `commands.ts`/`liveAnnouncements.ts` (F14), fix them.
11. `packages/git-ui`.
12. The extension.
13. Full check pass.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `go test ./apps/kira-studio/internal/...` passes: worktree-list golden corpus, both classifier tables, `gitprepare`'s argv/env/output tests, the confirmation-refusal test, the watcher case.
2. `opTable` has nineteen entries; exactly five `Undoable`; both new kinds `NotUndoable` with real reasons.
3. `bun run test:unit` passes, including `commands.test.ts` cross-checked against Go's `opTable`.
4. `bun run lint`, `bun run typecheck`, `bun run build:vscode`, `bun run test:webview` all pass.
5. `CONTRACT_VERSION`/`ContractVersion` both 28; contract diff matches D16 exactly.
6. The prepare argv is asserted byte-for-byte by a golden test in both shell branches; a grep over `internal/gitprepare` finds no `Sprintf`/`+`/`strings.Join` reaching `argv[3]`.
7. The env scrub list is asserted: a base env containing `GIT_DIR`/`KIRA_ASKPASS_TOKEN`/`GIT_CONFIG_GLOBAL` produces none of them in the child's env.
8. `repoSettings.set` with a `prepareScript` patch clears the stored approval; `RepoSettingsPatch` has no approval field.
9. A `worktree.prepare` with a mismatched `scriptSha256` answers `ScriptChanged` and spawns nothing (fake `Runner` fails the test if called).

### 7.2 Tier 2 — reasoned check

10. Manual raw-socket smoke: all three create modes, list, remove (clean/dirty-blocked/dirty-forced), prepare (success/non-zero/cancel/timeout).
11. Worktree badges refresh in a second connection after the first creates a detached worktree.

### 7.3 Tier 3 — needs a human on a Mac

12–17. `npm ci` prepare script streaming and cancel; switch in-app then open in new window; Restricted Mode disables the prepare section; editing the script un-approves it; removing a worktree open in another window is blocked; both palette commands.

### 7.4 The checklist

- [ ] `opTable` has nineteen entries; five undoable; both new kinds carry a real reason.
- [ ] The prepare argv is exactly `[shell, ("-l",) "-c", script]`, proven by a golden test.
- [ ] No app-supplied value appears inside the script string; all travel as env vars.
- [ ] The script setting is `source:'repo'`, stored only in `git_repo_settings`.
- [ ] The approval sha is not on the wire, and is cleared in-transaction on any script edit.
- [ ] `worktree.prepare` re-checks the digest before spawning.
- [ ] The prepare run holds neither `Repo.Read` nor `Repo.Write`; ≤1 per repository; cancellable; timeout enforced; output bounded and sanitized.
- [ ] `worktree remove` cannot remove the main worktree, this session's own worktree, or one open elsewhere — with or without `--force`.
- [ ] A dirty forced removal requires a typed token re-checked against a freshly-read status.
- [ ] `commonDir/worktrees/**` produces `refsChanged`.
- [ ] `CONTRACT_VERSION`/`ContractVersion` both 28.

---

## 8. Explicit non-goals for G25

`worktree move`/`repair`/`prune`/`lock`/`unlock`; `worktree add -f`; `--orphan`/`--no-checkout`/`--lock`/`--track`/`--guess-remote`; any undo for either new op; a multi-worktree graph; running the prepare script implicitly; any sandbox claim beyond D12; reading a prepare script from the repository; a second progress surface.

---

## 9. Handed forward

`git worktree unlock` has no op — if needed, a trivial `NotUndoable` third kind. G28 owns the "already checked out elsewhere" auto-detach answer, applicable to `worktree add` too. The prepare script is per-repository only; an instance-wide default is the obvious next request (recommendation: keep approval per-repository even then). `worktree.prepare` is the first RPC running non-git code — any future one should reuse `internal/gitprepare`. `Registry.IsOpen` is the first cross-connection registry query.

---

## 10. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it.*

**10.1 — The prepare script's execution model. (The big one.)** Alternatives: (a) single executable + argv, no shell; (b) script-file-path only; (c) `/bin/sh -c`; (d) `$SHELL -l -c`. **Recommendation: (d), exactly as D9** — (a)/(b) relocate the shell into a repo-committed `#!`-script (net-negative for security); (c) fails for many real macOS users (`npm: command not found`, F16). The property actually protected — no data-to-code injection — is preserved perfectly by (d). If overridden, the fallback is (c) plus loud `PATH` documentation.

**10.2 — Storing the script only in the app's own per-repo DB, never anywhere a repository can carry it.** **Recommendation: as designed (D10).** Free (G18 built the store), and the single highest-value safety property in the feature.

**10.3 — The sha256-pinned approval, re-checked immediately before the spawn.** **Recommendation: keep it (D11).** ~40 lines; the only thing making "confirm before first run" true rather than aspirational.

**10.4 — Workspace trust gating the prepare script, extension-side only.** **Recommendation: gate it (D14)**, explicitly as defence in depth, not the security model.

**10.5 — Progress into the webview dialog and toolbar strip, not a VS Code terminal/output channel.** **Recommendation: webview (D13)** — one existing event path, works in the harness, output where the action started.

**10.6 — Both worktree ops `NotUndoable`, typed confirmation on remove.** **Recommendation: as designed (F8/D8).** No honest replay exists for destroyed uncommitted files.

**10.7 — Two new settings (`prepareScript` and `basePath`) rather than one.** **Recommendation: ship both** — `basePath` is the most droppable item if scope needs trimming, but costs little and removes real friction.

**10.8 — Fixing the watcher's `commonDir/worktrees` blind spot here.** **Recommendation: fix it (D17)** — two lines, one test, otherwise this phase's own effects are invisible to other windows in the detached case.
