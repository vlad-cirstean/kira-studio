# P14 — Docs: the repository README and the in-repo documentation set

> Plan for SPEC.md §10 phase **P14**. Deliverable: *Descriptions in every expected in-repo location
> plus the main repository README — full functionality, install and dev-setup instructions. Written
> once the app's behavior and nonfunctional characteristics are final, so nothing documented here
> needs revisiting.*
>
> This is a documentation phase. **No `src/` file changes, no `tests/` changes, no behaviour
> changes.** The one non-Markdown edit permitted is a single metadata line in `package.json` (D9).

## 0. Ground rules for this phase

- **Describe what the code does, not what the spec wanted.** Every factual claim in the README must
  be traceable to a file in the tree. Where the spec and the tree disagree, the tree wins and the
  README says what shipped. §0's *Realities* below records the four places they currently disagree.
- **The README links the spec; it does not restate it.** `docs/SPEC.md` stays the source of truth
  for architecture, UI detail and per-engine semantics. The README is the front door: what this is,
  what it supports, how to install it, how to develop on it, where to read more. Duplicated prose
  is a maintenance liability and P14's whole premise is that nothing written here needs revisiting.
- **Audit first, then write.** §1 is an audit conclusion about which locations this repo actually
  expects documentation in. Do not add documentation to a location just because other projects have
  one there; §1's list is the complete set.
- **No invented commands.** Every command in the README must exist verbatim in `package.json`
  `scripts`, or be a shell command already documented in `docs/PACKAGING.md`,
  `scripts/demo-dbs/README.md`, or `tests/db/support/docker.ts`. Re-read those sources while
  writing rather than copying the strings out of this plan — this plan was written against the tree
  at commit `6d9ea22` and the sources are authoritative.
- **No screenshots** (D2), **no badges** (D8). Both need P15's CI/release work or macOS hardware
  that does not exist in this environment; inventing either is exactly the "needs revisiting later"
  outcome the phase exists to avoid.
- **Commits follow Conventional Commits** (`AGENTS.md`): `docs:` for the documentation work, with a
  separate `chore:` commit if the `package.json` line in D9 is applied. The phase's last step is to
  land its commits on the v1 feature branch per SPEC.md §12.
- Run `bun run lint` before committing. If `package.json` was touched, also run `bun run typecheck`
  and `bunx electron-vite build`. The DB and UI suites do not need to run for a docs-only phase and
  should not be re-run to pad the phase.

### Realities this phase works with (verified against the tree)

1. **Six adapters exist, not seven.** `src/engine/adapters/` contains `postgres/`, `mariadb/`,
   `mongo/`, `redis/`, `kafka/`, `sqs/`. There is no `s3/`. `src/engine/adapters/registry.ts:11-18`
   registers exactly those six loaders and throws `E_UNSUPPORTED` for anything else.
2. **`s3` is still a valid `ConnectionKind`.** `src/shared/domain/connection.ts:4-12` lists all
   seven; `src/renderer/project/ConnectionDialog.vue:214-216` renders the S3 option `:disabled` with
   the label suffix `— not yet supported`. So S3 is visible-but-unusable, and the README must say
   so rather than either claiming it or pretending the option is absent.
3. **`package.json`'s `description` field claims S3.** It reads *"…MariaDB, PostgreSQL, MongoDB,
   Redis, Kafka, SQS, and S3."* — as does SPEC.md §1's in-scope line. The README must not repeat
   that claim; see D3 for how to phrase the S3 row and D9 for whether `description` is touched
   (it is not).
4. **Three adapters are read-only in v1**, by their own `caps`: `redis/caps.ts` (`writable: false`,
   P9 D2), `kafka/caps.ts` (`writable: false`), `sqs/caps.ts` (`writable: false`). `postgres`,
   `mariadb` and `mongo` are `writable: true`.
