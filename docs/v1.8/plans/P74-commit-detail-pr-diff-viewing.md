# P74 — Commit detail, PR integration and diff viewing

`docs/v1.8/SPEC.md`'s P74 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `e50b3eba`, P71-P73 landed); line numbers are from
that tree. `TabStrip.vue` was re-read after both P72 §7 (pinned tab split out of the scrolling
strip) and P73 §2.2 (`TabIcon` union), not from pre-P73 context.

Six items in two halves. Unlike P73, this phase **does** touch `packages/git-ui/`, so every change
there lands in the desktop app and the VS Code extension at once — §0's host table says which host
each item is actually about.

**Part A — commit detail and PR.** "Show more"; the PR link's host-webview navigation; a PR icon
on the detail pane's time/sha line for any commit on a PR branch.

**Part B — diff viewing.** Open every changed file; open them as preview tabs that promote on
double click; a working "Go to file", virtual diff content included.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| **Where the "embedded webview" PR path lives** — SPEC says confirm before changing | **Nowhere. There is no embedded-PR feature to relocate.** The PR is a bare `<a :href="pr.url">` (`CommitMeta.vue:334`-`340`); nothing in `apps/kira-studio/` or `apps/kira-studio-vscode/` opens a PR in a webview. Under Wails a bare same-window anchor *navigates the app's own WKWebView to github.com* — that is the reported symptom, and it is an absent external-open path, not a present embedded one | §3 |
| Does "Show more" really do nothing? | **Partly, and not for the reason the row assumes.** The toggle flips (verified in the compiled bundle and by a green harness test). Two defects sit on top of it: the Refs row inside the expanded region can never become visible, and the expanded region is capped and clipped by `.kv-detail-pane-meta`. A third candidate (host-dependent percentage resolution) is unproven and gets a decisive check, not a speculative fix | §1, §2 |
| Which "time/sha line" gets the GitHub icon | `CommitMeta.vue`'s `.kv-meta-facts` row (`:279`-`296`) — date · short sha, the one part of the pane visible while collapsed | §4.3 |
| How a non-tip commit resolves a PR without a GitHub call per row | `commit.resolvePr` already answers per commit (`GET /repos/{o}/{r}/commits/{sha}/pulls`, `ghclient/pr.go:97`), but one REST call per rendered row is not affordable. Derive instead: walk ancestors from a PR branch tip through the already-loaded `CommitStore` | §4.1, §4.2 |
| Does "open all changes" open one file? | **Not in the code as it stands.** Both hosts open every file. The desktop handler loops `detail.files` (`hostHandlers.ts:280`-`289`); the extension prefers `vscode.changes` and falls back to a `{ preview: false }` loop — VS Code's own single-preview-tab collapse was already root-caused and fixed once (G19 D8/F8). The one live mechanism that produces exactly this symptom is the desktop's single preview slot, which is what SPEC's *next* ask turns on | §5.1 |
| Can N diff tabs be preview tabs? | **Not under the current model** — `openTab` evicts the workspace's previous preview tab on every preview open (`tabs.ts:382`-`399`), so N preview opens leave one tab. The two asks must be designed together: a preview *cohort*, not a preview *slot* | §5.2 |
| What promotes a preview tab today | A permanent re-open, or starting a drag (`moveTab`, `tabs.ts:737`-`738`). `TabStrip.vue` has **no** `@dblclick` handler at all | §6 |
| Why "Go to file" is dead | The desktop host refuses `editor.goToFile` outright (`hostHandlers.ts:375`) and advertises `capabilities.goToFile: false` (`:185`); no UI caller has existed since G21 D12 deleted `DiffView.vue` | §7 |
| New unit tests | **One**, in an existing file (`state/pr.test.ts`) for §4.2's ancestry walk. Everything else is UI wiring and gets Playwright assertions in existing specs | §10 |
| One Sonnet pass or a split | One, with a real seam between Part A and Part B | §11.2 |

### 0.1 Which host each item is about

| Item | Kira Studio | VS Code extension |
|---|---|---|
| §2 "Show more" | yes | yes (same `git-ui` component) |
| §3 PR external link | **yes — this is the broken host** | already correct; must stay correct |
| §4 PR icon on the facts row | yes | yes |
| §5 open all changes as preview | **yes — desktop tab model only** | no change |
| §6 promote on double click | **yes — `TabStrip.vue` only** | no (VS Code owns its own strip) |
| §7 Go to file | **yes — new implementation** | already implemented; reused as the reference |

---

# Part A — commit detail and PR

## 1. "Show more": what is proven, and what is not

### 1.1 The toggle itself works

`CommitMeta.vue:47` holds one `expanded` ref; `:305`-`307` flips it; `:301` (`v-show`) reveals the
body; `:309` (`v-if`) mounts the identities/trailers/details region. Three independent confirmations
that this is not where the defect is:

- `KuiButton` declares no `emits`, so `@click` falls through to its root `<button>`
  (`KuiButton.vue:9`-`12` states this explicitly). The handler runs.
- The shipped bundle compiles the binding intact:
  `class: normalizeClass(['kv-commit-meta', {'kv-detail-pane-meta--expanded': expanded.value}])`,
  and `DetailPane.vue`'s `class="kv-detail-pane-meta"` is a static prop on the child, so both
  classes land on the same element and `.kv-detail-pane-meta.kv-detail-pane-meta--expanded`
  (`max-height: 50%; overflow: auto`) matches.
- `apps/kira-studio-vscode/tests/interaction/commit-meta-clamp.spec.ts:50`-`66` clicks the toggle
  and passes today.

`expanded` is also never reset behind the user's back: the only writer besides the click is the
watch at `:87`-`94`, whose sources are `props.detail` and `bodyEl`, and `DetailState.detail`
(`state/detail.ts:32`) is written only by `select`/`setParentIndex`/`#requestDetail`.

