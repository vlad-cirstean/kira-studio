# P252 plan: Docker disk usage on demand, origin icons in the left bar

Base: `v2.0` at `d9fd64010`. Planned against current tree (CodeGraph discovery, then source reads).
Runs before the code review. P250 (in flight, own worktree) must cover P252 afterwards through a
follow-up gaps item; this phase still ships its own flow test plus UI spec.

User ask:
1. Storage metrics in the Docker module, never autoloaded. Cache last result, Refresh button, result
   timestamp. Two scopes: (a) engine-wide (`/system/df`: images, containers, volumes, build cache,
   per-volume sizes); (b) one container (`SizeRw`/`SizeRootFs`), on demand only, cached for the
   running session only, never in the DB.
2. Left bar: a Compose project group shows as a plain folder-like row. Give it a Compose icon. Audit
   every folder-like grouping and pick icons from container labels where origin can be inferred.

## 1. Current state

- Go client: `github.com/moby/moby/client v0.5.1`, API types `v1.56.0` (`go.mod`).
  - `client.DiskUsage(ctx, DiskUsageOptions{Containers, Images, BuildCache, Volumes, Verbose})`
    sends `type=` filters and `verbose=1`; returns per-type `ActiveCount/TotalCount/Reclaimable/
    TotalSize`, and `Items` only with `Verbose`. Handles API < 1.52 through the legacy decoder.
  - Volume item size: `volume.Volume.UsageData.Size` (`-1` when not computed), `.RefCount`.
  - `ContainerInspectOptions{Size: true}` fills `SizeRw`/`SizeRootFs` (`*int64`).
    `ContainerListOptions.Size` exists too; not used (would size every container).
- `internal/docker`: `BoundService` (`bound.go`) forwards to `Manager` (`manager.go`,
  `resources.go`). `m.call(ctx, timeout, fn)` wraps client + `mapErr` (`E_NOT_FOUND`, `E_INVALID`,
  `E_DOCKER_UNAVAILABLE` with `reason`, else `E_INTERNAL`). `callTimeout = 15s`.
  `Container` wire type carries `composeProject`/`composeService` only, no labels.
- Studio only: `apps/kira-studio/internal/bridge/docker.go` embeds `*docker.BoundService`. Space does
  not host Docker.
- `packages/docker-ui`:
  - `queries.ts`: every resource query keys `['docker', scope, …]`, `scope = context|host`
    (`useScope`). Panel Refresh, overview Refresh, `useContainerAction.onSettled` and
    `useDockerLiveSync` all invalidate the whole `['docker']` prefix.
  - `ContainerList.vue`: the only grouping in the left bar. Group row = `TreeTwisty` + bold project
    name + running/total count + hover Start all/Stop all; no icon. Ungrouped container rows: state
    dot, name, image, ports. `ImageList`/`VolumeList`/`NetworkList` are flat (no groups).
  - Section tabs (Containers/Images/Volumes/Networks) already use codicons; not folders.
  - `EngineOverview.vue`: `DetailSection` cards (Status, CPU, Memory, Resources). `DetailSection`
    has an `actions` header slot.
  - `ContainerOverview.vue`: Details/Ports/Networks/Mounts/Environment/Labels cards.
  - `lib/format.ts`: `formatSize`, `formatPercent`. `UsageBar.vue` exists.
- Icons available, all open source, already root deps: `@vscode/codicons` (CodiconIcon, CC-BY-4.0
  glyphs, MIT code), `@lucide/vue` 1.47.0 (ISC), `simple-icons` 16.31.0 (CC0, credited in
  `NOTICES.md`, used by `EngineIcon.vue`). simple-icons has `docker`, `kubernetes`, `helm`,
  `podman`; no Docker Compose, kind, Swarm (its `swarm` is an unrelated project), devcontainer or
  Testcontainers mark. Lucide has `Boxes`, `Layers`, `Network`, `Hammer`.
