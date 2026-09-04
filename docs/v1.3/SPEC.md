# Kira Studio — v1.3

v1.2 built the **Api** module — an HTTP/gRPC request client living beside the database client
behind a shared, modularized app shell (`docs/v1.2/SPEC.md`). This chapter's headline is a third
top-level mode: **Git**, a visual Git graph tool, sitting beside **Studio** and **Api** behind the
same custom title bar, left panel, and tab/content area that v1.2's P1 generalized.

Unlike Studio and Api, Git is not designed from scratch here. It is **brought in from a
previously-independent project**, "Kira Version", whose 86-commit history was imported into this
repository as the disjoint branch `origin/import/kira-version-vscode-kickoff`. That branch's
`docs/SPEC.md` is the authoritative description of the product and remains readable there; this
document does not restate it, it records what changes on the way in and how the work is phased
once it lands here.

## Where the source material stands

The imported project shipped its own P0–P4 and planned but never built its P5–P11. Read against
its own `docs/SPEC.md` §10, that means:

| Built there | Only planned there |
|---|---|
| Foundation, Bun workspaces, boundary lint rules, fixture-repo generator, perf/heap budget harness (its P0) | Commit detail pane: metadata, file tree, in-app unified diff (its P5) |
| Git driver: discovery, 2.38 version floor, spawn discipline, streaming NUL parser, cancellation, write queue, `cat-file --batch`, typed errors (its P1) | Refs, tags, branch/checkout with the pre-flight engine, revert, undo slot, conflicted-state banner (its P6) |
| History pipeline: paged long-lived `git log`, ref/status queries, lane layout in a worker, column-wise typed-array commit store with string interning (its P2) | Fetch/push/decomposed pull/force-push-with-lease (its P7) |
| Host bridge: the RPC transport, settings schema, theme token layer (its P3) | Stash, incl. the `merge-tree` pop-prediction engine (its P8) |
| Graph UI: the SlickGrid commit list, the SVG graph column, load-more, ref badges, keyboard nav, responsive breakpoints, visual-regression across four theme kinds (its P4) | Reset with per-mode consequence copy and reflog-backed undo (its P9) |
| Removal of a second (Electron) host once it left scope, with the port seam kept (its P4b) | Search: case/whole-word/regex toggles, commit/refs/both scope (its P10) |

So roughly the left-hand column is code to carry across, and roughly the right-hand column is
this chapter's own feature work — re-derived from that spec's §7, not invented fresh.

## What this chapter is about

- **A third mode, `git`.** `AppMode` gains `'git'`; the mode tab, left panel and tab/content area
  come from v1.2 P1's shared shell, exactly as Api's do. No fourth copy of the app chrome.
- **A host-agnostic package architecture, preserved rather than flattened.** The source project's
  load-bearing property is that its domain logic, its wire contract and its Vue UI compile and run
  with **no host present at all** — which is what let it swap an Electron host for a VS Code host
  as an addition rather than a rewrite. That property is kept here, and it is the reason this
  module lands as real workspace packages rather than as directories inside
  `apps/kira-studio/frontend/src/`.
- **A Node → Go port of the process-spawning half.** The source's `packages/git` is Node
  `child_process` plus hand-written porcelain parsers. It does not come across as JavaScript.
  It is **reimplemented in Go** as `apps/kira-studio/internal/gitclient`, spawning the user's own
  `git` binary through `os/exec` — the same hard constraint the source declared (no bundled git,
  no native bindings), and consistent with this repo's own established style of hand-rolling
  against a real spec rather than wrapping a library, as `internal/httpclient` and
  `internal/postman` already do.
- **A Wails host implementing the same ports.** Not a VS Code webview and not Electron: a bound
  `bridge.GitService` plus generated TS bindings, the same shape as `bridge.HttpService` /
  `bridge.CollectionsService` and `frontend/src/bridge/control.ts` already have, satisfying the
  same `Transport` interface the source's VS Code host satisfied.
- **The graph itself**, at the scale the source spec commits to: 100k+ commits, paged behind an
  explicit "Load more" (never infinite scroll), lane layout off the main thread, a viewport-bounded
  virtualized grid, and per-row SVG rather than a canvas.
- **Operations reachable from the graph** — fetch, pull, push, stash, branch, checkout, reset,
  revert, tags, search — each following the source's `pre-flight → confirm → execute → reconcile`
  shape, with `git merge-tree --write-tree` used to predict conflicts exactly rather than
  heuristically.

