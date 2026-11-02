# P445 review round 2 findings

Base: `4faeba79b66746df24aede9eeb70992430e734e1` (same as round 1). Head reviewed: `d8cbc9869`.
Scope: `git diff 4faeba79b..HEAD`, minus generated bindings, lockfiles and PNG baselines. Round 1 fixer
commits `85e07768c..d8cbc9869` read as unreviewed code. One Opus reviewer; findings only, no fixes.

Areas read: `internal/harness/claude/usermcp.go` (presence cache, background refresh, stale fallback),
`internal/scriptruns/preview.go` (`smartBlocker`, `existingDir`, `informational`), `service.go`/`smart_run.go`
(`lifeCtx`, `Close`), every `plan` caller (`confirm.go`, `restore.go`, `resume.go`, `schedule.go`,
`scheduler.go`), `headless.go` `userMCPSettings`, ADE `smartstep.go` `checkMCP` and `runs.go`
`superviseAgent`, `LogsView.vue` generation guard, `kubernetes/service.go` config cache and `Cluster`,
`dbmcp/kube_tools.go` `resolveCluster`, `mcpreads.go` log trim, `queries.ts` poll backoff, `state.ts` zod
schema, `RunsRestoreDialog.vue`, `scriptRuns.ts` colour schema, changed flow tests.

Severity count: High 0, Medium 2, Low 6.

## Dimension 1: architecture, structure, maintainability, security

### R2-1 (Low) Shared `claude mcp list` flight runs on the first caller's context

- Where: `internal/harness/claude/usermcp.go:127-129,144-163`, `internal/scriptruns/service.go:305-316`.
- Summary: `singleflight.Do` runs `runMCPList(ctx, dir)` with whichever caller arrived first. Every
  joiner shares that context's fate. The background refresh uses `context.Background()`, so it also
  ignores `lifeCtx`, contrary to the `lifeCtx` comment ("a quit cancels a slow `claude mcp list`").
- Failure scenario: an ADE smart step calls `checkMCP` for folder X; a Runs `Start` for the same folder
  joins the flight. The user stops the ADE step; its context cancels the list; the Runs start gets
  `errMCPList` (or a stale list) and blocks with "could not list your Claude MCP servers" for reasons
  unrelated to it. Reverse case: a `Start` joins a background flight; `Close` cancels `lifeCtx`, but
  `Start` keeps waiting up to 30 s under `startMu` because the flight runs on `Background`.
- Proposed fix: run the flight body on `context.WithoutCancel` plus `mcpListTimeout` (or a provider
  lifetime context), and have each caller wait with `flight.DoChan` in a `select` on its own `ctx.Done()`.

### R2-2 (Low) Test fixture got the settings keys by a stray search-and-replace

- Where: `apps/kira-studio/internal/flows/termflow/smart_test.go:275`.
- Summary: the `denied.jsonl` stream-json `result` line now carries
  `"enableAllProjectMcpServers":false,"enabledMcpjsonServers":[]`. Those are `--settings` keys, not result
  fields. The parser ignores them, so the test still passes, but the fixture no longer matches claude's
  output shape and misleads the next reader.
- Failure scenario: none at runtime; a later strict decoder (`DisallowUnknownFields`) or a reader copying
  this fixture inherits a wrong result shape.
- Proposed fix: revert that line to its pre-`2adbda9ec` content.

## Dimension 2: functional correctness and business logic

### R2-3 (Medium) Presence cache hides a newly added server for 5 min: false "no longer in your config"

- Where: `internal/harness/claude/usermcp.go:115-134` (`mcpPresenceTTL` 5 min, per-dir key),
  `internal/scriptruns/preview.go:257-285`, `internal/scriptruns/mcp.go:11`,
  `apps/kira-space/internal/ade/smartstep.go:100-115`.
- Summary: the picker lists from `s.Home` with a 30 s TTL; the presence check lists from the run folder
  with a 5 min TTL. They are separate cache entries unless the run folder is the home. A miss against a
  cached run-folder list is reported as "gone" without a refresh.
