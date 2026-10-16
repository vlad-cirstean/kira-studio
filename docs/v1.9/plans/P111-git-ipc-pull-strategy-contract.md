# P111 — implementation plan: pull-strategy `rebaseMerges` on the `git-ipc` wire

SPEC row: `docs/v1.9/SPEC.md` phasing table, P111. Origin: P108 Part 16 F6 (`a2d64e2`), named open
item in `## P108 Part 16 result`. Also owns `plans/P108-part17-findings.md`'s "P111 overlap" note
(unvalidated `strategySetting`/`strategy`). Opus plans, one sequential Sonnet implementer lands it.
No review-findings stage. Tree surveyed: `2f6b61b`.

Paths repo-relative. `PI` = `apps/kira-space/internal`. `GI` = `packages/git-ipc/src`. `GC` =
`packages/git-core/src`. `GU` = `packages/git-ui/src`. Line numbers are at `2f6b61b`; re-check each
before editing.

## 0. Goal and acceptance

SPEC acceptance, verbatim intent:

1. An explicit Kira Space pull-strategy override of "rebase" never adds `--rebase-merges`, even when
   git config says `pull.rebase=merges`. "Explicit override" covers both ladder steps above config:
   the per-invocation pick (`PullStrategyPicker.vue`'s `runWith`, source `explicit`) and the stored
   `kiraSpace.pull.strategy` setting (source `setting`).
2. A git-config-derived "merges" resolution (`branch.<name>.rebase` or `pull.rebase` = `merges`/`m`,
   winning the ladder) still adds `--rebase-merges`.

Plus the Part 17 overlap: `remote.pullPreflight`'s `strategySetting` and `remote.run`'s `strategy`
get validated against the TS literal sets at the gitrpc layer.

## 1. The bug, as it stands at `2f6b61b`

- `GU/state/ops.ts:1570` `runPull` always sends a concrete `strategy` to `remote.run`: either the
  user's pick or `preflight.strategy`. Wire cannot tell the two apart.
- `PI/gitsession/remote.go:566` `runPullOp` calls `wantsRebaseMerges` (`:752`) for a rebase. That
  re-spawns `git config`, re-runs `ResolvePullStrategy(nil, RepoSettings().PullStrategy, cfg)` and
  applies `--rebase-merges` when the fresh source is `branchConfig`/`pullConfig`.
- `explicit` is hard-coded `nil` there. So: setting `auto`, config `pull.rebase=merges`, user picks
  "Rebase" from the chevron menu. Server re-derives source `pullConfig`, adds `--rebase-merges`.
  Acceptance 1 fails. The `setting` case already works (Part 16 F6), but only by re-reading the
  setting a second time.
- Side effects of the re-derivation: a second `git config` spawn per pull, and a window where config
  or setting changes between preflight and run so the executor's answer differs from what the
  preflight showed (breaks §7.3's "what is shown is what runs", which `runPull`'s own doc claims).

## 2. Design decision: a `rebaseMerges` boolean, not a resolution source

Two shapes were on the table (SPEC row). Pick the boolean.

**Chosen: `rebaseMerges: boolean`**, computed once by `remote.pullPreflight` from the same config
read that resolved the strategy. Returned on `PullPreflight`. Client passes it into `remote.run`
only when it runs the preflight-resolved strategy; an explicit pick sends `false`. Executor reads
`params.RebaseMerges` and never re-derives.

Why not the source enum (`"override" | "config" | "default"`, or reusing `PullStrategySource`):

- The executor would still need to re-read config to learn *which* key said `merges`. The second
  spawn and the preflight-to-run drift both survive. The SPEC row's point is to stop re-deriving.
- `PullPreflight.source` already carries the ladder's source to the client. Adding it to
  `remote.run` would make the server trust a client-sent provenance label and then act on
  server-side config anyway: two sources of truth for one decision.
- A boolean is the decision itself, same shape as `plainForce` (the other "which argv" flag on
  `RemoteOpParams`). It is exactly what `gitops.RebaseArgs(upstream, rebaseMerges bool)` already
  takes.

Staleness: `rebaseMerges` goes stale exactly as `strategy` already does (both come from one
preflight). That is §7.3's intended contract, not a new hazard.

A raw socket client may send `rebaseMerges: true` with its own explicit `strategy: "rebase"`. That
is a legitimate git option the client asked for by name, not a config-derived guess. Allowed. The
acceptance concerns Kira Space's own UI path, enforced in `runPull` (§5.3).

## 3. Wire contract change

### 3.1 Fields

| Where | Go | TS |
|---|---|---|
| `PullPreflight` result (`remote.pullPreflight`) | `` RebaseMerges bool `json:"rebaseMerges"` `` (always emitted — D5 encoding rule, result fields never omitted) | `readonly rebaseMerges: boolean;` |
| `RemoteOpParams` (`remote.run`) | `` RebaseMerges bool `json:"rebaseMerges,omitempty"` `` (matches sibling `PlainForce`) | `readonly rebaseMerges: boolean \| undefined;` (matches sibling `plainForce`) |

Semantics, to state in both doc comments:

- `PullPreflight.rebaseMerges`: `true` only when `strategy` is `rebase`, `source` is `branchConfig`
  or `pullConfig`, and the key that won the ladder holds `merges`/`m`. `false` otherwise, including
  every `explicit`/`setting`/`default` source.
- `RemoteOpParams.rebaseMerges`: `pull` + `strategy: "rebase"` only. `true` runs
  `git rebase --rebase-merges`. `false`/`undefined` runs a plain, linearizing `git rebase`.
  `undefined` for every other kind.

No FlatBuffers change. `GI/generated/gitwire/` holds only the graph chunk types
(`packed-commit-chunk`, `row-decorations`, `decoration-ref`, `payload`, `frame`); both pull methods
are JSON.

### 3.2 `ContractVersion` 40 → 41: yes

- Policy: `docs/ARCHITECTURE.md:2693` — hard lockstep, one number, sole compatibility authority. Every
  prior field addition bumped (G28's `checkout.autoStash` `OpRequest` field; G30's `BranchChanged`
  error kind). No precedent for an unversioned field addition.
- Real hazard, not ritual: an old client omitting `rebaseMerges` against a new server silently turns
  every config-derived `merges` pull into a linearizing rebase. That is the "quiet degradation" the
  version gate exists to turn into a blocking panel (G10 D9 reasoning, restated at P100 Part 3).

Edit both constants in the **same commit** (§6 C2):

- `PI/gitrpc/contract.go:162` `const ContractVersion = 40` → `41`. Add a history line above it:
  `// P111: 40 -> 41, one new PullPreflight field (rebaseMerges) and one new remote.run param
  (rebaseMerges) -- the pull executor stops re-deriving --rebase-merges from config and takes it
  from the preflight the client already ran. No new request, no new event, no SQL migration.`
- `GI/validate.ts:158` `CONTRACT_VERSION = 40` → `41`. Same history line, in that file's style.
- `docs/ARCHITECTURE.md:2694-2696`: "**40** today, since P100 Part 3's…" → "**41** today, since
  P111's pull `rebaseMerges` field…". `:2842`: "`ContractVersion` (40 as of this chapter)" → 41.

No hard-coded `40` literal exists in any test (grep at `2f6b61b`); gitsock tests, `gitstream.go:221`
and the vscode test servers all read the constant.

## 4. Go side

### 4.1 `PI/gitpreflight/pull.go`

- `PullPreflight` (`:37`): add `` RebaseMerges bool `json:"rebaseMerges"` `` after `Source`.
- `ClassifyPullInput` (`:136`): add `RebaseMerges bool`. `ClassifyPull` (`:149`) copies it through
  unchanged (pure pass-through, like `Source`).
- New pure function, next to `WantsRebaseMerges`:

  ```go
  // ResolveRebaseMerges reports whether a ladder result should rebase with --rebase-merges: only
  // when config itself chose to rebase, and the winning key said "merges"/"m".
  func ResolveRebaseMerges(strategy PullStrategy, source PullStrategySource, cfg PullConfigValues) bool {
  	if strategy != PullRebase {
  		return false
  	}
  	switch source {
  	case SourceBranchConfig:
  		return WantsRebaseMerges(cfg.BranchRebase)
  	case SourcePullConfig:
  		return WantsRebaseMerges(cfg.PullRebase)
  	default:
  		return false
  	}
  }
  ```

  This is `gitsession.wantsRebaseMerges`'s switch (`remote.go:759-769`) moved into the package that
  owns the ladder, minus the I/O.
- Doc comments to update (stale after this phase): `MapRebaseValue` (`:62-65`, "Exported … so
  gitsession's own executor can re-derive") and `WantsRebaseMerges` (`:87-95`, "gitsession's own
  executor re-reads this SAME config value a second time"). Both stay exported (the external
  `gitpreflight_test` package calls them). Reword to name `ResolveRebaseMerges` as the caller. Keep
  terse.

### 4.2 `PI/gitsession/remote.go`

- `RemoteOpParams` (`:30`): add `` RebaseMerges bool `json:"rebaseMerges,omitempty"` `` after
  `Strategy`.
- `PullPreflight` (`:778`): after `ResolvePullStrategy` (`:784`), compute
  `rebaseMerges := gitpreflight.ResolveRebaseMerges(strategy, source, cfg)` and pass
  `RebaseMerges: rebaseMerges` in the `ClassifyPullInput` literal (`:809-811`).
- `runPullOp` (`:565-570`): replace the `wantsRebaseMerges` call and its error branch with
  `integrateArgv = gitops.RebaseArgs(upstream, params.RebaseMerges)`.
- Delete `wantsRebaseMerges` (`:724-770`) and its whole doc comment, including the "Known
  limitation" paragraph this phase resolves. After deletion, confirm `parsePullConfig` and
  `gitops.PullConfigArgs` still have a caller (`PullPreflight`) — they do.

### 4.3 `PI/gitops/pull.go`

`RebaseArgs` doc (`:17-20`): "the caller re-derives this from gitpreflight.WantsRebaseMerges" →
"the caller passes remote.run's own rebaseMerges param, resolved at preflight
(gitpreflight.ResolveRebaseMerges)". No code change.

### 4.4 `PI/gitrpc/remote.go` — validation (Part 17 overlap + new field)

Precedent: `validStashScope` (`PI/gitrpc/stash.go:21`) — a closed-vocabulary check in the handler's
validate closure, `ipcerr.BadRequest` on a miss, before any spawn.

`handleRemotePullPreflight` validate closure (`:19-27`), after `validRefArg`:

```go
if p.StrategySetting != "" && !model.ValidPullStrategy(p.StrategySetting) {
	return "", ipcerr.BadRequest("gitrpc: remote.pullPreflight: invalid strategySetting " + p.StrategySetting)
}
```

`model.ValidPullStrategy` (`PI/storage/model/gitreposettings.go:88`) is already exactly TS's
`PullStrategy | 'auto'` set (`contract.ts:1999`). Reuse it; do not add a second copy. Today an
unknown value such as `"bogus"` flows through `ResolvePullStrategy` step 2 and comes back as
`strategy: "bogus"`, `source: "setting"` — a value outside the TS `PullStrategy` union on the wire.

`handleRemoteRun` validate closure (`:74-92`), after the branch check:

```go
if !validPullStrategy(p.Strategy) {
	return "", ipcerr.BadRequest("gitrpc: remote.run: invalid strategy " + p.Strategy)
}
if p.RebaseMerges && (p.Kind != "pull" || p.Strategy != string(gitpreflight.PullRebase)) {
	return "", ipcerr.BadRequest("gitrpc: remote.run: rebaseMerges requires kind pull and strategy rebase")
}
```

with, in `remote.go` beside the handlers (mirrors `validStashScope`):

```go
// validPullStrategy is remote.run's own strategy vocabulary: @kira/git-ipc's PullStrategy union,
// plus "" (every non-pull kind sends none).
func validPullStrategy(s string) bool {
	switch gitpreflight.PullStrategy(s) {
	case "", gitpreflight.PullFFOnly, gitpreflight.PullMerge, gitpreflight.PullRebase:
		return true
	default:
		return false
	}
}
```

Today an unknown `strategy` silently falls into `runPullOp`'s `default:` arm and runs ff-only. The
`rebaseMerges` guard makes an ignored flag a caller error instead of a silent no-op.

Check `PI/gitrpc/remote.go`'s imports gain `ipcerr` and `model` (both already imported elsewhere in
the package — `stash.go`, `settings.go` — copy the exact import paths).