5. **`caps.sql` means "this adapter has a query console", not "this adapter speaks SQL."**
   `mongo/caps.ts` and `redis/caps.ts` both set `sql: true` with comments saying the console takes
   that engine's native command form (SPEC §8.14). `kafka` and `sqs` set `sql: false` (P10 D13).
   The README's engine table must label this column *Query console*, not *SQL*.
6. **`docs/SPEC.md:4` is stale.** It reads `> Status: **agreed.** Nothing is implemented.` after
   fourteen implemented phases. D5 fixes this line.
7. **SPEC.md §11's preamble is stale too.** It reads *"Proposal — not yet applied to the tree. P0/P1
   landed with the flatter layout this supersedes"*, but the tree now matches the proposal: `src/`
   has `main/ipc/`, `main/storage/{db.ts,migrate.ts,migrations/,schema/,repos/}`, `engine/cache/`,
   `engine/scheduler/`, one directory per adapter, `renderer/{workbench,project,views,state,bridge,
   theme}/`, and `shared/{protocol,domain}/` + `shared/caps.ts`. The one proposed directory that did
   not materialise is `main/window/` — window creation is a single `src/main/window.ts`, with
   `menu.ts`, `log.ts`, `oplog.ts`, `connections.ts`, `engine-host.ts`, `engine-config.ts`,
   `preconnect.ts` and `tree-service.ts` as siblings. D6 covers the minimal correction.
8. **The repo has exactly two non-root README files**, and neither documents source code:
   `scripts/demo-dbs/README.md` (an operating runbook for the local fixture stack) and
   `docs/design/vscode-modern-ui/README.md` (a manifest for design artboards). There is **no**
   README anywhere under `src/` or `tests/`. Code-structure documentation lives centrally in
   SPEC.md §11. This is the convention P14 must follow — see D1.
9. **`scripts/demo-dbs/` covers four engines, not six.** Its `docker-compose.yml` and `seed.sh`
   provide PostgreSQL, MariaDB, MongoDB and Redis. Kafka and SQS have no compose services; their
   test coverage comes from `@testcontainers/kafka` and `@testcontainers/localstack` inside
   `bun run test:db`. The existing README is accurate about what it does provide but never says what
   it omits — D7 adds one clarifying sentence and nothing else.
10. **`LICENSE` is MIT**, `Copyright (c) 2026 Vlad Cirstean`. `package.json` has **no `license`
    field** (it is `"private": true`). D9 addresses this.
11. **There is no published binary and no release process.** `docs/PACKAGING.md` §6 records "No CI,
    no tag-triggered build, no auto-update. All P15's job." So the README's install path is
    *build from source*, and it must not link a Releases page.
12. **The packaged build is unsigned/ad-hoc.** `docs/PACKAGING.md` §4 item 4 gives the exact
    Gatekeeper workaround (`right-click → Open`, or
    `xattr -dr com.apple.quarantine "/Applications/Kira Studio.app"`). Reuse that wording; do not
    invent a variant.
13. **The DB suite needs Colima, not Docker Desktop.** `tests/db/support/docker.ts:1-13` documents
    the three env prerequisites and `DOCKER_UNAVAILABLE_MESSAGE` names
    `colima start --cpu 4 --memory 6 --disk 40`. The module auto-resolves `DOCKER_HOST` and
    `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` from `docker context inspect`, so the README should say
    "start Colima" and not reprint the export lines as required steps.
14. **`KIRA_HOME` overrides the data directory** (`src/main/storage/paths.ts:6`); it defaults to
    `~/.kira-studio/`, containing `kira.sqlite` and `logs/`. The UI suite uses it to keep tests off a
    developer's real data (`tests/ui/fixtures.ts:36-46`), which is worth one line in the README.
15. **`bun run test:ui` needs a display.** `docs/plans/P13-nonfunctional.md` §0 runs it as
    `xvfb-run -a bun run test:ui` in this Linux container; on macOS it runs directly.

---

## 1. Audit: what "every expected in-repo location" means for this repo

