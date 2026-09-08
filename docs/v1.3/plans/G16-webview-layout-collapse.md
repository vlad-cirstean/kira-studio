# G16 — The webview layout collapse, the gutters it hides behind, and the pager that never dies

> **What this phase is.** The sixteenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> first one that starts with its root cause already established. A dedicated visual-inspection pass,
> run immediately after G14 shipped, reproduced the user's "the graph still doesn't work" report and
> found that G14's fix was necessary but not sufficient: the commit graph now *instantiates*, and
> then collapses to a ~75px-tall strip inside a 360px panel. This phase does not root-cause anything.
> It turns three already-diagnosed defects into decided, tested changes.
>
> **In one line: nothing in this app ever gives the webview document a height, and one of the three
> defects is not where the previous investigation said it was.** `html`, `body` and `#app` are all
> `height: auto` in a VS Code webview — that is the iframe default, and VS Code's own default
> stylesheet sets no height either — so `App.vue`'s `.kv-app { height: 100% }` and
> `ReviewView.vue`'s `.kv-review-view { height: 100% }` both compute to `auto`. **Measured here,
> against the real built bundle, in real Chromium** (§1, F1): `.kv-app` is **0px tall** at a
> 1400×360 viewport and `.kv-review-view` is **65px tall** at 400×700, sitting at `x = 20` with 40px
> of width missing. With one shell rule added they are 360px and 700px, at `x = 0`, full width.
>
> **One correction to the handed-down diagnosis, and therefore to SPEC's own G16 row — on evidence.**
> SPEC says the dead "Load the last 0" pager comes from `internal/gitclient/logsession/session.go`'s
> exhaustion signal and should be fixed "at its source" there. That file *does* carry a real defect
> (F5), but it **cannot be the one the user saw**: it only fires when the commit count is an exact
> multiple of the page size, and the observed repository has 2004 commits against the default page
> size of 5000. The defect that actually fires is in `gitsession/walk.go`: `Walk.Stream` replays
> every cached chunk with a **hardcoded `Exhausted: false`** (`walk.go:259`) and then returns early
> when the walk *is* exhausted (`walk.go:265`), so no re-stream — and every `loadMore`, every
> `refresh`, and every webview hide/reveal is a re-stream — ever tells the client the history is
> finished. F4 proves it; §10.1 hands the SPEC-wording call to a human. Both files are fixed here.
>
> **And one severe bug nobody had named yet, falling straight out of that same root cause.**
> `GraphViewState.loadAll()` loops `while (!this.exhausted.value)` and re-streams on every
> iteration (`graphView.ts:159`, `#runLoad`'s `finally`). Against a walk whose re-stream always
> reports `exhausted: false`, **Alt-click "load everything" never terminates** — it spins, repacking
> and re-emitting the whole history every iteration, until the user cancels. `revealSha()` has the
> same loop shape. F8. It is folded into this phase because it is the same root cause, not a new
> one; §10.3 flags the scope call.
>
> **The guard this phase owes, and the good news about it.** SPEC requires "a guard that asserts a
> real *rendered box height*, not DOM shape" — because G14's own `aria-rowcount` check passed, on
> the real commit count, while the panel was visually destroyed. No test tier in this repo renders
> `packages/git-ui` at all today. This plan adds one, and it is **Tier 1, not Tier 3**: Chromium and
> WebKit are already installed in this container at `/opt/pw-browsers`, the webview bundle builds in
> 1.1s, and the whole app boots under `renderHtml`'s real CSP with a dead transport and **zero
> console errors** — all four facts measured here, not assumed (§5). The numbers quoted in F1 and
> F2 come out of that harness in its prototype form.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands on `claude/feature-v1-3-headless-git` at `7698873a` (all of
G1–G15, plus the SPEC commit that inserted this phase and renumbered G16–G28 to G17–G29). Working
tree clean; no other agent running concurrently.

Every claim below was checked against source read in this container, or produced by a command **run
in it**. The preceding investigation's prose findings are treated as a lead to verify, not as a
record to trust — which is how F4 was found to contradict them, and how F5 through F9 were found at
all. The evidence screenshots that investigation left in a scratchpad directory were deliberately
not relied on; every geometry number in this document was re-measured from the current tree.

### 0.2 Scope

Three defects named by SPEC's G16 row, plus two more that share their root cause and cannot honestly
be left behind:

1. **F1 — the height chain.** Establish a real height from `html`/`body` down to the mount container
   and both view roots, in *both* webview documents (graph panel and review sidebar).
2. **F2 — the 20px gutters.** VS Code's own `body { padding: 0 20px }` default is never reset, and
   silently eats 40px of width from every panel and sidebar.
3. **F3 — the dead pager.** "Load the last 0" renders when there is nothing left to load — fixed at
   both of its two real sources (F4 in `walk.go`, F5 in `session.go`), not papered over.
4. **F8 — `loadAll()`/`revealSha()` never terminate** against a walk that never reports exhausted.
   Same root cause as F4; a real hang, not a cosmetic one.
5. **F6 — `logsession` can drop parsed records at EOF.** Latent, hard to trigger, and removed *by
   construction* by the restructure F5 needs anyway.

Plus the guard SPEC explicitly requires: a rendered-geometry test tier for the webview.

### 0.3 Not in this phase

- **`stash.list`'s unhandled RPC rejection.** Surfaced by the same investigation; already tracked as
  G14 F14 and owned by G17, which owns `stash` server-side. Not touched here, not mentioned in any
  commit here.
- **No `CONTRACT_VERSION` bump.** It stays at **21**. Every fix below uses request keys, params,
  results and chunk fields that already exist. This is a checklist item in §7.4, not an aspiration —
  the client-side terminal-state fix (D7) was designed around reusing `graph.status` *specifically*
  to avoid needing one.
- **No new dependency.** Playwright, Chromium and WebKit are already present.
- **No redesign of either view.** This phase changes the box the app is drawn in, not what is drawn.
- **No `docs/v1.3/SPEC.md` edit.** Plans in this chapter record corrections to their own SPEC row
  rather than rewriting it (G12, G14 and G15 all did this); §10.1 carries the correction.
- **No visual/design change beyond the geometry.** The 40px the gutter reset gives back is width the
  panel already believed it had; nothing is re-laid-out to use it.

### 0.4 Ground rules

- **Fix causes, and say which cause.** Three of the five defects here have more than one candidate
  location. Each decision below names the location it fixes and says explicitly what it does *not*
  fix, so a later reader can tell a deliberate boundary from an oversight.
- **The guard must measure pixels.** SPEC is explicit and G14 is the reason. Any assertion that
  could pass on a collapsed panel — row counts, `aria-rowcount`, element existence, class names — is
  not the guard, however convenient. The guard asserts `getBoundingClientRect()` against the
  viewport.
- **The guard must load the real document.** A harness that hand-rolls an approximation of
  `html.ts`'s output is precisely the kind of proxy-for-the-real-thing that let G14 pass. D10
  extracts the document builder so the test uses the genuine article.
- **AGENTS.md's test bar applies.** Two new Go tests, because pagination-boundary arithmetic is one
  of the named carve-outs. No new TypeScript unit test, because the client-side changes here are
  three-line guards, not complex logic — D11 says so explicitly rather than leaving it implied.

---

## 1. Findings

### F1 — Nothing establishes a height chain, and both view roots therefore compute to `auto`

Verified, file by file, in the current tree:

- `packages/git-ui/src/App.vue:1275-1284` — `.kv-app { display: flex; flex-direction: column;
  height: 100%; width: 100%; … overflow: hidden }`.
- `packages/git-ui/src/components/review/ReviewView.vue:759-771` — `.kv-review-view` with the same
  shape (`height: 100%; width: 100%; overflow: hidden`).
- `apps/kira-studio-vscode/src/html.ts`, `renderHtml()` — the emitted `<head>` contains a charset
  meta, the CSP meta, a viewport meta, a `<title>` and the manifest `<link rel="stylesheet">` tags,
  and nothing else. `<body>` is `<div id="app"></div>` plus two `<script>` tags. **No style rule of
  its own, for `html`, `body` or `#app`.**
- The built bundle: one stylesheet, `dist/ui/assets/webview-*.css`. Grepped — **no rule for bare
  `html`, bare `body`, or `#app`.** The only `body` selectors are `vscode-tokens.css`'s
  `body.vscode-*` custom-property blocks, which set no box properties at all.
- `packages/git-ui/src/theme/` holds four stylesheets — `density.css`, `kira-structure.css`,
  `vscode-tokens.css` and (in `src/icons/`) `codicon.css`. **All four are token files.**
  `density.css` and `vscode-tokens.css` define only custom properties; `kira-structure.css` defines
  only custom properties and is scoped to `.kv-skin-kira`. Not one of them contains a layout rule.

`height: 100%` against a parent whose height is `auto` computes to `auto`. So `#app` → `.kv-app`
gets content height, `.kv-body { flex: 1; min-height: 0 }` collapses, and SlickGrid sizes its
viewport from a near-zero container.

**Measured in this container**, Chromium, against the bundle built from this tree by `bun run
build:vscode`, with VS Code's real default stylesheet injected and a dead transport (nothing
connected, so this is the app's pre-connect state):

| view | viewport | fix | root `x` | root `width` | root `height` | `body` height |
|---|---|---|---|---|---|---|
| graph (`.kv-app`) | 1400×360 | none | 20 | 1360 | **0** | 0 |
| graph (`.kv-app`) | 1400×360 | shell rule | **0** | **1400** | **360** | 360 |
| review (`.kv-review-view`) | 400×700 | none | 20 | 360 | **65** | 65 |
| review (`.kv-review-view`) | 400×700 | shell rule | **0** | **400** | **700** | 700 |

The prior investigation measured 75px for the graph against a *live* backend, where a toolbar and a
row and a half had rendered; with a dead transport there is nothing inside the root at all, so it is
0. The failure is the same one — the root's height is whatever its content happens to be — and it is
observable without a backend, which is what makes the guard in D10 cheap.

Two further manifestations recorded by the investigation follow from the same cause and are not
separately diagnosed here: selecting a commit pushes the auto-height document to 1603px inside a
360px panel (the whole webview becomes one long scroller and the toolbar scrolls away), and the
review sidebar reaches 73832px at 400×700 with all 1891 rows laid out into one document, so its
header and footer never pin.

**Why this is an app bug, not a harness artifact** — established by the prior investigation and not
re-litigated here, but re-stated because the whole phase rests on it: VS Code's real webview default
stylesheet sets `margin: 0` and `padding: 0 20px` on `body`, and `scrollbar-color` on `html`, and no
height on either. An iframe document's `html`/`body` default to `height: auto` no matter how the
host sizes the iframe element. And the only place a `html, body, #app { height: 100% }` rule has
ever existed in this app's lineage is the upstream repo's **dev harness** (`apps/harness/index.html`)
— never in a shipping host's document. **This repo has no `apps/harness` at all** (`ls apps/` →
`kira-studio`, `kira-studio-vscode`), so the rule the layout depends on exists nowhere in this tree.