Out of scope here: validating `kind` itself. `RunRemote`'s `default:` arm already refuses an unknown
kind; the Part 17 note names only `strategySetting`/`strategy`.

## 5. TS side

### 5.1 `GI/contract.ts`

- `PullPreflight` (`:810`): add `readonly rebaseMerges: boolean;` after `source`, with a one-line doc
  (§3.1 semantics).
- `RemoteOpParams` (`:846`): add `readonly rebaseMerges: boolean | undefined;` after `strategy`,
  with a short doc (§3.1). Keep the existing field-order convention.
- `'remote.pullPreflight'` params (`:1992-2001`): doc on `strategySetting` says "injected by the
  extension" — stale since G18 D6/F14 (`proxyHandlers.ts:530` no longer injects). Reword to
  "optional; absent resolves this repo's stored `kiraSpace.pull.strategy` server-side; an unknown
  value is refused." This field is the one P111 now validates, so its doc must say so.

### 5.2 `GC` structural mirrors

`contract.ts:778-781` declares the P8 remote types "structural copies of `@kira/git-core`'s own".
Keep them in step:

- `GC/preflight/types.ts:103` `PullPreflight`: add `readonly rebaseMerges: boolean;`.
- `GC/model/remote.ts:42` `RemoteOpRequest`: add `readonly rebaseMerges: boolean | undefined;` with
  the same doc. Also fix the adjacent `strategy` doc (`:55-56`): "`undefined` lets the ladder
  decide" is false — Go's `runPullOp` `default:` arm runs ff-only for an empty strategy, and the only
  client always sends one. Reword: "`pull` only: the strategy to run — the preflight-resolved one,
  or the user's explicit pick."

