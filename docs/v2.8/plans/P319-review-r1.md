# P319 code review, round 1

Base: `707fc77` (`docs: remove P313 findings`, P313 review close-out). Tip reviewed: `6796949`.
Diff: `git diff 707fc77..HEAD`, 551 files.

## Scope

Commits since base cover P314-P318 (P306-P312 landed before the base). Reviewed:

- P316 agent harness: `internal/harness` (registry, selector, roles), `internal/harness/claude`,
  `internal/agentmcp`, consumers in `apps/kira-space/internal/ade`, `internal/scriptruns`,
  `internal/memory`, appwire wiring, migrations Space 0040-0042 and Studio 0041-0042.
- P317 rewrite mode and gates: `internal/memory/importer/rewrite.go`, `rewrite_gate.go`,
  `distill.go`, `mcpserver/ingest.go`, `bridge/memorydistill.go`.
- P318 git host: `apps/kira-space/internal/githost` (registry, selector, github provider),
  `gitsession/changerequests.go`, `gitsession/viewedsync.go`, `ade/viewedsync.go`, `ade/board.go`,
  `bridge/githost.go`, `bridge/adetask.go` link validation, `gitrpc` host handlers and settings,
  migrations 0043-0044, `packages/git-ui/src/state/changeRequests.ts`, `AdeReviewSync.vue`.
- P314 memory model setting: settings model, `MemoryPane.vue`, `agentrunner.go`.

Clean, no finding: migrations 0040-0044 (rename-in-place, guarded `json_valid`, JSON-encoded
values match the leaf reader); harness and githost registries (immutable after construction, no
race); `Selector.For` gone-provider handling in ADE resume; `gh` argv building (paths escaped,
GraphQL strings via `-f`); `OpenChangeRequestURL` re-validation; rewrite input bounds (enforced in
Go, not only the MCP schema); `rewriteTwice` retry and error paths; snapshot single-flight. Focused
Go tests for the touched packages pass.

## Findings

### 1. med: run provider not pinned; MCP config and helpers use the active provider

Files: `apps/kira-space/internal/ade/board.go:189`, `apps/kira-space/internal/ade/runs.go:768-789`,
`internal/scriptruns/smart_run.go:51`, `:149`, `:173-176`, `internal/scriptruns/headless.go:38`,
`internal/scriptruns/sandbox.go:46`, `:81`, `apps/kira-space/internal/appwire/appwire.go:232`.

What is wrong: a run's provider is resolved once for its CLI (`l.agent`, `agent` from
`Selector.For`), but the grant config is rendered by `agentmcp.Server.Register` through a `Render`
closure that calls `Agent.Active()`. Smart runs also write the user MCP config, sandbox tool names
and the run row's `provider` from `Active()` at different moments. `smart_run.go:174` drops the
`For` error, so a resume whose stored provider is gone silently runs under the active provider.
Agent notifications name the active provider, not the session's.

Failure scenario: a user resumes an ADE session or smart run recorded under provider A after
`agent.provider` switched to B. The grant file is written in B's format and handed to A's CLI. A
cannot load Kira's MCP server, `finish_step` never arrives, the run ends failed. A queued smart run
stores provider A at `newRun` but launches under B after a setting change; a later resume then
picks A with B's session id and reports resume-lost. With a gone provider, the smart resume runs
B against A's session id instead of the `providerGone` error the ADE path returns. Today only
Claude is registered and the fake provider embeds Claude's MCP role, so no test catches it.

Fix: resolve the provider once per run and carry it. Add the provider to `agentmcp.Grant` (or
pass it to `Register`) and render with it. Use the pinned provider for `WriteUserMCPConfig`,
sandbox tool names and `run.Provider`. Return `providerGone` when `For` fails in `launchSmart`.
Pass the session's provider to `AgentLabel`. Add a flow case with a second provider whose MCP
config format differs from Claude's.

### 2. med: viewed sync "CLI missing" tooltip has no CLI name

Files: `apps/kira-space/internal/ade/viewedsync.go:58-69`,
`apps/kira-space/frontend/src/ade/v2/review/AdeReviewSync.vue:103`.

What is wrong: `computeSyncPlan` returns on `unavailable` before it sets `out.wire.Host`. The
`cliMissing` status only comes from that branch, so `plan.host` is always null there. The UI
renders `t('space.ade.review.sync.cliMissing.tooltip', { cli: data.value?.host?.cli ?? '' })`.

Failure scenario: `gh` is not installed. The review window's sync button tooltip reads
"Install the " with no tool named. `TestGitHubWithoutGh` (`adeflow/lifecycle_test.go:214`)
asserts the status but not the host.

Fix: call `entry.HostInfo` and set `out.wire.Host`/`out.provider` before the `switch res.Kind`.
Assert `plan.Host != nil` in the flow test, and the tooltip text in the UI spec.

### 3. low: prose gate drops punctuation glued to a hedge word

File: `internal/memory/importer/rewrite_gate.go:332-364` (`hedgeToken`, `proseKept`).

What is wrong: `hedgeToken` matches the hedge word plus trailing `\W*`, and `proseKept` skips the
whole field. Punctuation attached to the removed word vanishes from the expected word list.

Failure scenario (checked with a copy of the function): input `It is fast, really.`. The correct
draft `It is fast.` is rejected with `form`. The broken draft `It is fast,` passes. A sentence-final
hedge thus either loses the good rewrite or ships a dangling comma.

