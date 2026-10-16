# P129 Part 6 — detail panel

Plan for `docs/v2.0/SPEC.md`'s `P129 Part 6` row. Planned against `v1.9` at `eda05ab1` (P129 Part 5
result landed).

Binding inputs: Part 1 plan §0/§2.1/§2.2 (`docs/v2.0/plans/P129-part1-ade-agent-runtime.md`), Part 2
plan (`…/P129-part2-ade-queue-backend.md`: §11 `SetBranchMeta` kind rule, §12 `RepoPrs`, `BindNewWork`,
review writes notes only), Part 3 plan (`…/P129-part3-ade-data-layer.md`: §0.10 first-consumer rule),
Part 4 plan (`…/P129-part4-ade-dialogs.md`: openers, `resumeSpec`), Part 5 plan
(`…/P129-part5-ade-timeline-dnd.md`: §0.2 bound count, §0.6 selection, §0.11 confirm, §0.16 force
push, §0.18 agents-pill hand-off, §0.19 `parseJira`, §0.20 `ago.ts`), the Part 3/4/5 result
sections in `docs/v2.0/SPEC.md`, P132 Part 1 plan §0.1 (reka nesting hazards), design
`docs/v2.0/design/SPEC.md` §2.4, §3, §4, §7, §8, and `mockup.html`: panel markup 275-448, resize
handle 275 and drag 1766, selected-panel logic 1380-1653 (actions 1406-1440, link rows 1420-1440,
estimate 1449-1452, notes/link field 1560-1625, Agents 1630-1653).

Every path, symbol and count below was measured in this container at `eda05ab1`:
`codegraph_explore` for symbols, call graphs and blast radius (`useQueue` internals, `QueueView`/
`QueueItem`/`QueueInput`, `buildItems`/`workStatus`/`branchStatusOf`/`segmentTagAndAction`/
`buildCells`, `dialogCompose` openers and `DialogCtx`, `adeActions`/`adeUi` stores, `launch.ts`
`deliver`/`LaunchDeps`, `mutations.ts`/`queries.ts`, Space `bridge/index.ts`, `AdeService`'s
`SetBranchMeta`/`BindNewWork`/`UpdateNewWork` wire structs and validators, `Queue.Prs`/
`BindNewWork`, `gitsession` `PrBrowserURL`/`githubRepo`, `createTerminalsStore`,
`useTerminalMount`, `terminalRenderer`/`tabRuntime`, `TerminalHostView`, `useTerminalModule`,
`AdeRepoView`/`AdeView`/`AdeTimeline`/`AdeDayBand`/`AdeStackBlock`/`AdeStackRow`/`AdeAgentsPill`/
`AdeActivityGlyph`, `activity.ts`, `jira.ts`, `ago.ts`, settings `ade.panelWidth`,
`WorkbenchShell` topology), then `Read` for exact lines (mockup, `ade.go` 555-860, `queue.go`
95-110/700-760/1077-1131, `gh.go` 275-310/479-488, `adequeue.go` `Rebind`, `ghclient/pr.go`,
`workbench/util/clipboard.ts`), plus npm tarballs of `tiptap-markdown@0.9.0` and the `@tiptap/*`
3.31.3 packages (`package.json` peers, licences, `dist`).

---

## 0. What the SPEC row left open, and resolutions

Standing user decisions (Part 1 §0), not reopened:
- Claude Code icon is the generic `robot` codicon, never the branded asset.
- No Jira sync: stored key plus pasted URL, nothing fetched, no status chip, no `syncing`.
- No `ready`, no `ciFailing`, no Merge action anywhere.
- PR is `ResolveBranchPr`'s raw state plus title; no `Approved`/`Changes requested`.
- Resume fallback for a gone worktree, and cross-window Open for a session running in another
  window, are Part 7's (its SPEC row names both).
- Design wins over mockup; mockup wins for markup structure, data flow and interaction detail the
  design leaves implicit; tone tints and the 20-colour palette stay literal values.
- No `@kira/git-ui` or `kira-ui` import in `ade/`.

Carried from Part 5, unchanged: §0.6 selection lives in `adeUi.selectedByRepo` with `useQueue`'s
first-item default; §0.11 one shared `AdeConfirmDialog`; §0.16 `adeActions.forcePush` with the
protected-branch confirm; §0.19 `parseJira`; §0.20 `adeAgoOptions`.

1. **No split.** Panel shell, header, Details, Changes and Agents all read one new `QueueView.panel`
   (§0.4) and all edit the same files: `AdeRepoView.vue`, `adeUi.ts`, `useQueue.ts`, `wire.ts`,
   `bridge/index.ts`, `mutations.ts`. The Go change (§0.8, §0.12) is two small edits the Details
   links consume. Splitting (say, shell plus header plus Changes as Part 1, Details plus Agents as
   Part 2) would give both parts the same `useQueue` panel builder, the same `adeUi` panel state and
   the same `AdeDetailPanel` tab host — shared files and an ordering dependency, the P110 iter2
   rejection pattern. Commits stay granular (§4); one Sonnet implementer runs it sequentially.

2. **Resize handle: hand-rolled on VueUse, not shadcn `ResizablePanelGroup`.** Named requirements
   shadcn/reka can't meet here:
   - The ade module renders inside `WorkbenchShell`'s outer horizontal `ResizablePanelGroup`'s main
     panel. A second group nested there is a topology P132 Part 1 §0.1 records as unproven
     (outer-vertical nesting hung the render process, never root-caused).
   - The panel's minimum is 340 **px** and its width persists in px (`ade.panelWidth`). reka's
     `sizeUnit="px"` re-runs `recalculateLayoutForPixelPanels` on every container ResizeObserver
     tick (P132 §0.1); the Agents tab's xterm fits on its own ResizeObserver, the same feedback
     shape that hung SlickGrid.
   - P132 Part 1 chose VueUse `useDraggable` for the same reason (`DockResizeHandle.vue`, not yet
     implemented, so nothing to reuse).
   New `AdePanelResizeHandle.vue`: 6 px strip, `role="separator"`, `aria-orientation="vertical"`,
   `aria-label="Resize panel"` (mockup 275), `aria-valuenow`/`aria-valuemin`/`aria-valuemax`,
   `tabindex="0"`. VueUse `useDraggable` (`axis: 'x'`, `preventDefault: true`; `onStart` records
   start width and pointer x; `onMove` sets a local `dragWidth` ref; `onEnd` persists). ArrowLeft/
   ArrowRight widen/narrow by 16 px, persisted through a VueUse `useDebounceFn` (400 ms).
   - Width source: `settingsStore.ade.panelWidth`; `0` means half of `AdeRepoView`'s root width
     (VueUse `useElementSize`), the design's "default half width".
   - Clamp: `[340, max(340, rootWidth − 340)]` (Go's `ValidAdePanelWidth` caps stored values at
     340..4000; the render clamp keeps the timeline at least 340 px).
   - Persist: `settingsStore.patchSettings({ ade: { panelWidth: Math.round(w) } })` on drag end.
     `dragWidth` renders during the drag and clears after the patch resolves.
   - No selected item (empty repo) hides both handle and panel.

