# P260 plan: Docker module polish

Base: `v2.0` at `2f111777b` (P252, P253 landed; P254 plan committed, its implementation running
elsewhere). Discovery: CodeGraph (`codegraph_explore` on the main checkout's index: external URL
opener `shell.OpenExternalURL`/`browserOpener`, workbench `TabStrip`/tabs store). The index predates
P252/P253, so `packages/docker-ui/**`, `internal/docker/resources.go`, `GitPanel.vue`,
`AutomationsPanel.vue` were read from source.

User items (verbatim intent, SPEC row P260):
1. Edit tab: drop the per-field coloured badges; two tabs inside the editor, "In place" and
   "Recreate"; keep pending summary, per-tab apply, recreate confirmation; neutral dirty dot.
2. Image registry button (Images view and container detail next to image name), derived from the
   image reference; open externally; no network calls; local-only images get none.
3. Compose icon coloured with the Compose brand colour.
4. Start/play green, stop red, everywhere in the Docker module.
5. No blue vertical bar on a selected row in the left panel.
6. Container size widget moves from Overview to Stats.
7. Left-panel section tabs identical to the git module's tabs.
8. Row action icons on the right in both Docker and Automations (user clarification: Automations
   currently puts Run on the left; move it right; Docker stays as is).

## 1. Current state

