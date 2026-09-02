# Working agreement

Facts about the app itself — driver choices, protocol constraints, capability quirks and why —
live in `docs/ARCHITECTURE.md`, not here. This file is process and environment only: how this
team works, and how to run things in whichever box a session happens to be on.

**Opus plans, a Sonnet subagent implements — this session only orchestrates.**

- The **main session runs on Sonnet, and it orchestrates only** — it does not implement, edit code,
  or fix findings directly. Its job is to spawn the right subagents in the right order, carry
  context between them, and track progress; the actual writing happens in a subagent every time.
- Each phase (see `docs/v1.1/SPEC.md`'s phasing table) gets an Opus-authored plan
  committed under `docs/v1.1/plans/` before any implementation starts. Produce this by spawning an
  **Opus subagent** (`Agent` tool, `model: "opus"`) whose job is only to write that plan.
- If a phase's plan is missing from `docs/v1.1/plans/`, do not implement from the spec directly —
  get the Opus plan written and committed first.
- **Once the Opus plan lands, spawn a Sonnet subagent** (`Agent` tool, `model: "sonnet"`) to
  implement it. Default to **one sequential subagent for the whole phase**, not several — a fresh
  subagent starts cold, so the orchestrating session's prompt to it must carry the plan and
  whatever prior-phase context it needs to pick up with continuity, rather than assuming it
  remembers anything. **Use multiple subagents in parallel only when the plan's own work is
  genuinely independent and parallelizable** (e.g. several unrelated adapters, or research/fixes
  that don't touch the same files or depend on each other's output) — never split a single
  continuous, order-dependent piece of work across subagents just to run it concurrently.
- **The loop per phase:** check for a plan → spawn an Opus subagent to write one if missing →
  spawn a Sonnet subagent (or several, only if the work is genuinely parallelizable) to implement
  the whole phase, and wait for it to finish before moving on. Phases are done one at a time, in
  order — do not parallelize or batch multiple phases together.
- **A phase asked for in multiple passes/iterations/rounds means repeat that whole loop that many
  times**, not run it once and call the extra passes optional. Each pass is its own
  Opus-plans-then-Sonnet-subagent-implements cycle, in order, each one written and implemented
  against the *current* state of the tree (i.e. on top of everything the previous pass already
  landed) — never against the pre-phase state, and never batched into one plan up front. Give each
  pass's plan its own file under `docs/v1.1/plans/` (e.g. a phase's plan plus `-iter2`/`-iter3`
  suffixes) so the history of what each round found and fixed stays legible on its own. The point
  of more than one pass is that later rounds find what earlier rounds missed or newly created — an
  Opus session planning pass N should actually re-read the current source rather than trust pass
  N-1's own target-tree/summary prose, and should say plainly when a pass turns up nothing real
  rather than manufacturing a finding to fill it.
- **A "code review"** — run once a phase (or a batch of phases) is otherwise complete, on request —
  means spawning **three Opus subagents in parallel**, each analyzing the current tree against one
  dimension: (1) overall architecture and structure, maintainability, clean code, and security;
  (2) functional correctness and business logic; (3) performance and resource efficiency. Each
  agent only reports findings — it does not fix anything. The orchestrating session then spawns a
  Sonnet subagent to fix every finding — one sequential subagent by default, since findings usually
  land in overlapping files, and parallel subagents only for a batch of findings genuinely isolated
  from each other. Once every finding from that round is fixed, **repeat the whole three-agent
  cycle again** — a fresh round against the now-changed tree, not a one-shot — for as many rounds
  as asked for; this is the same "multiple passes" rule two bullets up, applied to review instead
  of implementation. A round that turns up nothing real should say so plainly rather than
  manufacture a finding to fill it. No findings document survives a round once it's fixed — each
  finding is fixed and committed one at a time, so the commit log is the durable record; carry
  forward only a genuinely still-open item (see "Known open items" below), never a running
  narrative of what each round found.
- No per-phase PRs. One feature branch for all of v1.
- **Best practices throughout, no shortcuts** — no stubbed error handling, no `TODO: fix later`,
  no skipped validation to make something demo. Scope left out of a phase is left out entirely,
  not half-implemented.