**So do not "fix" the toggle.** An implementer who rewrites the ref, the watch or the button is
changing working code.

### 1.2 Why the green test proves less than it looks

`commit-meta-clamp.spec.ts` asserts `.kv-meta-body` is visible and that its own `clientHeight`
equals its own `scrollHeight`. Neither reads an **ancestor**. A body element fully clipped by
`.kv-detail-pane-meta`'s `overflow: hidden` still has a non-zero box, still counts as visible to
Playwright, and still reports `clientHeight === scrollHeight`. The harness also runs over a fixed
480px `#app` (`commitMetaHarnessServer.ts`), which is taller than the pane in either real host.

That is the gap this item closes: the assertion must move to the pane, not the paragraph.

### 1.3 The two provable defects

**(a) The Refs row can never appear.** `CommitMeta.vue:325`-`326`:

```vue
<dt v-if="decorationEl?.childNodes.length">Refs</dt>
<dd v-show="decorationEl?.childNodes.length" ref="decorationEl" class="kv-meta-refs"></dd>
```

`renderDecoration` (`:73`-`82`) appends badge nodes by direct DOM mutation, inside a `nextTick`
scheduled by the watch at `:98`. `childNodes.length` is not reactive and nothing schedules a render
after it changes. The only render this can ever trigger is `decorationEl` going `null` → element,
which happens **before** `renderDecoration` runs (the ref is set during patch; `nextTick` resolves
after the flush). At that render `childNodes.length` is `0`, so `<dt>` is not emitted and `<dd>`
gets `display: none` — and stays there.

Result: on a commit that carries refs, "Show more" reveals an expanded region with the Refs row
silently missing. `hasDetails` (`:189`-`194`) reads `props.detail.decoration.length` instead, so
the surrounding `<dl>` *does* render — which is why this reads as "expanding shows nothing useful"
rather than as an empty box.

**(b) The expanded region is clipped by a percentage cap.** `DetailPane.vue:111`-`120`:

```css
.kv-detail-pane-meta { flex: 0 0 auto; max-height: 20%; overflow: hidden; }
.kv-detail-pane-meta.kv-detail-pane-meta--expanded { max-height: 50%; overflow: auto; }
```

Collapsed content (subject row + facts row + toggle + `--kv-s-4` padding either side) is roughly
80px. At 20% that needs a ~400px pane before the toggle itself is even inside the box. In Kira
Studio the graph is a full tab, so it clears that; in the VS Code extension the graph is a bottom
panel that is routinely 250-350px, where 20% is ~60px and the toggle is clipped away entirely.
Expanded, 50% of that same panel is ~150px — a cramped inner scroller nested inside
`.kv-detail-region`'s own `overflow: auto` (`App.vue:1887`).

### 1.4 The one unproven candidate, and the check that settles it

`.kv-detail-pane` is `height: 100%` (`DetailPane.vue:103`) inside `.kv-detail-region`, which sets
no height of its own and is stretched as a flex item of `<main>`. Whether `max-height: 20%` then
resolves against a definite height or degrades to `none` is engine- and layout-dependent, and it
flips the symptom: resolved means clipping (§1.3b), unresolved means no cap at all.

**Run this before writing any CSS**, in both hosts, on a commit with a long body and at least one
ref, with the pane at its normal height:

```js
const meta = document.querySelector('.kv-detail-pane-meta');
const cs = getComputedStyle(meta);
({ maxHeight: cs.maxHeight, overflow: cs.overflowY,
   client: meta.clientHeight, scroll: meta.scrollHeight });
```

Record it in the commit message. `maxHeight` in `px` means the cap resolves; `none` means it does
not. `scroll > client` after expanding means content is being hidden.

§2 is correct under every outcome, which is why the check gates the commit message and not the fix.

## 2. Fixing "Show more"

### 2.1 The Refs row

Replace the non-reactive DOM read with a value the render already knows. `props.detail.decoration`
is exactly what `renderDecoration` feeds `buildRefBadges`, and `refBadges.ts` returns `null` only
for an empty array — the same equivalence `hasDetails` (`:189`-`194`) already relies on and
documents:

```vue
<template v-if="detail.decoration.length > 0">
  <dt>Refs</dt>
  <dd ref="decorationEl" class="kv-meta-refs"></dd>
</template>
```

`v-show` goes away with it: a `<dd>` that only exists when there are badges needs no second gate.
`hasDetails` is unchanged, and its doc comment's explanation of why it reads props rather than the
DOM now describes the whole component rather than one exception in it.

### 2.2 The cap

The cap exists for a real reason — G-UX D7's "the tree keeps its share of the pane" — and
`commit-meta-clamp.spec.ts:118`-`136` guards it. Keep the collapsed half exactly as it is. Change
only the expanded half, so the two states stop being two values of one rule:

```css
/* Collapsed: unchanged — a bounded, non-scrolling header the file tree is measured against. */
.kv-detail-pane-meta { flex: 0 0 auto; max-height: 20%; overflow: hidden; }

/* Expanded: a real region of the pane, never a percentage the tree can squeeze to nothing.
   min-height is what makes the expansion visible even in a short panel; the tree keeps the rest. */
.kv-detail-pane-meta.kv-detail-pane-meta--expanded {
  flex: 0 1 auto;
  min-height: min(220px, 60%);
  max-height: 70%;
  overflow: auto;
}
```

Three deliberate parts, each with a reason rather than a taste:

- `flex: 0 1 auto` — expanded, the meta may shrink under pressure; collapsed it may not. `0 0 auto`
  in both states is what let a short panel leave the expansion at its collapsed height.
- `min(220px, 60%)` — a floor in px so a 300px panel still gains real room, bounded by a
  percentage so a tall pane never hands the header more than it needs. No bare literal: the `60%`
  is the same kind of pane-relative bound the collapsed rule already uses.
