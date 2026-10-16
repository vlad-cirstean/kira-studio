# P266 plan: cross-cutting consistency audit

Ask (SPEC row P266, requirements line, orchestrator handover): audit both apps, Go and every package
for cross-cutting inconsistencies; decide one convention each; migrate; add guards. Seed areas
(1)-(11), plus hunted areas, plus (12) triage of every parked item from P262-P265. Accessibility out
of scope. Every decision below is final, with a one-line why. No sign-off list.

Base: `v2.0` at `8c7464c95` (P265 close-out). Builds on P262/P263 looks (U1-U38), P264 behaviour
(U39-U63, `behaviour/*`, confirm store, `QueryState`), P265 catalog (U64-U71, C1-C11, Go `i18n.T`).

Steps, strictly in order:

1. **F0** (one Sonnet, main checkout): catalog seeds, allowlist directory (§4.1).
2. **F1, F2, F3** (three Sonnets, three worktrees off the F0 tip, concurrent, zero overlap):
   error model core, UI primitives, guards (§4.2).
3. **F4** (one Sonnet, main checkout, after F1-F3 land): foundation migrations, repo-wide renames,
   per-stream allowlists, docs (§4.3).
4. **Streams A, B, C** (three Sonnets, three worktrees off the F4 tip, concurrent): migrate chunk
   by chunk, write every planned spec (§5).
5. **Landing** (§6.1), **L1** repo-wide Vue template format (§6.2), **test and fix** (one serial
   Sonnet, §6.3), **close-out** (§6.4).

Method: 22 `codegraph_explore` calls (CodiconIcon/TooltipIconButton/EngineIcon/OriginIcon; git-ui
`ACTION_ICONS`; `MenuItem`/`sectionsToMenuItems`; `ipcerr`/`codedError`/`errorText`; git error codes
and `gitBlockedCopy`; adapters/httpclient error types; where errors render (`QueryState`,
`InlineState`, `Alert`, tree `reportError`); bridge controls, `OpsService.Cancel`, streaming;
`createSettingsStore`/`SettingsShell`/Go settings model; both apps' settings panes; motion and
`Spinner`/`TIMING`; `internal/shell` menus, dialogs, quit, windows; `SHORTCUTS`/`accel.go`/
`CommandPalette`/`registerCommand`; storage migrations, `ReplaceKeyed`, ids, timestamps; empty
states; module start pages; virtualization/`useCappedList`; external links; git-core preflight
text; `baseHash` conflict guards; `WorkbenchShell` tab strip), then scratch scripts over
`S/` `apps/kira-studio/frontend/src`, `K/` `apps/kira-space/frontend/src`, `M/`
`apps/kira-space/frontend/mobile`, `W/` `packages/workbench/src`, `G/` `packages/git-ui/src`,
`D/` `packages/docker-ui/src`, `T/` `packages/theme/src`, `p/` `packages/`, Go under `apps/*/internal`
and `internal/`. Counts are from the tree at the base; the guards in §4.2 F3 and F1 are the
authoritative inventory.

## 1. Inventory

### 1.1 Icons (seed 1)

- Sets in use: codicons (577 `icon=`/`name=` refs in `.vue`, plus TS `icon:` fields), `@lucide/vue`
  (8 files: 6 vendored shadcn primitives in `T/components/ui/**`, plus `G/components/FileTree.vue`
  Check/Minus and `D/components/OriginIcon.vue` Boxes/Hammer/Network), `simple-icons` (brand marks:
  `EngineIcon`, `OriginIcon` kubernetes), seti (file types, `G/icons/setiFileIcon.ts`).
- Two name formats: git-ui maps (`G/icons/index.ts` `ACTION_ICONS`, `BADGE_ICONS`, `STATE_ICONS`,
  `PICKER_TAB_ICONS`) hold `codicon-*` classes stripped by `codiconName()` (13 callers) and by
  `sectionsToMenuItems`; `G/components/rowMenuModel.ts` passes `codicon-trash`. Everything else bare.
- Same concept, different icon (331 label/icon pairs, 148 concepts): remove `close` x12 / `trash` x7
  (`GitPanel`, `ReposDialog`, `VariableRow`, docker `EditRows`, `WorktreeList`, `AutomationsPanel`,
  `ParamsEditor` on trash); new collection `new-folder` x3 / `add` x1 (`S/api/menus.ts`);
  environments `server-environment` / `settings-gear` (`S/api/menus.ts`); variables `variable-group`
  x2 / `symbol-variable` x1 (`S/api/menus.ts`); back `chevron-left` (`S/views/browse/BrowseView.vue`,
  `G/components/review/ReviewView.vue`) / `arrow-left` (`K/ade/v2/panel/AdeStageMover.vue`); duplicate
  shares `copy` with Copy (`W/components/TabStrip.vue`); settings `settings-gear` x3 / `gear` x2 /
  `settings` x1; more actions `ellipsis` x2 / `kebab-vertical` x1.
- No concept-to-icon table anywhere.

### 1.2 Go-to-UI error model (seed 2)

- Wire shape `ipcerr.Error{code, message, details?}` (`internal/ipcerr/errors.go`); TS
  `toCodedError`/`errorText` (`W/bridge/codedError.ts`, 112 caller files) display `message`.
- 46 distinct codes in Go: `E_INVALID` 117 sites vs `E_BAD_REQUEST` 30 literal + 251
  `ipcerr.BadRequest`; one-off domain codes (`E_GRPC_CANCELLED`/`E_CANCELLED`,
  `E_GRPC_BAD_REQUEST`, `E_HTTP_TRANSPORT`/`E_GRPC_TRANSPORT`, `E_DOCKER_UNAVAILABLE`/
  `E_ENGINE_DOWN`/`E_UNAVAILABLE`, `E_STALE`/`E_CONFLICT`, `E_LAUNCH_TIMEOUT`/`E_TIMEOUT`,
  `E_TERMINAL_BUSY`, `E_IN_FLIGHT`, `E_WORKSPACE_CLOSED`, `E_NO_WINDOW`). No code registry; TS
  branches on 24 code strings.
- Code misuse: `connections/service.go` "connection %s not found" as `E_INTERNAL`.
- Four Go error types: `ipcerr.Error`, `adapters.Error` (`E_CONNECT`/`E_AUTH`/`E_QUERY`/...,
  129 literal + 3 `Sprintf` messages), `httpclient.Error` (26 literal), git (`E_GIT_*`).
