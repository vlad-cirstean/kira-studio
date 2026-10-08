# P217 code review findings

Base commit: `4e57accbe` (`docs(v2.1): close out P209 review`), last commit of the prior review
session. Diff: `4e57accbe..26ec93700` (99 commits, 314 files, about 21.9k lines added).

## Scope

Everything since the P209 close-out: P210 to P216. Read in full, security- and concurrency-first:

- `apps/kira-space/internal/mobileweb/*` (auth, CSRF, cookies, rate limits, pairing, CA and leaf,
  routes, idempotency, SSE hub, setup listener, static shell, bind and Host guard).
- `apps/kira-space/internal/mobileterm/*` (broker, single-controller arbiter, WebSocket serve, ring).
- `internal/terminal/bound.go`, `service.go` arbiter hooks; `internal/pairing`; gitsock pairing
  refactor; `bridge/mobile*.go`; `main.go` wiring; migrations 0021, 0022; `repos/mobiledevices.go`.
- `internal/memory/importer/*` (scan, read, engine, store state machine, extract and finalize
  agents), `claude.go` MCP isolation args, `mcpserver` import mode, migration 0003.
- `internal/memory/{embed,stt,modelstore,workerproc}`, `vectors.go`, `hybrid.go`, `embeddings.go`,
  `service.go`; `bridge/dictation.go`.
- Mobile frontend transport (`mobile/api`, `mobile/terminal/useRemoteTerminal.ts`); new Vue files
  checked for `<style>` blocks, Options API, second `<script>` (none found).

Checked and clean (no finding): cookie flags and `__Host-` prefix; constant-time token verify with
dummy verify; failed-auth and pairing rate limits; Origin plus Fetch Metadata CSRF on every POST
and the WebSocket upgrade (coder/websocket also checks Origin); Host allowlist and RFC 1918 peer
guard; CA name constraints (critical); idempotency store; SSE allowlist and slow-consumer drop;
pairing broker resolution and cancel-on-disconnect; static handler path cleaning; importer
symlink handling, gitignore scoping, caps; finalize agent isolation (`--tools ""`,
`--strict-mcp-config`, `--allowedTools` limited to the three kira-memory tools, import-ref forced
server-side); importer job and chunk state transitions under cancel, pause, crash recovery; model
download SHA-256 and size check before rename, manifest written last; worker hello timeout and
stop; STT stream buffer bounds; hybrid search SQL (parameterised).

Areas with nothing real found: P213 Tailwind refactor, P214 free-text add, P215 test and hook
edits, `internal/memory/stt` worker and stream, `modelstore`, `workerproc`, importer engine.

## Findings, most severe first

Group A is one fixer commit (mobileterm broker). Group B is one commit (mobileweb server). Group C
is one commit (importer scan).

### Group A: `apps/kira-space/internal/mobileterm`

**A1. High. Phone input holds the terminal entry lock across a blocking PTY write.**
`apps/kira-space/internal/mobileterm/broker.go:273-285` (`Input`), with `Output` at `:160-169`.

Defect: `Input` keeps `e.mu` locked while it calls `Registry.Write`, which ends in
`Session.Write` -> `ptmx.Write` (`internal/terminal/session.go:214-223`). The master fd is pollable,
so the write parks until the PTY input queue has room (about 1 KiB on macOS, 4 KiB on Linux). The
PTY reader goroutine calls the arbiter's `Output` (`internal/terminal/service.go:113-116`) on every
chunk, and `Output` needs the same `e.mu`. `terminal.Arbiter` documents that `Output` "must not
block" (`internal/terminal/bound.go`).

Failure scenario: a phone pastes 16 KiB (the `inputCap`) through the compose row while Claude Code
is redrawing. The write fills the PTY input queue and parks with `e.mu` held. Claude Code's next
output chunk sends the PTY reader into `Output`, which blocks on `e.mu`. Output stops draining, so
Claude Code blocks writing its own output and stops reading stdin. The write never completes:
deadlock. Every other caller of this entry then hangs on `e.mu`: the desktop window's
`BoundService.Write`/`Resize` (`AllowWrite`, `AllowResize`), "Reconnect here" (`Reclaim`),
`Holds()` (and so every `changed()` from any terminal), `ReleaseAll` on server stop, and `Exited`.
Even short of a full deadlock, any slow write stalls PTY output and the desktop UI calls for its
duration.