Fix: when a skipped hedge field carries trailing punctuation, require that punctuation on the
previous kept word of the draft (`It is fast,` vs `fast.` both checked against the input's final
`.`), or compare word cores with punctuation tokenized separately. Add the case to the gate's
table test.

### 4. low: `gitHostProvider` patch is not validated

File: `apps/kira-space/internal/storage/model/gitreposettings.go:119-135`.

What is wrong: `GitRepoSettingsPatch.Validate` checks every enum leaf except `GitHostProvider`.
Any string, any length, is stored. `""` is stored and read back as the default by `LeafValid`.

Failure scenario: a renderer bug or a stale client sends `"GitHub"` or a long string. It is
persisted, warned on each lookup ("unknown provider, detecting from remote"), and the settings
dialog shows a value no option matches.

Fix: accept `auto`, `off`, or `appsettings.ValidProviderID(v)`; reject anything else naming the
leaf, like `pullStrategy`.

### 5. low: host setting change does not revalidate change-request facts

File: `packages/git-ui/src/state/changeRequests.ts:147-149`.

What is wrong: the new `repoSettings.changed` handler reloads only `host`. Cached `bySha`,
`byBranch` and `#disabledForRepo` stay as they were.

Failure scenario: setting `off` makes the first lookup set `#disabledForRepo`. Switching back to
`auto` reloads the label, but no badge or detail appears until a refs change or repo switch.
Switching `auto` to `off` keeps every PR badge on screen while the labels turn neutral.

Fix: on a settings change for the current repo, call `#clear()` then `#revalidate()` (which
also reloads the host).

### 6. low: in-flight host fetch writes into caches reset by a setting change

File: `apps/kira-space/internal/gitsession/changerequests.go:327-355`, `:408-414`, `:436`, `:506`.

What is wrong: `hostRepo` calls `resetCaches` when the setting changes. A snapshot fetch or
background refresh already running under the old provider still calls `snapshotPut`,
`commitCachePut` or `branchCachePut` afterwards.

Failure scenario: with two registered hosts claiming one remote (e.g. GitHub and a GitHub
Enterprise-style second provider), the user switches the repo from one to the other mid-fetch. The
old provider's change requests land in the cache under the new setting and are served for the TTL.
Latent today with one real provider.

Fix: add a generation counter to `hostState`, bumped by `resetCaches`; capture it before each host
call and drop the put (and `finishSnapshotFetch` cache write) when it changed.

### 7. low: cancelled first lookup caches "no host" for the entry's life

File: `apps/kira-space/internal/gitsession/changerequests.go:340-353`.

What is wrong: a cancelled ctx fails `git remote get-url origin`, `remoteURL` stays `""`, and
`remoteChecked=true, resolved=false` is cached until the next refsChanged. Carried from the old
`githubRepo`, but the code was rewritten in this diff. `Discovery.Status` already skips its cache
write on a caller cancel for the same reason.

Failure scenario: the UI abandons the first `branch.resolveChangeRequest` (fast branch-picker
close, repo switch). Every later lookup for that repo answers `disabled` and the viewed sync says
"no remote on a known code host" until a fetch or commit.

Fix: return without caching when `ctx.Err() != nil` after the git spawn.

### 8. low: branch web URL is not path-escaped

File: `apps/kira-space/internal/githost/github/provider.go:103-105` (fake host mirrors it,
`flowharness/fakehost/fakehost.go:165`).

What is wrong: `BranchURL` concatenates the raw branch name. `#` and `%` are legal in a ref.

Failure scenario: branch `fix#12` yields `.../tree/fix#12`; the browser opens the repository's
default branch page with a `#12` fragment. A `%` in the name is decoded as an escape.

Fix: escape each `/`-separated segment with `url.PathEscape` and rejoin with `/`.

### 9. low: settings validation uses its own provider registry

File: `apps/kira-space/internal/storage/model/settings.go:384-391`.

What is wrong: `providerRegistry = providers.New()` is a package-level registry, separate from
the registry appwire wires (`Options.Providers`). `validMemoryModel` passes any alias for a provider
missing from that registry. Scripts take the wired registry through `scripts.Repo.Agents`; settings
does not.

Failure scenario: a provider registered through `Options.Providers` (the fake in flow tests, a
later real one) never has its `memory.models` entry checked: `memory.models.fake = "opus"` saves,
then `AgentRunner.model` warns and falls back to the default on every call.

Fix: validate `memory.models` in the settings bridge against the wired `harness.Registry`, or
inject the registry into the model validation the same way `scripts.Repo` does.

### 10. low: Claude names left in neutral code

Files: `apps/kira-space/internal/ade/tracker.go:147-149`, `:248-331`, `:444`, `:477`, `:568`,
`:610-611` (`claudeSessionID`, `claudeBin`), `apps/kira-space/internal/ade/runs.go:775`, `:886-893`
(`sessionClaudeID`, its comment), `:895` comment,
`apps/kira-space/internal/storage/repos/adesessions.go:185-186` (parameter `claudeSessionID`).

What is wrong: P316 made these paths provider-neutral, but the identifiers and comments still say
Claude. P316's own done check (`rg -n -i '...|ClaudeSessionID|...'`) matches them case-insensitively,
so the check P316 lists is not clean.

Failure scenario: a reader of the neutral ADE code assumes the value is a Claude-only id; the
plan's verification grep fails when re-run.

Fix: rename to `agentSessionID`, `agentBin`, `sessionAgentID`; reword the comments.
