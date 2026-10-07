# P200 notes — Docker module

## Landed

Commits on `v2.1-stream-B`, in plan order:

1. `feat(docker): engine endpoint resolution and client`
2. `feat(docker): resource lists, inspect and container actions`
3. `feat(docker): events watch and stats hub`
4. `feat(docker): logs and exec streams`
5. `feat(docker): bound service and Studio bridge shim` (S9)
6. `feat(docker-ui): package scaffold, control, context, queries, stores` (S7, S11-S16, NOTICES.md)
7. `feat(docker-ui): panel, resource lists, endpoint picker`
8. `feat(docker-ui): container detail (overview, logs, terminal, stats, inspect)`
9. `feat(docker-ui): engine overview, resource detail, unavailable states`
10. `feat(studio): register docker module` (S1-S5, S8, S10, S17, Studio wrappers)
11. `test(docker): real-engine check and UI spec`
12. Follow-ups: `fix(workbench): scan docker-ui sources for Tailwind classes`,
    `chore(docker): drop unused test helper, include css in knip project`

Step 13 (S6 visual baselines) not done: baselines are not regenerated here.

## Deviations

- Moby client v0.5.1 uses typed Options/Result structs, not the positional API the plan sketched.
  Code follows the module source.
- `@workbench/workbench.css` `@source "../../docker-ui/src"` first landed inside the header comment
  (step 6), so no docker-ui utility was generated. Caught by the Stop UI case (`group-hover/row`).
  Fixed in its own commit.
- `InspectView` renders `<pre class="font-data">` with copy. `monaco.ts` exposes only `loadMonaco()`,
  no read-only model helper.
- Logs: virtualized rows when Wrap is off. Wrap on renders the last 2000 filtered lines unvirtualized,
  since variable row heights need measurement the virtualizer here does not do. Buffer cap stays 20 000.
- Row `role="button"` divs became `role="option"` in a `role="listbox"` `VirtualList` (biome a11y).
  A `<button>` cannot hold the hover action buttons.
- `docker-module.spec.ts` imports `dockerMock.ts` by relative path. `@kira/docker-ui` has no path
  alias in `tsconfig.tests.json`; adding one would edit a shared config.
- `go.mod`: `containerd/errdefs` moves to a direct require (used for error mapping).
- `packages/docker-ui/package.json`: dropped `@tailwindcss/vite` and `@vitejs/plugin-vue` (knip
  flagged unused); added `check:vue` script like git-ui.
- `StatsSparkline.vue` not `Sparkline.vue` (biome multi-word component name rule).
- Mock helper defaults: fire-and-forget methods and `Contexts` answer without a handler.
- `mode-switch.spec.ts` ink loops and `modeTab()` type extended with `docker`.

## Verification

- `go build ./...`, `go vet ./internal/docker/...`, `bun run lint:go`: clean.
- `go test -race -v ./internal/docker/... ./internal/shell/...` with `dockerd` up: all pass,
  `--- PASS: TestEngine` ran (not skipped).
- `bun run lint`, `bun run typecheck`, `bun run lint:dead`: clean.
- `bun run test:ui:studio -- docker-module mode-switch terminal-module`: 25 passed
  (docker-module 8/8 after the CSS fix).
- Grep proofs from plan §7 hold: `storeId: 'docker-exec'`, `TerminalHostView` in `ExecView.vue`,
  `useQuery` in `queries.ts`, `anser` in `lib/ansi.ts`, `GetConnectionHelper` in `endpoint.go`,
  `ServiceShutdown` and `CloseWindowBound` in `bound.go`, no `apps/` import in docker-ui.

## Visual baselines (S6, not regenerated)

`bun run test:visual:studio` fails 12 of 13: data-view, connection-dialog, console,
http-request-view, schema-dialog, settings (6 panes), workbench. The title bar gains a fourth mode
tab. Not every diff was inspected here; some may predate P200 (Stream A touched settings and
terminal visuals). Regenerate after the rebase onto A, one `test(visual): fourth mode tab` commit,
and check each diff is title bar only.

## Known gaps

- Exec sessions stay in the Terminal tab's chip list after the container stops. The shell exit
  footer shows; the chip must be closed by hand.
- Dark/light colour of ANSI log spans uses `anser` RGB output unmodified.

## Proposed ARCHITECTURE.md edits

- New module row: Docker (`internal/docker`, `packages/docker-ui`). Bound service `DockerService`
  embeds `*docker.BoundService`; channels `kira:docker:changed|status|stats|logs|exec`.
- Engine endpoint order: selected UI context, `DOCKER_HOST`, `DOCKER_CONTEXT`/`currentContext`,
  default socket, socket probe. `ssh://` via `docker/cli` `connhelper`.
- Streams are per window (`windowKey`); `WindowOpenerDeps.OnWindowClosing` ends them. Stats share
  one engine stream per container across windows.
- `ModeDef.tabStrip: false` hides the tab strip for a module without tabs.
- Known open item: remote `tcp://` without TLS is allowed, flagged `secure: false` in the UI.