No TS code imports either git-core type (grep at `2f6b61b`: no `from '@kira/git-core'` import of
`PullPreflight`/`RemoteOpRequest`), so these are type-only edits.

The `tests/unit/ipc/wireConformance.test.ts` that comment names does not exist. Not P111's to
restore; leave the comment alone.

### 5.3 `GU/state/ops.ts` — the one client

Five `remote.run` param literals. All need the new key (the type makes it required-with-undefined):

| Line | Kind | Value |
|---|---|---|
| `:1534` | fetch | `rebaseMerges: undefined` |
| `:1598` | pull (stash-and-carry path) | `rebaseMerges` (local below) |
| `:1620` | pull | `rebaseMerges` (local below) |
| `:1664` | push | `rebaseMerges: undefined` |
| `:1708` | forcePush | `rebaseMerges: undefined` |

In `runPull` (`:1570`), beside `strategy`/`source` (`:1578-1580`):

```ts
// An explicit pick is a plain strategy choice; only the config ladder carries git's own "merges".
const rebaseMerges = explicitStrategy === undefined ? preflight.rebaseMerges : false;
```

Never derive it from `strategy === 'rebase'` or from `source`; the server already decided.
Update `runPull`'s doc comment (`:1551-1569`): one sentence that `rebaseMerges` travels with the
preflight-resolved strategy and an explicit override always sends `false`.

