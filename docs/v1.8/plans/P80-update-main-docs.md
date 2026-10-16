# P80 — Update main docs for v1.8

Last content phase of the v1.8 chapter (P81 fixes flaky tests after it). Brings `README.md`,
`docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md` and `CLAUDE.md` current for everything v1.8
(P71-P79) shipped.

Documentation-accuracy pass, not a rewrite. Every item below is a specific wrong or missing
statement found by reading the current tree, with the current text quoted and the replacement
stated. Text that is already correct stays untouched, including text that reads oddly.

Same bar v1.6's P70 (`docs/v1.6/plans/P70-main-docs-update.md`) and v1.7's M8
(`docs/v1.7/plans/M8-main-docs-update.md`) used — read the current tree, don't trust prose,
including `docs/v1.8/SPEC.md`'s own result sections and this plan's. Several P71-P78 facts were
changed again by P79's six fix batches; where that happened it is called out below. This plan was
written against `16dd1db1`.

## 0. Chapter state, verified

Every v1.8 SPEC row's disposition, checked against `git log` on this branch (`b39f53d6..HEAD`, the
rebase base being v1.7's own tip), not SPEC prose:

| Row | Landed | Evidence |
|---|---|---|
| P71 | yes | `64463e0d`..`edc83cfd` — `state/tabIncognito.ts`, `HttpSendArgs.Incognito` |
| P72 | yes | `ed550d39` (RepoPicker.vue deleted)..`8b346fc3` (settings moved app-wide) |
| P73 | yes | `4c1a741e`..`ea539a39` |
| P74 | yes | `679f508f`..`89ee3cc5` (the last two are the follow-up contract/allowlist fixes) |
| P75 | yes | `b5c40f47`..`c426acec` |
| P76 | yes | `1eae573a`..`ee340945` |
| P77 | yes | `3a2b4ca5`..`2ab14e00` |
| P78 | yes | `21db4135`..`52ce834f` |
| P79 | yes | six merge commits `33e17f94`(A)/`b9540811`(B)/`2d513a8c`(C)/`5fe2f47b`(D)/batch E direct/`7daab7d2`(F), plus the regression fix `eab3047e` |
| P80 | this plan | — |
| P81 | not started | filed by P79's verification pass; independent of this row |

**Three doc edits already landed inside the chapter — do not redo them.** Confirmed by
`git log b39f53d6..HEAD -- docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md README.md`:

- `2bc1b4e2` rewrote `ARCHITECTURE.md`'s preview-slot paragraph (`previewIdByWorkspace` →
  `previewIdsByWorkspace`, "one entry per workspace" → "a cohort per workspace") for P74 §5.2.
- `31316559` added `DEV_ENVIRONMENT.md`'s "A fresh worktree fails `bun run typecheck`" bullet.
- `9fc528af` added `ARCHITECTURE.md`'s Known-open-item for Go implementation search missing a type
  that satisfies an interface purely through promoted (embedded) methods (P79 batch C's own
  finding). **It is still true** — `methodsets.go`'s forward candidate discovery is still seeded
  from literal method declarations — so §2.10 keeps it and only re-words its neighbour.

`README.md` was never touched during the chapter. It takes the largest edit.

**Two genuinely open items exist that are not this plan's scope.**
`docs/v1.8/mcp-repo-map-issues.md` carries two **Open** non-trivial entries (P72's
`find_references` returning "no references found" for a non-call read of a TypeScript `const`, and
P73's narrowing of it to a function referenced as a value — one root cause, two entries). Both
still reproduce; neither has a fix row anywhere in `docs/v1.8/SPEC.md`. P80 neither fixes nor
closes them, and does **not** file them in `ARCHITECTURE.md`'s Known open items — that section is
for the shipped app's limitations, and this is a dev-tool defect with its own log. Flagged here so
the chapter's close is honest about it, exactly as P70's §0 flagged its own `-race` failure.

**Everything else is landed.** Once P80's commits land, nothing in `docs/v1.8/SPEC.md` remains
unimplemented except P81.

## 1. `README.md`

Outward-facing prose, the one file `CLAUDE.md`'s terse style exempts — keep normal prose here.

M8 left this file in good shape for v1.7. Its drift is a mix: three chapter pointers, one flatly
wrong capability claim (Go implementations), and four additive gaps.

### 1.1 Status bullet — v1.7 is named as the current chapter

Current (lines 18-21):

> v1.7 (the current chapter) added a second local MCP server that exposes a chosen
> connection's data to an AI client, under per-connection read/write/DDL permissions, with
> per-column PII masking.

Replace `v1.7 (the current chapter)` with plain `v1.7`, and append one sentence for v1.8 as the
current chapter. Keep it to the user-visible shape, not a phase list: incognito request tabs in the
Api module, a reworked git graph/commit-detail/review surface with GitHub PR status inline, a
status-bar git-blame readout, and code navigation gaining find-references, go-to-implementation and
modifier-click. Keep the "The VS Code extension remains a fully supported second frontend" and
"Expect bugs and breaking changes" sentences that follow, unchanged.

### 1.2 Api features — incognito has no bullet

P71's incognito mode is a headline user-facing feature with no README presence. Add one bullet to
**Api features**, after the **Response history** bullet (line 151-152), in the surrounding style:

- **Incognito request tabs** — a per-tab toggle from the tab's own context menu (the tab shows an
  eye-closed marker while on). Nothing from that tab's session persists: no tab row saved, no
  response-history entry, no op-log row, no environment/variable write. The tab still renders,
  sends and shows responses normally, and a running incognito operation still appears live in the
  Operations panel — it is simply never written down.

Verify each clause before writing it: the flag store and its "suppress, don't mirror" posture are
`state/tabIncognito.ts`; the menu entry and its label/icon are `state/tabKinds.ts`'s
`incognitoMenuExtras` (`icon: 'eye-closed'`, label flips to "Turn off incognito"); the strip marker
is `workbench/panels/TabStrip.vue`'s `.tab-incognito`/`is-incognito`; the Go half is
`bridge/http.go`/`bridge/grpc.go`'s `Incognito bool` guarding `ResponseHistoryRepo.Record`, and
`internal/oplog/wire.go`'s own `incognito` flag (live event emitted, row not persisted). **Do not
write that incognito is a browser-style private window** — nothing in this app is browser-local;
the whole point is that the frontend withholds writes that would otherwise cross the bridge.