- `max-height: 70%` with `overflow: auto` — a long body still scrolls rather than evicting the
  tree. The tree's own `flex: 1 1 auto; min-height: 0` (`:122`-`127`) is what leaves it a row or
  two; nothing else changes.

`commit-meta-clamp.spec.ts:118`-`136` asserts the ≥75% tree share **while collapsed**, so it is
unaffected by every line above.

### 2.3 What is deliberately not changed

- The toggle, the watch, `renderBody`, `bodyParagraphs` (§1.1).
- The collapsed view's content. SPEC asks to fix expansion, not to reopen G-UX items 6/7's
  decision about what shows while collapsed.
- `.kv-detail-region`'s own `overflow: auto`. Removing it would fix the nesting but break the
  `<600px` overlay drawer (`App.vue:1914`-`1927`), which is the one layout that relies on it.

## 3. The PR link: where the "embedded webview" actually is

### 3.1 The answer SPEC asked to confirm

**There is no embedded-PR webview anywhere in this repository.** Searched and empty:

- No `webview` reference in `apps/kira-studio/frontend/src` or `apps/kira-studio-vscode/src`
  relates to a PR; every hit is about the app's own WKWebView, the extension's own graph panel, or
  a comment in `internal/`.
- No `openExternal`, no `_blank`, no `openPr`/`openPrUrl` in either app.
- The only browser-open path that exists at all is `UpdateService.OpenReleasePage`
  (`internal/bridge/update.go:48`-`54`), reached from the frontend as
  `updateOpenReleasePage` (`bridge/index.ts:81`).

The PR is rendered as a plain anchor, twice:

- `CommitMeta.vue:334`-`340` — the detail pane's "Pull request" row.
- `StackList.vue:106` — the stack view's PR link.

`linkify.ts:3` states the assumption behind both: *"renders URLs as `<a href>` and lets the host's
own webview link handling take them"*.

**That assumption is true in exactly one of the two hosts.** VS Code intercepts an `http(s)` anchor
click inside a webview and hands it to the external browser. Wails does not intercept anything —
there is no click handler on anchors anywhere in `apps/kira-studio/frontend/src`, so the click is
an ordinary same-window navigation and the app's own window becomes github.com, with no back
button. That is the reported "opens the PR in an embedded webview", and it is an **absent external
open**, not a present embedded one.

Stated plainly, as SPEC requires: the path is not where SPEC guessed it might be (the desktop app's
git integration, or the VS Code extension host). It is in `packages/git-ui` after all — as a
missing action, which is why the chapter's scoping pass found nothing in the commit-detail code.

### 3.2 Inline status plus an external link

`CommitMeta.vue` already computes everything the status needs — `prDetail`
(`:160`-`179`) maps each `PrRecord` to `{ number, title, url, stateLabel }` over `PR_STATE_LABEL`
(`:142`-`147`, `open`/`draft`/`merged`/`closed`). The row is behind "Show more" and renders the
state as trailing text after an em dash.

Changes, all in `CommitMeta.vue`:

- Render the state as a badge beside the number, reusing the `--kv-badge-pr-*-fg` tokens
  `CommitGrid.vue:1290`-`1313` already defines for the grid's own PR badge, so the panel and the
  grid cannot disagree about what "merged" looks like. `prDetail.prs` gains `state` alongside
  `stateLabel` — the label is display text, the raw state picks the token.
- Replace each `<a :href>` with a `<button type="button">` calling a new action (§3.3). An anchor
  whose href the host must not follow is a trap; a button says what it is.
- Keep the row's own text unchanged otherwise.

`StackList.vue:106` gets the same treatment in the same commit — it is the second instance of the
identical defect, and leaving it would mean a PR link that hijacks the window still exists one
component over.

### 3.3 The external-open action

The renderer must not hand Go a URL. `appupdate/checker.go:170`-`186` is explicit about why:
*"BrowserManager.OpenURL (pkg/application) validates nothing at all, and macOS `open` will act on
any scheme it recognises, so this is the only check that ever runs before a URL reaches it."*
`OpenReleasePage` is nullary for exactly that reason.

So the contract carries a PR **number**, never a URL:

1. **Contract** — a new request `pr.openExternal`, `params: { repoId: string; number: number }`,
   `result: Record<string, never>`. Host-answered (add it to `validate.ts`'s extension-answered
   set beside `editor.openAllChanges`), so the Go git server is untouched by it.
2. **`git-ui`** — `DetailActions` gains `openPullRequest(params: { number: number }): Promise<void>`,
   implemented in `createDetailActions` the same way `openAllChanges` is (`detailActions.ts:93`-`97`):
   resolve `repoId()`, throw when absent, make the request. `ReviewView.vue:324`-`345` and
   `state/review.ts:419`-`432` build the same bundle by hand and each gain the same three lines.
3. **A URL the *server* composes** — a new Go request `pr.browserUrl`,
   `params: { repoId, number }`, `result: { url: string } | { url: null }`, answered by
   `RepoEntry` over its existing `githubRepo(ctx)` resolution (`gitsession/gh.go:373`-`375` already
   calls it) and `url.PathEscape`'d exactly as `PullsForCommit` escapes its own sha
   (`ghclient/pr.go:93`-`97`). `null` when GitHub is disabled or there is no GitHub remote — the
   same "disabled collapses to nothing" posture `PrLookupResult` already takes.
4. **Desktop host** — `hostHandlers.ts` answers `pr.openExternal` by requesting `pr.browserUrl`
   over `deps.remoteRequest` and passing the result to a new `bridge.Browser` caller,
   `GitHubService.OpenPullRequestURL(url string)`, which re-validates `https` + host `github.com` +
   a `/{owner}/{repo}/pull/{n}` path shape before `Browser.OpenURL` — `safeReleaseURL`'s own
   check (`checker.go:170`-`186`), applied to the one other URL this app will ever open. Two
   validations, on both sides of the process boundary, because the boundary is the thing being
   defended.
