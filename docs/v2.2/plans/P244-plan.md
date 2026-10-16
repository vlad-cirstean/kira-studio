# P244 plan: Docker page polish

SPEC row P244. User's words: "In the docker page, in the terminal tab don't open it automatically, let
me click on new session to open. Second, the engine dropdown text is one above another, it's just
broken visually. Also drop the CPU and RAM in the left bar, it's too distracting. Otherwise looks
great."

Base: `v2.0` at `f2612e11b` or later. Frontend only, `packages/docker-ui` plus one Playwright spec.
No Go, no bridge, no wire change.

Discovery: `codegraph_explore` over `ExecView`/`openSession`/`useDockerExecSessionsStore`,
`DockerPanel`/`EndpointChip`/`UsageBar`/`useStatsSubscription`/`useDockerStatsStore`,
`ContainerList`/`StatsView`/`ContainerDetail`/`ContainerTable`/`EngineOverview`,
theme `DropdownMenuRadioItem`/`DropdownMenuContent`, `closeForContainer`/`createDockerContext`.
Dropdown bug reproduced against the built test UI (`bun run build:test:studio`) with a throwaway
Playwright spec (deleted, never committed) in WebKit and Chromium; screenshots read.

## 1. Terminal tab auto-opens a session

### Root cause

`packages/docker-ui/src/components/ExecView.vue:27-35`:

```ts
watch(
  () => props.containerId,
  () => {
    const first = sessions.value[0];
    if (first) activeId.value = first.id;
    else openSession();
  },
  { immediate: true },
);
```

`ContainerDetail.vue:143` mounts `ExecView` with `v-if` when the Terminal tab is active, so every
mount (tab click, container switch, context-menu "Open terminal", `ContainerTable` `open(c,
'terminal')`) with zero sessions calls `store.open`, `TerminalHostView` mounts, and the shell
starts (`ExecOpen`). Same after closing the last chip and leaving/returning to the tab.

Sessions live in the Pinia store `dockerExecSessions` (`state/dockerExec.ts`), not in the
component, so they already survive tab switches and container switches; only the `else` branch is
wrong.

### Change: `ExecView.vue`

- Drop the auto-open branch. On `containerId` change (immediate) set `activeId` to
  `sessions[0]?.id ?? ''`; never call `openSession` outside a click.
- Make the visible pane robust to a session vanishing: a `shownId` computed = `activeId` if it is
  still in `sessions`, else `sessions[0]?.id ?? ''`. Chip `active` state and pane `v-show` read
  `shownId`. `closeSession` then only calls `store.close`; no manual `activeId` repair.
