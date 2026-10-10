# P253 plan: Docker container edit (in place vs recreate)

Base: `v2.0` at `8c0a9908d` (P252 landed). Planned against current tree: CodeGraph discovery, then
source reads of files the index flagged stale (`resources.go`, `manager.go`, `queries.ts`,
`control.ts`, `flowharness/docker.go`), plus the vendored moby client `v0.5.1` / API types `v1.56.0`.

User ask (SPEC row): edit a container, running or stopped, in two sections so the user sees what
applies in place and what needs recreate.
1. Applied in place (`ContainerUpdate`, `ContainerRename`, network connect/disconnect): CPU shares,
   quota, cpuset; memory, swap, reservation; blkio weight; pids limit; restart policy; name; extra
   network attach/detach with aliases.
2. Requires recreate (ports, env, mounts, image, cmd/entrypoint, labels, user, hostname, caps):
   applied by recreating (inspect, create with new config, remove old) behind a confirmation that
   lists what is lost (anonymous volumes, writable layer).
Engine-generic, Docker API only, nothing touching the host.

## 1. Current state

- `internal/docker`: `BoundService` (`bound.go`) forwards to `Manager`. `m.call(ctx, timeout, fn)`
  wraps client + `mapErr`: `cerrdefs.IsNotFound` gives `E_NOT_FOUND`, `IsInvalidArgument` gives
  `E_INVALID`, connection failures `E_DOCKER_UNAVAILABLE`, else `E_INTERNAL`. No conflict or
  forbidden mapping. `actionTimeout = 60s`, `callTimeout = 15s`. `Manager` already has a
  `singleflight.Group`.
- `ContainerDetail` (inspect view) lacks resources, port bindings, caps, hostname, network mode,
  binds: not enough to drive an editor.
- Moby client facts (read from module source):
  - `ContainerUpdate(ctx, id, ContainerUpdateOptions{Resources *container.Resources, RestartPolicy
    *container.RestartPolicy})` returns `Warnings []string`.
  - `container.Resources`: `CPUShares`, `NanoCPUs`, `CPUQuota`, `CPUPeriod`, `CpusetCpus`,
    `CpusetMems`, `Memory`, `MemorySwap` (`-1` unlimited), `MemoryReservation`, `BlkioWeight
    uint16`, `PidsLimit *int64` (nil unchanged, `0`/`-1` unlimited), plus fields not exposed here.
  - `ContainerRename(ctx, id, {NewName})` rejects blank client-side.
  - `NetworkConnect(ctx, net, {Container, EndpointConfig *network.EndpointSettings})`,
    `NetworkDisconnect(ctx, net, {Container, Force})`. No endpoint update call exists: changing a
    network's aliases means disconnect plus connect.
  - `ContainerCreate(ctx, {Config, HostConfig, NetworkingConfig, Platform, Name})`.
- Engine rules (daemon behaviour the plan must surface, not hide):
  - Update treats zero as "unchanged" for `CPUShares`, `NanoCPUs`, `CPUQuota`, `CPUPeriod`,
    `CpusetCpus`, `CpusetMems`, `Memory`, `MemoryReservation`, `MemorySwap`, `BlkioWeight`. A set
    limit cannot be removed in place; only `PidsLimit` (`-1`) and `MemorySwap` (`-1`) can go
    unlimited.
  - Raising `Memory` above the current `MemorySwap` without also setting swap fails (conflict:
    "update the memoryswap at the same time"). `MemorySwap` must be `>= Memory` or `-1`.
    `MemoryReservation` must be `<= Memory`. Memory minimum 6 MiB.
  - `NanoCPUs` conflicts with `CPUQuota`/`CPUPeriod` (cannot set both, cannot switch in place).
  - Restart policy update works on stopped containers; fails with conflict when the container has
    `AutoRemove`. `MaximumRetryCount` only with `on-failure` (`container.ValidateRestartPolicy`).
  - cgroup v2 without swap accounting or BFQ (Docker Desktop, OrbStack, Colima, rootless): swap and
    blkio weight come back as `Warnings` and are discarded, not as errors.
  - cpuset outside the engine VM's CPUs (Docker Desktop, Colima) fails `InvalidParameter`
    ("Requested CPUs are not available").
  - Rename to a taken name fails with conflict. Connect to host/none/`container:` mode or to an
    already-attached network fails forbidden. Aliases on the default `bridge` network fail invalid.
  - Inspect `Config` already merges image defaults (env, cmd, entrypoint, labels, volumes, exposed
    ports, workdir, user, healthcheck). `Config.Hostname` is the old short ID when not set by the
    user. `HostConfig.Links` comes back as `/target:/self/alias`.
- Streams: `statsHub.run` ends a stream when its container goes away; the renderer resubscribes
  from the refetched container list (`useStatsSubscription`). Exec sessions are hijacked
  connections; stopping the container ends them with an exit event. Engine `rename`, `update`,
  `connect`, `disconnect`, `create`, `destroy` events are not in `noisyAction`, so
  `useDockerLiveSync` refetches container/network queries already.