The theme-token hypothesis was ruled out before this phase: identical collapse with a full Dark
Modern set, a full Light Modern set, and zero `--vscode-*` variables. Not re-tested here.

### F2 — The 20px gutters, and they are independent of F1

`getComputedStyle(document.body).padding` is `0px 20px` in both broken rows of the table above, and
`0px` in both fixed rows. `.kv-app` sits at `x = 20` with `width = 1360` in a 1400px viewport, and
at `x = 20` with `width = 360` in a 400px sidebar — the sidebar loses **10% of its width**, which is
the worse of the two cases even though it is the less visible one.

Nothing in this app's CSS ever overrides it, for the same reason as F1: no shipping stylesheet here
has ever contained a `body` box rule. The two defects are independent (fixing height alone leaves
the padding at `0px 20px`) but they are one line apart in one rule, and D2 fixes them together.

### F3 — The dead pager renders in two components, not one

- `packages/git-ui/src/components/LoadMoreButton.vue:54` — `v-if="!graphView.exhausted.value"`, and
  at line 33, `if (remaining < props.pageSize) return 'Load the last ' + remaining`. With
  `remaining === 0` and `exhausted === false`, that is literally **"Load the last 0"**.
- `packages/git-ui/src/components/review/ReviewView.vue:717` and `:347-354` — the review sidebar has
  its **own** pager with the same `v-if="!review.exhausted.value"` gate and the same
  `Load the last ${remaining}` label. Any fix that touches only `LoadMoreButton.vue` leaves half the
  bug in place. The prior investigation saw both surfaces and reported one.

Neither component is the cause. The cause is that `exhausted` arrives as `false` when it should be
`true`, from `packages/git-ui/src/state/packedStream.ts:91-92`, which copies `chunk.exhausted` and
`chunk.remaining` verbatim off the wire. So the question is what puts `false` on the wire.

### F4 — The cause SPEC names is not the cause: `Walk.Stream` hardcodes `Exhausted: false` on every replayed chunk

`apps/kira-studio/internal/gitsession/walk.go`, `Walk.Stream`:

```go
254	for cursor < cachedThrough {
255		to := cursor + chunkRows
256		if to > cachedThrough { to = cachedThrough }
257		if err := emitRange(cursor, to, "cache", false); err != nil {   // ← always false
258			return err
259		}
260		cursor = to
261	}
262
265	if w.log.Exhausted() {
266		return nil                                                      // ← and then it leaves
267	}
```

`emitRange` computes `Remaining` freshly for every chunk (`w.log.Remaining(ctx)`, which is
`cachedTotal - loadedCount`) but takes `Exhausted` from its caller. The replay loop passes a literal
`false`. When the walk *is* exhausted, the function returns at line 265 without ever emitting a
chunk that says so.

Every path that re-streams therefore ends with `exhausted: false` on the client:

- **`graph.loadMore` / `graph.refresh`.** `GraphViewState.#runLoad` (`graphView.ts:234-249`) always
  re-opens the stream in its `finally` — that re-open is how the newly-read rows reach the client at
  all. The re-open replays from cache.
- **A webview hide/reveal.** `retainContextWhenHidden` is deliberately off (§2.1), so the view is
  destroyed and recreated; a fresh `GraphViewState` starts at `loadedRows = 0` and `openStream`
  defaults `resumeThroughRow` to it, so the host replays the entire cached history from row 0 —
  every chunk marked `exhausted: false`.
