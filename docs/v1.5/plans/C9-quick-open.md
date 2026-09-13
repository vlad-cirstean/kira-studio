# C9 — Quick Open: fuzzy file search (Cmd+P)

> **What this phase is.** `docs/v1.5/SPEC.md`'s C9 row turned into steps, researched against the real
> tree at `58f74af5` — C5 and C7 as they actually shipped, not as their plans predicted them.
> Checked against source: `shortcuts/CommandPalette.vue`, `shortcuts/state.ts`, `shortcuts/keys.ts`,
> `shortcuts/commands.ts`, `packages/shared/domain/shortcuts.ts`, `internal/shell/accel.go` +
> `menutemplate.go`, `internal/bridge/events.go`, `packages/shared/protocol/events.ts`,
> `frontend/src/bridge/index.ts`, `App.vue`, `repo/state/fileTree.ts`, `repo/RepoPanel.vue`,
> `repo/RepoSearchView.vue`, `state/repoTabs.ts`, `state/workspace.ts`,
> `packages/shared/domain/workspace.ts`, `views/repo/reveal.ts`, `views/repo/monaco.ts`,
> `internal/codeindex/enumerate.go`, `internal/codeworkspace/files.go`, `internal/codegraph/search.go`,
> `internal/repomap/tools.go` + `render.go`, `tests/ui/support/mockRuntime.ts`, and the root
> `package.json`.

## 0. What C5/C7 shipped, and what C9 inherits

Facts read from code, not from the earlier plans:

- **`repo/state/fileTree.ts` already holds a flat path list, per repo, in the renderer.**
  `RepoTreeState.paths: string[]` (`fileTree.ts:100`) is assigned verbatim from
  `control.codeWorkspaceListFiles(repoId)` at `:164`. `buildTree` (`:17`) folds it into the nested
  `FileNode[]` the tree renders, but the flat array is kept alongside, not consumed and discarded.
  `byRepo` (`:132`) is a `reactive(Map)`; `ensureRepoTreeLoaded` (`:181`) loads once,
  `refreshRepoTree` (`:158`) reloads, `dropRepoTree` (`:204`) evicts on repo removal.
- **That listing is already the SPEC's second candidate.** `codeworkspace.ListFiles`
  (`internal/codeworkspace/files.go:37`) *is* `codeindex.EnumerateAll` (`enumerate.go:47`) —
  `git ls-files -z --cached --others --exclude-standard` — plus one `git status --porcelain=v2`
  overlay. The two candidates SPEC names are not two sources; one is a caller of the other.
- **`MaxListedFiles = 200_000`** (`files.go:16`), truncating at `:43-47` and reporting
  `FileListing.Truncated`, which the store keeps at `fileTree.ts:102`.
- **`openRepoFileTab(repoId, path, opts)`** (`state/repoTabs.ts:24`) is the one file-opening path,
  and its own comment at `:21-23` already names this phase: *"every tree row click and every
  search/quick-open match (§12) routes through this, never `openTab` directly."*
- **C7's result-open convention** is `RepoSearchView.vue:87-95`'s `onOpen(row, preview)`: single
  click → `preview: true`, double-click/Enter → `preview: false`, with `reveal` carrying
  line/column. `views/repo/reveal.ts:25`'s `requestReveal` is what moves an already-mounted editor.
- **`CommandPalette.vue` does not fuzzy-match.** `filtered` (`:9-13`) is
  `c.label.toLowerCase().includes(q)` — a plain substring filter, no scoring, no ranking, no
  highlighting. `shortcuts/state.ts:16-19`'s own comment says so outright: *"No fuzzy scoring, no
  'go to anything' navigation."* There is no fuzzy-match precedent in this repo to reuse.
- **Cmd+P is free.** `SHORTCUTS['view.commandPalette']` is `{ key: 'P', cmdOrCtrl: true, shift: true }`
  (`packages/shared/domain/shortcuts.ts:29`) — ⌘⇧P, mirrored in `internal/shell/accel.go:44`. The app
  has no ⌘P binding at all, so C9 can take VS Code's exact split (⌘⇧P commands, ⌘P files).
- **The palette is menu-driven, not keydown-driven.** `menutemplate.go:87` emits
  `bridge.ChannelCommandPalette` (`events.go:21`, `"kira:menu:command-palette"`), mirrored in
  `protocol/events.ts:13`, subscribed at `bridge/index.ts:93`, wired at `App.vue:62`. A new global
  accelerator is a seven-file edit; no local keydown handler is involved.
- **`registerCommand`/`runCommand`** (`shortcuts/commands.ts`) is a mount-scoped registry;
  `RepoPanel.vue:39-51` registers `repo.search` while mounted, and `shortcuts/state.ts:57-59`
  carries its palette entry.
