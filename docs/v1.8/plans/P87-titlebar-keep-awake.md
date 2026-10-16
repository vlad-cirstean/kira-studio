# P87 — titlebar keep-awake toggle, plus an agent-aware auto-awake setting

`docs/v1.8/SPEC.md`'s P87 row (`:161`), turned into concrete steps. Everything below was read in the
current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `2d304ebc`, P71-P92 landed); every line
number is from that tree.

Seven commits. One new Go package (`internal/keepawake`), one new bound service, one new push
channel, one new settings leaf, one new titlebar button plus a reorder of the three already there.
No new dependency. No SQLite migration (`settings` is a key/value table; a new leaf is a new row).

The backend design is **not open**: SPEC carried it over verbatim from the row's original form —
`caffeinate -i -s` as a child process behind an OS-abstracted interface, macOS only, no cgo IOKit
call, re-armed on power resume, Orca (`stablyai/orca`) as prior art. This plan implements that; it
does not re-argue it.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| How does one OS assertion serve two independent on/off sources? | A **set of named reasons** inside one `keepawake.Controller`, not an integer refcount. Acquire on empty→non-empty, release on non-empty→empty, nothing on any other transition. A set is idempotent by construction; a counter drifts the moment a source re-asserts a level it already holds (two windows, a settings re-emit, a boot-time recompute) | §1 |
| How is a macOS power resume detected? | Wails v3 already observes `NSWorkspaceDidWakeNotification` and posts `events.Mac.ApplicationDidWake` (`application_darwin.go:65`, `application_darwin_delegate.m:45`). No `pmset`, no polling, no cgo of our own. **Registering the listener is load-bearing**: the delegate body is `if (hasListeners(EventApplicationDidWake))`, so an unobserved event is never posted at all | §5 |
| Does the Go side clear `CLAUDE.md`'s unit-test bar? | **Yes**, for the controller — two independent level sources composing onto one acquire/release pair, plus re-arm and self-heal, with a failure mode (a leaked assertion, or an early release while the other source still holds) that is invisible in the UI. The darwin driver gets an argv golden test and one process-lifecycle test. The settings leaf, the store and the button get nothing | §10 |
| Is `pmset -g assertions` runnable as a test here? | **No.** This container is Linux and has neither `caffeinate` nor `pmset` (`which caffeinate pmset` → nothing), and `docs/DEV_ENVIRONMENT.md`'s own Wails/Go section rules out running darwin code here at all. It stays a manual macOS check (§12), named rather than faked — P90/P91's own plans did the same for what their sandbox could not reach | §10.4, §12 |
| Does the titlebar button persist across relaunch? | **No.** It is app-wide but process-scoped: an OS power assertion that silently outlives the reason a user made it is a surprise, and the persistent, opt-in half of this feature is precisely the Settings toggle. Stated here so a later phase does not read the absence as a bug | §3.2 |
| Where does the agent-aware leaf live in Settings? | The existing **Claude Code** section (`state/settings.ts:27`), whose posture is already instant-action, not draft/Save. A new "Power" section for one checkbox would be a section with one row, and the trigger signal is a Claude Code session count | §6, §9 |
| Which icon for the button's two states? | `coffee`, in both states, differentiated by `.title-action.is-on` — this app's own established active treatment. `@vscode/codicons` ships **no** `coffee-off`; enumerating `codicon.css`'s class list gives only `layout-panel-off`, `layout-sidebar-left-off`, `layout-sidebar-right-off`, `bell-slash`, `circle-slash`, `mute`. So the two-glyph redundancy the panel toggles use is unavailable, and `aria-pressed` plus a state-naming tooltip carry it instead | §8.3 |
| Does `caffeinate` get an extra flag? | One: `-w <our pid>`. `-i -s` is unchanged; `-w` makes the child exit when this app's process does, so a crash (where no teardown runs) cannot orphan a caffeinate that keeps the machine awake forever. Not a re-litigation of the spawn-vs-cgo decision — same spawn, one self-termination guard | §2.3 |

---

## 1. The composition design

### 1.1 The shape

Two sources, both **level signals**, never edges:

- **manual** — the titlebar button. On/off, app-wide, process-scoped (§3.2).
- **agent** — `claudeCode.keepAwakeWithAgents` is on **and** `terminal.Registry.AgentSessions()` is
  non-empty. Either input changing recomputes this one boolean.

Asserted iff `manual || agent` — SPEC's additive composition, stated as a set:

```go
type Reason string

const (
	ReasonManual Reason = "manual"
	ReasonAgent  Reason = "agent"
)
```

`Controller.Set(reason, on)` adds or removes one member, then compares `len(reasons) > 0` against
its own `held` flag and acts **only on the transition**:

