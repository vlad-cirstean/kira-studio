# G15 — Range/hunk-level review marking inside VS Code's native diff editor

> **What this phase is.** The fifteenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> first one in it whose whole job is to *restore* something a previous phase knowingly gave up. G11
> shipped partial, range-level "mark reviewed" inside the webview's own `DiffView`; G12 D12 moved
> every review diff into VS Code's native diff editor and kept whole-file marking only, recording
> the loss as an **accepted interim gap** (G12 §11.1, §12.2) so that this phase could rebuild it
> against the real editor surface. SPEC's G15 row is that phase.
>
> **In one line: the server side is already finished, and the model SPEC names cannot be copied.**
> `review.mark`'s `ranges` parameter is on the wire and served (`contract.ts:1091-1100`,
> `wire.go:311-319`, `incremental.go:112`); `review.fileDiff` already returns `reviewedRanges`
> projected into branch-tip coordinates alongside git's own `DiffHunk[]` (`contract.ts:1068-1084`).
> Exactly one client-side call site is missing. But **VS Code's built-in Git extension's
> hunk-staging gutter UI — the "stage this hunk" buttons SPEC points at — is proposed-API on both
> halves**, and a sideloaded `.vsix` on stable VS Code can enable neither. That is verified below
> from VS Code's own source, not asserted.
>
> **One correction to SPEC's own G15 wording, on evidence — the same way G12 and G14 corrected
> their own rows.** SPEC says "modeled on VS Code's own built-in Git extension's hunk-staging gutter
> UI … gutter decorations and/or per-hunk CodeLens actions". The *affordance* is reproducible and is
> reproduced here. The *mechanism* is not available: the gutter buttons come from the menu ids
> `diffEditor/gutter/hunk` and `diffEditor/gutter/selection`, both declared
> `proposed: 'contribDiffEditorGutterToolBarMenus'`, and the hunks they act on come from
> `TextEditor.diffInformation`, declared in `vscode.proposed.textEditorDiffInformation.d.ts`. The
> built-in Git extension enables both proposals in its own manifest; we cannot. F2/F3 prove it,
> D1 states the substitution, and §11.1 flags the one taste call it leaves behind.
>
> **Second correction, smaller.** SPEC says this phase "touches `apps/kira-studio-vscode/src` only".
> Two commands cannot exist without `apps/kira-studio-vscode/package.json` entries — and
> `commands.test.ts` *fails the build* if a command exists in one and not the other. G14's own
> items 7/8 crossed the same line for the same reason. The fence that matters, and that this phase
> keeps in full, is: **no Go change, no `packages/git-ipc` contract change, no `CONTRACT_VERSION`
> bump, no `review.db` migration.** §0.3 says so as a checklist item.
>
> **One fence this phase proposes to cross, and does not cross silently:** a 4-line
> `packages/git-ui/src/components/review/ReviewView.vue` change (D9), because keeping the review
> sidebar's file list honest after an *editor-side* mark needs either that or a `CONTRACT_VERSION`
> bump, and there is no third option. D9 picks the smaller of the two and §11.2 hands the call to a
> human with the zero-change fallback spelled out.
>
> **Tiering is named honestly, per G9/G10/G12/G14's precedent.** The range algebra, the
> selection→`LineRange` mapping, the hunk→change-block derivation and the command/manifest
> cross-check are fully provable here and run in `bun run test:unit`. Type/lint/build are provable
> here. **Everything that is actually a pixel — whether a gutter icon collides with VS Code's own
> diff indicators, whether the hover's command links fire, whether CodeLens shows up at all — needs
> a human on a Mac with real VS Code and a running Kira Studio.** §7 says which is which and never
> claims more.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`1d447ed9`, the whole
of G1–G14 plus concurrent v1.2 work from other agents). Every claim below was checked against source
read in this container, or a command **run in it**. G11's and G12's plans are records of intent and
are verified against the code they produced rather than trusted.

**The v1.2 work that landed mid-authoring changes nothing here, and that was checked rather than
assumed:** `git diff --stat a8080ed1..1d447ed9` over `apps/kira-studio-vscode`, `packages/git-*`,
`internal/gitrpc`, `internal/gitreview`, `internal/gitsession` and `docs/v1.3` is **empty** — every
line number and finding below was taken at `a8080ed1` and re-confirmed to still hold. Only the
`test:unit` count moved (740 → 759), because that sweep also covers `packages/api-core` and
`apps/kira-studio/tests/unit`, which the v1.2 commits did touch.

| Claim | Evidence |
|---|---|
| G14 landed in full; G15 is the tip's next phase | `git log --oneline`: `8d0d0444` (G14 implementation); no v1.3 path has changed since |
| `bun run typecheck:git` is green on the tree as it stands | run here, exit 0, no output |
| `bun run test:unit` is green: **759 pass, 0 fail, 84 files, 3.04s** | run here, at `1d447ed9` |
| `bun run lint` is green (`biome check .` over 771 files + `check-tokens.sh`) | run here |
| `bun run build:vscode` produces both bundles and passes its own checks | run here: "both bundles produced, bundle checks passed" |
| `review.mark` accepts `ranges?: readonly LineRange[]` on the wire | `packages/git-ipc/src/contract.ts:1091-1100` |
| …and the Go side reads and applies it | `internal/gitrpc/wire.go:311-319` (`Ranges []gitreview.LineRange`), `internal/gitrpc/incremental.go:112` (`entry.MarkFile(ctx, …, p.Ranges)`) |
| `review.fileDiff` returns `reviewedRanges` **and** `body.hunks` **and** `lineCount` **and** `reviewedAtSha` | `contract.ts:1068-1084` |
| `LineRange` is 1-based inclusive, **always branch-tip (new-side) line numbers on the wire** | `contract.ts:802-808` |
| `DiffHunk` carries `newStart`/`newLines` plus per-line `newLine`/`kind` | `contract.ts:120-128`, `:110-118` |
| The only client-side `review.mark` call site passes no ranges | `packages/git-ui/src/components/review/ReviewFilesPane.vue:74-78` (`mark(path, !isReviewed)`) |
| `ReviewFilesState.mark` still *accepts and forwards* ranges | `packages/git-ui/src/state/reviewFiles.ts:223-240` |
| The extension already resolves a review diff's `(repoId, branch, path, branchTip)` from its URI, statelessly | `apps/kira-studio-vscode/src/reviewComments.ts:33-40` (`reviewAnchorFor`) |
| …and either side of any `kira-version:` diff to `(repoId, rev, path)` | `apps/kira-studio-vscode/src/diffToolbar.ts:50-59` (`resolveVirtualUri`) |
| The right-hand document of a review diff is literally `<branchTip>:<path>` | `proxyHandlers.ts:236-243` → `virtualKey(repoId, branchTip, path, branch)` |
| The `.empty` side of an added/deleted file is a distinct, non-key segment | `ports/editorIntegration.ts:33-36` (`EMPTY_SEGMENT = '.empty'`) |
| `editor.openRangeDiff`'s params carry **no** `base` and **no** `mode` | `contract.ts` (`repoId, branch, branchTip, leftRev, leftLabel, path, originalPath, status`) |
| Any `contract.ts` change bumps `CONTRACT_VERSION` in this repo, even for an extension-answered request | G12 §12.1 (18→19 for `editor.openRangeDiff`), G14 D10 (20→21 for `ui.action`'s target) |
| `CONTRACT_VERSION` is **21** and stays 21 | `internal/gitrpc/contract.go`, `packages/git-ipc/src/validate.ts:19` |
| `test:unit` already runs `apps/kira-studio-vscode/src` under plain `bun test` — no extension host | root `package.json#scripts.test:unit` |
| `commands.test.ts` cross-checks `commands.ts` against `package.json#contributes.commands` **in both directions** | `commands.test.ts:146-176` |
| `resources/**` is **not** in `.vscodeignore`, so a new SVG ships in the `.vsix` automatically | `apps/kira-studio-vscode/.vscodeignore` |
| `@types/vscode` pinned at **1.134.0**, `engines.vscode: ^1.134.0` | `apps/kira-studio-vscode/package.json` |

**VS Code's own source, fetched and read here** (this is the phase's central investigation, §1 F2–F5):

| Claim | Evidence |
|---|---|
| `diffEditor/gutter/hunk` and `diffEditor/gutter/selection` are real menu ids | `src/vs/workbench/services/actions/common/menusExtensionPoint.ts:463-474` |
| …and **both** carry `proposed: 'contribDiffEditorGutterToolBarMenus'` | same lines |
| A non-enabled extension contributing one gets an error naming `--enable-proposed-api` and "only available when running out of dev" | same file, `:1086` |
| The built-in Git extension enables that proposal, plus `textEditorDiffInformation` | `extensions/git/package.json#enabledApiProposals` |
| `git.diff.stageHunk` / `git.diff.stageSelection` are what it contributes to those two menus | `extensions/git/package.json#contributes.menus` |
| The diff-changes API (`TextEditorDiffInformation`, `TextEditorChange`, `TextEditor.diffInformation`, `onDidChangeTextEditorDiffInformation`) is proposed | `src/vscode-dts/vscode.proposed.textEditorDiffInformation.d.ts` |
| Stable `@types/vscode@1.134.0` contains **zero** occurrences of `registerDiffInformationCommand`, `LineChange`, `DiffInformation` or `lineChanges` | `grep` run here over `node_modules/@types/vscode/index.d.ts` |
| `diffEditor.renderGutterMenu` defaults to **`true`** | `src/vs/editor/common/config/diffEditor.ts` (`diffEditorDefaultOptions.renderGutterMenu: true`), surfaced by `editorConfigurationSchema.ts:230-235` |
| `diffEditor.codeLens` defaults to **`false`** | same file (`diffCodeLens: false`), surfaced by `editorConfigurationSchema.ts:247-251`; `editorOptions.ts:958-963` says so in prose too |
| Everything this phase *does* use is in stable 1.134.0 | `createTextEditorDecorationType` `:11277`, `setDecorations` `:1357`, `DecorationOptions` `:1211`, `hoverMessage` `:1221`, `gutterIconPath` `:1095`, `overviewRulerColor` `:1107`, `isWholeLine` `:1184`, `MarkdownString.isTrusted` (object form with `enabledCommands`) `:3025-3030`, `registerCodeLensProvider` `:14894`, `CodeLens` `:2850`, `TabInputTextDiff` `:19184`, `tabGroups` `:11079`, `onDidChangeTabs` `:19430`, `visibleTextEditors` `:11091`, `onDidChangeVisibleTextEditors` `:11104`, `onDidChangeActiveTextEditor` `:11098`, `onDidChangeTextEditorSelection` `:11109` |

