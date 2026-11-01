# P433 iter2 plan: frontend memory, re-sweep and parked items

Pass 2 of P433. It plans against the current tree, not iter1's base, and does 2 things:

- A: re-sweep the areas iter1 could not cover.
- B: root-cause and fix the 4 items iter1 parked.

Iter1 plan and result: `P433-frontend-data-memory.md`. Numbers: `P433-measurements.md`.

## Base and method

- Branch `chapter/v0.2.24`, base `f8344675e` (every stream landed). No worktree, no streams.
- Discovery: 23 `codegraph_explore` calls, then reads of files those calls named.
- Method, same as iter1:
  - `KEEP_WHILE_OPEN` policy in `packages/workbench/src/state/queryClient.ts`.
  - Push events for app-owned data.
  - Heap probe `tests/perf/heap-tabs.spec.ts` in each app.
- Added to the method for B1 and B2: CDP heap snapshots (`HeapProfiler.takeHeapSnapshot`).
  - Each round: open, close and reopen the tab 5 times, then close all.
  - Diff object counts between rounds. Find the retainer by shortest path from GC roots.
  - Skip weak edges and WeakMap ephemeron edges.
  - The snapshot scripts were scratch tools, not committed. The numbers below come from them.
- The probe's `rounds` sample comes after two forced GCs, so a number that keeps growing is retained
  memory, not garbage.

## Stay out

- Space local-file refetch (iter1 P3).
- Kibana data view picker `staleTime` 60 s.
- `staleTime: 0` reads of data Kira does not own. This includes `FileTypesPane.vue` refetching on
  each activation: the data is LaunchServices state, not Kira's.

## A. Re-sweep

Checked against the current source, by area:

- **Host view** (`hostview/IssueView.vue`, `ChangeRequestView.vue`, `CommentComposer.vue`,
  `queries.ts`).
  - Detail queries use the client defaults (`staleTime: Infinity`, Refresh is the only refetch).
  - The window shows one target, so no tab switch exists here.
  - Draft text uses VueUse `useSessionStorage`, bound to the component scope and freed on unmount.
  - Staged attachments are Go memory. They are dropped on post and swept by age
    (`HostViewAttachments.sweep`).
  - Nothing to fix.
- **Capture** (`capture/CaptureWindow.vue`, `capture/queries.ts`, `settings/CapturePane.vue`).
  - `useCaptureStatus` writes pushed state into the cache and frees its listener with
    `tryOnScopeDispose`.
  - The popup's listeners are VueUse and scope-bound.
  - Nothing to fix.
- **Settings dialogs** (both apps).
  - Panes edit a draft of the settings store. The only IPC read is `FileTypesPane`, which is in the
    stay-out list.
  - Nothing to fix.
- **Operations panel and op log** (P432; `OperationsPanel.vue` in both apps, `OpLogPanel.vue`,
  `createOpLogStore.ts`, `useAutomationOps.ts`).
  - Records are capped at 500 foreground and 300 background (`trimLane`), held `markRaw`.
  - Run list `useScriptRuns` is push-fed. `RunsStatusItem` in each status bar keeps the feed and its
    cache observed for the window's lifetime, so the 5 min GC never drops it.
  - Nothing to fix.
- **Stage settings** (P431, `AdeStepSettings.vue`).
  - Reads the workflow list already in cache (`useWorkflows`). No IPC of its own.
  - Nothing to fix.
- **Retained memory found** in the sweep: `usePersistedState` pins the first component that calls a
  key, for the app's lifetime. This is item B1c. Component callers:
  - `KibanaDiscoverView.vue`
  - `ProofWindow.vue`
  - `AdeReviewWindow.vue`
  - `AdeInspectorSection.vue`
  - `RunsSection.vue`
  - `RunsStatusItem.vue`
  - `TerminalScreen.vue` (phone)

  Store callers pin one instance per store; bounded, but fixed by the same change.
- **Checked, bounded, no change**:
  - `createSharedComposable` (`usePromptVisibility`, `usePlanModel`, `useAgentsModel`) pins its
    first subscriber only while one exists, and disposes at zero subscribers.
  - Pinia setup-store watchers pin the first calling component, one per store. Measured under 1 MB.

## B. Parked items

### B1 Studio Discover grows about 4 MB per round, +33 MB after close-all

Iter1's hypothesis (kqlLanguage) was not the main cause. Root causes, by snapshot evidence:

**B1a `addCommand` keeps every editor's handler forever.**

- File: `apps/kira-studio/frontend/src/editor/MonacoHost.vue:561-566`.
- Cause: Monaco 0.56 `editor.addCommand` registers its handler in the global `CommandsRegistry` and
  throws away the disposable. Each handler closes over `emit`. That closure retains the whole host,
  QueryBar and Discover component tree, plus its grid page.
- The dynamic keybinding is global too, not scoped to the editor.
- Every single-line or save-command host leaks one tree per mount: Discover's QueryBar and every
  other `singleLine`/`saveCommand` user.
- Fix: replace both calls with `editor.addAction`. It returns an `IDisposable`, and its keybinding
  is scoped by Monaco's own editor-id precondition. Keep the disposables and dispose them in
  `onUnmounted`, before `editor.dispose()`.
  - Enter: `{ id: 'kira.submit', label: 'Submit', keybindings: [KeyCode.Enter],
    keybindingContext: '!suggestWidgetVisible', run: () => emit('submit') }`.
  - Save: `{ id: 'kira.save', label: 'Save', keybindings: [KeyMod.CtrlCmd | KeyCode.KeyS],
    run: () => emit('save') }`.
  - Same pattern already in Space: `blameAnnotation.ts:84`, `reviewDecorations.ts:583`,
    `distillSelection.ts:11`.
  - Labels show in the command palette only; the context menu is off in these hosts. Use i18n
    labels if an existing key fits, otherwise plain ids are acceptable. Monaco needs a label.
- Measured with the scratch snapshot test: base 12.9 MB, 5 rounds, then close.

  | step | rounds 1-5 (MB) | after close (MB) |
  |---|---|---|
  | before | 34.4, 38.4, 41.9, 46.1, 49.4 | 46.3 |
  | B1a only | 34.5, 36.1, 35.9, 37.0, 37.2 | 34.1 |

  What is left of the per-round growth is V8 JIT `(code)`.

**B1b custom grammar registered on every mount.**