| `reasons` before | call | `reasons` after | driver |
|---|---|---|---|
| `{}` | `Set(manual, true)` | `{manual}` | `Acquire` |
| `{manual}` | `Set(manual, true)` | `{manual}` | nothing (idempotent) |
| `{manual}` | `Set(agent, true)` | `{manual, agent}` | nothing (already held) |
| `{manual, agent}` | `Set(manual, false)` | `{agent}` | nothing — **the premature-release case SPEC names** |
| `{agent}` | `Set(agent, false)` | `{}` | `Release` |
| `{}` | `Set(agent, false)` | `{}` | nothing |

### 1.2 Why a set, not a counter

A counter is correct only if every source's on and off calls are perfectly paired, forever. Neither
source here is edge-shaped:

- The manual source is re-asserted by any window that toggles it, and by the boot-time recompute.
- The agent source is recomputed wholesale on every `Registry.OnChange` firing and on every settings
  change — it says "agent-held: true" many times in a row while three sessions come and go.

With a counter, `Set(agent, true)` twice leaks a reference and the assertion never releases. With a
set, the second call is a no-op by construction. The set has exactly two members ever, so it is a
`map[Reason]struct{}` for clarity, not for scale.

### 1.3 Concurrency

`Set`, `Rearm` and `Close` all take `Controller.mu` and perform the driver call **inside** the lock,
so no two transitions can interleave and no acquire can land after the release that was meant to
follow it. Acquire is a `fork`/`exec`; release is a `Process.Kill()` — both are bounded, and
`Wait()` is deliberately **not** called under the lock (the driver hands the finished `*exec.Cmd` to
its own reaper goroutine, §2.3), so the lock is never held across an unbounded wait.

Callers arrive from three goroutines: the Wails bound-call goroutine (the titlebar toggle, the
Settings toggle), the terminal registry's own `remove`/`Open` path (`session.go:250`-`:259` —
`OnChange` is documented as fired *outside* the registry mutex, so calling back into
`AgentSessions()` from it is safe), and the Wails application-event goroutine (resume). The unit
test drives all three concurrently under `-race` (§10.1).

### 1.4 Self-heal, not respawn-loop

If `caffeinate` exits on its own (killed by the user, or never started because the binary is
missing), the driver's reaper marks the controller `held = false` and records the error. It does
**not** immediately respawn — an immediately-failing binary would spin. The next `Set` or `Rearm`
recomputes `want` against the now-false `held` and re-acquires, which is what the resume event and
any session/settings change already do. No timer, no backoff, no loop.

---

## 2. `apps/kira-studio/internal/keepawake` — the new package

Four files plus a test. Pure Go, no build tags, no cgo — `internal/gitclient/discovery.go:140`-`:148`'s
`NewPlatformLocator` is the house precedent: a `runtime.GOOS` switch selecting a real darwin
implementation from a package that still compiles, vets and tests on Linux.
`docs/DEV_ENVIRONMENT.md`'s "`darwin && cgo` file is compiled, vetted and tested by nobody" note is
exactly the reason not to reach for build tags here.

The package imports nothing from `internal/bridge` (`internal/layering_test.go`'s
`TestDomainPackagesDoNotImportBridge` enumerates every `internal/*` package from `go list`, so a new
one is covered automatically).

### 2.1 `keepawake.go` — the controller

```go
// Controller composes N independent on/off reasons onto one OS-level assertion (P87 §1): the
// assertion is acquired when the first reason turns on and released when the last turns off.
// A set, not a counter — both sources are level signals, re-asserted freely (§1.2).
type Controller struct {
	mu      sync.Mutex
	driver  Driver
	reasons map[Reason]struct{}
	held    bool
	lastErr error
}

func New(d Driver) *Controller
func (c *Controller) Set(r Reason, on bool)
func (c *Controller) Rearm()          // §1.4 / §5: release+acquire while held, nothing otherwise
func (c *Controller) Held() bool
func (c *Controller) Err() error      // the last acquire failure, "" once an acquire succeeds
func (c *Controller) Close()          // release unconditionally; app teardown
```

`Set`'s whole body is the §1.1 table: mutate the set, `want := len(c.reasons) > 0`, return unless
`want != c.held`, then `acquireLocked`/`releaseLocked`. Nothing else branches.

### 2.2 `driver.go` — the OS abstraction

```go
// Driver is one OS's keep-awake assertion — acquire/release, exactly the pair SPEC names.
// Acquire is called only when nothing is held; Release only when something is.
type Driver interface {
	Acquire() error
	Release()
	Supported() bool
}

// NewPlatformDriver selects the darwin driver on macOS and a documented no-op everywhere else
// (SPEC: "every other OS stays a documented no-op") — NewPlatformLocator's own shape.
func NewPlatformDriver() Driver {
	if runtime.GOOS == "darwin" {
		return newCaffeinateDriver()
	}
	return noopDriver{platform: runtime.GOOS}
}
```

`noopDriver.Acquire` returns nil and logs once at debug; `Supported()` is false. It is a real,
honest no-op, not a stub error — the renderer hides the control entirely when `Supported()` is
false (§3.1, §8.2), so no user ever gets a button that silently does nothing.

### 2.3 `caffeinate.go` — the darwin driver