**No probe harness this phase.** G14's probe D (the mounted-webview harness) exists for the webview;
this phase adds nothing to the webview and touches no rendering path a headless browser can reach.
What *is* mechanically checkable here is pure logic, and D10 makes it a real test rather than a
throwaway probe.

### 0.2 Scope

One feature, stated as four questions SPEC explicitly left to this planning pass, plus the two the
feature cannot avoid:

| Question | Where SPEC leaves it | Finding | Decision |
|---|---|---|---|
| Which VS Code surface carries the gesture, given the named model | "gutter decorations and/or per-hunk CodeLens actions" | F2, F3, F4, F5 | **D1, D2, D3** |
| Where the hunks and the already-reviewed ranges come from | unstated | F6, F7, F8 | **D4** |
| The selection-to-`LineRange` mapping | "left entirely to this phase's own Opus planning pass" | F8, F9 | **D5, D6** |
| Decoration lifecycle | same | F6, F12 | **D7** |
| Re-open-after-new-commits behaviour | same | F6, F9 | **D8** |
| Keeping the sidebar's file list honest afterwards | unstated | F10 | **D9** (and §11.2) |

### 0.3 Not in this phase

- **Any Go change at all.** The server half is finished (F1). "No diff under `apps/kira-studio/`" is
  a §7.4 checklist item, exactly as G14 made it one after its own F2.
- **Any `packages/git-ipc` change**, and therefore **no `CONTRACT_VERSION` bump** — it stays **21**.
  Checklist item, §7.4. This is the fence that shapes D4 and D9 more than anything else.
- **Any `review.db` migration or `internal/gitreview` change.** G11 D10's write semantics
  (`Union`/`Subtract` + re-snapshot) are exactly what a range mark needs; nothing is added to them.
- **A second diff implementation.** No `diff`/`jsdiff`/`diff-match-patch` dependency, no hand-rolled
  line differ. The hunks are git's own, fetched (D4). G4 D11's warning against "a second, unproven
  implementation of the same trickiest math" applies verbatim here.
- **Restoring `DiffView.vue`'s in-webview review adornment.** G12 D12 removed the *use*, not the
  component; the graph panel's detail pane still uses `DiffView` correctly and is untouched. The
  review sidebar keeps showing the file list, not a diff body.
- **Marking on a commit diff.** `editor.openDiff` (G4) mints a 3-field key with no `reviewBranch`,
  so `reviewAnchorFor` returns `undefined` and nothing in this phase attaches. There is no review
  session for "commit `abc123` vs its parent" and inventing one is a different feature.
- **Marking from the original (left-hand) pane.** D5 makes this a hard refusal, not a silent
  mis-coordinate write.
- **Auto-marking.** Nothing marks a range because the user scrolled past it, closed a tab, or
  navigated. Every mark is an explicit gesture.
- **Editing `docs/v1.3/SPEC.md`.** A chapter spec is not retro-edited by a phase; the two
  corrections in the preamble are settled here, in this plan.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or **run** here.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out is left out entirely.
- **Layering:** `proxyHandlers.ts` and `goToFile.ts` never import `vscode` (their own doc comments
  say why). D11 keeps that true: the new controller is `vscode`-facing and reaches
  `proxyHandlers.ts` only as plain-data callbacks, exactly as `renderReviewComments` /
  `notifyCommentsMutated` already do. The new pure-logic module imports **nothing** from `vscode`,
  which is what makes D10's test run under plain `bun test`.
- **No shell, no subprocess.** This phase spawns nothing.
- **Comments: very concise, only where the code cannot say it for itself.** The two that earn their
  keep are named in §4.
- **Tests only where `AGENTS.md`'s bar is met.** D10 argues the one new test file against the bar by
  name, and says explicitly what gets nothing.
- Commits are Conventional Commits, granular, landing as work completes.

---

## 1. Findings

### F1 — The interim gap is exactly one call site wide; the server half is finished

G12 D12 removed `DiffView`'s review adornment from the review sidebar and left whole-file marking as
the interim. What survives, verbatim, is the entire machinery underneath it:

- `review.mark`'s params are `{repoId, branch, path, reviewed, ranges?: readonly LineRange[]}`
  (`contract.ts:1091-1100`). `ranges` **omitted** (not merely empty) means the whole file — G11 D13.
- Go reads it: `ReviewMarkParams.Ranges []gitreview.LineRange` (`wire.go:318`), passed straight into
  `entry.MarkFile(ctx, p.Branch, p.Path, p.Reviewed, p.Ranges)` (`incremental.go:112`).
- `proxyHandlers.ts:314` forwards `review.mark` verbatim.
- `ReviewFilesState.mark(path, reviewed, ranges?)` still builds the ranged payload
  (`reviewFiles.ts:223-240`).
- The one caller, `ReviewFilesPane.vue:74-78`, calls `mark(path, !isReviewed)` — two arguments.

So the restoration is a **new caller**, not new plumbing. Nothing under `apps/kira-studio/` or
`packages/git-ipc/` needs to move, which is what makes SPEC's "no Go, no migration, no bump" fence
achievable rather than aspirational.

### F2 — VS Code's own hunk-staging gutter buttons are a **proposed-API menu**, and we cannot contribute to it

This is the phase's central investigation, and it comes back negative on the literal reading.

The buttons SPEC names are contributed by the built-in Git extension to two menu ids:

```
"diffEditor/gutter/hunk":      { "command": "git.diff.stageHunk",      "group": "primary@10", … }
"diffEditor/gutter/selection": { "command": "git.diff.stageSelection", "group": "primary@10", … }
```

Both ids are declared in VS Code's own menu registry as **proposed**:

```ts
// src/vs/workbench/services/actions/common/menusExtensionPoint.ts:463-474
{
    key: 'diffEditor/gutter/hunk',
    id: MenuId.DiffEditorHunkToolbar,
    description: localize('menus.diffEditorGutterToolBarMenus', "The gutter toolbar in the diff editor"),
    proposed: 'contribDiffEditorGutterToolBarMenus'
},
{
    key: 'diffEditor/gutter/selection',
    id: MenuId.DiffEditorSelectionToolbar,
    description: localize('menus.diffEditorGutterToolBarMenus', "The gutter toolbar in the diff editor"),
    proposed: 'contribDiffEditorGutterToolBarMenus'
},
```

and the built-in Git extension enables exactly that proposal in its own manifest
(`extensions/git/package.json#enabledApiProposals` contains `"contribDiffEditorGutterToolBarMenus"`).

What happens to an extension that contributes without enabling it is not "degrade gracefully" — it
is a hard, named rejection at manifest-parse time (`menusExtensionPoint.ts:1086`):

> *"{0} is a proposed menu identifier. It requires `package.json#enabledApiProposals: ["{1}"]` and is
> only available when running out of dev or with the following command line switch:
> `--enable-proposed-api {2}`"*

**Why we cannot take that route.** Kira Version ships as a `.vsix` bundled in the DMG and installed
with `code --install-extension <path>` (G10). Proposed APIs are available to an extension running
out of a development host or launched behind `--enable-proposed-api`, neither of which describes a
user who installed the extension and opened VS Code normally. Requiring a per-launch CLI flag to
make a review feature appear is not shippable, and `AGENTS.md`'s "no shortcuts / scope left out is
left out entirely" forbids half-shipping it behind a flag and calling it done.

`diffEditor.renderGutterMenu` itself defaults to **`true`**, so the gutter strip *is* on screen for
the ordinary user — it is simply a menu we are not allowed to put anything into.

### F3 — There is no stable API that tells a third-party extension where VS Code drew the diff

The other half of the built-in mechanism is the hunk data. `git.diff.stageHunk` acts on VS Code's
own computed changes, delivered through the diff-information API:

```ts
// src/vscode-dts/vscode.proposed.textEditorDiffInformation.d.ts
export interface TextEditorChange {
    readonly original: TextEditorLineRange;
    readonly modified: TextEditorLineRange;
    readonly kind: TextEditorChangeKind;
}
export interface TextEditorDiffInformation {
    readonly documentVersion: number;
    readonly original: Uri | undefined;
    readonly modified: Uri;
    readonly changes: readonly TextEditorChange[];
    readonly isStale: boolean;
}
// on TextEditor:
readonly diffInformation: TextEditorDiffInformation[] | undefined;
// on window:
export const onDidChangeTextEditorDiffInformation: Event<TextEditorDiffInformationChangeEvent>;
```

`textEditorDiffInformation` is in the Git extension's `enabledApiProposals` list too. And the older
mechanism it replaced is equally unavailable: `grep` over `node_modules/@types/vscode/index.d.ts`
(1.134.0, 21 240 lines) returns **zero** hits for `registerDiffInformationCommand`, `LineChange`,
`DiffInformation` and `lineChanges`.