- **`repoIdOfWorkspace(key)`** (`packages/shared/domain/workspace.ts`) returns the repo id of a
  `repo:<id>` workspace or `null`; `workspaceState.active` (`state/workspace.ts:14-17`) is the live
  key.
- **`monaco-editor` 0.56.0** is already a direct dependency (root `package.json`), reached through a
  dynamic `import()` at `views/repo/monaco.ts:77` so studio/api sessions never download it.
- **UI tests** are Playwright under `apps/kira-studio/tests/ui/`;
  `support/mockRuntime.ts:585`'s `emitWailsEvent(page, name, data)` drives a push channel, and `:148`
  already stubs `CodeWorkspaceService.ListFiles`.

## 1. What SPEC left open, and how each is resolved

**D1 — The file list is C5's already-loaded `repo/state/fileTree.ts` `paths` array. No new
enumeration, no Go call, no second mechanism.** This is the decision SPEC's row asks for, so it is
argued rather than asserted.

SPEC frames two candidates — "C5's own project tree listing, or the same repository listing C1's
parse pipeline already has to enumerate". Read against source they are one chain, not two:
`fileTree.ts:164` → `CodeWorkspaceService.ListFiles` → `codeworkspace.ListFiles` (`files.go:37`) →
`codeindex.EnumerateAll` (`enumerate.go:47`). Choosing "C5's tree listing" *is* choosing C1's
enumeration, one layer up.

So the real question is which layer C9 reads at, and the answer is the topmost: the flat
`string[]` already sitting in the renderer, in the workspace the user is looking at, loaded before
quick open can be opened in it. Reading at any lower layer is strictly worse:

- A new Go `QuickOpen` binding would spawn `git ls-files` again — per call, or behind a new cache
  with its own staleness rules — to produce bytes the renderer is already holding.
- Calling `codeindex.Enumerate` (rather than `EnumerateAll`) would silently narrow the result to
  files `codeparse.Detect` recognises: **1,797 of this repo's 2,176 files** (C8's own measured index
  count against the 2,176 measured below). `README.md`, `Taskfile.yml`, every `.json` and `.md`
  would be unreachable by ⌘P. SPEC's row says "tracked/untracked-but-not-ignored files", not
  "parseable files".

One consequence stated honestly: quick open inherits the tree's freshness exactly — refreshed on
workspace open and on the panel's explicit Refresh, not live (already in `docs/ARCHITECTURE.md`'s
Known open items for the tree). A file created since the last refresh is not quick-openable until a
refresh. That is the same snapshot posture C5's tree and C7's results both take, and sharing one
snapshot is better than quick open having a *different*, independently-stale one.

**Required change: one accessor.** `fileTree.ts` currently exports no path reader —
`visibleRepoRows` (`:194`) returns row view-models, not paths. C9 adds
`repoTreePaths(repoId): readonly string[]` beside the existing `repoTreeTruncated`/`repoTreeError`
accessors (`:148-154`). Five lines, no new state.

**D2 — Fuzzy matching is `fuzzysort` (MIT, 4.0.2), a new direct dependency. The repo's existing
substring filters are declined, with reasons, and so is Monaco's internal scorer.**

`CLAUDE.md`'s bar: reach for a well-maintained library before hand-rolling non-trivial
infrastructure. A ranked fuzzy matcher is non-trivial — VS Code's own is a dynamic-programming
scorer with separate bonuses for word starts, camel-case boundaries, consecutive runs and path
separators. Hand-rolling it is exactly the case the rule forbids.

What exists here and why each is declined:

| Existing candidate | What it actually is | Why not |
|---|---|---|
| `CommandPalette.vue:9-13` | `label.toLowerCase().includes(q)` | Not fuzzy at all, and its own source comment says the omission is deliberate. `cw` would not match `codeworkspace`. Nothing to reuse but the chrome (D4). |
| `fileTree.ts:79`'s tree filter | `node.name.toLowerCase().includes(q)` | Same substring shape, scoped to one name, no ranking across a flat list. |
| `repomap`'s `search_files` | `codegraph.SearchFiles` (`search.go:104-134`): SQL `LIKE '%text%'`, re-sorted by match index then path length | Three independent disqualifications, below. |

**On `search_files` specifically** (SPEC asks for an explicit verdict, not a note). Declined, and the
first reason alone is sufficient: **it is not a fuzzy matcher, and says so in its own tool schema** —
`tools.go:233` documents the argument as *"Substring to search for in indexed file paths — not a
fuzzy finder."* `search.go:106` builds `"%" + escapeLike(s.Text) + "%"`. There is no subsequence
matching to extract. The other two reasons stand on their own: (a) it queries the **code graph's**
file table, i.e. the parseable subset D1 already rejected as too narrow; (b) it is a SQLite
round-trip through `Graph.store`, the wrong latency shape for a per-keystroke UI, and a repo
workspace's index may still be building (`s.waitReady`, `tools.go:243`) when the user hits ⌘P.
Extracting a shared matcher is therefore not on the table: there is no matcher there to share, only a
`LIKE` pattern and a three-key sort. Both surfaces keep what fits them — MCP callers get substring
recall over indexed files, ⌘P gets ranked subsequence matching over every file.

