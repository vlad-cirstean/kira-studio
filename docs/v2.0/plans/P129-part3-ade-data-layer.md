# P129 Part 3 — `useQueue()`, ade data layer and module shell

Plan for `docs/v2.0/SPEC.md`'s `P129 Part 3` row. Planned against `v1.9` at `9736094c` (P129 Part 2
landed).

Binding inputs: Part 1 plan §2 (whole-phase architecture, `docs/v2.0/plans/P129-part1-ade-agent-runtime.md`),
Part 2 plan (`docs/v2.0/plans/P129-part2-ade-queue-backend.md`) and both result sections in
`docs/v2.0/SPEC.md`, design `docs/v2.0/design/SPEC.md` §2.0, §2.1, §2.3 (header and `main` line),
§3, §3.1, §5, §6, §7, and `mockup.html`'s `renderVals()` (lines 789-1813) plus its template (lines
28-152). Design wins over mockup (Part 1 §2.1); Part 1 §2 and Part 2's result win over both where
they already decided.

Every path, symbol and count below was measured in this container at `9736094c`:
`codegraph_explore` for symbols, call graphs and blast radius (`ModeDef`/`ModeRegistry`, both apps'
`WorkbenchShell.vue`/`modes.ts`, `WorkbenchShellBase`, `createAgentSessionsStore`/
`reduceAgentActivity`, `CHANNEL`, Space `bridge/index.ts`/`main.ts`/`gitCredential.ts`/
`coderepos.ts`, `AdeService` and its wire types, `Queue.Snapshot`/`Prs`, `ResolveBranchPr`'s caches,
Space `tests/ui/support/*`, `installControlMocks`), then `Read` for exact lines (the mockup,
`settingsDomain.ts`, `knip.json`, `modules.spec.ts`).

---

## 0. What the SPEC row left open, and resolutions

Standing user decisions (Part 1 plan §0), not reopened: no `ready` or `ciFailing` anywhere; no
Jira-title fallback in titles; PR is `ResolveBranchPr`'s raw state plus title; no Merge action;
`AdeService` has 19 bound methods.

1. **`useQueue` is a pure function, not a composable.** Part 1 §2.2 calls it "a plain function
   module"; the SPEC row names it `useQueue()`. Signature `useQueue(input: QueueInput): QueueView`,
   no Vue import, no reactivity, no clock read. The caller wraps it in `computed()`. Keeps the parity
   test a plain `bun test` with no Vue runtime.
