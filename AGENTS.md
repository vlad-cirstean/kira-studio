# Working agreement

Facts about the app itself — driver choices, protocol constraints, capability quirks — live in
`docs/ARCHITECTURE.md`, not here. This file is process and environment only: how this team works,
and how to run things wherever a session happens to be.

**Opus plans, a Sonnet subagent implements — this session only orchestrates.**

- The **main session runs on Sonnet and orchestrates only** — it doesn't implement, edit code, or
  fix findings directly. Its job is spawning the right subagents in order, carrying context between
  them, and tracking progress; the actual writing always happens in a subagent.
- Each phase (`docs/v1.1/SPEC.md`'s phasing table) gets an Opus-authored plan committed under
  `docs/v1.1/plans/` before implementation starts — spawn an **Opus subagent** (`Agent` tool,
  `model: "opus"`) whose only job is writing that plan. If a phase has no plan there, don't
  implement from the spec directly; get the plan written and committed first.
- **Once the plan lands, spawn a Sonnet subagent** (`model: "sonnet"`) to implement it. Default to
  **one sequential subagent for the whole phase** — a fresh subagent starts cold, so the prompt to
  it must carry the plan and whatever prior-phase context it needs, not assume it remembers
  anything. **Parallel subagents only when the plan's work is genuinely independent** (unrelated
  adapters, non-overlapping fixes) — never split one continuous, order-dependent piece of work
  across subagents just to run it concurrently.
- **Implement the whole plan first, then test once and fix what's found** — don't gate every
  intermediate commit on the full test suite. Fast checks (typecheck, lint, build) are cheap and
  fine per-commit; an expensive suite (end-to-end/UI, a real-hardware check) runs once near the end
  of the phase, with fixes landing as follow-up commits. Commits still land incrementally as work
  completes, for a legible history — only *when* the expensive verification happens changes, not
  whether the result has to be correct or whether commits stay granular.
- **The loop per phase:** check for a plan → spawn an Opus subagent to write one if missing → spawn
  a Sonnet subagent (or several, only if genuinely parallelizable) to implement the whole phase, and
  wait for it before moving on. One phase at a time, in order — never parallelize or batch phases.
