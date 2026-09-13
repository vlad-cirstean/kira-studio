# C3 — MCP repository-map server

> **What this phase is.** `docs/v1.5/SPEC.md`'s C3 row turned into steps, from research against the
> real C1/C2 tree (`internal/codeindex`, `internal/codegraph`, their schema and public API) plus
> direct probes of every candidate dependency (Go module proxy version lists and `go.mod` files,
> each SDK's own `LICENSE`), the real `claude` CLI in this container (2.1.270), VS Code's own MCP
> documentation, and `bun run`'s actual cwd/echo behaviour. This phase adds no parsing, no indexing
> logic and no resolution logic: it is a protocol server in front of C2's `Graph`, plus the settings
> surface that registers it. Its consumers are AI clients — starting with this repo's own sessions
> (C4 documents it, C5 dogfoods it, C6 A/B-tests it).

## 0. What SPEC left open, and how each is resolved

**D1 — The server is a Go binary, `apps/kira-studio/cmd/kira-repo-map`. `bun run` is its
user-facing launch command, never its language.** The graph is Go; moving real logic into Bun would
mean a second SQLite reader, a second copy of C2's resolver (tiers, per-language rules, kind
matrix, ranking — `codegraph/resolve.go` alone), and two implementations drifting against one
schema. `docs/ARCHITECTURE.md`'s own Stack row ("Bun: tooling only — nothing at runtime depends on
it") already names the posture. So: one Go binary, two launch paths — `bun run mcp:repo-map` in
this repo (a `package.json` script that builds then execs it), and the same binary shipped inside
`Kira Studio.app` for an installed user. §3.

**D2 — `github.com/modelcontextprotocol/go-sdk`, the official SDK, v1.7.0.** Apache-2.0 (MIT for
un-relicensed contributions), stable v1, stdio transport built in, typed tool registration that
generates the input schema from a Go struct. `mark3labs/mcp-go` is real and MIT but is now the
second implementation, not the reference one. Hand-rolling JSON-RPC framing is declined outright —
`CLAUDE.md`'s library-first rule with no requirement to point at. §1.

**D3 — Six tools, one per `codegraph` operation SPEC's row names, plus `outline_file`.**
`find_definition`, `find_references`, `find_implementations`, `search_symbols`, `search_files`,
`outline_file`. Nothing is invented that the graph cannot answer: no call hierarchy, no rename, no
code actions (C2 §9 declined all three), no file-content tool. `SymbolAt` gets no tool of its own —
it answers a question `outline_file` already answers for an agent that has the file. §6.

**D4 — The server resolves its own repository and indexes it itself.** `gitclient.Identify` on the
process's cwd (or `--repo`) gives the same `RepoID` C1/C2 key on; `codeindex.Open` + `Sync` +
`Watch` build and maintain the cache. Standalone usability is the point: C6's A/B arms run in fresh
worktrees the desktop app has never opened, and "headless, for development inside this repo" means
nothing if it first needs a GUI to have run. `Store.ListRepos` stays the fallback for a machine with
no `git` on `PATH`, where serving an already-indexed repository read-only is still possible. §4.

**D5 — Isolation is structural, not asserted.** stdio only: no port, no socket, no listener of any
kind. The server never opens `kira.db` and never touches `git.sock`/`git.sock.lock`. It opens
`codeindex.db` — WAL, multi-process by design, read-write so the `-shm` file can be created (C1
§5.1's own forward note to this phase) — and takes one `flock`ed lock file per repository around
its *initial* sync so two concurrent server processes never parse one repository twice. §5.

**D6 — Both install flows shell out to the client's own CLI, argv-only, never write another
program's config file.** Claude Code: `claude mcp add …`, verified against the real CLI. VS Code:
`code --add-mcp '<json>'`, registering with **VS Code's own MCP client surface** (Copilot agent
mode), not with `apps/kira-studio-vscode`. §7.2, §7.3 — §7.3 argues that reading of SPEC's row.

**D7 — "Disabled by default" gates the app-integrated path, not the process.** One settings leaf,
`codeIntel.mcpServerEnabled`, default false. While off, the pane shows the toggle and nothing else —
no command, no Install button. The binary and the `bun run` script work regardless of it: the
setting lives in `kira.db`, the server is a separate process an MCP client launches, and an agent's
tools silently breaking because someone toggled a checkbox in another app is worse than useless.
§7.1.

**In scope**: the SDK (§1), the layout (§2), the process shape and both launch paths (§3), repository
resolution and indexing (§4), isolation (§5), the tool surface (§6), settings plus both install
flows (§7), concurrency and logging (§8), tests (§11), docs (§12).

**Not attempted** (§9): any new graph capability, file content over MCP, MCP resources or prompts,
HTTP/SSE transport, non-macOS packaging, a multi-repository server.

## 1. The SDK

### 1.1 What was found

