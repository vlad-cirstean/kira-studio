# P307 Part 2 plan: per-connection preconnect delay

Row: "Per-connection preconnect delay setting (seconds, between starting the preconnect script and
the first connect attempt). Covers non-loopback targets that the Part 1 readiness probe skips. Runs
after P312 lands (migration number and generated bindings overlap)."

User ask: "Add the delay setting too. It should be per connection."

Builds on Part 1 (`docs/v2.8/plans/P307.md`, landed): `Supervisor.Start(ctx, id, command, ready
*ReadyCheck)`, `readyCheck(r.readyAddr)` loopback probe, `Backend.RunPreconnect` wrapping the
startup wait as op kind `preconnect`, live elapsed timer in `OpLogPanel`.

## 0. Ordering constraint (read first)

P312 (Stream D) adds migration 0039 in each app and changes Go bound types. Start only after P312
is committed on `v2.8`. Then:

- Migration number: run `ls apps/kira-studio/internal/storage/migrations/*.sql | tail -1` and read
  the last `Version` in `apps/kira-studio/internal/storage/migrations/embed.go`'s `names`. Take
  max+1. Never hardcode 0039 or 0040 from this plan. Below, `00NN` means that number.
- Bindings: regenerate with `wails3 task common:generate:bindings` (or `bun run setup`) after the
  Go model changes. Bindings are gitignored, so nothing to commit, but `typecheck`/`test:unit`
  read them.

## 1. Today (discovery via codegraph)

- `connections.attemptConnect` (`internal/connections/service.go:860`) and `Service.Test` call
  `Backend.RunPreconnect(ctx, id, script, run)`; `run` calls `Preconnect.Start(opCtx, id, script,
  readyCheck(r.readyAddr))`. Op ends, then `Backend.Connect`.
- `Supervisor.Start` (`internal/preconnect/supervisor.go:166`): first of ctx cancel / script exit /
  settle window (2s, `ready == nil`) / probe success / `readyTimeout` (60s) wins. All timers are
  real `time.NewTimer`; tests lower package vars (`settleWindow`, `readyTimeout`) from
  `supervisor_internal_test.go` / per-test. **No fake-clock seam exists**; this plan keeps the same
  pattern (short real durations), adds no clock library.
- `Router.RunPreconnect` (`internal/adapterhost/router.go:278`) -> `Host.RunOp(OpSpec{Kind:
  "preconnect"})`. `op:start` carries only id/connection/tab/kind/startedAt/incognito; command
  reaches the record only at `op:end`. `oplog.Wiring.handleOpStart` (`internal/oplog/wire.go:164`)
  turns `op:start` into the running `model.OpRecord`.
- Connection fields: Go `model.ConnectionFields` (`internal/storage/model/connection.go`), zod
  `connectionFieldsSchema` (`packages/shared/domain/connection.ts:100`), repo column lists
  `connectionSelectColumns`/`connectionColumns`/`connectionSetColumns`/`connectionArgs`/
  `scanConnectionRow` and hand-built `InsertDuplicateWithSecret`
  (`internal/storage/repos/connections.go`), validation `Input.validateLimits`
  (`internal/connections/input.go:72`), `zeroExemptFields` (`service.go:~628`), `resolved` /
  `resolve` / `resolveFromInput` (`internal/connections/resolve.go`).
- Duplicate copies every `ConnectionFields` member through `InsertDuplicateWithSecret`. DataGrip
  import builds `connections.Input` (zero value = 0 = off, nothing to do). No connection
  export/share path exists (grep found only API-collection export). DB MCP `list_connections` does
  not expose preconnect fields. `ipcfixture.FrozenConnectionSummary` is a fixed field subset
  without throttle/autoExplain, so committed IPC fixtures do not change.
- Form: `ConnectionPreconnectTab.vue` (script textarea + sidecar `CheckboxRow`, shown only when
  `preconnectText`), `form.ts` (`useFormErrors` rules; throttle has a custom range rule),
  `ConnectionAdvancedTab.vue` (throttle uses `NumberStepperInput`), `state/connections.ts`
  `defaultDraft` (explicit literal incl. `preconnectSidecar: false`, `throttlePerSec: 0`).

