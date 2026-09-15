# P67d — Repo-map MCP settings toggle: general enablement, per-repo access

> **What this phase is.** `docs/v1.6/SPEC.md`'s P67d row, turned into concrete steps from direct
> reads of the real tree at `2baa49fb`. Every file, line number, type name and SDK behaviour below
> was opened and checked, never recalled. The user's own report: *"If i try to enable repomap mcp it
> says no repository found for this working directory. That toghle is general. If enabled it starts
> the server. All imported repos will be shown there and i can enable acces for mcp to them one by
> one"*.
>
> Scope note: this is the **product** surface — the Settings dialog's Code intelligence tab and the
> embedded server behind it. The dev-only headless server (`bun run mcp:repo-map`, `CLAUDE.md`'s own
> section) shares the same package and is kept working, but is not what this row is about.

## 0. What SPEC leaves open, and how each is resolved

SPEC's P67d row names three things this planning pass must locate or design.

**1. "Why the toggle is scoped to one working directory today."** Traced to one line:
`internal/bridge/repomap.go:107` constructs `repomap.Config` with no `Repo`, so
`repomap/repo.go:36-40` falls back to `os.Getwd()` — the Wails process's cwd. §1.1 has the whole
chain. Already recorded as a known open item (`docs/ARCHITECTURE.md:3641`-`3647`); P67d closes it.

**2. "How one server serves many repositories."** `repomap.Server` is one repository by
construction, stated in its own package doc (`server.go:1-11`). This phase splits it: the `Server`
keeps the listener, the token and the tool registration; a new `repoInstance` holds everything
per-repository. **One server, one port, one token, N attached repositories.** §2 states why, against
the two alternatives.

**3. "The per-repo access-list UI and its backend counterpart."** Persisted as a new
`code_repos.mcp_enabled` column (§5) — the imported-repo row P67b's Git module already owns, not a
second list. Rendered as a checkbox list in the Code intelligence tab (§7.4), granted and revoked
through one new bound method, `RepoMapService.SetRepoEnabled` (§6.2).

---

## 1. Confirmed current state

### 1.1 The exact failure chain behind "no repository found for this working directory"

| Step | File:line | What happens |
| --- | --- | --- |
| 1 | `frontend/src/workbench/SettingsDialog.vue:873`-`878` | `Checkbox` → `onToggleRepoMapEnabled` |
| 2 | `frontend/src/state/repomap.ts:33`-`38` | `control.repoMapSetEnabled(true)` |
| 3 | `internal/bridge/repomap.go:184`-`206` | `SetEnabled` writes the leaf, then `startLocked(true)` |
| 4 | `internal/bridge/repomap.go:102`-`122` | `repomap.New(ctx, Config{Home, Token, Logger})` — **no `Repo`** |
| 5 | `internal/repomap/server.go:113` | `resolveRepo(ctx, store, cfg.Repo)` with `cfg.Repo == ""` |
| 6 | `internal/repomap/repo.go:35`-`40` | empty dir → `os.Getwd()` — the app process's cwd |
| 7 | `internal/repomap/repo.go:46`-`59` | `gitclient.Identify` on that cwd fails (not a worktree) |
| 8 | `internal/repomap/repo.go:63`-`79` | degraded fallback: longest-prefix match of cwd against `codeindex.db`'s known roots — also no hit |
| 9 | `internal/repomap/repo.go:20` | `ErrNoRepository` = `"repomap: no repository found for this working directory"` |
| 10 | `internal/bridge/repomap.go:196`-`201` | error copied into `RepoMapStatus.Error`, `Running` stays false |
| 11 | `SettingsDialog.vue:887`-`889` | rendered as `data-testid="repomap-error"` — exactly what the user saw |

A packaged `Kira Studio.app` launched from `/Applications` has a cwd that is never a git worktree,
so step 7 fails for **every** real end user. The feature has never worked outside
`wails3 task dev` run from a repository root.

**Conclusion: not a bug in resolution — a design that asks the wrong question.** The app already
knows exactly which repositories it may serve (§1.3). It must never consult its own cwd again.

### 1.2 What `repomap.Server` assumes about "one repo"

`server.go:1-11` is explicit: *"One Server value is one repository, resolved once at construction
(§9: multi-repository support is deliberately out of scope)."* The per-repository state is small and
already grouped:

| Field(s) | `server.go` | Per-repository? |
| --- | --- | --- |
| `repoID`, `root` | `:65`-`66` | yes |
| `store`, `idx`, `graph` | `:77`-`79` | `store` shared, `idx`/`graph` per repository |
| `watcher` | `:82` | yes |
| `lockMu`, `lock` | `:88`-`89` | yes (the per-repo sync flock) |
| `ready`, `readyOnce` | `:91`-`92` | yes |
| `cancel` | `:97` | yes (initial-sync context) |
| `token*`, `log`, `mcp`, `httpState`, `closeOnce` | `:71`-`96` | no — server-wide |

Methods that touch per-repository state, and therefore move to the new receiver:

- `server.go`: `runInitialSync` (`:235`), `waitReady` (`:267`), `RepoID` (`:290`), `Root` (`:293`).
- `tools.go`: `notReadyResult` (`:28`), `indexNotice` (`:35`), `text` (`:46`), `resolve` (`:78`) and
  the seven handlers (`:105`, `:147`, `:194`, `:237`, `:298`, `:330`, `:351`).
- `source.go`: `sourceFor` (`:246`), `sourceForOneFile` (`:268`), `sourceForTargets` (`:335`),
  `sourceForSites` (`:348`), `readSymbolRows` (`:418`) — `:277`/`:285`/`:421`/`:428` read `s.root`
  and `s.store`/`s.repoID`.
- `locator.go`'s `relFile`/`locate` already take `root`/`graph` as parameters — untouched.

So the split is a mechanical receiver change over 17 methods plus a new resolution step in each of
the seven handlers. No rendering, resolver or source-reading logic changes at all.

### 1.3 How the app already tracks imported repositories

`code_repos` (`internal/storage/migrations/0018_c5_code_repos.sql`), one row per imported checkout:

```
id TEXT PK, name TEXT, root TEXT, repo_id TEXT (UNIQUE), sort_order INTEGER, created_at TEXT
```

- `repo_id` is `gitclient.Identify`'s own identity — **the same key `codeindex`/`codegraph` are
  keyed by** (`bridge/codeworkspace.go:88`-`89`, `codeworkspace/session.go:30`-`32`). So an attached
  repository needs no resolution step at all: the row already carries both halves.