2. **Parity oracle is the mockup itself, run unmodified.** The parity spec reads
   `docs/v2.0/design/mockup.html`, extracts the inline `<script>` from `class DCLogic` up to (not
   including) `const comp = new Component({})`, and runs it in `node:vm` `runInNewContext` with stub
   `setTimeout`/`document`/`navigator`/`window` (only event handlers touch them; `renderVals()`
   itself never does — `TODAY` is the literal `new Date(2026, 8, 22)`, line 935). Each scenario sets
   `comp.state`, calls `comp.renderVals()`, and projects data fields (never style strings, except
   hex-to-tone mapping where a tone lives only in a style). The same scenario converts to wire shape
   and runs `useQueue`. Both projections must be deep-equal.
   **User decisions are neutralized by data, never by patching mockup code:** the oracle wraps
   `repoData()` (a method, line 583) to delete `ready`/`ciFailing` and set every Jira `title` to
   `''`, and empties `jiraTitle` on `state.newWork` drafts. With those gone, the mockup's own `CI
   failing`/`ready` rungs and Jira-title fallback are unreachable, so parity holds exactly.
3. **Conflicts come from Part 2's merge-tree result, not file overlap.** Design §3.1 asks for a
   three-way merge; Part 2 serves it as `pairs[].conflicts` (merge-tree conflicted paths ∩ `shared`).
   `useQueue` marks a mine×review conflict only where `conflicts` is non-empty; shares (`after`) use
   `shared` of mine×mine pairs. The mockup approximates both by file overlap (`sharedF`). Design
   wins (Part 1 §2.1). The parity converter sets `conflicts = shared` for every mine×review overlap,
   so parity still holds, and one focused rule test pins the divergence (overlap without
   `conflicts` is no conflict).
4. **Titles** (design §3 title rule minus Jira title): `branch.name` (user override), else
   `draftTitle` / new-work `title`, else PR title from `RepoPrs.branches[branch]`, else the branch
   name, else the Jira key, else `New work`. Mirrors mockup `titleOf`/`defaultTitle` (line 830-831)
   with `j.title` gone.
5. **Work status rungs**, mockup `status()` (line 1029) with `CI failing` and `ready` removed:
   merged · not merging (parked) · review: conflict / review · not started (new work) · rebasing ·
   pushing · conflict · not pushed · base conflict · `↓N main` · base behind · new (no sessions) ·
   waiting (parent is a review root) · up to date. `branchStatus()` (line 1049) ports unchanged.
6. **Dates.** Wire and settings carry ISO `YYYY-MM-DD` (`plan.day`, `ade.offDays`/`extraDays`/
   `workWeekendDays`) and unix ms (`mergedAt`, `lastFetchAt`). `QueueInput.today` is an ISO date
   the caller derives from VueUse `useNow({ interval: 60_000 })` in **local** time (never
   `toISOString()`, which is UTC). Internally `useQueue` works in integer day offsets from `today`,
   exactly like the mockup, via calendar arithmetic on `Date.UTC(y, m, d)` (no DST drift).
   `plan.day[item]` null or absent means no own day (Part 2 §2.1: `NULL = Later`). `LATER = 9999`,
   as in the mockup. Weekday/month labels are fixed English arrays, matching the mockup's own, not
   `Intl`.
7. **Estimates and capacity from settings, not constants.** `parseEst` uses `ade.workdayHours`
   (default 6) and `ade.spanDayShare` (default 0.5): `1d` = one workday; `Nd` (N ≥ 2) =
   N·workday·share hours over N days; `w` = ceil(n·5) days likewise; `m`/`h` as the mockup. Day
   capacity is `workdayHours`. Horizon and history band counts use `ade.horizonDays`/`historyDays`.
   Defaults equal the mockup's constants, so parity holds; one rule test runs non-default values.
8. **`rebasing`/`pushing` are optional inputs, empty in Part 3.** The mockup keeps them as UI state
   set by actions Part 3 does not have. `QueueInput.rebasing?: ReadonlySet<string>` and
   `pushing?: ReadonlySet<string>`; Part 3's wiring passes neither. Part 4 (rebase sends, force-push
   switch) and Part 6 (Force push (N)) supply them from their own mutation state. Parity scenarios
   still exercise both rungs.
9. **Selection is an input; its store field lands with its writer.** `QueueInput.selectedId?`
   defaults to the first queue item, as mockup `selId` does. Part 3 has no selection UI, so it passes
   nothing and `adeUi` gets no selection field yet: a field nobody writes is scaffolding. Part 5
   (timeline click) adds `selectedByRepo` and its writer; `historyOpen` also Part 5; dialog state
   Part 4.
10. **Control members land with their first consumer.** Knip fails an unused export, not an unused
    object property, so adding all 19 methods now would pass the gate but ship 13 unused members —
    scaffolding CLAUDE.md rules out, and Part 1 §3's rule is "every new export has a consumer in the
    same part". Part 3 adds the 6 methods and 5 subscriptions it calls (§2.2). The remaining 13,
    each added by its first consumer part:

    | Method | Part |
    |---|---|
    | `PrepareLaunch`, `Send`, `ArchiveRisk`, `Archive`, `ForcePush`, `SetQueuedAfter` | 4 (dialogs, Queue after, force-push switch) |
    | `CandidateBranches`, `AddBranch`, `AddNewWork`, `SetPlan` | 5 (Add popover, drag and drop, overflow Move) |
    | `UpdateNewWork`, `SetBranchMeta`, `BindNewWork` | 6 (detail panel) |

    If a later plan finds an earlier consumer, the member moves with it; the table only records
    this plan's expectation.
11. **Query freshness is push-driven.** Keys follow `queryClient.ts`'s flat `[domain, ...ids]`:
    `['ade','sessions']`, `['ade','snapshot',codeRepoId]`, `['ade','prs',codeRepoId]`, all
    `staleTime: Infinity` (the client already has `retry: false`, `refetchOnWindowFocus: false`).
    Invalidation:
    - `kira:ade:sessions` → `['ade','sessions']`.
    - `kira:ade:repo {codeRepoId}` → that repo's `snapshot` and `prs`. `prs` rides along because
      `ResolveBranchPr` is cache-backed (`ensureSnapshot` bulk cache, then per-branch
      `branchCache`, `gitsession/gh.go:404-470`): a repeat call within TTL spawns no GitHub
      request, and a newly queued branch needs its PR title.
    - `kira:agent:event` with `event === 'Stop'` → snapshot of the repo owning that `terminalId`,
      looked up in the cached `['ade','sessions']` data. Part 2's own obligation (its risk table:
      "Part 3 invalidates on agent `Stop`") for linked-worktree dirty state Claude leaves behind.
    - Refresh success → that repo's `snapshot` and `prs`.
    `staleTime: Infinity` rather than refetch-on-mount: a missing invalidation should show as a
    bug, not be masked by remount churn; a snapshot is real git work per repo tab switch.
12. **`ModeDef` becomes a discriminated union.** `packages/workbench/src/modes.ts`:
    `PanelModeDef { label; icon; layout?: 'panel'; panel; start; newTab? }` and a non-exported
    `FullModeDef { label; icon; layout: 'full'; view: Component }`, `ModeDef = PanelModeDef |
    FullModeDef`, `ModeRegistry<M extends string, D extends ModeDef = ModeDef> = Record<M, D>`.
    Kira Studio's `MODES` becomes `ModeRegistry<AppMode, PanelModeDef>` — a one-line type change, no
    behavior change, since its shell reads `.panel`/`.start` unconditionally. `ModeSwitcher.vue`
    reads only `label`/`icon`; untouched.
13. **Full layout hides the tab strip through a shared-shell prop.** `WorkbenchShellBase` always
    renders the tab-strip row (both `hasDock` branches). It gains `tabStripVisible?: boolean`
    (default `true`) gating that row. Space's shell passes `false` and `project-visible=false` when
    the active def is `full`, and renders `<component :is="def.view" />` in `#main` instead of
    `MainView`. Studio passes nothing: unchanged. The persisted `layout.panel.project.visible` is
    not written, so switching back to Git restores the panel as it was.
14. **`kira:ade:credential` maps `repoId` through `useCodeReposStore`, not the snapshot cache.**
    Part 2 §0.3 suggested the snapshot's `gitRepoId`. But the event is `EmitFocused`: the focused
    window may never have loaded that repo's snapshot. Every window hydrates `codeReposStore` at
    boot, and `RepoSummary.repoId` is the same `summary.RepoID` gitsession emits
    (`bridge/codeworkspace.go` `ImportRepo` stores `RepoID: summary.RepoID`; `gitsession/conn.go:141`
    emits it as `repoId`). The renderer half enqueues
    onto the existing `useGitCredentialStore().enqueueCredentialRequest` (same dialog, same FIFO)
    and answers through `AdeService.ProvideCredential({ requestId, secret })`, `null` secret sent as
    absent, errors swallowed exactly as `repo/git/transport.ts:144-156` does (the broker's 120s
    bound already ended the wait). An unmapped `repoId` still enqueues with `codeRepoId: ''`: the
    dialog then shows no repo label, and the prompt stays answerable rather than hanging for 120s.