## The package architecture, and why it is packages

Three new workspace packages land at chapter kickoff, before any phase below runs. The root
`package.json`'s `workspaces` array gains `packages/*` — it previously covered only
`apps/*/frontend`, and today's `packages/shared` and `packages/db-fixtures` are **source-only**
directories reached through a `@shared/*` TypeScript path alias, with no `package.json`, no
independent build and no independent test. Those two are left exactly as they are; these are this
repository's first genuine Bun workspace packages, not a retrofit of the old ones.

| Package | From | What it is |
|---|---|---|
| `packages/git-core` | the source's `packages/core` | Pure domain logic: the column-wise typed-array commit store, sha table, string interner, graph lane assignment and edge building, the NUL record splitter, the settings schema, the pre-flight hazard analysis. Zero I/O, zero DOM, zero framework, zero host dependency |
| `packages/git-ipc` | the source's `packages/ipc` | The transport contract: the request/event/stream type map, the `Transport` interface every host implements, the codec (including `ArrayBuffer` transfer lists), and the one generic RPC endpoint carrying correlation, stream credits and cancellation |
| `packages/git-ui` | the source's `packages/ui` | The Vue 3 app: the SlickGrid commit grid, the SVG graph column, toolbar, repo/branch pickers, detail pane, diff view, search, stash/tag lists and the operation dialogs. Depends on `git-core` and `git-ipc` and on nothing else — never Wails, never `apps/kira-studio` |

**Why this is the right shape and not over-engineering.** The property being bought is the one
the source project proved out daily: a UI bundle that mounts against a mock bridge in a plain
browser with **no host present**, which is what makes host-agnostic UI behaviour testable
hermetically rather than only through the real app. This repository already has the mechanism for
that — `tests/ui/support/mockRuntime.ts` intercepts the real Wails runtime's bound calls against
a static `build:test` bundle — so the harness equivalent is an extension of existing machinery,
not a second test paradigm.

**This is the same standard v1.2's own P12 is now retrofitting onto the Api module.** That phase
extracts Api's frontend code into real workspace packages (`packages/api-core`, `packages/api-ui`,
or whatever its plan settles on) rather than a tidier directory, explicitly to match this chapter
(`docs/v1.2/SPEC.md`, "Studio/Http module boundary"). The two chapters should end up structurally
consistent: **Studio, Api and Git each a module whose non-shell code could be lifted into its own
app mechanically.** Git gets there by construction, since it arrives as packages; Api gets there
by P12's extraction. Where the two disagree on naming or layout, the later of the two to land
should conform rather than each inventing its own answer.

## Studio / Api / Git module boundary

v1.2's module-boundary rule applies unchanged and now covers three modules rather than two:
Git-specific frontend code lives under its own directories, Git-specific Go code stays in its own
packages (`internal/gitclient`, and `internal/bridge/git.go` as the one bound service), and **test
suites stay folder-separated per module even though one `test:ui` / `test:unit` command runs them
all**. A single test command covering all three modes is fine; a single test *file* covering two
of them is not. No phase below may merge Git and Studio (or Git and Api) code into one shared file
where a per-module file would do.

Git's own boundary is stronger than Api's, because the package split is a lint-checkable fact
rather than a convention: `git-core` and `git-ipc` depend on nothing; `git-ui` depends on those two
and on nothing else; **only `apps/kira-studio` depends on any of them, and none of them depends on
`apps/kira-studio`.** That direction is what the Go host implementation sits behind, and it is what
a future second host would sit behind too.