- Go surface: `storage/repos/coderepos.go` — `List`, `Get`, `Create`, `Rename`, `Remove`.
- Bridge surface: `CodeWorkspaceService.ListRepos` (`bridge/codeworkspace.go:109`),
  `ImportRepo` (`:121`), `RenameRepo` (`:161`), `RemoveRepo` (`:178`).
- Renderer: `state/coderepos.ts`'s `codeReposState.records`, hydrated at boot
  (`main.ts:296`), owned by the Git module's panel since P67b (`repo/GitPanel.vue`).

`codeworkspace.Registry`/`Session` (`codeworkspace/session.go:50`-`180`) already runs one
`codeindex.Index` + `codegraph.Graph` + watcher per **open** repository, with the identical sync-lock
discipline `repomap` uses (`session.go:150`, a stated port of `repomap.Server`'s own sequence). This
phase does **not** merge the two (§13) — but it confirms the shape: a per-repo instance record with
its own index, graph, watcher and readiness gate is this codebase's existing answer.

### 1.4 The token model today

`internal/mcpauth` (`token.go`): 32 `crypto/rand` bytes, base64url on the wire,
`sha256(salt‖token)` at rest, `subtle.ConstantTimeCompare` on verify (`:56`-`62`), file mode `0600`
(`:94`). `Path(home, slug)` = `<KIRA_HOME>/mcp-repo-map-<slug>-token.json` (`:67`-`69`); `Slug(id)`
is the first 12 hex of `sha256(id)` (`:128`-`131`). Both instances mint **per repository** today:
`bridge/repomap.go:82`-`98` and `cmd/kira-repo-map/main.go:50`-`53`.

`repomap/http.go:43`-`48` wraps the MCP handler in the SDK's own
`auth.RequireBearerToken(verifier, …)`; `:62`-`72` is the verifier, fail-closed on a zero-value
record. `:31`-`37` binds `127.0.0.1:8765`, falling back to `127.0.0.1:0`. Never `0.0.0.0`.

### 1.5 What the MCP SDK v1.7.0 already protects, and what it does not

Read under `$(go env GOPATH)/pkg/mod/github.com/modelcontextprotocol/go-sdk@v1.7.0/mcp/streamable.go`:

| Protection | Default in v1.7.0 | Evidence |
| --- | --- | --- |
| DNS-rebinding (loopback address + non-loopback `Host` → 403) | **on** | `:175`-`182`, `DisableLocalhostProtection` defaults false |
| Cross-origin (`Origin`/`Sec-Fetch-Site`) | **off** | `:187`-`188` — *"If nil, no cross-origin protection is applied"*; `:243` only enables it under an `MCPGODEBUG` flag |
| Request body cap | on, `DefaultMaxRequestBodyBytes` | `:246`-`248` |

The SDK's own deprecation note (`:190`-`196`) says to wrap the handler with
`http.NewCrossOriginProtection()` instead of the option. `go.mod` is `go 1.27.1`, so that stdlib API
(Go 1.25+) is available. §4 does exactly that.

`repomap/http.go:54` constructs `&http.Server{Handler: mux}` with no timeouts —
`docs/ARCHITECTURE.md:3720` already records this as open. It mattered little for a dev-only server;
it matters more for one that is now on for end users whenever the toggle is (§4.2).

### 1.6 The Code intelligence tab as it stands

`SettingsDialog.vue`: section name at `:114`, imports at `:20`-`25`, handlers at `:167`-`215`,
template branch at `:865`-`924`, `.git-clients-list`/`.git-client-row` styles at `:1214`-`1245`
(the list-row precedent this phase reuses). The branch renders, in strict DOM order: toggle →
error **or** command → Install button → install outcome; or, when running with no plaintext held,
the "Regenerate token" path (`:907`-`921`). `status.repo` is never rendered anywhere.

Wire shape: `packages/shared/domain/repomap.ts:7`-`15` (`running`, `repo`, `command`,
`claudeAvailable`, `probed`, `error`), store `state/repomap.ts`, bound calls
`frontend/src/bridge/index.ts:297`-`306`, test channel map `tests/ui/support/ipcChannels.ts:135`-`138`
and `tests/ui/support/mockRuntime.ts:140`-`143`, UI spec `tests/ui/settings-code-intelligence.spec.ts`.

---

## 2. D1 — one server, many repositories

**Decision: one embedded `repomap.Server`, one loopback port, one bearer token, N attached
repositories; every tool takes an optional `repo` argument.**

Why, concretely:

1. **The user asked for it.** *"That toggle is general. If enabled it starts the server."* One
   server is the thing the toggle starts.
2. **One registration survives every later grant.** The user runs `claude mcp add …` once. Granting
   a repository months later widens the already-registered server with no re-registration and no new
   command to copy. Under a server-per-repo design, every grant produces a new port, a new token and
   a new `claude mcp add` the user must run — the failure mode that makes a feature get abandoned.
3. **One `codeindex.Store` per server** instead of one per repository. Today each `repomap.Server`
   opens its own `Store` (`server.go:112`); N servers means N connection pools over one
   `codeindex.db`. One server holds one `Store` and hands it to every instance — strictly fewer
   pools than today, not more.
4. **Tool-name collisions.** Seven identically-named tools per server; a client that registers three
   repo-map servers sees `find_definition` three times, distinguishable only by server name.

**Declined — one `Server` per granted repository.** Costs above; no benefit beyond skipping §3's
refactor.

**Declined — one listener, one token, a per-repository mount path** (`/repo/<key>/mcp`). Halves the
cost (one port, one token) but keeps the fatal half: the client still registers one MCP server per
repository, so a new grant still means a new `claude mcp add`.

---

## 3. `internal/repomap` — the split

### 3.1 File layout after this phase

| File | Change |
| --- | --- |
| `server.go` | `Server` keeps token/logger/store/mcp/http/lifecycle + the instance registry; `New` no longer resolves a repository |
| `instance.go` | **new** — `repoInstance`, its construction, `runInitialSync`, `waitReady`, `close` |
| `attach.go` | **new** — `RepoSpec`, `RepoInfo`, `Attach`, `AttachDir`, `Detach`, `Rekey`, `Repos`, `pick` |
| `tools.go` | handlers gain repo resolution; per-repo helpers move to `*repoInstance`; `list_repos` added |
| `source.go` | five methods move to `*repoInstance` — no body changes |
| `http.go` | cross-origin wrapper + server timeouts (§4) |
| `repo.go` | unchanged; now reached only from `AttachDir` (the headless path) |
| `locator.go`, `render.go` | unchanged |

### 3.2 `Server` and `repoInstance`

```go
// server.go
type Config struct {
    Home       string           // "" → config.KiraHome()
    Token      mcpauth.Record   // may be zero: the verifier is fail-closed until SetToken
    TokenPlain string           // "" when no plaintext is held (a loaded, not minted, record)
    Logger     *slog.Logger
}

type Server struct {
    home  string
    log   *slog.Logger
    store *codeindex.Store        // one per Server, shared by every instance

    tokenMu     sync.RWMutex       // unchanged from server.go:71-74
    token       mcpauth.Record
    tokenPlain  string
    tokenMinted bool

    reposMu sync.RWMutex
    repos   map[string]*repoInstance // key → instance
    order   []string                 // attach order, for a stable list_repos/Repos()

    mcp *mcp.Server
    httpState
    closeOnce sync.Once
}

func New(cfg Config) (*Server, error)   // opens the Store, builds the 8-tool mcp.Server, binds HTTP
```

`New` no longer takes a `context.Context` (nothing in it blocks) and no longer takes a
`TokenProvider` — token policy moves entirely to the caller, which is the only place that knows
whether this is an explicit enable or a boot-time restore (§6.3). `SetToken`
(`server.go:306`-`312`) already exists and already is safe on a live server; it is how the headless
binary sets a token it can only compute after resolving its repository (§3.6).

```go
// instance.go
type repoInstance struct {
    key    string   // client-facing name, unique per Server
    repoID string   // gitclient RepoID == code_repos.repo_id
    root   string

    store *codeindex.Store // the Server's, borrowed — never closed here
    idx   *codeindex.Index
    graph *codegraph.Graph
    watcher *codeindex.Watcher
    log   *slog.Logger

    lockMu sync.Mutex
    lock   *codeindex.SyncLock

    ready     chan struct{}
    readyOnce sync.Once

    inflight sync.WaitGroup  // §3.4's drain
    done     chan struct{}   // closed by Detach: wakes waitReady immediately
    cancel   context.CancelFunc
    closeOnce sync.Once
}
```

`runInitialSync` and `waitReady` move verbatim from `server.go:235`-`287`, with one addition to
`waitReady`: a third `select` arm on `<-inst.done` returning
`errors.New("repository access was revoked")`, so a revoke never leaves a caller blocked for the
remaining `readyTimeout`.

`inst.close()` mirrors `Server.Close`'s per-repo half (`server.go:318`-`332`): `cancel()`, stop the
watcher, release the sync lock if held, `idx.Close()` — **never** `store.Close()`, which the
`Server` owns.

### 3.3 Attach, Detach, Rekey

```go
// attach.go
type RepoSpec struct {
    Key     string            // client-facing name; required, unique per Server
    RepoID  string            // code_repos.repo_id
    Root    string            // worktree root
    GitPath string            // resolved git executable; "" → PATH discovery by gitclient
    Runner  gitclient.Runner
}

type RepoInfo struct {
    Key, RepoID, Root string
    Ready             bool   // initial sync finished
    Degraded          string // idx.SyncState().LastErr, "" when healthy
}

func (s *Server) Attach(spec RepoSpec) (RepoInfo, error)
func (s *Server) AttachDir(ctx context.Context, key, dir string) (RepoInfo, error) // headless: resolveRepo, then Attach
func (s *Server) Detach(key string)
func (s *Server) Rekey(old, new string) error
func (s *Server) Repos() []RepoInfo
```

- **`Attach`** validates `Key` (non-empty, not already attached, not colliding case-insensitively),
  builds `codeindex.Open(store, spec.Runner, spec.GitPath, spec.RepoID, spec.Root)` +
  `codegraph.New(store, spec.RepoID)`, starts `runInitialSync` in a goroutine and arms the watcher —
  the exact sequence `server.go:140`-`177` runs today. Returns as soon as the instance is registered;
  never waits on the sync. Idempotent: attaching a key whose `repoID`+`root` are unchanged returns
  the existing instance's `RepoInfo` and does nothing else.
- **`Detach`** removes the map entry under `reposMu.Lock()`, closes `inst.done`, then drains
  asynchronously: `go func(){ inst.inflight.Wait(); inst.close() }()`. A tool call already inside the
  instance finishes against a live index; a call that arrives after the map entry is gone can never
  resolve it. Both halves matter — closing the index under an in-flight call is a use-after-close on
  a `*sql.DB`-backed reader, and holding `reposMu` for the drain would block every other repo's
  calls for up to `readyTimeout`.
- **`Rekey`** is a map-key move only (rename in the app, §6.2) — the index, graph, watcher and any
  in-flight call are untouched.
- **`Server.Close`** swaps the map empty under the lock, then drains and closes every instance,
  closes the HTTP listener, then the `Store`.

### 3.4 Repo resolution inside a tool call

New embedded struct, added to all eight argument structs:

```go
type repoField struct {
    Repo string `json:"repo,omitempty" jsonschema:"Which attached repository to query. Omit when only one is attached. Call list_repos to see the names."`
}
```

`func (s *Server) pick(name string) (*repoInstance, *mcp.CallToolResult)` — acquires
`reposMu.RLock()`, and in this order:

1. `name == ""` and exactly one attached → that one.
2. `name == ""` and none attached → `IsError`: *"no repositories are shared with this server — grant one in Kira Studio's Settings → Code intelligence."*
3. `name == ""` and several attached → `IsError` listing every key: *"several repositories are attached; pass repo=<one of: …>"*.
4. `name != ""` → exact key match, then case-insensitive key match, then exact `root` path match
   (so an agent holding an absolute path can pass it straight through). No hit → `IsError` listing
   every key.

On a hit it calls `inst.inflight.Add(1)` **while still holding `RLock`** and returns; every handler
`defer inst.inflight.Done()`. That ordering is the whole drain guarantee: `Detach` takes the write
lock, so it cannot interleave between the map read and the `Add`.

Each handler becomes, mechanically:

```go
func (s *Server) findDefinition(ctx context.Context, _ *mcp.CallToolRequest, in findDefinitionArgs) (*mcp.CallToolResult, any, error) {
    inst, early := s.pick(in.Repo)
    if early != nil { return early, nil, nil }
    defer inst.inflight.Done()
    if err := inst.waitReady(ctx); err != nil { return inst.notReadyResult(err) }
    …unchanged body, s.→inst.…
}
```

**Cross-repo containment is unchanged and still enforced per instance**: `relFile(inst.root, …)`
(`locator.go:38`-`50`) rejects an absolute path outside the resolved repository, and
`pathsafe.ValidateRelPath(inst.root, path)` (`source.go:277`, `:421`) gates every byte read. A tool
call can never name repository A and read a file from repository B, or from outside any attached
root.

### 3.5 The eighth tool — `list_repos`

```
Name:        "list_repos"
Description: "List the repositories this server can query, with the name to pass as `repo`."
```

Output, one line per attached repository in attach order:

```
kira-studio  /Users/x/src/kira-studio  ready
my-api       /Users/x/src/my-api       indexing
legacy       /Users/x/src/legacy       degraded: <sync error>
```

An empty list renders the same sentence case 2 above uses.

Why a tool and not dynamic `instructions`: `instructions` (`server.go:187`) is fixed at
`mcp.NewServer` time, and the attached set changes while the server runs. The **tool set** itself is
static (eight tools, always), so no `tools/list_changed` notification is needed when a grant changes
— only `list_repos`' output moves, and that is read per call.

### 3.6 `cmd/kira-repo-map` (the dev-only headless binary)

Behaviour is preserved exactly, including its per-repository token files (`CLAUDE.md` documents
them, and an existing dev registration must keep working). `main.go:46`-`70` becomes:

```go
srv, err := repomap.New(repomap.Config{Home: home, Logger: log})   // no token yet → fail-closed
info, err := srv.AttachDir(ctx, "", *repoFlag)                     // key "" → filepath.Base(info.Root)
plain, rec, minted, err := mcpauth.LoadOrMint(mcpauth.Path(home, mcpauth.Slug(info.RepoID)))
srv.SetToken(rec, plain)                                           // minted==false → plain "" → same "existing token" message
… print, then srv.Serve()
```

The listener is bound before the token is set, but `Serve` is not called until after, and the
verifier rejects everything against a zero record regardless (`http.go:67`). One repository stays
attached, `repo` stays optional (rule 1), so every existing dev call site works unchanged.

---

## 4. Transport hardening

This is not scope creep: P67d is what turns a dev-only loopback server into one an end user leaves
running. Both items are a handful of lines.

### 4.1 Cross-origin protection

In `bindHTTP` (`http.go:39`-`51`), between the MCP handler and the auth wrapper:

```go
protected := auth.RequireBearerToken(verifier, &auth.RequireBearerTokenOptions{AllowMissingExpiration: true})(handler)
mux.Handle(mcpPath, http.NewCrossOriginProtection().Handler(protected))
```

Per §1.5 the SDK applies none by default and its own doc comment names this wrapper as the
replacement. Loopback/DNS-rebinding protection is already on by default — leave
`DisableLocalhostProtection` alone.

### 4.2 Server timeouts

`http.go:54` becomes:

```go
s.http = &http.Server{
    Handler:           mux,
    ReadHeaderTimeout: 10 * time.Second,
    IdleTimeout:       120 * time.Second,
}
```

**`WriteTimeout` stays unset, deliberately:** the Streamable HTTP transport holds long-lived
server-to-client streams, and a write deadline would cut them mid-response. `ReadTimeout` likewise
stays unset (a slow client body on a long POST is not a threat on loopback; `ReadHeaderTimeout` is
the slowloris-shaped one). This narrows `docs/ARCHITECTURE.md:3720`'s open item to that stated
exception rather than closing it outright.

---

## 5. Persistence — `code_repos.mcp_enabled`

**Decision: a new column on `code_repos`, not a settings leaf.**

`migrations/0019_p67d_repo_map_access.sql`:

```sql
-- P67d: per-repository MCP access. 0 = not shared (the default for every existing row, and for
-- every future import) — nothing is exposed to an MCP client until a user grants it explicitly.
ALTER TABLE code_repos ADD COLUMN mcp_enabled INTEGER NOT NULL DEFAULT 0;
```

plus `{19, "p67d_repo_map_access", "0019_p67d_repo_map_access.sql"}` in `migrations/embed.go`'s
`names` (`:31`-`50`).

- `model.CodeRepo` (`storage/model/coderepos.go:8`-`15`) gains `McpEnabled bool \`json:"mcpEnabled"\``.
- `storage/repos/coderepos.go`: `codeReposSelectColumns` (`:10`) gains `mcp_enabled`,
  `scanCodeRepoRow` (`:18`) gains the scan target, `Create` (`:66`) inserts `0` explicitly, and one
  new method:

```go
func (r *CodeReposRepo) SetMcpEnabled(id string, enabled bool) error
```

**Why not a `codeIntel.mcpRepoIds: string[]` settings leaf:** `RemoveRepo` would leave orphan ids
behind, needing a pruning pass on every read; two sources of truth for one fact; and the grant would
survive a re-import of the same path under a new `code_repos.id` only by accident. The column makes
removal cascade in the same statement that drops the row, which is the correctness property that
matters for an access-control record.

**Why not keyed by `repo_id` instead of `id`:** `repo_id` is UNIQUE and would also work, but every
bound call in this area already addresses a repository by `code_repos.id` (`CodeWorkspaceIDArgs`),
and the renderer's `codeReposState` keys on it too. One addressing scheme, not two.

---

## 6. The bridge

### 6.1 Wire shapes (`internal/bridge/repomap.go`)

```go
type RepoMapStatus struct {
    Running         bool                `json:"running"`
    URL             string              `json:"url"`             // replaces Repo
    Command         string              `json:"command"`
    ClaudeAvailable bool                `json:"claudeAvailable"`
    Probed          []string            `json:"probed"`
    Error           string              `json:"error"`           // server-wide failure (bind) only
    Repos           []RepoMapRepoStatus `json:"repos"`
}

type RepoMapRepoStatus struct {
    ID      string `json:"id"`      // code_repos.id
    Name    string `json:"name"`    // code_repos.name
    Root    string `json:"root"`
    Key     string `json:"key"`     // what an MCP client passes as `repo`
    Enabled bool   `json:"enabled"` // the persisted grant
    Serving bool   `json:"serving"` // attached right now
    Ready   bool   `json:"ready"`   // initial sync finished
    Error   string `json:"error"`   // per-repo attach/sync failure; "" normally
}
```

`Repo` is deleted — nothing renders it (§1.6). `Repos` is built from `CodeRepos.List()` (every
imported repository, in the panel's own order) joined with `server.Repos()` by key, so the list is
complete whether or not the server is running and whether or not each row is granted.

### 6.2 `RepoMapService`

```go
type RepoMapService struct {
    Deps      appcore.Deps
    Installer RepoMapInstaller
    Discovery *gitclient.Discovery  // new — resolves the git executable, as CodeWorkspaceService does
    Runner    gitclient.Runner      // new
    Home      string                // new — test seam, mirrors CodeWorkspaceService.Home

    mu     sync.Mutex
    server *repomap.Server
}
```

| Method | Behaviour |
| --- | --- |
| `Status()` | unchanged contract, new shape; never starts or stops anything |
| `SetEnabled({enabled})` | writes `codeIntel.mcpServerEnabled`, emits `ChannelSettingsChanged`, then starts (and attaches every granted repository) or stops the server |
| `SetRepoEnabled({id, enabled})` | **new** — `CodeRepos.SetMcpEnabled`, then `Attach`/`Detach` if the server is running; returns the full `RepoMapStatus` |
| `Regenerate()` | unchanged, now against the app-scoped token file (§6.3) |
| `InstallClaudeCode()` | unchanged |
| `startIfEnabled` / `stop` | unchanged entry points (`StartRepoMapIfEnabled`/`StopRepoMap`, `repomap.go:172`-`173`), now attaching the granted set at boot |
| `OnRepoRemoved(id)` | **new**, unexported-from-the-wire hook — see below |
| `OnRepoRenamed(id, name)` | **new** hook — `Rekey` to the new derived key |

**`attachGranted` (shared by `SetEnabled`, `startIfEnabled` and `SetRepoEnabled`):**

1. `repos, err := s.Deps.Repos.CodeRepos.List()`; keep rows with `McpEnabled`.
2. One `s.Discovery.Status(ctx, settings.Git.GitPath)` for the whole batch — `KindOK` gives the git
   path; any other kind records the same error against every granted row and attaches none
   (`"git is unavailable: <kind>"`).
3. Derive keys (below), then `Attach` each. A per-row failure is logged and recorded in that row's
   `Error`; it never fails the others and never fails the server.

**Key derivation** (`repoKeys(rows []model.CodeRepo) map[string]string`): lowercase
`code_repos.name`, replace runs of anything outside `[a-z0-9._-]` with `-`, trim `-`, fall back to
`"repo"` when empty; on collision append `-2`, `-3`, … in list order. Deterministic for a given row
order, so a key is stable across restarts unless the user renames the repository — in which case
`OnRepoRenamed` re-keys the live instance and the next `Status` reports the new key.

**Removal and rename hooks.** `CodeWorkspaceService` gains two optional function fields,
`OnRepoRemoved func(id string)` and `OnRepoRenamed func(id, name string)`, called at the end of
`RemoveRepo` (`codeworkspace.go:178`-`188`) and `RenameRepo` (`:161`-`176`). `main.go` wires both to
`repoMapSvc`. Removal drops the row (so the grant is gone) **and** detaches the live instance
immediately — the revoke must not wait for a restart. Two service structs in one package, wired by
`main.go`, not referencing each other's types: the same shape `bridge.Sources` already uses for
event wiring (`main.go:280`).

### 6.3 D2 — the token lifecycle changes

Today: an explicit enable **always mints a fresh token** (`repomap.go:183`-`186`, C3 §0 D8), because
the token identified one repository and a re-enable was cheap to re-register.

**Decision: an explicit enable now uses `mcpauth.LoadOrMint`, not `Mint`.** The token is app-scoped
and one registration now covers every granted repository, so silently invalidating it on every
toggle-off-and-on breaks a working setup for a reason the user never asked for. The explicit
"Regenerate token" button (`SettingsDialog.vue:913`-`921`) stays exactly as it is and is the one way
to force a fresh token.

Consequence, and it is the existing UI's own already-handled case: after the first enable the
plaintext is unknown, so `Command` is empty and the tab shows the regenerate path (`:907`-`921`)
instead of a command. The copy there is updated (§7.4) to say the registration from last time is
still valid and regeneration is only needed if it was never registered.

**Token file:** `mcpauth.Path(home, "app")` → `<KIRA_HOME>/mcp-repo-map-app-token.json`. Distinct
from the headless binary's 12-hex-slug files by construction, so the two never collide and the dev
loop is untouched. `tokenProviderFor` (`repomap.go:82`-`98`) collapses into two call sites
(`LoadOrMint` on enable/boot, `Mint`+`Save` in `Regenerate`) and the `TokenProvider` type is deleted
with it.

### 6.4 `main.go`

- `:265` — construct with the two new fields:
  `&bridge.RepoMapService{Deps: deps, Installer: …, Discovery: gitDiscovery, Runner: gitRunner}`
  (both already exist at `:117`-`118`).
- `:275`-`278` — add the two hooks to the `CodeWorkspaceService` literal, pointing at `repoMapSvc`.
  `repoMapSvc` is declared at `:265`, before it, so no forward reference is needed.
- `:266` `StartRepoMapIfEnabled` and `:311` `StopRepoMap` are unchanged.
- The comment at `:271`-`274` (two `Store`s in one process) stays true and stays accurate: the
  embedded server still opens its own `Store`, now one for all attached repositories rather than one
  per repository.

---

## 7. The renderer

### 7.1 `packages/shared/domain/repomap.ts`

Mirror §6.1: add `repoMapRepoStatusSchema`, replace `repo` with `url`, add
`repos: z.array(repoMapRepoStatusSchema)`. Update the file's own header comment: the plaintext token
still appears exactly once, in `command`, and is still never persisted.

### 7.2 `frontend/src/bridge/index.ts`

After `:301`:

```ts
repoMapSetRepoEnabled: (id: string, enabled: boolean): Promise<RepoMapStatus> =>
  unwrap(RepoMapService.SetRepoEnabled({ id, enabled })).then((r) => trust<RepoMapStatus>(r)),
```

Then regenerate bindings — `wails3 task common:generate:bindings`, never a hand-typed flag list
(`docs/DEV_ENVIRONMENT.md:219`-`229`; `-names` is load-bearing). Add the matching entries to
`tests/ui/support/ipcChannels.ts` (`kira:repomap:setRepoEnabled`) and
`tests/ui/support/mockRuntime.ts` (`RepoMapService.SetRepoEnabled`).

### 7.3 `frontend/src/state/repomap.ts`

`DEFAULT_STATUS` gains `url: ''`, `repos: []`, loses `repo`. One new action, same instant-action
posture as `setRepoMapEnabled` (`:33`-`38`):

```ts
export async function setRepoMapRepoEnabled(id: string, enabled: boolean): Promise<void> {
  repoMapState.status = await control.repoMapSetRepoEnabled(id, enabled);
}
```

No `settingsState` write — the grant lives in `code_repos`, not in settings. `installResult` is left
alone: a grant change does not invalidate an existing registration (the same token, the same URL).

### 7.4 `SettingsDialog.vue`

Template branch `:865`-`924`, after the existing command/regenerate block and **below** it, so the
command-before-button DOM order the existing spec asserts is untouched:

```
<template v-if="settingsState.codeIntel.mcpServerEnabled">
  … existing error / command+install / regenerate blocks, unchanged …

  <h3 class="section-subhead">Repository access</h3>
  <p class="muted-note">
    An assistant can navigate only the repositories granted here. Nothing is shared by default.
  </p>
  <p v-if="repoMapState.status.repos.length === 0" class="muted-note" data-testid="repomap-repos-empty">
    No repositories imported yet. Import one from the Git module's panel.
  </p>
  <ul v-else class="repomap-repos-list" data-testid="repomap-repos-list">
    <li v-for="repo in repoMapState.status.repos" :key="repo.id"
        class="repomap-repo-row" :data-testid="`repomap-repo-row-${repo.id}`">
      <div class="repomap-repo-info">
        <span class="repomap-repo-name">{{ repo.name }}</span>
        <span class="helper-text mono">{{ repo.root }}</span>
        <span v-if="repo.error" class="field-error" :data-testid="`repomap-repo-error-${repo.id}`">{{ repo.error }}</span>
        <span v-else-if="repo.serving" class="helper-text">
          {{ repo.ready ? `Shared as “${repo.key}”` : 'Indexing…' }}
        </span>
      </div>
      <Checkbox :model-value="repo.enabled" :disabled="repoMapRepoToggling === repo.id"
                :data-testid="`repomap-repo-toggle-${repo.id}`"
                @update:model-value="(v) => onToggleRepoMapRepo(repo.id, v)" />
    </li>
  </ul>
</template>
```

Script, beside `repoMapToggling` (`:169`-`177`): `const repoMapRepoToggling = ref<string | null>(null)`
and `onToggleRepoMapRepo(id, enabled)` with the same try/finally shape. Import
`setRepoMapRepoEnabled` at `:20`-`25`.

Toggle helper text (`:879`-`883`) is rewritten — it currently says *"this checkout's code"*, which is
the very assumption this phase removes:

> Starts a local MCP server so an AI coding assistant can navigate your code (definitions,
> references, file outlines) from a pre-built index instead of reading every file. Grant it access
> to individual repositories below.

Styles: `.repomap-repos-list` / `.repomap-repo-row` / `.repomap-repo-info` / `.repomap-repo-name`,
copied from `.git-clients-list` / `.git-client-row` / `.git-client-info` / `.git-client-label`
(`:1214`-`1245`) with `align-items: center` kept and the info column allowed to wrap the root path.

**The list renders only while the toggle is on** — the user's own framing (*"If enabled … all
imported repos will be shown there"*), and it keeps the tab quiet when the feature is off. Grants
persist across off/on regardless, since they live in `code_repos`.

---

## 8. Security invariants this phase must hold

Stated explicitly because the toggle going general widens who can reach repository contents.

1. **Nothing is exposed by default.** `mcp_enabled` defaults to `0` for every existing and future
   row (§5). Enabling the server with no grants serves zero repositories and `list_repos` says so.
2. **Authentication is unchanged in shape and strength**: one static bearer token, 32 random bytes,
   `sha256(salt‖token)` at rest, mode `0600`, constant-time verify, fail-closed on a zero record
   (`mcpauth/token.go`, `repomap/http.go:62`-`72`). The only change is scope: one app-scoped file
   instead of one per repository (§6.3).
3. **Loopback only.** `127.0.0.1` with an ephemeral fallback (`http.go:31`-`37`) — never `0.0.0.0`.
   Plus DNS-rebinding protection (SDK default) and cross-origin protection (§4.1).
4. **The grant is the authorization boundary.** Only attached instances are reachable (§3.4 rule
   set); path containment is per instance (`relFile`, `pathsafe.ValidateRelPath`). No tool can read
   a path outside an attached root, and none can read across attached roots.
5. **Revocation is immediate.** `Detach` removes the instance before any drain, and `waitReady`
   wakes on `done` — an in-flight call finishes, the next one cannot resolve the repository. No
   restart, no caching layer in between.
6. **Disabling stops the listener.** `SetEnabled(false)` → `Server.Close` → the port is gone, not
   merely unlisted.
7. **The plaintext token is shown once, in `command`, and never persisted in the renderer** — no
   `localStorage`, no settings leaf. Unchanged from C3; re-verified against §7.1's new shape.
8. **Regeneration invalidates every previously registered client** — true before, now with a wider
   blast radius, which is exactly why §6.3 stops doing it implicitly.

---

## 9. Files

| File | Change |
| --- | --- |
| `internal/repomap/server.go` | `Server` reshaped; `Config` reshaped; `New` no longer resolves; per-repo methods move out |
| `internal/repomap/instance.go` | **new** — `repoInstance` + `runInitialSync` + `waitReady` + `close` |
| `internal/repomap/attach.go` | **new** — `RepoSpec`/`RepoInfo`/`Attach`/`AttachDir`/`Detach`/`Rekey`/`Repos`/`pick` |
| `internal/repomap/tools.go` | `repoField`; `pick`+`defer Done` in all 7 handlers; per-repo helpers re-receivered; `list_repos` |
| `internal/repomap/source.go` | 5 methods re-receivered to `*repoInstance`; bodies unchanged |
| `internal/repomap/http.go` | cross-origin wrapper, `ReadHeaderTimeout`, `IdleTimeout` |
| `internal/repomap/repo.go` | unchanged (now reached only from `AttachDir`); `ErrNoRepository` doc comment updated — it is no longer an embedded-instance failure mode |
| `internal/repomap/conformance_test.go`, `http_test.go`, `index_test.go` | harness updated to `New`+`Attach` |
| `internal/repomap/attach_test.go` | **new** — §10's two tests |
| `cmd/kira-repo-map/main.go` | `New` → `AttachDir` → `SetToken` (§3.6) |
| `internal/storage/migrations/0019_p67d_repo_map_access.sql` | **new** |
| `internal/storage/migrations/embed.go` | one `names` entry |
| `internal/storage/model/coderepos.go` | `McpEnabled` field |
| `internal/storage/repos/coderepos.go` | column in select/scan/insert; `SetMcpEnabled` |
| `internal/bridge/repomap.go` | rewritten: status shape, `SetRepoEnabled`, attach/detach orchestration, key derivation, token lifecycle |
| `internal/bridge/codeworkspace.go` | `OnRepoRemoved`/`OnRepoRenamed` hook fields, called from `RemoveRepo`/`RenameRepo` |
| `main.go` | `:265` two new fields; `:275`-`278` two hooks |
| `frontend/bindings/**` | regenerated |
| `packages/shared/domain/repomap.ts` | `url`, `repos`, `repoMapRepoStatusSchema` |
| `frontend/src/bridge/index.ts` | `repoMapSetRepoEnabled` |
| `frontend/src/state/repomap.ts` | defaults + `setRepoMapRepoEnabled` |
| `frontend/src/workbench/SettingsDialog.vue` | list markup, handler, copy, styles |
| `tests/ui/support/ipcChannels.ts`, `mockRuntime.ts` | one channel each |
| `tests/ui/settings-code-intelligence.spec.ts` | updated status fixture + one new case |
| `docs/ARCHITECTURE.md` | §11 |
| `CLAUDE.md` | §11 (tool count, twice) |
| `docs/v1.6/mcp-repo-map-issues.md` | dogfooding line for this phase |

---

## 10. Testing

`CLAUDE.md`'s bar is narrow — default to no dedicated unit test. Two earn their keep, both named by
the bar itself:

1. **`TestPickRepo`** (`attach_test.go`) — "a decision structure with several interacting rules":
   §3.4's five outcomes (none attached, one attached with an empty name, several with an empty name,
   exact/case-insensitive/by-root hit, no hit). One table test.
2. **`TestDetachDrainsInFlightCall`** (`attach_test.go`) — "concurrency (ordering, backpressure,
   cancellation, races)": a handler holding an instance while `Detach` runs must complete against a
   live index; a call arriving after must fail to resolve; `waitReady` must return promptly on
   `done` rather than after `readyTimeout`. Run under `-race`.

