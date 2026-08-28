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

## Electron binary (for `tests/e2e/`)

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
  test --project=ipc-frontend`) for the same reason every other `tests/e2e/`-style Playwright run
  does on a display-less Linux container: `xvfb-run -a bunx playwright test --project=ipc-frontend`.
  It needs no Docker, no container and no native driver — confirmed here for mariadb, mysql, redis,
  rabbitmq and sqs.
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

## Secrets / `KIRA_INSECURE_SECRETS` (for password-bearing `tests/e2e/` specs, P25)

- Credentials are encrypted via Electron's `safeStorage`, which is Keychain-backed on macOS and
  has **no real backing store on Linux** — a bare Linux dev/CI container has no `gnome-keyring` or
  `kwallet` daemon (no systemd, see the Docker note above), so `safeStorage.isEncryptionAvailable()`
  is `false` there by default.
- **On Claude Code's Linux web containers and any other Linux dev machine**: set
  `KIRA_INSECURE_SECRETS=1` before launching the app (`bun run dev` or the Playwright harness) to
  opt into a Linux-only development fallback (Chromium's `basic_text` obfuscation — a hardcoded
  key, not real encryption). `tests/e2e/fixtures.ts` already sets this for every test by default,
  so the normal `xvfb-run -a bun run test:e2e` loop needs no extra step; it only matters for a
  manual `bun run dev` session or a one-off `electron out/main/index.js` launch outside the test
  harness.
- **On macOS**, this variable is ignored outright — `safeStorage` uses the real Keychain and
  `KIRA_INSECURE_SECRETS` can never weaken it, even if accidentally left set in an environment.
  `tests/e2e/secrets.spec.ts`'s scenario 1 is the guard that this stays true: it fails loudly
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
  anything that loads it runs — wired as `predev`, `pretest:e2e`, `pretest:db:kafka` and
  `prepackage:mac`. It caches a successful build under `.cache/native/confluent-kafka-javascript/<abi>.node`
  and writes a marker beside the built module, so a matching ABI skips the rebuild entirely on
  every run after the first.
- **Claude Code's Linux web containers**: `electron-rebuild` (what `native-electron-build.sh` calls
  to do the real work) needs to download Electron's C++ headers from `artifacts.electronjs.org` —
  this specific proxy 403 has been observed to come and go across sessions in this environment (it
  was gone by P50), so treat it as worth retrying rather than a permanent wall. The header fetch
  succeeding still isn't the whole story here: `@confluentinc/kafka-javascript`'s own build
  (`util/configure.js`) passes librdkafka's `mklove` configure script `--install-deps
  --source-deps-only --enable-static`, which always tries to build zlib/libcurl/libcrypto/zstd
  from source rather than looking at system packages first — and two of those source tarballs
  (`zlib.net`, `curl.se`) are hosts this environment's proxy hard-blocks (403 on the CONNECT
  itself, confirmed via the proxy's own `__agentproxy/status` recent-failures log), regardless of
  what dev packages are installed. **The fix**: `util/configure.js` reads `CKJS_LINKING` — set to
  `dynamic`, it passes `./configure` no flags at all, which links dynamically against the system's
  own `libssl-dev`/`zlib1g-dev`/`libcurl4-openssl-dev` (already present, or `apt-get install`-able)
  instead of vendoring anything, so it never touches the two blocked hosts:
  `CKJS_LINKING=dynamic bunx electron-rebuild --only @confluentinc/kafka-javascript`. Confirmed:
  `ldd` on the resulting `.node` resolves every shared library, it loads under
  `ELECTRON_RUN_AS_NODE=1 electron`, and `bun run test:db:kafka` (all 21 cases) and this phase's
  own `tests/ipc/kafka/kafka.backend.spec.ts` both pass against a real broker. Cache the result the
  same way `native-electron-build.sh` does (`cp` the built `.node` to
  `.cache/native/confluent-kafka-javascript/<abi>.node`, write the ABI to the `.native-abi` marker)
  so later runs in the same session skip the rebuild.
  `native-electron-build.sh` backs up the existing `.node` file before attempting a rebuild and
  restores it on failure, specifically because `node-gyp`/`electron-rebuild` deletes
  `build/Release` *before* attempting the build — without the backup, a failed rebuild attempt in
  an unsupported environment would destroy the Node-ABI bootstrap binary `bun install` provided,
  corrupting `node_modules` rather than just failing cleanly. `native-electron-build.sh` itself
  doesn't yet set `CKJS_LINKING=dynamic`, so a plain `predev`/`pretest:e2e`/`pretest:db:kafka` run
  still hits the from-source path here; export the variable before invoking it (or the underlying
  `electron-rebuild` command directly, as above) until the script itself is updated.

## SQLite adapter — testing in this environment (P35)

See `docs/ARCHITECTURE.md`'s SQLite section for what the adapter itself relies on
(`node:sqlite`, runtime version floor). This section is only about running it here.

- **`tests/db/sqlite.spec.ts` needs no Docker.** `tests/db/support/sqlite.ts` is a temp-file
  fixture (`mkdtemp` + `node:sqlite`), not a Testcontainers harness — there is no container to
  start, no image to pull, no daemon to reach. Its only environment dependency is `node:sqlite`
  itself, gated by `sqliteAvailable()` the same way every other DB spec here gates on
  `isDockerAvailable()`.
- **`tests/e2e/sqlite.spec.ts` runs unconditionally** (no Docker gate at all) — the one DB-backed e2e
  spec that actually executes in Claude Code's own Linux web container, where every other engine's
  e2e spec self-skips for lack of Docker. This sandbox's system Node (`/opt/node22`, 22.22+) has
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

Current-state architecture reference: `docs/ARCHITECTURE.md`. The v1 record of what was specified,
phase by phase: `docs/v1/SPEC.md` (see `docs/v1/README.md` for what that folder is and isn't).
