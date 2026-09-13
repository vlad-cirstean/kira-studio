# Kira Studio — v1.5

v1.3 shipped **git** as a third top-level subsystem, headless: a Go backend inside Kira Studio and
a separately-installed VS Code extension as its frontend (`docs/v1.3/SPEC.md`, G1-G34). v1.4 added
independent polish across existing modules, including three git-graph findings (P7).

This chapter gives the git module — and the codebase it operates on — a native, **read-only**
workspace inside Kira Studio itself: import a repository into the same panel a database connection
lives in today, then browse, search and navigate it, VS Code-style, without installing the VS Code
extension. Two request threads drive it: (1) a **code intelligence module** — a tabbed workspace per
open repository (a filesystem project tree, Monaco-backed file/diff viewing, in-file and
repository-wide search, quick-open, and tree-sitter-derived code navigation), nothing in it able to
write to the working tree — with the existing git graph (`packages/git-ui`, the exact same
components the VS Code extension uses) mounted as that workspace's own permanently pinned first tab,
and its code-review layer (inline AI-feedback gutter icons, PR-review threads) landing once the rest
of the workspace exists and is proven, its own placement resolved then rather than guessed now, and
(2) a **local MCP server** that exposes the same code graph to an AI client so it can navigate the
repository with far fewer tokens than reading whole files. The second depends on the first: an MCP
tool for "find the definition of X" needs the same parse/graph data the in-app go-to-definition
command needs, so one graph serves both consumers.

**Numbering: C1-C13, restarting with a fresh prefix.** v1.3 used `G…` for the one reason it stated
itself: the whole chapter *was* the git subsystem, so the phase list and the subsystem were the same
thing. That reason recurs here — every phase below builds one subsystem (code intelligence, with the
git graph and the MCP server as two of its consumers) rather than independent unrelated phases the
way v1.1/v1.2/v1.4 each were — so this chapter takes its own letter, `C` (code), instead of
continuing v1.4's `P` numbering or reusing v1.3's `G`.

**Thirteen rows is where this chapter stands today, not where it ends.** The table accrues rows as
phases land, the same convention every earlier chapter states for its own. A later row may also
re-scope an earlier one's edges once that phase's plan reads the current tree — C5's own planning
pass did exactly that: its plan judged the phase too large for one Sonnet implementation pass and
split it into two (C5 itself, then C6), pushing every phase after it up by one. Nothing about C5's
own scope shrank; the split moved its diff-tab and code-navigation half into its own row.

`docs/ARCHITECTURE.md` is authoritative for how the app actually works today; this file records
only this chapter's phases, one row each. Every row gets its own Opus-authored plan under `plans/`
before implementation starts, per `CLAUDE.md`. None is written as part of this spec.