- Tests: `apps/kira-studio/internal/flows/dockerflow` (flow tests, real engine via
  `flowharness.RequireDocker`, `flowharness.Complete` gate); `flows/coverage` name-matches every bound
  method against flow tests, `exempt.txt` empty. UI: `apps/kira-studio/tests/ui/docker-module.spec.ts`
  (hand-written fixtures, `installDockerMocks` from `@kira/docker-ui/testing/dockerMock`).
  Contract fixtures (P249): `app.Contract(t, scenario, key, got, opts…)` writes/compares
  `apps/kira-studio/tests/contract/<scenario>.json`; UI reads via `tests/ui/support/contract`.
  No docker contract file exists yet.

## 2. Design

### 2.1 Go: disk usage (new file `internal/docker/disk.go`)

Wire types:

```go
// DiskCategory is one /system/df bucket.
type DiskCategory struct {
	Count       int64 `json:"count"`
	Active      int64 `json:"active"`
	Size        int64 `json:"size"`
	Reclaimable int64 `json:"reclaimable"`
}

// VolumeDisk is one volume's measured size; Size is -1 when the engine did not compute it.
type VolumeDisk struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	RefCount int64  `json:"refCount"`
}

// DiskUsage is DiskUsage's wire shape.
type DiskUsage struct {
	TakenAt    string       `json:"takenAt"`    // RFC3339, server clock, end of measurement
	DurationMs int64        `json:"durationMs"`
	Total      int64        `json:"total"`      // sum of the four Size fields
	Images     DiskCategory `json:"images"`
	Containers DiskCategory `json:"containers"`
	Volumes    DiskCategory `json:"volumes"`
	BuildCache DiskCategory `json:"buildCache"`
	VolumeSizes []VolumeDisk `json:"volumeSizes"` // sorted by Size desc, then Name; never nil
}

// ContainerSize is ContainerSize's wire shape.
type ContainerSize struct {
	SizeRw     int64  `json:"sizeRw"`     // writable layer
	SizeRootFs int64  `json:"sizeRootFs"` // image layers + writable layer
	TakenAt    string `json:"takenAt"`
	DurationMs int64  `json:"durationMs"`
}
```

Manager:

- `const sizeTimeout = 2 * time.Minute` (df and size walks take seconds to minutes on big hosts).
- `m.diskUsage(ctx)`: one `m.call(ctx, sizeTimeout, …)`: `cli.DiskUsage` with all four types plus
  `Verbose: true` (needed for volume items); map categories; `VolumeSizes` from
  `Volumes.Items[].UsageData` (nil `UsageData` means `-1`); drop image/container/build-cache items
  (not shown; keeps payload small). `TakenAt = kiratime.FormatISO`-style RFC3339 of `time.Now()` at end
  (use the existing helper the repo uses for ISO timestamps; check `internal/kiratime`).
- `m.containerSize(ctx, id)`: `id == ""` gives `E_INVALID`. `cli.ContainerInspect(ctx, id,
  client.ContainerInspectOptions{Size: true})`, nil pointers become `0`. Unknown id maps to
  `E_NOT_FOUND` through `mapErr`.
- Dedupe concurrent identical requests (two windows, double click): `golang.org/x/sync/singleflight`
  (already a direct dep) on the Manager, keys `"df|"+ep.Host+"|"+ep.Context` and
  `"size|"+ep.Host+"|"+id`. The engine itself rejects a second concurrent df with a conflict on some
  versions; singleflight avoids surfacing that. Use `context.Background()`-derived ctx inside the
  shared call so one caller's cancel cannot fail the others (bound calls use Background today anyway).
- Engine-generic (user decision): local, Colima, Docker Desktop, OrbStack and remote engines all
  behave the same, since only Docker API data is used (`/system/df`, inspect `Size`).
- Out of scope, intentionally (user decision): host free/total disk. No `statfs`, no throwaway `df`
  container, no bind mounts, nothing touching the host or the engine host's filesystem. The UI
  shows "used by Docker" only.
- Bound (`bound.go`), two new methods:
  - `func (b *BoundService) DiskUsage() (DiskUsage, error)`
  - `func (b *BoundService) ContainerSize(args IDArgs) (ContainerSize, error)`
  No cache in Go: caching is the renderer's (TanStack), per user ask (container: session memory).