- `packages/docker-ui`: `ContainerDetail.vue` tabs Overview/Logs/Terminal/Stats/Inspect
  (`DockerDetailTab` in `state/dockerUi.ts`); `useContainerAction` busy set disables Start/Stop;
  `invalidateKinds` maps engine kinds to query key segment `[2]`. `dockerExec.ts` has
  `closeForContainer`. `DetailSection` has an `actions` header slot. P252 patterns: `OriginIcon`,
  `TooltipIconButton`, inline `text-error` lines, query keys scoped by `useScope`.
- Theme primitives (`packages/theme/src/components/ui`): alert, badge (`ok|warn|err|info|default`),
  button, dialog, input, native-select, switch, tooltip, field, label, textarea. Workbench
  `ConfirmDialog` takes a plain message only: too thin for a "what is lost" list.
- Tests: `flows/dockerflow` (`boot`, `sleeper`, `shellBox`, `writer` helpers; `flowharness.Docker`
  `RunWith`/`Volume`/`Network`/`Tag`, cleanup by container ID), `flows/coverage` gate,
  `app.Contract` fixtures (`KIRA_CONTRACT=write`), UI specs with `installDockerMocks` (arbitrary
  handler map: no mock-file change needed for new methods).

## 2. Design: Go (`internal/docker`)

### 2.1 Wire types (new `edit.go`)

```go
// Resources is the in-place editable limit set. Zero means "no limit" except where noted.
type Resources struct {
	CPUShares         int64  `json:"cpuShares"`
	NanoCPUs          int64  `json:"nanoCpus"`
	CPUQuota          int64  `json:"cpuQuota"`
	CPUPeriod         int64  `json:"cpuPeriod"`
	CpusetCpus        string `json:"cpusetCpus"`
	CpusetMems        string `json:"cpusetMems"`
	Memory            int64  `json:"memory"`
	MemorySwap        int64  `json:"memorySwap"` // -1 unlimited, 0 engine default (2x memory)
	MemoryReservation int64  `json:"memoryReservation"`
	BlkioWeight       int    `json:"blkioWeight"`
	PidsLimit         int64  `json:"pidsLimit"` // 0 unlimited
}

type RestartPolicy struct {
	Name       string `json:"name"` // no | always | on-failure | unless-stopped
	MaxRetries int    `json:"maxRetries"`
}

type EditNetwork struct {
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"` // user aliases only; short-ID alias filtered out
	IPv4    string   `json:"ipv4"`    // static IPAM address, preserved, read-only in the UI
	IPv6    string   `json:"ipv6"`
}

type InPlaceSpec struct {
	Name      string        `json:"name"`
	Resources Resources     `json:"resources"`
	Restart   RestartPolicy `json:"restart"`
	Networks  []EditNetwork `json:"networks"` // sorted by name
}

type PortBinding struct {
	ContainerPort int    `json:"containerPort"`
	Proto         string `json:"proto"` // tcp | udp | sctp
	HostIP        string `json:"hostIp"`
	HostPort      string `json:"hostPort"` // "" = engine-assigned
}

type EditMount struct {
	Key      string `json:"key"`  // stable id of an existing mount, "" for a new row
	Type     string `json:"type"` // bind | volume
	Source   string `json:"source"`
	Target   string `json:"target"`
	ReadOnly bool   `json:"readOnly"`
}

type RecreateSpec struct {
	Image      string            `json:"image"`
	Cmd        []string          `json:"cmd"`
	Entrypoint []string          `json:"entrypoint"`
	Env        []string          `json:"env"`
	Labels     map[string]string `json:"labels"`
	User       string            `json:"user"`
	Hostname   string            `json:"hostname"` // "" = engine default (short ID)
	Ports      []PortBinding     `json:"ports"`
	Mounts     []EditMount       `json:"mounts"` // bind and named-volume mounts only
	CapAdd     []string          `json:"capAdd"`
	CapDrop    []string          `json:"capDrop"`
}

type AnonVolume struct {
	Name        string `json:"name"`
	Destination string `json:"destination"`
}

// EditSpec is ContainerEditSpec's wire shape: the current editable config plus what the UI needs
// for notices and the recreate confirmation.
type EditSpec struct {
	ID               string       `json:"id"`
	State            string       `json:"state"`
	BaseHash         string       `json:"baseHash"` // sha256 of the canonical JSON of InPlace+Recreate
	InPlace          InPlaceSpec  `json:"inPlace"`
	Recreate         RecreateSpec `json:"recreate"`
	NetworkMode      string       `json:"networkMode"`  // bridge | host | none | container:<id> | <network>
	Managed          string       `json:"managed"`      // "" | swarm | kubernetes: editor read-only
	AutoRemove       bool         `json:"autoRemove"`   // recreate refused
	Origin           string       `json:"origin"`       // P252 originOf
	OriginName       string       `json:"originName"`
	AnonymousVolumes []AnonVolume `json:"anonymousVolumes"`
	Dependents       []string     `json:"dependents"`   // container names using network_mode container:<this>
	Preserved        []string     `json:"preserved"`    // non-editable settings kept on recreate, as short labels
}

