# G14 — The graph regression, root-caused for real, plus a review/diff UX batch

> **What this phase is.** The fourteenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and
> the third "bug/UX batch found by actually using the shipped `.vsix`" in it (G8 was the first, G12
> the second). SPEC's own G14 row lists **eight numbered items**. Item 1 is a core-functionality
> regression — the commit graph still renders no commits after G12's verified handshake/boot fix —
> and items 2–8 are concrete UX defects found in the same sitting.
>
> **In one line: item 1 is not in the data path at all. `App.vue` imports `CommitGrid` and
> `AppToolbar` with `import type`, so both are erased at build time and Vue renders them as
> unknown HTML elements — the graph's grid and its toolbar have never been instantiated once
> since G1's own migration commit (`41e295dd`), while every byte of history the server sends
> arrives, decodes and lands in the client's `CommitStore` correctly.** Reproduced here against a
> real 1977-commit repository, through the real built webview bundle in a real browser, and the
> one-line-per-import fix was re-run through the same harness and renders `aria-rowcount="1977"`
> with real rows and a real toolbar. Two more components (`DetailPane`'s `FileTree`,
> `AppToolbar`'s `RefreshButton`) are erased exactly the same way.
>
> **The mechanism that hid it for thirteen phases is named, and it is this repo's own toolchain:**
> `vue-tsc` typechecks the bug clean, `biome check` passes it clean, no test tier mounts a
> component — and `biome check --write` (i.e. `bun run format`) *converts a correct value import
> back into the broken type import* as a "safe fix". Confirmed by running it here. So D1 is not
> just four edits: the fix has to be made durable, or the next `bun run format` re-ships the bug.
>
> **Three corrections to SPEC's own G14 wording, on evidence, the same way G12 corrected its
> own row.** (a) Item 1's suspects — `graph.stream`, `logsession`, `gitstore`, the FlatBuffers
> decode, G12's auto-open, a `CONTRACT_VERSION` skew — are **all clean**, each disproven by a
> probe quoted below; no Go file changes in this phase. (b) Item 5 says the type scale is fixed;
> it is not — `--kv-t-*` already derives from `--vscode-font-size` (G12 D14). What genuinely does
> not follow the host is the **font family** (`--kv-font-ui`, a hardcoded stack whose own comment
> says "never user-customizable") and the **control heights** (fixed px that do not grow with the
> host's font size). The third suspect — hardcoded `px` font sizes — turns out not to exist in the
> review sidebar at all; every `px` size there is a glyph metric (F9). (c) Item 3 says the item is
> "too narrow"; read against the code the actionable complaint is that it *crowds* a narrow bar —
> §12.2 puts that reading to a human.
>
> **This phase ships one contract change**, flagged rather than smuggled: item 8 ("Open in graph")
> must name a commit, and `ui.action`'s payload is `{action}` with no room for one.
> `CONTRACT_VERSION` goes **20 → 21**. That is the third consecutive phase to bump it — §12.1.
>
> **Tiering is named honestly, per G9/G10/G12's precedent.** Item 1 is provable here end to end,
> against a real repository, in a real browser, and its guard runs in `bun run test:unit`. Items
> 4–6 are provable as type/lint/grep checks plus a reasoned argument. Items 2, 3, 7 and 8 need a
> human on a Mac with a real VS Code and a running Kira Studio. §8 says which is which, per item,
> and never claims more.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`2218c9bb`, the whole
of G1–G13 plus the SPEC edit that inserted this phase). Every claim below was checked against
source read, or a command **run in this container**. G1–G13's own plans are records of intent and
are verified against the code they produced rather than trusted.

| Claim | Evidence |
|---|---|
| G13 landed in full; G14 is the tip's next phase | `git log --oneline`: `1a90b58d`…`19606ea6`, then `2218c9bb` (`docs(v1.3): insert G14…`) |
| `CONTRACT_VERSION` is **20** in all three hand-maintained places, and they agree | `gitrpc/contract.go`, `packages/git-ipc/src/validate.ts:19`, `tests/e2e-real/git-pairing-real.spec.ts:93` |
| `bun run typecheck:git` is green **with the item-1 bug present** | run here, no output — this is the point of F5, not an aside |
| `bun run lint` is green on the tree as it stands | run here (the only failures observed were in this session's own throwaway probe files) |
| `bun run build:vscode` produces both bundles and passes its own checks | run here: `dist/ui/assets/webview-RCBULds3.js` 280.30 kB, `dist/extension.cjs`, "bundle checks passed" |
| A real `gitsock.Server` streams **1977 commits in 4 chunks** for this repository | probe A, §1 F2 |
| The real TypeScript client stack decodes all 1977 rows, on both sides of the webview hop | probe B, §1 F2 |
| The real `proxyHandlers` + `RpcServer`/`RpcClient` + `GraphViewState` stack loads all 1977 rows and lays out 3 lanes | probe C, §1 F2 |
| The **real built webview bundle**, in headless Chromium, receives and applies all four chunks and renders **zero rows** | probe D, §1 F1 |
| …because `CommitGrid`/`AppToolbar` render as `<commitgrid>`/`<apptoolbar>` unknown elements | probe D's DOM dump, §1 F1 |
| Changing four `import type` to value imports makes the same harness render `aria-rowcount="1977"`, real rows and a real toolbar | probe D re-run after the fix, §1 F1 |
| The four bad imports date to G1's migration commit | `git log -L 18,19:packages/git-ui/src/App.vue` → `41e295dd feat(vscode): migrate the extension into this repo` |
| `biome check --write` converts a correct value import back to `import type` | run here on `DetailPane.vue`: "Fixed 1 file", the line reverts |
| `biome check` (no `--write`) reports it as a **warning** and still exits 0 | run here: `biome exit=0` |
| `AppToolbar.vue` already carries the exact `biome-ignore lint/style/useImportType` idiom for two other components | `AppToolbar.vue:31-37` (`BranchPicker`, `PullStrategyPicker`) |
| `FileTree`'s indent is a hardcoded `depth * 16` px | `FileTree.vue:382` |
| `--kv-t-*` already tracks `--vscode-font-size`; `--kv-font-ui` is a fixed stack; `--kv-h-*`/`--kv-bar-h`/`--kv-icon-box`/`--kv-s-*` are fixed px | `packages/git-ui/src/theme/kira-structure.css`, `vscode-tokens.css:94-97` |
| The status-bar item renders `$(icon) Kira Version` in all five states, with a plain-string tooltip and no `name` | `extension.ts:79-137` |
| Nothing contributes to `editor/title`; `focusGraph` already shows the icon + `navigation` group pattern | `package.json#contributes.menus` (4 entries: `scm/title`, two comment menus, `commandPalette`) |
| `ui.action`'s payload is `{ action: UiActionKind }` — no room for a target | `contract.ts:1430` |
| `reviewAnchorFor(uri)` already resolves `(repoId, branch, path, at)` from a review diff's URI, statelessly | `reviewComments.ts:33-39` (G13 D20 built it as this phase's seam) |
| Wails beta.16's notification service has `RegisterNotificationCategory`/`SendNotificationWithActions`/`OnNotificationResponse`, and its darwin C entry points call `ensureDelegateInitialized()` themselves | `pkg/services/notifications/notifications.go:296,278,233`; `notifications_darwin.m:115,135,346,381,422` |
| Kira Studio focuses its window **first** and only notifies when no window exists | `main.go:359-381`, `notifyPairingPending` at `:516` |
| Toolchain here: Go 1.27.0, git 2.43.0, bun 1.3.11, node 22.22.2, `@playwright/test` present | run here |

**The four probes.** None is a deliverable (G12's own convention — a probe's permanent form is a
test, and D11 says which one this phase keeps). Each was built from **real production modules**,
never a re-implementation, so that a green probe means the real code is green:

| # | What it is | What it proved |
|---|---|---|
| **A** | A Go test in `internal/gitsock`'s existing integration tier (`newIntegrationServer`, `pairAndReady`, `openRepoOK`, `openStream`, `decodePackedChunk`), pointed at **this repository** instead of a synthetic fixture, issuing exactly the extension's own request | The server side, on a real 1977-commit repo with 9 refs |
| **B** | A Bun client: real `createSocketChannel` + `createRpcClient` + `CommitStore`, plus the extension→webview hop applied to every chunk (`encodeStreamPayload` → `encode(…, 'base64')` → `JSON.parse(JSON.stringify(…))` → `decode` → `decodeStreamPayload`) | The wire, the FlatBuffers codec, the base64 hop and the store |
| **C** | The same, plus the **real `createProxyHandlers`**, a real `createRpcServer`/`createRpcClient` pair over an in-memory base64 channel, a real `BridgeClient` and a real `GraphViewState` | The whole client stack minus the DOM: settings injection, credits, lane layout |
| **D** | The **real built `dist/ui` bundle** served over HTTP, its `acquireVsCodeApi` shimmed onto a WebSocket carrying the same frames VS Code's `postMessage` would, driven by headless Chromium via `@playwright/test`, with every frame logged on the bridge | The actual rendered DOM — and the bug |

Probe D is ~150 lines and is worth rebuilding rather than re-deriving; §11 hands it forward as the
mounted-component harness G12 §11 already asked for.

### 0.2 Scope

Eight items, eight fixes, and nothing else.

| SPEC G14 item | Root cause | Finding | Decision | Tier (§8) |
|---|---|---|---|---|
| **1** The graph still renders nothing | `App.vue`'s `CommitGrid`/`AppToolbar` are `import type`, so Vue never instantiates either. The data path below them is **healthy at every layer** | F1, F2, F3, F4, F5 | D1, D2, D3 | **1** |
| **2** Pairing prompt becomes a real system notification | `main.go` focuses the window first and notifies only when no window exists; the notification carries no actions | F6 | D4 | **3** |
| **3** Status-bar item crowds the bar | Every state renders `$(icon) Kira Version`; the tooltip is a plain string; no `name` | F7 | D5 | **2** / **3** |
| **4** File-tree indentation too large | `FileTree.vue:382` hardcodes `depth * 16` px — double VS Code's own tree indent | F8 | D6 | **2** |
| **5** Font should follow VS Code | Not the type scale (already does), and not stray `px` sizes (there are none in the sidebar): the font **family** and the control **heights** | F9 | D7 | **2** |
| **6** Review UI modelled on GitLens | One-line commit rows that truncate in a sidebar, no row actions, no comparison summary | F10 | D8 | **2** / **3** |
| **7** "Go to file" in the diff toolbar | Nothing contributes to `editor/title`; the capability itself already exists (G4) | F11, F12 | D9 | **3** |
| **8** "Open in graph" in the diff toolbar | Same, plus `ui.action` cannot carry a commit | F11, F13 | D10 | **3** |

### 0.3 Not in this phase

- **Any Go change to the git data path.** F2 proves `gitrpc`, `gitclient/logsession`, `gitstore`
  and `gitwire` all correct against a real repository; §8.4 makes "no diff under those paths" a
  checklist item, exactly as G12 did after its own F5.
- **Range/hunk-level "mark reviewed"** — that is **G15**, its own phase (SPEC's renumbered table).
  G13's D20 refers to it as "G14" under the pre-insertion numbering; it means today's G15. This
  phase adds no gutter decoration and no `CodeLensProvider`.
- **Restyling the graph panel.** Item 6 says "the branch review UI". D8 keeps its changes inside
  the review root's own scope, exactly as G12 D14 scoped `kira-structure.css`.
- **Avatars in the review sidebar.** GitLens's rows carry Gravatar/GitHub avatars; this app has no
  avatar source, no network budget and no place to cache one. D8 says so rather than half-doing it.
- **A general logging/diagnostics subsystem for the webview.** Item 1 is root-caused; inventing an
  observability layer to re-find a bug that is already found is exactly the scope creep D2 forbids.
  D3 keeps the one honest gap (a boot failure that renders nothing once a repo is open).
- **`stash.list`'s unhandled rejection** (F14) — real, observed, and G16's, not this phase's.
- **Editing `docs/v1.3/SPEC.md`.** A chapter spec is not retro-edited by a phase; the three
  corrections above are settled here.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or **run** here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out is left out entirely.
- **Layering:** no `internal/git*` package may import `internal/bridge` or Wails.
  `TestDomainPackagesDoNotImportBridge` stays green. D4's notification work lives in `main.go`,
  the one file that legitimately sees both sides — the same place G12 D8 put its predecessor.
- **No shell anywhere.** This phase spawns no subprocess at all; the rule is restated because D4
  touches the one file that could be tempted to (`osascript` for a notification is explicitly
  rejected in D4).
- **Comments: very concise, only where the code cannot say it itself.** D1's four `biome-ignore`
  lines are the exception that earns its keep — each states *why* a value import is load-bearing.
- **Tests only where `AGENTS.md`'s bar is met.** D11 says, per item, whether one is warranted and
  why. Exactly one new test is added, and §D11 argues it against the bar by name.
- Commits are Conventional Commits, granular, landing as work completes.

---

## 1. Findings

### F1 — The graph's grid and its toolbar are never instantiated: `App.vue` imports both with `import type`, so Vue renders them as unknown HTML elements

**This is item 1, and it is not in the data path.**

`packages/git-ui/src/App.vue:18-19`:

```ts
import type AppToolbar from './components/AppToolbar.vue';
import type CommitGrid from './components/CommitGrid.vue';
```

A `.vue` file's default export **is a component object** — a value. `import type` erases it at
compile time. Vue's SFC compiler, seeing no value binding for the tag, emits
`_resolveComponent("CommitGrid")`; at runtime that resolves to nothing, Vue falls back to creating
an *element* vnode with the component's own name, and the browser renders an unknown element whose
object props stringify.

**Observed, in the real built bundle, in a real browser** (probe D, against this repository through
a real socket):

```
"graphHtml": "<section class=\"kv-graph-region\" data-testid=\"graph-region\" aria-label=\"Commit graph\">
                <commitgrid graph-view=\"[object Object]\" selection=\"[object Object]\"
                            column-widths=\"[object Object]\" date-format=\"relative\"
                            search=\"[object Object]\" clipboard-enabled=\"true\"></commitgrid>
                <!---->
                <span class=\"kv-visually-hidden\" data-testid=\"chunk-source\">git</span></section>"
"appHtml":   "<div class=\"kv-app\" data-connection-state=\"connected\" …>
                <apptoolbar graph-view=\"[object Object]\" repo-state=\"[object Object]\" …></apptoolbar>
                <!----><main class=\"kv-body\">…"
"gridRows": 0
```

Three details in that dump are worth reading carefully, because together they rule out every other
explanation:

1. **`<commitgrid>` and `<apptoolbar>` are lowercase unknown elements**, with kebab-cased
   attributes carrying `[object Object]`. That is a component that was never resolved — not a
   component that rendered badly.
2. **`data-testid="chunk-source"` reads `git`.** That span renders
   `graphView.lastChunkSource.value`, which `PackedStreamState.applyChunk` only sets *after*
   `CommitStore.appendPacked` has succeeded. **The rows arrived and were stored.**
3. **`<!---->` where `LoadMoreButton` should be.** That component is a plain value import and does
   render — as an empty comment, because its own `v-if="!graphView.exhausted.value"` is false. The
   stream reached `exhausted: true`. So the client held all 1977 commits and displayed none of
   them, with no error anywhere.

The bridge log for the same run confirms it from the other side — every frame delivered, every
chunk credited back (a credit is posted only *after* `await onChunk(...)` resolves), and a clean
`end`:

```
[webview->host] {"t":"open","id":9,"method":"graph.stream","params":{"repoId":"/home/user/kira-studio","resumeThroughRow":0}}
[webview->host] {"t":"credit","id":9,"n":2}
[host->webview] {"t":"chunk","id":9,"seq":0}
[host->webview] {"t":"chunk","id":9,"seq":1}
[webview->host] {"t":"credit","id":9,"n":1}
[host->webview] {"t":"chunk","id":9,"seq":2}
[webview->host] {"t":"credit","id":9,"n":1}
[host->webview] {"t":"chunk","id":9,"seq":3}
[host->webview] {"t":"end","id":9}
```

**The fix, proven.** The four imports (F3's two included) were changed to value imports,
`bun run build:vscode` re-run, and probe D re-run unchanged:

```
"gridRows": 6,                       // six, not 1977, only because this harness's grid viewport is 39px tall
"graphHtml": "<section class=\"kv-graph-region\" …><div class=\"kv-commit-grid\" data-testid=\"commit-grid\">
              <div class=\"kv-grid-host slickgrid_861334 ui-widget\" role=\"grid\"
                   aria-rowcount=\"1977\" aria-colcount=\"5\" …>"
"appHtml":  "…<div class=\"kv-toolbar\" role=\"toolbar\" aria-label=\"Kira Version toolbar\">
              <div class=\"kv-repo-picker\"><button …><span class=\"codicon codicon-repo\"…>
              <span class=\"kv-repo-trigger-label\">kira-studio</…"
"bodyText": "connected kira-studio claude/feature-v1-3-headless-git Fetch Pull Push Stash changes…
             Both Commits Refs … docs(v1.3): insert G14, graph regression fix + review/diff UX polish batch
             Claude 16m 2218c9b test(git): review comments end to end Claude 27m 19606ea …"
```

`aria-rowcount="1977"` is the whole finding in one attribute: the grid knows about every commit the
server sent, and the toolbar, repo picker, branch name and remote buttons are all there.

**It has never worked.** `git log -L 18,19:packages/git-ui/src/App.vue` returns exactly one commit:
`41e295dd feat(vscode): migrate the extension into this repo` — G1's own migration. So the graph
has rendered no commits and no toolbar in this repo since the day the extension arrived, which is
precisely what G12 item 5 ("the commit graph doesn't render at all") and G14 item 1 ("still renders
nothing") each describe. G12's three fixes were all real and all necessary — they are what got the
panel, the status strip and the detail pane on screen — and they simply were not this.

### F2 — Every layer beneath the render is correct, against a real repository: the prompt's five suspects are all clean

Item 1's brief named five places to look. Each was tested, not reasoned about, and each is clean.
This matters as much as F1: it is what makes §8.4's "no Go diff" checklist item honest rather than
an omission.

**(a) `graph.stream` / `logsession` / `gitstore` / `gitwire`, against a real repo** (probe A —
this repository: 1977 commits, 9 refs, a real `--all` walk, `pageSize: 5000`, `scope: "all"`,
`resumeThroughRow: 0`, i.e. byte for byte the extension's own request):

```
repo.open ok: repoId="/home/user/kira-studio"
chunk seq=0 from=0    to=500  source=git remaining=0 exhausted=false shas=500 first=2218c9bb…
chunk seq=1 from=500  to=1000 source=git remaining=0 exhausted=false shas=500 first=18065e06…
chunk seq=2 from=1000 to=1500 source=git remaining=0 exhausted=false shas=500 first=e63bc2c0…
chunk seq=3 from=1500 to=1977 source=git remaining=0 exhausted=true  shas=477 first=b90431e3…
TOTAL: chunks=4 rows=1977
graph.status: loaded=1977 remaining=0 exhausted=true
```

There is no unborn-HEAD, detached-HEAD, unresolvable-ref or zero-page-size failure to find:
`walkSpecFrom` defaults `scope` to `"all"` → `RevSetArgs` → `--all`, and `pageSizeFrom` defaults to
`logsession.DefaultPageSize` (5000). Both defaults are exercised above.

**(b) The FlatBuffers decode and the client store, including the multi-chunk dictionary delta**
(probe B — the case G12's own 12-commit fixture could never reach, since it produced a single
chunk):

```
chunk seq=0 … dictBase=0 dictLen=8 shas=500
chunk seq=1 … dictBase=8 dictLen=0 shas=500
chunk seq=2 … dictBase=8 dictLen=0 shas=500
chunk seq=3 … dictBase=8 dictLen=0 shas=477
STREAM DONE chunks=4 directRows=1977 webviewRows=1977
webview row 0: {"sha":"2218c9bb…","parents":["19606ea6…"],"author":{…},"subject":"docs(v1.3): insert G14…"}
webview last row: {"sha":"f91ae956…","parents":[],…}
```

`directRows` is the store fed straight off the socket; `webviewRows` is a second store fed through
the full extension→webview transformation (`encodeStreamPayload` → base64 `encode` → a JSON
round trip → `decode` → `decodeStreamPayload`). Both 1977. `CommitStore.appendPacked`'s two
asserts — chunk start row and `dictionaryBase` vs. interner size — passed on all four chunks in
both stores, which is exactly the "silently produce zero decoded rows on a subtle mismatch" the
brief asked about.

**(c) G12's auto-open logic, and the settings injection on top of it** (probe C — the real
`createProxyHandlers` with a real settings snapshot, the real credit protocol, the real
`GraphViewState`):

```
app.init via the full stack: {"host":"vscode","contractVersion":20,"settings":{…,"kiraVersion.graph.pageSize":5000,"kiraVersion.graph.scope":"all",…}}
repo.list candidates: {"candidates":[{"path":"/home/user/kira-studio","label":"probe"}],"activeRepoId":null}
repo.open ok: /home/user/kira-studio
AFTER openStream: loadedRows=1977 remaining=0 exhausted=true laneCount=3 storeRows=1977
AFTER loadMore:   loadedRows=1977 remaining=0 exhausted=true
```

D7's candidate loop opens the right repository, the injected `scope`/`pageSize` are the coerced
defaults, and lane layout runs (3 lanes). Probe D repeats this through the real bundle and shows
`repo.list` → `repo.open` → `graph.stream` in the right order on the wire.

**(d) The `CONTRACT_VERSION` bumps (18→19→20).** All three hand-maintained copies read 20 and
agree; probe B's own handshake echoes `"contractVersion":20` and every subsequent call succeeds. A
version skew is a *hard stop* by construction (SPEC §3.4) — it can produce a blocked panel, never a
silent empty result.

**(e) A swallowed error.** There is one real swallowing path and it did not fire here:
`rpc.ts:203-208` chains chunk handling on `entry.queue`, so a throw inside `onChunk` rejects that
chain, no credit is posted, every later chunk is skipped and the stream neither resolves nor
rejects. Worth knowing about; not this bug — every chunk was credited (bridge log, F1) and
`chunk-source` reads `git`.

### F3 — Two more components are erased the same way, and one of them has cost a real feature

```
packages/git-ui/src/App.vue:18                  import type AppToolbar   from './components/AppToolbar.vue';
packages/git-ui/src/App.vue:19                  import type CommitGrid   from './components/CommitGrid.vue';
packages/git-ui/src/components/AppToolbar.vue:38 import type RefreshButton from './RefreshButton.vue';
packages/git-ui/src/components/DetailPane.vue:26 import type FileTree     from './FileTree.vue';
```

(That grep, `^import type [A-Z]\w* from '.*\.vue'`, over `packages/git-ui/src` and
`apps/kira-studio/frontend/src`, returns these four plus one legitimate hit —
`RawExchangePane.vue`'s `import type { FindBarHost }`, a *named type* export, which is correct and
must stay. D1's guard is written to tell those apart.)

Each is used as a component in its own template — `AppToolbar.vue:210` renders `<RefreshButton>`,
`DetailPane.vue:85` renders `<FileTree>` — and each is `import type` for the same reason: the
script's only *script-visible* reference is `ref<InstanceType<typeof X> | null>(null)`, a type
position.

**`DetailPane`'s is a user-visible feature loss in its own right**: the graph's commit-detail pane
renders `CommitMeta` and `DiffView` (both plain value imports) but has never rendered its file
tree, so a selected commit's changed files cannot be picked there at all. The review sidebar's own
file trees are fine — `ReviewCommitRow.vue:22` and `ReviewFilesPane.vue:27` both import `FileTree`
as a value — which is why item 4's "the file tree's indentation is too large" is a report about the
review sidebar and not about the graph.

`AppToolbar`'s `RefreshButton` is only latent today, since `AppToolbar` itself never mounts; it
becomes live the moment F1 is fixed, which is why all four are one commit.

### F4 — `bun run format` re-introduces the bug, and `bun run lint` will not stop it

The rule is `biome`'s `lint/style/useImportType`. With the fix applied, run in this container:

```
packages/git-ui/src/components/DetailPane.vue:26:8 lint/style/useImportType  FIXABLE
  ! All these imports are only used as types.
  > 26 │ import FileTree from './FileTree.vue';
  i Safe fix: Use import type.
```

and then, in the repo, with the repo's own config:

```
$ bunx biome check --write packages/git-ui/src/components/DetailPane.vue
Checked 1 file in 11ms. Fixed 1 file.
$ grep -n "FileTree from" packages/git-ui/src/components/DetailPane.vue
26:import type FileTree from './FileTree.vue';
```

Two consequences the fix has to be designed around:

- **`bun run format` (`biome check --write .`) silently re-breaks the graph.** Not "might" —
  it did, here, on the first try.
- **`bun run lint` cannot be the guard.** `biome check` classifies it as a *warning* and exits 0
  (`biome exit=0`, run here), so a tree with the fix passes lint and a tree without it passes lint.

Biome fires only when the script has at least one reference and all of them are type-position —
which is why `DetailPane`, `ConflictBanner` and the ten dialogs (referenced only in the template,
never in the script) are never flagged, and why exactly the four components that also hold a
template `ref` are.

**The idiom for this already exists in the codebase, eleven lines above one of the offenders**
(`AppToolbar.vue:31-37`):

```ts
// Plain (not `import type`) imports, unlike RefreshButton below: vue-tsc needs the real import to
// infer the template's inline @branch-from-stash handler's parameter type …
// biome-ignore lint/style/useImportType: see above
import BranchPicker from './BranchPicker.vue';
```

So D1 is not inventing a mechanism; it is applying the one this file already uses — and correcting
the "unlike RefreshButton below" that assumed the type import there was fine.

### F5 — Nothing in this repo's toolchain can see it, and that is why it survived thirteen phases

Stated as a finding because it is the argument for D11's one new test.

- **`vue-tsc` is green with the bug.** `bun run typecheck:git` was run here on the unmodified tree
  and produced no output. It has to be: `InstanceType<typeof CommitGrid>` is perfectly valid
  against a type-only import, and `vue-tsc` resolves the template's `<CommitGrid>` against the same
  imported symbol without caring whether a *value* survives to runtime.
- **`biome` prefers the bug** (F4).
- **No test tier mounts a component.** `bun run test:unit` covers `apps/kira-studio/tests/unit`,
  `packages/api-core/test`, `packages/git-ipc/src` and `apps/kira-studio-vscode/src` —
  `packages/git-ui` has no harness at all, which G12 §11 already recorded as an open gap.
  `tests/e2e-real/git-pairing-real.spec.ts` drives pairing, not a webview.
- **`build-vscode`'s own bundle checks pass**, because the bundle is structurally fine; the missing
  components are missing at *runtime*, and only in the DOM.

### F6 — The pairing prompt notifies last, and when it does, the notification cannot be acted on

Item 2. G12 D8 built the order deliberately — focus first, notify only as a fallback — and
`main.go:359-381` implements exactly that:

```go
if w := windowToActOn(); w != nil {
    application.InvokeAsync(func() { w.Show(); w.Restore(); w.Focus() })
    return
}
notifyPairingPending(notifier, req)
```

Two problems, and they are different:

1. **Window activation is not a prompt.** `Focus()` is
   `activateIgnoringOtherApps:YES` + `makeKeyAndOrderFront:` (`webview_window_darwin.go:1100-1113`).
   On a modern macOS that request is routinely demoted to a bouncing Dock icon when the frontmost
   app is something else, and it is invisible under a full-screen space or a second display. The
   user's report is the direct consequence: the approval sits in a window they are not looking at.
2. **`notifyPairingPending` sends a plain `SendNotification`** (`main.go:530`) with a title and a
   body and nothing to click. Even when it does appear, it can only *tell* the user to go and find
   the window.

**The platform side is already available in the pinned Wails module, and needs no cgo of our own:**
`RegisterNotificationCategory(NotificationCategory{ID, Actions: []NotificationAction{…}})`,
`SendNotificationWithActions(NotificationOptions{CategoryID, Data, InterruptionLevel, …})`,
and `OnNotificationResponse(func(NotificationResult))`, whose `Response.ActionIdentifier` and
`Response.UserInfo` come back from the tapped button (`notifications.go:109-135`, `:206-233`,
`:278`, `:296`). `NotificationOptions` also carries `InterruptionLevel`
(`InterruptionLevelTimeSensitive`/`Critical`), which is macOS's own mechanism for surfacing above a
Focus mode — i.e. literally item 2's "above whatever the user is currently looking at".

**One real constraint, and one non-constraint.** The constraint is unchanged from G12 D8: the
darwin implementation refuses without a bundle identifier (`notifications_darwin.go:66-67`), so
none of this works in `bun run dev` — only in a packaged, signed `.app`. The *non*-constraint is
the delegate: G12 deliberately does not register the notifier as a Wails service (a service's
`ServiceStartup` error is fatal to the whole app, and this one's fails by design outside a bundle),
and it turns out not to need to — `notifications_darwin.m` calls `ensureDelegateInitialized()`
itself at every C entry point (`:115`, `:135`, `:346`, `:381`, `:422`), including
`sendNotificationWithActions` and `registerNotificationCategory`. So action responses can be
delivered without the service lifecycle G12 correctly refused to adopt. This is read off the pinned
module's source, not measured — a Mac is required to confirm it, and §8.3 asks for exactly that.

### F7 — The status-bar item spends its width on its own name and puts everything useful in a plain-string tooltip

Item 3. `extension.ts:79-137`. In all five states the text is `$(<icon>) Kira Version`; the
differences between states are the icon, the tooltip and (for two states) `backgroundColor`. The
tooltip is a plain `string`, so it cannot be structured, and `item.name` is never set, so the item
appears unnamed in the status bar's own "manage" context menu.

What is actually load-bearing in that bar, in a strip the user also fills with problems, ports,
language mode, encoding, line ending and a git branch, is: **is Kira Studio reachable, and is it
busy?** — an icon answers both. "Kira Version" is a constant; the socket path, the workspace root,
the server version and the mismatch detail are all detail a hover can carry.

### F8 — The file tree indents 16px per depth, twice what the workbench itself uses

Item 4. `FileTree.vue:382`:

```html
:style="{ paddingLeft: `${row.depth * 16}px` }"
```

VS Code's own `workbench.tree.indent` default is **8**, and every tree in the workbench (Explorer,
SCM, Search results) uses it. At 16px a four-level path costs 64px of a ~300px sidebar before the
filename starts — which is exactly the "wastes horizontal space" in the item. The number is a
literal in a template binding, not a token, so it cannot be tuned by the sidebar's own scale.

### F9 — What does *not* follow the host is the font family and the control heights — not the type scale, and not a stray literal

Item 5, and this is the correction SPEC's wording needs. `kira-structure.css`'s type scale already
derives from the host:

```css
--kv-t-xs: calc(var(--kv-font-size) - 2px);   /* --kv-font-size: var(--vscode-font-size, 13px) */
--kv-t-sm: calc(var(--kv-font-size) - 1px);
--kv-t-md: var(--kv-font-size);
--kv-t-lg: calc(var(--kv-font-size) + 1px);
```

Two things genuinely do not, and a third suspect turns out not to exist:

1. **The UI font family is hardcoded**, and its comment says so outright:
   ```css
   /* … --kv-font-ui is Kira Studio's own fixed system-sans stack, never user-customizable. */
   --kv-font-ui: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, …;
   ```
   A user who set a VS Code UI font gets it everywhere in their editor except this sidebar.
   `--vscode-font-family` is right there in `vscode-tokens.css:94` and is what the graph panel
   already uses.
2. **Every control height and every spacing step is a fixed pixel value** — `--kv-h-xs/sm/md/lg`
   (18/22/26/30), `--kv-icon-box` (16), `--kv-bar-h` (34), `--kv-s-1..6` (2/4/6/8/12/16). Raise VS
   Code's font size and the text grows inside controls that do not, so a 22px segmented button
   clips 17px text. This is the half of "a fixed Kira Studio scale" that is actually true.
3. **There is no stray hardcoded body-text size in the review sidebar.** Checked rather than
   assumed: `grep -rnE "font-size: *[0-9]+px" packages/git-ui/src` returns seven lines, and six of
   them are *glyph* metrics, not type — `.kv-review-row-chevron` and `.kv-file-tree-chevron` (12px,
   each paired with a matching `width: 12px`), `.kv-badge-icon` (11px), and three empty-state icons
   (`GitBlockedPanel` 32px, `NoRepositoryPanel` 32px, `EmptyRepositoryPanel` 24px). An icon's size
   is not the reader's font size and correctly does not track it. The seventh,
   `CommitGrid.vue:997`'s `.kv-badge` (10px), is real text — but it is in the **graph panel**, not
   the surface item 5 is about, and its 10px is welded to the pill's own `height: 16px` /
   `line-height: 16px`; changing one without the other breaks the badge. D7 leaves it, and says so.
   The ~85 other `font-size` declarations in `packages/git-ui` are `em`-relative or token-based.

### F10 — The review sidebar's rows are a single competing line, with no per-row actions and no comparison summary

Item 6, stated concretely so D8 is a redesign and not an adjective.

- **`ReviewCommitRow.vue:124-155`** renders one flex row holding, in order: a chevron, the full
  subject, the short sha, the author's full name and a relative date. In a ~300px sidebar the
  subject — the only part anyone scans for — is the part that truncates, because four other
  elements are competing with it on the same line.
- **There are no row actions.** Opening a commit's changes means expanding the row and then
  clicking a file; there is no way to act on the commit itself from the row.
- **The header and the toolbar are two separate strips** (`ReviewView.vue:503-585`): a header with
  a branch codicon, the branch name, the `BaseSelector` and a commit count; then a toolbar with the
  three-way pane toggle, the filter box and the Tree/Flat toggle. Nothing states the comparison
  itself as a fact ("`feature` ↔ `main`, 37 commits, 12 files").
- **File rows carry the status as a coloured glyph only** (`FileTree.vue`'s `kv-diff-*` classes),
  with no per-file +/- counts and with the directory rendered at the same weight as the filename.

For contrast, the public, documented GitLens patterns item 6 names: two-line commit rows (message
above; author · relative date · sha below), inline action icons revealed on row hover, a
"Comparing X with Y" summary node at the top of a comparison, a "N files changed" node, file rows
showing the filename with its directory as dimmed secondary text plus a status letter, and
collapsible section nodes with count badges. Those are the five shapes D8 adopts. Avatars — also a
GitLens signature — are not adopted, for the reason §0.3 gives.

### F11 — Nothing contributes to the diff editor's toolbar, and the pattern to copy is already in this manifest

Items 7 and 8. `package.json#contributes.menus` has four entries: `scm/title` (one command,
`group: "navigation"`), `comments/commentThread/context`, `comments/comment/title`, and
`commandPalette` (two `when: false` hides). There is no `editor/title` contribution.

The pieces the two new buttons need all exist:

- **The placement pattern**: `kiraVersion.focusGraph` already pairs `"icon": "$(git-branch)"` on
  its `contributes.commands` entry with `group: "navigation"` in `scm/title`. `editor/title` works
  the same way, and ordering inside the group is `navigation@<order>` — a negative order places an
  item to the **left** of VS Code's own built-in diff navigation (the next/previous-change arrows),
  which is where item 7 asks for it and where GitLens puts its own "Open File".
- **The `when` clause**: both sides of a review diff are `kira-version:` URIs
  (`ports/editorIntegration.ts`'s `SCHEME`, including the `.empty` side), so
  `isInDiffEditor && resourceScheme == kira-version` is true exactly for the diffs G12/G13 moved
  into the editor and false everywhere else.
- **Resolving *which* document**: `reviewAnchorFor(uri)` (`reviewComments.ts:33`) already returns
  `{repoId, branch, path, at}` from a review diff's own URI, statelessly, and G13 D20 explicitly
  built it as this phase's seam. For the left-hand side (which carries no fourth key field),
  `parseVirtualKey(decodeKey(segment))` gives `{repoId, rev, path}` — the same two lines
  `reviewAnchorFor` opens with.
- **The command-table machinery**: `OTHER_COMMANDS` + `otherCommandHandlers` +
  `commands.test.ts`'s two-directional manifest cross-check. A new command that is added to one and
  not the other fails that test, which is the guard already in place.

### F12 — G4's line-mapped "Go to file" already exists, in one place, wired only to the webview

Item 7's "reuse G4's existing capability" is exact: `proxyHandlers.ts`'s `editor.goToFile` handler
calls `file.goToTarget` and then, for a `live` target, maps the line through
`mapLineAcrossDiff(target.hunks, line, 'old')` before revealing the on-disk file; for a
`historical` target it reveals the `kira-version:` blob at the requested line. That is precisely
"works for historical/non-checked-out content, landing the cursor at the corresponding line".

It is reachable **only** as a webview-originated request. The new toolbar button runs in the
extension host, where there is no webview involved, so D9 lifts the body into a small function both
call — never a second implementation of the same line arithmetic, which is the thing G4 D11's own
comment warns against ("never a second, unproven Go implementation of the same trickiest math";
a second *TypeScript* one is no better).

### F13 — `ui.action` cannot name a commit

Item 8. `contract.ts:1430`: `'ui.action': { readonly action: UiActionKind }`. `UiActionKind` is a
string union of fourteen members and the payload has no other field, so the extension can tell the
graph webview *what to do* but never *to what*. The cold-start arm has the same gap: `html.ts`'s
bootstrap island carries `pendingAction: UiActionKind | null`, read by `webview/main.ts:142` and
passed to `App.vue`'s `pendingAction` prop.

Both halves are extension-side only — the Go server neither emits nor parses `ui.action` (G10 D9
established exactly this situation for that event's own introduction) — but `CONTRACT_VERSION` is
the sole compatibility authority (SPEC §3.4), so it still moves. §12.1 puts that to a human.

### F14 — Observed in passing: `stash.list` rejects on every repo open, as an unhandled page-level rejection

Not one of the eight items, recorded because probe D surfaced it on every run and the next person
to open a webview console will see it:

```
[pageerror] RpcError: gitrpc: unknown method stash.list
```

`stash.*` is G16's; the server answering `E_UNKNOWN_METHOD` is documented and correct
(`extension.ts:182-185`'s own note). What is not correct is that `StashState`'s boot call leaves an
unhandled rejection at the page level. It is one `.catch` and it belongs to whoever owns stash —
§11 hands it forward rather than growing this phase.

---

## 2. Decisions

### D1 — The four component imports become value imports, each with a `biome-ignore` that says why, and a guard test that cannot be argued with

Fixing F1 and F3, and surviving F4.

```ts
// packages/git-ui/src/App.vue
// A .vue default export is a *value* — the component object the template instantiates. `import
// type` erases it, and Vue then renders <CommitGrid> as an unknown element with no grid inside it
// (G14 F1). The script's only reference is `InstanceType<typeof …>`, so biome's useImportType
// cannot tell; the template is the real caller.
// biome-ignore lint/style/useImportType: the template instantiates this — see above
import AppToolbar from './components/AppToolbar.vue';
// biome-ignore lint/style/useImportType: the template instantiates this — see above
import CommitGrid from './components/CommitGrid.vue';
```

The same two-line treatment for `AppToolbar.vue:38`'s `RefreshButton` and `DetailPane.vue:26`'s
`FileTree`. `AppToolbar.vue`'s existing comment block ("Plain (not `import type`) imports, unlike
RefreshButton below") is corrected in the same edit — it now reads as one rule for all three of its
component imports rather than an exception carved out for two.

**`InstanceType<typeof X>` stays exactly as it is** in all four `ref<…>` declarations. It is
correct, it is precise, and a value import satisfies it — `vue-tsc` was green before and stays
green.

**The guard: `apps/kira-studio-vscode/src/vueComponentImports.test.ts`** (new), which walks
`packages/git-ui/src/**/*.vue` and fails on any line matching a **default** type-only `.vue`
import — `/^import type\s+[A-Za-z_$][\w$]*\s+from\s+['"].*\.vue['"]/m` — naming the file and line,
and explaining the failure in one sentence. Named type imports (`import type { FindBarHost } from
'…vue'`) are deliberately not matched: F3 found one and it is legitimate.

Why this file, and why a test at all — argued against `AGENTS.md`'s bar rather than around it:

- It lives in `apps/kira-studio-vscode/src` because that directory is already in `test:unit`'s
  globs and already contains the exact precedent: `commands.test.ts` reads `package.json` **and two
  Go source files** from elsewhere in the tree to cross-check a consistency invariant no type
  system can express. This is the same kind of check on the same tier.
- It clears the bar because it is the **only** mechanism that can catch this class of defect: the
  bug typechecks (F5), lints (F4), builds (F5), and is *re-introduced by the repo's own formatter*
  (F4). A guard that a formatter can undo is not a guard; this one fails loudly the moment the
  formatter wins.
- It is not a component test and does not need a mounting harness, which keeps §11's larger
  question open rather than pre-empting it with something disproportionate.

**Rejected: dropping the `typeof` reference instead** (typing the template refs as a hand-written
`{ scrollToRow(row: number): void }` interface, or `useTemplateRef`). It would make biome stop
firing — with zero script references an import is left alone, which is why `DetailPane` and the ten
dialog components were never flagged — but it trades an exact, compiler-derived instance type for a
hand-maintained shape that can drift from the component it describes. Four comment lines are
cheaper and more honest.

**Rejected: disabling `lint/style/useImportType` for `packages/git-ui`.** The rule is right
everywhere else in that package (every `import type { … } from './state/*.ts'` is correct), and
turning it off would remove a real signal to fix four lines.

### D2 — No Go change, no wire change, and no change under the data path — item 1 is exactly four imports

Stated as a decision because the temptation is real and the phase's brief invited it. F2 tested
every named suspect against a real repository and each is correct. §8.4 makes it mechanical: `git
diff --stat` must show **no** change under `internal/gitclient/**`, `internal/gitstore/**`,
`internal/gitwire/**`, `internal/gitrpc/graph.go`, `internal/gitsession/walk.go`,
`packages/git-ipc/schema/**` or `packages/git-ipc/src/generated/**`. An implementer who finds
themselves editing the paged walk has misread this plan.

### D3 — A boot failure is visible even after a repository has opened

The one honest diagnostic gap item 1 exposed, and the whole of this phase's "diagnostics" work —
deliberately small, because the bug is found (§0.3).

`App.vue:996` renders the boot-error panel as `v-if="bootError && !repoState"`. G12 D6.3 chose that
gate correctly for the failure it was fixing (an `app.init` that never resolves, so nothing else can
render). But `bootstrap()` keeps going after `repoState` is set — through `repo.open`, the
auto-open candidate loop and `openStream` — and a rejection from any of those sets `bootError` into
a panel the template will never show. The result is a rendered, chrome-complete panel with no
history and no explanation: the exact shape item 1 was reported as, whatever the cause.

So: `bootError` renders in **two** places, from one ref.

- With no `repoState`, the existing full-panel state, unchanged.
- With a `repoState`, a one-line dismissible banner above `main.kv-body` — the same anatomy
  `ReviewView.vue`'s stale-comparison banner already uses (`:622-637`) — carrying the message and
  the same Retry action.

`ReviewView.vue` needs no equivalent: its own `v-if="bootError"` is the first branch of its
template and is already unconditional.

### D4 — A pairing request is a system notification **first**, it carries Approve/Deny, and window activation becomes the accompaniment rather than the mechanism

Item 2, fixing F6. Entirely in `main.go`; no `internal/git*` file grows a Wails import and the
layering test stays green by construction.

**Order inverted, and both things still happen.** On a newly-arrived request (G12's edge latch on
`RequestID` is kept verbatim — a queue of three approvals must not produce three notifications for
the same head):

1. `notifyPairingPending(...)` — always, window or no window.
2. Then, if a window exists, `application.InvokeAsync(func(){ w.Show(); w.Restore(); w.Focus() })`,
   unchanged from G12 D8. A user who *is* looking at Kira Studio still gets the dialog in front of
   them; the notification is what covers the user who is not.

**The notification becomes a prompt.** One category, registered once, lazily, the first time a
request needs it (never at startup — the same rule G12 D8 applied to authorization, and for the
same reason):

```go
notifier.RegisterNotificationCategory(notifications.NotificationCategory{
    ID: "kira.git.pairing",
    Actions: []notifications.NotificationAction{
        {ID: "approve", Title: "Approve"},
        {ID: "deny", Title: "Deny", Destructive: true},
    },
})
```

and each request sends with actions, its own `RequestID` carried in `Data` so the response can be
routed without any state on our side:

```go
notifier.SendNotificationWithActions(notifications.NotificationOptions{
    ID:         "kira-git-pairing-" + req.RequestID,
    Title:      "Kira Studio",
    Subtitle:   req.Label,
    Body:       "wants to connect to your git backend.",
    CategoryID: "kira.git.pairing",
    Data:       map[string]any{"requestId": req.RequestID},
    InterruptionLevel: notifications.InterruptionLevelTimeSensitive,
})
```

`OnNotificationResponse` is registered once, next to the subscription, and maps the response back
onto the broker:

- `ActionIdentifier == "approve"` → `gitSock.Broker().Approve(requestID)`
- `ActionIdentifier == "deny"` → `gitSock.Broker().Deny(requestID)`
- `notifications.DefaultActionIdentifier` (the body was clicked, not a button) → `Show`/`Restore`/
  `Focus` the window so the in-app dialog can answer it. **Never an implicit approve.**

**Four properties that make this safe rather than merely convenient:**

- **The broker stays the single authority.** A stale action — the request already approved in the
  window, denied, or timed out — is a lookup miss the broker already answers with a non-`Resolved`
  `PairingAction`, logged at `Debug` and otherwise ignored. Nothing about the trust model changes:
  a notification action is a *human clicking Approve*, which is exactly what SPEC §3.3 requires and
  what the in-window dialog already is.
- **The notification is withdrawn when the request resolves elsewhere.**
  `RemoveDeliveredNotification("kira-git-pairing-" + id)` on the `snap.Pending == nil` branch (and
  when the head changes), so a resolved request cannot leave a live Approve button in Notification
  Centre. This is the one piece of bookkeeping the feature genuinely needs.
- **`InterruptionLevelTimeSensitive`, not `Critical`.** Time-sensitive is what breaks through a
  Focus mode; `Critical` additionally overrides Do Not Disturb *and mute*, needs a special Apple
  entitlement, and is for alarms. A pairing prompt is not an alarm.
- **The bundle limit is unchanged and stated, not discovered**: none of this works outside a
  packaged, signed `.app` (F6). In `bun run dev` every call fails softly and is logged at `Debug`,
  exactly as G12 D8 already established, and the window activation still happens.

**Rejected: `osascript`/`terminal-notifier`.** A subprocess (against this chapter's own spawn rules
for something that is not git), a second notification identity that is not this app, and it cannot
route an action back into the broker.

**Rejected: registering the notifier as a Wails service to get the delegate.** G12's reason still
holds exactly — `ServiceStartup` returning an error is fatal to the whole application, and this
one's fails by design outside a bundle (it made the `-tags server` binary exit 1). F6 records why
it is not needed: the darwin C entry points initialise the delegate themselves.

### D5 — The status-bar item is an icon plus a state word only when there is one, and everything else moves into a Markdown tooltip

Item 3, fixing F7. `updateStatusBar` keeps its five-state switch; what changes is what each row
puts where.

| `ConnectionState` | Text | Tooltip (Markdown, multi-line) |
|---|---|---|
| `connecting` | `$(sync~spin)` | **Kira Studio** · Connecting… · the socket path |
| `pairing` | `$(key) Approve` | **Kira Studio** · Waiting for approval in Kira Studio's window |
| `connected`, idle | `$(git-branch)` | **Kira Studio** · Connected · workspace root · server version · contract version |
| `connected`, busy | `$(sync~spin)` | **Kira Studio** · Loading… |
| `denied` | `$(error) Kira` | **Kira Studio** · Pairing was denied / timed out · what to click |
| `versionMismatch` | `$(error) Kira` | **Kira Studio** · both versions named, and that both must be on the same release |

- **The two states that need the user's attention keep a word**; the three that do not are an icon.
  That is the whole of item 3: the bar gets ~20px back in the common case and loses nothing.
- **`item.name = 'Kira Version'`** is set once, so the item is identifiable in the status bar's own
  right-click "manage" menu — which is where a user goes to find and hide an item, and is the
  honest place for a name once the text no longer carries one.
- **`item.tooltip` becomes a `vscode.MarkdownString`**, so the detail can be several labelled lines
  instead of one run-on sentence. It is built from data the extension already holds; nothing new is
  requested.
- **`item.accessibilityInformation = { label: <the tooltip's first line> }`**, because an
  icon-only item with no accessible name is a regression for a screen reader even when it is an
  improvement for the bar.
- `backgroundColor`, the per-state `command`, and the `kiraVersion.statusBar.enabled` opt-out are
  unchanged from G12 D10.

### D6 — The file tree indents on a token, defaulting to 8px

Item 4, fixing F8. `FileTree.vue`'s inline literal becomes a token reference:

```html
:style="{ paddingLeft: `calc(var(--kv-tree-indent) * ${row.depth})` }"
```

with `--kv-tree-indent: 8px` defined in `packages/git-ui/src/theme/density.css` — the file that
already owns row heights and spacing for **both** surfaces, because item 4's complaint applies to
every tree this UI renders, not only the review sidebar's. 8px is not a taste call: it is
`workbench.tree.indent`'s own default, so the tree lines up with the Explorer beside it.

**Not read from `workbench.tree.indent` itself.** It is readable
(`vscode.workspace.getConfiguration('workbench.tree').get<number>('indent')`) but it is not one of
`SETTINGS`' keys, so plumbing it would mean a new settings key, a coercion entry, a
`settings.changed` path and a manifest entry — a contract-shaped change for a number that is 8 for
essentially everyone. §12.3 records the option rather than taking it.

### D7 — The review sidebar's font family follows VS Code, and its control heights follow the host's font size

Item 5, fixing F9. Two edits, both in `kira-structure.css`, and one planned third that
inspection removed.

**(a) The UI font follows the host, with today's stack as the fallback:**

```css
/* G14 item 5: the UI font follows the user's VS Code font, exactly as colour already follows their
   theme (G12 D14). Kira Studio's own stack survives only as the fallback for a host that sets no
   --vscode-font-family. */
--kv-font-ui: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI",
  system-ui, "Ubuntu", "Droid Sans", sans-serif);
```

`--kv-font-data` is unchanged: it is already `--kv-mono-font-family`, i.e.
`--vscode-editor-font-family`, and LAW 08's data/UI split is a structural rule, not a size.

**(b) The control and bar heights derive from the host's font size, with offsets chosen so that at
the default 13px every value is byte-identical to today's:**

```css
--kv-h-xs:      calc(var(--kv-font-size) +  5px);  /* 18px at 13px */
--kv-h-sm:      calc(var(--kv-font-size) +  9px);  /* 22px */
--kv-h-md:      calc(var(--kv-font-size) + 13px);  /* 26px */
--kv-h-lg:      calc(var(--kv-font-size) + 17px);  /* 30px */
--kv-icon-box:  calc(var(--kv-font-size) +  3px);  /* 16px */
--kv-bar-h:     calc(var(--kv-font-size) + 21px);  /* 34px */
```

That "identical at 13px" property is the whole argument for the shape: it is verifiable
(§8.4 lists it), it means a default-configured user sees no visual change at all from this item,
and a user at 15px gets controls that grew with their text instead of clipping it.

**`--kv-s-1..6` stay fixed.** Spacing is rhythm, not type metrics; scaling gaps with the font size
makes a dense sidebar loose at large sizes for no legibility gain, and Kira Studio's own scale
(which these are transcribed from) is fixed for the same reason.

**(c) Nothing else.** The third change this decision originally planned — replacing "the hardcoded
`px` font sizes" — is **dropped on inspection**, because F9(3) found none in the review sidebar:
six of the seven `px` sizes are glyph metrics and the seventh is a graph-panel badge whose size is
welded to its own pill height. Rewriting them would be churn in a surface item 5 does not name, and
in one case a visual regression. Recorded rather than silently omitted, so the next reader does not
go looking for the edit this plan first assumed it needed.

### D8 — The branch review sidebar takes GitLens's row and node anatomy: six concrete changes, and a fence around them

Item 6, addressing F10. **Structure and density only** — every colour still derives from
`--vscode-*` through `vscode-tokens.css`, and G12 D14's own guarantee (`kira-structure.css`
contains no colour) is unchanged and still checked (§8.4).

| # | Surface | Today | Becomes (the GitLens pattern it follows) |
|---|---|---|---|
| **1** | Commit row (`ReviewCommitRow.vue:124-155`) | one line: chevron · subject · sha · author · date | **two lines**: line 1 chevron + subject (full width, one-line ellipsis); line 2, at `--kv-t-xs` and muted, `author · relative date · shortSha` (the sha keeps `--kv-font-data` and its copy action). GitLens's commit-node anatomy |
| **2** | Commit row, on hover/focus | nothing | **inline icon actions**, right-aligned, revealed on `:hover`/`:focus-within` and always present for the focused row: *Open all changes* (`codicon-diff-multiple`), *Copy SHA* (`codicon-copy`), *Open in graph* (`codicon-git-commit`, D10's command routed through the existing `openInGraph` webview action). GitLens's row-action pattern |
| **3** | View head (`ReviewView.vue:503-518`) | branch codicon · branch name · `BaseSelector` · a count span shown only on the Commits pane | a **comparison summary node**: `<branch> ↔ <base>` on the first line (both `--kv-font-data`), and on the second a muted `N commits · M files changed`, always shown, with `BaseSelector` still the interactive element on the base. GitLens's "Comparing X with Y" node |
| **4** | Pane toggle (`:520-560`) | three icon buttons | the same three, each carrying a **count badge** (`Commits 37`, `Files 12`, `Comments 3`) at `--kv-t-xs`. GitLens's count-badged section nodes |
| **5** | File rows (`FileTree.vue`) | status colour on the path, no counts | a **status letter** (`A`/`M`/`D`/`R`/`C`) in a fixed `--kv-icon-box` cell, keeping today's `kv-diff-*` colour; the **filename at full contrast and its directory dimmed** after it; the file's `+N −M` at the row's right when `review.files` has it. GitLens's file-node anatomy |
| **6** | Row rhythm | `--kv-space-*`, 16px indent | `--kv-s-*` on Kira's rhythm and D6's `--kv-tree-indent`; commit rows get the two-line height, file rows stay one line at `--kv-control-h` |

**Row 5 is scoped to the review sidebar's own instances**, not to `FileTree` globally: the status
cell and the dimmed-directory treatment land behind the existing per-instance props the review view
already passes (`ReviewCommitRow.vue:159`, `ReviewFilesPane.vue`), so the graph's detail pane —
which gets its `FileTree` back for the first time under D1 — keeps today's appearance. §0.3's "no
graph restyle" holds by construction rather than by discipline.

**What this deliberately does not do**, and why (each of these is a real GitLens feature this plan
declines rather than forgets):

- **No avatars.** No avatar source, no network budget in a webview whose CSP grants none, and no
  cache. §0.3.
- **No new data.** Every field above is already on the wire: `review.files` carries per-file status
  and counts, the commit store carries author/date/sha, `review.resolution` carries the base.
  **No RPC changes, no `review.*` change, and no `CONTRACT_VERSION` movement from this item.**
- **No new panes, no re-architecture.** `ReviewPane` stays `commits | files | comments`; the state
  modules are untouched. This is a template-and-CSS change plus one new hover-actions row.
- **No graph-panel restyle**, per §0.3.

§12.2 puts the scope of this item to a human before it starts, since "modelled on GitLens" is the
one instruction in this phase that could absorb an unbounded amount of work.

### D9 — `kiraVersion.goToFileFromDiff`, contributed to `editor/title` left of the change-navigation arrows, over G4's existing mapping

Item 7, using F11 and F12.

**Manifest** — two entries, both following patterns already in this file:

```jsonc
// contributes.commands
{ "command": "kiraVersion.goToFileFromDiff", "title": "Go to File",
  "category": "Kira Version", "icon": "$(go-to-file)" }

// contributes.menus."editor/title"
{ "command": "kiraVersion.goToFileFromDiff", "group": "navigation@-99",
  "when": "isInDiffEditor && resourceScheme == kira-version" }
```

`navigation@-99` is what puts it **left of** VS Code's built-in next/previous-change buttons (which
sit in the same group at default order), matching GitLens's own placement for its "Open File"
button, which is what item 7 asks for.

**Handler**, in a new `apps/kira-studio-vscode/src/diffToolbar.ts` (both commands live there; it is
the only new file this phase adds):

1. Resolve the diff being acted on from
   `vscode.window.tabGroups.activeTabGroup.activeTab?.input`. When that is a
   `vscode.TabInputTextDiff`, its `original`/`modified` URIs are exactly the two sides — read from
   the tab rather than from `activeTextEditor`, because a diff editor's "active editor" is whichever
   pane has focus and may be neither when the click comes from the toolbar.
2. Choose the side: the focused one when `vscode.window.activeTextEditor.document.uri` matches one
   of the two, otherwise `modified`. Its URI's first path segment decodes through
   `decodeKey` + `parseVirtualKey` to `{repoId, rev, path}` (`reviewAnchorFor`'s own two opening
   lines, and it is reused for the branch-tip side).
3. The line is `activeTextEditor.selection.active.line + 1` when that editor is the chosen side,
   else `1`.
4. Call **the same function `proxyHandlers`' `editor.goToFile` calls**: the body of that handler
   moves verbatim into an exported `goToFile(deps, {repoId, rev, path, line})` in this new file, and
   the proxy handler becomes a one-line call to it. One implementation of the `file.goToTarget` +
   `mapLineAcrossDiff` composition, two callers (F12).
5. `.empty` side, an unparseable key, or a `file.goToTarget` that answers `unavailable`: a
   `vscode.window.showInformationMessage` naming why — the same "explains itself rather than doing
   nothing" posture G13 D19 set for `addReviewComment`.

Registered from `commands.ts`'s `OTHER_COMMANDS` like every other command (F11), so
`commands.test.ts`'s two-directional cross-check covers it for free.

**This works for the historical side by construction**: `file.goToTarget` already answers `live`
(with drift hunks, mapped) or `historical` (a `kira-version:` blob revealed at the line), which is
exactly item 7's "working for non-checked-out/historical file content too".

### D10 — `kiraVersion.openCommitInGraph`, and `ui.action` grows an optional target: `CONTRACT_VERSION` 20 → 21

Item 8, using F11 and F13. Same file, same menu, one order to the right:

```jsonc
{ "command": "kiraVersion.openCommitInGraph", "title": "Open Commit in Graph",
  "category": "Kira Version", "icon": "$(git-commit)" }
{ "command": "kiraVersion.openCommitInGraph", "group": "navigation@-98",
  "when": "isInDiffEditor && resourceScheme == kira-version" }
```

**The contract change, in full** (`packages/git-ipc/src/contract.ts`):

```ts
| 'revealCommit'   // G14 D10: added to UiActionKind

'ui.action': {
  readonly action: UiActionKind;
  /** G14 D10: present only for actions that name a commit ('revealCommit'). Extension -> webview
   *  only; the Go server neither emits nor parses ui.action. */
  readonly target?: { readonly repoId: string; readonly sha: string };
};
```

`CONTRACT_VERSION` 20 → 21 in the three hand-maintained places (`gitrpc/contract.go`,
`packages/git-ipc/src/validate.ts`, `tests/e2e-real/git-pairing-real.spec.ts:93`), with the same
"what moved and why" comment every previous bump carries.

**The two arms, mirroring the ones `runUiAction` already has** (`panelView.ts`'s live/cold split):

- **Live** — `graphProvider.runUiAction('revealCommit', {repoId, sha})`. `runUiAction`'s signature
  gains an optional target it forwards into `emit('ui.action', …)` and stashes alongside
  `#pendingAction`.
- **Cold** — the bootstrap island gains the same optional target
  (`html.ts`'s `pendingAction` becomes `pendingUiAction: { action, target? } | null`,
  `webview/main.ts`'s `Bootstrap` and `App.vue`'s prop follow). This is the extension's own
  document, not the wire, so it is a rename rather than a contract change.

**What the webview does with it** (`App.vue`'s `runUiAction`): on `revealCommit`, if
`target.repoId` differs from the open repository, open it first (the same `repo.open` +
`handleRepoOpened` path the picker uses); then `graphView.revealSha(target.sha, signal)` — which
already exists, already pages until the sha appears, already announces progress through the live
region, and already returns `'found' | 'notFound' | 'cancelled'` — and on `'found'` sets the
selection, which the existing selection watch scrolls to. A `'notFound'` is announced by
`revealSha` itself; nothing new is invented.

**Rejected: encoding the sha into the `UiActionKind` string** (`'revealCommit:<sha>'`). It avoids
the bump by making a typed union a stringly-typed one, and every consumer of `UiActionKind` would
have to learn to parse it. A payload field is what a payload is for.

**Rejected: a new request the webview makes to ask "what should I reveal?"**. Also a contract
change, plus a round trip and a race with the panel's own boot.

### D11 — What gets a test, and what does not

`AGENTS.md`'s bar, per item.

| Item | Test | Why |
|---|---|---|
| **1** | `apps/kira-studio-vscode/src/vueComponentImports.test.ts` (new, D1) | **The only mechanism that can catch it**: the defect typechecks, lints, builds, and is re-applied by `bun run format`. Precedent in the same directory: `commands.test.ts` cross-checks a manifest against Go source on the same tier. Must fail on the pre-fix tree — verify by re-adding one `import type` before committing |
| **7, 8** | `commands.test.ts`'s existing cross-checks pick up both new commands automatically | Not a new test — the table-vs-manifest check is total in both directions, so a command in one and not the other already fails |
| **2** | none | A Wails/macOS notification path this container cannot exercise; a test would assert that a fake was called (G12 D17's own reasoning for D8) |
| **3** | none | A switch over five states writing strings onto a `StatusBarItem` |
| **4, 5** | none | One template binding and six `calc()`s. §8.4's "identical at 13px" is a `grep`, and it is a better guard than a test would be |
| **6** | none | Template and CSS. `vue-tsc` is the existing guard; `packages/git-ui` has no mounting harness, and building one for a restyle is disproportionate (§11 keeps the question open) |

---

## 3. The Go side, file by file

Two files. Neither is in `internal/git*`'s data path, and one of them only moves a constant.

### 3.1 `apps/kira-studio/main.go` — edited (D4)

The pairing subscription is reordered (notify first, then focus), `notifyPairingPending` grows the
category registration, `SendNotificationWithActions` with `Data`/`Subtitle`/`InterruptionLevel`,
and the withdraw-on-resolve call; a single `notifier.OnNotificationResponse(...)` registration is
added beside the subscription and routes `approve`/`deny`/default onto
`gitSock.Broker().Approve`/`Deny`/window activation. `notificationsDenied`'s once-per-session
behaviour and the lazy authorization request are unchanged.

### 3.2 `apps/kira-studio/internal/gitrpc/contract.go` — edited (D10)

`ContractVersion` 20 → 21, with the same shape of comment G10 D9 / G12 D1 / G13 D1 left: what moved
(one new `UiActionKind` member and `ui.action`'s optional `target`), and that the Go server neither
emits nor parses the event — the constant moves because it is the sole compatibility authority.

**No other Go file changes.** §8.4 checks it.

---

## 4. The TypeScript side, file by file

### 4.1 `packages/git-ui/src/App.vue` — edited (D1, D3, D10)

Two value imports with their `biome-ignore` lines; the `bootError` banner rendered inside the
`repoState` branch as well as outside it; `runUiAction`'s `revealCommit` case and the
`pendingUiAction` prop rename.

### 4.2 `packages/git-ui/src/components/AppToolbar.vue` — edited (D1)

`RefreshButton` becomes a value import; the file's existing comment about "unlike RefreshButton
below" is corrected to cover all three component imports.

### 4.3 `packages/git-ui/src/components/DetailPane.vue` — edited (D1)

`FileTree` becomes a value import. **The graph's detail pane gains a file tree it has never had**
(F3) — worth calling out in the commit message, because it will look like a new feature in a
screenshot.

### 4.4 `apps/kira-studio-vscode/src/vueComponentImports.test.ts` — new (D1, D11)

The guard described in D1: walk `packages/git-ui/src/**/*.vue`, fail on a default type-only `.vue`
import, name the file and line, and say in one sentence why it is a bug.

### 4.5 `packages/git-ui/src/theme/kira-structure.css` — edited (D7)

`--kv-font-ui` follows `--vscode-font-family`; the six height tokens become `calc()` offsets from
`--kv-font-size`. **Still no colour anywhere in the file** — G12 D14's guarantee is unchanged and
§8.4 still checks it.

### 4.6 `packages/git-ui/src/theme/density.css` — edited (D6)

One new token: `--kv-tree-indent: 8px`, beside the row heights it belongs with.

### 4.7 `packages/git-ui/src/components/FileTree.vue` — edited (D6, D8)

The indent binding moves onto the token; the review-scoped row anatomy (status letter cell, dimmed
directory, `+N −M`) lands behind the existing per-instance props, leaving `DetailPane`'s instance
untouched.

### 4.8 `packages/git-ui/src/components/review/ReviewCommitRow.vue` — edited (D8)

The two-line row and the hover/focus action group. Its `font-size: 12px` is the chevron *glyph*
(paired with `width: 12px`) and stays — F9(3).

### 4.9 `packages/git-ui/src/components/review/ReviewView.vue` — edited (D8)

The comparison summary node replacing the header strip, and the three count badges on the pane
toggle.

### 4.10 `packages/git-ipc/src/contract.ts` and `validate.ts` — edited (D10)

`UiActionKind`'s `'revealCommit'`, `ui.action`'s optional `target`, and `CONTRACT_VERSION` 20 → 21
with the file's own comment convention.

### 4.11 `apps/kira-studio-vscode/src/diffToolbar.ts` — new (D9, D10)

The two commands' handlers, the tab/side/line resolution, and the extracted
`goToFile(deps, params)` both this file and `proxyHandlers.ts` call.

### 4.12 `apps/kira-studio-vscode/src/proxyHandlers.ts` — edited (D9)

`editor.goToFile`'s body moves into §4.11's shared function; the handler becomes a call to it.
Nothing else in this file changes.

### 4.13 `apps/kira-studio-vscode/src/commands.ts` — edited (D9, D10)

Two `OTHER_COMMANDS` entries.

### 4.14 `apps/kira-studio-vscode/src/extension.ts` — edited (D5, D9, D10)

`updateStatusBar`'s new text/tooltip/name/accessibility shape, and two `otherCommandHandlers`
entries routing into §4.11.

### 4.15 `apps/kira-studio-vscode/src/panelView.ts` — edited (D10)

`runUiAction(action, target?)`, forwarded into `emit('ui.action', …)` and stashed with
`#pendingAction` for the cold arm.

### 4.16 `apps/kira-studio-vscode/src/html.ts` + `src/webview/main.ts` — edited (D10)

The bootstrap island's `pendingAction` becomes `pendingUiAction: { action, target? } | null`, read
through to `App.vue`'s prop.

### 4.17 `apps/kira-studio-vscode/package.json` — edited (D9, D10)

Two `contributes.commands` entries with icons, and a new `contributes.menus."editor/title"` array
with both `when`-scoped entries.

### 4.18 `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts` — edited (D10)

Its hand-mirrored `CONTRACT_VERSION` 20 → 21.

---

## 5. The Wails frontend

**No change.** D4 is entirely `main.go`; `GitPairingDialog.vue`, `state/gitClients.ts` and the
*Connected editors* tab are all untouched, and the in-window dialog remains the authoritative
approval surface a notification action merely reaches.

---

## 6. Dependencies and tooling

**None added.** Every mechanism is already present:

- `pkg/services/notifications`' category/action/response API — `wails/v3` beta.16, already in
  `go.mod` (D4).
- `vscode.MarkdownString`, `StatusBarItem.name`/`accessibilityInformation`,
  `window.tabGroups`/`TabInputTextDiff`, `contributes.menus."editor/title"` — `@types/vscode`
  1.134.0, already pinned (D5, D9).
- `@vscode/codicons` — already a devDependency and already bundled (D8's row actions,
  `$(go-to-file)`/`$(git-commit)`).
- `bun test` for D11's guard — the tier already exists.

---

## 7. Implementation order

Nine commits. **C1 must land first**: until the grid actually mounts, none of items 3–8 can be
looked at in a real window, and item 6's redesign cannot be judged at all.

| # | Commit | Covers |
|---|---|---|
| **C1** | `fix(git-ui): the commit graph's grid, toolbar and file tree are actually instantiated` | D1 + its guard test (§4.1–§4.4) |
| **C2** | `fix(git-ui): a boot failure after the repository opens is visible` | D3 (§4.1) |
| **C3** | `feat: a pairing request is a system notification with Approve and Deny` | D4 (§3.1) |
| **C4** | `fix(vscode): the status-bar item stops spending the bar on its own name` | D5 (§4.15) |
| **C5** | `fix(git-ui): tree indentation follows the workbench's own 8px step` | D6 (§4.6, §4.7) |
| **C6** | `fix(git-ui): the review sidebar's font and control heights follow VS Code` | D7 (§4.5) |
| **C7** | `feat(git-ui): a GitLens-shaped branch review sidebar` | D8 (§4.7–§4.9) |
| **C8** | `feat(vscode): Go to file from the review diff's toolbar` | D9 (§4.11–§4.14, §4.17) |
| **C9** | `feat(ipc)!: Open in graph from the diff toolbar — CONTRACT_VERSION 21` | D10 (§3.2, §4.1, §4.10, §4.11, §4.14–§4.18) |

C8 before C9 because C8 creates `diffToolbar.ts` and the menu contribution C9 extends, and because
C8 needs no contract change — keeping the bump isolated to one commit that can be reverted on its
own.

---

## 8. Exit criteria, and exactly how each is proven

### 8.1 Tier 1 — fully provable in this container

1. `go build ./apps/kira-studio/...` (including `main.go`, which D4 touches) and `go vet` clean.
2. `go test -race -count=1` over SPEC's scoped git list (`gitclient`, `gitclient/porcelain`,
   `gitclient/catfile`, `gitclient/logsession`, `gitpreflight`, `gitops`, `gitsession`, `gitrpc`,
   `gitsock`, `gitstore`, `gitwire`, `gitreview`, `gitaskpass`, `bridge`, `bridge/rpcstream`,
   `internal` for the layering test) — green, and **unchanged**: this phase adds no Go test.
3. `bun run typecheck` (all five projects) green.
4. `bun run lint` green.
5. `bun run test:unit` green, **including D11's new guard, which must fail on the pre-fix tree** —
   verify by re-adding one `import type` and watching it fail before committing.
6. **`bun run format` is run and changes nothing in the four files D1 touched.** This is the
   property F4 says is otherwise silently lost, and it is one command.
7. `bun run build:vscode` produces both bundles and passes its own checks;
   `bun run package:vscode` + `scripts/verify-packaging.sh` green.
8. **Item 1, end to end, in a real browser.** Rebuild the harness (probe D, §0.1) and re-run it
   against a real repository. It is ~150 lines in three pieces, none of which re-implements
   anything: (a) a Go test in `internal/gitsock` that starts a real `newIntegrationServer`,
   auto-approves pairing from the broker, and shells out to the other two; (b) a Bun script that
   dials the socket with the real `createSocketChannel`/`createRpcClient`, builds the real
   `createProxyHandlers`, serves `apps/kira-studio-vscode/dist/ui` over HTTP with a document
   modelled on `html.ts` whose `acquireVsCodeApi` shim relays `postMessage` frames over a
   WebSocket into a real `createRpcServer`, and logs every frame; (c) a node script using
   `@playwright/test`'s `chromium` that loads the page and reports
   `document.querySelectorAll('.slick-row').length`, the grid's `aria-rowcount`, and any
   `pageerror`. **Pass condition: `aria-rowcount` equals the repository's commit count and
   `.kv-toolbar` is in the DOM.** Delete the harness afterwards, or keep it — §11.
9. `apps/kira-studio/tests/e2e-real/git-pairing-real.spec.ts` green with `CONTRACT_VERSION` 21.

### 8.2 Tier 2 — provable here as a type/lint/grep check plus a reasoned argument

- **D5 (status bar).** Provable: the state table typechecks against `ConnectionState`'s five
  members and `vscode.StatusBarItem`'s API. Not provable: how much narrower the item actually
  renders.
- **D6 (indent).** Provable: `vue-tsc`, and that no `* 16` literal survives in `FileTree.vue`.
  Not provable: how it looks beside the Explorer.
- **D7 (font/heights).** Provable, and mechanically: `kira-structure.css` still contains **no
  colour**; and **every `calc()` in (b) evaluates to today's literal at `--kv-font-size: 13px`** —
  six arithmetic checks anyone can do by reading, listed in §8.4.
- **D8 (review redesign).** Provable: `vue-tsc`; that `vscode-tokens.css` and `density.css`'s
  colour tokens are untouched; that no `review.*` request or contract type changed. Not provable:
  whether it reads as GitLens.

### 8.3 Tier 3 — needs a human on a Mac, with VS Code and Kira Studio both running

In order, because several steps depend on the one before:

1. Install the freshly built `.vsix`. Open a folder that is a git repository.
2. **Item 1:** the graph panel lists commits, with lanes, a toolbar, a repo picker and a branch
   name — the thing that has never happened. Scroll; press Load more; Alt-click it. Then open a
   commit and confirm its detail pane now shows a **file tree** (F3's second casualty).
3. **Item 2:** revoke the editor in *Connected editors* so the next connect re-pairs. With Kira
   Studio **not** frontmost, confirm a system notification appears carrying Approve and Deny;
   click Approve and confirm the extension connects with no window interaction. Repeat and click
   Deny. Repeat once more, approve in Kira Studio's own window instead, and confirm the
   notification is **withdrawn** rather than left clickable. All of this in a **packaged, signed**
   build — D4's stated limit means none of it works from `bun run dev`.
4. **Item 3:** confirm the status-bar item is icon-only when connected and idle, that hovering
   shows the Markdown detail, and that quitting Kira Studio switches it to a visible error state.
5. **Item 4:** a deep path in the review sidebar's file tree lines up with the Explorer's own
   indentation.
6. **Item 5:** set `editor.fontFamily`/the workbench font and font size to something distinctive;
   confirm the review sidebar follows both, and that at the default size nothing moved.
7. **Item 6:** the review sidebar reads as GitLens — two-line commit rows, hover actions, the
   comparison summary, count badges, file rows with status letters and counts. Then switch to a
   **light** and a **high-contrast** theme and confirm it recolours and stays legible. Confirm the
   **graph** panel is unchanged.
8. **Items 7 + 8:** open a file from the review sidebar's Files pane. Confirm two buttons appear in
   the diff editor's toolbar, **to the left of** the next/previous-change arrows. Put the cursor on
   a line deep in the file and click *Go to file*: the working-tree file opens at the corresponding
   line even when it has drifted since that revision. Then click *Open in graph*: the graph view
   reveals and selects that commit, paging to it if needed.

### 8.4 The checklist

- [ ] No `import type` default import from a `.vue` file anywhere under `packages/git-ui/src` —
      `grep -rnE "^import type [A-Za-z_$][\w$]* from '.*\.vue'" packages/git-ui/src` finds nothing.
- [ ] Each of the four fixed imports carries a `biome-ignore lint/style/useImportType` with a real
      reason, and **`bun run format` leaves all four unchanged.**
- [ ] D11's guard test fails on the pre-fix tree and passes after.
- [ ] `git diff --stat` shows **no** change under `internal/gitclient/**`, `internal/gitstore/**`,
      `internal/gitwire/**`, `internal/gitrpc/graph.go`, `internal/gitsession/walk.go`,
      `packages/git-ipc/schema/**` or `packages/git-ipc/src/generated/**` (D2 — F2 proved them
      healthy).
- [ ] No `internal/git*` file imports `internal/bridge` or `wails`; the layering test is green.
- [ ] `CONTRACT_VERSION` is **21** in all three hand-maintained places and nowhere is it 20.
- [ ] `packages/git-ui/src/theme/kira-structure.css` still contains **no colour**:
      `grep -nE "#[0-9a-fA-F]{3,8}|rgb\(|oklch\(|(^|[^-])(color|background|border-color):"` finds
      nothing.
- [ ] At `--kv-font-size: 13px`, D7(b)'s six `calc()`s evaluate to 18/22/26/30/16/34 px — the
      values they replace.
- [ ] `grep -rnE "font-size: *[0-9]+px" packages/git-ui/src` returns **the same seven lines it
      returns today** — D7(c) changes none of them, and a new one would be a regression.
- [ ] `FileTree.vue` contains no `* 16` indent literal.
- [ ] Both new commands appear in `commands.ts`'s `OTHER_COMMANDS` **and**
      `package.json#contributes.commands`; `commands.test.ts` is green.
- [ ] Both `editor/title` entries carry `when: "isInDiffEditor && resourceScheme == kira-version"`.
- [ ] No new dependency in `package.json` or `go.mod`.

---

## 9. Sequencing

**One implementer, sequentially.** C1 gates everything: every other item in this phase is judged in
a window that, until C1 lands, renders no commits and no toolbar at all.

The one defensible cut, if a second agent is genuinely wanted: **C3 (D4, `main.go` + the Wails
notification)** touches no file any other commit touches, needs no webview, and depends on nothing
in C1–C2. It can run alongside C4–C9. Everything else is order-dependent (C8 before C9; C5/C6
before C7, which restyles the rows they retune).

---

## 10. Explicit non-goals for G14

| Not this phase | Why | Where |
|---|---|---|
| Any change to the git data path | F2 proved every layer correct against a real repository | §8.4's checklist |
| Range/hunk-level "mark reviewed" | Its own phase; G13 D20's "G14" is today's **G15** | G15 |
| Restyling the graph panel | Item 6 says "the branch review UI" | D8's per-instance scoping |
| Avatars in the review sidebar | No avatar source, no network, no cache | D8 |
| Reading `workbench.tree.indent` from VS Code | A settings-contract change for a number that is 8 for everyone | §12.3 |
| A general webview logging/diagnostics layer | Item 1 is root-caused; D3 closes the one real gap | §0.3 |
| `stash.list`'s unhandled rejection | Real, observed (F14), and G16's | §11 |
| A mounted-component test harness for `packages/git-ui` | Probe D shows it is buildable and useful; building it as a permanent tier is its own decision | §11 |
| Editing `docs/v1.3/SPEC.md` | A chapter spec is not retro-edited by a phase | — |

---

## 11. Handed forward

- **Probe D is the mounted-component harness G12 §11 asked for**, and it now has a proven use: it
  found the defect twelve phases of typechecking, linting and building could not. It is ~150 lines,
  needs no VS Code, and reuses only real modules. Whether it becomes a committed tier (a
  `tests/webview/` beside `tests/ui/`, run on demand rather than per-commit) is a real decision with
  a real cost — a Playwright browser download and a build dependency — and belongs to whichever
  phase first needs to *assert* rendered behaviour rather than merely compile it. §8.1 step 8
  records the recipe either way, so it is rebuildable in an hour.
- **`stash.list` rejects unhandled on every repo open** (F14). One `.catch` in `StashState`'s boot
  path, and G16's to own alongside the rest of stash.
- **`rpc.ts`'s chunk queue turns a throwing `onChunk` into a silent stall** (F2(e)): the promise
  chain rejects, no credit is posted, later chunks are skipped, and the stream never settles. Not
  this bug, and not a hypothetical either — worth a deliberate decision (reject the stream, or
  surface the error) by whoever next touches `packages/git-ipc/src/rpc.ts`.
- **`--kv-mono-font-size` is defined and unused** (`vscode-tokens.css:97`). Left alone here; a
  candidate for deletion whenever someone is in that file for a real reason.
- **The graph's detail pane gains a file tree it has never had** (F3/D1). Nobody has ever used it,
  so it has never been reviewed against a real repository — worth a look in the same session as
  §8.3 step 2 rather than assumed correct because it compiles.

---

## 12. Three calls that want a human eye

### 12.1 `CONTRACT_VERSION` 20 → 21, for one optional field on an extension-only event (D10)

**The call:** item 8 needs to tell the graph webview *which commit* to reveal, and `ui.action`'s
payload has no room for one (F13). This plan adds an optional `target` and one `UiActionKind`
member, and bumps the contract because `CONTRACT_VERSION` is the sole compatibility authority
(SPEC §3.4).

**Why it is flagged rather than just done:** a bump makes every already-installed `.vsix` refuse to
talk to a newer Kira Studio and vice versa, and this is the **third consecutive phase** to bump
(G12 18→19, G13 19→20, now 20→21). The precedent is exact and established — G10 D9's `ui.action`
itself never crosses the socket and bumped anyway — but three releases in a row that force a paired
upgrade is a pattern worth someone deciding about rather than inheriting.

**The alternative, and why this plan declines it:** ship item 7 (Go to file, no contract change) and
defer item 8 to whenever the contract next moves for a better reason. That leaves half of a two-
button toolbar, and the second button is the one that makes the first one's context obvious.

### 12.2 How much of GitLens is in scope for item 6 (D8)

**The call:** "modelled on GitLens" is the one instruction in this phase with no natural boundary.
D8 fixes the boundary at six changes — two-line commit rows, hover row actions, a comparison
summary node, count badges, file-row anatomy, and the tighter rhythm — all of them template and CSS
over data already on the wire, with no new RPC, no new pane and no state change.

**What is deliberately outside it, and each could reasonably be argued back in:** avatars (no
source, no network); a graph column in the review list (that is the graph panel's job, and the
review walk draws no lanes by design — G6/D41); an inline file-diff preview on hover; and a
GitLens-style "Compare with…" picker beyond the existing `BaseSelector`.

**The risk of getting this wrong in either direction is real**: too little and the item is unmet;
too much and a defect batch has grown a redesign it cannot verify in this container (§8.2 is honest
that "does it read as GitLens" is a human's judgment). A human should confirm the six-change fence
before C7 starts.

### 12.3 Item 3's "too narrow", and item 4's 8px (D5, D6)

**Recorded rather than answered**, because both are small and both are taste.

- SPEC's item 3 says the status-bar item is "too narrow". Read against the code, the item is not
  narrow — it renders a constant twelve-character name in every state — so this plan takes the
  actionable reading: it *crowds a narrow bar*, and D5 shrinks it to an icon plus a state word only
  when there is one. If the complaint was the opposite (the item is truncated by other extensions
  and needs to be wider or repositioned), D5 is the wrong fix and the right one is
  `StatusBarAlignment`/priority, not text.
- D6 hardcodes 8px rather than reading `workbench.tree.indent`. That is right for essentially every
  user and wrong for the one who changed it. Plumbing the real setting is a new `SETTINGS` key and
  its whole coercion/`settings.changed` path — a contract-shaped change for a number — and this
  plan declines it. Worth a nod, not a debate.
