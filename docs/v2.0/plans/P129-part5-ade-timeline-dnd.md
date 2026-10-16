# P129 Part 5 — timeline, stack boxes and drag and drop

Plan for `docs/v2.0/SPEC.md`'s `P129 Part 5` row. Planned against `v1.9` at `ee3d877d` (P133
result landed; P129 Part 4 result already in).

Binding inputs: Part 1 plan §0 (`docs/v2.0/plans/P129-part1-ade-agent-runtime.md`), Part 2 plan
(`…/P129-part2-ade-queue-backend.md`: `SetPlan`, `Candidates`, `AddBranch`, `AddNewWork`,
`ForcePush`, `buildPlanFact`'s derived `unpushed`), Part 3 plan (`…/P129-part3-ade-data-layer.md`:
§0.6 calendar, §0.8 `rebasing`/`pushing` inputs, §0.9 reserved `adeUi` fields, §0.10
first-consumer rule), Part 4 plan (`…/P129-part4-ade-dialogs.md`: §0.6 method moves, §0.7 openers,
§0.8 UI entry points, §0.12 `afterSend`), the Part 3/4 result sections in `docs/v2.0/SPEC.md`,
design `docs/v2.0/design/SPEC.md` §2.3 (Add onward), §5 (ordering), §7, §8, §9, and
`mockup.html`: Add picker markup 100-155 and logic 1341-1378; History bar/pull/day controls
157-186; band/box/row markup 186-275; context menu and confirm markup 452-470; `movePlan`/
`shiftWork` 695-716; `scrollToDay`/`revealHistory`/`forcePush` 733-755; `dragStartFor`/`rowFor`
1094-1130; `moveDialog` 1132-1138; block assembly 1140-1206; bands 1233-1304; day menu and confirm
1312-1339; scroll handlers 1778-1812.

Every path, symbol and count below was measured in this container at `ee3d877d`:
`codegraph_explore` for symbols, call graphs and blast radius (`useQueue` internals and
`QueueBand`/`QueueSegment`/`QueueCell`, `buildBands`/`buildCells`/`overflowOf`,
`dialogCompose` openers and `DialogCtx`, `dialogFlow.sendMove`, `adeActions`/`adeUi` stores,
`mutations.ts`/`queries.ts`, Space `bridge/index.ts`, `AdeService`'s five Part 5 methods and their
wire structs, `Queue.ForcePush`/`Candidates`/`AddBranch`/`resolveKind`, store `SetPlan`,
`createSettingsStore.patchSettings`, `useContextMenuStore`/`ContextMenu.vue`, `ConfirmDialog`,
`installControlMocks`, `mockupOracle`/`mockupToWire`, `AdeView`/`AdeRepoView`/`AdeMainLine`/
`AdeProjectHeader`/`AdeActivityIcon`, `activity.ts`, `reduceAgentActivity`,
`createAgentSessionsStore`), then `Read` for exact lines (the mockup, `useQueue.ts` bands and view
assembly, `ade.go` 1049-1148, `remote.go` protected-branch gate, `ipcChannels.ts`,
`ade-dialogs.spec.ts`), plus the `vue-draggable-plus@0.6.1` tarball's own `package.json`/`dist`.

---

## 0. What the SPEC row left open, and resolutions

Standing user decisions (Part 1 §0), not reopened:
- Claude Code icon is the generic `robot` codicon (`workbench/modes.ts`'s `ade` entry), never the
  branded asset.
- No Jira sync: Add's Jira field stores the parsed key plus pasted URL, nothing fetched.
- No `ready`, no `ciFailing`, no Merge action anywhere.
- PR is `ResolveBranchPr`'s raw state plus title (Part 5 renders no PR anywhere; rows show title,
  branch, activity and Start only, design §9).
- Resume fallback for a gone worktree is Part 7's.
- Design wins over mockup; mockup wins for markup structure and interaction; tone tints and the
  20-colour palette stay literal values, not theme tokens.

1. **No split.** One continuous surface: bands, boxes, action column and drag and drop all read one
   `QueueView` and one drop-rule module (`timelineOps.ts`). Day ops, overdue/overflow moves and drops
   all write through one `SetPlan` mutation. The Add popover is small and lands the item the timeline
   renders. Splitting would put the `SetPlan` binding, `timelineOps` and the band DOM in Part 1 and
   leave Part 2 with only `useDraggable` wiring over them — two parts sharing every file, the P110
   iter2 rejection pattern. Commits stay granular (§4); one Sonnet implementer runs it sequentially.

2. **Method assignment (Part 3 §0.10 first-consumer rule).** Part 5 binds the five members whose
   first caller lands here: `CandidateBranches` (Add → Existing branch), `AddBranch`, `AddNewWork`,
   `SetPlan` (drops, Move to today, overflow move, day-off confirm), `ForcePush` (action column).
   Renderer bound count goes 12 → 17 of 19. `SetBranchMeta` and `BindNewWork` stay Part 6's.

3. **`CandidateBranch.mine` (Go, new).** Design: the Existing branch list shows `you` or the owner
   in blue. `CandidateBranch` carries only `Author` (author name), so the renderer can't tell. Add
   `Mine bool` to `ade.CandidateBranch` and `mine` to `AdeCandidateBranch`. `Queue.Candidates` reads
   `user.email` once (`entry.ConfigValue`, as `AddBranch` does) and sets
   `Mine = resolveKind(r, userEmail, "") == model.AdeBranchKindMine` — the exact rule `AddBranch`
   applies, so `you` and the resulting kind never disagree. Bindings regenerate (field only).