Not touched: `PullStrategyPicker.vue`, `pullStrategyModel.ts`, `PullDialog.vue`,
`PullStrategyInfo`. Surfacing "rebase (preserving merges)" in the UI is not in the SPEC row.

### 5.4 Hosts — verified no change

- `apps/kira-space-vscode/src/proxyHandlers.ts:533-535`: `'remote.pullPreflight'` and
  `'remote.run'` are plain `forward(...)` (`:209-211`, passes `params` verbatim). The new field
  rides through. Part 20's closed state is the baseline; nothing to edit.
- `PI/bridge/gitstream.go:121,130`: method-level allowlist only. The one field-level guard,
  `guardRepoSettingsSet` (`:181`), covers `repoSettings.set`, not `remote.run`. `:221` reads
  `gitrpc.ContractVersion` by name. Nothing to edit.
- `apps/kira-space-vscode/src/commands.ts` imports `RemoteOpParams` for `['kind']` only. No edit.

## 6. Commit order

Each commit passes the pre-commit hook (`.githooks/pre-commit`) normally. Never `--no-verify`.
Stage only named paths; never `git add -A`/`.` (shared checkout).

- **C1** `fix(kira-space): validate pull strategy params at the gitrpc layer` — §4.4's
  `strategySetting` check and `validPullStrategy` for `remote.run`'s `strategy`. No wire shape
  change, no version bump. Independent of C2; lands first.
- **C2** `feat(git-ipc)!: carry rebaseMerges from remote.pullPreflight through remote.run` — the
  whole wire change, atomic so both sides and both version constants move together: §4.1-4.3, the
  `rebaseMerges` guard from §4.4, §5.1-5.3, §3.2's two constants, two history comments and
  `docs/ARCHITECTURE.md` edits. Deletes `TestWantsRebaseMerges` in
  `PI/gitsession/remote_test.go:477-583` (its method is gone; its cases move in C3). Adds
  `rebaseMerges: false` to every typed `PullPreflight` fixture the typecheck flags
  (`GU/state/ops.test.ts:~60`, `~215` at least). Footer: `BREAKING CHANGE: git-ipc contract 40 -> 41`.
- **C3** `test(kira-space): prove rebaseMerges follows the ladder, not an override` — §7.
- **C4** `docs(v1.9): close P111` — `## P111 result` section appended to `docs/v1.9/SPEC.md`, in the
  shape of prior result sections (commit hashes, what landed, verification run).

## 7. Tests

CLAUDE.md's bar: only genuinely complex logic. What qualifies here, and nothing else:

- **`PI/gitpreflight/pull_test.go`: `TestResolveRebaseMerges`**, one table test. Strategy × source ×
  two config keys is a decision structure with interacting rules, and it replaces five real-git
  subtests that tested the same rules through I/O. Rows (each asserts the bool):
  - rebase / pullConfig / `pull.rebase=merges` → true
  - rebase / pullConfig / `pull.rebase=m` → true
  - rebase / branchConfig / `branch.x.rebase=merges` → true
  - rebase / branchConfig / `branch.x.rebase=true`, `pull.rebase=merges` → false (winning key is
    not merges)
  - rebase / setting / both keys `merges` → false (acceptance 1, setting half)
  - rebase / explicit / both keys `merges` → false (acceptance 1, pick half)
  - rebase / default / nothing set → false
  - merge / pullConfig / `pull.rebase=false` → false
- **`PI/gitsock/remote_test.go:974` `TestIntegration_PullPreflightHonorsRepoStoredStrategy`**:
  extend, don't add a new test. Before the request, run
  `runRemoteGit(t, f.workDir, "config", "pull.rebase", "merges")`. Add the assertion
  `preflight.RebaseMerges == false`. Real socket, real git, stored setting "rebase" outranking
  config `merges` — acceptance 1 end to end on the server half.
- **`GU/state/ops.test.ts`**: one test, two calls. Script `remote.pullPreflight` to return
  `{ strategy: 'rebase', source: 'pullConfig', rebaseMerges: true, … }`. `runPull('origin', 'main')`
  → captured `remote.run` params have `rebaseMerges: true`. `runPull('origin', 'main', 'rebase')`
  → `rebaseMerges: false`. Justification: this is now the *only* place acceptance 1's pick half is
  enforced, and the same pick-vs-ladder confusion already slipped past two review rounds (Part 15
  F6, Part 16 F6). Reuse the file's existing `setUp`/transport harness; no new helper.

Not tested (guards below the bar): the two `ipcerr.BadRequest` checks, the `ClassifyPull`
pass-through, the argv choice in `runPullOp` (already covered by `gitops/pull_test.go`'s
`TestRebaseArgs_RebaseMerges`).

## 8. Conflict and risk notes

- Parts 10/11/12 may still be landing Studio-side (`apps/kira-studio/frontend/**`) in this
  checkout. Disjoint from every path here. On `.git/index.lock`, poll and retry.
- `PI/gitsession/remote.go` and `PI/gitrpc/remote.go` were last touched by Part 16/17 fixers.
  Re-read current source before each edit; line numbers here are `2f6b61b`.
- Go-side JSON decode of an old client's `remote.run` (no `rebaseMerges`) yields `false`. Harmless:
  the version gate refuses that client at handshake anyway (§3.2).

## 9. Verification (orchestrator runs each for real)

1. `go build ./... && go vet ./apps/kira-space/...`
2. `go test ./apps/kira-space/internal/gitpreflight/ ./apps/kira-space/internal/gitsession/
   ./apps/kira-space/internal/gitrpc/ ./apps/kira-space/internal/gitsock/ ./apps/kira-space/internal/bridge/`
3. `bun run typecheck` and `bun run lint`.
4. `bun test packages/git-ipc/src packages/git-core/src packages/git-ui/src apps/kira-space-vscode/src`.
5. Greps, each must match the stated count:
   - `git grep -n "wantsRebaseMerges" -- apps/kira-space` → 0 hits.
   - `git grep -n "ResolveRebaseMerges" -- apps/kira-space/internal` → a caller in
     `gitsession/remote.go` (not only the definition and test).
   - `git grep -n "params.RebaseMerges" -- apps/kira-space/internal/gitsession/remote.go` → 1 hit,
     in `runPullOp`.
   - `git grep -n "rebaseMerges" -- packages/git-ui/src/state/ops.ts` → 5 param literals + the
     `runPull` local.
   - `git grep -nE "ContractVersion = 41|CONTRACT_VERSION = 41"` → exactly 2 hits (Go and TS).
   - `git grep -n "40 today\|(40 as of" -- docs/ARCHITECTURE.md` → 0 hits.
6. `git diff --stat 2f6b61b..HEAD -- apps/kira-space-vscode/src/proxyHandlers.ts
   apps/kira-space/internal/bridge/gitstream.go` → empty (§5.4's no-change claim holds).
7. Webview/UI suites (`bun run test:webview`, `bun run test:ui:space`) once at phase end, per
   CLAUDE.md's "expensive suite once" rule — the contract bump touches the handshake every harness
   uses.