**On Monaco's internal scorer.** `monaco-editor/esm/vs/base/common/fuzzyScorer.js` exists in the
installed 0.56.0 tree, exports `scoreFuzzy2`/`prepareQuery`/`pieceToQuery`, is MIT, and *is* reachable
— the package's `exports` map ends in `"./*": "./esm/vs/*.js"`. Tempting: zero new dependency, the
literal algorithm behind VS Code's ⌘P. Declined on two concrete grounds, both checked:

1. **It ships no typings.** The package contains exactly seven `.d.ts` files (`esm/vs/index.d.ts`,
   `editor.api.d.ts`, `editor.d.ts`, `metadata.d.ts`, the two `register.all.d.ts`, `monaco.d.ts`) —
   none for `base/common/*`. Under this repo's `strict` config a deep import needs a hand-written
   ambient declaration for an undocumented internal module, maintained by us, against an API upstream
   guarantees nothing about.
2. **It is only half the algorithm.** Monaco's trimmed copy exports the string scorer but not
   VS Code's item-level `scoreItemFuzzy`/`compareItemsByFuzzyScore` — the part that does the
   label-vs-path split and the ranking. The basename-vs-full-path logic SPEC names would still be
   hand-rolled on top.

**Libraries weighed, with real registry metadata (checked, not recalled):**

| Candidate | Version | License | Last publish | Verdict |
|---|---|---|---|---|
| **`fuzzysort`** | **4.0.2** | **MIT** | **2026-08-13** | **Chosen.** Zero dependencies, ships its own `index.d.ts`, and its `keys` + `scoreFn` API is a direct answer to SPEC's ranking requirement. |
| `@leeoniya/ufuzzy` | 1.0.19 | MIT | 2025-08-22 | Genuinely good and actively maintained. Built around a regex-per-query strategy over a flat haystack; multi-field (basename *and* path) ranking is left to the caller, so it answers less of the problem than `fuzzysort` for the same dependency cost. |
| `fuse.js` | 7.5.0 | Apache-2.0 | 2026-07-13 | Bitap/edit-distance, tuned for typo tolerance in prose. Wrong ranking model for paths — `cw` should match `codeworkspace` strongly (subsequence, word-start bonus), which is not what a typo-tolerant scorer optimises. 407 KB unpacked vs 77 KB. |
| `fzf` (fzf-for-js) | 0.5.2 | BSD-3-Clause | 2023-04-25 | The best *algorithm* fit — a faithful port of `junegunn/fzf` v1/v2 including its path bonuses. Fails `CLAUDE.md`'s "well-maintained" half of the bar: no release in over three years. |
| `@nozbe/microfuzz` | 1.0.0 | MIT | 2023-07-18 | Same staleness problem, and deliberately minimal — no multi-key scoring. |
| `command-score` | 0.1.2 | MIT | 2016-06-10 | cmdk's scorer. Untyped, a decade stale, single-string only. |

All six are permissively licensed with no dual-license, community-edition or paid-tier trap —
checked at the package level. `fuzzysort` is MIT end to end with zero transitive dependencies, so
there is no sub-dependency license to re-check.

Why `fuzzysort` specifically answers this row's stated needs:

- `snapshot(items, { keys: ['name', 'path'] })` pre-computes an immutable index over **both**
  targets — SPEC's "basename-vs-fullpath matching", without us writing the combination.
- `go(query, snapshot, { limit, threshold, scoreFn })`'s `scoreFn` receives the per-key results, so
  basename weighting and a path-depth penalty are a few lines of *policy* on top of a real scorer,
  not a scorer we wrote (§3.2).
- `result.indexes` / `highlight(callback)` give matched-character positions, so the palette can bold
  the matched characters the way VS Code does.

**D3 — Matching runs entirely in the renderer. No Go call, no IPC per keystroke. Measured.**

This is a real question (does a 2,000-file list need a backend?), so it was measured rather than
estimated — and the measurement did change the shape of §3.4's cap, so it earned its keep.

Method: this repository's own real path list (`git ls-files --cached --others --exclude-standard`,
**2,176 paths**, 107,123 bytes, mean length 49, max 100), fed to `fuzzysort@4.0.2` with
`keys: ['name','path']`, `limit: 50`, `threshold: 0.4` and the §3.2 `scoreFn`; 20 iterations per
query after 3 warm-ups. Synthetic 10k/50k/200k sets are the same paths re-prefixed, 200k being
`MaxListedFiles` exactly.

