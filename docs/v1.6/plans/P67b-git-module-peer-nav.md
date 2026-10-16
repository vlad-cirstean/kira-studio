# P67b — Git as a peer module: nav reorg, mount-lifecycle fixes, relaxed read-only, file-tree icons

> **What this phase is.** `docs/v1.6/SPEC.md`'s P67b row, turned into concrete steps from direct
> reads of the real tree — every file, line number and API below was opened and checked, never
> recalled. SPEC's row was written from a live dogfooding report, not from a source read, and it is
> wrong in one load-bearing way; §0 corrects that before anything is designed on top of it.

---

## 0. SPEC's premise, corrected

SPEC's P67b row says:

> an opened repo is a separate `REPO_WORKSPACE`, not keyed by `AppMode` at all — opening a repo
> swaps out the whole studio/api mode switcher rather than sitting beside it.

**The first half is true, the second half is false.** Checked directly:

- **True.** `workbench/modes.ts:22-25` — `MODES: Record<AppMode, ModeDef>` has exactly `studio` and
  `api`. `modes.ts:33-38` — `REPO_WORKSPACE` is one `ModeDef`-shaped constant, never keyed by
  `AppMode`. `WorkbenchShell.vue:19-21` and `MainView.vue:14-16` both dispatch
  `isRepoWorkspace(workspaceState.active) ? REPO_WORKSPACE.x : MODES[modeState.active].x`.
- **False.** A repo does **not** displace the switcher. `TitleBar.vue:54-75` renders one extra
  `.mode-tab` per `workspaceState.openRepos` member, **after** the Studio/Api tabs, in the same
  flex row, with a hover close ×. Studio, Api and every open repo already sit side by side.

**So what is the user actually reporting?** Their own words: *"All git stuff is in the git module. A
module is like studio and api. So there are no repos alingside connections."* Read against the
tree, that is two complaints, and neither is the one SPEC paraphrased:

1. **A repository is a top-level peer of Studio and Api, and should not be.** Today the title bar
   reads `Studio | Api | kira-studio | some-other-repo`. Studio is a *module*; a repository is an
   *instance*. Three open repos means five top-level entries, two of which are modules and three of
   which are documents. The user wants exactly three: `Studio | Api | Git`, with repositories
   switched *inside* Git.
2. **The repository list lives inside Studio's connection panel, and should not.**
   `ProjectPanel.vue:163-189` renders a collapsible "Repositories" section above `<ProjectTree />`,
   inside the panel titled "Connections" (`:130-132`), with its own Import button in that panel's
   header (`:146-152`). That is the literal "repos alongside connections" the report names.

`docs/ARCHITECTURE.md:2625` already calls git *"The third top-level module, beside `studio` and
`api`"*. This phase makes the UI match the architecture doc's own long-standing framing.

**Everything else in the row was verified and is accurate.** §2 (graph blanks after opening a
file), §3 (cold-start Retry), §4 (read-only), §5 (icons) each have a confirmed, located root cause
below — none of them guessed.

---

## 1. Confirmed current state

### 1.1 Modes, workspaces and the switcher

| File:line | What is there |
| --- | --- |
| `packages/shared/domain/mode.ts:6` | `export type AppMode = 'studio' \| 'api'` |
| `packages/shared/domain/workspace.ts:8` | `export type WorkspaceKey = AppMode \| \`repo:${string}\`` |
| `packages/shared/domain/workspace.ts:12-24` | `repoWorkspaceKey` / `repoIdOfWorkspace` / `isRepoWorkspace` |
| `packages/shared/domain/tabs.ts:71` | `TabScope = AppMode \| 'repo'` — `'repo'` is a sentinel; a repo tab's real workspace comes from its own `workspaceId` |
| `workbench/modes.ts:22-25` | `MODES` — two entries |
| `workbench/modes.ts:33-38` | `REPO_WORKSPACE` — `panel: RepoPanel`, `start: RepoGraphView` |
| `state/mode.ts:16` | `modeState = reactive({ active: 'studio' as AppMode })` |
| `state/mode.ts:32-37` | `hydrateMode(mode)` — sets `modeState.active` **and** `workspaceState.active` |
| `state/mode.ts:43-51` | `setMode(mode)` — same two writes plus a 150 ms debounced `windowsSetMode` |
| `state/mode.ts:66-68` | `workspaceKeyOf(tab)` — `tab.workspaceId ?? TAB_KIND_MODE[tab.kind]` |
| `state/mode.ts:77-85` | `tabsForWorkspace(key)` — pinned-first partition |
| `state/mode.ts:87-90` | `activeTab` — `tabsState.activeIdByWorkspace[workspaceState.active]` |
| `state/workspace.ts:17-20` | `workspaceState = reactive({ active: WorkspaceKey, openRepos: string[] })` |
| `state/workspace.ts:25-31` | `activateWorkspace(key)` — `setMode(key)` for studio/api, else a bare `workspaceState.active = key` that **leaves `modeState.active` untouched** |
| `state/workspace.ts:37-44` | `openRepoWorkspace(repoId)` — push to `openRepos`, `ensureWorkspaceShell`, `codeWorkspaceOpenWorkspace`, `activateWorkspace` |
| `state/workspace.ts:57-70` | `closeRepoWorkspace(repoId)` — close tabs, drop from `openRepos`, `codeWorkspaceCloseWorkspace`, `disposeGitTransport`, `dropRepoTree`, `dropRepoSearch`, fall back to `'studio'` |
| `state/tabs.ts:250-257` | `hydrateTabs` derives `openRepos` from restored tabs' `workspaceId`s |
| `state/tabs.ts:275-283` | `setActiveTabId` — calls `activateWorkspace(key)`, so activating a repo tab brings its workspace forward |
| `state/repoTabs.ts:168-178` | `ensureWorkspaceShell(repoId)` — guarantees the pinned `repo-graph` tab |
| `main.ts:291` | `hydrateMode(await control.windowsEnsure())` |
| `main.ts:302-317` | post-hydrate loop over `workspaceState.openRepos`, dropping orphans |
| `bridge/index.ts:322-327` | `windowsEnsure(): Promise<AppMode>` (`trust<AppMode>`, no runtime validation) / `windowsSetMode(mode)` |
| `internal/storage/model/window.go:27` | `validWindowModes = map[string]bool{"studio": true, "api": true}` |
| `internal/storage/model/window.go:31` | `DefaultWindowMode = "studio"` |
| `internal/storage/migrations/0014_p22_window_mode.sql` | `windows.mode TEXT NOT NULL DEFAULT 'studio'` — a plain TEXT column, no CHECK constraint |

**No migration is needed to add a third mode.** The column is unconstrained TEXT; only
`validWindowModes` narrows it, and `NormalizeMode` (`window.go:37-42`) already falls back to
`"studio"` for anything unknown, so an older binary reading a `'git'` row degrades cleanly.

### 1.2 The two panels

| File:line | What is there |
| --- | --- |
| `workbench/panels/ProjectPanel.vue:127` | `:empty="connections === 0 && codeRepos === 0"` |
| `workbench/panels/ProjectPanel.vue:130-132` | title: `Connections` |
| `workbench/panels/ProjectPanel.vue:146-152` | the `repo` IconButton — `Import repository…` |
| `workbench/panels/ProjectPanel.vue:163-189` | the whole `repo-section`: collapse toggle, `repo-row` list, select/dblclick-open |
| `workbench/panels/ProjectPanel.vue:26-36` | `reposCollapsed` / `selectedRepoId` / `importError` / `filteredRepos` |
| `workbench/panels/ProjectPanel.vue:38-53` | `onImport` / `onSelectRepo` / `onOpenRepo` |
| `workbench/panels/ProjectPanel.vue:82-121` | `onRenameRepo` / `onRemoveRepo` / `onRepoContextMenu` |
| `workbench/panels/ProjectPanel.vue:233-286` | the repo-section CSS |
| `repo/RepoPanel.vue:21-22` | `repoId` derived from `workspaceState.active`, not a prop |
| `repo/RepoPanel.vue:28-36` | the Files / Search / Review `SegmentedControl` |
| `repo/RepoPanel.vue:45-60` | `reviewActivatedRepoIds` — Review mounts once per repo, then `v-show` |
| `repo/RepoPanel.vue:82-141` | one `PanelShell`, titled with the repo's name |
| `repo/RepoPanel.vue:69-78` | registers the `repo.search` palette command for as long as it is mounted |

`ProjectPanel.vue` and `RepoPanel.vue` are the only two `codeReposState` consumers in the UI
(`grep`: the other hits are `hostHandlers.ts` and `main.ts`, neither a panel).

### 1.3 The git transport and its two mount sites