**Sequenced by real dependency, not by theme.** The MCP server (now C3) only ever depended on C2's
graph — never on Monaco, search, quick-open or the native git graph, which are UI surfaces it never
touches. An earlier pass of this table sequenced it after those UI phases anyway, purely by grouping
"editor surfaces" together before "MCP surfaces" — a thematic grouping, not a dependency one. Moved
up once that distinction was made explicit: C1+C2 alone are enough to build and evaluate the MCP
server, including running a real comparison (a task done twice, once with the server available to an
agent and once without, on independent worktrees) well before the editor-UI phases (C5-C9) exist at
all.

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
  **deferred to the last feature phase of this chapter (C10)**, not ported alongside the rest of the
  graph in C9 — every other graph/branch/stash/worktree/search feature in `git-ui` lands with C9.
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
- **No tree-sitter, MCP, or Monaco dependency exists anywhere in the tree** (`go.mod`, `go.sum`,
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
- **Corrected mid-chapter: no ripgrep dependency.** C7 (search) was originally scoped around a
  `ripgrep` subprocess; per explicit instruction it now searches in Go instead, a library only where
  one earns its keep over a hand-rolled walk-and-scan (see C7's own row).
- **Tabs have no preview/permanent or pinned concept today, and are not scoped per owner.**
  `state/tabs.ts`'s `tabsState.tabs` is one flat, ordered array shared across the whole app; a click
  just activates a tab (`TabStrip.vue`), `openTab` only dedups by `(kind, connectionId, path)`
  identity, and `moveTab` reorders any tab anywhere with no reserved position. `state/mode.ts` filters
  that one array by mode (`studio`/`api`) only — never by which connection opened a tab, so today's
  connections already interleave in one shared strip. VS Code-style preview tabs (a click replaces
  one ephemeral slot; a double-click promotes it), a permanently-pinned tab, and a genuinely
  independent tab set per open repository are all net-new plumbing this chapter adds, not filters
  over something that already exists.
- **The connection panel is `ProjectPanel.vue` ("Connections"), backed by `state/connections.ts`'s
  `ConnectionSummary`** — a DB-connection-specific schema (host/port/credentials-mode/preconnect).
  It does not fit a git repo entry (path/remote/default branch) as-is; C5's own plan resolves this
  with a parallel `code_repos` list rendered in the same panel (see C5's own row).
- **`ProjectTree.vue` browses schema objects (tables/views/keys/topics/…), never a filesystem** —
  a repo's file tree needs a new component; C5's plan hosts it on `TreeHost.vue`, the same
  virtualization/reveal chrome `ProjectTree.vue` itself sits on, rather than a schema-specific one.
- **`AppMode` (`studio`/`api`) is a global singleton** — one active mode per window
  (`state/mode.ts`'s own comment: "mode is a derived view over the one tab list, not a second state
  tree"). Nothing today parametrizes a mode, or its tabs, by an owning entity — supporting N
  concurrently open repositories, each with its own isolated tab set, is new capability, not a
  reachability toggle like `studio`/`api` already have. C5's plan resolves this with a `workspaceId`
  on `TabRecord` and a `workspaceKeyOf(tab)` derivation, rather than a second `AppMode` value —
  `studio`/`api` tabs carry `workspaceId: null` and behave exactly as they do today.
- **A read-only tab precedent already exists**: the `definition` tab kind has no dirty flag, no save
  action, and no badge/dirty-mark wiring at all (`tabKinds.ts`'s `badge` left unset for it) — the
  shape this chapter's tabs mirror, rather than inventing a new "has no write path" convention.

## Phasing

| Phase | Deliverable | Why here |
|---|---|---|
| **C1 Tree-sitter parsing pipeline, cached in SQLite** | Parse a repository's source files with tree-sitter and persist the resulting trees/symbol tables in a SQLite cache, keyed so a later phase's graph build and a live editor's incremental reparse both read from it. Grammars in scope, per the user's list: Java, Python, JavaScript, TypeScript (and TSX), Go, Rust; the framework dialects React (JSX/TSX — no separate grammar, covered by the JS/TS grammar plus AST-level component/hook conventions the graph phase reads), Vue (`.vue` SFC — its own tree-sitter grammar, block-based: template/script/style each reparsed with their own grammar), Svelte (`.svelte`, same SFC shape) and Angular (TypeScript decorators plus inline/external HTML templates — no separate grammar beyond TS + HTML); and the common data formats named — JSON, HTML, plus CSS as HTML/Vue/Svelte's necessary companion. Reparse on change: file-save events already flow through `internal/gitclient`'s repo watcher (fsevents on darwin, fsnotify elsewhere) for git-status purposes — this phase's own planning pass decides whether the parse cache subscribes to that same watcher or needs its own, and how a tree-sitter incremental edit (byte-range reparse, not whole-file) maps onto a watcher's own coarser change-set. This phase's own planning pass also picks the SQLite layout (new `kira.db` tables vs. a dedicated cache database — see Grounding) and the Go tree-sitter binding (grammars are C, so a cgo-free binding is not guaranteed to exist for every language on this list — the plan states what it found and what it costs, matching this app's existing preference for pure-Go drivers where one exists and a justified exception where it doesn't) | Foundation for every later phase in this chapter — C2's graph, C3's MCP server, and C5's Monaco definition provider all read parse output, so getting the cache/reparse contract right first avoids three later phases each inventing their own version of it |
| **C2 Code graph: go-to-definition, go-to-implementation, find references** | Build a navigable graph over C1's parsed symbol tables — per-file declarations/references resolved and linked across files within a repository — and expose it as a query surface (`definitionOf(file, position)`, `implementationsOf(...)`, `referencesTo(...)`) that both the MCP server (C3) and the in-app editor (C6) call. Scope matches C1's grammar list; a framework's own resolution rules (a Vue SFC's `<script setup>` binding into its `<template>`, a React component/hook reference, an Angular decorator wiring a template to a class) are this phase's own design surface, and its planning pass states which of those get real cross-block resolution versus staying at the plain-symbol level tree-sitter alone gives for a first pass — "support" for a framework in the user's ask does not obligate every framework-specific inference C2 could theoretically build, and the plan should say plainly where it draws that line rather than leaving it implicit. Persisted in the same SQLite cache C1 established, invalidated incrementally on the same reparse signal | The one piece of this chapter that is genuinely novel algorithmically (graph construction/resolution, not another view over data this repo already has) — isolating it from C1's parsing mechanics and C5/C6's editor wiring keeps each phase's plan reviewable on its own |
| **C3 MCP repository-map server** | A local MCP server exposing C2's code graph (definitions, references, implementations, symbol/file search) as tools an AI client calls instead of reading whole files — the token-reduction goal stated in the request. **Disabled by default.** A settings surface: an enable toggle that, once on, shows the exact CLI command the user runs to register this server with the Claude Code CLI *before* an Install button next to it — command visible first, button second, so enabling is never a silent action — and the same treatment (command shown, then an install action) for registering it as a VS Code extension's MCP server. **Runs headless via `bun run`** — a script in this repo's own `package.json`, matching every other dev/build/test entry point (see Grounding) — and is written so running it during this repo's own development never collides with the dev server, the git socket, or any port/file lock `wails3 task dev` already holds; this phase's own planning pass states the concrete isolation mechanism (a distinct port/socket, a lock file, or a design that needs neither) rather than asserting non-interference without one. Reads the same SQLite cache C1/C2 populate — no second parse pipeline | Moved up from after the editor-UI phases once it was clear it depends only on C2, never on Monaco/search/quick-open/the native git graph (C5-C9) — landing it here lets its actual value (does it cut token usage on a real task?) get measured right after C2, instead of waiting on five unrelated phases first |
| **C4 CLAUDE.md: document the repository-map MCP server for this repo's own development** | Add a section to `CLAUDE.md` naming the C3 server, how a session working in this repo enables and configures it, and that doing so is expected practice for development inside this repository — mirroring how `CLAUDE.md` already documents its own process rather than leaving a shipped capability undiscoverable to the next session that opens this file | Right after C3, since it documents C3's real shape rather than a planned one, and `CLAUDE.md`'s own rule ("prune as you go, don't just append") argues for writing this once the thing being documented is real |
| **C5 Native code-viewing workspace, shell and viewer: repo import, tabs, project tree, Monaco file viewer — read-only throughout** | Import a git repository into the same panel a database connection lives in today (`ProjectPanel.vue`'s "Connections" list) as a parallel `code_repos` entry, not an extended `ConnectionSummary` (see Grounding). Clicking an imported repo opens it as its own independent workspace: its own tab set, never interleaved with another open repo's or with `studio`/`api`'s shared strip — a new `workspaceId` dimension on `TabRecord`, not a second `AppMode` value, so `studio`/`api` behave byte-identically to today (see Grounding). Two tab behaviors, both also net new: (1) VS Code-style preview tabs — a single click opens a file into one shared, replaceable preview slot; a double-click promotes it to a permanent tab that survives the next preview open; (2) a permanently pinned, unclosable, un-reorderable first tab reserved for the git graph (C9) — this phase builds the pinning mechanism and an honest placeholder view for that slot, C9 replaces the placeholder with the real graph. A new project tree lists every tracked/untracked-but-not-ignored file in the repository and opens any of them into a tab — not `ProjectTree.vue` (schema-object-specific, see Grounding). `monaco-editor` (net new to this repo) is the file viewer: its own bundled language-service workers (`editor.worker`/`typescript.worker`/`json.worker`/`css.worker`/`html.worker`) disabled and used strictly as a renderer — Monarch tokenizers for highlighting, definition/hover extension points reserved for C6 to wire — always `readOnly: true`, with no tab in this workspace ever gaining dirty-state, save, or commit machinery (the `definition` tab kind's existing no-badge shape is the precedent to mirror, per Grounding). This phase's own plan states the concrete mechanism for per-repo tab isolation, the Monaco bundling/worker story in detail, and which languages get a registered Monarch grammar versus falling back to plain text | Everything else in this chapter's UI (C6's diff tabs and navigation, C7's search results, C8's quick-open, C9's graph, C10's review layer) opens into this workspace — building the tab/tree/viewer shell first, with its real architectural gap (no per-repo tab isolation exists today) resolved here, avoids every later phase inventing its own partial version of it. Split from a single larger "C5" during this phase's own planning pass, which judged repo-import-and-tab-isolation and Monaco-integration too much for one coherent Sonnet implementation pass and one verification pass — this half is complete and usable on its own (import a repo, browse its tree, view a file, read-only) before C6 adds diffs and navigation on top of a shell already proven |
| **C6 Diff tabs and code navigation** | The half of the original single "C5" phase split out during that phase's own planning pass (see C5's row): Monaco's diff-editor widget as its own read-only tab (worktree-vs-HEAD from a file's changed status, opened from C5's project tree), the per-repository `codeindex` open/sync/watch lifecycle (reusing C1's own per-repository sync lock so the desktop app and a headless `bun run mcp:repo-map` instance never parse one repository twice), and Monaco's definition-provider/hover extension points wired to C2's `codegraph` package — including the byte-offset-to-UTF-16-column conversion C1's own plan named as this later phase's job. A cross-file jump opens its target as a preview tab in C5's workspace | Sequenced right after C5 since it completes what was originally scoped as one phase with it, but kept as its own row (and its own plan, its own verification pass) because its failure modes are unrelated to C5's tab-state rewrite — a worker/bundler/provider-registration surface, not a shared-state one — and deserves its own commit history and its own test pass against a shell C5 has already proven correct |
| **C7 Search: in-file and repository-wide, Go-native** | Two search surfaces over the code intelligence workspace: search within the currently-open file (Monaco's own find widget, scoped to the open buffer) and a repository-wide search panel implemented in Go — **no `ripgrep` subprocess**, per explicit correction. This phase's own planning pass picks the implementation: a hand-rolled walk-and-scan (reusing C1's or C8's own file-enumeration source, `bufio` plus stdlib `regexp`/substring matching, run concurrently across files) if that clears `CLAUDE.md`'s library-reuse bar on its own merits, or a well-maintained pure-Go search library if one earns its keep against hand-rolling it — the plan states which and why, the way C1 stated its tree-sitter binding choice. Matches stream back as they arrive rather than buffering a whole run, consistent with this app's "every operation exceeding ~150ms shows progress" invariant. A match click opens the file into C5's workspace as a preview tab, matching the convention C5 establishes | Independent of C2's graph — this search is text-based, not symbol-based — but depends on C5 existing as the thing a search result opens into |
| **C8 Quick Open: fuzzy file search (Cmd+P)** | A command-palette-style fuzzy file finder over the open repository's tracked/untracked-but-not-ignored files, opening the chosen file into C5's workspace as a preview tab (the same open convention C7's search results use). This repo already has one fuzzy-match precedent worth reusing or deliberately declining (`frontend/src/shortcuts/CommandPalette.vue` — commands, not files) and this phase's own planning pass states which existing file-listing source it reads from: C5's own project tree listing, or the same repository listing C1's parse pipeline already has to enumerate — reusing one of those avoids a second file-enumeration mechanism if its shape fits | Small and self-contained once C1's file enumeration and C5's file-opening exist; sequenced last among the editor-surface phases since it is the thinnest of the three and benefits most from the others already being in place |
| **C9 Git graph mounted natively, pinned per repo** | Mount `packages/git-ui`'s existing graph — the **exact same** Vue components the VS Code extension uses today (`CommitGrid.vue`, the graph/rowSvg/layout.worker geometry engine, branch/tag/stash/worktree/stack panels, search, undo), no reimplementation — into the permanently pinned first tab C5 reserved in every repository workspace, replacing C5's own honest placeholder (**except the code-review layer**, deferred to C10, below). File opens from the graph route into C5's Monaco viewer; diff opens route through C6's diff-tab mechanism — both as new tabs, instead of VS Code's native editor (see Grounding — that delegation has no in-app equivalent yet, which is exactly what C5/C6 built). Read-only holds here too, in tension with reusing components built for the extension's read-write use: `git-ui` also exposes stage/unstage, commit, discard and undo actions, and this phase's plan states concretely how each is disabled or hidden in the native surface — reusing a component is not reusing its write affordances. The transport question is this phase's own to answer: `git-ui`'s `bridge/client.ts` currently assumes the extension's own transport shape (a paired client token over `git.sock`, per `git_clients`'s own trust-store design, G1) — a query the native app makes to its *own* backend process needs the same `internal/gitrpc` handler table but not necessarily the same paired-client authentication the socket protocol exists to gate an external VS Code process behind; the plan states whether that is a second, in-process transport or the existing socket reused with a self-trusted client | Sequenced after C5 (the tab/workspace shell and pinned-tab mechanism it needs) and C6 (the diff-tab mechanism its own diff opens route through); C2/C8 remain optional inputs (jumping from a graph file row into go-to-definition, or quick-opening a file the graph just showed) rather than hard dependencies, so it can land as soon as C5+C6 are ready even if C2/C7/C8 slip |
| **C10 Code-review layer ported natively (last feature phase)** | Port `packages/git-ui`'s `components/review/` + `state/review*.ts` — the **exact same** Vue components the extension uses: inline comment threads over a diff, AI-review feedback surfaced via gutter icons on the affected lines, PR-review workflow — into the native workspace C9 established, once the rest of the chapter (the graph itself, C5's Monaco viewer and C6's diff view for rendering what a comment thread anchors to, C2's navigation) is already in place and proven. **Where this layer's panel actually lives in the workspace is an open design question, not settled here** — its own tab, a side panel beside the diff, or something else — the plan states what it tried and why it landed where it did. Gutter-icon anchoring reads Monaco's own decoration/glyph-margin extension points against a diff view's line mapping — no comment-anchoring-over-Monaco precedent exists in this repo, so this is this phase's own design surface. This phase's plan also states what changes versus the extension's own review surface — `apps/kira-studio-vscode/src/reviewView.ts`/`reviewComments.ts`/`reviewRanges.ts`/`reviewMarking.ts` currently host it there — and confirms the read-only constraint holds here too: viewing and reacting to review feedback, never writing code from this surface | Explicitly last among feature phases, per instruction: everything this layer needs (a mounted graph, a native diff viewer, real navigation, gutter/decoration wiring) is safer to build against once proven rather than co-developed with them |
| **C11 Code review, round 1** | `CLAUDE.md`'s standing "Code review" process, run once C1-C10 are complete: three Opus subagents in parallel, one per dimension (architecture/structure/maintainability/security; functional correctness/business logic; performance/resource efficiency), each reporting findings only, never fixing. Scope is **the full diff this chapter introduces** (this branch's base to its tip) as the primary target, per instruction — but a reviewer that notices a real issue outside that diff (in a file the chapter touches, or adjacent to one) reports and fixes it too, rather than staying artificially confined to the diff boundary. One sequential Sonnet subagent then fixes every finding (parallel only for a batch genuinely isolated from another), committing each fix individually. No findings document survives the round once fixed — the commit log is the record | `CLAUDE.md`'s own process, applied once the chapter's feature work is otherwise done, per its "on request" trigger — here, standing instruction to run it rather than a one-off ask |
| **C12 Code review, round 2** | The same three-dimension review plus fix cycle, repeated against the tree as C11's fixes actually left it — a fresh reading of current source, not a rerun against C11's summary. States plainly if a dimension finds nothing real this round rather than manufacturing a finding, per `CLAUDE.md`'s own rule for repeated rounds | `CLAUDE.md`'s "multiple passes means repeat the whole loop," applied here as two full rounds before the model change in C13 |
| **C13 Code review, round 3 (fable reviewers)** | Same three-dimension structure and scope as C11/C12, but the three parallel reviewing subagents run on the **fable** model instead of Opus, per explicit instruction — a second, differently-modeled pass over a tree two Opus rounds have already gone over, on the theory that a different reviewer model surfaces different findings. The fix step stays a Sonnet subagent, unchanged from C11/C12 | Last in the chapter: two same-model rounds first to converge on what one reviewer model consistently catches, then one differently-modeled round last to check what it doesn't |

## Out of scope for v1.5

- Any language/framework beyond the list C1 states — no C#, Ruby, PHP, etc., and no framework
  beyond React/Vue/Svelte/Angular, unless a later row explicitly adds one.
- Any write action anywhere in this chapter's native surface — no editing, no save, no
  stage/unstage/commit/discard/undo, no working-tree write of any kind, even where a reused
  `git-ui` component exposes one for the extension's own read-write use. This chapter is view,
  navigate and search only, never a second general-purpose code editor competing with CodeMirror's
  existing role elsewhere in the app (`docs/ARCHITECTURE.md`'s Stack table).
- Retrofitting `studio`/`api`'s own existing shared tab strip with per-connection isolation — C5
  adds per-repo tab isolation for this chapter's own workspace, it does not change how database/API
  connections share tabs today.
- A live-refreshing project file tree, and directory compaction (single-child-directory collapsing)
  in it — C5's tree refreshes on open and on an explicit action, not on every filesystem change.
- `references`/`implementations` navigation providers inside the Monaco workspace (C6 wires
  definition/hover only) — `codegraph` already answers both, a later phase registers them once it
  has a surface to render results in.
