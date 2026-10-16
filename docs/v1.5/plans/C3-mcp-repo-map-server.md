# C3 — MCP repository-map server

> **What this phase is.** `docs/v1.5/SPEC.md`'s C3 row turned into steps, from research against the
> real C1/C2 tree (`internal/codeindex`, `internal/codegraph`, their schema and public API) plus
> direct probes of every candidate dependency (Go module proxy version lists and `go.mod` files,
> each SDK's own `LICENSE`), the real `claude` CLI in this container (2.1.270), and `bun run`'s
> actual cwd/echo behaviour. **Post-plan correction:** an earlier draft also proposed a VS Code MCP
> registration flow (§0 D6, §7.3) — dropped outright as a misreading; MCP install UI is Claude Code
> CLI only. This phase adds no parsing, no indexing
> logic and no resolution logic: it is a protocol server in front of C2's `Graph`, plus the settings
> surface that registers it. Its consumers are AI clients — starting with this repo's own sessions
> (C4 documents it, C5 dogfoods it, C6 A/B-tests it).

## 0. What SPEC left open, and how each is resolved

**D1 — The server is a Go binary/package, `apps/kira-studio/cmd/kira-repo-map` plus
`internal/repomap`. `bun run` is one of two launch paths, never the language.** The graph is Go;
moving real logic into Bun would mean a second SQLite reader, a second copy of C2's resolver (tiers,
per-language rules, kind matrix, ranking — `codegraph/resolve.go` alone), and two implementations
drifting against one schema. `docs/ARCHITECTURE.md`'s own Stack row ("Bun: tooling only — nothing at
runtime depends on it") already names the posture. §3.

**Correction (post-plan, twice over) — transport and process model.** Two real misreadings in the
original draft, both now fixed:

1. **Transport is MCP's Streamable HTTP, not stdio.** The user was explicit: "it's just one server
   serving multiple clients, like the git extension" (`git.sock`, below) — a long-running process
   many clients call into, not one spawned fresh per connection and torn down when that connection
   closes. stdio is inherently one-client-per-process (the SDK's own stdio transport ties one
   `Server.Run` to one pair of pipes); Streamable HTTP is the SDK's own alternative built for exactly
   this shape (§1.1's table already lists it as a supported transport — no new dependency). §3, §5.
2. **Two independent instances of the same code, not a repo-agnostic singleton.** `git.sock` is one
   socket for the whole app, multiplexing every open repository by `RepoID` inside its own protocol
   — this server has no equivalent multi-repository protocol (D4 still holds: one process resolves
   and serves exactly one repository, §9 restates why staying single-repo is the right scope for this
   phase) and therefore no equivalent single-instance-for-the-machine shape either. Instead:
   - **Embedded**, inside the running `Kira Studio.app`/`wails3 task dev` process itself, started and
     stopped by the app in step with the `codeIntel.mcpServerEnabled` setting (on while the app is
     running and the toggle is on; off the moment either isn't) — the same "the app owns this
     listener's lifecycle" posture `git.sock` already has (`main.go`'s own `gitSock.Start()`/
     `Close()`, never fatal on failure). This is the instance the Settings tab's Claude Code command
     points at.
   - **Headless**, `bun run mcp:repo-map` — a wholly separate OS process, not managed by any setting,
     living exactly as long as it is left running; C6's own A/B worktrees (and anyone developing on
     this repo without the GUI open) use this path, unchanged from the original plan's own D4/§3.1
     reasoning.

   Both are the same server code (`internal/repomap`) constructed twice, never one shared listener:
   each resolves its own repository, binds its own port, and mints its own token (D8) independently
   — running both against different repositories on one machine at once is normal and uncoordinated,
   exactly as running two `git status` processes against two repositories needs no coordination
   either.

So: one Go package, two constructors calling the same server, two launch paths — `bun run
mcp:repo-map` (a `package.json` script that builds then execs the standalone binary) and an
in-process instance the Wails app starts itself. §3.

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

**D5 — Isolation is structural, not asserted, adjusted for a real listener.** The original draft's
strongest line here — "no port, no socket, no listener of any kind" — is no longer true (D1's
correction) and is replaced rather than kept: the listener is real, so what actually bounds it is
named instead. **Loopback only** — `127.0.0.1`, never `0.0.0.0`, never reachable off-machine.
**Unprivileged, collision-tolerant port selection**: try one fixed default first, fall back to an
OS-assigned ephemeral port (`:0`) on `EADDRINUSE` — needed because two instances (embedded and
headless, or two headless instances against two repositories) may run on one machine at once, and a
fixed port would make the second one simply fail. **Every request checked** (D8) — a loopback port
with no authentication is still any local process's for the asking, which is exactly the gap D8
closes; unlike `git.sock` (a Unix domain socket, restrictable by filesystem permissions to begin
with) this is a TCP port, reachable by any local user or process on the machine, so the per-request
check carries real weight here, not defense in depth for its own sake. The server never opens
`kira.db` and never touches `git.sock`/`git.sock.lock` — both claims are unaffected by the transport
change, since neither one was ever about stdio specifically. It opens `codeindex.db` — WAL,
multi-process by design, read-write so the `-shm` file can be created (C1 §5.1's own forward note to
this phase) — and takes one `flock`ed lock file per repository around its *initial* sync so two
concurrent server processes (embedded and headless both indexing the same repository, say) never
parse one repository twice. §5.