| Paths | `snapshot()` | Worst query | Best query |
|---|---|---|---|
| 2,176 (this repo) | 1.2 ms | 2.15 ms (`r`) | 0.03 ms (`codework`) |
| 10,000 | 0.1 ms | 6.42 ms (`re`) | 0.05 ms |
| 50,000 | 0.4 ms | 34.78 ms (`re`) | 0.37 ms |
| 200,000 (`MaxListedFiles`) | 1.2 ms | 144.06 ms (`re`) | 2.10 ms |

Read honestly: measured under Node/V8, while the app runs in the platform webview (WebKit on
macOS/Linux, WebView2 on Windows) — treat as order-of-magnitude, not a guarantee. That is enough,
because the conclusion has two orders of magnitude of headroom at realistic sizes.

Conclusions:

1. **Client-side wins outright at realistic scale.** 2.15 ms worst case here is below one 60 Hz
   frame. A Go round trip would add IPC serialisation *per keystroke* to beat 2 ms of local work,
   and would have to re-enumerate or re-cache a list the renderer already holds (D1).
2. **Worst case is always a 1–2 character query**, because cost tracks candidate count, not query
   length. Cost falls monotonically as the user types.
3. **The 200k tail is real and is handled by a cap, not ignored** (§3.4): above
   `QUICK_OPEN_MAX_CANDIDATES = 50_000` the candidate list is sliced and the palette says so. 50k is
   where the worst query is still ~35 ms — perceptible but not a stall — and a repository past it is
   ~23× this one. No Web Worker: it would add a serialisation boundary and an async protocol to a
   2 ms operation for a case the cap already bounds (§11).

**D4 — A new `repo/QuickOpen.vue`, not an extension of `CommandPalette.vue`.** The two share
*chrome* — a backdrop, a centred floating panel, an input, a keyboard-driven list — and nothing
else: different data source (repo paths vs a static command array), different matching (ranked fuzzy
vs substring), different scoping (one repo workspace vs global), different rows (two-line
path-and-name with match highlighting vs a single label), different activation (per-repo state that
must survive nothing). Generalising `CommandPalette.vue` into a base component to serve both would
rewrite a shipped, visual-snapshot-tested surface to host one new caller whose every axis differs —
the same trade C7 D7 declined for `grpcCoalescer`. Instead, `QuickOpen.vue` reuses the *CSS
vocabulary* (`p-float`, `p-input ui md`, `p-row`, `--kira-z-dialog`, the `palette-backdrop` layout)
by mirroring it, which is how the design system is meant to be consumed. Where they genuinely agree
— Escape/ArrowUp/ArrowDown/Enter handling — is ~15 lines of keydown switch, below any extraction
bar.