- Edit (`ContainerEditView.vue`): two stacked `DetailSection`s ("Applied in place", "Requires
  recreate"), each with count `Badge`, Reset, Apply / Recreate…. `EditField.vue` renders a
  `Badge` (`info` "applies now" / `warn` "recreates container", testid `docker-edit-badge`,
  `data-mode`) on every field, plus a `bg-focus` dot when changed. `resourceMode()`
  (`lib/editDiff.ts`) can flip an in-place resource field to `recreate` (clearing a set limit,
  switching CPU mode), so a field in the In place section can require recreate.
- Registry: `docker.Image` (`internal/docker/resources.go:88`) carries `ID, Tags, Size, Created,
  Containers, Dangling`; no `RepoDigests`. `ContainerDetail` has none either. Wire
  (`packages/docker-ui/src/wire.ts` `DockerImage`, `DockerContainerDetail`) mirrors that. Backend
  change needed.
- External URL opening: `shell.OpenExternalURL(browser, raw)` (`internal/shell/link.go`) validates
  http(s) + host and calls `browserOpener.OpenURL` (`internal/shell/wails.go`, built by
  `shell.NewDeferredBrowser()`). Kira Space exposes it as `bridge.LinkService.OpenExternal`
  (`apps/kira-space/internal/bridge/link.go`, wired in `apps/kira-space/main.go:98`). Kira Studio
  has no opener today: P120 deleted Studio's `LinkService` for lack of a caller. This phase brings
  it back with a real caller.
- Compose icon: `OriginIcon.vue` renders lucide `BoxesIcon` in `text-muted-foreground`; Kubernetes
  already uses its brand hex inline (`siKubernetes.hex`). simple-icons has no Compose entry.
- Start/stop sites (codicons `play`, `debug-stop`): `ContainerList.vue` row hover buttons
  (`docker-row-start`/`-stop`), group hover buttons (`docker-group-start`/`-stop`), row context
  menu items `start`/`stop`; `ContainerTable.vue` row buttons (engine overview table);
  `ContainerDetail.vue` toolbar (`docker-action-start`/`-stop`); `EngineOverview.vue` bulk "Start
  stopped" / "Stop all". Context menu icons are always `text-muted-foreground`
  (`packages/workbench/src/components/ContextMenu.vue:67,139`); `MenuItem` has no colour field.
- Selection bar: `bg-select shadow-[inset_2px_0_0_var(--color-focus)]` in `ContainerList.vue`,
  `ImageList.vue`, `VolumeList.vue`, `NetworkList.vue`. Git module rows use `bg-select` only
  (`GitPanel.vue:412,485`, `RepoTreeRow.vue:23`).
- Size: `ContainerSizeSection.vue` (TanStack query, on demand, session cache, Refresh) mounted in
  `ContainerOverview.vue`. Stats tab is `needsRunning: true`; `ContainerDetail.vue` falls back to
  Overview when a container stops on Terminal/Stats.
- Section tabs: `DockerPanel.vue` hand-builds `role="tab"` buttons with `tabChipVariants`, icon,
  label only when active, count. Git module (`apps/kira-space/frontend/src/repo/GitPanel.vue:351`)
  uses shadcn `ToggleGroup type="single" size="kira"` + `ToggleGroupItem` text labels.
- Automations rows (`packages/workbench/src/automations/AutomationsPanel.vue:397-490`, ungrouped
  and grouped copies): `play` icon (or running spinner) is the first item after the colour rail,
  left of the name; `RunElapsed` sits right. Docker container rows put the action at the right
  (`ContainerList.vue` last grid column).

## 2. Decisions

- D1 Edit tabs. shadcn-vue `Tabs` (`@theme/components/ui/tabs`, same primitive as
  `ConnectionDialog.vue` and P254's ScriptDialog). `TabsList` triggers "In place"
  (`docker-edit-tab-inplace`) and "Recreate" (`docker-edit-tab-recreate`). A changed tab shows a
  `size-1.5 rounded-full bg-muted-foreground` dot (`docker-edit-tab-dirty`), no count badge, no
  colour. Tab state is local (`ref`, default `inPlace`); not persisted.
  - Pending summary (`EditPendingSummary`) stays above the tabs, unchanged (its group headings
    "Applies now" / "Recreates container" are plain text, keep).
  - Each tab's footer row holds that tab's Reset + action: In place = Apply
    (`docker-edit-apply-now`), Recreate = Recreate… (`docker-edit-apply-recreate`). Same
    enablement logic as today. Recreate confirmation dialog unchanged.
  - `EditField.vue`: delete the `Badge` and the `mode` prop's badge rendering; changed dot becomes
    the same neutral `bg-muted-foreground` dot. When an In place field's `mode` resolves to
    `recreate` (via `resourceMode`), show a plain muted hint under the field: "This change needs a
    recreate." (`docker-edit-field-recreate-hint`). Only case where mode is surfaced per field.
  - Testids `docker-edit-section-inplace|recreate` move to the `TabsContent` panels;
    `docker-edit-count-*` and `docker-edit-badge` are removed.
- D2 Registry URL computed in Go, not TS. Reason: `RepoDigests` live only in the engine response;
  shipping them to the renderer just to parse there adds a wire field with no other use. New wire
  field `registryUrl string` (`""` = no button) on `docker.Image` and on `docker.ContainerDetail`.
  - `internal/docker/registry.go`: `registryURL(tags, repoDigests []string) string`, pure.
  - Rules: no digest => `""` (local-only). Pick the digest whose repository equals the first tag's
    normalised repository, else the first digest. Parse `name[@digest]` / `name[:tag]`: first path
    segment is a host only if it contains `.` or `:` or equals `localhost`; no host => `docker.io`
    and a single-segment path gets `library/`. Host `index.docker.io`, `registry-1.docker.io`,
    `mirror.gcr.io` (a Hub pull-through mirror; the flow test image
    `mirror.gcr.io/library/alpine:3.20` is one) normalise to `docker.io`.
  - Web URLs:
    - `docker.io/library/x` -> `https://hub.docker.com/_/x`; `docker.io/o/x` ->
      `https://hub.docker.com/r/o/x`.
    - `ghcr.io/o/p...` -> `https://ghcr.io/o/p...` (browser request redirects to the GitHub package
      page; user-vs-org path cannot be derived from the reference).
    - `quay.io/ns/r` -> `https://quay.io/repository/ns/r`.
    - `gcr.io|*.gcr.io/proj/img...` -> `https://console.cloud.google.com/gcr/images/proj/global/img...`.
    - `<loc>-docker.pkg.dev/proj/repo/img...` ->
      `https://console.cloud.google.com/artifacts/docker/proj/<loc>/repo/img...`.
    - `<acct>.dkr.ecr.<region>.amazonaws.com/repo...` ->
      `https://<region>.console.aws.amazon.com/ecr/repositories/private/<acct>/repo...?region=<region>`.
    - `public.ecr.aws/alias/repo` -> `https://gallery.ecr.aws/alias/repo`.
    - `mcr.microsoft.com/p...` -> `https://mcr.microsoft.com/artifact/mar/p...`.
    - Anything else (localhost, IPs, ports, gitlab, self-hosted) -> `""`.
  - `images()`: fill from `ImageSummary.RepoTags` + `RepoDigests`. `inspectContainer()`: one extra
    `cli.ImageInspect(ctx, r.Image)` inside the same `m.call`; an inspect error leaves
    `registryUrl` `""`, never fails the detail.
  - Unit test `internal/docker/registry_test.go`, table-driven: host detection, library prefix,
    mirror normalisation, digest choice, tag+digest stripping, each registry mapping, no-digest and
    unknown-host empties. Meets CLAUDE.md bar (parser with several interacting rules).
- D3 Opener. Re-add Studio `bridge.LinkService` (copy of Space's `link.go`: `Browser` field,
  `OpenExternal(LinkOpenExternalArgs{URL})` -> `shell.OpenExternalURL`). Wire
  `shell.NewDeferredBrowser()` in `apps/kira-studio/main.go` / `internal/appwire` (attach after
  `application.New`, same as Space), register `application.NewService(w.Link)`, regenerate
  bindings. docker-ui stays host-agnostic: `createDockerContext` options gain
  `openExternal(url: string): Promise<void>`; Studio `frontend/src/docker/context.ts` passes
  `LinkService.OpenExternal`. Add `'LinkService.OpenExternal'` to the UI test runtime mock.
- D4 Registry button UI. `TooltipIconButton icon="link-external" label="Open in registry"`:
  - Images view (`ImageList.vue`): row hover action at the right end (`docker-image-registry`),
    `@click.stop`; and in `ResourceDetail.vue` header next to the image title
    (`docker-resource-registry`).
  - Container detail (`ContainerDetail.vue`): right after `docker-detail-image`
    (`docker-detail-registry`).
  - Hidden when `registryUrl === ''`. Click calls `ctx.openExternal(url)`; a rejection shows in the
    existing `docker-action-error` line (detail) or is swallowed with a toast-free no-op in the list
    (same pattern as `act()`'s `.catch`).
- D5 Compose colour `#00B4FF`. Source: the official Docker Compose logo,
  `https://raw.githubusercontent.com/docker/compose/main/logo.png`, dominant saturated colour (the
  container cubes; body is grey-blue `#B8CADB`). The official mark is not red; the user's "red" does
  not match the brand. Default follows the real brand; see deferred decision X1. Applied inline as
  `style="color: #00B4FF"` on `BoxesIcon` (Kubernetes precedent: brand hex inline, no theme token,
  brand colours are theme-independent). Applies to group headers and row origin icons alike.
- D6 Start/stop colours: icons only, tokens `text-ok` (start/play, "Start all", "Start stopped")
  and `text-error` (stop, "Stop all"). Restart stays neutral. Icon buttons
  (`TooltipIconButton`, toolbar variant sets `hover:text-fg`) get `class="text-ok hover:text-ok"`
  / `text-error hover:text-error`. Text buttons colour the `CodiconIcon` only. Context menu:
  add optional `iconClass?: string` to the `item` variant of `MenuItem`
  (`packages/workbench/src/state/contextMenu.ts`); `ContextMenu.vue` uses it in place of
  `text-muted-foreground` when set (both the top-level and submenu icon). Full site list:
  1. `ContainerList.vue` row start / stop buttons.
  2. `ContainerList.vue` group "Start all" / "Stop all".
  3. `ContainerList.vue` context menu Start / Stop.
  4. `ContainerTable.vue` row start / stop.
  5. `ContainerDetail.vue` toolbar Start / Stop.
  6. `EngineOverview.vue` "Start stopped" / "Stop all".
- D7 Selection: drop `shadow-[inset_2px_0_0_var(--color-focus)]` in all four list files; keep
  `bg-select`.
- D8 Size to Stats. Stats tab becomes available for stopped containers (`needsRunning: false`);
  the auto-fallback watch in `ContainerDetail.vue` keeps only Terminal. `StatsView.vue`: top
  `ContainerSizeSection` (always), then live CPU/Memory/I-O when running, else a muted line "Live
  stats need a running container." (`docker-stats-stopped`). `StatsView` gets a `running` prop.
  `ContainerOverview.vue` drops the section. Query/cache behaviour untouched (component moves,
  `useContainerSize` key unchanged).
- D9 Section tabs. `DockerPanel.vue` replaces the hand-rolled chips with `ToggleGroup
  type="single" size="kira"` + `ToggleGroupItem` (same classes/props as `GitPanel.vue`), in the
  existing row under the header (header keeps "Docker" + endpoint chip, unlike git which replaced
  its title; see X3). Items: text label + muted count (`docker-section-count`), no icons, no
  tooltip. Testids `docker-section-<id>` kept. `@update:model-value` ignores empty (git's
  `v && ...` guard).
- D10 Automations row actions on the right. In both row copies of `AutomationsPanel.vue`, move the
  `play` icon / running spinner from before the name to the row end, after `RunElapsed`, in a
  fixed `w-5 justify-center` slot so names align. Click/run behaviour unchanged (whole row runs).
  Icon stays `text-muted-foreground` (item 4 is Docker-only; see X4). Overlap with P254 (owns
  `AutomationsPanel.vue`, `apps/kira-studio/tests/ui/automations-module.spec.ts`, Studio visual
  baseline `tests/visual/automations-module.spec.ts-snapshots/`): this is its own final commit
  group, applied only after P254 has landed on `v2.0` (implementer rebases first; if P254 is not
  landed when commits 1-6 finish, stop and report instead of editing those files).

## 3. Owned files

Edit:
- `internal/docker/resources.go` (Image, ContainerDetail fields; `images()`, `inspectContainer()`)
- `apps/kira-studio/main.go`, `apps/kira-studio/internal/appwire/{appwire.go,wire.go}`
- `apps/kira-studio/frontend/src/docker/context.ts`
- `apps/kira-studio/frontend/bindings/**` (regenerated)
- `packages/docker-ui/src/{wire.ts,context.ts,testing/ui/dockerMock.ts}`
- `packages/docker-ui/src/components/{ContainerEditView,EditField,EditInPlaceSection,EditRecreateSection,
  OriginIcon,ContainerList,ContainerTable,ContainerDetail,EngineOverview,ImageList,VolumeList,
  NetworkList,ResourceDetail,ContainerOverview,StatsView,DockerPanel}.vue`
- `packages/workbench/src/state/contextMenu.ts`, `packages/workbench/src/components/ContextMenu.vue`
- `apps/kira-studio/tests/ui/{docker-module,docker-edit,docker-disk}.spec.ts`,
  `apps/kira-studio/tests/ui/support/mockRuntime.ts`
- `apps/kira-studio/internal/flows/dockerflow/` (new `registry_test.go`), contract fixture
  `apps/kira-studio/tests/contract/docker-*.json` re-recorded where `registryUrl` appears
- `docs/ARCHITECTURE.md` ("Docker module": edit tabs, registry link, size in Stats; Studio
  LinkService back), `docs/v2.2/SPEC.md` (P260 row status, result)
- After P254 lands: `packages/workbench/src/automations/AutomationsPanel.vue`,
  `apps/kira-studio/tests/ui/automations-module.spec.ts` and Space's automations UI spec if a
  selector changes, Studio automations visual baseline if it shifts.

New: `internal/docker/registry.go`, `internal/docker/registry_test.go`,
`apps/kira-studio/internal/bridge/link.go`, `docs/v2.2/plans/P260-result.md`.

Concurrency: P250 (`/home/user/kira-sW`) owns new e2e coverage and may edit
`docker-module.spec.ts` and `flows/dockerflow/*_test.go`; whichever lands second rebases and
resolves (expected textual only). P254 overlap handled by D10's ordering. P257/P258 are git:
no overlap.

## 4. Steps and commits

One sequential Sonnet implementer. Fast checks (`typecheck`, `lint`, `lint:go`, build) per commit;
UI specs and Docker flow tests once at the end, fixes as follow-up commits.

1. `feat(docker): registry URL for images and containers` - D2, Go + wire + unit test.
2. `feat(studio): LinkService for external URLs` - D3, bindings regenerated.
3. `feat(docker-ui): open image registry` - D4.
4. `refactor(docker-ui): edit tabs instead of mode badges` - D1.
5. `style(docker-ui): compose colour, start/stop colours, selection, section tabs` - D5, D6, D7, D9
   (includes the `MenuItem.iconClass` workbench change).
6. `feat(docker-ui): container size in Stats` - D8.
7. `test(docker): flow and UI specs` - section 5.
8. (after P254 on `v2.0`, rebase first) `style(automations): run icon on the right` - D10 + its
   spec/baseline updates.
9. `docs: P260 docker polish` - ARCHITECTURE, SPEC row Done, `P260-result.md`.

## 5. Tests

- Go unit: `internal/docker/registry_test.go` (D2 table).
- IPC split, registry: backend flow test `dockerflow/registry_test.go` (`TestImageRegistryURL`,
  general suite, needs Docker): flow image `mirror.gcr.io/library/alpine:3.20` row in `Images()`
  has `registryUrl == "https://hub.docker.com/_/alpine"`; `InspectContainer` of a container from it
  has the same; an image made by `ContainerCommit` (no digest) has `""`. Frontend half in
  `docker-module.spec.ts`: mock image with `registryUrl` shows `docker-image-registry`, click calls
  `LinkService.OpenExternal` with that URL; same on container detail (`docker-detail-registry`);
  `registryUrl: ''` shows no button. Contract fixture keys record the new field.
- `docker-edit.spec.ts`: replace the badge contract test with a tabs test (two tabs, In place
  active, no `docker-edit-badge` anywhere, dirty dot appears on the edited tab only); Apply and
  Recreate… found inside their tab panels; memory-clear case asserts
  `docker-edit-field-recreate-hint` and the pending line `data-mode="recreate"` (summary
  unchanged).
- `docker-disk.spec.ts`: size test opens the Stats tab before Measure; stopped container still
  reaches Stats (`docker-stats-stopped` visible).
- `docker-module.spec.ts`: section-tab test selects `docker-section-*` by testid (ToggleGroup items
  are not `role="tab"`); single-row assertion kept. Start/stop colour: one assertion that
  `docker-row-start` has class `text-ok` and `docker-row-stop` `text-error`. Selected row has no
  `box-shadow` (computed style `none`).
- D10: `automations-module.spec.ts` assertion that the run icon is the row's last child after
  the name (bounding box x greater than the name's).
- No docker visual baselines exist; none added.

## 6. Deferred decisions (defaults taken)

- X1 Compose colour: default brand `#00B4FF` (D5). Alternative: user's literal "red" via the
  existing `text-conn-red` token. Ask the user before step 5 if possible; default stands otherwise.
- X2 ghcr link: default `https://ghcr.io/<path>` relying on GitHub's browser redirect.
  Alternative: no button for ghcr.
- X3 Section tabs placement: default stays in the row under the header. Alternative: move into
  the header in place of the "Docker" title, exactly like git.
- X4 Automations run icon colour: default unchanged (muted). Alternative: green like Docker start.
- X5 Section tab counts: default kept as muted suffix. Alternative: drop, matching git's plain
  labels.