**Explicitly no dedicated test for:** the migration, `SetMcpEnabled` (a one-column update),
`repoKeys` (a short normalize-and-dedupe loop), the status projection, the settings patch, or any
bridge CRUD — every one of those is on the bar's own "gets nothing" list.

**Existing tests to update** (mechanical, not new coverage): `newConformanceServer`
(`conformance_test.go:20`-`47`) becomes `New` + a direct instance registration over the same seeded
`codeindex.Store`; `TestConformanceListToolsAndCallEach` (`:118`) asserts **eight** tools and passes
`repo` where it helps; `http_test.go` is unchanged apart from construction; `index_test.go`'s four
`waitReady` tests move to a `repoInstance`.

**UI** (`tests/ui/settings-code-intelligence.spec.ts`): update `ENABLED_STATUS` to the §6.1 shape
(`url`, `repos`, no `repo`) — the existing two cases then pass unchanged, which is the point of
adding the list *below* the command. One new case: with two repos in `repos` (one granted, one not),
both rows render, the checkboxes reflect `enabled`, and clicking the ungranted one calls
`RepoMapService.SetRepoEnabled` — asserted through the mock channel, since the Go side is not in the
loop here.

---

## 11. Documentation

- **`docs/ARCHITECTURE.md`**
  - `:1020`-`1027` ("Two independent instances…"): the embedded instance no longer resolves a
    repository from cwd; it serves the repositories granted in Settings, one instance per grant
    behind one listener and one app-scoped token. Note the token-file split (`-app-` vs. per-repo
    slug for the headless one).
  - `:3641`-`3647` (known open item, cwd resolution): **delete** — resolved by this phase, not
    marked done in place.
  - `:3667`-`3676` (double-parse when a repo is open in the workspace and served by MCP): keep,
    and widen one sentence — it is now reachable for any granted repository, not just the one that
    happened to match the cwd.
  - `:3720` (no HTTP timeouts): rewrite to the narrowed form §4.2 leaves — `ReadHeaderTimeout` and
    `IdleTimeout` set, `WriteTimeout`/`ReadTimeout` deliberately unset for the streaming transport.
  - Add the `code_repos.mcp_enabled` column where C5's schema is described.
