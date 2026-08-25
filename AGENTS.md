# Working agreement

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
  Sonnet implements the whole phase → **stop**. Do not roll on into the next phase automatically;
  each phase boundary is a checkpoint.
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
  redirects every blob download to. `docker pull` therefore resolves manifests fine but can never
  actually fetch an image's layers, so `tests/db/`'s testcontainers-backed suites cannot run there
  at all (they hang/fail waiting on a container that never starts). This is an environment network
  policy limit, not a Docker config problem — don't spend time working around it.

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

## Native Kafka driver (librdkafka, P32)

- The Kafka adapter's driver, `@confluentinc/kafka-javascript`, wraps a native NAN addon (built
  against V8's C++ API, not N-API) — it is **ABI-specific per JS runtime**, not portable the way a
  pure-JS dependency is. `bun install` only ever provides a Node-ABI bootstrap build.
- **Electron's ABI is the only one that matters for this app.** `scripts/native-electron-build.sh`
  rebuilds the driver for Electron's own ABI (read from `node_modules/electron/abi_version`) before
  anything that loads it runs — wired as `predev`, `pretest:ui`, `pretest:db:kafka` and
  `prepackage:mac`. It caches a successful build under `.cache/native/confluent-kafka-javascript/<abi>.node`
  and writes a marker beside the built module, so a matching ABI skips the rebuild entirely on
  every run after the first.
- **Never bun.** Confirmed empirically (not just from the docs): Bun cannot load this addon at any
  ABI. Even a matching-ABI build crashes with `undefined symbol: v8::FunctionTemplate::SetClassName`
  when required from Bun. This is why the Kafka adapter suite runs under
  `ELECTRON_RUN_AS_NODE=1 electron` (`bun run test:db:kafka`, `tests/electron-db/kafka.spec.ts` on
  `node:test`/`node:assert/strict`) instead of `bun test tests/db` like every other engine.
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

## SQLite adapter (`node:sqlite`, P35)

- The SQLite adapter and its tests use `node:sqlite`, a Node builtin — **no new dependency, no
  native module, no build step**. It requires **Bun 1.4+, or Electron/Node 22.5+**; it is not in
  Bun 1.3, which is what shows up as `node:sqlite is unavailable in this runtime` from the adapter
  or `SQLITE_UNAVAILABLE_MESSAGE` from the test fixture if you hit it.
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

## ClickHouse adapter (`@clickhouse/client`, P36)

- `@clickhouse/client` (npm) is the app's **first added dependency since the P32 Kafka client
  migration**. Unlike that one, it needs no native build step at all — it's a plain JS client
  talking HTTP, so nothing in the native-Electron-rebuild section above applies to it.
- The client's HTTP interface has **no per-request `database` override** — `database` is set once
  at client construction and embedded in every request's URL query string automatically. Every
  statement the adapter issues relies on that one construction-time default plus fully-qualified
  `` `db`.`table` `` identifiers; don't reintroduce a per-call `database` option, the client's own
  types don't have one.
- **`tests/db/clickhouse.spec.ts` needs Docker** (`@testcontainers/clickhouse`, image
  `clickhouse/clickhouse-server`) — same `isDockerAvailable()` gate as every other Testcontainers
  spec, and the same image-pull limitation applies here as elsewhere in this sandbox (Docker's
  daemon is reachable, but pulling images from Docker Hub through the outbound proxy returns
  `403`). `tests/ui/clickhouse.spec.ts` is Docker-gated the same way, not unconditional like
  SQLite's — ClickHouse needs a real server, there's no local-file equivalent.
- **`canUpdate`/`canDelete` are permanently `false`** for this adapter (`caps.ts`) — a MergeTree
  `PRIMARY KEY` is a sparse index over parts, not a unique row key, so there is no addressable row
  to target. This is a structural fact about the engine, not a gap to fill in later; don't add a
  TODO or a "not yet implemented" framing near it. The grid's `− row` button and inline cell
  editing are both disabled for this connection kind for the same reason, with a tooltip naming it.
- Verified in this sandbox the same way SQLite's own hard-to-run pieces were: real, targeted checks
  against actual dependencies where a live container wasn't reachable — `splitSqlStatements` run
  standalone against both new SQL fixture files via an esbuild-bundled script, and
  `xvfb-run -a bunx playwright test tests/ui/clickhouse.spec.ts` run for real, failing only at the
  same Docker image-pull step every other Docker-gated spec hits here.

Full spec: `docs/v1/SPEC.md`.