- **The review sidebar, always.** `handleGraphStream` forces `resumeThroughRow = nil` for a ranged
  walk (`graph.go:201-203`), so a review re-stream *always* replays from cursor 0. After its first
  `loadMore`, the review pager is permanently stuck on.

That produces exactly the reported state: `remaining: 0` (because `loadedCount` has reached the
`rev-list --count` total), `exhausted: false`, and a button offering to load the last zero commits.
It also explains the loading-state text the investigation photographed — "Loading… (0 remaining)".

**The mutual exclusion that makes the fix simple**, and that is worth stating because the fix depends
on it: a non-empty cache replay is *never* followed by a git read in the same call. Line 273's
`if cachedThrough > 0 { return nil }` guard sees to it — a page is read inside `Stream` only on the
very first stream for a walk, when `cachedThrough == 0` and the replay loop did not run. So "the
last chunk of the replay loop" and "the last chunk of the git loop" are never both present, and
whichever runs owns the stream's terminal chunk.

### F5 — `logsession`'s exhaustion *is* also late, but only on an exact multiple, and a test currently enshrines it

`apps/kira-studio/internal/gitclient/logsession/session.go:141-181`: the page-filling loop is
`for appended < pageSize`, and `s.exhausted = true` is set only inside the `io.EOF` branch at line
176. A page that fills exactly at the walk's last record exits the loop without ever attempting the
read that would observe EOF, so `Exhausted()` stays `false` until a further, empty `ReadPage`.

This is real, and it is a second independent producer of `remaining: 0, exhausted: false`. It is
**not** what the user hit: it requires `total % pageSize == 0`, and the reported repository has 2004
commits against `logsession.DefaultPageSize = 5000` — and 5000 is also the settings default the
extension injects (`packages/git-core/src/settings/schema.ts:52-58`,
`'kiraVersion.graph.pageSize'`, `default: 5000`, minimum 100), so no realistic configuration makes
2004 an exact multiple either.

The existing test at `session_test.go:145-173` asserts this behaviour as intended, with a comment
that states the assumption this phase overturns:

> Exactly 2 commits remain (4 total, pageSize 2): the page fills at exactly the walk's last record,
> so exhaustion is only discovered on the *next* read attempt (**there is no way to know a page was
> the last without trying to read one more and observing EOF**).

There is a way: read one more *record* — not one more page — and park it. D6 does that. This test's
page-2 assertion and its comment change; §3.1 says exactly how.

### F6 — At EOF with a non-empty `pending` queue, `logsession` drops records

Latent, and found while reading F5's loop. `ReadPage` parses every record a 64KB chunk yields;
records past the page budget queue into `s.pending` (line 159). The `readErr != nil` check at line
161 runs *regardless* of how many records that same chunk just parked. So if a read ever returns
both data and `io.EOF`, `s.exhausted` is set at line 176 with `pending` non-empty — and the very
next `ReadPage` returns at line 117-119 (`if s.exhausted { return Outcome{Exhausted: true} }`) and
**never delivers them**. Records are lost, and `Exhausted: true` is reported alongside a non-zero
`Remaining`, which is the exact contradiction `pending` was introduced (F13, G3) to prevent.

Pipes usually return `(n>0, nil)` and signal EOF on the following call, which is why this has never
been observed; `io.Reader`'s contract explicitly permits `(n>0, io.EOF)`. D6's restructure removes
it by construction rather than by a test that cannot be written deterministically against a real
`git log` process — §3.1 is explicit about that rather than claiming coverage it does not have.

### F7 — The zero-chunk re-stream: no per-chunk fix can reach it

When `cursor == cachedThrough` — the client already holds every row the host has — the replay loop
runs zero times and `Stream` returns having emitted **nothing**. That is precisely the state after
pressing the dead pager once: `graph.loadMore` returns `Started: false` (`walk.go:166`, the walk is
exhausted so nothing is attempted), and `#runLoad`'s resync then streams zero chunks. No amount of
per-chunk truth-telling helps, because there is no chunk.

The same hole exists for an **empty review range** (a branch with no commits ahead of its base):
first stream, `cachedThrough == 0`, the page read yields zero records, `newTotal == 0`, so the git
emit loop does not run either — zero chunks, and `exhausted` stays at `PackedStreamState`'s initial
`false` with `remaining` at `0`. The review sidebar shows "Load the last 0" on an empty comparison.

D7 and D9 split this between them, and §2 D9 says why the split falls where it does.

### F8 — `loadAll()` and `revealSha()` spin forever against a walk that never reports exhausted

`packages/git-ui/src/state/graphView.ts:159-164`:

```ts
while (!this.exhausted.value && !controller.signal.aborted) {
  await this.#runLoad('loadingMore', () =>
    this.#bridge.request('graph.loadMore', { repoId, pages: 1 }, controller.signal),
  );
}
```

`#runLoad` re-streams in its `finally`. Per F4, that re-stream sets `exhausted` back to `false`. So
against a fully-loaded history the loop condition is permanently true: `graph.loadMore` does no work
(`Started: false`), and then the host re-packs and re-emits the *entire* history — 2004 commits in
five chunks, every iteration — until the user hits Cancel. Alt-click, documented in
`LoadMoreButton.vue`'s own tooltip as "load everything remaining", is the trigger.

`revealSha()` (`graphView.ts:197-203`) has the identical loop, exiting early once the sha appears;
for a sha that is not in the history it spins the same way.

The `loading !== 'idle'` idempotency guard does not help — `#runLoad` returns `loading` to `'idle'`
in its own `finally` before the loop re-tests.

This is the most severe defect in the phase and the only one that is not cosmetic. It is not named
in SPEC's G16 row; §10.3 flags that.

### F9 — No test tier in this repo renders `packages/git-ui`, but both browsers are already here

- `apps/kira-studio/playwright.config.ts` defines four projects — `ui`, `ui-timing`,
  `ipc-frontend`, `e2e-real`. All four target the Wails app (`apps/kira-studio/frontend`). Grepped:
  **nothing** under `apps/kira-studio/tests/` mentions `git-ui`, `kira-studio-vscode`, `kv-app` or
  `kv-review-view`.
- The extension's own tests (`bun run test:unit` over `apps/kira-studio-vscode/src`) are four files
  — `virtualKey`, `reviewRanges`, `commands`, `vueComponentImports` — all static/pure. None renders
  anything. None imports `vscode`; there is no `vscode` module stub anywhere in this repo, and every
  testable module is deliberately kept `vscode`-free (G15 D11 states this as the convention).
- So the previous investigation's conclusion holds: no existing tier could have caught this.

What it did not know, and what changes this phase's tiering materially: **the browsers are already
installed.** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in this container, holding
`chromium-1234`, `chromium_headless_shell-1234` and `webkit-2336`. `bun run build:vscode` completes
in 1.1s. A prototype of the guard was built and run here; it produced the F1/F2 tables above, and
the app boots under `renderHtml`'s real CSP with **zero page errors and zero console errors**.

Two mechanics were settled by measurement rather than assumption, because the whole design of D10
depends on them:

1. **Playwright's `addInitScript` survives the document's CSP.** `renderHtml` emits
   `default-src 'none'; script-src 'nonce-…'`. The `acquireVsCodeApi` stub the bundle needs is
   injected via CDP, not as a page script, and `typeof window.acquireVsCodeApi === 'function'` was
   confirmed true inside a document carrying that exact CSP. No nonce plumbing is needed in the
   harness.