The spec line says *"every expected in-repo location."* This repo is a **single-package Electron
app** — one `package.json`, no workspaces, no publishable sub-packages — and its established
convention (Reality 8) is: **code is documented centrally in `docs/`; a README exists only where a
directory is a self-contained artifact with its own operating instructions.** `scripts/demo-dbs/`
(run these commands to get databases) and `docs/design/vscode-modern-ui/` (these files are artboards,
here is what each one is) are both that; `src/engine/` is not.

**The complete P14 file list:**

| Path | Action | Why |
|---|---|---|
| `README.md` | **REWRITE** (currently a 13-byte stub) | The phase's primary deliverable — §2. |
| `docs/SPEC.md` | **MOD**, two edits only | Stale status line (D5) + stale §11 preamble (D6). No content rewrite. |
| `docs/PERF.md` | **MOD**, one line | Add the README backlink noted in D4. Nothing else — P13 just rewrote it. |
| `docs/PACKAGING.md` | **MOD**, one line | Same backlink (D4). Its content is current. |
| `scripts/demo-dbs/README.md` | **MOD**, one sentence | State that Kafka/SQS are not part of this stack (D7). |
| `docs/design/vscode-modern-ui/README.md` | **NO CHANGE** | Design-reference manifest, accurate, not user/dev docs (D10). |
| `AGENTS.md` | **NO CHANGE** | Working agreement, out of scope; the README links to it. |
| `package.json` | **MOD**, one line | Add `"license": "MIT"` (D9). |
| `docs/plans/P14-docs.md` | **NEW** | This document. |