3. **`AdeRepoView` layout.** The root becomes a flex row. The existing `scrollEl` column (header,
   timeline, dialogs) stays the scroll owner, unchanged apart from `min-w-0 flex-1`; then the
   handle; then `<AdeDetailPanel>` as an `<aside>` sibling (mockup: the panel is `<aside>` beside
   `<main>`, the project header inside `<main>`). The panel scrolls its own tab bodies.

4. **`QueueView.panel` (pure, in `useQueue.ts`).** The selected item's panel facts, built from
   internals the module already holds (`Item`, `conflicts`, `after`, `mergeN`, `eff` days,
   calendar, `ripple`, `sessions`). `null` when nothing is selected. Shape in §2.3. Real
   `AdeBranch.worktree` replaces the mockup's `~/wt/…`. Parity against the mockup's own
   `renderVals().sel` via `runMockup` (§3.2), with the §0.5-§0.7 deviations projected out and
   covered by rules tests instead.

5. **Header actions, in mockup order, design where the two differ.**
   1. merged → `Archive`, primary purple, first.
   2. Stack has unpushed branches → `Force push`, with ` (N)` when N > 1 (mockup 1410), or
      `Pushing…` disabled while `pushing` is non-empty. Tip
      `git push --force-with-lease for: <names>`. Calls `adeActions.forcePush(repo, ids)`.
   3. `!merged`, selected is mine, root is mine, root behind main → `Rebase onto main`
      (`Rebasing…` disabled while the root is in `rebasing`) → `rebaseSpec(ctx, [root], 'main',
      'Rebase onto main')`.
   4. Selected segment has `after`, lead root is mine, root not behind main →
      `Rebase onto <short(after)>` → `rebaseSpec(ctx, [root], after, 'Rebase onto <name>')`.
   5. `Rebase stack` (§0.6).
   6. Selected is mine with a conflict → `Queue after <short(with)>` (red) →
      `specForQueueAction(ctx, {kind: 'queueAfter', targetIds: [root, with]})`.
   7. `▶ Start agent` (§0.7).
   8. Secondary `Archive` when `kind !== 'mine' || !merged`; merged drops duplicate Archives after
      index 0 (mockup). Archive calls `adeActions.requestArchive(repo, id, ctx)`, tooltip is the
      design's text verbatim (`useQueue`'s `ARCHIVE_TIP`, exported for this consumer).
   - No Merge (standing decision).

6. **`Rebase stack` (flagged interpretation).** The design lists it (header actions, and §4's
   Claude-performed actions); the mockup has no such button. `AdeBranch.behind` is measured against
   the parent's tip for a stacked branch (`queue.go` 741-756). So: shown when the selected item is
   mine, not merged, not a draft, has a parent, `behind > 0`, the stack root is mine (design §3:
   never offered on someone else's root), and the root is not behind main (`Rebase onto main`
   already restacks everything then). Opens `rebaseSpec(ctx, [selected], parent, 'Rebase stack')`:
   rebases the selected branch onto its parent and restacks its descendants, busy check over
   `stackIds(selected)`. Placed after the Rebase-onto actions, before Queue after (design order).

7. **`▶ Start agent`: new work only (design wins).** Design: "`▶ Start agent` (new work only)".
   The mockup shows it for any mine item with no sessions; Part 5's action-column `▶ Start` keeps
   the mockup rule there. In the panel, an existing branch with no sessions starts one from the
   Agents tab's `+` (§0.18), so nothing becomes unreachable. Opens `startSpec(ctx, id)`. Styled
   Claude accent `#d97757` background, `#1a0f0a` text (mockup, literal).

8. **Branch link needs a repo web URL (Go, new).** The design's Branch ref "links to the branch on
   GitHub (`/tree/<branch>`)"; no web URL reaches the renderer today. Add
   `(*RepoEntry).RepoWebURL(ctx) (string, bool)` in `gitsession/gh.go` beside `PrBrowserURL`, same
   gates (`githubEnabled`, `githubRepo`), returning `https://<host>/<repo.Path()>`. `RepoPrs` gains
   `WebURL string` set before the zero-branch early return in `Queue.Prs`; wire
   `AdeRepoPrs.webUrl`, normalized to `''`. The renderer builds
   `${webUrl}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`. No GitHub remote, or
   GitHub disabled in repo settings, renders the ref unlinked. No new Go test: a one-line format
   mirroring `PrBrowserURL`; an existing `Prs` test assertion gains `WebURL` if one covers `Prs`.

9. **All links: real `<a>`, opened by the OS.** `<a :href target="_blank" rel="noopener">`, so
   right-click copy works (design). Left click is prevented and routed through
   `control.linkOpenExternal(url)` (Wails `LinkService.OpenExternal`, validates http(s)); the same
   path serves Ctrl/Cmd+click in notes. ⧉ copies the URL via `@workbench/util/clipboard`'s
   `copyOrReportError` (not VueUse `useClipboard`: that file records why, a swallowed rejection),
   ✓ for 1.2 s via VueUse `useTimeoutFn`. A ref with no URL (bare Jira key, no GitHub remote)
   copies the ref text.

10. **Jira row.** Paste input (dashed, placeholder `paste Jira link`) plus Save. `parseJira(input)`:
    no key found → inline `No Jira key found` and nothing saved; else store `{key, url}` (URL only
    when the input was an http(s) URL). Linked ref when `url` is set, plain text otherwise. No
    status chip. ✎ turns the row back into the input pre-filled with the URL (or key); saving an
    empty value clears both. New work: clearing the key while the title is empty is refused inline
    (`Give it a name or a Jira key`), matching Go's `title || jiraKey` rule.