**D6 — One install flow, Claude Code only, shelling out to its own CLI, argv-only, never writing
another program's config file.** `claude mcp add …`, verified against the real CLI. §7.2.
**Correction (post-plan):** an earlier draft of this plan also proposed registering this server
with VS Code's own MCP client surface (`code --add-mcp '<json>'`, Copilot agent mode). That was a
misreading of SPEC's row and is dropped outright — no VS Code MCP registration is attempted by this
phase, in any form. `internal/mcpinstall` has exactly one client. Separately, and unrelated to MCP
at all: the **already-shipped** "Install VS Code Integration" button (`internal/gitvsix`, installs
the Kira Studio `.vsix` extension) gets one small transparency enhancement — showing the command it
is about to run before the button, the same principle applied to the Claude Code flow above, no new
capability. §7.5.

**D7 — "Disabled by default" now genuinely starts and stops a listener, resolved.** Settled by the
user directly, superseding the original draft's "gates the UI, not the process" framing (which was
written for the stdio design, where the binary running was inert without something choosing to
spawn it). One settings leaf, `codeIntel.mcpServerEnabled`, default false, still — but now, per D1's
corrected two-instance model, it controls the **embedded** instance's actual lifecycle: off means no
listener exists at all inside the running app; flipping it on starts one (resolving the app process's
own repository, minting a token, binding a port), flipping it off — or quitting the app — stops it,
mirroring `git.sock`'s own start-at-boot/close-at-shutdown shape but gated by this setting rather than
unconditional. The **headless** `bun run mcp:repo-map` instance is entirely untouched by this leaf
(D1): it is not managed by any app setting, and runs for exactly as long as it is left running,
independent of whether the embedded one is on, off, or the app is even open. Manual config for any
MCP client besides Claude Code stays out of scope regardless of instance. §7.1.