15. **Repo tabs list every imported repo** (`codeReposStore.records`, existing order). The
    needs-input count is running sessions for that `codeRepoId` whose activity phase is
    `attention`. The mockup counts only queued items' sessions and turns an archived item's running
    session into `stopped` (line 812-813). Real sessions outlive archive, and a session really
    asking for input deserves the badge, so Part 3 counts every running session of the repo.
    Parity fixtures have no archived items, so this does not affect parity. Active tab:
    `adeUi.activeRepoId`, runtime only, defaulting to the first record. The pinned `All agents` tab
    is Part 7's.
16. **Header fetch label** (mockup line 1770, with real data):
    - pending Refresh: `fetching…`;
    - otherwise `fetched <ago>` or, after a Refresh this session, `<ago> · <note>`;
    - then ` · autofetch off` when `autofetchMinutes` is 0, else ` · autofetch every <N>m` (the
      mockup hard-codes off; Part 2 serves the real global setting);
    - `<ago>` from VueUse `useTimeAgo(lastFetchAt)` with mockup-shaped messages (`just now`, `4m
      ago`, `1h ago`); `lastFetchAt` null → `never fetched`;
    - note: `N ref(s) changed`, plus ` · N merged` when `newlyMerged` is non-empty, plus
      ` · conflicts rechecked` when refs changed; both zero → `no changes`;
    - Refresh result `error` (a `RemoteOpError`) or a thrown call → `fetch failed · <message>`, danger
      tone, full text in the tooltip;
    - the note persists (runtime, per repo) until the next Refresh, as in the mockup.
17. **`main` line in Part 3 is name plus behind note only.** `Rebase all` is wired by Part 4 (its
    row), `Add` is Part 5's popover; neither renders in Part 3 — scope left out stays out, never a
    disabled stub. Name from `snapshot.main?.name`; a repo with no main ref shows `no main branch`
    in the note slot. Note from `QueueView.behindRoots` (mockup line 1756/1775): `N stack(s) behind`
    amber, else `all stacks current` green.
18. **Activity icons.** Kinds `input | working | waiting | idle | stopped` (design §2.0, mockup
    line 663), from session state plus agent phase: stopped session → `stopped`; running with phase
    `attention` → `input`, `working` → `working`, `waiting` → `waiting`, `idle` or no activity entry
    → `idle`. Tints stay literal data values (Part 1 §2.1): amber `#e8a33d` circle with `!`, green
    `#6cc58a` dot with halo, blue `#7aa7ff` ring with `z`, grey `#7c7f88` hollow ring, `#4a4d56`
    square; tooltip labels `needs input`/`working`/`waiting on monitor`/`idle`/`stopped`. Part 3
    renders them in repo tabs; `QueueView` also carries per-item sorted `acts` for Part 5's boxes.
19. **Empty and error states** the design leaves implicit: no imported repo → shadcn `Empty` with
    "Import repository…" calling the existing `codeReposStore.importRepoViaDialog()`; snapshot query
    error → shadcn `Alert` with the error message and a Retry (`refetch`); first load → a muted
    `Loading…` line in the header slot.
20. **Where the new files live.** All ade code under `apps/kira-space/frontend/src/ade/` (Part 1
    §2.2), stores under `src/ade/state/`. The P127 agent-store instance is
    `src/ade/state/agentSessions.ts` (`createAgentSessionsStore(control)`), a separate store from
    `adeUi` (one concern each).