| File:line | What is there |
| --- | --- |
| `repo/git/transport.ts:130-189` | `createNativeGitTransport(codeRepoId)` — `createRpcClient(createStreamChannel(Stream('git')))` plus the host/local split |
| `repo/git/transport.ts:191-205` | `gitTransportFor(codeRepoId)` — **one cached `Transport` per repo workspace**, explicitly "cached across mount/unmount of the pinned graph tab" |
| `repo/git/transport.ts:207-215` | `disposeGitTransport(codeRepoId)` — the only intended disposal, from `closeRepoWorkspace` |
| `views/repo/RepoGraphView.vue:40-53` | `mount(container, { transport: gitTransportFor(repoId), … view: 'graph' })` |
| `views/repo/RepoGraphView.vue:61-64` | `onUnmounted` → `handle.unmount()` |
| `repo/RepoReviewView.vue:37-44` | the same `mount(…, view: 'review')` on the **same cached transport** |
| `views/repo/RepoDiffView.vue:95`, `:196` | `gitTransportFor(repoId)` for plain requests / a diff mount — never disposes |
| `views/repo/RepoFileView.vue:110` | `gitTransportFor(…)` handed to `attachBlameAnnotation` — never disposes |
| `views/repo/reviewDecorations.ts` | uses the transport's `request` and subscribes via `onReviewRepaint` |

Confirmed by repo-map (`find_references {"symbol":"gitTransportFor"}`): exactly five call sites, the
five above.

### 1.4 The read-only boundary, all three layers

| File:line | What is there |
| --- | --- |
| `internal/bridge/gitstream.go:70-92` | `readOnlyMethods` — the load-bearing **allowlist** (default-deny) |
| `internal/bridge/gitstream.go:97-99` | `readOnlyStreamMethods` — `graph.stream` only |
| `internal/bridge/gitstream.go:108-116` | `readOnlyRequest` — refuses with `E_READ_ONLY` before the router runs |
| `internal/bridge/gitstream.go:124-151` | `repoSettingsSetTouchesRestrictedField` / `readOnlyRepoSettingsSet` — the FIELD-level guard (`WorktreePrepareScript`, `WorktreeBasePath`, `PullStrategy`, `CheckoutAutoStash`) |
| `internal/bridge/gitstream.go:176` | `gconn.DisableAutoFetch()` |
| `internal/bridge/gitstream.go:182-183` | the wrapper composition in `ServeGitStream` |
| `repo/git/hostHandlers.ts:176-197` | `capabilities` — `write: false`, `resolveConflict: false`, `runPrepareScript: false`, `openWorktreeWindow: false`, `goToFile: false` |
| `repo/git/hostHandlers.ts:367-386` | `readOnlyRefusal` entries — `editor.goToFile`, `credential.provide`, `editor.resolveConflict`, `settings.setGitPath`, `worktree.openWindow` |
| `internal/bridge/gitstream_test.go:29-34` | `writeMethods` — the pinned "must stay refused" list |
| `internal/bridge/gitstream_test.go:36-38` | `hostAnsweredMethods` |
| `internal/bridge/gitstream_test.go:48-53` | `preflightMethods` |
| `internal/bridge/gitstream_classification_coverage_test.go:33` | `TestGitrpcDispatch_EveryMethodIsClassified` (C13-11) — cross-checks all four lists against gitrpc's real dispatch table |

`docs/ARCHITECTURE.md:2632-2635` states the current claim outright: *"The native mount is provably
read-only … nothing in this window can write to a repository through any route the VS Code
extension can."*

### 1.5 What write machinery already exists in Go (built for the VS Code extension, which is **not** read-only)

`internal/gitrpc/handlers.go:133-251` serves 56 request methods and one stream. The mutating ones:

| Method | Backing |
| --- | --- |
| `op.run` | `gitsession/ops.go:181-315`'s `opTable` — **22 served kinds**: `checkout`, `branchCreate/Delete/Rename`, `tagCreate/Delete`, `revert`, `opContinue/opAbort/opSkip`, `stashPush/Apply/Pop/Drop/Branch`, `reset`, `cherryPick`, `worktreeAdd/Remove`, `stackSet`, `globalStashSave/Remove`. `tagPush`/`tagDeleteRemote` answer `ErrUnservedOpKind` |
| `remote.run` | `gitsession/remote.go:406-414` — kinds `fetch`, `push`, `forcePush`, `deleteRemoteBranch`, `pull` |
| `remote.run` kind `pull` | `gitsession/remote.go:534-…`'s `runPullOp`: *"fetch the one branch (killable), then exactly one of `merge --ff-only` / `merge --no-edit` / `rebase`"*. Strategy comes from `PullStrategy = 'ff-only' \| 'merge' \| 'rebase'` (`contract.ts:782`) |
| `undo.run` | `gitsession` undo slots |
| `stack.restack` | the stacked-branch rebase executor |
| `worktree.prepare` | **executes a user-supplied shell script** |
| the nine `preflight.*` + `remote.pullPreflight`/`remote.pushPreflight` | stage the above |
| `credential.provide` | answers the `credential.request` event (`gitaskpass`) |

**There is no standalone `merge` or `rebase` operation anywhere in this stack** — not in `opTable`,
not in `OpRequest` (`contract.ts:891-…`), not in `git-ui`'s menus, not in the VS Code extension.
`grep -rn "mergeBranch\|rebaseOnto\|MergeDialog\|RebaseDialog"` over `packages/git-ui/src`,
`packages/git-ipc/src` and `apps/kira-studio-vscode/src` returns nothing. Merge and rebase exist
**only** as pull strategies, plus rebase inside `stack.restack`. §6.6 states what that means for the
mandate.

`gitrpc.Deps.Askpass` is wired from `main.go:148-150` into the **same** `*gitrpc.Router` that
`bridge.ServeGitStream` serves, so the credential broker is already live on the native stream. What
is missing is purely the UI half: nothing native subscribes to `credential.request`, and
`credential.provide` is refused at `hostHandlers.ts:371-374`. `gitaskpass/broker.go:24` bounds an
unanswered prompt at `DefaultTimeout = 120 * time.Second`.

### 1.6 The two file-icon implementations

| File:line | What is there |
| --- | --- |
| `repo/RepoTreeRow.vue:9-49` | two hand-written extension sets (`IMAGE_EXTENSIONS`, `CODE_EXTENSIONS`) |
| `repo/RepoTreeRow.vue:69-77` | `icon` — five buckets: `folder`/`folder-opened`, `json`, `markdown`, `file-media`, `file-code`, `file` |
| `repo/RepoTreeRow.vue:125-127` | `<CodiconIcon :name="icon" :size="13" class="node-icon" />` |
| `repo/RepoSearchRow.vue:67` | a bare `<CodiconIcon name="file" :size="13" class="node-icon" />` for every match |
| `packages/git-ui/src/icons/setiFileIcon.ts:115` | `setiIconFor(path): { maskUrl, color }` — the diff tree's real rule |
| `packages/git-ui/src/components/FileTree.vue:346-355` | `fileIconStyle(path)` — `maskImage`/`WebkitMaskImage`/`backgroundColor` |
| `packages/git-ui/src/components/FileTree.vue:501-506` | `<span class="kv-file-tree-icon" :style="fileIconStyle(row.node.path)" />` |
| `packages/git-ui/src/components/FileTree.vue:666-676` | `.kv-file-tree-icon` — 16×16, `mask-size: contain`, `mask-repeat: no-repeat`, `mask-position: center` |
| `packages/git-ui/src/components/FileTree.vue:484-490` | a **directory** row: chevron only, no folder glyph |
| `packages/git-ui/package.json` `exports` | `{ ".": "./src/index.ts" }` — `setiFileIcon.ts` is **not** exported |
| `packages/git-ui/src/index.ts` | does not re-export `setiIconFor` |

`seti-icons@0.0.4` is MIT, already a direct dependency of `@kira/git-ui`, ships plain JSON data
(`lib/icons.json`, 144 KB raw), and needs no build step. It satisfies `CLAUDE.md`'s library-first
and fully-open-source rules; nothing new is added.

Confirmed by repo-map (`find_references {"symbol":"setiIconFor"}`): one production call site
(`FileTree.vue:353`) plus its own test file. Nothing else in the monorepo uses it.

---

## 2. Bug 1 — the graph (and the review panel) go dead after opening a file

**Root cause, located exactly.** The mount tears down a transport it does not own.

```
views/repo/RepoGraphView.vue:62   handle.unmount()
  packages/git-ui/src/main.ts:90    app.unmount()
    packages/git-ui/src/App.vue:1388  bridge.dispose()
      packages/git-ui/src/bridge/client.ts:101-104
        dispose() { this.connectionState.value = 'connecting'; this.#transport.dispose(); }
          repo/git/transport.ts:185-187   dispose() { remote.dispose(); }
            packages/git-ipc/src/rpc.ts:346-362
              rejects every pending request, clears eventHandlers, channel.close()
```

`repo/git/transport.ts:191-205` keeps that now-dead `Transport` in `transportsByCodeRepoId` and
hands the **same object** back on the next `gitTransportFor(repoId)` call. So:

- Open a file → `MainView.vue:20`'s `:key="activeTab.id"` destroys `RepoGraphView` → the socket is
  closed and every event handler cleared.
- Click the pinned graph tab again → `RepoGraphView` remounts → `gitTransportFor` returns the dead
  transport → `bridge.init()`'s `app.init` rejects → `App.vue:965-967` sets `bootError` →
  `App.vue:1427-1429` renders the boot-error panel. **Graph gone.**
- `repo/RepoReviewView.vue:37` shares that exact transport, and `ReviewView.vue:385` calls
  `bridge.dispose()` too. Either one killing it kills the other — *"the same happens to the review
  tab as well"*, verbatim.
- `views/repo/reviewDecorations.ts`'s `transport.on('repo.changed', …)` subscriptions are cleared by
  the same `eventHandlers.clear()`, silently, for every open review diff editor.

### 2.1 Fix — a per-mount lease over the shared client

`gitTransportFor(codeRepoId)` returns a **fresh lease** on every call instead of the shared object.
A lease forwards `request`/`on`/`stream` to the one cached client and tracks what it registered;
`lease.dispose()` releases only the lease's own subscriptions and streams, and **never** closes the
socket. `disposeGitTransport(codeRepoId)` disposes every outstanding lease, then the client.

```ts
// repo/git/transport.ts
interface SharedClient { readonly transport: Transport; readonly leases: Set<Lease>; }

function leaseOf(shared: SharedClient): Transport {
  const unsubs = new Set<() => void>();
  const streams = new AbortController();
  let released = false;
  const lease: Transport = {
    request: (m, p, signal) => shared.transport.request(m, p, signal),
    on(m, h) {
      if (released) return () => {};
      const off = shared.transport.on(m, h);
      unsubs.add(off);
      return () => { unsubs.delete(off); off(); };
    },
    stream(m, p, onChunk, signal) {
      return shared.transport.stream(m, p, onChunk, linkAbort(streams.signal, signal));
    },
    dispose() {
      if (released) return;
      released = true;
      for (const off of unsubs) off();
      unsubs.clear();
      streams.abort();
      shared.leases.delete(lease);
    },
  };
  shared.leases.add(lease);
  return lease;
}
```

Decisions inside that:

- **`dispose()` is idempotent** (`released`), because `App.vue:1376-1388` disposes a chain of state
  objects and this must tolerate being reached twice.
- **`request` is deliberately untracked.** Rejecting a departed mount's in-flight requests would be
  new behaviour, not restored behaviour: `RepoDiffView.vue:95` already issues requests over this
  transport and never disposes anything. An orphaned response resolves into a dead closure, exactly
  as it does today for those call sites.
- **`stream` is tracked**, because `graph.stream` is long-lived and a departed mount's stream is
  real wasted work on both sides. `linkAbort(a, b)` is a four-line helper (an `AbortController`
  that aborts when either input does) rather than `AbortSignal.any`, which this repo does not use
  anywhere today and which would be the phase's only reliance on it.
- **`disposeGitTransport` disposes leases first, then the client** — so a workspace close still
  ends in exactly one `channel.close()`.
- **`BridgeClient.dispose()` is not changed.** It is shared with the VS Code host and the harness,
  where the webview genuinely owns its transport. The bug is that the native host handed out a
  shared object to an owner-shaped consumer; the fix belongs on the native host's side of that
  seam. `packages/git-ui` is untouched by this section.

### 2.2 `RepoGraphView.vue` / `RepoReviewView.vue` doc comments

Both carry a comment asserting the transport "outlives" a tab switch
(`RepoGraphView.vue:4-6`, `:58-60`; `RepoReviewView.vue:49-52`). That assertion was false in fact
and is what made the bug invisible in review. Both comments get one clause naming the lease.

---

## 3. Bug 2 — a cold start needs a manual Retry before the graph loads

**Root cause, located exactly.** The git stream channel sends before the socket is open.

`packages/git-ipc/src/streamChannel.ts:114-136` returns a channel whose `post` is:

```ts
post(message): void { socket.send(JSON.stringify(message)); }
```

`StreamSocketLike` declares `onopen` (`streamChannel.ts:45`) and **`createStreamChannel` never
assigns it** — the field exists and nothing uses it. Wails' own socket refuses a send before open:

```
@wailsio/runtime .../src/stream.ts:274-278
send(data) {
  if (this.readyState === WailsSocket.CONNECTING) {
    throw new DOMException("Still in CONNECTING state.", "InvalidStateError");
  }
```

and `Stream()` *"Returns immediately with `readyState === CONNECTING`"* (`stream.ts:439`).

The ordering makes this deterministic on a cold repo open, not flaky:

1. `RepoGraphView.vue:33` — `await loadGitUi()`.
2. `RepoGraphView.vue:41` — `gitTransportFor(repoId)`; no cached client exists yet, so
   `createNativeGitTransport` runs `Stream('git')` **now**. `readyState === CONNECTING`.
3. `RepoGraphView.vue:40` — `mount(...)` in the same synchronous block.
4. `App.vue:1007` — `await bridge.init()` → `transport.request('app.init', …)` →
   `rpc.ts:275`'s `post(channel, { t:'req', … })` → `socket.send` **throws**.
5. `rpc.ts:260-276` runs that `post` inside the `new Promise` executor, so the throw becomes a
   rejection; `client.ts:69-74` sets `connectionState = 'error'`; `App.vue:965-967` sets
   `bootError`; `App.vue:1427-1429` renders *"Kira Studio isn't reachable — Still in CONNECTING
   state."* with the `boot-retry` button.
6. By the time a human reaches for Retry the socket has opened, the cached client is reused
   (`gitTransportFor`), and `retryBootstrap()` (`App.vue:972-977`) succeeds.

That is exactly *"After i start app an open the repo the graph need to press retry to load"*, and
exactly why a **second** open of the same repo workspace in the same session does not reproduce it.

### 3.1 Fix — gate `post` on the socket's open ack, in the channel

This repo has already solved this once, in the engine stream: `bridge/port.ts:76` assigns
`socket.onopen = () => resolveReady()` and `:137-150` gates the send on `ready.then(...)` with the
comment *"P57 D3: send() throws on a CONNECTING socket and silently drops on a closed one, so the
send is gated on the open ack rather than fired synchronously."* `streamChannel.ts` is the one
channel in the codebase that never got that treatment.

```ts
// packages/git-ipc/src/streamChannel.ts
const SOCKET_OPEN = 1; // WebSocket/WailsSocket readyState
let phase: 'connecting' | 'open' | 'closed' =
  socket.readyState === SOCKET_OPEN ? 'open' : 'connecting';
const queued: string[] = [];

socket.onopen = () => {
  if (phase !== 'connecting') return;
  phase = 'open';
  for (const frame of queued) socket.send(frame);
  queued.length = 0;
};

socket.onclose = () => { phase = 'closed'; queued.length = 0; fireClose(); };

post(message): void {
  const frame = JSON.stringify(message);
  if (phase === 'open') socket.send(frame);
  else if (phase === 'connecting') queued.push(frame);
  // 'closed': dropped — the peer is gone; onClose has already fired and the client
  // has already rejected its pending requests.
}
```

