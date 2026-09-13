# Kira Studio

[![CI](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml)

A native macOS workbench combining a visual database client (DataGrip/DBeaver class, ten database
engines) and an HTTP/gRPC API client (Postman/Insomnia class) — built on Wails (Go) and Vue 3, one
app you switch between with a mode button.

## Status

- **Beta.** The database client (**Studio**) shipped through its v1.1 chapter and the API client
  (**Api**) through v1.2. The git client is the v1.3 chapter and is **headless**: the git backend
  runs inside this app, and its frontend is **Kira Version**, a VS Code extension bundled in the
  DMG. Expect bugs and breaking changes between builds. See [Development](#development) and
  [`docs/PACKAGING.md`](docs/PACKAGING.md) to build from source.
- **macOS 14+, Apple Silicon (`arm64`) only. Dark mode only.**
- The packaged build is **unsigned (ad-hoc)** — code signing and notarization are deferred past
  v1. One consequence: because each new build is unsigned, macOS treats it as a different
  application for Keychain ACL purposes, so the first launch after installing a new build may show
  one "Kira Studio wants to use your confidential information stored in…" prompt — **Always
  Allow** answers it permanently for that build.
- **Credentials are encrypted at rest** via the macOS Keychain (Go's `keybase/go-keychain`) — see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Storage section.

## Supported engines

| Engine | Default view | Query console¹ | DDL | Server-side filter | Projection | Exact count | Pagination | Writes |
|---|---|---|---|---|---|---|---|---|
| PostgreSQL | Grid | yes (SQL) | yes | yes | yes | yes | keyset | yes |
| MariaDB | Grid | yes (SQL) | yes | yes | yes | yes | keyset | yes |
| MySQL² | Grid | yes (SQL) | yes | yes | yes | yes | keyset | yes |
| SQLite³ | Grid | yes (SQL) | yes | yes | yes | yes | keyset (+ rowid) | yes |
| ClickHouse⁴ | Grid | yes (SQL) | yes | yes | yes | yes | offset only | insert only |
| MongoDB | Documents | yes (shell-style) | yes | yes | yes | estimate only | cursor | yes |
| Redis | Key/value | yes (Redis commands) | no | no | no | yes (per key) | `SCAN` cursor | yes (string keys only) |
| Kafka | Stream | no | yes | no | no | yes (offset delta) | offset window | insert only (produce) |
| SQS | Stream | no | yes | no | no | approximate | receive batches | insert + delete |
| S3 | Key/value | no | no | no | no | per-object only | continuation token | yes (+ upload/download) |

¹ The console takes each engine's native command form, not SQL — that's why the column isn't
called "SQL".

² MySQL 8.0.16 or newer (the `CHECK_CONSTRAINTS` information-schema floor). Uses the same
`go-sql-driver/mysql` driver and shared `mysqlfamily` core as the MariaDB adapter — one driver, two
kinds, no second dependency. `caching_sha2_password`'s RSA-key handshake has no
`allowPublicKeyRetrieval` equivalent in this driver: it requests the server's RSA public key
unconditionally over plaintext when TLS is off and one is needed, with no option to refuse that
request. Console writes also lose their row-count readout on this engine — no `RowsAffected()` on
the multi-statement path the console runner needs, so a generic "OK" shows instead of "N row(s)
affected" (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for both).

³ SQLite has no server and no auth. `caps.cancel` **is** `true` — `modernc.org/sqlite` has a real
`sqlite3_interrupt`, reached by cancelling a per-op dedicated `*sql.Conn`, a different mechanism
from the side-connection cancel PostgreSQL/MariaDB/MySQL use. A SQLite connection points at a file
(Fields mode's Database file field) rather than a host/port.

⁴ ClickHouse's own `PRIMARY KEY` is a sparse index over MergeTree parts, not a unique row key —
there is no addressable row to update or delete, so `canUpdate`/`canDelete` stay permanently
`false` (the same structural reason Kafka's own write flags do) and only `+ row` inserts. Pagination
is offset-only for the same reason: no unique key exists to build a keyset cursor on. Uses a
hand-rolled `net/http` client reading ClickHouse's own
`JSONCompactStringsEachRowWithNamesAndTypes` format — a native Go adapter with **no driver
dependency at all**, and no sidecar (P58b M6.4); see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s ClickHouse section.

A couple of things worth knowing up front:

- **SQS never polls automatically.** Reads happen only on an explicit Poll press, because
  `ReceiveMessage` hides messages from real consumers.
- **Cancellation is real.** Stop forwards a cancel to the server (`pg_cancel_backend`, `KILL
  QUERY`, cursor abort, consumer stop) — it doesn't just hide the result client-side.

## Studio features

- **Project panel** — lazy, cached connection tree; per-connection color and live status dot;
  cached-node search; persistent hide/show filters.
- **Connections** — fields or URI mode, twelve-color palette, test-connection, per-connection
  **read-only guard enforced in the engine process**, optional **pre-connect script** (e.g. a
  port-forward) whose exit marks the connection disconnected.
- **Tabs** — the same table open any number of times with independent paging/sort/filter/scroll;
  session restore reopens tabs without auto-connecting.
- **Data grid** — virtualized both axes, pagination with 10/100/1k/10k page sizes, count-all on
  request, column projection, server-side `WHERE`/`ORDER BY` with history and saved filters,
  in-page find toolbar, stop button.
- **Cell editor** — a CodeMirror panel with format autodetect (JSON, XML, SQL, base64, hex, epoch,
  ISO-8601, UUID, URL, CSV), manual override, and indented/compact beautify.
- **Document, key/value and stream views** — MongoDB documents with per-`_id` expand state and an
  add/edit/delete document action; Redis keyspace with per-type renderers and TTL, plus
  add/edit/delete on string-typed keys (delete works on any type); Kafka/SQS message lists with an
  add-message (produce/send) action, and SQS message delete. These writes execute immediately
  against the server, with no staging or preview — that model is specific to the SQL grid below.
- **Mutations (SQL grid)** — add/delete row and cell edits staged as a per-tab pending-change set
  with an exact command preview; commit or rollback; nothing reaches the database until commit.
- **PK/FK navigation** — jump from a key cell to referencing or referenced rows in a pre-filtered
  new tab, driven by cached FK metadata (PostgreSQL/MariaDB).
- **Query console** — a per-connection console tab, run-statement/run-all, results in the grid,
  saved queries.
- **Operations panel** — every DB operation live, with duration, rows, command, cancel, re-run,
  and a persisted op log with retention.
- **Caching** — three tiers: persisted metadata, a byte-budgeted in-memory result-page LRU, and
  counts; no speculative prefetch — a page loads only on direct user action (see
  [`docs/PERF.md`](docs/PERF.md)).
- **Console format, Explain and auto-explain** — a Format button (`⇧⌥F`) in every console; an
  Explain action and a per-connection auto-explain toggle that render each dialect's own query plan,
  flagging estimated-rows-read above a configurable threshold.
- **SQL language service** — completions, diagnostics and hovers in the SQL console, driven by a
  per-connection DDL document you paste in yourself (no live schema introspection).
- **Generate data…** — a fake-data row generator for the SQL grid, per-column recipes inferred from
  each column's type.
- **Confirm-before-reveal** — a saved password's Show press asks for device-owner confirmation
  (Touch ID or system password on macOS, with an in-app fallback) before decrypting it, with a
  5-minute grace window.
- **Multiple windows** — *Window → New Window* (`⇧⌘N`) opens a second workbench sharing the same
  backend and connections; each window keeps its own tabs.
- **Keyboard & command palette** — a deliberately minimal VS Code-flavoured set: `⌘,` settings,
  `⌘N` new connection, `⌘B` project panel, `⌘J` operations panel, `⇧⌘P` palette, `⌘F` find, `F5`
  refresh, `⌘↩` run statement, `⇧⌘↩` run all, `⇧⌥F` format, `⌃Tab`/`⌃⇧Tab` switch tabs, `⌘W` close
  tab, `⇧⌘W` close window, `⇧⌘N` new window.
- **Settings** — staged in a per-dialog draft and applied as one patch on Save, with a Revert to
  Defaults action. Appearance (font family/size, row density, word wrap, row coloring), Data
  (default page size), Cache (L2 byte budget, hit rate, clear caches), Advanced (op-log retention,
  expensive-query row threshold).

## Api features

- **Request builder** — method, URL, query params, headers, and a body panel (raw text; syntax
  highlighted JSON/XML/HTML/JS; form-urlencoded; multipart form-data; a binary file) at Postman
  parity, with a raw request editor and inspector alongside the built form.
- **Collections** — a SQLite-backed left-panel tree of requests and folders, with real
  Postman-format import and export.
- **Environments & variables** — collection- and environment-scoped variables, colour-coded
  environments (matched everywhere a request shows which one is active), and Faker-backed dynamic
  values (`{{name}}`/`fake.*` placeholders) with optional value pipes and secret masking in
  history and logs.
- **curl import/export** — paste a curl command to populate a request, or generate one back out of
  any request.
- **Response history** — the last 30 responses per request are kept, raw body included, with a
  "only the last 30 are kept" notice once older ones roll off.
- **Request timeline** — a per-request timing breakdown (DNS, connect, TLS, time-to-first-byte,
  download).
- **gRPC support** — unary and streaming calls alongside HTTP, sharing the same collections,
  environments and variables.

## Git features (Kira Version)

Git is the third module, and the only one that isn't in this window. The backend runs inside Kira
Studio — spawn discipline, porcelain parsing, the paged log walk, pre-flight hazard analysis, every
write — and the frontend is **Kira Version**, a VS Code extension that dials a Unix socket at
`~/.kira-studio/git.sock`. Kira Studio's own window gets no git mode, tab or panel; its only
git-facing surfaces are a *Connected editors* pane and a *Git* section in Settings. The `.vsix`
ships inside the DMG rather than through the Marketplace, and installs from a button on that pane.

- **Commit graph** — a virtualized, lane-drawn log over the whole ref set, paged and streamed from
  the backend as binary FlatBuffers chunks; per-lane ref badges, a checked-out-HEAD indicator, and
  in-graph search.
- **Commit detail and diffs** — file tree, per-file and whole-commit diffs, blob reads, and a
  line-mapped **Go to file** that works on historical content not checked out on disk.
- **Refs, checkout and history rewriting** — branches and tags (create/rename/delete, local and
  remote), checkout, revert, reset in all three modes, cherry-pick, plus an in-progress banner with
  Continue/Abort/Skip for a merge, rebase or cherry-pick left mid-flight.
- **Pre-flight, computed in Go** — every hazardous operation is classified server-side before it
  runs (uncommitted work, a detached `HEAD`, a protected branch, a conflicting pop) and the verdict
  crosses as data, so the editor never re-derives it. A single-slot **undo** covers the last
  undoable operation per repository, labelled with the window that ran it.
- **Remote operations** — fetch, push, force-with-lease, a decomposed pull with a strategy picker,
  background auto-fetch, and real cancellation. A credential prompt is relayed into the VS Code
  window that owns the operation, through an askpass broker that fails rather than hangs.
- **Stash** — the full stack (push/apply/pop/drop/branch-from-stash) with `merge-tree`-based pop
  prediction, plus branch-scoped extras: auto-stash on checkout tagged with the branch it came
  from, cross-branch apply, and a reusable global stash kept under this app's own `refs/kira/*`
  namespace, which never appears in your graph.
- **Branch review** — a base resolver and a ranged walk, with **incremental review state**: what
  you last reviewed is kept per file as a compressed content snapshot, not just a commit sha, so a
  rebase, squash or amend still diffs correctly. Range-level marking happens in VS Code's own diff
  editor. A flat list of file/line **AI review comments** exports as plain text to paste into a
  chat — deliberately a copy-paste workflow, not a live integration.
- **Search** — a cancellable server-side `git log` tail scan paired with a client-side scan of
  already-loaded rows. Go's RE2 and JavaScript's `RegExp` are reconciled explicitly rather than
  approximated: a literal query runs no regex engine at all, a regex query is translated construct
  by construct, and what RE2 genuinely cannot express (lookaround, backreferences) is refused as a
  named result rather than silently mismatched.
- **Worktrees and stacked branches** — `git worktree` create/list/switch/remove with an optional
  per-repository prepare script you approve once, and stacked branches with restacking and stack
  navigation.
- **GitHub PR links** — resolved **per commit**, not per branch tip, so the indicator shows on a
  commit in the middle of a branch's history or in a detached `HEAD`, not only on a checked-out
  tip. Authentication is delegated entirely to the `gh` CLI already on your machine: this app never
  holds a GitHub token, and never reads `gh`'s own stored credential.
- **Several editors at once** — multiple VS Code windows connect to one backend, on the same
  repository or different ones. Repository-level state (the reader/writer gate, the file watcher,
  the caches, the undo slot) is shared; each connection's own paging and walk state is private. A
  new editor asks for approval **in Kira Studio's window**, its token is stored only as a salted
  hash, and revoking it drops every live connection holding it.

Two limits worth knowing up front:

- **Git 2.38 or newer is required** — `git merge-tree --write-tree`, which conflict prediction
  needs. Below that the extension shows a blocked state rather than degrading silently.
- **Kira Studio and the extension are hard-locked to the same contract version.** A mismatch is a
  blocking panel naming both versions, not a reduced feature set — there is no auto-update here and
  the two install separately, so "run an older method set" has no honest meaning.

## Requirements

- macOS 14 or later, Apple Silicon (`arm64`).
- [Go](https://go.dev) 1.27+ and the [Wails v3](https://v3.wails.io) CLI (`wails3`, pinned version
  read from `go.mod` by `scripts/setup.sh`) — the app is a native Go binary; every database adapter
  runs in-process in Go, no sidecar runtime.
- [Bun](https://bun.sh) — the package manager, script runner and test runner for the Vue frontend
  and its test suites. Bun is tooling only; nothing ships an embedded Node runtime.
- Xcode command-line tools, for packaging.
- **For the git module:** [Git](https://git-scm.com) 2.38 or newer on `PATH`, and
  [VS Code](https://code.visualstudio.com) 1.134+ to install the bundled *Kira Version* extension
  into. Optional: the [GitHub CLI](https://cli.github.com) (`gh`), already logged in, for PR links
  — without it the PR indicator simply stays blank and nothing else changes.
- **Optional, for the DB test suite and the local fixture stack:** [Colima](https://github.com/abiosoft/colima)
  with a running Docker-compatible daemon.

## Install

There's no release yet, so installing means building it yourself:

```sh
git clone <repo-url>
cd kira-studio
bun run package
```

`bun run package` (like `bun run dev` below) installs everything it needs on its own first —
the Bun workspace, the Go module, and the pinned `wails3` CLI — so a fresh clone needs nothing
run beforehand. To do that install step on its own (e.g. to warm up a machine before writing
code), run `bun run setup`.

The built, signed (ad-hoc) app lands at `apps/kira-studio/bin/Kira Studio.app`, and the disk image
that ships it — the app plus an `/Applications` shortcut to drag it onto — at
`apps/kira-studio/bin/Kira Studio.dmg`. Nothing is written to `dist/`.

Since the build is unsigned (ad-hoc), the first launch needs a Gatekeeper workaround:
right-click → Open, or:

```sh
xattr -dr com.apple.quarantine "apps/kira-studio/bin/Kira Studio.app"
```

See [`docs/PACKAGING.md`](docs/PACKAGING.md) for the Wails bundle layout and the full
verification checklist.

## Development

```sh
bun run dev        # installs everything needed, then `wails3 task dev` — native window, HMR
```

| Script | What it does |
|---|---|
| `bun run setup` | `scripts/setup.sh` — `bun install` + `go mod download`, then installs the pinned `wails3` CLI and regenerates bindings if either has drifted. Runs automatically as `predev`/`prepackage`; call it directly to install without building or running anything. |
| `bun run dev` | `cd apps/kira-studio && wails3 task dev` (`predev` runs `bun run setup` first; the Wails task's own dev-mode config runs a blocking `common:build:frontend` for the embedded bundle, then `common:dev:frontend` in the background for HMR) |
| `bun run build` | Production Vue build into `apps/kira-studio/frontend/dist` |
| `bun run lint` | Biome check |
| `bun run format` | Biome check + write |
| `bun run typecheck` | Runs the five splits below, in parallel |
| `bun run typecheck:tests` | `packages/shared` plus every `apps/kira-studio/tests/` tier and `playwright.config.ts` (native TypeScript, `tsgo`) |
| `bun run typecheck:web` | `apps/kira-studio/frontend/src`, including `.vue` files, plus `packages/shared` (`vue-tsc`) |
| `bun run typecheck:unit` | `apps/kira-studio/tests/unit` (`tsgo`) |
| `bun run typecheck:api-core` | `packages/api-core` (`tsgo`) |
| `bun run typecheck:git` | `packages/git-ipc`, `packages/git-core` and `apps/kira-studio-vscode` (`tsgo`), plus `packages/git-ui` and `packages/kira-ui` (`vue-tsc`) |
| `bun run test:unit` | Unit suite — `apps/kira-studio/tests/unit` plus the in-source specs under `packages/{api-core,git-core,git-ipc,git-ui,kira-ui}` and `apps/kira-studio-vscode/src`. No external resource, finishes in about a second |
| `bun run test:ui` | Builds, then runs Playwright (WebKit) against the built bundle with both wire planes mocked |
| `bun run test:ipc:fe` | Frontend half of the IPC-boundary suite — real rendered UI, mocked IPC (see below) |
| `bun run test:webview` | Builds the extension bundle, then runs Playwright against the git webviews — a rendered-box-height layout guard plus interaction specs (see Tests below) |
| `bun run build:vscode` | Builds the VS Code extension's bundle (`scripts/build-vscode.ts`) |
| `bun run package:vscode` | Packages it into `kira-version.vsix` (`scripts/package-vscode.ts`) — `bun run package` runs this before bundling it into the app |
| `bun run test:go` | The Go test suite (`go test ./...`) |
| `bun run test:e2e-real` | Builds, then runs the full-stack wiring suite against a real `-tags server` Go binary (see Tests below) |
| `bun run test:compat` | `scripts/db-compat.sh` — the same per-engine conformance suite against each kind's oldest and newest supported server image, on demand, not part of CI |
| `bun run test:matrix` | `scripts/test-matrix.sh` — each adapter's full auth/config permutation matrix, on demand, not part of CI |
| `bun run generate:wire` | `scripts/generate-wire.sh` — regenerates the Go and TypeScript FlatBuffers code from `wire.fbs`; not part of a normal build |
| `bun run package` | Builds the native Wails bundle and the `.dmg` around it, and ad-hoc signs both — `apps/kira-studio/bin/Kira Studio.{app,dmg}` (`prepackage` runs `bun run setup` first, same as `dev`). The packaged `kira-version.vsix` is copied into the bundle *before* signing, so the signature covers it |
| `bun run verify:packaging` | Confirms the packaged bundle still ships no auto-update behavior |

**App data:** the app keeps `kira.db`, `logs/`, the git module's own `review.db`, and its
`git.sock`/`git.sock.lock` under `~/.kira-studio/`. The `KIRA_HOME` environment variable relocates
that whole directory — the test suite uses it to keep tests off a developer's real data, and the
git socket follows it, so two `KIRA_HOME`s are two fully independent backends rather than two
processes fighting over one socket.

**Git hooks:** `bun install` points `core.hooksPath` at `.githooks/` (via the `prepare` lifecycle
script), which installs a `pre-commit` hook running `bun run lint` and `bun run typecheck` — about
six seconds. Bypass it for a work-in-progress commit with `git commit --no-verify`.

## Tests

Four TypeScript suites under `apps/kira-studio/tests/` (`unit/`, `ui/`, `ipc/`, `e2e-real/`), a
fifth under `apps/kira-studio-vscode/tests/` for the git webviews, plus the Go suite under
`apps/kira-studio/`. `packages/db-fixtures/` is a shared fixture corpus (fixtures + support code),
not a spec suite of its own — no `xvfb` is needed for any tier.

- **`bun run test:unit`** — plain TypeScript modules exercised with fakes rather than a real
  container or a real window process. No external resource needed; finishes in about a second.
  Sparse by design — added only where a unit test is a better fit than the UI coverage below,
  never as a substitute for it.
- **`bun run test:ui`** — Playwright against the built bundle, real WebKit, with both wire planes
  (control and data) mocked. Builds first.
- **`bun run test:ipc:fe`** — the frontend half of the per-adapter IPC-boundary suite (see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Testing section): real rendered UI, mocked IPC.
  The backend half is Go (`apps/kira-studio/internal/ipcfixture`), run via `bun run test:go` with
  `KIRA_IPC_FIXTURES=write` to regenerate the fixture modules both halves read.
- **`bun run test:webview`** — Playwright against the extension's own built webview documents
  (`apps/kira-studio-vscode/tests/`), in two projects. `layout` asserts **real rendered box
  heights** against the real emitted document and the real bundle, not DOM shape: a build once
  shipped a graph panel whose `aria-rowcount` was correct while the panel was visually collapsed to
  roughly 75 px, which is exactly the failure a DOM-shape check cannot see. `interaction` covers
  the graph columns, the file tree, the review panel and the shared floating-UI geometry. No
  backend, no container, no VS Code.
- **`apps/kira-studio/tests/e2e-real/`** — four specs against a real `-tags server` Go binary, run
  via `bun run test:e2e-real`, which deliberately launches Playwright through plain Node rather than
  `bunx` (`node node_modules/.bin/playwright test --project=e2e-real`) — see
  `docs/DEV_ENVIRONMENT.md`'s Docker section for why.
- **`bun run test:go`** — the Go test suite (`go test ./...`), including the Testcontainers-backed
  cases against real engines; container-backed cases self-skip without Docker. With Colima, start
  it first: `colima start --cpu 4 --memory 6 --disk 40`. The git packages need no container at all
  — they build real repositories under `t.TempDir()` against the `git` on `PATH`, and skip
  themselves without one; their perf probes are opt-in behind `KIRA_GIT_PERF=1` and assert nothing.
- **Local fixture databases for manual testing** — see
  [`scripts/demo-dbs/README.md`](scripts/demo-dbs/README.md): nine of the ten engines (SQLite
  needs no container), a ~20k-row e-commerce dataset for the relational/document/key-value stores
  plus a small backlog for Kafka/SQS/S3, via Colima + Docker Compose.

## Architecture

Kira Studio is a native Wails (Go) app: one Go process handles windowing, IPC, SQLite storage, the
op log and every database driver in-process — no sidecar, no second runtime. The Vue 3 frontend
runs in the OS's own WebView (WKWebView on macOS). Control (connect, cancel, settings) flows
through Wails' generated bindings; bulk result pages travel over a dedicated binary FlatBuffers data
plane — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Process model section for the
diagram.

Two facts worth knowing before reading further:
- **Every driver runs in-process in Go**, behind one adapter interface — the frontend never
  touches a wire protocol directly.
- **Adapters are capability-driven** (`packages/shared/caps.ts`, mirrored by each Go adapter's own
  `caps.go`): adding an engine is one new package under `apps/kira-studio/internal/adapters/`, not
  a change to the UI.
- **The git module is headless**, and is the one subsystem whose frontend is not this webview: it
  runs in the same Go binary as a peer to Studio and Api (`apps/kira-studio/internal/git*`), and a
  separately-installed VS Code extension process reaches it over a Unix socket
  (`~/.kira-studio/git.sock`) rather than through either plane above.

Top-level layout — `apps/` holds this and any future Wails app; `packages/` holds source shared
across apps:

```
apps/kira-studio/internal        the Go app: adapters, storage, IPC bridge, tree service, connection state, ops, git
apps/kira-studio/frontend/src    the Vue 3 app (bindings + the built bundle live alongside it, both gitignored)
apps/kira-studio/tests/unit      unit suite — no external resource
apps/kira-studio/tests/ui        Playwright against the built bundle, WebKit, both wire planes mocked
apps/kira-studio/tests/ipc       per-adapter IPC-boundary suite — real Go backend + mocked-IPC frontend
apps/kira-studio/tests/e2e-real  Playwright against a real `-tags server` Go binary
apps/kira-studio-vscode          the Kira Version VS Code extension — the git module's only frontend
packages/shared      wire protocol + domain types the Go side mirrors as its own source of truth
packages/api-core    the Api module's DOM-free logic (substitution, curl/raw, dynamic values)
packages/git-ipc     the git contract, RPC/codec/validation, the socket channel, the FlatBuffers schema
packages/git-core    client-side git logic: commit store, lane layout, the client half of search, ports
packages/git-ui      the git webview UI (graph panel, review panel), hosted by the extension
packages/kira-ui     host-agnostic Vue components shared by the workbench and the git webviews
packages/db-fixtures shared fixture corpus (fixtures/support code, not a spec suite of its own)
docs                 architecture, performance, packaging, design system; docs/v1.3 is the live record
scripts/demo-dbs     local fixture databases for manual testing
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full current-state breakdown,
[`docs/v1.3/SPEC.md`](docs/v1.3/SPEC.md) for the git chapter, [`docs/v1.2/SPEC.md`](docs/v1.2/SPEC.md)
for the completed Api chapter, and [`docs/v1.1/SPEC.md`](docs/v1.1/SPEC.md) for the completed Studio
chapter (`docs/v1/SPEC.md` is the v1 record — see `docs/v1/README.md`).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the current-state reference: stack, invariants,
  adapter contract, per-engine facts, storage, caching, UI architecture, testing, process model.
  Authoritative for behavior; the tree outranks it.
- [`docs/PERF.md`](docs/PERF.md) — performance budgets, how each is measured, and the recorded
  numbers.
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — macOS build, the Wails bundle layout, verification
  checklist.
- [`docs/v1.3/`](docs/v1.3/) — the git chapter's phasing record (see `docs/v1.3/README.md`):
  [`SPEC.md`](docs/v1.3/SPEC.md) and [`plans/`](docs/v1.3/plans/), one implementation plan per
  phase, G1 through G33.
- [`docs/v1.2/`](docs/v1.2/) — the completed Api chapter's own phasing record (see
  `docs/v1.2/README.md`): [`SPEC.md`](docs/v1.2/SPEC.md) and [`plans/`](docs/v1.2/plans/).
- [`docs/v1.1/`](docs/v1.1/) — the completed Studio chapter's own phasing record (see
  `docs/v1.1/README.md`): [`SPEC.md`](docs/v1.1/SPEC.md) and [`plans/`](docs/v1.1/plans/).
- [`docs/v1/`](docs/v1/) — the v1 record, not a living spec (see `docs/v1/README.md`):
  [`SPEC.md`](docs/v1/SPEC.md), the specification v1 was built against, and
  [`plans/`](docs/v1/plans/), one implementation plan per phase, P0 through P58f.
- [`docs/design/kira-design-system/`](docs/design/kira-design-system/) — the workbench visual
  reference (design artboards).
- [`CLAUDE.md`](CLAUDE.md) — the working agreement for changes to this repo.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the app actually works today, plus known
  open limitations.
- [`docs/DEV_ENVIRONMENT.md`](docs/DEV_ENVIRONMENT.md) — building, running and testing this repo in
  whatever sandbox a session happens to be in.
- [`scripts/demo-dbs/README.md`](scripts/demo-dbs/README.md) — local fixture databases.

## Not shipped

Light mode; Windows/Linux; DDL editing; export to
CSV/JSON; connection folders; split editor groups; SSH tunneling (planned for
v2); code signing/notarization. **Auto-update is deliberately absent and verified as such** — see
[`docs/PACKAGING.md`](docs/PACKAGING.md) §7. SQL-table writes (add-row, delete-row, cell-edit) are
staged as pending changes with a preview; MongoDB/Redis/Kafka/SQS/S3 writes are capability-gated
per engine (see the table above) and execute immediately, with no staging or preview; S3
additionally gets upload/download of a whole object via a native OS file dialog, not a value the
staging model can show inline.

On the git side: **no git mode, tab or panel inside Kira Studio's own window** — the module is
headless by design, and the transport layer is built so an embedded UI would be additive rather
than a rework. The extension is **not published to the VS Code Marketplace or OpenVSX**; it ships
in the DMG and installs from the *Connected editors* pane.

## License

[MIT](LICENSE)