## 2. Decision: the setting

| | |
| --- | --- |
| Name | `preconnectDelaySec` (TS/JSON), `PreconnectDelaySec int` (Go), column `preconnect_delay_sec` |
| Unit | whole seconds (`int`; zod `.int()`) |
| Bounds | 0..300. 0 = off = today's behaviour exactly. 300 s covers an SSO/browser-login tunnel; longer means run the tunnel by hand |
| Default | 0 (column `NOT NULL DEFAULT 0`, zod `.default(0)`, `defaultDraft` 0) |
| Lives | first-class column, not `options_json` (same reason as `preconnect`: `options` round-trips through the URI; behaviour must not be settable by pasting one) |

Constant: TS `PRECONNECT_DELAY_RANGE = { min: 0, max: 300 } as const` next to
`CONNECTION_THROTTLE_RANGE`; Go `preconnectDelaySecMax = 300` next to the throttle consts in
`input.go`, comment "mirrors PRECONNECT_DELAY_RANGE".

Migration `00NN_p307_preconnect_delay.sql`:

```sql
-- P307 Part 2: seconds to wait after the pre-connect script starts before the first connect
-- attempt; 0 = off. First-class column for the same reason as preconnect (not URI-settable).
ALTER TABLE connections ADD COLUMN preconnect_delay_sec INTEGER NOT NULL DEFAULT 0;
```

Register `{Version: NN, Name: "p307_preconnect_delay", File: "00NN_p307_preconnect_delay.sql"}`
at the end of `names` in `embed.go`.

`zeroExemptFields`: add `f.PreconnectDelaySec = 0` and one clause to its doc comment (timing only,
never the destination, so "edit the delay -> Test" still injects the stored password).

Validation (`validateLimits`): `in.PreconnectDelaySec < 0 || > preconnectDelaySecMax` ->
`ipcerr.T(ipcerr.CodeBadRequest, "backend.studio.connection.preconnectDelayRange.body", nil)`.
Applies whether or not a script is set (field is harmless without one; no cross-field rule).

## 3. Decision: semantics

All windows count from script spawn. **Connect proceeds when `delay` has elapsed AND the existing
readiness rule holds**, i.e. effective wait = max(delay, ready):

- Loopback probe target: probe runs from spawn as today. A probe success during the delay is
  remembered; return at delay end. A probe success after the delay returns at once. `readyTimeout`
  (60s) starts at delay end, not spawn, so a 300s delay never trips it.
- Non-probe target: settle window still runs from spawn; return at max(delay, 2s). Delay < 2s
  changes nothing (settle also classifies sidecar vs one-shot; not shortened).
- Script exits 0 during the delay: remember the outcome, keep waiting until delay end, then
  classify as one-shot (`finishExit`). Reason: `kubectl port-forward ... & sleep 1` exits 0 while
  its backgrounded tunnel is still starting, exactly the case a delay is for.
- Script exits non-zero / signal during the delay: fail at once (`finishExit` error), no waiting.
- ctx cancelled during the delay (Operations panel Cancel, Disconnect, Remove, shutdown): kill the
  group, return the existing `Pre-connect script cancelled: %w` error at once.

Why max, not "delay then probe" in sequence: sequential adds probe latency on top of a delay the
user already sized; max costs nothing once both hold. Why a floor over the probe at all: it is the
user's remedy for the probe's false positive (port already listening before the script, Part 1's
documented edge) and for a listener that accepts before its backend is usable.

### `Supervisor.Start` change

Signature: `Start(ctx, connectionID, command string, ready *ReadyCheck, delay time.Duration)`.
Doc comment: one sentence on the delay floor.

State machine (replace the single `select` with a `for { select }` loop):

- Keep `outcomeCh` for `awaitExit`; select on a local `outC := outcomeCh` set to nil once an exit-0
  outcome is consumed during the delay (`held *outcome`).
- `delayC`: timer when `delay > 0`; `delayDone := delay <= 0`.
- `settleC` (ready == nil) from spawn, as today; flag `settled`.
- `readyCh` probe goroutine from spawn, as today; flag `probed`. `timeoutC` armed at spawn when
  `delayDone`, else on the `delayC` branch.
