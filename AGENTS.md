# Working agreement

Facts about the app itself — driver choices, protocol constraints, capability quirks and why —
live in `docs/ARCHITECTURE.md`, not here. This file is process and environment only: how this
team works, and how to run things in whichever box a session happens to be on.

**Opus plans, Sonnet implements.**

- The **main session runs on Sonnet**. It implements directly — it does not delegate
  implementation to subagents.
- Each phase (see `docs/v1/SPEC.md` §10 phasing table) gets an Opus-authored plan
  committed under `docs/v1/plans/` before any implementation starts. Produce this by spawning an
  **Opus subagent** (`Agent` tool, `model: "opus"`) whose job is only to write that plan; the
  main Sonnet session then implements it.
- If a phase's plan is missing from `docs/v1/plans/`, do not implement from the spec directly —
  get the Opus plan written and committed first.
- Do not spawn implementation subagents (Sonnet or otherwise) for the core sequential work.
  Phases build on each other, so the main session needs continuity of what was decided and why;
  a fresh subagent starts cold and has to re-derive that context, which is the expensive path.
  Subagents are fine for genuinely independent, parallelizable, or throwaway research (e.g.
  "how does the `pg` driver handle cancellation?") — not for writing the phase's code.
- **The loop per phase:** check for a plan → spawn an Opus subagent to write one if missing →
  Sonnet implements the whole phase. Phases are done one at a time, in order — do not parallelize
  or batch multiple phases together.
- **A phase asked for in multiple passes/iterations/rounds means repeat that whole loop that many
  times**, not run it once and call the extra passes optional. Each pass is its own
  Opus-research-then-Sonnet-fix cycle, in order, each one written and implemented against the
  *current* state of the tree (i.e. on top of everything the previous pass already landed) —
  never against the pre-phase state, and never batched into one plan up front. Give each pass's
  plan its own file under `docs/v1/plans/` (e.g. a phase's plan plus `-iter2`/`-iter3` suffixes) so
  the history of what each round found and fixed stays legible on its own. The point of more than
  one pass is that later rounds find what earlier rounds missed or newly created — an Opus session
  planning pass N should actually re-read the current source rather than trust pass N-1's own
  target-tree/summary prose, and should say plainly when a pass turns up nothing real rather than
  manufacturing a finding to fill it.
- **A "code review"** — run once a phase (or a batch of phases) is otherwise complete, on request —
  means spawning **three Opus subagents in parallel**, each analyzing the current tree against one
  dimension: (1) overall architecture and structure, maintainability, clean code, and security;
  (2) functional correctness and business logic; (3) performance and resource efficiency. Each
  agent only reports findings — it does not fix anything. The main Sonnet session then fixes every
  finding directly, the same "Opus plans/reviews, Sonnet implements" split as everywhere else in
  this file. Once every finding from that round is fixed, **repeat the whole three-agent cycle
  again** — a fresh round against the now-changed tree, not a one-shot — for as many rounds as
  asked for; this is the same "multiple passes" rule two bullets up, applied to review instead of
  implementation. A round that turns up nothing real should say so plainly rather than manufacture
  a finding to fill it.
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
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)** —
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc., with a `!` or `BREAKING CHANGE:`
  footer for breaking changes.

## Docker (for `tests/db/` testcontainers)

