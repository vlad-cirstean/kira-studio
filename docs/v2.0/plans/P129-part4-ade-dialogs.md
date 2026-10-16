# P129 Part 4 — Claude Code dialog, archive-at-risk dialog, Rebase all

Plan for `docs/v2.0/SPEC.md`'s `P129 Part 4` row. Planned against `v1.9` at `7f55daf8` (P129 Part 3
result landed).

Binding inputs: Part 1 plan §0 and §2 (`docs/v2.0/plans/P129-part1-ade-agent-runtime.md`), Part 2
plan (`…/P129-part2-ade-queue-backend.md`), Part 3 plan (`…/P129-part3-ade-data-layer.md`, esp. §0.8,
§0.9, §0.10, §0.17), all three result sections in `docs/v2.0/SPEC.md`, design
`docs/v2.0/design/SPEC.md` §2.3 (`main` line), §2.4 (archive safety), §3 (rebase targets, push
rule), §4 (dialog, templates), §9, and `mockup.html`'s dialog code: `openDialog`/`sendDialog`
(lines 748-782), openers (1063-1092, 1131-1140, 1153-1162, 1386-1397, 1640-1642, 887), dialog view
model and templates (1655-1753), `main` line (1755-1778) and dialog markup (472-543). Part 1 §2.1:
design wins over mockup, except `sendDialog()` templates, where the mockup is the byte-exact source.

Every path, symbol and count below was measured in this container at `7f55daf8`:
`codegraph_explore` for symbols, call graphs and blast radius (`AdeService` and its wire types,
`Tracker.Prepare`, `Queue.Snapshot`/`snapshotLocked`/`MainRef`/`DefaultRemote`, `ArchiveRisk`/
`Archive`, `useQueue` internals and `QueueAction`, `createAgentSessionsStore`/`reduceAgentActivity`,
`createTerminalsStore.openTerminalSession`, `useTerminalMount`, `installAdeSignals`, Space
`bridge/index.ts`, `installControlMocks`, `mockupOracle`/`mockupToWire`, `WorktreeDialog`), then
`Read` for exact lines (the mockup, `ipcChannels.ts`, theme `checkbox`/`radio-group`).

---

## 0. What the SPEC row left open, and resolutions

Standing user decisions, not reopened: no Merge template or action anywhere (Part 1 §0); no
`ready`/`ciFailing`; no Jira-title fallback; Claude icon is the generic `robot` codicon; resume
fallback for a gone worktree is Part 7's.

1. **Two layers: a pure composer and thin Vue.** `src/ade/dialogCompose.ts` is pure (no Vue, no
   clock): openers build a `DialogSpec`; `composeDialog(input)` returns the full `DialogView`
   (title, message, busy rows, `blocked`, `busyShown`, `overridden`, `busyTitle`, `overrideLabel`,
   `sendLabel`, `targets`, `askWt`, `wtOptions`, `isDraft`, `canPush`, `isArchive`, `riskText`,
   `edited`). Mirrors mockup lines 1655-1753 field for field, minus style strings. The component
   wraps it in `computed()`. Keeps parity a plain `bun test`, same as Part 3 §0.1.
2. **Parity oracle is the mockup, run unmodified.** Part 3's `node:vm` oracle gains a dialog mode:
   run a mockup opener, capture `comp.state.dialog` and `renderVals().dialog`, compare against our
   opener plus `composeDialog` on the converted data (§3.1). Every template line compares
   byte-for-byte, `message` included.
3. **Templates run on real data, with the mockup's constants as parameters.** Mockup literals map
   to real facts; with the mockup's own values, output is byte-identical:

   | Mockup literal | Real source |
   |---|---|
   | `origin` in `git fetch origin` | `snapshot.remote` (new, §0.5) |
   | `origin/main` (rebase onto main, draft base) | `snapshot.main.ref` (short, §0.5) |
   | `main` in `onto main`, `not merged into main` | `snapshot.main.name` (short, §0.5) |
   | `origin/<review>` | `<remote>/<branch>` |
   | `~/wt/<repo>/<last segment>` (`wtOf`) | `AdeBranch.worktree` when set, else `<worktreeDir>/<last segment>` |
   | `~/wt/<repo>/` (draft) | `<worktreeDir>/` |
   | `claude <id>` | `'claude ' + claudeSessionId.slice(0, 8)` (UUID first group; mockup ids are 4 hex, unchanged by the slice) |
   | `dayLong(k)` | `dayLong(iso, today)` exported from `useQueue.ts` |

   `worktreeDir` = `snapshot.worktreeBasePath` trimmed of trailing `/`, else the repo root
   (`codeRepoRecord(id).root`): the git module's own default resolves a relative path against the
   repo root (`WorktreeDialog` line 116). Last segment, not full branch name: mockup `wtOf` is the
   template source.
   **"Branch name" in every template is `AdeBranch.branch`** (git name), never `AdeBranch.name`
   (Part 3 §0.4: user title override). Titles come from `QueueItem.title`.
   No remote (`snapshot.remote === ''`): drop `git fetch <remote> && ` and `git fetch <remote>,
   then `, capitalize what follows (`- Create branch …`, `- Create a new branch …`), review onto-ref
   is the bare branch. Bare Jira key without URL: `- Jira: KEY` (no trailing space). Each pinned by
   a rule test (§3.2), since the mockup can't reach them.
4. **Titles follow the mockup's openers**, not design §4's shorter list: `Rebase onto main`,
   `Rebase onto <branch>`, `Queue after <branch>`, `Rebase all onto main`, `Move work`,
   `Start Claude Code`, `Resume Claude Code`, `Start new work`, `Archive: work would be lost`.
   Part 1 §2.1 makes the mockup authoritative for dialog output; design's list is a summary of
   the same set (`Rebase` covers the three rebase titles).
5. **Go fix: `main` name/ref are full refnames today.** `snapshotLocked` (queue.go:532) sets
   `Main{Name: mainRefName, Ref: mainRefName}` from `MainRef`, which returns `RefRow.Refname`
   (`refs/remotes/origin/main`). So Part 3's `main` line shows the full refname, and templates
   need short forms. Fix in `ade`: a pure `mainDisplay(full)` maps `refs/heads/X` to name `X`,
   ref `X`; `refs/remotes/<r>/X` to name `X`, ref `<r>/X`. `Tip` unchanged. `countRefsChanged`
   (line 1418) keeps keying on the full refname (untouched). Also add `RepoSnapshot.Remote` from
   `snapshotContext.remote` (already computed, line 477) and wire it as `AdeRepoSnapshot.remote`.
   A Go test covers `mainDisplay` (both ref shapes, nested `a/b` branch) in `queue_test.go`,
   extending Part 2's existing suite. Bindings regenerate (model fields only; method count stays
   19).
