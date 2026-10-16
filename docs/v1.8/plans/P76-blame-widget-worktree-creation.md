# P76 — Git-blame status-bar widget and right-click worktree creation

`docs/v1.8/SPEC.md`'s P76 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `0aedfd1a`, P71-P75 landed); line numbers are from
that tree. `blameAnnotation.ts` was re-read **after** P75 rewrote its reveal path, not from
pre-P75 context.

Two unrelated halves, as SPEC says. **Part A — the blame status-bar widget** (desktop only).
**Part B — "Create worktree" on a row context menu** (both hosts, one `packages/git-ui` change).

Two findings shape Part A, and neither is what the row's wording implies:

- **No server-side work exists to do.** `blame.line` has shipped since v1.4 P5
  (`contract.ts:1723`, Go at `internal/gitclient/porcelain/blame.go`), and the desktop already
  resolves it per cursor line with debounce, abort and caching (`blameAnnotation.ts`). This phase
  adds a second *renderer* over an existing data path, not a data path.
- **That data path is currently wrong on one class of tab**, and the new widget would inherit the
  defect. §2 states it with evidence and fixes it first.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Is there a blame data source, or is this new server-side work? | **It exists.** `blame.line` (v1.4 P5) — one line at a time, always against the working tree. Go, contract, transport and a desktop consumer all already shipped. No Go change, no contract change, no version bump | §1 |
| Is the status bar shared with the VS Code extension? | **No.** The extension has had this exact widget since P5 (`blameWidget.ts` + `extension.ts:451`-`478`), including a reveal-in-graph tooltip link. P76 is the Kira Studio half of a feature the other host already has | §0.1, §1.2 |
| Is there an existing "current cursor line" signal to subscribe to? | **Yes — Monaco's own `onDidChangeCursorPosition`**, already used twice in this view (`RepoFileView.vue:283` for `revealLine` persistence, `blameAnnotation.ts:191` for blame). Nothing is hand-rolled and no library is added | §3 |
| Debounce/cache for a hot cursor signal | **Already written, and correct** — 150 ms debounce, per-line dedupe, `AbortController` per request, per-mount cache, `repo.changed` invalidation (`blameAnnotation.ts:87`-`204`). It is extracted so both surfaces share one lifecycle, never duplicated | §4 |
| How does `workbench/StatusBar.vue` get data owned by `views/repo/` | A `state/` store with an owner token — the same direction `cacheStats.ts`/`appMetrics.ts` already publish in. `workbench/` never imports `views/` or `repo/git/` | §5 |
| Does the widget get a "jump to commit" affordance | **Yes, reusing P75's `graph.revealCommit` verbatim** — the editor's own context-menu action already calls it (`blameAnnotation.ts:219`-`222`) and the extension's widget already offers the same link. One `transport.request`; no new request, no new host handler | §6 |
| What "`WorktreeList.vue`'s existing create machinery" actually is | SPEC's phrasing is loose. `WorktreeList.vue:37`/`:121` only **emits** `create-worktree`; the machinery is `WorktreeDialog.vue` + `OpsState.runWorktreeAdd` + `preflight.worktreeAdd`, owned by `App.vue:641`/`:1737`. Reuse = open that dialog, pre-seeded | §7 |
| Which rows get "Create worktree here…" | Local branch, remote-tracking branch, commit. Not tags, file rows or stash rows (§10 gives each reason) | §8 |
| Contract version | **Unchanged.** Neither half touches the wire | §11 |
| New unit test | **One, earned:** the extracted blame-line controller (cancellation ordering + a cache-invalidation rule that has already produced two real bugs). Part B earns none | §12 |

### 0.1 Which host each item is about

| Item | Kira Studio | VS Code extension |
|---|---|---|
| §2 Revision-pinned tabs must not show blame | **yes — the broken host** | no: `blameWidget.ts:97` already ignores any document whose scheme is not `file:` |
| §3-§6 Status-bar blame widget | **yes — the whole half** | no: it has had one since P5, untouched here |
| §8 "Create worktree here…" on a ref badge / commit row | yes | yes (same `git-ui` components, same dialog) |
| §9 `WorktreeDialog.vue`'s seed | yes | yes (same component) |

---

# Part A — the blame status-bar widget

## 1. What already exists

### 1.1 The data path, end to end

`blame.line` (`contract.ts:1717`-`1731`): `{repoId, path, line}` →
`{sha, author, authorTimeSeconds, summary}`. Its own doc comment records two constraints this
phase must respect rather than work around:

- "the status bar's one-line-at-a-time query — **never a whole-file blame (no such request
  exists)**";
- "**always blames the working tree**, never a historical revision (no `atSha` param)".

`sha` is the all-zero sentinel for a line not in any commit yet.

The desktop consumer is `blameAnnotation.ts` (P62 §4): `attachBlameAnnotation(mod, editor, deps)`
paints injected text at the cursor line's last column, `<author>, <age> · <subject>`. It holds the
whole request lifecycle:

| Concern | Where | Note |
|---|---|---|
| Cursor trigger | `:191` | `editor.onDidChangeCursorPosition` |
| Line dedupe (not column) | `:175` | the `line === lastLine` early return precedes `cancelPending` — bug 5a's fix, and load-bearing |
| Debounce | `:24`, `:185`-`188` | 150 ms |
| Cancellation | `:128`-`135`, `:147` | one `AbortController` per request |
| Cache | `:97`, `:155`, `:163` | per mount; a cached `null` is a resolved miss, an **aborted** request is not — bug 5b's fix |
| Invalidation | `:196`-`204` | `repo.changed` for this repo clears the cache and re-triggers |
| Repo hold | `:139` | `ensureRepoOpen` (`state/repoOpenHold.ts`) — `blame.line` needs the connection to hold the repo |
| Reveal | `:209`-`224` | an editor action calling P75's `graph.revealCommit` |

Everything in that table is exactly what a status-bar widget needs. None of it is rewritten.

### 1.2 The other host already shipped this widget

`extension.ts:451` creates the status-bar item; `:467`-`478` drives it from
`createBlameWidgetController`; `updateStatusBar` (`:231`-`281`) renders four states and, for a
resolved one, a tooltip command link carrying `{repoId, sha}` to `kiraVersion.openCommitInGraph`.
`blameState.ts` is its pure half (`selectBlameDisplayState`, `blameStatusText`).

Two things follow. First, Part A is a Kira Studio addition only — SPEC's own wording ("in
`StatusBar.vue`") is right, and there is nothing to share: the extension's controller is
`vscode`-facing and lives in a different bundle, which is precisely why `blameAnnotation.ts:8`-`10`
already says it re-derives that shape rather than importing it. Second, the four-state model and
the reveal-on-click affordance are not invented here; they are what the other host ships.

### 1.3 The status bar today

`StatusBar.vue` is two `.side` groups. Left: one `caret-status` span reading `no selection`, with
a comment (`:72`-`74`) stating it answers "where is the caret" and is "not yet wired per-view".
Right: update, `app-metrics`, `cache-size`, `engine-status` — each a `.p-status` with a
`CodiconIcon`, a value and a `v-tooltip`; `.update` is a `<button>` because it is activated
(`:144`-`152`), the others are spans.

The blame item is a caret-scoped fact with no other home in this app, so it belongs in the **left**
group, as a sibling after `caret-status` — matching the extension's own `StatusBarAlignment.Left`.
It does **not** take over the `caret-status` slot: wiring a real line/column readout is a separate,
unwired item this phase must not silently claim (§10).

## 2. The defect Part A would otherwise inherit

`RepoFileView.vue:237`-`250`:

```ts
function syncBlameAnnotation(): void {
  if (settingsState.appearance.inlineBlame && gitRepoId) {
    if (!blameHandle) {
      blameHandle = attachBlameAnnotation(mod, editor, { …, path: props.tab.path });
```

The guard reads the setting and whether this window has a git record. It does **not** read
`props.tab.state.rev`. P74 §7.3 added revision-pinned `repo-file` tabs: when `rev !== null`, the
model is loaded through `file.read` at that revision (`:146`-`170`), not from the worktree — but
`blame.line` "always blames the working tree" (§1.1). So on a revision-pinned tab every annotation
is an answer about a **different file's** line numbering: line 40 of `HEAD~20:src/a.ts` is
annotated with whoever last touched line 40 of today's `src/a.ts`. The two coincide only when the
file has not changed since.

This is a real defect in the current tree, introduced by P74 and not caught there because
`repo-workspace.spec.ts` opens only live-file tabs. It is in scope here for one reason: the
status-bar widget is a second consumer of the same resolution, and building it over a wrong data
path would double the wrong answer instead of fixing it.

**Fix:** the blame layer attaches only for a live tab. `rev` is already captured at `:136` and is
`readonly` for the life of the mount, so this is one added condition, not a new watch:

