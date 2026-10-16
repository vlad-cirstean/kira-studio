# P70 — Update main docs for v1.5 and v1.6

Last plan of the v1.6 chapter. Brings `README.md`, `docs/ARCHITECTURE.md`,
`docs/DEV_ENVIRONMENT.md` and `CLAUDE.md` current for everything v1.5 (C1-C14) and v1.6
(P60-P69d) changed.

Documentation-accuracy pass, not a rewrite. Every item below is a specific wrong or missing
statement found by reading the current tree, with the current text quoted and the replacement
stated. Text that is already correct stays untouched, including text that reads oddly.

## 0. Chapter state, verified

Every v1.6 SPEC row landed on `v1.6`, checked against `git log`, not SPEC prose:

| Row | Landed | Evidence |
|---|---|---|
| P60 (a/b) | yes | `12ed8413`..`5c289f2e` — `e37578fd` MonacoHost, `ecc1fd89` console migration |
| P61 | yes | `14743f2c`..`cbc4a156` — `71c5212f` Wails beta.21 + Go 1.27.1 |
| P62 | yes | `caec8132` plan, `9f8afcb3`/`f9417ac8` blame layer |
| P63 | yes | landed via P65: `21108c91`..`6ed207ba` |
| P64 | yes | `7c7833e3` plan, `54e77579`/`11b7f56c`/`14f26528` |
| P64b | yes | `a4ff6f7e` plan, `d32e5449`/`e3349510`/`7dad78b3` |
| P64c | yes | `7377cba7` plan, `65f28162`/`f15309ca`/`05d57834` |
| P65 | yes | the A/B arms; MCP arm shipped as P63's commits above |
| P66 | yes | `38ef5276` plan, `99a78052`/`dea60962`/`1b7cef86` |
| P67 | yes | `87bdb961` plan, `b26acc59`/`b561acb1` |
| P67b | yes | `5681bf8f` plan, `f1bedaf1`/`c14be371`/`384b1753` |
| P67e | yes | `b89bafb8` plan, `7d2db500`/`3e7ac87d`/`5d970829` |
| P67f | yes | `cd1b92d2` plan, `1da60f68`/`7025a88b`/`ddd15b00`/`0bfef238` |
| P67c | yes | `742c7d94` plan, `1eae3f8b`/`e7e2c546`/`b1ddd2a0`/`ca013637` |
| P67d | yes | `96e9a959` plan, `83f9aaf1`/`623748fd`/`fc7b7b3d`/`cba6c6f7` |
| P68 | yes | fix pass `d396c1b5`..`6ecf6b59` |
| P68b | yes | `39629558` plan, `402a8fdf` fix |
| P69 | yes | fix pass `b412286b`..`13b9d107` |
| P69b | yes | `869d0374` plan, `fa4ab77b`/`752ffb83` |
| P69c | yes | `ab5b3953` plan, `84fb06f8`/`d2fab09f`/`71ac6d04` |
| P69d | yes | `612f1b3a` plan, `ad22273a`/`dd634743`/`fd4cf1fa`/`33205b96`/`630e30a1` |

**One genuinely open item exists, and it is not P70's scope.**
`docs/v1.6/mcp-repo-map-issues.md`'s P69c entry — `internal/repomap`'s
`TestDetachDrainsInFlightCall` fails under `-race` — is still marked Open and still reproduces on
current `v1.6` HEAD (`go test -race -run TestDetachDrainsInFlightCall -count=5
./internal/repomap/`, re-run during this planning pass: `race detected during execution of test`,
`attach_test.go:216` against `instance.go` inside the goroutine `attach.go:173` spawns). It is a
test-only race — the test's deferred restore of package-level `readyTimeout` races `Detach`'s own
drain goroutine — not a product defect, and it was found by running the suite, never by calling
the MCP server. P70 neither fixes it nor documents it as an app limitation; it needs its own row
if the chapter is to close with a clean `-race` run. Flagged, not absorbed.

**Everything else is landed.** Once P70's commits land, nothing in `docs/v1.6/SPEC.md` remains
unimplemented.

## 1. `README.md`

Outward-facing prose, the one file `CLAUDE.md`'s terse style exempts — keep normal prose here.

This file is the worst-drifted of the four: it still describes the repo as it stood at v1.3.
It never mentions the code intelligence module at all, and its git section asserts the opposite
of what the app now does.

### 1.1 Line 5-7 — the app is three modules, not two

Current:

> A native macOS workbench combining a visual database client (DataGrip/DBeaver class, ten database
> engines) and an HTTP/gRPC API client (Postman/Insomnia class) — built on Wails (Go) and Vue 3, one
> app you switch between with a mode button.

