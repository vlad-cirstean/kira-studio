# Kira Studio

[![CI](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml)

A visual database client (DataGrip/DBeaver class) for macOS, built on Electron, TypeScript and
Vue 3 — one workbench across ten database engines.

## Status

- **Beta — v1 is in development.** Expect bugs and breaking changes between builds. See
  [Development](#development) and [`docs/PACKAGING.md`](docs/PACKAGING.md) to build from source.
- **macOS 13+, Apple Silicon (`arm64`) only. Dark mode only.**
- The packaged build is **unsigned (ad-hoc)** — code signing and notarization are deferred past
  v1. One consequence: because each new build is unsigned, macOS treats it as a different
  application for Keychain ACL purposes, so the first launch after installing a new build may show
  one "Kira Studio wants to use your confidential information stored in…" prompt — **Always
  Allow** answers it permanently for that build.
- **Credentials are encrypted at rest** via the macOS Keychain (`safeStorage`) — see
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
`@clickhouse/client` (npm), the app's first added dependency since the Kafka client migration —
pure JS, no native build step.

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
  count-on-open), Cache (L2 byte budget, hit rate, clear caches), Advanced (engine memory cap,
  op-log retention).

## Requirements

- macOS 13 or later, Apple Silicon (`arm64`).
- [Bun](https://bun.sh) — the package manager, script runner and test runner. Electron runs on its
  own embedded Node; Bun is tooling only.
- Xcode command-line tools, for packaging.
- **Optional, for the DB test suite and the local fixture stack:** [Colima](https://github.com/abiosoft/colima)
  with a running Docker-compatible daemon.

## Install

There's no release yet, so installing means building it yourself:

```sh
git clone <repo-url>
cd kira-studio
bun install
bun run package:mac
```

Artifacts land in `dist/`: `Kira Studio-0.1.0-arm64.dmg`, `Kira Studio-0.1.0-arm64.zip`, and
the unpacked `dist/mac-arm64/Kira Studio.app`. `bun run package:mac:dir` builds only the `.app`
and is faster for iterating.

Since the build is unsigned (ad-hoc), the first launch needs a Gatekeeper workaround:
right-click → Open, or:

```sh
xattr -dr com.apple.quarantine "/Applications/Kira Studio.app"
```

See [`docs/PACKAGING.md`](docs/PACKAGING.md) for the electron-builder config and the full
verification checklist.

## Development

```sh
bun install
bun run dev        # electron-vite dev, HMR for the renderer
```

| Script | What it does |
|---|---|
| `bun run dev` | Dev build with renderer HMR |
| `bun run build` | Production build into `out/` |
| `bun run start` | Preview the production build |
| `bun run lint` | Biome check |
| `bun run format` | Biome check + write |
| `bun run typecheck` | Runs all four splits below |
| `bun run typecheck:node` | main + engine + preload (native TypeScript, `tsgo`) |
| `bun run typecheck:web` | renderer, including `.vue` files (`vue-tsc`) |
| `bun run typecheck:db` | `tests/db` + `tests/electron-db` |
| `bun run typecheck:unit` | `tests/unit` |
| `bun run test:db` | Testcontainers integration suite |
| `bun run test:unit` | Unit suite — no external resource, finishes in about a second |
| `bun run test:e2e` | Builds, then runs Playwright against the real app |
| `bun run test:ipc` | IPC-boundary suite: real backend + mocked-IPC frontend (see below) |
| `bun run package:mac` | `.dmg` + `.zip` + `.app`, unsigned arm64 |
| `bun run package:mac:dir` | `.app` only (faster) |
| `bun run verify:packaging` | Confirms the packaging config still ships no auto-update behavior |

**App data:** the app keeps `kira.sqlite` and `logs/` under `~/.kira-studio/`. The `KIRA_HOME`
environment variable relocates that whole directory — the test suite uses it to keep tests off a
developer's real data.

**Git hooks:** `bun install` points `core.hooksPath` at `.githooks/` (via the `prepare` lifecycle
script), which installs a `pre-commit` hook running `bun run lint` and `bun run typecheck` — about
six seconds. Bypass it for a work-in-progress commit with `git commit --no-verify`.

## Tests

Five suites, under `tests/`: `unit/`, `db/`, `electron-db/`, `ipc/`, `e2e/`.

- **`bun run test:unit`** — plain TypeScript modules exercised with fakes (a `bun:sqlite`-backed
  Drizzle instance, a fake `requestAnimationFrame` queue, hand-written fake clients) rather than a
  real container or a real Electron process. No external resource needed; finishes in about a
  second. Sparse by design — added only where a unit test is a better fit than the UI coverage
  below, never as a substitute for it.
- **`bun run test:db`** — a Testcontainers integration suite against real engines. Requires Colima
  running (`colima start --cpu 4 --memory 6 --disk 40`); the harness resolves `DOCKER_HOST` from
  the active Docker context itself and prints a clear message if the daemon is unreachable. Kafka
  and SQS run against `@testcontainers/kafka` and `@testcontainers/localstack`. One file lives in
  `tests/electron-db/` instead of `tests/db/` and runs under a real Electron process rather than
  Bun (`bun run test:db:kafka`) — the native Kafka driver is built against Electron's own Node ABI
  and can't load under Bun at all.
- **`bun run test:ipc`** — per-adapter IPC-boundary suite (see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Testing section): `test:ipc:be` drives the real
  control-channel/data-op stack against a real container with no Electron renderer at all;
  `test:ipc:fe` drives the real rendered UI in Playwright with both IPC halves mocked. Both read
  from one fixture module per adapter, generated from a real backend run rather than hand-written.
- **`bun run test:e2e`** — Playwright driving the built Electron app via `_electron.launch()`. It
  builds first. On a headless Linux machine, wrap it: `xvfb-run -a bun run test:e2e`.
- **Local fixture databases for manual testing** — see
  [`scripts/demo-dbs/README.md`](scripts/demo-dbs/README.md): nine of the ten engines (SQLite
  needs no container), a ~20k-row e-commerce dataset for the relational/document/key-value stores
  plus a small backlog for Kafka/SQS/S3, via Colima + Docker Compose.

## Architecture

Kira Studio runs as three processes: the Vue 3 renderer, an Electron main process for windowing
and app-local storage, and every database driver isolated in its own `utilityProcess` ("engine").
Control (connect, cancel, settings) flows through main; bulk result pages travel directly between
renderer and engine over a `MessagePort`, skipping main entirely — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Process model section for the diagram.

Two facts worth knowing before reading further:
- **Drivers live in a separate process**, so the renderer never touches a wire protocol directly.
- **Adapters are capability-driven** (`src/shared/caps.ts`): adding an engine is one new directory
  under `src/engine/adapters/`, not a change to the UI.

Top-level layout:

```
src/main       Electron main process — windowing, IPC, SQLite storage, op log
src/engine     utilityProcess host — adapters, scheduler, cache
src/preload    contextBridge surface between main and renderer
src/renderer   the Vue 3 app
src/shared     wire protocol + domain types shared across processes
tests/unit     unit suite — no external resource
tests/db       Testcontainers integration suite
tests/electron-db  the one Testcontainers spec that needs a real Electron process (Kafka)
tests/ipc      per-adapter IPC-boundary suite — real backend + mocked-IPC frontend
tests/e2e      Playwright end-to-end suite
docs           architecture, performance, packaging, design system; docs/v1 is the v1 record
scripts/demo-dbs   local fixture databases for manual testing
```

See [`docs/v1/SPEC.md`](docs/v1/SPEC.md) §11 for the full directory breakdown as of v1 (docs/v1 is
the v1 record — see `docs/v1/README.md`).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the current-state reference: stack, invariants,
  adapter contract, per-engine facts, storage, caching, UI architecture, testing, process model.
  Authoritative for behavior; the tree outranks it.
- [`docs/PERF.md`](docs/PERF.md) — performance budgets, how each is measured, and the recorded
  numbers.
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — macOS build, electron-builder config, verification
  checklist.
- [`docs/v1/`](docs/v1/) — the v1 record, not a living spec (see `docs/v1/README.md`):
  [`SPEC.md`](docs/v1/SPEC.md), the specification v1 was built against, and
  [`plans/`](docs/v1/plans/), one implementation plan per phase, P0 through P45.
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
