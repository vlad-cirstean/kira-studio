# Dev environment

How to build, run and test this repo in whatever sandbox/container a session happens to be in —
credential and tooling constraints, container quirks, per-subsystem run instructions. Not app
facts: those live in `docs/ARCHITECTURE.md`. Not team process: that lives in `CLAUDE.md`.

## Check the OS at session start

`uname -s`. A real Mac session carries full capabilities and permissions — a push credential with
the `workflow` scope (the `.github/workflows/` restriction below doesn't apply), the real macOS
Keychain, Colima for containers. A Linux sandbox/container session is the constrained case: every
restriction in this file assumes Linux unless its own section says otherwise. Check once, before
assuming a constraint below applies to the current session.

## Git push: `.github/workflows/` changes can't be pushed from a Linux sandbox

On a Linux sandbox session, the git push credential is an OAuth App token without the `workflow`
scope, so GitHub rejects *any* push — including unrelated commits stacked on top — once a commit
touches a file under `.github/workflows/`. GitHub enforces this regardless of what the diff does;
no way to grant the scope from inside such a session. Confirmed not to apply on a real Mac session
(2026-09-12): a Mac session's push credential carries the `workflow` scope, so a commit touching
`.github/workflows/*` pushes normally there — skip the workaround below entirely.

On a Linux sandbox: never commit a change to `.github/workflows/*` directly. Instead:

- **Modifying an existing workflow file**: write the intended diff as a new file under
  `docs/pending-changes/` (create the directory if it doesn't exist) — the target workflow file's
  path as the filename with `.patch` appended (e.g.
  `docs/pending-changes/.github__workflows__release.yml.patch`), containing a normal `git
  diff`-style patch plus a one-line note of why.
- **Adding a whole new workflow file**: write it complete and ready-to-use under
  `docs/pending-workflows/` (see that directory's own `README.md`).

Commit and push either like anything else (neither path is under `.github/workflows/`, so neither
trips the scope check). The user applies it to the real workflow file from an environment with
proper push credentials, and pushes it — then whoever applies it deletes the corresponding
`docs/pending-changes/`/`docs/pending-workflows/` file, in the same commit. An entry still there
means it hasn't been applied yet; don't recreate one that already exists for the same target file,
and don't let this workaround become an excuse to touch workflow files more often than the task
needs.

## Docker (for `packages/db-fixtures/`'s container fixtures, used directly by `apps/kira-studio/tests/e2e-real/`)

- **Claude Code on the web's Linux containers**: `docker` is preinstalled but the daemon isn't
  running and there's no systemd. Start it directly, as root: `nohup dockerd > /tmp/dockerd.log 2>&1 &
  disown`, then check `docker info` / `/tmp/dockerd.log` for `"API listen on
  /var/run/docker.sock"`. Once per fresh container.
- **The other dev environment (macOS) uses Colima** (`colima start`) — not `dockerd` directly, and
  no systemd there either.
- **Docker Hub blob downloads are blocked here.** `production.cloudfront.docker.com` (the CDN every
  Hub blob redirects to) and `quay.io` both 403 through the outbound proxy, so a direct pull
  resolves the manifest but never fetches a layer. **`mirror.gcr.io` is not blocked** —
  `packages/db-fixtures/support/*.ts` hardcode plain Hub names, so pull the mirrored name once per
  session and re-tag it locally rather than editing source:
  ```
  docker pull mirror.gcr.io/library/mariadb:11.4   # official (unnamespaced) image: needs library/
  docker tag mirror.gcr.io/library/mariadb:11.4 mariadb:11.4
  docker pull mirror.gcr.io/confluentinc/cp-kafka:8.0.7   # already namespaced: no library/ prefix
  docker tag mirror.gcr.io/confluentinc/cp-kafka:8.0.7 confluentinc/cp-kafka:8.0.7
  ```
  Rule: a Docker Hub *official* image (no namespace — `mariadb`, `mysql`, `postgres`, `redis`,
  `mongo`) lives under `library/` on the real registry, so the mirror path needs that prefix. An
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
  (`scripts/capture-postgres-tree.ts`, `scripts/capture-tree.ts`) are deleted with it. Capturing a
  genuinely new `tests/ui/` fixture shape needs a one-off capture mode in
  `apps/kira-studio/internal/ipcfixture`'s Go generator, not yet built (only the six committed
  per-adapter fixture generators exist, see below).

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
- **On macOS the app ignores the variable outright** — it uses the real Keychain, so leaving it set
  accidentally can never weaken it. `apps/kira-studio/tests/ui/secrets.spec.ts`'s "keychain
  available" scenario guards this.

## The git module — running and testing it here (G1-G34, updated P79)

See `docs/ARCHITECTURE.md`'s Git module section for what it is and why. This section is only about
running it here.

- **`go test ./apps/kira-studio/internal/git...` needs a real `git` on `PATH` and nothing else** —
  no Docker, no container, no display, no VS Code. Each test builds its own repository under
  `t.TempDir()`, and cases that need `git` self-skip without it. The app's own floor is **git
  2.38** (`merge-tree --write-tree`), so an older `git` skips more than it runs rather than failing
  informatively.
- **`KIRA_HOME` scopes the socket, not just the database.** The listener is
  `${KIRA_HOME}/git.sock` with its flock beside it, so two `KIRA_HOME`s are two fully independent
  backends and a test never contends with a `bun run dev` session's socket. Anything needing a
  server builds one over its own temp `KIRA_HOME` — never the fixed path.
- **The perf probes are opt-in and assert nothing.**
  `KIRA_GIT_PERF=1 go test -run 'TestGraphStreamPerf|TestG8PerfBaseline' ./apps/kira-studio/internal/gitsock/ -v`
  prints one `key=value` line per probe. No threshold assertion, deliberately: this container's
  numbers and a real Mac's aren't comparable, so a hard bound would be flaky in exactly the way
  it's meant to guard against. Record numbers in the commit message and, when they
  answer a stated budget, in `docs/PERF.md`.
- **The FSEvents watcher is `darwin && cgo`** (`internal/gitclient/watcher_fsevents_darwin.go`), so
  a Linux run exercises the `fsnotify` companion instead. Both satisfy the same seam and both are
  covered by `watcher_test.go`; only the darwin backend's own behaviour needs real hardware.
- **The extension's own suites need neither VS Code nor `xvfb`.** `bun run test:webview` builds the
  extension bundle and drives the real emitted webview documents in headless Chromium (a layout
  project asserting rendered box heights, and an interaction project); `bun run test:unit` covers
  the extension's and `packages/git-*`'s in-source specs alongside everything else.
- **The scoped Go race run** for a git-chapter phase is the git packages in play plus
  `internal` itself for the layering test, not the whole tree — `docs/v1.3/SPEC.md`'s own "Full
  verification scope" note fixes the list and the reason. The unscoped tree stays worth running
  occasionally as a backstop, not per phase.
- **A fresh worktree fails `bun run typecheck`/the pre-commit hook on a git-only change**, even
  after `bun install` — `typecheck:web`/`typecheck:tests`/`typecheck:unit` all resolve
  `apps/kira-studio/frontend`'s Wails-generated `@bindings/*` modules, which need
  `scripts/setup.sh`'s full Go+`wails3` install and codegen (below), unrelated to `packages/git-*`.
  For a change confined to `packages/git-core`/`git-ipc`/`git-ui`, verify with `bun run
  typecheck:git` (or the three `tsgo`/`vue-tsc` invocations it chains, run separately) plus each
  touched package's own `bun test` instead of the full `typecheck` — that's the real coverage for
  those packages, and running full `setup.sh` just to commit a git-only fix is disproportionate.
  The pre-commit hook itself still runs the unscoped `bun run typecheck`, so it fails regardless;
  its own header comments a `--no-verify` bypass for exactly this — a change proven correct by the
  scoped checks above, blocked only by an unrelated, unset-up workspace.
- **A fresh `git worktree` in this container can check out an orphaned "Initial commit" scaffold
  instead of the real branch tip.** Hit by 5 of P79's 6 fix batches. It is a provisioning race, not
  data loss — the affected worktree holds nothing of value, confirmed by `git status` and an
  ancestry check *before* any remediation. Recovery inside the isolated worktree is
  `git reset --hard`/`git merge --ff-only`/a fresh branch off the real tip; check what you actually
  have before choosing, and prefer stopping and reporting over self-remediating when the worktree
  might hold real work.
- **Rebasing this chapter's branch onto an advanced base needs `git rebase --rebase-merges`.** A
  plain `git rebase` flattens merge commits and replays every merged batch's individual commits
  linearly, reproducing spurious conflicts against content the branch's own merge commits already
  integrated. With `--rebase-merges` the same rebase replayed exactly one real conflict, once.
  State the shape that makes this apply (a feature branch that carries merge commits of its own),
  not just the flag.

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
  `$(go env GOPATH)/pkg/mod/github.com/wailsapp/wails/v3@<version>/` instead of the docs site** —
  it's the real source for the exact pinned version.
- **No package under `internal/` needs a C compiler on Linux any more** (v1.9 P97 removed
  `internal/codeparse`, this repo's one unconditionally-cgo package). Every remaining cgo call this
  app makes (a handful of darwin-only files in `internal/secrets`, `internal/metrics`,
  `internal/localauth`, and `internal/gitclient`'s own FSEvents watcher) is behind a `darwin && cgo`
  build tag with a real, working `!darwin || !cgo` companion, invisible to a Linux build;
  `modernc.org/sqlite` (the sqlite adapter and the app's own storage) stays cgo-free on every
  platform. `go test ./apps/kira-studio/internal/...` / `go build ./apps/kira-studio/internal/...`
  need no C compiler in this container as a result. Only the `apps/kira-studio` `main` package
  imports Wails and needs the GTK/WebKit headers, so prefer `./apps/kira-studio/internal/...` for a
  fast loop.
- **`GOOS=darwin` cross-compiles here only with `CGO_ENABLED=0`.** A pure-Go package builds and
  vets for `darwin/arm64` from this container (`GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build
  ./…`, exit 0); a cgo one cannot be built for darwin here at all (`CGO_ENABLED=1 GOOS=darwin`
  fails inside `runtime/cgo` with `clang: error: unsupported option '-arch'`), while a real macOS
  build is `CGO_ENABLED=1`. So a `darwin && cgo` file is compiled, vetted and tested by nobody
  until a human builds on a Mac. Treat that as a **design** constraint, not just a testing gap: for
  code whose whole purpose is to work on a path nobody exercises interactively, prefer a pure-Go
  implementation this container can build and test — `internal/startupfail` chose an argv-only
  `osascript` spawn over a cgo `NSAlert` shim for exactly this reason, and it's checkable in CI as
  a result.
- **Regenerate bindings via `wails3 task common:generate:bindings`** (or `scripts/setup.sh`, which
  calls it) — never a hand-typed `wails3 generate bindings` flag list, which has already drifted
  from the task's real flags once. `scripts/setup.sh` now calls the task **unconditionally on every
  run**; a CLI/toolchain-identity stamp only decides whether Task's own checksum cache gets wiped
  first, so a plain `bun run setup` always spends the task's own up-to-date check (~0.2s when
  nothing changed, ~7s on a real source change) rather than skipping it. `apps/kira-studio/frontend/bindings/**` are real Vite import
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

## Playwright UI tier — `webkit` needs fetching explicitly

This container ships only Chromium preinstalled. `bunx playwright install webkit` downloads the
browser itself; its own post-install warning names the missing system libraries (`apt-get install
libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1 gstreamer1.0-libav` at the time of
writing) — install exactly those, not a generic `playwright install-deps`, which pulls far more
than `webkit` alone needs.

## `golangci-lint` / `knip` — code-quality tooling in this environment (P94)

See `CLAUDE.md`'s `docs/v1.8/plans/P94-code-quality-tooling.md` for what these tools check and why
the pass split. Here: the container quirk that blocked two prior attempts, and the pre-commit/
pre-push design.

- **The preinstalled `/usr/local/bin/golangci-lint` (2.5.0, built with go1.25.1) refuses this repo**
  outright: `go.mod` pins `go 1.27.1`, and golangci-lint's config loader rejects targeting a Go
  version newer than the one it was itself built with. `go install .../golangci-lint@latest` does
  not fix this — it produces a binary built with **go1.26.8**, one minor version short, every time.
- **Why:** `go version` in this container reports `go1.27.1` only because `GOTOOLCHAIN=auto` reads
  *this repo's* `go.mod` and downloads that toolchain on demand for commands run inside the module.
  `GOTOOLCHAIN=local go version` reports the container's real default: **go1.24.7**. `go install
  pkg@version` runs in module-aware mode *ignoring the current module* — it resolves only
  golangci-lint's own `go.mod` directive (`go 1.26.0`, no `toolchain` line), and `auto` downloads
  the minimum toolchain satisfying that — go1.26.8, not the 1.27.1 already sitting in the module
  cache. `@latest` doesn't help either; it just moves which release hits the same gap.
- **The fix**, pin `GOTOOLCHAIN` explicitly to the version this repo actually wants, on the install
  itself:
  ```sh
  GOTOOLCHAIN=go1.27.1 go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.2
  ```
  `scripts/install-golangci-lint.sh` does exactly this, validating a cached `GOPATH/bin` binary
  against the pinned version+toolchain string before trusting it (the same pattern
  `scripts/setup.sh` already uses for `wails3`). No `go.mod` change, no Go version bump, no source
  checkout needed — install only, same as any other `go install` target.
- **No prebuilt release binary works, and neither does `golangci-lint-action`.** Every official
  v2.13.2 release binary is itself built with go1.26.8 and fails identically. Build from source
  everywhere, including CI — `actions/setup-go` with `go-version-file: go.mod` already makes 1.27.1
  the runner's default toolchain there, so a plain `go install` in CI already builds correctly; the
  `GOTOOLCHAIN` pin in the script is belt-and-braces so the same one command works locally too.
- **Pre-commit stays exactly `bun run lint` + `bun run typecheck`** (~15s) — golangci-lint and knip
  are deliberately not in it. `golangci-lint`'s cost is bimodal: ~1s warm, but minutes on a cold Go
  build cache (fresh clone, dependency bump, toolchain change) — a per-commit hook with a multi-
  minute p99 gets routed around with `--no-verify`, which `CLAUDE.md` forbids as a way of finishing.
  `knip` is a whole-graph analysis; gating it per commit punishes a normal, legible multi-commit
  refactor (deleting a consumer in one commit, adding its replacement in the next). Both instead run
  in the new `.githooks/pre-push` hook (`bun run lint:go`, `bun run lint:dead`, ~30s warm) — push is
  when work leaves the machine, the same boundary CI defends — and in CI's `checks` job.

## A pre-P97 dev box still has orphaned repo-map files on disk

The app has never shipped, so migration 0025 is a plain forward drop with no installed base to
preserve (`docs/ARCHITECTURE.md`'s Storage section) — nothing cleans up a dev box's own leftovers
from before v1.9 P97. If this container (or a persistent dev machine) ran a pre-P97 build, delete
by hand: `${KIRA_HOME}/codeindex.db*` (the tree-sitter parse cache), `${KIRA_HOME}/codeindex-sync-
*.lock` (its per-repository sync flocks) and `${KIRA_HOME}/mcp-repo-map-*-token.json` (the repo-map
MCP tokens). No runtime cleanup code is shipped for this — a permanent housekeeping path in a
shipping app would be permanent code for a one-off developer chore.

## Database MCP server — reaching it in this environment (M1-M5)

This server exists only inside the app process: `apps/kira-studio/cmd/` holds only `g1measure`, and
`package.json` has no `mcp:*` script for it.

- **No headless binary and no `bun run mcp:*` script exists for it.** The only ways to reach it here
  are `bun run dev` (needs a GUI this container does not have) or a `go build -tags server` boot
  proof — the same `//go:build server` route documented above for the bound-call surface. M5's own
  verification did exactly that and drove a real `dbmcp` endpoint with `curl`.
- Its token is `${KIRA_HOME}/mcp-db-token.json` — no repo slug, one per `KIRA_HOME`
  (`internal/bridge/dbmcp.go`'s `dbMcpTokenName`, via `mcpauth.PathNamed`) — and it carries a 7-day
  expiry since M1 (`mcpauth.TTL`).
- Its port is `DefaultPort` **8766** (`internal/dbmcp/server.go`), with an ephemeral fallback on
  conflict (`net.Listen` retried on `127.0.0.1:0`) — read the actually-bound port off the process's
  own startup output, not off this example.
- Its endpoint is `http://127.0.0.1:<port>/mcp`, an ordinary `go-sdk/mcp` Streamable HTTP server
  (`internal/dbmcp/http.go`'s `bindHTTP`) — a JSON-RPC 2.0 `tools/call` POST with an `Authorization:
  Bearer <token>` header reaches it the same way any MCP Streamable HTTP client would; the SDK's own
  client package is the reference for the exact request shape (`Content-Type`/`Accept` framing) if
  driving it with a raw `curl` rather than a real MCP client.