2. **An unlayered author rule beats VS Code's `@layer vscode-default`.** With the default styles
   wrapped in that layer, the shell rule won: computed `body` padding `0px`, root at `x = 0`,
   `width = 1400`, `height = 360`. No `!important` anywhere, and no dependence on source order.

---

## 2. Decisions

### D1 — The height chain lives in `packages/git-ui`, not in `html.ts` — approach (b), decided

SPEC names two candidates. **(b) wins**: the rule goes into `packages/git-ui`'s own shared CSS, and
`mount()` sizes the container it was handed.

The reasoning is about where the *responsibility* belongs, not about diff size:

- **The bug is an unassigned responsibility, and (a) re-assigns it to the same place it was already
  silently assumed.** `.kv-app { height: 100% }` is a claim on an ancestor that `packages/git-ui`
  never states and never checks. Putting the rule in `html.ts` satisfies that claim for today's one
  host and leaves the claim itself just as implicit as it is now — a fix that works and teaches
  nothing. The next document that loads this bundle breaks exactly the same way, silently, and the
  guard in D10 would be the only thing standing between that and a shipped release.
- **`mount()` is already a document-owning bootstrap, and it already owns every stylesheet.**
  `packages/git-ui/src/main.ts:7-12` imports all four CSS files; both roots are mounted through the
  one `mount()`; and it opens by marking `kira:page-parsed`, a navigation-relative performance
  measure that only makes sense for a function that owns the page. A package that already declares
  the document's fonts, colours, density tokens and perf marks declaring the document's box is not
  a boundary violation — it is the same boundary, stated one property further.
- **One rule reaches both roots for free.** `main.ts` is the single entry for the graph panel and
  the review sidebar (`view === 'review' ? createApp(ReviewView) : createApp(AppRoot)`). A rule
  imported there is in both documents by construction. In `html.ts` the same is true today, via one
  `renderHtml` serving both views — but that is a property of the current host, not of the app.
- **The build already carries it.** `vite.config.ts` emits one stylesheet for the entry, and
  `html.ts`'s `collectCss` walks the manifest transitively to find it. Adding a CSS import to
  `main.ts` requires **no change to `html.ts` at all** — verified against the built manifest, where
  the entry's own `css` array is the single `webview-*.css`.
- **The cost (b) is supposed to carry does not materialise.** SPEC notes that (b) "additionally
  needs `#app`/the Vue `mount()` target sized correctly". It does — and that is three lines in
  `main.ts` (D2), not a design problem, because `mount()` already receives the container as its
  first argument and already returns a handle that can undo it.

The honest boundary this creates, stated in the code rather than left to be discovered:
`mount()` is a **document-owning bootstrap, not a widget factory**. It styles `html` and `body`. A
future host that wants the graph inside a region of a larger page needs a different entry point, not
a flag. Since `packages/git-ui` is a private workspace package whose only consumer is
`apps/kira-studio-vscode`, that costs nothing today and is written down so it costs nothing later.

### D2 — One new stylesheet, `theme/app-shell.css`, and exactly what is in it

New file `packages/git-ui/src/theme/app-shell.css`, imported **first** in `main.ts`:

```css
html,
body {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.kv-mount-root {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
```

Decisions folded into those nine lines:

- **A new file, not an existing one.** All three files in `theme/` are token files —
  `density.css` and `vscode-tokens.css` define only custom properties, `kira-structure.css` defines
  only custom properties and is scoped to `.kv-skin-kira` with a doc comment promising it contains
  no colour and is checkable by grep. Dropping the first real layout rule in this package into any
  of them breaks a stated invariant. `theme/` is nonetheless the right directory: it is where this
  package's CSS lives, and a second convention for one file is worse than a slightly loose one.
- **`height: 100%` on `html` *and* `body`.** Both are needed; `body { height: 100% }` alone resolves
  against an `auto` `html`.
- **`padding: 0` is F2's whole fix**, and `margin: 0` restates a default VS Code also sets — kept so
  the rule is correct in any host, not only in one that already zeroes margins.
- **`overflow: hidden` on `html, body`** is a deliberate choice with a real trade-off, and it is
  the one line in this plan a reviewer should push back on if they disagree (§10.2). With the height
  chain in place, the documented "selecting a commit pushes the document to 1603px" failure cannot
  recur — `.kv-app` is already `overflow: hidden`. This is belt-and-braces: it converts any future
  content overflow from *a whole-document scroll that hides the toolbar* into *clipping*. For an app
  shell that owns the viewport and provides its own internal scrollers, a document-level scrollbar
  is always a bug; the cost is that a future overflow is silently clipped instead of reachable.
- **`.kv-mount-root`, a class, not `#app`.** `packages/git-ui` must not know the host's element id.
  `mount()` applies the class to whatever container it is given and removes it on `unmount()`, so
  the sizing follows the mount rather than a naming convention two packages have to agree on.
- **No `!important`, and no `@layer`.** F9 measured that an unlayered author rule beats VS Code's
  `@layer vscode-default` unconditionally, and that it also wins on plain source order.

### D3 — `apps/kira-studio-vscode/src/html.ts` gains no style rule

Following from D1: one owner. A defensive duplicate in the emitted `<head>` would mean two places
to keep in step and no signal about which is load-bearing — and the guard in D10 would then pass
with either one deleted, which is the opposite of what it is for.

`html.ts` *is* edited in this phase, but only for D10's testability extraction, which changes no
byte of the document it emits.

### D4 — Rejected: `position: fixed; inset: 0` on the two roots

The alternative SPEC lists under (b) — skip the height chain and take the roots out of flow — was
considered and declined:

- **It contradicts `mount(container, opts)`'s own contract.** A fixed root ignores the container it
  was handed and fills the viewport. Mounting into a sub-element would silently render full-screen:
  the API would say one thing and the layout do another.
- **It sidesteps F2 rather than fixing it.** The 20px body padding would remain, still wrong, merely
  no longer visible on this one element.
- **It is quietly fragile.** Any ancestor acquiring `transform`, `filter`, `backdrop-filter`,
  `contain: paint` or `will-change` silently becomes the containing block and the layout collapses
  again — a class of regression with no visible cause and no lint that catches it.

The height chain has none of these properties and is the boring, standard construction for a
document that *is* an app.

### D5 — `Walk.Stream` tells the truth on every chunk it emits

In `apps/kira-studio/internal/gitsession/walk.go`:

- `emitRange`'s fourth parameter changes from `exhausted bool` (a value the caller invents) to
  `last bool` (a fact about position in the stream), and the chunk's flag becomes
  `Exhausted: last && w.log.Exhausted()` — sourced from the walk, once, at the emit site.
- The replay loop passes `to == cachedThrough`; the git loop passes `to == newTotal`, which is what
  it already effectively passed.
- A comment records the mutual exclusion from F4 — a non-empty replay is never followed by a git
  read, because of line 273's guard — since that is what makes "the last replayed chunk is the
  stream's last chunk" true rather than merely usually true.
- `readPageLocked` narrows from `(appended int, exhausted bool, err error)` to `(appended int, err
  error)`. Neither caller needs the flag once the emit site reads `w.log.Exhausted()` directly, and
  leaving an ignored return in place invites someone to trust it.