**The consequence, stated plainly because it is permanent and not a bug to fix later:** whatever
hunk boundaries this phase draws are *its own*. VS Code's diff editor computes its blocks with
`diffAlgorithm: 'advanced'` and `ignoreTrimWhitespace: true` by default; git computes hunks with
Myers plus three lines of context. The two usually agree on where a change is and can disagree on
exactly which lines a block spans. There is no stable way to make them agree, and pretending
otherwise would be the "nearly working" failure mode `ports/editorIntegration.ts`'s own doc comment
warns about. D2 answers this by making the *exact* gesture (a selection) primary and the
*approximate* one (a hunk) the convenience layer, rather than the reverse.

### F4 — `diffEditor.codeLens` defaults to **off**, so a CodeLens-only design shows nothing

From VS Code's own defaults object (`src/vs/editor/common/config/diffEditor.ts`):

```ts
export const diffEditorDefaultOptions = {
    …
    renderMarginRevertIcon: true,
    renderGutterMenu: true,
    …
    renderIndicators: true,
    diffCodeLens: false,          // <- diffEditor.codeLens
    renderOverviewRuler: true,
    …
}
```

`editorConfigurationSchema.ts:247-251` surfaces it as `diffEditor.codeLens` with
`default: diffEditorDefaultOptions.diffCodeLens`, and `editorOptions.ts:958-963`'s own doc comment
says "Should the diff editor enable code lens? **Defaults to false.**"

So SPEC's "and/or per-hunk CodeLens actions" cannot be the *only* route: for a user who has never
touched that setting, a `CodeLensProvider` registered against the diff's modified document renders
nothing at all, silently. D2 keeps CodeLens — it is the only affordance that sits *inline at the
hunk*, which is what the model actually looks like — but never as the sole route, and this phase
does not write the user's settings to make it appear (D3).

### F5 — What *is* stable is enough, and every piece of it is in 1.134.0

Verified by line number in `node_modules/@types/vscode/index.d.ts`:

| Need | API | Line |
|---|---|---|
| Paint reviewed lines | `window.createTextEditorDecorationType`, `TextEditor.setDecorations` | `:11277`, `:1357` |
| Whole-line tint + ruler mark | `DecorationRenderOptions.isWholeLine`, `.overviewRulerColor` | `:1184`, `:1107` |
| A visible mark in the gutter | `ThemableDecorationRenderOptions.gutterIconPath` | `:1095` |
| A **clickable** action on that mark | `DecorationOptions.hoverMessage` as a `MarkdownString` with `isTrusted: { enabledCommands: [...] }` — the object form, an allow-list, not a blanket `true` | `:1211`, `:1221`, `:3012-3030` |
| Inline per-hunk action | `languages.registerCodeLensProvider`, `CodeLens` | `:14894`, `:2850` |
| Which diff a document belongs to | `window.tabGroups`, `TabInputTextDiff` (`.original`/`.modified`), `TabGroups.onDidChangeTabs` | `:11079`, `:19184`, `:19430` |
| Which editors are on screen, and when that changes | `window.visibleTextEditors`, `onDidChangeVisibleTextEditors`, `onDidChangeActiveTextEditor` | `:11091`, `:11104`, `:11098` |
| Selection state for the toolbar's `when` clause | `window.onDidChangeTextEditorSelection` | `:11109` |
| Toolbar buttons | `contributes.menus["editor/title"]` — **not** proposed; G14 D9/D10 already use it | `package.json` |

The affordance is therefore fully reproducible: a visible mark in the gutter of the modified pane,
a hover on it that carries the action, an always-available toolbar button, and an inline CodeLens
for the users who have that setting on. What is *not* reproducible is being a first-party extension.

### F6 — The extension can already resolve everything about a review diff from its URI, statelessly

G13 D20 built this seam deliberately, and G14 D9 reused it. It costs this phase nothing:

- `reviewAnchorFor(uri)` (`reviewComments.ts:33-40`) returns `{repoId, branch, path, at}` **iff** the
  URI is the branch-tip side of a review diff — the fourth virtual-key field is what makes it so, and
  only `editor.openRangeDiff`'s right-hand `DocumentRef` ever sets it (`proxyHandlers.ts:241`).
  `editor.openDiff`'s commit diffs mint a 3-field key and resolve to `undefined`. That single check
  is what fences this whole phase off from every other document in VS Code.
- `resolveVirtualUri(uri)` (`diffToolbar.ts:50-59`) returns `{repoId, rev, path}` for **either** side.
  Applied to `TabInputTextDiff.original`, `rev` **is** `leftRev` — the exact revision the sidebar
  passed to `editor.openRangeDiff`. No new state, no map, no key-format change: it is already there.
- The `.empty` side (an added or deleted file) resolves to `undefined` — `EMPTY_SEGMENT` is `.empty`
  and `.` is outside base64url's alphabet, so it can never be mistaken for a key
  (`ports/editorIntegration.ts:33-36`). Handled, not a crash.
- **The right-hand document's line numbers are branch-tip line numbers, by construction.** Its key is
  `virtualKey(repoId, branchTip, path, branch)` and `VirtualDocumentSource.provide` resolves it with
  `file.read` at that rev (`extension.ts:207-218`) — the document *is* `<branchTip>:<path>`. That is
  exactly the coordinate system `LineRange` is defined in (`contract.ts:802-808`: "Always new-side
  (branch-tip) line numbers on the wire"). D5 rests entirely on this identity.

### F7 — What the URI cannot give: `base` and `mode` — and widening the contract to carry them is fenced off

`review.fileDiff` needs `{repoId, branch, base, path, mode}`. The URI supplies `repoId`, `branch`,
`path`. It does not supply the other two, and neither does `editor.openRangeDiff`'s params
(`repoId, branch, branchTip, leftRev, leftLabel, path, originalPath, status`). Both live only in the
webview's `ReviewFilesState` (`#target.base`, `diffMode`).

Widening `editor.openRangeDiff` is a `contract.ts` change, and in this repo a `contract.ts` change
bumps `CONTRACT_VERSION` **even for a request the server never sees** — G12 §12.1 did exactly that
for `editor.openRangeDiff` itself (18→19) and G14 D10 did it for `ui.action`'s optional target
(20→21). SPEC's G15 row forbids a bump. So the two values have to be *recovered*, not passed. D4
recovers them, and the recovery is cheap and deterministic.

One honest note on the alternative: extending `virtualKey.ts`'s key format is genuinely
extension-local (the key never crosses the socket; only `proxyHandlers.ts` mints it and only
`extension.ts`/`reviewComments.ts`/`diffToolbar.ts` read it), so it would need no contract change —
but it cannot help here, because the *handler* does not know `base` or `mode` either. It is
mentioned so a later phase does not rediscover it as a missed option.

### F8 — `review.fileDiff` already returns everything else, in one call, in the right coordinates

```ts
result: {
  path: string;
  deltaSource: ReviewDeltaSource;
  body: FileDiffBody;                          // { kind: 'text', hunks: readonly DiffHunk[] } | …
  reviewedRanges: readonly LineRange[];        // projected into branch-tip coordinates (G11 D10)
  lineCount: number;
  reviewedAtSha: string | null;
}
```

- `body.hunks` are **git's own** hunks for the very comparison the editor is showing (`mode: 'range'`
  ⇒ `mergeBase..branchTip`; `mode: 'sinceReview'` ⇒ the delta since the snapshot). No second differ.
- `reviewedRanges` are **already projected forward** into branch-tip coordinates by G11's fast/slow
  path — the same coordinates the modified pane's line numbers are in (F6). Nothing to re-map.
- `lineCount` bounds a clamp; `reviewedAtSha` is what D4 uses to derive `mode`.
- `DiffHunk.lines[].newLine` is `undefined` for a `del` line and set for `context`/`add`
  (`contract.ts:110-118`), which is what makes D6's change-block derivation exact rather than a
  guess from `newStart`/`newLines`.