- Branches:
  - `ctx.Done` -> unchanged.
  - `outC`: failure -> `finishExit`; exit 0 and `delayDone` -> `finishExit`; exit 0 and not done ->
    `held = &out; outC = nil`.
  - `delayC` -> `delayDone = true`; `held != nil` -> `finishExit(*held)`; `ready == nil && settled`
    -> `sidecar()`; `ready != nil && probed` -> ready branch; `ready != nil && !probed` -> arm
    `timeoutC`.
  - `settleC` -> `settled = true`; if `delayDone` -> `sidecar()`.
  - `readyCh` -> `probed = true`; if `delayDone` -> ready branch.
  - `timeoutC` -> unchanged error.
- Ready branch = Part 1's (non-blocking read of `outC`; exited -> `finishExit`, else `sidecar()`).
  `sidecar()` is reachable only while `held == nil`, so `awaitExit` never waits on a consumed
  channel.

Keep `Start` under the repo's lint complexity limit: extract the loop state into a small struct
with methods if the linter flags it (no `//nolint`).

### Wiring

- `resolved` gains `preconnectDelay time.Duration`; `resolve` sets it from
  `summary.PreconnectDelaySec`, `resolveFromInput` from `in.PreconnectDelaySec`
  (`time.Duration(n) * time.Second`).
- `connections.Backend.RunPreconnect(ctx, connectionID *string, command string, delay
  time.Duration, run func(context.Context) error) error`. Both call sites (`attemptConnect`,
  `Test`) pass `r.preconnectDelay` to it and to `Preconnect.Start`.