- **Multiple passes/iterations/rounds means repeat the whole loop that many times**, not run it once
  and treat extras as optional. Each pass plans against the *current* tree (on top of everything the
  previous pass landed, never the pre-phase state) and gets its own file under `docs/v1.1/plans/`
  (a phase's plan plus `-iter2`/`-iter3` suffixes), so what each round found stays legible. A
  planning pass should re-read the current source rather than trust the previous pass's summary
  prose, and say plainly when a pass finds nothing real rather than manufacture a finding.
- **"Code review"** (once a phase or batch is otherwise complete, on request) means three **Opus
  subagents in parallel**, one per dimension: (1) architecture/structure/maintainability/security,
  (2) functional correctness and business logic, (3) performance and resource efficiency. Each only
  reports findings, never fixes. Then one sequential Sonnet subagent fixes every finding (parallel
  only for a batch genuinely isolated from each other). Repeat the whole three-agent cycle for as
  many rounds as asked — a round that finds nothing real should say so rather than manufacture a
  finding. No findings document survives a round once fixed — each finding is fixed and committed
  one at a time, so the commit log is the durable record; carry forward only a genuinely still-open
  item (see "Known open items"), never a running narrative of what each round found.
- No per-phase PRs. One feature branch for all of v1.
- **Best practices throughout, no shortcuts** — no stubbed error handling, no `TODO: fix later`, no
  skipped validation to make something demo. Scope left out of a phase is left out entirely, not
  half-implemented.
- **Reach for an existing, well-maintained library before hand-rolling non-trivial infrastructure**
  — a parser, a virtualizer, a positioning engine, retry/backoff, and similar. This repo already
  relies on CodeMirror, zod, sql-formatter and SlickGrid rather than reimplementing them; a
  hand-rolled version earns its keep only against a real requirement no library meets (e.g.
  spelling-preserving timestamp re-encoding) — name that requirement when declining a library, not
  just that existing code already works.
- **Only fully open-source libraries** — no community edition of a dual-licensed product, no
  non-commercial-only tier, no functionality gated behind a paid/Enterprise tier. Check the license
  at the package level *and* for the specific feature used, not just the headline badge (AG Grid
  Community's own license is fine; the context menu/range selection/clipboard features this app
  needed are Enterprise-only, hence declined). Applies to every new dependency.
- **Measure when there's a real, concrete question at stake, not as a default ritual.** A
  real-hardware trace, CDP tracing, or a byte-for-byte bundle comparison earns its keep when a
  claimed fix, regression, or cost genuinely can't be checked another way. Don't extend that rigor
  to routine changes or to every declined option — a short honest estimate or a plain read of the
  code's/library's stated behavior is enough there. Skip a measurement that wouldn't change the
  decision.
- **Comments: very concise, only where truly necessary.** Add one only when the code can't say it
  for itself — a non-obvious *why*, a constraint, a workaround. Never restate what the code shows.
- **Unit tests exist only for advanced, complex or deeply nested logic — this app has very little.**
  Default to *no dedicated unit test*. A test earns its keep only guarding something genuinely hard
  to get right: a parser/splitter with several interacting rules, cursor/pagination boundary
  arithmetic, cache eviction/invalidation with interacting rules, crypto beyond
  encrypt-then-decrypt, concurrency (ordering, backpressure, cancellation, races), or a decision
  structure too large to hold in your head. Everything else gets nothing: CRUD round-trips (even
  integration-shaped), one/two-condition validation, required-field/enum guards, thin pass-through
  wrappers, constructors/builders, format round-trips with no edge case, single bad-input →
  single-error paths, anything that mostly restates a short function body. A single `if` guarding
  one obvious case isn't complexity. When torn between two similar tests, delete. Applies going
  forward, not as a retroactive cleanup.
- **The adapter conformance suites are exempt from that bar, not an application of it.**
  `apps/kira-studio/internal/adapters/*/*_test.go` are the sole successor to the deleted
  `packages/db-fixtures/*.spec.ts` files — nothing else exercises a Go adapter capability by
  capability (`tests/e2e-real/` only spot-checks a scenario or two per kind). Keep per-capability
  coverage there even where it reads like a CRUD round-trip; prune only genuine duplication.
- **Real-container adapter tests split into two suites, by design (P25).** A *general* suite runs
  frequently in the normal dev/CI loop — basic per-adapter connectivity sanity, not the full
  permutation matrix. A *complete* suite runs only on-demand and in CI — the full auth/config
  permutation matrix per adapter (root vs. least-privilege user, with/without password, with/without
  the database-equivalent field) plus error-handling verification, deliberately comprehensive since
  it's opt-in rather than part of every local run. Extend the complete suite's own harness for new
  functional coverage (load/write/delete/filter/DDL, per adapter) rather than building a parallel
  mechanism — it's designed for that (P25's own `Scenario`/`Requires` seam, populated by P26).
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)** —
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, with a `!` or `BREAKING CHANGE:` footer
  for breaking changes.
- **Keep this file lean — prune as you go, don't just append.** An app fact belongs in
  `docs/ARCHITECTURE.md`; a phase or review round's discovery belongs in that phase's plan doc under
  `docs/v1.1/plans/` (never a permanent "findings" section here — the plan doc and commit log are
  the durable record, not this file). Before adding a bullet, ask whether it's a standing rule for
  how this team works, not a one-off result. When you touch this file, remove what's gone stale too
  — a fixed tool's workaround, a pointer to a deleted file/subsystem, a question a later phase
  already resolved. "Known open items" is the one durable exception — keep an item only while
  genuinely open, delete it the moment it's resolved rather than marking it done in place.

## Known open items

