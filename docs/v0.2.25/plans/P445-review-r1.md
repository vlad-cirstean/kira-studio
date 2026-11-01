# P445 review round 1 findings

Base: `4faeba79b66746df24aede9eeb70992430e734e1` (merge-base with `origin/main`). Head reviewed: `5e0a2bdd5`.
Scope: `git diff 4faeba79b..HEAD`, minus generated bindings, lockfiles and re-recorded PNG baselines.
Phases P436-P444. One Opus reviewer; findings only, no fixes.

Areas read: Kubernetes backend (`apps/kira-studio/internal/kubernetes/*`), `dbmcp/kube_tools.go`,
approval plumbing, Kubernetes frontend (`queries.ts`, `state.ts`, `LogsView.vue`, `ClusterMcpDialog.vue`,
`DatabaseMcpPane.vue`), Runs restore (`internal/scriptruns/restore.go`, `repo.go`, `service.go`,
`packages/workbench/src/restore/*`, `automations/restore/*`, Docker adapter), P444 claude harness
(`usermcp.go`, `headless.go`, `mcp.go`, `scriptruns` and `ade` callers, G5 guard), ADE close/restart
(`launches.go`, `runs.go`, `tracker.go`, `useSessionMenu.ts`, sessions list/menu), P442 gocognit splits and
version bumps, P443 `test-ui-changed.sh` and `hook-scope.sh` `ui_target_of`, P438 `ModeSwitcher.vue`.

Severity count: High 0, Medium 3, Low 6.

## Dimension 1: architecture, structure, maintainability, security

### F1 (Medium) Ticked user MCP server is checked from the app home but loaded in the run folder

- Where: `internal/scriptruns/preview.go:262` (`UserMCPServers(ctx, s.Home)`), `internal/scriptruns/mcp.go:11`,
  `internal/harness/claude/headless.go:63-81,123-128`.
- Summary: the picker and `smartBlocker` list servers with `claude mcp list` run in `s.Home`. The run itself
  starts claude in `p.dir.Path` (a script folder or a task worktree) with `--setting-sources user` and no
  `--strict-mcp-config`. `allowedMcpServers` matches by name only. Claude resolves a name local > project >
  user, so the server that loads is the one claude sees in the run folder, not the one the user ticked.
- Failure scenario: user ticks user-scope server `github`. A smart run starts in a repo worktree whose
  `.mcp.json` (or local scope for that folder) defines another `github` server. With user setting
  `enableAllProjectMcpServers: true`, claude starts the repo's command under the ticked name, and the run's
  `mcp__github` grant covers it. Repo content picks the command that runs. Smaller form of the same gap: a
  local-scope server for the run folder is never offered, and the blocker can pass for a name that does not
  resolve in the run folder.
- Proposed fix: list and check from the run folder (`UserMCPServers(ctx, p.dir.Path)` in `smartBlocker`;
  the picker can keep the home list as a hint). Pass the user scope explicitly where claude allows it, or
  add `enableAllProjectMcpServers: false` and `enabledMcpjsonServers: []` to the `--settings` JSON in
  `userMCPSettings` so project servers never load in such a run. Document the rule in ARCHITECTURE next
  to the P444 Known open item.

### F2 (Low) Kubernetes UI selection store validates persisted state by hand instead of zod

- Where: `apps/kira-studio/frontend/src/kubernetes/state.ts:19-31` (`rememberedSchema`).
- Summary: a hand-written `safeParse` stand-in. It checks only the top-level shape; `perCluster` entries
  are cast unchecked. The repo standard is zod for this (CLAUDE.md library rule); `usePersistedState`
  already takes a zod schema elsewhere.
- Failure scenario: a corrupted or older `kira.kubernetes.selection` value with `perCluster[id] = 1` passes
  the check; `remembered.value.perCluster[clusterId].kind` then reads `undefined`, and `remember()` spreads a
  number into the entry.
- Proposed fix: replace with `z.object({ clusterId: z.string(), perCluster: z.record(z.string(), z.object({ kind: z.string(), namespace: z.string().nullable() })) })`.

## Dimension 2: functional correctness and business logic

### F3 (Medium) Kubernetes logs view: overlapping `open()` calls leak a follow stream and mix two streams

- Where: `apps/kira-studio/frontend/src/kubernetes/components/LogsView.vue:70-117,127-140`.
- Summary: `close()` clears `streamId` and `off` synchronously, then awaits the in-flight `opening` and
  `LogsClose`. A second `open()` started during that await sees `streamId === ''`, returns from its own
  `close()` at once and opens stream B. The first `open()` then resumes, overwrites `off` and `streamId`
  with stream A. Listener B is never removed and stream B is never closed.
