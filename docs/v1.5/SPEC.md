# Kira Studio — v1.5

v1.3 shipped **git** as a third top-level subsystem, headless: a Go backend inside Kira Studio and
a separately-installed VS Code extension as its frontend (`docs/v1.3/SPEC.md`, G1-G34). v1.4 added
independent polish across existing modules, including three git-graph findings (P7).

This chapter gives the git module — and the codebase it operates on — a native home inside Kira
Studio itself, so a repository can be browsed, searched and navigated without installing the VS
Code extension. Two request threads drive it: (1) a **code intelligence module** — file tree,
Monaco-backed file/diff viewing, ripgrep search, quick-open, and tree-sitter-derived code
navigation — with the existing git graph (`packages/git-ui`) mounted on top of it as a first-class
native mode, and (2) a **local MCP server** that exposes the same code graph to an AI client so it
can navigate the repository with far fewer tokens than reading whole files. The second depends on
the first: an MCP tool for "find the definition of X" needs the same parse/graph data the in-app
go-to-definition command needs, so one graph serves both consumers.

**Numbering: C1-C9, restarting with a fresh prefix.** v1.3 used `G…` for the one reason it stated
itself: the whole chapter *was* the git subsystem, so the phase list and the subsystem were the same
thing. That reason recurs here — every phase below builds one subsystem (code intelligence, with the
git graph and the MCP server as two of its consumers) rather than independent unrelated phases the
way v1.1/v1.2/v1.4 each were — so this chapter takes its own letter, `C` (code), instead of
continuing v1.4's `P` numbering or reusing v1.3's `G`.

**Nine rows is where this chapter opens, not where it ends.** The table accrues rows as phases
land, the same convention every earlier chapter states for its own. A later row may also re-scope
an earlier one's edges once that phase's plan reads the current tree.

`docs/ARCHITECTURE.md` is authoritative for how the app actually works today; this file records
only this chapter's phases, one row each. Every row gets its own Opus-authored plan under `plans/`
before implementation starts, per `CLAUDE.md`. None is written as part of this spec.

**Sequenced by real dependency, not by theme.** The MCP server (now C3) only ever depended on C2's
graph — never on Monaco, ripgrep, quick-open or the native git graph, which are UI surfaces it never
touches. An earlier pass of this table sequenced it after those UI phases anyway, purely by grouping
"editor surfaces" together before "MCP surfaces" — a thematic grouping, not a dependency one. Moved
up once that distinction was made explicit: C1+C2 alone are enough to build and evaluate the MCP
server, including running a real comparison (a task done twice, once with the server available to an
agent and once without, on independent worktrees) well before the editor-UI phases exist at all.

## Grounding: what exists today, checked against the tree at chapter open

- **The git module is headless** (v1.3): `apps/kira-studio/internal/gitclient` (porcelain-parsing
  git runner, repo discovery, fsevents/fsnotify watcher) and `internal/gitrpc` (the handler table —
  graph, detail, search, stash, worktree, stack, remote, review, …) live inside the Kira Studio Go
  binary and are reached only over `${KIRA_HOME}/git.sock` (`internal/bridge/rpcstream`'s correlated
  JSON-control/FlatBuffers-bulk protocol). The only consumer is `apps/kira-studio-vscode`, a
  separately-installed VS Code extension; `apps/kira-studio/frontend` (the native renderer) has no
  git code at all and no `git` entry in `AppMode`/`MODES` (`frontend/src/workbench/modes.ts`,
  `frontend/src/state/mode.ts` — today `studio` and `api` only).