```ts
// `blame.line` always blames the working tree (contract.ts:1718) — a revision-pinned tab shows
// different bytes, so its line numbers do not correspond.
const blameable = gitRepoId !== undefined && rev === null;
```

Not a new setting, not a "historical blame" feature: a rev-pinned tab shows no blame at all, in
either surface. Adding `atSha` to the wire is out of scope (§10).

## 3. Data flow

```
Monaco cursor move (onDidChangeCursorPosition)
  └─ blameLine.ts controller: dedupe on line → 150 ms debounce → ensureRepoOpen → blame.line
       │   (per-mount cache; AbortController per request; repo.changed clears both)
       ├─ state: ShallowRef<BlameLineState>
       │    ├─ blameAnnotation.ts  → injected text + hover on that line   (gated on `inlineBlame`)
       │    └─ RepoFileView.vue    → publishBlameStatus(token, …)
       │                               └─ state/blameStatus.ts (reactive)
       │                                    └─ StatusBar.vue renders; click → reveal callback
       └─ dispose on unmount → releaseBlameStatus(token)
```

One request per resolved line, shared by both renderers — never one per renderer. The debounce,
dedupe and cache all sit upstream of the split, so the status bar costs nothing beyond what the
inline annotation already costs today, and costs it even when the annotation is off (§5.3).

## 4. `blameLine.ts` — the controller, extracted

New file `apps/kira-studio/frontend/src/views/repo/blameLine.ts`, holding §1.1's whole table plus
the two text formatters. `blameAnnotation.ts` keeps only the Monaco decoration, the hover and the
editor action. This is the same split the extension already runs
(`blameWidget.ts`/`blameState.ts`), and the same one `reviewMarking.ts`/`reviewRanges.ts` and
`goToFile.ts` establish elsewhere in that bundle.

```ts
export type BlameLineState =
  | { readonly kind: 'none' }
  | { readonly kind: 'uncommitted'; readonly line: number }
  | {
      readonly kind: 'resolved';
      readonly line: number;
      readonly sha: string;
      readonly author: string;
      readonly authorTimeSeconds: number;
      readonly summary: string;
    };

/** Everything the controller needs off a Monaco editor — narrowed so a test can satisfy it
 *  without an editor (and without importing monaco-editor at all). */
type BlameCursorSource = Pick<CodeEditor, 'getPosition' | 'onDidChangeCursorPosition'>;

export interface BlameLineControllerDeps {
  readonly transport: Transport;
  readonly gitRepoId: string;
  /** Repo-relative, the same string `codeWorkspaceReadFile` reads. */
  readonly path: string;
  readonly cursor: BlameCursorSource;
}

export interface BlameLineController {
  readonly state: ShallowRef<BlameLineState>;
  dispose(): void;
}

export function createBlameLineController(deps: BlameLineControllerDeps): BlameLineController;
```

Moved in verbatim, with their existing comments (each records a fixed bug or a constraint):
`DEBOUNCE_MS`, `UNCOMMITTED_BLAME_SHA`, `cancelPending`, `resolveLine`, `refresh`, the cursor
subscription, the `repo.changed` subscription and the cache. `paint(result)` is replaced by
`state.value = …`; the `'uncommitted'` branch moves from render time (`annotationText:62`) to
resolution time, matching `selectBlameDisplayState`'s own shape in the other host.

Also moved, and **exported**, so both surfaces read identically:

```ts
/** `<author>, <age> · <subject>` — today's inline annotation text, verbatim. */
export function blameLineText(state: Extract<BlameLineState, {kind: 'resolved'}>): string;
/** Two lines: the clamped subject, then `<author>, <absolute date>`. */
export function blameLineTooltip(state: Extract<BlameLineState, {kind: 'resolved'}>): string[];
```

`clampSubject` (`:56`-`59`) moves with them and stays private.

**Transport ownership inverts, deliberately.** `blameAnnotation.ts:236`-`241` (comment 7d) says
that module is what leases `deps.transport` and therefore the only place that can release it. With
two consumers plus §6's reveal callback, that is no longer true: `RepoFileView.vue` leases once,
hands the same transport to the controller, and disposes it on unmount. The controller disposes
what it created (timers, subscriptions, the in-flight abort) and never a lease it did not take.
Comment 7d moves to `RepoFileView.vue` with its reason updated.

`attachBlameAnnotation` keeps its signature but takes the controller instead of the transport:

```ts
export function attachBlameAnnotation(
  mod: MonacoModule,
  editor: CodeEditor,
  controller: BlameLineController,
): BlameAnnotationHandle;
```

Its body becomes a `watch(controller.state, paint)` plus today's `paint`/`hoverMessage`/
`revealAction`, with `paint` reading `state.line` instead of the module-local `lastLine`. The
editor action stays here: it is the inline surface's own affordance, and the status bar has its own
(§6).

## 5. The store and the status-bar item

### 5.1 `state/blameStatus.ts`

New file, in `state/` for the reason `state/tabs.ts:68`-`70` already gives — cross-view state read
by the workbench, written by a view, with neither importing the other.

```ts
export const blameStatusState = reactive({
  status: { kind: 'none' } as BlameLineState,
  /** Set by whoever currently owns the readout; `StatusBar.vue` calls it with the shown sha. */
  reveal: null as ((sha: string) => void) | null,
});

let owner: symbol | undefined;

export function claimBlameStatus(reveal: (sha: string) => void): symbol { … }
export function publishBlameStatus(token: symbol, status: BlameLineState): void { … }
export function releaseBlameStatus(token: symbol): void { … }
```

`publish`/`release` both no-op unless `token === owner`. That token is not defensive dressing:
`MainView.vue:30`-`32` keys the active view by tab id and keeps only `RepoGraphView` alive (P72
§3), so switching between two file tabs mounts the incoming view around the outgoing one's
teardown. Without the token, the departing tab's `release` could blank a readout the arriving tab
had already published. One owner at a time, last claim wins.

`reveal` is a plain function held in `reactive` — Vue proxies plain objects and arrays, not
functions, so it is stored as-is with no `markRaw`.

Rejected: letting `StatusBar.vue` call `graph.revealCommit` itself. That would make `workbench/`
import `repo/git/transport.ts` and `hostHandlers.ts` to re-derive a `gitRepoId` the publishing view
already holds — a new import direction bought for nothing.

### 5.2 `StatusBar.vue`

One item in the left `.side`, after `caret-status`:

```vue
<button
  v-if="blame"
  class="p-status blame"
  data-testid="blame-status"
  :disabled="!blameStatusState.reveal"
  v-tooltip="blameTooltip"
  @click="onRevealBlameCommit"
>
  <CodiconIcon name="git-commit" :size="13" />
  <span class="blame-text">{{ blameText }}</span>
</button>
```

- `blame` is a computed narrowing `blameStatusState.status` to `'resolved'`; `'none'` and
  `'uncommitted'` both render nothing. An "Uncommitted" readout is the extension's choice for an
  item that is always present; this bar hides items with nothing to say (`app-metrics`,
  `cache-size` both do), so absent is the consistent answer here.
- `blameText` is `blameLineText(blame)`, `blameTooltip` is `blameLineTooltip(blame).join(' — ')`.
  Both imported from `views/repo/blameLine.ts`, so the two surfaces can never drift.
- `<button>` follows `.update`'s precedent (`:144`-`152`) for the same reason: it is activated, so
  keyboard focus and Enter/Space come free. Its UA chrome reset is that rule's, reused.
- `.blame-text` gets `max-width: 48ch; overflow: hidden; text-overflow: ellipsis; white-space:
  nowrap` — a long subject truncates in place; the full text is in the tooltip. `clampSubject`'s
  own 120-character clamp still applies upstream.

### 5.3 `RepoFileView.vue`

```ts
// One lease for this mount, shared by the controller and the reveal callback (comment 7d, moved).
const transport = gitTransportFor(workspaceCodeRepoId);
const controller = createBlameLineController({ transport, gitRepoId, path: props.tab.path,
                                               cursor: editor });
blameToken = claimBlameStatus((sha) => {
  void transport.request('graph.revealCommit', { repoId: gitRepoId, sha });
});
stopBlamePublish = watch(controller.state, (s) => publishBlameStatus(blameToken, s), {
  immediate: true,
});
```

all inside the `blameable` branch (§2). `syncBlameAnnotation` keeps its existing shape and watch,
but now attaches/detaches only the **renderer**:

```ts
function syncBlameAnnotation(): void {
  if (settingsState.appearance.inlineBlame) {
    blameHandle ??= attachBlameAnnotation(mod, editor, controller);
  } else {
    blameHandle?.dispose();
    blameHandle = null;
  }
}
```

`onUnmounted` gains `releaseBlameStatus(blameToken)`, `stopBlamePublish()`, `controller.dispose()`
and `transport.dispose()`, beside the existing `blameHandle?.dispose()`.

