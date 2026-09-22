# Kira Space

[![PR](https://github.com/vlad-cirstean/kira-studio/actions/workflows/pr.yml/badge.svg)](https://github.com/vlad-cirstean/kira-studio/actions/workflows/pr.yml)

A native macOS git client: a commit graph, branch review and remote operations over a
VS Code-adjacent code workspace (file tree, Monaco viewer, diffs, search) — built on Wails (Go)
and Vue 3. The same backend also serves **Kira Space** (`apps/kira-space-vscode`), a VS Code
extension that brings the same graph and review sidebar into an editor window.

## Status

- **Beta, split out of Kira Studio as its own app at v1.9 P100.** The git backend, the native code
  workspace and the VS Code extension all shipped as part of Kira Studio through v1.3-v1.8; P100
  moved them here, unchanged in behavior, into a standalone app with no `Studio`/`Api` database or
  API tooling of its own. See the root [`README.md`](../../README.md) for that sibling app and
  [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)'s Git module section for the fuller history.
- **macOS 14+, Apple Silicon (`arm64`) only. Dark mode only.**
- The packaged build is **unsigned (ad-hoc)** — code signing and notarization are deferred past
  v1, the same posture as Kira Studio's own build. The first launch after installing a new build
  may show one "Kira Space wants to use your confidential information stored in…" prompt —
  **Always Allow** answers it permanently for that build.

## Code workspace features

- **Repository import** — import a git repository; it opens as its own independent workspace,
  with its own isolated tab set.
- **Project tree and file viewer** — every tracked/untracked-but-not-ignored file, opened
  read-only into Monaco; refreshes on workspace open and on an explicit Refresh, not live.
- **Diff tabs** — worktree-vs-HEAD diffs in Monaco's own diff editor.
- **Search** — in-file via Monaco's own find widget; repository-wide in Go, with streamed results
  and no `ripgrep` subprocess.
- **Quick Open (⌘P)** — a fuzzy file finder over the open repository.
- **Git graph, natively** — the same `packages/git-ui` graph the VS Code extension uses, mounted
  as each workspace's pinned first tab, with the code-review layer (inline AI-review gutter icons,
  PR-review threads) alongside it.
- **Inline git blame** — a per-line annotation over the file viewer, toggled by an Appearance
  setting. The status bar also shows the cursor line's author, relative date and commit summary
  regardless of that setting, and clicking it reveals the commit in the graph tab. A file tab
  pinned to a historical revision shows no blame at all — blame only ever reflects the working
  tree.
- **Markdown reading view** — a rendered-Markdown toggle beside the raw view, per tab.

## Git features

The git backend runs inside this app — spawn discipline, porcelain parsing, the paged log walk,
pre-flight hazard analysis, every write — and serves two frontends over it: a native **Git**
module in this window (its own `AppMode`, with a pinned native graph tab and a native code-review
layer, both described under Code workspace above), and **Kira Space**, a VS Code extension that
dials the same backend over a Unix socket at `~/.kira-space/git.sock`. The `.vsix` ships inside
this app's own DMG rather than through the Marketplace, and installs from a *Connected editors*
pane in Settings.

The capabilities below are all backend capabilities, reachable from both frontends, except where
noted: the native surface performs fetch/pull/push/force-push, undo, restack, stash and worktree
operations, with a native credential prompt for HTTPS remotes, but conflict resolution, a worktree
prepare script's shell execution, opening a worktree window, and setting the global git path stay
extension-only for now.

- **Commit graph** — a virtualized, lane-drawn log over the whole ref set, paged and streamed from
  the backend as binary FlatBuffers chunks; per-lane ref badges, a checked-out-HEAD indicator, and
  in-graph search.
- **Commit detail and diffs** — file tree, per-file and whole-commit diffs, blob reads, and a
  line-mapped **Go to file** that works on historical content not checked out on disk. Opening a
  commit's changes opens **every** changed file as one replaceable preview cohort rather than a
  dozen permanent tabs — a cohort tab promotes to permanent on the same double-click convention the
  file tree already uses.
- **Refs, checkout and history rewriting** — branches and tags (create/rename/delete, local and
  remote), checkout, revert, reset in all three modes, cherry-pick, plus an in-progress banner with
  Continue/Abort/Skip for a merge, rebase or cherry-pick left mid-flight.
- **Pre-flight, computed in Go** — every hazardous operation is classified server-side before it
  runs (uncommitted work, a detached `HEAD`, a protected branch, a conflicting pop) and the verdict
  crosses as data, so the editor never re-derives it. A single-slot **undo** covers the last
  undoable operation per repository, labelled with the window that ran it.
- **Remote operations** — fetch, push, force-with-lease, a decomposed pull with a strategy picker,
  background auto-fetch, and real cancellation. A credential prompt is relayed into the VS Code
  window that owns the operation, through an askpass broker that fails rather than hangs.
- **Stash** — the full stack (push/apply/pop/drop/branch-from-stash) with `merge-tree`-based pop
  prediction, plus branch-scoped extras: auto-stash on checkout tagged with the branch it came
  from, cross-branch apply, and a reusable global stash kept under this app's own `refs/kira/*`
  namespace, which never appears in your graph.
- **Branch review** — a base resolver and a ranged walk, with **incremental review state**: what
  you last reviewed is kept per file as a compressed content snapshot, not just a commit sha, so a
  rebase, squash or amend still diffs correctly. Range-level marking happens in VS Code's own diff
  editor. The file tree's mark-reviewed control is a real checkbox: a partially-reviewed file shows
  an indeterminate state, and a fully-reviewed file's row tint clears. A flat list of file/line
  **AI review comments** exports as plain text to paste into a chat — deliberately a copy-paste
  workflow, not a live integration.
- **Search** — a cancellable server-side `git log` tail scan paired with a client-side scan of
  already-loaded rows. Go's RE2 and JavaScript's `RegExp` are reconciled explicitly rather than
  approximated: a literal query runs no regex engine at all, a regex query is translated construct
  by construct, and what RE2 genuinely cannot express (lookaround, backreferences) is refused as a
  named result rather than silently mismatched.
- **Worktrees and stacked branches** — `git worktree` create/list/switch/remove with an optional
  per-repository prepare script you approve once, and stacked branches with restacking and stack
  navigation. **Create worktree** is also offered from the row context menu on a branch, a remote
  branch and a commit row, seeded from that row — the same create machinery the worktree list
  already used.
- **One tabbed picker for refs and working state** — branches, tags, stashes, worktrees and stacks
  fold into five tabs behind one filter box, with a live per-tab match count (so a query typed on
  one tab still hints a match on another), HEAD and any branch checked out in another worktree
  pinned to the top, the rest ranked by recency, a per-list "Show more" step, and
  arrow-key/Home/End/Enter roaming from the filter box down into the rows.
- **GitHub PR links** — resolved **per commit**, not per branch tip, so the indicator shows on a
  commit in the middle of a branch's history or in a detached `HEAD`, not only on a checked-out
  tip. Authentication is delegated entirely to the `gh` CLI already on your machine: this app never
  holds a GitHub token, and never reads `gh`'s own stored credential. A commit's PR now renders
  **inline in the detail panel** with its open/closed/merged state, and the link opens in the OS
  browser — never an embedded webview and never a real `<a href>`. **GitHub Enterprise hosts work**
  too: the host check accepts `github.com` plus any host the `gh` CLI has itself authenticated
  against, rather than a hardcoded literal.
- **Several editors at once** — multiple VS Code windows connect to one backend, on the same
  repository or different ones. Repository-level state (the reader/writer gate, the file watcher,
  the caches, the undo slot) is shared; each connection's own paging and walk state is private. A
  new editor asks for approval **in Kira Space's window**, its token is stored only as a salted
  hash, and revoking it drops every live connection holding it.

Two limits worth knowing up front:

- **Git 2.38 or newer is required** — `git merge-tree --write-tree`, which conflict prediction
  needs. Below that the extension shows a blocked state rather than degrading silently.
- **Kira Space and the extension are hard-locked to the same contract version.** A mismatch is a
  blocking panel naming both versions, not a reduced feature set — there is no auto-update here and
  the two install separately, so "run an older method set" has no honest meaning.

## Requirements

- macOS 14 or later, Apple Silicon (`arm64`).
- [Git](https://git-scm.com) 2.38 or newer on `PATH`. The native Git module needs nothing beyond
  that.
- Optional: [VS Code](https://code.visualstudio.com) 1.134+, to install the bundled **Kira Space**
  extension into as a second frontend, and the [GitHub CLI](https://cli.github.com) (`gh`), already
  logged in, for PR links — without it the PR indicator simply stays blank and nothing else
  changes.
- The rest of the toolchain (Go, Bun, the Wails v3 CLI, Xcode command-line tools) is the same as
  Kira Studio's own — see the root [`README.md`](../../README.md)'s Requirements section. This app
  lives in the same monorepo and Bun workspace, so a single `bun install`/`bun run setup` covers
  both apps.

## Install

There's no release yet, so installing means building it from the repo root:

```sh
git clone <repo-url>
cd kira-studio
bun run package:space
```

The built, signed (ad-hoc) app lands at `apps/kira-space/bin/Kira Space.app`, and the disk image
that ships it at `apps/kira-space/bin/Kira Space.dmg`. `apps/kira-space/bin/kira-space.vsix` is the
packaged VS Code extension, copied into the bundle before signing.

Since the build is unsigned (ad-hoc), the first launch needs a Gatekeeper workaround:
right-click → Open, or:

```sh
xattr -dr com.apple.quarantine "apps/kira-space/bin/Kira Space.app"
```

See [`docs/PACKAGING.md`](../../docs/PACKAGING.md)'s "Kira Space packaging" section for the bundle
layout, the `.vsix` chain, and the verification checklist.

## Development

```sh
bun run dev:space   # from the repo root — installs everything needed, then `wails3 task dev`
```

Run from the repo root (same as Kira Studio); see the root [`README.md`](../../README.md)'s
Development section for the shared scripts (`setup`, `lint`, `typecheck`, `test:go`, and so on).
The scripts specific to this app:

| Script | What it does |
|---|---|
| `bun run dev:space` | `cd apps/kira-space && wails3 task dev` — native window, HMR |
| `bun run build:space` | Production Vue build into `apps/kira-space/frontend/dist` |
| `bun run typecheck:space-web` | `apps/kira-space/frontend/src`, including `.vue` files (`vue-tsc`) |
| `bun run typecheck:space-tests` | `apps/kira-space/tests/` tiers and `playwright.config.ts` (`tsgo`) |
| `bun run typecheck:space-unit` | `apps/kira-space/tests/unit` (`tsgo`) |
| `bun run typecheck:git` | `packages/git-ipc`, `packages/git-core` and `apps/kira-space-vscode` (`tsgo`), plus `packages/git-ui` and `packages/kira-ui` (`vue-tsc`) |
| `bun run build:vscode` | Builds the VS Code extension's bundle (`scripts/build-vscode.ts`) |
| `bun run package:vscode` | Packages it into `apps/kira-space/bin/kira-space.vsix` (`scripts/package-vscode.ts`) — `bun run package:space` runs this before bundling it into the app |
| `bun run test:webview` | Builds the extension bundle, then runs Playwright against its own webviews (layout + interaction, see Tests below) |
| `bun run test:ui:space` | Builds, then runs Playwright (WebKit) against this app's own built bundle |
| `bun run package:space` | Builds the native Wails bundle and the `.dmg` around it, ad-hoc signs both — `apps/kira-space/bin/Kira Space.{app,dmg}` |

`bun run test:unit`, `bun run test:go` and `bun run typecheck` (unscoped) already cover this app —
they run every project/package in the workspace, git included.

**App data:** this app keeps `kira.db`, `logs/`, `review.db`, and its own `git.sock`/
`git.sock.lock`, all under `~/.kira-space/`. The `KIRA_SPACE_HOME` environment variable relocates
that whole directory, the same way `KIRA_HOME` does for Kira Studio's own home — the two are
independent, so running both apps at once (or two test instances) never contends over one socket
or one database.

## Tests

Two TypeScript suites under `apps/kira-space/tests/` (`unit/`, `ui/`), plus a suite under
`apps/kira-space-vscode/tests/` for the git webviews, and the Go suite under `apps/kira-space/`.
`packages/db-fixtures/` is not exercised here — that's Kira Studio's own DB fixture corpus.

- **`bun run test:unit`** — plain TypeScript modules exercised with fakes rather than a real
  window process (this app's tests run alongside Kira Studio's own in one invocation).
- **`bun run test:ui:space`** — Playwright against this app's own built bundle, real WebKit.
- **`bun run test:webview`** — Playwright against the extension's own built webview documents
  (`apps/kira-space-vscode/tests/`), in two projects. `layout` asserts **real rendered box
  heights** against the real emitted document and the real bundle, not DOM shape. `interaction`
  covers the graph columns, the file tree, the review panel, the branch/tag/stash/worktree/stack
  picker and the shared floating-UI geometry. No backend, no container, no VS Code.
- **`bun run test:go`** — the Go test suite, shared with Kira Studio's own (`go test ./...` from
  the repo root covers both apps, since they're one Go module). The git packages need no container
  at all — they build real repositories under `t.TempDir()` against the `git` on `PATH`, and skip
  themselves without one; their perf probes are opt-in behind `KIRA_GIT_PERF=1` and assert
  nothing.

## Architecture

Kira Space is a native Wails (Go) app, packaged the same way Kira Studio is: one Go process
handles windowing, IPC and the whole git backend — no sidecar, no second runtime. The Vue 3
frontend runs in the OS's own WebView (WKWebView on macOS).

```
apps/kira-space/internal        the Go app: git backend (gitclient, gitops, gitstore, gitrpc, gitsock, gitsession, ...), the native code workspace (codeworkspace), the IPC bridge
apps/kira-space/frontend/src    the Vue 3 app (bindings + the built bundle live alongside it, both gitignored)
apps/kira-space/tests/unit      unit suite — no external resource
apps/kira-space/tests/ui        Playwright against the built bundle, WebKit
apps/kira-space-vscode          the Kira Space VS Code extension — the git module's second frontend
packages/git-ipc     the git contract, RPC/codec/validation, the socket channel, the FlatBuffers schema
packages/git-core    client-side git logic: commit store, lane layout, the client half of search, ports
packages/git-ui      the git graph/review UI, hosted by the extension and by this app's own native Git module
packages/kira-ui     host-agnostic Vue components shared by this app's workbench and the git webviews
```

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)'s Git module section for the full
current-state breakdown, and [`docs/v1.9/SPEC.md`](../../docs/v1.9/SPEC.md) for the phase (P100)
that created this app.

## Not shipped

Everything the root [`README.md`](../../README.md)'s own "Not shipped" section lists, plus: the
extension is **not published to the VS Code Marketplace or OpenVSX**; it ships in this app's DMG
and installs from the *Connected editors* pane.

## License

[MIT](../../LICENSE)