6. **Method assignment (Part 3 §0.10, "the member moves with its first consumer").**
   - Part 4 keeps `PrepareLaunch`, `Send`, `ArchiveRisk`, `Archive`, `SetQueuedAfter`.
   - **`UpdateNewWork` moves into Part 4.** First consumer: Start new work stores the optional
     branch name (Part 2 §0.10, `branch_name` "Part 4's optional name") before launch.
   - **`ForcePush` moves to Part 5.** The dialog's force-push switch only changes message text:
     Claude pushes (design §3, §4; mockup `sendDialog` never calls `forcePush`). Part 4 has no
     caller. A mutation with no caller is unused scaffolding (CLAUDE.md) and fails `lint:dead`.
     First consumer: Part 5's action-column `Force push` (Part 3's `QueueAction` kind
     `forcePush`), which also supplies `QueueInput.pushing`. Recorded in the Part 5 SPEC row
     (step 8).
   - `SetPlan` stays Part 5: the Move opener carries an `afterSend` callback (§0.12) that Part 5's
     drop handler supplies.
   - Part 4 supplies `QueueInput.rebasing` (Part 3 §0.8).
7. **Openers.** One opener per mockup opener, all pure in `dialogCompose.ts`:
   - `rebaseSpec(ctx, roots, onto, title)`: mockup `rebaseDialog`. Kind `queue` when `onto` is a
     review item, else `rebase`. `ids` = each root's `stackIds` (root plus `mine`, non-draft
     descendants, depth-first in `kids` order). `targets = agentTargets(roots)`.
   - `specForQueueAction(ctx, action)`: Part 3's `QueueAction` (`rebase`, `queueAfter`) to
     `rebaseSpec` with the mockup's title rule. Part 5 calls it from the action column.
   - `rebaseAllSpec(ctx)`: `rebaseSpec(behindRoots, 'main', 'Rebase all onto main')`.
   - `startSpec(ctx, item)`: draft gets `{draft, base, title: 'Start new work'}`; else
     `{title: 'Start Claude Code'}`.
   - `resumeSpec(ctx, item, session, {askWt?, wt?, noSame?, title?})`: Stopped-list Resume
     (`Resume Claude Code`) and All agents Start (`askWt`, `wt`, `noSame`, `Start Claude Code`).
   - `moveSpec(ctx, ids, before, day, afterSend)`: `{kind: 'move', targets: agentTargets([lead])}`.
     The "parked-only moves apply directly" and "never before its parent" rules are Part 5's drop
     logic, not the opener's.
   - `archiveSpec(ctx, item, risk)`: `{kind: 'archive', targets: agentTargets([item])}`.
   `ctx` = `{view (QueueView), snapshot, sessions, remote/main facts, worktreeDir, repoName}`.
   `agentTargets` = `{item, choice: firstRunningSession?.id ?? 'new'}` (session record id, for
   `Send`).
8. **Rebase all is Part 4's only in-part UI opener.** Row: "Wired from the `main` line's Rebase
   all". Every other opener's first UI caller belongs to a later row: action column and drag/drop
   (Part 5), header actions and Agents tab `+`/Stopped Resume (Part 6), All agents (Part 7). The
   openers are complete, parity-tested and exported; later parts wire buttons only. Not stubs:
   no disabled button, no placeholder.
   Consequence: archive and Start dialogs are first UI-reachable in Part 5. Part 4 covers them
   with the unit flow spec (§3.3); Part 5's row gains a `test:ui:space` line for them end to end
   (step 8).
9. **`useQueue` exports.** `QueueView` gains `parentOf: Record<string, string>` and
   `kids: Record<string, string[]>` (from the existing `buildParentOf`/`buildKids`, insertion
   order kept, which matches the mockup). `dayLong(iso, today)` is exported (mockup line 946:
   `Today, ` prefix at offset 0, `Later` for `null`). No behavior change; Part 3 parity stays
   green.
   **Fix: the `after` rebase action loses its target.** `useQueue` builds the `g.after` block
   action with `targetIds: [g.root]` (line 1009-1016), same as rebase-onto-main, so a caller can't
   tell `onto`. Part 4 sets `targetIds: [g.root, g.after.id]`, matching `queueAfter`'s
   `[root, with]` shape. Part 3's parity projection updates to match.
10. **Busy check** (design §4): only `rebase`/`queue`; over `spec.ids`; each running session on
    those items whose `activityKind` is `working` or `waiting` yields `{branch, sid, kind}`. Row
    text `<branch> · claude <sid> · <label>` with `ACTIVITY_LABEL` (moved from
    `AdeActivityIcon.vue` into `activity.ts`, exported). Live: `composeDialog` runs in a
    `computed` over the sessions query and the agent store's `activity` map, so Stop/
    UserPromptSubmit re-evaluate with no extra wiring. Override is per open: `openDialog` resets
    `msg`, `push`, `override`, `branchName` (mockup `openDialog` plus `startDialog`'s
    `dialogBranch: ''`). Send is disabled while `blocked`. `sendLabel` becomes `Send anyway`,
    danger variant, while overridden.
11. **Targets.** `options` recompute live: running sessions, else only `new session` (mockup
    line 1741). A stored `choice` not among the current options resolves to the first option.
    Draft Start has no targets (always a new session).
