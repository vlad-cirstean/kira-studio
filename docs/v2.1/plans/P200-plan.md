# P200 plan: Docker module (Kira Studio), shared package

Source: user request 13 (`queued-requests.md` P200), `SPEC.md` row P200. Base: Stream B head
`1521741` (v2.0 + P189/P195). Runs in Stream B's worktree (`/home/user/kira-v21-B`, branch
`v2.1-stream-B`) while Streams A and C run in theirs.

Discovery used `codegraph_explore` on: both apps' `workbench/modes.ts`, `packages/workbench/src/modes.ts`,
`ModeSwitcher`, both `WorkbenchShell.vue`, `MainView`, `createModeStore`, `AppMode`, Studio
`tabDomain`/`tabKinds`/`tabViews`/`host.ts`, the terminal module (`module.ts`, `TerminalHostView`,
`useTerminalMount`, `terminalRenderer`, `terminalHost.ts`, `createTerminalsStore`, `tabRuntime`),
Go `internal/terminal` (`BoundService`, `Service.OpenWithCoalescedOutput`, `Registry`),
`internal/appevent`, `internal/shell` (`emitter`, `OpenWindow`), `internal/windowsvc`, Studio
`appcore.Deps`. Then a direct read of `main.go`, `bridge/rpc.ts`, `viteAppConfig.ts`, the Studio UI
mock runtime, `knip.json`, `biome.json`, `workbench.css`, the moby client module.

Rules: `CLAUDE.md` in full (terse, shadcn-vue/Tailwind/VueUse/Pinia/TanStack Query,
`<script setup lang="ts">`, Conventional Commits, no `--no-verify`, fix any red hook on the spot).
Stage only P200 files; never `git add -A`, never `git stash`. Do not edit `SPEC.md`,
`ARCHITECTURE.md`, `CLAUDE.md`: write results, deviations and proposed `ARCHITECTURE.md` text to
`docs/v2.1/plans/P200-notes.md`, committed as you go.

## 0. Decisions

**D1 Engine access: Docker Engine API over the socket, Go client `github.com/moby/moby/client`.**
Not the `docker` CLI. Reasons: (a) logs follow, stats stream and exec attach are long-lived HTTP
streams / a hijacked connection; the client gives them as `io.ReadCloser`/`net.Conn` with context
cancellation, the CLI needs a process per stream plus output parsing; (b) a Finder-launched app has
no shell `PATH`, so `docker` is often not even found; (c) typed results, no format-string parsing.
`github.com/moby/moby/client` v0.5.1 is already in `go.sum` (indirect, via testcontainers) and
`github.com/moby/moby/api` v1.56.0 is already direct. `github.com/docker/docker` is the frozen
pre-split path; do not use it. License: Apache-2.0 (checked: `LICENSE` in both module dirs, no
`NOTICE`). Features used are all in the open-source engine API; no paid tier involved.

**D2 `ssh://` hosts: `github.com/docker/cli/cli/connhelper`** (Apache-2.0, `v29.8.2+incompatible`,
has a `NOTICE` → add a `NOTICES.md` entry). It is exactly what `docker` itself uses to dial
`ssh://user@host` (`ssh … docker system dial-stdio`). Imports only stdlib, its own subpackages and
`logrus` (already in `go.sum`). Wire through `client.WithDialContext` + `WithHost("http://docker.example.com")`
per connhelper's documented use. Docker context store / config reading is hand-rolled (two small
JSON files); declined `docker/cli/cli/context/store` + `cli/config`: they pull credential-helper and
config machinery for what is a `meta.json` + `config.json` read.