- **First-launch window-size clamp (P22 D6(a)) still can't apply to the very first window a fresh
  install opens** (round-2 review finding 4). `main.go`'s `openWindow` now resolves
  `app.Screen.GetPrimary()` fresh per call rather than once before `app.Run()`, which does let
  `shell.DefaultBounds` see a real work area for a window opened well after `Run()` (Dock-reopen
  minting a fresh window, "New Window" when there's nothing to cascade from) — but every window
  opened at startup is still built before `app.Run()` even runs (main.go's own top comment), and on
  macOS the screen cache isn't populated until `ApplicationDidFinishLaunching` fires, strictly
  after `Run()` is called. So a genuinely first-ever launch still gets the unclamped 1280×800
  default until the window is resized once. Closing this needs deferring startup window creation
  until after that event fires — a materially larger structural change than this fix.

## Docker (for `packages/db-fixtures/`'s container fixtures, used directly by `apps/kira-studio/tests/e2e-real/`)

- **Claude Code on the web's Linux containers**: `docker` is preinstalled but the daemon isn't
  running and there's no systemd. Start it directly, as root: `nohup dockerd > /tmp/dockerd.log 2>&1 &
  disown`, then check `docker info` / `/tmp/dockerd.log` for `"API listen on
  /var/run/docker.sock"`. Once per fresh container.
- **The other dev environment (macOS) uses Colima** (`colima start`) — not `dockerd` directly, and
  no systemd there either.
- **Docker Hub blob downloads are blocked here.** `production.cloudfront.docker.com` (the CDN every
  Hub blob redirects to) and `quay.io` both 403 through the outbound proxy, so a direct pull
  resolves the manifest and then can never fetch a layer. **`mirror.gcr.io` is not blocked** —
  `packages/db-fixtures/support/*.ts` hardcode plain Hub names, so pull the mirrored name once per
  session and re-tag it locally rather than editing source:
  ```
  docker pull mirror.gcr.io/library/mariadb:11.4   # official (unnamespaced) image: needs library/
  docker tag mirror.gcr.io/library/mariadb:11.4 mariadb:11.4
  docker pull mirror.gcr.io/confluentinc/cp-kafka:8.0.7   # already namespaced: no library/ prefix
  docker tag mirror.gcr.io/confluentinc/cp-kafka:8.0.7 confluentinc/cp-kafka:8.0.7
  ```
  Rule: a Docker Hub *official* image (no namespace — `mariadb`, `mysql`, `postgres`, `redis`,
  `mongo`) lives under `library/` on the real registry, so the mirror path needs that prefix; an
  already-namespaced image (`clickhouse/clickhouse-server`, `confluentinc/cp-kafka`,
  `localstack/localstack`) mirrors at the same path with no prefix. Confirmed for every image this
  repo uses. ClickHouse needs one further workaround on top — see the ClickHouse section below.
- **Bun's `testcontainers` integration hangs indefinitely in this sandbox** on images that pull and
  run fine under plain Node with the identical image (confirmed fine on real hardware — a Bun-here
  quirk, not a real bug). Postgres is a confirmed instance. Workaround, already applied in
  `apps/kira-studio/tests/e2e-real/` (`support/postgres.ts`, `support/mariadb.ts`): invoke
  Playwright via its plain Node CLI entrypoint (`node node_modules/.bin/playwright test
  --project=e2e-real`), never `bunx playwright test`. **There is no vendored Node runtime any more**
  (removed P58f M10) to bundle a standalone capture script against, so the old capture tools
  (`scripts/capture-postgres-tree.ts`, `scripts/capture-tree.ts`) are deleted with it — capturing a
  genuinely new `tests/ui/` fixture shape needs a one-off capture mode in
  `apps/kira-studio/internal/ipcfixture`'s Go generator that hasn't been built yet (only the six
  committed per-adapter fixture generators exist, see below).

## `apps/kira-studio/tests/ipc/` — building and testing in this environment (P50, updated P57, backend moved to Go P58f)

See `docs/ARCHITECTURE.md`'s Testing section for what this tier is and why its fixture is generated
rather than hand-written. This section is only about running it here.

- **Neither half needs `xvfb`** — no Electron, no native window anywhere in the repo. The frontend
  half (`bun run test:ipc:fe`) drives headless Chromium against a static file server, the same way
  `tests/ui/` does.
- **The backend half is Go, not a bundled TypeScript spec** — no esbuild step, no vendored Node
  runtime. `apps/kira-studio/internal/ipcfixture`'s per-adapter Go test (`clickhouse_test.go`,
  `kafka_test.go`, `mariadb_test.go`, `mysql_test.go`, `redis_test.go`, `sqs_test.go` — postgres and
  sqlite generate no fixture of their own, see `docs/ARCHITECTURE.md`) drives the real
  `adapterhost`/`adapters` stack against a real container and writes
  `apps/kira-studio/tests/ipc/<adapter>/<adapter>.fixture.ts`.
- **Regenerating a fixture**: `KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...`
  writes each `<adapter>.fixture.ts` via `write.go`'s `mustMarshalNoEscape` (`SetEscapeHTML(false)` +
  typed structs, never maps, since Go's `encoding/json` otherwise escapes HTML and sorts map keys).
  Run `bunx biome check --write` on the result afterward — formatting only, content unchanged.
- **All six adapters' fixture generators run for real here** against containers pulled via
  `mirror.gcr.io`. ClickHouse needs no extra work this time, unlike the old TypeScript tier:
  `testcontainers-go/modules/clickhouse` doesn't hardcode a restrictive `Ulimits`. Kafka's capture
  has one quirk of its own: a read fans across both partitions and interleaves by arrival, not
  key/offset, so the fixture sorts the captured page by key, and the consumer group's coordinator
  host:port is frozen the same way ClickHouse's `.inner_id.<uuid>` is.
- **There is no one-off capture mode yet** (P58f D15's own gap, see the Docker section above):
  `KIRA_IPC_FIXTURES=write` only regenerates the six fixtures already committed under
  `apps/kira-studio/tests/ipc/`. Capturing a fresh shape for a new `tests/ui/` fixture needs that
  mode written first.

## ClickHouse — testing in this environment (P36, its workaround resolved P58f)

See `docs/ARCHITECTURE.md`'s ClickHouse section for the adapter's own design facts.

- This sandbox's `ulimit -Hn` is fixed at 20000 and can't be raised even as root (a plain `docker
  run` with no custom ulimits works fine), which broke the old JS tier: `@testcontainers/clickhouse`
  hardcoded `.withUlimits({nofile: {hard: 262144, soft: 262144}})`. The Go side
  (`apps/kira-studio/internal/adapters/testsupport/clickhouse.go`, used by both
  `internal/adapters/clickhouse` and `internal/ipcfixture`) needs no equivalent workaround:
  `testcontainers-go/modules/clickhouse` doesn't hardcode a restrictive `Ulimits`, so this sandbox's
  ceiling never becomes a problem. If a future container image or module version reintroduces one,
  `testcontainers-go`'s own `WithHostConfigModifier` on the generic container option is the fix.

## SQLite — testing in this environment (P35)

- Coverage lives in `apps/kira-studio/internal/adapters/sqlite/*_test.go` (`bun run test:go`), no
  Docker: `modernc.org/sqlite` (pure Go, no cgo) against a real `t.TempDir()` file.
  `packages/db-fixtures/support/sqlite.ts` survives regardless, since `apps/kira-studio/tests/e2e-real/`
  still reads it directly.
- `apps/kira-studio/tests/e2e-real/sqlite-real.spec.ts` runs unconditionally, Docker-free by design
  — a real `-tags server` Go binary, every adapter served in-process, and a real temp-file database
  driven by a plain Playwright tab. Prerequisites (`scripts/setup.sh`, `bun run build`, and
  `go build -tags server`) are memoized per worker process by
  `apps/kira-studio/tests/e2e-real/fixtures.ts`'s `buildPrerequisites()`.

## Secrets / `KIRA_INSECURE_SECRETS` (P25, moved to Go in P52/P57)

See `docs/ARCHITECTURE.md`'s Storage section for the cipher, the key and the envelope. Here:

- **There is no Linux keychain backend at all** (no `gnome-keyring`/`kwallet` probing) — set
  `KIRA_INSECURE_SECRETS=1` before launching the app (`bun run dev`, the Go binary directly, or
  `t.Setenv("KIRA_INSECURE_SECRETS", "1")` in a Go test) on any Linux box to opt into the dev-only
  fallback. `apps/kira-studio/tests/e2e-real/`'s fixture sets it for every real-backend test.
- Without it, Linux secret storage is **unavailable** — a password-bearing save fails visibly
  rather than silently falling back to plaintext. Deliberate, not a bug to work around.
- **On macOS the variable is ignored outright** — the real Keychain is used and this can never
  weaken it, even if accidentally left set. `apps/kira-studio/tests/ui/secrets.spec.ts`'s "keychain
  available" scenario guards this.

## Wails v3 / Go — building and testing in this environment (P51, P52, P55)

- **None of this toolchain persists across sessions.** Re-run at the start of any fresh container:
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` (needed even though the product
  targets macOS — `wails3`'s own Linux build fails at `internal/operatingsystem` with a
  `pkg-config` error without it), then `go install github.com/wailsapp/wails/v3/cmd/wails3@<the
  version go.mod pins>` and `export PATH=$PATH:$(go env GOPATH)/bin`. **Pin that version, never
  `@latest`** (which once resolved a beta ahead of `go.mod` and silently skewed the bindings
  generator against the runtime library). **Pin `GOTOOLCHAIN` to go.mod's own `go` directive for
  that install too** (`GOTOOLCHAIN=go<directive> go install …`) — `auto` resolves from *Wails'* own
  floor rather than this repo's, which once degraded the bindings generator into 52 spurious
  "requires newer Go version" warnings on this exact repo. `scripts/setup.sh` does all of this
  automatically.
- **`wails.io`/`v3.wails.io` are 403-blocked**, on real macOS hardware too — organizational proxy
  policy, not a sandbox artifact. `proxy.golang.org` is reachable, which is all the Go toolchain
  needs. **Read the installed module source under
  `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@<version>/` instead of the docs site** — it
  is the real source for the exact pinned version.
- **`go test ./apps/kira-studio/internal/...` / `go build ./apps/kira-studio/internal/...` need
  nothing but the Go toolchain** — the product's own Go code is entirely cgo-free
  (`modernc.org/sqlite` for both the sqlite adapter and the app's own storage). Only the
  `apps/kira-studio` `main` package imports Wails and needs the GTK/WebKit headers, so prefer
  `./apps/kira-studio/internal/...` for a fast loop.
- **Regenerate bindings via `wails3 task common:generate:bindings`** (or `scripts/setup.sh`, which
  calls it) — never a hand-typed `wails3 generate bindings` flag list, which has already drifted
  from the task's real flags once. `apps/kira-studio/frontend/bindings/**` are real Vite import
  targets, so a missing one fails the build with an unresolvable import rather than a stale-bindings
  surprise; regenerate whenever a bridge service's method set changes, and before any frontend
  build. **`-names` is load-bearing, not cosmetic**: without it, every generated call site emits
  `$Call.ByID(<numeric-id>, ...)` instead of `$Call.ByName("<pkg>.<Service>.<Method>", ...)`, and
  `tests/ui/support/mockRuntime.ts`'s request-interception layer is keyed on the `ByName` string FQN
  (`CHANNEL_TO_FQN`) — a `-names`-less regeneration silently breaks every `tests/ui/` spec at the
  very first bound call of the boot sequence (`layoutGetAll`), surfacing as
  `page.waitForSelector('[data-testid="status-bar"]')` timing out with a page-level `Error: no
  CHANNEL_TO_FQN entry for undefined` — nothing about the failure points at bindings at all.
- **A first `wails3 task dev` build takes ~60s** (native compile, icon/binding generation, Vite cold
  start). Giving up after 15-25s looks exactly like a sandbox limitation and isn't.
- **A background process started in one shell invocation cannot be signalled from a later, separate
  one** — it still shows up in the later call's `ps aux` (the process table is shared) but the
  signal doesn't land, leaving an unreapable zombie squatting on its port for the rest of the
  session. Do everything — start, poll, test, kill — inside **one** invocation, polling a log file
  or a port in a loop instead of a fixed `sleep`, with a correspondingly long timeout. Relatedly,
  `export FOO=bar && long-command &` backgrounds the whole `&&` chain, so `FOO` never reaches the
  parent shell — put `export` on its own line.
- **This container's minimal init reaps slowly.** After killing a process group, its members can
  answer `kill(pid, 0)` as alive for a second or two: a reparented orphan becomes a zombie the
  moment it exits, and `kill(pid, 0)` succeeds against a zombie until something `wait()`s it.
  `internal/preconnect`'s and `internal/connections`' process-group-kill tests poll for `ESRCH` with
  a multi-second timeout for exactly this reason — don't tighten them based on a fast macOS run.
- **On Linux, `/wails/runtime` and `/wails/stream/*` are unreachable over plain HTTP from a desktop
  build**, dev or packaged: `pkg/application/linux_cgo.go` registers `wails://` as a custom URI
  scheme intercepted *inside* the native process, so `curl` or a plain browser tab can never
  exercise real bindings there. **The `//go:build server` platform is the way around it**
  (`go build -tags server`, zero source changes): it serves the whole bound-call surface and the
  data-plane stream over a real TCP listener with no webview and no scheme registration at all —
  this repo's established substitute for GUI-driven boot proofs in a sandbox with no display,
  preferred over `xvfb`/`xdotool`/screenshot techniques. `tests/e2e-real/` is built on it.
