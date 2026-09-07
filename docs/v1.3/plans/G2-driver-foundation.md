# G2 — Driver foundation: streaming runner, watcher, and the refcounted session registry

> **What this phase is.** The second phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> one that closes every gap between G1's deliberately minimal read-only `gitclient` subset and what
> SPEC §2's package table and §6's concurrency/session model actually require. It covers upstream's
> P1 (Git driver) in full.
>
> **In one line: `gitclient`'s runner is rewritten around a streaming `Start()` primitive with the
> full env/argv hygiene set and a real graceful group kill; discovery grows a probe timeout;
> `gitclient` gains an `fsnotify` repo watcher; a new `internal/gitsession` package owns the
> refcounted `Registry`/`RepoEntry`/`Conn` SPEC §6 specifies, with debounced, per-connection
> coalescing fan-out of `repo.changed`; and `rpcstream` finally exposes the session handle that
> makes emitting an event from production code possible at all.**
>
> **The SPEC is authoritative and is not re-litigated here.** The `Registry`/`RepoEntry`/`Walk`
> split, the shared-vs-private rule, the watched path set, the 200 ms debounce, the
> coalescing-per-connection fan-out, the refcounted teardown and the package layout are all settled
> in `docs/v1.3/SPEC.md` §2 and §6. This plan is the *how*: the exact Go types, the exact
> classification rules, the exact commit sequence, and the exact proof.
>
> **Three places where a literal reading of the SPEC collides with something else the SPEC says, or
> with what the code can actually do, are called out and resolved explicitly, with evidence** — the
> worktree watch (§2 F11 / D9), the "hidden-eviction grace period" the server side does not have
> (§2 F14 / D12), and what "capabilities" still owes after G1's port (§2 F17 / D16). None is a
> deviation from a settled decision; each is a boundary the chapter spec did not draw, drawn here.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`40dc1627`, nine
commits past `origin/claude/feature-v1-2`: the whole of G1). Every claim below was checked against
source read in this container, never against prose — including G1's own plan, which is a *record of
intent* and is verified against the code it produced rather than trusted.

| Claim | Evidence |
|---|---|
| G1 landed in full: `rpcstream`, the read-only `gitclient` subset, `git_clients`, `gitsock`, `gitrpc`, the *Connected editors* pane, and the migrated extension | `git log --oneline`: `269b354f`…`40dc1627`; `ls apps/kira-studio/internal/` shows `gitclient/`, `gitrpc/`, `gitsock/`; `ls packages/` shows `git-core`, `git-ipc`, `git-ui`; `ls apps/kira-studio-vscode/src/` shows `connection.ts`, `extension.ts` |
| `gitclient` is 13 files; **`watcher.go` is absent**, exactly as G1 D10 promised | `wc -l apps/kira-studio/internal/gitclient/*` → `capabilities.go` 68, `capabilities_test.go` 87, `client.go` 63, `clock.go` 19, `discovery.go` 268, `discovery_test.go` 293, `errors.go` 110, `errors_test.go` 91, `repo.go` 302, `repo_test.go` 459, `runner.go` 131, `runner_test.go` 97, `settings.go` 30 |
| `runner.go` buffers to `[]byte` and has no streaming entry point at all | `runner.go:46-54` — `Runner` is one method, `Run(ctx, gitPath, spec) (Result, error)`; `:114-130` — `var stdout, stderr bytes.Buffer`, `cmd.Run()`, `Result{Stdout: stdout.Bytes(), …}` |
| `runner.go`'s hygiene is a strict subset of upstream's | `runner.go:69` — `hygieneEnv = []string{"GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0"}`; `:85-93` `buildArgv` emits `-c core.quotepath=false` and, for a read, `--no-optional-locks`. Upstream `driver.ts:30-39` has **four** `-c` overrides, `:81` adds `--no-pager`, and `:53-75`'s `buildGitEnv` additionally sets `GIT_PAGER=cat`, `GIT_EDITOR=true`, `LC_ALL=C` |
| `runner.go`'s graceful-kill comment describes behaviour the code does not have | `runner.go:107-112` claims "graceful-then-forceful stop on cancellation" while leaving `cmd.Cancel` at `exec.CommandContext`'s default. `$(go env GOROOT)/src/os/exec/exec.go:495-505`: `CommandContext` sets `cmd.Cancel = func() error { return cmd.Process.Kill() }` — SIGKILL, immediately. `exec.go:289-314`'s `WaitDelay` doc: the delay bounds *waiting*, and escalates to `Process.Kill` only "if the child process has failed to exit … because no Cancel function was set". A SIGKILL'd child has already had no grace |
| Nothing in this repo spawns git in its own process group | `grep -rn "Setpgid" --include=*.go apps/kira-studio` → one hit, `internal/preconnect/supervisor.go:130`, which is the pre-connect script supervisor, not git |
| Discovery's `--version` probe has no timeout | `discovery.go:247` — `d.runner.Run(ctx, path, Spec{Args: []string{"--version"}, ReadOnly: true})`, with whatever `ctx` `app.init` handed it. Upstream `discovery.ts:252` — `const DEFAULT_VERSION_TIMEOUT_MS = 5000`, `:160-172` aborts and returns `unusable` with `reason: "git version did not respond within …"` |
| `gitclient.Error`'s message is the whole trimmed stderr | `errors.go:41-49` — `if e.Stderr != "" { return strings.TrimSpace(e.Stderr) }`. Upstream `errors.ts:83-84` — `const summary = stderr.trim().split("\n")[0] \|\| ...; super(\`git ${argv.join(" ")} failed (${kind}): ${summary}\`)`, and `rpc.ts:49-52` states "Raw stderr never crosses" |
| A classified `gitclient.Error` reaches the client as `E_INTERNAL` with no kind | `rpcstream/frame.go:48-54` — `wireErrorFrom` maps `*ipcerr.Error` across and folds everything else to `E_INTERNAL`. `internal/ipcerr/errors.go` has `Code`, `Message`, `Details` — no kind. `gitrpc/handlers.go:66` returns `deps.Client.OpenRepo(...)`'s error unwrapped |
| `gitclient.Registry` is a plain map with no refcount and no teardown | `repo.go:146-200` — `Registry{runner, mu, repos map[string]*Repo}`, `Open` (identify, dedupe by `RepoID`, insert), `Get`, and `Close(repoID) bool` whose own comment says "No process, handle or lock needs releasing … this only stops Get from finding it again" |
| `repo.close` from **any** connection evicts the entry for **every** connection | `gitrpc/handlers.go:69-79` → `deps.Client.CloseRepo(p.RepoID)` → `client.go:61-63` → `Registry.Close`. There is one global registry (`main.go:98`, one `gitclient.NewClient`) and one shared `gitrpc.Handlers` value (`main.go:103`), so nothing is per-connection |
| The reader/writer gate exists, is correct, and has real tests | `repo.go:49-134` — `Repo.Write`/`Repo.Read` over a broadcast-and-recheck `waitCh`, bounded at `maxConcurrentReads = 4` (`:37`); `repo_test.go:25-…` covers serialisation, queueing without loss, bounded concurrency and cancellation |
| `rpcstream` cannot emit an event from production code | `session.go:97-103` — `Emit` is a method on the **unexported** `session`; `:229-239` — `func Serve(conn Conn, h Handlers)` returns nothing. `grep -rn "rpcstream\." --include=*.go apps/kira-studio` (non-test) → the only call is `gitsock/server.go:178`'s `rpcstream.Serve` |
| `rpcstream`'s `evt` frame is already encoded correctly and already proven to cross | `frame.go:24-36` — `frame` carries `Payload json.RawMessage`; `session.go:97-103` marshals it; `session_test.go:47-59` `TestSession_Emit_EventCrosses` drives it end to end |
| `repo.changed` is **already** in the contract on both sides — no wire change is needed | `packages/git-ipc/src/validate.ts:96` — `'repo.changed': true` in `EVENT_KEY_MAP`; `packages/git-ipc/src/contract.ts:1094` — `'repo.changed': { repoId: string; kind: 'refsChanged' \| 'worktreeChanged' }`; `packages/git-ipc/src/rpc.ts:195-199` — the client's `evt` arm validates the payload shape and fans it to `on()` handlers |
| `gitsock` builds one shared handler table and one `rpcstream` session per connection | `server.go:161-183` — `handleConn` runs `runHandshake`, registers the `net.Conn` under its client id, then `rpcstream.Serve(c, rpcstream.Handlers{ContractVersion, Request: s.deps.Handlers.Request, Stream: s.deps.Handlers.Stream})` |
| The handshake already mints a per-connection id and throws it away | `handshake.go:100-104` and `:160-163` — `SessionID: uuid.NewString()` is sent in `ready` and never returned to the caller |
| The layering test exempts `internal/gitsock` and nothing else in the git family | `internal/layering_test.go:29-43` — `packagesExemptFromBridgeCheck` is `internal`, `internal/bridge`, `internal/ipcfixture`, `internal/shell`, `internal/bridge/rpcstream`, `internal/gitsock`. The set is enumerated from `go list`, so a new `internal/gitsession` is covered automatically and must **not** import `internal/bridge` |
| `fsnotify` is not a dependency of this repo | `grep -rn fsnotify go.sum` → nothing. `go list -m -versions github.com/fsnotify/fsnotify` resolves through the proxy; latest is `v1.10.1` |
| `fsnotify` needs no new indirect dependency | `$(go env GOMODCACHE)/github.com/fsnotify/fsnotify@v1.10.1/go.mod` requires only `golang.org/x/sys`, already in this repo at `go.mod:119` (indirect) |
| `fsnotify` has **no** recursive watch | `fsnotify.go:503` — `var enableRecurse = false` with the comment "Only enabled in tests for now"; `Add`'s own doc (`fsnotify.go:322-341`) — "Subdirectories are not watched (i.e. it's non-recursive)" |
| On macOS, `fsnotify` opens a file descriptor per file in every watched directory | `backend_kqueue.go:581-620` — `watchDirectoryFiles` `ReadDir`s the directory and calls `internalWatch` (`:672-680`) for every entry, each of which is an `unix.Open` (`:398`) |
| `notify.Emitter[T]` already exists and calls subscribers with the lock released | `internal/notify/notify.go:16-51` |
| The e2e tier gives a per-test `KIRA_HOME` and a real `-tags server` binary; the Go integration test already speaks the real wire | `tests/e2e-real/fixtures.ts:60-72`, `:121-156`; `internal/gitsock/integration_test.go:24-38` (the `lookPathLocator` seam), `:66-159` (a hand-written framing client), `:161-198` (a real `storage.Open` + `Server.Start`), `:200-221` (a `git init` fixture repo) |
| This container's git clears the 2.38 floor and inotify works here | `git --version` → `2.43.0`; `internal/gitclient/capabilities_test.go` already drives real `git` against `t.TempDir()` repos |
| Discovery answers a *correct* non-`ok` status on Linux, which is why no repo can be opened in a `-tags server` build here | `discovery.go:130-146` — `unsupportedLocator` returns `("", ["git discovery is not implemented on linux yet"], false)` for every non-darwin `GOOS`; `client.go:44-47` short-circuits `OpenRepo` on `Status().Kind != "ok"` |

**Upstream baseline** (`/home/user/vlad-cirstean/kira-version-vscode`, `claude/start-p2-gwlgly`):