**D3 Shared code layout.** Mirrors the terminal module's two-tier shape.
- Go: repo-root `internal/docker` (shared by both apps, like `internal/terminal`), exposing a
  `BoundService`. Studio adds a one-line shim `apps/kira-studio/internal/bridge/docker.go`
  (`type DockerService struct{ *docker.BoundService }`) so binding names stay app-local
  (`internal/terminal/bound.go`'s own reasoning). Space adopts later with the same shim.
- Frontend: new workspace package `packages/docker-ui` (`@kira/docker-ui`), git-ui's exports-map
  precedent. It imports `@theme/*`, `@workbench/*`, `@shared/*` (resolved by the consuming app's
  aliases, as git-ui does). It never imports app code (biome rule, D10). Bindings are per-app, so
  the package defines a `DockerBindings` shape and `createDockerControl(bindings)` (the
  `createCoreControl` pattern); each app supplies its generated `@bindings/dockerservice.js`.

**D4 Module registration: a `PanelModeDef` in Studio's `MODES`, id `docker`, label `Docker`, icon
`vm`.** Panel = resource navigator; `start` = the Docker main view (rendered by `MainView`'s
`#empty` slot, since the Docker workspace never holds a workbench tab). No new tab kinds: tab kinds
would touch `tabDomain.ts`, `tabKinds.ts`, `tabViews.ts`, `STUDIO_TAB_KIND_MODE`, Go
`model/tabs.go` (mostly Stream A files) and would not port to Space's different tab model. The
module owns its own sub-navigation (container detail sub-tabs via `tabChipVariants`). The empty
workbench tab strip is hidden for this module: `PanelModeDef` gains optional `tabStrip?: false`
(`packages/workbench/src/modes.ts`), Studio's shell passes `:tab-strip-visible` (seam S5).

**D5 Context injection without touching `App.vue`/`main.ts`.** `packages/docker-ui` exports
`provideDocker(ctx)`/`useDocker()` (an `InjectionKey`). Studio's two thin wrappers
(`apps/kira-studio/frontend/src/docker/DockerPanel.vue`, `DockerView.vue`) each call
`provideDocker(studioDocker())` (one module-level lazily built context) and render the package's
`DockerPanel`/`DockerView`. Panel and view are siblings, so each provides; both get the same object.

**D6 Exec reuses the terminal stack unchanged.** `TerminalHostView.vue` takes `deps: TerminalHostDeps`,
so Docker builds its own deps from a second terminals store:
`createTerminalsStore(dockerExecControl, { appearance, storeId: 'docker-exec' })`. Only change to
shared terminal code: `createTerminalsStore` gains an optional `storeId` (default `'terminals'`),
because `defineStore('terminals')` would collide with the app's own store (seam S7, unowned file).
`dockerExecControl` implements `TerminalsControl` over `DockerService.Exec*` and the
`kira:docker:exec` channel (same payload as `kira:terminal:data`). `terminalOpen(id, …)` looks the
container up in a `Map<execId, containerId>` the UI fills before mounting the view; `cwd`/`command`/
`launchKind` are ignored. Closing a session: `store.closeTerminalSession(id)` then
`cleanupTabRuntime(id)` (`packages/workbench/src/state/tabRuntime.ts`) to dispose the xterm.

**D7 Logs are a virtualized line list, not xterm.** Needed: text filter with highlight, stderr
tint, timestamp column, wrap toggle, follow with "jump to latest". xterm offers none of those
without addons not in the tree. ANSI colour: `anser` 2.3.5 (MIT, maintained, `ansiToJson` with
`use_classes: true`); map its 16 named-colour classes to token classes, inline `rgb()` for 256/true
colour. Virtualization: `@tanstack/vue-virtual` through `packages/workbench/src/util/virtualRows.ts`
(`useVirtualRows`). Add `anser` to `NOTICES.md`.

**D8 Streams and their lifecycle (the hard part).** All long-lived work lives in Go, owned per
window, and is torn down by three paths: explicit close from the UI, window close, app quit.
- Window close: `internal/shell.WindowOpenerDeps` gains `OnWindowClosing []func(key string)`, called
  in `OpenWindow`'s existing `WindowClosing` listener next to `d.Terminal.CloseWindow(rec.Key)`.
  Studio passes `func(k string) { docker.CloseWindowBound(dockerSvc.BoundService, k) }` (seam S2).
  A package func, not a method: a bound method would let any window close another's sessions
  (`terminal.ShutdownBound`'s reasoning).
- App quit: `BoundService.ServiceShutdown() error` — Wails v3 calls it on every registered service
  and excludes it from bindings (`pkg/application/bindings.go:197-198`). No `wireLifecycle` edit.
- UI side: only while the module is mounted and the document is visible (VueUse
  `useDocumentVisibility`): events watch (panel), stats subscription (panel: running containers),
  logs stream (Logs sub-tab mounted). Hidden/unmounted → `Unwatch`/`StatsUnsubscribe`/`LogsClose`.
  Visible again → resubscribe and `invalidateQueries(['docker'])`. Exec sessions survive hide and
  sub-tab switches (that is the point of a terminal); they end on explicit close, process exit,
  window close or quit.
- Stats: one engine stats stream per container while ≥1 window subscribes it (refcount across
  windows); each window gets one aggregated `kira:docker:stats` event per second via `EmitTo`.
- Events: one engine `/events` stream while ≥1 window watches; reconnect every 2 s while watched;
  on stream error emit `kira:docker:status` (unavailable) and keep retrying `Ping`.

**D9 Endpoint resolution (docker CLI order), remote hosts, unavailable states.**
1. Context chosen in the UI this session (`UseContext`, in memory, all windows; not persisted —
   `docker context use` is the persistent switch and is honoured below).
2. `DOCKER_HOST` (process env; a Finder launch usually has none, so 3-4 cover the Mac case).
3. `DOCKER_CONTEXT`, else `currentContext` in `$DOCKER_CONFIG/config.json` (default `~/.docker`);
   context meta at `contexts/meta/<sha256(name)>/meta.json`, TLS material at
   `contexts/tls/<sha256(name)>/docker/{ca,cert,key}.pem`. Colima, OrbStack, Docker Desktop and
   Rancher Desktop all register a context, so this finds them with no env.
4. `unix:///var/run/docker.sock`; if absent, first existing of `~/.docker/run/docker.sock`,
   `~/.colima/default/docker.sock`, `~/.orbstack/run/docker.sock`, `~/.rd/docker.sock`
   (`Source: "probe"`).
TLS for `tcp://`: context TLS material, else `DOCKER_CERT_PATH` + `DOCKER_TLS_VERIFY`
(`client.WithTLSClientConfigFromEnv`). `ssh://` via D2. Always `WithAPIVersionNegotiation()`.
`Status.reason` values: `not-installed` (resolved unix socket missing and no `~/.docker` dir),
`daemon-down` (socket missing or connection refused), `permission-denied`, `unreachable`
(tcp/ssh dial or timeout), `tls`, `error` (anything else, message shown). UI: `Empty` state with
reason-specific title and guidance, the endpoint string, a Retry button and the context picker;
status refetches every 5 s while unavailable, never while ok (events cover it). A plain `tcp://`
endpoint shows a warning icon, tooltip "Unencrypted connection".

**D10 Scope.** In: containers (list, grouped by Compose project; start, stop, restart; overview,
logs, terminal, stats, inspect), images, volumes, networks (list + detail + "used by"), per-container
CPU/RAM in the list and a detail Stats view, endpoint/context switching, unavailable states. Out
(stay out entirely): remove/prune, pull/build/run/create, compose up/down, pause, registry login,
persisted endpoint override, Kira Space registration (later row). Env values in Overview are masked
with per-row reveal (they often hold secrets).

## 1. Go: `internal/docker` (shared)

Files and exported surface. Wire types carry `json` tags exactly as below (camelCase).

`endpoint.go`
- `type Endpoint struct { Context, Host, Source string; Secure, Remote bool }` (`source`: `selected|env|context|default|probe`).
- `type ContextInfo struct { Name, Host, Description string; Current bool }`.
- `type resolveEnv struct { Getenv func(string) string; Home string; Stat func(string) (os.FileInfo, error) }` (test seam).
- `func resolveEndpoint(env resolveEnv, selected string) (Endpoint, []client.Opt, error)`.
- `func listContexts(env resolveEnv) ([]ContextInfo, error)` (always includes `default`).

`manager.go`
- `type Manager struct` — current `*client.Client` + `Endpoint` under a mutex; `selected` context;
  `Emit appevent.Emitter`; the stats hub, events watcher, logs and exec registries.
- `func NewManager(emit appevent.Emitter) *Manager`.
- `func (m *Manager) client(ctx) (*client.Client, Endpoint, error)` — lazy; on first use or after
  reset, resolve + `client.New(opts...)`.
- `func (m *Manager) status(ctx, refresh bool) Status` — `Ping` (3 s timeout) + `Info`; maps errors
  to D9 reasons (`errors.Is(err, fs.ErrNotExist)`, `syscall.ECONNREFUSED`, `EACCES`, `*tls.*Error`,
  `net.Error.Timeout()`); `refresh` drops the cached client first.
- `func (m *Manager) useContext(name string) Status` — closes every stream (all windows), swaps
  client, emits `ChannelStatus` and `ChannelChanged{kinds: all}`.
- `func (m *Manager) closeWindow(key string)`; `func (m *Manager) shutdown()`.

`resources.go` — list/inspect/actions, each with a 15 s context timeout, `ipcerr` mapping
(`E_DOCKER_UNAVAILABLE` with `details: {reason}`, `E_NOT_FOUND` via `cerrdefs.IsNotFound`,
`E_INVALID` for bad args).
- `Container{ id, name, image, imageId, state, status, created, ports []Port, composeProject, composeService, networks []string }`
- `Port{ ip, privatePort, publicPort, type }`
- `Image{ id, tags []string, size, created, containers, dangling }` (`containers` from `ImageList` with `ContainerCount`/`SharedSize` off; compute in-use from the container list).
- `Volume{ name, driver, mountpoint, scope, created, labels, usedBy []string }` (`usedBy` = container names from `ContainerList(All)` mounts).
- `Network{ id, name, driver, scope, internal, subnets []string, containers int, builtin bool }` (`builtin`: bridge/host/none).
- `ContainerDetail{ container, command, entrypoint []string, env []string, workingDir, user, restartPolicy, health, startedAt, finishedAt, exitCode, tty bool, mounts []Mount, labels, networkAttachments []NetworkAttachment, raw string }` (`raw` = indented inspect JSON).
- `EngineInfo{ version, apiVersion, os, arch, operatingSystem, kernelVersion, cpus, memTotal, containers, running, paused, stopped, images }`.
- `Status{ state ("ok"|"unavailable"), reason, message, endpoint Endpoint, engine *EngineInfo }`.

`events.go` — watcher: `watch(windowKey)`/`unwatch(windowKey)` refcount; goroutine on
`cli.Events(ctx, {Filters: type=container|image|volume|network})`; debounce 250 ms; `Emit`
(broadcast) `ChannelChanged {kinds []string}`; on `Err` → emit status, sleep 2 s, retry while watched.

`stats.go`
- `func cpuPercent(s container.StatsResponse) float64` — docker CLI's Unix formula:
  `cpuDelta/systemDelta * onlineCPUs * 100`, `onlineCPUs` falls back to `len(PercpuUsage)`; 0 on
  non-positive deltas.
- `func memUsage(s container.StatsResponse) (used, limit uint64)` — usage minus cache: cgroup v2
  `inactive_file`, cgroup v1 `total_inactive_file`, clamped at 0.
- `StatsSample{ id, cpuPercent, memUsage, memLimit, memPercent, netRx, netTx, blockRead, blockWrite, pids, at }`.
- `type statsHub` — `subscribe(windowKey string, ids []string)` replaces that window's set;
  `unsubscribe(windowKey)`; per-container goroutine `ContainerStats(ctx, id, {Stream: true})`,
  JSON-decode loop, keep latest sample; started on first subscriber, cancelled on last; a 1 s
  ticker per window with ≥1 id emits `EmitTo(window, ChannelStats, {samples})`. Container exit →
  stream EOF → drop sample, no restart until resubscribed. `statsSource` interface seam
  (`open(ctx, id) (io.ReadCloser, error)`) for the hub test.

`logs.go`
- `LogsOpen{ windowKey, streamId, containerId, tail int (-1 = all), timestamps, follow }`.
- `ContainerInspect` for `Config.Tty`; `ContainerLogs(ctx, id, {ShowStdout, ShowStderr, Follow, Tail, Timestamps})`;
  non-TTY → demux with `github.com/moby/moby/api/pkg/stdcopy`; TTY → single stdout stream.
- `type lineFramer` — per-stream partial-line buffer; splits on `\n`, strips one trailing `\r`,
  truncates a line at 64 KiB (`…` marker), splits the RFC3339Nano prefix into `ts` when
  `timestamps`; flushes a trailing partial line at EOF.
- Coalesce with `appevent.NewCoalescer` (16 ms / 500 lines) →
  `EmitTo(window, ChannelLogs, { streamId, lines: [{ stream, ts, text }], ended, error })`. `ended`
  on EOF/cancel/error. `logsClose(streamId)` cancels. Registry keyed by streamId, indexed by window.

`exec.go`
- `ExecCreate(ctx, id, {Tty: true, AttachStdin/Stdout/Stderr: true, Cmd: ["/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"], ConsoleSize: rows/cols})`,
  `ExecAttach(ctx, execID, {Tty: true})`; reader goroutine → `appevent.Coalescer` (terminal's 16 ms
  / 16 KiB) → `EmitTo(window, ChannelExec, terminal.Event{…})`; EOF → `ExecInspect` exit code →
  final event. Distroless (no `/bin/sh`) surfaces as the engine's error text in `error`.
- `execWrite(id, b64)`, `execResize(id, cols, rows)` (`ExecResize`), `execClose(id)` (close the
  hijacked conn; the process gets SIGHUP from the tty). Registry keyed by terminalId, per window.
  Duplicate id → `E_INVALID` (mirror `terminal.ErrDuplicateSession`).

`bound.go` — `type BoundService struct{ m *Manager }`; `func NewBoundService(emit appevent.Emitter) *BoundService`;
`func CloseWindowBound(b *BoundService, key string)`; `func (b *BoundService) ServiceShutdown() error`.
Bound methods (args structs mirror `terminal/bound.go` style):
```
Status(StatusArgs{refresh}) Status
Contexts() ([]ContextInfo, error)
UseContext(UseContextArgs{name}) Status            // "" = automatic resolution
Containers(ListArgs{all}) ([]Container, error)
Images() ([]Image, error)
Volumes() ([]Volume, error)
Networks() ([]Network, error)
InspectContainer(IDArgs{id}) (ContainerDetail, error)
Inspect(InspectArgs{kind: image|volume|network, id}) (InspectResult{raw}, error)
Start(IDArgs) error; Stop(IDArgs) error; Restart(IDArgs) error
Watch(WindowArgs{windowKey}) error; Unwatch(WindowArgs) error
StatsSubscribe(StatsArgs{windowKey, ids}) error; StatsUnsubscribe(WindowArgs) error
LogsOpen(LogsOpenArgs) error; LogsClose(StreamArgs{streamId}) error
ExecOpen(ExecOpenArgs{windowKey, terminalId, containerId, cols, rows}) (ExecOpenResult{shell}, error)
ExecWrite(ExecWriteArgs{terminalId, data}) error   // base64
ExecResize(ExecResizeArgs{terminalId, cols, rows}) error
ExecClose(ExecCloseArgs{terminalId}) error
```
`channels.go` — `ChannelChanged = "kira:docker:changed"`, `ChannelStatus = "kira:docker:status"`,
`ChannelStats = "kira:docker:stats"`, `ChannelLogs = "kira:docker:logs"`, `ChannelExec = "kira:docker:exec"`.
Kept here, not in `appevent` or `packages/shared/protocol/events.ts` (C-owned): only Docker emits them.

Go deps: promote `github.com/moby/moby/client` to direct; add `github.com/docker/cli`. `go mod tidy`.

## 2. Frontend: `packages/docker-ui`

Package files: `package.json` (`@kira/docker-ui`, `main`/`types`/`exports` → `./src/index.ts`,
deps `@vueuse/core` 15.0.0, `anser` (pin exact), `vue` 3.5.42; devDeps as git-ui), `tsconfig.json`
(git-ui's, plus `@shared/*` and `/wails/runtime.js` paths).

`src/wire.ts` — TS mirrors of every §1 wire type, channel constants, event payloads
(`DockerChangedEvent`, `DockerStatsEvent`, `DockerLogsEvent`; exec reuses `TerminalEvent`).

`src/control.ts`
- `interface DockerBindings` — the generated binding module's shape (methods of §1, args objects).
- `interface DockerControl` — promise API: `status(refresh)`, `contexts()`, `useContext(name)`,
  `containers(all)`, `images()`, `volumes()`, `networks()`, `inspectContainer(id)`,
  `inspect(kind, id)`, `start/stop/restart(id)`, `watch()`, `unwatch()`, `statsSubscribe(ids)`,
  `statsUnsubscribe()`, `logsOpen(opts)`, `logsClose(streamId)`, `onChanged/onStatus/onStats/onLogs(cb)`,
  `exec: TerminalsControl`.
- `function createDockerControl(b: DockerBindings, execContainers: Map<string, string>): DockerControl` —
  `unwrap`/`trust`/`on`/`windowKey` from `@workbench/bridge/rpc`.

`src/context.ts` — `interface DockerContext { control; execStore; execHostDeps: TerminalHostDeps; execContainers }`;
`dockerKey`, `provideDocker(ctx)`, `useDocker()`. `createDockerContext(bindings, { appearance })`
builds it once: `createTerminalsStore(control.exec, { appearance, storeId: 'docker-exec' })` and the
`TerminalHostDeps` exactly as `apps/kira-studio/frontend/src/workbench/terminalModule.ts` does.

`src/queries.ts` (TanStack Query) — keys `['docker', 'status']`, `['docker', ctxName, 'containers']`,
`…'images'`, `…'volumes'`, `…'networks'`, `…'container', id`, `…'inspect', kind, id`.
`useDockerStatus()` (`refetchInterval: s => s.state.data?.state === 'ok' ? false : 5000`),
`useContainers()`, `useImages()`, `useVolumes()`, `useNetworks()` (all `enabled` only while status
ok), `useContainerDetail(id)`, `useInspect(kind, id)`, `useContainerAction()` (`useMutation`,
invalidates containers on settle; per-row busy state), `useDockerLiveSync()` — while mounted and
visible: `watch()`, `onChanged` → invalidate the matching kinds, `onStatus` → `setQueryData` status;
hidden/unmount → `unwatch()`.

Pinia stores (one concern each):
- `state/dockerUi.ts` `useDockerUiStore` — `section` (`containers|images|volumes|networks`),
  `selection {kind, id} | null`, `detailTab` (`overview|logs|terminal|stats|inspect`), `search`,
  `showStopped` (default true), collapsed Compose groups.
- `state/dockerStats.ts` `useDockerStatsStore` — latest sample per id + 60-sample ring per id;
  `useStatsSubscription(ids: Ref<string[]>)` composable (debounced 300 ms resubscribe, visibility gated).
- `state/dockerExec.ts` `useDockerExecSessionsStore` — sessions per container
  `{ id, containerId, title, n }`, `open(containerId)` (sets `execContainers`, id `docker-exec:<uuid>`),
  `close(id)` (`closeTerminalSession` + `cleanupTabRuntime`), `closeForContainer(id)`.
- Logs buffer is component state in `LogsView.vue` (`shallowRef` array, 20 000-line cap, drop
  oldest), not a store: nothing else reads it.

Components (`src/components/`), Tailwind utilities only, shadcn-vue primitives from `@theme`,
`TooltipIconButton`, `CodiconIcon`, workbench `ContextMenu` store for right-click menus:
- `DockerPanel.vue` — left panel. Header bar (`h-bar`, same markup as `TerminalPanel.vue`'s):
  "Docker", `EndpointChip.vue` (context name, status dot, insecure warning; `DropdownMenu` listing
  `contexts()` + "Automatic"), search toggle (`usePanelHeaderSearch`), refresh. Section switch:
  four `tabChipVariants` chips with counts. Body by section: `ContainerList.vue`, `ImageList.vue`,
  `VolumeList.vue`, `NetworkList.vue`, each virtualized via `useVirtualRows`. When unavailable: the
  list area shows a compact "Docker unavailable" line; the main view carries the full state.
- `ContainerList.vue` — groups by `composeProject` (collapsible header, `TreeTwisty`, group
  running count, group start/stop), ungrouped last. Row: status dot (running `text-success`,
  paused/restarting `text-warning`, exited `text-subtle`), name, image (muted), right side CPU%
  and memory for running rows (`formatBytes`), hover actions start/stop. "Show stopped" toggle in
  the section header. Context menu: Start, Stop, Restart, Logs, Open terminal, Copy ID, Copy name.
  Click selects (`selection`), double-click opens Logs.
- `DockerView.vue` — main area. Status not ok → `UnavailableState.vue`. No selection →
  `EngineOverview.vue` (engine version, OS/arch, CPUs, memory, counts, summed CPU/RAM of running
  containers). Container selected → `ContainerDetail.vue`; image/volume/network →
  `ResourceDetail.vue`.
- `UnavailableState.vue` — `Empty` (`@theme/components/ui/empty`): reason title
  (`not-installed`: "Docker isn't installed"; `daemon-down`: "Docker isn't running"; others by
  reason), guidance line (start Docker Desktop / `colima start` / check `DOCKER_HOST`), endpoint in
  `font-data`, Retry (`status(refresh: true)`), context picker.
- `ContainerDetail.vue` — header: name, state `Badge`, image, short id (copy), published ports,
  Start/Stop/Restart buttons (busy-aware). Sub-tab chips (`tabChipVariants`): Overview, Logs,
  Terminal (disabled unless running), Stats (disabled unless running), Inspect. `v-show` is not
  used for Logs (stream only while mounted); Terminal panes stay mounted per session (xterm
  reattach handles remounts anyway).
- `ContainerOverview.vue` — key/value sections: Ports, Mounts, Networks, Env (masked, per-row
  reveal + copy), Labels, Command/Entrypoint, Restart policy, Health, Created/Started/Finished.
- `LogsView.vue` — toolbar: Follow toggle, Timestamps toggle (reopens stream), Tail `NativeSelect`
  (100/1 000/5 000/All), filter `InputGroup` (case-insensitive, highlights matches, count),
  Wrap toggle, Clear. Rows: `ts` column when on, stderr rows `text-error`, ANSI spans from
  `anser`. Follow auto-scrolls; user scroll-up pauses and shows "Jump to latest". Stream ended →
  inline footer ("Container stopped" / error text).
- `ExecView.vue` — session chips (`+ New session`, close ×), one `TerminalHostView` per session
  keyed by id; first visit auto-opens one session.
- `StatsView.vue` — CPU% and memory (used/limit, %) with 60 s `Sparkline.vue` (inline SVG
  polyline, token stroke; no chart library — a polyline is not infrastructure), plus net I/O,
  block I/O, PIDs.
- `InspectView.vue` — raw JSON, read-only Monaco through `packages/workbench/src/editor/monaco.ts`
  if it exposes a read-only model helper; else `<pre class="font-data">` with copy. Pick one, note it.
- `ResourceDetail.vue` — image (tags, id, size, created, used by), volume (driver, mountpoint,
  labels, used by), network (driver, scope, subnets, internal, attached containers); "used by"
  rows select the container; raw JSON section via `useInspect`.

`src/index.ts` exports: `DockerPanel`, `DockerView`, `createDockerContext`, `provideDocker`,
types. `src/testing/ui/dockerMock.ts` (§4).

## 3. Studio wiring (new files, Stream B-safe)

- `apps/kira-studio/internal/bridge/docker.go` — `type DockerService struct{ *docker.BoundService }`.
- `apps/kira-studio/frontend/src/docker/context.ts` — `studioDocker()`: lazy singleton
  `createDockerContext(DockerService /* @bindings/dockerservice.js */, { appearance: () => useSettingsStore().appearance })`.
- `apps/kira-studio/frontend/src/docker/DockerPanel.vue`, `DockerView.vue` — `provideDocker(studioDocker())`
  + render the package component (D5).

## 4. Seam: every edit to a file this stream does not own

All seam edits land in **one commit, last in the phase**: `feat(studio): register docker module`.
On landing, rebase Stream B after Stream A; if that commit conflicts, re-apply the lines below on
top of A's version. Nothing else in P200 touches A/C files.

Stream A-owned:
- **S1 `apps/kira-studio/main.go`** (3 places):
  - near line 385 (`terminalSvc := …` in `wireEmbeddedServices`) or directly before
    `application.New` (line 144): `dockerSvc := &bridge.DockerService{BoundService: docker.NewBoundService(deps.Events)}`;
    import `github.com/kirathecat/kira-studio/internal/docker`.
  - services list (after line 176 `CustomScriptsService`): `application.NewService(dockerSvc),`.
  - window opener deps (line 510-516 `shell.WindowOpenerDeps{…}`): add
    `OnWindowClosing: []func(string){func(k string) { docker.CloseWindowBound(dockerSvc.BoundService, k) }},`
    — `dockerSvc` reaches that function as one new field on the struct that already carries
    `terminalSvc` (line 479) and its constructor call; two extra lines.
- **S2 `apps/kira-studio/internal/storage/model/window.go:32`**: `Valid: []string{"studio", "api", "terminal", "docker"}`.
- **S3 `apps/kira-studio/frontend/src/workbench/modes.ts`**: `MODE_ORDER` += `'docker'` (last);
  `MODES.docker = { label: 'Docker', icon: 'vm', tabStrip: false, panel: defineAsyncComponent(() => import('../docker/DockerPanel.vue')), start: defineAsyncComponent(() => import('../docker/DockerView.vue')) }`.
- **S4 `apps/kira-studio/frontend/src/workbench/WorkbenchShell.vue`**: `:tab-strip-visible="MODES[modeStore.active].tabStrip !== false"` on `WorkbenchShellBase`.
- **S5 `apps/kira-studio/tests/ui/terminal-module.spec.ts:49`**: `toHaveCount(3)` → `toHaveCount(4)`.
- **S6 visual baselines**: the title bar gains a fourth mode tab, so every Studio visual snapshot
  showing it changes (`tests/visual/*-snapshots`, A owns `terminal-module`). Regenerate only after
  the rebase onto A, in a separate `test(visual): …` commit, inspecting each diff is the title bar alone.

Unowned shared files (claimed by P200; no stream lists them):
- **S7 `packages/workbench/src/state/createTerminalsStore.ts`**: `TerminalsStoreOptions.storeId?: string`; `defineStore(options.storeId ?? 'terminals', …)`.
- **S8 `packages/workbench/src/modes.ts`**: `PanelModeDef.tabStrip?: false` with a one-line doc.
- **S9 `internal/shell/openwindow.go`**: `WindowOpenerDeps.OnWindowClosing []func(key string)`, looped after `d.Terminal.CloseWindow(rec.Key)` (line 105). Space passes none.
- **S10 `packages/shared/domain/mode.ts`**: `AppMode` += `'docker'`.
- **S11 `packages/workbench/src/workbench.css`**: `@source "../../docker-ui/src";` (Tailwind only scans via this root; see the file's own header).
- **S12 root `package.json`**: `workspaces` += `packages/docker-ui`; new `typecheck:docker` (`vue-tsc --noEmit -p packages/docker-ui/tsconfig.json`) added to the `typecheck` composite. `bun.lock` regenerated (`bun install`); on rebase conflict, take theirs and rerun `bun install`.
- **S13 `apps/kira-studio/frontend/package.json`**: dependency `"@kira/docker-ui": "workspace:*"`.
- **S14 `knip.json`**: `packages/docker-ui` workspace block (`entry: ["src/testing/**/*.ts"]`, `project: ["src/**/*.{ts,vue}"]`).
- **S15 `biome.json`**: override for `packages/docker-ui/**` with `noRestrictedImports` forbidding `**/apps/**` and `@kira/api-core` (git-ui rule's shape).
- **S16 `scripts/check-tokens.sh`, `scripts/check-theme-classes.sh`**: add `packages/docker-ui/src` to the scanned sources.
- **S17 `apps/kira-studio/tests/ui/mode-switch.spec.ts:84`**: `toHaveCount(3)` → `toHaveCount(4)`; extend its per-mode loop if it enumerates modes.
- **S18 `go.mod`/`go.sum`**, **`NOTICES.md`** (docker/cli `NOTICE`, `anser` MIT).

## 5. Tests (CLAUDE.md bar)

Go unit tests, only the genuinely hard logic:
- `internal/docker/endpoint_test.go` — precedence table (selected > `DOCKER_HOST` > `DOCKER_CONTEXT`
  > `currentContext` > default > probe), TLS material from context dir and from `DOCKER_CERT_PATH`,
  `ssh://` routed to connhelper, missing/corrupt meta → clear error. Temp `HOME`/`DOCKER_CONFIG`.
- `internal/docker/stats_test.go` — `cpuPercent`/`memUsage` table (cgroup v1 vs v2, `online_cpus`
  0 fallback, zero/negative deltas); hub refcount/cancellation with a fake `statsSource`: two
  windows on one id → one stream; one unsubscribes → stream stays; `closeWindow` of the other →
  stream cancelled; `-race`.
- `internal/docker/logs_test.go` — `lineFramer`: line split across chunks, interleaved
  stdout/stderr partials, `\r\n`, 64 KiB truncation, timestamp split, flush at EOF.

Real engine (`internal/docker/engine_test.go`), `t.Skip` when `Ping` fails (container-gated
adapter tests' convention). Sandbox: `dockerd` starts as root per `docs/DEV_ENVIRONMENT.md`; image
`mirror.gcr.io/library/alpine:3.20` (Hub blobs blocked). Covers: status ok, list finds the test
container, stop/start, logs follow receives a line printed after open, exec writes `echo hi` and
reads it back with exit code 0, stats emit a sample with memLimit > 0, `closeWindow` ends every
stream for that window. Uses a recording `appevent.Emitter`. Runs once near phase end.

UI e2e (mocked bridge): `apps/kira-studio/tests/ui/docker-module.spec.ts` + reusable helper
`packages/docker-ui/src/testing/ui/dockerMock.ts`: `installDockerMocks(page, { bridgePkg, handlers })`
registers a `page.route` after `relaunch()`'s control mocks (Playwright runs later routes first),
answers `DockerService.*` FQNs, `route.fallback()` for everything else; events via
`emitWailsEvent` (`@workbench/testing/ui/mockRuntime`). No edit to A's `tests/ui/support/**`.
Cases: (1) daemon down → unavailable state, Retry calls `Status{refresh:true}`, switching to ok
renders lists; (2) Compose grouping, show-stopped toggle, search; (3) Stop on a row calls
`DockerService.Stop` and the row updates after a `kira:docker:changed` event + refetch;
(4) `kira:docker:stats` updates CPU/MEM text; switching mode away calls `StatsUnsubscribe` and
`Unwatch`; (5) Logs: `LogsOpen` args, lines appended from `kira:docker:logs`, filter narrows,
stderr row styled, Timestamps toggle reopens; (6) Terminal: `ExecOpen` called with container id,
`.xterm-rows` visible, typing calls `ExecWrite`, closing the chip calls `ExecClose`; (7) image /
volume / network sections render and "used by" selects the container; (8) the tab strip is hidden
in Docker mode. No dedicated frontend unit tests.

## 6. Order and commits

1. `feat(docker): engine endpoint resolution and client` — `endpoint.go`, `manager.go` (status,
   client), `channels.go`, `endpoint_test.go`, `go.mod`.
2. `feat(docker): resource lists, inspect and container actions` — `resources.go`.
3. `feat(docker): events watch and stats hub` — `events.go`, `stats.go`, `stats_test.go`.
4. `feat(docker): logs and exec streams` — `logs.go`, `exec.go`, `logs_test.go`.
5. `feat(docker): bound service and Studio bridge shim` — `bound.go`, `bridge/docker.go`, S9.
6. `feat(docker-ui): package scaffold, control, context, queries, stores` — package files, S7,
   S11-S16, `NOTICES.md`.
7. `feat(docker-ui): panel, resource lists, endpoint picker` .
8. `feat(docker-ui): container detail (overview, logs, terminal, stats, inspect)`.
9. `feat(docker-ui): engine overview, resource detail, unavailable states`.
10. `feat(studio): register docker module` — S1-S5, S8, S10, S17, Studio `src/docker/*` wrappers.
11. `test(docker): real-engine check and UI spec` — `engine_test.go`, `docker-module.spec.ts`, `dockerMock.ts`.
12. Fixes from the test run as follow-up commits. `docs: P200 notes`.
13. After the orchestrator rebases onto A: S6 visual baselines, `test(visual): fourth mode tab`.

Every commit passes the pre-commit hook (lint + typecheck) normally. Bindings are gitignored:
regenerate with `wails3 task common:generate:bindings` (Studio) before the first frontend
typecheck that imports `@bindings/dockerservice.js`.

## 7. Verification (orchestrator checks against this list, by command, not prose)

- `go build ./...`; `go vet ./internal/docker/...`; `bun run lint:go`.
- `go test -race ./internal/docker/... ./internal/shell/...` with `dockerd` running: engine test
  ran (not skipped: `-v` shows `--- PASS: TestEngine…`).
- `bun run lint`, `bun run typecheck` (includes `typecheck:docker`), `bun run lint:dead`.
- `bun run test:ui:studio -- docker-module mode-switch terminal-module`: pass.
- Grep proofs: `createTerminalsStore(` with `storeId: 'docker-exec'` in `packages/docker-ui`;
  `TerminalHostView` imported in `ExecView.vue`; `useQuery` in `queries.ts`; `anser` imported in
  `LogsView.vue` (or its helper); `connhelper.GetConnectionHelper` in `endpoint.go`;
  `ServiceShutdown` and `CloseWindowBound` defined in `internal/docker/bound.go`; no `apps/` import
  under `packages/docker-ui/src`.
- Seam audit: `git diff --stat 1521741..HEAD` lists no A/C-owned file outside §4's S1-S6.

## 8. Risks

- **Rebase onto A**: S1/S3/S4/S5 sit in files A edits (main.go for P188, terminal spec for
  P186/P187). Contained to commit 10 by design; conflicts are line-level.
- **Many stats streams**: one engine stream per running container. Fine for tens; hundreds cost
  goroutines and daemon CPU. Accepted; note in `P200-notes.md` if real-engine run shows otherwise.
- **macOS env**: Finder launch has no `DOCKER_HOST`; D9's context/probe order covers Desktop,
  Colima, OrbStack, Rancher. A user relying only on a shell-exported `DOCKER_HOST` sees the
  context/default endpoint instead — documented in the unavailable-state guidance.
- **WKWebView hidden windows**: visibility gating stops stats/logs/events there by design; exec
  sessions keep running server-side and replay into the xterm on return (drain queue).
- **`docker/cli` `+incompatible`**: no `go.mod`; MVS uses ours. If it drags a conflicting moby
  version, stop and record in notes rather than forcing a `replace`.