**Not created, deliberately:** any `README.md` under `src/`, `src/main/`, `src/engine/`,
`src/renderer/`, `src/shared/`, `src/preload/`, `tests/`, `tests/db/`, `tests/ui/`; any
`CONTRIBUTING.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, or `.github/` file. See D1
and §5.

---

## 2. Root `README.md` — section-by-section content plan

Target: **150–220 lines**, GitHub-flavoured Markdown, no HTML, no images, wrapped at 100 columns to
match the other docs. Section order is the reading order of someone who has just landed on the repo:
what is it → does it do my engine → what can it do → how do I get it → how do I work on it → where
is the detail → what it is not → licence.

### 2.1 Title, tagline, status

```
# Kira Studio
```

One or two sentences: a visual database client (DataGrip/DBeaver class) for macOS, built on
Electron + TypeScript + Vue 3, covering six engines from one workbench.

Then a short status paragraph, stating plainly:
- v1 is **in development**; there are no published binaries — you build it from source (Reality 11).
- **macOS 13+, `arm64` only. Dark mode only.** (SPEC §1/§3.)
- The packaged build is **unsigned (ad-hoc)** — signing and notarization are deferred past v1.
- Credentials are stored **in plain text** in `~/.kira-studio/kira.sqlite` (SPEC §6). This belongs
  up top, not buried in a limitations section — it is the one thing a reader must know before
  typing a production password into the connection dialog.

### 2.2 Supported engines

One table, generated by reading the six `src/engine/adapters/*/caps.ts` files — **re-read them, do
not transcribe from this plan.** Columns and the values as of this writing:

| Engine | Default view | Query console¹ | DDL | Server-side filter | Projection | Exact count | Pagination | Writes |
|---|---|---|---|---|---|---|---|---|
| PostgreSQL | Grid | yes (SQL) | yes | yes | yes | yes | keyset | yes |
| MariaDB | Grid | yes (SQL) | yes | yes | yes | yes | keyset | yes |
| MongoDB | Documents | yes (shell-style) | no | yes | no | estimate only | cursor | yes |
| Redis | Key/value | yes (Redis commands) | no | no | no | yes (per key) | `SCAN` cursor | read-only in v1 |
| Kafka | Stream | no | no | no | no | yes (offset delta) | offset window | read-only in v1 |
| SQS | Stream | no | no | no | no | approximate | receive batches | read-only in v1 |

Footnote ¹: the console takes each engine's native command form, not SQL (SPEC §8.14) — this is why
the column is not called "SQL".

Immediately below the table, one short paragraph on **S3**: it appears in the connection dialog
marked *not yet supported* and has no adapter; it is planned, not shipped (Reality 2). Do not put S3
in the table — a row of blanks reads like a capability matrix rather than an absence.

Also note here, in one line each:
- **SQS never polls automatically** — reads happen only on an explicit Poll press, because
  `ReceiveMessage` hides messages from real consumers (SPEC §5.1).
- **Cancellation is real**: stop forwards a cancel to the server (`pg_cancel_backend`, `KILL QUERY`,
  cursor abort, consumer stop), it does not just hide the result.

### 2.3 Features

Grouped bullets, one or two lines each, each pointing at its SPEC section rather than expanding.
Cover exactly what exists:

- **Project panel** — lazy, cached connection tree; per-connection color and live status dot;
  cached-node search; persistent hide/show filters (SPEC §8.3).
- **Connections** — fields or URI mode, twelve-color palette, test-connection, per-connection
  **read-only guard enforced in the engine process** (SPEC §8.12), optional **pre-connect script**
  (e.g. a port-forward) whose exit marks the connection disconnected (SPEC §10 P11).
- **Tabs** — the same table open any number of times with independent paging/sort/filter/scroll;
  session restore reopens tabs without auto-connecting (SPEC §8.4).
- **Data grid** — virtualized both axes, pagination with 10/100/1k/10k page sizes, count-all on
  request, column projection, server-side `WHERE`/`ORDER BY` with history and saved filters,
  in-page find toolbar, stop button (SPEC §8.5).
- **Cell editor** — CodeMirror panel with format autodetect (JSON, XML, SQL, base64, hex, epoch,
  ISO-8601, UUID, URL, CSV), manual override, indented/compact beautify (SPEC §8.6).
- **Document, key/value and stream views** — Mongo documents with per-`_id` expand state, Redis
  keyspace with per-type renderers and TTL, Kafka/SQS message lists (SPEC §8.7–§8.9).
- **Mutations** — add/delete row and cell edits staged as a per-tab pending-change set with an exact
  command preview; commit or rollback; nothing reaches the database until commit (SPEC §8.13).
- **PK/FK navigation** — jump from a key cell to referencing or referenced rows in a pre-filtered
  new tab, driven by cached FK metadata (Postgres/MariaDB) (SPEC §8.5).
- **Query console** — per-connection console tab, run-statement/run-all, results in the grid, saved
  queries (SPEC §8.14).
- **Operations panel** — every DB operation live, with duration, rows, command, cancel, re-run, and
  a persisted op log with retention (SPEC §8.11).
- **Caching** — three tiers: persisted metadata, a byte-budgeted in-memory result-page LRU, and
  counts; with prefetch and a hit-rate readout (SPEC §7, `docs/PERF.md`).
- **Keyboard & command palette** — a deliberately minimal VS Code-flavoured set; list the real
  bindings from `src/main/menu.ts` (`⌘,` settings, `⌘B` project panel, `⌘J` operations panel,
  `⇧⌘P` palette, `⌘F` find, `F5` refresh, `⌘↩` run statement, `⇧⌘↩` run all, `⌃Tab`/`⌃⇧Tab` tab
  switch, `⌘W` close tab, `⇧⌘W` close window) — **verify each against that file**, do not copy this
  list blind.
- **Settings** — Appearance (font family/size, row density), Data (default page size, prefetch,
  count-on-open), Cache (L2 byte budget, hit rate, clear caches), Advanced (engine memory cap,
  op-log retention) — from `src/shared/settings.ts`.

### 2.4 Requirements

- macOS 13 or later, Apple Silicon (`arm64`).
- [Bun](https://bun.sh) — the package manager, script runner and test runner. Electron itself runs
  on its embedded Node; Bun is tooling only (SPEC §3).
- Xcode command-line tools, for packaging.
- **Optional, for the DB test suite and the local fixture stack:** Colima with a running
  Docker-compatible daemon (Reality 13).

Do not pin a Bun or Node version — the repo pins neither, and inventing one here creates a claim
nobody verifies.

### 2.5 Install

Because there is no release yet, this section is "build it yourself":

```sh
git clone <repo-url>
cd kira-studio
bun install
bun run package:mac
```

Then: the artifacts land in `dist/` (`Kira Studio-0.1.0-arm64.dmg`, the `-mac.zip`, and
`dist/mac-arm64/Kira Studio.app` — copy the exact names from `docs/PACKAGING.md` §1); first launch
of an ad-hoc-signed app needs the Gatekeeper step quoted verbatim from `docs/PACKAGING.md` §4 item 4;
`bun run package:mac:dir` builds only the `.app` and is faster. Link `docs/PACKAGING.md` for the
config summary and verification checklist rather than repeating it.

### 2.6 Development

```sh
bun install
bun run dev        # electron-vite dev, HMR for the renderer
```

Then the full script table — **copy the names from `package.json`, all thirteen, nothing invented**:

| Script | What it does |
|---|---|
| `bun run dev` | Dev build with renderer HMR |
| `bun run build` | Production build into `out/` |
| `bun run start` | Preview the production build |
| `bun run lint` | Biome check |
| `bun run format` | Biome check + write |
| `bun run typecheck` | All three splits below |
| `bun run typecheck:node` | main + engine + preload (TS7 native) |
| `bun run typecheck:web` | renderer, including `.vue` (`vue-tsc`) |
| `bun run typecheck:db` | `tests/db` |
| `bun run test:db` | Testcontainers integration suite |
| `bun run test:ui` | Builds, then runs Playwright against the real app |
| `bun run package:mac` | `.dmg` + `.zip` + `.app`, unsigned arm64 |
| `bun run package:mac:dir` | `.app` only (faster) |

Plus a short **App data** note: the app keeps `kira.sqlite` and `logs/` in `~/.kira-studio/`, and
`KIRA_HOME` relocates that whole directory — which is how the tests stay off your real data
(Reality 14).

### 2.7 Tests

Two suites, no unit tests (SPEC §9) — say that explicitly, because its absence otherwise reads as an
oversight.

- **`bun run test:db`** — Testcontainers, real engines, real data. Requires Colima running
  (`colima start --cpu 4 --memory 6 --disk 40`); the harness resolves `DOCKER_HOST` from the active
  Docker context itself, and prints a legible message if the daemon is unreachable. Kafka and SQS
  use `@testcontainers/kafka` and `@testcontainers/localstack`.
- **`bun run test:ui`** — Playwright driving the built Electron app via `_electron.launch()`. It
  runs the build first. On a headless Linux machine, wrap it: `xvfb-run -a bun run test:ui`.
- **Local fixture databases for manual work** — point at `scripts/demo-dbs/README.md` (four engines,
  ~20k-row e-commerce dataset, Colima + Docker Compose). One line, plus the link.

### 2.8 Architecture

Six to ten lines, then links. Reuse SPEC §4's existing ASCII diagram verbatim (renderer ↔ engine over
`MessagePort`, control through main) — one diagram is worth the duplication, and it is stable. State
the two load-bearing facts: **drivers live in a separate `utilityProcess`, so the renderer never
touches a wire protocol**, and **bulk result pages travel renderer↔engine directly, skipping main**.
Then one sentence on the capability-driven adapter model (`src/shared/caps.ts` — adding an engine is
one directory under `src/engine/adapters/`, not a UI change).

Then a short **repository layout** list — top-level directories only, one line each: `src/main`,
`src/engine`, `src/preload`, `src/renderer`, `src/shared`, `tests/db`, `tests/ui`, `docs`,
`scripts/demo-dbs` — and a pointer to SPEC §11 for the full breakdown.

### 2.9 Documentation index

A short link list, since these are the "expected in-repo locations" a reader will want next:

- `docs/SPEC.md` — the full specification: scope, architecture, adapter model, storage, caching, UI.
- `docs/PERF.md` — performance budgets, how each is measured, and the recorded numbers.
- `docs/PACKAGING.md` — macOS build, electron-builder config, verification checklist.
- `docs/plans/` — one implementation plan per phase, P0–P14.
- `docs/design/vscode-modern-ui/` — the workbench visual reference (design artboards).
- `AGENTS.md` — the working agreement for changes to this repo.
- `scripts/demo-dbs/README.md` — local fixture databases.

### 2.10 Not in v1

A single honest list, from SPEC §1 plus Realities 1/2/4: S3; MySQL; SQLite-as-target; light mode;
Windows/Linux; DDL editing; export to CSV/JSON; connection folders; split editor groups; multiple
windows; credential encryption; SSH tunnel (v2); code signing/notarization; auto-update; unit tests;
CI. Plus: writes are add-row / delete-row / cell-edit only — Redis, Kafka and SQS are read-only.

### 2.11 License

MIT — one line, linking `LICENSE`.

---

## 3. Decisions made in this plan

**D1 — No per-folder READMEs under `src/` or `tests/`.** The repo has none today (Reality 8); its
convention is centralized documentation in `docs/` plus a README only where a directory is a
runnable artifact. Adding eight source-tree READMEs would create eight files that drift the first
time a directory is refactored, to describe a layout SPEC.md §11 already describes in one place.

**D2 — No screenshots in v1's README.** No image asset exists in the tree; no macOS hardware has
been available in this environment (`docs/PERF.md` header, `docs/PACKAGING.md` §4), so any screenshot
committed now would be a headless Xvfb software render of the app, not what the product looks like
on the target platform. The README instead points at `docs/design/vscode-modern-ui/` for the visual
reference. A real screenshot set is a later, deliberate addition — not something P14 fakes.

**D3 — S3 is described as absent, in prose, below the engine table.** It is neither hidden (the
connection dialog shows it) nor tabulated (it has no capabilities to tabulate). Reality 2/3.

**D4 — Cross-links are added in both directions, minimally.** The README links `docs/SPEC.md`,
`docs/PERF.md`, `docs/PACKAGING.md`, `docs/plans/`, `AGENTS.md`, `LICENSE` and
`scripts/demo-dbs/README.md`. In return, `docs/PERF.md` and `docs/PACKAGING.md` each gain **one
line** near the top — a "See the [README](../README.md) for what the app is and how to run it"
pointer. No other edit to either file: P13 rewrote PERF.md and P12 wrote PACKAGING.md, and both are
current.

**D5 — `docs/SPEC.md:4`'s status line is corrected.** Replace `> Status: **agreed.** Nothing is
implemented.` with a line stating that P0–P14 are implemented on the v1 feature branch, that the
phasing table in §10 is the record, and that where the spec and the code disagree the code is
authoritative and the README describes what shipped. This is the smallest possible fix to a line
that would otherwise mislead every reader the README sends to the spec.

**D6 — `docs/SPEC.md` §11's preamble gets a two-sentence correction, not a rewrite.** Reality 7: the
proposed layout is now the tree, except that `main/window/` stayed a single `main/window.ts` with
sibling modules. Replace the "Proposal — not yet applied" sentence with a statement that the layout
below is the tree as built, noting that one exception. **Do not touch the tree listing itself, the
"Why this split pays for itself" bullets, or any other SPEC section** — rewriting SPEC's architecture
content is explicitly a non-goal (§5).

**D7 — `scripts/demo-dbs/README.md` gets one clarifying sentence and no restructuring.** After its
opening paragraph, state that this stack covers four of the six supported engines and that Kafka and
SQS are exercised through Testcontainers in `bun run test:db` rather than through Compose
(Reality 9). The file is otherwise accurate and current — verified against `docker-compose.yml`,
`seed.sh` and the four engine subdirectories.

**D8 — No badges.** Build/CI/coverage/release badges all require P15's GitHub Actions work; a badge
pointing at a workflow that does not exist is a broken image on the repo's front page. P15 adds them
when it adds the workflows.

**D9 — `package.json` gains `"license": "MIT"`, and nothing else.** `LICENSE` is MIT (Reality 10) and
the manifest is silent about it, which is a real inconsistency in an "expected in-repo location" for
project metadata. Place it after `"author"`. **Do not** change `"description"` (it names S3, matching
SPEC §1's scope statement — the README carries the accurate shipped-state claim, and editing the
scope statement is D5/D6's business, not this line's), `"version"`, `"private"`, or anything else.
Re-run `bun run lint`, `bun run typecheck` and `bunx electron-vite build` after this edit.

**D10 — `docs/design/vscode-modern-ui/README.md` is not touched.** It is an accurate manifest for
five artboard files and it already says what it is ("source artboards … not production Vue
components"). It is design reference, not user or developer documentation, so it appears in the
README's documentation index and is otherwise left alone.

**D11 — Facts come from the tree at write time.** The tables in §2.2, §2.3 and §2.6 of this plan are
a specification of *what to write about*, captured at commit `6d9ea22`. The implementer re-reads
`src/engine/adapters/*/caps.ts`, `src/main/menu.ts`, `src/shared/settings.ts` and `package.json`
while writing and uses those values. If any disagree with this plan, the tree wins and the
divergence is worth a sentence in the commit body.

---

## 4. Non-goals

P14 does **not**:

1. **Rewrite `docs/SPEC.md`.** Two surgical edits only (D5, D6). No re-scoping, no re-phrasing of
   §1–§9, no updating the phasing table, no reconciling S3's in-scope claim with its absence.
2. **Add per-folder READMEs** anywhere under `src/` or `tests/` (D1).
3. **Add `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates,
   or anything under `.github/`.** Repository tooling is P15's deliverable; a CONTRIBUTING file
   would also duplicate `AGENTS.md`, which is this repo's actual working agreement.
