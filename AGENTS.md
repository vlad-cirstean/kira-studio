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
- **The adapter conformance suites are exempt from that bar, not an application of it.**
  `shell/internal/adapters/{postgres,mysqlfamily,sqlite,clickhouse}/*_test.go` are the sole
  successors to the deleted `tests/db/*.spec.ts` files, and nothing else exercises a Go adapter
  capability by capability — `tests/e2e-real/` only spot-checks a scenario or two per kind. Keep
  per-capability coverage there even where it reads like a CRUD round-trip; prune only genuine
  duplication (a case another subtest in the same file already asserts, a pass-through of shared
  `adapters/` logic that has its own test, a setup-only case with no assertion).
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)** —
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc., with a `!` or `BREAKING CHANGE:`
  footer for breaking changes.

## Docker (for `tests/db/` testcontainers)

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
  read-through cache of Docker Hub) is not blocked.** `tests/db/support/*.ts` hardcode plain Hub
  names (`mariadb:11.4`, `clickhouse/clickhouse-server:26.3`, …), so pull the mirrored name once per
  session and re-tag it locally rather than editing any source file:
  ```
  docker pull mirror.gcr.io/library/mariadb:11.4   # official (unnamespaced) image: needs library/
  docker tag mirror.gcr.io/library/mariadb:11.4 mariadb:11.4
  docker pull mirror.gcr.io/confluentinc/cp-kafka:8.0.7   # already namespaced: no library/ prefix
  docker tag mirror.gcr.io/confluentinc/cp-kafka:8.0.7 confluentinc/cp-kafka:8.0.7
  ```
  The rule: a Docker Hub *official* image (no namespace in its plain name — `mariadb`, `mysql`,
  `postgres`, `redis`, `rabbitmq`, `mongo`) lives under `library/` on the real registry, so the
  mirror path needs that prefix; an image that already carries its own namespace
  (`clickhouse/clickhouse-server`, `confluentinc/cp-kafka`, `localstack/localstack`) mirrors at the
  same path with no `library/` inserted. Confirmed for every image this repo uses. ClickHouse needs
  one further workaround on top of the retag — see the ClickHouse section below.
- **Bun's `testcontainers` integration hangs indefinitely in this sandbox** on images that pull and
  run fine under plain Node with the identical image (confirmed fine on a real machine — a Bun-here
  quirk, not a real bug). Postgres is a confirmed instance: `@testcontainers/postgresql`'s default
  wait strategy passes its healthcheck and then `.start()` never resolves under `bun run`, while the
  identical container/strategy/image resolves in ~2s under plain Node. The workaround for any script
  that needs a container from Bun: bundle it with esbuild (`--bundle --platform=node --format=cjs`)
  and run it under the vendored `shell/runtime/node/bin/node`, the way `scripts/run-ipc-backend.sh`
  already does — and copy `tests/db/fixtures/` beside the bundle output, since `tests/db/support/`'s
  seed-SQL reads are `__dirname`-relative, which becomes the bundle's own directory.
  `scripts/capture-postgres-tree.ts` is the manual capture tool built on this, for any `tests/ui/`
  fixture needing a real captured shape ("capture, don't hand-write", P50 D5).

## `tests/ipc/` — building and testing in this environment (P50, updated P57)

See `docs/ARCHITECTURE.md`'s Testing section for what this tier is and why its fixture is generated
rather than hand-written. This section is only about running it here.

- **Neither half needs `xvfb`** — P57 removed Electron, so no `_electron.launch()`-style native
  window is left anywhere in the repo. The frontend half (`bun run test:ipc:fe`) drives Playwright's
  headless Chromium against a static file server, the same way `tests/ui/` does.