- **`CLAUDE.md`** — the "Repo-map MCP server" section names the tool set twice ("served as MCP
  tools: …" and "The same seven tools as the native surface: …"). Both gain `list_repos` and the
  count becomes eight. Nothing else in that section changes: the dev loop, the token file naming for
  the headless server and the curl transport note all stay true.
- **`docs/v1.6/mcp-repo-map-issues.md`** — one line for this phase (see §14.3).

---

## 12. Sequencing

One Sonnet subagent, sequential — the pieces are strictly order-dependent (the Go server must
multiplex before the bridge can attach anything). Commits, in order:

1. `refactor(repomap): split Server into a transport and per-repository instances` — §3.1-§3.3, the
   headless binary (§3.6), existing tests updated. Builds and passes on its own.
2. `feat(repomap): serve several repositories from one server` — §3.4-§3.5, `attach_test.go`.
3. `fix(repomap): apply cross-origin protection and header timeouts to the MCP listener` — §4.
4. `feat(storage): record per-repository MCP access on code_repos` — §5.
5. `feat(repomap): make the Code intelligence toggle general, with per-repository access` — §6,
   `main.go`, bindings regenerated.
6. `feat(settings): list imported repositories with per-repository MCP access` — §7.
7. `test(settings): cover the per-repository MCP access list` — §10's UI half.
8. `docs(architecture): P67d — general repo-map enablement and per-repository access` — §11.

Fast checks (`go build`, `go vet`, `bun run typecheck`, `bun run lint`) per commit; the UI suite once
near the end, per `CLAUDE.md`.

---

## 13. Explicitly out of scope

- **Merging `repomap`'s per-repo index with `codeworkspace.Session`'s.** A repository both open in
  the Git module and granted to MCP keeps two `codeindex.Index` instances and two watchers — the
  existing, documented trade-off (`ARCHITECTURE.md:3667`). Unifying them couples two independent
  lifecycles and would drag the headless binary into `codeworkspace`.
- **Auto-granting.** Importing a repository never grants it; enabling the server never grants
  anything. Fail-closed, always explicit.
- **Importing a repository from the Settings dialog.** The Git module owns import (P67b); the tab
  points at it.
- **Finer-grained permissions** — per-tool, read-only-subsets, path-scoped grants within a
  repository. One grant per repository, all eight tools.
- **Non-git directories.** `codeindex` enumerates through `git ls-files`
  (`codeindex/enumerate.go:25`), so a granted repository is always a git worktree.
- **Any MCP client other than Claude Code.** `mcpinstall` is unchanged (C3 §0 D6).
- **A user-configurable or sticky port, TLS, or any non-loopback bind.** The default-then-ephemeral
  behaviour is unchanged; if the port moves across restarts the tab shows the current URL and the
  user re-registers. OQ-4.
- **`tools/list_changed` notifications.** The tool set is static; only `list_repos`' output changes
  (§3.5).
- **Surfacing server state outside the Settings tab** (status bar, Git panel badge).
- **Retiring the headless server or its per-repository token files.** `CLAUDE.md`'s dev loop is
  untouched.

---

## 14. Verification

### 14.1 Mechanical

```
go build ./... && go vet ./...
go test ./apps/kira-studio/internal/repomap/... -race
go test ./apps/kira-studio/internal/storage/... ./apps/kira-studio/internal/bridge/...
wails3 task common:generate:bindings      # never a hand-typed flag list
bun run typecheck && bun run lint && bun run build
bun run test:ui -- settings-code-intelligence
```

### 14.2 Manual recipe

The desktop shell can't be driven from this container (`docs/DEV_ENVIRONMENT.md` — `wails://` is
intercepted in-process on Linux); use the `-tags server` build it documents, or a real macOS run.