- **`packages/git-ui`** is the graph's whole Vue frontend — `CommitGrid.vue`, `graph/rowSvg.ts` +
  `graph/layout.worker.ts` (the commit-graph geometry engine, SlickGrid-hosted), branch/stash/
  worktree/stack panels, search, and a `components/review/` + `state/review*.ts` code-review layer
  (inline comment threads over a diff, G-phase PR-review work) — imported today **only** by
  `apps/kira-studio-vscode` (`package.json`'s sole non-`git-ui` consumer). The review layer is
  **deferred to the last phase of this chapter (C9)**, not ported alongside the rest of the graph in
  C8 — every other graph/branch/stash/worktree/search feature in `git-ui` lands with C8.
- **No in-app file or diff viewer exists for git today.** Opening a file or a diff from the graph
  delegates entirely to VS Code's own native editor/diff editor over a `kira-version:` virtual
  document scheme (`apps/kira-studio-vscode/src/diffToolbar.ts`, `virtualFileDecoration.ts`,
  `webviewDocument.ts`) — there is nothing to reuse for a native viewer beyond the byte-fetching
  IPC methods (`commit.detail`'s `FileChange[]`, working-tree diff) that already produce the text.
  Monaco is net new to this repo: no `monaco-editor` dependency, no existing bundling/worker story
  for it anywhere in `bun.lock`.
- **CodeMirror 6 is the only editor dependency today** (`docs/ARCHITECTURE.md`'s Stack table) —
  the SQL console, cell editor, document view, command preview. It is not proposed as the file/diff
  viewer here; the user asked for Monaco specifically, kept for its own syntax-highlighting
  (Monarch) and diff-rendering strengths, with its built-in language-service workers (TypeScript/
  JSON/CSS validation, the pieces that make Monaco behave like a mini language server on its own)
  explicitly disabled — this chapter's own code graph is the thing answering "go to definition",
  not Monaco's bundled one.
- **No tree-sitter, ripgrep, or MCP dependency exists anywhere in the tree** (`go.mod`, `go.sum`,
  `bun.lock` all checked at chapter open) — every phase below that touches one of these is net-new
  infrastructure, not a gap-fill in something partially built.
- **Storage precedent**: `~/.kira-studio/kira.db` (`modernc.org/sqlite`, pure Go, no cgo) is the
  app's own database, one `SetMaxOpenConns(1)` connection, forward-only numbered migrations. The
  user asked for tree-sitter parses and the code graph to be "cached in sqlite" — this chapter's own
  planning pass decides whether that means new tables in `kira.db` or a dedicated per-repository
  cache database (a repo can be far larger and more volatile than this app's own settings/tab state,
  and multiple repositories may be open across windows), but the driver choice (`modernc.org/sqlite`)
  carries over either way for the same cgo-free reasons it was picked originally.
- **Headless launch precedent**: `bun run` already drives every dev/build/test entry point in this
  repo (root `package.json`'s `scripts`) — the user's requirement that the MCP server run headless
  via `bun run`, without interfering with this repo's own dev loop, follows the same shape as any
  other script here rather than inventing a new process-launch convention.

## Phasing

| Phase | Deliverable | Why here |
|---|---|---|
| **C1 Tree-sitter parsing pipeline, cached in SQLite** | Parse a repository's source files with tree-sitter and persist the resulting trees/symbol tables in a SQLite cache, keyed so a later phase's graph build and a live editor's incremental reparse both read from it. Grammars in scope, per the user's list: Java, Python, JavaScript, TypeScript (and TSX), Go, Rust; the framework dialects React (JSX/TSX — no separate grammar, covered by the JS/TS grammar plus AST-level component/hook conventions the graph phase reads), Vue (`.vue` SFC — its own tree-sitter grammar, block-based: template/script/style each reparsed with their own grammar), Svelte (`.svelte`, same SFC shape) and Angular (TypeScript decorators plus inline/external HTML templates — no separate grammar beyond TS + HTML); and the common data formats named — JSON, HTML, plus CSS as HTML/Vue/Svelte's necessary companion. Reparse on change: file-save events already flow through `internal/gitclient`'s repo watcher (fsevents on darwin, fsnotify elsewhere) for git-status purposes — this phase's own planning pass decides whether the parse cache subscribes to that same watcher or needs its own, and how a tree-sitter incremental edit (byte-range reparse, not whole-file) maps onto a watcher's own coarser change-set. This phase's own planning pass also picks the SQLite layout (new `kira.db` tables vs. a dedicated cache database — see Grounding) and the Go tree-sitter binding (grammars are C, so a cgo-free binding is not guaranteed to exist for every language on this list — the plan states what it found and what it costs, matching this app's existing preference for pure-Go drivers where one exists and a justified exception where it doesn't) | Foundation for every later phase in this chapter — C2's graph, C3's MCP server, and C5's Monaco definition provider all read parse output, so getting the cache/reparse contract right first avoids three later phases each inventing their own version of it |
| **C2 Code graph: go-to-definition, go-to-implementation, find references** | Build a navigable graph over C1's parsed symbol tables — per-file declarations/references resolved and linked across files within a repository — and expose it as a query surface (`definitionOf(file, position)`, `implementationsOf(...)`, `referencesTo(...)`) that both the MCP server (C3) and the in-app editor (C5) call. Scope matches C1's grammar list; a framework's own resolution rules (a Vue SFC's `<script setup>` binding into its `<template>`, a React component/hook reference, an Angular decorator wiring a template to a class) are this phase's own design surface, and its planning pass states which of those get real cross-block resolution versus staying at the plain-symbol level tree-sitter alone gives for a first pass — "support" for a framework in the user's ask does not obligate every framework-specific inference C2 could theoretically build, and the plan should say plainly where it draws that line rather than leaving it implicit. Persisted in the same SQLite cache C1 established, invalidated incrementally on the same reparse signal | The one piece of this chapter that is genuinely novel algorithmically (graph construction/resolution, not another view over data this repo already has) — isolating it from C1's parsing mechanics and C5's editor wiring keeps each phase's plan reviewable on its own |
| **C3 MCP repository-map server** | A local MCP server exposing C2's code graph (definitions, references, implementations, symbol/file search) as tools an AI client calls instead of reading whole files — the token-reduction goal stated in the request. **Disabled by default.** A settings surface: an enable toggle that, once on, shows the exact CLI command the user runs to register this server with the Claude Code CLI *before* an Install button next to it — command visible first, button second, so enabling is never a silent action — and the same treatment (command shown, then an install action) for registering it as a VS Code extension's MCP server. **Runs headless via `bun run`** — a script in this repo's own `package.json`, matching every other dev/build/test entry point (see Grounding) — and is written so running it during this repo's own development never collides with the dev server, the git socket, or any port/file lock `wails3 task dev` already holds; this phase's own planning pass states the concrete isolation mechanism (a distinct port/socket, a lock file, or a design that needs neither) rather than asserting non-interference without one. Reads the same SQLite cache C1/C2 populate — no second parse pipeline | Moved up from after the editor-UI phases once it was clear it depends only on C2, never on Monaco/ripgrep/quick-open/the native git graph (C5-C8) — landing it here lets its actual value (does it cut token usage on a real task?) get measured right after C2, instead of waiting on four unrelated phases first |
| **C4 CLAUDE.md: document the repository-map MCP server for this repo's own development** | Add a section to `CLAUDE.md` naming the C3 server, how a session working in this repo enables and configures it, and that doing so is expected practice for development inside this repository — mirroring how `CLAUDE.md` already documents its own process rather than leaving a shipped capability undiscoverable to the next session that opens this file | Right after C3, since it documents C3's real shape rather than a planned one, and `CLAUDE.md`'s own rule ("prune as you go, don't just append") argues for writing this once the thing being documented is real |
| **C5 Monaco integration: file and diff viewing, syntax highlighting only** | Bring `monaco-editor` into `apps/kira-studio/frontend` as the file/diff viewer this chapter's native module needs (see Grounding — nothing today fills that role in-app). Disable Monaco's own bundled language-service workers (`editor.worker`, `typescript.worker`, `json.worker`, `css.worker`, `html.worker` — the pieces that give Monaco unsolicited diagnostics/completions of its own) and use it strictly as a renderer: Monarch tokenizers for syntax highlighting, its diff-editor widget for a two-revision comparison, its own definition-provider/hover extension points wired to C2's graph instead of anything Monaco ships built in. This phase's own planning pass decides the bundling story (Vite's own asset handling for Monaco's non-worker-thread needs, given the worker story is being deliberately narrowed rather than adopted wholesale) and which languages get a Monarch grammar registered versus falling back to plain text | Sequenced after C2 so the definition-provider wiring has a real graph to call on day one, rather than landing a viewer with no navigation and rewiring it later |
| **C6 Search: in-file and repository-wide via ripgrep** | Two search surfaces over the code intelligence module: search within the currently-open file (Monaco's own find widget, scoped to the open buffer) and a repository-wide search panel backed by `ripgrep`, invoked as a subprocess from Go the same way `internal/gitclient`'s runner already shells out to `git` — streaming matches back as they arrive rather than buffering a whole run, consistent with this app's "every operation exceeding ~150ms shows progress" invariant. This phase's own planning pass decides how `rg` is obtained (vendored binary vs. a build-time dependency vs. requiring it on `PATH`) against this repo's packaging story (`docs/PACKAGING.md`) and cgo-free-adapter precedent, and the result-to-file mapping so a match click opens the right file at the right line in C5's viewer | Independent of C2's graph — ripgrep search is text-based, not symbol-based — but depends on C5 existing as the thing a search result opens into |
| **C7 Quick Open: fuzzy file search (Cmd+P)** | A command-palette-style fuzzy file finder over the open repository's tracked/untracked-but-not-ignored files, opening the chosen file in C5's viewer. This repo already has one fuzzy-match precedent worth reusing or deliberately declining (`frontend/src/shortcuts/CommandPalette.vue` — commands, not files) and this phase's own planning pass states which existing file-listing source it reads from: a fresh Go-side walk respecting `.gitignore`, or the same repository listing C1's parse pipeline already has to enumerate to know what to parse — reusing the latter avoids a second file-enumeration mechanism if its shape fits | Small and self-contained once C1's file enumeration and C5's file-opening exist; sequenced last among the editor-surface phases since it is the thinnest of the three and benefits most from the others already being in place |
| **C8 Git graph mounted natively in Kira Studio** | A new `git` entry in `AppMode`/`MODES` (`frontend/src/workbench/modes.ts`, `frontend/src/state/mode.ts`, `@shared/domain/mode`) that mounts `packages/git-ui`'s graph — commit graph, branch/tag/stash/worktree panels, uncommitted-changes strip, search, undo — inside the native shell, reachable the same way `studio`/`api` are today, at full parity with the extension **except the code-review layer**, which is deferred to C9 (below), landing last rather than alongside the rest of the graph. File and diff opens route to C5's Monaco viewer instead of VS Code's native editor (see Grounding — that delegation has no in-app equivalent yet, which is exactly what C5 built). The transport question is this phase's own to answer: `git-ui`'s `bridge/client.ts` currently assumes the extension's own transport shape (a paired client token over `git.sock`, per `git_clients`'s own trust-store design, G1) — a query the native app makes to its *own* backend process needs the same `internal/gitrpc` handler table but not necessarily the same paired-client authentication the socket protocol exists to gate an external VS Code process behind; the plan states whether that is a second, in-process transport or the existing socket reused with a self-trusted client | Sequenced after C5 (the viewer it needs) and C2/C7 are optional inputs (jumping from a graph file row into go-to-definition, or quick-opening a file the graph just showed) rather than hard dependencies, so it can land as soon as C5 is ready even if C2/C6/C7 slip |
| **C9 Code-review layer ported natively (last)** | Port `packages/git-ui`'s `components/review/` + `state/review*.ts` — inline comment threads over a diff, PR-review workflow — into the native `git` mode C8 established, so the one piece of `git-ui` deliberately held back from C8 lands once everything else in the chapter (the graph itself, C5's Monaco viewer for rendering the diff a comment thread anchors to, C2's navigation) is already in place and proven. This phase's own planning pass states what changes versus the VS Code extension's own review surface — `apps/kira-studio-vscode/src/reviewView.ts`/`reviewComments.ts`/`reviewRanges.ts`/`reviewMarking.ts` currently host it there — and whether the native port reuses `git-ui`'s review components as-is (they are already framework-agnostic Vue, not VS-Code-API-bound) or needs adaptation for anchoring comment ranges against C5's Monaco diff view instead of VS Code's own diff editor | Explicitly last, per instruction: everything this layer needs (a mounted graph, a native diff viewer, real navigation) is safer to build against once proven rather than co-developed with them |

## Out of scope for v1.5

- Any language/framework beyond the list C1 states — no C#, Ruby, PHP, etc., and no framework
  beyond React/Vue/Svelte/Angular, unless a later row explicitly adds one.
- Editing inside the Monaco viewer beyond what viewing a file/diff and navigating it requires — this
  chapter is a viewer plus navigation, not a second general-purpose code editor competing with
  CodeMirror's existing role elsewhere in the app (`docs/ARCHITECTURE.md`'s Stack table).
