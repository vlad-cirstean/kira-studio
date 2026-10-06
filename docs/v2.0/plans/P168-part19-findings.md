# P168 Part 19 findings: `git-ui` components

Plan: `P168-part19-git-ui-components.md`. Base `1e2b327`; plan commit `d9d3b35`; HEAD reviewed
`d9d3b35` (branch `p168-stream-b`). Reviewer reports only; fixes nothing.

Status: block 1 done.

## Checks (block 1, §1.1)

1. VS Code webview suite: `bun run build:vscode` (exit 0, bundle checks passed), then whole config
   `node node_modules/.bin/playwright test --config=apps/kira-space-vscode/playwright.config.ts`:
   **60 passed** (37 s; 12 interaction specs + 1 layout spec, every named spec included).
2. Space UI: `bun run build:test:space` (exit 0), then `--project=ui repo-workspace
   repo-graph-lifecycle ade-v2-review`: **30 passed** (34 s).
3. F1 lane-repaint probe (scratch spec, `fakeGraphHost` `branchOrder`, not committed): expand the
   collapsed group, toggle collapse off and on, fire `repo.changed` (auto-refresh). A
   `MutationObserver` saw rows with an empty graph SVG mid-rebuild (`blankSeen 1`), then every row
   repainted with lanes after each step. **Pass, verified.** Code path: every `plan` write sits in
   `#rebuildLayout`/`#resetLayout`; `#drainLayoutRebuilds` and `rebuildOrder` call listeners after
   each relayout, a superseded relayout's listener call is followed by the winner's, and
   `handleChunkLayout` calls `invalidateRowHeights()`, which in SlickGrid 5.20 sets
   `rowHeightsDirty` and calls `invalidate()` (full re-render, `slick.grid.ts:6392`).
4. F16 live-region probe (same harness, `ui.action` `revertSelected` with no selection, twice):
   region text log `"Select a commit first."` then `""` + `"Select a commit first."` at task 81 /
   frame 20 for both, then the same pair at task 154 / frame 39. **DOM half verified: clear and set
   land in one task and one frame, with no paint between.** Screen-reader half: see F2.

## Findings

### F1. Review view live region still drops a repeated identical message (F16 not applied there)