4. **Add badges, screenshots, GIFs, or a logo** (D2, D8).
5. **Document features that do not exist.** No S3 usage instructions, no export-to-CSV, no SSH
   tunnel, no light mode, no auto-update, no remappable keybindings — every one of these is on
   SPEC §1's deferred list and none is in the tree.
6. **Touch `src/` or `tests/`.** If writing the README surfaces a code bug or an inaccuracy that
   can only be fixed in code, record it in the commit body / hand it to P15; do not fix it here.
   P13 closed the nonfunctional sweep and the surface is frozen.
7. **Re-measure or re-verify performance or packaging.** `docs/PERF.md` and `docs/PACKAGING.md`
   carry the numbers and the unrun-checklist caveats; the README links them and states nothing
   numeric of its own beyond what those files already record.
8. **Set up documentation infrastructure** — no docs site, no generated API reference, no TypeDoc,
   no Mermaid toolchain. Plain Markdown in `docs/`, as today.
9. **Rename, move, or reorganise existing docs.** `docs/` keeps its current flat shape.

---

## 5. Verification

There is no test suite for prose, so verification is a read-through against explicit sources:

1. **Command check.** Every `bun run …` string in the README appears verbatim in `package.json`
   `scripts`. Every other shell command appears verbatim in `docs/PACKAGING.md`,
   `scripts/demo-dbs/README.md`, or `tests/db/support/docker.ts`.