**Deliberately not done:** `Exhausted` is *not* computed as `w.log.Exhausted() || remaining <= 0`.
D6 makes `log.Exhausted()` accurate at page boundaries, so the OR would be redundant; worse, it
would mask any future disagreement between the walk's own position and the `rev-list --count`
`Remaining` derives from. A `remaining == 0 && !exhausted` state should stay visible as the bug it
would be.

### D6 — `logsession` separates "the process drained" from "the caller has seen everything", and reads one record of lookahead

The field `exhausted` becomes `eof` — the process drained — and exhaustion becomes derived:

```go
// exhaustedLocked is what every caller means by "exhausted": the walk's process drained AND every
// record it produced has been delivered. Keeping the two apart is what makes the one-record
// lookahead below safe — EOF can now be reached with records still queued in pending.
func (s *Session) exhaustedLocked() bool { return s.eof && len(s.pending) == 0 }
```

Four consequent changes in `ReadPage`, each load-bearing:

1. **The page loop gains a lookahead**: `for !s.eof && (appended < pageSize || len(s.pending) == 0)`.
   A full page keeps reading until either one record is parked in `pending` (so there is definitely
   more) or EOF is observed (so there is definitely not). That is F5's fix, and it costs at most one
   extra chunk read per page — usually none, since a 64KB read already overshoots a page routinely.
2. **The early return becomes `if s.exhaustedLocked()`**, so a session that hit EOF with records
   still queued delivers them instead of discarding them. That is F6's fix.
3. **The spawn guard becomes `if s.proc == nil && !s.eof`.** Without this, the state F6 creates —
   `proc == nil` because EOF closed it, `pending` non-empty — would send the next `ReadPage` into
   `spawnOrResumeLocked` and re-walk the history. This is the one place where fixing F6 could
   introduce a worse bug than it removes, and it is called out for that reason.
4. **`Outcome.Exhausted` and `Session.Exhausted()` both return `exhaustedLocked()`**, and
   `armReclaimLocked` is gated on `!s.eof`.

**The `--skip` resume arithmetic is unaffected**, and the existing code already explains why:
`readCount` counts every record *consumed from the process's output stream*, "delivered to a caller
or merely parsed into pending, either way". A lookahead record is already counted, so a reclaim that
happens while it is parked resumes past it rather than re-walking it. No change needed — but the
implementer should re-read that comment before touching the loop, because it is the invariant the
lookahead leans on.

### D7 — After a load, the graph asks `graph.status` for the terminal truth — and `CONTRACT_VERSION` stays 21

F7's zero-chunk re-stream cannot be fixed by any change to what chunks say. Three routes were
considered:

- **Emit a terminal zero-row chunk.** Rejected: `packedStream.applyChunk` treats `chunk.from === 0`
  as a restart-and-reset signal (`packedStream.ts:74-77`), so a `from == to == 0` terminal chunk
  would wipe the store it was sent to terminate. Widening the chunk shape to distinguish them is a
  contract change.
- **Add `remaining`/`exhausted` to `graph.loadMore`'s result.** Rejected: a `CONTRACT_VERSION` bump
  21 → 22 for something an existing request already answers.
- **Ask `graph.status`.** Chosen. It exists, it is served for both the graph and the ranged review
  walk (`graph.go:63-97`), it returns exactly `{loaded, remaining, exhausted}`, and its `Remaining`
  is the walk's cached count, so the call is cheap.

So `GraphViewState.#runLoad`, after its resync `openStream`, issues one `graph.status` and applies
the result through a new `PackedStreamState.applyStatus(remaining, exhausted)`. One extra round trip
per user-initiated load — negligible against the page read it follows.

**Only the graph, not the review view.** The review sidebar re-streams from cursor 0 every time
(F4), so its chunks always exist and D5 makes them truthful; the one hole left is the *empty range*,
which has no chunk to fix and which D9 covers at the point of use. Adding a status round trip to
`ReviewSessionState.#open` would buy nothing the graph needs it for — the review view has no
`loadAll` loop to terminate — and would put a second mechanism where one suffices.

### D8 — `loadAll()` and `revealSha()` stop when a page adds nothing

Three lines each, in `graphView.ts`:

```ts
const before = this.loadedRows.value;
await this.#runLoad('loadingMore', …);
if (this.loadedRows.value === before) break;
```

A page that appended no rows means there are no more rows, whatever the flags say. This makes the
loops terminate on their own evidence rather than on a signal that arrives from three layers away —
which is the right shape for a loop that can otherwise hammer a backend indefinitely, independent of
whether D5/D6/D7 are all correct.

It does not fire spuriously: a mid-loop ref change resets the walk and *lowers* `loadedRows`, which
is `!==` the previous value, so the loop continues as it should.

### D9 — Neither pager offers an action that would load zero rows

`LoadMoreButton.vue:54` and `ReviewView.vue:717` gain a `remaining > 0` condition alongside the
existing `!exhausted`, keeping the block visible while a load is in flight so the Cancel affordance
does not vanish mid-load:

```vue
v-if="!graphView.exhausted.value && (isLoading || graphView.remaining.value > 0)"
```

SPEC asks for the source fix "rather than papering over it client-side", and D5–D7 are that fix.
This is not the paper: a control that promises to load zero rows is independently wrong, and F7's
empty-review-range case has **no server-side signal to correct** — zero chunks are emitted, so there
is nothing for D5 to make truthful and no `loadAll` loop that would justify D7's extra round trip
there. This is the correct fix for that case and a redundant one for the others.

**With one consequence stated plainly:** because this hides the symptom, it would also hide a
regression of D5/D6 from any test that looked only at the button. That is why the regression guards
for F4 and F5 are Go tests asserting the wire values directly (§3.1, §3.2), not UI assertions.

### D10 — The geometry guard: the extension's own Playwright project, Chromium, the real document, a dead transport

**Where.** A new `apps/kira-studio-vscode/playwright.config.ts` with a single `webview-layout`
project, not a fifth project inside `apps/kira-studio/playwright.config.ts`. SPEC's own module-
boundary rule for this chapter — "git-specific frontend code lives under its own directories … and
no phase merges git and studio/api code into a shared file where a per-module one would do" —
decides it: that config is a studio file.

**Which browser: Chromium.** VS Code is Electron, so a webview is a Chromium iframe. The studio
tier's `webkit` choice is right for *its* target (WKWebView in a packaged Wails app) and wrong for
this one. Both are already installed.

**What document.** The real one. `html.ts` is refactored so that the document assembly is a pure,
`vscode`-free function the test can call:

- New `apps/kira-studio-vscode/src/webviewDocument.ts` — takes `WEBVIEW_ENTRY`, the `ViteManifest`
  types, the existing `collectCss` (already pure), and a new `buildWebviewDocument({ scriptUrl,
  styleUrls, cspSource, view, bootstrap, nonce })` holding the template literal that is currently
  inline in `renderHtml`.
- `html.ts` keeps `renderHtml`, `resolveUiAssets` and `nonce()`, imports the rest, and emits a
  byte-identical document.

