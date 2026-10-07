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

## The user cannot run anything in the sandbox

No shell, commands, kill, manual cleanup, tests or scripts in this container. An agent runs it, or
hands it off to the user's own machine/VM. Never ask the user to run a command in the sandbox.

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
  `docs/pending-workflows/` (create the directory if it doesn't exist).

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
- **The Docker module's real-engine test needs the daemon up** (P200): `go test -race -v
  ./internal/docker/... ./internal/shell/...`; `TestEngine` skips without `dockerd`, so confirm it
  shows `--- PASS`, not `SKIP`.
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
  half (`bun run test:ipc:fe:studio`) drives headless Chromium against a static file server, the same way
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
  driven by a plain Playwright tab. Prerequisites (`scripts/setup.sh`, `bun run build:studio`, and
  `go build -tags server`) are memoized per worker process by
  `apps/kira-studio/tests/e2e-real/fixtures.ts`'s `buildPrerequisites()`.

## Secrets / `KIRA_INSECURE_SECRETS` (P25, moved to Go in P52/P57)

See `docs/ARCHITECTURE.md`'s Storage section for the cipher, the key and the envelope. Here:

- **There is no Linux keychain backend at all** (no `gnome-keyring`/`kwallet` probing) — set
  `KIRA_INSECURE_SECRETS=1` before launching the app (`bun run dev:studio`, the Go binary directly, or
  `t.Setenv("KIRA_INSECURE_SECRETS", "1")` in a Go test) on any Linux box to opt into the dev-only
  fallback. `apps/kira-studio/tests/e2e-real/`'s fixture sets it for every real-backend test.
- Without it, Linux secret storage is **unavailable** — a password-bearing save fails visibly
  rather than silently falling back to plaintext. Deliberate, not a bug to work around.
- **On macOS the app ignores the variable outright** — it uses the real Keychain, so leaving it set
  accidentally can never weaken it. `apps/kira-studio/tests/ui/secrets.spec.ts`'s "keychain
  available" scenario guards this.

## The git module — running and testing it here (G1-G34, updated P79; moved to Kira Space, P100)

See `docs/ARCHITECTURE.md`'s Git module section for what it is and why. This section is only about
running it here. **As of v1.9 P100, the whole module lives under `apps/kira-space`, not
`apps/kira-studio`** — every path and env var below was retargeted at Part 1/Part 2, not left as
historical prose.

- **`go test ./apps/kira-space/internal/git...` needs a real `git` on `PATH` and nothing else** —
  no Docker, no container, no display, no VS Code. Each test builds its own repository under
  `t.TempDir()`, and cases that need `git` self-skip without it. The app's own floor is **git
  2.38** (`merge-tree --write-tree`), so an older `git` skips more than it runs rather than failing
  informatively.
- **`KIRA_SPACE_HOME` scopes the socket, not just the database.** The listener is
  `${KIRA_SPACE_HOME}/git.sock` with its flock beside it, so two `KIRA_SPACE_HOME`s are two fully
  independent backends and a test never contends with a `bun run dev:space` session's socket.
  Anything needing a server builds one over its own temp `KIRA_SPACE_HOME` — never the fixed path.
  Never `KIRA_HOME` (Kira Studio's own env var) — the two apps' homes are fully separate as of
  P100, so setting the wrong one silently talks to the wrong app's storage, or none at all.
- **A test binary panics if it resolves an app home with `KIRA_HOME`/`KIRA_SPACE_HOME` unset** (`kirapaths.Home`, non-`production` builds). A package whose tests reach one calls `testx.RunWithTempHomes` from `TestMain`.
- **`bun run dev:space` runs Kira Space's own dev loop** (`cd apps/kira-space && wails3 task dev`)
  — a separate native window/process from `bun run dev:studio`'s Kira Studio, on its own Vite dev-server
  port (9246, beside Kira Studio's 9245) so both can run at once without colliding.
- **The perf probes are opt-in and assert nothing.**
  `KIRA_GIT_PERF=1 go test -run 'TestGraphStreamPerf|TestG8PerfBaseline' ./apps/kira-space/internal/gitsock/ -v`
  prints one `key=value` line per probe. No threshold assertion, deliberately: this container's
  numbers and a real Mac's aren't comparable, so a hard bound would be flaky in exactly the way
  it's meant to guard against. Record numbers in the commit message and, when they
  answer a stated budget, in `docs/PERF.md`.
- **`bun run perf:http:studio` probes the HTTP response viewer** (P160, `tests/perf/`, Playwright
  project `perf`, in no suite script). Builds the production bundle (`build:studio` overwrites
  `frontend/dist`; `test:ui:studio` rebuilds its own test bundle). `KIRA_PERF_RUNS` (default 3) runs
  per case, `KIRA_PERF_CASES=json,text-1line` narrows. 12 cases: 4 body shapes x 2.4/5/12 MB. Gate:
  run only at `load1 <= 1.0` (`/proc/loadavg`); each run line prints `load1` (includes the probe's own browser, ~1.0 extra, so a reading up to ~2 during a run is normal; check the gate before starting).
  Output is `key=value` per run plus a median `summary` per case. RSS is Linux-only and sums every
  browser process under the test worker.
- **`bun run perf:parse:studio` probes every large-input parse caller** (P163,
  `tests/perf/parse-callers.spec.ts`, same `perf` project and gate). Cases: `req-body-json`,
  `req-body-xml`, `grpc-json` (0.5/5 MB, `KIRA_PERF_SIZES_MB`), `console-format` (64/236/1024 KB),
  `doc-fieldnames`, `console-copy-all-json|shell`, `pure-fns` (pure callers timed in-page via a
  `bun build` bundle served at `/__pure.js`; WebKit timers are 1 ms), `worker-costs`.
  `KIRA_PERF_CASES`, `KIRA_PERF_RUNS` as above. Editors are seeded in-page by a synthetic paste:
  the Playwright WebKit transport breaks on any message over 512 KB. A before run needs a second
  worktree at the older commit with the probe files copied over. This sandbox's `load1` swings 1-8
  with nothing of ours running (host steal): read the per-run `load1`, rerun a case that matters.
- **`bun run perf:documents:studio` probes the Documents list scroll** (P161, `tests/perf/documents-scroll.spec.ts`,
  same `perf` project). 5 000 Mongo documents, ~160 px expanded rows, real wheel input. Cases `ladder`
  (momentum), `flick` (80 x 9 600 px), `flick-up`; `KIRA_PERF_CASES`, `KIRA_PERF_RUNS` as above. Prints
  frame p50/p95/max, frames over 50 ms and rendered-band coverage per run. Same gate. Run through the
  repo's own Playwright (`node node_modules/.bin/playwright`): the global `/opt/node22/bin/playwright`
  reports "No tests found".
- **The FSEvents watcher is `darwin && cgo`** (`apps/kira-space/internal/gitclient/watcher_fsevents_darwin.go`), so
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
- **A fresh worktree fails `bun run typecheck`/the pre-commit hook on any change**, even after
  `bun install` — `typecheck:web:studio`/`typecheck:space-web`/`typecheck:tests:studio`/
  `typecheck:space-tests`/`typecheck:unit:studio`/`typecheck:space-unit` all resolve one of the two
  apps' frontends' Wails-generated `@bindings/*` modules, and `go build ./...` (pre-push) fails
  separately on `//go:embed all:frontend/dist` finding no built frontend. **Run
  `sh scripts/prepare-worktree.sh` once per fresh worktree** (below) — it closes both gaps plus the
  Linux-only `wails3` CLI build deps, idempotently. `scripts/prepare-dev-environment.sh` runs it
  together with `scripts/codegraph-setup.sh` (CodeGraph section, below) — the one command for a
  worktree that also needs the code index. For a change confined to
  `packages/git-core`/`git-ipc`/`git-ui` where running the full script is disproportionate, verify
  instead with `bun run typecheck:git` (or the five `tsgo`/`vue-tsc` invocations it chains, run
  separately) plus each touched package's own `bun test`; the pre-commit hook itself still runs the
  unscoped `bun run typecheck`, so it fails regardless — its own header comments a `--no-verify`
  bypass for exactly that narrower case.

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
- **`CodeWorkspaceService.ImportRepo` cannot succeed in this container, by design, not as a sandbox
  quirk** (P129 Part 5's own `§6.1` live check): `gitclient.NewPlatformLocator()` returns
  `unsupportedLocator` on every non-darwin `runtime.GOOS`, whose `Locate` always reports `notFound`
  regardless of a configured `git.path` — this app's git *discovery* is macOS-only by its own design
  comment ("docs/v1.3/SPEC.md, macOS only"), so `ImportRepo`'s `Discovery.Status` gate can never pass
  here. `AdeTaskService`'s own git operations (`StartRun`, `Archive`, …) do **not** go through that
  gate — they read `settings.Git.GitPath` directly
  (`main.go`'s `adeGitPathSetting`) and run real git via `gitclient.Run` unconditionally. A live
  check against a real repo therefore: (1) inserts a `model.CodeRepo` row directly (a throwaway
  `internal/storage`/`internal/storage/repos` Go program, `repos.New(db.DB)` then
  `CodeRepos.Create`, against the same `KIRA_SPACE_HOME` the server will open, run with the server
  stopped), bypassing `ImportRepo` entirely; (2) calls `SettingsService.Set` with
  `{"git":{"gitPath":"/usr/bin/git"}}` once the server is up, since the default `git.path` setting
  is `""` and `exec.CommandContext(ctx, "", …)` fails outright (or seed the `settings` row
  alongside the windows / code_repos rows: `INSERT INTO settings (key, value) VALUES ('git.path',
  '"/usr/bin/git"')`; without it `StartRun` fails `E_INTERNAL … exec: no command`); (3) drives
  `AdeTaskService`'s bound calls as usual. The `/wails/runtime` POST body for a bound call, driven with a plain `curl` (no
  browser, no `wails3` client): `{"object":0,"method":0,"args":{"call-id":"<uuid>","methodName":
  "github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge.<Service>.<Method>",
  "methodID":0,"args":[<positional JSON args>]}}` — `object:0`/`method:0` select Wails v3's own
  `Call`/`CallBinding` request kind (`pkg/application/messageprocessor.go`'s `callRequest`/
  `messageprocessor_call.go`'s `CallBinding`, both `0`); the response body is the bound method's
  own return value marshaled directly, no envelope.
- **The session's own auto-mode permission classifier blocks `git remote set-url`/`git remote add`
  outright, even against a disposable scratch repo built for a live check** (P129 Part 6's own
  `§6.1`) — flagged as a "Remote Repoint" regardless of intent. A live check that needs a
  GitHub-shaped `origin` to exercise a GitHub-gated code path (`githubRepo`'s own host check,
  `gh.go`) cannot repoint an existing scratch remote to fake that shape in this environment; plan
  around it (seed the scratch repo with the right remote URL from the start, before it exists as a
  git remote at all) or fall back to reading the gate's own source plus its existing unit coverage,
  rather than spending a retry loop on the same denied action.

## Wails v3 / Go — building and testing in this environment (P51, P52, P55)

- **None of this toolchain persists across sessions.** Re-run at the start of any fresh container:
  `apt-get update -qq && apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config` (needed even though the product
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
- **No package under either app's `internal/` needs a C compiler on Linux any more** (v1.9 P97
  removed `internal/codeparse`, this repo's one unconditionally-cgo package). Every remaining cgo
  call either app makes (a handful of darwin-only files in Kira Studio's own `internal/secrets`,
  `internal/localauth`, repo-root `internal/metrics` (P116 H4: shared between both apps' own
  metrics tickers), and Kira Space's own `internal/gitclient`'s FSEvents watcher) is behind a
  `darwin && cgo` build tag with a real, working `!darwin || !cgo` companion, invisible to a Linux
  build; `modernc.org/sqlite` (the sqlite adapter and each app's own storage) stays cgo-free on
  every platform. `go test ./apps/kira-studio/internal/...` /
  `go build ./apps/kira-studio/internal/...` (and the `apps/kira-space` equivalents) need no C
  compiler in this container as a result. Only each app's own `main` package imports Wails and
  needs the GTK/WebKit headers, so prefer `./apps/kira-studio/internal/...` or
  `./apps/kira-space/internal/...` for a fast loop.
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
  nothing changed, ~7s on a real source change) rather than skipping it. Each app's `frontend/bindings/**` are real Vite import
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

## Kira Space real backend in a sandbox — server-tag recipe (P126)

Build: `go build -tags server ./apps/kira-space/...` (Wails v3/Go's own `server` platform, above),
temp `KIRA_SPACE_HOME`, `WAILS_SERVER_HOST=127.0.0.1`.

- **Seed `windows('main')` plus a `code_repos` row before navigating to `/?window=main`.** A server
  build serves bound calls over TCP with no webview and no native shell — nothing creates the
  `windows` row a real GUI boot would. Without it the boot call fails `unknown window: main`
  (`internal/appstorage/tabs.go:117`). Insert both rows into the SQLite DB under `KIRA_SPACE_HOME`
  directly before the first request.
- **Git discovery is darwin-only** (`apps/kira-space/internal/gitclient/discovery.go`,
  `NewPlatformLocator`): on any other `runtime.GOOS`, `unsupportedLocator.Locate` always returns
  `false`, so real git features never come up in this recipe as shipped. Exercising them needs a
  throwaway local patch to `Locate` returning a real `git` binary path — **never commit that
  patch**; revert it before finishing the session, same as any other sandbox-only workaround.
- **A fresh or reused worktree needs `bun run setup` before typecheck, unit tests, knip or a push.**
  Bindings are gitignored; a stale set (e.g. a removed `SetAgentAware`, a new `DockerService`) breaks
  `typecheck`, `test:unit` and the pre-push `lint:dead` (knip). Run it in the worktree you push from,
  then push again if the hook failed on missing bindings.
- **The ADE v2 flows need no `Locate` patch** (P148 live run): seed `code_repos`, `windows('main')` and
  `git.path` rows, and the board, runs, Take over, archive and dialogs all work.
- **`claude -p` blocks a standalone `sleep N` and backgrounds it**, so the run ends `ended without
  finish_step`. A live-run step that must stay running prompts `until [ -f <flag> ]; do sleep 2; done`.
  Kill leftover `claude` TUI processes after a run.
- **A reused server-tag harness home keeps persisted tabs.** A stale repo-graph tab in `tabs` makes a
  fresh run open the old graph; delete the row before reuse (P203).
- **An interactive `claude` cannot sign in here** (P149, 2.1.289): a fresh TUI stops at the theme picker,
  then the login menu. `claude -p` works. To exercise the Stop hook path, read the launched process's
  `/proc/<pid>/environ` (`KIRA_AGENT_HOOK_TOKEN`, `KIRA_TERMINAL_ID`) and argv (`--settings <hooks.json>`),
  then pipe `{"hook_event_name":"Stop","session_id":"<id>","cwd":"<cwd>"}` into the `hook` shim next to
  that `hooks.json` with the same env.
- **The server-tag build drops terminal output**: `EmitTo(windowKey)` needs a native window
  (`internal/shell/wails.go`), so a TUI tab stays blank. Sessions, hooks and the DB still work.
- **A fake `gh` or `claude` needs a `HOME` override** (P150). PTY login shells reorder `PATH`, so a prefix
  set in the server's env is lost. Point `HOME` at a dir whose `.bash_profile` prepends the fake bin dir,
  then confirm with `/proc/<pid>/cmdline`. Discovery uses `exec.LookPath` for `gh`.
- **Review smoke seeding** (P150): `code_repos.repo_id` is the repo path; copy sample workflows into
  `<home>/workflows`; task rows need `current_stage_json`. To patch git discovery without touching source,
  build with a `-overlay` JSON replacing the discovery file.
- **In harness scripts never `pkill -f` or `pgrep -f` a pattern that appears in your own command line**
  (e.g. `claude --session-id`): it kills the calling shell. Anchor it (`pgrep -f '^claude --session-id'`).

## Playwright UI tier — `webkit` needs fetching explicitly

This container ships only Chromium preinstalled. `bunx playwright install webkit` downloads the
browser itself; its own post-install warning names the missing system libraries (`apt-get install
libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1 gstreamer1.0-libav libavif16` at the time of
writing) — install exactly those, not a generic `playwright install-deps`, which pulls far more
than `webkit` alone needs.

`scripts/prepare-ui-tests.sh` (called by `scripts/prepare-dev-environment.sh`) does both
automatically: idempotent, skips when the browser and all five packages are present. Set
`KIRA_SKIP_WEBKIT=1` to skip. Failure (offline, apt error) warns with the manual commands and
exits 0. It overrides `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` for that one install only.

## Memory MCP and the `claude` CLI (P201)

- `KIRA_MEMORY_HOME` scopes `memory.db` (default `~/.kira-memory`). `testx.RunWithTempHomes` sets it
  for test binaries.
- Smoke against the real CLI, not in CI: `go test -tags claudesmoke ./internal/memory/ -run Smoke -v`.
  Needs an authenticated `claude` on `PATH` (`claude -p` works here, CLI 2.1.292; ~14 s, a few cents).
  The gate uses `--safe-mode --setting-sources "" --strict-mcp-config --tools "" --no-session-persistence`;
  never `--bare`, it forces API-key auth.
- MCP path: `go build -tags server ./apps/kira-space`, then `claude -p --mcp-config <file>
  --strict-mcp-config` with a `stdio` server `{command: <binary>, args: ["memory-mcp"], env:
  {KIRA_MEMORY_HOME: <tmp>}}`. `printf '' | <binary> memory-mcp` exits 0. The macOS app-bundle binary
  is unchecked (Known open items).

## `tests/visual/*` pixel diffs — a sandbox font-package mismatch, not a code regression

The `visual` Playwright project's baselines are captured on a specific CI Ubuntu image (P6 plan
§2(a)/(c), `tests/visual/support/pin-fonts.css`'s own header comment) — a "CI-Linux-only baseline
policy" precisely because even same-OS machines can disagree on font rendering. A sandbox/container
session's own font packages can still differ from that CI image's (`fc-match sans-serif`/`fc-match
monospace` resolve to whatever's installed here — DejaVu Sans/DejaVu Sans Mono at the time of
writing, not necessarily the CI image's own resolution), which reads as a small (1-4% of pixels),
uniform, whole-page glyph-antialiasing diff across every `tests/visual/*` spec — a chromatic-fringe
texture on text, not a layout/element-position regression. Before concluding a `tests/visual/*`
failure is a real regression: check whether the diff is this uniform text-rendering signature
(every glyph on the page, not one specific element) rather than an element moving/resizing/changing
color — the former is this sandbox's font drift, not a bug, and `--update-snapshots` run from here
would corrupt the real CI baseline with this container's non-canonical rendering rather than fix
anything. Confirmed 2026-09-22 (v1.9 P104 Stream A verification). v2.1 added real content changes on
top of the drift (fourth Studio mode tab, Space Claude Code settings item, quick-commands dialog), so
those baselines need one regeneration on the CI-Linux setup, not just a drift dismissal.

## `golangci-lint` / `knip` — code-quality tooling in this environment (P94)

See `docs/v1.8/plans/P94-code-quality-tooling.md` for what these tools check and why
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
  in the `.githooks/pre-push` hook (`go build ./...`, `bun run lint:go`, `bun run lint:dead`, ~30s
  warm) — push is
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
  are `bun run dev:studio` (needs a GUI this container does not have) or a `go build -tags server` boot
  proof — the same `//go:build server` route documented above for the bound-call surface. M5's own
  verification did exactly that and drove a real `dbmcp` endpoint with `curl`.
- Its token is `${KIRA_HOME}/mcp-db-token.json` — no repo slug, one per `KIRA_HOME`
  (`internal/bridge/dbmcp.go`'s `dbMcpTokenName`, via `mcpauth.PathNamed`) — and it carries a 7-day
  expiry since M1 (`mcpauth.TTL`).
- Its port is always `DefaultPort` **8766** (`internal/dbmcp/server.go`). A conflict on that port
  fails the enable outright with a message saying another process is using it — `bindHTTP` never
  falls back to a different, kernel-assigned port (`docs/ARCHITECTURE.md`'s DB MCP section).
- Its endpoint is `http://127.0.0.1:<port>/mcp`, an ordinary `go-sdk/mcp` Streamable HTTP server
  (`internal/dbmcp/http.go`'s `bindHTTP`) — a JSON-RPC 2.0 `tools/call` POST with an `Authorization:
  Bearer <token>` header reaches it the same way any MCP Streamable HTTP client would; the SDK's own
  client package is the reference for the exact request shape (`Content-Type`/`Accept` framing) if
  driving it with a raw `curl` rather than a real MCP client.

## shadcn-vue — adding a component set in this environment

`shadcn-vue add` cannot run here: this repo has no `components.json`/CLI wiring. Pull from the
registry directly:

1. `curl -sS "https://shadcn-vue.com/r/styles/reka-nova/<name>.json" -o /tmp/<name>.json`.
2. For each `files[]` entry, strip the `styles/reka-nova/ui/` prefix and write it under
   `packages/theme/src/components/ui/<name>/`.
3. Rewrite `@/lib/utils` to `@theme/lib/utils`, and any `@/…` sibling import to
   `@theme/components/ui/…`.
4. Pull `registryDependencies` recursively the same way; check `dependencies` against the root
   `package.json` before adding anything (and against `CLAUDE.md`'s open-source-only rule).
5. Run `bun run format` over the new files.

P110 iter2 used this for `empty` and for `resizable`'s `ResizablePanel`/`ResizablePanelGroup`.

## CodeGraph — the code index in this environment

`CLAUDE.md` says how to navigate with CodeGraph; this is the setup. **`scripts/codegraph-setup.sh`
runs once per worktree, before a Claude session is spawned into it — not a `SessionStart` hook.**
It installs `@colbymchenry/codegraph` globally via `npm` if missing, then `codegraph sync .` (or
`codegraph init .` on first run) and prints `codegraph status .`. Whoever provisions the worktree
(the orchestrating session, before handing it to a subagent) runs it alongside
`scripts/prepare-worktree.sh` — or both in one call via `scripts/prepare-dev-environment.sh`. The
index lives in `.codegraph/` (gitignored). `.mcp.json` registers
`codegraph serve --mcp`; its one tool is
`codegraph_explore`, deferred until `ToolSearch` loads it. Each stream worktree (`/home/user/kira-v21-X`)
needs its own run of `scripts/codegraph-setup.sh`; a `.codegraph/` missing there means a cold index. A `UserPromptSubmit` hook
(`codegraph prompt-hook`) injects matching symbols into every prompt — this hook still fires
per-message regardless of how the index got built. If a worktree was never provisioned with
`scripts/codegraph-setup.sh` (a manual clone, say), run it by hand once before relying on the index.

## CodeGraph duplicate finder — `scripts/codegraph-duplicates.ts`

Runnable form of the ad-hoc sweeps P107/P113/P115 ran against `.codegraph/codegraph.db` (they were
never committed as a script; method text lives in `docs/v1.9/plans/P107-duplication-findings*.md`
§0 and `P113-duplication-sweep.md` §0). Opens the index read-only via `bun:sqlite`, reads each
function/method body from disk by `nodes.file_path` + line span, never writes. Needs an index
(`scripts/codegraph-setup.sh`); with none it prints how to build one and exits 0. In a linked
worktree with no index of its own, falls back to the main checkout's (`git worktree list`); override
with `--db`/`CODEGRAPH_DB`. `--root` = where source files are read from.

```sh
bun scripts/codegraph-duplicates.ts --path apps/kira-studio/internal --lang go --top 10
bun scripts/codegraph-duplicates.ts --sweep calls --lcs 0.6 --min-callees 4 --json
```

Options: `--db`/`CODEGRAPH_DB`, `--root`, `--path` (repeatable), `--lang`, `--min-lines` (6),
`--sweep exact,blind,name,calls`, `--similarity` (0.6), `--lcs` (0.7), `--min-callees` (6),
`--top` (20), `--include-tests`, `--include-generated`, `--json`.

Sweeps (function/method nodes only, groups need >=2 files):

- `exact`: same body after stripping comments and whitespace.
- `blind`: same after collapsing identifiers, string and number literals. Excludes groups `exact` has.
- `name`: same symbol name and language across files, line-set ratio >= `--similarity`. Names with
  >30 definitions skipped.
- `calls`: ordered `calls` edges, LCS/max >= `--lcs`. Resolved edges only; P113's widening to
  unresolved stdlib refs is not reproduced.

Ranking: members x lines. False positives: one-line delegates and `Get`/`Remove`/`Close`-style repo
boilerplate (`blind`), per-adapter shape that is deliberate (`name`/`calls`), cross-language and
`kira-space` vs `kira-studio` mirrors, tests (dropped by default), generated bindings (dropped via
`files.generated`). Anonymous callbacks and struct fields are not graph nodes, so unseen. Read every
hit with `codegraph_explore` before calling it duplication.

## Mutation testing (P151, report-only)

Measures unit-test strength. Never wired into hooks, `package.json`, `pr.yml` or any gate; survivors
are data, not failures. Scope: Go `go test` packages and `bun test` unit specs only (no Playwright
suites). Tooling lives in `scripts/mutation/` and `tools/mutation/` (own `package.json` and
`bun.lock`, not a root workspace).

- **Prerequisites**: `bun run setup` (generated Wails bindings; the TS runner exits without them),
  Go per `go.mod`, `jq`, `node` 22+. Go tool `gremlins` v0.6.0 installs itself into
  `tools/mutation/bin/` (gitignored); Stryker installs via `bun install --frozen-lockfile` in
  `tools/mutation/`.
- **Run**: `nice -n 19 sh scripts/mutation/run.sh go|ts|all [target...]`. Go targets are package
  dirs (`apps/kira-studio/internal/mask`); TS targets are area names from
  `tools/mutation/areas.json`. Default: every Go package with tests, every TS area.
- **Flags**: `--changed <ref>` mutates only files changed since `<ref>` (Go: other files of a package
  are excluded; TS: intersected with the area globs). `--resume <run-dir>` continues a halted run
  (units with an `.info.json` are skipped; a halt loses at most one unit). `--dirty` snapshots
  uncommitted tracked changes. `MUTATION_WORKERS` sets workers (default half the cores; more
  turns timing-sensitive tests into false kills). `MUTATION_STRYKER_ARGS=--dryRunOnly` checks an
  area's initial test run without mutating.
- **Isolation**: each run mutates a tracked-files snapshot in a temp dir (`TMPDIR` is redirected
  there), never the live checkout; `git status` stays clean. Disk: snapshot ~52MB plus one gremlins
  copy per worker.
- **Output**: `tools/mutation/out/<utc>-<sha>/` (gitignored), `out/latest` symlinks the newest.
  `summary.md` / `summary.json` are generated at the end of every run, or by hand with
  `bun tools/mutation/summarize.ts <run-dir>`. `meta.json` records per-segment wall time.
  Score = (killed + timeout) / (killed + timeout + survived + no coverage), same for both languages.
- **Runtime**: Go ~0.7 s per mutant per worker at a 2s suite, more for slow suites; TS ~0.4 s per
  covered mutant per worker, plus 10s per timed-out mutant (infinite-loop mutants are common). A
  full run takes hours: run it in resumable chunks (one `run.sh` call per target group,
  `--resume` the same run dir). Heaviest Go suites: `gitsession`, `ade`, `gitrpc`,
  `apps/kira-studio/internal`.
- **Go details**: a package whose plain `go test` is red is recorded `red` and skipped. gremlins
  scales its per-mutant timeout from the coverage run, so `go.sh` passes a coefficient that floors
  it at 60s. `_darwin.go` and `//go:build darwin` files are not mutated (invisible on Linux).
  Container-gated adapter tests `t.Skip` without Docker, so their mutants report "no coverage";
  there is no container mode.
- **TS workarounds** (all inside the scripts and `stryker.config.mjs`, no repo test/source edit):
  1. Bun's 5s per-test timeout kills the 100k-sha `shaTable` test under instrumentation:
     `bun.bunArgs --timeout 60000`.
  2. The runner eager-imports every mutated module before any spec, so modules reaching
     `/wails/runtime.js` fail before `wailsRuntime.ts` registers its `mock.module`. `ts.sh`
     appends a `[test] preload` block (`window.ts`, `wailsRuntime.ts`) to the snapshot's
     `bunfig.toml` only.
  3. `tabs-save-retries-after-failure` and `tabs-save-serialized` specs race on `setTimeout(0)`
     under instrumentation: excluded from the area's test list in `areas.json`, with reason.
  4. Workspace packages carry their own `node_modules` (isolated linker) which Stryker's sandbox
     does not link: `inPlace: true` on the disposable snapshot, and `run.sh` symlinks every
     `node_modules`.
- **TS limits**: no type checker (bun strips types, so some survivors are type-invalid code), `.vue`
  files are not mutated, static mutants are ignored, `packages/theme` and `packages/kira-ui` have no
  unit suite.
- **CI**: none, by user decision (2026-10-07) — not worth the investment yet. Run manually only,
  via `scripts/mutation/run.sh` below.
- **Risks**: gremlins and `@hughescr/stryker-bun-runner` are single-maintainer, slow-moving tools.
  Fallbacks if either breaks: `avito-tech/go-mutesting` (about 5x slower, no coverage split),
  Stryker's `command` runner with `coverageAnalysis: 'off'` (10-30x slower).

## Perf probes — `tests/perf/` (scroll lag, RSS)

Report-only probes: print `PERF ...` lines, assert nothing. Run `bun run perf:probe:studio` or
`bun run perf:probe:space`; narrow with a file filter, e.g.
`bunx playwright test --config=apps/kira-studio/playwright.perf.config.ts documents`.
Helper: `packages/workbench/src/testing/ui/perfProbe.ts` (RSS sampler, rAF frame stats, momentum
flick). Add a view by copying a probe and calling `measureFlick` over `FLICK_LADDER`.

- Engine is Playwright WebKit. Linux runs the WPE port: software rendering, no GPU process.
- fps = 1000 / frame ms. Compare views to each other, not to 16 ms.
- RSS comes from `ps`. On macOS it omits CoreAnimation/IOSurface graphics memory, the dominant
  scroll cost there. Read real footprint with `docs/v1.1/WEBVIEW-SCROLL-MEMORY.md` Appendix A.
- Env knobs: `NDOCS` (documents), `NROWS`/`NCOLS` (console grid), `BODYKIND`/`NITEMS` (HTTP
  response), `NTABLES` (tree), `GRAPH_N` (git graph).

## Grid prototype (P165) — `proto/grid/`

Dev-only Cheetah Grid prototype beside SlickGrid baselines. Not in the shipped bundle; Go embeds only
`frontend/dist`. Plan and verdict: `docs/v2.0/plans/P163-cheetah-grid-prototype.md`.

- Pages: `cheetah.html`, `slick.html?variant=kira|stock`, `empty.html` (bare scroller control).
  Query: `fixture=features` (NULL, empty, truncated, masked, FK rows), `w`/`h`, `rowHeight`, `zebra=1`,
  `readonly=1`.
- `bun run proto:dev:grid` serves them. `proto:build:grid` writes `dist-proto` (no debug hooks).
  `proto:build:grid:hooks` writes `dist-proto-hooks` (`window.__kiraGridProto`, `window.cheetahGrid`,
  trace HUD).
- Both grid pages build the same data: `createProtoData` over the shared `wideTable` template, 10 000 rows x 20 columns, no randomness. Open `cheetah.html` and `slick.html?variant=kira` in two windows to compare by hand; pass the same `fixture`, `w`, `h` and `rowHeight` to both.
- `bun run test:proto:studio` builds the hooks build and runs `tests/proto/` in Playwright WebKit.
- `bun run perf:probe:proto` builds both and runs `tests/perf/proto-grid-scroll.spec.ts`. Frame cost
  uses the release build, late data the hooks build. `GRID=cheetah,slick-stock,slick-kira` narrows.
  `PERF_HEADED=1 xvfb-run -a bun run perf:probe:proto` runs headed WebKitGTK.
- Compare against the app with `NCOLS=20 TRACE=1 bunx playwright test
  --config=apps/kira-studio/playwright.perf.config.ts grid-scroll` at the same commit. Its
  `PERF viewport` line is the size the proto probe copies.
- Container numbers rank engines only. No GPU, DPR 1. Footprint needs the Mac.

### Mac footprint run (user-run)

Needs Xcode command line tools. Not run in the sandbox, `wkhost.swift` is uncompiled there.

1. `bun run proto:build:grid && bun run proto:build:grid:hooks`, then
   `bun run proto:preview:grid` (serves `dist-proto` on 127.0.0.1:9246).
2. `swiftc -O -o /tmp/wkhost apps/kira-studio/frontend/proto/grid/mac/wkhost.swift`.
3. Per page: `/tmp/wkhost <url> 90 apps/kira-studio/frontend/proto/grid/mac/driver.js 2> <name>.log`
   for `proto/grid/empty.html`, `slick.html?variant=kira`, `slick.html?variant=stock`,
   `cheetah.html`, all with `?w=1440&h=960&rowHeight=28` appended (use `&` after the variant).
4. Per page and band (`MARK-idle`, `MARK-40px`, `MARK-100px`, `MARK-200px`): idle footprint, peak
   `FOOTPRINT`, delta. Never `vmmap` for the series.
5. Late data on a real trackpad: serve `dist-proto-hooks`
   (`cd apps/kira-studio/frontend && bunx vite preview --config vite.proto.config.ts --outDir
   dist-proto-hooks`), open `cheetah.html?fixture=features` in Safari, press Start trace, one hard
   two-finger flick, Stop trace. The JSON is on the clipboard. Same on `slick.html?variant=kira`. In
   the real app: `__kiraScrollTrace` (`docs/PERF.md` section 2.1a). Note perceived smoothness and
   blank edges per page.