- File: `MonacoHost.vue:247-257`.
- Cause: `registeredLanguages` is a `<script setup>` top-level `const`, so it is per instance and
  not per module. Every mount calls `kqlMonacoLanguage.register` (and Lucene's) again.
  - `kqlLanguage.ts` `grammar().register` calls `languages.register`,
    `setMonarchTokensProvider` and `setLanguageConfiguration`.
  - It drops all 3 disposables, so each mount adds 1 language entry and replaces the tokenizer.
- Small in bytes, but unbounded.
- Fix:
  - New file `apps/kira-studio/frontend/src/editor/customLanguages.ts` with a module-level
    `Set<string>` and `ensureCustomLanguage(m, lang)`. It registers once per id per page.
  - `languageId()` calls it.
  - A file, not a second `<script>` block (CLAUDE.md: one `<script setup>` only).

**B1c `usePersistedState` pins its first caller.**

- File: `packages/workbench/src/behaviour/persisted.ts`.
- Cause:
  - The shared ref is created inside a detached `effectScope`, through VueUse `useLocalStorage`.
  - VueUse creates its write watcher with `watchPausable`, which is the runtime-core `watch`.
  - Vue 3.5 `doWatch` captures `currentInstance` in the watcher's call closure. `effectScope.run`
    does not clear `currentInstance`.
  - So the first component that calls a key stays reachable for the app's lifetime. For Discover
    that is the first tab's whole tree, through `kira.kibana.fieldSidebarWidth`.
- Measured: replacing that one call with a plain `ref(240)` cut 3 MB after close (r5 34.2,
  closed 31.1).
- Fix: keep the public API and the per-key cache. Build each ref without any runtime-core watcher:
  - `ref<T>(initial)`, with `initial` from `localStorage.getItem` through the existing serializer.
    Missing or failed reads give the default. Wrap storage calls in try/catch, as
    `migrateLegacyKey` does.
  - Write path: create a `vue` `effect` (exported from `@vue/reactivity`; it captures no
    instance) inside `scope.run`.
    - Inside `scope.run`, so the detached scope owns it, not the calling component's scope.
    - Its getter is `serializer.write(state.value)`. `JSON.stringify` for objects reads every
      property, so tracking is deep, same as VueUse's `deep: true`.
    - Its scheduler batches to one microtask, which then writes the string.
    - `null` or `undefined` removes the item (VueUse behaviour).
    - No write on the first run (`writeDefaults: false`).
  - Cross-window sync: one module-level `window.addEventListener('storage', …)`. It dispatches by
    `e.key` to that key's ref when `e.storageArea === localStorage`. `newValue === null` sets the
    default. Set a guard so the echo does not write back.
  - Declining VueUse here, the named requirement: its storage composables always create a
    runtime-core watcher. That watcher pins the calling component for as long as the shared ref
    lives (app lifetime), and no option avoids it. Other VueUse uses stay.
- Expected after B1a to B1c:
  - Discover per-round growth under 0.5 MB after round 2.
  - Closed vs baseline about 18 MB. That is first-load module code (about 10 MB) plus Monaco and
    KQL source strings (about 7.5 MB), the same class as the grid world's 13 MB.
- Not fixed, probe artifact: `useDiscover`'s 5 min `gcTime` queries keep their `queryFn` closure
  until the timer fires. The probe's fake clock never fires it. `page.clock.runFor(6 min)` after
  close did not change the number, so the probe needs no change for it.

### B2 Space file and diff grow about 0.7 MB per round, +2.8 MB per open/close cycle

**B2a file editor no-op chords.**

- File: `apps/kira-space/frontend/src/views/repo/useFileEdit.ts:116-127`.
- Cause: `attach()` calls `e.addCommand(chord, () => {})` for 3 chords: CtrlCmd+Space,
  WinCtrl+Space, CtrlCmd+I. Same Monaco leak as B1a.
  - The arrow function's context is `attach`'s closure, so it holds `RepoFileView`'s setup scope.
  - That includes the resolved file text: about 2 MB per mount of the 40k-line fixture.
- Fix:
  - One `e.addAction({ id: 'kira.noSuggest', label: …, keybindings: [the 3 chords], run: () => {} })`.
  - Keep its disposable in the composable and dispose it in `detach()`.
  - The disposable lives in a local `let`, like `contentSub`.

**B2b disposing an editor while its models live on.**

- File: `apps/kira-space/frontend/src/views/repo/editors.ts:132-149`.
- Cause: `unmountEditor` and `dropRepoFileTab` call `entry.editor?.dispose()` while the cached
  models (`modelCache`) outlive the widget.
  - A `DiffEditorWidget` disposed with models still attached stays reachable from them. It keeps
    its view model, sash listeners on global emitters, and theme-service listeners.
  - Diff widget instances grew from 10 to 22 across rounds.
- Fix:
  - Add a small `releaseWidget(entry)` that calls `entry.editor.setModel(null)`, then `dispose()`,
    then clears the field.
  - Call it from both functions. Both editor kinds accept `setModel(null)`.
  - `packages/workbench/src/editor/MonacoDiff.vue` disposes its own models with the widget, so it
    needs no change.
- Measured, Space snapshot test: base about 14 MB, rounds r1-r5, then 4 open/close cycles.

  | step | rounds (MB) | close cycles 1-4 (MB) |
  |---|---|---|
  | before | 30.5, 32.2, 32.8, 33.5, 33.9 | 32.8, 35.6, 38.4, 41.4 |
  | B2a | not recorded | 30.6, 31.2, 31.7, 32.5 |
  | B2a + B2b | flat, r5 32.9 | 29.5, 29.8, 30.1, 30.6 |

  - B2a removes the 2 MB string per cycle.
  - B2b, `setModel(null)` in `unmountEditor`: diff widget count stays at 9.
  - The table's last row also has B2b in `dropRepoFileTab`.
  - What is left (about 0.4 MB per cycle) is JIT code plus Monaco's lazy tokenization of the cached
    model. Both are bounded.

### B3 stat gate misses a same-size edit inside mtime granularity

Root cause:

- `codeworkspace.ReadFileIf` (`apps/kira-space/internal/codeworkspace/files.go:158-223`) answers
  `unchanged` when `{size, mtimeNs}` matches, before any read.
- The gate misses in 2 cases:
  - A same-size write within the filesystem's timestamp granularity.
  - Any tool that restores mtime (`cp -p`, `rsync -t`, `touch -r`).
- In both cases the tab shows stale text with no later correction until the file changes again.
- `ctime` and inode share the same granularity, so a finer stat signal does not exist. Content is
  the only exact signal, same as `ifHeadOid` is for the HEAD side.

Change, the identity becomes size plus content hash:

- `FileStat` becomes `{Size int64; Hash string}`, json `size` and `hash`.
  - `Hash` is the SHA-256 hex of the on-disk bytes.
  - Reuse `hashBytes` from `edit.go`.
  - Drop `MtimeNs`: no gate decision reads it any more.
- `ReadFileIf` order:
  1. `os.Stat`. Missing and not-regular stay as today.
  2. Over `MaxReadBytes`: `tooLarge`, unchanged from today.
  3. Read the bytes, bounded.
  4. Binary: `binary`, unchanged.
  5. Compute the hash and set `limit.Stat = &FileStat{Size: len(data), Hash: h}`.
  6. If `ifStat` is non-nil and `*ifStat == *limit.Stat`, answer `unchanged` with no text.
  7. Otherwise answer `found`.
- Cost: an unchanged answer now reads and hashes the file, about 2 ms for 2 MB from page cache. It
  still saves what iter1 targeted: IPC payload, renderer string allocation and the model
  `setValue`.
- `diff.go` `DiffGate.WorktreeStat` and `readDiffAt` need no logic change. They pass through
  `ReadFileIf`.
- Shared wire, `packages/shared/domain/repo.ts:38`: `fileStatSchema` becomes
  `{ size: z.number(), hash: z.string() }`.
- Frontend:
  - `fileContent.ts`, `editors.ts` `KnownRead` and `useDiffEditor.ts` carry `stat` opaquely. Only
    type names change; `grep FileStat` confirms.
  - Remove any `mtimeNs` reference.
- Fixtures and contracts:
  - `apps/kira-space/tests/perf/heap-tabs.spec.ts` stat snapshots move to `hash`.
  - `tests/ui/repo-file-gate.spec.ts` mocks move to `hash`.
  - The hash is deterministic, so `flowharness.Mask("mtimeNs")` goes in 3 places:
    - `adeflow/review_working_test.go:72` keeps `Mask("oid")`.
    - `adeflow/review_working_review_test.go`
    - `windowflow/openedfiles_test.go:67`
  - Regenerate `tests/contract/ade-review-working*.json` and `opened-files.json`, using the
    contract update mode `docs/DEV_ENVIRONMENT.md` documents.
- Docs: `docs/ARCHITECTURE.md:1876`.
  - Replace `{size, mtimeNs}` with `{size, hash}`.
  - Delete the sentence on the same-size-edit miss.
  - Add: "An unchanged answer still reads and hashes the file; it skips the payload, not the disk
    read."

Tests, new behaviour, split at the IPC boundary:

- Flow: `apps/kira-space/internal/flows/repoflow/workspace_test.go`, in the existing subtest
  `ifStat and ifHeadOid skip unchanged sides` (line 141). Add:
  - A same-size different-content write, then `os.Chtimes` back to the first mtime. This forces
    the granularity case deterministically. `ReadFile` with the old `first.Stat` answers `found`
    with the new text.
  - `ReadDiff` with the old worktree stat answers worktree `found`.
  - A rewrite of identical bytes with a new mtime still answers `unchanged`.
- UI: `apps/kira-space/tests/ui/repo-file-gate.spec.ts`, same scenario.
  - The mock answers `found` with new same-size text for a request carrying the first read's
    `ifStat.hash`.
  - After a tab switch, the editor shows the new text.
  - Assert that the request carried `ifStat.hash`.

### B4 stream filter history: was the `useQuery` conversion in scope?

- Iter1 F4 did plan it: "`StreamFilterHistoryMenu.vue` manual `onMounted` reload becomes
  `useQuery`". The Result then corrected the premise: the menu has no IPC.
- Source today, `apps/kira-studio/frontend/src/views/stream/StreamFilterHistoryMenu.vue:25-33`:
  - The menu copies `listStreamFilterHistory` into a local `ref` on mount.
  - It copies again after each pin or delete.
  - The data is a session-only reactive `Map` in Pinia store `streamFilterHistory.ts`. No server
    state exists.
- Declining `useQuery`, the named requirement: CLAUDE.md routes server state fetched over the
  bridge through TanStack Query, and client state through Pinia. A query here would wrap a
  synchronous Pinia getter in a cache. That cache duplicates Pinia's own reactivity and needs
  manual invalidation on every write.
- The real defect is the manual copy. A history entry recorded while the menu is mounted would not
  show.
- Fix:
  - `entries` becomes `computed(() => target() ? store.listStreamFilterHistory(…) : [])`.
  - Delete `reload`, `onMounted(reload)` and the two `reload()` calls.
  - `savedEntries` collapses into `entries`.
  - The store's `Map` is `reactive`, and `toggleStreamFilterHistoryPin` mutates a reactive entry,
    so the computed tracks both.
- Tests: no new behaviour reachable from the UI (applying closes the menu). Rerun the existing
  stream filter history specs (`grep -l stream-filter-history apps/kira-studio/tests/ui`).

## Heap probe changes

- Studio `heap: kibana discover` and Space `heap: repo graph, repo file, diff` pass `rounds: 5`.
  3 rounds hid the per-round slope under first-round JIT warm-up.
- No other harness change. `closed2` already measures growth per open/close cycle. A gcTime clock
  jump measured no effect (B1 last point).

## Known open items

- Delete the `docs/ARCHITECTURE.md` entry "Tab remounts still grow the renderer heap (P433)" once
  the after numbers meet the targets above:
  - Discover per-round growth under 0.5 MB after round 2.
  - Space `closed2 - closed` under 0.5 MB.
- A miss means the item stays, reworded with the new numbers, and the plan Result says so.
- Add 2 app facts to the editor part of `docs/ARCHITECTURE.md` (not Known open items), so the
  leaks are not reintroduced:
  - Monaco `addCommand` registers globally and returns no disposable. Use `addAction` and dispose
    it on unmount.
  - Call `setModel(null)` before disposing an editor whose models outlive it.
- Add 1 line next to the `usePersistedState` mention (line 1370): its shared refs hold no component
  instance.

## Implementer and order

One sequential Sonnet implementer. No split: B1c (`packages/workbench`) and B2 touch shared Monaco
patterns, and B3 spans Go, shared schema and Space frontend. No zero-overlap file split is proven.

Steps, one commit each, Conventional Commits, hooks must pass on every commit:

1. Before numbers.
   - Run `bun run build:test:studio` and `bun run build:test:space`.
   - Run the two probe worlds with `rounds: 5` (commit the `rounds` change first:
     `test(perf): five rounds for discover and repo worlds`).
   - Record `HEAP` lines.
2. `fix(studio): dispose MonacoHost key actions and register custom grammars once` (B1a, B1b).
3. `fix(workbench): persisted state holds no component instance` (B1c).
4. `fix(space): dispose file editor chords and detach models before editor dispose` (B2a, B2b).
5. `fix(space): gate worktree reads on content hash` (B3: Go, schema, frontend, fixtures,
   contracts, flow test, UI spec).
6. `refactor(studio): stream filter history menu reads the store reactively` (B4).
7. After numbers: rerun the same two worlds plus every other world once. Iter2 has 2 new fixes
   that touch every Monaco host (B1a) and every persisted key (B1c).
8. `docs: P433 iter2 measurements and architecture`.
   - Add an "Iter2" section to `P433-measurements.md` with before and after tables per world.
   - Make the `ARCHITECTURE.md` edits above.
   - Add the Result section in this file.

## Test policy

- Fast checks (typecheck, lint, build) run per commit through the pre-commit hook.
- Expensive suites run once, after step 6: the Studio UI suite, the Space UI suite, and Go tests
  for both apps.
- After a fix, rerun only the failing specs and the specs that share its code.
- A timeout under load gets a lone rerun first.
- Second full UI run of an app: only when a fix touches shared code that targeted reruns cannot
  cover (`packages/workbench`, a fixture, a config). The Result states it.
- Rerun these specs by name after their step, before the full run:
  - Step 2: specs that press Enter in a single-line host or Ctrl+S in a save-command host. Find
    them with `grep -l "Enter\|Control+s\|Meta+s"` in `apps/kira-studio/tests/ui`, filtered to
    console, kibana and http request.
  - Step 3: specs that reload and assert a persisted width or toggle, for example
    `fieldSidebarWidth`, `runsOpen`, `showBackground`.
  - Step 4: Space repo file edit and diff specs (`repo-file-*`, `repo-diff-*`).
- Heap probe: report-only, run in step 1 and step 7. It is not part of the full suite.
- Real `claude` tests: not affected, not run.

## Result

To be written by the implementer.