### 2.2 Go: container origin (`resources.go`)

Add to `Container`:

```go
Origin     string `json:"origin"`     // "" | compose | devcontainer | testcontainers | kind | kubernetes | swarm | buildx
OriginName string `json:"originName"` // cluster, namespace/pod, service, folder or builder; "" when none
```

`originOf(labels map[string]string, name string) (string, string)` in `resources.go`, first match wins:

| origin | rule | originName |
| --- | --- | --- |
| devcontainer | label `devcontainer.local_folder` set | that folder's base name |
| testcontainers | label `org.testcontainers` = `true` | `org.testcontainers.sessionId` if set, else "" |
| kind | label `io.x-k8s.kind.cluster` set | cluster name |
| kubernetes | label `io.kubernetes.pod.name` set | `<io.kubernetes.pod.namespace>/<pod>` |
| swarm | label `com.docker.swarm.service.name` set | service name |
| buildx | name has prefix `buildx_buildkit_` | name without prefix |
| compose | label `com.docker.compose.project` set | project |

Specific tools win over compose: a compose-based devcontainer is grouped under its compose project
(grouping unchanged) and its row shows the devcontainer glyph. Fill in `containerFromSummary` and
the `ContainerDetail.Container` built in `detailFromInspect` (same helper, so list and detail agree).
Label constants next to `labelComposeProject`.

### 2.3 Frontend: wire, control, queries (`packages/docker-ui/src`)

- `wire.ts`: `DockerDiskCategory`, `DockerVolumeDisk`, `DockerDiskUsage`,
  `DockerContainerSize` field-for-field; `DockerContainer.origin: ContainerOrigin` (string union
  `'' | 'compose' | 'devcontainer' | 'testcontainers' | 'kind' | 'kubernetes' | 'swarm' |
  'buildx'`) and `originName: string`.
- `control.ts`: `DockerBindings.DiskUsage(): Promise<unknown>`,
  `DockerBindings.ContainerSize(a: { id: string }): Promise<unknown>`; `DockerControl.diskUsage()`,
  `DockerControl.containerSize(id)` via `unwrap` + `trust`.
- `queries.ts`. Keys live outside the `['docker']` prefix on purpose, so no existing invalidation
  (panel Refresh, overview Refresh, container actions, live sync) ever triggers a df or size walk:
  - `DISK_KEY = ['docker-disk'] as const`.
  - `useEngineDiskUsage()`: `useQuery({ queryKey: ['docker-disk', scope, 'engine'], queryFn:
    control.diskUsage, enabled: false, staleTime: Infinity, gcTime: Infinity, retry: false,
    initialData: () => stored.value[scope], initialDataUpdatedAt: () => Date.parse(takenAt) })`.
    `stored = useLocalStorage<Record<string, DockerDiskUsage>>('kira.docker.diskUsage', {})`
    (VueUse; D1 default persists engine-wide last result per scope); on success write
    `stored.value[scope] = data` (watch on `data`). Returns `{ query, refresh: () => query.refetch() }`.
  - `useContainerSize(id: MaybeRefOrGetter<string>)`: `queryKey: ['docker-disk', scope,
    'container', id]`, same `enabled: false`, `staleTime/gcTime: Infinity`, `retry: false`, no
    persistence (session memory only, per ask). Switching containers and back serves the cache.
  - `enabled: false` plus manual `refetch()` is TanStack's documented lazy-query pattern; there is no
    background refetch on focus/mount/reconnect.
  - Scope change (engine context switch) yields a new key: old engine's numbers never show.

### 2.4 Frontend: UI