5. **VS Code host** — `proxyHandlers.ts` answers `pr.openExternal` by requesting `pr.browserUrl`
   and calling `vscode.env.openExternal(vscode.Uri.parse(url))`. First use of `openExternal` in
   this extension; it belongs in `ports/`, not in the handler, matching how every other host
   capability there is seamed.

**Why not just send `PrRecord.url`.** It is already in the client, and it came from GitHub's own
API — but it arrives over a socket, and `internal/shell/app.go:129`-`134` performs no validation
whatsoever before handing a string to the OS. Composing server-side keeps the desktop's existing
invariant ("the renderer never supplies a URL") intact rather than carving the first exception into
it. The cost is one small Go request; the alternative is a renderer-to-`open(1)` path.

**Capability gating.** `EditorCapabilities` is the wrong home — this is not an editor action. Add
`openExternal: boolean` to `app.init`'s `capabilities` (both hosts return `true`), and gate the
button on it, so a future host without a browser renders the number as plain text rather than a
dead control. No stub, no silent no-op.

## 4. A PR icon for any commit on a PR branch

### 4.1 What exists, and what is genuinely missing

`PrState` (`state/pr.ts`) already holds three things:

- `bySha` (`:46`) — per-commit records, populated **only** for the sha `select()` was last called
  with (`:134`-`154`, then `#applyCommitResult` at `:180`-`192`). `CommitGrid.vue:267`/`:637` read
  it for the grid badge, so a commit shows a grid PR badge only after it has been selected.
- `byBranch` (`:50`) — per-branch records from `branch.resolvePr`. This is the branch-tip-only
  lookup SPEC names.
- `selected` (`:65`) — the full `PrLookupResult` for the current selection, which is what
  `CommitMeta.vue`'s PR row renders.

The server is not the limitation. `commit.resolvePr` runs
`GET /repos/{owner}/{repo}/commits/{sha}/pulls` (`ghclient/pr.go:97`), which already answers for any
commit in a PR, not only its head. The limitation is that one REST call per commit cannot warm a
rendered window, and `PR_ENSURE_SNAPSHOT_CONCURRENCY` (`pr.ts:15`) exists precisely because this
class already learned that lesson once for branches.

### 4.2 Derive the association, do not fetch it

Every ingredient is already in the client:

- `PrRecord.headRef` and `headSha` (`contract.ts:1182`-`1183`).
- `byBranch`: branch short name → its `PrRecord`.
- `CommitStore`: `rowOfSha(hex)` (`:257`), `parentsOf(row): Int32Array` (`:339`), `rowCount`
  (`:191`) — a packed columnar store, so an ancestor walk is typed-array reads with no per-row
  allocation.

Add to `PrState`:

```ts
/** Commits reachable from a PR branch's tip within the loaded graph window, keyed by sha.
 *  Derived, never fetched: the value is the branch's own PrRecord. */
readonly prByAncestry: ShallowRef<ReadonlyMap<string, PrRecord>>;

/** Rebuilds `prByAncestry` from the PR records currently in `byBranch`. Called by
 *  `CommitGrid.vue` when `pr.generation` or the store's own row count changes. */
rebuildAncestry(store: CommitStore): void;
```

The walk, once per rebuild rather than once per row:

1. Seed a queue with `rowOfSha(record.headSha)` for every entry in `byBranch` whose row is in the
   store (a tip outside the loaded window contributes nothing, correctly).
2. Breadth-first over `parentsOf`, marking each visited row with that branch's record, skipping a
   row already marked (first writer wins — a commit on two PR branches shows one icon, and the
   grid has no room for two).
3. Stop at a fixed budget of visited rows. A long-lived `main` whose own tip has a PR would
   otherwise walk the entire loaded history; the budget makes the cost proportional to the window,
   not to the repository.

`PrState` does not hold a `CommitStore` (it holds only `bridge`, `:67`), so `rebuildAncestry` takes
one — the same explicit-argument deviation, for the same reason, that `ensureSnapshot` already
documents at `:25`-`29`. `#clear()` (`:113`-`128`) clears the new map alongside the others, so a
repo switch or `refsChanged` drops a stale association exactly as it drops `byBranch`.

**Lookup order** — a new `prForCommit(sha)`:

1. `bySha` first. It is an authoritative per-commit answer from GitHub.
2. `prByAncestry` second. It is a derivation and must never override a real answer.
3. `undefined` otherwise, which every consumer already renders as nothing (`:41`-`45`).

This is the phase's one piece of genuinely rule-shaped logic, and §10 gives it a test.

### 4.3 The icon on the facts row

`CommitMeta.vue:279`-`296` is the row: a relative date with an absolute-date tooltip, a separator,
and a short-sha copy button. Append a third element, rendered only when `prForCommit(detail.sha)`
answers:

```vue
<button
  v-if="prIcon"
  type="button"
  class="kv-meta-pr-icon"
  :class="`kv-meta-pr-icon--${prIcon.state}`"
  v-kui-tooltip="`#${prIcon.number} ${prIcon.title} — ${prIcon.stateLabel}`"
  :aria-label="`Open pull request #${prIcon.number} on GitHub`"
  data-testid="commit-meta-pr-icon"
  @click="openPullRequest(prIcon.number)"