- Zero sessions: render a shadcn-vue `Empty` (`@theme/components/ui/empty`: `Empty`,
  `EmptyHeader`, `EmptyMedia variant="icon"` with `CodiconIcon name="terminal"`, `EmptyTitle`
  "No terminal session", `EmptyDescription` "Start a shell inside this container.") plus a
  `Button` (`@theme/components/ui/button`, `size="kira"`, `variant="secondary"`) "New session"
  with `CodiconIcon name="add"`, `data-testid="docker-exec-new"`. Wrapper
  `data-testid="docker-exec-empty"`, Tailwind only (`flex h-full items-center justify-center p-4`
  or the `Empty` defaults; match `DockerPanel.vue:147`'s own `Empty` usage).
- One or more sessions: the existing chip toolbar and its "New session" ghost button
  (`data-testid="docker-exec-new"`, unchanged) and the panes. Toolbar is not rendered with zero
  sessions, so exactly one `docker-exec-new` exists at a time.
- Keyboard: both buttons are native `<button>` via `Button`; Tab reaches them, Enter/Space open.
  No autofocus (the tab switch itself must not move focus into the pane).
- Comment line 37 stays accurate only if stale chips are pruned; it is not (see §4, Known open
  item). Reword it to: `// TerminalHostView needs a tab-shaped state; exec sessions have no cwd.`
  or delete it if the implementer finds it restates `hostTab`.

Behaviour after the change:
- Tab mount with no sessions: empty state, `ExecOpen` never called.
- Click New session: one chip, shell starts.
- Switch to Logs and back: same chip, same xterm, no new `ExecOpen`.
- Close the last chip: empty state again, no reopen.
- App restart: store is in-memory, nothing persisted, so empty state; no reopen.
- Container stop then start: unchanged pre-existing behaviour (chip of the dead session stays,
  ARCHITECTURE Known open item); no new session opens by itself.

## 2. Engine dropdown text overlaps

### Reproduction

`EndpointChip.vue` (the "default ▾" chip in the Docker panel header) opens a `DropdownMenu` of
`DropdownMenuRadioItem`s: "Automatic", separator, one item per docker context. Mocked three
contexts (`default`, `colima`, `remote`) and measured in WebKit and Chromium; both identical:

```
item h=22  content spans 94..128 inside item box 100..122   (next item starts at 122)
```

Each context's name/host two-line block (34px) overflows its 22px item by 6px above and below, so
the host line of one item paints over the name line of the next. Screenshot shows `unix:///var/run/
docker.sock` drawn on top of `colima`.

### Root cause

`EndpointChip.vue:66-76`: the per-context item carries `class="h-control"` (fixed
`height: var(--kira-control-h)` = 22px, `tokens.css:146,156`) while its content is a
`flex flex-col` of two lines (`text-kira-md` 18px line box + `text-kira-sm` 16px line box) plus the
item's own `py-1`. `items-center` in the theme item centres the overflowing column, so it spills
both ways. Not a theme bug: `DropdownMenuRadioItem` itself has no fixed height.

### Fix (Tailwind only, `EndpointChip.vue`)

- Context items: replace `h-control` with `min-h-control` (utility exists: `--spacing-control`,
  used in `AdeStageBlock.vue`). Verified live by forcing `height:auto; min-height:22px`: items
  become 22/43/42/43px tall, no overlap, text reads cleanly (screenshot checked).
- "Automatic" item: keep `h-control` (one line) or switch to `min-h-control` for consistency;
  either renders 22px. Prefer `min-h-control` on both so a large Appearance font size never clips.
- Check `bun run lint` (`scripts/check-class-conflicts.ts`) accepts `min-h-control` beside the
  theme item's classes.

## 3. CPU and RAM in the left bar

### What it is

Left bar = `DockerPanel.vue` (side panel) → `ContainerList.vue`. Each running row shows, when a
stats sample exists:
- row 1: `docker-row-cpu` (`formatPercent`) and `docker-row-mem` (`formatSize`) text,
  `ContainerList.vue:185-188`;
- row 2: two `UsageBar`s (CPU %, RAM %), `ContainerList.vue:214-217`.

### Data plumbing: keep

`useStatsSubscription(runningIds)` lives in `DockerPanel.vue:40-43` and fills
`useDockerStatsStore`. Other consumers of that store, all in the main pane, stay:
- `EngineOverview.vue` (totals, sparklines, `docker-engine-cpu`/`docker-engine-mem`),
- `ContainerTable.vue` (per-row CPU/RAM in the overview table),
- `ContainerDetail.vue` (`docker-detail-live` header CPU/RAM),
- `StatsView.vue` (Stats tab).

So the subscription, store, `UsageBar.vue`, `formatPercent`, `formatSize` all stay used. Nothing in
the stats pipeline becomes dead; only `ContainerList`'s own imports do. Leave the subscription in
`DockerPanel` (it is mounted exactly while the module is visible, which is what the "leaving the
mode unsubscribes" test pins); moving it would be churn with no behaviour gain.

### Change: `ContainerList.vue`

- Delete the CPU/RAM `<template>` in row 1 and the `UsageBar` `<template>` in row 2.
- Delete now-unused imports/locals: `formatPercent`, `formatSize`, `useDockerStatsStore`, `stats`,
  `UsageBar`.
- Re-grid the row (Tailwind): today
  `grid-cols-[0.5rem_minmax(0,1fr)_2.75rem_3.5rem_1.25rem] grid-rows-[auto_auto]`. New:
  `grid-cols-[0.5rem_minmax(0,1fr)_auto_1.25rem] grid-rows-[auto_auto]`.
  - Row 1: dot, name, state text (`docker-row-state`, only when not running; running rows render an
    empty `<span />` placeholder so the actions cell stays in column 4), actions (`row-span-2`).
  - Row 2: empty `<span />`, image + ports with `col-span-2`.
- `CONTAINER_ROW_HEIGHT` stays 44 (two text lines remain). Check visually that hover actions and
  focus outline still sit where they did.

### Docs

`docs/ARCHITECTURE.md:4514`: "per-container CPU and RAM in the list and a Stats view" becomes
"per-container CPU and RAM in the engine overview table, the container header and a Stats view;
the side list shows none". Also add after the exec clause: "the Terminal tab opens no session until
New session is clicked".

## 4. Out of scope (stays out)

- `ARCHITECTURE.md:5315` Known open item: exec chips of a stopped container stay until closed by
  hand. `dockerExec.ts` `closeForContainer` has no caller. Not asked; fixing it is a separate row
  if the user wants it. Do not wire it here.
- Detail header CPU/RAM (`docker-detail-live`) and the overview table: main pane, not the left bar.
- No Go, no bridge, no `dockerflow` change. `apps/kira-studio/internal/flows/dockerflow/*_test.go`
  call `svc.ExecOpen`/`StatsSubscribe` on the Go service directly and assume nothing about the
  frontend opening sessions or showing row stats; no change needed.

## 5. Tests

Unit-test bar: none. All changes are template/markup; no logic worth a unit test.

`apps/kira-studio/tests/ui/docker-module.spec.ts` (`ui` project, WebKit):

1. Edit `stats events update the rows; leaving the mode unsubscribes and unwatches`: rename to
   `stats events reach the overview, not the side list; leaving the mode unsubscribes and
   unwatches`. After the `c-solo` stats event assert `[data-testid="docker-engine-cpu"]` has text
   `12.5%` and `[data-testid="docker-container-list"] [data-testid="docker-row-cpu"]`,
   `...docker-row-mem`, `...docker-usage-bar` each `toHaveCount(0)`. Keep the unsubscribe/unwatch
   tail.
2. Edit `engine overview tabulates containers with humanized stats; ...`: replace the
   `docker-row`/`docker-row-mem` assertion with
   `[data-testid="docker-table-row"][data-name="shop-db-1"]` `toContainText('1.5 GB')`.
3. Edit `terminal: exec opens for the container, ...`: after `openContainer(page, 'solo',
   'terminal')` click `[data-testid="docker-exec-new"]` before polling `ExecOpen` for 1.
4. New `terminal: no session opens until New session is clicked; sessions survive tab switches`:
   - open `solo` Terminal tab; `docker-exec-empty` visible; `docker-exec-chip` count 0;
     `docker.calls('ExecOpen')` length 0 (read after the empty state is visible, plus after a
     Logs → Terminal round trip, so a late auto-open would be caught by the second read);
   - focus `docker-exec-new` and press Enter (keyboard path); poll `ExecOpen` 1; chip count 1;
     `.xterm-rows` visible;
   - click `docker-tab-logs`, then `docker-tab-terminal`: chip count 1, `ExecOpen` still 1;
   - click `docker-exec-close`: `ExecClose` 1, `docker-exec-empty` visible, `ExecOpen` still 1.
5. New `engine dropdown items do not overlap`: add a `Contexts` handler to `setup()` (or to this
   test only via a `handlers` override option) returning three contexts with long hosts
   (`default`/`unix:///var/run/docker.sock`, `colima`/`unix:///Users/me/.colima/default/docker.sock`,
   `remote`/`tcp://10.0.0.5:2376`). Click `docker-endpoint-chip`; wait for 3
   `docker-context-option`. `evaluateAll` over `[data-testid="docker-context-menu"]
   [role="menuitemradio"]`: for every item, every descendant `span` rect lies within the item rect
   (±0.5px), and for consecutive items `prev.bottom <= next.top + 0.5`. Fails on today's code
   (host span 112..128 vs item 100..122), passes after the fix.

`setup()` gets an optional `handlers` override merged over the defaults if test 5 needs it; keep it
minimal.

Not edited (Stream A owns it): `apps/kira-studio/tests/e2e-real/docker-real.spec.ts:87-88` clicks
`docker-tab-terminal` and expects `.xterm-rows` straight away. After P244 it needs one line,
`await page.locator('[data-testid="docker-exec-new"]').click();`, between those two. See §7.

No visual snapshot covers the Docker module (`tests/visual/` has none); nothing to update.

## 6. File ownership

| File | Change |
| --- | --- |
| `packages/docker-ui/src/components/ExecView.vue` | §1 |
| `packages/docker-ui/src/components/EndpointChip.vue` | §2 |
| `packages/docker-ui/src/components/ContainerList.vue` | §3 |
| `apps/kira-studio/tests/ui/docker-module.spec.ts` | §5 |
| `docs/ARCHITECTURE.md` (Docker module bullet only) | §3 docs |
| `docs/v2.2/SPEC.md` (P244 row status + result section, at close) | close-out |

One sequential implementer. Suggested commits: `fix(docker-ui): open terminal sessions only on
New session`, `fix(docker-ui): let engine context items grow to their two lines`,
`refactor(docker-ui): drop CPU and RAM from the container side list`, `test(studio): ...` (or fold
each spec edit into its fix commit), `docs: ...`.

## 7. Overlap with Stream A (P236, `/home/user/kira-sA`)

Stream A owns `apps/kira-space/frontend/src/ade/v2/**`, `internal/flows/**`,
`internal/flowharness/**`, `apps/*/tests/e2e-real/**`, `packages/git-ui/**`, the flow-coverage
gate.

- File overlap: none. P244 touches only `packages/docker-ui/**`,
  `apps/kira-studio/tests/ui/docker-module.spec.ts`, `docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md`.
  Note `docs/v2.2/SPEC.md` may also be edited by Stream A's close-out; rebase conflict there is
  trivial (different rows).
- Behavioural overlap: one. `apps/kira-studio/tests/e2e-real/docker-real.spec.ts` (Stream A's
  tree) relies on the auto-open. Once P244 lands, that spec fails at `.xterm-rows` until it clicks
  `docker-exec-new`. P236's own exit criterion is `bun run test:e2e-real:studio` green.
- Flow tests (`internal/flows/dockerflow/*`): no dependency on the frontend; unaffected. Coverage
  gate maps bound methods to flows; no bound method added or removed.

Can it run concurrently: yes, code-wise (zero file overlap, separate checkout). The one spec line
must land after P244, not before: on today's code a `docker-exec-new` click after the auto-open
makes a second session, and `.xterm-rows` then matches two panes (strict-mode failure). Ordering:
- (a) Stream A still running when P244 lands: orchestrator tells Stream A to rebase and add the
  line before its final `test:e2e-real:studio` run.
- (b) Stream A finished first: P244's implementer adds the line after P236 lands (ownership
  passes back once Stream A is done), same commit as the ExecView fix.

P244 implementer must not edit `docker-real.spec.ts` while Stream A is live.

## 8. Verification checklist (orchestrator)

Run in `/home/user/kira-studio` after the implementer reports done.

- Auto-open gone:
  `grep -n "openSession" packages/docker-ui/src/components/ExecView.vue` shows only the function
  and the two `@click` bindings; no call inside `watch`.
- Empty state uses shadcn: `grep -n "@theme/components/ui/empty\|docker-exec-empty" packages/docker-ui/src/components/ExecView.vue`.
- No scoped style added: `grep -n "<style" packages/docker-ui/src/components/{ExecView,EndpointChip,ContainerList}.vue` empty.
- Dropdown fix: `grep -n "h-control" packages/docker-ui/src/components/EndpointChip.vue` shows
  `min-h-control` on the context items (and no bare `h-control` on them).
- Left bar clean: `grep -n "docker-row-cpu\|docker-row-mem\|UsageBar\|useDockerStatsStore\|formatPercent\|formatSize" packages/docker-ui/src/components/ContainerList.vue` empty.
- Stats pipeline intact: `grep -rn "useStatsSubscription(" packages/docker-ui/src` still hits
  `DockerPanel.vue`; `grep -rln "useDockerStatsStore" packages/docker-ui/src/components` lists
  `ContainerDetail`, `ContainerTable`, `EngineOverview`, `StatsView`.
- Stream A untouched: `git diff --stat f2612e11b -- apps/kira-studio/tests/e2e-real internal/flows internal/flowharness packages/git-ui apps/kira-space` empty.
- Checks: `bun run lint`, `bun run typecheck:docker`, `bun run typecheck:web:studio`,
  `bun run typecheck:tests:studio`, `bun run lint:dead` (knip), `bun run build:studio`.
- Specs: `bun run build:test:studio && npx playwright test --config=apps/kira-studio/playwright.config.ts --project=ui docker-module`
  all green; the new dropdown test fails when `min-h-control` is reverted to `h-control`
  (spot-check once by hand, then restore).
- Optional real check (needs `dockerd`, see `docs/DEV_ENVIRONMENT.md`): after Stream A adds its
  line, `bun run test:e2e-real:studio -- docker-real`.
- Pre-commit hook passed on every commit (no `--no-verify` in `git log` notes; hook is the lint/
  typecheck gate).

## 9. Risks

- Removing the toolbar when empty shifts layout on first session; acceptable, matches the ask.
- `min-h-control` lets a one-line item grow to its content (18px line + `py-1` = 26px) where
  `h-control` clipped it to 22px. The live check grew only the two-line items (22 → 42-43px);
  if "Automatic" turns out 26px under `min-h-control`, keep `h-control` on it.

## 10. Open questions

1. Stale exec chips after a container stops (Known open item, `closeForContainer` uncalled):
   left out. Say if the user wants it folded in; it would be a small watch in `DockerPanel.vue`
   pruning sessions of non-running containers.
2. "CPU and RAM in the left bar" read as the side list only; the detail header's CPU/RAM
   (`docker-detail-live`, main pane) stays. Confirm.