**One deliberate behaviour change, stated rather than buried:** with `inlineBlame` off, this view
now still resolves `blame.line` per cursor line, to feed the status bar. That is correct against
the setting's own scope — its label is "Inline blame … at the end of that line, in the repository
file viewer" (`SettingsDialog.vue:775`-`779`), and `settings.ts:36` calls it "inline git-blame
annotation at the end of the cursor's line". It governs the annotation, not blame. No second
setting is added (§10).

## 6. Reveal on click

`onRevealBlameCommit` calls `blameStatusState.reveal?.(blame.sha)`, which is §5.3's closure, which
is one `graph.revealCommit` request — P75 §2.3's contract method, already answered by both hosts,
already called from this exact file for this exact purpose (`blameAnnotation.ts:219`-`222`).
Nothing new crosses the wire and no handler is added.

The uncommitted sentinel never reaches here: `'uncommitted'` is its own state and renders nothing.

---

# Part B — "Create worktree" from a row menu

## 7. What the create machinery is

SPEC says to reuse "`WorktreeList.vue`'s existing create machinery already used from
`BranchPicker.vue`". Read literally that machinery does not live there:

- `WorktreeList.vue:37`/`:118`-`124` — a button that emits `create-worktree`, nothing else.
- `BranchPicker.vue:105`/`:520` — re-emits `createWorktree`.
- `AppToolbar.vue:99`/`:304` — re-emits again.
- `App.vue:641` owns `worktreeCreateOpen`; `:1478`/`:1516` set it from the toolbar, `:902` from the
  palette's `createWorktree` action; `:1737`-`1746` mounts `WorktreeDialog.vue`.
- `WorktreeDialog.vue` is the machinery: three modes (`existingBranch`/`newBranch`/`detach`), live
  `preflight.worktreeAdd` on every keystroke (`:109`-`122`), `ops.runWorktreeAdd` (`:138`-`153`),
  the `detachHere` route (`:168`-`184`) and the prepare-script phase.

So "reuse it" means: open that dialog, pre-seeded from the row. No second dialog, no direct
`runWorktreeAdd` call from a menu handler — a menu item that skipped the preflight would be exactly
the second creation path SPEC forbids.

## 8. The menu items

`rowMenuModel.ts` gains one item in two existing builders:

```ts
plainItem('createWorktreeHere', 'Create worktree here…', 'codicon-multiple-windows')
```

- **`buildRefMenu` (`:184`)** — appended to the `branch` items (`:233`-`237`) and the
  `remoteBranch` items (`:223`-`231`). Not to the `tag` branch (§10).
- **`buildRowMenu` (`:63`)** — appended to `mutating` (`:64`-`97`), after `createTagHere`, where
  the other two "create something at this commit" items already sit.

`plainItem`, not `gatedItem`: `worktreeAdd` is not in `GATED_OP_KINDS`
(`git-core/src/model/operation.ts:405`-`413`), so `canRunOp` returns `true` for it
unconditionally — a `gatedItem` call would be a gate that never gates, and `WorktreeList.vue`'s own
create button is already un-gated for the same reason. Creating a worktree during a merge or rebase
is legitimate; it touches neither the sequencer state nor the current worktree.

Write-capability gating comes free: `commitMenuSections` (`App.vue:499`-`511`) and
`refMenuSections` (`:722`-`737`, `BranchPicker.vue:210`) fall back to `buildReadOnlyRowMenu`/
`buildReadOnlyRefMenu` when `capabilities.write` is false, and neither read-only builder changes.
Both hosts report `write: true` today (`hostHandlers.ts:213` for the desktop, P67e), so the item
appears in both.

## 9. The seed, and the three call sites

### 9.1 The seed type

In `packages/git-ui/src/state/worktrees.ts`, beside `WorktreeState` — worktree-domain state shared
by the dialog and every caller, and a type a `<script setup>` SFC cannot export:

```ts
/** What a "Create worktree here…" row action pre-fills `WorktreeDialog.vue`'s create phase with.
 *  Every field optional: the toolbar/palette entry point opens with `{}` and keeps today's
 *  defaults. */
export interface WorktreeCreateSeed {
  readonly mode?: 'existingBranch' | 'newBranch' | 'detach';
  readonly branch?: string;
  readonly startPoint?: string;
}
```