type UpdateArgs struct {
	ID       string      `json:"id"`
	BaseHash string      `json:"baseHash"`
	Spec     InPlaceSpec `json:"spec"`
}

type UpdateResult struct {
	Applied  []string `json:"applied"`  // step labels in order: "rename", "resources", "restart", "network:<n>"
	Warnings []string `json:"warnings"` // engine warnings, verbatim
}

type RecreateArgs struct {
	ID       string       `json:"id"`
	BaseHash string       `json:"baseHash"`
	InPlace  InPlaceSpec  `json:"inPlace"`
	Recreate RecreateSpec `json:"recreate"`
}

type RecreateResult struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	OldID    string   `json:"oldId"`
	Warnings []string `json:"warnings"`
}
```

All slices/maps non-nil on the wire (same rule as `detailFromInspect`).

### 2.2 Building the spec (`edit.go`)

`m.editSpec(ctx, id)`: one `m.call(callTimeout)`: `ContainerInspect`, then `ContainerList(All)`
for `Dependents` (summaries whose `HostConfig.NetworkMode` is `container:<id>` or
`container:<name>`). `specFromInspect(r container.InspectResponse) EditSpec` (pure, no client):

- Resources: copy from `HostConfig.Resources`; `PidsLimit` nil or `<= 0` becomes `0`.
- Restart: `HostConfig.RestartPolicy`.
- Networks: from `NetworkSettings.Networks`, sorted; aliases minus `ID[:12]` and minus the
  container name; `IPAMConfig` addresses into `IPv4`/`IPv6`.
- Ports: `HostConfig.PortBindings` (configured bindings, not the live `NetworkSettings.Ports`),
  sorted by port then proto then host port.
- Mounts: each `HostConfig.Binds` entry and each `HostConfig.Mounts` entry of type bind or volume
  with a named source becomes a row with `Key` = `"bind:<index>"` or `"mount:<index>"`.
- Anonymous volumes: `r.Mounts` entries of type volume whose destination is not a target of any row
  above (image `VOLUME` or `-v /path` without a name).
- Hostname: `""` when it equals `ID[:12]`. Image: `Config.Image` (the reference the user ran).
- `Managed`: `swarm` when label `com.docker.swarm.task.id` is set; `kubernetes` when
  `io.kubernetes.pod.name` is set. Both make the editor read-only (the orchestrator replaces the
  container; edits fight it). kind node containers are not managed (they are the cluster).
- `Preserved`: labels for kept but non-editable settings present on the container (`privileged`,
  `tmpfs <paths>`, `devices (N)`, `volumes-from`, `log driver <d>`, `healthcheck`, `links`,
  `network mode <m>`, `workdir <w>`, `stop signal`, `init`, `ulimits`, `sysctls`, `dns`,
  `extra hosts`). Display only.
- `BaseHash`: `sha256` hex of `json.Marshal(struct{InPlace; Recreate})` of the spec (Go map key
  order is sorted by `encoding/json`, so canonical).

### 2.3 Validation (`edit.go`, `validateInPlace`, `validateRecreate`)

Pre-engine checks give `E_INVALID` with a field path in `Details` (`{"field":"resources.memory"}`)
so the UI pins the message on the field:

- name: Docker name pattern `^[a-zA-Z0-9][a-zA-Z0-9_.-]+$`.
- memory `0` or `>= 6 MiB`; reservation `<= memory` when memory set; swap `-1`, `0`, or
  `>= memory`; `cpuShares` `0` or `>= 2`; `blkioWeight` `0` or `10..1000`; `nanoCpus` and
  `cpuQuota` not both set; `cpuPeriod` `0` or `1000..1000000`; cpuset syntax
  `^\d+(-\d+)?(,\d+(-\d+)?)*$` or empty; pids `>= 0`.
- restart: `container.ValidateRestartPolicy`.
- networks: names unique; aliases not allowed on `bridge`/`host`/`none`; network section rejected
  when `NetworkMode` is `host`, `none` or `container:*` and the set changes.
- in place only: clearing a limit the engine treats as "unchanged" (cur `!= 0`, new `== 0` for the
  zero-means-unchanged fields in section 1) gives `E_INVALID` "removing this limit needs a
  recreate". Switching between `nanoCpus` and quota/period likewise.
- recreate: image non-empty and present locally (`ImageInspect`; missing gives `E_NOT_FOUND`
  "image not present locally; pull it first"); ports `1..65535`, proto valid, host port numeric or
  empty, no duplicate `(port, proto, hostIp, hostPort)`; mounts absolute target, unique targets,
  volume source non-empty; env entries `KEY=...` with non-empty key; cap names
  normalised by the client (`CAP_` prefix optional).
- `Managed != ""` refuses both apply calls (`E_INVALID`). `AutoRemove` refuses recreate
  (`E_INVALID`: stopping the old container would delete it, so rollback is impossible).

### 2.4 Apply in place (`edit_apply.go`, `m.updateContainer(args)`)

1. Per-container lock (2.6). Inspect; rebuild spec; `BaseHash` mismatch gives `E_CONFLICT`
   "container changed since the editor loaded; reload". Validate.
2. Diff current vs desired; send only what changed, in this order, stopping at the first failure:
   - rename (`ContainerRename`) when the name differs;
   - resources: one `ContainerUpdate` with a `Resources` holding only changed fields (others zero,
     which the engine treats as unchanged); `PidsLimit` pointer only when changed, `0` sent as
     `-1`; swap sent together with memory whenever memory changes and swap is set in the desired
     spec;
   - restart: in the same `ContainerUpdate` when changed;
   - networks: removed ones `NetworkDisconnect` (`Force: false`); added ones `NetworkConnect` with
     `EndpointSettings{Aliases, IPAMConfig}`; alias-only change is disconnect then connect, keeping
     `IPAMConfig`.
3. Timeout `actionTimeout` for the whole sequence. Result `Applied` lists completed steps;
   `Warnings` carries engine warnings verbatim.
4. Failure after some steps: the error message names the failed step and the `Details` carry
   `{"applied":[...],"step":"..."}`; nothing is rolled back (each step is independently valid). The
   UI refetches the spec, so the applied part shows as current and the rest stays pending.

### 2.5 Recreate (`edit_apply.go`, `m.recreateContainer(args)`)

Config build is pure: `buildRecreate(r container.InspectResponse, oldImage *image.InspectResponse,
in InPlaceSpec, rc RecreateSpec) (*container.Config, *container.HostConfig, primary string,
extra map[string]*network.EndpointSettings)`:

- Start from the inspected `Config` and `HostConfig` (everything not edited is preserved).
- `Config`: `Image`, `Cmd`, `Entrypoint`, `Env`, `Labels`, `User` from `rc`; `Hostname` from `rc`
  (empty when the user cleared it or it was the old short ID); `Domainname` kept only when the
  hostname was user-set. `ExposedPorts`: inspected set plus every bound port. When the image
  reference changed: drop from `Env`, `Labels`, `Cmd`, `Entrypoint`, `Volumes`, `ExposedPorts`,
  `WorkingDir`, `User`, `Healthcheck` each value equal to the old image's own default, so the new
  image's defaults apply (user overrides survive). Unchanged image: no subtraction.
- `HostConfig`: `Resources` and `RestartPolicy` from `in`; `PortBindings` from `rc.Ports`;
  `CapAdd`/`CapDrop` from `rc`; mounts: rows whose `Key` matches an existing entry and are
  unchanged keep the original `Binds` string or `Mounts` entry verbatim (keeps `:z`, propagation,
  volume options); changed and new rows become `mount.Mount` entries; deleted rows dropped.
  `Tmpfs`, `VolumesFrom`, devices, log config, `NetworkMode` kept. `ContainerIDFile` cleared.
  `Links` normalised from `/target:/self/alias` to `target:alias`.
- Networks: `primary` = `NetworkMode` when it is a network (default `bridge`), its endpoint goes in
  `NetworkingConfig` at create; every other desired network is connected after create (works on
  engines older than API 1.44, which reject several endpoints at create). Endpoint settings keep
  `IPAMConfig`, user aliases, `Links`, `DriverOpts`; drop runtime fields (IDs, addresses, MAC).
- Containers in `host`, `none` or `container:*` mode: no `NetworkingConfig`, no connects.

This builder carries several interacting rules (image-default subtraction, hostname, link and
mount normalisation): it earns one table-driven unit test, `internal/docker/edit_build_test.go`, the
only unit test in this phase.

Sequence (names: `<name>-kira-new-<6 hex>`, `<name>-kira-old-<6 hex>`), whole run under
`recreateTimeout = 3 * time.Minute`; rollback steps use a fresh `context.Background()` with
`actionTimeout` so a timeout never skips rollback:

| step | action | on failure |
| --- | --- | --- |
| 1 | lock; inspect; `BaseHash` check; validate; image inspect (new and old) | error; nothing changed |
| 2 | `ContainerCreate` new under temp name (stopped) | error; nothing changed |
| 3 | `NetworkConnect` new to each extra network | remove new; error |
| 4 | old running: `ContainerStop` (its own `StopTimeout`) | remove new; start old if it stopped; error |
| 5 | rename old to `-kira-old-` | remove new; start old if it ran; error |
| 6 | rename new to `<name>` | rename old back; remove new; start old if it ran; error |
| 7 | old was running: `ContainerStart` new | remove new (force); rename old back; start old; error |
| 8 | `ContainerRemove` old (`Force: false`, `RemoveVolumes: false`) | success plus warning naming the kept `-kira-old-` container |

- Stop-before-start is required: published ports and static IPs cannot be held by two running
  containers.
- A step 3 to 7 failure returns code `E_RECREATE_FAILED` with `Details`
  `{"step":"start","restored":true}`. A rollback step that itself fails gives `restored:false` and
  `{"containers":[{"id","name"}...]}` listing what now exists; the old container is never removed
  in that case.
- Anonymous volumes of the old container are not deleted (`RemoveVolumes: false`): they become
  dangling, recoverable, and the new container gets fresh ones. The confirmation says "detached,
  kept as unused volumes".
- Image never pulled (D3).
- Result: new ID, final name, old ID, warnings (create warnings plus step 8's).

### 2.6 Locking, errors, bound methods

- `Manager.editing sync.Map` (in `manager.go`): `LoadOrStore(id)`; held gives `E_CONFLICT`
  "another edit of this container is in progress". Released on return. Keyed by the ID the caller
  passed (the old ID during a recreate).
- `mapErr` (`resources.go`): add `cerrdefs.IsConflict` to `E_CONFLICT` and
  `cerrdefs.IsPermissionDenied` (HTTP 403 forbidden, e.g. connect to an attached network) to
  `E_INVALID`, both with the engine message verbatim. Applies module-wide; improves existing
  start/stop messages, changes no existing test expectation (check `engine_test.go`).
- `bound.go`, three methods:
  - `func (b *BoundService) ContainerEditSpec(args IDArgs) (EditSpec, error)`
  - `func (b *BoundService) UpdateContainer(args UpdateArgs) (UpdateResult, error)`
  - `func (b *BoundService) RecreateContainer(args RecreateArgs) (RecreateResult, error)`
- Streams: no Go change. Recreate of a running container ends its exec sessions and log follows
  through the stop (existing exit/ended events); stats streams for the old ID end in
  `statsHub.run`. Rename/update/network ops keep the ID, so nothing ends.
- Engine-generic: Docker Engine, Colima, Docker Desktop, OrbStack, remote, Podman's compat API all
  go through the same calls; engine rejections surface verbatim through `mapErr`. No host access.

## 3. Design: frontend (`packages/docker-ui/src`)

### 3.1 Wire, control, queries

- `wire.ts`: `DockerResources`, `DockerRestartPolicy`, `DockerEditNetwork`, `DockerInPlaceSpec`,
  `DockerPortBinding`, `DockerEditMount`, `DockerRecreateSpec`, `DockerAnonVolume`,
  `DockerEditSpec`, `DockerUpdateResult`, `DockerRecreateResult` field-for-field.
- `control.ts`: bindings `ContainerEditSpec(a: {id})`, `UpdateContainer(a)`,
  `RecreateContainer(a)`; control `editSpec(id)`, `updateContainer(args)`,
  `recreateContainer(args)` via `unwrap` + `trust`.
- `queries.ts`:
  - `useContainerEditSpec(id: Ref<string>)`: key `['docker', scope, 'edit-spec', id]`, enabled
    when ready and id set. `invalidateKinds`: add `'edit-spec'` to the container set and the
    network set (network connect/disconnect events change it).
  - `useUpdateContainer()`, `useRecreateContainer()`: TanStack `useMutation`; `onSettled`
    invalidates `['docker']` (same as `useContainerAction`).

### 3.2 Draft state: Pinia `state/dockerEdit.ts` (one concern: edit drafts)

- `drafts: Map<containerId, { base: DockerEditSpec; inPlace: DockerInPlaceSpec; recreate:
  DockerRecreateSpec }>`; `applying: Map<containerId, 'inPlace' | 'recreate'>`.
- `ensure(spec)`: creates a draft from the spec when none exists. When a draft exists and is clean,
  rebases onto the new spec. When dirty and `spec.baseHash !== draft.base.baseHash`, sets
  `stale` (banner, 3.3).
- `reset(id, section?)`, `discard(id)`, `rebaseInPlace(id, spec)` (after in-place apply: new base,
  recreate edits kept), `move(oldId, newId)` not needed (recreate success discards).
- Getters via `lib/editDiff.ts` (pure): `changes(base, draft): PendingChange[]` with `{ field,
  label, from, to, mode: 'now' | 'recreate' }`. Mode is the field's section, except clearing a
  zero-means-unchanged limit, or switching CPU mode, which is `recreate` (mirrors Go 2.3; badge
  flips to "recreates container"). `fieldErrors(spec, draft)` mirrors Go's 2.3 checks for inline
  messages; Go stays the authority.
- Draft survives tab switches and container switches (keyed by id) for the session; not persisted.

### 3.3 UI

- `ContainerDetail.vue`: new tab `{ id: 'edit', label: 'Edit', icon: 'edit', needsRunning: false }`;
  `DockerDetailTab` gains `'edit'`. Start/Stop/Restart disabled while `dockerEdit.applying` has the
  id. While a recreate is in flight, the not-found state is suppressed and a "Recreating…" overlay
  shows instead.
- `components/ContainerEditView.vue` (new): loads `useContainerEditSpec`, calls `ensure`.
  Layout top to bottom:
  - notices (shadcn `Alert`): compose ("Managed by Compose project <p>. Edits here are not written to
    the compose file; the next `docker compose up` may revert them." recreate adds "Compose will see
    a different container"), devcontainer, kind node, testcontainers (session reaper still owns it),
    managed swarm/kubernetes (read-only, Apply buttons hidden), `autoRemove` (recreate disabled),
    stale banner with Reload (discards draft) when `stale` or an apply returned `E_CONFLICT`.
    Origin glyph via P252 `OriginIcon`.
  - `DetailSection title="Applied in place"`: header actions = pending count `Badge`, Reset
    (`TooltipIconButton`), `Button` "Apply" (`docker-edit-apply-now`), disabled when no `now`
    change, any field error, or applying.
  - `DetailSection title="Requires recreate"`: same header, `Button` "Recreate…"
    (`docker-edit-apply-recreate`), opens the confirmation.
  - `EditPendingSummary.vue`: grouped list "Applies now" / "Recreates container", each line
    `label: from -> to` (`docker-edit-pending`, `data-mode`).
  - Inline `Alert` for the last apply's warnings (`docker-edit-warnings`) or error
    (`docker-edit-error`, message plus "original container restored" when `restored`).
- `components/EditField.vue` (new): label, mode `Badge` ("applies now" `info` / "recreates
  container" `warn`, `data-testid="docker-edit-badge"`, `data-mode`), changed dot, error text,
  default slot for the control. Every field in both sections uses it.
- `components/EditInPlaceSection.vue` (new): name (`Input`); CPU: "CPUs" (nanoCpus / 1e9, step
  0.1) when quota is unset, else quota + period inputs; shares; cpuset CPUs/mems with hint "engine
  has N CPUs" (`status.engine.cpus`); memory, reservation, swap as number + `NativeSelect` unit
  (MiB/GiB), swap with an "Unlimited" `Switch` (`-1`); blkio weight; pids limit; restart policy
  `NativeSelect` plus max retries for `on-failure`; networks: rows (network name, aliases
  comma-separated input, remove button), add row `NativeSelect` fed by `useNetworks()` minus
  attached ones; alias input disabled on `bridge`; whole block disabled for host/none/container
  modes; hint "Changing aliases briefly disconnects that network".
- `components/EditRecreateSection.vue` (new): image (`Input`), entrypoint and cmd (`Textarea`, one
  argument per line), env (rows `KEY` / value), labels (rows), user, hostname, ports (rows
  container port, proto select, host IP, host port), mounts (rows type select, source, target,
  read-only switch; volume source picker from `useVolumes()`), cap add / cap drop (rows),
  `Preserved` as a muted read-only list "Kept as is".
- `components/EditRows.vue` (new): generic add/remove row list used by env, labels, ports, mounts,
  caps, networks (slot per row).
- `components/RecreateConfirmDialog.vue` (new, shadcn `Dialog`): lists the pending changes; then
  "What is lost": writable layer ("files changed inside the container outside volumes"), anonymous
  volumes by name and destination ("detached, kept as unused volumes"), the old container's logs,
  container ID changes (open terminals and log views close); "What is kept": name, networks and
  aliases, named and bind mounts, preserved settings; running state ("stopped, then the new one
  starts" or "stays stopped"); dependents warning ("<names> share this container's network and
  lose it until restarted"); compose notice. Buttons Cancel / "Recreate container" (danger,
  `docker-edit-confirm`).
- After recreate success: `dockerExecSessions.closeForContainer(ctx, oldId)`,
  `dockerEdit.discard(oldId)`, `ui.select({ kind: 'container', id: newId }, 'edit')`, show
  warnings. After in-place success: `rebaseInPlace` with the refetched spec; warnings shown.
- Tailwind utilities only, no scoped styles; `<script setup lang="ts">` throughout; VueUse
  `useDebounceFn` not needed (no live validation calls to Go).

### 3.4 Docs

- `docs/ARCHITECTURE.md` Docker section: in place vs recreate split and the engine's
  zero-means-unchanged rule; recreate sequence and rollback; anonymous volumes detached not deleted;
  no image pull; swarm/kubernetes read-only; `BaseHash` conflict check; per-container edit lock;
  `mapErr` conflict/forbidden mapping.
- `docs/v2.2/SPEC.md`: P253 status and result line.

## 4. Tests (split at the IPC boundary)

### 4.1 Flow: `apps/kira-studio/internal/flows/dockerflow/edit_test.go` (new)

Own helpers in this file (not `helpers_test.go`, which P250 may touch). Every recreated container
registers its own `t.Cleanup` force-remove by new ID; the old anonymous volume is removed in cleanup
by name. Containers keep the `kira.flowtest` label through recreate, so the crash sweep still
finds them.

General suite:
- `TestContainerEditSpec`: `RunWith` a container with memory 64 MiB, swap 128 MiB, restart
  `on-failure:3`, named volume mount (`d.Volume`), anonymous volume (`mount.Mount{Type: volume,
  Target: "/anon"}`), port binding `8080/tcp` to host port `""`, env `A=1`, label, explicit
  hostname, `CapAdd NET_ADMIN`, attached to `d.Network("edit")` with alias `svc`. Assert every
  field of `ContainerEditSpec`, anonymous volume listed, `baseHash` 64 hex, hostname kept, short-ID
  alias filtered. Contract `docker-edit` key `DockerService.ContainerEditSpec`
  (`Mask("id", "baseHash", "name" in anonymous volumes)`, `Replace(prefix, "kira-flow-")`).
- `TestUpdateContainerInPlace`: on that running container: rename, memory 96 MiB + swap 192 MiB,
  reservation 32 MiB, `nanoCpus` 0.5, cpu shares 512, pids 64, restart `unless-stopped`, alias
  change `svc` to `svc,api`, connect a second flow network. Assert `Applied` order, then verify via
  `d.Cli.ContainerInspect` (independent path): ID unchanged, still running, each `HostConfig`
  value, aliases on both networks. Contract keys `args:DockerService.UpdateContainer` and
  `DockerService.UpdateContainer` (warnings masked: engine-dependent).
- `TestUpdateContainerRejects`: stale `baseHash` gives `E_CONFLICT`; clearing memory gives
  `E_INVALID` with `details.field`; swap below memory `E_INVALID`; rename to an existing flow
  container's name gives `E_CONFLICT` (engine path); managed (label `io.kubernetes.pod.name`)
  `E_INVALID`. Assert via `errors.As` on `*ipcerr.Error`.
- `TestUpdateStoppedContainer`: stopped container; restart policy and memory update succeed; it
  stays stopped.

Complete suite (`flowharness.Complete(t)`: several container lifecycles, slower):
- `TestRecreateContainer`: running container writing `hello` to a named volume, anonymous volume,
  flow network with alias, port binding, open an exec session first (`ExecOpen`). Recreate with
  env `B=2`, a new label, port `8081`, cmd changed, image changed to `d.Tag("edit")`. Assert: new
  ID differs, same name, running, `Config.Image` is the tag, env/label/port present, network and
  alias kept, volume file readable by `ExecOpen` on the new container, old ID gone (`E_NOT_FOUND`
  from `InspectContainer`), old anonymous volume still exists and is unused, exec session on the
  old container got its exited event, no `-kira-` temp names left. Contract keys
  `args:DockerService.RecreateContainer`, `DockerService.RecreateContainer` (ids masked).
- `TestRecreateStoppedContainer`: stopped container recreate stays stopped, new ID, same name.
- `TestRecreateRollback`: running container; recreate with entrypoint `/nonexistent` (start fails
  at step 7). Assert `E_RECREATE_FAILED`, `details.restored == true`, original ID running under the
  original name, no temp-named container left. Contract key
  `DockerService.RecreateContainer#rollback` (the error object).