2. **Link check.** Every relative link in the README resolves to a file that exists
   (`docs/SPEC.md`, `docs/PERF.md`, `docs/PACKAGING.md`, `docs/plans/`,
   `docs/design/vscode-modern-ui/`, `AGENTS.md`, `LICENSE`, `scripts/demo-dbs/README.md`), and the
   two new backlinks in PERF.md/PACKAGING.md resolve to `../README.md`.
3. **Capability check.** The engine table matches all six `caps.ts` files field for field, including
   the three `writable: false` engines and the two `sql: false` ones.
4. **Absence check.** `rg -n "S3|s3" README.md` returns only the "not yet supported" paragraph.
   `rg -in "badge|shields.io|screenshot|!\[" README.md` returns nothing.
5. **Toolchain check.** `bun run lint` passes. If `package.json` was edited: `bun run typecheck` and
   `bunx electron-vite build` also pass.
6. **Fresh-reader check.** Read the README top to bottom as someone who has never seen the repo, and
   confirm it answers, in order: what is this, does it support my database, what can it do, how do I
   get it, how do I run it from source, how do I run the tests, where is the detail, what will it
   not do, what licence.

## 6. Acceptance checklist

- [ ] `docs/plans/P14-docs.md` exists (this document) and is committed.
- [ ] `README.md` is rewritten per §2, 150–220 lines, wrapped at 100 columns.
- [ ] README states: macOS 13+ arm64 only, dark mode only, no published binaries (build from
      source), unsigned ad-hoc build, **plain-text credential storage**.