```go
const (
	// caffeinateFallbackPath is used only when LookPath cannot resolve the name — caffeinate
	// ships at this fixed location on every macOS (internal/startupfail's own
	// osascriptFallbackPath note, alert.go:15-19).
	caffeinateFallbackPath = "/usr/bin/caffeinate"
)

// caffeinateArgv is the whole command line, as a pure function so alert_test.go's golden-argv
// precedent applies (§10.2):
//
//	-i   prevent idle sleep
//	-s   prevent system sleep (macOS honours this on AC power only — see ARCHITECTURE.md)
//	-w   exit when this app's own process does, so a crash cannot orphan the assertion (§0)
func caffeinateArgv(pid int) []string {
	return []string{"-i", "-s", "-w", strconv.Itoa(pid)}
}
```

`Acquire`:

- resolve the binary once per acquire (`exec.LookPath("caffeinate")`, falling back to the fixed
  path), so a `PATH` change between launches is picked up;
- `exec.Command(path, caffeinateArgv(os.Getpid())...)` with `SysProcAttr{Setpgid: true}` — this
  repo's standing spawn discipline (`internal/startupfail/exec.go:32`-`:36`, `internal/gitclient`'s
  own runner). No shell, argv only, no renderer-controlled string anywhere in the line: the only
  variable is our own pid;
- `cmd.Stdin/Stdout/Stderr` stay nil (`caffeinate` writes nothing);
- `cmd.Start()`, then one goroutine per spawn: `err := cmd.Wait()`, and if this exit was not
  requested by `Release`, report it through the driver's `onLost` callback (§1.4).

`Release`: set the "expected" flag, `cmd.Process.Kill()`, leave the reaper goroutine to `Wait()`.
Idempotent and safe when nothing is running.

`Supported()` returns true.

### 2.4 What this package deliberately does not do

- No display assertion (`-d`) — SPEC's own excluded item (§13).
- No `pmset` invocation, for status or anything else. Nothing in the app reads back the OS's own
  assertion list; the controller's `held` is the app's own record of what it asked for.
- No settings access, no event emission, no bridge import. It is handed a `Driver` and told which
  reasons are on; everything policy-shaped lives one layer up, in `internal/bridge`.

---

## 3. `internal/bridge/keepawake.go` — the bound service

Modelled on `internal/bridge/agenthooks.go` line for line: a `Deps`-carrying service that owns a
lifecycle object, with the renderer-facing methods exported and the app-internal triggers as
package-level functions (that file's own comment states why — Wails binds *every* exported method
of a registered service, so anything that must not be renderer-callable cannot be a method).

### 3.1 Shape

```go
type KeepAwakeService struct {
	Deps appcore.Deps
	// Ctl is exported so main.go can inject the platform driver (TerminalService.Registry's own
	// shape). Wails binds a registered service's exported *methods*, never its fields, so this
	// widens nothing on the wire.
	Ctl *keepawake.Controller

	mu         sync.Mutex
	agentCount int
}

// KeepAwakeStatus is the wire projection every method returns, and ChannelKeepAwake's payload.
type KeepAwakeStatus struct {
	// Manual is the titlebar button's own state — app-wide, process-scoped (§3.2).
	Manual bool `json:"manual"`
	// Supported is false on every non-darwin build: the titlebar hides the button outright
	// rather than offering a control that does nothing.
	Supported bool `json:"supported"`
	// Error names why an acquire failed (caffeinate missing, spawn refused). "" otherwise.
	Error string `json:"error"`
}
```

`Held`/`agentCount` are deliberately **not** on the wire: the button shows its own source only
(SPEC: "exactly two states"), and a "an agent is currently holding it" indicator would be the third
state the row rules out (§13).

Exported (wire-callable, both harmless):

- `Status() KeepAwakeStatus` — the boot-time hydrate, `AgentHooksService.Status`'s own role.
- `SetManual(args KeepAwakeSetManualArgs) KeepAwakeStatus` — `Ctl.Set(keepawake.ReasonManual, args.Enabled)`,
  then broadcast + return.
