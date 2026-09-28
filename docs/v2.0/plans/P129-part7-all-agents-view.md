# P129 Part 7 — All agents view; closing mockup comparison

Base: `147788d0` (`docs(v2.0): P135 result`). Last P129 part; its acceptance closes P129.

Sources read in full for this plan: `docs/v2.0/design/SPEC.md` (§2.0-§2.2, §2.4, §4, §6, §9),
`docs/v2.0/design/mockup.html` (nav 33-45, All view 47-85, tab and All view logic 848-902,
`actSummary` 674-678, dialog worktree chips), `docs/v2.0/SPEC.md` (P129 rows, Parts 1/4/6 and
P135 results), the Part 1 and Part 6 plans. Discovery went through `codegraph_explore` on the
worktree-local index, then targeted reads.

SPEC row, verbatim: "Design §2.1 pinned `All agents` tab (total needs-input count) and §2.2 view
(Active/Older filter, aggregated activity line, rows grouped by repo and sorted by urgency,
needs-input tint, Open to the repo/branch/session, Start/Resume from Older with the worktree
choice, archived sessions under Older, resume fallback when the worktree is gone). Cross-window
Open for a session running in another window. Closing: the original row's acceptance, a live Kira
Space run compared against `mockup.html` screen by screen, differing only in theme-adapted visual
tokens; design §9 re-audited across all parts; `docs/ARCHITECTURE.md`'s P129 open item removed".

---

## 0. What the SPEC row left open, and resolutions

Standing user decisions (Part 1 §0), not reopened:
- Claude Code icon is a generic codicon, never the branded asset.
- No Jira sync, no `ready`, no `ciFailing`, no Merge action anywhere.
- Design wins over mockup. Mockup wins for markup structure, data flow and interaction detail the
  design leaves implicit. Tone tints, the 20-colour palette and the Claude accent `#d97757` stay
  literal values; chrome uses `--kira-*` tokens or Tailwind utilities.
- No `@kira/git-ui` or `kira-ui` import in `ade/`.
- P135's dependency nodes, inline Jira line and extend-only estimate are user-requested additions
  after the design. They are not regressions against the mockup (§7.3, §7.4).

### 0.1 P137 coupling (disclosed)

P137 will later replace `AdeRepoTabs.vue` with the shared `TabStrip.vue`, which already has a
pinned-tab slot. P137 has not landed. So this part builds the pinned tab inside
`AdeRepoTabs.vue`'s current shadcn `Tabs` shape and keeps it loosely coupled:
- The count lives in `activity.ts` (`activitySummary`), not in tab markup.
- The "which view is showing" state lives in `adeUi` (`allAgents` flag, §0.3), not in tab values.
- The view is its own component, `AdeAllAgentsView.vue`.
- The tab markup is one small `TabsTrigger` block: icon, count, label.
P137 then moves only that block into `TabStrip`'s pinned slot and binds the same store action and
helper. No duplicated work lands in either direction.

### 0.2 Resume delivery bug found during planning (fixed here)

`dialogFlow.ts` `sendStart`'s `spec.resume` branch has shipped broken since Part 4 and was never
exercised: `ade-panel.spec.ts` opens the Resume dialog but never clicks Send.
- It sends `branch: ''` and `newWorkId: ''`, so `AdePrepareLaunchArgs.Validate` rejects it with
  `E_INVALID` ("exactly one of branch/newWorkId is required").
- It sends `resume: session.claudeSessionId`, but `Tracker.Prepare` looks `args.Resume` up as the
  `ade_sessions` record id. Even past validation it returns `ErrSessionNotFound`.
- It ignores the recorded-cwd rule on the renderer side: `deliver` opens the terminal at
  `target.cwd`, which is the renderer's guess, while `Prepare` records `existing.Cwd`.
- `launch.ts`'s `DeliverLaunchTarget.resume` doc comment says "Claude id"; it must say record id.
Part 6's Stopped-list Resume and this part's Older Start both depend on this path, so this part
fixes it first (§2.2, §2.3, step 1).

### 0.3 Pinned tab state