- `adapterhost.OpSpec` gains `DelayMs int` (comment: "preconnect only: the configured wait, so the
  panel can count it down"). `opStartPayload` gains `DelayMs int json:"delayMs,omitempty"`.
  `Router.RunPreconnect` sets `DelayMs: int(delay.Milliseconds())`.
- `oplog.Wiring`: `handleOpStart` decodes `delayMs`, stores it on `inFlightOp`, puts it on the
  running record; `handleOpEnd` copies it from `inFlight` onto the terminal record when known. Not
  persisted (no `op_log` column): it only matters while the row runs, and a running op never comes
  back from `Recent()` (reconcile marks them interrupted on launch).
- `model.OpRecord` gains `DelayMs *int json:"delayMs,omitempty"` (omitempty: every other op's JSON
  and the committed `preconnect-op` contract stay byte-identical). zod `opRecordSchema` gains
  `delayMs: z.number().optional()` with a one-line comment.
- `fakeBackend.RunPreconnect` in `connections/service_test.go`: add the param, still passthrough.
- Supervisor test call sites: append `0`.

## 4. Frontend

### Connection dialog

- `connection.ts`: `PRECONNECT_DELAY_RANGE`; in `connectionFieldsSchema` after
  `preconnectSidecar`: `preconnectDelaySec: z.number().int().min(0).max(PRECONNECT_DELAY_RANGE.max).default(0)`
  with a 2-line comment (`.default(0)` load-bearing for an older stored row, like throttle).
- `state/connections.ts` `defaultDraft`: `preconnectDelaySec: 0`.
- `form.ts`: `FieldName` adds `'preconnectDelaySec'`; custom computed error (same shape as
  `throttleError`): not an integer or outside range ->
  `t('studio.project.connectionDialog.preconnectDelay.range.status', { min, max })`; rule
  `{ value, error, tab: 'Pre-connect' }`. Update the function's doc line ("plus the throttle and
  delay ranges").
- `ConnectionPreconnectTab.vue`: below the sidecar `CheckboxRow`, inside the same
  `v-if="preconnectText"` condition, a shadcn `Field` copying the throttle field's markup:
  `FieldLabel`, `w-24` `NumberStepperInput` (`:min="0"`, `:max="PRECONNECT_DELAY_RANGE.max"`,
  `step="1"`, `v-bind="invalidAttrs('preconnectDelaySec')"`,
  `data-testid="connection-preconnect-delay"`), `FieldError` with
  `data-testid="connection-preconnect-delay-error"` else `FieldDescription`. Setter:
  `Number.parseInt`, NaN -> 0. Tailwind only, no `<style>`.

### Operations panel countdown

- `packages/workbench/src/components/OpLogPanel.vue`: new optional prop
  `runningNote?: (record: R, now: number) => string | null`. In the `command` cell, when
  `record.status === 'running'` and `runningNote?.(record, now)` is non-null, render it
  (`data-testid="op-running-note"`, `text-muted-foreground`) instead of the command. Uses the
  existing shared `now` clock, so it ticks with the elapsed timer and pauses with it. Space passes
  nothing; unchanged.
- `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue`: pass
  `:running-note="preconnectNote"`:
  ```ts
  function preconnectNote(record: OpRecord, now: number): string | null {
    if (record.kind !== 'preconnect' || !record.delayMs) return null;
    const left = Date.parse(record.startedAt) + record.delayMs - now;
    if (left <= 0) return null;
    return t('studio.operations.preconnectDelay.status', {
      remaining: formatElapsed(Math.ceil(left / 1000) * 1000),
    });
  }
  ```
  Ceil so it reads `0:05` at start and never `0:00` while still waiting. After the delay the cell
  falls back to the command cell (`—` while running), and the duration cell's elapsed timer, which
  already counts the whole op incl. the delay, keeps ticking. `startedAt` precedes spawn by
  milliseconds; invisible at 1 s resolution.

### i18n (`packages/theme/src/i18n/en.json`)

- `studio.project.connectionDialog.preconnectDelay.label`: "Wait before connecting (seconds)"
- `studio.project.connectionDialog.preconnectDelay.description`: "Seconds to wait after the
  command starts before the first connect attempt. 0 (default) connects as soon as the command is
  ready. Cancel it from the Operations panel."
- `studio.project.connectionDialog.preconnectDelay.range.status`: "Whole seconds, {min}–{max}"
- `studio.operations.preconnectDelay.status`: "Connecting in {remaining}"
- `backend.studio.connection.preconnectDelayRange.body`: "Pre-connect delay must be a whole number
  of seconds from 0 to 300." (next to `throttleRange`)

Keep keys alphabetical within their objects, as the file is.

## 5. Tests (feature split at the IPC boundary)

### Supervisor (`internal/preconnect/supervisor_test.go`; ordering/cancellation qualifies)

One table-driven `TestStartDelay`, real short durations (no fake-clock seam, see §1), each case
`t.Cleanup(s.StopAll)`:

1. exit-0 script (`true`), delay 300ms, nil ready -> `KindOneShot`, elapsed >= 300ms.
2. probe always ready, `exec sleep 30`, delay 300ms -> `KindSidecar`, elapsed >= 300ms.
3. nil ready (settle 80ms from test init), `exec sleep 30`, delay 300ms -> sidecar, elapsed >= 300ms.
4. `echo boom >&2; exit 3`, delay 5s -> error with `boom`, elapsed < 1s.
5. delay 5s, cancel ctx at 100ms -> `errors.Is(err, context.Canceled)`, elapsed < 1s, group gone
   (reuse the existing group-gone helper the cancel tests use).
6. `readyTimeout` lowered to 200ms, probe never ready, delay 300ms -> `not ready` error, elapsed
   >= 500ms (timeout counts from delay end).

### Backend flow (`internal/flows/dbflow/preconnect_test.go`, new top-level `TestSQLitePreconnectDelay`)

- "delay holds connect and is counted in the op": `sqliteInput` with `Preconnect: ptr("true")`,
  `PreconnectDelaySec: 1`. Assert `app.W.Connections.List` returns 1; `Duplicate` returns 1 too
  (proves the hand-built duplicate INSERT). Mark, connect -> `connected`. Running `preconnect`
  record `DelayMs == 1000`; ok record `DurationMs >= 1000`; preconnect ok precedes connect running.
  Contract scenario `preconnect-delay`: `event:preconnect-delay-running` (mask `id`, `durationMs`,
  as Part 1).
- "cancel during the delay": `PreconnectDelaySec: 30`, script `exec sleep 30`. Connect in a
  goroutine; `waitOp(... "preconnect", "running")`, take its id, cancel through the same bound ops
  cancel method `opsStore.cancelOp` calls (grep the bridge for it). Assert op `cancelled` within
  5s, connection state `error` with `cancelled` in its message, no `connect` op after mark.
- Out-of-range validation: no test (single bad input -> single error, CLAUDE.md bar).

### UI specs

- `tests/ui/operations.spec.ts`, `contract: a delayed pre-connect row counts down before the
  connect`: same boot as Part 1's spec; push `preconnect-delay`/`event:preconnect-delay-running`
  with `startedAt = t0+1000`. Assert `op-running-note` text `Connecting in 0:01` and `op-elapsed`
  `0:00`; `page.clock.runFor(1000)` -> `op-running-note` gone, `op-elapsed` `0:01`.
- `tests/ui/preconnect.spec.ts`, dialog test (no contract): delay field absent with empty
  script, visible after typing one; `301` -> `connection-preconnect-delay-error` visible and Save
  does not call create; `5` -> Save; the exact-args `connectionsCreate` fixture carries
  `preconnectDelaySec: 5` (the matching backend half is the flow test's create/list round trip).

### Compile-only test churn

`ConnectionSummary`/`ConnectionInput` are `z.infer` output types, so `preconnectDelaySec` becomes
required. Add `preconnectDelaySec: 0` beside `throttlePerSec: 0` in every literal `typecheck`
flags; exact-arg IPC fixtures whose args are built from `defaultDraft` need it too (UI specs fail
loudly otherwise). Candidates: every file `grep -rl throttlePerSec apps/kira-studio/tests
packages/db-fixtures` lists (33 today). Go literals need nothing (zero value).

## 6. File ownership

| Path | Change |
| --- | --- |
| `apps/kira-studio/internal/storage/migrations/00NN_p307_preconnect_delay.sql` (new), `embed.go` | column + registration |
| `apps/kira-studio/internal/storage/model/connection.go` | `PreconnectDelaySec` |
| `apps/kira-studio/internal/storage/model/ops.go` | `OpRecord.DelayMs` |
| `apps/kira-studio/internal/storage/repos/connections.go` | column lists, args, scan, duplicate INSERT (placeholder count +1) |
| `apps/kira-studio/internal/connections/input.go` | bound const + validation |
| `apps/kira-studio/internal/connections/resolve.go` | `preconnectDelay` |
| `apps/kira-studio/internal/connections/service.go` | `Backend.RunPreconnect` param, call sites, `zeroExemptFields` |
| `apps/kira-studio/internal/connections/service_test.go` | fake param |
| `apps/kira-studio/internal/preconnect/supervisor.go`, `supervisor_test.go` | delay state machine, tests, call sites |
| `apps/kira-studio/internal/adapterhost/host.go`, `router.go` | `OpSpec.DelayMs`, payload, `RunPreconnect` |
| `apps/kira-studio/internal/oplog/wire.go` | carry `delayMs` |
| `packages/shared/domain/connection.ts`, `ops.ts` | schema fields, range const |
| `packages/theme/src/i18n/en.json` | 5 keys |
| `packages/workbench/src/components/OpLogPanel.vue` | `runningNote` prop |
| `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue` | countdown |
| `apps/kira-studio/frontend/src/project/connection/ConnectionPreconnectTab.vue`, `form.ts` | field + rule |
| `apps/kira-studio/frontend/src/state/connections.ts` | `defaultDraft` |
| `apps/kira-studio/internal/flows/dbflow/preconnect_test.go` | flow test |
| `apps/kira-studio/tests/contract/preconnect-delay.json` (new, generated) | contract |
| `apps/kira-studio/tests/ui/operations.spec.ts`, `preconnect.spec.ts` | UI specs |
| `apps/kira-studio/tests/**`, `packages/db-fixtures/support/*.ts` (typecheck-flagged literals) | `preconnectDelaySec: 0` |
| `docs/ARCHITECTURE.md` | §7 |

Not touched: `docs/v2.8/SPEC.md` (orchestrator), committed IPC fixtures (frozen subset), Kira
Space code. One sequential implementer; no stream split (the field threads through every layer in
order).

## 7. Docs (`docs/ARCHITECTURE.md`)

- Schema block (~line 409): add `preconnect_delay_sec` to the `connections(...)` column list.
- Pre-connect readiness bullet (~1490): append the delay rule: "Per-connection
  `preconnectDelaySec` (0-300, 0 = off) is a floor: connect waits until both the delay and the
  readiness rule hold; an exit-0 script still waits out the delay; a failing script or Cancel ends
  it at once; `readyTimeout` starts at delay end."
- Op kind bullet (~1491): "`op:start` carries `delayMs` for a delayed preconnect (live only, not in
  `op_log`); the Operations panel counts it down in the command cell."
- **Delete** the Known open item at ~3131. Both halves now have a user remedy: a non-loopback
  slow tunnel gets a delay sized to it, and a port that already listens before the script is
  floored by the same delay. What remains is configuration, not a limitation.

## 8. Commit grouping (Conventional Commits, each passes the hook without `--no-verify`)

1. `feat(studio): per-connection preconnect delay setting` — migration + `embed.go`, Go model,
   repo, validation, `zeroExemptFields`, zod field + range, `defaultDraft`, form rule, Pre-connect
   tab field, dialog/backend i18n keys, typecheck-flagged TS literals (hook typechecks the whole
   tree, so they land together).
2. `feat(preconnect): wait the connection's delay before the first connect attempt` — supervisor
   state machine + its tests, `resolved.preconnectDelay`, `RunPreconnect` param (service, Router,
   fake), `OpSpec.DelayMs`, `op:start` payload, `oplog` wiring, `OpRecord.DelayMs`, zod `delayMs`.
3. `feat(studio): count down a delayed preconnect in the Operations panel` — `OpLogPanel`
   `runningNote`, `OperationsPanel` note, its i18n key.
4. `test(studio): preconnect delay flow, contract and UI specs`.
5. `docs: preconnect delay`.

## 9. Verification (sandbox)

From repo root unless noted; `CGO_ENABLED=1` for Go. `bun run setup` first (regenerates bindings
after the Go model change; required after rebasing onto P312 too).

- `CGO_ENABLED=1 go test -race -count=1 ./apps/kira-studio/internal/preconnect/... ./apps/kira-studio/internal/connections/... ./apps/kira-studio/internal/adapterhost/... ./apps/kira-studio/internal/oplog/... ./apps/kira-studio/internal/storage/...`
  (storage covers the migration chain applying cleanly).
- Contract write then stability, from `apps/kira-studio`:
  `KIRA_CONTRACT=write CGO_ENABLED=1 go test -p 2 ./internal/flows/dbflow -run TestSQLitePreconnectDelay`,
  then `CGO_ENABLED=1 go test -count=2 ./internal/flows/dbflow -run 'TestSQLitePreconnect'`.
  `git diff tests/contract/preconnect-op.json` must be empty (omitempty). Inspect the new JSON for
  machine paths.
- `bun run test:flows:studio` once near phase end.
- `bun run typecheck`, `bun run lint`, `bun run test:unit` (vocabulary parity, i18n catalog).
- `npx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui operations.spec.ts preconnect.spec.ts connections.spec.ts connection-dialog-tabs.spec.ts`,
  then `bun run test:ui:studio` once near phase end (the literal churn touches many specs).
- Space regression: its `operations.spec.ts` via its playwright config `--project=ui`.
- Orchestrator checks: grep `preconnect_delay_sec` in the new migration and both repo column
  lists plus the duplicate INSERT; grep a caller passing `r.preconnectDelay` in `attemptConnect`
  and `Test`; grep `runningNote` used in `OperationsPanel.vue`; grep the Known open item is gone;
  migration number == previous max + 1 after P312.

Manual sanity (optional): Postgres connection to a non-loopback host with preconnect `sleep 30`
and delay 5 -> Operations panel row reads `Connecting in 0:05` counting down, elapsed ticking,
then the `connect` row starts at ~5 s.
