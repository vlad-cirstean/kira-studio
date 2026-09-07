# Kira Studio — v1.3 (Git, headless)

v1.2 built the **Api** module — an HTTP/gRPC request client living beside the database client
behind a shared, modularized app shell (`docs/v1.2/SPEC.md`). This chapter's headline is a third
top-level subsystem, **git**, sitting beside **studio** and **api** inside the same Go binary — but
unlike Api, and unlike an earlier, now-superseded attempt at this same chapter, git ships **headless
in v1.3**: Kira Studio runs the git backend, and the frontend is one or more separately-installed VS
Code extensions connecting to it as external clients. There is no embedded Wails/Vue UI for git in
this chapter.

## Relationship to prior art

**`origin/claude/feature-v1-3` is a superseded attempt at this chapter and is not built on.** It
ported only the driver/discovery/spawn foundation (its own P1) and wired it to an *embedded* Wails
frontend — `packages/git-core`/`git-ipc`/`git-ui`, a Vue commit-graph mounted as a third app mode
over an in-process Wails stream. That transport is structurally unreachable from an external VS Code
extension process, so this chapter does not extend it. Two pieces of its Go code are transport-
agnostic and are reused (§2): `internal/gitclient`'s discovery/error-classification/repo-gate code,
and `internal/bridge/rpcstream`'s generic correlated-RPC-with-credits protocol.

**The actual source material — `kira-version-vscode`, branch `claude/start-p2-gwlgly` — is far
further along than `feature-v1-3`'s own docs assumed.** Its `docs/SPEC.md` §10 phase table shows:

| Phase | Status upstream | Lands in this chapter as |
|---|---|---|
| P0 Foundation | Done | n/a — tooling only |
| P1 Git driver | Done | G2 |
| P2 History pipeline | Done | G3 |
| P3 Host bridge | Done | superseded by §3–§5 below |
| P4 Graph UI | Done | not ported — the VS Code extension's existing UI is kept as-is (§5) |
| P5 Commit detail | Done | G4 |
| P6 Refs & checkout | Done | G5 |
| P7 Branch review | Done | G6 |
| P8 Remote ops | Done | G7 |
| P9 Stash | Done | G8 |
| P10 Reset | Done | G9 |
| P11 Search | Done | G10 |
| P15 IPC wire-format fix | Done | informs §4.2, not ported literally |
| P16 FlatBuffers for `graph.stream` | Done | informs §4.2 — this app already has its own FlatBuffers data plane (§4.2) |
| P12 GitHub PR links | Not done upstream | G12 — upstream's own REST-lookup/cache/badge design (`docs/SPEC.md` §6.7/D31/D32 there) ported, auth mechanism redesigned around `gh` CLI (§3.5) since VS Code's built-in provider isn't available to this chapter |
| P13 Ship (`.vsix`, marketplace) | Not done upstream | G16 — DMG bundling replaces marketplace/OpenVSX publishing for v1.3 |
| P14 Worktree support | Not designed upstream | G13 — not designed upstream either; designed at G13's own planning pass, same as upstream deferred it |