11. **PR row (branch items only).** New pure `links.ts`: `parsePr(input) → {url, number} | null`
    (http(s) URL containing `/pull/(\d+)`, Go's own `validateAdePrURL` rule); `prRow(resolved,
    pasted)`:
    - `resolved = prs.branches[branch]`, `pasted = AdeBranch.prUrl`.
    - Link = `pasted || resolved.url`; number = `parsePr(pasted)?.number ?? resolved.number`.
    - Chip (raw state, capitalized, mockup tones: draft grey, open green, merged purple, closed
      grey) and title show only when `resolved` exists and either nothing was pasted or the numbers
      match. A pasted PR that isn't the branch's resolved one shows as a bare `#N` link.
    - Invalid paste → inline `Paste a GitHub PR link (…/pull/123)`, nothing saved.
    - New work has no PR row: it has no branch, and `AdeNewWorkPatchArgs` has no PR field.
    - Review items: read-only rows, `—` when neither source exists (mockup `showLink: has || (ro &&
      !lk)`).

12. **Writes.** New composable `useItemMeta(codeRepoId, panel)` routes a patch:
    - Branch item → `SetBranchMeta` (first caller; binds `adeSetBranchMeta`, new
      `useAdeSetBranchMeta` invalidating the snapshot). Review items send `notes` only (Go refuses
      the rest; the UI hides those inputs).
    - New work → `UpdateNewWork` (`title`, `jira`, `startFrom`, `est`, `notes`). Widen the TS
      `AdeUpdateNewWorkArgs.patch` to Go's `AdeNewWorkPatchArgs`.
    - Name: mine and parked get an input (placeholder = default title); review shows the title as
      text (mockup `mineOnly`/`isReview`). Commits on blur or Enter, Esc reverts; never per
      keystroke. Branch → `name` (empty clears the override); new work → `title`.
    - Estimate: `type=number min=0 step=0.5` plus a shadcn `ToggleGroup` `hours | days`. Writes
      `${num}${unit}` on `change`; empty writes `''`. Switching the toggle keeps the number. A value
      failing Go's `^\d+(\.\d+)?[hd]$` shows inline and isn't sent. Hint `spans N days` from
      `panel.estimate.days > 1`. Hidden for review items (mockup `mineOnly`).
    - Each field shows its own write error inline.

13. **Go: `UpdateNewWork` accepts `startFrom: ''` (small fix).** The `from` select (§0.14) must be
    able to switch back to main. `AddNewWork` stores `''` for main, but `AdeNewWorkPatchArgs`
    runs `validateAdeBranchName` on any non-nil `StartFrom`, which rejects `''`. Validate only a
    non-empty value, matching `AdeAddNewWorkArgs.Validate`. The existing validator test (if any)
    gains the `''` case; otherwise none.