/>
```

- **`github` from the codicon set**, sized off `--kv-icon-box`
  (`theme/kira-structure.css:40`, 16px) and coloured by the same `--kv-badge-pr-*-fg` token §3.2
  uses. One icon, one colour per state, no text — the facts row is 0.85em and already carries two
  items. No literal px: if 16px reads heavy against 0.85em text, scale it in `em` off the row's own
  size rather than introducing one.
- The tooltip carries the number, the title and the state, so the icon is not the only way to know
  what it points at. The `aria-label` says what clicking does.
- Clicking calls §3.3's action. The icon and the "Show more" row are two affordances for one PR;
  they must not be two different open paths.

`DetailPane.vue` threads it: `:pr-for-commit="pr?.prForCommit(detailState.sha.value ?? '')"`,
beside the existing `:pr-result` (`:74`). `CommitMeta.vue` stays a pure render of props, as it is
today — it never reaches into `PrState`.

`CommitGrid.vue:267`/`:637` switch from `props.pr?.bySha.value.get(sha)` to
`props.pr?.prForCommit(sha)`, which is what makes the grid badge appear for a non-selected commit
too. `columns.ts`'s `PrContext.prsFor` signature (`:82`-`83`) is unchanged; only what the two
accessors return changes. **`rowMetadata`'s `hasPr` check (`columns.ts:313`-`315`) reads the same
accessor**, so row heights stay in step — the exact coupling P72 §5 had to fix once already
(`invalidateRowHeights()` when PR badges resolve). `rebuildAncestry` must therefore run inside the
existing `pr.generation` watcher, before that invalidation, not in a separate one.

---

# Part B — diff viewing

## 5. Open every changed file, as preview tabs

### 5.1 What "opens only one" is, measured against the code

Neither host opens one file today:

- **Desktop** — `hostHandlers.ts:265`-`291` fetches one `commit.detail` and loops every entry of
  `detail.files` into `openRepoCommitDiffTab(..., true)`. The `true` is `pinned`, so each call
  reaches `openTab` with `preview: false` (`repoTabs.ts:113`) and each pushes its own tab. This
  block has not changed since it was introduced (`3e9a9a7a`).
- **Extension** — `proxyHandlers.ts:373`-`387` composes the file list and calls the port, which
  probes `vscode.changes` and otherwise falls back to a `{ preview: false }` loop. That
  `{ preview: false }` is G19 D8's own fix for this exact symptom, and its comment still records
  the cause: *"With no fourth argument, VS Code opens every diff in the same single preview tab, so
  a sequential loop over every changed file just keeps replacing that one tab"*
  (`ports/editorIntegration.ts:110`-`114`).

So the symptom is real, the mechanism is known, and **the desktop has the same mechanism, currently
switched off by `pinned: true`**. `openTab`'s preview branch (`tabs.ts:382`-`399`) evicts the
workspace's previous preview tab with `closeTab(evictedId)` before inserting the new one — one slot
per workspace, by construction.

That is why SPEC's two diff asks cannot be implemented independently. Flipping `true` to `false` at
`hostHandlers.ts:287` satisfies "open them as preview tabs" and re-creates "opens only one" in the
same line.

**Before writing code, confirm which host the report came from**: open a commit with several
changed files, click "Open all changes", count tabs. Record the count per host in the commit
message. If the desktop already opens N, this item is §5.2 alone; if it opens one, the counting
also names which of `openRepoCommitDiffTab`'s two branches is being taken.

### 5.2 A preview cohort, not a preview slot

`previewIdByWorkspace` is `Record<WorkspaceKey, string | null>` (`tabs.ts:82`). Widen the value to a
set of ids, keyed the same way:

```ts
previewIdsByWorkspace: {} as Record<WorkspaceKey, readonly string[]>,
```

Rules, each a direct translation of the ones already written down in `tabs.ts`:

- **A single-file preview open still evicts.** `openTab` with `preview: true` and no cohort closes
  every id currently in the workspace's array — which, for one id, is byte-identical to today's
  `closeTab(evictedId)`. A tree click still replaces the previewed file, as C5 §5.2 rule 3 requires.
- **A bulk open declares a cohort.** `openTab` gains `previewCohort?: boolean`; when set, the new
  tab joins the array instead of replacing it. `editor.openAllChanges` evicts once, before the
  first file, then appends the rest.
- **Promotion removes one id**, leaving the rest previewed — a double-click on one of ten diff tabs
  keeps that one and leaves nine replaceable. Today's "clear the slot" becomes "remove this id".
- **Every existing clear becomes a filter.** `closeTab` (`:595`), `closeWorkspaceTabs` (`:624`),
  `closeOthers` (`:644`), `closeToTheRight` (`:672`), `closeAll` (`:700`), `moveTab` (`:738`),
  `isPreview` (`:771`) and `openTab`'s own reuse branch (`:353`) each already touch the slot; each
  becomes an array filter or an `includes`. No new call site.
- **Not persisted.** The slot is runtime-only today (`tabIncognito.ts:7` names it as precedent) and
  stays that way: a restored session has no preview tabs, exactly as now.

`openRepoCommitDiffTab`/`openRepoReviewDiffTab`'s own promote-on-reuse lines
(`repoTabs.ts:97`-`99`, `:145`-`147`) become the same filter, and both grow a `previewCohort`
pass-through.

Then `hostHandlers.ts:287` passes `pinned: false` with the cohort flag set, and `openAllChanges`'s
own `mode` stays `'tabs'` — the returned shape is unchanged, so `CommitMeta.vue:237`-`257`'s
announcement needs no edit.

**The extension is not touched by any of this.** VS Code owns its own tab strip and its own preview
rules, and `{ preview: false }` there is a fix this phase must not undo.

## 6. Promote on double click

`TabStrip.vue` renders `.is-preview` (`:240`, `:394`) and `data-preview` (`:247`) but binds no
`@dblclick` anywhere — the only promotions today are a permanent re-open and a drag start.

- Export `promoteTab(id: string): void` from `state/tabs.ts`: remove `id` from its workspace's
  preview array, `saveNow()` only if it was there. One place, so the rule cannot drift from the
  filters §5.2 introduces.
- Bind `@dblclick="promoteTab(tab.id)"` on the scrolling loop's `.p-tab`. The pinned slot needs
  none: a pinned tab is never a preview tab.
- A double click also fires two `click`s first, so `onClick` runs and activates the tab. That is
  the wanted order — activate, then promote — and needs no `@click.prevent` guard.

"the same double-click/explicit-edit interaction the file-tree preview convention already uses" is
satisfied by the double click alone here: `FileTree.vue`'s convention is click-previews /
double-click-pins (`DetailPane.vue:46`-`49`), and a **diff tab is read-only** — `RepoDiffView.vue`
mounts Monaco read-only, so there is no edit that could promote one. Stated rather than left as a
silent omission: no "explicit edit" trigger is added, because no such edit exists on this tab kind.

## 7. Go to file

### 7.1 Why nothing happens today

Three layers, all currently off in the desktop app:

| Layer | State |
|---|---|
| `app.init` capability | `goToFile: false` (`hostHandlers.ts:185`) |
| Host handler | `refuseLocally('editor.goToFile', 'has no native caller')` (`:375`) |
| UI caller | none anywhere — `detailActions.ts:55`-`61` records that the last one went with `DiffView.vue` at G21 D12 |

The extension implements all three. `goToFile.ts` is the whole algorithm and is deliberately
`vscode`-free so both its callers can share it:

```ts
const target = await connection.request('file.goToTarget', { repoId, rev, path }, signal);
// 'live'      -> mapLineAcrossDiff(target.hunks, line, 'old'), reveal the real file
// 'historical'-> reveal a virtual document at target.rev/target.path
// 'unavailable' -> pass the reason through
```

`file.goToTarget` (`contract.ts:2043`-`2056`) is a **Go-served** request, so the desktop already has
it. `mapLineAcrossDiff` is `@kira/git-core`, already imported by the frontend's own workspace.
**Nothing new needs implementing at either end — only wiring, and one thing the desktop lacks.**

SPEC names `actions.openInEditor` as the behaviour to match. That method opens a *diff*
(`detailActions.ts:37`-`44`); the one that jumps to a real file and line is `goToFile` on the same
bundle. The plan implements `goToFile` and leaves `openInEditor` alone.

### 7.2 The desktop handler

Replace the refusal at `hostHandlers.ts:375` with the same three-branch composition, over the tab
helpers this file already imports:

- **`live`** — `mapLineAcrossDiff(target.hunks, line, 'old')` when `hunks !== null`, else the line
  unchanged (`hunks: null` means "do not re-map", `contract.ts:2049`-`2051`). Then
  `openRepoFileTab(codeRepoId, path, { preview: true, reveal: { line } })`, whose `reveal` already
  handles both a fresh tab and a reused one (`repoTabs.ts:40`-`46`). Return
  `{ kind: 'liveFile', path, line }`.
- **`historical`** — §7.3.
- **`unavailable`** — return it verbatim. The reason (`notInRevision` / `binary` / `tooLarge`)
  is the caller's to announce; the handler invents nothing.

`capabilities.goToFile` becomes `true`, and `hostHandlers.ts:182`-`185`'s comment is replaced by
nothing — a true capability needs no explanation.

Import `mapLineAcrossDiff` from `@kira/git-core`, the same package `reviewDecorations.ts` already
imports. **Do not re-derive the line arithmetic** — `goToFile.ts:1`-`6` carries G4 D11's own warning
against a second implementation, and it applies to this host exactly as it did to that one.

### 7.3 Virtual content — the one thing the desktop lacks

SPEC's "working for virtual/synthetic diff content (deleted/renamed/staged-only) too" is the
`historical` branch: a path that does not exist in the worktree at all. The extension answers it
with a `kira-version:` virtual document (`ports/editorIntegration.ts`'s `SCHEME`). The desktop has
no equivalent: `repo-file` is a worktree file (`repoFileTabStateSchema`,
`packages/shared/domain/tabs.ts:277`-`280`, is `revealLine` + `markdownReading` and nothing else),
and `repo-diff` is a two-sided comparison.

**Extend `repo-file` rather than forking a tab kind**, which is the move `repoDiffTabStateSchema`
itself already made twice (C10's revision pair, C11's `review` layer — `:283`-`307`):

```ts
export const repoFileTabStateSchema = z.object({
  revealLine: z.number().int().min(1).nullable().default(null),
  markdownReading: z.boolean().default(false),
  /** Non-null: this tab shows `path` at that revision, read-only, not the worktree file. */
  rev: z.string().nullable().default(null),
});
```

`.default(null)` keeps every tab saved before this field restorable — the discipline `revealLine`
and `markdownReading` both already follow, quoted in their own comments.

`RepoFileView.vue` branches on it: `rev === null` reads the worktree file as today; non-null reads
`file.read { repoId, rev, path }` over the git transport — the same request `RepoDiffView.vue`
already uses for a commit diff's two sides (`RepoDiffView.vue:33`-`39`'s `toDiffSide`), whose
`missing`/`binary`/`tooLarge` classification the file view must render through the existing
`EmptyState` component rather than a fourth error shape. The editor is read-only either way, so no
write path is reached.

`openRepoFileTab` gains the revision in its dedupe key — the same collision
`openRepoCommitDiffTab` documents at `repoTabs.ts:63`-`68` ("two different commits' diffs of the
same file into one tab"), one kind over. `repoFileTitle` (`tabKinds.ts:164`-`170`) appends the short
rev, matching `repoDiffTitle`'s own `(abc1234 ↔ def5678)` suffix.

P73 §3.2 left `repo-diff`'s icon on `git-compare` partly because a historical file tab did not
exist. It still reads correctly: a `repo-file` tab at a revision keeps its seti icon (it is a file),
a `repo-diff` tab keeps `git-compare` (it is a comparison). **No icon change in this phase.**

### 7.4 Where the action surfaces

Two callers, mirroring the extension's two, and no more:

1. **The diff tab** — the extension contributes `kiraVersion.goToFileFromDiff` to the diff editor's
   title bar (`diffToolbar.ts:1`-`5`). `RepoDiffView.vue` has no toolbar and this phase is not
   adding one. Register a command instead — `registerCommand('repo.goToFileFromDiff', …)` beside
   the `view.find` registration already there (`:192`-`195`) — reading the cursor line from the
   modified editor (`editorForTab`, `views/repo/editors.ts:121`) and the revision from the tab's own
   `right`. That is the app's existing mechanism for an editor-scoped action; a bespoke floating
   button would be a second one.
2. **A file row in the commit detail tree** — `FileTree.vue`'s row actions, gated on
   `actions.capabilities.goToFile`, calling `actions.goToFile({ rev: sha, path, line: 1 })`. Line 1
   because a tree row has no cursor; the row's job is "take me to this file", and the editor's own
   command covers "take me to this line".

Both announce the outcome through `actions.announce`, exactly as `openAllChanges` does
(`CommitMeta.vue:245`-`256`): `liveFile` and `virtualBlob` confirm, `unavailable` states the reason.
No silent failure — `CLAUDE.md`'s no-stub rule applied to the one branch that is easiest to drop.

## 8. Deliberately out of scope

- **`DiffView.vue`.** Deleted at G21 D12; §7 gives `goToFile` two new callers, it does not restore
  the in-panel diff.
- **The reading view, tab icons, the graph layout.** P73 and P72 own those; nothing here reopens
  either.
- **Warming `commit.resolvePr` across a rendered window.** One REST call per row, against the
  limit `PR_ENSURE_SNAPSHOT_CONCURRENCY` (`pr.ts:15`) exists to bound. §4.2 derives instead.
- **PR review comments, checks, merge state beyond `PrRecord.state`.** SPEC asks for
  open/closed/merged; `PrRecord` already carries it, and nothing more is added to the wire.
- **A second worktree-file-at-revision surface.** §7.3 extends `repo-file`; `repo-diff` and
  `review` stay as they are.
- **The VS Code extension's tab strip and preview rules** (§5.2), and its already-correct external
  link handling (§3.1).
- **`repo-diff`'s tab icon** — P73 §3.2 invited P74 to revisit it; §7.3 finds the distinction still
  worth keeping, so it stays `git-compare`.

## 9. Files

Modified:

| File | Change |
|---|---|
| `packages/git-ui/src/components/CommitMeta.vue` | Refs row reactivity (§2.1); PR row as badge + button (§3.2); PR icon on the facts row (§4.3) |
| `packages/git-ui/src/components/DetailPane.vue` | Expanded-state CSS (§2.2); `pr-for-commit` prop threading (§4.3) |
| `packages/git-ui/src/components/StackList.vue` | PR anchor becomes the same action (§3.2) |
| `packages/git-ui/src/components/CommitGrid.vue` | `prsFor` reads `prForCommit`; `rebuildAncestry` inside the existing `pr.generation` watcher (§4.3) |
| `packages/git-ui/src/components/FileTree.vue` | "Go to file" row action, capability-gated (§7.4) |
| `packages/git-ui/src/state/pr.ts` | `prByAncestry`, `rebuildAncestry`, `prForCommit`; cleared in `#clear` (§4.2) |
| `packages/git-ui/src/state/detailActions.ts` | `openPullRequest` on `DetailActions` + `createDetailActions` (§3.3) |
| `packages/git-ui/src/components/review/ReviewView.vue`, `packages/git-ui/src/state/review.ts` | The same three lines, for the two hand-built action bundles (§3.3) |
| `packages/git-ipc/src/contract.ts`, `validate.ts` | `pr.openExternal`, `pr.browserUrl`, `capabilities.openExternal` (§3.3) |
| `apps/kira-studio/internal/gitrpc/{contract,wire}.go`, `internal/gitsession/gh.go` | `pr.browserUrl` server side + contract version bump (§3.3) |
| `apps/kira-studio/internal/bridge/` | `GitHubService.OpenPullRequestURL` with `safeReleaseURL`-shaped validation (§3.3) |
| `apps/kira-studio/frontend/src/repo/git/hostHandlers.ts` | `pr.openExternal`; `editor.goToFile` implemented; `goToFile`/`openExternal` capabilities true; `openAllChanges` opens a preview cohort (§3.3, §5.2, §7.2) |
| `apps/kira-studio/frontend/src/state/tabs.ts` | `previewIdsByWorkspace`; `previewCohort`; `promoteTab` (§5.2, §6) |
| `apps/kira-studio/frontend/src/state/repoTabs.ts` | Cohort pass-through; revision in `openRepoFileTab`'s key (§5.2, §7.3) |
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | `repoFileTitle` shows the short rev (§7.3) |
| `apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue` | `@dblclick="promoteTab"` (§6) |
| `apps/kira-studio/frontend/src/views/repo/RepoFileView.vue` | Read at a revision (§7.3) |
| `apps/kira-studio/frontend/src/views/repo/RepoDiffView.vue` | `repo.goToFileFromDiff` command (§7.4) |
| `packages/shared/domain/tabs.ts` | `repoFileTabStateSchema.rev` (§7.3) |
| `apps/kira-studio-vscode/src/proxyHandlers.ts`, `src/ports/editorIntegration.ts` | `pr.openExternal` via `vscode.env.openExternal` (§3.3) |