1. Start the app with at least two repositories imported in the Git module.
2. Settings → Code intelligence. Toggle on. **Expect:** no
   `no repository found for this working directory`; a registration command (first enable) or the
   regenerate note (later enables); a "Repository access" list with every imported repository, all
   unchecked.
3. Grant one. **Expect:** the row shows `Indexing…`, then `Shared as "<key>"`.
4. With the token from the command:
   ```
   curl -s <url> -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_repos","arguments":{}}}'
   ```
   **Expect:** exactly the granted repository. Then `search_symbols` with `{"query":"…"}` and no
   `repo` — resolves by rule 1. Then grant the second repository and repeat without `repo` —
   **expect** the ambiguity error naming both keys; with `"repo":"<key>"` — expect real results.
5. Revoke one **while** a call is in flight (a `find_references` on a large symbol). **Expect:** the
   in-flight call returns normally; the next call with that key is refused immediately.
6. Toggle off. **Expect:** the port stops answering (`curl` connection refused). Toggle on again:
   **expect** the same token still works (§6.3) and the previously granted repositories re-attach.
7. Remove a granted repository from the Git panel. **Expect:** it disappears from the list and from
   `list_repos` immediately; re-importing it comes back ungranted.
8. Wrong/missing token, and a request with `Host: evil.example` → 401 / 403.