- `TestRecreateRefusals`: `AutoRemove` container and a concurrent second recreate of the same ID
  (start two goroutines; one gets `E_CONFLICT`).

Coverage gate: `ContainerEditSpec(`, `UpdateContainer(`, `RecreateContainer(` each have flow calls;
`exempt.txt` stays empty.

Regenerate: from `apps/kira-studio`,
`KIRA_FLOW_COMPLETE=1 KIRA_FLOW_DOCKER=require KIRA_CONTRACT=write go test -p 2 ./internal/flows/dockerflow -run 'TestContainerEditSpec|TestUpdateContainer|TestUpdateStopped|TestRecreate'`,
then rerun without `KIRA_CONTRACT` with `-count=2`.

### 4.2 Unit: `internal/docker/edit_build_test.go` (new)

Table over `buildRecreate` and `specFromInspect`: image-default subtraction on image change vs
none on same image; hostname equal to short ID dropped; links normalised; unchanged bind keeps its
`:z` string, changed bind becomes a `mount.Mount`; deleted mount dropped; anonymous volume
detection; short-ID alias filtering; extra networks split from primary; host mode gives no
endpoints.

### 4.3 UI: `apps/kira-studio/tests/ui/docker-edit.spec.ts` (new)

Own `setup` (copy the status/container factory shape from `docker-disk.spec.ts`; do not import
from or edit `docker-module.spec.ts`). Handlers answer from `contract('docker-edit', …)`.