Mockup: `state.repo = '*'` for the pinned tab, and `lastRepo` keeps the last real repo.
Resolution: `adeUi` gains `allAgents: boolean` (runtime only, default `false`, matching the
mockup's initial `repo: 'web-app'`). `activeRepoId` keeps meaning "a real repo id" and doubles as
the mockup's `lastRepo`.
- `showAllAgents()` sets `allAgents = true` and leaves `activeRepoId` alone.
- `showRepo(id)` sets `activeRepoId = id` and `allAgents = false`.
- `setActiveRepo` stays for `AdeView`'s record-list watch, which never sees a sentinel now.
- `AdeRepoTabs` maps its `Tabs` model value: `allAgents ? ALL_AGENTS_TAB : activeRepoId`, where
  `ALL_AGENTS_TAB = '__all__'` is a module-local constant. Its update handler calls
  `showAllAgents()` or `showRepo(value)`.
- `AdeView` renders `AdeAllAgentsView` when `allAgents`, else `AdeRepoView` as today. The pinned
  tab shows whenever at least one repo is imported. The empty state stays for zero repos.
- Reject a sentinel inside `activeRepoId`: `AdeRepoView` is keyed and fed by it, and the
  records watch resets any unknown id. A flag needs neither guard.

### 0.4 Counts and the aggregated line

Mockup `actSummary` (674-678): counts running sessions only, kinds `input`, `working`, `waiting`
(idle excluded), omits zero kinds, title `N <label>`.
- New pure `activitySummary(sessions, activity): { input: number; working: number; waiting:
  number }` in `activity.ts`, built on `activityKind` (non-running sessions read `stopped`, so they
  drop out).
- Per-repo tab count keeps `needsInputByRepo`. Pinned tab count is
  `activitySummary(allSessions, activity).input`, rendered exactly like a repo tab's count: glyph,
  then number, before the label, hidden at zero.
- Aggregated line (Active only): one `AdeActivityIcon` plus `N <ACTIVITY_LABEL>` per non-zero kind,
  gap-separated spans. The design's `·` separators are shorthand for the same content; the mockup's
  markup (spaced spans, no `·`) wins, since the acceptance compares against the mockup screen.
- Pinned icon: codicon `terminal`, 13 px, colour `#d97757`. The mockup draws a terminal glyph in
  the Claude accent, not a branded mark, so the codicon keeps the standing icon rule.

### 0.5 Data sources

All through TanStack Query; no new Go endpoint.
- Sessions: `useAdeSessions()` (every repo's records, already cached).
- Activity: `agentSessionsStore.activity` (P127 store instance).
- Per repo with at least one session: snapshot and PRs through TanStack `useQueries`, with the same
  keys and options `useAdeSnapshot`/`useAdePrs` use, so the cache is shared with the repo tabs.
  Extract `adeSnapshotOptions(id)` and `adePrsOptions(id)` in `queries.ts`; the two existing
  composables and the new `useQueries` call both consume them.
- Titles and colours: run `useQueue(...)` per repo, with the same inputs `AdeRepoView` passes
  (`selectedId` and history options omitted). Titles, PR-title fallback and palette colours then
  match the timeline exactly, with no second title chain.
- Cost, honest estimate: one `useQueue` per repo with sessions per recompute, and one `RepoPrs`
  (`gh`) fetch per such repo per app session (`staleTime: Infinity`). Typical repo counts are
  small. Measure only if the view feels slow in the live run.
- `QueueItem` gains `sessionIds: string[]`: every joined session record id, any state. This keeps
  the session-to-item join in `useQueue`'s `buildItems` only. The parity spec compares fields one
  by one, so an added field does not disturb it.

### 0.6 Pure builder `allAgents.ts`

No Vue import, no clock read. Input: ordered repos (`codeReposStore.records` order) each with
`{ codeRepoId, name, view: QueueView | null, snapshot: AdeRepoSnapshot | null, sessions }`, plus
`activity`. Output: `{ activeN, olderN, summary, groups }` for the requested filter.
- `activeN` counts running sessions; `olderN` counts the rest (mockup 866-867).
- Row join, in order:
  1. A `view.items` entry whose `sessionIds` has the session: live item. Title is `item.title`.
     Colour is `item.color`. Branch text is `''` when `title === item.branch`, else `item.branch`
     (mockup 879). Not archived.
  2. Else a `snapshot.history` entry matching `session.branch` (branch sessions) or
     `session.newWorkId` (`item === newWorkId`): archived. Title and branch from the history entry,
     colour from `snapshot.colors[item]` through the palette, else `#3a3e48`.
  3. Else an orphan (branch removed outside the app): title `session.branch || 'New work'`,
     `itemId: null`, colour `#3a3e48`.
- Row fields: `sessionId`, `codeRepoId`, `itemId`, `claudeLabel` (`sessionLabel`), `kind`
  (`activityKind`), `label` (`ACTIVITY_LABEL[kind]`, or `stopped · archived` for an archived row),
  `lastActiveAt`, `action` (`'open'` running, `'start'` otherwise), `title`, `branchText`,
  `worktree` (`session.cwd`), `color`, `archived`, `cwdMissing`, `terminalId`.
- Sort within a repo by `actRank`, ties by `lastActiveAt` descending. The mockup ties by fixture
  order, which has no real-data equivalent; the design only says "sorted by urgency".
- Groups with no rows drop out. No groups means the view shows `Nothing here.`
- `useQueue`'s `actRank` moves to `activity.ts` (exported), with `useQueue` importing it.
- The worktree column shows the real absolute `session.cwd`. The mockup's `~/wt/<repo>/<leaf>` is
  fixture data, not a token.

### 0.7 Filter

Design §6 `UiPrefs.allAgentsFilter` already exists as the `ade.allAgentsFilter` settings leaf
(Part 2 §7: Go `AdeSettings.AllAgentsFilter`, zod enum `active | older`, default `active`). Read
`settingsStore.ade.allAgentsFilter`; write through `settingsStore.patchSettings({ ade: {
allAgentsFilter } })`, the same path `ade.panelWidth` uses. Control: shadcn `ToggleGroup`
(`type="single"`, already used by `AdeClaudeDialog`), styled as the mockup's segmented control;
ignore an empty-value update so one item always stays selected. Labels `Active N` / `Older N`.
Default `active` satisfies design §9's "listing every session ever … by default" rejection.

### 0.8 Open, same window

Row action `open`, when `terminalsStore.terminalSession(row.terminalId)` is truthy (this window
owns the PTY):
- Live item: `adeUi.showRepo(codeRepoId)`, then `adeUi.openSession(codeRepoId, itemId, sessionId)`.
  That selects the branch, sets the panel tab to Agents and picks that session's terminal tab
  (mockup 886).
- Orphan (`itemId === null`): `showRepo(codeRepoId)` only.

### 0.9 Open, cross-window

When the PTY is not in this window, the owning window must show it, since terminals are
window-scoped and `TerminalHostView` must never attach to a foreign id (Part 6 §0.18).
- Go `terminal.Registry.WindowOf(id string) (string, bool)`: reads the `byWindow` index under the
  mutex. `Session` already stores the key for `remove`; use whichever is simpler.
- Go `shell.WindowRegistry.Focus(key string) bool`: under the mutex, look up the entry; outside
  it, `Show()`, `UnMinimise()`, `Focus()` on the `*application.WebviewWindow`. Returns `false`
  for an unknown key. Confirm in the vendored Wails v3 source that these calls are safe off the
  main thread; if not, wrap them in `application.InvokeSync`.
- `AdeService` gains `FocusWindow func(key string) bool`, assigned in `main.go` after
  `windows := shell.NewWindowRegistry()` exists (same two-step `windowsSvc.OpenNewWindow` uses).
  Wails binds methods only, so the field is not exposed.
- Bound method `AdeService.FocusSession(args AdeFocusSessionArgs) (bool, error)`, args
  `{ sessionId, itemId }`. `Validate`: `sessionId` required; `itemId` at most 255 bytes, no NUL or
  newline. Steps: load the record (not found gives `ErrSessionNotFound`'s ipcerr mapping); not
  `running` returns `false`; `Registry.WindowOf(record.TerminalID)` missing returns `false`;
  `FocusWindow(key)` false returns `false`; else emit, then return `true`.
- Emit: new `ChannelAdeOpenSession = "kira:ade:open-session"`, helper
  `AdeOpenSession(ev *Events, windowKey string, payload AdeOpenSessionEvent)` using
  `ev.emit.EmitTo`. Payload `{ codeRepoId, itemId, sessionId }`, `codeRepoId` from the record.
- Confirm with `codegraph_explore` that the `WindowKey` `terminal.BoundService.Open` records is the
  same key `WindowRegistry.Add` and `EmitTo` use. If they differ, map between them in `main.go`
  and say so in the result section.
- Renderer: `installAdeSignals` handles the channel. Handler: `useModeStore().setMode('ade')`;
  `adeUi.showRepo(codeRepoId)`; if `itemId`, `adeUi.openSession(codeRepoId, itemId, sessionId)`.
  Add the channel to `packages/shared/protocol/events.ts` and `tests/ui/support/ipcChannels.ts`.
- Caller: the row's Open calls `control.adeFocusSession` (new `mutations.ts` mutation). On `false`
  (owner gone, or the session already stopping) fall back to §0.8's local path; the panel then shows
  its existing `Running in another window.` line until the next `kira:ade:sessions` refresh.

### 0.10 Start from Older

Row action `start` opens the Claude dialog with the mockup 887 spec:
`resumeSpec(ctx, itemId, sessionId, { askWt: true, wt: forceNew ? 'new' : 'same', noSame:
forceNew, title: 'Start Claude Code' })`, where `forceNew = row.archived || row.cwdMissing`. For an
orphan, `itemId` is `session.newWorkId || session.branch`.
- `AdeAllAgentsView` builds a `DialogCtx` for the dialog's repo: `{ view, snapshot, sessions:
  that repo's, today, repoRoot: codeRepoRecord(id).root }`, same fields `AdeRepoView` builds.
- It mounts one `AdeClaudeDialog` with `:code-repo-id="dialogRepoId"` (local ref set on Start).
  `AdeRepoView` is unmounted while All agents shows, so only one dialog mount exists.
- Design §2.4 "Restarting an archived session from All agents only offers `new worktree`" is
  `noSame`. Design §4 "Worktree choice only when starting from All agents" is `askWt`, false for
  the Agents tab's Resume.

### 0.11 Resume template and target lines

`startResumeLines` today prints `Resume session <record uuid>` and `wtOf(item)`. Both are wrong for
a real resume: the design's `51cd` is the id the row shows, and a resume always runs in the
recorded cwd.
- Look the session up by `spec.resume` in `ctx.sessions`.
- `Resume session <id>.`: the 8-char id `sessionLabel` shows after `claude `.
- `- Branch: <session.branch>`, falling back to `branchNameOf`.
- `- Worktree:` `create a new worktree for it` when `askWt && wt === 'new'` (unchanged), else
  `session.cwd`, falling back to `wtOf`.
- `branchNameOf` and `titleOfItem` fall back to the matching `snapshot.history` entry before the
  raw id, so the dialog's target block names an archived branch properly.
- Align the parity fixture (`support/mockupToWire.ts`) if the resume case's session `cwd` or
  `claudeSessionId` does not already reproduce the mockup's `wtOf` and id text.

### 0.12 Resume fallback when the worktree is gone

Claude Code keys stored conversations per project directory (the cwd). `claude --resume <id>`
from another directory is not reliable. The installed CLI (2.1.283) prints "This conversation is
from a different directory" for that case, and filters `/resume` by recorded cwd.
- Resolution: `Tracker.Prepare`, on resume, `os.Stat(existing.Cwd)`. If it does not exist,
  `os.MkdirAll(existing.Cwd, 0o755)`, then resume there. The same path keeps the same project key,
  so `--resume` finds the transcript no matter how the CLI handles a directory mismatch. The
  folder-trust entry is also keyed by that path, so no new trust prompt appears.
- The dialog forces `new worktree`, so the message tells Claude to create a new worktree for the
  branch. Git changes stay Claude's (design §3); the app never runs `git worktree add` here.
- If `existing.Cwd` exists but is not a directory, return an error (`ErrResumeCwdNotDir`, mapped to
  `E_INVALID`).
- `AdePrepareLaunchResult` gains `Cwd`: the effective cwd (`existing.Cwd` on resume, `args.Cwd`
  otherwise). `deliver` opens the terminal at `launch.cwd`, not `target.cwd`, so the PTY and the
  record always agree.
- `AdePrepareLaunchArgs.Validate`: when `Resume != ""`, skip the branch/newWorkId and cwd checks,
  since the record governs all three. Keep the `codeRepoId` and message-length checks.
- The wire session gains `cwdMissing: boolean`, set in `AdeService.Sessions()` by `os.Stat` on
  each record's cwd. That is one stat per record per sessions fetch, which is cheap.
- **Disclosure:** the planning pass tried to confirm the CLI's cross-directory behaviour further
  and was stopped by this sandbox's permission classifier. Do not retry that probe. The fallback
  above does not depend on the answer. The live check (§6.1) uses Part 1's fake `claude` on `PATH`.
  A real-CLI resume in a recreated directory stays unverified here; state that in the result
  section.

### 0.13 "The P129 open item"

Part 1 plan §5.2 planned a Known open item ("wired in Go; `ade` UI lands in P129 Parts 3-7") to
be removed entirely by Part 7. At `147788d0` it is already absent from Known open items (no match
for `Parts 3-7` there). Stale mentions remain in body prose: line 2176 ("the UI itself is Parts
3-7") and 2201 ("UI in Parts 3-7").
- Re-grep `rg -n "Parts 3-7|lands in P129" docs/ARCHITECTURE.md`. Delete any Known open item that
  matches; rewrite the two prose parentheticals to past tense naming Parts 3-7.
- Line ~2193 ("always in the session's own recorded cwd") gains the §0.12 fallback.
- Re-evaluate every P129 Known open item against the finished phase:
  - Backgrounded `Bash` cannot arm `waiting` (Part 1 §4.8): stays; outside P129's control.
  - Rename/delete conflict pairs dropped (Part 2 §0.7): stays. Replace "Part 3+'s own call" with
    "a follow-up phase's call", since no later P129 part exists.
  - Linked-worktree dirty state not watched (Part 3): stays.
  - Pending "Send to Claude, then archive" not persisted (Part 4): stays.
- List the four remaining items in the result section so the user can decide on follow-up phases.

---

## 1. Confirmed current state (`147788d0`)

- `AdeRepoTabs.vue`: shadcn `Tabs` over `codeReposStore.records`, `v-model` on
  `adeUiStore.activeRepoId`, count from `needsInputByRepo`, active trigger
  `data-[state=active]:border-t-[#e8a33d]`. A comment names the pinned tab as Part 7's.
- `AdeView.vue`: tabs, then `AdeRepoView` keyed by `activeRepoId`; the records watch resets an
  unknown id to the first record.
- `activity.ts`: `ActivityKind`, `ACTIVITY_LABEL`, `activityKind`, `sessionLabel`,
  `needsInputByRepo`. `actRank` lives in `useQueue.ts`.
- `adeUi.ts`: `activeRepoId`, `selectedByRepo`, `panelTab`, `agentTabByItem`, `dialog`,
  `confirm`, `openSession`, `pickWorktree`.
- `dialogCompose.ts`: `resumeSpec` already takes `askWt`/`wt`/`noSame`/`title` (comment names
  mockup 887); `wtOptionsFor` honours `noSame`; `startResumeLines` has the §0.11 issues.
- `dialogFlow.ts` `sendStart`: §0.2 bug.
- `launch.ts` `deliver`: opens the terminal at `target.cwd`.
- `bridge/ade.go`: `AdePrepareLaunchArgs.Validate` as quoted in §0.2; `AdeService{Deps, Tracker,
  Registry, Queue}`; `AdeSessionsChanged` broadcasts; `AdeRepoChanged` emits;
  `AdeCredentialRequested` uses `EmitFocused`.
- `ade/tracker.go` `Prepare`: resume uses `existing.Cwd`, never `args.Cwd`, and its comment defers
  the archived-worktree fallback to Part 7.
- `terminal.Registry`: `byWindow` index, `CloseWindow`, `AgentSessions`; no owner lookup.
- `shell.WindowRegistry`: `Add`, `DetachAll`, `Count`, `Any`, `Keys`, `RemoveAndCount`; no focus.
- `main.go`: `adeSvc` built before `windows := shell.NewWindowRegistry()`.
- Settings: `ade.allAgentsFilter` exists in Go and zod; no UI reads it.
- Baselines from the P135 result: `test:unit` 1817 pass; `test:ui:space` 76 pass.

---

## 2. Design

### 2.1 Module shape (`apps/kira-space/frontend/src/ade/`)

New:
- `allAgents.ts`: §0.6 pure builder.
- `AdeAllAgentsView.vue`: filter, aggregated line, groups, the dialog mount, the Open/Start
  handlers.
- `AdeAllAgentsRow.vue`: one row, props only, emits `open`/`start`.

Edited: `activity.ts` (`activitySummary`, `actRank`), `useQueue.ts` (`sessionIds`, imports
`actRank`), `state/adeUi.ts` (`allAgents`, `showAllAgents`, `showRepo`), `AdeRepoTabs.vue`,
`AdeView.vue`, `queries.ts` (option factories, open-session handler), `mutations.ts`
(`useAdeFocusSession`), `dialogCompose.ts` (§0.11), `dialogFlow.ts` (§0.2), `launch.ts` (§0.12),
`wire.ts` (`cwdMissing`, `AdeLaunch.cwd`, `AdeOpenSessionEvent`), `tones.ts` (shared Claude button
style, below).

`adeUi` stays one concern: ade UI state. `allAgents` is the same concern as `activeRepoId`.

### 2.2 Go (`apps/kira-space/internal/`, `internal/`)

- `ade/tracker.go` `Prepare`: §0.12 stat, recreate, not-a-directory error; result carries `Cwd`.
  Update the stale comment.
- `bridge/ade.go`: `Validate` resume relaxation; `AdePrepareLaunchResult.Cwd`;
  `AdeSessionWire.CwdMissing`; `AdeFocusSessionArgs` plus `Validate`; `FocusWindow` field;
  `FocusSession` method; `AdeOpenSessionEvent`; `AdeOpenSession` helper.
- `bridge/events.go`: `ChannelAdeOpenSession`.
- `internal/terminal/session.go`: `Registry.WindowOf`.
- `internal/shell/registry.go`: `WindowRegistry.Focus`.
- `main.go`: `adeSvc.FocusWindow = windows.Focus`.
- Regenerate bindings (`wails3 task common:generate:bindings`, `docs/DEV_ENVIRONMENT.md`).

### 2.3 Bridge, wire, TanStack

- `frontend/src/bridge/index.ts`: `adeFocusSession: (args) => AdeService.FocusSession(args)`.
- `mutations.ts`: `useAdeFocusSession()`, a plain `useMutation`, no invalidation (focus changes no
  server state).
- `queries.ts`: `adeSnapshotOptions`/`adePrsOptions`; `installAdeSignals` subscribes
  `kira:ade:open-session` (§0.9).
- `launch.ts`: `deliver` uses `launch.cwd`; fix the `resume` doc comment.
- `dialogFlow.ts` resume branch: find the session by `spec.resume`; if it is missing, throw
  `Session not found` (surfaced through `setError`). Deliver `{ codeRepoId, branch:
  session.branch, newWorkId: session.newWorkId, cwd: session.cwd, resume: session.id, message }`.
  The relaxed `Validate` accepts it whatever the record's branch/newWorkId shape is.

### 2.4 Components (`<script setup lang="ts">`, Tailwind only, no `<style>`)

**`AdeRepoTabs.vue`**: one leading `TabsTrigger` with `value="__all__"` and
`data-testid="ade-all-agents-tab"`, before the `v-for`. Content: `CodiconIcon name="terminal"`
(`#d97757` via `:style`), the §0.4 count (`AdeActivityIcon kind="input"` plus number, hidden at
zero), label `All agents`. The mockup gives the pinned tab a stronger right border (`#2a2d35`
against `#1e2026`); use the theme's border token one step stronger than the repo tabs' border.
Same height, padding, active amber top border and truncation as the repo triggers.

**`AdeAllAgentsView.vue`** (mockup 47-85): scroll container `flex-1 min-h-0 overflow-auto`,
padding `18px 28px 28px`; inner column `max-w-[1040px] flex flex-col gap-[18px]`.
- Header row, gap 14: `ToggleGroup` segmented control (container padding 3, radius 8, theme
  surface and border; items 28 px high, padding 0 12, active item raised surface, weight 600
  against 500), then the aggregated line (12 px, secondary text, gap 12) when Active.
- One `<section>` per group, gap 2: header `h3` mono 13 px/600, padding `0 12px 6px`, bottom border,
  margin-bottom 4; then rows.
- Empty: `Nothing here.` (13 px, muted, padding 12).
- Data: `computed` over §0.5 inputs into `buildAllAgents(...)`. `useNow` is not needed; the
  last-active text uses `formatTimeAgo` (VueUse) with `adeAgoOptions`, recomputed on each sessions
  or activity change, the same as `AdeAgentsPill`.

**`AdeAllAgentsRow.vue`** (mockup 67-78): grid
`grid-cols-[4px_20px_130px_76px_64px_90px_minmax(0,1fr)] gap-x-[14px] items-center px-3 py-1.5
rounded-lg`.
- A row whose `kind` is `input` gets background `rgba(232,163,61,0.07)` via `:style` (literal
  tone). Only running sessions can read `input`.
- Cells: colour bar (`w-1 self-stretch rounded-sm`, `row.color`); `AdeActivityGlyph` 14 px with
  `title=label`; label 12 px coloured by the literal tone text colour (`input` `#f0b85c`, `working`
  `#7fd49b`, `waiting` `#93b6ff`, else `#9a9ca5`, from `tones.ts`); last active 12 px muted;
  button; `claude <id>` mono 11 px muted; title (13 px/600, truncate) over `branch worktree`
  (mono 11 px, muted, truncate).
- Buttons are shadcn `Button`, 26 px. Open: `variant="dialog"` (outlined). Start: filled Claude
  accent from a shared `CLAUDE_BUTTON_STYLE` in `tones.ts` (extracted from `AdePanelHeader`'s
  `actionStyle` literal, which then consumes it).
- `data-testid`s: `ade-all-agents-row` with `data-session-id`, `ade-all-agents-action`,
  `ade-all-agents-group` with `data-repo-id`, `ade-all-agents-filter`, `ade-all-agents-acts`.

**`AdeView.vue`**: `<AdeAllAgentsView v-if="adeUiStore.allAgents" />`, else the existing keyed
`AdeRepoView`.

---

## 3. Tests (per CLAUDE.md's bar)

### 3.1 `apps/kira-space/tests/unit/ade-all-agents-parity.spec.ts` (new)

Justification: grouping, the three-way join, archived labelling, filter counts and urgency sort
interact. The mockup's `renderVals()` `allView` is the acceptance oracle, and the existing
`mockupOracle`/`mockupToWire` harness already converts one mockup repo at a time.
- Convert every mockup repo with `mockupToWire`, run `useQueue` per repo, then `buildAllAgents`.
- Compare against `V.allView` for both filters: `activeLabel`/`olderLabel` counts; `acts` kinds and
  counts; group repo order; per group, the multiset of rows by `(title, branch, state label,
  button)`; and non-decreasing `actRank`. Tie order is not compared (§0.6).
- Compare the pinned tab's count against `V.repoTabs[0].acts`.

### 3.2 Existing unit specs

- `ade-dialog-parity.spec.ts` / `ade-dialog-rules.spec.ts`: the resume case's expected lines per
  §0.11. Add one parity case for the All agents Start spec (`askWt`, archived `noSame`) against the
  mockup's own dialog output.
- `ade-queue-parity.spec.ts`: unchanged; `sessionIds` is additive.

### 3.3 Go

- `ade/tracker_test.go`: `TestPrepareResumeRecreatesMissingCwd`. A stopped record whose cwd was
  removed: `Prepare` recreates it and returns it as `Cwd`. A cwd that is a file returns the error.
  Justification: it creates a filesystem path taken from the DB, and CI has no other coverage.
- No tests for `WindowOf`, `Focus`, `FocusSession` validation or `cwdMissing` (lookups and
  pass-throughs).

### 3.4 `apps/kira-space/tests/ui/ade-all-agents.spec.ts` (new, `test:ui:space`, mocked control)

Fixtures: two repos. Sessions: running input, working and waiting; idle; stopped on a live
branch; stopped on an archived branch (history entry); stopped with `cwdMissing`.
1. Pinned tab is first, labelled `All agents`, and shows the total needs-input count across both
   repos. With no input sessions the count is hidden.
2. Selecting the pinned tab shows the view with the amber top border on it. Selecting a repo tab
   shows that repo's view. Selecting the pinned tab leaves `activeRepoId` unchanged.
3. Active by default: `Active N` / `Older N` counts; aggregated line shows `N needs input`,
   `N working`, `N waiting on monitor`, no idle, no zero kinds.
4. Groups in record order with the mono header; rows urgency-sorted; the needs-input row carries
   the tint.
5. Row text: coloured label, `claude <8 chars>`, title, and `branch worktree` with the branch
   blank when title equals branch.
6. Older: aggregated line hidden; `SettingsService` patch carries `ade.allAgentsFilter: 'older'`;
   a reload restores Older.
7. Archived row reads `stopped · archived`. Start opens `Start Claude Code` with only
   `new worktree` and the line `create a new worktree for it`.
8. Live stopped row: both chips, `same worktree` on, worktree line shows the recorded cwd;
   picking `new worktree` switches the line. Send calls `AdeService.PrepareLaunch` with
   `resume` equal to the record id and the record's branch/newWorkId, then opens the terminal at the
   returned `cwd` (the §0.2 regression).
9. `cwdMissing` row: only `new worktree`.
10. Open on a session whose terminal this page owns: repo tab active, item selected, Agents tab on
    that session. Reuse `ade-panel.spec.ts`'s local-terminal setup.
11. Open on a foreign terminal: `AdeService.FocusSession` called with `{ sessionId, itemId }`.
    Then, with the page in `git` mode, emit `kira:ade:open-session`: mode switches to `ade`, the
    repo tab, item and Agents tab follow.
12. No sessions: `Nothing here.`

Also update `ade-panel.spec.ts`'s Resume case to click Send and assert the §0.2 arguments, since
the Agents tab's Resume shares the fixed path.

---

## 4. Steps and commits

Record `P129P7_START=$(git rev-parse HEAD)` and baselines (`test:unit`, `test:ui:space`,
`test:ui:studio` counts; `go test` for `internal/ade`, `internal/bridge`, `internal/gitsession`)
before step 1. Every commit passes the pre-commit hook. `lint:dead` (knip) stays clean at every
commit: each new export lands with its consumer (tests count as knip entries).

1. **`fix(space): ade resume launches the recorded session`**: §0.2, §0.11, §0.12's Go half
   (`Validate`, `Prepare`, result `Cwd`), `launch.ts`, `dialogFlow.ts`, `dialogCompose.ts`,
   bindings, `wire.ts` `AdeLaunch.cwd`, §3.3, §3.2 dialog spec updates, the `ade-panel.spec.ts`
   Resume Send case.
2. **`feat(space): ade all agents builder`**: `activity.ts` (`activitySummary`, `actRank`),
   `useQueue.ts` `sessionIds`, `allAgents.ts`, §3.1.
3. **`feat(space): ade pinned All agents tab and view`**: `adeUi`, `AdeRepoTabs`, `AdeView`,
   `queries.ts` option factories, `AdeAllAgentsView`, `AdeAllAgentsRow`, `tones.ts`
   `CLAUDE_BUTTON_STYLE` (plus `AdePanelHeader` consuming it), filter persistence, same-window
   Open.
4. **`feat(space): ade start from Older with worktree choice`**: `cwdMissing` (Go and wire), dialog
   mount and `DialogCtx` in `AdeAllAgentsView`, §0.10.
5. **`feat(space): ade cross-window Open`**: §0.9 Go (`WindowOf`, `Focus`, `FocusSession`, channel,
   `main.go`), bindings, `bridge/index.ts`, `mutations.ts`, `installAdeSignals`, channel lists.
6. **`test(space): ade All agents UI coverage`**: §3.4, `ipcChannels.ts`, `mockRuntime.ts` entries.
   Run `test:ui:space` once here. Fixes land as follow-up `fix(space):` commits, one per finding.
7. **`docs: ARCHITECTURE records the ade All agents view (P129 Part 7)`**: §5.1.
8. Run §6.1 and §7. Each mismatch against the mockup or the design becomes its own `fix(space):`
   commit before the result section.
9. Result section `## P129 Part 7 result` in `docs/v2.0/SPEC.md`: §6 outcomes, §6.1 and §7.3
   per-screen verdicts, the §7.4 table, the §0.12 disclosure, the §0.13 list, and a closing line
   that P129's whole-phase acceptance holds (or exactly what does not).

---

## 5. File inventory

New: `ade/allAgents.ts`, `ade/AdeAllAgentsView.vue`, `ade/AdeAllAgentsRow.vue`;
`apps/kira-space/tests/unit/ade-all-agents-parity.spec.ts`;
`apps/kira-space/tests/ui/ade-all-agents.spec.ts`.

Edited:
- Go: `apps/kira-space/internal/ade/tracker.go`, `tracker_test.go`;
  `apps/kira-space/internal/bridge/ade.go`, `events.go`; `apps/kira-space/main.go`;
  `internal/terminal/session.go`; `internal/shell/registry.go`; generated bindings.
- Frontend: `frontend/src/bridge/index.ts`; `ade/activity.ts`, `useQueue.ts`, `state/adeUi.ts`,
  `AdeRepoTabs.vue`, `AdeView.vue`, `queries.ts`, `mutations.ts`, `dialogCompose.ts`,
  `dialogFlow.ts`, `launch.ts`, `wire.ts`, `tones.ts`, `AdePanelHeader.vue`;
  `packages/shared/protocol/events.ts`.
- Tests: `ade-dialog-parity.spec.ts`, `ade-dialog-rules.spec.ts`, `support/mockupToWire.ts` (only
  if §0.11 needs it), `tests/ui/ade-panel.spec.ts`, `tests/ui/support/ipcChannels.ts`,
  `tests/ui/support/mockRuntime.ts`.
- Docs: `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md` (result section only).

Not edited: `docs/v2.0/SPEC.md`'s Part 7 row (no split), `packages/workbench/*`
(`TabStrip.vue` is P137's), `apps/kira-studio/*`.

### 5.1 `docs/ARCHITECTURE.md`

- New paragraph after Part 6's: the `allAgents` flag and why it is not a sentinel id; the count and
  summary helpers and the P137 hand-off (§0.1); `allAgents.ts`'s join and sort; the per-repo
  `useQueries` plus `useQueue` data path and its cost; `ade.allAgentsFilter`; Open same-window and
  cross-window (`FocusSession`, `WindowOf`, `WindowRegistry.Focus`, `kira:ade:open-session` via
  `EmitTo`); Start from Older (`askWt`, `noSame` for archived or missing cwd).
- Update the Part 1 sessions paragraph (~2193): resume runs in the recorded cwd, recreated empty
  when gone (§0.12), and the PTY opens at `PrepareLaunch`'s returned `cwd`.
- Update the Part 4 paragraph: `startResumeLines` reads the session (§0.11); the resume delivery
  target is the record.
- Update the Part 6 paragraph (~2793): cross-window Open exists now; the panel's
  `Running in another window.` line stays for a session the user reaches without Open.
- §0.13: rewrite the stale `Parts 3-7` parentheticals, re-check the open-item list, and reword
  the Part 2 item.

---

## 6. Verification

| Command | Expected |
|---|---|
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean |
| `bun run lint:go` | Clean |
| `bun run build:space`, `bun run build:studio` | Clean |
| `go build ./...`, `go test ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/bridge/... ./apps/kira-space/internal/gitsession/...` | Pass, including §3.3 |
| `go test ./internal/terminal/... ./internal/shell/...` | Pass (touched packages) |
| `bun run test:unit` | Baseline (1817) plus §3.1 and §3.2 cases, all pass |
| `bun run test:ui:space` | Baseline (76) plus §3.4, all pass |
| `bun run test:ui:studio` | Baseline, unchanged. Any failure: `git diff --stat $P129P7_START` against the failing file, then fix it (CLAUDE.md) |

### 6.1 Live check

Server-mode Space (`go build -tags server`, isolated `KIRA_SPACE_HOME`, `WAILS_SERVER_PORT`,
direct DB rows and `git.gitPath` as `docs/DEV_ENVIRONMENT.md` describes, `curl` against
`/wails/runtime`). Two scratch repos under `/tmp`, each with a bare `origin` and a work clone.
Put Part 1's fake `claude` script first on the server process's `PATH`. It posts `SessionStart`
and chosen hook events to the hook shim, then stays alive until killed, so sessions read
`running` with a chosen activity.
1. Launch sessions through `PrepareLaunch` plus `TerminalService.Open` so one reads needs-input, one
   working, one waiting. `AgentSessions` lists them with their windows.
2. Stop one session and archive its branch (`Archive` over curl). Remove another stopped
   session's worktree directory.
3. `Sessions()` shows `cwdMissing: true` for the removed one only.
4. `PrepareLaunch` with `resume` set to the removed session's record id: the directory exists again,
   the result `cwd` equals the recorded cwd, and the command is `claude --resume <claude id>`.
5. `FocusSession` for a running session returns `true`; for a stopped one, `false`. The server log
   shows the `kira:ade:open-session` emit to the owning window key.
6. Load the served frontend in headless Playwright (§7.3) and walk Active, Older, Start and Open.
Record each outcome in the result section. Name any step the container cannot run.

---

## 7. Closing audit

### 7.1 Static checks

| Check | Command | Pass |
|---|---|---|
| Builder used | `rg -n "buildAllAgents\|activitySummary" apps/kira-space/frontend/src/ade` | `AdeAllAgentsView.vue`, `AdeRepoTabs.vue` |
| Pinned tab | `rg -n "ade-all-agents-tab" apps/kira-space/frontend/src/ade` | `AdeRepoTabs.vue` only |
| Filter persisted | `rg -n "allAgentsFilter" apps/kira-space/frontend/src/ade` | Read and `patchSettings` in `AdeAllAgentsView.vue` |
| Resume target fixed | `rg -n "claudeSessionId" apps/kira-space/frontend/src/ade/dialogFlow.ts` | Empty |
| Terminal cwd from Go | `rg -n "launch\.cwd" apps/kira-space/frontend/src/ade/launch.ts` | One match |
| Worktree choice wired | `rg -n "askWt: true" apps/kira-space/frontend/src/ade` | `AdeAllAgentsView.vue` |
| Cross-window wired | `rg -n "adeFocusSession\|kira:ade:open-session\|ChannelAdeOpenSession\|FocusWindow" apps packages internal` | Bridge, mutation, handler, Go emit, `main.go` assignment |
| Control members have callers | `rg -n 'AdeService\.' apps/kira-space/frontend/src/bridge/index.ts`, then one `rg` per new member | Every member has a caller in `ade/` |
| TanStack, not ad-hoc fetch | `rg -n "control\.ade" apps/kira-space/frontend/src/ade/*.vue` | Empty |
| Pure modules | `rg -n "from 'vue'\|Date.now\|new Date" apps/kira-space/frontend/src/ade/{useQueue,allAgents,activity}.ts` | Empty |
| SFC form | `rg --files-without-match '<script setup lang="ts">' apps/kira-space/frontend/src/ade/*.vue`; `rg -n '<style' apps/kira-space/frontend/src/ade` | First empty; second only `AdeNotesEditor.vue`'s disclosed exception |
| No hand-drawn icons | `rg -n '<svg\|<path d=' apps/kira-space/frontend/src/ade` | Empty |
| No Merge/ready/Jira sync/PR review states | `rg -n -i "'merge'\|ciFailing\|approved\|changes requested\|syncing" apps/kira-space/frontend/src/ade` | No action, state or text |
| No git-ui | `rg -n "@kira/git-ui\|packages/git-ui\|kira-ui" apps/kira-space/frontend/src/ade` | Empty |
| Stores one concern | Read `adeUi.ts`, `adeActions.ts`, `adeTerminals.ts`, `adeDrag.ts`, `agentSessions.ts` | One concern each |
| Studio unchanged | `git diff --stat $P129P7_START -- apps/kira-studio packages/workbench` | Empty |

### 7.2 Whole-phase acceptance: every design behaviour

Walk `docs/v2.0/design/SPEC.md` top to bottom, each numbered section and each bullet. For each,
name the implementing file and the test or live step that shows it (§2.0 icons, §2.1 tabs, §2.2
All agents, §2.3 repo view and panel, §2.4 archive, §3 git facts and refresh, §4 dialogs, §5
scheduling, §6 data model, §7 tokens, §8 libraries). Record it as a table in the result section.
A behaviour with no implementation, outside the standing user decisions, goes back to a fix commit
in this part. It never becomes a result-section note. Standing decisions and design §8 library
substitutions (`@tiptap/markdown` for `tiptap-markdown`, shadcn/reka, Tailwind) are listed with
their decision reference.

### 7.3 Screen-by-screen mockup comparison

A live run, not a mocked one. Headless Playwright (webkit is installed for `test:ui`) at
1440x900 opens both:
- The served server-mode Kira Space from §6.1, with fixtures shaped to cover every screen below.
- `docs/v2.0/design/mockup.html` from `file://`. If the cdnjs Vue or Google Fonts request is
  blocked, serve Vue from `node_modules/vue/dist/vue.global.prod.js` through `page.route`.
The script lives in the scratchpad and is never committed. Capture paired screenshots and read
them side by side:
1. Tab bar: pinned tab, repo tabs, counts, active border.
2. All agents Active: filter, aggregated line, groups, tinted row.
3. All agents Older: archived row, Start buttons.
4. All agents empty.
5. Repo view: project header, `main` line with Rebase all and Add.
6. Add popover: New work tab, Existing branch tab, empty picker.
7. Timeline: day bands, stacks, tags, info cells, action column, overflow, overdue, Later,
   continuation rows.
8. History pull and history bands, and the `inHistory` state.
9. Day context menu.
10. Detail panel: header and actions, review banner.
11. Details tab: link rows (link, input, edit states), estimate, notes.
12. Changes tab: dirty, conflict, shared.
13. Agents tab: running terminals, no-running state, Stopped list.
14. Claude dialog: rebase with push, queue, start draft, start existing, resume with worktree
    choice, archive with risk, busy with override, edited message.
15. Confirm dialog.
Verdict per screen: same elements, order, layout and states, differing only in theme tokens
(font family, chrome colours, radii from the theme). Any other difference is a defect, fixed in
its own `fix(space):` commit. Exceptions: P135's user-requested additions, and xterm content (a
real terminal against the mockup's static text). Record the per-screen verdicts in the result
section.

### 7.4 Design §9 re-audit, across all parts

For each rejected item, record the check and the verdict in the result section:
1. Git-graph lanes and long connector lines: no SVG in `ade/` (§7.1); screens 7-8.
2. Columns by named category: timeline is day bands only; screen 7.
3. Full-width bars: stack boxes sized to content; screen 7.
4. Separate merge-order strip: merge numbers inline only;
   `rg -n -i "merge order" apps/kira-space/frontend/src/ade/*.vue`.
5. Numeric priority next to merge numbers: screen 7.
6. On-screen legends: `rg -n -i "legend" apps/kira-space/frontend/src/ade` empty.
7. Sentence-length statuses: list `useQueue`'s status and tag labels; all short.
8. Markdown editor with Edit/Preview: `rg -n -i "preview" apps/kira-space/frontend/src/ade`
   has no editor mode.
9. Buttons inside boxes: `AdeStackRow.vue`/`AdeStackBlock.vue` have no `Button`; actions sit in the
   action column.
10. Loose activity icons next to colour squares: icons only in the agents pill, Agents tab and All
    agents rows.
11. Dialog repeating the operation as summary plus preview: one editable message; screen 14.
12. Auto-generated branch names: `suggestedBranch` is display-only, never persisted
    (`rg -n "suggestedBranch" apps/kira-space/frontend/src/ade`).
13. Agents pushing by default: dialog `push` starts `false`.
14. Invented steps in agent messages: dialog parity specs pass against mockup templates.
15. Always rebasing onto main: rebase and queue target the parent; `ade-dialog-rules` covers it.
16. Global page/top bar: nothing above the repo tab bar in `ade`; per-project header stays.
17. Jira/PR tabs: panel tabs are Details, Changes, Agents only.
18. Per-agent names: labels are `claude <id>` only;
    `rg -n "Agent [0-9]" apps/kira-space/frontend/src/ade` empty.
19. Typing branch names by hand: Add, Existing branch is a picker. The draft Start dialog's optional
    branch-name field is mockup markup (`bn`) for a branch Claude creates; record that verdict
    explicitly.
20. Extra details on queue rows: title, branch, activity icons, Start only, plus P135's
    user-requested Jira line and blocker chip; record both as user-directed.
21. Fixed-width panel: resizable, `ade.panelWidth`.
22. Separate `Not merging` row: none; parked renders inline.
23. Fixed 4-day ruler: horizon from `ade.horizonDays`.
24. Small refresh icon hidden in the main line: Refresh sits in the project header only.
25. Global refresh in the tab bar: `AdeRepoTabs.vue` has no refresh, pinned tab included.
26. History always visible above today: `historyOpen` defaults to `false`.
27. Preset estimate chips: `AdeEstimateField.vue` has none.
28. Status after the title in link rows: `AdeLinkRow.vue` order.
29. Animated activity icons: `rg -n "animate-" apps/kira-space/frontend/src/ade` shows no activity
    glyph animation.
30. Card-style link blocks: link rows are flat.
31. Listing every session ever on All agents by default: Active is the default; §3.4 #3.

### 7.5 `docs/ARCHITECTURE.md` open items

§0.13, done in step 7. Confirm with
`rg -n "Parts 3-7|lands in P129|Part 3\+'s own call" docs/ARCHITECTURE.md` returning empty.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| `useQueue` per repo slows the All agents view | Only repos with sessions; `computed` recomputes only on real input change; measure in §6.1 only if it feels slow |
| `RepoPrs` (`gh`) runs for repos never opened this session | Once per repo (`staleTime: Infinity`); a failed fetch leaves titles on branch names, the same fallback `useQueue` already has |
| Recreating a deleted worktree directory surprises the user | Only on an explicit Start from Older, only the exact recorded path, empty; the message tells Claude to create a new worktree; ARCHITECTURE states it |
| Terminal `WindowKey` differs from the `WindowRegistry`/`EmitTo` key | §0.9 confirm step; map in `main.go` if needed |
| Wails window calls off the main thread | §0.9 confirm step; `InvokeSync` if required |
| Owner window closes between `FocusSession` and the emit | `EmitTo` to a gone key is a no-op; the renderer falls back only on `false`, so worst case nothing happens, and the session reads `stopped` on the next refresh |
| Mockup cannot load its CDN Vue in the sandbox | `page.route` to the local Vue build (§7.3) |
| Relaxed `Validate` lets a malformed resume through | The record governs every field; `Prepare` still checks existence, repo and state |
| Real CLI resume in a recreated directory unverified | Disclosed (§0.12); the fallback does not depend on cross-directory CLI behaviour |
| `lint:dead` on staged exports | Each export lands with its consumer (§4) |

---

## 9. Acceptance, mapped to the SPEC row

| SPEC row item | Where |
|---|---|
| §2.1 pinned `All agents` tab | §0.1, §0.3, §2.4, §3.4 #1-#2, §7.3 screen 1 |
| Total needs-input count on the pinned tab | §0.4, §3.1, §3.4 #1 |
| §2.2 Active/Older filter (Active default, persisted) | §0.7, §3.4 #3, #6 |
| Aggregated activity line | §0.4, §3.1, §3.4 #3 |
| Rows grouped by repo, sorted by urgency | §0.6, §3.1, §3.4 #4 |
| Row layout (bar, icon, label, last active, Open/Start, `claude <id>`, title over `branch worktree`) | §2.4, §3.4 #5, §7.3 screens 2-3 |
| Needs-input tint | §2.4, §3.4 #4 |
| Content max-width ~1040px | §2.4, §7.3 screen 2 |
| Open to the repo/branch/session | §0.8, §3.4 #10 |
| Start/Resume from Older with the worktree choice | §0.10, §0.11, §3.4 #7-#8 |
| Archived sessions under Older (`stopped · archived`, `new worktree` only) | §0.6, §0.10, §3.4 #7 |
| Resume fallback when the worktree is gone | §0.12, §3.3, §3.4 #9, §6.1 steps 2-4 |
| Resume delivery actually works (found bug) | §0.2, §3.4 #8, `ade-panel.spec.ts` |
| Cross-window Open | §0.9, §3.4 #11, §6.1 step 5 |
| Original row: every design behaviour implemented | §7.2 |
| Original row: live run compared against `mockup.html` screen by screen, only theme tokens differ | §6.1, §7.3 |
| Design §9 re-audited across all parts | §7.4 |
| `docs/ARCHITECTURE.md`'s P129 open item removed | §0.13, §5.1, §7.5 |
| Kira Studio unchanged | §7.1 |