**Module separation does not mean reimplementing infrastructure per module.** P1 built a genuine
correlated-RPC-with-credits protocol in Go (`internal/bridge/gitstream.go`) to speak `git-ipc`'s
frame protocol server-side, because nothing in this codebase already had a Go implementation of
that shape — Studio's own `engine` stream (`internal/bridge/stream.go`) is a thin 43-line adapter
onto `adapterhost.Router`, a DB-specific page multiplexer with no correlation/credit/cancellation
concept at all, so there was genuinely nothing to reuse there. That is a correct instance of
building real new capability, not duplication. The thing to avoid is building *this same* generic
capability a **second** time once Api's own package split (P12, `docs/v1.2/SPEC.md`) or any later
module wants request/response-plus-streaming semantics of its own: the protocol-generic pieces —
the frame envelope, correlation, credit accounting, cancellation, encode/decode — belong in their
own shared package/module from the point a second consumer is foreseeable, not duplicated and not
deferred until that consumer actually shows up. Concretely, this chapter's own P1 gets revisited
(`plans/P1-host-and-go-git-client-iter2.md`) to split this out on both sides: on the Go side, the
generic frame-protocol server implementation moves out of `gitstream.go` into its own
Git-agnostic package, with `gitstream.go` reduced to the thin adapter wiring `gitclient.Client`
into it; on the TypeScript side, `packages/git-ipc`'s already-generic `rpc.ts`/`codec.ts`/
`transport.ts` (the RPC endpoint, correlation/credit/cancellation, the codec) move into their own
package that `git-ipc` depends on, leaving `git-ipc` holding only the Git-specific contract types
(`contract.ts`). Git-specific *domain* logic (discovery, the write queue, repo identity, the
porcelain parsers) stays exactly where it is — this is about not duplicating the transport
plumbing underneath, not about merging modules back together.

## What deliberately does not come across

- **`packages/host-vscode`.** Nothing here is a VS Code extension. Its ports, its webview HTML/CSP
  machinery, its `postMessage` transport and its own tests are all dropped, not adapted.
