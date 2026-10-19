# P313 review findings (round 1)

Base: `a74ece9` ("V2.6 (#3)"). v2.6 merged as one squash commit, so P305's close-out has no hash
of its own on this branch. `git log --oneline` shows `a74ece9` as the last v2.6 commit and
`13d8a78` ("docs: open chapter v2.8") as the first v2.8 commit. `docs/HISTORY.md` lists P305 as the
v2.6 close. Diff: `a74ece9..e05b483` (147 files). Covers P306-P312.

Severity scale: High (data or security impact in normal use), Medium (real failure in a reachable
path), Low (narrow path or UX defect).

## Dimension 1: architecture, structure, security

### F1 (High). Duplicate shifts throttle into `mcp_enabled`; duplicate can go MCP-live with no mask rules

`apps/kira-studio/internal/storage/repos/connections.go:319`, `InsertDuplicateWithSecret`.

The `VALUES` list has 15 placeholders before the literal `0`. The column list needs 16 there:
`id` plus 15 config columns up to `throttle_per_sec`. So the literal `0` lands in
`throttle_per_sec` and every later value shifts one column right. Column-to-value mapping, checked
against the statement text:

- `throttle_per_sec <- 0`
- `mcp_enabled <- f.ThrottlePerSec`
- the 5 MCP columns and `created_at`/`updated_at`/`sort_order` stay aligned only because the count
  after `0` has one extra `?`.

Failure: duplicate a connection with throttle 5/s and MCP off. The copy stores `throttle_per_sec = 0`
and `mcp_enabled = 5`. `scanConnectionRow` reads `mcpEnabled != 0`, so the copy is MCP-exposed. Mask
rules are only copied after the INSERT, and `Service.Duplicate` (`connections/service.go:495`) calls
`SetMcpEnabled` only when the source was enabled. The copy therefore stays MCP-live with zero mask
rules when the source had none. M6/M7 exist to block exactly this. A fractional throttle (0.5)
stores a REAL in `mcp_enabled`; scanning it into `int` fails, and the duplicate becomes unreadable.

The misalignment predates v2.8 (`a74ece9` has 14 and 9 placeholders, same shift). P307 Part 2
edited this statement to add `preconnect_delay_sec` and kept the shift. Per `CLAUDE.md`, fix it now.

Fix: put 16 placeholders before `0` and 8 after it (5 MCP columns plus `created_at`, `updated_at`,
`sort_order`). Add a repo test that duplicates a row with a non-zero throttle and MCP off. Assert
the throttle is copied and `McpEnabled` is false. This guards a column-count invariant no compiler
checks.

## Dimension 2: functional correctness

### F2 (Medium). A dialog Test's pre-connect script outlives app quit for up to 6 minutes

`apps/kira-studio/internal/connections/service.go:705-712` (`Test`) and
`apps/kira-studio/internal/preconnect/supervisor.go:169-275` (`Start`).

`Test` runs `RunPreconnect(context.Background(), …)`. During `Start`'s wait the entry is not in
`s.entries`. Only the `sidecar`/`finishExit` paths add it. `Service.Shutdown` cancels only tracked
Connect attempts (`inFlight`), then calls `StopAll`, which walks `s.entries`. Nothing cancels a
Test's wait, and `StopAll` cannot see its process. Before P307 the untracked window was the 2 s
settle window. It is now up to `preconnectDelaySec` (300 s) plus `readyTimeout` (60 s).

Failure: set a 120 s delay, click Test, then quit. The script runs in its own process group
(`Setpgid`), so an `ssh -L` or `kubectl port-forward` keeps running after Kira exits. The deferred
`Preconnect.Stop` never runs because the process is gone.

Fix: give `Test` a context that `Shutdown` cancels. One option: register Test attempts in a set
that `Shutdown` cancels and waits on, like `inFlight`. Another: track the entry in `Start` from
spawn on, so `StopAll` reaches it. Either way, cover quit during a delayed Test in the existing
`preconnect` flow test.

### F3 (Low). Cancelling a pre-connect op from the Operations panel sets the connection to "error"

`apps/kira-studio/internal/connections/service.go:890-899` (`attemptConnect`).

Panel Cancel cancels the op's derived context, not the attempt's `ctx`. `Start` returns
`Pre-connect script cancelled: context canceled`. `attemptConnect` only checks `ctx.Err()`, which
is nil here, so it returns the error. `doConnect` then emits `status: "error"` with that raw,
untranslated Go text. A user cancel is not a failure. A Disconnect cancel of the same wait already
ends as `disconnected` through `finalizeAbortedAttempt`.

Fix: when `RunPreconnect` fails with a cancellation (`errors.Is(err, context.Canceled)`) and
`ctx.Err() == nil`, stop the entry and emit `disconnected` instead of an error state. The
`operations.spec.ts` preconnect case should assert the resulting connection status.

### F4 (Low). `widthUserSet` is never persisted, so the Git review widen overrides a user-sized panel after restart

`packages/workbench/src/state/createLayoutStore.ts:147-160`;
`apps/kira-space/internal/storage/model/layout.go` (`ProjectSize`, `ProjectSizePatch`);
`apps/kira-studio/internal/storage/model/layout.go` (same types).

`setProjectWidth` patches `{ width, widthUserSet: true }`. The Go `ProjectSizePatch` has no
`WidthUserSet` field, so JSON decode drops it, and no `ui_layout` leaf stores it. `hydrateLayout`
reads the layout through `trust<L>` with no zod parse, so the default never applies. The per-mode
entry keeps `widthUserSet: false` from `defaultPanelSizes`. After a restart,
`ensureReviewPanelWidth('git', 320)` widens a Git panel the user narrowed below 320 px. The shared
`layout.ts` comment says this case must not happen. The loss predates v2.8 (old `PanelProject` also
lacked the field). P312 rewrote both functions and the Go types, so per `CLAUDE.md` fix it in this
phase.

Fix: add `WidthUserSet bool` to `ProjectSize` and `*bool` to `ProjectSizePatch` in both apps. Store
it as a `modes.<mode>.project.widthUserSet` leaf in `decodeLayout`/`Set`. Extend the Space
`appflow` layout flow test to assert the flag survives a reload.

## Dimension 3: performance and resources

Nothing real found. Checked:

- Supervisor `Start`: every timer is stopped by `startWait.stop`. `probeLoop` ends on `stopProbe`.
  `readyCh` is buffered and sent to once. `armTimeout` runs at most once.
- `connectionReorder.ts`: `useElementByPoint` and auto-scroll rAF loops run only during a drag.
- `VirtualList.vue`: the handler cache resets on rows identity change.
- `OpLogPanel.vue`: one 1 s interval, paused while `runningCount` is 0.
- `SortableList.vue`: the ids watcher compares content before replacing the array.

## CLAUDE.md rule checks

No violations found. Checked:

- Every new or changed `.vue` file is `<script setup lang="ts">` with no new `<style>` block.
- New UI uses Tailwind utilities and shadcn-vue primitives (`Badge`, `Separator`, `Button`).
- DOM wiring uses VueUse: `useMouse`, `useElementByPoint`, `useRafFn`, `useEventListener`,
  `useIntervalFn`.
- Drag reorder reuses `vue-draggable-plus` through `useSortableReorder`. The virtualized tree's own
  pointer drag states why Sortable cannot serve it.
- New flow tests and UI specs pair at the IPC boundary for preconnect, layout and order.
- `docs/ARCHITECTURE.md` facts on readiness, delay, layout keys and reorder match the code. Its
  Known open items list is accurate for this diff.
