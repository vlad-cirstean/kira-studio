# P209 code review

Base `dcdb20786` (docs(v2.0): close out P183 review and P184, the last review close-out in `git log`).
Head `809b46b67` (`v2.1-stream-F`). Scope: `git diff dcdb20786..HEAD`, 410 files: P185-P207, P208 audit
fixes. Commits by every stream treated as unreviewed.

Discovery: `codegraph_explore` (adeagent grants, setup runner, memory pipeline, quickcommands, PR cache,
BranchInventory), then reads and greps. Checks run: `go test -race ./internal/memory/... ./internal/docker/...
./internal/quickcommands/... ./internal/mcpinstall/...` all pass.

Counts: High 0, Medium 3, Low 8, Nit 1 group.

## Medium

### M1. Memory commit loop skips the staleness check after one fact re-decides

`internal/memory/service.go:175-182` passes one shared `rev` to every fact's `commit`. On `errStale`,
`redecide` (`:217-226`) sets `*rev` to the store's current revision and re-runs reconcile for that one fact
only. Every later fact in the request then commits against the refreshed `rev`, so `commitFact`'s check
(`store.go:299`) passes for decisions made before the foreign write.

Failure: a request carries facts A and B, both decided `add` at revision 5. Another Claude Code session's
`memory-mcp` process commits fact C (a restatement of B), revision 6. A commits: stale, re-decided, committed
(revision 7). B then commits with `rev` 7 and passes, adding a duplicate of C that reconcile never saw. The
revision guard exists for exactly this race.

Fix: when any fact hits `errStale`, refresh `rev`, then re-run `prepare` for every fact not yet committed and
one `reconcile` over those that need it, before the next commit. Keep the "own commit advances `rev`" rule
for the success path. Extend `service_test.go`'s stale case with two facts and a foreign insert between
them (concurrency ordering: meets the unit-test bar).

### M2. Every refs change re-asks GitHub for every branch the client ever looked at

`packages/git-ui/src/state/pr.ts:192-218`: `#revalidate` (refsChanged) and `setRepoId` (`:151`) re-request
`branch.resolvePr` for every key in `byBranch` plus every name in `#noBranchPr`. Server side,
`markStale` (`apps/kira-space/internal/gitsession/gh.go:167-172`) makes every cached entry stale, so each
of those requests that misses the open-PR snapshot (all of `#noBranchPr`, by definition) starts
`refreshInBackground("branch:"+name)` and one `gh api` call (`fetchBranchPr`, `gh.go:554`).

Failure: a user who opened the branch picker in a repo with 150 branches without PRs has 150 names in
`#noBranchPr`. P191 fetches every board repo and auto-fetch runs on a timer; each fetch that moves a ref fires
`refsChanged`, then 150 GitHub calls. A few fetches an hour exhaust the 5,000/h REST budget and arm the breaker,
which then blanks PR facts app-wide. Before P189 the client cleared and refetched lazily (only what a view
asked for).

Fix: revalidate only what is on screen. In `#revalidate`, re-request the selected commit and the branches
currently rendered (BranchPicker open, graph-visible tips); drop the rest of `byBranch`/`#noBranchPr` to
"unknown" without a request, so the next render asks lazily. Server side, let a per-branch "no PR" answer
stay fresh across `refsStaleAt` (a refs change cannot open a PR on GitHub; only the snapshot refresh can
reveal one), so a stale serve of a `nil` branch entry triggers no `fetchBranchPr`.

### M3. Docker exec open has no timeout

`internal/docker/exec.go:159-173`: `ExecCreate` and `ExecAttach` run on `context.WithCancel(context.Background())`;
every other engine call goes through `m.call` with `callTimeout` (`resources.go:170-178`). Window close
(`closeWindow`) only deletes the pending reservation; it never cancels this context.

Failure: an `ssh://` or `tcp://` engine that accepts the TCP connection but stalls (VPN drop, suspended VM)
blocks `ExecOpen` forever. The Wails call never returns, the terminal pane spins, and the goroutine plus the
ssh connhelper process leak for the app's life.

Fix: run create and attach under `context.WithTimeout(ctx, callTimeout)` for the dial only (attach's
hijacked stream must outlive it: use a separate context for the session, or `client.WithTimeout`-style dial
bound), and cancel the dial context from `closeWindow` through the pending entry (store the cancel func in
`pending` instead of only the window key).

## Low

### L1. Agent tool `branch_status` hides why a setup failed

`apps/kira-space/internal/ade/agenttools.go:132` builds `SetupInfo{State: row.State}`; `row.Note` (P202,
migration 0019) is dropped, so `SetupInfo.Note` is always empty. `branchInfo` (`:347-348`) tells the agent
"The worktree setup failed. Tell the user" with no reason.

Failure: an agent whose prepare script timed out reports "setup failed" with nothing to act on; P202 asked for
the reason wherever a setup runs.

Fix: `return adeagent.SetupInfo{State: row.State, Note: row.Note}`; append the note to `Next` when failed.

### L2. `branch_status` waiting spawns git once a second