| Claim | Evidence |
|---|---|
| The driver's `read()` is a live pipe, not a buffer | `driver.ts:342-432` — `read()` returns `GitRead{bytes: AsyncIterable<Uint8Array>, records(delimiter), done, cancel}`; `:130-138` is the interface |
| A read holds one of four bounded pool slots for its whole life | `driver.ts:212` `DEFAULT_READ_CONCURRENCY = 4`; `:250-278` `Pool`; `:350-364` acquire-then-spawn, released on `proc.exit` |
| The two long-lived processes deliberately spawn **outside** that pool | `logSession.ts:1-18` — "Spawned like `catFile.ts`, not through `driver.read()`: a paused session is, by design, held open for the life of the panel, and `driver.read()` acquires one of the bounded read pool's slots"; `logSession.ts:338`/`:353` and `catFile.ts:235-248` call `runner.spawn` directly |
| `cat-file --batch` needs a writable stdin | `catFile.ts:237-247` spawns with the runner's `stdio: ["pipe","pipe","pipe"]` and drives it through `SpawnedProcess.write` (`nodeProcessRunner.ts:91-93`) |
| The spawn is process-group-detached, and kill signals the group | `nodeProcessRunner.ts:196-204` — `detached: true`; `:95-107` — `kill()` sends SIGTERM to the group and escalates to SIGKILL after `SIGKILL_GRACE_MS = 2000` (`:11`); `:110-127` — `killGroup` explains why: a grandchild holding the stdout pipe open never emits EOF and hangs the reader forever |
| stderr is bounded and teed | `nodeProcessRunner.ts:129-163` — `MAX_STDERR_BYTES = 1024*1024` (`:12`) with a `"\n…[stderr truncated]"` marker (`:13`), and an `onStderr` tee that sees every chunk ahead of truncation |
| The watcher watches **directories**, never individual ref files | `watcher.ts:1-12`'s module doc; `nodeFileWatcher.ts:1-11` — "A watch on a file git replaces atomically … can silently stop firing once the original inode is gone, so `watcher.ts` watches directories, not individual ref files" |
| The watched set, the `.lock` rule and the classification are explicit | `watcher.ts:33-46` `REF_ISH_NAMES` = HEAD, packed-refs, FETCH_HEAD, MERGE_HEAD, rebase-merge, rebase-apply, CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_LOG, sequencer; `:52-54` `stripLockSuffix`; `:56-77` `classify` — `refs/` prefix → `refsChanged`, `gitDir/index` → `worktreeChanged`, a ref-ish name in **either** `commonDir` or `gitDir` → `refsChanged` |
| The debounce is a 200 ms window measured from the **first** event, not a trailing reset | `watcher.ts:29` `DEFAULT_DEBOUNCE_MS = 200`; `:118-137` — `windowStart` is set once on the first event and `check()` reschedules for the true remaining delay |
| Upstream never watches the worktree tree | `watcher.ts:144-167` — the only two subscriptions are `commonDir/refs` (recursive) and a flat list of `commonDir`, `gitDir`, `refs/heads`, `refs/tags`, `refs/remotes`. `worktreeChanged` is produced solely by `<gitDir>/index` (`:62`) |
| A watcher signal invalidates shared repo caches and then fans out | `repoService.ts:3265-3274` — `#handleSignal` sets `staleReason`, clears `detailCache`, drops `refsCache`, then calls every change listener with `{repoId, kind}` |
| The hidden-eviction grace period is a **host visibility** concept, not a refcount one | `repoService.ts:716` `HIDDEN_EVICT_MS = 5 * 60 * 1000`; `:1182-1192` `setUiVisible(false)` pauses the watcher and arms the timer; `:3542-3560` `#evict` resets the session and pauses the watcher. `close(repoId)` (`:989-1000`) is immediate and unconditional — there is no grace period on it |
| Upstream's registry is one session per repo with no refcount at all | `repoService.ts:972-987` `open()` returns the existing session if `#sessions` already has one; `:989-1000` `close()` deletes and disposes it outright |
| Per-binary capabilities are version comparisons; per-repo ones are filesystem/config facts keyed by the driver's write generation | `capabilities.ts:1-10`'s module doc, `:28-41` `FLOORS`/`capabilitiesForVersion`, `:43-57` `RepoCapabilities` |

### 0.2 Scope

1. Rewrite `gitclient/runner.go` around a streaming `Start()` primitive, with `Run` re-expressed as
   a thin buffered wrapper over it — one spawn path, not two (§3.1, D1–D4).
2. Complete the env/argv hygiene set to upstream's (§3.1, D2).
3. Give discovery a bounded `--version` probe (§3.2, D5).
4. Make a classified git failure survive the trip to the client as a code, and stop shipping whole
   stderr walls as an error message (§3.3, D6).
5. Add `gitclient/watcher.go`: an `fsnotify`-backed per-repo watcher, directory-only, `.lock`-aware,
   200 ms leading-window debounce, producing `refsChanged`/`worktreeChanged` (§3.4, D7–D11).
6. Build `internal/gitsession`: `Registry` with refcount + linger, `RepoEntry` (shared repo state +
   watcher + coalescing subscriber fan-out), `Conn` (per-connection holds and event delivery)
   (§3.5, D12–D15).
7. Expose `rpcstream`'s session so a server can emit an event at all (§3.6, D17).
8. Rewire `gitrpc` to per-connection handlers over the new registry, without changing the wire
   contract (§3.7, D18).
9. Rewire `gitsock` to build a `gitsession.Conn` per accepted connection, deliver `repo.changed`
   over it, and tear it down on disconnect (§3.8, D19).
10. Prove it (§7).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G2 work:

- **Any porcelain parsing, and the golden fixture corpus.** `gitclient/porcelain` is not created.
  G3.
- **The paged log session, `cat-file --batch`, the commit store, `graph.stream`.** G2 builds the
  runner primitive they sit on and nothing else. G3.
- **FlatBuffers, `gitWire.fbs`, `internal/gitwire`.** G3.
- **`Handlers.Stream`'s emitter.** G1 §11 hands this to **G3** explicitly (a stream cannot carry a
  chunk until the signature widens). G2 needs *events*, not *chunks*, and events already encode
  correctly (§0.1). Widening `Stream` here would be code with no caller.
- **Any write operation.** `Repo.Write` still has no caller after G2. The write queue is proven by
  `repo_test.go`'s existing concurrency tests, not by a real `git` write. G5.
- **The per-connection `Walk`.** SPEC §6's `Conn.walks` field. G6 (G1 §10 already assigns it).
- **The extension-side `repo.changed` consumer.** `packages/git-ui` renders it through the two
  webview view providers, which `activate()` deliberately does not register until G3 (G1 D13).
  **G2 changes no TypeScript at all** (§4).
- **Capability version floors and the two capability caches.** D16.
- **Server-owned settings** (`protectedBranches`, `fetch.autoInterval`, `git.path`). SPEC's
  Settings-ownership section; G7.
- **`setUiVisible`/host-visibility-driven eviction and auto-fetch.** Not in the contract's request
  set (`validate.ts:59-93` has neither); upstream's are in-process host calls. G7 owns auto-fetch.
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule: a chapter spec is not
  retro-edited by a phase. Everything this plan settles that the SPEC left open is settled *here*.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or run here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out of this phase is left out *entirely*. This is why `Spec` grows no
  `Stdin`/`Env` fields (§10), why no capability cache is added (D16), and why the `Stream` emitter
  stays G3's.
- **Comments very concise, only where the code cannot say it itself.**
- **Tests only where `AGENTS.md`'s bar is met** — concurrency (ordering, backpressure, cancellation,
  races), cache/eviction rules with interacting conditions, boundary arithmetic, a decision
  structure too large to hold in your head. G2 clears that bar in exactly four places: the streaming
  runner's cancellation/kill path, the watcher's classification + debounce, the registry's
  refcount × linger × re-acquire interaction, and the subscriber fan-out's coalescing under a slow
  consumer. Nothing else gets a dedicated test.
- **Reach for a library before hand-rolling** (`AGENTS.md`). D7 records where that rule is applied
  (`fsnotify`) and D8/D10 record where it declines, with the requirement named.
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§6).

---

## 1. Findings

### F1 — The runner rewrite is not optional and not cosmetic: there is no way to read incrementally today

`Runner` is a single method returning a fully-buffered `Result` (`runner.go:46-54`), and
`execRunner.Run` assembles it with `bytes.Buffer` + `cmd.Run()` (`:114-130`). Every consumer G3
brings — `git log`'s paged walk (`logSession.ts`), `cat-file --batch` (`catFile.ts`), a 100k-commit
`--format` stream — is defined by *not* buffering: upstream's `GitRead` (`driver.ts:130-138`) hands
back an `AsyncIterable<Uint8Array>` and a `records(delimiter)` view over it, and the paged walk's
entire mechanism is "read `pageSize` records, then stop reading and let the OS pipe buffer apply
backpressure" (`logSession.ts:1-18`).

There is no way to express that over `Run`. SPEC §2 already states the conclusion —
*"`runner.go` is rewritten, not reused"* — and G1 D10 deferred it here verbatim.

### F2 — The current spawn's "graceful kill" comment is not true of the code

`runner.go:107-112` sets `cmd.WaitDelay = gracefulStopDelay` and comments that this "buys the grace
period regardless" of `Cancel`'s behaviour. It does not. `exec.CommandContext`
(`$(go env GOROOT)/src/os/exec/exec.go:495-505`) installs `cmd.Cancel = func() error { return
cmd.Process.Kill() }` — an unconditional SIGKILL the instant `ctx` is done. `WaitDelay`'s own
documentation (`exec.go:289-314`) is explicit that its escalation to `Process.Kill` only applies "if
the child process has failed to exit — perhaps because it ignored or failed to receive a shutdown
signal from a Cancel function, **or because no Cancel function was set**". With the default
`Cancel`, `WaitDelay` bounds only the pipe-drain, never the process's life.

So today, cancelling a `repo.open` mid-flight SIGKILLs git with no chance to unwind. That is
tolerable for `rev-parse` and intolerable for anything that holds `index.lock` — which is exactly
what G5's writes will. Fixing it is one line (`cmd.Cancel = SIGTERM to the group`) and belongs to
the phase that owns spawn discipline.

### F3 — git forks children, and killing only the direct child can hang a reader forever

Upstream spawns `detached: true` and kills the *group* (`nodeProcessRunner.ts:196-204`, `:110-127`),
and its own comment names the failure precisely: a grandchild that outlives the child keeps the
stdout pipe open, so the pipe never reaches EOF and "any reader hangs forever". Real `git` does fork
grandchildren — `git fetch`/`git push` spawn `ssh`, `git-remote-https` and credential helpers.

This repo already has the Go idiom for it: `internal/preconnect/supervisor.go:130`
(`cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}`) with a `killSignal` var (`:52`) and a
`killGrace` of 2 s (`:44`). Nothing in `gitclient` does this today.

The consequence is much sharper once reads stream: a buffered `cmd.Run()` at least returns when the
child exits, because Go's `Cmd` copies into a `bytes.Buffer` from a goroutine it also reaps. A
caller holding an `io.ReadCloser` over the raw pipe has no such backstop.

### F4 — The hygiene set is a strict subset of upstream's, and three of the four gaps break later phases silently

`runner.go:69`/`:85-93` supply `core.quotepath=false`, `--no-optional-locks` (reads only),
`GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0`. Upstream (`driver.ts:30-39`, `:53-75`, `:80-84`)
additionally supplies:

| Missing | What it prevents | First phase that breaks without it |
|---|---|---|
| `-c color.ui=false` | a user's `color.ui=always` injecting ANSI escapes into porcelain | G3 (every parser) |
| `-c log.showSignature=false` | a user's `log.showSignature=true` injecting PGP blocks into `git log`'s record framing | G3 (the log record splitter) |
| `-c i18n.logOutputEncoding=UTF-8` | commit text arriving in the repo's own configured encoding | G3 |
| `--no-pager` + `GIT_PAGER=cat` | git paging into a pager that does not exist | any long output |
| `LC_ALL=C` | a translated git making **every** stderr classification `Unknown` | **G2 itself** — `errors.go:63-77`'s `notARepoNeedles`/`permissionNeedles` are English substring matches |
| `GIT_EDITOR=true` | `merge --continue`/`cherry-pick --continue`/`tag -a` blocking on an editor that does not exist, and — worse per upstream's own probe P6 (`driver.ts:61-69`) — leaving `MERGE_HEAD` in place so the operation never finishes | G5 |

`LC_ALL=C` is the one that is already load-bearing: this phase's own error classification is a
substring match against English git output, and nothing today guarantees English.

These are a fixed constant set on one code path, not speculative feature code — SPEC's G2 row names
"env/argv hygiene" as this phase's deliverable, and the whole point of a single spawn path
(`driver.ts:1-10`) is that no call site can be missing part of it.

### F5 — Discovery can hang indefinitely on the exact macOS trap `discovery.go` exists to route around

`discovery.go:94-128`'s probe order ends at `/usr/bin/git` — the Xcode Command Line Tools shim —
gated on `xcode-select -p` (`:90-92`). That gate is the right defence against the shim *prompting*.
It is not a defence against the shim, or any other candidate, simply not answering: `discovery.go:247`
runs `--version` under whatever `ctx` reached it, and `gitrpc.handleAppInit` (`handlers.go:50-56`)
hands it `rpcstream`'s per-request context, which has no deadline (`session.go:120` —
`context.WithCancel(context.Background())`).