- **Comments: very concise, and only where truly necessary.** Add one only when the code cannot
  say it for itself — a non-obvious *why*, a constraint, a workaround. Never restate what the code
  already shows.
- **Unit tests exist only for advanced, complex or deeply nested logic — and this app has very
  little of that.** The default answer for a new piece of code is *no dedicated unit test at all*.
  A test earns its keep only when it guards something genuinely hard to get right: a parser or
  splitter with several interacting lexical rules, cursor/pagination arithmetic with real boundary
  cases, cache eviction/invalidation with rules that interact, crypto beyond
  encrypt-then-decrypt (tampering, corruption, key handling), concurrency — ordering, backpressure,
  cancellation, races — or a decision structure large enough that no one can hold it in their head.
  Keep a test outside those categories only when it is the one thing standing between "ships
  broken" and "caught before merge" for a subtle rule, and say which rule in a comment above it.
  Everything else gets nothing: CRUD round-trips (a database round-trip is plumbing, not logic,
  even when it's integration-shaped), one- or two-condition validation, required-field and enum
  guards, thin wrappers that forward a call unchanged, constructors and struct-literal builders,
  serialize-then-deserialize round-trips with no format-specific edge case, single bad-input →
  single-error paths, and anything that mostly restates what a short function body already says.
  A branch is not complexity — a single `if` guarding one obvious case is exactly the kind of
  thing a type system and a guard clause already make hard to get wrong. When torn between two
  similar tests, delete. This applies going forward to new code, not only as a cleanup of what's
  already there.
- **The adapter conformance suites are exempt from that bar, not an application of it.**
  `apps/kira-studio/internal/adapters/{postgres,mysqlfamily,sqlite,clickhouse}/*_test.go` are the
  sole successors to the deleted `packages/db-fixtures/*.spec.ts` files, and nothing else exercises a Go adapter
  capability by capability — `apps/kira-studio/tests/e2e-real/` only spot-checks a scenario or two
  per kind. Keep
  per-capability coverage there even where it reads like a CRUD round-trip; prune only genuine
  duplication (a case another subtest in the same file already asserts, a pass-through of shared
  `adapters/` logic that has its own test, a setup-only case with no assertion).
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)** —
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc., with a `!` or `BREAKING CHANGE:`
  footer for breaking changes.
- **Keep this file lean — prune as you go, don't just append.** A fact about the app itself (why a
  driver behaves a certain way, a protocol quirk, a design decision) belongs in
  `docs/ARCHITECTURE.md`. A discovery, bug, or result from finishing one specific phase or review
  round belongs in that phase's own plan doc under `docs/v1.1/plans/` (or `docs/v1/plans/` for v1
  history) — never bolted onto this file as a permanent "findings" section; the plan doc and the
  commit log are the durable record of what a phase found and fixed, not AGENTS.md. Before adding
  a bullet here, ask whether it's a standing rule for how this team works or how to run things in
  this sandbox — if it's a one-off result from finishing a task, it goes elsewhere or nowhere. When
  you do touch this file, also remove anything that's gone stale: a workaround for a tool that's
  since been fixed, a pointer to a file or subsystem that no longer exists, an open question a
  later phase already resolved. A short "Known open items" list (below) is the one exception —
  keep it, but only while each item is genuinely still open, and delete an item the moment it's
  resolved rather than marking it done in place.

## Known open items

- **Two CI workflow bumps are staged, not live**, both for the same reason: this session's GitHub
  push access lacks the `workflow` OAuth scope, which GitHub requires for any commit touching
  `.github/workflows/*.yml`. Apply each once a session's push access carries that scope — see the
  README beside each for the exact move.
  - `docs/v1.1/plans/p16-pending-ci-workflow/db-compat.yml` — P16's finished `workflow_dispatch`-only
    workflow for the on-demand DB compatibility suite (`docs/v1.1/plans/P16-db-compat-suite.md`). The
    suite itself (`scripts/db-compat.sh`) works today and needs no CI wiring to run by hand.
  - `docs/v1.1/plans/p19-pending-ci-workflow/{ci,release}.yml` — P19's GitHub Actions major-version
    bump (`actions/checkout`, `actions/setup-go`, `actions/upload-artifact` to `@v7`) applied to the
    two live workflows.

