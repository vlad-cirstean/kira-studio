# P109 — docs true-up against v1.9's final state

Plan for `docs/v1.9/SPEC.md` row P109. Surveyed at `f20298d1` (after P114's result), so it covers
every landed v1.9 phase except P113, which has not run. Discovery used `codegraph_explore` for
symbol and call-site questions. Scripted path and symbol scans (§4.1) plus full reads of every
target doc covered the rest.

Every line number below is against `f20298d1`. Line numbers shift as edits land, so the
implementer finds each target by its quoted text, not by line.

## 0. Goal and acceptance

**Goal.** Every current-state claim in the target docs matches the tree as it stands. The target
docs are:

- `docs/ARCHITECTURE.md`
- `docs/DEV_ENVIRONMENT.md`
- `CLAUDE.md`
- root `README.md`
- `apps/kira-studio/README.md`, `apps/kira-space/README.md`, `apps/kira-space-vscode/README.md`
- `apps/kira-studio/tests/visual/README.md`
- `packages/api-core/README.md`
- `scripts/demo-dbs/README.md`

Scope limits:

- Docs only. No `.vue`/`.ts`/`.go`/`.sh`/`.json` edit of any kind.
- Historical prose ("P58f deleted X", "as of P100 …") stays wherever it explains *why* something is
  the way it is.
- Rewrite only claims presented as current fact that are no longer true.
- `docs/PERF.md`, `docs/PACKAGING.md` and every chapter `SPEC.md`/`plans/` are out of scope. They
  are measurement and phase records, not the row's named targets.

**Acceptance criteria.** Each one is checkable by command.

1. **A1.** The `paths2.py` scan (§4.1) over every target doc reports only mentions on the
   intentional list in §4.2: deleted-on-purpose history, build outputs, and third-party paths.
   There is zero unexplained `MISSING`.
2. **A2.** `grep -n` for each retired name in §4.3 over the target docs hits only historical
   sentences, each one phrased in the past tense.
3. **A3.** Every `bun run <name>` in the target docs exists as a key in the root `package.json`
   `scripts` block. The implementer runs this check (§4.4). This planning pass could not read
   `package.json` (see §6).
4. **A4.** Known open items (§1.9):
   - Every entry this chapter resolved is deleted.
   - Every surviving entry is re-verified by the check named beside it.
   - Every new real limitation in §2.5 is added.
5. **A5.** `CLAUDE.md` loses exactly the dead pointers in §1.1. No process rule is added,
   removed or reworded beyond them.
6. **A6.** The misplaced native-code-workspace block moves out of `## Storage` into the Git module
   section. The Quick open (C9) subsection is deleted. Storage then describes only Kira Studio
   except the explicitly labelled `review.db` paragraph (§2.3).
7. **A7.** Every count a target doc states as current fact matches a recount. §1 lists each count
   and its check.
8. **A8.** `bun run lint` and `bun run typecheck` pass on every commit through the normal
   pre-commit hook, with no `--no-verify`.

## 1. Audit findings

Each finding gives the line, what is wrong, and what the text should say. "Verify" means the
planner saw drift but the exact replacement needs a recount or a read at implementation time. The
check to run is named.

### 1.1 `CLAUDE.md`

Only dead pointers. Every process rule stays.

- **L49** `— docs/v1.8/ today`. Change to `— docs/v1.9/ today`.
- **L142-143** `v1.1/v1.2/v1.4/v1.6/v1.8 continue one counter (v1.6 topped out at P70; v1.8 starts
  at P71)`. Append v1.9 and write `(v1.8 starts at P71, v1.9 at P96)`. v1.9 is not closed, since
  P113 is still pending. Do not state v1.9's top number.
- **L255** `not repo-map:`. Delete the phrase. repo-map was removed in P97.
- **L276** `codegraph_explore`/`codegraph_node` tool calls. Change to `codegraph_explore` tool
  calls. The server exposes one tool, `mcp__codegraph__codegraph_explore`, and there is no
  `codegraph_node`. Confirmed: `ToolSearch` finds only `codegraph_explore`, and the server's own
  instructions say "There is a single tool".
- **L283** `it loads codegraph_explore, codegraph_node and the rest by name`. Change to `it loads
  codegraph_explore by name`.
- **L291** Delete the sentence ``codegraph_node` reads one symbol's source plus its caller/callee
  trail.``
- **L296-298** Delete the paragraph that starts "The shipped repo-map feature … was removed in v1.9
  P97". It points at a deleted subsystem, and its only job was to resolve a name collision that no
  longer exists.
- **L250** Leave `docs/pending-changes/`/`docs/pending-workflows/` as is. `pending-workflows/`
  is a create-on-demand convention and still valid. Only DEV_ENVIRONMENT's pointer to its
  nonexistent `README.md` is dead (§1.2).

### 1.2 `docs/DEV_ENVIRONMENT.md`

- **L31-32** `docs/pending-workflows/` (see that directory's own `README.md`). No such README
  exists and the directory has never existed (P106 result L2431). Change to `docs/pending-workflows/`
  (create the directory if it doesn't exist). This mirrors the L25-28 wording for
  `pending-changes/`.
- **L168** `./apps/kira-studio/internal/gitsock/`. Change to `./apps/kira-space/internal/gitsock/`.
  The probes `TestGraphStreamPerf`/`TestG8PerfBaseline` moved with the package in P100.
- **L173** `internal/gitclient/watcher_fsevents_darwin.go`. Change to
  `apps/kira-space/internal/gitclient/watcher_fsevents_darwin.go`.
- **L185-186** `typecheck:web`/`typecheck:space-web`/`typecheck:tests`/`typecheck:space-tests`/
  `typecheck:unit`/`typecheck:space-unit`. P106 renamed the Studio ones. Change to
  `typecheck:web:studio`/`typecheck:space-web`/`typecheck:tests:studio`/`typecheck:space-tests`/
  `typecheck:unit:studio`/`typecheck:space-unit`, confirming each against `package.json`. Kira
  Space's names kept no `:space` suffix (P106 L2408).
- **L176-179** `bun run test:webview`, `bun run test:unit`. Still valid; P106 left both unscoped.
  No change beyond the A3 check.
- **L254** The bindings path names only `apps/kira-studio/frontend/bindings/**`. Change to "each
  app's `frontend/bindings/**`". `setup.sh` regenerates both apps' bindings (P106 L2445: 760/319
  packages).
- **L313** "See `CLAUDE.md`'s `docs/v1.8/plans/P94-code-quality-tooling.md`" is a garbled pointer.
  `CLAUDE.md` names no P94 file. Change to "See `docs/v1.8/plans/P94-code-quality-tooling.md`".
- **L342** "Pre-commit stays exactly `bun run lint` + `bun run typecheck` (~15s)". Correct against
  `.githooks/pre-commit`. Keep it. §1.8 aligns the root README's "about six seconds" with it.
- **L348** The pre-push hook runs `go build ./...`, `bun run lint:go` and `bun run lint:dead`. The
  doc names only the last two. Add `go build ./...` (checked against `.githooks/pre-push`).
- **L373-375** Stale. It says "`DefaultPort` **8766** … with an ephemeral fallback on conflict
  (`net.Listen` retried on `127.0.0.1:0`) — read the actually-bound port off the process's own
  startup output". P108 Part 7 F11 (`aad4a848`) made `bindHTTP` refuse a conflict instead. Change
  to: port is always 8766; a conflict fails the enable with "another process is using this port"
  and never falls back. `ARCHITECTURE.md` L3382-3386 already states this correctly.
- **Missing: shadcn-vue registry fetch.**
  - Move ARCHITECTURE L35's "Fetching a new shadcn-vue component set is a direct-registry pull …"
    procedure here as its own section (§2.4 draft).
  - It is an environment/tooling fact: the sandbox cannot run `shadcn-vue add`, and there is no
    `components.json`.
  - ARCHITECTURE keeps one line pointing here.
- **Missing: CodeGraph setup.** `CLAUDE.md` describes how to navigate with CodeGraph. The container
  facts belong here instead (§2.4 draft):
  - `session-start.sh` runs only when `CLAUDE_CODE_REMOTE=true`.
  - It installs `@colbymchenry/codegraph` with `npm -g`.
  - It runs `codegraph init`/`sync`.
  - The index lives in `.codegraph/`, which is gitignored.
  - `UserPromptSubmit` runs `codegraph prompt-hook`.
- **L196-202** The fresh-worktree "Initial commit" race is still true; this session hit it. Keep.
- **L363** `apps/kira-studio/cmd/` holds only `g1measure`. Correct. Keep.

### 1.3 `ARCHITECTURE.md` — header and Stack table (L1-78)

- **L11-13** The chapter-folder list stops at `docs/v1.8/`. Add `docs/v1.9/`. §2.6 creates
  `docs/v1.9/README.md` so the "see each chapter's own `README.md`" sentence at L16 holds.
- **L29** `workbench/TitleBar.vue`. Name both apps' real files: `packages/workbench/src/components/TitleBar.vue`
  (shared) and `apps/kira-studio/frontend/src/workbench/TitleBar.vue`. Verify which one draws the
  hidden-inset bar.
- **L32** Renderer build.
  - `views/repo/monacoEntry.ts` is now `packages/workbench/src/editor/monacoEntry.ts`.
  - `editor/monaco.ts` is now `packages/workbench/src/editor/monaco.ts`.
  - The "re-exports it unchanged" `views/repo/monaco.ts` note moves to Kira Space:
    `apps/kira-space/frontend/src/views/repo/monaco.ts`.
  - Every bundle figure (index 1 315.59 kB / 387.37 kB gzip, monacoEntry 3.81 MB / 972 KB,
    editor.worker 300 KB) predates v1.9 (P98-P112 added Pinia/Query/shadcn/reka, and P100 dropped
    git-ui).
  - Run `bun run build:studio` once. Replace each figure with the new number and date the
    measurement "(v1.9 P109)". This is a stated fact that is now wrong, not a ritual measurement.
  - Also confirm the four lazy chunks still exist under the names given (`sqlFormatterEntry`,
    two `fakerEntry`, `generators`).
- **L34** Styling.
  - `alertVariants` lives in `packages/theme/src/components/ui/alert/`. Qualify it.
  - `tailwind-theme.css` is `packages/kira-ui/src/theme/tailwind-theme.css`. Qualify it.
  - `createSettingsStore.ts` is `packages/workbench/src/state/createSettingsStore.ts`. Qualify it.
  - Checked: the Resizable claim holds. Every non-`resizable/` `SplitterGroup`/`SplitterPanel` hit
    (`WorkbenchShell.vue`, `CellEditorDock.vue`) is a comment or a type-only import.
- **L35** Frontend library baseline. Rewrite it as present-tense fact (§2.1 draft). What is wrong
  now:
  - `theme/base.css` and `theme/shadcn-bridge.css` are really `packages/theme/src/…`.
  - "Pinia/Query registered at `main.ts`" is wrong: `createPinia()` is in each app's
    `frontend/src/state/pinia.ts`, and `VueQueryPlugin` is in each app's `main.ts`.
  - "P99 migrated … 39 `reactive()` state modules and 200 `.vue` files" is phase history. The
    current fact is 70 `defineStore` calls, recounted with
    `grep -rn "defineStore(" --include=*.ts apps packages | grep -v /tests/`.
  - "the 17 fetched `components/ui/*` sets" is now 20: alert, badge, button, checkbox, command,
    dialog, dropdown-menu, empty, field, input, input-group, label, native-select, popover,
    resizable, separator, textarea, toggle, toggle-group, tooltip.
  - "`PanelSplitter`/… replaced by reka's `Splitter*`" contradicts L34. The shadcn `Resizable`
    wrappers are the mechanism now.
  - "`.p-*` rules … survive" is contradicted two sentences later by "P110 finished the CSS half".
  - The long registry-fetch procedure moves to DEV_ENVIRONMENT (§1.2). Leave a one-line pointer.
  - Keep the row-component `cn(...)` convention and the `Empty` note. Both are current.
  - Verify `packages/workbench/src/workbench.css`'s "two non-comment lines" claim; the file is 28
    lines.
- **L43** The Lint row names Biome, golangci-lint and knip only. Add the two repo scripts `bun run
  lint` also runs: `scripts/check-theme-classes.sh` and `scripts/check-class-conflicts.ts`. Also
  `check-tokens.sh`, which P106 L2447 shows running under `bun run lint`. Confirm the exact set
  from `package.json`'s `lint` script.
- **L46** "Testcontainers, driven from Bun" is stale. Real-container DB tests are Go
  (`testcontainers-go` under `apps/kira-studio/internal/adapters/testsupport/`). Bun only drives
  `e2e-real`'s seeding through `packages/db-fixtures/support/*.ts`. Change to say so.
- **L49** SlickGrid row.
  - `theme/floatingPosition.ts` is now `packages/workbench/src/util/floatingPosition.ts`.
  - `PopoverPanel.vue` was deleted in P104. The popover primitive is shadcn `ui/popover` (Studio)
    and `KuiPopoverPanel` (`packages/kira-ui`). Replace it.
  - The `@tanstack/vue-virtual` consumer list names two files. The current set is
    `OperationsPanel.vue`, `KeyValuePane.vue`, `grpcrequest/ResponsePane.vue`, `BrowseView.vue`,
    `StreamView.vue`, `DocumentView.vue`, `ConsoleResultGrid.vue`, `packages/workbench/src/util/virtualRows.ts`
    and `treeVirtualRows.ts`. Name `virtualRows.ts`/`treeVirtualRows.ts` as the two shared
    wrappers and say "every list view" rather than an enumerated list that drifts.
  - `ConsoleSlickGrid.vue` also imports it. Verify whether that is a type-only import.
- **L53** MCP row. Drop the repo-map sentences and the historical +12.38 MB figure. Keep only
  "the SDK, over Streamable HTTP, for `internal/dbmcp`" plus the decline reasoning. The row's own
  parenthetical title keeps one "(repo-map server removed in v1.9 P97)" clause at most.
- **L54** Native file viewer row. This is Kira Space now.
  - Prefix the row "(Kira Space)".
  - `views/repo/monacoEntry.ts` becomes `packages/workbench/src/editor/monacoEntry.ts`.
  - "Added to the root `package.json`" needs verifying: after P100/P103, `monaco-editor` may be a
    dependency of `packages/workbench` and each app's `frontend/package.json`.
  - Verify "All 84 basic languages … `register.all.js`" against the shared `monacoEntry.ts`.
- **L55** Delete the whole "Quick open fuzzy matching (C9)" row. P100 Part 2 dropped QuickOpen
  and the `fuzzysort` dependency (SPEC L1015-1016, L1027). `fuzzysort` has zero source hits.
- **L66-67** The cgo file list names `internal/secrets`, `internal/metrics`, `internal/localauth`
  and `internal/gitclient` with no app prefix. Change to `apps/kira-studio/internal/{secrets,metrics,localauth}`
  and `apps/kira-space/internal/gitclient`.
- **L75-78** App identity names only Kira Studio. Add Kira Space: app name **Kira Space**, bundle
  ID read from `apps/kira-space/build/config.yml` or the darwin `Info.plist` template, and
  executable `Contents/MacOS/Kira Space`.

### 1.4 `ARCHITECTURE.md` — Invariants, Adapter contract, Per-engine (L80-452)

These are pre-chapter leftovers that are still wrong. Find each by grep.

- **L111-113** `internal/shell`'s `NewDeferredBrowser`. The path is repo-root
  `internal/shell/wails.go`. Say "repo-root" once.
- `nativeKinds[...]` no longer exists; the only survivor is a stale comment at
  `apps/kira-studio/internal/storage/repos/connections.go:172`. Delete the claim or restate what
  replaced it (the adapter registry `loaders` map, per L127).
- `internal/adapters/postgres/query.go`'s `runWithAbortRace` is now `adapters.RunWithAbortRace` in
  `apps/kira-studio/internal/adapters/abort.go`.
- `adapterhost.Router.ChildRoutes()` is gone. Delete the sentence, or restate it after one
  `codegraph_explore` on "adapterhost Router routes".
- `produce.go`'s `previewProduce` is now `preview` (`produce.go:38`).
- Any sentence framing an adapter as answering "from the Node engine child" in the present tense
  is obsolete; the child was deleted in P58f. Past-tense history stays.

### 1.5 `ARCHITECTURE.md` — Storage (L453-1361)

- **Structural bug.**
  - `### The native code workspace (C5-C9)` starts at L885, *inside* `## Storage`. Its opening
    line says to read "this app" as Kira Space.
  - But it runs to L1361 and swallows Kira Studio's own storage paragraphs at L1184-1360: the gRPC
    `protocol` column, gRPC response pane, S3/SQS credential columns, the P23 growth bounds and
    DataGrip import.
  - Fix per §2.3.
- **L1124-1173** Delete the whole Quick open (C9) block: `fuzzysort`, `repo/QuickOpen.vue`,
  `dropQuickOpen`, `QUICK_OPEN_MAX_*`. None of it exists.
- **L1175-1182** "Why a content snapshot and not just a commit sha" belongs to `review.db`. Move it
  to directly after the `review.db` paragraph (L867-883).
- **L606 schema block.** Add `op_log.path TEXT` (migration `0027_p108part11_op_log_path.sql`, P108
  Part 11 F5). Add the `custom_scripts` table (migration 0024, P85): `id, name, command,
  working_dir, color, sort_order, created_at, updated_at`. Read the migration for exact
  types/constraints.
- **L674-682** The migration high-water mark is now **0027**. Recount with `ls
  apps/kira-studio/internal/storage/migrations/`. Add Kira Space's own two: `0001_init.sql`,
  `0002_p100_tabs_layout.sql`.
- **L1245-1261** The growth-bound table has no `custom_scripts` or `connection_mask_rules` row.
  Add both, with each table's real bound or "bounded by user action (one row per script / rule)".
  Read the repo code for any cap.
- Every C5-C8 path inside the moved block (§2.3) takes its Kira Space location:
  - `views/repo/monarch/decorators.ts` becomes `packages/workbench/src/editor/monarch/decorators.ts`.
  - `internal/codeworkspace` becomes `apps/kira-space/internal/codeworkspace`.
  - `views/repo/{RepoFileView.vue,language.ts,monaco.ts,reveal.ts,markdownReading.ts}`,
    `repo/state/fileTree.ts` and `state/coderepos.ts` get the `apps/kira-space/frontend/src/`
    prefix once, in the block's opening paragraph ("relative to `apps/kira-space/frontend/src`"),
    not per mention.
  - L951 `internal/pathsafe since C8` is repo-root `internal/pathsafe` now.
- The block's opening paragraph (L887-899) says "C5-C9" and "markdown reading". With C9 gone,
  retitle it `### The native code workspace (C5-C7, P67c)` and drop the quick-open mention from the
  bullets at L1169-1173 (they move with the C9 deletion).

### 1.6 `ARCHITECTURE.md` — Caching and UI architecture (L1362-2234)

- **Caching (L1362-1428).** There is no renderer-side tier. Add a short "Renderer server-state
  cache (TanStack Query)" paragraph (§2.2 draft). The Process model's P112 paragraph (L2478-2485)
  is the only place the cache is currently described.
- **L1456, L1464, L1480** `modeState` is now the Pinia `useModeStore` (`state/mode.ts`).
  - `incognitoState` is now `useTabIncognitoStore` (`state/tabIncognito.ts`: `isIncognito`,
    `setIncognito`, `registerIncognitoSetListener`).
  - `tabsState` is the Pinia tabs store (`packages/workbench/src/state/createTabsStore.ts`,
    instantiated per app in `state/tabs.ts`).
  - Rename every mention and check each described method still exists with
    `codegraph_explore "useModeStore useTabIncognitoStore createTabsStore"`.
- **L1473** `unreachableTabKind`. Still exists (`state/tabKinds.ts`, `workbench/tabViews.ts`,
  `packages/shared/domain/tabs.ts`). Verify the paragraph against P103 Part 2's `TabScope`
  vocabulary split: `state/tabDomain.ts` in both apps and `packages/workbench/src/tabs/types.ts`.
- **L1535-1539** `MainView.vue` and `TabStrip.vue` are now in `packages/workbench/src/components/`.
  `MainView` resolves `host.views[activeTab.kind]` through `useWorkbenchHost()`
  (`packages/workbench/src/host.ts`), with a `#empty` slot fallback. Studio's `workbench/modes.ts`
  (`MODES`) still exists. Rewrite this dispatch paragraph.
- **L1508** `primitives/` note. Accurate as history; keep.
- **L1586-1616** The rename-history rows (`internal/httpvars`, `frontend/src/http/`,
  `internal/apistore`, `internal/bridge/ipcerr`) are intentional history. Keep, but:
  - **L1611** `http/VariablesDialog.vue` becomes `api/VariablesDialog.vue`.
  - **L1613-1621** `internal/ipcerr` is repo-root now. `layering_test.go` exists in both apps
    (`apps/*/internal/layering_test.go`) plus a shared helper `internal/layeringtest`. Say so.
- **L1607** `mockRuntime.ts`'s `BRIDGE_PKG` and "106 `FQN_SUFFIX_BY_IPC_KEY` entries". Recount.
  There are now two mock runtimes: `packages/workbench/src/testing/ui/mockRuntime.ts` (shared) and
  each app's `tests/ui/support/mockRuntime.ts`. Name which one holds the table.
- **L1653-1671** The "`packages/api-ui` does not exist / would need `packages/ui-kit`" rationale is
  stale. `packages/theme`, `packages/workbench` and `packages/kira-ui` exist; `CodeMirrorHost` and
  `editor/theme` are gone. Rewrite as: Api UI stays inside `apps/kira-studio/frontend/src/api/`
  because only Studio hosts it. Shared UI lives in `packages/theme` (shadcn-vue `components/ui`),
  `packages/workbench` (shell, stores, editor) and `packages/kira-ui` (git-side `Kui*`).
- **L2027-2032**
  - `views/httprequest/history.ts` is described as a `createRuntimeStore`. It is a Pinia store
    (`httpHistory`), and the response history is `createHistoryStore` in `api/state/history.ts`.
    Verify both with one `codegraph_explore`.
  - The `collectionsList`/`variablesListEnvironments` "fetched once, uncaught" shape is now
    TanStack Query (`api/state/apiQueries.ts`). Rewrite it.
- **L2059** The `ReconnectGate` component was inlined in P104; only comments remain. Describe the
  inlined markup, or drop the component name.
- **L2175** `IconButton icon="discard"`. The `IconButton` primitive was deleted in P104. Name the
  real `Button` (`variant`/`size="icon"`) call.
- **L2222** `DataGrid.vue`'s `colorForColumn` does not exist. Row colouring lives in
  `views/grid/SlickGridHost.vue`, `views/console/ConsoleSlickGrid.vue`,
  `views/shared/slick/slickTheme.css` and `state/settingsDomain.ts`.
- **L2229-2231**
  - The `(:66-67)` line pointer is stale; the invariant is now at about L88. Replace it with a
    heading reference ("see Invariants") rather than a line number.
  - The `v-tooltip` directive was deleted in P104. Name shadcn `Tooltip`.

### 1.7 `ARCHITECTURE.md` — Process model, Git module, DB MCP, security, Testing (L2235-3828)

- **L2279-2280** `internal/startupfail` is repo-root. Fine as written.
- **L2291** `internal/shell.AttachSystemWake`. It is `apps/kira-studio/internal/appshell/wake.go`'s
  `AttachSystemWake`. Only `AttachReopen` is in repo-root `internal/shell`.
- **L2363, L2462** `internal/enginebackend`, `internal/enginehost` are deleted-history mentions.
  Keep.
- **L2430-2452** "registering **29** bound services … pre-existing staleness this phase found but
  did not fully re-audit, out of P100's own scope". Re-audit now:
  - Rewrite the paragraph as a flat current list of Kira Studio's 29 `application.NewService`
    calls, grouped shell/Studio/Api/MCP/agent.
  - Mention Kira Space's 10 in one sentence (`grep -c application.NewService apps/*/main.go`).
  - Drop the "not the twenty-two" history.
  - `internal/storage/`, `internal/tree/` etc. take the `apps/kira-studio/` prefix once.
- **L2491-2492** `internal/storage/model.WindowRecord`, `frontend/src/state/window.ts`.
  - The window key is now read in `packages/workbench/src/util/window.ts` (`new
    URLSearchParams(location.search).get('window') ?? 'main'`).
  - `WindowRecord` is aliased through repo-root `internal/appstorage`.
- **L2512** `appcore.Emitter` is now repo-root `internal/appevent.Emitter`. Each app's
  `bridge.Events` embeds `*appevent.Events`, and `internal/shell/wails.go`'s `emitter` implements
  it.
- **L2598-2599** "`internal/shell` stays the only package importing `pkg/application`". Stale:
  each app's `internal/appshell` (e.g. `wake.go`) and `main.go` import it too. Change to "only
  `internal/shell`, each app's `internal/appshell`, and each `main.go`".
- **L2794-2819** Session model. "pairing prompts always stay in Kira Studio", "Kira Studio's own
  native window" and "Kira Studio's own Settings dialog (*Git* section)" should all say **Kira
  Space**. The section banner at L2605 covers intent, but these are plain factual errors a reader
  hits mid-section.
- **L2805-2806** `frontend/src/state/gitCredential.ts` and `workbench/GitCredentialDialog.vue` both
  exist under `apps/kira-space/frontend/src/`. Prefix them.
- **L2833** `internal/layering_test.go` becomes `apps/kira-space/internal/layering_test.go`.
- **L2849** `gitrpc` "**51 request methods**" is stale. `requestHandlers` has **56** entries
  (`apps/kira-space/internal/gitrpc/handlers.go:159`), which matches L3089's own "56 requests".
  Change to 56.
- **L2858** `bridge/gitclients.go` becomes `apps/kira-space/internal/bridge/gitclients.go`.
- **L3034-3036** The "pre-existing naming drift: … `RepoPanel.vue`; the file … today is
  `GitPanel.vue` — out of this phase's own scope" note is exactly P109's scope.
  - Replace every `RepoPanel.vue` with `GitPanel.vue` (L3034, L3194, L3202, L3205, L3988) and
    delete the drift note.
  - L3204 `<component :is="activeModePanel" />`: `activeModePanel` now lives in
    `apps/kira-space/frontend/src/repo/GitPanel.vue` itself, not `WorkbenchShell.vue`. Verify and
    fix.
- **L3046** `internal/bridge/gitstream.go` becomes `apps/kira-space/internal/bridge/gitstream.go`.
  L3052 "Kira Studio's own renderer" should say Kira Space.
- **L3060-3061** `MainView.vue` … `KEEP_ALIVE_VIEWS = ['RepoGraphView']`. `KEEP_ALIVE_VIEWS` now
  appears only in a test (`apps/kira-space/tests/ui/repo-workspace.spec.ts`). Find the live
  `KeepAlive`/`include` site (`packages/workbench/src/components/MainView.vue`, or Kira Space's
  host) and rewrite it.
  `RepoGraphView.vue:10`'s own comment says "(Studio only)", which is stale too, but that is
  source, out of scope (§5).
- **L3167, L3927** `theme/vscode-bridge.css` becomes `packages/theme/src/vscode-bridge.css`.
- **L3174-3181** `theme/app-shell.css` is `packages/git-ui/src/theme/app-shell.css`. The
  "`.p-check` … this package is explicitly out of that phase's scope" note predates P110, which
  gave git-ui its own `kv:` Tailwind root. Verify that the checkbox rule still exists in
  `app-shell.css`, and rewrite to the current state.
- **L3194** `SegmentedControl` option. The primitive was deleted in P104. Name the real control:
  `ui/toggle-group` or `KuiSegmented`. Verify in `GitPanel.vue`.
- **L3224** "Kira Studio's Wails webview" should say Kira Space's.
- **L3304-3305** "`ContractVersion` was 39 as of this chapter — 40 as of P100". Now **41** (P111).
  Change to "41 today (P111); see Transport".
- **L3313, L3342** `workbench/StatusBar.vue` and `state/blameStatus.ts` are Kira Space's
  (`apps/kira-space/frontend/src/workbench/StatusBar.vue`, which wraps
  `packages/workbench/src/components/StatusBar.vue`). Verify which one holds LAW 14's comment.
- **L3387** `internal/bridge/dbmcp.go:22-25`; **L3397** `server.go:202-225`. Re-point to the
  symbol names (`dbMcpTokenName`, the tool-registration function). Line ranges drift.
- **L3431-3432** `workbench/DbMcpApprovalDialog.vue` "at `App.vue`'s root beside
  `GitPairingDialog.vue`". `GitPairingDialog` is Kira Space's now. Change to "beside Studio's
  other always-mounted dialogs". Note `packages/workbench/src/components/ConfirmDialog.vue`
  references it; verify.
- **L3481-3482** "`workbench/SettingsDialog.vue`'s `sections` array has **ten** entries". Now
  `apps/kira-studio/frontend/src/state/settings.ts` `sections`, with **eight** entries: Appearance,
  Data, Cache, Api, Scripts, Claude Code, Database MCP, Advanced.
- **L3489** `views/grid/menu.ts:619`. Use the symbol name instead of the line.
- **L3501, L3581, L3634** `apps/kira-studio/internal/shell/security.go`/`security_test.go` become
  repo-root `internal/shell/security.go`/`security_test.go`.
  - **L3582, L3635** `menutemplate_test.go` does not exist. It is `internal/shell/menu_test.go`
    (verify that it covers the template), and `menutemplate.go` exists beside it.
- **L3520-3525** Kira Studio's `LinkService` "no live caller" note. It is still true for Studio,
  but the wrapper is now shared `packages/workbench/src/bridge/createCoreControl.ts`
  `linkOpenExternal`. Kira Space calls it (`repo/git/hostHandlers.ts:433`) and binds its own
  `apps/kira-space/internal/bridge/link.go`. Rewrite to match, and point at the Known open item
  (§1.9).
- **L3566** `TextField.vue` was deleted in P104. Change to "every text input (shadcn `ui/input`,
  `AutocompleteField.vue`)" and verify that `autocomplete="off"` still holds with
  `grep -rn 'autocomplete=' --include=*.vue`.
- **L3570** "`clipboard.ts`'s `copyText` (38 call sites)". It is now
  `packages/workbench/src/util/clipboard.ts` (VueUse `useClipboard`); 27 files import `copyText`.
  Recount call sites or drop the number.
- **L3577-3579** "`window.confirm()` still gates six destructive actions … a UI change for a
  future phase". Resolved. `packages/workbench/src/state/confirmDialog.ts` ("Replaces
  window.confirm() for every destructive action") plus `ConfirmDialog.vue`. Delete the bullet, or
  restate it as the in-app confirm store.
- **L3592-3596** "Four suites under `apps/kira-studio/tests/`": add `visual/` (five dirs: `unit/`,
  `ipc/`, `ui/`, `e2e-real/`, `visual/`) or say "four functional suites plus `visual/`".
- **L3602** The rename history for `apps/kira-studio-vscode/tests/`. Keep.
- **L3607-3615** The `git-pairing-real.spec.ts` gap. Keep as the Testing-section fact and add a
  Known open item (§2.5).
- **L3635** `tests/unit/support/wailsRuntime.ts` becomes `packages/workbench/src/testing/unit/wailsRuntime.ts`.
- **L3647-3649** "six `support/*.ts` modules (`connectionConfig`, `docker`, `postgres`, `mariadb`,
  `sqlite`, `kafka`)". There are seven now; `common.ts` is added.
- **L3733-3734** "252 tests across 47 spec files" (a v1.4 recount). There are 53 spec files in
  `apps/kira-studio/tests/ui/` now. Recount tests with `bunx playwright test --list --project=ui`
  from `apps/kira-studio`, or state only the file count.
- **L3771** `tests/visual/` "five specs". There are six: `settings.spec.ts` was added, with 8
  per-section snapshots. Name it.
- **L3752** `e2e-real` "four specs … six tests". Four specs confirmed. Recount tests.
- **L3787** `bun run test:webview` is still valid.
- **L3817** "`playwright.config.ts` runs five projects". This is `apps/kira-studio/playwright.config.ts`
  (confirmed: ui, ui-timing, ipc-frontend, visual, e2e-real). Qualify the path. Kira Space has its
  own `apps/kira-space/playwright.config.ts` and `apps/kira-space-vscode/playwright.config.ts`;
  one sentence each.

### 1.8 READMEs

**Root `README.md`**

- **L141-144** Settings lists four sections. Studio has eight (Appearance, Data, Cache, Api,
  Scripts, Claude Code, Database MCP, Advanced). Add the four missing ones in one clause each.
- **L173-174** "8766 by default, falling back to an OS-assigned one if that's taken" is stale
  (P108 F11). Change to: "fixed port 8766 — if another process holds it, enabling the server fails
  with a message saying so".
- **L263** `generate:wire` "from `wire.fbs`". It regenerates both `packages/shared/protocol/wire.fbs`
  and `packages/git-ipc/schema/gitwire.fbs` (P106 L2405).
- **L274-276** Git hooks: "about six seconds". Align with DEV_ENV's ~15s, or drop the figure. Add
  the pre-push hook (`go build ./...`, `bun run lint:go`, `bun run lint:dead`).
- **L319** "Two facts worth knowing" introduces three bullets. Change to "A few facts".
- **L329-351** The layout block has no `packages/workbench` (the shared workbench shell, Pinia
  store factories, editor bootstrap, test harnesses) and no repo-root `internal/` (Go shared by
  both apps: `shell`, `appevent`, `rpcstream`, `ipcerr`, `startupfail`, …).
  - Add both.
  - `packages/theme` now also carries the shadcn-vue `components/ui` sets. Say so.
  - `packages/kira-ui`: confirm which apps import it and keep "Kira Space's workbench and the git
    webviews" if Studio does not.
- **L416** "Not shipped: Light mode". The README says "Dark mode only" (L31). Confirm no
  light-theme setting exists (`grep -rn "'light'" packages/shared/domain/settings.ts` is empty),
  and keep it.

**`apps/kira-space/README.md`**

- **L32** Delete the "**Quick Open (⌘P)**" bullet. It was removed in P100 Part 2.
- **L46-48** "a native **Git** module in this window (its own `AppMode`, …)". Kira Space has no
  `AppMode`/mode switcher (ARCHITECTURE L2615-2620). Change to "this window's own native
  workspace".
- **L7-8** "The same backend also serves **Kira Space** (`apps/kira-space-vscode`)" reads as
  self-reference. Change to "the **Kira Space VS Code extension** (`apps/kira-space-vscode`)".
- **L222-232** The Architecture block has no `packages/workbench`, `packages/theme` or repo-root
  `internal/`. Add them, as in the root README.

**Other READMEs**

- **`apps/kira-space-vscode/README.md`** Checked: panel "Kira" and activity-bar view "Kira Space"
  match the manifest's views. 47 commands; engines `^1.134.0` matches the Kira Space README L130.
  No change.
- **`apps/kira-studio/README.md`** Checked. No change.
- **`apps/kira-studio/tests/visual/README.md` L3** "Five specs" should be six. Add the Settings
  panes.
- **`packages/api-core/README.md` L5** "No Vue, no CodeMirror" names a removed dependency. Change
  to "No Vue, no DOM, no `apps/` import".
- **`scripts/demo-dbs/README.md` L18** `packages/db-fixtures/support/sqs.ts`/`s3.ts` do not exist.
  The LocalStack harness is Go: `apps/kira-studio/internal/adapters/testsupport/localstack.go`.
  Re-point to it.
- **`scripts/demo-dbs/README.md` L50/L66** `sqlite/kira-demo.sqlite` is generated by `seed.sh`.
  Fine.

### 1.9 `ARCHITECTURE.md` — Known open items (L3829-4022)

Each surviving entry below names its re-check.

**Keep, re-verified at `f20298d1`:**

- ipcfixture fixtures stale (L3834). Still open: no `keyTypes` and no `mcp_*_mode` in any
  `testdata/*.fixture.json`.
  - "`CLAUDE.md`'s P25 section" is not a heading. Change to "`CLAUDE.md`'s real-container
    two-suite rule".
  - Drop "Predates this chapter entirely — not caused by M1/M2/M3". That is v1.7-chapter framing.
- `maskedColumnRenamedOrHidden` view blind spot (L3846). The symbol still exists in
  `dbmcp/render.go`.
- M5 correlation-tag provenance (L3855). Accepted by design. Keep.
- JSON/array over-refusal, F1 (L3868). `renderPage` still exists.
- Unmasked response bodies, F16 (L3878). `maskGrpcResult` and `maskSecrets` still exist.
  - `maskSecrets` now lives in `httpclient/{wire,options}.go`, not only `bridge/http.go`. Fix the
    location.
- SQL splitter compound bodies, F4 (L3888). `scanSqlSpan` still drives `sql-split.ts`.
- First-launch window clamp (L3899). `shell.DefaultBounds` is now repo-root
  `internal/shell/window.go`. `main.go`'s `openWindow` may now be `internal/shell/openwindow.go`;
  verify with `codegraph_explore "openWindow DefaultBounds"` and fix the location.
- Kira Space block, with the banner L3910-3914:
  - Keep: C5 tree (L3916), `.vue`/`.svelte` (L3921, still `svelte: 'html'` in `language.ts`), the
    `vscode-bridge.css` specificity item (L3925, with its path fixed), the three C7 search items,
    native-graph dual `Conn` (L3955), review-session expiry (L3969), no merge/rebase (L3976, no
    `MergeDialog`; P111 only added a pull `rebaseMerges` flag), both Correctness items (the
    `RepoPanel.vue` mention becomes `GitPanel.vue`; `pendingReviewTargetByCodeRepoId` still exists).
  - Perf, file-tree filter (L3997): the file moved into Pinia `useFileTreeStore`. Verify the
    filter computed still does per-row `status`/`expanded` reactive lookups. Delete the entry if
    not.
  - Perf, comment-reload fan-out (L4000): keep.

**Delete (resolved or moot this chapter):**

- The C9 quick-open items at L3944, L3947 and L3951, plus "No debounce on the quick-open
  palette's keystroke handler" at L4003. QuickOpen was removed in P100 Part 2.
- Fix the banner at L3910: it says "from here through 'No debounce on the quick-open…'". Re-anchor
  it to the new last Kira Space item.

**Misplaced:**

- `internal/dbmcp/http.go` timeouts (L3962) is a Kira Studio item sitting inside the Kira Space
  block. Move it above the banner, next to the other dbmcp items. Still true: only
  `ReadHeaderTimeout` is set.

**Rewrite:**

- `LinkService` (L4007). Still true for Studio: `main.go` binds `LinkService`, and no Studio code
  calls `linkOpenExternal`. The wrapper moved to shared `createCoreControl.ts`, where it is live
  for Kira Space. Rewrite the location sentence.
- `pr.yml` Kira Space coverage (L4014).
  - `docs/pending-changes/.github__workflows__pr.yml.patch` now stages `bun run build:space` in
    both jobs (P108 Part 2 F4) and retargets the darwin `go test` list (F3). It is still
    unapplied.
  - `build:vscode`, `test:webview` and `test:ui:space` are still absent from CI, even with the
    patch applied.
  - Rewrite to name both facts.
- Add the new items from §2.5.

## 2. Drafted content

These are the drafts for new or restructured text. The implementer may tighten wording but keeps
every fact.

### 2.1 ARCHITECTURE Stack row: "Frontend library baseline" (replaces L35's first half)

> | Frontend library baseline | Vue 3.5 + Vite; Tailwind v4 CSS-first (`packages/theme/src/base.css`,
> `--kira-*` tokens); shadcn-vue on Reka UI (`packages/theme/src/components/ui/*`, 20 sets, palette
> bridged in `shadcn-bridge.css`); Pinia for client state; TanStack Query for server state; VueUse
> for DOM composables; `@tanstack/vue-virtual` for list virtualization | Each app creates one Pinia
> instance (`frontend/src/state/pinia.ts`) and one `QueryClient` (`VueQueryPlugin` in `main.ts`,
> client from `packages/workbench/src/state/queryClient.ts`). Shared store factories —
> `createTabsStore`, `createLayoutStore`, `createSettingsStore`, `createTerminalsStore`, plus
> `confirmDialog`/`contextMenu` — live in `packages/workbench/src/state/`; each app instantiates
> them and adds its own single-concern stores (70 `defineStore` calls across both apps). No
> hand-rolled UI primitive remains: P104 deleted `theme/primitives/*` for `components/ui/*`, P110
> converted every `.p-*` rule and component `<style>` block to Tailwind utilities/`@theme` tokens.
> `packages/theme/src/primitives.css` keeps one unlayered rule (`.p-input.is-grow`, no utility
> equivalent). `packages/git-ui` runs its own `kv:`-prefixed Tailwind root (`packages/git-ui/src/theme/`),
> side by side with the app root on Kira Space's page. Adding a shadcn-vue set: see
> `docs/DEV_ENVIRONMENT.md`'s shadcn-vue section. `Empty` (`components/ui/empty/`) is the one
> empty-state component. Row components take `class` and own their selection ternary
> (`TreeRow.vue`, `CollectionRow.vue`, `RepoTreeRow.vue`, `RepoSearchRow.vue`) — [keep existing
> sentence verbatim from "bind `cn(`" to the end] |

### 2.2 ARCHITECTURE Caching: new closing paragraph

> **Renderer server-state cache (TanStack Query, P99/P112).** Above the three Go tiers, the
> renderer caches bridge-fetched server state in one `QueryClient` per window
> (`packages/workbench/src/state/queryClient.ts`). The API client's collections tree, saved
> HTTP/gRPC requests, variables, environments and active environment are query entries
> (`apps/kira-studio/frontend/src/api/state/apiQueries.ts`) with `staleTime: Infinity`: never
> refetched on a timer, only invalidated. Go broadcasts `kira:api:dataChanged` on every API-data
> mutation (`bridge/apidata.go`'s `emitApiData`), carrying a batch of `{kind, ...scope}` changes;
> the boot-time listener maps each to `queryClient.invalidateQueries`, so every window refetches
> exactly the scopes that changed. `draftMerge.ts` keeps an unsaved edit in the active window from
> being clobbered by that refetch. Other `useQuery` consumers (the Database MCP pane, the
> connection dialog, grid mask-rule/preview state, the console) use the same client with their
> own keys. See Process model's multi-window paragraph for the cross-window contract.

Before committing, the implementer checks each consumer name against `grep -rln "useQuery("`.

### 2.3 ARCHITECTURE structural move (the C5-C9 block)

1. Cut L1175-1182 ("Why a content snapshot…") and paste it directly after L883, the `review.db`
   paragraph's last line.
2. Delete L1124-1173, the Quick open (C9) block, including the "Opening reuses C7's own
   convention" bullets that belong to it.
3. Cut the remaining L885-1123 (`### The native code workspace (C5-C9)` through the end of the
   P67c markdown paragraph). `## Storage` now flows from the `review.db` paragraphs straight into
   the gRPC `protocol` paragraph.
4. Paste the cut block into `## Git module` as `### The native code workspace (C5-C7, P67c)`,
   immediately before `### Git graph in the native workspace (C10)`.
5. Fix L3033's "(C5-C9, above)" to "(C5-C7, above)".
6. Apply §1.5's path fixes inside the moved block.
7. The block's own P100 banner (L887-899) stays and is trimmed. The section banner at L2605
   already says everything in `## Git module` is Kira Space, so drop the "read every unqualified
   'this app' as Kira Space" sentence as redundant.

### 2.4 DEV_ENVIRONMENT new sections

> ## shadcn-vue — adding a component set in this environment
>
> `shadcn-vue add` cannot run here: this repo has no `components.json`/CLI wiring. Pull from the
> registry directly:
>
> 1. `curl -sS "https://shadcn-vue.com/r/styles/reka-nova/<name>.json" -o /tmp/<name>.json`.
> 2. For each `files[]` entry, strip the `styles/reka-nova/ui/` prefix and write it under
>    `packages/theme/src/components/ui/<name>/`.
> 3. Rewrite `@/lib/utils` to `@theme/lib/utils`, and any `@/…` sibling import to
>    `@theme/components/ui/…`.
> 4. Pull `registryDependencies` recursively the same way; check `dependencies` against the root
>    `package.json` before adding anything (and against `CLAUDE.md`'s open-source-only rule).
> 5. Run `bun run format` over the new files.
>
> P110 iter2 used this for `empty` and for `resizable`'s `ResizablePanel`/`ResizablePanelGroup`.
>
> ## CodeGraph — the code index in this environment
>
> `CLAUDE.md` says how to navigate with CodeGraph; this is the setup. `.claude/hooks/session-start.sh`
> (a `SessionStart` hook in `.claude/settings.json`) runs only when `CLAUDE_CODE_REMOTE=true`: it
> installs `@colbymchenry/codegraph` globally via `npm` if missing, then `codegraph sync .` (or
> `codegraph init .` on first run) and prints `codegraph status .`. The index lives in
> `.codegraph/` (gitignored). `.mcp.json` registers `codegraph serve --mcp`; its one tool is
> `codegraph_explore`, deferred until `ToolSearch` loads it. A `UserPromptSubmit` hook
> (`codegraph prompt-hook`) injects matching symbols into every prompt. Outside a remote session
> none of this runs — install and `codegraph init .` by hand.

### 2.5 New Known open items

- **Kira Space has no full-stack (`e2e-real`) tier, so git pairing has no real-socket test.**
  `git-pairing-real.spec.ts` was deleted at P100 rather than ported. Nothing drives pairing,
  token reuse or revocation against a real `-tags server` Kira Space binary and a real
  `git.sock`. Go unit tests cover `gitsock` in-process only. Closing it needs a Kira Space
  `e2e-real` project (fixtures, a `playwright.config.ts` project, the spec).
  - This limitation is currently stated only in Testing (L3607-3615).
- Check SPEC.md result sections P110-P114 once more for any "known limitation", "accepted" or
  "not fixed" line the planner may have missed:

  ```
  grep -n "accepted\|not fixed\|limitation\|remains open" docs/v1.9/SPEC.md
  ```

  Add each real, currently-true one found.
  - The planner found none beyond the item above.
  - The P108 Part 7/8/11 items are already recorded.
  - The P108 Part 11 "Deferred" unit failures are test failures, not limitations (§5).

### 2.6 `docs/v1.9/README.md` (new, mirrors `docs/v1.7/README.md`'s shape)

> # docs/v1.9/ — the v1.9 record
>
> v1.8 continued the running `P` sequence (P71-P95). This chapter continues it from P96: dropping
> the repo-map subsystem, adopting a frontend library baseline (Pinia, TanStack Query, VueUse,
> shadcn-vue, Tailwind) and migrating onto it, extracting the git module and native code
> workspace into a standalone app, **Kira Space** (P100), a shared app base both apps build on
> (P103), and a whole-codebase review (P108).
>
> - **`SPEC.md`** — the phases this chapter is built against, one row per phase, plus each phase's
>   own result section.
> - **`plans/`** — one plan per phase (or part/iteration), committed before implementation;
>   findings documents from audit phases sit beside them.

Before committing, check P71-P95 against v1.8's own `SPEC.md` phasing table (the SPEC, not the
v1.8 README).

## 3. File ownership and commit plan

**One sequential implementer. No split.** Why:

- `ARCHITECTURE.md` carries about 75% of the edits and is one file. Two streams would edit the
  same file.
- The cross-file moves (L35's shadcn procedure into DEV_ENVIRONMENT, and the Known-open-items
  items that mirror README/Testing prose) chain across files.
- The final scan pass must run over everything at once.
- The total is about 110 passages, a comfortable single-agent load.

Commits, in order. Each is a Conventional Commit with `docs:` and passes the normal hook.

1. `docs(claude): drop dead pointers (v1.8 path, codegraph_node, repo-map)`. §1.1.
2. `docs(dev-env): true up paths, script names, dbmcp port; add shadcn-vue and CodeGraph
   sections`. §1.2 and §2.4.
3. `docs(architecture): true up Stack table and header`. §1.3 and §2.1; includes the one `bun run
   build:studio` measurement.
4. `docs(architecture): true up adapter sections`. §1.4.
5. `docs(architecture): move native code workspace into Git module; drop quick open; storage
   schema to 0027`. §1.5 and §2.3.
6. `docs(architecture): true up caching and UI architecture for Pinia/TanStack Query`. §1.6 and
   §2.2.
7. `docs(architecture): true up process model, git module, DB MCP, security, testing`. §1.7.
8. `docs(architecture): prune and re-verify known open items`. §1.9 and §2.5.
9. `docs: true up READMEs; add docs/v1.9/README.md`. §1.8 and §2.6.
10. `docs: residual scan fixes (P109)`. Whatever §4.1's scans still report that is not on §4.2's
    list. Skip the commit if there is nothing.
11. `docs(v1.9): record P109 result`. Add `## P109 result` to `docs/v1.9/SPEC.md`: the commit list,
    counts, the A1-A8 outcomes, and the §5/§6 notes.

## 4. Verification

### 4.1 Scan scripts

Write each to the scratchpad and run it from the repo root.

`paths2.py` finds backticked paths in the docs that exist nowhere in `git ls-files`:

```python
import re, os, sys, subprocess
root = sys.argv[1]; docs = sys.argv[2:]
files = [f for f in subprocess.run(['git','-C',root,'ls-files'],capture_output=True,text=True).stdout.split('\n') if f]
dirs = {'/'.join(f.split('/')[:i]) for f in files for i in range(1, len(f.split('/')))}
allp = set(files) | dirs
GOSTD = re.compile(r'^(net|encoding|crypto|os|log|mime|database|runtime|text|application|multipart|golang\.org|google\.golang|github\.com|go\.|modernc|jackc|go-sql|redis/|aws-sdk|franz|bufbuild|mark3labs|google/|segmentio|yosida|golang-jwt|6pac|sourcegraph|keybase|bmatcuk|gobwas|rivo|stablyai|actions/|library/|clickhouse/|confluentinc|localstack|testcontainers|pgx|mongo-driver|go-sdk|tools/|pkg/application|GOPATH|darwin/|linux/|LIMIT|skip/|review\.comment|rounded-|monaco-editor|base/common|languages/|features/|string\.|commonDir|refs/|releases/)')
tok = re.compile(r'`([^`\s]+)`')
for d in docs:
    for n, line in enumerate(open(os.path.join(root, d)), 1):
        for t in tok.findall(line):
            t = t.strip('.,;:()')
            if '/' not in t and not re.search(r'\.(ts|vue|go|css|sh|json|yml|yaml|js)$', t): continue
            if t.startswith(('http','~','$','-','@','/','.')) or any(c in t for c in '*{<…'): continue
            if GOSTD.match(t) or '://' in t: continue
            p = t.split('#')[0].split(':')[0].rstrip('/')
            if not p or p in ('SPEC.md','plans','dist','logs','vendor'): continue
            if not [f for f in allp if f == p or f.endswith('/' + p)]:
                print(f"{d}:{n}: MISSING {t}")
```

Run it:

```
python3 paths2.py . CLAUDE.md docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md README.md apps/*/README.md packages/api-core/README.md scripts/demo-dbs/README.md apps/kira-studio/tests/visual/README.md docs/v1.9/README.md
```

At `f20298d1` this reported 123 hits for ARCHITECTURE alone.

`paths2.py` treats a bare relative name (`views/repo/RepoFileView.vue`) as found if *any* tracked
file ends with it. That is loose on purpose, since the docs use app-relative paths. It
under-reports a path that exists in the *wrong* app, so the grep in §4.3 and a read of each moved
section cover that case.

### 4.2 Intentional `MISSING` list

These may remain. Each must sit in a past-tense or build-output sentence.

- Build outputs: `frontend/dist`, `dist/assets`, `bin/*.vsix`, `test-results/`, `mcp-db-token.json`,
  `kira-demo.sqlite`, `Contents/Resources/kira-space.vsix`.
- Leading-dot paths the scanner strips: `.github/workflows/*`, `.githooks/*`, `.mcp.json`,
  `.claude/hooks/*`.
- Deleted-history: `src/engine/`, `tests/e2e/*`, `packages/db-fixtures/*.spec.ts`,
  `editor/CodeMirrorHost.vue`, `AppTooltip.vue`, `ui/scroll-area`, `ui/context-menu`,
  `packages/kira-ui/src/theme/controls.css`, `views/grid/DataGrid.vue`, `GridRow.vue`,
  `views/httprequest/mergeEntry.ts`, `internal/enginebackend`, `internal/enginehost`,
  `internal/repomap` (L53 at most), `internal/codeparse`, `internal/httpvars`, `internal/apistore`,
  `frontend/src/http/`, `internal/bridge/ipcerr`, `apps/kira-studio-vscode`,
  `packages/shared/domain/workspace.ts`, `apps/kira-studio/internal/bridge/rpcstream`,
  `git-pairing-real.spec.ts`, `security.spec.ts`, `menu.spec.ts`, `blameAge.ts` (the extension
  copy P62 deleted), `scripts/capture-*.ts`, `primitives/`.
- Third-party: `edcore.main.js`, `editor.main.js`, `register.all.js`, `register.js`,
  `standaloneThemeService.js`, `fuzzyScorer.js` (deleted with L55), `d.ts`, `pb.go`,
  `styles/reka-nova/ui/`, `idea/dataSources.xml`, `internal/operatingsystem` (Wails).
- Go symbol references the scanner reads as paths (`internal/apivars.Service`,
  `internal/datagrip.Scan`, `internal/appupdate.Checker` and similar): verify that each symbol
  exists; they are not files.

### 4.3 Retired-name grep

Run this over the target docs. Every hit must be past-tense history:

```
grep -nE "fuzzysort|QuickOpen|quick open|quick-open|nativeKinds|v-tooltip|PopoverPanel\.vue|IconButton|TextField\.vue|ReconnectGate|SegmentedControl|RepoPanel\.vue|codegraph_node|internal/repomap|colorForColumn|window\.confirm|appcore\.Emitter|modeState|tabsState|incognitoState|menutemplate_test|apps/kira-studio/internal/shell|ephemeral fallback|OS-assigned" CLAUDE.md docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md README.md apps/*/README.md packages/api-core/README.md scripts/demo-dbs/README.md apps/kira-studio/tests/visual/README.md
```

Expected survivors:

- `fuzzysort`/`QuickOpen`: zero.
- `v-tooltip`/`ReconnectGate`/`IconButton`/`TextField.vue`: only inside the P104 history clause.
- `internal/repomap`: at most one, on L53.
- `codegraph_node`, `appcore.Emitter`, `modeState`/`tabsState`/`incognitoState`,
  `apps/kira-studio/internal/shell`, "ephemeral fallback", "OS-assigned": zero.

### 4.4 Script names (A3)

```
node -e 'const s=require("./package.json").scripts;const fs=require("fs");for(const f of process.argv.slice(1)){fs.readFileSync(f,"utf8").split("\n").forEach((l,i)=>{for(const m of l.matchAll(/bun run ([a-z][\w:.-]*)/g))if(!s[m[1]])console.log(f+":"+(i+1)+": "+m[1])})}' CLAUDE.md docs/ARCHITECTURE.md docs/DEV_ENVIRONMENT.md README.md apps/*/README.md apps/kira-studio/tests/visual/README.md
```

Expect no output. `bun run test:unit`/`test:webview`/`typecheck:git` are still unscoped (P106).

### 4.5 Recount checklist (A7)

Each number is stated where §1 names it.

- The Studio bound-service count is 29, and Kira Space's is 10 (`grep -c application.NewService`).
- `gitrpc` has 56 requests plus 1 stream. `gitstream.go`'s allowlist admits 53 requests plus
  `graph.stream`, 54 in all. `ContractVersion` is 41 on both sides.
- There are 47 extension commands (manifest `contributes.commands`).
- There are 20 `components/ui` sets and 70 `defineStore` calls (excluding tests).
- Studio has 8 settings sections.
- The Studio migration high-water mark is `0027`. Kira Space has 2 migrations.
- Studio's `tests/ui` has 53 spec files; recount tests or drop the test count. `visual` has 6
  specs. `e2e-real` has 4 specs; recount its tests.
- `packages/db-fixtures/support/*.ts` has 7 modules.
- The Stack row's bundle figures are refreshed from one `bun run build:studio`.

### 4.6 Hooks and phase end

- Every commit goes through `.githooks/pre-commit` (`bun run lint`, `bun run typecheck`) without
  `--no-verify`.
- Push through `.githooks/pre-push` (`go build ./...`, `lint:go`, `lint:dead`) once at phase end.
- No test suite needs to run, because nothing but docs changes.

## 5. Out of scope

These are stale code comments, which are source, not docs. Listing them lets a later phase decide.
P109 does not touch them.

- `apps/kira-studio/internal/storage/repos/connections.go:172`: mentions `nativeKinds`.
- `apps/kira-space/frontend/src/state/workspace.ts:67` and `repo/GitPanel.vue:189`: mention the
  deleted `quickOpen.ts`.
- `apps/kira-studio/internal/datagrip/jdbc.go:13`: "CLAUDE.md's per-adapter port literals". No
  such section exists.
- `StreamView.vue:390`, `AutocompleteField.vue:71`: mention the deleted
  `IconButton`/`PopoverPanel`.
- `apps/kira-space/frontend/src/views/repo/RepoGraphView.vue:10`: "`KeepAlive` (Studio only)".
- `apps/kira-studio/tests/unit/bridge-unwrap.spec.ts`: recorded failing in P108 Part 11's
  "Deferred" (SPEC L5378). This is a red test, not a doc. By `CLAUDE.md`'s fix-on-the-spot rule
  it needs its own phase or a fixer; flagged to the orchestrator, not handled here.
- SPEC-internal: the P113 row says it runs "last … after P112", but P114 now follows it. This is
  SPEC phasing prose, not a P109 target. Flagged to the orchestrator.

## 6. Planner limitation

A permission denial blocked this pass from reading the root `package.json` `scripts` block and
`docs/v1.8/README.md`. Consequences:

- Script-name findings rely on P106's own rename list (SPEC L2389-2415) and on existing doc text.
- §4.4 makes the implementer run the authoritative check against `package.json`.
- §2.6's P71-P95 range must be checked against `docs/v1.8/SPEC.md`, not the v1.8 README.
