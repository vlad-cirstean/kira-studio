# P336 code review round 1: findings

Base: `0890584a8` (v0.2.10 squash; holds the P329/P330 review rounds, the last review session).
Head: `611cc045e`. Scope: `git diff 0890584a8..611cc045e`, code only (no `docs/v0.2.12/`, no `*.md`).
Covers P330/P331 (hooks, scripts, staged workflows), P332 (Kira Space default app), P333 (DB MCP
target and response preview), P334 (Docker restore), P335 (grid copy). Every commit since base is
unreviewed.

Ranked by severity. No High finding.

## Medium

### M1. Restore snapshot pruned after 30 days without a change, so a later restart offers nothing

- `internal/docker/restore_tracker.go:137` prunes on every tracker start by `updated_at`.
- `internal/docker/restore.go:223-226` bumps `UpdatedAt` only when `reconcile` changed something.
- `apps/kira-studio/internal/storage/repos/docker_restore.go:91` deletes by `updated_at < ?`.

Failure: an engine whose running set has not changed for 30 days keeps its old `updated_at`. That
covers long-lived dev databases, or a remote context the user rarely touches. The user then
reboots, and on app start `run` prunes the row before the first tick. The first tick sees no
previous snapshot and calls `rebuildTracking` from the current (stopped) list. No restore is
offered, and nothing reports the loss.

Fix: prune by when the engine was last seen, not when it last changed. Options: add a `seen_at`
column and update it at most once a day on a reachable tick. Or prune only rows whose engine has
not been reachable for 30 days.

### M2. Restore banner keeps the previous engine's pending state after a context switch

- `internal/docker/restore_tracker.go:250-263`: `publish` dedupes against `lastKey[o.EngineID]`. It
  never emits a first `none` for an engine.
- `packages/docker-ui/src/queries.ts:28`: `RESTORE_KEY` sits outside `['docker']` on purpose, so
  `useContext`'s `ChannelChanged` invalidation never refetches it.

Failure: engine A is pending, so the banner shows. The user switches to context B, which has no
pending restore. B's first publish (last "" with state none), and any later identical none, emits
nothing. The banner keeps showing A's containers until `DockerPanel` remounts. Review, then Restore
or Dismiss, sends A's `engineId`. `pendingFor` refuses it with "no restore is pending for this
engine", and the dialog shows no error (see L1).

Fix: emit whenever the current engine differs from the engine of the last push. Track the last
pushed `EngineID` globally next to the per-engine key. Alternative: have `useDockerLiveSync`
refetch `RESTORE_KEY` on `onStatus` when `endpoint.context` changes.

### M3. Per-extension toggle on a shared UTI loses the saved previous handler

- `apps/kira-space/internal/filehandlers/filehandlers.go:161-198` (`turnOn`) saves `Previous` only
  for the toggled extensions.
- `apps/kira-space/internal/filehandlers/filehandlers.go:201-226` (`turnOff`) restores only from the
  extension's own row.
- Shared UTIs in `apps/kira-space/internal/filetypes/filetypes.go`: `yaml`/`yml`,
  `md`/`markdown`, `cpp`/`cc`/`cxx`, `graphql`/`gql`, `jsonl`/`ndjson`.

Failure: the user turns on `yml` alone (`FileTypesPane.vue` `toggleExt`). This saves `yml`'s
previous app and sets `public.yaml`, so `yaml` also flips to Kira Space. The user then turns `yaml`
off. Its current handler is self with no saved row, so the call returns `unrestored: ["yaml"]`. The
UTI stays on Kira Space, although `yml`'s row holds the exact app to restore.

Fix: key the previous handler by UTI, or resolve a sibling's row with the same UTI in `turnOff`.
Also save the row for every extension sharing the UTI in `turnOn`. A UTI-keyed table is simplest,
since LaunchServices itself keys by UTI.

## Low

### L1. Restore dialog drops rejected calls silently

`packages/docker-ui/src/components/RestoreDialog.vue:93-101`: `submit` and `dismissAll` await
`mutateAsync` without catching. The template renders neither `restore.error` nor `dismiss.error`.

Failure: a Conflict from M2, or a BadRequest "container X is not restorable" when an item turned
`back` between push and click, becomes an unhandled promise rejection. The dialog stays as it was,
with no message. `useContainerAction` in the same package exposes `error` for exactly this.