Added: none. Deleted: none. No new dependency — `codicon`, `zod` and `@kira/git-core` are all
already dependencies of the exact modules that use them here.

## 10. Tests

`CLAUDE.md`'s default is no dedicated unit test, and this phase earns **one**, in an existing file.

**New unit test — `packages/git-ui/src/state/pr.test.ts`**, for §4.2 only. Measured against the
bar, not waved past it: a bounded breadth-first walk over a packed parent array, with first-writer-
wins on a commit reachable from two PR branches, a budget cut-off, a tip outside the loaded window,
and invalidation on `refsChanged`/repo switch — several interacting rules whose wrong answers are
invisible in a screenshot. Everything else this phase touches is wiring.

Explicitly **not** tested: `prForCommit`'s three-line precedence (it restates its own body),
`openPullRequest` (a thin pass-through), `promoteTab` (one array filter), the CSS in §2.2.

**Existing specs extended**, no new spec file:

| Spec | Assertion |
|---|---|
| `apps/kira-studio-vscode/tests/interaction/commit-meta-clamp.spec.ts` | §1.2's gap: after "Show more", assert `.kv-detail-pane-meta`'s own `clientHeight` grew and `scrollHeight <= clientHeight`. Add a fixture commit with a `decoration` entry and assert the Refs `<dt>`/`<dd>` are visible (§2.1) — the harness's current fixture has `decoration: []`, which is why this never failed |
| `apps/kira-studio/tests/ui/tabs.spec.ts` | Open all changes leaves N tabs, all `data-preview="true"`; double-clicking one leaves it `false` and the rest `true`; a subsequent tree-click preview evicts the whole cohort (§5.2, §6) |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | "Go to file" on a live file lands on the right tab and line; on a deleted path it opens a `repo-file` tab whose title carries the short rev (§7.2, §7.3) |