12. **Send, per kind** (`src/ade/dialogFlow.ts`, deps injected, unit-tested):
    - Message: `msg ?? template`. Blank (trimmed) disables Send.
    - `rebase`/`queue`: add `roots` to `rebasing` (repo-scoped, `adeActions`). For each root
      sequentially: deliver that root's message (§0.13) to its target (§0.14). On success, if
      `onto !== 'main'`, call `SetQueuedAfter({item: root, after: onto})`. This matches mockup
      `sendDialog`, which records `queuedAfter` for every non-main `onto`. Called on send, not on
      Stop: it is the user's intent (Part 2: "intent until Claude rebases"). It survives reload,
      and the `rebasing` rung covers the gap. Watch the turn (§0.15). On done or cancel, drop the
      root from `rebasing`. On a delivery failure, stop: drop the failed and remaining roots from
      `rebasing`, keep the dialog open with an error Alert. Already-sent roots leave the open
      spec, so a retry resends only the rest.
    - `start` draft: if `branchName.trim()`, `UpdateNewWork({patch: {branchName}})` first. Then
      launch with `newWorkId`, cwd = repo root.
    - `start` existing: target running session gets `Send`; `new` launches with `branch`, cwd =
      `AdeBranch.worktree` or repo root.
    - `start` resume: launch with `resume` = the session's Claude id, cwd = the recorded
      `session.cwd`. `Tracker.Prepare` uses the recorded cwd anyway (tracker.go:184-237). A
      missing worktree fails there with `E_INVALID`; the fallback is Part 7's. The `wt` choice
      only changes the template in Part 4.
    - `move`: deliver to the target, then `spec.afterSend?.()` (Part 5 passes its `SetPlan`).
      Mockup order: plan write, then message; both happen before close.
    - `archive`: §0.16.
    Every call goes through TanStack `useMutation` (§2.4). The dialog closes when all deliveries
    succeed.
13. **Multi-root delivery (Rebase all).** The mockup sends nothing real: it has one message for
    N roots, and its targets are per root. Real delivery needs one prompt per target agent.
    Rule:
    - Unedited: target *i* gets `composeRebaseMessage(spec, [root_i])`. That is the mockup's own
      output for a single-root dialog over that root, so every delivered text stays a mockup
      template.
    - Edited: target *i* gets the edited text with every *other* root's block removed, but only
      where that block still appears verbatim, together with its separating blank line. Blocks
      are the per-root line groups the template emitted. Edited-away blocks can't be located, so
      the text goes as-is. Rule test in §3.2.
    - Single root: the message goes unchanged.
    This is the one interpretation most worth a user look (§8).
14. **Delivery to a target** (`src/ade/launch.ts`):
    - Running session: `Send({sessionId: session.id, message})`. Go does the bracketed paste plus
      `\r` (Part 1 §4.5).
    - `new`: `PrepareLaunch({codeRepoId, branch | newWorkId, cwd, resume?, message})` returns
      `{terminalId, sessionId, command}`. Then `terminalsStore.openTerminalSession(terminalId,
      codeRepoId, cwd, 80, 24, command, 'claude-code')`, then check the entry's status: `failed`
      throws its `error`. The PTY runs with output buffered (256 KiB drain) until a
      `TerminalHostView` mounts on that `tabId`. `useTerminalMount` skips opening when a session
      exists (Part 1 §4.2), so Part 6's Agents tab reattaches. 80×24 is the pre-mount size; the
      host view resizes on mount.
    - Part 1's risk row: "the first real-TUI check (Part 4) adds a short delay in `Send` if
      needed". The §6.1 live check decides. If the paste lands before `\r` is read, Go gets a
      bounded delay between paste and `\r`, with its reason in the commit.
15. **Completion detection** (`src/ade/turnWatch.ts`, pure, unit-tested).
    `createTurnWatcher()` exposes `watch(terminalId, {requireSubmit}) → {done: Promise<'stop' |
    'ended'>, cancel()}`, `onEvent(AgentEvent)`, `onLive(terminalIds)`.
    - Send to a running session: arm **before** calling `Send`, `requireSubmit: true`. A `Stop`
      before this prompt's `UserPromptSubmit` belongs to the turn already running and is ignored.
      Resolve on the first `Stop` after a `UserPromptSubmit`.
    - Launch: arm before `openTerminalSession`, `requireSubmit: false`. The first `Stop` ends the
      first turn, which is the prompt passed at launch.
    - End (resolve `'ended'`): `SessionEnd` for that terminal. Or `onLive` without that terminal,
      counted only after it was seen live once, so a launch not yet listed is not ended.
    - `cancel()` detaches with no resolution. Used by a failed delivery.
    - Singleton `adeTurns` in `turnWatch.ts`. `installAdeSignals` feeds `onEvent` from its
      existing `onAgentEvent` subscription, so `main.ts` is unchanged. The `adeActions` store
      feeds `onLive` from `watch(agentStore.sessions)`.
    Both known hook facts (Part 1 §4.8): `UserPromptSubmit` starts every user turn; `Stop` ends
    it, even when a wake tool leaves the session `waiting`.
16. **Archive flow** (design §2.4, Part 2 §6.3), `requestArchive(codeRepoId, item)`:
    1. `queryClient.fetchQuery({queryKey: ['ade','archiveRisk',repo,item], staleTime: 0})` over
       `ArchiveRisk`.
    2. `blocked` → `actionError` "Can't archive: <reason>"; reason from a short kind→text map in
       `dialogFlow.ts`, raw kind as fallback.
    3. Nothing at risk (`dirty` empty and `unmerged === 0`) → `Archive({discard: false})`
       directly, no dialog (mockup `requestArchive`).
    4. Else open the archive dialog. Risk data comes from `ArchiveRisk`: `dirty[].path`,
       `unmerged`, `worktree`. Template `- Worktree:` uses `risk.worktree`, else `wtOf`.
    - **Just delete**: `Archive({discard: true})`, close.
    - **Send to Claude, then archive**: deliver (§0.14), close, record a pending archive in
      `adeActions`, watch the turn. On `'stop'`: `Archive({discard: false})`. If that fails with
      `E_INVALID` `atRisk` (Claude left changes), refetch risk and reopen the dialog with fresh
      risk and the same target choice. Any other failure goes to `actionError`. On `'ended'`
      (session ended before Stop): `actionError` "Claude's session ended before archiving; archive
      again when ready", with nothing archived.
    - No queue status marks a pending archive (design names none).
    - **Renderer-held.** A window reload or close before Stop drops the pending archive. This is
      a real limitation, recorded in ARCHITECTURE Known open items (§5.1). A durable
      Go-side pending action is a design decision beyond this row.
17. **Errors.** In-dialog failures (Send, launch, UpdateNewWork, Just delete) show a destructive
    `Alert` inside the dialog; the dialog stays open. Background failures (after close: archive
    after Stop, blocked, ended) go to `adeActions.actionError[repo]`. `AdeRepoView` renders them
    as a dismissible destructive `Alert` under the `main` line. Space has no toast system;
    adding one is out of scope.
