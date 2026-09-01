# Kira Studio

[![CI](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml)

A visual database client (DataGrip/DBeaver class) for macOS, built on Wails (Go) and Vue 3 — one
workbench across ten database engines.

## Status

- **Beta — v1 is in development.** Expect bugs and breaking changes between builds. See
  [Development](#development) and [`docs/PACKAGING.md`](docs/PACKAGING.md) to build from source.
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
`mariadb` driver package as the MariaDB adapter — a genuine dual client, no second dependency.
`sslmode=require` is the documented default for MySQL 8's `caching_sha2_password` handshake: a
plaintext connection needs either TLS or `allowPublicKeyRetrieval=true` (a per-connection option)
the first time a given user authenticates, or the server refuses to send its RSA key.

³ SQLite has no server, no auth, and no cancel — `caps.cancel` is `false`, the app's first honest
one: `node:sqlite` has no `sqlite3_interrupt` and its whole API is synchronous, so a running
statement blocks the event loop and an abort could never be delivered while one runs. A SQLite
connection points at a file (Fields mode's Database file field) rather than a host/port.

⁴ ClickHouse's own `PRIMARY KEY` is a sparse index over MergeTree parts, not a unique row key —
there is no addressable row to update or delete, so `canUpdate`/`canDelete` stay permanently
`false` (the same structural reason Kafka's own write flags do) and only `+ row` inserts. Pagination
is offset-only for the same reason: no unique key exists to build a keyset cursor on. Uses
`github.com/ClickHouse/clickhouse-go/v2` — a native Go adapter, no sidecar (P58b M6.4).

A couple of things worth knowing up front:

- **SQS never polls automatically.** Reads happen only on an explicit Poll press, because
  `ReceiveMessage` hides messages from real consumers.
- **Cancellation is real.** Stop forwards a cancel to the server (`pg_cancel_backend`, `KILL
  QUERY`, cursor abort, consumer stop) — it doesn't just hide the result client-side.

## Features

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
  counts; with prefetch and a hit-rate readout (see [`docs/PERF.md`](docs/PERF.md)).
- **Keyboard & command palette** — a deliberately minimal VS Code-flavoured set: `⌘,` settings,
  `⌘B` project panel, `⌘J` operations panel, `⇧⌘P` palette, `⌘F` find, `F5` refresh, `⌘↩` run
  statement, `⇧⌘↩` run all, `⌃Tab`/`⌃⇧Tab` switch tabs, `⌘W` close tab, `⇧⌘W` close window.
- **Settings** — Appearance (font family/size, row density), Data (default page size, prefetch,
  count-on-open), Cache (L2 byte budget, hit rate, clear caches), Advanced (op-log retention).

## Requirements

- macOS 14 or later, Apple Silicon (`arm64`).
- [Go](https://go.dev) 1.25+ and the [Wails v3](https://v3.wails.io) CLI (`wails3`, pinned version
  read from `go.mod` by `scripts/wails-dev-setup.sh`) — the app is a native Go binary; every
  database adapter runs in-process in Go, no sidecar runtime.
- [Bun](https://bun.sh) — the package manager, script runner and test runner for the Vue frontend
  and its test suites. Bun is tooling only; nothing ships an embedded Node runtime.
- Xcode command-line tools, for packaging.
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

The built, signed (ad-hoc) app lands at `apps/kira-studio/bin/Kira Studio.app` — nothing is
written to `dist/`.

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
| `bun run setup` | `scripts/install-deps.sh` (`bun install` + `go mod download`) then `scripts/wails-dev-setup.sh` (installs the pinned `wails3` CLI and generates bindings if missing). Runs automatically as `predev`/`prepackage`; call it directly to install without building or running anything. |
| `bun run dev` | `cd apps/kira-studio && wails3 task dev` (`predev` runs `bun run setup` first; the Wails task itself drives the frontend build via `common:build:frontend`) |
| `bun run build` | Production Vue build into `apps/kira-studio/frontend/dist` |
| `bun run lint` | Biome check |
| `bun run format` | Biome check + write |
| `bun run typecheck` | Runs the three splits below |
| `bun run typecheck:tests` | `packages/shared` plus every `apps/kira-studio/tests/` tier and `playwright.config.ts` (native TypeScript, `tsgo`) |
| `bun run typecheck:web` | `apps/kira-studio/frontend/src`, including `.vue` files, plus `packages/shared` (`vue-tsc`) |
| `bun run typecheck:unit` | `apps/kira-studio/tests/unit` (`tsgo`) |
| `bun run test:unit` | Unit suite — no external resource, finishes in about a second |
| `bun run test:ui` | Builds, then runs Playwright (WebKit) against the built bundle with both wire planes mocked |
| `bun run test:ipc:fe` | Frontend half of the IPC-boundary suite — real rendered UI, mocked IPC (see below) |
| `bun run test:go` | The Go test suite (`go test ./...`) |
| `bun run package` | Builds the native Wails bundle and ad-hoc signs it — `apps/kira-studio/bin/Kira Studio.app` (`prepackage` runs `bun run setup` first, same as `dev`) |
| `bun run verify:packaging` | Confirms the packaged bundle still ships no auto-update behavior |

**App data:** the app keeps `kira.sqlite` and `logs/` under `~/.kira-studio/`. The `KIRA_HOME`
environment variable relocates that whole directory — the test suite uses it to keep tests off a
developer's real data.

**Git hooks:** `bun install` points `core.hooksPath` at `.githooks/` (via the `prepare` lifecycle
script), which installs a `pre-commit` hook running `bun run lint` and `bun run typecheck` — about
six seconds. Bypass it for a work-in-progress commit with `git commit --no-verify`.

## Tests

Four TypeScript suites under `apps/kira-studio/tests/` (`unit/`, `ui/`, `ipc/`, `e2e-real/`), plus
the Go suite under `apps/kira-studio/`. `packages/db-fixtures/` is a shared fixture corpus
(fixtures + support code), not a spec suite of its own — no `xvfb` is needed for any tier.

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
- **`apps/kira-studio/tests/e2e-real/`** — two specs against a real `-tags server` Go binary,
  deliberately launched through plain Node rather than `bunx` (`node node_modules/.bin/playwright
  test --project=e2e-real`) rather than through a `package.json` script — see `AGENTS.md`'s Docker
  section for why.
- **`bun run test:go`** — the Go test suite (`go test ./...`), including the
  Testcontainers-backed cases against real engines; container-backed cases self-skip without
  Docker. With Colima, start it first: `colima start --cpu 4 --memory 6 --disk 40`.
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

Top-level layout — `apps/` holds this and any future Wails app; `packages/` holds source shared
across apps:

```
apps/kira-studio/internal        the Go app: adapters, storage, IPC bridge, tree service, connection state, ops
apps/kira-studio/frontend/src    the Vue 3 app (bindings + the built bundle live alongside it, both gitignored)
apps/kira-studio/tests/unit      unit suite — no external resource
apps/kira-studio/tests/ui        Playwright against the built bundle, WebKit, both wire planes mocked
apps/kira-studio/tests/ipc       per-adapter IPC-boundary suite — real Go backend + mocked-IPC frontend
apps/kira-studio/tests/e2e-real  Playwright against a real `-tags server` Go binary
packages/shared      wire protocol + domain types the Go side mirrors as its own source of truth
packages/db-fixtures shared fixture corpus (fixtures/support code, not a spec suite of its own)
docs                 architecture, performance, packaging, design system; docs/v1.1 is the live record
scripts/demo-dbs     local fixture databases for manual testing
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full current-state breakdown, and
[`docs/v1.1/SPEC.md`](docs/v1.1/SPEC.md) for this chapter's own phases (`docs/v1/SPEC.md` is the
v1 record — see `docs/v1/README.md`).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the current-state reference: stack, invariants,
  adapter contract, per-engine facts, storage, caching, UI architecture, testing, process model.
  Authoritative for behavior; the tree outranks it.
- [`docs/PERF.md`](docs/PERF.md) — performance budgets, how each is measured, and the recorded
  numbers.
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — macOS build, the Wails bundle layout, verification
  checklist.
- [`docs/v1.1/`](docs/v1.1/) — the live phasing record (see `docs/v1.1/README.md`):
  [`SPEC.md`](docs/v1.1/SPEC.md) and [`plans/`](docs/v1.1/plans/), one implementation plan per
  phase, this chapter's own P1 onward.
- [`docs/v1/`](docs/v1/) — the v1 record, not a living spec (see `docs/v1/README.md`):
  [`SPEC.md`](docs/v1/SPEC.md), the specification v1 was built against, and
  [`plans/`](docs/v1/plans/), one implementation plan per phase, P0 through P58f.
- [`docs/design/kira-design-system/`](docs/design/kira-design-system/) — the workbench visual
  reference (design artboards).
- [`AGENTS.md`](AGENTS.md) — the working agreement for changes to this repo.
- [`scripts/demo-dbs/README.md`](scripts/demo-dbs/README.md) — local fixture databases.

## Not in v1

Light mode; Windows/Linux; DDL editing; export to
CSV/JSON; connection folders; split editor groups; multiple windows; SSH tunneling (planned for
v2); code signing/notarization. **Auto-update is deliberately absent and verified as such** — see
[`docs/PACKAGING.md`](docs/PACKAGING.md) §7. SQL-table writes (add-row, delete-row, cell-edit) are
staged as pending changes with a preview; MongoDB/Redis/Kafka/SQS/S3 writes are capability-gated
per engine (see the table above) and execute immediately, with no staging or preview; S3
additionally gets upload/download of a whole object via a native OS file dialog, not a value the
staging model can show inline.

## License

[MIT](LICENSE)
