# P83 — Embedded terminal, the tab strip's "+" button, and three Git-panel additions

`docs/v1.8/SPEC.md`'s P83 row (`:146`), turned into concrete steps. Everything below was read in
the current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `dc8867f5`, P71-P82 landed); line
numbers are from that tree.

Four items, one phase. The first is genuinely new infrastructure — a Go PTY, a new bound service,
a new push channel, a new tab kind, a new renderer dependency. The other three extend P82's own
`GitPanel.vue`/`repo/state/worktrees.ts` markup and are independent of it (§19 states which commits
can run concurrently).

The central question is not xterm.js or `creack/pty`. It is **which IPC seam a PTY may cross.**
SPEC's own parenthetical points at the git `Transport`; §3 shows why that is the one seam it must
not use, and what this repo already has that fits.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| PTY library | **`github.com/creack/pty` v1.1.24, MIT** (Keith Rarick; `LICENSE` read directly from the module zip, not a badge). Unix-only by construction — `start_windows.go` returns `ErrUnsupported` | §2.1 |
| What "Windows/Linux/macOS native builds" means here | **The premise is false.** `apps/kira-studio/Taskfile.yml:26`-`33` includes exactly one platform Taskfile (`darwin`), `build:` is `darwin:build`, and `docs/ARCHITECTURE.md:516` says "Linux — development/CI only, v1 targets macOS" / `:1692` "Windows (the app does not ship there)". So: darwin ships, linux is the dev/CI loop, Windows is out of scope and needs no ConPTY work | §2.2 |
| Which shell | `$SHELL` when set and executable, else the user's `passwd` shell, else `/bin/sh`. Started as a **login, interactive** shell (`-l -i`) | §2.3 |
| IPC mechanism | **A new Wails bound service (`TerminalService`) plus one `EmitTo` push channel (`kira:terminal:data`)** — `grpcCall`/`codeSearch`'s own shape (`bridge/codeworkspace.go:417`-`490`). **Not** the git contract | §3 |
| Why not the git `Transport` | `gitsock/server.go:210`-`213` hands `Router.ForConn(gconn)` to an **externally paired client** with no allowlist wrapper. Any method the gitrpc router dispatches is reachable from outside this process. A PTY spawn plus arbitrary stdin is exactly what `gitstream.go:53`-`59` already refuses `worktree.prepare` for | §3.1 |
| `CONTRACT_VERSION` bump | **No.** `CONTRACT_VERSION` (`validate.ts:151`) / `ContractVersion` (`gitrpc/contract.go:156`) version the *git* contract only. P83 adds no contract method, no `UiActionKind`, no `app.init` capability — so no bump, no `stash_test.go` rename, no `graphChunkFrame.{bin,json}` regen | §18 |
| Renderer terminal | **`@xterm/xterm` 6.0.0 + `@xterm/addon-fit` 0.11.0, both MIT**, both published 2025-12-22 by the `xtermjs` org (`tyriar`). The bare `xterm` package is deprecated in favour of this scope | §6.1 |
| Scrollback owner | **Frontend only** (xterm's own buffer, `scrollback: 5000`), held in a module-level renderer registry that survives `MainView.vue`'s unmount. Go keeps no per-session history — only a small drain queue for the window before the first renderer attaches | §5.2, §6.3 |
| More than one terminal per worktree | **Yes.** `openTab(..., { reuse: false })` — `openConsoleTab` (`state/tabs.ts:507`) already establishes "a session, not a document, so always a fresh tab" | §7.3 |
| Close / reopen | Close is final: `dropResources` kills the PTY. There is no reopen of a *dead* session; "reopen" means opening a new terminal at the same cwd | §7.4 |
| Do terminal tabs persist across a restart | **No.** Filtered out of `persistableTabs()` (`state/tabs.ts:132`-`134`), the same one-line filter incognito already uses. A restored row would be an empty terminal wired to a process that died with the last run | §7.5 |
| Where the cwd comes from | `code_repos.root` **is** the current worktree's directory — `gitclient.Identify` sets `Root` from `rev-parse --show-toplevel` and `RepoID` to it (`gitclient/repo.go:212`-`215`), which for a linked worktree is that worktree's own dir. For a specific worktree row, `WorktreeEntry.path` from `worktree.list` is `gitsession`'s own resolution (`gitsession/worktree.go:90`). No new path plumbing | §8.1 |
| Worktree removed while a terminal is open | **Keep it alive, do nothing.** No directory watch, no auto-close, no cwd rewrite — the shell behaves exactly as an external terminal does when its cwd is unlinked | §8.2 |
| Where the right-click item goes | **`GitPanel.vue`'s repo-row menu, plus a new worktree-row menu** — not `git-ui`'s `rowMenuModel.ts`. Five reasons, and the full cost of the `rowMenuModel.ts` alternative | §10.1, §10.2 |
| The "+" dropdown's shape | `openContextMenuAt(x, y, items)` (a 3-line addition to `state/contextMenu.ts`) anchored under the button — a real `MenuItem[]`, one entry today, so P84 appends rather than redesigns | §9 |
| Indicator: icon or badge | **A `terminal-bash` codicon in the row's trailing slot**, tooltip carrying the count — the exact slot and colour `.worktree-badge-icon` (`GitPanel.vue:512`-`515`, the lock glyph) already occupies | §11.2 |
| Where a repo row's HEAD comes from | Not in `RepoSummary` (`shared/domain/repo.ts:6`-`13` — six fields, no head). One **new batched bound call**, `CodeWorkspaceService.RepoHeads`, over `gitclient.ResolveHead` (`gitclient/repo.go:251`, already exists) | §12.1 |
| What refreshes it | Panel mount, `codeReposState.records` change, and `repo.changed`/`refsChanged` for every **already-open** repo workspace (no new transport is created for a merely-listed repo) | §12.3 |
| Is the worktree order really incidental | **No — SPEC is wrong here, stated plainly.** `gitsession/worktree.go:92` sets `IsMain: i == 0` positionally, on a probe-verified git property (`:73`-`:76`: "`worktree list`'s own first record is always the main worktree"). The sort is a render-layer guarantee, not a bug fix | §13 |
| Any unit test | **Yes, one: a Go test around `internal/terminal`'s session lifecycle** (spawn, resize applied to the real winsize, close kills the process, double-close, read-after-close). Concurrency plus cleanup ordering — `CLAUDE.md`'s bar, the same shape P76's `blame-line-controller.spec.ts` cleared | §17.1 |
| A Playwright test for real shell I/O | **No, and no fake substitute.** §17.3 states the boundary and what the UI test does instead | §17.3 |

---

# Part A — the terminal

## 1. What exists today

### 1.1 The tab-kind registry

Four vocabularies, three of them compiler-checked and one not:

- **`packages/shared/domain/tabs.ts:8`-`41`** — `tabKindSchema`, 14 kinds.
- **`:48`-`:63`** — `RENDERABLE_TAB_KINDS`; **`:80`-`:94`** — `TAB_KIND_MODE` (`'repo'` is a
  sentinel: the workspace comes from the record's own `workspaceId`).
- **`:379`-`:393`** — `tabRecordSchema`'s discriminated union, one `z.object` per kind.
- **`apps/kira-studio/internal/storage/model/tabs.go:30`-`54`** — `RenderableTabKinds`, plus
  **`:59`** `repoTabKinds` (the subset requiring a non-nil `WorkspaceID`). This is the one with no
  compiler behind it; `tests/unit/go-ts-vocabulary-parity.spec.ts:48`-`56` asserts set equality
  against `RENDERABLE_TAB_KINDS`, so **adding a TS kind without the Go line fails that test**, not
  silently at runtime.

`state/tabKinds.ts:93`-`122` is `TabKindDef`: `mode`, `title`, `icon`, `railColor`, `defaultState`,
`parseState`, `duplicateState`, `dropResources`, `menuExtras`, optional `badge`/`pinned`.
`workbench/tabViews.ts:22`-`41` is its component half (`TAB_VIEWS`), split because `state/` →
`workbench/` is a lint-forbidden edge.

`dropResources` is the close hook and it is **blind-called for every kind** on every close
(`state/tabs.ts:54`-`58`, `dropPageStoresForTab`), reached from both `closeTabInternal:652` and
`closeWorkspaceTabs:684` via `dropAllPagesForTab:64`. One registry lookup by tab id is a no-op miss
for every non-terminal tab — that is the mechanism, not a new one.

### 1.2 The tab strip

`workbench/panels/TabStrip.vue`: `.tab-strip-wrapper` (`:198`) holds two children — the fixed
`.tab-strip-pinned` slot (`:204`-`:231`, outside the scroller, P72 §7) and the scrolling
`.tab-strip` (`:232`). There is **no "+" control anywhere**, and no button in this app opens a menu
on a left click today (`openContextMenu` has 20 call sites, all `@contextmenu`).

`MainView.vue:31` mounts only the active tab's view, with `KeepAlive :include="['RepoGraphView']"`
(`:25`). A terminal view therefore **unmounts on every tab switch** — §5.2 is why that is fine.

### 1.3 The two IPC surfaces

- **Bound Wails services** (`bridge/index.ts`, `@bindings/*`) plus `Events.On` push channels
  (`shared/protocol/events.ts`'s `CHANNEL`, mirroring `internal/bridge/events.go`). Reachable only
  from this process's own webview.
- **Two named streams**, `"engine"` (`bridge/stream.go:22`) and `"git"` (`bridge/gitstream.go:17`),
  the latter carrying `@kira/git-ipc`'s versioned contract.

The streaming precedent that matters is `codeSearch` (`bridge/codeworkspace.go:386`-`490`): a bound
call returns a handle immediately, a goroutine does the long work, and a coalescer pushes batches
with `emit.EmitTo(windowKey, ChannelCodeSearch, …)` — one window only, addressed by a `windowKey`
the renderer passes in its own args (`:497`, `:519`-`:520`). `tests/ui/support/mockRuntime.ts:647`'s
`emitWailsEvent` drives that channel from a Playwright test.

## 2. The Go PTY

### 2.1 The library

`github.com/creack/pty`, **v1.1.24** (2024-10-31), **MIT** — verified by downloading
`proxy.golang.org/github.com/creack/pty/@v/v1.1.24.zip` and reading `LICENSE` ("Copyright (c) 2011
Keith Rarick", full MIT permission text). No dual licence, no tiered feature set, no paid edition:
the package is 37 files of `ioctl`/`openpt` per BSD flavour plus `StartWithSize`. `go.mod` declares
no dependencies of its own.

`CLAUDE.md`'s library-first rule is satisfied in the strongest form available: hand-rolling means
`posix_openpt`/`grantpt`/`unlockpt`/`ptsname` and the `TIOCSCTTY`/`TIOCSWINSZ` ioctls per OS, in
raw `syscall`, with no pure-Go alternative that is not itself a fork of this package. Nothing about
this app's requirements is unusual enough to decline it.

The whole of what P83 uses:

```go
ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols}) // start_unix.go
err = pty.Setsize(ptmx, &pty.Winsize{Rows: rows, Cols: cols})            // winsize.go
```

### 2.2 Platform reality — correcting the prompt's premise

This app ships **macOS only**. `apps/kira-studio/Taskfile.yml:26`-`28` includes exactly two
Taskfiles, `./build/Taskfile.yml` (shared) and `./build/darwin/Taskfile.yml`; `build:`, `package:`,
`run:` all delegate to `darwin:*`; `apps/kira-studio/build/` has one platform directory, `darwin/`.
`docs/ARCHITECTURE.md:516` states it outright, and `:1692` records Windows as "the app does not
ship there". There is not one `//go:build windows` or `//go:build linux` file anywhere under
`apps/kira-studio/internal/`.

So, per OS:

- **darwin** — the ship target. `creack/pty`'s `pty_darwin.go` path, fully supported.
- **linux** — the dev/CI loop and the Go test tier. `pty_linux.go`, fully supported.
- **windows** — not built, not shipped, not tested. `creack/pty`'s `start_windows.go` returns
  `ErrUnsupported`; `internal/terminal` surfaces that as `E_UNSUPPORTED` with the message
  "an embedded terminal is not available on this platform", and no ConPTY work is done. This is
  a real behaviour, not a stub: nothing is half-implemented, the one code path that exists on that
  platform is a clean refusal the UI renders as an error row.

### 2.3 The shell

```go
// internal/terminal/shell.go
func loginShell() string {
    if s := os.Getenv("SHELL"); s != "" {
        if info, err := os.Stat(s); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
            return s
        }
    }
    if u, err := user.Current(); err == nil && u.HomeDir != "" {
        if s := passwdShell(u.Username); s != "" { return s }
    }
    return "/bin/sh"
}
```

`passwdShell` reads `/etc/passwd`'s seventh field for the current user; on macOS that file does not
carry a real entry for a directory-service user, so the `$SHELL` branch is what answers in practice
and `/bin/sh` is the honest floor. **No `dscl`/`getent` subprocess** — a fallback shell is not worth
a spawn.

Started as `exec.Command(shell, "-l", "-i")`: login so the user's own `.zprofile`/`.bash_profile`
runs (PATH, nvm, asdf — the reason an embedded terminal is useful at all), interactive so the prompt
and job control behave. `cmd.Dir` is the requested cwd. `cmd.Env` is `os.Environ()` plus:

| Var | Value | Why |
|---|---|---|
| `TERM` | `xterm-256color` | what `@xterm/xterm` actually emulates |
| `COLORTERM` | `truecolor` | xterm.js renders 24-bit colour |
| `TERM_PROGRAM` | `Kira Studio` | the convention every terminal host follows |
| `TERM_PROGRAM_VERSION` | `buildinfo.Version` | ditto; the constant already exists |
| `LANG` | unchanged | inherited; never invented — a wrong locale breaks UTF-8 output |

`cmd.SysProcAttr` sets `Setsid: true`; `pty.StartWithSize` already makes the pty the controlling
terminal. A new session means `Close` can signal the **whole process group** (`syscall.Kill(-pid,
SIGHUP)` then `SIGKILL` after a grace period), so a `npm run dev` left running inside the terminal
dies with the tab instead of outliving it.

## 3. The IPC seam

### 3.1 Why not the git contract — the decisive read

`internal/gitsock/server.go:210`-`213`:

```go
handlers := s.deps.Router.ForConn(gconn)
sess := rpcstream.NewSession(conn, rpcstream.Handlers{
    ContractVersion: gitrpc.ContractVersion,
    Request:         handlers.Request,
```

No wrapper. `gitsock` is the socket the **paired VS Code extension** talks to (`gitsock/pairing.go`,
`handshake.go`). `bridge/gitstream.go:148`-`156`'s `allowedRequest` allowlist protects the *native*
stream only; it does nothing for that socket. So **any method added to `gitrpc.Router`'s dispatch is
immediately reachable by an external paired client.**

`gitstream.go:53`-`57` already names the shape of the risk in this exact repo:

> `worktree.prepare`/`worktree.cancelPrepare` — `RunPrepare` executes a user-stored shell command
> with no human-approval gate anywhere in this codebase […] a security boundary, not a file-editing
> one.

A PTY handler is that, without even the "does this match what's currently stored" check: an
arbitrary shell plus arbitrary stdin. Putting terminal methods on the git contract would widen a
cross-process boundary for a feature that has no cross-process consumer. It would also drag the VS
Code extension (which has its own terminals) through a `CONTRACT_VERSION` bump for a Kira-only
affordance.

The three host-answered contract methods (`review.open`, `editor.openDiff`, `graph.revealCommit`)
are not a counter-example: each is answered in `hostHandlers.ts` and never dispatched by
`gitrpc.Router`, so `gitsock` returns method-not-found for them. That route would work
*technically*, but it still spends a contract version and a git-ui dependency on something the git
contract has no business describing.

### 3.2 What P83 uses instead

A bound Wails service plus one push channel — `grpcCall`/`codeSearch`'s own shape. Reachable only
from this process's webview; no external peer, no allowlist to maintain, no version to bump.

`internal/bridge/terminal.go`, `TerminalService`:

| Method | Args | Result | Notes |
|---|---|---|---|
| `Open` | `{terminalId, cwd, cols, rows, windowKey}` | `{shell}` | `terminalId` is **client-supplied** (the tab id), so the renderer subscribes before spawning and no output can race the subscription. `CodeWorkspaceSearchArgs.ID` (`codeworkspace.go:497`) already establishes a client-supplied id on this surface |
| `Write` | `{terminalId, data}` | — | `data` is base64; keystrokes are not always valid UTF-8 (paste, Alt-meta, mouse reports) |
| `Resize` | `{terminalId, cols, rows}` | — | `pty.Setsize` |
| `Close` | `{terminalId}` | — | idempotent |

`Open` validates: `terminalId` non-empty and not already live (`E_INVALID`); `windowKey` non-empty
(`codeworkspace.go:519`'s own check); `cols`/`rows` within `[1, 1000]`; `cwd` absolute, existing and
a directory (`os.Stat`). **The cwd check is not a trust boundary and must not be described as one**
— the shell it starts is the user's own and can `cd` anywhere on its first line. It exists so a
stale path fails with a clear `E_INVALID` instead of a confusing exec error.

Push channel, `internal/bridge/events.go` beside `ChannelCodeSearch:58`:

```go
// ChannelTerminal is P83's own push channel — one terminal's output and its exit, EmitTo'd to the
// one window that opened it, exactly like ChannelCodeSearch above.
ChannelTerminal = "kira:terminal:data"
```

```go
type TerminalEvent struct {
    TerminalID string `json:"terminalId"`
    Data       string `json:"data,omitempty"`     // base64, absent on the exit event
    Exited     bool   `json:"exited"`
    ExitCode   *int   `json:"exitCode,omitempty"`
    Error      string `json:"error,omitempty"`
}
```

Mirrored in `packages/shared/protocol/events.ts` (`CHANNEL.terminal`) and
`apps/kira-studio/frontend/src/bridge/index.ts` (`terminalOpen`/`terminalWrite`/`terminalResize`/
`terminalClose`/`onTerminal`).

### 3.3 Coalescing

A build's output arrives in kilobyte bursts; one `EmitTo` per `read()` would flood the bridge.
Reuse `searchCoalescer`'s exact rules (`codeworkspace.go:417`-`490`), restated for a byte payload
rather than generified — the same call `newSearchCoalescer` itself made against `grpcCoalescer`
("the two payloads share no field"):

- flush on **16 KiB** accumulated, or
- flush on a **16 ms** timer (one frame), whichever first;
- the exit event always flushes, even with nothing pending, so the renderer's "running" state can
  never strand — `searchCoalescer.finish`'s own reasoning.

## 4. `internal/terminal`

A domain package: it must not import `internal/bridge` (`internal/layering_test.go`'s
`TestDomainPackagesDoNotImportBridge` enumerates every `internal/*` package from `go list`, so a new
one is covered automatically, not by remembering to add it).

```go
// Session is one live PTY: the process, the master fd, and the single reader goroutine.
type Session struct {
    id      string
    cmd     *exec.Cmd
    ptmx    *os.File
    onData  func([]byte)
    onExit  func(code int, err error)

    mu     sync.Mutex
    closed bool
}

type Registry struct {
    mu       sync.Mutex
    sessions map[string]*Session
    byWindow map[string]map[string]struct{} // windowKey -> terminalIds
}

func (r *Registry) Open(p OpenParams) (*Session, error)
func (r *Registry) Write(id string, b []byte) error
func (r *Registry) Resize(id string, cols, rows uint16) error
func (r *Registry) Close(id string)
func (r *Registry) CloseWindow(key string)   // every terminal of one window
func (r *Registry) CloseAll()                // app teardown
```

Lifecycle rules, each load-bearing:

1. **One reader goroutine per session**, `io.Reader` loop over `ptmx` into a 32 KiB buffer, calling
   `onData`. On `read` error (EOF, or `EIO` — what Linux returns when the slave side closes) the
   loop `Wait()`s the process, calls `onExit` exactly once, and unregisters.
2. **`Close` is idempotent and ordered**: mark closed under the mutex → `syscall.Kill(-pid,
   SIGHUP)` → wait up to 2 s for `Wait()` → `syscall.Kill(-pid, SIGKILL)` → `ptmx.Close()`.
   Closing the fd *first* would race the reader into a use-after-close; signalling first lets the
   reader observe EOF and exit on its own, and the `SIGKILL` is the bound on a shell that ignores
   `SIGHUP`. The 2 s cap matches this repo's own existing handshake bound (`main.go:352`,
   `closeflush.go:15`).
3. **`Write` after close is a silent no-op**, not an error — the renderer can have a keystroke in
   flight when a shell exits, and turning that into a visible error is noise.
4. **`onData` never runs after `onExit`**: both are called from the one reader goroutine, in order.

Teardown wiring, all three levels:

| Level | Hook | Call |
|---|---|---|
| Tab close / workspace close | `TAB_KINDS.terminal.dropResources` → `control.terminalClose` | `Registry.Close(id)` |
| Window close | `main.go:572`'s existing `WindowClosing` handler, beside `quitter.Flushed(rec.Key)` | `Registry.CloseWindow(rec.Key)` |
| App quit | `main.go:328`'s `teardown`, beside `codeWorkspaceSvc.Shutdown()` | `Registry.CloseAll()` |

The window level is what stops an orphaned `npm run dev` outliving the window that started it even
when the renderer never gets to ack.

## 5. `state/terminals.ts` — the frontend registry

`apps/kira-studio/frontend/src/state/terminals.ts`. **`state/`, not `repo/state/`**, because
`biome.json:135`-`156` forbids `repo/**` importing `views/**` and `:72`-`:105` forbids `views/**`
importing `workbench/**` — `state/` is the one layer `GitPanel.vue` (the indicator), `TabStrip.vue`
(the "+"), `state/tabKinds.ts` (`dropResources`) and `views/repo/` (the renderer) can all reach.

**No `@xterm/xterm` import here.** That would put the terminal renderer in the boot bundle for every
Studio session — the exact cost `views/repo/monacoEntry.ts:1`-`19` exists to avoid. §6.2 keeps xterm
behind a dynamic `import()` in `views/repo/`.

### 5.1 Shape

```ts
export interface TerminalSession {
  readonly tabId: string;        // also the Go-side terminalId
  readonly codeRepoId: string;
  readonly cwd: string;          // absolute, already canonical (§8.1)
  status: 'starting' | 'running' | 'exited' | 'failed';
  exitCode: number | null;
  error: string | null;
  shell: string;
}

const byTabId = reactive(new Map<string, TerminalSession>());
```

`reactive()` on the Map itself, for `repo/state/worktrees.ts:18`-`20`'s own recorded reason: the
panel reads a key before any entry exists, and a plain Map makes that read untracked.

Exports:

| Export | Purpose |
|---|---|
| `openTerminalSession(tabId, codeRepoId, cwd, cols, rows)` | Subscribe, then `control.terminalOpen` |
| `writeTerminal(tabId, data)` / `resizeTerminal(tabId, cols, rows)` | Pass-through |
| `closeTerminalSession(tabId)` | `dropResources`' target; `control.terminalClose` + registry delete |
| `terminalSession(tabId)` | The view's own state read |
| `terminalCountAtPath(path)` | **§11's whole signal** — the count of live sessions whose `cwd` matches |
| `onTerminalOutput(tabId, sink)` | The renderer's subscription; drains anything queued (§5.2) |

`terminalCountAtPath` compares with `canonicalPath` — `state/coderepos.ts:53`-`55`'s own helper,
exported for reuse rather than copied (`git worktree list` reports paths verbatim while
`RepoSummary.root` comes back NFC-normalized; P82 already hit this).

### 5.2 Output routing, and why `MainView.vue`'s unmount is harmless

One module-level `control.onTerminal(...)` subscription, installed on first use, routes by
`terminalId`:

- a sink is attached (the normal case) → hand it the decoded bytes;
- no sink yet (between `openTerminalSession` and the view's first mount) → append to a **bounded
  drain queue**, 256 KiB per tab, oldest dropped past that. In practice the window is one tick;
  the bound exists so a pathological case cannot grow without limit.

The xterm `Terminal` itself lives in `views/repo/terminalRenderer.ts`'s own module-level map
(§6.2), **not in the Vue component**, so a tab switch — which unmounts `RepoTerminalView.vue`,
since `MainView.vue:25` keeps only `RepoGraphView` alive — loses nothing: the sink stays attached,
output keeps landing in the live `Terminal`, and remounting re-inserts the same DOM node. No
`KEEP_ALIVE_VIEWS` change, and no Go-side scrollback.

## 6. `@xterm/xterm`

### 6.1 Package and licence

The original `xterm` package is **deprecated** — npm's own `deprecated` field on `xterm@5.3.0`
(2023-09-07) reads "This package is now deprecated. Move to @xterm/xterm instead." The scope move
is a rename by the same project: `@xterm/xterm`'s repository is still `github.com/xtermjs/xterm.js`
and its sole npm maintainer is `tyriar` (Daniel Imms, VS Code's terminal maintainer) — **not a new
maintainer**, which is the one detail worth correcting against the prompt's framing.

| Package | Version | Published | Licence |
|---|---|---|---|
| `@xterm/xterm` | 6.0.0 | 2025-12-22 | MIT |
| `@xterm/addon-fit` | 0.11.0 | 2025-12-22 | MIT |

Both checked against the registry directly, not a README badge. Two pinned deps in the root
`package.json`'s `dependencies` (this is a single hoisted Bun workspace — `apps/kira-studio/frontend/
package.json` carries only `workspace:*` links).

Deliberately **not** taken: `@xterm/addon-webgl` (0.19.0, MIT) — a GPU renderer is a real
optimisation for a 10k-line-per-second firehose, and a real new failure surface (context loss,
WebKitGTK driver variance) for a terminal that mostly shows a prompt. `@xterm/addon-canvas` is
stale (last published 2024-04, `peerDependencies: {"@xterm/xterm": "^5.0.0"}`) and is not taken
either. `@xterm/addon-search`/`addon-unicode11` are out of scope (§15).

### 6.2 Mounting

`views/repo/terminalRenderer.ts` — the sole contact point with `@xterm/xterm`, reached through a
dynamic `import()`, mirroring `monacoEntry.ts`'s recorded shape (static re-exports inside the lazy
module; an inline dynamic namespace import bundles worse — `sqlFormatterEntry.ts`'s own
measurement).

```ts
interface Attached { term: Terminal; fit: FitAddon; host: HTMLDivElement; off: () => void; }
const byTabId = new Map<string, Attached>();
```

On first attach for a tab: create a **detached** `<div>` (`host`), `term.open(host)`, `loadAddon(fit)`,
subscribe `onTerminalOutput(tabId, (bytes) => term.write(bytes))`, and wire
`term.onData(d => writeTerminal(tabId, d))` (keystrokes) and `term.onBinary` (mouse/paste bytes).

`RepoTerminalView.vue` then does, on mount, `container.appendChild(host)` — **moving a live DOM
subtree, never calling `term.open()` twice.** That is the one mechanically safe way to reattach an
xterm across unmounts, and it sidesteps the "is `open()` re-entrant?" question entirely rather than
relying on an answer. On unmount the component does nothing: `host` simply detaches with its parent
and is re-appended next time.

### 6.3 Options

```ts
new Terminal({
  scrollback: 5000,
  cursorBlink: true,
  allowProposedApi: false,
  fontFamily: cssVar('--kira-font-family'),
  fontSize: parseInt(cssVar('--kira-font-size'), 10),
  theme: { /* §6.4 */ },
});
```

`--kira-font-family`/`--kira-font-size` are the exact channel the Appearance "Data font" control
writes (`theme/tokens.css:110`-`113`), so a terminal's type tracks the same setting Monaco does. A
`watch` on `settingsState` re-applies both and calls `fit()`.

### 6.4 Theme — a stated, partial exception

This app has **one** theme (`theme/tokens.css:3` onward is a `:root` block of VS Code Dark Modern
values; there is no `prefers-color-scheme` rule, no `[data-theme]` selector, no light variant) and
**no ANSI palette anywhere** — `grep -r ansi` over the frontend returns nothing terminal-related.

So: the four colours that have a token get one, and the sixteen that do not keep xterm's own
defaults.

| xterm key | Value |
|---|---|
| `background` | `--kira-bg` |
| `foreground` | `--kira-fg` |
| `cursor` | `--kira-fg` |
| `selectionBackground` | `--kira-select` |

The ANSI 16 stay at `@xterm/xterm`'s own defaults. **This is the deliberate exception, not an
oversight**: xterm's defaults are the VS Code Dark+ palette, the same family every token in
`tokens.css` is derived from, so they already match by construction. Inventing sixteen
`--kira-ansi-*` tokens would add sixteen `scripts/check-tokens.sh` definitions with exactly one
consumer and no second opinion about what they should be — and a wrong ANSI palette is worse than
the upstream one, because a shell prompt, `ls` and every build tool depend on those exact slots.

`@xterm/xterm/css/xterm.css` is imported inside `terminalRenderer.ts` (so it rides the lazy chunk);
it references no `--kira-*` token, so `check-tokens.sh` is unaffected.

## 7. The `terminal` tab kind

### 7.1 The four vocabularies

- `tabKindSchema` (`shared/domain/tabs.ts:8`) — append `'terminal'`.
- `RENDERABLE_TAB_KINDS` (`:48`) — append.
- `TAB_KIND_MODE` (`:80`) — `terminal: 'repo'`.
- `tabRecordSchema` (`:379`) — a new arm with `terminalTabStateSchema`.
- `model/tabs.go:30` `RenderableTabKinds` — `"terminal": true`, **and** `:59` `repoTabKinds` (a
  terminal tab always carries a `workspaceId`). `go-ts-vocabulary-parity.spec.ts:48` fails
  otherwise, which is the point of that test.

State is minimal and carries nothing a restart could honour:

```ts
export const terminalTabStateSchema = z.object({
  cwd: z.string(),
  codeRepoId: z.string(),
});
```

`cwd` lives in the tab record (not only in `state/terminals.ts`) so the tab's own title and the
`dropResources` path work without a second lookup.

### 7.2 The `TabKindDef` entry

```ts
terminal: {
  mode: TAB_KIND_MODE.terminal,
  // The cwd's basename, so two terminals at two worktrees read apart at a glance. Falls back to
  // 'Terminal' for an empty cwd, which openTerminalTab never produces.
  title: (tab) => basename((tab as TerminalTabRecord).state.cwd) || 'Terminal',
  // 'terminal-bash', not 'terminal': the 'console' kind (a SQL console) already owns that glyph.
  icon: () => 'terminal-bash',
  railColor: () => undefined,
  defaultState: (): TerminalTabState => ({ cwd: '', codeRepoId: '' }),
  duplicateState: (tab: TerminalTabRecord): TerminalTabState => ({ ...tab.state }),
  // The one place a PTY dies on close — blind-called for every kind (state/tabs.ts:54), so a
  // non-terminal id is a registry miss, not a branch.
  dropResources: (tabId) => closeTerminalSession(tabId),
  menuExtras: () => [],
  parseState: parseStateWith(terminalTabStateSchema),
},
```

`TAB_VIEWS.terminal = RepoTerminalTabView` in `workbench/tabViews.ts:22`.

`duplicateState` copying the cwd means "Duplicate tab" on a terminal opens a **second terminal at
the same directory** — which is what duplicating a terminal means, and needs no special case.

### 7.3 More than one per worktree — decided: yes

`openRepoTerminalTab` passes `reuse: false`. Justification is in-repo, not taste:
`openConsoleTab` (`state/tabs.ts:507`-`515`) already documents the identical call — "always a fresh
one, never reused by (connectionId, path)" — because a console is a *session*, not a document.
A terminal is the same thing more so: running a dev server in one and `git status` in another is
the ordinary use, and collapsing them onto one tab would make the feature strictly worse than any
terminal the user already has.

### 7.4 Close and reopen

Close is final, in one direction only: `closeTab` → `dropAllPagesForTab` → `dropResources` →
`closeTerminalSession` → `control.terminalClose` → `Registry.Close` (§4's ordered kill). There is
no "reopen this dead session" — the PTY and its scrollback are gone, and pretending otherwise would
mean Go-side session retention this phase deliberately does not build (§15). "Reopen" means opening
a new terminal at the same cwd, which every entry point already does in one click.

A shell that exits on its own (`exit`, `Ctrl-D`) leaves the **tab open** showing its last output
with a muted footer — `Process exited (code 0)` — and the session marked `exited`. The tab is
closed by the user, like any other. Closing it on exit would destroy output the user may be reading.

### 7.5 Never persisted

`persistableTabs()` (`state/tabs.ts:132`-`134`) grows one condition:

```ts
// P83: a terminal tab's whole content is a live process — a restored row would be an empty
// terminal wired to a PTY that died with the last run. Same filter shape as incognito above.
return tabsState.tabs.filter((t) => !isIncognito(t.id) && t.kind !== 'terminal');
```

`TabsService.Save` replaces the window's whole tab set (`:131`'s own note), so no separate delete is
needed. The Go `RenderableTabKinds` entry is still required (§7.1) — the parity test demands it, and
a vocabulary that is complete regardless of what currently reaches it is the point of that test.

## 8. Working directory

### 8.1 Where it comes from

Nothing new. `code_repos.root` **is** a worktree root: `gitclient.Identify` sets `Root` from
`rev-parse --show-toplevel` and `RepoID = root` for a non-bare repo (`gitclient/repo.go:212`-`215`,
whose own comment records why). P82 §5.2 already established that a linked worktree imported through
`openRepoAtPath` becomes its own `code_repos` row with its own root.

So:

- **tab-strip "+"** → `codeRepoRecord(repoIdOfWorkspace(workspaceState.active))!.root`.
- **repo-row menu** → `repo.root`.
- **worktree-row menu** → `wt.path`, straight off `worktree.list` — i.e. `gitsession`'s own
  resolution (`gitsession/worktree.go:90`, `Path: r.Path` from `porcelain.ParseWorktreeList`).

Every path is run through `canonicalPath` (`state/coderepos.ts:53`) before it reaches Go or the
`terminalCountAtPath` index, for P82's own recorded reason.

### 8.2 The worktree is removed while a terminal is open

**Decision: keep the terminal alive, unchanged. No watch, no signal, no cwd rewrite.**

Reasons, in order:

1. On Unix the shell already holds the directory's inode. Removing it does not kill the process; it
   makes `pwd`/`$PWD`-relative commands fail, which is *exactly* what happens in an external
   terminal and exactly what a shell user recognises. Reproducing that costs nothing and teaches
   nothing new.
2. Killing it would destroy output the user may still need — likely the output of the very command
   that removed the worktree.
3. Reassigning the cwd would need a `chdir` written into the user's live shell, i.e. injecting a
   command into their session. This app must not type into a user's shell.
4. Detecting removal at all would mean a filesystem watch per terminal — new machinery for a
   behaviour whose right answer is "do nothing".

Panel-side consequence, which is correct without extra code: the indicator (§11) is keyed by path
off the rows that exist, so when the worktree row disappears its indicator disappears with it. The
tab stays, titled with the (now dangling) basename, until the user closes it.

---

# Part B — the two entry points

## 9. The tab strip's "+" button

### 9.1 Placement

A third child of `.tab-strip-wrapper` (`TabStrip.vue:198`), **after** `.tab-strip`, fixed like
`.tab-strip-pinned` is at the leading edge — `flex-shrink: 0`, outside the scroller's own
`overflow-x: auto` (`:347`), so it never scrolls away with the tabs. This mirrors P72 §7's own fix
for the pinned tab at the other end rather than inventing a placement.

```html
<div class="tab-strip-actions" data-testid="tab-strip-actions">
  <button
    ref="newTabBtn"
    type="button"
    class="tab-new"
    aria-label="New tab"
    aria-haspopup="menu"
    data-testid="tab-strip-new"
    v-tooltip="'New tab'"
    @click="onNewTab"
  >
    <CodiconIcon name="add" :size="13" />
  </button>
</div>
```

**Rendered only for a repo workspace** — `v-if="isRepoWorkspace(workspaceState.active)"`. Every
entry this dropdown will ever hold (P83's Terminal; P84's Claude Code and custom scripts) needs a
worktree directory, and Studio/Api workspaces have none. Offering a control that can only fail is
worse than not offering it.

The empty-strip branch (`:301`, `.tab-strip-wrapper.is-empty`) needs no "+": a repo workspace always
has its pinned graph tab (`ensureWorkspaceShell`'s own guarantee), so `tabs.length > 0` there
always.

### 9.2 The dropdown

A real `MenuItem[]` through the app's existing menu machinery from day one — one entry today, so
P84 appends a line rather than redesigning a control:

```ts
function onNewTab(): void {
  const rect = newTabBtn.value!.getBoundingClientRect();
  openContextMenuAt(rect.left, rect.bottom + 2, newTabMenuItems());
}

// P83: one entry today. P84 adds "Claude Code", one item per configured script, and
// "Manage scripts…" — appended here, with no change to this control.
function newTabMenuItems(): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'new-terminal',
      label: 'Terminal',
      icon: 'terminal-bash',
      run: () => openRepoTerminalTabForActiveWorkspace(),
    },
  ];
}
```

`openContextMenuAt` is a **3-line addition** to `state/contextMenu.ts:33`-`38`:

```ts
export function openContextMenuAt(x: number, y: number, items: MenuItem[]): void {
  contextMenuState.items = items;
  contextMenuState.x = x;
  contextMenuState.y = y;
  contextMenuState.open = true;
}
export function openContextMenu(ev: MouseEvent, items: MenuItem[]): void {
  openContextMenuAt(ev.clientX, ev.clientY, items);
}
```

Needed because `ContextMenu.vue` positions from a point (`:87`-`:96`, `floatingPosition.ts` with
`flip: false` plus shift-clamping) and every existing caller hands it a cursor. A dropdown must hang
from the button's own bottom-left, not from wherever inside the 22px button the click landed. The
existing clamp keeps it on screen with no further work.

`TabStrip.vue` importing `state/repoTabs.ts` is a permitted edge (`workbench/` → `state/`);
`state/` → `workbench/` is the forbidden direction (`tabKinds.ts:83`-`88`).

## 10. The right-click item

### 10.1 Where it goes, and where it does not

SPEC says "alongside P76's own worktree-creation context-menu item". Read literally that is
`packages/git-ui/src/components/rowMenuModel.ts:78`/`:234`/`:243` — the graph's commit-row and
ref-row menus. **This plan puts the item on `GitPanel.vue`'s rows instead**, the same kind of
reasoned re-reading P82 §4 made about `WorktreeList.vue`'s "switch machinery". Five reasons, each
checked:

1. **A terminal's defining parameter is a directory.** A commit row names a sha and a ref row names
   a branch; neither is a path. P76's item *is* meaningful on those rows (a worktree is created
   *at* a start point), and "Open terminal" is not.
2. **The panel's rows are the only rows in this app that name a directory** — `repo.root` and
   `wt.path`. They are also the two row kinds SPEC's own indicator sentence names ("a repo **or
   worktree** row"), so the action and its indicator land on the same rows.
3. **The "+" already covers the graph surface.** It opens a terminal at the active repo's current
   worktree from anywhere in the workbench, which is precisely what a `rowMenuModel.ts` item could
   offer. A second entry point to the identical outcome is not a second entry point.
4. **The `rowMenuModel.ts` route is not free**, and its cost buys nothing item 3 does not already
   deliver: `git-ui` has no host seam for this, so it needs a new host-answered contract request, a
   new `app.init` capability flag (`contract.ts:1493`-`1516`), `CONTRACT_VERSION` 39 → 40,
   `stash_test.go`'s `TestContractVersion_Is39` → `Is40`, a `graphChunkFrame.{bin,json}` regen, and
   a `false` capability in the VS Code host for a feature VS Code already has natively.
5. **It would ship a dead item in the other host.** `git-ui` is mounted by the VS Code extension
   too (`SPEC.md:26`-`29`), where the item would either be hidden by a capability flag or duplicate
   `vscode.window.createTerminal`.

Nothing in `packages/git-ui/` changes in this phase.

### 10.2 The two menus

**Repo row** — `GitPanel.vue:117`-`166`'s `onRepoContextMenu`, a new item between "Copy path" and
the separator (`:140`):

```ts
{
  type: 'item' as const,
  id: 'open-terminal',
  label: 'Open terminal',
  icon: 'terminal-bash',
  run: () => openRepoTerminalTab(repo.id, repo.root),
},
```

**Worktree row** — a new `onWorktreeContextMenu(e, repo, wt)`, wired as
`@contextmenu.prevent.stop` on `.worktree-row` (`:300`-`:319`). Two items:

```ts
[
  { type: 'item', id: 'open-terminal', label: 'Open terminal', icon: 'terminal-bash',
    run: () => openRepoTerminalTab(repo.id, wt.path) },
  { type: 'item', id: 'copy-path', label: 'Copy path', icon: 'copy',
    run: () => void navigator.clipboard.writeText(wt.path) },
]
```

P82 §10 listed "a right-click menu on a worktree row" as out of scope because nothing then needed
one. P83 does: without it, a terminal can never be opened at a worktree that is not the active
workspace, and SPEC's own "repo **or worktree** row" indicator would only ever light on one of the
two. "Copy path" rides along because the menu must exist anyway and a one-item context menu reads
like an accident — it is the same item the repo row already offers (`:135`-`:139`).

`.prevent.stop` matters: without `.stop`, the row's own `@click.stop` sibling is unaffected but the
event reaches `.repo-row`'s `@contextmenu.prevent` handler and opens the *repo's* menu instead.

### 10.3 `openRepoTerminalTab`

New, in `state/repoTabs.ts` (`repo/**` must not import `views/**` — `biome.json:139`-`153` — and
this is the file that rule names as the dispatch point):

```ts
/** P83: opens a terminal tab in codeRepoId's own workspace, rooted at `cwd`. `reuse: false` — a
 *  terminal is a session, not a document (openConsoleTab's own reasoning, state/tabs.ts:507). */
export function openRepoTerminalTab(codeRepoId: string, cwd: string): OpenTabResult {
  openRepoWorkspace(codeRepoId);            // no-op-ish when already open; activates either way
  return openTab('terminal', null, cwd, () => ({ cwd: canonicalPath(cwd), codeRepoId }), {
    reuse: false,
    workspaceId: repoWorkspaceKey(codeRepoId),
  });
}
```

`openRepoWorkspace` first, because a tab must belong to a workspace whose strip is on screen —
right-clicking a closed repository's row and getting an invisible tab would be a dead action.
A worktree-row terminal belongs to the **repo row that was expanded**, not to the worktree's own
(possibly non-existent) row: that is the row the user acted on, and it avoids the import-a-repo side
effect `openRepoAtPath` would carry.

---

# Part C — the three Git-panel additions

## 11. The running-terminal indicator

### 11.1 The signal

`terminalCountAtPath(path)` (§5.1) — the registry the terminal mechanism already keeps, indexed by
canonical cwd. No second registry, per SPEC's own instruction. It is a `computed`-friendly read off
a `reactive` Map, so a terminal opening or exiting repaints the row with no event plumbing.

### 11.2 The marker — an icon, not a badge

`GitPanel.vue` has exactly two trailing-slot vocabularies today: a **word badge** (`.worktree-badge`,
`:311`, the literal text `main`) and an **icon badge** (`.worktree-badge-icon`, `:312`-`:318`, the
lock glyph with the lock reason in its tooltip). Both are `--kira-fg-subtle`, `flex-shrink: 0`.

The terminal marker is the **icon** form: a `terminal-bash` codicon in the same slot, same class,
tooltip carrying the count.

- A word badge is for a **fixed label** (`main` is one word, always the same word). A count is not.
- The lock icon is the exact precedent: *a state this row is in, explained by its tooltip*.
- It costs no horizontal space at a glance, which matters on a row that is also gaining a HEAD
  label (§12).

Repo row (after `.repo-name`, `:293`) and worktree row (after `.worktree-badge`, `:311`):

```html
<CodiconIcon
  v-if="terminalCountAtPath(repo.root) > 0"
  name="terminal-bash"
  :size="12"
  class="worktree-badge-icon"
  data-testid="repo-terminal-indicator"
  v-tooltip="terminalTooltip(terminalCountAtPath(repo.root))"
/>
```

`terminalTooltip(n)` = `n === 1 ? 'A terminal is open here' : `${n} terminals are open here``.
The class is reused verbatim rather than a new `.repo-badge-icon` — it is already generic
(`flex-shrink: 0; color: var(--kira-fg-subtle)`) and the two rows should not drift.

## 12. Every repo row's checked-out branch

### 12.1 The data does not exist yet

`repoSummarySchema` (`shared/domain/repo.ts:6`-`13`) is `{id, name, root, repoId, sortOrder,
createdAt}` — no head, and no place to store one (HEAD is live state, not a `code_repos` column).

`gitclient.ResolveHead(ctx, runner, gitPath, dir)` (`gitclient/repo.go:251`-`285`) already returns
exactly the needed union — `{kind: 'branch'|'detached'|'unborn', name, sha}` — in one
`symbolic-ref --short -q HEAD` spawn plus, on the branch arm, one `rev-parse -q --verify HEAD`.
`Identify` itself calls it (`:195`). Nothing needs writing on the git side.

### 12.2 One batched bound call

`CodeWorkspaceService.RepoHeads(ctx) ([]CodeRepoHead, error)`, in `bridge/codeworkspace.go` beside
`ListRepos:117`:

```go
type CodeRepoHead struct {
    ID    string `json:"id"`              // code_repos.id
    Head  *gitclient.HeadState `json:"head"`  // nil when this row could not be read
    Error string `json:"error,omitempty"`
}
```

Batched, not per row: one bound call per refresh instead of N, so the panel's own refresh is one
round trip regardless of how many repositories are listed. Bounded concurrency of 4 over
`golang.org/x/sync/errgroup` (already a dependency, `go.mod:50`) — the same ceiling
`gitclient.maxConcurrentReads` (`repo.go:37`) picks for one repository's own read pool, applied
here across repositories. A row whose repository is gone from disk resolves to
`{Head: nil, Error: …}` rather than failing the whole call.

`repo.Root == ""` (a bare repository) is skipped with `Head: nil` — there is no HEAD to show, and
`ResolveHead` against a bare dir is not what the row means.

### 12.3 The store and its refresh triggers

`apps/kira-studio/frontend/src/repo/state/repoHeads.ts` — session-scoped and module-level, the shape
`repo/state/worktrees.ts` and `repo/state/search.ts` already use.

```ts
const byRepoId = reactive(new Map<string, HeadState | null>());
export function repoHeadLabel(codeRepoId: string): string   // '' when unknown
export function refreshRepoHeads(): Promise<void>            // one batched call, coalesced
```

`repoHeadLabel` is a four-line function next to `worktreeLabel` (`worktrees.ts:136`-`140`) and
deliberately mirrors it, so the collapsed row and its expanded children read the same way:

```ts
switch (head.kind) {
  case 'branch': return head.name;
  case 'detached': return `detached @ ${head.sha.slice(0, 7)}`;
  case 'unborn': return head.name;   // the branch HEAD points at, not yet committed to
}
```

Triggers, each with a reason:

1. **`GitPanel.vue`'s `onMounted`** — the panel is mounted for as long as the Git module is, so this
   is once per session, not per render.
2. **A `watch` on `codeReposState.records`** — an import, a remove or a P82 worktree switch changes
   the row set; a new row must not render headless.
3. **`repo.changed` with `kind === 'refsChanged'`, per open repo workspace.** A checkout is what
   actually changes a HEAD, and it happens in the workspace's own graph. One lease per repo in
   `workspaceState.openRepos`, created and released by the same `watch(() => workspaceState.openRepos)`
   eviction pattern `repo/state/worktrees.ts:149`-`155` established, over
   `gitTransportFor(codeRepoId)` (`transport.ts:291`) — which **returns a lease over the existing
   shared client** for an open workspace and creates nothing new. Each event refreshes that one
   repo's entry (a one-row `RepoHeads` call is the same call with a filtered arg — `RepoHeads` takes
   an optional `ids []string`).

**Stated limitation, not a gap to hide:** a repository that is merely *listed* (no workspace open)
has no transport and therefore no live signal. Its row's label refreshes on trigger 1 or 2 only, so
a branch switched from an external terminal is stale until then. Making it live would mean opening a
git connection per listed repository at panel mount — a real `Stream('git')`, `gitsession.Conn`,
repo hold, watcher and cat-file pair each (P82 §6.3 prices exactly this) — which is far out of
proportion to a label.

### 12.4 Where it renders

`.repo-row` (`:271`-`:294`) is `display: flex; align-items: center; gap: var(--kira-s-2); height:
var(--kira-row-height)` (`:427`-`:435`). The label goes **after `.repo-name`** (`:293`, which is
`flex: 1` with its own ellipsis) and before the terminal indicator:

```html
<span v-if="repoHeadLabel(repo.id)" class="repo-head" v-tooltip="repoHeadLabel(repo.id)">
  {{ repoHeadLabel(repo.id) }}
</span>
```

```css
.repo-head {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-subtle);
}
```

Row height and alignment are untouched: everything is an inline flex child on a row that already
centres its children and has a fixed height. `.repo-name` keeps `flex: 1`, so it yields first and
the branch label is what survives on a narrow panel — the correct priority, since the repository's
name is also its row's tooltip and the panel title. `--kira-t-sm`/`--kira-fg-subtle` are the exact
pair `.worktree-badge` (`:506`-`:510`) already uses, so a collapsed row's branch and its expanded
children's branches read as the same class of information.

## 13. The main worktree sorts first

### 13.1 SPEC is wrong about why, and this plan says so

SPEC: "today it appears first only because `git worktree list`'s own incidental order happens to put
it there". It is not incidental. `gitsession/worktree.go:73`-`76`:

> probe P4/P1: `worktree list`'s own first record is always the main worktree, so `IsMain` is
> positional, never re-derived from a separate spawn

and `:92` is `IsMain: i == 0`. The Go side **depends** on that ordering to know which worktree is
main at all. It is a documented, probe-verified git property, not luck.

The change is still worth making — it is one line, and it makes the render layer's own order a
guarantee instead of a property inherited from a server that could, in principle, reorder — but it
must be described honestly as belt-and-braces, not as fixing a bug. In particular, **the sort must
never become the thing that decides which row is main**: `wt.isMain` stays the server's answer.

### 13.2 The one-line fix

`repo/state/worktrees.ts:44`-`46`:

```ts
export function worktreeEntries(codeRepoId: string): readonly WorktreeEntry[] {
  const entries = byRepo.get(codeRepoId)?.entries ?? [];
  // P83: the main worktree first, always. Today `git worktree list` already emits it first (the
  // property gitsession/worktree.go:92's `IsMain: i == 0` itself relies on) — this makes the
  // rendered order a guarantee of this function rather than an inherited one. Stable otherwise:
  // every non-main entry keeps the server's order.
  return [...entries].sort((a, b) => Number(b.isMain) - Number(a.isMain));
}
```

A copy before sorting, because `state.entries` is the store's own array and `Array.prototype.sort`
mutates in place. `Array.prototype.sort` is specified stable (ES2019), so the comparator returning
0 for two non-main entries preserves `worktree list`'s order for them.

---

## 14. Styling and tokens

`scripts/check-tokens.sh` (pre-commit) requires every `var(--kira-…)` under
`apps/kira-studio/frontend/src` to resolve in `theme/tokens.css`/`base.css`/`primitives.css`. Every
token below already exists.

| Need | Token |
|---|---|
| Terminal background / foreground | `--kira-bg`, `--kira-fg` |
| Terminal selection | `--kira-select` |
| Terminal font | `--kira-font-family`, `--kira-font-size` |
| "+" button hover | `--kira-hover` |
| "+" glyph | `--kira-fg-muted` |
| Branch label, indicator | `--kira-t-sm`, `--kira-fg-subtle` |
| Exited-process footer | `--kira-t-sm`, `--kira-fg-muted`, `--kira-bg-chrome` |
| Terminal error row | `--kira-error` |

```css
/* TabStrip.vue — the trailing fixed slot, `.tab-strip-pinned`'s (:319) mirror at the other end. */
.tab-strip-actions {
  height: 100%;
  display: flex;
  align-items: center;
  padding: 2px 4px 0 2px;
  flex-shrink: 0;
}
.tab-new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  border-radius: var(--kira-radius-sm);
  cursor: pointer;
}
.tab-new:hover { background: var(--kira-hover); color: var(--kira-fg); }
```

Raw `px` only for icon-box geometry, where the neighbouring code already does the same
(`.tab-close` is `16px`, `TabStrip.vue:416`-`417`; `.repo-twisty` is `14px`, `GitPanel.vue:465`).

`RepoTerminalView.vue`'s own root is `height: 100%; background: var(--kira-bg); padding:
var(--kira-s-2)`, with the xterm host filling it. `@xterm/xterm/css/xterm.css` is imported inside
the lazy chunk and touches no app token.

## 15. Deliberately out of scope

- **Terminal search, links, unicode-11 widths, WebGL rendering.** Four more addons, each its own
  decision; §6.1 prices WebGL specifically. None is asked for.
- **Split terminals, a terminal panel, terminal tabs outside a repo workspace.** SPEC says "a new
  terminal tab kind"; a panel is a different surface.
- **Restoring a terminal across a restart, or Go-side session retention past a tab close.** §7.4/
  §7.5. Either would mean a server-held scrollback and a reattach protocol.
- **Shell integration** (prompt markers, command decorations, exit-code gutters). VS Code's own
  shell-integration scripts are a large, per-shell surface; nothing here asks for it.
- **Windows/ConPTY.** §2.2 — the app does not ship there.
- **A profile picker or a configurable shell setting.** `$SHELL` is the answer; a setting is P84's
  "custom scripts" territory if anything.
- **P84's dropdown entries** (Claude Code, custom scripts, "Manage scripts…") and P85's hooks.
  §9.2's `newTabMenuItems()` is the seam they extend; nothing is pre-built for them.
- **A live HEAD for a repository whose workspace is not open.** §12.3, with its price stated.
- **Changing `wt.isMain`'s own derivation.** §13.1 — the sort reads the server's answer, never
  replaces it.
- **Anything in `packages/git-ui/`, `packages/git-ipc/` or `apps/kira-studio-vscode/`.** §10.1.
- **`docs/ARCHITECTURE.md`/`README.md`.** Chapter docs are their own phase's job.

## 16. Files

Added:

| File | Contents |
|---|---|
| `apps/kira-studio/internal/terminal/session.go` | §4's `Session`/`Registry`: spawn, reader goroutine, write, resize, ordered close, per-window and global teardown |
| `apps/kira-studio/internal/terminal/shell.go` | §2.3's `loginShell`/`passwdShell` and the env table |
| `apps/kira-studio/internal/terminal/session_test.go` | §17.1's Go test |
| `apps/kira-studio/internal/bridge/terminal.go` | `TerminalService` (§3.2) + the output coalescer (§3.3) |
| `apps/kira-studio/frontend/src/state/terminals.ts` | §5's registry: sessions by tab id, `terminalCountAtPath`, output routing, drain queue |
| `apps/kira-studio/frontend/src/views/repo/terminalRenderer.ts` | §6.2's lazy `@xterm/xterm` boundary; the per-tab `Terminal`/`FitAddon`/detached host |
| `apps/kira-studio/frontend/src/views/repo/RepoTerminalView.vue` | The tab view: mounts the host, `ResizeObserver` → `fit()` → `resizeTerminal`, exited footer, error state |
| `apps/kira-studio/frontend/src/repo/state/repoHeads.ts` | §12.3's store |

Modified:

| File | Change |
|---|---|
| `apps/kira-studio/internal/bridge/events.go` | `ChannelTerminal` (§3.2) |
| `apps/kira-studio/internal/bridge/codeworkspace.go` | `RepoHeads` + `CodeRepoHead` (§12.2) |
| `apps/kira-studio/internal/storage/model/tabs.go` | `"terminal": true` in `RenderableTabKinds` (`:30`) and in `repoTabKinds` (`:59`) |
| `apps/kira-studio/main.go` | `application.NewService(terminalSvc)` (`:402` area); `Registry.CloseWindow(rec.Key)` in the `WindowClosing` handler (`:572`); `Registry.CloseAll()` in `teardown` (`:328`) |
| `go.mod` / `go.sum` | `github.com/creack/pty v1.1.24` |
| `package.json` / `bun.lock` | `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0 |
| `NOTICES.md` | An `@xterm/xterm` section with its MIT text, following the `monaco-editor` (`:106`) precedent for a bundled renderer library. `creack/pty` gets none — no Go dependency has a section, and the file's own header (`:3`-`:5`) scopes itself to notices "beyond the standard MIT/BSD/Apache-2.0 attribution `go.mod`/`package.json` already carry" |
| `packages/shared/domain/tabs.ts` | `'terminal'` in `tabKindSchema` (`:8`), `RENDERABLE_TAB_KINDS` (`:48`), `TAB_KIND_MODE` (`:80`); `terminalTabStateSchema` + the `tabRecordSchema` arm (`:379`) + `TerminalTabRecord` |
| `packages/shared/protocol/events.ts` | `CHANNEL.terminal` |
| `apps/kira-studio/frontend/src/bridge/index.ts` | `terminalOpen`/`terminalWrite`/`terminalResize`/`terminalClose`/`onTerminal`, `codeWorkspaceRepoHeads` |
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | The `terminal` entry (§7.2) |
| `apps/kira-studio/frontend/src/workbench/tabViews.ts` | `terminal: RepoTerminalTabView` |
| `apps/kira-studio/frontend/src/state/tabs.ts` | `persistableTabs()`'s one added condition (`:132`-`:134`) |
| `apps/kira-studio/frontend/src/state/repoTabs.ts` | `openRepoTerminalTab` (§10.3) |
| `apps/kira-studio/frontend/src/state/coderepos.ts` | `export` on `canonicalPath` (`:53`) — one keyword, so §5.1 shares it rather than copying P82's own NFC reasoning a second time |
| `apps/kira-studio/frontend/src/state/contextMenu.ts` | `openContextMenuAt` (§9.2) |
| `apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue` | The "+" slot, its menu, its CSS (§9) |
| `apps/kira-studio/frontend/src/repo/GitPanel.vue` | "Open terminal" in the repo-row menu; the new worktree-row menu; the terminal indicator on both rows; the HEAD label; `refreshRepoHeads` on mount (§10.2, §11.2, §12.4) |
| `apps/kira-studio/frontend/src/repo/state/worktrees.ts` | §13.2's sort |
| `apps/kira-studio/tests/ui/support/ipcChannels.ts` | Five new keys |
| `apps/kira-studio/tests/ui/support/mockRuntime.ts` | Five `FQN_SUFFIX_BY_IPC_KEY` entries (`:39`+) |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | §17.2's three new tests |

Deleted: none. **No `packages/git-ui/` file, no `packages/git-ipc/` file, no
`apps/kira-studio-vscode/` file, no contract change, no `CONTRACT_VERSION` bump.**

## 17. Tests

### 17.1 One earned unit test — `internal/terminal/session_test.go`

`CLAUDE.md`'s bar names concurrency (ordering, cancellation, races) and cleanup with interacting
rules. §4 is exactly that: a reader goroutine, a signal-then-wait-then-kill ordering that is wrong
in both other orders, an idempotent close racing an exiting process, and three teardown levels. This
is the same class P76's `blame-line-controller.spec.ts` cleared.

| Case | Asserts |
|---|---|
| `TestSessionSpawnsAtCwd` | `Open` with a temp dir, write `pwd\n`, the output contains that dir |
| `TestSessionResizeAppliesWinsize` | `Resize(100, 30)`, then `stty size` reports `30 100` — the real ioctl, not the stored field |
| `TestSessionCloseKillsProcessGroup` | Start a `sleep 300` child inside the shell, `Close`, both the shell and the child are gone within the grace period |
| `TestSessionCloseIsIdempotent` | Two `Close` calls, no panic, one `onExit` |
| `TestSessionWriteAfterCloseIsNoop` | `Write` after `Close` returns nil and writes nothing |
| `TestSessionExitEmitsOnce` | `exit\n` produces exactly one `onExit` with code 0 and no `onData` after it |
| `TestRegistryCloseWindowClosesOnlyThatWindow` | Two windows, two sessions, `CloseWindow(a)` leaves b's alive |
| `TestRegistryRejectsDuplicateID` | A second `Open` with a live id is `E_INVALID` and does not spawn |

Each drives a real PTY. On a host with no `/dev/ptmx` these fail loudly rather than skipping — a
skipped test that silently never runs is worse than a red one, and every environment this repo's Go
tier runs in (darwin, the Linux dev container) has one.

### 17.2 Playwright — `apps/kira-studio/tests/ui/repo-workspace.spec.ts`

Three tests, beside the P82 worktree test. Harness additions: five `ipcChannels.ts`/
`mockRuntime.ts` entries (`TerminalService.Open/Write/Resize/Close`,
`CodeWorkspaceService.RepoHeads`) and `emitWailsEvent(page, IPC.terminal, …)` (`mockRuntime.ts:647`)
for the push channel.

1. **"the tab strip's + opens a terminal tab at the active worktree"** — `openGitModule`,
   `repoRow(page).dblclick()`, click `[data-testid="tab-strip-new"]`, assert
   `[data-testid="context-menu"]` is visible with exactly one item, click
   `[data-testid="menu-item-new-terminal"]`, then assert all three of: `control.log()` contains
   `IPC.terminalOpen` with `{cwd: REPO.root}`, `tab(page, 'terminal')` is count 1, and an emitted
   `kira:terminal:data` event carrying base64 `"hello\r\n"` renders as text inside
   `.xterm-rows`. That last assertion is what makes this a wiring test rather than a call-count
   test: it proves subscribe → decode → `term.write` → DOM.
2. **"a worktree row's menu opens a terminal there, and both rows show the indicator"** — expand
   the row (P82's twisty), right-click `[data-worktree-path="/tmp/demo-repo-feature"]`, click
   `[data-testid="menu-item-open-terminal"]`, assert `terminalOpen` carried that path and that
   `[data-testid="repo-terminal-indicator"]` appears on that row and not on the other.
3. **"every repo row shows its checked-out branch, main worktree first"** — with `RepoHeads`
   answering `{kind: 'branch', name: 'main'}` for `repo-1` and `{kind: 'detached', sha: 'abc1234…'}`
   for `repo-2`, assert both rows' `.repo-head` text (`main`, `detached @ abc1234`) and that the
   expanded list's first `[data-testid="repo-worktree-row"]` is the one carrying the `main` badge —
   with the mock deliberately returning `worktree.list` **linked-first**, so the assertion proves
   §13.2's sort rather than passing on the server's own order.

### 17.3 The boundary: no Playwright test for real shell I/O

There is none, and no substitute is invented. Two reasons, both structural:

- The Playwright tier runs the built frontend against `mockRuntime.ts`'s intercepted bound-call
  endpoint (`installControlMocks` intercepts the `Call` RPC route). There is no Go process behind
  it at all, so there is no PTY to exercise — every bound call in that tier is a scripted literal.
- The real app is a Wails v3 native window (GTK4/WebKitGTK on Linux, AppKit on darwin) with no
  remote-debugging hook, which is why P82's own result section records that no manual GUI pass was
  possible in this sandbox. Nothing in this phase changes that.

Asserting that a *mocked* `terminalOpen` was called and that *synthesised* bytes render is a real
assertion about this phase's wiring and is what §17.2 does. Asserting that "a shell started" from
that tier would be a fabrication. The shell itself is §17.1's subject, in the tier that can actually
start one.

### 17.4 Checks

Per commit (the pre-commit hook runs them): `bun run typecheck`, `biome check .` (expect only the
known pre-existing `UncommittedChangesStrip.vue` info finding), `scripts/check-tokens.sh`,
`bun run build`. Go commits additionally: `go build ./...`, `go vet ./...`.

Once, at the end of the phase:

1. `go test ./...` — including `internal/terminal` (new) and `internal/layering_test.go` (which
   picks up the new domain package automatically).
2. `bun run test:unit` — `go-ts-vocabulary-parity.spec.ts` is the one that fails loudly if the Go
   `RenderableTabKinds` line was forgotten.
3. `bun run test:ui` (`ui` + `ui-timing`). Report counts. `repo-workspace.spec.ts`, `tabs.spec.ts`
   and `repo-graph-lifecycle.spec.ts` all drive the tab strip or the repo row and are the specs most
   exposed to a new trailing slot and a new row child; all must be green.
4. `bun run build:vscode` and `bun run test:webview` — expected entirely unaffected (no
   `packages/git-*` or `apps/kira-studio-vscode` file is touched); confirm by diffing the touched
   file list, the way P78's result section did, rather than asserting it.
5. Manual pass in the real app, `CLAUDE.md`'s "see it working" bar for a UI phase: open a terminal
   from the "+" and from both row menus; type `pwd` and confirm the worktree path; resize the window
   and confirm `stty size` follows; run `sleep 300 &` then close the tab and confirm with `ps` that
   neither the shell nor the child survives; close the window with a terminal open and confirm the
   same; `exit` and confirm the tab stays with its footer; open two terminals at one worktree and
   confirm both run and both are counted by the indicator's tooltip; `git checkout -b x` and confirm
   the open repo's row label follows; `git worktree remove` a worktree with a terminal open in it
   and confirm the terminal survives (§8.2) while its row and indicator disappear. **If no GUI is
   available in this sandbox — which every prior phase in this chapter found — say so plainly in the
   phase result rather than claiming it passed.**

## 18. Contract version — no bump

`CONTRACT_VERSION` (`packages/git-ipc/src/validate.ts:151`, currently **39**) and
`gitrpc.ContractVersion` (`internal/gitrpc/contract.go:156`, currently **39**) version the git
contract: the request/event/stream map `@kira/git-ipc` declares and both `bridge/gitstream.go` and
`gitsock` carry. P83 adds **no** contract request, **no** event, **no** stream, **no** `UiActionKind`
member and **no** `app.init` capability — §3 puts every terminal method on the Wails bound surface
instead, and §10.1 keeps `packages/git-ui/` untouched.

So, explicitly, none of the four-part ritual P74/P75/P77/P79's result sections describe applies:

- no `validate.ts` / `contract.go` edit;
- no `internal/gitrpc/stash_test.go` `TestContractVersion_Is39` rename;
- no `packages/git-ipc/testdata/graphChunkFrame.{bin,json}` regeneration
  (`KIRA_GIT_FIXTURES=write`);
- no `internal/bridge/gitstream.go` allowlist entry — and `TestGitrpcDispatch_EveryMethodIsClassified`
  stays green precisely because no new gitrpc method exists.

If implementation discovers a genuine need for a git-contract method, that is a design change, not a
detail: stop and re-read §3.1 before adding one.

## 19. Order and commits

1. **`feat(terminal): a Go PTY session registry behind a bound service`**
   `internal/terminal/*` (§2, §4), `internal/bridge/terminal.go` (§3.2, §3.3),
   `bridge/events.go`, `main.go`'s three wiring points, `go.mod`/`go.sum`,
   `internal/terminal/session_test.go` (§17.1). Go only; nothing user-visible yet.
2. **`feat(terminal): a terminal tab kind rendered with xterm.js`**
   The five vocabularies (§7.1), `tabKinds.ts`/`tabViews.ts`, `persistableTabs()`,
   `state/terminals.ts` (§5), `views/repo/terminalRenderer.ts` + `RepoTerminalView.vue` (§6),
   `bridge/index.ts`, `shared/protocol/events.ts`, `package.json`/`bun.lock`, `NOTICES.md`.
   Opens nothing yet — there is no entry point.
3. **`feat(workbench): a "+" button in the tab strip, opening a terminal`**
   `state/contextMenu.ts`'s `openContextMenuAt` (§9.2), `TabStrip.vue` (§9),
   `state/repoTabs.ts`'s `openRepoTerminalTab` (§10.3), `state/coderepos.ts`'s one `export`.
4. **`feat(repo): open a terminal from a repo or worktree row`**
   `GitPanel.vue`'s two menus (§10.2).
5. **`feat(repo): mark a repo or worktree row that has a terminal open`**
   `GitPanel.vue`'s indicator on both rows (§11).
6. **`feat(repo): show every repo row's checked-out branch`**
   `bridge/codeworkspace.go`'s `RepoHeads` (§12.2), `repo/state/repoHeads.ts` (§12.3),
   `GitPanel.vue`'s label (§12.4), `bridge/index.ts`'s one binding.
7. **`fix(repo): sort the main worktree first in a repo row's worktree list`**
   `repo/state/worktrees.ts` (§13.2).
8. **`test(ui): cover the terminal tab, its entry points and the panel's new row state`**
   §17.2 plus the harness entries.

Dependencies:

- **1 → 2 → 3 → 4** is a real chain. 2 calls 1's service; 3 and 4 both call 2's tab opener.
- **5 depends on 2** (it reads `state/terminals.ts`'s registry), not on 3 or 4.
- **6 and 7 depend on nothing in this phase.** 7 is one function body in a file nothing else here
  touches; 6 touches `GitPanel.vue`, `bridge/index.ts` and `bridge/codeworkspace.go`, none of which
  1-5 need.
- **8 last**, because it asserts against 3-7 at once.

## 20. Passes and subagents — genuinely parallel, unlike P82

**Two Sonnet subagents, in parallel, then one short sequential tail.** This is a real split, not a
defaulted one:

- **Agent A (sequential): commits 1 → 2 → 3 → 4 → 5.** The terminal chain. Every one of these
  either calls the previous one's API or edits the same three files (`GitPanel.vue` twice,
  `state/terminals.ts` twice), so splitting it would mean splitting one continuous, order-dependent
  piece of work — the thing `CLAUDE.md` names explicitly as not a parallelisation candidate.
- **Agent B (sequential): commits 6 → 7.** The two panel items with no terminal dependency. B
  touches `bridge/codeworkspace.go`, `bridge/index.ts`, a new `repo/state/repoHeads.ts`,
  `repo/state/worktrees.ts`, and `GitPanel.vue`.
- **`GitPanel.vue` is the one overlap**, and it is the reason B must merge into A's branch rather
  than the other way round, or run in an isolated worktree merged once A has landed (the shape P79's
  own batches used). A's edits there are in `onRepoContextMenu` and the two rows' trailing slots;
  B's are the repo row's `.repo-head` span, its CSS and an `onMounted` call — different hunks, but
  close enough that the merge must be done by hand and checked, not assumed clean.
- **Then one sequential agent for commit 8** plus §17.4's verification, because the tests assert
  against both halves at once.

If the orchestrating session prefers one agent, the order is 1-8 as listed and nothing changes. The
split is worth taking: A is by far the larger piece (a new Go package, a new bound service, a new
dependency on each side, a new tab kind and a new view) and B is a self-contained ~150 lines.

Size: ~350 new Go lines plus ~250 of Go test; ~450 new TS/Vue lines across the registry, the
renderer boundary and the view; ~120 changed lines in `GitPanel.vue`/`TabStrip.vue`; ~150 lines of
Playwright. Two new dependencies, one Go and one npm. No contract, no `packages/git-*` change.

## 21. Dogfooding note

**The repo-map MCP server was used for this planning pass** — the first pass in this chapter that
managed to, so the note is longer than P82 §15's.

`bun run mcp:repo-map:build` then `bun run mcp:repo-map` printed a fresh `claude mcp add` command
with a usable bearer token (the `CLAUDE.md` step-2 hazard — "Using this repository's existing token"
with no recoverable plaintext — did not bite: this container had no prior token). The native MCP
tool surface is unavailable here exactly as `CLAUDE.md`'s step-3 caveat predicts, so every call went
over plain HTTP/JSON-RPC per step 4. A second instance started later bound to an OS-assigned
ephemeral port (36137) and printed the "existing token" banner, reusing the token the first run had
already shown — worth knowing: a second instance is usable *if* the first run's banner is still in
hand.

What it answered well: `search_symbols {"query":"TabKindDef"}` located
`state/tabKinds.ts:93` with the declaration line, no file open;
`find_definition {"symbol":"ResolveHead"}` resolved `gitclient/repo.go:251:6` with its signature —
the single call that settled §12.1 ("does a HEAD helper already exist");
`find_references {"symbol":"openRepoFileTab"}` returned 18 hits across `repo/`, `views/repo/` and
`tests/unit/`, which is what §10.3's placement argument rests on;
`find_references {"symbol":"worktreeLabel"}` correctly reported **two** symbols and asked for
disambiguation — independently confirming P82's own recorded decision to replicate git-ui's helper
rather than import it.

**One known non-trivial entry re-checked and confirmed still open**, no new entry:
`find_references {"symbol":"GEOMETRY"}` still answers `no references found`, and
`find_references {"symbol":"TAB_KINDS"}` still returns 12 hits, all in `.ts` files, with none of
`TabStrip.vue`'s eight `<script setup>` reads (`:28`, `:34`, `:38`, `:44`, `:120`, `:139`, `:143`).
That is the P72/P73 entry reproducing unchanged at `dc8867f5`, not a new finding —
`docs/v1.8/mcp-repo-map-issues.md` gets one line saying so, and nothing more. Manufacturing a
second entry for the same defect would be the invented finding `CLAUDE.md` warns against.