### 14.3 Checklist

- [ ] Enabling with a packaged-app cwd starts the server (the reported bug is gone).
- [ ] Every imported repository is listed; grants persist across restart.
- [ ] One command registers one server covering every granted repository; a later grant needs no
      re-registration.
- [ ] Revoke and remove both detach immediately; in-flight calls are not truncated.
- [ ] No tool can reach a path outside an attached root, or across attached roots.
- [ ] `-race` clean; the drain test proves no use-after-close.
- [ ] Headless `bun run mcp:repo-map` behaves exactly as before, same token file name.
- [ ] `docs/ARCHITECTURE.md:3641`-`3647` deleted; `CLAUDE.md`'s tool list says eight.
- [ ] A dogfooding line added to `docs/v1.6/mcp-repo-map-issues.md`.

---

## 15. Open questions for a human

**OQ-1 — an eighth tool.** §3.5 adds `list_repos` because `instructions` is fixed at construction
while the attached set is not. It changes the documented tool count in two `CLAUDE.md` sentences.
*Recommendation: add it. Without it an agent has to guess repository names from an error message,
which is a worse first-call experience than one cheap listing tool.*

**OQ-2 — keys derived from user-editable names.** §6.2 derives the `repo` argument from
`code_repos.name`, with a dedupe suffix, and re-keys on rename. A stable alternative is the
repository's `id` (a UUID), which no human would want to type. *Recommendation: keep name-derived
keys; the rename hook keeps them honest and `list_repos` is authoritative.*