`agenttools.go:357-370` polls `branchStatusOnce` every second for up to 600 s. Each poll runs `loadTaskCtx`,
`RepoConfig.List` and `worktreePath` → `BranchInventory` (`for-each-ref` over every local and remote
branch, uncached, `gitsession/queuefacts.go:22`).

Failure: an agent waiting on a 5-minute `npm ci` prepare script spawns ~300 `git for-each-ref` processes in a
large repo; several agents waiting multiply it.

Fix: resolve the branch and worktree once, then poll only `Tasks.GetSetup(sb.ID)` (one SQLite row) until the
state leaves `running`; read the worktree path once at the end.

### L3. A refused stage move still pins the workflow version

`apps/kira-space/internal/ade/runs.go:892` calls `snapshotWorkflow` before the stage lookup, the skipped-stage
check and `HasRunning` (`:914`). A not-started task whose move is refused is snapshotted anyway, so later
workflow edits no longer apply to it (P196: "a not-started task keeps following the live file").

Fix: in `SetTaskStage`, validate against `taskWorkflow` (live file for a not-started task) and check
`HasRunning` first; snapshot only right before `SetStage`. Same order in `StageDone` already holds.

### L4. Abandoned launch grants live until the next launch

`apps/kira-space/internal/ade/tracker.go:205-231`: an expired pending intent releases its MCP grant (bearer
token plus 0600 config file) only when a later `Prepare`/`hasPending` call prunes. With no later launch, a
grant for a never-mounted TUI (with Space tools: `request_branch`, `declare_repos`) stays valid until quit.

Fix: also prune on a timer (`time.AfterFunc(PendingTTL)` per intent, or the tracker's existing reconcile
tick) so expiry releases the grant without waiting for the next launch.

### L5. Insecure TLS engine shows no warning

`internal/docker/endpoint.go:186,199-205`: a TLS endpoint built with `InsecureSkipVerify` (context
`SkipTLSVerify`, or `DOCKER_CERT_PATH` without `DOCKER_TLS_VERIFY`) keeps `Secure: true`.
`EndpointChip.vue:82` shows the insecure badge only for `!secure`, so an unverified TLS daemon looks verified.

Fix: in the TLS branch set `ep.Secure = !skipVerify`.

### L6. Logs stream can outlive its view

`packages/docker-ui/src/components/LogsView.vue:89-123`: unmount (or a reopen) calls `logsClose(id)` while
`logsOpen(id)` may still be in flight. Wails runs bound calls concurrently, so `LogsClose` can reach Go before
`logsOpen` registers the stream (`internal/docker/logs.go` `add`); the close is a no-op and the `follow`
stream then runs until the window closes, emitting to a dead listener.

Fix: keep the `logsOpen` promise; in `close()`, await it (ignore its error) before `logsClose`.

### L7. Keep-awake recompute loads the whole session table

`apps/kira-space/main.go:451-466` `agentSessionCount` calls `AdeSessions.ListTask()` (every row ever, sorted)
to count running headless sessions, on every terminal agent change and every ADE sessions change, while
holding `KeepAwakeService.mu`.

Fix: add `AdeSessionsRepo.CountRunningHeadless()` (`SELECT count(*) ... WHERE state='running' AND
mode='headless'`) and use it.

### L8. Docker exec chips use raw icon buttons

`packages/docker-ui/src/components/ExecView.vue:48-58`: close and "New session" are raw `<button>`s with a bare
codicon, no tooltip. P207/P208 replaced the same pattern in ADE with `TooltipIconButton` (CLAUDE.md shadcn rule).

Fix: `TooltipIconButton` (codicon `close`, label "Close <title>") for close; shadcn `Button` `variant="ghost"`
for "New session".

## Nit (one doc-drift commit)

- `internal/quickcommands/service.go:5-8`: says each app's bridge is `struct{ *quickcommands.Service }`; both
  are wrapper structs with forwarding methods. Rewrite to match.
- `packages/workbench/src/util/useBusyAction.ts:4`: cites `ClaudeCodePane.vue`, deleted from Studio by P188.
- `apps/kira-space/internal/storage/migrations/0020_p204_custom_scripts.sql:2-3`: "Numbered 20 so the
  sequence stays ordered ... gaps are fine: LoadMigrations sorts" — 0017-0020 are contiguous and
  `embed.go` lists versions explicitly; drop the sentence.

## Dimensions with nothing real

- Security, beyond L4/L5: Space grants are per-launch tokens, tools resolve only the token's task, review
  tasks are refused, branch names go through `git check-ref-format --branch` plus main/integration checks.
  FTS5 input never reaches the parser as syntax (`BuildMatch` quotes every term). The gate runs `claude -p`
  with tools, MCP, settings and slash commands off, scrubbed session env, and Go-side validation of the
  output. memory.db is 0600 in a 0700 dir. No secrets logged.
- Migrations 0017-0020 (Space), 0031-0032 (Studio), memory 0001: ordered, additive, defaults safe.
- Duplication: `internal/quickcommands` replaced Studio's old model/repo with no leftover; `mcpinstall` move
  left no copy; Studio's docker FQN table is used by `e2e-real/support/passthrough.ts`, not dead.
- Docker stats hub, events watcher, exec/logs registries: teardown on close, window close and quit is
  complete; race tests pass.

No carried-forward items.