**Selector fallout:** `repo-workspace.spec.ts` and `fake-data.spec.ts` are the two specs asserting
`data-preview`; both read it per tab, so the cohort change does not alter their expectations. Grep
found no spec asserting `.kv-meta-pr-link`, `.kv-meta-refs` or any `previewIdByWorkspace` shape.

Fast checks per commit: `bun run typecheck`, `bun run lint`, `bun run build` **and**
`bun run build:vscode` (this phase edits `packages/git-ui/`, so both bundles must build), plus
`go build ./... && go vet ./...` for the commits that touch Go.

## 11. Order and sizing

### 11.1 Implementation order

1. **§2 — "Show more".** Refs row plus the expanded-state CSS, after running §1.4's check.
   → `fix(git-ui): make Show more reveal refs and the body it expands to hold`
2. **§3 — the external PR link.** Contract + Go + both hosts + both anchors, in one commit: a
   half-applied path leaves a button wired to nothing.
   → `feat(git-ui,gitrpc): open a pull request in the external browser, never in place`
3. **§4 — the PR icon.** `pr.ts` first, then the two render sites.
   → `feat(git-ui): show a PR icon for any commit on a pull request's branch`
4. **§5 — the preview cohort.** `tabs.ts`/`repoTabs.ts`, then `hostHandlers.ts`'s flip to
   `pinned: false`. One commit: flipping first opens one tab.
   → `fix(workbench): open a commit's changes as one cohort of preview tabs`