- **A queue, not a promise chain**, because `MessageChannelLike.post` is synchronous by contract
  (`rpc.ts` calls it from inside a Promise executor and from `handleFrame`'s credit path,
  `rpc.ts:223`). A promise-gated post would reorder frames relative to `credit`/`cancel`; a FIFO
  queue preserves the send order Go relies on (`@wailsio/runtime .../stream.ts:235`: *"preserve
  order, and Go relies on send order being the order it observes"*).
- **`readyState` is read defensively** so a socket that is already open when the channel wraps it
  (nothing does this today) is not stranded waiting for an `onopen` that already fired.
  `StreamSocketLike` gains `readonly readyState?: number`, optional so the existing test double and
  any other structural implementer keep compiling.
- **No bound on the queue.** Frames can only accumulate between `Stream()` and its own open ack —
  one `app.init` in practice. The bounded-queue machinery `socketChannel.ts` carries
  (`MAX_PENDING_FRAMES`) exists for inbound frames on a byte-stream socket and does not apply.
- **`socketChannel.ts` is untouched.** Its transport is a VS Code `WebviewView` `postMessage` port
  or a real socket managed by the extension host, neither of which has this window.

### 3.2 This one earns a unit test

`CLAUDE.md`'s bar names *"concurrency (ordering, backpressure, cancellation, races)"* explicitly.
This is an ordering race with a silent, hard-to-reproduce symptom. Cases added to the existing
`packages/git-ipc/src/streamChannel.test.ts`:

1. `post` before `onopen` sends nothing, then delivers **in order** once `onopen` fires.
2. `post` after `onopen` sends immediately (the existing assertion at `:140-142`, preserved).
3. A socket presented with `readyState === 1` sends immediately without an `onopen`.
4. `post` after `onclose` sends nothing and does not throw; the queue is dropped.

`MockSocket` (`streamChannel.test.ts:11-37`) gains a `readyState` field and an `open()` helper; the
one existing `post` test (`:140`) calls `socket.open()` first.

---

## 4. The nav reorg — Studio / Api / Git as three peers

### 4.1 D1 — `AppMode` gains `'git'`; `REPO_WORKSPACE` is deleted

```ts
// packages/shared/domain/mode.ts
export type AppMode = 'studio' | 'api' | 'git';
```

```ts
// packages/shared/domain/workspace.ts — new, pure, no Vue
/** Which top-level module a workspace belongs to. Every repo workspace lives inside 'git'. */
export function moduleOfWorkspace(key: WorkspaceKey): AppMode {
  return isRepoWorkspace(key) ? 'git' : (key as AppMode);
}
```

```ts
// workbench/modes.ts
export const MODES: Record<AppMode, ModeDef> = {
  studio: { label: 'Studio', icon: 'database', panel: ProjectPanel, start: StudioStart },
  api: { label: 'Api', icon: 'globe', panel: CollectionsPanel, start: ApiStart },
  git: { label: 'Git', icon: 'source-control', panel: GitPanel, start: GitStart },
};
```

`REPO_WORKSPACE` (`modes.ts:27-38`) is **deleted**, along with both of its dispatch sites:

```ts
// WorkbenchShell.vue:19-21  →
const activeModePanel = computed(() => MODES[moduleOfWorkspace(workspaceState.active)].panel);
// MainView.vue:14-16  →
const modeStart = computed(() => MODES[moduleOfWorkspace(workspaceState.active)].start);
```

Both now dispatch on **one** expression instead of a conditional over two registries. That is the
whole architectural point of the row: git stops being a special case in the shell.

`icon: 'source-control'` is the exact glyph `TitleBar.vue:64` already uses for a repo tab, so the
Git module tab is visually continuous with what it replaces.

### 4.2 D2 — `workspaceState.active` is the single source of truth; `modeState.active` becomes the persisted mirror

Today `activateWorkspace` (`state/workspace.ts:25-31`) deliberately leaves `modeState.active`
untouched for a repo key, with the comment *"leaving the repo later returns to whichever module you
were in"*. That stops being true once Git **is** a module.

```ts
// state/mode.ts — split, so a repo activation can persist 'git' without clobbering the workspace
export function setModule(mode: AppMode): void {   // persistence only
  modeState.active = mode;
  scheduleModeWrite();                              // the existing 150 ms debounce, extracted
}
export function setMode(mode: AppMode): void {      // a module tab click
  setModule(mode);
  workspaceState.active = mode;
}
```

```ts
// state/workspace.ts
export function activateWorkspace(key: WorkspaceKey): void {
  const mode = moduleOfWorkspace(key);
  setModule(mode);
  workspaceState.active = key;
  if (mode === 'git' && isRepoWorkspace(key)) workspaceState.lastRepoKey = key;
}
```

- Activating a repo tab from anywhere (`state/tabs.ts:281`'s `setActiveTabId`) now brings the **Git
  module** forward and highlights its tab — which is what a user who clicked a repo file from Quick
  Open expects, and which is impossible to express today.
- **`workspaceState.lastRepoKey`** (new, session-only, not persisted) is what makes the Git tab
  behave like the repo tabs it replaces: clicking `Git` returns to the repository you were last in,
  not to a generic landing page. `TitleBar`'s handler is
  `activateWorkspace(mode === 'git' ? (workspaceState.lastRepoKey ?? 'git') : mode)`.
  `closeRepoWorkspace` clears `lastRepoKey` when it names the repo being closed.
- `hydrateMode` (`state/mode.ts:32-37`) keeps its two writes; a stored `'git'` lands on
  `workspaceState.active = 'git'`, and `main.ts:302-317`'s existing post-hydrate loop then activates
  the first surviving repo workspace through `ensureWorkspaceShell`/`activateTab`.
- `tabsForMode('git')` returns `[]` by construction (`TAB_KIND_MODE` maps every repo kind to the
  `'repo'` sentinel, `tabs.ts:71`). That is correct, not a gap: the Git module has no tabs of its
  own, only its repositories' tabs. `tabsForWorkspace` is what the tab strip uses
  (`TabStrip.vue:128`) and is unchanged.
- **Go:** `internal/storage/model/window.go:27` becomes
  `{"studio": true, "api": true, "git": true}`. That is the entire backend change for §4.
  `bridge/index.ts:322`'s `trust<AppMode>` does no runtime validation, so nothing else moves.

### 4.3 D3 — `TitleBar.vue`: three tabs, no repo tabs

- `MODE_ORDER` (`:13`) → `['studio', 'api', 'git']`.
- The `v-for="repoId in workspaceState.openRepos"` block (`:54-75`) is **deleted**, with its
  `.repo-tab` / `.repo-tab-close` CSS (`:214-233`) and its `onRepoClick`/`onRepoClose` handlers
  (`:21-28`). `codeRepoRecord`, `repoWorkspaceKey`, `activateWorkspace` and `closeRepoWorkspace`
  imports go with them.
- Active-state test becomes `moduleOfWorkspace(workspaceState.active) === mode`, not
  `modeState.active === mode` — one reactive source, no drift possible.
- Everything else in that file — the draggable-region override, the icon-box metrics, the
  `--kira-icon-optical-y` nudge, the title-bar actions — is untouched. The row goes back to a
  fixed-width three-tab group, which also retires the file's own noted overflow caveat
  (`:52-53`: *"overflow with many repos open is left to this row's existing horizontal scroll"*).

### 4.4 D4 — `repo/GitPanel.vue`: the Git module's own panel

`repo/RepoPanel.vue` is **renamed** to `repo/GitPanel.vue` and grows the repository list moved out
of `ProjectPanel.vue`. One `PanelShell`, as today — not a shell inside a shell.

```
PanelShell
  #title    "Repositories"           when no repo workspace is active
            <repo name>              when one is
  #actions  IconButton repo "Import repository…"        always
            SegmentedControl Files/Search/Review        only with an active repo
            IconButton refresh                          only with an active repo, view === 'files'
  #body     <section class="repo-section">   the moved list (always rendered when records exist)
            <the existing Files / Search / Review body>  only with an active repo
  #empty    "Import a repository to get started."        when codeReposState.records is empty
```

The repository list is the title bar's repo switcher, relocated and widened:

| Row state | Rendering | Click |
| --- | --- | --- |
| imported, not open | name, muted icon | `openRepoWorkspace(id)` |
| open, not active | name, full-brightness icon, hover × | `activateWorkspace(repoWorkspaceKey(id))` |
| open and active | as above plus the existing `.selected` highlight, × always visible | no-op |

- **A single click opens or activates.** The old `ProjectPanel` semantics (click selects, double
  click opens) existed because the row lived in a panel about something else. In a panel whose whole
  subject is repositories, a click that does nothing visible is a dead control. Double-click keeps
  working (it is a click first). See OQ-2.
- The × calls `closeRepoWorkspace(id)` — the exact handler `TitleBar.vue:25-28` had, with
  `e.stopPropagation()`.
- `data-testid="repo-row"` and `data-repo-id` are **kept** (`repo-workspace.spec.ts:70`, `:489`
  already select on them). `data-testid="workspace-repo-close"` moves here unchanged so its
  assertions survive the relocation; `data-testid="workspace-repo-tab"` has no successor and its one
  assertion (`repo-workspace.spec.ts:94`) retargets to `repo-row`.
- `filteredRepos` moves too, but reads `local.search` (this panel's own `PanelShell` search box),
  **not** `treeState.search` — the Studio tree's filter has no business filtering this panel.
  `RepoPanel.vue`'s existing `:searchable="view === 'files'"` widens to
  `searchable: true` (the box now also filters the repo list).
- `onRenameRepo`/`onRemoveRepo`/`onRepoContextMenu` and the `promptText` dialog
  (`ProjectPanel.vue:55-121`, `:202-220`) move verbatim, plus one new `Close` item in the context
  menu for an open repo.
- `reviewActivatedRepoIds` (`RepoPanel.vue:45-60`), the `repo.search` command registration
  (`:69-78`) and the `ensureReviewPanelWidth` widening (`:57`) are unchanged.
- `repoId` still derives from `workspaceState.active` (`RepoPanel.vue:21`) — now yielding `''` when
  the active workspace is the bare `'git'` key, which is exactly the "list only" state.

`repo/GitStart.vue` is new and tiny: the Git module's `MainView` fallback, built on `EmptyState` in
the same shape as `workbench/panels/StudioStart.vue` / `api/ApiStart.vue` — a headline, and an
`Import repository…` button calling `importRepoViaDialog()`. Reachable whenever the Git module is
active with no repo open.

### 4.5 D5 — `ProjectPanel.vue` loses everything repo-shaped

Deleted: `codeReposState`/`importRepoViaDialog`/`removeCodeRepo`/`renameCodeRepo`/
`openRepoWorkspace` imports (`:7-16`), `reposCollapsed`/`selectedRepoId`/`importError`/
`filteredRepos` (`:26-36`), `onImport`/`onSelectRepo`/`onOpenRepo` (`:38-53`), the whole
`promptText` machinery and the three repo handlers (`:55-121`), the `repo` IconButton (`:146-152`),
the import-error strip (`:155-162`), the `repo-section` block (`:163-189`), the text-prompt dialog
(`:202-220`) and the repo CSS (`:233-286`). `:empty` reverts to
`connectionsState.records.length === 0`.

What is left is a panel that is only about connections — the shape its own title has claimed since
P1.

### 4.6 D6 — the Git module's panel and start are lazily imported

`workbench/modes.ts` currently pulls `repo/RepoPanel.vue` (and therefore `RepoFileTree.vue`,
`RepoTreeRow.vue`, `RepoSearchView.vue`, `RepoReviewView.vue`) into the eager launch chunk for every
session, including one that never opens a repository. `gitUiModule.ts:1-8` records that C12-3 went
to real trouble to keep `@kira/git-ui` out of that chunk for exactly this reason.

```ts
git: {
  label: 'Git', icon: 'source-control',
  panel: defineAsyncComponent(() => import('../repo/GitPanel.vue')),
  start: defineAsyncComponent(() => import('../repo/GitStart.vue')),
},
```

This is the mechanism `views/repo/monaco.ts` and `repo/git/gitUiModule.ts` already use, applied to
the registry rather than to a call site. It is also what makes §6 affordable: `seti-icons`' 144 KB of
JSON data lands in the Git module's chunk, never in the launch chunk. `Component` already covers
`defineAsyncComponent`'s return, so `ModeDef` needs no type change.

`workbench/tabViews.ts` stays **statically** imported, unchanged: its own comment (`:18-20`) states
the registry is deliberately not a lazy-load boundary, and the heavy parts behind the three repo tab
views (Monaco, git-ui) are already dynamic.

---

## 5. Relaxing read-only

### 5.1 D7 — what "read-only is about modifying files" means, taken literally

The user's premise: *"The readonly is about modifing files. I should be able to pull, merge rebase
etc. only in case of conflicts i can t continue."*

Checked against §1.5, exactly four things in the git surface genuinely need something this app does
not have:

| Blocked | Why it stays blocked |
| --- | --- |
| `editor.resolveConflict` | Needs a file editor / merge tool. The premise's own carve-out |
| `worktree.prepare` / `worktree.cancelPrepare` | **Executes a user-supplied shell command.** `gitstream.go:79-87` records that `RunPrepare`'s only gate is "does this match what's stored", with no approval gate anywhere in the codebase. A security boundary, not a file-editing one |
| `worktree.openWindow` | `vscode.openFolder`; no native meaning (`hostHandlers.ts:188-190`) |
| `settings.setGitPath` | This app's own Settings dialog owns the global git path |

Every other mutating method — all 22 `op.run` kinds, all five `remote.run` kinds, `undo.run`,
`stack.restack`, every preflight — writes refs, the index or the working tree through git itself and
needs no in-app editor. **So the honest widening is: admit everything except those four, and keep
the three capability flags that hide them.**

The alternative considered and rejected: admit only `fetch`/`pull` and keep everything else refused.
That cannot be built honestly, because the UI's write gate is **one boolean**
(`capabilities.write`, `hostHandlers.ts:194-196`, read by `AppToolbar.vue:272`, `BranchPicker.vue`,
`StashList.vue`, `TagList.vue`, `WorktreeList.vue`, `UndoButton.vue`, `ConflictBanner.vue`,
`RepoSettingsDialog.vue`). Narrow-allowlist-plus-`write: true` produces exactly the failure
`gitstream.go:47-51` exists to prevent — *"a confirm dialog whose confirm button then fails at this
layer"*. Getting narrower would mean widening `Capabilities` in `@kira/git-ipc`, bumping
`ContractVersion`, and threading a second flag through ~10 git-ui components **and** the VS Code
extension, for a distinction the user did not ask for. Declined; see OQ-4.

### 5.2 D8 — layer 1 (`internal/bridge/gitstream.go`)

`readOnlyMethods` is **renamed** `allowedMethods` and widened to every method
`gitrpc/handlers.go:133-241` serves except `worktree.prepare`, `worktree.cancelPrepare` and
`settings.setGitPath`. It stays a default-deny allowlist — the property `gitstream.go:42-45` names
and the only reason this file exists. `readOnlyStreamMethods` is unchanged (`graph.stream` is still
the only stream the router serves).

Added, mirroring `readOnlyRepoSettingsSet`'s existing field-level precedent (`:143-151`):

```go
// op.run carries 22 kinds; two of them create or destroy a worktree, whose prepare-script
// execution path this stream refuses outright (worktree.prepare, above). Admitting the pair
// while refusing the script would leave the UI offering a worktree it cannot prepare.
var refusedOpKinds = map[string]struct{}{"worktreeAdd": {}, "worktreeRemove": {}}

func allowedOpRun(next requestFn) requestFn { /* decode OpRunParams, check p.Op.Kind */ }
```

and the paired `preflight.worktreeAdd` / `preflight.worktreeRemove` leave the allowlist with them.

`repoSettingsSetTouchesRestrictedField` (`:124-135`) narrows to
`WorktreePrepareScript != nil || WorktreeBasePath != nil`. `PullStrategy` and `CheckoutAutoStash`
are **removed** from that list — they are the pull-strategy and auto-stash settings this phase's
whole point is to enable, and `RepoSettingsDialog.vue:49`'s own `write` gate already hides them when
the capability is off.

`gconn.DisableAutoFetch()` (`:176`) **stays**. Background auto-fetch is a network write the user did
not ask for and did not name; explicit, user-initiated fetch is. See OQ-5.

`internal/bridge/gitstream_test.go`'s four tables move accordingly:
`writeMethods` shrinks to `{"worktree.prepare", "worktree.cancelPrepare", "settings.setGitPath"}`;
`preflightMethods` shrinks to the two worktree preflights; `hostAnsweredMethods` is unchanged; every
newly-admitted method joins the positive "reaches the handler" table.
`TestGitrpcDispatch_EveryMethodIsClassified` is the backstop that makes an omission fail loudly, and
needs no change of its own. New cases: `op.run` with `worktreeAdd` is refused and never reaches the
handler; `op.run` with `pull`-adjacent kinds (`opContinue`) reaches it; `repoSettings.set` with
`pullStrategy` now reaches it, with `worktreePrepareScript` still does not.

### 5.3 D9 — layer 2 (`repo/git/hostHandlers.ts`)

| Entry | Change |
| --- | --- |
| `capabilities.write` (`:196`) | `false` → `true` |
| `capabilities.resolveConflict` (`:187`) | stays `false` |
| `capabilities.runPrepareScript` (`:193`) | stays `false` |
| `capabilities.openWorktreeWindow` (`:190`) | stays `false` |
| `capabilities.goToFile` (`:181`) | stays `false` |
| `'editor.resolveConflict'` refusal (`:375-378`) | stays; its message drops "(§4.2)" for a user-facing reason |
| `'worktree.openWindow'` refusal (`:383-386`) | stays |
| `'settings.setGitPath'` refusal (`:379-382`) | stays |
| `'editor.goToFile'` refusal (`:367`) | stays |
| `'credential.provide'` refusal (`:371-374`) | **deleted** — §5.5 answers it for real |

Every capability that stays `false` corresponds to something layer 1 still refuses. After this
phase, that correspondence is total in both directions — no visible affordance fails at layer 1, and
nothing layer 1 admits is invisible. That property replaces "provably read-only" as the invariant
`gitstream_test.go` and `docs/ARCHITECTURE.md` state.

### 5.4 D10 — conflicts surface, and are never continued past

`packages/git-ui/src/components/ConflictBanner.vue` already does most of this and needs almost
nothing:

- It renders whenever `ops.statusSummary.value.inProgress !== null` (`:33`), which
  `RemoteOpResult.InProgress` (`gitsession/remote.go:110`) and every `op.run` result already carry,
  and which `runPullOp`'s own comment (`remote.go:537-538`) names as where a conflicting
  merge/rebase lands.
- Its **Resolve** action is gated on `resolveConflictEnabled`, which stays `false`. The button never
  appears.
- **Continue / Skip / Abort** are gated on `writeCapability` and become live. `opContinue`,
  `opAbort` and `opSkip` are ordinary `op.run` kinds (`opTable`, `gitsession/ops.go:218-235`) and are
  admitted by §5.2.

One additive change to that component: when `resolveConflictEnabled` is `false`, render a single
explanatory line beside Continue — *"Resolve the conflicted files in your own editor, then
Continue."* — instead of leaving a Continue button disabled with no stated reason. It is gated on
`!resolveConflictEnabled`, so the VS Code host (which has a real resolve action) renders exactly what
it renders today. This is the phase's only edit to `packages/git-ui`.

**Continue is deliberately allowed, not blocked.** The user cannot *resolve* a conflict in this app;
they can absolutely resolve it in their own editor and then tell git to carry on. Blocking Continue
would strand a half-finished rebase with only Abort as an exit, which is worse, not safer.

### 5.5 D11 — the credential prompt, the one genuinely new piece

Confirmed missing end to end: `grep -rn "credential" packages/git-ui/src` returns **nothing**. Under
VS Code the *extension host* owns this (`apps/kira-studio-vscode/src/extension.ts:547-550`,
`ports/credentialPrompt.ts`), never the webview — `proxyHandlers.ts:523-525` throws on
`credential.provide` for the same reason `hostHandlers.ts:371` does. Natively there is no third
tier, so Kira Studio's own window must answer.

The Go half is already live on this stream: `main.go:148-150` wires `gitrpc.Deps.Askpass` into the
same `*gitrpc.Router` `ServeGitStream` serves, `gitsession/remote.go:165-172`'s `withAskpass`
interposes when the user has no askpass of their own (`gitaskpass/interpose.go:8`), and
`gconn.Emit` (`gitstream.go:186`) carries `credential.request` to the renderer. An unanswered prompt
blocks for `gitaskpass.DefaultTimeout` = 120 s (`broker.go:24`) — which is what a shipped
`credential.provide` refusal would actually cost a user today.

> The contract's own note on `credential.request` (`contract.ts:2216-2218`) says the event goes to
> *"the connection that owns the in-flight remote op — never Kira Studio's own window"*. That is
> about an **external paired client's** op, whose owning connection is that client's `gitsession.Conn`.
> The native stream's own op is owned by the native `Conn` (`gitstream.go:171`), so routing it to
> this window is the rule applied, not broken.

Three small new pieces:

```
apps/kira-studio/frontend/src/state/gitCredential.ts     the queue + reactive prompt state
apps/kira-studio/frontend/src/workbench/GitCredentialDialog.vue   the modal
```

- `repo/git/transport.ts`'s `createNativeGitTransport` subscribes once per repo workspace:
  `remote.on('credential.request', (req) => enqueueCredentialRequest(codeRepoId, req))`.
- `state/gitCredential.ts` holds a FIFO (`requestId` is server-minted and unguessable,
  `contract.ts:2219-2222`) and exposes `{ active, answer(secret: string | null) }`. `answer` calls
  `transport.request('credential.provide', { requestId, secret })` on the same repo workspace's
  lease. `secret: null` on dismiss — the wire carries the dismissal, it is never an omission
  (`contract.ts:2001-2003`).
- `GitCredentialDialog.vue` renders `payload.prompt` **verbatim** (it is git's own text) with a
  `TextField` whose `type` is `password` when `payload.masked`, `text` otherwise
  (`contract.ts:2225-2226`: `masked` is `false` only for git's own "Username for …" shape). Mounted
  beside `SettingsDialog` in `TitleBar.vue:124-126`'s `<Teleport to="body">`, so it is reachable
  regardless of which module is active — a pull started in Git must be answerable after switching to
  Studio.
- **Nothing is logged, stored, or put in component state beyond the modal's lifetime.**
  `gitaskpass/prompt.go:11-13` states the same rule on the Go side: the prompt itself can contain a
  username the user just typed. The field is cleared on answer and on dismiss, and no value is ever
  passed to `console`, to the op log, or to any persistence path.
- Escape / Cancel answers `null`, which `RemoteOpError` surfaces as the ordinary
  `Cancelled`/auth-failure path `ClassifyRemoteError` already produces — no new error state.

### 5.6 D12 — what this costs, stated plainly

`docs/ARCHITECTURE.md:2632-2635` ("The native mount is provably read-only … nothing in this window
can write to a repository through any route the VS Code extension can") and `:2984-3000` (the
three-layer description) become **false** and must be rewritten, not patched — §8. This is a real
posture change: after this phase Kira Studio's own window is a writing git client. It is what the
row asks for, and the safety argument that replaces "read-only" is the one in D9: layer 1 stays a
default-deny allowlist, the four genuinely-unavailable operations stay refused at both layers, and
every capability flag matches what layer 1 admits.

---

## 6. File-tree icons

### 6.1 D13 — export the diff tree's rule, do not reimplement it

```jsonc
// packages/git-ui/package.json
"exports": {
  ".": "./src/index.ts",
  "./icons": "./src/icons/setiFileIcon.ts"
}
```

A subpath, **not** a re-export from `src/index.ts`: `index.ts` pulls `App.vue`, `main.ts`, SlickGrid
and the whole graph layer, and `gitUiModule.ts:1-8` exists precisely to keep that out of anything
eager. `setiFileIcon.ts` imports `seti-icons` and nothing else. `bun`'s workspace resolution serves
the subpath directly; no Vite alias and no tsconfig `paths` entry is needed (neither
`vite.config.ts:27-42` nor `frontend/tsconfig.json:21-30` maps `@kira/*` today — they resolve
through workspace `node_modules`).

### 6.2 D14 — `repo/RepoTreeRow.vue`

- Delete `IMAGE_EXTENSIONS` / `CODE_EXTENSIONS` / `extOf` (`:9-54`) and the file arm of the `icon`
  computed (`:71-76`).
- Files render the diff tree's element verbatim:
  `<span class="node-icon" :style="fileIconStyle(row.path)" />`, with `fileIconStyle` a two-line
  copy of `FileTree.vue:352-355` and `.node-icon` carrying `FileTree.vue:666-676`'s rule — 16×16,
  `mask-size: contain`, `mask-repeat: no-repeat`, `mask-position: center`, both `-webkit-` twins.
  The existing `:size="13"` box grows to 16, matching VS Code's own explorer icon box, which is what
  `FileTree.vue:663-665` already settled on.
- **Directories keep `folder` / `folder-opened`** at 16px. The diff tree has no directory-icon rule
  to port: `FileTree.vue:484-496` renders a chevron, a name and a change-count strip, a different row
  shape for a different purpose. Dropping the folder glyph from a file explorer would be inventing a
  rule, not porting one. See OQ-3.
- The four-value status glyph (`:79-81`) is untouched — the mandate is about icons.

`repo/RepoSearchRow.vue:67` gets the same treatment (one shared `fileIconStyle` helper, new file
`repo/fileIcon.ts`, imported by both), because a search result list showing one generic glyph beside
a tree showing per-language icons would be a fresh inconsistency created by this very phase.

### 6.3 Bundle cost, and why §4.6 is the answer

`seti-icons@0.0.4`'s `lib/icons.json` is 144 KB raw. `RepoTreeRow.vue` is reachable only through
`GitPanel.vue`, which §4.6 makes a `defineAsyncComponent`, so the data lands in the Git module's own
chunk. `setiFileIcon.ts:41-63`'s `maskUrlCache` already bounds runtime work to one data URL per
distinct icon, which its own comment measures at ~10-20 per session.

This is the one measurement this phase genuinely needs (`CLAUDE.md`: measure when a real question is
at stake): run `bun run build` before and after and confirm the **launch** chunk does not grow.
If it does, §4.6's lazy boundary is not where it is believed to be, and that is worth finding out
before shipping rather than after.

---

## 7. Files

**New**

```
apps/kira-studio/frontend/src/repo/GitStart.vue                   §4.4
apps/kira-studio/frontend/src/repo/fileIcon.ts                    §6.2
apps/kira-studio/frontend/src/state/gitCredential.ts              §5.5
apps/kira-studio/frontend/src/workbench/GitCredentialDialog.vue   §5.5
```

**Renamed**

```
apps/kira-studio/frontend/src/repo/RepoPanel.vue  ->  repo/GitPanel.vue   §4.4
```

**Extended**

```
packages/shared/domain/mode.ts                       AppMode gains 'git' (§4.1)
packages/shared/domain/workspace.ts                  moduleOfWorkspace (§4.1)
packages/git-ipc/src/streamChannel.ts                the open-ack gate (§3.1)
packages/git-ipc/src/streamChannel.test.ts           four cases + MockSocket.readyState/open (§3.2)
packages/git-ui/package.json                         the "./icons" subpath export (§6.1)
packages/git-ui/src/components/ConflictBanner.vue    the no-resolve-action line (§5.4)
apps/kira-studio/frontend/src/workbench/modes.ts     three MODES, REPO_WORKSPACE deleted (§4.1/§4.6)
apps/kira-studio/frontend/src/workbench/WorkbenchShell.vue   one dispatch (§4.1)
apps/kira-studio/frontend/src/workbench/panels/MainView.vue  one dispatch (§4.1)
apps/kira-studio/frontend/src/workbench/TitleBar.vue         three tabs, repo tabs deleted (§4.3)
apps/kira-studio/frontend/src/workbench/panels/ProjectPanel.vue  repo section deleted (§4.5)
apps/kira-studio/frontend/src/state/mode.ts          setModule/setMode split (§4.2)
apps/kira-studio/frontend/src/state/workspace.ts     activateWorkspace, lastRepoKey (§4.2)
apps/kira-studio/frontend/src/repo/git/transport.ts  leases (§2.1); credential.request (§5.5)
apps/kira-studio/frontend/src/repo/git/hostHandlers.ts  capabilities + refusals (§5.3)
apps/kira-studio/frontend/src/repo/RepoTreeRow.vue   seti icons (§6.2)
apps/kira-studio/frontend/src/repo/RepoSearchRow.vue seti icons (§6.2)
apps/kira-studio/frontend/src/views/repo/RepoGraphView.vue    doc comment (§2.2)
apps/kira-studio/internal/bridge/gitstream.go        allowlist widening (§5.2)
apps/kira-studio/internal/bridge/gitstream_test.go   the four tables (§5.2)
apps/kira-studio/internal/bridge/gitstream_classification_coverage_test.go   renamed table refs (§5.2)
apps/kira-studio/internal/storage/model/window.go    validWindowModes gains "git" (§4.2)
apps/kira-studio/tests/ui/mode-switch.spec.ts        2 tabs -> 3 (§9)
apps/kira-studio/tests/ui/repo-workspace.spec.ts     the switcher's new home (§9)
docs/ARCHITECTURE.md                                 §8
```

**Untouched, and that is the point**

```
packages/shared/domain/tabs.ts        TAB_KIND_MODE and the 'repo' sentinel are already right
state/tabs.ts, state/repoTabs.ts      workspace isolation is unchanged; only who activates it moves
internal/storage/migrations/**        no migration — windows.mode is unconstrained TEXT (§1.1)
internal/gitrpc/**, internal/gitsession/**   every write path already exists (§1.5)
packages/git-ipc/src/contract.ts      no ContractVersion bump (§5.1's rejected alternative)
packages/git-ui/src/bridge/client.ts  BridgeClient.dispose stays as VS Code needs it (§2.1)
packages/git-ipc/src/socketChannel.ts the VS Code channel has no CONNECTING window (§3.1)
apps/kira-studio-vscode/**            no extension change of any kind
```

---

## 8. Documentation

- **`docs/ARCHITECTURE.md:2625-2635`** — the "read-only frontend" paragraph is rewritten. The native
  mount is no longer read-only; state what it now is (a writing git client over the same backend),
  what it still cannot do (resolve conflicts, run a worktree prepare script, open a worktree window,
  set the global git path) and why each.
- **`docs/ARCHITECTURE.md:2984-3000`** — the three-layer section is rewritten around the new
  invariant (§5.3): a default-deny allowlist, four refusals, and capability flags that match the
  allowlist in both directions. Do not leave "provably read-only" standing anywhere.
- **`docs/ARCHITECTURE.md`'s "Native code workspace (C5)" section (`:1030`, `:1095`, `:1186`)** —
  the "still entirely read-only" clauses refer to the *Monaco file viewer and diff tabs*, which this
  phase does not change. Verify each before editing; only correct one that actually claims the git
  surface is read-only.
- **`docs/ARCHITECTURE.md`'s nav description** — Studio / Api / Git as three peer modules, the repo
  switcher inside Git, `windows.mode`'s third value and why it needed no migration.
- **`docs/ARCHITECTURE.md` "Known open items"** — add: no standalone merge or rebase operation
  exists in this stack (§1.5); merge and rebase are reachable only as pull strategies and inside
  `stack.restack`. Real, currently true, and not a TODO.
- **`docs/v1.6/mcp-repo-map-issues.md`** — this planning pass used the server for
  `find_references {"symbol":"gitTransportFor"}` and `{"symbol":"setiIconFor"}`; both answers were
  correct and matched an independent `grep` exactly. **No entry added** — `CLAUDE.md`'s rule is to
  say plainly when a pass finds nothing real rather than manufacture a finding.
- **No `SPEC.md` edit.** §0's correction lives here, per the never-retro-edit convention.

---

## 9. Testing

`CLAUDE.md`'s bar: a dedicated unit test only for genuinely hard logic.

**Earns one — `packages/git-ipc/src/streamChannel.test.ts` (§3.2).** An ordering race with a silent
symptom, on the explicit "concurrency (ordering, backpressure, cancellation, races)" list.

**Does not — everything else.**

- The lease (§2.1) is a `Set` of unsubscribers plus an idempotent flag. It is guarded far better by
  the UI case below, which exercises the actual symptom rather than the mechanism.
- The nav reorg is registry wiring and component moves.
- `moduleOfWorkspace` is one `if`.
- The icon change is a call into an already-tested function (`setiFileIcon.test.ts`).
- The credential dialog is a queue and a modal.

**Go** — `internal/bridge/gitstream_test.go` (§5.2) is not a new test file; it is the existing
allowlist pinning, moved to the new boundary. `TestGitrpcDispatch_EveryMethodIsClassified` keeps
every method classified.

**UI** — `apps/kira-studio/tests/ui/`:

`mode-switch.spec.ts`
- `:84`'s `toHaveCount(2)` → `3`; a `data-mode="git"` tab exists and activates.
- The ink-measurement case (`:216-224`) gains the third tab or states why it does not.

`repo-workspace.spec.ts`
- The repo list is **not** in the Studio panel: switch to Studio, assert `repo-row` count 0; switch
  to Git, assert it is there.
- `:94`'s `workspace-repo-tab` assertion retargets to the Git panel's `repo-row`.
- Opening a repo activates the Git module tab (`data-mode="git"` is `is-active`) and adds no
  top-level tab (`mode-tab` count stays 3) — the assertion that pins §0's correction.
- Activating a repo **file tab** from Quick Open while in Studio brings the Git module forward
  (§4.2's real behaviour change).
- Leaving Git for Api and returning lands back on the same repository (`lastRepoKey`, §4.2).
- Closing the active repo workspace from the panel's × falls back to the Git module's empty state,
  not to Studio.

New `repo-graph-lifecycle.spec.ts` — the two reported bugs, as regressions:
- **Bug 1.** Open a repo, open a file from the tree, return to the pinned graph tab: the graph host
  is present and `boot-error` has count 0. Then open the Review segment: its host renders too.
- **Bug 2.** A cold mount reaches the graph with **no** `boot-retry` click — assert `boot-error` has
  count 0 on the first-ever open of a repo workspace in a fresh page.

Both depend on the mock runtime's `git` stream behaving like the real one. `tests/ui/support/
mockRuntime.ts:329` already stubs the workspace calls; the implementing pass must confirm its
`Stream('git')` double opens **asynchronously** (or add that), or bug 2's case passes vacuously.

`repo-file-tree.spec.ts` (or the existing tree spec) — a `.ts` row and a `.go` row carry **different**
icon styles; a directory row still carries a codicon.

---

## 10. Sequencing, and the split this phase should probably take

The four parts are not equally coupled:

- **§2 + §3 (the two bug fixes)** are small, independent of everything else, and the highest-value
  thing in the row. They touch `transport.ts` and `streamChannel.ts` and nothing else.
- **§4 + §6 (nav reorg + icons)** are coupled: §6's bundle answer *is* §4.6's lazy boundary, and both
  move the same components.
- **§5 (read-only relaxation)** shares exactly one file with the rest — `hostHandlers.ts`, and only
  its `capabilities` literal. Everything else it touches is Go, `gitstream_test.go`, `ConflictBanner.vue`
  and two new frontend files.

**Recommendation: split §5 into its own SPEC row.** Reasons, stated plainly rather than as a
scheduling preference:

1. It is the only part that changes a **security posture** the architecture doc currently asserts as
   proven, and the only part with a Go change beyond a one-line map literal.
2. `CLAUDE.md`'s "best practices, no shortcuts" makes the credential prompt (§5.5) mandatory, not
   optional — that is a real sub-feature (a modal, a queue, a masked field, a dismissal path, a
   never-log rule) with no existing native precedent to copy.
3. One implementation pass covering a Vue nav reorg, a transport-lifecycle fix, a send-ordering race,
   a bundle-splitting boundary **and** a write-boundary widening has five unrelated failure modes and
   one "test once at the end" gate. That is the shape P64 split into P64b/P64c for.
4. Nothing in §4/§6 depends on §5, and §5 depends on §2's lease fix only in the weak sense that a
   long remote op is more pleasant on a transport that survives a tab switch.

If the split is taken: **P67b** = §2, §3, §4, §6 (this document, minus §5); a new row = §5 verbatim,
with §1.4/§1.5/§5.1-§5.6 above as its research base so its own planning pass does not start cold.
If it is not taken, implement in the order §2 → §3 → §4 → §6 → §5, committing each part separately;
the expensive suite runs once after §6 and again after §5.

---

## 11. Explicitly out of scope

- **A standalone merge or rebase operation.** §1.5: none exists anywhere in this stack — not in
  `opTable`, not in `OpRequest`, not in `git-ui`, not in the VS Code extension. Building one means a
  new op kind, a new `opSpec` with an undo policy, a new preflight, a new dialog and a
  `ContractVersion` bump. Merge and rebase are reachable in this phase **as pull strategies**
  (`ff-only` / `merge` / `rebase`, `contract.ts:782`) and inside `stack.restack`, which is what the
  tree actually offers. Named in "Known open items" (§8) rather than silently half-built.
- **Conflict resolution of any kind.** The user's own carve-out. `editor.resolveConflict` stays
  refused at both layers and `capabilities.resolveConflict` stays `false`.
- **Worktree create/remove and the prepare script.** §5.1 — the script is arbitrary shell execution
  with no approval gate in this codebase; admitting the pair while refusing the script would offer a
  worktree the app cannot prepare.
- **Background auto-fetch.** `gconn.DisableAutoFetch()` stays (§5.2, OQ-5).
- **A finer `Capabilities` vocabulary.** §5.1's rejected alternative — a contract bump and ~10
  git-ui components for a distinction the row does not ask for (OQ-4).
- **Per-connection workspace isolation in Studio.** `state/mode.ts:64-65` records `workspaceId` as
  `null` "today and forever unless a later phase adds per-connection isolation". This phase adds a
  third *module*, not a fourth kind of workspace.
- **Persisting `openRepos` or `lastRepoKey`.** `openRepos` is still derived from restored tabs
  (`state/tabs.ts:250-257`); `lastRepoKey` is session-only. Nothing new is written to the database
  beyond `windows.mode`'s third legal value.
- **A folder-icon rule for the file tree.** §6.2/OQ-3 — the diff tree has none to port.
- **The tree's status glyph, the diff tree's status letter, or any other tree styling.** Icons only.
- **`packages/git-ui`'s graph, review and dialog surfaces.** One additive line in
  `ConflictBanner.vue` (§5.4) is the only edit to that package.
- **The VS Code extension.** Unchanged in every respect.

---

## 12. Verification

### 12.1 Mechanical

```
bun run typecheck
bun run lint
bun run build            # and compare the launch chunk against HEAD~ (§6.3)
bun test packages/git-ipc/src/streamChannel.test.ts
go build ./...
go test ./apps/kira-studio/internal/bridge/...
bun run test:ui
bun run test:visual      # expect diffs: the title bar loses its repo tabs, the panels swap content
```

`test:visual` **will** produce real diffs this time — the title bar and both panels change
deliberately. Review and re-baseline; do not assume a zero-pixel result.

### 12.2 Manual recipe

Against a real local repository imported through the Git panel:

1. Title bar reads exactly `Studio | Api | Git`. Three tabs, no fourth.
2. Studio's panel is titled "Connections" and shows **no** repository section and no import button.
3. Git's panel lists every imported repository. Click one: it opens, the pinned graph tab appears and
   **the graph renders on the first try, with no Retry**. (Bug 2.)
4. Open a file from the tree, then click the graph tab. The graph is there, not a boot error.
   (Bug 1.) Switch the panel to Review: it renders too.
5. File-tree rows show per-language icons — a `.ts` and a `.go` row differ; directories keep their
   folder chevron and glyph.
6. Switch to Api, then back to Git: the same repository is still active.
7. Open a second repository. Both appear in the Git panel; switching between them switches tab
   strips. The title bar still shows three tabs.
8. Close the active repository with the panel's ×: its tabs go, and the Git module shows its empty
   state — not Studio.
9. Quit and relaunch while in Git: the window reopens in the Git module.
10. (§5) Fetch, then Pull with strategy `ff-only`, `merge` and `rebase` in turn. Each completes and
    the graph updates.
11. (§5) Pull into a deliberate conflict. The conflict banner appears, **Resolve is absent**, the
    explanatory line is present, Abort works, and Continue works after resolving and staging the
    files in an external editor.
12. (§5) Pull from an HTTPS remote with no credential helper configured. The credential dialog
    appears, the password field is masked, the "Username for …" prompt is not, Cancel ends the op
    promptly instead of hanging, and a correct answer completes it.
13. (§5) Confirm the worktree create/remove affordances either do not appear or are refused with a
    stated reason — never a confirm button that fails.

### 12.3 Checklist

- [ ] `REPO_WORKSPACE` no longer exists anywhere (`grep` returns nothing).
- [ ] `WorkbenchShell.vue` and `MainView.vue` each dispatch on one expression, with no
      `isRepoWorkspace` branch.
- [ ] `TitleBar.vue` renders exactly `MODE_ORDER.length` tabs and imports nothing from
      `state/coderepos` or `state/workspace`.
- [ ] `ProjectPanel.vue` contains no reference to `codeRepos`, `repo-row` or `importRepoViaDialog`.
- [ ] No new migration file; `windows.mode` is unchanged on disk.
- [ ] `gitTransportFor` never returns the same object twice; `disposeGitTransport` is the only path
      that reaches `channel.close()` (`grep` for `.dispose()` in `transport.ts`).
- [ ] `packages/git-ui/src/bridge/client.ts` is unchanged.
- [ ] `streamChannel.ts` assigns `socket.onopen`; `socketChannel.ts` is unchanged.
- [ ] The launch chunk did not grow (§6.3, measured against HEAD~ with `bun run build`).
- [ ] `gitstream.go`'s allowlist is still an allowlist (default-deny), and
      `TestGitrpcDispatch_EveryMethodIsClassified` passes with every method in exactly one table.
- [ ] Every `capabilities.*` flag that is `false` corresponds to something layer 1 refuses, and
      every method layer 1 admits has a reachable affordance (§5.3's two-way property).
- [ ] No credential value reaches `console`, the op log, or any persistence path (`grep` the two new
      files for `log`, `save`, `localStorage`).
- [ ] `docs/ARCHITECTURE.md` contains no surviving claim that the native git mount is read-only.
- [ ] A repo-map MCP `tools/call` answered correctly during the phase; logged only if it did not.

---

## 13. Open questions for a human

**OQ-1 — split §5 out into its own row.** §10 recommends it, with four reasons. *Recommendation:
split. §5 is the only part that changes a security posture, the only one needing a genuinely new
sub-feature (the credential prompt), and the only one with no file overlap with the rest. Keeping it
here produces one implementation pass with five unrelated failure modes and a single end-of-phase
test gate — the shape P64 already split away from. If it stays, §10's ordering keeps it last and
separately committed, which recovers most of the benefit.*

**OQ-2 — a single click in the repo list opens the repository.** §4.4 replaces `ProjectPanel`'s
select-then-double-click with click-to-open/activate. *Recommendation: make the change. That panel's
entire subject is repositories, so a click that only paints a highlight is a dead control, and the
list is replacing a title-bar switcher where one click always switched. Double-click still works
(it is a click first), and the context menu's `Open` is unchanged, so nothing is unreachable.*

**OQ-3 — directories keep their folder icon.** §6.2 ports the diff tree's **file** rule verbatim and
declines to port a directory rule, because the diff tree has none — its directory rows carry a
chevron and a change-count strip, a different row for a different job. *Recommendation: keep the
folder glyph. A file explorer without folder icons is a rule invented in this phase, not the one the
report asked to copy. If the intent really was "no folder glyph either", it is a two-line follow-up.*

**OQ-4 — `capabilities.write` stays one boolean.** §5.1 rejects a finer capability vocabulary.
*Recommendation: accept the boolean. Narrowing it means a `ContractVersion` bump, a second flag
through ~10 git-ui components and the VS Code extension, to express a distinction ("pull yes,
cherry-pick no") the user never drew — their own premise is that read-only was about editing files,
and none of the remaining operations edit files in-app. The four things that genuinely need
something this app lacks already have their own flags.*

**OQ-5 — background auto-fetch stays disabled.** §5.2 keeps `gconn.DisableAutoFetch()`.
*Recommendation: keep it. Auto-fetch is a periodic network write the user did not ask for and did
not name; every fetch in this phase is one they pressed a button for. Lifting it is one deleted line
whenever someone wants it, and it is much easier to explain adding automatic background fetching
later than to explain why the app started talking to remotes on its own.*

**OQ-6 — push and force-push are admitted, though the report named only pull/merge/rebase.** §5.1
admits the whole `remote.run` family. *Recommendation: admit them. A pull-merge-rebase workflow that
cannot push is a workflow with no ending, force-push is already behind its own typed-confirmation
dialog (`ForcePushDialog.vue`), and §5.1's all-but-four rule is simpler to reason about — and to
keep honest — than a hand-drawn line through one method's five kinds.*