This matches the convention G15 D11 states — keep the testable half `vscode`-free — and avoids the
alternative, which was to invent a `vscode` module stub plus tsconfig path mapping to import
`renderHtml` itself. The residual untested surface is exactly `webview.asWebviewUri` and
`vscode.Uri.joinPath`, which are VS Code's own functions; the manifest walk, the CSP string, the
head/body order and the bootstrap island are all the genuine article.

**How it runs.** A per-worker static server over `apps/kira-studio-vscode/dist/ui` (the same shape
as `apps/kira-studio/tests/ui/support/server.ts`, reimplemented in this package rather than imported
across the module boundary) serves the built assets and the document, with `cspSource` set to the
server's own origin. `page.addInitScript` installs the `acquireVsCodeApi` stub — measured in F9 to
survive the real CSP. **No transport, no backend, no repo**: the app boots, renders its root, and
sits in its pre-connect state, which is all the geometry assertions need.

**What it asserts** — per case, in `getBoundingClientRect()` pixels:

| # | assertion | catches |
|---|---|---|
| 1 | root height `===` viewport height | F1 |
| 2 | root `x === 0` | F2 |
| 3 | root width `===` viewport width | F2 |
| 4 | `getComputedStyle(document.body).padding === '0px'` | F2, directly |
| 5 | `documentElement.scrollHeight <= viewport height` | the whole-document-scroll manifestation |
| 6 | zero `pageerror`s and zero console errors during boot | a CSP or asset regression in the emitted document |

Three cases: graph at 1400×360 (the panel size from the report), graph at 400×300 (proving it does
not depend on a generous viewport), review at 400×700 (the sidebar).

**What it deliberately does not assert:** rendered row counts, `.slick-viewport` height, or anything
else that needs data. Those need a real backend and belong to Tier 3. Asserting them against a stub
would be the same mistake as G14's `aria-rowcount` — a proxy that can pass while the thing is
broken.

**Wiring.** A root `package.json` script:
`"test:webview": "bun run build:vscode && playwright test --config=apps/kira-studio-vscode/playwright.config.ts"`,
mirroring `test:ui`'s form. `reporter: [['list']]` only — a second HTML reporter would fight the
root `playwright-report/` directory the studio config already writes.

### D11 — What gets a test, and what deliberately does not

**Gets one:**

- `logsession/session_test.go` — one new test for D6's exact-multiple case. AGENTS.md names
  "cursor/pagination boundary arithmetic" as a carve-out from the no-unit-tests default, and this is
  literally that.
- `gitsession/walk_test.go` — one new test for D5: a cache-replay re-stream ends with
  `Exhausted: true`. This is the direct regression guard for the bug the user actually saw, it needs
  no browser, and it is immune to D9 hiding the symptom.
- The geometry spec (D10).

**Gets none, and why:**

- **D8's no-progress break.** Three lines, one comparison. Testing it means faking `BridgeClient`
  *and* `LayoutClient` (whose default constructs a Worker) inside a package that is not currently in
  `test:unit`'s glob at all. AGENTS.md: "A single `if` guarding one obvious case isn't complexity"
  and "when torn between two similar tests, delete." The Go-level guard already covers the condition
  that produces the spin.
- **D9's template conditions.** One-condition render guards.
- **F6's record-drop path.** Reaching it requires an `io.Reader` that returns `(n>0, io.EOF)` from a
  real `git log` pipe, which cannot be forced deterministically. D6 removes it structurally; §3.1
  says so rather than claiming coverage.
- **D2's CSS.** The geometry spec *is* its test, in pixels.

---

## 3. The Go side, file by file

### 3.1 `apps/kira-studio/internal/gitclient/logsession/session.go` — edited (D6)

- Rename field `exhausted` → `eof` (line 88).
- Add `exhaustedLocked()` (F6/D6), with the doc comment from D6.
- `ReadPage` (line 111):
  - line 117 → `if s.exhaustedLocked() { return Outcome{Exhausted: true}, nil }`
  - line 121 → `if s.proc == nil && !s.eof {`
  - line 141 → `for !s.eof && (appended < pageSize || len(s.pending) == 0) {`
  - line 176 → `s.eof = true`
  - line 183 → `if !s.eof {`
  - line 187 → `return Outcome{Appended: appended, Exhausted: s.exhaustedLocked()}, nil`
- `Exhausted()` (line 326) → `return s.exhaustedLocked()`.
- One comment on the loop condition saying what the lookahead is for, and one on the spawn guard
  saying what it prevents. Nothing else in the file changes; `Remaining`, `countTotal`, the reclaim
  timer and `spawnOrResumeLocked` are untouched.

### 3.2 `apps/kira-studio/internal/gitclient/logsession/session_test.go` — edited (D6, D11)

- **`TestSession_ReclaimAndSkipResume` changes**, as F5 predicts: with 4 commits at `PageSize: 2`,
  page 2 now returns `Exhausted: true` (it was `false`), because the lookahead read observes EOF
  before the call returns. Update that assertion at line 165-167 and **rewrite the comment above it**
  — it currently asserts there is no way to know, and there now is. Page 3's assertion
  (`{Appended: 0, Exhausted: true}`) still holds, via the early return.
- `TestSession_Exhaustion_FurtherReadIsNoOp` (2 commits, `PageSize: 100`) is unaffected — it drains
  to EOF either way. The multi-page test's `appendedPerPage` expectations are unaffected too:
  delivery is still capped at `pageSize`, only the timing of the flag changes. **Verify both rather
  than assuming**; `go test ./internal/gitclient/logsession/` is the check.
- **New** `TestSession_ExactMultiplePageIsExhaustedImmediately`: N commits at `PageSize: N` (and a
  second case at `N/2`), asserting the final full page returns `Exhausted: true` in the *same* call,
  and that a following `ReadPage` is a no-op appending 0. This is the F5 regression guard.

### 3.3 `apps/kira-studio/internal/gitsession/walk.go` — edited (D5)

- `emitRange` (line 234): fourth parameter `exhausted bool` → `last bool`; chunk field becomes
  `Exhausted: last && w.log.Exhausted()`.
- Replay loop (line 259): `emitRange(cursor, to, "cache", to == cachedThrough)`.
- Git loop (line 284): `emitRange(cursor, to, "git", to == newTotal)`.
- `readPageLocked` (line 183) narrows to `(appended int, err error)`; both call sites (lines 173,
  276) updated.
- Two comments: the mutual exclusion that makes `to == cachedThrough` the stream's terminal chunk,
  and a note that the zero-chunk case (F7) exists and is closed client-side by D7 rather than by an
  empty terminal chunk — so the next reader does not "fix" it by inventing one.
- `Walk.Status` (line 157) is untouched and becomes correct via D6.

### 3.4 `apps/kira-studio/internal/gitsession/walk_test.go` — edited (D5, D11)

**New** `TestWalk_StreamReplayReportsExhausted`: build a walk over a repo of N commits with
`pageSize >= N`; stream once (first stream reads a page, final `"git"` chunk carries
`Exhausted: true`); stream again with `resumeThroughRow = 0`; assert the **last emitted chunk** is
`Source: "cache"` with `Exhausted: true` and `Remaining: 0`. Before D5 this test fails on the second
stream, which is exactly the user-visible bug.

### 3.5 Everything else under `apps/kira-studio/internal/` — not edited