| Candidate | License | State at plan time | Transports | Verdict |
|---|---|---|---|---|
| `github.com/modelcontextprotocol/go-sdk` | Apache-2.0 (MIT for un-relicensed contributions) | v1.7.0, 2026-07-27, the protocol org's own SDK | stdio, HTTP/SSE, streamable HTTP, in-memory | **taken** |
| `github.com/mark3labs/mcp-go` | MIT | v1.0.0, 2026-09-02, community, widely used | stdio, SSE, streamable HTTP, in-process | declined |
| hand-rolled JSON-RPC over stdio | — | would be written here | stdio | declined |

**Taken: the official SDK.** It is the reference implementation of a protocol this repo does not
own, at a stable v1, from the org that publishes the spec — the axis that matters for a wire format
that keeps moving. Its dependency set is small and already-familiar shaped
(`google/jsonschema-go`, `segmentio/encoding`, `yosida95/uritemplate`, `golang.org/x/{oauth2,time,
tools,sync,sys}`, `golang-jwt/jwt`); only `jsonschema-go`, `uritemplate` and `segmentio/encoding`
are genuinely new to `go.sum`'s top level. `mcp.AddTool[In, Out]` derives the input schema from a Go
struct's `json`/`jsonschema` tags and validates arguments before the handler runs, so every tool's
schema has exactly one source. Minimum Go is 1.25; this repo is on 1.27.

**Declined: `mark3labs/mcp-go`.** MIT, active, v1.0.0, genuinely usable — and this is not a quality
judgement. With two comparable options the tie-break is which one tracks the spec by construction.
It also carries `stretchr/testify` and `santhosh-tekuri/jsonschema` into the graph; this repo uses
neither anywhere today.

**Declined: hand-rolling.** `CLAUDE.md` allows a hand-rolled version only against a requirement no
library meets. There is none: stdio framing, initialize/capabilities, tool listing, cancellation and
schema validation are exactly what both SDKs already do.

No `NOTICES.md` entry: Apache-2.0/MIT attribution is what `go.mod` already carries, which that
file's own preamble states is sufficient.

### 1.2 API surface actually used

`mcp.NewServer(*Implementation, *ServerOptions)`, `mcp.AddTool[In, any](server, *Tool, handler)`,
`server.Run(ctx, &mcp.StdioTransport{})`, `*mcp.CallToolResult` with `*mcp.TextContent`, and
`mcp.NewInMemoryTransports()` plus `mcp.NewClient` for §11's conformance test. `Out = any` is
deliberate: the SDK generates **no** output schema for `any`, so a tool returns text only (§6.3
argues why). `ServerOptions.Instructions` carries §6.0's one paragraph. Exact field names are
pinned at S1 against the tagged version and the handler signatures compile or they do not — no
guess survives the first build.

## 2. Where the code lives

```
apps/kira-studio/cmd/kira-repo-map/
  main.go          flags, logging to stderr, repo resolution, serve; the only main package

apps/kira-studio/internal/repomap/         the server: pure Go, no cgo of its own
  server.go        mcp.Server construction, tool registration, instructions
  repo.go          cwd/--repo to RepoID+root; ListRepos fallback; degraded mode
  index.go         background Sync, the readiness gate, Watch, the per-repo sync flock
  lock_unix.go     //go:build unix — flock
  lock_other.go    //go:build !unix — no-op, documented
  locator.go       tool arguments to codegraph.Query (§6.1)
  tools.go         the six tools: argument structs, handlers
  render.go        Target/Site/Node to compact text (§6.3)

apps/kira-studio/internal/mcpinstall/       desktop side only; never linked into the server
  install.go       Status/command strings/Install for both clients, Deps-shaped like gitvsix
  exec.go          argv-only spawn, bounded stderr (gitvsix/exec.go's shape)

scripts/mcp-repo-map.ts                     the bun wrapper (§3.1)
apps/kira-studio/internal/bridge/repomap.go RepoMapService
apps/kira-studio/frontend/src/state/repomap.ts + SettingsDialog.vue section
```

Layering: `repomap` and `mcpinstall` import nothing from `internal/bridge`
(`internal/layering_test.go` covers this automatically). `mcpinstall` imports `internal/gitvsix` for
one thing only — the `code` probe order, exported for it (§7.3) — rather than keeping a second copy
of that list.

## 3. Process shape

### 3.1 Dev: `bun run`, this repo's own script

Two scripts in the root `package.json`:

```json
"mcp:repo-map": "bun run scripts/mcp-repo-map.ts",
"mcp:repo-map:build": "go build -o apps/kira-studio/bin/kira-repo-map ./apps/kira-studio/cmd/kira-repo-map"
```

`scripts/mcp-repo-map.ts` does three things and nothing else:

1. `go build -o apps/kira-studio/bin/kira-repo-map ./apps/kira-studio/cmd/kira-repo-map`, with the
   build's own stdout **and** stderr both routed to this process's stderr. Always, not conditionally:
   a staleness heuristic over Go sources is a second build system, and Go's own build cache makes a
   no-op build sub-second.
2. `Bun.spawn` the binary with `stdio: ["inherit", "inherit", "inherit"]`, forwarding argv after
   `--`, `SIGINT` and `SIGTERM`.
3. Exit with the child's own exit code.

Three properties this depends on, each verified rather than assumed:

- **`bun run` prints nothing to stdout.** The `$ <command>` echo goes to a TTY only, and the
  registered command uses `--silent` regardless. One stray byte on stdout corrupts the JSON-RPC
  stream, so this is load-bearing, not hygiene.
- **`bun run` executes a script with cwd set to the `package.json` directory**, checked by running
  `bun run lint` from `apps/kira-studio/` and watching a root-relative path in the script resolve.
  So under this launch path the server's cwd is always that worktree's root — which is exactly the
  repository the caller means, including for a linked worktree. An agent whose own cwd is a
  subdirectory still lands on the right repository.
- **First build is expensive.** `codeparse` is cgo over ~34 MB of generated C (C1 §1.3), so a cold
  cache is minutes and an MCP client's startup timeout (Claude Code: `MCP_TIMEOUT`, 30 s default)
  will kill it. This is why `mcp:repo-map:build` exists as a separate script: run it once after a
  fresh clone, before registering. `docs/DEV_ENVIRONMENT.md` says so (§12).

Nothing else moves into TypeScript. The wrapper holds no logic worth testing and no protocol
knowledge at all.

### 3.2 Packaged: a helper binary inside the bundle

`Contents/MacOS/kira-repo-map`, beside the app binary — not `Contents/Resources/`, which is where
the `.vsix` correctly lives *because it is data*. Apple's layout puts helper executables in `MacOS/`,
and `scripts/sign-bundle.sh`'s `codesign --deep` already signs every nested executable there.

Packaging mirrors `common:build:vsix` exactly: a `common:build:repomap` task with the same `sources:`
fingerprinting, a `deps:` entry on `package`/`package:universal`, a copy step in `create:app:bundle`
(and the `.dev.app` variant's own conditional copy), a `lipo` of the two arch builds on the universal
path — the same cgo cross-build constraints the app binary already lives with, since C1 made the app
cgo. `scripts/verify-packaging.sh` gains one assertion that the helper exists and is executable.

Measured at S5 and recorded in that commit message, the way C1 recorded its own: the helper's size,
and the bundle delta. Expected to be modest — C1 measured the whole grammar registry at +6.6 MB — but
it is a real number for a bundle that will carry the parse tables twice once C5 links `codeindex`
into the app. If that number turns out large, collapsing the helper into an argv subcommand of the
app binary is a later phase's call; it is not free today (the app binary embeds `frontend/dist`, so
building it for a headless dev launch would require a frontend build first).

### 3.3 Why the logic is not in Bun