18. **Force-push switch** (design §4): shadcn `Switch`, default off, `rebase`/`queue` only. Label
    `Also force-push after rebasing (off: stays local, push it yourself later)` (mockup markup).
    It changes only `pushLine`. `packages/theme` has no `switch`. Add it the shadcn-vue way: new
    `packages/theme/src/components/ui/switch/{Switch.vue,index.ts}`, following the `checkbox`/
    `radio-group` reka-nova rewrite (`@theme/lib/utils`, `focus-visible:border-focus`, no ring,
    theme tokens). Part 1 §2.2 names exactly this.
19. **Branch name** (Start new work only): shadcn `Input`, empty, placeholder `optional, Claude
    picks one if empty`. Regenerates the message only while unedited: `composeDialog` reads
    `branchName` only when `msg === null`, same as the mockup.
20. **Rebase all visibility.** Mockup: `mainCanRebase = behindRoots.length > 0 && !busy`, with
    `busy = rebasing.length > 0`. Ours: shown iff `view.behindRoots.length > 0` and the repo's
    `rebasing` set is empty. Amber literal `bg-[#e8a33d] text-[#15161a]` (mockup line 108), same
    tint precedent as `AdeMainLine`'s note.

---

## 1. Confirmed current state

- `AdeService`: 19 bound methods. Space `bridge/index.ts` exposes 6 (`AgentSessions`, `Sessions`,
  `RepoSnapshot`, `RepoPrs`, `Refresh`, `ProvideCredential`). Wire args exist for Part 4's
  methods: `AdePrepareLaunchArgs`/`Result`, `AdeSendArgs`, `AdeItemArgs`, `AdeArchiveArgs
  {discard}`, `AdeArchiveRiskResult {dirty: [{code,path}], unmerged, worktree, blocked?}`,
  `AdeSetQueuedAfterArgs {item, after}`, `AdeUpdateNewWorkArgs {id, patch.branchName}`.
- `wire.ts` has no launch/archive types. `AdeMain {name, ref, tip}`; no `remote`.
- `queue.go:532`: `Main{Name: mainRefName, Ref: mainRefName}`, full refname. The only renderer
  consumer is `AdeRepoView.vue:84` (`main?.name`).
- `useQueue.ts`: `QueueAction` kinds `queueAfter` (`[root, with]`), `forcePush`, `rebase`
  (`[g.root]` for both main-behind and `after`). `QueueView.behindRoots` exists.
  `buildParentOf`/`buildKids` internal; no `dayLong`. `rebasing`/`pushing` optional inputs.
- `adeUi` store: `activeRepoId`, `refreshNote`; comment reserves dialog state for Part 4.
- `AdeMainLine.vue`: name + note; comment reserves the Rebase all slot.
- `installAdeSignals(queryClient)`: `onAdeSessions`, `onAdeRepo`, `onAgentEvent` (Stop
  invalidates snapshot), credential handler; called once from `main.ts`.
- Agent store (`createAgentSessionsStore`): `sessions`, `activity` (keyed by terminalId),
  `SessionEnd` deletes the entry, `applySessions` prunes dead ids.
- `openTerminalSession(tabId, codeRepoId, cwd, cols, rows, command, launchKind)` swallows errors
  into `status: 'failed'`.
- `packages/theme/src/components/ui`: no `switch`. `alert`, `button` (`dialog`, `dialog-primary`,
  `dialog-danger`), `dialog`, `input`, `textarea`, `toggle-group` present.
- Tests: `tests/unit/support/mockupOracle.ts` (`runMockup`, `loadNeutralizedComponent`, TZ=UTC),
  `mockupToWire.ts` (`claudeSessionId: raw.id`, `worktree: ''`, `worktreeBasePath: ''`,
  `main: {name:'main', ref:'refs/heads/main'}`). No Vue component-test infra. UI mocks route
  `AdeService.*` via `ipcChannels.ts`/`mockRuntime.ts`; `terminalOpen` already mapped.
- Baselines (Part 3 result): `test:unit` 1685, `test:ui:space` 45, `test:ui:studio` 300.
  Re-measure at `P129P4_START`.

---

## 2. Design

### 2.1 Module shape (`apps/kira-space/frontend/src/ade/`)

| File | Role |
|---|---|
| `dialogCompose.ts` (new, pure) | `DialogSpec`, `DialogState`, openers (§0.7), `composeDialog`, `composeRebaseMessage`, `messageForRoot` (§0.13), `wtOf` |
| `turnWatch.ts` (new, pure + singleton) | §0.15 |
| `dialogFlow.ts` (new, deps injected) | `sendDialog(deps, …)`, `requestArchive(deps, …)`, `onArchiveTurn` (§0.12, §0.16) |
| `launch.ts` (new) | `deliver(target, …)`: Send or PrepareLaunch + `openTerminalSession` (§0.14) |
| `mutations.ts` (new) | TanStack mutations and the risk fetch (§2.4) |
| `state/adeActions.ts` (new store) | In-flight agent actions: `rebasing`, pending archives, `actionError` |
| `state/adeUi.ts` (edit) | Dialog state |
| `AdeClaudeDialog.vue` (new) | The one dialog (all kinds, archive section included, as the mockup) |
| `AdeMainLine.vue`, `AdeRepoView.vue`, `activity.ts`, `AdeActivityIcon.vue`, `useQueue.ts`, `queries.ts`, `wire.ts` (edit) | §2.5-§2.7 |

`adeActions` is its own store: one concern, in-flight agent actions. It is not UI dialog state
(`adeUi`), per CLAUDE.md "one Pinia store, one concern".

### 2.2 Go (`apps/kira-space/internal/`)

- `ade/queue.go`: `mainDisplay(full string) (name, ref string)`; `snapshotLocked` builds `Main`
  with it; `RepoSnapshot.Remote string` from `sc.remote`.
- `bridge/ade.go`: `AdeRepoSnapshot.Remote string \`json:"remote"\``, set in `toWireAdeSnapshot`.
- `ade/queue_test.go`: `TestMainDisplay` (local, remote, nested). Extends an existing snapshot
  test's assertion to `Main.Name == "main"`, `Main.Ref == "origin/main"` if one asserts `Main`.