- `SetAgentAware(args KeepAwakeSetAgentAwareArgs) (KeepAwakeStatus, error)` — patches
  `claudeCode.keepAwakeWithAgents` through `Deps.Repos.Settings.Set`, emits
  `ChannelSettingsChanged` with the merged settings, recomputes the agent reason, broadcasts,
  returns. This is `AgentHooksService.SetEnabled` (`agenthooks.go`'s own method) with a different
  side effect, including the `ipcerr.Internal` wrap on a repo failure.

Package-level, so the renderer can never reach them:

- `KeepAwakeAgentSessionsChanged(s *KeepAwakeService, count int)` — stores the count, recomputes.
- `KeepAwakeSystemDidWake(s *KeepAwakeService)` — `s.Ctl.Rearm()`.
- `StartKeepAwake(s *KeepAwakeService)` — boot recompute (`StartAgentHooksIfEnabled`'s own posture:
  read settings, log and continue on failure, never fatal).
- `StopKeepAwake(s *KeepAwakeService)` — `s.Ctl.Close()`, in `teardown`.

`recomputeAgent` reads the leaf fresh from `Deps.Repos.Settings.GetAll()` on every call — P86's own
stated convention for this section ("read fresh at every launch, never cached",
`model/settings.go:68`-`:72`). The read is local SQLite and happens at most once per PTY
open/close or toggle click.

### 3.2 Broadcast: `ChannelKeepAwake`

`internal/bridge/events.go`, beside `ChannelAgentEvent` (`:78`):

```go
	// ChannelKeepAwake is P87 §3.2's own app-wide broadcast — the titlebar toggle's state,
	// Emit'd (not EmitTo) exactly like ChannelAgentSessions: one machine, one assertion, so
	// every window's titlebar button must agree. Process-scoped, never persisted: an OS power
	// assertion that outlives the reason a user made it is a surprise, and the persistent half
	// of this feature is the Settings toggle.
	ChannelKeepAwake = "kira:keepAwake:changed"
```

Mirrored in `packages/shared/protocol/events.ts` (`:53`-`:56`'s block) and
`apps/kira-studio/tests/ui/support/ipcChannels.ts` (`:227`'s block, verbatim wire string, no
`FQN_SUFFIX_BY_IPC_KEY` entry — it is a push channel, driven in specs by `emitWailsEvent`).

---

## 4. `main.go` wiring

Four edits, all in the existing block that already constructs `agentHooksSvc` and `terminalSvc`
(`:305`-`:322`).

**Construction**, after `agentHooksSvc` (`:308`-`:309`) and **before** `terminalSvc`, since the
terminal registry's `OnChange` closure closes over it:

```go
	// P87 §3/§4: one keep-awake assertion for the whole app, composed from the titlebar toggle and
	// the agent-aware setting (§1). The driver is a runtime.GOOS switch — a real caffeinate child
	// on macOS, a documented no-op everywhere else.
	keepAwakeSvc := &bridge.KeepAwakeService{Deps: deps, Ctl: keepawake.New(keepawake.NewPlatformDriver())}
	bridge.StartKeepAwake(keepAwakeSvc)
```

**Fan-out** at `:322`, today a single-consumer assignment:

```go
	terminalSvc.Registry.OnChange = func() {
		bridge.TerminalAgentSessionsChanged(terminalSvc)
		// P87 §1.1: the agent reason's other input. AgentSessions() is safe to call from here —
		// session.go:250-259 documents OnChange as fired outside the registry mutex for exactly
		// this reason.
		bridge.KeepAwakeAgentSessionsChanged(keepAwakeSvc, len(terminalSvc.Registry.AgentSessions()))
	}
```

**Resume**, beside `shell.AttachReopen(app, reopenWindow)` (`:664`):

```go
	shell.AttachSystemWake(app, func() { bridge.KeepAwakeSystemDidWake(keepAwakeSvc) })
```

**Teardown**, in `teardown`'s `sync.OnceFunc` beside `bridge.StopAgentHooks(agentHooksSvc)`
(`:357`). Place it **before** `terminalSvc.Shutdown()` — order is not load-bearing here (the
controller's release is independent of the PTY registry), but killing the assertion early keeps the
window between "app is quitting" and "caffeinate is dead" as short as possible.

**Registration**, in the `application.NewService(...)` list beside `agentHooksSvc` (`:420`):
`application.NewService(keepAwakeSvc)`.

---

## 5. `internal/shell/app.go` — resume detection

One function, directly modelled on `AttachReopen` (`:163`-`:174`), which is already this file's
only `OnApplicationEvent` user:

```go
// AttachSystemWake fires onWake after the machine comes back from sleep (P87 §5). Wails already
// observes NSWorkspaceDidWakeNotification (application_darwin.go:65) and posts
// events.Mac.ApplicationDidWake from its app delegate — no pmset poll and no IOKit cgo of our own.
//
// Registering this listener is load-bearing, not merely how we hear about the event: the delegate
// body is `if (hasListeners(EventApplicationDidWake)) processApplicationEvent(...)`
// (application_darwin_delegate.m:45-49), so an unobserved event is never posted at all.
//
// events.Mac.ApplicationDidWake, not events.Common.SystemDidWake — the delegate posts the mac id
// (1079) specifically, and AttachReopen above already uses the events.Mac.* vocabulary.
func AttachSystemWake(app *application.App, onWake func()) (detach func()) {
	return app.Event.OnApplicationEvent(events.Mac.ApplicationDidWake, func(*application.ApplicationEvent) {
		onWake()
	})
}
```

On Linux (`wails3 task dev`, and the `-tags server` build) the event simply never fires; the driver
is a no-op there anyway.

Why re-arm at all, given `caffeinate` is still running: SPEC's own carried-over finding, confirmed
against Orca — a live `caffeinate` process's assertion does not reliably survive a sleep/wake cycle.
`Rearm` is release-then-acquire on the same controller, so a machine that woke with a working
assertion simply gets a fresh child, and one that woke without gets a working one.

---

## 6. The settings leaf — all five layers

One boolean, `claudeCode.keepAwakeWithAgents`, default **false** (SPEC: off by default; the branch
already carries `bb13710e` correcting this).

1. **`packages/shared/domain/settings.ts`** — `claudeCodeSettingsSchema` (`:173`-`:176`) gains
   `keepAwakeWithAgents: z.boolean().default(false)`; the `settingsSchema.claudeCode` default
   (`:208`-`:211`) and `defaultSettings.claudeCode` (`:270`-`:272`) each gain
   `keepAwakeWithAgents: false`. `settingsPatchSchema` (`:224`) needs no edit — it is
   `.partial()` over the same object.
2. **`apps/kira-studio/internal/storage/model/settings.go`** — `ClaudeCodeSettings` (`:73`-`:76`)
   gains `KeepAwakeWithAgents bool \`json:"keepAwakeWithAgents"\``; `DefaultSettings()` (`:145`)
   and `ClaudeCodePatch` (`:206`-`:208`, as `*bool`) follow. No `Valid*` helper — a bool has no
   domain to validate.
3. **`apps/kira-studio/internal/storage/repos/settings.go`** — one `leaf(...)` line at `:80`'s
   block, and one `if cc.KeepAwakeWithAgents != nil` arm in `Set` at `:231`-`:241`'s block.
4. **`apps/kira-studio/frontend/src/state/settings.ts`** — nothing. `applySettings` already does
   `Object.assign(settingsState.claudeCode, settings.claudeCode)` (`:81`).
5. **`SettingsDialog.vue`** — §9.

`defaultSettings` (TS) and `DefaultSettings()` (Go) must stay identical, as
`model/settings.go:105`'s own comment requires.

---

## 7. Frontend plumbing

### 7.1 `apps/kira-studio/frontend/src/state/keepAwake.ts` (new)

`state/agentHooks.ts`'s shape exactly — a `reactive` status, a hydrate, two setters that write the
confirmed value straight back rather than waiting for the broadcast echo (that file's `:23`-`:33`
comment states the reasoning; it applies here verbatim):

```ts
type KeepAwakeStatus = Awaited<ReturnType<typeof control.keepAwakeStatus>>;

export const keepAwakeState = reactive({
  status: { manual: false, supported: false, error: '' } as KeepAwakeStatus,
});

export async function initKeepAwake(): Promise<void> { … }          // hydrate + subscribe
export async function setKeepAwakeManual(on: boolean): Promise<void> { … }
export async function setKeepAwakeAgentAware(on: boolean): Promise<void> { … }
```

`initKeepAwake` both hydrates (`control.keepAwakeStatus()`) and subscribes
(`control.onKeepAwakeChanged`), unsubscribing a previous subscription first —
`state/agentSessions.ts:92`-`:105`'s own pattern, needed for the same reason (a window opened after
another window turned the toggle on must not show it off).

`setKeepAwakeAgentAware` also writes `settingsState.claudeCode.keepAwakeWithAgents = on` directly,
mirroring `setAgentHooksEnabled`'s `:32`.

### 7.2 `apps/kira-studio/frontend/src/bridge/index.ts`

Three entries beside the P86 block (`:373`-`:379`), same "just unwrap, no `trust()`" shape that
block's own comment argues for (a bool, a bool and a string — nothing secret, no zod schema):

```ts
  keepAwakeStatus: (): Promise<WailsModels.KeepAwakeStatus> => unwrap(KeepAwakeService.Status()),
  keepAwakeSetManual: (enabled: boolean): Promise<WailsModels.KeepAwakeStatus> =>
    unwrap(KeepAwakeService.SetManual({ enabled })),
  keepAwakeSetAgentAware: (enabled: boolean): Promise<WailsModels.KeepAwakeStatus> =>
    unwrap(KeepAwakeService.SetAgentAware({ enabled })),
  onKeepAwakeChanged: (cb: (s: WailsModels.KeepAwakeStatus) => void): (() => void) =>
    on(CHANNEL.keepAwake, cb),
```

Bindings regenerate with `wails3 task common:generate:bindings` in the same commit
(`docs/DEV_ENVIRONMENT.md`: a missing binding fails the Vite build with an unresolvable import).

### 7.3 `apps/kira-studio/frontend/src/main.ts`

`initKeepAwake()` joins the unconditional boot `Promise.all` (`:298`-`:317`), beside
`initAgentSessions()` (`:314`).

---

## 8. `TitleBar.vue`

### 8.1 The reorder

Current DOM order inside `.title-bar-actions` (`:62`-`:108`):

| lines | `data-testid` |
|---|---|
| `:63`-`:71` | `new-window` (P92 item 3, `.title-action--labelled`) |
| `:72`-`:84` | `toggle-project-panel` |
| `:85`-`:97` | `toggle-operations-panel` |
| `:98`-`:107` | `open-settings` |

Target, per SPEC: `toggle-project-panel`, `toggle-operations-panel`, `open-settings`,
`toggle-keep-awake`, `new-window`.

The edit is a pure move: cut `:63`-`:71` verbatim and paste it after `open-settings`, then insert
the new button between `open-settings` and it. No markup inside the moved block changes, and no CSS
changes — `.title-bar-actions` is a plain flex row with `margin-left: auto` (`:205`-`:211`), so the
bar's own `padding-right: var(--kira-s-3)` (`:129`) already spaces the new rightmost item
correctly, and `.title-action--labelled` (`:234`-`:239`) travels with the button it styles.

**One existing test breaks and must be updated, not deleted**:
`apps/kira-studio/tests/ui/workbench.spec.ts:59`-`:79` asserts
`expect(testIds).toEqual(['new-window', 'toggle-project-panel'])` and its title says "before the
project-panel toggle". Both the assertion and the title are now wrong (§10.3).

### 8.2 The new button

```html
      <button
        v-if="keepAwakeState.status.supported"
        type="button"
        class="title-action"
        :class="{ 'is-on': keepAwakeState.status.manual }"
        :aria-pressed="keepAwakeState.status.manual"
        v-tooltip="keepAwakeTooltip"
        data-testid="toggle-keep-awake"
        aria-label="Keep this Mac awake"
        @click="onToggleKeepAwake"
      >
        <CodiconIcon name="coffee" :size="15" />
      </button>
```

`v-if` on `supported`, not `:disabled`: a disabled button is a third visual state, and the only
build that ever sees `supported: false` is a non-macOS dev/`-tags server` one. `aria-label` is
fixed; the tooltip names the state, and names an acquire failure when there is one:

```ts
const keepAwakeTooltip = computed(() => {
  if (keepAwakeState.status.error) return `Keep awake failed: ${keepAwakeState.status.error}`;
  return keepAwakeState.status.manual
    ? 'Keeping this Mac awake — click to stop'
    : 'Keep this Mac awake';
});
```

`onToggleKeepAwake` calls `setKeepAwakeManual(!keepAwakeState.status.manual)` and logs a rejection,
`onNewWindow`'s own posture (`:26`-`:30`: no toast channel in the title bar).

### 8.3 The two visual states

- **Off** — `.title-action`'s resting style, untouched: transparent border, no background,
  `color: var(--kira-fg-muted)` (`:213`-`:228`).
- **On** — `.title-action.is-on` (`:248`-`:255`): `--kira-bg-elevated` background, a
  `--kira-border-strong` border in the slot a transparent border already reserves, and
  full-brightness `--kira-fg`. Exactly what the Connections and Operations toggles use, so "this
  button is on" reads identically across the row.

No new CSS. The deviation from the panel toggles is that this button cannot also swap its glyph:
`@vscode/codicons` ships no `coffee-off`, and none of the glyph pairs that do exist names the right
thing — `eye`/`eye-closed` would promise a *display* assertion this phase explicitly excludes
(§13), and `bell`/`bell-slash` names notifications. `aria-pressed` plus the state-naming tooltip
carry what the missing second glyph would have, so the state is not colour-only for a screen reader
or for a hover.

The button shows **only** the manual source. When the agent-aware setting is holding the assertion
and the button is off, the button stays off — SPEC's "exactly two states". An "auto-held" third
appearance is out of scope (§13).

---

## 9. `SettingsDialog.vue` — the agent-aware toggle

A second `label.field.checkbox` inside the existing `activeSection === 'Claude Code'` template
(`:1577`-`:1612`), after the hooks toggle and its status block:

```html
            <label class="field checkbox">
              <Checkbox
                :model-value="settingsState.claudeCode.keepAwakeWithAgents"
                :disabled="keepAwakeAgentAwareToggling"
                data-testid="settings-claude-code-keep-awake"
                @update:model-value="onToggleKeepAwakeAgentAware"
              />
              <span>Keep this Mac awake while a Claude Code session is running</span>
              <span class="helper-text"
                >Prevents idle sleep, and system sleep on AC power, for as long as at least one
                Claude Code tab is live. Independent of the title bar's own keep-awake button —
                either one is enough to keep the machine awake.</span
              >
            </label>
```

The script half copies `claudeCodeHooksToggling`/`onToggleAgentHooksEnabled` (`:335`-`:345`)
verbatim with the new setter. Instant-action, matching the section's existing posture and its
`:1578`-`:1581` comment: this leaf both persists and changes a live OS assertion in one call, so it
belongs on the action side of the draft/Save line.

The helper text states the AC-power caveat rather than promising more than `-s` delivers, and states
the composition rule in the one place a user can actually read it.

---

## 10. Test impact

### 10.1 `internal/keepawake/keepawake_test.go` — yes, this clears the bar

`CLAUDE.md`'s bar admits "cache eviction/invalidation with interacting rules" and "concurrency
(ordering, backpressure, cancellation, races)". The controller is both: two level sources composing
onto one acquire/release pair, with transition-only side effects, a re-arm, and a self-heal path,
driven from three goroutines. Its failure modes are a leaked OS assertion (a laptop that never
sleeps again, with no UI anywhere that shows it) and an early release while the other source still
holds — neither is visible in any other test this repo runs.

A `fakeDriver` that **asserts its own invariant** is the heart of it: it fails the test on
`Acquire` while already acquired, or `Release` while not, so every case below checks double-acquire
and premature-release for free.

| case | assertion |
|---|---|
| manual on | 1 acquire |
| manual on, on, on | still 1 acquire |
| manual on, agent on, manual off | 0 releases — SPEC's named case |
| manual on, agent on, both off | exactly 1 release |
| agent on/off/on | 2 acquires, 1 release |
| `Rearm` while held | 1 release + 1 acquire, in that order |
| `Rearm` while idle | no driver calls |
| driver reports an unexpected exit, then any `Set` | re-acquires (§1.4) |
| two goroutines flipping the two reasons, `-race` | the fake's invariant never trips; the set is empty and nothing is held at the end |

### 10.2 `internal/keepawake/caffeinate_test.go`

- `TestCaffeinateArgvGolden` — `caffeinateArgv(4242)` is `[]string{"-i", "-s", "-w", "4242"}`, byte
  for byte. `internal/startupfail`'s `TestAlertArgvGolden` is the precedent, and the reason is the
  same: the spawn is the whole security and correctness surface of the file.
- One lifecycle test, runnable on Linux because the driver is pure Go: point the driver at an
  injected binary path (a `sleep` or a tiny test helper) instead of `caffeinate`, `Acquire`, assert
  the child is alive, `Release`, then **poll** for `ESRCH` with a multi-second timeout —
  `docs/DEV_ENVIRONMENT.md`'s own note that this container's minimal init reaps slowly, the same
  reason `internal/preconnect`'s and `internal/connections`' process-group tests poll. This is the
  one test that catches "release does not actually kill it", which is the leak.

That injection point is a package-private field on the driver (a `lookPath func(string) (string, error)`
seam, `internal/startupfail/exec.go:13`-`:16`'s `realLookPath` pattern), not an exported option —
nothing outside the package may choose what binary gets spawned.

### 10.3 `apps/kira-studio/tests/ui/`

- **`workbench.spec.ts`** — update the existing P92 test (`:59`-`:79`): its title, and the DOM-order
  assertion, which becomes the full five-item order
  `['toggle-project-panel', 'toggle-operations-panel', 'open-settings', 'toggle-keep-awake', 'new-window']`.
  Then one new test: the keep-awake button renders, one click issues exactly one
  `KeepAwakeService.SetManual` carrying `{ enabled: true }`, and the button gains `.is-on` /
  `aria-pressed="true"`. A second case drives `emitWailsEvent(page, IPC.keepAwake, { manual: true, … })`
  with no click at all and asserts the button turns on — the cross-window broadcast, which nothing
  else covers.
- **`settings-claude-code.spec.ts`** — a case beside the existing two: the new checkbox is
  unchecked by default, and clicking it issues one `KeepAwakeService.SetAgentAware` with
  `{ enabled: true }`. That file's own `openSettings`/`dialog` helpers and its
  `settings-section-Claude Code` click are reused as-is.
- **`mockRuntime.ts`** — `keepAwakeStatus: 'KeepAwakeService.Status'` (and the two setters) in the
  FQN map at `:196`-`:198`, plus a default response beside `[IPC.agentHooksStatus]` (`:414`):
  `{ manual: false, supported: true, error: '' }`. `supported: true` so the button renders in every
  spec — the UI suite runs against a static server, not a real Go build, and a spec that never cares
  about keep-awake should still see the titlebar it will ship with.
- **`ipcChannels.ts`** — the three call channels beside `:200`-`:202`, and the push channel beside
  `:227`.

### 10.4 What is not tested, and why

- **The real OS assertion.** `pmset -g assertions` is the only honest check that `caffeinate -i -s`
  actually took a `PreventUserIdleSystemSleep` assertion, and this container has neither `pmset` nor
  `caffeinate` and cannot run darwin code at all. It is a manual macOS step (§12), not a faked one.
- **The resume re-arm.** Needs a real sleep/wake on real hardware. Manual (§12).
- **`state/keepAwake.ts`** — a reactive bool and two awaits. Below the bar.
- **The settings leaf** — a CRUD round-trip through an already-covered repo shape, exactly what
  P92's own §12.4 declined for `git.graphFontSize`.
- **`TitleBar.vue`'s CSS** — layout in a real engine; §10.3's Playwright cases are its home.

---

## 11. Order of work

Seven commits. Real dependencies:

- **1 before 3** — the service constructs the controller.
- **2 before 3** — `recomputeAgent` reads the leaf.
- **3 before 5 and 6** — both UI halves call bound methods that must exist and be in the bindings.
- **7 last** — the UI specs assert against both halves.

1. `feat(keepawake): add an OS-abstracted keep-awake assertion` — §2, §10.1, §10.2. Self-contained;
   nothing calls it yet.
2. `feat(settings): add the agent-aware keep-awake leaf` — §6, all five layers, no UI.
3. `feat(bridge): compose keep-awake from the titlebar toggle and the agent count` — §3, §4, §5,
   §7.2's bindings regeneration, with the generated `frontend/bindings/**` committed alongside.
4. `feat(workbench): track keep-awake state in the renderer` — §7.1, §7.3.
5. `feat(workbench): add a keep-awake button to the title bar` — §8, including the reorder.
6. `feat(settings): add the agent-aware keep-awake toggle` — §9.
7. `test(ui): cover P87's titlebar toggle and agent-aware setting` — §10.3, including the P92 test
   update.

Then one docs commit if `docs/ARCHITECTURE.md` needs it — it does: a short subsection under
**Process model** (`:2565`) naming the fourth child process this app can spawn, its argv, its
lifetime, the AC-power caveat on `-s`, the non-macOS no-op, and the composition rule. Not a "Known
open items" entry: the non-macOS no-op is this phase's stated scope, not an open limitation, and the
app ships macOS-only.

Conventional Commits; each message ends with the two attribution lines this session uses.

---

## 12. Verification

Per commit (fast, cheap):

- `go build ./apps/kira-studio/... && go vet ./apps/kira-studio/...` on 1, 2, 3
- `bun run typecheck`, `bun run lint`, `bun run build` on 2, 3, 4, 5, 6, 7
- `wails3 task common:generate:bindings` before commit 3's build

Once, near the end (`CLAUDE.md`'s "implement the whole plan first, then test once"):

- `go test ./apps/kira-studio/internal/keepawake/... -race`
- `go test ./apps/kira-studio/internal/storage/... ./apps/kira-studio/internal/` (the second picks up
  `layering_test.go` against the new package)
- `bun run build:test`, then `workbench.spec.ts` and `settings-claude-code.spec.ts`. The `ui`
  project runs webkit (`playwright.config.ts:49`), not preinstalled here — `bunx playwright install
  webkit` first, per `docs/DEV_ENVIRONMENT.md`.

Manual, on real macOS hardware, for everything this sandbox cannot reach:

1. Titlebar order reads Connections, Operations, Settings, keep-awake, New window.
2. Click the keep-awake button on. `pmset -g assertions` lists a `PreventUserIdleSystemSleep`
   assertion owned by `caffeinate`; `pgrep -fl caffeinate` shows one child with `-i -s -w <pid>`.
   Click it off: both are gone. Click it on and off ten times: never more than one `caffeinate`.
3. Open a second window. Its button already reads on, and toggling it in either window flips both.
4. With the button **off**, turn the Settings toggle on and start a Claude Code tab: the assertion
   appears. Start a second tab, close the first: the assertion is still there, one process. Close the
   second: it goes. A plain shell tab or a custom-script tab must not take one (P86's own
   PTY-liveness rule — a script is never counted as an agent).
5. The overlap case, which is the whole point of §1: button on, agent session running, then turn the
   button **off**. The assertion must survive. Then end the session: it releases.
6. Sleep the Mac (Apple menu → Sleep) with the assertion held, wake it, and check `pmset -g
   assertions` again — a fresh `caffeinate` pid, assertion present.
7. Quit the app with the assertion held: no `caffeinate` survives. Then `kill -9` the app with the
   assertion held: `caffeinate` still exits on its own within a second or two (that is what `-w`
   buys).
8. On battery, `-s` is inert by design — confirm idle sleep is still prevented and that nothing in
   the UI claims otherwise.

Do not commit a screenshot or a findings document; the commit log is the record.

---

## 13. Out of scope

- **A separate "keep display awake" sub-toggle (`caffeinate -d`).** SPEC's own named exclusion:
  real and well-motivated, deliberately not folded in here. Its absence is not a bug, and the icon
  choice in §8.3 deliberately avoids promising it.
- **Any third visual state on the titlebar button**, including an "an agent is holding this" hint.
  SPEC: exactly two states, one click.
- **Persisting the titlebar toggle across relaunch** (§0, §3.2).
- **A popover, dropdown or three-option menu on P86's status-bar widget.** Superseded by this row's
  redesign; the status bar is untouched by this phase.
- **Windows and Linux implementations.** `noopDriver` is the shipped behaviour there, and the button
  does not render (§8.2).
- **Reading the OS's own assertion list back** (`pmset -g assertions` as a runtime status source).
  The controller's `held` is the app's record of what it asked for; nothing polls the OS.
- **A timer, backoff or supervisor around a failing `caffeinate`.** §1.4's self-heal is the whole
  recovery story.
- **Any change to P86's agent-session count, its channel, or the status-bar widget.** This phase is
  a second consumer of that existing signal, never a second implementation of it.