The 4-row auto-growing inputs (P71's second item) get **no bullet** — a textarea that grows to four
rows is below this file's bullet bar, and adding one would be padding.

### 1.3 Studio features — the Settings bullet is missing two leaves

Current (line 133-136), the group list:

> Appearance (font family/size, row density, word wrap, row coloring), Data
> (default page size), Cache (L2 byte budget, hit rate, clear caches), Advanced (op-log retention,
> expensive-query row threshold).

P72 moved two git-graph settings app-wide and P79 batch A made both genuinely work end to end.
Read off `packages/shared/domain/settings.ts` before writing: `appearance.dateFormat`
(`'relative' | 'absolute'`, default `relative`) and `advanced.gitLogLevel`
(`'off' | 'error' | 'warn' | 'info' | 'debug'`, default `info`). Add "commit date format" to the
Appearance list and "git log level" to the Advanced list. One clause each, no new bullet.

### 1.4 Code intelligence features — the Go go-to-implementation claim is now false

Current (lines 165-169):

> - **Code navigation** — go-to-definition and hover, backed by a tree-sitter code graph built in Go
>   and cached in SQLite; covers Java, Python, JavaScript, TypeScript/TSX, Go and Rust, plus
>   HTML/CSS/JSON/Svelte and Vue (parsed as an HTML container with per-block injection). Go-to-
>   implementation returns nothing for Go specifically — interfaces there are structural, and the
>   index doesn't yet capture a method's receiver type.

The last sentence is exactly what P78 closed. Rewrite the bullet to cover what the tree now does,
each clause read off source:

- Keep the first sentence's language list verbatim — unchanged.
- Add **find-references and go-to-implementation**, both registered in
  `views/repo/navigation.ts` (`registerReferenceProvider`/`registerImplementationProvider`) and
  rendered through Monaco's own peek UI (`gotoLocation.multipleReferences`/`multipleImplementations`
  are `'peek'` in both `RepoFileView.vue` and `RepoDiffView.vue`; definitions stay `'goto'`).
- Add **Cmd/Ctrl+click navigates**, with its cross-file link preview.
- Say plainly what Go implementations are and are not: a **method-set comparison by method name,
  following embedding**, never a signature comparison and never real type inference — so a result
  is a strong structural match, not a proof. That is the honest reading of
  `internal/codegraph/methodsets.go` (`Confidence` is always `Scoped`; the rule strings are
  `implementationsOf.goMethodSet` and `…goMethodSet.promoted`), and it is what the status-bar
  readout itself says ("method set, signatures not compared").

Then add **one new bullet** after it, for the status-bar readout P78 §7.3 shipped — it is a visible
surface, not an internal detail:

- **Navigation readout** — a status-bar item summarising the last references/implementations query
  (e.g. "3 references · 2 unattributed"), cleared when the active tab changes.

Verify the exact wording of both readouts against `views/repo/navigation.ts` and
`state/navStatus.ts` rather than copying the examples above.

### 1.5 Code intelligence features — inline blame now has a status-bar half

Current (line 176-177):

> - **Inline git blame** — a per-line annotation over the file viewer, toggled by an Appearance
>   setting.

Still true, and the setting still gates only the inline annotation. P76 added a second, separate
surface. Extend this bullet (not a new one — same feature, two renderers): the status bar also
shows the cursor line's author, relative date and commit summary, **regardless of that setting**,
and clicking it reveals the commit in the graph tab. Read `RepoFileView.vue`'s controller creation
(`blameable`, which is `gitRepoId !== undefined && rev === null`), `state/blameStatus.ts` and
`StatusBar.vue`'s `data-testid="blame-status"` item before writing it, and state the
revision-pinned exception only if it survives that read: a file tab pinned to a historical revision
shows no blame at all, because `blame.line` only ever blames the working tree.

### 1.6 Git features — three additive clauses

The preamble and every existing bullet are still accurate as backend capabilities. Three bullets
need a clause each; nothing here needs a rewrite.

- **Commit detail and diffs** (line 227-228). Add: opening a commit's changes opens **every**
  changed file, as one replaceable preview cohort rather than a dozen permanent tabs
  (`state/tabs.ts`'s `previewIdsByWorkspace`, P74 §5.2; a cohort tab promotes to permanent on the
  same double-click convention the file tree already uses).
- **GitHub PR links** (line 256-259). The "resolved per commit" sentence predates this chapter and
  stays. Add: a commit's PR now renders **inline in the detail panel** with its open/closed/merged
  state, and the link opens in the OS browser — never an embedded webview and never a real
  `<a href>` (every PR surface is a `<button>` through the host's own external-open capability).
  Add that **GitHub Enterprise hosts work**: the host check is `gitsession.IsGitHubHost`, which
  accepts `github.com` plus any host `gh`'s own discovery has authenticated against, rather than a
  hardcoded literal (P79 batch B). Do not claim a GHES feature this app does not have — the change
  is only that a GHES repo's PR URL composes and validates at all.
- **Worktrees and stacked branches** (line 253-255). Add: **Create worktree** is now offered from
  the row context menu on a branch, a remote branch and a commit row, seeded from that row
  (`rowMenuModel.ts`'s `createWorktreeHere`, `state/worktrees.ts`'s `WorktreeCreateSeed`) — the same
  create machinery the worktree list already used, not a second path.

Also add **one new bullet** to this section for P77, placed next to the refs bullet — the
branches/stashes redesign is a real navigational change a user sees first:

- **One tabbed picker for refs and working state** — branches, tags, stashes, worktrees and stacks
  fold into five tabs behind one filter box, with a live per-tab match count (so a query typed on
  one tab still hints a match on another), HEAD and any branch checked out in another worktree
  pinned to the top, the rest ranked by recency, a per-list "Show more" step, and
  arrow-key/Home/End/Enter roaming from the filter box down into the rows.

Verify against `packages/git-ui/src/components/pickerModel.ts` (`filterPickerInput` /
`orderAndCapTab`, `capWithPins`, `capSteps`) and `BranchPicker.vue`'s keyboard handler before
writing; in particular confirm the five tab names and that tags/stash-stack/stacks deliberately
keep their own orderings rather than being re-ranked by recency.

### 1.7 Review polish — check, then probably leave

The **Branch review** bullet (line 244-247) says "Range-level marking happens in VS Code's own diff
editor." Read `packages/git-ui/src/components/FileTree.vue` (P75's `<input type="checkbox">` with
its `indeterminate` state) and `views/repo/reviewDecorations.ts` before touching it: P75 changed the
*file*-level control and the reviewed-tint behaviour, not where *range*-level marking happens. If
the sentence is still true as written, leave it — this plan does not assume a change here. If a
clause is worth adding at all, it is only that a partially-reviewed file shows an indeterminate
checkbox and a fully-reviewed file's row tint clears.