Fix: catch in both handlers and render the mutation error in the dialog, matching the other docker-ui
actions.

### L2. Tracker keeps a client resolved before the engine socket existed

`internal/docker/restore_tracker.go:191-200` uses `m.client()` (`internal/docker/manager.go:150-166`),
which caches the first resolved endpoint. On failure the tracker only calls `markDown`. Only
`status(refresh=true)` and `useContext` reset the client.

Failure: Kira Studio starts at login before Colima or OrbStack. `resolveEndpoint` falls back to
`unix:///var/run/docker.sock`, and the tracker caches that client. The engine socket appears later
under `~/.colima/...`, but every background tick keeps failing against the cached host. The running
set is never tracked until the user opens the Docker panel. The tracker is the part meant to work
"without any window open".

Fix: after N consecutive unreachable ticks on a non-selected, non-env endpoint, drop the cached
client (`resetLocked`) so the next tick re-resolves.

### L3. `waitHealthy` lets dependents start when the dependency is not running

`internal/docker/restore_actions.go:264-267` returns nil when the dependency is not running. That
covers a dependency whose own start just failed, or one the user left unchecked.

Failure: `db` (service_healthy dependency of `api`) fails to start. `api` is then started at once
against a dead dependency, and the result reports `api` OK.

Fix: when the dependency is part of this restore and its start failed, fail the dependent with
"dependency X did not start". Keep the current pass-through only for a dependency outside the
selection.

### L4. Response preview text cached and refetched beyond the dialog's life

`apps/kira-studio/frontend/src/workbench/ApprovalResponse.vue:32-35`: `useQuery` keeps default
`gcTime` (5 min) and `refetchOnWindowFocus`.

Failure: each held `run_query` result can be MB-sized. It stays in the query cache for 5 minutes
after its request resolves, one entry per request id. A focus change while the dialog is open
re-pulls the whole text over IPC. A focus change just after resolution raises a NotFound error flash
in `QueryState`.

Fix: `gcTime: 0`, `staleTime: Infinity`, `refetchOnWindowFocus: false`. The held text is immutable
for the request id's lifetime.

### L5. macOS registry cgo calls run without an autorelease pool

`apps/kira-space/internal/filehandlers/registry_darwin.go:25,46,60,83`: `kira_resolve`,
`kira_default`, `kira_set` and `kira_self` create autoreleased Objective-C objects (`UTType`,
`NSString`, `NSBundle`, `NSURL`) on Go-owned threads. These threads have no pool that drains.

Failure: every `Status` call (55 extensions, three to four calls each) leaks those objects for the
life of the OS thread. Small per call, but it grows each time the File types pane opens.

Fix: wrap each C function body in `@autoreleasepool { ... }`.

### L6. Release-on-merge concurrency drops queued entry points

`docs/pending-workflows/release-on-merge.yml:27-29`: one group with `cancel-in-progress: false`.
GitHub keeps one running and one pending run per group, and a newer pending run cancels the older.

Failure: a chapter PR's `workflow_run` entry holds the group for up to `--wait 600`. Meanwhile every
other PR CI completion (also `workflow_run`), the human-merge `closed` event and the schedule queue
behind it and replace each other. A merge's own `closed` run can be cancelled. The hourly sweep then
recovers it, so the release starts up to an hour late.

Fix: key the group by PR, falling back to the event for sweep and dispatch. Example:
`release-on-merge-${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.run_id }}`.
The script is already idempotent per tag, and release.yml's own `release-<tag>` group serializes the
dispatch.

## Dimensions with nothing further

- Architecture/security: no other finding. `OpenedFilesService.Read` has no allow-list. It accepts
  any absolute path with a vocabulary extension. The file's comment argues this is acceptable, and
  that argument holds. Workflows check out only `main`'s `scripts/` and filter fork PRs.
- Correctness, P335 grid copy (`selectionCopy.ts`, both hosts, both menus): nothing real found.
  Display rows are always ascending (`displayPositionOf` contract), so `row` selection's sort
  preserves visual order.
- Correctness, P333 `reviewResponse`: re-checks exposure and `mask.Set.Equal` after approval, and
  runs only after `Execute`. Nothing further.
- Performance: background restore ticks (Info, network inspect, container list every 15s, 30s when
  down) are cheap next to the existing events stream. Nothing further.
