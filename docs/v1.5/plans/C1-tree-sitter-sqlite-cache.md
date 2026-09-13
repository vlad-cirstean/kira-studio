# C1 — Tree-sitter parsing pipeline, cached in SQLite

> **What this phase is.** `docs/v1.5/SPEC.md`'s C1 row turned into steps, from research against the
> real tree plus direct probes of every candidate dependency (Go module proxy version lists and
> `go.mod` files, upstream grammar sources, the binding's own `api.h` and `query.go`). Backend
> only: two new Go packages, no renderer code, no bound service, no wire contract, no user-visible
> surface. Its consumers are C2 (graph), C3 (Monaco definition provider) and C7 (MCP server).

## 0. What SPEC left open, and how each is resolved

SPEC's C1 row names five open questions. Each is decided here, none left open.

**D1 — Binding: the official cgo binding, `github.com/tree-sitter/go-tree-sitter`, plus ten
upstream grammar modules.** No pure-Go option meets this repo's dependency bar today (§1 lists what
was found, measured and declined). Tree-sitter grammars are generated C with hand-written C
external scanners; 7 of the 10 grammars this phase needs ship a `scanner.c`. cgo is a real cost,
priced in §1 — and materially cheaper here than for a `darwin && cgo` file, because this code
compiles, vets and tests on Linux in the dev container.

**D2 — Storage: one shared SQLite file, `${KIRA_HOME}/codeindex.db`, `repo_id`-scoped, never a
table in `kira.db`.** A second file at all follows `review.db`'s own precedent
(`docs/ARCHITECTURE.md` Storage) — a different lifecycle from settings/tab state, and `kira.db`
runs `SetMaxOpenConns(1)`, so a reindex writing through it would serialise ahead of every debounced
tab save. `review.db` itself is one shared file across every repository, not a per-repository
split — so a shared `codeindex.db` follows that precedent exactly rather than departing from it.
Every row carries `repo_id` (`gitclient`'s own repository identity), and the connection pool is
sized independently of `kira.db`'s (`SetMaxOpenConns(4)`, matching §8's worker-pool bound) — WAL
already serves concurrent readers alongside one writer, and §8 already serialises writes through
one application-level goroutine, so nothing here needs kira.db's single-connection posture in the
first place. Dropping one repository's cache is `DELETE FROM file WHERE repo_id = ?`, cascading to
`file_block`/`symbol`/`reference` via existing foreign keys — not `os.Remove` of a file, the
tradeoff a shared file makes: simpler operational story (one file, one set of migrations, one
connection pool) at the cost of an SQL delete instead of an instant unlink; `_auto_vacuum
=INCREMENTAL` (already in the DSN, §5.1) is what reclaims the freed pages afterward. §5.