- **The backend half needs the vendored Node runtime** (`scripts/vendor-node.sh` →
  `shell/runtime/node/bin/node`). `scripts/run-ipc-backend.sh` bundles each
  `tests/ipc/**/*.backend.spec.ts` with esbuild (`--bundle --platform=node --format=cjs
  --loader:.sql=text --external:@confluentinc/kafka-javascript --external:ssh2
  --external:cpu-features`) and runs each bundle under that Node, one process per spec file,
  sequentially (each file's container helper is a module-scope memo assuming one file per process).
  Required rather than incidental: Bun cannot load some of the adapters this tier drives. The script
  also copies `tests/db/fixtures/` beside the bundle output rather than editing `tests/db/`.
- **Regenerating a fixture**: `KIRA_IPC_FIXTURES=write sh scripts/run-ipc-backend.sh` writes each
  `<adapter>.fixture.ts` via raw `JSON.stringify`; run `bunx biome check --write` on it afterward
  before committing — formatting only, the content doesn't change.
- **All seven adapters' backend halves run for real here** against containers pulled via
  `mirror.gcr.io`. Only ClickHouse needed extra work (its own container helper, below). Kafka's
  capture has one quirk of its own: a read fans across both partitions and interleaves by arrival,
  not by key/offset, so the fixture sorts the captured page by key (`sortStreamByKey`), and the
  consumer group's coordinator host:port is frozen the same way ClickHouse's `.inner_id.<uuid>` is.

## ClickHouse — testing in this environment (P36)

See `docs/ARCHITECTURE.md`'s ClickHouse section for the adapter's own design facts.

- `@testcontainers/clickhouse`'s constructor hardcodes `.withUlimits({nofile: {hard: 262144, soft:
  262144}})`, and this sandbox's own `ulimit -Hn` is fixed at 20000 and cannot be raised even as
  root (a plain `docker run` with no custom ulimits works fine), so a stock container never comes up
  here. `hostConfig` is `protected` on testcontainers' `GenericContainer`, so a small subclass that
  clears `this.hostConfig.Ulimits = []` in its constructor unblocks it —
  `tests/ipc/clickhouse/container.ts`'s `NoUlimitClickHouseContainer`.
  `tests/db/support/clickhouse.ts` can't be reused for this: its `ClickHouseContainer` construction
  is private to its own `start()`, and P50 D1 forbids editing `tests/db/`.

## SQLite — testing in this environment (P35)

- **`tests/db/sqlite.spec.ts` needs no Docker** — `tests/db/support/sqlite.ts` is a temp-file fixture
  (`mkdtemp` + `node:sqlite`), gated by `sqliteAvailable()` the way other specs gate on
  `isDockerAvailable()`. Its only environment dependency is `node:sqlite` itself, which needs Bun
  1.4+/Node 22.5+; an older Bun fails with the legible `SQLITE_UNAVAILABLE_MESSAGE` rather than
  running the suite (this sandbox's Bun 1.4 has it).
- **`tests/e2e-real/sqlite-real.spec.ts` runs unconditionally**, Docker-free by design — a real
  `-tags server` Go binary, a real embedded engine and a real temp-file database driven by a plain
  Playwright tab. It needs the vendored Node runtime and `bun run build:engine` to have run first
  (the two prerequisites `wails-dev-setup.sh` checks).

## Secrets / `KIRA_INSECURE_SECRETS` (P25, moved to Go in P52/P57)

See `docs/ARCHITECTURE.md`'s Storage section for the cipher, the key and the envelope. Here:

- **There is no Linux keychain backend at all** (no `gnome-keyring`/`kwallet` probing), so on Claude
  Code's Linux web containers and any other Linux dev machine set `KIRA_INSECURE_SECRETS=1` before
  launching the app (`bun run dev`, the Go binary directly, or `t.Setenv("KIRA_INSECURE_SECRETS",
  "1")` in a Go test) to opt into the Linux-only development fallback. `tests/e2e-real/`'s fixture
  sets it for every real-backend test.
- Without it, Linux resolves to secret storage being **unavailable** — a password-bearing save fails
  visibly rather than silently falling back to plaintext. Deliberate, not a bug to work around.
- **On macOS the variable is ignored outright** — the real Keychain is used and this can never
  weaken it, even if the variable is accidentally left set. `tests/ui/secrets.spec.ts`'s "keychain
  available" scenario is the guard that this stays true.

## Native Kafka driver — building and testing in this environment (P32, resolved P57)

See `docs/ARCHITECTURE.md`'s Kafka section for *why* (ABI-specific native addon, Bun can't load it
at all). This section is only about running it here.

- **No ABI rebuild step exists or is needed.** The engine — the only process that ever loads this
  addon — runs under a plain vendored Node, so the addon `bun install` built loads exactly as it
  landed on disk. If a future Node major bump ever produces an ABI mismatch, the fix is an ordinary
  `bun rebuild`/`npm rebuild @confluentinc/kafka-javascript` against the vendored Node's own
  version — no `electron-rebuild`, no `CKJS_LINKING` dance, no Electron headers to fetch.
- **A native npm dependency's install script (`node-pre-gyp`, `node-gyp`, …) may silently not run**
  on a newer npm: it default-denies install scripts per package (`npm warn install-scripts … not yet
  covered by allowScripts`) until `npm install-scripts approve <pkg>`. Hit vendoring this driver
  against a freshly-downloaded Node runtime — the first `npm install` silently left
  `build/Release/*.node` missing. Approve, then re-run install (or `npm rebuild <pkg>`).

## Wails v3 / Go — building and testing in this environment (P51, P52, P55)

- **None of this toolchain persists across sessions.** Re-run at the start of any fresh container:
  `apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` (the `wails3` CLI's own Linux
  build needs GTK4 + WebKitGTK headers even though the product targets macOS; without them
  `go install` fails at `internal/operatingsystem` with a `pkg-config` error naming
  `gtk4`/`webkitgtk-6.0`), then `go install github.com/wailsapp/wails/v3/cmd/wails3@<the version
  shell/go.mod pins>` and `export PATH=$PATH:$(go env GOPATH)/bin`. **Pin that version — never
  `@latest`**, which once resolved a beta ahead of `go.mod` and silently skewed the bindings
  generator against the runtime library.
- **`wails.io`/`v3.wails.io` are 403-blocked** — on real macOS hardware too, so this is
  organizational proxy policy, not a sandbox artifact, and the official docs cannot be read from any
  box here. `proxy.golang.org` and `nodejs.org` are both reachable, which is all the Go toolchain
  and `scripts/vendor-node.sh` need. **Read the installed module source under
  `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@<version>/` instead of the docs site** — it
  is the real source for the exact pinned version, and it is how several findings below were
  confirmed rather than assumed.
- **`go test ./internal/...` / `go build ./internal/...` need nothing but the Go toolchain** —
  `mattn/go-sqlite3` is cgo but links only the SQLite amalgamation. Only the root `main` package
  imports Wails and therefore needs the GTK/WebKit headers, so prefer `./internal/...` for a fast
  loop.
- **`wails3 generate bindings -b -i -ts` (run from `shell/`) must happen before any frontend build**,
  not just before `go run .`: `shell/frontend/bindings/**` are real Vite import targets, so missing
  ones fail the build with an unresolvable import rather than a stale-bindings surprise. Regenerate
  whenever a bridge service's method set changes.
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

**P52-P56 findings worth keeping:**

- **`sql.Open("sqlite3", path)` (mattn/go-sqlite3) is lazy** — the file doesn't exist on disk until
  the first real query, so `os.Chmod(path, 0o600)` right after `sql.Open` fails with "no such file
  or directory". The startup pragmas (which force the first real connection) must run before the
  chmod, not after.
- **Comparing a struct that holds an `any` field with `==`/`!=` panics at runtime** ("comparing
  uncomparable type") rather than failing to compile — Go only catches this statically when the
  field's *static* type is already uncomparable, not when it's `any` holding a decoded
  `map[string]interface{}` (e.g. `model.ConnectionState.Caps`). Use `go-cmp` (already a dependency)
  or `reflect.DeepEqual` for any struct with a wire-decoded `any`/`json.RawMessage` field.
- **Three concurrency bugs fixed in `enginehost/host.go` in P54, worth not reintroducing**: don't
  hold the mutex the read loop needs across a blocking `stdin.Write` (a full pipe deadlocks the whole
  host — `writeMu` guards stdin alone); don't run `cmd.Wait()` concurrently with the stdout reader
  (`os/exec`'s own `StdoutPipe` doc calls this incorrect — await `readDone`/`stderrDone` first); and
  an `Events()` that hands out a fresh channel per call but ranges over one shared channel splits
  events between subscribers instead of fanning out (`Subscribe()` keeps a real per-subscriber
  registry).
- **Grep the protocol file for a wire literal instead of inferring it from a TS identifier** —
  `ENGINE_OP.configureCache`'s wire string is `'cache:configure'`, not the
  `'engine:configure-cache'` an earlier plan draft guessed (`src/shared/protocol/engine-ops.ts`).
- **`internal/enginetest`'s shared fixture (`testdata/engine-fixture.mjs`) carries test-only ops
  beyond any plan's table** (`fixture:release-slow`, `fixture:request-count`,
  `fixture:last-connect-config`) — grep for `fixture:` before assuming a plan doc lists them all.
- **A service needing the live `*application.App` at construction time hits a real ordering knot**:
  `application.New` takes the `Services` slice and `ShouldQuit` as arguments, but those need the
  `*App` only `New` returns. The fix used throughout `internal/shell/app.go` is a small struct with
  a nil `*application.App` field, handed out as an interface value immediately, plus an
  `attach(app)` closure called right after `New` (`NewDeferredEmitter`/`NewDeferredDialogs`) — safe
  because nothing can call through before `Run()` starts the renderer.
- **`modifierMap` (`keys.go`) has no `"Control"` entry, only `"Ctrl"`.** `chordToAccelerator`'s
  literal `"Control"` output is an Electron-ism, and a verbatim port makes `SetAccelerator` silently
  log-and-drop. `internal/shell/accel.go` maps `Chord.Ctrl` to `"Ctrl"`; `menu_wails_test.go`
  guards it by checking real parsed accelerators.
- **A bridge service validates its own arguments** even where the service underneath would
  eventually fail less legibly — `bridge/tree.go`'s `Children` rejects an empty `connectionId` with
  `E_BAD_REQUEST`, which `internal/tree.Service` does not. Any new bridge method taking a bare id
  string gets the same explicit guard rather than relying on an accidental good-enough error.

**P57 findings worth keeping:**

- **WebKit *is* installable here — an earlier session's "cannot reach the download host" note does
  not hold in every session.** `bunx playwright install webkit` fetched fine; the only real gap was
  the system libraries it needs to launch (`libevent-2.1-7t64`,
  `libgstreamer-plugins-bad1.0-0`, `libflite1`, `gstreamer1.0-libav` — exactly what Playwright's own
  post-install warning names), fixed with `apt-get`. `bunx playwright install chromium` is needed
  too, for a different reason: a fresh container's preinstalled Chromium is missing
  `chrome-headless-shell` specifically, which is what a project with no explicit `headless` option
  launches. **Treat a blocked download host as worth retrying each session, not a permanent wall.**
- **A tsconfig `"paths"` entry for an absolute-path-shaped specifier (`/wails/runtime.js`) breaks
  Bun's own `mock.module` interception for every file that transitively imports it**, not only the
  file whose tsconfig declares it — confirmed by experiment, real stub file or `.d.ts` alike.
  `tsgo`, by contrast, applies a `"paths"` mapping to every file it reaches. So the fix is
  asymmetric: no `"paths"` entry for this specifier anywhere (Bun's registry handles it at runtime
  via `mock.module`) plus a `@ts-ignore` — not `@ts-expect-error`, which reports as unused under
  `tsconfig.web.json`, where the same import resolves cleanly — at the one import site each in
  `port.ts` and `control.ts`. Biome's `noTsIgnore` rewrites that directive on `bun run format`,
  **including inside prose comments that merely spell the word out**, so the `biome-ignore` goes
  directly above the real directive line and nearby prose has to describe it without quoting it.
- **Every handled bound-call error is a real HTTP 422 under Wails, and that is genuinely new console
  noise Electron never produced.** `pkg/application/transport_http.go` writes
  `StatusUnprocessableEntity` for any bound-call error, handled or not, and the browser logs a
  failed-resource line for it regardless of the page catching the rejection. A test asserting "no
  console noise from a handled error" has to allow that one 422 line — the same precedent
  `mockRuntime.ts` already sets for a benign `/wails/custom.js` 404.
- **`tests/ui/`'s mocked control plane has no `Events.On` (push-event) analogue at all** — a
  structural gap, not a per-scenario fixture gap. `mockRuntime.ts` intercepts only the
  request/response `Call` RPC, so anything the renderer learns exclusively through a live
  subscription can never fire in this tier no matter how the test drives the UI. Known casualties:
  the Operations panel (`state/ops.ts` hydrates once, then relies on `onOpUpdate` push); every
  `global: true` keyboard shortcut (dispatched only by the native menu emitting a Wails event, with
  no renderer-owned keydown fallback the way undo/redo has — and the Command Palette has no button
  either); everything driven by `connectionsChanged` (`state/tabs.ts`'s stale-tab close,
  `project/state/tree.ts`'s `knownConnectionIds` pruning); and the L2/L3 engine-cache budget
  checks, which live in the Node child this tier never starts. The honest response is to drop the
  scenario with this reasoning, or move it to a tier that can reach the real subject (cache-budget
  coverage moved to `tests/unit/engine-cache.spec.ts`) — never to assert against the mock's own
  fixture as if that proved anything.
- **`window.kira` no longer exists** — `contextBridge` was Electron-only, and nothing puts the
  generated `@bindings/*` services on `window` for a test to reach. A spec that used it as a
  UI-driving shortcut must drive the real UI instead; one that used it as a probe of the mock's own
  canned response has no live wire left to query and should say so and drop the check.
- **`mockRuntime.ts`'s `canonical()` sorts only *top-level* keys** — a nested object's key order must
  byte-match the real call's, or a semantically identical fixture still 422s as `E_FIXTURE_MISS`.
  Key order follows however the object was built: a spread-then-reassign of an existing key doesn't
  move it, while a genuinely new key added by the same spread lands at the end. Build a canned
  response's fields in the order the renderer's own builder used, and when in doubt run the test
  once — the `E_FIXTURE_MISS` message echoes `JSON.stringify(callArgs)` verbatim, faster and more
  reliable than deriving the shape by reading call sites.
- **`ControlSnapshot` has an optional `error?: {code, message}` field** (`tests/ipc/support/
  types.ts`, `tests/ui/`-only) for a fixture simulating a genuine business-rule rejection — not a
  schema-validation failure (those never reach the wire) and not an `E_FIXTURE_MISS` (that means the
  fixture is incomplete). No `tests/ipc/**` fixture sets it.
- **Playwright's bundled WebKit reports `navigator.userAgent` as `Macintosh` unconditionally**,
  whatever the real host OS. `renderer/shortcuts/keys.ts`'s `isMac` reads that UA *inside the page*,
  so it disagrees with the runner's own `process.platform` every time on Linux — a
  `process.platform === 'darwin' ? macChord : otherChord` pattern silently picks the wrong chord,
  with no error, just nothing happening. Read the UA from the page
  (`page.evaluate(() => navigator.userAgent.includes('Mac'))`) for any chord the *app* chooses by
  platform. This does not apply to a chord whose platform-dependence is a real OS-level
  input-translation quirk (Control+click becoming contextmenu on macOS) — that stays keyed off the
  actual host.
- **A mock that hardcodes a "doesn't matter for this test" value can silently invalidate a different
  test's whole premise.** `mockStreamBrowser.js` hardcoded `byteSize: 0`, which made every
  retained-bytes assertion in `leaks.spec.ts`/`perf.spec.ts` pass vacuously — found only by tracing
  why a leak assertion still passed after deliberately breaking the code it was meant to catch.
  Fixed by computing real sizes with `src/shared/protocol/page.ts`'s own formula.
- **A ported test's scroll constants can silently stop testing what they claim** once the fixture
  behind them is smaller than the table they were tuned against: a hardcoded `scrollTop` clamps to
  the fixture's own `maxScrollTop` with no failure, so a "0 mutations" result proves the scroll never
  moved, not the invariant. Derive every scroll position from the fixture's own
  `maxScrollTop`/`clientHeight` at test time.
- **`CONNECTION_COLOR_CHOICES` (the offered swatches) is a strict subset of `connectionColorSchema`
  (the storable superset)** — clicking a retired swatch's `data-testid` hangs a test until its action
  timeout, silently, since that element never exists. Check a spec's chosen color against
  `src/shared/domain/connection.ts` first.
- **A plain function call inside a Vue template binding (`v-tooltip="fn(x)"`, not a `computed`)
  defeats any directive that gates its work on reference equality** — a fresh object every render
  fails `binding.value !== binding.oldValue`, so the directive rewrote every header cell's tooltip
  attributes on every re-render, including a pure vertical scroll. Memoize into a `computed`.
- **`internal/metrics`' process matching is coupled to `shell/Taskfile.yml`'s `APP_NAME`**, not just
  to Go code: `AppProcessSet` matches by executable-path substring, so renaming the shipping binary
  without updating `metrics/ticker.go`'s `AnchorNeedles` silently breaks the status bar's RSS/CPU
  figure, and nothing in this repo would catch it.
- **`.github/workflows/` is still Electron-era and its update is still pending** (re-verified this
  pass: the live workflows still reference `safeStorage` and have no Go/bindings steps). A session
  whose GitHub push access lacks the `workflow` OAuth scope has any commit touching
  `.github/workflows/*.yml` rejected by GitHub itself; the intended files sit in
  `docs/v1/plans/p57-pending-ci-workflows/` with a `README.md` of copy-and-apply steps. That
  directory still existing is the signal that the update hasn't landed.

**P58a findings worth keeping** (`docs/v1/plans/P58a-substrate-postgres.md` covers the design and
records the C1 walkthrough in §7):

- **A local op-cancellation context must never be the context passed to a driver that honours
  `context.Context` natively.** pgx does, Node's `pg` does not: handing pgx the already-cancelled op
  context makes it race its own cancel request against the adapter's explicit `pg_cancel_backend` —
  and usually win, dropping the `runningByOp` entry before the authoritative cancel runs, which then
  finds nothing and reports `false` to a caller with no confirmation the query died.
  `adapters.RunWithAbortRace` is the shared fix: the driver call runs on its own goroutine against
  `context.WithoutCancel(ctx)`, while the caller-facing function returns on either that goroutine
  finishing or `ctx.Done()`. Every Go adapter on a context-native driver needs it — see
  `docs/ARCHITECTURE.md`'s per-engine sections for each driver's own reason. Caught only by a
  real-container cancel test against `pg_sleep(30)`; nothing at the unit level exercises real
  driver-level cancellation.
- **A plan's "its only consumer" claim about a shared support file is a snapshot, not a standing
  fact** — `tests/db/support/postgres.ts` had gained four new consumers between the plan's authoring
  and its implementation, so only the named spec was deleted. Re-check real consumers at
  implementation time, especially when other phases landed in between.
- **A newly-written acceptance test can be wrong in the same ways the code it tests can.** Two ported
  scenarios asserted the wrong thing — a "no primary key" case pointed at a table that has one, and a
  post-preview row count that didn't match the seed — both caught immediately by running against the
  real container rather than trusting the port's own self-consistency.
- **A shared Go test fixture must terminate from `TestMain`, not `t.Cleanup`.**
  `testsupport.StartPostgres` wired container termination to whichever `*testing.T` called it first,
  and Go runs that cleanup the instant *that* test returns — so a fixture documented as "one
  container per test binary" actually restarted per test function (~50s vs ~8s). `bun:test`'s
  `afterAll` genuinely waits for the whole file; Go's `Cleanup` does not. Export a `StopPostgres()`
  and call it once after `m.Run()`.
- **Flipping a kind's `nativeKinds` bit is a cross-package breaking change.** Grep the literal kind
  string across `internal/` before flipping it — and check for two distinct uses, which now need two
  different placeholders: a "definitely still forwards to the Node child" placeholder in another
  package's test (guarded since M6.1 by `adapterhost.TestKindNodeServed`), and a scratch/mutation
  value in a live-mutation test (`router_test.go` used `"mariadb"` as a "can't possibly be native"
  value with a `defer delete`, which would have permanently un-nativized it once it really went
  native — now a dedicated `const fakeKind = "kira-test-fake-kind"` that can never become a real
  adapter kind).

**P58b findings worth keeping** (`docs/v1/plans/P58b-mysql-sqlite-clickhouse.md` §12/§13 carries the
full results):

- **Throwaway probes against the real driver before writing adapter code earn their keep — and are
  only as complete as the inputs they tried.** M6.0's probes found MySQL 8.4's `SLEEP()` swallowing
  `KILL QUERY` via its own return value where MariaDB raises `Error 1317` (which changed the
  acceptance suite's choice of long-running statement, not any design decision),
  `modernc.org/sqlite` executing every statement of a multi-statement `Exec` where `node:sqlite`
  drops the tail (so the console's single-statement contract is enforced in the adapter, not relied
  on from the driver), and ClickHouse rejecting a URL-`query=` GET for every statement, not only
  DDL/DML. But SQ-1's "storage-class-faithful, no coercion" conclusion held only for the one garbage
  input it tried: a second probe, written before any adapter code existed, found
  `modernc.org/sqlite` silently re-parsing *valid-looking* date text into a `time.Time` (the
  adapter's workaround and its one remaining console-path trade are in `docs/ARCHITECTURE.md`). A
  probe is not a substitute for testing the adapter's own code against the real driver once it
  exists.
- **If a fixture's main seeded table has a primary key, the "mutate: no primary key" test needs its
  own throwaway table.** The same false-positive pass was written twice — once for Postgres, once for
  the mysql family — by reusing a seeded table that turned out to carry an `AUTO_INCREMENT PRIMARY
  KEY`. (SQLite's fixture already ships a genuine `no_pk_rowid` table, so it didn't recur there.)
- **A server-side liveness poll must check something the checking statement's own text cannot
  satisfy.** ClickHouse's "cancel, asserted server-side" test polled `system.processes WHERE query
  LIKE '%sleep(3)%'` and never saw the target disappear — because the polling query's own SQL
  contains that substring, so it permanently matches itself once ClickHouse makes it visible. Track
  the `query_id`, never a text scan.
- **`tests/e2e-real/*.spec.ts` must be re-run in full after *every* `nativeKinds` flip, not only for
  the kind that just went native** — and, more generally, mocked tiers cannot catch wire-path bugs at
  all. Two real regressions, both invisible to every mocked tier, both found only by driving the real
  built app against a real container:
  - `port.ts`'s `toTypedArray` never grew the base64 branch the plan called for, so every Go-native
    page (base64 chunks, P58 D5) rendered zero rows with **no error anywhere**:
    `Object.values("MTIz")` is per-character, and the result is still a *valid* typed array, just
    empty. Fixed with a `typeof v === 'string'` → `atob` branch.
  - Go's `encoding/json` marshals a nil slice as `null`, not `[]`, and every native adapter builds
    its catalog list fields the idiomatic Go way — so a table with no reverse foreign keys sent
    `referencedBy: null` and threw in a Vue computed. `model.ValidateObjectMeta`/
    `ValidateObjectDefinition` already did that nil-to-`[]` normalization but were wired only into
    `tree/service.go`'s cache-load path; `adapterhost.Router`'s `describeNative`/`definitionNative`
    return the adapter's struct directly and now call it too. That router path is shared by *all*
    native adapters, which is exactly why one kind's flip can break every other kind's wire format.
  - Related trap: `tests/e2e-real/fixtures.ts` was calling a `bun run build:wails` script that no
    longer existed, unnoticed because nothing had run the tier in between. It is easy to go a long
    time without anything invoking this fixture.
- **C1b ran for real** (`tests/e2e-real/mariadb-real.spec.ts`): MariaDB native alongside a
  still-Node-served MongoDB, with MariaDB staying `connected` and serving a real read through a
  fresh `page.reload()` after the Node engine child was actually `SIGKILL`ed, while MongoDB's
  connection flipped to `error` — the first proof of P58 D4's coexistence property in a running app
  rather than only in `adapterhost`'s router tests. `KiraApp.serverPid` exists so a test can find the
  engine child as a real process child (`pgrep -P <serverPid>`) instead of guessing at the vendored
  runtime's binary name.

Current-state architecture reference: `docs/ARCHITECTURE.md`. The v1 record of what was specified,
phase by phase: `docs/v1/SPEC.md` (see `docs/v1/README.md` for what that folder is and isn't).