### 1.8 Tests section — one new webview interaction spec

Current (line 386-388):

> `interaction` covers the graph columns, the file tree, the review panel and the shared
> floating-UI geometry.

`apps/kira-studio-vscode/tests/interaction/` gained exactly one file this chapter,
`branch-picker.spec.ts` (verified against `git ls-tree b39f53d6`). Add "the branch/tag/stash/
worktree/stack picker" to that list. Nothing else in the Tests section changed.

### 1.9 Layout block and chapter pointers — three v1.7-as-live claims

- The fenced layout block's `docs` line: `docs/v1.7 is the live record` → `docs/v1.8`.
- Line 446-453: point the "live chapter" link at `docs/v1.8/SPEC.md`, and move v1.7 into the
  "Earlier chapters, oldest first" list after v1.6, with a one-word gloss matching the others'
  style (the database MCP server).
- The Documentation list (line 464-471): add a `docs/v1.8/` entry above the v1.7 one, marked **the
  live chapter**, glossed as Api incognito mode, the git module's graph/detail/review/picker rework
  and the code-navigation additions; demote the v1.7 entry to "the completed database-MCP chapter's
  own phasing record", keeping its existing gloss text otherwise intact. `docs/v1.8/README.md`
  exists — confirmed — so the `(see …/README.md)` parenthetical stays honest.

The `apps/kira-studio/internal` line in the layout block needs **no** edit: no new `internal/`
package landed this chapter (`internal/codegraph/methodsets.go` and `internal/bridge/link.go` are
new files in packages the line already names).

### 1.10 Verified correct — leave alone

Each checked during this planning pass; none is a change:

- Line 5-8's three-module intro. `AppMode` is still `'studio' | 'api' | 'git'`.
- The **App data** paragraph (line 353-359). No new file lands under `~/.kira-studio/` this
  chapter — incognito is in-memory only and adds no path, and no migration ran.
- The Requirements bullets. Git's 2.38 floor and the optional `gh` CLI are unchanged.
- The **Not shipped** list. Nothing in P71-P79 ships anything it names, and the auto-update
  sentence is untouched.
- Line 270-272's "hard-locked to the same contract version" note. Still exactly right — the number
  moved 35 → 39 this chapter, and the README deliberately names no number.

## 2. `docs/ARCHITECTURE.md`