`gitrpc/graph.go`, `gitrpc/wire.go`, `gitsession/review.go`, `gitstore/*` — no change. The chunk
envelope's fields, the request keys and the results are all already correct; only the values put
into them were wrong.

---

## 4. The TypeScript / Vue side, file by file

### 4.1 `packages/git-ui/src/theme/app-shell.css` — **new** (D1, D2)

The nine lines in D2, with a doc comment stating: what the file is for, that a VS Code webview
document has no height of its own, that `mount()` is a document-owning bootstrap rather than a
widget factory, and that `overflow: hidden` is a deliberate clip-not-scroll choice.

### 4.2 `packages/git-ui/src/main.ts` — edited (D1, D2)

- `import './theme/app-shell.css';` as the **first** CSS import (lines 7-12), so the shell is the
  base everything else layers onto.
- `mount()` adds `kv-mount-root` to `container` before `app.mount(container)`, and the returned
  `MountHandle.unmount()` removes it after `app.unmount()`. A one-line comment names it as the other
  half of `app-shell.css` — the class and the rule are useless apart, and they live in two files.

### 4.3 `packages/git-ui/src/state/packedStream.ts` — edited (D7)

New `applyStatus(remaining: number, exhausted: boolean): void` setting the two refs. Deliberately
separate from `applyChunk`: this is terminal state from a different request, not a chunk, and
folding it into `applyChunk` would drag the reset-on-`from === 0` logic somewhere it does not belong.

### 4.4 `packages/git-ui/src/state/graphView.ts` — edited (D7, D8)

- `#runLoad` (line 234): after the resync `openStream` in the `finally`, one
  `graph.status` request, applied via `applyStatus`. Guarded so a failed status call cannot mask the
  load's own error and cannot leave `loading` stuck — the existing `finally` shape already sets
  `loading = 'idle'` and must keep doing so.
- `loadAll` (line 159) and `revealSha` (line 197): D8's no-progress break, with a one-line comment
  saying it is a termination guard independent of the exhaustion signal.

### 4.5 `packages/git-ui/src/components/LoadMoreButton.vue` — edited (D9)

Line 54's `v-if` gains `&& (isLoading || graphView.remaining.value > 0)`.

### 4.6 `packages/git-ui/src/components/review/ReviewView.vue` — edited (D9)

Line 717's `v-if` gains the equivalent condition against `review.remaining.value` and the view's own
loading flag (`isLoadingMore`). This is the half of F3 the previous investigation did not report.

### 4.7 `apps/kira-studio-vscode/src/webviewDocument.ts` — **new** (D10)

`vscode`-free: `WEBVIEW_ENTRY`, `ViteManifestEntry`/`ViteManifest`, `collectCss` (moved verbatim
with its existing doc comment), and `buildWebviewDocument()` carrying the document template and the
CSP assembly. Its doc comment says why it is separate: so the geometry guard can build the *real*
document without a `vscode` stub, and names G14 as the reason the guard must be real.

### 4.8 `apps/kira-studio-vscode/src/html.ts` — edited (D10)

Keeps `renderHtml`, `resolveUiAssets`, `nonce`, `RenderHtmlOptions` and `ReviewTarget`; imports the
rest from `webviewDocument.ts`. **The emitted document must be byte-identical** — this is a
pure extraction. §7.4 carries it as a checklist item.

### 4.9 `apps/kira-studio-vscode/playwright.config.ts` — **new** (D10)

One `webview-layout` project, `testDir: './tests/layout'`, `browserName: 'chromium'`,
`fullyParallel: true`, `reporter: [['list']]`, `outputDir` under the repo-root `test-results/` in
its own subdirectory. A doc comment records why Chromium and not WebKit (Electron, not WKWebView),
and why this is a second config rather than a fifth project in the studio's.

### 4.10 `apps/kira-studio-vscode/tests/layout/support/server.ts` — **new** (D10)

Per-worker static server over `apps/kira-studio-vscode/dist/ui`, serving the built assets and the
document produced by `buildWebviewDocument`. Reimplemented here rather than imported from
`apps/kira-studio/tests/ui/support/server.ts`, per the module boundary; its doc comment says so.

### 4.11 `apps/kira-studio-vscode/tests/layout/webview-layout.spec.ts` — **new** (D10)

The three cases and six assertions from D10, plus the `acquireVsCodeApi` `addInitScript` stub. The
file opens with a comment stating what this tier is for in one sentence — *G14 passed on DOM shape
while the panel was destroyed; this tier asserts pixels* — and what it deliberately cannot cover
without a backend.

### 4.12 `package.json` (root) — edited (D10)

Adds `test:webview`. No dependency change.

### 4.13 Not edited

`packages/git-ipc/src/contract.ts`, `validate.ts` (`CONTRACT_VERSION` stays 21),
`packages/git-core`, `apps/kira-studio-vscode/package.json` (no new command, no new setting),
`apps/kira-studio/frontend/**` (the Wails app has its own `index.html` and is untouched by all of
this), `docs/v1.3/SPEC.md`.

---

## 5. Dependencies and tooling

Nothing new. Confirmed present and working in this container:

- `@playwright/test` 1.62.1, already a root devDependency.
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` containing `chromium-1234`,
  `chromium_headless_shell-1234`, `webkit-2336`. **No `playwright install` step is needed** —
  running one here is a no-op that prints nothing, which is itself worth knowing, since an
  implementer who runs it and sees no output may wrongly conclude it failed.
- `bun run build:vscode` — 1.1s, produces `dist/ui/assets/webview-*.{js,css}`, the codicon TTF, and
  `.vite/manifest.json` whose entry carries the stylesheet in its own `css` array.

---

## 6. Implementation order

One sequential subagent; the work is order-dependent and small.

1. **D2 + D1's `main.ts` half** — `app-shell.css`, the import, the `kv-mount-root` class. Build.
2. **D10's extraction** — `webviewDocument.ts` out of `html.ts`. Typecheck; confirm the emitted
   document is unchanged.
3. **D10's tier** — config, server, spec, root script. Run it. **It must fail step 1 if step 1 is
   reverted** — check that once, by hand, before moving on; a guard that passes on the broken tree
   is worse than no guard.
4. **D5 + D6** — the two Go fixes, together, since D5's test depends on D6's flag being accurate.
   Update the two existing `session_test.go` assertions and add the two new Go tests. `go test ./...`.
5. **D7 + D8** — `packedStream.applyStatus`, the `#runLoad` status call, the two loop breaks.
6. **D9** — both pagers.
7. Full check pass: `bun run lint`, `bun run typecheck`, `bun run test:unit`, `go test ./...`,
   `bun run build:vscode`, `bun run test:webview`.

Commits land incrementally, Conventional Commits, one per numbered step or finer.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 Tier 1 — fully provable in this container

Unusually for this chapter, the phase's central guard is here rather than in Tier 3.

1. `bun run test:webview` passes: the graph root is exactly viewport-height at 1400×360 and at
   400×300, the review root exactly viewport-height at 400×700, all three at `x = 0` and full
   viewport width, computed `body` padding `0px`, no document-level scroll, no page or console
   errors. **Prototype-measured on the current tree**: 0px → 360px and 65px → 700px, `x` 20 → 0.