- **`packages/git` as TypeScript.** Its responsibilities move to Go wholesale (spawn discipline and
  env hygiene, discovery and version-floor enforcement, the persistent `cat-file --batch` process,
  the long-lived paged `git log` process, `.git` + worktree watching, the operations, and the
  porcelain parsers). Its ~43 recorded-git-output fixture files under `tests/fixtures/porcelain/`
  **do** come across — that corpus is real captured `git` output and is exactly the golden-corpus
  material this repo already leans on (see P4's Postman round-trip corpus in `internal/postman`).
  The fixtures are ported; the assertions over them are rewritten as Go tests.
- **The TypeScript ports layer.** The source's `packages/core/src/ports/*` — `ProcessRunner`,
  `FileWatcher`, `Dialogs`, `Storage`, `Theme`, `WorkspaceRoots`, `Logger` — exists so its *Node*
  host logic could reach VS Code APIs behind narrow interfaces. Here the host logic is Go, so that
  seam does not translate as TypeScript: its Go equivalent is interfaces inside `internal/gitclient`,
  which is also where this repo already keeps that kind of contract (`internal/adapters`). This is
  confirmed rather than assumed — the source's `packages/ui` imports **zero** ports from `core`
  (only `CommitStore`, `CommitRecord`, `DecorationRef`, the layout functions and constants, and the
  settings schema), so removing them costs the UI nothing. **The `Transport` seam, which is the
  load-bearing one, is preserved exactly.**
- **VS Code's injected theme.** `--vscode-*` custom properties and the `vscode-light` /
  `vscode-dark` / `vscode-high-contrast*` body classes are a webview mechanism with no analogue
  here. `git-ui`'s `--kv-*` token layer already carries literal fallbacks for every token — that is
  what makes it legible in the source's own host-free harness — so it renders standalone as-is at
  kickoff, and P3 below is where those tokens are repointed at this app's own design system
  (`docs/design/kira-design-system`, `theme/tokens.css`, `primitives.css`). The single indirection
  layer is precisely what makes that a one-file change rather than a sweep.
- **VS Code integration points** (command palette entries, SCM title button, status bar item) and
  `.vsix`/marketplace packaging. Git mode ships inside this app's existing DMG.

## Inherited constraints, to confirm rather than assume away

These come from the source project's own spec and are **carried, not silently dropped**. Each is
stated here so that a later phase changing one is a visible decision:

- **macOS only.** The source declared this at its §2.1.2 as a scope decision, not an architectural
  one, with platform-conditional code behind named strategies whose unimplemented platforms fail
  explicitly rather than misbehaving — today that is exactly one place, Git binary discovery. This
  repository is macOS-only too (`package.json`'s own description), so the constraint is inherited
  intact and `internal/gitclient`'s discovery keeps that named-strategy shape in Go.
- **The user's own Git, at 2.38 or newer — a hard floor, not a soft one.** No bundled binary, no
  native bindings. `git merge-tree --write-tree` (2.38) is what makes the checkout and stash-pop
  conflict predictions exact rather than heuristic, and maintaining a weaker second path would
  double the matrix to ship an experience worth less. Below the floor the app shows a single clear
  blocking state naming the detected version, the required version and the upgrade command.
- **No telemetry**, and **English only with no l10n infrastructure**. Both match this repository's
  existing posture; neither needs new machinery.
- **Interactive rebase is out of scope**, as it was there. The graph must still *model* an
  in-progress rebase so it can report and refuse rather than interfere.

## Phasing

Numbered from P1, the same way v1.1 and v1.2 each numbered from P1 rather than continuing the
previous chapter's list. The three packages themselves land at chapter kickoff, ahead of P1, in a
state that builds and typechecks but is wired into nothing — so P1 starts against real,
compiling packages rather than scaffolding them and using them in the same phase.

This decomposition is adapted from the source project's own 12-phase plan (its `docs/SPEC.md`
§10), rescoped for landing inside this app: its P0 is the kickoff scaffolding, its P1 and P3 fold
together into P1 here (one host, one transport, one driver), its P11 "ship a `.vsix`" is dropped
outright, and two closing rows are added to match what v1.2 does for its own module. As in every
chapter here, this is a starting decomposition, not a fixed contract — each row still gets its own
Opus-authored plan under `plans/` before implementation starts, per `AGENTS.md`.

| Phase | Deliverable | Why here |
|---|---|---|
| **P1 Kira Studio host: the Wails transport, the Go git client foundation, and the harness** | The three kickoff packages become a running module. **Go**: `internal/gitclient` with spawn discipline and env hygiene (`--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `-c core.quotepath=false`, NUL-delimited everything, never human-readable output), context-based cancellation, a per-repository write queue with a bounded concurrent read pool, git discovery behind a named per-platform strategy with only the macOS case implemented, the 2.38 version-floor block state, per-repo capability probing, and exit-code+stderr → typed error classification. **Bridge**: a bound `bridge.GitService` registered in `main.go` beside the existing fourteen, plus generated bindings. **Frontend**: a `Transport` implementation over those bindings satisfying `git-ipc`'s interface unchanged, and `'git'` joining `AppMode` and the mode registry so the third tab exists. **Tests**: the mock-bridge harness — `git-ui` mounted against a fake `Transport` with no Wails present, built on `tests/ui/support/mockRuntime.ts`'s existing interception rather than a second mechanism — plus Go unit tests for discovery, spawn hygiene and error classification | This is the phase that proves the whole premise, and nothing after it is worth building until it holds: that a Go/Wails backend can be a host for this architecture without `git-core`, `git-ipc` or `git-ui` changing. Doing the driver and the transport together (rather than as the source's separate P1 and P3) is right here because neither can be verified without the other — there is no VS Code extension host to run a Node driver inside, so the driver's first real consumer *is* the bridge. The harness lands here, not later, for the same reason the source put it in its P0: it is what makes every subsequent phase's UI behaviour testable hermetically, and retrofitting it after the UI exists means writing tests against whatever the UI already does |
| **P2 History pipeline: porcelain parsers in Go, paged `git log`, and the streamed commit store** | The porcelain parsers rewritten in Go — `log`, `for-each-ref`, `status --porcelain=v2`, `diff-tree`, `stash list`, `merge-tree` — with the source's ~43 recorded-output fixture files ported verbatim into a Go golden corpus and its parser assertions rewritten as Go tests against them. On top of them: the long-lived paged `git log` process (read a page, stop reading, let the OS pipe buffer apply backpressure, resume on demand) with `--skip` as the fallback path, the cheap `rev-list --count` remaining-count query, the persistent `cat-file --batch` process, and `.git` + worktree watching debounced into `refsChanged` / `worktreeChanged`. Chunks stream to the renderer over `git-ipc`'s existing stream mechanism into `git-core`'s column-wise typed-array store with string interning, unchanged from the source | The parsers and the paging belong together because the paging is what determines the parser's shape — an incremental NUL-splitting parser consuming a stream that never waits for process exit is a different thing from one parsing a buffer. Porting the fixture corpus in the same phase as the parsers is what makes the rewrite checkable: the Go parser is correct exactly when it reproduces the same structures from the same captured bytes the TypeScript one did, which is a far stronger claim than a fresh set of hand-written Go tests would support. Sequenced before any rendering so the grid in P3 is fed by the real pipeline rather than by a fixture that later has to be replaced |
| **P3 Graph UI: the commit grid, the SVG graph column, and the design-system retarget** | `git-ui`'s Vue shell mounted in the Git tab: the SlickGrid commit list driven from a `CustomDataView` over the typed-array store, the graph column as one small `<svg>` per row (segments grouped by lane colour into one `<path>` each, no canvas anywhere), message/author/date/sha columns with inline ref badges, the Load-more button showing its remaining count while preserving viewport and selection, selection, refresh, keyboard navigation and the responsive breakpoints. **Plus the theming retarget**: `git-ui`'s `--kv-*` token layer repointed from `--vscode-*` onto this app's own design tokens, and its icon usage onto the `@vscode/codicons` set this app already ships through `theme/CodiconIcon.vue`. Carries the source's own P4 discipline forward: a11y pass on the virtualized list, visual-regression coverage, and the scroll/frame budget | The first phase with something to look at, and the one where "the graph is a column, not an overlay" has to actually hold at 100k rows. The retarget lands here rather than at kickoff because it is a design decision about how Git mode should look inside *this* app, and it is cheapest to make while looking at the real rendered surface rather than at a token file. This repo already runs SlickGrid 5.20.0 and `@vscode/codicons` at the exact versions the source used, so the retarget is a token-mapping exercise, not a component rewrite. The perf/a11y/visual-regression rigor is inherited from the source's own P4 rather than invented — and this repository has its own precedent for it (`tests/ui/perf.spec.ts`, `budgets.spec.ts`) to build the Git-side budgets on |
| **P4 Commit detail: message, file tree, and the in-app diff** | The detail pane opened by clicking a row (and closed by clicking it again): subject and body with URL/issue linkification and parsed trailers, then a hierarchical collapsible file tree with per-file status, rename arrows and per-file `+adds/−dels` aggregated up directory rows, then the details block (full and short sha, clickable parent shas, author/committer with both timestamps, refs at this commit, signature status for the selected commit only). Clicking a file opens its diff for that commit in the in-app read-only unified view — the pane's primary interaction, not a secondary one — with a parent selector for merge commits, and binary/LFS files labelled rather than rendered as garbage. Blob content comes through P2's persistent `cat-file --batch` | Follows the grid immediately because it is the other half of reading history, and because it is the first consumer of `cat-file --batch` and `diff-tree` beyond the bulk walk — proving that per-commit lazy loading really does stay off the hot path. Sequenced before any mutating operation so that every later phase has a place to *show* what an operation is about to do |
| **P5 Refs, branches, tags, and the checkout pre-flight engine** | Branch and tag lists; create/switch/detach/delete/rename branch; the full tag surface (lightweight and annotated distinguished, version-aware sorting, create/delete/push/push-all/checkout, with the local-vs-remote deletion asymmetry stated rather than papered over); linked-worktree detection; revert including mandatory mainline-parent selection for merge commits; the in-progress/conflicted-state banner that detects `MERGE_HEAD`/`CHERRY_PICK_HEAD`/`REVERT_HEAD`/`rebase-*` and gates operations git would refuse anyway; and the checkout pre-flight engine proper — dirty set ∩ rewritten set, classified into clean-carry / blocked-by-tracked / blocked-by-untracked / blocked-by-in-progress-operation, computed before anything is spawned | The pre-flight engine is the feature that distinguishes this tool from a graph viewer, and it is pure logic over queried state — so it lives in `git-core` and is exhaustively unit-testable with no repository at all, which is why it is worth landing before the operations that consume it rather than alongside each one. Conflict *resolution* is explicitly not built (there is no merge editor to delegate to here, unlike the source's VS Code host) — the banner detects, surfaces, gates, and offers continue/abort, which is the fallback the source's own port was written for |
| **P6 Remote operations: fetch, push, and decomposed pull** | Fetch with prune and progress parsed from stderr's counting output; push with `--set-upstream` offered rather than silent, and `HookRejected` distinguished from `NonFastForward`; pull decomposed into an explicit fetch plus an explicit `merge --ff-only` / `merge` / `rebase` rather than ever running plain `git pull`, defaulting to the user's own `pull.rebase`/`pull.ff` config but always naming what it is about to run; force-push always passing an explicitly observed lease sha plus `--force-if-includes`, with plain `--force` behind a second confirmation and protected branches behind a typed confirmation rather than a refusal; opt-in background auto-fetch defaulting to off | Sequenced after the pre-flight engine because every one of these has a hazard to compute first, and after the detail pane because "the commits that will become unreachable" needs somewhere to be shown. The decomposition of pull is the reason this is a phase rather than three buttons: a graph tool that surprises you about whether it merged or rebased is worse than useless, and that is a design constraint on the whole surface, not a flag |
| **P7 Stash, and the `merge-tree` pop prediction** | Stash push (with `-u`, message and pathspec), list, show, apply/pop/drop/branch, stashes rendered as nodes in the graph itself rather than only in a side list, and the pop-prediction engine: predict a pop with `git merge-tree --write-tree --messages --name-only` using `stash^` as the merge base, which is exactly the three-way merge `git stash pop` performs, computed in the object database with no worktree writes. Wired into P5's blocked-checkout resolution so "stash and carry" is offered only when it will actually work, and stating plainly that a conflicting pop does **not** drop the stash | This is the single feature that most justifies the 2.38 floor, and it is what turns P5's "blocked" classification from a dead end into a resolution. Sequenced after both because it needs the pre-flight engine to plug into and the graph to render stash nodes in; sequenced before reset because stash-first is the primary alternative reset offers |
| **P8 Reset, and the reflog-backed undo slot** | Soft/mixed/hard reset from a commit, each with its own honest consequence copy (hard reset destroys uncommitted work and that is *not* recoverable; the commits left behind stay in the reflog for `gc.reflogExpire`), pre-flight dirty-file and departing-commit counts, a typed confirmation for hard-with-dirty with "stash first" offered as the primary alternative, disabled entirely during an in-progress operation, and the single-level undo slot completed — reset, branch delete, tag delete and stash drop each recording their recovery sha, with the limits stated in the UI rather than implied away | Last of the mutating operations because it is the most destructive and benefits from every safety mechanism the phases before it built. The undo slot is completed here rather than started here: P5 and P7 each seed it as they add a destructive operation, so arriving at this phase with an incomplete slot would be a visible omission rather than a silent one — which is the point of modelling it as a slot in `git-core` at all |
| **P9 Search** | One input with three independent persisted toggles (case-sensitive, whole word, regex) and a commits/refs/both scope selector defaulting to both. Commits match over subject, body, author and committer name/email and sha prefix — executed client-side over already-loaded commits for instant feedback *and* simultaneously handed to git for the not-yet-walked tail, so a commit from page 40 is findable without loading pages 1–39. Refs match local branches, remote branches and tags by name (tags also on annotation text), grouped and labelled by kind. Results highlight in place and navigate with Enter/Shift+Enter with a match count; an invalid regex reports inline as you type and never throws; a superseded query aborts its git process | Last of the feature phases because the hybrid client-side/git-backed design only makes sense once there is a loaded store to search client-side *and* a paged walk to search past — both of which are P2's, but neither of which is worth optimizing against until the surfaces that display results (P3's grid, P5's ref lists) exist to receive them. File-content pickaxe search (`-S`/`-G`) is explicitly not in this box; it is a different mental model |
| **P10 Git module UI check and improvement** | A dedicated pass over every Git-mode surface — graph, detail pane, diff view, ref/tag/stash lists, dialogs, empty and error states, the git-unavailable and version-floor block states — checked against the rest of this app's design system rather than against each phase's own styling, and brought consistent with Studio's and Api's spacing, type, colour and icon conventions. Tightened for dense, practical use. No new functionality | Directly mirrors v1.2's own P13 for the Api module, and sits in the same place in the list for the same reason: after the module is feature-complete so it polishes final surfaces, and before the review so that review reads the module in its finished state rather than one about to be restyled. P3's retarget establishes the token mapping; this phase is where the six phases of surfaces built on top of it are actually checked against it |
| **P11 Git module code review (2 rounds)** | Two rounds of `AGENTS.md`'s review process scoped to the Git module only — `packages/git-core`, `packages/git-ipc`, `packages/git-ui`, `internal/gitclient`, `internal/bridge/git.go`, and the Git half of the frontend — three parallel Opus subagents per round (architecture/security, functional correctness, performance), findings only, fixed sequentially | Mirrors v1.2's P14 exactly, for the same reason: a chapter that introduces a new Go package, a new bound service, three new workspace packages and a new rendering surface deserves a review scoped to that surface, run after it has stopped moving. Two rounds because the second catches what the first round's own fixes introduce |