Well maintained, and three of its paragraphs were already updated mid-chapter (§0). The drift left
is concentrated: two paragraphs that now assert the opposite of the tree (Go implementations, the
blame status bar), two stale counts, and three genuinely new facts with no home (incognito, the
external-link capability, P78's Go method sets).

### 2.1 Line 11-13 — the chapter list stops at v1.7

Add `docs/v1.8/` to the "Where this file and any chapter's `SPEC.md` disagree" list.

### 2.2 Line 985 (Code parsing and the code graph) — `ImplementationsOf` answers Go now

Current, the closing clause of the `ImplementationsOf` paragraph:

> Rust has no containing symbol to recover at all, so every matching reference *is*
> the impl block's own location, reported directly; Go returns nothing (Known open items, below).

Replace the Go clause with what P78 built, read off `internal/codegraph/methodsets.go` and
`implementations.go`:

- Go is answered **structurally**, by method set, because Go interfaces are structural — there is
  no `implements` keyword to recover.
- `methodSet(ctx, typeName, depth)` assembles a type's methods from ordinary stored rows and walks
  embedding (a struct's embedded field, an interface's `type_elem`) to a depth cap of **8**, with a
  cycle guard so mutual embedding terminates.
- Candidate discovery is seeded by `rarestGoMethodName` — the wanted method with the fewest
  `FindSymbolsByName` rows — an accepted bounded-cost heuristic. Say so plainly, and cross-reference
  the Known open item §2.10 keeps: a type that owns the seeded method *only* through promotion is
  invisible to the forward search.
- Matching is **by method name only, never by signature**. Confidence is always `Scoped`; the rule
  strings are `implementationsOf.goMethodSet` / `…goMethodSet.promoted`. No case claims `Exact`.
- The reverse direction (`goInterfacesSatisfiedBy`) unions candidates over **every** name in the
  concrete type's method set, not one rarest name — P79 batch C's fix; seeding from one name is
  sound only in the forward direction.
- A depth-cap/cycle-guard **truncated** result is not memoised: `methodSet` returns a `truncated`
  bool threaded through every call site, and the memo write is gated on it, so a truncated answer
  never poisons a later unrelated lookup (also P79 batch C).

State explicitly that none of this added an edge table or a schema column — the whole point of
`P78`'s shape is that it stays inside `codegraph.go`'s own "no edge table, ever" rule: every query
is a function over rows, evaluated fresh per call, with nothing derived cached across calls. That
sentence already exists two paragraphs above; this one should name it rather than restate it.

### 2.3 Same section — the stored evidence changed, so two nearby statements need narrowing

- The "**Stated plainly, the graph's own honest limits**" paragraph opens with *"two same-named
  methods on unrelated types are indistinguishable (no reference carries a receiver, no symbol
  carries a type)"*. The first half is no longer true for Go: `queries/go/p78_method_sets.scm`
  stores a `receiver` reference per method declaration. Narrow the claim to the languages it still
  holds for and name the Go exception, including `resolve.go`'s seventh tiebreak, `sameReceiver`,
  which **demotes rather than filters** a candidate on a different receiver type and is computed
  only when the reference site itself sits inside a Go method. P79 batch C reordered it to run
  *after* `filterTier` narrows the candidate set — mention that only if the paragraph already talks
  about cost; otherwise leave the ordering out as an implementation detail.
- The per-language-family **scope-unit table**'s Go row currently reads "An unexported name
  (lower-case first rune) never reaches tier 2". Still true — add the receiver tiebreak to that
  cell only if it fits in one clause; a second sentence in a table cell is worse than a pointer to
  the paragraph above.
- The `codeindex` schema paragraph says "**Schema version is 2 as of C2**". Still true — verified:
  P78 added no migration. `reference.kind` is unconstrained `TEXT`, and `0002_c2_reference_name_
  range.sql`'s own comment was extended in place to list the three new kinds (`field`, `receiver`,
  `embed`). Add one clause saying new reference kinds need no migration by construction, and that
  the new repo-authored query file flows into `meta.parser_fingerprint` automatically (the
  fingerprint already hashes every query file's bytes, so a stale index rebuilds itself). Do **not**
  say the schema version moved.
- `queries.go`'s `Provenance` table is named in the Stack table (line 51) as "the current,
  authoritative list of every repo-authored query file". Still true, and `p78_method_sets.scm` is
  registered there — nothing to change. Confirm, don't edit.

### 2.4 `### The native code workspace (C5-C9)` — the navigation paragraphs predate P78

Three edits in the `Definitions`/provider block (around lines 1284-1300):

(a) The `gotoLocation.multipleDefinitions` sentence currently justifies `'goto'` like this:

> standalone Monaco's peek preview resolves a candidate through `ITextModelService`, which in the
> standalone build only finds already-created models, so a cross-file candidate with no open tab
> would render an empty preview pane

That gap is **closed**. `views/repo/textModels.ts` (new, P78 §1.4) installs a `kira-repo`-aware
`ITextModelService` at Monaco bootstrap, resolving a tab-owned URI through `mod.editor.getModel`
and an unopened `kira-repo` URI by reading the file over `codeWorkspaceReadFile` and routing it
through the same `getOrCreateModel` cache a later tab open reuses. Rewrite the sentence: the
standalone service's "already-open models only" behaviour was the real cause of the missing
modifier-click underline and preview, it is now replaced, and `'goto'` for definitions is kept as a
deliberate preference (the hover already lists every candidate) rather than as a workaround.

(b) Add the two new providers to the "**One provider pair answers both hover and go-to-definition**"
bullet, or split a second bullet beside it — implementer's call, one is fine. Cover: both new
providers use the same scheme-scoped `LanguageFilter`; `codegraph.Site` gained a `Confidence` field
so a bare `Location[]` isn't the only thing crossing; `internal/codeworkspace/nav.go` gained
`References` and `Implementations`, with `References` deliberately never early-returning on an empty
`Sites` list (`Total`/`Truncated`/`Unattributed` can carry a real reading when every occurrence is
unattributed); `bridge/codeworkspace.go` exposes both, `Implementations` reusing
`CodeWorkspaceDefinitionArgs`. P79 batch C extracted the three handlers' shared
`resolveQueryPoint`/`resolvePosition` helpers, including the symlink-containment guard — worth one
clause, because that guard is security-relevant and a reader should know it is now in one place.

(c) Add a short bullet for the preview-model registry, which is a real lifecycle fact:
`textModels.ts` keeps a capped LRU (`PREVIEW_MODEL_LIMIT`, 40) of models created with no owning tab,
refcounts live holders so an open peek's model is never disposed under it (P79 batch E — the
returned `dispose()` used to be a no-op), and a preview promoted into a real tab leaves the registry
rather than being evicted.

(d) The hover-markdown sentence says each target's `Rule`/`Confidence` is printed on every line,
under a blanket *"Name-resolved, not type-resolved"* disclaimer. `navigation.ts` now swaps that line
for *"Receiver-matched (Go) — signatures are not compared."* when every target resolved via
`sameReceiver`. One clause.

### 2.5 `### Git graph in the native workspace (C10)` — the mount is now kept alive

Add one bullet (placement: after the "second, in-process Wails stream" paragraph, before the write
boundary — the write boundary is a security argument and should not be interrupted). Read
`workbench/panels/MainView.vue`, `views/repo/RepoGraphView.vue` and
`packages/git-ui/src/graphVisibility.ts` before writing:

- `MainView.vue` wraps the view in a `KeepAlive` with an explicit `include` (never blanket), so a
  tab switch away and back keeps the computed layout, scroll position, loaded rows and session —
  P72's fix for the graph fully reloading on every focus. The component's `name` is what makes
  `include` match at all.
- A backgrounded `KeepAlive`'d graph must not keep paying for work nobody can see: `graphVisibility
  .ts` provides a per-mount `GRAPH_VISIBLE_KEY` that `CommitGrid.vue` reads, deferring a
  generation-bump rebuild (layout worker plus SlickGrid column/row rebuild) until the grid is
  visible again. Not provided by any other `mount()` caller, so the VS Code host and this package's
  own tests are unchanged.
- State the regression this shape produced and how it was closed, because it is exactly the kind of
  thing a future change re-opens: the same host resize was handled twice (synchronously by the
  `detailOpen` watcher, asynchronously by `ResizeObserver`), and the second pass could detach a DOM
  node mid-measurement. Fixed by a `lastRebuiltHostWidth` dedup plus keying the KeepAlive skip off
  the real `graphVisible` signal instead of inferring backgrounded-ness from a 0×0 read
  (`eab3047e`).

Also worth one clause in the same section, read off `state/pr.ts` and
`packages/git-core/src/store/commitStore.ts`: PR ancestry is rebuilt with a **base cutoff** — each
PR's `baseRef` is resolved locally through `CommitStore.rowOfBranchTip` (a decoration scan, no new
RPC) and its ancestors excluded, so a PR badge no longer tags nearly the whole loaded history behind
any PR branch; and a burst of individually-resolving PR branches coalesces into one ancestry rebuild
per tick rather than one each (P79 batch D). This is user-visible (which commits show a PR icon), not
an internal tidy-up, which is why it earns a clause.

### 2.6 `### Code review, ported natively (C11)` — three P75 facts