**D8 — Static-token authentication, added post-plan, adjusted once more for HTTP.** A loopback TCP
port (D1/D5's correction) is reachable by any local process, not just whatever Claude Code spawned —
unlike a stdio pipe, which only the process that spawned it can ever write to. A static token closes
that: every request must carry it, or the server refuses to act on it. Same threat model
`git_clients` pairing already exists for on the git socket side (`docs/ARCHITECTURE.md` Storage:
`git_clients(id, label, token_hash, token_salt, …)`, only `sha256(salt‖token)` ever at rest,
`internal/gitsock/token.go`'s exact shape) — but **one token per server instance, not a pairing
table**: each instance (D1) has exactly one caller worth trusting (whatever `claude mcp add`
registered against it), not several paired identities to individually revoke.

**Where it lives, and why not `git_clients`/`kira.db`.** A new package, `internal/mcpauth`, mints and
verifies the token (`crypto/rand` 32 bytes, base64url on the wire, sha256(salt‖token) at rest —
`gitsock/token.go`'s own shape, not re-derived) and persists only the hash+salt, as one small JSON
file per repository under `KIRA_HOME` — `mcp-repo-map-<first 12 hex of sha256(repo_id)>-token.json`,
mode 0600, the exact naming convention `codeindex-sync-<…>.lock` (§5) already established — rather
than a `kira.db` table. Per-repository, not one global file: D1's corrected model has independent
instances, potentially several on one machine at once, each with its own token; a global file would
make enabling the embedded instance for repository A silently able to authenticate a request against
repository B's server too. Not the settings-leaf pattern either (§7.1's leaf is a single user-typed
boolean patched through `SettingsRepo`; a server-generated, per-repository secret doesn't fit that
shape, and a `[]byte` hash/salt pair is awkward as a JSON-encoded settings value). Not a `kira.db`
table: D5 keeps "`kira.db` is never opened" literal — a token table would mean either a real (if
narrow) `kira.db` dependency for the server, or threading a second connection pool past `kira.db`'s
own `SetMaxOpenConns(1)` for a two-column read, for no benefit a file doesn't already give.

**Lifecycle.** Minted the moment the **embedded** instance's `codeIntel.mcpServerEnabled` flips
false→true (`bridge.RepoMapService.SetEnabled`, one call: patch the leaf, resolve the app's own
repository, mint, persist to that repository's file, start the listener, return the plaintext for
display) — the plaintext exists in exactly one place at rest — nowhere; it is held in memory for the
running app process's life and shown in the Settings tab, never written to disk itself, never logged.
An app restart with the leaf already `true` loads the existing hash+salt and starts the listener
without minting again (a previously-registered Claude Code command keeps working across restarts),
but the plaintext is then unknown to this process — `Regenerate` (same mint call, no leaf write)
covers exactly that case, overwriting the file: there is no revocation list for a single token, so
"regenerate" and "revoke-then-reissue" are one operation, and a stale registered command simply fails
the per-request check afterward. The **headless** instance mints (or loads) its own token against its
own resolved repository the same way, on process startup, with no settings leaf involved at all
(D1/D7) — it prints the plaintext once, in its own ready-to-copy command, to its own stdout (§3.1).

**Delivery: an HTTP header, not a CLI flag.** `claude mcp add`'s real CLI (2.1.270, this container)
supports `--transport http <url> --header "Authorization: Bearer …"` for exactly this (confirmed via
`claude mcp add --help`'s own example: `claude mcp add --transport http corridor
https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."`). §7.2's shown/installed
command carries the token this way. An argv flag would be visible to any other local user via `ps`;
an HTTP header sent only over the loopback connection is not (still visible to a sufficiently
privileged local observer capturing loopback traffic or reading `claude`'s own on-disk MCP config,
worth naming rather than overclaiming "unobservable" — the token's job is to stop an arbitrary local
process from *calling* the server, not to defend against a privileged one reading the machine).

**Per-request check.** The SDK's own `auth.RequireBearerToken` middleware (`github.com/
modelcontextprotocol/go-sdk/auth`, already in the dependency graph via D2 — no new library) wraps the
`StreamableHTTPHandler` on every instance: a `TokenVerifier` reads that repository's `internal/
mcpauth` file, `subtle.ConstantTimeCompare`s the presented header against the stored hash+salt
(`AllowMissingExpiration: true` — this token carries no `exp` claim, D8's own token is not
OAuth-shaped), and rejects with `401` plus a `WWW-Authenticate` header (the middleware's own behaviour)
on any miss — missing header, malformed header, wrong token, or no token file at all (an instance
whose settings toggle was never turned on, or a headless instance that failed to mint, simply has
nothing to compare against and rejects every request). This is strictly a per-request gate now, not a
startup-only check (D5's own note: "the token gates 'can this process do anything at all,' not 'who
is connecting to what'" no longer quite fits a multi-request listener — restated as "no request does
anything until it presents the token," checked by the SDK's own middleware on every one).

**In scope**: the SDK (§1), the layout (§2), the process shape and both launch paths (§3), repository
resolution and indexing (§4), isolation (§5), the tool surface (§6), settings plus the Claude Code
install flow (§7), concurrency and logging (§8), tests (§11), docs (§12).

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
`*mcp.CallToolResult` with `*mcp.TextContent`, and `mcp.NewInMemoryTransports()` plus `mcp.NewClient`
for §11's conformance test (in-memory transport is transport-agnostic to the tool layer, so the
conformance test is unaffected by the HTTP correction below). `Out = any` is deliberate: the SDK
generates **no** output schema for `any`, so a tool returns text only (§6.3 argues why).
`ServerOptions.Instructions` carries §6.0's one paragraph.

**Transport, corrected: `mcp.NewStreamableHTTPHandler(getServer func(*http.Request) *Server, *mcp.
StreamableHTTPOptions)` (`StreamableHTTPOptions.Stateless: true`), not `&mcp.StdioTransport{}`.** The
handler is a plain `http.Handler`; `getServer` returns the same one `*mcp.Server` for every request —
correct here because a `Graph` holds no mutable state and is already safe for concurrent use (§8), so
there is nothing session-scoped for `Stateless` to lose. Wrapped in `github.com/
modelcontextprotocol/go-sdk/auth`'s own `RequireBearerToken(verifier, opts)` middleware (D8) before
being mounted on a `net/http.ServeMux` at `/mcp`, served by a plain `net/http.Server{Addr:
"127.0.0.1:<port>"}` (D5). All of this is the same module D2 already took; no new dependency. Exact
field/method names are pinned at S1 against the tagged version and the handler signatures compile or
they do not — no guess survives the first build.

## 2. Where the code lives

```
apps/kira-studio/cmd/kira-repo-map/
  main.go          flags, logging to stderr, token check (D8), repo resolution, serve; the only main package

apps/kira-studio/internal/repomap/         the server: pure Go, no cgo of its own; one constructor,
                                            two callers (cmd/kira-repo-map, apps/kira-studio/main.go)
  server.go        mcp.Server construction, tool registration, instructions
  http.go          StreamableHTTPHandler, auth middleware, net/http.Server, port bind+fallback (§5)
  repo.go          cwd/--repo to RepoID+root; ListRepos fallback; degraded mode
  index.go         background Sync, the readiness gate, Watch, the per-repo sync flock
  lock_unix.go     //go:build unix — flock
  lock_other.go    //go:build !unix — no-op, documented
  locator.go       tool arguments to codegraph.Query (§6.1)
  tools.go         the six tools: argument structs, handlers
  render.go        Target/Site/Node to compact text (§6.3)

apps/kira-studio/internal/mcpauth/         D8: mint/verify/persist the static token — no DB, one
  token.go         JSON file per repository under KIRA_HOME, hash+salt only, gitsock/token.go's own
                    crypto shape; used by internal/repomap (per-request verify) and internal/bridge
                    (mint on enable)

apps/kira-studio/internal/mcpinstall/       desktop side only; never linked into the server
  install.go       Status/command string/Install for Claude Code only, Deps-shaped like gitvsix
  exec.go          argv-only spawn, bounded stderr (gitvsix/exec.go's shape)

scripts/mcp-repo-map.ts                     the bun wrapper (§3.1)
apps/kira-studio/internal/bridge/repomap.go RepoMapService — owns the embedded instance's lifecycle
apps/kira-studio/frontend/src/state/repomap.ts + SettingsDialog.vue's own Code intelligence tab
```

No `Contents/MacOS/kira-repo-map` helper binary and no `common:build:repomap` packaging task (§3.2's
correction): the embedded instance runs inside `Kira Studio.app`'s own executable, since `main.go`
now imports `internal/repomap` directly — there is nothing separate left to copy into the bundle.
`cmd/kira-repo-map` remains, but only as the headless dev binary `scripts/mcp-repo-map.ts` builds
on demand; it is never packaged.

Layering: `repomap` and `mcpinstall` import nothing from `internal/bridge`
(`internal/layering_test.go` covers this automatically). `mcpinstall` imports nothing from
`internal/gitvsix` either — the two packages solve unrelated problems (Claude Code CLI registration
vs. a VS Code `.vsix` install) and share no probe order worth factoring out.

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

Two properties this depends on, each verified rather than assumed:

- **`bun run` executes a script with cwd set to the `package.json` directory**, checked by running
  `bun run lint` from `apps/kira-studio/` and watching a root-relative path in the script resolve.
  So under this launch path the server's cwd is always that worktree's root — which is exactly the
  repository the caller means, including for a linked worktree. An agent whose own cwd is a
  subdirectory still lands on the right repository.
- **First build is expensive.** `codeparse` is cgo over ~34 MB of generated C (C1 §1.3), so a cold
  cache is minutes. This is why `mcp:repo-map:build` exists as a separate script: run it once after a
  fresh clone, before registering. `docs/DEV_ENVIRONMENT.md` says so (§12).

**Correction: stdout is no longer reserved for protocol bytes (D1/D5's HTTP correction).** The
original draft's strongest claim here — "one stray byte on stdout corrupts the JSON-RPC stream" — was
true only for the stdio transport and no longer applies: the wire protocol now travels over the HTTP
port, not stdio, so the binary's own stdout is free to be a normal log stream. It is put to use for
exactly that: on a successful bind, the binary logs its own listening URL and a ready-to-copy Claude
Code registration command (D8's own per-instance token, minted or loaded for this repository) to
stdout, e.g.:

```
Repo map MCP server listening on http://127.0.0.1:<port>/mcp
Register with:
  claude mcp add --transport http kira-repo-map http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

— the headless equivalent of what the Settings tab shows for the embedded instance (§7.4), surfaced
as a log line since there is no dialog to render it into. `--silent` on the registered `bun run`
script is no longer load-bearing for protocol correctness, only for not duplicating `bun run`'s own
`$ <command>` echo ahead of the binary's own first log line.

Nothing else moves into TypeScript. The wrapper holds no logic worth testing and no protocol
knowledge at all.

### 3.2 Embedded: the same server, inside `Kira Studio.app`'s own process

No separate packaged binary (the original draft's `Contents/MacOS/kira-repo-map` helper is dropped
along with it, §2's own correction): `apps/kira-studio/main.go` imports `internal/repomap` directly,
the same package `cmd/kira-repo-map` imports, and constructs a second instance in-process. D7 governs
its lifecycle: constructed and started when `codeIntel.mcpServerEnabled` is (or becomes) `true`,
stopped when it becomes `false` or the app quits — mirroring `git.sock`'s own `Start`/`Close` shape
(`main.go`'s existing call sites), never fatal on failure (a bind failure, or a repository this
process's cwd doesn't resolve to, is logged and leaves the toggle showing a degraded state rather
than crashing the app, §4.1's own note on this).

**What repository does the embedded instance resolve?** The same `gitclient.Identify` call the
standalone binary makes, against the running app process's own cwd — there is no other repository
concept for the app to draw on today (native git mode, and any UI for picking "the current
repository," is C8/C5's job, both explicitly future phases; C1/C2 remain library phases with no
caller in the live app until C5 "dogfoods it," this phase's own reading list). This works correctly
for `wails3 task dev` run from this repository's own root (cwd is the repo root, C4/C5/C6's own
dogfooding loop), and is honestly limited for a packaged `Kira Studio.app` launched from
`/Applications` by a real end user, whose cwd is very unlikely to be a git worktree at all — in that
case `Identify` fails, the embedded instance simply does not start, and the Settings tab says why
("no repository found at the app's own working directory; use `bun run mcp:repo-map` for now").
Recorded as a known limitation (`docs/ARCHITECTURE.md`), not silently accepted: real repository
selection for the embedded instance is exactly the gap C5's own dogfooding work is expected to close,
not this phase's to invent ahead of it.

Since the embedded instance lives inside the same process as `bridge.RepoMapService`, there is no
cross-process discovery to build for it: `Status()` reads the running instance's port and (when held)
plaintext token directly out of the Go value the service already holds a reference to — no port file,
no second read of the token file it just wrote. A port/token *file* is still real (D8, and D5's port
selection), but its only reader is that repository's own future process restart, not the GUI.

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

- **Loopback only, own port, own path.** `127.0.0.1:<port>`, never `0.0.0.0` — not reachable from
  another machine regardless of the token. `wails3 task dev`'s Vite port and the Wails dev server's
  own port are untouched because this binds a different one; a fixed default is tried first
  (`internal/repomap`'s own constant) and an OS-assigned ephemeral port (`:0`) is the fallback on
  `EADDRINUSE`, so a second instance on one machine (embedded plus headless, or two headless
  instances against two repositories) never simply fails to start over a port clash (D1/D5's
  correction).
- **`git.sock.lock` is never taken.** That flock elects the one instance that serves the git socket
  (`docs/ARCHITECTURE.md`); this server serves a different port entirely and must never contend for
  that lock.
- **`kira.db` is opened only by the embedded instance's own host process, never by `internal/
  repomap` itself.** `internal/repomap` (and `cmd/kira-repo-map`, the headless binary) still reads no
  settings and never touches `kira.db` — the setting that starts/stops the embedded instance is read
  by `bridge.RepoMapService`, which already has a `kira.db` connection like every other bridge
  service; the server package's own isolation from `kira.db` is unchanged; the app process instance
  it lives in was never isolated from `kira.db` to begin with.
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
- **Contention is real starting this phase, corrected from the original draft.** The original text
  claimed "nothing in the desktop app opens `codeindex.db` yet... until C5 this server is the only
  process touching the file" — true for the headless instance alone, but the embedded instance (D1's
  correction) is exactly the desktop app opening it, from this phase on, not from C5. The mechanisms
  above (WAL, the sync flock, `_busy_timeout`) are what make that correct starting now, not a
  forward-looking note for later.
- **`KIRA_HOME` remains the escape hatch.** Pointing the server at a different home gives it a
  private cache, which is worth knowing for a debugging session but is not the default — sharing the
  cache with the desktop app is the whole point of "no second parse pipeline".
- **Every request is bearer-checked (D8).** A loopback port is still any local process's for the
  asking; `auth.RequireBearerToken` rejects anything not carrying that instance's own token before it
  reaches a tool handler, which is what actually stands in for "no port, no socket, no listener" as
  this phase's isolation guarantee against an unintended local caller.

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

**Its own settings tab, not a section of an existing one.** `SettingsDialog.vue`'s sections
(`Appearance`, `Data`, `Cache`, `Connected editors`, `Git`, `Advanced`) are each already one
specific surface; this is a new one, **Code intelligence**, added to that list rather than folded
into `Connected editors` (which stays git-client pairing plus the unrelated VS Code `.vsix` button,
§7.5) or `Advanced`. Its entire content is the toggle and, when on, the one Claude Code
command-and-button pair — nothing else lives on this tab.

**What "disabled" means, precisely — corrected (D7).** Off: no embedded listener exists at all, and
the tab shows the toggle, one sentence of explanation, and nothing else — no command text, no Install
button. On: the app starts the embedded instance (§3.2) and the command appears as copyable text,
with its Install button *below* it — or, when enabled but no repository was resolvable at the app's
own cwd (§3.2), a plain sentence saying so instead of a command that would not work. Unlike the
original draft's stdio-era reasoning ("the server process itself never reads this setting... launched
by an MCP client, not by the app"), the setting now directly owns whether the embedded listener runs
at all — restated in D7. SPEC's "enabling is never a silent action" is honoured by the tab's
ordering, which §11 tests.

**The toggle applies immediately**, bypassing the dialog's draft/Save flow — the same posture
`onRevokeGitClient` and `onInstallVsCodeIntegration` already take, for the same reason G12 D9 gives:
a tab must not mix Save-gated settings with instant actions. Since the toggle's entire purpose is to
reveal two instant actions, it belongs on the action side of that line, and the new
**Code intelligence** section stays action-only.

### 7.2 Claude Code CLI

**Command shown (embedded instance, app running, toggle on):**

```
claude mcp add --transport http --scope user kira-repo-map http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

Verified against the real CLI (2.1.270), `claude mcp add --help`'s own documented shape and example:
`claude mcp add [-s local|user|project] [-t stdio|sse|http] [-H header...] <name> <commandOrUrl>
[args...]` — `-t/--transport http` with a URL positional (not a spawned command) registers a remote
HTTP server, `-H/--header` attaches one header verbatim to every request the CLI itself makes.
`<port>` and `<token>` come from the running embedded instance directly (§3.2 — no file read, no
re-resolution): `<port>` is whatever it actually bound (D5's fallback may have moved it off the
default), `<token>` is D8's plaintext, known only while held in this app process's memory (empty —
see below — right after a restart until `Regenerate` is clicked).

**`--scope user`, not `local` or `project`.** `local` scope is keyed to the directory the *client*
runs in, not the server's — irrelevant here since the server is a URL, not a spawned command; `user`
is the natural "register this once for this machine" scope for a remote endpoint. `project` writes a
committed `.mcp.json` into someone's repository, which an app-driven button has no business doing.

**Install button**: re-resolves everything, then spawns `[claudePath, "mcp", "add", "--transport",
"http", "--scope", "user", "kira-repo-map", url, "--header", "Authorization: Bearer " + token]` —
argv only, never a shell (the header is one argv element; there is no shell to inject into even
though it contains a space), 30 s timeout, bounded stderr in the outcome. Never writes `~/.claude.json`
directly: that file is the CLI's own live private format, and the CLI is right there.

**When no plaintext token is held** (an app restart with the setting already on — D8's own lifecycle
note): the tab shows a **Regenerate** action in place of the command and Install button. Clicking it
calls `RepoMapService.Regenerate`, which mints a fresh token for the already-running embedded
instance, persists it, and returns it for display — the same command then renders normally. This is
the one extra state the HTTP-token design adds versus the original stdio draft, and is unavoidable: a
stored hash cannot be turned back into its own plaintext.

**Finding `claude`** has the same launchd-PATH problem `gitvsix` documented for `code` (a
Finder-launched app gets `/usr/bin:/bin:/usr/sbin:/sbin`). Same probe shape: `LookPath` first, then
`~/.claude/local/claude`, `~/.local/bin/claude`, `/usr/local/bin/claude`,
`/opt/homebrew/bin/claude`; every path considered recorded, so a miss is explainable. Not found is
**not** a failure state here — the command is already on screen to copy, which is strictly better
than `gitvsix`'s Finder-reveal fallback and needs no fallback of its own.

**Dev builds** (`wails3 task dev`) show the exact same shape — there is no "no bundle beside the
executable" case anymore (§3.2's correction: the embedded instance is this same app process, dev or
packaged, not a separate bundled binary) — so §7.2's command and Install button behave identically
whether the running app is a dev build or a packaged one.

**Headless (`bun run mcp:repo-map`)**: not surfaced by the Settings tab at all (§3.2, D1) — it prints
its own equivalent command to its own stdout on startup (§3.1):

```
claude mcp add --transport http kira-repo-map http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

That form is also what C4 documents and what C6's A/B arms use: each worktree's own `bun run
mcp:repo-map` mints its own token and (via port fallback) its own port, so Arm A and Arm B register as
two independently-named servers with no shared state between them, on one machine, at the same time.

### 7.3 VS Code MCP registration — dropped

An earlier draft of this plan proposed a second install flow here, registering this server with VS
Code's own MCP client surface (`code --add-mcp '<json>'`, Copilot agent mode since 1.102). **That
reading is wrong and the flow is dropped outright, in any form.** The actual ask was narrower: MCP
config/install UI is Claude Code CLI only. No workspace `.vscode/mcp.json`, no user-profile
`mcp.json`, no `code --add-mcp`, no `gitvsix.CodeCandidates()` export for this purpose —
`internal/mcpinstall` has exactly one client, Claude Code (§7.2). Nothing in this phase touches VS
Code's MCP surface at all.

### 7.4 Wiring

`bridge.RepoMapService` (`internal/bridge/repomap.go`), shaped like `GitClientsService`, now also
owning the embedded instance's actual lifecycle (D7's correction) rather than only rendering a
command for a process it never touches: it holds a `*repomap.Server` reference once started, `nil`
while off. `Status()` returns whether it is running, its resolved repository's root (or the reason it
isn't running — no repository resolved, a bind failure), its port, whether a plaintext token is
currently held (false right after an app restart until `Regenerate`, since a hash cannot be reversed),
the rendered Claude Code command string (empty unless running with a plaintext held) and the
`claude` CLI's own probe. `SetEnabled(ctx, enabled)` patches the settings leaf and: on false→true,
resolves the repository, mints a fresh D8 token, starts `internal/repomap`'s embedded constructor,
keeps the `*repomap.Server` and plaintext in memory; on true→false, stops it and drops the reference. Every false→true transition mints fresh regardless
of whether a token file already exists for that repository (D8's own "regenerated when the toggle
turns on" framing, taken literally and consistently for both the toggle and app-boot-with-the-leaf-
already-true — the one exception being app boot itself, which loads rather than mints, §3.2/D8, since
no explicit toggle click happened there). `Regenerate(ctx)` mints a
fresh token for the already-running instance without touching the setting or its lifecycle (the
restart-recovery path). `InstallClaudeCode(ctx)` returns a named outcome value and never a Go error —
`connections.Service.Reveal`'s precedent, already applied twice (`gitvsix.Installer.Install`,
`GitClientsService.Approve`/`Deny`). Registered in `main.go` beside `GitClientsService`; `main.go`'s
own shutdown path calls `Stop` the same way it closes `gitSock`. Bindings regenerated with `wails3
task common:generate:bindings`, never a hand-typed flag list.

Renderer: `frontend/src/state/repomap.ts` (status + `setEnabled`/`regenerate`/`installClaudeCode`,
the shape `gitClients.ts` already has) and one new **Code intelligence** tab in `SettingsDialog.vue`'s
own section list (§7.1), laid out strictly as toggle, then command, then button — the tab calls
`setEnabled` directly from the toggle (bypassing draft/Save, §7.1) and shows a **Regenerate** action
in place of the command whenever enabled is true but no plaintext token is currently held.

### 7.5 Unrelated, but touched: the existing VS Code `.vsix` install button gets command visibility

Separate feature, separate button, mentioned here only because the same transparency principle
applies and this phase is already touching `SettingsDialog.vue`'s `Connected editors` tab's
neighbourhood. The **already-shipped** "Install VS Code Integration" button
(`internal/gitvsix.Installer`, `Connected editors` tab) runs `code --install-extension <vsixPath>
--force` (or `open -R <vsixPath>` when `code` isn't found) but today shows the user neither command
before the click — only the outcome after. This phase adds that visibility: render the command
string (`gitvsix.Status`'s own `CodePath`/`VsixPath` are already both known pre-click) above the
existing button, mirroring the Claude Code command-then-button order this plan already uses
elsewhere. No change to `gitvsix.Installer.Install`'s own resolution or spawn logic — this is
display-only, in `SettingsDialog.vue` and, if the exact command string needs the resolved paths
verbatim, one small addition to `GitVsixStatus`'s wire shape (`bridge/gitclients.go`).

## 8. Concurrency, cancellation, logging

- One `Graph`, no mutable state, safe for concurrent tool calls (C2 §8); the SDK's stateless HTTP
  handler (§1.2) runs handlers concurrently across every connected client by construction, and
  nothing here assumes otherwise — this is what "one server, many clients" (D1) actually rests on.
- Every handler takes the SDK's `ctx` straight through to `codegraph` and `database/sql`, so a
  client-cancelled request stops mid-query.
- **Logging, corrected: stdout is no longer reserved (§3.1).** `cmd/kira-repo-map`'s headless binary
  logs its listening URL and ready-to-copy command to stdout on a successful bind (§3.1); routine
  operational logging (`log/slog`, `gitclient`'s own `scope`-attribute convention, level from
  `KIRA_REPO_MAP_LOG`, `error` default) still goes to stderr in both the headless and embedded
  instance, same posture as before, just no longer load-bearing for protocol correctness the way it
  was under stdio.
- `SIGINT`/`SIGTERM` (headless) and `bridge.RepoMapService.Stop`/app shutdown (embedded) both cancel
  the same root context: HTTP server shut down, watcher closed, `Index.Close()`, `Store.Close()`, lock
  released. The bun wrapper forwards both signals to the headless binary.
- Flags (`cmd/kira-repo-map` only — the embedded instance takes its equivalents as constructor
  arguments, never flags): `--repo <path>` and `--version`. No `--port` — §5's default-then-fallback
  selection is automatic, and a knob nobody has asked for is scope that stayed out.

## 9. Explicitly out of scope

- **Any new graph capability.** This phase adds no operation `codegraph` does not already expose, and
  changes neither `codeparse` nor `codeindex`'s schema.
- **File contents, MCP resources, MCP prompts, sampling, roots.**
- **stdio transport.** Corrected out of the original draft's *in-scope* column into this one (D1):
  HTTP is what "one server, many clients" (the user's own framing) actually needs; stdio ties one
  process to one client by construction.
- **A multi-repository server, revisited and kept out on purpose.** D1's HTTP correction raised the
  question of whether one persistent process should now serve requests scoped to whichever repository
  each one names, since it no longer exits after a single client disconnects. Decided against: nothing
  about serving many *clients* requires serving many *repositories* — HTTP already gives "one process,
  arbitrarily many concurrent callers" against the one repository it resolved at startup (§8), which is
  all D1's correction actually asked for. Real multi-repository support would mean a repository
  argument on every tool, per-repository auth and sync-lock bookkeeping inside one process instead of
  one file each, and a cache-eviction story for repositories no longer in use — a materially bigger
  phase than this one, with no concrete user of it today (C4-C6 each work with one repository, or one
  worktree, at a time). One process still resolves and serves exactly one repository (D4 unchanged);
  a user or agent working across several repositories runs several server instances, each on its own
  port (D5).
- **Non-macOS packaging.** Moot for the embedded instance (§3.2's correction: no separate binary is
  packaged at all); the headless binary is a Go build, cross-platform already, and this phase adds no
  platform-specific packaging for it.
- **A process-manager UI** (start/stop/restart button, health indicator beyond the plain running
  boolean §7.4's `Status()` already returns). The toggle is the only lifecycle control this phase
  adds.
- **Any VS Code MCP registration** (an earlier plan draft's mistaken D6 — see §7.3). No
  `.vscode/mcp.json`, no user-profile `mcp.json`, no `code --add-mcp`, in any form.
- **Auto-registration.** Nothing registers itself on launch, ever. That is what "command visible
  first, button second" means.
- **Reading the enable setting from the server** (D7).

## 10. Implementation steps

Each step builds, passes `go vet` and `bun run lint`, and carries its own tests where §11 calls for
them. Expensive verification runs once at S6, per `CLAUDE.md`.

**S1 — SDK plus a server that serves one tool, over HTTP.** Add `github.com/modelcontextprotocol/
go-sdk` to `go.mod`. `cmd/kira-repo-map/main.go` (flags, slog to stderr, the startup token check,
signals) and `internal/repomap`'s `server.go`/`http.go`/`repo.go`/`index.go`: repository resolution,
background `Sync`, the readiness gate, the sync flock, `Watch`, port bind-with-fallback, the
`auth.RequireBearerToken`-wrapped `StreamableHTTPHandler`, and `outline_file` as the single registered
tool. `internal/mcpauth`'s mint/verify/persist. Working increment: a real MCP server over HTTP an
editor can register and call.

**S2 — The remaining five tools.** `locator.go`, `tools.go`, `render.go`: §6.1's rules, the five
tools, §6.3's rendering, the tightened limits, the Go-implementations message, `IsError` semantics —
all transport-agnostic, unaffected by S1's HTTP correction. Tests per §11.1 and §11.2.

**S3 — The bun launch path.** `scripts/mcp-repo-map.ts` plus the two `package.json` scripts, plus the
startup log line (§3.1) with the ready-to-copy command. Verify by hand that a registered `bun run
mcp:repo-map` binds, logs a working command, and a real client connects to it over HTTP.

**S4 — `internal/mcpinstall` plus the bridge service, now owning the embedded instance's lifecycle.**
Command rendering for Claude Code (HTTP transport + header, §7.2), its probe (`claude` candidates),
its install, named outcomes; `bridge/repomap.go`'s `RepoMapService` — `SetEnabled` starts/stops an
embedded `*repomap.Server`, `Status`/`Regenerate` per §7.4 — `main.go` registration (construction on
boot if the leaf is already `true`, `Stop` wired into the existing shutdown path beside `gitSock`),
regenerated bindings. No VS Code MCP work here (§7.3).

**S5 — Settings leaf, the settings tab, and the vsix-button command visibility.** The leaf through
all four layers (`settings.ts`, `model`, `repos`, the dialog), `state/repomap.ts`, the new **Code
intelligence** tab in toggle/command/button (or Regenerate) order, the Playwright spec (§11.4); the
small `Connected editors` tab enhancement from §7.5 (show the VS Code `.vsix` install command before
its existing button). No packaging task (§3.2's correction removed it) — instead, measure and record
in this commit's message the `cmd/kira-studio` app binary's size delta from linking in
`internal/repomap` plus the MCP SDK, the same kind of number C1 recorded for its own grammar registry.

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
3. **`internal/mcpauth`'s mint/verify round trip and `internal/repomap/http.go`'s auth wiring** — a
   minted token verifies against its own stored record and no other; a wrong or missing bearer header
   is rejected before a tool handler ever runs (a fake handler that would fail the test if reached).
   The one place a request could reach the index despite carrying no valid token.
4. **One conformance smoke test over `mcp.NewInMemoryTransports()`** — a real client against a real
   server over a seeded `codeindex.Store` (the same `ReplaceFile` seeding C2's own tests use):
   `ListTools` returns exactly the six advertised names, and each tool called once returns a
   non-error result. In-memory transport bypasses HTTP/auth entirely (by design — this test is about
   the tool registration surface, not the network layer, which item 3 already covers) — not per-tool
   coverage either, the equivalent of C1's one-line-per-grammar smoke parse, guarding the thing a
   compiler cannot: a schema the SDK rejects at registration, or a renamed tool.
5. **One Playwright UI spec** — with the toggle off, no command text and no Install button exist on
   the Code intelligence tab; turning it on reveals the Claude Code command *before* the button in
   DOM order. This is SPEC's own non-negotiable ("enabling is never a silent action"), and DOM order
   is the only place it is actually enforced.

What gets nothing: `render.go` (string formatting with no edge case), the six handlers themselves
(thin pass-throughs over `codegraph`, covered incidentally by 3), argument clamping (one bound each,
already clamped again downstream), `mcpinstall`'s command strings and probe order (`gitvsix`'s own
`install_test.go` already covers the probe shape; the argv here is a literal), the bun wrapper (a
build and a spawn), and the settings leaf (the fifth instance of a pattern four sections already
share).

## 12. Documentation to update

- **`docs/ARCHITECTURE.md` Stack table**: one row for the MCP SDK — official, Apache-2.0, Streamable
  HTTP (corrected from stdio), why `mcp-go` and hand-rolling were declined, and the app binary's
  measured size delta.
- **`docs/ARCHITECTURE.md`**, a new subsection after the `codegraph` one: the two-instance process
  shape (embedded, owned by the app's own lifecycle; headless, `bun run`), repository resolution and
  self-indexing (including the embedded instance's cwd-based limitation, §3.2), the six tools, and
  §5's isolation mechanisms — loopback binding, port fallback, per-request bearer auth, the
  per-repository sync lock file under `${KIRA_HOME}`.
- **`docs/ARCHITECTURE.md` Storage**: `codeindex.db` now genuinely has two processes on it; name the
  lock file beside it.
- **`docs/ARCHITECTURE.md` Known open items**: the embedded instance's repository resolution is
  cwd-based only (§3.2) — real "current repository" selection for a packaged app is C5/C8's job, not
  this phase's.
- **`docs/DEV_ENVIRONMENT.md`**: a `repo-map MCP server` section — run `bun run mcp:repo-map:build`
  once after a fresh clone (the cold cgo build outruns a slow first index), register with the command
  `bun run mcp:repo-map` prints on its own stdout, and `KIRA_REPO_MAP_LOG` for stderr logging.
- **No `docs/PACKAGING.md` change** — §3.2's correction: no separate helper binary is packaged.
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

Verify by hand, because no test can: `bun run mcp:repo-map` prints a working, copy-pasteable
registration command on a successful bind, and the Code intelligence tab renders command-before-button
(or Regenerate) on a real dev build with the toggle exercised on and off.