- Failure scenario: user previews a smart script that runs in a repo folder (caches that folder's list).
  User runs `claude mcp add -s user jira`, edits the script; the picker (home list) offers `jira`; user ticks
  it and saves. Preview and `Start` both read the still-fresh folder list without `jira` and block with
  "MCP server jira is no longer in your Claude config" for up to 5 min. In ADE, `checkMCP` hard-fails the
  workflow step with the same false text. The opposite direction (a removed server still passes for 5 min,
  so the run goes ahead without its tools) is the F4 case the check exists for.
- Proposed fix: treat a miss as a reason to refresh, not a verdict. With `wait` true, on any missing name
  re-list synchronously (`userServers(ctx, dir, 0)`) and decide on that result; with `wait` false, start
  the background refresh and return no blocker (`known=false`) for a miss on a list older than the picker
  TTL. Names that are present keep the 5 min reuse, so the cost lands only on the rare miss.

### R2-4 (Medium) MCP log read keeps the oldest lines of the tail window and drops the newest

- Where: `apps/kira-studio/internal/kubernetes/mcpreads.go:55-81`.
- Summary: the doc says "reads the last Tail lines". `LimitBytes` makes the API server return the first
  `limitBytes` bytes of the tail selection, and the round 1 trim also keeps `raw[:mcpLogBytes]`. Both cut
  the end of the window, which holds the newest lines.
- Failure scenario: an AI calls `kube_pod_logs` with tail 5000 on a pod logging about 200 bytes per line
  (about 1 MB). It receives the oldest 256 KiB of that window, `truncated: true`, and never sees the lines
  around the crash it was asked about. Retrying with the same tail returns the same old slice.
- Proposed fix: drop `LimitBytes`; read through a hard cap (for example 8 MiB via `io.LimitReader`) into a
  buffer that keeps only the last `mcpLogBytes`, then cut at the first newline after the start. Set
  `Truncated` when anything was dropped. Alternatively keep `LimitBytes` but say in the tool result that
  the newest lines were cut and a smaller `tail` returns them.

### R2-5 (Low) Presence check from a repo folder counts project `.mcp.json` servers the run never loads

- Where: `internal/scriptruns/preview.go:267-283`, `internal/harness/claude/headless.go:66-84`.
- Summary: `claude mcp list` in the run folder reports project-scope servers from that folder's
  `.mcp.json`. Since `2adbda9ec` the run sets `enableAllProjectMcpServers:false` and
  `enabledMcpjsonServers:[]`, so those never load. `smartBlocker` and `checkMCP` match by name only.
- Failure scenario: user removes user-scope `github`; the repo's `.mcp.json` also defines `github`. The
  presence check finds `github` in the folder list and passes. The run starts with no `github` server and
  works without the tools it depends on, the silent case F4 was meant to stop.
- Proposed fix: `parseMCPList` cannot see the scope, so either list from a folder without project config
  (home) for the user-scope check plus a separate local-scope concern, or document the gap next to the
  P444 Known open item. Prefer checking from home now that project servers never load; local scope is the
  only folder-specific source left and is user-authored.

### R2-6 (Low) Picker shows stale health status indefinitely after a failed listing

- Where: `internal/harness/claude/usermcp.go:144-155`, `internal/scriptruns/mcp.go:11`.
- Summary: on a list failure `userServers` returns the last good list as success and keeps its old `at`.
  The picker shows those `Status` values as current. A listing usually times out because a server hangs, so
  the hung server still shows "connected".
- Failure scenario: a stdio server starts hanging; every picker open runs a 30 s list that times out and
  then shows the hour-old "connected" badge. The user ticks it, and the run stalls on it.
- Proposed fix: on fallback, mark the copied entries' `Status` as `unknown` for the picker path, or keep the
  stale fallback only for `UserMCPPresence` (names only) and let `UserMCPServers` surface the error.

## Dimension 3: performance and resource efficiency

### R2-7 (Low) Every task worktree run lists MCP servers cold, under `startMu`; cache never evicts

- Where: `internal/scriptruns/preview.go:267,289-296,334-380`, `internal/harness/claude/usermcp.go:93-102`.
- Summary: a new task worktree does not exist at preview, so preview checks its nearest existing ancestor.
  `claimWorktree` re-plans with the real path, a new cache key, with `wait` true. That runs a full
  `claude mcp list` (health-checks every user server, up to 30 s) inside `Start` while `startMu` blocks every
  other start. `listCache.entries` gains one entry per run folder and is never pruned.
- Failure scenario: a user with five MCP servers, one slow to connect, starts a smart run per task: each
  start waits several seconds, and a terminal script start clicked meanwhile waits on `startMu` too. Over a
  long session the map holds one list per worktree ever used.
- Proposed fix: after R2-5's change (check from home) the key is constant and this goes away. If the folder
  key stays, release `startMu` around the list, and drop entries older than `mcpPresenceTTL` on write.

### R2-8 (Low) ADE `checkMCP` runs after the sandbox starts

- Where: `apps/kira-space/internal/ade/runs.go:768-779`.
- Summary: `prepareSandbox` starts the container before `checkMCP` decides the step cannot run.
- Failure scenario: a sandboxed smart step whose ticked server is gone starts and stops a container (and
  waits on its setup) only to fail with `ErrServerGone`.
- Proposed fix: call `l.smart.checkMCP` before `prepareSandbox`.

## Checked, nothing real found

- `LogsView.vue` generation guard: overlapping opens, open during close, and unmount during an in-flight
  open each end with one live stream and one listener; a superseded open never writes `failure`.
- `lifeCtx`/`Close`: created and cancelled under `s.mu`; a `lifeCtx` call after `Close` returns a cancelled
  context.
- Kubeconfig cache: keyed on every path's size and mtime, held under `cfgMu`; `buildClient` deep-copies the
  shared config, so no caller mutates the cached one. `Cluster(id)` matches the old `Clusters()` lookup and
  no longer writes SQLite per tool call.
- `queries.ts` back-off and `state.ts` zod schema: correct TanStack v5 `refetchInterval(query)` use;
  schema matches `Remembered`.
- Restore dialog: item `command` is the planned `pv.Command`; the hash still guards a script edited between
  offer and confirm. `paletteColorSchema` on run colour is safe: run colour is copied from a
  `palette.Valid` script colour, DB default `'none'`.
- `informational` is set on exactly Preview, SchedulePreview and the restore offer; Start, claim re-plan,
  resume, ConfirmAccept, RunScheduleNow and scheduled fires wait. Blocker stays out of the hash.

## Result

All eight fixed; none wrong on re-read, none deferred. R2-1, R2-3, R2-5, R2-6, R2-7, R2-8 share one
module and landed in `30cf7530c`.

- R2-1 fixed `30cf7530c`. Flight body runs on `context.WithoutCancel`; callers use `DoChan` and select on
  their own `ctx.Done()`. `Close` now frees a waiting `Start`. Test `TestUserServersFlightSurvivesCallerCancel`.
- R2-2 fixed `376e45207`. Stray keys removed from the `denied.jsonl` result line.
- R2-3 fixed `30cf7530c`. `UserMCPPresence` takes the wanted names. Complete cached list: reused 5 min.
  Miss: sync re-list when `wait`, unless the list is under the picker TTL; background refresh and
  `known=false` otherwise.
- R2-4 fixed `29c01a466`. `LimitBytes` dropped; `readTail` streams the body and keeps the newest
  `mcpLogBytes`, cut at a line start; `Truncated` means oldest lines dropped.
- R2-5 fixed `30cf7530c`. Check lists from the app home (`s.Home`; ADE `ScriptsHome`), the picker's
  folder. Local-scope servers are not checked; the picker never offers them, so no tick depends on one.
  `existingDir` removed. ARCHITECTURE.md updated.
- R2-6 fixed `30cf7530c`. A stale fallback resets statuses to `unknown` in `UserMCPServers`; the presence
  path ignores status.
- R2-7 fixed `30cf7530c`. Key is constant (home), so no per-worktree entry and no cold list per task.
  The one cold or expired list still runs under `startMu`, once per 5 min.
- R2-8 fixed `30cf7530c`. `checkMCP` runs before `prepareSandbox`.