**OQ-3 — an enable no longer mints a fresh token** (§6.3, a deliberate change to C3 §0 D8). The
upside is that a working registration survives toggling; the downside is that after the first enable
the tab shows the regenerate note rather than a copyable command, which reads as less immediate.
*Recommendation: make the change — an app-scoped token covering every granted repository is exactly
the thing that should not be invalidated by an off/on. If it feels wrong in use, the alternative is
one extra line, not a redesign.*

**OQ-4 — the port can move between runs.** If something else holds 8765 the server takes an
ephemeral port and a previously registered client points at nothing. Fixing it properly means
persisting the chosen port and preferring it next launch. *Recommendation: out of scope here — the
tab shows the live URL and the Install button re-registers in one click. Worth its own row if users
hit it.*

**OQ-5 — the list renders only while the toggle is on** (§7.4), matching the user's own sentence.
An always-visible list would let someone pre-grant before enabling. *Recommendation: keep it gated;
a list of toggles that do nothing yet is the more confusing of the two.*

**OQ-6 — double indexing of a repository that is both open and granted** (§13, the existing
`ARCHITECTURE.md:3667` item). Previously nearly unreachable; now a normal configuration.
*Recommendation: leave it — it is one extra parse per save, not per keystroke — but if a chapter ever
unifies the two index lifecycles, this is the row that should trigger it.*