**D5 — ⌘P is a new `view.quickOpen` global binding, added through the existing seven-file
accelerator path.** `shortcuts.ts` → `accel.go` → `menutemplate.go` → `events.go` → `events.ts` →
`bridge/index.ts` → `App.vue`. No new mechanism; the ⌘⇧P palette already walks exactly this path
(§0), and `accel.go:37-38`'s comment exists so the Go table can be diffed against the TS one by
name. The menu item sits in the View section directly above "Command Palette…", labelled
**"Go to File…"** (VS Code's own name for this command).

**D6 — Quick open is gated on the active workspace, not on a mounted component.** It is reachable
whenever a repo workspace is active — including with the project panel toggled off, which unmounts
`RepoPanel.vue`. So the gate is `repoIdOfWorkspace(workspaceState.active)`, evaluated in the store
when ⌘P fires; `null` (studio/api) is a no-op, exactly as `runCommand` is a no-op with nothing
registered. This is the one deliberate departure from `repo.search`'s `registerCommand` shape
(`RepoPanel.vue:44`), and the reason is concrete: `repo.search` *switches that panel's segmented
control*, so it is meaningless without the panel; quick open is not.

**D7 — Opening reuses C7's convention verbatim: `openRepoFileTab(repoId, path, { preview })`, Enter
and single click preview, ⇧Enter and double-click permanent.** `RepoSearchView.vue:87-95`'s exact
`onOpen(row, preview)` split, one layer up. No `reveal` is passed — a file has no line to reveal —
so `openRepoFileTab:29-41` skips both `patchRepoFileTabState` and `requestReveal` and the tab opens
at its top. Nothing in `repoTabs.ts` changes; `reveal` is already optional
(`OpenRepoFileOpts:13-19`).

**D8 — The palette loads the listing itself.** With the project panel never opened in this session,
`byRepo` may have no entry for the active repo and `paths` is `[]`. Opening quick open calls
`ensureRepoTreeLoaded(repoId)` (`fileTree.ts:181`, already idempotent and already fire-and-forget)
and renders a loading row until `isRepoTreeLoaded` is true. Without this, ⌘P on a freshly restored
window with a collapsed panel silently shows "No matching files".

**D9 — One `fuzzysort` snapshot per repo, rebuilt when the paths array identity changes.**
`refreshRepoTree` assigns a fresh array to `state.paths` (`:164`), so reference equality is an exact
invalidation signal — no versioning, no dirty flag. The snapshot is built lazily on first ⌘P for
that repo (1.2 ms here), cached in a module-level `Map`, and dropped alongside `dropRepoTree`.

**D10 — `fuzzysort` is a static import, not a lazy one.** Measured: 21,187 bytes minified, **8,428
bytes gzipped** (esbuild `--bundle --minify`, `gzip -9`). `views/repo/monaco.ts:77`'s dynamic
boundary exists for a 972 KB-gzip payload — 115× larger. Paying an async boundary and a loading
state for 8 KB would be cargo-culting the precedent rather than applying its reason.

## 2. Where the code lives

| File | Change |
|---|---|
| `packages/shared/domain/shortcuts.ts` | new `view.quickOpen` row |
| `apps/kira-studio/internal/shell/accel.go` | mirror row in `Shortcuts` |
| `apps/kira-studio/internal/shell/menutemplate.go` | View-section item, above Command Palette |
| `apps/kira-studio/internal/bridge/events.go` | `ChannelQuickOpen` |
| `packages/shared/protocol/events.ts` | `CHANNEL.quickOpen` |
| `apps/kira-studio/frontend/src/bridge/index.ts` | `onQuickOpen` |
| `apps/kira-studio/frontend/src/App.vue` | subscription + `<QuickOpen />` |
| `apps/kira-studio/frontend/src/repo/state/fileTree.ts` | new `repoTreePaths` accessor |
| `apps/kira-studio/frontend/src/repo/state/quickOpen.ts` | **new** — state, snapshot cache, matching |
| `apps/kira-studio/frontend/src/repo/QuickOpen.vue` | **new** — the palette |
| `apps/kira-studio/frontend/src/shortcuts/state.ts` | `repo.quickOpen` palette entry |
| root `package.json` | `fuzzysort` dependency |
| `NOTICES.md` | `fuzzysort` MIT notice |
| `docs/ARCHITECTURE.md` | C9 subsection + Known open items |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | one case |

No Go logic changes: `accel.go`/`menutemplate.go`/`events.go` gain one line each, all table data.

## 3. The matcher

### 3.1 Candidate shape (`repo/state/quickOpen.ts`)

```ts
interface QuickOpenItem {
  path: string;  // repository-relative, git's own bytes
  name: string;  // basename
  dir: string;   // parent dir, '' at root — rendered as the dim second line
  depth: number; // count of '/'
}
```

Built from `repoTreePaths(repoId)` with one pass of `lastIndexOf('/')`. **No NFC normalisation** —
`enumerate.go:12-18`'s tier-2 rule is that these bytes go back to git verbatim, and `openRepoFileTab`
hands the path to `ReadFile`, which does.

### 3.2 Scoring (the only hand-written part)

```ts
const results = fuzzysort.go(query, snapshot, {
  limit: QUICK_OPEN_MAX_RESULTS,     // 50
  threshold: QUICK_OPEN_THRESHOLD,   // 0.4
  scoreFn: (r) => {
    const name = r[0] ? r[0].score : 0;          // keys[0] = 'name'
    const path = r[1] ? r[1].score * 0.8 : 0;    // keys[1] = 'path'
    return Math.max(name, path) - depthOf(r.obj) * DEPTH_PENALTY;
  },
});
```

Three rules, each with a stated reason:

1. **Basename beats path.** Typing `repotabs` should rank `state/repoTabs.ts` above a deeply nested
   file that merely contains those characters across directory names. `Math.max` with the path key
   discounted to 0.8 expresses "a basename hit is worth more than the same hit spread across the
   path" without discarding path-only matches — `state/repo` must still find files under
   `state/repo/`.
2. **Shallower wins ties.** `DEPTH_PENALTY` is a small constant against `fuzzysort`'s 0..1 scale, so
   it only ever breaks near-ties; it never promotes a worse match.
3. **No recency term in this phase.** SPEC's row mentions recency as a ranking *need*; it is
   deliberately deferred whole rather than half-built (§11), because an honest version needs a
   persisted per-repo MRU list — a storage-schema change, which is its own phase's worth of scope.
   The seam is exactly one term in this `scoreFn`.

`threshold: 0.4` is `fuzzysort`'s documented "good match" floor and is what keeps a 1-character
query from returning 958 rows (§7's measured `r` case) before `limit` even applies.

### 3.3 Query handling

- Empty query: no matching at all. Show the first `QUICK_OPEN_MAX_RESULTS` items in listing order —
  the same "open the palette, see something" affordance VS Code has. Costs nothing.
- The query is trimmed but never lowercased by us; `fuzzysort` is case-insensitive with a
  case-match bonus, so `RT` ranking `repoTabs.ts` above `rt`-containing paths falls out for free.
- No debounce. Measured worst case is 2.15 ms on this repo (§7) — a debounce would add latency to
  hide nothing. The `>50k` cap (§3.4) is what bounds the tail instead.

### 3.4 Caps

| Constant | Value | Why |
|---|---|---|
| `QUICK_OPEN_MAX_RESULTS` | 50 | More than a keyboard-driven list can be navigated; also `fuzzysort`'s `limit`, so it bounds sort work, not just render work. |
| `QUICK_OPEN_MAX_CANDIDATES` | 50,000 | D3's measured knee: 34.78 ms worst query at 50k, 144.06 ms at 200k. Above it the item list is sliced and the palette shows a truncation line. |
| `QUICK_OPEN_THRESHOLD` | 0.4 | `fuzzysort`'s "good match" floor. |

Both truncations are surfaced, never silent: a repo already truncated by `MaxListedFiles`
(`fileTree.ts:102`) or sliced by `QUICK_OPEN_MAX_CANDIDATES` renders one dim footer row saying so —
the same posture C7 took for skipped files.

## 4. The palette (`repo/QuickOpen.vue`)

Structure mirrors `CommandPalette.vue`'s chrome (D4): `palette-backdrop` at `--kira-z-dialog`,
a `p-float` panel, `p-input ui md` input, scrollable list, `p-row` rows.

Differences, all driven by the data:

- **Rows are two-part**: basename in normal weight, parent directory dim and smaller on the same
  line (VS Code's shape). Matched characters bolded via `fuzzysort.highlight(result, callback)`,
  rendered as an array of spans — never `v-html`, so a path containing `<` cannot inject markup.
- **Width** 560px rather than 420px: paths are longer than command labels (measured max 100 chars
  here). Long paths ellipsise at the start (`direction: rtl` on the dim segment), so the
  distinguishing tail stays visible.
- **Placeholder** "Search files by name".
- **Empty/loading/truncated** states: "Loading files…" while `!isRepoTreeLoaded`, "No matching files"
  after, and the §3.4 footer when truncated.
- **No virtualisation.** 50 rows maximum. `VirtualList.vue` exists but earns nothing here.

Keyboard: Escape closes, ArrowUp/ArrowDown move with clamping, Enter opens preview, ⇧Enter opens
permanent (D7), and the active row is scrolled into view with `scrollIntoView({ block: 'nearest' })`
— which `CommandPalette.vue` lacks and this list needs, being longer.

`wrapSelectionOnType(e)` is called first in the keydown handler, exactly as `CommandPalette.vue:37`
does.

## 5. State (`repo/state/quickOpen.ts`)

```ts
export const quickOpenState = reactive({ open: false, repoId: '', query: '' });
export function openQuickOpen(): void;   // D6 gate + D8 load
export function closeQuickOpen(): void;
export function quickOpenResults(): QuickOpenRow[];
export function dropQuickOpen(repoId: string): void;  // beside dropRepoTree's call site
```

`openQuickOpen` reads `repoIdOfWorkspace(workspaceState.active)`, returns silently on `null` (D6),
otherwise sets `repoId`, clears `query`, calls `ensureRepoTreeLoaded` (D8) and opens.

Closing the workspace, or removing the repo, must close the palette if it is showing that repo —
wired at the same call site as `dropRepoTree` (`state/workspace.ts`'s `closeRepoWorkspace`).

**Import direction check**: `quickOpen.ts` imports `fileTree.ts`, `state/workspace.ts`,
`state/repoTabs.ts` and `@shared/domain/workspace`. `repoTabs.ts` imports `views/repo/reveal` →
`views/repo/editors` → `views/repo/monaco`, and none of those import `repo/state/*`, so this closes
no cycle — the same check `reveal.ts:12-13` records for itself.

## 6. Implementation steps

Each step builds and passes `bun run typecheck` and `bun run lint`; Go steps also `go vet` the
touched packages. Expensive suites run once, at S8, per `CLAUDE.md`.

**S1 — The accelerator, end to end, wired to nothing.** `view.quickOpen` in `shortcuts.ts` and
`accel.go`; the "Go to File…" item in `menutemplate.go`; `ChannelQuickOpen` in `events.go`;
`CHANNEL.quickOpen` in `events.ts`; `onQuickOpen` in `bridge/index.ts`; an `App.vue` subscription
calling a stub. `go build ./...` plus `bun run typecheck`. Working increment: ⌘P fires an event and
nothing happens — deliberately a standalone commit, since it is the one change touching both
languages and it is pure table data.

**S2 — `fuzzysort` dependency.** Root `package.json`, `bun install`, `NOTICES.md` entry. Confirm the
lockfile records no transitive dependency.

**S3 — `repoTreePaths` accessor** in `fileTree.ts`, beside `repoTreeTruncated`.

**S4 — `repo/state/quickOpen.ts`.** Item build, snapshot cache keyed on the paths array reference
(D9), the `scoreFn` (§3.2), the caps (§3.4), open/close with the D6 gate and D8 load, `dropQuickOpen`
wired beside `dropRepoTree`.

**S5 — `repo/QuickOpen.vue`** (§4), mounted in `App.vue` beside `<CommandPalette />`, with `App.vue`'s
S1 stub replaced by `openQuickOpen`. Working increment: ⌘P in a repo workspace lists and filters
files; selecting one does nothing yet.

**S6 — Opening.** `onOpen(row, preview)` → `openRepoFileTab` (D7), Enter/click and ⇧Enter/double-click.
Working increment: the phase's deliverable is complete.

**S7 — Palette entry.** `{ id: 'repo.quickOpen', label: 'Go to file…', run: openQuickOpen }` in
`shortcuts/state.ts`, with a comment noting the D6 departure from `repo.search`'s `runCommand` shape.

**S8 — One UI case (§7), docs (§8), verification (§9).**

Sequencing is strictly linear — S1→S8, one Sonnet subagent. Nothing here is independent enough to
parallelise: S4 needs S2 and S3, S5 needs S4, S6 needs S5.

## 7. Testing

`CLAUDE.md`'s bar — a dedicated test only for something genuinely hard to get right.

**No unit test. Stated, not omitted by accident.** Every candidate fails the bar on inspection:

- The **scorer** is `fuzzysort`'s. Testing it would test the library.
- The **`scoreFn`** is `Math.max(a, b*0.8) - depth*k` — three arithmetic terms. A test would restate
  the expression.
- The **item build** is one `lastIndexOf('/')` per path.
- The **snapshot cache** is `if (cached.paths === paths) return cached.snapshot` — a single `if`
  guarding one obvious case, which `CLAUDE.md` names explicitly as not complexity.
- The **keydown handler** is a clamped index, which `CommandPalette.vue` has shipped untested since
  P28.

This is a phase with no parser, no boundary arithmetic, no cache invalidation with interacting rules,
no concurrency. C7 earned `search_test.go` on real interacting rules; C9 honestly has none, and
manufacturing one would be the ritual `CLAUDE.md` forbids.

**One UI case** in `tests/ui/repo-workspace.spec.ts`, for the parts typecheck cannot reach — the
channel subscription, the workspace gate, and the open-into-preview-tab path. It stubs
`CodeWorkspaceService.ListFiles` (`mockRuntime.ts:148`) with a small fixed path set, opens a repo
workspace, drives `emitWailsEvent(page, CHANNEL.quickOpen, null)` (`mockRuntime.ts:585`), then
asserts:

1. the palette renders with all fixture files;
2. a non-contiguous subsequence query (`rtx` against `repo/tabs/extra.ts`) matches — i.e. it is
   genuinely fuzzy, not the substring filter C9 declined, which is the one behavioural claim of D2
   worth pinning;
3. a basename match outranks a path-only match for the same query (D2/§3.2's rule 1);
4. Enter opens a **preview** tab titled with that basename, ⇧Enter a permanent one;
5. ⌘P emitted while `studio` is active opens nothing (D6's gate).

## 8. Documentation to update

- **`docs/ARCHITECTURE.md`, "Native code workspace (C5)"**: a new "Quick open (C9)" subsection — the
  enumeration decision (shares C5's already-loaded listing, inherits its snapshot freshness exactly),
  the `fuzzysort` choice with the one-line reason the three in-repo substring filters and Monaco's
  internal scorer were all declined, the two-key ranking, the caps, and that matching is renderer-side
  with the measured numbers behind it.
- **`docs/ARCHITECTURE.md`, the dependency table (line 47's neighbourhood)**: `fuzzysort` (MIT,
  pinned 4.0.2, 8.4 KB gzip, zero transitive dependencies), stated as a static import with the reason
  it is not behind Monaco's dynamic boundary.
- **`docs/ARCHITECTURE.md`, Known open items**: quick open has no recency ranking and no MRU; its
  file list is as stale as the tree's last refresh; a repository past 50,000 files matches only the
  first 50,000 and says so.
- **`NOTICES.md`**: `fuzzysort` MIT notice, in the same shape as the `monaco-editor` entry (line 106).
- **`docs/v1.5/mcp-repo-map-issues.md`**: log whatever dogfooding this phase turns up, per `CLAUDE.md`.
- **`CLAUDE.md`**: nothing. App fact, not process.

## 9. Explicitly out of scope

- **Recency / MRU ranking** (D2 rule 3). Needs persisted per-repo history; the `scoreFn` seam is one
  term wide when a later phase wants it.
- **`path:line` and `path:line:col` suffixes** in the query. The reveal plumbing exists
  (`openRepoFileTab`'s `reveal`, `reveal.ts:25`), so this is genuinely small — and left out entirely
  rather than half-built, per `CLAUDE.md`.
- **Symbol quick open** (`@symbol`, `#symbol`). `codegraph` could answer it; it is not this row.
- **Command-mode prefixes** (`>` for commands, `:` for line). ⌘⇧P already owns commands.
- **Multi-select, open-to-the-side, open-all.** No split view exists in this workspace.
- **Filtering by git status**, despite `fileTree.ts:101` holding the status map. Not in the row.
- **A Web Worker** for matching (D3 conclusion 3).
- **Generalising `CommandPalette.vue`** into a shared base (D4).
- **Any Go-side quick-open API** (D1).

## 10. Verification

1. `bun run typecheck`, `bun run lint`, `bun run build`.
2. `go build ./...`, `go vet ./apps/kira-studio/internal/shell/... ./apps/kira-studio/internal/bridge/...`,
   `go test ./apps/kira-studio/internal/...`.
3. `bun run test:unit`.
4. `bun run test:ui` for `repo-workspace.spec.ts` plus the existing tabs/mode/smoke specs.
   `bun run test:visual`: the quick-open palette is a new overlay — if it produces a snapshot, it is
   reviewed deliberately, never blanket-accepted.
5. **Bundle check**: confirm `bun run build`'s main chunk grows by roughly the measured 8.4 KB gzip
   and that `monacoEntry-*.js` is unchanged — i.e. `fuzzysort` did not land inside the Monaco chunk.
6. **Manual pass against this repository itself** (substituting for the unavailable GUI; recorded in
   the commit message, the posture C1 §13 and C7 §13 both took):
   - import `kira-studio`, open its workspace, press ⌘P with the project panel **collapsed** — the
     list must populate (D8's whole reason);
   - type `repotabs` — `apps/kira-studio/frontend/src/state/repoTabs.ts` ranks first;
   - type `cw` — `codeworkspace` files appear, proving subsequence matching (the substring filter
     C9 declined returns nothing for this);
   - type `readme` — `README.md` appears, proving the listing is not the parseable-file subset
     (D1's second argument, the one that would silently regress);
   - Enter opens a preview tab (italic title, replaced by the next preview open); ⇧Enter opens a
     permanent one; both land at line 1;
   - Escape closes without opening anything; ⌘⇧P still opens the **command** palette, unchanged.
7. **Workspace gate**: ⌘P in studio and in api opens nothing and logs nothing (D6).
8. **Cross-check the ranking claim once, by hand**: for two or three queries, list every path
   containing the query's characters in order (`git ls-files | grep -i "r.*e.*p.*o"` for `repo`) and
   confirm C9's top result is defensible against that candidate set — that the ranking is picking
   well, not that the candidate set is right. A developer cross-check only, with no tool beyond git
   and grep; `fzf` is deliberately not used, since it is not in this repo's dev container.

## 11. Open questions for a human

1. **Menu label and placement.** "Go to File…" is VS Code's name and this plan's choice, in the View
   section above "Command Palette…". "Quick Open…" matches SPEC's own row title. Naming only — say
   which, and S1 uses it.
2. **⇧Enter for a permanent tab.** D7 adds a modifier that no existing surface has (the tree and C7's
   results use double-click, which a keyboard palette cannot offer). The alternative is
   preview-only, with permanent promotion left to double-clicking the resulting tab. Plan assumes
   ⇧Enter; it is one line to drop.
3. **`fuzzysort` as a new dependency at all.** D2 argues it clears `CLAUDE.md`'s bar and the decline
   of Monaco's internal scorer is on stated technical grounds — but "no new dependency" is a
   defensible alternative reading, at the cost of a hand-maintained `.d.ts` for an untyped internal
   module plus a hand-rolled item-level ranker. Flagged because it is the phase's only irreversible
   choice.
4. **Doc nit, not this phase's to fix**: `docs/v1.5/plans/C7-search-go-native.md`'s §12 says
   "Quick Open (C8)". C8 is repo-map source-line context; quick open is C9. Worth a one-line `docs:`
   fix whenever someone is next in that file.