| Row | Seed | Why |
|---|---|---|
| Local branch | `{mode: 'existingBranch', branch: shortName}` | `existingBranch` passes the branch as the explicit commit-ish (`gitops/worktree.go:11`-`13`) |
| Remote-tracking branch | `{mode: 'newBranch', branch: localNameForRemoteBranch(shortName), startPoint: shortName}` | `existingBranch` needs a branch that exists locally; the local tracking name may not yet. Same derivation `remoteCheckoutTarget` already uses for checkout (`refListModel.ts:123`, `:146`-`150`) |
| Commit | `{mode: 'detach', startPoint: sha}` | A commit is a point, not a line of development — the dialog's own third mode, exactly |

The path field pre-fills itself: `WorktreeDialog.vue:94`-`101` already derives a path suggestion
from `branch`/`startPoint` under `kiraVersion.worktree.basePath` whenever the path is still empty,
and seeding those refs makes that watch fire. No path logic is added anywhere.

### 9.2 `WorktreeDialog.vue`

`createOpen: boolean` becomes `createRequest: WorktreeCreateSeed | undefined` (`:37`-`39`);
`phase` (`:58`-`62`) tests `props.createRequest !== undefined`; the reset watch (`:78`-`89`) keys
off `createRequest` and applies the seed where it currently hard-codes defaults:

```ts
watch(
  () => props.createRequest,
  (seed) => {
    if (!seed) return;
    path.value = '';
    mode.value = seed.mode ?? 'newBranch';
    branch.value = seed.branch ?? '';
    startPoint.value =
      seed.startPoint ??
      (props.refs.head.value?.kind === 'branch' ? props.refs.head.value.name : '');
    preflight.value = undefined;
    worktreeCreated.value = undefined;
  },
);
```

Watching an object reference rather than a boolean also makes a second "Create worktree here…" on a
different row re-seed correctly, where a boolean already-true would not have re-fired. Everything
below the create phase — preflight, submit, `detachHere`, the whole prepare phase — is untouched.

### 9.3 The callers

- **`App.vue`**: `worktreeCreateOpen = ref(false)` becomes
  `worktreeCreateRequest = ref<WorktreeCreateSeed | undefined>(undefined)`, the same "App.vue owns
  the state, the dialog owns nothing of its own" shape `stackDialogTarget` (`:646`-`648`) already
  uses. `:902`, `:1478`, `:1516` set `{}`; `:1741` binds `:create-request`; `:1745`'s
  `@close-create` sets `undefined`.
- **`onCommitMenuSelect` (`:514`)**: a `'createWorktreeHere'` case setting
  `{mode: 'detach', startPoint: commit.sha}`, beside `createBranchHere`/`createTagHere`.
- **`onRefMenuSelect` (`:738`)**: the branch/remoteBranch seeds above, from `state.kind`/
  `state.name`.
- **`BranchPicker.vue`**: `onRefMenuSelect` (`:235`) gains the same case, emitting through the
  existing chain; `(e: 'createWorktree')` (`:105`) widens to
  `(e: 'createWorktree', seed?: WorktreeCreateSeed)`, and `AppToolbar.vue:99`/`:304` and
  `WorktreeList.vue:37`/`:121` forward it unchanged in shape (the list's own button passes
  nothing, which is `{}` at the top). One intent, one path, three hops — no second route added.

The picker panel stays open behind the dialog, exactly as it already does for
`openSetStackParentDialog` and for `WorktreeList.vue`'s own create button. Not a new behaviour and
not changed here.

## 10. Deliberately out of scope

- **Wiring `caret-status`.** Its "not yet wired per-view" comment (`StatusBar.vue:72`-`74`) stays
  true; §5.2 adds a sibling item and never claims that slot.
- **A whole-file or gutter blame view.** `blame.line`'s own doc comment: no such request exists.
- **Historical blame (`atSha`).** §2 makes a revision-pinned tab show *nothing*, which is honest.
  Adding a revision parameter is a wire change with a Go implementation behind it.
- **Blame in `RepoDiffView.vue` or a review diff.** Same reason as §2: neither side of a diff is
  the working tree.
- **A setting for the status-bar widget.** SPEC asks for the widget, not a preference; §5.3 states
  why `inlineBlame` does not govern it.
- **Changing the VS Code extension's blame widget.** It works; P76 touches neither
  `blameWidget.ts` nor `blameState.ts`.
- **"Create worktree" on tag, file-tree or stash rows.** A tag is a point, and its own commit row
  in the graph already offers the detached item; a file row's menu is
  `buildFileRowMenu`'s two read actions; a stash is not a start point `worktree add` accepts.