- `contract: edit tab shows in-place and recreate sections with mode badges`: open container, Edit
  tab; both sections; every field's `docker-edit-badge` `data-mode` matches its section; no pending
  lines; both Apply buttons disabled.
- `contract: in-place apply sends the recorded args and keeps recreate edits`: make the same edits
  as `TestUpdateContainerInPlace`, plus one env edit; pending summary shows them under the right
  modes; Apply: one `UpdateContainer` call whose args equal `args:DockerService.UpdateContainer`
  (ignoring `id`/`baseHash`); handler returns the contract result; in-place pending clears, env edit
  stays pending.
- `clearing a memory limit moves it to recreate`: clear memory; badge `data-mode="recreate"`; the
  change lists under "Recreates container".
- `contract: recreate confirms losses, then selects the new container`: edits as
  `TestRecreateContainer`; Recreate…: dialog lists the anonymous volume name, writable layer,
  compose notice (fixture with compose project); Cancel: zero calls; confirm: one
  `RecreateContainer` call matching `args:DockerService.RecreateContainer`; detail header shows the
  new ID; Edit tab still open with no pending changes.
- `contract: failures`: `UpdateContainer` returns `E_CONFLICT`: stale banner, Reload discards the
  draft; `RecreateContainer` returns `DockerService.RecreateContainer#rollback`: error alert says
  the original was restored; selection unchanged.