- [ ] README's engine table lists exactly six engines with values matching
      `src/engine/adapters/*/caps.ts`; the console column is labelled *Query console* with the
      native-command-form footnote.
- [ ] README describes S3 in prose as present-in-dialog-but-unimplemented, and nowhere claims S3
      support.
- [ ] README names Redis, Kafka and SQS as read-only in v1.
- [ ] README's script table lists only real `package.json` scripts, all of them, with correct
      descriptions.
- [ ] README documents `~/.kira-studio/` and the `KIRA_HOME` override.
- [ ] README's test section names Colima for `test:db` and the `xvfb-run` wrapper for headless
      `test:ui`, and states that there are no unit tests by design (SPEC §9).
- [ ] README links `docs/SPEC.md`, `docs/PERF.md`, `docs/PACKAGING.md`, `docs/plans/`,
      `docs/design/vscode-modern-ui/`, `AGENTS.md`, `scripts/demo-dbs/README.md`, `LICENSE`.
- [ ] README contains no badge, no image, no screenshot, no link to a Releases page.
- [ ] `docs/SPEC.md:4`'s status line is corrected (D5); no other change to §1–§10.
- [ ] `docs/SPEC.md` §11's "not yet applied" preamble is corrected (D6); the tree listing and the
      bullets below it are untouched.