21. **Stale comments pruned in passing:** `packages/workbench/src/host.ts:64-67` ("used by no app
    yet") and `ModeDef`'s own doc comments; ARCHITECTURE's P128 registry paragraph ("`ade`
    placeholder").
22. **Open items.** Part 2's rename/delete conflict item stays open: closing it changes `pairs`'
    wire shape and the conflict tag's meaning, not Part 3's scope. The linked-worktree dirty item
    narrows (Claude's edits now refresh on `Stop`) but stays open for a person's edits; reword it.
23. **No SPEC.md edit for later parts.** §0.8-§0.10's hand-offs fit inside Parts 4-6's existing
    rows (their dialogs, selection and panel own those sources).

---

## 1. Confirmed current state

- `packages/workbench/src/modes.ts`: `ModeDef{label, icon, panel, start, newTab?}`,
  `ModeRegistry<M> = Record<M, ModeDef>`. Consumers: `ModeSwitcher.vue`, both apps' `modes.ts` and
  `WorkbenchShell.vue`.
- `apps/kira-space/frontend/src/workbench/modes.ts`: `MODE_ORDER = ['git','terminal','ade']`;
  `ade: { label: 'Agents', icon: 'robot', panel: AdePanel, start: AdeStart }`.
- Placeholders `src/ade/AdePanel.vue` (`data-testid="ade-panel"`), `src/ade/AdeStart.vue`
  (`data-testid="ade-start"`). Only other reference: `tests/ui/modules.spec.ts:128-132` (asserts
  `ade-start` visible, `tab-strip-new` count 0).
- Space `workbench/WorkbenchShell.vue` (73 lines): `WorkbenchShellBase` with `#panel`,
  `#tab-strip` (`TabStrip` + `#new-tab`), `#main` (`MainView` `#empty`), `#status`; computes
  `MODES[modeStore.active].panel/start/newTab`.
- `packages/workbench/src/components/WorkbenchShell.vue`: props `projectVisible`, `projectWidth`,
  `opsVisible?`, `opsHeight?`; tab-strip row (`data-testid="tab-strip"`) rendered unconditionally in
  both dock branches.
- `packages/workbench/src/state/createAgentSessionsStore.ts`: `AgentSessionsControl {
  terminalAgentSessions(); onAgentSessions(cb); onAgentEvent(cb) }`; `defineStore('agentSessions')`
  keyed by `terminalId`; no app instance exists.
- `packages/shared/domain/agent.ts`: `AgentEvent{terminalId, event, …}`, `AgentPhase = 'idle' |
  'working' | 'attention' | 'waiting'`.
- `packages/shared/protocol/events.ts` `CHANNEL`: has `agentSessions`, `agentEvent`; no ade entries.
  Go side: `bridge/events.go:54,62-63` (`kira:ade:sessions`, `kira:ade:repo`,
  `kira:ade:credential`). No Go/TS channel parity test exists.
- `AdeService` (`bridge/ade.go`): 19 methods. `AgentSessions()` returns `AgentSessionsEvent` (no
  error), matching `terminalAgentSessions`. `Sessions()` takes no args (all repos).
  `AdeRefreshResult{refsChanged int, newlyMerged []string, error?: {kind, message, remoteMessage?}}`.
  `kira:ade:credential` payload is gitsession's `credentialRequestPayload{requestId, repoId,
  prompt, masked}` (`gitsession/conn.go:141`).
- `bridge/index.ts`: `spaceControl` object spread into `control`; bound calls as
  `unwrap(Service.Method(args)).then((r) => trust<T>(r))`, pushes as `on(CHANNEL.x, cb)`.
- `main.ts` `mountShell`: critical `Promise.all` (layout, settings, codeRepos, tabs), optional
  `Promise.allSettled` (gitClients, terminal defaults, keepAwake), then `createApp`,
  `app.use(VueQueryPlugin, { queryClient })`. Space has zero `useQuery`/`useMutation` call sites.
- `state/settingsDomain.ts:89-124`: `ade.{panelWidth, allAgentsFilter, horizonDays, historyDays,
  extraDays, offDays, workWeekendDays, workdayHours, spanDayShare}`, defaults 0/active/14/14/[]/[]/
  []/6/0.5. Part 3 reads all but `panelWidth` (Part 6) and `allAgentsFilter` (Part 7).
- `state/gitCredential.ts`: `PendingCredential{codeRepoId, prompt, masked, answer}`;
  `GitCredentialDialog.vue:78` labels via `codeReposStore.codeRepoRecord(id)?.name`.
- `packages/theme/src/components/ui/`: alert, badge, button, empty, tabs, tooltip (and others). No
  new primitive needed.
- `knip.json`: Space frontend project `src/**/*.{ts,vue}`, entry `index.html`; `tests/` is outside
  it, so an export only a test imports fails `lint:dead`.
- Space UI tests: `tests/ui/support/{ipcChannels.ts, mockRuntime.ts (FQN_SUFFIX_BY_IPC_KEY,
  WILDCARD_DEFAULTS), bootSnapshots.ts, types.ts}`; the shared mock supports `hold`/`release()` and
  `emitWailsEvent`; Space's `ControlSnapshot` type lacks `hold`.
- Baselines (Part 2 result): `test:unit` 1667 pass; `test:ui:space` 38/38; `test:ui:studio` 300.

---

## 2. Design

### 2.1 Module shape

- `packages/workbench/src/modes.ts`: §0.12 union.
- `packages/workbench/src/components/WorkbenchShell.vue`: `tabStripVisible` prop (§0.13).
- `apps/kira-studio/frontend/src/workbench/modes.ts`: `ModeRegistry<AppMode, PanelModeDef>`.
- Space `workbench/WorkbenchShell.vue`: `const def = computed(() => MODES[modeStore.active])`,
  `isFull = def.layout === 'full'`; panel/start/newTab read only when not full.
- Space `workbench/modes.ts`: `ade: { label: 'Agents', icon: 'robot', layout: 'full', view:
  AdeView }`. Delete `AdePanel.vue`, `AdeStart.vue`.
- `visibleWorkspace()` unchanged: in `ade` mode it already returns `'ade'`, which owns no tabs.

### 2.2 Bridge

`packages/shared/protocol/events.ts` `CHANNEL`: `adeSessions: 'kira:ade:sessions'`,
`adeRepo: 'kira:ade:repo'`, `adeCredential: 'kira:ade:credential'`.

`bridge/index.ts` imports `* as AdeService from '@bindings/adeservice.js'`; `spaceControl` gains:

| Member | Call |
|---|---|
| `terminalAgentSessions()` | `AdeService.AgentSessions()` → `AgentSessionsEvent` |
| `onAgentSessions(cb)` / `onAgentEvent(cb)` | `on(CHANNEL.agentSessions/agentEvent, cb)` |
| `adeSessions()` | `AdeService.Sessions()` → `AdeSessionsResult` |
| `adeRepoSnapshot(codeRepoId)` | `AdeService.RepoSnapshot({ codeRepoId })` |
| `adeRepoPrs(codeRepoId)` | `AdeService.RepoPrs({ codeRepoId })` |
| `adeRefresh(codeRepoId)` | `AdeService.Refresh({ codeRepoId })` |
| `adeProvideCredential(requestId, secret)` | `AdeService.ProvideCredential({ requestId, secret })` |
| `onAdeSessions(cb)` / `onAdeRepo(cb)` / `onAdeCredential(cb)` | `on(CHANNEL.adeSessions/adeRepo/adeCredential, cb)` |

`control` then structurally satisfies `AgentSessionsControl`.

### 2.3 `src/ade/wire.ts`

TS mirrors of Part 2's wire structs, only those Part 3 reads: `AdeSession`, `AdeSessionsResult`,
`AdeRepoSnapshot` and its members (`AdeMain`, `AdeBranch`, `AdeNewWork`, `AdePlan`, `AdePair`,
`AdeHistoryItem`, `AdeFile`, `AdeJira`), `AdePr`, `AdeRepoPrs`, `AdeRefreshResult`,
`AdeCredentialRequest`, `AdeRepoChangedEvent`. Field names and optionality copied from
`bridge/ade.go`'s json tags (the generated bindings' models are the cross-check). Types only; each
exported type needs a real importer in `src/` (knip), so a type only used inside `wire.ts` stays
unexported.

### 2.4 Queries, invalidation, credentials (`src/ade/queries.ts`)

- `useAdeSessions()`, `useAdeSnapshot(codeRepoId: MaybeRefOrGetter<string>)`,
  `useAdePrs(codeRepoId)` — `useQuery` with §0.11 keys, `enabled` only when the id is non-empty.
- `useAdeRefresh(codeRepoId)` — `useMutation({ mutationKey: ['ade','refresh',id] })`; on settle
  records the result or error in `adeUi.recordRefresh(id, …)`, invalidates `snapshot` and `prs`.
  Pending state read by `useIsMutating({ mutationKey })`, so it survives a repo-tab switch.
- `installAdeSignals(queryClient)` — called once from `main.ts`, app lifetime (no teardown; the
  window is the lifetime): the three §0.11 subscriptions plus the §0.14 credential handler.

### 2.5 Stores

- `src/ade/state/agentSessions.ts`: `export const useAgentSessionsStore =
  createAgentSessionsStore(control)`.
- `src/ade/state/adeUi.ts` (`defineStore('adeUi')`, setup style): `activeRepoId` +
  `setActiveRepo(id)`; `refreshNote: Record<codeRepoId, { kind: 'ok'; refsChanged; newlyMerged }
  | { kind: 'error'; message }>` + `recordRefresh(id, note)`. Nothing else in Part 3 (§0.9).

### 2.6 `useQueue` (`src/ade/useQueue.ts`, pure)

**Input** (`QueueInput`): `snapshot: AdeRepoSnapshot`, `sessions: AdeSession[]` (this repo's),
`activity: ReadonlyMap<terminalId, AgentActivity>`, `prs: AdeRepoPrs | undefined`, `settings:
Settings['ade']`, `today: string`, `selectedId?`, `rebasing?`, `pushing?`.

**Pipeline**, one stage per `renderVals()` block, in its order, each a module-private function:

1. Items: branches (mine/review/parked) plus new-work drafts; `Branch.sessions` joined from
   `sessions` by `branch`/`newWorkId` (Part 2 result); activity kind per session (§0.18); `acts`
   sorted input > working > waiting > idle, then stopped.
2. Titles (§0.4), colors from `snapshot.colors`, estimates (`parseEst`, §0.7).
3. Graph: `parentOf` (`base` if queued, `""` = main; `plan.queuedAfter` overrides), `kids`,
   `ancestors`, `rootOf`, `behind` (from `branch.behind`).
4. Conflicts and shares from `pairs` (§0.3).
5. Calendar helpers: `isWeekend`, `isOff` (offDays, weekends minus workWeekendDays), `nextWork`,
   `firstWork`, `dayLabel`, `dayLong`, `spanDays`.
6. Stacks: DFS over non-parked roots; lead = first mine member; parked items single stacks.
7. `effDay` (design §5 rule 2 and the mockup's review/-1e9 handling).
8. Segments per effective day: lead, `span`, `days`, `end`, `pos` (index in `plan.order`, mockup
   fallbacks), `cont`.
9. Merge order: `mineSegs` by (end, day, pos); review-only `extSegs` directly before the first mine
   segment they conflict with, else Later; `seq`, `mergeN`.
10. `after` (nearest earlier segment of another stack sharing files; `{ id, file }` basename).
11. Selection, `ripple`, `rippleRoots`, `atRisk`.
12. Work status and branch status (§0.5).
13. Stack tags and actions in the mockup's precedence: merged, parked, conflict (`Queue after`),
    unpushed (`Force push`), ripple, root behind (`Rebase`), after (`Rebase onto`), cont
    (`↳ stacked`), review root (`⏳ owner`), clean. Tag label, tone, tooltip text and action kind
    plus target ids — data only, handlers are later parts'.
14. Cells: per-row own actions (merged → Archive; mine without sessions → Start), info cells
    (`Nd → day`, `from <day>`), overflow into the tooltip.
15. Day totals: `hoursOn`/`segHoursOn` (multi-day estimates spread per day), capacity
    `workdayHours`, `overflowOf` (moves the last mine non-merged starts until the day fits, with the
    move target).
16. Bands: history (`historyDays`), today plus `horizonDays`, sequence days, extra and off days,
    Later; month label on change; weekend/off/today flags; overdue (past days with unmerged lead
    segments ending before today).
17. `behindRoots` (mine lead segments, not parked, not cont, root mine, behind > 0, not merged).

**Output** (`QueueView`): `items` (id, kind, title, branchText, color, work status, branch status,
acts, estimate), `stacks`, `segments` in `seq` order (with tag, action, cells, after, mergeN,
cont, span), `bands`, `selectedId`, `ripple`, `atRisk`, `behindRoots`. Tones are names (`amber`,
`red`, …), never CSS. Part 3's UI reads only `behindRoots`; the rest is Parts 4-6's input,
covered by parity now. `QueueView`'s fields are properties of one exported type, so knip sees one
export with a consumer.

`src/ade/activity.ts`: `activityKind(session, activity)` (used by `useQueue` and tabs) and
`needsInputByRepo(sessions, activity): Map<codeRepoId, number>` (used by `AdeRepoTabs`).

### 2.7 Components (`src/ade/`, `<script setup lang="ts">`, Tailwind only)

- `AdeView.vue` (`data-testid="ade-view"`): full-area column: `AdeRepoTabs`, then `AdeRepoView`
  for `adeUi.activeRepoId`, or the §0.19 empty state.
- `AdeRepoTabs.vue`: 40px bar (design §2.1, mockup lines 33-45) on shadcn `Tabs`/`TabsList`/
  `TabsTrigger` (keyboard and ARIA for free), restyled: selected tab amber top border and `bg`
  token, others muted; per tab the input icon plus count in mono 11px before the name, hidden at
  zero; name truncates at 180px. `data-testid="ade-repo-tab"`, `data-repo-id`.
- `AdeRepoView.vue`: queries for its repo; `computed(() => useQueue({...}))`; sticky header and
  `main` line; nothing below them in Part 3 (timeline is Part 5).
- `AdeProjectHeader.vue`: mono 13/600 name, 11px truncating fetch label (§0.16) with tooltip,
  spacer, shadcn `Button` (28px, `codicon-refresh`, `Refresh`/`Refreshing…`, disabled while
  pending). Test ids `ade-project-name`, `ade-fetch-label`, `ade-refresh`.
- `AdeMainLine.vue`: 30px row, mockup geometry (max-width 560, 60px ruler gutter plus 218px
  offset); `main` name and note (§0.17). Test ids `ade-main-line`, `ade-main-note`.
- `AdeActivityIcon.vue`: prop `kind`; §0.18 shapes via Tailwind arbitrary values; shadcn `Tooltip`
  label; `data-activity`.
- Theme tokens for chrome (bg, border, fg, muted); literal tints only for tones and activity.

### 2.8 `main.ts` (narrow, P132 edits it later)

Two additions in `mountShell`, nothing moved:

1. `useAgentSessionsStore(pinia).initAgentSessions()` joins the optional `Promise.allSettled`
   group (a failure leaves activity empty, never blocks boot — same posture as keepAwake).
2. `installAdeSignals(queryClient)` right after the stores are built, before `mount()`, so no push
   is missed between mount and first query.

---

## 3. Tests (per CLAUDE.md's bar)

`useQueue` is a large interacting decision structure (design §6 asks for tests); it qualifies.
Nothing else in Part 3 gets a unit test (queries, stores, wire types, icon mapping, label
formatting are thin).

### 3.1 `apps/kira-space/tests/unit/ade-queue-parity.spec.ts`

- `support/mockupOracle.ts`: loads the mockup (§0.2), neutralizes by data, exposes
  `run(state) → projection`.
- `support/mockupToWire.ts`: converts one mockup repo plus state to `QueueInput`. `repoData()`
  items → `AdeBranch`/`AdeNewWork`; files `'+14 −9'` → `added`/`deleted`; plan offsets → ISO from
  2026-09-22; `merged` state → `merged`/`mergedAt`; pairs computed by path overlap (mine×mine
  `shared`; mine×review `shared` and `conflicts`, §0.3); `historyData()` → `history`; sessions →
  `AdeSession` plus an activity map (`input` → `attention`); PRs → `AdeRepoPrs`; settings from
  mockup `horizon`/`history`/`offDays`/`extraDays`/`workWeekend` with defaults otherwise.
- Projection compared, per scenario: tab needs-input counts (via `needsInputByRepo`); per item
  title, branch text, work status, branch status, acts; stacks; per segment day, days, end, lead,
  pos, cont, mergeN, after, tag (label, tone, tooltip), action (kind, targets), cells; bands
  (label, month, hours, capacity overflow and move target, overdue, weekend/off/today); selected
  id, ripple, atRisk; `behindRoots` count and `mainNote` text.
- Scenarios (each run for `web-app`, `api`, `mobile` where meaningful): initial state; each item
  selected in turn (ripple); `cart` unmerged and a second item merged; `queuedAfter` set;
  `unpushed` set; `rebasing` a root; `pushing` a branch; an off day and a worked weekend inside the
  horizon; an extra day; estimate overrides forcing overflow on today and a cascaded overflow; a
  user name override; horizon/history 7.
- Imports only `useQueue` and `needsInputByRepo` from `src/` (§1 knip note).

### 3.2 `apps/kira-space/tests/unit/ade-queue-rules.spec.ts`

Only what parity cannot reach, each through `useQueue`'s output:

1. File overlap mine×review without `conflicts` is not a conflict (§0.3 divergence).
2. `workdayHours` 8 / `spanDayShare` 0.25: `1d`, `3d`, `1w` hours and spans; capacity 8.
3. Month boundary and year boundary band labels; `today` on a Saturday.
4. Title chain: PR title used when no name/draft; Jira key when no branch and no title.
5. Stale `plan.order`/`queuedAfter` naming a missing item is ignored, not thrown.

### 3.3 `apps/kira-space/tests/ui/ade-module.spec.ts` (`test:ui:space`, mocked control)

Fixtures boot with `windowsEnsure → { mode: 'ade' }`, two repos, a `Sessions()` answer with one
running session per repo, `AgentSessions()` listing both terminals, and per-repo snapshot/PR
answers. Clock pinned with Playwright `page.clock` so relative times are exact.

1. Full layout: `ade-view` visible; `project-panel` and `tab-strip` absent; switching to Git
   restores both (and the repo panel's persisted visibility).
2. Repo tabs: both names; no count until `kira:agent:event` `Notification` (via
   `emitWailsEvent`) makes one session `attention` — then `input` icon and `1` before that repo's
   name only; a `Stop` for that terminal clears it, and triggers a second `RepoSnapshot` call
   (`control.log()`).
3. Header: name; `fetched 4m ago · autofetch off`; `autofetchMinutes: 5` repo reads
   `autofetch every 5m`; `lastFetchAt` null reads `never fetched`.
4. Refresh: `Refresh` held (`hold: true`) → button `Refreshing…` disabled, label `fetching…`;
   release with `{ refsChanged: 3, newlyMerged: ['a'] }` and a second snapshot → `just now · 3 refs
   changed · 1 merged · conflicts rechecked`; `RepoPrs` called again. Error result → `fetch
   failed · <message>`.
5. `main` line: snapshot with one mine root `behind: 2` → `1 stack behind`; `kira:ade:repo` for that
   repo → refetch with `behind: 0` → `all stacks current`. A `kira:ade:repo` for the other repo
   triggers no call for this one.
6. Credential: `kira:ade:credential` with the repo's `repoId` → credential dialog shows the repo
   name; submit → `ProvideCredential` logged with that `requestId` and the secret.
7. Switching repo tab swaps header and main line.

Support edits: `ipcChannels.ts` (IPC keys for the 6 calls; push names `adeSessions`, `adeRepo`,
`adeCredential`, `agentSessions`, `agentEvent`), `mockRuntime.ts` `FQN_SUFFIX_BY_IPC_KEY`
(`AdeService.*`) and `WILDCARD_DEFAULTS` (`AgentSessions` → `{ sessions: [] }`, since every boot
now calls it; `Sessions` → `{ sessions: [] }`), `types.ts` `hold?: boolean`.
`modules.spec.ts:128-132`: `ade-view` visible and `tab-strip` absent replace the `ade-start`/"no +"
assertions.

---

## 4. Steps and commits

Record `P129P3_START=$(git rev-parse HEAD)` and the three suite baselines (§1) before step 1. Every
commit passes the pre-commit hook (`.githooks/pre-commit`: `lint`, `typecheck`). `lint:dead` runs
only in `.githooks/pre-push`, so it must be clean at step 5 and before push, not per commit.

1. **`feat(workbench): full-area module layout`** — §0.12/§0.13: `modes.ts` union,
   `WorkbenchShellBase` `tabStripVisible`, Studio `modes.ts` type. No Space change yet;
   `test:ui:studio` spot-run of the shell specs.
2. **`feat(space): ade bridge surface and channels`** — `CHANNEL` entries, §2.2 control members,
   `ade/wire.ts` (types consumed in this commit only), `ade/state/agentSessions.ts`, `main.ts`
   §2.8 item 1, `host.ts` comment. Consumer in-commit: `main.ts`.
3. **`feat(space): useQueue derivation`** — `ade/useQueue.ts`, `ade/activity.ts`, parity oracle,
   converter, both unit specs. `useQueue`/`needsInputByRepo` gain their `src/` consumers in step 4
   (knip is pre-push only, so the split is legal).
4. **`feat(space): ade module shell`** — `queries.ts`, `adeUi.ts`, all §2.7 components,
   `modes.ts` entry, delete placeholders, Space shell branch, `main.ts` §2.8 item 2,
   `modules.spec.ts` update.
5. **`test(space): ade module UI coverage`** — §3.3 spec and support edits. Run `test:ui:space`
   once here; fixes land as follow-up `fix(space):` commits.
6. **`docs: ARCHITECTURE records ade data layer (P129 Part 3)`** — §5.1.
7. Result section `## P129 Part 3 result` in `docs/v2.0/SPEC.md`.

---

## 5. File inventory

New: `apps/kira-space/frontend/src/ade/{wire.ts, queries.ts, useQueue.ts, activity.ts,
AdeView.vue, AdeRepoTabs.vue, AdeRepoView.vue, AdeProjectHeader.vue, AdeMainLine.vue,
AdeActivityIcon.vue}`, `src/ade/state/{adeUi.ts, agentSessions.ts}`,
`apps/kira-space/tests/unit/{ade-queue-parity.spec.ts, ade-queue-rules.spec.ts,
support/mockupOracle.ts, support/mockupToWire.ts}`, `apps/kira-space/tests/ui/ade-module.spec.ts`.

Edited: `packages/workbench/src/{modes.ts, components/WorkbenchShell.vue, host.ts}`,
`packages/shared/protocol/events.ts`, `apps/kira-studio/frontend/src/workbench/modes.ts`,
`apps/kira-space/frontend/src/{bridge/index.ts, main.ts, workbench/modes.ts,
workbench/WorkbenchShell.vue}`, `apps/kira-space/tests/ui/{modules.spec.ts,
support/ipcChannels.ts, support/mockRuntime.ts, support/types.ts}`, `docs/ARCHITECTURE.md`,
`docs/v2.0/SPEC.md`.

Deleted: `apps/kira-space/frontend/src/ade/{AdePanel.vue, AdeStart.vue}`.

No Go change. No new dependency (TanStack Vue Query, VueUse, shadcn-vue already present).

### 5.1 `docs/ARCHITECTURE.md`

- P128 registry paragraph: `ModeDef` union, `layout: 'full'`, `tabStripVisible`; drop "`ade`
  placeholder".
- New Kira Space ade renderer paragraph: `useQueue` pure port with mockup-as-oracle parity; query
  keys and push invalidation (incl. `Stop`); agent-store instance; credential mapping via
  `repoId`; control members land with first consumer.
- Known open items: reword the linked-worktree dirty item (§0.22).

---

## 6. Verification

Measure `test:unit`, `test:ui:space`, `test:ui:studio` at `P129P3_START` first.

| Command | Expected |
|---|---|
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean |
| `bun run build:space`, `bun run build:studio` | Clean |
| `bun run test:unit` | Baseline plus the two new specs, all pass |
| `bun run test:ui:space` | Baseline 38 plus §3.3's cases, all pass |
| `bun run test:ui:studio` | 300, unchanged |
| `go build ./...` | Clean (no Go edit; bindings regenerate unchanged) |

### 6.1 Live check

Server-mode Space (`docs/DEV_ENVIRONMENT.md`) against this repo with two queued branches (Part 2's
live-check setup): switch to Agents; full-area view, repo tab, header with the real `FETCH_HEAD`
age and autofetch setting; Refresh shows `fetching…` then a note; `main` note matches
`git rev-list --count` behind of the queued root. Screenshot beside mockup lines 28-110 in the
result section; differences only in theme tokens.

---

## 7. Closing audit

| Check | Command | Pass |
|---|---|---|
| No `ready`/`ciFailing` | `rg -nw 'ready\|ciFailing' apps/kira-space/frontend/src/ade` | Empty |
| No Jira title | `rg -n -i 'jira' apps/kira-space/frontend/src/ade` | Key/url fields and the key fallback only |
| PR raw only | `rg -n 'Approved\|reviewDecision\|mergeable' apps/kira-space/frontend/src/ade` | Empty |
| No git-ui/kira-ui | `rg -n "@kira/git-ui\|@kira/kira-ui\|git-ui/\|kira-ui/" apps/kira-space/frontend/src/ade` | Empty |
| Placeholders gone | `rg -n 'AdePanel\|AdeStart\|ade-start\|ade-panel' apps packages` | Empty |
| SFC form | `rg -L '<script setup lang="ts">' apps/kira-space/frontend/src/ade/*.vue` | Empty; `rg -n '<style' …/ade` empty |
| TanStack real usage | `rg -n 'useQuery\|useMutation\|useIsMutating' apps/kira-space/frontend/src/ade` | Snapshot, sessions, PRs, Refresh |
| Agent store real usage | `rg -n 'useAgentSessionsStore' apps/kira-space/frontend/src` | `main.ts` init plus a component reading activity |
| Control members | `rg -n 'AdeService\.' apps/kira-space/frontend/src/bridge/index.ts` | Exactly the 6 of §2.2 |
| `useQueue` pure | `rg -n "from 'vue'\|Date.now\|new Date()" apps/kira-space/frontend/src/ade/useQueue.ts` | Empty |
| `main.ts` narrow | `git diff $P129P3_START -- apps/kira-space/frontend/src/main.ts` | §2.8's two additions and their imports only |
| Studio unchanged | `git diff --stat $P129P3_START -- apps/kira-studio` | `workbench/modes.ts` one line |
| Parity breadth | Parity spec's projection | Every row-listed concept compared (§8 table) |
| §9 design decisions | Design §9 list vs this part | Each kept or out of Part 3's scope, noted in the result |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Mockup script touches a global at load or in `renderVals()` | `node:vm` context with stubs; test fails loudly on `ReferenceError`, never patches mockup code |
| Mockup edits later break parity | Mockup is a fixed design input; a real change is a design change, reviewed as one |
| Converter bug masks a port bug (both wrong the same way) | Converter builds wire data only from raw mockup data, never from `renderVals()` output; rule specs cover hand-computed cases |
| Local vs UTC date drift at midnight/DST | `today` from local Y-M-D; offsets via `Date.UTC`; rule spec 3 |
| `useQueue` recompute cost | n is tens of items; one `computed` per open repo; `today` changes daily, not per minute |
| Stop invalidation misses a session not yet in the sessions cache | `kira:ade:sessions` fires on start before any hook event; worst case the next `kira:ade:repo` or Refresh catches up |
| Credential for an unmapped repo | Enqueued with empty label, still answerable (§0.14) |
| Step 3's exports have no consumer until step 4 | Knip runs pre-push only; `lint:dead` checked clean after step 5 |
| `WorkbenchShellBase` prop regresses Studio geometry | Default `true`; Studio passes nothing; `test:ui:studio` unchanged |

---

## 9. Acceptance, mapped to the SPEC row

| SPEC row wording | Where |
|---|---|
| Port `renderVals()` into a pure `useQueue()` module | §0.1, §2.6 |
| Unit tests: stacks, segments, effective days, spans, merge order | §3.1 projection (stacks, segment day/days/end/span, mergeN), §3.2 case 2 |
| conflicts/shares/ripple | §0.3, §3.1 (tags, after, ripple scenarios), §3.2 case 1 |
| work and branch status | §0.5, §3.1 (status per item, rebasing/pushing/unpushed scenarios) |
| stack tags, positions, titles | §3.1 (tag, action, pos, title), §3.2 case 4 |
| day totals, overflow | §3.1 (band hours, overflow scenarios), §3.2 case 2 |
| No `CI failing`/`ready` rung; no Jira-title fallback | §0.2, §0.4, §0.5, §7 audit |
| TanStack Query over `AdeService`, invalidated by push signals | §0.10, §0.11, §2.4, §3.3 cases 2, 4, 5 |
| `adeUi` Pinia store | §2.5 |
| Space's P127 agent-store instance and control methods | §2.2, §2.5, §2.8 |
| `ModeDef` gains `layout: 'full'`; `ade` renders a full-area view | §0.12, §0.13, §2.1, §3.3 case 1 |
| Placeholders deleted | §2.1, §7 audit |
| Repo tab bar with needs-input counts (§2.1) | §0.15, §2.7, §3.3 case 2 |
| Project header with fetch status and Refresh (§2.3) | §0.16, §2.7, §3.3 cases 3-4 |
| `main` line with behind count (§2.3) | §0.17, §2.7, §3.3 case 5 |
| Activity icons (§2.0) | §0.18, §2.7, §3.3 case 2 |
| `useQueue` parity with `renderVals()` on the mockup's own data | §0.2, §3.1 |
| `test:ui:space` coverage under mocked control | §3.3 |
| Also edits Space `main.ts` (P132 runs after) | §2.8, §7 audit |