- Severity: medium. Code-read (`App.vue`'s fix verified in §1.1 item 4; `ReviewView.vue` has none).
- Where: `packages/git-ui/src/components/review/ReviewView.vue:753-760` (own `liveAnnouncement`,
  plain assignment), plus direct writes at `:127`, `:322`, `:417`, `:421`, `:771-783`;
  `packages/git-ui/src/state/review.ts:84` (`announcement` is a `shallowRef`, not
  `createAnnouncementRef`).
- Scenario: VS Code review sidebar, Space review sidebar or ADE review window. Run palette
  "Toggle file reviewed" with no file open twice: the second `'Open a file in the Files tab
  first.'` assigns the same string, Vue does not re-render, the screen reader stays silent. Same
  for copying a SHA twice (`ReviewSessionState.announcement` shallowRef: equal text does not even
  trigger the watcher) and for a repeated `reportAsyncError` text.
- Fix: move `announce()` out of `App.vue` into one own composable (e.g.
  `GU/components/useLiveRegion.ts`, carrying F2's fix) and use it in both `App.vue` and
  `ReviewView.vue` for every write. Switch `ReviewSessionState.announcement` to
  `createAnnouncementRef()` and watch it with `{ deep: true }`.
- `needs-other-part-file: packages/git-ui/src/state/review.ts (Part 18)`.

### F2. `announce()` clears and sets in one task, so a repeat may still not be spoken

- Severity: medium. DOM half verified (§1.1 item 4); screen-reader half code-read.
- Where: `packages/git-ui/src/App.vue:1036-1041`.
- Scenario: VS Code webview (Chromium). Fetch fails twice with the same text. `announce` writes
  `''`, then on `nextTick` the old text. Both writes land in the same task and frame. Chromium
  and WebKit batch accessibility-tree updates per lifecycle/frame, so the serialized text node
  goes from `X` to `X`: no net change, no live-region event. The F16 fix therefore relies on the
  intermediate empty string being observed, which nothing guarantees.
- Fix: make each announcement's DOM text differ in one write. Alternate a trailing ` ` on
  every call (or toggle between two sibling regions). Alternatively clear, then set after a short
  delay with VueUse `useTimeoutFn` (about 100 ms), cancelled on unmount. Put it in F1's shared
  composable.

### F3. `StashDialog` branch and save modes close after a failed op and lose the input

- Severity: low. Code-read.
- Where: `packages/git-ui/src/components/dialogs/StashDialog.vue:175-181` (`submitBranch`),
  `:220-225` (`submitSave`). Contrast `WorktreeDialog.vue:157-163`, which stays open on
  `!result.ok`.
- Scenario: Space graph tab. "Create branch from stash", type a name another surface created a
  moment ago (preflight raced), submit. `runStashBranch` resolves `{ ok: false }` (since Part 18
  `4b4b5a0` it also resolves on busy/no repo/transport rejection). The dialog emits
  `close-branch` anyway; the typed name is gone and a sighted user sees no failure (F4).
- Fix: `const result = await props.ops.runStashBranch(...); if (!result.ok) return;` before the
  emit, same for `runGlobalStashSave`, matching `WorktreeDialog`.

### F4. Op failures and an unrecoverable graph stream reach only an `sr-only` region

- Severity: medium. DESIGN-DECISION. Code-read.
- Where: `packages/git-ui/src/App.vue:1713-1722` (the only sink for `opsState.announcement`,
  `detailState.announcement`, `graphView.announcement`, `reportAsyncError`); no visible notice or
  toast exists in `GU` (`git grep -n toast packages/git-ui/src` hits only a comment). The graph's
  `onUnrecoverable` (`state/graphView.ts:547-549`) likewise only sets the announcement.
- Scenario: any host. Push rejected (`NonFastForward`), checkout refused, fetch auth failure, or a
  corrupted stream after one re-open: a sighted user sees the spinner stop and nothing else. The
  grid stays half-loaded with no error state and no retry hint (Refresh works, but nothing says
  so). VS Code shows no `showErrorMessage` for these either (`extension.ts` covers only repo open
  and connection).
- Decision needed: a visible failure surface for the graph mount (inline banner or toast, shared
  with the live region), and whether the graph needs an error state with retry for
  `onUnrecoverable`. No fix proposed.

## Candidate fates (§9)

- 1 (lanes blank after layout lands): dropped. Probe passed for expand, toggle and refresh;
  every `plan` path ends in a listener call (§1.1 item 3).
- 2 (`announce` TDZ): dropped. The three watches at `App.vue:528-542` are default `pre` flush and
  not `immediate`; no setup-time code calls `announce` or `reportAsyncError` synchronously, and
  `liveAnnouncement` is never written directly outside `announce`.
- 3: reported as F1.
- 4: reported as F3 (with F4 for the visibility half).
- 18 (comment over 100 columns, `searchResultsModel.ts:52-53`): held for grouping with a comment
  finding.

Block 1 other checks: `f1ce795` notice renders as plain text inside the results popover (not the
`role="alert"` error div, which only shows `search.error`); `unsupportedPattern` takes precedence
over `tailError`; no defect. `e3145b1`: a queued second click on an unreviewed box computes the
same `reviewed: true` from server state and is dropped as an identical repeat, so the box ends
checked, which matches what the user saw (box still unchecked) when clicking again; no defect.
`7d42bde`: `collapsedMessageText` falls back to branch-less wording when `labelFor` returns
`undefined` for the `other` group; no defect. `ebe3c02`: construction order holds (`searchState`
after `createRepoStates`), `RepoSettingsDialog` gets the same `repoSettingsState` `opsState`
holds; dispose checked in block 2.

## Coverage

- Block 1: done (four own-file commits, §6.1 consumers, §1.1 items 1-4).
- Blocks 2-8: not reached yet.