- `managed container is read-only`: spec with `managed: 'kubernetes'`: notice, inputs disabled,
  Apply buttons absent.

## 5. Files owned (zero overlap check)

Go: `internal/docker/edit.go` (new), `internal/docker/edit_apply.go` (new),
`internal/docker/edit_build_test.go` (new), `internal/docker/bound.go`,
`internal/docker/manager.go` (`editing` field), `internal/docker/resources.go` (`mapErr` only),
`apps/kira-studio/internal/flows/dockerflow/edit_test.go` (new),
`apps/kira-studio/tests/contract/docker-edit.json` (generated).

Frontend: `packages/docker-ui/src/wire.ts`, `control.ts`, `queries.ts`, `state/dockerUi.ts`
(`'edit'` tab), `state/dockerEdit.ts` (new), `lib/editDiff.ts` (new),
`components/ContainerDetail.vue`, `components/ContainerEditView.vue`, `EditField.vue`,
`EditInPlaceSection.vue`, `EditRecreateSection.vue`, `EditRows.vue`, `EditPendingSummary.vue`,
`RecreateConfirmDialog.vue` (all new); `apps/kira-studio/tests/ui/docker-edit.spec.ts` (new).
Bindings regenerate at build (not committed).

Docs: `docs/ARCHITECTURE.md` (Docker section), `docs/v2.2/SPEC.md` (P253 row and result).