- **`force` creation, or worktree removal/switching from a row menu.** `force` is refused by
  design (`contract.ts:989`-`992`); removal and switching already have row actions in
  `WorktreeList.vue`.
- **The `repo-workspace.spec.ts` git mock's missing `graph.stream`/`commit.detail` streaming.**
  P74 and P75 both recorded it; §12 extends that mock only with two plain request/response
  literals, and opt-in at that.

## 11. Files

Added:

| File | Contents |
|---|---|
| `apps/kira-studio/frontend/src/views/repo/blameLine.ts` | The controller extracted from `blameAnnotation.ts`, plus `blameLineText`/`blameLineTooltip` (§4) |
| `apps/kira-studio/frontend/src/state/blameStatus.ts` | The owner-token store (§5.1) |
| `apps/kira-studio/tests/unit/blame-line-controller.spec.ts` | §12's one earned unit test |

Modified:

| File | Change |
|---|---|
| `apps/kira-studio/frontend/src/views/repo/blameAnnotation.ts` | Keeps the decoration, hover and reveal action; takes a controller instead of a transport (§4) |
| `apps/kira-studio/frontend/src/views/repo/RepoFileView.vue` | The `rev === null` guard (§2); one transport lease; claims/publishes/releases the store; `syncBlameAnnotation` toggles only the renderer (§5.3) |
| `apps/kira-studio/frontend/src/workbench/StatusBar.vue` | The blame item, its click handler and its styles (§5.2) |
| `packages/git-ui/src/components/rowMenuModel.ts` | `createWorktreeHere` in `buildRefMenu`'s branch and remoteBranch arms and in `buildRowMenu` (§8) |
| `packages/git-ui/src/state/worktrees.ts` | `WorktreeCreateSeed` (§9.1) |
| `packages/git-ui/src/components/dialogs/WorktreeDialog.vue` | `createOpen` → `createRequest`; the seeded reset watch (§9.2) |
| `packages/git-ui/src/App.vue` | `worktreeCreateRequest`; the two menu cases; the dialog binding (§9.3) |
| `packages/git-ui/src/components/BranchPicker.vue` | The menu case; the widened `createWorktree` emit (§9.3) |
| `packages/git-ui/src/components/AppToolbar.vue`, `WorktreeList.vue` | Forward the seed (§9.3) |
| `packages/git-ui/src/components/rowMenuModel.test.ts` | §12's assertions |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts`, `tests/ui/support/gitStreamMock.ts` | §12's assertions and the opt-in mock results |

Deleted: none. No new dependency: Monaco's cursor API, `@kira/git-core`'s date formatters, the
codicon set and `KuiDialog` are all already here. **No contract change and no `CONTRACT_VERSION`
bump** — no Go file is touched, so none of the four stale-artifact classes P74/P75 recorded apply.

## 12. Tests

### 12.1 One new unit test, earned

`CLAUDE.md`'s default is none, and Part B gets none. §4's controller is the exception, measured
against the bar rather than waved past it — it lands in two of the categories the bar names by
name:

- **Cancellation and ordering.** `refresh`'s `line === lastLine` early return must precede
  `cancelPending`. The file's own comment at `:169`-`174` records what happens when it does not:
  a same-line cursor move cancelled the request already in flight for that line, and nothing
  restarted it, so that line never resolved at all.
- **Cache invalidation with interacting rules.** A cached `null` means "resolved miss, do not
  retry"; an aborted request must **not** be cached (`:157`-`163`). Getting that wrong made fast
  arrowing accumulate permanently blame-less lines. `repo.changed` clearing both the cache and
  `lastLine` is a third rule interacting with the first two.

Both defects were found and fixed by review, not by a test, and the logic moves to a new file in
this phase — the exact case for guarding it. `BlameCursorSource` (§4) is narrow enough that the
test drives a plain fake cursor and a fake `Transport`, with no Monaco import.

`apps/kira-studio/tests/unit/blame-line-controller.spec.ts`, one topic per file like its
neighbours:

| Case | Asserts |
|---|---|
| A same-line cursor move while a request is in flight | one `blame.line` call, still resolving to that line's result |
| A later line supersedes an earlier one | the earlier line's late response never becomes `state` |
| An aborted request | not cached — revisiting the line issues a new request |
| A genuine RPC failure | cached as a miss — revisiting the line issues none, and `state` is `'none'` |
| `repo.changed` for this repo / another repo | clears and re-resolves / does nothing |
| The all-zero sha | `state.kind === 'uncommitted'`, never `'resolved'` |