- Regenerate bindings (`wails3 generate bindings`, `docs/DEV_ENVIRONMENT.md`). FQN gate: only
  `AdeRepoSnapshot` model changes.

### 2.3 Bridge and wire

- `wire.ts`: `AdeRepoSnapshot.remote: string`; `AdePrepareLaunchArgs`, `AdeLaunch {terminalId,
  sessionId, command}`, `AdeArchiveRisk {dirty: AdeDirty[], unmerged, worktree, blocked?}`.
- `bridge/index.ts` control members (6 new, each with its consumer in the same commit):
  `adePrepareLaunch`, `adeSend`, `adeArchiveRisk`, `adeArchive`, `adeSetQueuedAfter`,
  `adeUpdateNewWork`. `normalizeAdeRepoSnapshot` defaults `remote` to `''`. Normalize
  `AdeArchiveRisk.dirty` null to `[]`.

### 2.4 TanStack layer (`mutations.ts`)

- `adeArchiveRiskKey(repo, item)` = `['ade','archiveRisk',repo,item]`; `fetchArchiveRisk(qc, …)`
  via `qc.fetchQuery({staleTime: 0})`. Always fresh; the key lets Part 6's header read the same
  cache.
- `useAdeSend`, `useAdeLaunch` (PrepareLaunch + open, §0.14), `useAdeArchive`,
  `useAdeSetQueuedAfter`, `useAdeUpdateNewWork`: `useMutation(() => ({mutationKey, mutationFn,
  onSettled}))`, Part 3's `useAdeRefresh` shape. `onSettled` invalidates `['ade','snapshot',repo]`
  (archive, queuedAfter, newWork) or `['ade','sessions']` (launch). The flow module receives
  `mutateAsync` functions as deps, so it stays testable without Vue.
- Dialog Send button reads the mutations' `isPending` (via `useIsMutating` on a shared
  `['ade','deliver',repo]` key prefix) for its pending state.

### 2.5 Stores

`adeUi` gains:

```ts
dialog: { spec: DialogSpec; msg: string | null; push: boolean; override: boolean;
          branchName: string; error: string | null } | null
openDialog(spec)   // resets msg/push/override/branchName/error (§0.10)
closeDialog(); setMsg(v | null); togglePush(); toggleOverride(); setBranchName(v)
pickTarget(index, choice); pickWorktree(wt); dropRoots(sent: string[]); setError(e)
```

`adeActions` (`defineStore('adeActions')`):
- `rebasing: Map<repo, Set<root>>`, `rebasingFor(repo)`
- `pendingArchive: Map<repo:item, terminalId>`
- `actionError: Map<repo, string>`, `dismissError(repo)`
- `sendDialog()`, `requestArchive(repo, item)`, `justDelete()`: thin wrappers binding
  `dialogFlow.ts` to real deps (mutations, `adeTurns`, `adeUi`, terminals store)
- A `watch` on the agent store's `sessions` feeds `adeTurns.onLive`.

### 2.6 `useQueue.ts`, `activity.ts`

- `QueueView.parentOf`, `QueueView.kids` (§0.9); `export function dayLong`.
- `after` rebase action `targetIds: [g.root, g.after.id]` (§0.9).
- `activity.ts`: `export const ACTIVITY_LABEL: Record<ActivityKind, string>` (`needs input`,
  `working`, `waiting on monitor`, `idle`, `stopped`); `export function sessionLabel(s)`.
  `AdeActivityIcon.vue` imports the map.

### 2.7 Components (`<script setup lang="ts">`, Tailwind only, no `<style>`)

`AdeClaudeDialog.vue`: shadcn `Dialog`/`DialogContent :show-close-button="false"`/
`DialogHeader`/`DialogTitle`/`DialogFooter`, `GitCredentialDialog.vue`'s pattern. Reads
`adeUi.dialog`. `view = computed(() => composeDialog({...}))` over the snapshot, PRs and sessions
queries plus agent store activity. Top to bottom, mockup markup order (472-543):
- Title row: `robot` codicon in `text-[#d97757]` (Claude accent literal), title.
- Busy `Alert variant="destructive"` when `busyShown`: `busyTitle`, one row per busy session
  (`AdeActivityIcon` + text), `Button variant="dialog-danger"` with `overrideLabel`.
- Archive `Alert` when `isArchive`: `riskText`.
- Branch name `Input` when `isDraft`.
- Per target: title, branch (`font-data`), `ToggleGroup type="single"` of option chips.
- Worktree `ToggleGroup` when `askWt`.
- `Switch` + label when `canPush`.
- Message `Textarea` (`font-data`, rows ~10), `Reset` link (`Button variant="link"`) when
  `edited`.
- In-dialog error `Alert` when `dialog.error`.
- Footer:
  - `Just delete` (`dialog-danger`, archive only). Tooltip text: `Skip Claude: delete the
    worktree now; uncommitted changes are lost`.
  - `Cancel` (`dialog`).
  - Send (`dialog-primary`, or `dialog-danger` when overridden), `disabled` when `blocked`, the
    message is blank, or a delivery is pending.
Test ids: `ade-dialog`, `ade-dialog-busy`, `ade-dialog-override`, `ade-dialog-message`,
`ade-dialog-reset`, `ade-dialog-push`, `ade-dialog-send`, `ade-dialog-target-<i>`,
`ade-dialog-just-delete`, `ade-dialog-error`.

`AdeMainLine.vue`: new prop `canRebaseAll: boolean`, emit `rebaseAll`. The button renders after
the note in the pill, `data-testid="ade-rebase-all"`.

`AdeRepoView.vue`: passes `rebasing: adeActions.rebasingFor(repo)` into `useQueue`; wires
`@rebase-all` to `adeUi.openDialog(rebaseAllSpec(ctx))`; mounts `AdeClaudeDialog` once; renders
the `actionError` Alert (`data-testid="ade-action-error"`). `ctx` is built by one
`useDialogContext(repoId)` helper in `AdeRepoView` scope, also used by the dialog.

---

## 3. Tests (per CLAUDE.md's bar)

The composer is a byte-exact port with ~15 interacting template rules. The flow is ordering,
cancellation and partial failure. Both qualify. Nothing else gets a dedicated test.

### 3.1 `apps/kira-space/tests/unit/ade-dialog-parity.spec.ts`