Add to the existing **Monaco layer** paragraph (do not start a new subsection):

- A comment thread's view zone carries `z-index: 10`. Monaco 0.56.0 appends `.view-zones` before
  `.view-lines` inside `.lines-content`, and `.view-lines` carries `position: absolute; z-index:
  auto` — a later positioned sibling at `z-index: auto` loses every hit test to it, which is why the
  compose zone rendered but was unclickable. The same fix applies to the pre-existing error-banner
  zone's Retry button. State the value's provenance (it is VS Code's own value for its view-zone
  widgets), and that the zone's height is corrected once after mount from a real `scrollHeight`
  measurement rather than left at its 120px starting guess.
- A fully-reviewed file's whole-line tint is skipped: `paint()` guards on
  `coverage({start: 1, end: lineCount}, reviewedRanges) === 'full'`, reusing the helper the per-hunk
  branch beside it already calls. Per-hunk glyphs and the partial-review overview ruler are
  unchanged. Both hosts have the same guard (`views/repo/reviewDecorations.ts` here,
  `reviewMarking.ts` in the extension).
- The file tree's mark-reviewed control is a real `<input type="checkbox">` with a genuine
  `indeterminate` state for a partial review (its own codicon-dash glyph, not a third colour on a
  two-state control), moved to the row's leading edge so the whole tree keeps one aligned column.
  It is `click.prevent` — the server's answer is the control's only state, so an optimistic native
  toggle would contradict it for the round trip.

And one contract-level fact, which belongs beside the `review.*`-allowlist paragraph rather than in
the Monaco one: "Open in graph" from a review row used to be a `command:` URI, a VS Code webview
escape hatch with no handler in Kira Studio's Wails webview at all. It is now a real host-answered
request, `graph.revealCommit` (`{repoId, sha} -> {revealed}`), answered locally by both hosts and
never reaching the Go server — same class as `review.open`, so it needs no `gitstream.go` allowlist
entry. The blame status item's click reuses this exact request rather than adding a second one.

### 2.7 `### Git blame, inline (P62)` — the "why not the status bar" paragraph is now wrong

Current:

> The status bar was the extension's own surface for this, but
> `workbench/StatusBar.vue`'s own LAW 14 reserves its left readout for "where is the caret", never a
> fact about the line under it — porting the widget literally would mean breaking that law or wiring
> a per-view caret readout first, a separate, unrelated deliverable.

P76 shipped the status-bar widget, and did it a third way the paragraph does not anticipate: a
**sibling** left-side item, not the caret readout — `StatusBar.vue`'s own comment says so in place
(`"a sibling fact, not the caret-status slot above — that readout stays unwired"`). Rewrite the
paragraph in past tense: P62 declined the status bar for LAW 14's reason; P76 satisfied the same law
by adding its own item instead of taking over the caret slot. Keep the whole-file gutter-blame
paragraph after it verbatim — still true, still not built.

Three further edits in this section, each read off source first:

- **The controller moved.** `views/repo/blameLine.ts` (new) owns the `blame.line` request, debounce,
  dedupe, per-mount cache and cancellation; `blameAnnotation.ts` keeps only the Monaco decoration/
  hover/reveal rendering and is driven by the controller. The request-shape paragraph currently
  attributes all of that to `blameAnnotation.ts` — repoint it. P79 batch E added a cap to the
  per-mount cache and clears `inFlight` on settle; mention the cap only, not the bug.
- **Two surfaces, one setting.** `RepoFileView.vue` creates the controller whenever `blameable`,
  regardless of `appearance.inlineBlame`; the setting attaches or detaches only the inline
  renderer. The status-bar item publishes through `state/blameStatus.ts`, an owner-token store
  mirroring `cacheStats.ts`/`appMetrics.ts` so `workbench/` never imports `views/repo/`.
- **`blameable` gained a revision guard.** `gitRepoId !== undefined && rev === null` — P74's
  revision-pinned `repo-file` tabs read through `file.read`, never the worktree, and `blame.line`
  only ever blames the working tree, so a pinned tab must show no blame rather than the wrong blame.
- The paragraph ending *"`transport.ts` gains one new export, `emitUiAction`, because …
  `blameAnnotation.ts` is a Monaco-layer module"* no longer describes a live caller: P75's rewrite
  routed the reveal through `graph.revealCommit` instead, and `emitUiAction`/
  `localEmittersByCodeRepoId` were deliberately kept as a general-purpose primitive with no caller
  on that path. Either narrow the sentence to past tense or delete its causal clause — verify
  `transport.ts`'s current exports and callers before choosing.
- The section's opening sentence, *"`ContractVersion` stays 35 on both sides and `internal/bridge/
  gitstream.go`'s allowlist is unchanged"*, reads as present tense and is now false on both halves
  (39, and the allowlist gained `pr.browserUrl`). Scope it to P62 explicitly ("P62 bumped neither…")
  so it stays a true statement about that phase.

### 2.8 Two stale counts, both one grep away

- Line ~3037, the `gitrpc` package row: **"46 methods, `app.init` through `worktree.prepare`"**.
  Already stale before this chapter and one method staler now (`pr.browserUrl`). Recount from
  `internal/gitrpc/handlers.go`'s own dispatch switch at the moment of writing — note that
  `graph.stream` is a stream, not a request, so say which you counted — and replace the number.
- Line ~3220-3223, in the C10 write-boundary paragraph: **"Of the 55 methods `internal/gitrpc`'s
  `Router.ForConn` dispatches, the allowlist now admits 52"**. Both numbers move by one:
  `pr.browserUrl` is a new Go-served method *and* a new allowlist entry (its own comment in
  `internal/bridge/gitstream.go` says "a plain read … same shape as `commit.resolvePr`/
  `branch.resolvePr` just above"). Recount both from source, keep "Exactly three stay refused"
  — `worktree.prepare`/`worktree.cancelPrepare`/`settings.setGitPath` are unchanged, verified.

### 2.9 Three genuinely new facts with no home

**(a) Incognito request tabs (P71).** No heading, no paragraph, no grep hit for `incognito` anywhere
in this file. Add a short block inside `## UI architecture`, beside the tab-registry/`state/tabs.ts`
material (around line 1795-1815) rather than as a new top-level section — it is a property of the
tab system, not a subsystem. Cover, each read off source:

- The flag is per-tab and in-memory only (`state/tabIncognito.ts`'s `incognitoState.ids`), exactly
  like `tabsState.hydrated`/`previewIdsByWorkspace`. No schema change; a restored session has
  nothing to restore because an incognito tab was never saved.
- Its own module, not a field on `tabsState`, purely to avoid a cycle — `tabKinds.ts` needs to read
  it for the context-menu entry and `tabs.ts` already imports `tabKinds.ts`.
- The design is **suppress, don't mirror**: one flag consulted at each write site, not a parallel
  non-persisted store. Quote the standing rule the module's own header states, because it binds
  future phases: any new bridge write reachable from a request tab must consult `isIncognito` first.
- Turning it **on** flushes the tab's existing row immediately (a registered listener, so the
  dependency direction stays one-way); turning it **off** also saves — P79 batch E's fix, since
  only the on-transition used to. Closing a tab drops the flag through the same
  `registerTabRuntimeCleanup` path every other per-tab runtime uses.
- The Go half is two `Incognito bool` fields (`HttpSendArgs`, `GrpcCallArgs`) threaded into
  `adapterhost.OpSpec`, guarding `ResponseHistoryRepo.Record` and `internal/oplog`'s persistence.
  Say the deliberate asymmetry plainly: a running incognito op still emits live events to the
  Operations panel and is simply never written to `op_log`.
- An incognito tab's active environment is a per-tab in-memory override, never a write to the
  shared active-environment row.

**(b) The external-open capability (P74 §3, P79 batch B).** Also no grep hit. This belongs in
`## Renderer security surface`, whose `window.open` row already asserts *"zero `window.open`, zero
`target="_blank"` and zero `<a href>` in `apps/kira-studio/frontend/src`/`packages/shared`"* — that
claim is still true as scoped (verified), but the same posture now extends to `packages/git-ui`,
which used to be outside it. Add a short paragraph after that table:

- Every externally-openable link in the git UI is a `<button>` calling a host capability, never an
  anchor: the PR surfaces (`CommitMeta.vue`, `BranchPicker.vue`/`StackList.vue` stack badges,
  `refBadges.ts`'s SlickGrid formatter) go through `pr.browserUrl`/`GitHubService.
  OpenPullRequestURL`, and a URL found inside a commit message body (`linkify.ts`) goes through a
  new generic `link.openExternal`. Both are gated on `capabilities.openExternal`, and a surface
  renders a plain `<span>` when the host does not report it (`CommitMeta.vue`'s own button/span
  split — P79 batch F closed the one PR icon that was missing the gate).
- Say why `link.openExternal` is generic where `pr.openExternal` is not, quoting the reasoning in
  `internal/bridge/link.go`: a PR URL is composed server-side from data the app controls, while a
  commit-body URL **is** the untrusted content, already visible to the renderer as linkified text.
  So the only check left is the URL's own shape — `LinkService.OpenExternal` refuses anything that
  is not a well-formed `http`/`https` URL with a non-empty host, before `Browser.OpenURL` ever sees
  it, and VS Code's `proxyHandlers.ts` does the equivalent shape validation it previously lacked
  (`prUrl.ts`).
- Say that the host check for a PR URL is `gitsession.IsGitHubHost` — `github.com` plus any host
  `gh`'s own `Discovery` has authenticated against — shared by the composer and the validator, not
  two hand-rolled allowlists (P79 batch B; the previous hardcoded literal broke GHES entirely and
  meant the validator's allowlist was not really an allowlist for a GHES host).
- One cross-reference clause in the markdown-reading-view block (around line 1406-1412), whose
  current text says opening an external link "needs its own vetted bridge method (a scheme
  allow-list at minimum)": that method now exists (`bridge/link.go`), and the reading pane still
  deliberately does not use it — every anchor click there is still `preventDefault()`ed. Verify the
  reading pane's handler before writing this; do not imply the reading view changed.

**(c) Contract version history.** No prose in this file states a contract number except the P62
sentence §2.7 fixes, so nothing needs a running list. Confirm that and leave it — do **not** add a
version table this file has never had.

### 2.10 Known open items — one deletion, one re-word, two confirmations

The section's own rule is to delete an item the moment it is resolved.

**Delete outright — resolved by P78.**

> - **`codegraph.ImplementationsOf` returns nothing for Go** (C2 §6/D4). Go's interfaces are
>   structural, so the only correct answer is a method-set comparison — but C1's
>   `method_declaration` capture stores a method's *name* only, never its receiver type, so a type's
>   method set can't be assembled from stored rows at all, let alone compared against an interface's.
>   A data limit, not an effort estimate: closing it needs a receiver-capturing query and a schema
>   column, not more resolver logic.

Every clause is now false: `queries/go/p78_method_sets.scm` captures the receiver,
`methodsets.go` assembles and compares method sets, and it needed **no** schema column. Delete the
whole entry. Re-read `implementations.go`'s Go arm once before deleting, to confirm it calls
`goImplementationsOf` rather than returning `nil, nil`.

**Keep, and re-word its opening — the promoted-methods gap (added mid-chapter, `9fc528af`).**
It is still genuinely open, and with the entry above deleted it becomes the *only* statement in
this section about Go implementations — so its first sentence must no longer read as a narrowing of
a neighbour that will no longer exist. Give it enough standalone context: Go implementations are
answered by method-set comparison (§2.2), and the open part is that forward candidate discovery is
seeded from a literal method declaration, so `type T struct { io.ReadCloser }` satisfying
`interface{ Read; Close }` is invisible because `T` declares neither method itself. Keep its
existing "materially different, more expensive candidate-discovery strategy" and "no edge table"
reasoning verbatim. **Do not** add a second entry for the same gap from P78's own result section —
they are one finding.

**Confirm still true, then leave untouched.** Each is a single targeted read; do not carry any
forward on prose alone:

- "`review.open`'s pending-target map entry … is never cleared when consumed via the live-event
  path." P75 changed `graph.revealCommit`, not `review.open` — check `hostHandlers.ts` and confirm
  `takePendingReviewTarget` is still the only drain.
- "`loadComments` … swallows a failed `review.comment.list` request into an empty list with no
  retry banner." P75 touched the same file for its z-index and tint work; confirm the `.catch(() =>
  ({ at: …, comments: [] }))` is unchanged.
- "The native graph and the VS Code extension hold independent `gitsession.Conn`s over the same
  repository" — P72's `KeepAlive` changes mount lifetime, not connection identity, so this should
  be unchanged; confirm rather than assume.
- The two performance items naming review-comment fan-out and `repo/state/fileTree.ts`. Neither is
  in this chapter's diff; confirm and leave.

**Do not file a new item for:** the flaky UI tests (P81's own row), the repo-map `find_references`
gap (§0 — its own log), or anything from P79 that was fixed. A Known open item is a currently-true
limitation of the shipped app, not a record of what a review round found.

## 3. `docs/DEV_ENVIRONMENT.md`

Small. Two new environment facts, one heading span, one bullet to re-check.

### 3.1 `## The git module — running and testing it here (G1-G34)` — two container facts from P79

Add both as bullets in this section (they are git-tooling facts about working in this container,
which is what this file owns):

- **A fresh `git worktree` in this container can check out an orphaned "Initial commit" scaffold
  instead of the real branch tip.** Hit by 5 of P79's 6 fix batches. It is a provisioning race, not
  data loss — the affected worktree holds nothing of value, confirmed by `git status` and an
  ancestry check *before* any remediation. Recovery inside the isolated worktree is
  `git reset --hard`/`git merge --ff-only`/a fresh branch off the real tip; check what you actually
  have before choosing, and prefer stopping and reporting over self-remediating when the worktree
  might hold real work.
- **Rebasing this chapter's branch onto an advanced base needs `git rebase --rebase-merges`.** A
  plain `git rebase` flattens merge commits and replays every merged batch's individual commits
  linearly, reproducing spurious conflicts against content the branch's own merge commits already
  integrated. With `--rebase-merges` the same rebase replayed exactly one real conflict, once.
  State the shape that makes this apply (a feature branch that carries merge commits of its own),
  not just the flag.

Both are process-adjacent, but they are **environment** facts, not working agreements: they are
about how git behaves in this container and how this repo's branch shape interacts with it, which
is precisely the split `CLAUDE.md`'s own closing bullets draw. Do not put either in `CLAUDE.md`.

### 3.2 Same section — heading span and the bindings bullet

- The heading reads `(G1-G34)`. This file already annotates a widened section in the style
  `(C3, updated C8/P64c/P67d/M1)`. Widen to `(G1-G34, updated P79)` — or whatever span the bullets
  added here actually cover once §3.1 lands.
- `scripts/setup.sh` changed this chapter (`8c9da0d1`): `wails3 task common:generate:bindings` now
  runs **unconditionally on every run**, with the CLI-identity stamp only deciding whether Task's
  own checksum cache is wiped first. The Wails section's "Regenerate bindings" bullet says
  "`scripts/setup.sh`, which calls it" — still true, and the bullet needs no edit for correctness.
  Add one clause only if it earns it: a plain `bun run setup` now always spends the task's own
  up-to-date check (~0.2s no-op, ~7s on a real source change) rather than skipping it entirely.
  Read `scripts/setup.sh`'s own header comment before writing; it already states both numbers.

### 3.3 Confirm, do not change without checking

- The `## repo-map MCP server` section. The chapter's two open dogfooding findings (§0) are about
  the server's *results*, not about running it here; nothing in this section is wrong. Confirm the
  ephemeral-port and token-deletion bullets still match `CLAUDE.md`'s own step 2 and leave them.
- The `## Database MCP server` section. Untouched by this chapter.
- The Playwright flake class P73-P79 kept observing under full-parallel load. **Do not document it
  here** — P81 exists to fix it, and a bullet saying "these tests are flaky" would be exactly the
  kind of entry that outlives its truth. If P81 concludes the flakiness is environmental rather
  than fixable, P81's own row adds it.

## 4. `CLAUDE.md`

Process file. Two pointer fixes, and a check that nothing else is owed.

### 4.1 Line 49 — points at the previous chapter

> - Each phase (the current chapter's `SPEC.md` phasing table — `docs/v1.7/` today) needs an
>   Opus-authored plan committed under that chapter's `plans/` before implementation starts

→ `docs/v1.8/`.

### 4.2 Line 217 — the dogfooding pointer, same issue

> **Log what dogfooding finds** in the current chapter's own `mcp-repo-map-issues.md` (`docs/v1.7/`
> today).

→ `docs/v1.8/`. Both lines are ~97-100 columns and `v1.7` → `v1.8` is the same width, so no reflow
is needed — verify rather than assume, since M8's own §4.2 had to re-fix wrapping damage here once.

### 4.3 Nothing else is owed — checked, stated so the next chapter doesn't re-litigate it

- The **`P` phase-numbering rule** this chapter established is already in the file, added mid-chapter
  (`fa7e55ad`, then widened by `1b88f98e`). Do not add it again.
- The **library-first** bullet's example list (`Monaco, zod, sql-formatter and SlickGrid`) and its
  exception clause need no v1.8 addition. P78's Go method-set index is hand-rolled, but no library
  exists for "query a tree-sitter index for a Go type's method set", so it is not a decline-a-library
  case the rule asks anyone to justify; P77 reused `@kira/kira-ui`'s own roving-focus primitives
  rather than hand-rolling, which is the rule already working.
- The **code-review** bullet already covers what P79 did (parallel findings-only Opus agents, then
  fixes). The file-disjoint-batches-in-worktrees mechanics are a one-off execution detail of that
  round, and the worktree/rebase hazards they surfaced belong in `docs/DEV_ENVIRONMENT.md` (§3.1),
  not here. `CLAUDE.md`'s own "keep this file lean" rule is the reason.
- Nothing in this file is now stale enough to **prune**. Checked every bullet against the tree
  during this planning pass; the P25/P26 real-container split, the adapter-conformance exemption and
  the workflows-push constraint all still hold.

## 5. Dogfooding

This planning pass did not reach the repo-map MCP server: `docs/v1.8/mcp-repo-map-issues.md` already
carries two **Open** entries for the exact failure mode a docs-accuracy sweep leans on hardest — a
`find_references` answer of "no references found" for a non-call read — and the pass's own reads
were whole-paragraph doc reads plus targeted source reads where a wrong answer would have been worse
than no answer. That is a reason, not an omission, and it is recorded here rather than as a third
log entry repeating the same finding.

The **implementing** subagent should still start the server per `CLAUDE.md`'s §Repo-map MCP server
steps and use it where a targeted lookup fits (`find_definition`, `read_symbol`, `outline_file` are
all unaffected by the open entries — the gap is specific to reference edges for non-call reads).
Log anything genuinely new in `docs/v1.8/mcp-repo-map-issues.md` per that file's own process
section; do not log a repeat of either open entry.

## 6. Verification

No code changes, so no test suite gates this phase. Instead:

1. `bun run lint` before each commit — the pre-commit hook runs it anyway. **It does not check these
   files**: Biome reports a `.md` path as ignored (checked during this planning pass against
   `biome.json`, which excludes only `docs/design`, not `docs/`), so no formatter gates this phase.
   P70's and M8's own "Biome covers Markdown formatting in this repo" line is wrong and should not
   be copied forward. The ~100-column wrap and the surrounding bullet style are kept by hand; match
   the paragraph you are editing.
2. Every file path, symbol name, line number, count and commit SHA quoted in a replacement must be
   re-checked against the tree at the moment it is written, not copied from this plan. This plan was
   written against `16dd1db1`; a line number moves the instant an earlier edit in the same file
   lands, so work each file bottom-up or re-locate by quoted text, never by this plan's line
   numbers.
3. Grep sweeps after the edits, each with a stated expectation:
   - `-i "returns nothing for go"`, `-i "go returns nothing"` — must return nothing.
   - `RepoPicker` — must return nothing in any of the four files (the component is deleted;
     verified it was never referenced in docs, so this is a guard against re-introducing it).
   - `docs/v1.7` — every remaining hit must be a deliberate historical citation or the demoted
     completed-chapter entry, never a "live chapter" claim.
   - `-i incognito` — at least one hit in `README.md` and one in `docs/ARCHITECTURE.md`.
   - `link.openExternal`, `IsGitHubHost`, `graph.revealCommit`, `methodsets.go`, `textModels.ts`,
     `blameLine.ts`, `pickerModel.ts`, `graphVisibility.ts` — each must appear at least once in
     `docs/ARCHITECTURE.md`, spelled exactly as the tree spells it.
   - `instanceWide` — must appear in neither `README.md` nor `docs/ARCHITECTURE.md`; the flag is
     deleted (P79 batch A) and only two source comments mention it historically.
4. `grep -n "^#\{1,3\} " docs/ARCHITECTURE.md` before and after: the count must be **unchanged**.
   §2 adds no heading — every addition lands inside an existing section, deliberately.
5. Re-read `docs/ARCHITECTURE.md`'s Known open items start to finish once after §2.10, checking that
   nothing left in it contradicts anything §2 just added.
6. Read `README.md` start to finish once as a newcomer would. Its failure mode is "technically
   accurate, still misleading", and §1.4 in particular replaces a flat "this doesn't work" with a
   qualified "this works, with a named limit" — the qualification has to survive the edit.

## 7. Explicitly not in this phase

- `docs/PERF.md` and `docs/PACKAGING.md`. The SPEC row names four files; these are not among them,
  and nothing in P71-P79 changed a budget or the bundle layout. (P72's `KeepAlive` and P79 batch E's
  background-work pause are perf-shaped, but neither states a new measured budget — the C10 clause
  in §2.5 is the right home.)
- Any code change. If a doc fix needs source read to state something correctly, read it — but if the
  *source* turns out wrong, note it in the commit message and leave it.
- Restructuring `docs/ARCHITECTURE.md`. §2 adds no heading and moves no paragraph.
- The two open repo-map dogfooding entries (§0), and `docs/v1.8/mcp-repo-map-issues.md` generally
  unless something new is hit (§5).
- P81's flaky tests, in any of the four files (§3.3).
- Retro-editing `docs/v1.8/SPEC.md` or any earlier chapter's `SPEC.md` — each is kept as written,
  per the chapters' own `README.md`.
- Documenting P79's internal-only fixes. Most of its 31 findings were correctness/performance bugs
  with no externally-visible behaviour change (the `sameReceiver`/`filterTier` reordering, the
  `nav.go` helper extraction, the preview-cohort batching, the blame-cache cap, the `pickerModel`
  tab-switch split, the nav-status stale-readout guard). Those belong in the commit log, not in a
  doc. The ones that *are* doc-worthy are named above and nowhere else: the two settings leaves that
  now work (§1.3), GHES host support and the `link.openExternal` capability (§1.6/§2.9b), the PR
  ancestry base cutoff (§2.5), and the promoted-methods open item's re-word (§2.10).

## 8. Ordering and dependencies

**None beyond commit ordering.** Every edit below is independent — no file's correctness depends on
another's, and no edit depends on anything landing outside this phase. The commit order in §9 is
chosen only so the large `README.md` diff lands against already-corrected pointers, matching P70's
and M8's own reasoning; a different order would produce the same tree.

## 9. Commit list

One commit per file, smallest and most mechanical first:

1. `docs(P80): point CLAUDE.md at the live chapter` — §4.
2. `docs(P80): record the worktree and rebase hazards in DEV_ENVIRONMENT.md` — §3.
3. `docs(P80): correct ARCHITECTURE.md's Go implementation, blame and method-count claims` —
   §2.1-§2.8.
4. `docs(P80): document incognito tabs and the external-open capability in ARCHITECTURE.md` — §2.9.
5. `docs(P80): drop the resolved Go implementations open item` — §2.10.
6. `docs(P80): bring README.md current for v1.8` — §1.

Splitting 5 out of 3-4 keeps the Known-open-items judgement — the one step here with real judgement
in it — reviewable on its own rather than buried in a large prose diff, the same reason P70 and M8
each split theirs.