- `components/EngineDiskSection.vue` (new), placed in `EngineOverview.vue` as a full-width
  `DetailSection title="Disk"` after the four-card grid. Header `actions` slot: timestamp text
  (`useTimeAgo` from VueUse, `title` = local absolute time, `data-testid="docker-disk-taken"`) and a
  `TooltipIconButton icon="refresh" label="Measure disk usage"` (`data-testid="docker-disk-refresh"`),
  showing `loading` + `codicon-modifier-spin` and disabled while fetching.
  States:
  - never measured: muted line "Not measured. Measuring scans the engine's storage and can take a
    while." plus a secondary `Button` "Measure" (`data-testid="docker-disk-measure"`).
  - loading with no data: spinner line "Measuring…".
  - data: four rows (Images, Containers, Volumes, Build cache) in a `grid` table: size, `count`
    (`active` active), reclaimable; a Total row labelled "Used by Docker"
    (`data-testid="docker-disk-total"`). Volume sizes: top 10 by size (`data-testid="docker-disk-volume"`,
    `-1` renders "-"), then "N more" text when longer. Each row's measured `durationMs` is not shown.
  - error: inline `text-error` line with the ipcerr message (`data-testid="docker-disk-error"`);
    previous data stays visible below it.
  The overview's existing Refresh button keeps invalidating only `['docker']`: it never measures.