- `ipcerr` messages (P265 left ~580 sites in Go): 128 "`x` is required" contract checks, 193
  lowercase developer messages, 60 user sentences, 15 `Sprintf`, 42 `err.Error()`, 11 variables.
  92 non-test Go files. Mixed style ("connectionId is required" next to "The database file must be
  an absolute path.").
- Go-sent text outside errors: preview blockers (`internal/scriptruns` `setBlocker`, 18 literal
  sites with `Preparing`/state `Error`), connection state error ("Pre-connect script exited …",
  `connections/service.go`), run notes.
- Where shown: load failures in `QueryState` (Retry always offered, also for `E_NOT_FOUND`), dialog
  `FieldError`/`Alert`, Studio tree row `ErrorPopover`, strip `Alert`s, live region; 27 `.catch(() =>
  …)` swallows (most commented, `D/components/ImageList.vue`, `ResourceDetail.vue` silent), 11 bare
  `void control.x()` (unhandled rejection).
- `packages/shared/protocol/frame.ts` decode errors: thrown invariant `Error`s (P265 exemption "P266").

### 1.3 Bridge API (seed 3)

- 315 bound methods: 250 take one `XxxArgs` struct, 64 none, 1 exception
  (`ConnectionsService.Create(input connections.Input)`).
- Verb drift for "destroy a stored record": `Delete` (Collections, Queries, Variables, GrpcHistory,
  ResponseHistory, DeleteBacklogItem, DeleteCollection) vs `Remove` (`ConnectionsService.Remove`,
  `MaskRulesService.Remove`, `CustomScriptsService.Remove` both apps over `internal/scripts`
  `Service.Remove`/`Repo.Remove`, same service has `DeleteCollection`). TS wrappers disagree too
  (`connectionsDelete` wraps `Remove`, `maskRulesRemove`, `customScriptsRemove`). `Remove` for
  detach is correct (`CodeWorkspaceService.RemoveRepo`, `AdeTaskService.RemoveFolder`).
- Events: 70 `kira:<domain>:<event>` names; 22 kebab segments (`kira:menu:new-connection`,
  `kira:menu:view-run-all`, `kira:agent:reveal-task`, `kira:app:flush-before-close`, …) vs camelCase
  (`kira:api:dataChanged`, `kira:connection:metadataInvalidated`, `kira:mobile:openLaunch`, …);
  `kira:open-settings` has no domain. Constants: `internal/appevent/appevent.go`,
  `p/shared/protocol/events.ts`, test `ipcChannels.ts` (both apps). gitrpc `repo.changed` dot names
  are its own RPC namespace; `op:start`/`op:end` are in-process Go events.
- Cancellation: `OpsService.Cancel({opId})` (Studio data plane), `Cancel<Thing>` on owning services
  elsewhere. Streaming: start method, events keyed by id, stop method. Conflict guard: `baseHash`
  (ADE workflows, docker edit) vs `hash` (scriptruns confirmed preview, a different concept).
  Pagination: page protocol (`PagePosition`, `hasMore`), `limit` + `truncated` on bounded lists.

### 1.4 Settings (seed 4)

- Go SQLite leaf rows, `SettingsService.GetAll/Set(patch)`, zod mirror in each app's
  `state/settingsDomain.ts`, shared `internal/appsettings.Appearance`, `createSettingsStore`,
  `SettingsShell` draft + Save (P17), panes per app, shared fields under `W/settings/fields/`.
- Space stores `appearance.fontFamily` and `rowColoring` but shows no font family field (Studio
  only, `S/workbench/settings/AppearancePane.vue`, fonts in `S/fonts.ts`); `rowColoring` unused in Space.
- Geometry in settings: `ade.panelWidth` (`K/ade/v2/panel/AdePanel.vue` patches settings) while the
  tier rule (P264 §2.5) puts app-wide panel geometry in the Go layout store.
- Catalog keys: Studio `studio.settings.*`, Space `space.workbench.<pane>.*` (same role, two shapes).
- Negative boolean leaf `api.disableCookieJar`.

### 1.5 Motion (seed 5)

- No `duration-*`/`ease-*` in app code except `D/components/UsageBar.vue` `duration-300`; Tailwind
  `transition*` in theme primitives (default 150 ms); shadcn `animate-in/out`, `fade-*`, `zoom-*`,
  `slide-in-from-*` in theme overlays; `Spinner` `animate-spin`; `StatusDot` pulse.
- `prefers-reduced-motion`: 0 sites.
- Sortable ghost `opacity-50` (`W/behaviour/sortableReorder.ts`) vs `opacity-40`
  (`K/ade/v2/plan/AdeDayBand.vue`).
- Loading spinner shows at once (flash on fast loads in `QueryState`).

### 1.6 Studio vs Space parity (seed 6)

Same-path forks (diff lines): `workbench/TitleBar.vue` 39 (only panel label, an ADE leave guard),
`StatusBar.vue` 74 (per-app items, composition already), `WorkbenchShell.vue` 54, `SettingsDialog.vue`
93, `AppearancePane.vue` 195, `AdvancedPane.vue` 134, `state/*` factories (thin). Findings:

- Command palette: Studio only (`S/shortcuts/CommandPalette.vue`, `S/shortcuts/state.ts`); Space
  registers `view.find`, `repo.search`, `repo.goToFileFromDiff` commands with no palette.
- Global command dispatch: Studio via native menu (View: Command palette, Find, Refresh, Run, Run
  all, Format); Space menu lacks Command palette and Find, and dispatches Find through a window
  `useShortcut` in `K/workbench/WorkbenchShell.vue`.
- Memory mode shows an empty tab strip (Docker hides it via `ModeDef.tabStrip: false`).
- Two run log components: `W/automations/runs/RunLog.vue` and `K/ade/v2/panel/AdeRunLog.vue` (same
  chunk rendering, different error line, stream colour rule, Card vs div).
- Test support: `prompts.ts` identical in both apps, `contract.ts` 2 lines apart.

### 1.7 Window and native (seed 7)

Shared `internal/shell` (menu template parts, `Dialogs`, `Quitter` flush handshake, window registry,
restore, `EnsureOnScreen`, Dock reopen), `desknotify`, `appupdate`. No quit confirmation in either
app. Gap: Space menu (above). First-launch clamp item stays (Known open items).

### 1.8 Persistence (seed 8)

- Migrations: `NNNN_<phase>_<slug>.sql` in all four sets (Studio 37, Space 32, gitreview 3, memory 3).
- Ids: `TEXT PRIMARY KEY` uuid everywhere.
- Timestamps: `created_at INTEGER` (unix ms) in 10+ tables vs `TEXT` (ISO) in ~12 tables
  (connections, saved queries `created_at`/`used_at`, collections, variables, …); wire mirrors both.
- Tiers: settings (Go DB), layout (Go DB), tab `state_json`, `usePersistedState` keys
  `kira.<module>.<name>` (9 keys), git `ViewStateStore`, on-disk files under KIRA_HOME.
- Atomic writes: `mcpauth.AtomicWriteFile` and `bridge/collections.go` `writeFileAtomically` (two
  hand-rolled copies); plain `os.WriteFile` on files other programs read
  (`internal/claudeheadless/usermcp.go`, `mcp.go`, `internal/agenthooks/{agenthooks,statusline}.go`,
  `internal/memory/modelstore/modelstore.go` tmp, `K…/gitaskpass/broker.go` shim).

### 1.9 First-run, empty, onboarding (seed 9)

- 86 `<Empty>` blocks, 13 compositions: 46 media+title outside `EmptyHeader`, 9 header+media+title,
  6 button-only, 6 title+description, 6 full with button, 3 full with `EmptyContent`, plus one-offs
  (`ProjectPanel` media+description, `NoRepositoryPanel` media outside header with buttons).
- Module front doors: `S/workbench/panels/StudioStart.vue`, `S/api/ApiStart.vue` hand-rolled
  (div layout, `text-kira-xl`); `W/automations/AutomationsStart.vue` and `K/repo/GitStart.vue` on
  `Empty`; `K/ade/AdeView.vue` empty with buttons; Memory none (detail empty state); Docker none
  (engine overview).
- Panel empty states: buttons in `GitPanel` only; Studio panels follow P16 ("says what the panel is
  for, nothing more").

### 1.10 Code conventions (seed 10)

- `.vue` PascalCase: all. `.ts`: camelCase except 10 kebab files in `p/shared/domain`
  (`tree-filter`, `sql-lint`, `object-store`, `sql-lex`, `sql-keywords`, `sql-tokens`,
  `grpc-history`, `sql-split`, `response-history`) and `p/shared/protocol/data-ops.ts`.
- Test suffix: `.spec.ts` (346 files) vs `.test.ts` (46: `p/git-core` 16, `p/git-ipc` 2, `G` 28).
- Helper folders: `lib/` (`T`, `G`, `D`) vs `util/` (`W/util`, `p/git-core/src/util`).
- Pinia: 77 `use*Store = defineStore('id')`; 5 ids off the naming rule (`useDbMcpStore` `dbmcp`,
  `useCodeReposStore` `coderepos`, `useAuthStore` `mobileAuth`, `useModelDownloadsStore`
  `memoryModelDownloads`, `useImportUiStore` `memoryImportUi`).
- Frontend logging: 38 `console.*` in 20 app files, no logger.
- Go logging: 264 `slog` calls, 43 without `"scope"`, one `"error"` key (175 `"err"`).
- Go package layout: both apps share `appcore`, `appshell`, `appwire`, `bridge`, `buildinfo`,
  `config`, `flowharness`, `flows`, `oplog`, `storage`. Consistent.

### 1.11 Performance budgets and virtualization (seed 11)

- Budgets: `ui-timing` (`budgets.spec.ts`, `perf.spec.ts`): keystroke p50 50 ms, scroll p95 80 ms,
  tab switch gate 300 ms.
- Virtualized: `useVirtualRows`/`treeVirtualRows`/`VirtualList`/SlickGrid in 28 files.
- `useCappedList` (P264) has 0 callers; `ShowMoreButton` 10 callers in git-ui cap by hand
  (`REF_LIST_SECTION_CAP`).
- Unbounded plain `v-for`: run logs (`RunLog`, `AdeRunLog` `data.chunks`), `AdeChangesTab`
  (`branch.files`, `branch.commits`, `branch.dirty`), `ReposDialog` repos. Bounded by construction:
  memory search (Go `maxItems` 20), menus, settings, enums.

### 1.12 Hunted areas

- **H1 External links**: Studio/Space `LinkService.OpenExternal`, docker context `openExternal`, git
  `link.openExternal`/`pr.openExternal` host handlers; 3 Space `void control.linkOpenExternal`
  (unhandled), docker swallows silently, `ContainerDetail` shows an inline error.
- **H2 Fire-and-forget**: 11 bare `void control.*()`; 27 `.catch(() => …)` (5 empty-bodied).
- **H3 Short SHA**: TS `.slice(0, 7)` 33, `.slice(0, 8)` in `K/views/repo/ReviewThread.vue`,
  `G/components/review/ReviewCommentsPane.vue`; local `shortSha` helpers in 4 files; Go `[:7]` in 6
  helpers, `[:8]` in `apps/kira-space/internal/gitreview/export.go`. Docker ids `[:12]` (Docker's own
  convention, kept).
- **H4 Text outside the copy guard**: `check-copy` skips `p/git-core`, `p/git-ipc`, `p/api-core`
  (14 files with English: `operation.ts` "Rebasing …", `preflight/tag.ts` "Name cannot be empty.",
  `search/query.ts` regex prefix, settings schema descriptions).
- **H5 git-core compact ages and absolute dates** (`util/dateFormat.ts`): English units, outside the
  catalog and `behaviour/format.ts`.
- **H6 Colour names**: swatch tooltips and Color submenus show raw palette ids (`swatch`)
  (`W/automations/ScriptDialog.vue` and the context-menu Color submenu callers in A/B/C).
- **H7 Touch targets**: mobile `h-11` literal (U9 exemptions for `BacklogScreen`, `TerminalScreen`),
  release button `h-11`; desktop `DialogHeader` close is `icon-sm` (22 px) on the phone
  (`M/components/ReplySheet.vue`, mobile `ConfirmDialogView`).
- **H8 Weekday/month literal arrays** in Space ADE (P265 Stream B left them).
- **H9 Known open items duplicates**: `ui-timing` (P264 and P250 entries), visual baselines (P264
  and P227… entries), load-sensitive specs (P264 repo-graph and P230… entries).
- **H10 Exemptions that a token or constant now covers**: `U46 SlickGridHost` 300 ms,
  `U46 AdeReviewCompose` 10 s (both durations belong in `TIMING`); `U9` mobile 44 px.

## 2. Decisions (final)

### 2.1 Icons

- **One UI glyph set: codicons.** Why: 577 refs already; mixed sets read as two apps.
  `simple-icons` stays for third-party brand marks, seti for file types, lucide only inside vendored
  `T/components/ui/**`. `FileTree` tri-state uses codicons `check`/`dash`; `OriginIcon` compose
  `layers`, swarm `type-hierarchy`, buildx `tools` (compose brand colour stays, U34 exemption).
- **One concept table** `T/icons.ts`: `export const ICON = { … } as const` (bare names) with rows:
  add `add`; delete (destroys stored data) `trash`; remove from a list, editor row or selection
  `close`; close/dismiss `close`; clear a field `close`; clear all `clear-all`; copy `copy`;
  duplicate `files`; edit and rename `edit`; refresh `refresh`; search `search`; filter `filter`;
  history `history`; run/start `play`; stop/cancel `debug-stop`; restart `debug-restart`; reset to
  default/revert/discard `discard`; settings `settings-gear`; more actions `ellipsis`; back to the
  previous view `arrow-left`; step within a sequence (page, month) `chevron-left`/`chevron-right`;
  new collection/folder `new-folder`; environments `server-environment`; variables
  `variable-group`; open X uses X's own kind icon; error/warning/info `error`/`warning`/`info`;
  success `check`. Why: the 11 conflicts of §1.1 resolve by one rule each (destroys → trash,
  detaches → close).
- **Bare names only.** git-ui maps hold bare names; `codiconName()` and the `replace(/^codicon-/)`
  in `sectionsToMenuItems` are deleted. Why: one format, no strip step.
- Retired names `gear`, `settings` (as an icon), `kebab-vertical` banned (U73).

### 2.2 Error model

- **Codes**: one registry, Go `internal/ipcerr/codes.go` (typed `Code` constants) and TS
  `p/shared/domain/errorCodes.ts` (`ERROR_CODES` union + `isRetryable(code)`), parity checked by
  `check-conventions` (§4.2 F3). Generic: `E_INTERNAL`, `E_CONTRACT` (new), `E_BAD_REQUEST`,
  `E_NOT_FOUND`, `E_CONFLICT`, `E_UNAVAILABLE`, `E_TIMEOUT`, `E_CANCELLED`, `E_TRANSPORT`,
  `E_UNAUTHORIZED`, `E_FORBIDDEN`, `E_READ_ONLY`, `E_TOO_LARGE`, `E_UNSUPPORTED`, `E_RATE_LIMITED`,
  `E_DISCONNECTED`, `E_SECRET_STORE`. Domain codes stay only where a UI branches on them:
  `E_CONNECT`, `E_AUTH`, `E_QUERY` (adapters), `E_ENGINE_DOWN`, `E_GIT_*`, `E_PREPARING`,
  `E_REVOKED`, `E_EXPIRED`, `E_PAIRING_DENIED`, `E_WRITE_OFF`, `E_AGENT_INPUT_OFF`,
  `E_RECREATE_FAILED`, `E_ALREADY_IMPORTED`, `E_UNKNOWN_METHOD`, `E_IDEMPOTENCY_KEY`,
  `E_IDEMPOTENCY_MISMATCH`, `E_FRAME_TOO_LARGE`. Client-only codes (raised in TS, never by Go),
  listed separately in the TS registry: `E_NETWORK` (mobile fetch), `E_FIXTURE_MISS` (test mocks).
  OS errno strings (`ESRCH`, `EEXIST`) are not error codes. Retired (mapping):
  `E_INVALID` → `E_BAD_REQUEST` (user input refused), `E_CONFLICT` (state precondition) or
  `E_CONTRACT` (caller bug), judged per site; `E_STALE`, `E_TERMINAL_BUSY`, `E_IN_FLIGHT`,
  `E_WORKSPACE_CLOSED` → `E_CONFLICT`; `E_GRPC_CANCELLED` → `E_CANCELLED`; `E_GRPC_BAD_REQUEST` →
  `E_BAD_REQUEST`; `E_HTTP_TRANSPORT`, `E_GRPC_TRANSPORT` → `E_TRANSPORT`; `E_DOCKER_UNAVAILABLE`,
  `E_NO_WINDOW` → `E_UNAVAILABLE`; `E_LAUNCH_TIMEOUT` → `E_TIMEOUT`; `E_GRPC_SCHEMA` →
  `E_BAD_REQUEST`. Rule for a new code: add a domain code only when a UI branches on it. Why: 46
  codes for ~17 meanings; nothing branches on most one-offs.
- **Messages**: the `message` a user can see is catalog text. Go builds it with `i18n.T` (P265's
  reader, already used for menus): `ipcerr.T(code, key, params)`; adapters/httpclient constructors
  take a key the same way (`adapters.T(code, key, params, cause)`). Raw text from outside Kira (a
  driver, server, git, OS or library error via `err.Error()`) stays verbatim: data, not wording.
  Contract violations (the UI always sets the value; failure is a Kira bug) use
  `ipcerr.Contract(format, args…)` / `ipcerr.Required(field)` → `E_CONTRACT` with English developer
  text. Classification per site: value typed by the user or read from outside (file, network,
  another window, a stale snapshot) → `T`; id/enum/shape the UI itself sets → `Contract`. Keys:
  `backend.studio.*` (apps/kira-studio), `backend.space.*` (apps/kira-space, internal/memory),
  `backend.core.*` (other `internal/*`), `backend.error.*` (generic, foundation). Why: closes the
  P265 known open item with the mechanism P265 already ships; one text source.
- **Go-sent non-error text** (preview blockers, `Preparing`, connection state errors, run notes)
  follows the same rule (`i18n.T` keys). Why: same class of text.
- **Display**: `errorText(err)`: `E_CONTRACT` → `t('common.error.contract.message', { detail })`
  ("Something went wrong inside Kira: {detail}"); every other code → `message`. Retry is offered
  only when `isRetryable(code)` (all but `E_NOT_FOUND`, `E_CONTRACT`, `E_BAD_REQUEST`,
  `E_FORBIDDEN`, `E_UNAUTHORIZED`, `E_UNSUPPORTED`, `E_READ_ONLY`, `E_TOO_LARGE`, `E_CONFLICT`).
  Why: Retry on a deleted object is a dead end.
- **Where shown** (one rule per situation): a load → `QueryState` (pane or inline) in place; an
  action inside a dialog → `FieldError` under the field when field-specific, else `Alert variant
  error` at the top of `DialogBody`, dialog stays open; a row or tree action → that row's error
  popover (Studio tree pattern) or the module's strip `Alert`; a copy or open-link failure →
  live-region announcement (`common.error.openLink.announce`, existing copy path); a background
  call nobody waits on → `fireAndForget` (logs, no UI). No toasts. Why: matches what P262-P264
  built; every site picks from one table.
- **Fire-and-forget**: `W/bridge/fireAndForget.ts` `fireAndForget(promise, scope)` (catch →
  `logWarn`). Bare `void control.x()` banned (U77); an empty `.catch(() => {})` without a comment
  banned (U81). Why: 11 unhandled rejections today.
- **Frontend log**: `W/bridge/log.ts` `logWarn(scope, message, err?)`/`logError`; Biome
  `suspicious/noConsole` on, overrides only for `log.ts`, `scrollTrace.ts`, `W/testing/**`, tests,
  `scripts/**`, `S/../proto/**`. Why: 38 ad hoc `console.*`; Biome has the rule.
- **frame.ts** decode errors stay thrown `Error`s (invariants; they reach the UI only as
  `E_INTERNAL` detail). Exemption reason updated (§3).

### 2.3 Bridge API

- Method verbs: `List`, `Get`, `Create`, `Update` (patch), `Save` (create-or-replace from a client
  draft), `Upsert` (genuine upsert), `Set` (one value or whole document), `Delete` (destroys a
  stored record), `Remove` (detaches without destroying), `Cancel<Thing>`/`Stop`. Renames:
  `ConnectionsService.Remove` → `Delete`; `MaskRulesService.Remove` → `Delete`;
  `CustomScriptsService.Remove` (both apps) and `internal/scripts` `Service.Remove`/`Repo.Remove` →
  `Delete`; TS wrappers `connectionsDelete`, `maskRulesDelete`, `customScriptsDelete`. Why: Delete
  vs Remove follows the P265 glossary.
- Args: one `<Service><Method>Args` struct or none. `ConnectionsService.Create(input
  connections.Input)` → `Create(args ConnectionsCreateArgs)` (wire JSON unchanged).
- Events: `kira:<domain>:<event>`, both segments camelCase. 22 renames (`kira:menu:newConnection`,
  `kira:menu:newRequest`, `kira:menu:importPostman`, `kira:menu:importDataGrip`,
  `kira:menu:commandPalette`, `kira:menu:toggleProjectPanel`, `kira:menu:toggleOperationsPanel`,
  `kira:menu:viewFind`, `kira:menu:viewRefresh`, `kira:menu:viewRun`, `kira:menu:viewRunAll`,
  `kira:menu:viewFormat`, `kira:menu:tabNext`, `kira:menu:tabPrev`, `kira:menu:tabClose`,
  `kira:menu:openSettings` (was `kira:open-settings`), `kira:app:flushBeforeClose`,
  `kira:window:flushBeforeClose`, `kira:adetask:openSession`, `kira:agent:revealScriptRun`,
  `kira:agent:revealTask`, `kira:agent:revealTerminal`). gitrpc dot names and in-process
  `op:start`/`op:end` stay (own namespaces). Why: JSON fields and TS names are camelCase.
- Results: lists return `[]` never `null` (Go returns non-nil slices). Cancellation, streaming,
  pagination: as §1.3, recorded. Conflict: `baseHash` = hash of what the client edited, refused with
  `E_CONFLICT`; `hash` = identity of a confirmed preview. Why: two concepts, two names; both kept.

### 2.4 Settings

- Where state lives (tier table, recorded in ARCHITECTURE): user preferences → settings (Go DB
  leaves); app-wide panel geometry → layout store; per-tab view state → tab `state_json`; per-device
  conveniences → `usePersistedState` (`kira.<module>.<name>`); git view state → `ViewStateStore`;
  files under KIRA_HOME → atomic writes (§2.8). `ade.panelWidth` moves to Space layout
  (`panel.ade.width`); a migration moves the stored leaf once and deletes it. Why: geometry is not a
  preference (Reset to default would reset a drag).
- Naming: sections and leaves camelCase; booleans positive for new leaves. Existing
  `api.disableCookieJar` stays (renaming a stored key rewrites user data for no visible change).
- Apply: inside the Settings dialog every leaf is draft + Save (P17); a control outside the dialog
  that edits a setting applies at once through `patchSettings`. Why: already true; now stated.
- Layout: `SettingsShell` both apps; Appearance first, Advanced last; field anatomy = label row with
  reset button, control, `FieldError`, description; booleans are `Switch`.
- Studio vs Space: shared `W/settings/fields/FontFamilyField.vue` (moved from Studio
  `AppearancePane`, font list moves `S/fonts.ts` → `W/settings/fonts.ts`); Space Appearance shows it.
  `rowColoring` stays Studio-only in UI (Space has no rows it colours).
- Catalog: Space settings keys `space.workbench.<pane>.*` → `space.settings.<pane>.*` (text unchanged).
- How to add a setting: checklist in ARCHITECTURE (Go model + default + validation + leaf upsert,
  zod schema + default, pane field, catalog keys, reset button, flow test).

### 2.5 Motion

- One duration and easing: tokens `--kira-motion: 150ms`, `--kira-ease: cubic-bezier(0.4, 0, 0.2,
  1)` in `T/tokens.css`, wired to Tailwind's `--default-transition-duration`/
  `--default-transition-timing-function`; overlays keep tw-animate-css defaults (150 ms). App code
  sets no `duration-*`/`ease-*` (U75); `UsageBar` drops `duration-300`. Why: one feel; only one
  outlier today.
- Reduced motion: `T/base.css` `@media (prefers-reduced-motion: reduce)` sets transition and
  animation durations to `0.01ms` and iteration count 1, except `Spinner` (rotation is the loading
  signal); `StatusDot` pulse stops. Why: none today; one global rule.
- Spinner timing: `QueryState` shows its loading state after `TIMING.spinnerDelay` (300 ms); a
  `Button pending` spinner shows at once (the user just acted). Why: stops flashes on fast loads.
- Drag ghost: one class `SORTABLE_GHOST_CLASS = 'opacity-50'` in `sortableReorder.ts`;
  `AdeDayBand` uses it (U76).

### 2.6 Parity

- Command palette moves to `W/shortcuts/` (`CommandPalette.vue`, palette store); each app supplies
  its command list; Space mounts it. Both menus carry View → Command palette and Find; Space drops
  its window `useShortcut(['view.find'])` (menu accelerator dispatches). Why: one dispatch path.
- `W/components/WorkbenchTitleBar.vue` replaces both apps' `TitleBar.vue` (props `panelLabel`,
  `beforeModeChange?`). Why: 39 diff lines, all parameters.
- `StatusBar.vue` stays per app (per-app items; shared chrome already).
- Memory mode `tabStrip: false`. Why: Docker precedent.
- One log viewer `W/components/LogLines.vue` (virtualized, `testid` prop keeps `run-log*` and
  `ade-run-log*` ids, stderr `text-error`, event `text-muted-foreground`, error via `InlineState`);
  `RunLog.vue` and `AdeRunLog.vue` become thin wrappers or are deleted (callers render `LogLines`).
- Test helpers: `prompts.ts`, `contract.ts` move to `W/testing/ui/`.

### 2.7 Window and native

No quit confirmation in either app (state flushes on quit; running work survives as P56 designed).
Native dialogs through `shell.Dialogs`, notifications through `desknotify`, update through
`appupdate`, window restore through `internal/shell`. Only change: Space menu items (§2.6). Why:
already shared; the audit found one gap.

### 2.8 Persistence

- Ids: TEXT uuid v4 (`uuid.NewString()` Go, `crypto.randomUUID()` TS). Already true.
- Timestamps: new columns `INTEGER` unix ms named `*_at`; the existing TEXT ISO columns stay as
  named legacy in `check-conventions` (converting rewrites user data and ~12 wire types for no
  visible change). Guard: a migration file numbered above the current max may not add a TEXT `*_at`
  column.
- Migrations: `NNNN_<phase>_<slug>.sql`, guarded.
- Atomic writes: `github.com/google/renameio/v2` (`renameio.WriteFile`, Apache-2.0, POSIX: the
  apps ship macOS/Linux) for every file Kira writes that a person or another program reads; both
  hand-rolled helpers deleted. Exempt: test tooling (`ipcfixture`), temp snapshots
  (`gitsession/incremental.go`). Why: library over a hand-rolled copy; user config writes today can
  tear.

### 2.9 First-run and empty states

- `T/components/EmptyState.vue`: props `icon?`, `title` (required), `description?`; default slot =
  actions inside `EmptyContent`; anatomy `Empty > EmptyHeader > [EmptyMedia] EmptyTitle
  [EmptyDescription]`. Raw `<Empty` only inside `EmptyState.vue` (U74). Why: 13 compositions → 1.
- `W/components/ModuleStart.vue`: module front door (icon 24, title `text-kira-xl`, description,
  one `dialog-primary` action, optional `dialog` secondary actions, optional `#below` slot for
  StudioStart's recents). `StudioStart`, `ApiStart`, `AutomationsStart`, `GitStart`, ADE no-repos
  view use it. Why: three hand-rolled front doors.
- Side-panel empty: icon + title + one-line description, no button (P16); a panel action moves to
  its module front door (GitPanel's buttons move to `GitStart` if not already there) (U78).
- Error/unavailable states may carry Retry (EmptyState slot).

### 2.10 Code conventions

- Files: `.vue` PascalCase; `.ts` camelCase (10 shared kebab files renamed); colocated test
  `<module>.spec.ts`; scenario specs under `tests/` kebab-case; `.test.ts` → `.spec.ts` (46 files).
- Folders: helpers in `lib/` (`W/util` → `W/lib`, `p/git-core/src/util` → `lib`); stores in
  `state/`; workbench composables in `behaviour/`.
- Pinia: id = camelCase export name without `use`/`Store` (5 fixes); one store one concern (CLAUDE.md).
- Frontend logging §2.2. Go logging: every `slog` call carries `"scope"`, errors under `"err"`
  (sloglint `forbidden-keys: [error]`, `key-naming-case: camel`, `static-msg`; scope presence via
  `internal/conventiontest`).
- Test helpers: shared UI helpers in `W/testing/ui/`, app-only ones in `apps/*/tests/ui/support/`.

### 2.11 Performance

- Budgets stay as numbers (keystroke p50 50 ms, scroll p95 80 ms, tab switch gate 300 ms).
- Rule: a list whose length grows with user data and can pass 200 rows uses `useVirtualRows`/
  `VirtualList`/SlickGrid; a picker section showing a large set caps with `useCappedList` +
  `ShowMoreButton`; plain `v-for` only when bounded ≤ 200 by construction. Migrations: `LogLines`
  (virtualized), `AdeChangesTab` file list, `ReposDialog` repo list; git-ui sections onto
  `useCappedList` (U80). Why: run logs are unbounded today.

### 2.12 Hunted

- External links: `W/bridge/openExternal.ts` `createOpenExternal(call)` → catches, announces
  `common.error.openLink.announce`; every app/module opens links through it (U79).
- Short SHA: `shortSha(sha)` = 7 chars in `p/git-core/src/lib/sha.ts`; Go `gitclient.ShortSHA`;
  local helpers deleted (U82). Docker ids stay 12.
- Copy guard scans `p/git-core/src`, `p/git-ipc/src`, `p/api-core/src`. git-core stays text-free:
  it returns `TextRef = { key: MessageKey; params?: MessageParams }` (type-only import from
  `@theme/i18n`), git-ui renders with `t()`. Settings schema descriptions move to catalog keys.
- Compact ages and absolute dates move to `W/behaviour/format.ts` (`formatAgeCompact`,
  `formatAbsoluteUtc`) with `format.age.*` keys; git-core `util/dateFormat.ts` deleted; its unit
  test moves into `format.spec.ts` (boundary arithmetic).
- Colour names: `common.colour.<id>.label` for every palette id; swatch tooltips and Color menus
  use them.
- Touch: token `--kira-touch-target: 44px` (`h-touch`, `size-touch`, `min-h-touch`); mobile `h-11`
  → `h-touch`; `DialogHeader` close button `pointer-coarse:size-touch`.
- Weekday/month names via `Intl.DateTimeFormat` (`format.ts`), literal arrays deleted.
- Plural `{count}` formatted with `formatCount` by the `t()` runtime when the message is plural
  (P265 leftover: no thousands separator).
- `TIMING.scrollPersist: 300`, `TIMING.agentPasteWait: 10000` remove two U46 exemptions.

## 3. Parked items triage (seed 12)

| Item (origin) | Verdict |
|---|---|
| Backend error messages Go literals, ~580 `ipcerr` sites (P265 known open item) | Fix, §2.2; delete the known item at close-out |
| vue-flow keyboard hint text English (P265 known open item) | Keep known open item: `@vue-flow/core` 1.48.2 exposes only `disableKeyboardA11y`, no text option |
| git-core compact ages and preflight messages English (P265 known open item) | Fix, §2.12; delete the known item |
| Git menu "New branch"/"Force push" lost `…` via C3 (P265) | Fix: both open a dialog, so `…` per P265 style rule; menu uses distinct keys (`git.menu.newBranch.label` "New branch…", `git.menu.forcePush.label` "Force push…"); C4 `nearForm` keeps a trailing `…` significant |
| P262 SecondaryTabs 32 files vs target ≥ 35 | Fix the one hand-rolled picker found (`K/ade/v2/panel/AdeEstimateField.vue` h/d); the 35 was an estimate, the audit finds no other site; final count recorded at close-out |
| Mobile `ReplySheet`/`ConfirmDialog` close button (P262 close-out) | Keep the button; 44 px under `pointer: coarse` (§2.12) |
| P264 accepted behaviour shifts (age "5m ago", natural sort, Cancel/Keep labels, 1500 ms copied, ContextMenu key, UA chords) | Keep; already live and spec-pinned |
| P264 left on purpose: `formatRelative` future form, generic Delete shortcut | Keep: no caller needs them; not a defect |
| P262 "indentation left by scripted edits (Biome does not format Vue templates)" | Fix in L1 (§6.2) |
| P265 "Plural `{count}` shows no thousands separator" | Fix, §2.12 |
| P265 `PROPER_NOUNS` lacks AI, SSO, PII, CDATA, DOCTYPE, PATH, MB, Max | Fix: add them (no rewording of shipped text) |
| P265 colour names raw palette ids (Streams A, B) | Fix, §2.12 |
| P265 `bodyBadgeLabel` in api-core unused | Fix: delete |
| P265 `beautify.ts` worker cannot import `t` | Fix: the i18n index is worker-safe since P265 close-out; worker returns `TextRef`, main thread renders |
| P265 weekday/month names literal (Stream B) | Fix, §2.12 |
| P265 `needsYou` shows raw `runsOn` ("each repo") | Fix: catalog key per `runsOn` value |
| P265 server run notes literal | Fix, §2.2 (Go-sent text) |
| P265 Claude prompt text in `compose.ts`, `runMessage.ts`; persisted `MANUAL_REASON`; product name args; KeyValuePane data-type strings; EJSON/font/Redis/auth-scheme tokens | Keep: not wording (sent to Claude, stored, proper names, protocol vocabulary) |
| `scripts/copy/exemptions.ts` 9 entries | Keep all; `frame.ts` reason becomes "internal invariant errors, shown only as E_INTERNAL detail" |
| `check-ui-primitives.sh` PERMANENT, 64 lines | Keep 58 with reasons as written; fix 6: `U9` BacklogScreen, TerminalScreen (→ `h-touch`), `U46` SlickGridHost, AdeReviewCompose (→ `TIMING`), `U25` AdeRunLog and RunLog (→ one `LogLines` line); `U3 CommandPalette` path moves to `W/shortcuts/` |
| Known open: `ui-timing` budgets (P264) and (P250) | Keep, merged into one entry |
| Known open: visual baselines sandbox (P264) and CI unchecked (P227…) | Keep, merged into one entry |
| Known open: Space repo-graph load (P264) and load-sensitive specs (P230…) | Keep, merged into one entry |
| Known open: `TestEngine` unconfirmed (P264) | Keep (needs Docker) |
| Known open: "Memory has no delete (P201) … empty tab strip" | Fix the tab-strip half (§2.6); keep "no delete" |
| Known open items not from P262-P265 (claude usage, notifications on macOS, mobile on a real phone, lannet macOS, plaintext LAN, Claude redraw, console drains, Redis whole reads, interactive turn, GitHub sync, review windows, tab-switch remount, documents flick, backgrounded Bash, conflict pairs, worktree dirty, pending archive, ipcfixture MCP columns, masked view, correlation tag, JSON over-refusal, history unmasked, dbmcp timeouts, SQL splitter, first-launch clamp, C5 tree, `.vue` colouring, C7 search x3, review session expiry, no merge/rebase op, fileTree reactivity, comment fan-out, `pr.yml` Space UI, no light theme, ClickHouse NULL text, Indic masks, insert-row input, memory-mcp bundle, re-import, semantic Mac, semantic English, `release.yml` patch, headless branches, ADE tools untested, unsaved ADE edits, PR facts, graph scroll, registry link, model URL seam, missing `claude`, Docker tcp, phone paths, unhide race) | Keep: product or environment limitations, not consistency |

## 4. Foundation

Ownership for the whole phase (streams never edit these; needs go to the stream's findings file):
`packages/theme/**` (en.json: namespaces `common`, `format`, `shared`, `theme`, `backend.error`,
existing `backend.*` leaves), `packages/shared/**`, `packages/kira-ui/**`,
`W/{behaviour,bridge,testing,shortcuts}/**`, `W/components/{QueryState,ShowMoreButton,ModuleStart,
LogLines,WorkbenchTitleBar,TitleBar,WorkbenchShell,MainView,TabStrip}.vue`, `W/settings/{fonts.ts,
fields/FontFamilyField.vue}`, `W/modes.ts`, `internal/ipcerr/**`, `internal/appevent/**`,
`internal/conventiontest/**`, `apps/kira-studio/internal/mcpauth/token.go`, `scripts/**`,
`biome.json`, `.golangci.yml`, root `package.json`, `knip.json`, `go.mod`, `go.sum`,
`docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md`, this plan.

### 4.1 F0 (sequential, main checkout)

1. en.json seeds (one key each, keeps every new object multi-line so three writers merge cleanly):
   `backend.error.internal.message`, `backend.studio.seed.message`, `backend.space.seed.message`,
   `backend.core.seed.message`, `common.error.contract.message`, `common.colour.blue.label`,
   `format.age.now`, `space.settings.seed.label`. Seeds of `backend.studio/space/core` and
   `space.settings` are deleted by their stream when it adds a real key.
2. `scripts/consistency-allowlist/` with empty `pending.txt` and `go-pending.txt`.
3. Commit `chore(p266): catalog seeds and allowlist directory`. Hook green.

### 4.2 F1, F2, F3 (parallel, worktrees off the F0 tip, zero overlap)

| Task | Owns (only these) | Depends on |
|---|---|---|
| F1 error core | `internal/ipcerr/**`, `internal/conventiontest/**`, `p/shared/domain/errorCodes.ts`, `W/bridge/{codedError,fireAndForget,openExternal,log}.ts`, `apps/kira-studio/internal/mcpauth/**` plus any file calling `mcpauth.AtomicWriteFile`, `go.mod`, `go.sum`, en.json `backend.error`, `common.error`, `scripts/consistency-allowlist/go-pending.txt` | F0 |
| F2 UI primitives | `T/**` except en.json and `T/i18n/catalog*.go`; `W/components/{ModuleStart,LogLines,WorkbenchTitleBar}.vue`, `W/shortcuts/**`, `W/settings/{fonts.ts,fields/FontFamilyField.vue}`, `W/behaviour/{format,format.spec,timing,sortableReorder}.ts`, `W/modes.ts`; en.json `common.colour`, `format.age`, `theme` | F0 |
| F3 guards | `scripts/check-ui-primitives.sh`, `scripts/check-conventions.ts` (new), `scripts/copy/**`, `scripts/consistency-allowlist/pending.txt`, `biome.json`, `.golangci.yml`, root `package.json` (scripts), `knip.json` | F0 |

No ordering dependency: F1 is Go plus four TS bridge files; F2 is theme/workbench UI; F3 tests its
rules on the tree it branches from and records every hit in `pending.txt` (whole-file lines) so
lint stays green. Distinct en.json objects; F0 seeded them. The code-registry parity rule (N6)
needs F1's files, so F4 adds it, not F3.

**F1 error core.**

1. `internal/ipcerr/codes.go`: `type Code string`, constants §2.2 (generic + domain), `Legacy`
   set (`E_INVALID`, `E_STALE`, `E_TERMINAL_BUSY`, `E_IN_FLIGHT`, `E_WORKSPACE_CLOSED`,
   `E_GRPC_CANCELLED`, `E_GRPC_BAD_REQUEST`, `E_HTTP_TRANSPORT`, `E_GRPC_TRANSPORT`,
   `E_DOCKER_UNAVAILABLE`, `E_NO_WINDOW`, `E_LAUNCH_TIMEOUT`, `E_GRPC_SCHEMA`), emptied by streams,
   deleted at close-out.
2. `internal/ipcerr/text.go`: `T(code Code, key string, params map[string]string) *Error`
   (message = `i18n.T`), `Contract(format string, args ...any)`, `Required(field string)` (→
   `Contract("%s is required", field)`). `New`, `BadRequest`, `NotFound`, `Internal`, `SecretStore`
   stay for `err.Error()`/variable messages; `Disconnected(name)` becomes
   `T(E_DISCONNECTED, "backend.error.disconnected.message", {name})`.
3. en.json `backend.error.*`: generic sentences (`disconnected`, `notFound`, `internal`) and
   `common.error.{contract.message, openLink.announce}`.
4. `p/shared/domain/errorCodes.ts`: `ERROR_CODES`, `LEGACY_ERROR_CODES`, `type ErrorCode`,
   `isRetryable(code)` (§2.2 list).
5. `W/bridge/codedError.ts`: `errorText` handles `E_CONTRACT` (§2.2).
6. `W/bridge/log.ts` (`logWarn`, `logError`), `fireAndForget.ts`, `openExternal.ts`
   (`createOpenExternal(call: (url: string) => Promise<void>)`; announce through the existing live
   region API in `W/behaviour`).
7. `internal/conventiontest/conventions_test.go` (go/parser over every non-test Go file under
   `apps/` and `internal/`): G1 a string literal or `fmt.Sprintf`/`fmt.Errorf` call as the message
   argument of `ipcerr.{New,BadRequest,NotFound,Internal,SecretStore}`, `adapters.New`,
   `httpclient` `newError`, or as `setBlocker`'s text; G2 a `"E_…"` literal outside
   `internal/ipcerr/codes.go` (codes come from constants); G3 a `slog.{Debug,Info,Warn,Error}` call
   without a `"scope"` key; G4 `os.WriteFile` outside test files and named exemptions. Allowlist:
   `scripts/consistency-allowlist/go-*.txt` lines `G<n> <path>` (whole file); named permanent
   exemptions in the test file with reasons; a stale line fails. F1 writes `go-pending.txt` from
   the first run.
8. `go get github.com/google/renameio/v2@v2.0.0`; every `mcpauth.AtomicWriteFile` call →
   `renameio.WriteFile`, helper deleted (callers found with `codegraph_explore`; F1 owns them).
9. Commit per group: `feat(ipcerr): code registry and catalog-backed messages`,
   `feat(workbench): error text, log, fireAndForget, openExternal`,
   `test(conventions): Go convention guard`, `chore(deps): renameio`. `go test ./internal/...`,
   `go vet ./...`, `bun run lint:go`, `bun run typecheck`, `bun run lint`.

**F2 UI primitives.**

1. `T/tokens.css`: `--kira-motion`, `--kira-ease`, Tailwind defaults wired; `--kira-touch-target`
   with `h-touch`/`size-touch`/`min-h-touch`. `T/base.css`: reduced-motion rule (§2.5).
2. `T/icons.ts` `ICON` (§2.1). Vendored lucide stays.
3. `T/components/EmptyState.vue` (§2.9). `T/components/ui/dialog/DialogHeader.vue`:
   `pointer-coarse:size-touch` on the close button.
4. `formatCount` moves to `T/i18n/number.ts` (theme cannot import workbench); `W/behaviour/format.ts`
   re-exports it. `T/i18n/index.ts`: a plural message's `count` param is formatted with it.
5. `W/components/ModuleStart.vue`, `LogLines.vue` (over `useVirtualRows`, rows of
   `{ id, text, stream }`, props `testid`, `error`, `maxHeight?`), `WorkbenchTitleBar.vue`
   (generic over mode, props `panelLabel`, `beforeModeChange?`).
6. `W/shortcuts/CommandPalette.vue` + `W/shortcuts/palette.ts` store (moved from `S/shortcuts/`,
   commands supplied by the app through `providePaletteCommands`); Studio's old files deleted in F4.
7. `W/settings/fonts.ts` (moved from `S/fonts.ts`), `W/settings/fields/FontFamilyField.vue`
   (from Studio `AppearancePane` font section).
8. `W/behaviour/format.ts`: `formatAgeCompact`, `formatAbsoluteUtc`, weekday/month via `Intl`;
   `format.spec.ts` gains the moved git-core boundary cases. `timing.ts`: `spinnerDelay: 300`,
   `scrollPersist: 300`, `agentPasteWait: 10000`. `sortableReorder.ts`: `SORTABLE_GHOST_CLASS`.
9. `W/modes.ts`: no change needed beyond docs (`tabStrip` exists).
10. en.json `common.colour.<id>.label` for every `PALETTE_COLOR_CHOICES` id, `format.age.*`.
11. Commits per group, typecheck and lint each.

**F3 guards.**

1. `scripts/check-ui-primitives.sh`: restore the per-stream allowlist mechanism (P264 version,
   reading `scripts/consistency-allowlist/{pending,stream-a,stream-b,stream-c}.txt`, applies to
   U72+ only), add U72-U82 (§4.4).
2. `scripts/check-conventions.ts` (bun, in `bun run lint`): N1 `.ts` file name camelCase (except
   generated wire dirs), `.vue` PascalCase; N2 no `.test.ts`; N3 no `util/`, `utils/`, `helpers/`
   folders; N4 Pinia id rule; N5 event names in `p/shared/protocol/events.ts` and
   `internal/appevent/appevent.go` match `^kira:[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$`; N7 migrations
   above the current max per set add no TEXT `*_at` column and follow `NNNN_<phase>_<slug>.sql`.
   Each rule reads `pending.txt` the same way. (N6 lands in F4.)
3. `scripts/copy/`: scan `p/git-core/src`, `p/git-ipc/src`, `p/api-core/src`; `PROPER_NOUNS` += AI,
   SSO, PII, CDATA, DOCTYPE, PATH, MB, Max; C4 `nearForm` keeps a trailing `…`.
4. `biome.json`: `suspicious/noConsole: error` with overrides (§2.2). HTML formatter stays off (L1).
5. `.golangci.yml`: enable `sloglint` (`static-msg`, `key-naming-case: camel`, `forbidden-keys:
   [error]`) and fix every hit in the same commit (F3 may edit any Go file outside F1's set; the
   expected hits are few: one `"error"` key, dynamic messages).
6. `pending.txt` from one run of every new rule. Commits: `chore(lint): consistency guards U72-U82`,
   `chore(lint): convention checks`, `chore(copy): scan core packages, proper nouns, ellipsis`.

### 4.3 F4 (sequential, main checkout, after F1-F3 land)

1. Land F1-F3 (`git rebase v2.0` in each, fast-forward), run lint, typecheck, `go test ./internal/...`.
2. `QueryState`: `EmptyState`, `isRetryable` gating, `TIMING.spinnerDelay` (VueUse `useTimeout`).
3. Repo-wide renames (one commit each, hook green):
   a. Events (§2.3): Go `appevent.go`, `p/shared/protocol/events.ts`, every Go/TS literal, test
      `ipcChannels.ts` both apps, contract fixtures.
   b. Bridge methods (§2.3): Go methods, TS wrappers, regenerated bindings
      (`sh scripts/prepare-worktree.sh` regenerates), IPC fixtures, specs.
   c. `.test.ts` → `.spec.ts` (46) with knip/test globs.
   d. `p/shared` kebab → camel (10 files) and importers.
   e. `W/util` → `W/lib`, `p/git-core/src/util` → `lib`, importers.
   f. Pinia ids (5).
   g. Test helpers `prompts.ts`, `contract.ts` → `W/testing/ui/`.
   h. Studio palette and fonts importers to the F2 moves; delete `S/shortcuts/CommandPalette.vue`,
      `S/shortcuts/state.ts` (palette part), `S/fonts.ts`.
   i. `check-conventions` N6: Go `codes.go` constants ⊆ TS `ERROR_CODES` and TS `ERROR_CODES` minus
      its client-only list ⊆ Go constants; `LEGACY` sets compared the same way.
4. Split `pending.txt` and `go-pending.txt` into `stream-{a,b,c}.txt` and `go-stream-{a,b,c}.txt`
   by §5.1 ownership; foundation-owned hits fixed here; delete both pending files.
5. ARCHITECTURE: new "Consistency conventions (P266)" section under UI architecture with §2 tables
   (icons, error model incl. where-shown table and code registry, bridge verbs/events, settings
   tiers and how-to-add, motion, empty/front door, code conventions, performance rule); edit
   "Module order and tab strip" (Memory). Known open items untouched until close-out.
6. Plan "Foundation result" section. Background push.

### 4.4 New guards (U72-U82, `check-ui-primitives.sh`)

| Id | Files | Flags |
|---|---|---|
| U72 | vt | `@lucide/vue` import outside `T/components/ui/` |
| U73 | vt | icon names `gear`, `settings`, `kebab-vertical`; `'codicon-…'` string literal outside `CodiconIcon.vue`, `Spinner.vue`, `T/` |
| U74 | v | `<Empty\b` outside `EmptyState.vue` |
| U75 | vt | `duration-`, `ease-`, `animate-in`, `animate-out` utilities outside `T/` |
| U76 | vt | `ghostClass:` outside `sortableReorder.ts` |
| U77 | vt | bare `void control.x(`, `void ctx.control.x(`, `void props.control.x(`, `void bridge.x(` |
| U78 | s | `<Button` inside `<EmptyState>` in a side-panel file |
| U79 | vt | `linkOpenExternal(`/`LinkService.OpenExternal(` outside each app's bridge wiring and `openExternal.ts` |
| U80 | v | `ShowMoreButton` in a file without `useCappedList(` |
| U81 | vt | `.catch(() => {})` with an empty body |
| U82 | vt | `.slice(0, 7)`/`.slice(0, 8)` (use `shortSha`); `h-11`/`size-11`/`min-h-11` under `M/` (use `h-touch`) |

Named permanent exemptions start empty; streams add a line only with a real requirement (reason
in the line). Close-out folds survivors into the PERMANENT block and deletes the allowlist directory.

## 5. Streams

Three worktrees off the **F4 tip**: `/home/user/kira-p266-a` (branch `p266-a`), `-b`, `-c`. One
Sonnet per stream, chunks in order, one commit per chunk (`refactor(<scope>): <chunk>`), each
hook-green (`bun run lint`, `bun run typecheck`, `go vet ./...` and `bun run lint:go` when Go
changed, `go test` of the packages the chunk touched). No UI, visual or flow suite in a stream.
Discovery inside a file (what calls it, which spec asserts its text) uses `codegraph_explore`
first. Per file: apply every §2 decision that lands on it, remove its allowlist lines, update owned
specs whose text or codes changed (others → findings file).

### 5.1 Ownership (zero overlap)

| Stream | Source | en.json | Specs and tests | Allowlist, notes |
|---|---|---|---|---|
| A Kira Studio | `apps/kira-studio/frontend/src/**`, `apps/kira-studio/internal/**` except C's flow dirs and `mcpauth/token.go`, `apps/kira-studio/main.go` | `studio`, `backend.studio` | `apps/kira-studio/tests/**` except C's | `stream-a.txt`, `go-stream-a.txt`, `docs/v2.2/plans/P266-stream-a-findings.md` |
| B Kira Space, mobile, memory | `apps/kira-space/frontend/{src,mobile}/**`, `apps/kira-space/internal/**`, `apps/kira-space/main.go`, `W/memory/**`, `internal/memory/**` | `space`, `mobile`, `memory`, `backend.space` | `apps/kira-space/tests/**` except C's | `stream-b.txt`, `go-stream-b.txt`, `P266-stream-b-findings.md` |
| C shared modules | `W/**` except `memory/**` and foundation files, `G/**`, `D/**`, `p/git-core/**`, `p/git-ipc/**`, `p/api-core/**`, `internal/**` except foundation dirs and `internal/memory/**` | `git`, `docker`, `automations`, `workbench`, `backend.core` | Studio `internal/flows/{termflow,dockerflow}/**`, `tests/ui/{docker-*,automations-*,list-keyboard-docker,prompts,update-dialog}.spec.ts`, Studio visual `automations-module.spec.ts`; Space `tests/ui/{automations-*,repo-graph-*,repo-commit-*,repo-branch-picker,repo-floating-geometry,repo-review-interaction,list-keyboard-git,copy-wording-git,copy-coverage-git}.spec.ts`, Space visual `git-module.spec.ts`; package unit specs | `stream-c.txt`, `go-stream-c.txt`, `P266-stream-c-findings.md` |

Spec support: Studio `tests/ui/support/**` A, Space `tests/ui/support/**` and
`tests/mobile/support/**` B; a helper C needs → C findings.

**No ordering dependency between streams**: each consumes only foundation APIs and keys; no
source, spec, PNG, allowlist or en.json namespace is shared. Code renames that a TS branch reads
stay inside one stream (A: `E_GRPC_CANCELLED` Go+TS; B: `E_STALE`, mobileweb status mapping; C:
docker and scriptruns codes). Space mounts git-ui through its public entry only; Studio mounts
docker-ui through its context only.

### 5.2 Chunks

The allowlists written in F4 step 4 are authoritative: an allowlisted file under a chunk's folders
that a list misses joins that chunk (≤ 25) or the sweep chunk. A chunk whose files plus their
updated tests pass 25 commits as `<id>a`/`<id>b`. Paths: Go `ks/` `apps/kira-studio/internal/`,
`kp/` `apps/kira-space/internal/`, `in/` `internal/`.

**Stream A** (order A1..A8):

- A1 Go bridge (23): `ks/bridge/{grpchistory,tree,maskrules,filters,responsehistory,schema,dbmcp,ops,variables,http,grpc,collections,connections,queries,files,datagrip,update}.go`, `ks/connections/{input,service}.go`, `ks/secrets/cipher.go`, `ks/httpclient/{wire,body,client}.go`. `T`/`Contract`/`Required`; codes; `E_GRPC_CANCELLED`, transport codes; "connection not found" → `E_NOT_FOUND`; `collections.go` `writeFileAtomically` → renameio.
- A2 Go adapters 1 (22): `ks/adapters/redis/{adapter,mutate,catalog,client,console,read,consolebound}.go`, `ks/adapters/postgres/{adapter,catalog,client,console,definition}.go`, `ks/adapters/sqlite/{adapter,client,query,console,read}.go`, `ks/adapters/sqs/{mutate,read}.go`, `ks/adapterhost/{data,host,dataframe}.go`. `adapters.T`; conformance tests follow text.
- A3 Go adapters 2 (20): `ks/adapters/mysqlfamily/{adapter,client,console,definition}.go`, `ks/adapters/kafka/{produce,read,definition}.go`, `ks/adapters/mongo/{adapter,mutate,console,read,literal}.go`, `ks/adapters/clickhouse/{adapter,client,console,read}.go`, `ks/adapters/s3/{adapter,mutate,read,transfer}.go`, plus `ks/adapters/errors.go` helpers.
- A4 Go remainder: every other `go-stream-a.txt` file (state text, `connections` preconnect message, `G3` scope keys, `G4` writes), `ks/appshell/menu.go` unchanged.
- A5 frontend shell and panels (≤ 25): `S/workbench/TitleBar.vue` (deleted, callers render `WorkbenchTitleBar`), `S/workbench/WorkbenchShell.vue`, `S/workbench/panels/{StudioStart,ProjectPanel,OperationsPanel}.vue`, `S/workbench/settings/AppearancePane.vue` (`FontFamilyField`), `S/api/{ApiStart,CollectionsPanel,DynamicValuesDialog,EnvironmentsView,VariableHistoryMenu,VariableSetView,VariablesOverviewPanel}.vue`, `S/api/menus.ts`, `S/api/state/{apiQueries,collections}.ts`, `S/docker/context.ts`, `S/bridge/index.ts` (`createOpenExternal`), `S/main.ts`, `S/App.vue` (palette from `W/shortcuts`).
- A6 frontend views (≤ 25): `S/views/{browse/BrowseView,definition/DefinitionView,documents/DocumentView,grid/DataView,grid/FilterToolbar,grid/FkPreviewPopover,grid/SlickGridHost,grpcrequest/CallHistoryList,grpcrequest/ResponsePane,grpcrequest/SchemaBrowser,httprequest/CookiesPane,httprequest/RawExchangePane,httprequest/ResponseHistoryList,httprequest/ResponsePane,httprequest/TimelinePane,shared/keyvalue/KeyValuePane,shared/page/SearchFilterNotice,stream/StreamView}.vue`, `S/views/shared/fields/FieldRowsTable.vue`, `S/api/VariableRow.vue`, `S/project/menus.ts`, `S/views/grpcrequest/GrpcRequestView.vue`, `S/views/httprequest/HttpRequestView.vue`. Icons per `ICON`, EmptyState, fireAndForget, colour names, `TIMING.scrollPersist`.
- A7 sweep: every remaining `stream-a.txt`/`go-stream-a.txt` line; allowlists hold only permanent lines with reasons.
- A8 specs (§5.3 A).

**Stream B** (order B1..B7):

- B1 Go gitrpc (20): `kp/gitrpc/{handlers,search,settings,refs,ops,review,incremental,remote,worktree,gh,detail,stack,stash,graph,handle,reset,comments}.go`, `kp/mobileweb/respond.go`, `kp/mobileterm/{broker,serve}.go`. `E_STALE` → `E_CONFLICT` incl. mobileweb HTTP mapping; Go `gitclient.ShortSHA`, local `[:7]`/`[:8]` helpers → it (`kp/gitsession/{ops,ghsync}.go`, `kp/ade/{deploy,rebasecheck}.go`, `kp/gitreview/export.go`, `kp/gitpreflight/{operation,stack}.go` join here if ≤ 25, else B2).
- B2 Go bridge and ADE (≤ 25): `kp/bridge/{memory,adetask,github,memoryimport,gitcredential,mobile,gitstream,ops,adetask_validate,mobilelaunch,codeworkspace,update}.go`, ADE/preflight blocker and note text (`kp/ade/**`, `kp/gitpreflight/**` per `go-stream-b.txt`), `in/memory/**` text, `in/memory/modelstore/modelstore.go` → renameio, `kp/gitaskpass/broker.go` → renameio.
- B3 Space shell and settings: `kp/appshell/menu.go` (View → Command palette, Find), `K/workbench/TitleBar.vue` (deleted, callers render `WorkbenchTitleBar`), `K/workbench/{WorkbenchShell.vue,modes.ts,settings/*Pane.vue}`, `K/App.vue` (palette mount, Space commands), `K/bridge/index.ts` (wrappers, `createOpenExternal`), `K/main.ts`, `K/state/settingsDomain.ts`, Space layout model + migration `NNNN_p266_ade_panel_width.sql` + `migrate_ade_panel_width_test.go`, `K/ade/v2/panel/AdePanel.vue` (layout store), en.json `space.workbench` → `space.settings`.
- B4 Space ADE and repo frontend (≤ 25): `K/ade/AdeView.vue` (ModuleStart), `K/ade/v2/{board/workflowForm.ts,notes/AdeNotesEditor.vue,panel/AdeBranchPanel.vue,panel/AdeLinkRow.vue,panel/AdeRunOutcome.vue,panel/AdeRunLog.vue→LogLines,panel/AdeChangesTab.vue,panel/AdeEstimateField.vue,panel/AdeStageMover.vue,plan/useTaskMenu.ts,plan/AdeDayBand.vue,review/AdeReviewSync.vue,review/AdeReviewCompose.vue,workflows/AdeStageInspector.vue}`, weekday/month users, `needsYou` `runsOn` text, colour names.
- B5 Space repo and views (≤ 25): `K/repo/{GitPanel,GitStart,ReposDialog}.vue`, `K/repo/git/hostHandlers.ts`, `K/repo/state/{repoHeads,search}.ts`, `K/state/{agentNotify,repoOpenHold,tabKinds,workspace}.ts`, `K/views/repo/{RepoDiffView,RepoFileView,RepoGraphView,RepoMultiDiffView,ReviewThread}.vue`, `K/views/repo/{reviewDecorations,useDiffEditor,blameAnnotation,blameLine}.ts`, `K/workbench/settings/ClaudeCodePane.vue`.
- B6 mobile and memory (≤ 25): `M/screens/{BacklogScreen,NeedsScreen,PlanScreen,TerminalScreen,PlanTaskCard}.vue`, `M/components/ReplySheet.vue`, `M/state/useAdeWrites.ts` (uuid slice: named U82 exemption), `M/terminal/KeyBar.vue`, `W/memory/{MemoryPanel,MemoryStart}.vue`, `W/memory/import/ImportView.vue`, `W/memory/**` per `stream-b.txt`. Then sweep of `stream-b.txt`/`go-stream-b.txt`.
- B7 specs (§5.3 B).

**Stream C** (order C1..C8):

- C1 Go internal 1 (16): `in/scriptruns/{confirm,launch,bound,headless,smart_run,preview,schedule,ade,service}.go`, `in/docker/{edit_apply,resources,bound,edit,logs,exec,disk}.go`. `E_INVALID` per §2.2, blockers, `E_DOCKER_UNAVAILABLE`, `E_TERMINAL_BUSY`.
- C2 Go internal 2 (≤ 25): `in/terminal/{bound,validate,service}.go`, `in/appupdate/install.go`, `in/shell/link.go`, `in/scripts/{service,repo}.go` (`Remove` already renamed in F4; text), `in/prompts/{bound,router}.go`, `in/rpcstream/session.go`, `in/appstorage/tabs.go`, `in/windowsvc/windowsvc.go`, `in/claudeheadless/{mcp,usermcp}.go` and `in/agenthooks/{agenthooks,statusline}.go` (renameio), remaining `go-stream-c.txt`.
- C3 git-core and git-ipc: `TextRef` for `preflight/tag.ts`, `model/operation.ts`, `search/query.ts`, settings schema descriptions (keys); `lib/dateFormat.ts` deleted (callers to `format.ts`); `lib/sha.ts` `shortSha`; copy-guard hits in `p/git-ipc/src`.
- C4 git-ui 1 (≤ 25): `G/icons/index.ts` (bare names, `codiconName` deleted), `G/lib/menuModel.ts`, `G/components/{rowMenuModel,refBadges,columns}.ts`, `G/components/{FileTree,BranchPicker,CommitMeta,DetailPane,StashDetailPane,AppToolbar,SearchResults,UndoButton}.vue`, `G/components/review/{ReviewView,ReviewFilesPane,ReviewCommentsPane,ReviewCommitRow}.vue`, `G/state/{clipboardActions,graphView,liveAnnouncements,packedStream,repoScopedReload,repoSettings}.ts`.
- C5 git-ui 2 (≤ 25): `G/App.vue`, `G/components/{EmptyRepositoryPanel,GitBlockedPanel,NoRepositoryPanel,StashList,TagList,StackList,StashRows,WorktreeList}.vue` (EmptyState, `useCappedList`), `G/components/dialogs/{BranchDialog,CherryPickDialog,ForcePushDialog,ResetDialog,RevertDialog,TagDialog}.vue` (shortSha), git menu keys `git.menu.newBranch.label`/`forcePush.label` with `…`, `G/components/linkify.ts`.
- C6 docker-ui and workbench (≤ 25): `D/components/{ContainerDetail,DockerPanel,ExecView,ImageList,ListState,ResourceDetail,UnavailableState,OriginIcon,UsageBar,EditRows,ContainerList,ContainerTable,EngineOverview}.vue`, `D/context.ts`, `D/state/useStatsSubscription.ts`, `W/automations/{AutomationsPanel,AutomationsStart,ScriptDialog,ParamsEditor}.vue`, `W/automations/runs/RunLog.vue` (→ `LogLines`), `W/components/{BootFailure,OpLogPanel,SettingsShell}.vue`.
- C7 workbench state, api-core, sweep: `W/state/{createAppUpdateStore,createLayoutStore,createModeStore,createOpLogStore,createTabsStore,createTerminalsStore}.ts` (fireAndForget, log), `W/bootstrapShell.ts`, `W/settings/fields/NotifyPromptsField.vue`, `p/api-core/**` (copy-guard hits, delete `bodyBadgeLabel`, `beautify.ts` returns `TextRef`), remaining `stream-c.txt`.
- C8 specs (§5.3 C).

### 5.3 Specs each stream writes (written, not run; feature split at the IPC boundary)

Literal expected strings, testid locators. "Heavy fixtures" is not a reason to skip.

**A**
- Go `ks/flows/appflow/errors_test.go`: (1) create SQLite connection with a relative path → code
  `E_BAD_REQUEST`, message equals `i18n.T` of its key; (2) `Queries.Get` of a deleted id →
  `E_NOT_FOUND`; (3) `Tabs.Save` with an empty window key → `E_CONTRACT`; (4) a forced adapter auth
  failure (sqlite fixture) keeps the driver text verbatim.
- UI `tests/ui/consistency.spec.ts`: same relative-path text in the connection dialog `FieldError`;
  `QueryState` mocked `E_NOT_FOUND` shows no `query-retry`, `E_INTERNAL` shows it; `E_CONTRACT`
  renders "Something went wrong inside Kira: …"; never-resolving query shows `query-loading` hidden
  at 100 ms and visible within 1 s; first-run, api-start render `[data-slot="module-start"]`;
  Connections and Collections empty panels render `[data-slot="empty-state"]` with no button;
  reduced motion (`page.emulateMedia({ reducedMotion: 'reduce' })`): an opened dialog's content
  computed `animation-duration` ≤ 0.01 ms, a loading `Spinner` still has `animate-spin`; delete
  items in connection, collection and environment menus show `codicon-trash`, variable row remove
  shows `codicon-close`, Duplicate tab shows `codicon-files`; Color submenu item reads `Blue`;
  `LinkService.OpenExternal` rejection announces `Couldn’t open the link` (catalog text) in the live
  region; renamed events (`kira:menu:newConnection`, `kira:menu:openSettings`) still open their UI.

**B**
- Go `kp/flows/<adeflow or new consistencyflow>/errors_test.go`: ADE save with a stale base hash →
  `E_CONFLICT` with catalog text; mobile HTTP mapping of `E_CONFLICT` → 409.
- Go `kp/storage/migrations/migrate_ade_panel_width_test.go`: stored `ade.panelWidth` moves to
  layout and the settings leaf is gone; layout round trip through `LayoutService.Set`.
- UI `tests/ui/consistency.spec.ts`: `kira:menu:commandPalette` opens the palette with Space
  commands; `kira:menu:viewFind` focuses the open diff's find; Memory mode has no `tab-strip`; ADE
  panel width survives reload (layout control mocked); Appearance shows the font family field;
  Git front door and ADE no-repos view render `module-start`; Git panel empty has no button;
  estimate unit is `[data-slot="secondary-tabs"]`; a 5000-line mocked run log renders ≤ 80
  `ade-run-log-line` nodes and scrolls to the last line; ADE conflict error text equals the Go flow
  test text; swatch tooltip reads `Blue`; weekday labels match `Intl` for `en`.
- Mobile `tests/mobile/consistency.spec.ts`: ReplySheet close button box ≥ 44 px (mobile projects
  emulate coarse pointer); empty Needs/Backlog/Plan screens render `empty-state`.

**C**
- Go `ks/flows/termflow/errors_test.go`: run preview with a task id in Studio → `E_BAD_REQUEST`
  (was `E_INVALID`) and the catalog text; Go `ks/flows/dockerflow/errors_test.go`: start of a
  missing container → `E_NOT_FOUND`, catalog text.
- UI Studio `tests/ui/consistency-docker-automations.spec.ts`: automations front door
  `module-start`; Docker unavailable state `empty-state` with Retry; origin icons are codicons (no
  `svg.lucide`); the two flow-test texts shown in the run dialog and container detail.
- UI Space `tests/ui/consistency-git.spec.ts`: short SHA 7 chars in the review thread and commit
  meta; tag list "Show more" reveals the next page (`useCappedList`); commit row menu
  `New branch…`, branch menu `Force push…`; graph date column `5m` from `format.age.*`; empty tag
  name error text from the catalog; remove worktree shows `codicon-trash`, remove repo
  `codicon-close`.
- Update `copy-wording-git.spec.ts` (`New branch…`).

No new unit tests beyond the moved `formatAgeCompact` boundary cases (CLAUDE.md bar);
`internal/conventiontest` is a guard.

### 5.4 Catalog merge

As P265 §4.4: each writer touches only its objects; F0 seeded every new object; `biome check
--write packages/theme/src/i18n/en.json` before each commit; a rebase conflict in en.json keeps both
sides and re-runs Biome; any other conflict means ownership was wrong: stop and report.
Cross-stream identical text (C3) can only appear at landing: promote to `common.*`/`backend.error.*`
in a landing commit.

## 6. Landing, format, test, close-out

### 6.1 Landing

1. F0 on `v2.0`; F1-F3 (§4.2); F4 on `v2.0`; background push after each.
2. Streams in worktrees (§7).
3. Each stream done (allowlists hold only permanent lines with reasons, specs written, findings
   complete, lint and typecheck green) → in its worktree `git rebase v2.0`, lint, typecheck,
   `go build ./...`, promote cross-stream duplicates, then main checkout `git merge --ff-only
   p266-<x>`. Background push after each.

### 6.2 L1 Vue template formatting (sequential, after all streams land)

1. `biome.json` `html.formatter.enabled: true` with whitespace sensitivity strict (no rendered
   whitespace change); `bun x biome format --write` over `**/*.vue`.
2. `bun run lint`, `bun run typecheck`, `bun run test:unit`, both visual projects without update.
3. Clean → commit `style: format Vue templates with Biome`. If Biome cannot parse a file or any
   visual diff appears: revert, keep the formatter off, and add a Known open item naming the
   failing file or diff. Why: P262's parked indentation; the formatter must not move a pixel.

### 6.3 Test and fix (one serial Sonnet)

1. Apply the three findings files; delete them.
2. Tightening: `LEGACY_ERROR_CODES` and Go `Legacy` empty → deleted; `check-conventions` N6 and
   `conventiontest` G2 fail on any legacy code.
3. Suites, serial, each failure root-caused and fixed in a commit (no `--no-verify`): `bun run
   test:unit`, `test:ui:studio`, `test:ui:space`, `test:ui:space-mobile`, `test:visual:studio`,
   `test:visual:space`, `test:flows:studio`, `test:flows:space`, `go test ./...`, `bun run lint:go`,
   `bun run lint:dead`. Visual: update only after viewing each diff and confirming it is an
   intended §2 change (icons, empty states, front doors, close button size); record each.
   Known load sensitivity (Known open items) is not a P266 failure; prove with the base when unsure.
4. "Test and fix result" section: commits, counts, baselines with reasons.

### 6.4 Close-out (sequential)

1. Fold allowlist permanent lines into the PERMANENT block (TS) and the named exemption list
   (`conventiontest`); delete `scripts/consistency-allowlist/`.
2. ARCHITECTURE Known open items: delete "Backend error messages stay Go literals (P265)" and
   "git-core compact ages and preflight messages are English (P265)"; edit "Memory has no delete"
   to drop the tab-strip clause; merge the three duplicate pairs (§1.12 H9); add an L1 item only if
   §6.2 failed. "Consistency conventions (P266)" final.
3. Plan "Close-out result": exemptions kept with reasons, code count before/after, SecondaryTabs
   file count, `EmptyState`/`ModuleStart` usage counts, anything parked.
4. SPEC P266 result section and row `Done`.
5. Final `bun run typecheck`, `bun run lint`, `bun run test:unit`, `go test ./internal/...` green.

## 7. Disk and worktrees (11 GB free at plan time)

Each worktree needs its own `node_modules`, Wails bindings and `frontend/dist` (`sh
scripts/prepare-worktree.sh`, then `sh scripts/codegraph-setup.sh`); never symlink `node_modules`.
`/home/user/kira-v22-base` (`v2.2-fixes`) is not P266's; leave it.

1. Foundation: create `/home/user/kira-p266-f1`, `-f2`, `-f3` (branches `p266-f1..3`) off the F0
   tip one at a time, each only with ≥ 2.5 GB free after the previous one's install (`df -h
   /home/user`). If short, F3 waits for F1 to land and its worktree to go (still branching off the
   F0 tip). Remove all three after landing (`git worktree remove`, `git worktree prune`,
   `git branch -d`).
2. Streams: create A, B, C off the F4 tip the same way, ≥ 2.5 GB free before each. If short, C waits
   for the first stream to land and its worktree to go; C still branches off the F4 tip.
3. Keep ≥ 1.0 GB free while work runs; Go build cache shared (`GOCACHE` default); a worktree prunes
   only its own `test-results/` and `playwright-report/`.
4. A stopped stream resumes from its last commit in its worktree; never recreate it.

## 8. Risks and scope

- **Go test churn**: Go tests asserting old messages update with their file's chunk; adapter
  conformance suites keep per-capability coverage (CLAUDE.md), only expected text changes.
- **Rewording through catalog rules**: Go text moved into en.json must pass C1-C11 (sentence case,
  ending punctuation, curly quotes); wording changes are expected and spec-visible.
- **Wire renames** (events, three bridge methods, error codes): all in F4 or one stream each;
  bindings regenerate; IPC contract fixtures update in the same commit.
- **Spinner delay** can move spec timing: test-and-fix owns it.
- **Visual baselines**: icons, empty states, front doors move pixels; each diff viewed.
- **Disk**: §7.
- Out of scope: accessibility (row), new features beyond the parity items named in §2.6, a second
  locale, light theme, data migrations of legacy TEXT timestamps or `disableCookieJar`, Monaco/
  SlickGrid/xterm internals, `apps/kira-studio/frontend/proto`, `apps/kira-space-vscode`.

## 9. Verification checklist (orchestrator, after close-out)

`D="apps/kira-studio/frontend/src apps/kira-space/frontend/src apps/kira-space/frontend/mobile packages/workbench/src packages/git-ui/src packages/docker-ui/src packages/kira-ui/src"`.

- Discovery happened: this planner's run holds 22 `codegraph_explore` calls; each stream's and
  F1-F4's runs show calls before structural edits.
- Icons: `grep -rln "from '@lucide/vue'" $D packages/theme/src | grep -v components/ui/` → none;
  `grep -rnE "(icon|name)=\"(gear|settings|kebab-vertical)\"" --include=*.vue $D` → none;
  `grep -rn "codiconName\|'codicon-" --include=*.ts $D` → none; `test -f packages/theme/src/icons.ts`.
- Error model: `grep -rhoE '"E_[A-Z_]+"' --include=*.go apps internal | grep -v _test | sort -u`
  ⊆ `internal/ipcerr/codes.go` constants (only codes.go holds literals: G2 green);
  `grep -rn 'E_INVALID\|E_STALE\|E_GRPC_CANCELLED\|E_HTTP_TRANSPORT' --include=*.go --include=*.ts apps packages internal --exclude-dir=node_modules`
  → none; `grep -rl 'ipcerr.T(' --include=*.go apps internal | wc -l` ≥ 60;
  `grep -rn 'ipcerr.Contract\|ipcerr.Required' --include=*.go apps internal | wc -l` ≥ 120;
  `go test ./internal/conventiontest/` green; `grep -n 'E_CONTRACT' packages/workbench/src/bridge/codedError.ts` hit.
- `grep -rnE "^\s*void (props\.)?(ctx\.)?(control|bridge)\.\w+\(" --include=*.vue --include=*.ts $D` → none;
  `grep -rn "console\.\(log\|warn\|error\|info\|debug\)(" --include=*.vue --include=*.ts $D | grep -v "scrollTrace\|/testing/"` → none;
  `grep -rln "fireAndForget(" $D | wc -l` ≥ 8.
- Bridge: `grep -rnE "func \(\w+ \*(Connections|MaskRules|CustomScripts)Service\) Remove\(" --include=*.go apps` → none;
  `grep -rhoE '"kira:[^"]+"' --include=*.go internal/appevent | grep -E -- '-'` → none;
  `grep -n "'kira:" packages/shared/protocol/events.ts | grep -- "-"` → none.
- Settings: `grep -rn "patchSettings({ ade: { panelWidth" $D` → none; `grep -rln "FontFamilyField" apps/*/frontend/src | wc -l` = 2;
  `jq '.space.workbench' packages/theme/src/i18n/en.json` → null.
- Motion: `grep -n "prefers-reduced-motion" packages/theme/src/base.css` hit;
  `grep -rnE "\bduration-[0-9]|\bease-" --include=*.vue $D` → none; `grep -rn "ghostClass:" $D packages/workbench/src | grep -v sortableReorder` → none.
- Parity: `test ! -f apps/kira-studio/frontend/src/shortcuts/CommandPalette.vue`;
  `grep -rn "CommandPalette" apps/kira-space/frontend/src --include=*.vue | wc -l` ≥ 1;
  `grep -n "commandPalette\|find" apps/kira-space/internal/appshell/menu.go` ≥ 2 hits;
  `test ! -f apps/kira-studio/frontend/src/workbench/TitleBar.vue && test ! -f apps/kira-space/frontend/src/workbench/TitleBar.vue`;
  `test ! -f apps/kira-space/frontend/src/ade/v2/panel/AdeRunLog.vue || grep -q LogLines apps/kira-space/frontend/src/ade/v2/panel/AdeRunLog.vue`;
  memory mode `tabStrip: false` in `apps/kira-space/frontend/src/workbench/modes.ts`.
- Empty: `grep -rn "<Empty\b" --include=*.vue $D packages/theme/src | grep -v EmptyState.vue` → none;
  `grep -rln "<EmptyState" --include=*.vue $D | wc -l` ≥ 40; `grep -rln "<ModuleStart" --include=*.vue $D | wc -l` ≥ 5.
- Conventions: `find apps packages -name '*.test.ts' -not -path '*/node_modules/*'` → none;
  `test ! -d packages/workbench/src/util && test ! -d packages/git-core/src/util`;
  `bun scripts/check-conventions.ts` exit 0; `grep -n sloglint .golangci.yml` hit.
- Persistence: `grep -n renameio go.mod` hit; `grep -rn "func AtomicWriteFile\|func writeFileAtomically" --include=*.go apps internal` → none.
- Performance: `grep -rln "useCappedList(" packages/git-ui/src | wc -l` ≥ 5; `grep -n useVirtualRows packages/workbench/src/components/LogLines.vue` hit.
- Hunted: `grep -rnE "\.slice\(0, (7|8)\)" --include=*.ts --include=*.vue $D | grep -vE 'useAdeWrites|workflowForm'` → none;
  `grep -rn "h-11" apps/kira-space/frontend/mobile --include=*.vue` → none;
  `grep -n "AI\|SSO" scripts/copy/catalogRules.ts` hits; `grep -n "'packages/git-core/src'" scripts/copy/check-copy.ts` hit;
  `jq -r '.git.menu.newBranch.label' packages/theme/src/i18n/en.json` = `New branch…`.
- Guards: `scripts/consistency-allowlist/` absent; `bun run lint`, `bun run lint:go`, `bun run typecheck` green.
- Tests present and green: `apps/kira-studio/internal/flows/appflow/errors_test.go`,
  `apps/kira-studio/internal/flows/{termflow,dockerflow}/errors_test.go`, Space errors flow test,
  `migrate_ade_panel_width_test.go`, UI `consistency.spec.ts` (both apps),
  `consistency-docker-automations.spec.ts`, `consistency-git.spec.ts`, mobile `consistency.spec.ts`.
- Known open items: no "Backend error messages stay Go literals", no "git-core compact ages"; one
  entry each for `ui-timing`, visual baselines, load-sensitive specs.
- Every suite of §6.3 step 3 green; every changed baseline listed in "Test and fix result".

## Foundation result (F4)

Base `c59036a40` (F0-F3 landed). F4 commits, in order:

1. `7d0d21d20` QueryState on `EmptyState` (new `media` slot), `isRetryable` gating, `TIMING.spinnerDelay` via VueUse `useTimeout`.
2. `5636f481f` 22 event renames (Go, TS, both `ipcChannels.ts`, contract fixture, specs, ARCHITECTURE).
3. `21e0edd15` `Remove` to `Delete` (Connections, MaskRules, CustomScripts both apps, `internal/scripts`); `ConnectionsCreateArgs`; bindings regenerated.
4. `5074f76c8` 46 `.test.ts` to `.spec.ts`; knip, Biome, mutation globs.
5. `4f7927926` 10 `packages/shared` kebab files to camelCase, importers.
6. `9ad249a01` `util` to `lib` in workbench and git-core.
7. `76f5de886` Pinia ids (6 fixed).
8. `1afda2ef0` `prompts.ts` to `packages/workbench/src/testing/ui/`.
9. `c6ca22a68` Studio adopts shared palette and `FontFamilyField`; `shortcuts/state.ts` becomes `studioCommands.ts` (command list only); `CommandPalette.vue` and `fonts.ts` deleted.
10. `df5309d72` N6 (Go/TS code parity, with spec).
11. `ee1b4beb0` allowlists split by stream.
12. `94bc5b136` ARCHITECTURE "Consistency conventions (P266)", Module order text (Memory `tabStrip: false`).

Deviations:

- Pinia: 6 ids fixed, not 5 (`createOpLogStore` `ops` to `opLog` was a sixth N4 hit). `mobileAuth` to `auth`, `dbmcp` to `dbMcp`, `coderepos` to `codeRepos`, `memoryImportUi` to `importUi`, `memoryModelDownloads` to `modelDownloads`.
- N1 rule: role suffixes `.worker`/`.check` allowed and `generated` skipped (`parse.worker.ts`, `layout.worker.ts`, `types.check.ts`, gitwire flatc output are not violations). 4 kebab workbench specs renamed: `shortcutsConflicts`, `agentActivityReducer`, `oplogHydrateRace`, `oplogMarkRaw`.
- `contract.ts` stays per app: it only binds the app's fixture directory to the shared `createContract`; `prompts.ts` moved. Shared helper uses `CHANNEL.promptsChanged`.
- Studio font catalog keys (`studio.settings.appearance.{dataFont,font*}`) deleted; Studio Appearance now shows the shared `theme.fontFamily.*` wording (label "Font family", not "Data font"). No spec asserted the old text.
- Copy exemption for `apps/kira-studio/frontend/src/fonts.ts` removed (file gone; new `fonts.ts` uses `family`, no hit). 8 exemptions remain. U3 exemption for the old Studio `CommandPalette.vue` removed (shared palette needs none).
- 2 foundation-owned hits fixed: `ipcerr/errors.go` G2 (constants), `testing/unit/wailsRuntime.ts` U77 (comment wording).
- Catalog key is `common.error.contract.body` ("Something went wrong inside Kira ({detail})."), not the plan's `.message`/colon wording. Stream A's spec asserts the catalog text.
- Biome `noConsole` override for the console files unchanged (F4 touched none).
- Memory `tabStrip: false` code lands in B3; ARCHITECTURE already states it.

Pending counts (`<ID> <path>`, files in `scripts/consistency-allowlist/`):

| Stream | TS file | TS lines | Go file | Go lines |
|---|---|---|---|---|
| A | `stream-a.txt` | 32 (U74 23, U77 7, U79 1, U81 1) | `go-stream-a.txt` | 68 (G1 58, G2 5, G3 1, G4 4) |
| B | `stream-b.txt` | 43 (U73 1, U74 13, U76 1, U77 7, U79 6, U82 15) | `go-stream-b.txt` | 68 (G1 28, G2 20, G3 15, G4 5) |
| C | `stream-c.txt` | 64 (U67 6, U72 2, U73 8, U74 16, U75 1, U77 5, U80 5, U82 21) | `go-stream-c.txt` | 56 (G1 26, G2 23, G3 1, G4 6) |

Checks at the tip: `bun run lint`, `typecheck`, `lint:go` (0 issues), `lint:dead`, `test:unit` (1899 pass), `go test ./internal/...` plus bridge/dbflow/connections packages, `build:test:studio`, `build:test:space`, `build:space-mobile` all green. No UI suites run.

## Streams result

Streams landed ff-only in order C, B, A onto `v2.0`. Hashes below are post-rebase. Conflicts: `git-core/src/index.ts` (B took C's `shortSha` and `TextRef` exports, dropped B's `dateFormat` export and `sha.ts` copy); duplicate catalog text `update.noNewerRelease` in A and B merged to `backend.core.appUpdate.noNewerRelease`. Landing fixes: U79 exempt matcher now accepts repo-relative paths, so both permanent U79 lines are gone; `ReviewThread.vue` already uses `shortSha`; `format.spec.ts` already covers every deleted `dateFormat.spec.ts` age case.

### Stream A (Studio)

Commits: `cb77a1140` A1, `92305b6f6` A2, `0be52e5fd` A3, `0714723b0` A4, `ab6062b1e` A5, `32cd88452` A6, `314b52620` A8. A7 (sweep) needed no commit.

Deviations:
- Saved-query not-found mapping (`ErrSavedQueryNotFound`, `backend.studio.query.notFound.body`) and `Required("windowKey")` on `Tabs.List` and `Tabs.Save` are new Studio behaviour, added so the specs have something to assert.
- `Queries.Get` does not exist; `Queries.Update` on a deleted id stands in.
- Deleted `workbench/TitleBar.vue`; `App.vue` uses `WorkbenchTitleBar`.

Leftover: `go-stream-a.txt` 4 permanent G4 lines.

Specs written, not run: `apps/kira-studio/internal/flows/appflow/errors_test.go` (4 Go flow tests); `apps/kira-studio/tests/ui/consistency.spec.ts`. The "Duplicate tab" icon, OpenExternal live-region and Color submenu selectors are unverified.

### Stream B (Space)

Commits: `0a6abbb53` B1 gitrpc, mobileweb, mobileterm catalog errors; `07f3b5ae2` B2 bridge, ADE, memory, renameio, log scopes; `56c042a65` B3 shell title bar and palette, ADE width in layout, settings catalog rename; `c6f29ed7b` B4 ADE views; `e857ea262` B5 repo panels; `d83c877a2` B6 mobile and memory; `6a4e8d78a` B7 specs.

Deviations:
- Shared Layout schema has no `panel.ade.width`; Space keeps it as a Space-only slice in `state/adeLayout.ts`. Move it into the shared schema if Studio needs it.
- Window `view.find` shortcut dropped for the palette and View menu entry; `kira:menu:viewFind` still runs `view.find`.
- `ReposDialog` virtual row height is `useRowHeight().single + 2` (the `pb-px` gap).
- `MemoryStart` uses `ModuleStart`; side panels use `EmptyState`.

Leftovers: `stream-b.txt` one permanent U82 line (`mobile/state/useAdeWrites.ts`, UUID slice); `go-stream-b.txt` 3 permanent G4 lines.

Specs written, not run: Go `adeflow/errors_test.go` `TestStaleWorkflowSaveReportsCatalogText`, `mobileweb/respond_test.go` `TestWriteServiceErrorConflictKeepsCatalogText`, `migrate_ade_panel_width_test.go`, `appflow/layout_test.go`; UI `tests/ui/consistency.spec.ts`, `ade-v2-panel.spec.ts`, `git-panel-hidden.spec.ts` (updated); mobile `tests/mobile/consistency.spec.ts`. Selectors for the diff find widget (`.monaco-editor .find-widget.visible`), swatch tooltip (`getByRole('tooltip')`) and day-band label are unverified.

### Stream C (shared packages, Docker, git)

Commits: `70b513b50` C1 docker and scriptruns error codes; `c81f5535d` C2 internal Go files on `ipcerr.T`; `15c4db15d` C3 git-core `TextRef`, `shortSha`, `dateFormat` removal, git-ui dialogs; `de7e02cf2` C4+C5 icons, EmptyState, capped lists, `shortSha`, menu keys; `54431975d` and `c2ccaa7fe` C6 docker-ui and workbench EmptyState, `fireAndForget`, codicons, `RunLog` on `LogLines`, `createOpenExternal`; `816943c9c` C7 api-core catalog text, `logError`, `fireAndForget`; `f1d0dbae3` C8 specs.

Deviations:
- C4 and C5 landed as one commit (shared files). Pin floor dropped.
- `worktreeLabel` stays in git-core (Space `worktrees.ts` consumes it); it uses `shortSha`.
- `runoutcome` reasons not converted. `terminalWindowClosing` key lives under `backend.core.docker.edit`.
- Added `docker-ui/src/components/ConnectionState.vue`: non-side-panel `EmptyState` with Retry, since U78 forbids a Button in a side-panel `EmptyState`.
- api-core: parse warning `detail` and dotenv `message` are `TextRef` (keys `workbench.apiImport.*`). `error:` strings in curl/raw parse and `contentTypeCaption` stay English. `CODE_LANGUAGE_OPTIONS[].label` is a `TextRef`; `bodyBadgeLabel` deleted.
- Not touched, no guard hit: `EditRows`, `ScriptDialog`, `ParamsEditor`, `TIMING` use in docker and automations. `columns.ts` English "commit/commits" count text left.
- Outside C ownership: removed stale `U25 ... RunLog.vue` from `check-ui-primitives.sh`; Space `blameLine.ts` on `formatAgeCompact`; one-line `t(x.key, x.params)` in Studio `ImportCurlDialog.vue`, `EditRawRequestDialog.vue`, `BulkVariablesEditor.vue`, `RequestBodyPane.vue`.
- Space spec asserts worktree trash and stack-remove close, not `codicon-close` on `ReposDialog` remove (it uses trash).
- `ipcerr.T(code, key, params)` takes a non-literal key, so Go key checks cannot see keys passed through wrappers. Unchanged.

Leftovers: `stream-c.txt` empty; `go-stream-c.txt` 2 permanent G4 lines (flowtest harness).

Specs written, not run: `internal/flows/termflow/errors_test.go`; `internal/flows/dockerflow/errors_test.go` (needs Docker); `tests/ui/consistency-docker-automations.spec.ts`; Space `tests/ui/consistency-git.spec.ts`; updated `copy-wording-git.spec.ts` and `copy-coverage-git.spec.ts`. `RunLog` layout inside `LogLines` (flex-1, `max-height: none`) is unverified visually.

Checks per stream: normal hook (lint, typecheck) green, `go build`, `lint:go`. No UI, e2e or Go test suites run.

## P266 result

Status: Done. Nothing pushed.

Commits (base `36eb6b80d`): `d5375f58b` through `2124108e7` plus close-out docs. Groups:
- Source fixes: panics answer `E_INTERNAL`; `toCodedError` idempotent; QueryState spinner delay starts at load; TabStrip Duplicate icon; command items render outside `CommandGroup` (palette was empty); LogLines inner list `shrink-0` (long logs scroll); mobile `@source` for workbench components (44px confirm buttons); palette command labels follow locale; `TestRebaseRun` flake (`waitBehind`).
- Spec/fixture follow-ups: catalog wording, reachable surfaces, docker-edit contract fixture regenerated, kafka malformed page token expects `CodeContract`.
- Close-out: legacy codes retired, `scripts/consistency-allowlist/` deleted, `console.*` converted to `logError`/`logWarn` and the `noConsole` override list removed.

Suites (serial, low workers):
- `go test ./...`: 121 packages ok. Kafka and terminal tests time out under load, pass alone.
- `test:unit`: 1888 pass.
- Studio ui: 505 pass. Space ui: 538 pass after 17 wording fixes.
- Mobile ios+android: 65 pass, 1 skipped.
- Visual: Space 13, Studio 13.
- ipc-frontend: 7 specs pass after wording fixes.
- lint, lint:dead, lint:go, typecheck: green.
- ui-timing: 2 known load-sensitive failures, recorded, not loosened.

Baselines re-recorded (6, each diff inspected; none from Vue formatting):
- Space `git-row-menu-visual`: "New branch" gained ellipsis.
- Space `settings-appearance-visual`: new Font family field.
- Studio `connection-dialog`, `schema-dialog`, `workbench-shell`: EmptyState text 13px muted, ModuleStart stacks actions.
- Studio `settings-appearance`: Font family field.

Deviations:
- `ipcerr.T(` in 48 files vs plan >=60.
- `useCappedList(` in 1 git-ui file (`BranchPicker.vue`, 8 uses) vs >=5 files. Plan caps picker sections only.
- dockerd started by hand for Docker-gated flow tests and `TestEngine` (passes, 4.9s).
- ui-timing failures left open.

## Close-out result

- Exemptions kept: 9 `G4` in `conventions_test.go` (harness and fixture writers, reasons inline); `U82` for `useAdeWrites.ts` (UUID slicing); U-PERMANENT block unchanged. No pending lists remain in any guard.
- Error codes 46 to 39: `Legacy` map and `LEGACY_ERROR_CODES` removed; N6 fails if either returns.
- SecondaryTabs: 33 files. EmptyState: 49 files. ModuleStart: 6 files. Raw `Empty`: 0.
- `console.*` outside logger: 0.
- ARCHITECTURE: "Consistency conventions (P266)" final; resolved `TestEngine` open item deleted.
- Parked: none.
