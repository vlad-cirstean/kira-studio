# Kira Studio

[![CI](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/ci.yml)

A visual database client (DataGrip/DBeaver class) for macOS, built on Electron, TypeScript and
Vue 3 — one workbench across six database engines.

## Status

- **v1 is in development.** There are no published binaries yet — you build it from source (see
  [Development](#development) and [`docs/PACKAGING.md`](docs/PACKAGING.md)).
- **macOS 13+, Apple Silicon (`arm64`) only. Dark mode only.**
- The packaged build is **unsigned (ad-hoc)** — code signing and notarization are deferred past
  v1.
- **Credentials are stored in plain text** in `~/.kira-studio/kira.sqlite`. Encryption at rest is
  not implemented in v1 — do not store production credentials you are not comfortable having on
  disk unencrypted.

## Supported engines

| Engine | Default view | Query console¹ | DDL | Server-side filter | Projection | Exact count | Pagination | Writes |
|---|---|---|---|---|---|---|---|---|
| PostgreSQL | Grid | yes (SQL) | yes | yes | yes | yes | keyset | yes |
| MariaDB | Grid | yes (SQL) | yes | yes | yes | yes | keyset | yes |
| MongoDB | Documents | yes (shell-style) | no | yes | no | estimate only | cursor | yes |
| Redis | Key/value | yes (Redis commands) | no | no | no | yes (per key) | `SCAN` cursor | read-only in v1 |
| Kafka | Stream | no | no | no | no | yes (offset delta) | offset window | read-only in v1 |
| SQS | Stream | no | no | no | no | approximate | receive batches | read-only in v1 |

¹ The console takes each engine's native command form, not SQL — that's why the column isn't
called "SQL".

**S3** appears in the connection dialog, marked *"not yet supported"*, and has no adapter behind
it — it's planned, not shipped.

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
- **Document, key/value and stream views** — MongoDB documents with per-`_id` expand state, Redis
  keyspace with per-type renderers and TTL, Kafka/SQS message lists.
- **Mutations** — add/delete row and cell edits staged as a per-tab pending-change set with an
  exact command preview; commit or rollback; nothing reaches the database until commit.
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
| `bun run typecheck` | Runs all three splits below |
| `bun run typecheck:node` | main + engine + preload (native TypeScript, `tsgo`) |
| `bun run typecheck:web` | renderer, including `.vue` files (`vue-tsc`) |
| `bun run typecheck:db` | `tests/db` |
| `bun run test:db` | Testcontainers integration suite |
| `bun run test:ui` | Builds, then runs Playwright against the real app |
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

There are two suites, and deliberately no unit tests — behavior is covered end-to-end against real
engines and a real UI instead.

- **`bun run test:db`** — a Testcontainers integration suite against real engines. Requires Colima
  running (`colima start --cpu 4 --memory 6 --disk 40`); the harness resolves `DOCKER_HOST` from
  the active Docker context itself and prints a clear message if the daemon is unreachable. Kafka
  and SQS run against `@testcontainers/kafka` and `@testcontainers/localstack`.
- **`bun run test:ui`** — Playwright driving the built Electron app via `_electron.launch()`. It
  builds first. On a headless Linux machine, wrap it: `xvfb-run -a bun run test:ui`.
- **Local fixture databases for manual testing** — see
  [`scripts/demo-dbs/README.md`](scripts/demo-dbs/README.md): four engines, a ~20k-row e-commerce
  dataset, via Colima + Docker Compose.

## Architecture

Kira Studio runs as three processes: the Vue 3 renderer, an Electron main process for windowing
and app-local storage, and every database driver isolated in its own `utilityProcess` ("engine").
Control (connect, cancel, settings) flows through main; bulk result pages travel directly between
renderer and engine over a `MessagePort`, skipping main entirely — see `docs/SPEC.md` §4 for the
diagram.

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
tests/db       Testcontainers integration suite
tests/ui       Playwright end-to-end suite
docs           specification, performance, packaging, per-phase plans
scripts/demo-dbs   local fixture databases for manual testing
```

See [`docs/SPEC.md`](docs/SPEC.md) §11 for the full directory breakdown.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the full specification: scope, architecture, adapter model,
  storage, caching, UI.
- [`docs/PERF.md`](docs/PERF.md) — performance budgets, how each is measured, and the recorded
  numbers.
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — macOS build, electron-builder config, verification
  checklist.
- [`docs/plans/`](docs/plans/) — one implementation plan per phase, P0 through P16.
- [`docs/design/vscode-modern-ui/`](docs/design/vscode-modern-ui/) — the workbench visual
  reference (design artboards).
- [`AGENTS.md`](AGENTS.md) — the working agreement for changes to this repo.
- [`scripts/demo-dbs/README.md`](scripts/demo-dbs/README.md) — local fixture databases.

## Not in v1

S3; MySQL; SQLite as a connection target; light mode; Windows/Linux; DDL editing; export to
CSV/JSON; connection folders; split editor groups; multiple windows; credential encryption; SSH
tunneling (planned for v2); code signing/notarization; unit tests. **Auto-update is deliberately
absent and verified as such** — see [`docs/PACKAGING.md`](docs/PACKAGING.md) §7. Writes are
limited to add-row, delete-row and cell-edit — Redis, Kafka and SQS are read-only.

## License

[MIT](LICENSE)