- **Claude Code on the web's Linux containers**: the `docker` CLI is preinstalled but the daemon
  isn't running — there's no systemd (`PID 1` isn't systemd), so `systemctl start docker` doesn't
  work. Start it directly instead, as root: `nohup dockerd > /tmp/dockerd.log 2>&1 & disown`, then
  give it a few seconds and check `docker info` / `/tmp/dockerd.log` for `"API listen on
  /var/run/docker.sock"`. This has to be done once per fresh container/session — it doesn't
  persist.
- **The other dev environment (macOS) uses Colima** instead — `colima start` brings up the Docker
  daemon there; don't try the `dockerd`-directly approach on that box, and don't assume systemd
  either way.
- **On Claude Code's Linux web containers specifically**, the outbound network policy blocks
  `production.cloudfront.docker.com` (403, gateway policy denial) — the CDN host Docker Hub
  redirects every blob download to. Direct Docker Hub pulls therefore resolve manifests fine but
  can never actually fetch an image's layers. `quay.io` is blocked the same way (403).
  **`mirror.gcr.io` (Google's public read-through cache of Docker Hub) is not blocked** and works
  from this sandbox (P50). None of `tests/db/support/*.ts`'s own `IMAGE` constants point at it —
  they hardcode the plain Docker Hub name (`mariadb:11.4`, `clickhouse/clickhouse-server:26.3`,
  etc.) — so the fix is to pull the mirrored name once per session and re-tag it locally to the
  plain name the code expects, not to edit any source file:
  ```
  docker pull mirror.gcr.io/library/mariadb:11.4   # official (unnamespaced) image: needs library/
  docker tag mirror.gcr.io/library/mariadb:11.4 mariadb:11.4
  docker pull mirror.gcr.io/confluentinc/cp-kafka:8.0.7   # already namespaced: no library/ prefix
  docker tag mirror.gcr.io/confluentinc/cp-kafka:8.0.7 confluentinc/cp-kafka:8.0.7
  ```
  The rule: a Docker Hub *official* image (no namespace in its plain name — `mariadb`, `mysql`,
  `postgres`, `redis`, `rabbitmq`, `mongo`) lives under `library/` on the actual registry, so the
  mirror path needs that prefix even though the plain name doesn't have it; an image that already
  carries its own namespace (`clickhouse/clickhouse-server`, `confluentinc/cp-kafka`,
  `localstack/localstack`) mirrors at that same path with no `library/` inserted. Confirmed
  working for every adapter this repo uses — mariadb, mysql, postgres, redis, rabbitmq, mongo (all
  via `library/`), and clickhouse, kafka, localstack (s3/sqs, no `library/`) — pulling `docker
  images` after the retag shows both the `mirror.gcr.io/...` and the plain-name tag pointing at the
  identical image id, so `tests/db/support/*.ts` finds the plain name it hardcodes with zero code
  changes. **ClickHouse** needs one more workaround on top of the retag above:
  `@testcontainers/clickhouse`'s constructor hardcodes `.withUlimits({nofile:
  {hard:262144, soft:262144}})`, and this sandbox's own `ulimit -Hn` is fixed at 20000 and cannot
  be raised even as root (confirmed: a plain `docker run` with no custom ulimits works fine
  standalone) — so a container started the stock way never comes up here. `hostConfig` is
  `protected` on testcontainers' own `GenericContainer`, so a small subclass that clears
  `this.hostConfig.Ulimits = []` in its constructor (only reachable from a subclass, never through
  `ClickHouseContainer`'s own public API) unblocks it; see `tests/ipc/clickhouse/container.ts`.
  **Kafka** — `confluentinc/cp-kafka` pulls fine via `mirror.gcr.io` too; see the Native Kafka
  driver section below for the separate, now-resolved ABI-rebuild blocker. Bun's own
  `testcontainers` integration has also been observed to hang indefinitely in this specific sandbox
  on images that pull and run fine under plain Node with the identical image — a sandbox quirk of
  the Bun runtime here, not a real bug (confirmed fine on a real machine).
  **Postgres, confirmed as a specific instance of that same Bun/testcontainers hang (P57)**:
  `@testcontainers/postgresql`'s default wait strategy is `Wait.forAll([forHealthCheck(),
  forListeningPorts()])`; under `bun run`, the container starts and its own healthcheck passes
  (confirmed via `docker logs`/`docker exec pg_isready`) but `.start()` never resolves — debug
  logging (`DEBUG=testcontainers*`) shows the very last line is ever `"Health check wait strategy
  complete"`, `forListeningPorts()`'s own completion log never appears, for minutes. The identical
  container/wait-strategy/image resolves in ~2s under plain `node
  --experimental-strip-types --experimental-transform-types` (a quick syntax check) or, matching
  how this repo already runs `tests/ipc/**/*.backend.spec.ts` (`scripts/run-ipc-backend.sh`), an
  esbuild `--bundle --platform=node --format=cjs` bundle run under the vendored
  `shell/runtime/node/bin/node` (needed anyway once a script imports anything with an extensionless
  relative import a bare Node ESM loader can't resolve, e.g. `tests/ipc/support/harness.ts`'s own
  dynamic `import('../../../src/engine/control')`). Bundling also needs `tests/db/fixtures/`
  copied beside the bundle output the same way `run-ipc-backend.sh` already does for the backend
  tier (`tests/db/support/postgres.ts`'s seed-SQL read is `__dirname`-relative, which becomes the
  bundle's own directory). `scripts/capture-postgres-tree.ts` is a manual capture tool built on
  this — real tree/data captures, originally for porting `tests/e2e/*.spec.ts` files into
  `tests/ui/` (P57 M5, now complete — `tests/e2e/` is deleted), still used for any future
  `tests/ui/` fixture that needs a real captured shape, following the same "capture, don't
  hand-write" discipline P50 D5 already
  established for `tests/ipc/**/*.fixture.ts`.

## `tests/ipc/` — building and testing in this environment (P50, updated P57)

See `docs/ARCHITECTURE.md`'s Testing section for what this tier is and why the fixture is
generated rather than hand-written. This section is only about running it here.

- **Neither half needs `xvfb` any more** (P57 removed Electron outright — there is no
  `_electron.launch()`-style native window anywhere left in the repo). The backend half
  (`scripts/run-ipc-backend.sh`) never opened a window even under Electron; the frontend half
  (`bun run test:ipc:fe`, i.e. `bun run build && playwright test --project=ipc-frontend`) drives
  Playwright's own headless Chromium against a static file server, the same way `tests/ui/` does —
  confirmed by running both tiers directly in this sandbox with no display server at all.
- **The backend half needs the vendored Node runtime** (`scripts/vendor-node.sh` →
  `shell/runtime/node/bin/node`), not Electron. `scripts/run-ipc-backend.sh` bundles each
  `tests/ipc/**/*.backend.spec.ts` (plus the harness's own Docker-free self-test) with esbuild —
  `--bundle --platform=node --format=cjs --loader:.sql=text
  --external:@confluentinc/kafka-javascript --external:ssh2 --external:cpu-features` — then runs
  the bundle under that vendored `node` directly, one process per spec file, sequentially (each
  file's container helper is a module-scope memo assuming one file per process). This is required
  rather than incidental: Bun cannot load some of the adapters this tier drives (sqlite needs
  `node:sqlite`, kafka needs the native-ABI driver — Native Kafka driver section below).
  `tests/db/support/*.ts`'s `.sql`-reading helpers resolve their seed file relative to `__dirname`,
  which is `out/tests/ipc/` once bundled, not `tests/db/fixtures/` — the script copies the fixtures
  directory beside the bundle output to fix this, rather than editing `tests/db/` itself.
- **Regenerating a fixture** (`KIRA_IPC_FIXTURES=write sh scripts/run-ipc-backend.sh`) writes each
  backend spec's own `<adapter>.fixture.ts` via raw `JSON.stringify` (quoted keys, `capture.ts`'s
  `writeFixtureModule`) — run `bunx biome check --write tests/ipc/<adapter>/<adapter>.fixture.ts`
  afterward to match the repo's own formatting convention before committing; the content does not
  change, only the quoting.
- **Which adapters' backend halves are Docker-gated here, and which needed extra work**: mariadb,
  mysql, redis, rabbitmq and sqs's backend specs all ran for real against containers pulled via
  `mirror.gcr.io` (Docker section above) in this sandbox, no extra workaround needed. **ClickHouse**
  needed its own container-start helper (`tests/ipc/clickhouse/container.ts`, the ulimit-clearing
  subclass described in the Docker section above) rather than reusing
  `tests/db/support/clickhouse.ts`'s own `startClickHouse()` — that file's `ClickHouseContainer`
  construction is private to its own `start()`, not exposed for subclassing, and P50's own D1
  forbids editing `tests/db/` — but once that workaround existed, its backend spec ran for real
  against a real container too, exactly like the other five. **Kafka** needed the native driver
  rebuilt first (Native Kafka driver section below) — once that was done, its backend spec ran
  for real too, with one adapter-specific finding of its own: a read fans across both partitions
  and interleaves them by arrival, not by key/offset order, so the fixture sorts the captured
  page by key before writing it (`tests/ipc/kafka/kafka.backend.spec.ts`'s `sortStreamByKey`,
  same reasoning as redis's own HSCAN-reordering finding above), and the consumer group's
  coordinator host:port (a fresh Docker-assigned hostname and host-mapped port every run) is
  frozen the same way ClickHouse's `.inner_id.<uuid>` is.

## Secrets / `KIRA_INSECURE_SECRETS` (P25, moved to Go in P52/P57)

- Credentials are encrypted by `shell/internal/secrets` (`cipher.go`/`status.go`) directly against
  the OS Keychain on macOS — no more Electron `safeStorage` in between. There is **no Linux
  Keychain backend at all** (no `gnome-keyring`/`kwallet` probing), so a bare Linux dev/CI
  container is unavailable by default, the same shape as before, just for a more direct reason.
- **On Claude Code's Linux web containers and any other Linux dev machine**: set
  `KIRA_INSECURE_SECRETS=1` before launching the app (`bun run dev`, the Wails/Go binary directly,
  or `t.Setenv("KIRA_INSECURE_SECRETS", "1")` in a Go test) to opt into a Linux-only development
  fallback — a hardcoded compile-time key (`insecureKeyMaterial`, `cipher.go`), the same honesty as
  Chromium's old `basic_text` obfuscation: obfuscation, not real encryption, deliberately not a
  file-backed keyring that would look more secure than it is (P52 §6.5). `tests/e2e-real/`'s own
  fixture sets this for every real-backend test by default.
- **On macOS**, this variable is ignored outright — the real Keychain is used and
  `KIRA_INSECURE_SECRETS` can never weaken it, even if accidentally left set in an environment.
  `tests/ui/secrets.spec.ts`'s "keychain available" scenario is the guard that this stays true.
- Without the variable, Linux resolves to secret storage being **unavailable** — a password-bearing
  save fails visibly rather than silently falling back to plaintext. This is deliberate (originally
  `docs/v1/plans/P25-credential-keychain-encryption.md` D13, unchanged by the Go port), not a bug
  to work around.
- **The envelope prefix changed to `kira:v2:`** (P52 §6.4) — the cipher itself genuinely changed
  (AES-256-GCM under the app's own key, not Chromium `safeStorage`'s AES-128-CBC), so a `kira:v1:`
  value from an old Electron-era install cannot and should not decrypt under the new code; there is
  no migration path, by design (P52 §5.1's fresh-database rule for this cutover). The Keychain
  *service name* itself, `"Kira Studio Safe Storage"`, deliberately did **not** change (P57 D12) —
  changing it would orphan every existing user's stored key, since the OS looks the item up by
  service name, not by app bundle identifier.

## Native Kafka driver — building and testing in this environment (P32, resolved P57)

See `docs/ARCHITECTURE.md`'s Kafka section for *why* (ABI-specific native addon, Bun can't load
it at all, no consumer-group join on browse). This section is only about running it here.

- **No ABI rebuild step exists or is needed any more.** Under Electron, this whole section used to
  be about rebuilding `@confluentinc/kafka-javascript`'s native addon against Electron's own ABI
  (`scripts/native-electron-build.sh`, deleted in P57) — real work, since Electron's Node-API ABI
  never matches whatever Node built the addon during `bun install`. Now that the engine (the only
  process that ever loads this addon) runs under a real, plain Node runtime
  (`shell/runtime/node/bin/node`, vendored by `scripts/vendor-node.sh`), the addon `bun install`
  built loads there **exactly as it landed on disk, with no rebuild step of any kind** — confirmed
  in P51 part 4 and reconfirmed by every Kafka-touching test in this repo (`tests/db/kafka.spec.ts`,
  `tests/ipc/kafka/kafka.backend.spec.ts`). If a future Node major version bump ever produces an
  ABI mismatch, the fix is an ordinary `bun rebuild`/`npm rebuild @confluentinc/kafka-javascript`
  against the vendored Node's own version — no `electron-rebuild`, no `CKJS_LINKING` dance, no
  Electron headers to fetch. The historical detail of *why* this used to be hard (the
  `artifacts.electronjs.org` header fetch, `zlib.net`/`curl.se` being proxy-blocked,
  `CKJS_LINKING=dynamic` as the workaround) is preserved in this file's P57 findings log below in
  case a genuinely new native-module build problem ever needs the same debugging playbook.

## SQLite adapter — testing in this environment (P35)

See `docs/ARCHITECTURE.md`'s SQLite section for what the adapter itself relies on
(`node:sqlite`, runtime version floor). This section is only about running it here.

- **`tests/db/sqlite.spec.ts` needs no Docker.** `tests/db/support/sqlite.ts` is a temp-file
  fixture (`mkdtemp` + `node:sqlite`), not a Testcontainers harness — there is no container to
  start, no image to pull, no daemon to reach. Its only environment dependency is `node:sqlite`
  itself, gated by `sqliteAvailable()` the same way every other DB spec here gates on
  `isDockerAvailable()`.
- **`tests/e2e-real/sqlite-real.spec.ts` runs unconditionally** (no Docker gate at all, Docker-free
  by design) — a real `-tags server` Go binary, a real embedded engine and a real temp-file SQLite
  database, driven by a plain Playwright browser tab (P57 §6/§8, replacing the old
  `tests/e2e/sqlite.spec.ts`, which is deleted). It needs the vendored Node runtime
  (`shell/runtime/node/bin/node`) and the built engine bundle (`bun run build:engine`) to exist
  first — the same two prerequisites `wails-dev-setup.sh` checks for.
- This sandbox's own Bun (1.3.x) lacks `node:sqlite`, so `bun test tests/db/sqlite.spec.ts` here
  reports the legible `SQLITE_UNAVAILABLE_MESSAGE` failure rather than actually running the
  suite — the same class of environment gap `tests/db:kafka` hits for a different reason above.
  The adapter itself is verified for real here regardless, via the vendored Node
  (`shell/runtime/node/bin/node`, not the system Node and not Electron) against a real temp-file
  database — both through `tests/e2e-real/sqlite-real.spec.ts` above and through
  `scripts/run-ipc-backend.sh`'s bundled backend specs.

## ClickHouse adapter — testing in this environment (P36)

See `docs/ARCHITECTURE.md`'s ClickHouse section for the adapter's own design facts (no
per-request `database` override, why `canUpdate`/`canDelete` are permanently false). This section
is only about running it here.

- **`tests/db/clickhouse.spec.ts` needs Docker** (`@testcontainers/clickhouse`, image
  `clickhouse/clickhouse-server`) — same `isDockerAvailable()` gate as every other Testcontainers
  spec. Direct Docker Hub pulls are blocked here (403 through the outbound proxy, Docker section
  above), but `mirror.gcr.io/clickhouse/clickhouse-server:26.3` pulls fine and can be re-tagged to
  the plain Docker Hub name the code hardcodes, with no code change needed for the pull itself.
  `@testcontainers/clickhouse`'s own hardcoded ulimit request is the separate blocker that actually
  stops a container from starting here — see the Docker section above and
  `tests/ipc/clickhouse/container.ts`'s `NoUlimitClickHouseContainer`.
- P50 split the old `tests/ui/clickhouse.spec.ts` into `tests/ipc/clickhouse/` (backend + frontend
  halves sharing one fixture, see `docs/ARCHITECTURE.md`'s Testing section) — both halves run for
  real in this sandbox now, the backend half against a real container started via the ulimit
  workaround above.

## RabbitMQ adapter — testing in this environment (P37)

See `docs/ARCHITECTURE.md`'s RabbitMQ section for the adapter's own design facts (no
dependency, the `-management` image requirement, the `%2F` vhost encoding, why `canUpdate`/
`canDelete` are permanently false, poll-requeues-not-consumes). This section is only about running
it here.

- **`tests/db/rabbitmq.spec.ts` needs Docker** (`@testcontainers/rabbitmq`, image
  `rabbitmq:4.3.5-management-alpine`) — same `isDockerAvailable()` gate as every other
  Testcontainers spec in this sandbox. `mirror.gcr.io/library/rabbitmq:4.3.5-management-alpine`
  pulls fine and re-tags to the plain Docker Hub name the code hardcodes (Docker section above),
  unlike direct Docker Hub (`403` through the outbound proxy).
- P50 split the old `tests/ui/rabbitmq.spec.ts` into `tests/ipc/rabbitmq/` (backend + frontend
  halves sharing one fixture, see `docs/ARCHITECTURE.md`'s Testing section) — both halves run for
  real in this sandbox now against a real container pulled the way above.

## Wails v3 / Go — building and testing in this environment (P51)

See `docs/v1/plans/P51-wails-go-node-engine-spike.md` and its `P51-spike-report-part{1,2,3,4}.md`
for the actual design findings. This section is only the reusable environment setup, so it doesn't
have to be re-derived next time.

- **On real macOS hardware, not just the Linux sandbox, `wails.io`/`v3.wails.io` are *also*
  403-blocked** (part 4) — this is this environment's organizational proxy policy, not a
  sandbox-specific artifact. `proxy.golang.org` and `nodejs.org` are both reachable from macOS too,
  which is all that's needed to install the toolchain and vendor a real Node runtime.
- **A native npm dependency's install script (`node-pre-gyp`, `node-gyp`, …) may silently not run**
  on a newer npm: it now default-denies install scripts per-package (`npm warn install-scripts …
  not yet covered by allowScripts`) until explicitly approved with
  `npm install-scripts approve <pkg>`. Hit this vendoring `@confluentinc/kafka-javascript` against a
  freshly-downloaded Node runtime in part 4 — the first `npm install` silently left
  `build/Release/*.node` missing because the postinstall (`node-pre-gyp install
  --fallback-to-build`) never ran. Approve, then re-run install (or `npm rebuild <pkg>`).
- **`wails.io` and `v3.wails.io` are egress-blocked in this sandbox** (403 at the CONNECT-tunnel
  stage, confirmed repeatedly) — the official docs cannot be read from here. **`proxy.golang.org` is
  not blocked**, so `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` works fine and pulls
  the whole module tree (including transitively vendored source under `$GOPATH/pkg/mod`, which is
  actually a *better* source than the docs site — it's the real, current source for whatever version
  just got installed). Go's own toolchain auto-upgrades if the module demands a newer one
  (`go1.24.7` → `go1.26.7` for `wails/v3@v3.0.0-beta.15`) — that happens automatically via
  `proxy.golang.org` too, no separate step needed.
- **The `wails3` CLI itself needs GTK4 + WebKitGTK dev headers to build on Linux**, even though the
  app being developed targets macOS — this is purely so the CLI's own Linux build (and any
  Linux-hosted `wails3 dev`) can embed a webview locally:
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config`. Without it, `go install` fails
  at `internal/operatingsystem` with a `pkg-config` error naming `gtk4`/`webkitgtk-6.0`. `wails3
  doctor` confirms a clean environment afterward.
- **`wails3 init` → `go mod tidy` → `wails3 generate bindings` → `npm run build` (frontend) →
  `go build`** all work end to end and produce a real running Linux/GTK4 binary — confirmed with a
  scaffolded `vanilla`-template project. Useful for validating the binding model or reading the
  installed `@wailsio/runtime` npm package's actual `dist/` output (truer than trusting a GitHub
  branch, since it's exactly what a real `npm install` would pull for that Wails version).
- **`wails3 task dev` genuinely works here, including the native window under `xvfb-run`** — but the
  *first* build takes about **60 seconds** (native compile, icon/binding generation, Vite cold
  start). Backgrounding it and giving up after 15–25s (a short `sleep` or a short `timeout N`) looks
  exactly like a sandbox limitation but isn't — it's just impatience. The pattern that works: start
  it backgrounded inside **one** shell invocation, poll a log file or the port in a loop instead of a
  fixed sleep, run the checks, then tear it down — all in that same invocation. Give the Bash tool a
  correspondingly long `timeout` (e.g. 120–150s) rather than relying on the tool's default.
- **A background process started in one shell invocation cannot be signaled (`kill`/`pkill`) from a
  later, separate invocation** — it still shows up in that later call's `ps aux` (the process table
  view is shared), but the signal doesn't land, so it survives as an unreapable zombie for the rest
  of the session. This isn't specific to Wails; it bit every attempt to start `wails3 dev` in one
  call and clean it up or re-check it from another. **Do everything — start, poll, test, and kill —
  inside one shell invocation**, never split across calls expecting to manage the same process later.
  A leftover `Xvfb`/`wails3 dev` process from a prior attempt squatting on a dev port is the usual
  symptom; picking a fresh port sidesteps it rather than fighting the zombie.
- **On Linux, `/wails/runtime` and `/wails/stream/*` are not reachable over plain HTTP, even from
  `wails3 dev`'s own dev server port** — confirmed with `curl`, reproducibly, on a clean port with no
  stale-process contamination. `pkg/application/linux_cgo.go`
  (`webkit_web_context_register_uri_scheme`, registering `wails://`) is why: WebKitGTK loads the app
  through a custom URI scheme intercepted **inside** the native process, not a real TCP listener. The
  dev server's `devServerURL` is an upstream the Go process itself fetches Vite content from
  internally — it is not the address the webview's own runtime/stream calls travel over. **`curl` or
  a plain browser tab can never exercise real Wails bindings this way**, on this platform — only an
  actual `wails://`-registered webview can. (Not yet checked whether macOS's WKWebView transport
  works the same way — the scheme-registration code is platform-specific, so this is Linux-confirmed
  only, not assumed to generalize.)
  **Correction (P57, `docs/v1/plans/P57-e2e-revisit.md`): that is true of a *desktop* build (dev or
  packaged) — it does not generalize to Wails itself.** `pkg/application/application_server.go`'s
  `//go:build server` platform (`go build -tags server`, zero source changes needed) serves the
  entire bound-call surface and the data-plane stream over a real TCP listener with no webview and
  no scheme registration at all — `linux_cgo.go`'s interception is compiled out under that tag.
  Verified: a plain Playwright chromium tab against a `-tags server` binary drove a real SQLite file
  and a real Postgres container through the real Go bridge. This is the mechanism
  `tests/e2e-real/` is built on.

**P52 implementation findings, worth keeping for P53+:**

- **A fresh container has none of the P51 toolchain installed — it does not persist across
  sessions.** `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` and
  `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` (via `export
  PATH=$PATH:$(go env GOPATH)/bin`) both have to be re-run at the start of any new session before
  `wails3` is on `PATH`.
- **`wails3 init -n "<Name With Spaces>" -d <dir>` creates `<dir>/<Sanitized_Name>/`, not
  `<dir>/` itself** — the project lands one directory deeper than expected. Flatten it
  (`mv <dir>/<Sanitized_Name>/* <dir>/ && rmdir ...`) rather than fighting the flag for an exact
  target directory.
- **The vanilla scaffold's `build/ios/` and `build/android/` ship a `package main` with no
  `func main()` on non-mobile build tags** (the real `func main()` only exists behind `//go:build
  ios`) — `go build ./...` fails on `build/ios` with "function main is undeclared" unless those
  directories are removed (and their Taskfile.yml `includes:` entries dropped) for a macOS/Linux-only
  product.
- **`sql.Open("sqlite3", path)` (mattn/go-sqlite3) is lazy** — the database file does not exist on
  disk until the first real query. `os.Chmod(path, 0o600)` right after `sql.Open` fails with "no
  such file or directory"; the four startup pragmas (which force the first real connection) must
  run before the chmod, not after.
- **Injecting a build-time-only `<script>` into `src/renderer/index.html` without editing that
  file** (needed so a Wails-specific bootstrap shim can exist without touching `src/`, which
  Electron's build must never see): a `transformIndexHtml` hook that returns an inline
  `<script type="module">import '@bare-specifier';</script>` tag is silently NOT bundled by
  Vite/Rollup — inline module scripts injected this way stay as literal unresolved text in the
  output HTML. The fix is to register the shim as its own `rollupOptions.input` entry, then use
  `transformIndexHtml`'s `order: 'post'` hook (which receives `ctx.bundle`) to find that entry's
  actual emitted chunk and inject a real `<script type="module" src="./assets/<hashed-name>.js">`
  tag pointing at it.
- **A CSP `script-src 'self'` (already present in `src/renderer/index.html` for the Electron
  build) blocks any inline `<script>` with no `src`**, silently — no catchable JS error, just
  nothing runs. This bit both the shim-injection approach above (fixed by giving it a real `src`)
  and an attempted inline window-error-handler diagnostic (fixed by moving it to its own file
  under `frontend/dist/assets/` and referencing it with a plain `<script src="...">`, still
  same-origin so still allowed under `'self'`).
- **`wails3 generate bindings -b` imports `/wails/runtime.js` in every generated file** (`-b` =
  "use the bundled runtime instead of the npm package") — that path is resolved by Wails' own
  asset server inside a real webview, not an npm package. Vite must be told
  `build.rollupOptions.external: [/^\/wails\//]` or it fails trying to resolve it at build time.
- **On Linux, `go:embed` a static "blank" test page separately from the real frontend
  (`//go:embed blank/index.html`) and switch `AssetOptions.Handler` on an env var** is a cheap way
  to build gate G1's two required configurations (P52 §3.2) without two separate binaries — use
  `fs.Sub(embeddedFS, "blank")` so the page serves at `/`, not `/blank/`.
- **Screenshotting a headless WebKitGTK window is a genuinely useful boot-smoke-test technique in
  this sandbox**: `apt-get install -y xdotool imagemagick`, then `xdotool search --name
  "<window title>"` to get the window id and `import -window <id> out.png` to capture it. Reading
  the PNG back distinguishes "the real app rendered" from "blank page because JS threw before
  `mount()`" in a way `ps`/log output cannot — there is no devtools/remote-debugging story in this
  sandbox, so this is the practical substitute.
- **On Linux, WebKitGTK's `WebKitNetworkProcess`/`WebKitWebProcess` genuinely are children of the
  embedding Go process** (confirmed via `ps --forest`) — unlike WKWebView's helper processes on
  macOS, which P52 §3.3 already documents as *not* being children. `WebKitWebProcess` itself is
  additionally wrapped through two `bwrap` (bubblewrap) re-exec hops first; both have trivial RSS
  (1-2 MB) but a process-set match rule that doesn't account for them undercounts. A **measured,
  reproducible finding, not yet a G1 verdict**: on this platform, `WebKitWebProcess` alone
  (~250-320 MB for a real Vue app) is heavy enough that this build's total RSS (~620-690 MB, see
  `docs/PERF.md` §2.3) lands at-or-above Electron's own 620-626 MB baseline rather than under it —
  the opposite of the hoped-for saving. This is Linux/WebKitGTK-specific and explicitly must not be
  read as an answer for macOS/WKWebView, which is a structurally different (shared-framework, not
  a bundled library) webview implementation; §2.3 records why this sandbox cannot produce G1's
  actual verdict.
- **Exporting an env var and immediately backgrounding the same compound command with `&&
  ... &` backgrounds the export too** — `export FOO=bar && some-command &` runs the whole `&&`
  chain as one background job, so `FOO` never reaches the parent shell's environment and every
  later foreach/foreground command in the same script sees it unset. Put `export` statements on
  their own line before the line that backgrounds the long-running command.

**P53 implementation findings, worth keeping for P54+:**

- **`go test ./internal/...` and `go build ./internal/...` need nothing but the Go toolchain** —
  `mattn/go-sqlite3` is cgo but links only the SQLite amalgamation, no GTK/WebKit. A bare
  `go build .`/`go test ./...` additionally compiles the root `main` package, which imports Wails
  and does need `libgtk-4-dev`/`libwebkitgtk-6.0-dev`/`pkg-config` (already present in this
  session's container, but not guaranteed in a fresh one — see the P52 finding above on
  `apt-get install`). Prefer `./internal/...` for a fast storage-only test loop; it never needs
  the GTK/WebKit dev headers at all.
- **`wails3` and `wails3 generate bindings` are needed before `bun run build:wails` will build**,
  not only before `go run .` — the generated `frontend/bindings/**/*.js` files are real Vite
  import targets (`shell/frontend/shim/kira-bridge.ts` imports them directly), so a Vite build
  fails with an unresolvable-import error, not a silently-stale-bindings one, if they're missing.
  Regenerate with `wails3 generate bindings -b -i -ts` from `shell/` any time a bridge service's
  method set changes, before the next `bun run build:wails`.
- **Repo constructors take a bare `*sql.DB` and an optional prepared statement** (e.g.
  `SettingsRepo{DB: db, selectAll: stmt}`), never a `*Repos`-only path — `selectAll`/`insert`/
  `update` being `nil` falls back to an ad-hoc query with identical SQL. This is what lets tests
  construct a repo directly (`&repos.SettingsRepo{DB: db}`) without going through `repos.New`,
  while `repos.New` (P52 §5.4's five prepared statements: settings/layout/tabs select-all,
  op-log insert/update) is still the only production path.

**P54 implementation findings, worth keeping for P55+:**

- **Under the stdio transport, stdout is the frame channel, not a log sink — `console` must be
  repointed before anything else runs.** `src/engine/control.ts`'s `AdapterDeps.log` and
  `cache/lru.ts`'s cache-refusal warning both call `console.log`/`console.warn`/`console.error`
  directly; under Electron's `parentPort` transport this was harmless (merely logged by
  `engine-host.ts`), but under stdio a stray `console.log` writes raw text into the exact byte
  stream `shell/internal/enginehost`'s length-prefixed reader is parsing, desynchronising it.
  `src/engine/stdio-main.ts` fixes this with one line, `globalThis.console = new Console({stdout:
  process.stderr, stderr: process.stderr})`, before reading a single byte of stdin — confirmed
  against real `src/engine` module code, not just `index.ts`'s own `electron` import, which is
  the only coupling P52 §4.4 had checked for.
- **`application.StreamConn.Send` blocks; `TrySend` is the non-blocking, `ErrStreamFull`-returning
  variant** — P52 §7.2 has this backwards (it credits `Send` with the `ErrStreamFull` behaviour).
  Confirmed by reading `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.15/
  pkg/application/stream.go` directly (`wails.io`/`v3.wails.io` are 403-blocked from this
  environment, so the module cache is the only source). Also worth knowing from the same file:
  per-connection bounds are 8 MiB **and** 256 frames, and any single frame over 64 MiB
  (`streamMaxFrameBytes`) is rejected outright — a real, new ceiling this migration introduces
  that Electron's structured clone never had (`internal/enginehost/stream.go`'s
  `maxDataFrameBytes` enforces the same limit Go-side, dropping an oversized frame with a named
  log line rather than corrupting the stream).
- **The three real concurrency bugs found in P52 M1's `enginehost/host.go` walking skeleton**,
  fixed in P54 and worth naming so nobody re-introduces them: (1) `writeFrame` held the same mutex
  the read loop needs to deliver a response, across a blocking `stdin.Write` — a full pipe
  deadlocked the whole host; fixed with a separate `writeMu` guarding stdin only. (2) `cmd.Wait()`
  ran concurrently with the stdout reader, which `os/exec`'s own `StdoutPipe` doc calls incorrect
  (`Wait` closes the pipe once it sees the process exit, racing an in-flight read); fixed with
  `readDone`/`stderrDone` channels awaited before `Wait()`. (3) `Events()` returned a fresh
  channel per call but every one of them ranged over the *same* underlying channel, so two
  subscribers split events between them rather than both receiving every one; fixed with a real
  per-subscriber channel registry (`Subscribe()`/`Event`/`EventEngineDown`).
- **`ENGINE_OP.configureCache`'s wire string is `'cache:configure'`**, not a name like
  `'engine:configure-cache'` guessed by an earlier plan draft before the actual protocol file was
  read — always grep `src/shared/protocol/engine-ops.ts` for the literal rather than inferring an
  op name from its TS identifier.
- **A bundled `src/engine` via `bun run build:engine` (esbuild, `--format=cjs`,
  `--alias:@shared=./src/shared`, the same `--external:` list `scripts/run-ipc-backend.sh` uses)
  runs correctly under a bare `node` with no Electron at all** — confirmed end-to-end against the
  real bundle (`shell/internal/enginehost/stdio_main_integration_test.go`, opt-in and skipped
  when the bundle is absent): both the control and data channels dispatch correctly, unknown ops
  on both channels return `E_UNSUPPORTED`, and no stray bytes reach stdout. This is real
  confirmation that `src/engine`'s only genuine Electron coupling was the two spots named above,
  not a load-bearing dependency on the Electron runtime itself.

**P55 implementation findings, worth keeping for P56+:**

- **Install `wails3` pinned to the exact `go.mod` version, not `@latest`.**
  `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` resolved to `v3.0.0-beta.16` in this
  session while `shell/go.mod` pins `v3.0.0-beta.15` — a silent version skew between the bindings
  generator and the runtime library that could generate a call-ID scheme or wrapper shape the
  vendored runtime doesn't actually match. Use `@v3.0.0-beta.15` (or whatever `go.mod` currently
  pins) explicitly.
- **`main.go`'s `resolveEngine()` still points at the P52 walking-skeleton's
  `testdata/engine-ping.mjs`, not the real bundled `src/engine` (`shell/runtime/engine/engine.cjs`,
  built by `bun run build:engine` and already proven correct end-to-end by P54's own
  `stdio_main_integration_test.go`).** Switching the running app over to the real engine was never
  in P55's scope (§0 lists no `src/`/engine-wiring change) and is still open — don't assume
  `connections.Connect()` et al. talk to a real adapter in the packaged app yet; they talk to the
  ping fixture until whichever later phase (cutover, most likely) flips `resolveEngine()` over.
- **Comparing a struct containing an `any` field (or anything holding a `map`/slice) with `==`/`!=`
  panics at runtime** ("comparing uncomparable type") rather than failing to compile — Go only
  catches this statically when the field's *static* type is already uncomparable, not when it's
  `any` holding a `map[string]interface{}` at runtime (e.g. `model.ConnectionState.Caps`, decoded
  from JSON). Use `go-cmp` (already a dependency) or `reflect.DeepEqual` for any struct with a wire
  `any`/`json.RawMessage`-derived field, never `==`.
- **`internal/enginetest`'s shared fixture (`testdata/engine-fixture.mjs`) grew three test-only ops
  beyond P55's own plan table**, each solving a real determinism problem rather than being
  speculative: `fixture:release-slow` (answers every pending `slow-` `adapter:connect` on demand —
  without it, testing the in-flight-connect dedupe would mean actually waiting out a real 20s
  timeout); `fixture:request-count` (an op-name → call-count map, for asserting "exactly one engine
  call" or "no engine call on a cache hit" without instrumenting the transport itself); and
  `fixture:last-connect-config` (echoes the most recent `adapter:connect` payload's `config` back,
  the only way a Go test can observe that `resolve()` actually re-injected a URI password — no
  `adapter:connect` response otherwise carries it). Any future phase extending this fixture should
  grep for `fixture:` ops before assuming the table in P55's plan doc is the complete list.
- **A container's minimal init can leave a killed process group's members answering
  `kill(pid, 0)` as "alive" for a second or two after they've actually received and acted on the
  signal** — a reparented orphan becomes a zombie the moment it exits, and `kill(pid, 0)` succeeds
  against a zombie (it still holds a PID table entry) until something actually calls `wait()` on
  it. This sandbox's `process_api`-as-init does that reaping more slowly than a real system init
  (launchd/systemd) does. `internal/preconnect`'s and `internal/connections`' process-group-kill
  tests poll for `ESRCH` with a multi-second timeout rather than asserting it on the first check,
  specifically because of this — a real macOS run should see it resolve near-instantly, but don't
  tighten these timeouts based on that assumption without re-testing there.

**P56 implementation findings, worth keeping for P57+:**

- **Two ordering knots, same shape, same fix.** `application.Options.ShouldQuit` must be an
  already-allocated `*shell.Quitter`'s method value, and `appcore.Deps.Events` (read by
  `SettingsService.Set`, embedded into a `Services` entry) must be a real `appcore.Emitter` — but
  both the `Quitter`'s `*bridge.Events` and `Deps.Events` need the `*application.App` that only
  `application.New` produces, and `New` needs the `Services` slice (and `ShouldQuit`) as
  *arguments*. `FilesService{Dialogs: ...}` has the identical problem one level down (a `Dialogs`
  needs the app and the current main window). The fix used throughout `internal/shell/app.go`:
  build a small struct with a nil `*application.App` field, hand out its interface value
  immediately, and give the caller an `attach(app)` closure to fill the field in right after `New`
  returns — `NewDeferredEmitter`/`NewDeferredDialogs`. Nothing can actually call through either
  adapter before `Run()` starts the renderer, so the brief nil window is safe. Any future service
  needing the live `*App` at construction time will hit this same wall.
- **`app.Quit()` is a safe no-op before `Run()` has ever executed.** `(*App).Quit` guards on
  `a.impl != nil`, and `a.impl` is only assigned inside `Run()` (`application.go:659`) — so
  `quit_test.go` can drive `Quitter.ShouldQuit`/`Flushed`/`Shutdown` end-to-end against the real
  `*application.App` from `TestMain` without ever calling `Run()`, and the final `app.Quit()` at
  the end of `flushThenQuit` just does nothing in that harness instead of panicking or blocking.
- **`events.Mac.*` application-event constants compile on every platform**, even though the code
  that actually wires them up (`events_common_darwin.go`'s `ApplicationShouldHandleReopen`
  handler) is behind a `//go:build darwin` tag. The constant table itself
  (`pkg/events/events.go`) carries no build tag, so `shell.AttachReopen`'s
  `events.Mac.ApplicationShouldHandleReopen` reference builds cleanly on this Linux sandbox; only
  an actual macOS run will ever deliver the event.
- **After this phase, the boot-smoke screenshot shows the status bar stuck on "engine
  connecting" forever, and that is correct, not a regression.** `resolveEngine()` now starts the
  real bundled `engine.cjs` (P56 D12), and the Go-side stream plumbing
  (`bridge/stream.go`/`app.HandleStream("engine", ...)`) is real and tested — but
  `src/renderer/workbench/state/engine.ts`'s `initEngineState()` still drives its status off
  `src/renderer/bridge/port.ts`'s `ready` promise and a data-plane `ping`, and that file still
  expects Electron's old `MessagePort` handoff, which nothing on the Wails side produces (P56 §7
  explicitly excludes any `src/renderer/bridge/` change). The status pill cannot leave
  `'connecting'` until P57 rewires `bridge/port.ts` onto the new named Stream — don't read the
  stuck pill as a sign the engine or the stream handler is broken.
- **`modifierMap` (`keys.go`) has no `"Control"` entry — only `"Ctrl"`.** `chordToAccelerator`'s
  literal `"Control"` output (`shortcuts.ts`) is an Electron-ism; a verbatim port makes
  `SetAccelerator` silently log-and-drop (`GetAccelerator()` stays `""`). `internal/shell/accel.go`
  maps `Chord.Ctrl` to the string `"Ctrl"`, and `menu_wails_test.go` exists specifically to catch a
  regression here by checking real accelerators parsed, not just the Go-side template shape.
- **`application.UnHide` is a dead role on macOS** — `application.ShowAll` is the one that reaches
  `unhideAllApplications:`, and is the actual analogue of Electron's `role: 'unhide'`.
  `TestShowAllNotUnhide` pins this so a future edit can't silently swap them back.
- **A bridge service's own argument validation (e.g. `bridge/tree.go`'s `Children` rejecting an
  empty `connectionId` with `E_BAD_REQUEST`) is a separate guard from anything the service
  underneath enforces** — `internal/tree.Service.Children("", ...)` does not itself reject an empty
  id (it would just fail `requireConnected` less legibly), so this check exists only at the bridge
  boundary, mirroring `bridge/filters.go`'s existing `FiltersService.List` pattern. Any new bridge
  method taking a bare id string should get the same explicit guard rather than relying on the
  service to produce a good-enough error by accident.

**P57 implementation findings, worth keeping for the rest of this phase and beyond:**

- **`JSONStream`'s JSON round-trip does not preserve `TextColumnChunk`'s `TypedArray`s, and this
  was already latent in `src/engine/stdio-main.ts` since P54 — P57 M4's boot proof is the first
  thing that ever actually exercised it.** `protocol/page.ts`'s `TextColumnChunk` is four
  exactly-sized buffers (`data`/`nulls`: `Uint8Array`, `offsets`/`truncated`: `Uint32Array`), a
  shape the old `MessagePort`'s structured clone carried across verbatim. `stdio-main.ts`'s
  `writeFrame` does `JSON.stringify(message)` for *both* control and data frames (P54, untouched
  by P57 §0.2's "no engine change"), and `JSON.stringify` on a TypedArray — not `Array.isArray`,
  so it serializes as a plain object keyed `"0","1",...` rather than an array — loses its identity
  entirely: `JSON.parse` on the other end hands back `{0:1,1:2,...}`, and every real data-view read
  failed downstream with `"chunk.data is not a Uint8Array"` (`protocol/page.ts`'s own
  `assertChunkStructure`) the first time C1's boot test actually opened a table. Fixed in
  `bridge/port.ts`'s `reviveChunks` — a JSON-tree walk that recognises the four field names
  together (every page kind reuses the same `TextColumnChunk` shape under different key names:
  `data`, `ids`/`bodies`, `fields`/`values`, `keys`/`headers`/`attrs`/`timestamps`/`bodies`) and
  reconstructs real `Uint8Array`/`Uint32Array` instances — kept inside `bridge/port.ts` rather than
  `src/engine/` specifically to stay inside P57's own declared scope. This does not fix the
  underlying inefficiency (a binary blob JSON-inflates to ~5-6 bytes per original byte before
  `reviveChunks` even runs) — that's a real, pre-existing-since-P54 performance concern worth its
  own follow-up, not something this phase's own scope covers.
- **A tsconfig "paths" entry for a literal, absolute-path-shaped specifier (like
  `/wails/runtime.js`) breaks Bun's own `mock.module` interception for every file that
  transitively imports it — not only the file whose tsconfig declares the mapping.** Confirmed by
  direct experiment: pointing `tests/unit/tsconfig.json`'s "paths" at a real, otherwise-loadable
  stub file for this exact specifier still produced `Cannot find module '/wails/runtime.js'` from
  `bridge/port.ts`, regardless of whether the target was a real file or a `.d.ts`. `tsgo`'s own
  typecheck, by contrast, *does* apply a "paths" mapping declared anywhere in the `-p`'d project to
  every file it reaches, including ones outside that project's own directory — so the fix has to
  be asymmetric: no "paths" entry for this specifier anywhere (Bun's own module registry via
  `mock.module` handles it at runtime), and a `@ts-ignore` — not `@ts-expect-error`, which fails as
  "unused" under `tsconfig.web.json`, where the same import resolves cleanly via a real npm-package
  mapping — on the one import site each in `port.ts` and `control.ts`. Biome's own
  `noTsIgnore` rule auto-fixes `@ts-ignore` → `@ts-expect-error` on `bun run format`, including
  inside *prose comments* that merely mention the string "@ts-ignore" — so a `biome-ignore` comment
  belongs directly above the one real directive line, and nearby prose has to describe the
  directive without spelling it out literally, or `format` silently reintroduces the exact bug the
  directive exists to avoid.
- **A file that P57 D7 intends to fully retire from the renderer can still need to keep existing
  on disk for several more milestones**, if any Electron-only file not yet deleted still imports
  it. `ipc.ts` is a clean example: `control.ts`/`port.ts`/`env.d.ts` moved off it entirely in M2,
  but `src/main/index.ts` and eight `src/main/ipc/*.ts` files still import it, and deleting the
  file broke `bun run build` (the Electron bundle) — which M4's own C1 checkpoint requires staying
  buildable. The fix was mechanical (restore the file, since nothing in the renderer's own import
  graph reaches it any more; delete it for real at M6 alongside `src/main/`) but the general
  lesson is to check *every* remaining consumer of a file a decision names for deletion, not just
  the ones the milestone in question is actively rewriting.
- **`src/renderer/bridge/{control,port}.ts` are genuinely shared between the Wails and Electron
  builds** (one `src/renderer` tree, `vite.wails.config.ts` and `electron.vite.config.ts` each
  build it separately) — so once P57 M1/M2 point them at Wails-only mechanisms (`/wails/runtime.js`,
  the generated `@bindings/*`), the Electron build needs the *same* `resolve.alias` entries and the
  same `/wails/` `external` marking `vite.wails.config.ts` already carries, purely so
  `bun run build` still compiles. The resulting Electron bundle cannot actually run correctly
  (there is no real Wails asset server inside a Chromium renderer to serve `/wails/runtime.js`
  from) — that's fine and expected, since Electron is being removed outright in M7; the alias
  addition to `electron.vite.config.ts` exists only to keep C1's "the Electron app is still whole
  and buildable" checkpoint (§0.3/§9 M4) a literal, checkable fact rather than a claim that quietly
  stopped being true the moment the shared bridge files changed.
- **WebKit *is* installable in Claude Code's Linux web containers — an earlier session's "cannot
  reach the download host" finding (`docs/v1/plans/P57-cutover.md` §5.6/M5-done notes) does not
  hold in every session.** `bunx playwright install webkit` fetched WebKit 26.5 from
  `cdn.playwright.dev` without issue in this session; the only real gap was the system shared
  libraries it needs to actually launch (`libevent-2.1-7t64`, `libgstreamer-plugins-bad1.0-0`,
  `libflite1`, `gstreamer1.0-libav` — exactly what Playwright's own post-install warning names),
  fixed the same way as any other `apt-get install -y ...`. Once both are done,
  `bunx playwright test --project=ui` runs for real against WebKit, no chromium override needed —
  confirmed with `tests/ui/smoke.spec.ts`. Treat network reachability to `cdn.playwright.dev` as
  worth retrying each session rather than a permanent wall, the same posture already established
  for `artifacts.electronjs.org` in the Native Kafka driver section above. `ipc-frontend`'s default
  Chromium project needs the same treatment for a different reason: a fresh container's
  preinstalled Chromium is missing its `chrome-headless-shell` binary specifically (`bunx
  playwright install chromium` fetches it, ~185 MB + ~115 MB) — Playwright's own default launch
  mode for a project with no explicit `headless` option wants that binary, not the full browser one.
- **`window.kira` no longer exists once P57 M2/M3 have run — a `tests/e2e/`-era spec's own
  `page.evaluate(() => window.kira.someChannel(...))` helper has no replacement, and cannot be
  ported as-is.** `contextBridge`'s `window.kira` was Electron-only; the Wails renderer calls the
  generated `@bindings/*` service methods directly (via `control.ts`), and nothing puts them on
  `window` for a test to reach into from outside the bundle. Porting a `tests/e2e/` spec that used
  this purely as a UI-driving shortcut (most call sites) means driving the same action through the
  real UI instead (a button click, not a direct call). Porting one that used it as a raw
  verification probe *of the mock's own canned response* (checking a shape the test's own fixture
  already determines, e.g. "the list never carries a password") is checking something with no live
  wire left to query in this tier — that invariant now belongs to whatever Go/repo-layer test
  already covers the real backend's actual behavior, and the UI-tier port should say so and drop
  the raw check rather than assert against its own fixture data as if it proved anything.
- **`mockRuntime.ts`'s `canonical()` only sorts *top-level* keys — a nested object's key order must
  byte-match the real call's, or a fixture with semantically identical args still 422s as
  `E_FIXTURE_MISS`.** Hit porting `connections.spec.ts`: a `connectionsUpdate({id, input})` call's
  `input` object is built by spreading an existing `ConnectionSummary` and stripping a few keys
  (`state/connections.ts`'s `openEditDialog`/`patchConnectionFields`), so its key order is whatever
  order *that record's own JSON response* used, not `connectionInputSchema`'s declared field order
  — and a spread-then-reassign of an existing key (`{...fields, color: 'red'}` when `fields` already
  has `color`) does not move that key, while a genuinely new key added by the same spread
  (`password`, which `ConnectionSummary` never carries) lands at the very end. Two fixes, both
  applied: build a canned response's own fields in the same order `defaultDraft()`
  (`state/connections.ts`) or the prior response used, so a later request built by spreading it
  matches; and when in doubt, run the test once — the mock's own `E_FIXTURE_MISS` error message
  echoes `JSON.stringify(callArgs)` verbatim, which is faster and more reliable than deriving the
  exact shape by reading the renderer's call sites.
- **Every handled bound-call error is a real HTTP 422 under Wails, and that is genuinely new
  console noise Electron never produced.** `pkg/application/transport_http.go` (the pinned
  `wailsapp/wails/v3` module, read directly — not assumed) writes `http.StatusUnprocessableEntity`
  for any bound-call error, handled or not; Chromium/WebKit's own devtools then log "Failed to load
  resource: … 422" for that fetch regardless of whether the page's JS catches the rejection
  (confirmed empirically porting `tests/e2e/secrets.spec.ts`'s scenario 5, whose original
  `expect(consoleErrors).toEqual([])` assumed the old Electron `ipcRenderer.invoke` rejection path,
  which never touches the browser's network-resource-loading machinery at all). A test asserting
  "no console noise from a handled error" now has to assert "no console noise *other than* the one
  expected 422 line" instead — mirrors `tests/ui/support/mockRuntime.ts`'s own precedent for a
  benign 404 on `/wails/custom.js`, just for a real error response instead of a missing asset.
- **`ControlSnapshot` gained an optional `error?: {code, message}` field (tests/ui/-only,
  `tests/ipc/support/types.ts`/`mockRuntime.ts`) for a fixture that needs to simulate a genuine
  business-rule rejection**, not a schema-validation failure (those never reach the wire —
  `ConnectionDialog.vue`'s `onSave()` calls `connectionInputSchema.safeParse` first) and not an
  `E_FIXTURE_MISS` (that means the fixture is incomplete, not that the real backend would reject
  the call). `control.ts`'s `unwrap` reads `.cause.code`/`.cause.message` off the thrown error, so
  the mock answers an `error`-bearing snapshot with the same `runtimeErrorBody` shape
  `E_FIXTURE_MISS` already used, at a real non-2xx status. No `tests/ipc/**` fixture sets it (the
  backend capture/replay half has no concept of it); first used by `secrets.spec.ts`'s "save fails
  when secrets are unavailable" scenario.
- **A native tree/list Vue component's click and double-click handlers are genuinely separate**
  (`TreeRow.vue`'s `@click="onClick"` emits `select`; `@dblclick="onDblClick"` emits `open`) —
  driving it via `xdotool` needs two real, separately-dispatched `click 1` events close together
  (`xdotool click 1; sleep 0.05; xdotool click 1`), not `xdotool click --repeat 2`, which did not
  register as a double-click in WebKitGTK during this phase's C1 boot test.
- **`tests/ui/support/mockRuntime.ts` has no `Events.On` (push-event) mechanism at all — confirmed
  as a hard, structural gap while porting `interaction.spec.ts`, not just the narrower
  `connectionsChanged` case `connections.spec.ts`'s own header comment already named.** It
  intercepts only the one `Call` RPC endpoint; anything the renderer learns exclusively through a
  live `control.onXxx` subscription (a real `@wailsio/runtime` `Events.On`) can never update in
  this tier, no matter how the test drives the UI. Two concrete casualties, both permanent for this
  tier, not fixture-design gaps: (1) `state/ops.ts`'s Operations panel — `hydrateOps()` fetches
  `opsRecent()` once at boot and thereafter relies solely on `onOpUpdate` push for every later
  status change, so an op run *during* a test never appears in the DOM; (2) every `global: true`
  keyboard shortcut (`shared/domain/shortcuts.ts`) — Command Palette, Window ▸ Next/Previous/Close
  Tab, View ▸ Find/Refresh/Run Statement/Run All — whose accelerator is dispatched exclusively via
  the native menu emitting a Wails event, with no renderer-owned keydown fallback the way undo/redo
  has (`console.spec.ts`'s own precedent); the Command Palette itself has no button either, so even
  the commands it would otherwise reach are unreachable. Any future port touching a live
  `control.onXxx` push or a `global: true` binding will hit this same wall — there is nothing to
  fix in the test, only a scenario to drop with this same reasoning.
- **Playwright's bundled WebKit reports `navigator.userAgent` as `Macintosh` unconditionally,
  regardless of the real host OS** — confirmed by direct experiment on this Linux sandbox:
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 …`. `renderer/shortcuts/
  keys.ts`'s own `isMac` is `navigator.userAgent.includes('Mac')`, evaluated *inside the page* —
  so it disagrees with the Node test-runner's own `process.platform` (`'linux'` here) every time.
  A `tests/e2e/`-era spec's `process.platform === 'darwin' ? macChord : otherChord` pattern (correct
  under real Electron, where the renderer's UA honestly reflects the host) silently picks the
  *wrong* chord once ported to `tests/ui/`: hit porting `interaction.spec.ts`'s `grid.deleteRows`
  case, whose mac-only override (`Cmd+Backspace`) is not the plain `Delete` every other platform
  uses — a `Delete` keypress matched no shortcut at all, with no error, just nothing happening.
  Fixed by reading `navigator.userAgent` from the page itself (`page.evaluate(() =>
  navigator.userAgent.includes('Mac'))`) after `relaunch()`, never from `process.platform`, for any
  chord whose choice depends on platform as the *app* perceives it. This does not apply to a chord
  whose platform-dependence is a real OS-level input-translation quirk rather than app code reading
  the UA string (e.g. Control+click becoming a contextmenu event on real macOS hardware) — that
  stays keyed off the actual host, which this sandbox's Linux is, honestly.
- **This mock tier's own fixture, not just the app, can hide a real byte-accounting bug.**
  `tests/ui/support/mockStreamBrowser.js`'s constructed pages hardcoded `byteSize: 0` for every
  page kind, which made every retained-bytes assertion in `leaks.spec.ts`/`perf.spec.ts` pass
  vacuously (`0 > 0` never true, so the assertion direction happened to still read as "no leak"
  rather than fail loudly) — found only by tracing *why* a real leak-detection assertion kept
  passing even after deliberately breaking the code it was meant to catch. Fixed by computing real
  byte sizes with the exact same formula `src/shared/protocol/page.ts` uses
  (`chunk.data.byteLength + offsets.byteLength + nulls.byteLength + truncated.byteLength`, plus a
  fixed per-column envelope for tabular pages) — the general lesson: a mock that hardcodes a
  "doesn't matter for this test" value in one field can silently invalidate a *different* test's
  entire premise once that field is reused for something the original mock author didn't expect.
- **A plain function called directly inside a Vue template binding (`v-tooltip="fn(x)"`, not a
  `computed`) defeats any directive that gates its own work on reference equality.** `DataGrid.vue`'s
  `headerTitleFor(name)` built a fresh object on every call, and `v-tooltip`'s own `updated` hook
  compares `binding.value !== binding.oldValue` — a fresh object always fails that check, so every
  header cell's tooltip attributes were rewritten on *every* re-render, including a pure vertical
  scroll with no column change at all (confirmed via a real `MutationObserver`: dozens of spurious
  attribute writes per scroll tick, a genuine pre-existing performance bug this migration's own
  scroll-response test surfaced rather than introduced). Fixed by memoizing into a `computed` `Map`.
  Any future `v-directive="expression"` binding built from a plain function call, not a `computed`
  or a stored ref, is worth this same scrutiny.
- **A ported test's own scroll-position constants can silently stop testing what they claim to**
  once the mock fixture backing them is smaller than the real table the constants were tuned
  against. `budgets.spec.ts`'s `scroll_grid` mock only ever captures one `pageSize=100` page
  (~100 rows), not the real table's 5000 — a hardcoded `scrollTop` baseline chosen without checking
  the fixture's own `maxScrollTop` silently clamped to the ceiling with no failure, giving a "0
  mutations" result that looked like proof of the invariant rather than proof the scroll never
  actually moved. Fixed by deriving every scroll-position constant from the fixture's own
  already-computed `maxScrollTop`/`clientHeight` at test time, never from a literal tuned against a
  different (larger) dataset.
- **`CONNECTION_COLOR_CHOICES` (the offered color-picker subset) is a strict subset of
  `connectionColorSchema` (the storable superset) — clicking a retired swatch's `data-testid` (e.g.
  `color-teal`, `color-violet`) hangs a test until its action timeout, silently, since that DOM
  element simply never exists.** Found independently twice while porting different specs in the
  same session (once for `violet`, once for `teal`) — worth checking any new spec's chosen
  connection color against `CONNECTION_COLOR_CHOICES` (`src/shared/domain/connection.ts`) before
  writing the click, not after it hangs.
- **`tests/ui/`'s mocked control plane has no `Events.On` (push-event) analogue at all — a
  structural gap, not a per-scenario mocking gap.** `mockRuntime.ts` intercepts only the request/
  response `Call` RPC; anything the renderer learns exclusively through a live push subscription
  (a real `@wailsio/runtime` `Events.On`, e.g. `control.onConnectionsChanged`) can never fire in
  this tier no matter how the test drives the UI. Confirmed impossible to port, not merely
  difficult: `state/tabs.ts`'s stale-tab-close-on-delete and `project/state/tree.ts`'s
  `knownConnectionIds` pruning (both wired to `connectionsChanged`), and the L2/L3 engine-cache
  budget/hit-rate checks (they live in the `engine` Node child process, which this tier never
  runs). The cache-budget coverage moved to `tests/unit/engine-cache.spec.ts`, a direct
  dependency-free unit test of `src/engine/cache/{lru,pages,counts}.ts` — the honest replacement
  when the real subject is structurally unreachable from a given test tier, rather than leaving the
  claim untested or asserting against the mock's own fixture as if it proved anything.
- **`AppProcessSet` (metrics/sampler.go) matching by executable-path substring means the app's own
  CPU/RSS instrumentation is coupled to `shell/Taskfile.yml`'s `APP_NAME` string, not just its own
  code.** Renaming the shipping binary (P57 D11, `"kira-studio-shell"` → `"Kira Studio"`) without
  updating `metrics/ticker.go`'s `AnchorNeedles` to match would have silently broken the app's own
  status-bar RSS/CPU figure and G1's own measurement — not caught by any test, since nothing in
  this repo asserts against a real packaged process today. Any future rename of `APP_NAME` needs
  the same check.
- **`Info.plist`'s `CFBundleExecutable` must equal `shell/Taskfile.yml`'s `APP_NAME` exactly, byte
  for byte — `create:app:bundle` copies `bin/{{.APP_NAME}}` into `Contents/MacOS/{{.APP_NAME}}`
  verbatim**, so the on-disk executable's filename literally *is* `APP_NAME` (with a space, for
  `"Kira Studio"`). This isn't optional cosmetic parity with `CFBundleName`/`CFBundleIdentifier` —
  a mismatch here means macOS can't find the executable to launch it at all, and codesign can't
  validate it. Same applies to `Info.dev.plist` for the `.dev.app` bundle `wails3 task dev` builds.
- **`shell/build/config.yml`'s `info.productName`/`productIdentifier`/`description` feed
  `wails3 update build-assets`, which the file's own header warns will overwrite hand-maintained
  build assets (`Info.plist` included) if ever run.** That command was not run this phase — the
  Info.plist files were hand-edited directly, consistent with how they already drifted from
  `config.yml`'s other fields (copyright, comments) before this session — but `config.yml` was
  still updated to match, so a *future* run of that command doesn't silently revert the D11 rename.
- **No build step in this repository vendors `@confluentinc/kafka-javascript`'s native module (or
  any `node_modules/`) into `shell/runtime/engine/`.** `build:engine`'s esbuild bundle marks it
  `--external`, same as always, but nothing copies the actual dependency tree alongside `engine.cjs`
  the way `scripts/vendor-node.sh` does for the Node runtime — a real packaged build today would
  have Kafka connections fail at `require()` time. Flagged as a `note` (non-fatal) in both
  `scripts/sign-bundle.sh` and `scripts/verify-packaging.sh` rather than assumed solved; plausibly
  moot once a future phase removes the Node engine sidecar entirely.
- **This session's GitHub push access lacked the `workflow` OAuth scope**, so a commit touching
  `.github/workflows/*.yml` was rejected outright by GitHub itself, not by anything in this repo.
  The intended CI changes were committed instead under
  `docs/v1/plans/p57-pending-ci-workflows/{ci,release}.yml` with a `README.md` giving the
  copy-and-apply steps for a session with the right scope — worth checking whether that directory
  still exists (meaning the CI update is still pending) before assuming `.github/workflows/` is
  current.

## P58a — Go substrate + Postgres adapter (M0-M5), findings worth keeping for P58b+

`docs/v1/plans/P58a-substrate-postgres.md` covers the design; this section is what real
implementation and real-container testing found that the plan itself could not have predicted.

- **A local op-cancellation context must never be the same context passed to the real driver
  call, for any Go SQL driver that honours `context.Context` cancellation natively (pgx does;
  Node's `pg` does not).** `adapterhost.Host.CancelOp` deliberately cancels the op's own derived
  context *before* calling `adapter.Cancel` (`host.go`'s own comment: "the local abort alone is
  not a cancel… do not fix it by trying to make the query itself abort" — a direct port of
  `query.ts:77-80`'s same rule). Under Node's `pg`, that local abort only rejects the *waiting*
  promise; the real query keeps running server-side until `pg_cancel_backend` explicitly kills it.
  Under pgx, passing that same cancelled context straight into `conn.Query`/`conn.Exec` makes pgx
  *itself* race a cancellation request against — and typically win before — the adapter's own
  `pg_cancel_backend` call, which (since `Cancel`'s own `runningByOp` entry is removed by the
  first query's own `release()` the instant it errors from context cancellation) makes the second,
  authoritative cancellation attempt find nothing and silently report `false`, leaving a caller
  with no confirmation the query was actually killed. Caught by `TestPostgres_Cancel` failing
  against a real `pg_sleep(30)` the first time it ran — not by anything at the unit level, since
  nothing exercises real driver-level context cancellation there. Fixed with
  `query.go`'s `runWithAbortRace`: the real driver call runs on its own goroutine against
  `context.WithoutCancel(ctx)` (never sees the caller's cancellation), while the caller-facing
  function returns as soon as either that goroutine finishes or `ctx.Done()` fires — `release()` is
  called only when the query itself actually settles, matching `withAbortRace`'s own semantics
  exactly (`abort.ts`) rather than pgx's default. Any future Go adapter built on a context-native
  driver (mysql-family's `go-sql-driver/mysql`, ClickHouse's `clickhouse-go` — both honour ctx
  cancellation the same way pgx does) needs this same helper, not a direct `conn.Query(ctx, …)`.
- **`src/renderer/bridge/port.ts`'s `toTypedArray` never actually grew the base64 branch A9 called
  for, despite M2's own plan section describing it as already done** — the single highest-value
  bug this milestone's real-container/real-app testing found, and the reason "route a query
  through the real UI, not just the adapter package's own tests" earned its keep. The Go-native
  data plane's page codec (`internal/page`) encodes each `TextColumnChunk` buffer as base64 of its
  exact little-endian bytes (P58 D5); the ten still-Node-served kinds keep sending
  `JSON.stringify`'s index-keyed object shape (P57's own finding, above). `reviveChunks`'s
  `isChunkLike` check is encoding-agnostic (it only looks at the outer object's four key names), so
  it happily recognised a base64-encoded chunk as chunk-like and then handed each string straight
  to the *old* `toTypedArray`, which unconditionally did `ctor.from(Object.values(v))` — on a
  string this silently produces something with `.length === 0` (`Object.values("MTIz")` is
  per-character, not the intended bytes), so every native-served page rendered with zero rows and
  **no error anywhere** — not server-side (the Go response was correct, confirmed by adding a
  temporary debug log and reading the exact base64 payload back out by hand), not client-side (no
  console error, since the "wrong" typed array is still a *valid*, just empty-ish, one). This is
  exactly the class of bug unit tests calling the adapter directly can never catch, since they
  never touch the wire encoding at all — only `tests/e2e-real/postgres-real.spec.ts`, driving the
  real built app against a real container, surfaced it. Fixed by giving `toTypedArray` a
  `typeof v === 'string'` branch that `atob`s the string and constructs the typed array directly
  over the decoded buffer.
- **`tests/e2e-real/fixtures.ts` called a `bun run build:wails` script that no longer exists** —
  removed at some point after P57 folded Electron's separate `vite.wails.config.ts` into the main
  `vite.config.ts` (which now outputs straight to `shell/frontend/dist`), but nothing had run
  `tests/e2e-real/` since, so the stale reference was never exercised. Fixed to call
  `bun run build` instead. Any future consumer of this fixture should not assume it has been kept
  in sync with build-script renames elsewhere in the repo — it is easy to go a long time without
  anything actually invoking it.
- **`tests/db/support/postgres.ts` could not be deleted alongside `tests/db/postgres.spec.ts`**,
  contrary to the plan's own §3/§8 ("its only consumer goes… deleted in the last commit") — that
  assumption was true when the plan was written, but `tests/ui/data-view.spec.ts`,
  `tests/ui/support/postgresFixture.ts`, `tests/e2e-real/postgres-real.spec.ts`, and
  `scripts/capture-postgres-tree.ts` all gained real dependencies on it in the sessions between the
  plan's authoring and M5's implementation. Only `tests/db/postgres.spec.ts` itself (A21's own
  named file) was deleted; `tests/db/support/postgres.ts` stays. General lesson: a plan's own
  "its only consumer" claim about a shared support file is a snapshot, not a standing fact — worth
  re-checking real consumers at implementation time rather than trusting the plan verbatim,
  especially when other phases' work has landed in between.
- **Two of `tests/db/postgres.spec.ts`'s 34 TS scenarios ported to a Go test that initially
  asserted the wrong thing, not a wrong implementation.** Scenario 27 ("mutate: no primary key is
  E_UNSUPPORTED") was first ported against `analytics.events`, which the fixture SQL actually gives
  a real primary key (`id serial PRIMARY KEY`) — the real TS scenario instead creates a throwaway
  `app.no_pk_probe (col text)` table on the fly specifically because it has none; the Go port now
  does the same. Scenario 21 ("preview: exact text, never executes") asserted the post-preview row
  count as `2`, when `app.composite_pk`'s real seed data has three rows — an arithmetic slip in
  translation, not a preview-executed-when-it-shouldn't-have bug. Both were caught immediately by
  running the ported test against the real container rather than trusting the port's own
  self-consistency; worth remembering that a newly-written acceptance test can be wrong in the same
  ways the code it tests can be.
- **`internal/adapters/testsupport.StartPostgres`'s first implementation broke its own
  documented "one container per test binary, reused by every test" contract** — real containers
  were still being started once *per test function*, not once per binary (~50s for ~24 tests
  instead of ~8s), because the container's termination was wired to `t.Cleanup` on whichever `*testing.T`
  happened to call `StartPostgres` first; Go's `testing` package runs a `Cleanup` the instant *that*
  specific test function returns, long before the rest of the package's tests run — unlike
  `bun:test`'s `afterAll`, which genuinely waits for every test in the file. Fixed by moving
  termination out of any per-test `t.Cleanup` into an exported `StopPostgres()`, called once from
  the package's own `TestMain` after `m.Run()` returns — the idiomatic Go analogue of `bun:test`'s
  `beforeAll`/`afterAll` for a fixture meant to be shared across a whole test binary.
- **`app.big_rows` needed a second, separate population step even in Go** — the seed SQL
  (`tests/db/fixtures/0001_seed.sql`) only `CREATE TABLE`s it; the TypeScript harness
  (`tests/db/support/postgres.ts`) fills it with 1,000,000 rows and runs `ANALYZE` in a second step
  gated by an option most callers leave at its `true` default. The Go port's first version of
  `testsupport.StartPostgres` skipped this second step entirely, so every keyset-paging,
  offset-paging, and row-estimate test that depends on `big_rows` having real data or real
  `reltuples` failed — not because the paging/estimate code was wrong, but because the table was
  empty. Fixed by porting the same second step (`testsupport/seed.go`'s `seedBigRows`).
- Connection kind literals used purely as "a kind the router forwards to the Node engine child"
  placeholders in **pre-existing** M4 tests (`connections/service_test.go`, `tree/service_test.go`,
  `adapterhost/router_test.go`) hardcoded `"postgres"`, written back when `nativeKinds` was still
  empty. M5 flipping `nativeKinds["postgres"] = true` turned those into real (and, for these
  fixtures, wrong) routing decisions — three tests broke by actually trying to dial a real
  Postgres server with a fake config, immediately on the next `go test ./...` after the flip.
  Fixed by swapping the placeholder kind to `"mariadb"` (still Node-served; unaffected by this or
  any future milestone until P58b lands). General lesson for every later milestone in this phase:
  flipping a kind's `nativeKinds` bit is a breaking change for any *other* package's test that used
  that kind as a "definitely still forwards to the child" placeholder — grep for the literal kind
  string across `internal/` before flipping it, not just within the package the milestone itself
  is authoring.
- **C1 (`docs/v1/plans/P58a-substrate-postgres.md` §7) was recorded as follows.** This sandbox has
  no real X display for the plan's own literal `xdotool`/`import -window`/screenshot steps, so the
  proof ran through this repo's own established substitute for that class of check
  (`tests/e2e-real/`, P57's replacement for interactive-GUI e2e testing: a real `-tags server` Go
  binary, a real embedded engine, driven by a plain headless-browser Playwright tab) rather than
  the plan's literal steps — the same real binary, real bindings, real Postgres container, and real
  UI code paths, just reached over `http://127.0.0.1` instead of a physical window.
  - Steps 1-5 (Docker, image pulls, app build/boot): done, via `tests/e2e-real/postgres-real.spec.ts`'s
    own fixture (`wails-dev-setup.sh` + `bun run build` + `go build -tags server`).
    Step 6 (confirm the app rendered): the substitute's own equivalent — `page.waitForSelector('[data-testid="status-bar"]')` — passed.
  - Steps 7-10 (create/test/connect a Postgres connection; real server-version handshake; expand the
    tree through relations with correct kinds and `~N rows` details; open `app.order_items` as a
    data tab and see real cell text via the base64 chunk path): **all passed for real**, and step 10
    specifically is what surfaced the `toTypedArray` bug above — recorded as unambiguously proven,
    not assumed.
  - Step 9 (definition view rendering a composed `CREATE TABLE`): not driven through the UI this
    session; covered instead by `internal/adapters/postgres`'s own `getReadTarget`/`buildDefinition`
    code paths, exercised indirectly by the acceptance suite's Describe-adjacent cases, not by a
    dedicated Definition-view UI click. Recorded as not run at the UI layer.
  - Step 11 (page forward and back with keyset paging against a real 1,000,000-row table): **passed
    for real**, added as a second `tests/e2e-real/postgres-real.spec.ts` test — asserts both the row
    identity change and `[data-testid="pager"]`'s own `data-pagination="keyset"` attribute, so a
    silent fallback to offset paging would have failed it, not just produced correct-looking rows.
  - Steps 12-14 (count-then-cache-hit; a two-statement console batch as one op-log row; a staged
    cell edit's preview text and its landing) and step 16 (the Node child stays running throughout):
    not driven through the real UI this session — each is instead covered by
    `internal/adapters/postgres`'s own real-container acceptance suite
    (`postgres_test.go`'s `TestPostgres_Count`/`TestPostgres_ExecuteOnePagePerStatement`/
    `TestPostgres_MutateUpdate`/`TestPostgres_PreviewNeverExecutes`) and by M4's own
    `adapterhost` integration tests for the Node-child-still-attached invariant. Recorded as
    verified at the adapter/dispatcher layer, not at the UI layer, in this session.
  - Step 15 (`SELECT pg_sleep(30)` cancelled via the stop button, confirmed server-side via
    `pg_stat_activity`): the server-side half is exactly what
    `postgres_test.go`'s `TestPostgres_Cancel` proves (and is what caught the cancellation-race bug
    above) — real `pg_cancel_backend`, a real running backend PID, `pg_stat_activity` implicitly
    clean afterward (the query genuinely errors out). Driving it through the UI's own stop button
    specifically was not done this session; recorded as verified below the UI layer only.
  - Steps 17-21 (MariaDB coexistence in the same session; interleaved op-log across both hosts;
    summed cache-stats budget; killing the Node child and confirming only the MariaDB connection
    errors): **not run this session** — MariaDB has no Go adapter yet (P58b), so "coexistence" here
    would only be re-proving M4's own router-forwarding tests with a second live container attached,
    which M4's `adapterhost` test suite (`router_test.go`/`dataframe_test.go`/`integration_test.go`)
    already covers against a real Node engine child. Worth doing for real once P58b's MariaDB
    adapter exists and both connections can be genuinely native/non-native side by side in one
    running app, which is closer to what steps 17-21 are actually trying to prove.

## P58b — MySQL/MariaDB, SQLite, ClickHouse (M6), findings worth keeping for P58c+

`docs/v1/plans/P58b-mysql-sqlite-clickhouse.md` covers the design and carries its own §12/§13
results sections in full detail; this is the condensed, cross-milestone version worth a reader not
re-deriving from the plan doc.

- **The M6.0 probes earned their keep**: MY-1 found that MySQL 8.4's `SLEEP()` swallows
  `KILL QUERY` via its own documented return value instead of raising an error (MariaDB raises
  `Error 1317` as expected) — a genuine per-engine divergence, not a probe bug, that changed the
  acceptance suite's own choice of long-running statement for MySQL's cancellation test rather than
  any design decision. SQ-1 found that `modernc.org/sqlite` executes every statement in a
  multi-statement `Exec` string instead of silently dropping the tail the way `node:sqlite` does —
  B9's console contract is unchanged, but its enforcement point moves into the adapter (reject a
  multi-statement payload before executing) rather than relying on the driver. CH-1 found a real
  server response quirk: a plain GET with `query=` in the URL is rejected for every statement, not
  only DDL/DML — `clickhouse/client.go` must always POST.
- **The cancellation-race bug from P58a recurred as a design question, not a repeat bug, in
  M6.1**: hoisting `runWithAbortRace` into the shared `adapters.RunWithAbortRace` surfaced that
  Postgres's own `Disconnect` could still race an abandoned goroutine against pool closure (see the
  P58a section above) — fixed with an `inFlight sync.WaitGroup`, verified race-clean across 8+ runs
  before any M6.2 code was written on top of the lift.
- **The no-primary-key test mistake from P58a repeated itself verbatim in M6.2.** Faithfully
  porting a TypeScript fixture's seed schema (`kira_analytics.events`, which has a real
  `AUTO_INCREMENT PRIMARY KEY`) into the Go mysql-family fixture, then reusing that same table for
  a "mutate: no primary key" test case, produced a false-positive pass both times — once for
  Postgres in P58a, once for MariaDB/MySQL in M6.2. Both were fixed the same way: a genuine
  throwaway no-PK table created via a side connection, dedicated to that one test. This is now a
  named pattern to check for explicitly in M6.3 (SQLite) and M6.4 (ClickHouse): if a fixture's main
  seeded table has a primary key, the no-PK test needs its own table, not a shortcut through the
  existing seed.
- **Flipping a kind's `nativeKinds` bit stays a cross-package breaking change, confirmed again in
  M6.2.** `adapterhost.TestKindNodeServed` (introduced in M6.1 specifically to stop this class of
  break from recurring) covered the five files M5's Postgres flip had already fixed, but
  `router_test.go`'s own internal `IsNativeKind` mutation test had a second, narrower instance of
  the same problem: it used the literal `"mariadb"` as a "this can't possibly be native" scratch
  value for a live-mutation assertion (add it to `nativeKinds`, assert, `defer delete`) — once
  M6.2 made `mariadb` really native, that `defer delete` would have permanently un-nativized it for
  every test running later in the same binary. Fixed with a dedicated
  `const fakeKind = "kira-test-fake-kind"` that can never become a real adapter kind and is never
  reused as any other test's `TestKindNodeServed`-style placeholder. General lesson refined further
  for M6.3/M6.4: grep for the literal kind string across `internal/` before flipping it, **and**
  check for any test using that literal as a scratch/mutation value, not only as a
  forwards-to-the-child placeholder — the two uses need different placeholders now that
  `TestKindNodeServed` exists for the first case.
- **Two real, driver-level capability losses were confirmed for mysql-family**, both documented in
  `docs/ARCHITECTURE.md`'s PostgreSQL/MariaDB/MySQL section rather than worked around, since no
  equivalent exists in `go-sql-driver/mysql`: the query console's "N row(s) affected" status text
  (no `RowsAffected()` on the `QueryContext` path the console's multi-statement runner needs; a
  generic "OK" is shown instead) and `allowPublicKeyRetrieval` (the driver requests the server's
  RSA public key unconditionally over plaintext when needed, with no option to refuse).
- **M6.3 (SQLite) found a real `modernc.org/sqlite` bug empirically, before writing any adapter
  code, by not trusting M6.0's own SQ-1 probe to have already covered it.** SQ-1 tested only a
  garbage `'not a date'` string in a `DATETIME` column and concluded "storage-class-faithful, no
  coercion" — true for that one input, false in general: this driver's `rows.Next()` silently
  re-parses a *valid-looking* date string in a `DATE`/`DATETIME`/`TIMESTAMP`-declared `TEXT` column
  into a Go `time.Time`, unconditionally, with no DSN opt-out. Caught by writing a throwaway probe
  program against a real in-memory database before any package code existed (the same M6.0-style
  discipline, not committed), confirmed against all six storage/declared-type combinations, then
  fixed in `read.go`'s own SELECT-list construction (a `CASE WHEN typeof(col)='text' THEN col||''
  ELSE col END` wrap, which defeats SQLite's own decltype-based trigger for the coercion without
  touching any other storage class). Worth naming as a general lesson for M6.4 (ClickHouse) and any
  future milestone: an M6.0-style probe is only as complete as the specific inputs it tried, not a
  substitute for testing the adapter's own code against the real driver once it exists.
- **M6.3 also confirms the no-PK-test-mistake pattern named in M6.2's own entry above was worth
  watching for** — and this time it did not recur, because `0009_sqlite_seed.sql` already ships a
  genuine no-primary-key `no_pk_rowid` table (needed anyway for D22's own rowid-keyset scenario),
  so the sqlite suite's "mutate: no primary key" test uses it directly with no side-connection probe
  table required.
- **M6.4 (ClickHouse) confirmed the M6.3 lesson above was worth stating in general terms, not just
  for SQLite.** Rolling a raw `net/http` client instead of vendoring `@clickhouse/client` (B11)
  meant losing that library's own hidden defaults, not just its dependency weight: plain
  `FORMAT JSON` on `clickhouse-server:26.3` emits a UInt64/Int64 column as a bare JSON number
  unless `output_format_json_quote_64bit_integers=1` is requested explicitly, which
  `@clickhouse/client`'s own `.json()` method evidently sets on every request without `client.ts`
  ever having to say so. `catalog.ts`'s own `total_rows: string | null` typing (and, transitively,
  every Go struct field ported from it) is only correct once a hand-rolled client asks for that
  setting itself — found on the *first* real run against the container, not before, fixed by adding
  the setting to `client.go`'s own `fixedSettings` map (sent on every request, matching B11's whole
  design) and typing `system.columns.position` — a second, independently-discovered UInt64 column —
  as `string` too, parsed on the Go side like `total_rows`/`count()` already were.
- **A self-referential false positive in a server-side liveness check, not a cancellation bug.**
  The acceptance suite's own "cancel, asserted server-side" test polled
  `system.processes WHERE query LIKE '%sleep(3)%'` and never observed the target query as gone —
  not because `KILL QUERY` failed, but because the *checking* query's own SQL text contains the
  literal substring `sleep(3)` inside its own `LIKE` pattern, so once ClickHouse makes that query
  itself visible in `system.processes` while it runs (confirmed empirically), it permanently
  matches its own predicate. The general lesson, worth carrying into P58c/P58d/P58e's own
  cancellation tests: a server-side liveness poll must check a value the checking statement's own
  text cannot itself satisfy (here, the tracked `query_id`, not a text scan) — the same shape of
  mistake as reusing a fixed literal as a placeholder value elsewhere in this phase's own findings
  (B16's `nativeKinds` entries above), just at the query level instead of the Go-test level.
- **C1b (docs/v1/plans/P58b-mysql-sqlite-clickhouse.md §7) ran for real in this session** —
  `tests/e2e-real/mariadb-real.spec.ts`, MariaDB as the native side and MongoDB (still Node-served)
  as the other, filling the exact gap P58a's own §13 recorded as unfillable before a second adapter
  went native. Both halves passed: the native half end to end (real dialog, real tree, real cell
  text over the base64 chunk path, real keyset paging over `big_rows`), and — the load-bearing
  half — MariaDB staying `connected` and still serving a real read through a fresh `page.reload()`
  after the Node engine child was actually `SIGKILL`ed (confirmed via the server's own
  `enginehost: engine process exited` log line), while MongoDB's own connection flipped to `error`.
  This is the first time P58 D4's coexistence property has been proven in a running app, not only
  in `adapterhost`'s own router unit tests. `tests/e2e-real/fixtures.ts` gained one small, narrowly-
  scoped addition to make it possible: `KiraApp.serverPid`, so a test can find the Node engine
  child as a real process child (`pgrep -P <serverPid>`) instead of guessing at the vendored
  runtime's own binary name.
- **A real frontend regression, live in `main` since M6.3, was only caught here because M6.4's own
  validation happened to re-run `tests/e2e-real/sqlite-real.spec.ts` as a sanity check** — it was
  never re-run at M6.3's own closeout, whose validation sweep covered `go test`, `lint`,
  `typecheck`, and the mocked `test:ui`/`test:ipc:fe` tiers only. The failure:
  `expect(consoleErrors).toEqual([])` caught a real
  `TypeError: Cannot read properties of null (reading 'length')` thrown from a Vue computed
  (`DataGrid.vue`'s `if (meta.primaryKey && meta.referencedBy.length > 0)`). Root cause: Go's
  `encoding/json` marshals a nil slice as `null`, not `[]`, and every native adapter's catalog code
  builds its list fields the idiomatic Go way (`var result []model.ForeignKeyMeta`, appended to
  only when there's something to add) — so a table with no reverse foreign keys (the common case)
  sent `referencedBy: null` over the wire, where the TS engine's own arrays were never anything but
  `[]`. `model.ValidateObjectMeta`/`ValidateObjectDefinition` already existed with exactly this
  nil-to-`[]` normalization, but were only ever wired into `tree/service.go`'s cache-load path
  (`json.Unmarshal` from a *child-served* payload) — `adapterhost.Router`'s `describeNative`/
  `definitionNative` call the adapter directly and returns its struct as-is, so a native result
  never passed through the normalizer. Fixed by calling `model.ValidateObjectMeta(&meta)` /
  `model.ValidateObjectDefinition(&def)` at the end of `describeNative`/`definitionNative` in
  `shell/internal/adapterhost/router.go`, and by adding the same missing `PrimaryKey` nil-guard to
  `ValidateObjectMeta` itself (only `Columns`/`ForeignKeys`/`ReferencedBy`/`Indexes` were guarded
  before). This is the same class of bug as P58a's own `toTypedArray` finding — a real wire-path
  regression invisible to every mocked tier — and confirms the general lesson from that finding
  needs restating even more sharply: **`tests/e2e-real/*.spec.ts` must be re-run in full after
  every `nativeKinds` flip, not just for the kind that just went native**, since a shared code path
  (here, `adapterhost.Router`, common to all native adapters) can silently break every *other*
  already-native kind's own wire format at the same time. Re-verified clean after the fix: all of
  `go test ./... -count=1`, `sqlite-real.spec.ts`, `postgres-real.spec.ts` (2/2),
  `mariadb-real.spec.ts` C1b (2/2), and `test:ui`/`test:ipc:fe`.

Current-state architecture reference: `docs/ARCHITECTURE.md`. The v1 record of what was specified,
phase by phase: `docs/v1/SPEC.md` (see `docs/v1/README.md` for what that folder is and isn't).