Stated once, plainly, since D1 is this plan's most consequential decision. Moving it would require:
re-reading `codeindex.db`'s schema from `bun:sqlite`; re-implementing `codegraph`'s resolver
(`resolve.go`'s tiers, per-language scope units, kind-compatibility matrix, six-key ranking) or
FFI-wrapping it; and keeping both in step with every future `codeparse` extraction change through
`meta.parser_fingerprint`. The user's requirement is that the server *launches* with `bun run`. §3.1
satisfies that literally, at the cost of one wrapper script.

## 4. Repository resolution and indexing

### 4.1 Identity

```go
summary, err := gitclient.Identify(ctx, gitclient.NewExecRunner(), gitPath, dir)
// summary.RepoID == worktree root, absolute, gitpath.CleanNFC'd (non-bare)
// summary.Root   == the same
```

`dir` is `--repo` when given, else the process's cwd. `gitPath` is `exec.LookPath("git")`;
`gitclient`'s own locator is macOS-only, so `PATH` is the seam here exactly as it is in every
`internal/git*` test.

Two consequences worth naming. A **linked worktree has its own `RepoID`** (`RepoID` is the worktree
root, not the common dir), so C6's two A/B worktrees index independently in one shared
`codeindex.db` with no collision — the experiment's isolation falls out of C1's existing key choice
and needs nothing new. And a **bare repository has no worktree**, so the server refuses it at
startup with a plain message rather than serving an empty index.

Then: `store := codeindex.OpenStoreAt(config.KiraHome())`, `idx := codeindex.Open(store, runner,
gitPath, repoID, root)`, `graph := codegraph.New(store, repoID)`.

### 4.2 Self-indexing and the readiness gate

`Server.Run` starts **immediately**; `initialize` must answer in milliseconds or the client gives up.
`Sync` runs on a background goroutine started before `Run`.

Every tool handler waits on a `ready` channel, bounded at 25 s per call. On timeout it returns
`CallToolResult{IsError: true}` with one line: still building, for which root, for how long, retry.
Never an empty result — an agent that reads "no references found" while the index is half-built draws
exactly the wrong conclusion, and that failure mode is the one thing C5's dogfooding must not be
poisoned by. No progress counters: `Sync` reports `SyncStats` only at the end, and inventing a
progress channel inside `codeindex` for one message is not worth a schema of its own.

Subsequent syncs are the watcher's (§4.3); the gate closes once and stays closed.

### 4.3 Watcher

`idx.Watch()` runs for the process's life. An agent that edits a file and then asks for its
references must get the edited state — the dogfooding loop is exactly that, and C1 built the watcher
for exactly this. Stopped on `Close`.

Two server processes watching one repository both reparse the same file on the same save. Duplicate
work, identical rows, each written wholesale in one transaction (C1 §6): harmless, and cheaper to
accept than to coordinate.

### 4.4 Degraded mode: no `git` on `PATH`

Enumeration is `git ls-files` (C1 §6), so without git there is no indexing at all. Rather than
failing, the server falls back to `Store.ListRepos(ctx)` — the method C2 added for precisely this
"second process cannot reach `gitclient`'s identity function" case — and matches its own directory
against each recorded `meta.repo_root` by longest path prefix. A hit serves read-only from whatever
the desktop app already indexed, and every tool result carries no special marking: the rows are the
rows. A miss exits with a message naming both causes (no git, no indexed repository for this path).

## 5. Isolation from this repo's own dev loop

Concrete, mechanism by mechanism:

- **No port, no socket, no listener.** stdio transport only. `wails3 task dev`'s Vite port, the
  Wails dev server and `${KIRA_HOME}/git.sock` are untouched because nothing here binds anything.
- **`git.sock.lock` is never taken.** That flock elects the one instance that serves the git socket
  (`docs/ARCHITECTURE.md`); this server serves no socket and must never contend for it.
- **`kira.db` is never opened.** The server reads no settings (D7), so the app's own
  `SetMaxOpenConns(1)` database is outside its process entirely.
- **`codeindex.db` is opened read-write, shared, via `codeindex.OpenStoreAt`.** Two OS processes on
  one WAL database is SQLite's own design, not a stretch of it: readers and one writer proceed
  concurrently through the `-shm` index, cross-process locking is POSIX advisory locks on the
  database file, and `modernc.org/sqlite` is a transpilation of the same upstream C (`os_unix.c`
  included), so the locking is the real implementation rather than a Go re-model. Read-write, never
  `mode=ro`, because a read-only connection to a WAL database still needs to create `-shm` — C1
  §5.1 handed exactly this note forward to this phase. `_busy_timeout=5000` is already in the DSN.
- **One `flock` per repository around the initial sync**:
  `${KIRA_HOME}/codeindex-sync-<first 12 hex of sha256(repo_id)>.lock`, `LOCK_EX`, 5-minute
  deadline, released the moment the first `Sync` returns. Without it, two sessions opened in one
  checkout each run a full parse of the same repository — minutes of duplicated CPU, not a
  correctness bug but the obvious waste. With it, the second process waits, then its own `Sync` is a
  stat-only pass over fresh rows. On deadline it proceeds anyway and serves what exists: a stuck
  lock must degrade, never hang. `syscall.Flock` on `unix`, a documented no-op elsewhere — stdlib,
  no dependency, the same build-tag shape `codeindex/watch_*.go` already uses.
- **Contention today is zero**, stated honestly: nothing in the desktop app opens `codeindex.db` yet
  (C1 and C2 are both library phases with no caller), so until C5 this server is the only process
  touching the file. The mechanisms above are what make it stay correct when C5 lands, not what
  makes it work now.
- **`KIRA_HOME` remains the escape hatch.** Pointing the server at a different home gives it a
  private cache, which is worth knowing for a debugging session but is not the default — sharing the
  cache with the desktop app is the whole point of "no second parse pipeline".

## 6. Tool surface

Server identity: name `kira-repo-map`, title `Kira Studio repository map`, version mirroring the
app's own declared `0.0.0` (`build/config.yml`) — no ldflags plumbing invented for it.

`ServerOptions.Instructions`, one paragraph, is the steer that decides whether any of this pays off:
these tools answer navigation questions from a pre-built index without reading files; prefer them to
opening a file to find a definition; positions are 1-based lines; results are name-resolved, not
type-resolved, and each carries its own confidence.

### 6.1 Locating: one shared rule set

Every navigation tool takes the same three optional fields — `file`, `line`, `symbol` — resolved by
one function (`locator.go`), because `codegraph.Query` is file-scoped: `DefinitionOf`,
`ReferencesTo`, `ImplementationsOf` and `SymbolAt` all start at `loadFile(q.Path)`.

1. `file` given, absolute: made repository-relative against `root`. Never NFC-normalized —
   `internal/gitpath`'s tier 2 rule, since the stored path is git's own bytes.
2. `file` + `line` (+ optional `column`): `Query{Path, Byte: -1, Point: &Point{Row: line-1,
   Column: column-1}}`. Column defaults to 1 and is a **byte** column (C2's convention), stated in
   the tool description rather than converted — this server never reads file bytes, so it cannot
   convert one.
3. `file` + `symbol`, no line: `Query{Path, Byte: -1, Name: symbol}` — C2 §7's own name-hint path,
   which is also what makes a Vue/Svelte template position answerable.
4. `symbol` only, no `file`: run `SearchSymbols{Text: symbol}` first. Exactly one hit whose name
   matches exactly: proceed from that hit's path and name-span start. Several: return those
   candidates as the result, with one line telling the caller to re-call with `file`. None: empty
   result. No silent pick of the top hit — a guess dressed as an answer is the failure mode this
   whole server exists to avoid.
5. Neither `file` nor `symbol`: `IsError`, naming both.

Rule 4 is the one real decision structure here, and §11 tests it.

### 6.2 The six tools

| Tool | Calls | Input | Notes |
|---|---|---|---|
| `find_definition` | `Graph.DefinitionOf` | `file?`, `line?`, `column?`, `symbol?` | Capped at 16 by the resolver itself |
| `find_references` | `Graph.ReferencesTo` | locator + `mode` (`resolved` default, `name_only`), `kinds?`, `include_definition?`, `limit?` (default 100, max 500) | `mode` maps to `RefMode`; `kinds` to `RefOpts.Kinds` |
| `find_implementations` | `Graph.ImplementationsOf` | locator | Empty for a Go target by design; §6.3 renders that as the language fact it is |
| `search_symbols` | `Graph.SearchSymbols` | `query`, `substring?`, `kinds?`, `languages?`, `limit?` (default 30, max 200) | |
| `search_files` | `Graph.SearchFiles` | `query`, `limit?` (default 30, max 200) | Substring over indexed paths — not a fuzzy finder, and not ripgrep (C6) |
| `outline_file` | `Graph.Outline` | `file` | The token-reduction primitive C2 §4.3 names: a file's definition tree without its bytes |

Defaults are deliberately tighter than `codegraph`'s own (500/2000 references, 50/200 search): the
graph's limits protect memory, these protect the context window, which is the point of the phase.
Every clamp still runs through `codegraph`'s own clamping too.

### 6.3 Output: text only, one line per result

No output schema (`Out = any`, which the SDK honours by emitting none), and therefore no
`structuredContent`. A tool that returns both ships the same payload twice to a reader that only ever
needed one — for a server whose entire justification is token reduction, that is self-defeating.

Shapes, grep-like so an agent already knows how to read them:

```
3 definitions for "Sync" (resolved from internal/codeindex/sync.go:47)
internal/codeindex/sync.go:47:19  method Index.Sync  exact  sameFile.enclosing
...
```

```
128 references to "ReplaceFile" (showing 100)
internal/codeindex/sync.go:118:4   call   in Sync
...
```

Rules: positions rendered 1-based; `Rule` and `Confidence` printed on every `Target`, since C2's
resolution is name-based and hiding its own honesty markers would make `repoWide` guesses read like
facts; `Truncated` always reported with the real total; an empty result is one explicit sentence, not
a blank; `find_implementations` on a Go target renders "Go interfaces are structural; implementations
are not derivable from the index" from the target's own language, exactly as C2 §6 said callers
should. `outline_file` renders the tree indented, capped at 500 nodes with a truncation line.

`IsError: true` for caller-correctable conditions (unknown file, no locator, index still building).
A Go error — a protocol-level failure — only for a genuine internal fault.

### 6.4 What deliberately gets no tool

- **File contents.** The agent already has a file reader; serving bytes here would add tokens, not
  remove them.
- **`SymbolAt`.** Answerable, but it tells an agent what it is looking at — which it knows, because
  it supplied the position. `outline_file` covers the honest version of the question.
- **Call hierarchy, type hierarchy, rename, code actions.** C2 §9 declined them at the graph; giving
  the MCP server a tool for something the graph cannot answer is exactly the trap SPEC's row warns
  about.
- **Indexing controls** (reindex, drop cache). The watcher and `Sync` already own that lifecycle; a
  tool would be a second way to do it with no second reason.
- **MCP resources and prompts.** Tools are what this phase's clients call. Neither earns its keep on
  speculation.

## 7. Settings and the two install flows

### 7.1 The setting

One leaf, `codeIntel.mcpServerEnabled`, boolean, default false:

- `packages/shared/domain/settings.ts`: `codeIntelSettingsSchema` with `.default(false)`, added to
  `settingsSchema`/`settingsPatchSchema`/`defaultSettings` — a new section, since C5-C7 will add
  their own leaves beside it.
- `internal/storage/model/settings.go`: `CodeIntelSettings`/`CodeIntelPatch`, mirrored verbatim.
- `internal/storage/repos/settings.go`: one `leaf(stored, "codeIntel.mcpServerEnabled", …)` in
  `GetAll` and one `upsertSettingsLeaf` branch in `Set` — the hand-listed key set stays hand-listed.

**What "disabled" means, precisely.** Off: the pane shows the toggle, one sentence of explanation,
and nothing else — no command text, no Install button. On: the two commands appear as copyable text,
each with its Install button *below* it. The server process itself never reads this setting: it is
launched by an MCP client, not by the app, and a tool surface that vanishes because a checkbox moved
in a GUI is a worse failure than an unused registration. SPEC's "enabling is never a silent action"
is honoured by the pane's ordering, which §11 tests.

**The toggle applies immediately**, bypassing the dialog's draft/Save flow — the same posture
`onRevokeGitClient` and `onInstallVsCodeIntegration` already take, for the same reason G12 D9 gives:
a tab must not mix Save-gated settings with instant actions. Since the toggle's entire purpose is to
reveal two instant actions, it belongs on the action side of that line, and the new
**Code intelligence** section stays action-only.

### 7.2 Claude Code CLI

**Command shown (packaged app):**

```
claude mcp add --scope user kira-repo-map -- "/Applications/Kira Studio.app/Contents/MacOS/kira-repo-map"
```

Verified against the real CLI (2.1.270): `claude mcp add [-s local|user|project] <name> <command>
[args...]`, stdio by default, `--` separating the server's own argv.

**`--scope user`, not `local` or `project`**, and this follows from where the button lives. `local`
scope is keyed to the directory the command runs in; the desktop app has no current repository to
supply one (native git mode is C8). `project` writes a committed `.mcp.json` into someone's
repository, which an app-driven button has no business doing. `user` registers once, and the server
resolves its repository per launch from the client's own cwd (§4.1) — so one registration serves
every checkout on the machine.

**Install button**: re-resolves everything, then spawns
`[claudePath, "mcp", "add", "--scope", "user", "kira-repo-map", "--", binPath]` — argv only, never a
shell, 30 s timeout, bounded stderr in the outcome. Never writes `~/.claude.json` directly: that file
is the CLI's own live private format, and the CLI is right there.

**Finding `claude`** has the same launchd-PATH problem `gitvsix` documented for `code` (a
Finder-launched app gets `/usr/bin:/bin:/usr/sbin:/sbin`). Same probe shape: `LookPath` first, then
`~/.claude/local/claude`, `~/.local/bin/claude`, `/usr/local/bin/claude`,
`/opt/homebrew/bin/claude`; every path considered recorded, so a miss is explainable. Not found is
**not** a failure state here — the command is already on screen to copy, which is strictly better
than `gitvsix`'s Finder-reveal fallback and needs no fallback of its own.

**Dev builds** (`wails3 task dev`, no bundle beside the executable) have no helper binary to name.
The pane says so — `gitvsix`'s `notBundled` precedent, honestly — and points at the repo's own path
instead, with no button:

```
claude mcp add kira-repo-map -- bun run --silent mcp:repo-map
```

That form is also what C4 documents and what C6's A/B arms use: run inside a worktree, it lands in
that directory's `local` scope, so Arm A is registered and Arm B is not, on one machine, with no
shared state between them. `--silent` is not optional (§3.1).

### 7.3 VS Code

**The interpretation, stated rather than papered over.** SPEC's row says "registering it as a VS Code
extension's MCP server", which admits two readings. VS Code has had a first-class MCP client since
1.102 (Copilot agent mode): workspace `.vscode/mcp.json`, a user-profile `mcp.json`, and a
`code --add-mcp '<json>'` CLI flag. The other reading — `apps/kira-studio-vscode` registering the
server through `vscode.lm.registerMcpServerDefinitionProvider` — is rejected: it has **no
command-shown-first form at all** (the registration would be code inside an extension, not a command
a user runs), it makes an MCP feature depend on installing a git extension it has nothing to do with,
and it puts a second copy of the registration logic in TypeScript. So: register with VS Code's own
MCP surface.

**Command shown:**

```
code --add-mcp '{"name":"kira-repo-map","type":"stdio","command":"/Applications/Kira Studio.app/Contents/MacOS/kira-repo-map"}'
```

**Install button**: spawns `[codePath, "--add-mcp", jsonString]` — the JSON is one argv element, so
there is no quoting hazard in the spawn; the single quotes exist only in the displayed, copy-pasteable
rendering. `codePath` comes from `gitvsix`'s existing probe order, exported for this caller as
`gitvsix.CodeCandidates()` rather than copied. Same 30 s timeout, same bounded-stderr outcome, same
"not found means show the command" posture as §7.2.

`code --add-mcp` is documented by VS Code but was not executable in this planning container (no
`code` here). Verify it on a real machine at S4 before the copy is finalised; if the flag's shape
differs, the fallback is the documented file (`~/Library/Application Support/Code/User/mcp.json`),
shown as a path plus the JSON block to paste — still command-first, still no config file written
behind another program's back.

### 7.4 Wiring

`bridge.RepoMapService` (`internal/bridge/repomap.go`), shaped like `GitClientsService`: a
`RepoMapInstaller` interface declared where it is consumed, `Status()` returning the resolved binary
path, both rendered command strings and both client-availability probes, plus
`InstallClaudeCode(ctx)` / `InstallVsCode(ctx)` returning named outcome values and never a Go error —
`connections.Service.Reveal`'s precedent, already applied twice. Registered in `main.go` beside
`GitClientsService`. Bindings regenerated with `wails3 task common:generate:bindings`, never a
hand-typed flag list.

Renderer: `frontend/src/state/repomap.ts` (status + install actions, the shape `gitClients.ts`
already has) and one new `Code intelligence` section in `SettingsDialog.vue`, laid out strictly as
toggle, then command, then button, per command.

## 8. Concurrency, cancellation, logging

- One `Graph`, no mutable state, safe for concurrent tool calls (C2 §8); the SDK may run handlers
  concurrently and nothing here assumes otherwise.
- Every handler takes the SDK's `ctx` straight through to `codegraph` and `database/sql`, so a
  client-cancelled call stops mid-query.
- **Nothing writes to stdout except the SDK.** `log/slog` to stderr with a `scope` attribute
  (`gitclient`'s convention), no `fmt.Print*` anywhere in `cmd/kira-repo-map` or `internal/repomap`.
  Level from `KIRA_REPO_MAP_LOG` (`error` default) — a stdio server's stderr is the client's log
  file, so quiet by default.
- `SIGINT`/`SIGTERM` cancel the root context: watcher closed, `Index.Close()`, `Store.Close()`, lock
  released. The bun wrapper forwards both.
- Flags: `--repo <path>` and `--version`. Nothing else — every bound in §4.2 and §6.2 is a constant,
  and a knob nobody has asked for is scope that stayed out.

## 9. Explicitly out of scope

- **Any new graph capability.** This phase adds no operation `codegraph` does not already expose, and
  changes neither `codeparse` nor `codeindex`'s schema.
- **File contents, MCP resources, MCP prompts, sampling, roots.**
- **HTTP/SSE transport.** stdio is what a CLI-launched, per-invocation, local server needs; a network
  listener would also undo §5's first isolation claim.
- **A multi-repository server.** One process, one repository, resolved at launch. An agent works in a
  checkout; a server that could answer about any indexed repository would need a repository argument
  on every tool and would happily answer about code the caller never opened.
- **Non-macOS packaging.** The app is macOS-packaged; the Linux/dev path is `bun run`.
- **Auto-registration.** Nothing registers itself on launch, ever. That is what "command visible
  first, button second" means.
- **Reading the enable setting from the server** (D7).

## 10. Implementation steps

Each step builds, passes `go vet` and `bun run lint`, and carries its own tests where §11 calls for
them. Expensive verification runs once at S6, per `CLAUDE.md`.

**S1 — SDK plus a server that serves one tool.** Add `github.com/modelcontextprotocol/go-sdk` to
`go.mod`. `cmd/kira-repo-map/main.go` (flags, slog to stderr, signals) and `internal/repomap`'s
`server.go`/`repo.go`/`index.go`: repository resolution, background `Sync`, the readiness gate, the
sync flock, `Watch`, and `outline_file` as the single registered tool. Working increment: a real MCP
server an editor can register and call.

**S2 — The remaining five tools.** `locator.go`, `tools.go`, `render.go`: §6.1's rules, the five
tools, §6.3's rendering, the tightened limits, the Go-implementations message, `IsError` semantics.
Tests per §11.1 and §11.2.

**S3 — The bun launch path.** `scripts/mcp-repo-map.ts` plus the two `package.json` scripts. Verify
by hand that a registered `bun run --silent mcp:repo-map` connects from a real client and that
stdout carries protocol bytes only.

**S4 — `internal/mcpinstall` plus the bridge service.** Command rendering for both clients, both
probes (`claude` candidates here, `gitvsix.CodeCandidates()` exported for `code`), both installs,
named outcomes; `bridge/repomap.go`, `main.go` registration, regenerated bindings. Verify §7.3's
`code --add-mcp` on a real machine at this step.

**S5 — Settings leaf, the settings section, packaging.** The leaf through all four layers
(`settings.ts`, `model`, `repos`, the dialog), `state/repomap.ts`, the `Code intelligence` section in
toggle/command/button order, the Playwright spec (§11.4). Then `common:build:repomap`, the
`create:app:bundle` copies, the universal `lipo`, the `verify-packaging.sh` assertion; record the
measured helper size and bundle delta in this commit message.

**S6 — Docs and verification.** §12's updates, then §13's full pass.

## 11. Testing

Against `CLAUDE.md`'s bar, file by file. What earns a test:

1. **`repomap/locator.go`** — §6.1's five rules interacting: absolute-to-relative conversion,
   1-based-to-0-based conversion with and without `column`, `symbol` as a hint alongside `file`,
   `symbol` alone resolving through `SearchSymbols` (exactly one exact hit proceeds; several return
   candidates; none returns empty), and neither field erroring. A decision structure over several
   interacting rules, and the one place a silent wrong answer could originate.
2. **`repomap/index.go`'s readiness gate and sync lock** — a tool call before ready blocks and then
   proceeds; a tool call that outlasts the bound returns `IsError` and never an empty result; a
   second process holding the flock makes the first wait; a held lock past the deadline degrades to
   serving instead of hanging; `Close` during a pending wait. Concurrency, ordering and cancellation:
   named in the bar explicitly.
3. **One conformance smoke test over `mcp.NewInMemoryTransports()`** — a real client against a real
   server over a seeded `codeindex.Store` (the same `ReplaceFile` seeding C2's own tests use):
   `ListTools` returns exactly the six advertised names, and each tool called once returns a
   non-error result. Not per-tool coverage — the equivalent of C1's one-line-per-grammar smoke parse,
   guarding the thing a compiler cannot: a schema the SDK rejects at registration, or a renamed tool.
4. **One Playwright UI spec** — with the toggle off, no command text and no Install button exist;
   turning it on reveals, per client, the command *before* the button in DOM order. This is SPEC's
   own non-negotiable ("enabling is never a silent action"), and DOM order is the only place it is
   actually enforced.

What gets nothing: `render.go` (string formatting with no edge case), the six handlers themselves
(thin pass-throughs over `codegraph`, covered incidentally by 3), argument clamping (one bound each,
already clamped again downstream), `mcpinstall`'s command strings and probe order (`gitvsix`'s own
`install_test.go` already covers the probe shape; the argv here is a literal), the bun wrapper (a
build and a spawn), and the settings leaf (the fifth instance of a pattern four sections already
share).

## 12. Documentation to update

- **`docs/ARCHITECTURE.md` Stack table**: one row for the MCP SDK — official, Apache-2.0, stdio, why
  `mcp-go` and hand-rolling were declined, and the helper binary's measured size.
- **`docs/ARCHITECTURE.md`**, a new subsection after the `codegraph` one: the server's process shape,
  both launch paths, repository resolution and self-indexing, the six tools, and §5's isolation
  mechanisms including the per-repository sync lock file under `${KIRA_HOME}`.
- **`docs/ARCHITECTURE.md` Storage**: `codeindex.db` now genuinely has two processes on it; name the
  lock file beside it.
- **`docs/DEV_ENVIRONMENT.md`**: a `repo-map MCP server` section — run `bun run mcp:repo-map:build`
  once after a fresh clone (the cold cgo build outruns an MCP client's startup timeout), register
  with `claude mcp add kira-repo-map -- bun run --silent mcp:repo-map`, and `KIRA_REPO_MAP_LOG` for
  stderr logging.
- **`docs/PACKAGING.md`**: the helper binary in `Contents/MacOS/`, its build task, and the
  `verify-packaging.sh` assertion.
- **No `NOTICES.md` change** — §1.1.
- **`CLAUDE.md` is C4's job, not this phase's.** No section here.

## 13. Verification

Fast checks per commit: `go build ./apps/kira-studio/...`, `go vet` on the new packages,
`bun run lint`, `bun run typecheck`.

Once at S6: `go test ./apps/kira-studio/internal/repomap/... ./apps/kira-studio/internal/mcpinstall/...`,
`go test ./apps/kira-studio/internal/` for the layering test, `go test -race` on `repomap` (the
readiness gate, the flock and the watcher are what is worth racing), `bun run test:go` and
`bun run test:ui` as the backstops.

Then one real end-to-end run against this repository, recorded in the commit message rather than
asserted as a threshold (C1 §13's posture): register the dev command with the real `claude` CLI in a
scratch worktree, call all six tools, and record cold-start time to first answered tool call, warm
tool-call latency, and the rendered output of one `find_references` on a name with many uses — the
honest measure of whether §6.3's format is actually cheaper than reading the files, before C5 starts
depending on it.

Verify by hand, because no test can: `bun run --silent mcp:repo-map` emits nothing on stdout before
the first protocol byte, and the Settings section renders command-before-button for both clients on
a real packaged build.
