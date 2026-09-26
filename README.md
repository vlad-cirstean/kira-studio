# Kira Studio

[![PR](https://github.com/vlad-cirstean/kira-studio/actions/workflows/pr.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/pr.yml)

Kira Studio is a native macOS workbench that combines a visual database client for ten engines
(DataGrip/DBeaver class) with an HTTP/gRPC API client (Postman/Insomnia class). It is built on
Wails (Go) and Vue 3, and you switch between the **Studio** (database) and **Api** modes with one
button.

This repository also contains a sibling app, **Kira Space** — a native git client and code
workspace, plus a VS Code extension over the same backend. This README covers Kira Studio; see
[`apps/kira-space/README.md`](apps/kira-space/README.md) for Kira Space.

## Status

- **Beta.** Expect bugs and breaking changes between builds.
- **macOS 14+ on Apple Silicon (`arm64`) only, dark mode only.**
- Builds are **ad-hoc signed, not notarized**. Because each new build counts as a different app to
  the Keychain, the first launch after an update may ask to use "confidential information stored
  in…" — choose **Always Allow** once for that build.
- Saved credentials are encrypted at rest in the macOS Keychain.

## Install

Run in Terminal. It installs a fresh copy or replaces an older one, then opens the app:

```sh
curl -fsSL https://raw.githubusercontent.com/vlad-cirstean/kira-studio/main/scripts/install.sh | sh -s -- --app=studio
```

The script downloads the latest release's disk image, moves the app into `/Applications` and opens
it, with no Gatekeeper prompt (unlike a DMG downloaded through a browser). Use `--app=space` to
install Kira Space instead. Once installed, the app checks GitHub for a newer release and offers to
update; nothing installs until you click **Update**.

### Building from source

```sh
git clone https://github.com/vlad-cirstean/kira-studio.git
cd kira-studio
bun run package:studio
```

This installs its own dependencies first (the Bun workspace, the Go module and the pinned `wails3`
CLI), so a fresh clone needs nothing else run beforehand. The app lands at
`apps/kira-studio/bin/Kira Studio.app` and its disk image at `apps/kira-studio/bin/Kira Studio.dmg`.

A locally built app has not gone through the installer, so its first launch needs a Gatekeeper
workaround — right-click it and choose Open, or run:

```sh
xattr -dr com.apple.quarantine "apps/kira-studio/bin/Kira Studio.app"
```

See [`docs/PACKAGING.md`](docs/PACKAGING.md) for the bundle layout, releases and the verification
checklist.

## Features

### Supported engines

| Engine | Default view | Query console | Writes |
|---|---|---|---|
| PostgreSQL | Grid | SQL | yes |
| MariaDB | Grid | SQL | yes |
| MySQL (8.0.16+) | Grid | SQL | yes |
| SQLite | Grid | SQL | yes |
| ClickHouse | Grid | SQL | insert only |
| MongoDB | Documents | shell-style | yes |
| Redis | Key/value | Redis commands | string keys (delete on any type) |
| Kafka | Stream | — | produce |
| SQS | Stream | — | send and delete |
| S3 | Object browser | — | yes, plus upload/download |

Stop cancels the operation itself (`pg_cancel_backend`, `KILL QUERY`, cursor abort, consumer stop),
not only its display. SQS never polls on its own: reads happen only when you press Poll, because
`ReceiveMessage` hides messages from real consumers. Pagination, counting, EXPLAIN and cancel
details per engine are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (Per-database mapping and
Per-engine adapter facts).

### Studio (database client)

- **Project panel** — a lazy, cached connection tree with per-connection colors, live status,
  search and hide/show filters.
- **Connections** — fields or URI mode, test-connection, a per-connection **read-only guard**
  enforced in the backend, an optional **pre-connect script** (for example a port-forward), and
  import from a JetBrains DataGrip project.
- **Tabs** — open the same table any number of times, each with its own paging, sort, filter and
  scroll; session restore reopens tabs without auto-connecting.
- **Data grid** — virtualized in both directions, page sizes from 10 to 10k, count-all on request,
  column projection, server-side `WHERE`/`ORDER BY` with history and saved filters, and in-page find.
- **Staged SQL edits** — add, delete and edit rows as a pending change set with an exact command
  preview; nothing reaches the database until you commit. Document, key/value and stream writes
  apply immediately.
- **Cell editor** — a Monaco panel that detects JSON, XML, SQL, base64, hex, epoch, ISO-8601, UUID,
  URL and CSV, with beautify and compact.
- **Foreign-key navigation** — preview a referenced row in a popover, then open it in a pre-filtered
  tab or jump straight to editing it (PostgreSQL/MariaDB).
- **Query console** — per-connection consoles with run-statement/run-all, saved queries, a Format
  action, EXPLAIN plans for every SQL dialect, and optional auto-explain that flags expensive
  queries. SQL completions, diagnostics and hovers come from a DDL document you paste in.
- **Column masking (PII)** — mark a column as PII with one of six masks and preview the masked view
  live. Display-only: the data itself is never changed.
- **Generate data** — fill a SQL table with fake rows, with per-column recipes inferred from types.
- **Operations panel** — every database operation live, with duration, rows, command, cancel and
  re-run, plus a persisted operation log.
- **Also** — three-tier caching with no speculative prefetch
  ([`docs/PERF.md`](docs/PERF.md)), Touch ID (or system password) confirmation before revealing a saved password,
  multiple windows (`⇧⌘N`), a command palette (`⇧⌘P`), terminal tabs with launchable scripts, and
  Settings for appearance, data, cache, Api, scripts, Claude Code, Database MCP and advanced options.

### Api (HTTP/gRPC client)

- **Request builder** — method, URL, params, headers and body (raw, JSON/XML/HTML/JS,
  form-urlencoded, multipart, binary file), with a raw request editor alongside.
- **gRPC** — unary and streaming calls, sharing collections, environments and variables with HTTP.
- **Collections** — a tree of requests and folders with Postman-format import and export.
- **Environments and variables** — collection- and environment-scoped variables, color-coded
  environments, Faker-backed dynamic values, and secret masking in history and logs.
- **curl** — paste a curl command to build a request, or copy any request out as curl.
- **Response history and timeline** — the last 30 responses per request, and a DNS/connect/TLS/
  first-byte/download timing breakdown.
- **Incognito tabs** — a per-tab toggle; nothing from that tab is saved (no history, no log, no
  variable writes).

### Database MCP server

An optional local [MCP](https://modelcontextprotocol.io) server lets an AI client read your
databases under rules you set. It is off by default and enabled from Settings → Database MCP.

- Loopback only, on port 8766, with its own bearer token.
- Six tools: `list_connections`, `list_children`, `describe_table`, `describe_schema`, `run_query`,
  `explain_query`.
- **Deny by default** — a connection stays invisible to the AI client until you expose it.
- **Per-connection permissions** — read, write and DDL are each *allow*, *deny* or *prompt*
  (defaults: read allow, write prompt, DDL deny). *Prompt* waits for you to approve the exact
  statement. A statement that can't be classified gets the strictest mode.
- Queries estimated above the expensive-query threshold pause for approval when auto-explain is on.
- PII masking rules apply to results before the AI client sees them.

## Requirements (building from source)

- macOS 14 or later, Apple Silicon (`arm64`), with Xcode command-line tools.
- [Go](https://go.dev) 1.27+ and the [Wails v3](https://v3.wails.io) CLI (`wails3`; `bun run setup`
  installs the version pinned in `go.mod`).
- [Bun](https://bun.sh) — package manager, script runner and test runner. Build tooling only;
  nothing ships a Node runtime.
- Optional, for database tests and local fixture databases:
  [Colima](https://github.com/abiosoft/colima) or another Docker-compatible daemon.

## Development

Run from the repo root:

```sh
bun run dev:studio       # native window with hot reload (installs dependencies first)
bun run package:studio   # build and ad-hoc sign the .app and .dmg
```

Other scripts you'll use most (all but the last cover Kira Space too):

- `bun run setup` — install dependencies without building or running anything.
- `bun run lint` and `bun run typecheck` — Biome plus the repo's style guards; TypeScript for every
  package.
- `bun run test:unit`, `bun run test:go` — the unit and Go suites (Go's real-engine cases need
  Docker and skip without it).
- `bun run test:ui:studio` — Playwright UI tests against the built frontend.

`package.json` lists every script. `bun install` also installs git hooks: `pre-commit` runs lint and
typecheck, `pre-push` runs the Go build and linters. The app stores its data in `~/.kira-studio/`
(override with `KIRA_HOME`). For local test databases, see
[`scripts/demo-dbs/README.md`](scripts/demo-dbs/README.md). Test tiers are described in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Testing section, and sandbox-specific setup in
[`docs/DEV_ENVIRONMENT.md`](docs/DEV_ENVIRONMENT.md).

## Architecture

Kira Studio is a single native Go process (Wails v3) that handles windowing, IPC, SQLite storage
and every database driver in-process — no sidecar, no second runtime. The Vue 3 frontend runs in
the system WebView. Control calls go through Wails bindings; result pages travel over a binary
FlatBuffers data plane. Adapters are capability-driven, so adding an engine means adding one
package under `apps/kira-studio/internal/adapters/`, not changing the UI.

```
apps/kira-studio      this app: Go backend (internal/), Vue frontend (frontend/src), tests
apps/kira-space       Kira Space, the git client and code workspace
apps/kira-space-vscode  Kira Space's VS Code extension
internal              Go shared by both apps
packages/             TypeScript/Vue shared by both apps (workbench shell, theme, wire protocol, Api logic, git UI)
docs                  architecture, packaging, performance and the per-chapter records
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the full current-state reference.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the app works today, plus known open
  limitations.
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — building, releasing, install and update.
- [`docs/DEV_ENVIRONMENT.md`](docs/DEV_ENVIRONMENT.md) — building and testing in a given sandbox.
- [`docs/v1.9/`](docs/v1.9/) — the current development chapter's spec and phase plans. Earlier
  chapters live alongside it in `docs/`.
- [`CLAUDE.md`](CLAUDE.md) — the working agreement for changes to this repo.

## Not shipped

Light mode; Windows and Linux; DDL editing; exporting results to CSV/JSON files; connection folders;
split editor groups; SSH tunneling; code signing and notarization. Silent auto-update is
deliberately absent: the app only installs an update after you click **Update** (see
[`docs/PACKAGING.md`](docs/PACKAGING.md) §7).

## License

[MIT](LICENSE)
