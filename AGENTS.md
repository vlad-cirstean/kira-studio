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
- No per-phase PRs. One feature branch for all of v1.
- **Best practices throughout, no shortcuts** — no stubbed error handling, no `TODO: fix later`,
  no skipped validation to make something demo. Scope left out of a phase is left out entirely,
  not half-implemented.
- **Comments: very concise, and only where truly necessary.** Add one only when the code cannot
  say it for itself — a non-obvious *why*, a constraint, a workaround. Never restate what the code
  already shows.
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
  from this sandbox (P50) — pointing an image reference at it (`mirror.gcr.io/library/mariadb:...`
  etc., or configuring it as a registry mirror) unblocks real containers for mariadb, mysql, redis,
  rabbitmq and localstack (sqs) here. Two exceptions found so far: **ClickHouse** —
  `@testcontainers/clickhouse`'s constructor hardcodes `.withUlimits({nofile:{hard:262144,
  soft:262144}})`, and this sandbox's own `ulimit -Hn` is fixed at 20000 and cannot be raised even
  as root (confirmed: a plain `docker run` with no custom ulimits works fine standalone) — so this
  one adapter's container-backed tests stay unrunnable here regardless of registry. **Kafka** — see
  the Native Kafka driver section below; the blocker there is the ABI rebuild, not the image pull.
  Bun's own `testcontainers` integration has also been observed to hang indefinitely in this specific
  sandbox on images that pull and run fine under plain Node with the identical image — a sandbox
  quirk of the Bun runtime here, not a real bug (confirmed fine on a real machine).

## Electron binary (for `tests/ui/`)

- **Claude Code's Linux web containers**: `bun install` does not fetch the Electron binary —
  `node_modules/electron/install.js` downloads it via `@electron/get`, which fails in this
  environment with `AssertionError: assert(!this.paused)` deep inside undici's HTTP/1 parser (a
  proxy/streaming quirk with that specific downloader, not a blocked host — plain `curl -L` against
  the same `github.com/electron/electron/releases/download/vX.Y.Z/electron-vX.Y.Z-linux-x64.zip`
  URL succeeds). Fix by downloading with `curl` and installing manually:
  ```
  curl -sSL -o /tmp/electron.zip https://github.com/electron/electron/releases/download/v<version>/electron-v<version>-linux-x64.zip
  mkdir -p node_modules/electron/dist && cd node_modules/electron/dist && unzip -q /tmp/electron.zip && cd -
  chmod +x node_modules/electron/dist/electron node_modules/electron/dist/chrome-sandbox node_modules/electron/dist/chrome_crashpad_handler
  printf 'electron' > node_modules/electron/path.txt   # no trailing newline — install.js compares it verbatim
  ```
  `<version>` is `node_modules/electron/package.json`'s own `"version"` field. Verify with
  `node -e "console.log(require('electron'))"` — it should print the binary path with no
  "Downloading Electron binary..." message. This unlocks real `xvfb-run -a bunx playwright test`
  runs for every spec that doesn't need a `tests/db/`-style container (confirmed:
  `smoke.spec.ts`, `startup.spec.ts`, `workbench.spec.ts`, `connections.spec.ts`,
  `secrets.spec.ts` all pass) — most other specs still `test.skip()` cleanly via
  `isDockerAvailable()` rather than fail, per the Docker note above.

## `tests/ipc/` — building and testing in this environment (P50)

See `docs/ARCHITECTURE.md`'s Testing section for what this tier is and why the fixture is
generated rather than hand-written. This section is only about running it here.

- **The backend half needs the Electron binary from the section above, but no `xvfb`** — it never
  opens a window. `scripts/run-ipc-backend.sh` bundles each `tests/ipc/**/*.backend.spec.ts` (plus
  the harness's own Docker-free self-test) with esbuild — `--bundle --platform=node --format=cjs
  --loader:.sql=text --external:electron --external:@confluentinc/kafka-javascript --external:ssh2
  --external:cpu-features` — then runs the bundle under `ELECTRON_RUN_AS_NODE=1 electron`, one
  process per spec file, sequentially (each file's container helper is a module-scope memo assuming
  one file per process). `node_modules/.bin` needs to be on `PATH` for the bare `electron` the
  script invokes to resolve. `tests/db/support/*.ts`'s `.sql`-reading helpers resolve their seed
  file relative to `__dirname`, which is `out/tests/ipc/` once bundled, not `tests/db/fixtures/` —
  the script copies the fixtures directory beside the bundle output to fix this, rather than editing
  `tests/db/` itself.
- **The frontend half needs `xvfb`** (`bun run test:ipc:fe`, i.e. `electron-vite build && playwright
  test --project=ipc-frontend`) for the same reason every other `tests/ui/`-style Playwright run
  does on a display-less Linux container: `xvfb-run -a bunx playwright test --project=ipc-frontend`.
  It needs no Docker, no container and no native driver — confirmed here for mariadb, mysql, redis,
  rabbitmq and sqs.
- **Regenerating a fixture** (`KIRA_IPC_FIXTURES=write sh scripts/run-ipc-backend.sh`) writes each
  backend spec's own `<adapter>.fixture.ts` via raw `JSON.stringify` (quoted keys, `capture.ts`'s
  `writeFixtureModule`) — run `bunx biome check --write tests/ipc/<adapter>/<adapter>.fixture.ts`
  afterward to match the repo's own formatting convention before committing; the content does not
  change, only the quoting.
- **Which adapters' backend halves are Docker-gated here, and which stay unrunnable regardless of
  Docker**: mariadb, mysql, redis, rabbitmq and sqs's backend specs all ran for real against
  containers pulled via `mirror.gcr.io` (Docker section above) in this sandbox. **ClickHouse**'s
  backend spec was not written at all — the ulimit blocker (Docker section above) means no real
  fixture could ever be captured here, and P50's own D5 forbids hand-writing one, so this adapter's
  IPC-boundary split stays deferred; `tests/ui/clickhouse.spec.ts` was left in place rather than
  deleted with nothing to replace it. **Kafka** is the same shape for a different reason: its
  backend half needs the native ABI rebuild (Native Kafka driver section below), confirmed still
  blocked here (`scripts/native-electron-build.sh` fails with the same `403` fetching Electron's
  C++ headers), so no real fixture could be captured for it either — `tests/ui/kafka.spec.ts` also
  stays in place, undeleted, for the same D5 reason.

## Secrets / `KIRA_INSECURE_SECRETS` (for password-bearing `tests/ui/` specs, P25)

- Credentials are encrypted via Electron's `safeStorage`, which is Keychain-backed on macOS and
  has **no real backing store on Linux** — a bare Linux dev/CI container has no `gnome-keyring` or
  `kwallet` daemon (no systemd, see the Docker note above), so `safeStorage.isEncryptionAvailable()`
  is `false` there by default.
- **On Claude Code's Linux web containers and any other Linux dev machine**: set
  `KIRA_INSECURE_SECRETS=1` before launching the app (`bun run dev` or the Playwright harness) to
  opt into a Linux-only development fallback (Chromium's `basic_text` obfuscation — a hardcoded
  key, not real encryption). `tests/ui/fixtures.ts` already sets this for every test by default,
  so the normal `xvfb-run -a bun run test:ui` loop needs no extra step; it only matters for a
  manual `bun run dev` session or a one-off `electron out/main/index.js` launch outside the test
  harness.
- **On macOS**, this variable is ignored outright — `safeStorage` uses the real Keychain and
  `KIRA_INSECURE_SECRETS` can never weaken it, even if accidentally left set in an environment.
  `tests/ui/secrets.spec.ts`'s scenario 1 is the guard that this stays true: it fails loudly
  (never skips) if `available`/`backend` on `darwin` don't read `true`/`'keychain'`.
- Without the variable, Linux resolves to secret storage being **unavailable** — a password-bearing
  save fails visibly (the dialog's `connection-save-error`) rather than silently falling back to
  plaintext. This is deliberate (see `docs/v1/plans/P25-credential-keychain-encryption.md` D13),
  not a bug to work around.

## Native Kafka driver — building and testing in this environment (P32)

See `docs/ARCHITECTURE.md`'s Kafka section for *why* (ABI-specific native addon, Bun can't load
it at all, no consumer-group join on browse). This section is only about running it here.

- **Electron's ABI is the only one that matters for this app.** `scripts/native-electron-build.sh`
  rebuilds the driver for Electron's own ABI (read from `node_modules/electron/abi_version`) before
  anything that loads it runs — wired as `predev`, `pretest:ui`, `pretest:db:kafka` and
  `prepackage:mac`. It caches a successful build under `.cache/native/confluent-kafka-javascript/<abi>.node`
  and writes a marker beside the built module, so a matching ABI skips the rebuild entirely on
  every run after the first.
- **Claude Code's Linux web containers**: `electron-rebuild` (what
  `native-electron-build.sh` calls to do the real work) needs to download Electron's C++ headers
  from `artifacts.electronjs.org`, which this environment's proxy blocks (403). This means
  `predev`, `pretest:ui`, `pretest:db:kafka` and `prepackage:mac` all fail here whenever the cache
  doesn't already hold a matching-ABI build — there is no known workaround in this environment (F20).
  `native-electron-build.sh` backs up the existing `.node` file before attempting a rebuild and
  restores it on failure, specifically because `node-gyp`/`electron-rebuild` deletes
  `build/Release` *before* attempting the build — without the backup, a failed rebuild attempt in
  an unsupported environment would destroy the Node-ABI bootstrap binary `bun install` provided,
  corrupting `node_modules` rather than just failing cleanly.
- What still works here despite the above: `bun run build` (electron-vite's
  `externalizeDepsPlugin()` never bundles or executes the native module — it just leaves the
  `require()` call for Electron's own runtime resolution), `bun run lint`/`typecheck`, and running
  `tests/electron-db/kafka.spec.ts`'s bundle under `ELECTRON_RUN_AS_NODE=1 electron` far enough to
  confirm `node:test` exists and every import resolves — it then fails cleanly at
  `isDockerAvailable()`, the same point every `tests/db/`-style spec fails at here (no Docker
  daemon, see above).

## SQLite adapter — testing in this environment (P35)

See `docs/ARCHITECTURE.md`'s SQLite section for what the adapter itself relies on
(`node:sqlite`, runtime version floor). This section is only about running it here.

- **`tests/db/sqlite.spec.ts` needs no Docker.** `tests/db/support/sqlite.ts` is a temp-file
  fixture (`mkdtemp` + `node:sqlite`), not a Testcontainers harness — there is no container to
  start, no image to pull, no daemon to reach. Its only environment dependency is `node:sqlite`
  itself, gated by `sqliteAvailable()` the same way every other DB spec here gates on
  `isDockerAvailable()`.
- **`tests/ui/sqlite.spec.ts` runs unconditionally** (no Docker gate at all) — the one DB-backed UI
  spec that actually executes in Claude Code's own Linux web container, where every other engine's
  UI spec self-skips for lack of Docker. This sandbox's system Node (`/opt/node22`, 22.22+) has
  `node:sqlite`, which is what `playwright test` actually runs under (Playwright's own test runner
  is a Node program, not a Bun one) — confirmed empirically, not assumed.
- This sandbox's own Bun (1.3.x) lacks `node:sqlite`, so `bun test tests/db/sqlite.spec.ts` here
  reports the legible `SQLITE_UNAVAILABLE_MESSAGE` failure rather than actually running the
  suite — the same class of environment gap `tests/db:kafka` hits for a different reason above.
  The adapter itself was verified here by bundling the real source with `esbuild` and running it
  under `ELECTRON_RUN_AS_NODE=1 electron` against a real temp-file database — the same technique
  P32's Kafka smoke-testing established for "the target runtime differs from the one `bun test`
  would use."

## ClickHouse adapter — testing in this environment (P36)

See `docs/ARCHITECTURE.md`'s ClickHouse section for the adapter's own design facts (no
per-request `database` override, why `canUpdate`/`canDelete` are permanently false). This section
is only about running it here.

- **`tests/db/clickhouse.spec.ts` needs Docker** (`@testcontainers/clickhouse`, image
  `clickhouse/clickhouse-server`) — same `isDockerAvailable()` gate as every other Testcontainers
  spec, and the same image-pull limitation applies here as elsewhere in this sandbox (Docker's
  daemon is reachable, but pulling images from Docker Hub through the outbound proxy returns
  `403`). `tests/ui/clickhouse.spec.ts` is Docker-gated the same way, not unconditional like
  SQLite's — ClickHouse needs a real server, there's no local-file equivalent.
- Verified in this sandbox the same way SQLite's own hard-to-run pieces were: real, targeted checks
  against actual dependencies where a live container wasn't reachable — `splitSqlStatements` run
  standalone against both new SQL fixture files via an esbuild-bundled script, and
  `xvfb-run -a bunx playwright test tests/ui/clickhouse.spec.ts` run for real, failing only at the
  same Docker image-pull step every other Docker-gated spec hits here.

## RabbitMQ adapter — testing in this environment (P37)

See `docs/ARCHITECTURE.md`'s RabbitMQ section for the adapter's own design facts (no
dependency, the `-management` image requirement, the `%2F` vhost encoding, why `canUpdate`/
`canDelete` are permanently false, poll-requeues-not-consumes). This section is only about running
it here.

- **`tests/db/rabbitmq.spec.ts` needs Docker** (`@testcontainers/rabbitmq`, image
  `rabbitmq:4.3.5-management-alpine`) — same `isDockerAvailable()` gate and the same image-pull
  limitation as every other Testcontainers spec in this sandbox (Docker's daemon is reachable, but
  pulling images through the outbound proxy returns `403`). `tests/ui/rabbitmq.spec.ts` is
  Docker-gated the same way, not unconditional like SQLite's — there is no local-file equivalent
  for a message broker.
- Verified in this sandbox the same way ClickHouse's own hard-to-run pieces were: a standalone
  esbuild bundle exercised against a mocked `fetch` (connect/probe classification, vhost scoping
  and the `%2F` decode, the default-exchange filter, the exact stream-column mapping, publish
  round-trips, every mutation refusal), and
  `xvfb-run -a bunx playwright test tests/ui/rabbitmq.spec.ts` run for real, failing only at the
  same Docker image-pull step every other Docker-gated spec hits here.

Current-state architecture reference: `docs/ARCHITECTURE.md`. The v1 record of what was specified,
phase by phase: `docs/v1/SPEC.md` (see `docs/v1/README.md` for what that folder is and isn't).