## Docker (for `packages/db-fixtures/`'s container fixtures, used directly by `apps/kira-studio/tests/e2e-real/`)

- **Claude Code on the web's Linux containers**: the `docker` CLI is preinstalled but the daemon
  isn't running, and there's no systemd (`PID 1` isn't systemd), so `systemctl start docker` does
  nothing. Start it directly, as root: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown`, then give
  it a few seconds and check `docker info` / `/tmp/dockerd.log` for `"API listen on
  /var/run/docker.sock"`. Once per fresh container/session — it doesn't persist.
- **The other dev environment (macOS) uses Colima** — `colima start`. Don't use the
  `dockerd`-directly approach there, and don't assume systemd either way.
- **Docker Hub blob downloads are blocked here.** `production.cloudfront.docker.com` — the CDN every
  Hub blob download redirects to — 403s through the outbound proxy, as does `quay.io`, so a direct
  pull resolves the manifest and then can never fetch a layer. **`mirror.gcr.io` (Google's
  read-through cache of Docker Hub) is not blocked.** `packages/db-fixtures/support/*.ts` hardcode plain Hub
  names (`mariadb:11.4`, `clickhouse/clickhouse-server:26.3`, …), so pull the mirrored name once per
  session and re-tag it locally rather than editing any source file:
  ```
  docker pull mirror.gcr.io/library/mariadb:11.4   # official (unnamespaced) image: needs library/
  docker tag mirror.gcr.io/library/mariadb:11.4 mariadb:11.4
  docker pull mirror.gcr.io/confluentinc/cp-kafka:8.0.7   # already namespaced: no library/ prefix
  docker tag mirror.gcr.io/confluentinc/cp-kafka:8.0.7 confluentinc/cp-kafka:8.0.7
  ```
  The rule: a Docker Hub *official* image (no namespace in its plain name — `mariadb`, `mysql`,
  `postgres`, `redis`, `mongo`) lives under `library/` on the real registry, so the
  mirror path needs that prefix; an image that already carries its own namespace
  (`clickhouse/clickhouse-server`, `confluentinc/cp-kafka`, `localstack/localstack`) mirrors at the
  same path with no `library/` inserted. Confirmed for every image this repo uses. ClickHouse needs
  one further workaround on top of the retag — see the ClickHouse section below.
- **Bun's `testcontainers` integration hangs indefinitely in this sandbox** on images that pull and
  run fine under plain Node with the identical image (confirmed fine on a real machine — a Bun-here
  quirk, not a real bug). Postgres is a confirmed instance: `@testcontainers/postgresql`'s default
  wait strategy passes its healthcheck and then `.start()` never resolves under `bun run`, while the
  identical container/strategy/image resolves in ~2s under plain Node. The workaround
  `apps/kira-studio/tests/e2e-real/` itself uses (`support/postgres.ts`, `support/mariadb.ts`):
  invoke Playwright via its plain Node CLI entrypoint (`node node_modules/.bin/playwright test
  --project=e2e-real`), never `bunx playwright test`, so `packages/db-fixtures/support/{postgres,mariadb}.ts`'s
  container start runs under real Node from the first line. **As of P58f M10 there is no vendored
  Node runtime to bundle a script against any more** — the old workaround for a *standalone* script
  needing a container from Bun (esbuild-bundle it, run it under `apps/kira-studio/runtime/node/bin/node`, the
  way the now-deleted `scripts/run-ipc-backend.sh` did) no longer applies, because that runtime is
  gone. `scripts/capture-postgres-tree.ts` and `scripts/capture-tree.ts` — the manual tools built on
  that workaround, for capturing a real shape into a `tests/ui/` fixture ("capture, don't
  hand-write", P50 D5) — are deleted with it (P58f D15), and their replacement, a one-off-capture
  mode in `apps/kira-studio/internal/ipcfixture`'s Go generator, has not actually been built: only
  the six committed per-adapter fixture generators exist (see `apps/kira-studio/tests/ipc/` below).
  Capturing a genuinely new `tests/ui/` shape today needs that one-off mode written first — there is
  no drop-in tool for it right now.

## `apps/kira-studio/tests/ipc/` — building and testing in this environment (P50, updated P57, backend moved to Go P58f)

See `docs/ARCHITECTURE.md`'s Testing section for what this tier is and why its fixture is generated
rather than hand-written. This section is only about running it here.

- **Neither half needs `xvfb`** — P57 removed Electron, so no `_electron.launch()`-style native
  window is left anywhere in the repo. The frontend half (`bun run test:ipc:fe`) drives Playwright's
  headless Chromium against a static file server, the same way `tests/ui/` does.
- **The backend half is Go now, not a bundled TypeScript spec (P58f D13)** — there is no
  `*.backend.spec.ts` file, no esbuild bundling step, and no vendored Node runtime involved at all.
  `apps/kira-studio/internal/ipcfixture`'s per-adapter Go test (`clickhouse_test.go`, `kafka_test.go`,
  `mariadb_test.go`, `mysql_test.go`, `redis_test.go`, `sqs_test.go` — postgres and sqlite generate no
  fixture of their own, see `docs/ARCHITECTURE.md`) drives the real `adapterhost`/`adapters` stack
  against a real container and writes `apps/kira-studio/tests/ipc/<adapter>/<adapter>.fixture.ts`.
- **Regenerating a fixture**: `KIRA_IPC_FIXTURES=write go test ./apps/kira-studio/internal/ipcfixture/...`
  writes each `<adapter>.fixture.ts` via `write.go`'s `mustMarshalNoEscape` (Go's `encoding/json`
  escapes HTML and sorts map keys by default, so the generator uses `SetEscapeHTML(false)` and typed
  structs, never maps); run `bunx biome check --write` on the written file afterward before
  committing — formatting only, the content doesn't change.