- Failure scenario: logs tab open, user arrows through pods in the resource table (or flips Previous then
  Timestamps quickly). Two `open()` calls overlap: stream B keeps following in Go until the window closes,
  its listener keeps appending B's lines into `lines`, and the view shows lines of two pods or two option
  sets while the toolbar shows the newest choice. `onBeforeUnmount` has the same hole: an unmount during an
  in-flight `open()` leaves the new stream running.
- Proposed fix: a generation counter. `open()` takes `const gen = ++generation` before `await close()`,
  returns if `gen !== generation` after each await, and closes its own stream id if superseded after
  `logsOpen` resolves. Unmount bumps `generation` too.

### F4 (Medium) ADE smart step with a removed user MCP server now runs without it

- Where: `apps/kira-space/internal/ade/runs.go:796-801`.
- Summary: before P444 `WriteUserMCPConfig` returned `ErrServerGone` and the step failed with
  "could not start". P444 sets `spec.UserMCP` with no presence check. Runs keep the check in
  `scriptruns.smartBlocker`; ADE smart steps have none.
- Failure scenario: user removes server `jira` from claude. A workflow step whose smart script ticks
  `jira` starts; claude loads no such server, `allowedMcpServers` silently has a dangling name, and the
  agent works without the tools the step depends on. It may finish the step with a wrong or partial
  result instead of failing loudly as before.
- Proposed fix: in `superviseAgent`, when `mcpNames()` is non-empty, call
  `agent.UserMCPServers(ctx, l.path)` and `fail(harness.ErrServerGone{...})` on a missing name, same text
  as the Runs blocker. Cover it in `adeflow/automation_test.go` with the fake CLI listing fewer servers.

### F5 (Low) Restored terminal script can vanish without a terminal

- Where: `packages/workbench/src/automations/restore/RunsRestoreDialog.vue:65-87`,
  `internal/scriptruns/restore.go:294-300`.
- Summary: for a terminal script, `Restore` calls `Start`, which returns a launch token, then `dropKey`
  removes the item from the offer. The dialog opens the terminal only if
  `ctx.scripts.records()` has the script; otherwise `openStarted` returns silently. The token then
  expires unused.
- Failure scenario: scripts store not loaded yet (restore reviewed right after start) or the script
  list refetch lags. The user confirms, the row disappears from the offer, no terminal opens, no run is
  recorded, no error is shown.
- Proposed fix: take `command`, `name` and `color` from the restore item (the backend already returns
  `ScriptName`, `Color`, `Command`), or from `started.terminal`, so `openStarted` never depends on the
  scripts store. If kept, surface an error instead of returning silently.

### F6 (Low) MCP log read is bounded only by the server's `limitBytes`

- Where: `apps/kira-studio/internal/kubernetes/mcpreads.go:55-72`.
- Summary: `io.ReadAll(body)` trusts the API server to honour `LimitBytes`. An aggregated API server,
  a proxy or an old kubelet that ignores it returns up to 5000 lines of any length; `Truncated` is then
  also wrong (it only checks `>=`).
- Failure scenario: a pod writing multi-megabyte single-line JSON logs behind a proxy that drops
  `limitBytes`; `kube_pod_logs` buffers all of it in memory and sends it all to the AI client.
- Proposed fix: `io.ReadAll(io.LimitReader(body, mcpLogBytes+1))`, set `Truncated` when the read exceeds
  `mcpLogBytes`, and trim to the last newline before `mcpLogBytes`.

## Dimension 3: performance and resource efficiency

### F7 (Low) Every Kubernetes call re-parses the kubeconfig; every MCP call writes the DB twice

- Where: `apps/kira-studio/internal/kubernetes/service.go:83-100,151-174`,
  `apps/kira-studio/internal/dbmcp/kube_tools.go:139-150,179`.
- Summary: `target()` runs `loadConfig` (stat plus full YAML parse of every kubeconfig file) and
  `signature()` (JSON marshal) on each list, describe, logs and status call. `Clusters()` runs
  `store.Ensure` (an `INSERT ... ON CONFLICT DO UPDATE`) per context, and `kubeRun` calls it twice per
  tool call (before and after approval), plus once more for `kube_list_clusters`.
- Failure scenario: a kubeconfig with dozens of contexts and the resource list polling every 10 s
  re-parses the file every poll; an AI loop of `kube_*` calls issues 2 x N SQLite writes per call.
- Proposed fix: cache the loaded config keyed on the files' mtime and size; in `resolveCluster` read the
  stored record by id (`store.Get`) and check it against the cached config instead of `Clusters()`.

### F8 (Low) Resource list polls a full re-list of up to 5000 rows every 10 s

- Where: `apps/kira-studio/frontend/src/kubernetes/queries.ts:7,82-106`,
  `apps/kira-studio/internal/kubernetes/list.go:55-104`.