Fix: never hold `e.mu` across `Registry.Write`. Add a per-entry `writeMu sync.Mutex` that
serialises phone writes. In `Input`: lock `e.mu`, check `e.conn == c`, `armIdle`, read `id`,
unlock; then lock `writeMu`, re-check control without blocking (for example an atomic
controller-generation read, or a short `e.mu` re-check), call `Registry.Write`, unlock `writeMu`.
Keep `Resize` as is (`TIOCSWINSZ` does not block). Add a broker test with a `Registry` fake whose
`Write` blocks until released, asserting `Output`, `AllowWrite` and `Reclaim` return while the
write is parked.

**A2. Low. A terminal attach that races a revoke or a permission-off keeps control.**
`apps/kira-space/internal/mobileterm/serve.go:56` and `broker.go:218-251` (`Attach`);
`apps/kira-space/internal/mobileweb/server.go:329-354` (`Revoke`, `PermissionsChanged`);
`apps/kira-space/internal/mobileweb/writes.go:266-274` (`handleTerminal`).

Defect: the device row is read once in `withDevice`, and `requirePerm` checks that snapshot. Revoke
writes the store, then calls `ReleaseDevice`, which only ends holds that exist at that instant.
Nothing re-checks the device after `Attach`.

Failure scenario: a phone's attach request passes `withDevice` and `requirePerm`. The user clicks
Revoke (or turns the phone's Agent input off) on the desktop. `ReleaseDevice` runs and finds no
hold. The request then reaches `Attach` and takes the terminal. The revoked phone drives the
terminal until it disconnects plus 60 s grace, or 15 min without input.

Fix: give `TerminalBroker.Serve` a re-check callback (for example `authorized func() bool` that
re-reads the device row and the global switch through `DeviceStore.ByID` and
`AgentInputEnabled`). Call it right after `Attach` succeeds; on false, `Release` the hold and
answer 403 before the upgrade. Revoke writes the store before `ReleaseDevice`, so a check after
`Attach` closes the window either way.

**A3. Low. Every agent terminal allocates a 1 MiB ring, even with the mobile server off.**
`apps/kira-space/internal/mobileterm/ring.go:6,16-18` (`ringCap`, `newRing`),
`broker.go:142-151` (`getOrCreate`), `apps/kira-space/main.go` `wireTermBroker` (the arbiter is
wired unconditionally).

Defect: `newRing` does `make([]byte, 1<<20)` on the first output of every Claude Code terminal.
The broker is the arbiter for every agent terminal whether or not `mobile.enabled` is on, so a
user who never pairs a phone still pays 1 MiB per agent session for the session's life.

Failure scenario: ten concurrent agent sessions hold 10 MiB of ring buffers that nothing will ever
read; the feature is off by default, so this is the common case.

Fix: grow the ring lazily: start `buf` empty and let `Append` extend it with `append` until it
reaches `cap`, then switch to wrap-around writes (`start`, `ReadFrom` already key off `end` and
`cap`; use `len(buf)` where a position is computed before the buffer is full). History replay is
unchanged; memory follows actual output up to 1 MiB. Extend `ring_test.go` to cover the
grow-then-wrap boundary.

### Group B: `apps/kira-space/internal/mobileweb`

**B1. Medium. The server never rebinds when the machine's addresses change.**
`apps/kira-space/internal/mobileweb/server.go:103-128` (`Start` reads `cfg.Addrs()` once),
`:189-211` (`maintain` only sweeps limiters and renews by expiry), `:224-241` (`renewLeaf` reuses
`s.bound`); `docs/ARCHITECTURE.md:4099` says the leaf is "re-issued in memory on start and when the
IP set changes".

Defect: the bound IP list, the leaf SANs and the Host allowlist are fixed at `Start`. Nothing
watches the interfaces, and the documented re-issue on IP change does not exist.

Failure scenarios: (1) Kira Space starts at login before Wi-Fi joins; `PrivateAddrs` returns only
`127.0.0.1`, so the server runs, the pane shows only a loopback URL, and no phone can connect until
the user toggles Mobile access off and on. (2) The laptop moves to another network or DHCP hands out
a new lease; the listener stays on the old address, the new address is neither bound nor in the
leaf, and the paired phone shows "Cannot reach Kira Space" with no hint why.

Fix: in `maintain`, poll `s.cfg.Addrs()` on the existing one-minute ticker. When the set differs
from `s.bound`, rebind: issue a new leaf for the new set, open listeners for added addresses, close
listeners for removed ones (or restart all listeners through the same all-or-nothing path `Start`
uses), update `s.bound` under `s.mu`, and emit status so the pane shows the new URLs. Expose a
status callback (like `OnDevicesChanged`) so the bridge can push `ChannelMobileStatus`. If the
rebind is not done, correct `docs/ARCHITECTURE.md:4099` and add a Known open items entry instead;
the code and the doc must agree.

**B2. Low. The phone receives absolute working-directory paths.**
`apps/kira-space/internal/mobileweb/routes.go:278-280` (`/api/agent/sessions`),
`apps/kira-space/internal/mobileweb/events.go:26-27` (`kira:agent:sessions`, `kira:agent:event` in
the allowlist), `apps/kira-space/main.go:248`.

Defect: `/api/agent/sessions` returns `terminal.AgentSession` with `Cwd`, and both agent channels
carry `cwd` (`packages/shared/domain/agent.ts`). The same package states "the phone never sees
paths or scripts" (`routes.go`, `repoNames`) and strips paths from the repo list for that reason.
The mobile UI never reads `cwd` (`frontend/mobile` uses only terminal ids and activity).

Failure scenario: any paired read-only phone, or anything with its cookie, lists every agent
session's absolute path (home directory, user name, worktree layout) and receives each new one
over SSE.

Fix: project before the phone sees it. In the route, map sessions to `{terminalId}` only. In the
hub, give `Publish` a per-channel projector for the two agent channels that drops `cwd` before
marshalling (keep the allowlist map, change its value from `bool` to an optional transform).
Update the mobile `AgentSession`/`AgentEvent` usage if the type is shared (make `cwd` optional for
the phone, or define a phone wire type).

**B3. Low. The SSE hub marshals every allowlisted event even with no subscriber.**
`apps/kira-space/internal/mobileweb/events.go:100-119` (`Publish`), fed by `appevent.Tap` for every
window-wide emit (`apps/kira-space/main.go`, `NewTap(rawEmitter, mobileHub.Publish)`).

Defect: `Publish` runs `json.Marshal` and `fmt.Sprintf` before it takes `h.mu` and looks at
`h.subs`. The tap is installed whether or not the mobile server runs.

Failure scenario: with Mobile access off (the default), every board, backlog, runs, log and agent
hook event is marshalled a second time and the frame string built, then dropped. `kira:adetask:log`
and `kira:agent:event` fire per log line and per tool call, so this is steady wasted allocation on
the hot event path.

Fix: at the top of `Publish`, after the allowlist check, take `h.mu`, return if `len(h.subs) == 0`,
release, then marshal. A subscriber added in the gap misses one event, which the client already
tolerates (it refetches on connect).

### Group C: `internal/memory/importer`

**C1. Low. Scanning walks every skipped directory in full just to count files.**
`internal/memory/importer/scan.go:171-173` (skip branch), `:191-204` (`countFiles`).

Defect: for each hidden, dependency or gitignored directory, `countFiles` runs a full
`filepath.WalkDir` (up to 100,000 entries per directory) only to add to the `Ignored` tally. It
ignores `s.ctx`, so Discard or app quit cannot interrupt it.

Failure scenario: importing a monorepo folder walks every `node_modules` and `.git` tree entry by
entry. A repo with several `node_modules` trees costs hundreds of thousands of `lstat` calls and
many seconds in the `scanning` state for a number the UI shows as a count, and `Close` waits on the
scan goroutine (`e.wg`) throughout.

Fix: stop counting inside skipped directories. Count each skipped directory as one entry in a new
`IgnoredDirs` tally (or fold it into `Ignored` with UI copy "files and folders ignored"), and drop
`countFiles`. If a file count is kept, cap it across the whole scan (not per directory) and check
`s.ctx.Err()` inside the walk callback.

## Counts

High 1 (A1). Medium 1 (B1). Low 5 (A2, A3, B2, B3, C1). Total 7.

By group: A mobileterm 3 (1 high, 2 low); B mobileweb 3 (1 medium, 2 low); C importer 1 (low).