2. Reverting `app-shell.css` makes that spec fail (step 3 of §6).
3. `go test ./...` passes, including the new `TestSession_ExactMultiplePageIsExhaustedImmediately`
   and `TestWalk_StreamReplayReportsExhausted`, and the two amended `session_test.go` assertions.
4. `TestWalk_StreamReplayReportsExhausted` fails against the pre-D5 tree.
5. `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run build:vscode` all pass.
6. `CONTRACT_VERSION` is still 21 (`grep`), and `packages/git-ipc/src/contract.ts` is unchanged
   (`git diff --stat`).
7. `html.ts`'s emitted document is byte-identical across the D10 extraction.

### 7.2 Tier 2 — provable here as a reasoned check, not a full proof

8. **The shell rule beats VS Code's own default stylesheet.** Measured against a faithful replica —
   the real declarations, wrapped in `@layer vscode-default` — and won on both layer precedence and
   source order. What cannot be proven here is that the *installed* VS Code version wraps its
   defaults in that layer and injects them where the replica does. Both the layer rule and the order
   rule favour us, and the fix uses no `!important`, so the failure would require both mechanisms to
   change at once. Tier 3 item 12 confirms it on a real host.
9. **The theme-token hypothesis stays ruled out.** Established before this phase across a full Dark
   Modern set, a full Light Modern set, and zero `--vscode-*` variables; nothing in this phase's
   changes is theme-dependent (no colour, no token, no `--vscode-*` reference in `app-shell.css`).
10. **No other consumer of `packages/git-ui` exists to be disturbed by an `html, body` rule.**
    `bun run build:vscode`'s Vite config declares exactly one entry, and this repo has no
    `apps/harness`. Checked by reading `vite.config.ts` and `ls apps/`.

### 7.3 Tier 3 — needs a human on a Mac, with VS Code and Kira Studio both running

11. The graph panel fills a docked panel at real panel heights, and shows a full screen of commits
    rather than one and a half rows.
12. VS Code's *actual* default stylesheet does not defeat the shell rule (Tier 2 item 8's residue),
    in both a light and a dark theme.
13. Selecting a commit no longer turns the webview into a ~1603px scrolling document; the toolbar
    stays pinned.
14. The review sidebar at a real sidebar width shows a bounded, internally-scrolling list with its
    header and footer pinned — not a 73832px document.
15. Against a real repository of ~2000 commits: after a full load, and again after hiding and
    revealing the view, **no pager renders at all**.
16. Alt-click "load everything" **terminates** on a fully-loaded history instead of spinning (F8).
17. An empty branch comparison in the review sidebar renders no pager (F7's second arm).

### 7.4 The checklist

- [ ] `app-shell.css` exists, is imported first in `main.ts`, and contains no colour and no token.
- [ ] `mount()` adds `kv-mount-root` and `unmount()` removes it.
- [ ] `html.ts` emits a byte-identical document; no style rule was added to it (D3).
- [ ] `emitRange`'s flag is derived from `w.log.Exhausted()` at the emit site, once.
- [ ] `logsession` distinguishes `eof` from exhausted, and the spawn guard tests `!s.eof`.
- [ ] `session_test.go`'s "there is no way to know" comment is rewritten, not just its assertion.
- [ ] Both pagers changed, not just `LoadMoreButton.vue`.
- [ ] `CONTRACT_VERSION` is 21.
- [ ] `test:webview` is in the root `package.json` and passes.
- [ ] The geometry spec fails on a tree with `app-shell.css` reverted.

---

## 8. Explicit non-goals for G16

- Making the graph render *more rows*. The row count was always right — `aria-rowcount` matched the
  real repository in both the broken and fixed states, which is the whole reason G14 missed this.
  This phase changes the size of the box, not the data in it.
- Reworking `#runLoad`'s two-round-trip contract (`loadMore` then re-stream). It is deliberate and
  documented; D7 adds a third small call rather than redesigning it.
- Any `stash` work (G17 owns it).
- A general-purpose "render `packages/git-ui` in a browser" test tier. D10 builds the narrowest
  thing that guards this regression class. Growing it into a UI-behaviour tier would need a mocked
  transport and is a phase of its own.

---

## 9. Handed forward

- **The guard cannot see data-dependent geometry.** SlickGrid's viewport height, its 39px floor, and
  the rows-versus-container relationship all need a backend. If a later phase builds a mocked
  transport for `packages/git-ui`, extending `webview-layout` to assert `.slick-viewport`'s height
  against the container's is the natural next assertion.
- **`asWebviewUri`/`Uri.joinPath` stay untested** (D10) — VS Code's own functions, exercised only on
  a real host.
- **`mount()` is now explicitly document-owning.** A future host wanting `packages/git-ui` inside a
  page region needs a second entry point that skips `app-shell.css`; noted in that file's comment.
- **F6's record-drop path is removed structurally, not covered by a test.** If a later phase gains a
  fake `io.Reader` seam for `logsession` (there is none today — `Deps.Runner` is the only injection
  point and it produces real processes), a `(n>0, io.EOF)` case becomes writable and is worth one
  test.

---

## 10. Calls that want a human eye

The height-fix location is **decided**, not punted (D1: approach (b), the rule in
`packages/git-ui`). These four are the ones where a human's judgment would genuinely change
something.

### 10.1 SPEC's G16 row names the wrong file for the pager, and this plan does not edit SPEC

SPEC says to fix the exhaustion signal "at its source (`internal/gitclient/logsession/session.go`)".
F4/F5 establish that `session.go`'s defect is real but **cannot** produce the reported symptom on a
2004-commit repository at the default 5000 page size, and that the defect which does is
`gitsession/walk.go:259`'s hardcoded `Exhausted: false`. This plan fixes both, so the *code* outcome
is a superset of what SPEC asked for either way.

What wants a decision is the record: leave SPEC's row as written and let this plan carry the
correction (the precedent G12, G14 and G15 all set), or amend the row. Recommendation: leave it —
plans are the per-phase record; but a reader of SPEC alone will be misled about where the bug was.

### 10.2 `overflow: hidden` on `html, body`

The one line in D2 with a genuine trade-off. It guarantees the documented 1603px whole-document
scroll can never recur, at the cost of turning any future overflow into silent clipping rather than
a reachable scrollbar. The height chain alone already prevents the known failure; this is
belt-and-braces. Dropping it is a one-line change and costs nothing this phase can foresee — a
reviewer who prefers "clip nothing, ever" should say so and it comes out.

### 10.3 F8's infinite loop is not in SPEC's G16 row

`loadAll()` never terminating (and `revealSha()` with it) is the most severe thing found here, and it
is not among the three defects SPEC lists. It is folded in because it is a direct consequence of F4 —
fixing F4 without D8 leaves a loop whose termination depends entirely on three other layers being
right. Confirm that in-scope reading rather than deferring it to a later phase; deferring it means
shipping a known hang.

### 10.4 Should `test:webview` join the routine loop?

It costs a 1.1s build plus a few seconds of Chromium and it is the only thing in this repo that can
see a collapsed panel. There is no CI config in the tree to add it to, and AGENTS.md's guidance is
that expensive suites run once near the end of a phase. It is not expensive. Recommendation: run it
alongside `bun run typecheck`/`lint` in every phase that touches `packages/git-ui` or
`apps/kira-studio-vscode/src/html.ts` — but that is a standing-convention change, which is a human's
call, not a plan's.