- `components/ContainerSizeSection.vue` (new), in `ContainerOverview.vue` as `DetailSection
  title="Size"` after Details. Same header pattern (`docker-size-taken`, `docker-size-refresh`), same
  states (`docker-size-measure`, `docker-size-error`). Data: "Writable layer" `sizeRw`, "Total
  (with image)" `sizeRootFs` (`data-testid="docker-size-rw"`, `docker-size-rootfs"`).
- Left bar (`ContainerList.vue`): new `components/OriginIcon.vue` (`origin`, `size` props), renders:
  - `compose`: lucide `Boxes` (D2) in `currentColor`.
  - `kubernetes`, `kind`: simple-icons `siKubernetes` path in brand hex (same 24-to-16 transform as
    `EngineIcon.vue`, no halo needed at muted size; keep halo if contrast fails in dark theme).
  - `swarm`: lucide `Network`. `buildx`: lucide `Hammer`. `devcontainer`: codicon `remote-explorer`.
    `testcontainers`: codicon `beaker`. `''`: nothing.
  - Wrapper `span` with `data-testid="docker-origin-icon"` `:data-origin="origin"` and a Tooltip
    (shadcn-vue) text: "Compose project", "Dev container (<name>)", "Testcontainers", "kind cluster
    <name>", "Kubernetes pod <ns/pod>", "Swarm service <name>", "Buildx builder <name>".
  - Group row: `OriginIcon origin="compose"` between twisty and name (`docker-group-icon`).
  - Container row: icon replaces nothing; sits after the name in column 2 only when
    `origin !== ''` and `!(origin === 'compose' && row.grouped)` (a compose member under its group
    needs no repeat). Grid template unchanged (icon inline inside the name cell, `shrink-0`).
  - Grouping logic, collapse state and counts unchanged (D3).
- No i18n (repo has none). No new CSS: Tailwind utilities only.

### 2.5 Docs

- `docs/ARCHITECTURE.md` Docker section: df/size are on demand only, keys outside `['docker']`,
  engine-wide last result in localStorage per scope, container size session memory only, no host
  free/total (out of scope by user decision), origin precedence.
- `NOTICES.md` simple-icons section: add Kubernetes to the list of marks used, if it enumerates
  marks.

## 3. Tests

Split at the IPC boundary (CLAUDE.md rule). No unit tests: nothing here meets the bar (`originOf` is
a flat first-match table).

### 3.1 Flow (`apps/kira-studio/internal/flows/dockerflow/disk_test.go`, new)

- `TestDiskUsage` (gated `flowharness.Complete(t)`: a df walks the whole engine and is slow on a
  busy host):
  - Volume `d.Volume("disk", nil)`; container mounting it runs
    `dd if=/dev/zero of=/data/f bs=1024 count=1024; dd if=/dev/zero of=/rw bs=1024 count=512; exec sleep 300`
    (use `d.RunWith` with a `HostConfig.Mounts` named-volume mount (type `volume`, never a bind), `StopTimeout` 1 as `shellBox`).
    Wait for the files (`testx.WaitUntil` on exec or logs "ready").
  - `app.W.Docker.DiskUsage()`: assert `takenAt` parses RFC3339, `durationMs >= 0`,
    `containers.count >= 1`, `containers.size >= 512 KiB`, `images.count >= 1`,
    `total == images.size+containers.size+volumes.size+buildCache.size`, the flow volume appears in
    `volumeSizes` with `size >= 1 MiB` (local driver) and `refCount >= 1`, `volumeSizes` sorted desc.
  - Contract: project the result to a stable value (only the flow volume in `volumeSizes`), then
    `app.Contract(t, "docker-disk", "DockerService.DiskUsage", got, Mask("count", "active", "size",
    "reclaimable", "total", "refCount", "durationMs"), Replace(volName, "kira-flow-disk"))`.
    Shape guard only; the UI spec overrides numbers.
- `TestContainerSize` (general suite, one container):
  - Same writer container (no volume). `ContainerSize(IDArgs{ID})`: `sizeRw >= 512 KiB`,
    `sizeRootFs >= sizeRw`, `takenAt` parses. Unknown id: error code `E_NOT_FOUND`; empty id:
    `E_INVALID` (assert via `ipcerr` `errors.As`).
  - Contract key `DockerService.ContainerSize` in `docker-disk.json`, `Mask("sizeRw", "sizeRootFs",
    "durationMs")`.
- `TestContainerOrigin` (general suite): `sleeper` per origin with its labels (devcontainer +
  compose labels together, testcontainers, kind, kubernetes, swarm, compose only) plus one named
  `buildx_buildkit_kiraflow…` via `d.RunWith` (name prefix is set by the harness:
  `kira-flow-<run>-<name>`, so add `flowharness.(*Docker).RunNamed(fullName, cfg, host, labels)` or
  an option to skip the prefix; harness still labels it for cleanup and sweep). Assert `origin`/
  `originName` per row from `Containers`, and `InspectContainer` returns the same origin for one.
  Contract key `DockerService.Containers#origins`: the filtered list projected to `{name, origin,
  originName, composeProject, composeService}` with the run prefix replaced
  (`Replace(prefix, "kira-flow-")`; expose the prefix via a new `(*Docker).Prefix()` helper).
- Coverage gate: `DiskUsage(` and `ContainerSize(` now have flow calls; `exempt.txt` stays empty.
- Regenerate: from `apps/kira-studio`,
  `KIRA_FLOW_COMPLETE=1 KIRA_FLOW_DOCKER=require KIRA_CONTRACT=write go test -p 2 ./internal/flows/dockerflow -run 'TestDiskUsage|TestContainerSize|TestContainerOrigin'`,
  then rerun without `KIRA_CONTRACT` with `-count=2`.

### 3.2 UI (`apps/kira-studio/tests/ui/docker-disk.spec.ts`, new; own file so P250's edits to
`docker-module.spec.ts` do not collide)

Own small `setup` with `installDockerMocks` (status ok, two containers, one volume) and
`contract('docker-disk', …)` answers with numbers overridden (spread the contract object, set
concrete sizes).

- `contract: engine disk usage is measured only on demand and persists its last result`:
  open Docker, overview visible, `docker.calls('DiskUsage')` is 0; panel Refresh and overview
  Refresh still 0; click Measure: one call, Total and categories show `formatSize` values, volume row
  shows, timestamp text present; reload app (`relaunch` same storage): result shows
  with timestamp and still 0 new calls; refresh icon: one more call. Error variant: handler returns
  `{ error: { code: 'E_INTERNAL', message: 'df failed' } }`: error line shows, prior data kept.
- `contract: container size is measured on demand and cached for the session`: open container A,
  Size card shows Measure, 0 calls; Measure: one `ContainerSize` call with `{ id: A }`, values show;
  open B then A: still one call; refresh icon: two calls; `relaunch`: Measure again (not persisted).
- `contract: left-bar origin icons`: containers from `contract('docker-disk',
  'DockerService.Containers#origins')` merged into the mock list: group row has
  `docker-group-icon[data-origin="compose"]`; each non-compose row has its
  `docker-origin-icon[data-origin=…]`; a grouped compose member has none; a devcontainer member of a
  compose project shows `devcontainer`.
- Existing `docker-module.spec.ts` fixture factory: add `origin: ''`, `originName: ''` (and
  `'compose'`/project for compose fixtures) so its `DockerContainer` typing still holds. Only that
  edit in that file.
- Visual spec: none (no cheap stable target worth a baseline).

### 3.3 Checks

`bun run typecheck`, lint, `go build ./...`, `go vet`, the coverage gate, `dockerflow` general and
complete, the UI spec file plus `docker-module.spec.ts` once at phase end.

## 4. Files

Go: `internal/docker/disk.go` (new), `internal/docker/bound.go`, `internal/docker/manager.go`
(singleflight field), `internal/docker/resources.go` (origin), `apps/kira-studio/internal/flowharness/docker.go`
(`Prefix`, unprefixed run), `apps/kira-studio/internal/flows/dockerflow/disk_test.go` (new),
`apps/kira-studio/internal/flows/dockerflow/origin_test.go` (new),
`apps/kira-studio/tests/contract/docker-disk.json` (generated).

Frontend: `packages/docker-ui/src/wire.ts`, `control.ts`, `queries.ts`,
`components/EngineOverview.vue`, `components/ContainerOverview.vue`, `components/ContainerList.vue`,
`components/EngineDiskSection.vue` (new), `components/ContainerSizeSection.vue` (new),
`components/OriginIcon.vue` (new); `apps/kira-studio/tests/ui/docker-disk.spec.ts` (new),
`apps/kira-studio/tests/ui/docker-module.spec.ts` (fixture fields only). Wails bindings regenerate
at build (not committed).

Docs: `docs/ARCHITECTURE.md`, `NOTICES.md` (if it lists marks), `docs/v2.2/SPEC.md` result line.

## 5. Implementation

One sequential Sonnet implementer. No stream split: Go wire types feed the TS mirror, the contract
file and every spec; `ContainerList.vue` and `queries.ts` are touched by both halves.

Commit order (each passes the pre-commit hook):
1. `feat(docker): on-demand disk usage and container size bound methods` (Go 2.1 + flow tests +
   contract file).
2. `feat(docker): infer container origin from labels` (Go 2.2 + origin flow test + contract key).
3. `feat(docker-ui): measure disk usage and container size on demand` (2.3, 2.4 disk/size parts,
   UI spec parts).
4. `feat(docker-ui): origin icons in the container list` (OriginIcon, ContainerList, spec part,
   docker-module fixture fields).
5. `docs: P252 docker disk usage and origin icons` (ARCHITECTURE, NOTICES, SPEC result).

## 6. Deferred decisions (defaults taken)

- D1 Engine-wide cache: persisted per scope in renderer `localStorage` (VueUse `useLocalStorage`,
  key `kira.docker.diskUsage`), shown with its timestamp after relaunch. Not in the DB. Alternative:
  session memory only (drop the storage line; container size already works that way).
- D2 Compose icon: lucide `Boxes` (no allowed library ships a Compose mark; the Docker whale would
  read as "Docker", not "Compose project"). Kubernetes/kind use simple-icons Kubernetes; swarm lucide
  `Network`; buildx lucide `Hammer`; devcontainer codicon `remote-explorer`; testcontainers codicon
  `beaker`.
- D3 Grouping unchanged: only Compose projects group. Not added: kind cluster groups, Swarm stack
  groups (`com.docker.stack.namespace`), Testcontainers session groups. Icons only on rows.
- D4 Origin precedence: devcontainer > testcontainers > kind > kubernetes > swarm > buildx > compose.
- D5 Volume list: engine-wide card shows top 10 volumes by size; `VolumeList` rows do not show sizes.
- D6 `TestDiskUsage` runs in the complete suite only; `TestContainerSize` and `TestContainerOrigin`
  in the general suite.