5. **§6 — double-click promotion.** Needs step 4's `promoteTab`.
   → `feat(workbench): promote a preview tab on double click`
6. **§7 — Go to file.** `repo-file`'s `rev` and `RepoFileView.vue` first, then the handler, then
   the two callers — a handler that returns `historical` before anything can render it would be a
   silent dead end.
   → `feat(repo): implement go to file, including a file that only exists at a revision`
7. **Spec assertions** (§10), once the behaviour they describe is in.
   → `test: assert commit-detail expansion, preview cohorts and go to file`

### 11.2 One pass, one seam

One Sonnet pass. **The seam is between step 3 and step 4**: Part A is `packages/git-ui` plus the
PR contract; Part B is the desktop tab model plus `editor.goToFile`. They share no file and no
reasoning.

Never split inside step 2 (a contract method with one end wired), step 4 (§5.1's reason), or step 6
(§7.3's reason). Steps 1, 2 and 3 may land in any order among themselves; step 5 needs step 4.

Size: roughly 20 source files across TypeScript, Vue and Go. The load-bearing decisions are three —
`previewIdsByWorkspace`'s widening (§5.2), `prByAncestry`'s derivation (§4.2), and `repo-file`
carrying a revision (§7.3). Everything else follows from one of them.

### 11.3 Contract version

Steps 2 and 3 add wire methods, so `internal/gitrpc/contract.go`'s version constant moves once, in
step 2, with a comment in the same shape as the entries already there (`:63`-`64` is the closest
precedent — a bump for two new Go-served requests). `wireConformance.test.ts` is what keeps the two
declarations in step; run it before the step-2 commit lands.

## 12. Dogfooding note

The repo-map MCP server's own `bun run mcp:repo-map:build` was run for this planning pass. Its
tools were not reachable: this is a subagent session, and `CLAUDE.md`'s own step-3 caveat applies —
the tool manifest is fixed at session start. Navigation was done with Grep/Glob/Read instead.

**Nothing new is logged in `docs/v1.8/mcp-repo-map-issues.md`.** P73's entry (a `find_references`
false negative on a non-call read) already covers the class of failure that would have mattered
here, and this pass produced no fresh evidence about the server itself — inventing an entry from a
session that never called it would be the manufactured finding `CLAUDE.md` warns against.

Two consequences for whoever implements this:

- Every reference list in this document was built by grep. In particular §5.2's list of
  `previewIdByWorkspace` call sites (`tabs.ts:353`, `:383`, `:399`, `:595`, `:624`, `:644`, `:672`,
  `:700`, `:738`, `:771`; `repoTabs.ts:97`, `:145`) is a grep result, not a `find_references`
  answer. Re-run the grep before the rename — a missed site leaves a workspace with a preview tab
  nothing can ever clear.
- §1's conclusions about "Show more" came from reading the compiled bundle
  (`apps/kira-studio/frontend/dist/assets/src-D4-MRrdM.js`) alongside the source, because the
  question was whether Vue's attrs fallthrough reached the element at all. That is a legitimate
  technique for a compile-time question and a poor one for anything else; §1.4's runtime check is
  what settles the part the bundle cannot answer.