So a wedged git binary wedges `app.init` for as long as the extension is willing to wait, with a
30 s cache (`discovery.go:195`) that never gets a value to cache. Upstream bounds this at 5 s and
reports `unusable` with a named reason (`discovery.ts:160-172`, `:252`).

### F6 — A classified git error reaches the extension as an anonymous `E_INTERNAL`

`gitclient.Classify` (`errors.go:79-110`) produces a five-member closed vocabulary
(`notARepository`, `permissionDenied`, `cancelled`, `timeout`, `unknown`). `gitrpc` returns those
errors unwrapped (`handlers.go:66`), and `rpcstream.wireErrorFrom` (`frame.go:48-54`) folds anything
that is not an `*ipcerr.Error` into `{code: "E_INTERNAL", message: err.Error()}`.

Two consequences:

1. **The classification is thrown away at the boundary.** `packages/git-ipc/src/rpc.ts:59-69`'s
   `RpcError` exposes `code` and `kind`; the Go side populates neither meaningfully. G3+ has nothing
   to branch on.
2. **The whole of git's stderr crosses as the message.** `errors.go:41-49` returns
   `strings.TrimSpace(e.Stderr)`. Upstream deliberately sends only a one-line summary
   (`errors.ts:83-84`) and says so where the wire type is declared (`rpc.ts:49-52`: "Raw stderr never
   crosses"). A hook-rejected push's stderr is routinely tens of lines; a `RpcError.message`
   carrying all of it is what upstream designed against.

Both are driver-surface facts, and this is the phase that owns the driver's error surface.

### F7 — There is exactly one registry, it is global, and `repo.close` from one window closes the repo for every window

`main.go:98` constructs one `gitclient.Client`; `client.go:27-33` gives it one
`gitclient.NewRegistry`; `main.go:103` builds one `gitrpc.Handlers` value and `gitsock/server.go:178`
hands the identical `Request` closure to every connection's `rpcstream.Serve`.

`Registry.Close(repoID)` (`repo.go:192-200`) deletes the entry unconditionally. So with two VS Code
windows open on the same repository, the first to send `repo.close` evicts it for both — and SPEC's
opening line for §6 is *"A real, load-bearing requirement: multiple simultaneous VS Code
windows/extensions connect to one backend at once, whether pointed at the same repo or different
repos."*

Today nothing observable breaks, because `Repo` holds no resource — `Registry.Close`'s own comment
concedes as much. The moment G2 attaches an `fsnotify` watcher to it, and G3 a `cat-file --batch`
process and a commit store, it becomes a real bug. This is the phase that must fix it, because this
is the phase that first gives a `RepoEntry` something to lose.

### F8 — `rpcstream` physically cannot emit an event from production code, and the fix is small

`session.Emit` (`session.go:97-103`) is a method on the unexported `session` type; `Serve`
(`:229-239`) constructs one, loops, and returns nothing. There is no handle. The comment at `:94-96`
concedes it: *"P1 wires no production caller of this yet … it exists … for `gitstream_test.go`"*.

`gitsock/server.go:178` is the sole caller of `Serve` in the whole repo (verified: `grep -rn
"rpcstream\." --include=*.go apps/kira-studio` outside tests). So changing its shape has exactly one
call site to update, and `session_test.go:52` (which already reaches `newSession` directly) needs a
rename, not a rewrite.

G1 §11 records this as G2's to fix, with the suggested shape: *"`Serve` should return a small handle
(or take a `func(*Session)` callback) exposing `Emit`."*

### F9 — `fsnotify` has no recursive watch, so the `refs/**` requirement is a walk this plan must specify

`fsnotify.go:503` — `var enableRecurse = false`, "Only enabled in tests for now". `Add`'s doc
(`fsnotify.go:322-341`) — "Subdirectories are not watched (i.e. it's non-recursive)."

Upstream got recursion for free from Node's `fs.watch({recursive:true})`, and then had to work
around that implementation's own Linux failure mode by *also* watching `refs/heads`, `refs/tags` and
`refs/remotes` non-recursively (`nodeFileWatcher.ts:24-31`, `watcher.ts:153-167`). Go has neither
the freebie nor the workaround: the watcher must walk `<commonDir>/refs` at start, `Add` every
directory it finds, and `Add` any directory created afterwards (a branch named `feature/x` creates
`refs/heads/feature/`).

That is a real design item, not an implementation detail — get it wrong and a branch under a
brand-new namespace is invisible until something else moves a ref.

### F10 — On macOS, watching a directory costs one file descriptor per file in it

`backend_kqueue.go:581-620`'s `watchDirectoryFiles` `ReadDir`s the directory and registers every
entry through `internalWatch` (`:672-680`), each of which is a real `unix.Open` (`:398`). kqueue has
no per-directory notification primitive, so this is inherent to the backend, not an fsnotify choice.

Practically: watching `<commonDir>/refs/heads` on a repository with N loose branch refs costs N
descriptors on the shipped platform. Linux/inotify (what this container tests on) costs one watch
per *directory* and none per file, so **this cost is invisible to every automated test in this
repo** — which is precisely why it needs to be written down here rather than discovered on a user's
machine.

It is bounded in practice: `git gc`/`git pack-refs` folds loose refs into `packed-refs`, Go's
runtime raises `RLIMIT_NOFILE` to the hard limit at startup, and macOS's `kern.maxfilesperproc`
default is 24576. It is not bounded in theory.

### F11 — SPEC §6 says the watcher covers "plus the worktree"; upstream never watches the worktree, and the two `repo.changed` kinds do not require it

SPEC §6: *"one watch per `RepoEntry` covering `HEAD`/`refs/**`/`packed-refs`/`index`/`FETCH_HEAD`/
`MERGE_HEAD`/`rebase-*`/`CHERRY_PICK_HEAD`/`REVERT_HEAD`/`sequencer` plus the worktree"*.

Upstream's `watchRepo` (`watcher.ts:144-167`) subscribes to exactly two path sets: `commonDir/refs`
recursively, and a flat list of `commonDir`, `gitDir`, `refs/heads`, `refs/tags`, `refs/remotes`.
The worktree root is not among them. `worktreeChanged` — the very signal a worktree watch would
exist to produce — is derived solely from `<gitDir>/index` (`watcher.ts:62`).

And the wire event has no third kind to carry anything else: `contract.ts:1094` fixes the payload at
`{repoId, kind: 'refsChanged' | 'worktreeChanged'}`.

So a literal recursive worktree watch would (a) add no expressible signal, (b) require an exclusion
list (`node_modules`, `target`, `.venv`, build outputs) this app has no source of truth for and no
setting to configure, and (c) on the shipped platform cost one descriptor per file in the repository
(F10). D9 resolves this.

### F12 — Git writes every one of these files by rename, so a `.lock` name is what the filesystem actually reports

`watcher.ts:48-54` states it and strips it: git writes `<name>.lock`, then renames it onto `<name>`.
The rename's source-side event names the `.lock` file, not the final one, so a classifier comparing
basenames without stripping `.lock` "would silently miss every index/ref write".

The same is true of `fsnotify`: an inotify/kqueue rename reports both names, and the `Create` on the
destination does arrive — but the `Write`s that built the file all named `<name>.lock`, and on
kqueue a `Rename` on the watched directory can be the only thing observed. Stripping the suffix is
cheap insurance and matches the source being ported.

### F13 — The two long-lived processes G3 brings must spawn outside the read gate, and `Repo`'s gate is not the seam for them

`logSession.ts:1-18` is explicit: a paused `git log` is held for the life of the panel, so routing
it through the bounded read pool "would hold a quarter of the repository's read concurrency
hostage". `catFile.ts:235-248` spawns the same way, directly on the runner.

Go's equivalent split already exists structurally: `Runner` is the spawn seam and `Repo.Read`/
`Repo.Write` (`repo.go:84-134`) is the gate. G3's sessions will call the runner directly and skip
the gate, exactly as upstream does. **That means the streaming primitive belongs on `Runner`, not on
`Repo`** — a `Repo.StartRead` convenience would be a seam its most important consumers deliberately
bypass.

### F14 — SPEC's "after the existing hidden-eviction grace period" refers to machinery that does not exist on the server side

SPEC §6: *"refcount++/--, real teardown (kill cat-file, stop the watcher, drop caches) only at zero,
after the existing hidden-eviction grace period."*

Upstream's grace period is `HIDDEN_EVICT_MS = 5 * 60 * 1000` (`repoService.ts:716`), armed by
`setUiVisible(false)` (`:1182-1192`) and consumed by `#evict` (`:3542-3560`). `setUiVisible` is an
in-process host call — the extension host telling the service its webview went invisible. It is
**not** a contract method: `validate.ts:59-93`'s `REQUEST_KEY_MAP` has no entry for it, and the
socket therefore cannot carry it.

Upstream's own `close(repoId)` (`:989-1000`) has no grace period at all — it disposes immediately.

So "the existing hidden-eviction grace period" names a duration (5 minutes) and an intent (do not
throw away expensive per-repo state the moment a viewer goes away) but not a mechanism this design
inherits. D12 resolves it.

### F15 — Two `repo.open` calls from the same connection must not take two refs, or `repo.close` under-releases

`repo.open`'s wire shape is `{path}` and `repo.close`'s is `{repoId}` (`gitrpc/wire.go:14-22`), and
upstream's `open()` returns the existing session when one is already registered
(`repoService.ts:978-981`). Nothing in the contract makes `repo.open` idempotency the client's
problem, and `integration_test.go` already asserts that a second `repo.close` for the same id
succeeds.

With a naive refcount, a client that calls `repo.open` twice (a workspace with the same folder
listed twice, a reconnect that re-opens without closing) and `repo.close` once leaks a ref forever —
and a leaked ref means a watcher that never stops.

### F16 — `RepoID` is the git dir here and the worktree root upstream, and that difference is safe but worth stating

`repo.go:237` sets `RepoID: gitDir`, with `:146-148`'s comment giving the reason: it is unique per
worktree even when several linked worktrees share one `commonDir`. Upstream uses `identity.root`
(`repoService.ts:979`).

The id is minted by the server and echoed back by the client (`repo.close`'s only parameter), and
nothing client-side derives meaning from its contents. So the divergence is invisible on the wire.
It matters for exactly one thing in G2: a **bare** repository has `Root == ""` (`repo.go:222-229`),
so keying on `Root` would collapse every bare repo into one entry. Keeping `gitDir` is correct and
stays.

### F17 — G1's capability port is complete for what it covers, and misses upstream's per-binary half — but nothing can consume either yet

`capabilities.go:12-48` ports upstream's `RepoCapabilities` (`capabilities.ts:43-57`): commit-graph
presence, `core.sparseCheckout`, linked-worktree. It does **not** port `capabilitiesForVersion`
(`capabilities.ts:28-41`: `mergeTreeWriteTree`, `commitGraph`, `sparseCheckout` as version floors),
nor either of upstream's two caches (per-binary keyed by version, per-repo keyed by the driver's
write `generation`).

But: `validate.ts:59-93`'s request map has **no** capability method at all, `ProbeCapabilities` has
no caller in this repo (`grep -rn ProbeCapabilities --include=*.go` → its own definition and its
test), and the per-repo cache upstream describes is keyed by `GitDriver.generation`
(`driver.ts:194-201`), a counter bumped once per completed *write* — of which G2 has none. D16
resolves what is owed to whom.

### F18 — The proof surface for this phase is the Go tier, not the e2e tier, and that is a property of the platform not a shortcut

`discovery.go:130-146` returns `notFound` on every non-darwin `GOOS`, and `client.go:44-47`
short-circuits `OpenRepo` above it. A `-tags server` binary in this container therefore *cannot* open
a repository — which means it cannot acquire a `RepoEntry`, cannot start a watcher, and cannot emit
`repo.changed`. `tests/e2e-real/git-pairing-real.spec.ts` already asserts exactly that
(`{kind:"gitUnavailable"}`) and that assertion stays true and must keep passing.

The seam that gets around it is already built and already used: `integration_test.go:24-38`'s
`lookPathLocator` constructs a `gitclient.Client` over a locator that returns
`exec.LookPath("git")`, and `:161-198` drives a real `gitsock.Server` over a real socket against a
real `git init` fixture (`:200-221`). That is the tier where every G2 behaviour is provable here,
end to end, over the real wire.

---

## 2. Decisions

### D1 — `Runner` becomes a one-method streaming interface; `Run` becomes a package function over it

```go
// Process is one running git child. Every method is safe to call from the goroutine that
// started it; Stdout may be read from another.
type Process interface {
    // Stdout is the child's stdout pipe. It reaches EOF when git closes it — which, because the
    // child runs in its own process group (D3), is not delayed by a grandchild that outlives it.
    Stdout() io.ReadCloser
    // Wait blocks until the child has exited and its stderr has been fully drained, then reports
    // the outcome. Result.Stdout is always nil: the caller owns that pipe. Calling Wait without
    // having read Stdout to EOF can block until the child's own write blocks and the context or
    // Close intervenes — the same constraint upstream's GitRead.done documents (driver.ts:366-377).
    Wait() (Result, error)
    // Close stops the child if it is still running (D3's group SIGTERM, escalating to SIGKILL
    // after gracefulStopDelay), closes Stdout, and waits. Idempotent; safe after Wait.
    Close() error
}

// Runner is the spawn seam. One method, because there is exactly one spawn path (F1/F4): a
// buffered read is a streaming read that was drained immediately (Run, below), never a second
// implementation that could be missing part of the hygiene.
type Runner interface {
    Start(ctx context.Context, gitPath string, spec Spec) (Process, error)
}

// Run starts spec, drains stdout to completion and waits — the buffered shape every existing
// caller in this package uses. It is a function, not a Runner method, precisely so a fake Runner
// cannot supply a buffered path that disagrees with its streaming one.
func Run(ctx context.Context, r Runner, gitPath string, spec Spec) (Result, error)
```

`Spec` and `Result` are **unchanged** (`runner.go:22-41`), which is what keeps the diff in
`discovery.go`/`repo.go`/`capabilities.go` to the call form (`runner.Run(ctx, gitPath, spec)` →
`Run(ctx, runner, gitPath, spec)`) and nothing else.

Rejected: keeping `Run` on the interface alongside `Start`. It gives every fake two independent
implementations to keep consistent, and the task this phase exists to do is to make there be one
spawn path. Rejected: making `Process` a concrete struct — `discovery_test.go`'s `fakeRunner` must
be able to construct one from canned bytes, and a struct wrapping `exec.Cmd` cannot be.

`Process` is an interface for testability only; there is exactly one production implementation
(`execProcess`).

### D2 — The hygiene set becomes upstream's, verbatim, and `LC_ALL=C` is called out as already load-bearing

```go
var configOverrides = []string{
    "-c", "core.quotepath=false",       // non-ASCII paths as UTF-8 bytes, not octal escapes
    "-c", "color.ui=false",             // a user's color.ui=always must not inject ANSI escapes
    "-c", "log.showSignature=false",    // ... nor log.showSignature=true inject signature blocks
    "-c", "i18n.logOutputEncoding=UTF-8",
}

var hygieneEnv = []string{
    "GIT_TERMINAL_PROMPT=0",
    "GIT_OPTIONAL_LOCKS=0",
    "GIT_PAGER=cat",
    "GIT_EDITOR=true",
    "LC_ALL=C",
}
```

`buildArgv` becomes `configOverrides + "--no-pager" + ["--no-optional-locks" if ReadOnly] + Args`.

Each entry's justification is F4's table. Two notes for the implementer:

- **`LC_ALL=C` is not forward-looking, it is a bug fix for this phase.** `errors.go:63-77` classifies
  by English substring match; on a machine with a localised git, every failure today classifies
  `Unknown`, including "not a git repository" — which `client.go:51-53` depends on to answer
  `repo.open` with `notARepository` instead of a wire error.
- **Later entries win.** `buildEnv` appends onto the base (`runner.go:74-79`), and Go's `os/exec`
  resolves duplicate keys by keeping the last, so `LC_ALL=C` overrides an inherited `LC_ALL`.
  `LC_ALL` also overrides `LANG`/`LC_MESSAGES` per POSIX, so no further unsetting is needed.

`GIT_EDITOR=true` has no G2 caller and is included deliberately: it is part of a fixed constant
env, not a feature, and upstream's own note (`driver.ts:61-69`) is that its absence leaves
`MERGE_HEAD` in place — a *hang and a corrupted operation*, not a missing capability. A driver whose
hygiene is complete only for the subcommands the current phase happens to run is the exact failure
mode `driver.ts:1-10` was written against.

### D3 — Every git child gets its own process group, a SIGTERM-first cancel, and a real 2 s escalation

```go
cmd := exec.CommandContext(ctx, gitPath, buildArgv(spec)...)
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
cmd.Cancel = func() error { return killGroup(cmd.Process.Pid, syscall.SIGTERM) }
cmd.WaitDelay = gracefulStopDelay // 2s — Go then SIGKILLs the child and closes the pipes
```

- `Setpgid` mirrors `internal/preconnect/supervisor.go:130`, the repo's existing precedent, and buys
  F3's guarantee: a `git fetch` whose `ssh` grandchild is wedged is reachable.
- `cmd.Cancel` replaces `exec.CommandContext`'s default `Process.Kill()` (F2). SIGTERM to the
  negative pid reaches the whole group; `ESRCH` (already gone) is not an error.
- `WaitDelay` now does what `runner.go:107-112` claimed: with a Cancel that signals rather than
  kills, the 2 s is a genuine grace window, after which Go SIGKILLs the child *and closes the pipes*
  (`exec.go:299-306`) — which is what unblocks a reader parked on `Stdout` behind a surviving
  grandchild.
- `Process.Close()` performs the same sequence explicitly for the non-`ctx` case (an explicit
  cancel, a disposed session): group SIGTERM, wait up to `gracefulStopDelay`, group SIGKILL, close
  the pipe, `Wait`.

`gracefulStopDelay` stays 2 s (`runner.go:60`), matching upstream's `SIGKILL_GRACE_MS`
(`nodeProcessRunner.ts:11`) and this repo's own `preconnect.killGrace` (`supervisor.go:44`).

### D4 — stderr is drained by a goroutine and bounded at 1 MiB with a truncation marker; stdout is not bounded

stderr is attacker-adjacent (a `pre-push` hook, a remote's message) and lands in an error message, so
it gets upstream's exact treatment (`nodeProcessRunner.ts:129-163`): a goroutine reads it from spawn
to EOF into a buffer capped at `maxStderrBytes = 1 << 20`, appending `"\n…[stderr truncated]"` once
the cap is hit and then discarding.

Draining it on a goroutine rather than into `cmd.Stderr` matters for `Start`: a child that writes
more than a pipe buffer of stderr while the caller is reading stdout would otherwise deadlock.
`internal/preconnect/supervisor.go:145-160` already establishes the shape (drain the pipe fully,
*then* `cmd.Wait()`).

`Run`'s stdout is **not** capped. Every `Run` call site is a fixed-shape query whose output git
itself bounds (`--version`, `rev-parse`, `config --type=bool`), and inventing a cap here would be a
number a later phase has to fight when `status --porcelain=v2` on a large dirty tree legitimately
exceeds it. Unbounded output is what `Start` exists for, and G3 uses it.

### D5 — Discovery bounds its `--version` probe at 5 s and reports `unusable` with a named reason

`discovery.go:241-268`'s `probe` wraps its one `Run` in
`context.WithTimeout(ctx, versionProbeTimeout)` with `versionProbeTimeout = 5 * time.Second`
(upstream's `DEFAULT_VERSION_TIMEOUT_MS`, `discovery.ts:252`). On `context.DeadlineExceeded` it
returns:

```go
GitStatus{Kind: "unusable", Path: path,
          Reason: "git --version did not respond within 5s"}
```

`unusable` rather than `notFound` because a binary was located; it is the binary that is unusable —
and `packages/git-ui`'s `GitBlockedPanel.vue` already renders every non-`ok` kind
(`discovery.go:26-28`).

The timeout is derived from the *caller's* ctx, so a cancelled `app.init` still cancels the probe
immediately; the 5 s is only a ceiling.

**Not** made configurable. A setting for it would be a setting whose only correct value is "long
enough", and F5's failure is a wedged binary, not a slow one.

### D6 — A git failure crosses as `E_GIT_<KIND>` with a one-line summary; the full stderr stays server-side

Two edits, in two packages:

1. **`gitclient/errors.go`** — `(*Error).Error()` returns upstream's summary shape
   (`errors.ts:83-84`):
   `git <argv joined> failed (<kind>): <first non-empty line of stderr, or "exited <code>">`.
   `Stderr` stays on the struct in full, for `slog` and for a later phase that wants it (upstream
   keeps it "preserved verbatim and always surfacable" for the same reason, `errors.ts:67-70`).
2. **`gitrpc`** — a new `mapGitError(err error) error`:

```go
// mapGitError turns gitclient's closed error vocabulary into ipcerr codes so the classification
// survives the wire (F6). rpcstream folds anything that is not an *ipcerr.Error into E_INTERNAL
// (frame.go:48-54), which is the whole reason this exists.
func mapGitError(err error) error {
    kind, ok := gitclient.KindOf(err)
    if !ok {
        return err
    }
    return ipcerr.New("E_GIT_"+strings.ToUpper(camelToSnake(string(kind))), err.Error())
}
```

producing `E_GIT_NOT_A_REPOSITORY`, `E_GIT_PERMISSION_DENIED`, `E_GIT_CANCELLED`, `E_GIT_TIMEOUT`,
`E_GIT_UNKNOWN`. Every `gitrpc` handler that can return a driver error routes through it.

Rejected: adding a `Kind` field to `ipcerr.Error` so `wireError.kind` (`frame.go:14-18`) could be
populated. `ipcerr` is shared with the `studio` and `api` modules and this would put a git concept
in it; `RpcError.code` (`rpc.ts:59-68`) is already the field a client branches on, and it is
already app-wide vocabulary. `wireError.kind` stays unset, which is valid — it is optional in the TS
type (`rpc.ts:53-57`).

Rejected: a per-kind message rewrite (hiding stderr entirely). An `Unknown` classification is only
unactionable if the text is discarded (`errors.ts:67-70`); the first line is the actionable part and
the wall is not.

### D7 — `github.com/fsnotify/fsnotify v1.10.1`, and no other new dependency

`AGENTS.md`: reach for an existing, well-maintained library before hand-rolling non-trivial
infrastructure. Hand-rolling `inotify`/`kqueue` bindings is squarely that, and SPEC §6 names
`fsnotify` by name. Checks performed here:

- **License**: BSD-3-Clause (`LICENSE`: "Copyright © 2012 The Go Authors … Copyright © fsnotify
  Authors"), fully open source, no dual-licensing or gated features — `AGENTS.md`'s bar.
- **Dependency cost**: `go.mod` requires only `golang.org/x/sys`, already indirect here at
  `go.mod:119`. No cgo. Both backends this project can hit (kqueue on darwin, inotify on linux) are
  in-tree.
- **Version**: pin `v1.10.1`, the current release, resolved through the proxy in this container.

`go.mod` gains one direct require; `golang.org/x/sys` is promoted from indirect. `go mod tidy` after.

### D8 — The watcher lives in `gitclient/watcher.go` and knows nothing about connections

SPEC §2's `gitclient` row does not list a watcher; SPEC §6 says the watcher is "one per
`RepoEntry`". Both are satisfied by splitting ownership from mechanism:

- **`gitclient/watcher.go`** holds the mechanism: an `fsnotify` watcher over one `RepoSummary`,
  classification, debounce, and a `Signals() <-chan Signal` output. It is the rewrite of the file
  SPEC §6 names (`watcher.go`'s `os.Stat` polling on the superseded branch), it sits beside
  `identify()` — the only thing that produces the `gitDir`/`commonDir` pair classification needs —
  and it imports nothing but stdlib and `fsnotify`.
- **`gitsession.RepoEntry`** holds one instance and owns the fan-out (D14).

This also keeps `gitsession` free of `fsnotify` entirely, which is what lets `registry_test.go` drive
the refcount and linger logic against a fake watcher without touching the filesystem.

**No library for the debounce.** `AGENTS.md` requires naming the requirement when declining one: the
requirement is a *leading-window* debounce (fire 200 ms after the **first** event of a burst, not
200 ms after the last — upstream's `watcher.ts:118-137`, so a continuous `git fetch --prune` cannot
starve the signal indefinitely) that also coalesces two independent signal kinds. That is ~25 lines
of `time.Timer` and two booleans; no Go debounce library in this dependency graph offers the leading
window, and adding one for this would be more integration than implementation.

### D9 — The watcher watches `.git` directories only; `worktreeChanged` comes from the index, and the literal worktree watch is declined

Resolving F11. The watched set is:

| Path | Recursive | Produces |
|---|---|---|
| `<commonDir>` | no | `refsChanged` for a ref-ish basename; `worktreeChanged` for `index` when `gitDir == commonDir` |
| `<gitDir>`, when `!= commonDir` (a linked worktree) | no | `worktreeChanged` for `index`; `refsChanged` for a ref-ish basename — a linked worktree keeps its own `MERGE_HEAD`/`CHERRY_PICK_HEAD`/`sequencer`/`rebase-*` (`watcher.ts:70-75`) |
| `<commonDir>/refs` and **every directory beneath it**, enumerated at start and extended on `Create` | by enumeration (F9) | `refsChanged` |

Ref-ish basenames, after stripping a trailing `.lock` (F12) — upstream's set verbatim
(`watcher.ts:33-46`), which is SPEC §6's list plus `BISECT_LOG`:

`HEAD`, `packed-refs`, `FETCH_HEAD`, `MERGE_HEAD`, `rebase-merge`, `rebase-apply`,
`CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`, `sequencer`.

**The worktree tree itself is not watched.** Reasons, in order of weight:

1. **It would produce no signal the contract can carry.** `contract.ts:1094` fixes the payload's
   `kind` at two values, and the one a worktree watch would feed (`worktreeChanged`) is already
   produced, by `<gitDir>/index` — which is what `git add`/`checkout`/`reset`/`stash`/`merge` all
   touch. This is upstream's shipped behaviour (F11), not a simplification of it.
2. **There is no exclusion policy to apply.** Watching a monorepo's worktree without excluding
   `node_modules`/`target`/`.venv` is a self-inflicted denial of service; with them, it is a
   heuristic this app has no setting, source of truth, or requirement for. Adding one would be
   inventing scope.
3. **On the shipped platform it costs a descriptor per file** (F10) — for the whole worktree, not
   just `.git`.

What is genuinely lost: an *unstaged* edit made outside VS Code produces no event until it is
staged. Upstream ships with exactly that gap, and the surface that would care (`status.get`) is
G4's. Recorded in §10 so G4 can decide deliberately rather than rediscover it.

### D10 — Directories are watched, files never are; a new directory under `refs/` is added on sight

`nodeFileWatcher.ts:1-11`'s rule, which applies identically to `fsnotify`
(`fsnotify.go:325-341`: "Watching individual files … is generally not recommended as many programs
update files atomically … The watcher on the original file is now lost"). Every `Add` this watcher
issues is a directory.

New-directory handling, since F9 leaves it to us:

- At start: `filepath.WalkDir(<commonDir>/refs)`, `Add` every directory. A missing `refs/` is not an
  error (a repository mid-`init`); the walk simply adds nothing and the `commonDir` watch still
  catches `packed-refs`.
- On any event whose path is a directory that sits under `<commonDir>/refs` and is not already
  watched, `Add` it and walk it (a `git clone`/`fetch` can materialise `refs/remotes/origin/` and
  children in one burst, and the intermediate directory's own `Create` may be the only event
  observed before its children appear).
- An `Add` failure (EMFILE, the directory vanishing between the walk and the call) is logged at
  `warn` with the path and skipped — that one directory is unwatched, the rest of the watcher keeps
  working. Same posture as `nodeFileWatcher.ts:101-104`, and the only alternative (fail the whole
  watch) is strictly worse.
- `fsnotify`'s `Errors` channel is drained: `ErrEventOverflow` is treated as "something changed,
  we do not know what" and raises **both** signals; anything else is logged at `warn`.

Watches are never removed for a deleted directory — `fsnotify` drops them itself, and re-adding on a
later `Create` is what the rule above already does.

### D11 — 200 ms leading-window debounce, coalescing the two kinds, one goroutine per repo

`debounceWindow = 200 * time.Millisecond` (SPEC §6; upstream `watcher.ts:29`).

One goroutine per watcher owns everything: it selects over `fsnotify`'s `Events`, its `Errors`, a
`time.Timer` and a `stop` channel. On the first classified event it records the two pending booleans
and starts the timer; subsequent events inside the window only set booleans. On fire it emits at most
one `refsChanged` and at most one `worktreeChanged` (refs first, matching `watcher.ts:109-110`) and
clears the window.

No mutex, no injected clock: the timer is real and 200 ms, and the test asserts *"one signal arrives
within a generous timeout after a burst of N writes"*, not *"exactly 200 ms elapsed"* — a timing
assertion this container cannot make honestly anyway (`AGENTS.md`'s note about this container's slow
reaping is the same class of hazard).

### D12 — `Registry.Acquire`/release, with a 5-minute linger at refcount zero and teardown after it

```go
// Registry is the per-app set of open repositories, keyed by RepoID (the absolute git dir, F16).
// Acquire is the only way in; the returned release is idempotent.
func (reg *Registry) Acquire(ctx context.Context, gitPath, path string) (*RepoEntry, func(), error)
```

The state machine, in full:

1. `Acquire` runs `gitclient.Identify` **outside** the registry mutex (it spawns four `rev-parse`
   processes; holding a global lock across them would serialise every window's `repo.open`). Two
   concurrent acquires of the same path both identify; that is cheap and idempotent, and it is what
   `repo.go:165-179` already does.
2. Under the mutex, dedupe on `Summary.RepoID`. A hit: cancel any armed linger timer, `refs++`,
   return. A miss: construct the `RepoEntry` (which starts its watcher), `refs = 1`, insert.
3. `release()` (`sync.Once`-guarded): under the mutex, `refs--`. Above zero, done. **At zero**, arm
   `lingerTimer = time.AfterFunc(lingerFor, …)`.
4. On expiry: under the mutex, re-check `refs == 0` (a re-acquire between the timer firing and the
   callback taking the lock must win), then tear down — stop the watcher, close the subscriber
   fan-out, delete the entry.
5. `Registry.Close()` tears down every entry immediately, for `gitsock.Server.Close()`.

`lingerFor` defaults to `5 * time.Minute` — upstream's `HIDDEN_EVICT_MS` (`repoService.ts:716`),
which is the number SPEC §6 points at. It is a `Registry` field so `registry_test.go` can set it to
a few milliseconds; there is no injected clock, because `time.AfterFunc` with a millisecond duration
is directly testable and a clock seam would only exist to avoid a 5 ms sleep.

**The watcher keeps running through the linger window.** That is the whole point of the window: the
entry is retained so a VS Code reload (close, reopen within seconds) does not pay to rebuild it, and
from G3 the retained thing is a commit store and a `cat-file` batch whose validity depends on having
observed every ref move meanwhile. Stopping the watcher at zero would retain state that is silently
stale on re-acquire — strictly worse than either extreme. Events during the window fan out to zero
subscribers, which is a no-op.

Resolving F14: SPEC's "after the existing hidden-eviction grace period" is honoured as *the
duration and the intent*, applied at refcount zero — the only trigger this design has, since
`setUiVisible` is not on the wire.

### D13 — `RepoEntry` in G2 holds exactly four things, and no placeholders for the rest

```go
// RepoEntry is one repository's SHARED state — everything true of the repository rather than of
// one viewer (SPEC §6's split rule). G3-G9 add the caches, cat-file session, head, stash shapes,
// undo slot and active remote op that SPEC §6 also lists; this phase adds nothing it cannot use.
type RepoEntry struct {
    Summary gitclient.RepoSummary
    Repo    *gitclient.Repo        // the reader/writer gate, now shared across connections
    watcher *gitclient.RepoWatcher
    subs    map[ConnID]*subscriber
    // + mu, refs, lingerTimer, owned by Registry
}
```

Per `AGENTS.md` ("scope left out of a phase is left out entirely"), there are no zero-valued fields
standing in for later phases. SPEC §6's diagram is the destination, not a struct literal to
transcribe.

`Repo` moves under `RepoEntry` unchanged — SPEC §6 says so explicitly (*"needs no change — it
already serializes correctly; it now does so across connections instead of within one, which is the
point"*), and this is the phase in which that sentence becomes true.

### D14 — Fan-out is one coalescing goroutine per subscriber, so a slow client cannot stall the watcher

SPEC §6: *"fanned out to every subscriber over its own coalescing buffered channel so one slow
client can't stall the watcher for others."*

```go
type subscriber struct {
    deliver func(Event)              // ends in the connection's rpcstream session Emit
    mu      sync.Mutex
    refs    bool                     // pending refsChanged
    worktree bool                    // pending worktreeChanged
    wake    chan struct{}            // capacity 1
    done    chan struct{}
}
```

- The watcher goroutine's `note(signal)` takes each subscriber's small mutex, ORs the flag, and does
  a **non-blocking** send on `wake`. It never blocks and never allocates per event.
- Each subscriber runs one goroutine: wait on `wake`, swap out both flags under the mutex, call
  `deliver` once per set flag.
- Coalescing is therefore in the *flags*, not in a channel of events — which is why a burst of 500
  ref writes delivers one `repo.changed`, and why a client stuck for a second collapses everything
  that happened meanwhile into one event rather than a backlog.

A plain buffered `chan Event` was rejected: capacity 1 loses the distinction between the two kinds
(a dropped `worktreeChanged` behind a queued `refsChanged` is a silently missed signal), and any
larger capacity is a backlog that says the same thing N times.

`deliver` ends in `(*rpcstream.Session).Emit`, which itself can block on a full 16-deep `sendCh`
behind a wedged socket (`session.go:81-90`) — which is precisely why it is called from the
subscriber's own goroutine and not the watcher's.

### D15 — `Conn` dedupes per repo, so `repo.open` is idempotent and `repo.close` fully releases

Resolving F15.

```go
type Conn struct {
    ID       ConnID
    ClientID string
    Emit     func(method string, payload any)   // supplied by gitsock; gitsession never imports bridge
    mu   sync.Mutex
    held map[string]*hold                       // RepoID -> {entry, release, unsubscribe}
}

func (c *Conn) Open(ctx context.Context, reg *Registry, gitPath, path string) (gitclient.RepoSummary, error)
func (c *Conn) CloseRepo(repoID string) bool
func (c *Conn) Close()                          // releases and unsubscribes everything
```

- `Open` acquires, then checks `held[repoID]`: if this connection already holds it, it **releases
  the ref it just took** and returns the existing hold's summary. One `repo.open`-per-repo-per-
  connection is what the refcount counts, regardless of how many times the client asks.
  (Acquire-then-release rather than check-then-acquire, because the RepoID is only known *after*
  `Identify` runs, and identifying inside `Conn`'s own lock would serialise this connection's
  opens.)
- `Open` also subscribes this connection to the entry (D14) with a `deliver` that calls
  `c.Emit("repo.changed", Event{RepoID, Kind})`.
- `CloseRepo` unsubscribes, calls `release`, deletes the hold, and reports whether one was present.
  The RPC ignores the bool and answers `{}` either way, preserving G1's idempotent `repo.close`
  (`integration_test.go` asserts it).
- `Close` does the same for every hold. `gitsock.handleConn` defers it, which is SPEC §6's
  "release its `RepoEntry` refcounts" on disconnect.

`gitsession` imports `gitclient` and stdlib only — no `bridge`, no `rpcstream`, no `gitsock`. It is a
domain package and `internal/layering_test.go`'s auto-enumeration (`:53-89`) covers it with no edit
to the exemption set.

### D16 — "Capabilities" is complete as ported; the per-binary half and the caches go to their first real consumer

Resolving F17. G2 adds nothing to `capabilities.go`.

- **`capabilitiesForVersion`** (`mergeTreeWriteTree`/`commitGraph`/`sparseCheckout` version floors,
  `capabilities.ts:28-41`) is derived from the version discovery already resolved and is consumed
  first by **G5**'s `merge-tree --write-tree` conflict prediction. Writing it here produces three
  booleans nothing reads, which is `AGENTS.md`'s "scope left out is left out entirely".
- **The per-binary cache** is a comparison against a value already cached for 30 s
  (`discovery.go:195`). There is nothing to cache.
- **The per-repo cache** is keyed upstream by `GitDriver.generation` (`driver.ts:194-201`), a counter
  bumped once per completed write. G2 has no write path (§0.3), so the key does not exist yet;
  **G5** introduces both together.
- **`ProbeCapabilities` itself** already has no caller and is already tested against real
  repositories (`capabilities_test.go`). It stays as it is.

Recorded in §10 with the owning phase, so neither G3 nor G5 rediscovers the gap.

### D17 — `rpcstream.session` becomes exported `Session` with a `Serve` method; the free `Serve` function goes

Resolving F8, in the shape G1 §11 suggested, chosen for having exactly one call site (F8):

```go
func NewSession(conn Conn, h Handlers) *Session
func (s *Session) Serve()                      // blocks until the peer closes; closes the session on return
func (s *Session) Emit(method string, payload any)
```

`session` → `Session`, `newSession` → `NewSession`, `Serve(conn, h)`'s body becomes `Serve()`'s.
The free function is deleted rather than kept as a wrapper: two entry points for one thing, one of
which cannot emit, is the shape that produced this gap in the first place.

`session.go:92-96`'s comment ("P1 wires no production caller of this yet … it exists … for
`gitstream_test.go`") is updated to name the real caller. `session_test.go:52` already calls
`newSession` directly and needs only the rename.

**`Handlers.Stream`'s signature is not touched** — G1 §11 assigns that to G3, and G2 opens no
stream.

### D18 — `gitrpc` becomes a per-connection router, and the wire contract does not change at all

```go
type Router struct{ deps Deps }
func New(deps Deps) *Router
func (r *Router) ForConn(c *gitsession.Conn) Handlers   // the same two-function Handlers as today
```

`Deps` becomes `{Discovery *gitclient.Discovery; Runner gitclient.Runner; Registry *gitsession.Registry; ServerVersion string}`.

Handler bodies:

- **`app.init`** — unchanged: `{ContractVersion, ServerVersion, Git: discovery.Status(ctx, "")}`.
- **`repo.open`** — validate `path != ""`; `discovery.Status(ctx, "")`; on non-`ok` return
  `{kind:"gitUnavailable", git}`; else `c.Open(ctx, registry, status.Path, path)`. A
  `KindNotARepository` becomes `{kind:"notARepository", path}` exactly as `client.go:51-53` does
  today; any other classified error goes through `mapGitError` (D6).
- **`repo.close`** — validate `repoId != ""`; `c.CloseRepo(repoID)`; return `struct{}{}`.

**Wire impact: none.** Params, results and `CONTRACT_VERSION` are untouched — `repo.open` still
takes `{path}` and returns the same `RepoOpenResult` union with the same `RepoSummary`, and
`repo.close` still takes `{repoId}` and returns `{}`. Only the *meaning* of `repo.close` changes,
from "evict globally" to "release this connection's hold", which is a bug fix (F7) invisible to a
single-connection client. `packages/git-ipc/src/validate.ts:7`'s `CONTRACT_VERSION = 12` and
`gitrpc/contract.go:11` both stay at 12.

Consequent moves in `gitclient`, all mechanical:

- `Registry`, `NewRegistry` and `Registry.Open/Get/Close` are **deleted** from `repo.go` (their job
  is `gitsession.Registry`'s).
- `identify` → exported `Identify`; `newRepo` → exported `NewRepo`.
- `Client` shrinks to `{Runner, Discovery}` with `Status`; `OpenRepo`/`CloseRepo` are deleted.
- `RepoOpenResult` moves from `client.go` to `gitrpc/wire.go` — it is a wire type, and SPEC §2 makes
  `gitrpc` the owner of wire types. Its JSON tags are unchanged.
- `repo_test.go`'s registry tests move to `gitsession/registry_test.go` (rewritten around
  `Acquire`); its gate tests stay put untouched.

### D19 — `gitsock` mints one `gitsession.Conn` per accepted connection and tears it down on return

`handleConn` (`server.go:161-183`) becomes:

1. `runHandshake` — extended to return the `sessionID` it already mints (`handshake.go:102`,
   `:162`) instead of discarding it.
2. `sess := rpcstream.NewSession(c, ...)` (D17).
3. `gconn := &gitsession.Conn{ID: gitsession.ConnID(sessionID), ClientID: clientID, Emit: sess.Emit}`.
4. `handlers := s.deps.Router.ForConn(gconn)`; the `rpcstream.Handlers` is built from those two
   functions as today.
5. `defer gconn.Close()` — SPEC §6's disconnect teardown. `rpcstream`'s own `close()`
   (`session.go:217-226`) already cancels every in-flight request for free.
6. `sess.Serve()`.

`Deps.Handlers gitrpc.Handlers` becomes `Deps.Router *gitrpc.Router`. `Server.Close()` additionally
calls `Registry.Close()`, so a shutdown stops every watcher; `main.go`'s `teardown` needs no new
entry (it already calls `gitSock.Close()`).

`Revoke` (`server.go:211-225`) is unchanged: closing the `net.Conn` makes `Receive` fail,
`Serve` returns, and the deferred `gconn.Close()` releases that connection's refs.

### D20 — `repo.changed`'s payload is the contract's, verbatim, and no version bumps

`{"repoId": "<RepoID>", "kind": "refsChanged" | "worktreeChanged"}` — `contract.ts:1094`.
`validate.ts:96` already admits the event, and `rpc.ts:195-199` already routes it to `on()` handlers
with a shape assertion. Nothing in `packages/git-ipc` changes; `CONTRACT_VERSION` stays 12 (D18).

The Go payload is a `gitsession.Event` struct with `json:"repoId"`/`json:"kind"` tags, marshalled by
`Session.Emit`'s existing `json.Marshal` (`session.go:98-102`).

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/`.

### 3.1 `internal/gitclient/runner.go` — rewritten (D1–D4)

| Symbol | Change |
|---|---|
| `Spec`, `Result` | **unchanged** (`:22-41`) |
| `configOverrides` | new — D2's four `-c` pairs |
| `hygieneEnv` | extended to D2's five entries |
| `buildArgv(spec)` | `configOverrides` + `--no-pager` + `--no-optional-locks` (reads) + `spec.Args` |
| `buildEnv(base)` | unchanged shape (`:74-79`) |
| `Runner` | now one method: `Start(ctx, gitPath, spec) (Process, error)` |
| `Process` | new interface: `Stdout() io.ReadCloser`, `Wait() (Result, error)`, `Close() error` |
| `Run(ctx, r, gitPath, spec) (Result, error)` | new package function — `Start`, `io.ReadAll(p.Stdout())`, `p.Wait()`, merge |
| `execRunner`/`NewExecRunner` | `Run` method replaced by `Start`; D3's `SysProcAttr`/`Cancel`/`WaitDelay` |
| `execProcess` | new — holds `*exec.Cmd`, the stdout pipe, the stderr-drain goroutine and its `done` channel |
| `maxStderrBytes`, `stderrTruncationMarker` | new — D4's 1 MiB + `"\n…[stderr truncated]"` |
| `killGroup(pid int, sig syscall.Signal) error` | new — `syscall.Kill(-pid, sig)`, `ESRCH` treated as success |

`execProcess.Wait` waits on the stderr goroutine's `done` before `cmd.Wait()`
(`supervisor.go:145-160`'s established ordering: drain fully, then reap, or the message loses its
tail), then maps `*exec.ExitError` to `Result.ExitCode` and anything else to `(Result{}, err)` —
`Runner.Run`'s existing contract (`:47-53`), preserved word for word so `Classify` keeps working
unchanged.

`execProcess.Close` is D3's explicit sequence, `sync.Once`-guarded.

**Call-site updates** (mechanical, `runner.Run(ctx, gitPath, spec)` → `Run(ctx, runner, gitPath, spec)`):
`discovery.go:247`; `repo.go:139`, `:250`, `:270`, `:278`; `capabilities.go:56`.

**`runner_test.go`**: the four `buildEnv`/`buildArgv` tests are updated to the new expected slices
(they are the reason to have them — `:10-12`'s own rationale). `TestExecRunner_Run`'s four subtests
are kept, re-expressed over `Run`. New subtests, meeting `AGENTS.md`'s concurrency/cancellation bar
and nothing beyond it:

- **stdout streams**: `Start` a `git log --format=%H` (or, if the fixture is small, `cat-file
  --batch-all-objects --batch-check`) and assert the first bytes are readable **before** `Wait`
  returns — the property `Run` structurally cannot have.
- **cancellation kills the child and unblocks the reader**: `Start` a long-running child, cancel the
  context, assert `Stdout` reaches EOF/error and `Wait` returns promptly (well inside
  `gracefulStopDelay + slack`).
- **`Close` before `Wait` is safe and idempotent.**
- **a grandchild does not hold the pipe open**: spawn `git` via a `t.TempDir()` shell shim whose last
  statement is a backgrounded `sleep 30` — the exact shape `nodeProcessRunner.ts:110-127` names —
  cancel, and assert `Stdout` reaches EOF. This is the one test that proves D3's `Setpgid` is doing
  something, and it is the reason this phase adds it at all.

### 3.2 `internal/gitclient/discovery.go` — edited (D5)

One constant (`versionProbeTimeout = 5 * time.Second`), one `context.WithTimeout` inside `probe`
(`:241-268`), one new `unusable` arm on `context.DeadlineExceeded`. Nothing else.

`discovery_test.go`'s `fakeRunner` (`:21-31`) is rewritten to implement `Start`, returning a
`fakeProcess{stdout: io.NopCloser(bytes.NewReader(f.result.Stdout)), result: f.result, err: f.err}`.
Both fakes move to the top of `discovery_test.go` as today. One new test: a `fakeRunner` whose
`Start` blocks until its context is done produces `GitStatus{Kind:"unusable"}` with the timeout
reason — driven by a `context.WithTimeout(…, versionProbeTimeout)` the fake observes, so no test
sleeps 5 s.

### 3.3 `internal/gitclient/errors.go` — edited (D6)

`(*Error).Error()` returns the summary shape. `errors_test.go:41-42`'s expectation is updated to the
new string. No new kinds: G2 runs no command that can produce one (F6's vocabulary is complete for
`--version`, `rev-parse`, `symbolic-ref`, `config`), and inventing `LockHeld`/`Conflict`/`AuthFailed`
here would be classification with nothing to classify — G5–G9 add each alongside the operation that
produces it, exactly as `errors.go:9-13` already says.

### 3.4 `internal/gitclient/watcher.go` — new (D7–D11)

```go
type Signal string
const (
    SignalRefsChanged     Signal = "refsChanged"
    SignalWorktreeChanged Signal = "worktreeChanged"
)

// RepoWatcher watches one repository's .git directories and reports debounced, coalesced
// signals. Directories only, never individual files (D10). Closing it stops the goroutine and
// closes Signals.
type RepoWatcher struct { /* … */ }

func NewRepoWatcher(summary RepoSummary) (*RepoWatcher, error)
func (w *RepoWatcher) Signals() <-chan Signal
func (w *RepoWatcher) Close() error
```

| Piece | Contents |
|---|---|
| `refIshNames` | D9's ten basenames, as a `map[string]bool` |
| `stripLockSuffix(name)` | F12 |
| `classify(summary, path) (Signal, bool)` | D9's table, in upstream's order (`watcher.ts:56-77`): `refs/` prefix → refs; `gitDir/index` → worktree; the `commonDir`/`gitDir` ref-ish checks last, so a non-linked worktree (where `gitDir == commonDir`) still routes `index` to worktree |
| `addRefsTree(w, root)` | `filepath.WalkDir` + `Add` per directory; a missing root is not an error |
| `run()` | D11's single goroutine: `Events`/`Errors`/`timer`/`stop` select, the two pending flags, the leading window, and D10's on-`Create` directory adds |

`watcher_test.go` — meets the bar (a classifier with several interacting rules + a debounce window):

- `classify` table test: `refs/heads/main`, `refs/heads/feature/x`, `refs/heads/main.lock`,
  `packed-refs`, `HEAD`, `index`, `MERGE_HEAD`, `sequencer/todo`, `objects/ab/cdef…` (ignored),
  `COMMIT_EDITMSG` (ignored) — against both a `gitDir == commonDir` summary and a linked-worktree
  one where they differ.
- **A real repository**: `git init` fixture (reusing `capabilities_test.go`'s existing helpers), a
  real `RepoWatcher`, then `git commit` → exactly one `refsChanged` arrives within a generous
  timeout; `git add` → `worktreeChanged`; a burst of 20 `git branch` calls → the signals coalesce
  (assert "at least one and far fewer than 20", not an exact count — the honest assertion).
- **A branch under a new namespace**: `git branch feature/new` creates `refs/heads/feature/`;
  assert a `refsChanged` arrives, then `git branch -f feature/new HEAD~0` and assert a *second*
  one — the property D10's on-`Create` add exists for, and the one that silently fails without it.

### 3.5 `internal/gitsession/` — new (D12–D15)

| File | Contents |
|---|---|
| `registry.go` | `Registry`, `NewRegistry(runner gitclient.Runner) *Registry`, `Acquire`, `Close`, `lingerFor` (default 5 min), the linger timer and the re-check-under-lock teardown |
| `entry.go` | `RepoEntry` (D13), its watcher goroutine pump (`for sig := range watcher.Signals()` → `note`), `Subscribe(id ConnID, deliver func(Event)) func()`, `teardown()` |
| `subscriber.go` | D14's coalescing subscriber and its goroutine |
| `conn.go` | `ConnID`, `Conn`, `Event`, `Open`, `CloseRepo`, `Close` (D15) |
| `registry_test.go` | refcount × linger: two acquires → one entry and one watcher; one release keeps it live; the second arms the linger; a re-acquire inside the window reuses the same `*RepoEntry` and cancels the timer; expiry tears down and a later acquire builds a *new* entry; `release` twice is a no-op; `Registry.Close` tears down everything |
| `conn_test.go` | D15's dedupe: `Open` twice for one path yields one hold and one ref (asserted through the registry's refcount), one `CloseRepo` releases it fully; `Close` releases every hold and unsubscribes |
| `subscriber_test.go` | D14's coalescing: a burst of N signals with a subscriber whose `deliver` blocks yields one delivery per kind, not N; a blocked subscriber does not delay a second subscriber's delivery (the SPEC sentence this exists for) |

Registry/conn/subscriber tests run against a **fake watcher** — `RepoEntry` takes its watcher through
a small `newWatcher func(gitclient.RepoSummary) (watcher, error)` field on `Registry`, defaulted to
`gitclient.NewRepoWatcher`, so the refcount tests need no filesystem and no `git`. The real watcher
is proven in `gitclient/watcher_test.go` (§3.4) and end to end in §3.9.

### 3.6 `internal/bridge/rpcstream/session.go` — edited (D17)

`session` → `Session`, `newSession` → `NewSession`, `func Serve(conn, h)` → `func (s *Session) Serve()`,
the `Emit` doc comment updated to name `gitsession`'s fan-out as its production caller.
`session_test.go` needs the two renames and nothing else. No behaviour change anywhere.

### 3.7 `internal/gitrpc/` — edited (D6, D18)

| File | Change |
|---|---|
| `contract.go` | unchanged — `ContractVersion = 12`, `Protocol = 1` |
| `wire.go` | gains `RepoOpenResult` (moved verbatim from `gitclient/client.go:5-14`); `AppInitResult`, `RepoOpenParams`, `RepoCloseParams` unchanged |
| `handlers.go` | `New(deps) *Router`; `(*Router).ForConn(c *gitsession.Conn) Handlers`; `handleRepoOpen`/`handleRepoClose` take the `*gitsession.Conn`; `mapGitError` (D6); `Deps` reshaped (D18) |

`Handlers` stays gitrpc's own two-function struct (`handlers.go:20-23`) — G1 §3.4's layering
resolution is unchanged and still correct: `gitrpc` must not import `internal/bridge`.

**No test.** Still thin dispatch over already-tested code (`AGENTS.md`'s pass-through exclusion);
the behaviour that matters is §3.9's end-to-end proof.

### 3.8 `internal/gitsock/` — edited (D19)

| File | Change |
|---|---|
| `server.go` | `Deps.Handlers` → `Deps.Router *gitrpc.Router`; `Deps.Registry *gitsession.Registry`; `handleConn` rewritten per D19; `Close()` also calls `Registry.Close()` |
| `handshake.go` | `runHandshake` returns `(clientID, sessionID string, ok bool)`; the two `uuid.NewString()` calls (`:102`, `:162`) become one, minted before the branch and reused in `ready` |
| `handshake_test.go` | updated for the third return value; every existing arm otherwise unchanged |

`frame.go`, `lock.go`, `pairing.go`, `token.go`, `clients.go` are untouched.

### 3.9 `internal/gitsock/integration_test.go` — extended (§7.1(c))

The existing `TestIntegration_FullPairingAndRPCLifecycle` stays as it is. Two new tests over the same
harness (`:161-198`'s `newIntegrationServer`, `:200-221`'s `initFixtureRepo`, `:66-159`'s framing
client), plus one helper: `(*testClient).recvEvent()`, which reads frames until it sees
`{"t":"evt","method":"repo.changed"}` and decodes its payload.

- **`TestIntegration_RepoChangedReachesEveryHolder`** — two clients pair and both `repo.open` the
  same fixture repo; the test then runs a real `git commit` in it and asserts **both** connections
  receive `repo.changed` with `kind:"refsChanged"` and the same `repoId`; then `git add` a new file
  and asserts `kind:"worktreeChanged"`.
- **`TestIntegration_RefcountAndDisconnectTeardown`** — client A and client B both `repo.open`;
  A sends `repo.close` and B still receives a `repo.changed` for a subsequent commit (F7's bug,
  now provably fixed); then B's socket is closed from the test side and, after the registry's
  `lingerFor` (set short via the test's own `Registry`), the entry is gone — asserted through an
  exported-for-test `Registry.Len()` or, preferably, by observing that a fresh `repo.open` yields a
  *different* `*RepoEntry` identity via a counter the test increments in the injected
  `newWatcher`. Prefer the latter: it needs no production accessor that exists only for a test.

### 3.10 `main.go` — edited

```go
gitRunner := gitclient.NewExecRunner()
gitDiscovery := gitclient.NewDiscovery(gitclient.NewPlatformLocator(), gitRunner, gitclient.NewRealClock())
gitRegistry := gitsession.NewRegistry(gitRunner)
gitSock := gitsock.New(gitsock.Deps{
    SocketPath:    filepath.Join(config.KiraHome(), "git.sock"),
    LockPath:      filepath.Join(config.KiraHome(), "git.sock.lock"),
    Clients:       repositories.GitClients,
    Registry:      gitRegistry,
    Router:        gitrpc.New(gitrpc.Deps{Discovery: gitDiscovery, Runner: gitRunner, Registry: gitRegistry, ServerVersion: buildinfo.Version}),
    ServerVersion: buildinfo.Version,
    Now:           time.Now,
})
```

replacing `main.go:98-106`. `gitclient.NewClient` is deleted along with `Client`'s registry field
(D18), so the `gitCli` variable goes. Everything else in the startup order, the `teardown` closure
and the bound-service list is unchanged.

**No bindings regeneration is needed**: `bridge.GitClientsService`'s method set does not change, and
`AGENTS.md`'s `-names` warning applies only when it does.

---

## 4. The frontend — both of them — is untouched

**G2 changes no TypeScript, no Vue, and no root config.** Stated explicitly because "wire
`repo.changed` to the UI" is the obvious next thought and is not this phase's:

- `packages/git-ipc` already declares `repo.changed` and already routes it (`validate.ts:96`,
  `rpc.ts:195-199`). Nothing to add.
- `packages/git-ui` consumes it through the two webview view providers, which `activate()`
  deliberately does not register until G3 (G1 D13). Exposing an `on()` passthrough on
  `ConnectionManager` now would be a seam with no consumer.
- Kira Studio's own Wails frontend has no git surface beyond G1's *Connected editors* pane, and SPEC
  keeps it that way for all of v1.3.

Consequence for the proof surface: `bun run lint`, `bun run typecheck` and `bun run test:unit` must
stay green, and are expected to be **unchanged**, not merely passing. If a G2 change makes any of
them differ, something has drifted out of scope.

---

## 5. The one new dependency

`go.mod`: `github.com/fsnotify/fsnotify v1.10.1` moves into the direct `require` block;
`golang.org/x/sys` (currently `go.mod:119`, indirect) is promoted to direct by `go mod tidy` if
tidy decides so — either is fine, but the diff must be `go mod tidy`'s own output, not hand-edited.
`go.sum` gains both. Nothing else.

Verified here before writing this plan: the module resolves through the proxy, downloads, is
BSD-3-Clause, is cgo-free, and needs no dependency this repo does not already have (D7).

---

## 6. Implementation order

Seven commits. `go build ./apps/kira-studio/internal/...` and
`go test ./apps/kira-studio/internal/...` run after **each** — they are fast and need nothing but
the Go toolchain (`AGENTS.md`). `bun run lint`/`typecheck` run once at the end and must be
unchanged (§4). The expensive tier (§7.1(d)) runs once at C7, per `AGENTS.md`'s "implement the whole
plan first, then test once".

- **C1** `feat(gitclient): streaming runner primitive, full env/argv hygiene, process-group kill`
  — §3.1 in full, plus the six mechanical call-site updates and `discovery_test.go`'s fake. The
  package must build and every existing `gitclient` test must pass, unchanged in meaning.
- **C2** `fix(gitclient): bound the git --version probe and summarise git error messages`
  — §3.2 + §3.3. Two small, independent corrections that both change assertions in existing tests,
  which is why they land together rather than inside C1's much larger diff.
- **C3** `feat(gitclient): fsnotify repo watcher replacing the polling design`
  — §3.4, plus §5's `go.mod`/`go.sum`. Nothing consumes it yet; it must compile and its own tests
  must pass on their own.
- **C4** `feat(gitsession): refcounted repo registry, entries and per-connection holds`
  — §3.5. A new, self-contained package with no importer yet. **This commit adds; it deletes
  nothing** — `gitclient.Registry` is still there and still wired, so the tree keeps compiling.
- **C5** `refactor(rpcstream): export Session so a server can emit events`
  — §3.6. One rename plus one method move; `gitsock/server.go:178` is updated in the same commit
  because it is the only caller.
- **C6** `feat(git): serve repos through the refcounted registry, one session per connection`
  — §3.7 + §3.8 + §3.10, and the deletions in `gitclient` (D18). **This is the atomic swap** and
  cannot be split: `gitclient.Registry` disappearing, `gitrpc` becoming a router, `gitsock` minting
  a `gitsession.Conn`, and `main.go` rewiring are one change that either compiles together or not
  at all. After this commit the whole phase's behaviour is live.
- **C7** `test(gitsock): repo.changed fan-out, refcounting and disconnect teardown over the real socket`
  — §3.9, plus the full §7.1 run.

Dependency order: C1 before everything (every other commit compiles against the new `Runner`).
C2 after C1 (it edits code C1 just touched). C3 before C4 (the entry owns a watcher). C4 and C5
before C6 (C6 imports both). C6 before C7 (nothing to integration-test until the swap lands).

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 What is proven automatically, in this container

**(a) `go test ./apps/kira-studio/internal/gitclient/...` — no Docker, no display, real `git`.**

- Runner: `buildEnv`/`buildArgv` produce D2's exact slices; a streamed read delivers bytes before
  `Wait` returns; cancellation unblocks the reader and returns promptly; `Close` is idempotent; a
  backgrounded grandchild does not hold the stdout pipe open (§3.1). The last of these is the only
  proof D3's `Setpgid` does anything.
- Discovery: a runner that never answers yields `unusable` with the timeout reason, without the test
  sleeping (§3.2).
- Errors: a classified failure's `Error()` is one line naming the argv and the kind (§3.3).
- Watcher: the classification table, both worktree shapes; and against a **real** `git init`
  fixture — a commit produces one `refsChanged`, `git add` produces `worktreeChanged`, a burst
  coalesces, and a branch created under a brand-new `refs/heads/<ns>/` directory is seen on its
  *second* update as well as its first (§3.4).

Linux/inotify is the backend exercised here; §7.2 covers what that leaves unproven.

**(b) `go test ./apps/kira-studio/internal/gitsession/...` — pure Go, fake watcher, no filesystem.**
Refcount × linger × re-acquire, `Conn` dedupe, and the subscriber fan-out's coalescing and
slow-consumer isolation (§3.5). These are `AGENTS.md`'s named test-worthy categories — cache
eviction with interacting rules, and concurrency/backpressure — and they are the phase's most
intricate state.

**(c) `go test ./apps/kira-studio/internal/gitsock/` — the real socket, the real `git`, real
frames.** §3.9's two new tests, over G1's existing harness and its `lookPathLocator` seam (F18).
This is where `repo.changed` is proven to cross the wire to *every* holder, where F7's
close-affects-everyone bug is proven fixed, and where disconnect teardown is proven. **This is the
phase's real proof.**

**(d) `bun run test:e2e-real` — unchanged and still green.**
`tests/e2e-real/git-pairing-real.spec.ts` asserts `app.init` → `{kind:"notFound"}` and `repo.open` →
`{kind:"gitUnavailable"}` on Linux. G2 adds **no** new e2e spec, deliberately: F18 shows a
`-tags server` binary in this container cannot open a repository at all, so there is no `RepoEntry`,
no watcher and no `repo.changed` to observe at that tier. Adding a spec that only re-asserts the
`gitUnavailable` path would be a test that cannot fail for a G2 reason. The spec's continued passing
*is* the regression check that D18's rewiring did not break the un-openable path.

**(e) `bun run lint` / `bun run typecheck` / `bun run test:unit` — green and unchanged** (§4).

**(f) `go test ./apps/kira-studio/internal/` — the layering test still passes**, with
`internal/gitsession` auto-enumerated and **not** added to `packagesExemptFromBridgeCheck`
(`layering_test.go:29-43`). If the implementer finds themselves wanting to exempt it, `Conn.Emit`
has been typed against `rpcstream` instead of being a plain `func` — that is the mistake this check
catches.

### 7.2 What genuinely cannot be proven here, and the macOS script for it

Three things are structurally out of reach in this container, and none is papered over:

1. **The kqueue backend.** Every watcher test above runs against inotify. macOS uses an entirely
   different fsnotify backend with different semantics (F10's per-file descriptors,
   `nodeFileWatcher.ts:1-11`'s note that FSEvents-style coalescing makes an event's `kind`
   untrustworthy — which is why `classify` never reads `Op`).
2. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` here (F18), so the probe
   order, the CLT-shim gate and D5's timeout against a real `/usr/bin/git` are all Linux-invisible.
3. **A real VS Code extension host**, unchanged from G1 §8.2 — and G2 adds no extension code, so
   this is only a regression check.

The macOS script, to be run once on real hardware before G2 is called done:

1. **`go test ./apps/kira-studio/internal/...`** on macOS. This is not a weaker substitute for
   §7.1 — it is the *same* suite on the backend that actually ships, and it is the only thing that
   exercises kqueue at all.
2. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`;
   `code --extensionDevelopmentPath=<repo>/apps/kira-studio-vscode` on a real repository; pair.
3. *Kira Version: Show Connection Status* → connected, `git` reported `ok` with the machine's real
   version. *Kira Version: Open Repository* → `ok`, real branch name and git dir. (G1's exit
   criterion, re-run: D18 rewired both paths.)
4. **Open a second VS Code window** on the same repository, pair/reconnect, run *Open Repository*
   there too. Close the *first* window's repository (reload that window) and confirm the second
   window's *Open Repository* still answers `ok` — F7's bug, checked by hand at the level a user
   would hit it.
5. **The descriptor cost (F10), the one question only macOS can answer**: with the repository open,
   `lsof -p $(pgrep -f 'Kira Studio') | grep -c '/\.git/'`. Record the number against the
   repository's loose-ref count (`find .git/refs -type f | wc -l`). Expect roughly one per loose ref
   plus a handful. A number in the low thousands is the expected shape; anything near
   `sysctl kern.maxfilesperproc` (24576 by default) is the signal that §10's hand-forward needs
   acting on before G11.
6. **A wedged git binary**: point `git.path`… — there is no setting for it yet (G7), so instead
   temporarily shadow `git` on `PATH` with a shell script that `sleep 60`s, restart Kira Studio, and
   confirm *Show Connection Status* reports the git status as unusable **within about five seconds**
   rather than hanging (D5). Remove the shim afterwards.
7. `kill -9` Kira Studio while a repository is open, relaunch, re-pair/reconnect, and confirm
   `repo.open` works — the stale-socket path (G1 D5) with a registry attached.

### 7.3 The checklist

- [ ] `Runner` is one method (`Start`); `Run` is a package function over it; there is exactly one
      `exec.Command` in the package.
- [ ] Every git spawn carries all four `-c` overrides, `--no-pager`, `--no-optional-locks` on reads
      only, and all five hygiene env entries including `LC_ALL=C`.
- [ ] Every git child is its own process group; cancellation sends SIGTERM to the group and Go
      escalates after 2 s; a backgrounded grandchild cannot hold the stdout pipe open.
- [ ] stderr is drained on its own goroutine and capped at 1 MiB with a truncation marker.
- [ ] A `--version` probe that never answers yields `unusable` within 5 s, not a hang.
- [ ] A git failure's `Error()` is one line; the full stderr stays on the struct.
- [ ] A git failure crosses the wire as `E_GIT_<KIND>`, never as an anonymous `E_INTERNAL`.
- [ ] `gitclient/watcher.go` exists, uses `fsnotify v1.10.1`, watches directories only, strips
      `.lock`, and covers `commonDir`, a linked worktree's `gitDir`, and every directory under
      `commonDir/refs` including ones created later.
- [ ] A burst of ref writes produces one debounced `refsChanged`, ~200 ms after the first.
- [ ] `internal/gitsession` exists; `Registry.Acquire` refcounts; a second holder keeps the entry
      alive; refcount zero arms a 5-minute linger; a re-acquire inside the window reuses the entry;
      expiry stops the watcher and drops the entry.
- [ ] `repo.open` twice from one connection takes one ref; one `repo.close` fully releases it.
- [ ] A disconnect releases every ref that connection held.
- [ ] `repo.changed` reaches **every** connection holding the repo, with the contract's exact
      payload, and a slow subscriber delays nobody else.
- [ ] `gitclient.Registry` no longer exists; there is exactly one registry type in the tree.
- [ ] `rpcstream.Session` is exported, `Emit` has a production caller, and `Handlers.Stream` is
      **unchanged** (G3's).
- [ ] `CONTRACT_VERSION` is still 12 on both sides; no request/event/stream key was added or
      removed.
- [ ] No TypeScript, Vue or root-config file changed.
- [ ] `internal/gitsession` is **not** in `packagesExemptFromBridgeCheck`.
- [ ] §7.1(a)–(f) all green; §7.2's seven macOS steps all pass.

---

## 8. Sequencing — one implementer

**Recommendation: one sequential Sonnet subagent for the whole phase.**

The tempting split is "gitclient (C1–C3) in parallel with gitsession (C4–C5)". It is a bad trade
here for three reasons:

1. **C4 is written against C1's interface.** `gitsession.Registry` holds a `gitclient.Runner`, and
   `RepoEntry` holds a `gitclient.RepoWatcher` that C3 creates. An agent starting C4 before C1/C3
   land is implementing against this plan's prose rather than against a compiler, and every
   discrepancy surfaces at C6 — the one commit neither agent would own.
2. **C6 is a single atomic swap across four packages** (§6). It cannot be parallelised at all, it is
   where every real risk in the phase lives, and it wants the whole of C1–C5 in one head.
3. **`AGENTS.md` is explicit**: parallel subagents "only when the plan's work is genuinely
   independent (unrelated adapters, non-overlapping fixes)". A driver rewrite and the session layer
   built on top of it are the textbook case of *not* that.

**If the orchestrator does choose to parallelise anyway**, the only defensible cut is **C3 alone**
— `gitclient/watcher.go` plus its tests and the `go.mod` entry — run concurrently with C1–C2. It
touches no file C1/C2 touch, and it depends on nothing in the runner rewrite (the watcher spawns no
process). Everything from C4 onward stays sequential behind both.

---

## 9. Explicit non-goals for G2

Things that could plausibly be mistaken for this phase's work, with the phase that actually owns
them:

| Not in G2 | Owner |
|---|---|
| Porcelain parsing of any kind; `gitclient/porcelain`; the golden fixture corpus | G3 |
| The paged `git log` session, pause/resume, `--skip` fallback, `idleReclaimMs` | G3 |
| `cat-file --batch` and the stdin pipe the runner would need for it (§10) | G3 |
| The commit store, interner, `PackedCommitChunk`, `graph.stream` | G3 |
| FlatBuffers payloads, `gitWire.fbs`, `internal/gitwire`, any `flatc` run | G3 |
| Widening `rpcstream.Handlers.Stream` to carry an `emit` (G1 §11) | G3 |
| Registering the graph/review webview providers; any client-side `repo.changed` consumer | G3 |
| Surfacing the 2.38 blocked state in the extension's UI (`GitBlockedPanel.vue`) | G3 |
| `repo.list` / `repo.pick`; the seven host-capability methods answered client-side | G4 |
| `status.get`, and therefore any decision about unstaged-edit visibility (D9) | G4 |
| Any write operation; `Repo.Write`'s first real caller; the driver's write `generation` counter | G5 |
| `capabilitiesForVersion` and the two capability caches (D16) | G5 (per-binary), G5 (per-repo, with `generation`) |
| Pre-flight, the undo slot, protected branches | G5 / G9 |
| The per-connection `Walk` (SPEC §6's `Conn.walks`) | G6 |
| The askpass broker, the credential relay, auto-fetch, server-owned settings | G7 |
| "A write already in flight is never killed by a client disconnect" (SPEC §6) — no write exists to detach | G5 (the rule), G7 (the remote-op case) |
| Two-window/two-repo matrix, revoke-while-connected, perf re-baseline | G11 |
| Any embedded git UI in Kira Studio's Wails frontend | out of scope for v1.3 |

---

## 10. Handed forward

Open items this phase found and deliberately did not close. Each belongs in the named phase's own
plan, not in `AGENTS.md`.

- **`Spec` has no `Stdin` and no `Env`, by design.** `cat-file --batch` needs a writable stdin
  (`catFile.ts:237-247`) and G7's askpass needs per-spawn env additions merged over the hygiene set
  (`driver.ts:120-122`, `:518`). Both are one field on `Spec` plus one on `Process`
  (`Stdin() io.WriteCloser`), and both are omitted here because G2 has no caller for either.
  **G3** adds stdin; **G7** adds `Env`.
- **The bounded read pool is deliberately bypassed by G3's two long-lived processes** (F13).
  `Repo.Read`/`Repo.Write` remain the gate for burst reads; `logsession` and `catfile` call the
  `Runner` directly, as upstream does. **G3** should not "fix" this by routing them through the
  gate — `logSession.ts:1-18` explains why it would hold a quarter of the repository's read
  concurrency hostage forever.
- **`repo.changed` has no consumer on the extension side until G3.** The event is emitted, the
  contract admits it, and `createRpcClient`'s `on()` already routes it — but `ConnectionManager`
  (`apps/kira-studio-vscode/src/connection.ts`) exposes only `request`. **G3** adds an `on()`
  passthrough when `panelView.ts`/`reviewView.ts` are registered, replacing G1 §5.5's
  `service.onChanged` forwards.
- **Unstaged worktree edits produce no event** (D9). `worktreeChanged` fires on `<gitDir>/index`
  only, matching upstream. **G4** owns `status.get` and is the first phase that can judge whether
  that gap is visible to a user; if it is, the answer is an explicit refresh on view focus, not a
  recursive worktree watch.
- **On macOS every watched directory costs one file descriptor per file in it** (F10), and no test
  in this repo can observe it (inotify does not). §7.2 step 5 is the manual measurement. **G11**'s
  perf re-baseline should carry a repository with a deliberately large loose-ref set, and if the
  number is uncomfortable the fix is a `git pack-refs`-aware strategy (watch `refs/` directories but
  not their files) that `fsnotify` cannot express today and would need a different watcher.
- **`capabilitiesForVersion` and the two capability caches are unported** (D16/F17). **G5** owns
  both, alongside `merge-tree --write-tree` and the write `generation` counter the per-repo cache is
  keyed by.
- **A `RepoEntry` retained through the linger window keeps its watcher running** (D12), which is
  what makes its future caches safe to reuse on re-acquire. **G3** must keep that property when it
  adds the commit store: if a later phase ever decides to stop the watcher at refcount zero, every
  cache on the entry has to be invalidated on re-acquire, and that coupling should be stated where
  the caches are added rather than rediscovered.
- **`CONTRACT_VERSION` is still duplicated across languages by hand** (G1 D20). Unchanged by this
  phase — G2 adds no contract key — and still cheap to keep honest while it is one integer.