So this chapter is a full port of everything upstream has actually built (P1–P11, P15/P16's lessons),
not a continuation of `feature-v1-3`'s narrower P1-only scope.

## What headless means here

- **Backend**: git logic (spawn discipline, porcelain parsing, paged log walk, refs/checkout,
  remote ops, stash, reset, search, pre-flight hazard analysis) runs in Go, inside
  `apps/kira-studio`, as a peer subsystem to `studio` and `api`.
- **No embedded frontend.** Kira Studio's own Wails UI gets no git mode, no panel, no tab kind.
  Its only git-facing surface in v1.3 is a *Connected editors* pane for pairing/revocation (§3.3).
- **Frontend is the existing VS Code extension, migrated into this repo (§5) and repointed at a
  new transport.** Its UI (webview, in-app diff view, branch review sidebar, dialogs — all of
  upstream's `packages/ui`) is kept exactly as it is. Only the wiring from that UI down to git
  changes: today it drives an in-process `RepoService`; from this chapter on it dials a socket.
- **Deliberately a stepping stone.** The session/registry/transport layer (§6) is designed so that
  a future embedded Kira Studio UI is a second `Conn` implementation over the same `Handlers` —
  exactly the shape `rpcstream` already gives the `api`/`studio` streams — not a rework. That UI is
  explicitly out of scope for v1.3.

## Go package layout (`apps/kira-studio/internal/`)

| Package | Owns | Provenance |
|---|---|---|
| `gitclient` | Spawn discipline (env hygiene, `-c core.quotepath=false`, `--no-optional-locks`, graceful `WaitDelay` kill), streaming reads, discovery (macOS-only, CLT-shim gate, 2.38 floor, 30s cache), capability probe, typed error classification, per-repo reader/writer gate | `feature-v1-3` reused near-verbatim for `discovery.go`/`errors.go`/`capabilities.go`/`clock.go`/`settings.go`/the gate in `repo.go`. **`runner.go` is rewritten, not reused** — it buffers to `[]byte`; the paged `git log` design (upstream §5.1.1) needs a `Start()` returning a live pipe, not a `Wait()`-then-drain call |
| `gitclient/porcelain` | `log`/`for-each-ref`/`status --porcelain=v2`/`diff-tree`/`diff`/`stash list`/`merge-tree`/`cat-file --batch` framing, NUL/`%x1f` record splitting | New. Port of `packages/git/src/parse/*`; upstream's ~43 recorded-byte fixture files become a Go golden corpus, same pattern as `internal/postman`'s round-trip tests |
| `gitclient/catfile`, `gitclient/logsession` | The two persistent processes: `cat-file --batch` per repo, and the pausable/resumable paged walk | New. Port of `catFile.ts`/`logSession.ts` |
| `ghclient` | (G12) `gh` CLI discovery/spawn discipline mirroring `gitclient/discovery.go`'s `Locator`/probe/TTL-cache shape, `GhStatus` classification, `gh api` calls for PR lookup | New — no upstream provenance; upstream used VS Code's built-in GitHub auth provider (§3.5) |
| `gitstore` | Column-wise commit store, sha table, string interner, `PackedCommitChunk` builder | New. Server half of `packages/core/src/store/*` |
| `gitpreflight` | `classifyCheckout`/`StashPop`/`Reset`/`Revert`/`CherryPick`/`Push`/`Pull`/`StashBranch`/`InProgress`, protected-branch glob matcher, undo slot | New. Port of `packages/core/src/preflight/*` + `model/operation.ts` + `model/protectedBranch.ts` + `undo/slot.ts`. Computed server-side, crossed as data — not duplicated client-side |
| `gitops` | `branch`/`checkout`/`tag`/`revert`/`reset`/`cherryPick`/`stash`/`fetch`/`push`/`pull`/conflict handling + stderr progress parsing | New. Port of `packages/git/src/ops/*` + `progress.ts` |
| `gitaskpass` | Credential broker + `GIT_ASKPASS` shim over its own private socket, the four no-hang guarantees | New. Port of `askpass.ts` |
| `gitsearch` | Cancellable tail scan (`logScanArgs` + `%b`) + Go matcher | New — see §8 risk on RE2 vs. JS `RegExp` |
| `gitsession` | `Registry` (refcounted per `RepoID`), `RepoEntry` (shared repo state), `Conn`/`Walk` (per-connection state) | New. Replaces upstream's single `RepoSession`, re-cut along the shared/private line (§6) |
| `gitrpc` | Method table, contract version constant, wire types | Port of `rpcHandlers.ts`, minus the seven host-capability methods the extension now answers locally (§5) |
| `gitsock` | Unix listener, framing, handshake, pairing broker, stale-socket recovery | New (§3) |
| `gitwire` | Generated FlatBuffers code for the git data plane | New, generated — see §4.2 |
| `gitreview` | (G14/G15) `review.db` (own SQLite file), compressed blob storage, fast/slow-path diff selection, partial-review range state, TTL/PR-close reaper, the flat AI-comment list | New — no upstream provenance, "Review state" below |
| `bridge/rpcstream` | Correlated-RPC-with-credits state machine (`Conn`, `Handlers`, `Serve`) | `feature-v1-3` reused **verbatim** — its `Conn{Send([]byte) error; Receive() ([]byte, error)}` interface already abstracts the channel; a `net.Conn` adapter is the only new code |
| `bridge/gitclients.go` | Bound Wails service for Kira Studio's own *Connected editors* pane | New, small |

Lane layout, the SVG graph column, and the client-side half of search stay in TypeScript — renderer
concerns, unaffected by this port.

## Transport

### 3.1 Socket

Fixed path, `${KIRA_HOME}/git.sock` (default `~/.kira-studio/git.sock`), inside the 0700 directory
`config.EnsureLayout` already owns; socket file 0600. **No discovery/announce mechanism** — the
extension dials the fixed path directly; connection failure means Kira Studio isn't running, and
that's the whole signal, nothing further to distinguish.

This app is confirmed macOS-only (`docs/ARCHITECTURE.md`'s Stack table), so a Unix domain socket is
unconditionally viable and needs no cross-platform fallback.

### 3.2 Stale-socket recovery

At startup, Kira Studio takes an `flock` on `${KIRA_HOME}/git.sock.lock`. Lock acquired: any
existing `git.sock` is a crash leftover — unlink it and listen. Lock already held: another instance
is serving; this instance does not listen.

### 3.3 Pairing and auth

No pre-shared token file. A connecting client is either recognized or it isn't:

```
C→S  {kind:"hello", protocol:1, contractVersion:N,
      client:{id, label, pid, appVersion}, token:<opaque>|null}

S→C  {kind:"ready", contractVersion:N, serverVersion, sessionId}
  |  {kind:"versionMismatch", expected, received, serverVersion}          → close
  |  {kind:"tokenRejected"}                                                → close
  |  {kind:"pairingRequired", requestId, expiresInMs:120000}
        then {kind:"paired", token} → ready
        or   {kind:"pairingDenied", reason:"denied"|"timeout"} → close
```

An unrecognized or invalid token triggers an approval prompt **in Kira Studio's own window**
(confirmed — not the requesting VS Code window, since Kira Studio is the trust authority here). One
prompt on screen at a time; concurrent requests queue with a visible count. A request arriving with
no Kira Studio window open yet is held, not auto-denied, under the same 120s timeout. A denial puts
that client id in a 60s cooldown so a reconnecting extension cannot re-prompt in a loop.

**Trust storage**: new table in the existing `kira.db` —
`git_clients(id TEXT PK, label TEXT, token_hash BLOB, token_salt BLOB, created_at, last_seen_at, revoked_at)`.
The token is 32 random bytes (`crypto/rand`); **only its salted hash is stored**
(`sha256(salt‖token)`, compared with `subtle.ConstantTimeCompare`) — never the plaintext, never a
reversible encryption of it, since Kira Studio only ever needs to verify a presented token, not
recover one. The extension stores its token in VS Code's `context.secrets` and reuses it silently.

**Revocation**: the *Connected editors* pane lists paired clients; revoking sets `revoked_at` and
closes every live connection holding that id. A revoked extension gets `tokenRejected`, clears its
stored token, and re-dials with none — producing a fresh pairing prompt.

### 3.4 Version handshake — hard lockstep

Negotiated in the `hello`/`ready` exchange above, not a side file. This app has no auto-update and
the extension installs separately, so **a mismatch is a hard stop, not a degraded mode**: the
extension shows a blocking panel naming both versions and that both need to be on the same release
(reusing the shape of the existing 2.38-git-floor blocked-state panel). `CONTRACT_VERSION` is the
sole compatibility authority, exactly as upstream's own D46 established for its FlatBuffers work.

### 3.5 GitHub auth (G12) — the local `gh` CLI, not a built-in provider

Upstream's own G12/P12 design used VS Code's built-in GitHub authentication provider
(`vscode.authentication.getSession('github', …)`) — unavailable to this chapter, decided
2026-09-07. Replaced with the same pattern [Orca](https://www.onorca.dev) (an AI development
environment with its own GitHub review integration) uses: **delegate entirely to the `gh` CLI
already on the user's machine, own no credentials of any kind.**

- **No OAuth flow inside Kira Studio.** Nothing here ever holds a GitHub token, prompts for one,
  or talks to GitHub's OAuth endpoints directly — `gh` already solved that, and re-solving it here
  would be a second, worse implementation of the same problem, storing a second copy of the same
  secret this app has no business holding.
- **Runs on the Kira Studio backend, not the extension** — a new `internal/ghclient` package,
  sibling to `gitclient` and following its exact discovery/spawn shape (§ `gitclient/discovery.go`):
  a `Locator` finds `gh` on `PATH` (no macOS Command-Line-Tools-shim trap here — `gh` has no
  built-in-shim equivalent to route around), a probe runs `gh auth status` under the same kind of
  bounded timeout `gitclient.Discovery` already uses for `git --version`, cached with the same kind
  of short TTL. GitHub-facing calls (PR lookup) shell through `gh api …`, never a hand-rolled HTTP
  client with a bearer token lifted out of `gh`'s own keychain entry — matching Orca's own choice to
  run real requests through `gh api` rather than read `gh`'s stored credential out from under it.
  Same os/exec discipline as every other spawn in this chapter: argv-only, no shell, `Setpgid` +
  group-kill on cancellation, hygiene env, one classified-error vocabulary.
- **A `GhStatus` union, the same discriminated shape `GitStatus` (§ `gitclient/discovery.go`)
  already established**: `"ok"` (`gh` found, `gh auth status` succeeds), `"notFound"` (`gh` isn't on
  `PATH` — "GitHub CLI is unavailable", install `gh` and reconnect), `"unauthenticated"` (`gh` found
  but not logged in, or its token has expired/lost scope — "GitHub authentication is unavailable",
  run `gh auth login`), `"forbidden"` (a `gh api` call comes back 403 — insufficient scope or org SSO
  not authorized, name the fix rather than the raw HTTP status). None of these block git itself —
  they only blank the PR badge and disable `branch.resolvePr`, per `kiraVersion.github.enabled`'s
  existing fail-open design.
- **What this changes vs. what it doesn't**: only the auth/transport-to-GitHub mechanism. The REST
  lookup shape, the per-branch cache invalidated by the watcher, `branch.resolvePr`'s wire contract,
  and the badge UI (`packages/git-ui`, untouched per this chapter's own rule) are still ported from
  upstream's D31/D32 as designed — `gh api` is a drop-in replacement for the HTTP client's request
  shape, not a redesign of what gets requested or how the result is cached and rendered.
- G12's own Opus planning pass owns the concrete `ghclient` API and the exact `gh api` calls/fields
  used; this section fixes the mechanism and its failure states, not the full implementation.

### 4.2 Wire format — reusing this app's existing FlatBuffers data plane

**Not a new design.** `docs/v1.1/plans/P11-flatbuffers-data-plane.md` already built and measured
this exact split for the `studio` module's `engine` stream, and it is reused here rather than
re-derived:

- **Request/control frames stay JSON text** — `rpcstream`'s existing envelope, small and legible,
  unchanged.
- **Bulk response/stream payloads are FlatBuffers** — commit chunks (`PackedCommitChunk`), diff
  hunks, blob bytes — one `Frame` table per response, generated from a **new**,
  git-specific schema (`packages/git-ipc/schema/gitWire.fbs`) with its own file identifier
  (`"KIG1"`, distinct from the `studio` data plane's `"KIF1"` so the two can never be
  cross-decoded), through the same pinned, digest-verified `flatc` toolchain P11 already set up,
  reusing the same Go (`github.com/google/flatbuffers/go`) and npm (`flatbuffers`) runtimes already
  in the dependency graph.
- This also matches what `feature-v1-3`'s own git chapter had already pointed at
  (`PackedCommitChunk... crosses as FlatBuffers... standardizing with this app's existing
  FlatBuffers data plane`) before that branch was superseded — the direction was right, it just
  wasn't built yet.
- **No dual-format decoder, no compatibility shim** — same house rule P11 stated: a frame that
  doesn't carry `"KIG1"` is a hard error.

## Concurrency and session model

**A real, load-bearing requirement**: multiple simultaneous VS Code windows/extensions connect to
one backend at once, whether pointed at the same repo or different repos.

```
GitServer
├─ listener (accept loop over the Unix socket)
├─ Registry: map[RepoID]*RepoEntry      — mutex + refcount
│    RepoEntry (SHARED across every connection open on that repo)
│      reader/writer gate   driver   cat-file batch session
│      fsnotify watcher (one per repo, debounced, fanned out)
│      detail/diff/refs caches   head   stash shapes
│      undo slot (one per repo — see below)   active remote op (≤1)
│      subscribers: map[ConnID]chan Event
└─ Conns: map[ConnID]*Conn               — one per accepted socket
     client identity, its own ctx, rpcstream session
     walks: map[RepoID]*Walk             — PRIVATE per (connection, repo)
       log session, commit store, dictionary marks, scroll/paging state,
       the active review-range walk if any
```

**The split rule**: a fact about *the repository* is shared (`RepoEntry`); a fact about *one
viewer's session* is private (`Walk`). This is the one real structural departure from upstream's
`RepoSession`, which conflates the two into a single per-session object.

- `Repo`'s reader/writer gate (ported from `feature-v1-3`) needs no change — it already serializes
  correctly; it now does so across connections instead of within one, which is the point.
- `watcher.go`'s `os.Stat` polling is replaced with `fsnotify`, one watch per `RepoEntry`
  covering `HEAD`/`refs/**`/`packed-refs`/`index`/`FETCH_HEAD`/`MERGE_HEAD`/`rebase-*`/
  `CHERRY_PICK_HEAD`/`REVERT_HEAD`/`sequencer` plus the worktree, 200ms debounce, fanned out to
  every subscriber over its own coalescing buffered channel so one slow client can't stall the
  watcher for others.
- `Registry.Acquire(ctx, path) (*RepoEntry, release func())` replaces the old unconditional
  open/close: refcount++/-- , real teardown (kill cat-file, stop the watcher, drop caches) only at
  zero, after the existing hidden-eviction grace period.
- **Disconnect semantics**: `rpcstream.Serve` returning on peer close already cancels every
  in-flight request/stream for that connection for free. Additionally: kill that connection's own
  log-session processes, release its `RepoEntry` refcounts. **A write already in flight is never
  killed by a client disconnect** — it is detached from the connection and finishes on its own; the
  result is simply not delivered anywhere.
- **Undo slot: one per repo**, not per connection, with the *originating client* attributed in its
  label (so a second window sees "Undo reset of `main` (window: repo-review)" rather than an
  anonymous or misattributed action).
- **Credential prompts**: shown in Kira Studio's own window, never the VS Code window that started
  the remote operation — consistent with Kira Studio being the one trust/approval authority for
  everything credential- and pairing-related in this design.

## Settings ownership

Server-owned (Kira Studio), not per-window, because two windows disagreeing about them is a
correctness/safety issue, not a preference: `protectedBranches`, `fetch.autoInterval`, `git.path`.
Everything else (`graph.pageSize`, `graph.scope`, `stash.showInGraph`, and similar per-viewer
display settings) can travel with the request and differ per window harmlessly.

## The migrated extension

**Moves into this repo.** New layout, following this repo's existing `apps/`/`packages/` split
(today `apps/` holds only `apps/kira-studio`; root `packages/` holds source-only directories plus
the two real Bun workspace packages v1.2 P12 is introducing):

| Path | From | Fate |
|---|---|---|
| `apps/kira-studio-vscode/` | upstream `packages/host-vscode` | Becomes the whole extension: manifest, esbuild target, `extension.ts` rewritten to dial the socket instead of constructing an in-process `RepoService` |
| `packages/git-ipc/` | upstream `packages/ipc` | Kept **whole** — `contract.ts` (shared vocabulary), `rpc.ts`, `transport.ts`, `codec.ts`, `validate.ts`. A new `socketChannel.ts` (`net.connect` + length-prefixed framing) is the only new file — a ~40-line `MessageChannelLike` implementation, replacing `webview.postMessage` as the channel underneath the same seam |
| `packages/git-core/` | upstream `packages/core`, trimmed | Keeps `store/*`, `graph/*` (lane layout worker), the client-side half of `search/*`, `model/*` (wire types), `settings/schema.ts`, `util/*`, and the ports the extension still owns client-side (`Dialogs`, `Clipboard`, `ExternalOpener`, `EditorIntegration`, `WorkspaceRoots`, `Logger`, `Storage`, `CredentialPrompt`). **Drops** `preflight/*` and `undo/*` — now server-side (§2) |
| `packages/git-ui/` | upstream `packages/ui` | **Unchanged.** No redesign, no native VS Code tree/quickpick replacement — the existing webview UI is the frontend, as-is |

Root `package.json`'s `workspaces` gains `packages/git-*` and `apps/kira-studio-vscode`.

**What changes in `extension.ts`, precisely** (the only real wiring change — everything else is
untouched):
1. Dial the socket, run the handshake (§3.3/§3.4), read/write the token via `context.secrets`,
   reconnect with backoff on drop.
2. Seven previously-server-answered methods (folder pickers, diff-open, clipboard, "open
   externally", and similar host-capability calls) are now answered **locally** by the extension's
   own ports instead of round-tripping to Go — mechanical, but load-bearing: get one wrong and the
   graph still works while, say, every "pick a repo folder" silently fails.
3. `app.init` becomes a composition: `host`/`capabilities` from the extension, `settings` from VS
   Code configuration, `git`/`contractVersion` from the server.
4. Askpass becomes a relay: the server emits `credential.request` to the connection that owns the
   in-flight remote op; the extension answers with `credential.provide`. If that connection dies
   mid-prompt, the broker fails the credential request non-zero — never hangs.

**Bundled in the DMG.** The `.vsix` ships alongside the app rather than through the VS Code
Marketplace for v1.3 (G16).

## Module boundary

The same rule v1.2 established for Studio/Api, extended to a third module: git-specific frontend
code lives under its own directories (now split across `apps/kira-studio-vscode/` and
`packages/git-*`, a genuine workspace-package boundary from day one, matching what v1.2's own P12 is
retrofitting onto Api), git-specific Go code stays in its own packages (`internal/git*`, listed
above), and no phase merges git and studio/api code into a shared file where a per-module one would
do. `internal/bridge/rpcstream` is the one deliberate exception, by design — it is module-agnostic
infrastructure two modules already share (git and, per `feature-v1-3`'s own note, a shape `api`'s
P12 package split may also want), not a boundary violation.

## Phasing

| # | Deliverable | Depends on | Covers upstream |
|---|---|---|---|
| **G1** | Socket listener, framing, handshake, pairing broker + trust store + *Connected editors* pane; extension migrated into this repo and dialing the socket; proven end-to-end on `app.init`/`repo.open` alone | — | new |
| **G2** | Driver foundation: streaming runner (rewritten for paging), env/argv hygiene, discovery + 2.38 block state, capabilities, typed errors, repo gate, fsnotify watcher → `repo.changed`, `Registry` with refcount | G1 | P1 |
| **G3** | Porcelain parsers + golden corpus, `cat-file --batch`, paged log session, commit store/interner/packing, `graph.stream` over FlatBuffers, the graph renders end to end | G2 | P2, P15/P16 wire choice |
| **G4** | Commit detail, file tree, diff, blob reads, line-mapped "Go to file"; the seven host-capability methods wired client-side | G3 | P5 |
| **G5** | Refs/tags/branches, checkout + the Go pre-flight engine, revert, linked-worktree detection, in-progress banner, undo slot | G4 | P6 |
| **G6** | Branch review: base resolver, ranged walk as a per-connection `Walk` | G4, G5 | P7 |
| **G7** | Remote ops: fetch/push/decomposed pull/force-with-lease/protected branches/askpass broker + credential relay/auto-fetch | G5 | P8 |
| **G8** | Stash + `merge-tree` pop prediction, wired into G5's blocked-checkout resolution | G5 | P9 |
| **G9** | Reset (3 modes) + cherry-pick, undo slot completed | G8 | P10 |
| **G10** | Search: Go tail scan + client matcher, regex-dialect reconciliation (§8) | G3, G5 | P11 |
| **G11** | Multi-client hardening: two-windows/two-repos matrix, disconnect teardown, revoke-while-connected, stale-socket recovery, perf re-baseline against the new transport | all | new |
| **G12** | GitHub PR links: GitHub-remote detection from `origin`, auth via the local `gh` CLI on the Kira Studio backend (§3.5 — replaces upstream's VS Code-built-in-provider design, which this chapter can no longer use), REST PR lookup through `gh api`, a per-branch cache invalidated by the watcher, `branch.resolvePr`, the `#123` badge on branch-picker rows and message-column ref badges (opened via the extension's own `ExternalOpener`), `kiraVersion.github.enabled`, and PR number/title matching added to search's ref scope. Auth mechanism redesigned around this chapter's own headless/backend shape (D31/D32's REST-lookup and cache design still ported as upstream wrote them); requested on first use only, never at activation | G4, G5, G10 | P12 |
| **G13** | Worktree support: `git worktree` create/list/switch/remove, building on G5's linked-worktree detection, plus a user-configurable "prepare script" run after creating a worktree with visible progress feedback. *Not designed upstream either* — full design (RPC shape, pre-flight interaction, prepare-script sandboxing) happens at this phase's own Opus planning pass, not assumed here, same placeholder-then-design approach upstream itself used | G5 | P14 |
| **G14** | Incremental review ("Review state" below): per-file "last reviewed" state as a compressed blob snapshot, not just a commit sha — a rewritten history (rebase/squash/amend) can't be diffed by sha alone. Fast path (last-reviewed commit still an ancestor of HEAD) uses an ordinary `git diff`; slow path (history rewritten) diffs the stored blob against current content directly. Partial/range-level reviewed-vs-unreviewed marking within a file, not just a whole-file toggle. Own SQLite file (`review.db`), TTL-purged (14 days idle) and purged eagerly when the linked PR closes (G12) | G4, G6, G12 | new |
| **G15** | Inline AI review comments ("Review state" below): flat file+line/range annotations on top of G14's review session, no threading. A centralized list ordered by file then line, formatted as plain text to copy into an AI chat — deliberately just a copy-paste workflow for now, not a live integration. A clear-all action resets a session's comments | G14 | new |
| **G16** | Ship the extension: `vsce package` step producing a real `.vsix`, DMG bundling (`scripts/sign-bundle.sh`/`package` script copies it into the app bundle at a known runtime path), an *Install VS Code Integration* button in the *Connected editors* pane (G1) that shells out to `code --install-extension <path>` — argv-only, no shell, matching every other spawn in this chapter — with a "reveal in Finder" fallback when the `code` CLI isn't on `PATH`; plus the rest of upstream's P13 that isn't packaging mechanics: an SCM title-bar button and status-bar item that open the existing webview (entry points, not a redesign of it), and a command-palette audit wiring a command for every mutating operation introduced across G5–G15. Deliberately last of all: it packages and surfaces what every other phase builds | all | P13 (Ship), superseding it — DMG bundling instead of Marketplace/OpenVSX |

Each phase gets its own Opus-authored plan under `docs/v1.3/plans/` before implementation starts,
per `AGENTS.md` — none is written as part of this chapter spec.

## Review state (G14/G15)

Neither phase has an upstream equivalent — both are new, Kira-Studio-specific features, requested
2026-09-07, deliberately sequenced after the core port (G1–G11) and after G12 (PR-closed detection
needs `branch.resolvePr`) but before G16 (Ship), so the `.vsix` that gets packaged actually carries
them.

**Why a blob snapshot, not just a commit sha.** The trivial case — nothing folded since last review
— is a `git diff <lastReviewedSha> HEAD -- <file>`, no storage needed beyond the sha. The case that
actually motivates this phase is a rebase, squash, or amend: `<lastReviewedSha>` is no longer an
ancestor of `HEAD`, or doesn't exist at all, and git has nothing left to diff against. The fix is to
also keep the actual file content as it stood at last review, so a diff is still possible against
current content directly, independent of whether git's own history still contains a path to it.

- **Fast path**: `git merge-base --is-ancestor <lastReviewedSha> HEAD` — if it succeeds, an ordinary
  `git diff` is exact and cheap, and the stored blob is not read at all.
- **Slow path**: the stored blob is written to a temp file, current content resolved via `cat-file`,
  and the two are diffed with `git diff --no-index` — reusing `gitclient`'s existing spawn discipline
  (argv-only, no shell) rather than a hand-rolled Go diff algorithm. Precise temp-file lifecycle and
  concurrency (two review sessions in different `Conn`s touching the same repo) is G14's own planning
  concern, not fixed here.
- **Storage**: a second SQLite file, `review.db` under `${KIRA_HOME}`, not a table in `kira.db` — its
  lifecycle is nothing like the rest of the app's data (bulk blob content, TTL/PR-close purges that
  want to reclaim space aggressively, no reason to hold a lock on the main db while doing it).
  File content is compressed at rest (`compress/flate` or `compress/gzip`, stdlib — no new
  dependency) before being written as a `BLOB` column.
- **Session scope**: keyed by `(repo, branch)`, joining G6's base-resolver/ranged-walk concept of a
  branch review rather than inventing a second one.
- **Lifecycle**: TTL 14 days idle (returning after that window starts clean, by design, not an
  error case) and eager purge when G12's `branch.resolvePr` reports the linked PR closed/merged.
  Exact reaper shape (background sweep vs. lazy check-on-access, mirroring G2's `Registry` linger
  pattern either way) is G14's own design.
- **Partial review**: the requirement is fixed here, the mechanism is not — mark all, some, or none
  of a file's changed lines reviewed, independently re-toggleable, and that state has to degrade
  sensibly as the diff itself changes (new commits land, the fast/slow path swaps mid-session). Left
  to G14's own planning pass, the same way G13 defers its own range/session design.
- **AI comments (G15)**: intentionally the simplest possible shape — a flat table of
  `(session, file, line range, text, created_at)`, rendered as an ordered plain-text list for the
  user to paste into an AI conversation by hand. No AI API call, no response ingestion, no threading
  in v1.3 — but the backend shape is a real structured list precisely so a later phase can wire it to
  an actual call without a rework, the same "additive, not a rework" principle already applied to the
  future embedded-UI question (§ "Deliberately a stepping stone").

## Out of scope for v1.3

- Marketplace/OpenVSX publishing itself (upstream's literal P13) — G16's DMG bundling is this
  chapter's answer instead. P12 (GitHub PR links) and P14 (worktree support) are no longer
  unowned: they're G12 and G13, added 2026-09-07 specifically so upstream's incomplete phases
  don't ship unfinished here too.
- Any embedded git UI inside Kira Studio's own Wails frontend — deliberately deferred, but the
  session/transport layer (§6, `rpcstream`) is built so that work is additive later, not a rework.
- Redesigning the extension's UI around native VS Code surfaces (tree views, quickpicks in place of
  the graph) — considered and explicitly rejected; the existing webview UI ships as-is.

## Known open items

- **RE2 vs. JS `RegExp` in search (G10).** Upstream's whole-word matching compiles to `\b…\b` or,
  at a punctuation edge, a lookbehind/lookahead form Go's RE2 cannot express at all. The server-side
  tail scan and the client-side scan must agree exactly or a hit's presence depends on which page
  happens to be loaded. Needs a byte-boundary post-check implementation in `gitsearch` rather than
  a direct pattern port — flagged here so G10's own plan doesn't rediscover it from scratch.
- **Perf budgets need re-measurement, not re-derivation.** Upstream's ≤300ms first-paint and
  similar budgets were measured over in-process `postMessage`; a Unix socket plus FlatBuffers
  framing changes the cost profile in ways worth confirming empirically in G3 and G11, not assuming.