- **All six adapters' fixture generators run for real here** against containers pulled via
  `mirror.gcr.io`. ClickHouse needed no extra work this time, unlike the old TypeScript tier:
  `testcontainers-go/modules/clickhouse` does not hardcode a restrictive `Ulimits` the way
  `@testcontainers/clickhouse` did, so the JS tier's `NoUlimitClickHouseContainer` workaround (see the
  ClickHouse section below) has no Go counterpart because nothing here needs one. Kafka's capture has
  one quirk of its own: a read fans across both partitions and interleaves by arrival, not by
  key/offset, so the fixture sorts the captured page by key, and the consumer group's coordinator
  host:port is frozen the same way ClickHouse's `.inner_id.<uuid>` is.
- **There is no one-off capture mode yet** (P58f D15's own gap — see the Docker section above):
  `KIRA_IPC_FIXTURES=write` only regenerates the six fixtures already committed under
  `apps/kira-studio/tests/ipc/`. Capturing a fresh shape for a new `tests/ui/` fixture needs that
  mode written first.

## ClickHouse — testing in this environment (P36, its workaround resolved P58f)

See `docs/ARCHITECTURE.md`'s ClickHouse section for the adapter's own design facts.

- **Historical, kept for the reasoning, not because the workaround still exists.** The old JS tier's
  `@testcontainers/clickhouse` constructor hardcoded `.withUlimits({nofile: {hard: 262144, soft:
  262144}})`, and this sandbox's own `ulimit -Hn` is fixed at 20000 and cannot be raised even as
  root (a plain `docker run` with no custom ulimits works fine), so a stock container never came up
  here. The fix was a small subclass clearing `this.hostConfig.Ulimits = []` —
  `tests/ipc/clickhouse/container.ts`'s `NoUlimitClickHouseContainer` — since `hostConfig` was
  `protected` on testcontainers' `GenericContainer`. **Both that file and `packages/db-fixtures/support/
  clickhouse.ts` are deleted as of P58f M10**, and
  `apps/kira-studio/internal/adapters/testsupport/clickhouse.go` (the sole surviving ClickHouse
  container fixture, used by both `apps/kira-studio/internal/adapters/clickhouse` and
  `apps/kira-studio/internal/ipcfixture`) needs no equivalent at all: `testcontainers-go/modules/clickhouse`
  does not hardcode a restrictive `Ulimits`, so this sandbox's own `ulimit -Hn` ceiling never becomes
  a problem on the Go side. If a future container image or module version reintroduces a similar
  ceiling, `testcontainers-go`'s own `WithHostConfigModifier` on the generic container option is the
  Go analogue of the deleted JS subclass.

## SQLite — testing in this environment (P35)

- **`packages/db-fixtures/sqlite.spec.ts` is gone (P58f M10, D1)** — its coverage lives in
  `apps/kira-studio/internal/adapters/sqlite/*_test.go` now, run by `bun run test:go`, no Docker
  either: `modernc.org/sqlite` (pure Go, no cgo) against a real `t.TempDir()` file.
  `packages/db-fixtures/support/sqlite.ts` survives regardless, since
  `apps/kira-studio/tests/e2e-real/` still reads it directly.
- **`apps/kira-studio/tests/e2e-real/sqlite-real.spec.ts` runs unconditionally**, Docker-free by
  design — a real `-tags server` Go binary, every adapter served in-process (no separate engine
  child as of P58f M10), and a real temp-file database driven by a plain Playwright tab. Its only
  prerequisites are `scripts/setup.sh` (pinned `wails3` + generated bindings) and `bun run build`
  (the frontend bundle `apps/kira-studio/main.go`'s `//go:embed` picks up) — both memoized per
  worker process by `apps/kira-studio/tests/e2e-real/fixtures.ts`'s `buildPrerequisites()`, which
  also runs the one step that script doesn't: `go build -tags server`.

## Secrets / `KIRA_INSECURE_SECRETS` (P25, moved to Go in P52/P57)

See `docs/ARCHITECTURE.md`'s Storage section for the cipher, the key and the envelope. Here:

- **There is no Linux keychain backend at all** (no `gnome-keyring`/`kwallet` probing), so on Claude
  Code's Linux web containers and any other Linux dev machine set `KIRA_INSECURE_SECRETS=1` before
  launching the app (`bun run dev`, the Go binary directly, or `t.Setenv("KIRA_INSECURE_SECRETS",
  "1")` in a Go test) to opt into the Linux-only development fallback. `apps/kira-studio/tests/e2e-real/`'s
  fixture sets it for every real-backend test.
- Without it, Linux resolves to secret storage being **unavailable** — a password-bearing save fails
  visibly rather than silently falling back to plaintext. Deliberate, not a bug to work around.
- **On macOS the variable is ignored outright** — the real Keychain is used and this can never
  weaken it, even if the variable is accidentally left set. `apps/kira-studio/tests/ui/secrets.spec.ts`'s
  "keychain available" scenario is the guard that this stays true.

## Wails v3 / Go — building and testing in this environment (P51, P52, P55)

- **None of this toolchain persists across sessions.** Re-run at the start of any fresh container:
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` (the `wails3` CLI's own Linux
  build needs GTK4 + WebKitGTK headers even though the product targets macOS; without them
  `go install` fails at `internal/operatingsystem` with a `pkg-config` error naming
  `gtk4`/`webkitgtk-6.0`), then `go install github.com/wailsapp/wails/v3/cmd/wails3@<the version
  go.mod pins>` and `export PATH=$PATH:$(go env GOPATH)/bin`. **Pin that version — never
  `@latest`**, which once resolved a beta ahead of `go.mod` and silently skewed the bindings
  generator against the runtime library. **Pin `GOTOOLCHAIN` to `go.mod`'s own `go` directive for
  that install too** (`GOTOOLCHAIN=go<directive> go install …`) — `auto` resolves the toolchain
  from the *target module's* own floor (Wails', not this repo's), which silently degraded the
  bindings generator's type-checker into emitting 52 spurious "requires newer Go version" warnings
  on this exact repo before it was pinned; `scripts/setup.sh` does this automatically.
- **`wails.io`/`v3.wails.io` are 403-blocked** — on real macOS hardware too, so this is
  organizational proxy policy, not a sandbox artifact, and the official docs cannot be read from any
  box here. `proxy.golang.org` is reachable, which is all the Go toolchain needs — as of P58f M10
  there is no vendored Node runtime left to fetch from `nodejs.org` either. **Read the installed
  module source under `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@<version>/` instead of
  the docs site** — it is the real source for the exact pinned version, and it is how several
  findings below were confirmed rather than assumed.
- **`go test ./apps/kira-studio/internal/...` / `go build ./apps/kira-studio/internal/...` need
  nothing but the Go toolchain** — the product's own Go code is entirely cgo-free
  (`modernc.org/sqlite`, pure Go, for both the sqlite adapter and the app's own storage). Only the
  `apps/kira-studio` `main` package imports Wails and therefore needs the GTK/WebKit headers, so
  prefer `./apps/kira-studio/internal/...` for a fast loop.
- **Regenerate bindings with the exact flags `apps/kira-studio/build/Taskfile.yml`'s
  `generate:bindings` task uses — `wails3 generate bindings -clean=true -b -names -ts -i` (run from
  `apps/kira-studio/`) — never a shorter hand-typed version; prefer `wails3 task
  common:generate:bindings` (or `scripts/setup.sh`, which calls it) so the flags are never retyped
  at all.** `apps/kira-studio/frontend/bindings/**` are real Vite import targets, so missing ones fail
  the build with an unresolvable import rather than a stale-bindings surprise; regenerate whenever a
  bridge service's method set changes, and before any frontend build. **`-names` is load-bearing, not
  cosmetic**: without it, every generated call site emits `$Call.ByID(<numeric-id>, ...)` instead of
  `$Call.ByName("<pkg>.<Service>.<Method>", ...)`, and `tests/ui/support/mockRuntime.ts`'s whole
  request-interception layer is keyed on the `ByName` string FQN (`CHANNEL_TO_FQN`) — a `-names`-less
  regeneration silently breaks every `tests/ui/` spec at the very first bound call of the boot
  sequence (`layoutGetAll`), which surfaces as `page.waitForSelector('[data-testid="status-bar"]')`
  timing out with a page-level `Error: no CHANNEL_TO_FQN entry for undefined` — nothing about the
  failure points at bindings at all, so this is easy to lose an hour to before checking the call
  shape a fresh `generate bindings` run actually produced.
- **A first `wails3 task dev` build takes ~60s** (native compile, icon/binding generation, Vite cold
  start). Giving up after 15-25s looks exactly like a sandbox limitation and isn't.
- **A background process started in one shell invocation cannot be signalled from a later, separate
  one** — it still shows up in the later call's `ps aux` (the process table is shared) but the signal
  doesn't land, leaving an unreapable zombie squatting on its port for the rest of the session. Do
  everything — start, poll, test, kill — inside **one** invocation, polling a log file or a port in a
  loop instead of a fixed `sleep`, and give the Bash tool a correspondingly long timeout. Relatedly,
  `export FOO=bar && long-command &` backgrounds the whole `&&` chain, so `FOO` never reaches the
  parent shell — put `export` on its own line.
- **This container's minimal init reaps slowly.** After killing a process group, its members can
  answer `kill(pid, 0)` as alive for a second or two: a reparented orphan becomes a zombie the moment
  it exits, and `kill(pid, 0)` succeeds against a zombie until something `wait()`s it.
  `internal/preconnect`'s and `internal/connections`' process-group-kill tests poll for `ESRCH` with
  a multi-second timeout for exactly this reason — don't tighten them based on a fast macOS run.
- **On Linux, `/wails/runtime` and `/wails/stream/*` are unreachable over plain HTTP from a desktop
  build**, dev or packaged: `pkg/application/linux_cgo.go` registers `wails://` as a custom URI
  scheme intercepted *inside* the native process, so `curl` or a plain browser tab can never
  exercise real bindings there. **The `//go:build server` platform is the way around it**
  (`go build -tags server`, zero source changes): it serves the whole bound-call surface and the
  data-plane stream over a real TCP listener with no webview and no scheme registration at all.
  That is the mechanism `tests/e2e-real/` is built on, and it is this repo's established substitute
  for GUI-driven boot proofs in a sandbox with no display — prefer it over `xvfb`/`xdotool`/
  screenshot techniques.