14. **New-work Branch row.** Status chip `not created` · `from` shadcn `NativeSelect` (options:
    `main` = `''`, then every non-draft, non-parked, non-descendant item by branch name; branch item
    ids are branch names, `queue.go` 714) · `branch created on Start`. Tip `Claude creates the
    branch when you start`. Header mono line reads `no branch yet · <day> #<pos>` (design wins over
    the mockup's `<pos> · no branch yet`).

15. **Candidate picker.** New work whose `branchCandidates.length > 1` shows, in place of the
    `from` select, an amber `Pick the branch Claude created` `NativeSelect` plus `Use branch`
    button. It calls `adeBindNewWork({codeRepoId, id, branch})` (first caller; new `useAdeBindNewWork`
    invalidating snapshot and sessions). On success, select the new branch item
    (`adeUi.select(repo, branch)`: the branch is its own item id). Error inline.

16. **Notes: TipTap v3 with `@tiptap/markdown`, not `tiptap-markdown` (deviation from Part 1 §2.2's
    preference, with a named requirement).** Part 1 preferred `tiptap-markdown` if it supports the
    installed TipTap major; 0.9.0's peer is `@tiptap/core ^3.0.1`, so it does. It still fails a
    real requirement: the SPEC's acceptance needs a Markdown round-trip for every listed construct,
    and `bun test` (the repo's only unit runner; no `happy-dom`/`jsdom` installed) has no DOM.
    `tiptap-markdown` parses Markdown to HTML with `markdown-it`, then through
    `new window.DOMParser()` (`dist/tiptap-markdown.es.js` 209) and an editor instance's schema
    (938). TipTap's own `@tiptap/markdown` 3.31.3 parses Markdown to ProseMirror JSON through
    `marked` with no DOM (DOM only for inline HTML, guarded on `window`), and exposes a headless
    `MarkdownManager({extensions}).parse/serialize`. It is also first-party, versioned in lockstep
    with the editor, and doesn't bring a second `markdown-it` (14) beside the repo's 15.0.2.
    Packages, all MIT (core only, no Pro extension), pinned exact (`bunfig.toml` `exact = true`),
    3.31.3: `@tiptap/core`, `@tiptap/vue-3`, `@tiptap/starter-kit`, `@tiptap/extension-list`
    (`TaskList`, `TaskItem`; `renderMarkdown` writes `- [ ] `/`- [x] `), `@tiptap/extensions`
    (`Placeholder`), `@tiptap/markdown`. Peers `@tiptap/pm` and `@floating-ui/dom` come through
    bun's peer install; list one in `package.json` only if the code imports it or bun reports it
    unmet (then with a knip `ignoreDependencies` entry and its reason).
    - One `notesExtensions()` factory in `ade/notesExtensions.ts`, shared by the editor and the test:
      `StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } })`
      (underline has no Markdown form), `TaskList`, `TaskItem.configure({ nested: true })`,
      `Placeholder.configure({ placeholder: 'Write notes…' })`, `Markdown`.
    - Heading levels stay default so any stored level round-trips; the toolbar toggles level 2
      (`##`).
    - Toolbar (mockup order): Bold `B`, Italic `I`, Code `</>`, Heading `H`, Bulleted list `•`,
      Numbered list `1.`, Checklist `☐`, Link `🔗` (codicons where the theme has them, else the
      mockup text). Buttons `@mousedown.prevent` (don't steal focus). Checklist toggles the current
      list to a task list and back (`toggleTaskList`).
    - Link field: inline shadcn `Input` in the toolbar, placeholder `https://`, Enter applies, Esc
      closes, `Add` button. Non-http(s) closes without applying (mockup 1572). Links the selection
      (`setLink`) or inserts the URL as linked text when the selection is empty.
    - Done task items struck through; Ctrl/Cmd+click on a link opens it (§0.9) via
      `editorProps.handleClick`. Standard Ctrl/Cmd+B/I from StarterKit.
    - Load: `contentType: 'markdown'`; save: `editor.getMarkdown()` from `onUpdate` only (user
      edits), so loading never writes. Writes debounce 600 ms (VueUse `useDebounceFn`) and flush on
      blur, item change and unmount.
    - Refetch safety: incoming `notes` re-sets content (`emitUpdate: false`) only when the item id
      changed, or the value differs from the last Markdown this editor emitted and the editor isn't
      focused.
    - Editable for review items (design).

17. **Changes tab** (design order, mockup text): `Base` `<parent name | main> · ↑ahead ↓behind`;
    `Worktree` `created on Start` for a draft, else `[read-only · ]<path>[ · N uncommitted]` (amber
    when dirty); `On merge` `—` for non-mine, `rebase a, b` (amber) or `nothing to rebase` (from
    `view.ripple`); `Conflicts` `<with> · <file basenames>` per entry; `Shares` `<after> · <file>`;
    uncommitted list (`M` amber, else green); commits `sha message`; files with conflicting paths
    red (`#f28b7d` on `#2a1917`). Rows with nothing to show are omitted, as in the mockup.

18. **Agents tab.**
    - Terminal tabs: one per running session, startedAt order (stable while activity changes),
      `AdeActivityGlyph` (12 px) plus `claude <id8>` (`sessionLabel`). Active tab shadow
      `inset 0 2px 0 #d97757`. `+` opens `startSpec(ctx, id)` (an existing branch gets its running
      session preselected, else `new`; a draft gets Start new work).
    - Status strip: `AdeActivityGlyph` at a new 14 px size (mockup) · `ACTIVITY_LABEL[kind]` ·
      `formatTimeAgo(lastActiveAt, adeAgoOptions)`; amber tint `rgba(232,163,61,0.08)` for `input`.
    - Terminal: `TerminalHostView` from `@workbench/terminal/TerminalHostView.vue` with `deps =
      useTerminalModule().host`, `tab = {id: terminalId, state: {codeRepoId, cwd: session.cwd,
      command: '', launchKind: 'claude-code'}}`, `:key="terminalId"` (the view reads `tab.id` once at
      setup). Mounted only when `terminalsStore.terminalSession(terminalId)` exists, i.e. this
      window launched it. Otherwise `useTerminalMount` would open a fresh plain shell under that id.
      Else a muted line `Running in another window.` (cross-window Open is Part 7's).
    - Input: shadcn `Input` plus `Send` under the terminal; Enter sends
      `adeSend({sessionId: session.id, message})`, which is window-independent (Go writes to the
      PTY). Disabled while sending; error inline; cleared on success.
    - Stopped list: `claude <id8> · <ago> · Resume` → `adeUi.openDialog(resumeSpec(ctx, id,
      session.id))`, the first UI caller of `resumeSpec`. `No running agents.` when none run.
    - Tab choice per item in `adeUi` (§0.20); falls back to the first running session.

19. **Reaping this window's stopped ade terminals (new `state/adeTerminals.ts`).** Part 6 is the
    first to mount an xterm for an ade terminal; nothing closes one today (`ade/` never calls
    `closeTerminalSession`/`cleanupTabRuntime`), so every stopped session would keep its
    `byTabId` entry, drain queue and xterm instance for the app's life. One Pinia store, one
    concern (ade-launched terminals in this window):
    - `track(terminalId)`, called from `adeActions.buildLaunchDeps().openTerminalSession`.
    - A store-scoped `watch` over `useAdeSessions()` data plus the tracked ids' local statuses:
      each tracked id that is no running session's `terminalId` and whose local entry is `exited`/
      `failed` or gone → `terminalsStore.closeTerminalSession(id)`,
      `cleanupTabRuntime(id)` (`@workbench/state/tabRuntime`), untrack. Go `Close` on an exited id
      is an idempotent no-op.
    - Same injection pattern `adeActions` already relies on for TanStack composables in a store.

20. **`adeUi` additions.** `panelTab: 'details' | 'changes' | 'agents'` (one, like the mockup's
    `state.tab`), `agentTabByItem: Record<string, string>` keyed `${repo}:${item}` → session record
    id, `setPanelTab`, `setAgentTab`, `openSession(repo, item, sessionId)` (select + `agents` tab +
    that session's tab). Still one concern: the module's runtime UI state.

21. **Activity-icon hand-off (Part 5 §0.18).** `AdeAgentsPill` emits `openSession: [itemId,
    sessionId]` instead of `select`, threaded `AdeStackRow` → `AdeStackBlock` → `AdeDayBand` →
    `AdeTimeline` → `AdeRepoView`, whose handler calls `adeUi.openSession`. Vue's `$event` carries
    only the first argument, so each hop re-emits both explicitly. The pill's header comment drops
    "Part 6's".

22. **Tabs and header chrome.** shadcn `Tabs` (as `AdeRepoTabs`), 34 px, active bottom border
    `#e8a33d`, `Agents` with a count pill (`rgba(217,119,87,0.18)`/`#e8a07f` when > 0, else
    `#23252b`/`#9a9ca5`). Header: colour square, work status chip (`item.status`), title
    (truncates), mono line (`pos · branch`; `merged`; `<owner> · review`; `<day> · not merging`;
    §0.14's new-work form). Review banner: codicon `lock` plus `<owner>’s work. Read-only here: you
    can run agents on it and keep your own notes.` Tone literals move from `AdeStackBlock.vue`'s
    local `TONE` into `ade/tones.ts`, shared by both.

23. **Bound count 17 → 19 of 19.** `adeSetBranchMeta`, `adeBindNewWork`, each with its first
    caller in this phase.

---

## 1. Confirmed current state (`eda05ab1`)

- `AdeRepoView.vue` (431 lines): root is the `scrollEl` column (`flex min-h-0 flex-1 flex-col
  overflow-auto`) holding header, timeline, `AdeClaudeDialog`, `AdeConfirmDialog`. No panel.
  `onSelect(id)` → `adeUi.select`. `dialogCtx` = `{view, snapshot, sessions, today, repoRoot}`.
- `adeUi.ts`: `activeRepoId`, `refreshNote`, `dialog`, `selectedByRepo`, `confirm`. No panel tab.
- `useQueue.ts`: `QueueView` has `selectedId`, `ripple`, `atRisk`, `parentOf`, `kids`; no panel.
  `QueueItem` carries `status`, `branchStatus`, `estimate`, `agents`, `owner`; `ARCHIVE_TIP`
  (line 1172) is module-private. `workStatus`/`branchStatusOf` (914-963) match design §2.4's rungs.
- `bridge/index.ts`: 17 of 19 `AdeService` members bound; generated `AdeSetBranchMetaArgs`
  (`bindings/.../bridge/models.ts` 320) and `AdeBindNewWorkArgs` (43) exist, unbound.
  `linkOpenExternal` bound.
- `wire.ts`: `AdeUpdateNewWorkArgs.patch` is `{branchName?}` only; `AdeRepoPrs {kind, branches}`;
  `AdePr {number, title, url, state}`; no branch-meta or bind args types.
- Go: `AdeBranchMetaPatchArgs {Name, Kind, Jira, PrURL, Est, Notes}`; `AdeNewWorkPatchArgs.StartFrom`
  rejects `''` (`validateAdeBranchName`); `Queue.Prs` early-returns for zero branches
  (`queue.go` 1107); branch item `ID = b.Branch` (714); `ahead`/`behind` against the parent tip
  (741-756); `Rebind` moves new work into `ade_branches` keyed by branch. PR `State` is
  `open|draft|merged|closed` (`ghclient/pr.go` 17). `PrBrowserURL` (`gh.go` 479) is the web-URL
  pattern.
- Settings: `ade.panelWidth` default `0`, valid `0` or 340..4000 (`settingsDomain.ts` 91,
  `model/settings.go` 60).
- Terminals: `createTerminalsStore` `openTerminalSession` never throws; `closeTerminalSession`
  no-ops for unknown ids; one xterm per tab id in `terminalRenderer`, freed only by
  `cleanupTabRuntime`. `TerminalHostView` props `{tab: {id, state}, deps}`, reads `tab.id` at
  setup. `useTerminalMount` opens a session when `terminalSession(tabId)` is undefined.
  `launch.ts` `deliver` opens `launch.terminalId` with `launchKind 'claude-code'`. Nothing in
  `ade/` closes a terminal.
- `AdeAgentsPill` emits `select` only (header comment defers the terminal open to Part 6); each hop
  up to `AdeRepoView` emits `select: [id]`.
- `resumeSpec` (`dialogCompose.ts` 310) has test callers only.
- `AdeActivityGlyph` sizes `12 | 13`.
- No `@tiptap/*`; `markdown-it` 15.0.2 present; no `happy-dom`/`jsdom`.
- `tests/unit/support/mockupOracle.ts` `runMockup` returns the full `renderVals()`, `sel` included.
- `docs/ARCHITECTURE.md` 2672-2678: Part 4 paragraph says `resumeSpec` is unwired and the
  activity-icon terminal is Part 6's.

---

## 2. Design

### 2.1 Module shape (`apps/kira-space/frontend/src/ade/`)

| Module | Kind | Owns |
|---|---|---|
| `useQueue.ts` | pure (edited) | `QueueView.panel` (§0.4-§0.7, §0.17), exported `ARCHIVE_TIP` |
| `links.ts` | pure (new) | `parsePr`, `prRow`, `branchWebUrl` (§0.8, §0.11) |
| `tones.ts` | tiny (new) | tone literals, moved from `AdeStackBlock.vue` |
| `notesExtensions.ts` | tiny (new) | §0.16 extension factory |
| `useItemMeta.ts` | composable (new) | §0.12 write routing and per-field errors |
| `state/adeUi.ts` | Pinia (edited) | §0.20 |
| `state/adeTerminals.ts` | Pinia (new) | §0.19 |
| `state/adeActions.ts` | Pinia (edited) | `track` call in `buildLaunchDeps` |

### 2.2 Go (`apps/kira-space/internal/`)

- `gitsession/gh.go`: `RepoWebURL(ctx) (string, bool)` (§0.8).
- `ade/queue.go`: `RepoPrs.WebURL`; `Prs` sets it first (before the zero-branch return).
- `bridge/ade.go`: wire `webUrl`; `AdeNewWorkPatchArgs.validate` skips `''` `StartFrom` (§0.13).
- Regenerate bindings (`wails3 task common:generate:bindings`, `docs/DEV_ENVIRONMENT.md`).

### 2.3 Bridge, wire, TanStack

`bridge/index.ts`: `adeSetBranchMeta(args: AdeSetBranchMetaArgs) → void`,
`adeBindNewWork(args: AdeBindNewWorkArgs) → void`; `normalizeAdeRepoPrs` defaults `webUrl` to `''`.

`wire.ts`: `AdeRepoPrs.webUrl: string`; `AdeJiraPatch {key?, url?}`;
`AdeNewWorkPatch {title?, jira?, startFrom?, notes?, est?, branchName?}` (widens
`AdeUpdateNewWorkArgs.patch`); `AdeBranchMetaPatch {name?, jira?, prUrl?, est?, notes?}` (no `kind`:
nothing in Part 6 changes it); `AdeSetBranchMetaArgs {codeRepoId, branch, patch}`;
`AdeBindNewWorkArgs {codeRepoId, id, branch}`. Field names from `ade.go` json tags; generated
`models.ts` cross-checks.

`mutations.ts`: `useAdeSetBranchMeta(repo)` (invalidates snapshot); `useAdeBindNewWork(repo)`
(invalidates snapshot and sessions). `useAdeUpdateNewWork` unchanged.

`QueueView.panel` (`QueuePanel | null`):
```
id, kind, draft, merged, readOnly (kind === 'review'), title, defaultTitle, nameValue,
color, status, branchStatus, owner, mono,
actions: {kind: 'forcePush'|'rebaseMain'|'rebaseAfter'|'rebaseStack'|'queueAfter'|'start'|'archive',
          label, tone: 'primary'|'purple'|'red'|'claude'|'secondary', disabled, tip, targetIds}[],
branch: {ref, from: string | null, fromOptions: {value, label}[] | null},
jira: {key, url}, prUrl, estimate: {num, unit: 'h'|'d', days},
changes: {base, ahead, behind, worktree, dirtyCount, rippleText, rippleTone,
          conflicts: {with, files}[], shared: {with, file} | null,
          dirty: {code, path}[], commits: {sha, message}[],
          files: {path, added, deleted, binary, conflict}[]},
running: {id, claudeSessionId, terminalId, cwd, kind, lastActiveAt}[],
stopped: {id, claudeSessionId, lastActiveAt}[],
candidates: string[]
```
`links.ts` resolves the PR row and branch URL in the component from `panel` plus `prs` (keeps
`useQueue`'s PR input use unchanged: work status never reads PRs).

### 2.4 Components (`<script setup lang="ts">`, Tailwind only, no `<style>`)

| Component | New/edited | Role |
|---|---|---|
| `AdeRepoView.vue` | edited | flex-row root (§0.3), `useElementSize` root width, handle plus panel, `onOpenSession` |
| `AdePanelResizeHandle.vue` | new | §0.2 |
| `AdeDetailPanel.vue` | new | `<aside>`, header, review banner, `Tabs` host |
| `AdePanelHeader.vue` | new | §0.5, §0.22 header; actions dispatch to `adeUi.openDialog`/`adeActions` |
| `AdeDetailsTab.vue` | new | name, link rows, estimate, notes editor (fills the rest) |
| `AdeLinkRow.vue` | new | one Branch/Jira/PR row: chip, `<a>`, title, ⧉, ✎, dashed input, `from`/picker slot |
| `AdeCandidatePicker.vue` | new | §0.15 |
| `AdeEstimateField.vue` | new | §0.12 estimate |
| `AdeNotesEditor.vue` | new | §0.16, `EditorContent` from `@tiptap/vue-3`, toolbar, link field |
| `AdeChangesTab.vue` | new | §0.17 |
| `AdeAgentsTab.vue` | new | §0.18 |
| `AdeActivityGlyph.vue` | edited | `size` gains `14` |
| `AdeAgentsPill.vue`, `AdeStackRow.vue`, `AdeStackBlock.vue`, `AdeDayBand.vue`, `AdeTimeline.vue` | edited | §0.21 `openSession` emit |
| `AdeStackBlock.vue` | edited | imports `tones.ts` |

Test ids: `ade-panel`, `ade-panel-handle`, `ade-panel-action-<kind>`, `ade-panel-tab-<tab>`,
`ade-name`, `ade-link-<branch|jira|pr>`, `ade-link-input-<jira|pr>`, `ade-est`,
`ade-est-unit`, `ade-notes`, `ade-notes-tool-<name>`, `ade-changes-<row>`,
`ade-agent-tab-<sessionId>`, `ade-agent-input`, `ade-agent-stopped-<sessionId>`,
`ade-candidate-picker`, `ade-review-banner`.

---

## 3. Tests (per CLAUDE.md's bar)

### 3.1 `apps/kira-space/tests/unit/ade-notes-markdown.spec.ts` (new)

A parser/serializer with interacting rules, and the SPEC's own acceptance. Headless:
`new MarkdownManager({ extensions: notesExtensions() })`, `parse(md)`, schema check through
`getSchema(resolveExtensions(...)).nodeFromJSON(json)` (from `@tiptap/core`), `serialize(json)`,
compare to the canonical input. One case per construct, then combinations:
`## heading`; `- a` list; `1. a` list; `- [ ] a` / `- [x] b`; `**bold**`; `*italic*`;
`` `code` ``; `[text](https://x.test/a)`; nested marks inside a task item
(`- [ ] **a** *b* [l](https://x.test)`); mixed document (the mockup's own `billing` note, line
573). Also: a checklist toggled via JSON (`checked: true`) serializes `- [x]`; parse is idempotent
(`serialize(parse(serialize(parse(md)))) === serialize(parse(md))`).

### 3.2 `apps/kira-space/tests/unit/ade-queue-parity.spec.ts` (extended)

Panel parity against `runMockup(...).sel` on the existing scenarios, selecting in turn: a mine
root behind main (`auth`), a stacked child (`authui`), a conflicting mine branch, a review branch
(`sara`), a merged branch, a parked branch (`spike`), a draft (`d_csv`), an item with an `after`.
Projected fields: mono facts, action labels in order with Merge, mockup Start and Rebase stack
filtered out, changes rows (base, ahead/behind, ripple text, conflicts, shared, dirty, commits,
conflicting-file flags), estimate `num`/`unit`, running and stopped session ids. Worktree text
compared with the path substituted.

### 3.3 `apps/kira-space/tests/unit/ade-queue-rules.spec.ts` (extended)

The deviations parity can't pin: `Rebase stack` shown/hidden across its six conditions; `Start
agent` only on drafts; new-work mono line order; `Force push` suffix at N = 1 vs 2. `prRow`
decision matrix (resolved only, pasted only, both matching, both differing, neither on review).
No test for `parsePr`/`branchWebUrl` alone (single regex, single join).

### 3.4 `apps/kira-space/tests/ui/ade-panel.spec.ts` (new, `test:ui:space`, mocked control)

Fixture extends Part 5's: a stack with a behind root and a behind child, a conflict with a review
branch, a merged branch, a draft with two `branchCandidates`, PR data from mocked `RepoPrs`
(including `webUrl`), sessions (two running on one branch with this window's terminals opened
through the mocked `TerminalService.Open`, one stopped).
1. Panel visible at half width; drag the handle → `SetSettings` patch `panelWidth`; min clamp at
   340; reload keeps the width; ArrowLeft changes width.
2. Header per item: action labels and order; each dialog action opens `AdeClaudeDialog` with the
   right title (Rebase onto main, Rebase onto `<b>`, Rebase stack, Queue after, Start new work);
   Force push calls `ForcePush`; Archive (merged, primary) calls `Archive`.
3. Review item: banner, no name input, no estimate, read-only link rows, notes editable and writes
   `SetBranchMeta` with `notes` only.
4. Name: type + blur writes `SetBranchMeta {name}`; draft writes `UpdateNewWork {title}`; Esc
   reverts without a write.
5. Jira: paste URL → `{key, url}` and a link; paste bare key → unlinked ref; garbage → inline
   error, no call; ✎ then empty Save clears.
6. PR: paste valid link → `prUrl`; invalid → inline error; resolved PR shows chip and title;
   mismatched paste hides them.
7. Branch link: `href` is `webUrl/tree/<encoded>`; click calls `LinkService.OpenExternal`; ⧉
   shows ✓.
8. Estimate: `3` + days writes `3d` and shows `spans 3 days`; toggling to hours writes `3h`.
9. Notes: toolbar Bold, Checklist, Link produce Markdown in the `SetBranchMeta` call (`**`,
   `- [ ]`, `[t](https://…)`); checkbox click writes `- [x]`; a push-driven refetch while focused
   doesn't reset the caret text.
10. Draft `from` select writes `UpdateNewWork {startFrom}`, `main` writes `''`; candidate picker
    calls `BindNewWork` and selects the bound branch.
11. Changes tab rows for the conflicting branch (red files) and the draft (`created on Start`).
12. Agents: tabs per running session, status strip text, amber tint for `input`; terminal host
    mounted for this window's terminal; input Enter calls `AdeService.Send {sessionId, message}`;
    a running session without a local terminal shows `Running in another window.`; `+` opens Start
    Claude Code; stopped Resume opens Resume Claude Code.
13. Hand-off: clicking a stack row's agents-pill button selects the branch, opens Agents and that
    session's tab.
14. Reaper: mocked session stops (sessions push plus terminal exit event) → `TerminalService.Close`
    for that terminal id.

`ipcChannels.ts` gains `SetBranchMeta` and `BindNewWork`.

Go: no new test beyond §0.8/§0.13's assertion tweaks.

---

## 4. Steps and commits

Record `P129P6_START=$(git rev-parse HEAD)` and baselines (`test:unit`, `test:ui:space`,
`test:ui:studio` counts, `go test` for `internal/ade`, `internal/bridge`, `internal/gitsession`)
before step 1. Every commit passes the pre-commit hook. `lint:dead` (knip) must be clean at every
commit: each new export lands with its consumer (tests count as knip entries).

1. **`feat(space): ade repo web url and main start-from patch`**: §2.2, bindings, `wire.ts`
   `webUrl`, `normalizeAdeRepoPrs`. `go test` for the three packages.
2. **`feat(space): ade notes markdown extensions`**: dependencies (`package.json`, `bun.lock`),
   `notesExtensions.ts`, §3.1.
3. **`feat(space): ade queue panel facts`**: `useQueue` `panel`, `ARCHIVE_TIP` export, `links.ts`,
   §3.2, §3.3.
4. **`feat(space): ade detail panel shell, header and changes`**: `tones.ts`, `AdePanelResizeHandle`,
   `AdeDetailPanel`, `AdePanelHeader`, `AdeChangesTab`, `adeUi` `panelTab`, `AdeRepoView` layout.
   Only the Changes tab renders here; the Details and Agents triggers land with their bodies in
   steps 5-7, so no commit ships a placeholder tab.
5. **`feat(space): ade details grid and meta writes`**: `adeSetBranchMeta`/`adeBindNewWork`
   bindings, wire types, two mutations, `useItemMeta`, `AdeDetailsTab` (name, link rows, estimate,
   `from` select), `AdeLinkRow`, `AdeEstimateField`, `AdeCandidatePicker`, Details trigger.
6. **`feat(space): ade notes editor`**: `AdeNotesEditor` in `AdeDetailsTab`.
7. **`feat(space): ade agents tab and terminal reaper`**: `AdeAgentsTab`, `AdeActivityGlyph` 14 px,
   `adeUi` `agentTabByItem`/`openSession`, `state/adeTerminals.ts`, `adeActions` `track`, Agents
   trigger.
8. **`feat(space): ade activity icon opens the session terminal`**: §0.21 emit chain.
9. **`test(space): ade detail panel UI coverage`**: §3.4 and `ipcChannels.ts`. Run
   `test:ui:space` once here; fixes land as follow-up `fix(space):` commits, one per finding.
10. **`docs: ARCHITECTURE records the ade detail panel (P129 Part 6)`**: §5.1.
11. Result section `## P129 Part 6 result` in `docs/v2.0/SPEC.md`, with §6.1 outcomes.

---

## 5. File inventory

New (`apps/kira-space/frontend/src/ade/` unless stated): `links.ts`, `tones.ts`,
`notesExtensions.ts`, `useItemMeta.ts`, `state/adeTerminals.ts`, `AdePanelResizeHandle.vue`,
`AdeDetailPanel.vue`, `AdePanelHeader.vue`, `AdeDetailsTab.vue`, `AdeLinkRow.vue`,
`AdeCandidatePicker.vue`, `AdeEstimateField.vue`, `AdeNotesEditor.vue`, `AdeChangesTab.vue`,
`AdeAgentsTab.vue`; `apps/kira-space/tests/unit/ade-notes-markdown.spec.ts`;
`apps/kira-space/tests/ui/ade-panel.spec.ts`.

Edited:
- `package.json`, `bun.lock` (§0.16 packages, 3.31.3); `knip` config only if §0.16's peer rule
  needs it.
- `apps/kira-space/internal/gitsession/gh.go`, `internal/ade/queue.go` (plus `queue_test.go` if a
  `Prs` assertion exists), `internal/bridge/ade.go` (plus its test if a patch-validation case
  exists); generated bindings.
- `frontend/src/bridge/index.ts`; `ade/wire.ts`, `mutations.ts`, `useQueue.ts`, `state/adeUi.ts`,
  `state/adeActions.ts`, `AdeRepoView.vue`, `AdeTimeline.vue`, `AdeDayBand.vue`,
  `AdeStackBlock.vue`, `AdeStackRow.vue`, `AdeAgentsPill.vue`, `AdeActivityGlyph.vue`.
- Tests: `ade-queue-parity.spec.ts`, `ade-queue-rules.spec.ts`, `support/mockupToWire.ts` (panel
  fields the converter doesn't yet carry: `prUrl`, notes, sessions' `terminalId`/`cwd`),
  `tests/ui/support/ipcChannels.ts`, `tests/ui/support/mockRuntime.ts` (only if `RepoPrs`'s mock
  needs `webUrl`).
- `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md` (result section only).

Not edited: `docs/v2.0/SPEC.md`'s Part 6 row (no split), `packages/workbench/*` (consumed as is),
`apps/kira-studio/*`.

### 5.1 `docs/ARCHITECTURE.md`

New paragraph after Part 5's: panel structure (`QueueView.panel`, the flex-row layout, why the
resize handle is VueUse and not reka, `ade.panelWidth` semantics), meta writes (`SetBranchMeta`
for branches, `UpdateNewWork` for new work, review notes only, `startFrom: ''` = main), links
(`RepoWebURL`, OS-opened `<a>`), notes (`@tiptap/markdown` over `tiptap-markdown` and why, the
refetch rule), Agents (`TerminalHostView` for this window's terminals only, `adeSend` input, the
`adeTerminals` reaper). Update the Part 4 paragraph (2672-2678): `resumeSpec` now has the Stopped
list as its caller, and the activity-icon click opens the session's terminal. No Known open item
added: cross-window attach is Part 7's scheduled scope, not an open limitation.

---

## 6. Verification

| Command | Expected |
|---|---|
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean |
| `bun run build:space`, `bun run build:studio` | Clean |
| `go build ./...`, `go test ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/bridge/... ./apps/kira-space/internal/gitsession/...` | Pass |
| `bun run test:unit` | Baseline plus §3.1, extended §3.2/§3.3, all pass |
| `bun run test:ui:space` | Baseline plus §3.4, all pass; `ade-dialogs`/`ade-timeline`/`ade-module` specs green |
| `bun run test:ui:studio` | Baseline, unchanged |

### 6.1 Live check

Server-mode Space (`docs/DEV_ENVIRONMENT.md`: direct DB row, `git.gitPath`, `curl /wails/runtime`)
on a scratch repo with a GitHub-shaped `origin`, one mine stack (root plus a child behind it), one
draft:
1. Select the child: `Rebase stack` shows; drag the panel narrower, reload, width kept.
2. Paste a Jira URL and a PR URL; the DB row holds key, URL and `pr_url`; the Branch `href` is
   `https://<host>/<owner>/<repo>/tree/<branch>`.
3. Write notes with a heading, checklist and link; the DB `notes` column holds the Markdown;
   reload renders it back unchanged.
4. Start an agent on the draft (or `+` on the branch): the Agents tab shows the terminal; the
   input line reaches Claude.
5. Stop the session: it moves to Stopped, `TerminalService.Close` for its id appears in the
   server log; Resume opens the dialog.
Record outcomes in the result section; name any step the container can't run (real Claude Code
launch needs its credential, per `docs/DEV_ENVIRONMENT.md`).

---

## 7. Closing audit

| Check | Command | Pass |
|---|---|---|
| TipTap real usage | `rg -n "@tiptap/(vue-3\|markdown\|starter-kit\|extension-list\|extensions)" apps/kira-space/frontend/src apps/kira-space/tests` | `AdeNotesEditor.vue`, `notesExtensions.ts`, §3.1 spec |
| No `tiptap-markdown` | `rg -n '"tiptap-markdown"' package.json` | Empty |
| Pinned | `rg -n '"@tiptap/' package.json` | All `"3.31.3"` |
| Control members | `rg -n 'AdeService\.' apps/kira-space/frontend/src/bridge/index.ts` | 19 members |
| New members have callers | `rg -n 'adeSetBranchMeta\|adeBindNewWork' apps/kira-space/frontend/src/ade` | `mutations.ts`, used from `useItemMeta`/`AdeCandidatePicker` |
| `resumeSpec` wired | `rg -n 'resumeSpec' apps/kira-space/frontend/src/ade/*.vue` | `AdeAgentsTab.vue` |
| Terminal host | `rg -n 'TerminalHostView' apps/kira-space/frontend/src/ade` | `AdeAgentsTab.vue` |
| Reaper wired | `rg -n 'cleanupTabRuntime\|closeTerminalSession' apps/kira-space/frontend/src/ade` | `state/adeTerminals.ts` |
| Hand-off wired | `rg -n 'openSession' apps/kira-space/frontend/src/ade` | pill → … → `AdeRepoView` → `adeUi` |
| No reka resizable in ade | `rg -n 'ResizablePanel\|ResizableHandle' apps/kira-space/frontend/src/ade` | Empty |
| Pure modules | `rg -n "from 'vue'\|Date.now\|new Date" apps/kira-space/frontend/src/ade/{useQueue,links}.ts` | Empty |
| SFC form | `rg -L '<script setup lang="ts">' apps/kira-space/frontend/src/ade/*.vue`; `rg -n '<style' apps/kira-space/frontend/src/ade` | Both empty |
| No Merge/ready/Jira fetch/PR review states | `rg -n -i "'merge'\|ciFailing\|approved\|changes requested\|syncing" apps/kira-space/frontend/src/ade` | No action, state or text |
| No git-ui | `rg -n "@kira/git-ui\|packages/git-ui\|kira-ui" apps/kira-space/frontend/src/ade` | Empty |
| Stores one concern | Read `adeUi.ts`, `adeActions.ts`, `adeTerminals.ts` | UI state / in-flight actions / ade terminals only |
| Studio unchanged | `git diff --stat $P129P6_START -- apps/kira-studio packages/workbench` | Empty |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Snapshot refetch after each notes write resets the editor mid-typing | §0.16 refetch rule; §3.4 #9 asserts it |
| `@tiptap/markdown` canonicalizes existing notes on first edit (`_x_` → `*x*`, list markers) | Only user edits write (§0.16); §3.1 pins the canonical form for every listed construct |
| xterm fit loops while the panel resizes | Handle is not reka (§0.2); width changes are plain style updates; `useTerminalMount`'s own fit handles the rest. If a loop appears, fit only on drag end |
| `useDraggable` on a 6 px strip loses the pointer when moving fast | VueUse's `draggingElement` defaults to `window`, so moves outside the strip still track; §3.4 #1 drags past the strip |
| Theme lint rejects arbitrary Tailwind values for literal tones and ProseMirror content selectors | Tones via `:style` from `tones.ts` (Part 5's approach); editor content styling via Tailwind arbitrary variants on the `EditorContent` wrapper using theme tokens; `bun run lint` per commit |
| Mounting `TerminalHostView` for a terminal this window doesn't own opens a stray shell | Mount gated on `terminalSession(id)` (§0.18); §3.4 #12 asserts no `TerminalService.Open` for the foreign id |
| Reaper closes a terminal the user still reads | Only exited/failed ids of non-running sessions; the Stopped list shows no terminal (design) |
| `startFrom: ''` store path untested in Go | Same value `AddNewWork` already stores; §3.4 #10 and §6.1 cover it |
| `lint:dead` on staged exports | Each export lands with its consumer (§4) |

---

## 9. Acceptance, mapped to the SPEC row

| SPEC row item | Where |
|---|---|
| Resizable panel, default half width, min 340 px | §0.2, §0.3, §3.4 #1 |
| Header: colour, work status chip, title, mono line | §0.22, §0.14, §3.2, §3.4 #2 |
| Actions: Force push (N), Rebase onto, Archive with tooltip, Rebase stack, Queue after, Start agent | §0.5-§0.7, §3.2, §3.3, §3.4 #2 |
| No Merge action | §0 standing, §0.5, §7 |
| Review banner | §0.22, §3.4 #3 |
| Tabs | §0.22, §3.4 #11-#12 |
| Details: Name input | §0.12, §3.4 #4 |
| Branch/Jira/PR rows, real links, copy, edit | §0.8-§0.11, §3.4 #5-#7 |
| Dashed paste inputs parsing `ABC-123` and `/pull/123` | §0.10, §0.11, §3.4 #5-#6 |
| Branch chip per design §2.4 | `item.branchStatus`, §0.14, §3.2 |
| PR chip = raw state plus title, no Approved/Changes requested | §0.11, §3.3, §7 |
| Jira plain link, no live sync, bare key unlinked | §0.10, §3.4 #5, §7 |
| Estimate number, hours/days toggle, `spans N days` | §0.12, §3.4 #8 |
| Notes: TipTap WYSIWYG stored as Markdown, toolbar, checklist, link field | §0.16, §3.1, §3.4 #9 |
| Changes tab | §0.17, §3.2, §3.4 #11 |
| Agents tab: terminal per running session via `TerminalHostView`, `+`, status strip, input, Stopped with Resume | §0.18, §0.19, §3.4 #12, #14 |
| Activity-icon click opens the session terminal (Part 5 §0.18) | §0.21, §3.4 #13 |
| New work candidate picker calling `BindNewWork` | §0.15, §3.4 #10 |
| Acceptance: each listed behaviour | §3.4 |
| Acceptance: Markdown round-trip for every listed construct | §3.1 |
