# Kira Studio

[![PR](https://github.com/vlad-cirstean/kira-studio/actions/workflows/pr.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/pr.yml)

A native macOS workbench combining a visual database client (DataGrip/DBeaver class, ten database
engines) and an HTTP/gRPC API client (Postman/Insomnia class) — built
on Wails (Go) and Vue 3, one app you switch between with a mode button.

**As of v1.9, this app's git tooling has moved to a separate, standalone app: Kira Space** (a native
code/git workspace plus a VS Code extension, both over the same headless backend). See
`apps/kira-space/README.md` and `apps/kira-space-vscode/README.md`. Kira Studio itself keeps only
the database and API clients from here on.

## Status

- **Beta.** The database client (**Studio**) shipped through its v1.1 chapter, the API client
  (**Api**) through v1.2, and a git backend through v1.3 — headless at first, with its only
  frontend **Kira Version**, a VS Code extension bundled in the DMG. v1.5 added a native code
  intelligence workspace inside this app's own window — import a repository, browse and diff its
  files, navigate its code — and v1.6 made **git** a full peer of **Studio**/**Api** (its own mode,
  its own native graph and code-review layer) and enabled real git-write operations from that
  native surface. v1.7 added a second local MCP server that exposes a chosen connection's data to an
  AI client, under per-connection read/write/DDL permissions, with per-column PII masking. v1.8
  added incognito request tabs to the Api module, reworked the git module's graph/commit-detail/
  review surface with GitHub PR status inline, added a status-bar git-blame readout, and gave code
  navigation find-references, go-to-implementation and modifier-click. **v1.9 (the current chapter)
  split the git module and the native code workspace out of this app entirely, into a new
  standalone app, Kira Space** (P100) — this app now ships only **Studio** and **Api**. Expect bugs
  and breaking changes between builds. See
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
- **Cell editor** — a Monaco panel with format autodetect (JSON, XML, SQL, base64, hex, epoch,
  ISO-8601, UUID, URL, CSV), manual override, and indented/compact beautify.
- **Document, key/value and stream views** — MongoDB documents with per-`_id` expand state and an
  add/edit/delete document action; Redis keyspace with per-type renderers and TTL, plus
  add/edit/delete on string-typed keys (delete works on any type); Kafka/SQS message lists with an
  add-message (produce/send) action, and SQS message delete. These writes execute immediately
  against the server, with no staging or preview — that model is specific to the SQL grid below.
- **Mutations (SQL grid)** — add/delete row and cell edits staged as a per-tab pending-change set
  with an exact command preview; commit or rollback; nothing reaches the database until commit.
- **Column masking (PII)** — mark a column as PII from its own grid header menu (**Mark column as
  PII**) with one of six masks — name, email, text, number, date or full redact — and a toolbar
  toggle previews the masked view live over the real rows. Display-layer only: the underlying rows
  are never mutated, and the grid goes read-only while the preview is on. Rules are managed per
  connection in the connection dialog's **Privacy** tab.
- **PK/FK navigation** — click an outbound-FK cell's nav button for a read-only preview popover
  first, with two actions: *Open in new tab* (jump straight to the referencing/referenced rows in a
  pre-filtered new tab) or *Edit this record* (opens the same pre-filtered tab with the caret
  already landed in edit mode), driven by cached FK metadata (PostgreSQL/MariaDB).
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
  Defaults action. Appearance (font family/size, row density, word wrap, row coloring, commit date
  format), Data (default page size), Cache (L2 byte budget, hit rate, clear caches), Advanced
  (op-log retention, expensive-query row threshold, git log level).

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
- **Incognito request tabs** — a per-tab toggle from the tab's own context menu (the tab shows an
  eye-closed marker while on). Nothing from that tab's session persists: no tab row saved, no
  response-history entry, no op-log row, no environment/variable write. The tab still renders,
  sends and shows responses normally, and a running incognito operation still appears live in the
  Operations panel — it is simply never written down.
- **Request timeline** — a per-request timing breakdown (DNS, connect, TLS, time-to-first-byte,
  download).
- **gRPC support** — unary and streaming calls alongside HTTP, sharing the same collections,
  environments and variables.

## Database MCP features

- **A local MCP server** — its own process-lifetime instance, its own loopback port (8766 by
  default, falling back to an OS-assigned one if that's taken), its own bearer token. Off by
  default; enabled from Settings → Database MCP, which shows the registration command before its
  Install button.
- **Six tools** — `list_connections`, `list_children`, `describe_table`, `describe_schema`,
  `run_query`, `explain_query`. `run_query` executes through the same adapter path the app's own SQL
  console uses.
- **Deny by default, per connection** — a connection is invisible to an AI client until its owner
  exposes it.
- **Per-operation permissions** — read, write and DDL each independently *allow*, *deny* or
  *prompt*, per connection, edited in the connection dialog's **MCP** tab. Defaults: read allow,
  write prompt, DDL deny. Every statement is classified before it runs, and one the classifier can't
  read falls to the strictest of the three modes rather than through the gate. **DDL is denied by
  default and only executes at all if a person allows it, per connection.**
- **Human approval for `prompt`** — the query doesn't run until a person approves the actual
  statement text in a modal dialog.
- **EXPLAIN** — `explain_query` returns the same normalized plan the console renders (SELECT/WITH
  only). A per-connection auto-explain setting plans every eligible `run_query` first, and a plan
  estimated over the expensive-query row threshold pauses for the same human approval.
- **Masking over MCP** — the per-column PII rules above are applied to results before an AI client
  sees them, with a keyed correlation tag so two rows holding the same real value are recognizably
  the same without the value being exposed or recoverable.

## Requirements

- macOS 14 or later, Apple Silicon (`arm64`).
- [Go](https://go.dev) 1.27+ and the [Wails v3](https://v3.wails.io) CLI (`wails3`, pinned version
  read from `go.mod` by `scripts/setup.sh`) — the app is a native Go binary; every database adapter
  runs in-process in Go, no sidecar runtime.
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
bun run package:studio
```

`bun run package:studio` (like `bun run dev:studio` below) installs everything it needs on its own first —
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
verification checklist. To build Kira Space instead (the git tooling that used to live here), see
[`apps/kira-space/README.md`](apps/kira-space/README.md).

## Development

```sh
bun run dev:studio  # installs everything needed, then `wails3 task dev` — native window, HMR
```

| Script | What it does |
|---|---|
| `bun run setup` | `scripts/setup.sh` — `bun install` + `go mod download`, then installs the pinned `wails3` CLI and regenerates bindings if either has drifted. Runs automatically as `predev:studio`/`prepackage:studio`; call it directly to install without building or running anything. |
| `bun run dev:studio` | `cd apps/kira-studio && wails3 task dev` (`predev:studio` runs `bun run setup` first; the Wails task's own dev-mode config runs a blocking `common:build:frontend` for the embedded bundle, then `common:dev:frontend` in the background for HMR) |
| `bun run build:studio` | Production Vue build into `apps/kira-studio/frontend/dist` |
| `bun run lint` | Biome check |
| `bun run format` | Biome check + write |
| `bun run typecheck` | Runs eight splits in parallel, covering both this app and Kira Space — the four below are this app's own; Kira Space's own four (`typecheck:space-web`, `typecheck:space-tests`, `typecheck:space-unit`, `typecheck:git`) are documented in [`apps/kira-space/README.md`](apps/kira-space/README.md) |
| `bun run typecheck:tests:studio` | `packages/shared` plus every `apps/kira-studio/tests/` tier and `playwright.config.ts` (native TypeScript, `tsgo`) |
| `bun run typecheck:web:studio` | `apps/kira-studio/frontend/src`, including `.vue` files, plus `packages/shared` (`vue-tsc`) |
| `bun run typecheck:unit:studio` | `apps/kira-studio/tests/unit` (`tsgo`) |
| `bun run typecheck:api-core:studio` | `packages/api-core` (`tsgo`) |
| `bun run test:unit` | Unit suite for **both apps** — `apps/kira-studio/tests/unit`, `apps/kira-space/tests/unit`, and the in-source specs under `packages/{api-core,git-core,git-ipc,git-ui,kira-ui}` and `apps/kira-space-vscode/src`. No external resource, finishes in about a second |
| `bun run test:ui:studio` | Builds, then runs Playwright (WebKit) against this app's own built bundle with both wire planes mocked |
| `bun run test:ipc:fe:studio` | Frontend half of the IPC-boundary suite — real rendered UI, mocked IPC (see below) |
| `bun run test:go` | The Go test suite (`go test ./...`) — covers both apps, since they're one Go module |
| `bun run test:e2e-real:studio` | Builds, then runs the full-stack wiring suite against a real `-tags server` Go binary (see Tests below) |
| `bun run test:compat` | `scripts/db-compat.sh` — the same per-engine conformance suite against each kind's oldest and newest supported server image, on demand, not part of CI |
| `bun run test:matrix` | `scripts/test-matrix.sh` — each adapter's full auth/config permutation matrix, on demand, not part of CI |
| `bun run generate:wire` | `scripts/generate-wire.sh` — regenerates the Go and TypeScript FlatBuffers code from `wire.fbs`; not part of a normal build |
| `bun run package:studio` | Builds the native Wails bundle and the `.dmg` around it, and ad-hoc signs both — `apps/kira-studio/bin/Kira Studio.{app,dmg}` (`prepackage:studio` runs `bun run setup` first, same as `dev:studio`). Carries no `.vsix` — see [`apps/kira-space/README.md`](apps/kira-space/README.md) for `package:space`, which does |
| `bun run verify:packaging` | Confirms the packaged bundle still ships no auto-update behavior, for both apps' bundles |

**App data:** the app keeps `kira.db`, `logs/`, and the database MCP server's own token
`mcp-db-token.json`, all under `~/.kira-studio/`. The `KIRA_HOME` environment variable relocates
that whole directory — the test suite uses it to keep tests off a developer's real data. **This is
a separate home from Kira Space's own `~/.kira-space`/`KIRA_SPACE_HOME`** (P100) — the git module's
own `review.db` and `git.sock` moved there along with the rest of the git module, see
[`apps/kira-space/README.md`](apps/kira-space/README.md).

**Git hooks:** `bun install` points `core.hooksPath` at `.githooks/` (via the `prepare` lifecycle
script), which installs a `pre-commit` hook running `bun run lint` and `bun run typecheck` — about
six seconds. Bypass it for a work-in-progress commit with `git commit --no-verify`.

## Tests

Four TypeScript suites under `apps/kira-studio/tests/` (`unit/`, `ui/`, `ipc/`, `e2e-real/`), plus
the Go suite under `apps/kira-studio/`. `packages/db-fixtures/` is a shared fixture corpus
(fixtures + support code), not a spec suite of its own — no `xvfb` is needed for any tier. Kira
Space's own test tiers, including the extension's webview suite, are documented in
[`apps/kira-space/README.md`](apps/kira-space/README.md).

- **`bun run test:unit`** — plain TypeScript modules exercised with fakes rather than a real
  container or a real window process. No external resource needed; finishes in about a second.
  Sparse by design — added only where a unit test is a better fit than the UI coverage below,
  never as a substitute for it.
- **`bun run test:ui:studio`** — Playwright against the built bundle, real WebKit, with both wire planes
  (control and data) mocked. Builds first.
- **`bun run test:ipc:fe:studio`** — the frontend half of the per-adapter IPC-boundary suite (see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Testing section): real rendered UI, mocked IPC.
  The backend half is Go (`apps/kira-studio/internal/ipcfixture`), run via `bun run test:go` with
  `KIRA_IPC_FIXTURES=write` to regenerate the fixture modules both halves read.
- **`apps/kira-studio/tests/e2e-real/`** — four specs against a real `-tags server` Go binary, run
  via `bun run test:e2e-real:studio`, which deliberately launches Playwright through plain Node rather than
  `bunx` (`node node_modules/.bin/playwright test --project=e2e-real`) — see
  `docs/DEV_ENVIRONMENT.md`'s Docker section for why.
- **`bun run test:go`** — the Go test suite (`go test ./...`), covering both this app and Kira
  Space (one Go module), including the Testcontainers-backed cases against real engines;
  container-backed cases self-skip without Docker. With Colima, start it first: `colima start
  --cpu 4 --memory 6 --disk 40`. Kira Space's own git packages need no container at all — see
  [`apps/kira-space/README.md`](apps/kira-space/README.md).
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
- **As of v1.9 P100, the git backend and native code workspace are a separate app, Kira Space** —
  see [`apps/kira-space/README.md`](apps/kira-space/README.md) for its own architecture. This app
  ships only **Studio** and **Api** from here on.

Top-level layout — `apps/` holds every Wails app in this monorepo; `packages/` holds source shared
across them:

```
apps/kira-studio/internal        the Go app: adapters, storage, IPC bridge, tree service, connection state, ops, database MCP (dbmcp/mask/maskrules/queryplan/mcpauth), the update checker
apps/kira-studio/frontend/src    the Vue 3 app (bindings + the built bundle live alongside it, both gitignored)
apps/kira-studio/tests/unit      unit suite — no external resource
apps/kira-studio/tests/ui        Playwright against the built bundle, WebKit, both wire planes mocked
apps/kira-studio/tests/ipc       per-adapter IPC-boundary suite — real Go backend + mocked-IPC frontend
apps/kira-studio/tests/e2e-real  Playwright against a real `-tags server` Go binary
apps/kira-space                  the git module and native code workspace — a separate app, see its own README
apps/kira-space-vscode           the Kira Space VS Code extension — the git module's second frontend
packages/shared      wire protocol + domain types the Go side mirrors as its own source of truth
packages/api-core    the Api module's DOM-free logic (substitution, curl/raw, dynamic values)
packages/git-ipc     the git contract, RPC/codec/validation, the socket channel, the FlatBuffers schema (Kira Space's own)
packages/git-core    client-side git logic: commit store, lane layout, the client half of search, ports (Kira Space's own)
packages/git-ui      the git graph/review UI, hosted by the extension and by Kira Space's own native Git module
packages/kira-ui     host-agnostic Vue components shared by Kira Space's workbench and the git webviews
packages/theme       shared design tokens/CSS both apps' frontends import
packages/db-fixtures shared fixture corpus (fixtures/support code, not a spec suite of its own)
docs                 architecture, performance, packaging, design system; docs/v1.9 is the live record
scripts/demo-dbs     local fixture databases for manual testing
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full current-state breakdown, and
[`docs/v1.9/SPEC.md`](docs/v1.9/SPEC.md) for the live chapter. Earlier chapters, oldest first:
[`docs/v1.1/SPEC.md`](docs/v1.1/SPEC.md) (Studio), [`docs/v1.2/SPEC.md`](docs/v1.2/SPEC.md) (Api),
[`docs/v1.3/SPEC.md`](docs/v1.3/SPEC.md) (the headless git backend),
[`docs/v1.4/SPEC.md`](docs/v1.4/SPEC.md) (reliability/tooling polish across existing modules),
[`docs/v1.5/SPEC.md`](docs/v1.5/SPEC.md) (code intelligence, since removed in v1.9 P97),
[`docs/v1.6/SPEC.md`](docs/v1.6/SPEC.md) (editor consolidation and tooling upgrades),
[`docs/v1.7/SPEC.md`](docs/v1.7/SPEC.md) (the database MCP server), and
[`docs/v1.8/SPEC.md`](docs/v1.8/SPEC.md) (Api incognito mode, the git module's graph/detail/review
rework, code navigation) — all completed (`docs/v1/SPEC.md` is the v1 record — see
`docs/v1/README.md`).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the current-state reference: stack, invariants,
  adapter contract, per-engine facts, storage, caching, UI architecture, testing, process model.
  Authoritative for behavior; the tree outranks it.
- [`docs/PERF.md`](docs/PERF.md) — performance budgets, how each is measured, and the recorded
  numbers.
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — macOS build, the Wails bundle layout, verification
  checklist.
- [`docs/v1.9/`](docs/v1.9/) — **the live chapter**: splits the git module and native code
  workspace out into a new standalone app, Kira Space (P100), among other work.
  [`SPEC.md`](docs/v1.9/SPEC.md) and [`plans/`](docs/v1.9/plans/), one implementation plan per
  phase.
- [`docs/v1.8/`](docs/v1.8/) — the completed chapter's own phasing record (see
  `docs/v1.8/README.md`): Api incognito mode, the git module's graph/detail/review/picker rework,
  and the code-navigation additions. [`SPEC.md`](docs/v1.8/SPEC.md) and [`plans/`](docs/v1.8/plans/),
  one implementation plan per phase.
- [`docs/v1.7/`](docs/v1.7/) — the completed database-MCP chapter's own phasing record (see
  `docs/v1.7/README.md`): a local database MCP server with per-connection read/write/DDL
  permissions, an EXPLAIN path, and per-column PII masking. [`SPEC.md`](docs/v1.7/SPEC.md) and
  [`plans/`](docs/v1.7/plans/), one implementation plan per phase.
- [`docs/v1.6/`](docs/v1.6/) — the completed editor-consolidation/tooling chapter's own phasing
  record (see `docs/v1.6/README.md`): [`SPEC.md`](docs/v1.6/SPEC.md) and
  [`plans/`](docs/v1.6/plans/) — editor consolidation onto Monaco, a dependency/runtime upgrade,
  native git-blame, and the repo-map MCP server.
- [`docs/v1.5/`](docs/v1.5/) — the code intelligence chapter, since removed in v1.9 P97; its own
  phasing record (see `docs/v1.5/README.md`): [`SPEC.md`](docs/v1.5/SPEC.md) and
  [`plans/`](docs/v1.5/plans/), phases C1 through C14.
- [`docs/v1.4/`](docs/v1.4/) — the completed reliability/tooling/polish chapter's own phasing record
  (see `docs/v1.4/README.md`): [`SPEC.md`](docs/v1.4/SPEC.md) and [`plans/`](docs/v1.4/plans/).
- [`docs/v1.3/`](docs/v1.3/) — the completed git-backend chapter's own phasing record (see
  `docs/v1.3/README.md`): [`SPEC.md`](docs/v1.3/SPEC.md) and [`plans/`](docs/v1.3/plans/), one
  implementation plan per phase, G1 through G34.
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
[`docs/PACKAGING.md`](docs/PACKAGING.md) §7; the app does check GitHub for a newer release and
shows a status-bar banner linking to the releases page, but downloads and installs nothing. SQL-table
writes (add-row, delete-row, cell-edit) are staged as pending changes with a preview;
MongoDB/Redis/Kafka/SQS/S3 writes are capability-gated per engine (see the table above) and execute
immediately, with no staging or preview; S3 additionally gets upload/download of a whole object via
a native OS file dialog, not a value the staging model can show inline.

For Kira Space's own "not shipped" list (the git side), see
[`apps/kira-space/README.md`](apps/kira-space/README.md).

## License

[MIT](LICENSE)
