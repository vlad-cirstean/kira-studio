# P319 code review, round 2

Base: `707fc77` (`docs: remove P313 findings`). Tip reviewed: `34eae88`.

Scope: `git diff 707fc77..HEAD` — P314-P318 plus round-1 fixer commits `b961e34..8090d2e`, treated as
unreviewed. Checked each round-1 fix for regressions, missed call sites, races and error paths. Fresh
pass over P316 harness (selector, run pinning, agentmcp grants), P317 rewrite/hedge gate, P318 githost
(registry, host state caches, viewed sync, RefPath), migrations 0040-0044 (both apps), docs vs code.

Round-1 fixes confirmed sound: grant config, user MCP, sandbox tools and outcome texts pinned to the
run's provider (ADE `superviseAgent`, `prepareWithGrant`, scriptruns `plan`/`launchSmart`/`applySandbox`);
every `agentLaunch` sets `agent`; notification label from the session row; viewed-sync plan names the
host CLI on every early status; `gitHostProvider` validation; `memory.models` checked against the wired
registry; `RefPath` on both providers; prose gate punctuation carry. No High or Medium findings.

## Findings

### 1. Low — host cache generation read after host resolution (race the guard targets)

`apps/kira-space/internal/gitsession/changerequests.go:427`, `:458`, `:501` (callers of
`hostRepo`, `:348-380`).

What: `fetchSnapshot`, `ResolveCommitChangeRequests` and `resolveBranchChangeRequest` call `hostRepo`
first, then read `e.host.generation()` under a second lock acquisition. The field comment (`:75-76`)
says a fetch captures `gen` before calling the host; the provider it calls was resolved before `gen`
was read.

Scenario: request X resolves provider P1 under setting `github`. User switches the repo to `forge`.
Request Y calls `hostRepo`, sees the changed setting, runs `resetCaches` (`gen` 1 to 2). X now reads
`gen` = 2, calls P1, and its `commitCachePut`/`branchCachePut`/`snapshotPut` lands in generation 2. P1's
facts serve under the forge choice until TTL (10 min commit, 5 min branch/snapshot). Same shape: a slow
`hostRepo` from before the reset writes `setting`/`provider` back at `:374-377` after Y's write.

Fix: return `gen` from `hostRepo`, read under the same `e.host.mu` hold that reads or writes
`provider`/`repo`; drop the separate `generation()` calls. Guard the write at `:374-377` with the `gen`
captured at `:350` (skip the write when it moved).

### 2. Low — a remote that moves to another host or repo keeps the old repo's cached facts

`apps/kira-space/internal/gitsession/changerequests.go:180-185` (`markStale`), `:372-379`.

What: `refsChanged` only clears `remoteChecked`. The next `hostRepo` re-resolves and overwrites
`provider`/`repo`, but resets caches only when the setting changed. A different resolved provider or
repo is not compared.

Scenario: `git remote set-url origin` from `github.com/acme/a` to `forge.test/acme/b` (or another
GitHub repo). Commit, branch and snapshot entries of the old repo stay as stale-but-served:
`ResolveCommitChangeRequests` returns repo A's change requests (with A's URLs) for a sha, and the
stale snapshot badges a local branch whose name and owner match an open change request of repo A,
until the background refresh lands. P318's stated rule (ARCHITECTURE "Git host abstraction"; `hostRepo`
doc: "nothing crosses hosts") covers the setting path only.

Fix: in `hostRepo`'s write block, when a previous resolution exists and `provider.ID()` or `repo`
differs from the new one, call `resetCaches` before storing (it bumps `gen`, so in-flight puts drop too).

### 3. Low — fresh TUI launch resolves the active provider twice

`apps/kira-space/internal/ade/launches.go:292` and `apps/kira-space/internal/ade/tracker.go:245-261`.

What: for a fresh launch (`pa.Provider == ""`), `prepareWithGrant` calls `agentFor("")` (one
`Active()` read) to render the grant's MCP config and `--allowedTools` names. `Tracker.Prepare` then
calls `Active()` again to build the CLI command, and honours `args.Provider` only when `args.Resumes`
is set.

Scenario: `agent.provider` changes between the two settings reads. The CLI of provider B starts with
an MCP config file written in provider A's format and A's tool names; the grant tools are missing or
the launch fails. Same root cause as round-1's pinning fix, one call site left.

Fix: in `prepareWithGrant`, after resolving `agent`, set `pa.Provider = agent.ID()`. In `Prepare`,
resolve `t.deps.Agent.For(args.Provider)` whenever `args.Provider != ""` on a non-resume launch, not
only with `Resumes`.

### 4. Low — stored run's sandbox reason names the active provider

`apps/kira-space/internal/ade/sandbox.go:487`.

What: `RunSandbox` reports a past run's "not enforced" reason with
`agentsandbox.NotEnforcedText(b.deps.Agent.Active())`. The run ran under the provider stored on its
`ade_sessions` row (`InsertHeadless` writes `Provider`).

Scenario: run under provider A; setting moves to B; the run's sandbox detail says B ran without the
sandbox. Same root cause as round-1 finding (provider pinned per run), missed read path. `:429`/`:432`
describe future runs and correctly use `Active()`.

Fix: resolve the run's session (`run.SessionID` via `Sessions.Get`) and use `Agent.For(rec.Provider)`;
fall back to `Active()` only when no session row exists.

### 5. Low — first repo-settings save after opening a repo drops every change request fact

`packages/git-ui/src/state/changeRequests.ts:149-160`, `:170`.

What: `setRepoId` sets `#hostSetting = undefined`. The `repoSettings.changed` payload is the full
snapshot, so its `kiraSpace.gitHost.provider` is always a string. The first event for the repo
compares `'auto' !== undefined`, treats it as a host change, and runs `#clear()`.

Scenario: open a repo (stashed facts restore at once, `:174-181`), open Repo Settings, change only the
page size, save. Every `bySha`/`byBranch` fact and branch badge vanishes; the selected commit
re-requests and branches re-resolve lazily. Undoes the stash-restore that `setRepoId` just did. Happens
once per repo switch.

Fix: seed `#hostSetting` with the repo's current setting at `setRepoId` (pass a getter over
`RepoSettingsState.settings` into the constructor, or read it from the first `repoSettings.changed`
only after `RepoSettingsState` has loaded). Treat `undefined` as unknown: record the value without
clearing.

## Counts

High 0, Medium 0, Low 5.