4. **`useQueue` stays pure; Part 5 extends its view, never re-derives in components.** All new
   calendar/label facts come from `useQueue` (it owns the calendar). Additions, each mockup-sourced:
   - `QueueInput.historyOpen?: boolean` (default `false`) and `historyReach?: number` (past days shown
     while open, default `settings.historyDays`). History band keys `-reach..-1` exist only while
     open (mockup 1234). History rows render only while open (mockup 1262).
   - `QueueInput.localDayOf: (ms: number) => string` (required, §0.5).
   - `QueueView`: `historyCount` (entries with `-settings.historyDays <= day <= 0`, mockup 1302),
     `focusDay` (first past band with blocks, else 0; mockup 1271), `firstWorkDay` (mockup
     `firstWork(0)`), `effDay: Record<string, number>` (offset or `LATER`, for drop rules).
   - `QueueBand`: `iso` (`null` for Later), `isMonday`, `isCalendarWeekend`, `isWorkedWeekend`,
     `isEmpty` (no blocks, spans or history; mockup 1264), `longLabel` (`dayLong`),
     `overdueIds` (mockup `idsOf(overdue)`), `startIds` (non-review members of lead segments starting
     that day, mockup 1319), `nextWorkDay` (`nextWork(dk)`, `null` for Later), `nextWorkLabel`
     (`dayLabel`), `nextWorkLong` (`dayLong`), `overflowMoveLabel` (mockup 1284), `spans`.
   - `QueueSpan {lead, title, color, note, isEnd, tip, startDay}`: mockup 1245-1259 continuation
     rows (`day i/n`, ` · merges` on the end day, tip `continues from <dayLabel>; click to open`).
   - `QueueSegment.dragIds` (non-review member ids; empty means not draggable, mockup 1168).
   - `QueueAction.tip` (`git push --force-with-lease` for Force push, else `''`) and
     `QueueCell.action.tip` (Archive: mockup 1080's `archiveTip`; Start: `Claude creates the branch
     and starts` for a draft, else `start Claude Code in its worktree`). `QueueCell.tip` = the
     segment tag tip (mockup gives every tag/info cell the block tip, 1175).
   - `QueueItem.agents: {sessionId, label, kind, lastActiveAt}[]`: running sessions only, sorted by
     `actRank`, `label` = `activity.ts`'s `sessionLabel`. Drives the agents pill.
   - Exports `offsetToIso(today, k)` and `isoToOffset(today, iso)`, both on the existing
     `isoToDays`/`civilFromDays` arithmetic (no `Date` constructor, Part 3's audit grep).
   The parity spec passes `historyOpen: true` (was `comp.state.showHistory = true` alone) and gains a
   closed-history case (§3.1).

5. **History day is the local day (bug found while planning).** `historyDayOffset` does
   `Math.floor(archivedAt / DAY_MS) - todayDays`: a UTC day. In any non-UTC zone an evening archive
   lands on the wrong band, against Part 3 §0.6 ("local, never UTC"). `useQueue` can't read the zone
   and stay pure, so the caller injects `localDayOf(ms)`. New `src/ade/localDay.ts` holds
   `localIso(date: Date)` (moved out of `AdeRepoView`'s `today` computed) and
   `localIsoOfMs(ms) = localIso(new Date(ms))`. `useQueue` maps each entry through
   `isoToOffset(today, localDayOf(archivedAt))`. Tests pass the converter's own day mapping
   (§3.1).

6. **History open/closed is local to `AdeRepoView`; selection is in `adeUi`.** `AdeView` keys
   `AdeRepoView` by `activeRepoId`, so a repo tab switch remounts it: a local `historyOpen` ref and
   `historyReach` ref reset exactly as design asks ("Switching repo tabs hides history again"). No
   store field needed; update `adeUi.ts`'s header comment (it reserved `historyOpen` for Part 5).
   Selection outlives the tab switch (mockup `selected[repo]`) and Part 6's panel reads it, so it
   goes in `adeUi`: `selectedByRepo: Record<string, string>`, `select(repo, id)`. `useQueue`'s own
   first-item default still applies when unset or stale.

7. **Scroll-pull, exact (mockup 1788-1797, design §2.3).** New composable
   `src/ade/useHistoryPull.ts(scrollEl, {isOpen, open})`, VueUse only:
   `useEventListener(scrollEl, 'wheel', …, {passive: true})` and `useTimeoutFn(reset, 700,
   {immediate: false})`. While closed: at `scrollTop === 0` with `deltaY < 0`,
   `pull += min(120, -deltaY)` and restart the 700 ms reset; `pull >= 400` opens. Any other wheel
   (scrolled, or down) zeroes `pull`. `pct = min(100, round(pull / 4))`. Pull row text:
   `Keep scrolling up to open history` while `pull > 0`, `Release to open history` at `pct >= 100`,
   else `History · N archived in the last <span>`. Purple fill width = `pct%`
   (`rgba(163,113,247,0.18)`, 0.1 s width transition). Clicking the row opens.

8. **History span text.** Mockup hardcodes `the last 2 weeks`; `historyDays` is a setting (1-365).
   `historySpanText(days)`: `week` for 7, `N weeks` when divisible by 7, else `N days`. Default 14
   gives the mockup's `2 weeks`. New, flagged.

9. **Opening keeps position; History bar; navigation (mockup 733-744, 1782-1810).**
   - Open: record `scrollHeight`, set `historyOpen`, `await nextTick()`, then
     `scrollTop = scrollHeight - before - 60`.
   - `inHistory` = open and `scrollTop + headerHeight < todayBand.offsetTop - 30`, recomputed on
     `useScroll(scrollEl)`'s `y`. While true, the sticky header shows `AdeHistoryBar`:
     `History · Go to [date] · Hide history · Current work ↓`.
   - `scrollToDay(k)`: band element `[data-ade-day="<k>"]` (`later` for Later);
     `scrollTop = offsetTop - headerHeight - 2`. Header height from the sticky header's own ref
     (`useElementSize`).
   - Hide history: close, then `scrollTop = 0`. Current work ↓: `scrollToDay(view.focusDay)`.
   - Go to date (past): `historyReach = max(reach, -k + 2)` — runtime, never written to settings:
     a navigation must not rewrite the user's `historyDays`. Go to date (future beyond the horizon)
     and `or date`: append the ISO date to `settings.ade.extraDays` via `patchSettings`
     (persisted, Part 3 made it a setting). Both scroll after `nextTick`.
   - `+ week`: `patchSettings({ade: {horizonDays: min(365, horizonDays + 7)}})`. `or date` input
     `min` = tomorrow's local ISO; a date `<= today` is ignored (mockup 1309).
   - `+ week`/`or date` render right above the Later band (mockup 176-186).

10. **Day-off menu reuses the workbench context menu; one small shared addition.** Theme has no
    shadcn `context-menu`; Space's `GitPanel`/`RepoFileTree` already right-click through
    `useContextMenuStore().openContextMenu(ev, items)`. The mockup menu has a title row (the day's
    `dayLong`) above the one item. `MenuItem` has no label variant, so add
    `{type: 'label'; label: string}` to `packages/workbench/src/state/contextMenu.ts`, rendered by
    `ContextMenu.vue` through the theme's existing `DropdownMenuLabel` (key `label-${idx}`).
    `ContextMenu.vue` is the only `MenuItem.type` switch site (measured). Menu opens on every band
    except Later and past days (mockup 1296). Labels and toggles (mockup 1318-1332), all through
    `patchSettings`:
    - off day: `Mark as working day`, remove from `offDays`.
    - weekend: `Mark as weekend (off)` when worked (remove from `workWeekendDays`), else
      `Work this day` (add).
    - weekday: `Mark as day off`, add to `offDays`. If `band.startIds` is non-empty, open the
      confirm (§0.11) once the patch resolves.

11. **Own confirm dialog, not the workbench `ConfirmDialog`.** Workbench `ConfirmDialog` has a fixed
    `Confirm` title and `Cancel`/`Delete|Continue` buttons; the mockup needs `<dayLong> is a day off`,
    `Move N branch(es) planned for that day to <dayLong(to)>?`, **Move to <dayLabel(to)>** /
    **Leave it**. New `AdeConfirmDialog.vue` on the theme's shadcn `Dialog`, state in
    `adeUi.confirm: {title, text, yesLabel, noLabel, token: string | null, error: string | null,
    run: () => Promise<void>} | null`. `token` non-null adds an `Input` and disables yes until it
    matches (§0.15's protected push). Yes awaits `run`; a rejection shows in-dialog, never closes.
    Day-off yes runs `shiftWork(startIds, nextWorkDay)` through `SetPlan`. `to` is `band.nextWorkDay`:
    `nextWork(dk)` already skips days off and unworked weekends, matching mockup 1330's loop.

12. **Drag and drop: `vue-draggable-plus` initiates, rules decide, DOM never moves.** Measured:
    `vue-draggable-plus@0.6.1` is MIT, bundles SortableJS 1.15 (MIT, `@license MIT` in its `dist`),
    depends only on `@types/sortablejs`. Add it to the root `package.json` `dependencies`, exact pin
    `0.6.1` (repo convention). Model:
    - Two `useDraggable` instances per box, nested: each band's box list (`draggable:
      '[data-ade-block]'`, `handle: '[data-ade-box]'`) and each box's row list (`draggable:
      '[data-ade-row-movable]'`). A drag on a movable row starts the inner (row) sortable. A drag on
      a review row or the box edge matches nothing inside, bubbles to the outer sortable and drags the
      whole box. This is mockup 1094-1110's native nesting (rows `stopPropagation`, a non-draggable
      review row drags its box) expressed through Sortable's own nested handling.
    - Options: `sort: false`, `group: {name: 'ade-plan', pull: false, put: false}`,
      `forceFallback: true`, `fallbackOnBody: true`, `fallbackTolerance: 4`, `ghostClass`/
      `chosenClass` single Tailwind utilities (Sortable toggles one class name). No list ref is
      bound: nothing is ever inserted into another list, so SortableJS never moves Vue-managed DOM
      and vue-draggable-plus installs no revert handlers (measured in its source). The fallback clone
      follows the pointer; Sortable's bundled AutoScroll scrolls the timeline while dragging.
    - Why `forceFallback`: one pointer-event code path in the test browser (Chromium under
      Playwright) and the shipped WKWebView, driven deterministically by `page.mouse` in
      `test:ui:space`; the clone gets `pointer-events: none`, so hit-testing sees what is under it.
    - Target resolution, not list indices: new Pinia store `ade/state/adeDrag.ts`
      (`{ids: string[] | null, target: DropTarget | null}`, `begin`, `setTarget`, `finish`).
      `onStart` records `dragIds` (row: `[id]`; box: `segment.dragIds`). While a drag is active,
      `AdeTimeline` resumes VueUse `useMouse({type: 'client'})` + `useElementByPoint` and maps the
      element under the pointer to `{kind: 'box', lead, day}` (closest `[data-ade-box]`) or
      `{kind: 'band', day}` (closest `[data-ade-band]`), else `null`. `onEnd` calls `finish()` and
      emits the drop with the last target. This is mockup semantics exactly: drop on a box = before
      its lead on its day; on empty day space = append.
    - Highlight (mockup 1290): the hovered band gets the amber tint and dashed outline, only when it
      accepts (`!isPast && !isDayOff`).

13. **Drop rules and plan writes are one pure module, `src/ade/timelineOps.ts`.** Literal ports:
    - `dropVerdict(view, plan, ids, target)`:
      - box target with no lead, or `ids` includes it: `refuse`.
      - band target on a past day or a day off: `refuse`.
      - then mockup `moveDialog` (1132-1138): day off (non-Later) `refuse`; lead's parent exists, is
        not review, its `effDay` isn't Later and target day < it: `refuse` ("never before its parent").
        All `ids` parked: `{kind: 'direct', args}`. Else `{kind: 'dialog', ids, before, day}`.
      - Later maps to `null`.
    - `movePlanArgs(plan, today, ids, before, day)` (mockup 695-703): remove `ids[0]` from `order`,
      insert before `before` when present, else append; `days[id] = iso | null` for every id.
    - `shiftWorkArgs(plan, today, ids, toDay)` (mockup 706-716): in-order ids move to just before
      the first remaining item whose day is `toDay`, else the end; every id gets `toDay`.
    - Output is `AdeSetPlanArgs` minus `codeRepoId`: `days` only for touched ids, `order` always the
      full array. Store `SetPlan` upserts `position = i` for every `order[i]` and inserts missing
      rows (measured, `adequeue.go` 392-423), so items new to the plan are safe.
    - Callers: drop (direct or via Move dialog), overdue `Move to today`
      (`shiftWorkArgs(overdueIds, firstWorkDay)`, mockup 1282), overflow move
      (`shiftWorkArgs(overflowIds, overflowMoveDay)`, 1285), day-off confirm. The last three apply
      directly, no dialog (design §2.3).

14. **Move dialog writes the plan first, awaited (changes Part 4 §0.12).** Today `DialogSpec.afterSend?:
    () => void` runs after `deliver()`, unawaited. `SetPlan` is async and can fail. Rename to
    `applyPlan?: () => Promise<void>`; `sendMove` awaits it **before** `deliver`. `SetPlan` is
    absolute (idempotent), so a delivery failure then retry re-applies the same plan and delivers
    once. The reverse order would re-deliver on a plan-write retry. Both errors surface in-dialog via
    `setError`, as every Part 4 send path does. `moveSpec(ctx, ids, before, day, applyPlan)`.

15. **`SetPlan` is optimistic.** A drop reverts nothing in the DOM (§0.12), so the box would sit at
    its old day until the refetch. `useAdeSetPlan` uses TanStack's documented optimistic pattern:
    `onMutate` cancels `adeSnapshotKey(repo)`, snapshots it, writes the merged
    `plan.day`/`plan.order`; `onError` restores; `onSettled` invalidates.

16. **Force push: first consumer of `ForcePush` and `useQueue`'s `pushing`.**
    `adeActions.pushing: Map<repo, Set<branch>>`, `pushingFor(repo)` feeds
    `QueueInput.pushing` (label `Pushing…`, disabled, Part 3 already renders both). `forcePush(repo,
    ids)`: add all, call `useAdeForcePush`, remove all in `finally`. Per result:
    - `ok`: nothing; `ForcePush` calls `notifyChanged`, the snapshot refetch clears `unpushed`
      (derived, Part 2 `buildPlanFact`).
    - `error.kind === 'ProtectedBranch'`: queue a typed confirm per branch (`adeUi.confirm` with
      `token = branch`, title `Force push <branch>`, text = the error's own message, yes
      `Force push`, no `Cancel`). Yes re-calls `ForcePush` for that one branch with
      `confirmProtected: [branch]`. Branches confirm one at a time.
    - any other error: `actionError` (Part 4's repo Alert):
      `Force push <branch> failed: <message>`.

17. **Action column wiring (design §2.3; Part 4 §0.8 makes these the first UI callers).**
    - Segment action `rebase`/`queueAfter`: `adeUi.openDialog(specForQueueAction(ctx, action))`.
    - Segment action `forcePush`: `adeActions.forcePush(repo, action.targetIds)`.
    - Cell `start`: `openDialog(startSpec(ctx, id))`.
    - Cell `archive`: `adeActions.requestArchive(repo, id, ctx)` (nothing at risk archives
      directly; at risk opens Part 4's archive dialog).
    - Tag/info cells: max-width 120px, truncate, tooltip = `cell.tip`. Buttons never wrap.
    - Archive button solid purple `#a371f7`/white; Start `#d97757`/`#1a0f0a`; segment action in the
      tone's solid colour (mockup 1173-1180).

18. **Agents pill.** Capsule 22px, `#0f1013`, border `#34373f`, starting with
    `<CodiconIcon name="robot">` in `#d97757` (§0 standing decision), then one activity button per
    running session. Extract the glyph from `AdeActivityIcon.vue` into `AdeActivityGlyph.vue`
    (`kind`, `size: 12 | 13`); `AdeActivityIcon` keeps its tooltip wrapper around it. Each pill
    button: `aria-label="Open claude <id>"`, `Tooltip` with `delay-duration="0"` (design: "right
    away"): `claude <id>` over `<activity> · <last active>`, activity in its colour (mockup 1106).
    Last active via `useTimeAgo` on the shared `src/ade/ago.ts` options (§0.20).
    **Click selects the branch. Opening that session's terminal in the Agents tab is Part 6's**:
    the Agents tab doesn't exist until Part 6. Part 5 wires select only and adds no placeholder
    state. Hand-off: Part 6's row should name "activity-icon click opens that session's terminal"
    (design §2.3) — flagged to the orchestrator, not edited here (no split).

19. **Add popover (design §2.3, mockup 100-155, 1341-1378).** `AdeAddPopover.vue` on shadcn
    `Popover` (440px, anchored at the main line's 218px offset) and `Tabs` (`New work` default,
    `Existing branch`). The `Add` button sits next to the main-line pill: `AdeMainLine` gains a
    default slot after the pill; `AdeRepoView` fills it.
    - **New work**: `Title` (`Input`), `Jira` (`Input`, mono, `paste link or key (optional)`),
      `Start from` (`NativeSelect`: `main` plus queue items `!draft && kind !== 'parked'`, mockup
      1357), `Notes` (`Textarea`), hint `No branch yet. Claude creates it on Start.`, **Add to Later**
      disabled until title or Jira key. Calls `AddNewWork` with `startFrom` = the option's branch
      name. No `SetPlan`: no plan row means Later, or the parent's day when stacked (design, §5.2).
      On success: `adeUi.select(repo, newId)`, reset fields, close.
    - **Existing branch**: shadcn `Command` (design §8's "combobox for the branch picker"):
      `CommandInput` (`Search branches…`), `CommandList` rows `<ago> · <you|author> · <name>`
      (`you` on `#23252b`, author on blue tint), `CommandEmpty` `No branches`. Server order kept
      (newest first). `useAdeCandidates(repo, open)` is enabled only while the popover is open.
      Pick calls `AddBranch` (kind `''`, Go resolves), selects the returned id, closes.
    - `src/ade/jira.ts` `parseJira(input) → {key, url}`: key = first `/[A-Z][A-Z0-9]+-\d+/` match
      (mockup 793, same as Go `adeJiraKeyRe`); url = the trimmed input when it parses as an
      `http(s):` URL, else `''`. First consumer here; Part 6's paste inputs reuse it.

20. **One relative-time formatter.** `AdeProjectHeader` already configures `useTimeAgo` with the
    mockup's `Nm/Nh/Nd ago` thresholds. The picker (mockup 1343) and pill tooltip need the same.
    Move the options object to `src/ade/ago.ts` (`adeAgoOptions`); all three call sites import it.

21. **Stack box and row look (design §2.3, mockup 1096-1130, 1195-1203).** Literal values, Tailwind
    arbitrary values (P110 rung 4, one-off data tints):
    - Box: max-width 560px (`max-w-140`), 40px rows, 3px left edge in the tag tone's solid colour,
      `#1a1c21`. Parked: dashed `#3a3e48` plus 135deg hatch. Ripple: 2px `#e8a33d`. Merged: 1px
      `rgba(163,113,247,0.55)`. Continuation: dashed `#3a3e48`. Else solid `#2a2d35`. No
      `overflow-hidden` (tooltips escape).
    - Row: indent `dep * 18px`; elbow 9x18 with 2px left/bottom border, dashed on a continuation
      segment's first row, `#7aa7ff` under a review parent else `#5c606b`. Colour square 10px
      rounded 3px: filled (mine), outlined (review), dashed (parked), outlined plus hatch (draft).
      Review: blue title `#93b6ff`, stripes, owner pill with `lock` codicon. Parked title `#b4b6bd`.
      Selected: `#26272d` plus 3px `#e8a33d` left border. Merged: `rgba(163,113,247,0.08)`.
    - Title (sans, `text-kira-md` 600) over branch (mono `text-kira-sm`, muted; draft italic). The
      title is a `<button>` (keyboard select). Row click selects.
    - Font sizes use the four-value `text-kira-*` scale only (P123, `check-theme-classes.sh`).

22. **Band look (mockup 1286-1293).** Ruler 60px (`w-15`), right border 2px (`#e8a33d` today,
    `#2a2d35` past/greyed, else `#3a3e48`), tick dot. Top border solid `#34373f` on Monday, Today and
    Later, else dashed `#202227`. Greyed (unworked weekend or day off): hatch
    `rgba(255,255,255,0.018)`; overdue `rgba(232,163,61,0.04)`; past `rgba(255,255,255,0.012)`.
    Label struck through on a day off; sub `off`, `''` (empty weekend) or `<h>h`, red `#f28b7d` over
    capacity. `isEmpty` bands render compact (label `text-kira-sm` 500, reduced padding): design's
    "empty days collapse to a thin row". History rows: `✓ <how> <title> <branch>`, purple tint
    `rgba(163,113,247,0.06)`, at the 218px offset. Overdue strip `N stack(s) not merged` +
    **Move to today**. Overflow strip `<over>h over <cap>h` + `Move to <day> · <title|N branches>`.

23. **Continuation rows** (`AdeContinuationRow.vue`): 28px dashed button at 218px, 3px left edge in
    the lead's colour, `↳ day i/n[ · merges]` (amber on the end day) and title; click selects the
    lead and `scrollToDay(span.startDay)`.

24. **No DnD or keyboard-reorder beyond the design.** Rows and boxes drag by pointer only; the design
    names no keyboard drag. Selection and every action stay keyboard-reachable (title button,
    action buttons, menu via the band's own context-menu key through the browser's `contextmenu`).

25. **Acceptance cross-reference (Part 4 §0.8) confirmed.** Archive (`Just delete`; `Send to Claude,
    then archive` completing on a mocked `Stop`) and Start first become UI-reachable here, through
    §0.17's cells. `test:ui:space` covers both end to end (§3.4).

26. **Tests follow the CLAUDE.md bar.** `timelineOps.ts` qualifies (order splicing, three interacting
    refusal rules, offset/ISO arithmetic), covered by mockup parity plus a few real-only rules.
    `useQueue` extensions extend Part 3's parity spec. Components, stores, composables and the Go
    `mine` flag get no dedicated unit test (the Go flag updates existing `Candidates` assertions
    only).

27. **No `git-ui` import** (P131 row's concurrency warning). Part 5 touches `packages/workbench`
    (§0.10's label variant) and `packages/theme` not at all.

---

## 1. Confirmed current state (`ee3d877d`)

- `AdeRepoView.vue`: scroll container root (`overflow-auto`), sticky header (`AdeProjectHeader`,
  `AdeMainLine`), `actionError` Alert, `AdeClaudeDialog`. `view` passes `rebasing` only; no
  `selectedId`, `pushing`, `historyOpen`. `today` built inline from `new Date()`.
- `useQueue.ts` (1513 lines): `QueueInput.pushing`/`selectedId` exist; `buildBands` always adds
  `-historyDays..-1`; history rows attach to any band regardless of open state; history day is UTC.
  `QueueCell.tag` has no tip; `QueueAction` has no tip; `LATER` exported; `dayLong` exported.
- `dialogCompose.ts`: `moveSpec(ctx, ids, before, day, afterSend?)`, no caller yet. `dialogFlow.ts`
  `sendMove`: `deliver` then `spec.afterSend?.()` then close.
- `adeUi.ts`: `activeRepoId`, `refreshNote`, `dialog`; comment reserves `selectedByRepo`/
  `historyOpen`. `adeActions.ts`: `rebasing`, `pendingArchive`, `actionError`, `buildDeps`,
  `sendDialog`, `requestArchive`, `justDelete`.
- `bridge/index.ts` `spaceControl`: 12 ade members; `ForcePush` unbound (comment says Part 5).
- `mutations.ts`: `useAdeSend`, `useAdeLaunch`, `useAdeArchive`, `useAdeSetQueuedAfter`,
  `useAdeUpdateNewWork`, `fetchArchiveRisk`. `queries.ts`: snapshot, PRs, sessions, refresh.
- Go: `CandidateBranches`/`AddBranch`/`AddNewWork`/`SetPlan`/`ForcePush` exist and are tested
  (Part 2). `CandidateBranch{Name, Author, LastCommitAt, RemoteOnly}`. `ForcePush` returns
  per-branch results; a protected branch without its token returns `ProtectedBranch`
  (`gitsession/remote.go` 319-325).
- Settings `ade`: `horizonDays`, `historyDays`, `extraDays`, `offDays`, `workWeekendDays`,
  `workdayHours`, `spanDayShare`; `patchSettings` applies only the backend-confirmed result.
- No `vue-draggable-plus`/`sortablejs` in the repo. `useDragReorder.ts` notes sortablejs was never
  installed; this is its first use.
- `tests/ui/ade-dialogs.spec.ts` covers Rebase all end to end, including mocked `Stop` via
  `emitWailsEvent('kira:agent:event', …)`. `ipcChannels.ts` lists the 12 bound ade channels.

---

## 2. Design

### 2.1 Module shape (`apps/kira-space/frontend/src/ade/`)

| Module | Kind | Owns |
|---|---|---|
| `useQueue.ts` | pure (edited) | §0.4 view additions, §0.5 local history day |
| `timelineOps.ts` | pure (new) | §0.13 drop verdict, `movePlanArgs`, `shiftWorkArgs`, `dayMenuFor` |
| `localDay.ts` | tiny (new) | `localIso`, `localIsoOfMs` |
| `ago.ts` | tiny (new) | `adeAgoOptions`, `historySpanText` |
| `jira.ts` | pure (new) | `parseJira` |
| `useHistoryPull.ts` | composable (new) | §0.7 wheel pull |
| `useTimelineDrag.ts` | composable (new) | §0.12 `useDraggable` options for box and row lists |
| `state/adeDrag.ts` | Pinia (new) | drag ids and current target |
| `state/adeUi.ts` | Pinia (edited) | `selectedByRepo`, `select`, `confirm` |
| `state/adeActions.ts` | Pinia (edited) | `pushing`, `forcePush`, `setPlan`, `addNewWork`, `addBranch` |

`dayMenuFor(band, settings) → {label, patch: SettingsPatch['ade'], confirmAfter: boolean} | null`
(null on Later and past): §0.10's rules as data, so the component only wires the menu.

### 2.2 Go (`apps/kira-space/internal/`)

- `ade/queue.go`: `CandidateBranch.Mine`; `Candidates` reads `user.email` (error propagates, as in
  `AddBranch`) and sets `Mine` via `resolveKind`.
- `bridge/ade.go`: `AdeCandidateBranch.Mine bool \`json:"mine"\``; `toWireAdeCandidates` copies it.
- `ade/queue_test.go`: existing `Candidates` assertions gain `Mine` (a mine and a review author in
  the fixture already exist, or the fixture's author email is set to exercise both).
- Regenerate bindings (`frontend/bindings`, model field only; method count stays 19).

### 2.3 Bridge and wire

`bridge/index.ts` adds, same `unwrap(AdeService.X(args))` + `trust<>` pattern:
- `adeCandidateBranches(codeRepoId) → AdeCandidateBranch[]` (normalize `?? []`).
- `adeAddBranch(args: AdeAddBranchArgs) → string`.
- `adeAddNewWork(args: AdeAddNewWorkArgs) → string`.
- `adeSetPlan(args: AdeSetPlanArgs) → void`.
- `adeForcePush(args: AdeForcePushArgs) → AdeForcePushResult[]` (normalize `?? []`).
Update the comment that says `ForcePush` stays unbound.

`wire.ts` adds `AdeCandidateBranch {name, author, lastCommitAt, remoteOnly, mine}`,
`AdeAddBranchArgs {codeRepoId, branch, kind?}`, `AdeAddNewWorkArgs {codeRepoId, title, jiraKey,
jiraUrl, startFrom, notes, est}`, `AdeSetPlanArgs {codeRepoId, days: Record<string, string |
null>, order: string[]}`, `AdeForcePushArgs {codeRepoId, branches, confirmProtected?}`,
`AdeForcePushResult {branch, ok, error?: {kind, message, remoteMessage?}}`. Field names from
`ade.go` json tags; the generated `models.ts` is the cross-check.

### 2.4 TanStack layer

`queries.ts`: `adeCandidatesKey(repo) = ['ade', 'candidates', repo]`;
`useAdeCandidates(repo, enabled)` (`staleTime: 0`, refetch on each open).
`mutations.ts` (Part 4's shape: `mutationKey = deliverKey(repo, kind)`, `onSettled` invalidates):
- `useAdeSetPlan(repo)`: optimistic (§0.15); invalidates snapshot.
- `useAdeForcePush(repo)`: invalidates snapshot.
- `useAdeAddNewWork(repo)`, `useAdeAddBranch(repo)`: invalidate snapshot and candidates.

### 2.5 Stores

- `adeUi`: `selectedByRepo`, `select(repo, id)`, `confirm` plus `openConfirm(c)`,
  `closeConfirm()`, `setConfirmError(msg)`. Header comment updated (§0.6). Still one concern: the
  `ade` module's runtime UI state (tab, notes, dialogs, selection).
- `adeActions`: `pushing`, `pushingFor`, `forcePush(repo, ids)` (§0.16),
  `applyPlan(repo, args)` (wraps `useAdeSetPlan` via the `currentRepoId` retarget Part 4 uses),
  `addNewWork(repo, args)`, `addBranch(repo, branch)`. In-flight agent/git actions, one concern.
  `buildDeps` is unchanged; `applyPlan` reaches `sendMove` through `moveSpec`'s closure.
- `adeDrag` (new): `ids`, `target`, `begin(ids)`, `setTarget(t)`, `finish() → {ids, target} | null`.

### 2.6 `useQueue.ts`, `dialogCompose.ts`, `dialogFlow.ts`

- `useQueue.ts`: §0.4 and §0.5. `buildBands` gains `historyOpen`/`reach`; spans, `startIds`,
  `overdueIds`, labels computed where `overdue`/`overflow`/`nxt` already are. `buildCells` fills
  `tip`s. `segmentTagAndAction` sets `QueueAction.tip`.
- `dialogCompose.ts`: `afterSend` → `applyPlan?: () => Promise<void>`; `moveSpec` signature §0.14.
- `dialogFlow.ts` `sendMove`: `await spec.applyPlan?.()` before `deliver`; doc comment updated.

### 2.7 Components (`<script setup lang="ts">`, Tailwind only, no `<style>`)

| Component | New/edited | Role |
|---|---|---|
| `AdeRepoView.vue` | edited | scroll/header refs, `historyOpen`/`historyReach`, `useHistoryPull`, `scrollToDay`, `inHistory`, passes `selectedId`/`pushing`/`historyOpen`/`historyReach`/`localDayOf` to `useQueue`, mounts `AdeHistoryBar`, `AdeTimeline`, `AdeAddPopover` (in `AdeMainLine` slot), `AdeConfirmDialog` |
| `AdeMainLine.vue` | edited | default slot after the pill |
| `AdeProjectHeader.vue` | edited | `ago.ts` options |
| `AdeActivityIcon.vue` | edited | wraps `AdeActivityGlyph` |
| `AdeActivityGlyph.vue` | new | the five glyphs, 12/13 px |
| `AdeTimeline.vue` | new | pull row, bands, day controls before Later, drag target tracking, drop dispatch |
| `AdeHistoryPull.vue` | new | dashed pull row with purple fill |
| `AdeHistoryBar.vue` | new | Go to date, Hide history, Current work ↓ |
| `AdeDayControls.vue` | new | `+ week`, `or date` |
| `AdeDayBand.vue` | new | ruler, history rows, overdue/overflow strips, box list (outer sortable), continuation rows, context menu |
| `AdeStackBlock.vue` | new | action column cells plus box (inner sortable) |
| `AdeStackRow.vue` | new | elbow, colour square, agents pill, owner pill, title/branch |
| `AdeAgentsPill.vue` | new | §0.18 |
| `AdeContinuationRow.vue` | new | §0.23 |
| `AdeConfirmDialog.vue` | new | §0.11 |
| `AdeAddPopover.vue` | new | §0.19 |

Drop dispatch in `AdeTimeline` (one place):
```
verdict = dropVerdict(view, snapshot.plan, ids, target)
refuse  → nothing
direct  → adeActions.applyPlan(repo, verdict.args)
dialog  → adeUi.openDialog(moveSpec(ctx, ids, before, iso, () => adeActions.applyPlan(repo, movePlanArgs(...))))
```
Each band/box element carries `data-ade-band`/`data-ade-day`/`data-ade-box`/`data-ade-lead` for
target resolution and `data-testid`s for §3.4.

---

## 3. Tests (per CLAUDE.md's bar)

### 3.1 `apps/kira-space/tests/unit/ade-queue-parity.spec.ts` (extended)

- `buildScenario` passes `historyOpen: true` through `toQueueInput` (keeps
  `comp.state.showHistory = true`). New case: `showHistory = false` vs `historyOpen: false`: same
  band keys, no history rows.
- Per band: `isMonday`, `iso`, `isEmpty`, `startIds`, `overdueIds`, `nextWorkDay`,
  `overflowMoveLabel` (mockup `overLabel`), spans (`title`, `note`, `tip`, `isEnd` vs
  `noteStyle` amber), `historyCount` vs mockup `histCount` (via `pullText`), `focusDay` vs
  `comp.focusDay`.
- Per cell: tag/info `tip`, button `tip` (Start, Archive, Force push).
- `mockupToWire.ts`: `toQueueInput` gains `historyOpen`, `localDayOf` (maps the converter's own
  `msFromOffset` back to `isoFromOffset`, so history days match mockup offsets exactly), and an
  exported `wireIdOf(comp, repo, mockupId)` for §3.2.
- `ade-queue-rules.spec.ts` helpers pass `localDayOf`; one rule: an archive at 23:30 local lands on
  that local day (fixed TZ-independent by feeding a `localDayOf` that returns the intended ISO).

### 3.2 `apps/kira-space/tests/unit/ade-timeline-parity.spec.ts` (new)

Oracle drives the mockup's own closures with spies, then compares against `timelineOps`:
- **Plan writes.** Fresh component per case; call `comp.movePlan(repo, ids, before, day)` /
  `comp.shiftWork(...)` and read `comp.state.plans[repo]`. Compare with `movePlanArgs`/
  `shiftWorkArgs` applied to the converted plan (order equal; days equal after `isoToOffset`).
  Families: before present/absent/unknown, Later, ids not yet in order, multi-id box.
- **Drop verdicts.** Spy `comp.openDialog`, `comp.movePlan`. For every block of every band in the
  three repos: set `comp.dragIds` to each other segment's `dragIds` and each movable row's `[id]`,
  call `block.dropOn(evt)`; for every band call `band.drop(evt)`. Record refuse (no spy hit) /
  direct (`movePlan` args) / dialog (`openDialog` spec ids/before/day). Compare with
  `dropVerdict`. Include off-day and past-day bands (state patch `offDays`) and a
  before-parent case.
- **Rollover/overflow/day-off.** Spy `comp.shiftWork`; call each band's `rollover`/`overflowMove`;
  compare ids/day with `shiftWorkArgs(band.overdueIds, view.firstWorkDay)` /
  `(band.overflowIds, band.overflowMoveDay)`. Day menu: set `state.ctx = {dk, …}`, render, compare
  `ctx.label` with `dayMenuFor(...).label`, call `ctx.toggle()` with `setState` spied, compare the
  resulting `offDays`/`workWeekend` and `confirm` (`keys`, `to`, title/text) with `dayMenuFor` +
  band `startIds`/`nextWorkDay`/labels.
- Real-only rules (a small `describe`): ISO arithmetic across a month end and a DST change
  (offset math is UTC-day based, so no drift); `null` day round-trips as Later.

### 3.3 `apps/kira-space/tests/unit/ade-dialog-flow.spec.ts` (edited)

- Move: `applyPlan` runs before `deliver` (call order recorded); `applyPlan` rejects → `setError`,
  no delivery, dialog stays open; `deliver` rejects after `applyPlan` resolved → `setError`; retry
  calls `applyPlan` again and delivers once.

### 3.4 `apps/kira-space/tests/ui/ade-timeline.spec.ts` (new, `test:ui:space`, mocked control)

Fixture: one repo, clock fixed to a Wednesday (Playwright `page.clock.install` before boot; if the
Space UI fixture has no hook for it, add a `clockTime` option to `tests/ui/fixtures.ts`). Snapshot
with: an overdue mine stack on a past day; a mine stack A (child A2) today; a parked branch P; a
review branch R with a mine child; a 3-day estimate (continuation rows); an unpushed mine branch U;
a merged branch M; a startable mine branch S with no session; history entries (one older than 14
days). `ipcChannels.ts` gains the five channels. Scenarios:
1. **Render.** Today/Monday separators, weekend hatch, month label, Later last, `+ week`/`or date`
   above Later, continuation rows `day 2/3`, `day 3/3 · merges`, overdue strip, agents pill with the
   robot icon, owner pill on R, merged row tint.
2. **History pull.** At top: wheel up twice → pull text `Keep scrolling up…` and fill width > 0;
   `page.clock.runFor(700)` → reset to `History · N archived in the last 2 weeks`; wheel up past 400
   → history rows appear, scroll position kept (today band still in view); scroll into history →
   History bar; `Hide history` → gone, pull row back; clicking the pull row opens; Go to date older
   than 14 days → that day's band appears.
3. **Drag and drop** (`page.mouse` down/move/up):
   - Row A2 dragged to tomorrow's band → Move dialog opens (Part 4) → Send → `adeSetPlan` called
     before `adeSend` with A2 on tomorrow's ISO, full order; the optimistic render shows A2 on
     tomorrow before the refetch.
   - Parked P dragged to a day → `adeSetPlan` directly, no dialog.
   - Box A dragged onto another box → dialog `before` = that box's lead.
   - Refusals: onto a day off (after marking one), onto a past band, A2 before A's day → no call,
     no dialog.
   - Review R row drag starts a box drag (its segment's non-review ids).
4. **Day menu.** Right-click a weekday with work → `Mark as day off` → `settingsSet` patch; confirm
   `… is a day off` → **Move to <day>** → `adeSetPlan` (shift); **Leave it** path makes no call.
   Right-click a weekend → `Work this day`.
5. **Overdue and overflow.** `Move to today` and the overflow `Move to …` each call `adeSetPlan`
   with `shiftWork`'s order.
6. **Force push.** U's `Force push` → `adeForcePush` held (`hold: true`): label `Pushing…`,
   disabled; release → label back. A `ProtectedBranch` result → typed confirm; yes disabled until
   the name is typed; confirm re-calls with `confirmProtected`. A generic error → repo Alert.
7. **Start from the action column.** S's `▶ Start` → Start dialog → Send → `adePrepareLaunch` and
   the terminal open (Part 4's launch mocks).
8. **Archive end to end.** M's `Archive` with risk → archive dialog: `Just delete` → `adeArchive`
   `discard: true`. Second item: `Send to Claude, then archive` → `adeSend`, dialog closes, emit
   `Stop` for its terminal → `adeArchive` called.
9. **Add.** New work: title, Jira URL, Start from A → `adeAddNewWork` with parsed key/url and
   `startFrom`; the new id is selected (row highlighted after the mocked refetch). Existing branch:
   search filters; `you`/author chips; pick → `adeAddBranch`.
10. **Selection.** Row click selects; agent icon click selects; continuation row click selects the
   lead and scrolls to its start day.

---

## 4. Steps and commits

Record `P129P5_START=$(git rev-parse HEAD)` and baselines (`test:unit`, `test:ui:space`,
`test:ui:studio` counts, `go test` for `internal/ade`/`internal/bridge`) before step 1. Every
commit passes the pre-commit hook (`lint`, `typecheck`). `lint:dead` (knip, pre-push) must be clean
at every commit that adds an export: each new export lands with its consumer (tests count as knip
entries; verify with `bun run lint:dead` at that commit).

1. **`feat(space): ade candidate branches report mine`**: §2.2 Go, bindings. `go test
   ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/bridge/...`.
2. **`fix(space): ade history uses the local archive day`**: `localDay.ts`, `ago.ts` (header
   switched to it), `useQueue` `localDayOf`, `AdeRepoView` `today` via `localIso`, test helpers.
3. **`feat(space): ade queue timeline view facts`**: §0.4 `useQueue` additions, §3.1.
4. **`feat(space): ade timeline plan operations`**: `timelineOps.ts`, §3.2, oracle helper.
5. **`feat(space): ade move dialog applies the plan first`**: §0.14, §3.3.
6. **`feat(space): ade timeline, stack boxes and selection`**: `AdeTimeline`, `AdeDayBand`,
   `AdeStackBlock`, `AdeStackRow`, `AdeAgentsPill`, `AdeActivityGlyph`, `AdeContinuationRow`,
   `adeUi.selectedByRepo`, `AdeRepoView` mount. Read-only apart from selection.
7. **`feat(space): ade history pull and day range controls`**: `useHistoryPull`,
   `AdeHistoryPull`, `AdeHistoryBar`, `AdeDayControls`, `historyOpen`/`historyReach`, settings
   patches.
8. **`feat(space): ade plan moves and day off menu`**: `adeSetPlan` binding, `useAdeSetPlan`,
   `adeActions.applyPlan`, overdue/overflow buttons, workbench `MenuItem` label variant,
   `dayMenuFor` wiring, `AdeConfirmDialog`, `adeUi.confirm`.
9. **`feat(space): ade action column actions and force push`**: cells wired (§0.17),
   `adeForcePush` binding, `useAdeForcePush`, `pushing`, protected confirm.
10. **`feat(space): ade drag and drop`**: `vue-draggable-plus@0.6.1` (root `package.json`,
    `bun.lock`), `adeDrag`, `useTimelineDrag`, drop dispatch, highlight.
11. **`feat(space): ade add popover`**: three bindings, `useAdeCandidates`, two mutations, `jira.ts`,
    `AdeAddPopover`, `AdeMainLine` slot.
12. **`test(space): ade timeline UI coverage`**: §3.4 and `ipcChannels.ts`. Run `test:ui:space`
    once here; fixes land as follow-up `fix(space):` commits, one per finding.
13. **`docs: ARCHITECTURE records the ade timeline (P129 Part 5)`**: §5.1.
14. Result section `## P129 Part 5 result` in `docs/v2.0/SPEC.md`, with §6.1 and the Part 6
    hand-off (§0.18) stated for the orchestrator.

---

## 5. File inventory

New (`apps/kira-space/frontend/src/ade/` unless stated):
`timelineOps.ts`, `localDay.ts`, `ago.ts`, `jira.ts`, `useHistoryPull.ts`, `useTimelineDrag.ts`,
`state/adeDrag.ts`, `AdeTimeline.vue`, `AdeHistoryPull.vue`, `AdeHistoryBar.vue`,
`AdeDayControls.vue`, `AdeDayBand.vue`, `AdeStackBlock.vue`, `AdeStackRow.vue`, `AdeAgentsPill.vue`,
`AdeActivityGlyph.vue`, `AdeContinuationRow.vue`, `AdeConfirmDialog.vue`, `AdeAddPopover.vue`;
`apps/kira-space/tests/unit/ade-timeline-parity.spec.ts`;
`apps/kira-space/tests/ui/ade-timeline.spec.ts`.

Edited:
- `package.json`, `bun.lock` (`vue-draggable-plus` 0.6.1).
- `apps/kira-space/internal/ade/queue.go`, `queue_test.go`; `internal/bridge/ade.go`; generated
  bindings.
- `frontend/src/bridge/index.ts`; `ade/wire.ts`, `queries.ts`, `mutations.ts`, `useQueue.ts`,
  `dialogCompose.ts`, `dialogFlow.ts`, `state/adeUi.ts`, `state/adeActions.ts`, `AdeRepoView.vue`,
  `AdeMainLine.vue`, `AdeProjectHeader.vue`, `AdeActivityIcon.vue`.
- `packages/workbench/src/state/contextMenu.ts`, `packages/workbench/src/components/ContextMenu.vue`.
- Tests: `ade-queue-parity.spec.ts`, `ade-queue-rules.spec.ts`, `ade-dialog-flow.spec.ts`,
  `support/mockupToWire.ts`, `support/mockupOracle.ts` (if a spy helper is shared),
  `tests/ui/support/ipcChannels.ts`, `tests/ui/fixtures.ts` (only if the clock hook is missing).
- `docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md` (result section only).

### 5.1 `docs/ARCHITECTURE.md`

New paragraph after Part 4's ade dialog paragraph: timeline structure (`useQueue` view facts,
`timelineOps` as the one plan-write/drop-rule module, `SetPlan` optimistic), the DnD model
(`vue-draggable-plus` + SortableJS fallback mode, no list binding, target by hit-test, why), history
open state local to the keyed repo view vs selection in `adeUi`, settings the timeline writes
(`horizonDays`, `extraDays`, `offDays`, `workWeekendDays`) and what stays runtime (`historyReach`),
`ForcePush`'s protected-branch confirm, and the local archive day. Update the Part 4 paragraph's
"reachable only from Rebase all" sentence. No Known open item added unless §6.1 finds one.

---

## 6. Verification

| Command | Expected |
|---|---|
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean |
| `bun run build:space`, `bun run build:studio` | Clean |
| `go build ./...`, `go test ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/bridge/...` | Pass |
| `bun run test:unit` | Baseline plus §3.2, extended §3.1/§3.3, all pass |
| `bun run test:ui:space` | Baseline plus §3.4, all pass; `ade-dialogs.spec.ts` unchanged and green |
| `bun run test:ui:studio` | Baseline, unchanged (workbench menu label variant is additive) |

### 6.1 Live check

Server-mode Space (`docs/DEV_ENVIRONMENT.md`) on a scratch repo with two mine branches (one
stacked), one parked, one unpushed after a local rebase:
1. Drag a row to tomorrow → Move dialog → Send → plan persists across a reload.
2. Drag the parked branch → applies directly.
3. Mark a day with work off → confirm → work moves.
4. Force push the unpushed branch → tag clears after the refetch.
5. Wheel-pull history open; archive a branch; it appears on today's band while history is open.
Record outcomes in the result section; name any step the container can't run.

---

## 7. Closing audit

| Check | Command | Pass |
|---|---|---|
| Library real usage | `rg -n "useDraggable" apps/kira-space/frontend/src` | `useTimelineDrag.ts`, called from `AdeDayBand`/`AdeStackBlock` |
| Dependency pinned | `rg -n '"vue-draggable-plus"' package.json` | `"0.6.1"` |
| Control members | `rg -n 'AdeService\.' apps/kira-space/frontend/src/bridge/index.ts` | 17 members; `SetBranchMeta`/`BindNewWork` absent |
| Each new member has a caller | `rg -n 'adeCandidateBranches\|adeAddBranch\|adeAddNewWork\|adeSetPlan\|adeForcePush' apps/kira-space/frontend/src/ade` | Each in `queries.ts`/`mutations.ts`, used from `adeActions` or a component |
| `pushing` fed | `rg -n 'pushingFor' apps/kira-space/frontend/src` | `AdeRepoView` `useQueue` input |
| Openers wired | `rg -n 'moveSpec\|startSpec\|specForQueueAction\|requestArchive' apps/kira-space/frontend/src/ade/*.vue` | Timeline/block callers present |
| Pure modules | `rg -n "from 'vue'\|Date.now\|new Date" apps/kira-space/frontend/src/ade/{useQueue,timelineOps,jira}.ts` | Empty |
| Plan writes in one place | `rg -n 'order:' apps/kira-space/frontend/src/ade --glob '!timelineOps.ts' --glob '!mutations.ts'` | No plan-order construction elsewhere |
| SFC form | `rg -L '<script setup lang="ts">' apps/kira-space/frontend/src/ade/*.vue`; `rg -n '<style' apps/kira-space/frontend/src/ade` | Both empty |
| Theme rules | `bun run lint` (`check-theme-classes.sh`, `check-class-conflicts.ts`) | Clean |
| Robot icon | `rg -n 'name="robot"' apps/kira-space/frontend/src/ade/AdeAgentsPill.vue` | Present |
| No Merge/ready/Jira fetch | `rg -n -i "'merge'\|ready\|ciFailing\|jira\.(fetch\|sync)" apps/kira-space/frontend/src/ade` | No new action, state or fetch |
| No git-ui | `rg -n "@kira/git-ui\|packages/git-ui" apps/kira-space/frontend/src/ade` | Empty |
| Stores one concern | Read `adeUi.ts`, `adeActions.ts`, `adeDrag.ts` | UI state / in-flight actions / drag only |
| Parity breadth | §3.2 family counts | Every family non-empty; every refusal rule hit |
| Studio unchanged | `git diff --stat $P129P5_START -- apps/kira-studio` | Empty |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Nested Sortable fall-through (review row → box drag) doesn't behave as §0.12 expects | §3.4 scenario 3 asserts it; fallback: the box sortable's `handle` becomes the box's left edge plus review rows via `[data-ade-box-handle]`, same ids |
| Fallback clone intercepts hit-testing | Sortable sets `pointer-events: none` on the clone; §3.4 drops assert the target; if not, hide the clone during `elementFromPoint` |
| Optimistic `SetPlan` races the `kira:ade:repo` push refetch | `onMutate` cancels in-flight snapshot queries; `onSettled` invalidates last |
| Two quick settings toggles compute from stale state | Each patch reads `settingsStore.ade` at click time after the prior `patchSettings` resolved; menu actions await |
| `page.clock` and the fixture boot order | Install the clock before app scripts run (fixture option, §3.4) |
| Protected-branch confirm uses the local branch name as token while the gate checks the upstream name | Confirm text shows Go's own message naming the real branch; a mismatch fails again with `ProtectedBranch` and surfaces in-dialog. Record in the result section if the live check hits it |
| `lint:dead` on staged exports | Each export lands with its consumer (§4) |

---

## 9. Acceptance, mapped to the SPEC row

| SPEC row item | Where |
|---|---|
| Add popover: New work | §0.19, §3.4 #9 |
| Add popover: Existing branch with search | §0.3, §0.19, §3.4 #9 |
| History hidden by default | §0.4 (`historyOpen`), §3.1, §3.4 #2 |
| Scroll-pull, purple fill, ~0.7 s reset | §0.7, §3.4 #2 |
| History bar | §0.9, §3.4 #2 |
| Overdue days with Move to today | §0.13, §0.22, §3.2, §3.4 #5 |
| Calendar labels | §0.4, §0.22, §3.1 |
| Weekends hatched | §0.22, §3.4 #1 |
| Monday/Today separators | §0.4 `isMonday`, §0.22, §3.4 #1 |
| 2-week horizon | settings `horizonDays` default 14, §3.1 |
| `+ week` / `or date` | §0.9, §3.4 #1 |
| Later | §0.13 (Later = null), §3.4 #1 |
| Capacity and overflow strips | §0.13, §0.22, §3.2, §3.4 #5 |
| Day off / working day menu with move confirm | §0.10, §0.11, §3.2, §3.4 #4 |
| Stack boxes: segments, dashed later segments, elbows, colour squares | §0.21, §3.4 #1 |
| Agents pill, owner pill | §0.18, §0.21, §3.4 #1 |
| Review/merged/parked looks, selection | §0.6, §0.21, §3.4 #1, #10 |
| Action column: tags, actions, free cells, span and `from` facts | §0.4 tips, §0.17, §3.1, §3.4 #6-#8 |
| Multi-day continuation rows | §0.4 `spans`, §0.23, §3.1, §3.4 #1, #10 |
| DnD with `vue-draggable-plus`: row split, box move, refusal rules | §0.12, §0.13, §3.2, §3.4 #3 |
| My work opens Part 4's Move dialog; parked applies directly | §0.13, §0.14, §3.4 #3 |
| Claude Code icon = `robot` codicon | §0 standing, §0.18, §7 |
| First consumer of `ForcePush` and `pushing` | §0.2, §0.16, §3.4 #6, §7 |
| `test:ui:space` drag/drop and history-pull coverage | §3.4 #2, #3 |
| Archive dialog end to end (`Just delete`; `Send to Claude, then archive` on mocked `Stop`) | §0.25, §3.4 #8 |
| Start launch from the action column | §0.17, §0.25, §3.4 #7 |