Oracle addition, `mockupOracle.ts`: `runMockupDialog({repo, statePatch?, open})`. `open(comp,
V)` invokes one mockup opener. Returns `{spec: comp.state.dialog, view: renderVals().dialog}`.
Neutralization is Part 3's `repoData` wrap, unchanged.

Converter addition, `mockupToWire.ts`: `toDialogContext(result, repo)` sets:
- `AdeBranch.worktree = '~/wt/<repo>/<last seg>'`, `worktreeBasePath = '~/wt/<repo>'`
- `remote = 'origin'`, `main = {name: 'main', ref: 'origin/main'}`
- archive risk from the mockup's `atRisk` inputs (`dirty[].path`, `unmerged`, `worktree`)
It builds wire data from raw mockup data only (Part 3 §8 rule), never from `renderVals()`.

Projection per scenario, all byte-exact:
- `title`, `message`, `edited`, `blocked`, `busyShown`, `overridden`, `busyTitle`,
  `overrideLabel`
- `busy[].text`, `sendLabel`, `isDraft`, `canPush`, `pushOn`, `isArchive`, `riskText`
- `targets[].{title, branch, options[].label, options[].on}` (`on` from `chipStyle`'s border
  hex)
- `askWt`, `wtOptions[].{label, on}`
- Spec side: `kind`, `roots`, `onto`, `ids`, `targets`, `draft`, `base`, `resume`, `askWt`,
  `wt`, `noSame`

Scenarios. Enumerated from the mockup's own view, never hard-coded ids, for every repo in
`DATA`:
1. Every block `action` of kind `Rebase`/`Queue after` (`V.bands…blocks[].action`). Ours:
   `specForQueueAction` on the matching `QueueView` action.
2. Every item selected, every `sel.actions[]` entry whose label starts `Rebase onto` or `Queue
   after`. Ours: `rebaseSpec(ctx, D.roots, D.onto, D.title)`, with roots/onto read from the
   mockup's captured spec. Panel action derivation is Part 6's.
3. `V.rebaseAll` when `mainCanRebase`. Ours: `rebaseAllSpec`.
4. Every `▶ Start agent` (non-draft) and every draft's start. Ours: `startSpec`.
5. Every `sel.stopped[].resume`. Ours: `resumeSpec`.
6. Every All agents row's `run` for a non-running session: askWt, `same`/`new`, archived
   `noSame`. Ours: `resumeSpec` with those flags.
