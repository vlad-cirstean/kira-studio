# P266 Stream C findings

## Needs from non-owned files

- `internal/ipcerr/text.go` (foundation): `T(code, key, params)` takes a non-literal key. Go key checks (G-series) cannot see keys passed through wrappers. No change made.
- `scripts/check-ui-primitives.sh` (foundation): removed stale line `U25 packages/workbench/src/automations/runs/RunLog.vue` after RunLog moved to `LogLines`. Guard fails on stale exemptions, so the edit was required for a green hook.
- `format.spec` is foundation-owned. `formatAgeCompact` boundary cases from the deleted git-core `dateFormat.spec.ts` are not re-added here; confirm foundation covers them.
- Space `apps/kira-space/frontend/src/views/repo/blameLine.ts` used git-core `dateFormat`; switched to `formatAgeCompact`. One-line change outside C ownership.
- Space `views/repo/ReviewThread.vue:39` still uses `.slice(0, 8)` on a sha (plan H3). Not C-owned; left for the Space stream.
- Studio `ImportCurlDialog.vue`, `EditRawRequestDialog.vue`, `BulkVariablesEditor.vue`, `RequestBodyPane.vue`: one-line render changes (`t(x.key, x.params)`) needed by the api-core `TextRef` change. Outside C ownership.
- `columns.ts` English "commit/commits" count text: not a guard hit, left.
- Studio `apps/kira-studio/frontend/src/beautify.ts`: already returns `CatalogReason` (key plus params); no change needed.

## Deviations

- C4 and C5 landed as one commit (shared files).
- Pin floor dropped.
- `worktreeLabel` stays in git-core (Space `worktrees.ts` consumes it); it uses `shortSha`.
- `runoutcome` reasons not converted.
- `terminalWindowClosing` key lives under `backend.core.docker.edit`.
- Added `packages/docker-ui/src/components/ConnectionState.vue`: a non-side-panel `EmptyState` with Retry, because U78 forbids a Button in a side-panel `EmptyState`.
- api-core: parse warning `detail` and dotenv `message` now `TextRef` (keys `workbench.apiImport.*`). `error:` string fields in curl/raw parse and `contentTypeCaption` stay English; the guard does not flag them.
- `CODE_LANGUAGE_OPTIONS[].label` is a `TextRef`; `bodyBadgeLabel` deleted.
- C6 items not touched because no guard hit and no behaviour gap: `EditRows`, `ScriptDialog`, `ParamsEditor`, `TIMING` use in docker/automations (already centralised).
- Space spec: plan said "remove repo shows `codicon-close`". `ReposDialog` remove uses trash; the spec asserts worktree trash and stack-remove close instead.

## Stream C result

Commits on `p266-c` (base 347423322):

- C1 `70b513b50` docker and scriptruns error codes and catalog messages.
- C2 `c81f5535d` internal Go files on `ipcerr.T`.
- C3 `15c4db15d` git-core `TextRef`, shortSha, dateFormat removal, git-ui dialogs.
- C4+C5 `de7e02cf2` icons, EmptyState, capped lists, shortSha, menu keys.
- C6 `54431975d`, `c2ccaa7fe` docker-ui and workbench EmptyState, fireAndForget, codicons, RunLog on LogLines, `createOpenExternal`.
- C7 `816943c9c` api-core catalog text, logError, fireAndForget.
- C8 `f1d0dbae3` specs.

Allowlists: `stream-c.txt` empty. `go-stream-c.txt` holds two permanent named G4 lines (flowtest harness, reason in file).

Specs written, not run:

- `apps/kira-studio/internal/flows/termflow/errors_test.go`
- `apps/kira-studio/internal/flows/dockerflow/errors_test.go` (needs a Docker engine)
- `apps/kira-studio/tests/ui/consistency-docker-automations.spec.ts`
- `apps/kira-space/tests/ui/consistency-git.spec.ts`
- `copy-wording-git.spec.ts` (New branch…) and `copy-coverage-git.spec.ts` (dropped the stale "Name cannot be empty" allowance) updated.

Per-commit checks: normal hook (lint plus typecheck) green; Go built and `lint:go` clean. No UI, e2e or Go test suites run. `RunLog` layout inside `LogLines` (flex-1, `max-height: none`) unverified visually.