### 12.2 Existing suites extended, no other new file

| Spec | Assertion |
|---|---|
| `packages/git-ui/src/components/rowMenuModel.test.ts` | `createWorktreeHere` present and enabled in `buildRefMenu` for `branch` and `remoteBranch` **with an operation in progress** (proving it is un-gated, §8), absent for `tag`, present in `buildRowMenu`, and absent from `buildReadOnlyRefMenu`/`buildReadOnlyRowMenu` |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` (`:383`, the existing blame test) | With no git record, `[data-testid="blame-status"]` has count 0 — the same honest-guard claim that test already makes for `.kira-blame-inline` |
| same file, one new test | With the git mock answering `repo.open`/`blame.line`: opening `a.ts` and moving the cursor renders `blame-status` with the author and subject; the item is absent again on a revision-pinned tab (§2) |

`gitStreamMock.ts` gains an **optional third parameter** merged into `resultByMethod`
(`:81`-`108`), so only the new test sees `repo.open`/`blame.line`. Adding them globally would let
every other spec's `bootstrap()` proceed past a point where it currently hangs — a behaviour change
in `repo-graph-lifecycle.spec.ts` bought for nothing. Existing callers are unchanged.

### 12.3 Checks

Fast, per commit: `bun run typecheck`, `bun run lint`, `bun run build`, and `bun run build:vscode`
for every commit that touches `packages/git-ui/` (Part B's does). `bun run test:unit` for §12.1's
file. Once, near the end: `bun run test:ui` and `bun run test:webview`. No Go is touched, so
`go build`/`go vet`/`go test` are unaffected — run once to confirm that, not per commit.

No GUI is available in this sandbox (the constraint P74 §5.1 and P75 §8 both recorded), so the
Playwright UI tier is the verification surface for Part A; §12.2's new test is what makes the
status-bar item's live behaviour provable there rather than by mechanism alone.

## 13. Order and sizing

### 13.1 Commits

1. **§2 — the revision-pinned guard.** One condition in `RepoFileView.vue`, before anything moves.
   → `fix(repo): never blame a revision-pinned file tab against the worktree`
2. **§4 — the controller extraction.** Pure refactor: `blameLine.ts` plus `blameAnnotation.ts`
   reduced to its renderer. No behaviour change, and the inline annotation must still look
   identical after it.
   → `refactor(repo): split the blame line controller out of the inline annotation`
3. **§5, §6 — the widget.** Store, `StatusBar.vue`, `RepoFileView.vue`'s publish/release and the
   reveal callback, in one commit: a store with no reader, or a readout with no publisher, is a
   half-applied path.
   → `feat(workbench): show the cursor line's git blame in the status bar`
4. **§8, §9 — Part B.** `rowMenuModel.ts`, the seed type, the dialog, and all three call sites in
   one commit, for the same reason: `createRequest` replaces `createOpen`, so the prop and every
   binding move together or the tree does not typecheck.
   → `feat(git-ui): create a worktree from a branch or commit row menu`
5. **§12's assertions**, once the behaviour they describe is in.
   → `test: cover the blame line controller and the create-worktree row items`

### 13.2 One pass, one seam

One Sonnet pass. **The seam is between step 3 and step 4** — Part A is desktop-only
(`apps/kira-studio/frontend/`), Part B is `packages/git-ui/` only, and they share no file. Steps 1
through 3 are strictly ordered: step 2 moves the code step 1 guards, and step 3 consumes what step
2 exposes. Step 4 may land before all of them if convenient, but never split inside it (§13.1's
reason).

Size: roughly 13 source files, no Go, no contract. The load-bearing decisions are three — the
controller extraction (one request feeding two renderers, §4), the owner-token store that keeps
`workbench/` from importing `views/` (§5.1), and seeding the existing dialog rather than adding a
creation path (§7). Everything else is local.

## 14. Dogfooding note

The repo-map MCP server's tools were not reachable for this planning pass, the same constraint P75
§10 recorded: this is a subagent session, and `CLAUDE.md`'s own step-3 caveat applies — the tool
manifest is fixed at session start. Navigation was done with Grep/Glob/Read.

**Nothing new is logged in `docs/v1.8/mcp-repo-map-issues.md`.** This pass never called the server,
so it produced no evidence about it; inventing an entry would be the manufactured finding
`CLAUDE.md` warns against.