G12 §11.1 predicted this ("the data a gutter would render is still on the client when the later
phase wants it"). It is half right: the data is on the *webview* client. This phase fetches it on the
*extension* side, which is where the decorations live.

### F9 — G11's write semantics make partial marking compose correctly, and forbid one case

From G11 D10 (`review.mark`, every call):

1. read the record, compute the delta as a read would;
2. project the stored ranges forward into tip coordinates (`state = 'full'` expands to `1..lineCount`);
3. `Union(existing, given)` for `reviewed: true`, `Subtract(existing, given)` for `reviewed: false`
   (`given` absent ⇒ everything / nothing);
4. **re-snapshot** at `branchTip` and replace the record;
5. write the result as the new ranges, now in the new snapshot's coordinates.

Three consequences this phase must respect:

- **The client never needs range algebra for correctness.** The server unions/subtracts. The client's
  algebra (D6) is *presentation only*: deciding whether a hunk reads as reviewed, and which of the two
  toolbar buttons to show.
- **The client must not optimistically mutate `reviewedRanges`.** Step 4 re-snapshots and step 2
  re-projects, so the post-write state is not `Union(old, given)` in the old coordinates. D7 repaints
  from a fresh `review.fileDiff` instead of guessing.
- **A ranged mark on a non-`text` snapshot is `E_BAD_REQUEST`, naming the path** (G11 D13). So the UI
  must not offer range marking when `body.kind !== 'text'` — binary, LFS pointer, too large, or
  mode-change-only. D2 makes that a visible, explained refusal, never a silently dead button.

Step 4 also settles SPEC's "re-open-after-new-commits" question in an unexpected direction — see F12.

### F10 — Nothing tells the review sidebar that an editor-side mark happened

`ReviewFilesState` reloads its file list on `setTarget` only (`reviewFiles.ts:81-91`), and
`ReviewView.vue`'s watch re-targets when `(repoId, branch, base)` changes — which a `repo.changed`
does trigger (the session re-resolve produces a fresh `resolution` object, the getter re-evaluates to
a new object literal, the watch fires). So the list *is* self-healing on any repo change.

A `review.mark`, however, emits no `repo.changed` (it touches `review.db`, not refs). And
`ReviewView.vue`'s `onUiAction` has a `default: return` (`:136-138`) — the existing `UiActionKind`
members that would reach it (`'refresh'` among them) currently do nothing there.

G13 hit this exact problem in the opposite direction and solved it by **adding** a `UiActionKind`
member (`refreshReviewComments`, G13 D19) — i.e. a `contract.ts` change and a bump. That route is
fenced off here. D9 takes the only other one and §11.2 flags it.

The reverse direction — a *sidebar* whole-file toggle needing to repaint the *editor's* decorations —
has no such problem: it already travels through `proxyHandlers.ts`'s `review.mark` forward, exactly
where G13 D9 hooked `notifyCommentsMutated` onto `review.comment.add`/`remove`/`clear`
(`proxyHandlers.ts:321-335`). D7 reuses that shape verbatim.

### F11 — `commands.ts`'s `pending` phase labels are stale by one, and they name this phase

```ts
export type MutatingEntry = PaletteCommand | { readonly pending: 'G15' | 'G16' };
```

with a doc comment reading *"G15 owns the five stash kinds, G16 owns reset/cherryPick and
tagPush/tagDeleteRemote"*. That was correct when G13 wrote it. SPEC's current table has **G16 =
stash**, **G17 = reset + cherry-pick** — G14 and G15 were both inserted on 2026-09-08, after that
comment was written, shifting everything below by one.

The practical risk is concrete: an implementing subagent handed "you are implementing G15" and
reading `pending: 'G15'` on `stashPush`/`stashPop`/… could reasonably conclude this phase owns stash
commands. It does not. §11.3 puts the fix-or-leave call to a human rather than silently taking either.

### F12 — Re-open-after-new-commits mostly answers itself, and leaves exactly one real hazard

SPEC names "re-open-after-new-commits behavior" as an open design question. Most of it falls out of
G12/G13's URI design for free:

The right-hand URI embeds `branchTip` (F6). New commits move the tip, so the *next* diff the sidebar
opens has a **different URI** — a different document, a different tab, no cached state, a fresh
`review.fileDiff`. There is no stale-content problem and no invalidation to write, because a
`kira-version:` blob is immutable and `ports/editorIntegration.ts:9-10` already relies on that.

The hazard is the **old tab**, still open, still showing the previous tip's content. Its decorations
remain honest — they are an accurate picture of what was reviewed *at that revision*. But a **mark
issued from it is silently wrong**: F9 step 3 interprets `given` in *current* tip coordinates, so
ranges taken from a stale document are applied to lines that have since moved. This is the single
most dangerous failure available in this phase — it corrupts durable user intent with no error — and
D8 guards it rather than hoping tabs get closed.

---

## 2. Decisions

### D1 — Reproduce the affordance, not the mechanism; say so in the code

F2/F3 close the literal reading of SPEC's model. This phase therefore builds the *same affordance*
out of stable API: a visible per-hunk mark in the modified pane's gutter, carrying "mark this hunk
reviewed" / "mark this hunk unreviewed", with already-reviewed lines visibly distinguished — which is
precisely what SPEC's own G12 §11.1 asked for in prose ("The review sidebar's equivalent is 'mark this
hunk reviewed' / 'mark this hunk unreviewed', with already-reviewed hunks visibly distinguished").

**Rejected: enable the proposed APIs anyway.** `enabledApiProposals` in our manifest plus
`--enable-proposed-api vladcirstean.kira-studio-vscode` on every VS Code launch. It would give a
pixel-perfect copy of the built-in gutter. It is rejected because a feature that only exists when the
user launches their editor from a terminal with a flag is not shipped, and `AGENTS.md` forbids
half-implementing scope. It is also fragile: proposed APIs change without notice between releases,
and SPEC §3.4's hard-lockstep posture is about *removing* version guesswork, not adding a second axis
of it.

**Rejected: compute the diff ourselves to match VS Code's blocks.** Adding a diff library
(`diff`/`diff-match-patch`) to align our hunks with the editor's rendered blocks would still not
match — VS Code's `advanced` algorithm with `ignoreTrimWhitespace: true` is not any of them — while
adding a dependency, a second source of truth, and exactly the "second, unproven implementation of the
same trickiest math" G4 D11 warns against. D4 uses git's hunks, and D2 makes the exact gesture primary
so the approximation never has to be exact.

The new controller's doc comment states F2/F3/F4 in three sentences, with the proposal names, so the
next reader does not re-derive this investigation. That comment is one of the two in this phase that
earn their keep under `AGENTS.md`'s bar.

### D2 — Three routes to two commands: selection (exact, primary), hunk hover (the gutter stand-in), CodeLens (inline, opt-in)

Two commands, one implementation, three entry points:

```
kiraVersion.markSelectionReviewed     — "Mark Selection Reviewed"
kiraVersion.markSelectionUnreviewed   — "Mark Selection Unreviewed"
```

Both take an **optional** explicit `{ uri: string; ranges: LineRange[] }` argument. Invoked with no
argument (toolbar, palette, context menu) they resolve the active review diff and use its selection;
invoked with one (hover command link, CodeLens) they act on exactly the hunk named. This is
`openCommitInGraphCommand`'s own already-proven two-arm shape (`diffToolbar.ts:135-153`) — an explicit
target bypasses tab resolution — reused rather than re-invented.

**(a) Selection — primary.** Contributed to `editor/title` (icons, `navigation@-97`, left of G14's
own two, keeping GitLens's ordering convention that phase established) and to `editor/context`, and
visible in the palette. Maps the modified pane's selections straight to `LineRange`s (D5). **This is
exact**: it needs no agreement with anyone's hunk boundaries (F3), which is why it is the primary
gesture and not the convenience layer.

**(b) Hunk hover — the gutter stand-in.** Each hunk's change block gets a gutter icon whose
`hoverMessage` is a `MarkdownString` with `isTrusted: { enabledCommands: [both ids] }` — the object
form, an allow-list of exactly two commands, never a blanket `true` — carrying:

```
**Lines 42–57** · not reviewed
[Mark reviewed](command:kiraVersion.markSelectionReviewed?<encoded args>)
```

`enableCommandUris`' webview equivalent is already used in this repo with the same allow-list
discipline (`reviewView.ts:57-61`), so the posture is house-consistent, not novel.

**(c) CodeLens — inline, opt-in.** A `CodeLensProvider` registered for `{ scheme: 'kira-version' }`,
emitting one lens at each hunk's first change line with the same two commands. **F4 says this renders
nothing unless the user has `diffEditor.codeLens` on.** It is kept anyway because it is the only
route that puts the action *inline at the hunk*, which is what the model in SPEC actually looks like,
and because over the hunk model D4 already builds it is ~30 lines. It is documented as opt-in in the
extension `README.md` and is never the sole route to anything.

**This phase does not write the user's `diffEditor.codeLens` setting.** Silently changing a global
editor preference to make our own feature visible is not ours to do, and a prompt on every activation
would be worse. The README names the setting; the hover and the toolbar work regardless.

**Only one of the two buttons is on the toolbar at a time.** A context key
`kiraVersion.reviewSelection` ∈ `none | partial | full | empty`, recomputed on selection change,
drives the `when` clauses: *Mark reviewed* shows when the selection is not already `full`; *Mark
unreviewed* shows when it is `full`. Un-marking a *partially* reviewed selection stays available from
the right-click menu, the palette, and the hunk hover (which knows its own hunk's state and always
offers the right one). Rationale: G14 already added two buttons to that toolbar; four fixed buttons on
a narrow diff toolbar is the same crowding complaint G14's own item 3 was raised about.

### D3 — Three decoration types, painted on the modified pane only

| Type | What it marks | Render |
|---|---|---|
| `reviewed` | `reviewedRanges` ∩ document | `isWholeLine: true`, `backgroundColor: new ThemeColor('kiraVersion.reviewedLineBackground')`, `overviewRulerColor: new ThemeColor('kiraVersion.reviewedLineOverviewRuler')`, `overviewRulerLane: Left` |
| `hunkActionable` | the first line of each **unreviewed or partly-reviewed** change block | `gutterIconPath` → `resources/mark-reviewed.svg`, `gutterIconSize: 'contain'`, per-range `hoverMessage` |
| `hunkReviewed` | the first line of each **fully reviewed** change block | `gutterIconPath` → `resources/marked-reviewed.svg`, per-range `hoverMessage` offering the un-mark |

Two new `contributes.colors` entries carry the tint, defaulting to a low-alpha green in each of the
four theme kinds, next to the eight `kiraVersion.graphLane*` entries that already establish the
pattern. `scripts/check-tokens.sh` governs `--kira-*` CSS custom properties in `packages/git-ui` and
is unaffected.

Two 16×16 SVGs go in `resources/` (which `.vscodeignore` does not exclude, so they ship), each with
`light`/`dark` variants supplied through `DecorationRenderOptions`' own `light`/`dark` overrides —
the glyph margin's background differs enough between themes that one asset would be invisible in one
of them.

**The overview ruler is deliberate**, not decoration for its own sake: "how much of this file have I
read" is the question partial review exists to answer, and the ruler is the only surface that answers
it without scrolling.

**Decorations are applied to the modified pane's `TextEditor` and to nothing else.** The original
pane is left completely undecorated — its line numbers are in the *left* revision's coordinates, and
tinting them would state something false (D5's guard is the same rule, at the command layer).

**Known collision risk, named not hidden:** the modified pane's glyph margin already carries VS Code's
own `renderIndicators` +/− marks (default on) and `renderMarginRevertIcon` arrows (default on), and
`renderGutterMenu` (default on) reserves a strip beside it. Whether a third icon reads clearly there,
or crowds, cannot be determined in this container. §7.3 makes it an explicit Tier-3 check with a named
fallback (drop `gutterIconPath`, keep the hover on the whole change block) if a human says it crowds.

### D4 — The data comes from one `review.fileDiff` per opened review diff, with `base` and `mode` recovered rather than passed

The resolution chain, run per review-diff URI, entirely inside the extension:

1. **Anchor.** `reviewAnchorFor(modifiedUri)` → `{repoId, branch, path, at}` where `at` is
   `branchTip`. `undefined` ⇒ not a review diff ⇒ this phase does nothing at all (F6). This one check
   is the fence around every commit diff, working file and unrelated document in the window.
2. **`leftRev`.** `resolveVirtualUri(tab.original)?.rev`, where `tab` is the `TabInputTextDiff` whose
   `modified` is this URI. `undefined` for the `.empty` side of an added file — handled in step 4.
3. **`base`.** `connection.request('review.resolveBase', { repoId, branch, baseCandidates })` with
   `baseCandidates` taken from the window's own coerced settings snapshot — the *same* injection
   `proxyHandlers.ts:295-302` performs for the webview's call, so the extension resolves the same base
   the sidebar did rather than falling back to the server's `["main","master"]` default. Memoised in a
   `Map<string, Promise<string | null>>` keyed `repoId + "\0" + branch`; dropped on `repo.changed` for
   that repo and on any connection state that is not `connected`. `resolution.base === null` (an
   unrelated or unresolvable base) ⇒ no marking UI, and an explicit invoke says why.
4. **`mode`.** Request `review.fileDiff` with `mode: 'sinceReview'` first, then decide from the result:
   - `reviewedAtSha === null` ⇒ **use this result.** G11 D13 is explicit that with
     `deltaSource: 'noSnapshot'` the `sinceReview` body *is* the range diff, so both modes agree and
     a second call would return the same hunks. (This also covers `leftRev === undefined` from step 2.)
   - `leftRev === reviewedAtSha` ⇒ the tab is in `sinceReview` mode ⇒ **use this result.**
   - otherwise ⇒ the tab is in `range` mode (its `leftRev` is the merge base) ⇒ **re-request with
     `mode: 'range'`** and use that.

   One request in the common case, two in the other. Both are server-cached reads on a Unix socket;
   neither is on a scroll or keystroke path.
5. **Hunks.** `body.kind === 'text' ? body.hunks : none`. Any other kind means no range marking is
   possible (F9) — decorations are not painted and the two commands explain the reason
   (`binary`/`lfsPointer`/`tooLarge`/`modeChangeOnly` each get their own sentence) rather than
   failing silently or letting the server answer `E_BAD_REQUEST`.

**Rejected: `review.files` to learn `mergeBase` and compare against `leftRev`.** It works and is one
line shorter to describe, but it costs an extra round trip that computes a whole three-dot file list
to answer a yes/no question `review.fileDiff`'s own `reviewedAtSha` already answers.

**Rejected: caching `base`/`mode` from the `editor.openRangeDiff` call in an extension-side map.** It
would be one round trip cheaper and it does not survive a window reload — the exact failure G13 D9/D20
built `reviewAnchorFor` to be stateless in order to avoid. A tab VS Code restores after a reload must
get its decorations back, and `onDidChangeVisibleTextEditors` is how (`reviewComments.ts:256-264`
already relies on this for comment threads).

### D5 — Selection → `LineRange`: the modified pane's own line numbers, with one boundary rule and one hard refusal

The modified document **is** `<branchTip>:<path>` (F6), and `LineRange` is defined in branch-tip
coordinates (`contract.ts:802-808`). The mapping is therefore direct, with no projection:

```ts
// pure; takes a plain {start,end}×{line,character} shape so the module needs no `vscode` import
export function selectionToRange(sel: SelectionShape): LineRange {
  const startLine0 = sel.start.line;
  // A downward drag that lands at column 0 of the next line does not include that line — VS Code's
  // own convention for a full-line selection, and what git.stageSelectedRanges does with the same
  // gesture. A single-line selection is never collapsed away by this rule.
  const endLine0 =
    sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  return { start: startLine0 + 1, end: Math.max(endLine0, startLine0) + 1 };
}
```

- **An empty selection is the cursor's own line.** The rule above already produces that.
- **Multiple selections** (multi-cursor, a real thing in a diff pane) produce one `LineRange` each,
  normalised and merged (D6), and are sent as **one** `review.mark` call. One call, not N: G11 D10
  step 4 re-snapshots on every write, so N calls would re-snapshot N times and the intermediate
  states are meaningless.
- **Clamped** to `1..lineCount` from `review.fileDiff` before sending. A selection past the last line
  of a document VS Code padded is not a range the server should be asked to store.
- **Hard refusal on the original pane.** If the editor the gesture came from is the diff's `original`
  side, both commands refuse with *"Mark reviewed works on the right-hand side of the diff — the
  branch's own version of the file."* This is not politeness: the left pane's line numbers are the
  merge base's (or the snapshot's), and writing them as `ranges` would corrupt durable state with no
  error anywhere (F9). The guard is at the top of the shared command body, before anything else.

**Which editor supplies the selection when the click came from the toolbar.** Never
`window.activeTextEditor` alone — G14 F11 already established that a diff editor's active editor may
be neither pane when the click originates in the title bar. The resolution is: take the active tab's
`TabInputTextDiff`, then find `window.visibleTextEditors.find(e => e.document.uri.toString() ===
tab.modified.toString())` and read **that** editor's `.selections`. VS Code keeps a non-focused
editor's selection, so this is correct whether or not focus left the pane.

### D6 — A small pure range module: presentation algebra only, and the change block is the hunk's *changed* lines

New file `reviewRanges.ts`, importing only types from `@kira/git-ipc` and nothing from `vscode`:

```ts
normalizeRanges(ranges)            // drop invalid, sort, merge overlapping AND adjacent (end+1 === next.start)
unionRanges(a, b)
subtractRanges(a, b)
clampRanges(ranges, lineCount)
coverage(target, ranges): 'none' | 'partial' | 'full'
hunkChangeBlock(hunk): LineRange | undefined
selectionToRange(sel)              // D5
```

**`hunkChangeBlock` marks the changed lines, not the context.** A git hunk carries up to three
context lines on each side; marking them "reviewed" is not wrong (they are unchanged content) but it
inflates every stored range by six lines and makes "which lines have I read" less meaningful. The
block is therefore derived from the hunk's own lines rather than from `newStart`/`newLines`:

```ts
// The span from the first to the last non-context line that HAS a new-side image. A `del` line has
// newLine === undefined (contract.ts:110-118), so a pure-deletion hunk yields `undefined` — there is
// no branch-tip line to hang state on, and G11 stores ranges in the tip snapshot's coordinates.
```

A pure-deletion hunk therefore gets no gutter icon and no CodeLens. That is correct rather than a
gap: G11 D10's projection already drops ranges whose lines were deleted, so there is nothing for a
user to assert about lines that no longer exist.

**This algebra is presentation-only** (F9). It decides which icon a hunk gets, which of the two
toolbar buttons shows, and what the hover says. It never predicts what the server will store, and the
client never writes `reviewedRanges` from it.

### D7 — Decoration lifecycle: one controller, keyed by URI, repainted from the server, never from a guess

One `ReviewMarkingController` (new file `reviewMarking.ts`), created in `activate()` and pushed to
`context.subscriptions`. It owns:

- three `TextEditorDecorationType`s, created once and disposed with the controller;
- `Map<string /* uri */, MarkingState>` where `MarkingState` is
  `{ anchor, leftRev, hunks, reviewedRanges, lineCount, stale: boolean }`;
- `Map<string /* uri */, AbortController>` for the in-flight `review.fileDiff`, aborted and replaced
  on every reload of the same URI (`ReviewFilesState`'s own supersede-and-verify discipline,
  `reviewFiles.ts:194-206`, applied here);
- the memoised base map from D4 step 3;
- the two context keys from D2.

**Loads** (fetch + paint):

| Trigger | Why |
|---|---|
| `proxyHandlers.ts`'s `editor.openRangeDiff`, right after `renderReviewComments` | paint immediately rather than wait for a visibility event — G13 D9's exact reason, at the exact same seam (`proxyHandlers.ts:249-252`) |
| `window.onDidChangeVisibleTextEditors` | a tab VS Code restored after a reload, a split, a second group — `reviewComments.ts:256-264`'s own case, verbatim |
| `window.onDidChangeActiveTextEditor` | recompute the context keys for the newly active pane (no fetch if the state is cached) |

**Repaints from cache** (no fetch): a new `TextEditor` appearing for an already-tracked URI.

**Invalidates** (drop + refetch, or drop entirely):

| Trigger | Effect |
|---|---|
| a successful `review.mark` from *this* controller | refetch `review.fileDiff` for that URI and repaint — never `Union(old, given)` locally (F9) |
| a successful `review.mark` forwarded from the **webview** (a sidebar whole-file toggle) | `proxyHandlers.ts` calls `notifyReviewMarked(repoId, branch, path)`, the exact shape `notifyCommentsMutated` already has (`proxyHandlers.ts:321-335`); every tracked URI matching `(repoId, branch, path)` refetches |
| `repo.changed` for that `repoId` | drop the base memo for that repo, run D8's staleness check, refetch every tracked URI belonging to it |
| connection state leaves `connected` | clear every state entry, clear all decorations, clear both context keys |
| `onDidChangeTabs` closing a tab | drop that URI's entry and abort its in-flight request |

A transient `review.fileDiff` failure clears that URI's decorations and leaves no error UI — the same
posture `renderThreads` already takes for a failed `review.comment.list` (`reviewComments.ts:162-164`).
An *explicit* mark that fails does show an error message, because the user asked for it.

### D8 — Re-open after new commits: the URI changes on its own, and a stale tab is made read-only

F12 establishes that new commits produce a *new URI*, so there is nothing to invalidate on the new
tab and nothing to reconcile. The whole decision is about the **old** tab.

**The check.** On `repo.changed` for a repo with tracked review URIs, the controller issues one
coalesced `review.files({repoId, branch, base})` per distinct `(repoId, branch)` — the one existing
request that returns the authoritative `branchTip` — and compares it against each tracked URI's own
`anchor.at`.

- **Unchanged** ⇒ refetch `review.fileDiff` and repaint. (The tip is the same but a `repo.changed`
  can still mean the index or another ref moved; refetching keeps `deltaSource` honest.)
- **Moved** ⇒ mark every URI at the old tip `stale: true`.

**What `stale` means, precisely:**

- The `reviewed` tint **stays**. It is a true statement about that revision, and blanking it would
  make a still-open tab look unreviewed when it is not.
- The `hunkActionable` / `hunkReviewed` gutter icons and every CodeLens are **removed**, and
  `kiraVersion.inReviewDiff` goes false for that URI — so no toolbar button, no context-menu entry,
  no hover command link.
- An explicit invoke (palette) refuses with *"This diff is from an earlier revision of `<branch>` —
  reopen the file from the Branch Review sidebar to mark it."*

**Why a guard rather than a re-map.** Mapping the stale ranges forward is exactly the projection
`review.fileDiff` already performs server-side against the *current* tip, and doing it again on the
client would be a second implementation of G11's own math with none of its inputs. Refusing costs the
user one click and cannot corrupt anything; guessing can (F12).

### D9 — Keeping the sidebar honest: reuse the existing `'refresh'` `UiActionKind`, four lines of `ReviewView.vue`

F10 says an editor-side mark leaves the sidebar's file list showing a stale `none`/`partial`/`full`
until the next `repo.changed`, and that there are exactly three ways out. Laid out plainly:

| Option | Cost | Fence crossed |
|---|---|---|
| 1. New `UiActionKind` member (G13 D19's precedent) | ~5 lines | `contract.ts` + **`CONTRACT_VERSION` 21 → 22** *and* `ReviewView.vue` |
| 2. Do nothing | 0 | none — but the sidebar visibly disagrees with the editor until an unrelated event |
| **3. Reuse `'refresh'`, already a `UiActionKind`** | ~4 lines | `ReviewView.vue` only |

**This plan takes option 3.** `'refresh'` already exists in `UiActionKind` (`contract.ts:926-953`),
`reviewProvider.runUiAction` already accepts and emits any member (`reviewView.ts:117-120`), and
`ReviewView.vue`'s `onUiAction` currently drops it on `default:` (`:136-138`). "Refresh" meaning
"reload this pane" in the review view is what the member already means everywhere else; its being a
no-op there reads as an oversight rather than a design. The change is:

```ts
case 'refresh':
  reviewFiles.value?.reload();
  return;
```

plus a `reload()` on `ReviewFilesState` that re-runs its existing `#loadFiles` against the current
target. **No `contract.ts` change, no bump, no new wire vocabulary.** The extension calls
`reviewProvider.runUiAction('refresh')` after a successful editor-side mark.

SPEC's G15 row says "no `packages/git-ui`". This crosses that, minimally and deliberately — **§11.2
flags it for a human**, with option 2 as the zero-change fallback that leaves the feature working and
the sidebar occasionally behind.

### D10 — Exactly one new test file, and what deliberately gets none

`AGENTS.md`'s bar: a test earns its keep only for "a parser/splitter with several interacting rules,
cursor/pagination boundary arithmetic, … or a decision structure too large to hold in your head."

**`reviewRanges.test.ts` clears it, and is the only new test.** `normalizeRanges`/`unionRanges`/
`subtractRanges` are interval arithmetic with genuinely interacting rules (overlap vs. adjacency vs.
containment vs. a subtraction that splits one range into two), `selectionToRange` is boundary
arithmetic with an off-by-one rule that is wrong in both directions if misread, and
`hunkChangeBlock`'s `newLine === undefined` handling is the difference between a correct block and a
silently shifted one. All of it is pure and imports no `vscode`, so it runs in the existing
`bun run test:unit` sweep (which already includes `apps/kira-studio-vscode/src`) with no extension
host. Cases worth naming: adjacent ranges merging, a subtraction splitting a range in two, a
subtraction that empties one, a single-line selection, a full-line drag ending at column 0, a
multi-line drag ending mid-line, a pure-deletion hunk, a hunk whose first changed line is not
`newStart`, and a clamp past `lineCount`.

**What gets nothing, and why:** `reviewMarking.ts` (every branch of it either calls `vscode` or awaits
an RPC — an integration test needs an extension host this container does not have, and a mock-heavy
unit test would restate the function body, which the bar names explicitly); the two command bodies
(thin dispatch over the tested pure functions); the decoration types (declarative); the manifest
entries (already covered — `commands.test.ts` cross-checks them both ways, F10/§7.1).

### D11 — Layering: the controller is `vscode`-facing, `proxyHandlers.ts` stays `vscode`-free

`proxyHandlers.ts`'s doc comment states that it never imports `vscode`, which is why `revealReview`,
`renderReviewComments` and `notifyCommentsMutated` are plain functions rather than object references.
This phase adds two more of the same kind and nothing else:

```ts
readonly refreshReviewMarking: (repoId: string, branchTip: string, path: string, branch: string) => void;
readonly notifyReviewMarked:   (repoId: string, branch: string, path: string) => void;
```

`goToFile.ts`'s precedent applies to the split too: the pure module (`reviewRanges.ts`) is separate
from the `vscode`-facing one (`reviewMarking.ts`) precisely so the former can be imported and tested
without the latter — the same reason G14 D9 split `goToFile.ts` out of `diffToolbar.ts`.

### D12 — Context keys, and why the `when` clauses cannot be `resourceScheme` alone

G14's two buttons use `when: isInDiffEditor && resourceScheme == kira-version`. That clause is right
for "Go to file" — it matches a commit diff too, and going to a file from one is meaningful. It is
**wrong** for this phase: a commit diff has no review session, and a *stale* review diff must not
offer the action either (D8). Two keys, both set via `vscode.commands.executeCommand('setContext', …)`:

| Key | Values | Set when |
|---|---|---|
| `kiraVersion.inReviewDiff` | boolean | the active tab is a review diff whose marking state is loaded, `body.kind === 'text'`, and not `stale` |
| `kiraVersion.reviewSelection` | `'none' \| 'partial' \| 'full' \| 'empty'` | `coverage(selectionRanges, reviewedRanges)` for the modified pane, recomputed on `onDidChangeTextEditorSelection` and `onDidChangeActiveTextEditor`; `'empty'` when there is no resolvable modified-pane selection |

`'empty'` is a distinct value rather than folded into `'none'` so the toolbar can hide both buttons
when there is genuinely nothing selectable, instead of offering "Mark reviewed" over nothing.

### D13 — `CONTRACT_VERSION` stays 21, and that is a checklist item, not an aspiration

Every design choice above that looked slightly awkward — recovering `base` through
`review.resolveBase` (D4), recovering `mode` through `reviewedAtSha` (D4), reusing `'refresh'` rather
than adding a `UiActionKind` (D9) — exists to keep this true. §7.4 makes "no diff in
`packages/git-ipc/src/contract.ts`, `validate.ts`, `internal/gitrpc/contract.go`, or
`tests/e2e-real/git-pairing-real.spec.ts:93`" a literal pre-commit check, the same way G14 §8.4 made
its own no-diff claims checkable.

---

## 3. The Go side, file by file

**Nothing.** F1 proves `review.mark` accepts, validates and applies `ranges` today
(`wire.go:311-319`, `incremental.go:100-112`), and G11 D10 already defines the write semantics a
range mark needs. §7.4's checklist asserts an empty diff under `apps/kira-studio/`.

---

## 4. The TypeScript side, file by file

### 4.1 `apps/kira-studio-vscode/src/reviewRanges.ts` — **new** (D5, D6)

Pure interval algebra plus `selectionToRange` and `hunkChangeBlock`. Imports `LineRange` and
`DiffHunk` as types from `@kira/git-ipc`; imports nothing else, and specifically not `vscode`. ~110
lines including the two comments that earn their keep (the column-0 boundary rule, and why a
`del` line's `undefined` `newLine` is skipped).

### 4.2 `apps/kira-studio-vscode/src/reviewRanges.test.ts` — **new** (D10)

Plain `bun test`, no `vscode`, picked up by the existing `test:unit` glob. The cases D10 names.

### 4.3 `apps/kira-studio-vscode/src/reviewMarking.ts` — **new** (D1–D4, D7, D8, D12)

The controller. Exports `createReviewMarkingController(deps): ReviewMarkingController` — the shape
`createReviewCommentController` already uses (`reviewComments.ts:100-103`), including the `Disposable`
and the plain-data entry points. Contents:

- the doc comment stating F2/F3/F4 with the proposal names (D1);
- the three decoration types (D3);
- `resolve(uri)`: anchor → tab → `leftRev` → base (memoised) → `review.fileDiff` mode selection (D4);
- `paint(editor, state)` / `clear(editor)`;
- `markRanges(uri, ranges, reviewed)`: the shared body behind both commands — original-pane guard,
  clamp, normalise, one `review.mark`, refetch, repaint, `reviewProvider.runUiAction('refresh')`;
- `provideCodeLenses` (D2c) with its own `onDidChangeCodeLenses` emitter fired on every repaint;
- `refreshForKey(repoId, branchTip, path, branch)` — `proxyHandlers.ts`'s post-`openRangeDiff` hook;
- `notifyMarked(repoId, branch, path)` — the webview-mutation hook;
- `notifyRepoChanged(payload)` — D8's staleness check;
- the event subscriptions and `dispose()`.

Two exported command factories, `markSelectionReviewedCommand(deps)` and
`markSelectionUnreviewedCommand(deps)`, each `(explicit?: unknown) => void` with
`diffToolbar.ts:155-167`'s own `asExplicitTarget` validation shape, widened to `{uri, ranges}`.

### 4.4 `apps/kira-studio-vscode/src/proxyHandlers.ts` — **edited** (D7, D11)

Two new `CreateProxyHandlersDeps` members (D11). `editor.openRangeDiff` calls
`refreshReviewMarking(repoId, branchTip, path, branch)` on the same `status !== 'deleted'` branch that
already calls `renderReviewComments` (`:249-252`). `review.mark` stops being a bare `forward(...)` and
becomes the three-line `await` + `notifyReviewMarked(...)` + `return` shape
`review.comment.add`/`remove`/`clear` already have (`:321-335`).

### 4.5 `apps/kira-studio-vscode/src/extension.ts` — **edited** (D2, D7, D9, D12)

Construct the controller (it needs `manager`, `() => currentSettings` for D4's `baseCandidates`, and
the `reviewProvider` binding for D9 — the same `let`-binding cycle break `reviewComments` already
uses, `:231-234`); push it to `context.subscriptions`; add the two ids to `otherCommandHandlers`;
extend the existing `manager.on('repo.changed', …)` fan-out (`:327-330`) with
`reviewMarking.notifyRepoChanged(payload)`; add the connection-state clear inside the existing
`onStateChange` handler; pass the two new callbacks into `createProxyHandlers`.

### 4.6 `apps/kira-studio-vscode/src/commands.ts` — **edited** (D2)

Two `OTHER_COMMANDS` entries, each with the one-line comment naming this phase, matching the
`goToFileFromDiff`/`openCommitInGraph` entries G14 added. (The stale `pending` labels, F11, are
§11.3's call — not changed unless a human says so.)

### 4.7 `apps/kira-studio-vscode/package.json` — **edited** (D2, D3, D12)

- `contributes.commands`: two entries, category `Kira Version`, icons `$(check)` and `$(circle-slash)`.
- `contributes.menus["editor/title"]`: the two entries at `navigation@-97`, `when` per D12
  (`isInDiffEditor && kiraVersion.inReviewDiff && kiraVersion.reviewSelection != full` and
  `… == full`).
- `contributes.menus["editor/context"]`: both, group `kiraVersion@1`, `when: kiraVersion.inReviewDiff`
  (both always present here, D2).
- `contributes.colors`: `kiraVersion.reviewedLineBackground`, `kiraVersion.reviewedLineOverviewRuler`,
  four theme kinds each, alongside the eight lane colours.

### 4.8 `apps/kira-studio-vscode/resources/mark-reviewed.svg`, `marked-reviewed.svg` — **new** (D3)

16×16, light/dark pairs, referenced by `gutterIconPath`. Shipped automatically (`.vscodeignore`).

### 4.9 `apps/kira-studio-vscode/README.md` — **edited** (D2)

Three sentences: the gesture, the hunk hover, and that the inline CodeLens needs
`"diffEditor.codeLens": true` (F4) — the one place a user can learn this without reading the source.

### 4.10 `packages/git-ui/src/components/review/ReviewView.vue` + `src/state/reviewFiles.ts` — **edited** (D9, §11.2)

A `case 'refresh'` in `onUiAction`, and a `reload()` on `ReviewFilesState` re-running its existing
`#loadFiles`. Four lines plus a method. **Held pending §11.2's answer**; if the answer is "keep the
fence", this file is untouched and D9 falls back to option 2.

### 4.11 `docs/v1.3/SPEC.md` — **not edited**

Per §0.3. The two corrections live in this plan.

---

## 5. Dependencies and tooling

**No new dependency, in either direction.** No diff library (D1's second rejection), no runtime
package, no dev tool. `@types/vscode` stays pinned at 1.134.0 and `engines.vscode` at `^1.134.0` — F5
confirms every API used is in that surface, so no floor bump is needed either.

`bun run build:vscode` needs no change: the new source files are picked up by the existing esbuild
entry graph, and `resources/**` is copied by packaging rather than bundling.

---

## 6. Implementation order

One sequential Sonnet subagent; the work is order-dependent and must not be split.

1. `reviewRanges.ts` + `reviewRanges.test.ts` — pure, testable, and everything else depends on it.
   `bun run test:unit` green before moving on.
2. `reviewMarking.ts`'s resolution chain (D4) and state map, with no decorations yet — typecheck only.
3. Decoration types, painting, and the lifecycle events (D3, D7).
4. The two commands, the shared `markRanges` body, and D5's guards; `commands.ts` + `package.json`
   entries. `bun run test:unit` green again (`commands.test.ts` now covers the new ids).
5. Context keys and the `when` clauses (D12).
6. The CodeLens provider (D2c).
7. `proxyHandlers.ts` + `extension.ts` wiring (D7, D11), including D8's staleness check.
8. D9's `ReviewView.vue`/`reviewFiles.ts` change **only if §11.2 says yes**.
9. The SVGs, the colour entries, and the README.
10. Full sweep: `bun run typecheck:git`, `bun run lint`, `bun run test:unit`, `bun run build:vscode`.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 Tier 1 — fully provable in this container

| # | Criterion | How |
|---|---|---|
| T1.1 | The range algebra is correct across overlap, adjacency, containment, splitting subtraction and emptying subtraction | `reviewRanges.test.ts` under `bun run test:unit` |
| T1.2 | `selectionToRange` is right for a single-line selection, an empty selection, a full-line drag ending at column 0, and a multi-line drag ending mid-line | same |
| T1.3 | `hunkChangeBlock` returns the changed-line span (not the context span), and `undefined` for a pure-deletion hunk | same |
| T1.4 | Both new command ids exist in `commands.ts` **and** the manifest, with a title and the shared category, and no orphan in either direction | `commands.test.ts:146-176`, already written, runs in the same sweep |
| T1.5 | The whole TypeScript graph typechecks | `bun run typecheck:git`, exit 0 |
| T1.6 | Lint and token checks are clean | `bun run lint` |
| T1.7 | Both bundles build and pass their own checks | `bun run build:vscode` |
| T1.8 | The existing 759 tests still pass | `bun run test:unit` |
| T1.9 | **No Go diff, no contract diff, no `CONTRACT_VERSION` change** | `git diff --stat` over `apps/kira-studio/`, `packages/git-ipc/src/contract.ts`, `validate.ts` — empty; `grep` for `21` in the three version sites still agrees |

### 7.2 Tier 2 — provable here as a type/grep/read check plus a reasoned argument

| # | Criterion | How, and what the argument rests on |
|---|---|---|
| T2.1 | Every VS Code API this phase uses exists in the pinned stable surface | `grep` each identifier in `node_modules/@types/vscode/index.d.ts` (F5's table gives the line numbers); no `enabledApiProposals` appears anywhere in our manifest |
| T2.2 | Marking can never attach to a commit diff, a working file, or the original pane | the three guards are structural — `reviewAnchorFor` requires the fourth virtual-key field (only `editor.openRangeDiff` sets it), `inReviewDiff` gates every menu entry, and `markRanges` refuses a non-`modified` URI before touching anything. Readable in the diff; not observable without a host |
| T2.3 | A non-`text` diff body offers no range marking and says why | branch present in `resolve`; the four `body.kind` arms each map to a sentence |
| T2.4 | `base` resolution matches the sidebar's | both inject `kiraVersion.review.baseCandidates` from the same coerced snapshot (`proxyHandlers.ts:295-302` vs. D4 step 3); same request, same params, same server |
| T2.5 | Mode derivation is right in the `noSnapshot` case | rests on G11 D13's stated behaviour ("`deltaSource: 'noSnapshot'` returns the range diff as `body` even in `sinceReview` mode"), quoted in D4 step 4. **Read, not run** — a real repository with a never-reviewed file confirms it in Tier 3 |
| T2.6 | `proxyHandlers.ts` still imports no `vscode` | `grep -n "from 'vscode'" apps/kira-studio-vscode/src/proxyHandlers.ts` — empty |

### 7.3 Tier 3 — needs a human on a Mac, with VS Code and Kira Studio both running

This is where the phase's actual output lives, and none of it can be faked here: **this container has
no VS Code, no extension host, and no display.**

| # | Criterion |
|---|---|
| T3.1 | Opening a file from the Branch Review sidebar paints reviewed lines in the modified pane, with the tint legible in both a light and a dark theme |
| T3.2 | The gutter icon appears at each change block **and does not collide with VS Code's own `renderIndicators` marks, `renderMarginRevertIcon` arrows, or the `renderGutterMenu` strip** (D3's named risk). If it crowds: drop `gutterIconPath` and keep the hover on the whole change block |
| T3.3 | The hover's `command:` links actually fire — i.e. the `isTrusted: { enabledCommands: [...] }` allow-list is accepted and the argument round-trips |
| T3.4 | Selecting lines and clicking the toolbar button marks exactly those lines, and the tint updates without a manual refresh |
| T3.5 | Only one of the two toolbar buttons is visible at a time, and it flips as the selection moves between reviewed and unreviewed lines (D12's context key, live) |
| T3.6 | Neither button appears on a **commit** diff opened from the graph panel (T2.2, observed) |
| T3.7 | Marking from the **original** pane is refused with the message, not silently mis-applied (D5's guard, observed) |
| T3.8 | The sidebar's file list updates after an editor-side mark (D9 — and if §11.2 chose option 2, confirm the *documented* staleness instead) |
| T3.9 | A sidebar whole-file toggle repaints the open editor's decorations (D7's `notifyReviewMarked`) |
| T3.10 | After a new commit lands on the branch, the **old** tab stops offering the actions and explains why; reopening from the sidebar gives a fresh, fully working diff (D8) |
| T3.11 | With `"diffEditor.codeLens": true`, a lens appears at each change block and works; with it at its default `false`, everything else still works (F4) |
| T3.12 | A binary / too-large / LFS-pointer file explains itself rather than offering a dead button (T2.3, observed) |
| T3.13 | Reloading the window restores decorations on the restored diff tab (D7's `onDidChangeVisibleTextEditors` path) |
| T3.14 | `review.db` actually holds the partial state afterwards — the sidebar shows `partial`, and a reopen after a `refresh` still shows it |

### 7.4 The checklist

- [ ] `bun run typecheck:git` — exit 0
- [ ] `bun run lint` — clean
- [ ] `bun run test:unit` — 759 + the new cases, 0 fail
- [ ] `bun run build:vscode` — both bundles, checks passed
- [ ] `git diff --stat apps/kira-studio/` — **empty**
- [ ] `git diff --stat packages/git-ipc/` — **empty**
- [ ] `CONTRACT_VERSION` is still **21** in all three hand-maintained places
- [ ] No `enabledApiProposals` key anywhere in `apps/kira-studio-vscode/package.json`
- [ ] No new runtime or dev dependency in any `package.json`
- [ ] `packages/git-ui/` diff is either empty or exactly D9's four lines plus `reload()`, per §11.2
- [ ] `grep -n "from 'vscode'" apps/kira-studio-vscode/src/proxyHandlers.ts` — empty
- [ ] `grep -rn "TODO\|FIXME" apps/kira-studio-vscode/src` — no new hits
- [ ] Tier 3's fourteen items handed to a human, unticked, with T3.2's fallback named

---

## 8. Sequencing

G15 sits after G14 and before G16 (stash), exactly where SPEC puts it. It depends on G11 (the `ranges`
parameter, the `reviewedRanges` projection, `review.db`'s partial state) and G12 (`editor.openRangeDiff`,
the `kira-version:` scheme, diffs opening natively) — both landed. It also, in practice, builds on G13
(`reviewAnchorFor` and the fourth virtual-key field) and G14 (`resolveVirtualUri`, and the `editor/title`
contribution pattern), neither of which SPEC lists as a dependency because neither existed when the row
was written. Nothing after G15 depends on it; G25–G27's review rounds cover it like everything else.

---

## 9. Explicit non-goals for G15

Restating §0.3 as commitments rather than scope notes: no Go change; no contract change and no
`CONTRACT_VERSION` bump; no `review.db` migration; no diff library and no hand-rolled differ; no
proposed API and no `--enable-proposed-api` requirement; no restoration of the in-webview `DiffView`
review adornment; no marking on commit diffs; no marking from the original pane; no automatic marking
of anything; no writing of the user's `diffEditor.codeLens` setting; no edit to `docs/v1.3/SPEC.md`.

---

## 10. Handed forward

- **Our hunk boundaries are not VS Code's** (F3), permanently, until `textEditorDiffInformation`
  stabilises. If it ever does, the change is local: swap D4's `body.hunks` for
  `TextEditor.diffInformation[].changes` and delete `hunkChangeBlock`. Worth re-checking at whichever
  future chapter bumps `engines.vscode`.
- **The `.vsix` cannot be a first-party extension** (F2). Every future phase that wants a first-party
  editor surface (a quick-diff provider, an SCM gutter, a multi-diff editor view) hits the same wall;
  this plan's §1 is the reference for what is and is not reachable.
- **A stale review tab currently just refuses** (D8). A future phase could offer "reopen at the new
  tip" as a one-click action on the stale tab's toolbar. Deliberately not built here: it needs a
  `review.files` result and a decision about closing the old tab, and neither is this phase's scope.
- **Opening the same file after a new commit leaves two tabs open** (F12) — different URIs, so VS Code
  cannot dedupe them. Pre-existing since G12; noticeable more often once users mark ranges and reopen
  more. A candidate for the next UX batch, not a G15 fix.
- **The `review.fileDiff` body is still shipped to the extension and mostly unused** — this phase reads
  `body.hunks` but never renders a patch. G12 §11.1 already flagged "should the server stop sending the
  body" as an open question; it is now *more* relevant, since two clients fetch it. Still a wire change,
  still not this phase's.

---

## 11. Calls that want a human eye

Three, following this repo's own convention (G12 §12, G14 §12). Each states the call, the options, and
what this plan does absent an answer.

### 11.1 SPEC's named model is proposed-API only — is "reproduce the affordance" the right reading?

**The call.** SPEC's G15 row says "Modeled on VS Code's own built-in Git extension's hunk-staging
gutter UI (the 'stage this hunk' buttons in its diff editor) — gutter decorations and/or per-hunk
CodeLens actions". F2 and F3 prove that the built-in extension's actual mechanism (the
`diffEditor/gutter/hunk` menu, and `TextEditor.diffInformation` for the hunks) is gated behind two
proposed API proposals that a sideloaded `.vsix` on stable VS Code cannot enable, and F4 proves that
the CodeLens half is invisible by default.

**What this plan does:** reads "modeled on" as *the affordance*, not *the mechanism*, and rebuilds it
from stable API — gutter decorations with a trusted-markdown hover carrying the commands, plus toolbar
and context-menu entries driven by the selection, plus an opt-in CodeLens (D1, D2, D3).

**Why it is flagged rather than just done:** it is a visible departure from the letter of SPEC's row,
and the result will not look identical to the built-in git gutter — the buttons live in a hover rather
than being always-visible clickable widgets. A reader expecting a pixel-match will notice. The
alternative readings are (a) ship it behind `--enable-proposed-api` and document the flag, rejected in
D1 as not-shipped; (b) drop the hunk affordance entirely and ship selection-based marking only, which
is smaller and fully exact but loses the "stage this hunk" shape SPEC explicitly asked for.

### 11.2 Keeping the review sidebar honest costs either a `packages/git-ui` change or a `CONTRACT_VERSION` bump — SPEC forbids both

**The call.** F10: an editor-side range mark leaves the sidebar's file list showing a stale
reviewed-state until an unrelated `repo.changed`. There is no way to fix that without crossing one of
SPEC's two fences (§0.3, and the G15 row's own wording).

| | Cost | Crosses |
|---|---|---|
| **A. This plan's D9** | `case 'refresh'` in `ReviewView.vue` + `reload()` on `ReviewFilesState` — 4 lines and a method, reusing an existing `UiActionKind` | "no `packages/git-ui`" |
| **B. G13's precedent** | a new `UiActionKind` member | "no `packages/git-ui`" **and** "no `CONTRACT_VERSION` bump" (21 → 22) |
| **C. Do nothing** | zero | nothing — the sidebar and the editor visibly disagree until the next repo change |

**What this plan does absent an answer:** takes **A**, and §4.10 marks that file as held pending this
answer so an implementer can drop it cleanly. If the answer is **C**, D9 is deleted, the extension
stops calling `runUiAction('refresh')`, the feature still works end to end, and T3.8 changes from
"confirm it updates" to "confirm the documented staleness". If the answer is **B**, note that a bump
makes every already-installed `.vsix` refuse to connect until both sides are reinstalled (SPEC §3.4),
which is the reason G12 §12.1 and G14 §12.1 both flagged their own bumps.

### 11.3 `commands.ts`'s `pending: 'G15' | 'G16'` labels are stale, and they name this phase

**The call.** F11: `commands.ts`'s `MutatingEntry` type and its doc comment say "G15 owns the five
stash kinds, G16 owns reset/cherryPick" — written by G13, before G14 and G15 were inserted into SPEC
on 2026-09-08. The current table has stash at G16 and reset/cherry-pick at G17, so the labels are off
by one and the wrong one is this phase's own number.

**Why it matters concretely:** an implementing subagent told "you are implementing G15" that reads
`stashPush: { pending: 'G15' }` could reasonably conclude this phase owns stash commands. It does not
(§0.3, §9).

**The options.** (a) Fix it here — retype the union to `'G16' | 'G17'` and update the comment;
mechanical, ~6 lines, inside `apps/kira-studio-vscode/src`, and it removes a real trap. It is,
however, unrelated to G15's own deliverable, and that file's comment explicitly says the assignment is
"this comment, not a fixed assignment, is the source of truth" — i.e. it expects a later phase to move
entries. (b) Leave it to G16, whose own plan has to touch that table anyway when stash lands.

**What this plan does absent an answer:** leaves it alone (option b) and does not touch `commands.ts`
beyond adding this phase's two `OTHER_COMMANDS` entries — scope left out is left out entirely. The
trap is neutralised in this document instead: §0.3 and §9 both say in as many words that G15 does not
own stash. Flagged because "fix the one-word label that names your own phase incorrectly" is a
defensible reading too, and picking silently either way would hide a real decision.