- [ ] `docs/PERF.md` and `docs/PACKAGING.md` each gained exactly one README backlink line (D4).
- [ ] `scripts/demo-dbs/README.md` gained exactly one sentence about the four-of-six coverage (D7).
- [ ] `docs/design/vscode-modern-ui/README.md` is unchanged; no README exists under `src/` or
      `tests/`; no `.github/`, `CONTRIBUTING.md`, `CHANGELOG.md` or `SECURITY.md` was created.
- [ ] `package.json` gained `"license": "MIT"` and no other change (D9).
- [ ] No file under `src/` or `tests/` was modified.
- [ ] §5's six verification passes are done.
- [ ] `bun run lint` passes (plus `bun run typecheck` and `bunx electron-vite build` if
      `package.json` was touched).
- [ ] Commits follow Conventional Commits — `docs(p14): …` for the documentation, a separate
      `chore: add license field to package.json` if D9 is applied — and are landed on the v1
      feature branch per SPEC.md §12.

## 7. Target tree at the end of P14

```
README.md                                REWRITE — §2: title/status, engines, features, install,
                                                   development, tests, architecture, docs index,
                                                   not-in-v1, license.
AGENTS.md                                unchanged
LICENSE                                  unchanged
package.json                             MOD — "license": "MIT" after "author" (D9).
docs/
  SPEC.md                                MOD — line 4 status (D5); §11 preamble (D6). Nothing else.
  PERF.md                                MOD — one README backlink line near the top (D4).
  PACKAGING.md                           MOD — one README backlink line near the top (D4).
  design/vscode-modern-ui/README.md      unchanged (D10)
  plans/
    P14-docs.md                          NEW — this document.
scripts/demo-dbs/README.md               MOD — one sentence: four of six engines; Kafka/SQS come
                                               from Testcontainers in test:db (D7).
src/                                     unchanged
tests/                                   unchanged
```