- Summary: `refetchInterval` re-runs `List`, which pages the Table API up to `defaultListMax` (5000 rows,
  10 pages of 500) on every tick while visible, then ships the whole result over IPC.
- Failure scenario: all-namespaces pods on a large cluster: 10 API requests and a multi-MB IPC payload
  every 10 s per open view, steady load on the API server for an idle screen.
- Proposed fix: poll only while the list is under a row threshold, or back off (for example 30 s) when
  the previous result was truncated or large. A watch is out of scope for a read-only P439 surface; a
  slower interval is enough.

### F9 (Low) Preview and restore state can block up to 30 s on `claude mcp list`

- Where: `internal/scriptruns/preview.go:262`, `internal/harness/claude/usermcp.go:23,104-158`,
  `packages/workbench/src/automations/restore/restoreQueries.ts:12-23`.
- Summary: `smartBlocker` runs synchronously in `Preview` and in `RestoreState` (via `plan`).
  On a cache miss (30 s TTL) it spawns `claude mcp list`, which health-checks every user server, with a
  30 s timeout and `context.Background()`. The restore query refetches on every window focus.
- Failure scenario: one slow or hung user server makes the Run dialog preview and the restore banner
  wait up to 30 s after each TTL expiry; a timeout blocks the run with "could not list your Claude MCP
  servers" even when the ticked server is healthy.
- Proposed fix: pass the caller's context through `Preview`; on a list failure or timeout fall back to the
  last good list for that folder if one exists; consider a longer TTL for the presence check (names
  change rarely) while the picker keeps the short one for health status.

## Checked, nothing real found

- Secret redaction: `Describe` redacts `data`/`stringData` and drops `last-applied-configuration` for
  `v1/secrets`; the Table list returns only metadata columns. Kind keys resolve only through discovery, so
  no alias bypasses the `v1/secrets` check.
- Approval flow: unknown mode denies; prompt re-resolves the cluster and mode after the wait; fully denied
  clusters are hidden; defaults are `prompt` (migration 0051) per SPEC.
- G5 extension: covers `.claude.json` literals, `json:"headers"`, `mcp get` argv, header writes and
  `RoundTrip` under `internal/harness/claude`; `usermcp.go` reads no config file.
- ADE `CloseSession`/`restartHeadless`: `StopRun` waits for the process end before the task lock and the
  stuck-state check; TUI close holds `taskMu` across stop and close.
- P442 gocognit splits are behaviour-preserving; ONNX Runtime version strings updated everywhere.
- `ui_target_of`: unknown paths fall back to both apps; `packages/*` selects both; full-run triggers
  select both.

## Result

All nine fixed. Fast checks per commit (hooks) green. Targeted reruns: Go flows (kubeflow, dbmcpflow, studio+space termflow, adeflow), UI specs `kubernetes-module`, `kubernetes-mcp`, `automations-restore` (19 pass). Real claude: `bun run test:claude:studio -run TestSmartScriptRun` pass (0.0024 USD); new `--settings` keys accepted.

- F1 fixed (`2adbda9ec`). `smartBlocker` lists from run folder (nearest existing ancestor, since kira/worktree folders may not exist at preview). `userMCPSettings` adds `enableAllProjectMcpServers:false`, `enabledMcpjsonServers:[]`. Rule in ARCHITECTURE. Picker keeps home list.
- F2 fixed (`78abd6713`). zod schema.
- F3 fixed (`85e07768c`). Generation counter in `open()`, bumped on unmount. No dedicated test; existing reopen UI spec passes.
- F4 fixed (`039f157a8`). `smartStep.checkMCP` before `Register`; `ErrServerGone` fails the step. Flow test added in `adeflow/automation_test.go`.
- F5 fixed (`7e96bb103`). Dialog uses item `command`/`scriptName`/`color`; restore item `color` now `paletteColorSchema`.
- F6 fixed (`0b719462d`). `LimitReader`, trim to last newline, `Truncated` on overflow.
- F7 fixed (`a500979fe`). Kubeconfig parse cached by path/size/mtime; `Service.Cluster(id)` replaces `Clusters()` in `resolveCluster` (no SQLite writes per call).
- F8 fixed (`f4946b4d7`). Poll 30 s when result truncated or over 1000 rows.
- F9 fixed (`4c1f78486`, then the commit after `8c9b000d2`). Last good list reused when listing fails. `plan` takes a context (service lifetime, cancelled by `Close`; Wails-bound methods carry none). Presence check uses `UserMCPPresence` with its own 5 min TTL (picker keeps 30 s). Preview, schedule preview and restore state plan with `informational`: a cold or expired cache refreshes in the background and the blocker stays empty, so the UI never waits. `Start`, resume and scheduled starts still wait (cancellable) and block on a missing server; the blocker is not part of the preview hash. `SetMCPListTTL(0)` zeroes both TTLs and makes the check synchronous, for flow tests.