`AppMode` is `'studio' | 'api' | 'git'` (`packages/shared/domain/mode.ts`, P67b §4.1). Rewrite to
name three modules: the database client, the API client, and a git + code-intelligence workspace,
still one app switched with the mode button.

### 1.2 Line 11-15 — Status is two chapters behind

Current:

> The git client is the v1.3 chapter and is **headless**: the git backend runs inside this app, and
> its frontend is **Kira Version**, a VS Code extension bundled in the DMG.

Wrong as a present-tense claim. The backend is still headless in the sense that it is a Go
subsystem, but Kira Studio's own window now mounts a second frontend onto the identical backend
(v1.5 C10/C11), git is a peer `AppMode` (P67b), and the native mount writes (P67e).
`docs/ARCHITECTURE.md`'s Git module section already states all three correctly — this is the
summary that never followed.

Replacement: state that v1.5 added a native git + code-intelligence workspace inside the window,
that the VS Code extension remains a supported second frontend over the same backend, and that
v1.6 made Git a peer module and enabled git-write operations on the native surface. Name the
chapters: Studio v1.1, Api v1.2, git backend v1.3, polish v1.4, code intelligence v1.5, v1.6 the
current chapter.

### 1.3 Line 85 — CodeMirror is gone

Current:

> - **Cell editor** — a CodeMirror panel with format autodetect (JSON, XML, SQL, base64, hex, epoch,
>   ISO-8601, UUID, URL, CSV), manual override, and indented/compact beautify.

P60a migrated `CellEditorView` to `MonacoHost` (`a50c9b58`); P60b deleted
`editor/CodeMirrorHost.vue` and every `@codemirror/*` package. Replace "a CodeMirror panel" with
"a Monaco panel". This is the only CodeMirror mention left in `README.md` — confirmed by grep.

### 1.4 Line 94-95 — FK navigation gained a preview and an edit route (P67)

Current:

> - **PK/FK navigation** — jump from a key cell to referencing or referenced rows in a pre-filtered
>   new tab, driven by cached FK metadata (PostgreSQL/MariaDB).

P67 (`b26acc59`) put a read-only preview popover in front of the jump
(`views/grid/FkPreviewPopover.vue`), with two actions: *Open in new tab* (the old behaviour) and
*Edit this record*, which opens a pre-filtered tab on the referenced table with the caret landed
in edit mode. Add one clause covering the popover and the edit action. `docs/ARCHITECTURE.md`
line 45's SlickGrid row already documents this in full — README only needs the user-facing
sentence.

### 1.5 New section after "Api features" — code intelligence

v1.5's whole C1-C14 subsystem has no README presence. Add a **"Code intelligence features"**
section, matching the existing sections' bullet style and depth, covering what actually shipped:

- **Repository import** — a git repository imported beside a database connection, opening its own
  workspace with its own isolated tab set (C5).
- **Project tree and file viewer** — every tracked/untracked-but-not-ignored file, opened into
  Monaco, read-only; refreshes on open and on an explicit Refresh, not live (C5, and
  `ARCHITECTURE.md`'s Known open items).
- **Diff tabs** — worktree-vs-HEAD in Monaco's diff editor (C6).
- **Code navigation** — go-to-definition and hover over a tree-sitter code graph built in Go,
  cached in SQLite; Java, Python, JavaScript, TypeScript/TSX, Go, Rust, plus HTML/CSS/JSON/Svelte
  and Vue as an HTML container with per-block injection (C1/C2/C6). Say plainly that
  go-to-implementation returns nothing for Go (the Known open item), rather than implying parity.
- **Search** — in-file via Monaco's find widget, repository-wide in Go with streamed results, no
  `ripgrep` subprocess (C7).
- **Quick Open (⌘P)** — fuzzy file search over the open repository (C9).
- **Git graph, natively** — the same `packages/git-ui` graph the VS Code extension uses, mounted
  as each workspace's pinned first tab (C10), with the code-review layer (inline AI-feedback
  gutter icons, PR-review threads) beside it (C11).
- **Inline git blame** — a per-line annotation over the file viewer, toggled by
  `appearance.inlineBlame` (P62).
- **Markdown reading view** — a rendered-Markdown toggle beside the raw view (P67c).
- **Repo-map MCP server** — a local MCP server exposing the same code graph to an AI client, off
  by default, enabled from Settings → Code intelligence with per-repository access grants (C3,
  P67d). Say the command is shown before the Install button, since that is a deliberate product
  decision, not an implementation detail.

### 1.6 Line 144-151 — the Git features preamble is now false

Current:

> Git is the third module, and the only one that isn't in this window. The backend runs inside Kira
> Studio […] Kira Studio's own window gets no git mode, tab or panel; its only git-facing surfaces
> are a *Connected editors* pane and a *Git* section in Settings.

Every clause after the first is wrong. Git **is** in this window (C10/C11, P67b), it **does** have
a mode (`AppMode` `'git'`), and the window's git surfaces are no longer only those two panes.

Rewrite the preamble: the git backend runs inside Kira Studio and serves two frontends — the
native Git module in this window, and the Kira Version VS Code extension over
`~/.kira-studio/git.sock`. Keep the `.vsix`-ships-in-the-DMG sentence, which is still true. Retitle
the section "Git features" and note which of the listed capabilities are native, extension-only,
or both — the feature bullets below it (graph, detail/diffs, refs, pre-flight, remotes, stash,
review, search, worktrees, PR links, several editors at once) are all still accurate as
*backend* capabilities and need no per-bullet rewrite.

Add one bullet for P67e: the native mount performs fetch/pull/push/force-push, undo, restack,
stash and worktree operations, with a native credential prompt for HTTPS remotes; conflict
resolution, a worktree prepare script's shell execution, opening a worktree window and setting the
global git path stay refused on the native surface.

### 1.7 Line 212-215 — VS Code is no longer required for git

Current:

> - **For the git module:** [Git](https://git-scm.com) 2.38 or newer on `PATH`, and
>   [VS Code](https://code.visualstudio.com) 1.134+ to install the bundled *Kira Version* extension
>   into.

Git 2.38 is still the floor (`docs/DEV_ENVIRONMENT.md` and `ARCHITECTURE.md` agree). VS Code is now
optional — the native module needs none. Mark it optional, alongside the `gh` CLI that already is.
`^1.134.0` is still the extension's own `engines.vscode`, so the version number stays.

### 1.8 Line 281-285 — the app-data list is incomplete

Current:

> **App data:** the app keeps `kira.db`, `logs/`, the git module's own `review.db`, and its
> `git.sock`/`git.sock.lock` under `~/.kira-studio/`.

Missing three things this repo now writes there, confirmed by listing a live `KIRA_HOME`:
`codeindex.db` (plus its `-wal`/`-shm`), the per-repository sync flocks
`codeindex-sync-<12 hex>.lock`, and the repo-map MCP tokens `mcp-repo-map-*-token.json`. Add them.
The `KIRA_HOME` sentence after it is still correct and stays.

### 1.9 Line 349-369 — the layout block is missing five Go packages and points at the wrong chapter

In the fenced layout block:

- `docs                 architecture, performance, packaging, design system; docs/v1.3 is the live record`
  → `docs/v1.6 is the live record`.
- Add `apps/kira-studio/cmd/kira-repo-map` — the headless repo-map MCP binary, the repo's only
  second `main` package besides `cmd/g1measure`.
- The `apps/kira-studio/internal` line ("adapters, storage, IPC bridge, tree service, connection
  state, ops, git") predates five packages that now exist: `codeparse`, `codeindex`, `codegraph`,
  `codeworkspace`, `repomap` (plus `mcpauth`/`mcpinstall` and `appupdate`). Extend the line to name
  the code-intelligence group and the update checker.
- `packages/git-ui     the git webview UI (graph panel, review panel), hosted by the extension`
  → hosted by the extension **and** by the native Git module (C10/C11).

### 1.10 Line 371-374 and 385-394 — the chapter pointers skip v1.4, v1.5 and v1.6

Line 372-374 sends a reader to `docs/v1.3/SPEC.md` "for the git chapter" as if it were current, and
the Documentation list (385-394) jumps from `docs/v1.3/` straight to `docs/v1.2/`. `docs/v1.4/`,
`docs/v1.5/` and `docs/v1.6/` all exist with their own `README.md`, `SPEC.md` and `plans/`.

Add all three, newest first, and mark v1.6 as the live record. Fix the one wrong range while
there: line 387 says v1.3 is "G1 through G33"; `docs/v1.3/SPEC.md`'s last row is **G34**.

### 1.11 Line 404-418 — "Not shipped" contradicts two shipped features

Current:

> On the git side: **no git mode, tab or panel inside Kira Studio's own window** — the module is
> headless by design, and the transport layer is built so an embedded UI would be additive rather
> than a rework.

Delete this paragraph's first clause outright — C10/C11 built exactly the embedded UI it predicts,
and P67b gave it a mode. Keep the second sentence about the extension not being published to the
Marketplace/OpenVSX, which is still true.

Also in the same section:

> **Auto-update is deliberately absent and verified as such** — see
> [`docs/PACKAGING.md`](docs/PACKAGING.md) §7.

Still true and stays — P66 shipped a *notification banner*, not an updater, and
`bun run verify:packaging` still asserts no auto-update behaviour (`944ca948`). Add one clause so
the two facts do not read as a contradiction: the app now checks GitHub for a newer release and
shows a status-bar banner linking to the releases page, and downloads/installs nothing.

Check "DDL editing" in the not-shipped list against `project/SchemaDialog.vue` before touching it —
that dialog is a DDL *document* the user pastes for the language service, not DDL execution
against a server, so the entry is most likely still correct. Leave it if so; this plan does not
assume a change here.

## 2. `docs/ARCHITECTURE.md`

Far better maintained than `README.md` — the Stack table, the Git module section, the Storage
section's C1/C2/C3 coverage, P66's update checker and P67's FK preview are all current. Drift is
concentrated in specific stale passages, several of which now contradict the same file's own
Stack table.

### 2.1 Line 8 — points at the wrong file for environment notes

Current:

> Environment-specific operational notes (running Docker in Claude Code's own sandbox, working
> around a proxy block, which env var a headless Linux box needs) belong in `CLAUDE.md`, not here.

`docs/DEV_ENVIRONMENT.md` exists and owns exactly those; `CLAUDE.md` lines 40-42 say so itself.
Replace `` `CLAUDE.md` `` with `` `docs/DEV_ENVIRONMENT.md` ``.

### 2.2 Line 11-12 — chapter list stops at v1.3

Current:

> Where this file and any chapter's `SPEC.md` disagree (`docs/v1/`, `docs/v1.1/`, `docs/v1.2/`,
> `docs/v1.3/`), **this file is authoritative for behavior**

Add `docs/v1.4/`, `docs/v1.5/`, `docs/v1.6/`.

### 2.3 Line 17-20 — Related documents omits `docs/DEV_ENVIRONMENT.md`

The block lists `PERF.md`, `PACKAGING.md`, the design system and `CLAUDE.md`. Add
`docs/DEV_ENVIRONMENT.md`, whose one-line gloss is already written at the top of that file.

### 2.4 Line 452 — the `~/.kira-studio/` summary is stale

Current:

> `~/.kira-studio/` (dir `0700`), containing `kira.db` (`0600`) and `logs/`.

Reads as exhaustive and is not: the same section later documents `review.db` and `codeindex.db`,
and the directory also holds `git.sock`/`git.sock.lock`, `codeindex-sync-*.lock` and
`mcp-repo-map-*-token.json`. Extend the sentence to name all of them, with the existing
per-file paragraphs unchanged below it. Keep this consistent with README §1.8's list.

### 2.5 Line 1102-1106 — describes a placeholder that no longer exists, and names the wrong phase

Current:

> This phase builds the mechanism and an honest placeholder view for that slot
> (`views/repo/RepoGraphView.vue`, *"The commit graph for this repository is not available yet"* —
> no stubbed handler, no `TODO`); **C9 replaces exactly one `TAB_VIEWS['repo-graph']` line** with
> the real `packages/git-ui` mount.

Two errors. (a) The placeholder is gone — grep finds no `"not available yet"` string anywhere in
the frontend, and `workbench/tabViews.ts:37` maps `'repo-graph'` to `RepoGraphTabView`, the real
mount. (b) The git-graph phase is **C10**, not C9; C9 is quick open. The pre-C8-insertion
numbering survived here (v1.5 SPEC's own note: C8 pushed every later phase up by one).

Rewrite in past tense: C5 built the pinned-slot mechanism behind a placeholder, and C10 replaced
it with the `packages/git-ui` mount. Also update the identifier — the constant is `TAB_VIEWS` in
`workbench/tabViews.ts`; verify the current spelling before quoting it.

While in this paragraph, grep the whole file for other survivors of the pre-C8 numbering
(`C8` used for quick open, `C9` for the graph, `C10` for the review layer) and fix each hit. This
planning pass found one; a sweep is cheap and the file is 3 833 lines.

### 2.6 Line 1852 — names a deleted component

Current:

> The module mounts 43 `theme/primitives/*` imports across eleven distinct Vue components, plus
> `CodiconIcon`, `CodeMirrorHost.vue`, `editor/theme`, `beautify`/`format`/`clipboard`, and
> `views/shared/viewOp.ts`

`editor/CodeMirrorHost.vue` was deleted in P60b; the Api module now mounts `editor/MonacoHost.vue`.
Replace the name. The surrounding argument (why `packages/api-ui` does not exist) is unaffected.

The counts in the same sentence — "43", "eleven distinct Vue components", "90 of this renderer's
287 source files" — were measured at P12 and the renderer has grown by two chapters since.
Re-measure all three and update, or, if re-measuring is judged out of proportion, reword to state
them as the figures measured at P12 rather than as current. Do not leave them asserted as present
tense without checking.

### 2.7 Line 2223-2233 — the response-diff dialog is on Monaco, not `@codemirror/merge`

Current:

> **Comparing two entries reaches for `@codemirror/merge` for the one thing it's actually built for
> — the body — and a plain keyed comparison for headers, not the same algorithm twice (P8).**
> `ResponseDiffDialog.vue` mounts a real `MergeView` […] The library is a lazy chunk
> (`views/httprequest/mergeEntry.ts`, the same one-line dynamic-`import()` entry-file shape as
> `sqlFormatterEntry.ts` […]), fetched only the first time anyone presses **Compare**

P60a moved this dialog onto Monaco's diff editor and deleted the dependency (`6bc45255`). The same
file's own line 29 already says so: "`@codemirror/merge`'s own former chunk
(`views/httprequest/mergeEntry.ts`, P8) is gone". This paragraph directly contradicts it.

Rewrite: keep the whole argument, which is unchanged — Monaco's diff editor does the body, a keyed
name comparison does the headers, and the headers are still not run through a text diff. Replace
the library name, the `MergeView` mount and the `mergeEntry.ts` lazy-chunk sentence with Monaco's
diff editor reached through the same shared `loadMonaco()` boundary every other editor surface
uses. Verify `ResponseDiffDialog.vue`'s current implementation before writing the replacement
rather than inferring it from the commit subject.

### 2.8 Line 2300-2320 — the SQL language service no longer walks a Lezer tree

Two hits in the same passage:

> a user-pasted DDL document (`connection_ddl`, below), parsed via `@codemirror/lang-sql`'s own
> per-dialect Lezer parser, still wins wholesale the moment it declares any table

> Only when all three are empty does a console fall back to `@codemirror/lang-sql`'s own bare
> keyword completion, unchanged from before P18.

P60b replaced that parse tree with `packages/shared/domain/sql-tokens.ts`, and the keyword
vocabulary with `packages/shared/domain/sql-keywords.ts` — documented correctly at line 34 of this
same file, contradicted here. Replace both references. The layering argument (pasted DDL beats
metadata cache beats tree node cache beats bare keywords) is unchanged and stays verbatim.

### 2.9 Line 3084-3092 — a stale mechanism in the floating-UI audit

Current:

> a native `title` attribute, a CodeMirror `hoverTooltip` (whose container defaults to the editor's
> own DOM node unless `parent: document.body` is set explicitly, and which carries its own hardcoded
> `z-index` uncoordinated with this app's `--kira-z-tooltip` token), and any bespoke click-point
> popup are each their own path.

The mechanism is now Monaco's hover widget, and P60a hit the identical failure mode — `789fc4c7`,
"actually reparent Monaco hover/suggest widgets to `document.body`" — so the point survives
intact with the name changed. P67c then themed Monaco's menu/suggest/list widgets from the Kira
palette (`e7e2c546`), which is the `z-index`/token half of the same sentence. Rewrite naming
Monaco, citing both commits' mechanisms, and keep the audit's conclusion ("A module is not clear
because one of its mechanisms is") word for word.

### 2.10 Code intelligence has no heading of its own

`grep -n "^#\{1,3\} "` returns 24 headings; none of them names code intelligence, `codeindex`,
`codegraph`, `repomap` or the native code workspace. The content is all there and is good — it
sits inside `## Storage` (roughly lines 863-1220) because it began as "a third SQLite file". A
reader scanning the heading list finds `## Git module (v1.3)` but nothing for the subsystem v1.5
was entirely about.

Fix with headings only, no prose moved and no content rewritten: add `### Code parsing and the
code graph (C1/C2)`, `### The repo-map MCP server (C3, P64-P69d)` and `### The native code
workspace (C5-C9)` above the paragraph blocks that already cover each, inside `## Storage` where
they live. If those paragraphs turn out not to sit in three contiguous runs, add whatever subset
does sit contiguously and say so in the commit message — do not reorder paragraphs to make the
headings fit. Restructuring `ARCHITECTURE.md` is not this phase's job.

### 2.11 Known open items — one duplicate, and stale entries to verify

The section's own rule (`CLAUDE.md`, and the section's own preamble) is to delete an item the
moment it is resolved.

**Delete outright — duplicated.** "No standalone merge or rebase operation exists anywhere in this
stack" appears twice: once cited to P67e §7, once at the very end cited to P67b §1.5, inside the
"C14's performance review" block where it does not even belong (it is a missing feature, not a
performance finding). Keep the P67e-cited entry, which is the later and more precise of the two,
and delete the trailing duplicate.

**Delete — verified resolved.** "`internal/codeindex/watch.go`'s `Watcher.Close()` doesn't cancel
an in-flight full `Sync`". `watch.go:56-60` now carries a `ctx` field whose own comment names this
exact finding as fixed: *"never `context.Background()` (Group 1d: that left `Close()` blocking
synchronously on an in-flight rescan `Sync` with no way to notice cancellation)"*, and `fire()`
(`:161-177`) selects on `ctx.Done()` around both the semaphore acquire and the `Sync`. P69's fix
pass closed it.

**Verify, then delete or keep, each of these — this planning pass did not settle them.** Each one
is a single targeted read; do not carry any of them forward on the strength of the prose alone:

- "The initial-sync goroutine in `codeworkspace/session.go`/`repomap/server.go` isn't joined
  before `Index.Close`/`store.Close()`." Strong evidence it is fixed: `repomap/instance.go` now has
  a `syncDone` channel closed by `runInitialSync` (`:59`/`:84`/`:194`/`:211`) and `server.go:240`
  calls `inst.inflight.Wait()`; `codeworkspace/session.go:222-224`'s `Close` doc says it "cancels
  its own sync". Confirm the `codeworkspace` half joins as well as cancels before deleting.
- "A `Session.EnsureIndex` vs `Close` race can leak a watcher goroutine" — check
  `codeworkspace/session.go:121-180` and `:222-245` against the current locking.
- "Watcher writes arriving during the initial sync's one large transaction can be dropped after a
  5-second busy-timeout on a very large repo (unmeasured, theoretical)." `f15309ca` added
  `SQLITE_BUSY` retry to `codeindex` batch writes and `store.go:149-152` documents the measurement.
  Likely narrowed rather than closed — rewrite it to what is actually still true, or delete it.

**Verified still open — leave unchanged.** Checked live during this planning pass:

- "`review.open`'s pending-target map entry is never cleared when consumed via the live-event
  path." Still true: `repo/git/hostHandlers.ts:350` sets the map and emits `review.target`, and
  only `takePendingReviewTarget` (`:50-56`) ever drains it.
- "`loadComments` … swallows a failed `review.comment.list` request into an empty list with no
  retry banner." Still true: `views/repo/reviewDecorations.ts:380`'s
  `.catch(() => ({ at: …, comments: [] }))`.
- "No debounce on the quick-open palette's keystroke handler." Still true: `repo/QuickOpen.vue`
  has three `watch(` calls and no debounce, while `repo/RepoFileTree.vue:27-56` has the project
  tree's own.

**One path correction.** The performance block says "`repo/state/fileTree.ts`'s tree-filter
computed has per-row reactive dependency tracking". The path is right
(`frontend/src/repo/state/fileTree.ts`) but verify whether P67b's nav reorg or P68's
`b35366c1` changed the finding itself before keeping it.

Finally, the three `C14's … review:` block headers describe findings deliberately deferred out of
v1.5. Two full Opus review rounds (P68, P69) have since run over the same tree. Whatever survives
verification should stay, but retitle the blocks so they read as open items rather than as a
round's minutes — `CLAUDE.md` forbids a running narrative of what each round found.

## 3. `docs/DEV_ENVIRONMENT.md`

### 3.1 Line 288-293 — a quirk P67d resolved, still documented as current

Current:

> - **The embedded instance needs a real git repository at the app process's own working directory**
>   (C3 §3.2) — `wails3 task dev` run from this repository's own root resolves correctly; a `go build
>   -tags server` boot proof (above) run from anywhere else won't have one to find, and the Code
>   intelligence tab will show the "no repository found" error rather than a command.

This is precisely the bug P67d existed to fix. `docs/v1.6/SPEC.md`'s P67d row names the same error
string as the defect, and `77da65fa`/`fc7b7b3d`/`623748fd`/`cba6c6f7` made the toggle general: one
embedded `repomap.Server` serves however many imported repositories the user grants access to,
with no working-directory requirement at all.

Replace the bullet: the embedded instance no longer needs a repository at the process's working
directory; enabling the Code intelligence toggle starts the server, and each imported repository
is granted or revoked individually in that tab. Keep the final sentence — the headless path
(`bun run mcp:repo-map --repo <path>`) is still how you point the server at an arbitrary checkout
from this environment.

### 3.2 Line 272-277 — the port is not always 8765

Current:

> - **Register the real `claude` CLI against it** with the exact command the process prints, e.g.
>   `claude mcp add --transport http --scope user kira-repo-map http://127.0.0.1:8765/mcp --header
>   "Authorization: Bearer <token>"`

The bullet says "the exact command the process prints", which is right, but the example's
hardcoded port invites copying. `internal/repomap/http.go:31-38` binds `DefaultPort` (8765,
`server.go:48`) and **falls back to an OS-assigned ephemeral port** when it is taken — its own
comment says so. Reproduced during this planning pass: one instance bound `8765`, a second bound
`http://127.0.0.1:46717/mcp`, in the same container minutes apart. This container routinely has a
repo-map instance already running, so the fallback is the normal case here, not an edge case.

Add one sentence: read host and port off the startup banner every time; 8765 is only the first
choice, and a second concurrent instance gets an ephemeral port. Keep the example, marked as
illustrative.

### 3.3 Same section — token reuse has a sharp edge worth one line

`mcpauth` stores only a salted hash (`${KIRA_HOME}/mcp-repo-map-<slug>-token.json`), so a restart
prints *"Using this repository's existing token"* and no token. Hit during this planning pass: a
session that did not record the token when it was first printed cannot recover it, and a
mismatched bearer answers `401 invalid token` with no hint that the token is the problem.
`CLAUDE.md` documents the mint-a-fresh-one recipe; this file should note the failure mode it
fixes — delete that repository's token file and restart, then capture the printed token
immediately. One bullet, beside the existing registration bullets.

### 3.4 Line 146 — heading range is stale

`## The git module — running and testing it here (G1-G29)`. `docs/v1.3/SPEC.md`'s last row is
**G34**. Fix the range. The section's content is still accurate — re-read it once to confirm the
native module (C10/C11, P67b, P67e) needs nothing added here, since every bullet is about running
Go tests, the socket, the watcher and the extension's own suites, none of which P67b changed.

### 3.5 Line 254 — the repo-map section heading should carry its real phase span

`## repo-map MCP server — running and registering it in this environment (C3)`. The section's
content now spans C3, C8 (source lines), P64c (build/index timings) and P67d (§3.1 above). Widen
the parenthetical to `(C3, updated C8/P64c/P67d)`, matching how this file already annotates its
other sections (`P50, updated P57, backend moved to Go P58f`).

### 3.6 Confirm, do not change without checking

- Line 261-267's "~34s cold cgo rebuild" and "a full cold `Sync` of this repository itself is a few
  seconds" are P64c's own measured numbers. Re-run or leave; do not silently adjust.
- Line 278-283's C8 source-line bullet is still accurate — `find_definition`'s live output during
  this planning pass carried its indented source line, and `omitSource` is still accepted.
- Line 42's Docker heading still names `packages/db-fixtures/`, which still exists
  (`fixtures/`, `support/`). Correct, leave it.

## 4. `CLAUDE.md`

Process file. Four items, all small; the file's structure is right.

### 4.1 Line 49 — points at the previous chapter

Current:

> - Each phase (the current chapter's `SPEC.md` phasing table — `docs/v1.5/` today) needs an
>   Opus-authored plan committed under that chapter's `plans/` before implementation starts

`docs/v1.6/` is the live chapter, and this same file's own repo-map section (line 196) already says
`docs/v1.6/` today. Self-inconsistent. Change to `docs/v1.6/`.

### 4.2 Line 88-93 — cites a deleted dependency as a standing example

Current:

> This repo already relies on CodeMirror, zod, sql-formatter and SlickGrid rather than
> reimplementing them.

CodeMirror is gone (P60b). Worse as an example than as a fact: the rule is "reach for a library
before hand-rolling", and P60b hand-rolled a SQL tokenizer to replace
`@codemirror/lang-sql`'s Lezer tree. Replace `CodeMirror` with `Monaco` in the list.

Consider — implementer's call, one line either way — adding P60b as the named precedent for the
rule's own exception clause, which currently cites only "spelling-preserving timestamp
re-encoding": `packages/shared/domain/sql-tokens.ts` earned its keep against a real requirement
(the console's language service needed a parse tree after the dependency carrying it was removed
app-wide), which is exactly the shape the rule asks a decliner to name. Keep it to one clause;
this file's own rule is to stay lean.

### 4.3 Line 167 and 177 — hardcoded port, same issue as §3.2

Both the `claude mcp add` step and the `curl` recipe write `http://127.0.0.1:8765/mcp`. Step 2
already says the server "prints its own registration command", so the fix is one clause on step 3
and one on step 4: use the host and port from the startup banner; 8765 is the first choice and a
second concurrent instance lands on an ephemeral port. Do not remove the literal from the `curl`
block — a runnable example is the point — but mark it as the banner's value, not a constant.

### 4.4 Line 196-199 — wrapping damaged by an append

Current:

> **Log what dogfooding finds** in the current chapter's own `mcp-repo-map-issues.md` (`docs/v1.6/`
> today). Trivial (config, registration,
> wiring): fix inline, log one line.

The second line breaks after four words. Cosmetic, one reflow to the file's ~100-column width.
No wording change.

### 4.5 Verified correct — leave alone

- "the eight tools" (line 170) and the eight names listed at 151-152 and 186-188. Confirmed against
  a live `tools/list` during this planning pass: exactly eight — `find_definition`,
  `find_implementations`, `find_references`, `list_repos`, `outline_file`, `read_symbol`,
  `search_files`, `search_symbols`. C3 shipped six; P64 added `read_symbol`, P67d added
  `list_repos`. The count is current — the drift the SPEC row anticipated here does not exist.
- The multi-repo `repo` argument paragraph (154-156) matches P67d.
- Line 119's "the deleted `packages/db-fixtures/*.spec.ts` files" — the directory still holds
  `fixtures/` and `support/` and no `*.spec.ts`. Accurate as written.

## 5. Dogfooding

This planning pass used the repo-map MCP server over the HTTP/JSON-RPC path `CLAUDE.md` §4
describes (`tools/list`, `find_definition` with a `file` + `symbol` locator). Both answered
correctly: `find_definition` for `Close` scoped to
`apps/kira-studio/internal/codeindex/watch.go` returned the single right hit with its source line,
no cross-file collision. **No new non-trivial repo-map finding.**

Two operational frictions, both trivial and both already covered by edits above rather than by a
log entry: the ephemeral-port fallback (§3.2, §4.3) and the unrecoverable hashed token (§3.3).
Log each as a one-line Trivial entry in `docs/v1.6/mcp-repo-map-issues.md` per that file's own
process section, in the same commit as the doc fix they motivated.

`docs/v1.6/mcp-repo-map-issues.md`'s one **Open** entry (§0) stays open and untouched. P70 does
not fix it and does not close it.

## 6. Verification

No code changes, so no test suite gates this phase. Instead:

1. `bun run lint` — Biome covers Markdown formatting in this repo; run it before each commit.
2. Every file path, symbol name, line reference and commit SHA quoted in a replacement must be
   re-checked against the tree at the moment it is written, not copied from this plan. This plan
   was written against `1140d602`; a path can move.
3. Grep sweeps after the edits, each expected to return nothing outside a deliberate historical
   citation: `-i codemirror`, `-i lezer`, `lang-sql`, `MergeView`, `mergeEntry`.
4. `grep -n "8765"` across the four files — every remaining hit must sit beside the
   read-it-off-the-banner sentence.
5. Read `README.md` start to finish once as a newcomer would. It is the only file here whose
   failure mode is "technically accurate, still misleading", and it takes the largest edit.

## 7. Explicitly not in this phase

- `docs/PERF.md` and `docs/PACKAGING.md`. The SPEC row names four files; these are not among them.
  P60b (`f89bc0d4`) and P66 (`944ca948`) already updated them.
- Any code change. If a doc fix requires reading source to state something correctly, read it —
  but if the *source* turns out wrong, log it and leave it. P70 does not fix code.
- Restructuring `ARCHITECTURE.md`. §2.10 adds three headings over paragraphs that already exist and
  moves nothing.
- The `TestDetachDrainsInFlightCall` `-race` failure (§0).
- Retro-editing `docs/v1.5/SPEC.md` or `docs/v1.6/SPEC.md`. Both are kept as originally written,
  per each chapter's own `README.md`.

## 8. Commit list

One commit per file, in this order — smallest and most mechanical first, so the large `README.md`
diff lands against already-corrected references:

1. `docs(P70): point CLAUDE.md at the live chapter, Monaco, and the banner's port` — §4.
2. `docs(P70): correct the repo-map and git sections in DEV_ENVIRONMENT.md` — §3, plus the two
   Trivial dogfooding log lines from §5.
3. `docs(P70): fix ARCHITECTURE.md's stale CodeMirror, phase-numbering and app-data claims` — §2.1
   through §2.9.
4. `docs(P70): give code intelligence its own headings in ARCHITECTURE.md` — §2.10.
5. `docs(P70): prune resolved and duplicated Known open items` — §2.11.
6. `docs(P70): bring README.md current for the git and code-intelligence modules` — §1.

Splitting 3-5 keeps the Known-open-items verification (§2.11, the one step with real judgement in
it) reviewable on its own rather than buried in a large prose diff.