**D3 — Reparse on change: its own worktree watcher, not the git-status watcher.** The existing
watcher cannot serve this, for two independent reasons, both checked in the tree rather than
assumed: it watches `commonDir` and `gitDir` only, never the worktree (`watcher_fsnotify.go`'s
`newBackend`, `watcher_fsevents_darwin.go`'s `newBackend`), so an editor saving a source file
produces no event at all; and its output channel is `chan Signal` with two values and **no path**
(`watcher.go`), so even a widened watch could not say which file changed. (`docs/ARCHITECTURE.md`
says that watcher covers "plus the worktree" — the tree disagrees and the tree outranks it. §12
corrects the sentence.) §7 designs the new watcher and the incremental-edit mapping.

**D4 — What is stored: per-file declarations, references and embedded-block ranges. Never the parse
tree itself.** Tree-sitter has no serialization API at all — `api.h` exposes `ts_tree_copy`,
`ts_tree_delete` and `ts_tree_print_dot_graph`, and nothing that writes a tree out or reads one
back — so "persist the trees" has no literal implementation in any binding. The durable artifact is
the symbol/reference table; a live `*Tree` is held in memory only, bounded, purely to make the next
reparse incremental. §4 states the exact capture-to-row mapping and what is deliberately not
extracted.

**D5 — Two new Go packages, no TypeScript.** `internal/codeparse` (the only package in the repo
that imports tree-sitter, and the only cgo one outside the existing `darwin && cgo` set) and
`internal/codeindex` (the SQLite cache, file enumeration, reconcile and watcher). §2.

**In scope**: the grammar set and its cgo dependency (§1), the two packages (§2), language and
dialect resolution including SFC injection (§3), query-based extraction over vendored upstream
`tags.scm` (§4), the shared, `repo_id`-scoped cache file and its schema (§5), enumeration and reconcile (§6),
the worktree watcher and incremental reparse (§7), bounds and the idle-cache reaper (§5.4),
tests (§11), doc updates (§12).

**Not attempted** (§9 states why for each): any cross-file resolution, any framework-specific
inference, syntax highlighting, a `.scm` query written by hand, a bound service or renderer
surface, and any caller that opens an index — C1 is a library; C2 and C7 are its first callers.

## 1. The binding and the grammars

### 1.1 What was found

| Candidate | License | cgo | State at plan time | Verdict |
|---|---|---|---|---|
| `github.com/tree-sitter/go-tree-sitter` | MIT | yes | v0.25.0, upstream org, per-grammar modules | **taken** |
| `github.com/drummonds/gotreesitter` | MIT | no | v0.6.4, 206 grammars, 0 stars, 0 importers | declined |
| `github.com/malivvan/tree-sitter` | MIT | no (wazero) | 5 stars, 3 commits, "pre release software" | declined |
| own wasm build under `wazero` | — | no | would be built here | declined |
| `github.com/smacker/go-tree-sitter` | MIT | yes | 566 stars, grammars forked into the repo | declined |

**Taken: the upstream binding.** `go-tree-sitter` v0.25.0 vendors the tree-sitter C runtime and
accepts grammar ABI 13 through 15 (`include/tree_sitter/api.h`: `TREE_SITTER_LANGUAGE_VERSION 15`,
`TREE_SITTER_MIN_COMPATIBLE_LANGUAGE_VERSION 13`). Every grammar below reports ABI 14, so the whole
set is in range with room on both sides. The API this phase needs is all present:
`Parser.ParseCtx(ctx, text, oldTree)` (context-aware cancellation), `Parser.SetIncludedRanges`,
`Tree.Edit(*InputEdit)`, `Tree.ChangedRanges(other)`, `Query`/`QueryCursor`.

**Declined: `gotreesitter`, the pure-Go runtime.** It is the only pure-Go candidate that claims this
language set, and on paper it is what this repo's cgo-free preference asks for. It is a ground-up
reimplementation of both the parse-table interpreter and every grammar's external scanner, by one
author, with zero importers, published four months ago. Its own README reports full parses about
3.9x slower than the C runtime and 3 of 206 grammars degraded for missing external-scanner support
— and 7 of the 10 grammars this phase needs ship a hand-written C `scanner.c` (python, javascript,
typescript, rust, html, css, svelte). The failure mode of a wrong parse table is a wrong tree, with
no error, under three later phases that all read this output. `modernc.org/sqlite` is the precedent
for taking a pure-Go transpilation of a C library — but that is a mechanical transpilation of the
same upstream amalgamation, not a reimplementation, which is the whole difference.

**Declined: `malivvan/tree-sitter`.** Right architecture (a wasm build of the real tree-sitter under
`wazero`, so no reimplementation risk), wrong maturity: 5 stars, 3 commits, self-described
pre-release, no grammar packaging story documented.

**Declined: building the wasm ourselves.** Same architecture without the maturity problem, but this
repo would own a `wasi-sdk`/emscripten toolchain, a pinned per-grammar wasm artifact committed as a
binary blob, and a regeneration script — for a capability the packaged build already has, since the
darwin package task sets `CGO_ENABLED: 1` today (`apps/kira-studio/build/darwin/Taskfile.yml`).
Compare `scripts/generate-wire.sh`'s pinned `flatc` toolchain: that one exists because there is no
alternative to generating code from a `.fbs`. Here there is one.

**Declined: `smacker/go-tree-sitter`.** Still cgo, so it buys nothing on that axis, and it carries
grammars as copies inside its own repository rather than tracking each upstream module — the
upstream org's own binding supersedes it.

### 1.2 The grammar set

Ten modules, every one MIT, every one ABI 14, each exposing `bindings/go`'s
`Language() unsafe.Pointer` over a cgo `#include "../../src/parser.c"` (plus `scanner.c` where the
grammar has one):

| Language | Module | Version at plan time |
|---|---|---|
| Java | `github.com/tree-sitter/tree-sitter-java` | v0.23.5 |
| Python | `github.com/tree-sitter/tree-sitter-python` | v0.25.0 |
| JavaScript (and JSX) | `github.com/tree-sitter/tree-sitter-javascript` | v0.25.0 |
| TypeScript and TSX | `github.com/tree-sitter/tree-sitter-typescript` | v0.23.2 |
| Go | `github.com/tree-sitter/tree-sitter-go` | v0.25.0 |
| Rust | `github.com/tree-sitter/tree-sitter-rust` | v0.24.2 |
| HTML | `github.com/tree-sitter/tree-sitter-html` | v0.23.2 |
| CSS | `github.com/tree-sitter/tree-sitter-css` | v0.25.0 |
| JSON | `github.com/tree-sitter/tree-sitter-json` | v0.24.8 |
| Svelte | `github.com/tree-sitter-grammars/tree-sitter-svelte` | v1.0.2 |

The TypeScript module is one package exposing two languages, `LanguageTypescript()` and
`LanguageTSX()`. Versions above are what the module proxy listed while this plan was written; S1
pins whatever is current then, subject to the ABI check above, and records the pins in `go.mod`.

**Vue has no Go module and gets no grammar.** `tree-sitter-grammars/tree-sitter-vue` is a 26-star
fork of the unmaintained `ikatyang/tree-sitter-vue`, with no `bindings/go` and no module on the
proxy; nothing else publishes one. Writing our own binding over vendored grammar C would mean
this repo owning a grammar fork. Instead `.vue` is parsed by the HTML grammar as the SFC container
with per-block injection (§3.2) — which is what an SFC is: an HTML-shaped envelope around blocks in
other languages. What that gives up is named in §3.2.

### 1.3 What cgo costs, stated rather than waved through

- **A C compiler becomes a build requirement** for `internal/codeparse` and anything importing it.
  Present in this container (`gcc`, `clang`) and installed by every environment that already builds
  the Wails shell. `docs/DEV_ENVIRONMENT.md`'s "need nothing but the Go toolchain" line stops being
  true for the whole tree and is corrected in §12.
- **First build compiles roughly 34 MB of generated C** (measured upstream file sizes: typescript
  8.3 MB, tsx 8.4 MB, rust 6.2 MB, python 3.3 MB, javascript 2.7 MB, java 2.4 MB, go 1.5 MB, css
  0.5 MB, svelte 0.2 MB, html 0.1 MB, json 0.04 MB). Go's build cache absorbs every build after the
  first.
- **The binary grows**, mostly parse tables. Measure it once at S1 — `go build` of
  `./apps/kira-studio/...` before and after, `linux/amd64`, no flags — and record the delta in that
  commit message, the same way the gRPC dependency's 14.2 MB is recorded in `docs/ARCHITECTURE.md`.
  This is a real, decision-relevant number for a chapter that adds Monaco and an MCP server on top.
- **`CGO_ENABLED=0` no longer builds a package that imports `internal/codeparse`.** Nothing in this
  repo sets it; the darwin package task sets `CGO_ENABLED: 1` already.

What it does **not** cost: unlike a `darwin && cgo` file, this code is compiled, vetted and tested
by this container on every run, so it is not in the "written by nobody, checked by nobody" category
`docs/DEV_ENVIRONMENT.md` warns about. `GOOS=darwin` cross-compilation from Linux was already
impossible for anything cgo, and the shell has always been built on a Mac.

### 1.4 Memory rule

Every `Parser`, `Tree`, `Query` and `QueryCursor` allocates C memory and must be `Close`d. One
invariant makes that checkable rather than hoped for: **no `*tree_sitter.Tree` and no
`*tree_sitter.Node` ever leaves `internal/codeparse`.** Callers receive plain Go structs
(`Symbol`, `Reference`, `Block`, byte offsets and points). This also keeps `codeindex`, C2, C3 and
C7 free of tree lifetimes entirely.

## 2. Where the code lives

```
apps/kira-studio/internal/codeparse/        cgo; the only package importing tree-sitter
  languages.go     the language registry: id, grammar, extensions, query set
  detect.go        path and extension to language id
  queries/*.scm    vendored upstream tags queries, //go:embed
  queries.go       embed, compile once per language, provenance table
  extract.go       query matches to Symbol/Reference structs
  inject.go        SFC and HTML block split, included ranges
  session.go       Session: parser pool, resident-tree cache, Parse, Reparse
  edit.go          whole-file old/new content to one InputEdit

apps/kira-studio/internal/codeindex/        pure Go
  db.go            the shared cache file: path, DSN, lazy open, chmod, pool size
  migrate.go       forward-only schema_version runner
  migrations/      0001_c1_init.sql + embed.go
  store.go         file/block/symbol/reference read and write
  enumerate.go     git ls-files through gitclient's runner
  sync.go          reconcile: stale rules, insert, update, delete
  index.go         Index: Open, Sync, Watch, Close
  watch.go         path-carrying debounced watcher (shared loop)
  watch_fsevents_darwin.go   //go:build darwin && cgo
  watch_fsnotify.go          //go:build !darwin || !cgo
  reaper.go        idle-cache-file sweep
```

Layering: neither package imports `internal/bridge` (`internal/layering_test.go` covers this
automatically once the packages exist) and neither imports or is imported by an adapter.
`codeindex` imports `internal/gitclient` and `internal/gitpath` deliberately — §6 states why
enumeration goes through git's existing spawn discipline instead of a second one — and nothing
in `internal/git*` imports back.

## 3. Languages, dialects, injection

### 3.1 Extension map

| Extensions | Language id | Grammar |
|---|---|---|
| `.java` | `java` | java |
| `.py`, `.pyi` | `python` | python |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `javascript` | javascript |
| `.ts`, `.mts`, `.cts`, `.d.ts` | `typescript` | typescript |
| `.tsx` | `tsx` | typescript module's TSX language |
| `.go` | `go` | go |
| `.rs` | `rust` | rust |
| `.html`, `.htm` | `html` | html |
| `.css` | `css` | css |
| `.json` | `json` | json |
| `.vue` | `vue` | html as container, injected blocks (§3.2) |
| `.svelte` | `svelte` | svelte as container, injected blocks (§3.2) |

Anything else is not enumerated, not parsed and gets no row (§6).

**React needs nothing of its own.** JSX is in the javascript grammar and TSX in the typescript
module's second language. Component and hook conventions are AST-level inference, which is C2's row,
not this one.

**Angular needs no grammar either**, and C1 deliberately stops short of its one framework-specific
piece: a component's external `templateUrl` file is an ordinary `.html` file already parsed as one,
while an **inline `template:`/`styles:` string inside a `@Component` decorator is not injected**.
Detecting it means recognising a decorator by name and treating one string literal's contents as
another language — framework semantics, which SPEC assigns to C2. Recorded here so C2 finds the
line already drawn rather than assuming C1 covered it.

### 3.2 SFC and HTML injection

One mechanism, parameterised by container grammar:

1. Parse the whole file with the container grammar (html for `.vue` and `.html`, svelte for
   `.svelte`).
2. Find `script_element` and `style_element` nodes and their `raw_text` child. Both grammars share
   these node names (verified in each grammar's own `grammar.js`).
3. Resolve each block's language from its `lang` attribute: absent or `js` gives javascript, `ts`
   or `typescript` gives typescript, `tsx` gives tsx, `css` or absent on a style block gives css.
4. Parse each block **over the same file buffer** with `Parser.SetIncludedRanges` set to the
   `raw_text` node's range.

Step 4 is the load-bearing choice. Included ranges mean every node's byte offset and point come
back in **file** coordinates, so no offset arithmetic exists anywhere in extraction or storage —
the alternative (slicing the block's bytes into their own buffer) would put a `+start` on every
byte and a row/column fixup on every point, in every consumer, forever.

A `<template>` block is an ordinary `element` in both grammars and needs no injection: its children
are already parsed by the container.

Blocks with a language outside this set (`scss`, `less`, `sass`, `stylus`, `pug`) get a
`file_block` row recording the range and `language = 'unsupported'`, and no injected parse. Honest
and visible, rather than parsing SCSS with the CSS grammar and storing a tree full of errors.

**What using html as the Vue container gives up**: Vue directives (`v-if`, `:prop`, `@click`) parse
as ordinary HTML attributes rather than as directive nodes, and `{{ }}` interpolation parses as
text rather than as a JavaScript expression. Neither is lost information — the bytes and their
ranges are in the tree — but neither is pre-classified for C2 either. Svelte is the same story for
`svelte_raw_text` markup expressions, which C1 records as part of the container parse and does not
inject as JavaScript.

## 4. Extraction: what a parse turns into

### 4.1 Queries

Symbol extraction runs tree-sitter's own query language over vendored upstream `queries/tags.scm`
files — the same queries GitHub's own code navigation uses, so this phase writes no query language
by hand. Present upstream for exactly the six languages where symbols matter (java, python,
javascript, typescript, go, rust); absent for html, css, json and svelte, which is correct rather
than a gap (a CSS selector and a JSON key are not definitions anything resolves to). Those four
contribute `file` rows, and for the two container grammars `file_block` rows, and no symbols.

Each `.scm` is copied into `internal/codeparse/queries/` at the pinned grammar version, embedded
with `//go:embed`, and compiled once per language at first use. `queries.go` carries a provenance
table (upstream repository, path, module version) and `NOTICES.md` gains one entry naming the ten
grammars and the vendored query files, all MIT — the same treatment `seti-icons` already gets there.

Upstream tags queries use `#strip!` and `#set-adjacent!` directives for doc comments. These parse
without error: `go-tree-sitter`'s `query.go` routes any predicate it does not know into
`generalPredicates` rather than returning a `QueryError` (verified in the predicate switch's default
arm). C1 ignores `@doc` captures entirely.

### 4.2 Capture mapping

Closed sets, unknown captures ignored (so a grammar upgrade adding a capture cannot break a parse):

- `@definition.<x>` becomes `Symbol.Kind`, `x` mapped into
  `class | interface | struct | enum | type | function | method | constructor | field | constant |
  variable | module | macro`.
- `@reference.<x>` becomes `Reference.Kind`, mapped into `call | type | implementation | import`.
- `@name` inside a definition's own byte range supplies the symbol's name and the name node's own
  range. A definition match with no `@name` is skipped.

Per symbol row: kind, name, the definition node's full range (start and end byte, start and end
point), the name node's range, the enclosing block (if any), and a parent symbol computed by range
containment over the file's own symbols sorted by start byte. Per reference row: kind, name, range,
block.

Duplicates are real — several patterns can capture one node, e.g. go's `type_spec` plus
`type_declaration` patterns — and are removed by `(kind, name, start_byte, end_byte)`.

### 4.3 Deliberately not extracted

Named so C2 inherits a line rather than a guess: no scope or binding analysis (`locals.scm` is not
vendored), no type information, no signature or parameter list, no doc text, no import resolution
(an import is stored as a `reference` row carrying the literal text, never resolved to a file), no
cross-file link of any kind, no framework inference, and no highlight tokens (C3 uses Monaco's
Monarch grammars for that, per SPEC's C3 row).

## 5. The cache

### 5.1 One shared file, `repo_id`-scoped

`${KIRA_HOME}/codeindex.db`, mode 0600 — one file for every repository the app ever opens, not one
per repository. `RepoID` (`gitclient`'s own absolute-git-dir identity, NFC-normalized, tier 1) is a
column on every table below, the same way `git_repo_settings` already scopes rows by repository
inside `kira.db` (`docs/ARCHITECTURE.md` Storage) — so two spellings of one repository share one
set of rows, and dropping a repository's data is `DELETE FROM file WHERE repo_id = ?`, cascading to
`file_block`/`symbol`/`reference` (§5.4).

Not a table in `kira.db`, for two reasons: a parse cache is order-of-100-MB and rewritten
constantly, where `kira.db` holds settings, tabs and connections (the same lifecycle split
`review.db` established — `docs/ARCHITECTURE.md` Storage); and `kira.db` runs
`SetMaxOpenConns(1)`, so every reindex statement would queue ahead of the debounced tab save on the
same one connection. `codeindex.db` gets its **own** pool, `SetMaxOpenConns(4)` matching §8's
worker-pool bound — WAL already lets readers proceed concurrently alongside one writer, and §8
already serialises writes through one application-level goroutine, so nothing here needs
`kira.db`'s single-connection posture to begin with.

The DSN is `internal/storage/db.go`'s six pragmas verbatim, the same way `gitreview/db.go` copies
them: `_busy_timeout=5000`, `_foreign_keys=1`, `_auto_vacuum=INCREMENTAL`,
`_pragma=journal_size_limit(4194304)`, `_journal_mode=WAL`, `_synchronous=NORMAL`. WAL carries more
weight here than anywhere else in the app: C7's MCP server is a **separate process** reading the
same file while the app writes it, which is exactly what WAL plus a busy timeout is for. One note
handed forward to C7 rather than solved here: a read-only SQLite connection to a WAL database still
needs to create the `-shm` file, so C7 opens this file read-write and never writes, rather than
`mode=ro`.

Migrations are forward-only numbered SQL under `internal/codeindex/migrations/` with the same
`embed.go` `names` table and the same `schema_version` runner `gitreview/migrate.go` uses —
copied, not shared, for the reason that file already records: exporting a runner from
`internal/storage` would make a studio package a compile-time dependency of this one in exchange
for a `for` loop. Same refusal on a `schema_version` newer than the binary knows.

### 5.2 Schema (`0001_c1_init.sql`)

```sql
CREATE TABLE meta (
  repo_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (repo_id, key)
);  -- per repo_id: repo_root, parser_fingerprint, created_at, last_used_at, last_full_sync_at

CREATE TABLE file (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       TEXT    NOT NULL,
  path          TEXT    NOT NULL,         -- repository-relative, git's own bytes (tier 2: never
                                          -- NFC-normalized, see gitpath)
  language      TEXT    NOT NULL,         -- this app's own language id (§3.1)
  size_bytes    INTEGER NOT NULL,
  mtime_unix_ns INTEGER NOT NULL,
  content_sha   BLOB    NOT NULL,         -- sha256 of the file's bytes, 32 bytes
  parse_status  TEXT    NOT NULL,         -- 'ok' | 'tooLarge' | 'binary' | 'unreadable'
  has_error     INTEGER NOT NULL,         -- root node HasError: parsed, with ERROR nodes in it
  line_count    INTEGER NOT NULL,
  parsed_at     INTEGER NOT NULL,         -- unix millis
  UNIQUE (repo_id, path)                  -- a path is only unique within its own repository
);
CREATE INDEX file_repo ON file (repo_id);

CREATE TABLE file_block (                 -- injected regions: SFC and HTML only
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,            -- 'template' | 'script' | 'script-setup' | 'style'
  language   TEXT    NOT NULL,            -- the grammar actually used, or 'unsupported'
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL
);
CREATE INDEX file_block_file ON file_block (file_id, start_byte);

CREATE TABLE symbol (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  repo_id    TEXT    NOT NULL,            -- denormalized from file: every lookup here is by
                                          -- repository, and this avoids a join on the hot path
  block_id   INTEGER REFERENCES file_block(id) ON DELETE CASCADE,  -- NULL outside an SFC block
  parent_id  INTEGER REFERENCES symbol(id) ON DELETE CASCADE,      -- enclosing symbol, by range
  kind       TEXT    NOT NULL,            -- §4.2's closed set
  name       TEXT    NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  end_row    INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  name_start_byte INTEGER NOT NULL,       -- the @name node's own range: what a jump targets
  name_end_byte   INTEGER NOT NULL,
  name_start_row  INTEGER NOT NULL,
  name_start_column INTEGER NOT NULL
);
CREATE INDEX symbol_file ON symbol (file_id, start_byte);
CREATE INDEX symbol_name ON symbol (repo_id, name);

CREATE TABLE reference (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  repo_id    TEXT    NOT NULL,            -- denormalized from file, same reason as symbol.repo_id
  block_id   INTEGER REFERENCES file_block(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,            -- 'call' | 'type' | 'implementation' | 'import'
  name       TEXT    NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL
);
CREATE INDEX reference_file ON reference (file_id, start_byte);
CREATE INDEX reference_name ON reference (repo_id, name);
```

`file_block` carries no `repo_id` of its own — every lookup reaches it through `file_id`, never
directly by repository, so the denormalization `symbol`/`reference` need (their own hot lookup path
is by name *within* a repository) doesn't apply to it.

Positions are stored twice on purpose: byte offsets are what tree-sitter and a reparse work in,
row/column points are what a UI needs. Tree-sitter's column is a **byte** column; converting to
Monaco's UTF-16 column is C3's job, stated here so nobody converts twice.

### 5.3 Freshness and the parser fingerprint

A `file` row is stale when its `size_bytes`, `mtime_unix_ns` or `content_sha` disagrees with disk.
Cheap fields are compared first; `content_sha` is computed only when size or mtime moved, so an
unchanged repository re-reads no file content at all.

`meta.parser_fingerprint` is a hash over every grammar module version plus every embedded `.scm`
file's own bytes. A mismatch on open means the extraction contract changed under the stored rows,
so the whole cache is truncated and rebuilt. Fingerprint at the database level rather than per file:
a grammar upgrade invalidates every row of that language anyway, and one comparison beats one per
file.

### 5.4 Bounds

Per `docs/ARCHITECTURE.md`'s own standard — rows written by machinery need a count bound and a byte
bound:

- **Per file: 2 MiB.** A larger file is recorded with `parse_status = 'tooLarge'` and no symbols
  (same shape `review_file.content_kind` already uses). This is the byte bound: symbol count scales
  with file size, so capping bytes caps rows, and no second cap is needed.
- **A file with a NUL byte in its first 8 KiB** is `binary` and gets no parse. Enumeration already
  excludes ignored build output, so vendored minified bundles are the residual case and the 2 MiB
  cap covers the big ones.
- **Per repository: one row per source file**, which is the repository's own size — the count bound.
  Every reconcile deletes rows for files that left the enumeration, so a rename or a deletion frees
  its rows in the same pass that notices it.
- **Per repository inside `codeindex.db`: a repository untouched for 14 days has its rows deleted**
  — `DELETE FROM file WHERE repo_id = ? AND repo_id NOT IN (recently used)`, cascading to
  `file_block`/`symbol`/`reference` — swept on any `Open`, the same idle window `gitreview` uses.
  Every `Open` writes that repository's own `meta.last_used_at` row, which is the sweep's oracle;
  unlike a per-repository file, this is a query over `meta` rather than a directory listing's mtimes,
  and reclaiming the freed pages is `_auto_vacuum=INCREMENTAL`'s job (§5.1), not `os.Remove`'s.

## 6. Enumeration and reconcile

**Enumeration is `git ls-files -z --cached --others --exclude-standard`**, run through
`gitclient.Run(ctx, runner, gitPath, gitclient.Spec{Dir: root, Args: …, ReadOnly: true})`. Reasons:
tracked plus untracked-but-not-ignored is exactly the set worth indexing; `.gitignore` semantics are
git's, and a second implementation of them (or a third-party matcher) would drift; and `Spec` already
carries this repo's whole spawn discipline (argv only, no shell, env hygiene,
`--no-optional-locks`, process-group kill on cancellation). `Index` takes `gitPath` and a
`gitclient.Runner` from its caller rather than running discovery itself — `gitclient`'s locator is
macOS-only, and injection is what lets the tests run against the `git` on `PATH` here.

Paths from `ls-files` are repository-relative and are stored **exactly as git reported them**, never
NFC-normalized: `internal/gitpath`'s tier 2 rule, because every one of them is handed back to git
later. Only the absolute root and the `RepoID` are normalized (tier 1).

`Sync(ctx)` is one reconcile pass:

1. Enumerate, filter to the extension map (§3.1).
2. For each enumerated path, `os.Stat`, apply §5.3's staleness rules, and parse the stale ones.
3. Delete `file` rows whose path is no longer enumerated (cascading blocks, symbols, references).
4. Write `meta.last_full_sync_at`.

Writes batch into transactions of 256 files. A file's rows are replaced wholesale inside one
transaction (delete this file's symbols, blocks and references, insert the new ones): partial
symbol-level updates would buy nothing and would need their own invalidation rules.

## 7. Reparse on change

### 7.1 Its own watcher

D3 states why the git watcher cannot be subscribed to. The new one keeps the same shape, which is
the reusable part: an unexported `backend` seam with `Events() <-chan rawEvent` and `Close()`, one
FSEvents implementation (`darwin && cgo`) and one fsnotify implementation (`!darwin || !cgo`), the
classification and debounce above the seam so both are driven by the same tested loop, and
`rawEvent.Rescan` for the "something changed and we do not know what" case (FSEvents' dropped and
`MustScanSubDirs` flags, fsnotify's `ErrEventOverflow`). Two differences from the git watcher, both
required:

- **It carries paths.** Output is a coalesced `map[string]struct{}` of absolute paths per firing,
  not a two-valued signal.
- **It watches the worktree, not `.git`.** The FSEvents backend takes the worktree root as one
  recursive stream and excludes `.git` when classifying. The fsnotify backend has no recursive
  watch, so it adds exactly the directories that contain enumerated files — the `ls-files` output
  already excludes ignored trees, so `node_modules` and `target` never get a watch descriptor — and
  extends reactively when a new directory appears, the same shape `maybeWatchNewRefsDir` uses today.

Debounce is the same 200 ms leading window `gitclient`'s watcher uses, measured from the first event
of a burst, with per-path coalescing inside the window. A `Rescan` event drops the path set and
schedules a full `Sync` instead.

**Classifying an event path.** Convert to a repository-relative path, then:

- Already a `file` row: reparse it (or delete its rows when it no longer exists on disk).
- Not a row, extension supported: hold it in a candidate set and flush the set once per debounce
  window through one `git check-ignore -z --stdin` call; whatever is not ignored is parsed and
  inserted. One git process per window regardless of how many candidates, and correct by using
  git's own ignore evaluation rather than a second one.
- Anything else: dropped.

On macOS an event path arrives from the filesystem in NFD while git usually stored it as NFC, so the
lookup tries the raw relative path and its NFC form before treating the path as new. A wrong guess
is self-correcting: the next `Sync` is authoritative.

### 7.2 Mapping a file-level event onto an incremental edit

This is the question SPEC calls out, and the realistic case — an external tool rewrote the file, so
there is a new byte string and no edit description at all.

**Derive the edit rather than pretending to have one.** With the previous content and the previous
tree resident (§7.3), compute the common byte prefix and the common byte suffix of old and new
content, and build exactly one `InputEdit` for the range between them:
`StartByte` at the end of the common prefix, `OldEndByte`/`NewEndByte` at each content's own start
of the common suffix, with `StartPosition`, `OldEndPosition` and `NewEndPosition` computed by
counting newlines and trailing bytes. That single replacement is a **truthful** description of the
difference even though it is not minimal in an edit-distance sense, which is all tree-sitter
requires: `Tree.Edit` followed by `Parser.ParseCtx(ctx, newContent, oldTree)` then reuses every
subtree outside that range. Two boundary rules keep it honest: the prefix and suffix scans must not
overlap (clamp both at the shorter content's length), and the prefix must not end in the middle of a
UTF-8 sequence (walk back to a boundary), since a Point's column is a byte column and a split
sequence would make the reported column meaningless.

When no previous tree is resident, or the file is an SFC whose block ranges moved (§3.2), the file
is parsed from scratch. Re-splitting an SFC container is itself incremental; only a block whose
`raw_text` range changed loses its own tree.

**Extraction after a reparse is always whole-file**, and the rows are replaced wholesale (§6). The
incremental parse buys parse time, and — the structural reason it is worth doing at all —
`Tree.ChangedRanges(oldTree)` comes back from it, which is exactly the input C2 needs to invalidate
only the affected part of its graph and C3 needs to re-decorate only the affected part of a buffer.
C1 returns those ranges on its reparse result and stores none of them.

No editor-facing edit API lands here: C3 owns keystroke-level edits, and when it arrives it feeds
real `InputEdit`s into the same `Session` path this derivation already feeds.

### 7.3 Resident trees

`codeparse.Session` holds a bounded cache of `(content, *Tree)` per file: at most 64 files and at
most 16 MiB of resident source, whichever binds first, evicting least-recently-parsed. Eviction
`Close`s the tree — which is precisely why `enginecache.ByteLru` is not reused here despite being
the repo's generic byte-budgeted LRU: it evicts silently with no hook, and a C-allocated value needs
deterministic release, so reusing it would mean widening a shared adapter-host type for one caller
in a different module. The local cache is about forty lines and owns the `Close`.

## 8. Concurrency, cancellation, resources

- **One `Index` per repository**, not shared with `gitsession`'s registry — a logical handle scoped
  to one `repo_id`, over the one shared `codeindex.db` connection pool every `Index` in the process
  opens together (§5.1). A `*tree_sitter.Parser` is not safe for concurrent use, so each worker
  owns its own parser per language, created lazily.
- **Worker count is `min(4, runtime.NumCPU())`** — the same bound and the same reason
  `gitclient.maxConcurrentReads` picks 4: cap how much of the machine a background reindex takes,
  not maximise throughput. The app's "silky UI" invariant is the thing being protected.
- **Every parse takes the op's `context.Context`** through `Parser.ParseCtx`, so `Close` and a
  cancelled sync abort mid-parse rather than after it.
- **Writes are single-writer by construction**: one goroutine drains parse results into the store,
  so the cache database sees one writer even though parsing is parallel.
- Errors wrap as `codeindex: …` / `codeparse: …`; logging uses `log/slog` with a `scope` attribute,
  matching `gitclient`'s convention.

## 9. Explicitly out of scope

- **Any resolution.** A reference row carries a name and a range, never a target. Linking names
  across files, and every framework-specific rule for doing so, is C2's row.
- **Angular inline `template:` strings and Vue directive semantics** (§3.2, §3.1).
- **Syntax highlighting.** No `highlights.scm` is vendored; C3 uses Monaco's Monarch grammars.
- **Hand-written queries.** Only upstream `tags.scm` files are vendored. If a language's upstream
  query proves thin, a later phase can add to it with its own reasoning; inventing one here would
  make the first thing this repo maintains a query language it has never shipped.
- **A bound service, a wire contract, or any renderer code.** Nothing in
  `apps/kira-studio/frontend`, no `internal/bridge` change, no bindings regeneration.
- **Any caller.** No app code opens an `Index` in this phase. This is a library phase whose first
  callers are C2 and C7, deliberately, rather than a half-wired UI path.
- **A settings key.** Budgets in §5.4 and §7.3 are constants; `settings` is a closed, hand-listed
  key set and nothing in C1 needs a user-facing knob yet.

## 10. Implementation steps

Each step is a commit that builds, passes `go vet` and carries its own tests where §11 calls for
them. The expensive suites run once at S7 per `CLAUDE.md`.

**S1 — Dependency and grammar registry.** Add the binding and the ten grammar modules to `go.mod`.
Create `internal/codeparse` with `languages.go` and `detect.go`: the language registry, the
extension map, lazily constructed `*Language` per grammar, and an ABI check at construction.
One smoke test parses a one-line fixture per grammar and asserts a non-nil root node with no error.
Measure and record the binary-size delta (§1.3) in this commit message.

**S2 — Extraction.** Vendor the six `tags.scm` files with their provenance table, embed and compile
them, and write `extract.go`: query execution, the capture mapping (§4.2), containment-based parent
resolution, dedupe. Golden tests per language (§11). `NOTICES.md` entry.

**S3 — Injection.** `inject.go`: block discovery on the html and svelte containers, `lang`
resolution, `SetIncludedRanges` parsing, `Block` output. Tests for `.vue`, `.svelte` and a plain
`.html` with an inline `<script>`, including the unsupported-`lang` case.

**S4 — Session, resident trees, edit derivation.** `session.go` and `edit.go`: parser pool, the
bounded tree cache with `Close` on eviction, `Parse` and `Reparse`, `ChangedRanges` on the result.
Tests for the edit derivation's boundary arithmetic (§11).

**S5 — The cache store.** `internal/codeindex`: `db.go`, `migrate.go`, `migrations/0001_c1_init.sql`
plus `embed.go`, and `store.go` (replace one file's rows in one transaction; read by path, by
symbol name, by file). Lazy open, chmod, schema-too-new refusal, `meta` handling and the
fingerprint check.

**S6 — Enumeration and reconcile.** `enumerate.go`, `sync.go`, `index.go`: `Open`, full `Sync`,
staleness rules, deletions, the 2 MiB and binary skips, worker pool, batched transactions. Tests
build a real temp repository and run a real `git` (skipping without one, as every `internal/git*`
suite does).

**S7 — Watcher, incremental path, reaper, docs.** `watch.go` plus both backends, the debounce and
candidate-flush rules, reparse on event, `Rescan` to full sync, `reaper.go`'s idle sweep called from
`Open`. Doc updates (§12). Full verification pass (§13).

## 11. Testing

Against `CLAUDE.md`'s bar, file by file. What earns a test:

1. **`codeparse/edit.go`** — prefix/suffix boundary arithmetic, points derived by newline counting,
   the overlap clamp, the UTF-8 boundary walk, an empty file, an append-only change, a
   truncate-to-empty change, an unchanged file (no edit at all). Several interacting rules over
   boundary arithmetic: the bar's own description.
2. **`codeindex/sync.go`'s staleness and deletion rules** — a file unchanged, changed in size only,
   changed in content at identical size and mtime, deleted, renamed (delete plus create), a
   fingerprint mismatch truncating everything. Cache invalidation with interacting rules: named in
   the bar explicitly.
3. **`codeparse/extract.go`** — one small committed fixture per language with the expected symbol
   and reference set asserted as a table. This is the anti-drift guard for a vendored query against
   a pinned grammar: a grammar upgrade that renames a node is otherwise a silent loss of symbols.
   Same role `gitclient/porcelain`'s golden corpus plays for git output.
4. **`codeparse/inject.go`** — block discovery and `lang` resolution across `.vue`, `.svelte`,
   `.html`, plus the unsupported-`lang` block, plus the file-coordinate property (a symbol inside a
   `<script>` block reports the file's own byte offsets, not the block's).
5. **`codeindex/watch.go`'s shared loop** — driven by a fake backend exactly as
   `gitclient/watcher_test.go` drives its own: coalescing inside one window, the leading-window
   firing, `Rescan` superseding the path set, `Close` during a pending timer. The FSEvents backend
   itself stays unexercised here, same as its git counterpart.

What gets nothing: the store's insert and read paths (CRUD, covered incidentally by 2), the
migration (one step against an empty schema — the repo tests a migration only when it reshapes
seeded data), the extension map (a lookup table), the reaper (one `os.Stat` age comparison), and
the grammar registry beyond S1's smoke parse.

No Playwright work of any kind: this phase has no renderer surface.

## 12. Documentation to update

- **`docs/ARCHITECTURE.md` Stack table**: one row for the tree-sitter binding and grammar set — cgo,
  the ABI range, why the pure-Go candidates were declined, the measured binary delta.
- **`docs/ARCHITECTURE.md` Storage**: the shared, `repo_id`-scoped cache file beside the `review.db`
  paragraph it parallels, plus one row in the growth-bounds table (§5.4).
- **`docs/ARCHITECTURE.md` git-module watcher paragraph**: it currently claims the repo watcher
  covers "plus the worktree". It does not (D3); correct that sentence rather than leaving two
  readings of the same watcher in one document.
- **`docs/DEV_ENVIRONMENT.md`**: `go build`/`go test` of `./apps/kira-studio/internal/...` now needs
  a C compiler, and the first build compiles roughly 34 MB of generated C.

## 13. Verification

Fast checks per commit: `go build ./apps/kira-studio/internal/...`, `go vet` on the two new
packages, `bun run lint`. `go test ./apps/kira-studio/internal/codeparse/... ./apps/kira-studio/
internal/codeindex/...` for the new coverage, plus `go test ./apps/kira-studio/internal/` for the
layering test once both packages exist. `go test -race` on the two new packages once at S7 — the
worker pool, the tree cache and the watcher are the parts worth racing. `bun run test:go` once at
S7 as the backstop. Finally, one real end-to-end run at S7 against a real repository (this one):
`Open`, full `Sync`, row counts per language, then touch a file and confirm the watcher reparses
exactly that file — recorded in the commit message, not asserted as a threshold, the same posture
`internal/gitsock`'s perf probes take.