Overlap:
- P250 (`/home/user/kira-sW`): its tree touches `flows/termflow`, `flows/apiflow`, automations and
  collections UI specs and contracts; its plan's docker item (T7) owns `dockerflow/streams_test.go`
  (and possibly `helpers_test.go`), `tests/ui/docker-module.spec.ts`, `contract/docker-exec.json`.
  P253 touches none of these: new `edit_test.go`, new `docker-edit.spec.ts`, new `docker-edit.json`,
  no `flowharness` change, no `dockerMock.ts` change. Shared only by append: `docs/v2.2/SPEC.md`
  and `docs/ARCHITECTURE.md` (different sections; rebase resolves trivially). P250 should cover
  P253 later through a follow-up gaps item, as with P252.
- P255 (`apps/kira-space` ADE workflow editor) and P256 (`packages/git-ui`): no shared file.
- P254 (automations editor, `packages/workbench` automations and their specs): no shared file.

## 6. Implementation

One sequential Sonnet implementer. No stream split: Go wire types feed the TS mirror, the contract
file and both test halves; `queries.ts` and `ContainerDetail.vue` serve both sections.

Commit order (each passes the pre-commit hook):
1. `feat(docker): container edit spec and in-place update` (2.1 to 2.4, 2.6, unit test, general
   flow tests, contract keys).