7. Every `Archive` whose `atRisk` is non-null. Ours: `archiveSpec`.
8. Move. `moveDialog` is a closure reached only from drop handlers, so the oracle drives those:
   set `comp.dragIds = [id…]`, then call a block's `dropOn(e)` (mockup line 1201: `before =
   g.lead`, `day = g.day`) or a day band's `drop(e)` (line 1293: `before = null`), with a stub
   `e` (`preventDefault`/`stopPropagation`). Every mine lead dropped on every other lead's block
   and on each working day band, and on the Later band if it carries `drop`. Guarded drops
   (day off, past, before parent, parked-only) open no dialog and are skipped. Ours: `moveSpec`.
State variants over scenarios 1-3 (rebase/queue): `dialogPush` true;
`dialogOverride` true with a working session on a restacked descendant (`statePatch` sets a
session `act: 'working'` and `'waiting'`); `dialogMsg` set (edited); target `choice` switched on
a multi-session item. Over 4 (draft): `dialogBranch` `feat/x-y`. The mockup's `DATA` has no
multi-running-session item: a `statePatch.newSessions` entry adds one, the mockup's own state
field.
Counts: the spec asserts each scenario family is non-empty, so a mockup change can't hollow it
out.

### 3.2 `apps/kira-space/tests/unit/ade-dialog-rules.spec.ts`

Hand-computed cases the mockup can't reach:
1. No remote: rebase, queue and draft lines (§0.3).
2. Local-only main (`main.ref === 'main'`) and a `master` main.
3. `worktreeBasePath` empty: path uses the repo root. Trailing `/` trimmed.
4. Real `AdeBranch.worktree` wins over `wtOf`.
5. Bare Jira key (no URL); no Jira; draft without notes.
6. Multi-root split: unedited gives per-root templates. Edited with other blocks verbatim strips
   them plus separators. An edited other block stays. Single root is unchanged.
7. Target fallback: chosen session stopped goes to first running, else `new`.
8. Blank message disables Send (`sendDisabled`).
9. `idle`/`input` sessions don't block; `stopped` sessions ignored.

### 3.3 `apps/kira-space/tests/unit/ade-dialog-flow.spec.ts`

Turn watcher:
- `requireSubmit`: Stop before submit ignored; submit then Stop resolves `stop`.
- Launch: first Stop resolves.
- `SessionEnd` resolves `ended`.
- `onLive` before first sighting doesn't end; after sighting, absence ends.
- `cancel` detaches; two watches on one terminal both resolve.
Flows, with fake deps:
- Rebase all over 2 roots: two deliveries, in order. `rebasing` holds both, then clears each on
  its own Stop.
- Queue kind calls `SetQueuedAfter` after a successful delivery only; `main` onto never calls it.
- Second delivery fails: first root dropped from the spec, error set, dialog open, second root out
  of `rebasing`.
- Draft start with a branch name: `UpdateNewWork` before `PrepareLaunch`. Empty name: no
  `UpdateNewWork`.
- Launch with status `failed`: watch cancelled, error surfaced.
- Archive: nothing at risk archives directly. Blocked goes to `actionError`, no call. At risk
  opens the dialog. Just delete uses `discard: true`. Send-then-archive archives only after Stop.
  After-Stop `atRisk` reopens with fresh risk. `ended` sets `actionError` and doesn't archive.

### 3.4 `apps/kira-space/tests/ui/ade-dialogs.spec.ts` (`test:ui:space`, mocked control)

Fixture: one repo, two behind mine roots (A with a restacked child A2, B). Sessions: A2 running,
activity driven by emitted `kira:agent:event`; B running idle.
1. Rebase all visible; the note count matches. Click opens `Rebase all onto main`. Message equals
   the template.
2. A2 `UserPromptSubmit` gives the busy alert with row `<A2> · claude <id> · working`. Send
   disabled.
3. `Stop` → alert gone, Send enabled (live). `UserPromptSubmit` → blocked again.
4. `Override…` → `Override on: …` text, `Undo override`, Send reads `Send anyway`. Undo reverts.
5. Close and reopen resets the override.
6. Switch on: message line becomes `Then push each rebased branch with: git push
   --force-with-lease`.
7. Edit the message: Reset appears. Reset restores the template.
8. Send with A's target `new session` and B's running target. `AdeService.PrepareLaunch` then
   `kira:terminal:open` with `launchKind: 'claude-code'` for A. `AdeService.Send` for B with its
   single-root template. Dialog closes. Rebase all hidden while `rebasing`. Emitted `Stop`s bring
   it back.
9. `main` line shows `main`, not a refname (§0.5 fixture shape).
Support: `ipcChannels.ts` + `mockRuntime.ts` add `adePrepareLaunch`, `adeSend`,
`adeArchiveRisk`, `adeArchive`, `adeSetQueuedAfter`, `adeUpdateNewWork`. `ade-module.spec.ts`
fixtures move to `main: {name: 'main', ref: 'origin/main'}`, `remote: 'origin'`.

Archive and Start dialog UI coverage lands with their first UI entry points (Part 5 row,
step 8).

---

## 4. Steps and commits

Record `P129P4_START=$(git rev-parse HEAD)` and the three suite baselines before step 1. Every
commit passes the pre-commit hook (`lint`, `typecheck`). `lint:dead` is pre-push only; clean by
step 6.

1. **`fix(space): ade main line serves short names and the default remote`**: §2.2 Go, bindings,
   `wire.ts`/`normalizeAdeRepoSnapshot`, `mockupToWire.ts` and `ade-module.spec.ts` fixture
   shape. `go test ./apps/kira-space/internal/ade/...`.
2. **`feat(theme): shadcn switch`**: `packages/theme/src/components/ui/switch/*`. Consumer lands
   in step 4 (knip pre-push only).
3. **`feat(space): ade dialog composer and turn watcher`**: `useQueue.ts` exports and `after`
   target fix (§0.9), `activity.ts` labels, `dialogCompose.ts`, `turnWatch.ts`, oracle/converter
   additions, §3.1-§3.2 specs, Part 3 parity projection update.
4. **`feat(space): Claude Code dialog, send and launch`**: bridge members, `mutations.ts`,
   `launch.ts`, `dialogFlow.ts` (send half), `adeUi`/`adeActions`, `AdeClaudeDialog.vue`, Rebase
   all in `AdeMainLine`/`AdeRepoView`, `installAdeSignals` feed, `rebasing` into `useQueue`.
5. **`feat(space): archive-at-risk flow`**: `dialogFlow.ts` archive half, archive section of the
   dialog, `actionError` Alert, §3.3 spec (both halves).
6. **`test(space): ade dialog UI coverage`**: §3.4 and support edits. Run `test:ui:space` once
   here; fixes land as follow-up `fix(space):` commits.
7. **`docs: ARCHITECTURE records ade dialogs (P129 Part 4)`**: §5.1.
8. Part 5 row hand-off (first consumer of `ForcePush`/`pushing`; archive and Start dialog UI
   coverage) already landed with this plan's own commit. Verify it's still there; no commit.
9. Result section `## P129 Part 4 result` in `docs/v2.0/SPEC.md`, with the §6.1 live check.

---

## 5. File inventory

New:
- `apps/kira-space/frontend/src/ade/{dialogCompose.ts, turnWatch.ts, dialogFlow.ts, launch.ts,
  mutations.ts, AdeClaudeDialog.vue}`
- `src/ade/state/adeActions.ts`
- `packages/theme/src/components/ui/switch/{Switch.vue, index.ts}`
- `apps/kira-space/tests/unit/{ade-dialog-parity.spec.ts, ade-dialog-rules.spec.ts,
  ade-dialog-flow.spec.ts}`
- `apps/kira-space/tests/ui/ade-dialogs.spec.ts`

Edited:
- `apps/kira-space/internal/ade/{queue.go, queue_test.go}`,
  `apps/kira-space/internal/bridge/ade.go`, generated Space bindings
- `apps/kira-space/frontend/src/ade/{wire.ts, queries.ts, useQueue.ts, activity.ts,
  AdeActivityIcon.vue, AdeMainLine.vue, AdeRepoView.vue, state/adeUi.ts}`
- `apps/kira-space/frontend/src/bridge/index.ts`
- `apps/kira-space/tests/unit/{ade-queue-parity.spec.ts, support/mockupOracle.ts,
  support/mockupToWire.ts}`
- `apps/kira-space/tests/ui/{ade-module.spec.ts, support/ipcChannels.ts,
  support/mockRuntime.ts}`
- `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md`

No new dependency (reka-ui, VueUse, TanStack, Pinia present). `main.ts` unchanged.

### 5.1 `docs/ARCHITECTURE.md`

- Kira Space ade renderer paragraph:
  - dialog composer as the mockup-oracle byte-exact port, with real-data parameters (§0.3)
  - delivery (Send vs PrepareLaunch + `openTerminalSession`, reattach)
  - turn watcher semantics (§0.15)
  - multi-root split rule
  - `adeActions` store
  - `ForcePush` still unbound in the renderer (Part 5)
- `main` facts are short names; `remote` on the snapshot.
- Known open items: "A pending *Send to Claude, then archive* lives in the renderer; a reload or
  window close before the agent's Stop drops it, and the branch stays unarchived."

---

## 6. Verification

Measure `test:unit`, `test:ui:space`, `test:ui:studio` at `P129P4_START` first.

| Command | Expected |
|---|---|
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean |
| `bun run build:space`, `bun run build:studio` | Clean |
| `go build ./...`, `go test ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/bridge/...` | Pass |
| `bun run test:unit` | Baseline plus the three new specs, all pass; Part 3 parity still green |
| `bun run test:ui:space` | Baseline plus §3.4's cases, all pass |
| `bun run test:ui:studio` | 300, unchanged |

### 6.1 Live check (real TUI)

Server-mode Space (`docs/DEV_ENVIRONMENT.md`) on a scratch repo with a behind mine root:
1. Rebase all → `new session` → a claude-code PTY launches (`kira:ade:sessions` lists it). Its
   first Stop clears `rebasing`.
2. Start a second turn on that session via Rebase (running target) → the prompt lands as one
   bracketed paste and submits. If `\r` races the paste, add Part 1's bounded delay (§0.14) and
   re-check.
3. Dirty the worktree; archive via the flow (driven from devtools, `adeActions.requestArchive`,
   until Part 5's button) → dialog → Send then archive → archived after Stop.
Record outcomes and any delay added in the result section. Where a step can't run (no `claude`
binary or credentials in the container), say so plainly and name what remains unverified.

---

## 7. Closing audit

| Check | Command | Pass |
|---|---|---|
| No Merge | `rg -n -i 'merge' apps/kira-space/frontend/src/ade/dialogCompose.ts apps/kira-space/frontend/src/ade/AdeClaudeDialog.vue` | Only `merged`/`not merged into`/`merge order` template text |
| Templates only in composer | `rg -n 'git rebase\|force-with-lease\|Resume session' apps/kira-space/frontend/src` | `dialogCompose.ts` only |
| TanStack real usage | `rg -n 'useMutation\|fetchQuery' apps/kira-space/frontend/src/ade` | Send, Launch, Archive, SetQueuedAfter, UpdateNewWork, risk fetch |
| Control members | `rg -n 'AdeService\.' apps/kira-space/frontend/src/bridge/index.ts` | Part 3's 6 plus §2.3's 6; no `ForcePush` |
| Each member has a caller | `rg -n 'adePrepareLaunch\|adeSend\|adeArchiveRisk\|adeArchive\b\|adeSetQueuedAfter\|adeUpdateNewWork' apps/kira-space/frontend/src/ade` | Each in `mutations.ts` and used from `adeActions` |
| Switch real usage | `rg -n "ui/switch" apps packages --glob '!**/ui/switch/**'` | `AdeClaudeDialog.vue` |
| Real completion detection | `rg -n 'adeTurns' apps/kira-space/frontend/src` | `queries.ts` feed, `adeActions` watch and flows |
| Composer pure | `rg -n "from 'vue'\|Date.now\|new Date()" apps/kira-space/frontend/src/ade/{dialogCompose,turnWatch}.ts` | Empty |
| SFC form | `rg -L '<script setup lang="ts">' apps/kira-space/frontend/src/ade/*.vue`; `rg -n '<style' …/ade` | Both empty |
| Stores one concern | Read `adeUi.ts`/`adeActions.ts` | Dialog state vs in-flight actions only |
| `main.ts` unchanged | `git diff $P129P4_START -- apps/kira-space/frontend/src/main.ts` | Empty |
| Studio unchanged | `git diff --stat $P129P4_START -- apps/kira-studio` | Empty (bindings are Space-only) |
| Parity breadth | Parity spec's family counts | Every §3.1 family non-empty; every template kind hit |
| Design §4 list | Design §4 bullets vs this part | Each implemented, or its UI entry point named in a later row |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Multi-root split (§0.13) isn't what the user expects | Rule test pins it. Result section calls it out for a user decision. Alternative: one message to every target |
| `UserPromptSubmit` not fired for a pasted prompt or a launch argv prompt | Launch path doesn't require it. Send path is checked in §6.1. Fallback: `requireSubmit: false` with arm-after-idle, decided in the live check and recorded |
| User types their own prompt between our Send and its Stop | Turn completes on that turn's Stop instead. For archive, the after-Stop `ArchiveRisk` recheck (via `Archive`'s own `atRisk` guard) keeps data safe |
| Paste/`\r` race in the TUI | Part 1's planned bounded delay, only if §6.1 shows it |
| Launched PTY has no visible view until Part 6 | Tracked, counted and activity-iconed. Output buffered (256 KiB, oldest dropped). Part 6 reattaches |
| Mockup drop handlers need DOM beyond the stub event | Part 3's vm stubs plus a stub event; a `ReferenceError` fails loudly, never patch mockup code |
| Go `Main` change breaks a Part 2 test asserting full refnames | `go test` in step 1; update the assertion to the short form in the same commit |
| Concurrent P131 work in `packages/theme` | Switch is a new directory only; no shared file touched |
| Pending archive lost on reload | Known open item (§5.1) |

---

## 9. Acceptance, mapped to the SPEC row

| SPEC row wording | Where |
|---|---|
| Design §4 in full: titles | §0.4, §3.1 (`title`) |
| optional branch name (Start new work) | §0.19, §2.7, §3.1 draft variant, §3.3 draft flow |
| target agent per affected stack (only agent preselected, chips, `new session`) | §0.7 `agentTargets`, §0.11, §2.7, §3.1 (`targets`, `(only agent)`), §3.4 case 8 |
| worktree choice | §0.7 `resumeSpec`, §2.7, §3.1 scenario 6 |
| busy check over every branch a rewrite touches | §0.10 (`spec.ids` = roots plus restacked), §3.1 override variant on a descendant, §3.4 case 2 |
| live re-evaluation | §0.10, §3.4 case 3 |
| two-click Override | §0.10, §3.1, §3.4 cases 4-5 |
| force-push switch (default off) | §0.18, §2.7, §3.1 `dialogPush`, §3.4 case 6 |
| editable message with every template (Rebase onto main/branch/review, Queue after, Move, Start new work, Start existing, Resume) | §0.3, §3.1 scenarios 1-8 byte-for-byte |
| Reset | §2.5 `setMsg(null)`, §3.1 `edited`, §3.4 case 7 |
| no Merge template or action | §0 standing decisions, §7 audit |
| Send forwards to a running session or launches one through Part 1 | §0.12, §0.14, §3.3, §3.4 case 8, §6.1 |
| Design §2.4 archive safety dialog (`Just delete`, `Send to Claude, then archive` completing on the agent's Stop) | §0.15, §0.16, §3.3, §6.1 step 3; UI entry Part 5 (§0.8) |
| Wired from the `main` line's Rebase all | §0.20, §2.7, §3.4 cases 1, 8 |
| every template byte-for-byte against `sendDialog()`/design §4 | §3.1 |
| busy-check and override behavior under mocked activity | §3.4 cases 2-5 |
| Needs Part 3's `useQueue` (targets, restack order) and shell | §0.9 (`kids`/`parentOf` exports), §2.7 |
| Part 3 §0.8/§0.10 hand-offs (`rebasing`, method table) | §0.6, §0.12 |