2. `feat(docker): recreate a container with rollback` (2.5, complete flow tests, contract keys).
3. `feat(docker-ui): container edit tab with in-place and recreate sections` (3.1 to 3.3 in-place
   half, UI spec parts).
4. `feat(docker-ui): recreate confirmation and apply` (dialog, recreate apply, rest of UI spec).
5. `docs: P253 docker container edit` (ARCHITECTURE, SPEC result).

Phase-end checks: `bun run typecheck`, lint, `go build ./...`, `go vet ./...`,
`go test ./internal/docker/...`, coverage gate, `dockerflow` general and complete with
`KIRA_FLOW_DOCKER=require`, `docker-edit.spec.ts` plus `docker-module.spec.ts` and
`docker-disk.spec.ts` (regression of the shared components).

## 7. Deferred decisions (defaults taken)

- D1 Edit surface: a detail tab "Edit" (draft kept per container in Pinia for the session), not a
  modal. Alternative: a dialog from the detail header.
- D2 Clearing a limit the engine cannot clear in place (memory, reservation, swap to 0, shares,
  CPUs/quota, cpuset, blkio) moves that change to the recreate section with its badge flipped.
  Alternative: forbid clearing entirely.
- D3 No image pull: a recreate to an image not present locally fails with `E_NOT_FOUND`.
  Alternative: pull with progress (needs registry auth handling).
- D4 Anonymous volumes of the old container are detached and kept (not deleted, not reattached).
  Alternatives: delete with the old container (`RemoveVolumes`), or reattach by name (Compose
  behaviour; contradicts the SPEC's "lost").
- D5 Recreate applies the whole draft (pending in-place edits included): one new container takes
  everything. In-place Apply sends only the in-place section.
- D6 Swarm task and Kubernetes pod containers: editor read-only. kind, Compose, devcontainer,
  Testcontainers, buildx: editable with a notice.
- D7 `AutoRemove` containers: in-place allowed (except restart policy, which the engine rejects),
  recreate refused.
- D8 Cmd/entrypoint edited one argument per line (no shell-words parsing, so no quoting
  ambiguity). Memory sizes as number + MiB/GiB unit.
- D9 Rollback scope: steps 3 to 7 roll back; step 8 (remove old) failing is success with a warning
  and the `-kira-old-` container kept.
- D10 Optimistic concurrency via `baseHash` (`E_CONFLICT` on mismatch) plus a per-container lock;
  no engine-side lock exists.
- D11 Tests: spec and in-place flows in the general suite; recreate flows in the complete suite.
